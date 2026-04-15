/**
 * SMTPプロトコル定義: コマンド、レスポンスコード、MIMEヘッダー、メールメッセージ構造
 *
 * SMTP（Simple Mail Transfer Protocol）はメール送信に使われるテキストベースのプロトコル。
 * RFC 5321で定義され、クライアント（MUA/MSA）とサーバー（MTA）間のコマンド/レスポンス方式で動作する。
 *
 * 基本的なSMTPセッションの流れ:
 *   1. TCP接続確立後、サーバーが220グリーティングを返す
 *   2. クライアントがEHLO（またはHELO）で自己紹介する
 *   3. MAIL FROM:<送信者> で送信元（エンベロープFrom）を指定
 *   4. RCPT TO:<宛先> で宛先（エンベロープTo）を指定
 *   5. DATAコマンドでメール本文の送信を開始（354応答後）
 *   6. MIMEヘッダー + 空行 + 本文 を送信し、"." 単独行で終了
 *   7. QUITで接続を終了（221応答）
 *
 * セキュリティ拡張:
 *   - STARTTLS: 平文接続をTLS暗号化にアップグレード
 *   - SPF: 送信元IPアドレスがドメインに許可されているか検証
 *   - DKIM: メールに電子署名を付与し改ざんを検出
 *   - DMARC: SPFとDKIMの結果に基づくポリシー制御
 *   （本シミュレータではセキュリティ拡張は未実装）
 */

/**
 * SMTPレスポンスコード定数
 *
 * SMTPでは3桁の数字コードで応答状態を示す（RFC 5321 Section 4.2）。
 * - 2xx: 成功（コマンドが正常に処理された）
 * - 3xx: 中間応答（追加データの入力を待機中）
 * - 4xx: 一時的エラー（再試行で成功する可能性がある）
 * - 5xx: 永続的エラー（再試行しても失敗する）
 */
export const SmtpResponseCode = {
  /** 220: サービス準備完了。TCP接続直後にサーバーが返すグリーティング */
  GREETING: 220,
  /** 221: サービス終了。QUITコマンドへの応答として接続を閉鎖する */
  CLOSING: 221,
  /** 250: 要求されたアクション完了。EHLO, MAIL FROM, RCPT TO等の成功応答 */
  OK: 250,
  /** 354: メール入力開始。DATAコマンドへの応答。"."単独行まで入力を受け付ける */
  START_MAIL_INPUT: 354,
  /** 421: サービス一時利用不可。サーバー過負荷や保守中の場合に返される */
  SERVICE_UNAVAILABLE: 421,
  /** 450: メールボックス利用不可（一時的）。後で再試行すると成功する可能性がある */
  MAILBOX_UNAVAILABLE_TEMP: 450,
  /** 451: 要求されたアクション中止。サーバー側の内部エラー */
  ACTION_ABORTED: 451,
  /** 500: コマンド構文エラー。認識できないコマンドが送信された */
  SYNTAX_ERROR: 500,
  /** 501: パラメータ構文エラー。コマンドの引数が不正 */
  PARAM_SYNTAX_ERROR: 501,
  /** 502: コマンド未実装。サーバーがサポートしていないコマンド */
  NOT_IMPLEMENTED: 502,
  /** 503: コマンド順序エラー。例: EHLOの前にMAIL FROMを送信した場合 */
  BAD_SEQUENCE: 503,
  /** 550: メールボックス利用不可（永続的）。宛先ユーザーが存在しない */
  USER_NOT_FOUND: 550,
} as const;

/** SMTPレスポンスコードの値の型（SmtpResponseCodeオブジェクトの値のユニオン型） */
export type SmtpResponseCodeValue = (typeof SmtpResponseCode)[keyof typeof SmtpResponseCode];

/**
 * SMTPレスポンス
 * サーバーからクライアントへ返される応答。「コード + 空白 + メッセージ」の形式。
 * 例: "250 OK", "550 User not found"
 */
export interface SmtpResponse {
  /** 3桁の数字レスポンスコード */
  code: SmtpResponseCodeValue;
  /** 人間が読めるレスポンスメッセージ */
  message: string;
}

