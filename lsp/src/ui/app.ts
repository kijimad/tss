import { LanguageServer } from "../engine/lsp.js";
import type { JsonRpcRequest, LspTrace } from "../engine/lsp.js";

export interface Example {
  name: string;
  description: string;
  uri: string;
  code: string;
  /** 初期化後に送信するリクエストシーケンス */
  requests: JsonRpcRequest[];
}

let reqId = 10;
const mkReq = (method: string, params: unknown): JsonRpcRequest => ({ jsonrpc: "2.0", id: reqId++, method, params });

const code1 = `function greet(name: string): string {
  const message = "Hello, " + name;
  console.log(message);
  return message;
}

const result = greet("World");`;

const code2 = `interface User {
  id: number;
  name: string;
  email: string;
}

function getUser(id: number): User {
  var user = { id: id, name: "Alice", email: "alice@example.com" };
  return user;
}

const user: any = getUser(1);
console.log(user.name);`;

const code3 = `class Calculator {
  private value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  add(n: number): Calculator {
    this.value += n;
    return this;
  }

  getResult(): number {
    return this.value;
  }
}

const calc = new Calculator(0);
const result = calc.add(5).add(3).getResult();`;

const URI = "file:///src/main.ts";

export const EXAMPLES: Example[] = [
  {
    name: "補完 (Completion)",
    description: "カーソル位置で利用可能なシンボルの補完候補を取得。関数・変数・キーワードが提案される。",
    uri: URI, code: code1,
    requests: [
      mkReq("textDocument/completion", { textDocument: { uri: URI }, position: { line: 6, character: 18 } }),
      mkReq("textDocument/completion", { textDocument: { uri: URI }, position: { line: 6, character: 5 } }),
    ],
  },
  {
    name: "ホバー情報 (Hover)",
    description: "シンボルにカーソルを合わせて型情報とドキュメントを表示。",
    uri: URI, code: code1,
    requests: [
      mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 0, character: 10 } }),
      mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 1, character: 8 } }),
      mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 6, character: 6 } }),
    ],
  },
  {
    name: "定義ジャンプ + 参照検索",
    description: "シンボルの定義位置へジャンプし、全参照箇所を検索。",
    uri: URI, code: code1,
    requests: [
      mkReq("textDocument/definition", { textDocument: { uri: URI }, position: { line: 6, character: 18 } }),
      mkReq("textDocument/references", { textDocument: { uri: URI }, position: { line: 0, character: 10 } }),
      mkReq("textDocument/references", { textDocument: { uri: URI }, position: { line: 1, character: 8 } }),
    ],
  },
  {
    name: "診断 (Diagnostics: var, any, console.log)",
    description: "didOpen 時に診断が自動発行される。var→warn, any→info, console.log→hint。",
    uri: URI, code: code2,
    requests: [
      mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 6, character: 10 } }),
    ],
  },
  {
    name: "リネーム (Rename)",
    description: "シンボル名を一括変更。全参照箇所の WorkspaceEdit を生成。",
    uri: URI, code: code1,
    requests: [
      mkReq("textDocument/references", { textDocument: { uri: URI }, position: { line: 0, character: 10 } }),
      mkReq("textDocument/rename", { textDocument: { uri: URI }, position: { line: 0, character: 10 }, newName: "sayHello" }),
    ],
  },
  {
    name: "フォーマット (Formatting)",
    description: "ドキュメント全体のインデントを自動修正。",
    uri: URI, code: "function foo(){\nconst x = 1;\nif (x) {\nconsole.log(x);\n}\n}",
    requests: [
      mkReq("textDocument/formatting", { textDocument: { uri: URI }, options: { tabSize: 2 } }),
    ],
  },
  {
    name: "クラスのシンボル解析",
    description: "クラス・メソッド・プロパティのシンボルを解析し、補完・ホバー・定義ジャンプを確認。",
    uri: URI, code: code3,
    requests: [
      mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 0, character: 6 } }),
      mkReq("textDocument/completion", { textDocument: { uri: URI }, position: { line: 17, character: 8 } }),
      mkReq("textDocument/definition", { textDocument: { uri: URI }, position: { line: 17, character: 19 } }),
      mkReq("textDocument/references", { textDocument: { uri: URI }, position: { line: 0, character: 6 } }),
    ],
  },
  {
    name: "初期化 (initialize) + Capabilities",
    description: "LSP の初期化ハンドシェイク。サーバーの Capabilities (対応機能) を確認。",
    uri: URI, code: code1,
    requests: [],
  },
];

function dirColor(d: LspTrace["direction"]): string {
  return d === "client→server" ? "#3b82f6" : "#22c55e";
}
function typeColor(t: LspTrace["messageType"]): string {
  switch (t) { case "request": return "#f59e0b"; case "response": return "#22c55e"; case "notification": return "#a78bfa"; }
}

