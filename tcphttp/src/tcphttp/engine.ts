import type {
  TcpSocket, TcpSegment, TcpFlags, TcpState, SocketAddr,
  SimOp, SimEvent, SimulationResult, EventType,
  HttpRequest, HttpResponse,
} from "./types.js";

function flags(syn = false, ack = false, fin = false, rst = false, psh = false): TcpFlags {
  return { syn, ack, fin, rst, psh };
}

function flagStr(f: TcpFlags): string {
  const parts: string[] = [];
  if (f.syn) parts.push("SYN");
  if (f.ack) parts.push("ACK");
  if (f.fin) parts.push("FIN");
  if (f.rst) parts.push("RST");
  if (f.psh) parts.push("PSH");
  return `[${parts.join(",")}]`;
}

function makeSocket(local: SocketAddr, remote: SocketAddr): TcpSocket {
  return {
    localAddr: { ...local }, remoteAddr: { ...remote },
    state: "CLOSED", sendNext: 0, sendUnack: 0, recvNext: 0,
    recvWindow: 65535, sendWindow: 65535,
    sendBuffer: [], recvBuffer: [],
  };
}

function makeSegment(src: number, dst: number, seq: number, ack: number,
  f: TcpFlags, window: number, payload = "", payloadSize = 0): TcpSegment {
  return { srcPort: src, dstPort: dst, seq, ack, flags: f, window, payload, payloadSize };
}

