import { describe, it, expect } from "vitest";
import { runSimulation } from "../procmgr/engine.js";
import { presets } from "../procmgr/presets.js";
import type { SimOp } from "../procmgr/types.js";

describe("init_system", () => {
  it("initとkthreaddが作成される", () => {
    const ops: SimOp[] = [{ type: "init_system" }];
    const result = runSimulation(ops);
    expect(result.processes.length).toBe(2);
    expect(result.processes[0]!.pid).toBe(1);
    expect(result.processes[0]!.name).toBe("init");
    expect(result.processes[1]!.pid).toBe(2);
    expect(result.processes[1]!.name).toBe("kthreadd");
  });
});

describe("fork", () => {
  it("子プロセスが親の属性を継承する", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
    ];
    const result = runSimulation(ops);
    const child = result.processes.find((p) => p.pid === 100);
    expect(child).toBeDefined();
    expect(child!.ppid).toBe(1);
    expect(child!.pgid).toBe(1);
    expect(child!.sid).toBe(1);
    expect(child!.state).toBe("running");
    expect(result.stats.forked).toBe(1);
  });

  it("存在しない親のforkは無視される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 999, childPid: 100, childName: "bash" },
    ];
    const result = runSimulation(ops);
    expect(result.processes.find((p) => p.pid === 100)).toBeUndefined();
  });
});

describe("exec", () => {
  it("プロセス名が変更される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "exec", pid: 100, newName: "vim", newPath: "/usr/bin/vim" },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.name).toBe("vim");
  });
});

describe("exit と zombie", () => {
  it("親がwaitしていなければzombieになる", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "child" },
      { type: "exit", pid: 100, code: 0 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.state).toBe("zombie");
    expect(result.stats.zombies).toBe(1);
  });

  it("子プロセスが孤児になると init に養子縁組される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "parent" },
      { type: "fork", parentPid: 100, childPid: 200, childName: "child" },
      { type: "exit", pid: 100, code: 0 },
    ];
    const result = runSimulation(ops);
    const child = result.processes.find((p) => p.pid === 200);
    expect(child!.ppid).toBe(1);
    expect(result.stats.orphansAdopted).toBe(1);
  });
});

describe("waitpid", () => {
  it("zombieを回収する", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "child" },
      { type: "exit", pid: 100, code: 42 },
      { type: "waitpid", waiterPid: 1, targetPid: 100, options: "0" },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.state).toBe("dead");
    expect(result.stats.reaped).toBe(1);
  });

  it("targetPid=-1で任意のzombie子を回収", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "c1" },
      { type: "fork", parentPid: 1, childPid: 101, childName: "c2" },
      { type: "exit", pid: 100, code: 0 },
      { type: "exit", pid: 101, code: 0 },
      { type: "waitpid", waiterPid: 1, targetPid: -1, options: "0" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.reaped).toBe(1);
  });

  it("WNOHANGで該当なしの場合ブロックしない", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "child" },
      { type: "waitpid", waiterPid: 1, targetPid: 100, options: "WNOHANG" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("WNOHANG"))).toBe(true);
  });
});

describe("reap_zombie", () => {
  it("zombieを直接回収する", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "child" },
      { type: "exit", pid: 100, code: 0 },
      { type: "reap_zombie", pid: 100 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.state).toBe("dead");
  });
});

describe("kill シグナル", () => {
  it("SIGKILLでプロセスが即座に終了", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "target" },
      { type: "kill", targetPid: 100, signal: "SIGKILL", senderPid: 1 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.state).toBe("dead");
    expect(proc!.exitCode).toBe(137);
  });

  it("SIGSTOPでプロセスが停止", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "target" },
      { type: "kill", targetPid: 100, signal: "SIGSTOP", senderPid: 1 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.state).toBe("stopped");
  });

  it("SIGCONTで停止中プロセスが再開", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "target" },
      { type: "kill", targetPid: 100, signal: "SIGSTOP", senderPid: 1 },
      { type: "kill", targetPid: 100, signal: "SIGCONT", senderPid: 1 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.state).toBe("running");
  });
});

