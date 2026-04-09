import { NginxEngine } from "../engine/nginx.js";
import type {
  NginxConfig, HttpRequest,
  NginxResult, NginxTrace,
} from "../engine/nginx.js";

export interface Example {
  name: string;
  description: string;
  config: NginxConfig;
  /** nginx.conf 表示用テキスト */
  confText: string;
  requests: HttpRequest[];
}

const hdr = (ua = "Mozilla/5.0"): Record<string, string> => ({ "user-agent": ua });
const req = (method: string, host: string, path: string): HttpRequest => ({ method, host, path, headers: hdr() });

export const EXAMPLES: Example[] = [
  {
    name: "静的ファイル配信",
    description: "root + index + try_files による静的 Web サイト配信。存在しないパスは 404。",
    confText: `server {
    listen 80;
    server_name example.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location /assets/ {
        expires 30d;
    }
}`,
    config: {
      upstreams: [],
      servers: [{
        listen: 80, serverName: ["example.com"],
        locations: [
          { match: { type: "prefix", path: "/" }, directives: { root: "/var/www/html", index: "index.html", tryFiles: ["$uri", "=404"] } },
          { match: { type: "prefix", path: "/assets/" }, directives: { root: "/var/www/html", expires: "2592000" } },
        ],
      }],
      staticFiles: {
        "/var/www/html/index.html": "<html><body><h1>Welcome</h1></body></html>",
        "/var/www/html/about.html": "<html><body><h1>About</h1></body></html>",
        "/var/www/html/assets/style.css": "body { margin: 0; }",
        "/var/www/html/assets/logo.png": "[PNG binary data]",
      },
    },
    requests: [
      req("GET", "example.com", "/index.html"),
      req("GET", "example.com", "/about.html"),
      req("GET", "example.com", "/assets/style.css"),
      req("GET", "example.com", "/not-found.html"),
      req("GET", "example.com", "/assets/logo.png"),
    ],
  },
  {
    name: "リバースプロキシ + upstream",
    description: "3 台のバックエンドに round-robin で負荷分散。proxy_pass で upstream に転送。",
    confText: `upstream backend {
    server 10.0.1.1:8080 weight=3;
    server 10.0.1.2:8080 weight=2;
    server 10.0.1.3:8080 weight=1;
}

server {
    listen 80;
    server_name api.example.com;

    location /api/ {
        proxy_pass http://backend;
        proxy_set_header X-Forwarded-For $remote_addr;
    }

    location /health {
        return 200 "ok";
    }
}`,
    config: {
      upstreams: [{
        name: "backend", method: "round-robin",
        servers: [
          { address: "10.0.1.1:8080", weight: 3, healthy: true },
          { address: "10.0.1.2:8080", weight: 2, healthy: true },
          { address: "10.0.1.3:8080", weight: 1, healthy: true },
        ],
      }],
      servers: [{
        listen: 80, serverName: ["api.example.com"],
        locations: [
          { match: { type: "prefix", path: "/api/" }, directives: { proxyPass: "http://backend", addHeaders: { "x-forwarded-for": "client-ip" } } },
          { match: { type: "exact", path: "/health" }, directives: { returnCode: 200, returnBody: "ok" } },
        ],
      }],
      staticFiles: {},
    },
    requests: [
      req("GET", "api.example.com", "/api/users"),
      req("POST", "api.example.com", "/api/users"),
      req("GET", "api.example.com", "/api/orders"),
      req("GET", "api.example.com", "/api/products"),
      req("GET", "api.example.com", "/health"),
      req("GET", "api.example.com", "/not-api"),
    ],
  },
  {
    name: "location マッチング優先順位",
    description: "= (完全一致) > ^~ (優先プレフィックス) > ~ (正規表現) > / (通常プレフィックス) の順位を確認。",
    confText: `server {
    listen 80;
    server_name match.example.com;

    location = /exact {
        return 200 "exact match";
    }
    location ^~ /static/ {
        return 200 "prefix priority (^~)";
    }
    location ~ \\.php$ {
        return 200 "regex match (.php)";
    }
    location / {
        return 200 "prefix fallback (/)";
    }
    location /static/special {
        return 200 "long prefix (never wins over ^~)";
    }
}`,
    config: {
      upstreams: [], staticFiles: {},
      servers: [{
        listen: 80, serverName: ["match.example.com"],
        locations: [
          { match: { type: "exact", path: "/exact" }, directives: { returnCode: 200, returnBody: "exact match (=)" } },
          { match: { type: "prefix_priority", path: "/static/" }, directives: { returnCode: 200, returnBody: "prefix priority (^~)" } },
          { match: { type: "regex", pattern: "\\.php$" }, directives: { returnCode: 200, returnBody: "regex match (.php)" } },
          { match: { type: "prefix", path: "/" }, directives: { returnCode: 200, returnBody: "prefix fallback (/)" } },
          { match: { type: "prefix", path: "/static/special" }, directives: { returnCode: 200, returnBody: "longer prefix" } },
        ],
      }],
    },
    requests: [
      req("GET", "match.example.com", "/exact"),
      req("GET", "match.example.com", "/static/image.png"),
      req("GET", "match.example.com", "/static/special/page"),
      req("GET", "match.example.com", "/app/index.php"),
      req("GET", "match.example.com", "/anything/else"),
      req("GET", "match.example.com", "/static/test.php"),
    ],
  },
  {
    name: "HTTPS リダイレクト + バーチャルホスト",
    description: "HTTP→HTTPS リダイレクトと、ホスト名ごとに異なるサーバーブロックを使い分ける。",
    confText: `server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443;
    server_name app.example.com;
    location / { proxy_pass http://app_backend; }
}

server {
    listen 443;
    server_name admin.example.com;
    location / { proxy_pass http://admin_backend; }
}`,
    config: {
      upstreams: [
        { name: "app_backend", method: "round-robin", servers: [{ address: "10.0.2.1:3000", weight: 1, healthy: true }] },
        { name: "admin_backend", method: "round-robin", servers: [{ address: "10.0.2.2:4000", weight: 1, healthy: true }] },
      ],
      servers: [
        { listen: 80, serverName: ["_"], locations: [
          { match: { type: "prefix", path: "/" }, directives: { returnCode: 301, returnBody: "https://example.com/" } },
        ]},
        { listen: 443, serverName: ["app.example.com"], locations: [
          { match: { type: "prefix", path: "/" }, directives: { proxyPass: "http://app_backend" } },
        ]},
        { listen: 443, serverName: ["admin.example.com"], locations: [
          { match: { type: "prefix", path: "/" }, directives: { proxyPass: "http://admin_backend" } },
        ]},
      ],
      staticFiles: {},
    },
    requests: [
      req("GET", "anything.com", "/page"),
      req("GET", "app.example.com", "/dashboard"),
      req("GET", "admin.example.com", "/users"),
      req("GET", "unknown.example.com", "/test"),
    ],
  },
  {
    name: "障害時フェイルオーバー",
    description: "upstream の 1 台がダウン。健全なサーバーのみにトラフィックが振られる。全ダウンで 502。",
    confText: `upstream backend {
    server 10.0.1.1:8080;  # healthy
    server 10.0.1.2:8080;  # DOWN
    server 10.0.1.3:8080;  # healthy
}`,
    config: {
      upstreams: [{
        name: "backend", method: "round-robin",
        servers: [
          { address: "10.0.1.1:8080", weight: 1, healthy: true },
          { address: "10.0.1.2:8080", weight: 1, healthy: false },
          { address: "10.0.1.3:8080", weight: 1, healthy: true },
        ],
      }],
      servers: [{
        listen: 80, serverName: ["fail.example.com"],
        locations: [{ match: { type: "prefix", path: "/" }, directives: { proxyPass: "http://backend" } }],
      }],
      staticFiles: {},
    },
    requests: [
      req("GET", "fail.example.com", "/req1"),
      req("GET", "fail.example.com", "/req2"),
      req("GET", "fail.example.com", "/req3"),
      req("GET", "fail.example.com", "/req4"),
    ],
  },
  {
    name: "全ダウンで 502 Bad Gateway",
    description: "全バックエンドが停止。Nginx が 502 Bad Gateway を返す。",
    confText: `upstream dead_backend {
    server 10.0.1.1:8080;  # DOWN
    server 10.0.1.2:8080;  # DOWN
}`,
    config: {
      upstreams: [{
        name: "dead_backend", method: "round-robin",
        servers: [
          { address: "10.0.1.1:8080", weight: 1, healthy: false },
          { address: "10.0.1.2:8080", weight: 1, healthy: false },
        ],
      }],
      servers: [{
        listen: 80, serverName: ["dead.example.com"],
        locations: [{ match: { type: "prefix", path: "/" }, directives: { proxyPass: "http://dead_backend" } }],
      }],
      staticFiles: {},
    },
    requests: [
      req("GET", "dead.example.com", "/anything"),
    ],
  },
];

