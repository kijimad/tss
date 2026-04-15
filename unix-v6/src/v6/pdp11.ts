/**
 * PDP-11 CPUエミュレータ
 *
 * 1970年代のDEC PDP-11/40をTypeScriptでエミュレートする。
 * Unix V6が動作したハードウェアの命令セット、アドレッシングモード、
 * トラップ機構、メモリマップドI/Oをステップ実行で可視化する。
 *
 * ■ PDP-11アーキテクチャの特徴:
 *   - 16ビットワード、8ビットバイトアドレッシング
 *   - 8本の汎用レジスタ (R0-R5, SP, PC)
 *   - 8種類のアドレッシングモード × 8レジスタ = 64通りのオペランド指定
 *   - PSW (Processor Status Word): N/Z/V/C条件コード + 優先度 + モード
 *   - トラップベクタによるカーネル/ユーザーモード切替
 *   - メモリマップドI/O (UNIBUS)
 *
 * ■ V6との関係:
 *   ユーザープログラムが TRAP 命令を実行すると、PSWのモードビットが
 *   カーネルモードに切り替わり、ベクタ0o34のアドレスにジャンプする。
 *   これがV6のシステムコール機構の基盤。
 */

// ─── 型定義 ───

/** PDP-11イベント種別 */
export type PDP11EventType =
  | "fetch" | "read" | "write" | "trap" | "interrupt"
  | "halt" | "mmio" | "mode_switch" | "stack_push" | "stack_pop"
  | "branch" | "error" | "console_out" | "info";

/** シミュレーションイベント */
export interface PDP11Event {
  type: PDP11EventType;
  message: string;
  addr?: number;
  value?: number;
}

/** デコード済み命令 */
export interface PDP11Decoded {
  /** 命令アドレス (8進数) */
  addr: number;
  /** 命令ワード列 */
  words: number[];
  /** ニーモニック */
  mnemonic: string;
  /** オペランド文字列 */
  operands: string;
  /** 日本語説明 */
  description: string;
}

/** 1ステップの実行結果 */
export interface PDP11StepResult {
  step: number;
  instruction: PDP11Decoded;
  /** レジスタ状態 (R0-R5, SP, PC) */
  registers: number[];
  /** PSW */
  psw: number;
  /** PSWフラグ (見やすい形式) */
  flags: { n: boolean; z: boolean; v: boolean; c: boolean; priority: number; mode: string };
  halted: boolean;
  /** メモリ変更 */
  memoryChanges: { addr: number; oldVal: number; newVal: number }[];
  /** コンソール出力(累積) */
  consoleOutput: string;
  events: PDP11Event[];
  message: string;
}

/** シミュレーション全体の結果 */
export interface PDP11SimResult {
  steps: PDP11StepResult[];
  events: PDP11Event[];
  consoleOutput: string;
}

/** プリセット定義 */
export interface PDP11Preset {
  name: string;
  description: string;
  /** プログラムを構築する */
  build(): PDP11Program;
}

/** アセンブル済みプログラム */
export interface PDP11Program {
  /** メモリ初期内容 (アドレス→バイト値) */
  memory: Uint8Array;
  /** 開始PC */
  startPC: number;
  /** 初期SP */
  startSP: number;
  /** プログラム説明 */
  description: string;
}

// ─── 定数 ───

/** レジスタ名 */
const REG_NAMES = ["R0", "R1", "R2", "R3", "R4", "R5", "SP", "PC"];

/** コンソールデバイスレジスタ (memory-mapped I/O, UNIBUS) */
const CONSOLE_RCSR = 0o177560;  // Receiver Control/Status Register
const CONSOLE_RBUF = 0o177562;  // Receiver Buffer Register
const CONSOLE_XCSR = 0o177564;  // Transmitter Control/Status Register
const CONSOLE_XBUF = 0o177566;  // Transmitter Buffer Register

/** トラップベクタアドレス */
const VEC_BUS_ERROR = 0o004;   // バスエラー
const VEC_ILLEGAL   = 0o010;   // 不正命令
const VEC_BPT       = 0o014;   // ブレークポイントトラップ
const VEC_IOT       = 0o020;   // IOTトラップ
const VEC_POWER     = 0o024;   // 電源異常
const VEC_EMT       = 0o030;   // EMTトラップ
const VEC_TRAP      = 0o034;   // TRAPトラップ (V6システムコール)

/** 最大ステップ数 (無限ループ防止) */
const MAX_STEPS = 10000;

// ─── 8進数表示ヘルパー ───

/** 8進数文字列 (PDP-11は伝統的に8進表記) */
function oct(v: number, width = 6): string {
  return v.toString(8).padStart(width, "0");
}

/** 8進数短縮表示 */
function octShort(v: number): string {
  return v.toString(8);
}

// ─── アセンブラ ───

/** オペランド記述子 */
export interface Operand {
  /** mode(3bit) << 3 | reg(3bit) */
  bits: number;
  /** 追加ワード (即値、インデックスオフセットなど) */
  extra?: number[];
}

// レジスタオペランド
export const R0: Operand = { bits: 0o00 };
export const R1: Operand = { bits: 0o01 };
export const R2: Operand = { bits: 0o02 };
export const R3: Operand = { bits: 0o03 };
export const R4: Operand = { bits: 0o04 };
export const R5: Operand = { bits: 0o05 };
export const SP: Operand = { bits: 0o06 };
export const PC: Operand = { bits: 0o07 };

/** 即値: #value — PC相対オートインクリメント (モード2, レジスタ7) */
export function imm(v: number): Operand {
  return { bits: 0o27, extra: [v & 0xFFFF] };
}

/** レジスタ間接: (Rn) */
export function ind(r: number): Operand {
  return { bits: 0o10 | (r & 7) };
}

/** オートインクリメント: (Rn)+ */
export function ainc(r: number): Operand {
  return { bits: 0o20 | (r & 7) };
}

/** オートインクリメント間接: @(Rn)+ */
export function aincDef(r: number): Operand {
  return { bits: 0o30 | (r & 7) };
}

/** オートデクリメント: -(Rn) */
export function adec(r: number): Operand {
  return { bits: 0o40 | (r & 7) };
}

/** オートデクリメント間接: @-(Rn) */
export function adecDef(r: number): Operand {
  return { bits: 0o50 | (r & 7) };
}

/** インデックス: offset(Rn) */
export function idx(r: number, offset: number): Operand {
  return { bits: 0o60 | (r & 7), extra: [offset & 0xFFFF] };
}

/** インデックス間接: @offset(Rn) */
export function idxDef(r: number, offset: number): Operand {
  return { bits: 0o70 | (r & 7), extra: [offset & 0xFFFF] };
}

/** 絶対アドレス: @#addr — @(PC)+ */
export function abs(addr: number): Operand {
  return { bits: 0o37, extra: [addr & 0xFFFF] };
}

/**
 * PDP-11 ミニアセンブラ
 *
 * プリセットのプログラムを読みやすい形式で記述するためのヘルパー。
 * ラベルとブランチの前方参照をサポートする。
 */
export class PDP11Asm {
  private words: number[] = [];
  private base: number;
  private labels = new Map<string, number>();
  private fixups: Array<{ wordIdx: number; label: string; type: "branch" | "pcrel" }> = [];
  private desc: string;
  private initSP: number;

  constructor(base = 0o1000, description = "", sp = 0o776) {
    this.base = base;
    this.desc = description;
    this.initSP = sp;
  }

  /** 現在のPC位置 */
  get pc(): number {
    return this.base + this.words.length * 2;
  }

  /** ラベル定義 */
  label(name: string): void {
    this.labels.set(name, this.pc);
  }

  /** ラベルのアドレスを取得 (ベクタ設定等に使用) */
  getLabelAddr(name: string): number | undefined {
    return this.labels.get(name);
  }

