/**
 * encoder.ts — 命令からマシンコードへのエンコード
 *
 * x86-64 の実際のエンコーディングを簡略化しつつも
 * REX プレフィックス、ModR/M、即値などの構造を再現する。
 */

import type { Instruction, EncodedInstruction } from "./types.js";

/** レジスタの番号 (ModR/M の reg/rm フィールド用) */
const REG_NUM: Record<string, number> = {
  rax: 0, eax: 0, ax: 0, al: 0, ah: 4,
  rcx: 1, ecx: 1, cx: 1, cl: 1, ch: 5,
  rdx: 2, edx: 2, dx: 2, dl: 2, dh: 6,
  rbx: 3, ebx: 3, bx: 3, bl: 3, bh: 7,
  rsp: 4, esp: 4,
  rbp: 5, ebp: 5,
  rsi: 6, esi: 6,
  rdi: 7, edi: 7,
  r8: 0, r9: 1, r10: 2, r11: 3,
  r12: 4, r13: 5, r14: 6, r15: 7,
};

/** 64ビットレジスタかどうか */
function is64bit(reg: string): boolean {
  return reg.startsWith("r") && !reg.startsWith("r8") || ["r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"].includes(reg);
}

/** 拡張レジスタ (r8-r15) かどうか */
function isExtended(reg: string): boolean {
  return ["r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"].includes(reg);
}

/** REX プレフィックスを生成 */
function rexPrefix(w: boolean, r: boolean, x: boolean, b: boolean): number {
  return 0x40 | (w ? 8 : 0) | (r ? 4 : 0) | (x ? 2 : 0) | (b ? 1 : 0);
}

/** ModR/M バイトを生成 */
function modRM(mod: number, reg: number, rm: number): number {
  return ((mod & 3) << 6) | ((reg & 7) << 3) | (rm & 7);
}

/** 即値をリトルエンディアンのバイト配列に変換 */
function immBytes(value: number, size: number): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < size; i++) {
    bytes.push((value >> (i * 8)) & 0xff);
  }
  return bytes;
}

/** エンコード説明を生成 */
function describeBytes(parts: { name: string; bytes: number[] }[]): string {
  return parts
    .filter((p) => p.bytes.length > 0)
    .map((p) => `${p.name}=${p.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`)
    .join("  ");
}

