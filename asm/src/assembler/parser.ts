/**
 * parser.ts — アセンブリソースの字句・構文解析
 */

import type { Instruction, Operand, OperandType, Opcode } from "./types.js";

/** 有効なオペコード一覧 */
const VALID_OPCODES = new Set<string>([
  "mov", "add", "sub", "mul", "imul", "div", "idiv",
  "and", "or",  "xor", "not", "shl", "shr", "sar",
  "cmp", "test",
  "jmp", "je",  "jne", "jg",  "jge", "jl",  "jle", "jz", "jnz",
  "push", "pop",
  "call", "ret",
  "inc", "dec", "neg",
  "lea",
  "nop", "int", "syscall", "hlt",
]);

/** レジスタ名の集合 */
const REGISTERS = new Set<string>([
  "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rsp", "rbp",
  "r8",  "r9",  "r10", "r11", "r12", "r13", "r14", "r15",
  "eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp",
  "ax",  "bx",  "cx",  "dx",
  "al",  "bl",  "cl",  "dl",
  "ah",  "bh",  "ch",  "dh",
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