  /** 生ワードを出力 */
  word(...ws: number[]): void {
    for (const w of ws) this.words.push(w & 0xFFFF);
  }

  /** ASCII文字列をワード列として出力 (偶数パディング) */
  ascii(s: string): void {
    for (let i = 0; i < s.length; i += 2) {
      const lo = s.charCodeAt(i);
      const hi = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      this.words.push((hi << 8) | lo);
    }
  }

  // ─── ダブルオペランド命令 ───

  private emit2op(opcode: number, src: Operand, dst: Operand): void {
    this.words.push(opcode | (src.bits << 6) | dst.bits);
    if (src.extra) this.words.push(...src.extra);
    if (dst.extra) this.words.push(...dst.extra);
  }

  mov(src: Operand, dst: Operand): void { this.emit2op(0o010000, src, dst); }
  movb(src: Operand, dst: Operand): void { this.emit2op(0o110000, src, dst); }
  cmp(src: Operand, dst: Operand): void { this.emit2op(0o020000, src, dst); }
  cmpb(src: Operand, dst: Operand): void { this.emit2op(0o120000, src, dst); }
  bit(src: Operand, dst: Operand): void { this.emit2op(0o030000, src, dst); }
  bitb(src: Operand, dst: Operand): void { this.emit2op(0o130000, src, dst); }
  bic(src: Operand, dst: Operand): void { this.emit2op(0o040000, src, dst); }
  bicb(src: Operand, dst: Operand): void { this.emit2op(0o140000, src, dst); }
  bis(src: Operand, dst: Operand): void { this.emit2op(0o050000, src, dst); }
  bisb(src: Operand, dst: Operand): void { this.emit2op(0o150000, src, dst); }
  add(src: Operand, dst: Operand): void { this.emit2op(0o060000, src, dst); }
  sub(src: Operand, dst: Operand): void { this.emit2op(0o160000, src, dst); }

  // ─── EIS命令 ───

  private emitEIS(sub: number, reg: number, src: Operand): void {
    this.words.push(0o070000 | (sub << 9) | (reg << 6) | src.bits);
    if (src.extra) this.words.push(...src.extra);
  }

  mul(reg: number, src: Operand): void { this.emitEIS(0, reg, src); }
  div(reg: number, src: Operand): void { this.emitEIS(1, reg, src); }
  ash(reg: number, src: Operand): void { this.emitEIS(2, reg, src); }
  ashc(reg: number, src: Operand): void { this.emitEIS(3, reg, src); }
  xor(reg: number, dst: Operand): void { this.emitEIS(4, reg, dst); }

  // ─── シングルオペランド命令 ───

  private emit1op(opcode: number, dst: Operand): void {
    this.words.push(opcode | dst.bits);
    if (dst.extra) this.words.push(...dst.extra);
  }

  clr(dst: Operand): void { this.emit1op(0o005000, dst); }
  clrb(dst: Operand): void { this.emit1op(0o105000, dst); }
  com(dst: Operand): void { this.emit1op(0o005100, dst); }
  inc(dst: Operand): void { this.emit1op(0o005200, dst); }
  dec(dst: Operand): void { this.emit1op(0o005300, dst); }
  neg(dst: Operand): void { this.emit1op(0o005400, dst); }
  adc(dst: Operand): void { this.emit1op(0o005500, dst); }
  sbc(dst: Operand): void { this.emit1op(0o005600, dst); }
  tst(dst: Operand): void { this.emit1op(0o005700, dst); }
  ror(dst: Operand): void { this.emit1op(0o006000, dst); }
  rol(dst: Operand): void { this.emit1op(0o006100, dst); }
  asr(dst: Operand): void { this.emit1op(0o006200, dst); }
  asl(dst: Operand): void { this.emit1op(0o006300, dst); }
  swab(dst: Operand): void { this.emit1op(0o000300, dst); }
  sxt(dst: Operand): void { this.emit1op(0o006700, dst); }
  tstb(dst: Operand): void { this.emit1op(0o105700, dst); }
  incb(dst: Operand): void { this.emit1op(0o105200, dst); }
  decb(dst: Operand): void { this.emit1op(0o105300, dst); }
  negb(dst: Operand): void { this.emit1op(0o105400, dst); }

  // ─── ジャンプ/サブルーチン ───

  /** JMP dst — ラベルも受け付ける */
  jmp(dst: Operand | string): void {
    if (typeof dst === "string") {
      dst = this.labelToRelOperand(dst);
    }
    this.emit1op(0o000100, dst);
  }

  /** JSR reg, dst — レジスタ経由のサブルーチン呼び出し。ラベルも受け付ける */
  jsr(reg: number, dst: Operand | string): void {
    if (typeof dst === "string") {
      dst = this.labelToRelOperand(dst);
    }
    this.words.push(0o004000 | ((reg & 7) << 6) | dst.bits);
    if (dst.extra) this.words.push(...dst.extra);
  }

  /** ラベルをPC相対インデックスオペランドに変換 (ラベル解決はbuild時) */
  private labelToRelOperand(label: string): Operand {
    const resolved = this.labels.get(label);
    if (resolved !== undefined) {
      // 後方参照: 命令ワード + 追加ワード1つ = PC+4からの相対
      const instrPC = this.base + this.words.length * 2;
      const pcAfter = instrPC + 4; // JSR/JMP本体 + インデックスワード
      const offset = (resolved - pcAfter) & 0xFFFF;
      return { bits: 0o67, extra: [offset] }; // PC相対 (mode 6, reg 7)
    }
    // 前方参照: フィックスアップが必要
    // プレースホルダを登録して後で解決
    const fixupIdx = this.words.length + 1; // 追加ワードの位置
    this.fixups.push({ wordIdx: fixupIdx, label: label, type: "pcrel" });
    return { bits: 0o67, extra: [0] }; // プレースホルダ
  }

  /** RTS reg — サブルーチンからの復帰 */
  rts(reg: number): void {
    this.words.push(0o000200 | (reg & 7));
  }

  // ─── ブランチ命令 (ラベル対応) ───

  private emitBranch(opcode: number, target: string | number): void {
    if (typeof target === "number") {
      // 数値オフセット (ワード単位、PCからの相対)
      this.words.push(opcode | (target & 0xFF));
    } else {
      const resolved = this.labels.get(target);
      if (resolved !== undefined) {
        // 後方参照: オフセット計算
        const pcAfter = this.base + (this.words.length + 1) * 2;
        const offset = ((resolved - pcAfter) >> 1) & 0xFF;
        this.words.push(opcode | offset);
      } else {
        // 前方参照: フィックスアップ登録
        this.fixups.push({ wordIdx: this.words.length, label: target, type: "branch" });
        this.words.push(opcode);
      }
    }
  }

  br(t: string | number): void { this.emitBranch(0o000400, t); }
  bne(t: string | number): void { this.emitBranch(0o001000, t); }
  beq(t: string | number): void { this.emitBranch(0o001400, t); }
  bge(t: string | number): void { this.emitBranch(0o002000, t); }
  blt(t: string | number): void { this.emitBranch(0o002400, t); }
  bgt(t: string | number): void { this.emitBranch(0o003000, t); }
  ble(t: string | number): void { this.emitBranch(0o003400, t); }
  bpl(t: string | number): void { this.emitBranch(0o100000, t); }
  bmi(t: string | number): void { this.emitBranch(0o100400, t); }
  bhi(t: string | number): void { this.emitBranch(0o101000, t); }
  blos(t: string | number): void { this.emitBranch(0o101400, t); }
  bvc(t: string | number): void { this.emitBranch(0o102000, t); }
  bvs(t: string | number): void { this.emitBranch(0o102400, t); }
  bcc(t: string | number): void { this.emitBranch(0o103000, t); }
  bcs(t: string | number): void { this.emitBranch(0o103400, t); }

