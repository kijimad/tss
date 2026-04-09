import { describe, it, expect, beforeEach } from "vitest";
import { LanguageServer } from "../engine/lsp.js";
import { EXAMPLES } from "../ui/app.js";
import type { JsonRpcRequest, CompletionItem, Hover, Location, Diagnostic } from "../engine/lsp.js";

const URI = "file:///test.ts";
const CODE = `function greet(name: string): string {
  const message = "Hello, " + name;
  return message;
}
const result = greet("World");`;

function mkReq(method: string, params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: Math.floor(Math.random() * 1000), method, params };
}

describe("LanguageServer", () => {
  let server: LanguageServer;

  beforeEach(() => {
    server = new LanguageServer();
    server.handleRequest(mkReq("initialize", {}));
    server.handleRequest(mkReq("textDocument/didOpen", { textDocument: { uri: URI, languageId: "typescript", version: 1, text: CODE } }));
  });

  describe("initialize", () => {
    it("capabilities を返す", () => {
      const s = new LanguageServer();
      const { response } = s.handleRequest(mkReq("initialize", {}));
      const caps = (response.result as { capabilities: Record<string, unknown> }).capabilities;
      expect(caps.completionProvider).toBeDefined();
      expect(caps.hoverProvider).toBe(true);
      expect(caps.definitionProvider).toBe(true);
    });
  });

  describe("completion", () => {
    it("シンボルの補完候補を返す", () => {
      const { response } = server.handleRequest(mkReq("textDocument/completion", { textDocument: { uri: URI }, position: { line: 4, character: 8 } }));
      const items = response.result as CompletionItem[];
      expect(items.length).toBeGreaterThan(0);
    });

    it("キーワードも提案する", () => {
      const { response } = server.handleRequest(mkReq("textDocument/completion", { textDocument: { uri: URI }, position: { line: 0, character: 3 } }));
      const items = response.result as CompletionItem[];
      expect(items.some((i) => i.label === "function")).toBe(true);
    });
  });

  describe("hover", () => {
    it("関数の型情報を返す", () => {
      const { response } = server.handleRequest(mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 0, character: 13 } }));
      const hover = response.result as Hover;
      expect(hover).not.toBeNull();
      expect(hover.contents).toContain("greet");
    });

    it("未知のシンボルは null", () => {
      const { response } = server.handleRequest(mkReq("textDocument/hover", { textDocument: { uri: URI }, position: { line: 0, character: 0 } }));
      // "function" はシンボルではない
      expect(response.result).toBeNull();
    });
  });

  describe("definition", () => {
    it("シンボルの定義位置を返す", () => {
      const { response } = server.handleRequest(mkReq("textDocument/definition", { textDocument: { uri: URI }, position: { line: 4, character: 19 } }));
      const loc = response.result as Location;
      expect(loc).not.toBeNull();
      expect(loc.uri).toBe(URI);
    });
  });

  describe("references", () => {
    it("シンボルの全参照を返す", () => {
      const { response } = server.handleRequest(mkReq("textDocument/references", { textDocument: { uri: URI }, position: { line: 0, character: 13 } }));
      const refs = response.result as Location[];
      expect(refs.length).toBeGreaterThanOrEqual(2); // 定義 + 呼び出し
    });
  });

  describe("rename", () => {
    it("WorkspaceEdit を返す", () => {
      const { response } = server.handleRequest(mkReq("textDocument/rename", { textDocument: { uri: URI }, position: { line: 0, character: 13 }, newName: "sayHello" }));
      const edit = response.result as { changes: Record<string, unknown[]> };
      expect(edit.changes[URI]!.length).toBeGreaterThan(0);
    });
  });

  describe("formatting", () => {
    it("インデントを修正する編集を返す", () => {
      const s = new LanguageServer();
      s.handleRequest(mkReq("initialize", {}));
      s.handleRequest(mkReq("textDocument/didOpen", { textDocument: { uri: URI, languageId: "typescript", version: 1, text: "function f(){\nconst x = 1;\n}" } }));
      const { response } = s.handleRequest(mkReq("textDocument/formatting", { textDocument: { uri: URI } }));
      const edits = response.result as unknown[];
      expect(edits.length).toBeGreaterThan(0);
    });
  });

  describe("diagnostics", () => {
    it("var 使用を警告する", () => {
      const s = new LanguageServer();
      s.handleRequest(mkReq("initialize", {}));
      const { notifications } = s.handleRequest(mkReq("textDocument/didOpen", {
        textDocument: { uri: URI, languageId: "typescript", version: 1, text: "var x = 1;" },
      }));
      const diag = notifications.find((n) => n.method.includes("Diagnostics"));
      expect(diag).toBeDefined();
      const diagnostics = (diag!.params as { diagnostics: Diagnostic[] }).diagnostics;
      expect(diagnostics.some((d) => d.message.includes("var"))).toBe(true);
    });

    it("any 型を警告する", () => {
      const s = new LanguageServer();
      s.handleRequest(mkReq("initialize", {}));
      const { notifications } = s.handleRequest(mkReq("textDocument/didOpen", {
        textDocument: { uri: URI, languageId: "typescript", version: 1, text: "const x: any = 1;" },
      }));
      const diags = (notifications[0]!.params as { diagnostics: Diagnostic[] }).diagnostics;
      expect(diags.some((d) => d.message.includes("any"))).toBe(true);
    });
  });

  describe("不明なメソッド", () => {
    it("エラーを返す", () => {
      const { response } = server.handleRequest(mkReq("unknown/method", {}));
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
    });
  });

  describe("トレース", () => {
    it("全メッセージがトレースに記録される", () => {
      expect(server.traceLog.length).toBeGreaterThan(0);
      expect(server.traceLog.some((t) => t.method === "initialize")).toBe(true);
    });
  });
});

describe("EXAMPLES", () => {
  it("8 つのサンプル", () => { expect(EXAMPLES).toHaveLength(8); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全リクエスト実行可能`, () => {
      const s = new LanguageServer();
      s.handleRequest(mkReq("initialize", {}));
      s.handleRequest(mkReq("textDocument/didOpen", { textDocument: { uri: ex.uri, languageId: "typescript", version: 1, text: ex.code } }));
      for (const req of ex.requests) {
        const { response } = s.handleRequest(req);
        expect(response.error).toBeUndefined();
      }
    });
  }
});
