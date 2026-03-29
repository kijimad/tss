/**
 * vfs.ts -- 仮想ファイルシステム (Vite のディスク)
 *
 * Vite はファイルシステム上のプロジェクトを読む。
 * ここではメモリ上に仮想プロジェクトを構築する。
 */

export interface VFile {
  path: string;
  content: string;
  lastModified: number;
}

export class VirtualFileSystem {
  private files = new Map<string, VFile>();

  writeFile(path: string, content: string): void {
    this.files.set(norm(path), { path: norm(path), content, lastModified: Date.now() });
  }

  readFile(path: string): string | undefined {
    return this.files.get(norm(path))?.content;
  }

  exists(path: string): boolean {
    return this.files.has(norm(path));
  }

  getFile(path: string): VFile | undefined {
    return this.files.get(norm(path));
  }

  listFiles(): VFile[] {
    return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  // ファイル更新 (HMR トリガー)
  updateFile(path: string, content: string): number {
    const ts = Date.now();
    this.files.set(norm(path), { path: norm(path), content, lastModified: ts });
    return ts;
  }

  deleteFile(path: string): boolean {
    return this.files.delete(norm(path));
  }
}

function norm(p: string): string {
  if (!p.startsWith("/")) return "/" + p;
  return p;
}
