/**
 * engine.ts — メモリスワッピングシミュレーションエンジン
 *
 * 物理メモリ (RAM)、ページテーブル、スワップ領域、TLB を管理し、
 * ページフォルト処理と各種置換アルゴリズムをステップ実行する。
 */

import type {
  PageTableEntry, PhysicalFrame, SwapSlot, SwapProcess, SwapConfig,
  MemoryAccess, SwapEvent,
  TlbEntry, SwapSnapshot, SwapStats, SwapSimResult,
} from "./types.js";

// ── シミュレーション状態 ──

interface SimState {
  frames: PhysicalFrame[];
  swapSlots: SwapSlot[];
  processes: Map<number, SwapProcess>;
  tlb: TlbEntry[];
  config: SwapConfig;
  clock: number;
  clockHand: number;
  stats: SwapStats;
  /** Optimal用: 将来のアクセス列 */
  futureAccesses: MemoryAccess[];
  futureIdx: number;
}

// ── 初期化 ──

function initState(config: SwapConfig): SimState {
  const frames: PhysicalFrame[] = [];
  for (let i = 0; i < config.numFrames; i++) {
    frames.push({ frameNum: i, vpn: -1, pid: -1, data: "", free: true });
  }

  const swapSlots: SwapSlot[] = [];
  for (let i = 0; i < config.numSwapSlots; i++) {
    swapSlots.push({ slotNum: i, vpn: -1, pid: -1, data: "", used: false });
  }

  const tlb: TlbEntry[] = [];
  for (let i = 0; i < config.tlbSize; i++) {
    tlb.push({ vpn: -1, pid: -1, pfn: -1, valid: false, dirty: false });
  }

  return {
    frames, swapSlots, processes: new Map(), tlb, config,
    clock: 0, clockHand: 0,
    stats: { totalAccesses: 0, pageHits: 0, pageFaults: 0, swapIns: 0, swapOuts: 0, dirtyWritebacks: 0, tlbHits: 0, tlbMisses: 0, faultRate: 0, tlbHitRate: 0 },
    futureAccesses: [], futureIdx: 0,
  };
}

// ── プロセス作成 ──

function createProcess(state: SimState, pid: number, name: string, numPages: number, events: SwapEvent[], step: number): void {
  const pageTable: PageTableEntry[] = [];
  for (let i = 0; i < numPages; i++) {
    pageTable.push({
      vpn: i, pfn: -1, valid: false, dirty: false, referenced: false,
      swapSlot: -1, state: "unmapped", lastAccess: 0, loadTime: 0, pid,
    });
  }
  state.processes.set(pid, { pid, name, pageTable, numPages });
  events.push({ step, type: "process_create", severity: "normal", message: `プロセス ${name} (PID=${pid}) 作成`, detail: `仮想ページ数: ${numPages}`, pid });
}

// ── スナップショット ──

function snapshot(state: SimState, step: number, events: SwapEvent[], access: MemoryAccess | null): SwapSnapshot {
  const s = state.stats;
  s.faultRate = s.totalAccesses > 0 ? Math.round((s.pageFaults / s.totalAccesses) * 1000) / 10 : 0;
  s.tlbHitRate = s.totalAccesses > 0 ? Math.round((s.tlbHits / s.totalAccesses) * 1000) / 10 : 0;

  return {
    step,
    frames: state.frames.map(f => ({ ...f })),
    swapSlots: state.swapSlots.map(s => ({ ...s })),
    processes: Array.from(state.processes.values()).map(p => ({
      ...p,
      pageTable: p.pageTable.map(e => ({ ...e })),
    })),
    tlb: state.tlb.map(t => ({ ...t })),
    events: [...events],
    access,
    clockHand: state.clockHand,
    stats: { ...s },
  };
}

// ── フレーム操作 ──

/** 空きフレームを探す */
function findFreeFrame(state: SimState): number {
  for (let i = 0; i < state.frames.length; i++) {
    if (state.frames[i]!.free) return i;
  }
  return -1;
}

/** 空きスワップスロットを探す */
function findFreeSwapSlot(state: SimState): number {
  for (let i = 0; i < state.swapSlots.length; i++) {
    if (!state.swapSlots[i]!.used) return i;
  }
  return -1;
}

