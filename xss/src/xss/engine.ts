/* XSS シミュレーター エンジン */

import type {
  InjectionContext, XssPayload,
  OutputEncoding, SanitizerConfig, CspPolicy, PageConfig,
  SimStep, AttackResult,
  SimOp, SimEvent, SimulationResult,
} from "./types.js";

// ─── エスケープ関数 ───

/** HTMLエンティティエスケープ */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** JavaScript文字列エスケープ */
export function escapeJs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\x3c")
    .replace(/>/g, "\\x3e")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** URLエンコード */
export function escapeUrl(s: string): string {
  return encodeURIComponent(s);
}

/** CSSエスケープ */
export function escapeCss(s: string): string {
  return s.replace(/[<>"'&;{}()\\]/g, c => `\\${c.charCodeAt(0).toString(16)} `);
}

// ─── サニタイザー ───

/** タグ抽出 */
export function extractTags(html: string): string[] {
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const tags: string[] = [];
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

/** 属性抽出 */
export function extractAttributes(html: string): string[] {
  const attrRegex = /\s([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
  const attrs: string[] = [];
  let match;
  while ((match = attrRegex.exec(html)) !== null) {
    attrs.push(match[1].toLowerCase());
  }
  return attrs;
}

/** プロトコル抽出（href, src等から） */
export function extractProtocols(html: string): string[] {
  const protoRegex = /(?:href|src|action)\s*=\s*["']?([a-zA-Z][a-zA-Z0-9+.-]*):/gi;
  const protos: string[] = [];
  let match;
  while ((match = protoRegex.exec(html)) !== null) {
    protos.push(match[1].toLowerCase());
  }
  return protos;
}

/** サニタイズ実行 */
export function sanitize(
  html: string,
  config: SanitizerConfig,
  steps: SimStep[],
  events: SimEvent[],
): { result: string; blocked: boolean; reasons: string[] } {
  if (!config.enabled) {
    steps.push({ phase: "sanitize", message: "サニタイザー無効", blocked: false });
    return { result: html, blocked: false, reasons: [] };
  }

  let result = html;
  const reasons: string[] = [];
  let blocked = false;

  // タグチェック
  const tags = extractTags(result);
  if (config.whitelist && config.allowTags) {
    // ホワイトリスト方式
    for (const tag of tags) {
      if (!config.allowTags.includes(tag)) {
        const tagRegex = new RegExp(`</?${tag}[^>]*>`, "gi");
        result = result.replace(tagRegex, "");
        reasons.push(`タグ <${tag}> をホワイトリスト外として除去`);
        blocked = true;
      }
    }
  } else {
    // ブラックリスト方式
    for (const tag of config.blockTags) {
      const tagRegex = new RegExp(`</?${tag}[^>]*>`, "gi");
      if (tagRegex.test(result)) {
        result = result.replace(tagRegex, "");
        reasons.push(`タグ <${tag}> をブロック`);
        blocked = true;
      }
    }
  }

  // 属性チェック
  for (const attr of config.blockAttributes) {
    const attrRegex = new RegExp(`\\s${attr}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*)`, "gi");
    if (attrRegex.test(result)) {
      result = result.replace(attrRegex, "");
      reasons.push(`属性 ${attr} をブロック`);
      blocked = true;
    }
  }

  // プロトコルチェック
  for (const proto of config.blockProtocols) {
    const protoRegex = new RegExp(`${proto}\\s*:`, "gi");
    if (protoRegex.test(result)) {
      result = result.replace(protoRegex, "blocked:");
      reasons.push(`プロトコル ${proto}: をブロック`);
      blocked = true;
    }
  }

  if (blocked) {
    steps.push({
      phase: "sanitize",
      message: `サニタイザーが危険な要素を検出・除去`,
      detail: reasons.join("; "),
      blocked: true,
    });
    events.push({ type: "sanitize", message: `サニタイズ: ${reasons.length}件ブロック`, detail: reasons.join("; ") });
  } else {
    steps.push({ phase: "sanitize", message: "サニタイザー通過（危険な要素なし）", blocked: false });
  }

  return { result, blocked, reasons };
}

// ─── 出力エンコード ───

/** コンテキストに応じた出力エンコード適用 */
export function applyEncoding(
  input: string,
  context: InjectionContext,
  encoding: OutputEncoding,
  steps: SimStep[],
  events: SimEvent[],
): string {
  let result = input;
  const applied: string[] = [];

  switch (context) {
    case "html_body":
    case "html_attribute":
      if (encoding.htmlEscape) {
        result = escapeHtml(result);
        applied.push("HTMLエスケープ");
      }
      break;

    case "href_attribute":
      if (encoding.urlEncode) {
        result = escapeUrl(result);
        applied.push("URLエンコード");
      } else if (encoding.htmlEscape) {
        result = escapeHtml(result);
        applied.push("HTMLエスケープ");
      }
      break;

    case "script_string":
      if (encoding.jsEscape) {
        result = escapeJs(result);
        applied.push("JSエスケープ");
      }
      break;

    case "script_block":
      if (encoding.htmlEscape) {
        result = escapeHtml(result);
        applied.push("HTMLエスケープ");
      }
      break;

    case "event_handler":
      if (encoding.jsEscape) {
        result = escapeJs(result);
        applied.push("JSエスケープ");
      }
      if (encoding.htmlEscape) {
        result = escapeHtml(result);
        applied.push("HTMLエスケープ");
      }
      break;

    case "style":
      if (encoding.cssEscape) {
        result = escapeCss(result);
        applied.push("CSSエスケープ");
      }
      break;

    case "url_param":
      // DOM-based: サーバー側エンコードは適用されない
      break;
  }

  if (applied.length > 0) {
    steps.push({
      phase: "encode",
      message: `出力エンコード適用: ${applied.join(", ")}`,
      detail: `結果: ${result.slice(0, 80)}`,
      blocked: false,
    });
    events.push({ type: "encode", message: `出力エンコード: ${applied.join(", ")}` });
  } else {
    steps.push({ phase: "encode", message: "出力エンコードなし（未適用）", blocked: false });
    events.push({ type: "warn", message: "出力エンコード未適用 — XSSリスク" });
  }

  return result;
}

// ─── HTML レンダリングシミュレーション ───

/** コンテキストにペイロードを埋め込んだHTML生成 */
export function renderInContext(input: string, context: InjectionContext): string {
  switch (context) {
    case "html_body":
      return `<div class="content">${input}</div>`;
    case "html_attribute":
      return `<input type="text" value="${input}">`;
    case "href_attribute":
      return `<a href="${input}">リンク</a>`;
    case "script_string":
      return `<script>var userInput = "${input}";</script>`;
    case "script_block":
      return `<script>${input}</script>`;
    case "event_handler":
      return `<button onclick="handleClick('${input}')">ボタン</button>`;
    case "style":
      return `<style>.user { color: ${input}; }</style>`;
    case "url_param":
      return `<div id="output"></div><script>document.getElementById('output').innerHTML = new URLSearchParams(location.search).get('q') || '${input}';</script>`;
  }
}

// ─── スクリプト実行判定 ───

/** ペイロードがスクリプト実行に至るか判定 */
export function detectExecution(
  renderedHtml: string,
  context: InjectionContext,
  steps: SimStep[],
  events: SimEvent[],
): { executed: boolean; script?: string } {
  // <script>タグの検出
  const scriptTagMatch = renderedHtml.match(/<script[^>]*>([^]*?)<\/script>/i);

  // イベントハンドラでの実行
  const eventMatch = renderedHtml.match(/on\w+\s*=\s*["']([^"']*alert[^"']*|[^"']*document\.\w+[^"']*|[^"']*fetch[^"']*|[^"']*eval[^"']*)/i);

  // javascript: プロトコル
  const jsProtoMatch = renderedHtml.match(/href\s*=\s*["']javascript:([^"']+)/i);

  // <img onerror>, <svg onload> 等
  const imgErrorMatch = renderedHtml.match(/<(?:img|svg|body|iframe)[^>]*on(?:error|load)\s*=\s*["']([^"']*)/i);

  if (context === "script_string" || context === "script_block") {
    // スクリプトコンテキスト: エスケープされてないならば実行される
    if (scriptTagMatch) {
      const content = scriptTagMatch[1];

      if (context === "script_string") {
        // script_string: 文字列から脱出できているか判定
        // 正しくエスケープされていれば \" となり文字列は閉じない
        // 脱出パターン: エスケープされてない引用符で文字列を閉じてコード注入
        const hasUnescapedQuote = /(?<!\\)";\s*\w/.test(content) || content.includes("</script>");
        if (hasUnescapedQuote) {
          steps.push({ phase: "execute", message: "スクリプト文字列からの脱出検出", blocked: false });
          events.push({ type: "execute", message: "文字列脱出によるスクリプト実行", detail: content.slice(0, 100) });
          return { executed: true, script: content };
        }
      } else {
        // script_block: 直接コード注入
        if (content.includes("alert(") || content.includes("document.cookie") || content.includes("</script>")) {
          steps.push({ phase: "execute", message: "スクリプトコンテキストでのコード注入検出", blocked: false });
          events.push({ type: "execute", message: "スクリプト実行成功", detail: content.slice(0, 100) });
          return { executed: true, script: content };
        }
      }
    }
    // script_blockではそのまま実行
    if (context === "script_block" && renderedHtml.includes("<script>")) {
      const inner = renderedHtml.replace(/<\/?script>/g, "");
      if (inner.includes("alert") || inner.includes("document") || inner.includes("fetch")) {
        steps.push({ phase: "execute", message: "スクリプトブロック内でコード実行", blocked: false });
        events.push({ type: "execute", message: "スクリプト実行成功" });
        return { executed: true, script: inner.slice(0, 100) };
      }
    }
  }

  // HTMLコンテキストでのscriptタグインジェクション
  if (context === "html_body" || context === "html_attribute") {
    if (renderedHtml.match(/<script[^>]*>/i) && !renderedHtml.includes("&lt;script")) {
      const match = renderedHtml.match(/<script[^>]*>([^]*?)<\/script>/i);
      const script = match?.[1] ?? "";
      steps.push({ phase: "execute", message: "HTMLコンテキストにscriptタグ注入 → 実行", blocked: false });
      events.push({ type: "execute", message: "scriptタグインジェクション成功", detail: script.slice(0, 80) });
      return { executed: true, script };
    }
  }

  // イベントハンドラインジェクション
  if (eventMatch) {
    steps.push({ phase: "execute", message: "イベントハンドラでスクリプト実行", blocked: false });
    events.push({ type: "execute", message: "イベントハンドラインジェクション成功" });
    return { executed: true, script: eventMatch[1] };
  }

  // javascript: URL
  if (jsProtoMatch) {
    steps.push({ phase: "execute", message: "javascript: URLでスクリプト実行", blocked: false });
    events.push({ type: "execute", message: "javascript: プロトコルインジェクション成功" });
    return { executed: true, script: jsProtoMatch[1] };
  }

  // img/svg onerror/onload
  if (imgErrorMatch) {
    steps.push({ phase: "execute", message: "img/svg イベントでスクリプト実行", blocked: false });
    events.push({ type: "execute", message: "タグ属性イベントインジェクション成功" });
    return { executed: true, script: imgErrorMatch[1] };
  }

  // DOM-based XSS
  if (context === "url_param" && renderedHtml.includes("innerHTML")) {
    if (!renderedHtml.includes("&lt;") && (renderedHtml.includes("<script") || renderedHtml.includes("onerror") || renderedHtml.includes("javascript:"))) {
      steps.push({ phase: "execute", message: "DOM操作(innerHTML)によるスクリプト実行", blocked: false });
      events.push({ type: "execute", message: "DOM-based XSS成功" });
      return { executed: true, script: "innerHTML injection" };
    }
  }

  steps.push({ phase: "execute", message: "スクリプト実行なし（安全）", blocked: false });
  events.push({ type: "info", message: "スクリプト実行は発生しなかった" });
  return { executed: false };
}

// ─── CSP 判定 ───

/** CSPによるブロック判定 */
export function checkCsp(
  csp: CspPolicy,
  renderedHtml: string,
  steps: SimStep[],
  events: SimEvent[],
): { blocked: boolean; reasons: string[] } {
  if (!csp.enabled) {
    steps.push({ phase: "csp", message: "CSP未設定", blocked: false });
    events.push({ type: "warn", message: "CSP未設定 — スクリプト制限なし" });
    return { blocked: false, reasons: [] };
  }

  const reasons: string[] = [];
  let blocked = false;

  // インラインスクリプト検出
  const hasInlineScript = /<script[^>]*>(?!$)/i.test(renderedHtml) || /on\w+\s*=\s*["']/i.test(renderedHtml);

  if (hasInlineScript) {
    const allowsInline = csp.scriptSrc.includes("'unsafe-inline'");
    const hasNonce = csp.nonce && renderedHtml.includes(`nonce="${csp.nonce}"`);

    if (!allowsInline && !hasNonce) {
      reasons.push("CSP script-src: インラインスクリプトをブロック");
      blocked = true;
    }
  }

  // javascript: プロトコル
  if (/javascript:/i.test(renderedHtml)) {
    if (!csp.scriptSrc.includes("'unsafe-inline'")) {
      reasons.push("CSP: javascript: プロトコルをブロック");
      blocked = true;
    }
  }

  // eval検出
  if (/eval\s*\(/.test(renderedHtml)) {
    if (!csp.scriptSrc.includes("'unsafe-eval'")) {
      reasons.push("CSP script-src: eval()をブロック");
      blocked = true;
    }
  }

  // インラインスタイル
  if (/<style[^>]*>/i.test(renderedHtml) || /style\s*=\s*"/i.test(renderedHtml)) {
    if (!csp.styleSrc.includes("'unsafe-inline'")) {
      // スタイルはブロックするが致命的ではない
    }
  }

  if (blocked) {
    steps.push({
      phase: "csp",
      message: "CSPによりスクリプト実行をブロック",
      detail: reasons.join("; "),
      blocked: true,
    });
    events.push({ type: "csp", message: `CSPブロック: ${reasons.join("; ")}` });
  } else {
    steps.push({ phase: "csp", message: "CSPチェック通過", blocked: false });
  }

  return { blocked, reasons };
}

// ─── Cookie窃取判定 ───

/** Cookie窃取の可能性判定 */
function checkCookieTheft(
  executedScript: string | undefined,
  httpOnlyCookie: boolean,
  steps: SimStep[],
  events: SimEvent[],
): boolean {
  if (!executedScript) return false;

  const accessesCookie = /document\.cookie/i.test(executedScript);
  if (!accessesCookie) return false;

  if (httpOnlyCookie) {
    steps.push({
      phase: "steal",
      message: "document.cookie アクセスあるが HttpOnly で保護",
      blocked: true,
    });
    events.push({ type: "block", message: "HttpOnly Cookie: JavaScript からアクセス不可" });
    return false;
  }

  steps.push({
    phase: "steal",
    message: "Cookie窃取成功 — document.cookie にアクセス可能",
    blocked: false,
  });
  events.push({ type: "steal", message: "Cookie窃取成功: HttpOnly 未設定" });
  return true;
}

// ─── 防御勧告生成 ───

/** 攻撃結果に基づく防御勧告 */
function generateMitigations(
  result: AttackResult,
  pageConfig: PageConfig,
): string[] {
  const mitigations: string[] = [];

  if (result.scriptExecuted && !result.cspBlocked) {
    // エスケープ不足
    if (!pageConfig.encoding.htmlEscape && (result.context === "html_body" || result.context === "html_attribute")) {
      mitigations.push("HTML出力時にエンティティエスケープを適用する（&, <, >, \", '）");
    }
    if (!pageConfig.encoding.jsEscape && (result.context === "script_string" || result.context === "event_handler")) {
      mitigations.push("JavaScript文字列への挿入時にJSエスケープを適用する");
    }
    if (!pageConfig.encoding.urlEncode && result.context === "href_attribute") {
      mitigations.push("URLコンテキストではURLエンコードを適用する");
    }

    // サニタイザー
    if (!pageConfig.sanitizer.enabled) {
      mitigations.push("入力サニタイザー（DOMPurify等）を導入する");
    }

    // CSP
    if (!pageConfig.csp.enabled) {
      mitigations.push("Content Security Policy (CSP) を設定する（script-src 'self'）");
    } else if (pageConfig.csp.scriptSrc.includes("'unsafe-inline'")) {
      mitigations.push("CSPから 'unsafe-inline' を削除し、nonce または hash を使用する");
    }

    // HttpOnly
    if (!pageConfig.httpOnlyCookie && result.cookieStolen) {
      mitigations.push("セッションCookieに HttpOnly フラグを設定する");
    }
  }

  if (result.context === "url_param") {
    mitigations.push("DOM操作には textContent を使用し、innerHTML を避ける");
    mitigations.push("ユーザー入力をDOM挿入前にサニタイズする");
  }

  if (mitigations.length === 0) {
    mitigations.push("現在の防御設定は適切です");
  }

  return mitigations;
}

// ─── メイン処理 ───

/** 単一攻撃シミュレーション */
export function simulateAttack(op: SimOp): AttackResult {
  const { xssType, context, payload, pageConfig } = op;
  const steps: SimStep[] = [];
  const events: SimEvent[] = [];

  // 1. ペイロード注入
  steps.push({
    phase: "inject",
    message: `ペイロード注入: ${xssType} / ${context}`,
    detail: payload.input.slice(0, 100),
    blocked: false,
  });
  events.push({
    type: "inject",
    message: `${xssType} XSS: ${payload.description}`,
    detail: `コンテキスト: ${context}`,
  });

  // 2. サニタイズ
  const sanitized = sanitize(payload.input, pageConfig.sanitizer, steps, events);

  // 3. 出力エンコード
  const encoded = applyEncoding(sanitized.result, context, pageConfig.encoding, steps, events);

  // 4. HTMLレンダリング
  const renderedHtml = renderInContext(encoded, context);
  steps.push({
    phase: "render",
    message: "HTMLレンダリング",
    detail: renderedHtml.slice(0, 120),
    blocked: false,
  });
  events.push({ type: "render", message: "HTMLレンダリング完了" });

  // 5. スクリプト実行判定
  const execution = detectExecution(renderedHtml, context, steps, events);

  // 6. CSP判定
  let cspBlocked = false;
  const cspReasons: string[] = [];
  if (execution.executed) {
    const cspResult = checkCsp(pageConfig.csp, renderedHtml, steps, events);
    cspBlocked = cspResult.blocked;
    cspReasons.push(...cspResult.reasons);
  }

  // 最終的な実行判定（CSPでブロックされたら実行されない）
  const actuallyExecuted = execution.executed && !cspBlocked;

  // 7. Cookie窃取判定
  const cookieStolen = actuallyExecuted
    ? checkCookieTheft(execution.script, pageConfig.httpOnlyCookie, steps, events)
    : false;

  // ブロック理由集約
  const blockReasons = [
    ...sanitized.reasons,
    ...cspReasons,
  ];

  const result: AttackResult = {
    xssType,
    context,
    payload,
    renderedHtml,
    sanitizedHtml: sanitized.result,
    scriptExecuted: actuallyExecuted,
    executedScript: actuallyExecuted ? execution.script : undefined,
    cookieStolen,
    cspBlocked,
    blockReasons,
    steps,
    mitigations: [],
  };

  // 8. 防御勧告
  result.mitigations = generateMitigations(result, pageConfig);

  return result;
}

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allEvents: SimEvent[] = [];
  const results: AttackResult[] = [];

  for (const op of ops) {
    const result = simulateAttack(op);
    results.push(result);
    allEvents.push(...result.steps.map(s => ({
      type: (s.blocked ? "block" : "info") as SimEvent["type"],
      message: `[${s.phase}] ${s.message}`,
      detail: s.detail,
    })));
  }

  return { results, events: allEvents };
}

// ─── ヘルパー ───

/** ページ設定ヘルパー: 防御なし */
export function noDefense(): PageConfig {
  return {
    encoding: { htmlEscape: false, jsEscape: false, urlEncode: false, cssEscape: false },
    sanitizer: { enabled: false, blockTags: [], blockAttributes: [], blockProtocols: [], whitelist: false },
    csp: { enabled: false, defaultSrc: [], scriptSrc: [], styleSrc: [], imgSrc: [], connectSrc: [] },
    httpOnlyCookie: false,
    xssProtection: false,
  };
}

/** ページ設定ヘルパー: HTMLエスケープのみ */
export function htmlEscapeOnly(): PageConfig {
  return {
    ...noDefense(),
    encoding: { htmlEscape: true, jsEscape: false, urlEncode: false, cssEscape: false },
  };
}

/** ページ設定ヘルパー: 完全エスケープ */
export function fullEscape(): PageConfig {
  return {
    ...noDefense(),
    encoding: { htmlEscape: true, jsEscape: true, urlEncode: true, cssEscape: true },
  };
}

/** ページ設定ヘルパー: サニタイザー有効 */
export function withSanitizer(): PageConfig {
  return {
    ...fullEscape(),
    sanitizer: {
      enabled: true,
      blockTags: ["script", "iframe", "object", "embed", "svg", "math"],
      blockAttributes: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
      blockProtocols: ["javascript", "data", "vbscript"],
      whitelist: false,
    },
  };
}

/** ページ設定ヘルパー: CSP有効 */
export function withCsp(): PageConfig {
  return {
    ...withSanitizer(),
    csp: {
      enabled: true,
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  };
}

/** ページ設定ヘルパー: フル防御 */
export function fullDefense(): PageConfig {
  return {
    ...withCsp(),
    httpOnlyCookie: true,
    xssProtection: true,
  };
}

/** ペイロード生成ヘルパー */
export function mkPayload(input: string, description: string, intent: string): XssPayload {
  return { input, description, intent };
}
