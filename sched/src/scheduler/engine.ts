/**
 * スケジューラシミュレーションエンジン
 *
 * このモジュールはCPUスケジューリングの離散時間シミュレーションを実行する。
 * 各tick（時間単位）ごとに以下の処理を順に実行する：
 *   1. プロセス到着処理（レディキューへの追加）
 *   2. I/O完了チェック（blocked → readyへの状態遷移）
 *   3. スケジューリング判断（次に実行するプロセスの選択）
 *   4. ディスパッチ（選択されたプロセスのCPU割り当て）
 *   5. 実行（1tick分の進行とバースト完了・タイムスライス満了の判定）
 *
 * サポートするアルゴリズム：FCFS, SJF, SRTF, RR, Priority, Priority(Preemptive), MLFQ
 */

import type {
  ProcessDef,
  ProcessRuntime,
  SchedulerConfig,
  TimelineEvent,
  GanttEntry,
  ProcessStats,
  SimulationResult,
} from "./types.js";

/**
 * プロセスのランタイム状態を初期化する
 *
 * プロセス定義からシミュレーション用のランタイムオブジェクトを生成する。
 * 初期状態はreadyで、最初のCPUバーストの実行を待機している。
 */
function initRuntime(def: ProcessDef): ProcessRuntime {
  return {
    def,
    state: "ready",
    burstIndex: 0,
    remainingBurst: def.cpuBursts[0] ?? 0,
    firstRunTime: null,
    finishTime: null,
    waitTime: 0,
    ioCompleteTime: null,
    queueLevel: 0,
    sliceUsed: 0,
  };
}

