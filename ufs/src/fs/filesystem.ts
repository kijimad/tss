/**
 * filesystem.ts -- Unix風ファイルシステム
 *
 * ブロックデバイスの上に inode ベースのファイルシステムを構築する。
 *
 * ディスクレイアウト:
 *   Block 0:     スーパーブロック
 *   Block 1:     inode ビットマップ (1bit = 1 inode、512B = 4096 inode 追跡可能)
 *   Block 2:     データブロックビットマップ (1bit = 1 block)
 *   Block 3..34: inode テーブル (各 inode 64B、1ブロックに8個、32ブロック=256個)
 *   Block 35..:  データブロック
 *
 * ディレクトリの中身:
 *   データブロックに DirEntry の配列が格納される。
 *   各 DirEntry = [inode番号(4B)][名前長(1B)][名前(27B)] = 32B
 *   1ブロックに 512/32 = 16エントリ
 */
import {
  type SuperBlock, type Inode, type DirEntry, type FsEvent,
  InodeMode, Permission,
  INODE_SIZE, DIRENT_SIZE, DIRECT_BLOCKS, FS_MAGIC,
} from "./types.js";
import {
  type BlockDevice,
  BLOCK_SIZE, TOTAL_BLOCKS, INODE_TABLE_START, INODE_TABLE_BLOCKS, DATA_BLOCK_START, MAX_INODES,
} from "../hw/disk.js";