// ── 置換アルゴリズム ──

/** FIFO: 最も古くロードされたページを選択 */
function selectVictimFifo(state: SimState): number {
  let oldest = Infinity;
  let victim = 0;
  for (let i = 0; i < state.frames.length; i++) {
    const f = state.frames[i]!;
    if (f.free) continue;
    const proc = state.processes.get(f.pid);
    if (!proc) continue;
    const pte = proc.pageTable[f.vpn];
    if (!pte) continue;
    if (pte.loadTime < oldest) {
      oldest = pte.loadTime;
      victim = i;
    }
  }
  return victim;
}

/** LRU: 最も長く参照されていないページを選択 */
function selectVictimLru(state: SimState): number {
  let lruTime = Infinity;
  let victim = 0;
  for (let i = 0; i < state.frames.length; i++) {
    const f = state.frames[i]!;
    if (f.free) continue;
    const proc = state.processes.get(f.pid);
    if (!proc) continue;
    const pte = proc.pageTable[f.vpn];
    if (!pte) continue;
    if (pte.lastAccess < lruTime) {
      lruTime = pte.lastAccess;
      victim = i;
    }
  }
  return victim;
}

/** Clock (Second Chance): 参照ビットを確認し、0のページを選択 */
function selectVictimClock(state: SimState, events: SwapEvent[], step: number): number {
  const n = state.frames.length;
  // 最大2周まで
  for (let iter = 0; iter < n * 2; iter++) {
    const idx = state.clockHand % n;
    const f = state.frames[idx]!;
    if (f.free) {
      state.clockHand = (state.clockHand + 1) % n;
      continue;
    }
    const proc = state.processes.get(f.pid);
    if (!proc) { state.clockHand = (state.clockHand + 1) % n; continue; }
    const pte = proc.pageTable[f.vpn];
    if (!pte) { state.clockHand = (state.clockHand + 1) % n; continue; }

    if (pte.referenced) {
      // 参照ビットをクリアして次へ
      pte.referenced = false;
      events.push({ step, type: "clock_hand", severity: "normal", message: `Clock 針 → フレーム${idx} (ref=1→0)`, detail: `PID=${f.pid} VP=${f.vpn}: 参照ビットクリア、スキップ`, frameNum: idx, vpn: f.vpn, pid: f.pid });
      state.clockHand = (state.clockHand + 1) % n;
    } else {
      // 参照ビット0 → 犠牲ページ
      events.push({ step, type: "clock_hand", severity: "highlight", message: `Clock 針 → フレーム${idx} (ref=0): 犠牲選択`, detail: `PID=${f.pid} VP=${f.vpn}`, frameNum: idx, vpn: f.vpn, pid: f.pid });
      state.clockHand = (state.clockHand + 1) % n;
      return idx;
    }
  }
  // フォールバック
  return state.clockHand % n;
}

/** Optimal: 将来最も長く使われないページを選択 */
function selectVictimOptimal(state: SimState): number {
  let farthest = -1;
  let victim = 0;
  for (let i = 0; i < state.frames.length; i++) {
    const f = state.frames[i]!;
    if (f.free) continue;
    // 将来のアクセスで最も遠いものを探す
    let nextUse = Infinity;
    for (let j = state.futureIdx; j < state.futureAccesses.length; j++) {
      const fa = state.futureAccesses[j]!;
      if (fa.pid === f.pid && fa.vpn === f.vpn) {
        nextUse = j;
        break;
      }
    }
    if (nextUse > farthest) {
      farthest = nextUse;
      victim = i;
    }
  }
  return victim;
}

/** Random: ランダムに選択 */
function selectVictimRandom(state: SimState): number {
  const occupied: number[] = [];
  for (let i = 0; i < state.frames.length; i++) {
    if (!state.frames[i]!.free) occupied.push(i);
  }
  if (occupied.length === 0) return 0;
  return occupied[Math.floor(Math.random() * occupied.length)]!;
}

