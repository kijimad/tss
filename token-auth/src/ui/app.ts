import { createJwt, verifyJwt, decodeJwt, simulateOAuth2, simulateRefresh, hmacSha256 } from "../engine/auth.js";
import type { JwtPayload, JwtToken, VerifyResult, OAuth2Trace } from "../engine/auth.js";
import { NETWORK_PRESETS } from "../engine/network.js";
import type { NetworkSimResult, NetworkStep, SecurityLevel, HttpHeader, NetworkNode } from "../engine/network.js";

export interface Example {
  name: string;
  description: string;
  run: () => ExampleResult;
}

interface ExampleResult {
  jwt?: JwtToken;
  verification?: VerifyResult;
  oauthTrace?: OAuth2Trace[];
  decoded?: JwtToken | null;
  extra?: { label: string; value: string }[];
}

const SECRET = "super-secret-key-256bit";
const now = Math.floor(Date.now() / 1000);

export const EXAMPLES: Example[] = [
  {
    name: "JWT 生成と検証 (正常)",
    description: "HS256 で署名した JWT を生成し、同じ秘密鍵で検証。全チェック (構造・alg・署名・exp・iss・aud) がパス。",
    run: () => {
      const payload: JwtPayload = { sub: "user-123", iss: "https://auth.example.com", aud: "my-app", exp: now + 3600, iat: now, roles: ["admin", "user"] };
      const jwt = createJwt(payload, SECRET);
      const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "my-app" });
      return { jwt, verification };
    },
  },
  {
    name: "JWT 期限切れ (exp チェック失敗)",
    description: "exp が過去のトークン。署名は正しいが有効期限切れで拒否される。",
    run: () => {
      const payload: JwtPayload = { sub: "user-456", iss: "https://auth.example.com", aud: "my-app", exp: now - 3600, iat: now - 7200 };
      const jwt = createJwt(payload, SECRET);
      const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "my-app" });
      return { jwt, verification };
    },
  },
  {
    name: "JWT 署名不一致 (改ざん検出)",
    description: "正しい秘密鍵で生成したトークンを、異なる鍵で検証。署名不一致 → 改ざんの可能性を検出。",
    run: () => {
      const jwt = createJwt({ sub: "user-789", exp: now + 3600, iat: now }, SECRET);
      const verification = verifyJwt(jwt.raw, "wrong-secret-key");
      return { jwt, verification, extra: [{ label: "生成時の秘密鍵", value: SECRET }, { label: "検証時の秘密鍵", value: "wrong-secret-key (不一致!)" }] };
    },
  },
  {
    name: "JWT ペイロード改ざん",
    description: "トークンのペイロード部分を改ざん (role を admin に変更)。署名が合わなくなり検出される。",
    run: () => {
      const jwt = createJwt({ sub: "user-normal", exp: now + 3600, iat: now, roles: ["user"] }, SECRET);
      // ペイロードを改ざん
      const parts = jwt.raw.split(".");
      const tamperedPayload = btoa(JSON.stringify({ sub: "user-normal", exp: now + 3600, iat: now, roles: ["admin"] })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const tamperedToken = parts[0] + "." + tamperedPayload + "." + parts[2];
      const verification = verifyJwt(tamperedToken, SECRET);
      const decoded = decodeJwt(tamperedToken);
      return { jwt, verification, decoded, extra: [{ label: "元の role", value: '["user"]' }, { label: "改ざん後", value: '["admin"] → 署名不一致!' }] };
    },
  },
  {
    name: "JWT issuer / audience 不一致",
    description: "iss, aud が期待と異なるトークン。別のサービス向けのトークンが拒否される。",
    run: () => {
      const jwt = createJwt({ sub: "user", iss: "https://other-auth.com", aud: "other-app", exp: now + 3600, iat: now }, SECRET);
      const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "my-app" });
      return { jwt, verification };
    },
  },
  {
    name: "OAuth2 Authorization Code フロー",
    description: "完全な OAuth2 フロー: 認可リクエスト → ログイン → 認可コード → トークン交換 → API アクセス。",
    run: () => {
      const result = simulateOAuth2(
        { authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token", clientId: "app-client-id", clientSecret: "app-client-secret", redirectUri: "https://myapp.com/callback", scopes: ["openid", "profile", "email"] },
        { username: "alice@example.com", password: "password123" },
        SECRET,
      );
      return { jwt: result.accessToken, oauthTrace: result.trace, extra: [{ label: "Refresh Token", value: result.refreshToken }, { label: "Expires In", value: `${result.expiresIn}s` }] };
    },
  },
  {
    name: "リフレッシュトークンフロー",
    description: "アクセストークン期限切れ → リフレッシュトークンで新しいアクセストークンを取得。",
    run: () => {
      const initial = simulateOAuth2(
        { authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token", clientId: "app-id", clientSecret: "secret", redirectUri: "https://app.com/cb", scopes: ["profile"] },
        { username: "bob", password: "pass" },
        SECRET,
      );
      const refresh = simulateRefresh(initial.refreshToken, { authorizationEndpoint: "", tokenEndpoint: "https://auth.example.com/token", clientId: "app-id", clientSecret: "secret", redirectUri: "", scopes: [] }, SECRET);
      return { jwt: refresh.newAccessToken, oauthTrace: [...initial.trace, ...refresh.trace], extra: [{ label: "元のアクセストークン (jti)", value: initial.accessToken.payload.jti ?? "" }, { label: "新しいアクセストークン (jti)", value: refresh.newAccessToken.payload.jti ?? "" }] };
    },
  },
  {
    name: "JWT 構造の分解表示",
    description: "JWT の 3 部分 (Header.Payload.Signature) をデコードして各フィールドを確認。Base64URL エンコードの仕組み。",
    run: () => {
      const payload: JwtPayload = { sub: "1234567890", iss: "https://example.com", aud: "https://api.example.com", exp: now + 86400, iat: now, nbf: now, jti: "unique-token-id", roles: ["editor"], name: "Alice Smith" };
      const jwt = createJwt(payload, SECRET);
      const verification = verifyJwt(jwt.raw, SECRET);
      return { jwt, verification, extra: [{ label: "HMAC 入力", value: jwt.headerEncoded + "." + jwt.payloadEncoded }, { label: "HMAC 出力", value: hmacSha256(jwt.headerEncoded + "." + jwt.payloadEncoded, SECRET) }] };
    },
  },
];

// ── 色ユーティリティ ──

function checkColor(passed: boolean): string { return passed ? "#22c55e" : "#ef4444"; }

function oauthColor(phase: OAuth2Trace["phase"]): string {
  switch (phase) {
    case "redirect":       return "#3b82f6";
    case "auth_code":      return "#a78bfa";
    case "token_request":  return "#f59e0b";
    case "token_response": return "#22c55e";
    case "refresh":        return "#06b6d4";
    case "access":         return "#10b981";
    case "validate":       return "#8b5cf6";
    case "error":          return "#ef4444";
  }
}

function securityColor(level: SecurityLevel): string {
  switch (level) {
    case "safe": return "#22c55e";
    case "warning": return "#f59e0b";
    case "danger": return "#ef4444";
  }
}

function stepTypeColor(type: NetworkStep["type"]): string {
  switch (type) {
    case "dns_resolve": return "#94a3b8";
    case "tcp_connect": return "#64748b";
    case "tls_handshake": return "#8b5cf6";
    case "http_request": return "#3b82f6";
    case "http_response": return "#22c55e";
    case "token_generate": return "#f59e0b";
    case "token_validate": return "#06b6d4";
    case "token_attach": return "#a78bfa";
    case "token_intercept": return "#ef4444";
    case "token_replay": return "#dc2626";
    case "redirect": return "#f97316";
    case "token_refresh": return "#14b8a6";
    case "token_revoke": return "#f59e0b";
    case "error": return "#ef4444";
    case "info": return "#64748b";
  }
}

function nodeRoleColor(role: NetworkNode["role"]): string {
  switch (role) {
    case "client": return "#3b82f6";
    case "server": return "#22c55e";
    case "auth_server": return "#f59e0b";
    case "attacker": return "#ef4444";
    case "proxy": return "#8b5cf6";
    case "dns": return "#64748b";
  }
}

// ── メインアプリ ──

export class TokenAuthApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // タブバー
    const tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;border-bottom:1px solid #1e293b;";
    const tabs = ["JWT / OAuth2", "Bearer Network"];
    const tabEls: HTMLElement[] = [];
    const panels: HTMLElement[] = [];

    for (let i = 0; i < tabs.length; i++) {
      const tab = document.createElement("button");
      tab.textContent = tabs[i]!;
      tab.style.cssText = "padding:8px 20px;background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;";
      tab.addEventListener("click", () => {
        tabEls.forEach(t => { t.style.borderBottomColor = "transparent"; t.style.color = "#64748b"; });
        panels.forEach(p => { p.style.display = "none"; });
        tab.style.borderBottomColor = "#f59e0b";
        tab.style.color = "#f59e0b";
        panels[i]!.style.display = "flex";
      });
      tabEls.push(tab);
      tabBar.appendChild(tab);
    }
    container.appendChild(tabBar);

    // Panel 1: JWT / OAuth2 (既存)
    const jwtPanel = document.createElement("div");
    jwtPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    this.initJwtPanel(jwtPanel);
    panels.push(jwtPanel);
    container.appendChild(jwtPanel);

    // Panel 2: Bearer Network
    const netPanel = document.createElement("div");
    netPanel.style.cssText = "flex:1;display:none;flex-direction:column;overflow:hidden;";
    this.initNetworkPanel(netPanel);
    panels.push(netPanel);
    container.appendChild(netPanel);

    // 初期タブ選択
    tabEls[0]!.style.borderBottomColor = "#f59e0b";
    tabEls[0]!.style.color = "#f59e0b";
  }

  // ── JWT / OAuth2 パネル (既存機能) ──
  private initJwtPanel(container: HTMLElement): void {
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Token Auth Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Execute";
    runBtn.style.cssText = "padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: JWT 構造
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:400px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const jwtLabel = document.createElement("div");
    jwtLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    jwtLabel.textContent = "JWT Token Structure";
    leftPanel.appendChild(jwtLabel);
    const jwtDiv = document.createElement("div");
    jwtDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(jwtDiv);
    main.appendChild(leftPanel);

    // 右: 検証結果 + OAuth2 フロー
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const verLabel = document.createElement("div");
    verLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    verLabel.textContent = "Verification & Flow";
    rightPanel.appendChild(verLabel);
    const verDiv = document.createElement("div");
    verDiv.style.cssText = "flex:1;padding:8px 12px;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(verDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──
    const renderJwt = (jwt: JwtToken, extra?: { label: string; value: string }[]) => {
      jwtDiv.innerHTML = "";
      const rawDiv = document.createElement("div");
      rawDiv.style.cssText = "margin-bottom:8px;padding:6px;background:#1e293b;border-radius:4px;word-break:break-all;font-size:9px;line-height:1.5;";
      rawDiv.innerHTML =
        `<span style="color:#ef4444;">${jwt.headerEncoded}</span>` +
        `<span style="color:#64748b;">.</span>` +
        `<span style="color:#a78bfa;">${jwt.payloadEncoded}</span>` +
        `<span style="color:#64748b;">.</span>` +
        `<span style="color:#06b6d4;">${jwt.signature}</span>`;
      jwtDiv.appendChild(rawDiv);

      const hdr = document.createElement("div");
      hdr.style.cssText = "margin-bottom:6px;";
      hdr.innerHTML = `<div style="color:#ef4444;font-weight:600;margin-bottom:2px;">Header (JOSE)</div>`;
      hdr.innerHTML += `<pre style="color:#94a3b8;margin:0;padding:4px;background:#1e293b;border-radius:4px;font-size:9px;">${JSON.stringify(jwt.header, null, 2)}</pre>`;
      jwtDiv.appendChild(hdr);

      const pay = document.createElement("div");
      pay.style.cssText = "margin-bottom:6px;";
      pay.innerHTML = `<div style="color:#a78bfa;font-weight:600;margin-bottom:2px;">Payload (Claims)</div>`;
      const payObj = { ...jwt.payload };
      if (payObj.exp) (payObj as Record<string, unknown>)["exp_readable"] = new Date(payObj.exp * 1000).toISOString();
      if (payObj.iat) (payObj as Record<string, unknown>)["iat_readable"] = new Date(payObj.iat * 1000).toISOString();
      pay.innerHTML += `<pre style="color:#94a3b8;margin:0;padding:4px;background:#1e293b;border-radius:4px;font-size:9px;">${JSON.stringify(payObj, null, 2)}</pre>`;
      jwtDiv.appendChild(pay);

      const sig = document.createElement("div");
      sig.style.cssText = "margin-bottom:6px;";
      sig.innerHTML = `<div style="color:#06b6d4;font-weight:600;margin-bottom:2px;">Signature</div>`;
      sig.innerHTML += `<div style="color:#94a3b8;padding:4px;background:#1e293b;border-radius:4px;font-size:9px;">HMAC-SHA256(<span style="color:#ef4444;">header</span>.<span style="color:#a78bfa;">payload</span>, secret) = <span style="color:#06b6d4;">${jwt.signature}</span></div>`;
      jwtDiv.appendChild(sig);

      if (extra !== undefined) {
        for (const e of extra) {
          const el = document.createElement("div");
          el.style.cssText = "margin-top:4px;";
          el.innerHTML = `<span style="color:#64748b;font-weight:600;">${e.label}:</span> <span style="color:#94a3b8;word-break:break-all;">${e.value}</span>`;
          jwtDiv.appendChild(el);
        }
      }
    };

    const renderVerification = (v: VerifyResult) => {
      const section = document.createElement("div");
      section.style.cssText = "margin-bottom:12px;";
      const verdict = v.valid ? "\u2714 トークン有効" : "\u2718 トークン無効";
      section.innerHTML = `<div style="color:${v.valid ? "#22c55e" : "#ef4444"};font-weight:700;font-size:14px;margin-bottom:6px;">${verdict}</div>`;
      for (const check of v.checks) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:6px;margin-bottom:4px;padding:3px 6px;border:1px solid #1e293b;border-radius:4px;";
        el.innerHTML =
          `<span style="color:${checkColor(check.passed)};font-weight:600;min-width:14px;">${check.passed ? "\u2714" : "\u2718"}</span>` +
          `<span style="color:#e2e8f0;min-width:100px;font-weight:600;">${check.name}</span>` +
          `<span style="color:#94a3b8;">${check.detail}</span>`;
        section.appendChild(el);
      }
      if (v.errors.length > 0) {
        section.innerHTML += `<div style="color:#ef4444;margin-top:4px;font-weight:600;">エラー: ${v.errors.join(", ")}</div>`;
      }
      return section;
    };

    const renderOAuth2 = (trace: OAuth2Trace[]) => {
      const section = document.createElement("div");
      section.innerHTML = `<div style="color:#3b82f6;font-weight:600;font-size:12px;margin-bottom:6px;">OAuth2 Flow</div>`;
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:4px;padding:4px 6px;border:1px solid #1e293b;border-radius:4px;";
        const color = oauthColor(step.phase);
        el.innerHTML =
          `<div style="display:flex;gap:4px;align-items:center;">` +
          `<span style="color:#475569;">${step.step}.</span>` +
          `<span style="padding:0 4px;border-radius:2px;font-size:8px;font-weight:600;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#f59e0b;">${step.from}</span>` +
          `<span style="color:#64748b;">\u2192</span>` +
          `<span style="color:#22c55e;">${step.to}</span></div>` +
          `<div style="color:#94a3b8;font-size:9px;margin-top:2px;">${step.detail}</div>`;
        if (step.data !== undefined) {
          const dataStr = Object.entries(step.data).map(([k, v]) => `<span style="color:#06b6d4;">${k}</span>=<span style="color:#94a3b8;">${v}</span>`).join(" &amp; ");
          el.innerHTML += `<div style="font-size:8px;margin-top:2px;color:#475569;">${dataStr}</div>`;
        }
        section.appendChild(el);
      }
      return section;
    };

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      jwtDiv.innerHTML = ""; verDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const result = ex.run();
      if (result.jwt) renderJwt(result.jwt, result.extra);
      verDiv.innerHTML = "";
      if (result.verification) verDiv.appendChild(renderVerification(result.verification));
      if (result.oauthTrace) verDiv.appendChild(renderOAuth2(result.oauthTrace));
      if (result.decoded && result.decoded !== result.jwt) {
        const dec = document.createElement("div");
        dec.style.cssText = "margin-top:8px;padding:4px;background:#1e293b;border-radius:4px;";
        dec.innerHTML = `<div style="color:#f59e0b;font-weight:600;margin-bottom:2px;">改ざん後のペイロード:</div><pre style="color:#94a3b8;font-size:9px;margin:0;">${JSON.stringify(result.decoded.payload, null, 2)}</pre>`;
        verDiv.appendChild(dec);
      }
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }

  // ── Bearer Network パネル ──
  private initNetworkPanel(container: HTMLElement): void {
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Bearer Token Network";
    title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;";
    header.appendChild(title);

    const presetSelect = document.createElement("select");
    presetSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;max-width:340px;";
    for (let i = 0; i < NETWORK_PRESETS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = NETWORK_PRESETS[i]!.name;
      presetSelect.appendChild(o);
    }
    header.appendChild(presetSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Execute";
    runBtn.style.cssText = "padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    // ステップ送り
    const stepLabel = document.createElement("span");
    stepLabel.style.cssText = "font-size:12px;color:#64748b;margin-left:8px;";
    stepLabel.textContent = "Step: -";
    header.appendChild(stepLabel);

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "\u25C0";
    prevBtn.style.cssText = "padding:4px 10px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:12px;";
    header.appendChild(prevBtn);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "\u25B6";
    nextBtn.style.cssText = "padding:4px 10px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:12px;";
    header.appendChild(nextBtn);

    const allBtn = document.createElement("button");
    allBtn.textContent = "\u25B6\u25B6 All";
    allBtn.style.cssText = "padding:4px 10px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:12px;";
    header.appendChild(allBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:340px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // メインエリア: 左=ノード+フロー, 右=ステップ詳細
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: ノード図 + ステップリスト
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    // ノード表示エリア
    const nodesDiv = document.createElement("div");
    nodesDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(nodesDiv);

    // ステップリスト
    const stepsDiv = document.createElement("div");
    stepsDiv.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;";
    leftPanel.appendChild(stepsDiv);
    main.appendChild(leftPanel);

    // 右パネル: ステップ詳細
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:440px;display:flex;flex-direction:column;overflow-y:auto;";
    const detailLabel = document.createElement("div");
    detailLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    detailLabel.textContent = "Step Detail";
    rightPanel.appendChild(detailLabel);
    const detailDiv = document.createElement("div");
    detailDiv.style.cssText = "flex:1;padding:8px 12px;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(detailDiv);
    main.appendChild(rightPanel);

    container.appendChild(main);

    // ── 状態管理 ──
    let currentResult: NetworkSimResult | null = null;
    let currentStep = 0;
    let maxVisibleStep = 0;

    const renderNodes = (nodes: NetworkNode[]) => {
      nodesDiv.innerHTML = `<div style="font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:6px;">Network Nodes</div>`;
      const grid = document.createElement("div");
      grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
      for (const node of nodes) {
        const el = document.createElement("div");
        const c = nodeRoleColor(node.role);
        el.style.cssText = `padding:6px 12px;border:1px solid ${c}44;border-radius:6px;background:${c}11;`;
        el.innerHTML = `<div style="font-weight:600;color:${c};font-size:11px;">${node.label}</div><div style="font-size:9px;color:#64748b;">${node.role} (${node.id})</div>`;
        if (node.tokens.length > 0) {
          el.innerHTML += `<div style="font-size:8px;color:#f59e0b;margin-top:2px;">tokens: ${node.tokens.length}</div>`;
        }
        grid.appendChild(el);
      }
      nodesDiv.appendChild(grid);
    };

    const renderSteps = (steps: NetworkStep[], upTo: number) => {
      stepsDiv.innerHTML = "";
      for (let i = 0; i < Math.min(upTo, steps.length); i++) {
        const step = steps[i]!;
        const el = document.createElement("div");
        const isSelected = i === currentStep - 1;
        const secColor = securityColor(step.security);
        const typeColor = stepTypeColor(step.type);
        el.style.cssText = `padding:4px 12px;cursor:pointer;border-left:3px solid ${isSelected ? "#f59e0b" : "transparent"};background:${isSelected ? "#1e293b" : "transparent"};`;
        el.innerHTML =
          `<div style="display:flex;align-items:center;gap:6px;">` +
          `<span style="color:#475569;font-size:10px;min-width:18px;">${step.step}</span>` +
          `<span style="font-size:8px;padding:1px 4px;border-radius:2px;color:${typeColor};background:${typeColor}15;border:1px solid ${typeColor}33;">${step.type}</span>` +
          `<span style="color:${secColor};font-size:10px;">\u25CF</span>` +
          `<span style="color:#e2e8f0;font-size:11px;">${step.label}</span>` +
          `<span style="color:#475569;font-size:9px;margin-left:auto;">${step.elapsedMs}ms</span>` +
          `</div>` +
          `<div style="font-size:9px;color:#64748b;padding-left:24px;margin-top:1px;">${step.from} → ${step.to}</div>`;
        el.addEventListener("click", () => { currentStep = i + 1; render(); });
        stepsDiv.appendChild(el);
      }
      // 自動スクロール
      if (stepsDiv.lastElementChild) {
        stepsDiv.lastElementChild.scrollIntoView({ block: "nearest" });
      }
    };

    const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const renderDetail = (step: NetworkStep) => {
      detailDiv.innerHTML = "";
      const secColor = securityColor(step.security);
      const typeColor = stepTypeColor(step.type);

      // ヘッダー
      detailDiv.innerHTML += `<div style="margin-bottom:8px;"><div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:4px;">${step.label}</div><div style="display:flex;gap:6px;align-items:center;"><span style="padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600;color:${typeColor};background:${typeColor}15;border:1px solid ${typeColor}33;">${step.type}</span><span style="padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600;color:${secColor};background:${secColor}15;border:1px solid ${secColor}33;">${step.security}</span><span style="font-size:9px;color:#64748b;">${step.elapsedMs}ms</span></div></div>`;

      // フロー
      detailDiv.innerHTML += `<div style="padding:6px;background:#1e293b;border-radius:4px;margin-bottom:8px;font-size:11px;"><span style="color:#3b82f6;">${step.from}</span> <span style="color:#64748b;">\u2192</span> <span style="color:#22c55e;">${step.to}</span></div>`;

      // 詳細
      detailDiv.innerHTML += `<div style="color:#94a3b8;font-size:11px;margin-bottom:8px;line-height:1.6;">${escapeHtml(step.detail)}</div>`;

      // TLS情報
      if (step.tls) {
        const t = step.tls;
        let html = `<div style="margin-bottom:8px;padding:6px;background:#0f0a2a;border:1px solid #2a1a4a;border-radius:4px;"><div style="font-weight:600;color:#8b5cf6;margin-bottom:4px;font-size:10px;">TLS Information</div>`;
        html += `<div style="font-size:9px;color:#94a3b8;">Version: <span style="color:#e2e8f0;">${t.version}</span></div>`;
        html += `<div style="font-size:9px;color:#94a3b8;">Cipher: <span style="color:#e2e8f0;">${t.cipherSuite}</span></div>`;
        html += `<div style="font-size:9px;color:#94a3b8;">Certificate: <span style="color:${t.certValid ? "#22c55e" : "#ef4444"};">${t.certValid ? "Valid" : "Invalid"}</span></div>`;
        if (t.certSubject) html += `<div style="font-size:9px;color:#94a3b8;">Subject: <span style="color:#e2e8f0;">${t.certSubject}</span></div>`;
        if (t.certIssuer) html += `<div style="font-size:9px;color:#94a3b8;">Issuer: <span style="color:#e2e8f0;">${t.certIssuer}</span></div>`;
        html += `</div>`;
        detailDiv.innerHTML += html;
      }

      // HTTPリクエスト
      if (step.request) {
        const r = step.request;
        let html = `<div style="margin-bottom:8px;padding:6px;background:#0a1a2a;border:1px solid #1a2a4a;border-radius:4px;"><div style="font-weight:600;color:#3b82f6;margin-bottom:4px;font-size:10px;">HTTP Request</div>`;
        html += `<div style="font-size:10px;color:#e2e8f0;margin-bottom:4px;"><span style="color:#f59e0b;">${r.method}</span> ${escapeHtml(r.url)}</div>`;
        html += renderHeaders(r.headers);
        if (r.body) html += `<div style="margin-top:4px;padding:4px;background:#0f172a;border-radius:3px;font-size:9px;color:#94a3b8;word-break:break-all;">${escapeHtml(r.body)}</div>`;
        html += `</div>`;
        detailDiv.innerHTML += html;
      }

      // HTTPレスポンス
      if (step.response) {
        const r = step.response;
        const statusColor = r.status < 300 ? "#22c55e" : r.status < 400 ? "#f59e0b" : "#ef4444";
        let html = `<div style="margin-bottom:8px;padding:6px;background:#0a2a1a;border:1px solid #1a3a2a;border-radius:4px;"><div style="font-weight:600;color:#22c55e;margin-bottom:4px;font-size:10px;">HTTP Response</div>`;
        html += `<div style="font-size:10px;margin-bottom:4px;"><span style="color:${statusColor};font-weight:600;">${r.status}</span> <span style="color:#94a3b8;">${r.statusText}</span></div>`;
        html += renderHeaders(r.headers);
        if (r.body) html += `<div style="margin-top:4px;padding:4px;background:#0f172a;border-radius:3px;font-size:9px;color:#94a3b8;word-break:break-all;">${escapeHtml(r.body)}</div>`;
        html += `</div>`;
        detailDiv.innerHTML += html;
      }

      // 追加データ
      if (step.data) {
        let html = `<div style="padding:6px;background:#1e293b;border-radius:4px;"><div style="font-weight:600;color:#f59e0b;margin-bottom:4px;font-size:10px;">Data</div>`;
        for (const [k, v] of Object.entries(step.data)) {
          html += `<div style="font-size:9px;margin-bottom:2px;"><span style="color:#06b6d4;">${escapeHtml(k)}</span>: <span style="color:#94a3b8;word-break:break-all;">${escapeHtml(v)}</span></div>`;
        }
        html += `</div>`;
        detailDiv.innerHTML += html;
      }
    };

    const renderHeaders = (headers: HttpHeader[]): string => {
      if (headers.length === 0) return "";
      let html = `<div style="font-size:9px;">`;
      for (const h of headers) {
        const valueColor = h.sensitive ? "#f59e0b" : "#94a3b8";
        html += `<div><span style="color:#06b6d4;">${escapeHtml(h.name)}</span>: <span style="color:${valueColor};word-break:break-all;">${escapeHtml(h.value)}</span></div>`;
      }
      html += `</div>`;
      return html;
    };

    const render = () => {
      if (!currentResult) return;
      stepLabel.textContent = `Step: ${currentStep} / ${currentResult.steps.length}`;
      renderNodes(currentResult.nodes);
      renderSteps(currentResult.steps, maxVisibleStep);
      if (currentStep > 0 && currentStep <= currentResult.steps.length) {
        renderDetail(currentResult.steps[currentStep - 1]!);
      } else {
        detailDiv.innerHTML = `<div style="color:#64748b;font-style:italic;">ステップを選択してください</div>`;
      }
    };

    const runPreset = (idx: number) => {
      const preset = NETWORK_PRESETS[idx];
      if (!preset) return;
      descSpan.textContent = preset.description;
      currentResult = preset.run();
      currentStep = 1;
      maxVisibleStep = 1;
      render();
    };

    // イベント
    presetSelect.addEventListener("change", () => {
      descSpan.textContent = NETWORK_PRESETS[Number(presetSelect.value)]?.description ?? "";
      stepsDiv.innerHTML = "";
      detailDiv.innerHTML = "";
      nodesDiv.innerHTML = "";
      currentResult = null;
      currentStep = 0;
      maxVisibleStep = 0;
      stepLabel.textContent = "Step: -";
    });

    runBtn.addEventListener("click", () => runPreset(Number(presetSelect.value)));

    prevBtn.addEventListener("click", () => {
      if (!currentResult || currentStep <= 1) return;
      currentStep--;
      render();
    });

    nextBtn.addEventListener("click", () => {
      if (!currentResult) return;
      if (maxVisibleStep < currentResult.steps.length) {
        maxVisibleStep++;
        currentStep = maxVisibleStep;
      } else if (currentStep < currentResult.steps.length) {
        currentStep++;
      }
      render();
    });

    allBtn.addEventListener("click", () => {
      if (!currentResult) return;
      maxVisibleStep = currentResult.steps.length;
      currentStep = maxVisibleStep;
      render();
    });

    // 初期表示
    descSpan.textContent = NETWORK_PRESETS[0]?.description ?? "";
  }
}
