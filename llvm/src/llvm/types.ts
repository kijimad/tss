/** ──── LLVM IR 型システム ──── */
export type IRType =
  | { kind: "void" }
  | { kind: "i1" }
  | { kind: "i8" }
  | { kind: "i16" }
  | { kind: "i32" }
  | { kind: "i64" }
  | { kind: "float" }
  | { kind: "double" }
  | { kind: "ptr"; pointee?: IRType }
  | { kind: "array"; elementType: IRType; length: number }
  | { kind: "struct"; name?: string; fields: IRType[] }
  | { kind: "function"; retType: IRType; paramTypes: IRType[] }
  | { kind: "label" };

/** 型を文字列に */
export function typeToString(t: IRType): string {
  switch (t.kind) {
    case "void": return "void";
    case "i1": case "i8": case "i16": case "i32": case "i64": return t.kind;
    case "float": return "float";
    case "double": return "double";
    case "ptr": return "ptr";
    case "array": return `[${t.length} x ${typeToString(t.elementType)}]`;
    case "struct": return t.name ? `%${t.name}` : `{ ${t.fields.map(typeToString).join(", ")} }`;
    case "function": return `${typeToString(t.retType)} (${t.paramTypes.map(typeToString).join(", ")})`;
    case "label": return "label";
  }
}

/** ──── SSA 値 ──── */
export interface SSAValue {
  name: string;            // %0, %x, @global 等
  type: IRType;
  defInsn?: string;        // 定義元の命令ID
  /** use-def チェーン: この値を使用している命令ID */
  uses: string[];
}

/** ──── LLVM IR 命令 ──── */
export type IROpcode =
  // 算術
  | "add" | "sub" | "mul" | "sdiv" | "udiv" | "srem" | "urem"
  | "fadd" | "fsub" | "fmul" | "fdiv" | "frem"
  // ビット演算
  | "and" | "or" | "xor" | "shl" | "lshr" | "ashr"
  // 比較
  | "icmp" | "fcmp"
  // 型変換
  | "sext" | "zext" | "trunc" | "bitcast" | "inttoptr" | "ptrtoint"
  | "sitofp" | "fptoui" | "fptosi" | "uitofp"
  // メモリ
  | "alloca" | "load" | "store" | "getelementptr"
  // 制御フロー
  | "br" | "br_cond" | "switch" | "ret" | "unreachable"
  // PHI / select
  | "phi" | "select"
  // 関数呼び出し
  | "call"
  // その他
  | "nop";

/** 比較述語 */
export type ICmpPred = "eq" | "ne" | "sgt" | "sge" | "slt" | "sle" | "ugt" | "uge" | "ult" | "ule";
export type FCmpPred = "oeq" | "one" | "ogt" | "oge" | "olt" | "ole" | "ord" | "uno";

/** 命令 */
export interface IRInsn {
  id: string;              // 一意ID
  op: IROpcode;
  result?: string;         // 結果レジスタ (%0 等)
  resultType?: IRType;
  operands: IROperand[];
  /** icmp/fcmp 用 */
  pred?: ICmpPred | FCmpPred;
  /** alloca 用: 確保する型 */
  allocaType?: IRType;
  /** GEP 用: インデックス列 */
  gepIndices?: IROperand[];
  /** phi ノード用 */
  phiIncoming?: { value: IROperand; block: string }[];
  /** call 用 */
  callee?: string;
  /** メタデータ/注釈 (最適化結果の説明等) */
  comment?: string;
  /** 最適化で削除された */
  eliminated?: boolean;
  /** 最適化で変更された */
  optimized?: boolean;
}

export type IROperand =
  | { kind: "reg"; name: string; type: IRType }     // %name
  | { kind: "const"; value: number; type: IRType }   // 即値
  | { kind: "label"; name: string }                  // ラベル
  | { kind: "global"; name: string; type: IRType }   // @name
  | { kind: "undef"; type: IRType };                 // undef

