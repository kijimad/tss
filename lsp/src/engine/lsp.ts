/**
 * lsp.ts — Language Server Protocol シミュレーション
 *
 * JSON-RPC 2.0 トランスポート上で動く LSP の
 * リクエスト/レスポンス/通知をエミュレートする。
 *
 * 対応メソッド:
 *   initialize, textDocument/didOpen, textDocument/didChange,
 *   textDocument/completion, textDocument/hover,
 *   textDocument/definition, textDocument/references,
 *   textDocument/rename, textDocument/formatting,
 *   textDocument/publishDiagnostics
 */

// ── JSON-RPC 2.0 ──

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ── LSP 型 ──

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface CompletionItem {
  label: string;
  kind: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

export interface Diagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4;
  message: string;
  source: string;
}

export interface Hover {
  contents: string;
  range?: Range;
}

export interface SymbolInfo {
  name: string;
  kind: "function" | "variable" | "class" | "interface" | "method" | "property" | "parameter" | "type";
  type: string;
  location: Location;
  references: Location[];
  documentation?: string;
}

// ── トレース ──

export interface LspTrace {
  direction: "client→server" | "server→client";
  messageType: "request" | "response" | "notification";
  method: string;
  summary: string;
  fullMessage: JsonRpcMessage;
  durationMs: number;
}

// ── 補完アイテム種別 (CompletionItemKind) ──

export const CompletionItemKind = {
  Function: 3,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Property: 10,
  Keyword: 14,
  Snippet: 15,
} as const;

// ── 言語サーバー ──

export class LanguageServer {
  private documents = new Map<string, { text: string; version: number; languageId: string }>();
  private symbols = new Map<string, SymbolInfo[]>();
  private initialized = false;

  /** メッセージ交換のトレース */
  private trace: LspTrace[] = [];

  get traceLog(): readonly LspTrace[] {
    return this.trace;
  }

  /** クライアントからのリクエストを処理し、レスポンスとトレースを返す */
  handleRequest(req: JsonRpcRequest): { response: JsonRpcResponse; notifications: JsonRpcNotification[] } {
    const notifications: JsonRpcNotification[] = [];

    this.trace.push({
      direction: "client→server", messageType: "request", method: req.method,
      summary: this.summarizeParams(req.method, req.params), fullMessage: req, durationMs: 0,
    });

    let result: unknown;
    let error: { code: number; message: string } | undefined;
    const start = performance.now();

    try {
      switch (req.method) {
        case "initialize":
          result = this.handleInitialize();
          break;
        case "textDocument/didOpen":
          result = null;
          this.handleDidOpen(req.params as { textDocument: TextDocumentItem });
          notifications.push(this.publishDiagnostics((req.params as { textDocument: TextDocumentItem }).textDocument.uri));
          break;
        case "textDocument/didChange":
          result = null;
          this.handleDidChange(req.params as { textDocument: { uri: string; version: number }; contentChanges: { text: string }[] });
          notifications.push(this.publishDiagnostics((req.params as { textDocument: { uri: string } }).textDocument.uri));
          break;
        case "textDocument/completion":
          result = this.handleCompletion(req.params as { textDocument: TextDocumentIdentifier; position: Position });
          break;
        case "textDocument/hover":
          result = this.handleHover(req.params as { textDocument: TextDocumentIdentifier; position: Position });
          break;
        case "textDocument/definition":
          result = this.handleDefinition(req.params as { textDocument: TextDocumentIdentifier; position: Position });
          break;
        case "textDocument/references":
          result = this.handleReferences(req.params as { textDocument: TextDocumentIdentifier; position: Position });
          break;
        case "textDocument/rename":
          result = this.handleRename(req.params as { textDocument: TextDocumentIdentifier; position: Position; newName: string });
          break;
        case "textDocument/formatting":
          result = this.handleFormatting(req.params as { textDocument: TextDocumentIdentifier });
          break;
        default:
          error = { code: -32601, message: `Method not found: ${req.method}` };
      }
    } catch (e) {
      error = { code: -32603, message: e instanceof Error ? e.message : String(e) };
    }

    const durationMs = Math.round(performance.now() - start);
    const response: JsonRpcResponse = { jsonrpc: "2.0", id: req.id, ...(error !== undefined ? { error } : { result }) };

    this.trace.push({
      direction: "server→client", messageType: "response", method: req.method,
      summary: error !== undefined ? `Error: ${error.message}` : this.summarizeResult(req.method, result),
      fullMessage: response, durationMs,
    });

    for (const n of notifications) {
      this.trace.push({
        direction: "server→client", messageType: "notification", method: n.method,
        summary: this.summarizeNotification(n), fullMessage: n, durationMs: 0,
      });
    }

    return { response, notifications };
  }

