/* QUIC プロトコル シミュレーションエンジン */

import type {
  QuicConnection, QuicPacket, QuicFrame, PacketHeader, PacketType,
  QuicStream, StreamDirection, EncryptionLevel,
  CongestionAlgo, CongestionState, NetworkCondition,
  SimOp, SimEvent, SimulationResult,
} from "./types.js";

// ─── 定数 ───

const INITIAL_CWND = 14720;         // 初期cwnd (bytes)
const MIN_CWND = 2 * 1200;          // 最小cwnd
const INITIAL_RTT = 333;            // 初期RTT推定 (ms)
const MAX_DATAGRAM_SIZE = 1200;     // UDPペイロード最大

// ─── 接続初期化 ───

/** QUIC接続を生成 */
export function createConnection(algo: CongestionAlgo = "new_reno"): QuicConnection {
  return {
    localCid: genCid(),
    remoteCid: genCid(),
    state: "idle",
    tls: {
      handshakeComplete: false,
      zeroRttEnabled: false,
      zeroRttAccepted: false,
      messages: [],
      cipherSuite: "TLS_AES_128_GCM_SHA256",
      alpn: "h3",
    },
    streams: [],
    flowControl: {
      connSendBytes: 0, connRecvBytes: 0,
      connMaxSend: 65536, connMaxRecv: 65536,
      blocked: false,
    },
    congestion: {
      algo,
      cwnd: INITIAL_CWND,
      ssthresh: Infinity,
      phase: "slow_start",
      bytesInFlight: 0,
      smoothedRtt: INITIAL_RTT,
      rttVar: INITIAL_RTT / 2,
      minRtt: Infinity,
      pto: INITIAL_RTT * 3,
      cwndHistory: [{ time: 0, cwnd: INITIAL_CWND }],
    },
    sentPackets: [],
    recvPackets: [],
    nextPacketNumber: 0,
    paths: [{
      id: 0, localAddr: "192.168.1.100:49152",
      remoteAddr: "203.0.113.1:443",
      active: true, validated: true, rtt: 0,
    }],
    currentTime: 0,
    maxStreams: { bidi: 100, uni: 100 },
  };
}

/** コネクションID生成 */
function genCid(): string {
  const hex = "0123456789abcdef";
  let cid = "";
  for (let i = 0; i < 16; i++) cid += hex[Math.floor(Math.random() * 16)];
  return cid;
}

// ─── パケット生成 ───

/** パケット生成 */
function mkPacket(
  conn: QuicConnection, ptype: PacketType, frames: QuicFrame[],
  encLevel: EncryptionLevel,
): QuicPacket {
  const pn = conn.nextPacketNumber++;
  const size = 40 + frames.reduce((s, f) => s + (f.length ?? 10), 0);
  const hdr: PacketHeader = {
    type: ptype, version: 1,
    dcid: conn.remoteCid, scid: conn.localCid,
    packetNumber: pn,
    longHeader: ptype !== "one_rtt",
  };
  return {
    header: hdr, frames, size,
    sentTime: conn.currentTime, encLevel,
    acked: false, lost: false,
  };
}

/** ACKフレーム生成 */
function mkAckFrame(packets: QuicPacket[]): QuicFrame {
  const pns = packets.map(p => p.header.packetNumber).sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const pn of pns) {
    const last = ranges[ranges.length - 1];
    if (last && pn === last.end + 1) {
      last.end = pn;
    } else {
      ranges.push({ start: pn, end: pn });
    }
  }
  return { type: "ack", ackRanges: ranges, ackDelay: 0 };
}

// ─── ハンドシェイク ───

