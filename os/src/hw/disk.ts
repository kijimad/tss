/**
 * disk.ts — ブロックデバイス（ディスク）エミュレーション
 *
 * 512バイト × 1024ブロック = 512KB のディスク。
 * ブロック単位で読み書きする。実際のHDDやSSDと同じインターフェース。
 * データは IndexedDB に永続化することもできる（今はメモリ上）。
 */
import { BLOCK_SIZE, DISK_BLOCKS, type HwEvent } from "./types.js";

export class Disk {
  private blocks: Uint8Array[];
  onEvent: ((event: HwEvent) => void) | undefined;
  private startTime = performance.now();

  constructor() {
    // 全ブロックをゼロ初期化
    this.blocks = [];
    for (let i = 0; i < DISK_BLOCKS; i++) {
      this.blocks.push(new Uint8Array(BLOCK_SIZE));
    }
  }

  // ブロック読み取り
  readBlock(blockNum: number): Uint8Array {
    if (blockNum < 0 || blockNum >= DISK_BLOCKS) {
      throw new Error(`ディスク: 不正なブロック番号 ${String(blockNum)}`);
    }
    this.onEvent?.({
      type: "disk_read", block: blockNum,
      timestamp: performance.now() - this.startTime,
    });
    const block = this.blocks[blockNum];
    if (block === undefined) throw new Error(`ディスク: ブロック ${String(blockNum)} が未初期化`);
    // コピーを返す
    return block.slice();
  }

  // ブロック書き込み
  writeBlock(blockNum: number, data: Uint8Array): void {
    if (blockNum < 0 || blockNum >= DISK_BLOCKS) {
      throw new Error(`ディスク: 不正なブロック番号 ${String(blockNum)}`);
    }
    if (data.length !== BLOCK_SIZE) {
      throw new Error(`ディスク: データサイズが ${String(BLOCK_SIZE)} バイトではありません (${String(data.length)})`);
    }
    this.onEvent?.({
      type: "disk_write", block: blockNum,
      timestamp: performance.now() - this.startTime,
    });
    const block = this.blocks[blockNum];
    if (block === undefined) throw new Error(`ディスク: ブロック ${String(blockNum)} が未初期化`);
    block.set(data);
  }

  // ブロック数
  getBlockCount(): number {
    return DISK_BLOCKS;
  }

  // ブロックサイズ
  getBlockSize(): number {
    return BLOCK_SIZE;
  }

  resetTime(): void {
    this.startTime = performance.now();
  }
}
