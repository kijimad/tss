/**
 * nginx.ts — Nginx シミュレーションエンジン
 *
 * server ブロック → location マッチング → ディレクティブ実行 の
 * リクエスト処理パイプラインを再現する。
 */

// ── location マッチ種別 (Nginx の優先順位順) ──

export type LocationMatch =
  | { type: "exact"; path: string }        // = /path
  | { type: "prefix_priority"; path: string } // ^~ /path
  | { type: "regex"; pattern: string }     // ~ or ~*
  | { type: "prefix"; path: string };      // /path

/** upstream バックエンド */
export interface UpstreamServer {
  address: string;
  weight: number;
  healthy: boolean;
}

/** upstream グループ */
export interface Upstream {
  name: string;
  method: "round-robin" | "least-conn" | "ip-hash";
  servers: UpstreamServer[];
  /** ラウンドロビン用カウンタ */
  _rrIndex?: number;
}

/** location ブロックのディレクティブ */
export interface LocationDirectives {
  /** 静的ファイル配信 */
  root?: string;
  index?: string;
  /** リバースプロキシ */
  proxyPass?: string;
  /** リダイレクト */
  returnCode?: number;
  returnBody?: string;
  /** ヘッダ追加 */
  addHeaders?: Record<string, string>;
  /** レスポンスの型 */
  tryFiles?: string[];
  /** キャッシュ設定 */
  expires?: string;
  /** レート制限 */
  limitReq?: string;
}

/** location ブロック */
export interface LocationBlock {
  match: LocationMatch;
  directives: LocationDirectives;
}

/** server ブロック */
export interface ServerBlock {
  listen: number;
  serverName: string[];
  locations: LocationBlock[];
  /** デフォルトヘッダ */
  defaultHeaders?: Record<string, string>;
}

/** nginx.conf 全体 */
export interface NginxConfig {
  upstreams: Upstream[];
  servers: ServerBlock[];
  /** 仮想ファイルシステム */
  staticFiles: Record<string, string>;
}

// ── HTTP ──

export interface HttpRequest {
  method: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/** 処理トレースの 1 ステップ */
export interface NginxTrace {
  phase: "accept" | "server_match" | "location_match" | "rewrite" | "proxy" | "upstream" | "static" | "return" | "response" | "header" | "error";
  detail: string;
}

/** リクエスト処理結果 */
export interface NginxResult {
  request: HttpRequest;
  response: HttpResponse;
  trace: NginxTrace[];
  matchedServer: string | null;
  matchedLocation: string | null;
  upstreamServer: string | null;
}

// ── エンジン ──

export class NginxEngine {
  private config: NginxConfig;

  constructor(config: NginxConfig) {
    this.config = config;
    // RR インデックス初期化
    for (const up of config.upstreams) {
      up._rrIndex = 0;
    }
  }

  get currentConfig(): NginxConfig {
    return this.config;
  }

  /** HTTP リクエストを処理する */
  handleRequest(req: HttpRequest): NginxResult {
    const trace: NginxTrace[] = [];

    trace.push({ phase: "accept", detail: `${req.method} ${req.host}${req.path} (${req.headers["user-agent"] ?? ""})`});

    // 1. server ブロック選択 (Host ヘッダでマッチ)
    const server = this.matchServer(req.host);
    if (server === undefined) {
      trace.push({ phase: "server_match", detail: `Host "${req.host}" に一致する server ブロックなし → デフォルト` });
      // デフォルト server (最初のもの)
      const defaultServer = this.config.servers[0];
      if (defaultServer === undefined) {
        trace.push({ phase: "error", detail: "server ブロックが定義されていない" });
        return this.errorResult(req, 500, "No server block", trace);
      }
      return this.processServer(req, defaultServer, trace);
    }

    trace.push({ phase: "server_match", detail: `server "${server.serverName.join(", ")}" (listen :${server.listen})` });
    return this.processServer(req, server, trace);
  }

