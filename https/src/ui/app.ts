/**
 * app.ts — HTTPS シミュレーター UI モジュール
 *
 * ブラウザ上で HTTPS/TLS ハンドシェイクの実験を実行・可視化するための
 * ユーザーインターフェースを提供する。プリセット実験の定義、シーケンス図の
 * 描画、パケットトレースの表示、セッション情報の表示を行う。
 */

import {
  HttpsSimulator, createValidCertChain, createInvalidCertChain,
  CIPHER_SUITES, randomHex, prf,
} from "../engine/https.js";
import type {
  HttpsConfig, SimulationResult, TraceEvent, TlsSession,
} from "../engine/https.js";

// ── プリセット実験 ──

/**
 * 実験プリセットの定義インターフェース
 * セレクトボックスから選択可能な各実験シナリオを表す
 */
export interface Experiment {
  name: string;
  description: string;
  config: HttpsConfig;
}

/** デフォルトの HTTP リクエスト設定 (GET /api/data) */
const defaultRequest = {
  method: "GET",
  path: "/api/data",
  headers: { "Host": "example.com", "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
};

/** デフォルトの HTTP レスポンス設定 (200 OK, JSON) */
const defaultResponse = {
  statusCode: 200,
  statusText: "OK",
  headers: { "Content-Type": "application/json", "Server": "nginx/1.24", "Strict-Transport-Security": "max-age=31536000" },
  body: '{"status":"ok","data":[1,2,3]}',
};

/** デフォルトのネットワーク設定 (RTT 50ms、パケットロスなし、100Mbps) */
const defaultNetwork = { rttMs: 50, packetLossRate: 0, bandwidthMbps: 100 };

/** TLS 1.3 のデフォルト暗号スイート */
const tls13Suites = ["TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256"];

/** TLS 1.2 の暗号スイート (ECDHE 優先) */
const tls12Suites = [
  "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256",
  "TLS_RSA_WITH_AES_128_GCM_SHA256",
];

/**
 * セッション再開実験用の模擬的な以前のセッション情報を生成する
 * @returns TLS セッション情報 (ランダムな鍵材料を含む)
 */
function makePreviousSession(): TlsSession {
  const clientRandom = randomHex(32);
  const serverRandom = randomHex(32);
  const preMaster = randomHex(48);
  const master = prf(preMaster, "master secret", clientRandom + serverRandom, 48);
  const keyBlock = prf(master, "key expansion", serverRandom + clientRandom, 104);
  return {
    sessionId: randomHex(16),
    version: "TLS1.2",
    cipherSuite: CIPHER_SUITES[3]!,
    masterSecret: master,
    clientRandom,
    serverRandom,
    preMasterSecret: preMaster,
    clientWriteKey: keyBlock.slice(0, 32),
    serverWriteKey: keyBlock.slice(32, 64),
    clientWriteIV: keyBlock.slice(64, 88),
    serverWriteIV: keyBlock.slice(88, 112),
    resumable: true,
  };
}

/**
 * 実験プリセット一覧
 * TLS 1.3/1.2 の各種シナリオ、エラーケース、セッション再開、
 * 高レイテンシ環境など様々な状況をシミュレーションできる
 */
export const EXPERIMENTS: Experiment[] = [
  {
    name: "TLS 1.3 フルハンドシェイク",
    description: "TLS 1.3 の完全なハンドシェイク。ECDHE 鍵交換で前方秘匿性を確保し、AES-128-GCM で暗号化通信する。",
    config: {
      tlsVersion: "TLS1.3",
      clientCipherSuites: tls13Suites,
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: defaultNetwork,
      forceCertError: false,
    },
  },
  {
    name: "TLS 1.2 ECDHE-RSA",
    description: "TLS 1.2 で ECDHE_RSA 鍵交換を使用。PFS (前方秘匿性) ありの標準的な接続。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: tls12Suites,
      serverCertChain: createValidCertChain("api.example.com"),
      sessionResumption: false,
      httpRequest: { method: "POST", path: "/api/login", headers: { "Host": "api.example.com", "Content-Type": "application/json" }, body: '{"user":"admin","pass":"secret"}' },
      httpResponse: { statusCode: 200, statusText: "OK", headers: { "Content-Type": "application/json", "Set-Cookie": "session=abc123; Secure; HttpOnly" }, body: '{"token":"eyJhbGciOiJSUzI1NiJ9..."}' },
      network: defaultNetwork,
      forceCertError: false,
    },
  },
  {
    name: "TLS 1.2 RSA 鍵交換 (非推奨)",
    description: "RSA 鍵交換は前方秘匿性がない (秘密鍵が漏洩すると過去の通信も復号される)。比較用。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("legacy.example.com"),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: defaultNetwork,
      forceCertError: false,
    },
  },
  {
    name: "TLS 1.2 DHE 鍵交換",
    description: "Diffie-Hellman Ephemeral 鍵交換。ECDHE より遅いが同様に PFS を提供する。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_DHE_RSA_WITH_AES_128_CBC_SHA256"],
      serverCertChain: createValidCertChain("dh.example.com"),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: { rttMs: 80, packetLossRate: 0, bandwidthMbps: 50 },
      forceCertError: false,
    },
  },
  {
    name: "証明書チェーン検証エラー",
    description: "不正な証明書チェーン (発行者不一致) によりハンドシェイクが失敗する。ブラウザが赤い警告を出す場面。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: tls12Suites,
      serverCertChain: createInvalidCertChain(),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: defaultNetwork,
      forceCertError: false,
    },
  },
  {
    name: "不信頼な証明書 (MITM)",
    description: "中間者攻撃シナリオ。証明書の検証が強制的に失敗し、接続が拒否される。",
    config: {
      tlsVersion: "TLS1.3",
      clientCipherSuites: tls13Suites,
      serverCertChain: createValidCertChain("attacker.example.com"),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: defaultNetwork,
      forceCertError: true,
    },
  },
  {
    name: "セッション再開 (Abbreviated)",
    description: "以前のセッション情報を使って短縮ハンドシェイク。フルハンドシェイクより 1-RTT 少ない。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: tls12Suites,
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: true,
      previousSession: makePreviousSession(),
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: defaultNetwork,
      forceCertError: false,
    },
  },
  {
    name: "暗号スイート不一致",
    description: "クライアントとサーバーで共通の暗号スイートがなく、ハンドシェイクが失敗する。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: defaultNetwork,
      forceCertError: false,
    },
  },
  {
    name: "高レイテンシ環境 (衛星通信)",
    description: "RTT 600ms の衛星回線。ハンドシェイクの RTT 数が所要時間に大きく影響することを観察。",
    config: {
      tlsVersion: "TLS1.2",
      clientCipherSuites: tls12Suites,
      serverCertChain: createValidCertChain("satellite.example.com"),
      sessionResumption: false,
      httpRequest: defaultRequest,
      httpResponse: defaultResponse,
      network: { rttMs: 600, packetLossRate: 0, bandwidthMbps: 10 },
      forceCertError: false,
    },
  },
];

