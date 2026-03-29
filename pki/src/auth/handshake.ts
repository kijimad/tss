/**
 * TLS風ハンドシェイクシミュレーション
 * ClientHello → ServerHello → Certificate → CertificateVerify → Finished
 * チャレンジ・レスポンス認証を含む
 */

import type { Certificate } from "../crypto/cert.js";
import { validateCertificateChain } from "../crypto/cert.js";
import type { RsaPrivateKey, RsaPublicKey } from "../crypto/rsa.js";
import { sign, verify } from "../crypto/rsa.js";

/** ハンドシェイクの状態 */
export type HandshakeState =
  | "idle"
  | "client-hello-sent"
  | "server-hello-sent"
  | "certificate-sent"
  | "certificate-verify-sent"
  | "finished"
  | "failed";

/** ハンドシェイクメッセージの種類 */
export type MessageType =
  | "ClientHello"
  | "ServerHello"
  | "Certificate"
  | "CertificateVerify"
  | "Finished"
  | "Alert";

/** ハンドシェイクメッセージ */
export interface HandshakeMessage {
  type: MessageType;
  sender: "client" | "server";
  payload: Record<string, unknown>;
  timestamp: Date;
}

/** ハンドシェイクログエントリ */
export interface HandshakeLogEntry {
  step: number;
  message: HandshakeMessage;
  description: string;
}

/** チャレンジ・レスポンス認証の結果 */
export interface ChallengeResponse {
  challenge: string;
  response: bigint;
  verified: boolean;
}

/** サーバー設定 */
export interface ServerConfig {
  /** サーバーの証明書チェーン（エンドエンティティ → ルートCA） */
  certificateChain: Certificate[];
  /** サーバーの秘密鍵 */
  privateKey: RsaPrivateKey;
  /** サポートする暗号スイート */
  cipherSuites: string[];
}

/** クライアント設定 */
export interface ClientConfig {
  /** 信頼されたルートCA証明書 */
  trustedRoots: Certificate[];
  /** サポートする暗号スイート */
  cipherSuites: string[];
}

/** ハンドシェイク結果 */
export interface HandshakeResult {
  /** ハンドシェイクが成功したか */
  success: boolean;
  /** 選択された暗号スイート */
  selectedCipher: string | null;
  /** 共有秘密（簡易版） */
  sharedSecret: bigint | null;
  /** ハンドシェイクログ */
  log: HandshakeLogEntry[];
  /** エラーメッセージ */
  error: string | null;
  /** 最終状態 */
  state: HandshakeState;
}

