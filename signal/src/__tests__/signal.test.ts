import { describe, it, expect } from "vitest";
import { runSimulation } from "../signal/engine.js";
import { presets } from "../signal/presets.js";
import type { SimOp } from "../signal/types.js";

/** ヘルパー: プロセス作成操作 */
function proc(pid: number, name: string, uid = 1000): SimOp {
  return { type: "process_create", process: { pid, ppid: 1, name, state: "running", uid } };
}

describe("基本的なシグナル送信", () => {
  it("kill()でSIGTERMを送信するとプロセスが終了する", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("terminated");
    expect(result.stats.processesTerminated).toBe(1);
  });

  it("SIGKILLは強制終了", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "kill", senderPid: 1, targetPid: 100, signal: 9 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("terminated");
  });

  it("存在しないプロセスへのkillでエラー", () => {
    const ops: SimOp[] = [
      proc(100, "sender"),
      { type: "kill", senderPid: 100, targetPid: 999, signal: 15 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "error")).toBe(true);
  });

  it("raise()で自分自身にシグナル送信", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "raise", pid: 100, signal: 6 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("terminated"); // SIGABRT → core_dump
  });
});

describe("シグナルハンドラ", () => {
  it("カスタムハンドラでプロセスが終了しない", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "custom", description: "handler" } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 2 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("running");
    expect(result.stats.customHandlers).toBe(1);
  });

  it("SIG_IGNでシグナルが無視される", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 15, type: "ignore" } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("running");
    expect(result.stats.ignored).toBe(1);
  });

  it("SIGKILLにはハンドラ設定不可", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 9, type: "custom", description: "impossible" } },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "error")).toBe(true);
  });

  it("SIGSTOPにはハンドラ設定不可", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 19, type: "custom", description: "impossible" } },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "error")).toBe(true);
  });

  it("SIGKILLはSIG_IGNを無視して強制終了", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "ignore" } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 9 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("terminated");
  });
});

describe("シグナルマスク", () => {
  it("ブロック中のシグナルはペンディングに追加される", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 10, type: "custom", description: "h" } },
      { type: "sigmask_block", pid: 100, signals: [10] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.pendingSignals.length).toBe(1);
    expect(result.stats.blocked).toBe(1);
  });

  it("アンブロック時にペンディングシグナルが配送される", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 10, type: "custom", description: "h" } },
      { type: "sigmask_block", pid: 100, signals: [10] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "sigmask_unblock", pid: 100, signals: [10] },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.pendingSignals.length).toBe(0);
    expect(result.stats.customHandlers).toBe(1);
  });

  it("標準シグナルのペンディングは重複マージされる", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 10, type: "custom", description: "h" } },
      { type: "sigmask_block", pid: 100, signals: [10] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "sigmask_unblock", pid: 100, signals: [10] },
    ];
    const result = runSimulation(ops);
    // 標準シグナルは1回だけ配送
    expect(result.stats.customHandlers).toBe(1);
  });

  it("SIGKILL/SIGSTOPはマスクできない", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigmask_block", pid: 100, signals: [9, 19] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 9 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("terminated");
  });
});

describe("リアルタイムシグナル", () => {
  it("リアルタイムシグナルはキューイングされる（重複保持）", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 34, type: "custom", description: "rt", siginfo: true } },
      { type: "sigmask_block", pid: 100, signals: [34] },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 34, value: 1 },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 34, value: 2 },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 34, value: 3 },
      { type: "sigmask_unblock", pid: 100, signals: [34] },
    ];
    const result = runSimulation(ops);
    // リアルタイムシグナルは全て配送 (3回)
    expect(result.stats.customHandlers).toBe(3);
  });

  it("sigqueueでデータ付きシグナルが送信される", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 34, type: "custom", description: "rt", siginfo: true } },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 34, value: 42 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "sigqueue_send")).toBe(true);
    expect(result.events.some((e) => e.description.includes("value=42"))).toBe(true);
  });
});

describe("SIGSTOP / SIGCONT", () => {
  it("SIGSTOPでプロセスが停止する", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "kill", senderPid: 1, targetPid: 100, signal: 19 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("stopped");
  });

  it("SIGCONTで停止プロセスが再開する", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "kill", senderPid: 1, targetPid: 100, signal: 19 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 18 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[0]!.state).toBe("running");
  });
});

describe("fork", () => {
  it("fork()で子プロセスがハンドラを継承する", () => {
    const ops: SimOp[] = [
      proc(100, "parent"),
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "custom", description: "h" } },
      { type: "fork", parentPid: 100, childPid: 101, childName: "child" },
    ];
    const result = runSimulation(ops);
    const child = result.processes.find((p) => p.pid === 101);
    expect(child).toBeDefined();
    expect(child!.handlers.length).toBe(1);
    expect(child!.handlers[0]!.signal).toBe(2);
  });

  it("fork()で子プロセスのペンディングはクリア", () => {
    const ops: SimOp[] = [
      proc(100, "parent"),
      { type: "sigaction", pid: 100, handler: { signal: 10, type: "custom", description: "h" } },
      { type: "sigmask_block", pid: 100, signals: [10] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "fork", parentPid: 100, childPid: 101, childName: "child" },
    ];
    const result = runSimulation(ops);
    const child = result.processes.find((p) => p.pid === 101);
    expect(child!.pendingSignals.length).toBe(0);
    expect(child!.signalMask).toContain(10); // マスクは継承
  });
});

describe("権限チェック", () => {
  it("異なるuidへのkillはEPERM", () => {
    const ops: SimOp[] = [
      proc(100, "alice", 1000),
      proc(200, "bob", 1001),
      { type: "kill", senderPid: 100, targetPid: 200, signal: 15 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "error" && e.description.includes("EPERM"))).toBe(true);
    expect(result.processes[1]!.state).toBe("running"); // bobは生存
  });

  it("rootは誰にでもシグナル送信可能", () => {
    const ops: SimOp[] = [
      proc(1, "root", 0),
      proc(100, "alice", 1000),
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
    ];
    const result = runSimulation(ops);
    expect(result.processes[1]!.state).toBe("terminated");
  });
});

describe("sigsuspend", () => {
  it("sigsuspendで一時マスク中にペンディングが配送される", () => {
    const ops: SimOp[] = [
      proc(100, "app"),
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "custom", description: "h" } },
      { type: "sigmask_block", pid: 100, signals: [2] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 2 },
      { type: "sigsuspend", pid: 100, tempMask: [] },
    ];
    const result = runSimulation(ops);
    expect(result.stats.customHandlers).toBe(1);
    // マスクは復元される
    expect(result.processes[0]!.signalMask).toContain(2);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });
});
