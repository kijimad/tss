/* ===== ファミコン エミュレーション エンジン ===== */

import type {
  CpuRegisters,
  AddressingMode,
  PpuState,
  PpuCtrl,
  PpuMask,
  ApuState,
  ApuChannel,
  Sprite,
  ControllerState,
  FamicomEvent,
  StepSnapshot,
  FamicomSimResult,
} from './types';
import { FLAG_C, FLAG_Z, FLAG_I, FLAG_D, FLAG_B, FLAG_U, FLAG_V, FLAG_N } from './types';

/* ================================================================
   NESバス — メモリマップ統合
   ================================================================ */

export class NES {
  /* CPU */
  reg: CpuRegisters;
  /** 内部RAM (2KB) */
  ram: Uint8Array;
  /** PRG ROM (最大32KB) */
  prgRom: Uint8Array;
  /** PRG ROMオフセット ($8000基準) */
  private prgBase = 0x8000;

  /* PPU */
  ppu: PpuState;
  /** パターンテーブル (CHR ROM, 8KB) */
  chrRom: Uint8Array;
  /** ネームテーブルRAM (2KB) */
  vram: Uint8Array;
  /** パレットRAM (32バイト) */
  paletteRam: Uint8Array;
  /** OAM (256バイト, 64スプライト × 4バイト) */
  oam: Uint8Array;
  /** PPU内部データバッファ ($2007読取用) */
  private ppuDataBuf = 0;

  /* APU */
  apu: ApuState;

  /* コントローラ */
  controller: ControllerState;
  private ctrlLatch = false;
  private ctrlShift = 0;

  /* シミュレーション */
  private steps: StepSnapshot[] = [];
  private events: FamicomEvent[] = [];
  private stepCount = 0;
  private totalCycles = 0;
  private memReads = 0;
  private memWrites = 0;
  private ppuAccesses = 0;
  private interruptCount = 0;
  private branchCount = 0;
  private stackOps = 0;
  private maxSteps = 5000;
  halted = false;

  constructor() {
    this.reg = { A: 0, X: 0, Y: 0, SP: 0xFD, PC: 0x8000, P: FLAG_U | FLAG_I };
    this.ram = new Uint8Array(0x0800);
    this.prgRom = new Uint8Array(0x8000);
    this.chrRom = new Uint8Array(0x2000);
    this.vram = new Uint8Array(0x0800);
    this.paletteRam = new Uint8Array(0x20);
    this.oam = new Uint8Array(0x100);
    this.ppu = defaultPpuState();
    this.apu = defaultApuState();
    this.controller = defaultController();
  }

  /* ---------- CPU メモリバス ---------- */

  /** CPUメモリ読取 */
  read(addr: number): number {
    addr &= 0xFFFF;
    this.memReads++;

    /* 内部RAM ($0000-$1FFF, $0800でミラー) */
    if (addr < 0x2000) {
      return this.ram[addr & 0x07FF]!;
    }
    /* PPUレジスタ ($2000-$3FFF, 8バイトミラー) */
    if (addr < 0x4000) {
      return this.readPpuReg(0x2000 + (addr & 7));
    }
    /* APU / IO ($4000-$4017) */
    if (addr < 0x4020) {
      return this.readApuIo(addr);
    }
    /* カートリッジ空間 ($4020-$FFFF) */
    if (addr >= this.prgBase) {
      return this.prgRom[(addr - this.prgBase) & (this.prgRom.length - 1)]!;
    }
    return 0;
  }

  /** CPUメモリ書込 */
  write(addr: number, val: number): void {
    addr &= 0xFFFF;
    val &= 0xFF;
    this.memWrites++;

    if (addr < 0x2000) {
      this.ram[addr & 0x07FF] = val;
      this.emit('memory_write', 'detail', `RAM[$${hex4(addr)}] = $${hex2(val)}`);
      return;
    }
    if (addr < 0x4000) {
      this.writePpuReg(0x2000 + (addr & 7), val);
      return;
    }
    if (addr < 0x4020) {
      this.writeApuIo(addr, val);
      return;
    }
  }

  /** 16bit リトルエンディアン読取 */
  read16(addr: number): number {
    return this.read(addr) | (this.read(addr + 1) << 8);
  }

  /* ---------- PPUレジスタ読取 ---------- */

  private readPpuReg(addr: number): number {
    this.ppuAccesses++;
    switch (addr) {
      case 0x2002: {
        /* PPUSTATUS: VBlank読取でクリア */
        let val = 0;
        if (this.ppu.status.vblank) val |= 0x80;
        if (this.ppu.status.sprite0Hit) val |= 0x40;
        if (this.ppu.status.spriteOverflow) val |= 0x20;
        this.ppu.status.vblank = false;
        this.ppu.writeToggle = false;
        this.emit('ppu_reg', 'detail', `PPUSTATUS読取 = $${hex2(val)} (VBlankクリア)`);
        return val;
      }
      case 0x2004: {
        /* OAMDATA */
        return this.oam[this.ppu.oamAddr]!;
      }
      case 0x2007: {
        /* PPUDATA: VRAMからの読取 */
        const ppuAddr = this.ppu.vramAddr & 0x3FFF;
        let val: number;
        if (ppuAddr >= 0x3F00) {
          /* パレットは即時読取 */
          val = this.paletteRam[ppuAddr & 0x1F]!;
        } else {
          /* それ以外は1回遅延 */
          val = this.ppuDataBuf;
          this.ppuDataBuf = this.readVram(ppuAddr);
        }
        this.ppu.vramAddr += this.ppu.ctrl.vramIncrement;
        return val;
      }
      default:
        return 0;
    }
  }

