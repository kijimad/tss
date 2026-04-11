/** ──── YARV 命令セット ──── */
export type Opcode =
  // スタック操作
  | "nop"
  | "putnil"
  | "putself"
  | "putobject"          // 即値 (Fixnum, Symbol, true/false, frozen string)
  | "putstring"          // 文字列オブジェクト生成
  | "putspecialobject"   // cbase, vm_core 等
  | "dup"
  | "dupn"
  | "pop"
  | "swap"
  | "topn"
  | "setn"
  | "adjuststack"
  | "newarray"
  | "newhash"
  | "newrange"
  | "concatstrings"
  | "tostring"
  | "splatarray"
  | "expandarray"

  // ローカル変数
  | "getlocal"           // EP[index, level]
  | "setlocal"
  | "getlocal_wc_0"      // 最適化版: level=0
  | "getlocal_wc_1"      // 最適化版: level=1
  | "setlocal_wc_0"
  | "setlocal_wc_1"

  // インスタンス変数
  | "getinstancevariable"
  | "setinstancevariable"

  // 定数
  | "getconstant"
  | "setconstant"

  // メソッド呼び出し
  | "send"               // 汎用メソッド呼び出し (callinfo + callcache)
  | "opt_send_without_block"
  | "invokesuper"
  | "invokeblock"
  | "leave"

  // 分岐
  | "jump"
  | "branchif"
  | "branchunless"
  | "branchnil"

  // スペシャル命令 (最適化)
  | "opt_plus"
  | "opt_minus"
  | "opt_mult"
  | "opt_div"
  | "opt_mod"
  | "opt_eq"
  | "opt_neq"
  | "opt_lt"
  | "opt_le"
  | "opt_gt"
  | "opt_ge"
  | "opt_ltlt"           // <<
  | "opt_aref"           // []
  | "opt_aset"           // []=
  | "opt_length"
  | "opt_size"
  | "opt_empty_p"
  | "opt_not"
  | "opt_str_freeze"
  | "opt_nil_p"

  // 定義
  | "definemethod"
  | "defineclass"
  | "definesmethod"      // 特異メソッド

  // 例外処理
  | "throw"              // break/next/return/retry/redo

  // ブロック
  | "once"               // BEGIN {} 用
  | "putiseq"            // ブロック用 ISeq をスタックに

  // トレース
  | "trace"

  // Fiber
  | "fiber_resume"
  | "fiber_yield";

/** 命令 */
export interface Insn {
  op: Opcode;
  operands: InsnOperand[];
  lineno: number;         // 対応するRubyソースの行番号
  pos: number;            // ISeq 内のオフセット
}

export type InsnOperand = number | string | boolean | null | CallInfo | InlineCache | CatchEntry[];

/** メソッド呼び出し情報 (ci) */
export interface CallInfo {
  mid: string;            // メソッド名
  argc: number;           // 引数の数
  flags: CallFlag[];
  blockIseq?: string;     // ブロック ISeq のラベル
  kw_arg?: string[];      // キーワード引数名
}

export type CallFlag =
  | "ARGS_SIMPLE"
  | "ARGS_SPLAT"
  | "ARGS_BLOCKARG"
  | "FCALL"               // 関数形式 (レシーバ省略)
  | "VCALL"               // 変数 or メソッド
  | "KW_SPLAT"
  | "TAILCALL";

/** インラインキャッシュ */
export interface InlineCache {
  classSerial: number;    // キャッシュされたクラスのシリアル番号
  methodEntry?: MethodEntry;
  hitCount: number;
  missCount: number;
}

/** メソッドエントリ */
export interface MethodEntry {
  owner: string;          // 定義元クラス名
  name: string;
  type: "iseq" | "cfunc" | "attr_reader" | "attr_writer" | "missing";
  iseqLabel?: string;     // ISeq メソッド本体
  visibility: "public" | "protected" | "private";
}

/** ──── ISeq (命令列) ──── */
export type ISeqType = "top" | "method" | "block" | "class" | "rescue" | "ensure" | "eval";

export interface ISeq {
  label: string;          // "<main>", "foo", "block in foo" 等
  type: ISeqType;
  path: string;           // ファイルパス
  insns: Insn[];
  localTable: LocalEntry[];
  catchTable: CatchEntry[];
  argInfo: ArgInfo;
  stackMax: number;       // スタックの最大深度
  parent?: string;        // 親 ISeq のラベル
}

export interface LocalEntry {
  name: string;
  index: number;
  kind: "arg" | "opt" | "rest" | "block" | "kw" | "local";
}

/** 引数情報 */
export interface ArgInfo {
  lead: number;           // 必須引数の数
  opt: number;            // オプション引数の数
  rest: boolean;          // *args
  post: number;           // rest 後の必須引数
  keyword: string[];      // キーワード引数名
  kwrest: boolean;        // **kwargs
  block: boolean;         // &block
}

/** catch table エントリ */
export interface CatchEntry {
  type: "rescue" | "ensure" | "retry" | "break" | "next" | "redo";
  iseq?: string;          // rescue/ensure 用の ISeq ラベル
  start: number;          // 範囲開始 (insn offset)
  end: number;            // 範囲終了
  cont: number;           // 継続先 (insn offset)
  sp: number;             // スタックポインタ調整値
}