/** 基本ブロック */
export interface BasicBlock {
  label: string;
  insns: IRInsn[];
  preds: string[];          // 先行ブロック
  succs: string[];          // 後続ブロック
  /** 支配木 */
  idom?: string;            // 直接支配者
  domFrontier: string[];    // 支配境界
  /** ループ情報 */
  loopDepth: number;
  isLoopHeader: boolean;
}

/** 関数定義 */
export interface IRFunction {
  name: string;
  retType: IRType;
  params: { name: string; type: IRType }[];
  blocks: BasicBlock[];
  /** SSA 値テーブル */
  values: Map<string, SSAValue>;
}

/** モジュール (翻訳単位) */
export interface IRModule {
  functions: IRFunction[];
  globals: { name: string; type: IRType; init?: IROperand }[];
  structs: { name: string; fields: IRType[] }[];
}

/** ──── 最適化パス ──── */
export type PassKind =
  | "mem2reg"              // alloca → SSA (phi 挿入)
  | "constant_fold"        // 定数畳み込み
  | "dce"                  // 死コード除去
  | "instcombine"          // 命令結合
  | "gvn"                  // 大域値番号付け
  | "licm"                 // ループ不変式移動
  | "simplifycfg"          // CFG 単純化
  | "inline"               // 関数インライン化
  | "sroa"                 // スカラー置換
  | "tailcall";            // 末尾呼び出し最適化

export interface PassResult {
  pass: PassKind;
  description: string;
  changes: PassChange[];
  irBefore: string;        // テキスト形式 IR
  irAfter: string;
}

export interface PassChange {
  type: "eliminate" | "replace" | "insert" | "move" | "fold";
  target: string;            // 命令ID or ブロックラベル
  description: string;
  before?: string;
  after?: string;
}

/** ──── レジスタ割り当て ──── */
export interface LiveInterval {
  vreg: string;              // 仮想レジスタ名
  start: number;             // 生存開始位置
  end: number;               // 生存終了位置
  physReg?: string;          // 割り当てられた物理レジスタ
  spilled: boolean;          // スピル対象
  spillSlot?: number;        // スピルスロット番号
}

export interface InterferenceEdge {
  a: string;
  b: string;
}

export interface RegAllocResult {
  intervals: LiveInterval[];
  interference: InterferenceEdge[];
  physRegs: string[];        // 利用可能な物理レジスタ
  coloring: Map<string, string>;  // vreg → physReg
  spills: string[];
}

/** ──── コード生成 ──── */
export interface MachineInsn {
  op: string;                // mov, add, sub, cmp, jmp 等
  operands: string[];
  comment?: string;
}

/** ──── シミュレーション ──── */
export type SimOp =
  | { type: "define_module"; module: IRModule }
  | { type: "show_ir"; functionName: string }
  | { type: "run_pass"; functionName: string; pass: PassKind }
  | { type: "build_dom_tree"; functionName: string }
  | { type: "insert_phi"; functionName: string }
  | { type: "reg_alloc"; functionName: string; physRegs: string[] }
  | { type: "codegen"; functionName: string }
  | { type: "execute_ir"; functionName: string; args: number[] }
  | { type: "snapshot" };

/** イベント種別 */
export type EventType =
  | "ir"                     // IR 表示
  | "pass"                   // 最適化パス
  | "fold"                   // 定数畳み込み
  | "eliminate"              // 削除
  | "replace"                // 置換
  | "phi"                    // PHI ノード
  | "dom"                    // 支配木
  | "ssa"                    // SSA 変換
  | "regalloc"               // レジスタ割り当て
  | "spill"                  // スピル
  | "codegen"                // コード生成
  | "exec"                   // 実行
  | "cfg"                    // 制御フローグラフ
  | "info"
  | "error";

/** イベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  module: IRModule;
  passResults: PassResult[];
  regAlloc?: RegAllocResult;
  machineCode: MachineInsn[];
  execResult?: { retValue: number; output: string[] };
  stats: {
    totalInsns: number;
    eliminatedInsns: number;
    optimizedInsns: number;
    passesRun: number;
    phiNodes: number;
    registersUsed: number;
    spillCount: number;
    machineInsns: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
