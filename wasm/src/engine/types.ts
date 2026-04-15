/* ===== WebAssembly シミュレーター 型定義 ===== */

/* ---------- 値の型 ---------- */

/** WASMの値型 */
export type ValType = 'i32' | 'i64' | 'f32' | 'f64';

/** WASMのランタイム値 */
export type WasmValue =
  | { type: 'i32'; value: number }
  | { type: 'i64'; value: bigint }
  | { type: 'f32'; value: number }
  | { type: 'f64'; value: number };

/** 関数型シグネチャ */
export interface FuncType {
  params: ValType[];
  results: ValType[];
}

/* ---------- モジュール構造 ---------- */

/** WASMセクションID */
export enum SectionId {
  Custom = 0,
  Type = 1,
  Import = 2,
  Function = 3,
  Table = 4,
  Memory = 5,
  Global = 6,
  Export = 7,
  Start = 8,
  Element = 9,
  Code = 10,
  Data = 11,
}

/** インポート記述子 */
export interface ImportEntry {
  module: string;
  name: string;
  kind: 'func' | 'table' | 'memory' | 'global';
  /** func の場合: typeIndex */
  typeIndex?: number;
  /** memory の場合 */
  memoryLimits?: Limits;
  /** global の場合 */
  globalType?: GlobalType;
}

/** エクスポート記述子 */
export interface ExportEntry {
  name: string;
  kind: 'func' | 'table' | 'memory' | 'global';
  index: number;
}

/** リミット (min, max?) */
export interface Limits {
  min: number;
  max?: number;
}

/** グローバル変数の型 */
export interface GlobalType {
  valType: ValType;
  mutable: boolean;
}

/** グローバル変数 */
export interface Global {
  type: GlobalType;
  value: WasmValue;
}

/** テーブル定義 */
export interface TableDef {
  elementType: 'funcref';
  limits: Limits;
}

/** メモリ定義 */
export interface MemoryDef {
  limits: Limits;
}

/** データセグメント */
export interface DataSegment {
  memoryIndex: number;
  offset: number;
  data: number[];
}

/** エレメントセグメント（テーブル初期化用） */
export interface ElementSegment {
  tableIndex: number;
  offset: number;
  funcIndices: number[];
}

/* ---------- 命令セット ---------- */

/** オペコード */
export enum Opcode {
  /* 制御命令 */
  Unreachable = 0x00,
  Nop = 0x01,
  Block = 0x02,
  Loop = 0x03,
  If = 0x04,
  Else = 0x05,
  End = 0x0b,
  Br = 0x0c,
  BrIf = 0x0d,
  BrTable = 0x0e,
  Return = 0x0f,
  Call = 0x10,
  CallIndirect = 0x11,

  /* パラメトリック命令 */
  Drop = 0x1a,
  Select = 0x1b,

  /* 変数命令 */
  LocalGet = 0x20,
  LocalSet = 0x21,
  LocalTee = 0x22,
  GlobalGet = 0x23,
  GlobalSet = 0x24,

  /* メモリ命令 */
  I32Load = 0x28,
  I64Load = 0x29,
  F32Load = 0x2a,
  F64Load = 0x2b,
  I32Load8S = 0x2c,
  I32Load8U = 0x2d,
  I32Load16S = 0x2e,
  I32Load16U = 0x2f,
  I32Store = 0x36,
  I64Store = 0x37,
  F32Store = 0x38,
  F64Store = 0x39,
  I32Store8 = 0x3a,
  I32Store16 = 0x3b,
  MemorySize = 0x3f,
  MemoryGrow = 0x40,

  /* 定数命令 */
  I32Const = 0x41,
  I64Const = 0x42,
  F32Const = 0x43,
  F64Const = 0x44,

  /* i32 比較命令 */
  I32Eqz = 0x45,
  I32Eq = 0x46,
  I32Ne = 0x47,
  I32LtS = 0x48,
  I32LtU = 0x49,
  I32GtS = 0x4a,
  I32GtU = 0x4b,
  I32LeS = 0x4c,
  I32LeU = 0x4d,
  I32GeS = 0x4e,
  I32GeU = 0x4f,

  /* i32 算術命令 */
  I32Add = 0x6a,
  I32Sub = 0x6b,
  I32Mul = 0x6c,
  I32DivS = 0x6d,
  I32DivU = 0x6e,
  I32RemS = 0x6f,
  I32RemU = 0x70,
  I32And = 0x71,
  I32Or = 0x72,
  I32Xor = 0x73,
  I32Shl = 0x74,
  I32ShrS = 0x75,
  I32ShrU = 0x76,
  I32Rotl = 0x77,
  I32Rotr = 0x78,

  /* i64 算術命令 (一部) */
  I64Add = 0x7c,
  I64Sub = 0x7d,
  I64Mul = 0x7e,

  /* f32 算術命令 (一部) */
  F32Add = 0x92,
  F32Sub = 0x93,
  F32Mul = 0x94,
  F32Div = 0x95,

  /* f64 算術命令 (一部) */
  F64Add = 0xa0,
  F64Sub = 0xa1,
  F64Mul = 0xa2,
  F64Div = 0xa3,

