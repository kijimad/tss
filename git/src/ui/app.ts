import { Git } from "../commands/git.js";

export class GitApp {
  private git!: Git;
  private termDiv!: HTMLElement;
  private graphDiv!: HTMLElement;
  private objectsDiv!: HTMLElement;
  private inputLine = "";
  private history: string[] = [];
  private historyIdx = -1;
  private currentInputSpan: HTMLSpanElement | null = null;
  private currentCursor: HTMLSpanElement | null = null;
  private currentPromptLine: HTMLDivElement | null = null;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Cascadia Code','Fira Code',monospace;background:#0c0c0c;color:#e0e0e0;";

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
    titleSpan.textContent = "Git Simulator";
    titleSpan.style.cssText = "color:#f34f29;font-size:12px;font-weight:600;";
    header.appendChild(titleSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ターミナル
    this.termDiv = document.createElement("div");
    this.termDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;font-size:13px;line-height:1.6;cursor:text;outline:none;";
    this.termDiv.tabIndex = 0;
    main.appendChild(this.termDiv);

    // 右: コミットグラフ + オブジェクト
    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width:340px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";

    const graphTitle = document.createElement("div");
    graphTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f34f29;border-bottom:1px solid #333;";
    graphTitle.textContent = "Commit Graph";
    sidebar.appendChild(graphTitle);
    this.graphDiv = document.createElement("div");
    this.graphDiv.style.cssText = "flex:1;padding:8px 12px;font-size:11px;overflow-y:auto;border-bottom:1px solid #333;";
    sidebar.appendChild(this.graphDiv);

    const objTitle = document.createElement("div");
    objTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #333;";
    objTitle.textContent = "Object Store";
    sidebar.appendChild(objTitle);
    this.objectsDiv = document.createElement("div");
    this.objectsDiv.style.cssText = "max-height:200px;padding:4px 12px;font-size:10px;overflow-y:auto;";
    sidebar.appendChild(this.objectsDiv);

    main.appendChild(sidebar);
    container.appendChild(main);

    const style = document.createElement("style");
    style.textContent = "@keyframes blink { 50% { opacity: 0; } }";
    document.head.appendChild(style);

    // Git 初期化
    this.git = new Git();
    this.git.init();

    this.appendText("Git Simulator v0.1\n");
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
      this.executeCommand(cmd.trim());
      this.updateSidebar();
      this.showPrompt();
      return;
    }
    if (e.key === "Backspace") { if (this.inputLine.length > 0) { this.inputLine = this.inputLine.slice(0, -1); this.updateInput(); } return; }
    if (e.key === "ArrowUp") { if (this.historyIdx > 0) { this.historyIdx--; this.inputLine = this.history[this.historyIdx] ?? ""; this.updateInput(); } return; }
    if (e.key === "ArrowDown") { if (this.historyIdx < this.history.length - 1) { this.historyIdx++; this.inputLine = this.history[this.historyIdx] ?? ""; } else { this.historyIdx = this.history.length; this.inputLine = ""; } this.updateInput(); return; }
    if (e.ctrlKey && e.key === "l") { this.termDiv.innerHTML = ""; this.showPrompt(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { this.inputLine += e.key; this.updateInput(); }
  }

  private executeCommand(input: string): void {
    if (!input) return;
    const parts = input.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    // ファイル操作（ワーキングツリー）
    if (cmd === "echo" && args.includes(">")) {
      const gtIdx = args.indexOf(">");
      const content = args.slice(0, gtIdx).join(" ");
      const file = args[gtIdx + 1];
      if (file !== undefined) {
        this.git.workTree.set(file, content + "\n");
        this.appendText(`wrote '${file}'\n`);
      }
      return;
    }
    if (cmd === "cat") {
      const file = args[0];
      if (file !== undefined) {
        const content = this.git.workTree.get(file);
        this.appendText(content !== undefined ? content : `cat: ${file}: No such file\n`);
      }
      return;
    }
    if (cmd === "ls") {
      const files = [...this.git.workTree.keys()].sort();
      this.appendText(files.length > 0 ? files.join("\n") + "\n" : "(empty)\n");
      return;
    }
    if (cmd === "rm") {
      const file = args[0];
      if (file !== undefined) { this.git.workTree.delete(file); this.appendText(`removed '${file}'\n`); }
      return;
    }

    // Git コマンド
    if (cmd !== "git") {
      if (cmd === "help") { this.showHelp(); return; }
      if (cmd === "clear") { this.termDiv.innerHTML = ""; return; }
      this.appendText(`${cmd ?? ""}: command not found. Use 'git <command>' or 'help'\n`);
      return;
    }

    const subCmd = args[0];
    const subArgs = args.slice(1);

    let output = "";
    switch (subCmd) {
      case "init": output = this.git.init(); break;
      case "add": output = this.git.add(subArgs.length > 0 ? subArgs : ["."]); break;
      case "commit": {
        const mIdx = subArgs.indexOf("-m");
        const msg = mIdx >= 0 ? subArgs.slice(mIdx + 1).join(" ") : "no message";
        output = this.git.commit(msg);
        break;
      }
      case "status": output = this.git.status(); break;
      case "log": output = this.git.log(); break;
      case "diff": output = this.git.diff(); break;
      case "branch": output = this.git.branch(subArgs[0]); break;
      case "checkout": output = subArgs[0] !== undefined ? this.git.checkout(subArgs[0]) : "usage: git checkout <branch>"; break;
      case "merge": output = subArgs[0] !== undefined ? this.git.merge(subArgs[0]) : "usage: git merge <branch>"; break;
      case "tag": output = this.git.tag(subArgs[0]); break;
      case "show": output = this.git.show(subArgs[0]); break;
      case "cat-file": output = this.git.catFile(subArgs[0] ?? ""); break;
      default: output = `git: '${subCmd ?? ""}' is not a git command. See 'help'.`;
    }

    if (output) this.appendText(output + "\n");
  }

  private showHelp(): void {
    this.appendText("File commands:\n");
    this.appendText("  echo <text> > <file>    Write file\n");
    this.appendText("  cat <file>              Show file\n");
    this.appendText("  ls                      List files\n");
    this.appendText("  rm <file>               Delete file\n\n");
    this.appendText("Git commands:\n");
    this.appendText("  git add <file|.>        Stage files\n");
    this.appendText("  git commit -m <msg>     Commit\n");
    this.appendText("  git status              Working tree status\n");
    this.appendText("  git log                 Commit history\n");
    this.appendText("  git diff                Show changes\n");
    this.appendText("  git branch [name]       List/create branch\n");
    this.appendText("  git checkout <branch>   Switch branch\n");
    this.appendText("  git merge <branch>      Merge branch\n");
    this.appendText("  git tag [name]          List/create tag\n");
    this.appendText("  git show [hash]         Show object\n");
    this.appendText("  git cat-file <hash>     Show object content\n");
  }

  private showPrompt(): void {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;white-space:pre;";
    const branch = this.git.refs.getHeadBranch() ?? "detached";
    const ps = document.createElement("span");
    ps.style.cssText = "color:#27c93f;";
    ps.textContent = `(${branch}) $ `;
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
    if (this.currentPromptLine) this.termDiv.insertBefore(span, this.currentPromptLine);
    else this.termDiv.appendChild(span);
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private updateSidebar(): void {
    // コミットグラフ
    this.graphDiv.innerHTML = "";
    const branches = this.git.refs.listBranches();
    const tags = this.git.refs.listTags();

    // 全コミットをチェーンで辿る
    const visited = new Set<string>();
    const commits: { hash: string; message: string; parents: string[]; labels: string[] }[] = [];

    const startHashes = branches.map(b => b.hash);
    for (const startHash of startHashes) {
      let h: string | undefined = startHash;
      while (h !== undefined && !visited.has(h)) {
        visited.add(h);
        const obj = this.git.objects.get(h);
        if (obj === undefined || obj.type !== "commit") break;

        const labels: string[] = [];
        for (const b of branches) { if (b.hash === h) labels.push(b.current ? `HEAD -> ${b.name}` : b.name); }
        for (const t of tags) { if (t.hash === h) labels.push(`tag: ${t.name}`); }

        commits.push({ hash: h, message: obj.message, parents: obj.parents, labels });
        h = obj.parents[0];
      }
    }

    if (commits.length === 0) {
      this.graphDiv.textContent = "(no commits)";
    }

    for (const c of commits) {
      const row = document.createElement("div");
      row.style.cssText = "padding:3px 0;display:flex;gap:6px;align-items:flex-start;";

      // ドット
      const dot = document.createElement("span");
      dot.style.cssText = "color:#f34f29;font-size:14px;line-height:1;";
      dot.textContent = c.parents.length > 1 ? "\u25C9" : "\u25CF"; // マージは二重丸
      row.appendChild(dot);

      const info = document.createElement("span");
      info.style.cssText = "color:#94a3b8;";
      const hashSpan = `<span style="color:#f59e0b">${c.hash.slice(0, 7)}</span>`;
      const labelSpan = c.labels.length > 0 ? ` <span style="color:#27c93f">(${c.labels.join(", ")})</span>` : "";
      info.innerHTML = `${hashSpan}${labelSpan} ${c.message}`;
      row.appendChild(info);

      this.graphDiv.appendChild(row);
    }

    // オブジェクトストア
    this.objectsDiv.innerHTML = "";
    const objects = this.git.objects.all();
    const typeColors: Record<string, string> = { blob: "#3b82f6", tree: "#10b981", commit: "#f59e0b" };
    for (const { hash: h, object: obj } of objects) {
      const row = document.createElement("div");
      row.style.cssText = `padding:1px 0;color:${typeColors[obj.type] ?? "#94a3b8"};`;
      let detail = "";
      if (obj.type === "blob") detail = `${String(obj.content.length)}B`;
      else if (obj.type === "tree") detail = `${String(obj.entries.length)} entries`;
      else if (obj.type === "commit") detail = obj.message.slice(0, 30);
      row.textContent = `${obj.type.padEnd(6)} ${h.slice(0, 7)}  ${detail}`;
      this.objectsDiv.appendChild(row);
    }
    const countEl = document.createElement("div");
    countEl.style.cssText = "color:#475569;margin-top:4px;";
    countEl.textContent = `${String(objects.length)} objects`;
    this.objectsDiv.appendChild(countEl);
  }
}
