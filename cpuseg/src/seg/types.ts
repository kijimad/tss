/** セグメント種別 */
export type SegmentType =
  | "code"       // コードセグメント（実行可能）
  | "data"       // データセグメント（読み書き）
  | "stack"      // スタックセグメント（下方向に伸長）
  | "tss"        // タスク状態セグメント
  | "call_gate"  // コールゲート
  | "null";      // ヌルディスクリプタ

/** 特権レベル (0=カーネル, 3=ユーザー) */
export type PrivilegeLevel = 0 | 1 | 2 | 3;

/** ディスクリプタテーブルの種類 */
export type TableType = "gdt" | "ldt";

/** セグメントディスクリプタ (GDT/LDTエントリ) */
export interface SegmentDescriptor {
  /** テーブル内インデックス */
  index: number;
  /** セグメント名（表示用） */
  name: string;
  /** ベースアドレス (32bit) */
  base: number;
  /** リミット（セグメントサイズ - 1） */
  limit: number;
  /** セグメント種別 */
  type: SegmentType;
  /** ディスクリプタ特権レベル (DPL) */
  dpl: PrivilegeLevel;
  /** 存在ビット (Present) */
  present: boolean;
  /** 粒度 (true=4KBページ単位, false=バイト単位) */
  granularity: boolean;
  /** コードセグメント: 読み取り可能か */
  readable: boolean;
  /** データセグメント: 書き込み可能か */
  writable: boolean;
  /** コードセグメント: コンフォーミングか */
  conforming: boolean;
  /** アクセス済みビット */
  accessed: boolean;
  /** コールゲート: ターゲットセレクタ */
  gateSelector?: number;
  /** コールゲート: ターゲットオフセット */
  gateOffset?: number;
}

/** セグメントセレクタ (セグメントレジスタの値) */
export interface SegmentSelector {
  /** ディスクリプタインデックス */
  index: number;
  /** テーブル指示子 (0=GDT, 1=LDT) */
  ti: TableType;
  /** 要求特権レベル (RPL) */
  rpl: PrivilegeLevel;
}

/** セグメントレジスタ */
export interface SegmentRegister {
  /** レジスタ名 */
  name: "CS" | "DS" | "SS" | "ES" | "FS" | "GS";
  /** 現在のセレクタ */
  selector: SegmentSelector;
}

/** CPUの現在特権レベル */
export interface CpuState {
  /** 現在の特権レベル (CPL = CS.RPL) */
  cpl: PrivilegeLevel;
  /** セグメントレジスタ */
  registers: SegmentRegister[];
}

/** メモリアクセス操作 */
export interface MemoryOp {
  type: "read" | "write" | "execute" | "load_seg" | "far_call" | "far_jmp";
  /** セグメントレジスタ名（read/write/execute時） */
  segReg?: "CS" | "DS" | "SS" | "ES" | "FS" | "GS";
  /** オフセット */
  offset?: number;
  /** 新しいセレクタ値（load_seg/far_call/far_jmp時） */
  newSelector?: SegmentSelector;
  /** ロード先レジスタ（load_seg時） */
  targetReg?: "CS" | "DS" | "SS" | "ES" | "FS" | "GS";
  /** 書き込みデータ（表示用） */
  data?: string;
}

/** イベント種別 */
export type EventType =
  | "selector_parse"
  | "gdt_lookup"
  | "ldt_lookup"
  | "descriptor_load"
  | "privilege_check"
  | "privilege_ok"
  | "privilege_fail"
  | "null_selector"
  | "segment_not_present"
  | "limit_check"
  | "limit_ok"
  | "limit_fail"
  | "type_check"
  | "type_ok"
  | "type_fail"
  | "linear_addr"
  | "access_ok"
  | "seg_load"
  | "far_call"
  | "far_jmp"
  | "call_gate"
  | "ring_transition"
  | "gp_fault"
  | "ss_fault"
  | "np_fault";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  /** 関連するセグメントインデックス */
  segIndex?: number;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  finalCpu: CpuState;
  gdt: SegmentDescriptor[];
  ldt: SegmentDescriptor[];
  stats: {
    totalOps: number;
    gpFaults: number;
    ssFaults: number;
    npFaults: number;
    ringTransitions: number;
    successfulAccesses: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  gdt: SegmentDescriptor[];
  ldt: SegmentDescriptor[];
  initialCpu: CpuState;
  ops: MemoryOp[];
}
