import { PseudoTerminal, type PtyEvent } from "../pty/pty.js";
import { TerminalScreen, ANSI_COLORS, type Cell } from "../terminal/screen.js";
import { Shell } from "../shell/shell.js";

const COLS = 80;
const ROWS = 24;
const CELL_W = 8.4;
const CELL_H = 18;

/** ターミナルに送信するサンプル入力の定義 */
interface TerminalExample {
  /** 表示名 */
  name: string;
  /** 送信する入力文字列の配列（順番に送信される） */
  inputs: string[];
}

/** デモ用のサンプル入力一覧 */
export const EXAMPLES: TerminalExample[] = [
  {
    name: "基本入力",
    inputs: [
      "ls -la\r",
      "echo Hello, World!\r",
    ],
  },
  {
    name: "ANSIカラー",
    inputs: [
      "echo \x1b[31m赤色\x1b[0m \x1b[32m緑色\x1b[0m \x1b[34m青色\x1b[0m \x1b[1;33m太字黄色\x1b[0m\r",
    ],
  },
  {
    name: "カーソル移動",
    inputs: [
      "echo \x1b[5;10HHERE \x1b[1;1HTOP-LEFT \x1b[10;30HMIDDLE\r",
    ],
  },
  {
    name: "画面クリア",
    inputs: [
      "echo \x1b[2J\x1b[H画面をクリアしました\r",
    ],
  },
];

export class VtermApp {
  private pty!: PseudoTerminal;
  private screen!: TerminalScreen;
  private shell!: Shell;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private ptyLogDiv!: HTMLElement;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#1a1a2e;color:#e0e0e0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333;";
    const dots = document.createElement("div"); dots.style.cssText = "display:flex;gap:6px;";
    for (const c of ["#ff5f56", "#ffbd2e", "#27c93f"]) { const d = document.createElement("div"); d.style.cssText = `width:12px;height:12px;border-radius:50%;background:${c};`; dots.appendChild(d); }
    header.appendChild(dots);
    const t = document.createElement("span"); t.textContent = `vterm  ${String(COLS)}x${String(ROWS)}`; t.style.cssText = "color:#888;font-size:12px;"; header.appendChild(t);

