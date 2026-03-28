/**
 * cpu.ts — CPU エミュレーション
 *
 * フォン・ノイマン型の単純な16ビットCPU。
 * メモリ上のプログラムを命令ごとにフェッチ → デコード → 実行する。
 *
 * レジスタ:
 *   R0-R7:  汎用レジスタ (16ビット)
 *   PC:     プログラムカウンタ（次に実行する命令のアドレス）
 *   SP:     スタックポインタ（スタックの現在位置）
 *   FLAGS:  フラグレジスタ (Zero, Carry, Negative, Interrupt)
 *
 * 命令:
 *   4バイト固定長: [OpCode:1B][Op1:1B][Op2:2B]
 *
 * サイクル:
 *   1. フェッチ:  PC が指すメモリから4バイト読む
 *   2. デコード:  OpCode からどの命令か判定
 *   3. 実行:      レジスタやメモリを操作
 *   4. PC += 4:   次の命令へ進む（分岐命令は除く）
 */
import {
  Register, Flag, OpCode, InterruptType,
  MemoryLayout, type InterruptHandler, type HwEvent,
} from "./types.js";
import type { Memory } from "./memory.js";
import type { Timer } from "./timer.js";

// OpCode → ニーモニック名のマップ
const MNEMONIC: Record<number, string | undefined> = {
  [OpCode.MOV]: "MOV", [OpCode.MOVI]: "MOVI", [OpCode.LOAD]: "LOAD", [OpCode.STORE]: "STORE",
  [OpCode.PUSH]: "PUSH", [OpCode.POP]: "POP",
  [OpCode.ADD]: "ADD", [OpCode.SUB]: "SUB", [OpCode.MUL]: "MUL", [OpCode.DIV]: "DIV",
  [OpCode.MOD]: "MOD", [OpCode.ADDI]: "ADDI",
  [OpCode.AND]: "AND", [OpCode.OR]: "OR", [OpCode.XOR]: "XOR", [OpCode.NOT]: "NOT",
  [OpCode.SHL]: "SHL", [OpCode.SHR]: "SHR",
  [OpCode.CMP]: "CMP", [OpCode.CMPI]: "CMPI",
  [OpCode.JMP]: "JMP", [OpCode.JZ]: "JZ", [OpCode.JNZ]: "JNZ", [OpCode.JG]: "JG", [OpCode.JL]: "JL",
  [OpCode.CALL]: "CALL", [OpCode.RET]: "RET",
  [OpCode.SYSCALL]: "SYSCALL", [OpCode.HALT]: "HALT", [OpCode.NOP]: "NOP",
  [OpCode.IRET]: "IRET", [OpCode.CLI]: "CLI", [OpCode.STI]: "STI",
};

export class Cpu {
  // レジスタファイル（11個: R0-R7, PC, SP, FLAGS）
  readonly registers = new Uint16Array(11);
  private halted = false;
  private memory: Memory;
  private timer: Timer;

  // 割り込みキュー
  private pendingInterrupts: { intType: InterruptType; data: number }[] = [];
  // 割り込みハンドラ（カーネルが設定する）
  private interruptHandler: InterruptHandler | undefined;

  // 実行サイクル数
  private cycles = 0;

  onEvent: ((event: HwEvent) => void) | undefined;
  private startTime = performance.now();

  constructor(memory: Memory, timer: Timer) {
    this.memory = memory;
    this.timer = timer;
    this.reset();

    // タイマー割り込みの接続
    timer.setInterruptHandler((type) => this.requestInterrupt(type, 0));
  }

  reset(): void {
    this.registers.fill(0);
    // SP はスタックの頂点から始まる
    this.registers[Register.SP] = MemoryLayout.StackTop;
    // 割り込み許可
    this.registers[Register.FLAGS] = Flag.Interrupt;
    this.halted = false;
    this.cycles = 0;
    this.pendingInterrupts = [];
  }

  isHalted(): boolean {
    return this.halted;
  }

