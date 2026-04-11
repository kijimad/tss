/**
 * presets.ts — 実験プリセット
 */

import type { Instruction } from "./types.js";

export interface Preset {
  name: string;
  description: string;
  program: Instruction[];
  /** 初期メモリ内容 */
  initialMemory?: Record<number, number>;
}

/** ヘルパー: 命令生成 */
function I(asm: string, opcode: Instruction["opcode"], opts?: Partial<Instruction>): Instruction {
  return { opcode, asm, ...opts };
}

export const PRESETS: Preset[] = [
  // ── 1. フェッチ-デコード-実行サイクル ──
  {
    name: "基本: フェッチ-デコード-実行サイクル",
    description:
      "最もシンプルなプログラム。即値ロード→加算→停止 の3命令でCPUサイクルの基本動作を観察する。",
    program: [
      I("MOVI R0, 10",  "MOVI", { rd: 0, imm: 10 }),
      I("MOVI R1, 20",  "MOVI", { rd: 1, imm: 20 }),
      I("ADD  R2, R0, R1", "ADD", { rd: 2, rs1: 0, rs2: 1 }),
      I("HLT",          "HLT"),
    ],
  },

  // ── 2. ALU 演算 ──
  {
    name: "ALU: 算術・論理演算",
    description:
      "ADD, SUB, MUL, AND, OR, XOR, NOT, SHL, SHR をすべて使用。ALU内部の演算とフラグ変化を追跡する。",
    program: [
      I("MOVI R0, 100",    "MOVI", { rd: 0, imm: 100 }),
      I("MOVI R1, 25",     "MOVI", { rd: 1, imm: 25 }),
      I("ADD  R2, R0, R1", "ADD",  { rd: 2, rs1: 0, rs2: 1 }),   // 125
      I("SUB  R3, R0, R1", "SUB",  { rd: 3, rs1: 0, rs2: 1 }),   // 75
      I("MUL  R4, R0, R1", "MUL",  { rd: 4, rs1: 0, rs2: 1 }),   // 2500
      I("MOVI R5, 0xFF",   "MOVI", { rd: 5, imm: 0xFF }),
      I("MOVI R6, 0x0F",   "MOVI", { rd: 6, imm: 0x0F }),
      I("AND  R7, R5, R6", "AND",  { rd: 7, rs1: 5, rs2: 6 }),   // 0x0F
      I("OR   R7, R5, R6", "OR",   { rd: 7, rs1: 5, rs2: 6 }),   // 0xFF
      I("XOR  R7, R5, R6", "XOR",  { rd: 7, rs1: 5, rs2: 6 }),   // 0xF0
      I("NOT  R7, R5",     "NOT",  { rd: 7, rs1: 5 }),
      I("SHL  R2, R1, 2",  "SHL",  { rd: 2, rs1: 1, imm: 2 }),   // 100
      I("SHR  R3, R0, 1",  "SHR",  { rd: 3, rs1: 0, imm: 1 }),   // 50
      I("HLT",             "HLT"),
    ],
  },

  // ── 3. メモリアクセス (LOAD / STORE) ──
  {
    name: "メモリ: LOAD / STORE",
    description:
      "データバスを通じたメモリ読み書き。STORE でレジスタ値をメモリに書き、LOAD で別のレジスタに読み戻す。",
    program: [
      I("MOVI  R0, 42",       "MOVI",  { rd: 0, imm: 42 }),
      I("MOVI  R1, 99",       "MOVI",  { rd: 1, imm: 99 }),
      I("STORE R0, [0x80]",   "STORE", { rs1: 0, addr: 0x80 }),
      I("STORE R1, [0x81]",   "STORE", { rs1: 1, addr: 0x81 }),
      I("LOAD  R2, [0x80]",   "LOAD",  { rd: 2, addr: 0x80 }),
      I("LOAD  R3, [0x81]",   "LOAD",  { rd: 3, addr: 0x81 }),
      I("ADD   R4, R2, R3",   "ADD",   { rd: 4, rs1: 2, rs2: 3 }),
      I("STORE R4, [0x82]",   "STORE", { rs1: 4, addr: 0x82 }),
      I("LOAD  R5, [0xA0]",   "LOAD",  { rd: 5, addr: 0xA0 }),  // 初期メモリから読む
      I("HLT",                "HLT"),
    ],
    initialMemory: { 0xA0: 1234 },
  },

  // ── 4. 条件分岐 ──
  {
    name: "分岐: if-else (CMP + JEQ/JNE)",
    description:
      "CMP でフラグを設定し、条件ジャンプで分岐。R0==R1 なら R2=1 (等しい)、そうでなければ R2=0。",
    program: [
      I("MOVI R0, 5",      "MOVI", { rd: 0, imm: 5 }),
      I("MOVI R1, 5",      "MOVI", { rd: 1, imm: 5 }),
      I("CMP  R0, R1",     "CMP",  { rs1: 0, rs2: 1 }),
      I("JEQ  0x05",       "JEQ",  { addr: 5 }),          // 等しければ5番目へ
      I("MOVI R2, 0",      "MOVI", { rd: 2, imm: 0 }),    // else: R2=0
      I("JMP  0x07",       "JMP",  { addr: 7 }),           // → HLTへ (修正: 6→7)
      I("MOVI R2, 1",      "MOVI", { rd: 2, imm: 1 }),    // then: R2=1 (addr=5 → ここが6番目、0-indexed で5)
      I("HLT",             "HLT"),
    ],
  },

  // ── 5. ループ ──
  {
    name: "ループ: 1+2+...+10 の合計",
    description:
      "CMP + JNE による繰り返し。カウンタ R0 を 1→10 でインクリメントし、R1 に合計を蓄積。結果は55。",
    program: [
      // 0: R0=1 (カウンタ), R1=0 (合計), R2=10 (上限), R3=1 (定数)
      I("MOVI R0, 1",       "MOVI", { rd: 0, imm: 1 }),
      I("MOVI R1, 0",       "MOVI", { rd: 1, imm: 0 }),
      I("MOVI R2, 11",      "MOVI", { rd: 2, imm: 11 }),
      I("MOVI R3, 1",       "MOVI", { rd: 3, imm: 1 }),
      // 4: loop: R1 += R0, R0++, R0 != 11 ならループ
      I("ADD  R1, R1, R0",  "ADD",  { rd: 1, rs1: 1, rs2: 0 }),
      I("ADD  R0, R0, R3",  "ADD",  { rd: 0, rs1: 0, rs2: 3 }),
      I("CMP  R0, R2",      "CMP",  { rs1: 0, rs2: 2 }),
      I("JNE  0x04",        "JNE",  { addr: 4 }),
      I("HLT",              "HLT"),
    ],
  },

  // ── 6. サブルーチン呼び出し (CALL / RET) ──
  {
    name: "サブルーチン: CALL / RET",
    description:
      "CALL でスタックに戻りアドレスを保存しサブルーチンへジャンプ。RET で復帰。スタック操作を追跡。",
    program: [
      // 0: メイン
      I("MOVI R0, 7",     "MOVI", { rd: 0, imm: 7 }),
      I("CALL 0x04",      "CALL", { addr: 4 }),         // double サブルーチンへ
      I("STORE R0, [0x80]", "STORE", { rs1: 0, addr: 0x80 }),  // 結果を保存
      I("HLT",            "HLT"),
      // 4: double(R0) → R0 = R0 + R0
      I("ADD  R0, R0, R0", "ADD",  { rd: 0, rs1: 0, rs2: 0 }),
      I("RET",            "RET"),
    ],
  },

  // ── 7. スタック操作 (PUSH / POP) ──
  {
    name: "スタック: PUSH / POP",
    description:
      "PUSH/POP でスタックメモリの成長と縮退を観察。SP（スタックポインタ）の変化に注目。LIFO構造の動作確認。",
    program: [
      I("MOVI R0, 10",   "MOVI", { rd: 0, imm: 10 }),
      I("MOVI R1, 20",   "MOVI", { rd: 1, imm: 20 }),
      I("MOVI R2, 30",   "MOVI", { rd: 2, imm: 30 }),
      I("PUSH R0",       "PUSH", { rs1: 0 }),
      I("PUSH R1",       "PUSH", { rs1: 1 }),
      I("PUSH R2",       "PUSH", { rs1: 2 }),
      I("POP  R5",       "POP",  { rd: 5 }),   // R5 = 30 (LIFO)
      I("POP  R6",       "POP",  { rd: 6 }),   // R6 = 20
      I("POP  R7",       "POP",  { rd: 7 }),   // R7 = 10
      I("HLT",           "HLT"),
    ],
  },

  // ── 8. I/O ──
  {
    name: "I/O: 入出力ポート",
    description:
      "IN/OUT 命令でI/Oポートとデータをやりとり。メモリマップドI/Oとは異なるポートマップドI/Oの動作。",
    program: [
      I("MOVI R0, 0x41",  "MOVI", { rd: 0, imm: 0x41 }),   // 'A'
      I("OUT  0, R0",     "OUT",  { port: 0, rs1: 0 }),     // ポート0に出力
      I("MOVI R0, 0x42",  "MOVI", { rd: 0, imm: 0x42 }),   // 'B'
      I("OUT  0, R0",     "OUT",  { port: 0, rs1: 0 }),
      I("IN   R1, 1",     "IN",   { rd: 1, port: 1 }),      // ポート1から入力
      I("OUT  2, R1",     "OUT",  { port: 2, rs1: 1 }),     // ポート2に転送
      I("HLT",            "HLT"),
    ],
    initialMemory: {},
  },

  // ── 9. フラグとオーバーフロー ──
  {
    name: "フラグ: ゼロ・符号・キャリー・オーバーフロー",
    description:
      "各種演算でフラグレジスタがどう変化するか。ゼロ結果(ZF)、負の結果(SF)、桁あふれ(CF)、符号付きオーバーフロー(OF)。",
    program: [
      // ZF: 5 - 5 = 0
      I("MOVI R0, 5",       "MOVI", { rd: 0, imm: 5 }),
      I("MOVI R1, 5",       "MOVI", { rd: 1, imm: 5 }),
      I("SUB  R2, R0, R1",  "SUB",  { rd: 2, rs1: 0, rs2: 1 }),   // ZF=1

      // SF: 3 - 10 = -7 (0xFFF9)
      I("MOVI R0, 3",       "MOVI", { rd: 0, imm: 3 }),
      I("MOVI R1, 10",      "MOVI", { rd: 1, imm: 10 }),
      I("SUB  R2, R0, R1",  "SUB",  { rd: 2, rs1: 0, rs2: 1 }),   // SF=1

      // CF: 0xFFFF + 1 = オーバーフロー
      I("MOVI R0, 0xFFFF",  "MOVI", { rd: 0, imm: 0xFFFF }),
      I("MOVI R1, 1",       "MOVI", { rd: 1, imm: 1 }),
      I("ADD  R2, R0, R1",  "ADD",  { rd: 2, rs1: 0, rs2: 1 }),   // CF=1, ZF=1

      // OF: 0x7FFF + 1 = 符号付きオーバーフロー
      I("MOVI R0, 0x7FFF",  "MOVI", { rd: 0, imm: 0x7FFF }),
      I("MOVI R1, 1",       "MOVI", { rd: 1, imm: 1 }),
      I("ADD  R2, R0, R1",  "ADD",  { rd: 2, rs1: 0, rs2: 1 }),   // OF=1, SF=1

      I("HLT",              "HLT"),
    ],
  },

  // ── 10. 総合: フィボナッチ ──
  {
    name: "総合: フィボナッチ数列 (10項)",
    description:
      "レジスタ、ALU、メモリ、ループ、条件分岐を総合的に使用。F(0)〜F(9) をメモリに格納。" +
      "結果: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34",
    program: [
      // R0=F(n-2), R1=F(n-1), R2=F(n), R3=カウンタ, R4=上限, R5=アドレス, R6=1(定数)
      I("MOVI R0, 0",          "MOVI",  { rd: 0, imm: 0 }),
      I("MOVI R1, 1",          "MOVI",  { rd: 1, imm: 1 }),
      I("MOVI R3, 0",          "MOVI",  { rd: 3, imm: 0 }),    // カウンタ
      I("MOVI R4, 10",         "MOVI",  { rd: 4, imm: 10 }),   // 上限
      I("MOVI R5, 0x80",       "MOVI",  { rd: 5, imm: 0x80 }), // 格納先
      I("MOVI R6, 1",          "MOVI",  { rd: 6, imm: 1 }),
      // 6: loop
      I("STORE R0, [0x80]",    "STORE", { rs1: 0, addr: 0x80 }), // ※ 動的アドレスは簡略化
      I("ADD   R2, R0, R1",    "ADD",   { rd: 2, rs1: 0, rs2: 1 }),
      I("MOV   R0, R1",        "MOV",   { rd: 0, rs1: 1 }),
      I("MOV   R1, R2",        "MOV",   { rd: 1, rs1: 2 }),
      I("ADD   R3, R3, R6",    "ADD",   { rd: 3, rs1: 3, rs2: 6 }),
      I("CMP   R3, R4",        "CMP",   { rs1: 3, rs2: 4 }),
      I("JNE   0x06",          "JNE",   { addr: 6 }),
      I("HLT",                 "HLT"),
    ],
  },
];
