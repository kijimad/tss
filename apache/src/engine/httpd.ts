/**
 * httpd.ts — Apache HTTP Server シミュレーション
 *
 * リクエスト処理の 11 フェーズ (hook) を簡易再現し、
 * VirtualHost 選択 → URI 変換 (mod_rewrite) →
 * アクセス制御 (.htaccess) → ハンドラ (静的/CGI/proxy) →
 * レスポンス生成 までをトレースする。
 */

// ── 型定義 ──

/** RewriteRule */
export interface RewriteRule {
  pattern: string;
  substitution: string;
  flags: string[];
}

/** Directory / .htaccess ディレクティブ */
export interface DirectoryConfig {
  path: string;
  /** AllowOverride (None / All) */
  allowOverride: "None" | "All";
  options: string[];
  /** Require 指令 */
  require?: "all granted" | "all denied" | string;
  /** DirectoryIndex */
  directoryIndex?: string;
  /** RewriteEngine + RewriteRule */
  rewriteRules?: RewriteRule[];
  /** ErrorDocument */
  errorDocuments?: Record<number, string>;
  /** AddHandler */
  handlers?: Record<string, string>;
  /** Header ディレクティブ */
  headerDirectives?: Record<string, string>;
}

/** ProxyPass 設定 */
export interface ProxyConfig {
  path: string;
  backend: string;
  /** mod_proxy_balancer のメンバー */
  balancerMembers?: { url: string; route?: string }[];
}

/** VirtualHost */
export interface VirtualHost {
  serverName: string;
  serverAlias?: string[];
  documentRoot: string;
  port: number;
  directories: DirectoryConfig[];
  proxies: ProxyConfig[];
  /** サーバレベルの RewriteRule */
  rewriteRules: RewriteRule[];
  /** SSL 有効か */
  ssl: boolean;
  /** 追加ログ設定の有無 */
  customLog?: string;
}

/** httpd.conf 全体 */
export interface HttpdConfig {
  serverRoot: string;
  loadedModules: string[];
  virtualHosts: VirtualHost[];
  /** 仮想ファイルシステム */
  fileSystem: Record<string, string>;
}

/** HTTP リクエスト */
export interface HttpRequest {
  method: string;
  host: string;
  uri: string;
  headers: Record<string, string>;
  queryString?: string;
}

/** HTTP レスポンス */
export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/** Apache 処理フェーズ */
export type Phase =
  | "post_read_request"
  | "uri_translation"
  | "header_parsing"
  | "access_control"
  | "authentication"
  | "authorization"
  | "mime_type"
  | "fixups"
  | "handler"
  | "logging"
  | "error";

/** 処理トレース */
export interface ApacheTrace {
  phase: Phase;
  module: string;
  detail: string;
}

/** リクエスト処理結果 */
export interface ApacheResult {
  request: HttpRequest;
  response: HttpResponse;
  trace: ApacheTrace[];
  matchedVHost: string | null;
  finalUri: string;
  handlerUsed: string;
}

// ── MIME タイプ ──

const MIME: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css",
  js: "application/javascript", json: "application/json",
  png: "image/png", jpg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml",
  txt: "text/plain", xml: "application/xml", ico: "image/x-icon",
  php: "application/x-httpd-php", cgi: "application/x-httpd-cgi",
  pdf: "application/pdf",
};

const STATUS_TEXT: Record<number, string> = {
  200: "OK", 301: "Moved Permanently", 302: "Found", 303: "See Other",
  304: "Not Modified", 400: "Bad Request", 401: "Unauthorized",
  403: "Forbidden", 404: "Not Found", 500: "Internal Server Error",
  502: "Bad Gateway", 503: "Service Unavailable",
};

// ── エンジン ──

export class ApacheEngine {
  private config: HttpdConfig;
  private proxyRrIndex = 0;

  constructor(config: HttpdConfig) {
    this.config = config;
  }

  get currentConfig(): HttpdConfig {
    return this.config;
  }