  /** SOB reg, label — Subtract One and Branch */
  sob(reg: number, target: string | number): void {
    if (typeof target === "number") {
      this.words.push(0o077000 | ((reg & 7) << 6) | (target & 0o77));
    } else {
      const resolved = this.labels.get(target);
      if (resolved !== undefined) {
        const pcAfter = this.base + (this.words.length + 1) * 2;
        const offset = ((pcAfter - resolved) >> 1) & 0o77;
        this.words.push(0o077000 | ((reg & 7) << 6) | offset);
      } else {
        throw new Error(`SOBは前方参照をサポートしていない: ${target}`);
      }
    }
  }

  // ─── 特殊命令 ───

  halt(): void { this.words.push(0o000000); }
  nop(): void { this.words.push(0o000240); }
  wait(): void { this.words.push(0o000001); }
  rti(): void { this.words.push(0o000002); }
  rtt(): void { this.words.push(0o000006); }
  reset(): void { this.words.push(0o000005); }
  bpt(): void { this.words.push(0o000003); }
  iot(): void { this.words.push(0o000004); }

  /** TRAP n — V6システムコール機構 (ベクタ0o34) */
  trap(n: number): void { this.words.push(0o104400 | (n & 0xFF)); }

  /** EMT n (ベクタ0o30) */
  emt(n: number): void { this.words.push(0o104000 | (n & 0xFF)); }

  /** 条件コード操作: CLC, CLV, CLZ, CLN, SEC, SEV, SEZ, SEN */
  clc(): void { this.words.push(0o000241); }
  clv(): void { this.words.push(0o000242); }
  clz(): void { this.words.push(0o000244); }
  cln(): void { this.words.push(0o000250); }
  sec(): void { this.words.push(0o000261); }
  sev(): void { this.words.push(0o000262); }
  sez(): void { this.words.push(0o000264); }
  sen(): void { this.words.push(0o000270); }
  ccc(): void { this.words.push(0o000257); } // 全クリア
  scc(): void { this.words.push(0o000277); } // 全セット

  // ─── ビルド ───

  /** プログラムをビルド。前方参照のラベルを解決する */
  build(): PDP11Program {
    // 前方参照を解決
    for (const f of this.fixups) {
      const labelAddr = this.labels.get(f.label);
      if (labelAddr === undefined) {
        throw new Error(`未定義ラベル: ${f.label}`);
      }
      if (f.type === "branch") {
        // ブランチ: 8ビットオフセット (ワード単位)
        const pcAfter = this.base + (f.wordIdx + 1) * 2;
        const offset = ((labelAddr - pcAfter) >> 1) & 0xFF;
        this.words[f.wordIdx] = (this.words[f.wordIdx] & 0xFF00) | offset;
      } else {
        // PC相対 (JSR/JMP): 16ビットオフセット
        const pcAfter = this.base + (f.wordIdx + 1) * 2;
        const offset = (labelAddr - pcAfter) & 0xFFFF;
        this.words[f.wordIdx] = offset;
      }
    }

    const memory = new Uint8Array(65536);
    let addr = this.base;
    for (const w of this.words) {
      memory[addr] = w & 0xFF;
      memory[addr + 1] = (w >> 8) & 0xFF;
      addr += 2;
    }

    return {
      memory,
      startPC: this.base,
      startSP: this.initSP,
      description: this.desc,
    };
  }
}

// ─── CPU エミュレータ ───

/** オペランド解決結果 */
type OpRef =
  | { type: "reg"; reg: number }
  | { type: "mem"; addr: number };

/**
 * PDP-11 CPUエミュレータ
 *
 * PDP-11/40の命令セットをエミュレートする。
 * 各step()呼び出しで1命令を実行し、状態スナップショットを返す。
 */
export class PDP11 {
  /** メモリ: 64KB (16ビットアドレス空間) */
  mem = new Uint8Array(65536);
  /** レジスタ R0-R5, SP(R6), PC(R7) */
  r = new Array<number>(8).fill(0);
  /** プロセッサステータスワード */
  psw = 0;
  /** 停止フラグ */
  halted = false;
  /** ステップカウンタ */
  stepCount = 0;
  /** コンソール出力バッファ */
  consoleOutput = "";

  // ステップ中のトラッキング
  private events: PDP11Event[] = [];
  private memChanges: Array<{ addr: number; oldVal: number; newVal: number }> = [];
  private mnemonic = "";
  private opStrs: string[] = [];
  private instrAddr = 0;
  private instrWords: number[] = [];
  private instrDesc = "";

  /** プログラムをロードしてCPUをリセット */
  load(program: PDP11Program): void {
    this.mem = new Uint8Array(65536);
    this.r = new Array<number>(8).fill(0);
    // プログラムメモリをコピー
    for (let i = 0; i < 65536; i++) {
      if (program.memory[i] !== 0) {
        this.mem[i] = program.memory[i];
      }
    }
    this.r[7] = program.startPC;  // PC
    this.r[6] = program.startSP;  // SP
    this.psw = 0;
    this.halted = false;
    this.stepCount = 0;
    this.consoleOutput = "";

    // コンソール送信レディビットをセット
    this.mem[CONSOLE_XCSR] = 0x80;     // bit7 = ready
    this.mem[CONSOLE_XCSR + 1] = 0;
  }

  /** 1命令を実行し結果を返す */
  step(): PDP11StepResult {
    this.events = [];
    this.memChanges = [];
    this.mnemonic = "";
    this.opStrs = [];
    this.instrAddr = this.r[7];
    this.instrWords = [];
    this.instrDesc = "";

    if (this.halted) {
      this.mnemonic = "(halted)";
      this.instrDesc = "CPU停止中";
      return this.buildResult("CPU停止中");
    }

    this.stepCount++;
    const word = this.fetch();
    this.instrWords.push(word);

    const msg = this.execute(word);
    return this.buildResult(msg);
  }

  /** 結果オブジェクトを構築 */
  private buildResult(msg: string): PDP11StepResult {
    return {
      step: this.stepCount,
      instruction: {
        addr: this.instrAddr,
        words: [...this.instrWords],
        mnemonic: this.mnemonic,
        operands: this.opStrs.join(", "),
        description: this.instrDesc,
      },
      registers: [...this.r],
      psw: this.psw,
      flags: {
        n: !!(this.psw & 8),
        z: !!(this.psw & 4),
        v: !!(this.psw & 2),
        c: !!(this.psw & 1),
        priority: (this.psw >> 5) & 7,
        mode: (this.psw >> 14) === 0 ? "kernel" : "user",
      },
      halted: this.halted,
      memoryChanges: [...this.memChanges],
      consoleOutput: this.consoleOutput,
      events: [...this.events],
      message: msg,
    };
  }

  // ─── メモリアクセス ───

  private readByte(addr: number): number {
    addr &= 0xFFFF;
    const val = this.mem[addr];
    return val;
  }

  private writeByte(addr: number, val: number): void {
    addr &= 0xFFFF;
    val &= 0xFF;

    // コンソールMMIO
    if (addr === (CONSOLE_XBUF & 0xFFFF)) {
      const ch = val & 0x7F;
      this.consoleOutput += String.fromCharCode(ch);
      this.emit("console_out", `コンソール出力: '${ch >= 0x20 ? String.fromCharCode(ch) : "\\x" + ch.toString(16)}' (0${octShort(ch)})`, addr, val);
      return;
    }

    const old = this.mem[addr];
    this.mem[addr] = val;
    if (old !== val) {
      this.memChanges.push({ addr, oldVal: old, newVal: val });
    }
  }