const INODES_PER_BLOCK = Math.floor(BLOCK_SIZE / INODE_SIZE); // 8
const DIRENTS_PER_BLOCK = Math.floor(BLOCK_SIZE / DIRENT_SIZE); // 16
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export class UnixFS {
  private disk: BlockDevice;
  events: FsEvent[] = [];
  onEvent: ((event: FsEvent) => void) | undefined;

  constructor(disk: BlockDevice) {
    this.disk = disk;
  }

  private emit(event: FsEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  // === フォーマット（FS 初期化）===

  format(): void {
    // スーパーブロック書き込み
    const sb: SuperBlock = {
      magic: FS_MAGIC,
      blockSize: BLOCK_SIZE,
      totalBlocks: TOTAL_BLOCKS,
      totalInodes: MAX_INODES,
      freeBlocks: TOTAL_BLOCKS - DATA_BLOCK_START,
      freeInodes: MAX_INODES - 1, // inode 0 はルートで使う
      rootInode: 0,
    };
    this.writeSuperBlock(sb);

    // ビットマップ初期化
    const inodeBitmap = new Uint8Array(BLOCK_SIZE);
    inodeBitmap[0] = 0x01; // inode 0 を使用中に
    this.disk.writeBlock(1, inodeBitmap);

    const blockBitmap = new Uint8Array(BLOCK_SIZE);
    // ブロック 0..DATA_BLOCK_START-1 はシステム用で使用済み
    for (let i = 0; i < DATA_BLOCK_START; i++) {
      blockBitmap[Math.floor(i / 8)] |= (1 << (i % 8));
    }
    this.disk.writeBlock(2, blockBitmap);

    // ルート inode (inode 0) を作成
    const now = Date.now();
    const rootInode: Inode = {
      mode: InodeMode.Directory | Permission.OwnerRead | Permission.OwnerWrite | Permission.OwnerExec | Permission.OtherRead | Permission.OtherExec,
      size: 0,
      links: 2, // . と 親の .. (ルートは自身を指す)
      uid: 0, gid: 0,
      createdAt: now, modifiedAt: now, accessedAt: now,
      directBlocks: new Array(DIRECT_BLOCKS).fill(0),
      indirectBlock: 0,
    };
    this.writeInode(0, rootInode);

    // ルートディレクトリに . と .. を追加
    const dataBlock = this.allocBlock();
    rootInode.directBlocks[0] = dataBlock;
    rootInode.size = DIRENT_SIZE * 2;
    this.writeInode(0, rootInode);
    this.writeDirEntry(dataBlock, 0, { inode: 0, name: "." });
    this.writeDirEntry(dataBlock, 1, { inode: 0, name: ".." });
  }

  // === パス解決 ===

  resolvePath(path: string): number | undefined {
    if (path === "/") {
      this.emit({ type: "path_resolve", path, inodeNum: 0 });
      return 0;
    }

    const parts = path.split("/").filter(p => p.length > 0);
    let currentInode = 0; // ルートから開始

    for (const part of parts) {
      const inode = this.readInode(currentInode);
      if ((inode.mode & 0o170000) !== InodeMode.Directory) return undefined;

      const entry = this.findDirEntry(currentInode, part);
      if (entry === undefined) return undefined;
      currentInode = entry.inode;
    }

    this.emit({ type: "path_resolve", path, inodeNum: currentInode });
    return currentInode;
  }

  // 親ディレクトリの inode と最後の名前を返す
  private resolveParent(path: string): { parentInode: number; name: string } | undefined {
    const parts = path.split("/").filter(p => p.length > 0);
    if (parts.length === 0) return undefined;
    const name = parts[parts.length - 1];
    if (name === undefined) return undefined;

    const parentPath = "/" + parts.slice(0, -1).join("/");
    const parentInode = this.resolvePath(parentPath);
    if (parentInode === undefined) return undefined;
    return { parentInode, name };
  }

  // === ディレクトリ操作 ===

  mkdir(path: string): boolean {
    const resolved = this.resolveParent(path);
    if (resolved === undefined) return false;

    // 既に存在するか
    if (this.findDirEntry(resolved.parentInode, resolved.name) !== undefined) return false;

    // inode 割り当て
    const newInodeNum = this.allocInode();
    if (newInodeNum === undefined) return false;

    // データブロック割り当て（. と .. 用）
    const dataBlock = this.allocBlock();
    if (dataBlock === undefined) { this.freeInode(newInodeNum); return false; }

    // inode 初期化
    const now = Date.now();
    const newInode: Inode = {
      mode: InodeMode.Directory | 0o755,
      size: DIRENT_SIZE * 2,
      links: 2,
      uid: 0, gid: 0,
      createdAt: now, modifiedAt: now, accessedAt: now,
      directBlocks: new Array(DIRECT_BLOCKS).fill(0),
      indirectBlock: 0,
    };
    newInode.directBlocks[0] = dataBlock;
    this.writeInode(newInodeNum, newInode);

    // . と .. を書き込む
    this.writeDirEntry(dataBlock, 0, { inode: newInodeNum, name: "." });
    this.writeDirEntry(dataBlock, 1, { inode: resolved.parentInode, name: ".." });

    // 親ディレクトリにエントリ追加
    this.addDirEntry(resolved.parentInode, resolved.name, newInodeNum);

    // 親の links++
    const parentInode = this.readInode(resolved.parentInode);
    parentInode.links++;
    this.writeInode(resolved.parentInode, parentInode);

    this.emit({ type: "inode_alloc", inodeNum: newInodeNum, mode: "directory" });
    this.emit({ type: "dir_add", parentInode: resolved.parentInode, name: resolved.name, childInode: newInodeNum });
    return true;
  }

  readdir(path: string): DirEntry[] | undefined {
    const inodeNum = this.resolvePath(path);
    if (inodeNum === undefined) return undefined;
    const inode = this.readInode(inodeNum);
    if ((inode.mode & 0o170000) !== InodeMode.Directory) return undefined;
    return this.listDirEntries(inodeNum);
  }

  // === ファイル操作 ===

  createFile(path: string, content: string | Uint8Array = new Uint8Array(0)): boolean {
    const resolved = this.resolveParent(path);
    if (resolved === undefined) return false;
    if (this.findDirEntry(resolved.parentInode, resolved.name) !== undefined) return false;

    const data = typeof content === "string" ? ENCODER.encode(content) : content;

    const newInodeNum = this.allocInode();
    if (newInodeNum === undefined) return false;

    const now = Date.now();
    const newInode: Inode = {
      mode: InodeMode.File | 0o644,
      size: 0,
      links: 1,
      uid: 0, gid: 0,
      createdAt: now, modifiedAt: now, accessedAt: now,
      directBlocks: new Array(DIRECT_BLOCKS).fill(0),
      indirectBlock: 0,
    };
    this.writeInode(newInodeNum, newInode);

    // データ書き込み
    if (data.length > 0) {
      this.writeFileData(newInodeNum, data);
    }

    // 親にエントリ追加
    this.addDirEntry(resolved.parentInode, resolved.name, newInodeNum);

    this.emit({ type: "inode_alloc", inodeNum: newInodeNum, mode: "file" });
    this.emit({ type: "dir_add", parentInode: resolved.parentInode, name: resolved.name, childInode: newInodeNum });
    return true;
  }

  readFile(path: string): Uint8Array | undefined {
    const inodeNum = this.resolvePath(path);
    if (inodeNum === undefined) return undefined;
    const inode = this.readInode(inodeNum);
    if ((inode.mode & 0o170000) !== InodeMode.File) return undefined;
    this.emit({ type: "file_read", inodeNum, offset: 0, size: inode.size });
    return this.readFileData(inodeNum);
  }

  readTextFile(path: string): string | undefined {
    const data = this.readFile(path);
    if (data === undefined) return undefined;
    return DECODER.decode(data);
  }

  writeFile(path: string, content: string | Uint8Array): boolean {
    const data = typeof content === "string" ? ENCODER.encode(content) : content;
    const inodeNum = this.resolvePath(path);
    if (inodeNum === undefined) {
      // 新規作成
      return this.createFile(path, data);
    }
    // 既存ファイルを上書き
    this.writeFileData(inodeNum, data);
    this.emit({ type: "file_write", inodeNum, offset: 0, size: data.length });
    return true;
  }

  unlink(path: string): boolean {
    const resolved = this.resolveParent(path);
    if (resolved === undefined) return false;
    const entry = this.findDirEntry(resolved.parentInode, resolved.name);
    if (entry === undefined) return false;

    const inode = this.readInode(entry.inode);
    // ディレクトリが空でなければ削除不可
    if ((inode.mode & 0o170000) === InodeMode.Directory) {
      const entries = this.listDirEntries(entry.inode);
      const realEntries = entries.filter(e => e.name !== "." && e.name !== "..");
      if (realEntries.length > 0) return false;
    }

    // リンク数を減らす
    inode.links--;
    if (inode.links <= 0) {
      // データブロックを解放
      for (const block of inode.directBlocks) {
        if (block !== 0) this.freeBlock(block);
      }
      this.freeInode(entry.inode);
      this.emit({ type: "inode_free", inodeNum: entry.inode });
    } else {
      this.writeInode(entry.inode, inode);
    }

    // 親からエントリ削除
    this.removeDirEntry(resolved.parentInode, resolved.name);
    this.emit({ type: "dir_remove", parentInode: resolved.parentInode, name: resolved.name });
    return true;
  }

  // === stat ===

  stat(path: string): { inodeNum: number; inode: Inode } | undefined {
    const inodeNum = this.resolvePath(path);
    if (inodeNum === undefined) return undefined;
    return { inodeNum, inode: this.readInode(inodeNum) };
  }

  exists(path: string): boolean {
    return this.resolvePath(path) !== undefined;
  }

  getSuperBlock(): SuperBlock {
    return this.readSuperBlock();
  }

  // === inode テーブル操作 ===

  readInode(inodeNum: number): Inode {
    const blockIndex = INODE_TABLE_START + Math.floor(inodeNum / INODES_PER_BLOCK);
    const offset = (inodeNum % INODES_PER_BLOCK) * INODE_SIZE;
    const data = this.disk.readBytes(blockIndex, offset, INODE_SIZE);
    return deserializeInode(data);
  }

  private writeInode(inodeNum: number, inode: Inode): void {
    const blockIndex = INODE_TABLE_START + Math.floor(inodeNum / INODES_PER_BLOCK);
    const offset = (inodeNum % INODES_PER_BLOCK) * INODE_SIZE;
    this.disk.writeBytes(blockIndex, offset, serializeInode(inode));
  }

  // === ビットマップ操作 ===

  private allocInode(): number | undefined {
    const bitmap = this.disk.readBlock(1);
    for (let i = 0; i < MAX_INODES; i++) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      if (((bitmap[byteIdx] ?? 0) & (1 << bitIdx)) === 0) {
        bitmap[byteIdx] = (bitmap[byteIdx] ?? 0) | (1 << bitIdx);
        this.disk.writeBlock(1, bitmap);
        const sb = this.readSuperBlock();
        sb.freeInodes--;
        this.writeSuperBlock(sb);
        return i;
      }
    }
    return undefined;
  }

  private freeInode(inodeNum: number): void {
    const bitmap = this.disk.readBlock(1);
    const byteIdx = Math.floor(inodeNum / 8);
    const bitIdx = inodeNum % 8;
    bitmap[byteIdx] = (bitmap[byteIdx] ?? 0) & ~(1 << bitIdx);
    this.disk.writeBlock(1, bitmap);
    const sb = this.readSuperBlock();
    sb.freeInodes++;
    this.writeSuperBlock(sb);
  }

  private allocBlock(): number | undefined {
    const bitmap = this.disk.readBlock(2);
    for (let i = DATA_BLOCK_START; i < TOTAL_BLOCKS; i++) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      if (((bitmap[byteIdx] ?? 0) & (1 << bitIdx)) === 0) {
        bitmap[byteIdx] = (bitmap[byteIdx] ?? 0) | (1 << bitIdx);
        this.disk.writeBlock(2, bitmap);
        const sb = this.readSuperBlock();
        sb.freeBlocks--;
        this.writeSuperBlock(sb);
        this.emit({ type: "block_alloc", blockNum: i });
        // ゼロ初期化
        this.disk.writeBlock(i, new Uint8Array(BLOCK_SIZE));
        return i;
      }
    }
    return undefined;
  }

  private freeBlock(blockNum: number): void {
    const bitmap = this.disk.readBlock(2);
    const byteIdx = Math.floor(blockNum / 8);
    const bitIdx = blockNum % 8;
    bitmap[byteIdx] = (bitmap[byteIdx] ?? 0) & ~(1 << bitIdx);
    this.disk.writeBlock(2, bitmap);
    const sb = this.readSuperBlock();
    sb.freeBlocks++;
    this.writeSuperBlock(sb);
    this.emit({ type: "block_free", blockNum });
  }

  // === ディレクトリエントリ操作 ===

  private findDirEntry(inodeNum: number, name: string): DirEntry | undefined {
    const entries = this.listDirEntries(inodeNum);
    return entries.find(e => e.name === name);
  }

  private listDirEntries(inodeNum: number): DirEntry[] {
    const inode = this.readInode(inodeNum);
    const entries: DirEntry[] = [];
    const numEntries = Math.floor(inode.size / DIRENT_SIZE);
    let remaining = numEntries;

    for (const blockNum of inode.directBlocks) {
      if (blockNum === 0 || remaining <= 0) break;
      const count = Math.min(remaining, DIRENTS_PER_BLOCK);
      for (let j = 0; j < count; j++) {
        const entry = this.readDirEntry(blockNum, j);
        if (entry.name.length > 0) {
          entries.push(entry);
        }
        remaining--;
      }
    }
    return entries;
  }

  private addDirEntry(parentInodeNum: number, name: string, childInodeNum: number): void {
    const parentInode = this.readInode(parentInodeNum);
    const numEntries = Math.floor(parentInode.size / DIRENT_SIZE);

    // 既存ブロックの空きスロットを探す
    let blockIdx = Math.floor(numEntries / DIRENTS_PER_BLOCK);
    let slotIdx = numEntries % DIRENTS_PER_BLOCK;

    // ブロックが必要なら割り当て
    if (blockIdx >= DIRECT_BLOCKS) return; // 上限
    if (parentInode.directBlocks[blockIdx] === 0) {
      const newBlock = this.allocBlock();
      if (newBlock === undefined) return;
      parentInode.directBlocks[blockIdx] = newBlock;
    }

    const blockNum = parentInode.directBlocks[blockIdx] ?? 0;
    this.writeDirEntry(blockNum, slotIdx, { inode: childInodeNum, name });

    parentInode.size += DIRENT_SIZE;
    parentInode.modifiedAt = Date.now();
    this.writeInode(parentInodeNum, parentInode);
  }

  private removeDirEntry(parentInodeNum: number, name: string): void {
    const parentInode = this.readInode(parentInodeNum);
    const numEntries = Math.floor(parentInode.size / DIRENT_SIZE);

    for (let i = 0; i < numEntries; i++) {
      const blockIdx = Math.floor(i / DIRENTS_PER_BLOCK);
      const slotIdx = i % DIRENTS_PER_BLOCK;
      const blockNum = parentInode.directBlocks[blockIdx] ?? 0;
      if (blockNum === 0) continue;

      const entry = this.readDirEntry(blockNum, slotIdx);
      if (entry.name === name) {
        // 最後のエントリと入れ替え
        const lastIdx = numEntries - 1;
        if (i !== lastIdx) {
          const lastBlockIdx = Math.floor(lastIdx / DIRENTS_PER_BLOCK);
          const lastSlotIdx = lastIdx % DIRENTS_PER_BLOCK;
          const lastBlockNum = parentInode.directBlocks[lastBlockIdx] ?? 0;
          const lastEntry = this.readDirEntry(lastBlockNum, lastSlotIdx);
          this.writeDirEntry(blockNum, slotIdx, lastEntry);
        }
        parentInode.size -= DIRENT_SIZE;
        parentInode.modifiedAt = Date.now();
        this.writeInode(parentInodeNum, parentInode);
        return;
      }
    }
  }

  private readDirEntry(blockNum: number, index: number): DirEntry {
    const offset = index * DIRENT_SIZE;
    const data = this.disk.readBytes(blockNum, offset, DIRENT_SIZE);
    const view = new DataView(data.buffer, data.byteOffset);
    const inodeNum = view.getUint32(0);
    const nameLen = data[4] ?? 0;
    const name = DECODER.decode(data.slice(5, 5 + nameLen));
    return { inode: inodeNum, name };
  }

  private writeDirEntry(blockNum: number, index: number, entry: DirEntry): void {
    const buf = new Uint8Array(DIRENT_SIZE);
    const view = new DataView(buf.buffer);
    view.setUint32(0, entry.inode);
    const nameBytes = ENCODER.encode(entry.name);
    buf[4] = nameBytes.length;
    buf.set(nameBytes.slice(0, 27), 5);
    this.disk.writeBytes(blockNum, index * DIRENT_SIZE, buf);
  }

  // === ファイルデータ読み書き ===

  private readFileData(inodeNum: number): Uint8Array {
    const inode = this.readInode(inodeNum);
    const result = new Uint8Array(inode.size);
    let offset = 0;

    for (const blockNum of inode.directBlocks) {
      if (blockNum === 0 || offset >= inode.size) break;
      const data = this.disk.readBlock(blockNum);
      const copyLen = Math.min(BLOCK_SIZE, inode.size - offset);
      result.set(data.slice(0, copyLen), offset);
      offset += copyLen;
    }
    return result;
  }

  private writeFileData(inodeNum: number, data: Uint8Array): void {
    const inode = this.readInode(inodeNum);
    let offset = 0;
    let blockIdx = 0;

    while (offset < data.length && blockIdx < DIRECT_BLOCKS) {
      if (inode.directBlocks[blockIdx] === 0) {
        const newBlock = this.allocBlock();
        if (newBlock === undefined) break;
        inode.directBlocks[blockIdx] = newBlock;
      }
      const blockNum = inode.directBlocks[blockIdx] ?? 0;
      const chunk = data.slice(offset, offset + BLOCK_SIZE);
      const padded = new Uint8Array(BLOCK_SIZE);
      padded.set(chunk);
      this.disk.writeBlock(blockNum, padded);
      offset += BLOCK_SIZE;
      blockIdx++;
    }

    inode.size = data.length;
    inode.modifiedAt = Date.now();
    this.writeInode(inodeNum, inode);
  }

  // === スーパーブロック ===

  private readSuperBlock(): SuperBlock {
    const data = this.disk.readBlock(0);
    const view = new DataView(data.buffer, data.byteOffset);
    return {
      magic: view.getUint32(0),
      blockSize: view.getUint32(4),
      totalBlocks: view.getUint32(8),
      totalInodes: view.getUint32(12),
      freeBlocks: view.getUint32(16),
      freeInodes: view.getUint32(20),
      rootInode: view.getUint32(24),
    };
  }

  private writeSuperBlock(sb: SuperBlock): void {
    const data = new Uint8Array(BLOCK_SIZE);
    const view = new DataView(data.buffer);
    view.setUint32(0, sb.magic);
    view.setUint32(4, sb.blockSize);
    view.setUint32(8, sb.totalBlocks);
    view.setUint32(12, sb.totalInodes);
    view.setUint32(16, sb.freeBlocks);
    view.setUint32(20, sb.freeInodes);
    view.setUint32(24, sb.rootInode);
    this.disk.writeBlock(0, data);
  }

  resetEvents(): void {
    this.events = [];
  }
}

