/** 仮想ネットワーク: DNS MXレコード、TCPソケットシミュレーション、IPアドレス管理 */

/** MXレコードの型定義 */
export interface MxRecord {
  /** メールサーバーのホスト名 */
  host: string;
  /** 優先度（小さいほど優先） */
  priority: number;
}

/** DNSルックアップ結果 */
export type DnsLookupResult =
  | { ok: true; records: MxRecord[] }
  | { ok: false; error: string };

/** IPアドレス解決結果 */
export type IpResolveResult =
  | { ok: true; ip: string }
  | { ok: false; error: string };

/** TCPソケットの状態 */
export type SocketState = "closed" | "connecting" | "connected" | "error";

/** TCPソケットで送受信されるデータ */
export interface SocketData {
  /** 送信元 */
  from: string;
  /** データ本体 */
  payload: string;
}

/** 仮想TCPソケット */
export interface VirtualSocket {
  /** ソケットの現在の状態 */
  state: SocketState;
  /** 接続先ホスト名 */
  remoteHost: string;
  /** 接続先ポート番号 */
  remotePort: number;
  /** 受信バッファ */
  receiveBuffer: string[];
  /** 送信ログ */
  sendLog: SocketData[];
}

/** 仮想DNS設定 */
export interface DnsConfig {
  /** ドメイン名からMXレコードへのマッピング */
  mxRecords: Map<string, MxRecord[]>;
  /** ホスト名からIPアドレスへのマッピング */
  aRecords: Map<string, string>;
}

/** デフォルトのDNS設定を生成する */
export function createDefaultDnsConfig(): DnsConfig {
  const mxRecords = new Map<string, MxRecord[]>();
  const aRecords = new Map<string, string>();

  // example.com のMXレコード
  mxRecords.set("example.com", [
    { host: "mx1.example.com", priority: 10 },
    { host: "mx2.example.com", priority: 20 },
  ]);
  aRecords.set("mx1.example.com", "10.0.0.1");
  aRecords.set("mx2.example.com", "10.0.0.2");

  // test.org のMXレコード
  mxRecords.set("test.org", [
    { host: "mail.test.org", priority: 10 },
  ]);
  aRecords.set("mail.test.org", "10.0.1.1");

  // corp.local のMXレコード
  mxRecords.set("corp.local", [
    { host: "smtp.corp.local", priority: 5 },
    { host: "smtp-backup.corp.local", priority: 15 },
  ]);
  aRecords.set("smtp.corp.local", "10.0.2.1");
  aRecords.set("smtp-backup.corp.local", "10.0.2.2");

  return { mxRecords, aRecords };
}

/** 仮想ネットワーク */
export class VirtualNetwork {
  private readonly dns: DnsConfig;
  private readonly activeSockets: VirtualSocket[] = [];

  constructor(dnsConfig?: DnsConfig) {
    this.dns = dnsConfig ?? createDefaultDnsConfig();
  }

  /** DNS MXレコードを検索する */
  lookupMx(domain: string): DnsLookupResult {
    const records = this.dns.mxRecords.get(domain);
    if (!records) {
      return { ok: false, error: `DNS解決失敗: ドメイン '${domain}' のMXレコードが見つかりません` };
    }
    // 優先度順にソートして返す
    const sorted = [...records].sort((a, b) => a.priority - b.priority);
    return { ok: true, records: sorted };
  }

  /** ホスト名からIPアドレスを解決する */
  resolveIp(hostname: string): IpResolveResult {
    const ip = this.dns.aRecords.get(hostname);
    if (!ip) {
      return { ok: false, error: `DNS解決失敗: ホスト '${hostname}' のAレコードが見つかりません` };
    }
    return { ok: true, ip };
  }

  /** MXレコードを追加する */
  addMxRecord(domain: string, record: MxRecord): void {
    const existing = this.dns.mxRecords.get(domain);
    if (existing) {
      existing.push(record);
    } else {
      this.dns.mxRecords.set(domain, [record]);
    }
  }

  /** Aレコードを追加する */
  addARecord(hostname: string, ip: string): void {
    this.dns.aRecords.set(hostname, ip);
  }

  /** 仮想TCPソケットを作成して接続する */
  connect(host: string, port: number): VirtualSocket {
    const ipResult = this.resolveIp(host);
    if (!ipResult.ok) {
      const socket: VirtualSocket = {
        state: "error",
        remoteHost: host,
        remotePort: port,
        receiveBuffer: [],
        sendLog: [],
      };
      return socket;
    }

    const socket: VirtualSocket = {
      state: "connected",
      remoteHost: host,
      remotePort: port,
      receiveBuffer: [],
      sendLog: [],
    };
    this.activeSockets.push(socket);
    return socket;
  }

  /** ソケット経由でデータを送信する */
  send(socket: VirtualSocket, data: string): boolean {
    if (socket.state !== "connected") {
      return false;
    }
    socket.sendLog.push({ from: "client", payload: data });
    return true;
  }

  /** ソケットの受信バッファにデータを追加する（サーバー応答のシミュレーション用） */
  pushToReceiveBuffer(socket: VirtualSocket, data: string): void {
    socket.receiveBuffer.push(data);
  }

  /** ソケットの受信バッファからデータを取得する */
  receive(socket: VirtualSocket): string | undefined {
    return socket.receiveBuffer.shift();
  }

  /** ソケットを閉じる */
  close(socket: VirtualSocket): void {
    socket.state = "closed";
    const index = this.activeSockets.indexOf(socket);
    if (index >= 0) {
      this.activeSockets.splice(index, 1);
    }
  }

  /** アクティブなソケット数を返す */
  getActiveSocketCount(): number {
    return this.activeSockets.length;
  }
}
