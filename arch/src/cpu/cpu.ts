/**
 * cpu.ts — 16ビットCPUシミュレータ
 *
 * フォン・ノイマン型アーキテクチャ:
 *   - 8本の汎用レジスタ (R0-R7)
 *   - 256ワードのメモリ空間
 *   - フラグレジスタ (ZF, SF, CF, OF)
 *   - フェッチ→デコード→実行→メモリ→ライトバック の5段パイプライン
 */

import type {
  CpuState,
  Instruction,
  Flags,
  CycleTrace,
  ExecutionResult,
} from "./types.js";

/** レジスタ名テーブル */
export const REG_NAMES = ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"];

/** 16ビット範囲にクランプ */
function to16bit(v: number): number {
  return ((v % 0x10000) + 0x10000) % 0x10000;
}

/** 符号付き16ビットとして解釈 */
function signed16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** 初期状態を生成 */
export function createInitialState(): CpuState {
  return {
    registers: new Array(8).fill(0),
    pc: 0,
    sp: 0xff, // スタックはメモリ末尾から成長
    flags: { ZF: false, SF: false, CF: false, OF: false },
    memory: new Array(256).fill(0),
    io: new Array(8).fill(0),
    cycle: 0,
    halted: false,
  };
}

/** フラグを更新する */
function updateFlags(result: number, a: number, b: number, isSub: boolean): Flags {
  const r16 = to16bit(result);
  const ZF = r16 === 0;
  const SF = r16 >= 0x8000;

  let CF: boolean;
  if (isSub) {
    CF = a < b; // 借りが発生
  } else {
    CF = result > 0xffff; // 桁あふれ
  }

  // 符号付きオーバーフロー
  const sa = signed16(to16bit(a));
  const sb = signed16(to16bit(b));
  const sr = isSub ? sa - sb : sa + sb;
  const OF = sr > 32767 || sr < -32768;

  return { ZF, SF, CF, OF };
}