/** ──── 制御フレーム (CFP) ──── */
export type FrameType = "METHOD" | "BLOCK" | "CLASS" | "TOP" | "CFUNC" | "EVAL" | "RESCUE" | "ENSURE" | "FIBER";

export interface ControlFrame {
  type: FrameType;
  iseqLabel: string;      // 実行中の ISeq
  pc: number;             // プログラムカウンタ
  sp: number;             // スタックポインタ (値スタック内の位置)
  ep: number;             // 環境ポインタ (ローカル変数環境)
  self: RubyValue;        // カレント self
  blockHandler?: string;  // ブロック ISeq ラベル
  methodName?: string;
  klass?: string;         // カレントクラス (cref)
}

/** ──── Ruby オブジェクト ──── */
export type RubyValueType =
  | "fixnum" | "float" | "string" | "symbol" | "array" | "hash"
  | "true" | "false" | "nil"
  | "class" | "module" | "proc" | "range" | "object"
  | "fiber";

export interface RubyValue {
  type: RubyValueType;
  klass: string;          // 所属クラス名
  value: unknown;         // 実際の値
  objectId: number;
  frozen: boolean;
  ivars: Record<string, RubyValue>;   // インスタンス変数
  flags: ObjectFlag[];
}

export type ObjectFlag = "FROZEN" | "TAINTED" | "MARKED" | "OLD_GEN" | "WB_PROTECTED";

/** ──── Fiber ──── */
export interface FiberState {
  id: number;
  status: "created" | "running" | "suspended" | "dead";
  stack: RubyValue[];
  cfp: ControlFrame[];
  transferValue?: RubyValue;
}

/** ──── GC ──── */
export interface GCState {
  heapPages: HeapPage[];
  totalAllocated: number;
  totalFreed: number;
  gcCount: number;
  phase: "none" | "marking" | "sweeping";
  markStack: number[];    // object ID のスタック
  lastGcReason?: string;
}

export interface HeapPage {
  id: number;
  slots: HeapSlot[];
  freeCount: number;
}

export interface HeapSlot {
  objectId: number | null;   // null = 空きスロット
  marked: boolean;
}

/** ──── VM 状態 ──── */
export interface VMState {
  stack: RubyValue[];        // 値スタック (全フレーム共有)
  cfpStack: ControlFrame[];  // 制御フレームスタック
  iseqs: Map<string, ISeq>;  // ラベル → ISeq
  methods: Map<string, Map<string, MethodEntry>>; // クラス名 → メソッド名 → エントリ
  constants: Map<string, RubyValue>;
  globals: Map<string, RubyValue>;
  classes: Map<string, ClassInfo>;
  gc: GCState;
  fibers: FiberState[];
  currentFiberId: number;
  objectIdCounter: number;
  classSerialCounter: number;
  output: string[];          // 出力バッファ
}

export interface ClassInfo {
  name: string;
  superclass?: string;
  modules: string[];         // include されたモジュール
  serial: number;            // インラインキャッシュ用
  ancestors: string[];       // メソッド探索順序
}

/** ──── シミュレーション ──── */
export type SimOp =
  // ISeq の定義
  | { type: "define_iseq"; iseq: ISeq }
  // クラス/メソッド の定義
  | { type: "define_class"; name: string; superclass?: string; modules?: string[] }
  | { type: "define_method"; klass: string; entry: MethodEntry }
  // 実行
  | { type: "execute"; iseqLabel: string; maxSteps?: number }
  // GC
  | { type: "gc_trigger"; reason: string }
  // Fiber
  | { type: "fiber_create"; iseqLabel: string }
  // インラインキャッシュ確認
  | { type: "check_cache"; mid: string; receiver: string }
  // スナップショット
  | { type: "snapshot" };

/** イベント種別 */
export type EventType =
  | "insn"                   // 命令実行
  | "opt_insn"               // スペシャル命令
  | "stack"                  // スタック操作
  | "frame_push"             // フレームプッシュ
  | "frame_pop"              // フレームポップ
  | "method_dispatch"        // メソッドディスパッチ
  | "cache_hit"              // インラインキャッシュヒット
  | "cache_miss"             // インラインキャッシュミス
  | "local_access"           // ローカル変数アクセス (EP 経由)
  | "ivar_access"            // インスタンス変数
  | "catch"                  // 例外捕捉
  | "throw"                  // throw (break/next/return)
  | "block"                  // ブロック関連
  | "gc_mark"                // GC マーキング
  | "gc_sweep"               // GC スイープ
  | "gc_alloc"               // オブジェクト割り当て
  | "fiber"                  // Fiber 操作
  | "define"                 // 定義 (メソッド/クラス)
  | "output"                 // puts/print
  | "trace"                  // トレースポイント
  | "info"
  | "error";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
  /** 命令実行時のスタック状態 */
  stackSnapshot?: string[];
  /** フレーム情報 */
  frameInfo?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  vm: VMState;
  stats: {
    totalInsns: number;
    optInsns: number;        // スペシャル命令の実行回数
    cacheHits: number;
    cacheMisses: number;
    framePushes: number;
    framePops: number;
    gcRuns: number;
    objectsAllocated: number;
    objectsFreed: number;
    methodCalls: number;
    blockCalls: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