  /* ---------- PPUレジスタ書込 ---------- */

  private writePpuReg(addr: number, val: number): void {
    this.ppuAccesses++;
    switch (addr) {
      case 0x2000: {
        /* PPUCTRL */
        this.ppu.ctrl = decodePpuCtrl(val);
        this.emit('ppu_reg', 'info',
          `PPUCTRL = $${hex2(val)} (NT=${this.ppu.ctrl.nametableBase}, inc=${this.ppu.ctrl.vramIncrement}, NMI=${this.ppu.ctrl.nmiEnabled ? 'ON' : 'OFF'})`);
        break;
      }
      case 0x2001: {
        this.ppu.mask = decodePpuMask(val);
        this.emit('ppu_reg', 'info',
          `PPUMASK = $${hex2(val)} (BG=${this.ppu.mask.showBg ? 'ON' : 'OFF'}, Spr=${this.ppu.mask.showSprites ? 'ON' : 'OFF'})`);
        break;
      }
      case 0x2003:
        this.ppu.oamAddr = val;
        break;
      case 0x2004:
        this.oam[this.ppu.oamAddr] = val;
        this.ppu.oamAddr = (this.ppu.oamAddr + 1) & 0xFF;
        break;
      case 0x2005: {
        /* PPUSCROLL: ダブルライト */
        if (!this.ppu.writeToggle) {
          this.ppu.scrollX = val;
          this.emit('ppu_scroll', 'info', `ScrollX = ${val}`);
        } else {
          this.ppu.scrollY = val;
          this.emit('ppu_scroll', 'info', `ScrollY = ${val}`);
        }
        this.ppu.writeToggle = !this.ppu.writeToggle;
        break;
      }
      case 0x2006: {
        /* PPUADDR: ダブルライト */
        if (!this.ppu.writeToggle) {
          this.ppu.tempAddr = (val & 0x3F) << 8;
        } else {
          this.ppu.vramAddr = this.ppu.tempAddr | val;
          this.emit('ppu_reg', 'detail', `PPUADDR = $${hex4(this.ppu.vramAddr)}`);
        }
        this.ppu.writeToggle = !this.ppu.writeToggle;
        break;
      }
      case 0x2007: {
        /* PPUDATA: VRAMへの書込 */
        const ppuAddr = this.ppu.vramAddr & 0x3FFF;
        if (ppuAddr >= 0x3F00) {
          this.paletteRam[ppuAddr & 0x1F] = val;
          this.emit('ppu_reg', 'info', `パレット[$${hex4(ppuAddr)}] = $${hex2(val)}`);
        } else {
          this.writeVram(ppuAddr, val);
          this.emit('ppu_reg', 'detail', `VRAM[$${hex4(ppuAddr)}] = $${hex2(val)}`);
        }
        this.ppu.vramAddr += this.ppu.ctrl.vramIncrement;
        break;
      }
    }
  }

  /* ---------- PPU VRAM ---------- */

  private readVram(addr: number): number {
    addr &= 0x3FFF;
    if (addr < 0x2000) return this.chrRom[addr]!;
    if (addr < 0x3F00) return this.vram[addr & 0x07FF]!;
    return this.paletteRam[addr & 0x1F]!;
  }

  private writeVram(addr: number, val: number): void {
    addr &= 0x3FFF;
    if (addr < 0x2000) { this.chrRom[addr] = val; return; }
    if (addr < 0x3F00) { this.vram[addr & 0x07FF] = val; return; }
    this.paletteRam[addr & 0x1F] = val;
  }

  /* ---------- APU / IO ---------- */

  private readApuIo(addr: number): number {
    if (addr === 0x4016) {
      /* コントローラ1読取 */
      const bit = (this.ctrlShift >> 7) & 1;
      this.ctrlShift = (this.ctrlShift << 1) & 0xFF;
      this.emit('controller', 'detail', `コントローラ読取: bit=${bit}`);
      return bit;
    }
    if (addr === 0x4015) {
      /* APUステータス */
      let val = 0;
      if (this.apu.pulse1.lengthCounter > 0) val |= 0x01;
      if (this.apu.pulse2.lengthCounter > 0) val |= 0x02;
      if (this.apu.triangle.lengthCounter > 0) val |= 0x04;
      if (this.apu.noise.lengthCounter > 0) val |= 0x08;
      return val;
    }
    return 0;
  }