/** 1-RTTハンドシェイク実行 */
function doHandshake(
  conn: QuicConnection, network: NetworkCondition,
  events: SimEvent[],
): void {
  const rtt = network.latency * 2;

  // クライアント → Initial (ClientHello)
  conn.state = "handshake_initial";
  const clientHello = mkPacket(conn, "initial", [
    { type: "crypto", cryptoData: "ClientHello", length: 300 },
    { type: "padding", length: 1200 - 300 }, // Initialは1200バイト以上
  ], "initial");
  conn.sentPackets.push(clientHello);
  conn.tls.messages.push("client_hello");

  events.push({
    time: conn.currentTime, type: "handshake",
    message: "Client → Initial (ClientHello) 送信",
    detail: `DCID=${conn.remoteCid.slice(0, 8)}… SCID=${conn.localCid.slice(0, 8)}…`,
  });
  events.push({
    time: conn.currentTime, type: "tls",
    message: "TLS 1.3: ClientHello (暗号スイート提案、ALPN=h3)",
  });

  // サーバー → Initial (ServerHello) + Handshake
  conn.currentTime += network.latency;
  conn.state = "handshake_server";

  const serverHello = mkPacket(conn, "initial", [
    { type: "crypto", cryptoData: "ServerHello", length: 150 },
    { type: "ack", ackRanges: [{ start: 0, end: 0 }] },
  ], "initial");
  conn.recvPackets.push(serverHello);
  conn.tls.messages.push("server_hello");

  events.push({
    time: conn.currentTime, type: "handshake",
    message: "Server → Initial (ServerHello + ACK) 受信",
  });
  events.push({
    time: conn.currentTime, type: "tls",
    message: "TLS 1.3: ServerHello (鍵交換完了、暗号スイート決定)",
  });

  // サーバー → Handshake (EE, Cert, CertVerify, Finished)
  const hsPacket = mkPacket(conn, "handshake", [
    { type: "crypto", cryptoData: "EncryptedExtensions", length: 50 },
    { type: "crypto", cryptoData: "Certificate", length: 800 },
    { type: "crypto", cryptoData: "CertificateVerify", length: 100 },
    { type: "crypto", cryptoData: "Finished", length: 50 },
  ], "handshake");
  conn.recvPackets.push(hsPacket);
  conn.tls.messages.push("encrypted_extensions", "certificate", "certificate_verify", "finished");

  events.push({
    time: conn.currentTime, type: "tls",
    message: "TLS 1.3: EncryptedExtensions + Certificate + CertVerify + Finished",
    detail: `暗号スイート: ${conn.tls.cipherSuite}`,
  });

  // クライアント → Handshake (Finished) + 1-RTT
  conn.currentTime += network.latency;
  conn.state = "handshake_complete";

  const clientFinished = mkPacket(conn, "handshake", [
    { type: "crypto", cryptoData: "Finished", length: 50 },
    { type: "ack", ackRanges: [{ start: 1, end: 2 }] },
  ], "handshake");
  conn.sentPackets.push(clientFinished);

  // HANDSHAKE_DONE フレーム
  const hsDone = mkPacket(conn, "one_rtt", [
    { type: "handshake_done" },
  ], "one_rtt");
  conn.recvPackets.push(hsDone);

  conn.tls.handshakeComplete = true;
  conn.state = "connected";

  // RTT更新
  updateRtt(conn.congestion, rtt);

  events.push({
    time: conn.currentTime, type: "handshake",
    message: `ハンドシェイク完了 (1-RTT = ${rtt}ms)`,
    detail: "HANDSHAKE_DONE受信 → 1-RTTキー確立",
  });
}