  /** リクエストを処理する */
  handleRequest(req: HttpRequest): ApacheResult {
    const trace: ApacheTrace[] = [];
    let uri = req.uri;

    // ── Phase 1: post_read_request ──
    trace.push({ phase: "post_read_request", module: "core", detail: `${req.method} ${req.host}${uri} HTTP/1.1` });

    // ── Phase 2: VirtualHost 選択 ──
    const vhost = this.selectVHost(req.host, req.headers);
    if (vhost === undefined) {
      trace.push({ phase: "uri_translation", module: "core", detail: `Host "${req.host}" に一致する VirtualHost なし → デフォルト` });
      const defaultVh = this.config.virtualHosts[0];
      if (defaultVh === undefined) {
        return this.errorResult(req, uri, 500, "No VirtualHost", trace);
      }
      return this.processVHost(req, uri, defaultVh, trace);
    }
    const sslTag = vhost.ssl ? " [SSL]" : "";
    trace.push({ phase: "uri_translation", module: "core", detail: `VirtualHost ${vhost.serverName}:${vhost.port}${sslTag} → DocumentRoot ${vhost.documentRoot}` });

    return this.processVHost(req, uri, vhost, trace);
  }

  private processVHost(req: HttpRequest, uri: string, vhost: VirtualHost, trace: ApacheTrace[]): ApacheResult {
    // ── Phase 3: mod_rewrite (サーバレベル) ──
    if (vhost.rewriteRules.length > 0) {
      const rewritten = this.applyRewriteRules(uri, vhost.rewriteRules, trace, "server");
      if (rewritten.redirect !== undefined) {
        return this.redirectResult(req, uri, rewritten.redirect.code, rewritten.redirect.url, trace, vhost.serverName);
      }
      uri = rewritten.uri;
    }

    // ── Phase 4: ファイルパス解決 (クエリ文字列を除去) ──
    const pathOnly = uri.split("?")[0]!;
    const filePath = vhost.documentRoot + pathOnly;
    trace.push({ phase: "uri_translation", module: "mod_alias", detail: `URI "${uri}" → ファイル "${filePath}"` });

    // ── Phase 5: ProxyPass チェック ──
    for (const proxy of vhost.proxies) {
      if (uri.startsWith(proxy.path)) {
        return this.handleProxy(req, uri, proxy, trace, vhost.serverName);
      }
    }

    // ── Phase 6: .htaccess / Directory ──
    const dir = this.findDirectory(uri, vhost);
    if (dir !== undefined) {
      // .htaccess の RewriteRule
      if (dir.allowOverride === "All" && dir.rewriteRules !== undefined && dir.rewriteRules.length > 0) {
        const rewritten = this.applyRewriteRules(uri, dir.rewriteRules, trace, ".htaccess");
        if (rewritten.redirect !== undefined) {
          return this.redirectResult(req, uri, rewritten.redirect.code, rewritten.redirect.url, trace, vhost.serverName);
        }
        uri = rewritten.uri;
      }

      // アクセス制御
      if (dir.require === "all denied") {
        trace.push({ phase: "access_control", module: "mod_authz_core", detail: `Require all denied → 403 Forbidden` });
        return this.errorResult(req, uri, 403, "Forbidden", trace, vhost.serverName);
      }
      if (dir.require !== undefined) {
        trace.push({ phase: "access_control", module: "mod_authz_core", detail: `Require ${dir.require} → OK` });
      }

      // ヘッダ操作
      if (dir.headerDirectives !== undefined) {
        for (const [k, v] of Object.entries(dir.headerDirectives)) {
          trace.push({ phase: "fixups", module: "mod_headers", detail: `Header set ${k}: ${v}` });
        }
      }
    }

    // ── Phase 7: MIME タイプ判定 ──
    const ext = uri.split(".").pop()?.toLowerCase() ?? "";
    const contentType = MIME[ext] ?? "application/octet-stream";
    trace.push({ phase: "mime_type", module: "mod_mime", detail: `.${ext} → ${contentType}` });

    // ── Phase 8: ハンドラ実行 ──

    // CGI / PHP ハンドラ
    if (ext === "cgi" || ext === "php") {
      return this.handleCgi(req, uri, filePath, vhost, trace);
    }

    // ディレクトリアクセス → index ファイル
    let resolvedPath = filePath;
    if (uri.endsWith("/")) {
      const indexFile = dir?.directoryIndex ?? "index.html";
      resolvedPath = filePath + indexFile;
      trace.push({ phase: "handler", module: "mod_dir", detail: `DirectoryIndex → "${resolvedPath}"` });
    }

    // 静的ファイル配信
    const content = this.config.fileSystem[resolvedPath];
    if (content !== undefined) {
      trace.push({ phase: "handler", module: "core", detail: `static file: ${resolvedPath} (${content.length} bytes)` });
      trace.push({ phase: "logging", module: "mod_log_config", detail: `${req.method} ${uri} 200 ${content.length}` });
      const headers: Record<string, string> = {
        "content-type": contentType,
        "server": "Apache/2.4.62 (Unix)",
        ...(dir?.headerDirectives ?? {}),
      };
      return {
        request: req, response: { status: 200, statusText: "OK", headers, body: content },
        trace, matchedVHost: vhost.serverName, finalUri: uri, handlerUsed: "default-handler",
      };
    }

    // ディレクトリリスティング
    if (uri.endsWith("/") && dir?.options?.includes("Indexes")) {
      return this.handleDirectoryListing(req, uri, filePath, vhost, trace);
    }

    // 404
    const errorDoc = dir?.errorDocuments?.[404];
    if (errorDoc !== undefined) {
      trace.push({ phase: "error", module: "core", detail: `ErrorDocument 404 ${errorDoc}` });
    }
    trace.push({ phase: "handler", module: "core", detail: `"${resolvedPath}" が見つからない → 404` });
    return this.errorResult(req, uri, 404, "Not Found", trace, vhost.serverName);
  }

