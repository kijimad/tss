/**
 * shell.ts — コマンドラインシェル
 *
 * ユーザからのテキスト入力をコマンドとして解釈し、実行する。
 * カーネルの機能（プロセス管理、ファイルシステム）を使う。
 *
 * 組み込みコマンド:
 *   ls [path]       — ディレクトリ一覧
 *   cat <file>      — ファイル内容表示
 *   echo <text>     — テキスト表示
 *   mkdir <path>    — ディレクトリ作成
 *   touch <file>    — 空ファイル作成
 *   write <file> <text> — ファイルに書き込み
 *   rm <path>       — 削除
 *   ps              — プロセス一覧
 *   help            — ヘルプ
 *   clear           — 画面クリア
 *   pwd             — カレントディレクトリ表示
 *   cd <path>       — ディレクトリ移動
 *   run <program>   — プログラム実行
 *   uname           — システム情報
 */
import type { Kernel } from "../kernel/kernel.js";
import { FileType } from "../fs/filesystem.js";

export class Shell {
  private kernel: Kernel;
  private cwd = "/";
  // 出力コールバック
  onOutput: ((text: string) => void) | undefined;
  // クリアコールバック
  onClear: (() => void) | undefined;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  // コマンド文字列を実行
  execute(input: string): void {
    const trimmed = input.trim();
    if (trimmed === "") return;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0] ?? "";
    const args = parts.slice(1);

