/* UNIX スレッド シミュレーター エンジン */

import type {
  Thread, Tid, Mutex, CondVar, RwLock, Barrier,
  SharedVar, ThreadInstr, SimConfig, TickResult,
  SimOp, SimEvent, SimulationResult,
} from "./types.js";

// ─── 状態管理 ───

/** シミュレーション内部状態 */
interface SimState {
  threads: Thread[];
  mutexes: Map<string, Mutex>;
  condVars: Map<string, CondVar>;
  rwLocks: Map<string, RwLock>;
  barriers: Map<string, Barrier>;
  sharedVars: Map<string, SharedVar>;
  /** スレッドごとの命令列 */
  instrMap: Map<Tid, ThreadInstr[]>;
  nextTid: Tid;
  tick: number;
  events: SimEvent[];
  /** sleepカウンタ: tid→残りティック */
  sleepCounters: Map<Tid, number>;
}

/** 初期状態を作成 */
function createState(op: SimOp): SimState {
  const sharedVars = new Map<string, SharedVar>();
  for (const sv of op.sharedVars) {
    sharedVars.set(sv.name, { name: sv.name, value: sv.value, lastWriter: null, accessLog: [] });
  }

  const mainThread: Thread = {
    tid: 0, name: "main", state: "ready", parentTid: null,
    pc: 0, locals: {}, cpuTime: 0, waitTime: 0, detached: false,
  };

  const instrMap = new Map<Tid, ThreadInstr[]>();
  instrMap.set(0, op.mainInstructions);

  return {
    threads: [mainThread],
    mutexes: new Map(), condVars: new Map(), rwLocks: new Map(), barriers: new Map(),
    sharedVars, instrMap, nextTid: 1, tick: 0, events: [],
    sleepCounters: new Map(),
  };
}

// ─── スケジューラ ───

/** 次に実行するスレッドを選択 */
export function schedule(state: SimState, config: SimConfig): Tid | null {
  const ready = state.threads.filter(t => t.state === "ready");
  if (ready.length === 0) return null;

  switch (config.scheduler) {
    case "round_robin": {
      // 前回のrunningスレッドの次から探す
      const running = state.threads.find(t => t.state === "running");
      const lastTid = running?.tid ?? -1;
      const sorted = [...ready].sort((a, b) => a.tid - b.tid);
      const next = sorted.find(t => t.tid > lastTid) ?? sorted[0];
      return next.tid;
    }
    case "fifo": {
      // TID順（最も古いスレッドを優先）
      return ready.sort((a, b) => a.tid - b.tid)[0].tid;
    }
    case "priority": {
      // TID小さい方が高優先度（シミュレーション簡略化）
      return ready.sort((a, b) => a.tid - b.tid)[0].tid;
    }
  }
}

// ─── 命令実行 ───