  getCycles(): number {
    return this.cycles;
  }

  // 割り込みハンドラをカーネルが登録する
  setInterruptHandler(handler: InterruptHandler): void {
    this.interruptHandler = handler;
  }

  // 割り込み要求（タイマー、ディスク、キーボード等から）
  requestInterrupt(intType: InterruptType, data: number): void {
    this.pendingInterrupts.push({ intType, data });
  }

  // 1命令を実行する。戻り値は実行が継続可能かどうか。
  step(): boolean {
    if (this.halted) return false;

    // 割り込み処理
    this.handlePendingInterrupts();

    // フェッチ
    const pc = this.registers[Register.PC] ?? 0;
    const byte0 = this.memory.readByte(pc);
    const byte1 = this.memory.readByte(pc + 1);
    const byte2 = this.memory.readByte(pc + 2);
    const byte3 = this.memory.readByte(pc + 3);
    const opcode = byte0;
    const op1 = byte1;
    const op2 = (byte3 << 8) | byte2; // リトルエンディアン

    this.onEvent?.({
      type: "cpu_fetch", pc, opcode,
      timestamp: performance.now() - this.startTime,
    });

    // PC を進める（分岐命令は上書きする）
    this.registers[Register.PC] = (pc + 4) & 0xFFFF;

    // デコード＆実行
    this.execute(opcode, op1, op2);

    this.cycles++;
    this.timer.tick();

    return !this.halted;
  }

  // 指定回数だけ命令を実行する
  run(maxCycles: number): number {
    let executed = 0;
    while (executed < maxCycles && !this.halted) {
      this.step();
      executed++;
    }
    return executed;
  }