  /** トレースをリセット */
  resetTrace(): void {
    this.trace = [];
  }

  /** ドキュメントのシンボル一覧 */
  getSymbols(uri: string): SymbolInfo[] {
    return this.symbols.get(uri) ?? [];
  }

  // ── ハンドラー ──

  private handleInitialize() {
    this.initialized = true;
    return {
      capabilities: {
        completionProvider: { triggerCharacters: [".", ":", "<"] },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: true,
        documentFormattingProvider: true,
        textDocumentSync: 1,
      },
      serverInfo: { name: "SimLSP", version: "1.0.0" },
    };
  }

  private handleDidOpen(params: { textDocument: TextDocumentItem }): void {
    const { uri, text, version, languageId } = params.textDocument;
    this.documents.set(uri, { text, version, languageId });
    this.analyzeDocument(uri, text);
  }

  private handleDidChange(params: { textDocument: { uri: string; version: number }; contentChanges: { text: string }[] }): void {
    const doc = this.documents.get(params.textDocument.uri);
    if (doc === undefined) return;
    const newText = params.contentChanges[0]?.text ?? doc.text;
    doc.text = newText;
    doc.version = params.textDocument.version;
    this.analyzeDocument(params.textDocument.uri, newText);
  }

  private handleCompletion(params: { textDocument: TextDocumentIdentifier; position: Position }): CompletionItem[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (doc === undefined) return [];
    const line = doc.text.split("\n")[params.position.line] ?? "";
    const prefix = line.slice(0, params.position.character);

    const items: CompletionItem[] = [];
    const syms = this.symbols.get(params.textDocument.uri) ?? [];

    // ドット補完
    if (prefix.endsWith(".")) {
      const objName = prefix.slice(0, -1).trim().split(/\s+/).pop() ?? "";
      const objSym = syms.find((s) => s.name === objName);
      if (objSym !== undefined) {
        // オブジェクトのメンバーを提案
        const members = syms.filter((s) => s.kind === "property" || s.kind === "method");
        for (const m of members) items.push({ label: m.name, kind: m.kind === "method" ? CompletionItemKind.Function : CompletionItemKind.Property, detail: m.type, documentation: m.documentation });
      }
    }

    // 部分一致補完
    const word = prefix.match(/(\w+)$/)?.[1] ?? "";
    if (word.length > 0) {
      for (const s of syms) {
        if (s.name.toLowerCase().startsWith(word.toLowerCase()) && !items.some((i) => i.label === s.name)) {
          items.push({
            label: s.name,
            kind: s.kind === "function" || s.kind === "method" ? CompletionItemKind.Function : s.kind === "class" ? CompletionItemKind.Class : s.kind === "interface" ? CompletionItemKind.Interface : CompletionItemKind.Variable,
            detail: s.type,
            documentation: s.documentation,
          });
        }
      }
    }

    // キーワード補完
    if (word.length > 0) {
      for (const kw of ["const", "let", "function", "class", "interface", "return", "import", "export", "if", "else", "for", "while", "async", "await"]) {
        if (kw.startsWith(word) && !items.some((i) => i.label === kw)) {
          items.push({ label: kw, kind: CompletionItemKind.Keyword, detail: "keyword" });
        }
      }
    }

    return items;
  }

  private handleHover(params: { textDocument: TextDocumentIdentifier; position: Position }): Hover | null {
    const word = this.getWordAtPosition(params.textDocument.uri, params.position);
    if (word === null) return null;
    const sym = (this.symbols.get(params.textDocument.uri) ?? []).find((s) => s.name === word.text);
    if (sym === undefined) return null;
    return {
      contents: `**${sym.kind}** \`${sym.name}\`: \`${sym.type}\`${sym.documentation ? `\n\n${sym.documentation}` : ""}`,
      range: word.range,
    };
  }

  private handleDefinition(params: { textDocument: TextDocumentIdentifier; position: Position }): Location | null {
    const word = this.getWordAtPosition(params.textDocument.uri, params.position);
    if (word === null) return null;
    const sym = (this.symbols.get(params.textDocument.uri) ?? []).find((s) => s.name === word.text);
    return sym?.location ?? null;
  }

