/* UNIX スレッド シミュレーター プリセット */

import type { Preset, SimOp, ThreadInstr } from "./types.js";
import { defaultConfig, fifoConfig } from "./engine.js";

export const PRESETS: Preset[] = [
  {
    name: "基本スレッド生成",
    description: "pthread_createとpthread_joinの基本動作",
    build: (): SimOp[] => [{
      type: "execute", config: defaultConfig(),
      sharedVars: [{ name: "result", value: 0 }],
      mainInstructions: [
        { op: "comment", text: "── メインスレッド開始 ──" },
        { op: "create", name: "worker_1", instructions: [
          { op: "comment", text: "── worker_1: 計算実行 ──" },
          { op: "write", varName: "result", value: 42 },
          { op: "exit", code: 0 },
        ]},
        { op: "create", name: "worker_2", instructions: [
          { op: "comment", text: "── worker_2: 計算実行 ──" },
          { op: "read", varName: "result", into: "val" },
          { op: "exit", code: 0 },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "comment", text: "── 全スレッド完了 ──" },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "Mutex によるカウンタ保護",
    description: "排他制御でレースコンディションを防止",
    build: (): SimOp[] => [{
      type: "execute", config: { ...defaultConfig(), timeSlice: 2 },
      sharedVars: [{ name: "counter", value: 0 }],
      mainInstructions: [
        { op: "mutex_init", id: "mtx" },
        ...createCounterWorkers("mtx", 3),
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "join", tid: 3 },
        { op: "read", varName: "counter", into: "final" },
        { op: "comment", text: "── counter は正しく 3 のはず ──" },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "レースコンディション（Mutexなし）",
    description: "Mutex無しで共有変数を操作 → 結果が不正になる",
    build: (): SimOp[] => [{
      type: "execute", config: { ...defaultConfig(), timeSlice: 1 },
      sharedVars: [{ name: "counter", value: 0 }],
      mainInstructions: [
        ...createUnsafeCounterWorkers(3),
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "join", tid: 3 },
        { op: "read", varName: "counter", into: "final" },
        { op: "comment", text: "── counter は 3 未満になる可能性 ──" },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "デッドロック",
    description: "2つのMutexの循環待ちによるデッドロック",
    build: (): SimOp[] => [{
      type: "execute", config: { ...defaultConfig(), timeSlice: 2 },
      sharedVars: [],
      mainInstructions: [
        { op: "mutex_init", id: "mtx_A" },
        { op: "mutex_init", id: "mtx_B" },
        { op: "create", name: "thread_1", instructions: [
          { op: "mutex_lock", id: "mtx_A" },
          { op: "comment", text: "── T1: mtx_A保持、mtx_Bを要求 ──" },
          { op: "sleep", ticks: 1 },
          { op: "mutex_lock", id: "mtx_B" },
          { op: "mutex_unlock", id: "mtx_B" },
          { op: "mutex_unlock", id: "mtx_A" },
          { op: "exit" },
        ]},
        { op: "create", name: "thread_2", instructions: [
          { op: "mutex_lock", id: "mtx_B" },
          { op: "comment", text: "── T2: mtx_B保持、mtx_Aを要求 ──" },
          { op: "sleep", ticks: 1 },
          { op: "mutex_lock", id: "mtx_A" },
          { op: "mutex_unlock", id: "mtx_A" },
          { op: "mutex_unlock", id: "mtx_B" },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "条件変数（Producer-Consumer）",
    description: "条件変数で生産者-消費者パターンを実装",
    build: (): SimOp[] => [{
      type: "execute", config: defaultConfig(),
      sharedVars: [{ name: "buffer", value: 0 }, { name: "ready", value: 0 }],
      mainInstructions: [
        { op: "mutex_init", id: "buf_mtx" },
        { op: "cond_init", id: "buf_cond", mutexId: "buf_mtx" },
        { op: "create", name: "producer", instructions: [
          { op: "mutex_lock", id: "buf_mtx" },
          { op: "write", varName: "buffer", value: 99 },
          { op: "write", varName: "ready", value: 1 },
          { op: "comment", text: "── データ準備完了、consumerに通知 ──" },
          { op: "cond_signal", id: "buf_cond" },
          { op: "mutex_unlock", id: "buf_mtx" },
          { op: "exit" },
        ]},
        { op: "create", name: "consumer", instructions: [
          { op: "mutex_lock", id: "buf_mtx" },
          { op: "comment", text: "── データ待ち ──" },
          { op: "cond_wait", id: "buf_cond" },
          { op: "read", varName: "buffer", into: "data" },
          { op: "comment", text: "── データ受信 ──" },
          { op: "mutex_unlock", id: "buf_mtx" },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "Read-Write ロック",
    description: "複数の読み取りスレッドと単一の書き込みスレッド",
    build: (): SimOp[] => [{
      type: "execute", config: defaultConfig(),
      sharedVars: [{ name: "data", value: 100 }],
      mainInstructions: [
        { op: "rwlock_init", id: "rw" },
        { op: "create", name: "reader_1", instructions: [
          { op: "rwlock_rdlock", id: "rw" },
          { op: "read", varName: "data", into: "val" },
          { op: "comment", text: "── 読取中... ──" },
          { op: "rwlock_unlock", id: "rw" },
          { op: "exit" },
        ]},
        { op: "create", name: "reader_2", instructions: [
          { op: "rwlock_rdlock", id: "rw" },
          { op: "read", varName: "data", into: "val" },
          { op: "comment", text: "── 読取中... ──" },
          { op: "rwlock_unlock", id: "rw" },
          { op: "exit" },
        ]},
        { op: "create", name: "writer", instructions: [
          { op: "rwlock_wrlock", id: "rw" },
          { op: "write", varName: "data", value: 200 },
          { op: "comment", text: "── 書込中... ──" },
          { op: "rwlock_unlock", id: "rw" },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "join", tid: 3 },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "バリア同期",
    description: "全スレッドが到着するまで待機するバリア",
    build: (): SimOp[] => [{
      type: "execute", config: defaultConfig(),
      sharedVars: [{ name: "phase", value: 0 }],
      mainInstructions: [
        { op: "barrier_init", id: "sync_point", count: 3 },
        { op: "create", name: "worker_A", instructions: [
          { op: "comment", text: "── フェーズ1実行 ──" },
          { op: "write", varName: "phase", value: 1 },
          { op: "barrier_wait", id: "sync_point" },
          { op: "comment", text: "── バリア通過、フェーズ2へ ──" },
          { op: "exit" },
        ]},
        { op: "create", name: "worker_B", instructions: [
          { op: "comment", text: "── フェーズ1実行 ──" },
          { op: "sleep", ticks: 2 },
          { op: "barrier_wait", id: "sync_point" },
          { op: "comment", text: "── バリア通過、フェーズ2へ ──" },
          { op: "exit" },
        ]},
        { op: "create", name: "worker_C", instructions: [
          { op: "comment", text: "── フェーズ1実行 ──" },
          { op: "sleep", ticks: 4 },
          { op: "barrier_wait", id: "sync_point" },
          { op: "comment", text: "── バリア通過、フェーズ2へ ──" },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "join", tid: 3 },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "スケジューラ比較（Round Robin）",
    description: "ラウンドロビンスケジューリングでのスレッド実行順序",
    build: (): SimOp[] => [{
      type: "execute", config: { scheduler: "round_robin", timeSlice: 2, maxTicks: 100 },
      sharedVars: [{ name: "log", value: 0 }],
      mainInstructions: [
        { op: "create", name: "task_A", instructions: [
          { op: "write", varName: "log", value: 1 },
          { op: "write", varName: "log", value: 1 },
          { op: "write", varName: "log", value: 1 },
          { op: "exit" },
        ]},
        { op: "create", name: "task_B", instructions: [
          { op: "write", varName: "log", value: 2 },
          { op: "write", varName: "log", value: 2 },
          { op: "write", varName: "log", value: 2 },
          { op: "exit" },
        ]},
        { op: "create", name: "task_C", instructions: [
          { op: "write", varName: "log", value: 3 },
          { op: "write", varName: "log", value: 3 },
          { op: "write", varName: "log", value: 3 },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "join", tid: 3 },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "再帰Mutex",
    description: "同一スレッドが同じMutexを複数回ロック",
    build: (): SimOp[] => [{
      type: "execute", config: defaultConfig(),
      sharedVars: [{ name: "depth", value: 0 }],
      mainInstructions: [
        { op: "mutex_init", id: "rec_mtx", recursive: true },
        { op: "create", name: "recursive_worker", instructions: [
          { op: "mutex_lock", id: "rec_mtx" },
          { op: "write", varName: "depth", value: 1 },
          { op: "mutex_lock", id: "rec_mtx" },
          { op: "write", varName: "depth", value: 2 },
          { op: "mutex_lock", id: "rec_mtx" },
          { op: "write", varName: "depth", value: 3 },
          { op: "comment", text: "── 3回ロック → 3回アンロック必要 ──" },
          { op: "mutex_unlock", id: "rec_mtx" },
          { op: "mutex_unlock", id: "rec_mtx" },
          { op: "mutex_unlock", id: "rec_mtx" },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "exit" },
      ],
    }],
  },
  {
    name: "FIFO スケジューリング",
    description: "先着順でスレッドを実行（プリエンプションなし）",
    build: (): SimOp[] => [{
      type: "execute", config: fifoConfig(),
      sharedVars: [{ name: "order", value: 0 }],
      mainInstructions: [
        { op: "create", name: "first", instructions: [
          { op: "write", varName: "order", value: 1 },
          { op: "comment", text: "── 最初に完了 ──" },
          { op: "exit" },
        ]},
        { op: "create", name: "second", instructions: [
          { op: "write", varName: "order", value: 2 },
          { op: "comment", text: "── 2番目に完了 ──" },
          { op: "exit" },
        ]},
        { op: "create", name: "third", instructions: [
          { op: "write", varName: "order", value: 3 },
          { op: "comment", text: "── 3番目に完了 ──" },
          { op: "exit" },
        ]},
        { op: "join", tid: 1 },
        { op: "join", tid: 2 },
        { op: "join", tid: 3 },
        { op: "exit" },
      ],
    }],
  },
];

/** Mutex保護付きカウンタワーカーを生成 */
function createCounterWorkers(mutexId: string, count: number): ThreadInstr[] {
  const instrs: ThreadInstr[] = [];
  for (let i = 0; i < count; i++) {
    instrs.push({
      op: "create", name: `counter_${i + 1}`, instructions: [
        { op: "mutex_lock", id: mutexId },
        { op: "increment", varName: "counter" },
        { op: "mutex_unlock", id: mutexId },
        { op: "exit" },
      ],
    });
  }
  return instrs;
}

/** Mutex保護なしカウンタワーカーを生成 */
function createUnsafeCounterWorkers(count: number): ThreadInstr[] {
  const instrs: ThreadInstr[] = [];
  for (let i = 0; i < count; i++) {
    instrs.push({
      op: "create", name: `unsafe_${i + 1}`, instructions: [
        { op: "increment", varName: "counter" },
        { op: "exit" },
      ],
    });
  }
  return instrs;
}
