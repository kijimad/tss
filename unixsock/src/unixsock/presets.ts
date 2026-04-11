import type { Preset, Process, SockAddr } from "./types.js";

const server: Process = { pid: 100, name: "server", fds: [0, 1, 2], uid: 1000, gid: 1000 };
const client: Process = { pid: 200, name: "client", fds: [0, 1, 2], uid: 1000, gid: 1000 };
const worker: Process = { pid: 300, name: "worker", fds: [0, 1, 2], uid: 1000, gid: 1000 };
const daemon: Process = { pid: 1, name: "systemd", fds: [0, 1, 2], uid: 0, gid: 0 };
const app: Process = { pid: 500, name: "app", fds: [0, 1, 2], uid: 1000, gid: 1000 };

const pathAddr: SockAddr = { type: "pathname", path: "/var/run/myapp.sock" };
const abstractAddr: SockAddr = { type: "abstract", path: "myservice" };
const dbAddr: SockAddr = { type: "pathname", path: "/var/run/postgresql/.s.PGSQL.5432" };
const dockerAddr: SockAddr = { type: "pathname", path: "/var/run/docker.sock" };
const dgramAddr1: SockAddr = { type: "pathname", path: "/tmp/dgram_server.sock" };
const dgramAddr2: SockAddr = { type: "pathname", path: "/tmp/dgram_client.sock" };