/** 0-RTTハンドシェイク実行 */
function doHandshake0Rtt(
  conn: QuicConnection, network: NetworkCondition,
  events: SimEvent[],
): void {
  conn.tls.zeroRttEnabled = true;
  conn.tls.sessionTicket = "session_ticket_" + genCid().slice(0, 8);

  // クライアント → Initial (ClientHello) + 0-RTTデータ
  conn.state = "handshake_initial";

  const clientHello = mkPacket(conn, "initial", [
    { type: "crypto", cryptoData: "ClientHello+PSK", length: 350 },
    { type: "padding", length: 1200 - 350 },
  ], "initial");
  conn.sentPackets.push(clientHello);
  conn.tls.messages.push("client_hello");

  events.push({
    time: conn.currentTime, type: "zero_rtt",
    message: "Client → Initial (ClientHello + PSK) + 0-RTTデータ",
    detail: `セッションチケット: ${conn.tls.sessionTicket}`,
  });

  // 0-RTTパケット（早期データ送信）
  const zeroRttPkt = mkPacket(conn, "zero_rtt", [
    { type: "stream", streamId: 0, offset: 0, length: 200, fin: false },
  ], "zero_rtt");
  conn.sentPackets.push(zeroRttPkt);

  events.push({
    time: conn.currentTime, type: "zero_rtt",
    message: "Client → 0-RTTデータ送信 (ハンドシェイク完了前にデータ転送)",
    detail: "早期データ: 200 bytes on Stream 0",
  });

  // ストリーム作成
  conn.streams.push({
    id: 0, state: "open", direction: "bidi",
    initiator: "client", sendOffset: 200, recvOffset: 0,
    sendBuf: 200, recvBuf: 0, maxStreamData: 65536,
    finSent: false, finRecv: false,
  });

  // サーバー応答
  conn.currentTime += network.latency;
  conn.state = "handshake_server";

  const serverHello = mkPacket(conn, "initial", [
    { type: "crypto", cryptoData: "ServerHello+PSK", length: 150 },
    { type: "ack", ackRanges: [{ start: 0, end: 1 }] },
  ], "initial");
  conn.recvPackets.push(serverHello);
  conn.tls.messages.push("server_hello");
  conn.tls.zeroRttAccepted = true;

  events.push({
    time: conn.currentTime, type: "zero_rtt",
    message: "Server → 0-RTTデータ受理 (early_data accepted)",
  });

  // サーバー Handshake + Finished
  const hsPacket = mkPacket(conn, "handshake", [
    { type: "crypto", cryptoData: "EncryptedExtensions+EarlyDataAccepted", length: 80 },
    { type: "crypto", cryptoData: "Finished", length: 50 },
  ], "handshake");
  conn.recvPackets.push(hsPacket);
  conn.tls.messages.push("encrypted_extensions", "finished");

  events.push({
    time: conn.currentTime, type: "tls",
    message: "TLS 1.3: EE(early_data=accepted) + Finished",
  });

  // クライアント確認
  conn.currentTime += network.latency;
  conn.state = "connected";
  conn.tls.handshakeComplete = true;

  const rtt = network.latency * 2;
  updateRtt(conn.congestion, rtt);

  const clientFin = mkPacket(conn, "handshake", [
    { type: "crypto", cryptoData: "Finished", length: 50 },
    { type: "ack", ackRanges: [{ start: 2, end: 4 }] },
  ], "handshake");
  conn.sentPackets.push(clientFin);

  conn.recvPackets.push(mkPacket(conn, "one_rtt", [
    { type: "handshake_done" },
    { type: "new_token", length: 100 },
  ], "one_rtt"));
  conn.tls.messages.push("new_session_ticket");

  events.push({
    time: conn.currentTime, type: "handshake",
    message: `ハンドシェイク完了 (0-RTTでデータ先行送信済み, 確認=${rtt}ms)`,
  });
}

// ─── データ転送 ───

/** ストリームオープン */
function openStream(
  conn: QuicConnection, direction: StreamDirection, events: SimEvent[],
): QuicStream {
  // ストリームID: client-initiated bidi=0,4,8... uni=2,6,10...
  const existing = conn.streams.filter(s => s.direction === direction && s.initiator === "client");
  const base = direction === "bidi" ? 0 : 2;
  const id = base + existing.length * 4;

  const stream: QuicStream = {
    id, state: "open", direction, initiator: "client",
    sendOffset: 0, recvOffset: 0, sendBuf: 0, recvBuf: 0,
    maxStreamData: 65536, finSent: false, finRecv: false,
  };
  conn.streams.push(stream);

  events.push({
    time: conn.currentTime, type: "stream",
    message: `ストリーム #${id} オープン (${direction}, client-initiated)`,
  });

  return stream;
}

