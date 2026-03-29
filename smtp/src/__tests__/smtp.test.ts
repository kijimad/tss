/** SMTPシミュレータのテスト */

import { describe, it, expect, beforeEach } from "vitest";
import {
  VirtualNetwork,
  createDefaultDnsConfig,
} from "../net/network.js";
import {
  SmtpResponseCode,
  ProtocolLog,
  extractDomain,
  extractLocalPart,
  generateMessageId,
  createMimeHeaders,
  formatMimeHeaders,
  formatSmtpCommand,
  formatSmtpResponse,
  parseSmtpResponse,
} from "../smtp/protocol.js";
import {
  SmtpServer,
  SmtpServerRegistry,
  SmtpClient,
  createDefaultEnvironment,
} from "../smtp/server.js";

describe("VirtualNetwork", () => {
  let network: VirtualNetwork;

  beforeEach(() => {
    network = new VirtualNetwork();
  });

  it("DNS MXレコードを正しく検索できる", () => {
    const result = network.lookupMx("example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records.length).toBe(2);
      // 優先度順にソートされている
      expect(result.records[0]?.host).toBe("mx1.example.com");
      expect(result.records[0]?.priority).toBe(10);
    }
  });

  it("存在しないドメインのMXルックアップで失敗する", () => {
    const result = network.lookupMx("nonexistent.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("nonexistent.com");
    }
  });

  it("ホスト名からIPアドレスを解決できる", () => {
    const result = network.resolveIp("mx1.example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ip).toBe("10.0.0.1");
    }
  });

  it("存在しないホストのIP解決で失敗する", () => {
    const result = network.resolveIp("unknown.host");
    expect(result.ok).toBe(false);
  });

  it("TCPソケットの接続・切断が正しく動作する", () => {
    const socket = network.connect("mx1.example.com", 25);
    expect(socket.state).toBe("connected");
    expect(network.getActiveSocketCount()).toBe(1);

    network.close(socket);
    expect(socket.state).toBe("closed");
    expect(network.getActiveSocketCount()).toBe(0);
  });

  it("不明なホストへのTCP接続でエラー状態になる", () => {
    const socket = network.connect("unknown.host", 25);
    expect(socket.state).toBe("error");
  });

  it("MXレコードとAレコードを動的に追加できる", () => {
    network.addMxRecord("newdomain.com", { host: "mail.newdomain.com", priority: 10 });
    network.addARecord("mail.newdomain.com", "192.168.1.1");

    const mxResult = network.lookupMx("newdomain.com");
    expect(mxResult.ok).toBe(true);

    const ipResult = network.resolveIp("mail.newdomain.com");
    expect(ipResult.ok).toBe(true);
    if (ipResult.ok) {
      expect(ipResult.ip).toBe("192.168.1.1");
    }
  });
});

describe("SMTPプロトコル", () => {
  it("メールアドレスからドメインを抽出できる", () => {
    expect(extractDomain("alice@example.com")).toBe("example.com");
    expect(extractDomain("invalid")).toBeUndefined();
  });

  it("メールアドレスからローカル部分を抽出できる", () => {
    expect(extractLocalPart("alice@example.com")).toBe("alice");
  });

  it("Message-IDを正しい形式で生成できる", () => {
    const messageId = generateMessageId("example.com");
    expect(messageId).toMatch(/^<\d+\.\w+@example\.com>$/);
  });

  it("MIMEヘッダーを生成してフォーマットできる", () => {
    const headers = createMimeHeaders("alice@example.com", "bob@test.org", "テスト");
    expect(headers.from).toBe("alice@example.com");
    expect(headers.contentType).toBe("text/plain; charset=UTF-8");

    const formatted = formatMimeHeaders(headers);
    expect(formatted).toContain("From: alice@example.com");
    expect(formatted).toContain("MIME-Version: 1.0");
  });

  it("SMTPコマンドを正しくフォーマットできる", () => {
    expect(formatSmtpCommand({ type: "EHLO", argument: "client.local" })).toBe("EHLO client.local");
    expect(formatSmtpCommand({ type: "MAIL_FROM", argument: "a@b.com" })).toBe("MAIL FROM:<a@b.com>");
    expect(formatSmtpCommand({ type: "RCPT_TO", argument: "c@d.com" })).toBe("RCPT TO:<c@d.com>");
    expect(formatSmtpCommand({ type: "DATA", argument: "" })).toBe("DATA");
    expect(formatSmtpCommand({ type: "QUIT", argument: "" })).toBe("QUIT");
  });

  it("SMTPレスポンスを正しくパースできる", () => {
    const resp = parseSmtpResponse("250 OK");
    expect(resp).toBeDefined();
    expect(resp?.code).toBe(250);
    expect(resp?.message).toBe("OK");
  });

  it("不正なレスポンス文字列のパースでundefinedを返す", () => {
    expect(parseSmtpResponse("invalid")).toBeUndefined();
  });
});