  private writeApuIo(addr: number, val: number): void {
    /* スプライトDMA ($4014) */
    if (addr === 0x4014) {
      const page = val << 8;
      for (let i = 0; i < 256; i++) {
        this.oam[i] = this.read(page + i);
      }
      this.totalCycles += 513;
      this.emit('sprite_dma', 'info', `OAM DMA: ページ $${hex2(val)}00 → OAM (513サイクル)`);
      return;
    }

    /* コントローラストローブ ($4016) */
    if (addr === 0x4016) {
      if ((val & 1) === 1) {
        this.ctrlLatch = true;
      } else if (this.ctrlLatch) {
        this.ctrlLatch = false;
        this.ctrlShift = encodeController(this.controller);
        this.emit('controller', 'info', `コントローララッチ: $${hex2(this.ctrlShift)}`);
      }
      return;
    }

    /* APUレジスタ ($4000-$4013, $4015, $4017) */
    if (addr >= 0x4000 && addr <= 0x4003) {
      this.writeApuPulse(this.apu.pulse1, addr - 0x4000, val, '1');
    } else if (addr >= 0x4004 && addr <= 0x4007) {
      this.writeApuPulse(this.apu.pulse2, addr - 0x4004, val, '2');
    } else if (addr >= 0x4008 && addr <= 0x400B) {
      if (addr === 0x4008) {
        this.apu.triangle.volume = val & 0x7F;
        this.emit('apu_reg', 'detail', `Triangle: リニアカウンタ = ${val & 0x7F}`);
      } else if (addr === 0x400A) {
        this.apu.triangle.period = (this.apu.triangle.period & 0x700) | val;
      } else if (addr === 0x400B) {
        this.apu.triangle.period = (this.apu.triangle.period & 0xFF) | ((val & 7) << 8);
        this.apu.triangle.lengthCounter = val >> 3;
      }
    } else if (addr === 0x400C) {
      this.apu.noise.volume = val & 0x0F;
    } else if (addr === 0x4015) {
      this.apu.pulse1.enabled = (val & 0x01) !== 0;
      this.apu.pulse2.enabled = (val & 0x02) !== 0;
      this.apu.triangle.enabled = (val & 0x04) !== 0;
      this.apu.noise.enabled = (val & 0x08) !== 0;
      this.apu.dmc.enabled = (val & 0x10) !== 0;
      this.emit('apu_reg', 'info', `APUステータス = $${hex2(val)}`);
    }
  }

  private writeApuPulse(ch: ApuChannel, reg: number, val: number, name: string): void {
    switch (reg) {
      case 0:
        ch.duty = (val >> 6) & 3;
        ch.volume = val & 0x0F;
        this.emit('apu_reg', 'detail', `Pulse${name}: duty=${ch.duty}, vol=${ch.volume}`);
        break;
      case 2:
        ch.period = (ch.period & 0x700) | val;
        break;
      case 3:
        ch.period = (ch.period & 0xFF) | ((val & 7) << 8);
        ch.lengthCounter = val >> 3;
        this.emit('apu_reg', 'detail', `Pulse${name}: period=${ch.period}, len=${ch.lengthCounter}`);
        break;
    }
  }

  /* ================================================================
     CPU 実行エンジン
     ================================================================ */

  /** PRG ROMをロード */
  loadPrg(data: number[], offset = 0x8000): void {
    this.prgBase = offset;
    for (let i = 0; i < data.length; i++) {
      this.prgRom[i] = data[i]!;
    }
    /* リセットベクタ */
    this.reg.PC = offset;
  }

  /** CHR ROMをロード */
  loadChr(data: number[]): void {
    for (let i = 0; i < data.length && i < this.chrRom.length; i++) {
      this.chrRom[i] = data[i]!;
    }
  }

  /** 1命令を実行 */
  step(): number {
    if (this.halted) return 0;

    const pc = this.reg.PC;
    const opcode = this.read(pc);
    const info = OPCODES[opcode];

    if (!info) {
      this.emit('cpu_fetch', 'error', `不明なオペコード: $${hex2(opcode)} at $${hex4(pc)}`);
      this.halted = true;
      this.recordStep(`??? $${hex2(opcode)}`, 0);
      return 0;
    }

    const [mnemonic, mode, baseCycles] = info;
    /* ストア命令ではターゲットアドレスからの読取を抑制（PPUレジスタの副作用を防ぐ） */
    const isStore = mnemonic === 'STA' || mnemonic === 'STX' || mnemonic === 'STY';
    const { addr, val, extraCycles, operandStr } = this.resolveOperand(mode, pc + 1, isStore);
    const cycles = baseCycles + extraCycles;

    /* 逆アセンブル */
    const disasm = `$${hex4(pc)}: ${mnemonic} ${operandStr}`.trim();
    this.emit('cpu_fetch', 'info', disasm);

    /* PC を命令サイズ分進める */
    this.reg.PC = (pc + instructionSize(mode)) & 0xFFFF;

    /* 命令実行 */
    this.executeInstruction(mnemonic, mode, addr, val);

    this.totalCycles += cycles;
    this.recordStep(disasm, cycles);
    return cycles;
  }

  /** 複数ステップを実行 */
  run(maxInstructions?: number): FamicomSimResult {
    const limit = maxInstructions ?? this.maxSteps;
    let count = 0;
    while (!this.halted && count < limit) {
      this.step();
      count++;
    }
    return this.buildResult();
  }

  /* ---------- オペランド解決 ---------- */

