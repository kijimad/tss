/** 仮想SMTPサーバー（MTA）: メール受信、メールボックス管理、ドメイン間リレー */

import { VirtualNetwork } from "../net/network.js";
import {
  type EmailMessage,
  type SmtpResponse,
  type ProtocolLogEntry,
  SmtpResponseCode,
  ProtocolLog,
  extractDomain,
  extractLocalPart,
  createMimeHeaders,
  formatMimeHeaders,
  formatSmtpCommand,
  formatSmtpResponse,
} from "./protocol.js";

/** メールボックス */
export interface Mailbox {
  /** メールボックスの所有者 */
  owner: string;
  /** 受信メール一覧 */
  messages: EmailMessage[];
}

/** SMTPサーバーの設定 */
export interface SmtpServerConfig {
  /** サーバーのホスト名 */
  hostname: string;
  /** 管理するドメイン名 */
  domain: string;
  /** 登録ユーザー一覧 */
  users: string[];
  /** サーバーがビジー状態かどうか */
  busy?: boolean;
}

/** SMTPセッションの状態 */
export type SessionState =
  | "init"
  | "greeted"
  | "mail_from"
  | "rcpt_to"
  | "data"
  | "quit";

/** メール送信の結果 */
export interface SendResult {
  /** 成功したかどうか */
  ok: boolean;
  /** メッセージ */
  message: string;
  /** プロトコルログ */
  log: readonly ProtocolLogEntry[];
}

/** 仮想SMTPサーバー（MTA） */
export class SmtpServer {
  readonly hostname: string;
  readonly domain: string;
  private readonly users: Set<string>;
  private readonly mailboxes: Map<string, Mailbox>;
  private busy: boolean;

  constructor(config: SmtpServerConfig) {
    this.hostname = config.hostname;
    this.domain = config.domain;
    this.users = new Set(config.users);
    this.busy = config.busy ?? false;
    this.mailboxes = new Map();

    // 各ユーザーのメールボックスを初期化
    for (const user of config.users) {
      this.mailboxes.set(user, { owner: user, messages: [] });
    }
  }

  /** ユーザーが存在するか確認する */
  hasUser(username: string): boolean {
    return this.users.has(username);
  }

  /** メールボックスを取得する */
  getMailbox(username: string): Mailbox | undefined {
    return this.mailboxes.get(username);
  }

  /** 全メールボックスを取得する */
  getAllMailboxes(): Map<string, Mailbox> {
    return this.mailboxes;
  }

  /** サーバーのビジー状態を設定する */
  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  /** サーバーがビジー状態か確認する */
  isBusy(): boolean {
    return this.busy;
  }

  /** グリーティング応答を生成する */
  greet(): SmtpResponse {
    if (this.busy) {
      return {
        code: SmtpResponseCode.SERVICE_UNAVAILABLE,
        message: `${this.hostname} サービス一時利用不可`,
      };
    }
    return {
      code: SmtpResponseCode.GREETING,
      message: `${this.hostname} ESMTP 準備完了`,
    };
  }

  /** EHLOコマンドを処理する */
  handleEhlo(clientHostname: string): SmtpResponse {
    if (this.busy) {
      return {
        code: SmtpResponseCode.SERVICE_UNAVAILABLE,
        message: "サービス一時利用不可",
      };
    }
    return {
      code: SmtpResponseCode.OK,
      message: `${this.hostname} こんにちは ${clientHostname}`,
    };
  }

  /** MAIL FROMコマンドを処理する */
  handleMailFrom(sender: string): SmtpResponse {
    if (!sender.includes("@")) {
      return {
        code: SmtpResponseCode.PARAM_SYNTAX_ERROR,
        message: "不正な送信元アドレス",
      };
    }
    return {
      code: SmtpResponseCode.OK,
      message: `送信元 <${sender}> 了解`,
    };
  }

  /** RCPT TOコマンドを処理する */
  handleRcptTo(recipient: string): SmtpResponse {
    const domain = extractDomain(recipient);
    const localPart = extractLocalPart(recipient);

    if (!domain || !localPart) {
      return {
        code: SmtpResponseCode.PARAM_SYNTAX_ERROR,
        message: "不正な宛先アドレス",
      };
    }

    // 自ドメイン宛の場合、ユーザーの存在を確認
    if (domain === this.domain) {
      if (!this.hasUser(localPart)) {
        return {
          code: SmtpResponseCode.USER_NOT_FOUND,
          message: `ユーザー <${recipient}> が見つかりません`,
        };
      }
    }

    return {
      code: SmtpResponseCode.OK,
      message: `宛先 <${recipient}> 了解`,
    };
  }

