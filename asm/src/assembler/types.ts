/**
 * types.ts — アセンブラシミュレータの型定義
 */

/** レジスタ名（x86-64 汎用レジスタ） */
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

/** オペランドの種類 */
export type OperandType = "register" | "immediate" | "memory" | "label";

/** オペランド */
export interface Operand {
  type: OperandType;
  value: string;
  /** 即値の場合の数値 */
  numValue?: number;
}

/** 命令のオペコード */
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

/** パース済みの命令 */
export interface Instruction {
  /** ソース行番号（0始まり） */
  line: number;
  /** ラベル（存在する場合） */
  label?: string;
  /** オペコード */
  opcode?: Opcode;
  /** オペランド配列 */
  operands: Operand[];
  /** 元のソーステキスト */
  source: string;
  /** コメント */
  comment?: string;
}

/** エンコード済みの命令 */
export interface EncodedInstruction {
  /** 元の命令 */
  instruction: Instruction;
  /** マシンコード（バイト配列） */
  bytes: number[];
  /** マシンコードの16進表現 */
  hex: string;
  /** セクション内のオフセット */
  offset: number;
  /** エンコードの説明 */
  encoding: string;
}

/** アセンブル結果のステップ */
export interface AssembleStep {
  phase: string;
  description: string;
  detail: string;
}

/** アセンブル結果 */
export interface AssembleResult {
  success: boolean;
  steps: AssembleStep[];
  /** パース済み命令 */
  instructions: Instruction[];
  /** エンコード結果 */
  encoded: EncodedInstruction[];
  /** ラベルテーブル */
  labels: Map<string, number>;
  /** エラー */
  errors: string[];
}