/** プログラムをメモリにロードして実行する */
export function execute(
  program: Instruction[],
  initialMemory?: Record<number, number>,
  maxCycles = 200,
): ExecutionResult {
  const state = createInitialState();
  const traces: CycleTrace[] = [];
  const errors: string[] = [];

  // プログラムはメモリの先頭に配置（命令テーブルとして扱う）
  // 実際のメモリにはデータのみ格納
  if (initialMemory) {
    for (const [addr, val] of Object.entries(initialMemory)) {
      const a = Number(addr);
      if (a >= 0 && a < 256) state.memory[a] = to16bit(val);
    }
  }

  while (!state.halted && state.cycle < maxCycles) {
    const pc = state.pc;

    if (pc < 0 || pc >= program.length) {
      errors.push(`PC=${pc} がプログラム範囲外 (0-${program.length - 1})`);
      break;
    }

    const inst = program[pc]!;
    state.cycle++;

    // ── フェッチ ──
    const fetchDesc = `PC=0x${pc.toString(16).padStart(2, "0")} → 命令読み出し: ${inst.asm}`;

    // ── デコード ──
    const decodeParts: string[] = [`opcode=${inst.opcode}`];
    if (inst.rd !== undefined) decodeParts.push(`rd=${REG_NAMES[inst.rd]}`);
    if (inst.rs1 !== undefined) decodeParts.push(`rs1=${REG_NAMES[inst.rs1]}`);
    if (inst.rs2 !== undefined) decodeParts.push(`rs2=${REG_NAMES[inst.rs2]}`);
    if (inst.imm !== undefined) decodeParts.push(`imm=${inst.imm}`);
    if (inst.addr !== undefined) decodeParts.push(`addr=0x${inst.addr.toString(16).padStart(2, "0")}`);
    if (inst.port !== undefined) decodeParts.push(`port=${inst.port}`);
    const decodeDesc = decodeParts.join(", ");

    // ── 実行 ──
    let execDesc = "";
    let memDesc = "なし";
    let wbDesc = "なし";
    let nextPc = pc + 1;

    switch (inst.opcode) {
      case "NOP":
        execDesc = "何もしない";
        break;

      case "MOVI":
        execDesc = `${REG_NAMES[inst.rd!]} ← ${inst.imm!}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${inst.imm!}`;
        state.registers[inst.rd!] = to16bit(inst.imm!);
        break;

      case "MOV":
        execDesc = `${REG_NAMES[inst.rd!]} ← ${REG_NAMES[inst.rs1!]} (=${state.registers[inst.rs1!]})`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${state.registers[inst.rs1!]}`;
        state.registers[inst.rd!] = state.registers[inst.rs1!]!;
        break;

      case "LOAD": {
        const addr = inst.addr!;
        const val = state.memory[addr] ?? 0;
        execDesc = `アドレス計算: 0x${addr.toString(16).padStart(2, "0")}`;
        memDesc = `MEM[0x${addr.toString(16).padStart(2, "0")}] → ${val}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${val}`;
        state.registers[inst.rd!] = val;
        break;
      }

      case "STORE": {
        const addr = inst.addr!;
        const val = state.registers[inst.rs1!]!;
        execDesc = `アドレス計算: 0x${addr.toString(16).padStart(2, "0")}`;
        memDesc = `${val} → MEM[0x${addr.toString(16).padStart(2, "0")}]`;
        state.memory[addr] = val;
        break;
      }

      case "ADD": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a + b;
        state.flags = updateFlags(result, a, b, false);
        state.registers[inst.rd!] = to16bit(result);
        execDesc = `ALU: ${a} + ${b} = ${to16bit(result)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${to16bit(result)}, flags={ZF=${state.flags.ZF ? 1 : 0},SF=${state.flags.SF ? 1 : 0},CF=${state.flags.CF ? 1 : 0},OF=${state.flags.OF ? 1 : 0}}`;
        break;
      }

      case "SUB": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a - b;
        state.flags = updateFlags(result, a, b, true);
        state.registers[inst.rd!] = to16bit(result);
        execDesc = `ALU: ${a} - ${b} = ${to16bit(result)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${to16bit(result)}, flags={ZF=${state.flags.ZF ? 1 : 0},SF=${state.flags.SF ? 1 : 0}}`;
        break;
      }

      case "MUL": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a * b;
        state.registers[inst.rd!] = to16bit(result);
        state.flags.ZF = to16bit(result) === 0;
        state.flags.SF = to16bit(result) >= 0x8000;
        execDesc = `ALU: ${a} × ${b} = ${to16bit(result)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${to16bit(result)}`;
        break;
      }

      case "AND": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a & b;
        state.registers[inst.rd!] = result;
        state.flags.ZF = result === 0;
        state.flags.SF = result >= 0x8000;
        execDesc = `ALU: 0x${a.toString(16)} AND 0x${b.toString(16)} = 0x${result.toString(16)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${result}`;
        break;
      }

      case "OR": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a | b;
        state.registers[inst.rd!] = result;
        state.flags.ZF = result === 0;
        state.flags.SF = result >= 0x8000;
        execDesc = `ALU: 0x${a.toString(16)} OR 0x${b.toString(16)} = 0x${result.toString(16)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${result}`;
        break;
      }

      case "XOR": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a ^ b;
        state.registers[inst.rd!] = result;
        state.flags.ZF = result === 0;
        state.flags.SF = result >= 0x8000;
        execDesc = `ALU: 0x${a.toString(16)} XOR 0x${b.toString(16)} = 0x${result.toString(16)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${result}`;
        break;
      }

      case "NOT": {
        const a = state.registers[inst.rs1!]!;
        const result = to16bit(~a);
        state.registers[inst.rd!] = result;
        state.flags.ZF = result === 0;
        state.flags.SF = result >= 0x8000;
        execDesc = `ALU: NOT 0x${a.toString(16)} = 0x${result.toString(16)}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${result}`;
        break;
      }

      case "SHL": {
        const a = state.registers[inst.rs1!]!;
        const shift = inst.imm ?? 1;
        const result = to16bit(a << shift);
        state.registers[inst.rd!] = result;
        state.flags.ZF = result === 0;
        state.flags.CF = ((a << (shift - 1)) & 0x8000) !== 0;
        execDesc = `ALU: ${a} << ${shift} = ${result}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${result}`;
        break;
      }

      case "SHR": {
        const a = state.registers[inst.rs1!]!;
        const shift = inst.imm ?? 1;
        const result = a >>> shift;
        state.registers[inst.rd!] = result;
        state.flags.ZF = result === 0;
        execDesc = `ALU: ${a} >>> ${shift} = ${result}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${result}`;
        break;
      }

      case "CMP": {
        const a = state.registers[inst.rs1!]!;
        const b = state.registers[inst.rs2!]!;
        const result = a - b;
        state.flags = updateFlags(result, a, b, true);
        execDesc = `ALU: CMP ${a}, ${b} → ZF=${state.flags.ZF ? 1 : 0}, SF=${state.flags.SF ? 1 : 0}`;
        break;
      }

      case "JMP":
        nextPc = inst.addr!;
        execDesc = `PC ← 0x${inst.addr!.toString(16).padStart(2, "0")} (無条件ジャンプ)`;
        break;

      case "JEQ":
        if (state.flags.ZF) {
          nextPc = inst.addr!;
          execDesc = `ZF=1 → PC ← 0x${inst.addr!.toString(16).padStart(2, "0")} (分岐成立)`;
        } else {
          execDesc = `ZF=0 → 分岐不成立、PC=${pc + 1} に進む`;
        }
        break;

      case "JNE":
        if (!state.flags.ZF) {
          nextPc = inst.addr!;
          execDesc = `ZF=0 → PC ← 0x${inst.addr!.toString(16).padStart(2, "0")} (分岐成立)`;
        } else {
          execDesc = `ZF=1 → 分岐不成立、PC=${pc + 1} に進む`;
        }
        break;

      case "JGT":
        if (!state.flags.SF && !state.flags.ZF) {
          nextPc = inst.addr!;
          execDesc = `SF=0,ZF=0 → PC ← 0x${inst.addr!.toString(16).padStart(2, "0")} (分岐成立)`;
        } else {
          execDesc = `条件不成立 → PC=${pc + 1} に進む`;
        }
        break;

      case "JLT":
        if (state.flags.SF) {
          nextPc = inst.addr!;
          execDesc = `SF=1 → PC ← 0x${inst.addr!.toString(16).padStart(2, "0")} (分岐成立)`;
        } else {
          execDesc = `SF=0 → 分岐不成立、PC=${pc + 1} に進む`;
        }
        break;

      case "CALL":
        state.sp--;
        state.memory[state.sp] = pc + 1; // 戻りアドレスをスタックに保存
        nextPc = inst.addr!;
        execDesc = `PUSH PC+1 (=${pc + 1}) → SP=0x${state.sp.toString(16)}, PC ← 0x${inst.addr!.toString(16).padStart(2, "0")}`;
        memDesc = `MEM[0x${state.sp.toString(16)}] ← ${pc + 1} (戻りアドレス)`;
        break;

      case "RET": {
        const retAddr = state.memory[state.sp] ?? 0;
        state.sp++;
        nextPc = retAddr;
        execDesc = `POP → PC ← ${retAddr}, SP=0x${state.sp.toString(16)}`;
        memDesc = `MEM[0x${(state.sp - 1).toString(16)}] → ${retAddr} (戻りアドレス)`;
        break;
      }

      case "PUSH": {
        const val = state.registers[inst.rs1!]!;
        state.sp--;
        state.memory[state.sp] = val;
        execDesc = `SP-- → 0x${state.sp.toString(16)}`;
        memDesc = `MEM[0x${state.sp.toString(16)}] ← ${val}`;
        break;
      }

      case "POP": {
        const val = state.memory[state.sp] ?? 0;
        state.sp++;
        state.registers[inst.rd!] = val;
        execDesc = `SP++ → 0x${state.sp.toString(16)}`;
        memDesc = `MEM[0x${(state.sp - 1).toString(16)}] → ${val}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${val}`;
        break;
      }

      case "IN": {
        const port = inst.port!;
        const val = state.io[port] ?? 0;
        state.registers[inst.rd!] = val;
        execDesc = `IO[${port}] → ${val}`;
        wbDesc = `${REG_NAMES[inst.rd!]} = ${val}`;
        break;
      }

      case "OUT": {
        const port = inst.port!;
        const val = state.registers[inst.rs1!]!;
        state.io[port] = val;
        execDesc = `${val} → IO[${port}]`;
        break;
      }

      case "HLT":
        state.halted = true;
        execDesc = "CPU停止";
        break;

      default:
        errors.push(`未知の命令: ${inst.opcode}`);
        state.halted = true;
        execDesc = `エラー: 未知の命令 ${inst.opcode}`;
    }

    state.pc = nextPc;

    traces.push({
      cycle: state.cycle,
      pc,
      stage: "execute",
      instruction: inst,
      description: `${inst.asm}`,
      fetch: fetchDesc,
      decode: decodeDesc,
      execute: execDesc,
      memAccess: memDesc,
      writeback: wbDesc,
      registersAfter: [...state.registers],
      flagsAfter: { ...state.flags },
      spAfter: state.sp,
    });
  }

  if (state.cycle >= maxCycles && !state.halted) {
    errors.push(`最大サイクル数 (${maxCycles}) に到達。無限ループの可能性。`);
  }

  return {
    success: errors.length === 0,
    traces,
    finalState: state,
    errors,
  };
}