  private resolveOperand(mode: AddressingMode, operandPC: number, skipValRead = false): {
    addr: number; val: number; extraCycles: number; operandStr: string;
  } {
    let addr = 0, val = 0, extraCycles = 0, operandStr = '';
    /** ストア命令では副作用のあるPPU/APUレジスタ読取を回避 */
    const readVal = (a: number) => skipValRead ? 0 : this.read(a);

    switch (mode) {
      case 'implied':
        break;
      case 'accumulator':
        val = this.reg.A;
        operandStr = 'A';
        break;
      case 'immediate':
        val = this.read(operandPC);
        operandStr = `#$${hex2(val)}`;
        break;
      case 'zeroPage':
        addr = this.read(operandPC);
        val = readVal(addr);
        operandStr = `$${hex2(addr)}`;
        break;
      case 'zeroPageX':
        addr = (this.read(operandPC) + this.reg.X) & 0xFF;
        val = readVal(addr);
        operandStr = `$${hex2(this.read(operandPC))},X`;
        break;
      case 'zeroPageY':
        addr = (this.read(operandPC) + this.reg.Y) & 0xFF;
        val = readVal(addr);
        operandStr = `$${hex2(this.read(operandPC))},Y`;
        break;
      case 'absolute':
        addr = this.read16(operandPC);
        val = readVal(addr);
        operandStr = `$${hex4(addr)}`;
        break;
      case 'absoluteX': {
        const base = this.read16(operandPC);
        addr = (base + this.reg.X) & 0xFFFF;
        val = readVal(addr);
        if ((base & 0xFF00) !== (addr & 0xFF00)) extraCycles = 1;
        operandStr = `$${hex4(base)},X`;
        break;
      }
      case 'absoluteY': {
        const base = this.read16(operandPC);
        addr = (base + this.reg.Y) & 0xFFFF;
        val = readVal(addr);
        if ((base & 0xFF00) !== (addr & 0xFF00)) extraCycles = 1;
        operandStr = `$${hex4(base)},Y`;
        break;
      }
      case 'indirect': {
        const ptr = this.read16(operandPC);
        /* 6502のバグ: ページ境界をまたがない */
        const lo = this.read(ptr);
        const hi = this.read((ptr & 0xFF00) | ((ptr + 1) & 0xFF));
        addr = lo | (hi << 8);
        operandStr = `($${hex4(ptr)})`;
        break;
      }
      case 'indirectX': {
        const zp = (this.read(operandPC) + this.reg.X) & 0xFF;
        addr = this.read(zp) | (this.read((zp + 1) & 0xFF) << 8);
        val = readVal(addr);
        operandStr = `($${hex2(this.read(operandPC))},X)`;
        break;
      }
      case 'indirectY': {
        const zp = this.read(operandPC);
        const base = this.read(zp) | (this.read((zp + 1) & 0xFF) << 8);
        addr = (base + this.reg.Y) & 0xFFFF;
        val = readVal(addr);
        if ((base & 0xFF00) !== (addr & 0xFF00)) extraCycles = 1;
        operandStr = `($${hex2(zp)}),Y`;
        break;
      }
      case 'relative': {
        const offset = this.read(operandPC);
        const signed = offset < 0x80 ? offset : offset - 256;
        addr = (this.reg.PC + 2 + signed) & 0xFFFF; // PC+2 は命令サイズ
        operandStr = `$${hex4(addr)}`;
        break;
      }
    }
    return { addr, val, extraCycles, operandStr };
  }

  /* ---------- 命令実行 ---------- */