export const presets: Preset[] = [
  // 1. SOCK_STREAM基本接続
  {
    name: "1. SOCK_STREAM — 基本的なクライアント・サーバー接続",
    description: "socket→bind→listen→connect→accept→send/recvの基本フロー。TCPと同様の接続型通信だが、ネットワークスタックを経由しないためオーバーヘッドが小さい。",
    ops: [
      { type: "process_create", process: server },
      { type: "process_create", process: client },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "listen", fd: 3, backlog: 5 },
      { type: "socket", pid: 200, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 4, addr: pathAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "Hello, Server!" },
      { type: "recv", fd: 5 },
      { type: "send", fd: 5, data: "Hello, Client!" },
      { type: "recv", fd: 4 },
    ],
  },

  // 2. socketpair（無名ペア）
  {
    name: "2. socketpair — 無名ソケットペア（親子プロセス通信）",
    description: "socketpair()で即座に接続済みペアを作成。bind/listen/connect不要。fork前に作成し、親子プロセス間のIPC（パイプの双方向版）として利用。",
    ops: [
      { type: "process_create", process: server },
      { type: "socketpair", pid: 100, socketType: "SOCK_STREAM" },
      { type: "send", fd: 3, data: "parent→child" },
      { type: "recv", fd: 4 },
      { type: "send", fd: 4, data: "child→parent" },
      { type: "recv", fd: 3 },
      { type: "getsockname", fd: 3 },
      { type: "getpeername", fd: 3 },
    ],
  },

  // 3. 抽象名前空間
  {
    name: "3. 抽象名前空間 — Linux固有のソケットアドレス",
    description: "\\0プレフィックスの抽象名前空間ソケット。ファイルシステムにエントリを作らない、プロセス終了時に自動クリーンアップ、unlink不要。D-BusやSystemdが使用。",
    ops: [
      { type: "process_create", process: daemon },
      { type: "process_create", process: app },
      { type: "socket", pid: 1, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: abstractAddr },
      { type: "listen", fd: 3, backlog: 128 },
      { type: "socket", pid: 500, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 4, addr: abstractAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "METHOD org.freedesktop.DBus.Hello" },
      { type: "recv", fd: 5 },
      { type: "send", fd: 5, data: "REPLY :1.42" },
      { type: "recv", fd: 4 },
    ],
  },

  // 4. SOCK_DGRAM（データグラム）
  {
    name: "4. SOCK_DGRAM — コネクションレス通信（syslog風）",
    description: "UDP風のコネクションレス通信。connect不要、sendtoで宛先指定。メッセージ境界が保持される。syslog、rsyslogなどのログ転送で使用。",
    ops: [
      { type: "process_create", process: server },
      { type: "process_create", process: client },
      { type: "socket", pid: 100, socketType: "SOCK_DGRAM" },
      { type: "bind", fd: 3, addr: dgramAddr1 },
      { type: "socket", pid: 200, socketType: "SOCK_DGRAM" },
      { type: "bind", fd: 4, addr: dgramAddr2 },
      { type: "sendto", fd: 4, data: "<13>syslog: auth success", addr: dgramAddr1 },
      { type: "sendto", fd: 4, data: "<11>syslog: error occurred", addr: dgramAddr1 },
      { type: "recv", fd: 3 },
      { type: "recv", fd: 3 },
    ],
  },

  // 5. SOCK_SEQPACKET
  {
    name: "5. SOCK_SEQPACKET — 順序保証+メッセージ境界保持",
    description: "SOCK_STREAMの信頼性（順序保証・接続型）とSOCK_DGRAMのメッセージ境界保持を兼ね備える。recv()で1メッセージ単位で読み出し可能。",
    ops: [
      { type: "process_create", process: server },
      { type: "process_create", process: client },
      { type: "socket", pid: 100, socketType: "SOCK_SEQPACKET" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "listen", fd: 3, backlog: 5 },
      { type: "socket", pid: 200, socketType: "SOCK_SEQPACKET" },
      { type: "connect", fd: 4, addr: pathAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "MSG1" },
      { type: "send", fd: 4, data: "MSG2" },
      { type: "send", fd: 4, data: "MSG3" },
      { type: "recv", fd: 5 },
      { type: "recv", fd: 5 },
      { type: "recv", fd: 5 },
    ],
  },

  // 6. fd受け渡し (SCM_RIGHTS)
  {
    name: "6. SCM_RIGHTS — ファイルディスクリプタの受け渡し",
    description: "sendmsg/recvmsgの補助データ(SCM_RIGHTS)でfdをプロセス間で受け渡し。Nginx/Apacheのワーカーモデル、systemdのソケットアクティベーションで使用。",
    ops: [
      { type: "process_create", process: server },
      { type: "process_create", process: worker },
      { type: "socketpair", pid: 100, socketType: "SOCK_STREAM" },
      { type: "sendmsg", fd: 3, data: "new_connection", ancillary: {
        level: "SOL_SOCKET", type: "SCM_RIGHTS",
        fds: [
          { fd: 10, type: "socket", path: "client_conn", description: "クライアント接続ソケット" },
          { fd: 11, type: "file", path: "/var/log/app.log", description: "ログファイル" },
        ],
      }},
      { type: "recvmsg", fd: 4 },
      { type: "sendmsg", fd: 4, data: "done", ancillary: {
        level: "SOL_SOCKET", type: "SCM_RIGHTS",
        fds: [
          { fd: 12, type: "pipe", description: "結果パイプ(書き込み側)" },
        ],
      }},
      { type: "recvmsg", fd: 3 },
    ],
  },

  // 7. ピア認証 (SCM_CREDENTIALS)
  {
    name: "7. SCM_CREDENTIALS — ピア認証（uid/gid/pid確認）",
    description: "SO_PASSCREDを設定し、SCM_CREDENTIALSでピアプロセスのpid/uid/gidを取得。D-Busのポリシーチェック、polkitの認可判断で使用。カーネルが値を検証。",
    ops: [
      { type: "process_create", process: daemon },
      { type: "process_create", process: app },
      { type: "socket", pid: 1, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: { type: "pathname", path: "/var/run/polkit.sock" } },
      { type: "listen", fd: 3, backlog: 10 },
      { type: "socket", pid: 500, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 4, addr: { type: "pathname", path: "/var/run/polkit.sock" } },
      { type: "accept", fd: 3 },
      { type: "sendmsg", fd: 4, data: "AUTH_REQUEST: install package", ancillary: {
        level: "SOL_SOCKET", type: "SCM_CREDENTIALS",
        credentials: { pid: 500, uid: 1000, gid: 1000 },
      }},
      { type: "recvmsg", fd: 5 },
      { type: "sendmsg", fd: 5, data: "AUTH_OK: uid=1000 allowed", ancillary: {
        level: "SOL_SOCKET", type: "SCM_CREDENTIALS",
        credentials: { pid: 1, uid: 0, gid: 0 },
      }},
      { type: "recvmsg", fd: 4 },
    ],
  },

  // 8. PostgreSQL接続
  {
    name: "8. PostgreSQL接続 — データベースのUNIXソケット通信",
    description: "PostgreSQLは/var/run/postgresql/.s.PGSQL.5432にUNIXソケットを作成。TCPよりレイテンシが低く、ローカル接続のデフォルト。peer認証でuid確認。",
    ops: [
      { type: "process_create", process: { pid: 50, name: "postgres", fds: [0, 1, 2], uid: 999, gid: 999 } },
      { type: "process_create", process: app },
      { type: "socket", pid: 50, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: dbAddr },
      { type: "listen", fd: 3, backlog: 128 },
      { type: "socket", pid: 500, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 4, addr: dbAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "StartupMessage: user=app dbname=mydb" },
      { type: "recv", fd: 5 },
      { type: "send", fd: 5, data: "AuthenticationOk + ReadyForQuery" },
      { type: "recv", fd: 4 },
      { type: "send", fd: 4, data: "Query: SELECT * FROM users" },
      { type: "recv", fd: 5 },
      { type: "send", fd: 5, data: "DataRow + CommandComplete" },
      { type: "recv", fd: 4 },
    ],
  },

  // 9. Docker APIソケット
  {
    name: "9. Docker API — /var/run/docker.sock通信",
    description: "DockerデーモンはUNIXソケットでAPIを公開。docker CLIやコンテナランタイムがHTTP over UNIXソケットで通信。ファイルパーミッションでアクセス制御。",
    ops: [
      { type: "process_create", process: { pid: 10, name: "dockerd", fds: [0, 1, 2], uid: 0, gid: 0 } },
      { type: "process_create", process: { pid: 600, name: "docker-cli", fds: [0, 1, 2], uid: 1000, gid: 999 } },
      { type: "socket", pid: 10, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: dockerAddr },
      { type: "listen", fd: 3, backlog: 128 },
      { type: "socket", pid: 600, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 4, addr: dockerAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "GET /v1.41/containers/json HTTP/1.1" },
      { type: "recv", fd: 5 },
      { type: "send", fd: 5, data: 'HTTP/1.1 200 OK\r\n[{"Id":"abc123","Names":["/web"]}]' },
      { type: "recv", fd: 4 },
    ],
  },

  // 10. クリーンアップとshutdown
  {
    name: "10. ライフサイクル — shutdown + close + unlink",
    description: "接続の適切な終了手順。shutdown(SHUT_WR)で書き込み終了を通知、close()でfd解放、unlink()でソケットファイル削除。名前付きソケットはunlink必須。",
    ops: [
      { type: "process_create", process: server },
      { type: "process_create", process: client },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "listen", fd: 3, backlog: 5 },
      { type: "socket", pid: 200, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 4, addr: pathAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "Final message" },
      { type: "recv", fd: 5 },
      { type: "shutdown", fd: 4, how: "SHUT_WR" },
      { type: "shutdown", fd: 5, how: "SHUT_WR" },
      { type: "close", fd: 4 },
      { type: "close", fd: 5 },
      { type: "close", fd: 3 },
      { type: "unlink", path: "/var/run/myapp.sock" },
    ],
  },
];