/** スケジューリングシミュレーション実行 */
export function runScheduler(
  processes: ProcessDef[],
  config: SchedulerConfig
): SimulationResult {
  const events: TimelineEvent[] = [];
  const gantt: GanttEntry[] = [];
  const procs = new Map<number, ProcessRuntime>();

  // まだ到着していないプロセス
  const pending = [...processes].sort((a, b) => a.arrivalTime - b.arrivalTime);
  // レディキュー
  let readyQueue: number[] = [];
  // MLFQの複数レベルキュー
  const mlfqQueues: number[][] = Array.from({ length: config.mlfqLevels }, () => []);
  // 現在CPUで実行中のプロセス
  let runningPid: number | null = null;
  let currentGanttStart = 0;
  let time = 0;
  let idleTime = 0;
  const maxTime = 500; // 無限ループ防止

  while (time < maxTime) {
    // 1. 到着処理
    while (pending.length > 0 && pending[0]!.arrivalTime <= time) {
      const def = pending.shift()!;
      const rt = initRuntime(def);
      procs.set(def.pid, rt);
      if (config.algorithm === "mlfq") {
        mlfqQueues[0]!.push(def.pid);
      } else {
        readyQueue.push(def.pid);
      }
      events.push({ time, type: "arrive", pid: def.pid, description: `P${def.pid}(${def.name}) 到着` });
    }

    // 2. I/O完了チェック
    for (const [pid, rt] of procs) {
      if (rt.state === "blocked" && rt.ioCompleteTime !== null && rt.ioCompleteTime <= time) {
        rt.state = "ready";
        rt.ioCompleteTime = null;
        rt.burstIndex++;
        rt.remainingBurst = rt.def.cpuBursts[rt.burstIndex] ?? 0;
        if (config.algorithm === "mlfq") {
          mlfqQueues[rt.queueLevel]!.push(pid);
        } else {
          readyQueue.push(pid);
        }
        events.push({ time, type: "io_complete", pid, description: `P${pid} I/O完了 → レディキュー` });
      }
    }

    // 3. スケジューリング判断
    const nextPid = selectNext(config, readyQueue, mlfqQueues, procs, runningPid);

    // プリエンプションチェック
    if (runningPid !== null && nextPid !== runningPid && nextPid !== null) {
      const rt = procs.get(runningPid)!;
      if (rt.state === "running") {
        rt.state = "ready";
        rt.sliceUsed = 0;
        if (config.algorithm === "mlfq") {
          mlfqQueues[rt.queueLevel]!.push(runningPid);
        } else {
          readyQueue.push(runningPid);
        }
        events.push({ time, type: "preempt", pid: runningPid, description: `P${runningPid} プリエンプション` });
      }
      // ガントチャートを閉じる
      if (currentGanttStart < time) {
        gantt.push({ pid: runningPid, name: procs.get(runningPid)!.def.name, start: currentGanttStart, end: time });
      }
      runningPid = null;
    }

    // 4. ディスパッチ
    if (runningPid === null && nextPid !== null) {
      // コンテキストスイッチ
      events.push({ time, type: "context_switch", pid: nextPid, description: `コンテキストスイッチ → P${nextPid}` });

      runningPid = nextPid;
      const rt = procs.get(nextPid)!;
      rt.state = "running";
      rt.sliceUsed = 0;
      // レディキューから除去
      if (config.algorithm === "mlfq") {
        const q = mlfqQueues[rt.queueLevel]!;
        const idx = q.indexOf(nextPid);
        if (idx >= 0) q.splice(idx, 1);
      } else {
        readyQueue = readyQueue.filter((p) => p !== nextPid);
      }
      if (rt.firstRunTime === null) rt.firstRunTime = time;
      currentGanttStart = time;
      events.push({ time, type: "dispatch", pid: nextPid, description: `P${nextPid}(${rt.def.name}) ディスパッチ` });
    }

    // 5. 実行 or アイドル
    if (runningPid !== null) {
      const rt = procs.get(runningPid)!;
      rt.remainingBurst--;
      rt.sliceUsed++;

      // バースト完了
      if (rt.remainingBurst <= 0) {
        // 次のI/Oバーストがあるか
        const ioIndex = rt.burstIndex;
        const ioBurst = rt.def.ioBursts[ioIndex];
        if (ioBurst !== undefined && ioBurst > 0) {
          // I/Oブロック
          rt.state = "blocked";
          rt.ioCompleteTime = time + 1 + ioBurst;
          gantt.push({ pid: runningPid, name: rt.def.name, start: currentGanttStart, end: time + 1 });
          events.push({ time: time + 1, type: "block_io", pid: runningPid, description: `P${runningPid} I/Oブロック (${ioBurst}tick)` });
          runningPid = null;
        } else if ((rt.burstIndex + 1) < rt.def.cpuBursts.length) {
          // 次のCPUバースト（I/Oなし）
          rt.burstIndex++;
          rt.remainingBurst = rt.def.cpuBursts[rt.burstIndex] ?? 0;
        } else {
          // プロセス終了
          rt.state = "terminated";
          rt.finishTime = time + 1;
          gantt.push({ pid: runningPid, name: rt.def.name, start: currentGanttStart, end: time + 1 });
          events.push({ time: time + 1, type: "terminate", pid: runningPid, description: `P${runningPid}(${rt.def.name}) 終了` });
          runningPid = null;
        }
      } else {
        // タイムスライス消費チェック（RR, MLFQ）
        const quantum = config.algorithm === "mlfq"
          ? (config.mlfqQuantums[rt.queueLevel] ?? config.timeQuantum)
          : config.timeQuantum;

        if ((config.algorithm === "rr" || config.algorithm === "mlfq") && rt.sliceUsed >= quantum) {
          // タイムスライス満了 → プリエンプション
          rt.state = "ready";
          gantt.push({ pid: runningPid, name: rt.def.name, start: currentGanttStart, end: time + 1 });
          events.push({ time: time + 1, type: "preempt", pid: runningPid, description: `P${runningPid} タイムスライス満了 (quantum=${quantum})` });

          if (config.algorithm === "mlfq" && rt.queueLevel < config.mlfqLevels - 1) {
            rt.queueLevel++;
            events.push({ time: time + 1, type: "queue_demote", pid: runningPid, description: `P${runningPid} キュー降格 → レベル${rt.queueLevel}` });
          }

          if (config.algorithm === "mlfq") {
            mlfqQueues[rt.queueLevel]!.push(runningPid);
          } else {
            readyQueue.push(runningPid);
          }
          rt.sliceUsed = 0;
          runningPid = null;
        }
      }
    } else {
      // CPUアイドル
      const hasWork = pending.length > 0 ||
        [...procs.values()].some((p) => p.state === "ready" || p.state === "blocked");
      if (!hasWork) break;
      idleTime++;
      if (gantt.length === 0 || gantt[gantt.length - 1]!.pid !== null) {
        gantt.push({ pid: null, name: "idle", start: time, end: time + 1 });
      } else {
        gantt[gantt.length - 1]!.end = time + 1;
      }
    }

    // レディキューの待ち時間加算
    for (const [pid, rt] of procs) {
      if (rt.state === "ready" && pid !== runningPid) {
        rt.waitTime++;
      }
    }

    time++;
  }

  // 最後のガントチャートを閉じる
  if (runningPid !== null && currentGanttStart < time) {
    gantt.push({ pid: runningPid, name: procs.get(runningPid)!.def.name, start: currentGanttStart, end: time });
  }

  // 統計計算
  const processStats = calcStats(processes, procs);
  const totalTime = time;
  const busyTime = totalTime - idleTime;
  const cpuUtilization = totalTime > 0 ? (busyTime / totalTime) * 100 : 0;

  return {
    algorithm: config.algorithm,
    config,
    gantt,
    events,
    processStats,
    avgTurnaround: avg(processStats.map((s) => s.turnaroundTime)),
    avgWait: avg(processStats.map((s) => s.waitTime)),
    avgResponse: avg(processStats.map((s) => s.responseTime)),
    cpuUtilization,
    totalTime,
  };
}

