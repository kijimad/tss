/** GCアルゴリズム種別 */
export type GcAlgorithm = "mark-sweep" | "mark-compact" | "ref-count" | "generational";

/** オブジェクトの世代（Generational GC用） */
export type Generation = "young" | "old";

/** ヒープ上のオブジェクト */
export interface HeapObject {
  id: string;
  name: string;
  /** バイトサイズ */
  size: number;
  /** 参照先オブジェクトID */
  refs: string[];
  /** マークビット（Mark-Sweep / Mark-Compact用） */
  marked: boolean;
  /** 参照カウント（Reference Counting用） */
  refCount: number;
  /** 世代（Generational GC用） */
  generation: Generation;
  /** 生存回数（GCサイクルを何回生き残ったか） */
  survivalCount: number;
  /** ヒープ上のアドレス（Mark-Compact用） */
  address: number;
  /** コンパクション後の新アドレス */
  forwardingAddress?: number;
}

/** GCルート（スタック変数、グローバル変数など） */
export interface GcRoot {
  name: string;
  /** 参照先オブジェクトID（nullならルートが空） */
  targetId: string | null;
}

/** ヒープ操作 */
export type HeapAction =
  | { type: "alloc"; objectId: string; name: string; size: number }
  | { type: "ref"; fromId: string; toId: string }
  | { type: "deref"; fromId: string; toId: string }
  | { type: "root_set"; rootName: string; targetId: string | null }
  | { type: "gc" };

/** シミュレーションイベント種別 */
export type EventType =
  | "alloc"
  | "root_set"
  | "ref_add"
  | "ref_remove"
  | "gc_start"
  | "gc_mark_root"
  | "gc_mark_traverse"
  | "gc_mark_complete"
  | "gc_sweep"
  | "gc_sweep_free"
  | "gc_sweep_survive"
  | "gc_compact_compute"
  | "gc_compact_move"
  | "gc_compact_update_ref"
  | "gc_complete"
  | "refcount_inc"
  | "refcount_dec"
  | "refcount_free"
  | "gen_minor_gc"
  | "gen_promote"
  | "gen_major_gc";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  /** このイベント時点のヒープスナップショット */
  heapSnapshot: HeapObject[];
  /** このイベント時点のルートスナップショット */
  rootSnapshot: GcRoot[];
  /** 対象オブジェクトID（ハイライト用） */
  targetIds: string[];
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  /** 最終ヒープ状態 */
  finalHeap: HeapObject[];
  /** 最終ルート状態 */
  finalRoots: GcRoot[];
  /** 統計 */
  stats: {
    totalAllocated: number;
    totalFreed: number;
    gcCycles: number;
    peakHeapSize: number;
    finalHeapSize: number;
    fragmentationRatio: number;
  };
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  algorithm: GcAlgorithm;
  roots: GcRoot[];
  actions: HeapAction[];
}