  /* 型変換命令 (一部) */
  I32WrapI64 = 0xa7,
  I32TruncF32S = 0xa8,
  I32TruncF64S = 0xaa,
  I64ExtendI32S = 0xac,
  I64ExtendI32U = 0xad,
  F32ConvertI32S = 0xb2,
  F64ConvertI32S = 0xb7,
  F64ConvertI64S = 0xb9,
}

/** 命令 */
export interface Instruction {
  opcode: Opcode;
  /** 即値（定数値、インデックスなど） */
  immediate?: number | bigint;
  /** ブロック型 (block/loop/if 用) */
  blockType?: ValType | 'void';
  /** br_table 用ラベルリスト */
  labelIndices?: number[];
  /** br_table デフォルトラベル */
  defaultLabel?: number;
  /** メモリ命令のアライメントとオフセット */
  align?: number;
  offset?: number;
}

/** 関数本体 */
export interface FuncBody {
  locals: ValType[];
  instructions: Instruction[];
}

/* ---------- ランタイム ---------- */

/** 線形メモリ（ページ単位 = 64KB） */
export const PAGE_SIZE = 65536;

/** コールフレーム */
export interface CallFrame {
  /** 関数インデックス */
  funcIndex: number;
  /** ローカル変数 */
  locals: WasmValue[];
  /** 戻りアドレス（呼び出し元のPC） */
  returnPc: number;
  /** 戻り時のスタック深さ */
  returnStackDepth: number;
  /** ブロックスタック */
  blockStack: BlockFrame[];
  /** プログラムカウンタ */
  pc: number;
}

/** ブロックフレーム（block/loop/if の制御構造） */
export interface BlockFrame {
  kind: 'block' | 'loop' | 'if';
  /** ブロック開始時のスタック深さ */
  stackDepth: number;
  /** ブロック結果の型 */
  resultType: ValType | 'void';
  /** ブロック開始PC（loopのbr先） */
  startPc: number;
  /** ブロック終了PC（block/ifのbr先） */
  endPc: number;
}

/** インポートされたホスト関数 */
export interface HostFunc {
  module: string;
  name: string;
  type: FuncType;
  /** ホスト関数の実装 */
  invoke: (args: WasmValue[]) => WasmValue[];
}

/* ---------- モジュール ---------- */

/** WASMモジュール（デコード済み） */
export interface WasmModule {
  /** 型セクション */
  types: FuncType[];
  /** インポートセクション */
  imports: ImportEntry[];
  /** 関数セクション（typeIndex配列） */
  functions: number[];
  /** テーブルセクション */
  tables: TableDef[];
  /** メモリセクション */
  memories: MemoryDef[];
  /** グローバルセクション */
  globals: Global[];
  /** エクスポートセクション */
  exports: ExportEntry[];
  /** startセクション（関数インデックス） */
  start?: number;
  /** エレメントセグメント */
  elements: ElementSegment[];
  /** コードセクション（関数本体） */
  codes: FuncBody[];
  /** データセグメント */
  data: DataSegment[];
}

/* ---------- シミュレーション ---------- */

/** イベント種別 */
export type WasmEventType =
  | 'decode'       // モジュールデコード
  | 'validate'     // バリデーション
  | 'instantiate'  // インスタンス化
  | 'stack_push'   // スタックプッシュ
  | 'stack_pop'    // スタックポップ
  | 'call'         // 関数呼び出し
  | 'return'       // 関数復帰
  | 'host_call'    // ホスト関数呼び出し
  | 'memory_read'  // メモリ読み取り
  | 'memory_write' // メモリ書き込み
  | 'memory_grow'  // メモリ成長
  | 'global_read'  // グローバル読取
  | 'global_write' // グローバル書込
  | 'branch'       // 分岐
  | 'table_call'   // テーブル経由呼出
  | 'trap'         // トラップ（実行エラー）
  | 'execute'      // 命令実行
  | 'block_enter'  // ブロック開始
  | 'block_exit';  // ブロック終了

/** イベント重要度 */
export type Severity = 'info' | 'detail' | 'warn' | 'error';

/** シミュレーションイベント */
export interface WasmEvent {
  type: WasmEventType;
  severity: Severity;
  message: string;
}

/** 実行スナップショット */
export interface StepSnapshot {
  step: number;
  /** 現在の命令 */
  instruction: string;
  /** オペランドスタック */
  stack: WasmValue[];
  /** コールスタック */
  callStack: { funcIndex: number; pc: number }[];
  /** ローカル変数 */
  locals: WasmValue[];
  /** グローバル変数 */
  globals: WasmValue[];
  /** メモリの使用ページ数 */
  memoryPages: number;
  /** メモリの注目領域 (先頭256バイト) */
  memoryPreview: number[];
  /** テーブル内容 */
  table: (number | null)[];
  /** 発生したイベント */
  events: WasmEvent[];
  /** 説明メッセージ */
  message: string;
}

/** シミュレーション結果 */
export interface WasmSimResult {
  steps: StepSnapshot[];
  /** 最終的な戻り値 */
  result: WasmValue[] | null;
  /** エクスポート一覧 */
  exports: ExportEntry[];
  /** 統計情報 */
  stats: {
    totalInstructions: number;
    maxStackDepth: number;
    maxCallDepth: number;
    memoryPeakPages: number;
    hostCalls: number;
    branches: number;
    traps: number;
  };
}

/** プリセット定義 */
export interface WasmPreset {
  name: string;
  description: string;
  build: () => WasmSimResult;
}