  private processServer(req: HttpRequest, server: ServerBlock, trace: NginxTrace[]): NginxResult {
    // 2. location マッチング (Nginx の優先順位に従う)
    const loc = this.matchLocation(req.path, server.locations);
    if (loc === undefined) {
      trace.push({ phase: "location_match", detail: `"${req.path}" に一致する location なし → 404` });
      return this.errorResult(req, 404, "Not Found", trace, server.serverName.join(","));
    }

    const locLabel = this.locationLabel(loc.match);
    trace.push({ phase: "location_match", detail: `location ${locLabel} にマッチ` });

    const dirs = loc.directives;
    const responseHeaders: Record<string, string> = {
      "server": "nginx/1.27.0",
      ...(server.defaultHeaders ?? {}),
      ...(dirs.addHeaders ?? {}),
    };

    if (dirs.expires !== undefined) {
      responseHeaders["cache-control"] = `max-age=${dirs.expires}`;
      trace.push({ phase: "header", detail: `Cache-Control: max-age=${dirs.expires}` });
    }

    // 3. return ディレクティブ (リダイレクト等)
    if (dirs.returnCode !== undefined) {
      const body = dirs.returnBody ?? "";
      if (dirs.returnCode >= 300 && dirs.returnCode < 400) {
        responseHeaders["location"] = body;
        trace.push({ phase: "return", detail: `return ${dirs.returnCode} → ${body}` });
      } else {
        trace.push({ phase: "return", detail: `return ${dirs.returnCode} "${body}"` });
      }
      return this.makeResult(req, dirs.returnCode, responseHeaders, body, trace, server.serverName.join(","), locLabel, null);
    }

    // 4. proxy_pass (リバースプロキシ)
    if (dirs.proxyPass !== undefined) {
      return this.handleProxy(req, dirs.proxyPass, responseHeaders, trace, server.serverName.join(","), locLabel);
    }

    // 5. 静的ファイル配信
    if (dirs.root !== undefined) {
      return this.handleStatic(req, dirs, responseHeaders, trace, server.serverName.join(","), locLabel);
    }

    trace.push({ phase: "error", detail: "ディレクティブが空 → 500" });
    return this.errorResult(req, 500, "No directive", trace, server.serverName.join(","), locLabel);
  }

  /** リバースプロキシ処理 */
  private handleProxy(
    req: HttpRequest, proxyPass: string, headers: Record<string, string>,
    trace: NginxTrace[], serverName: string, locLabel: string,
  ): NginxResult {
    trace.push({ phase: "proxy", detail: `proxy_pass ${proxyPass}` });

    // upstream 解決
    const upstreamName = proxyPass.replace("http://", "");
    const upstream = this.config.upstreams.find((u) => u.name === upstreamName);

    let targetAddress: string;
    if (upstream !== undefined) {
      const server = this.selectUpstream(upstream);
      if (server === undefined) {
        trace.push({ phase: "upstream", detail: `upstream "${upstream.name}" に健全なサーバーがない → 502` });
        return this.errorResult(req, 502, "Bad Gateway", trace, serverName, locLabel);
      }
      targetAddress = server.address;
      trace.push({ phase: "upstream", detail: `upstream "${upstream.name}" (${upstream.method}) → ${server.address} (weight=${server.weight})` });
    } else {
      targetAddress = proxyPass;
      trace.push({ phase: "upstream", detail: `直接プロキシ → ${proxyPass}` });
    }

    // バックエンドからのレスポンスをシミュレート
    headers["x-upstream"] = targetAddress;
    const body = JSON.stringify({ upstream: targetAddress, path: req.path, method: req.method });
    trace.push({ phase: "response", detail: `200 OK (from ${targetAddress})` });

    return this.makeResult(req, 200, headers, body, trace, serverName, locLabel, targetAddress);
  }

  /** 静的ファイル配信 */
  private handleStatic(
    req: HttpRequest, dirs: LocationDirectives, headers: Record<string, string>,
    trace: NginxTrace[], serverName: string, locLabel: string,
  ): NginxResult {
    let filePath = (dirs.root ?? "") + req.path;

    // ディレクトリの場合 index を付与
    if (filePath.endsWith("/")) {
      filePath += dirs.index ?? "index.html";
    }

    trace.push({ phase: "static", detail: `root "${dirs.root}" → ファイル "${filePath}"` });

    // try_files
    if (dirs.tryFiles !== undefined) {
      let found = false;
      for (const tf of dirs.tryFiles) {
        const candidate = tf === "$uri" ? filePath : tf.startsWith("=") ? tf : (dirs.root ?? "") + tf;
        if (candidate.startsWith("=")) {
          const code = Number(candidate.slice(1));
          trace.push({ phase: "static", detail: `try_files fallback → ${code}` });
          return this.errorResult(req, code, code === 404 ? "Not Found" : "Error", trace, serverName, locLabel);
        }
        if (this.config.staticFiles[candidate] !== undefined) {
          filePath = candidate;
          found = true;
          trace.push({ phase: "static", detail: `try_files: "${candidate}" → 発見` });
          break;
        }
        trace.push({ phase: "static", detail: `try_files: "${candidate}" → なし` });
      }
      if (!found) {
        trace.push({ phase: "static", detail: "try_files: 全候補なし → 404" });
        return this.errorResult(req, 404, "Not Found", trace, serverName, locLabel);
      }
    }

    const content = this.config.staticFiles[filePath];
    if (content === undefined) {
      trace.push({ phase: "static", detail: `"${filePath}" が見つからない → 404` });
      return this.errorResult(req, 404, "Not Found", trace, serverName, locLabel);
    }

    const ext = filePath.split(".").pop() ?? "";
    headers["content-type"] = MIME_TYPES[ext] ?? "application/octet-stream";
    trace.push({ phase: "response", detail: `200 OK (${content.length} bytes, ${headers["content-type"]})` });

    return this.makeResult(req, 200, headers, content, trace, serverName, locLabel, null);
  }

