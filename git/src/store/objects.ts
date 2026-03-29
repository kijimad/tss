/**
 * objects.ts -- Git オブジェクトストア
 *
 * Git の全データは3種類のオブジェクトで表現される:
 *
 *   blob   -- ファイルの中身（バイナリ）
 *   tree   -- ディレクトリ（名前 → blob/tree のマッピング）
 *   commit -- スナップショット（tree + 親コミット + メッセージ + 著者）
 *
 * 各オブジェクトは内容の SHA-1 ハッシュをキーにして格納される。
 * 同じ内容は同じハッシュになる = 内容アドレッシング（content-addressable storage）。
 *
 *   commit abc123
 *     ├── tree: def456
 *     │     ├── blob: 111  "README.md"
 *     │     ├── blob: 222  "index.js"
 *     │     └── tree: 333  "src/"
 *     │           └── blob: 444  "main.js"
 *     ├── parent: (前のコミット)
 *     ├── author: "Alice <alice@example.com>"
 *     └── message: "Initial commit"
 */

// オブジェクトの型
export type GitObject =
  | { type: "blob"; content: string }
  | { type: "tree"; entries: TreeEntry[] }
  | { type: "commit"; tree: string; parents: string[]; author: string; date: number; message: string };

export interface TreeEntry {
  mode: string;    // "100644" (file) or "040000" (directory)
  name: string;
  hash: string;    // オブジェクトのハッシュ
}

// SHA-1 ハッシュの簡易実装（ブラウザでは crypto.subtle が使えるが、簡易版で十分）
export function hash(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h = ((h << 5) - h + ch) | 0;
  }
  // 正の数にして16進数7桁
  const hex = (h >>> 0).toString(16).padStart(7, "0");
  // もう少し長くする
  let h2 = 0;
  for (let i = content.length - 1; i >= 0; i--) {
    const ch = content.charCodeAt(i);
    h2 = ((h2 << 7) - h2 + ch) | 0;
  }
  return hex + (h2 >>> 0).toString(16).padStart(7, "0");
}

// オブジェクトをシリアライズしてハッシュを計算
export function hashObject(obj: GitObject): string {
  return hash(serializeObject(obj));
}

function serializeObject(obj: GitObject): string {
  switch (obj.type) {
    case "blob":
      return `blob\0${obj.content}`;
    case "tree":
      return `tree\0${obj.entries.map(e => `${e.mode} ${e.name}\0${e.hash}`).join("\n")}`;
    case "commit":
      return `commit\0tree ${obj.tree}\n${obj.parents.map(p => `parent ${p}`).join("\n")}${obj.parents.length > 0 ? "\n" : ""}author ${obj.author} ${String(obj.date)}\n\n${obj.message}`;
  }
}

// オブジェクトデータベース
export class ObjectStore {
  private objects = new Map<string, GitObject>();

  // オブジェクトを格納し、ハッシュを返す
  store(obj: GitObject): string {
    const h = hashObject(obj);
    this.objects.set(h, obj);
    return h;
  }

  // ハッシュからオブジェクトを取得
  get(h: string): GitObject | undefined {
    return this.objects.get(h);
  }

  has(h: string): boolean {
    return this.objects.has(h);
  }

  // 全オブジェクト
  all(): { hash: string; object: GitObject }[] {
    const result: { hash: string; object: GitObject }[] = [];
    for (const [h, obj] of this.objects) {
      result.push({ hash: h, object: obj });
    }
    return result;
  }
}
