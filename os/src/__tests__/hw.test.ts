import { describe, it, expect } from "vitest";
import { Cpu } from "../hw/cpu.js";
import { Memory } from "../hw/memory.js";
import { Timer } from "../hw/timer.js";
import { Disk } from "../hw/disk.js";
import { assemble } from "../hw/assembler.js";
import { Register, OpCode, BLOCK_SIZE, InterruptType } from "../hw/types.js";

// ヘルパー: CPU + メモリ + タイマーをセットアップしてプログラムをロード
function setupCpu(source: string, loadAddr = 0x0100): { cpu: Cpu; mem: Memory; timer: Timer } {
  const mem = new Memory();
  const timer = new Timer();
  const cpu = new Cpu(mem, timer);
  const code = assemble(source, loadAddr);
  mem.loadBytes(loadAddr, code);
  cpu.registers[Register.PC] = loadAddr;
  return { cpu, mem, timer };
}

describe("メモリ", () => {
  it("バイト読み書き", () => {
    const mem = new Memory();
    mem.writeByte(0x100, 0xAB);
    expect(mem.readByte(0x100)).toBe(0xAB);
  });

  it("ワード読み書き（リトルエンディアン）", () => {
    const mem = new Memory();
    mem.writeWord(0x200, 0x1234);
    expect(mem.readByte(0x200)).toBe(0x34); // 下位バイトが先
    expect(mem.readByte(0x201)).toBe(0x12); // 上位バイト
    expect(mem.readWord(0x200)).toBe(0x1234);
  });

  it("バイト列ロード", () => {
    const mem = new Memory();
    mem.loadBytes(0x300, new Uint8Array([0x01, 0x02, 0x03]));
    expect(mem.readByte(0x300)).toBe(0x01);
    expect(mem.readByte(0x302)).toBe(0x03);
  });
});

describe("ディスク", () => {
  it("ブロック読み書き", () => {
    const disk = new Disk();
    const data = new Uint8Array(BLOCK_SIZE);
    data[0] = 0xAA;
    data[511] = 0xBB;
    disk.writeBlock(0, data);

    const read = disk.readBlock(0);
    expect(read[0]).toBe(0xAA);
    expect(read[511]).toBe(0xBB);
  });

  it("不正なブロック番号でエラー", () => {
    const disk = new Disk();
    expect(() => disk.readBlock(9999)).toThrow();
  });
});

describe("アセンブラ", () => {
  it("MOVI をエンコードする", () => {
    const code = assemble("MOVI R0, 42");
    expect(code[0]).toBe(OpCode.MOVI);
    expect(code[1]).toBe(Register.R0);
    expect(code[2]).toBe(42);  // 即値の下位バイト
    expect(code[3]).toBe(0);   // 即値の上位バイト
  });

  it("16進数の即値を扱える", () => {
    const code = assemble("MOVI R1, 0xFF00");
    expect(code[2]).toBe(0x00);
    expect(code[3]).toBe(0xFF);
  });

  it("レジスタ間命令をエンコードする", () => {
    const code = assemble("ADD R0, R1");
    expect(code[0]).toBe(OpCode.ADD);
    expect(code[1]).toBe(Register.R0);
    expect(code[2]).toBe(Register.R1);
  });

  it("引数なし命令をエンコードする", () => {
    const code = assemble("HALT");
    expect(code[0]).toBe(OpCode.HALT);
  });

  it("ラベルを解決する", () => {
    const base = 0x0100;
    const code = assemble(`
      JMP end
      NOP
      NOP
    end:
      HALT
    `, base);
    // end: は base + JMP(4) + NOP(4) + NOP(4) = 0x0100 + 12 = 0x010C
    const addr = base + 12;
    expect(code[2]).toBe(addr & 0xFF);
    expect(code[3]).toBe((addr >> 8) & 0xFF);
  });

  it("コメントを無視する", () => {
    const code = assemble(`
      MOVI R0, 1  ; これはコメント
      HALT
    `);
    expect(code.length).toBe(8); // 2命令 × 4バイト
  });
});

