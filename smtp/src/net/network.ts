/**
 * 仮想ネットワーク層: DNS MXレコード解決、TCPソケットシミュレーション、IPアドレス管理
 *
 * SMTPにおけるメール配送では、まず宛先ドメインのMX（Mail Exchange）レコードを
 * DNSに問い合わせて、メールを受け付けるサーバーのホスト名と優先度を取得する。
 * 次にそのホスト名をAレコードでIPアドレスに解決し、TCP接続を確立する。
 *
 * このモジュールは上記のDNS解決とTCP接続を仮想的にエミュレートする。
 * 実際のネットワーク通信は行わず、メモリ上のデータ構造で動作する。
 */

/**
 * MX（Mail Exchange）レコードの型定義
 *
 * MXレコードはDNSレコードの一種で、あるドメイン宛のメールを受信する
 * メールサーバー（MTA: Mail Transfer Agent）のホスト名と優先度を示す。
 * 例: example.com の MXレコードが mx1.example.com (優先度10) の場合、
 * @example.com 宛のメールは mx1.example.com に配送される。
 */
export interface MxRecord {
  /** メールサーバーのホスト名（例: mx1.example.com） */
  host: string;
  /** 優先度（preference値）。値が小さいほど優先的に使用される（RFC 5321準拠） */
  priority: number;
}

/**
 * DNS MXレコードルックアップの結果型
 * 成功時はMXレコードの配列を、失敗時はエラーメッセージを返す（判別共用体パターン）
 */
export type DnsLookupResult =
  | { ok: true; records: MxRecord[] }
  | { ok: false; error: string };

/**
 * ホスト名からIPアドレスへの解決（Aレコード問い合わせ）結果型
 * MXレコードで得たホスト名を実際のIPアドレスに変換するために使用する
 */
export type IpResolveResult =
  | { ok: true; ip: string }
  | { ok: false; error: string };

/**
 * 仮想TCPソケットの接続状態
 * SMTPはTCP上のプロトコルであり、通常はポート25（平文）または587（STARTTLS / Submission）で接続する。
 * - closed: ソケットが閉じた状態
 * - connecting: 接続処理中（本シミュレータでは即座にconnectedに遷移）
 * - connected: 接続確立済み。SMTPコマンドの送受信が可能
 * - error: DNS解決失敗やタイムアウトなどで接続に失敗した状態
 */
export type SocketState = "closed" | "connecting" | "connected" | "error";

/**
 * TCPソケット上で送受信されるデータ単位
 * SMTPではテキストベースのコマンドとレスポンスがやりとりされる
 */
export interface SocketData {
  /** 送信元の識別子（"client" または "server"） */
  from: string;
  /** 送受信されるテキストデータ（SMTPコマンドやレスポンス文字列） */
  payload: string;
}

/**
 * 仮想TCPソケット
 *
 * 実際のTCPソケットをエミュレートするデータ構造。
 * SMTPクライアントはこのソケットを通じてサーバーとコマンド/レスポンスをやりとりする。
 * 受信バッファはFIFO（先入れ先出し）キューとして動作し、
 * サーバーからの応答を順番に取り出せる。
 */
export interface VirtualSocket {
  /** ソケットの現在の接続状態 */
  state: SocketState;
  /** 接続先メールサーバーのホスト名（例: mx1.example.com） */
  remoteHost: string;
  /** 接続先ポート番号（SMTPは通常25番ポート、Submissionは587番ポート） */
  remotePort: number;
  /** サーバーからの応答を格納する受信バッファ（FIFO） */
  receiveBuffer: string[];
  /** クライアントが送信したデータの履歴ログ */
  sendLog: SocketData[];
}

/**
 * 仮想DNS設定
 *
 * 実際のDNSサーバーの代わりに、メモリ上のMapでDNSレコードを管理する。
 * MXレコード: ドメイン名 → メールサーバー一覧（メール配送先の決定に使用）
 * Aレコード: ホスト名 → IPアドレス（TCP接続先の特定に使用）
 */
export interface DnsConfig {
  /** ドメイン名からMXレコード配列へのマッピング（例: "example.com" → [{host: "mx1.example.com", priority: 10}]） */
  mxRecords: Map<string, MxRecord[]>;
  /** ホスト名からIPv4アドレスへのマッピング（例: "mx1.example.com" → "10.0.0.1"） */
  aRecords: Map<string, string>;
}

/**
 * デフォルトのDNS設定を生成する
 *
 * シミュレーション用に3つのドメインのDNSレコードを事前定義する。
 * 各ドメインにはMXレコード（メールサーバー一覧）と対応するAレコード（IPアドレス）を設定。
 *
 * - example.com: プライマリ(mx1, 優先度10)とセカンダリ(mx2, 優先度20)の2台構成
 * - test.org: メールサーバー1台のシンプル構成
 * - corp.local: プライマリ(優先度5)とバックアップ(優先度15)の冗長構成
 *
 * MXレコードの優先度は小さい値ほど高優先。プライマリが応答しない場合、
 * 次に優先度の高いサーバーにフォールバックする（SMTPリレーの標準動作）。
 */
export function createDefaultDnsConfig(): DnsConfig {
  const mxRecords = new Map<string, MxRecord[]>();
  const aRecords = new Map<string, string>();

  // example.com: 2台のMXサーバー構成（プライマリ mx1 + セカンダリ mx2）
  mxRecords.set("example.com", [
    { host: "mx1.example.com", priority: 10 },
    { host: "mx2.example.com", priority: 20 },
  ]);
  aRecords.set("mx1.example.com", "10.0.0.1");
  aRecords.set("mx2.example.com", "10.0.0.2");

  // test.org: 単一MXサーバー構成
  mxRecords.set("test.org", [
    { host: "mail.test.org", priority: 10 },
  ]);
  aRecords.set("mail.test.org", "10.0.1.1");

  // corp.local: プライマリ + バックアップの冗長構成（企業向け想定）
  mxRecords.set("corp.local", [
    { host: "smtp.corp.local", priority: 5 },
    { host: "smtp-backup.corp.local", priority: 15 },
  ]);
  aRecords.set("smtp.corp.local", "10.0.2.1");
  aRecords.set("smtp-backup.corp.local", "10.0.2.2");

  return { mxRecords, aRecords };
}