  private executeInstruction(mnemonic: string, mode: AddressingMode, addr: number, val: number): void {
    const r = this.reg;
    switch (mnemonic) {
      /* ---- ロード/ストア ---- */
      case 'LDA': r.A = val; this.setNZ(r.A); break;
      case 'LDX': r.X = val; this.setNZ(r.X); break;
      case 'LDY': r.Y = val; this.setNZ(r.Y); break;
      case 'STA': this.write(addr, r.A); break;
      case 'STX': this.write(addr, r.X); break;
      case 'STY': this.write(addr, r.Y); break;

      /* ---- 算術 ---- */
      case 'ADC': {
        const carry = r.P & FLAG_C;
        const sum = r.A + val + carry;
        this.setFlag(FLAG_C, sum > 0xFF);
        this.setFlag(FLAG_V, ((r.A ^ sum) & (val ^ sum) & 0x80) !== 0);
        r.A = sum & 0xFF;
        this.setNZ(r.A);
        break;
      }
      case 'SBC': {
        const carry = r.P & FLAG_C;
        const diff = r.A - val - (1 - carry);
        this.setFlag(FLAG_C, diff >= 0);
        this.setFlag(FLAG_V, ((r.A ^ diff) & (r.A ^ val) & 0x80) !== 0);
        r.A = diff & 0xFF;
        this.setNZ(r.A);
        break;
      }

      /* ---- 比較 ---- */
      case 'CMP': this.compare(r.A, val); break;
      case 'CPX': this.compare(r.X, val); break;
      case 'CPY': this.compare(r.Y, val); break;

      /* ---- インクリメント/デクリメント ---- */
      case 'INC': { const v = (val + 1) & 0xFF; this.write(addr, v); this.setNZ(v); break; }
      case 'DEC': { const v = (val - 1) & 0xFF; this.write(addr, v); this.setNZ(v); break; }
      case 'INX': r.X = (r.X + 1) & 0xFF; this.setNZ(r.X); break;
      case 'DEX': r.X = (r.X - 1) & 0xFF; this.setNZ(r.X); break;
      case 'INY': r.Y = (r.Y + 1) & 0xFF; this.setNZ(r.Y); break;
      case 'DEY': r.Y = (r.Y - 1) & 0xFF; this.setNZ(r.Y); break;

      /* ---- ビット演算 ---- */
      case 'AND': r.A &= val; this.setNZ(r.A); break;
      case 'ORA': r.A |= val; this.setNZ(r.A); break;
      case 'EOR': r.A ^= val; this.setNZ(r.A); break;
      case 'BIT': {
        this.setFlag(FLAG_Z, (r.A & val) === 0);
        this.setFlag(FLAG_V, (val & 0x40) !== 0);
        this.setFlag(FLAG_N, (val & 0x80) !== 0);
        break;
      }

      /* ---- シフト/ローテート ---- */
      case 'ASL': {
        const src = mode === 'accumulator' ? r.A : val;
        this.setFlag(FLAG_C, (src & 0x80) !== 0);
        const result = (src << 1) & 0xFF;
        if (mode === 'accumulator') r.A = result; else this.write(addr, result);
        this.setNZ(result);
        break;
      }
      case 'LSR': {
        const src = mode === 'accumulator' ? r.A : val;
        this.setFlag(FLAG_C, (src & 0x01) !== 0);
        const result = src >> 1;
        if (mode === 'accumulator') r.A = result; else this.write(addr, result);
        this.setNZ(result);
        break;
      }
      case 'ROL': {
        const src = mode === 'accumulator' ? r.A : val;
        const carry = r.P & FLAG_C;
        this.setFlag(FLAG_C, (src & 0x80) !== 0);
        const result = ((src << 1) | carry) & 0xFF;
        if (mode === 'accumulator') r.A = result; else this.write(addr, result);
        this.setNZ(result);
        break;
      }
      case 'ROR': {
        const src = mode === 'accumulator' ? r.A : val;
        const carry = (r.P & FLAG_C) << 7;
        this.setFlag(FLAG_C, (src & 0x01) !== 0);
        const result = (src >> 1) | carry;
        if (mode === 'accumulator') r.A = result; else this.write(addr, result);
        this.setNZ(result);
        break;
      }

      /* ---- 分岐 ---- */
      case 'BCC': this.branch(!(r.P & FLAG_C), addr); break;
      case 'BCS': this.branch(!!(r.P & FLAG_C), addr); break;
      case 'BEQ': this.branch(!!(r.P & FLAG_Z), addr); break;
      case 'BNE': this.branch(!(r.P & FLAG_Z), addr); break;
      case 'BMI': this.branch(!!(r.P & FLAG_N), addr); break;
      case 'BPL': this.branch(!(r.P & FLAG_N), addr); break;
      case 'BVS': this.branch(!!(r.P & FLAG_V), addr); break;
      case 'BVC': this.branch(!(r.P & FLAG_V), addr); break;

      /* ---- ジャンプ ---- */
      case 'JMP': r.PC = addr; break;
      case 'JSR':
        this.pushWord(r.PC - 1);
        r.PC = addr;
        this.emit('stack', 'detail', `JSR → $${hex4(addr)} (戻りアドレス $${hex4(r.PC)} をプッシュ)`);
        this.stackOps++;
        break;
      case 'RTS': {
        const retAddr = this.pullWord() + 1;
        r.PC = retAddr & 0xFFFF;
        this.emit('stack', 'detail', `RTS → $${hex4(r.PC)}`);
        this.stackOps++;
        break;
      }
      case 'RTI': {
        r.P = (this.pull() & ~FLAG_B) | FLAG_U;
        r.PC = this.pullWord();
        this.emit('interrupt', 'info', `RTI → $${hex4(r.PC)}`);
        this.stackOps++;
        break;
      }

      /* ---- スタック ---- */
      case 'PHA': this.push(r.A); this.stackOps++; break;
      case 'PLA': r.A = this.pull(); this.setNZ(r.A); this.stackOps++; break;
      case 'PHP': this.push(r.P | FLAG_B); this.stackOps++; break;
      case 'PLP': r.P = (this.pull() & ~FLAG_B) | FLAG_U; this.stackOps++; break;

      /* ---- フラグ ---- */
      case 'CLC': this.setFlag(FLAG_C, false); break;
      case 'SEC': this.setFlag(FLAG_C, true); break;
      case 'CLI': this.setFlag(FLAG_I, false); break;
      case 'SEI': this.setFlag(FLAG_I, true); break;
      case 'CLV': this.setFlag(FLAG_V, false); break;
      case 'CLD': this.setFlag(FLAG_D, false); break;
      case 'SED': this.setFlag(FLAG_D, true); break;

      /* ---- 転送 ---- */
      case 'TAX': r.X = r.A; this.setNZ(r.X); break;
      case 'TAY': r.Y = r.A; this.setNZ(r.Y); break;
      case 'TXA': r.A = r.X; this.setNZ(r.A); break;
      case 'TYA': r.A = r.Y; this.setNZ(r.A); break;
      case 'TXS': r.SP = r.X; break;
      case 'TSX': r.X = r.SP; this.setNZ(r.X); break;

      /* ---- その他 ---- */
      case 'NOP': break;
      case 'BRK': {
        this.pushWord(r.PC);
        this.push(r.P | FLAG_B);
        this.setFlag(FLAG_I, true);
        r.PC = this.read16(0xFFFE);
        this.emit('interrupt', 'warn', `BRK → IRQベクタ $${hex4(r.PC)}`);
        this.interruptCount++;
        break;
      }
      case 'STP':
        /* 停止命令（テスト用） */
        this.halted = true;
        break;
    }
  }

