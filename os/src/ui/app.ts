/**
 * app.ts — BrowserOS ターミナルUI
 */
import { Kernel } from "../kernel/kernel.js";
import { Shell } from "../shell/shell.js";

/** サンプルコマンド集の型定義 */
interface Example {
  /** ドロップダウンに表示する名前 */
  name: string;
  /** 順次実行するコマンドのリスト */
  commands: string[];
}

/** ドロップダウンから選べるサンプルコマンド集 */
export const EXAMPLES: Example[] = [
  {
    name: "基本コマンド",
    commands: ["help", "ls /", "echo Hello BrowserOS!", "cat /etc/hostname"],
  },
  {
    name: "ファイルシステム",
    commands: [
      "mkdir /tmp/demo",
      "touch /tmp/demo/empty.txt",
      "write /tmp/demo/note.txt これはテストです",
      "ls /tmp/demo",
      "cat /tmp/demo/note.txt",
    ],
  },
  {
    name: "プロセス管理",
    commands: ["ps", "run hello", "run counter", "ps"],
  },
  {
    name: "システム情報",
    commands: ["uname", "pwd", "stat /bin/hello", "ls /bin"],
  },
];

export class OsApp {
  private kernel!: Kernel;
  private shell!: Shell;
  private termDiv!: HTMLElement;
  private inputLine = "";
  private history: string[] = [];
  private historyIndex = -1;