function phaseColor(phase: NginxTrace["phase"]): string {
  switch (phase) {
    case "accept":         return "#60a5fa";
    case "server_match":   return "#a78bfa";
    case "location_match": return "#f59e0b";
    case "rewrite":        return "#f97316";
    case "proxy":          return "#3b82f6";
    case "upstream":       return "#22c55e";
    case "static":         return "#06b6d4";
    case "return":         return "#ec4899";
    case "response":       return "#10b981";
    case "header":         return "#64748b";
    case "error":          return "#ef4444";
  }
}

export class NginxApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Nginx Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#009639;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Send All";
    runBtn.style.cssText = "padding:4px 16px;background:#009639;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: nginx.conf
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:320px;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const confLabel = document.createElement("div");
    confLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#009639;border-bottom:1px solid #1e293b;";
    confLabel.textContent = "nginx.conf";
    leftPanel.appendChild(confLabel);
    const confArea = document.createElement("pre");
    confArea.style.cssText = "flex:1;padding:8px 12px;font-size:10px;color:#94a3b8;overflow-y:auto;margin:0;white-space:pre-wrap;line-height:1.5;";
    leftPanel.appendChild(confArea);
    main.appendChild(leftPanel);

    // 中央: リクエスト結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "Request Results";
    centerPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resDiv);
    main.appendChild(centerPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:400px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Processing Trace (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderResults = (results: NginxResult[]) => {
      resDiv.innerHTML = "";
      for (const r of results) {
        const el = document.createElement("div");
        const ok = r.response.status < 400;
        const border = ok ? "#22c55e" : r.response.status < 500 ? "#f59e0b" : "#ef4444";
        const statusColor = r.response.status >= 300 && r.response.status < 400 ? "#3b82f6" : border;
        el.style.cssText = `padding:6px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;

        const upTag = r.upstreamServer ? ` <span style="color:#22c55e;font-size:8px;">\u2192 ${r.upstreamServer}</span>` : "";
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.request.method} ${r.request.path}</span>` +
          `<span style="color:${statusColor};font-weight:600;">${r.response.status} ${r.response.statusText}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;">Host: ${r.request.host} | server: ${r.matchedServer ?? "-"} | location: ${r.matchedLocation ?? "-"}${upTag}</div>`;

        if (r.response.status >= 300 && r.response.status < 400) {
          el.innerHTML += `<div style="color:#3b82f6;font-size:9px;">\u2192 ${r.response.headers["location"] ?? ""}</div>`;
        }

        el.addEventListener("click", () => renderTrace(r));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (r: NginxResult) => {
      trDiv.innerHTML = "";

      // レスポンスヘッダ表示
      const hdrSection = document.createElement("div");
      hdrSection.style.cssText = "margin-bottom:8px;padding:4px 6px;background:#1e293b;border-radius:4px;";
      hdrSection.innerHTML = `<div style="color:#64748b;font-weight:600;margin-bottom:2px;">Response Headers</div>`;
      for (const [k, v] of Object.entries(r.response.headers)) {
        hdrSection.innerHTML += `<div style="color:#94a3b8;"><span style="color:#06b6d4;">${k}:</span> ${v}</div>`;
      }
      trDiv.appendChild(hdrSection);

      // トレースステップ
      for (const step of r.trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="min-width:80px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }

      // Body プレビュー
      if (r.response.body) {
        const bodySection = document.createElement("div");
        bodySection.style.cssText = "margin-top:8px;padding:4px 6px;background:#1e293b;border-radius:4px;";
        bodySection.innerHTML = `<div style="color:#64748b;font-weight:600;margin-bottom:2px;">Body (${r.response.body.length} bytes)</div>`;
        const pre = document.createElement("pre");
        pre.style.cssText = "color:#94a3b8;font-size:9px;white-space:pre-wrap;margin:0;max-height:100px;overflow:auto;";
        pre.textContent = r.response.body.slice(0, 500);
        bodySection.appendChild(pre);
        trDiv.appendChild(bodySection);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      confArea.textContent = ex.confText;
      resDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const engine = new NginxEngine(ex.config);
      const results = ex.requests.map((r) => engine.handleRequest(r));
      renderResults(results);
      if (results[0]) renderTrace(results[0]);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runAll(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