/** データ送信 */
function sendData(
  conn: QuicConnection, streamId: number, size: number,
  network: NetworkCondition, events: SimEvent[],
): void {
  const stream = conn.streams.find(s => s.id === streamId);
  if (!stream) return;
  if (conn.state !== "connected") return;

  let remaining = size;
  let segmentCount = 0;
  let iterations = 0;
  const maxIterations = 500; // 無限ループ防止

  while (remaining > 0 && iterations++ < maxIterations) {
    // フロー制御チェック
    const connAvail = conn.flowControl.connMaxSend - conn.flowControl.connSendBytes;
    const streamAvail = stream.maxStreamData - stream.sendOffset;
    const cwndAvail = conn.congestion.cwnd - conn.congestion.bytesInFlight;

    if (connAvail <= 0) {
      conn.flowControl.blocked = true;
      events.push({
        time: conn.currentTime, type: "flow_control",
        message: `コネクションレベル フロー制御ブロック (送信=${conn.flowControl.connSendBytes}/${conn.flowControl.connMaxSend})`,
      });
      // MAX_DATA受信をシミュレート
      conn.flowControl.connMaxSend += 65536;
      conn.currentTime += network.latency;
      const maxDataPkt = mkPacket(conn, "one_rtt", [
        { type: "max_data", maxData: conn.flowControl.connMaxSend },
      ], "one_rtt");
      conn.recvPackets.push(maxDataPkt);
      events.push({
        time: conn.currentTime, type: "flow_control",
        message: `MAX_DATA受信: 上限=${conn.flowControl.connMaxSend} bytes`,
      });
      conn.flowControl.blocked = false;
      continue;
    }

    if (streamAvail <= 0) {
      stream.maxStreamData += 32768;
      const maxStreamPkt = mkPacket(conn, "one_rtt", [
        { type: "max_stream_data", streamId, maxData: stream.maxStreamData },
      ], "one_rtt");
      conn.recvPackets.push(maxStreamPkt);
      events.push({
        time: conn.currentTime, type: "flow_control",
        message: `MAX_STREAM_DATA受信 (stream #${streamId}): 上限=${stream.maxStreamData}`,
      });
      continue;
    }

    // 輻輳ウィンドウチェック
    if (cwndAvail <= 0) {
      // ACK待ち → cwnd解放
      conn.currentTime += conn.congestion.smoothedRtt;
      processAcks(conn, events);
      continue;
    }

    const chunkSize = Math.min(remaining, MAX_DATAGRAM_SIZE - 40, connAvail, streamAvail, cwndAvail);
    const isLast = remaining <= chunkSize;

    const pkt = mkPacket(conn, "one_rtt", [{
      type: "stream", streamId, offset: stream.sendOffset,
      length: chunkSize, fin: isLast,
    }], "one_rtt");
    conn.sentPackets.push(pkt);

    stream.sendOffset += chunkSize;
    stream.sendBuf += chunkSize;
    conn.flowControl.connSendBytes += chunkSize;
    conn.congestion.bytesInFlight += pkt.size;
    remaining -= chunkSize;
    segmentCount++;

    if (isLast) stream.finSent = true;

    // パケットロスシミュレーション
    if (Math.random() < network.lossRate) {
      pkt.lost = true;
      events.push({
        time: conn.currentTime, type: "packet_lost",
        message: `パケット #${pkt.header.packetNumber} ロスト (stream #${streamId}, ${chunkSize}bytes)`,
      });
      // 輻輳制御にロスを通知
      onPacketLoss(conn.congestion, pkt.size, conn.currentTime);
    }
  }

  // バッチACK処理
  conn.currentTime += network.latency;
  processAcks(conn, events);

  events.push({
    time: conn.currentTime, type: "packet_sent",
    message: `Stream #${streamId}: ${size} bytes 送信完了 (${segmentCount}パケット)`,
    detail: `cwnd=${conn.congestion.cwnd} bytesInFlight=${conn.congestion.bytesInFlight}`,
  });
}

