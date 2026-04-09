/**
 * gbalink.ts — GBA シリアル通信 (リンクケーブル) シミュレーション
 *
 * GBA の SIO (Serial I/O) ハードウェアをエミュレートする。
 *
 * 通信モード:
 *   Normal (8bit/32bit SPI) — 2台接続、マスタ↔スレーブ
 *   Multi-Player            — 最大4台接続、1マスタ+3スレーブ
 *   UART                    — 非同期シリアル (RS-232風)
 *
 * 物理層:
 *   SI (Serial In), SO (Serial Out), SD (Serial Data), SC (Serial Clock)
 *   の 4 ピンをリンクケーブルで接続。
 */

// ── SIO レジスタ ──

export interface SioRegisters {
  /** SIOCNT — Serial Control */
  SIOCNT: number;
  /** SIODATA8 / SIODATA32 / SIOMULTI0-3 */
  SIODATA: number;
  /** SIOMLT_SEND — マルチプレイヤー送信データ */
  SIOMLT_SEND: number;
  /** RCNT — 通信モード / GPIO */
  RCNT: number;
}

/** 通信モード */
export type LinkMode = "Normal8" | "Normal32" | "MultiPlayer" | "UART";

/** GBA 本体 */
export interface GbaUnit {
  id: number;
  name: string;
  role: "master" | "slave";
  registers: SioRegisters;
  /** 送信バッファ */
  txBuffer: number[];
  /** 受信バッファ */
  rxBuffer: number[];
  /** SIO 割り込みフラグ */
  irqPending: boolean;
}

// ── 物理ピン ──

export interface LinkPins {
  SI: number;
  SO: number;
  SD: number;
  SC: number;
}

// ── トレース ──

export interface LinkTrace {
  tick: number;
  phase: "reg_write" | "clock" | "transfer" | "irq" | "pin" | "sync" | "error" | "mode" | "handshake" | "data";
  unit: string;
  detail: string;
  /** バス上のビット列 (可視化用) */
  bits?: string;
}

// ── 転送結果 ──

export interface TransferResult {
  mode: LinkMode;
  trace: LinkTrace[];
  /** 各 GBA が受信したデータ */
  received: Map<string, number[]>;
  /** 転送にかかった tick 数 */
  totalTicks: number;
  /** 転送速度 */
  baudRate: string;
}

// ── リンクケーブル ──

export class LinkCable {
  units: GbaUnit[] = [];
  private tick = 0;

  /** GBA を接続する */
  connect(name: string, role: "master" | "slave"): GbaUnit {
    const unit: GbaUnit = {
      id: this.units.length,
      name,
      role,
      registers: { SIOCNT: 0, SIODATA: 0, SIOMLT_SEND: 0, RCNT: 0 },
      txBuffer: [],
      rxBuffer: [],
      irqPending: false,
    };
    this.units.push(unit);
    return unit;
  }

  /** Normal モード (8bit) で転送を実行する */
  transferNormal8(masterData: number[], slaveData: number[]): TransferResult {
    const trace: LinkTrace[] = [];
    this.tick = 0;
    const master = this.units.find((u) => u.role === "master");
    const slave = this.units.find((u) => u.role === "slave");
    if (master === undefined || slave === undefined) {
      trace.push({ tick: 0, phase: "error", unit: "-", detail: "マスタとスレーブの両方が必要" });
      return { mode: "Normal8", trace, received: new Map(), totalTicks: 0, baudRate: "0" };
    }

    // モード設定
    trace.push({ tick: this.tick, phase: "mode", unit: master.name, detail: "SIOCNT = 0x0000 (Normal 8-bit, Internal Clock)" });
    trace.push({ tick: this.tick, phase: "mode", unit: slave.name, detail: "SIOCNT = 0x0000 (Normal 8-bit, External Clock)" });
    master.registers.SIOCNT = 0x0001; // Internal clock
    slave.registers.SIOCNT = 0x0000;  // External clock

    const masterRx: number[] = [];
    const slaveRx: number[] = [];

    const len = Math.max(masterData.length, slaveData.length);
    for (let i = 0; i < len; i++) {
      const mByte = masterData[i] ?? 0xFF;
      const sByte = slaveData[i] ?? 0xFF;
      this.tick++;

      // マスタがデータをセット
      master.registers.SIODATA = mByte;
      slave.registers.SIODATA = sByte;
      trace.push({ tick: this.tick, phase: "reg_write", unit: master.name, detail: `SIODATA8 = 0x${mByte.toString(16).padStart(2, "0")}` });
      trace.push({ tick: this.tick, phase: "reg_write", unit: slave.name, detail: `SIODATA8 = 0x${sByte.toString(16).padStart(2, "0")}` });

      // マスタがスタートビットをセット
      this.tick++;
      master.registers.SIOCNT |= 0x0080; // Start bit
      trace.push({ tick: this.tick, phase: "sync", unit: master.name, detail: "SIOCNT bit7 = 1 (転送開始)" });

      // クロック生成 → 8 bit shift
      this.tick++;
      const mBits = mByte.toString(2).padStart(8, "0");
      const sBits = sByte.toString(2).padStart(8, "0");
      trace.push({ tick: this.tick, phase: "clock", unit: master.name, detail: `SC: 内部クロック生成 (256kHz)` });

      for (let bit = 7; bit >= 0; bit--) {
        this.tick++;
        const mBit = (mByte >> bit) & 1;
        const sBit = (sByte >> bit) & 1;
        trace.push({
          tick: this.tick, phase: "pin", unit: "cable",
          detail: `bit${bit}: Master SO→Slave SI = ${mBit}, Slave SO→Master SI = ${sBit}`,
          bits: `M:${mBits.slice(0, 8 - bit)}|S:${sBits.slice(0, 8 - bit)}`,
        });
      }

      // 転送完了
      this.tick++;
      master.registers.SIODATA = sByte;
      slave.registers.SIODATA = mByte;
      masterRx.push(sByte);
      slaveRx.push(mByte);

      trace.push({ tick: this.tick, phase: "transfer", unit: master.name, detail: `受信: 0x${sByte.toString(16).padStart(2, "0")} (from ${slave.name})` });
      trace.push({ tick: this.tick, phase: "transfer", unit: slave.name, detail: `受信: 0x${mByte.toString(16).padStart(2, "0")} (from ${master.name})` });

      // SIOCNT bit7 クリア + 割り込み
      master.registers.SIOCNT &= ~0x0080;
      master.irqPending = true;
      slave.irqPending = true;
      trace.push({ tick: this.tick, phase: "irq", unit: master.name, detail: "SIO IRQ 発生 (転送完了)" });
      trace.push({ tick: this.tick, phase: "irq", unit: slave.name, detail: "SIO IRQ 発生 (転送完了)" });
    }

    const received = new Map<string, number[]>();
    received.set(master.name, masterRx);
    received.set(slave.name, slaveRx);

    return { mode: "Normal8", trace, received, totalTicks: this.tick, baudRate: "256 kbps" };
  }

