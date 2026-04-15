/**
 * nginx.ts — Nginx シミュレーションエンジン
 *
 * Nginx はイベント駆動型のWebサーバー/リバースプロキシであり、
 * マスター・ワーカー プロセスモデルとノンブロッキングI/O（epoll/kqueue）を
 * 用いて高い並行接続性能を実現する。
 *
 * このモジュールでは、Nginx のリクエスト処理パイプラインを再現する:
 *   1. 接続受付 (accept)
 *   2. server ブロック選択 — Host ヘッダ（バーチャルホスト）によるマッチ
 *   3. location ブロック選択 — URI パスのマッチング（完全一致/プレフィックス/正規表現）
 *   4. ディレクティブ実行 — return / proxy_pass / 静的ファイル配信 など
 *   5. レスポンス生成
 *
 * 外部ネットワークや物理現象（バックエンド応答、ファイルI/O）は
 * すべてコード内でエミュレートしている。
 */

// ── location マッチ種別 (Nginx の優先順位順) ──
// Nginx は location ディレクティブに対して以下の優先順位でマッチングを行う:
//   1. exact (=)           — URI が完全一致すれば即座に確定（最高優先）
//   2. prefix_priority (^~) — 最長プレフィックス一致で、正規表現評価をスキップ
//   3. regex (~ / ~*)       — 設定ファイル記載順で最初にマッチした正規表現を採用
//   4. prefix (なし)        — 最長プレフィックス一致（正規表現に負ける）

export type LocationMatch =
  | { type: "exact"; path: string }        // = /path  — 完全一致
  | { type: "prefix_priority"; path: string } // ^~ /path — 優先プレフィックス一致
  | { type: "regex"; pattern: string }     // ~ or ~* — 正規表現一致（~* は大文字小文字無視）
  | { type: "prefix"; path: string };      // /path   — 通常のプレフィックス一致

/**
 * upstream バックエンド — 個々のバックエンドサーバーを表す。
 * Nginx の upstream ブロック内で `server` ディレクティブとして定義される。
 * weight はトラフィック配分比率に影響し、healthy フラグでヘルスチェック状態を管理する。
 */
export interface UpstreamServer {
  /** バックエンドサーバーのアドレス（例: "10.0.1.1:8080"） */
  address: string;
  /** 重み付け — 値が大きいほど多くのリクエストが振り分けられる */
  weight: number;
  /** ヘルスチェック状態 — false の場合、ロードバランサーはこのサーバーをスキップする */
  healthy: boolean;
}

/**
 * upstream グループ — Nginx のロードバランシング設定を表す。
 * upstream ブロックは複数のバックエンドサーバーをグループ化し、
 * proxy_pass から参照される名前付きバックエンドプールを構成する。
 *
 * 負荷分散アルゴリズム:
 *   - round-robin: リクエストを順番に各サーバーへ振り分ける（デフォルト）
 *   - least-conn:  アクティブ接続数が最も少ないサーバーを選択する
 *   - ip-hash:     クライアントIPのハッシュ値で固定サーバーに振り分ける（セッション維持）
 */
export interface Upstream {
  /** upstream ブロック名 — proxy_pass で "http://<name>" として参照される */
  name: string;
  /** 負荷分散アルゴリズムの種別 */
  method: "round-robin" | "least-conn" | "ip-hash";
  /** バックエンドサーバーの一覧 */
  servers: UpstreamServer[];
  /** ラウンドロビン用の内部カウンタ — 次に使用するサーバーのインデックスを追跡する */
  _rrIndex?: number;
}

/**
 * location ブロックのディレクティブ — Nginx の各 location ブロック内で
 * 設定可能なディレクティブ群。リクエスト処理の方法を決定する。
 *
 * 処理の優先順位: return → proxy_pass → root（静的ファイル）
 */
export interface LocationDirectives {
  /** root ディレクティブ — 静的ファイルのドキュメントルートパスを指定する */
  root?: string;
  /** index ディレクティブ — ディレクトリアクセス時のデフォルトファイル名（例: "index.html"） */
  index?: string;
  /** proxy_pass ディレクティブ — リバースプロキシ先のURL。upstream 名または直接URLを指定する */
  proxyPass?: string;
  /** return ディレクティブ — 指定したHTTPステータスコードを即座に返す（リダイレクト等に使用） */
  returnCode?: number;
  /** return ディレクティブのボディ — レスポンス本文またはリダイレクト先URL */
  returnBody?: string;
  /** add_header ディレクティブ — レスポンスに追加するカスタムHTTPヘッダ */
  addHeaders?: Record<string, string>;
  /** try_files ディレクティブ — 指定した順序でファイルを探索し、最初に見つかったものを返す */
  tryFiles?: string[];
  /** expires ディレクティブ — Cache-Control ヘッダの max-age 値を設定する（秒数） */
  expires?: string;
  /** limit_req ディレクティブ — レート制限ゾーンを指定してリクエスト数を制御する */
  limitReq?: string;
}