  // ── mod_rewrite ──

  private applyRewriteRules(
    uri: string,
    rules: RewriteRule[],
    trace: ApacheTrace[],
    scope: string,
  ): { uri: string; redirect?: { code: number; url: string } } {
    trace.push({ phase: "uri_translation", module: "mod_rewrite", detail: `RewriteEngine On (${scope}), ${rules.length} ルール` });

    for (const rule of rules) {
      const regex = new RegExp(rule.pattern);
      const match = uri.match(regex);
      if (match === null) {
        trace.push({ phase: "uri_translation", module: "mod_rewrite", detail: `  "${rule.pattern}" → 不一致` });
        continue;
      }

      let newUri = rule.substitution;
      // バックリファレンス $1, $2 ...
      for (let i = 1; i < match.length; i++) {
        newUri = newUri.replace(`$${i}`, match[i] ?? "");
      }

      const isRedirect = rule.flags.some((f) => f.startsWith("R=") || f === "R");
      const isLast = rule.flags.includes("L");

      if (isRedirect) {
        const codeFlag = rule.flags.find((f) => f.startsWith("R="));
        const code = codeFlag !== undefined ? Number(codeFlag.slice(2)) : 302;
        trace.push({ phase: "uri_translation", module: "mod_rewrite", detail: `  "${rule.pattern}" → "${newUri}" [R=${code}]` });
        return { uri, redirect: { code, url: newUri } };
      }

      trace.push({ phase: "uri_translation", module: "mod_rewrite", detail: `  "${rule.pattern}" → "${newUri}"${isLast ? " [L]" : ""}` });
      uri = newUri;
      if (isLast) break;
    }
    return { uri };
  }

  // ── mod_proxy ──

  private handleProxy(
    req: HttpRequest, uri: string, proxy: ProxyConfig,
    trace: ApacheTrace[], serverName: string,
  ): ApacheResult {
    trace.push({ phase: "handler", module: "mod_proxy", detail: `ProxyPass ${proxy.path} → ${proxy.backend}` });

    let target: string;
    if (proxy.balancerMembers !== undefined && proxy.balancerMembers.length > 0) {
      const member = proxy.balancerMembers[this.proxyRrIndex % proxy.balancerMembers.length]!;
      this.proxyRrIndex++;
      target = member.url;
      trace.push({ phase: "handler", module: "mod_proxy_balancer", detail: `BalancerMember ${target}${member.route ? ` route=${member.route}` : ""}` });
    } else {
      target = proxy.backend;
    }

    const backendPath = uri.replace(proxy.path, "/");
    trace.push({ phase: "handler", module: "mod_proxy_http", detail: `→ ${target}${backendPath}` });
    trace.push({ phase: "logging", module: "mod_log_config", detail: `${req.method} ${uri} 200 (proxy)` });

    return {
      request: req,
      response: {
        status: 200, statusText: "OK",
        headers: { "server": "Apache/2.4.62 (Unix)", "x-backend": target },
        body: JSON.stringify({ upstream: target, path: backendPath }),
      },
      trace, matchedVHost: serverName, finalUri: uri, handlerUsed: "proxy-server",
    };
  }

  // ── CGI ──