export class LspApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "LSP Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Execute";
    runBtn.style.cssText = "padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ソースコード + シンボル
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:380px;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "Source Code (TextDocument)";
    leftPanel.appendChild(codeLabel);
    const codeArea = document.createElement("pre");
    codeArea.style.cssText = "flex:1;padding:8px 12px;font-size:11px;color:#94a3b8;overflow-y:auto;margin:0;line-height:1.6;border-bottom:1px solid #1e293b;white-space:pre;";
    leftPanel.appendChild(codeArea);

    const symLabel = document.createElement("div");
    symLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    symLabel.textContent = "Symbol Table";
    leftPanel.appendChild(symLabel);
    const symDiv = document.createElement("div");
    symDiv.style.cssText = "max-height:140px;padding:4px 8px;font-size:9px;overflow-y:auto;";
    leftPanel.appendChild(symDiv);
    main.appendChild(leftPanel);

    // 右: JSON-RPC トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "JSON-RPC Message Trace";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderCode = (code: string) => {
      codeArea.innerHTML = "";
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lineEl = document.createElement("div");
        lineEl.style.cssText = "display:flex;";
        const num = document.createElement("span");
        num.style.cssText = "color:#334155;min-width:24px;text-align:right;margin-right:8px;user-select:none;";
        num.textContent = String(i);
        lineEl.appendChild(num);
        const text = document.createElement("span");
        text.textContent = lines[i] ?? "";
        lineEl.appendChild(text);
        codeArea.appendChild(lineEl);
      }
    };

    const renderSymbols = (server: LanguageServer, uri: string) => {
      symDiv.innerHTML = "";
      const syms = server.getSymbols(uri);
      for (const s of syms) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:2px;display:flex;gap:4px;";
        const kindColor = s.kind === "function" || s.kind === "method" ? "#22c55e" : s.kind === "class" ? "#f59e0b" : s.kind === "interface" ? "#06b6d4" : "#3b82f6";
        el.innerHTML =
          `<span style="color:${kindColor};min-width:55px;font-weight:600;">${s.kind}</span>` +
          `<span style="color:#e2e8f0;">${s.name}</span>` +
          `<span style="color:#64748b;">: ${s.type}</span>` +
          `<span style="color:#475569;"> L${s.location.range.start.line} (${s.references.length} refs)</span>`;
        symDiv.appendChild(el);
      }
    };

    const renderTrace = (trace: readonly LspTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:4px;border:1px solid #1e293b;border-radius:4px;padding:4px 6px;";

        const hdr = document.createElement("div");
        hdr.style.cssText = "display:flex;gap:4px;align-items:center;margin-bottom:2px;";
        hdr.innerHTML =
          `<span style="color:${dirColor(step.direction)};font-weight:600;font-size:10px;">${step.direction}</span>` +
          `<span style="padding:0 4px;border-radius:2px;font-size:8px;font-weight:600;color:${typeColor(step.messageType)};background:${typeColor(step.messageType)}15;border:1px solid ${typeColor(step.messageType)}33;">${step.messageType}</span>` +
          `<span style="color:#e2e8f0;font-weight:600;">${step.method}</span>` +
          (step.durationMs > 0 ? `<span style="color:#64748b;margin-left:auto;">${step.durationMs}ms</span>` : "");
        el.appendChild(hdr);

        const summary = document.createElement("div");
        summary.style.cssText = "color:#94a3b8;margin-bottom:2px;";
        summary.textContent = step.summary;
        el.appendChild(summary);

        // JSON メッセージ (折りたたみ)
        const details = document.createElement("details");
        details.style.cssText = "font-size:8px;";
        const sumEl = document.createElement("summary");
        sumEl.style.cssText = "color:#475569;cursor:pointer;";
        sumEl.textContent = "JSON-RPC メッセージ";
        details.appendChild(sumEl);
        const pre = document.createElement("pre");
        pre.style.cssText = "color:#64748b;margin:2px 0 0;white-space:pre-wrap;max-height:100px;overflow-y:auto;";
        pre.textContent = JSON.stringify(step.fullMessage, null, 2);
        details.appendChild(pre);
        el.appendChild(details);

        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderCode(ex.code);
      symDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      reqId = 10;
      const server = new LanguageServer();
      server.resetTrace();

      // 1. initialize
      server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } });

      // 2. didOpen
      server.handleRequest({ jsonrpc: "2.0", id: 2, method: "textDocument/didOpen", params: { textDocument: { uri: ex.uri, languageId: "typescript", version: 1, text: ex.code } } });

      // 3. ユーザーリクエスト
      for (const req of ex.requests) {
        server.handleRequest(req);
      }

      renderCode(ex.code);
      renderSymbols(server, ex.uri);
      renderTrace(server.traceLog);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
