/**
 * app.ts -- SSH シミュレータの UI モジュール
 *
 * ブラウザ上でターミナル風のインターフェースを提供し、
 * SSH 接続のプロトコルトレースをリアルタイムで可視化する。
 * セレクトボックスからプリセット接続設定を選択し、
 * パスワード認証・公開鍵認証によるSSH接続を体験できる。
 */
import { SshServer, SshSession, type SshEvent } from "../protocol/ssh.js";
import { generateKeyPair } from "../crypto/crypto.js";

/** プリセット例の型定義 */
export interface SshExample {
  label: string;
  host: string;
  password: string;
  authType: "password" | "publickey";
}

/** フォームに事前入力するためのサンプル接続設定 */
export const EXAMPLES: SshExample[] = [
  { label: "パスワード認証", host: "user@server.example.com", password: "secret123", authType: "password" },
  { label: "公開鍵認証", host: "admin@prod.example.com", password: "", authType: "publickey" },
  { label: "別ユーザー", host: "root@192.168.1.1", password: "toor", authType: "password" },
];

/**
 * SSH シミュレータのメインアプリケーションクラス
 *
 * ターミナルエミュレータ、プロトコルトレース表示、接続フォーム、
 * コマンド入力・履歴管理をすべて管理する。
 */
export class SshApp {
  /** 現在のSSHセッション（未接続時はundefined） */
  private session: SshSession | undefined;
  /** エミュレート対象のSSHサーバ */
  private server!: SshServer;
  /** ターミナル表示領域のDOM要素 */
  private termDiv!: HTMLElement;
  /** プロトコルトレース表示領域のDOM要素 */
  private protoDiv!: HTMLElement;
  /** 現在の入力行テキスト */
  private inputLine = "";
  /** コマンド入力履歴 */
  private history: string[] = [];
  /** 履歴の現在位置インデックス */
  private historyIdx = -1;
  /** 現在の入力テキストを表示するspan要素 */
  private currentInputSpan: HTMLSpanElement | null = null;
  /** 点滅カーソルのspan要素 */
  private currentCursor: HTMLSpanElement | null = null;
  /** 現在のプロンプト行のdiv要素 */
  private currentPromptLine: HTMLDivElement | null = null;

  /**
   * アプリケーションを初期化し、UIをコンテナ要素内に構築する
   *
   * ヘッダー（サンプル選択、接続フォーム）、ターミナル領域、
   * プロトコルトレースサイドバーを生成し、イベントリスナーを設定する。
   *
   * @param container - UIを描画する親HTML要素
   */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Cascadia Code',monospace;background:#0c0c0c;color:#e0e0e0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;background:#1a1a2e;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333;flex-wrap:wrap;";
    const dots = document.createElement("div"); dots.style.cssText = "display:flex;gap:6px;";
    for (const c of ["#ff5f56", "#ffbd2e", "#27c93f"]) { const d = document.createElement("div"); d.style.cssText = `width:10px;height:10px;border-radius:50%;background:${c};`; dots.appendChild(d); }
    header.appendChild(dots);
    const t = document.createElement("span"); t.textContent = "SSH Simulator"; t.style.cssText = "color:#10b981;font-size:12px;font-weight:600;"; header.appendChild(t);