describe("ProtocolLog", () => {
  it("ログエントリを追加・取得・フォーマットできる", () => {
    const log = new ProtocolLog();
    log.add("C->S", "EHLO client.local");
    log.add("S->C", "250 OK");

    expect(log.getEntries().length).toBe(2);
    expect(log.format()).toContain("[C->S] EHLO client.local");
    expect(log.format()).toContain("[S->C] 250 OK");
  });

  it("ログをクリアできる", () => {
    const log = new ProtocolLog();
    log.add("C->S", "test");
    log.clear();
    expect(log.getEntries().length).toBe(0);
  });
});

describe("SmtpServer", () => {
  let server: SmtpServer;

  beforeEach(() => {
    server = new SmtpServer({
      hostname: "mx1.example.com",
      domain: "example.com",
      users: ["alice", "bob"],
    });
  });

  it("グリーティングを正しく返す", () => {
    const resp = server.greet();
    expect(resp.code).toBe(SmtpResponseCode.GREETING);
    expect(resp.message).toContain("mx1.example.com");
  });

  it("ビジー状態のときサービス利用不可を返す", () => {
    server.setBusy(true);
    const resp = server.greet();
    expect(resp.code).toBe(SmtpResponseCode.SERVICE_UNAVAILABLE);
  });

  it("存在しないユーザーへのRCPT TOで550を返す", () => {
    const resp = server.handleRcptTo("unknown@example.com");
    expect(resp.code).toBe(SmtpResponseCode.USER_NOT_FOUND);
  });

  it("存在するユーザーへのRCPT TOで250を返す", () => {
    const resp = server.handleRcptTo("alice@example.com");
    expect(resp.code).toBe(SmtpResponseCode.OK);
  });

  it("メールを受信してメールボックスに保存できる", () => {
    const resp = server.receiveMailData(
      "bob@test.org",
      "alice@example.com",
      "テスト",
      "本文です",
    );
    expect(resp.code).toBe(SmtpResponseCode.OK);

    const mailbox = server.getMailbox("alice");
    expect(mailbox?.messages.length).toBe(1);
    expect(mailbox?.messages[0]?.subject).toBe("テスト");
  });

  it("存在しないユーザーへのメール保存で550を返す", () => {
    const resp = server.receiveMailData(
      "bob@test.org",
      "nobody@example.com",
      "テスト",
      "本文",
    );
    expect(resp.code).toBe(SmtpResponseCode.USER_NOT_FOUND);
  });
});