describe("プロセスグループ", () => {
  it("create_groupで新グループが作成される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "create_group", pgid: 100, leaderPid: 100 },
    ];
    const result = runSimulation(ops);
    const group = result.groups.find((g) => g.pgid === 100);
    expect(group).toBeDefined();
    expect(group!.leaderPid).toBe(100);
    expect(result.stats.groupsCreated).toBeGreaterThanOrEqual(1);
  });

  it("setpgidでグループを変更できる", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "leader" },
      { type: "fork", parentPid: 1, childPid: 101, childName: "follower" },
      { type: "create_group", pgid: 100, leaderPid: 100 },
      { type: "setpgid", pid: 101, pgid: 100 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 101);
    expect(proc!.pgid).toBe(100);
  });
});

describe("セッション", () => {
  it("setsidで新セッションが作成される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "setsid", pid: 100 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.sid).toBe(100);
    expect(proc!.isSessionLeader).toBe(true);
    expect(proc!.tty).toBeUndefined();
    expect(result.stats.sessionsCreated).toBe(1);
  });

  it("set_cttyで制御端末が設定される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "setsid", pid: 100 },
      { type: "set_ctty", pid: 100, tty: "/dev/pts/0" },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.tty).toBe("/dev/pts/0");
  });

  it("disconnect_ttyでセッション全体のTTYが切り離される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "setsid", pid: 100 },
      { type: "set_ctty", pid: 100, tty: "/dev/pts/0" },
      { type: "fork", parentPid: 100, childPid: 101, childName: "child" },
      { type: "disconnect_tty", sid: 100 },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.tty).toBeUndefined();
  });
});

describe("ジョブ制御", () => {
  it("job_stopでグループ全体が停止", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "fork", parentPid: 100, childPid: 200, childName: "vim" },
      { type: "create_group", pgid: 200, leaderPid: 200 },
      { type: "job_stop", pgid: 200, signal: "SIGTSTP" },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 200);
    expect(proc!.state).toBe("stopped");
  });

  it("job_resumeでグループ全体が再開", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "fork", parentPid: 100, childPid: 200, childName: "vim" },
      { type: "create_group", pgid: 200, leaderPid: 200 },
      { type: "job_stop", pgid: 200, signal: "SIGTSTP" },
      { type: "job_resume", pgid: 200, signal: "SIGCONT" },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 200);
    expect(proc!.state).toBe("running");
  });

  it("set_foregroundでフォアグラウンドグループが変更", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "create_group", pgid: 100, leaderPid: 100 },
      { type: "set_foreground", pgid: 100, tty: "/dev/pts/0" },
    ];
    const result = runSimulation(ops);
    const group = result.groups.find((g) => g.pgid === 100);
    expect(group!.isForeground).toBe(true);
  });
});

describe("デーモン化", () => {
  it("daemonizeでプロセスがデーモン化される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "sshd" },
      { type: "daemonize", pid: 100, steps: ["fork()", "setsid()", "fork()"] },
    ];
    const result = runSimulation(ops);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.isDaemon).toBe(true);
    expect(result.stats.daemonized).toBe(1);
  });
});

describe("cgroup", () => {
  it("cgroupの作成とプロセスのアタッチ", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "cgroup_create", path: "app/web", cpuLimit: 50, memoryLimit: 1024 },
      { type: "fork", parentPid: 1, childPid: 100, childName: "nginx" },
      { type: "cgroup_attach", path: "app/web", pid: 100 },
    ];
    const result = runSimulation(ops);
    const cg = result.cgroups.find((c) => c.path === "app/web");
    expect(cg).toBeDefined();
    expect(cg!.cpuLimit).toBe(50);
    expect(cg!.members).toContain(100);
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.cgroup).toBe("app/web");
  });
});

describe("名前空間", () => {
  it("unshareで新しい名前空間が作成される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "containerd" },
      { type: "unshare", pid: 100, nsType: "pid" },
    ];
    const result = runSimulation(ops);
    expect(result.namespaces.length).toBe(1);
    expect(result.namespaces[0]!.type).toBe("pid");
    expect(result.namespaces[0]!.members).toContain(100);
  });
});

describe("ps_snapshot", () => {
  it("スナップショットで生存プロセスが記録される", () => {
    const ops: SimOp[] = [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "ps_snapshot" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "process_table" && e.description.includes("3プロセス"))).toBe(true);
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