  /* ---------- フラグ / スタック ヘルパー ---------- */

  private setNZ(val: number): void {
    this.setFlag(FLAG_Z, (val & 0xFF) === 0);
    this.setFlag(FLAG_N, (val & 0x80) !== 0);
  }

  setFlag(flag: number, on: boolean): void {
    if (on) this.reg.P |= flag;
    else this.reg.P &= ~flag;
  }

  private compare(a: number, b: number): void {
    const diff = a - b;
    this.setFlag(FLAG_C, a >= b);
    this.setNZ(diff & 0xFF);
  }

  private branch(condition: boolean, target: number): void {
    this.branchCount++;
    if (condition) {
      this.reg.PC = target;
      this.emit('cpu_execute', 'detail', `分岐成立 → $${hex4(target)}`);
    }
  }

  private push(val: number): void {
    this.write(0x0100 | this.reg.SP, val & 0xFF);
    this.reg.SP = (this.reg.SP - 1) & 0xFF;
  }

  private pull(): number {
    this.reg.SP = (this.reg.SP + 1) & 0xFF;
    return this.read(0x0100 | this.reg.SP);
  }

  private pushWord(val: number): void {
    this.push((val >> 8) & 0xFF);
    this.push(val & 0xFF);
  }

  private pullWord(): number {
    const lo = this.pull();
    const hi = this.pull();
    return lo | (hi << 8);
  }

  /** NMI割り込みをトリガー */
  triggerNMI(): void {
    this.pushWord(this.reg.PC);
    this.push(this.reg.P & ~FLAG_B);
    this.setFlag(FLAG_I, true);
    this.reg.PC = this.read16(0xFFFA);
    this.emit('interrupt', 'warn', `NMI → $${hex4(this.reg.PC)}`);
    this.interruptCount++;
  }

  /* ---------- イベント / スナップショット ---------- */

  private emit(type: FamicomEvent['type'], severity: FamicomEvent['severity'], message: string): void {
    this.events.push({ type, severity, message });
  }

  private recordStep(disasm: string, cycles: number): void {
    const r = this.reg;
    const snapshot: StepSnapshot = {
      step: this.stepCount++,
      disasm,
      regs: { ...r },
      ppu: {
        scanline: this.ppu.scanline,
        cycle: this.ppu.cycle,
        ctrl: encodePpuCtrl(this.ppu.ctrl),
        mask: encodePpuMask(this.ppu.mask),
        status: (this.ppu.status.vblank ? 0x80 : 0) |
                (this.ppu.status.sprite0Hit ? 0x40 : 0) |
                (this.ppu.status.spriteOverflow ? 0x20 : 0),
        scrollX: this.ppu.scrollX,
        scrollY: this.ppu.scrollY,
      },
      stackPreview: this.getStackPreview(),
      zpPreview: Array.from(this.ram.slice(0, 32)),
      events: [...this.events],
      cycles,
      message: disasm,
    };
    this.steps.push(snapshot);
    this.events = [];
  }

  private getStackPreview(): number[] {
    const preview: number[] = [];
    for (let i = 0; i < 8; i++) {
      const addr = 0x0100 | ((this.reg.SP + 1 + i) & 0xFF);
      if (addr > 0x01FF) break;
      preview.push(this.read(addr));
    }
    return preview;
  }

  buildResult(): FamicomSimResult {
    const sprites: Sprite[] = [];
    for (let i = 0; i < 64; i++) {
      sprites.push({
        y: this.oam[i * 4]!,
        tileIndex: this.oam[i * 4 + 1]!,
        attributes: this.oam[i * 4 + 2]!,
        x: this.oam[i * 4 + 3]!,
      });
    }
    return {
      steps: this.steps,
      finalRegs: { ...this.reg },
      stats: {
        totalInstructions: this.stepCount,
        totalCycles: this.totalCycles,
        memoryReads: this.memReads,
        memoryWrites: this.memWrites,
        ppuAccesses: this.ppuAccesses,
        interrupts: this.interruptCount,
        branches: this.branchCount,
        stackOps: this.stackOps,
      },
      palette: Array.from(this.paletteRam),
      nametable: Array.from(this.vram.slice(0, 960)),
      sprites,
    };
  }
}

/* ================================================================
   デフォルト状態
   ================================================================ */

function defaultPpuState(): PpuState {
  return {
    ctrl: { nametableBase: 0, vramIncrement: 1, spritePatternTable: 0, bgPatternTable: 0, spriteSize: '8x8', nmiEnabled: false },
    mask: { grayscale: false, showBgLeft8: false, showSpLeft8: false, showBg: false, showSprites: false, emphRed: false, emphGreen: false, emphBlue: false },
    status: { spriteOverflow: false, sprite0Hit: false, vblank: false },
    oamAddr: 0, scrollX: 0, scrollY: 0, vramAddr: 0, tempAddr: 0, writeToggle: false, scanline: 0, cycle: 0,
  };
}

function defaultApuState(): ApuState {
  const ch = (): ApuChannel => ({ enabled: false, volume: 0, period: 0, lengthCounter: 0 });
  return { pulse1: { ...ch(), duty: 0 }, pulse2: { ...ch(), duty: 0 }, triangle: ch(), noise: ch(), dmc: ch(), frameCounter: 0 };
}

function defaultController(): ControllerState {
  return { a: false, b: false, select: false, start: false, up: false, down: false, left: false, right: false };
}

