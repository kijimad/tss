/**
 * shell.ts -- シェル (PTY のスレーブ側で動作)
 *
 * PTY 経由でターミナルと接続するシェル。
 * エスケープシーケンスを使って色付きプロンプト、補完、カラー出力を行う。
 */
import type { PseudoTerminal } from "../pty/pty.js";

export class Shell {
  private pty: PseudoTerminal;
  private cwd = "/home/user";
  private env: Record<string, string> = {
    USER: "user", HOME: "/home/user", SHELL: "/bin/bash",
    TERM: "xterm-256color", PATH: "/usr/local/bin:/usr/bin:/bin",
    PS1: "\\[\\e[1;32m\\]\\u@host\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]$ ",
  };
  private fs = new Map<string, string>([
    ["/etc/hostname", "vterm-host"],
    ["/etc/os-release", 'NAME="Ubuntu"\nVERSION="22.04"'],
    ["/home/user/.bashrc", "# .bashrc\nalias ll='ls -la'\nexport PS1='\\u@host:\\w$ '"],
    ["/home/user/hello.txt", "Hello from the virtual terminal!"],
    ["/home/user/colors.sh", '#!/bin/bash\necho -e "\\e[31mRed\\e[0m \\e[32mGreen\\e[0m \\e[34mBlue\\e[0m"'],
    ["/home/user/notes.md", "# Notes\n- Item 1\n- Item 2\n- Item 3"],
    ["/usr/bin/ls", ""], ["/usr/bin/cat", ""], ["/usr/bin/echo", ""],
    ["/bin/bash", ""], ["/bin/sh", ""],
  ]);
  private history: string[] = [];

  constructor(pty: PseudoTerminal) {
    this.pty = pty;
    // PTY のスレーブ側からの読み取りを処理
    this.pty.onSlaveRead = (data) => this.handleInput(data);
  }

  start(): void {
    this.writeOutput("\x1b[1;32mvterm\x1b[0m - Virtual Terminal Emulator\r\n");
    this.writeOutput("Type \x1b[1mhelp\x1b[0m for available commands.\r\n\r\n");
    this.showPrompt();
  }

  private handleInput(data: string): void {
    if (data === "__EOF__") {
      this.writeOutput("exit\r\n");
      return;
    }
    const command = data.trim();
    if (command.length > 0) {
      this.history.push(command);
      this.executeCommand(command);
    }
    this.showPrompt();
  }