/** ランダムなノンス（乱数文字列）を生成する */
function generateNonce(): string {
  return `nonce-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/**
 * TLS風ハンドシェイクを実行する
 * 全ステップをシミュレートし、ログを記録する
 */
export function performHandshake(
  clientConfig: ClientConfig,
  serverConfig: ServerConfig,
): HandshakeResult {
  const log: HandshakeLogEntry[] = [];
  let step = 0;
  let state: HandshakeState = "idle";

  // === ステップ1: ClientHello ===
  const clientNonce = generateNonce();
  const clientHello: HandshakeMessage = {
    type: "ClientHello",
    sender: "client",
    payload: {
      version: "TLS-SIM 1.0",
      cipherSuites: clientConfig.cipherSuites,
      clientNonce,
    },
    timestamp: new Date(),
  };
  log.push({
    step: ++step,
    message: clientHello,
    description: "クライアントが対応する暗号スイートとノンスを送信",
  });
  state = "client-hello-sent";

  // === ステップ2: ServerHello ===
  // 共通の暗号スイートを選択する
  const commonCipher = serverConfig.cipherSuites.find((s) =>
    clientConfig.cipherSuites.includes(s),
  );
  if (!commonCipher) {
    const alert: HandshakeMessage = {
      type: "Alert",
      sender: "server",
      payload: { error: "共通の暗号スイートがありません" },
      timestamp: new Date(),
    };
    log.push({
      step: ++step,
      message: alert,
      description: "サーバーがエラーを返した：共通の暗号スイートなし",
    });
    return {
      success: false,
      selectedCipher: null,
      sharedSecret: null,
      log,
      error: "共通の暗号スイートがありません",
      state: "failed",
    };
  }

  const serverNonce = generateNonce();
  const serverHello: HandshakeMessage = {
    type: "ServerHello",
    sender: "server",
    payload: {
      version: "TLS-SIM 1.0",
      selectedCipher: commonCipher,
      serverNonce,
    },
    timestamp: new Date(),
  };
  log.push({
    step: ++step,
    message: serverHello,
    description: `サーバーが暗号スイート「${commonCipher}」を選択`,
  });
  state = "server-hello-sent";

  // === ステップ3: Certificate ===
  const certMessage: HandshakeMessage = {
    type: "Certificate",
    sender: "server",
    payload: {
      chain: serverConfig.certificateChain.map((c) => ({
        subject: c.subject,
        issuer: c.issuer,
        type: c.type,
        serialNumber: c.serialNumber,
      })),
    },
    timestamp: new Date(),
  };
  log.push({
    step: ++step,
    message: certMessage,
    description: "サーバーが証明書チェーンを送信",
  });
  state = "certificate-sent";

  // クライアントが証明書チェーンを検証する
  const certValidation = validateCertificateChain(
    serverConfig.certificateChain,
    clientConfig.trustedRoots,
  );
  if (!certValidation.valid) {
    const alert: HandshakeMessage = {
      type: "Alert",
      sender: "client",
      payload: { error: "証明書チェーンの検証に失敗", details: certValidation.errors },
      timestamp: new Date(),
    };
    log.push({
      step: ++step,
      message: alert,
      description: `証明書検証失敗: ${certValidation.errors.join(", ")}`,
    });
    return {
      success: false,
      selectedCipher: commonCipher,
      sharedSecret: null,
      log,
      error: certValidation.errors.join("; "),
      state: "failed",
    };
  }
  log.push({
    step: ++step,
    message: {
      type: "Certificate",
      sender: "client",
      payload: { status: "verified" },
      timestamp: new Date(),
    },
    description: "クライアントが証明書チェーンを検証成功",
  });

  // === ステップ4: CertificateVerify（チャレンジ・レスポンス） ===
  const challenge = `${clientNonce}|${serverNonce}`;
  const challengeSignature = sign(challenge, serverConfig.privateKey);

  const certVerifyMessage: HandshakeMessage = {
    type: "CertificateVerify",
    sender: "server",
    payload: {
      challenge,
      signature: challengeSignature.toString(),
    },
    timestamp: new Date(),
  };
  log.push({
    step: ++step,
    message: certVerifyMessage,
    description: "サーバーがチャレンジに署名して送信",
  });
  state = "certificate-verify-sent";

  // クライアントがサーバーの署名を検証する
  const serverPublicKey = serverConfig.certificateChain[0]?.publicKey;
  if (!serverPublicKey) {
    return {
      success: false,
      selectedCipher: commonCipher,
      sharedSecret: null,
      log,
      error: "サーバー証明書から公開鍵を取得できません",
      state: "failed",
    };
  }

  const signatureValid = verify(challenge, challengeSignature, serverPublicKey);
  if (!signatureValid) {
    const alert: HandshakeMessage = {
      type: "Alert",
      sender: "client",
      payload: { error: "CertificateVerifyの署名検証に失敗" },
      timestamp: new Date(),
    };
    log.push({
      step: ++step,
      message: alert,
      description: "チャレンジ・レスポンスの署名検証に失敗",
    });
    return {
      success: false,
      selectedCipher: commonCipher,
      sharedSecret: null,
      log,
      error: "CertificateVerifyの署名検証に失敗",
      state: "failed",
    };
  }

  // === ステップ5: Finished ===
  // 簡易的な共有秘密を生成（実際のTLSではDH鍵交換を使用）
  const sharedSecret = BigInt(clientNonce.length + serverNonce.length) * 12345n;

  const finishedMessage: HandshakeMessage = {
    type: "Finished",
    sender: "client",
    payload: {
      status: "success",
      selectedCipher: commonCipher,
    },
    timestamp: new Date(),
  };
  log.push({
    step: ++step,
    message: finishedMessage,
    description: "ハンドシェイク完了。安全な通信チャネルが確立された",
  });
  state = "finished";

  return {
    success: true,
    selectedCipher: commonCipher,
    sharedSecret,
    log,
    error: null,
    state,
  };
}

/** チャレンジ・レスポンス認証を単独で実行する */
export function challengeResponseAuth(
  challenge: string,
  serverPrivateKey: RsaPrivateKey,
  serverPublicKey: RsaPublicKey,
): ChallengeResponse {
  const response = sign(challenge, serverPrivateKey);
  const verified = verify(challenge, response, serverPublicKey);
  return { challenge, response, verified };
}

/** ハンドシェイクログを読みやすい文字列に変換する */
export function formatHandshakeLog(result: HandshakeResult): string {
  const lines: string[] = [
    "=== TLSハンドシェイクログ ===",
    "",
  ];

  for (const entry of result.log) {
    const arrow = entry.message.sender === "client" ? "→" : "←";
    lines.push(`[${entry.step}] ${arrow} ${entry.message.type} (${entry.message.sender})`);
    lines.push(`    ${entry.description}`);
    lines.push("");
  }

  if (result.success) {
    lines.push(`結果: 成功`);
    lines.push(`暗号スイート: ${result.selectedCipher}`);
  } else {
    lines.push(`結果: 失敗`);
    lines.push(`エラー: ${result.error}`);
  }

  return lines.join("\n");
}