/** 犠牲ページを選択 */
function selectVictim(state: SimState, events: SwapEvent[], step: number): number {
  switch (state.config.algorithm) {
    case "fifo": return selectVictimFifo(state);
    case "lru": return selectVictimLru(state);
    case "clock": return selectVictimClock(state, events, step);
    case "optimal": return selectVictimOptimal(state);
    case "random": return selectVictimRandom(state);
  }
}

// ── ページフォルト処理 ──

function handlePageFault(state: SimState, _proc: SwapProcess, pte: PageTableEntry, access: MemoryAccess, events: SwapEvent[], step: number): void {
  state.stats.pageFaults++;
  events.push({ step, type: "page_fault", severity: "warning", message: `ページフォルト! PID=${access.pid} VP=${access.vpn}`, detail: `仮想ページ${access.vpn}が物理メモリに存在しない`, vpn: access.vpn, pid: access.pid });

  // 空きフレームを探す
  let frameIdx = findFreeFrame(state);

  if (frameIdx === -1) {
    // 空きなし → 犠牲ページ選択
    frameIdx = selectVictim(state, events, step);
    const victimFrame = state.frames[frameIdx]!;
    const victimProc = state.processes.get(victimFrame.pid);
    const victimPte = victimProc?.pageTable[victimFrame.vpn];

    events.push({ step, type: "victim_select", severity: "highlight", message: `犠牲ページ選択: フレーム${frameIdx} (PID=${victimFrame.pid} VP=${victimFrame.vpn})`, detail: `アルゴリズム: ${state.config.algorithm.toUpperCase()}`, frameNum: frameIdx, vpn: victimFrame.vpn, pid: victimFrame.pid });

    if (victimPte) {
      // ダーティページはスワップに書き戻す
      if (victimPte.dirty) {
        state.stats.dirtyWritebacks++;
        let slot = victimPte.swapSlot;
        if (slot === -1) {
          slot = findFreeSwapSlot(state);
          if (slot !== -1) {
            victimPte.swapSlot = slot;
          }
        }
        if (slot !== -1) {
          const ss = state.swapSlots[slot]!;
          ss.vpn = victimFrame.vpn;
          ss.pid = victimFrame.pid;
          ss.data = victimFrame.data;
          ss.used = true;
          events.push({ step, type: "dirty_writeback", severity: "warning", message: `ダーティページ書き戻し → スワップスロット${slot}`, detail: `PID=${victimFrame.pid} VP=${victimFrame.vpn} (dirty=true)`, frameNum: frameIdx, swapSlot: slot, vpn: victimFrame.vpn, pid: victimFrame.pid });
        }
      }

      // スワップアウト
      state.stats.swapOuts++;
      victimPte.valid = false;
      victimPte.pfn = -1;
      victimPte.state = victimPte.swapSlot !== -1 ? "swapped" : "unmapped";
      victimPte.referenced = false;
      events.push({ step, type: "swap_out", severity: "highlight", message: `スワップアウト: PID=${victimFrame.pid} VP=${victimFrame.vpn} → ディスク`, detail: `フレーム${frameIdx}を解放`, frameNum: frameIdx, vpn: victimFrame.vpn, pid: victimFrame.pid });

      // TLBから無効化
      invalidateTlb(state, victimFrame.pid, victimFrame.vpn);
    }

    // フレームを空にする
    victimFrame.free = true;
    victimFrame.vpn = -1;
    victimFrame.pid = -1;
    victimFrame.data = "";
  } else {
    events.push({ step, type: "frame_alloc", severity: "normal", message: `空きフレーム${frameIdx}を割り当て`, detail: `PID=${access.pid} VP=${access.vpn}`, frameNum: frameIdx, vpn: access.vpn, pid: access.pid });
  }

  // スワップイン (スワップ領域にデータがある場合)
  if (pte.swapSlot !== -1) {
    state.stats.swapIns++;
    const ss = state.swapSlots[pte.swapSlot]!;
    const frame = state.frames[frameIdx]!;
    frame.data = ss.data;
    events.push({ step, type: "swap_in", severity: "highlight", message: `スワップイン: スワップスロット${pte.swapSlot} → フレーム${frameIdx}`, detail: `PID=${access.pid} VP=${access.vpn}`, frameNum: frameIdx, swapSlot: pte.swapSlot, vpn: access.vpn, pid: access.pid });
    // スワップスロットは保持 (次回のスワップアウトで再利用可能)
  } else {
    // 初回マッピング — 0埋めページ
    const frame = state.frames[frameIdx]!;
    frame.data = access.label ?? `page_${access.pid}_${access.vpn}`;
  }

  // フレームに配置
  const frame = state.frames[frameIdx]!;
  frame.free = false;
  frame.vpn = access.vpn;
  frame.pid = access.pid;

  // ページテーブル更新
  pte.valid = true;
  pte.pfn = frameIdx;
  pte.state = "resident";
  pte.referenced = true;
  pte.loadTime = state.clock;
  pte.lastAccess = state.clock;
  if (access.type === "write") pte.dirty = true;
}

