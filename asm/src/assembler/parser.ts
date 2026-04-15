/**
 * parser.ts — アセンブリソースの字句・構文解析
 *
 * アセンブラの最初の処理段階であるパーサ（構文解析器）を実装する。
 * ソーステキストを1行ずつ走査し、以下の要素を抽出する:
 *   - ラベル定義 (例: "loop:", "_start:")
 *   - ニーモニック（オペコード） (例: "mov", "add", "jmp")
 *   - オペランド (例: "rax", "42", "[rsp]", "loop")
 *   - コメント (セミコロン ";" 以降)
 *
 * パーサはアセンブルの2パス処理のうち、両パスの前段階として
 * ソースコードを構造化データ (Instruction[]) に変換する役割を担う。
 *
 * x86/x86-64 のアセンブリ構文（Intel記法）:
 *   [ラベル:] ニーモニック オペランド1 [, オペランド2] [; コメント]
 */

import type { Instruction, Operand, OperandType, Opcode } from "./types.js";

/**
 * 有効なオペコード（ニーモニック）一覧
 *
 * このシミュレータがサポートする全命令セットをSetで管理する。
 * パース時にトークンがこのSetに含まれるかで、有効な命令かどうかを判定する。
 * 含まれないトークンは「不明な命令」としてエラー報告される。
 */
const VALID_OPCODES = new Set<string>([
  /* データ転送 */      "mov", "lea", "push", "pop",
  /* 算術演算 */        "add", "sub", "mul", "imul", "div", "idiv", "inc", "dec", "neg",
  /* 論理演算 */        "and", "or",  "xor", "not",
  /* シフト演算 */      "shl", "shr", "sar",
  /* 比較・テスト */    "cmp", "test",
  /* 無条件分岐 */      "jmp",
  /* 条件分岐 */        "je",  "jne", "jg",  "jge", "jl",  "jle", "jz", "jnz",
  /* 関数呼び出し */    "call", "ret",
  /* システム・制御 */  "nop", "int", "syscall", "hlt",
]);

/**
 * レジスタ名の集合
 *
 * x86-64 の全汎用レジスタ名を小文字で保持する。
 * オペランド解析時に、トークンがレジスタ名かどうかの判定に使用する。
 * 大文字・小文字の区別なく処理するため、比較時に toLowerCase() を適用する。
 */
const REGISTERS = new Set<string>([
  /* 64bit 汎用レジスタ */    "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rsp", "rbp",
  /* 64bit 拡張レジスタ */    "r8",  "r9",  "r10", "r11", "r12", "r13", "r14", "r15",
  /* 32bit レジスタ */        "eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp",
  /* 16bit レジスタ */        "ax",  "bx",  "cx",  "dx",
  /* 8bit 下位レジスタ */     "al",  "bl",  "cl",  "dl",
  /* 8bit 上位レジスタ */     "ah",  "bh",  "ch",  "dh",
]);

/** オペランドの種別を判定してパースする */
export function parseOperand(raw: string): Operand {
  const trimmed = raw.trim();

  // メモリ参照: [rax], [rbp-8], [rsp+16] など
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return { type: "memory" as OperandType, value: trimmed };
  }

  // レジスタ
  if (REGISTERS.has(trimmed.toLowerCase())) {
    return { type: "register" as OperandType, value: trimmed.toLowerCase() };
  }

  // 即値: 10進数、16進数 (0x...)、負数
  if (/^-?(?:0x[\da-fA-F]+|\d+)$/.test(trimmed)) {
    const num = trimmed.startsWith("0x") || trimmed.startsWith("-0x")
      ? parseInt(trimmed, 16)
      : parseInt(trimmed, 10);
    return { type: "immediate" as OperandType, value: trimmed, numValue: num };
  }

  // ラベル参照
  return { type: "label" as OperandType, value: trimmed };
}

/** アセンブリソースを1行ずつパースする */
export function parse(source: string): { instructions: Instruction[]; errors: string[] } {
  const lines = source.split("\n");
  const instructions: Instruction[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // コメントを抽出
    let comment: string | undefined;
    const commentIdx = line.indexOf(";");
    if (commentIdx !== -1) {
      comment = line.slice(commentIdx + 1).trim();
      line = line.slice(0, commentIdx);
    }

    line = line.trim();

    // 空行
    if (line === "") {
      if (comment) {
        instructions.push({
          line: i,
          operands: [],
          source: lines[i]!,
          comment,
        });
      }
      continue;
    }

    // ラベルの検出
    let label: string | undefined;
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const potentialLabel = line.slice(0, colonIdx).trim();
      // ラベルはオペコードではなく識別子であること
      if (/^[a-zA-Z_]\w*$/.test(potentialLabel)) {
        label = potentialLabel;
        line = line.slice(colonIdx + 1).trim();
      }
    }

    // ラベルのみの行
    if (line === "") {
      instructions.push({
        line: i,
        label,
        operands: [],
        source: lines[i]!,
        comment,
      });
      continue;
    }

    // オペコードとオペランドを分割
    const parts = line.split(/\s+/);
    const opcodeStr = parts[0]!.toLowerCase();

    if (!VALID_OPCODES.has(opcodeStr)) {
      errors.push(`行 ${i + 1}: 不明な命令 '${opcodeStr}'`);
      instructions.push({
        line: i,
        label,
        operands: [],
        source: lines[i]!,
        comment,
      });
      continue;
    }

    const opcode = opcodeStr as Opcode;

    // オペランド部分を結合してカンマで分割
    const operandStr = parts.slice(1).join(" ").trim();
    const operands: Operand[] = [];
    if (operandStr) {
      // カンマ分割（ただしブラケット内のカンマは無視）
      const rawOperands = splitOperands(operandStr);
      for (const raw of rawOperands) {
        operands.push(parseOperand(raw));
      }
    }

    instructions.push({
      line: i,
      label,
      opcode,
      operands,
      source: lines[i]!,
      comment,
    });
  }

  return { instructions, errors };
}

/** オペランド文字列をカンマで分割（ブラケット内は無視） */
function splitOperands(s: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;

  for (const ch of s) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}