export function runSimulation(
  clientAddr: SocketAddr,
  serverAddr: SocketAddr,
  ops: SimOp[],
): SimulationResult {
  let client = makeSocket(clientAddr, serverAddr);
  let server = makeSocket(serverAddr, clientAddr);
  const events: SimEvent[] = [];
  const segments: TcpSegment[] = [];
  const httpExchanges: { request?: HttpRequest; response?: HttpResponse }[] = [];
  let step = 0;
  let clientISN = 1000;
  let serverISN = 5000;

  const stats = {
    totalSegments: 0, dataSegments: 0, ackSegments: 0,
    retransmissions: 0, handshakeSegments: 0, teardownSegments: 0,
  };

  function emit(type: EventType, desc: string, dir?: SimEvent["direction"], segment?: TcpSegment): void {
    events.push({ step, type, description: desc, direction: dir, segment });
  }

  function stateChange(side: "client" | "server", from: TcpState, to: TcpState): void {
    const sock = side === "client" ? client : server;
    sock.state = to;
    emit("state_change", `${side}: ${from} → ${to}`, "local");
  }

  function sendSegment(from: "client" | "server", seg: TcpSegment): void {
    segments.push(seg);
    stats.totalSegments++;
    const dir: SimEvent["direction"] = from === "client" ? "client→server" : "server→client";
    const fStr = flagStr(seg.flags);
    let desc = `${fStr} seq=${seg.seq} ack=${seg.ack} win=${seg.window}`;
    if (seg.payloadSize > 0) desc += ` len=${seg.payloadSize}`;
    emit("tcp_send", desc, dir, seg);
  }

  /** HTTPリクエストをシリアライズ */
  function serializeHttpRequest(req: HttpRequest): string {
    let raw = `${req.method} ${req.path} HTTP/${req.version}\\r\\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      raw += `${k}: ${v}\\r\\n`;
    }
    raw += "\\r\\n";
    if (req.body) raw += req.body;
    return raw;
  }

  /** HTTPレスポンスをシリアライズ */
  function serializeHttpResponse(res: HttpResponse): string {
    let raw = `HTTP/${res.version} ${res.statusCode} ${res.statusText}\\r\\n`;
    for (const [k, v] of Object.entries(res.headers)) {
      raw += `${k}: ${v}\\r\\n`;
    }
    raw += "\\r\\n";
    if (res.body) raw += res.body;
    return raw;
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "socket_create": {
        emit("socket_create", `${op.side}: socket(AF_INET, SOCK_STREAM, 0) — TCPソケット作成`, "local");
        break;
      }

      case "bind": {
        server.localAddr.port = op.port;
        emit("bind", `server: bind(${server.localAddr.ip}:${op.port})`, "local");
        break;
      }

      case "listen": {
        const from = server.state;
        stateChange("server", from, "LISTEN");
        emit("listen", `server: listen() — 接続待ち開始`, "local");
        break;
      }

      case "connect": {
        // クライアント→サーバー: SYN
        client.sendNext = clientISN;
        client.sendUnack = clientISN;
        const synSeg = makeSegment(
          client.localAddr.port, client.remoteAddr.port,
          clientISN, 0, flags(true), client.recvWindow,
        );
        const from1 = client.state;
        stateChange("client", from1, "SYN_SENT");
        emit("handshake_syn", `SYN送信: seq=${clientISN}`, "client→server", synSeg);
        sendSegment("client", synSeg);
        stats.handshakeSegments++;
        client.sendNext = clientISN + 1;

        // サーバー受信→SYN+ACK
        server.recvNext = clientISN + 1;
        server.sendNext = serverISN;
        server.sendUnack = serverISN;
        const synAckSeg = makeSegment(
          server.localAddr.port, server.remoteAddr.port,
          serverISN, clientISN + 1, flags(true, true), server.recvWindow,
        );
        const from2 = server.state;
        stateChange("server", from2, "SYN_RECEIVED");
        emit("handshake_syn_ack", `SYN+ACK送信: seq=${serverISN}, ack=${clientISN + 1}`, "server→client", synAckSeg);
        sendSegment("server", synAckSeg);
        stats.handshakeSegments++;
        server.sendNext = serverISN + 1;

        // クライアント受信→ACK
        client.recvNext = serverISN + 1;
        const ackSeg = makeSegment(
          client.localAddr.port, client.remoteAddr.port,
          clientISN + 1, serverISN + 1, flags(false, true), client.recvWindow,
        );
        stateChange("client", "SYN_SENT", "ESTABLISHED");
        stateChange("server", "SYN_RECEIVED", "ESTABLISHED");
        emit("handshake_ack", `ACK送信: seq=${clientISN + 1}, ack=${serverISN + 1}`, "client→server", ackSeg);
        sendSegment("client", ackSeg);
        stats.handshakeSegments++;
        stats.ackSegments++;
        emit("handshake_complete", `3ウェイハンドシェイク完了 — コネクション確立`, "local");
        break;
      }

      case "accept": {
        emit("accept", `server: accept() — 接続受け入れ`, "local");
        break;
      }

      case "send": {
        const sock = op.side === "client" ? client : server;
        const peer = op.side === "client" ? server : client;
        const dir: SimEvent["direction"] = op.side === "client" ? "client→server" : "server→client";
        const dataSize = op.data.length;

        // データ送信
        const dataSeg = makeSegment(
          sock.localAddr.port, sock.remoteAddr.port,
          sock.sendNext, sock.recvNext, flags(false, true, false, false, true),
          sock.recvWindow, op.data, dataSize,
        );
        emit("data_send", `${op.side}: send("${op.data}") — ${dataSize}バイト送信`, dir, dataSeg);
        sendSegment(op.side, dataSeg);
        stats.dataSegments++;
        sock.sendBuffer.push(op.data);
        sock.sendNext += dataSize;

        // ACK受信
        peer.recvNext = sock.sendNext;
        peer.recvBuffer.push(op.data);
        const ackSeg = makeSegment(
          peer.localAddr.port, peer.remoteAddr.port,
          peer.sendNext, sock.sendNext, flags(false, true), peer.recvWindow,
        );
        const ackDir: SimEvent["direction"] = op.side === "client" ? "server→client" : "client→server";
        emit("data_ack", `ACK: ack=${sock.sendNext} — ${dataSize}バイト確認応答`, ackDir, ackSeg);
        sendSegment(op.side === "client" ? "server" : "client", ackSeg);
        stats.ackSegments++;
        sock.sendUnack = sock.sendNext;
        break;
      }

      case "recv": {
        const sock = op.side === "client" ? client : server;
        const lastData = sock.recvBuffer[sock.recvBuffer.length - 1] ?? "";
        emit("data_recv", `${op.side}: recv() → "${lastData}" (${lastData.length}バイト)`, "local");
        break;
      }

      case "close": {
        const sock = op.side === "client" ? client : server;
        const peer = op.side === "client" ? server : client;
        const dir: SimEvent["direction"] = op.side === "client" ? "client→server" : "server→client";
        const revDir: SimEvent["direction"] = op.side === "client" ? "server→client" : "client→server";

        // FIN送信
        const finSeg = makeSegment(
          sock.localAddr.port, sock.remoteAddr.port,
          sock.sendNext, sock.recvNext, flags(false, true, true), sock.recvWindow,
        );
        const closeFrom = sock.state;
        if (closeFrom === "ESTABLISHED") {
          stateChange(op.side, closeFrom, "FIN_WAIT_1");
        } else if (closeFrom === "CLOSE_WAIT") {
          stateChange(op.side, closeFrom, "LAST_ACK");
        }
        emit("fin_send", `FIN送信: seq=${sock.sendNext}`, dir, finSeg);
        sendSegment(op.side, finSeg);
        stats.teardownSegments++;
        sock.sendNext++;

        // 相手がACKを返す
        peer.recvNext = sock.sendNext;
        const finAckSeg = makeSegment(
          peer.localAddr.port, peer.remoteAddr.port,
          peer.sendNext, sock.sendNext, flags(false, true), peer.recvWindow,
        );
        if (peer.state === "ESTABLISHED") {
          stateChange(op.side === "client" ? "server" : "client", "ESTABLISHED", "CLOSE_WAIT");
        }
        if (sock.state === "FIN_WAIT_1") {
          stateChange(op.side, "FIN_WAIT_1", "FIN_WAIT_2");
        }
        emit("fin_ack", `FIN ACK: ack=${sock.sendNext}`, revDir, finAckSeg);
        sendSegment(op.side === "client" ? "server" : "client", finAckSeg);
        stats.teardownSegments++;
        stats.ackSegments++;

        // 相手もFINを送る（同時クローズ簡略化）
        if (peer.state === "CLOSE_WAIT") {
          const peerFin = makeSegment(
            peer.localAddr.port, peer.remoteAddr.port,
            peer.sendNext, peer.recvNext, flags(false, true, true), peer.recvWindow,
          );
          stateChange(op.side === "client" ? "server" : "client", "CLOSE_WAIT", "LAST_ACK");
          emit("fin_send", `FIN送信: seq=${peer.sendNext}`, revDir, peerFin);
          sendSegment(op.side === "client" ? "server" : "client", peerFin);
          stats.teardownSegments++;
          peer.sendNext++;

          // 最終ACK
          sock.recvNext = peer.sendNext;
          const lastAck = makeSegment(
            sock.localAddr.port, sock.remoteAddr.port,
            sock.sendNext, peer.sendNext, flags(false, true), sock.recvWindow,
          );
          if (sock.state === "FIN_WAIT_2") {
            stateChange(op.side, "FIN_WAIT_2", "TIME_WAIT");
          }
          stateChange(op.side === "client" ? "server" : "client", "LAST_ACK", "CLOSED");
          emit("fin_ack", `最終ACK: ack=${peer.sendNext}`, dir, lastAck);
          sendSegment(op.side, lastAck);
          stats.teardownSegments++;
          stats.ackSegments++;

          emit("teardown_complete", `4ウェイ切断完了 (${op.side}はTIME_WAIT)`, "local");
        }
        break;
      }

      case "rst": {
        const sock = op.side === "client" ? client : server;
        const dir: SimEvent["direction"] = op.side === "client" ? "client→server" : "server→client";
        const rstSeg = makeSegment(
          sock.localAddr.port, sock.remoteAddr.port,
          sock.sendNext, 0, flags(false, false, false, true), 0,
        );
        emit("rst_send", `RST送信: コネクション異常切断`, dir, rstSeg);
        sendSegment(op.side, rstSeg);
        stats.totalSegments++;
        stateChange("client", client.state, "CLOSED");
        stateChange("server", server.state, "CLOSED");
        emit("rst_recv", `RST受信: コネクション強制リセット`, "local");
        break;
      }

      case "http_request": {
        const req = op.request;
        const raw = serializeHttpRequest(req);
        const dataSize = raw.length;
        emit("http_request_send", `HTTP ${req.method} ${req.path} HTTP/${req.version}`, "client→server");
        emit("http_parse", `ヘッダ: ${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join(", ")}`, "client→server");
        if (req.body) emit("http_parse", `ボディ: ${req.body.slice(0, 50)}${req.body.length > 50 ? "..." : ""}`, "client→server");

        // TCPデータ送信
        const dataSeg = makeSegment(
          client.localAddr.port, client.remoteAddr.port,
          client.sendNext, client.recvNext, flags(false, true, false, false, true),
          client.recvWindow, raw, dataSize,
        );
        sendSegment("client", dataSeg);
        stats.dataSegments++;
        client.sendNext += dataSize;

        // ACK
        server.recvNext = client.sendNext;
        const ackSeg = makeSegment(
          server.localAddr.port, server.remoteAddr.port,
          server.sendNext, client.sendNext, flags(false, true), server.recvWindow,
        );
        sendSegment("server", ackSeg);
        stats.ackSegments++;
        client.sendUnack = client.sendNext;

        emit("http_request_recv", `サーバーがHTTPリクエスト受信`, "local");

        const exchange = httpExchanges.find((e) => !e.request) ?? {};
        exchange.request = req;
        if (!httpExchanges.includes(exchange)) httpExchanges.push(exchange);
        break;
      }

      case "http_response": {
        const res = op.response;
        const raw = serializeHttpResponse(res);
        const dataSize = raw.length;
        emit("http_response_send", `HTTP/${res.version} ${res.statusCode} ${res.statusText}`, "server→client");
        emit("http_parse", `ヘッダ: ${Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join(", ")}`, "server→client");
        if (res.body) emit("http_parse", `ボディ: ${res.body.slice(0, 80)}${res.body.length > 80 ? "..." : ""}`, "server→client");

        // TCPデータ送信
        const dataSeg = makeSegment(
          server.localAddr.port, server.remoteAddr.port,
          server.sendNext, server.recvNext, flags(false, true, false, false, true),
          server.recvWindow, raw, dataSize,
        );
        sendSegment("server", dataSeg);
        stats.dataSegments++;
        server.sendNext += dataSize;

        // ACK
        client.recvNext = server.sendNext;
        const ackSeg = makeSegment(
          client.localAddr.port, client.remoteAddr.port,
          client.sendNext, server.sendNext, flags(false, true), client.recvWindow,
        );
        sendSegment("client", ackSeg);
        stats.ackSegments++;
        server.sendUnack = server.sendNext;

        emit("http_response_recv", `クライアントがHTTPレスポンス受信`, "local");

        // Keep-Alive判定
        if (res.version === "1.1" && res.headers["Connection"] !== "close") {
          emit("keep_alive", `Keep-Alive: コネクション維持（次のリクエストに再利用可能）`, "local");
        }

        const exchange = httpExchanges.find((e) => e.request && !e.response) ?? { request: undefined };
        exchange.response = res;
        if (!httpExchanges.includes(exchange)) httpExchanges.push(exchange);
        break;
      }
    }
  }

  return {
    events,
    clientSocket: client,
    serverSocket: server,
    segments,
    httpExchanges,
    stats,
  };
}
