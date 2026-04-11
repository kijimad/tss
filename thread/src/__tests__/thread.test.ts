/* UNIX スレッド シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, executeSimulation,
  defaultConfig, fifoConfig,
} from "../thread/engine.js";
import { PRESETS } from "../thread/presets.js";
import type { SimOp } from "../thread/types.js";

describe("Thread Engine", () => {
  // ─── 基本スレッド ───

  describe("基本スレッド操作", () => {
    it("メインスレッドが実行される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "comment", text: "hello" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.ticks.length).toBeGreaterThan(0);
    });

    it("子スレッドが生成される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "create", name: "child", instructions: [{ op: "exit" }] },
          { op: "join", tid: 1 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      // 最終tickでスレッドが2つ存在
      const lastTick = result.ticks[result.ticks.length - 1];
      expect(lastTick.threads.length).toBe(2);
    });

    it("pthread_joinで子スレッドを待機する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [{ name: "val", value: 0 }],
        mainInstructions: [
          { op: "create", name: "worker", instructions: [
            { op: "write", varName: "val", value: 42 },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "read", varName: "val", into: "result" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      // joinイベントが存在する
      expect(result.events.some(e => e.message.includes("待機") || e.message.includes("join"))).toBe(true);
    });
  });

  // ─── Mutex ───

  describe("Mutex", () => {
    it("Mutexのロックとアンロックが機能する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "mutex_init", id: "m1" },
          { op: "mutex_lock", id: "m1" },
          { op: "mutex_unlock", id: "m1" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "lock")).toBe(true);
      expect(result.events.some(e => e.type === "unlock")).toBe(true);
    });

    it("Mutexで競合時にブロックされる", () => {
      const op: SimOp = {
        type: "execute", config: { ...defaultConfig(), timeSlice: 2 },
        sharedVars: [],
        mainInstructions: [
          { op: "mutex_init", id: "m1" },
          { op: "create", name: "t1", instructions: [
            { op: "mutex_lock", id: "m1" },
            { op: "sleep", ticks: 3 },
            { op: "mutex_unlock", id: "m1" },
            { op: "exit" },
          ]},
          { op: "create", name: "t2", instructions: [
            { op: "mutex_lock", id: "m1" },
            { op: "mutex_unlock", id: "m1" },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "wait")).toBe(true);
    });

    it("再帰Mutexが動作する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "mutex_init", id: "rm", recursive: true },
          { op: "mutex_lock", id: "rm" },
          { op: "mutex_lock", id: "rm" },
          { op: "mutex_unlock", id: "rm" },
          { op: "mutex_unlock", id: "rm" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      // デッドロックにならない
      expect(result.deadlockDetected).toBe(false);
    });

    it("mutex_trylockが失敗時にブロックしない", () => {
      const op: SimOp = {
        type: "execute", config: { ...defaultConfig(), timeSlice: 1 },
        sharedVars: [],
        mainInstructions: [
          { op: "mutex_init", id: "m1" },
          { op: "create", name: "holder", instructions: [
            { op: "mutex_lock", id: "m1" },
            { op: "sleep", ticks: 5 },
            { op: "mutex_unlock", id: "m1" },
            { op: "exit" },
          ]},
          { op: "create", name: "trier", instructions: [
            { op: "sleep", ticks: 1 },
            { op: "mutex_trylock", id: "m1" },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.deadlockDetected).toBe(false);
    });
  });

  // ─── デッドロック ───

  describe("デッドロック", () => {
    it("循環待ちでデッドロックが検出される", () => {
      const op: SimOp = {
        type: "execute", config: { ...defaultConfig(), timeSlice: 1 },
        sharedVars: [],
        mainInstructions: [
          { op: "mutex_init", id: "A" },
          { op: "mutex_init", id: "B" },
          { op: "create", name: "t1", instructions: [
            { op: "mutex_lock", id: "A" },
            { op: "sleep", ticks: 3 },
            { op: "mutex_lock", id: "B" },
            { op: "exit" },
          ]},
          { op: "create", name: "t2", instructions: [
            { op: "mutex_lock", id: "B" },
            { op: "sleep", ticks: 3 },
            { op: "mutex_lock", id: "A" },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.deadlockDetected).toBe(true);
      expect(result.events.some(e => e.type === "deadlock")).toBe(true);
    });
  });

  // ─── 条件変数 ───

  describe("条件変数", () => {
    it("cond_signalで待機スレッドが起床する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [{ name: "ready", value: 0 }],
        mainInstructions: [
          { op: "mutex_init", id: "m" },
          { op: "cond_init", id: "cv", mutexId: "m" },
          { op: "create", name: "waiter", instructions: [
            { op: "mutex_lock", id: "m" },
            { op: "cond_wait", id: "cv" },
            { op: "mutex_unlock", id: "m" },
            { op: "exit" },
          ]},
          { op: "create", name: "signaler", instructions: [
            { op: "sleep", ticks: 2 },
            { op: "mutex_lock", id: "m" },
            { op: "cond_signal", id: "cv" },
            { op: "mutex_unlock", id: "m" },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.events.some(e => e.type === "signal")).toBe(true);
      expect(result.deadlockDetected).toBe(false);
    });
  });

  // ─── RwLock ───

  describe("RwLock", () => {
    it("複数の読取が同時に可能", () => {
      const op: SimOp = {
        type: "execute", config: { ...defaultConfig(), timeSlice: 1 },
        sharedVars: [{ name: "data", value: 0 }],
        mainInstructions: [
          { op: "rwlock_init", id: "rw" },
          { op: "create", name: "r1", instructions: [
            { op: "rwlock_rdlock", id: "rw" },
            { op: "read", varName: "data", into: "v" },
            { op: "rwlock_unlock", id: "rw" },
            { op: "exit" },
          ]},
          { op: "create", name: "r2", instructions: [
            { op: "rwlock_rdlock", id: "rw" },
            { op: "read", varName: "data", into: "v" },
            { op: "rwlock_unlock", id: "rw" },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.deadlockDetected).toBe(false);
    });
  });

  // ─── バリア ───

  describe("バリア", () => {
    it("全スレッド到着でバリアが解放される", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [],
        mainInstructions: [
          { op: "barrier_init", id: "b", count: 2 },
          { op: "create", name: "w1", instructions: [
            { op: "barrier_wait", id: "b" },
            { op: "exit" },
          ]},
          { op: "create", name: "w2", instructions: [
            { op: "barrier_wait", id: "b" },
            { op: "exit" },
          ]},
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      expect(result.deadlockDetected).toBe(false);
      expect(result.events.some(e => e.message.includes("バリア"))).toBe(true);
    });
  });

  // ─── 共有変数 ───

  describe("共有変数", () => {
    it("read/writeが動作する", () => {
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
      const x = lastTick.sharedVars.find(v => v.name === "x");
      expect(x?.value).toBe(42);
    });

    it("incrementが動作する", () => {
      const op: SimOp = {
        type: "execute", config: defaultConfig(),
        sharedVars: [{ name: "cnt", value: 0 }],
        mainInstructions: [
          { op: "increment", varName: "cnt" },
          { op: "increment", varName: "cnt" },
          { op: "increment", varName: "cnt" },
          { op: "exit" },
        ],
      };
      const result = executeSimulation(op);
      const lastTick = result.ticks[result.ticks.length - 1];
      const cnt = lastTick.sharedVars.find(v => v.name === "cnt");
      expect(cnt?.value).toBe(3);
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
          { op: "create", name: "b", instructions: [{ op: "exit" }] },
          { op: "join", tid: 1 },
          { op: "join", tid: 2 },
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
