/* UNIX セマフォ シミュレーター エンジン */

import type {
  Process, Pid, Semaphore, SharedVar, SemInstr,
  SimConfig, TickResult, SimOp, SimEvent, SimulationResult,
} from "./types.js";

// ─── 状態管理 ───

/** シミュレーション内部状態 */
interface SimState {
  processes: Process[];
  semaphores: Map<string, Semaphore>;
  sharedVars: Map<string, SharedVar>;
  /** プロセスごとの命令列 */
  instrMap: Map<Pid, SemInstr[]>;
  nextPid: Pid;
  tick: number;
  events: SimEvent[];
  /** sleepカウンタ: pid→残りティック */
  sleepCounters: Map<Pid, number>;
  /** timedwaitカウンタ: pid→{sem, remaining} */
  timedWaitCounters: Map<Pid, { sem: string; remaining: number }>;
}

/** 初期状態を作成 */
function createState(op: SimOp): SimState {
  const sharedVars = new Map<string, SharedVar>();
  for (const sv of op.sharedVars) {
    sharedVars.set(sv.name, { name: sv.name, value: sv.value, lastWriter: null, accessLog: [] });
  }

  const mainProc: Process = {
    pid: 0, name: "main", state: "ready",
    pc: 0, cpuTime: 0, waitTime: 0, locals: {},
  };

  const instrMap = new Map<Pid, SemInstr[]>();
  instrMap.set(0, op.mainInstructions);

  return {
    processes: [mainProc], semaphores: new Map(), sharedVars,
    instrMap, nextPid: 1, tick: 0, events: [],
    sleepCounters: new Map(), timedWaitCounters: new Map(),
  };
}

// ─── スケジューラ ───

/** 次に実行するプロセスを選択 */
export function schedule(state: SimState, config: SimConfig): Pid | null {
  const ready = state.processes.filter(p => p.state === "ready");
  if (ready.length === 0) return null;

  switch (config.scheduler) {
    case "round_robin": {
      const running = state.processes.find(p => p.state === "running");
      const lastPid = running?.pid ?? -1;
      const sorted = [...ready].sort((a, b) => a.pid - b.pid);
      const next = sorted.find(p => p.pid > lastPid) ?? sorted[0];
      return next.pid;
    }
    case "fifo": {
      return ready.sort((a, b) => a.pid - b.pid)[0].pid;
    }
  }
}

// ─── 命令実行 ───

