/** ページ置換アルゴリズム */
export type ReplacementAlgo = "fifo" | "lru" | "clock" | "optimal";

/** メモリアクセス種別 */
export type AccessType = "read" | "write" | "execute";

/** ページテーブルエントリ */
export interface PageTableEntry {
  /** 仮想ページ番号 */
  vpn: number;
  /** 物理フレーム番号（-1: 未マッピング） */
  pfn: number;
  /** 有効ビット（メモリ上にあるか） */
  present: boolean;
  /** ダーティビット（書き込みがあったか） */
  dirty: boolean;
  /** 参照ビット（アクセスされたか、Clock用） */
  referenced: boolean;
  /** 読み取り可能 */
  readable: boolean;
  /** 書き込み可能 */
  writable: boolean;
  /** 実行可能 */
  executable: boolean;
  /** 最終アクセス時刻（LRU用） */
  lastAccess: number;
  /** ロード時刻（FIFO用） */
  loadTime: number;
}

/** TLBエントリ */
export interface TlbEntry {
  vpn: number;
  pfn: number;
  valid: boolean;
  dirty: boolean;
  /** LRU用タイムスタンプ */
  lastAccess: number;
}

/** 物理フレーム */
export interface PhysicalFrame {
  /** フレーム番号 */
  pfn: number;
  /** 格納中の仮想ページ番号（-1: 空き） */
  vpn: number;
  /** 使用中か */
  occupied: boolean;
  /** 格納データ（表示用） */
  data: string;
}

/** メモリアクセス命令 */
export interface MemoryAccess {
  /** 仮想アドレス */
  virtualAddress: number;
  /** アクセス種別 */
  accessType: AccessType;
  /** 書き込みデータ（write時） */
  data?: string;
}

/** シミュレーションイベント種別 */
export type EventType =
  | "access_start"
  | "addr_split"
  | "tlb_lookup"
  | "tlb_hit"
  | "tlb_miss"
  | "pt_walk"
  | "pt_walk_l2"
  | "pt_walk_l1"
  | "pt_hit"
  | "page_fault"
  | "page_load"
  | "page_evict"
  | "page_evict_dirty"
  | "clock_scan"
  | "frame_alloc"
  | "tlb_update"
  | "tlb_evict"
  | "access_complete"
  | "protection_fault"
  | "physical_access"
  | "dirty_set";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  /** ハイライト対象（VPN/PFNなど） */
  highlight?: { vpn?: number; pfn?: number };
}

/** MMU設定 */
export interface MmuConfig {
  /** ページサイズ（バイト） */
  pageSize: number;
  /** 仮想アドレス空間ビット数 */
  virtualBits: number;
  /** 物理フレーム数 */
  physicalFrames: number;
  /** TLBエントリ数 */
  tlbSize: number;
  /** ページ置換アルゴリズム */
  replacementAlgo: ReplacementAlgo;
  /** 2段ページテーブルを使用するか */
  twoLevel: boolean;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  pageTable: PageTableEntry[];
  tlb: TlbEntry[];
  frames: PhysicalFrame[];
  stats: {
    totalAccesses: number;
    tlbHits: number;
    tlbMisses: number;
    pageFaults: number;
    pageEvictions: number;
    dirtyWritebacks: number;
    protectionFaults: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  config: MmuConfig;
  /** 初期ページ権限設定 [vpn, readable, writable, executable] */
  permissions: [number, boolean, boolean, boolean][];
  accesses: MemoryAccess[];
}
