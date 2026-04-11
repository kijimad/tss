import { describe, it, expect } from "vitest";
import { parse, parseOperand } from "../assembler/parser.js";
import { encodeInstruction } from "../assembler/encoder.js";
import { assemble } from "../assembler/assembler.js";
import { PRESETS } from "../assembler/presets.js";
import type { Instruction } from "../assembler/types.js";

describe("parseOperand", () => {
  it("レジスタを正しく識別する", () => {
    expect(parseOperand("rax")).toEqual({ type: "register", value: "rax" });
    expect(parseOperand("EAX")).toEqual({ type: "register", value: "eax" });
    expect(parseOperand("r12")).toEqual({ type: "register", value: "r12" });
  });

  it("即値を正しくパースする", () => {
    const op = parseOperand("42");
    expect(op.type).toBe("immediate");
    expect(op.numValue).toBe(42);
  });

  it("16進即値をパースする", () => {
    const op = parseOperand("0xFF");
    expect(op.type).toBe("immediate");
    expect(op.numValue).toBe(255);
  });

  it("負の即値をパースする", () => {
    const op = parseOperand("-10");
    expect(op.type).toBe("immediate");
    expect(op.numValue).toBe(-10);
  });

  it("メモリ参照を識別する", () => {
    expect(parseOperand("[rsp]")).toEqual({ type: "memory", value: "[rsp]" });
    expect(parseOperand("[rbp]")).toEqual({ type: "memory", value: "[rbp]" });
  });

  it("ラベルを識別する", () => {
    expect(parseOperand("loop")).toEqual({ type: "label", value: "loop" });
    expect(parseOperand("_start")).toEqual({ type: "label", value: "_start" });
  });
});

describe("parse", () => {
  it("基本的な命令をパースする", () => {
    const { instructions, errors } = parse("mov rax, rbx");
    expect(errors).toHaveLength(0);
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.opcode).toBe("mov");
    expect(instructions[0]!.operands).toHaveLength(2);
    expect(instructions[0]!.operands[0]!.value).toBe("rax");
    expect(instructions[0]!.operands[1]!.value).toBe("rbx");
  });

  it("ラベル付き行をパースする", () => {
    const { instructions } = parse("start: mov rax, 1");
    expect(instructions[0]!.label).toBe("start");
    expect(instructions[0]!.opcode).toBe("mov");
  });

  it("ラベルのみの行をパースする", () => {
    const { instructions } = parse("loop:");
    expect(instructions[0]!.label).toBe("loop");
    expect(instructions[0]!.opcode).toBeUndefined();
  });

  it("コメントを抽出する", () => {
    const { instructions } = parse("mov rax, 1 ; ここはコメント");
    expect(instructions[0]!.comment).toBe("ここはコメント");
    expect(instructions[0]!.opcode).toBe("mov");
  });

  it("空行を無視する", () => {
    const { instructions } = parse("mov rax, 1\n\nmov rbx, 2");
    const withOpcode = instructions.filter((i) => i.opcode);
    expect(withOpcode).toHaveLength(2);
  });

  it("不明な命令でエラーを返す", () => {
    const { errors } = parse("foo rax");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("foo");
  });

  it("複数行のプログラムをパースする", () => {
    const src = `_start:
  mov rax, 1
  mov rdi, 0
  syscall`;
    const { instructions, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const opcodes = instructions.filter((i) => i.opcode).map((i) => i.opcode);
    expect(opcodes).toEqual(["mov", "mov", "syscall"]);
  });
});

