import { describe, it, expect } from "vitest";
import { runSimulation } from "../goconc/engine.js";
import { presets } from "../goconc/presets.js";
import type { SimOp } from "../goconc/types.js";

describe("goroutine", () => {
  it("main goroutineが暗黙的に作成される", () => {
    const result = runSimulation([]);
    expect(result.goroutines.length).toBe(1);
    expect(result.goroutines[0]!.id).toBe(0);
    expect(result.goroutines[0]!.name).toBe("main");
    expect(result.goroutines[0]!.state).toBe("running");
  });

  it("go文でgoroutineが作成される", () => {
    const ops: SimOp[] = [
      { type: "go", id: 1, name: "worker" },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines.length).toBe(2); // main + worker
    expect(result.goroutines[1]!.state).toBe("runnable");
    expect(result.goroutines[1]!.stackSize).toBe(2); // 初期2KB
    expect(result.stats.goroutinesCreated).toBe(2);
  });

  it("goroutine_exitで終了する", () => {
    const ops: SimOp[] = [
      { type: "go", id: 1, name: "worker" },
      { type: "goroutine_exit", goroutineId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines[1]!.state).toBe("dead");
    expect(result.stats.goroutinesExited).toBe(1);
  });
});

describe("unbuffered channel", () => {
  it("unbuffered channelが作成される", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
    ];
    const result = runSimulation(ops);
    expect(result.channels.length).toBe(1);
    expect(result.channels[0]!.capacity).toBe(0);
  });

  it("受信者なしの送信はブロックする", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "go", id: 1, name: "sender" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "data" },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines[1]!.state).toBe("blocked");
  });

  it("送信→受信で同期的にデータが渡る", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "go", id: 1, name: "sender" },
      { type: "go", id: 2, name: "receiver" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "hello" },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.channelSends).toBe(1);
    expect(result.stats.channelRecvs).toBe(1);
  });
});

describe("buffered channel", () => {
  it("バッファに空きがある間は送信がブロックしない", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 2 },
      { type: "go", id: 1, name: "sender" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "a" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "b" },
    ];
    const result = runSimulation(ops);
    expect(result.channels[0]!.buffer).toEqual(["a", "b"]);
    expect(result.goroutines[1]!.state).not.toBe("blocked");
  });

  it("バッファ満杯で送信がブロックする", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 1 },
      { type: "go", id: 1, name: "sender" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "a" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "b" },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines[1]!.state).toBe("blocked");
  });

  it("受信でバッファからデータが取り出される", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 3 },
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "x" },
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "y" },
      { type: "chan_recv", goroutineId: 0, chanId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.channels[0]!.buffer).toEqual(["y"]);
  });
});

describe("channel close", () => {
  it("closeでチャネルがclosedになる", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "chan_close", goroutineId: 0, chanId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.channels[0]!.closed).toBe(true);
  });

  it("closedチャネルへの送信はpanic", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "chan_close", goroutineId: 0, chanId: 1 },
      { type: "go", id: 1, name: "sender" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "x" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "panic")).toBe(true);
  });

  it("closedチャネルからの受信はzero-value", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "chan_close", goroutineId: 0, chanId: 1 },
      { type: "chan_recv", goroutineId: 0, chanId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "chan_recv_closed")).toBe(true);
  });

  it("closeで受信待ちgoroutineが起こされる", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "go", id: 1, name: "waiter" },
      { type: "chan_recv", goroutineId: 1, chanId: 1 },
      { type: "chan_close", goroutineId: 0, chanId: 1 },
    ];
    const result = runSimulation(ops);
    // waiterはunblockされるはず
    expect(result.events.some((e) => e.type === "goroutine_unblock" && e.goroutineId === 1)).toBe(true);
  });
});

describe("select", () => {
  it("readyなケースが選択される", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 1 },
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "x" },
      { type: "select", goroutineId: 0, cases: [{ dir: "recv", chanId: 1 }] },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "select_case")).toBe(true);
  });

  it("全ケースブロックでdefaultが選択される", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "select", goroutineId: 0, cases: [
        { dir: "recv", chanId: 1 },
        { dir: "recv", chanId: 1, isDefault: true },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "select_default")).toBe(true);
  });
});

describe("sync.Mutex", () => {
  it("Lockで排他ロック取得", () => {
    const ops: SimOp[] = [
      { type: "mutex_make", id: 1, name: "mu" },
      { type: "go", id: 1, name: "g1" },
      { type: "mutex_lock", goroutineId: 1, mutexId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.mutexes[0]!.locked).toBe(true);
    expect(result.mutexes[0]!.owner).toBe(1);
  });

  it("ロック済みMutexへのLockはブロック", () => {
    const ops: SimOp[] = [
      { type: "mutex_make", id: 1, name: "mu" },
      { type: "go", id: 1, name: "g1" },
      { type: "go", id: 2, name: "g2" },
      { type: "mutex_lock", goroutineId: 1, mutexId: 1 },
      { type: "mutex_lock", goroutineId: 2, mutexId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines[2]!.state).toBe("blocked");
  });

  it("Unlockで次の待機goroutineにロック移譲", () => {
    const ops: SimOp[] = [
      { type: "mutex_make", id: 1, name: "mu" },
      { type: "go", id: 1, name: "g1" },
      { type: "go", id: 2, name: "g2" },
      { type: "mutex_lock", goroutineId: 1, mutexId: 1 },
      { type: "mutex_lock", goroutineId: 2, mutexId: 1 },
      { type: "mutex_unlock", goroutineId: 1, mutexId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.mutexes[0]!.owner).toBe(2);
  });
});

describe("sync.WaitGroup", () => {
  it("counter=0でWait()は即座に復帰", () => {
    const ops: SimOp[] = [
      { type: "wg_make", id: 1, name: "wg" },
      { type: "wg_wait", goroutineId: 0, wgId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines[0]!.state).not.toBe("blocked");
  });

  it("counter>0でWait()はブロック", () => {
    const ops: SimOp[] = [
      { type: "wg_make", id: 1, name: "wg" },
      { type: "wg_add", wgId: 1, delta: 2 },
      { type: "wg_wait", goroutineId: 0, wgId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.goroutines[0]!.state).toBe("blocked");
  });

  it("Done()でcounter=0になるとWait()が解放される", () => {
    const ops: SimOp[] = [
      { type: "wg_make", id: 1, name: "wg" },
      { type: "wg_add", wgId: 1, delta: 1 },
      { type: "go", id: 1, name: "worker" },
      { type: "wg_wait", goroutineId: 0, wgId: 1 },
      { type: "wg_done", goroutineId: 1, wgId: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "wg_release")).toBe(true);
  });
});

describe("デッドロック検出", () => {
  it("全goroutineブロックでデッドロック検出", () => {
    const ops: SimOp[] = [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "stuck" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.deadlocks).toBe(1);
    expect(result.events.some((e) => e.type === "deadlock")).toBe(true);
  });
});

describe("GOMAXPROCS", () => {
  it("set_gomaxprocsでPが追加される", () => {
    const ops: SimOp[] = [
      { type: "set_gomaxprocs", n: 4 },
    ];
    const result = runSimulation(ops);
    expect(result.processors.length).toBe(4);
    expect(result.threads.length).toBe(4);
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