describe("SmtpClient フルセッション", () => {
  let env: ReturnType<typeof createDefaultEnvironment>;

  beforeEach(() => {
    env = createDefaultEnvironment();
  });

  it("正常なメール送信が成功する", () => {
    const result = env.client.sendMail(
      "alice@example.com",
      "charlie@test.org",
      "こんにちは",
      "テストメールです",
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("成功");

    // プロトコルログにSMTPコマンドが含まれている
    const logMessages = result.log.map((e) => e.message);
    expect(logMessages.some((m) => m.includes("EHLO"))).toBe(true);
    expect(logMessages.some((m) => m.includes("MAIL FROM"))).toBe(true);
    expect(logMessages.some((m) => m.includes("RCPT TO"))).toBe(true);
    expect(logMessages.some((m) => m.includes("DATA"))).toBe(true);
    expect(logMessages.some((m) => m.includes("QUIT"))).toBe(true);
  });

  it("存在しないドメインへの送信でDNS失敗エラーになる", () => {
    const result = env.client.sendMail(
      "alice@example.com",
      "someone@nonexistent.com",
      "テスト",
      "本文",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("DNS");
  });

  it("存在しないユーザーへの送信で550エラーになる", () => {
    const result = env.client.sendMail(
      "alice@example.com",
      "nobody@test.org",
      "テスト",
      "本文",
    );
    expect(result.ok).toBe(false);
    expect(result.log.some((e) => e.message.includes("550"))).toBe(true);
  });

  it("ビジーサーバーへの送信で接続失敗になる", () => {
    // test.orgのサーバーをビジーにする
    const server = env.registry.getServer("mail.test.org");
    expect(server).toBeDefined();
    server!.setBusy(true);

    const result = env.client.sendMail(
      "alice@example.com",
      "charlie@test.org",
      "テスト",
      "本文",
    );
    expect(result.ok).toBe(false);
  });

  it("メールが宛先のメールボックスに保存される", () => {
    env.client.sendMail(
      "bob@example.com",
      "eve@corp.local",
      "会議の件",
      "明日の会議について",
    );

    const server = env.registry.getServer("smtp.corp.local");
    const mailbox = server?.getMailbox("eve");
    expect(mailbox?.messages.length).toBe(1);
    expect(mailbox?.messages[0]?.subject).toBe("会議の件");
    expect(mailbox?.messages[0]?.body).toBe("明日の会議について");
  });

  it("不正な宛先アドレスでエラーになる", () => {
    const result = env.client.sendMail(
      "alice@example.com",
      "invalid-address",
      "テスト",
      "本文",
    );
    expect(result.ok).toBe(false);
  });

  it("複数のメールを同じメールボックスに送信できる", () => {
    env.client.sendMail("a@example.com", "charlie@test.org", "件名1", "本文1");
    env.client.sendMail("b@example.com", "charlie@test.org", "件名2", "本文2");

    const server = env.registry.getServer("mail.test.org");
    const mailbox = server?.getMailbox("charlie");
    expect(mailbox?.messages.length).toBe(2);
  });

  it("プロトコルログにMIMEヘッダーが含まれる", () => {
    const result = env.client.sendMail(
      "alice@example.com",
      "charlie@test.org",
      "テスト",
      "本文",
    );
    const logMessages = result.log.map((e) => e.message);
    expect(logMessages.some((m) => m.includes("Content-Type"))).toBe(true);
    expect(logMessages.some((m) => m.includes("MIME-Version"))).toBe(true);
  });
});

describe("SmtpServerRegistry", () => {
  it("ドメインに対応するサーバーを検索できる", () => {
    const env = createDefaultEnvironment();
    const server = env.registry.findServerForDomain("example.com");
    expect(server).toBeDefined();
    expect(server?.domain).toBe("example.com");
  });

  it("存在しないドメインの検索でundefinedを返す", () => {
    const env = createDefaultEnvironment();
    const server = env.registry.findServerForDomain("nonexistent.com");
    expect(server).toBeUndefined();
  });

  it("ビジーなプライマリサーバーをスキップしてバックアップを返す", () => {
    const env = createDefaultEnvironment();
    // corp.localのプライマリをビジーにする
    const primary = env.registry.getServer("smtp.corp.local");
    primary!.setBusy(true);

    const server = env.registry.findServerForDomain("corp.local");
    expect(server).toBeDefined();
    expect(server?.hostname).toBe("smtp-backup.corp.local");
  });
});

describe("createDefaultDnsConfig", () => {
  it("3つのドメインのMXレコードが設定されている", () => {
    const config = createDefaultDnsConfig();
    expect(config.mxRecords.has("example.com")).toBe(true);
    expect(config.mxRecords.has("test.org")).toBe(true);
    expect(config.mxRecords.has("corp.local")).toBe(true);
  });
});