/** 1命令を実行 */
function executeInstr(state: SimState, tid: Tid, instr: ThreadInstr, _config: SimConfig): string {
  const thread = state.threads.find(t => t.tid === tid)!;

  switch (instr.op) {
    case "create": {
      const childTid = state.nextTid++;
      const child: Thread = {
        tid: childTid, name: instr.name, state: "ready", parentTid: tid,
        pc: 0, locals: {}, cpuTime: 0, waitTime: 0, detached: false,
      };
      state.threads.push(child);
      state.instrMap.set(childTid, instr.instructions);
      state.events.push({ type: "create", tick: state.tick, message: `T${tid} が T${childTid}(${instr.name}) を生成` });
      return `pthread_create: T${childTid}(${instr.name})`;
    }

    case "mutex_init": {
      state.mutexes.set(instr.id, {
        id: instr.id, owner: null, waitQueue: [], lockCount: 0, recursive: instr.recursive ?? false,
      });
      return `pthread_mutex_init: ${instr.id}`;
    }

    case "mutex_lock": {
      const mtx = state.mutexes.get(instr.id);
      if (!mtx) return `mutex '${instr.id}' が未初期化`;
      if (mtx.owner === null) {
        mtx.owner = tid;
        mtx.lockCount = 1;
        state.events.push({ type: "lock", tick: state.tick, message: `T${tid} が ${instr.id} をロック` });
        return `pthread_mutex_lock: ${instr.id} (取得)`;
      }
      if (mtx.recursive && mtx.owner === tid) {
        mtx.lockCount++;
        return `pthread_mutex_lock: ${instr.id} (再帰ロック count=${mtx.lockCount})`;
      }
      // ブロック
      mtx.waitQueue.push(tid);
      thread.state = "blocked";
      thread.blockReason = "mutex";
      thread.blockDetail = instr.id;
      thread.pc--; // 再実行させるためにPCを戻す
      state.events.push({ type: "wait", tick: state.tick, message: `T${tid} が ${instr.id} で待機` });
      return `pthread_mutex_lock: ${instr.id} (ブロック)`;
    }

    case "mutex_trylock": {
      const mtx = state.mutexes.get(instr.id);
      if (!mtx) return `mutex '${instr.id}' が未初期化`;
      if (mtx.owner === null) {
        mtx.owner = tid;
        mtx.lockCount = 1;
        thread.locals["_trylock_result"] = 0;
        return `pthread_mutex_trylock: ${instr.id} (成功)`;
      }
      thread.locals["_trylock_result"] = 1; // EBUSY
      return `pthread_mutex_trylock: ${instr.id} (失敗: EBUSY)`;
    }

    case "mutex_unlock": {
      const mtx = state.mutexes.get(instr.id);
      if (!mtx) return `mutex '${instr.id}' が未初期化`;
      if (mtx.owner !== tid) return `T${tid} は ${instr.id} のオーナーではない`;
      if (mtx.recursive && mtx.lockCount > 1) {
        mtx.lockCount--;
        return `pthread_mutex_unlock: ${instr.id} (再帰アンロック count=${mtx.lockCount})`;
      }
      mtx.owner = null;
      mtx.lockCount = 0;
      state.events.push({ type: "unlock", tick: state.tick, message: `T${tid} が ${instr.id} をアンロック` });
      // 待ちキューから1つ起こす
      if (mtx.waitQueue.length > 0) {
        const wakerTid = mtx.waitQueue.shift()!;
        const waker = state.threads.find(t => t.tid === wakerTid);
        if (waker) {
          waker.state = "ready";
          waker.blockReason = undefined;
          waker.blockDetail = undefined;
        }
      }
      return `pthread_mutex_unlock: ${instr.id}`;
    }

    case "cond_init": {
      state.condVars.set(instr.id, { id: instr.id, mutexId: instr.mutexId, waitQueue: [] });
      return `pthread_cond_init: ${instr.id}`;
    }

    case "cond_wait": {
      const cv = state.condVars.get(instr.id);
      if (!cv) return `condvar '${instr.id}' が未初期化`;
      // Mutexを一時解放
      const mtx = state.mutexes.get(cv.mutexId);
      if (mtx && mtx.owner === tid) {
        mtx.owner = null;
        mtx.lockCount = 0;
        if (mtx.waitQueue.length > 0) {
          const w = mtx.waitQueue.shift()!;
          const wt = state.threads.find(t => t.tid === w);
          if (wt) { wt.state = "ready"; wt.blockReason = undefined; }
        }
      }
      cv.waitQueue.push(tid);
      thread.state = "blocked";
      thread.blockReason = "condvar";
      thread.blockDetail = instr.id;
      thread.pc--; // signalされたら再実行
      state.events.push({ type: "wait", tick: state.tick, message: `T${tid} が ${instr.id} で待機 (mutex解放)` });
      return `pthread_cond_wait: ${instr.id}`;
    }

    case "cond_signal": {
      const cv = state.condVars.get(instr.id);
      if (!cv) return `condvar '${instr.id}' が未初期化`;
      if (cv.waitQueue.length > 0) {
        const wakerTid = cv.waitQueue.shift()!;
        const waker = state.threads.find(t => t.tid === wakerTid);
        if (waker) {
          waker.state = "ready";
          waker.blockReason = undefined;
          waker.blockDetail = undefined;
          waker.pc++; // cond_wait を完了させる
          // Mutexを再取得
          const mtx = state.mutexes.get(cv.mutexId);
          if (mtx) {
            if (mtx.owner === null) {
              mtx.owner = wakerTid;
              mtx.lockCount = 1;
            } else {
              mtx.waitQueue.push(wakerTid);
              waker.state = "blocked";
              waker.blockReason = "mutex";
              waker.blockDetail = cv.mutexId;
            }
          }
        }
        state.events.push({ type: "signal", tick: state.tick, message: `T${tid} が ${instr.id} をsignal → T${wakerTid} を起床` });
        return `pthread_cond_signal: ${instr.id} → T${wakerTid}`;
      }
      return `pthread_cond_signal: ${instr.id} (待機スレッドなし)`;
    }

    case "cond_broadcast": {
      const cv = state.condVars.get(instr.id);
      if (!cv) return `condvar '${instr.id}' が未初期化`;
      const woken = cv.waitQueue.length;
      for (const w of cv.waitQueue) {
        const wt = state.threads.find(t => t.tid === w);
        if (wt) {
          wt.state = "ready";
          wt.blockReason = undefined;
          wt.pc++;
        }
      }
      cv.waitQueue = [];
      state.events.push({ type: "signal", tick: state.tick, message: `T${tid} が ${instr.id} をbroadcast (${woken}スレッド起床)` });
      return `pthread_cond_broadcast: ${instr.id} (${woken}スレッド)`;
    }

    case "rwlock_init": {
      state.rwLocks.set(instr.id, { id: instr.id, readers: [], writer: null, waitQueue: [] });
      return `pthread_rwlock_init: ${instr.id}`;
    }

    case "rwlock_rdlock": {
      const rw = state.rwLocks.get(instr.id);
      if (!rw) return `rwlock '${instr.id}' が未初期化`;
      if (rw.writer === null) {
        rw.readers.push(tid);
        state.events.push({ type: "lock", tick: state.tick, message: `T${tid} が ${instr.id} を読取ロック (readers=${rw.readers.length})` });
        return `pthread_rwlock_rdlock: ${instr.id} (取得, readers=${rw.readers.length})`;
      }
      rw.waitQueue.push({ tid, mode: "read" });
      thread.state = "blocked";
      thread.blockReason = "rwlock";
      thread.blockDetail = instr.id;
      thread.pc--;
      return `pthread_rwlock_rdlock: ${instr.id} (ブロック: 書込ロック中)`;
    }

    case "rwlock_wrlock": {
      const rw = state.rwLocks.get(instr.id);
      if (!rw) return `rwlock '${instr.id}' が未初期化`;
      if (rw.writer === null && rw.readers.length === 0) {
        rw.writer = tid;
        state.events.push({ type: "lock", tick: state.tick, message: `T${tid} が ${instr.id} を書込ロック` });
        return `pthread_rwlock_wrlock: ${instr.id} (取得)`;
      }
      rw.waitQueue.push({ tid, mode: "write" });
      thread.state = "blocked";
      thread.blockReason = "rwlock";
      thread.blockDetail = instr.id;
      thread.pc--;
      return `pthread_rwlock_wrlock: ${instr.id} (ブロック)`;
    }

    case "rwlock_unlock": {
      const rw = state.rwLocks.get(instr.id);
      if (!rw) return `rwlock '${instr.id}' が未初期化`;
      if (rw.writer === tid) {
        rw.writer = null;
        state.events.push({ type: "unlock", tick: state.tick, message: `T${tid} が ${instr.id} の書込ロックを解放` });
      } else {
        rw.readers = rw.readers.filter(r => r !== tid);
        state.events.push({ type: "unlock", tick: state.tick, message: `T${tid} が ${instr.id} の読取ロックを解放 (readers=${rw.readers.length})` });
      }
      // 待ちキューから起こす
      if (rw.writer === null && rw.readers.length === 0 && rw.waitQueue.length > 0) {
        const next = rw.waitQueue.shift()!;
        const wt = state.threads.find(t => t.tid === next.tid);
        if (wt) {
          wt.state = "ready";
          wt.blockReason = undefined;
          if (next.mode === "write") rw.writer = next.tid;
          else rw.readers.push(next.tid);
        }
      }
      return `pthread_rwlock_unlock: ${instr.id}`;
    }

    case "barrier_init": {
      state.barriers.set(instr.id, { id: instr.id, count: instr.count, arrived: [] });
      return `pthread_barrier_init: ${instr.id} (count=${instr.count})`;
    }

    case "barrier_wait": {
      const bar = state.barriers.get(instr.id);
      if (!bar) return `barrier '${instr.id}' が未初期化`;
      bar.arrived.push(tid);
      if (bar.arrived.length >= bar.count) {
        // 全スレッド到着 → 全員解放
        for (const btid of bar.arrived) {
          const bt = state.threads.find(t => t.tid === btid);
          if (bt && bt.state === "blocked") {
            bt.state = "ready";
            bt.blockReason = undefined;
            bt.pc++; // barrier_wait の再実行を防ぐ
          }
        }
        state.events.push({ type: "signal", tick: state.tick, message: `バリア ${instr.id} 解放 (${bar.arrived.length}スレッド)` });
        bar.arrived = [];
        return `pthread_barrier_wait: ${instr.id} (全員到着, 解放)`;
      }
      thread.state = "blocked";
      thread.blockReason = "barrier";
      thread.blockDetail = `${instr.id} (${bar.arrived.length}/${bar.count})`;
      thread.pc--;
      return `pthread_barrier_wait: ${instr.id} (${bar.arrived.length}/${bar.count})`;
    }

    case "join": {
      const target = state.threads.find(t => t.tid === instr.tid);
      if (!target || target.state === "terminated") {
        return `pthread_join: T${instr.tid} (既に終了)`;
      }
      thread.state = "blocked";
      thread.blockReason = "join";
      thread.joinTarget = instr.tid;
      thread.pc--;
      state.events.push({ type: "wait", tick: state.tick, message: `T${tid} が T${instr.tid} の終了を待機` });
      return `pthread_join: T${instr.tid} (待機)`;
    }

    case "detach": {
      thread.detached = true;
      return `pthread_detach: T${tid}`;
    }

    case "read": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      thread.locals[instr.into] = sv.value;
      sv.accessLog.push({ tid, op: "read", value: sv.value, tick: state.tick });
      return `read: ${instr.into} = ${instr.varName} (${sv.value})`;
    }

    case "write": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      sv.value = instr.value;
      sv.lastWriter = tid;
      sv.accessLog.push({ tid, op: "write", value: instr.value, tick: state.tick });
      return `write: ${instr.varName} = ${instr.value}`;
    }

    case "increment": {
      const sv = state.sharedVars.get(instr.varName);
      if (!sv) return `共有変数 '${instr.varName}' が未定義`;
      // 読み取り→加算→書き込み を1命令で（非アトミック風に記録）
      const old = sv.value;
      sv.value = old + 1;
      sv.lastWriter = tid;
      sv.accessLog.push({ tid, op: "read", value: old, tick: state.tick });
      sv.accessLog.push({ tid, op: "write", value: sv.value, tick: state.tick });
      return `increment: ${instr.varName} (${old} → ${sv.value})`;
    }

    case "sleep": {
      state.sleepCounters.set(tid, instr.ticks);
      thread.state = "blocked";
      thread.blockReason = "sleep";
      thread.blockDetail = `${instr.ticks} ticks`;
      return `sleep: ${instr.ticks} ticks`;
    }

    case "yield": {
      thread.state = "ready";
      return `sched_yield: T${tid}`;
    }

    case "exit": {
      thread.state = "terminated";
      thread.exitCode = instr.code ?? 0;
      // join待ちスレッドを起こす
      for (const t of state.threads) {
        if (t.state === "blocked" && t.blockReason === "join" && t.joinTarget === tid) {
          t.state = "ready";
          t.blockReason = undefined;
          t.joinTarget = undefined;
          t.pc++;
        }
      }
      state.events.push({ type: "terminate", tick: state.tick, message: `T${tid}(${thread.name}) 終了 (code=${thread.exitCode})` });
      return `pthread_exit: code=${thread.exitCode}`;
    }

    case "comment": {
      return instr.text;
    }
  }
}

