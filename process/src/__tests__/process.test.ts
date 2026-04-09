import { describe, it, expect } from "vitest";
import { ProcessSimulator, createInitProc, defaultFds, defaultMemoryMap, SIG_NUM, SIG_DEFAULT } from "../engine/process.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { SyscallOp } from "../engine/process.js";

function runOps(ops: SyscallOp[]) {
  const sim = new ProcessSimulator();
  return sim.simulate(createInitProc("bash", "/bin/bash"), ops);
}

// ── 定数 ──

describe("SIG_NUM / SIG_DEFAULT", () => {
  it("SIGKILL=9, SIGTERM=15", () => { expect(SIG_NUM.SIGKILL).toBe(9); expect(SIG_NUM.SIGTERM).toBe(15); });
  it("SIGKILL デフォルト=terminate", () => { expect(SIG_DEFAULT.SIGKILL).toBe("terminate"); });
  it("SIGCHLD デフォルト=ignore", () => { expect(SIG_DEFAULT.SIGCHLD).toBe("ignore"); });
});

// ── ヘルパー ──

describe("defaultFds", () => {
  it("stdin/stdout/stderr の 3 つ", () => {
    const fds = defaultFds();
    expect(fds).toHaveLength(3);
    expect(fds[0]!.fd).toBe(0);
    expect(fds[1]!.fd).toBe(1);
    expect(fds[2]!.fd).toBe(2);
  });
});

describe("defaultMemoryMap", () => {
  it(".text, .data, heap, libc, stack, vdso を含む", () => {
    const map = defaultMemoryMap("/bin/ls");
    expect(map.length).toBeGreaterThanOrEqual(5);
    expect(map.some((r) => r.name.includes(".text"))).toBe(true);
    expect(map.some((r) => r.name.includes("[heap]"))).toBe(true);
    expect(map.some((r) => r.name.includes("[stack]"))).toBe(true);
  });
});

describe("createInitProc", () => {
  it("初期プロセスを作成する", () => {
    const p = createInitProc("test", "/bin/test", { uid: 1000, nice: 5 });
    expect(p.name).toBe("test");
    expect(p.uid).toBe(1000);
    expect(p.nice).toBe(5);
    expect(p.fds.length).toBe(3);
  });
});

// ── fork ──

describe("fork", () => {
  it("子プロセスを作成する", () => {
    const r = runOps([{ op: "fork", parentPid: 1, childName: "child" }]);
    expect(r.processes).toHaveLength(2);
    expect(r.processes[1]!.pid).toBe(2);
    expect(r.processes[1]!.ppid).toBe(1);
    expect(r.processes[1]!.name).toBe("child");
  });

  it("CoW メモリマップがマークされる", () => {
    const r = runOps([{ op: "fork", parentPid: 1, childName: "child" }]);
    expect(r.processes[1]!.memoryMap.every((m) => m.cow)).toBe(true);
  });

  it("FD が継承される", () => {
    const r = runOps([{ op: "fork", parentPid: 1, childName: "child" }]);
    expect(r.processes[1]!.fds.length).toBe(r.processes[0]!.fds.length);
  });

  it("親の children に追加される", () => {
    const r = runOps([{ op: "fork", parentPid: 1, childName: "c1" }, { op: "fork", parentPid: 1, childName: "c2" }]);
    expect(r.processes[0]!.children).toEqual([2, 3]);
  });
});

// ── exec ──

describe("exec", () => {
  it("アドレス空間を置換する", () => {
    const r = runOps([
      { op: "fork", parentPid: 1, childName: "child" },
      { op: "exec", pid: 2, newExec: "/bin/ls", argv: ["ls", "-la"] },
    ]);
    expect(r.processes[1]!.execPath).toBe("/bin/ls");
    expect(r.processes[1]!.name).toBe("ls");
    expect(r.processes[1]!.memoryMap.some((m) => m.name.includes("/bin/ls"))).toBe(true);
  });
});

// ── exit / wait ──

describe("exit / wait", () => {
  it("exit で zombie になる", () => {
    const r = runOps([
      { op: "fork", parentPid: 1, childName: "child" },
      { op: "exit", pid: 2, code: 42 },
    ]);
    expect(r.processes[1]!.state).toBe("zombie");
    expect(r.processes[1]!.exitCode).toBe(42);
  });

  it("wait で zombie を回収する", () => {
    const r = runOps([
      { op: "fork", parentPid: 1, childName: "child" },
      { op: "exit", pid: 2, code: 0 },
      { op: "wait", pid: 1 },
    ]);
    expect(r.processes[1]!.state).toBe("terminated");
  });

  it("wait する子がなければ sleeping になる", () => {
    const r = runOps([{ op: "wait", pid: 1 }]);
    expect(r.processes[0]!.state).toBe("sleeping");
  });
});

