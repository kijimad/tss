/* スタック＆ヒープ シミュレーター 型定義 */

// ─── メモリ値 ───

/** プリミティブ型 */
export type PrimitiveType = "int" | "float" | "bool" | "char" | "pointer";

/** 値の種別 */
export type ValueKind = "primitive" | "reference" | "return_address";

/** メモリ上の値 */
export interface MemValue {
  kind: ValueKind;
  type: PrimitiveType | "object" | "array" | "string";
  /** 表示用の値 */
  display: string;
  /** バイトサイズ */
  size: number;
  /** ヒープ参照先アドレス（referenceの場合） */
  heapAddr?: number;
}

// ─── スタック ───

/** スタックフレーム内のローカル変数 */
export interface StackVariable {
  name: string;
  value: MemValue;
  /** スタック上のアドレス（オフセット） */
  offset: number;
}

/** スタックフレーム */
export interface StackFrame {
  /** 関数名 */
  functionName: string;
  /** 戻りアドレス */
  returnAddress: number;
  /** ベースポインタ（フレームポインタ） */
  basePointer: number;
  /** ローカル変数 */
  locals: StackVariable[];
  /** 引数 */
  args: StackVariable[];
  /** フレームサイズ（バイト） */
  frameSize: number;
}

/** コールスタック全体 */
export interface CallStack {
  /** スタックフレーム（最後が最新） */
  frames: StackFrame[];
  /** スタックポインタ（現在位置、上位アドレスから下方向に成長） */
  sp: number;
  /** スタック最大サイズ */
  maxSize: number;
  /** スタックオーバーフローが発生したか */
  overflow: boolean;
}

// ─── ヒープ ───

/** ヒープブロックの状態 */
export type BlockStatus = "allocated" | "freed" | "corrupted";

/** ヒープブロック */
export interface HeapBlock {
  /** 先頭アドレス */
  address: number;
  /** サイズ（バイト） */
  size: number;
  /** 状態 */
  status: BlockStatus;
  /** 割当先の変数名/用途 */
  label: string;
  /** 内容の表示 */
  content: string;
  /** 参照カウント（GC用） */
  refCount: number;
  /** GCマーク */
  marked: boolean;
}

/** ヒープ全体 */
export interface Heap {
  /** ヒープブロック */
  blocks: HeapBlock[];
  /** 次の割当アドレス */
  nextAddress: number;
  /** ヒープ最大サイズ */
  maxSize: number;
  /** 総割当サイズ */
  totalAllocated: number;
  /** 断片化率(%) */
  fragmentation: number;
}

// ─── メモリレイアウト ───

/** メモリ領域の種別 */
export type MemRegion = "text" | "data" | "bss" | "heap" | "free" | "stack" | "kernel";

/** メモリ領域 */
export interface MemorySegment {
  region: MemRegion;
  startAddr: number;
  endAddr: number;
  label: string;
  used: number;
}

/** メモリレイアウト全体 */
export interface MemoryLayout {
  segments: MemorySegment[];
  totalSize: number;
}

// ─── 命令 ───

/** 実行命令 */
export type Instruction =
  | { op: "call"; functionName: string; args: { name: string; value: MemValue }[] }
  | { op: "return"; value?: MemValue }
  | { op: "local"; name: string; value: MemValue }
  | { op: "alloc"; varName: string; size: number; label: string; content: string }
  | { op: "free"; varName: string }
  | { op: "assign"; varName: string; value: MemValue }
  | { op: "gc"; method: "mark_sweep" | "ref_count" }
  | { op: "comment"; text: string };

// ─── シミュレーション ───

/** シミュレーションステップの結果 */
export interface StepResult {
  /** 実行された命令 */
  instruction: Instruction;
  /** 実行時のコールスタック */
  stack: CallStack;
  /** 実行時のヒープ */
  heap: Heap;
  /** メモリレイアウト */
  layout: MemoryLayout;
  /** 説明メッセージ */
  message: string;
  /** 詳細 */
  detail?: string;
  /** 警告/エラー */
  warning?: string;
}

/** シミュレーション操作 */
export interface SimOp {
  type: "execute";
  /** プログラム名 */
  programName: string;
  /** 命令列 */
  instructions: Instruction[];
}

/** イベント種別 */
export type EventType =
  | "push" | "pop" | "alloc" | "free" | "gc"
  | "overflow" | "leak" | "dangling" | "info" | "warn";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  message: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  /** ステップごとの状態 */
  steps: StepResult[];
  /** イベントログ */
  events: SimEvent[];
  /** 最終的なメモリリーク */
  leakedBlocks: HeapBlock[];
  /** ダングリングポインタ */
  danglingPointers: string[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