describe("CPU", () => {
  it("MOVI + HALT で値をロードして停止する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 100
      HALT
    `);
    cpu.run(10);
    expect(cpu.registers[Register.R0]).toBe(100);
    expect(cpu.isHalted()).toBe(true);
  });

  it("ADD で加算する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 30
      MOVI R1, 12
      ADD R0, R1
      HALT
    `);
    cpu.run(10);
    expect(cpu.registers[Register.R0]).toBe(42);
  });

  it("SUB で減算する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 50
      MOVI R1, 8
      SUB R0, R1
      HALT
    `);
    cpu.run(10);
    expect(cpu.registers[Register.R0]).toBe(42);
  });

  it("MUL で乗算する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 6
      MOVI R1, 7
      MUL R0, R1
      HALT
    `);
    cpu.run(10);
    expect(cpu.registers[Register.R0]).toBe(42);
  });

  it("CMP + JZ で条件分岐する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 5
      MOVI R1, 5
      CMP R0, R1
      JZ equal
      MOVI R2, 0
      JMP done
    equal:
      MOVI R2, 1
    done:
      HALT
    `);
    cpu.run(20);
    expect(cpu.registers[Register.R2]).toBe(1); // 等しいので equal に飛ぶ
  });

  it("CMP + JNZ で不等分岐する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 3
      MOVI R1, 5
      CMP R0, R1
      JNZ notequal
      MOVI R2, 0
      JMP done
    notequal:
      MOVI R2, 99
    done:
      HALT
    `);
    cpu.run(20);
    expect(cpu.registers[Register.R2]).toBe(99);
  });

  it("PUSH + POP でスタック操作する", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 42
      PUSH R0
      MOVI R0, 0
      POP R1
      HALT
    `);
    cpu.run(10);
    expect(cpu.registers[Register.R0]).toBe(0);
    expect(cpu.registers[Register.R1]).toBe(42);
  });

  it("CALL + RET でサブルーチン呼び出しする", () => {
    const { cpu } = setupCpu(`
      MOVI R0, 10
      CALL double
      HALT
    double:
      ADD R0, R0
      RET
    `);
    cpu.run(20);
    expect(cpu.registers[Register.R0]).toBe(20);
  });

  it("LOAD + STORE でメモリアクセスする", () => {
    const { cpu, mem } = setupCpu(`
      MOVI R0, 0x1000
      MOVI R1, 12345
      STORE R0, R1
      MOVI R1, 0
      LOAD R2, R0
      HALT
    `);
    cpu.run(10);
    expect(cpu.registers[Register.R2]).toBe(12345);
    expect(mem.readWord(0x1000)).toBe(12345);
  });

  it("ループで合計を計算する", () => {
    // 1 + 2 + 3 + ... + 10 = 55
    const { cpu } = setupCpu(`
      MOVI R0, 0       ; 合計
      MOVI R1, 1       ; カウンタ
      MOVI R2, 10      ; 上限
    loop:
      ADD R0, R1       ; 合計 += カウンタ
      ADDI R1, 1       ; カウンタ++
      CMP R1, R2
      JL loop          ; カウンタ < 上限 なら繰り返し
      ; カウンタ == 上限 の時もう1回足す
      ADD R0, R1
      HALT
    `);
    cpu.run(200);
    expect(cpu.registers[Register.R0]).toBe(55);
  });

  it("SYSCALL で割り込みハンドラが呼ばれる", () => {
    let syscallNum = -1;
    const { cpu } = setupCpu(`
      MOVI R0, 7
      SYSCALL
      HALT
    `);
    cpu.setInterruptHandler((type, data) => {
      if (type === InterruptType.Syscall) {
        syscallNum = data;
      }
    });
    cpu.run(10);
    expect(syscallNum).toBe(7);
  });

  it("タイマー割り込みが発生する", () => {
    let timerFired = false;
    const mem = new Memory();
    const timer = new Timer();
    timer.interval = 5; // 5サイクルごとに割り込み
    timer.enabled = true;
    const cpu = new Cpu(mem, timer);

    cpu.setInterruptHandler((type) => {
      if (type === InterruptType.Timer) {
        timerFired = true;
      }
    });

    // NOP を大量に実行
    const nopCode = assemble("NOP\nNOP\nNOP\nNOP\nNOP\nNOP\nNOP\nNOP\nNOP\nNOP\nHALT", 0x0100);
    mem.loadBytes(0x0100, nopCode);
    cpu.registers[Register.PC] = 0x0100;
    cpu.run(20);

    expect(timerFired).toBe(true);
  });
});