/** 1命令をエンコードする */
export function encodeInstruction(
  inst: Instruction,
  offset: number,
  labels: Map<string, number>,
): EncodedInstruction {
  if (!inst.opcode) {
    return {
      instruction: inst,
      bytes: [],
      hex: "",
      offset,
      encoding: inst.label ? `ラベル定義: ${inst.label}` : "(空行/コメント)",
    };
  }

  const op = inst.opcode;
  const ops = inst.operands;
  let bytes: number[] = [];
  let encoding = "";

  switch (op) {
    // ── MOV ──
    case "mov": {
      if (ops[0]?.type === "register" && ops[1]?.type === "register") {
        // mov reg, reg → REX.W + 89 /r
        const dst = ops[0].value;
        const src = ops[1].value;
        const w = is64bit(dst) || is64bit(src);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w || isExtended(dst) || isExtended(src)) {
          const rex = rexPrefix(w, isExtended(src), false, isExtended(dst));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0x89);
        const modrm = modRM(3, REG_NUM[src] ?? 0, REG_NUM[dst] ?? 0);
        bytes.push(modrm);
        parts.push({ name: "opcode", bytes: [0x89] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        encoding = describeBytes(parts);
      } else if (ops[0]?.type === "register" && ops[1]?.type === "immediate") {
        // mov reg, imm → REX.W + B8+rd id
        const dst = ops[0].value;
        const imm = ops[1].numValue ?? 0;
        const w = is64bit(dst);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w || isExtended(dst)) {
          const rex = rexPrefix(w, false, false, isExtended(dst));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        const opByte = 0xb8 + ((REG_NUM[dst] ?? 0) & 7);
        bytes.push(opByte);
        parts.push({ name: "opcode", bytes: [opByte] });
        const immB = immBytes(imm, w ? 4 : 4);
        bytes.push(...immB);
        parts.push({ name: "imm32", bytes: immB });
        encoding = describeBytes(parts);
      } else if (ops[0]?.type === "register" && ops[1]?.type === "memory") {
        // mov reg, [mem]
        const dst = ops[0].value;
        const w = is64bit(dst);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w) {
          const rex = rexPrefix(w, false, false, false);
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0x8b);
        const modrm = modRM(0, REG_NUM[dst] ?? 0, 5);
        bytes.push(modrm);
        bytes.push(...immBytes(0, 4));
        parts.push({ name: "opcode", bytes: [0x8b] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        parts.push({ name: "disp32", bytes: immBytes(0, 4) });
        encoding = describeBytes(parts);
      } else if (ops[0]?.type === "memory" && ops[1]?.type === "register") {
        // mov [mem], reg
        const src = ops[1].value;
        const w = is64bit(src);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w) {
          const rex = rexPrefix(w, false, false, false);
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0x89);
        const modrm = modRM(0, REG_NUM[src] ?? 0, 5);
        bytes.push(modrm);
        bytes.push(...immBytes(0, 4));
        parts.push({ name: "opcode", bytes: [0x89] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        parts.push({ name: "disp32", bytes: immBytes(0, 4) });
        encoding = describeBytes(parts);
      } else {
        bytes = [0x90]; // フォールバック
        encoding = "未対応のオペランド組み合わせ";
      }
      break;
    }

    // ── ADD / SUB / AND / OR / XOR / CMP ──
    case "add": case "sub": case "and": case "or": case "xor": case "cmp": {
      const aluOps: Record<string, { regOp: number; immExt: number }> = {
        add: { regOp: 0x01, immExt: 0 },
        or:  { regOp: 0x09, immExt: 1 },
        and: { regOp: 0x21, immExt: 4 },
        sub: { regOp: 0x29, immExt: 5 },
        xor: { regOp: 0x31, immExt: 6 },
        cmp: { regOp: 0x39, immExt: 7 },
      };
      const info = aluOps[op]!;

      if (ops[0]?.type === "register" && ops[1]?.type === "register") {
        const dst = ops[0].value;
        const src = ops[1].value;
        const w = is64bit(dst) || is64bit(src);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w || isExtended(dst) || isExtended(src)) {
          const rex = rexPrefix(w, isExtended(src), false, isExtended(dst));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(info.regOp);
        const modrm = modRM(3, REG_NUM[src] ?? 0, REG_NUM[dst] ?? 0);
        bytes.push(modrm);
        parts.push({ name: "opcode", bytes: [info.regOp] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        encoding = describeBytes(parts);
      } else if (ops[0]?.type === "register" && ops[1]?.type === "immediate") {
        const dst = ops[0].value;
        const imm = ops[1].numValue ?? 0;
        const w = is64bit(dst);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w || isExtended(dst)) {
          const rex = rexPrefix(w, false, false, isExtended(dst));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0x81);
        const modrm = modRM(3, info.immExt, REG_NUM[dst] ?? 0);
        bytes.push(modrm);
        const immB = immBytes(imm, 4);
        bytes.push(...immB);
        parts.push({ name: "opcode", bytes: [0x81] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        parts.push({ name: "imm32", bytes: immB });
        encoding = describeBytes(parts);
      } else {
        bytes = [info.regOp, 0xc0];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── INC / DEC / NEG / NOT ──
    case "inc": case "dec": case "neg": case "not": {
      const unaryInfo: Record<string, { op: number; ext: number }> = {
        inc: { op: 0xff, ext: 0 },
        dec: { op: 0xff, ext: 1 },
        neg: { op: 0xf7, ext: 3 },
        not: { op: 0xf7, ext: 2 },
      };
      const info = unaryInfo[op]!;
      if (ops[0]?.type === "register") {
        const reg = ops[0].value;
        const w = is64bit(reg);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w || isExtended(reg)) {
          const rex = rexPrefix(w, false, false, isExtended(reg));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(info.op);
        const modrm = modRM(3, info.ext, REG_NUM[reg] ?? 0);
        bytes.push(modrm);
        parts.push({ name: "opcode", bytes: [info.op] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        encoding = describeBytes(parts);
      } else {
        bytes = [info.op];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── SHL / SHR / SAR ──
    case "shl": case "shr": case "sar": {
      const shiftExt: Record<string, number> = { shl: 4, shr: 5, sar: 7 };
      const ext = shiftExt[op]!;
      if (ops[0]?.type === "register" && ops[1]?.type === "immediate") {
        const reg = ops[0].value;
        const imm = ops[1].numValue ?? 1;
        const w = is64bit(reg);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w || isExtended(reg)) {
          const rex = rexPrefix(w, false, false, isExtended(reg));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0xc1);
        const modrm = modRM(3, ext, REG_NUM[reg] ?? 0);
        bytes.push(modrm);
        bytes.push(imm & 0xff);
        parts.push({ name: "opcode", bytes: [0xc1] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        parts.push({ name: "imm8", bytes: [imm & 0xff] });
        encoding = describeBytes(parts);
      } else {
        bytes = [0xd3];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── PUSH / POP ──
    case "push": {
      if (ops[0]?.type === "register") {
        const reg = ops[0].value;
        const regN = REG_NUM[reg] ?? 0;
        const parts: { name: string; bytes: number[] }[] = [];
        if (isExtended(reg)) {
          const rex = rexPrefix(false, false, false, true);
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        const opByte = 0x50 + (regN & 7);
        bytes.push(opByte);
        parts.push({ name: "opcode", bytes: [opByte] });
        encoding = describeBytes(parts) + `  (50+rd, rd=${regN})`;
      } else if (ops[0]?.type === "immediate") {
        const imm = ops[0].numValue ?? 0;
        bytes.push(0x68);
        const immB = immBytes(imm, 4);
        bytes.push(...immB);
        encoding = describeBytes([
          { name: "opcode", bytes: [0x68] },
          { name: "imm32", bytes: immB },
        ]);
      } else {
        bytes = [0x50];
        encoding = "簡略エンコード";
      }
      break;
    }
    case "pop": {
      if (ops[0]?.type === "register") {
        const reg = ops[0].value;
        const regN = REG_NUM[reg] ?? 0;
        const parts: { name: string; bytes: number[] }[] = [];
        if (isExtended(reg)) {
          const rex = rexPrefix(false, false, false, true);
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        const opByte = 0x58 + (regN & 7);
        bytes.push(opByte);
        parts.push({ name: "opcode", bytes: [opByte] });
        encoding = describeBytes(parts) + `  (58+rd, rd=${regN})`;
      } else {
        bytes = [0x58];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── JMP / Jcc ──
    case "jmp": {
      const target = ops[0];
      if (target?.type === "label") {
        const addr = labels.get(target.value);
        const rel = addr !== undefined ? addr - (offset + 5) : 0;
        bytes.push(0xe9);
        const relB = immBytes(rel, 4);
        bytes.push(...relB);
        encoding = describeBytes([
          { name: "opcode", bytes: [0xe9] },
          { name: "rel32", bytes: relB },
        ]);
        if (addr !== undefined) {
          encoding += `  → ${target.value} (相対: ${rel >= 0 ? "+" : ""}${rel})`;
        }
      } else {
        bytes = [0xe9, 0, 0, 0, 0];
        encoding = "jmp rel32";
      }
      break;
    }
    case "je": case "jz":
    case "jne": case "jnz":
    case "jg": case "jge": case "jl": case "jle": {
      const ccMap: Record<string, number> = {
        je: 0x84, jz: 0x84,
        jne: 0x85, jnz: 0x85,
        jl: 0x8c, jge: 0x8d,
        jle: 0x8e, jg: 0x8f,
      };
      const cc = ccMap[op]!;
      const target = ops[0];
      const instrSize = 6; // 0F xx + rel32
      if (target?.type === "label") {
        const addr = labels.get(target.value);
        const rel = addr !== undefined ? addr - (offset + instrSize) : 0;
        bytes.push(0x0f, cc);
        const relB = immBytes(rel, 4);
        bytes.push(...relB);
        encoding = describeBytes([
          { name: "opcode", bytes: [0x0f, cc] },
          { name: "rel32", bytes: relB },
        ]);
        if (addr !== undefined) {
          encoding += `  → ${target.value} (相対: ${rel >= 0 ? "+" : ""}${rel})`;
        }
      } else {
        bytes = [0x0f, cc, 0, 0, 0, 0];
        encoding = `${op} rel32`;
      }
      break;
    }

    // ── CALL / RET ──
    case "call": {
      const target = ops[0];
      if (target?.type === "label") {
        const addr = labels.get(target.value);
        const rel = addr !== undefined ? addr - (offset + 5) : 0;
        bytes.push(0xe8);
        const relB = immBytes(rel, 4);
        bytes.push(...relB);
        encoding = describeBytes([
          { name: "opcode", bytes: [0xe8] },
          { name: "rel32", bytes: relB },
        ]);
        if (addr !== undefined) {
          encoding += `  → ${target.value}`;
        }
      } else {
        bytes = [0xe8, 0, 0, 0, 0];
        encoding = "call rel32";
      }
      break;
    }
    case "ret": {
      bytes = [0xc3];
      encoding = describeBytes([{ name: "opcode", bytes: [0xc3] }]);
      break;
    }

    // ── TEST ──
    case "test": {
      if (ops[0]?.type === "register" && ops[1]?.type === "register") {
        const dst = ops[0].value;
        const src = ops[1].value;
        const w = is64bit(dst);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w) {
          const rex = rexPrefix(w, isExtended(src), false, isExtended(dst));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0x85);
        const modrm = modRM(3, REG_NUM[src] ?? 0, REG_NUM[dst] ?? 0);
        bytes.push(modrm);
        parts.push({ name: "opcode", bytes: [0x85] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        encoding = describeBytes(parts);
      } else {
        bytes = [0x85, 0xc0];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── MUL / IMUL / DIV / IDIV ──
    case "mul": case "imul": case "div": case "idiv": {
      const mulInfo: Record<string, { op: number; ext: number }> = {
        mul:  { op: 0xf7, ext: 4 },
        imul: { op: 0xf7, ext: 5 },
        div:  { op: 0xf7, ext: 6 },
        idiv: { op: 0xf7, ext: 7 },
      };
      const info = mulInfo[op]!;
      if (ops[0]?.type === "register") {
        const reg = ops[0].value;
        const w = is64bit(reg);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w) {
          const rex = rexPrefix(w, false, false, isExtended(reg));
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(info.op);
        const modrm = modRM(3, info.ext, REG_NUM[reg] ?? 0);
        bytes.push(modrm);
        parts.push({ name: "opcode", bytes: [info.op] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        encoding = describeBytes(parts);
      } else {
        bytes = [info.op];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── LEA ──
    case "lea": {
      if (ops[0]?.type === "register" && ops[1]?.type === "memory") {
        const dst = ops[0].value;
        const w = is64bit(dst);
        const parts: { name: string; bytes: number[] }[] = [];
        if (w) {
          const rex = rexPrefix(w, false, false, false);
          bytes.push(rex);
          parts.push({ name: "REX", bytes: [rex] });
        }
        bytes.push(0x8d);
        const modrm = modRM(0, REG_NUM[dst] ?? 0, 5);
        bytes.push(modrm);
        bytes.push(...immBytes(0, 4));
        parts.push({ name: "opcode", bytes: [0x8d] });
        parts.push({ name: "ModR/M", bytes: [modrm] });
        parts.push({ name: "disp32", bytes: immBytes(0, 4) });
        encoding = describeBytes(parts);
      } else {
        bytes = [0x8d];
        encoding = "簡略エンコード";
      }
      break;
    }

    // ── NOP / INT / SYSCALL / HLT ──
    case "nop": {
      bytes = [0x90];
      encoding = describeBytes([{ name: "opcode", bytes: [0x90] }]);
      break;
    }
    case "int": {
      const n = ops[0]?.numValue ?? 3;
      bytes = [0xcd, n & 0xff];
      encoding = describeBytes([
        { name: "opcode", bytes: [0xcd] },
        { name: "imm8", bytes: [n & 0xff] },
      ]);
      break;
    }
    case "syscall": {
      bytes = [0x0f, 0x05];
      encoding = describeBytes([{ name: "opcode", bytes: [0x0f, 0x05] }]);
      break;
    }
    case "hlt": {
      bytes = [0xf4];
      encoding = describeBytes([{ name: "opcode", bytes: [0xf4] }]);
      break;
    }

    default: {
      bytes = [0x90];
      encoding = "未実装命令 → NOP で代替";
    }
  }

  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");

  return { instruction: inst, bytes, hex, offset, encoding };
}