// ── signal ──

describe("signal", () => {
  it("SIGKILL は即座に zombie", () => {
    const r = runOps([
      { op: "fork", parentPid: 1, childName: "child" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGKILL" },
    ]);
    expect(r.processes[1]!.state).toBe("zombie");
    expect(r.processes[1]!.exitCode).toBe(128 + 9);
  });

  it("SIGSTOP で stopped, SIGCONT で再開", () => {
    const r = runOps([
      { op: "fork", parentPid: 1, childName: "child" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGSTOP" },
    ]);
    expect(r.processes[1]!.state).toBe("stopped");

    const r2 = runOps([
      { op: "fork", parentPid: 1, childName: "child" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGSTOP" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGCONT" },
    ]);
    expect(r2.processes[1]!.state).toBe("ready");
  });

  it("カスタムハンドラが登録されていれば ignore 可能", () => {
    const sim = new ProcessSimulator();
    const r = sim.simulate(
      createInitProc("d", "/d", { handlers: { SIGTERM: "ignore" } }),
      [{ op: "kill", senderPid: 0, targetPid: 1, signal: "SIGTERM" }],
    );
    expect(r.processes[0]!.state).not.toBe("zombie");
  });
});

// ── pipe / IPC ──

describe("pipe / write / read", () => {
  it("パイプを作成して read/write する", () => {
    const r = runOps([
      { op: "pipe", pid: 1, name: "test-pipe" },
      { op: "write", pid: 1, fd: 4, data: "hello" },
      { op: "read", pid: 1, fd: 3 },
    ]);
    expect(r.pipes).toHaveLength(1);
    expect(r.events.some((e) => e.detail.includes("hello"))).toBe(true);
  });
});

// ── dup2 / close ──

describe("dup2 / close", () => {
  it("dup2 で FD を複製する", () => {
    const r = runOps([
      { op: "pipe", pid: 1, name: "p" },
      { op: "dup2", pid: 1, oldFd: 4, newFd: 1 },
    ]);
    const proc = r.processes[0]!;
    const fd1 = proc.fds.find((f) => f.fd === 1);
    expect(fd1?.type).toBe("pipe-write");
  });

  it("close で FD を削除する", () => {
    const r = runOps([{ op: "close", pid: 1, fd: 0 }]);
    expect(r.processes[0]!.fds.find((f) => f.fd === 0)).toBeUndefined();
  });
});

// ── 孤児プロセス ──

describe("孤児プロセス", () => {
  it("親 exit 後に init (PID=1) に再配置される", () => {
    const sim = new ProcessSimulator();
    const r = sim.simulate(createInitProc("init", "/sbin/init"), [
      { op: "fork", parentPid: 1, childName: "parent" },
      { op: "fork", parentPid: 2, childName: "orphan" },
      { op: "exit", pid: 2, code: 0 },
    ]);
    const orphan = r.processes.find((p) => p.name === "orphan");
    expect(orphan?.ppid).toBe(1);
  });
});

// ── sleep / nice / schedule ──

describe("sleep / nice / schedule", () => {
  it("sleep で sleeping → 起床で ready", () => {
    const r = runOps([
      { op: "fork", parentPid: 1, childName: "s" },
      { op: "sleep", pid: 2, ms: 50 },
    ]);
    expect(r.processes[1]!.state).toBe("ready");
  });

  it("nice で優先度を変更する", () => {
    const r = runOps([{ op: "nice", pid: 1, value: -10 }]);
    expect(r.processes[0]!.nice).toBe(-10);
  });

  it("nice 値は -20~19 にクランプされる", () => {
    const r = runOps([{ op: "nice", pid: 1, value: -99 }]);
    expect(r.processes[0]!.nice).toBe(-20);
  });
});

// ── プリセット ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => { expect(EXPERIMENTS).toHaveLength(9); });
  it("名前が一意", () => { expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length); });
  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: 実行可能`, () => {
      const sim = new ProcessSimulator();
      const r = sim.simulate(exp.initProc, exp.ops);
      expect(r.events.length).toBeGreaterThan(0);
      expect(r.processes.length).toBeGreaterThan(0);
    });
  }
});