describe("encodeInstruction", () => {
  const labels = new Map<string, number>();

  function makeInst(opcode: string, operands: string[]): Instruction {
    const { instructions } = parse(
      `${opcode} ${operands.join(", ")}`,
    );
    return instructions[0]!;
  }

  it("ret を 0xC3 にエンコードする", () => {
    const inst = makeInst("ret", []);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0xc3]);
  });

  it("nop を 0x90 にエンコードする", () => {
    const inst = makeInst("nop", []);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0x90]);
  });

  it("syscall を 0F 05 にエンコードする", () => {
    const inst = makeInst("syscall", []);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0x0f, 0x05]);
  });

  it("push rax を 50 にエンコードする", () => {
    const inst = makeInst("push", ["rax"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0x50]);
  });

  it("push rbx を 53 にエンコードする", () => {
    const inst = makeInst("push", ["rbx"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0x53]);
  });

  it("pop rbp を 5D にエンコードする", () => {
    const inst = makeInst("pop", ["rbp"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0x5d]);
  });

  it("mov reg, reg に REX プレフィックスを付与する", () => {
    const inst = makeInst("mov", ["rax", "rbx"]);
    const enc = encodeInstruction(inst, 0, labels);
    // REX.W=1 → 0x48, opcode 0x89, ModR/M(3,rbx,rax)
    expect(enc.bytes[0]).toBe(0x48); // REX.W
    expect(enc.bytes[1]).toBe(0x89); // MOV r/m, r
  });

  it("mov eax, ebx は REX なし", () => {
    const inst = makeInst("mov", ["eax", "ebx"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes[0]).toBe(0x89); // REX なしで opcode から始まる
  });

  it("mov reg, imm をエンコードする", () => {
    const inst = makeInst("mov", ["rax", "42"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes.length).toBeGreaterThanOrEqual(5);
    expect(enc.bytes[0]).toBe(0x48); // REX.W
    expect(enc.bytes[1]).toBe(0xb8); // MOV rax, imm
  });

  it("add reg, reg をエンコードする", () => {
    const inst = makeInst("add", ["rax", "rbx"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toContain(0x01); // ADD opcode
  });

  it("sub reg, imm をエンコードする", () => {
    const inst = makeInst("sub", ["rax", "10"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toContain(0x81); // ALU imm32 opcode
  });

  it("拡張レジスタ r8 で REX.B が立つ", () => {
    const inst = makeInst("push", ["r8"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes[0]).toBe(0x41); // REX.B
  });

  it("jmp にラベルアドレスを埋め込む", () => {
    const lbl = new Map([["target", 100]]);
    const inst = makeInst("jmp", ["target"]);
    const enc = encodeInstruction(inst, 0, lbl);
    expect(enc.bytes[0]).toBe(0xe9); // JMP rel32
    expect(enc.bytes.length).toBe(5);
  });

  it("call にラベルアドレスを埋め込む", () => {
    const lbl = new Map([["func", 50]]);
    const inst = makeInst("call", ["func"]);
    const enc = encodeInstruction(inst, 0, lbl);
    expect(enc.bytes[0]).toBe(0xe8); // CALL rel32
  });

  it("int 0x80 をエンコードする", () => {
    const inst = makeInst("int", ["0x80"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0xcd, 0x80]);
  });

  it("hlt を 0xF4 にエンコードする", () => {
    const inst = makeInst("hlt", []);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toEqual([0xf4]);
  });

  it("xor rax, rax をエンコードする", () => {
    const inst = makeInst("xor", ["rax", "rax"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toContain(0x31); // XOR opcode
  });

  it("inc rax をエンコードする", () => {
    const inst = makeInst("inc", ["rax"]);
    const enc = encodeInstruction(inst, 0, labels);
    expect(enc.bytes).toContain(0xff); // INC opcode
  });
});

describe("assemble (2パス)", () => {
  it("単純なプログラムをアセンブルできる", () => {
    const result = assemble("mov rax, 1\nret");
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.encoded.filter((e) => e.bytes.length > 0).length).toBe(2);
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("ラベルを解決できる", () => {
    const result = assemble("jmp end\nnop\nend:\nret");
    expect(result.success).toBe(true);
    expect(result.labels.has("end")).toBe(true);
  });

  it("前方参照のラベルを解決する", () => {
    const src = `  jmp skip
  nop
  nop
skip:
  ret`;
    const result = assemble(src);
    expect(result.success).toBe(true);
    expect(result.labels.get("skip")).toBeGreaterThan(0);
  });

  it("後方参照のラベルを解決する", () => {
    const src = `loop:
  nop
  jmp loop`;
    const result = assemble(src);
    expect(result.success).toBe(true);
  });

  it("未定義ラベルでエラーを返す", () => {
    const result = assemble("jmp nowhere");
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("未定義ラベル"))).toBe(true);
  });

  it("重複ラベルでエラーを返す", () => {
    const result = assemble("x:\nnop\nx:\nnop");
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("重複"))).toBe(true);
  });

  it("不明な命令でエラーを返す", () => {
    const result = assemble("badop rax");
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("不明な命令"))).toBe(true);
  });

  it("ヘックスダンプが生成される", () => {
    const result = assemble("nop\nnop\nret");
    expect(result.success).toBe(true);
    expect(result.steps.some((s) => s.phase.includes("ヘックス"))).toBe(true);
  });

  it("全バイトが正しい順序で出力される", () => {
    const result = assemble("nop\nnop\nret");
    const allBytes = result.encoded.flatMap((e) => e.bytes);
    expect(allBytes).toEqual([0x90, 0x90, 0xc3]);
  });
});

describe("PRESETS", () => {
  it("全プリセットが正しく定義されている", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const preset of PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.code).toBeTruthy();
    }
  });

  it("各プリセットのアセンブルが例外なく完了する", () => {
    for (const preset of PRESETS) {
      const result = assemble(preset.code);
      // エラー系プリセットもあるため、成功/失敗は問わない
      expect(result.steps.length).toBeGreaterThan(0);
    }
  });

  it("エラー系以外のプリセットは成功する", () => {
    for (const preset of PRESETS) {
      if (preset.name.includes("エラー")) continue;
      const result = assemble(preset.code);
      expect(result.errors, `${preset.name}: ${result.errors.join(", ")}`).toHaveLength(0);
      expect(result.success).toBe(true);
    }
  });
});