// ── イベントの色 ──

/**
 * プロトコル層に応じた表示色を返す
 * @param layer プロトコル層 (TCP, TLS, HTTP, Network)
 * @returns CSS カラーコード
 */
function layerColor(layer: TraceEvent["layer"]): string {
  switch (layer) {
    case "TCP":     return "#64748b";
    case "TLS":     return "#a78bfa";
    case "HTTP":    return "#3b82f6";
    case "Network": return "#475569";
  }
}

/**
 * 通信方向に応じたアイコン文字を返す
 * @param dir 通信方向 (client→server, server→client, internal)
 * @returns 矢印またはドットのアイコン
 */
function directionIcon(dir: TraceEvent["direction"]): string {
  switch (dir) {
    case "client→server": return "→";
    case "server→client": return "←";
    case "internal":      return "●";
  }
}

/**
 * 通信方向に応じた表示色を返す
 * @param dir 通信方向
 * @returns CSS カラーコード
 */
function directionColor(dir: TraceEvent["direction"]): string {
  switch (dir) {
    case "client→server": return "#22c55e";
    case "server→client": return "#06b6d4";
    case "internal":      return "#f59e0b";
  }
}

/**
 * ハンドシェイクフェーズに応じた表示色を返す
 * Hello 系は青、証明書系は黄、鍵交換系はピンク、完了系は緑、
 * アラート系は赤など、フェーズごとに色分けする
 * @param phase フェーズ名
 * @returns CSS カラーコード
 */