  /** DATAコマンドを処理する */
  handleData(): SmtpResponse {
    return {
      code: SmtpResponseCode.START_MAIL_INPUT,
      message: "メール入力を開始してください。終了は '.' のみの行で。",
    };
  }

  /** メールデータを受信して保存する */
  receiveMailData(
    from: string,
    to: string,
    subject: string,
    body: string,
  ): SmtpResponse {
    const localPart = extractLocalPart(to);
    const domain = extractDomain(to);

    if (!localPart || !domain) {
      return {
        code: SmtpResponseCode.PARAM_SYNTAX_ERROR,
        message: "不正な宛先アドレス",
      };
    }

    // 自ドメイン宛の場合のみメールボックスに保存
    if (domain === this.domain) {
      const mailbox = this.mailboxes.get(localPart);
      if (!mailbox) {
        return {
          code: SmtpResponseCode.USER_NOT_FOUND,
          message: `ユーザー <${to}> が見つかりません`,
        };
      }

      const headers = createMimeHeaders(from, to, subject);
      const message: EmailMessage = {
        from,
        to,
        subject,
        body,
        headers,
        receivedAt: new Date(),
      };
      mailbox.messages.push(message);
    }

    return {
      code: SmtpResponseCode.OK,
      message: "メールを受信しました",
    };
  }

  /** QUITコマンドを処理する */
  handleQuit(): SmtpResponse {
    return {
      code: SmtpResponseCode.CLOSING,
      message: `${this.hostname} 接続終了`,
    };
  }
}

/** SMTPサーバー群を管理するレジストリ */
export class SmtpServerRegistry {
  private readonly servers: Map<string, SmtpServer> = new Map();
  private readonly network: VirtualNetwork;

  constructor(network: VirtualNetwork) {
    this.network = network;
  }

  /** サーバーを登録する */
  registerServer(server: SmtpServer): void {
    this.servers.set(server.hostname, server);
  }

  /** ホスト名でサーバーを取得する */
  getServer(hostname: string): SmtpServer | undefined {
    return this.servers.get(hostname);
  }

  /** ドメインに対応するサーバーを検索する */
  findServerForDomain(domain: string): SmtpServer | undefined {
    const mxResult = this.network.lookupMx(domain);
    if (!mxResult.ok) {
      return undefined;
    }

    // 優先度順にサーバーを探す
    for (const record of mxResult.records) {
      const server = this.servers.get(record.host);
      if (server && !server.isBusy()) {
        return server;
      }
    }
    return undefined;
  }

  /** 全サーバーを取得する */
  getAllServers(): SmtpServer[] {
    return [...this.servers.values()];
  }

  /** ネットワークを取得する */
  getNetwork(): VirtualNetwork {
    return this.network;
  }
}

/** SMTPクライアント: メール送信のフルフローを実行する */
export class SmtpClient {
  private readonly registry: SmtpServerRegistry;
  private readonly clientHostname: string;

  constructor(registry: SmtpServerRegistry, clientHostname: string = "client.local") {
    this.registry = registry;
    this.clientHostname = clientHostname;
  }

