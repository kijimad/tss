import { ShellExecutor, type ShellEvent } from "../executor/executor.js";

export class ShellApp {
  private sh!: ShellExecutor;
  private termDiv!: HTMLElement;
  private traceDiv!: HTMLElement;
  private inputLine = "";
  private history: string[] = [];
  private historyIdx = -1;
  private currentInputSpan: HTMLSpanElement | null = null;
  private currentCursor: HTMLSpanElement | null = null;
  private currentPromptLine: HTMLDivElement | null = null;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Cascadia Code',monospace;background:#0c0c0c;color:#e0e0e0;";
    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;background:#1a1a2e;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333;";
    const dots = document.createElement("div"); dots.style.cssText = "display:flex;gap:6px;";
    for (const c of ["#ff5f56", "#ffbd2e", "#27c93f"]) { const d = document.createElement("div"); d.style.cssText = `width:10px;height:10px;border-radius:50%;background:${c};`; dots.appendChild(d); }
    header.appendChild(dots);
    const t = document.createElement("span"); t.textContent = "Shell Interpreter"; t.style.cssText = "color:#10b981;font-size:12px;font-weight:600;"; header.appendChild(t);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";
    this.termDiv = document.createElement("div"); this.termDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;font-size:13px;line-height:1.6;cursor:text;outline:none;"; this.termDiv.tabIndex = 0;
    main.appendChild(this.termDiv);

    const sidebar = document.createElement("div"); sidebar.style.cssText = "width:360px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";
    const trTitle = document.createElement("div"); trTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #333;"; trTitle.textContent = "Execution Trace"; sidebar.appendChild(trTitle);
    this.traceDiv = document.createElement("div"); this.traceDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;"; sidebar.appendChild(this.traceDiv);
    main.appendChild(sidebar);
    container.appendChild(main);

    const style = document.createElement("style"); style.textContent = "@keyframes blink { 50% { opacity: 0; } }"; document.head.appendChild(style);

    this.sh = new ShellExecutor();
    this.sh.onEvent = (e) => this.addTrace(e);

    this.appendText("Shell Interpreter v0.1\nType 'help' for commands.\n\n");
    this.showPrompt();