// === inode シリアライズ ===

function serializeInode(inode: Inode): Uint8Array {
  const buf = new Uint8Array(INODE_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint16(0, inode.mode);
  view.setUint32(2, inode.size);
  view.setUint16(6, inode.links);
  view.setUint16(8, inode.uid);
  view.setUint16(10, inode.gid);
  // タイムスタンプを32ビットに切り詰め（秒単位）
  view.setUint32(12, Math.floor(inode.createdAt / 1000));
  view.setUint32(16, Math.floor(inode.modifiedAt / 1000));
  view.setUint32(20, Math.floor(inode.accessedAt / 1000));
  // 直接ブロック (12 * 2B = 24B)
  for (let i = 0; i < DIRECT_BLOCKS; i++) {
    view.setUint16(24 + i * 2, inode.directBlocks[i] ?? 0);
  }
  view.setUint16(48, inode.indirectBlock);
  return buf;
}

function deserializeInode(data: Uint8Array): Inode {
  const view = new DataView(data.buffer, data.byteOffset);
  const directBlocks: number[] = [];
  for (let i = 0; i < DIRECT_BLOCKS; i++) {
    directBlocks.push(view.getUint16(24 + i * 2));
  }
  return {
    mode: view.getUint16(0),
    size: view.getUint32(2),
    links: view.getUint16(6),
    uid: view.getUint16(8),
    gid: view.getUint16(10),
    createdAt: view.getUint32(12) * 1000,
    modifiedAt: view.getUint32(16) * 1000,
    accessedAt: view.getUint32(20) * 1000,
    directBlocks,
    indirectBlock: view.getUint16(48),
  };
}
