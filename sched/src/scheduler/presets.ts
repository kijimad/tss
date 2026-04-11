import type { ProcessDef, SchedulerConfig } from "./types.js";

export interface Preset {
  name: string;
  description: string;
  config: SchedulerConfig;
  processes: ProcessDef[];
}

const defaultConfig = (algorithm: SchedulerConfig["algorithm"], quantum = 2): SchedulerConfig => ({
  algorithm,
  timeQuantum: quantum,
  mlfqLevels: 3,
  mlfqQuantums: [2, 4, 8],
});

/** 基本的な3プロセスセット */
const basicProcs: ProcessDef[] = [
  { pid: 1, name: "A", arrivalTime: 0, cpuBursts: [5], ioBursts: [], priority: 2 },
  { pid: 2, name: "B", arrivalTime: 1, cpuBursts: [3], ioBursts: [], priority: 1 },
  { pid: 3, name: "C", arrivalTime: 2, cpuBursts: [7], ioBursts: [], priority: 3 },
];

/** I/O付きプロセスセット */
const ioProcs: ProcessDef[] = [
  { pid: 1, name: "CPU集約", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 2 },
  { pid: 2, name: "I/O集約", arrivalTime: 0, cpuBursts: [2, 2, 2], ioBursts: [3, 3], priority: 1 },
  { pid: 3, name: "混合型", arrivalTime: 1, cpuBursts: [3, 4], ioBursts: [2], priority: 3 },
];

export const presets: Preset[] = [
  {
    name: "FCFS: 先着順",
    description: "First Come First Served。到着順にCPUを割り当て。非プリエンプティブ。コンボイ効果を観察",
    config: defaultConfig("fcfs"),
    processes: basicProcs,
  },
  {
    name: "SJF: 最短ジョブ優先",
    description: "Shortest Job First（非プリエンプティブ）。バースト時間が短いプロセスを優先。平均待ち時間が最小",
    config: defaultConfig("sjf"),
    processes: basicProcs,
  },
  {
    name: "SRTF: 最短残余時間優先",
    description: "SJFのプリエンプティブ版。残り実行時間がより短いプロセスが到着すると切り替え",
    config: defaultConfig("srtf"),
    processes: [
      { pid: 1, name: "Long", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 1 },
      { pid: 2, name: "Short", arrivalTime: 2, cpuBursts: [2], ioBursts: [], priority: 1 },
      { pid: 3, name: "Mid", arrivalTime: 3, cpuBursts: [4], ioBursts: [], priority: 1 },
      { pid: 4, name: "Tiny", arrivalTime: 5, cpuBursts: [1], ioBursts: [], priority: 1 },
    ],
  },
  {
    name: "Round Robin (q=2)",
    description: "ラウンドロビン。タイムクォンタム=2で公平にCPU時間を分配。コンテキストスイッチの頻度を観察",
    config: defaultConfig("rr", 2),
    processes: basicProcs,
  },
  {
    name: "Round Robin (q=4)",
    description: "タイムクォンタムを4に増やした場合。スイッチ回数が減るがレスポンスが悪化",
    config: defaultConfig("rr", 4),
    processes: [
      { pid: 1, name: "A", arrivalTime: 0, cpuBursts: [6], ioBursts: [], priority: 1 },
      { pid: 2, name: "B", arrivalTime: 0, cpuBursts: [4], ioBursts: [], priority: 1 },
      { pid: 3, name: "C", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 1 },
      { pid: 4, name: "D", arrivalTime: 0, cpuBursts: [2], ioBursts: [], priority: 1 },
    ],
  },
  {
    name: "優先度（非プリエンプティブ）",
    description: "優先度が高い（数値が小さい）プロセスを優先。飢餓問題を観察",
    config: defaultConfig("priority"),
    processes: [
      { pid: 1, name: "低優先", arrivalTime: 0, cpuBursts: [6], ioBursts: [], priority: 5 },
      { pid: 2, name: "高優先", arrivalTime: 1, cpuBursts: [3], ioBursts: [], priority: 1 },
      { pid: 3, name: "中優先", arrivalTime: 2, cpuBursts: [4], ioBursts: [], priority: 3 },
      { pid: 4, name: "最高優先", arrivalTime: 3, cpuBursts: [2], ioBursts: [], priority: 0 },
    ],
  },
  {
    name: "優先度（プリエンプティブ）",
    description: "プリエンプティブ優先度。高優先度プロセスが到着すると即座に切り替え",
    config: defaultConfig("priority_pre"),
    processes: [
      { pid: 1, name: "低優先", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 5 },
      { pid: 2, name: "高優先", arrivalTime: 3, cpuBursts: [3], ioBursts: [], priority: 1 },
      { pid: 3, name: "最高", arrivalTime: 5, cpuBursts: [2], ioBursts: [], priority: 0 },
    ],
  },
  {
    name: "MLFQ: マルチレベルFBキュー",
    description: "3レベルキュー（q=2,4,8）。CPU使用量が多いプロセスは低優先度キューへ降格",
    config: defaultConfig("mlfq", 2),
    processes: [
      { pid: 1, name: "対話型", arrivalTime: 0, cpuBursts: [1, 1, 1, 1], ioBursts: [3, 3, 3], priority: 1 },
      { pid: 2, name: "バッチ", arrivalTime: 0, cpuBursts: [12], ioBursts: [], priority: 1 },
      { pid: 3, name: "混合", arrivalTime: 1, cpuBursts: [3, 3], ioBursts: [2], priority: 1 },
    ],
  },
  {
    name: "I/Oバースト混在",
    description: "CPU集約型とI/O集約型のプロセスが混在。I/O待ちによるCPU利用率の変化",
    config: defaultConfig("rr", 3),
    processes: ioProcs,
  },
  {
    name: "同時到着比較用",
    description: "全プロセスが同時到着。アルゴリズム間の比較に最適な条件",
    config: defaultConfig("rr", 2),
    processes: [
      { pid: 1, name: "P1", arrivalTime: 0, cpuBursts: [10], ioBursts: [], priority: 3 },
      { pid: 2, name: "P2", arrivalTime: 0, cpuBursts: [5], ioBursts: [], priority: 1 },
      { pid: 3, name: "P3", arrivalTime: 0, cpuBursts: [8], ioBursts: [], priority: 2 },
      { pid: 4, name: "P4", arrivalTime: 0, cpuBursts: [3], ioBursts: [], priority: 4 },
    ],
  },
];
