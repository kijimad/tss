import type {
  UnixSocket, Process, SockAddr,
  SimOp, SimEvent, SimulationResult, EventType, SocketType,
} from "./types.js";

function makeSock(fd: number, socketType: SocketType, pid: number): UnixSocket {
  return {
    fd, socketType, state: "UNBOUND", pid,
    recvBuffer: [], bufferSize: 212992, refCount: 1,
  };
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const processes: Process[] = [];
  const sockets: UnixSocket[] = [];
  const events: SimEvent[] = [];
  const socketFiles: string[] = [];
  let step = 0;
  let nextFd = 3; // 0=stdin, 1=stdout, 2=stderr

  const stats = {
    totalSyscalls: 0, socketCreated: 0, bytesSent: 0,
    bytesReceived: 0, fdsPassed: 0, errors: 0,
  };

  function emit(type: EventType, desc: string, pid?: number, fd?: number): void {
    events.push({ step, type, description: desc, pid, fd });
  }

  function findSocket(fd: number): UnixSocket | undefined {
    return sockets.find((s) => s.fd === fd && s.state !== "CLOSED");
  }

  function findProcess(pid: number): Process | undefined {
    return processes.find((p) => p.pid === pid);
  }

  function allocFd(): number {
    return nextFd++;
  }

  function addrStr(addr: SockAddr): string {
    if (addr.type === "abstract") return `@${addr.path}`;
    if (addr.type === "unnamed") return "(unnamed)";
    return addr.path;
  }

  for (const op of ops) {
    step++;
    stats.totalSyscalls++;

    switch (op.type) {
      case "process_create": {
        processes.push({ ...op.process, fds: [...op.process.fds] });
        emit("process_create", `プロセス作成: PID=${op.process.pid} "${op.process.name}" (uid=${op.process.uid}, gid=${op.process.gid})`, op.process.pid);
        break;
      }

      case "socket": {
        const fd = allocFd();
        const sock = makeSock(fd, op.socketType, op.pid);
        sockets.push(sock);
        stats.socketCreated++;

        const proc = findProcess(op.pid);
        if (proc) proc.fds.push(fd);

        emit("socket_create",
          `socket(AF_UNIX, ${op.socketType}, 0) → fd=${fd}`,
          op.pid, fd);
        break;
      }

      case "socketpair": {
        const fd1 = allocFd();
        const fd2 = allocFd();
        const sock1 = makeSock(fd1, op.socketType, op.pid);
        const sock2 = makeSock(fd2, op.socketType, op.pid);
        sock1.state = "CONNECTED";
        sock2.state = "CONNECTED";
        sock1.peerFd = fd2;
        sock2.peerFd = fd1;
        sock1.addr = { type: "unnamed", path: "" };
        sock2.addr = { type: "unnamed", path: "" };
        sock1.peerAddr = { type: "unnamed", path: "" };
        sock2.peerAddr = { type: "unnamed", path: "" };
        sockets.push(sock1, sock2);
        stats.socketCreated += 2;

        const proc = findProcess(op.pid);
        if (proc) proc.fds.push(fd1, fd2);

        emit("socketpair_create",
          `socketpair(AF_UNIX, ${op.socketType}, 0) → [fd=${fd1}, fd=${fd2}] — 無名ペア作成、即座にCONNECTED`,
          op.pid);
        break;
      }

      case "bind": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `bind失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        sock.addr = op.addr;
        sock.state = "BOUND";

        if (op.addr.type === "pathname") {
          socketFiles.push(op.addr.path);
          emit("inode_create", `ソケットファイル作成: ${op.addr.path} (inode=S_IFSOCK)`, sock.pid, op.fd);
        }

        emit("bind", `bind(fd=${op.fd}, "${addrStr(op.addr)}") — ${op.addr.type === "abstract" ? "抽象名前空間" : op.addr.type === "pathname" ? "ファイルシステムパス" : "無名"}にバインド`, sock.pid, op.fd);
        break;
      }

      case "listen": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `listen失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }
        if (sock.socketType === "SOCK_DGRAM") {
          emit("error", `listen失敗: SOCK_DGRAMではlistenできない`, sock.pid, op.fd);
          stats.errors++;
          break;
        }

        sock.state = "LISTENING";
        emit("listen", `listen(fd=${op.fd}, backlog=${op.backlog}) — 接続待ち開始`, sock.pid, op.fd);
        break;
      }

      case "connect": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `connect失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        // 接続先サーバーソケットを探す
        const serverSock = sockets.find((s) =>
          s.state === "LISTENING" && s.addr &&
          s.addr.type === op.addr.type && s.addr.path === op.addr.path);

        if (!serverSock) {
          emit("error", `connect失敗: ${addrStr(op.addr)} — 接続先が見つからない (ECONNREFUSED)`, sock.pid, op.fd);
          stats.errors++;
          break;
        }

        sock.state = "CONNECTED";
        sock.peerAddr = { ...op.addr };
        sock.peerFd = serverSock.fd;

        // 自動バインド（クライアント側は無名）
        if (!sock.addr) {
          sock.addr = { type: "unnamed", path: "" };
        }

        emit("connect",
          `connect(fd=${op.fd}, "${addrStr(op.addr)}") — サーバー(fd=${serverSock.fd})に接続`,
          sock.pid, op.fd);
        break;
      }

      case "accept": {
        const serverSock = findSocket(op.fd);
        if (!serverSock || serverSock.state !== "LISTENING") {
          emit("error", `accept失敗: fd=${op.fd} がLISTENING状態でない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        // 接続待ちのクライアントを探す
        const clientSock = sockets.find((s) =>
          s.state === "CONNECTED" && s.peerFd === serverSock.fd);

        const newFd = allocFd();
        const connSock = makeSock(newFd, serverSock.socketType, serverSock.pid);
        connSock.state = "CONNECTED";
        connSock.addr = serverSock.addr ? { ...serverSock.addr } : undefined;
        connSock.peerAddr = clientSock?.addr ? { ...clientSock.addr } : { type: "unnamed", path: "" };
        connSock.peerFd = clientSock?.fd;
        sockets.push(connSock);

        if (clientSock) {
          clientSock.peerFd = newFd;
        }

        const proc = findProcess(serverSock.pid);
        if (proc) proc.fds.push(newFd);

        emit("accept",
          `accept(fd=${op.fd}) → 新fd=${newFd} — 接続受け入れ${clientSock ? `、クライアント(fd=${clientSock.fd})と接続` : ""}`,
          serverSock.pid, newFd);
        break;
      }

      case "send": {
        const sock = findSocket(op.fd);
        if (!sock || sock.state !== "CONNECTED") {
          emit("error", `send失敗: fd=${op.fd} がCONNECTED状態でない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        const dataLen = op.data.length;
        stats.bytesSent += dataLen;

        // ピアの受信バッファにデータ追加
        const peer = sock.peerFd !== undefined ? findSocket(sock.peerFd) : undefined;
        if (peer) {
          peer.recvBuffer.push(op.data);
        }

        emit("send", `send(fd=${op.fd}, "${op.data}", ${dataLen}) — ${dataLen}バイト送信 → ピア(fd=${sock.peerFd})の受信バッファへ`, sock.pid, op.fd);
        emit("buffer_update", `fd=${sock.peerFd} 受信バッファ: ${peer ? peer.recvBuffer.length : 0}メッセージ (${peer ? peer.recvBuffer.join("").length : 0}B)`, peer?.pid, sock.peerFd);
        break;
      }

      case "recv": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `recv失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        if (sock.recvBuffer.length === 0) {
          emit("recv", `recv(fd=${op.fd}) → (バッファ空、ブロック)`, sock.pid, op.fd);
          break;
        }

        // SOCK_STREAM: バッファ全体を読み出し（バイトストリーム）
        // SOCK_DGRAM/SEQPACKET: 1メッセージ単位
        let data: string;
        if (sock.socketType === "SOCK_STREAM") {
          data = sock.recvBuffer.join("");
          sock.recvBuffer.length = 0;
        } else {
          data = sock.recvBuffer.shift()!;
        }

        stats.bytesReceived += data.length;
        emit("recv", `recv(fd=${op.fd}) → "${data}" (${data.length}B)${sock.socketType !== "SOCK_STREAM" ? " [メッセージ境界保持]" : " [バイトストリーム]"}`, sock.pid, op.fd);
        break;
      }

      case "sendmsg": {
        const sock = findSocket(op.fd);
        if (!sock || sock.state !== "CONNECTED") {
          emit("error", `sendmsg失敗: fd=${op.fd} がCONNECTED状態でない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        const dataLen = op.data.length;
        stats.bytesSent += dataLen;

        const peer = sock.peerFd !== undefined ? findSocket(sock.peerFd) : undefined;
        if (peer) peer.recvBuffer.push(op.data);

        emit("sendmsg", `sendmsg(fd=${op.fd}, "${op.data}", ${dataLen}B + 補助データ)`, sock.pid, op.fd);

        // 補助データ処理
        if (op.ancillary.type === "SCM_RIGHTS" && op.ancillary.fds) {
          const fdDescs = op.ancillary.fds.map((f) => `fd=${f.fd}(${f.description})`).join(", ");
          emit("fd_pass", `SCM_RIGHTS: ファイルディスクリプタ受け渡し — [${fdDescs}] → ピア(fd=${sock.peerFd})`, sock.pid, op.fd);
          stats.fdsPassed += op.ancillary.fds.length;
        } else if (op.ancillary.type === "SCM_CREDENTIALS" && op.ancillary.credentials) {
          const c = op.ancillary.credentials;
          emit("credential_pass", `SCM_CREDENTIALS: 認証情報送信 — pid=${c.pid}, uid=${c.uid}, gid=${c.gid}`, sock.pid, op.fd);
        }
        break;
      }

      case "recvmsg": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `recvmsg失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        const data = sock.recvBuffer.length > 0
          ? (sock.socketType === "SOCK_STREAM" ? sock.recvBuffer.splice(0).join("") : sock.recvBuffer.shift()!)
          : "";

        if (data) {
          stats.bytesReceived += data.length;
          emit("recvmsg", `recvmsg(fd=${op.fd}) → data="${data}" (${data.length}B) + 補助データ受信`, sock.pid, op.fd);
        } else {
          emit("recvmsg", `recvmsg(fd=${op.fd}) → (バッファ空)`, sock.pid, op.fd);
        }
        break;
      }

      case "sendto": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `sendto失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        if (sock.socketType !== "SOCK_DGRAM") {
          emit("error", `sendto失敗: SOCK_DGRAMでないソケットでsendto`, sock.pid, op.fd);
          stats.errors++;
          break;
        }

        // 宛先ソケットを探す
        const dstSock = sockets.find((s) =>
          s.addr && s.addr.type === op.addr.type && s.addr.path === op.addr.path &&
          s.socketType === "SOCK_DGRAM" && s.state !== "CLOSED");

        if (!dstSock) {
          emit("error", `sendto失敗: 宛先 "${addrStr(op.addr)}" が見つからない`, sock.pid, op.fd);
          stats.errors++;
          break;
        }

        stats.bytesSent += op.data.length;
        dstSock.recvBuffer.push(op.data);

        emit("sendto", `sendto(fd=${op.fd}, "${op.data}", "${addrStr(op.addr)}") — ${op.data.length}Bをfd=${dstSock.fd}へ送信 [コネクションレス]`, sock.pid, op.fd);
        break;
      }

      case "close": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `close失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }

        sock.refCount--;
        const prevState = sock.state;
        sock.state = "CLOSED";

        const proc = findProcess(sock.pid);
        if (proc) proc.fds = proc.fds.filter((f) => f !== op.fd);

        emit("close", `close(fd=${op.fd}) — ${prevState}→CLOSED${sock.addr?.type === "pathname" ? " (ソケットファイルは残存)" : ""}`, sock.pid, op.fd);

        // ピアへのEOF通知
        if (sock.peerFd !== undefined) {
          const peer = findSocket(sock.peerFd);
          if (peer && peer.state === "CONNECTED") {
            emit("recv", `fd=${sock.peerFd}: ピア切断検出 — recv()→0 (EOF)`, peer.pid, sock.peerFd);
          }
        }
        break;
      }

      case "unlink": {
        const idx = socketFiles.indexOf(op.path);
        if (idx >= 0) {
          socketFiles.splice(idx, 1);
          emit("unlink", `unlink("${op.path}") — ソケットファイル削除`, undefined);
        } else {
          emit("error", `unlink失敗: "${op.path}" が見つからない (ENOENT)`, undefined);
          stats.errors++;
        }
        break;
      }

      case "getpeername": {
        const sock = findSocket(op.fd);
        if (!sock || !sock.peerAddr) {
          emit("error", `getpeername失敗: fd=${op.fd} — ピアアドレスなし`, undefined, op.fd);
          stats.errors++;
          break;
        }
        emit("getpeername", `getpeername(fd=${op.fd}) → "${addrStr(sock.peerAddr)}" (${sock.peerAddr.type})`, sock.pid, op.fd);
        break;
      }

      case "getsockname": {
        const sock = findSocket(op.fd);
        if (!sock || !sock.addr) {
          emit("error", `getsockname失敗: fd=${op.fd} — バインドされていない`, undefined, op.fd);
          stats.errors++;
          break;
        }
        emit("getsockname", `getsockname(fd=${op.fd}) → "${addrStr(sock.addr)}" (${sock.addr.type})`, sock.pid, op.fd);
        break;
      }

      case "shutdown": {
        const sock = findSocket(op.fd);
        if (!sock) {
          emit("error", `shutdown失敗: fd=${op.fd} が存在しない`, undefined, op.fd);
          stats.errors++;
          break;
        }
        const howDesc = op.how === "SHUT_RD" ? "読み取り停止" : op.how === "SHUT_WR" ? "書き込み停止" : "読み書き停止";
        emit("shutdown", `shutdown(fd=${op.fd}, ${op.how}) — ${howDesc}`, sock.pid, op.fd);
        break;
      }
    }
  }

  return { events, processes, sockets, socketFiles, stats };
}
