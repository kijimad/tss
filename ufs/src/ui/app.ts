import { BlockDevice } from "../hw/disk.js";
import { UnixFS } from "../fs/filesystem.js";
import { InodeMode, type DirEntry, type FsEvent } from "../fs/types.js";
import { BLOCK_SIZE, TOTAL_BLOCKS, DATA_BLOCK_START } from "../hw/disk.js";

/** サンプルコマンド集: ドロップダウンから選択して自動実行できる */
export const EXAMPLES: { name: string; commands: string[] }[] = [
  {
    name: "ファイル作成と読み取り",
    commands: [
      "touch /home/hello.txt",
      "write /home/hello.txt Hello, Unix File System!",
      "cat /home/hello.txt",
      "stat /home/hello.txt",
    ],
  },
  {
    name: "ディレクトリ構造",
    commands: [
      "mkdir /home/user",
      "mkdir /home/user/docs",
      "cd /home/user",
      "pwd",
      "touch docs/readme.txt",
      "ls",
      "ls docs",
      "cd /",
    ],
  },
  {
    name: "inode と統計",
    commands: [
      "touch /tmp/data.bin",
      "write /tmp/data.bin This is a test file with some content",
      "stat /tmp/data.bin",
      "df",
    ],
  },
  {
    name: "ファイル削除と領域解放",
    commands: [
      "touch /tmp/removeme.txt",
      "write /tmp/removeme.txt Temporary data that will be removed",
      "df",
      "rm /tmp/removeme.txt",
      "df",
    ],
  },
  {
    name: "ネストしたディレクトリ",
    commands: [
      "mkdir /home/project",
      "mkdir /home/project/src",
      "mkdir /home/project/src/utils",
      "cd /home/project/src/utils",
      "pwd",
      "touch index.ts",
      "write index.ts export function hello() { return 42; }",
      "cat index.ts",
      "cd ..",
      "ls utils",
      "cd /",
    ],
  },
];

export class UfsApp {
  private disk!: BlockDevice;
  private fs!: UnixFS;
  private termDiv!: HTMLElement;
  private infoDiv!: HTMLElement;
  private diskMapDiv!: HTMLElement;
  private eventsDiv!: HTMLElement;
  private inputLine = "";
  private cwd = "/";
  private history: string[] = [];
  private historyIdx = -1;
  private currentInputSpan: HTMLSpanElement | null = null;
  private currentCursor: HTMLSpanElement | null = null;
  private currentPromptLine: HTMLDivElement | null = null;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Cascadia Code','Fira Code',monospace;background:#0c0c0c;color:#e0e0e0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;background:#1a1a2e;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333;font-size:13px;";
    const dots = document.createElement("div");
    dots.style.cssText = "display:flex;gap:6px;";
    for (const c of ["#ff5f56", "#ffbd2e", "#27c93f"]) {
      const d = document.createElement("div");
      d.style.cssText = `width:10px;height:10px;border-radius:50%;background:${c};`;
      dots.appendChild(d);
    }
    header.appendChild(dots);
    const titleSpan = document.createElement("span");
    titleSpan.textContent = "Unix File System";
    titleSpan.style.cssText = "color:#888;font-size:12px;";
    header.appendChild(titleSpan);