    // サンプル入力を選択するドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText = "margin-left:auto;padding:2px 8px;font-size:12px;background:#2a2a3e;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "-- サンプル選択 --";
    exampleSelect.appendChild(defaultOption);
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exampleSelect.appendChild(opt);
    }
    exampleSelect.addEventListener("change", () => {
      const idx = parseInt(exampleSelect.value, 10);
      if (!isNaN(idx) && idx >= 0 && idx < EXAMPLES.length) {
        this.sendExample(EXAMPLES[idx]!);
      }
      // 選択をリセットして再度同じサンプルを選べるようにする
      exampleSelect.value = "";
      this.canvas.focus();
    });
    header.appendChild(exampleSelect);

    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: Canvas ターミナル
    const termWrap = document.createElement("div");
    termWrap.style.cssText = "flex:1;display:flex;align-items:flex-start;justify-content:center;padding:8px;background:#0c0c0c;";
    this.canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    const cw = COLS * CELL_W;
    const ch = ROWS * CELL_H;
    this.canvas.width = cw * dpr;
    this.canvas.height = ch * dpr;
    this.canvas.style.cssText = `width:${String(cw)}px;height:${String(ch)}px;outline:none;`;
    this.canvas.tabIndex = 0;
    termWrap.appendChild(this.canvas);
    const ctxOrNull = this.canvas.getContext("2d");
    if (ctxOrNull === null) throw new Error("Canvas failed");
    this.ctx = ctxOrNull;
    this.ctx.scale(dpr, dpr);
    main.appendChild(termWrap);

    // 右: PTY ログ
    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width:340px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";
    const logTitle = document.createElement("div");
    logTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #333;";
    logTitle.textContent = "PTY / Escape Sequence Trace";
    sidebar.appendChild(logTitle);
    this.ptyLogDiv = document.createElement("div");
    this.ptyLogDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;";
    sidebar.appendChild(this.ptyLogDiv);
    main.appendChild(sidebar);
    container.appendChild(main);

    // PTY + Screen + Shell 初期化
    this.pty = new PseudoTerminal();
    this.pty.cols = COLS;
    this.pty.rows = ROWS;
    this.screen = new TerminalScreen(ROWS, COLS);

    // PTY → Screen → Canvas
    this.pty.onMasterRead = (data) => {
      this.screen.write(data);
      this.render();
    };
    this.pty.onEvent = (e) => this.addPtyLog(e);
    this.screen.onEvent = (e) => {
      if (e.type === "escape") this.addEscLog(e.sequence, e.description);
    };

    this.shell = new Shell(this.pty);
    this.shell.start();
    this.render();

    // キーボード入力
    this.canvas.addEventListener("keydown", (e) => this.handleKey(e));
    this.canvas.focus();
    this.canvas.addEventListener("click", () => this.canvas.focus());

    // カーソル点滅
    setInterval(() => this.render(), 500);
  }

  private handleKey(e: KeyboardEvent): void {
    e.preventDefault();
    if (e.ctrlKey) {
      const code = e.key.toUpperCase().charCodeAt(0) - 64;
      if (code >= 1 && code <= 26) { this.pty.masterWrite(String.fromCharCode(code)); return; }
    }
    if (e.key === "Enter") { this.pty.masterWrite("\r"); return; }
    if (e.key === "Backspace") { this.pty.masterWrite("\x7f"); return; }
    if (e.key === "Tab") { this.pty.masterWrite("\t"); return; }
    if (e.key === "Escape") { this.pty.masterWrite("\x1b"); return; }
    if (e.key === "ArrowUp") { this.pty.masterWrite("\x1b[A"); return; }
    if (e.key === "ArrowDown") { this.pty.masterWrite("\x1b[B"); return; }
    if (e.key === "ArrowRight") { this.pty.masterWrite("\x1b[C"); return; }
    if (e.key === "ArrowLeft") { this.pty.masterWrite("\x1b[D"); return; }
    if (e.key.length === 1) { this.pty.masterWrite(e.key); }
  }

  // Canvas レンダリング
  private render(): void {
    const ctx = this.ctx;
    const cw = COLS * CELL_W;
    const ch = ROWS * CELL_H;
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, cw, ch);

    ctx.font = `${String(CELL_H - 4)}px 'Cascadia Code','Fira Code','Consolas',monospace`;
    ctx.textBaseline = "top";

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = this.screen.getCell(r, c);
        const x = c * CELL_W;
        const y = r * CELL_H;

        let fg = cell.fg >= 0 ? (ANSI_COLORS[cell.fg] ?? "#e0e0e0") : "#e0e0e0";
        let bg = cell.bg >= 0 ? (ANSI_COLORS[cell.bg] ?? "transparent") : "transparent";
        if (cell.inverse) { const tmp = fg; fg = bg === "transparent" ? "#0c0c0c" : bg; bg = tmp; }
        if (cell.bold && cell.fg >= 0 && cell.fg < 8) fg = ANSI_COLORS[cell.fg + 8] ?? fg;

        // 背景
        if (bg !== "transparent") {
          ctx.fillStyle = bg;
          ctx.fillRect(x, y, CELL_W, CELL_H);
        }

        // カーソル
        if (r === this.screen.cursorRow && c === this.screen.cursorCol) {
          const blink = Math.floor(Date.now() / 500) % 2 === 0;
          if (blink) {
            ctx.fillStyle = "#e0e0e0";
            ctx.fillRect(x, y, CELL_W, CELL_H);
            fg = "#0c0c0c";
          }
        }

        // 文字
        if (cell.char !== " ") {
          ctx.fillStyle = fg;
          const fontWeight = cell.bold ? "bold " : "";
          ctx.font = `${fontWeight}${String(CELL_H - 4)}px 'Cascadia Code','Fira Code','Consolas',monospace`;
          ctx.fillText(cell.char, x + 1, y + 2);
        }

        // 下線
        if (cell.underline) {
          ctx.strokeStyle = fg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y + CELL_H - 2);
          ctx.lineTo(x + CELL_W, y + CELL_H - 2);
          ctx.stroke();
        }
      }
    }
  }

  private addPtyLog(event: PtyEvent): void {
    const row = document.createElement("div");
    const colors: Record<string, string> = {
      master_write: "#3b82f6", slave_write: "#10b981", master_read: "#64748b",
      slave_read: "#94a3b8", signal: "#ef4444", echo: "#475569",
      line_complete: "#f59e0b", resize: "#a78bfa",
    };
    row.style.cssText = `padding:1px 12px;color:${colors[event.type] ?? "#94a3b8"};`;
    switch (event.type) {
      case "master_write": row.textContent = `kbd → pty: "${event.data}" [${event.raw.map(n => n.toString(16).padStart(2, "0")).join(" ")}]`; break;
      case "slave_write": row.textContent = `shell → pty: "${event.data.slice(0, 60)}${event.data.length > 60 ? "..." : ""}"`; break;
      case "signal": row.textContent = `SIGNAL: ${event.signal} (${event.key})`; break;
      case "echo": row.textContent = `echo: '${event.char}'`; break;
      case "line_complete": row.textContent = `line: "${event.line}"`; break;
      default: row.textContent = `${event.type}`;
    }
    this.ptyLogDiv.appendChild(row);
    this.ptyLogDiv.scrollTop = this.ptyLogDiv.scrollHeight;
  }

  /** サンプル入力をターミナルに順番に送信する */
  private sendExample(example: TerminalExample): void {
    for (const input of example.inputs) {
      this.pty.masterWrite(input);
    }
  }

  private addEscLog(sequence: string, description: string): void {
    const row = document.createElement("div");
    row.style.cssText = "padding:1px 12px;color:#a78bfa;";
    row.textContent = `ESC: ${sequence} — ${description}`;
    this.ptyLogDiv.appendChild(row);
    this.ptyLogDiv.scrollTop = this.ptyLogDiv.scrollHeight;
  }
}