/** ACK処理 */
function processAcks(conn: QuicConnection, events: SimEvent[]): void {
  const unacked = conn.sentPackets.filter(p => !p.acked && !p.lost);
  if (unacked.length === 0) return;

  // ロストでないパケットをACK
  let ackedBytes = 0;
  for (const pkt of unacked) {
    pkt.acked = true;
    ackedBytes += pkt.size;
    conn.congestion.bytesInFlight = Math.max(0, conn.congestion.bytesInFlight - pkt.size);
  }

  // ACKフレーム受信
  const ackFrame = mkAckFrame(unacked);
  const ackPkt = mkPacket(conn, "one_rtt", [ackFrame], "one_rtt");
  conn.recvPackets.push(ackPkt);

  // 輻輳ウィンドウ更新
  onAckReceived(conn.congestion, ackedBytes, conn.currentTime);

  // ロストパケットの再送（bytesInFlightから除外し再送）
  const lostPackets = conn.sentPackets.filter(p => p.lost && !p.acked);
  for (const lp of lostPackets) {
    conn.congestion.bytesInFlight = Math.max(0, conn.congestion.bytesInFlight - lp.size);
    lp.acked = true; // 元パケットは処理済み
    const retransPkt = mkPacket(conn, "one_rtt", lp.frames, "one_rtt");
    conn.sentPackets.push(retransPkt);
    conn.congestion.bytesInFlight += retransPkt.size;
    events.push({
      time: conn.currentTime, type: "packet_sent",
      message: `パケット #${retransPkt.header.packetNumber} 再送 (元=#${lp.header.packetNumber})`,
    });
  }
}

// ─── 輻輳制御 ───

/** RTT更新 */
function updateRtt(cc: CongestionState, rttSample: number): void {
  if (cc.minRtt === Infinity) {
    cc.smoothedRtt = rttSample;
    cc.rttVar = rttSample / 2;
    cc.minRtt = rttSample;
  } else {
    cc.minRtt = Math.min(cc.minRtt, rttSample);
    cc.rttVar = 0.75 * cc.rttVar + 0.25 * Math.abs(cc.smoothedRtt - rttSample);
    cc.smoothedRtt = 0.875 * cc.smoothedRtt + 0.125 * rttSample;
  }
  cc.pto = cc.smoothedRtt + Math.max(4 * cc.rttVar, 1) + 0;
}

/** ACK受信時の輻輳制御 */
function onAckReceived(cc: CongestionState, ackedBytes: number, time: number): void {
  if (cc.phase === "slow_start") {
    // スロースタート: ACKごとにcwndを増加
    cc.cwnd += ackedBytes;
    if (cc.cwnd >= cc.ssthresh) {
      cc.phase = "congestion_avoidance";
    }
  } else if (cc.phase === "congestion_avoidance") {
    // 輻輳回避: cwndを1MSS/RTTずつ増加
    if (cc.algo === "new_reno") {
      cc.cwnd += Math.floor(MAX_DATAGRAM_SIZE * ackedBytes / cc.cwnd);
    } else if (cc.algo === "cubic") {
      // 簡易CUBIC: 時間ベースの3次関数
      const k = Math.cbrt(cc.ssthresh * 0.3 / 0.4);
      const t = (time / 1000) - k;
      const target = Math.floor(0.4 * t * t * t + cc.ssthresh);
      cc.cwnd = Math.max(cc.cwnd, target);
    } else if (cc.algo === "bbr") {
      // 簡易BBR: 帯域推定に基づくペーシング
      const bdp = Math.floor((cc.cwnd / cc.smoothedRtt) * cc.minRtt);
      cc.cwnd = Math.max(bdp * 2, cc.cwnd + MAX_DATAGRAM_SIZE);
    }
  } else if (cc.phase === "recovery") {
    // リカバリ完了判定
    cc.phase = "congestion_avoidance";
  }

  cc.cwndHistory.push({ time, cwnd: cc.cwnd });
}