    // サンプル選択ドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText =
      "margin-left:auto;padding:2px 8px;font-size:11px;font-family:inherit;" +
      "background:#16213e;color:#e0e0e0;border:1px solid #444;border-radius:4px;cursor:pointer;outline:none;";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- サンプルを選択 --";
    exampleSelect.appendChild(defaultOpt);
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exampleSelect.appendChild(opt);
    }
    exampleSelect.addEventListener("change", () => {
      const idx = Number(exampleSelect.value);
      if (!Number.isNaN(idx) && EXAMPLES[idx]) {
        this.runExample(EXAMPLES[idx]!.commands);
      }
      exampleSelect.value = "";
    });
    header.appendChild(exampleSelect);

    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ターミナル
    this.termDiv = document.createElement("div");
    this.termDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;font-size:13px;line-height:1.6;cursor:text;outline:none;";
    this.termDiv.tabIndex = 0;
    main.appendChild(this.termDiv);

    // 右: FS情報 + ディスクマップ + イベント
    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width:320px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";

    // FS情報
    this.infoDiv = document.createElement("div");
    this.infoDiv.style.cssText = "padding:8px 12px;font-size:11px;border-bottom:1px solid #333;";
    sidebar.appendChild(this.infoDiv);

    // ディスクマップ
    const diskTitle = document.createElement("div");
    diskTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#94a3b8;border-bottom:1px solid #333;";
    diskTitle.textContent = "Disk Block Map";
    sidebar.appendChild(diskTitle);
    this.diskMapDiv = document.createElement("div");
    this.diskMapDiv.style.cssText = "padding:8px 12px;font-size:0;line-height:0;border-bottom:1px solid #333;max-height:160px;overflow-y:auto;";
    sidebar.appendChild(this.diskMapDiv);

    // イベントログ
    const evTitle = document.createElement("div");
    evTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#94a3b8;border-bottom:1px solid #333;";
    evTitle.textContent = "FS Events";
    sidebar.appendChild(evTitle);
    this.eventsDiv = document.createElement("div");
    this.eventsDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;";
    sidebar.appendChild(this.eventsDiv);

    main.appendChild(sidebar);
    container.appendChild(main);

    // ブリンクスタイル
    const style = document.createElement("style");
    style.textContent = "@keyframes blink { 50% { opacity: 0; } }";
    document.head.appendChild(style);

    // FS 初期化
    this.disk = new BlockDevice();
    this.fs = new UnixFS(this.disk);
    this.fs.format();
    // 初期ディレクトリ
    this.fs.mkdir("/bin");
    this.fs.mkdir("/home");
    this.fs.mkdir("/tmp");
    this.fs.mkdir("/etc");

    // イベントフック
    this.fs.onEvent = (e) => this.addFsEvent(e);

    this.appendText("Unix File System v0.1\n");
    this.appendText("Type 'help' for commands.\n\n");
    this.showPrompt();
    this.updateSidebar();

    this.termDiv.addEventListener("keydown", (e) => this.handleKey(e));
    this.termDiv.focus();
    this.termDiv.addEventListener("click", () => this.termDiv.focus());
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Enter") {
      this.currentCursor?.remove();
      this.termDiv.appendChild(document.createElement("br"));
      const cmd = this.inputLine;
      this.inputLine = "";
      this.currentInputSpan = null;
      this.currentPromptLine = null;
      if (cmd.trim()) { this.history.push(cmd); this.historyIdx = this.history.length; }
      this.fs.resetEvents();
      this.eventsDiv.innerHTML = "";
      this.executeCommand(cmd.trim());
      this.updateSidebar();
      this.showPrompt();
      return;
    }
    if (e.key === "Backspace") {
      if (this.inputLine.length > 0) { this.inputLine = this.inputLine.slice(0, -1); this.updateInput(); }
      return;
    }
    if (e.key === "ArrowUp") {
      if (this.historyIdx > 0) { this.historyIdx--; this.inputLine = this.history[this.historyIdx] ?? ""; this.updateInput(); }
      return;
    }
    if (e.key === "ArrowDown") {
      if (this.historyIdx < this.history.length - 1) { this.historyIdx++; this.inputLine = this.history[this.historyIdx] ?? ""; }
      else { this.historyIdx = this.history.length; this.inputLine = ""; }
      this.updateInput();
      return;
    }
    if (e.ctrlKey && e.key === "l") { this.termDiv.innerHTML = ""; this.showPrompt(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      this.inputLine += e.key;
      this.updateInput();
    }
  }

  private executeCommand(input: string): void {
    if (!input) return;
    const parts = input.split(/\s+/);
    const cmd = parts[0] ?? "";
    const args = parts.slice(1);
    const arg0 = args[0];

    const resolve = (p: string | undefined): string => {
      if (p === undefined) return this.cwd;
      if (p.startsWith("/")) return p;
      if (this.cwd === "/") return "/" + p;
      return this.cwd + "/" + p;
    };

    switch (cmd) {
      case "ls": {
        const path = resolve(arg0);
        const entries = this.fs.readdir(path);
        if (entries === undefined) { this.appendText(`ls: ${path}: not found\n`); break; }
        for (const e of entries) {
          if (e.name === "." || e.name === "..") continue;
          const info = this.fs.stat(path === "/" ? `/${e.name}` : `${path}/${e.name}`);
          const isDir = info !== undefined && (info.inode.mode & 0o170000) === InodeMode.Directory;
          const color = isDir ? "#5eead4" : "#e0e0e0";
          const suffix = isDir ? "/" : "";
          const size = info !== undefined ? String(info.inode.size).padStart(6) : "     ?";
          const ino = `i${String(e.inode).padStart(3)}`;
          this.appendText(`  ${ino}  ${size}  `, "#64748b");
          this.appendText(`${e.name}${suffix}\n`, color);
        }
        break;
      }
      case "cat": {
        if (arg0 === undefined) { this.appendText("cat: missing file\n"); break; }
        const content = this.fs.readTextFile(resolve(arg0));
        if (content === undefined) { this.appendText(`cat: ${arg0}: not found\n`); break; }
        this.appendText(content + (content.endsWith("\n") ? "" : "\n"));
        break;
      }
      case "echo": this.appendText(args.join(" ") + "\n"); break;
      case "mkdir": {
        if (arg0 === undefined) { this.appendText("mkdir: missing path\n"); break; }
        if (!this.fs.mkdir(resolve(arg0))) this.appendText(`mkdir: failed\n`);
        break;
      }
      case "touch": {
        if (arg0 === undefined) { this.appendText("touch: missing file\n"); break; }
        const p = resolve(arg0);
        if (!this.fs.exists(p)) this.fs.createFile(p);
        break;
      }
      case "write": {
        if (arg0 === undefined) { this.appendText("write: missing file\n"); break; }
        this.fs.writeFile(resolve(arg0), args.slice(1).join(" ") + "\n");
        break;
      }
      case "rm": {
        if (arg0 === undefined) { this.appendText("rm: missing path\n"); break; }
        if (!this.fs.unlink(resolve(arg0))) this.appendText(`rm: failed\n`);
        break;
      }
      case "stat": {
        if (arg0 === undefined) { this.appendText("stat: missing path\n"); break; }
        const info = this.fs.stat(resolve(arg0));
        if (info === undefined) { this.appendText(`stat: not found\n`); break; }
        const isDir = (info.inode.mode & 0o170000) === InodeMode.Directory;
        this.appendText(`  Inode: ${String(info.inodeNum)}\n`);
        this.appendText(`  Type:  ${isDir ? "directory" : "file"}\n`);
        this.appendText(`  Mode:  ${(info.inode.mode & 0o777).toString(8)}\n`);
        this.appendText(`  Size:  ${String(info.inode.size)} bytes\n`);
        this.appendText(`  Links: ${String(info.inode.links)}\n`);
        this.appendText(`  Blocks: ${info.inode.directBlocks.filter(b => b !== 0).map(b => String(b)).join(", ") || "(none)"}\n`);
        break;
      }
      case "cd": {
        if (arg0 === undefined || arg0 === "/") { this.cwd = "/"; break; }
        if (arg0 === "..") {
          const p = this.cwd.split("/").filter(s => s.length > 0);
          p.pop();
          this.cwd = p.length === 0 ? "/" : "/" + p.join("/");
          break;
        }
        const target = resolve(arg0);
        const s = this.fs.stat(target);
        if (s === undefined || (s.inode.mode & 0o170000) !== InodeMode.Directory) {
          this.appendText(`cd: ${arg0}: not a directory\n`);
          break;
        }
        this.cwd = target;
        break;
      }
      case "pwd": this.appendText(this.cwd + "\n"); break;
      case "df": {
        const sb = this.fs.getSuperBlock();
        this.appendText(`  Total blocks: ${String(sb.totalBlocks)}\n`);
        this.appendText(`  Free blocks:  ${String(sb.freeBlocks)}\n`);
        this.appendText(`  Total inodes: ${String(sb.totalInodes)}\n`);
        this.appendText(`  Free inodes:  ${String(sb.freeInodes)}\n`);
        this.appendText(`  Block size:   ${String(sb.blockSize)} bytes\n`);
        break;
      }
      case "clear": this.termDiv.innerHTML = ""; break;
      case "help":
        this.appendText("Commands:\n");
        for (const [c, d] of [
          ["ls [path]", "list directory"], ["cat <file>", "show file"], ["echo <text>", "print text"],
          ["mkdir <path>", "create directory"], ["touch <file>", "create empty file"],
          ["write <file> <text>", "write to file"], ["rm <path>", "remove"],
          ["stat <path>", "show inode info"], ["cd <path>", "change directory"],
          ["pwd", "print working directory"], ["df", "disk usage"], ["clear", "clear screen"],
        ]) {
          this.appendText(`  ${c.padEnd(22)}`, "#5eead4");
          this.appendText(`${d}\n`, "#64748b");
        }
        break;
      default:
        this.appendText(`${cmd}: command not found\n`);
    }
  }

  private showPrompt(): void {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;white-space:pre;";
    const ps = document.createElement("span");
    ps.style.cssText = "color:#27c93f;";
    ps.textContent = `${this.cwd}$ `;
    line.appendChild(ps);
    const inp = document.createElement("span");
    line.appendChild(inp);
    const cur = document.createElement("span");
    cur.style.cssText = "background:#e0e0e0;color:#0c0c0c;animation:blink 1s step-end infinite;";
    cur.textContent = "\u00A0";
    line.appendChild(cur);
    this.termDiv.appendChild(line);
    this.currentPromptLine = line;
    this.currentInputSpan = inp;
    this.currentCursor = cur;
    this.inputLine = "";
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private updateInput(): void {
    if (this.currentInputSpan) this.currentInputSpan.textContent = this.inputLine;
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private appendText(text: string, color = "#e0e0e0"): void {
    const span = document.createElement("span");
    span.style.cssText = `white-space:pre-wrap;color:${color};`;
    span.textContent = text;
    if (this.currentPromptLine) {
      this.termDiv.insertBefore(span, this.currentPromptLine);
    } else {
      this.termDiv.appendChild(span);
    }
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  /** サンプルのコマンド列を順次実行する */
  private runExample(commands: string[]): void {
    for (const cmd of commands) {
      // 現在のプロンプト行にコマンドを表示
      if (this.currentInputSpan) {
        this.currentInputSpan.textContent = cmd;
      }
      this.currentCursor?.remove();
      this.termDiv.appendChild(document.createElement("br"));
      this.currentInputSpan = null;
      this.currentPromptLine = null;

      this.fs.resetEvents();
      this.eventsDiv.innerHTML = "";
      this.executeCommand(cmd.trim());
      this.updateSidebar();
      this.showPrompt();
    }
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  // 右パネル更新
  private updateSidebar(): void {
    // FS 情報
    const sb = this.fs.getSuperBlock();
    const usedBlocks = sb.totalBlocks - sb.freeBlocks - DATA_BLOCK_START;
    const usedInodes = sb.totalInodes - sb.freeInodes;
    this.infoDiv.innerHTML = "";
    this.infoDiv.style.color = "#94a3b8";
    this.infoDiv.innerHTML = [
      `<b style="color:#f8fafc">Super Block</b>`,
      `Blocks: ${String(usedBlocks)} / ${String(sb.totalBlocks - DATA_BLOCK_START)} used`,
      `Inodes: ${String(usedInodes)} / ${String(sb.totalInodes)} used`,
      `Block size: ${String(sb.blockSize)}B`,
    ].join("<br>");

    // ディスクマップ（各ブロックを小さなセルで表示）
    this.diskMapDiv.innerHTML = "";
    const bitmap = this.disk.readBlock(2);
    for (let i = 0; i < Math.min(TOTAL_BLOCKS, 512); i++) {
      const used = ((bitmap[Math.floor(i / 8)] ?? 0) & (1 << (i % 8))) !== 0;
      const cell = document.createElement("span");
      let bg = "#1e293b"; // free
      if (i < DATA_BLOCK_START) bg = "#334155"; // system
      else if (used) bg = "#2563eb"; // data used
      cell.style.cssText = `display:inline-block;width:4px;height:4px;margin:0.5px;background:${bg};`;
      cell.title = `Block ${String(i)}${used ? " (used)" : " (free)"}`;
      this.diskMapDiv.appendChild(cell);
    }
    // 凡例
    const legend = document.createElement("div");
    legend.style.cssText = "margin-top:4px;font-size:9px;color:#64748b;";
    legend.innerHTML = '<span style="color:#334155">&#9632;</span> system <span style="color:#2563eb">&#9632;</span> used <span style="color:#1e293b">&#9632;</span> free';
    this.diskMapDiv.appendChild(legend);
  }

  private addFsEvent(event: FsEvent): void {
    const row = document.createElement("div");
    row.style.cssText = "padding:1px 12px;border-bottom:1px solid #1e293b11;";
    let color = "#94a3b8";
    let text = "";
    switch (event.type) {
      case "inode_alloc": color = "#10b981"; text = `inode_alloc #${String(event.inodeNum)} (${event.mode})`; break;
      case "inode_free": color = "#ef4444"; text = `inode_free #${String(event.inodeNum)}`; break;
      case "block_alloc": color = "#3b82f6"; text = `block_alloc #${String(event.blockNum)}`; break;
      case "block_free": color = "#f59e0b"; text = `block_free #${String(event.blockNum)}`; break;
      case "dir_add": color = "#8b5cf6"; text = `dir_add ${event.name} → i${String(event.childInode)}`; break;
      case "dir_remove": color = "#ef4444"; text = `dir_remove ${event.name}`; break;
      case "file_write": color = "#06b6d4"; text = `file_write i${String(event.inodeNum)} ${String(event.size)}B`; break;
      case "file_read": color = "#94a3b8"; text = `file_read i${String(event.inodeNum)} ${String(event.size)}B`; break;
      case "path_resolve": color = "#64748b"; text = `resolve ${event.path} → i${String(event.inodeNum)}`; break;
    }
    row.style.color = color;
    row.textContent = text;
    this.eventsDiv.appendChild(row);
    this.eventsDiv.scrollTop = this.eventsDiv.scrollHeight;
  }
}