  /** Normal モード (32bit) で転送を実行する */
  transferNormal32(masterData: number[], slaveData: number[]): TransferResult {
    const trace: LinkTrace[] = [];
    this.tick = 0;
    const master = this.units.find((u) => u.role === "master");
    const slave = this.units.find((u) => u.role === "slave");
    if (master === undefined || slave === undefined) {
      trace.push({ tick: 0, phase: "error", unit: "-", detail: "マスタとスレーブの両方が必要" });
      return { mode: "Normal32", trace, received: new Map(), totalTicks: 0, baudRate: "0" };
    }

    trace.push({ tick: this.tick, phase: "mode", unit: master.name, detail: "SIOCNT = 0x1000 (Normal 32-bit, Internal Clock)" });
    trace.push({ tick: this.tick, phase: "mode", unit: slave.name, detail: "SIOCNT = 0x1000 (Normal 32-bit, External Clock)" });

    const masterRx: number[] = [];
    const slaveRx: number[] = [];

    const len = Math.max(masterData.length, slaveData.length);
    for (let i = 0; i < len; i++) {
      const mWord = masterData[i] ?? 0xFFFFFFFF;
      const sWord = slaveData[i] ?? 0xFFFFFFFF;
      this.tick++;

      trace.push({ tick: this.tick, phase: "reg_write", unit: master.name, detail: `SIODATA32 = 0x${mWord.toString(16).padStart(8, "0")}` });
      trace.push({ tick: this.tick, phase: "reg_write", unit: slave.name, detail: `SIODATA32 = 0x${sWord.toString(16).padStart(8, "0")}` });

      this.tick++;
      trace.push({ tick: this.tick, phase: "sync", unit: master.name, detail: "転送開始 (32 クロックサイクル)" });

      // 32 bit シフト (4バイト分のクロック)
      this.tick += 4;
      trace.push({ tick: this.tick, phase: "clock", unit: "cable", detail: `32-bit シフト完了 (${master.name} ↔ ${slave.name})`, bits: `0x${mWord.toString(16)} ↔ 0x${sWord.toString(16)}` });

      masterRx.push(sWord);
      slaveRx.push(mWord);
      trace.push({ tick: this.tick, phase: "transfer", unit: master.name, detail: `受信: 0x${sWord.toString(16).padStart(8, "0")}` });
      trace.push({ tick: this.tick, phase: "transfer", unit: slave.name, detail: `受信: 0x${mWord.toString(16).padStart(8, "0")}` });
      trace.push({ tick: this.tick, phase: "irq", unit: "both", detail: "SIO IRQ (32bit 転送完了)" });
    }

    const received = new Map<string, number[]>();
    received.set(master.name, masterRx);
    received.set(slave.name, slaveRx);
    return { mode: "Normal32", trace, received, totalTicks: this.tick, baudRate: "2 Mbps" };
  }