function phaseColor(phase: string): string {
  if (phase.includes("Hello")) return "#3b82f6";
  if (phase.includes("Certificate") || phase.includes("CertVerify")) return "#f59e0b";
  if (phase.includes("Key")) return "#ec4899";
  if (phase.includes("Finished") || phase.includes("Complete")) return "#22c55e";
  if (phase.includes("Alert")) return "#ef4444";
  if (phase.includes("Application") || phase.includes("Decrypt")) return "#06b6d4";
  if (phase.includes("ChangeCipher")) return "#a78bfa";
  if (phase === "SYN" || phase === "SYN-ACK" || phase === "ACK" || phase === "FIN" || phase === "FIN-ACK") return "#64748b";
  return "#94a3b8";
}

// ── UI ──

/**
 * HTTPS シミュレーター アプリケーションクラス
 *
 * ブラウザ上で HTTPS/TLS 接続のシミュレーションを実行し、
 * シーケンス図、パケットトレース、セッション情報を可視化する。
 * プリセットの実験シナリオをセレクトボックスから選択して実行できる。
 */
export class HttpsApp {
  /**
   * アプリケーションを初期化し、指定されたコンテナ要素に UI を構築する
   * @param container アプリケーションを描画する HTML 要素
   */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "HTTPS Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e2e8f0;white-space:nowrap;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = EXPERIMENTS[i]!.name;
      exSelect.appendChild(o);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run";
    runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 設定 + 統計
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Connection Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const statsLabel = document.createElement("div");
    statsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    statsLabel.textContent = "Results";
    leftPanel.appendChild(statsLabel);
    const statsDiv = document.createElement("div");
    statsDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(statsDiv);

    const sessionLabel = document.createElement("div");
    sessionLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ec4899;border-bottom:1px solid #1e293b;";
    sessionLabel.textContent = "TLS Session";
    leftPanel.appendChild(sessionLabel);
    const sessionDiv = document.createElement("div");
    sessionDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;font-size:9px;overflow-x:auto;";
    leftPanel.appendChild(sessionDiv);

    main.appendChild(leftPanel);

    // 右パネル: シーケンス図 + イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    // シーケンス図
    const seqLabel = document.createElement("div");
    seqLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    seqLabel.textContent = "Sequence Diagram";
    rightPanel.appendChild(seqLabel);
    const seqCanvas = document.createElement("canvas");
    seqCanvas.style.cssText = "height:320px;width:100%;background:#000;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(seqCanvas);

