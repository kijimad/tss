/**
 * types.ts — ハードウェア層の型定義
 *
 * 実際のコンピュータのハードウェアを TypeScript でエミュレートする。
 *
 *   ┌─────────────────────────────────────────────┐
 *   │                    CPU                      │
 *   │  レジスタ (R0-R7, PC, SP, FLAGS)             │
 *   │  ALU (算術論理演算)                          │
 *   │  命令フェッチ → デコード → 実行              │
 *   ├─────────────────────────────────────────────┤
 *   │            割り込みコントローラ               │
 *   │  タイマー割り込み / ディスク完了 / syscall     │
 *   ├──────────┬──────────┬────────────────────────┤
 *   │  RAM     │  ディスク  │  タイマー              │
 *   │  64KB    │  ブロック  │  周期的割り込み         │
 *   └──────────┴──────────┴────────────────────────┘
 */

// =====================================================
// CPU
// =====================================================

// レジスタ名
export const Register = {
  R0: 0,    // 汎用レジスタ
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
  R5: 5,
  R6: 6,
  R7: 7,
  PC: 8,    // プログラムカウンタ
  SP: 9,    // スタックポインタ
  FLAGS: 10, // フラグレジスタ (Zero, Carry, Negative)
} as const;
export type Register = (typeof Register)[keyof typeof Register];

// CPU フラグ
export const Flag = {
  Zero: 0x01,      // 演算結果がゼロ
  Carry: 0x02,     // 桁あふれ
  Negative: 0x04,  // 負の値
  Interrupt: 0x08, // 割り込み許可
} as const;

// 命令セット（オペコード）
export const OpCode = {
  // データ転送
  MOV: 0x01,     // MOV Rd, Rs        — レジスタ間コピー
  MOVI: 0x02,    // MOVI Rd, imm16    — 即値ロード
  LOAD: 0x03,    // LOAD Rd, [Rs]     — メモリからロード
  STORE: 0x04,   // STORE [Rd], Rs    — メモリに格納
  PUSH: 0x05,    // PUSH Rs           — スタックにプッシュ
  POP: 0x06,     // POP Rd            — スタックからポップ

  // 算術演算
  ADD: 0x10,     // ADD Rd, Rs
  SUB: 0x11,     // SUB Rd, Rs
  MUL: 0x12,     // MUL Rd, Rs
  DIV: 0x13,     // DIV Rd, Rs
  MOD: 0x14,     // MOD Rd, Rs
  ADDI: 0x15,    // ADDI Rd, imm16    — 即値加算

  // 論理演算
  AND: 0x20,     // AND Rd, Rs
  OR: 0x21,      // OR Rd, Rs
  XOR: 0x22,     // XOR Rd, Rs
  NOT: 0x23,     // NOT Rd
  SHL: 0x24,     // SHL Rd, Rs        — 左シフト
  SHR: 0x25,     // SHR Rd, Rs        — 右シフト

  // 比較
  CMP: 0x30,     // CMP Rd, Rs        — 比較（FLAGS を更新）
  CMPI: 0x31,    // CMPI Rd, imm16    — 即値と比較

  // 分岐
  JMP: 0x40,     // JMP addr          — 無条件ジャンプ
  JZ: 0x41,      // JZ addr           — Zeroフラグが立っていたら
  JNZ: 0x42,     // JNZ addr          — Zeroフラグが立っていなかったら
  JG: 0x43,      // JG addr           — 大きい (CMP後)
  JL: 0x44,      // JL addr           — 小さい (CMP後)
  CALL: 0x45,    // CALL addr         — サブルーチン呼び出し
  RET: 0x46,     // RET               — サブルーチンから戻る

  // システム
  SYSCALL: 0x50, // SYSCALL           — カーネル呼び出し (R0=番号, R1-R3=引数)
  HALT: 0x51,    // HALT              — CPU停止
  NOP: 0x52,     // NOP               — 何もしない
  IRET: 0x53,    // IRET              — 割り込みから戻る
  CLI: 0x54,     // CLI               — 割り込み禁止
  STI: 0x55,     // STI               — 割り込み許可
} as const;
export type OpCode = (typeof OpCode)[keyof typeof OpCode];

// 命令のバイナリ構造 (4バイト固定長):
//   [OpCode:1B][Operand1:1B][Operand2:2B]
//   Operand2 はレジスタ番号(1B) or 即値(2B) として使い分ける
export interface Instruction {
  opcode: OpCode;
  op1: number;     // レジスタ番号 or 未使用
  op2: number;     // レジスタ番号 or 即値 or アドレス
}

// =====================================================
// 割り込み
// =====================================================
export const InterruptType = {
  Timer: 0,          // タイマー割り込み（プリエンプティブスケジューリング用）
  DiskComplete: 1,   // ディスクI/O完了
  Syscall: 2,        // システムコール
  PageFault: 3,      // ページフォルト（将来用）
  Keyboard: 4,       // キーボード入力
} as const;
export type InterruptType = (typeof InterruptType)[keyof typeof InterruptType];

// 割り込みハンドラ
export type InterruptHandler = (type: InterruptType, data: number) => void;

// =====================================================
// ディスク
// =====================================================
// ブロックサイズ
export const BLOCK_SIZE = 512;
// ディスクサイズ（ブロック数）
export const DISK_BLOCKS = 1024;  // 512KB

// =====================================================
// メモリ
// =====================================================
// メモリサイズ
export const MEMORY_SIZE = 65536; // 64KB

// メモリ領域の予約
export const MemoryLayout = {
  InterruptVectorTable: 0x0000,  // 割り込みベクタテーブル (256B)
  KernelStart: 0x0100,          // カーネル領域開始
  KernelEnd: 0x3FFF,            // カーネル領域終了 (~16KB)
  UserStart: 0x4000,            // ユーザ空間開始
  UserEnd: 0xEFFF,              // ユーザ空間終了 (~44KB)
  StackTop: 0xFFFF,             // スタックの頂点
} as const;

// =====================================================
// トレース/デバッグ用
// =====================================================
export type HwEvent =
  | { type: "cpu_fetch"; pc: number; opcode: number; timestamp: number }
  | { type: "cpu_exec"; mnemonic: string; detail: string; timestamp: number }
  | { type: "mem_read"; address: number; value: number; timestamp: number }
  | { type: "mem_write"; address: number; value: number; timestamp: number }
  | { type: "disk_read"; block: number; timestamp: number }
  | { type: "disk_write"; block: number; timestamp: number }
  | { type: "interrupt"; intType: InterruptType; timestamp: number }
  | { type: "interrupt_return"; timestamp: number }
  | { type: "timer_tick"; tickCount: number; timestamp: number }
  | { type: "halt"; timestamp: number };
