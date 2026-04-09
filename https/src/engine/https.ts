/**
 * https.ts — HTTPS / TLS プロトコルエミュレーションエンジン
 *
 * TLS 1.2 / 1.3 のハンドシェイク、鍵交換、レコードレイヤー暗号化を
 * コード上でシミュレーションし、パケット単位でトレースする。
 *
 * パイプライン:
 *   TCP 3-way HS → TLS ClientHello → ServerHello →
 *   証明書送信 → 鍵交換 → Finished → 暗号化 HTTP 通信 → 切断
 */

// ── 基本型 ──

/** TLS バージョン */
export type TlsVersion = "TLS1.2" | "TLS1.3";

/** 暗号スイート */
export interface CipherSuite {
  name: string;
  /** 鍵交換 */
  keyExchange: "RSA" | "ECDHE" | "DHE";
  /** 認証 */
  auth: "RSA" | "ECDSA";
  /** 対称暗号 */
  cipher: "AES-128-GCM" | "AES-256-GCM" | "AES-128-CBC" | "CHACHA20-POLY1305";
  /** ハッシュ */
  hash: "SHA256" | "SHA384";
  /** TLS 1.3 専用か */
  tls13Only: boolean;
}

/** 既知の暗号スイート一覧 */
export const CIPHER_SUITES: CipherSuite[] = [
  { name: "TLS_AES_128_GCM_SHA256", keyExchange: "ECDHE", auth: "RSA", cipher: "AES-128-GCM", hash: "SHA256", tls13Only: true },
  { name: "TLS_AES_256_GCM_SHA384", keyExchange: "ECDHE", auth: "RSA", cipher: "AES-256-GCM", hash: "SHA384", tls13Only: true },
  { name: "TLS_CHACHA20_POLY1305_SHA256", keyExchange: "ECDHE", auth: "RSA", cipher: "CHACHA20-POLY1305", hash: "SHA256", tls13Only: true },
  { name: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", keyExchange: "ECDHE", auth: "RSA", cipher: "AES-128-GCM", hash: "SHA256", tls13Only: false },
  { name: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384", keyExchange: "ECDHE", auth: "RSA", cipher: "AES-256-GCM", hash: "SHA384", tls13Only: false },
  { name: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256", keyExchange: "ECDHE", auth: "ECDSA", cipher: "AES-128-GCM", hash: "SHA256", tls13Only: false },
  { name: "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256", keyExchange: "DHE", auth: "RSA", cipher: "AES-128-CBC", hash: "SHA256", tls13Only: false },
  { name: "TLS_RSA_WITH_AES_128_GCM_SHA256", keyExchange: "RSA", auth: "RSA", cipher: "AES-128-GCM", hash: "SHA256", tls13Only: false },
];

/** 証明書 */
export interface Certificate {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  publicKey: string;
  signatureAlgorithm: string;
  /** 自己署名かどうか */
  selfSigned: boolean;
  /** CA 証明書か */
  isCA: boolean;
}

/** TLS セッション情報 */
export interface TlsSession {
  sessionId: string;
  version: TlsVersion;
  cipherSuite: CipherSuite;
  /** マスターシークレット (hex 文字列) */
  masterSecret: string;
  /** クライアントランダム (hex 文字列) */
  clientRandom: string;
  /** サーバーランダム (hex 文字列) */
  serverRandom: string;
  /** プリマスターシークレット (hex 文字列) */
  preMasterSecret: string;
  /** 暗号化キー (導出後) */
  clientWriteKey: string;
  serverWriteKey: string;
  /** IV */
  clientWriteIV: string;
  serverWriteIV: string;
  /** 再開可能か */
  resumable: boolean;
}

/** TLS レコード */
export interface TlsRecord {
  contentType: "handshake" | "change_cipher_spec" | "alert" | "application_data";
  version: TlsVersion;
  /** ペイロード長 (bytes) */
  length: number;
  /** ペイロードの概要 */
  payload: string;
  /** 暗号化済みか */
  encrypted: boolean;
}

/** TLS アラート */
export interface TlsAlert {
  level: "warning" | "fatal";
  description: string;
  code: number;
}

/** ネットワーク設定 */
export interface NetworkConfig {
  /** クライアント→サーバー RTT (ms) */
  rttMs: number;
  /** パケットロス率 */
  packetLossRate: number;
  /** 帯域幅 (Mbps) */
  bandwidthMbps: number;
}

/** HTTP リクエスト */
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** HTTP レスポンス */
export interface HttpResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/** シミュレーション全体のイベント */
export interface TraceEvent {
  /** タイムスタンプ (ms) */
  time: number;
  /** 送信方向 */
  direction: "client→server" | "server→client" | "internal";
  /** プロトコル層 */
  layer: "TCP" | "TLS" | "HTTP" | "Network";
  /** フェーズ */
  phase: string;
  /** 詳細 */
  detail: string;
  /** TLS レコード (あれば) */
  record?: TlsRecord;
  /** バイト列ダンプ (表示用) */
  hexDump?: string;
}

/** HTTPS 接続設定 */
export interface HttpsConfig {
  tlsVersion: TlsVersion;
  /** クライアントが提示する暗号スイート */
  clientCipherSuites: string[];
  /** サーバー証明書チェーン */
  serverCertChain: Certificate[];
  /** セッション再開を試みるか */
  sessionResumption: boolean;
  /** 以前のセッション (再開用) */
  previousSession?: TlsSession;
  /** HTTP リクエスト */
  httpRequest: HttpRequest;
  /** サーバーの HTTP レスポンス */
  httpResponse: HttpResponse;
  /** ネットワーク設定 */
  network: NetworkConfig;
  /** 証明書検証を失敗させるか */
  forceCertError: boolean;
  /** アラートを挿入するか */
  injectAlert?: TlsAlert;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: TraceEvent[];
  session: TlsSession | null;
  /** 接続成功したか */
  success: boolean;
  /** エラーメッセージ */
  error?: string;
  /** 総所要時間 (ms) */
  totalTime: number;
  /** ハンドシェイク所要時間 (ms) */
  handshakeTime: number;
  /** ラウンドトリップ数 */
  roundTrips: number;
  /** 送受信バイト数 */
  bytesSent: number;
  bytesReceived: number;
  /** 暗号化された HTTP データ (hex) */
  encryptedRequest?: string;
  encryptedResponse?: string;
}

// ── 暗号ユーティリティ (教育用簡易実装) ──

/** 擬似乱数 hex 文字列を生成する */
export function randomHex(bytes: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < bytes * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

/** 簡易ハッシュ (教育用、SHA-256 の代わり) */
export function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  // 32バイトに拡張
  let result = hex;
  for (let i = 0; i < 7; i++) {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
    h = (h ^ (h >>> 16)) >>> 0;
    result += h.toString(16).padStart(8, "0");
  }
  return result;
}

/** PRF (擬似乱数関数) — マスターシークレットの導出 */
export function prf(secret: string, label: string, seed: string, length: number): string {
  let result = "";
  let a = simpleHash(label + seed);
  while (result.length < length * 2) {
    result += simpleHash(secret + a + label + seed);
    a = simpleHash(secret + a);
  }
  return result.slice(0, length * 2);
}

/** 簡易 XOR 暗号化 (教育用、AES-GCM の代わり) */
export function xorEncrypt(plaintext: string, key: string): string {
  let result = "";
  for (let i = 0; i < plaintext.length; i++) {
    const p = plaintext.charCodeAt(i);
    const k = parseInt(key.slice((i * 2) % key.length, (i * 2) % key.length + 2) || "00", 16);
    result += (p ^ k).toString(16).padStart(2, "0");
  }
  return result;
}

/** XOR 復号 */
export function xorDecrypt(cipherHex: string, key: string): string {
  let result = "";
  for (let i = 0; i < cipherHex.length; i += 2) {
    const c = parseInt(cipherHex.slice(i, i + 2), 16);
    const k = parseInt(key.slice(((i / 2) * 2) % key.length, ((i / 2) * 2) % key.length + 2) || "00", 16);
    result += String.fromCharCode(c ^ k);
  }
  return result;
}

/** HMAC 計算 (簡易) */
export function hmac(key: string, data: string): string {
  return simpleHash(key + data);
}

/** ECDHE 鍵交換のシミュレーション (楕円曲線の概念を再現) */
export function simulateECDHE(): { clientPrivate: string; clientPublic: string; serverPrivate: string; serverPublic: string; sharedSecret: string } {
  const clientPrivate = randomHex(32);
  const serverPrivate = randomHex(32);
  const clientPublic = simpleHash("G*" + clientPrivate);
  const serverPublic = simpleHash("G*" + serverPrivate);
  // 共有秘密: 両者から同じ値が導出される (教育用)
  const sharedSecret = simpleHash(clientPrivate + serverPublic);
  return { clientPrivate, clientPublic, serverPrivate, serverPublic, sharedSecret };
}

/** DHE 鍵交換のシミュレーション */
export function simulateDHE(): { p: string; g: string; clientPublic: string; serverPublic: string; sharedSecret: string } {
  const p = randomHex(32);
  const g = "02";
  const clientPrivate = randomHex(16);
  const serverPrivate = randomHex(16);
  const clientPublic = simpleHash(g + clientPrivate + p);
  const serverPublic = simpleHash(g + serverPrivate + p);
  const sharedSecret = simpleHash(clientPrivate + serverPublic + p);
  return { p, g, clientPublic, serverPublic, sharedSecret };
}

/** 文字列を hex ダンプ形式にする */
export function hexDump(str: string, maxBytes: number = 48): string {
  const bytes: string[] = [];
  for (let i = 0; i < Math.min(str.length, maxBytes); i++) {
    bytes.push(str.charCodeAt(i).toString(16).padStart(2, "0"));
  }
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const hex = bytes.slice(i, i + 16).join(" ");
    const ascii = str.slice(i, Math.min(i + 16, maxBytes)).replace(/[^\x20-\x7e]/g, ".");
    lines.push(`${i.toString(16).padStart(4, "0")}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  if (str.length > maxBytes) lines.push(`... (${str.length - maxBytes} more bytes)`);
  return lines.join("\n");
}

// ── 暗号スイートネゴシエーション ──

/** クライアントとサーバーの暗号スイートをネゴシエーションする */
export function negotiateCipherSuite(
  clientSuites: string[],
  tlsVersion: TlsVersion,
): CipherSuite | undefined {
  for (const name of clientSuites) {
    const suite = CIPHER_SUITES.find((s) => s.name === name);
    if (!suite) continue;
    if (tlsVersion === "TLS1.2" && suite.tls13Only) continue;
    if (tlsVersion === "TLS1.3" && !suite.tls13Only && suite.keyExchange === "RSA") continue;
    return suite;
  }
  return undefined;
}

// ── 証明書検証 ──

/** 証明書チェーンを検証する */
export function verifyCertChain(chain: Certificate[]): { valid: boolean; error?: string; steps: string[] } {
  const steps: string[] = [];
  if (chain.length === 0) {
    return { valid: false, error: "証明書チェーンが空", steps };
  }

  // エンドエンティティ証明書
  const leaf = chain[0]!;
  steps.push(`リーフ証明書: ${leaf.subject} (発行者: ${leaf.issuer})`);

  // チェーンを辿る
  for (let i = 0; i < chain.length - 1; i++) {
    const cert = chain[i]!;
    const issuerCert = chain[i + 1]!;

    // 発行者の一致確認
    if (cert.issuer !== issuerCert.subject) {
      steps.push(`✗ ${cert.subject} の発行者 "${cert.issuer}" と次の証明書 "${issuerCert.subject}" が不一致`);
      return { valid: false, error: `証明書チェーンの発行者不一致: ${cert.issuer} ≠ ${issuerCert.subject}`, steps };
    }
    steps.push(`✓ ${cert.subject} → ${issuerCert.subject} (チェーン検証 OK)`);

    // 中間証明書が CA であるか
    if (!issuerCert.isCA) {
      steps.push(`✗ ${issuerCert.subject} は CA 証明書でない`);
      return { valid: false, error: `CA 証明書でない: ${issuerCert.subject}`, steps };
    }
  }

  // ルート証明書の確認
  const root = chain[chain.length - 1]!;
  if (root.selfSigned) {
    steps.push(`✓ ルート証明書: ${root.subject} (自己署名、トラストストア内)`);
  } else {
    steps.push(`✗ ルート証明書 ${root.subject} が自己署名でない (信頼アンカーなし)`);
    return { valid: false, error: `信頼されたルート CA が見つからない`, steps };
  }

  return { valid: true, steps };
}

// ── HTTPS シミュレーター ──

export class HttpsSimulator {

  /** HTTPS 接続をシミュレーションする */
  simulate(config: HttpsConfig): SimulationResult {
    const events: TraceEvent[] = [];
    let time = 0;
    const halfRtt = config.network.rttMs / 2;
    let roundTrips = 0;
    let bytesSent = 0;
    let bytesReceived = 0;

    // ── TCP 3-way Handshake ──
    events.push({ time, direction: "client→server", layer: "TCP", phase: "SYN", detail: `SYN seq=0 → ${config.httpRequest.headers["Host"] ?? "server"}:443` });
    time += halfRtt;
    events.push({ time, direction: "server→client", layer: "TCP", phase: "SYN-ACK", detail: "SYN-ACK seq=0, ack=1" });
    time += halfRtt;
    events.push({ time, direction: "client→server", layer: "TCP", phase: "ACK", detail: "ACK ack=1 — TCP 接続確立" });
    roundTrips++;
    bytesSent += 64;
    bytesReceived += 64;

    const handshakeStart = time;

    // ── TLS ClientHello ──
    const clientRandom = randomHex(32);
    const sessionId = config.sessionResumption && config.previousSession ? config.previousSession.sessionId : randomHex(16);
    const clientHelloSuites = config.clientCipherSuites.join(", ");

    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "ClientHello",
      detail: `version=${config.tlsVersion}, random=${clientRandom.slice(0, 16)}..., session_id=${sessionId.slice(0, 8)}..., cipher_suites=[${clientHelloSuites}]`,
      record: { contentType: "handshake", version: config.tlsVersion, length: 512, payload: "ClientHello", encrypted: false },
    });
    bytesSent += 512;
    time += halfRtt;

    // ── セッション再開チェック ──
    if (config.sessionResumption && config.previousSession) {
      return this.simulateSessionResumption(config, events, time, halfRtt, clientRandom, sessionId, roundTrips, bytesSent, bytesReceived, handshakeStart);
    }

    // ── TLS ServerHello ──
    const serverRandom = randomHex(32);
    const negotiated = negotiateCipherSuite(config.clientCipherSuites, config.tlsVersion);
    if (!negotiated) {
      events.push({
        time,
        direction: "server→client",
        layer: "TLS",
        phase: "Alert",
        detail: "handshake_failure: 共通の暗号スイートがない",
        record: { contentType: "alert", version: config.tlsVersion, length: 2, payload: "handshake_failure(40)", encrypted: false },
      });
      return this.buildResult(events, null, false, "暗号スイートのネゴシエーション失敗", time, time - handshakeStart, roundTrips, bytesSent, bytesReceived);
    }

    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "ServerHello",
      detail: `version=${config.tlsVersion}, random=${serverRandom.slice(0, 16)}..., cipher_suite=${negotiated.name}`,
      record: { contentType: "handshake", version: config.tlsVersion, length: 128, payload: "ServerHello", encrypted: false },
    });
    bytesReceived += 128;

    // ── Certificate ──
    const certNames = config.serverCertChain.map((c) => c.subject).join(" → ");
    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "Certificate",
      detail: `証明書チェーン: ${certNames} (${config.serverCertChain.length} 証明書)`,
      record: { contentType: "handshake", version: config.tlsVersion, length: config.serverCertChain.length * 1024, payload: "Certificate", encrypted: false },
    });
    bytesReceived += config.serverCertChain.length * 1024;

    // ── 鍵交換 ──
    let preMasterSecret: string;
    let keyExchangeDetail: string;

    if (negotiated.keyExchange === "ECDHE") {
      const ecdhe = simulateECDHE();
      events.push({
        time,
        direction: "server→client",
        layer: "TLS",
        phase: "ServerKeyExchange",
        detail: `ECDHE: curve=secp256r1, server_public=${ecdhe.serverPublic.slice(0, 16)}...`,
        record: { contentType: "handshake", version: config.tlsVersion, length: 329, payload: "ServerKeyExchange (ECDHE)", encrypted: false },
      });
      bytesReceived += 329;
      preMasterSecret = ecdhe.sharedSecret;
      keyExchangeDetail = `ECDHE (secp256r1): 前方秘匿性あり`;
    } else if (negotiated.keyExchange === "DHE") {
      const dhe = simulateDHE();
      events.push({
        time,
        direction: "server→client",
        layer: "TLS",
        phase: "ServerKeyExchange",
        detail: `DHE: p=${dhe.p.slice(0, 16)}..., g=${dhe.g}, server_public=${dhe.serverPublic.slice(0, 16)}...`,
        record: { contentType: "handshake", version: config.tlsVersion, length: 512, payload: "ServerKeyExchange (DHE)", encrypted: false },
      });
      bytesReceived += 512;
      preMasterSecret = dhe.sharedSecret;
      keyExchangeDetail = `DHE: 前方秘匿性あり`;
    } else {
      // RSA 鍵交換
      preMasterSecret = randomHex(48);
      keyExchangeDetail = `RSA: プリマスターシークレットをサーバー公開鍵で暗号化 (前方秘匿性なし)`;
    }

    // TLS 1.2: ServerHelloDone
    if (config.tlsVersion === "TLS1.2") {
      events.push({
        time,
        direction: "server→client",
        layer: "TLS",
        phase: "ServerHelloDone",
        detail: "サーバーハンドシェイクメッセージ完了",
        record: { contentType: "handshake", version: config.tlsVersion, length: 4, payload: "ServerHelloDone", encrypted: false },
      });
      bytesReceived += 4;
    }

    time += halfRtt;
    roundTrips++;

    // ── 証明書検証 (クライアント側) ──
    events.push({ time, direction: "internal", layer: "TLS", phase: "CertVerify", detail: "証明書チェーン検証を開始..." });

    if (config.forceCertError) {
      events.push({
        time,
        direction: "internal",
        layer: "TLS",
        phase: "CertVerify",
        detail: "✗ 証明書検証失敗: 信頼されない発行者",
      });
      events.push({
        time,
        direction: "client→server",
        layer: "TLS",
        phase: "Alert",
        detail: "fatal: bad_certificate(42)",
        record: { contentType: "alert", version: config.tlsVersion, length: 2, payload: "bad_certificate(42)", encrypted: false },
      });
      return this.buildResult(events, null, false, "証明書検証エラー", time, time - handshakeStart, roundTrips, bytesSent, bytesReceived);
    }

    const certResult = verifyCertChain(config.serverCertChain);
    for (const step of certResult.steps) {
      events.push({ time, direction: "internal", layer: "TLS", phase: "CertVerify", detail: step });
    }

    if (!certResult.valid) {
      events.push({
        time,
        direction: "client→server",
        layer: "TLS",
        phase: "Alert",
        detail: `fatal: ${certResult.error}`,
        record: { contentType: "alert", version: config.tlsVersion, length: 2, payload: "certificate_unknown(46)", encrypted: false },
      });
      return this.buildResult(events, null, false, certResult.error!, time, time - handshakeStart, roundTrips, bytesSent, bytesReceived);
    }

    // ── ClientKeyExchange ──
    events.push({ time, direction: "internal", layer: "TLS", phase: "KeyExchange", detail: keyExchangeDetail });

    if (negotiated.keyExchange === "RSA") {
      events.push({
        time,
        direction: "client→server",
        layer: "TLS",
        phase: "ClientKeyExchange",
        detail: `RSA 暗号化プリマスターシークレット: ${preMasterSecret.slice(0, 16)}...`,
        record: { contentType: "handshake", version: config.tlsVersion, length: 256, payload: "ClientKeyExchange (RSA)", encrypted: false },
      });
    } else {
      events.push({
        time,
        direction: "client→server",
        layer: "TLS",
        phase: "ClientKeyExchange",
        detail: `${negotiated.keyExchange} クライアント公開鍵送信`,
        record: { contentType: "handshake", version: config.tlsVersion, length: 66, payload: `ClientKeyExchange (${negotiated.keyExchange})`, encrypted: false },
      });
    }
    bytesSent += 256;

    // ── マスターシークレット導出 ──
    const masterSecret = prf(preMasterSecret, "master secret", clientRandom + serverRandom, 48);
    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "KeyDerivation",
      detail: `PRF(pre_master_secret, "master secret", client_random + server_random) → master_secret=${masterSecret.slice(0, 16)}...`,
    });

    // ── 暗号鍵の導出 ──
    const keyBlock = prf(masterSecret, "key expansion", serverRandom + clientRandom, 104);
    const clientWriteKey = keyBlock.slice(0, 32);
    const serverWriteKey = keyBlock.slice(32, 64);
    const clientWriteIV = keyBlock.slice(64, 88);
    const serverWriteIV = keyBlock.slice(88, 112);

    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "KeyDerivation",
      detail: `鍵ブロック導出: client_write_key=${clientWriteKey.slice(0, 8)}..., server_write_key=${serverWriteKey.slice(0, 8)}..., IV=${clientWriteIV.slice(0, 8)}...`,
    });

    // ── ChangeCipherSpec + Finished (Client) ──
    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "ChangeCipherSpec",
      detail: "以降の通信を暗号化モードに切替",
      record: { contentType: "change_cipher_spec", version: config.tlsVersion, length: 1, payload: "ChangeCipherSpec", encrypted: false },
    });
    bytesSent += 1;

    const clientVerifyData = hmac(masterSecret, "client finished" + simpleHash(clientRandom + serverRandom));
    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "Finished",
      detail: `verify_data=${clientVerifyData.slice(0, 24)}... (暗号化済み)`,
      record: { contentType: "handshake", version: config.tlsVersion, length: 40, payload: "Finished (encrypted)", encrypted: true },
    });
    bytesSent += 40;

    time += halfRtt;

    // ── ChangeCipherSpec + Finished (Server) ──
    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "ChangeCipherSpec",
      detail: "サーバー側も暗号化モードに切替",
      record: { contentType: "change_cipher_spec", version: config.tlsVersion, length: 1, payload: "ChangeCipherSpec", encrypted: false },
    });
    bytesReceived += 1;

    const serverVerifyData = hmac(masterSecret, "server finished" + simpleHash(clientRandom + serverRandom));
    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "Finished",
      detail: `verify_data=${serverVerifyData.slice(0, 24)}... (暗号化済み)`,
      record: { contentType: "handshake", version: config.tlsVersion, length: 40, payload: "Finished (encrypted)", encrypted: true },
    });
    bytesReceived += 40;

    time += halfRtt;
    roundTrips++;

    const handshakeTime = time - handshakeStart;
    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "HandshakeComplete",
      detail: `TLS ハンドシェイク完了 (${handshakeTime}ms, ${roundTrips} RT, ${negotiated.name})`,
    });

    // ── アラート挿入 ──
    if (config.injectAlert) {
      events.push({
        time,
        direction: "server→client",
        layer: "TLS",
        phase: "Alert",
        detail: `${config.injectAlert.level}: ${config.injectAlert.description} (${config.injectAlert.code})`,
        record: { contentType: "alert", version: config.tlsVersion, length: 2, payload: `${config.injectAlert.description}(${config.injectAlert.code})`, encrypted: true },
      });
      if (config.injectAlert.level === "fatal") {
        return this.buildResult(events, null, false, config.injectAlert.description, time, handshakeTime, roundTrips, bytesSent, bytesReceived);
      }
    }

    // ── 暗号化 HTTP 通信 ──
    const reqLine = `${config.httpRequest.method} ${config.httpRequest.path} HTTP/1.1`;
    const reqHeaders = Object.entries(config.httpRequest.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    const reqBody = config.httpRequest.body ?? "";
    const fullRequest = `${reqLine}\r\n${reqHeaders}\r\n\r\n${reqBody}`;

    events.push({
      time,
      direction: "internal",
      layer: "HTTP",
      phase: "Request",
      detail: `平文: ${reqLine}`,
      hexDump: hexDump(fullRequest),
    });

    const encryptedReq = xorEncrypt(fullRequest, clientWriteKey);
    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "ApplicationData",
      detail: `暗号化 HTTP リクエスト (${fullRequest.length} bytes → ${encryptedReq.length / 2} bytes)`,
      record: { contentType: "application_data", version: config.tlsVersion, length: encryptedReq.length / 2, payload: `encrypted: ${encryptedReq.slice(0, 32)}...`, encrypted: true },
    });
    bytesSent += encryptedReq.length / 2;

    time += halfRtt;

    // サーバー側で復号
    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "Decrypt",
      detail: `サーバー: ${negotiated.cipher} で復号 → ${fullRequest.length} bytes の平文 HTTP`,
    });

    // HTTP レスポンス
    const resLine = `HTTP/1.1 ${config.httpResponse.statusCode} ${config.httpResponse.statusText}`;
    const resHeaders = Object.entries(config.httpResponse.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    const fullResponse = `${resLine}\r\n${resHeaders}\r\n\r\n${config.httpResponse.body}`;

    events.push({
      time,
      direction: "internal",
      layer: "HTTP",
      phase: "Response",
      detail: `平文: ${resLine} (${config.httpResponse.body.length} bytes body)`,
      hexDump: hexDump(fullResponse),
    });

    const encryptedRes = xorEncrypt(fullResponse, serverWriteKey);
    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "ApplicationData",
      detail: `暗号化 HTTP レスポンス (${fullResponse.length} bytes → ${encryptedRes.length / 2} bytes)`,
      record: { contentType: "application_data", version: config.tlsVersion, length: encryptedRes.length / 2, payload: `encrypted: ${encryptedRes.slice(0, 32)}...`, encrypted: true },
    });
    bytesReceived += encryptedRes.length / 2;

    time += halfRtt;
    roundTrips++;

    // クライアント側で復号
    const decryptedRes = xorDecrypt(encryptedRes, serverWriteKey);
    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "Decrypt",
      detail: `クライアント: ${negotiated.cipher} で復号 → "${decryptedRes.split("\r\n")[0]}"`,
    });

    // ── TLS 切断 ──
    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "Alert",
      detail: "close_notify: 正常切断",
      record: { contentType: "alert", version: config.tlsVersion, length: 2, payload: "close_notify(0)", encrypted: true },
    });
    time += halfRtt;
    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "Alert",
      detail: "close_notify: 応答切断",
      record: { contentType: "alert", version: config.tlsVersion, length: 2, payload: "close_notify(0)", encrypted: true },
    });

    // ── TCP FIN ──
    time += halfRtt;
    events.push({ time, direction: "client→server", layer: "TCP", phase: "FIN", detail: "FIN — TCP 切断開始" });
    time += halfRtt;
    events.push({ time, direction: "server→client", layer: "TCP", phase: "FIN-ACK", detail: "FIN-ACK" });
    time += halfRtt;
    events.push({ time, direction: "client→server", layer: "TCP", phase: "ACK", detail: "ACK — TCP 接続終了" });
    roundTrips++;

    // セッション情報
    const session: TlsSession = {
      sessionId,
      version: config.tlsVersion,
      cipherSuite: negotiated,
      masterSecret,
      clientRandom,
      serverRandom,
      preMasterSecret,
      clientWriteKey,
      serverWriteKey,
      clientWriteIV,
      serverWriteIV,
      resumable: true,
    };

    return this.buildResult(events, session, true, undefined, time, handshakeTime, roundTrips, bytesSent, bytesReceived, encryptedReq, encryptedRes);
  }

  /** セッション再開のシミュレーション */
  private simulateSessionResumption(
    config: HttpsConfig,
    events: TraceEvent[],
    time: number,
    halfRtt: number,
    clientRandom: string,
    sessionId: string,
    roundTrips: number,
    bytesSent: number,
    bytesReceived: number,
    handshakeStart: number,
  ): SimulationResult {
    const prev = config.previousSession!;
    const serverRandom = randomHex(32);

    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "ServerHello",
      detail: `セッション再開: session_id=${sessionId.slice(0, 8)}... が一致、abbreviated handshake`,
      record: { contentType: "handshake", version: config.tlsVersion, length: 128, payload: "ServerHello (resumption)", encrypted: false },
    });
    bytesReceived += 128;

    // 新しい鍵を導出
    const newMasterSecret = prf(prev.masterSecret, "master secret", clientRandom + serverRandom, 48);
    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "KeyDerivation",
      detail: `既存マスターシークレットから新しい鍵を導出: ${newMasterSecret.slice(0, 16)}...`,
    });

    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "ChangeCipherSpec",
      detail: "サーバー ChangeCipherSpec",
      record: { contentType: "change_cipher_spec", version: config.tlsVersion, length: 1, payload: "ChangeCipherSpec", encrypted: false },
    });
    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "Finished",
      detail: "サーバー Finished (暗号化済み)",
      record: { contentType: "handshake", version: config.tlsVersion, length: 40, payload: "Finished (encrypted)", encrypted: true },
    });
    bytesReceived += 41;
    time += halfRtt;
    roundTrips++;

    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "ChangeCipherSpec",
      detail: "クライアント ChangeCipherSpec",
      record: { contentType: "change_cipher_spec", version: config.tlsVersion, length: 1, payload: "ChangeCipherSpec", encrypted: false },
    });
    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "Finished",
      detail: "クライアント Finished (暗号化済み)",
      record: { contentType: "handshake", version: config.tlsVersion, length: 40, payload: "Finished (encrypted)", encrypted: true },
    });
    bytesSent += 41;

    const handshakeTime = time - handshakeStart;
    events.push({
      time,
      direction: "internal",
      layer: "TLS",
      phase: "HandshakeComplete",
      detail: `セッション再開ハンドシェイク完了 (${handshakeTime}ms, 1-RTT abbreviated)`,
    });

    // 鍵導出
    const keyBlock = prf(newMasterSecret, "key expansion", serverRandom + clientRandom, 104);
    const clientWriteKey = keyBlock.slice(0, 32);
    const serverWriteKey = keyBlock.slice(32, 64);

    // HTTP 通信
    time += halfRtt;
    const reqLine = `${config.httpRequest.method} ${config.httpRequest.path} HTTP/1.1`;
    const reqHeaders = Object.entries(config.httpRequest.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    const fullRequest = `${reqLine}\r\n${reqHeaders}\r\n\r\n${config.httpRequest.body ?? ""}`;
    const encryptedReq = xorEncrypt(fullRequest, clientWriteKey);

    events.push({
      time,
      direction: "client→server",
      layer: "TLS",
      phase: "ApplicationData",
      detail: `暗号化 HTTP リクエスト (${fullRequest.length} bytes)`,
      record: { contentType: "application_data", version: config.tlsVersion, length: encryptedReq.length / 2, payload: "encrypted", encrypted: true },
    });
    bytesSent += encryptedReq.length / 2;

    time += halfRtt;
    const resLine = `HTTP/1.1 ${config.httpResponse.statusCode} ${config.httpResponse.statusText}`;
    const resHeaders = Object.entries(config.httpResponse.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    const fullResponse = `${resLine}\r\n${resHeaders}\r\n\r\n${config.httpResponse.body}`;
    const encryptedRes = xorEncrypt(fullResponse, serverWriteKey);

    events.push({
      time,
      direction: "server→client",
      layer: "TLS",
      phase: "ApplicationData",
      detail: `暗号化 HTTP レスポンス (${fullResponse.length} bytes)`,
      record: { contentType: "application_data", version: config.tlsVersion, length: encryptedRes.length / 2, payload: "encrypted", encrypted: true },
    });
    bytesReceived += encryptedRes.length / 2;

    time += config.network.rttMs;
    roundTrips++;

    const session: TlsSession = {
      ...prev,
      sessionId,
      clientRandom,
      serverRandom,
      masterSecret: newMasterSecret,
      clientWriteKey,
      serverWriteKey,
      clientWriteIV: keyBlock.slice(64, 88),
      serverWriteIV: keyBlock.slice(88, 112),
    };

    return this.buildResult(events, session, true, undefined, time, handshakeTime, roundTrips, bytesSent, bytesReceived, encryptedReq, encryptedRes);
  }

  private buildResult(
    events: TraceEvent[],
    session: TlsSession | null,
    success: boolean,
    error: string | undefined,
    totalTime: number,
    handshakeTime: number,
    roundTrips: number,
    bytesSent: number,
    bytesReceived: number,
    encryptedRequest?: string,
    encryptedResponse?: string,
  ): SimulationResult {
    return { events, session, success, error, totalTime, handshakeTime, roundTrips, bytesSent, bytesReceived, encryptedRequest, encryptedResponse };
  }
}

// ── プリセット用データ ──

/** サンプル証明書チェーン */
export function createValidCertChain(hostname: string): Certificate[] {
  return [
    {
      subject: hostname,
      issuer: "Intermediate CA",
      serialNumber: "0a:1b:2c:3d",
      notBefore: "2025-01-01",
      notAfter: "2026-12-31",
      publicKey: randomHex(32),
      signatureAlgorithm: "SHA256withRSA",
      selfSigned: false,
      isCA: false,
    },
    {
      subject: "Intermediate CA",
      issuer: "Root CA",
      serialNumber: "01:02:03:04",
      notBefore: "2020-01-01",
      notAfter: "2030-12-31",
      publicKey: randomHex(32),
      signatureAlgorithm: "SHA256withRSA",
      selfSigned: false,
      isCA: true,
    },
    {
      subject: "Root CA",
      issuer: "Root CA",
      serialNumber: "00:00:00:01",
      notBefore: "2015-01-01",
      notAfter: "2035-12-31",
      publicKey: randomHex(32),
      signatureAlgorithm: "SHA256withRSA",
      selfSigned: true,
      isCA: true,
    },
  ];
}

/** 不正な証明書チェーン */
export function createInvalidCertChain(): Certificate[] {
  return [
    {
      subject: "evil.example.com",
      issuer: "Unknown CA",
      serialNumber: "ff:ff:ff:ff",
      notBefore: "2025-01-01",
      notAfter: "2026-12-31",
      publicKey: randomHex(32),
      signatureAlgorithm: "SHA256withRSA",
      selfSigned: false,
      isCA: false,
    },
    {
      subject: "Self-Signed Root",
      issuer: "Self-Signed Root",
      serialNumber: "00:00:00:02",
      notBefore: "2020-01-01",
      notAfter: "2030-12-31",
      publicKey: randomHex(32),
      signatureAlgorithm: "SHA256withRSA",
      selfSigned: true,
      isCA: true,
    },
  ];
}
