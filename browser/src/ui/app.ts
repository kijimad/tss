/**
 * ブラウザエンジンシミュレータのUI
 * Node.jsシミュレータのUIパターンに準拠
 * HTML+CSSの入力、パース、スタイル解決、レイアウト、ペイントの各段階を可視化する
 */

import { parse } from '../parser/html';
import { parseCss } from '../parser/css';
import { resolveStyles } from '../render/style';
import type { ComputedStyles } from '../render/style';
import { buildLayoutTree, computeLayout } from '../render/layout';
import type { LayoutBox } from '../render/layout';
import { buildDisplayList } from '../render/paint';
import type { DomNode, ElementNode } from '../dom/dom';

/** サンプルコード定義 */
const EXAMPLES: { name: string; html: string; css: string }[] = [
  {
    name: "Hello World (h1)",
    html: `<html><body>
  <h1>Hello</h1>
</body></html>`,
    css: `h1 {
  color: #1a1a2e;
  font-size: 28px;
}`,
  },
  {
    name: "ブロックレイアウト",
    html: `<html><body>
  <div class="outer">
    <div class="inner">Nested Block</div>
  </div>
</body></html>`,
    css: `.outer {
  margin: 20px;
  padding: 16px;
  background: #e0e0e0;
}
.inner {
  margin: 10px;
  padding: 8px;
  background: #b0c4de;
}`,
  },
  {
    name: "インライン要素",
    html: `<html><body>
  <p>This is <strong>bold</strong> and <em>italic</em> text.</p>
</body></html>`,
    css: `p {
  color: #333333;
  font-size: 16px;
}
strong {
  color: #e94560;
}
em {
  color: #3b82f6;
}`,
  },
  {
    name: "CSSセレクタ (クラス)",
    html: `<html><body>
  <p class="red">This is red.</p>
  <p>This is default.</p>
</body></html>`,
    css: `.red {
  color: red;
}
p {
  font-size: 16px;
}`,
  },
  {
    name: "CSSセレクタ (ID)",
    html: `<html><body>
  <div id="main">ID selected div</div>
</body></html>`,
    css: `#main {
  background: #3b82f6;
  color: #ffffff;
  padding: 20px;
}`,
  },
  {
    name: "詳細度の競合",
    html: `<html><body>
  <p class="intro" id="special">Which color wins?</p>
</body></html>`,
    css: `p {
  color: green;
}
.intro {
  color: blue;
}
#special {
  color: red;
}`,
  },
  {
    name: "継承 (color)",
    html: `<html><body>
  <div class="parent">
    <span>Child inherits color</span>
  </div>
</body></html>`,
    css: `.parent {
  color: purple;
  font-size: 18px;
}`,
  },
  {
    name: "ボックスモデル",
    html: `<html><body>
  <div class="box">Box Model Demo</div>
</body></html>`,
    css: `.box {
  padding: 20px;
  border-width: 4px;
  border-color: #e94560;
  margin: 30px;
  background: #f0f0f0;
  color: #333333;
}`,
  },
  {
    name: "リスト (ul/li)",
    html: `<html><body>
  <ul>
    <li>HTML Parser</li>
    <li>CSS Parser</li>
    <li>Layout Engine</li>
  </ul>
</body></html>`,
    css: `ul {
  padding: 10px;
  background: #f8f8f8;
}
li {
  margin-bottom: 4px;
  padding-left: 16px;
  color: #333333;
}`,
  },
  {
    name: "複合ページ",
    html: `<html><body>
  <div class="header">
    <h1>My Page</h1>
  </div>
  <div class="nav">
    <span class="link">Home</span>
    <span class="link">About</span>
  </div>
  <div class="content">
    <p>Welcome to the <strong>browser engine</strong> simulator.</p>
    <ul>
      <li>Parsing</li>
      <li>Styling</li>
      <li>Layout</li>
    </ul>
  </div>
</body></html>`,
    css: `.header {
  background: #1a1a2e;
  color: #e94560;
  padding: 12px;
}
h1 {
  font-size: 24px;
}
.nav {
  background: #16213e;
  padding: 8px;
}
.link {
  color: #56ccf2;
  margin: 8px;
}
.content {
  padding: 16px;
  background: #f0f0f0;
  color: #333333;
}
strong {
  color: #e94560;
}
li {
  margin-bottom: 4px;
  padding-left: 16px;
}`,
  },
];

/** アクセントカラー */
const ACCENT = "#e94560";

/**
 * ブラウザエンジンシミュレータのアプリケーションクラス
 * Node.jsシミュレータと同一のUIパターンで構築する
 */
