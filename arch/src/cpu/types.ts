/**
 * types.ts — コンピュータ・アーキテクチャの型定義
 *
 * フォン・ノイマン型アーキテクチャのシンプルな16ビットCPUを模倣。
 * フェッチ→デコード→実行 のパイプラインを1サイクルずつ追跡する。
 */

/** オペコード一覧 */
export type Opcode =
  | "NOP"
  | "LOAD"   // LOAD  Rd, addr     : メモリ→レジスタ
  | "STORE"  // STORE Rs, addr     : レジスタ→メモリ
  | "MOVI"   // MOVI  Rd, imm      : 即値→レジスタ
  | "MOV"    // MOV   Rd, Rs       : レジスタ間コピー
  | "ADD"    // ADD   Rd, Rs1, Rs2 : 加算
  | "SUB"    // SUB   Rd, Rs1, Rs2 : 減算
  | "MUL"    // MUL   Rd, Rs1, Rs2 : 乗算
  | "AND"    // AND   Rd, Rs1, Rs2 : ビットAND
  | "OR"     // OR    Rd, Rs1, Rs2 : ビットOR
  | "XOR"    // XOR   Rd, Rs1, Rs2 : ビットXOR
  | "NOT"    // NOT   Rd, Rs       : ビット反転
  | "SHL"    // SHL   Rd, Rs, imm  : 左シフト
  | "SHR"    // SHR   Rd, Rs, imm  : 右シフト
  | "CMP"    // CMP   Rs1, Rs2     : 比較 (フラグ設定)
  | "JMP"    // JMP   addr         : 無条件ジャンプ
  | "JEQ"    // JEQ   addr         : ZF=1 ならジャンプ
  | "JNE"    // JNE   addr         : ZF=0 ならジャンプ
  | "JGT"    // JGT   addr         : SF=0 && ZF=0 ならジャンプ
  | "JLT"    // JLT   addr         : SF=1 ならジャンプ
  | "CALL"   // CALL  addr         : サブルーチン呼び出し
  | "RET"    // RET                : サブルーチン復帰
  | "PUSH"   // PUSH  Rs           : スタックに積む
  | "POP"    // POP   Rd           : スタックから取る
  | "IN"     // IN    Rd, port     : I/O読み込み
  | "OUT"    // OUT   port, Rs     : I/O書き出し
  | "HLT";   // HLT                : 停止

/** 命令フォーマット */
export interface Instruction {
  opcode: Opcode;
  rd?: number;     // 宛先レジスタ (0-7)
  rs1?: number;    // ソースレジスタ1
  rs2?: number;    // ソースレジスタ2
  imm?: number;    // 即値
  addr?: number;   // メモリアドレス / ジャンプ先
  port?: number;   // I/O ポート番号
  /** アセンブリ表記 */
  asm: string;
}

/** フラグレジスタ */
export interface Flags {
  ZF: boolean;  // ゼロフラグ
  SF: boolean;  // 符号フラグ (負)
  CF: boolean;  // キャリーフラグ
  OF: boolean;  // オーバーフローフラグ
}

/** CPU の状態 */
export interface CpuState {
  /** 汎用レジスタ R0-R7 */
  registers: number[];
  /** プログラムカウンタ */
  pc: number;
  /** スタックポインタ */
  sp: number;
  /** フラグレジスタ */
  flags: Flags;
  /** メモリ (256 ワード) */
  memory: number[];
  /** I/O ポート (8 ポート) */
  io: number[];
  /** 実行サイクル数 */
  cycle: number;
  /** 停止状態 */
  halted: boolean;
}

/** パイプラインステージ */
export type PipelineStage = "fetch" | "decode" | "execute" | "memory" | "writeback";

/** 1サイクルの実行トレース */
export interface CycleTrace {
  cycle: number;
  pc: number;
  stage: PipelineStage;
  instruction: Instruction;
  description: string;
  /** 各ステージの詳細 */
  fetch: string;
  decode: string;
  execute: string;
  memAccess: string;
  writeback: string;
  /** このサイクル後のレジスタスナップショット */
  registersAfter: number[];
  flagsAfter: Flags;
  spAfter: number;
}

/** 実行結果 */
export interface ExecutionResult {
  success: boolean;
  traces: CycleTrace[];
  finalState: CpuState;
  errors: string[];
}
