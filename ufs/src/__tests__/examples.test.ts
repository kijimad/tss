import { describe, it, expect, beforeEach } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { BlockDevice } from "../hw/disk.js";
import { UnixFS } from "../fs/filesystem.js";

/** サポートされているコマンド一覧 */
const SUPPORTED_COMMANDS = [
  "ls", "cat", "echo", "mkdir", "touch",
  "write", "rm", "stat", "cd", "pwd", "df", "clear", "help",
];

describe("EXAMPLES 配列", () => {
  it("少なくとも1つのサンプルが存在する", () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it("各サンプルに名前とコマンドがある", () => {
    for (const example of EXAMPLES) {
      expect(example.name).toBeTruthy();
      expect(example.commands.length).toBeGreaterThan(0);
    }
  });

  it("全コマンドがサポートされたコマンドで始まる", () => {
    for (const example of EXAMPLES) {
      for (const cmd of example.commands) {
        const first = cmd.split(/\s+/)[0];
        expect(
          SUPPORTED_COMMANDS.includes(first!),
          `未対応コマンド "${first}" がサンプル "${example.name}" に含まれている`,
        ).toBe(true);
      }
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("EXAMPLES コマンドの実行", () => {
  let disk: BlockDevice;
  let fs: UnixFS;

  /** パスを解決するヘルパー */
  const resolve = (cwd: string, p: string | undefined): string => {
    if (p === undefined) return cwd;
    if (p.startsWith("/")) return p;
    if (cwd === "/") return "/" + p;
    return cwd + "/" + p;
  };

  /** 簡易コマンド実行: ファイルシステム操作のみ行い例外が出ないことを確認する */
  const executeCmd = (input: string, cwdRef: { value: string }): void => {
    const parts = input.split(/\s+/);
    const cmd = parts[0] ?? "";
    const args = parts.slice(1);
    const arg0 = args[0];

    switch (cmd) {
      case "ls": fs.readdir(resolve(cwdRef.value, arg0)); break;
      case "cat": if (arg0) fs.readTextFile(resolve(cwdRef.value, arg0)); break;
      case "echo": break;
      case "mkdir": if (arg0) fs.mkdir(resolve(cwdRef.value, arg0)); break;
      case "touch": {
        if (arg0) {
          const p = resolve(cwdRef.value, arg0);
          if (!fs.exists(p)) fs.createFile(p);
        }
        break;
      }
      case "write":
        if (arg0) fs.writeFile(resolve(cwdRef.value, arg0), args.slice(1).join(" ") + "\n");
        break;
      case "rm": if (arg0) fs.unlink(resolve(cwdRef.value, arg0)); break;
      case "stat": if (arg0) fs.stat(resolve(cwdRef.value, arg0)); break;
      case "cd": {
        if (arg0 === undefined || arg0 === "/") { cwdRef.value = "/"; break; }
        if (arg0 === "..") {
          const p = cwdRef.value.split("/").filter((s) => s.length > 0);
          p.pop();
          cwdRef.value = p.length === 0 ? "/" : "/" + p.join("/");
          break;
        }
        cwdRef.value = resolve(cwdRef.value, arg0);
        break;
      }
      case "pwd": break;
      case "df": fs.getSuperBlock(); break;
      case "clear": break;
      case "help": break;
      default: throw new Error(`未対応コマンド: ${cmd}`);
    }
  };

  beforeEach(() => {
    disk = new BlockDevice();
    fs = new UnixFS(disk);
    fs.format();
    // 初期ディレクトリ（app.ts と同じ構成）
    fs.mkdir("/bin");
    fs.mkdir("/home");
    fs.mkdir("/tmp");
    fs.mkdir("/etc");
  });

  for (const example of EXAMPLES) {
    it(`"${example.name}" のコマンドがエラーなく実行できる`, () => {
      const cwdRef = { value: "/" };
      for (const cmd of example.commands) {
        expect(() => executeCmd(cmd, cwdRef)).not.toThrow();
      }
    });
  }
});
