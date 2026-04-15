/**
 * @module types
 * LLVM IR シミュレーターの型定義モジュール。
 * IR の型システム、SSA 値、命令、基本ブロック、関数、モジュール、
 * 最適化パス、レジスタ割り当て、コード生成、シミュレーションに
 * 必要な全てのデータ構造を定義する。
 */

/** ──── LLVM IR 型システム ────
 * LLVM IR で使用される全ての型を表す判別共用体。
 * void, 整数型 (i1〜i64), 浮動小数点型, ポインタ, 配列,
 * 構造体, 関数型, ラベルをサポートする。
 */
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

/**
 * IR 型を LLVM IR テキスト表現の文字列に変換する。
 * @param t - 変換対象の IR 型
 * @returns LLVM IR 形式の型文字列 (例: "i32", "[4 x i32]", "%MyStruct")
 */
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

/**
 * ──── SSA 値 ────
 * 静的単一代入 (SSA) 形式における値を表す。
 * 各値は一度だけ定義され、use-def チェーンにより
 * 使用箇所を追跡する。
 */
export interface SSAValue {
  name: string;            // %0, %x, @global 等
  type: IRType;
  defInsn?: string;        // 定義元の命令ID
  /** use-def チェーン: この値を使用している命令ID */
  uses: string[];
}

/**
 * ──── LLVM IR 命令オペコード ────
 * LLVM IR の全命令セットを表す文字列リテラル型。
 * 算術演算、ビット演算、比較、型変換、メモリ操作、
 * 制御フロー、PHI/select、関数呼び出しを含む。
 */
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

/** 整数比較述語 (icmp 命令用) — 符号付き/符号なしの比較条件 */
export type ICmpPred = "eq" | "ne" | "sgt" | "sge" | "slt" | "sle" | "ugt" | "uge" | "ult" | "ule";
/** 浮動小数点比較述語 (fcmp 命令用) — 順序付き/順序なしの比較条件 */
export type FCmpPred = "oeq" | "one" | "ogt" | "oge" | "olt" | "ole" | "ord" | "uno";

/**
 * LLVM IR 命令を表すインターフェース。
 * オペコード、結果レジスタ、オペランド、最適化メタデータを保持する。
 */
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

/**
 * IR 命令のオペランドを表す判別共用体。
 * レジスタ参照、即値定数、ラベル、グローバル変数、undef をサポートする。
 */
export type IROperand =
  | { kind: "reg"; name: string; type: IRType }     // %name
  | { kind: "const"; value: number; type: IRType }   // 即値
  | { kind: "label"; name: string }                  // ラベル
  | { kind: "global"; name: string; type: IRType }   // @name
  | { kind: "undef"; type: IRType };                 // undef

/**
 * 基本ブロック — 制御フローグラフ (CFG) の基本単位。
 * 直線的に実行される命令列と、前後のブロックへの接続、
 * 支配木情報、ループ情報を保持する。
 */
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

/**
 * IR 関数定義。
 * 名前、戻り値型、パラメータ、基本ブロック列、SSA 値テーブルで構成される。
 */
export interface IRFunction {
  name: string;
  retType: IRType;
  params: { name: string; type: IRType }[];
  blocks: BasicBlock[];
  /** SSA 値テーブル */
  values: Map<string, SSAValue>;
}

/**
 * IR モジュール — LLVM の翻訳単位に相当。
 * 関数定義、グローバル変数、構造体定義を含む。
 */
export interface IRModule {
  functions: IRFunction[];
  globals: { name: string; type: IRType; init?: IROperand }[];
  structs: { name: string; fields: IRType[] }[];
}

/**
 * ──── 最適化パス ────
 * LLVM の最適化パスの種類を表す文字列リテラル型。
 * 各パスは IR を変換して性能向上やコードサイズ削減を行う。
 */
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

/** 最適化パスの実行結果。パス前後の IR テキストと変更一覧を保持する。 */
export interface PassResult {
  pass: PassKind;
  description: string;
  changes: PassChange[];
  irBefore: string;        // テキスト形式 IR
  irAfter: string;
}

/** 最適化パスによる個々の変更内容を表す。 */
export interface PassChange {
  type: "eliminate" | "replace" | "insert" | "move" | "fold";
  target: string;            // 命令ID or ブロックラベル
  description: string;
  before?: string;
  after?: string;
}

/**
 * ──── レジスタ割り当て ────
 * 仮想レジスタの生存区間を表す。
 * 線形スキャンアルゴリズムで物理レジスタへの割り当てやスピルを決定する。
 */
export interface LiveInterval {
  vreg: string;              // 仮想レジスタ名
  start: number;             // 生存開始位置
  end: number;               // 生存終了位置
  physReg?: string;          // 割り当てられた物理レジスタ
  spilled: boolean;          // スピル対象
  spillSlot?: number;        // スピルスロット番号
}

/** 干渉グラフのエッジ — 同時に生存する2つの仮想レジスタの組。 */
export interface InterferenceEdge {
  a: string;
  b: string;
}

/** レジスタ割り当ての結果。生存区間、干渉グラフ、割り当てマッピング、スピル情報を含む。 */
export interface RegAllocResult {
  intervals: LiveInterval[];
  interference: InterferenceEdge[];
  physRegs: string[];        // 利用可能な物理レジスタ
  coloring: Map<string, string>;  // vreg → physReg
  spills: string[];
}

/**
 * ──── コード生成 ────
 * ターゲットマシン (x86-64) の命令を表す。
 * IR からの変換後に生成されるアセンブリ命令。
 */
export interface MachineInsn {
  op: string;                // mov, add, sub, cmp, jmp 等
  operands: string[];
  comment?: string;
}

/**
 * ──── シミュレーション ────
 * シミュレーション操作を表す判別共用体。
 * モジュール定義、IR 表示、最適化パス実行、支配木構築、
 * レジスタ割り当て、コード生成、IR 実行などの操作を定義する。
 */
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

/**
 * シミュレーション中に発生するイベントの種別。
 * UI のイベントログで色分け表示に使用される。
 */
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

/** シミュレーションイベント — ステップ番号、種別、説明、詳細を保持する。 */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
}

/**
 * シミュレーション全体の結果。
 * イベントログ、最適化後のモジュール、パス結果、レジスタ割り当て、
 * マシンコード、実行結果、統計情報を集約する。
 */
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

/**
 * 実験プリセット — セレクトボックスから選択可能な定義済みシミュレーション。
 * 名前、説明、操作列で構成される。
 */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
