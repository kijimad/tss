/* UNIX 擬似端末 (PTY) シミュレーター テスト */

import { describe, it, expect } from "vitest";
import { simulate, executeSimulation, defaultConfig } from "../pty/engine.js";
import { PRESETS } from "../pty/presets.js";
import type { SimOp } from "../pty/types.js";

/** ヘルパー */
function mkOp(instructions: SimOp["instructions"]): SimOp {
  return { type: "execute", config: defaultConfig(), instructions };
}

describe("PTY Engine", () => {

  // ─── PTY確保 ───

  describe("PTY確保", () => {
    it("posix_openpt でPTYが確保される", () => {
      const r = executeSimulation(mkOp([{ op: "posix_openpt" }]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs.length).toBe(1);
      expect(last.ptyPairs[0].state).toBe("allocated");
    });

    it("grantpt でパーミッション設定", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].state).toBe("granted");
    });

    it("unlockpt でロック解除", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].state).toBe("unlocked");
    });

    it("open_slave でスレーブ側を開く", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].state).toBe("open");
      expect(last.ptyPairs[0].slaveFd).not.toBeNull();
    });

    it("ptsname でスレーブパスを取得", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "ptsname" },
      ]));
      expect(r.events.some(e => e.message.includes("/dev/pts/"))).toBe(true);
    });

    it("複数PTYを確保できる", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs.length).toBe(2);
      expect(last.ptyPairs[0].slavePath).toBe("/dev/pts/0");
      expect(last.ptyPairs[1].slavePath).toBe("/dev/pts/1");
    });
  });

  // ─── データフロー ───

  describe("データフロー", () => {
    it("write_master でデータがmaster→slaveに送られる", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
        { op: "write_master", data: "hello" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].masterToSlave).toBe("hello");
      expect(last.dataFlows.some(f => f.direction === "master→slave")).toBe(true);
    });

    it("read_slave でマスターからのデータを読む", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
        { op: "write_master", data: "test" },
        { op: "read_slave" },
      ]));
      expect(r.events.some(e => e.message.includes("test"))).toBe(true);
    });

    it("write_slave でデータがslave→masterに送られる", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
        { op: "write_slave", data: "output\n" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.dataFlows.some(f => f.direction === "slave→master")).toBe(true);
    });

    it("read_master でスレーブからのデータを読む", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
        { op: "write_slave", data: "reply" },
        { op: "read_master" },
      ]));
      expect(r.events.some(e => e.type === "data_flow" && e.message.includes("read"))).toBe(true);
    });
  });

  // ─── プロセス管理 ───

  describe("プロセス管理", () => {
    it("fork で子プロセスが生成される", () => {
      const r = executeSimulation(mkOp([
        { op: "fork", childName: "child" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.processes.length).toBe(2);
      expect(last.processes[1].name).toBe("child");
    });

    it("fork した子プロセスは親のfdを引き継ぐ", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "fork", childName: "child" },
      ]));
      const last = r.steps[r.steps.length - 1];
      const child = last.processes.find(p => p.name === "child")!;
      // 親が持つfdをコピー（stdin/stdout/stderr + masterfd）
      expect(child.fds.length).toBeGreaterThanOrEqual(3);
    });

    it("setsid で新セッションが作成される", () => {
      const r = executeSimulation(mkOp([
        { op: "fork", childName: "child", childInstrs: [{ op: "setsid" }] },
      ]));
      const setsidEvent = r.events.find(e => e.type === "setsid");
      expect(setsidEvent).toBeDefined();
    });

    it("exec でプロセス名が変わる", () => {
      const r = executeSimulation(mkOp([
        { op: "exec", program: "/usr/bin/vim" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.processes[0].name).toBe("/usr/bin/vim");
    });
  });

  // ─── 制御端末 ───

  describe("制御端末", () => {
    it("TIOCSCTTY で制御端末を設定", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
        { op: "ioctl_tiocsctty" },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].controllingSession).not.toBeNull();
      expect(last.processes[0].ctty).toBe("/dev/pts/0");
    });
  });

  // ─── ウィンドウサイズ ───

  describe("ウィンドウサイズ", () => {
    it("TIOCGWINSZ でサイズ取得", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "ioctl_tiocgwinsz" },
      ]));
      expect(r.events.some(e => e.message.includes("24×80"))).toBe(true);
    });

    it("TIOCSWINSZ でサイズ変更", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "ioctl_tiocswinsz", rows: 50, cols: 132 },
        { op: "ioctl_tiocgwinsz" },
      ]));
      expect(r.events.some(e => e.message.includes("50×132"))).toBe(true);
    });
  });

  // ─── dup2 ───

  describe("dup2", () => {
    it("dup2 でfdを複製", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "grantpt" },
        { op: "unlockpt" },
        { op: "open_slave" },
        { op: "dup2", srcFd: 4, dstFd: 0 },
      ]));
      const last = r.steps[r.steps.length - 1];
      const fd0 = last.processes[0].fds.find(f => f.fd === 0);
      expect(fd0).toBeDefined();
    });
  });

  // ─── close ───

  describe("close", () => {
    it("close_fd でfdが閉じられる", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "close_fd", fd: 3 },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.processes[0].fds.find(f => f.fd === 3)).toBeUndefined();
    });
  });

  // ─── echo/canonical ───

  describe("PTY設定", () => {
    it("echo を切替できる", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "set_echo", enabled: false },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].echo).toBe(false);
    });

    it("canonical を切替できる", () => {
      const r = executeSimulation(mkOp([
        { op: "posix_openpt" },
        { op: "set_canonical", enabled: false },
      ]));
      const last = r.steps[r.steps.length - 1];
      expect(last.ptyPairs[0].canonical).toBe(false);
    });
  });

  // ─── simulate ───

  describe("simulate", () => {
    it("複数操作が実行される", () => {
      const r = simulate([
        mkOp([{ op: "posix_openpt" }]),
        mkOp([{ op: "posix_openpt" }]),
      ]);
      expect(r.steps.length).toBe(2);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.steps.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
