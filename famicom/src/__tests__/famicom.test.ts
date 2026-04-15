/* ===== ファミコン シミュレーター テスト ===== */

import { describe, it, expect } from 'vitest';
import { NES } from '../engine/engine';
import { FLAG_C, FLAG_Z, FLAG_N } from '../engine/types';
import { presets } from '../engine/presets';

/** STP命令 */
const STP = 0xDB;

/* ========== テスト ========== */

describe('CPU: ロード/ストア命令', () => {
  it('LDA即値でアキュムレータに値をロードする', () => {
    const nes = new NES();
    nes.loadPrg([0xA9, 0x42, STP]); // LDA #$42
    nes.run();
    expect(nes.reg.A).toBe(0x42);
  });

  it('LDA/STAでメモリに書き込み・読み出しする', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0xFF,       // LDA #$FF
      0x85, 0x10,       // STA $10
      0xA5, 0x10,       // LDA $10
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0xFF);
    expect(nes.ram[0x10]).toBe(0xFF);
  });

  it('LDX/LDYでインデックスレジスタをロードする', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA2, 0x0A,       // LDX #$0A
      0xA0, 0x14,       // LDY #$14
      STP,
    ]);
    nes.run();
    expect(nes.reg.X).toBe(0x0A);
    expect(nes.reg.Y).toBe(0x14);
  });
});

describe('CPU: 算術命令', () => {
  it('ADCで加算する', () => {
    const nes = new NES();
    nes.loadPrg([
      0x18,             // CLC
      0xA9, 0x0A,       // LDA #$0A
      0x69, 0x14,       // ADC #$14
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0x1E); // 10 + 20 = 30
  });

  it('ADCでキャリーが発生する', () => {
    const nes = new NES();
    nes.loadPrg([
      0x18,             // CLC
      0xA9, 0xFF,       // LDA #$FF
      0x69, 0x01,       // ADC #$01
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0x00);
    expect(nes.reg.P & FLAG_C).toBeTruthy();
    expect(nes.reg.P & FLAG_Z).toBeTruthy();
  });

  it('SBCで減算する', () => {
    const nes = new NES();
    nes.loadPrg([
      0x38,             // SEC
      0xA9, 0x14,       // LDA #$14
      0xE9, 0x0A,       // SBC #$0A
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0x0A); // 20 - 10 = 10
  });
});

describe('CPU: フラグ', () => {
  it('ゼロフラグが設定される', () => {
    const nes = new NES();
    nes.loadPrg([0xA9, 0x00, STP]); // LDA #$00
    nes.run();
    expect(nes.reg.P & FLAG_Z).toBeTruthy();
    expect(nes.reg.P & FLAG_N).toBeFalsy();
  });

  it('ネガティブフラグが設定される', () => {
    const nes = new NES();
    nes.loadPrg([0xA9, 0x80, STP]); // LDA #$80
    nes.run();
    expect(nes.reg.P & FLAG_N).toBeTruthy();
  });

  it('CMP命令でフラグが設定される', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x0A,       // LDA #$0A
      0xC9, 0x0A,       // CMP #$0A
      STP,
    ]);
    nes.run();
    expect(nes.reg.P & FLAG_Z).toBeTruthy();
    expect(nes.reg.P & FLAG_C).toBeTruthy();
  });
});

describe('CPU: 分岐命令', () => {
  it('BNEでループする', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA2, 0x03,       // LDX #$03
      0xCA,             // DEX
      0xD0, 0xFD,       // BNE -3
      STP,
    ]);
    nes.run();
    expect(nes.reg.X).toBe(0);
  });

  it('BEQで条件分岐する', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x00,       // LDA #$00
      0xF0, 0x02,       // BEQ +2 (skip next)
      0xA9, 0xFF,       // LDA #$FF (skipped)
      0x85, 0x00,       // STA $00
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0x00);
    expect(nes.ram[0x00]).toBe(0x00);
  });
});

describe('CPU: スタック操作', () => {
  it('PHA/PLAでスタック操作する', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x42,       // LDA #$42
      0x48,             // PHA
      0xA9, 0x00,       // LDA #$00
      0x68,             // PLA
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0x42);
  });

  it('JSR/RTSでサブルーチン呼び出しする', () => {
    const nes = new NES();
    nes.loadPrg([
      0x20, 0x06, 0x80, // JSR $8006
      0x85, 0x00,       // STA $00
      STP,
      // subroutine at $8006:
      0xA9, 0x2A,       // LDA #$2A (42)
      0x60,             // RTS
    ]);
    nes.run();
    expect(nes.ram[0x00]).toBe(0x2A);
  });
});

describe('CPU: ビット演算', () => {
  it('AND/ORA/EORが正しく動作する', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0xFF,       // LDA #$FF
      0x29, 0x0F,       // AND #$0F   → $0F
      0x09, 0xF0,       // ORA #$F0   → $FF
      0x49, 0x0F,       // EOR #$0F   → $F0
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0xF0);
  });

  it('ASL/LSRでシフトする', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x01,       // LDA #$01
      0x0A,             // ASL A   → $02
      0x0A,             // ASL A   → $04
      0x4A,             // LSR A   → $02
      STP,
    ]);
    nes.run();
    expect(nes.reg.A).toBe(0x02);
  });
});