  // ── マッチングロジック ──

  private matchServer(host: string): ServerBlock | undefined {
    const h = host.split(":")[0] ?? host;
    return this.config.servers.find((s) =>
      s.serverName.some((n) => {
        if (n.startsWith("*.")) return h.endsWith(n.slice(1));
        if (n === "_") return true;
        return n === h;
      }),
    );
  }

  /** Nginx の location マッチング優先順位を再現 */
  matchLocation(path: string, locations: LocationBlock[]): LocationBlock | undefined {
    // 1. exact match (=)
    for (const loc of locations) {
      if (loc.match.type === "exact" && loc.match.path === path) return loc;
    }

    // 2. prefix match — 最長一致を探す
    let bestPrefix: LocationBlock | undefined;
    let bestLen = 0;
    let isPriority = false;

    for (const loc of locations) {
      if (loc.match.type === "prefix" || loc.match.type === "prefix_priority") {
        const p = loc.match.path;
        if (path.startsWith(p) && p.length > bestLen) {
          bestPrefix = loc;
          bestLen = p.length;
          isPriority = loc.match.type === "prefix_priority";
        }
      }
    }

    // ^~ なら regex をスキップ
    if (isPriority && bestPrefix !== undefined) return bestPrefix;

    // 3. regex match (先に定義された順)
    for (const loc of locations) {
      if (loc.match.type === "regex") {
        const re = new RegExp(loc.match.pattern);
        if (re.test(path)) return loc;
      }
    }

    // 4. 最長 prefix match
    return bestPrefix;
  }

  /** upstream サーバー選択 */
  private selectUpstream(upstream: Upstream): UpstreamServer | undefined {
    const healthy = upstream.servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;

    switch (upstream.method) {
      case "round-robin": {
        const idx = (upstream._rrIndex ?? 0) % healthy.length;
        upstream._rrIndex = idx + 1;
        return healthy[idx];
      }
      case "least-conn":
        return healthy[0]; // 簡略版
      case "ip-hash":
        return healthy[0]; // 簡略版
    }
  }

  private locationLabel(m: LocationMatch): string {
    switch (m.type) {
      case "exact":           return `= ${m.path}`;
      case "prefix_priority": return `^~ ${m.path}`;
      case "regex":           return `~ ${m.pattern}`;
      case "prefix":          return m.path;
    }
  }

  private makeResult(
    req: HttpRequest, status: number, headers: Record<string, string>, body: string,
    trace: NginxTrace[], server: string, location: string | null, upstream: string | null,
  ): NginxResult {
    return {
      request: req,
      response: { status, statusText: STATUS_TEXT[status] ?? "Unknown", headers, body },
      trace, matchedServer: server, matchedLocation: location, upstreamServer: upstream,
    };
  }

  private errorResult(
    req: HttpRequest, status: number, message: string, trace: NginxTrace[],
    server?: string, location?: string,
  ): NginxResult {
    trace.push({ phase: "response", detail: `${status} ${message}` });
    const body = `<html><body><center><h1>${status} ${message}</h1></center><hr><center>nginx/1.27.0</center></body></html>`;
    return {
      request: req,
      response: { status, statusText: message, headers: { "server": "nginx/1.27.0", "content-type": "text/html" }, body },
      trace, matchedServer: server ?? null, matchedLocation: location ?? null, upstreamServer: null,
    };
  }
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK", 301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
};

const MIME_TYPES: Record<string, string> = {
  html: "text/html", css: "text/css", js: "application/javascript",
  json: "application/json", png: "image/png", jpg: "image/jpeg",
  svg: "image/svg+xml", txt: "text/plain", ico: "image/x-icon",
};