/**
 * SMTPコマンドの種類
 *
 * - EHLO: Extended HELLO。クライアントがサーバーに自己紹介し、拡張機能を問い合わせる
 *         （旧HELOの拡張版。ESMTPで使用）
 * - MAIL_FROM: 送信元（エンベロープFrom）アドレスを指定する。バウンスメールの返送先にもなる
 * - RCPT_TO: 宛先（エンベロープTo）アドレスを指定する。複数回実行可能
 * - DATA: メール本文の送信開始を宣言する。354応答後にMIMEヘッダーと本文を送信
 * - QUIT: SMTPセッションを終了し、TCP接続を閉じる
 */
export type SmtpCommandType = "EHLO" | "MAIL_FROM" | "RCPT_TO" | "DATA" | "QUIT";

/**
 * SMTPコマンド
 * クライアントからサーバーへ送信されるコマンド。
 * コマンドの種類と引数（アドレスやホスト名）のペア。
 */
export interface SmtpCommand {
  /** コマンドの種類 */
  type: SmtpCommandType;
  /** コマンドの引数（例: EHLOではクライアントホスト名、MAIL FROMでは送信元アドレス） */
  argument: string;
}

/**
 * MIME（Multipurpose Internet Mail Extensions）ヘッダー
 *
 * MIMEはメールの構造を定義する規格（RFC 2045-2049）。
 * ヘッダーにはメールのメタ情報（送信者、宛先、件名、日付、エンコーディング等）が含まれる。
 * メール本文とはCRLF空行で区切られる。
 * 添付ファイルがある場合はContent-Typeにmultipart/mixedを指定し、
 * boundary文字列でパートを区切る（本シミュレータではtext/plainのみ対応）。
 */
export interface MimeHeaders {
  /** From: 送信者のメールアドレス（ヘッダーFrom。エンベロープFromとは異なる場合がある） */
  from: string;
  /** To: 宛先のメールアドレス */
  to: string;
  /** Subject: メールの件名 */
  subject: string;
  /** Date: メール送信日時（RFC 2822形式） */
  date: string;
  /** Message-ID: メールを一意に識別するID（"<タイムスタンプ.ランダム@ドメイン>"形式） */
  messageId: string;
  /** Content-Type: 本文のメディアタイプと文字エンコーディング（例: "text/plain; charset=UTF-8"） */
  contentType: string;
}

/**
 * メールメッセージ
 * SMTPで配送されるメールの完全な表現。
 * エンベロープ情報（from/to）、件名、本文、MIMEヘッダー、受信日時を保持する。
 */
export interface EmailMessage {
  /** 送信元メールアドレス（エンベロープFrom） */
  from: string;
  /** 宛先メールアドレス（エンベロープTo） */
  to: string;
  /** 件名（Subject） */
  subject: string;
  /** メール本文（プレーンテキスト） */
  body: string;
  /** MIMEヘッダー（メールのメタ情報） */
  headers: MimeHeaders;
  /** サーバーがメールを受信した日時 */
  receivedAt: Date;
}

/**
 * メールアドレスからドメイン部分（@の右側）を抽出する
 * 例: "alice@example.com" → "example.com"
 * MXレコード検索でメール配送先ドメインを特定するために使用する
 */
export function extractDomain(email: string): string | undefined {
  const parts = email.split("@");
  return parts[1];
}

/**
 * メールアドレスからローカル部分（@の左側、ユーザー名）を抽出する
 * 例: "alice@example.com" → "alice"
 * 宛先サーバーでメールボックスの特定に使用する
 */
export function extractLocalPart(email: string): string | undefined {
  const parts = email.split("@");
  return parts[0];
}

/**
 * ユニークなMessage-IDを生成する
 *
 * Message-IDはメールを世界中で一意に識別するためのヘッダー（RFC 2822）。
 * 形式: <タイムスタンプ.ランダム文字列@ドメイン>
 * メーリングリストやメールスレッドの追跡、重複配送の検出に使われる。
 */
export function generateMessageId(domain: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `<${timestamp}.${random}@${domain}>`;
}

/**
 * MIMEヘッダーを生成する
 *
 * 送信者・宛先・件名からメール配送に必要なMIMEヘッダーセットを組み立てる。
 * Content-Typeはtext/plain; charset=UTF-8固定（添付ファイル非対応）。
 * Message-IDは送信元ドメインをベースに自動生成される。
 */
