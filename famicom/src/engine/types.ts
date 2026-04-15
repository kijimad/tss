/* ===== ファミコン シミュレーター 型定義 ===== */

/* ---------- CPU (Ricoh 2A03 / MOS 6502) ---------- */

/** CPUレジスタ */
export interface CpuRegisters {
  A: number;   // アキュムレータ (8bit)
  X: number;   // Xインデックス (8bit)
  Y: number;   // Yインデックス (8bit)
  SP: number;  // スタックポインタ (8bit, $0100-$01FF)
  PC: number;  // プログラムカウンタ (16bit)
  /** ステータスフラグ NV-BDIZC */
  P: number;
}

/** ステータスフラグのビット位置 */
export const FLAG_C = 0x01; // Carry
export const FLAG_Z = 0x02; // Zero
export const FLAG_I = 0x04; // Interrupt Disable
export const FLAG_D = 0x08; // Decimal (ファミコンでは未使用)
export const FLAG_B = 0x10; // Break
export const FLAG_U = 0x20; // Unused (常に1)
export const FLAG_V = 0x40; // Overflow
export const FLAG_N = 0x80; // Negative

/** アドレッシングモード */
export type AddressingMode =
  | 'implied'      // 暗黙
  | 'accumulator'  // アキュムレータ
  | 'immediate'    // 即値 #$nn
  | 'zeroPage'     // ゼロページ $nn
  | 'zeroPageX'    // ゼロページX $nn,X
  | 'zeroPageY'    // ゼロページY $nn,Y
  | 'absolute'     // 絶対 $nnnn
  | 'absoluteX'    // 絶対X $nnnn,X
  | 'absoluteY'    // 絶対Y $nnnn,Y
  | 'indirect'     // 間接 ($nnnn)
  | 'indirectX'    // 間接X ($nn,X)
  | 'indirectY'    // 間接Y ($nn),Y
  | 'relative';    // 相対 (分岐命令)

/* ---------- PPU (Picture Processing Unit 2C02) ---------- */

/** PPU制御レジスタ ($2000) */
export interface PpuCtrl {
  nametableBase: number;     // ベースネームテーブル (0-3)
  vramIncrement: number;     // VRAMアドレス増分 (1 or 32)
  spritePatternTable: number; // スプライトパターンテーブル ($0000 or $1000)
  bgPatternTable: number;    // BGパターンテーブル ($0000 or $1000)
  spriteSize: '8x8' | '8x16'; // スプライトサイズ
  nmiEnabled: boolean;        // VBlank NMI有効
}

/** PPUマスクレジスタ ($2001) */
export interface PpuMask {
  grayscale: boolean;
  showBgLeft8: boolean;    // 左端8px BG表示
  showSpLeft8: boolean;    // 左端8px スプライト表示
  showBg: boolean;         // BG表示
  showSprites: boolean;    // スプライト表示
  emphRed: boolean;
  emphGreen: boolean;
  emphBlue: boolean;
}

/** PPUステータスレジスタ ($2002) */
export interface PpuStatus {
  spriteOverflow: boolean;
  sprite0Hit: boolean;
  vblank: boolean;
}

/** スプライト属性 (OAM 4バイト) */
export interface Sprite {
  y: number;         // Y座標
  tileIndex: number; // タイルインデックス
  attributes: number; // 属性 (パレット、反転、優先度)
  x: number;         // X座標
}

/** PPU全体の状態 */
export interface PpuState {
  ctrl: PpuCtrl;
  mask: PpuMask;
  status: PpuStatus;
  oamAddr: number;       // OAMアドレス
  scrollX: number;       // 水平スクロール
  scrollY: number;       // 垂直スクロール
  vramAddr: number;      // VRAMアドレス
  tempAddr: number;      // テンポラリアドレス
  writeToggle: boolean;  // $2005/$2006のダブルライト制御
  scanline: number;      // 現在のスキャンライン (0-261)
  cycle: number;         // 現在のサイクル (0-340)
}

/* ---------- APU (Audio Processing Unit) ---------- */

/** APUチャンネル状態 */
export interface ApuChannel {
  enabled: boolean;
  volume: number;
  period: number;
  duty?: number;        // パルス波のデューティ (0-3)
  lengthCounter: number;
}

/** APU状態 */
export interface ApuState {
  pulse1: ApuChannel;
  pulse2: ApuChannel;
  triangle: ApuChannel;
  noise: ApuChannel;
  dmc: ApuChannel;
  frameCounter: number;
}

/* ---------- メモリマップ ---------- */

