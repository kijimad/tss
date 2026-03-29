/**
 * X.509風の証明書と証明書チェーン
 * ルートCA → 中間CA → エンドエンティティの信頼チェーンをシミュレートする
 */

import type { RsaPrivateKey, RsaPublicKey } from "./rsa.js";
import { sign, verify } from "./rsa.js";

/** 証明書の種類 */
export type CertificateType = "root-ca" | "intermediate-ca" | "end-entity";

/** X.509風の証明書構造 */
export interface Certificate {
  /** シリアル番号 */
  serialNumber: string;
  /** サブジェクト（証明書の所有者） */
  subject: string;
  /** 発行者 */
  issuer: string;
  /** 証明書の種類 */
  type: CertificateType;
  /** 有効期間開始 */
  validFrom: Date;
  /** 有効期間終了 */
  validTo: Date;
  /** サブジェクトの公開鍵 */
  publicKey: RsaPublicKey;
  /** 発行者による署名 */
  signature: bigint;
  /** 自己署名かどうか */
  isSelfSigned: boolean;
}

/** 証明書チェーン検証結果 */
export interface ValidationResult {
  /** 検証が成功したか */
  valid: boolean;
  /** エラーメッセージ（失敗時） */
  errors: string[];
  /** 検証ログ */
  log: string[];
}

/** シリアル番号のカウンター */
let serialCounter = 1;

/** 証明書のデータ部分（署名対象）を文字列に変換する */
function certificateDataString(
  subject: string,
  issuer: string,
  publicKey: RsaPublicKey,
  serialNumber: string,
): string {
  return `${serialNumber}|${subject}|${issuer}|${publicKey.n}|${publicKey.e}`;
}

/** ルートCA証明書を作成する（自己署名） */
export function createRootCACert(
  subject: string,
  keyPair: { publicKey: RsaPublicKey; privateKey: RsaPrivateKey },
  validityDays = 3650,
): Certificate {
  const serialNumber = `ROOT-${String(serialCounter++).padStart(4, "0")}`;
  const now = new Date();
  const validTo = new Date(now.getTime() + validityDays * 86400000);

  // 自己署名：自身の秘密鍵で署名する
  const dataStr = certificateDataString(subject, subject, keyPair.publicKey, serialNumber);
  const signature = sign(dataStr, keyPair.privateKey);

  return {
    serialNumber,
    subject,
    issuer: subject,
    type: "root-ca",
    validFrom: now,
    validTo,
    publicKey: keyPair.publicKey,
    signature,
    isSelfSigned: true,
  };
}

/** 中間CA証明書を発行する */
export function issueIntermediateCACert(
  subject: string,
  subjectPublicKey: RsaPublicKey,
  issuerCert: Certificate,
  issuerPrivateKey: RsaPrivateKey,
  validityDays = 1825,
): Certificate {
  const serialNumber = `INT-${String(serialCounter++).padStart(4, "0")}`;
  const now = new Date();
  const validTo = new Date(now.getTime() + validityDays * 86400000);

  // 発行者の秘密鍵で署名する
  const dataStr = certificateDataString(subject, issuerCert.subject, subjectPublicKey, serialNumber);
  const signature = sign(dataStr, issuerPrivateKey);

  return {
    serialNumber,
    subject,
    issuer: issuerCert.subject,
    type: "intermediate-ca",
    validFrom: now,
    validTo,
    publicKey: subjectPublicKey,
    signature,
    isSelfSigned: false,
  };
}

/** エンドエンティティ証明書を発行する */
export function issueEndEntityCert(
  subject: string,
  subjectPublicKey: RsaPublicKey,
  issuerCert: Certificate,
  issuerPrivateKey: RsaPrivateKey,
  validityDays = 365,
): Certificate {
  const serialNumber = `EE-${String(serialCounter++).padStart(4, "0")}`;
  const now = new Date();
  const validTo = new Date(now.getTime() + validityDays * 86400000);

  const dataStr = certificateDataString(subject, issuerCert.subject, subjectPublicKey, serialNumber);
  const signature = sign(dataStr, issuerPrivateKey);

  return {
    serialNumber,
    subject,
    issuer: issuerCert.subject,
    type: "end-entity",
    validFrom: now,
    validTo,
    publicKey: subjectPublicKey,
    signature,
    isSelfSigned: false,
  };
}