// ── TLB ──

function tlbLookup(state: SimState, pid: number, vpn: number): TlbEntry | null {
  for (const entry of state.tlb) {
    if (entry.valid && entry.pid === pid && entry.vpn === vpn) return entry;
  }
  return null;
}

function tlbUpdate(state: SimState, pid: number, vpn: number, pfn: number, dirty: boolean): void {
  // 既存エントリを更新
  for (const entry of state.tlb) {
    if (entry.valid && entry.pid === pid && entry.vpn === vpn) {
      entry.pfn = pfn;
      entry.dirty = dirty;
      return;
    }
  }
  // 空きスロットに追加
  for (const entry of state.tlb) {
    if (!entry.valid) {
      entry.vpn = vpn;
      entry.pid = pid;
      entry.pfn = pfn;
      entry.valid = true;
      entry.dirty = dirty;
      return;
    }
  }
  // LRU的に最初のエントリを上書き (簡易)
  const e = state.tlb[0]!;
  e.vpn = vpn;
  e.pid = pid;
  e.pfn = pfn;
  e.valid = true;
  e.dirty = dirty;
}

function invalidateTlb(state: SimState, pid: number, vpn: number): void {
  for (const entry of state.tlb) {
    if (entry.pid === pid && entry.vpn === vpn) {
      entry.valid = false;
    }
  }
}

// ── メモリアクセス処理 ──

function handleAccess(state: SimState, access: MemoryAccess, events: SwapEvent[], step: number): void {
  state.stats.totalAccesses++;
  state.clock++;

  const proc = state.processes.get(access.pid);
  if (!proc) {
    events.push({ step, type: "info", severity: "danger", message: `PID=${access.pid} が存在しない`, detail: "", pid: access.pid });
    return;
  }

  const pte = proc.pageTable[access.vpn];
  if (!pte) {
    events.push({ step, type: "info", severity: "danger", message: `VP=${access.vpn} がプロセス${access.pid}の範囲外`, detail: `最大VP: ${proc.numPages - 1}`, pid: access.pid, vpn: access.vpn });
    return;
  }

  events.push({ step, type: "access", severity: "normal", message: `メモリアクセス: PID=${access.pid} VP=${access.vpn} (${access.type})`, detail: access.label ?? "", vpn: access.vpn, pid: access.pid });

  // TLBチェック
  const tlbEntry = tlbLookup(state, access.pid, access.vpn);
  if (tlbEntry && pte.valid) {
    state.stats.tlbHits++;
    state.stats.pageHits++;
    events.push({ step, type: "tlb_hit", severity: "normal", message: `TLBヒット: VP=${access.vpn} → フレーム${tlbEntry.pfn}`, detail: "ページテーブル参照不要", vpn: access.vpn, pid: access.pid, frameNum: tlbEntry.pfn });
    pte.referenced = true;
    pte.lastAccess = state.clock;
    if (access.type === "write") {
      pte.dirty = true;
      tlbEntry.dirty = true;
      state.frames[pte.pfn]!.data = access.label ?? state.frames[pte.pfn]!.data;
    }
    events.push({ step, type: "page_hit", severity: "normal", message: `ページヒット (TLB経由)`, detail: `フレーム${tlbEntry.pfn}`, vpn: access.vpn, pid: access.pid, frameNum: tlbEntry.pfn });
    return;
  }

  if (tlbEntry === null || !pte.valid) {
    state.stats.tlbMisses++;
    events.push({ step, type: "tlb_miss", severity: "normal", message: `TLBミス: VP=${access.vpn}`, detail: "ページテーブルを参照", vpn: access.vpn, pid: access.pid });
  }

  if (pte.valid) {
    // ページヒット (TLBミスだがページテーブルで解決)
    state.stats.pageHits++;
    pte.referenced = true;
    pte.lastAccess = state.clock;
    if (access.type === "write") {
      pte.dirty = true;
      state.frames[pte.pfn]!.data = access.label ?? state.frames[pte.pfn]!.data;
    }
    events.push({ step, type: "page_hit", severity: "normal", message: `ページヒット: VP=${access.vpn} → フレーム${pte.pfn}`, detail: "物理メモリに存在", vpn: access.vpn, pid: access.pid, frameNum: pte.pfn });
    // TLB更新
    tlbUpdate(state, access.pid, access.vpn, pte.pfn, pte.dirty);
    events.push({ step, type: "tlb_update", severity: "normal", message: `TLB更新: VP=${access.vpn} → フレーム${pte.pfn}`, detail: "", vpn: access.vpn, pid: access.pid, frameNum: pte.pfn });
  } else {
    // ページフォルト
    handlePageFault(state, proc, pte, access, events, step);
    // TLB更新
    tlbUpdate(state, access.pid, access.vpn, pte.pfn, pte.dirty);
    events.push({ step, type: "tlb_update", severity: "normal", message: `TLB更新: VP=${access.vpn} → フレーム${pte.pfn}`, detail: "", vpn: access.vpn, pid: access.pid, frameNum: pte.pfn });
  }
}

