/**
 * types.ts — アセンブラシミュレータの型定義
 *
 * このモジュールは、アセンブラシミュレータ全体で使用される
 * 型（インターフェース・型エイリアス）を定義する。
 *
 * アセンブリ言語の処理は大きく以下のフローで進む:
 *   ソースコード → パース(Instruction) → エンコード(EncodedInstruction) → マシンコード(バイト列)
 *
 * 各段階で使われるデータ構造をここで一元管理し、
 * パーサ(parser.ts)、エンコーダ(encoder.ts)、アセンブラ(assembler.ts) から参照する。
 */

/**
 * レジスタ名（x86-64 汎用レジスタ）
 *
 * x86-64 アーキテクチャのレジスタは以下のサイズ階層を持つ:
 *   - 64bit: rax, rbx, rcx, rdx, rsi, rdi, rsp, rbp, r8〜r15
 *   - 32bit: eax, ebx, ecx, edx, esi, edi, esp, ebp（64bitレジスタの下位32ビット）
 *   - 16bit: ax, bx, cx, dx（下位16ビット）
 *   -  8bit: al/ah, bl/bh, cl/ch, dl/dh（下位/上位8ビット）
 *
 * 特殊用途レジスタ:
 *   - rsp: スタックポインタ（現在のスタックトップを指す）
 *   - rbp: ベースポインタ（関数のスタックフレームの基底を指す）
 *   - rsi/rdi: System V AMD64 ABI で引数渡しにも使用
 *   - r8〜r15: x86-64 で追加された拡張レジスタ（REXプレフィックスが必要）
 */
export type Register =
  | "rax" | "rbx" | "rcx" | "rdx"
  | "rsi" | "rdi" | "rsp" | "rbp"
  | "r8"  | "r9"  | "r10" | "r11"
  | "r12" | "r13" | "r14" | "r15"
  | "eax" | "ebx" | "ecx" | "edx"
  | "esi" | "edi" | "esp" | "ebp"
  | "ax"  | "bx"  | "cx"  | "dx"
  | "al"  | "bl"  | "cl"  | "dl"
  | "ah"  | "bh"  | "ch"  | "dh";

/**
 * オペランドの種類（アドレッシングモード分類）
 *
 * アセンブリ命令のオペランドは以下の4種類に分類される:
 *   - register:  レジスタ直接参照 (例: rax, ebx)
 *   - immediate: 即値（命令に直接埋め込まれる定数）(例: 42, 0xFF)
 *   - memory:    メモリ間接参照 (例: [rsp], [rbp-8])
 *   - label:     ラベル参照（アセンブラが解決するシンボル名）(例: loop, _start)
 */
export type OperandType = "register" | "immediate" | "memory" | "label";

/**
 * オペランド
 *
 * パーサが解析した個々のオペランドを表す。
 * type でアドレッシングモードを示し、value に元の文字列表現を保持する。
 */
export interface Operand {
  /** オペランドの種類（レジスタ/即値/メモリ/ラベル） */
  type: OperandType;
  /** オペランドの文字列表現（例: "rax", "42", "[rsp]", "loop"） */
  value: string;
  /** 即値の場合の数値（10進・16進を解析済み）。レジスタやラベルの場合は undefined */
  numValue?: number;
}

/**
 * 命令のオペコード（ニーモニック）
 *
 * ニーモニックは人間が読みやすい命令名であり、
 * エンコーダがこれを対応するマシンコード（オペコードバイト列）に変換する。
 *
 * カテゴリ別:
 *   - データ転送:    mov, lea, push, pop
 *   - 算術演算:      add, sub, mul, imul, div, idiv, inc, dec, neg
 *   - 論理演算:      and, or, xor, not
 *   - シフト:        shl(左シフト), shr(論理右シフト), sar(算術右シフト)
 *   - 比較・テスト:  cmp(フラグ設定用減算), test(フラグ設定用AND)
 *   - 分岐(無条件):  jmp
 *   - 分岐(条件付き): je/jz(等しい), jne/jnz(等しくない), jg(より大), jge(以上), jl(より小), jle(以下)
 *   - 関数呼び出し:  call, ret
 *   - システム:      nop(何もしない), int(割り込み), syscall(システムコール), hlt(停止)
 */
