/** メモリ管理方式の種類 */
export type MemoryScheme = "segment" | "paging";

/** === セグメント方式 === */

/** セグメントの種類 */
export type SegmentType = "code" | "data" | "stack" | "heap";

/** セグメントテーブルのエントリ */
export interface SegmentEntry {
  /** セグメント番号 */
  id: number;
  /** セグメント名 */
  name: string;
  /** 種類 */
  type: SegmentType;
  /** ベースアドレス（物理） */
  base: number;
  /** セグメントサイズ（リミット） */
  limit: number;
  /** 読み取り許可 */
  readable: boolean;
  /** 書き込み許可 */
  writable: boolean;
  /** 実行許可 */
  executable: boolean;
  /** 使用中かどうか */
  present: boolean;
}

/** セグメント方式の論理アドレス */
export interface SegmentAddress {
  /** セグメント番号 */
  segment: number;
  /** セグメント内オフセット */
  offset: number;
}

/** === ページ方式 === */

/** ページテーブルエントリ */
export interface PageTableEntry {
  /** ページ番号 */
  pageNumber: number;
  /** フレーム番号（物理メモリ上のページ） */
  frameNumber: number;
  /** メモリ上に存在するか */
  present: boolean;
  /** 変更済みフラグ（ダーティビット） */
  dirty: boolean;
  /** 参照ビット */
  referenced: boolean;
  /** 読み取り許可 */
  readable: boolean;
  /** 書き込み許可 */
  writable: boolean;
  /** 実行許可 */
  executable: boolean;
}

/** TLBエントリ */
export interface TlbEntry {
  /** 仮想ページ番号 */
  pageNumber: number;
  /** フレーム番号 */
  frameNumber: number;
  /** 最終アクセス時刻（LRU用） */
  lastAccess: number;
}

/** ページ方式の仮想アドレス分解 */
export interface VirtualAddress {
  /** 仮想アドレス全体 */
  address: number;
  /** ページ番号 */
  pageNumber: number;
  /** ページ内オフセット */
  offset: number;
}

/** 物理アドレス分解 */
export interface PhysicalAddress {
  /** 物理アドレス全体 */
  address: number;
  /** フレーム番号 */
  frameNumber: number;
  /** フレーム内オフセット */
  offset: number;
}

/** === 共通 === */

/** アドレス変換ステップ（可視化用） */
export interface TranslationStep {
  /** ステップの説明 */
  description: string;
  /** ステップの種類 */
  type: "info" | "lookup" | "calc" | "success" | "error" | "tlb_hit" | "tlb_miss" | "page_fault";
  /** 関連する値 */
  values?: Record<string, number | string | boolean>;
}

/** アドレス変換結果 */
export interface TranslationResult {
  /** 成功したか */
  success: boolean;
  /** 入力アドレス */
  inputAddress: number;
  /** 出力された物理アドレス（成功時） */
  physicalAddress?: number;
  /** エラーメッセージ（失敗時） */
  error?: string;
  /** 変換過程のステップ */
  steps: TranslationStep[];
}

/** メモリアクセス操作 */
export interface MemoryAccess {
  /** アクセスの種類 */
  type: "read" | "write" | "execute";
  /** アドレス */
  address: number;
  /** セグメント番号（セグメント方式のみ） */
  segment?: number;
  /** ラベル（表示用） */
  label?: string;
}

/** 物理メモリのブロック情報 */
export interface MemoryBlock {
  /** 開始アドレス */
  start: number;
  /** サイズ */
  size: number;
  /** ラベル */
  label: string;
  /** 使用中か空きか */
  used: boolean;
}

/** シミュレーション全体の結果 */
export interface SimulationResult {
  /** メモリ管理方式 */
  scheme: MemoryScheme;
  /** アクセス結果リスト */
  translations: TranslationResult[];
  /** 物理メモリマップ */
  memoryMap: MemoryBlock[];
  /** 統計情報 */
  stats: SimulationStats;
}

/** 統計情報 */
export interface SimulationStats {
  /** 総アクセス数 */
  totalAccesses: number;
  /** 成功数 */
  successCount: number;
  /** エラー数 */
  errorCount: number;
  /** TLBヒット数（ページ方式のみ） */
  tlbHits?: number;
  /** TLBミス数（ページ方式のみ） */
  tlbMisses?: number;
  /** ページフォールト数（ページ方式のみ） */
  pageFaults?: number;
  /** セグメントフォールト数（セグメント方式のみ） */
  segmentFaults?: number;
}