/**
 * location ブロック — URI パスのマッチ条件とそのブロック内のディレクティブを保持する。
 * Nginx の設定ファイルにおける `location [修飾子] <パス> { ... }` に対応する。
 */
export interface LocationBlock {
  /** URI マッチング条件（完全一致、プレフィックス、正規表現など） */
  match: LocationMatch;
  /** このlocationブロック内で適用されるディレクティブ群 */
  directives: LocationDirectives;
}

/**
 * server ブロック — Nginx のバーチャルホスト設定に対応する。
 * 1つの server ブロックが1つの仮想サーバーを定義し、
 * listen ポートと server_name（ホスト名）の組み合わせでリクエストを振り分ける。
 */
export interface ServerBlock {
  /** listen ディレクティブ — このサーバーが待ち受けるポート番号 */
  listen: number;
  /** server_name ディレクティブ — マッチ対象のホスト名リスト（"_" はワイルドカード） */
  serverName: string[];
  /** このサーバーブロック内の location ブロック一覧 */
  locations: LocationBlock[];
  /** すべてのレスポンスに付与するデフォルトHTTPヘッダ */
  defaultHeaders?: Record<string, string>;
}

/**
 * nginx.conf 全体の設定を表す構造体。
 * 実際の Nginx では http コンテキスト内に upstream / server ブロックが配置される。
 * staticFiles は仮想ファイルシステムとして、実際のディスクI/Oをエミュレートする。
 */
export interface NginxConfig {
  /** upstream ブロック一覧 — ロードバランシング用のバックエンドグループ定義 */
  upstreams: Upstream[];
  /** server ブロック一覧 — バーチャルホスト定義 */
  servers: ServerBlock[];
  /** 仮想ファイルシステム — パスをキーとしたファイル内容のマップ（ディスクI/Oのエミュレート） */
  staticFiles: Record<string, string>;
}

// ── HTTP リクエスト/レスポンス型定義 ──

/** HTTP リクエスト — クライアントから Nginx に送信されるリクエストを表す */
export interface HttpRequest {
  /** HTTPメソッド（GET, POST, PUT, DELETE など） */
  method: string;
  /** Host ヘッダの値 — server_name マッチングに使用される */
  host: string;
  /** リクエストURI パス — location マッチングの対象 */
  path: string;
  /** HTTPリクエストヘッダ（user-agent, cookie 等） */
  headers: Record<string, string>;
  /** リクエストボディ（POST/PUTリクエスト時） */
  body?: string;
}

/** HTTP レスポンス — Nginx からクライアントに返却されるレスポンスを表す */
export interface HttpResponse {
  /** HTTPステータスコード（200, 301, 404, 502 など） */
  status: number;
  /** ステータスコードに対応するテキスト（"OK", "Not Found" など） */
  statusText: string;
  /** HTTPレスポンスヘッダ（content-type, cache-control, server 等） */
  headers: Record<string, string>;
  /** レスポンスボディ（HTML, JSON 等） */
  body: string;
}

/**
 * 処理トレースの 1 ステップ — Nginx のリクエスト処理パイプラインの各フェーズを記録する。
 *
 * フェーズ一覧:
 *   - accept:         接続受付（クライアントからのリクエスト到着）
 *   - server_match:   server ブロックの選択（Host ヘッダによるバーチャルホスト判定）
 *   - location_match: location ブロックの選択（URIパターンマッチング）
 *   - rewrite:        URI書き換え処理
 *   - proxy:          proxy_pass によるリバースプロキシ転送
 *   - upstream:       upstream サーバー選択（ロードバランシング）
 *   - static:         静的ファイル配信処理
 *   - return:         return ディレクティブによる即時レスポンス
 *   - response:       最終レスポンス生成
 *   - header:         レスポンスヘッダの付与
 *   - error:          エラー発生
 */
