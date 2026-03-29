/**
 * dev-server.ts -- Vite Dev Server エミュレーション
 *
 * Vite dev server の仕事:
 *   1. HTTP リクエストを受け取る
 *   2. リクエストパスに対応するファイルを VFS から読む
 *   3. ファイルをトランスフォーム (TS→JS, CSS→JS 等)
 *   4. トランスフォーム済みコードをレスポンスとして返す
 *   5. 依存グラフを更新
 *   6. ファイル変更時に HMR を発火
 *
 * 実際の Vite:  ブラウザが HTTP リクエスト → Koa/Connect サーバ → ファイル変換 → レスポンス
 * シミュレータ:  handleRequest(path) → 変換結果を返す
 */
import { VirtualFileSystem } from "./vfs.js";
import { transform, type TransformResult } from "../transform/transformer.js";
import { DependencyGraph } from "../modules/dep-graph.js";

// HTTP リクエスト/レスポンス
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  // デバッグ情報
  transformResult: TransformResult | undefined;
}

// サーバイベント
export type ServerEvent =
  | { type: "request"; method: string; path: string; status: number; contentType: string; transformTime: number }
  | { type: "transform"; path: string; steps: string[] }
  | { type: "hmr_update"; file: string; boundary: string[]; propagation: string[] }
  | { type: "hmr_full_reload"; reason: string }
  | { type: "dep_graph_update"; modules: number; edges: number }
  | { type: "prebundle"; module: string }
  | { type: "server_start"; port: number };

export class ViteDevServer {
  readonly vfs: VirtualFileSystem;
  readonly depGraph: DependencyGraph;

  // 事前バンドルされた外部モジュール
  private preBundled = new Map<string, string>();

  events: ServerEvent[] = [];
  onEvent: ((event: ServerEvent) => void) | undefined;

  constructor(vfs: VirtualFileSystem) {
    this.vfs = vfs;
    this.depGraph = new DependencyGraph();
  }

  private emit(event: ServerEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  // サーバ起動
  start(port = 5173): void {
    this.emit({ type: "server_start", port });

    // 依存事前バンドル (node_modules のパッケージを事前に変換)
    this.preBundleModules();
  }

  // HTTP リクエスト処理
  handleRequest(req: HttpRequest): HttpResponse {
    const startTime = performance.now();
    let path = req.path.split("?")[0] ?? req.path;

    // /@modules/ プレフィックス → 事前バンドル済みモジュール
    if (path.startsWith("/@modules/")) {
      const moduleName = path.replace("/@modules/", "");
      const bundled = this.preBundled.get(moduleName);
      if (bundled !== undefined) {
        const elapsed = performance.now() - startTime;
        this.emit({ type: "request", method: req.method, path, status: 200, contentType: "application/javascript", transformTime: elapsed });
        return { status: 200, headers: { "Content-Type": "application/javascript" }, body: bundled, transformResult: undefined };
      }
      return this.notFound(path);
    }

    // index.html
    if (path === "/" || path === "/index.html") {
      const html = this.vfs.readFile("/index.html");
      if (html !== undefined) {
        // index.html に HMR クライアントスクリプトを注入
        const injected = html.replace("</head>", `  <script type="module" src="/@vite/client"></script>\n</head>`);
        const elapsed = performance.now() - startTime;
        this.emit({ type: "request", method: req.method, path, status: 200, contentType: "text/html", transformTime: elapsed });
        return { status: 200, headers: { "Content-Type": "text/html" }, body: injected, transformResult: undefined };
      }
    }

    // /@vite/client (HMR クライアント)
    if (path === "/@vite/client") {
      const elapsed = performance.now() - startTime;
      this.emit({ type: "request", method: req.method, path, status: 200, contentType: "application/javascript", transformTime: elapsed });
      return { status: 200, headers: { "Content-Type": "application/javascript" }, body: HMR_CLIENT_CODE, transformResult: undefined };
    }

    // 通常のファイル
    const file = this.vfs.getFile(path);
    if (file === undefined) return this.notFound(path);

    // トランスフォーム
    const result = transform(path, file.content, file.lastModified);

    // 依存グラフ更新
    this.depGraph.updateFromCode(path, result.code);
    const edges = this.depGraph.toEdges();
    this.emit({ type: "dep_graph_update", modules: this.depGraph.getAllModules().length, edges: edges.length });

    if (result.transforms.length > 0) {
      this.emit({ type: "transform", path, steps: result.transforms.map(s => s.name) });
    }

    const elapsed = performance.now() - startTime;
    this.emit({ type: "request", method: req.method, path, status: 200, contentType: result.contentType, transformTime: elapsed });

    return {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-cache",
        "X-Transform-Steps": result.transforms.map(s => s.name).join(", "),
      },
      body: result.code,
      transformResult: result,
    };
  }

  // ファイル変更 → HMR
  handleFileChange(path: string): { boundary: string[]; propagation: string[] } {
    const { boundary, propagation } = this.depGraph.getHmrBoundary(path);

    if (boundary.includes("__full_reload__")) {
      this.emit({ type: "hmr_full_reload", reason: `No HMR boundary found for ${path}` });
    } else {
      this.emit({ type: "hmr_update", file: path, boundary, propagation });
    }

    return { boundary, propagation };
  }

  // 依存事前バンドル
  private preBundleModules(): void {
    // 仮想的な node_modules パッケージ
    const modules: Record<string, string> = {
      "react": `export function useState(init) { return [init, () => {}]; }\nexport function useEffect(fn) { fn(); }\nexport function createElement(tag, props, ...children) { return { tag, props, children }; }\nexport default { createElement, useState, useEffect };`,
      "react-dom": `export function render(element, container) { console.log("render:", element); }\nexport default { render };`,
      "lodash": `export function debounce(fn, ms) { return fn; }\nexport function throttle(fn, ms) { return fn; }\nexport default { debounce, throttle };`,
    };
    for (const [name, code] of Object.entries(modules)) {
      this.preBundled.set(name, `// [vite] Pre-bundled: ${name}\n${code}`);
      this.emit({ type: "prebundle", module: name });
    }
  }

  private notFound(path: string): HttpResponse {
    return { status: 404, headers: { "Content-Type": "text/plain" }, body: `404 Not Found: ${path}`, transformResult: undefined };
  }

  resetEvents(): void { this.events = []; }
}

const HMR_CLIENT_CODE = `// [vite] HMR Client
console.log("[vite] connecting...");
const ws = { send(data) { console.log("[vite] ws:", data); } };
export const createHotContext = (ownerPath) => ({
  accept() { console.log("[vite] HMR accept:", ownerPath); },
  dispose(cb) { cb(); },
});
import.meta.hot = createHotContext("/");
console.log("[vite] connected.");
`;