  /** メールを送信する（フルSMTPセッション） */
  sendMail(
    from: string,
    to: string,
    subject: string,
    body: string,
  ): SendResult {
    const log = new ProtocolLog();
    const recipientDomain = extractDomain(to);

    if (!recipientDomain) {
      log.add("C->S", `エラー: 宛先アドレスが不正です: ${to}`);
      return { ok: false, message: "宛先アドレスが不正です", log: log.getEntries() };
    }

    // DNS MXルックアップ
    const network = this.registry.getNetwork();
    const mxResult = network.lookupMx(recipientDomain);
    if (!mxResult.ok) {
      log.add("C->S", `DNS MX検索: ${recipientDomain}`);
      log.add("S->C", `DNS失敗: ${mxResult.error}`);
      return { ok: false, message: mxResult.error, log: log.getEntries() };
    }

    log.add("C->S", `DNS MX検索: ${recipientDomain}`);
    const recordList = mxResult.records.map((r) => `${r.host}(優先度:${r.priority})`).join(", ");
    log.add("S->C", `MXレコード: ${recordList}`);

    // サーバーに接続
    const server = this.registry.findServerForDomain(recipientDomain);
    if (!server) {
      log.add("C->S", "接続試行中...");
      log.add("S->C", "全サーバーが利用不可");
      return { ok: false, message: "メールサーバーに接続できません", log: log.getEntries() };
    }

    // TCP接続
    const socket = network.connect(server.hostname, 25);
    if (socket.state !== "connected") {
      log.add("C->S", `TCP接続: ${server.hostname}:25`);
      log.add("S->C", "TCP接続失敗");
      return { ok: false, message: "TCP接続に失敗しました", log: log.getEntries() };
    }

    log.add("C->S", `TCP接続: ${server.hostname}:25`);
    log.add("S->C", "TCP接続確立");

    // グリーティング
    const greeting = server.greet();
    log.add("S->C", formatSmtpResponse(greeting));
    if (greeting.code !== SmtpResponseCode.GREETING) {
      network.close(socket);
      return { ok: false, message: greeting.message, log: log.getEntries() };
    }

    // EHLO
    const ehloCmd = formatSmtpCommand({ type: "EHLO", argument: this.clientHostname });
    log.add("C->S", ehloCmd);
    const ehloResp = server.handleEhlo(this.clientHostname);
    log.add("S->C", formatSmtpResponse(ehloResp));
    if (ehloResp.code !== SmtpResponseCode.OK) {
      network.close(socket);
      return { ok: false, message: ehloResp.message, log: log.getEntries() };
    }

    // MAIL FROM
    const mailFromCmd = formatSmtpCommand({ type: "MAIL_FROM", argument: from });
    log.add("C->S", mailFromCmd);
    const mailFromResp = server.handleMailFrom(from);
    log.add("S->C", formatSmtpResponse(mailFromResp));
    if (mailFromResp.code !== SmtpResponseCode.OK) {
      network.close(socket);
      return { ok: false, message: mailFromResp.message, log: log.getEntries() };
    }

    // RCPT TO
    const rcptToCmd = formatSmtpCommand({ type: "RCPT_TO", argument: to });
    log.add("C->S", rcptToCmd);
    const rcptToResp = server.handleRcptTo(to);
    log.add("S->C", formatSmtpResponse(rcptToResp));
    if (rcptToResp.code !== SmtpResponseCode.OK) {
      // QUITして切断
      const quitCmd = formatSmtpCommand({ type: "QUIT", argument: "" });
      log.add("C->S", quitCmd);
      const quitResp = server.handleQuit();
      log.add("S->C", formatSmtpResponse(quitResp));
      network.close(socket);
      return { ok: false, message: rcptToResp.message, log: log.getEntries() };
    }

    // DATA
    const dataCmd = formatSmtpCommand({ type: "DATA", argument: "" });
    log.add("C->S", dataCmd);
    const dataResp = server.handleData();
    log.add("S->C", formatSmtpResponse(dataResp));
    if (dataResp.code !== SmtpResponseCode.START_MAIL_INPUT) {
      network.close(socket);
      return { ok: false, message: dataResp.message, log: log.getEntries() };
    }

    // メール本文送信
    const headers = createMimeHeaders(from, to, subject);
    const formattedHeaders = formatMimeHeaders(headers);
    log.add("C->S", formattedHeaders);
    log.add("C->S", "");
    log.add("C->S", body);
    log.add("C->S", ".");

    // メールデータ受信処理
    const receiveResp = server.receiveMailData(from, to, subject, body);
    log.add("S->C", formatSmtpResponse(receiveResp));
    if (receiveResp.code !== SmtpResponseCode.OK) {
      network.close(socket);
      return { ok: false, message: receiveResp.message, log: log.getEntries() };
    }

    // QUIT
    const quitCmd = formatSmtpCommand({ type: "QUIT", argument: "" });
    log.add("C->S", quitCmd);
    const quitResp = server.handleQuit();
    log.add("S->C", formatSmtpResponse(quitResp));

    // 切断
    network.close(socket);

    return { ok: true, message: "メール送信成功", log: log.getEntries() };
  }
}

/** デフォルトの環境を構築する */
export function createDefaultEnvironment(): {
  network: VirtualNetwork;
  registry: SmtpServerRegistry;
  client: SmtpClient;
} {
  const network = new VirtualNetwork();
  const registry = new SmtpServerRegistry(network);

  // example.com のサーバー
  registry.registerServer(
    new SmtpServer({
      hostname: "mx1.example.com",
      domain: "example.com",
      users: ["alice", "bob", "admin"],
    }),
  );
  registry.registerServer(
    new SmtpServer({
      hostname: "mx2.example.com",
      domain: "example.com",
      users: ["alice", "bob", "admin"],
    }),
  );

  // test.org のサーバー
  registry.registerServer(
    new SmtpServer({
      hostname: "mail.test.org",
      domain: "test.org",
      users: ["charlie", "dave"],
    }),
  );

  // corp.local のサーバー
  registry.registerServer(
    new SmtpServer({
      hostname: "smtp.corp.local",
      domain: "corp.local",
      users: ["eve", "frank", "manager"],
    }),
  );
  registry.registerServer(
    new SmtpServer({
      hostname: "smtp-backup.corp.local",
      domain: "corp.local",
      users: ["eve", "frank", "manager"],
    }),
  );

  const client = new SmtpClient(registry);

  return { network, registry, client };
}