  readWord(addr: number): number {
    addr &= 0xFFFE;  // ワードアライメント

    // コンソールMMIO読み取り
    if (addr === CONSOLE_XCSR) return 0x80;  // 常にready
    if (addr === CONSOLE_RCSR) return 0;     // 受信データなし

    return this.mem[addr] | (this.mem[addr + 1] << 8);
  }

  writeWord(addr: number, val: number): void {
    addr &= 0xFFFE;
    val &= 0xFFFF;

    // コンソールMMIO書き込み
    if (addr === CONSOLE_XBUF) {
      const ch = val & 0x7F;
      this.consoleOutput += String.fromCharCode(ch);
      this.emit("console_out", `コンソール出力: '${ch >= 0x20 ? String.fromCharCode(ch) : "\\x" + ch.toString(16)}' (0${octShort(ch)})`, addr, val);
      return;
    }

    const oldLo = this.mem[addr];
    const oldHi = this.mem[addr + 1];
    const newLo = val & 0xFF;
    const newHi = (val >> 8) & 0xFF;
    this.mem[addr] = newLo;
    this.mem[addr + 1] = newHi;
    if (oldLo !== newLo || oldHi !== newHi) {
      this.memChanges.push({ addr, oldVal: oldLo | (oldHi << 8), newVal: val });
    }
  }

  /** 命令フェッチ: PCからワードを読んでPC+=2 */
  private fetch(): number {
    const addr = this.r[7] & 0xFFFE;
    const val = this.mem[addr] | (this.mem[addr + 1] << 8);
    this.r[7] = (this.r[7] + 2) & 0xFFFF;
    this.emit("fetch", `フェッチ: [${oct(addr)}] = ${oct(val)}`, addr, val);
    return val;
  }

  /** 命令実行後の追加ワードフェッチ (アドレッシングモード解決用) */
  private fetchExtra(): number {
    const val = this.fetch();
    this.instrWords.push(val);
    return val;
  }

  // ─── スタック操作 ───

  private push(val: number): void {
    this.r[6] = (this.r[6] - 2) & 0xFFFF;
    this.writeWord(this.r[6], val);
    this.emit("stack_push", `PUSH ${oct(val)} → SP=${oct(this.r[6])}`, this.r[6], val);
  }

  private pop(): number {
    const val = this.readWord(this.r[6]);
    this.r[6] = (this.r[6] + 2) & 0xFFFF;
    this.emit("stack_pop", `POP ${oct(val)} ← SP=${oct(this.r[6] - 2)}`, this.r[6] - 2, val);
    return val;
  }

  // ─── オペランド解決 ───

  /**
   * 6ビットオペランドフィールドを解決し、OpRefを返す。
   * アドレッシングモードの副作用（オートインクリメント/デクリメント）を実行する。
   * 逆アセンブリ文字列もopStrsに追加する。
   */
  private resolve(modeReg: number, isByte: boolean): OpRef {
    const mode = (modeReg >> 3) & 7;
    const reg = modeReg & 7;
    const rn = REG_NAMES[reg];
    // ワード操作またはSP/PCはバイトモードでも2ずつ増減
    const step = (isByte && reg < 6) ? 1 : 2;

    switch (mode) {
      case 0: // レジスタ直接: Rn
        this.opStrs.push(rn);
        return { type: "reg", reg };

      case 1: // レジスタ間接: (Rn)
        this.opStrs.push(`(${rn})`);
        return { type: "mem", addr: this.r[reg] & 0xFFFF };

      case 2: { // オートインクリメント: (Rn)+, PC時は即値 #n
        const addr = this.r[reg] & 0xFFFF;
        this.r[reg] = (this.r[reg] + step) & 0xFFFF;
        if (reg === 7) {
          // 即値モード: #n
          const val = this.mem[addr] | (this.mem[addr + 1] << 8);
          this.instrWords.push(val);
          this.opStrs.push(`#${octShort(val)}`);
          return { type: "mem", addr };
        }
        this.opStrs.push(`(${rn})+`);
        return { type: "mem", addr };
      }

      case 3: { // オートインクリメント間接: @(Rn)+, PC時は絶対 @#n
        const addr = this.r[reg] & 0xFFFF;
        this.r[reg] = (this.r[reg] + 2) & 0xFFFF; // 常に2
        const target = this.readWord(addr);
        if (reg === 7) {
          this.instrWords.push(target);
          this.opStrs.push(`@#${oct(target)}`);
        } else {
          this.opStrs.push(`@(${rn})+`);
        }
        return { type: "mem", addr: target };
      }

      case 4: { // オートデクリメント: -(Rn)
        this.r[reg] = (this.r[reg] - step) & 0xFFFF;
        this.opStrs.push(`-(${rn})`);
        return { type: "mem", addr: this.r[reg] & 0xFFFF };
      }

      case 5: { // オートデクリメント間接: @-(Rn)
        this.r[reg] = (this.r[reg] - 2) & 0xFFFF;
        const target = this.readWord(this.r[reg]);
        this.opStrs.push(`@-(${rn})`);
        return { type: "mem", addr: target };
      }

      case 6: { // インデックス: X(Rn), PC時はPC相対
        const offset = this.fetchExtra();
        const addr = (this.r[reg] + offset) & 0xFFFF;
        if (reg === 7) {
          this.opStrs.push(`${oct(addr)}`);
        } else {
          this.opStrs.push(`${octShort(offset)}(${rn})`);
        }
        return { type: "mem", addr };
      }

      case 7: { // インデックス間接: @X(Rn), PC時は@PC相対
        const offset = this.fetchExtra();
        const intermediate = (this.r[reg] + offset) & 0xFFFF;
        const addr = this.readWord(intermediate);
        if (reg === 7) {
          this.opStrs.push(`@${oct(intermediate)}`);
        } else {
          this.opStrs.push(`@${octShort(offset)}(${rn})`);
        }
        return { type: "mem", addr };
      }

      default:
        throw new Error(`不正なアドレッシングモード: ${mode}`);
    }
  }

  /** 解決済みオペランドの値を読む */
  private getVal(ref: OpRef, isByte: boolean): number {
    if (ref.type === "reg") {
      return isByte ? (this.r[ref.reg] & 0xFF) : (this.r[ref.reg] & 0xFFFF);
    }
    return isByte ? this.readByte(ref.addr) : this.readWord(ref.addr);
  }

  /** 解決済みオペランドに値を書く */
  private setVal(ref: OpRef, val: number, isByte: boolean): void {
    if (ref.type === "reg") {
      if (isByte) {
        // バイト書き込みはレジスタの下位バイトのみ変更
        this.r[ref.reg] = (this.r[ref.reg] & 0xFF00) | (val & 0xFF);
      } else {
        this.r[ref.reg] = val & 0xFFFF;
      }
      return;
    }
    if (isByte) {
      this.writeByte(ref.addr, val & 0xFF);
    } else {
      this.writeWord(ref.addr, val & 0xFFFF);
    }
  }

  // ─── 条件コード設定 ───

  private setN(v: boolean): void { this.psw = v ? (this.psw | 8) : (this.psw & ~8); }
  private setZ(v: boolean): void { this.psw = v ? (this.psw | 4) : (this.psw & ~4); }
  private setV(v: boolean): void { this.psw = v ? (this.psw | 2) : (this.psw & ~2); }
  private setC(v: boolean): void { this.psw = v ? (this.psw | 1) : (this.psw & ~1); }
  private getN(): boolean { return !!(this.psw & 8); }
  private getZ(): boolean { return !!(this.psw & 4); }
  private getV(): boolean { return !!(this.psw & 2); }
  private getC(): boolean { return !!(this.psw & 1); }

  /** N,Zフラグを値からセット */
  private setNZ(val: number, isByte: boolean): void {
    const msb = isByte ? 0x80 : 0x8000;
    const mask = isByte ? 0xFF : 0xFFFF;
    this.setN(!!(val & msb));
    this.setZ((val & mask) === 0);
  }