export interface NginxTrace {
  phase: "accept" | "server_match" | "location_match" | "rewrite" | "proxy" | "upstream" | "static" | "return" | "response" | "header" | "error";
  detail: string;
}

/**
 * リクエスト処理結果 — 1つのHTTPリクエストに対する Nginx の処理結果をまとめた構造体。
 * レスポンス本体に加え、マッチしたサーバー/locationの情報やトレースログを含む。
 */
export interface NginxResult {
  /** 元のHTTPリクエスト */
  request: HttpRequest;
  /** Nginx が生成したHTTPレスポンス */
  response: HttpResponse;
  /** 処理パイプラインのトレースログ — 各フェーズの詳細を時系列で記録 */
  trace: NginxTrace[];
  /** マッチした server ブロックの server_name（null の場合はマッチなし） */
  matchedServer: string | null;
  /** マッチした location ブロックのラベル表現（null の場合はマッチなし） */
  matchedLocation: string | null;
  /** 選択された upstream サーバーのアドレス（null の場合は upstream 未使用） */
  upstreamServer: string | null;
}

// ── Nginx シミュレーションエンジン本体 ──

/**
 * NginxEngine — Nginx のリクエスト処理パイプラインをエミュレートするクラス。
 *
 * 実際の Nginx はマスタープロセスが設定を読み込み、ワーカープロセスが
 * epoll/kqueue ベースのイベントループでリクエストを非同期処理する。
 * このシミュレーターでは同期的に処理を行い、各フェーズのトレースを記録する。
 */
export class NginxEngine {
  /** Nginx の設定（nginx.conf に相当） */
  private config: NginxConfig;

  constructor(config: NginxConfig) {
    this.config = config;
    // 各 upstream グループのラウンドロビンカウンタを初期化する
    for (const up of config.upstreams) {
      up._rrIndex = 0;
    }
  }

  /** 現在の設定オブジェクトを取得する */
  get currentConfig(): NginxConfig {
    return this.config;
  }

  /**
   * HTTP リクエストを処理するメインエントリポイント。
   * Nginx のリクエスト処理フローに従い、以下の順序で処理を行う:
   *   1. 接続受付 (accept フェーズ)
   *   2. server ブロック選択 — Host ヘッダでバーチャルホストをマッチ
   *   3. location ブロック選択 — URI パスで最適な location を決定
   *   4. ディレクティブ実行 — return / proxy_pass / 静的ファイル配信
   *   5. レスポンス返却
   */
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

  /**
   * 選択された server ブロック内でリクエストを処理する。
   * location マッチング → ディレクティブ実行 → レスポンス生成の順に処理する。
   */
  private processServer(req: HttpRequest, server: ServerBlock, trace: NginxTrace[]): NginxResult {
    // 2. location マッチング — Nginx の優先順位（= > ^~ > ~ > prefix）に従って最適な location を選択
    const loc = this.matchLocation(req.path, server.locations);
    if (loc === undefined) {
      trace.push({ phase: "location_match", detail: `"${req.path}" に一致する location なし → 404` });
      return this.errorResult(req, 404, "Not Found", trace, server.serverName.join(","));
    }

    const locLabel = this.locationLabel(loc.match);
    trace.push({ phase: "location_match", detail: `location ${locLabel} にマッチ` });

    const dirs = loc.directives;

    // レスポンスヘッダを構築する
    // Nginx は常に "Server" ヘッダを付与し、server ブロックのデフォルトヘッダ、
    // location ブロックの add_header ディレクティブの順でマージする
    const responseHeaders: Record<string, string> = {
      "server": "nginx/1.27.0",
      ...(server.defaultHeaders ?? {}),
      ...(dirs.addHeaders ?? {}),
    };

    // expires ディレクティブ — ブラウザキャッシュ制御用の Cache-Control ヘッダを設定
    if (dirs.expires !== undefined) {
      responseHeaders["cache-control"] = `max-age=${dirs.expires}`;
      trace.push({ phase: "header", detail: `Cache-Control: max-age=${dirs.expires}` });
    }

    // 3. return ディレクティブ — 即座にレスポンスを返す（リダイレクト、ヘルスチェック応答等）
    // 3xx 系の場合は Location ヘッダにリダイレクト先URLを設定する
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

    // 4. proxy_pass ディレクティブ — リクエストをバックエンドサーバーに転送（リバースプロキシ）
    // upstream グループ名が指定されていればロードバランサーを経由する
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