/** パケットロス時の輻輳制御 */
function onPacketLoss(cc: CongestionState, _lostBytes: number, time: number): void {
  if (cc.phase !== "recovery") {
    cc.phase = "recovery";
    cc.ssthresh = Math.max(Math.floor(cc.cwnd / 2), MIN_CWND);
    cc.cwnd = cc.ssthresh;
    cc.cwndHistory.push({ time, cwnd: cc.cwnd });
  }
}

// ─── ストリーム操作 ───

/** ストリームクローズ */
function closeStream(
  conn: QuicConnection, streamId: number, events: SimEvent[],
): void {
  const stream = conn.streams.find(s => s.id === streamId);
  if (!stream) return;

  stream.state = "closed";
  stream.finSent = true;
  stream.finRecv = true;

  const pkt = mkPacket(conn, "one_rtt", [{
    type: "stream", streamId, offset: stream.sendOffset,
    length: 0, fin: true,
  }], "one_rtt");
  conn.sentPackets.push(pkt);

  events.push({
    time: conn.currentTime, type: "stream",
    message: `ストリーム #${streamId} クローズ (FIN送信)`,
  });
}

// ─── コネクションマイグレーション ───

/** パスマイグレーション */
function migratePath(
  conn: QuicConnection, newAddr: string,
  network: NetworkCondition, events: SimEvent[],
): void {
  // 現在のパスを非アクティブに
  for (const p of conn.paths) p.active = false;

  const newPathId = conn.paths.length;
  const challenge = genCid().slice(0, 16);

  conn.paths.push({
    id: newPathId, localAddr: newAddr,
    remoteAddr: conn.paths[0]!.remoteAddr,
    active: true, validated: false,
    challenge, rtt: 0,
  });

  // PATH_CHALLENGE送信
  const challengePkt = mkPacket(conn, "one_rtt", [{
    type: "path_challenge", challengeData: challenge,
  }], "one_rtt");
  conn.sentPackets.push(challengePkt);

  events.push({
    time: conn.currentTime, type: "migration",
    message: `コネクションマイグレーション開始: ${newAddr}`,
    detail: `PATH_CHALLENGE送信 (data=${challenge.slice(0, 8)}…)`,
  });

  // PATH_RESPONSE受信（パス検証完了）
  conn.currentTime += network.latency;
  const responsePkt = mkPacket(conn, "one_rtt", [{
    type: "path_response", challengeData: challenge,
  }], "one_rtt");
  conn.recvPackets.push(responsePkt);

  const path = conn.paths[newPathId];
  if (path) {
    path.validated = true;
    path.rtt = network.latency * 2;
  }

  // 新しいコネクションIDを発行
  conn.localCid = genCid();
  const newCidPkt = mkPacket(conn, "one_rtt", [{
    type: "new_connection_id", length: 16,
  }], "one_rtt");
  conn.sentPackets.push(newCidPkt);

  events.push({
    time: conn.currentTime, type: "migration",
    message: `パス検証完了 → 新パス有効 (新CID=${conn.localCid.slice(0, 8)}…)`,
    detail: `PATH_RESPONSE受信, RTT=${path?.rtt ?? 0}ms`,
  });
}

// ─── コネクションクローズ ───

