/* UNIX セマフォ シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, executeSimulation,
  defaultConfig, fifoConfig,
} from "../semaphore/engine.js";
import { PRESETS } from "../semaphore/presets.js";
import type { SimOp } from "../semaphore/types.js";

describe("Semaphore Engine", () => {
  // ─── 基本操作 ───

  describe("基本操作", () => {
    it("sem_init でセマフォが作成される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 3 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const sem = lastTick.semaphores.find(s => s.name === "s");
      expect(sem).toBeDefined();
      expect(sem!.value).toBe(3);
      expect(sem!.type).toBe("counting");
    });

    it("sem_wait でセマフォ値がデクリメントされる", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 2 },
          { op: "sem_wait", name: "s" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const sem = lastTick.semaphores.find(s => s.name === "s");
      expect(sem!.value).toBe(1);
    });

    it("sem_post でセマフォ値がインクリメントされる", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 0 },
          { op: "sem_post", name: "s" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const sem = lastTick.semaphores.find(s => s.name === "s");
      expect(sem!.value).toBe(1);
    });

    it("sem_getvalue で値を取得できる", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 5 },
          { op: "sem_getvalue", name: "s", into: "val" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const main = lastTick.processes.find(p => p.pid === 0);
      expect(main!.locals["val"]).toBe(5);
    });
  });

  // ─── バイナリセマフォ ───

  describe("バイナリセマフォ", () => {
    it("バイナリセマフォの値が0か1に制限される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "b", value: 5, type: "binary" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const sem = lastTick.semaphores.find(s => s.name === "b");
      expect(sem!.value).toBe(1);
      expect(sem!.type).toBe("binary");
    });

    it("バイナリセマフォのpostで値が1を超えない", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "b", value: 1, type: "binary" },
          { op: "sem_post", name: "b" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const sem = lastTick.semaphores.find(s => s.name === "b");
      expect(sem!.value).toBe(1);
    });
  });

  // ─── ブロック＆ウェイクアップ ───

  describe("ブロック＆ウェイクアップ", () => {
    it("sem_wait で value=0 のときブロックされる", () => {
      const op: SimOp = {
        type: "execute", config: { ...defaultConfig(), timeSlice: 1 },
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 0 },
          { op: "create", name: "waiter", instructions: [
            { op: "sem_wait", name: "s" },
            { op: "exit" },
          ]},
          { op: "create", name: "poster", instructions: [
            { op: "sleep", ticks: 3 },
            { op: "sem_post", name: "s" },
            { op: "exit" },
          ]},
          { op: "join", pid: 1 },
          { op: "join", pid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "sem_block")).toBe(true);
      expect(result.events.some(e => e.type === "sem_wakeup")).toBe(true);
      expect(result.deadlockDetected).toBe(false);
    });

    it("sem_post で待ちプロセスが起床する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 0 },
          { op: "create", name: "w", instructions: [
            { op: "sem_wait", name: "s" },
            { op: "exit" },
          ]},
          { op: "sleep", ticks: 2 },
          { op: "sem_post", name: "s" },
          { op: "join", pid: 1 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "sem_wakeup")).toBe(true);
      expect(result.deadlockDetected).toBe(false);
    });
  });

  // ─── sem_trywait ───

  describe("sem_trywait", () => {
    it("成功時に値がデクリメントされる", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 1 },
          { op: "sem_trywait", name: "s" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const sem = lastTick.semaphores.find(s => s.name === "s");
      expect(sem!.value).toBe(0);
    });

    it("失敗時にブロックせずEAGAINを返す", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 0 },
          { op: "sem_trywait", name: "s" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "sem_trywait_fail")).toBe(true);
      expect(result.deadlockDetected).toBe(false);
      const lastTick = result.ticks[result.ticks.length - 1];
      const main = lastTick.processes.find(p => p.pid === 0);
      expect(main!.locals["_trywait_result"]).toBe(-1);
    });
  });

  // ─── sem_timedwait ───

  describe("sem_timedwait", () => {
    it("タイムアウトでブロック解除される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 0 },
          { op: "create", name: "tw", instructions: [
            { op: "sem_timedwait", name: "s", timeout: 3 },
            { op: "exit" },
          ]},
          { op: "join", pid: 1 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "sem_timedout")).toBe(true);
      expect(result.deadlockDetected).toBe(false);
    });

    it("タイムアウト前にpostされれば正常取得する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "s", value: 0 },
          { op: "create", name: "tw", instructions: [
            { op: "sem_timedwait", name: "s", timeout: 10 },
            { op: "exit" },
          ]},
          { op: "sleep", ticks: 2 },
          { op: "sem_post", name: "s" },
          { op: "join", pid: 1 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "sem_wakeup")).toBe(true);
      expect(result.events.some(e => e.type === "sem_timedout")).toBe(false);
    });
  });

  // ─── 名前付きセマフォ ───

  describe("名前付きセマフォ", () => {
    it("sem_open で名前付きセマフォが作成・共有される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_open", name: "/shared", value: 1 },
          { op: "sem_open", name: "/shared", value: 99 },
          { op: "sem_getvalue", name: "/shared", into: "v" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const main = lastTick.processes.find(p => p.pid === 0);
      // 2回目のopenは既存を再利用するので値は1のまま
      expect(main!.locals["v"]).toBe(1);
    });
  });

  // ─── sem_destroy ───

  describe("sem_destroy", () => {
    it("セマフォが破棄される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "tmp", value: 1 },
          { op: "sem_destroy", name: "tmp" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      expect(lastTick.semaphores.find(s => s.name === "tmp")).toBeUndefined();
    });
  });

  // ─── デッドロック ───

  describe("デッドロック", () => {
    it("セマフォの循環待ちでデッドロックが検出される", () => {
      const op: SimOp = {
        type: "execute", config: { ...defaultConfig(), timeSlice: 1 },
        sharedVars: [],
        mainInstructions: [
          { op: "sem_init", name: "A", value: 1 },
          { op: "sem_init", name: "B", value: 1 },
          { op: "create", name: "p1", instructions: [
            { op: "sem_wait", name: "A" },
            { op: "sleep", ticks: 3 },
            { op: "sem_wait", name: "B" },
            { op: "exit" },
          ]},
          { op: "create", name: "p2", instructions: [
            { op: "sem_wait", name: "B" },
            { op: "sleep", ticks: 3 },
            { op: "sem_wait", name: "A" },
            { op: "exit" },
          ]},
          { op: "join", pid: 1 },
          { op: "join", pid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.deadlockDetected).toBe(true);
      expect(result.events.some(e => e.type === "deadlock")).toBe(true);
    });
  });

  // ─── 共有変数 ───

  describe("共有変数", () => {
    it("read/write が動作する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [{ name: "x", value: 0 }],
        mainInstructions: [
          { op: "write", varName: "x", value: 42 },
          { op: "read", varName: "x", into: "local" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      expect(lastTick.sharedVars.find(v => v.name === "x")?.value).toBe(42);
    });

    it("increment/decrement が動作する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [{ name: "cnt", value: 10 }],
        mainInstructions: [
          { op: "increment", varName: "cnt" },
          { op: "increment", varName: "cnt" },
          { op: "decrement", varName: "cnt" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      expect(lastTick.sharedVars.find(v => v.name === "cnt")?.value).toBe(11);
    });
  });

  // ─── スケジューラ ───

  describe("スケジューラ", () => {
    it("FIFOスケジューラが動作する", () => {
      const op: SimOp = {
        type: "execute", config: fifoConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "create", name: "a", instructions: [{ op: "exit" }] },
          { op: "join", pid: 1 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.ticks.length).toBeGreaterThan(0);
    });
  });

  // ─── simulate ───

  describe("simulate", () => {
    it("複数操作が実行される", () => {
      const ops: SimOp[] = [
        { type: "execute", config: defaultConfig(), sharedVars: [], mainInstructions: [{ op: "exit" }] },
        { type: "execute", config: defaultConfig(), sharedVars: [], mainInstructions: [{ op: "exit" }] },
      ];
      const r = simulate(ops);
      expect(r.ticks.length).toBeGreaterThan(0);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.ticks.length).toBeGreaterThan(0);
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