/** 個別の証明書の署名を検証する */
export function verifyCertSignature(
  cert: Certificate,
  issuerPublicKey: RsaPublicKey,
): boolean {
  const dataStr = certificateDataString(cert.subject, cert.issuer, cert.publicKey, cert.serialNumber);
  return verify(dataStr, cert.signature, issuerPublicKey);
}

/** 証明書の有効期限を検証する */
export function isCertExpired(cert: Certificate, now = new Date()): boolean {
  return now < cert.validFrom || now > cert.validTo;
}

/**
 * 証明書チェーンを検証する
 * chain[0] = エンドエンティティ, chain[last] = ルートCA
 * trustedRoots: 信頼されたルートCA証明書のリスト
 */
export function validateCertificateChain(
  chain: Certificate[],
  trustedRoots: Certificate[],
  now = new Date(),
): ValidationResult {
  const errors: string[] = [];
  const log: string[] = [];

  if (chain.length === 0) {
    return { valid: false, errors: ["証明書チェーンが空です"], log: [] };
  }

  // チェーンの各証明書を検証する
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i]!;
    log.push(`検証中: ${cert.subject} (${cert.type})`);

    // 有効期限チェック
    if (isCertExpired(cert, now)) {
      errors.push(`証明書「${cert.subject}」の有効期限が切れています`);
      log.push(`  [NG] 有効期限切れ`);
    } else {
      log.push(`  [OK] 有効期限内`);
    }

    // 署名検証
    if (i < chain.length - 1) {
      // 次の証明書（発行者）の公開鍵で署名を検証
      const issuerCert = chain[i + 1]!;
      if (cert.issuer !== issuerCert.subject) {
        errors.push(`証明書「${cert.subject}」の発行者が不一致です`);
        log.push(`  [NG] 発行者不一致: ${cert.issuer} !== ${issuerCert.subject}`);
      } else if (verifyCertSignature(cert, issuerCert.publicKey)) {
        log.push(`  [OK] 署名検証成功（発行者: ${issuerCert.subject}）`);
      } else {
        errors.push(`証明書「${cert.subject}」の署名が無効です`);
        log.push(`  [NG] 署名検証失敗`);
      }
    } else {
      // ルート証明書: 信頼されたルートに含まれるか確認
      const trusted = trustedRoots.find(
        (r) => r.subject === cert.subject && r.publicKey.n === cert.publicKey.n,
      );
      if (!trusted) {
        errors.push(`ルート証明書「${cert.subject}」は信頼されていません`);
        log.push(`  [NG] 信頼されたルートCAに含まれていません`);
      } else {
        // 自己署名の検証
        if (verifyCertSignature(cert, cert.publicKey)) {
          log.push(`  [OK] 自己署名検証成功（信頼されたルートCA）`);
        } else {
          errors.push(`ルート証明書「${cert.subject}」の自己署名が無効です`);
          log.push(`  [NG] 自己署名検証失敗`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    log,
  };
}

/** 証明書情報を文字列に変換する */
export function formatCertificate(cert: Certificate): string {
  return [
    `シリアル番号: ${cert.serialNumber}`,
    `サブジェクト: ${cert.subject}`,
    `発行者: ${cert.issuer}`,
    `種類: ${cert.type}`,
    `有効期間: ${cert.validFrom.toISOString().slice(0, 10)} 〜 ${cert.validTo.toISOString().slice(0, 10)}`,
    `公開鍵 (n): ${cert.publicKey.n}`,
    `公開鍵 (e): ${cert.publicKey.e}`,
    `自己署名: ${cert.isSelfSigned ? "はい" : "いいえ"}`,
  ].join("\n");
}

/** シリアル番号カウンターをリセットする（テスト用） */
export function resetSerialCounter(): void {
  serialCounter = 1;
}