/** 接続クローズ */
function closeConnection(conn: QuicConnection, events: SimEvent[]): void {
  conn.state = "closing";

  const closePkt = mkPacket(conn, "one_rtt", [{
    type: "connection_close", errorCode: 0,
  }], "one_rtt");
  conn.sentPackets.push(closePkt);

  events.push({
    time: conn.currentTime, type: "close",
    message: "CONNECTION_CLOSE送信 (error_code=0x00, No Error)",
  });

  // ドレイン期間 (3*PTO)
  const drainTime = 3 * conn.congestion.pto;
  conn.state = "draining";
  events.push({
    time: conn.currentTime, type: "close",
    message: `ドレイン期間開始 (${Math.round(drainTime)}ms)`,
  });

  conn.currentTime += drainTime;
  conn.state = "closed";
  events.push({
    time: conn.currentTime, type: "close",
    message: "接続クローズ完了",
  });
}

// ─── 強制ロスト ───

/** 特定パケットを強制ロスト */
function triggerLoss(
  conn: QuicConnection, packetNumbers: number[], events: SimEvent[],
): void {
  for (const pn of packetNumbers) {
    const pkt = conn.sentPackets.find(p => p.header.packetNumber === pn);
    if (pkt && !pkt.acked) {
      pkt.lost = true;
      onPacketLoss(conn.congestion, pkt.size, conn.currentTime);
      events.push({
        time: conn.currentTime, type: "packet_lost",
        message: `パケット #${pn} 強制ロスト → cwnd=${conn.congestion.cwnd}`,
      });
    }
  }
}

// ─── メインシミュレーション ───

/** シミュレーション実行 */
export function simulate(
  ops: SimOp[],
  network: NetworkCondition,
  congestionAlgo: CongestionAlgo = "new_reno",
): SimulationResult {
  const conn = createConnection(congestionAlgo);
  const events: SimEvent[] = [];
  let handshakeRtts = 0;

  events.push({
    time: 0, type: "info",
    message: `QUICシミュレーション開始 (輻輳制御: ${congestionAlgo}, RTT: ${network.latency * 2}ms, ロス率: ${(network.lossRate * 100).toFixed(1)}%)`,
  });

  for (const op of ops) {
    switch (op.type) {
      case "connect":
        doHandshake(conn, network, events);
        handshakeRtts = 1;
        break;

      case "connect_0rtt":
        doHandshake0Rtt(conn, network, events);
        handshakeRtts = 0; // 0-RTTでデータ送信開始
        break;

      case "open_stream":
        openStream(conn, op.direction, events);
        break;

      case "send_data":
        sendData(conn, op.streamId, op.size, network, events);
        break;

      case "close_stream":
        closeStream(conn, op.streamId, events);
        break;

      case "migrate_path":
        migratePath(conn, op.newAddr, network, events);
        break;

      case "trigger_loss":
        triggerLoss(conn, op.packetNumbers, events);
        break;

      case "update_network":
        if (op.condition.latency !== undefined) network.latency = op.condition.latency;
        if (op.condition.lossRate !== undefined) network.lossRate = op.condition.lossRate;
        if (op.condition.bandwidth !== undefined) network.bandwidth = op.condition.bandwidth;
        events.push({
          time: conn.currentTime, type: "info",
          message: `ネットワーク条件変更: latency=${network.latency}ms, loss=${(network.lossRate * 100).toFixed(1)}%`,
        });
        break;

      case "close_connection":
        closeConnection(conn, events);
        break;

      case "tick":
        conn.currentTime += op.ms;
        break;
    }
  }

  const lostPackets = conn.sentPackets.filter(p => p.lost).length;
  const retransmitted = conn.sentPackets.filter(p =>
    p.frames.some(f => f.type === "stream") && p.header.packetNumber > 0
  ).length;

  return {
    connection: conn,
    events,
    handshakeRtts,
    totalBytesSent: conn.flowControl.connSendBytes,
    lostPackets,
    retransmittedPackets: Math.max(0, retransmitted - conn.streams.length),
  };
}