  private handleReferences(params: { textDocument: TextDocumentIdentifier; position: Position }): Location[] {
    const word = this.getWordAtPosition(params.textDocument.uri, params.position);
    if (word === null) return [];
    const sym = (this.symbols.get(params.textDocument.uri) ?? []).find((s) => s.name === word.text);
    return sym?.references ?? [];
  }

  private handleRename(params: { textDocument: TextDocumentIdentifier; position: Position; newName: string }): { changes: Record<string, { range: Range; newText: string }[]> } {
    const word = this.getWordAtPosition(params.textDocument.uri, params.position);
    if (word === null) return { changes: {} };
    const sym = (this.symbols.get(params.textDocument.uri) ?? []).find((s) => s.name === word.text);
    if (sym === undefined) return { changes: {} };
    const edits = [sym.location, ...sym.references].map((loc) => ({ range: loc.range, newText: params.newName }));
    return { changes: { [params.textDocument.uri]: edits } };
  }

  private handleFormatting(params: { textDocument: TextDocumentIdentifier }): { range: Range; newText: string }[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (doc === undefined) return [];
    const lines = doc.text.split("\n");
    const edits: { range: Range; newText: string }[] = [];
    let indent = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (trimmed.endsWith("}") || trimmed.startsWith("}")) indent = Math.max(0, indent - 1);
      const formatted = "  ".repeat(indent) + trimmed;
      if (formatted !== lines[i]) {
        edits.push({ range: { start: { line: i, character: 0 }, end: { line: i, character: lines[i]!.length } }, newText: formatted });
      }
      if (trimmed.endsWith("{")) indent++;
    }
    return edits;
  }

  // ── 診断 (Diagnostics) ──

  private publishDiagnostics(uri: string): JsonRpcNotification {
    const doc = this.documents.get(uri);
    const diagnostics: Diagnostic[] = [];
    if (doc !== undefined) {
      const lines = doc.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // var の使用を警告
        if (/\bvar\b/.test(line)) {
          const col = line.indexOf("var");
          diagnostics.push({
            range: { start: { line: i, character: col }, end: { line: i, character: col + 3 } },
            severity: 2, message: "'var' の代わりに 'const' または 'let' を使用してください", source: "SimLSP",
          });
        }
        // 未終了のセミコロン
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.endsWith("{") && !trimmed.endsWith("}") && !trimmed.endsWith(";") && !trimmed.endsWith(",") && !trimmed.endsWith("(") && !trimmed.startsWith("//") && !trimmed.startsWith("import") && !trimmed.startsWith("export") && !trimmed.startsWith("function") && !trimmed.startsWith("class") && !trimmed.startsWith("interface") && !trimmed.startsWith("if") && !trimmed.startsWith("for") && !trimmed.startsWith("return") && !trimmed.startsWith("}")) {
          // セミコロン不足の可能性（簡易チェック）
        }
        // any の使用を情報として
        if (/:\s*any\b/.test(line)) {
          const col = line.indexOf("any");
          diagnostics.push({
            range: { start: { line: i, character: col }, end: { line: i, character: col + 3 } },
            severity: 3, message: "'any' 型は型安全性を損ないます。具体的な型を使用してください", source: "SimLSP",
          });
        }
        // console.log を情報として
        if (line.includes("console.log")) {
          const col = line.indexOf("console.log");
          diagnostics.push({
            range: { start: { line: i, character: col }, end: { line: i, character: col + 11 } },
            severity: 4, message: "console.log はプロダクションコードから削除してください", source: "SimLSP",
          });
        }
      }
    }
    return { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } };
  }

  // ── ドキュメント解析 (シンボルテーブル構築) ──

  private analyzeDocument(uri: string, text: string): void {
    const syms: SymbolInfo[] = [];
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // function name(...)
      const funcMatch = line.match(/function\s+(\w+)\s*\(([^)]*)\)/);
      if (funcMatch !== null) {
        const name = funcMatch[1]!;
        const params = funcMatch[2] ?? "";
        const col = line.indexOf(name);
        syms.push({
          name, kind: "function", type: `(${params}) => any`,
          location: { uri, range: { start: { line: i, character: col }, end: { line: i, character: col + name.length } } },
          references: this.findReferences(lines, name, uri), documentation: `Function ${name}`,
        });
      }

      // const/let/var name = ...
      const varMatch = line.match(/(?:const|let|var)\s+(\w+)(?:\s*:\s*(\w+))?\s*=/);
      if (varMatch !== null) {
        const name = varMatch[1]!;
        const type = varMatch[2] ?? "inferred";
        const col = line.indexOf(name);
        syms.push({
          name, kind: "variable", type,
          location: { uri, range: { start: { line: i, character: col }, end: { line: i, character: col + name.length } } },
          references: this.findReferences(lines, name, uri),
        });
      }

      // class Name
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch !== null) {
        const name = classMatch[1]!;
        const col = line.indexOf(name);
        syms.push({
          name, kind: "class", type: `class ${name}`,
          location: { uri, range: { start: { line: i, character: col }, end: { line: i, character: col + name.length } } },
          references: this.findReferences(lines, name, uri), documentation: `Class ${name}`,
        });
      }

      // interface Name
      const ifaceMatch = line.match(/interface\s+(\w+)/);
      if (ifaceMatch !== null) {
        const name = ifaceMatch[1]!;
        const col = line.indexOf(name);
        syms.push({
          name, kind: "interface", type: `interface ${name}`,
          location: { uri, range: { start: { line: i, character: col }, end: { line: i, character: col + name.length } } },
          references: this.findReferences(lines, name, uri),
        });
      }
    }

    this.symbols.set(uri, syms);
  }

  private findReferences(lines: string[], name: string, uri: string): Location[] {
    const refs: Location[] = [];
    const regex = new RegExp(`\\b${name}\\b`, "g");
    for (let i = 0; i < lines.length; i++) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(lines[i]!)) !== null) {
        refs.push({ uri, range: { start: { line: i, character: match.index }, end: { line: i, character: match.index + name.length } } });
      }
    }
    return refs;
  }

  // ── ヘルパー ──

  private getWordAtPosition(uri: string, pos: Position): { text: string; range: Range } | null {
    const doc = this.documents.get(uri);
    if (doc === undefined) return null;
    const line = doc.text.split("\n")[pos.line] ?? "";
    const before = line.slice(0, pos.character);
    const after = line.slice(pos.character);
    const leftPart = before.match(/(\w+)$/)?.[1] ?? "";
    const rightPart = after.match(/^(\w*)/)?.[1] ?? "";
    const word = leftPart + rightPart;
    if (word.length === 0) return null;
    const start = pos.character - leftPart.length;
    return {
      text: word,
      range: { start: { line: pos.line, character: start }, end: { line: pos.line, character: start + word.length } },
    };
  }

  private summarizeParams(method: string, params: unknown): string {
    if (method === "initialize") return "初期化リクエスト";
    if (method.includes("didOpen")) return `ドキュメント開く: ${(params as { textDocument: { uri: string } }).textDocument.uri}`;
    if (method.includes("completion")) { const p = params as { position: Position }; return `補完 (L${p.position.line}:${p.position.character})`; }
    if (method.includes("hover")) { const p = params as { position: Position }; return `ホバー (L${p.position.line}:${p.position.character})`; }
    if (method.includes("definition")) { const p = params as { position: Position }; return `定義ジャンプ (L${p.position.line}:${p.position.character})`; }
    if (method.includes("references")) { const p = params as { position: Position }; return `参照検索 (L${p.position.line}:${p.position.character})`; }
    if (method.includes("rename")) { const p = params as { newName: string }; return `リネーム → "${p.newName}"`; }
    if (method.includes("formatting")) return "フォーマット";
    return method;
  }

  private summarizeResult(method: string, result: unknown): string {
    if (method === "initialize") return "capabilities 返却";
    if (method.includes("completion")) { const items = result as CompletionItem[]; return `${items.length} 件の補完候補`; }
    if (method.includes("hover")) return result !== null ? "ホバー情報あり" : "情報なし";
    if (method.includes("definition")) return result !== null ? "定義位置あり" : "定義なし";
    if (method.includes("references")) { const locs = result as Location[]; return `${locs.length} 件の参照`; }
    if (method.includes("rename")) return "WorkspaceEdit 返却";
    if (method.includes("formatting")) { const edits = result as unknown[]; return `${edits.length} 件の編集`; }
    return "OK";
  }

  private summarizeNotification(n: JsonRpcNotification): string {
    if (n.method.includes("Diagnostics")) {
      const d = (n.params as { diagnostics: Diagnostic[] }).diagnostics;
      return `${d.length} 件の診断 (${d.filter((x) => x.severity === 1).length} err, ${d.filter((x) => x.severity === 2).length} warn)`;
    }
    return n.method;
  }
}