/**
 * ファミコンのメモリマップ:
 * $0000-$07FF: 内部RAM (2KB, $0800-$1FFFでミラー)
 * $2000-$2007: PPUレジスタ ($2008-$3FFFでミラー)
 * $4000-$4017: APU/IOレジスタ
 * $4020-$FFFF: カートリッジ空間 (PRG ROM/RAM)
 *
 * PPU メモリマップ:
 * $0000-$0FFF: パターンテーブル0 (CHR ROM)
 * $1000-$1FFF: パターンテーブル1 (CHR ROM)
 * $2000-$23FF: ネームテーブル0
 * $2400-$27FF: ネームテーブル1
 * $2800-$2BFF: ネームテーブル2 (ミラー)
 * $2C00-$2FFF: ネームテーブル3 (ミラー)
 * $3F00-$3F1F: パレット
 */

/* ---------- コントローラ ---------- */

/** コントローラの状態 */
export interface ControllerState {
  a: boolean;
  b: boolean;
  select: boolean;
  start: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/* ---------- シミュレーション ---------- */

/** NESパレット (64色) — RGB値 */
export const NES_PALETTE: [number, number, number][] = [
  [84,84,84],[0,30,116],[8,16,144],[48,0,136],[68,0,100],[92,0,48],[84,4,0],[60,24,0],
  [32,42,0],[8,58,0],[0,64,0],[0,60,0],[0,50,60],[0,0,0],[0,0,0],[0,0,0],
  [152,150,152],[8,76,196],[48,50,236],[92,30,228],[136,20,176],[160,20,100],[152,34,32],[120,60,0],
  [84,90,0],[40,114,0],[8,124,0],[0,118,40],[0,102,120],[0,0,0],[0,0,0],[0,0,0],
  [236,238,236],[76,154,236],[120,124,236],[176,98,236],[228,84,236],[236,88,180],[236,106,100],[212,136,32],
  [160,170,0],[116,196,0],[76,208,32],[56,204,108],[56,180,204],[60,60,60],[0,0,0],[0,0,0],
  [236,238,236],[168,204,236],[188,188,236],[212,178,236],[236,174,236],[236,174,212],[236,180,176],[228,196,144],
  [204,210,120],[180,222,120],[168,226,144],[152,226,180],[160,214,228],[160,162,160],[0,0,0],[0,0,0],
];

/** イベント種別 */
export type EventType =
  | 'cpu_fetch'    // CPU命令フェッチ
  | 'cpu_execute'  // CPU命令実行
  | 'cpu_flag'     // フラグ変化
  | 'memory_read'  // メモリ読取
  | 'memory_write' // メモリ書込
  | 'ppu_reg'      // PPUレジスタ操作
  | 'ppu_render'   // PPUレンダリング
  | 'ppu_scroll'   // スクロール設定
  | 'ppu_vblank'   // VBlank
  | 'sprite_dma'   // スプライトDMA
  | 'apu_reg'      // APUレジスタ操作
  | 'controller'   // コントローラアクセス
  | 'interrupt'    // 割り込み (NMI/IRQ/BRK)
  | 'stack';       // スタック操作

export type Severity = 'info' | 'detail' | 'warn' | 'error';

export interface FamicomEvent {
  type: EventType;
  severity: Severity;
  message: string;
}

/** 実行スナップショット */
export interface StepSnapshot {
  step: number;
  /** 逆アセンブル済み命令 */
  disasm: string;
  /** CPUレジスタ */
  regs: CpuRegisters;
  /** PPU状態（要約） */
  ppu: {
    scanline: number;
    cycle: number;
    ctrl: number;
    mask: number;
    status: number;
    scrollX: number;
    scrollY: number;
  };
  /** スタック内容（上位8バイト） */
  stackPreview: number[];
  /** ゼロページ先頭32バイト */
  zpPreview: number[];
  /** イベント */
  events: FamicomEvent[];
  /** 消費サイクル数 */
  cycles: number;
  message: string;
}

/** シミュレーション結果 */
export interface FamicomSimResult {
  steps: StepSnapshot[];
  /** 最終レジスタ状態 */
  finalRegs: CpuRegisters;
  /** 統計 */
  stats: {
    totalInstructions: number;
    totalCycles: number;
    memoryReads: number;
    memoryWrites: number;
    ppuAccesses: number;
    interrupts: number;
    branches: number;
    stackOps: number;
  };
  /** パレットプレビュー */
  palette: number[];
  /** ネームテーブルプレビュー (32x30 タイルインデックス) */
  nametable: number[];
  /** OAMスプライト (64個) */
  sprites: Sprite[];
}

/** プリセット */
export interface FamicomPreset {
  name: string;
  description: string;
  build: () => FamicomSimResult;
}