export type Opcode =
  | "mov" | "add" | "sub" | "mul" | "imul" | "div" | "idiv"
  | "and" | "or"  | "xor" | "not" | "shl" | "shr" | "sar"
  | "cmp" | "test"
  | "jmp" | "je"  | "jne" | "jg"  | "jge" | "jl"  | "jle" | "jz" | "jnz"
  | "push" | "pop"
  | "call" | "ret"
  | "inc" | "dec" | "neg"
  | "lea"
  | "nop" | "int" | "syscall" | "hlt";

/**
 * パース済みの命令
 *
 * パーサがソースの1行から抽出した情報を格納する。
 * ラベル定義のみの行や、コメントのみの行も Instruction として表現される。
 * opcode が undefined の場合は命令本体がない行（ラベルのみ、コメントのみ等）を示す。
 */
export interface Instruction {
  /** ソース行番号（0始まり）。エラー報告時の行特定に使用 */
  line: number;
  /** ラベル（存在する場合）。パス1でアドレスをシンボルテーブルに登録する際のキー */
  label?: string;
  /** オペコード（ニーモニック）。ラベルのみの行では undefined */
  opcode?: Opcode;
  /** オペランド配列。命令に応じて0〜2個。例: mov rax, rbx → [rax, rbx] */
  operands: Operand[];
  /** 元のソーステキスト（表示用に保持。コメントも含む原文） */
  source: string;
  /** セミコロン以降のコメント部分（存在する場合） */
  comment?: string;
}

/**
 * エンコード済みの命令
 *
 * エンコーダがニーモニックをマシンコードに変換した結果を格納する。
 * x86-64 の命令フォーマットは可変長で、以下の要素で構成される:
 *   [REXプレフィックス] [オペコード] [ModR/M] [SIB] [ディスプレースメント] [即値]
 * bytes 配列にこれらが順に格納される。
 */
export interface EncodedInstruction {
  /** 元のパース済み命令（ソース情報の参照用） */
  instruction: Instruction;
  /** マシンコード（バイト配列）。x86-64 の可変長命令をリトルエンディアンで格納 */
  bytes: number[];
  /** マシンコードの16進表現（表示用。例: "48 89 d8"） */
  hex: string;
  /** .text セクション内のオフセット（バイト単位）。命令の配置アドレス */
  offset: number;
  /** エンコードの説明文（REX, ModR/M 等の各バイトの役割を記述） */
  encoding: string;
}

/**
 * アセンブル結果のステップ
 *
 * アセンブル処理の各段階（パース → パス1 → パス2 → ヘックスダンプ）を
 * ユーザに可視化するための情報。UI でステップバイステップ表示に使用する。
 */
export interface AssembleStep {
  /** 処理フェーズ名（例: "パース", "パス1: ラベル収集", "パス2: エンコード"） */
  phase: string;
  /** フェーズの概要説明（例: "5 命令, 2 ラベル"） */
  description: string;
  /** フェーズの詳細情報（複数行テキスト。命令一覧やアドレス表など） */
  detail: string;
}

/**
 * アセンブル結果
 *
 * assemble() 関数の最終出力。2パスアセンブルの全結果を集約する。
 * 成功時は encoded にマシンコードが、失敗時は errors にエラー情報が格納される。
 */
export interface AssembleResult {
  /** アセンブルが成功したかどうか（エラーが0件なら true） */
  success: boolean;
  /** 処理の各段階を記録したステップ情報（UI表示用） */
  steps: AssembleStep[];
  /** パース済み命令の配列（パーサの出力そのもの） */
  instructions: Instruction[];
  /** エンコード結果の配列（パス2の出力。各命令のマシンコードとメタ情報） */
  encoded: EncodedInstruction[];
  /** ラベル（シンボル）テーブル。パス1で構築され、パス2でアドレス解決に使用される */
  labels: Map<string, number>;
  /** エラーメッセージの配列（パースエラー、重複ラベル、未定義ラベル等） */
  errors: string[];
}
