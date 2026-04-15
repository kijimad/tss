/**
 * ssh.ts -- SSH プロトコルの実装
 *
 * SSH 接続の流れ:
 *
 *   Client                              Server
 *     |                                    |
 *     |--- SSH-2.0-client banner --------->|  1. バージョン交換
 *     |<-- SSH-2.0-server banner ---------|
 *     |                                    |
 *     |--- DH key exchange init ---------->|  2. 鍵交換 (Diffie-Hellman)
 *     |<-- DH key exchange reply ----------|     → 共有秘密を生成
 *     |                                    |
 *     |=== 以降、暗号化チャネル ===========|  3. 暗号化開始
 *     |                                    |
 *     |--- userauth request (password) --->|  4. ユーザ認証
 *     |<-- userauth success/failure -------|
 *     |                                    |
 *     |--- channel open (session) -------->|  5. セッション開始
 *     |<-- channel open confirm -----------|
 *     |                                    |
 *     |--- channel request (shell) ------->|  6. シェル要求
 *     |<-- data (shell prompt) ------------|
 *     |                                    |
 *     |--- data (command) ---------------->|  7. コマンド送受信
 *     |<-- data (output) -----------------|
 */
import {
  DH_PARAMS, dhGenerateKeyPair, dhComputeSharedSecret,
  symmetricEncrypt, simpleHash,
  generateKeyPair, sign, formatFingerprint,
  type DhKeyPair, type KeyPair,
} from "../crypto/crypto.js";

/** SSH プロトコルで送受信されるメッセージの型定義 */
export type SshMessage =
  | { type: "version"; version: string }
  | { type: "kexinit"; algorithms: string[] }
  | { type: "kex_dh_init"; clientPublicKey: number }
  | { type: "kex_dh_reply"; serverPublicKey: number; hostKey: string; signature: string }
  | { type: "newkeys" }
  | { type: "userauth_request"; username: string; method: string; credential: string }
  | { type: "userauth_success" }
  | { type: "userauth_failure"; methods: string[] }
  | { type: "channel_open"; channelType: string; channelId: number }
  | { type: "channel_open_confirm"; channelId: number }
  | { type: "channel_request"; requestType: string }
  | { type: "channel_data"; data: string; encrypted: string }
  | { type: "channel_close"; channelId: number }
  | { type: "disconnect"; reason: string };

/** SSH イベント（UI側でプロトコルトレースを可視化するために使用） */
export type SshEvent =
  | { type: "send"; from: "client" | "server"; message: SshMessage; encrypted: boolean; raw: string }
  | { type: "crypto"; operation: string; detail: string }
  | { type: "auth"; method: string; success: boolean; username: string }
  | { type: "channel"; action: string; detail: string }
  | { type: "info"; message: string };

/**
 * SSH サーバのエミュレーション
 *
 * ホスト鍵の保持、ユーザ認証（パスワード/公開鍵）、
 * 仮想ファイルシステム上でのコマンド実行を行う。
 */
export class SshServer {
  readonly hostname: string;
  readonly ip: string;
  readonly port: number;
  readonly hostKey: KeyPair;
  private users: Map<string, { password: string; authorizedKeys: string[] }>;
  private filesystem: Map<string, string>;

  /**
   * サーバインスタンスを初期化する
   * @param hostname - サーバのホスト名
   * @param ip - サーバのIPアドレス
   */
  constructor(hostname: string, ip: string) {
    this.hostname = hostname;
    this.ip = ip;
    this.port = 22;
    this.hostKey = generateKeyPair(`host-${hostname}`);
    this.users = new Map([
      ["root", { password: "root", authorizedKeys: [] }],
      ["user", { password: "password", authorizedKeys: [] }],
    ]);
    this.filesystem = new Map([
      ["/etc/hostname", hostname],
      ["/etc/os-release", 'NAME="Ubuntu"\nVERSION="22.04"'],
      ["/home/user/.bashrc", "export PS1='$ '"],
      ["/home/user/hello.txt", "Hello from SSH server!"],
      ["/var/log/auth.log", ""],
    ]);
  }

  /**
   * ユーザの authorized_keys に公開鍵を追加する
   * @param username - 対象ユーザ名
   * @param publicKey - 登録する公開鍵
   */
  addAuthorizedKey(username: string, publicKey: string): void {
    const user = this.users.get(username);
    if (user !== undefined) user.authorizedKeys.push(publicKey);
  }