  /** N,Z,V,Cフラグをセット */
  private setNZVC(val: number, isByte: boolean, v: boolean, c: boolean): void {
    this.setNZ(val, isByte);
    this.setV(v);
    this.setC(c);
  }

  // ─── トラップ ───

  /**
   * トラップ実行: PSWとPCをスタックに退避し、ベクタからロード
   *
   * PDP-11のトラップ機構:
   * 1. 現在のPSWとPCをカーネルスタックにプッシュ
   * 2. ベクタアドレスから新PC、ベクタ+2から新PSWをロード
   * 3. 新PSWのモードビットでカーネルモードに切替
   */
  private doTrap(vector: number, reason: string): void {
    this.emit("trap", `トラップ: ${reason} → ベクタ ${oct(vector, 3)}`, vector);

    // PSWの前モードを現在モードに設定
    const curMode = (this.psw >> 14) & 3;
    this.psw = (this.psw & ~0x3000) | (curMode << 12);

    // PSWとPCをスタックに退避
    this.push(this.psw);
    this.push(this.r[7]);

    // ベクタからPC,PSWをロード
    const newPC = this.readWord(vector);
    const newPSW = this.readWord(vector + 2);
    this.r[7] = newPC;
    this.psw = newPSW;

    this.emit("mode_switch", `モード切替: ${curMode === 0 ? "kernel" : "user"} → ${(newPSW >> 14) === 0 ? "kernel" : "user"}`, vector);
  }

  // ─── イベント ───

  private emit(type: PDP11EventType, msg: string, addr?: number, val?: number): void {
    this.events.push({ type, message: msg, addr, value: val });
  }

  // ─── 命令実行 ───

  private execute(word: number): string {
    // 特殊命令 (完全一致)
    if (word === 0o000000) return this.execHalt();
    if (word === 0o000001) return this.execWait();
    if (word === 0o000002) return this.execRTI();
    if (word === 0o000003) return this.execBPT();
    if (word === 0o000004) return this.execIOT();
    if (word === 0o000005) return this.execReset();
    if (word === 0o000006) return this.execRTT();

    // 条件コード操作 (000240-000277)
    if (word >= 0o000240 && word <= 0o000277) return this.execCC(word);

    // NOP (000240)
    // 既にCC操作で処理される

    // RTS (00020R)
    if ((word & 0o177770) === 0o000200) return this.execRTS(word & 7);

    // ダブルオペランド命令
    const top4 = (word >> 12) & 0xF;
    const src6 = (word >> 6) & 0o77;
    const dst6 = word & 0o77;

    switch (top4) {
      case 0o01: return this.execMOV(src6, dst6, false);
      case 0o02: return this.execCMP(src6, dst6, false);
      case 0o03: return this.execBIT(src6, dst6, false);
      case 0o04: return this.execBIC(src6, dst6, false);
      case 0o05: return this.execBIS(src6, dst6, false);
      case 0o06: return this.execADD(src6, dst6);
      case 0o11: return this.execMOV(src6, dst6, true);
      case 0o12: return this.execCMP(src6, dst6, true);
      case 0o13: return this.execBIT(src6, dst6, true);
      case 0o14: return this.execBIC(src6, dst6, true);
      case 0o15: return this.execBIS(src6, dst6, true);
      case 0o16: return this.execSUB(src6, dst6);
    }

    // EIS / SOB (top4 = 0o07)
    if (top4 === 0o07) {
      const subOp = (word >> 9) & 7;
      const reg = (word >> 6) & 7;
      if (subOp === 0) return this.execMUL(reg, dst6);
      if (subOp === 1) return this.execDIV(reg, dst6);
      if (subOp === 2) return this.execASH(reg, dst6);
      if (subOp === 4) return this.execXOR(reg, dst6);
      if (subOp === 7) return this.execSOB(reg, word & 0o77);
    }

    // シングルオペランド・ブランチ・JSR (top4 = 0 or 0o10)
    if (top4 === 0) {
      // ブランチ (bits 15-8)
      const top8 = (word >> 8) & 0xFF;
      if (top8 >= 1 && top8 <= 7) {
        const offset = this.signExtend8(word & 0xFF);
        return this.execBranch(top8, offset);
      }

      // JMP (0001DD)
      const top10 = (word >> 6) & 0o1777;
      if (top10 === 0o01) return this.execJMP(dst6);

      // SWAB (0003DD)
      if (top10 === 0o03) return this.execSWAB(dst6);

      // JSR (004RDD)
      if (((word >> 9) & 0o177) === 0o04) {
        const reg = (word >> 6) & 7;
        return this.execJSR(reg, dst6);
      }

      // シングルオペランドワード命令
      if (top10 >= 0o50 && top10 <= 0o63) {
        return this.execSingleOp(top10 - 0o50, dst6, false);
      }
      // SXT (0067DD)
      if (top10 === 0o67) return this.execSXT(dst6);
    }

    if (top4 === 0o10) {
      // バイトブランチ
      const top8 = (word >> 8) & 0xFF;
      if (top8 >= 0x80 && top8 <= 0x87) {
        const offset = this.signExtend8(word & 0xFF);
        return this.execBranchByte(top8 - 0x80, offset);
      }

      // EMT (104000-104377)
      if ((word & 0o177400) === 0o104000) return this.execEMT(word & 0xFF);
      // TRAP (104400-104777)
      if ((word & 0o177400) === 0o104400) return this.execTRAP(word & 0xFF);

      // バイトシングルオペランド
      const top10 = (word >> 6) & 0o1777;
      if (top10 >= 0o1050 && top10 <= 0o1063) {
        return this.execSingleOp(top10 - 0o1050, dst6, true);
      }
    }

    // 未実装命令
    this.mnemonic = "???";
    this.instrDesc = `不正命令 (${oct(word)})`;
    this.emit("error", `不正命令: ${oct(word)}`);
    this.doTrap(VEC_ILLEGAL, `不正命令 ${oct(word)}`);
    return `不正命令: ${oct(word)}`;
  }

  // ─── ダブルオペランド命令 ───

  private execMOV(src6: number, dst6: number, isByte: boolean): string {
    this.mnemonic = isByte ? "MOVB" : "MOV";
    const srcRef = this.resolve(src6, isByte);
    const dstRef = this.resolve(dst6, isByte);
    let val = this.getVal(srcRef, isByte);
    if (isByte && dstRef.type === "reg") {
      // MOVBのレジスタ宛先は符号拡張
      val = this.signExtend8(val);
    }
    this.setVal(dstRef, val, isByte ? (dstRef.type === "reg" ? false : true) : false);
    this.setNZ(val, isByte);
    this.setV(false);
    this.instrDesc = isByte ? "バイト転送 (符号拡張)" : "ワード転送";
    return `${this.mnemonic} ${this.opStrs.join(", ")}`;
  }

  private execCMP(src6: number, dst6: number, isByte: boolean): string {
    this.mnemonic = isByte ? "CMPB" : "CMP";
    const srcRef = this.resolve(src6, isByte);
    const dstRef = this.resolve(dst6, isByte);
    const s = this.getVal(srcRef, isByte);
    const d = this.getVal(dstRef, isByte);
    const mask = isByte ? 0xFF : 0xFFFF;
    const msb = isByte ? 0x80 : 0x8000;
    const result = (s - d) & mask;
    this.setNZ(result, isByte);
    this.setV(!!((s ^ d) & (s ^ result) & msb));
    this.setC(s < d);  // unsigned比較でborrow発生
    this.instrDesc = "比較 (src - dst、結果は捨てる)";
    return `${this.mnemonic} ${this.opStrs.join(", ")}`;
  }