    switch (cmd) {
      case "ls": this.cmdLs(args[0]); break;
      case "cat": this.cmdCat(args[0]); break;
      case "echo": this.cmdEcho(args.join(" ")); break;
      case "mkdir": this.cmdMkdir(args[0]); break;
      case "touch": this.cmdTouch(args[0]); break;
      case "write": this.cmdWrite(args[0], args.slice(1).join(" ")); break;
      case "rm": this.cmdRm(args[0]); break;
      case "ps": this.cmdPs(); break;
      case "help": this.cmdHelp(); break;
      case "clear": this.onClear?.(); break;
      case "pwd": this.print(this.cwd + "\n"); break;
      case "cd": this.cmdCd(args[0]); break;
      case "run": this.cmdRun(args[0]); break;
      case "uname": this.cmdUname(); break;
      case "stat": this.cmdStat(args[0]); break;
      default:
        this.print(`${cmd}: command not found\n`);
    }
  }

  getPrompt(): string {
    return `${this.cwd}$ `;
  }

  private print(text: string): void {
    this.onOutput?.(text);
  }

  // パスを絶対パスに変換
  private resolvePath(path: string | undefined): string {
    if (path === undefined) return this.cwd;
    if (path.startsWith("/")) return path;
    if (this.cwd === "/") return "/" + path;
    return this.cwd + "/" + path;
  }

  // === コマンド実装 ===

  private cmdLs(path: string | undefined): void {
    const resolved = this.resolvePath(path);
    const entries = this.kernel.fs.listDir(resolved);
    if (entries === undefined) {
      this.print(`ls: ${resolved}: No such directory\n`);
      return;
    }
    if (entries.length === 0) {
      this.print("(empty)\n");
      return;
    }
    for (const entry of entries) {
      const suffix = entry.type === FileType.Directory ? "/" : "";
      const size = entry.type === FileType.File ? `  ${String(entry.size)}B` : "";
      this.print(`  ${entry.name}${suffix}${size}\n`);
    }
  }

  private cmdCat(path: string | undefined): void {
    if (path === undefined) { this.print("cat: missing file\n"); return; }
    const resolved = this.resolvePath(path);
    const content = this.kernel.fs.readTextFile(resolved);
    if (content === undefined) {
      this.print(`cat: ${resolved}: No such file\n`);
      return;
    }
    this.print(content);
    if (!content.endsWith("\n")) this.print("\n");
  }

  private cmdEcho(text: string): void {
    this.print(text + "\n");
  }

  private cmdMkdir(path: string | undefined): void {
    if (path === undefined) { this.print("mkdir: missing path\n"); return; }
    const resolved = this.resolvePath(path);
    if (!this.kernel.fs.mkdir(resolved)) {
      this.print(`mkdir: ${resolved}: failed\n`);
    }
  }

  private cmdTouch(path: string | undefined): void {
    if (path === undefined) { this.print("touch: missing file\n"); return; }
    const resolved = this.resolvePath(path);
    if (!this.kernel.fs.exists(resolved)) {
      this.kernel.fs.writeFile(resolved, "");
    }
  }

  private cmdWrite(path: string | undefined, text: string): void {
    if (path === undefined) { this.print("write: missing file\n"); return; }
    const resolved = this.resolvePath(path);
    this.kernel.fs.writeFile(resolved, text + "\n");
  }

  private cmdRm(path: string | undefined): void {
    if (path === undefined) { this.print("rm: missing path\n"); return; }
    const resolved = this.resolvePath(path);
    if (!this.kernel.fs.remove(resolved)) {
      this.print(`rm: ${resolved}: failed\n`);
    }
  }

  private cmdPs(): void {
    const procs = this.kernel.processTable.listAll();
    this.print("  PID  STATE        NAME\n");
    for (const p of procs) {
      const pid = String(p.pid).padStart(5);
      const state = p.state.padEnd(12);
      this.print(`${pid}  ${state} ${p.name}\n`);
    }
  }

  private cmdCd(path: string | undefined): void {
    if (path === undefined || path === "/") {
      this.cwd = "/";
      return;
    }
    if (path === "..") {
      const parts = this.cwd.split("/").filter(p => p.length > 0);
      parts.pop();
      this.cwd = parts.length === 0 ? "/" : "/" + parts.join("/");
      return;
    }
    const resolved = this.resolvePath(path);
    const stat = this.kernel.fs.stat(resolved);
    if (stat === undefined || stat.type !== FileType.Directory) {
      this.print(`cd: ${resolved}: No such directory\n`);
      return;
    }
    this.cwd = resolved;
  }

  private cmdRun(name: string | undefined): void {
    if (name === undefined) { this.print("run: missing program name\n"); return; }
    const proc = this.kernel.spawnProgram(name, 0);
    if (proc === undefined) {
      this.print(`run: /bin/${name}: not found\n`);
      return;
    }
    this.print(`[${String(proc.pid)}] ${name} started\n`);
    // プログラムを数サイクル実行
    this.kernel.run(500);
    // 出力を表示
    if (proc.stdout.length > 0) {
      this.print(proc.stdout);
    }
  }

  private cmdStat(path: string | undefined): void {
    if (path === undefined) { this.print("stat: missing path\n"); return; }
    const resolved = this.resolvePath(path);
    const info = this.kernel.fs.stat(resolved);
    if (info === undefined) {
      this.print(`stat: ${resolved}: No such file\n`);
      return;
    }
    this.print(`  Type: ${info.type}\n`);
    this.print(`  Size: ${String(info.size)} bytes\n`);
    this.print(`  Created: ${new Date(info.createdAt).toISOString()}\n`);
    this.print(`  Modified: ${new Date(info.modifiedAt).toISOString()}\n`);
  }

  private cmdUname(): void {
    this.print("BrowserOS 0.1.0 (TypeScript/Wasm-free) — Educational OS Simulator\n");
  }

  private cmdHelp(): void {
    this.print("Commands:\n");
    this.print("  ls [path]          List directory\n");
    this.print("  cat <file>         Show file content\n");
    this.print("  echo <text>        Print text\n");
    this.print("  mkdir <path>       Create directory\n");
    this.print("  touch <file>       Create empty file\n");
    this.print("  write <file> <text> Write to file\n");
    this.print("  rm <path>          Remove file/dir\n");
    this.print("  cd <path>          Change directory\n");
    this.print("  pwd                Print working directory\n");
    this.print("  stat <path>        Show file info\n");
    this.print("  ps                 List processes\n");
    this.print("  run <program>      Run /bin/<program>\n");
    this.print("  uname              System info\n");
    this.print("  clear              Clear screen\n");
    this.print("  help               Show this help\n");
  }
}
