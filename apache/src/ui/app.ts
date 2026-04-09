import { ApacheEngine } from "../engine/httpd.js";
import type { HttpdConfig, HttpRequest, ApacheResult, ApacheTrace } from "../engine/httpd.js";

export interface Example {
  name: string;
  description: string;
  config: HttpdConfig;
  confText: string;
  requests: HttpRequest[];
}

const req = (method: string, host: string, uri: string, qs?: string): HttpRequest =>
  ({ method, host, uri, headers: { "user-agent": "Mozilla/5.0" }, queryString: qs });

export const EXAMPLES: Example[] = [
  {
    name: "静的ファイル + DirectoryIndex",
    description: "DocumentRoot から静的ファイルを配信。/ へのアクセスで DirectoryIndex が適用される。",
    confText: `<VirtualHost *:80>
    ServerName www.example.com
    DocumentRoot /var/www/html
    <Directory /var/www/html>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
        DirectoryIndex index.html
    </Directory>
</VirtualHost>`,
    config: {
      serverRoot: "/etc/httpd", loadedModules: ["core", "mod_dir", "mod_autoindex", "mod_mime"],
      virtualHosts: [{
        serverName: "www.example.com", port: 80, documentRoot: "/var/www/html",
        ssl: false, rewriteRules: [], proxies: [],
        directories: [{
          path: "/", allowOverride: "All", options: ["Indexes", "FollowSymLinks"],
          require: "all granted", directoryIndex: "index.html",
        }],
      }],
      fileSystem: {
        "/var/www/html/index.html": "<!DOCTYPE html><html><body><h1>Welcome to Apache!</h1></body></html>",
        "/var/www/html/about.html": "<html><body><h1>About Us</h1></body></html>",
        "/var/www/html/css/style.css": "body { font-family: sans-serif; }",
        "/var/www/html/images/logo.png": "[PNG data]",
      },
    },
    requests: [
      req("GET", "www.example.com", "/"),
      req("GET", "www.example.com", "/about.html"),
      req("GET", "www.example.com", "/css/style.css"),
      req("GET", "www.example.com", "/missing.html"),
      req("GET", "www.example.com", "/images/"),
    ],
  },
  {
    name: "mod_rewrite (URL 書き換え)",
    description: "RewriteRule でクリーン URL 化。/user/123 → /index.php?id=123 に内部書き換え。HTTP→HTTPS リダイレクトも。",
    confText: `<VirtualHost *:80>
    ServerName app.example.com
    DocumentRoot /var/www/app

    RewriteEngine On
    RewriteRule ^/user/([0-9]+)$ /index.php?id=$1 [L]
    RewriteRule ^/old-page$ /new-page [R=301,L]
    RewriteRule ^/(.*)$ https://app.example.com/$1 [R=301,L]
</VirtualHost>`,
    config: {
      serverRoot: "/etc/httpd", loadedModules: ["core", "mod_rewrite", "mod_cgi"],
      virtualHosts: [{
        serverName: "app.example.com", port: 80, documentRoot: "/var/www/app",
        ssl: false, proxies: [],
        directories: [{ path: "/", allowOverride: "All", options: [], require: "all granted" }],
        rewriteRules: [
          { pattern: "^/user/([0-9]+)$", substitution: "/index.php?id=$1", flags: ["L"] },
          { pattern: "^/old-page$", substitution: "/new-page", flags: ["R=301", "L"] },
        ],
      }],
      fileSystem: {
        "/var/www/app/index.php": "<?php echo 'User: '.$_GET['id']; ?>",
        "/var/www/app/new-page": "<html><body>New Page</body></html>",
      },
    },
    requests: [
      req("GET", "app.example.com", "/user/123"),
      req("GET", "app.example.com", "/user/456"),
      req("GET", "app.example.com", "/old-page"),
      req("GET", "app.example.com", "/new-page"),
    ],
  },
  {
    name: ".htaccess アクセス制御",
    description: "AllowOverride All で .htaccess が有効。/admin/ は Require all denied で 403。/public/ は許可。",
    confText: `<VirtualHost *:80>
    ServerName secure.example.com
    DocumentRoot /var/www/secure
    <Directory /var/www/secure>
        AllowOverride All
        Require all granted
    </Directory>
    <Directory /var/www/secure/admin>
        Require all denied
    </Directory>
    <Directory /var/www/secure/private>
        Require all denied
        ErrorDocument 403 /error/403.html
    </Directory>
</VirtualHost>`,
    config: {
      serverRoot: "/etc/httpd", loadedModules: ["core", "mod_authz_core"],
      virtualHosts: [{
        serverName: "secure.example.com", port: 80, documentRoot: "/var/www/secure",
        ssl: false, rewriteRules: [], proxies: [],
        directories: [
          { path: "/", allowOverride: "All", options: [], require: "all granted" },
          { path: "/admin/", allowOverride: "All", options: [], require: "all denied" },
          { path: "/private/", allowOverride: "All", options: [], require: "all denied", errorDocuments: { 403: "/error/403.html" } },
        ],
      }],
      fileSystem: {
        "/var/www/secure/index.html": "<html><body>Public Home</body></html>",
        "/var/www/secure/admin/index.html": "<html><body>Admin Panel</body></html>",
        "/var/www/secure/private/secret.txt": "top secret data",
        "/var/www/secure/error/403.html": "<html><body><h1>Access Denied</h1></body></html>",
      },
    },
    requests: [
      req("GET", "secure.example.com", "/index.html"),
      req("GET", "secure.example.com", "/admin/index.html"),
      req("GET", "secure.example.com", "/private/secret.txt"),
      req("GET", "secure.example.com", "/unknown.html"),
    ],
  },
  {
    name: "mod_proxy リバースプロキシ",
    description: "ProxyPass で /api/ をバックエンドに転送。mod_proxy_balancer で 2 台に分散。",
    confText: `<VirtualHost *:80>
    ServerName api.example.com
    DocumentRoot /var/www/api

    ProxyPass /api/ balancer://backend/
    <Proxy balancer://backend>
        BalancerMember http://10.0.1.1:3000 route=node1
        BalancerMember http://10.0.1.2:3000 route=node2
    </Proxy>

    ProxyPass /legacy/ http://10.0.2.1:8080/
</VirtualHost>`,
    config: {
      serverRoot: "/etc/httpd", loadedModules: ["core", "mod_proxy", "mod_proxy_http", "mod_proxy_balancer"],
      virtualHosts: [{
        serverName: "api.example.com", port: 80, documentRoot: "/var/www/api",
        ssl: false, rewriteRules: [],
        directories: [{ path: "/", allowOverride: "None", options: [], require: "all granted" }],
        proxies: [
          { path: "/api/", backend: "balancer://backend", balancerMembers: [
            { url: "http://10.0.1.1:3000", route: "node1" },
            { url: "http://10.0.1.2:3000", route: "node2" },
          ]},
          { path: "/legacy/", backend: "http://10.0.2.1:8080" },
        ],
      }],
      fileSystem: { "/var/www/api/index.html": "<html><body>API Gateway</body></html>" },
    },
    requests: [
      req("GET", "api.example.com", "/api/users"),
      req("POST", "api.example.com", "/api/orders"),
      req("GET", "api.example.com", "/api/products"),
      req("GET", "api.example.com", "/legacy/old-endpoint"),
      req("GET", "api.example.com", "/index.html"),
    ],
  },
  {
    name: "VirtualHost (名前ベース複数サイト)",
    description: "1 つの IP で複数ドメインをホスト。Host ヘッダで振り分ける。",
    confText: `<VirtualHost *:80>
    ServerName site-a.com
    DocumentRoot /var/www/site-a
</VirtualHost>

<VirtualHost *:80>
    ServerName site-b.com
    ServerAlias www.site-b.com
    DocumentRoot /var/www/site-b
</VirtualHost>`,
    config: {
      serverRoot: "/etc/httpd", loadedModules: ["core"],
      virtualHosts: [
        { serverName: "site-a.com", port: 80, documentRoot: "/var/www/site-a", ssl: false, rewriteRules: [], proxies: [],
          directories: [{ path: "/", allowOverride: "None", options: [], require: "all granted" }] },
        { serverName: "site-b.com", serverAlias: ["www.site-b.com"], port: 80, documentRoot: "/var/www/site-b", ssl: false, rewriteRules: [], proxies: [],
          directories: [{ path: "/", allowOverride: "None", options: [], require: "all granted" }] },
      ],
      fileSystem: {
        "/var/www/site-a/index.html": "<html><body><h1>Site A</h1></body></html>",
        "/var/www/site-b/index.html": "<html><body><h1>Site B</h1></body></html>",
      },
    },
    requests: [
      req("GET", "site-a.com", "/index.html"),
      req("GET", "site-b.com", "/index.html"),
      req("GET", "www.site-b.com", "/index.html"),
      req("GET", "unknown.com", "/index.html"),
    ],
  },
  {
    name: "CGI + カスタムヘッダ",
    description: ".cgi / .php ファイルを CGI ハンドラで実行。Header ディレクティブでセキュリティヘッダを付与。",
    confText: `<VirtualHost *:80>
    ServerName dynamic.example.com
    DocumentRoot /var/www/cgi
    <Directory /var/www/cgi>
        Options +ExecCGI
        AddHandler cgi-script .cgi .php
        Header set X-Frame-Options DENY
        Header set X-Content-Type-Options nosniff
    </Directory>
</VirtualHost>`,
    config: {
      serverRoot: "/etc/httpd", loadedModules: ["core", "mod_cgi", "mod_headers"],
      virtualHosts: [{
        serverName: "dynamic.example.com", port: 80, documentRoot: "/var/www/cgi",
        ssl: false, rewriteRules: [], proxies: [],
        directories: [{
          path: "/", allowOverride: "All", options: ["ExecCGI"],
          require: "all granted",
          handlers: { ".cgi": "cgi-script", ".php": "cgi-script" },
          headerDirectives: { "x-frame-options": "DENY", "x-content-type-options": "nosniff" },
        }],
      }],
      fileSystem: {
        "/var/www/cgi/hello.cgi": "Content-Type: text/html\n\n<h1>Hello from CGI!</h1>",
        "/var/www/cgi/info.php": "<?php phpinfo(); ?>",
        "/var/www/cgi/index.html": "<html><body>Static page</body></html>",
      },
    },
    requests: [
      req("GET", "dynamic.example.com", "/hello.cgi"),
      req("GET", "dynamic.example.com", "/info.php", "section=all"),
      req("GET", "dynamic.example.com", "/index.html"),
      req("GET", "dynamic.example.com", "/missing.cgi"),
    ],
  },
];