/* ================================================================
   PPUレジスタ エンコード/デコード
   ================================================================ */

function decodePpuCtrl(val: number): PpuCtrl {
  return {
    nametableBase: val & 3,
    vramIncrement: (val & 4) ? 32 : 1,
    spritePatternTable: (val & 8) ? 0x1000 : 0,
    bgPatternTable: (val & 16) ? 0x1000 : 0,
    spriteSize: (val & 32) ? '8x16' : '8x8',
    nmiEnabled: (val & 128) !== 0,
  };
}

function decodePpuMask(val: number): PpuMask {
  return {
    grayscale: (val & 1) !== 0,
    showBgLeft8: (val & 2) !== 0,
    showSpLeft8: (val & 4) !== 0,
    showBg: (val & 8) !== 0,
    showSprites: (val & 16) !== 0,
    emphRed: (val & 32) !== 0,
    emphGreen: (val & 64) !== 0,
    emphBlue: (val & 128) !== 0,
  };
}

function encodePpuCtrl(ctrl: PpuCtrl): number {
  let v = ctrl.nametableBase & 3;
  if (ctrl.vramIncrement === 32) v |= 4;
  if (ctrl.spritePatternTable) v |= 8;
  if (ctrl.bgPatternTable) v |= 16;
  if (ctrl.spriteSize === '8x16') v |= 32;
  if (ctrl.nmiEnabled) v |= 128;
  return v;
}

function encodePpuMask(mask: PpuMask): number {
  let v = 0;
  if (mask.grayscale) v |= 1;
  if (mask.showBgLeft8) v |= 2;
  if (mask.showSpLeft8) v |= 4;
  if (mask.showBg) v |= 8;
  if (mask.showSprites) v |= 16;
  if (mask.emphRed) v |= 32;
  if (mask.emphGreen) v |= 64;
  if (mask.emphBlue) v |= 128;
  return v;
}

function encodeController(c: ControllerState): number {
  let v = 0;
  if (c.a) v |= 0x80;
  if (c.b) v |= 0x40;
  if (c.select) v |= 0x20;
  if (c.start) v |= 0x10;
  if (c.up) v |= 0x08;
  if (c.down) v |= 0x04;
  if (c.left) v |= 0x02;
  if (c.right) v |= 0x01;
  return v;
}

/* ================================================================
   オペコードテーブル
   ================================================================ */

/** 命令サイズを返す */
function instructionSize(mode: AddressingMode): number {
  switch (mode) {
    case 'implied': case 'accumulator': return 1;
    case 'immediate': case 'zeroPage': case 'zeroPageX': case 'zeroPageY':
    case 'indirectX': case 'indirectY': case 'relative': return 2;
    case 'absolute': case 'absoluteX': case 'absoluteY': case 'indirect': return 3;
  }
}

type OpcodeInfo = [string, AddressingMode, number];