  /**
   * ユーザ認証を行う
   * @param username - 認証するユーザ名
   * @param method - 認証方式（"password" または "publickey"）
   * @param credential - パスワードまたは公開鍵文字列
   * @returns 認証成功なら true
   */
  authenticate(username: string, method: string, credential: string): boolean {
    const user = this.users.get(username);
    if (user === undefined) return false;
    if (method === "password") return user.password === credential;
    if (method === "publickey") return user.authorizedKeys.includes(credential);
    return false;
  }

  /**
   * シェルコマンドを実行し結果を返す
   *
   * 仮想ファイルシステム上で基本的なLinuxコマンドをエミュレートする。
   * 対応コマンド: echo, whoami, hostname, uname, pwd, id, uptime, date, cat, ls, w, df, free, ip, exit
   *
   * @param command - 実行するコマンド文字列
   * @param username - 実行ユーザ名
   * @returns コマンドの出力文字列（"__EXIT__" は切断要求）
   */
  executeCommand(command: string, username: string): string {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0] ?? "";
    const args = parts.slice(1);

    switch (cmd) {
      case "echo": return args.join(" ") + "\n";
      case "whoami": return username + "\n";
      case "hostname": return this.hostname + "\n";
      case "uname": return "Linux " + this.hostname + " 5.15.0\n";
      case "pwd": return `/home/${username}\n`;
      case "id": return `uid=1000(${username}) gid=1000(${username})\n`;
      case "uptime": return " 12:00:00 up 42 days\n";
      case "date": return new Date().toISOString() + "\n";
      case "cat": {
        const path = args[0] ?? "";
        const content = this.filesystem.get(path);
        return content !== undefined ? content + "\n" : `cat: ${path}: No such file\n`;
      }
      case "ls": {
        const dir = args[0] ?? `/home/${username}`;
        const entries: string[] = [];
        for (const path of this.filesystem.keys()) {
          if (path.startsWith(dir + "/")) {
            const rest = path.slice(dir.length + 1);
            const name = rest.split("/")[0];
            if (name !== undefined && !entries.includes(name)) entries.push(name);
          }
        }
        return entries.sort().join("  ") + "\n";
      }
      case "w": return `USER     TTY      FROM             LOGIN@   IDLE\n${username}  pts/0    client           12:00    0.00s\n`;
      case "df": return `Filesystem     1K-blocks  Used  Available\n/dev/sda1      20480000   8192  20471808\n`;
      case "free": return `              total    used    free\nMem:        2048000  512000  1536000\n`;
      case "ip": return `inet ${this.ip}/24 scope global eth0\n`;
      case "exit": return "__EXIT__";
      default:
        if (this.filesystem.has(`/usr/bin/${cmd}`) || cmd.startsWith("./")) return `(executed: ${command})\n`;
        return `-bash: ${cmd}: command not found\n`;
    }
  }
}

/**
 * SSH 接続セッション
 *
 * クライアントとサーバ間の SSH ハンドシェイク（バージョン交換、鍵交換、認証、
 * セッション確立）を一連の流れとして実行し、コマンドの送受信を管理する。
 * 各ステップで発行される SshEvent を通じて UI 側でプロトコルの可視化が可能。
 */
export class SshSession {
  private server: SshServer;
  private clientDhKeys: DhKeyPair | undefined;
  private serverDhKeys: DhKeyPair | undefined;
  private sharedSecret: number | undefined;
  private encryptionKey: number | undefined;
  private authenticated = false;
  private username = "";
  private channelOpen = false;
  events: SshEvent[] = [];
  onEvent: ((event: SshEvent) => void) | undefined;

  /**
   * @param server - 接続先の SSH サーバ
   */
  constructor(server: SshServer) {
    this.server = server;
  }

  /** イベントを記録し、登録されたリスナーに通知する */
  private emit(event: SshEvent): void { this.events.push(event); this.onEvent?.(event); }

