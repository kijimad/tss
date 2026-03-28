/**
 * filesystem.ts — シンプルなファイルシステム
 *
 * ディスク上にファイルとディレクトリを管理する。
 * Unix風のツリー構造で、パスは "/" 区切り。
 *
 * 構造:
 *   / (ルート)
 *   ├── bin/       実行可能プログラム
 *   ├── home/      ユーザディレクトリ
 *   ├── tmp/       一時ファイル
 *   └── etc/       設定ファイル
 *
 * 簡易実装: ディスクブロックではなくメモリ上の木構造で管理する。
 * （ディスクはバッキングストアとして将来的に使う）
 */

// ファイル種別
export const FileType = {
  File: "file",
  Directory: "directory",
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];

// inode（ファイルのメタデータ）
export interface Inode {
  id: number;
  type: FileType;
  name: string;
  // ファイルの場合: 内容
  content: Uint8Array;
  // ディレクトリの場合: 子ノード
  children: Map<string, Inode>;
  // メタデータ
  size: number;
  createdAt: number;
  modifiedAt: number;
  // パーミッション（簡易）
  readable: boolean;
  writable: boolean;
  executable: boolean;
}

export class FileSystem {
  private root: Inode;
  private nextInodeId = 1;

  constructor() {
    this.root = this.createInode("", FileType.Directory);
    // 初期ディレクトリ作成
    this.mkdir("/bin");
    this.mkdir("/home");
    this.mkdir("/tmp");
    this.mkdir("/etc");
  }

  // ファイル/ディレクトリ作成ヘルパー
  private createInode(name: string, type: FileType): Inode {
    return {
      id: this.nextInodeId++,
      type,
      name,
      content: new Uint8Array(0),
      children: new Map(),
      size: 0,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      readable: true,
      writable: true,
      executable: type === FileType.Directory,
    };
  }

  // パスから inode を探す
  private resolve(path: string): Inode | undefined {
    if (path === "/") return this.root;

    const parts = path.split("/").filter(p => p.length > 0);
    let current = this.root;
    for (const part of parts) {
      if (current.type !== FileType.Directory) return undefined;
      const child = current.children.get(part);
      if (child === undefined) return undefined;
      current = child;
    }
    return current;
  }

  // 親ディレクトリの inode と最後のパス要素を返す
  private resolveParent(path: string): { parent: Inode; name: string } | undefined {
    const parts = path.split("/").filter(p => p.length > 0);
    if (parts.length === 0) return undefined;

    const name = parts[parts.length - 1];
    if (name === undefined) return undefined;

    let current = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) return undefined;
      const child = current.children.get(part);
      if (child === undefined || child.type !== FileType.Directory) return undefined;
      current = child;
    }
    return { parent: current, name };
  }

  // ディレクトリ作成
  mkdir(path: string): boolean {
    const resolved = this.resolveParent(path);
    if (resolved === undefined) return false;

    if (resolved.parent.children.has(resolved.name)) return false; // 既に存在

    const dir = this.createInode(resolved.name, FileType.Directory);
    resolved.parent.children.set(resolved.name, dir);
    return true;
  }

  // ファイル作成/上書き
  writeFile(path: string, content: string | Uint8Array): boolean {
    const data = typeof content === "string"
      ? new TextEncoder().encode(content)
      : content;

    // 既存ファイルなら上書き
    const existing = this.resolve(path);
    if (existing !== undefined) {
      if (existing.type !== FileType.File) return false;
      existing.content = data;
      existing.size = data.length;
      existing.modifiedAt = Date.now();
      return true;
    }

    // 新規作成
    const resolved = this.resolveParent(path);
    if (resolved === undefined) return false;

    const file = this.createInode(resolved.name, FileType.File);
    file.content = data;
    file.size = data.length;
    resolved.parent.children.set(resolved.name, file);
    return true;
  }

  // ファイル読み取り
  readFile(path: string): Uint8Array | undefined {
    const inode = this.resolve(path);
    if (inode === undefined || inode.type !== FileType.File) return undefined;
    return inode.content;
  }

  // テキストファイル読み取り
  readTextFile(path: string): string | undefined {
    const data = this.readFile(path);
    if (data === undefined) return undefined;
    return new TextDecoder().decode(data);
  }

  // ディレクトリ一覧
  listDir(path: string): { name: string; type: FileType; size: number }[] | undefined {
    const inode = this.resolve(path);
    if (inode === undefined || inode.type !== FileType.Directory) return undefined;

    const entries: { name: string; type: FileType; size: number }[] = [];
    for (const [name, child] of inode.children) {
      entries.push({ name, type: child.type, size: child.size });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ファイル/ディレクトリ削除
  remove(path: string): boolean {
    const resolved = this.resolveParent(path);
    if (resolved === undefined) return false;

    const child = resolved.parent.children.get(resolved.name);
    if (child === undefined) return false;

    // ディレクトリが空でなければ削除不可
    if (child.type === FileType.Directory && child.children.size > 0) return false;

    resolved.parent.children.delete(resolved.name);
    return true;
  }

  // ファイル/ディレクトリが存在するか
  exists(path: string): boolean {
    return this.resolve(path) !== undefined;
  }

  // ファイル情報取得
  stat(path: string): { type: FileType; size: number; createdAt: number; modifiedAt: number } | undefined {
    const inode = this.resolve(path);
    if (inode === undefined) return undefined;
    return {
      type: inode.type,
      size: inode.size,
      createdAt: inode.createdAt,
      modifiedAt: inode.modifiedAt,
    };
  }
}