// ── スラッシング検出 ──

function detectThrashing(snapshots: SwapSnapshot[], windowSize: number, threshold: number): boolean {
  if (snapshots.length < windowSize) return false;
  const recent = snapshots.slice(-windowSize);
  let faults = 0;
  for (const s of recent) {
    faults += s.events.filter(e => e.type === "page_fault").length;
  }
  return (faults / windowSize) > threshold;
}

// ── 公開API ──

export interface SimInput {
  config: SwapConfig;
  processes: { pid: number; name: string; numPages: number }[];
  accesses: MemoryAccess[];
}

/** シミュレーション実行 */
export function runSwapSim(input: SimInput): SwapSimResult {
  const state = initState(input.config);

  // Optimal用に将来のアクセス列を保存
  state.futureAccesses = [...input.accesses];

  const allEvents: SwapEvent[] = [];
  const snapshots: SwapSnapshot[] = [];
  let step = 0;

  // 初期スナップショット
  const initEvents: SwapEvent[] = [];
  for (const p of input.processes) {
    createProcess(state, p.pid, p.name, p.numPages, initEvents, 0);
  }
  initEvents.push({ step: 0, type: "info", severity: "normal", message: `シミュレーション開始`, detail: `フレーム数:${input.config.numFrames}, スワップ:${input.config.numSwapSlots}, TLB:${input.config.tlbSize}, アルゴリズム:${input.config.algorithm.toUpperCase()}` });
  allEvents.push(...initEvents);
  snapshots.push(snapshot(state, 0, initEvents, null));

  // アクセス列を処理
  for (let i = 0; i < input.accesses.length; i++) {
    step++;
    state.futureIdx = i + 1;
    const access = input.accesses[i]!;
    const stepEvents: SwapEvent[] = [];

    handleAccess(state, access, stepEvents, step);

    // スラッシング検出
    if (snapshots.length >= 5 && detectThrashing(snapshots, 5, 0.8)) {
      stepEvents.push({ step, type: "thrash_detect", severity: "danger", message: `スラッシング検出!`, detail: `直近5ステップでページフォルト率が80%超 — メモリ不足の可能性`, pid: access.pid });
    }

    allEvents.push(...stepEvents);
    snapshots.push(snapshot(state, step, stepEvents, access));
  }

  return { snapshots, config: input.config, allEvents };
}

/** デフォルト設定 */
export function defaultConfig(): SwapConfig {
  return { numFrames: 4, numSwapSlots: 8, tlbSize: 4, algorithm: "lru" };
}