export class BrowserApp {
  /**
   * アプリケーションを初期化し、UIを構築する
   * @param container - UIを描画するルートHTML要素
   */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Browser Engine Simulator";
    title.style.cssText = `margin:0;font-size:15px;color:${ACCENT};`;
    header.appendChild(title);

    // サンプル選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = `padding:4px 16px;background:${ACCENT};color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;`;
    header.appendChild(runBtn);
    container.appendChild(header);

    // メインレイアウト
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: HTML+CSSエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    // HTML+CSS入力エリア
    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${ACCENT};border-bottom:1px solid #1e293b;`;
    codeLabel.textContent = "HTML + CSS (style タグ内に CSS を記述)";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右パネル: 出力表示
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow-y:auto;";

    // DOMツリー表示
    const domLabel = document.createElement("div");
    domLabel.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:#56ccf2;border-bottom:1px solid #1e293b;`;
    domLabel.textContent = "DOM Tree";
    rightPanel.appendChild(domLabel);

    const domDiv = document.createElement("div");
    domDiv.style.cssText = "padding:8px 12px;font-family:monospace;font-size:11px;overflow-y:auto;max-height:25vh;border-bottom:1px solid #1e293b;white-space:pre;";
    rightPanel.appendChild(domDiv);

    // 計算済みスタイル表示
    const styleLabel = document.createElement("div");
    styleLabel.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:#6fcf97;border-bottom:1px solid #1e293b;`;
    styleLabel.textContent = "Computed Styles";
    rightPanel.appendChild(styleLabel);

    const styleDiv = document.createElement("div");
    styleDiv.style.cssText = "padding:8px 12px;font-family:monospace;font-size:11px;overflow-y:auto;max-height:25vh;border-bottom:1px solid #1e293b;white-space:pre;";
    rightPanel.appendChild(styleDiv);

    // レイアウトボックス表示
    const layoutLabel = document.createElement("div");
    layoutLabel.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:#bb86fc;border-bottom:1px solid #1e293b;`;
    layoutLabel.textContent = "Layout Boxes";
    rightPanel.appendChild(layoutLabel);

    const layoutDiv = document.createElement("div");
    layoutDiv.style.cssText = "padding:8px 12px;font-family:monospace;font-size:11px;overflow-y:auto;max-height:25vh;border-bottom:1px solid #1e293b;white-space:pre;";
    rightPanel.appendChild(layoutDiv);