/** 1命令を実行 */
function executeInstr(state: SimState, pid: Pid, instr: SemInstr): string {
  const proc = state.processes.find(p => p.pid === pid)!;

  switch (instr.op) {
    case "sem_init": {
      const type = instr.type ?? "counting";
      const value = type === "binary" ? Math.min(instr.value, 1) : instr.value;
      state.semaphores.set(instr.name, {
        name: instr.name, value, initialValue: value, type,
        waitQueue: [], named: false, postCount: 0, waitCount: 0,
      });
      return `sem_init: ${instr.name} (value=${value}, type=${type})`;
    }

    case "sem_open": {
      // 名前付きセマフォ（既存なら再利用）
      if (!state.semaphores.has(instr.name)) {
        state.semaphores.set(instr.name, {
          name: instr.name, value: instr.value, initialValue: instr.value,
          type: "counting", waitQueue: [], named: true, postCount: 0, waitCount: 0,
        });
      }
      return `sem_open: ${instr.name}`;
    }

    case "sem_wait": {
      const sem = state.semaphores.get(instr.name);
      if (!sem) return `セマフォ '${instr.name}' が未初期化`;
      sem.waitCount++;
      if (sem.value > 0) {
        sem.value--;
        state.events.push({ type: "sem_wait", tick: state.tick, message: `P${pid} が ${instr.name} を取得 (value=${sem.value})` });
        return `sem_wait: ${instr.name} (取得, value=${sem.value})`;
      }
      // ブロック
      sem.waitQueue.push(pid);
      proc.state = "blocked";
      proc.blockReason = "sem_wait";
      proc.blockDetail = instr.name;
      proc.pc--;
      state.events.push({ type: "sem_block", tick: state.tick, message: `P${pid} が ${instr.name} でブロック (value=${sem.value})` });
      return `sem_wait: ${instr.name} (ブロック, value=${sem.value})`;
    }

    case "sem_trywait": {
      const sem = state.semaphores.get(instr.name);
      if (!sem) return `セマフォ '${instr.name}' が未初期化`;
      if (sem.value > 0) {
        sem.value--;
        proc.locals["_trywait_result"] = 0;
        return `sem_trywait: ${instr.name} (成功, value=${sem.value})`;
      }
      proc.locals["_trywait_result"] = -1; // EAGAIN
      state.events.push({ type: "sem_trywait_fail", tick: state.tick, message: `P${pid} の sem_trywait 失敗 (EAGAIN)` });
      return `sem_trywait: ${instr.name} (失敗: EAGAIN)`;
    }

    case "sem_timedwait": {
      const sem = state.semaphores.get(instr.name);
      if (!sem) return `セマフォ '${instr.name}' が未初期化`;
      sem.waitCount++;
      if (sem.value > 0) {
        sem.value--;
        state.events.push({ type: "sem_wait", tick: state.tick, message: `P${pid} が ${instr.name} を取得 (value=${sem.value})` });
        return `sem_timedwait: ${instr.name} (取得, value=${sem.value})`;
      }
      // タイムアウト付きブロック
      sem.waitQueue.push(pid);
      proc.state = "blocked";
      proc.blockReason = "sem_wait";
      proc.blockDetail = instr.name;
      proc.pc--;
      state.timedWaitCounters.set(pid, { sem: instr.name, remaining: instr.timeout });
      state.events.push({ type: "sem_block", tick: state.tick, message: `P${pid} が ${instr.name} でブロック (timeout=${instr.timeout})` });
      return `sem_timedwait: ${instr.name} (ブロック, timeout=${instr.timeout})`;
    }

    case "sem_post": {
      const sem = state.semaphores.get(instr.name);
      if (!sem) return `セマフォ '${instr.name}' が未初期化`;
      sem.postCount++;
      // バイナリセマフォは上限1
      if (sem.type === "binary" && sem.value >= 1 && sem.waitQueue.length === 0) {
        return `sem_post: ${instr.name} (バイナリ上限、変更なし)`;
      }
      if (sem.waitQueue.length > 0) {
        // 待ちプロセスを起こす
        const wakerPid = sem.waitQueue.shift()!;
        const waker = state.processes.find(p => p.pid === wakerPid);
        if (waker) {
          waker.state = "ready";
          waker.blockReason = undefined;
          waker.blockDetail = undefined;
          waker.pc++;
          // timedwaitカウンタがあれば削除
          state.timedWaitCounters.delete(wakerPid);
        }
        state.events.push({ type: "sem_wakeup", tick: state.tick, message: `P${pid} が ${instr.name} をpost → P${wakerPid} を起床 (value=${sem.value})` });
        return `sem_post: ${instr.name} → P${wakerPid} 起床 (value=${sem.value})`;
      }
      sem.value++;
      state.events.push({ type: "sem_post", tick: state.tick, message: `P${pid} が ${instr.name} をpost (value=${sem.value})` });
      return `sem_post: ${instr.name} (value=${sem.value})`;
    }

    case "sem_getvalue": {
      const sem = state.semaphores.get(instr.name);
      if (!sem) return `セマフォ '${instr.name}' が未初期化`;
      proc.locals[instr.into] = sem.value;
      return `sem_getvalue: ${instr.name} = ${sem.value}`;
    }

    case "sem_close": {
      return `sem_close: ${instr.name}`;
    }

    case "sem_destroy": {
      const sem = state.semaphores.get(instr.name);
      if (!sem) return `セマフォ '${instr.name}' が未初期化`;
      if (sem.waitQueue.length > 0) {
        return `sem_destroy: ${instr.name} (警告: 待機中プロセスあり)`;
      }
      state.semaphores.delete(instr.name);
      return `sem_destroy: ${instr.name}`;
    }

    case "create": {
      const childPid = state.nextPid++;
      const child: Process = {
        pid: childPid, name: instr.name, state: "ready",
        pc: 0, cpuTime: 0, waitTime: 0, locals: {},
      };
      state.processes.push(child);
      state.instrMap.set(childPid, instr.instructions);
      state.events.push({ type: "create", tick: state.tick, message: `P${pid} が P${childPid}(${instr.name}) を生成` });
      return `create: P${childPid}(${instr.name})`;
    }

    case "join": {
      const target = state.processes.find(p => p.pid === instr.pid);
      if (!target || target.state === "terminated") {
        return `join: P${instr.pid} (既に終了)`;
      }
      proc.state = "blocked";
      proc.blockReason = "join";
      proc.joinTarget = instr.pid;
      proc.pc--;
      return `join: P${instr.pid} (待機)`;
    }

    case "read": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      proc.locals[instr.into] = sv.value;
      sv.accessLog.push({ pid, op: "read", value: sv.value, tick: state.tick });
      return `read: ${instr.into} = ${instr.varName} (${sv.value})`;
    }

    case "write": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      sv.value = instr.value;
      sv.lastWriter = pid;
      sv.accessLog.push({ pid, op: "write", value: instr.value, tick: state.tick });
      return `write: ${instr.varName} = ${instr.value}`;
    }

    case "increment": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      const old = sv.value;
      sv.value = old + 1;
      sv.lastWriter = pid;
      sv.accessLog.push({ pid, op: "read", value: old, tick: state.tick });
      sv.accessLog.push({ pid, op: "write", value: sv.value, tick: state.tick });
      return `increment: ${instr.varName} (${old} → ${sv.value})`;
    }

    case "decrement": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      const old = sv.value;
      sv.value = old - 1;
      sv.lastWriter = pid;
      sv.accessLog.push({ pid, op: "read", value: old, tick: state.tick });
      sv.accessLog.push({ pid, op: "write", value: sv.value, tick: state.tick });
      return `decrement: ${instr.varName} (${old} → ${sv.value})`;
    }

    case "sleep": {
      state.sleepCounters.set(pid, instr.ticks);
      proc.state = "blocked";
      proc.blockReason = "sleep";
      proc.blockDetail = `${instr.ticks} ticks`;
      return `sleep: ${instr.ticks} ticks`;
    }

    case "yield": {
      proc.state = "ready";
      return `yield: P${pid}`;
    }

    case "exit": {
      proc.state = "terminated";
      // join待ちプロセスを起こす
      for (const p of state.processes) {
        if (p.state === "blocked" && p.blockReason === "join" && p.joinTarget === pid) {
          p.state = "ready";
          p.blockReason = undefined;
          p.joinTarget = undefined;
          p.pc++;
        }
      }
      state.events.push({ type: "terminate", tick: state.tick, message: `P${pid}(${proc.name}) 終了 (code=${instr.code ?? 0})` });
      return `exit: code=${instr.code ?? 0}`;
    }

    case "comment": {
      state.events.push({ type: "comment", tick: state.tick, message: instr.text });
      return instr.text;
    }
  }
}