  private execute(opcode: number, op1: number, op2: number): void {
    const mnemonic = MNEMONIC[opcode] ?? `???:${String(opcode)}`;

    switch (opcode) {
      // === データ転送 ===
      case OpCode.MOV: {
        // MOV Rd, Rs
        this.registers[op1] = this.registers[op2 & 0xFF] ?? 0;
        this.emitExec(mnemonic, `R${String(op1)} = R${String(op2 & 0xFF)} (${String(this.registers[op1])})`);
        break;
      }
      case OpCode.MOVI: {
        // MOVI Rd, imm16
        this.registers[op1] = op2 & 0xFFFF;
        this.emitExec(mnemonic, `R${String(op1)} = ${String(op2)}`);
        break;
      }
      case OpCode.LOAD: {
        // LOAD Rd, [Rs]
        const addr = this.registers[op2 & 0xFF] ?? 0;
        this.registers[op1] = this.memory.readWord(addr);
        this.emitExec(mnemonic, `R${String(op1)} = [0x${addr.toString(16)}] (${String(this.registers[op1])})`);
        break;
      }
      case OpCode.STORE: {
        // STORE [Rd], Rs
        const addr = this.registers[op1] ?? 0;
        const val = this.registers[op2 & 0xFF] ?? 0;
        this.memory.writeWord(addr, val);
        this.emitExec(mnemonic, `[0x${addr.toString(16)}] = R${String(op2 & 0xFF)} (${String(val)})`);
        break;
      }
      case OpCode.PUSH: {
        // PUSH Rs — SP を減らしてから格納
        const sp = ((this.registers[Register.SP] ?? 0) - 2) & 0xFFFF;
        this.registers[Register.SP] = sp;
        this.memory.writeWord(sp, this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `[SP=0x${sp.toString(16)}] = R${String(op1)}`);
        break;
      }
      case OpCode.POP: {
        // POP Rd — 取り出してから SP を増やす
        const sp = this.registers[Register.SP] ?? 0;
        this.registers[op1] = this.memory.readWord(sp);
        this.registers[Register.SP] = (sp + 2) & 0xFFFF;
        this.emitExec(mnemonic, `R${String(op1)} = [SP=0x${sp.toString(16)}] (${String(this.registers[op1])})`);
        break;
      }

      // === 算術演算 ===
      case OpCode.ADD: {
        const a = this.registers[op1] ?? 0;
        const b = this.registers[op2 & 0xFF] ?? 0;
        const result = (a + b) & 0xFFFF;
        this.registers[op1] = result;
        this.updateFlags(result);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(a)} + ${String(b)} = ${String(result)}`);
        break;
      }
      case OpCode.SUB: {
        const a = this.registers[op1] ?? 0;
        const b = this.registers[op2 & 0xFF] ?? 0;
        const result = (a - b) & 0xFFFF;
        this.registers[op1] = result;
        this.updateFlags(result);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(a)} - ${String(b)} = ${String(result)}`);
        break;
      }
      case OpCode.MUL: {
        const a = this.registers[op1] ?? 0;
        const b = this.registers[op2 & 0xFF] ?? 0;
        this.registers[op1] = (a * b) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(a)} * ${String(b)} = ${String(this.registers[op1])}`);
        break;
      }
      case OpCode.DIV: {
        const a = this.registers[op1] ?? 0;
        const b = this.registers[op2 & 0xFF] ?? 0;
        this.registers[op1] = b !== 0 ? (Math.floor(a / b) & 0xFFFF) : 0;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(a)} / ${String(b)} = ${String(this.registers[op1])}`);
        break;
      }
      case OpCode.MOD: {
        const a = this.registers[op1] ?? 0;
        const b = this.registers[op2 & 0xFF] ?? 0;
        this.registers[op1] = b !== 0 ? (a % b) & 0xFFFF : 0;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(a)} % ${String(b)}`);
        break;
      }
      case OpCode.ADDI: {
        const a = this.registers[op1] ?? 0;
        const result = (a + toSigned16(op2)) & 0xFFFF;
        this.registers[op1] = result;
        this.updateFlags(result);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(a)} + ${String(toSigned16(op2))} = ${String(result)}`);
        break;
      }

      // === 論理演算 ===
      case OpCode.AND: {
        this.registers[op1] = ((this.registers[op1] ?? 0) & (this.registers[op2 & 0xFF] ?? 0)) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(this.registers[op1])}`);
        break;
      }
      case OpCode.OR: {
        this.registers[op1] = ((this.registers[op1] ?? 0) | (this.registers[op2 & 0xFF] ?? 0)) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(this.registers[op1])}`);
        break;
      }
      case OpCode.XOR: {
        this.registers[op1] = ((this.registers[op1] ?? 0) ^ (this.registers[op2 & 0xFF] ?? 0)) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(this.registers[op1])}`);
        break;
      }
      case OpCode.NOT: {
        this.registers[op1] = (~(this.registers[op1] ?? 0)) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} = ${String(this.registers[op1])}`);
        break;
      }
      case OpCode.SHL: {
        this.registers[op1] = ((this.registers[op1] ?? 0) << (this.registers[op2 & 0xFF] ?? 0)) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} <<= ${String(this.registers[op2 & 0xFF])}`);
        break;
      }
      case OpCode.SHR: {
        this.registers[op1] = ((this.registers[op1] ?? 0) >>> (this.registers[op2 & 0xFF] ?? 0)) & 0xFFFF;
        this.updateFlags(this.registers[op1] ?? 0);
        this.emitExec(mnemonic, `R${String(op1)} >>= ${String(this.registers[op2 & 0xFF])}`);
        break;
      }

      // === 比較 ===
      case OpCode.CMP: {
        const a = this.registers[op1] ?? 0;
        const b = this.registers[op2 & 0xFF] ?? 0;
        const result = (a - b) & 0xFFFF;
        this.updateFlags(result);
        // Carry: a < b
        if (a < b) {
          this.registers[Register.FLAGS] = (this.registers[Register.FLAGS] ?? 0) | Flag.Carry;
        }
        this.emitExec(mnemonic, `R${String(op1)}(${String(a)}) - R${String(op2 & 0xFF)}(${String(b)}) = ${String(toSigned16(result))}`);
        break;
      }
      case OpCode.CMPI: {
        const a = this.registers[op1] ?? 0;
        const result = (a - op2) & 0xFFFF;
        this.updateFlags(result);
        if (a < op2) {
          this.registers[Register.FLAGS] = (this.registers[Register.FLAGS] ?? 0) | Flag.Carry;
        }
        this.emitExec(mnemonic, `R${String(op1)}(${String(a)}) - ${String(op2)} = ${String(toSigned16(result))}`);
        break;
      }

      // === 分岐 ===
      case OpCode.JMP: {
        this.registers[Register.PC] = op2;
        this.emitExec(mnemonic, `PC = 0x${op2.toString(16)}`);
        break;
      }
      case OpCode.JZ: {
        if ((this.registers[Register.FLAGS] ?? 0) & Flag.Zero) {
          this.registers[Register.PC] = op2;
          this.emitExec(mnemonic, `Zero → PC = 0x${op2.toString(16)}`);
        } else {
          this.emitExec(mnemonic, `!Zero → skip`);
        }
        break;
      }
      case OpCode.JNZ: {
        if (!((this.registers[Register.FLAGS] ?? 0) & Flag.Zero)) {
          this.registers[Register.PC] = op2;
          this.emitExec(mnemonic, `!Zero → PC = 0x${op2.toString(16)}`);
        } else {
          this.emitExec(mnemonic, `Zero → skip`);
        }
        break;
      }
      case OpCode.JG: {
        const flags = this.registers[Register.FLAGS] ?? 0;
        if (!(flags & Flag.Zero) && !(flags & Flag.Negative)) {
          this.registers[Register.PC] = op2;
          this.emitExec(mnemonic, `Greater → PC = 0x${op2.toString(16)}`);
        } else {
          this.emitExec(mnemonic, `!Greater → skip`);
        }
        break;
      }
      case OpCode.JL: {
        if ((this.registers[Register.FLAGS] ?? 0) & Flag.Negative) {
          this.registers[Register.PC] = op2;
          this.emitExec(mnemonic, `Less → PC = 0x${op2.toString(16)}`);
        } else {
          this.emitExec(mnemonic, `!Less → skip`);
        }
        break;
      }
      case OpCode.CALL: {
        // リターンアドレスをスタックにプッシュ
        const sp = ((this.registers[Register.SP] ?? 0) - 2) & 0xFFFF;
        this.registers[Register.SP] = sp;
        this.memory.writeWord(sp, this.registers[Register.PC] ?? 0);
        this.registers[Register.PC] = op2;
        this.emitExec(mnemonic, `CALL 0x${op2.toString(16)} (ret=0x${(this.memory.readWord(sp)).toString(16)})`);
        break;
      }
      case OpCode.RET: {
        const sp = this.registers[Register.SP] ?? 0;
        this.registers[Register.PC] = this.memory.readWord(sp);
        this.registers[Register.SP] = (sp + 2) & 0xFFFF;
        this.emitExec(mnemonic, `RET → PC = 0x${(this.registers[Register.PC] ?? 0).toString(16)}`);
        break;
      }

      // === システム ===
      case OpCode.SYSCALL: {
        this.onEvent?.({
          type: "interrupt", intType: InterruptType.Syscall,
          timestamp: performance.now() - this.startTime,
        });
        this.interruptHandler?.(InterruptType.Syscall, this.registers[Register.R0] ?? 0);
        this.emitExec(mnemonic, `syscall #${String(this.registers[Register.R0])}`);
        break;
      }
      case OpCode.HALT: {
        this.halted = true;
        this.onEvent?.({ type: "halt", timestamp: performance.now() - this.startTime });
        this.emitExec(mnemonic, "CPU 停止");
        break;
      }
      case OpCode.NOP: {
        this.emitExec(mnemonic, "");
        break;
      }
      case OpCode.IRET: {
        // 割り込みから復帰: FLAGS と PC をスタックから復元
        const sp = this.registers[Register.SP] ?? 0;
        this.registers[Register.PC] = this.memory.readWord(sp);
        this.registers[Register.FLAGS] = this.memory.readWord(sp + 2);
        this.registers[Register.SP] = (sp + 4) & 0xFFFF;
        this.onEvent?.({ type: "interrupt_return", timestamp: performance.now() - this.startTime });
        this.emitExec(mnemonic, `PC=0x${(this.registers[Register.PC] ?? 0).toString(16)}`);
        break;
      }
      case OpCode.CLI: {
        // 割り込み禁止
        this.registers[Register.FLAGS] = (this.registers[Register.FLAGS] ?? 0) & ~Flag.Interrupt;
        this.emitExec(mnemonic, "割り込み禁止");
        break;
      }
      case OpCode.STI: {
        // 割り込み許可
        this.registers[Register.FLAGS] = (this.registers[Register.FLAGS] ?? 0) | Flag.Interrupt;
        this.emitExec(mnemonic, "割り込み許可");
        break;
      }

      default:
        this.emitExec("???", `不明なオペコード: 0x${opcode.toString(16)}`);
        this.halted = true;
    }
  }

  // 割り込み処理
  private handlePendingInterrupts(): void {
    if (this.pendingInterrupts.length === 0) return;

    const flags = this.registers[Register.FLAGS] ?? 0;
    // 割り込み禁止中はスキップ
    if (!(flags & Flag.Interrupt)) return;

    const interrupt = this.pendingInterrupts.shift();
    if (interrupt === undefined) return;

    this.onEvent?.({
      type: "interrupt", intType: interrupt.intType,
      timestamp: performance.now() - this.startTime,
    });

    // 現在のPC, FLAGSをスタックに退避
    const sp = ((this.registers[Register.SP] ?? 0) - 4) & 0xFFFF;
    this.registers[Register.SP] = sp;
    this.memory.writeWord(sp, this.registers[Register.PC] ?? 0);
    this.memory.writeWord(sp + 2, this.registers[Register.FLAGS] ?? 0);

    // 割り込み禁止（二重割り込み防止）
    this.registers[Register.FLAGS] = flags & ~Flag.Interrupt;

    // ハンドラ呼び出し
    this.interruptHandler?.(interrupt.intType, interrupt.data);
  }

  // FLAGS を演算結果に基づいて更新
  private updateFlags(result: number): void {
    let flags = (this.registers[Register.FLAGS] ?? 0) & Flag.Interrupt; // Interrupt フラグだけ保持
    if (result === 0) flags |= Flag.Zero;
    if (result & 0x8000) flags |= Flag.Negative; // 最上位ビット = 負
    this.registers[Register.FLAGS] = flags;
  }

  private emitExec(mnemonic: string, detail: string): void {
    this.onEvent?.({
      type: "cpu_exec", mnemonic, detail,
      timestamp: performance.now() - this.startTime,
    });
  }

  resetTime(): void {
    this.startTime = performance.now();
  }

  // レジスタの状態をダンプ（デバッグ用）
  dumpRegisters(): Record<string, number> {
    return {
      R0: this.registers[Register.R0] ?? 0,
      R1: this.registers[Register.R1] ?? 0,
      R2: this.registers[Register.R2] ?? 0,
      R3: this.registers[Register.R3] ?? 0,
      R4: this.registers[Register.R4] ?? 0,
      R5: this.registers[Register.R5] ?? 0,
      R6: this.registers[Register.R6] ?? 0,
      R7: this.registers[Register.R7] ?? 0,
      PC: this.registers[Register.PC] ?? 0,
      SP: this.registers[Register.SP] ?? 0,
      FLAGS: this.registers[Register.FLAGS] ?? 0,
    };
  }
}

// 16ビット符号なし → 符号付きに変換
function toSigned16(value: number): number {
  const v = value & 0xFFFF;
  return v >= 0x8000 ? v - 0x10000 : v;
}