    // ペイントディスプレイリスト表示
    const paintLabel = document.createElement("div");
    paintLabel.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;`;
    paintLabel.textContent = "Paint Display List";
    rightPanel.appendChild(paintLabel);

    const paintDiv = document.createElement("div");
    paintDiv.style.cssText = "padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;flex:1;white-space:pre;";
    rightPanel.appendChild(paintDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    /**
     * サンプルのHTMLとCSSを1つのテキストエリア用文字列に結合する
     */
    function buildSourceText(html: string, css: string): string {
      return `<style>\n${css}\n</style>\n${html}`;
    }

    /**
     * テキストエリアの内容からHTMLとCSSを分離する
     */
    function splitSource(source: string): { html: string; css: string } {
      const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);
      const css = styleMatch ? styleMatch[1]?.trim() ?? "" : "";
      const html = source.replace(/<style>[\s\S]*?<\/style>\s*/, "").trim();
      return { html, css };
    }

    // サンプル選択時のテキスト更新
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) codeArea.value = buildSourceText(ex.html, ex.css);
    });

    // 実行ボタンのクリックハンドラ
    runBtn.addEventListener("click", () => {
      domDiv.textContent = "";
      styleDiv.textContent = "";
      layoutDiv.textContent = "";
      paintDiv.textContent = "";

      const { html, css } = splitSource(codeArea.value);

      try {
        // 1. HTMLパース → DOMツリー構築
        const dom = parse(html);

        // 2. CSSパース → スタイルシート
        const stylesheet = parseCss(css);

        // 3. スタイル解決 → 計算済みスタイル
        const styleMap = resolveStyles(dom, stylesheet);

        // 4. レイアウトツリー構築
        const layoutTree = buildLayoutTree(dom, styleMap);

        // DOMツリーを表示
        domDiv.textContent = formatDomTree(dom, 0);

        // 計算済みスタイルを表示
        styleDiv.textContent = formatStyleMap(dom, styleMap);

        // レイアウトボックスを表示
        if (layoutTree) {
          computeLayout(layoutTree, 600, styleMap);
          layoutDiv.textContent = formatLayoutTree(layoutTree, 0);

          // ペイントディスプレイリストを表示
          const displayList = buildDisplayList(layoutTree, styleMap);
          paintDiv.textContent = formatDisplayList(displayList);
        }
      } catch (err: unknown) {
        // エラーがあれば表示
        const errMsg = err instanceof Error ? err.message : String(err);
        const errEl = document.createElement("div");
        errEl.style.cssText = "color:#f87171;padding:8px;";
        errEl.textContent = `Error: ${errMsg}`;
        domDiv.appendChild(errEl);
      }
    });

    // 初回ロード時にサンプルをセットして実行
    const firstExample = EXAMPLES[0];
    if (firstExample) {
      codeArea.value = buildSourceText(firstExample.html, firstExample.css);
    }
    runBtn.click();
  }
}

/**
 * 後方互換のためのinitApp関数
 * index.htmlから呼び出される
 */
export function initApp(): void {
  const container = document.getElementById("app");
  if (!container) return;
  const app = new BrowserApp();
  app.init(container);
}

// ========================================================
// フォーマット用ヘルパー関数
// ========================================================

/**
 * DOMツリーをテキストとして整形する
 */
function formatDomTree(node: DomNode, depth: number): string {
  const indent = "  ".repeat(depth);

  if (node.type === "text") {
    return `${indent}"${node.text}"`;
  }

  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");

  const lines: string[] = [`${indent}<${node.tagName}${attrs}>`];

  for (const child of node.children) {
    lines.push(formatDomTree(child, depth + 1));
  }

  lines.push(`${indent}</${node.tagName}>`);
  return lines.join("\n");
}

/**
 * 計算済みスタイルをテキストとして整形する
 */
function formatStyleMap(node: DomNode, styleMap: Map<ElementNode, ComputedStyles>): string {
  const lines: string[] = [];

  /** DOMツリーを再帰的に走査し、各要素のスタイル情報を収集する */
  function walk(n: DomNode, depth: number): void {
    if (n.type === "text") return;

    const indent = "  ".repeat(depth);
    const computed = styleMap.get(n);
    if (computed && computed.size > 0) {
      lines.push(`${indent}<${n.tagName}>`);
      for (const [prop, val] of computed) {
        lines.push(`${indent}  ${prop}: ${val}`);
      }
    }

    for (const child of n.children) {
      walk(child, depth + 1);
    }
  }

  walk(node, 0);
  return lines.join("\n");
}

/**
 * レイアウトツリーをテキストとして整形する
 */
function formatLayoutTree(box: LayoutBox, depth: number): string {
  const indent = "  ".repeat(depth);
  const d = box.dimensions;
  const tag = box.node?.tagName ?? "anon";
  const pos = `(${d.content.x.toFixed(0)},${d.content.y.toFixed(0)})`;
  const size = `${d.content.width.toFixed(0)}x${d.content.height.toFixed(0)}`;

  const lines: string[] = [
    `${indent}[${box.boxType}] <${tag}> ${size} @ ${pos}`,
  ];

  // マージン/パディング/ボーダーが非ゼロの場合に表示
  const m = d.margin;
  const p = d.padding;
  const b = d.border;
  if (m.top || m.right || m.bottom || m.left) {
    lines.push(`${indent}  margin: ${m.top} ${m.right} ${m.bottom} ${m.left}`);
  }
  if (p.top || p.right || p.bottom || p.left) {
    lines.push(`${indent}  padding: ${p.top} ${p.right} ${p.bottom} ${p.left}`);
  }
  if (b.top || b.right || b.bottom || b.left) {
    lines.push(`${indent}  border: ${b.top} ${b.right} ${b.bottom} ${b.left}`);
  }

  for (const child of box.children) {
    lines.push(formatLayoutTree(child, depth + 1));
  }

  return lines.join("\n");
}

/**
 * ディスプレイリストをテキストとして整形する
 */
function formatDisplayList(commands: ReturnType<typeof buildDisplayList>): string {
  const lines: string[] = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;

    switch (cmd.type) {
      case "rect":
        lines.push(`${String(i).padStart(3)}  RECT  (${cmd.x.toFixed(0)},${cmd.y.toFixed(0)}) ${cmd.width.toFixed(0)}x${cmd.height.toFixed(0)}  color=${cmd.color}`);
        break;
      case "border":
        lines.push(`${String(i).padStart(3)}  BORDER  (${cmd.x.toFixed(0)},${cmd.y.toFixed(0)}) ${cmd.width.toFixed(0)}x${cmd.height.toFixed(0)}  color=${cmd.color}  w=${String(cmd.borderWidth)}`);
        break;
      case "text":
        lines.push(`${String(i).padStart(3)}  TEXT  (${cmd.x.toFixed(0)},${cmd.y.toFixed(0)}) "${cmd.text}"  color=${cmd.color}  size=${String(cmd.fontSize)}`);
        break;
    }
  }

  return lines.join("\n");
}