    // サンプル選択ドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText = "padding:2px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:11px;font-family:monospace;";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- サンプルを選択 --";
    exampleSelect.appendChild(defaultOpt);
    for (const [i, ex] of EXAMPLES.entries()) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = ex.label;
      exampleSelect.appendChild(opt);
    }
    header.appendChild(exampleSelect);

    // 接続フォーム
    const hostInput = document.createElement("input"); hostInput.value = "user@192.168.1.100"; hostInput.style.cssText = "padding:2px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:11px;width:160px;font-family:monospace;";
    const passInput = document.createElement("input"); passInput.value = "password"; passInput.type = "password"; passInput.style.cssText = hostInput.style.cssText + "width:100px;";
    const connectBtn = document.createElement("button"); connectBtn.textContent = "ssh connect"; connectBtn.style.cssText = "padding:2px 12px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;";
    const pubkeyBtn = document.createElement("button"); pubkeyBtn.textContent = "ssh (pubkey)"; pubkeyBtn.style.cssText = "padding:2px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;";
    header.appendChild(hostInput); header.appendChild(passInput); header.appendChild(connectBtn); header.appendChild(pubkeyBtn);

    // サンプル選択時にフォームへ値をプリセットする（自動接続はしない）
    exampleSelect.addEventListener("change", () => {
      const idx = Number(exampleSelect.value);
      if (Number.isNaN(idx) || exampleSelect.value === "") return;
      const ex = EXAMPLES[idx];
      if (!ex) return;
      hostInput.value = ex.host;
      passInput.value = ex.password;
    });
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    this.termDiv = document.createElement("div");
    this.termDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;font-size:13px;line-height:1.6;cursor:text;outline:none;";
    this.termDiv.tabIndex = 0;
    main.appendChild(this.termDiv);

    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width:420px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";
    const pTitle = document.createElement("div"); pTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #333;"; pTitle.textContent = "SSH Protocol Trace"; sidebar.appendChild(pTitle);
    this.protoDiv = document.createElement("div"); this.protoDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;"; sidebar.appendChild(this.protoDiv);
    main.appendChild(sidebar);
    container.appendChild(main);

    const style = document.createElement("style"); style.textContent = "@keyframes blink { 50% { opacity: 0; } }"; document.head.appendChild(style);

    this.server = new SshServer("webserver", "192.168.1.100");

    this.appendText("SSH Simulator\nUse the controls above to connect.\n\n");
    this.showLocalPrompt();

    connectBtn.addEventListener("click", () => {
      const [userHost] = hostInput.value.split("@");
      const username = userHost ?? "user";
      this.doConnect(username, "password", passInput.value);
    });
    pubkeyBtn.addEventListener("click", () => {
      const [userHost] = hostInput.value.split("@");
      const username = userHost ?? "user";
      const clientKey = generateKeyPair("client");
      this.server.addAuthorizedKey(username, clientKey.publicKey);
      this.doConnect(username, "publickey", clientKey.publicKey, clientKey);
    });

    this.termDiv.addEventListener("keydown", (e) => this.handleKey(e));
    this.termDiv.focus();
    this.termDiv.addEventListener("click", () => this.termDiv.focus());
  }

  /**
   * SSH 接続を実行する
   *
   * セッションを作成し、ハンドシェイクを実行して接続結果をターミナルに表示する。
   *
   * @param username - 接続ユーザ名
   * @param method - 認証方式
   * @param credential - パスワードまたは公開鍵
   * @param keyPair - 公開鍵認証時の鍵ペア（省略可）
   */
  private doConnect(username: string, method: "password" | "publickey", credential: string, keyPair?: ReturnType<typeof generateKeyPair>): void {
    this.protoDiv.innerHTML = "";
    this.session = new SshSession(this.server);
    this.session.onEvent = (e) => this.addProtoEvent(e);

    this.appendText(`Connecting to ${this.server.ip}:22...\n`);
    const ok = this.session.connect(username, method, credential, keyPair);
    if (ok) {
      this.appendText(`Connected to ${this.server.hostname}.\n\n`, "#10b981");
      this.showRemotePrompt();
    } else {
      this.appendText("Permission denied.\n", "#ef4444");
      this.session = undefined;
      this.showLocalPrompt();
    }
  }

  /**
   * キーボード入力を処理する
   *
   * Enter: コマンド実行、Backspace: 文字削除、
   * 上下矢印: 履歴ナビゲーション、通常文字: 入力追加
   */
  private handleKey(e: KeyboardEvent): void {
    if (e.isComposing) return; e.preventDefault(); e.stopPropagation();
    if (e.key === "Enter") {
      this.currentCursor?.remove(); this.termDiv.appendChild(document.createElement("br"));
      const cmd = this.inputLine; this.inputLine = ""; this.currentInputSpan = null; this.currentPromptLine = null;
      if (cmd.trim()) { this.history.push(cmd); this.historyIdx = this.history.length; }
      if (this.session?.isConnected()) {
        if (cmd.trim() === "exit") {
          this.session.disconnect();
          this.session = undefined;
          this.appendText("Connection closed.\n\n");
          this.showLocalPrompt();
        } else {
          const output = this.session.executeCommand(cmd);
          this.appendText(output);
          if (this.session?.isConnected()) this.showRemotePrompt();
          else { this.appendText("Connection closed.\n"); this.showLocalPrompt(); }
        }
      } else {
        this.appendText(`local: ${cmd}: use the buttons above to connect\n`);
        this.showLocalPrompt();
      }
      return;
    }
    if (e.key === "Backspace") { if (this.inputLine.length > 0) { this.inputLine = this.inputLine.slice(0, -1); this.updateInput(); } return; }
    if (e.key === "ArrowUp") { if (this.historyIdx > 0) { this.historyIdx--; this.inputLine = this.history[this.historyIdx] ?? ""; this.updateInput(); } return; }
    if (e.key === "ArrowDown") { if (this.historyIdx < this.history.length - 1) { this.historyIdx++; this.inputLine = this.history[this.historyIdx] ?? ""; } else { this.historyIdx = this.history.length; this.inputLine = ""; } this.updateInput(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { this.inputLine += e.key; this.updateInput(); }
  }

  /** ローカルシェルのプロンプトを表示する */
  private showLocalPrompt(): void { this.showPrompt("local$ ", "#94a3b8"); }
  /** リモートサーバのプロンプトを表示する */
  private showRemotePrompt(): void {
    const u = this.session?.getUsername() ?? "user";
    const h = this.session?.getHostname() ?? "host";
    this.showPrompt(`${u}@${h}:~$ `, "#10b981");
  }

  private showPrompt(text: string, color: string): void {
    const line = document.createElement("div"); line.style.cssText = "display:flex;white-space:pre;";
    const ps = document.createElement("span"); ps.style.cssText = `color:${color};`; ps.textContent = text; line.appendChild(ps);
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

  private addProtoEvent(event: SshEvent): void {
    const row = document.createElement("div");
    row.style.cssText = `padding:2px 12px;border-bottom:1px solid #1e293b11;`;

    switch (event.type) {
      case "send": {
        const dir = event.from === "client" ? "\u2192" : "\u2190";
        const color = event.from === "client" ? "#3b82f6" : "#10b981";
        const lockIcon = event.encrypted ? "\uD83D\uDD12" : "";
        const msgType = event.message.type.replace(/_/g, " ");
        row.style.color = color;

        let detail = msgType;
        if (event.message.type === "version") detail = `${msgType}: ${event.message.version}`;
        if (event.message.type === "kex_dh_init") detail = `${msgType}: pub=${String(event.message.clientPublicKey)}`;
        if (event.message.type === "kex_dh_reply") detail = `${msgType}: pub=${String(event.message.serverPublicKey)}`;
        if (event.message.type === "userauth_request") detail = `${msgType}: ${event.message.username} (${event.message.method})`;
        if (event.message.type === "channel_data") {
          const preview = event.message.data.slice(0, 40).replace(/\n/g, "\\n");
          detail = `data: "${preview}"`;
        }
        row.textContent = `${lockIcon} ${dir} [${event.from}] ${detail}`;
        if (event.encrypted && event.message.type === "channel_data") {
          const raw = document.createElement("div");
          raw.style.cssText = "color:#475569;font-size:9px;padding-left:20px;word-break:break-all;";
          raw.textContent = `encrypted: ${event.raw.slice(0, 50)}...`;
          row.appendChild(raw);
        }
        break;
      }
      case "crypto": {
        row.style.color = "#f59e0b";
        row.textContent = `\uD83D\uDD11 ${event.operation}`;
        if (event.detail) {
          const d = document.createElement("div");
          d.style.cssText = "color:#94a3b8;font-size:9px;padding-left:20px;word-break:break-all;";
          d.textContent = event.detail;
          row.appendChild(d);
        }
        break;
      }
      case "auth": {
        row.style.color = event.success ? "#10b981" : "#ef4444";
        row.textContent = `${event.success ? "\u2705" : "\u274C"} Auth ${event.method}: ${event.username} ${event.success ? "OK" : "FAILED"}`;
        break;
      }
      case "info": {
        row.style.color = "#64748b";
        row.style.fontWeight = "600";
        row.textContent = event.message;
        break;
      }
    }

    this.protoDiv.appendChild(row);
    this.protoDiv.scrollTop = this.protoDiv.scrollHeight;
  }
}