  private execBIT(src6: number, dst6: number, isByte: boolean): string {
    this.mnemonic = isByte ? "BITB" : "BIT";
    const srcRef = this.resolve(src6, isByte);
    const dstRef = this.resolve(dst6, isByte);
    const result = this.getVal(srcRef, isByte) & this.getVal(dstRef, isByte);
    this.setNZ(result, isByte);
    this.setV(false);
    this.instrDesc = "ビットテスト (src AND dst)";
    return `${this.mnemonic} ${this.opStrs.join(", ")}`;
  }

  private execBIC(src6: number, dst6: number, isByte: boolean): string {
    this.mnemonic = isByte ? "BICB" : "BIC";
    const srcRef = this.resolve(src6, isByte);
    const dstRef = this.resolve(dst6, isByte);
    const s = this.getVal(srcRef, isByte);
    const d = this.getVal(dstRef, isByte);
    const result = d & ~s;
    this.setVal(dstRef, result, isByte);
    this.setNZ(result, isByte);
    this.setV(false);
    this.instrDesc = "ビットクリア (dst AND NOT src)";
    return `${this.mnemonic} ${this.opStrs.join(", ")}`;
  }

  private execBIS(src6: number, dst6: number, isByte: boolean): string {
    this.mnemonic = isByte ? "BISB" : "BIS";
    const srcRef = this.resolve(src6, isByte);
    const dstRef = this.resolve(dst6, isByte);
    const s = this.getVal(srcRef, isByte);
    const d = this.getVal(dstRef, isByte);
    const result = d | s;
    this.setVal(dstRef, result, isByte);
    this.setNZ(result, isByte);
    this.setV(false);
    this.instrDesc = "ビットセット (dst OR src)";
    return `${this.mnemonic} ${this.opStrs.join(", ")}`;
  }

  private execADD(src6: number, dst6: number): string {
    this.mnemonic = "ADD";
    const srcRef = this.resolve(src6, false);
    const dstRef = this.resolve(dst6, false);
    const s = this.getVal(srcRef, false);
    const d = this.getVal(dstRef, false);
    const result = (s + d) & 0xFFFF;
    const carry = s + d > 0xFFFF;
    // V: 同符号の加算で結果の符号が変わった
    const overflow = !!((~(s ^ d)) & (s ^ result) & 0x8000);
    this.setVal(dstRef, result, false);
    this.setNZVC(result, false, overflow, carry);
    this.instrDesc = "加算 (dst += src)";
    return `ADD ${this.opStrs.join(", ")}`;
  }

  private execSUB(src6: number, dst6: number): string {
    this.mnemonic = "SUB";
    const srcRef = this.resolve(src6, false);
    const dstRef = this.resolve(dst6, false);
    const s = this.getVal(srcRef, false);
    const d = this.getVal(dstRef, false);
    const result = (d - s) & 0xFFFF;
    const borrow = d < s;
    // V: 異符号の減算で結果の符号がdstと異なる
    const overflow = !!((s ^ d) & (d ^ result) & 0x8000);
    this.setVal(dstRef, result, false);
    this.setNZVC(result, false, overflow, borrow);
    this.instrDesc = "減算 (dst -= src)";
    return `SUB ${this.opStrs.join(", ")}`;
  }

  // ─── シングルオペランド命令 ───

  private execSingleOp(opIdx: number, dst6: number, isByte: boolean): string {
    const names = ["CLR", "COM", "INC", "DEC", "NEG", "ADC", "SBC", "TST", "ROR", "ROL", "ASR", "ASL"];
    const name = isByte ? names[opIdx] + "B" : names[opIdx];
    this.mnemonic = name;
    const ref = this.resolve(dst6, isByte);
    const val = this.getVal(ref, isByte);
    const mask = isByte ? 0xFF : 0xFFFF;
    const msb = isByte ? 0x80 : 0x8000;

    switch (opIdx) {
      case 0: { // CLR
        this.setVal(ref, 0, isByte);
        this.setNZVC(0, isByte, false, false);
        this.instrDesc = "クリア (dst = 0)";
        break;
      }
      case 1: { // COM (1の補数)
        const r = (~val) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setV(false);
        this.setC(true);
        this.instrDesc = "1の補数 (ビット反転)";
        break;
      }
      case 2: { // INC
        const r = (val + 1) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setV(val === (msb - 1));  // 0x7F→0x80 or 0x7FFF→0x8000
        this.instrDesc = "インクリメント (dst++)";
        break;
      }
      case 3: { // DEC
        const r = (val - 1) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setV(val === msb);  // 0x80→0x7F or 0x8000→0x7FFF
        this.instrDesc = "デクリメント (dst--)";
        break;
      }
      case 4: { // NEG (2の補数)
        const r = (-val) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setV(r === msb);
        this.setC(r !== 0);
        this.instrDesc = "2の補数 (符号反転)";
        break;
      }
      case 5: { // ADC (キャリー加算)
        const c = this.getC() ? 1 : 0;
        const r = (val + c) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setV(val === (msb - 1) && c === 1);
        this.setC(val === mask && c === 1);
        this.instrDesc = "キャリー加算 (dst += C)";
        break;
      }
      case 6: { // SBC (キャリー減算)
        const c = this.getC() ? 1 : 0;
        const r = (val - c) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setV(val === msb && c === 1);
        this.setC(val === 0 && c === 1);
        this.instrDesc = "キャリー減算 (dst -= C)";
        break;
      }
      case 7: { // TST
        this.setNZVC(val, isByte, false, false);
        this.instrDesc = "テスト (フラグのみ設定)";
        break;
      }
      case 8: { // ROR (右回転)
        const cIn = this.getC() ? msb : 0;
        const cOut = !!(val & 1);
        const r = ((val >> 1) | cIn) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setC(cOut);
        this.setV(this.getN() !== this.getC());
        this.instrDesc = "右ローテート (C→MSB, LSB→C)";
        break;
      }
      case 9: { // ROL (左回転)
        const cIn = this.getC() ? 1 : 0;
        const cOut = !!(val & msb);
        const r = ((val << 1) | cIn) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setC(cOut);
        this.setV(this.getN() !== this.getC());
        this.instrDesc = "左ローテート (C→LSB, MSB→C)";
        break;
      }
      case 10: { // ASR (算術右シフト)
        const cOut = !!(val & 1);
        const r = ((val >> 1) | (val & msb)) & mask;  // MSB保持
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setC(cOut);
        this.setV(this.getN() !== this.getC());
        this.instrDesc = "算術右シフト (符号ビット保持)";
        break;
      }
      case 11: { // ASL (算術左シフト)
        const cOut = !!(val & msb);
        const r = (val << 1) & mask;
        this.setVal(ref, r, isByte);
        this.setNZ(r, isByte);
        this.setC(cOut);
        this.setV(this.getN() !== this.getC());
        this.instrDesc = "算術左シフト (LSBに0)";
        break;
      }
    }

    return `${name} ${this.opStrs.join(", ")}`;
  }

  private execSWAB(dst6: number): string {
    this.mnemonic = "SWAB";
    const ref = this.resolve(dst6, false);
    const val = this.getVal(ref, false);
    const result = ((val & 0xFF) << 8) | ((val >> 8) & 0xFF);
    this.setVal(ref, result, false);
    this.setNZ(result & 0xFF, true);  // 下位バイトでN,Z判定
    this.setV(false);
    this.setC(false);
    this.instrDesc = "上位・下位バイト入れ替え";
    return `SWAB ${this.opStrs.join(", ")}`;
  }

  private execSXT(dst6: number): string {
    this.mnemonic = "SXT";
    const ref = this.resolve(dst6, false);
    const val = this.getN() ? 0xFFFF : 0;
    this.setVal(ref, val, false);
    this.setZ(!this.getN());
    this.instrDesc = "Nフラグを符号拡張 (N=1→-1, N=0→0)";
    return `SXT ${this.opStrs.join(", ")}`;
  }