  // 現在のプロンプト行の要素を直接保持
  private currentInputSpan: HTMLSpanElement | null = null;
  private currentCursor: HTMLSpanElement | null = null;
  private currentPromptLine: HTMLDivElement | null = null;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;background:#0c0c0c;font-family:'Cascadia Code','Fira Code','Consolas',monospace;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;background:#1a1a2e;color:#e0e0e0;font-size:13px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333;";
    const dots = document.createElement("div");
    dots.style.cssText = "display:flex;gap:6px;";
    for (const color of ["#ff5f56", "#ffbd2e", "#27c93f"]) {
      const dot = document.createElement("div");
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};`;
      dots.appendChild(dot);
    }
    header.appendChild(dots);
    const titleSpan = document.createElement("span");
    titleSpan.textContent = "BrowserOS Terminal";
    titleSpan.style.cssText = "color:#888;font-size:12px;";
    header.appendChild(titleSpan);

    // サンプル選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText =
      "margin-left:auto;padding:4px 8px;background:#2a2a3e;color:#e0e0e0;border:1px solid #555;border-radius:4px;font-size:12px;font-family:inherit;cursor:pointer;";
    // デフォルトの未選択項目
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- サンプルを選択 --";
    select.appendChild(defaultOpt);
    // 各サンプルを選択肢として追加
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      const idx = Number(select.value);
      if (!Number.isNaN(idx) && EXAMPLES[idx] !== undefined) {
        this.executeExample(EXAMPLES[idx]);
      }
      // 選択状態をリセットして再度同じサンプルを選べるようにする
      select.value = "";
    });
    header.appendChild(select);

    container.appendChild(header);

    // ターミナル本体
    this.termDiv = document.createElement("div");
    this.termDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;font-size:14px;line-height:1.6;color:#e0e0e0;cursor:text;outline:none;";
    this.termDiv.tabIndex = 0;
    container.appendChild(this.termDiv);

    // ブリンクアニメーション
    const style = document.createElement("style");
    style.textContent = "@keyframes blink { 50% { opacity: 0; } }";
    document.head.appendChild(style);

    // カーネル起動
    this.kernel = new Kernel();
    this.kernel.boot();
    this.shell = new Shell(this.kernel);
    this.shell.onOutput = (text) => this.appendOutput(text);
    this.shell.onClear = () => {
      this.termDiv.innerHTML = "";
    };

    // 起動メッセージ
    this.appendOutput("BrowserOS 0.1.0\n");
    this.appendOutput("Type 'help' for available commands.\n\n");
    this.showPrompt();

    // キーボード入力
    this.termDiv.addEventListener("keydown", (e) => this.handleKey(e));
    this.termDiv.focus();
    this.termDiv.addEventListener("click", () => this.termDiv.focus());
  }

  private handleKey(e: KeyboardEvent): void {
    // IME 変換中は無視
    if (e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Enter") {
      // カーソルを消す
      this.currentCursor?.remove();
      this.currentCursor = null;
      // 改行
      this.termDiv.appendChild(document.createElement("br"));
      const cmd = this.inputLine;
      this.inputLine = "";
      this.currentInputSpan = null;
      this.currentPromptLine = null;

      if (cmd.trim().length > 0) {
        this.history.push(cmd);
        this.historyIndex = this.history.length;
      }

      this.shell.execute(cmd);
      this.showPrompt();
      return;
    }

    if (e.key === "Backspace") {
      if (this.inputLine.length > 0) {
        this.inputLine = this.inputLine.slice(0, -1);
        this.updateInput();
      }
      return;
    }

    if (e.key === "ArrowUp") {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.inputLine = this.history[this.historyIndex] ?? "";
        this.updateInput();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.inputLine = this.history[this.historyIndex] ?? "";
      } else {
        this.historyIndex = this.history.length;
        this.inputLine = "";
      }
      this.updateInput();
      return;
    }

    if (e.ctrlKey && e.key === "l") {
      this.termDiv.innerHTML = "";
      this.showPrompt();
      return;
    }

    // 通常の文字入力
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      this.inputLine += e.key;
      this.updateInput();
    }
  }

  // 新しいプロンプト行を作成
  private showPrompt(): void {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;white-space:pre;";

    // プロンプト文字列
    const promptSpan = document.createElement("span");
    promptSpan.style.cssText = "color:#27c93f;";
    promptSpan.textContent = this.shell.getPrompt();
    line.appendChild(promptSpan);

    // 入力テキスト
    const inputSpan = document.createElement("span");
    inputSpan.textContent = "";
    line.appendChild(inputSpan);

    // カーソル
    const cursor = document.createElement("span");
    cursor.style.cssText = "background:#e0e0e0;color:#0c0c0c;animation:blink 1s step-end infinite;";
    cursor.textContent = "\u00A0"; // &nbsp;
    line.appendChild(cursor);

    this.termDiv.appendChild(line);

    // 参照を保持
    this.currentPromptLine = line;
    this.currentInputSpan = inputSpan;
    this.currentCursor = cursor;
    this.inputLine = "";

    this.scrollToBottom();
  }

  // 入力テキストを更新
  private updateInput(): void {
    if (this.currentInputSpan !== null) {
      this.currentInputSpan.textContent = this.inputLine;
    }
    this.scrollToBottom();
  }

  // テキスト出力（プロンプト行の前に挿入）
  private appendOutput(text: string): void {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (lineText === undefined) continue;

      if (lineText.length > 0) {
        const span = document.createElement("span");
        span.style.cssText = "white-space:pre-wrap;";
        span.textContent = lineText;

        if (this.currentPromptLine !== null) {
          this.termDiv.insertBefore(span, this.currentPromptLine);
        } else {
          this.termDiv.appendChild(span);
        }
      }

      // 最後の要素以外は改行を入れる
      if (i < lines.length - 1) {
        const br = document.createElement("br");
        if (this.currentPromptLine !== null) {
          this.termDiv.insertBefore(br, this.currentPromptLine);
        } else {
          this.termDiv.appendChild(br);
        }
      }
    }
    this.scrollToBottom();
  }

  /** サンプルのコマンドを順次実行する */
  private executeExample(example: Example): void {
    for (const cmd of example.commands) {
      // 入力欄にコマンドを表示してから実行する
      if (this.currentInputSpan !== null) {
        this.currentInputSpan.textContent = cmd;
      }
      // カーソルを消す
      this.currentCursor?.remove();
      this.currentCursor = null;
      // 改行を追加
      this.termDiv.appendChild(document.createElement("br"));
      // コマンド入力状態をリセット
      this.inputLine = "";
      this.currentInputSpan = null;
      this.currentPromptLine = null;
      // コマンドを履歴に追加
      this.history.push(cmd);
      this.historyIndex = this.history.length;
      // シェルでコマンドを実行
      this.shell.execute(cmd);
      // 次のプロンプトを表示
      this.showPrompt();
    }
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }
}
