/**
 * types.ts -- ファイルシステムの型定義
 *
 * Unix ファイルシステムの基本構造:
 *
 *   スーパーブロック: FS 全体のメタデータ
 *   inode:           ファイル/ディレクトリのメタデータ（名前は含まない！）
 *   ディレクトリエントリ: 名前 → inode 番号 のマッピング
 *   データブロック:   ファイルの実データ
 *
 *   重要: Unix では「ファイル名」は inode ではなくディレクトリに属する。
 *   1つの inode に複数の名前（ハードリンク）が可能。
 */

// スーパーブロック（ブロック0に格納）
export interface SuperBlock {
  magic: number;           // 0x0F5F（マジックナンバー）
  blockSize: number;
  totalBlocks: number;
  totalInodes: number;
  freeBlocks: number;
  freeInodes: number;
  rootInode: number;       // ルートディレクトリの inode 番号（通常 0）
}

// inode（64バイト固定）
export interface Inode {
  mode: InodeMode;         // ファイル種別 + パーミッション
  size: number;            // ファイルサイズ（バイト）
  links: number;           // ハードリンク数
  uid: number;             // 所有者ID
  gid: number;             // グループID
  createdAt: number;       // 作成日時（ms）
  modifiedAt: number;      // 更新日時（ms）
  accessedAt: number;      // アクセス日時（ms）
  // データブロックポインタ（直接ブロック12個 + 間接ブロック1個）
  directBlocks: number[];  // [12] 各エントリはブロック番号（0=未使用）
  indirectBlock: number;   // 間接ブロック番号（0=未使用）
}

// ファイル種別
export const InodeMode = {
  File: 0o100000,
  Directory: 0o040000,
  Symlink: 0o120000,
} as const;

export type InodeMode = number; // mode にはパーミッションビットも含まれる

// パーミッションビット
export const Permission = {
  OwnerRead: 0o400,
  OwnerWrite: 0o200,
  OwnerExec: 0o100,
  GroupRead: 0o040,
  GroupWrite: 0o020,
  GroupExec: 0o010,
  OtherRead: 0o004,
  OtherWrite: 0o002,
  OtherExec: 0o001,
} as const;

// ディレクトリエントリ（32バイト固定）
// [inodeNumber: u32 (4B)] [nameLength: u8 (1B)] [name: 27B]
export interface DirEntry {
  inode: number;           // inode 番号
  name: string;            // ファイル/ディレクトリ名（最大27文字）
}

// inode のシリアライズサイズ
export const INODE_SIZE = 64;
// ディレクトリエントリのサイズ
export const DIRENT_SIZE = 32;
// 直接ブロック数
export const DIRECT_BLOCKS = 12;
// マジックナンバー
export const FS_MAGIC = 0x0F5F;

// FS イベント（トレース用）
export type FsEvent =
  | { type: "inode_alloc"; inodeNum: number; mode: string }
  | { type: "inode_free"; inodeNum: number }
  | { type: "block_alloc"; blockNum: number }
  | { type: "block_free"; blockNum: number }
  | { type: "dir_add"; parentInode: number; name: string; childInode: number }
  | { type: "dir_remove"; parentInode: number; name: string }
  | { type: "file_write"; inodeNum: number; offset: number; size: number }
  | { type: "file_read"; inodeNum: number; offset: number; size: number }
  | { type: "path_resolve"; path: string; inodeNum: number };
