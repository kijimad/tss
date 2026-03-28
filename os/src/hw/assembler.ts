/**
 * assembler.ts — アセンブリ言語 → マシンコード変換
 *
 * テキストのアセンブリ命令を4バイトの命令にエンコードする。
 * カーネルやユーザプログラムをアセンブリで書いてメモリにロードするために使う。
 *
 * 例:
 *   MOVI R0, 42     → [0x02, 0x00, 0x2A, 0x00]
 *   ADD R0, R1      → [0x10, 0x00, 0x01, 0x00]
 *   JMP 0x0100      → [0x40, 0x00, 0x00, 0x01]
 *   SYSCALL         → [0x50, 0x00, 0x00, 0x00]
 */
import { OpCode, Register } from "./types.js";

// レジスタ名 → 番号のマップ
const REG_MAP: Record<string, number | undefined> = {
  R0: Register.R0, R1: Register.R1, R2: Register.R2, R3: Register.R3,
  R4: Register.R4, R5: Register.R5, R6: Register.R6, R7: Register.R7,
  PC: Register.PC, SP: Register.SP,
};

// ニーモニック → OpCode のマップ
const OP_MAP: Record<string, number | undefined> = {
  MOV: OpCode.MOV, MOVI: OpCode.MOVI, LOAD: OpCode.LOAD, STORE: OpCode.STORE,
  PUSH: OpCode.PUSH, POP: OpCode.POP,
  ADD: OpCode.ADD, SUB: OpCode.SUB, MUL: OpCode.MUL, DIV: OpCode.DIV,
  MOD: OpCode.MOD, ADDI: OpCode.ADDI,
  AND: OpCode.AND, OR: OpCode.OR, XOR: OpCode.XOR, NOT: OpCode.NOT,
  SHL: OpCode.SHL, SHR: OpCode.SHR,
  CMP: OpCode.CMP, CMPI: OpCode.CMPI,
  JMP: OpCode.JMP, JZ: OpCode.JZ, JNZ: OpCode.JNZ, JG: OpCode.JG, JL: OpCode.JL,
  CALL: OpCode.CALL, RET: OpCode.RET,
  SYSCALL: OpCode.SYSCALL, HALT: OpCode.HALT, NOP: OpCode.NOP,
  IRET: OpCode.IRET, CLI: OpCode.CLI, STI: OpCode.STI,
};

// 引数を取らない命令
const NO_OPERANDS = new Set(["RET", "SYSCALL", "HALT", "NOP", "IRET", "CLI", "STI"]);
// op1=レジスタ、op2=レジスタ
const REG_REG = new Set(["MOV", "ADD", "SUB", "MUL", "DIV", "MOD", "AND", "OR", "XOR", "SHL", "SHR", "CMP", "LOAD", "STORE"]);
// op1=レジスタ、op2=即値
const REG_IMM = new Set(["MOVI", "ADDI", "CMPI"]);
// op1=レジスタのみ
const REG_ONLY = new Set(["PUSH", "POP", "NOT"]);
// op2=アドレス（即値）
const ADDR_ONLY = new Set(["JMP", "JZ", "JNZ", "JG", "JL", "CALL"]);

// アセンブリテキスト → バイナリに変換
// baseAddr: メモリ上のロードアドレス（ラベルの絶対アドレス計算に使う）
export function assemble(source: string, baseAddr = 0): Uint8Array {
  const lines = source.split("\n");
  const instructions: number[] = [];
  // ラベル → 絶対アドレスのマップ
  const labels = new Map<string, number>();
  // 未解決のラベル参照
  const labelRefs: { index: number; label: string }[] = [];

  let address = baseAddr;

  // 1パス目: ラベル収集 + 命令エンコード
  for (const rawLine of lines) {
    const line = rawLine.replace(/;.*$/, "").trim(); // コメント除去
    if (line === "") continue;

    // ラベル定義: "label:"
    if (line.endsWith(":")) {
      labels.set(line.slice(0, -1), address);
      continue;
    }

    // 命令をパース
    const parts = line.split(/[\s,]+/).filter(p => p.length > 0);
    const mnemonic = parts[0]?.toUpperCase() ?? "";
    const opcode = OP_MAP[mnemonic];
    if (opcode === undefined) {
      throw new Error(`不明な命令: ${mnemonic} (行: ${line})`);
    }

    let op1 = 0;
    let op2 = 0;

    if (NO_OPERANDS.has(mnemonic)) {
      // 引数なし
    } else if (REG_REG.has(mnemonic)) {
      op1 = parseRegister(parts[1] ?? "");
      op2 = parseRegister(parts[2] ?? "");
    } else if (REG_IMM.has(mnemonic)) {
      op1 = parseRegister(parts[1] ?? "");
      op2 = parseImmediate(parts[2] ?? "0");
    } else if (REG_ONLY.has(mnemonic)) {
      op1 = parseRegister(parts[1] ?? "");
    } else if (ADDR_ONLY.has(mnemonic)) {
      const addrStr = parts[1] ?? "0";
      // ラベル参照か即値アドレスか
      if (/^[a-zA-Z_]/.test(addrStr)) {
        labelRefs.push({ index: instructions.length, label: addrStr });
        op2 = 0; // 後で解決
      } else {
        op2 = parseImmediate(addrStr);
      }
    }

    instructions.push(opcode, op1, op2 & 0xFF, (op2 >> 8) & 0xFF);
    address += 4;
  }

  // 2パス目: ラベル参照を解決
  for (const ref of labelRefs) {
    const addr = labels.get(ref.label);
    if (addr === undefined) {
      throw new Error(`未定義のラベル: ${ref.label}`);
    }
    // op2 の位置（命令の3-4バイト目）に書き込む
    instructions[ref.index + 2] = addr & 0xFF;
    instructions[ref.index + 3] = (addr >> 8) & 0xFF;
  }

  return new Uint8Array(instructions);
}

function parseRegister(s: string): number {
  const upper = s.toUpperCase();
  const reg = REG_MAP[upper];
  if (reg === undefined) {
    throw new Error(`不明なレジスタ: ${s}`);
  }
  return reg;
}

function parseImmediate(s: string): number {
  if (s.startsWith("0x") || s.startsWith("0X")) {
    return parseInt(s, 16) & 0xFFFF;
  }
  return Number(s) & 0xFFFF;
}