// ─── デッドロック検出 ───

/** デッドロック判定（全アクティブスレッドがblocked、sleep中は除外） */
export function detectDeadlock(state: SimState): boolean {
  const active = state.threads.filter(t => t.state !== "terminated");
  if (active.length === 0) return false;
  // sleepスレッドは自然に起床するのでデッドロックではない
  if (active.some(t => t.state === "blocked" && t.blockReason === "sleep")) return false;
  return active.every(t => t.state === "blocked");
}

// ─── レースコンディション検出 ───

/** レースコンディション検出 */
export function detectRaces(state: SimState): { varName: string; tids: Tid[] }[] {
  const races: { varName: string; tids: Tid[] }[] = [];

  for (const [name, sv] of state.sharedVars) {
    // 同一ティックで異なるスレッドからの書込みがあるか
    const tickWriters = new Map<number, Set<Tid>>();
    for (const log of sv.accessLog) {
      if (log.op === "write") {
        if (!tickWriters.has(log.tick)) tickWriters.set(log.tick, new Set());
        tickWriters.get(log.tick)!.add(log.tid);
      }
    }
    for (const [, writers] of tickWriters) {
      if (writers.size > 1) {
        races.push({ varName: name, tids: [...writers] });
      }
    }

    // 保護されていない読み書き（mutex無しでの複数スレッドアクセス）
    const writerTids = new Set(sv.accessLog.filter(l => l.op === "write").map(l => l.tid));
    const readerTids = new Set(sv.accessLog.filter(l => l.op === "read").map(l => l.tid));
    if (writerTids.size > 0 && (writerTids.size > 1 || readerTids.size > writerTids.size)) {
      // 複数スレッドが書き込んでいる場合にレース可能性をチェック
      const allTids = new Set([...writerTids, ...readerTids]);
      if (allTids.size > 1 && !races.some(r => r.varName === name)) {
        // Mutexで保護されているかチェック
        const protected_ = isProtectedByMutex(state, name);
        if (!protected_) {
          races.push({ varName: name, tids: [...allTids] });
        }
      }
    }
  }

  return races;
}