/** 次に実行するプロセスを選択 */
function selectNext(
  config: SchedulerConfig,
  readyQueue: number[],
  mlfqQueues: number[][],
  procs: Map<number, ProcessRuntime>,
  runningPid: number | null
): number | null {
  const algo = config.algorithm;

  if (algo === "mlfq") {
    // MLFQは高優先度キューから順に探す
    for (const q of mlfqQueues) {
      if (q.length > 0) return q[0]!;
    }
    return null;
  }

  if (readyQueue.length === 0) return runningPid;

  switch (algo) {
    case "fcfs":
    case "rr":
      return readyQueue[0] ?? null;

    case "sjf": {
      // 非プリエンプティブ: 実行中ならそのまま
      if (runningPid !== null && procs.get(runningPid)?.state === "running") return runningPid;
      return shortest(readyQueue, procs);
    }

    case "srtf": {
      // プリエンプティブ: 残り時間が最短のものを選ぶ
      const candidates = runningPid !== null && procs.get(runningPid)?.state === "running"
        ? [runningPid, ...readyQueue]
        : [...readyQueue];
      return shortest(candidates, procs);
    }

    case "priority": {
      if (runningPid !== null && procs.get(runningPid)?.state === "running") return runningPid;
      return highestPriority(readyQueue, procs);
    }

    case "priority_pre": {
      const candidates = runningPid !== null && procs.get(runningPid)?.state === "running"
        ? [runningPid, ...readyQueue]
        : [...readyQueue];
      return highestPriority(candidates, procs);
    }

    default:
      return readyQueue[0] ?? null;
  }
}

/** 残り時間最短のプロセスを返す */
function shortest(pids: number[], procs: Map<number, ProcessRuntime>): number | null {
  let best: number | null = null;
  let bestRemaining = Infinity;
  for (const pid of pids) {
    const rt = procs.get(pid);
    if (rt && rt.remainingBurst < bestRemaining) {
      bestRemaining = rt.remainingBurst;
      best = pid;
    }
  }
  return best;
}

/** 最高優先度（最小値）のプロセスを返す */
function highestPriority(pids: number[], procs: Map<number, ProcessRuntime>): number | null {
  let best: number | null = null;
  let bestPri = Infinity;
  for (const pid of pids) {
    const rt = procs.get(pid);
    if (rt && rt.def.priority < bestPri) {
      bestPri = rt.def.priority;
      best = pid;
    }
  }
  return best;
}

/** プロセス統計を計算 */
function calcStats(
  defs: ProcessDef[],
  procs: Map<number, ProcessRuntime>
): ProcessStats[] {
  return defs.map((def) => {
    const rt = procs.get(def.pid);
    const finish = rt?.finishTime ?? 0;
    const turnaround = finish - def.arrivalTime;
    const wait = rt?.waitTime ?? 0;
    const response = (rt?.firstRunTime ?? def.arrivalTime) - def.arrivalTime;
    return {
      pid: def.pid,
      name: def.name,
      arrivalTime: def.arrivalTime,
      finishTime: finish,
      turnaroundTime: turnaround,
      waitTime: wait,
      responseTime: response,
    };
  });
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
