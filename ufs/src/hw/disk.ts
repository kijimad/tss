/**
 * disk.ts -- ブロックデバイス（仮想ディスク）
 *
 * 実際のHDD/SSDと同じインターフェースで、固定サイズのブロック単位で読み書きする。
 * ファイルシステムはこのブロックデバイスの上に構築される。
 *
 * ディスクレイアウト:
 *   Block 0:         スーパーブロック（ファイルシステムのメタデータ）
 *   Block 1:         inode ビットマップ（どの inode が使用中か）
 *   Block 2:         データブロックビットマップ（どのブロックが使用中か）
 *   Block 3..34:     inode テーブル（32ブロック = 512個の inode）
 *   Block 35..2047:  データブロック（実際のファイル内容）
 */

export const BLOCK_SIZE = 512;
export const TOTAL_BLOCKS = 2048;   // 1MB ディスク
export const INODE_TABLE_START = 3;
export const INODE_TABLE_BLOCKS = 32;
export const DATA_BLOCK_START = INODE_TABLE_START + INODE_TABLE_BLOCKS; // 35
export const MAX_INODES = 512;

// トレースイベント
export type DiskEvent =
  | { type: "read"; block: number; timestamp: number }
  | { type: "write"; block: number; timestamp: number }
  | { type: "format"; timestamp: number };

export class BlockDevice {
  private blocks: Uint8Array[];
  events: DiskEvent[] = [];
  onEvent: ((event: DiskEvent) => void) | undefined;
  private startTime = performance.now();

  constructor() {
    this.blocks = [];
    for (let i = 0; i < TOTAL_BLOCKS; i++) {
      this.blocks.push(new Uint8Array(BLOCK_SIZE));
    }
  }

  readBlock(blockNum: number): Uint8Array {
    if (blockNum < 0 || blockNum >= TOTAL_BLOCKS) {
      throw new Error(`不正なブロック番号: ${String(blockNum)}`);
    }
    const event: DiskEvent = { type: "read", block: blockNum, timestamp: performance.now() - this.startTime };
    this.events.push(event);
    this.onEvent?.(event);
    const block = this.blocks[blockNum];
    if (block === undefined) throw new Error(`ブロック ${String(blockNum)} 未初期化`);
    return block.slice();
  }

  writeBlock(blockNum: number, data: Uint8Array): void {
    if (blockNum < 0 || blockNum >= TOTAL_BLOCKS) {
      throw new Error(`不正なブロック番号: ${String(blockNum)}`);
    }
    if (data.length !== BLOCK_SIZE) {
      throw new Error(`データサイズ不正: ${String(data.length)} (期待: ${String(BLOCK_SIZE)})`);
    }
    const event: DiskEvent = { type: "write", block: blockNum, timestamp: performance.now() - this.startTime };
    this.events.push(event);
    this.onEvent?.(event);
    const block = this.blocks[blockNum];
    if (block === undefined) throw new Error(`ブロック ${String(blockNum)} 未初期化`);
    block.set(data);
  }

  // ブロックの一部だけ読み書き（inode 操作用）
  readBytes(blockNum: number, offset: number, length: number): Uint8Array {
    const block = this.readBlock(blockNum);
    return block.slice(offset, offset + length);
  }

  writeBytes(blockNum: number, offset: number, data: Uint8Array): void {
    const block = this.readBlock(blockNum);
    block.set(data, offset);
    this.writeBlock(blockNum, block);
  }

  resetEvents(): void {
    this.events = [];
    this.startTime = performance.now();
  }

  getBlockCount(): number { return TOTAL_BLOCKS; }
  getBlockSize(): number { return BLOCK_SIZE; }
}