  private executeCommand(input: string): void {
    const parts = input.split(/\s+/);
    const cmd = parts[0] ?? "";
    const args = parts.slice(1);

    switch (cmd) {
      case "echo": {
        let text = args.join(" ");
        // -e フラグ: エスケープシーケンスを解釈
        if (args[0] === "-e") {
          text = args.slice(1).join(" ");
          text = text.replace(/\\e/g, "\x1b").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        }
        // リダイレクト
        if (args.includes(">")) {
          const gtIdx = args.indexOf(">");
          const file = args[gtIdx + 1];
          const content = args.slice(0, gtIdx).join(" ");
          if (file !== undefined) {
            const path = this.resolvePath(file);
            this.fs.set(path, content + "\n");
          }
          return;
        }
        this.writeOutput(text + "\r\n");
        break;
      }
      case "cat": {
        const path = this.resolvePath(args[0] ?? "");
        const content = this.fs.get(path);
        if (content !== undefined) {
          this.writeOutput(content.replace(/\n/g, "\r\n") + "\r\n");
        } else {
          this.writeOutput(`\x1b[31mcat: ${args[0] ?? ""}: No such file\x1b[0m\r\n`);
        }
        break;
      }
      case "ls": {
        const dir = this.resolvePath(args[0] ?? this.cwd);
        const entries: { name: string; isDir: boolean }[] = [];
        const prefix = dir.endsWith("/") ? dir : dir + "/";
        for (const path of this.fs.keys()) {
          if (path.startsWith(prefix)) {
            const rest = path.slice(prefix.length);
            const name = rest.split("/")[0];
            if (name !== undefined && name.length > 0 && !entries.some(e => e.name === name)) {
              const isDir = [...this.fs.keys()].some(p => p.startsWith(prefix + name + "/"));
              entries.push({ name, isDir });
            }
          }
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const isLong = args.includes("-l") || args.includes("-la");
        for (const entry of entries) {
          if (isLong) {
            const color = entry.isDir ? "\x1b[1;34m" : (entry.name.endsWith(".sh") ? "\x1b[1;32m" : "");
            const reset = color ? "\x1b[0m" : "";
            const type = entry.isDir ? "d" : "-";
            const size = this.fs.get(prefix + entry.name)?.length ?? 0;
            this.writeOutput(`${type}rw-r--r-- user user ${String(size).padStart(6)} ${color}${entry.name}${reset}\r\n`);
          } else {
            const color = entry.isDir ? "\x1b[1;34m" : "";
            const reset = color ? "\x1b[0m" : "";
            this.writeOutput(`${color}${entry.name}${reset}  `);
          }
        }
        if (!isLong && entries.length > 0) this.writeOutput("\r\n");
        if (entries.length === 0) this.writeOutput("(empty)\r\n");
        break;
      }
      case "pwd": this.writeOutput(this.cwd + "\r\n"); break;
      case "cd": {
        const target = args[0] ?? this.env["HOME"] ?? "/";
        if (target === "..") {
          const parts = this.cwd.split("/").filter(p => p.length > 0);
          parts.pop();
          this.cwd = parts.length === 0 ? "/" : "/" + parts.join("/");
        } else if (target === "~" || target === "") {
          this.cwd = this.env["HOME"] ?? "/home/user";
        } else {
          this.cwd = this.resolvePath(target);
        }
        break;
      }
      case "mkdir": {
        const path = this.resolvePath(args[0] ?? "");
        this.fs.set(path + "/.keep", "");
        break;
      }
      case "touch": {
        const path = this.resolvePath(args[0] ?? "");
        if (!this.fs.has(path)) this.fs.set(path, "");
        break;
      }
      case "rm": {
        const path = this.resolvePath(args[0] ?? "");
        this.fs.delete(path);
        break;
      }
      case "whoami": this.writeOutput((this.env["USER"] ?? "user") + "\r\n"); break;
      case "hostname": this.writeOutput((this.fs.get("/etc/hostname") ?? "host") + "\r\n"); break;
      case "date": this.writeOutput(new Date().toISOString() + "\r\n"); break;
      case "env": {
        for (const [k, v] of Object.entries(this.env)) this.writeOutput(`${k}=${v}\r\n`);
        break;
      }
      case "export": {
        const arg = args[0] ?? "";
        const eqIdx = arg.indexOf("=");
        if (eqIdx > 0) this.env[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
        break;
      }
      case "history": {
        this.history.forEach((cmd, i) => this.writeOutput(`  ${String(i + 1).padStart(4)}  ${cmd}\r\n`));
        break;
      }
      case "clear": this.writeOutput("\x1b[2J\x1b[H"); break;
      case "tput": {
        if (args[0] === "cols") this.writeOutput(String(this.pty.cols) + "\r\n");
        if (args[0] === "lines") this.writeOutput(String(this.pty.rows) + "\r\n");
        break;
      }
      case "colors": {
        // 16色のカラーパレットを表示
        for (let i = 0; i < 16; i++) {
          this.writeOutput(`\x1b[${i < 8 ? 30 + i : 90 + i - 8}m Color ${String(i).padStart(2)} \x1b[0m`);
          if (i === 7 || i === 15) this.writeOutput("\r\n");
        }
        // 背景色
        for (let i = 0; i < 16; i++) {
          this.writeOutput(`\x1b[${i < 8 ? 40 + i : 100 + i - 8}m  ${String(i).padStart(2)}  \x1b[0m`);
          if (i === 7 || i === 15) this.writeOutput("\r\n");
        }
        break;
      }
      case "demo": {
        this.writeOutput("\x1b[1mBold\x1b[0m ");
        this.writeOutput("\x1b[4mUnderline\x1b[0m ");
        this.writeOutput("\x1b[7mInverse\x1b[0m ");
        this.writeOutput("\x1b[1;31mBold Red\x1b[0m ");
        this.writeOutput("\x1b[32mGreen\x1b[0m ");
        this.writeOutput("\x1b[1;34mBold Blue\x1b[0m\r\n");
        this.writeOutput("\x1b[33m>>> \x1b[0mCursor movement: \x1b[5Cskipped 5 cols\r\n");
        break;
      }
      case "help":
        this.writeOutput("\x1b[1mAvailable commands:\x1b[0m\r\n");
        for (const [c, d] of [
          ["echo [-e] <text>", "print text (with escape codes)"],
          ["cat <file>", "show file content"],
          ["ls [-l] [dir]", "list directory"],
          ["cd <dir>", "change directory"],
          ["pwd", "print working directory"],
          ["mkdir <dir>", "create directory"],
          ["touch <file>", "create file"],
          ["rm <file>", "delete file"],
          ["clear", "clear screen"],
          ["colors", "show color palette"],
          ["demo", "demonstrate text attributes"],
          ["history", "command history"],
          ["env / export K=V", "environment variables"],
          ["tput cols/lines", "terminal size"],
        ]) this.writeOutput(`  \x1b[36m${(c ?? "").padEnd(24)}\x1b[0m${d ?? ""}\r\n`);
        break;
      default:
        if (this.fs.has(`/usr/bin/${cmd}`) || this.fs.has(`/bin/${cmd}`)) {
          this.writeOutput(`(executed: ${input})\r\n`);
        } else {
          this.writeOutput(`\x1b[31m${cmd}: command not found\x1b[0m\r\n`);
        }
    }
  }

  private showPrompt(): void {
    const user = this.env["USER"] ?? "user";
    const shortCwd = this.cwd.replace(this.env["HOME"] ?? "", "~");
    this.writeOutput(`\x1b[1;32m${user}@host\x1b[0m:\x1b[1;34m${shortCwd}\x1b[0m$ `);
  }

  private writeOutput(data: string): void {
    this.pty.slaveWrite(data);
  }

  private resolvePath(path: string): string {
    if (path.startsWith("/")) return path;
    if (path.startsWith("~")) return (this.env["HOME"] ?? "/home/user") + path.slice(1);
    return this.cwd + "/" + path;
  }
}