  /**
   * SSH 接続を確立する（全ハンドシェイクを実行）
   *
   * 以下の4フェーズを順に実行する:
   *   1. バージョン交換
   *   2. Diffie-Hellman 鍵交換（共有秘密の生成と暗号化チャネルの確立）
   *   3. ユーザ認証（パスワードまたは公開鍵）
   *   4. セッション確立とシェル起動
   *
   * @param username - 認証するユーザ名
   * @param method - 認証方式
   * @param credential - パスワードまたは公開鍵
   * @param clientKeyPair - 公開鍵認証時のクライアント鍵ペア（省略可）
   * @returns 接続成功なら true
   */
  connect(username: string, method: "password" | "publickey", credential: string, clientKeyPair?: KeyPair): boolean {
    this.events = [];
    this.username = username;

    // === Phase 1: バージョン交換 ===
    this.emit({ type: "info", message: "=== Phase 1: Version Exchange ===" });
    const clientVersion = "SSH-2.0-OpenSSH_9.0";
    const serverVersion = "SSH-2.0-SimSSH_1.0";
    this.sendMessage("client", { type: "version", version: clientVersion }, false);
    this.sendMessage("server", { type: "version", version: serverVersion }, false);

    // === Phase 2: 鍵交換 (Diffie-Hellman) ===
    this.emit({ type: "info", message: "=== Phase 2: Key Exchange (Diffie-Hellman) ===" });

    // アルゴリズムネゴシエーション
    this.sendMessage("client", { type: "kexinit", algorithms: ["diffie-hellman-group14-sha256", "aes256-ctr", "hmac-sha2-256"] }, false);
    this.sendMessage("server", { type: "kexinit", algorithms: ["diffie-hellman-group14-sha256", "aes256-ctr", "hmac-sha2-256"] }, false);

    // DH 鍵生成
    this.clientDhKeys = dhGenerateKeyPair(DH_PARAMS);
    this.serverDhKeys = dhGenerateKeyPair(DH_PARAMS);

    this.emit({ type: "crypto", operation: "DH key generate (client)", detail: `private=${String(this.clientDhKeys.privateKey)}, public=${String(this.clientDhKeys.publicKey)} (p=${String(DH_PARAMS.p)}, g=${String(DH_PARAMS.g)})` });
    this.emit({ type: "crypto", operation: "DH key generate (server)", detail: `private=${String(this.serverDhKeys.privateKey)}, public=${String(this.serverDhKeys.publicKey)}` });

    // 公開鍵を交換
    this.sendMessage("client", { type: "kex_dh_init", clientPublicKey: this.clientDhKeys.publicKey }, false);

    // サーバが DH reply + ホスト鍵署名
    const hostKeyFingerprint = this.server.hostKey.fingerprint;
    const exchangeHash = simpleHash(`${String(this.clientDhKeys.publicKey)}-${String(this.serverDhKeys.publicKey)}`);
    const signature = sign(exchangeHash, this.server.hostKey.privateKey);

    this.sendMessage("server", {
      type: "kex_dh_reply",
      serverPublicKey: this.serverDhKeys.publicKey,
      hostKey: this.server.hostKey.publicKey,
      signature,
    }, false);

    // 共有秘密を計算（両側で同じ値になる！）
    const clientSecret = dhComputeSharedSecret(this.serverDhKeys.publicKey, this.clientDhKeys.privateKey, DH_PARAMS.p);
    const serverSecret = dhComputeSharedSecret(this.clientDhKeys.publicKey, this.serverDhKeys.privateKey, DH_PARAMS.p);
    this.sharedSecret = clientSecret;
    this.encryptionKey = clientSecret;

    this.emit({ type: "crypto", operation: "DH shared secret (client)", detail: `server_pub^client_priv mod p = ${String(this.serverDhKeys.publicKey)}^${String(this.clientDhKeys.privateKey)} mod ${String(DH_PARAMS.p)} = ${String(clientSecret)}` });
    this.emit({ type: "crypto", operation: "DH shared secret (server)", detail: `client_pub^server_priv mod p = ${String(this.clientDhKeys.publicKey)}^${String(this.serverDhKeys.privateKey)} mod ${String(DH_PARAMS.p)} = ${String(serverSecret)}` });
    this.emit({ type: "crypto", operation: "Shared secret match!", detail: `${String(clientSecret)} === ${String(serverSecret)} (both sides computed the same value)` });

    // ホスト鍵検証
    this.emit({ type: "crypto", operation: "Host key verification", detail: `Fingerprint: ${formatFingerprint(hostKeyFingerprint)}` });

    // 暗号化開始
    this.sendMessage("client", { type: "newkeys" }, false);
    this.sendMessage("server", { type: "newkeys" }, false);
    this.emit({ type: "info", message: `=== Encrypted channel established (key=${String(this.encryptionKey)}) ===` });

    // === Phase 3: ユーザ認証 ===
    this.emit({ type: "info", message: "=== Phase 3: User Authentication ===" });

    const authCredential = method === "publickey" ? (clientKeyPair?.publicKey ?? credential) : credential;
    this.sendMessage("client", { type: "userauth_request", username, method, credential: method === "password" ? "****" : authCredential }, true);

    const authSuccess = this.server.authenticate(username, method, method === "publickey" ? authCredential : credential);
    this.emit({ type: "auth", method, success: authSuccess, username });

    if (!authSuccess) {
      this.sendMessage("server", { type: "userauth_failure", methods: ["password", "publickey"] }, true);
      return false;
    }
    this.sendMessage("server", { type: "userauth_success" }, true);
    this.authenticated = true;

    // === Phase 4: セッション ===
    this.emit({ type: "info", message: "=== Phase 4: Session ===" });
    this.sendMessage("client", { type: "channel_open", channelType: "session", channelId: 0 }, true);
    this.sendMessage("server", { type: "channel_open_confirm", channelId: 0 }, true);
    this.sendMessage("client", { type: "channel_request", requestType: "shell" }, true);
    this.channelOpen = true;

    // シェルプロンプト
    const prompt = `${username}@${this.server.hostname}:~$ `;
    this.sendData("server", prompt);

    return true;
  }