    this.termDiv.addEventListener("keydown", (e) => this.handleKey(e));
    this.termDiv.focus();
    this.termDiv.addEventListener("click", () => this.termDiv.focus());
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.isComposing) return; e.preventDefault(); e.stopPropagation();
    if (e.key === "Enter") {
      this.currentCursor?.remove(); this.termDiv.appendChild(document.createElement("br"));
      const cmd = this.inputLine; this.inputLine = ""; this.currentInputSpan = null; this.currentPromptLine = null;
      if (cmd.trim()) { this.history.push(cmd); this.historyIdx = this.history.length; }
      this.traceDiv.innerHTML = "";
      const output = this.sh.execute(cmd);
      if (output.length > 0) this.appendText(output);
      if (this.sh.stderr.length > 0) this.appendText(this.sh.stderr, "#f87171");
      this.showPrompt(); return;
    }
    if (e.key === "Backspace") { if (this.inputLine.length > 0) { this.inputLine = this.inputLine.slice(0, -1); this.updateInput(); } return; }
    if (e.key === "ArrowUp") { if (this.historyIdx > 0) { this.historyIdx--; this.inputLine = this.history[this.historyIdx] ?? ""; this.updateInput(); } return; }
    if (e.key === "ArrowDown") { if (this.historyIdx < this.history.length - 1) { this.historyIdx++; this.inputLine = this.history[this.historyIdx] ?? ""; } else { this.historyIdx = this.history.length; this.inputLine = ""; } this.updateInput(); return; }
    if (e.ctrlKey && e.key === "l") { this.termDiv.innerHTML = ""; this.showPrompt(); return; }
    if (e.key === "Tab") {
      // 簡易補完
      const parts = this.inputLine.split(/\s+/);
      const last = parts[parts.length - 1] ?? "";
      if (last.length > 0) {
        const dir = this.sh.env["PWD"] ?? "/";
        const prefix = dir.endsWith("/") ? dir : dir + "/";
        const matches: string[] = [];
        for (const path of this.sh.fs.keys()) {
          if (path.startsWith(prefix)) {
            const name = path.slice(prefix.length).split("/")[0];
            if (name !== undefined && name.startsWith(last) && !matches.includes(name)) matches.push(name);
          }
        }
        if (matches.length === 1 && matches[0] !== undefined) {
          parts[parts.length - 1] = matches[0];
          this.inputLine = parts.join(" ");
          this.updateInput();
        }
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { this.inputLine += e.key; this.updateInput(); }
  }

  private showPrompt(): void {
    const line = document.createElement("div"); line.style.cssText = "display:flex;white-space:pre;";
    const user = this.sh.env["USER"] ?? "user";
    const cwd = (this.sh.env["PWD"] ?? "/").replace(this.sh.env["HOME"] ?? "", "~");
    const ps = document.createElement("span"); ps.style.cssText = "color:#10b981;"; ps.textContent = `${user}@host:${cwd}$ `;
    line.appendChild(ps);
    const inp = document.createElement("span"); line.appendChild(inp);
    const cur = document.createElement("span"); cur.style.cssText = "background:#e0e0e0;color:#0c0c0c;animation:blink 1s step-end infinite;"; cur.textContent = "\u00A0"; line.appendChild(cur);
    this.termDiv.appendChild(line);
    this.currentPromptLine = line; this.currentInputSpan = inp; this.currentCursor = cur; this.inputLine = "";
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private updateInput(): void { if (this.currentInputSpan) this.currentInputSpan.textContent = this.inputLine; this.termDiv.scrollTop = this.termDiv.scrollHeight; }

  private appendText(text: string, color = "#e0e0e0"): void {
    const span = document.createElement("span"); span.style.cssText = `white-space:pre-wrap;color:${color};`; span.textContent = text;
    if (this.currentPromptLine) this.termDiv.insertBefore(span, this.currentPromptLine);
    else this.termDiv.appendChild(span);
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private addTrace(event: ShellEvent): void {
    const row = document.createElement("div");
    const colors: Record<string, string> = {
      parse: "#64748b", expand: "#a78bfa", fork: "#3b82f6", exec: "#10b981",
      pipe: "#06b6d4", redirect: "#f59e0b", wait: "#475569", builtin: "#22d3ee",
      signal: "#ef4444", job: "#8b5cf6", stdout: "#94a3b8", stderr: "#f87171",
    };
    row.style.cssText = `padding:1px 12px;color:${colors[event.type] ?? "#94a3b8"};`;
    row.textContent = fmtEvent(event);
    this.traceDiv.appendChild(row);
    this.traceDiv.scrollTop = this.traceDiv.scrollHeight;
  }
}

function fmtEvent(e: ShellEvent): string {
  switch (e.type) {
    case "parse": return `parse: ${e.ast.slice(0, 80)}...`;
    case "expand": return `expand: ${e.original} -> ${e.expanded}`;
    case "fork": return `fork(${String(e.pid)}): ${e.command}`;
    case "exec": return `exec(${String(e.pid)}): ${e.command} ${e.args.join(" ")}`;
    case "pipe": return `pipe: ${String(e.fromPid)} | ${String(e.toPid)}`;
    case "redirect": return `redirect: fd${String(e.fd)} ${e.mode} ${e.target}`;
    case "wait": return `wait(${String(e.pid)}): exit ${String(e.exitCode)}`;
    case "builtin": return `builtin: ${e.command}`;
    case "signal": return `signal: ${e.signal} -> ${String(e.pid)}`;
    case "job": return `job[${String(e.jobId)}] ${e.action}: ${e.command}`;
    case "stdout": return `> ${e.text.trimEnd().slice(0, 60)}`;
    case "stderr": return `! ${e.text.trimEnd()}`;
  }
}
