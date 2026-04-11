import { describe, it, expect } from "vitest";
import { execute, createInitialState, REG_NAMES } from "../cpu/cpu.js";
import { PRESETS } from "../cpu/presets.js";
import type { Instruction } from "../cpu/types.js";

/** ヘルパー */
function I(asm: string, opcode: Instruction["opcode"], opts?: Partial<Instruction>): Instruction {
  return { opcode, asm, ...opts };
}

describe("createInitialState", () => {
  it("初期状態が正しい", () => {
    const s = createInitialState();
    expect(s.registers).toHaveLength(8);
    expect(s.registers.every((r) => r === 0)).toBe(true);
    expect(s.pc).toBe(0);
    expect(s.sp).toBe(0xff);
    expect(s.flags).toEqual({ ZF: false, SF: false, CF: false, OF: false });
    expect(s.memory).toHaveLength(256);
    expect(s.halted).toBe(false);
  });
});

describe("REG_NAMES", () => {
  it("8本のレジスタ名", () => {
    expect(REG_NAMES).toEqual(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
  });
});

describe("execute - 基本命令", () => {
  it("NOP は状態を変えない", () => {
    const r = execute([I("NOP", "NOP"), I("HLT", "HLT")]);
    expect(r.success).toBe(true);
    expect(r.finalState.registers.every((v) => v === 0)).toBe(true);
  });

  it("MOVI でレジスタに即値をセットする", () => {
    const r = execute([
      I("MOVI R0, 42", "MOVI", { rd: 0, imm: 42 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[0]).toBe(42);
  });

  it("MOV でレジスタ間コピーする", () => {
    const r = execute([
      I("MOVI R0, 99", "MOVI", { rd: 0, imm: 99 }),
      I("MOV R1, R0", "MOV", { rd: 1, rs1: 0 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[1]).toBe(99);
  });

  it("HLT で停止する", () => {
    const r = execute([I("HLT", "HLT")]);
    expect(r.success).toBe(true);
    expect(r.finalState.halted).toBe(true);
    expect(r.traces).toHaveLength(1);
  });
});

describe("execute - ALU", () => {
  it("ADD で加算する", () => {
    const r = execute([
      I("MOVI R0, 10", "MOVI", { rd: 0, imm: 10 }),
      I("MOVI R1, 20", "MOVI", { rd: 1, imm: 20 }),
      I("ADD R2, R0, R1", "ADD", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(30);
  });

  it("SUB で減算する", () => {
    const r = execute([
      I("MOVI R0, 50", "MOVI", { rd: 0, imm: 50 }),
      I("MOVI R1, 30", "MOVI", { rd: 1, imm: 30 }),
      I("SUB R2, R0, R1", "SUB", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(20);
  });

  it("MUL で乗算する", () => {
    const r = execute([
      I("MOVI R0, 6", "MOVI", { rd: 0, imm: 6 }),
      I("MOVI R1, 7", "MOVI", { rd: 1, imm: 7 }),
      I("MUL R2, R0, R1", "MUL", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(42);
  });

  it("AND ビットAND", () => {
    const r = execute([
      I("MOVI R0, 0xFF", "MOVI", { rd: 0, imm: 0xFF }),
      I("MOVI R1, 0x0F", "MOVI", { rd: 1, imm: 0x0F }),
      I("AND R2, R0, R1", "AND", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(0x0F);
  });

  it("OR ビットOR", () => {
    const r = execute([
      I("MOVI R0, 0xF0", "MOVI", { rd: 0, imm: 0xF0 }),
      I("MOVI R1, 0x0F", "MOVI", { rd: 1, imm: 0x0F }),
      I("OR R2, R0, R1", "OR", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(0xFF);
  });

  it("XOR ビットXOR", () => {
    const r = execute([
      I("MOVI R0, 0xFF", "MOVI", { rd: 0, imm: 0xFF }),
      I("MOVI R1, 0xFF", "MOVI", { rd: 1, imm: 0xFF }),
      I("XOR R2, R0, R1", "XOR", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(0);
    expect(r.finalState.flags.ZF).toBe(true);
  });

  it("NOT ビット反転", () => {
    const r = execute([
      I("MOVI R0, 0x00FF", "MOVI", { rd: 0, imm: 0x00FF }),
      I("NOT R1, R0", "NOT", { rd: 1, rs1: 0 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[1]).toBe(0xFF00);
  });

  it("SHL 左シフト", () => {
    const r = execute([
      I("MOVI R0, 1", "MOVI", { rd: 0, imm: 1 }),
      I("SHL R1, R0, 4", "SHL", { rd: 1, rs1: 0, imm: 4 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[1]).toBe(16);
  });

  it("SHR 右シフト", () => {
    const r = execute([
      I("MOVI R0, 256", "MOVI", { rd: 0, imm: 256 }),
      I("SHR R1, R0, 4", "SHR", { rd: 1, rs1: 0, imm: 4 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[1]).toBe(16);
  });
});

describe("execute - フラグ", () => {
  it("SUB でゼロフラグが立つ", () => {
    const r = execute([
      I("MOVI R0, 5", "MOVI", { rd: 0, imm: 5 }),
      I("MOVI R1, 5", "MOVI", { rd: 1, imm: 5 }),
      I("SUB R2, R0, R1", "SUB", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.flags.ZF).toBe(true);
  });

  it("SUB で符号フラグが立つ (負の結果)", () => {
    const r = execute([
      I("MOVI R0, 3", "MOVI", { rd: 0, imm: 3 }),
      I("MOVI R1, 10", "MOVI", { rd: 1, imm: 10 }),
      I("SUB R2, R0, R1", "SUB", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.flags.SF).toBe(true);
  });

  it("ADD でキャリーフラグが立つ", () => {
    const r = execute([
      I("MOVI R0, 0xFFFF", "MOVI", { rd: 0, imm: 0xFFFF }),
      I("MOVI R1, 1", "MOVI", { rd: 1, imm: 1 }),
      I("ADD R2, R0, R1", "ADD", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.flags.CF).toBe(true);
  });
});

describe("execute - メモリ", () => {
  it("STORE / LOAD でメモリ読み書きする", () => {
    const r = execute([
      I("MOVI R0, 123", "MOVI", { rd: 0, imm: 123 }),
      I("STORE R0, [0x80]", "STORE", { rs1: 0, addr: 0x80 }),
      I("LOAD R1, [0x80]", "LOAD", { rd: 1, addr: 0x80 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[1]).toBe(123);
    expect(r.finalState.memory[0x80]).toBe(123);
  });

  it("初期メモリが読み込める", () => {
    const r = execute(
      [I("LOAD R0, [0xA0]", "LOAD", { rd: 0, addr: 0xA0 }), I("HLT", "HLT")],
      { 0xA0: 999 },
    );
    expect(r.finalState.registers[0]).toBe(999);
  });
});

describe("execute - 分岐", () => {
  it("JMP で無条件ジャンプ", () => {
    const r = execute([
      I("JMP 0x02", "JMP", { addr: 2 }),
      I("MOVI R0, 1", "MOVI", { rd: 0, imm: 1 }),  // スキップされる
      I("MOVI R0, 2", "MOVI", { rd: 0, imm: 2 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[0]).toBe(2);
  });

  it("JEQ で ZF=1 のとき分岐", () => {
    const r = execute([
      I("MOVI R0, 5", "MOVI", { rd: 0, imm: 5 }),
      I("MOVI R1, 5", "MOVI", { rd: 1, imm: 5 }),
      I("CMP R0, R1", "CMP", { rs1: 0, rs2: 1 }),
      I("JEQ 0x05", "JEQ", { addr: 5 }),
      I("MOVI R2, 0", "MOVI", { rd: 2, imm: 0 }),
      I("MOVI R2, 1", "MOVI", { rd: 2, imm: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(1);
  });

  it("JNE で ZF=0 のとき分岐", () => {
    const r = execute([
      I("MOVI R0, 3", "MOVI", { rd: 0, imm: 3 }),
      I("MOVI R1, 5", "MOVI", { rd: 1, imm: 5 }),
      I("CMP R0, R1", "CMP", { rs1: 0, rs2: 1 }),
      I("JNE 0x05", "JNE", { addr: 5 }),
      I("MOVI R2, 0", "MOVI", { rd: 2, imm: 0 }),
      I("MOVI R2, 1", "MOVI", { rd: 2, imm: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(1);
  });
});

describe("execute - スタック", () => {
  it("PUSH / POP は LIFO で動作する", () => {
    const r = execute([
      I("MOVI R0, 10", "MOVI", { rd: 0, imm: 10 }),
      I("MOVI R1, 20", "MOVI", { rd: 1, imm: 20 }),
      I("PUSH R0", "PUSH", { rs1: 0 }),
      I("PUSH R1", "PUSH", { rs1: 1 }),
      I("POP R5", "POP", { rd: 5 }),
      I("POP R6", "POP", { rd: 6 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[5]).toBe(20); // 後入れ先出し
    expect(r.finalState.registers[6]).toBe(10);
    expect(r.finalState.sp).toBe(0xff); // SP は元に戻る
  });
});

describe("execute - CALL / RET", () => {
  it("サブルーチンから正しく復帰する", () => {
    const r = execute([
      I("MOVI R0, 5", "MOVI", { rd: 0, imm: 5 }),
      I("CALL 0x03", "CALL", { addr: 3 }),
      I("HLT", "HLT"),
      // サブルーチン: R0 = R0 + R0
      I("ADD R0, R0, R0", "ADD", { rd: 0, rs1: 0, rs2: 0 }),
      I("RET", "RET"),
    ]);
    expect(r.finalState.registers[0]).toBe(10);
    expect(r.finalState.halted).toBe(true);
  });
});

describe("execute - I/O", () => {
  it("OUT / IN でI/Oポートとデータをやりとりする", () => {
    const r = execute([
      I("MOVI R0, 0x41", "MOVI", { rd: 0, imm: 0x41 }),
      I("OUT 0, R0", "OUT", { port: 0, rs1: 0 }),
      I("IN R1, 0", "IN", { rd: 1, port: 0 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.io[0]).toBe(0x41);
    expect(r.finalState.registers[1]).toBe(0x41);
  });
});

describe("execute - ループ", () => {
  it("1+2+...+10 = 55 を計算する", () => {
    const r = execute([
      I("MOVI R0, 1", "MOVI", { rd: 0, imm: 1 }),
      I("MOVI R1, 0", "MOVI", { rd: 1, imm: 0 }),
      I("MOVI R2, 11", "MOVI", { rd: 2, imm: 11 }),
      I("MOVI R3, 1", "MOVI", { rd: 3, imm: 1 }),
      I("ADD R1, R1, R0", "ADD", { rd: 1, rs1: 1, rs2: 0 }),
      I("ADD R0, R0, R3", "ADD", { rd: 0, rs1: 0, rs2: 3 }),
      I("CMP R0, R2", "CMP", { rs1: 0, rs2: 2 }),
      I("JNE 0x04", "JNE", { addr: 4 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[1]).toBe(55);
  });
});

describe("execute - 16ビットラップアラウンド", () => {
  it("0xFFFF + 1 = 0", () => {
    const r = execute([
      I("MOVI R0, 0xFFFF", "MOVI", { rd: 0, imm: 0xFFFF }),
      I("MOVI R1, 1", "MOVI", { rd: 1, imm: 1 }),
      I("ADD R2, R0, R1", "ADD", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.finalState.registers[2]).toBe(0);
  });
});

describe("execute - エラー", () => {
  it("最大サイクルに到達するとエラー", () => {
    const r = execute([
      I("JMP 0x00", "JMP", { addr: 0 }),
    ], undefined, 10);
    expect(r.success).toBe(false);
    expect(r.errors[0]).toContain("最大サイクル");
  });

  it("PC範囲外でエラー", () => {
    const r = execute([
      I("JMP 0xFF", "JMP", { addr: 0xFF }),
    ]);
    expect(r.success).toBe(false);
  });
});

describe("execute - トレース", () => {
  it("各サイクルのトレースが記録される", () => {
    const r = execute([
      I("MOVI R0, 1", "MOVI", { rd: 0, imm: 1 }),
      I("HLT", "HLT"),
    ]);
    expect(r.traces).toHaveLength(2);
    expect(r.traces[0]!.fetch).toContain("MOVI");
    expect(r.traces[0]!.decode).toContain("opcode=MOVI");
    expect(r.traces[0]!.registersAfter[0]).toBe(1);
  });
});

describe("PRESETS", () => {
  it("全プリセットが定義されている", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const p of PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.program.length).toBeGreaterThan(0);
    }
  });

  it("全プリセットが正常に実行完了する", () => {
    for (const p of PRESETS) {
      const r = execute(p.program, p.initialMemory);
      expect(r.success, `${p.name}: ${r.errors.join(", ")}`).toBe(true);
      expect(r.traces.length).toBeGreaterThan(0);
    }
  });
});
