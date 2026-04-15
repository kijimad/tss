/* ===== ファミコン シミュレーター プリセット ===== */

import type { FamicomPreset } from './types';
import { NES } from './engine';

/** STP命令(テスト停止)のオペコード */
const STP = 0xDB;

/* ================================================================
   プリセット定義
   ================================================================ */

export const presets: FamicomPreset[] = [
  /* 1. CPU基本命令 */
  {
    name: 'CPU基本命令 (LDA/STA/ADC)',
    description: '6502のロード、ストア、加算命令。アキュムレータとメモリ間のデータ転送。',
    build: () => {
      const nes = new NES();
      nes.loadPrg([
        0xA9, 0x0A,       // LDA #$0A    ; A = 10
        0x85, 0x00,       // STA $00     ; メモリ[$00] = 10
        0xA9, 0x14,       // LDA #$14    ; A = 20
        0x18,             // CLC
        0x65, 0x00,       // ADC $00     ; A = A + mem[$00] = 30
        0x85, 0x01,       // STA $01     ; メモリ[$01] = 30
        STP,
      ]);
      return nes.run();
    },
  },

  /* 2. アドレッシングモード */
  {
    name: 'アドレッシングモード',
    description: '即値、ゼロページ、絶対、インデックスなど6502の多彩なアドレッシングを体験。',
    build: () => {
      const nes = new NES();
      /* ゼロページにテストデータを配置 */
      nes.ram[0x10] = 0x42;
      nes.ram[0x20] = 0x00;
      nes.ram[0x21] = 0x80; // $20-21 = $8000+offset のポインタ

      nes.loadPrg([
        0xA9, 0xFF,       // LDA #$FF        ; 即値
        0xA5, 0x10,       // LDA $10         ; ゼロページ → A=$42
        0xA2, 0x05,       // LDX #$05        ; X = 5
        0xB5, 0x0B,       // LDA $0B,X       ; ゼロページX → $10 → A=$42
        0xAD, 0x10, 0x00, // LDA $0010       ; 絶対
        0xA0, 0x03,       // LDY #$03
        0xB9, 0x0D, 0x00, // LDA $000D,Y     ; 絶対Y → $0010 → A=$42
        STP,
      ]);
      return nes.run();
    },
  },

  /* 3. 分岐命令とフラグ */
  {
    name: '分岐命令とフラグ (CMP/BNE/BEQ)',
    description: '比較命令でフラグを設定し、条件分岐でループ。カウンタ0→5のインクリメント。',
    build: () => {
      const nes = new NES();
      nes.loadPrg([
        // カウンタ $00 を 0→5 にインクリメント
        0xA9, 0x00,       // LDA #$00
        0x85, 0x00,       // STA $00     ; counter = 0
        // loop:
        0xE6, 0x00,       // INC $00     ; counter++
        0xA5, 0x00,       // LDA $00     ; A = counter
        0xC9, 0x05,       // CMP #$05    ; compare with 5
        0xD0, 0xF8,       // BNE loop    ; if not equal, loop (-8)
        STP,
      ]);
      return nes.run();
    },
  },

  /* 4. スタック操作 (PHA/PLA/JSR/RTS) */
  {
    name: 'スタック操作 (JSR/RTS/PHA/PLA)',
    description: 'サブルーチン呼び出しとスタックへの値プッシュ/プル。呼び出し規約の基礎。',
    build: () => {
      const nes = new NES();
      nes.loadPrg([
        // main:
        0xA9, 0x07,       // LDA #$07
        0x48,             // PHA          ; スタックにプッシュ
        0xA9, 0x03,       // LDA #$03
        0x48,             // PHA
        0x20, 0x10, 0x80, // JSR $8010   ; サブルーチン呼び出し
        0x85, 0x00,       // STA $00     ; 結果を保存
        STP,
        0x00, 0x00, 0x00, // パディング
        // subroutine ($8010): 2つの値をスタックから取り出して加算
        0x68,             // PLA          ; 3
        0x85, 0x10,       // STA $10
        0x68,             // PLA          ; 7
        0x18,             // CLC
        0x65, 0x10,       // ADC $10     ; 7 + 3 = 10
        0x60,             // RTS
      ]);
      return nes.run();
    },
  },

  /* 5. PPUレジスタアクセス */
  {
    name: 'PPUレジスタ ($2000-$2007)',
    description: 'PPUCTRL/PPUMASK設定、VRAMアドレス指定、パレットデータ書き込み。',
    build: () => {
      const nes = new NES();
      nes.loadPrg([
        // PPUCTRL: NMI有効、BG patternTable $1000
        0xA9, 0x90,       // LDA #$90    ; NMI=1, BGパターン=$1000
        0x8D, 0x00, 0x20, // STA $2000   ; → PPUCTRL

        // PPUMASK: BG/スプライト表示有効
        0xA9, 0x1E,       // LDA #$1E
        0x8D, 0x01, 0x20, // STA $2001   ; → PPUMASK

        // パレットアドレス $3F00 を設定
        0xA9, 0x3F,       // LDA #$3F
        0x8D, 0x06, 0x20, // STA $2006   ; PPUADDR high
        0xA9, 0x00,       // LDA #$00
        0x8D, 0x06, 0x20, // STA $2006   ; PPUADDR low → $3F00

        // パレットデータ書き込み (BG palette 0)
        0xA9, 0x0F,       // LDA #$0F    ; 黒
        0x8D, 0x07, 0x20, // STA $2007
        0xA9, 0x11,       // LDA #$11    ; 青
        0x8D, 0x07, 0x20, // STA $2007
        0xA9, 0x21,       // LDA #$21    ; 水色
        0x8D, 0x07, 0x20, // STA $2007
        0xA9, 0x30,       // LDA #$30    ; 白
        0x8D, 0x07, 0x20, // STA $2007
        STP,
      ]);
      return nes.run();
    },
  },

  /* 6. スプライトDMA */
  {
    name: 'スプライトDMA ($4014)',
    description: 'OAM DMAでスプライトデータを一括転送。CPUページ→OAMへの256バイト転送。',
    build: () => {
      const nes = new NES();
      /* ページ $0200 にスプライトデータを配置 */
      nes.ram[0x00] = 0x30; // Y=48
      nes.ram[0x01] = 0x01; // Tile #1
      nes.ram[0x02] = 0x00; // Attributes
      nes.ram[0x03] = 0x40; // X=64

      nes.ram[0x04] = 0x50; // Y=80
      nes.ram[0x05] = 0x02; // Tile #2
      nes.ram[0x06] = 0x01; // Attributes: palette 1
      nes.ram[0x07] = 0x80; // X=128

      nes.loadPrg([
        // OAM DMA: ページ $00 → OAM
        0xA9, 0x00,       // LDA #$00
        0x8D, 0x03, 0x20, // STA $2003   ; OAMADDR = 0
        0xA9, 0x00,       // LDA #$00    ; ページ $00 (=$0000-$00FF)
        0x8D, 0x14, 0x40, // STA $4014   ; DMA開始
        STP,
      ]);
      return nes.run();
    },
  },

  /* 7. パレットとNESカラー */
  {
    name: 'パレット設定 (全4パレット)',
    description: 'BG 4パレット × 4色 = 16色をPPUに書き込み。NES固有の54色カラーパレット。',
    build: () => {
      const nes = new NES();
      /* BGパレット4セット */
      const paletteData = [
        0x0F, 0x00, 0x10, 0x30, // パレット0: 黒, 灰, 明灰, 白
        0x0F, 0x01, 0x11, 0x21, // パレット1: 黒, 暗青, 青, 水色
        0x0F, 0x06, 0x16, 0x26, // パレット2: 黒, 暗赤, 赤, 明赤
        0x0F, 0x09, 0x19, 0x29, // パレット3: 黒, 暗緑, 緑, 明緑
      ];

      const prg: number[] = [];
      /* PPUADDR = $3F00 */
      prg.push(0xA9, 0x3F, 0x8D, 0x06, 0x20); // LDA #$3F; STA $2006
      prg.push(0xA9, 0x00, 0x8D, 0x06, 0x20); // LDA #$00; STA $2006

      /* 16色分書き込み */
      for (const c of paletteData) {
        prg.push(0xA9, c, 0x8D, 0x07, 0x20); // LDA #c; STA $2007
      }
      prg.push(STP);
      nes.loadPrg(prg);
      return nes.run();
    },
  },

  /* 8. ネームテーブル書き込み */
  {
    name: 'ネームテーブル (BG配置)',
    description: 'ネームテーブル$2000にタイルインデックスを書き込み。32×30タイルのBGマップ構築。',
    build: () => {
      const nes = new NES();
      const prg: number[] = [];

      /* PPUADDR = $2000 (ネームテーブル0) */
      prg.push(0xA9, 0x20, 0x8D, 0x06, 0x20);
      prg.push(0xA9, 0x00, 0x8D, 0x06, 0x20);

      /* 先頭32タイル（1行）を書き込み */
      for (let i = 0; i < 32; i++) {
        prg.push(0xA9, i & 0xFF, 0x8D, 0x07, 0x20);
      }

      /* 2行目: 全てタイル$01 */
      for (let i = 0; i < 32; i++) {
        prg.push(0xA9, 0x01, 0x8D, 0x07, 0x20);
      }
      prg.push(STP);
      nes.loadPrg(prg);
      return nes.run();
    },
  },

  /* 9. コントローラ入力 */
  {
    name: 'コントローラ入力 ($4016)',
    description: 'コントローラのストローブとシリアル読取。ボタン状態の取得プロトコル。',
    build: () => {
      const nes = new NES();
      /* Aボタンと右ボタンが押されている状態をシミュレート */
      nes.controller.a = true;
      nes.controller.right = true;

      nes.loadPrg([
        // ストローブ: 1 → 0
        0xA9, 0x01,       // LDA #$01
        0x8D, 0x16, 0x40, // STA $4016   ; strobe on
        0xA9, 0x00,       // LDA #$00
        0x8D, 0x16, 0x40, // STA $4016   ; strobe off → latch

        // 8ビット読取 (A, B, Select, Start, Up, Down, Left, Right)
        0xAD, 0x16, 0x40, // LDA $4016   ; bit0: A
        0x85, 0x00,       // STA $00
        0xAD, 0x16, 0x40, // LDA $4016   ; bit1: B
        0x85, 0x01,       // STA $01
        0xAD, 0x16, 0x40, // LDA $4016   ; bit2: Select
        0x85, 0x02,       // STA $02
        0xAD, 0x16, 0x40, // LDA $4016   ; bit3: Start
        0x85, 0x03,       // STA $03
        0xAD, 0x16, 0x40, // LDA $4016   ; bit4: Up
        0x85, 0x04,       // STA $04
        0xAD, 0x16, 0x40, // LDA $4016   ; bit5: Down
        0x85, 0x05,       // STA $05
        0xAD, 0x16, 0x40, // LDA $4016   ; bit6: Left
        0x85, 0x06,       // STA $06
        0xAD, 0x16, 0x40, // LDA $4016   ; bit7: Right
        0x85, 0x07,       // STA $07
        STP,
      ]);
      return nes.run();
    },
  },

  /* 10. NMI割り込み */
  {
    name: 'NMI割り込み (VBlank)',
    description: 'VBlank NMI割り込みの発生とハンドラへのジャンプ。割り込みベクタの仕組み。',
    build: () => {
      const nes = new NES();
      /* NMIベクタを$8020に設定 */
      const nmiHandler = 0x8020;

      const prg: number[] = new Array(0x8000).fill(0xEA); // NOP fill
      /* メインコード @$8000 */
      prg[0x0000] = 0xA9; prg[0x0001] = 0x80; // LDA #$80
      prg[0x0002] = 0x8D; prg[0x0003] = 0x00; prg[0x0004] = 0x20; // STA $2000 (NMI有効)
      prg[0x0005] = 0xA9; prg[0x0006] = 0x00; // LDA #$00
      prg[0x0007] = 0x85; prg[0x0008] = 0x00; // STA $00 ; flag = 0
      prg[0x0009] = 0xEA; // NOP (ここでNMIが入る)
      prg[0x000A] = 0xA5; prg[0x000B] = 0x00; // LDA $00 ; flag check
      prg[0x000C] = STP;

      /* NMIハンドラ @$8020 */
      const off = nmiHandler - 0x8000;
      prg[off] = 0xA9; prg[off + 1] = 0x01; // LDA #$01
      prg[off + 2] = 0x85; prg[off + 3] = 0x00; // STA $00 ; flag = 1
      prg[off + 4] = 0x40; // RTI

      /* NMIベクタ ($FFFA-$FFFB) */
      prg[0x7FFA] = nmiHandler & 0xFF;
      prg[0x7FFB] = (nmiHandler >> 8) & 0xFF;

      nes.loadPrg(prg);

      /* 数命令実行 */
      nes.step(); // LDA #$80
      nes.step(); // STA $2000
      nes.step(); // LDA #$00
      nes.step(); // STA $00
      nes.step(); // NOP

      /* VBlank NMIをトリガー */
      nes.ppu.status.vblank = true;
      nes.triggerNMI();

      /* NMIハンドラ実行 */
      nes.step(); // LDA #$01
      nes.step(); // STA $00
      nes.step(); // RTI

      /* メインに復帰 */
      nes.step(); // LDA $00
      nes.step(); // STP

      return nes.buildResult();
    },
  },

  /* 11. スクロール制御 */
  {
    name: 'スクロール制御 ($2005)',
    description: 'PPUSCROLLレジスタで水平・垂直スクロール位置を設定。ダブルライトの仕組み。',
    build: () => {
      const nes = new NES();
      nes.loadPrg([
        // PPUSTATUSを読んでライトトグルをリセット
        0xAD, 0x02, 0x20, // LDA $2002

        // ScrollX = 128
        0xA9, 0x80,       // LDA #$80
        0x8D, 0x05, 0x20, // STA $2005   ; 1回目: ScrollX = 128

        // ScrollY = 64
        0xA9, 0x40,       // LDA #$40
        0x8D, 0x05, 0x20, // STA $2005   ; 2回目: ScrollY = 64

        // BGを有効化
        0xA9, 0x08,       // LDA #$08
        0x8D, 0x01, 0x20, // STA $2001   ; PPUMASK BG on
        STP,
      ]);
      return nes.run();
    },
  },

  /* 12. APUサウンドレジスタ */
  {
    name: 'APUサウンドレジスタ',
    description: 'パルス波チャンネルの設定。デューティ比、周期、ボリュームの制御。',
    build: () => {
      const nes = new NES();
      nes.loadPrg([
        // APU有効化: パルス1+2 有効
        0xA9, 0x03,       // LDA #$03
        0x8D, 0x15, 0x40, // STA $4015

        // Pulse 1: duty=50%, vol=15
        0xA9, 0xBF,       // LDA #$BF    ; duty=2(50%), vol=15
        0x8D, 0x00, 0x40, // STA $4000

        // Pulse 1: period low = $FD (A4=440Hz相当)
        0xA9, 0xFD,       // LDA #$FD
        0x8D, 0x02, 0x40, // STA $4002

        // Pulse 1: period high + length
        0xA9, 0x00,       // LDA #$00
        0x8D, 0x03, 0x40, // STA $4003

        // Pulse 2: duty=25%, vol=10
        0xA9, 0x7A,       // LDA #$7A    ; duty=1(25%), vol=10
        0x8D, 0x04, 0x40, // STA $4004

        // Pulse 2: lower frequency
        0xA9, 0xFB,       // LDA #$FB
        0x8D, 0x06, 0x40, // STA $4006
        0xA9, 0x01,       // LDA #$01
        0x8D, 0x07, 0x40, // STA $4007
        STP,
      ]);
      return nes.run();
    },
  },
];
