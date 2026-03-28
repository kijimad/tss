/**
 * memory.ts — RAM エミュレーション
 *
 * 64KB のフラットメモリ空間。バイト・ワード（16ビット）単位でアクセスできる。
 * CPU とカーネルがアドレス指定でデータを読み書きする。
 *
 * メモリマップ:
 *   0x0000 - 0x00FF  割り込みベクタテーブル (256B)
 *   0x0100 - 0x3FFF  カーネル領域 (~16KB)
 *   0x4000 - 0xEFFF  ユーザ空間 (~44KB)
 *   0xF000 - 0xFFFF  スタック領域 (4KB)
 */
import { MEMORY_SIZE, type HwEvent } from "./types.js";

export class Memory {
  private data: Uint8Array;
  onEvent: ((event: HwEvent) => void) | undefined;
  private startTime = performance.now();

  constructor() {
    this.data = new Uint8Array(MEMORY_SIZE);
  }

  // 1バイト読み取り
  readByte(address: number): number {
    const value = this.data[address & 0xFFFF] ?? 0;
    return value;
  }

  // 1バイト書き込み
  writeByte(address: number, value: number): void {
    this.data[address & 0xFFFF] = value & 0xFF;
  }

  // 16ビットワード読み取り（リトルエンディアン）
  readWord(address: number): number {
    const lo = this.readByte(address);
    const hi = this.readByte(address + 1);
    const value = (hi << 8) | lo;
    this.onEvent?.({
      type: "mem_read", address: address & 0xFFFF, value,
      timestamp: performance.now() - this.startTime,
    });
    return value;
  }

  // 16ビットワード書き込み（リトルエンディアン）
  writeWord(address: number, value: number): void {
    this.writeByte(address, value & 0xFF);
    this.writeByte(address + 1, (value >> 8) & 0xFF);
    this.onEvent?.({
      type: "mem_write", address: address & 0xFFFF, value: value & 0xFFFF,
      timestamp: performance.now() - this.startTime,
    });
  }

  // メモリ領域にバイト列をロード（プログラムや初期データの配置用）
  loadBytes(address: number, bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b !== undefined) {
        this.data[(address + i) & 0xFFFF] = b;
      }
    }
  }

  // メモリダンプ（デバッグ用）
  dump(start: number, length: number): Uint8Array {
    return this.data.slice(start & 0xFFFF, (start + length) & 0xFFFF);
  }

  // メモリ全体をリセット
  reset(): void {
    this.data.fill(0);
  }

  // 開始時間をリセット
  resetTime(): void {
    this.startTime = performance.now();
  }
}