/** 6502オペコードテーブル (代表的な命令) */
const OPCODES: Record<number, OpcodeInfo> = {
  /* LDA */
  0xA9: ['LDA', 'immediate', 2], 0xA5: ['LDA', 'zeroPage', 3], 0xB5: ['LDA', 'zeroPageX', 4],
  0xAD: ['LDA', 'absolute', 4], 0xBD: ['LDA', 'absoluteX', 4], 0xB9: ['LDA', 'absoluteY', 4],
  0xA1: ['LDA', 'indirectX', 6], 0xB1: ['LDA', 'indirectY', 5],
  /* LDX */
  0xA2: ['LDX', 'immediate', 2], 0xA6: ['LDX', 'zeroPage', 3], 0xB6: ['LDX', 'zeroPageY', 4],
  0xAE: ['LDX', 'absolute', 4], 0xBE: ['LDX', 'absoluteY', 4],
  /* LDY */
  0xA0: ['LDY', 'immediate', 2], 0xA4: ['LDY', 'zeroPage', 3], 0xB4: ['LDY', 'zeroPageX', 4],
  0xAC: ['LDY', 'absolute', 4], 0xBC: ['LDY', 'absoluteX', 4],
  /* STA */
  0x85: ['STA', 'zeroPage', 3], 0x95: ['STA', 'zeroPageX', 4], 0x8D: ['STA', 'absolute', 4],
  0x9D: ['STA', 'absoluteX', 5], 0x99: ['STA', 'absoluteY', 5],
  0x81: ['STA', 'indirectX', 6], 0x91: ['STA', 'indirectY', 6],
  /* STX / STY */
  0x86: ['STX', 'zeroPage', 3], 0x96: ['STX', 'zeroPageY', 4], 0x8E: ['STX', 'absolute', 4],
  0x84: ['STY', 'zeroPage', 3], 0x94: ['STY', 'zeroPageX', 4], 0x8C: ['STY', 'absolute', 4],
  /* ADC */
  0x69: ['ADC', 'immediate', 2], 0x65: ['ADC', 'zeroPage', 3], 0x75: ['ADC', 'zeroPageX', 4],
  0x6D: ['ADC', 'absolute', 4], 0x7D: ['ADC', 'absoluteX', 4], 0x79: ['ADC', 'absoluteY', 4],
  0x61: ['ADC', 'indirectX', 6], 0x71: ['ADC', 'indirectY', 5],
  /* SBC */
  0xE9: ['SBC', 'immediate', 2], 0xE5: ['SBC', 'zeroPage', 3], 0xF5: ['SBC', 'zeroPageX', 4],
  0xED: ['SBC', 'absolute', 4], 0xFD: ['SBC', 'absoluteX', 4], 0xF9: ['SBC', 'absoluteY', 4],
  0xE1: ['SBC', 'indirectX', 6], 0xF1: ['SBC', 'indirectY', 5],
  /* CMP */
  0xC9: ['CMP', 'immediate', 2], 0xC5: ['CMP', 'zeroPage', 3], 0xD5: ['CMP', 'zeroPageX', 4],
  0xCD: ['CMP', 'absolute', 4], 0xDD: ['CMP', 'absoluteX', 4], 0xD9: ['CMP', 'absoluteY', 4],
  0xC1: ['CMP', 'indirectX', 6], 0xD1: ['CMP', 'indirectY', 5],
  /* CPX / CPY */
  0xE0: ['CPX', 'immediate', 2], 0xE4: ['CPX', 'zeroPage', 3], 0xEC: ['CPX', 'absolute', 4],
  0xC0: ['CPY', 'immediate', 2], 0xC4: ['CPY', 'zeroPage', 3], 0xCC: ['CPY', 'absolute', 4],
  /* INC / DEC */
  0xE6: ['INC', 'zeroPage', 5], 0xF6: ['INC', 'zeroPageX', 6], 0xEE: ['INC', 'absolute', 6], 0xFE: ['INC', 'absoluteX', 7],
  0xC6: ['DEC', 'zeroPage', 5], 0xD6: ['DEC', 'zeroPageX', 6], 0xCE: ['DEC', 'absolute', 6], 0xDE: ['DEC', 'absoluteX', 7],
  /* INX/DEX/INY/DEY */
  0xE8: ['INX', 'implied', 2], 0xCA: ['DEX', 'implied', 2],
  0xC8: ['INY', 'implied', 2], 0x88: ['DEY', 'implied', 2],
  /* AND / ORA / EOR */
  0x29: ['AND', 'immediate', 2], 0x25: ['AND', 'zeroPage', 3], 0x2D: ['AND', 'absolute', 4],
  0x09: ['ORA', 'immediate', 2], 0x05: ['ORA', 'zeroPage', 3], 0x0D: ['ORA', 'absolute', 4],
  0x49: ['EOR', 'immediate', 2], 0x45: ['EOR', 'zeroPage', 3], 0x4D: ['EOR', 'absolute', 4],
  /* BIT */
  0x24: ['BIT', 'zeroPage', 3], 0x2C: ['BIT', 'absolute', 4],
  /* シフト/ローテート */
  0x0A: ['ASL', 'accumulator', 2], 0x06: ['ASL', 'zeroPage', 5], 0x0E: ['ASL', 'absolute', 6],
  0x4A: ['LSR', 'accumulator', 2], 0x46: ['LSR', 'zeroPage', 5], 0x4E: ['LSR', 'absolute', 6],
  0x2A: ['ROL', 'accumulator', 2], 0x26: ['ROL', 'zeroPage', 5], 0x2E: ['ROL', 'absolute', 6],
  0x6A: ['ROR', 'accumulator', 2], 0x66: ['ROR', 'zeroPage', 5], 0x6E: ['ROR', 'absolute', 6],
  /* 分岐 */
  0x90: ['BCC', 'relative', 2], 0xB0: ['BCS', 'relative', 2],
  0xF0: ['BEQ', 'relative', 2], 0xD0: ['BNE', 'relative', 2],
  0x30: ['BMI', 'relative', 2], 0x10: ['BPL', 'relative', 2],
  0x70: ['BVS', 'relative', 2], 0x50: ['BVC', 'relative', 2],
  /* ジャンプ / サブルーチン */
  0x4C: ['JMP', 'absolute', 3], 0x6C: ['JMP', 'indirect', 5],
  0x20: ['JSR', 'absolute', 6], 0x60: ['RTS', 'implied', 6], 0x40: ['RTI', 'implied', 6],
  /* スタック */
  0x48: ['PHA', 'implied', 3], 0x68: ['PLA', 'implied', 4],
  0x08: ['PHP', 'implied', 3], 0x28: ['PLP', 'implied', 4],
  /* フラグ */
  0x18: ['CLC', 'implied', 2], 0x38: ['SEC', 'implied', 2],
  0x58: ['CLI', 'implied', 2], 0x78: ['SEI', 'implied', 2],
  0xB8: ['CLV', 'implied', 2], 0xD8: ['CLD', 'implied', 2], 0xF8: ['SED', 'implied', 2],
  /* 転送 */
  0xAA: ['TAX', 'implied', 2], 0xA8: ['TAY', 'implied', 2],
  0x8A: ['TXA', 'implied', 2], 0x98: ['TYA', 'implied', 2],
  0x9A: ['TXS', 'implied', 2], 0xBA: ['TSX', 'implied', 2],
  /* NOP / BRK */
  0xEA: ['NOP', 'implied', 2], 0x00: ['BRK', 'implied', 7],
  /* STP (非公式: テスト用停止) */
  0xDB: ['STP', 'implied', 1],
};

/* ================================================================
   ユーティリティ
   ================================================================ */

export function hex2(n: number): string { return (n & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
export function hex4(n: number): string { return (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