function phaseColor(phase: ApacheTrace["phase"]): string {
  switch (phase) {
    case "post_read_request": return "#60a5fa";
    case "uri_translation":   return "#a78bfa";
    case "header_parsing":    return "#94a3b8";
    case "access_control":    return "#f59e0b";
    case "authentication":    return "#f97316";
    case "authorization":     return "#ec4899";
    case "mime_type":         return "#06b6d4";
    case "fixups":            return "#8b5cf6";
    case "handler":           return "#22c55e";
    case "logging":           return "#64748b";
    case "error":             return "#ef4444";
  }
}

export class ApacheApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Apache HTTP Server Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#c92242;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Send All";
    runBtn.style.cssText = "padding:4px 16px;background:#c92242;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: httpd.conf
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:320px;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const confLabel = document.createElement("div");
    confLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#c92242;border-bottom:1px solid #1e293b;";
    confLabel.textContent = "httpd.conf";
    leftPanel.appendChild(confLabel);
    const confArea = document.createElement("pre");
    confArea.style.cssText = "flex:1;padding:8px 12px;font-size:10px;color:#94a3b8;overflow-y:auto;margin:0;white-space:pre-wrap;line-height:1.5;";
    leftPanel.appendChild(confArea);
    main.appendChild(leftPanel);

    // 中央: 結果
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
    rightPanel.style.cssText = "width:420px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Processing Phases (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    const renderResults = (results: ApacheResult[]) => {
      resDiv.innerHTML = "";
      for (const r of results) {
        const el = document.createElement("div");
        const ok = r.response.status < 400;
        const border = ok ? "#22c55e" : r.response.status < 500 ? "#f59e0b" : "#ef4444";
        const statusColor = r.response.status >= 300 && r.response.status < 400 ? "#3b82f6" : border;
        el.style.cssText = `padding:6px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;
        const handler = r.handlerUsed !== "core" ? ` <span style="color:#a78bfa;font-size:8px;">[${r.handlerUsed}]</span>` : "";
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.request.method} ${r.request.uri}</span>` +
          `<span style="color:${statusColor};font-weight:600;">${r.response.status} ${r.response.statusText}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;">Host: ${r.request.host} | vhost: ${r.matchedVHost ?? "-"} | URI: ${r.finalUri}${handler}</div>`;
        if (r.response.headers["location"]) {
          el.innerHTML += `<div style="color:#3b82f6;font-size:9px;">\u2192 ${r.response.headers["location"]}</div>`;
        }
        el.addEventListener("click", () => renderTrace(r));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (r: ApacheResult) => {
      trDiv.innerHTML = "";
      // ヘッダ
      const hdr = document.createElement("div");
      hdr.style.cssText = "margin-bottom:6px;padding:4px 6px;background:#1e293b;border-radius:4px;";
      hdr.innerHTML = `<div style="color:#64748b;font-weight:600;margin-bottom:2px;">Response Headers</div>`;
      for (const [k, v] of Object.entries(r.response.headers)) {
        hdr.innerHTML += `<div style="color:#94a3b8;"><span style="color:#06b6d4;">${k}:</span> ${v}</div>`;
      }
      trDiv.appendChild(hdr);

      for (const step of r.trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="min-width:95px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#64748b;min-width:75px;font-size:9px;">${step.module}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }

      if (r.response.body && r.response.status < 400) {
        const body = document.createElement("div");
        body.style.cssText = "margin-top:6px;padding:4px 6px;background:#1e293b;border-radius:4px;";
        body.innerHTML = `<div style="color:#64748b;font-weight:600;margin-bottom:2px;">Body (${r.response.body.length} bytes)</div>`;
        const pre = document.createElement("pre");
        pre.style.cssText = "color:#94a3b8;font-size:9px;margin:0;max-height:80px;overflow:auto;white-space:pre-wrap;";
        pre.textContent = r.response.body.slice(0, 500);
        body.appendChild(pre);
        trDiv.appendChild(body);
      }
    };

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      confArea.textContent = ex.confText;
      resDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const engine = new ApacheEngine(ex.config);
      const results = ex.requests.map((r) => engine.handleRequest(r));
      renderResults(results);
      if (results[0]) renderTrace(results[0]);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runAll(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