  // ─── ブランチ命令 ───

  private signExtend8(val: number): number {
    return (val & 0x80) ? (val | 0xFFFFFF00) : (val & 0xFF);
  }

  private execBranch(top8: number, offset: number): string {
    const names = ["", "BR", "BNE", "BEQ", "BGE", "BLT", "BGT", "BLE"];
    this.mnemonic = names[top8];
    const target = (this.r[7] + offset * 2) & 0xFFFF;
    this.opStrs.push(oct(target));

    let taken = false;
    const n = this.getN(), z = this.getZ(), v = this.getV();
    switch (top8) {
      case 1: taken = true; this.instrDesc = "無条件分岐"; break;
      case 2: taken = !z; this.instrDesc = "Z=0なら分岐 (非ゼロ)"; break;
      case 3: taken = z; this.instrDesc = "Z=1なら分岐 (ゼロ)"; break;
      case 4: taken = (n === v); this.instrDesc = "N⊕V=0なら分岐 (符号付き≥)"; break;
      case 5: taken = (n !== v); this.instrDesc = "N⊕V=1なら分岐 (符号付き<)"; break;
      case 6: taken = !z && (n === v); this.instrDesc = "Z=0∧N⊕V=0なら分岐 (符号付き>)"; break;
      case 7: taken = z || (n !== v); this.instrDesc = "Z=1∨N⊕V=1なら分岐 (符号付き≤)"; break;
    }

    if (taken) {
      this.r[7] = target;
      this.emit("branch", `分岐: ${this.mnemonic} → ${oct(target)} (成立)`, target);
    } else {
      this.emit("branch", `分岐: ${this.mnemonic} → ${oct(target)} (不成立)`, target);
    }
    return `${this.mnemonic} ${oct(target)} (${taken ? "成立" : "不成立"})`;
  }

  private execBranchByte(idx: number, offset: number): string {
    const names = ["BPL", "BMI", "BHI", "BLOS", "BVC", "BVS", "BCC", "BCS"];
    this.mnemonic = names[idx];
    const target = (this.r[7] + offset * 2) & 0xFFFF;
    this.opStrs.push(oct(target));

    let taken = false;
    const n = this.getN(), z = this.getZ(), v = this.getV(), c = this.getC();
    switch (idx) {
      case 0: taken = !n; this.instrDesc = "N=0なら分岐 (正)"; break;
      case 1: taken = n; this.instrDesc = "N=1なら分岐 (負)"; break;
      case 2: taken = !c && !z; this.instrDesc = "C=0∧Z=0なら分岐 (符号なし>)"; break;
      case 3: taken = c || z; this.instrDesc = "C=1∨Z=1なら分岐 (符号なし≤)"; break;
      case 4: taken = !v; this.instrDesc = "V=0なら分岐 (オーバーフローなし)"; break;
      case 5: taken = v; this.instrDesc = "V=1なら分岐 (オーバーフロー)"; break;
      case 6: taken = !c; this.instrDesc = "C=0なら分岐 (キャリーなし)"; break;
      case 7: taken = c; this.instrDesc = "C=1なら分岐 (キャリーあり)"; break;
    }

    if (taken) {
      this.r[7] = target;
      this.emit("branch", `分岐: ${this.mnemonic} → ${oct(target)} (成立)`, target);
    } else {
      this.emit("branch", `分岐: ${this.mnemonic} → ${oct(target)} (不成立)`, target);
    }
    return `${this.mnemonic} ${oct(target)} (${taken ? "成立" : "不成立"})`;
  }

  // ─── ジャンプ/サブルーチン ───

  private execJMP(dst6: number): string {
    this.mnemonic = "JMP";
    const ref = this.resolve(dst6, false);
    if (ref.type === "reg") {
      this.emit("error", "JMPのレジスタ直接モードは不正");
      this.doTrap(VEC_ILLEGAL, "JMP Rn は不正");
      this.instrDesc = "不正なJMP (レジスタ直接)";
      return "JMP (不正)";
    }
    this.r[7] = ref.addr;
    this.instrDesc = "無条件ジャンプ";
    return `JMP ${this.opStrs.join(", ")}`;
  }

  private execJSR(reg: number, dst6: number): string {
    this.mnemonic = "JSR";
    const rn = REG_NAMES[reg];
    const ref = this.resolve(dst6, false);
    if (ref.type === "reg") {
      this.emit("error", "JSRのレジスタ直接モードは不正");
      this.instrDesc = "不正なJSR";
      return "JSR (不正)";
    }
    this.opStrs.unshift(rn);

    // JSR reg, dst:
    // -(SP) ← reg  (レジスタをスタックに退避)
    // reg ← PC     (戻りアドレスをレジスタに保存)
    // PC ← dst     (サブルーチンへジャンプ)
    this.push(this.r[reg]);
    this.r[reg] = this.r[7];
    this.r[7] = ref.addr;

    this.instrDesc = `サブルーチン呼び出し (${rn}経由)`;
    return `JSR ${this.opStrs.join(", ")}`;
  }

  private execRTS(reg: number): string {
    this.mnemonic = "RTS";
    const rn = REG_NAMES[reg];
    this.opStrs.push(rn);

    // RTS reg:
    // PC ← reg     (レジスタから戻りアドレスを復元)
    // reg ← (SP)+  (スタックからレジスタを復元)
    this.r[7] = this.r[reg];
    this.r[reg] = this.pop();

    this.instrDesc = `サブルーチンからの復帰 (${rn}経由)`;
    return `RTS ${rn}`;
  }

  // ─── EIS命令 ───

  private execMUL(reg: number, dst6: number): string {
    this.mnemonic = "MUL";
    this.opStrs.push(REG_NAMES[reg]);
    const ref = this.resolve(dst6, false);
    const src = this.getVal(ref, false);
    // 符号付き乗算
    const a = (this.r[reg] & 0x8000) ? this.r[reg] - 0x10000 : this.r[reg];
    const b = (src & 0x8000) ? src - 0x10000 : src;
    const result = a * b;
    // 結果は32ビット: 上位→R, 下位→R|1
    this.r[reg] = (result >> 16) & 0xFFFF;
    this.r[reg | 1] = result & 0xFFFF;
    this.setN(result < 0);
    this.setZ(result === 0);
    this.setV(false);
    this.setC(result < -32768 || result > 32767);
    this.instrDesc = "乗算 (R:R|1 = R × src)";
    return `MUL ${this.opStrs.join(", ")}`;
  }

  private execDIV(reg: number, dst6: number): string {
    this.mnemonic = "DIV";
    this.opStrs.push(REG_NAMES[reg]);
    const ref = this.resolve(dst6, false);
    const divisor = this.getVal(ref, false);
    if (divisor === 0) {
      this.setV(true);
      this.setC(true);
      this.instrDesc = "除算 (ゼロ除算エラー)";
      return `DIV ${this.opStrs.join(", ")} (ゼロ除算)`;
    }
    const dividend = (this.r[reg] << 16) | (this.r[reg | 1] & 0xFFFF);
    const signedDivisor = (divisor & 0x8000) ? divisor - 0x10000 : divisor;
    const quotient = Math.trunc(dividend / signedDivisor);
    const remainder = dividend % signedDivisor;
    this.r[reg] = quotient & 0xFFFF;
    this.r[reg | 1] = remainder & 0xFFFF;
    this.setN(quotient < 0);
    this.setZ(quotient === 0);
    this.setV(quotient > 32767 || quotient < -32768);
    this.setC(false);
    this.instrDesc = "除算 (R = 商, R|1 = 余り)";
    return `DIV ${this.opStrs.join(", ")}`;
  }