  /** Multi-Player モード (最大4台) で転送する */
  transferMulti(sendData: Map<string, number>): TransferResult {
    const trace: LinkTrace[] = [];
    this.tick = 0;
    const master = this.units.find((u) => u.role === "master");
    if (master === undefined) {
      trace.push({ tick: 0, phase: "error", unit: "-", detail: "マスタが必要" });
      return { mode: "MultiPlayer", trace, received: new Map(), totalTicks: 0, baudRate: "0" };
    }

    trace.push({ tick: this.tick, phase: "mode", unit: master.name, detail: `SIOCNT = 0x2000 (Multi-Player, ${this.units.length} 台接続)` });
    for (const u of this.units) {
      if (u.role === "slave") trace.push({ tick: this.tick, phase: "mode", unit: u.name, detail: `SIOCNT = 0x2000 (Multi-Player, Slave ID=${u.id})` });
    }

    // 各ユニットが SIOMLT_SEND にデータをセット
    this.tick++;
    for (const u of this.units) {
      const data = sendData.get(u.name) ?? 0xFFFF;
      u.registers.SIOMLT_SEND = data;
      trace.push({ tick: this.tick, phase: "reg_write", unit: u.name, detail: `SIOMLT_SEND = 0x${data.toString(16).padStart(4, "0")}` });
    }

    // マスタが転送開始
    this.tick++;
    trace.push({ tick: this.tick, phase: "sync", unit: master.name, detail: "SD (Start) = Low → 全スレーブに同期信号" });

    // 各スレーブの SC で ACK
    this.tick++;
    for (const u of this.units) {
      if (u.role === "slave") {
        trace.push({ tick: this.tick, phase: "handshake", unit: u.name, detail: `SC = Low (Ready 応答, ID=${u.id})` });
      }
    }

    // データ転送 (16bit × ユニット数)
    this.tick++;
    trace.push({ tick: this.tick, phase: "clock", unit: master.name, detail: `SC: クロック生成 (115.2 kbps), ${this.units.length} × 16bit = ${this.units.length * 16} bit` });

    // 全ユニットのデータを全ユニットにブロードキャスト
    this.tick += 2;
    const received = new Map<string, number[]>();
    for (const u of this.units) {
      const rxData: number[] = [];
      for (const sender of this.units) {
        const data = sendData.get(sender.name) ?? 0xFFFF;
        rxData.push(data);
      }
      received.set(u.name, rxData);
      const hexes = rxData.map((d) => `0x${d.toString(16).padStart(4, "0")}`).join(", ");
      trace.push({ tick: this.tick, phase: "data", unit: u.name, detail: `SIOMULTI0-${this.units.length - 1} = [${hexes}]` });
    }

    this.tick++;
    for (const u of this.units) {
      trace.push({ tick: this.tick, phase: "irq", unit: u.name, detail: "SIO IRQ (マルチプレイヤー転送完了)" });
    }

    return { mode: "MultiPlayer", trace, received, totalTicks: this.tick, baudRate: "115.2 kbps" };
  }

  /** UART モードで送信する */
  transferUart(senderName: string, data: number[], baudRate: 9600 | 38400 | 57600 | 115200 = 9600): TransferResult {
    const trace: LinkTrace[] = [];
    this.tick = 0;
    const sender = this.units.find((u) => u.name === senderName);
    const receiver = this.units.find((u) => u.name !== senderName);
    if (sender === undefined || receiver === undefined) {
      trace.push({ tick: 0, phase: "error", unit: "-", detail: "送信者と受信者が必要" });
      return { mode: "UART", trace, received: new Map(), totalTicks: 0, baudRate: "0" };
    }

    trace.push({ tick: this.tick, phase: "mode", unit: sender.name, detail: `SIOCNT = 0x3000 (UART, ${baudRate} baud, 8N1)` });
    trace.push({ tick: this.tick, phase: "mode", unit: receiver.name, detail: `SIOCNT = 0x3000 (UART, ${baudRate} baud, 8N1)` });

    const rxData: number[] = [];
    for (const byte of data) {
      this.tick++;
      // Start bit
      trace.push({ tick: this.tick, phase: "pin", unit: sender.name, detail: `SO = 0 (Start bit)`, bits: "0" });

      // 8 data bits (LSB first)
      this.tick++;
      const bits = byte.toString(2).padStart(8, "0").split("").reverse().join("");
      trace.push({ tick: this.tick, phase: "pin", unit: sender.name, detail: `SO = ${bits} (Data: 0x${byte.toString(16).padStart(2, "0")})`, bits });

      // Stop bit
      this.tick++;
      trace.push({ tick: this.tick, phase: "pin", unit: sender.name, detail: `SO = 1 (Stop bit)`, bits: "1" });

      rxData.push(byte);
      trace.push({ tick: this.tick, phase: "transfer", unit: receiver.name, detail: `SI 受信: 0x${byte.toString(16).padStart(2, "0")} ('${byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : "."}')` });

      // FIFO
      trace.push({ tick: this.tick, phase: "irq", unit: receiver.name, detail: `SIO IRQ (UART 受信 FIFO: ${rxData.length} byte)` });
    }

    const received = new Map<string, number[]>();
    received.set(receiver.name, rxData);
    return { mode: "UART", trace, received, totalTicks: this.tick, baudRate: `${baudRate} baud` };
  }
}
