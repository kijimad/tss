/** SMTPプロトコル: コマンド、レスポンスコード、MIMEヘッダー、メールメッセージ構造 */

/** SMTPレスポンスコード */
export const SmtpResponseCode = {
  /** サービス準備完了 */
  GREETING: 220,
  /** サービス終了（接続閉鎖） */
  CLOSING: 221,
  /** 要求されたアクション完了 */
  OK: 250,
  /** メール入力開始 */
  START_MAIL_INPUT: 354,
  /** サービス利用不可 */
  SERVICE_UNAVAILABLE: 421,
  /** メールボックス利用不可（一時的） */
  MAILBOX_UNAVAILABLE_TEMP: 450,
  /** 要求されたアクション中止 */
  ACTION_ABORTED: 451,
  /** コマンド構文エラー */
  SYNTAX_ERROR: 500,
  /** パラメータ構文エラー */
  PARAM_SYNTAX_ERROR: 501,
  /** コマンド未実装 */
  NOT_IMPLEMENTED: 502,
  /** コマンド順序エラー */
  BAD_SEQUENCE: 503,
  /** メールボックス利用不可（永久的：ユーザー不明） */
  USER_NOT_FOUND: 550,
} as const;

export type SmtpResponseCodeValue = (typeof SmtpResponseCode)[keyof typeof SmtpResponseCode];

/** SMTPレスポンス */
export interface SmtpResponse {
  /** レスポンスコード */
  code: SmtpResponseCodeValue;
  /** レスポンスメッセージ */
  message: string;
}

/** SMTPコマンドの種類 */
export type SmtpCommandType = "EHLO" | "MAIL_FROM" | "RCPT_TO" | "DATA" | "QUIT";

/** SMTPコマンド */
export interface SmtpCommand {
  /** コマンドの種類 */
  type: SmtpCommandType;
  /** コマンドの引数 */
  argument: string;
}

/** MIMEヘッダー */
export interface MimeHeaders {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  contentType: string;
}

/** メールメッセージ */
export interface EmailMessage {
  /** 送信元アドレス */
  from: string;
  /** 宛先アドレス */
  to: string;
  /** 件名 */
  subject: string;
  /** 本文 */
  body: string;
  /** MIMEヘッダー */
  headers: MimeHeaders;
  /** 受信日時 */
  receivedAt: Date;
}

/** メールアドレスからドメイン部分を抽出する */
export function extractDomain(email: string): string | undefined {
  const parts = email.split("@");
  return parts[1];
}

/** メールアドレスからローカル部分（ユーザー名）を抽出する */
export function extractLocalPart(email: string): string | undefined {
  const parts = email.split("@");
  return parts[0];
}

/** ユニークなMessage-IDを生成する */
export function generateMessageId(domain: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `<${timestamp}.${random}@${domain}>`;
}

/** MIMEヘッダーを生成する */
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

/** MIMEヘッダーを文字列にフォーマットする */
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

/** SMTPコマンドを文字列にフォーマットする */
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

/** SMTPレスポンスを文字列にフォーマットする */
export function formatSmtpResponse(response: SmtpResponse): string {
  return `${response.code} ${response.message}`;
}

/** SMTPレスポンス文字列をパースする */
export function parseSmtpResponse(raw: string): SmtpResponse | undefined {
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