  private execASH(reg: number, dst6: number): string {
    this.mnemonic = "ASH";
    this.opStrs.push(REG_NAMES[reg]);
    const ref = this.resolve(dst6, false);
    let shift = this.getVal(ref, false) & 0x3F;
    if (shift & 0x20) shift = shift - 64; // 符号付き6ビット
    let val = this.r[reg];
    let c = false;
    if (shift > 0) {
      // 左シフト
      c = !!((val << (shift - 1)) & 0x8000);
      val = (val << shift) & 0xFFFF;
    } else if (shift < 0) {
      // 算術右シフト
      const signed = (val & 0x8000) ? val - 0x10000 : val;
      c = !!((signed >> (-shift - 1)) & 1);
      val = (signed >> (-shift)) & 0xFFFF;
    }
    this.r[reg] = val;
    this.setNZ(val, false);
    this.setV(this.getN() !== this.getC());
    this.setC(c);
    this.instrDesc = shift >= 0 ? `算術左シフト ${shift}ビット` : `算術右シフト ${-shift}ビット`;
    return `ASH ${this.opStrs.join(", ")}`;
  }

  private execXOR(reg: number, dst6: number): string {
    this.mnemonic = "XOR";
    this.opStrs.push(REG_NAMES[reg]);
    const ref = this.resolve(dst6, false);
    const d = this.getVal(ref, false);
    const result = (this.r[reg] ^ d) & 0xFFFF;
    this.setVal(ref, result, false);
    this.setNZ(result, false);
    this.setV(false);
    this.instrDesc = "排他的論理和 (dst ^= R)";
    return `XOR ${this.opStrs.join(", ")}`;
  }

  private execSOB(reg: number, offset: number): string {
    this.mnemonic = "SOB";
    this.opStrs.push(REG_NAMES[reg]);
    const target = (this.r[7] - offset * 2) & 0xFFFF;
    this.opStrs.push(oct(target));

    this.r[reg] = (this.r[reg] - 1) & 0xFFFF;
    if (this.r[reg] !== 0) {
      this.r[7] = target;
      this.emit("branch", `SOB: ${REG_NAMES[reg]}=${octShort(this.r[reg])} → 分岐 ${oct(target)}`, target);
    } else {
      this.emit("branch", `SOB: ${REG_NAMES[reg]}=0 → 分岐なし`);
    }
    this.instrDesc = "1減算して非ゼロなら分岐 (ループカウンタ)";
    return `SOB ${this.opStrs.join(", ")}`;
  }

  // ─── 特殊命令 ───

  private execHalt(): string {
    this.mnemonic = "HALT";
    this.halted = true;
    this.instrDesc = "CPU停止";
    this.emit("halt", "HALT: CPU停止");
    return "HALT";
  }

  private execWait(): string {
    this.mnemonic = "WAIT";
    this.instrDesc = "割り込み待ち";
    // シミュレーションではHALT扱い
    this.halted = true;
    this.emit("halt", "WAIT: 割り込み待ち (シミュレーションでは停止)");
    return "WAIT";
  }

  private execRTI(): string {
    this.mnemonic = "RTI";
    // スタックからPC,PSWを復元
    this.r[7] = this.pop();
    this.psw = this.pop();
    this.instrDesc = "トラップからの復帰 (PC,PSW復元)";
    this.emit("mode_switch", `RTI: PC=${oct(this.r[7])}, PSW=${oct(this.psw)}`);
    return "RTI";
  }

  private execRTT(): string {
    this.mnemonic = "RTT";
    this.r[7] = this.pop();
    this.psw = this.pop();
    this.instrDesc = "トラップからの復帰 (Tビット抑制)";
    return "RTT";
  }

  private execBPT(): string {
    this.mnemonic = "BPT";
    this.instrDesc = "ブレークポイントトラップ (ベクタ014)";
    this.doTrap(VEC_BPT, "BPT");
    return "BPT";
  }

  private execIOT(): string {
    this.mnemonic = "IOT";
    this.instrDesc = "I/Oトラップ (ベクタ020)";
    this.doTrap(VEC_IOT, "IOT");
    return "IOT";
  }

  private execReset(): string {
    this.mnemonic = "RESET";
    this.instrDesc = "バスリセット (UNIBUSデバイス初期化)";
    this.emit("info", "RESET: UNIBUSリセット信号発行");
    return "RESET";
  }

  private execEMT(n: number): string {
    this.mnemonic = "EMT";
    this.opStrs.push(octShort(n));
    this.instrDesc = `エミュレータトラップ (ベクタ030, n=${n})`;
    this.doTrap(VEC_EMT, `EMT ${n}`);
    return `EMT ${octShort(n)}`;
  }

  private execTRAP(n: number): string {
    this.mnemonic = "TRAP";
    this.opStrs.push(octShort(n));
    this.instrDesc = `TRAPシステムコール (ベクタ034, n=${n}) — V6のsyscall機構`;
    this.doTrap(VEC_TRAP, `TRAP ${n} (V6 syscall)`);
    return `TRAP ${octShort(n)}`;
  }

  private execCC(word: number): string {
    // 条件コード操作: bits 4-0 = NZVC操作, bit 4 = set/clear方向
    const set = !!(word & 0o20);
    const bits = word & 0o17;
    if (bits === 0 && !set) {
      this.mnemonic = "NOP";
      this.instrDesc = "何もしない";
      return "NOP";
    }

    const parts: string[] = [];
    if (bits & 8) parts.push("N");
    if (bits & 4) parts.push("Z");
    if (bits & 2) parts.push("V");
    if (bits & 1) parts.push("C");

    if (set) {
      this.mnemonic = "S" + parts.join("");
      if (bits & 8) this.setN(true);
      if (bits & 4) this.setZ(true);
      if (bits & 2) this.setV(true);
      if (bits & 1) this.setC(true);
      this.instrDesc = `条件コードセット: ${parts.join(",")}=1`;
    } else {
      this.mnemonic = "CL" + parts.join("");
      if (bits & 8) this.setN(false);
      if (bits & 4) this.setZ(false);
      if (bits & 2) this.setV(false);
      if (bits & 1) this.setC(false);
      this.instrDesc = `条件コードクリア: ${parts.join(",")}=0`;
    }
    return this.mnemonic;
  }
}

// ─── 公開API ───

/**
 * プリセットを実行し、全ステップの結果を返す
 */
export function runPDP11(preset: PDP11Preset): PDP11SimResult {
  const program = preset.build();
  const cpu = new PDP11();
  cpu.load(program);

  const steps: PDP11StepResult[] = [];
  const allEvents: PDP11Event[] = [];

  while (!cpu.halted && steps.length < MAX_STEPS) {
    const result = cpu.step();
    steps.push(result);
    allEvents.push(...result.events);
  }

  return {
    steps,
    events: allEvents,
    consoleOutput: cpu.consoleOutput,
  };
}

/** セッションインターフェース (インクリメンタル実行用) */
export interface PDP11Session {
  /** 1ステップ実行 */
  step(): PDP11StepResult;
  /** CPU停止状態か */
  isHalted(): boolean;
  /** ステップ数取得 */
  getStepCount(): number;
  /** コンソール出力取得 */
  getConsoleOutput(): string;
  /** CPUインスタンスへの直接アクセス */
  cpu: PDP11;
}

/**
 * インクリメンタル実行用セッションを作成
 */
export function createPDP11Session(preset: PDP11Preset): PDP11Session {
  const program = preset.build();
  const cpu = new PDP11();
  cpu.load(program);

  return {
    step: () => cpu.step(),
    isHalted: () => cpu.halted,
    getStepCount: () => cpu.stepCount,
    getConsoleOutput: () => cpu.consoleOutput,
    cpu,
  };
}
