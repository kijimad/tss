/**
 * types.ts — メモリスワッピングシミュレーターの型定義
 *
 * 物理メモリ (RAM)、仮想メモリ (ページテーブル)、スワップ領域 (ディスク) の
 * 3層構造をモデル化し、ページフォルト処理と置換アルゴリズムをシミュレートする。
 */

// ── ページ状態 ──

/** ページの状態 */
export type PageState =
  | "resident"    // 物理メモリに存在
  | "swapped"     // スワップ領域に退避
  | "unmapped";   // マッピングなし (初回アクセスでページフォルト)

/** ページテーブルエントリ */
export interface PageTableEntry {
  /** 仮想ページ番号 */
  vpn: number;
  /** 物理フレーム番号 (-1 = 非常駐) */
  pfn: number;
  /** 有効ビット (物理メモリに存在するか) */
  valid: boolean;
  /** ダーティビット (書き込みがあったか) */
  dirty: boolean;
  /** 参照ビット (最近参照されたか) */
  referenced: boolean;
  /** スワップスロット番号 (-1 = なし) */
  swapSlot: number;
  /** ページの状態 */
  state: PageState;
  /** 最終アクセス時刻 (LRU用) */
  lastAccess: number;
  /** ロード時刻 (FIFO用) */
  loadTime: number;
  /** プロセスID */
  pid: number;
}

// ── 物理メモリ ──

/** 物理メモリフレーム */
export interface PhysicalFrame {
  /** フレーム番号 */
  frameNum: number;
  /** 格納されているページのvpn (-1 = 空) */
  vpn: number;
  /** 格納されているページのプロセスID (-1 = 空) */
  pid: number;
  /** フレームの内容 (シミュレーション用データ) */
  data: string;
  /** 空きかどうか */
  free: boolean;
}

// ── スワップ領域 ──

/** スワップスロット */
export interface SwapSlot {
  /** スロット番号 */
  slotNum: number;
  /** 格納されているページのvpn (-1 = 空) */
  vpn: number;
  /** プロセスID (-1 = 空) */
  pid: number;
  /** データ */
  data: string;
  /** 使用中か */
  used: boolean;
}

// ── プロセス ──

/** シミュレーション上のプロセス */
export interface SwapProcess {
  pid: number;
  name: string;
  /** ページテーブル */
  pageTable: PageTableEntry[];
  /** 仮想ページ数 */
  numPages: number;
}

// ── 置換アルゴリズム ──

export type ReplacementAlgorithm =
  | "fifo"       // First-In First-Out
  | "lru"        // Least Recently Used
  | "clock"      // Clock (Second Chance)
  | "optimal"    // Optimal (Bélády)
  | "random";    // ランダム

// ── メモリアクセス ──

export type AccessType = "read" | "write";

/** メモリアクセス要求 */
export interface MemoryAccess {
  pid: number;
  vpn: number;
  type: AccessType;
  /** アクセスするデータの説明 */
  label?: string;
}

// ── イベント ──

export type SwapEventType =
  | "access"          // メモリアクセス
  | "page_hit"        // ページヒット (物理メモリに存在)
  | "page_fault"      // ページフォルト発生
  | "swap_out"        // ページをスワップ領域に退避
  | "swap_in"         // ページをスワップ領域から読み込み
  | "frame_alloc"     // 空きフレーム割り当て
  | "victim_select"   // 犠牲ページ選択
  | "dirty_writeback" // ダーティページの書き戻し
  | "clock_hand"      // Clock アルゴリズムの針の移動
  | "ref_clear"       // 参照ビットクリア
  | "tlb_hit"         // TLBヒット
  | "tlb_miss"        // TLBミス
  | "tlb_update"      // TLBエントリ更新
  | "thrash_detect"   // スラッシング検出
  | "process_create"  // プロセス作成
  | "info";           // 説明

export type EventSeverity = "normal" | "highlight" | "warning" | "danger";

export interface SwapEvent {
  step: number;
  type: SwapEventType;
  severity: EventSeverity;
  message: string;
  detail: string;
  /** 関連するページ */
  vpn?: number;
  pid?: number;
  /** 関連するフレーム */
  frameNum?: number;
  /** 関連するスワップスロット */
  swapSlot?: number;
}

// ── TLB ──

export interface TlbEntry {
  vpn: number;
  pid: number;
  pfn: number;
  valid: boolean;
  dirty: boolean;
}

// ── スナップショット ──

/** シミュレーションの1ステップの状態 */
export interface SwapSnapshot {
  /** ステップ番号 */
  step: number;
  /** 物理メモリフレーム */
  frames: PhysicalFrame[];
  /** スワップスロット */
  swapSlots: SwapSlot[];
  /** プロセス一覧 */
  processes: SwapProcess[];
  /** TLB */
  tlb: TlbEntry[];
  /** イベント */
  events: SwapEvent[];
  /** 今回のアクセス */
  access: MemoryAccess | null;
  /** Clock針の位置 (-1 = 未使用) */
  clockHand: number;
  /** 統計 */
  stats: SwapStats;
}

/** 統計情報 */
export interface SwapStats {
  totalAccesses: number;
  pageHits: number;
  pageFaults: number;
  swapIns: number;
  swapOuts: number;
  dirtyWritebacks: number;
  tlbHits: number;
  tlbMisses: number;
  /** ページフォルト率 (%) */
  faultRate: number;
  /** TLBヒット率 (%) */
  tlbHitRate: number;
}

// ── シミュレーション結果 ──

export interface SwapSimResult {
  snapshots: SwapSnapshot[];
  config: SwapConfig;
  /** 全イベント */
  allEvents: SwapEvent[];
}

/** シミュレーション設定 */
export interface SwapConfig {
  /** 物理フレーム数 */
  numFrames: number;
  /** スワップスロット数 */
  numSwapSlots: number;
  /** TLBエントリ数 */
  tlbSize: number;
  /** 置換アルゴリズム */
  algorithm: ReplacementAlgorithm;
}

// ── プリセット ──

export interface SwapPreset {
  name: string;
  description: string;
  run: () => SwapSimResult;
}