// ─── デッドロック検出 ───

/** デッドロック判定 */
export function detectDeadlock(state: SimState): boolean {
  const active = state.processes.filter(p => p.state !== "terminated");
  if (active.length === 0) return false;
  // sleepプロセスは自然に起床するのでデッドロックではない
  if (active.some(p => p.state === "blocked" && p.blockReason === "sleep")) return false;
  // timedwait中のプロセスはタイムアウトで起床するのでデッドロックではない
  if ([...state.timedWaitCounters.keys()].some(pid => active.some(p => p.pid === pid))) return false;
  return active.every(p => p.state === "blocked");
}

// ─── シミュレーション実行 ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allTicks: TickResult[] = [];
  const allEvents: SimEvent[] = [];
  let deadlockDetected = false;

  for (const op of ops) {
    const result = executeSimulation(op);
    allTicks.push(...result.ticks);
    allEvents.push(...result.events);
    if (result.deadlockDetected) deadlockDetected = true;
  }

  return { ticks: allTicks, events: allEvents, deadlockDetected };
}

/** 単一シミュレーション実行 */
export function executeSimulation(op: SimOp): SimulationResult {
  const state = createState(op);
  const ticks: TickResult[] = [];
  let deadlockDetected = false;
  let sliceCounter = 0;
  let currentPid: Pid | null = null;

  for (let tick = 0; tick < op.config.maxTicks; tick++) {
    state.tick = tick;

    // sleepカウンタの更新
    for (const [spid, remaining] of state.sleepCounters) {
      if (remaining <= 1) {
        const sp = state.processes.find(p => p.pid === spid);
        if (sp && sp.state === "blocked" && sp.blockReason === "sleep") {
          sp.state = "ready";
          sp.blockReason = undefined;
        }
        state.sleepCounters.delete(spid);
      } else {
        state.sleepCounters.set(spid, remaining - 1);
      }
    }

    // timedwaitカウンタの更新
    for (const [twPid, tw] of state.timedWaitCounters) {
      if (tw.remaining <= 1) {
        // タイムアウト: プロセスを起こしてセマフォの待ちキューから削除
        const p = state.processes.find(pr => pr.pid === twPid);
        if (p && p.state === "blocked" && p.blockReason === "sem_wait") {
          p.state = "ready";
          p.blockReason = undefined;
          p.blockDetail = undefined;
          p.pc++;
          p.locals["_timedwait_result"] = -1; // ETIMEDOUT
          const sem = state.semaphores.get(tw.sem);
          if (sem) {
            sem.waitQueue = sem.waitQueue.filter(id => id !== twPid);
          }
          state.events.push({ type: "sem_timedout", tick, message: `P${twPid} の sem_timedwait タイムアウト (${tw.sem})` });
        }
        state.timedWaitCounters.delete(twPid);
      } else {
        state.timedWaitCounters.set(twPid, { ...tw, remaining: tw.remaining - 1 });
      }
    }

    // 全プロセス終了チェック
    const alive = state.processes.filter(p => p.state !== "terminated");
    if (alive.length === 0) break;

    // デッドロック検出
    if (detectDeadlock(state)) {
      deadlockDetected = true;
      state.events.push({ type: "deadlock", tick, message: "デッドロック検出: 全アクティブプロセスがブロック状態" });
      ticks.push(buildTickResult(state, null, undefined, "デッドロック検出"));
      break;
    }

    // スケジューリング
    const needReschedule = currentPid === null ||
      state.processes.find(p => p.pid === currentPid)?.state !== "running" ||
      (op.config.scheduler === "round_robin" && sliceCounter >= op.config.timeSlice);

    if (needReschedule) {
      if (currentPid !== null) {
        const cur = state.processes.find(p => p.pid === currentPid);
        if (cur && cur.state === "running") cur.state = "ready";
      }
      currentPid = schedule(state, op.config);
      sliceCounter = 0;
      if (currentPid !== null) {
        const next = state.processes.find(p => p.pid === currentPid)!;
        next.state = "running";
        state.events.push({ type: "schedule", tick, message: `スケジュール: P${currentPid}(${next.name})` });
      }
    }

    if (currentPid === null) {
      ticks.push(buildTickResult(state, null, undefined, "実行可能プロセスなし"));
      continue;
    }

    const proc = state.processes.find(p => p.pid === currentPid)!;
    const instrs = state.instrMap.get(currentPid);

    if (!instrs || proc.pc >= instrs.length) {
      // 暗黙のexit
      proc.state = "terminated";
      for (const p of state.processes) {
        if (p.state === "blocked" && p.blockReason === "join" && p.joinTarget === currentPid) {
          p.state = "ready";
          p.blockReason = undefined;
          p.joinTarget = undefined;
          p.pc++;
        }
      }
      state.events.push({ type: "terminate", tick, message: `P${currentPid}(${proc.name}) 暗黙終了` });
      ticks.push(buildTickResult(state, currentPid, undefined, `P${currentPid}(${proc.name}) 暗黙終了`));
      currentPid = null;
      continue;
    }

    // 命令実行
    const instr = instrs[proc.pc];
    proc.pc++;
    proc.cpuTime++;
    sliceCounter++;

    const msg = executeInstr(state, currentPid, instr);

    // blocked状態のプロセスの待ち時間更新
    for (const p of state.processes) {
      if (p.state === "blocked") p.waitTime++;
    }

    if (proc.state === "blocked" || proc.state === "terminated") {
      currentPid = null;
    }

    ticks.push(buildTickResult(state, proc.pid, instr, msg));
  }

  return { ticks, events: state.events, deadlockDetected };
}

/** TickResultを構築 */
function buildTickResult(
  state: SimState, runningPid: Pid | null, instruction: SemInstr | undefined,
  message: string, warning?: string,
): TickResult {
  return {
    tick: state.tick, runningPid, instruction,
    processes: state.processes.map(p => ({ ...p, locals: { ...p.locals } })),
    semaphores: [...state.semaphores.values()].map(s => ({ ...s, waitQueue: [...s.waitQueue] })),
    sharedVars: [...state.sharedVars.values()].map(s => ({ ...s, accessLog: [...s.accessLog] })),
    message, warning,
  };
}

// ─── デフォルト設定 ───

/** デフォルト設定 */
export function defaultConfig(): SimConfig {
  return { scheduler: "round_robin", timeSlice: 3, maxTicks: 200 };
}

/** FIFO設定 */
export function fifoConfig(): SimConfig {
  return { scheduler: "fifo", timeSlice: 1, maxTicks: 200 };
}
