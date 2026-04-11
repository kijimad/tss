import { describe, it, expect } from "vitest";
import { runScheduler, presets } from "../scheduler/index.js";
import type { ProcessDef, SchedulerConfig } from "../scheduler/index.js";

const cfg = (algo: SchedulerConfig["algorithm"], quantum = 2): SchedulerConfig => ({
  algorithm: algo, timeQuantum: quantum, mlfqLevels: 3, mlfqQuantums: [2, 4, 8],
});

const simpleProcs: ProcessDef[] = [
  { pid: 1, name: "A", arrivalTime: 0, cpuBursts: [5], ioBursts: [], priority: 2 },
  { pid: 2, name: "B", arrivalTime: 1, cpuBursts: [3], ioBursts: [], priority: 1 },
  { pid: 3, name: "C", arrivalTime: 2, cpuBursts: [2], ioBursts: [], priority: 3 },
];

// ===== FCFS =====
describe("FCFS", () => {
  it("到着順にプロセスを実行する", () => {
    const result = runScheduler(simpleProcs, cfg("fcfs"));
    // Aが最初にディスパッチされる（先着順）
    const firstDispatch = result.events.find((e) => e.type === "dispatch");
    expect(firstDispatch?.pid).toBe(1);
    expect(result.processStats.every((s) => s.finishTime > 0)).toBe(true);
  });

  it("全プロセスが終了する", () => {
    const result = runScheduler(simpleProcs, cfg("fcfs"));
    expect(result.processStats.every((s) => s.finishTime > 0)).toBe(true);
  });

  it("ガントチャートが生成される", () => {
    const result = runScheduler(simpleProcs, cfg("fcfs"));
    expect(result.gantt.length).toBeGreaterThan(0);
  });
});

// ===== SJF =====
describe("SJF", () => {
  it("短いジョブが先に実行される（同時到着時）", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "Long", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 1 },
      { pid: 2, name: "Short", arrivalTime: 0, cpuBursts: [2], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("sjf"));
    const shortFinish = result.processStats.find((s) => s.pid === 2)!.finishTime;
    const longFinish = result.processStats.find((s) => s.pid === 1)!.finishTime;
    expect(shortFinish).toBeLessThan(longFinish);
  });

  it("非プリエンプティブ: 実行中のプロセスは中断されない", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "First", arrivalTime: 0, cpuBursts: [5], ioBursts: [], priority: 1 },
      { pid: 2, name: "Shorter", arrivalTime: 1, cpuBursts: [2], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("sjf"));
    // Firstが先に完了（非プリエンプティブ）
    expect(result.processStats.find((s) => s.pid === 1)!.finishTime).toBe(5);
  });
});

// ===== SRTF =====
describe("SRTF", () => {
  it("残り時間が短いプロセスにプリエンプションする", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "Long", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 1 },
      { pid: 2, name: "Short", arrivalTime: 2, cpuBursts: [2], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("srtf"));
    // Shortが先に完了（プリエンプション）
    const shortFinish = result.processStats.find((s) => s.pid === 2)!.finishTime;
    expect(shortFinish).toBe(4); // 到着2 + 実行2
  });
});

// ===== Round Robin =====
describe("Round Robin", () => {
  it("タイムクォンタムで交互に実行する", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "A", arrivalTime: 0, cpuBursts: [4], ioBursts: [], priority: 1 },
      { pid: 2, name: "B", arrivalTime: 0, cpuBursts: [4], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("rr", 2));
    // A→Bの交互パターンを確認
    const pids = result.gantt.map((g) => g.pid);
    expect(pids[0]).toBe(1);
    expect(pids[1]).toBe(2);
    expect(result.events.some((e) => e.type === "preempt")).toBe(true);
  });

  it("タイムクォンタムより短いプロセスは途中で終了する", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "Short", arrivalTime: 0, cpuBursts: [1], ioBursts: [], priority: 1 },
      { pid: 2, name: "Long", arrivalTime: 0, cpuBursts: [5], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("rr", 3));
    expect(result.processStats.find((s) => s.pid === 1)!.finishTime).toBe(1);
  });
});

