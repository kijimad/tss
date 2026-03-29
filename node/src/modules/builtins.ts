/**
 * builtins.ts -- Node.js 組み込みモジュール
 *
 * console, fs, path, events, process をエミュレートする。
 * 実際の Node.js と同じ API を提供するが、裏でイベントループと仮想 FS を使う。
 */
import type { EventLoop } from "../runtime/event-loop.js";

// === 仮想ファイルシステム（メモリ上）===
export class VirtualFS {
  private files = new Map<string, string>();

  constructor() {
    // 初期ファイル
    this.files.set("/hello.txt", "Hello from virtual FS!\n");
    this.files.set("/data.json", '{"name":"node-sim","version":"0.1.0"}\n');
    this.files.set("/numbers.txt", "1\n2\n3\n4\n5\n");
  }

  readFileSync(path: string): string {
    const content = this.files.get(normalizePath(path));
    if (content === undefined) throw new Error(`ENOENT: no such file or directory '${path}'`);
    return content;
  }

  writeFileSync(path: string, content: string): void {
    this.files.set(normalizePath(path), content);
  }

  existsSync(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  unlinkSync(path: string): void {
    if (!this.files.delete(normalizePath(path))) {
      throw new Error(`ENOENT: no such file or directory '${path}'`);
    }
  }

  readdirSync(path: string): string[] {
    const dir = normalizePath(path);
    const prefix = dir === "/" ? "/" : dir + "/";
    const result: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name !== undefined && name.length > 0 && !result.includes(name)) {
          result.push(name);
        }
      }
    }
    return result;
  }

  // 非同期版（イベントループ経由）
  readFile(path: string, loop: EventLoop, callback: (err: Error | null, data: string | null) => void): void {
    // I/O を非同期シミュレーション（次の tick で完了）
    loop.enqueuePendingCallback(() => {
      try {
        const content = this.readFileSync(path);
        callback(null, content);
      } catch (e) {
        callback(e instanceof Error ? e : new Error(String(e)), null);
      }
    }, `fs.readFile('${path}')`);
  }

  writeFile(path: string, content: string, loop: EventLoop, callback: (err: Error | null) => void): void {
    loop.enqueuePendingCallback(() => {
      try {
        this.writeFileSync(path, content);
        callback(null);
      } catch (e) {
        callback(e instanceof Error ? e : new Error(String(e)));
      }
    }, `fs.writeFile('${path}')`);
  }

  getAllFiles(): { path: string; size: number }[] {
    const result: { path: string; size: number }[] = [];
    for (const [path, content] of this.files) {
      result.push({ path, size: content.length });
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
}

// === EventEmitter ===
export class EventEmitter {
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event);
    if (list !== undefined) {
      list.push(listener);
    } else {
      this.listeners.set(event, [listener]);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const list = this.listeners.get(event);
    if (list === undefined || list.length === 0) return false;
    for (const listener of list) {
      listener(...args);
    }
    return true;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event);
    if (list !== undefined) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

// === path モジュール ===
export const pathModule = {
  join(...parts: string[]): string {
    return normalizePath(parts.join("/"));
  },
  basename(p: string): string {
    const parts = p.split("/").filter(s => s.length > 0);
    return parts[parts.length - 1] ?? "";
  },
  dirname(p: string): string {
    const parts = p.split("/").filter(s => s.length > 0);
    parts.pop();
    return parts.length === 0 ? "/" : "/" + parts.join("/");
  },
  extname(p: string): string {
    const base = pathModule.basename(p);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot) : "";
  },
};

function normalizePath(path: string): string {
  const parts = path.split("/").filter(s => s.length > 0);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return "/" + resolved.join("/");
}