  private handleCgi(
    req: HttpRequest, uri: string, filePath: string,
    vhost: VirtualHost, trace: ApacheTrace[],
  ): ApacheResult {
    trace.push({ phase: "handler", module: "mod_cgi", detail: `CGI 実行: ${filePath}` });
    trace.push({ phase: "handler", module: "mod_cgi", detail: `env: REQUEST_METHOD=${req.method} QUERY_STRING=${req.queryString ?? ""}` });

    const content = this.config.fileSystem[filePath];
    const body = content ?? `CGI output from ${filePath}`;
    trace.push({ phase: "logging", module: "mod_log_config", detail: `${req.method} ${uri} 200 (cgi)` });

    return {
      request: req,
      response: { status: 200, statusText: "OK", headers: { "server": "Apache/2.4.62 (Unix)", "content-type": "text/html" }, body },
      trace, matchedVHost: vhost.serverName, finalUri: uri, handlerUsed: "cgi-script",
    };
  }

  // ── ディレクトリリスティング ──

  private handleDirectoryListing(
    req: HttpRequest, uri: string, dirPath: string,
    vhost: VirtualHost, trace: ApacheTrace[],
  ): ApacheResult {
    trace.push({ phase: "handler", module: "mod_autoindex", detail: `Options +Indexes → ディレクトリリスティング` });
    const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
    const entries = Object.keys(this.config.fileSystem)
      .filter((f) => f.startsWith(prefix) && f !== prefix)
      .map((f) => f.slice(prefix.length).split("/")[0]!)
      .filter((f, i, a) => a.indexOf(f) === i);

    const listing = entries.map((e) => `  <a href="${uri}${e}">${e}</a>`).join("\n");
    const body = `<html><body><h1>Index of ${uri}</h1><pre>\n${listing}\n</pre></body></html>`;
    trace.push({ phase: "logging", module: "mod_log_config", detail: `${req.method} ${uri} 200 (autoindex)` });

    return {
      request: req,
      response: { status: 200, statusText: "OK", headers: { "server": "Apache/2.4.62 (Unix)", "content-type": "text/html" }, body },
      trace, matchedVHost: vhost.serverName, finalUri: uri, handlerUsed: "mod_autoindex",
    };
  }

  // ── ヘルパー ──

  private selectVHost(host: string, _headers: Record<string, string>): VirtualHost | undefined {
    const h = host.split(":")[0] ?? host;
    return this.config.virtualHosts.find((v) =>
      v.serverName === h || v.serverAlias?.includes(h),
    );
  }

  private findDirectory(uri: string, vhost: VirtualHost): DirectoryConfig | undefined {
    let best: DirectoryConfig | undefined;
    let bestLen = 0;
    for (const dir of vhost.directories) {
      if (uri.startsWith(dir.path) && dir.path.length > bestLen) {
        best = dir;
        bestLen = dir.path.length;
      }
    }
    return best;
  }

  private redirectResult(
    req: HttpRequest, uri: string, status: number, location: string,
    trace: ApacheTrace[], serverName: string,
  ): ApacheResult {
    trace.push({ phase: "handler", module: "mod_rewrite", detail: `Redirect ${status} → ${location}` });
    trace.push({ phase: "logging", module: "mod_log_config", detail: `${req.method} ${uri} ${status}` });
    return {
      request: req,
      response: { status, statusText: STATUS_TEXT[status] ?? "Redirect", headers: { location, "server": "Apache/2.4.62 (Unix)" }, body: "" },
      trace, matchedVHost: serverName, finalUri: uri, handlerUsed: "mod_rewrite",
    };
  }

  private errorResult(
    req: HttpRequest, uri: string, status: number, message: string,
    trace: ApacheTrace[], serverName?: string,
  ): ApacheResult {
    trace.push({ phase: "logging", module: "mod_log_config", detail: `${req.method} ${uri} ${status}` });
    const body = `<!DOCTYPE HTML><html><head><title>${status} ${message}</title></head><body><h1>${message}</h1><hr><address>Apache/2.4.62 (Unix) Server at ${req.host}</address></body></html>`;
    return {
      request: req,
      response: { status, statusText: message, headers: { "server": "Apache/2.4.62 (Unix)", "content-type": "text/html" }, body },
      trace, matchedVHost: serverName ?? null, finalUri: uri, handlerUsed: "core",
    };
  }
}
