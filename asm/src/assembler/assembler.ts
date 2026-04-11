/**
 * assembler.ts — 2パス・アセンブラ
 *
 * パス1: ラベルアドレスの収集
 * パス2: 命令のエンコード（ラベル参照を解決）
 */

import type { AssembleResult, AssembleStep, Instruction } from "./types.js";
import { parse } from "./parser.js";
import { encodeInstruction } from "./encoder.js";

/** 命令のサイズを推定する（パス1で使用） */
function estimateSize(inst: Instruction): number {
  if (!inst.opcode) return 0;

  switch (inst.opcode) {
    case "ret": case "nop": case "hlt":
      return 1;

    case "syscall":
      return 2;

    case "int":
      return 2;

    case "push": case "pop":
      if (inst.operands[0]?.type === "register") {
        const reg = inst.operands[0].value;
        if (["r8","r9","r10","r11","r12","r13","r14","r15"].includes(reg)) return 2;
        return 1;
      }
      if (inst.operands[0]?.type === "immediate") return 5;
      return 1;

    case "jmp": case "call":
      return 5;

    case "je": case "jne": case "jz": case "jnz":
    case "jg": case "jge": case "jl": case "jle":
      return 6;

    case "mov":
      if (inst.operands[0]?.type === "register" && inst.operands[1]?.type === "immediate") {
        const reg = inst.operands[0].value;
        const is64 = reg.startsWith("r");
        return is64 ? 6 : 5;
      }
      if (inst.operands[0]?.type === "register" && inst.operands[1]?.type === "register") {
        const r0 = inst.operands[0].value;
        const r1 = inst.operands[1].value;
        const needsRex = r0.startsWith("r") || r1.startsWith("r");
        return needsRex ? 3 : 2;
      }
      if (inst.operands.some((o) => o.type === "memory")) return 7;
      return 3;

    case "add": case "sub": case "and": case "or": case "xor": case "cmp":
      if (inst.operands[1]?.type === "immediate") {
        const reg = inst.operands[0]?.value ?? "";
        return reg.startsWith("r") ? 7 : 6;
      }
      {
        const r0 = inst.operands[0]?.value ?? "";
        const r1 = inst.operands[1]?.value ?? "";
        const needsRex = r0.startsWith("r") || r1.startsWith("r");
        return needsRex ? 3 : 2;
      }

    case "inc": case "dec": case "neg": case "not":
    case "mul": case "imul": case "div": case "idiv": {
      const reg = inst.operands[0]?.value ?? "";
      return reg.startsWith("r") ? 3 : 2;
    }

    case "shl": case "shr": case "sar": {
      const reg = inst.operands[0]?.value ?? "";
      return reg.startsWith("r") ? 4 : 3;
    }

    case "test": {
      const r0 = inst.operands[0]?.value ?? "";
      return r0.startsWith("r") ? 3 : 2;
    }

    case "lea":
      return 7;

    default:
      return 1;
  }
}

/** アセンブルを実行する（2パス） */
export function assemble(source: string): AssembleResult {
  const steps: AssembleStep[] = [];
  const errors: string[] = [];

  // ── パース ──
  const { instructions, errors: parseErrors } = parse(source);
  errors.push(...parseErrors);

  steps.push({
    phase: "パース",
    description: `${instructions.length} 行をパース (${instructions.filter((i) => i.opcode).length} 命令, ${instructions.filter((i) => i.label).length} ラベル)`,
    detail: instructions
      .filter((i) => i.opcode || i.label)
      .map((i) => {
        const parts: string[] = [];
        if (i.label) parts.push(`${i.label}:`);
        if (i.opcode) {
          const opsStr = i.operands.map((o) => o.value).join(", ");
          parts.push(`  ${i.opcode}${opsStr ? " " + opsStr : ""}`);
        }
        return `  行${i.line + 1}: ${parts.join("")}`;
      })
      .join("\n"),
  });

  if (parseErrors.length > 0) {
    return { success: false, steps, instructions, encoded: [], labels: new Map(), errors };
  }

  // ── パス1: ラベル収集 ──
  const labels = new Map<string, number>();
  let offset = 0;

  for (const inst of instructions) {
    if (inst.label) {
      if (labels.has(inst.label)) {
        errors.push(`ラベル '${inst.label}' が重複定義されています (行 ${inst.line + 1})`);
      } else {
        labels.set(inst.label, offset);
      }
    }
    offset += estimateSize(inst);
  }

  steps.push({
    phase: "パス1: ラベル収集",
    description: `${labels.size} 個のラベルアドレスを決定`,
    detail: [...labels.entries()]
      .map(([name, addr]) => `  ${name}: 0x${addr.toString(16).padStart(4, "0")} (offset ${addr})`)
      .join("\n") || "  ラベルなし",
  });

  if (errors.length > 0) {
    return { success: false, steps, instructions, encoded: [], labels, errors };
  }

  // ── パス2: エンコード ──
  const encoded: import("./types.js").EncodedInstruction[] = [];
  offset = 0;

  const encodeDetails: string[] = [];
  let totalBytes = 0;

  for (const inst of instructions) {
    const enc = encodeInstruction(inst, offset, labels);
    enc.offset = offset;
    encoded.push(enc);

    if (enc.bytes.length > 0) {
      const addrStr = `0x${offset.toString(16).padStart(4, "0")}`;
      const hexStr = enc.hex.padEnd(24);
      const srcStr = inst.source.trim();
      encodeDetails.push(`  ${addrStr}  ${hexStr} ${srcStr}`);
      encodeDetails.push(`           ${enc.encoding}`);
    }

    offset += enc.bytes.length;
    totalBytes += enc.bytes.length;
  }

  steps.push({
    phase: "パス2: エンコード",
    description: `${encoded.filter((e) => e.bytes.length > 0).length} 命令 → ${totalBytes} バイトのマシンコードを生成`,
    detail: encodeDetails.join("\n"),
  });

  // ── 未解決ラベル参照のチェック ──
  for (const inst of instructions) {
    for (const op of inst.operands) {
      if (op.type === "label" && !labels.has(op.value)) {
        errors.push(`行 ${inst.line + 1}: 未定義ラベル '${op.value}'`);
      }
    }
  }

  // ── ヘックスダンプ ──
  const allBytes = encoded.flatMap((e) => e.bytes);
  if (allBytes.length > 0) {
    const hexLines: string[] = [];
    for (let i = 0; i < allBytes.length; i += 16) {
      const chunk = allBytes.slice(i, i + 16);
      const addr = i.toString(16).padStart(8, "0");
      const hex = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = chunk
        .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
        .join("");
      hexLines.push(`  ${addr}  ${hex.padEnd(48)} |${ascii}|`);
    }
    steps.push({
      phase: "ヘックスダンプ",
      description: `${totalBytes} バイトの出力バイナリ`,
      detail: hexLines.join("\n"),
    });
  }

  const success = errors.length === 0;
  return { success, steps, instructions, encoded, labels, errors };
}