// ===== 優先度 =====
describe("優先度スケジューリング", () => {
  it("高優先度（小さい値）のプロセスが先に実行される", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "Low", arrivalTime: 0, cpuBursts: [3], ioBursts: [], priority: 5 },
      { pid: 2, name: "High", arrivalTime: 0, cpuBursts: [3], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("priority"));
    const highFinish = result.processStats.find((s) => s.pid === 2)!.finishTime;
    const lowFinish = result.processStats.find((s) => s.pid === 1)!.finishTime;
    expect(highFinish).toBeLessThan(lowFinish);
  });

  it("プリエンプティブ優先度: 高優先度到着で切り替え", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "Low", arrivalTime: 0, cpuBursts: [6], ioBursts: [], priority: 5 },
      { pid: 2, name: "High", arrivalTime: 2, cpuBursts: [3], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("priority_pre"));
    // Highが到着(T=2)後すぐ実行、T=5で終了
    expect(result.processStats.find((s) => s.pid === 2)!.finishTime).toBe(5);
    expect(result.events.some((e) => e.type === "preempt")).toBe(true);
  });
});

// ===== MLFQ =====
describe("MLFQ", () => {
  it("CPU集約型プロセスがキュー降格される", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "Batch", arrivalTime: 0, cpuBursts: [10], ioBursts: [], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("mlfq", 2));
    expect(result.events.some((e) => e.type === "queue_demote")).toBe(true);
  });
});

// ===== I/Oバースト =====
describe("I/Oバースト", () => {
  it("I/Oブロックと完了が正しく処理される", () => {
    const procs: ProcessDef[] = [
      { pid: 1, name: "IO", arrivalTime: 0, cpuBursts: [2, 2], ioBursts: [3], priority: 1 },
    ];
    const result = runScheduler(procs, cfg("fcfs"));
    expect(result.events.some((e) => e.type === "block_io")).toBe(true);
    expect(result.events.some((e) => e.type === "io_complete")).toBe(true);
    expect(result.processStats[0]!.finishTime).toBeGreaterThan(4); // 2 + 3(IO) + 2
  });
});

// ===== 統計 =====
describe("統計計算", () => {
  it("CPU利用率が計算される", () => {
    const result = runScheduler(simpleProcs, cfg("fcfs"));
    expect(result.cpuUtilization).toBeGreaterThan(0);
    expect(result.cpuUtilization).toBeLessThanOrEqual(100);
  });

  it("平均値が正しく計算される", () => {
    const result = runScheduler(simpleProcs, cfg("fcfs"));
    expect(result.avgTurnaround).toBeGreaterThan(0);
    expect(result.avgWait).toBeGreaterThanOrEqual(0);
    expect(result.avgResponse).toBeGreaterThanOrEqual(0);
  });

  it("レスポンスタイムが0以上", () => {
    const result = runScheduler(simpleProcs, cfg("rr", 2));
    for (const s of result.processStats) {
      expect(s.responseTime).toBeGreaterThanOrEqual(0);
    }
  });
});

// ===== プリセット =====
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runScheduler(preset.processes, preset.config);
      expect(result.gantt.length, `${preset.name}: ガントが空`).toBeGreaterThan(0);
      expect(result.totalTime, `${preset.name}: 総時間が0`).toBeGreaterThan(0);
      expect(result.processStats.length, `${preset.name}: 統計が空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });

  it("全プリセットで全プロセスが終了する", () => {
    for (const preset of presets) {
      const result = runScheduler(preset.processes, preset.config);
      for (const s of result.processStats) {
        expect(s.finishTime, `${preset.name}: P${s.pid} が未完了`).toBeGreaterThan(0);
      }
    }
  });
});