  /**
   * リモートサーバ上でコマンドを実行する
   *
   * コマンドを暗号化してサーバに送信し、実行結果を暗号化チャネル経由で受け取る。
   *
   * @param command - 実行するコマンド文字列
   * @returns コマンドの出力（未接続時はエラーメッセージ）
   */
  executeCommand(command: string): string {
    if (!this.authenticated || !this.channelOpen) return "Error: not connected\n";

    // クライアント → サーバ (暗号化)
    this.sendData("client", command + "\n");

    // サーバで実行
    const output = this.server.executeCommand(command, this.username);
    if (output === "__EXIT__") {
      this.disconnect();
      return "";
    }

    // サーバ → クライアント (暗号化)
    this.sendData("server", output);

    // プロンプト
    this.sendData("server", `${this.username}@${this.server.hostname}:~$ `);

    return output;
  }

  /** SSH 接続を切断し、セッションをクリーンアップする */
  disconnect(): void {
    this.sendMessage("client", { type: "disconnect", reason: "user request" }, true);
    this.channelOpen = false;
    this.authenticated = false;
    this.emit({ type: "info", message: "Connection closed." });
  }

  /** 接続中かどうかを返す */
  isConnected(): boolean { return this.authenticated && this.channelOpen; }
  /** 認証済みユーザ名を返す */
  getUsername(): string { return this.username; }
  /** 接続先サーバのホスト名を返す */
  getHostname(): string { return this.server.hostname; }

  /**
   * SSH メッセージを送信する（イベントとして記録）
   *
   * 暗号化フラグが有効かつ暗号鍵が設定済みの場合、メッセージを暗号化する。
   *
   * @param from - 送信元（"client" または "server"）
   * @param message - 送信する SSH メッセージ
   * @param encrypted - 暗号化するかどうか
   */
  private sendMessage(from: "client" | "server", message: SshMessage, encrypted: boolean): void {
    let raw = JSON.stringify(message);
    if (encrypted && this.encryptionKey !== undefined) {
      raw = symmetricEncrypt(JSON.stringify(message), this.encryptionKey);
    }
    this.emit({ type: "send", from, message, encrypted, raw });
  }

  /**
   * チャネルデータを送信する（コマンドやコマンド出力の送受信に使用）
   * @param from - 送信元
   * @param data - 送信するデータ文字列
   */
  private sendData(from: "client" | "server", data: string): void {
    const encrypted = this.encryptionKey !== undefined ? symmetricEncrypt(data, this.encryptionKey) : data;
    this.emit({ type: "send", from, message: { type: "channel_data", data, encrypted }, encrypted: this.encryptionKey !== undefined, raw: encrypted });
  }
}