    // イベントログ
    const evLabel = document.createElement("div");
    evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Packet Trace";
    rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div");
    evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;";
    rightPanel.appendChild(evDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画ロジック ──

    /** 実験の接続設定情報を左パネルに描画する */
    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        cfgDiv.appendChild(row);
      };
      add("TLS バージョン", exp.config.tlsVersion, "#a78bfa");
      add("暗号スイート", exp.config.clientCipherSuites[0] ?? "none", "#ec4899");
      if (exp.config.clientCipherSuites.length > 1) add("  + 他", `${exp.config.clientCipherSuites.length - 1} スイート`, "#64748b");
      add("証明書", exp.config.serverCertChain[0]?.subject ?? "none", "#f59e0b");
      add("チェーン長", String(exp.config.serverCertChain.length), "#64748b");
      add("セッション再開", exp.config.sessionResumption ? "あり" : "なし", "#06b6d4");
      add("RTT", `${exp.config.network.rttMs}ms`, "#64748b");
      add("HTTP", `${exp.config.httpRequest.method} ${exp.config.httpRequest.path}`, "#3b82f6");
      if (exp.config.forceCertError) add("証明書エラー", "強制挿入", "#ef4444");
    };

    /** シミュレーション結果の統計情報を左パネルに描画する */
    const renderStats = (result: SimulationResult) => {
      statsDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        statsDiv.appendChild(row);
      };
      add("結果", result.success ? "✓ 接続成功" : `✗ 失敗: ${result.error}`, result.success ? "#22c55e" : "#ef4444");
      add("総所要時間", `${result.totalTime.toFixed(0)}ms`, "#e2e8f0");
      add("ハンドシェイク", `${result.handshakeTime.toFixed(0)}ms`, "#a78bfa");
      add("ラウンドトリップ", String(result.roundTrips), "#f59e0b");
      add("送信量", `${result.bytesSent} bytes`, "#22c55e");
      add("受信量", `${result.bytesReceived} bytes`, "#06b6d4");
    };

    /** TLS セッション情報 (鍵、ID など) を左パネルに描画する */
    const renderSession = (session: TlsSession | null) => {
      sessionDiv.innerHTML = "";
      if (!session) {
        sessionDiv.innerHTML = '<span style="color:#475569;">セッションなし</span>';
        return;
      }
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;word-break:break-all;">${v}</span>`;
        sessionDiv.appendChild(row);
      };
      add("Session ID", session.sessionId, "#ec4899");
      add("Cipher Suite", session.cipherSuite.name, "#a78bfa");
      add("Master Secret", session.masterSecret.slice(0, 32) + "...", "#f59e0b");
      add("Client Random", session.clientRandom.slice(0, 32) + "...", "#22c55e");
      add("Server Random", session.serverRandom.slice(0, 32) + "...", "#06b6d4");
      add("Client Write Key", session.clientWriteKey.slice(0, 16) + "...", "#e2e8f0");
      add("Server Write Key", session.serverWriteKey.slice(0, 16) + "...", "#e2e8f0");
      add("Resumable", session.resumable ? "Yes" : "No", "#64748b");
    };

    /**
     * シーケンス図を Canvas 上に描画する
     * クライアントとサーバーの生命線を描き、各パケットを矢印で表現する。
     * 暗号化されたレコードは太線で描画し、鍵アイコンを付与する。
     */
    const renderSequenceDiagram = (result: SimulationResult) => {
      const dpr = devicePixelRatio;
      const cw = seqCanvas.clientWidth;
      const ch = seqCanvas.clientHeight;
      seqCanvas.width = cw * dpr;
      seqCanvas.height = ch * dpr;
      const ctx = seqCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      const clientX = 80;
      const serverX = cw - 80;
      const topY = 30;

      // ヘッダ
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#22c55e";
      ctx.fillText("Client", clientX, 14);
      ctx.fillStyle = "#06b6d4";
      ctx.fillText("Server", serverX, 14);

      // 生命線
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(clientX, topY);
      ctx.lineTo(clientX, ch - 5);
      ctx.moveTo(serverX, topY);
      ctx.lineTo(serverX, ch - 5);
      ctx.stroke();
      ctx.setLineDash([]);

      // イベントを矢印で描画
      const arrows = result.events.filter((e) => e.direction !== "internal");
      const maxTime = result.totalTime || 1;
      const availH = ch - topY - 10;

      for (const ev of arrows) {
        const y = topY + (ev.time / maxTime) * availH;
        if (y > ch - 5) continue;

        const fromX = ev.direction === "client→server" ? clientX : serverX;
        const toX = ev.direction === "client→server" ? serverX : clientX;

        const color = phaseColor(ev.phase);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;

        // 暗号化されたレコードは二重線
        if (ev.record?.encrypted) {
          ctx.lineWidth = 2.5;
        }

        // 矢印
        ctx.beginPath();
        ctx.moveTo(fromX, y);
        ctx.lineTo(toX, y);
        ctx.stroke();

        // 矢頭
        const headLen = 6;
        const angle = ev.direction === "client→server" ? 0 : Math.PI;
        ctx.beginPath();
        ctx.moveTo(toX, y);
        ctx.lineTo(toX - headLen * Math.cos(angle - 0.4), y - headLen * Math.sin(angle - 0.4));
        ctx.moveTo(toX, y);
        ctx.lineTo(toX - headLen * Math.cos(angle + 0.4), y + headLen * Math.sin(angle + 0.4));
        ctx.stroke();

        // ラベル
        ctx.fillStyle = color;
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        const label = ev.record ? `[${ev.record.contentType}] ${ev.phase}` : ev.phase;
        ctx.fillText(label, (fromX + toX) / 2, y - 4);

        // 暗号化インジケータ
        if (ev.record?.encrypted) {
          ctx.fillStyle = "#f59e0b";
          ctx.font = "7px monospace";
          ctx.fillText("🔒", (fromX + toX) / 2 + label.length * 2.5 + 10, y - 3);
        }
      }

      // 時刻軸
      ctx.fillStyle = "#475569";
      ctx.font = "8px monospace";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const t = (maxTime * i) / 4;
        const y = topY + (i / 4) * availH;
        ctx.fillText(`${t.toFixed(0)}ms`, clientX - 10, y + 3);
      }
    };

    /**
     * パケットトレースのイベントログを右パネルに描画する
     * 各イベントのタイムスタンプ、方向、プロトコル層、フェーズ、詳細を
     * 色分けして表示する。hex ダンプがある場合は折りたたみ表示する。
     */
    const renderEvents = (events: TraceEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";

        const dColor = directionColor(ev.direction);
        const lColor = layerColor(ev.layer);
        const pColor = phaseColor(ev.phase);

        let html =
          `<span style="min-width:36px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="color:${dColor};min-width:12px;text-align:center;">${directionIcon(ev.direction)}</span>` +
          `<span style="min-width:32px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lColor};background:${lColor}15;border:1px solid ${lColor}33;">${ev.layer}</span>` +
          `<span style="min-width:90px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;color:${pColor};background:${pColor}15;border:1px solid ${pColor}33;">${ev.phase}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;

        if (ev.record) {
          html += ` <span style="color:#475569;font-size:8px;">[${ev.record.length}B${ev.record.encrypted ? " 🔒" : ""}]</span>`;
        }

        el.innerHTML = html;
        evDiv.appendChild(el);

        // hex ダンプがあれば折りたたみ表示
        if (ev.hexDump) {
          const pre = document.createElement("pre");
          pre.style.cssText = "margin:2px 0 4px 120px;padding:4px 8px;background:#0a0a1e;border:1px solid #1e293b;border-radius:3px;font-size:8px;color:#64748b;white-space:pre;overflow-x:auto;";
          pre.textContent = ev.hexDump;
          evDiv.appendChild(pre);
        }
      }
    };

    // ── ロジック ──

    /** 選択された実験プリセットを読み込み、設定情報を表示する (シミュレーションは実行しない) */
    const loadExperiment = (exp: Experiment) => {
      descSpan.textContent = exp.description;
      renderConfig(exp);
      statsDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリックして HTTPS 接続をシミュレーション</span>';
      sessionDiv.innerHTML = "";
      evDiv.innerHTML = "";
    };

    /** 実験を実行し、シミュレーション結果を全パネルに描画する */
    const runSimulation = (exp: Experiment) => {
      const sim = new HttpsSimulator();
      const result = sim.simulate(exp.config);
      renderConfig(exp);
      renderStats(result);
      renderSession(result.session);
      renderSequenceDiagram(result);
      renderEvents(result.events);
    };

    // セレクトボックス変更時に実験プリセットを切り替える
    exSelect.addEventListener("change", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) loadExperiment(exp);
    });
    // Run ボタンクリック時にシミュレーションを実行する
    runBtn.addEventListener("click", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) runSimulation(exp);
    });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