/** 共有変数がMutexで保護されているか（簡易判定） */
function isProtectedByMutex(state: SimState, _varName: string): boolean {
  // 全スレッドのアクセス時にMutexを保持していたかを簡易チェック
  // 完全な実装は複雑なので、Mutexが存在して使用されていれば保護とみなす
  for (const [, mtx] of state.mutexes) {
    if (mtx.lockCount > 0 || mtx.waitQueue.length > 0) return true;
  }
  return false;
}

// ─── シミュレーション実行 ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allTicks: TickResult[] = [];
  const allEvents: SimEvent[] = [];
  let deadlockDetected = false;
  let raceConditions: { varName: string; tids: Tid[] }[] = [];

  for (const op of ops) {
    const result = executeSimulation(op);
    allTicks.push(...result.ticks);
    allEvents.push(...result.events);
    if (result.deadlockDetected) deadlockDetected = true;
    raceConditions = [...raceConditions, ...result.raceConditions];
  }

  return { ticks: allTicks, events: allEvents, deadlockDetected, raceConditions };
}

/** 単一シミュレーション実行 */
export function executeSimulation(op: SimOp): SimulationResult {
  const state = createState(op);
  const ticks: TickResult[] = [];
  let deadlockDetected = false;
  let sliceCounter = 0;
  let currentTid: Tid | null = null;

  for (let tick = 0; tick < op.config.maxTicks; tick++) {
    state.tick = tick;

    // sleepカウンタの更新
    for (const [stid, remaining] of state.sleepCounters) {
      if (remaining <= 1) {
        const st = state.threads.find(t => t.tid === stid);
        if (st && st.state === "blocked" && st.blockReason === "sleep") {
          st.state = "ready";
          st.blockReason = undefined;
        }
        state.sleepCounters.delete(stid);
      } else {
        state.sleepCounters.set(stid, remaining - 1);
      }
    }

    // 全スレッド終了チェック
    const alive = state.threads.filter(t => t.state !== "terminated");
    if (alive.length === 0) break;

    // デッドロック検出
    if (detectDeadlock(state)) {
      deadlockDetected = true;
      state.events.push({ type: "deadlock", tick, message: "デッドロック検出: 全アクティブスレッドがブロック状態" });
      ticks.push(buildTickResult(state, null, undefined, "デッドロック検出", "全アクティブスレッドがブロック状態"));
      break;
    }

    // スケジューリング
    const needReschedule = currentTid === null ||
      state.threads.find(t => t.tid === currentTid)?.state !== "running" ||
      (op.config.scheduler === "round_robin" && sliceCounter >= op.config.timeSlice);

    if (needReschedule) {
      // 現在のrunningをreadyに
      if (currentTid !== null) {
        const cur = state.threads.find(t => t.tid === currentTid);
        if (cur && cur.state === "running") cur.state = "ready";
      }
      currentTid = schedule(state, op.config);
      sliceCounter = 0;
      if (currentTid !== null) {
        const next = state.threads.find(t => t.tid === currentTid)!;
        next.state = "running";
        state.events.push({ type: "schedule", tick, message: `スケジュール: T${currentTid}(${next.name})` });
      }
    }

    if (currentTid === null) {
      // waitingのスレッドだけが残っている
      ticks.push(buildTickResult(state, null, undefined, "実行可能スレッドなし"));
      continue;
    }

    const thread = state.threads.find(t => t.tid === currentTid)!;
    const instrs = state.instrMap.get(currentTid);

    if (!instrs || thread.pc >= instrs.length) {
      // 命令が尽きたら暗黙のexit
      thread.state = "terminated";
      thread.exitCode = 0;
      for (const t of state.threads) {
        if (t.state === "blocked" && t.blockReason === "join" && t.joinTarget === currentTid) {
          t.state = "ready";
          t.blockReason = undefined;
          t.joinTarget = undefined;
          t.pc++;
        }
      }
      state.events.push({ type: "terminate", tick, message: `T${currentTid}(${thread.name}) 暗黙終了` });
      ticks.push(buildTickResult(state, currentTid, undefined, `T${currentTid}(${thread.name}) 暗黙終了`));
      currentTid = null;
      continue;
    }

    // 命令実行
    const instr = instrs[thread.pc];
    thread.pc++;
    thread.cpuTime++;
    sliceCounter++;

    const msg = executeInstr(state, currentTid, instr, op.config);

    // blocked状態のスレッドの待ち時間更新
    for (const t of state.threads) {
      if (t.state === "blocked") t.waitTime++;
    }

    let warning: string | undefined;
    if (thread.state === "blocked" || thread.state === "terminated") {
      currentTid = null;
    }

    ticks.push(buildTickResult(state, thread.tid, instr, msg, warning));
  }

  // レースコンディション検出
  const raceConditions = detectRaces(state);
  if (raceConditions.length > 0) {
    state.events.push({
      type: "race", tick: state.tick,
      message: `レースコンディション検出: ${raceConditions.map(r => r.varName).join(", ")}`,
    });
  }

  return { ticks, events: state.events, deadlockDetected, raceConditions };
}

/** TickResultを構築 */
function buildTickResult(
  state: SimState, runningTid: Tid | null, instruction: ThreadInstr | undefined,
  message: string, warning?: string,
): TickResult {
  return {
    tick: state.tick, runningTid, instruction,
    threads: state.threads.map(t => ({ ...t, locals: { ...t.locals } })),
    mutexes: [...state.mutexes.values()].map(m => ({ ...m, waitQueue: [...m.waitQueue] })),
    condVars: [...state.condVars.values()].map(c => ({ ...c, waitQueue: [...c.waitQueue] })),
    rwLocks: [...state.rwLocks.values()].map(r => ({ ...r, readers: [...r.readers], waitQueue: [...r.waitQueue] })),
    barriers: [...state.barriers.values()].map(b => ({ ...b, arrived: [...b.arrived] })),
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