/**
 * 仮想ネットワーク
 *
 * DNS解決とTCPソケット接続をエミュレートするクラス。
 * SMTPメール配送の流れ:
 *   1. 宛先ドメインのMXレコードをDNSに問い合わせ（lookupMx）
 *   2. MXレコードのホスト名をIPアドレスに解決（resolveIp）
 *   3. 解決したIPアドレスのポート25にTCP接続（connect）
 *   4. 確立したソケット上でSMTPプロトコルのやりとりを行う
 *
 * 実際のネットワーク通信は行わず、全てメモリ上のデータ構造で完結する。
 */
export class VirtualNetwork {
  /** DNS設定（MXレコードとAレコードの保持） */
  private readonly dns: DnsConfig;
  /** 現在アクティブな（接続中の）ソケット一覧 */
  private readonly activeSockets: VirtualSocket[] = [];

  constructor(dnsConfig?: DnsConfig) {
    this.dns = dnsConfig ?? createDefaultDnsConfig();
  }

  /**
   * DNS MXレコードを検索する
   *
   * 指定ドメイン宛のメールを受け付けるサーバー一覧を取得する。
   * 結果は優先度（priority）の昇順にソートされる。
   * SMTPクライアントは優先度の高い（数値が小さい）サーバーから順に接続を試みる。
   */
  lookupMx(domain: string): DnsLookupResult {
    const records = this.dns.mxRecords.get(domain);
    if (!records) {
      return { ok: false, error: `DNS解決失敗: ドメイン '${domain}' のMXレコードが見つかりません` };
    }
    // 優先度の昇順（低い値＝高い優先度）でソートして返す
    const sorted = [...records].sort((a, b) => a.priority - b.priority);
    return { ok: true, records: sorted };
  }

  /**
   * ホスト名からIPアドレスを解決する（Aレコード問い合わせ）
   *
   * MXレコードで得られたホスト名を、実際に接続可能なIPアドレスに変換する。
   * 実環境ではDNSリゾルバが再帰的に名前解決を行うが、ここではMapの単純参照で代用する。
   */
  resolveIp(hostname: string): IpResolveResult {
    const ip = this.dns.aRecords.get(hostname);
    if (!ip) {
      return { ok: false, error: `DNS解決失敗: ホスト '${hostname}' のAレコードが見つかりません` };
    }
    return { ok: true, ip };
  }

  /**
   * MXレコードを動的に追加する
   * 既存ドメインに追加する場合は既存のレコード配列に追記される
   */
  addMxRecord(domain: string, record: MxRecord): void {
    const existing = this.dns.mxRecords.get(domain);
    if (existing) {
      existing.push(record);
    } else {
      this.dns.mxRecords.set(domain, [record]);
    }
  }

  /** Aレコード（ホスト名→IPアドレス）を動的に追加する */
  addARecord(hostname: string, ip: string): void {
    this.dns.aRecords.set(hostname, ip);
  }

  /**
   * 仮想TCPソケットを作成してリモートホストに接続する
   *
   * SMTPでは通常ポート25（MTA間通信）または587（メール送信/Submission）を使用する。
   * 接続前にホスト名のAレコード解決を行い、解決できない場合はエラー状態のソケットを返す。
   * 接続成功時はアクティブソケット一覧に登録する。
   */
  connect(host: string, port: number): VirtualSocket {
    // まずホスト名をIPアドレスに解決する
    const ipResult = this.resolveIp(host);
    if (!ipResult.ok) {
      // DNS解決失敗: エラー状態のソケットを返す
      const socket: VirtualSocket = {
        state: "error",
        remoteHost: host,
        remotePort: port,
        receiveBuffer: [],
        sendLog: [],
      };
      return socket;
    }

    // DNS解決成功: 接続済み状態のソケットを生成
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

  /**
   * ソケット経由でデータを送信する
   * 接続済みソケットでのみ送信可能。送信内容はsendLogに記録される。
   */
  send(socket: VirtualSocket, data: string): boolean {
    if (socket.state !== "connected") {
      return false;
    }
    socket.sendLog.push({ from: "client", payload: data });
    return true;
  }

  /**
   * ソケットの受信バッファにデータを追加する（サーバー応答のシミュレーション用）
   * 実際のネットワークではサーバーがTCPストリームにデータを書き込むが、
   * ここでは受信バッファに直接プッシュして代用する。
   */
  pushToReceiveBuffer(socket: VirtualSocket, data: string): void {
    socket.receiveBuffer.push(data);
  }

  /**
   * ソケットの受信バッファからデータを取得する（FIFO）
   * バッファが空の場合はundefinedを返す
   */
  receive(socket: VirtualSocket): string | undefined {
    return socket.receiveBuffer.shift();
  }

  /**
   * ソケットを閉じる
   * SMTPセッション終了時（QUITコマンド後）にTCP接続を切断する。
   * アクティブソケット一覧からも除去される。
   */
  close(socket: VirtualSocket): void {
    socket.state = "closed";
    const index = this.activeSockets.indexOf(socket);
    if (index >= 0) {
      this.activeSockets.splice(index, 1);
    }
  }

  /** 現在アクティブな（接続中の）ソケット数を返す */
  getActiveSocketCount(): number {
    return this.activeSockets.length;
  }
}