describe('CPU: インクリメント/デクリメント', () => {
  it('INC/DECでメモリを操作する', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x05,       // LDA #$05
      0x85, 0x10,       // STA $10
      0xE6, 0x10,       // INC $10   → 6
      0xE6, 0x10,       // INC $10   → 7
      0xC6, 0x10,       // DEC $10   → 6
      STP,
    ]);
    nes.run();
    expect(nes.ram[0x10]).toBe(6);
  });

  it('INX/DEXでレジスタを操作する', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA2, 0x00,       // LDX #$00
      0xE8,             // INX → 1
      0xE8,             // INX → 2
      0xE8,             // INX → 3
      0xCA,             // DEX → 2
      STP,
    ]);
    nes.run();
    expect(nes.reg.X).toBe(2);
  });
});

describe('PPU: レジスタアクセス', () => {
  it('PPUCTRLに書き込める', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x90,
      0x8D, 0x00, 0x20, // STA $2000
      STP,
    ]);
    nes.run();
    expect(nes.ppu.ctrl.nmiEnabled).toBe(true);
    expect(nes.ppu.ctrl.bgPatternTable).toBe(0x1000);
  });

  it('パレットRAMに書き込める', () => {
    const nes = new NES();
    nes.loadPrg([
      0xA9, 0x3F, 0x8D, 0x06, 0x20, // PPUADDR = $3F00 high
      0xA9, 0x00, 0x8D, 0x06, 0x20, // PPUADDR = $3F00 low
      0xA9, 0x15, 0x8D, 0x07, 0x20, // PPUDATA = $15
      STP,
    ]);
    nes.run();
    expect(nes.paletteRam[0]).toBe(0x15);
  });

  it('PPUSTATUS読取でVBlankがクリアされる', () => {
    const nes = new NES();
    nes.ppu.status.vblank = true;
    nes.loadPrg([
      0xAD, 0x02, 0x20, // LDA $2002
      STP,
    ]);
    nes.run();
    expect(nes.reg.A & 0x80).toBeTruthy();
    expect(nes.ppu.status.vblank).toBe(false);
  });
});

describe('PPU: スクロール', () => {
  it('PPUSCROLLでスクロール位置を設定する', () => {
    const nes = new NES();
    nes.loadPrg([
      0xAD, 0x02, 0x20, // LDA $2002 ; toggle reset
      0xA9, 0x40, 0x8D, 0x05, 0x20, // STA $2005 ; scrollX = 64
      0xA9, 0x20, 0x8D, 0x05, 0x20, // STA $2005 ; scrollY = 32
      STP,
    ]);
    nes.run();
    expect(nes.ppu.scrollX).toBe(64);
    expect(nes.ppu.scrollY).toBe(32);
  });
});

describe('コントローラ', () => {
  it('コントローラ入力を読み取る', () => {
    const nes = new NES();
    nes.controller.a = true;
    nes.controller.start = true;
    nes.loadPrg([
      0xA9, 0x01, 0x8D, 0x16, 0x40, // strobe on
      0xA9, 0x00, 0x8D, 0x16, 0x40, // strobe off
      0xAD, 0x16, 0x40, // read A
      0x85, 0x00,
      STP,
    ]);
    nes.run();
    expect(nes.ram[0x00]).toBe(1); // Aボタンが押されている
  });
});

describe('NMI割り込み', () => {
  it('NMIがトリガーされハンドラにジャンプする', () => {
    const nes = new NES();
    const prg: number[] = new Array(0x8000).fill(0xEA);
    prg[0] = 0xA9; prg[1] = 0x00; // LDA #$00
    prg[2] = 0x85; prg[3] = 0x00; // STA $00
    prg[4] = STP;

    /* NMIハンドラ @$8010 */
    prg[0x10] = 0xA9; prg[0x11] = 0xFF; // LDA #$FF
    prg[0x12] = 0x85; prg[0x13] = 0x00; // STA $00
    prg[0x14] = 0x40; // RTI

    prg[0x7FFA] = 0x10; prg[0x7FFB] = 0x80; // NMI vector = $8010

    nes.loadPrg(prg);
    nes.step(); // LDA #$00
    nes.step(); // STA $00

    nes.triggerNMI();
    nes.step(); // NMIハンドラ: LDA #$FF
    nes.step(); // STA $00
    nes.step(); // RTI

    expect(nes.ram[0x00]).toBe(0xFF);
  });
});

describe('統計情報', () => {
  it('実行統計が記録される', () => {
    const nes = new NES();
    nes.loadPrg([0xA9, 0x42, 0x85, 0x00, STP]);
    const result = nes.run();
    expect(result.stats.totalInstructions).toBeGreaterThan(0);
    expect(result.stats.totalCycles).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});

describe('プリセット', () => {
  it('全プリセットが正常に実行される', () => {
    expect(presets.length).toBeGreaterThanOrEqual(12);
    for (const preset of presets) {
      const result = preset.build();
      expect(result.steps.length).toBeGreaterThan(0);
    }
  });

  it('CPU基本命令プリセットが正しい結果を返す', () => {
    const result = presets[0]!.build();
    expect(result.finalRegs.A).toBe(30); // 10 + 20
  });

  it('分岐プリセットがカウンタを5にする', () => {
    const result = presets[2]!.build();
    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep?.zpPreview[0]).toBe(5);
  });
});