export function createMimeHeaders(
  from: string,
  to: string,
  subject: string,
): MimeHeaders {
  const domain = extractDomain(from) ?? "unknown";
  return {
    from,
    to,
    subject,
    date: new Date().toUTCString(),
    messageId: generateMessageId(domain),
    contentType: "text/plain; charset=UTF-8",
  };
}

/**
 * MIMEヘッダーを RFC 2822準拠の文字列にフォーマットする
 *
 * 各ヘッダーは「フィールド名: 値」の形式でCRLF（\r\n）で区切られる。
 * MIME-Version: 1.0 はMIME対応を示す必須ヘッダー。
 * DATAコマンド後に送信され、空行（CRLF CRLF）を挟んでメール本文が続く。
 */
export function formatMimeHeaders(headers: MimeHeaders): string {
  return [
    `From: ${headers.from}`,
    `To: ${headers.to}`,
    `Subject: ${headers.subject}`,
    `Date: ${headers.date}`,
    `Message-ID: ${headers.messageId}`,
    `Content-Type: ${headers.contentType}`,
    `MIME-Version: 1.0`,
  ].join("\r\n");
}

/**
 * SMTPコマンドをワイヤフォーマット（実際に送信される文字列形式）に変換する
 *
 * SMTPコマンドの書式（RFC 5321）:
 * - EHLO hostname     （拡張挨拶。ESMTPの機能ネゴシエーション）
 * - MAIL FROM:<addr>  （送信元アドレスをアングルブラケットで囲む）
 * - RCPT TO:<addr>    （宛先アドレスをアングルブラケットで囲む）
 * - DATA              （引数なし。メール本文入力モードへ遷移）
 * - QUIT              （引数なし。セッション終了）
 */
export function formatSmtpCommand(command: SmtpCommand): string {
  switch (command.type) {
    case "EHLO":
      return `EHLO ${command.argument}`;
    case "MAIL_FROM":
      return `MAIL FROM:<${command.argument}>`;
    case "RCPT_TO":
      return `RCPT TO:<${command.argument}>`;
    case "DATA":
      return "DATA";
    case "QUIT":
      return "QUIT";
  }
}

/**
 * SMTPレスポンスを「コード 空白 メッセージ」のワイヤフォーマットに変換する
 * 例: { code: 250, message: "OK" } → "250 OK"
 */
export function formatSmtpResponse(response: SmtpResponse): string {
  return `${response.code} ${response.message}`;
}

/**
 * SMTPレスポンスの文字列をパースしてSmtpResponseオブジェクトに変換する
 *
 * 受信したテキスト行から3桁のレスポンスコードとメッセージ部分を分離する。
 * 形式が不正な場合はundefinedを返す。
 * 例: "250 OK" → { code: 250, message: "OK" }
 */
export function parseSmtpResponse(raw: string): SmtpResponse | undefined {
  // 先頭3桁の数字 + 空白 + 残りのメッセージ文字列にマッチ
  const match = raw.match(/^(\d{3})\s+(.+)$/);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]) as SmtpResponseCodeValue;
  const message = match[2] ?? "";
  return { code, message };
}

/** プロトコルログのエントリ */
export interface ProtocolLogEntry {
  /** 方向: クライアント→サーバー or サーバー→クライアント */
  direction: "C->S" | "S->C";
  /** メッセージ内容 */
  message: string;
  /** タイムスタンプ */
  timestamp: Date;
}

/** プロトコルログを管理するクラス */
export class ProtocolLog {
  private readonly entries: ProtocolLogEntry[] = [];

  /** ログエントリを追加する */
  add(direction: "C->S" | "S->C", message: string): void {
    this.entries.push({
      direction,
      message,
      timestamp: new Date(),
    });
  }

  /** 全エントリを取得する */
  getEntries(): readonly ProtocolLogEntry[] {
    return this.entries;
  }

  /** ログをクリアする */
  clear(): void {
    this.entries.length = 0;
  }

  /** ログを文字列にフォーマットする */
  format(): string {
    return this.entries
      .map((e) => `[${e.direction}] ${e.message}`)
      .join("\n");
  }
}
