/**
 * node.ts — ネットワークノード（プロトコルスタックを持つ機器）
 *
 * 各ノードは以下のレイヤーを実際に処理する:
 *   L2: ARP テーブル管理、Ethernet フレームの送受信
 *   L3: IP ルーティング、TTL 減算
 *   L4: TCP 状態管理、3ウェイハンドシェイク、シーケンス番号
 *   L7: HTTP リクエスト/レスポンス
 */
import type {
  ArpEntry, ArpPacket, RouteEntry,
  TcpState, TcpFlags, StackEvent,
  HttpRequest, HttpResponse,
} from "../stack/types.js";
import { TcpState as TcpStateEnum } from "../stack/types.js";
import {
  serializeEthernet, deserializeEthernet,
  serializeArp, deserializeArp,
  serializeIp, deserializeIp,
  serializeTcp, deserializeTcp,
  serializeHttpRequest, serializeHttpResponse,
  deserializeHttpRequest,
  tcpFlagsToString,
} from "../stack/serialize.js";
import type { Link } from "./link.js";

// NIC 情報
interface Nic {
  name: string;
  mac: string;
  ip: string;
  subnetMask: string;
  link: Link | undefined;
}

// TCP コネクション
interface TcpConnection {
  state: TcpState;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  sendSeq: number;       // 次に送るシーケンス番号
  recvAck: number;       // 次に期待するシーケンス番号
  recvBuffer: Uint8Array; // 受信バッファ
}

// HTTP リクエストハンドラ（サーバ側）
type HttpHandler = (req: HttpRequest) => HttpResponse;

export class NetworkNode {
  readonly name: string;
  readonly nics: Nic[] = [];
  readonly arpTable: ArpEntry[] = [];
  readonly routeTable: RouteEntry[] = [];
  readonly events: StackEvent[] = [];

  // TCP コネクションテーブル
  private tcpConnections = new Map<string, TcpConnection>();
  private nextEphemeralPort = 49152;

  // サーバモード: HTTP ハンドラ
  private httpHandler: HttpHandler | undefined;
  // リッスンポート
  private listenPorts = new Set<number>();

  // IP転送（ルータモード）
  ipForwardingEnabled = false;
  // NAT（ルータモード）
  natEnabled = false;
  private natTable = new Map<string, { originalSrcIp: string; originalSrcPort: number }>();

  // イベントコールバック
  onEvent: ((event: StackEvent) => void) | undefined;

  private startTime = performance.now();

  constructor(name: string) {
    this.name = name;
  }

  private timestamp(): number {
    return performance.now() - this.startTime;
  }

  private emit(event: StackEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  resetEvents(): void {
    this.events.length = 0;
    this.startTime = performance.now();
  }

  // =========================================================
  // NIC 管理
  // =========================================================
  addNic(name: string, mac: string, ip: string, subnetMask: string): Nic {
    const nic: Nic = { name, mac, ip, subnetMask, link: undefined };
    this.nics.push(nic);
    return nic;
  }

  connectLink(nicName: string, link: Link): void {
    const nic = this.nics.find(n => n.name === nicName);
    if (nic === undefined) throw new Error(`NIC ${nicName} が見つかりません`);
    nic.link = link;
    link.attach(`${this.name}:${nicName}`, (frame) => this.onFrameReceived(frame, nicName));
  }

  // =========================================================
  // ルーティング
  // =========================================================
  addRoute(network: string, mask: string, gateway: string, iface: string): void {
    this.routeTable.push({ network, mask, gateway, iface });
  }

  addDefaultRoute(gateway: string, iface: string): void {
    this.routeTable.push({ network: "0.0.0.0", mask: "0.0.0.0", gateway, iface });
  }

  // ARP テーブルに静的エントリを追加
  addArpEntry(ip: string, mac: string): void {
    this.arpTable.push({ ip, mac });
  }

  // =========================================================
  // サーバモード
  // =========================================================
  listen(port: number, handler: HttpHandler): void {
    this.listenPorts.add(port);
    this.httpHandler = handler;
  }

  // =========================================================
  // L2: Ethernet フレーム送信
  // =========================================================
  private sendFrame(nic: Nic, dstMac: string, etherType: number, payload: Uint8Array): void {
    const frame = serializeEthernet({ srcMac: nic.mac, dstMac, etherType, payload });
    this.emit({
      type: "ethernet_send", srcMac: nic.mac, dstMac, etherType, size: frame.length,
      iface: nic.name, timestamp: this.timestamp(),
    });
    nic.link?.transmit(frame, `${this.name}:${nic.name}`);
  }

  // L2: Ethernet フレーム受信
  private onFrameReceived(frameData: Uint8Array, nicName: string): void {
    const frame = deserializeEthernet(frameData);
    const nic = this.nics.find(n => n.name === nicName);
    if (nic === undefined) return;

    // 自分宛 or ブロードキャストのみ受け取る
    if (frame.dstMac !== nic.mac && frame.dstMac !== "FF:FF:FF:FF:FF:FF") return;

    this.emit({
      type: "ethernet_recv", srcMac: frame.srcMac, dstMac: frame.dstMac, etherType: frame.etherType,
      size: frameData.length, iface: nicName, timestamp: this.timestamp(),
    });

    if (frame.etherType === 0x0806) {
      // ARP
      this.handleArp(frame.payload, nic);
    } else if (frame.etherType === 0x0800) {
      // IPv4
      this.handleIpPacket(frame.payload, nic);
    }
  }

  // =========================================================
  // ARP 処理
  // =========================================================
  private handleArp(data: Uint8Array, nic: Nic): void {
    const arp = deserializeArp(data);

    // ARP テーブルに送信元を学習
    this.learnArp(arp.senderIp, arp.senderMac);

    if (arp.operation === 1 && arp.targetIp === nic.ip) {
      // ARP リクエスト → リプライを返す
      this.emit({ type: "arp_request", srcIp: arp.senderIp, srcMac: arp.senderMac, targetIp: arp.targetIp, timestamp: this.timestamp() });
      const reply: ArpPacket = {
        operation: 2,
        senderMac: nic.mac,
        senderIp: nic.ip,
        targetMac: arp.senderMac,
        targetIp: arp.senderIp,
      };
      this.emit({ type: "arp_reply", srcIp: nic.ip, srcMac: nic.mac, targetIp: arp.senderIp, targetMac: arp.senderMac, timestamp: this.timestamp() });
      this.sendFrame(nic, arp.senderMac, 0x0806, serializeArp(reply));
    } else if (arp.operation === 2) {
      // ARP リプライ → テーブルに登録済み
      this.emit({ type: "arp_reply", srcIp: arp.senderIp, srcMac: arp.senderMac, targetIp: arp.targetIp, targetMac: arp.targetMac, timestamp: this.timestamp() });
    }
  }

  private learnArp(ip: string, mac: string): void {
    const existing = this.arpTable.find(e => e.ip === ip);
    if (existing !== undefined) {
      existing.mac = mac;
    } else {
      this.arpTable.push({ ip, mac });
    }

    // ARP 解決待ちキューに保留中のパケットがあれば送信
    const pending = this.arpPendingQueue.get(ip);
    if (pending !== undefined) {
      this.arpPendingQueue.delete(ip);
      for (const { nic, ipData } of pending) {
        this.sendFrame(nic, mac, 0x0800, ipData);
      }
    }
  }

  sendArpRequest(targetIp: string, nicName: string): void {
    const nic = this.nics.find(n => n.name === nicName);
    if (nic === undefined) return;
    const req: ArpPacket = {
      operation: 1,
      senderMac: nic.mac,
      senderIp: nic.ip,
      targetMac: "00:00:00:00:00:00",
      targetIp,
    };
    this.emit({ type: "arp_request", srcIp: nic.ip, srcMac: nic.mac, targetIp, timestamp: this.timestamp() });
    this.sendFrame(nic, "FF:FF:FF:FF:FF:FF", 0x0806, serializeArp(req));
  }

  // ARP 解決待ちキュー: MACが不明な時にIPパケットを保留する
  private arpPendingQueue = new Map<string, { nic: Nic; ipData: Uint8Array }[]>();

  // MAC アドレスを解決する（ARP テーブルから）
  private resolveMac(ip: string): string | undefined {
    return this.arpTable.find(e => e.ip === ip)?.mac;
  }

  // =========================================================
  // L3: IP パケット処理
  // =========================================================
  private handleIpPacket(data: Uint8Array, receivedNic: Nic): void {
    const packet = deserializeIp(data);
    this.emit({
      type: "ip_recv", srcIp: packet.header.srcIp, dstIp: packet.header.dstIp,
      protocol: packet.header.protocol, size: data.length, timestamp: this.timestamp(),
    });

    // NAT 逆変換（ルータモード: 応答パケットの宛先を元に戻す）
    if (this.natEnabled) {
      const natKey = `${packet.header.dstIp}:${String(this.peekTcpDstPort(packet.payload))}`;
      const natEntry = this.natTable.get(natKey);
      if (natEntry !== undefined) {
        this.emit({
          type: "ip_nat", originalSrc: packet.header.dstIp,
          translatedSrc: natEntry.originalSrcIp, dstIp: packet.header.srcIp, timestamp: this.timestamp(),
        });
        packet.header.dstIp = natEntry.originalSrcIp;
        // TCP ポートも戻す
        this.patchTcpDstPort(packet.payload, natEntry.originalSrcPort);
      }
    }

    // 自分宛か？
    const isForMe = this.nics.some(n => n.ip === packet.header.dstIp);
    if (isForMe) {
      if (packet.header.protocol === 6) {
        this.handleTcpSegment(packet.payload, packet.header.srcIp, packet.header.dstIp);
      }
      return;
    }

    // IP 転送（ルータモード）
    if (this.ipForwardingEnabled) {
      this.forwardIpPacket(packet, receivedNic);
    }
  }

  // IP パケットを送信
  sendIpPacket(dstIp: string, protocol: number, payload: Uint8Array): void {
    // ルーティングテーブルから出力インターフェースとネクストホップを決定
    const route = this.findRoute(dstIp);
    if (route === undefined) return;

    const nic = this.nics.find(n => n.name === route.iface);
    if (nic === undefined) return;

    const nextHop = route.gateway === "0.0.0.0" ? dstIp : route.gateway;
    this.emit({
      type: "route_lookup", dstIp, nextHop, iface: route.iface, timestamp: this.timestamp(),
    });

    const ipData = serializeIp({
      header: { version: 4, headerLength: 20, ttl: 64, protocol, srcIp: nic.ip, dstIp },
      payload,
    });

    this.emit({
      type: "ip_send", srcIp: nic.ip, dstIp, protocol, ttl: 64,
      size: ipData.length, timestamp: this.timestamp(),
    });

    // MAC アドレス解決（不明なら ARP で問い合わせ、応答後に送信）
    const dstMac = this.resolveMac(nextHop);
    if (dstMac === undefined) {
      this.enqueueForArp(nextHop, nic, ipData);
      return;
    }

    this.sendFrame(nic, dstMac, 0x0800, ipData);
  }

  // ARP で MAC を解決してからパケットを送信する
  private enqueueForArp(targetIp: string, nic: Nic, ipData: Uint8Array): void {
    const existing = this.arpPendingQueue.get(targetIp);
    if (existing !== undefined) {
      existing.push({ nic, ipData });
    } else {
      this.arpPendingQueue.set(targetIp, [{ nic, ipData }]);
    }
    // ARP リクエストを送信
    this.sendArpRequest(targetIp, nic.name);
  }

  // IP パケット転送（ルータ）
  private forwardIpPacket(packet: ReturnType<typeof deserializeIp>, receivedNic: Nic): void {
    const route = this.findRoute(packet.header.dstIp);
    if (route === undefined) return;

    const outNic = this.nics.find(n => n.name === route.iface);
    if (outNic === undefined) return;

    this.emit({
      type: "ip_forward", srcIp: packet.header.srcIp, dstIp: packet.header.dstIp,
      fromIface: receivedNic.name, toIface: outNic.name, timestamp: this.timestamp(),
    });

    // NAT（LAN→WAN方向のみ: 送信元IPをルータのWAN側IPに変換）
    // 受信NICがLAN側かつ送信NICがWAN側の場合のみ適用
    let srcIp = packet.header.srcIp;
    const isLanToWan = this.isPrivateIp(packet.header.srcIp) && !this.isPrivateIp(outNic.ip);
    if (this.natEnabled && isLanToWan) {
      const srcPort = this.peekTcpSrcPort(packet.payload);
      this.emit({
        type: "ip_nat", originalSrc: srcIp, translatedSrc: outNic.ip,
        dstIp: packet.header.dstIp, timestamp: this.timestamp(),
      });
      // NAT テーブルに記録（応答の逆変換用）
      const natKey = `${outNic.ip}:${String(srcPort)}`;
      this.natTable.set(natKey, { originalSrcIp: srcIp, originalSrcPort: srcPort });
      srcIp = outNic.ip;
    }

    // TTL 減算
    const ttl = packet.header.ttl - 1;
    if (ttl <= 0) return; // TTL切れ

    const ipData = serializeIp({
      header: { ...packet.header, srcIp, ttl },
      payload: packet.payload,
    });

    const nextHop = route.gateway === "0.0.0.0" ? packet.header.dstIp : route.gateway;
    const dstMac = this.resolveMac(nextHop);
    if (dstMac === undefined) {
      this.enqueueForArp(nextHop, outNic, ipData);
      return;
    }

    this.sendFrame(outNic, dstMac, 0x0800, ipData);
  }

  private findRoute(dstIp: string): RouteEntry | undefined {
    // 最長一致（specific → default の順）
    const dstNum = ipToNumber(dstIp);
    let bestRoute: RouteEntry | undefined;
    let bestMaskLen = -1;
    for (const route of this.routeTable) {
      const netNum = ipToNumber(route.network);
      const maskNum = ipToNumber(route.mask);
      if ((dstNum & maskNum) === (netNum & maskNum)) {
        const maskLen = countBits(maskNum);
        if (maskLen > bestMaskLen) {
          bestMaskLen = maskLen;
          bestRoute = route;
        }
      }
    }
    return bestRoute;
  }

  // =========================================================
  // L4: TCP 処理
  // =========================================================
  private connKey(localPort: number, remoteIp: string, remotePort: number): string {
    return `${String(localPort)}:${remoteIp}:${String(remotePort)}`;
  }

  private handleTcpSegment(data: Uint8Array, srcIp: string, dstIp: string): void {
    const seg = deserializeTcp(data);
    const flagStr = tcpFlagsToString(seg.header.flags);
    this.emit({
      type: "tcp_recv", srcPort: seg.header.srcPort, dstPort: seg.header.dstPort,
      flags: flagStr, seq: seg.header.seqNum, ack: seg.header.ackNum,
      size: seg.payload.length, timestamp: this.timestamp(),
    });

    const key = this.connKey(seg.header.dstPort, srcIp, seg.header.srcPort);
    let conn = this.tcpConnections.get(key);

    // SYN を受信（サーバ側: 新規接続）
    if (seg.header.flags.syn && !seg.header.flags.ack) {
      if (!this.listenPorts.has(seg.header.dstPort)) return;

      conn = {
        state: TcpStateEnum.SynReceived,
        localPort: seg.header.dstPort,
        remoteIp: srcIp,
        remotePort: seg.header.srcPort,
        sendSeq: 5000,
        recvAck: seg.header.seqNum + 1,
        recvBuffer: new Uint8Array(0),
      };
      this.tcpConnections.set(key, conn);
      this.changeState(conn, TcpStateEnum.SynReceived);

      // SYN+ACK を返す
      this.sendTcpSegment(dstIp, srcIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
        { fin: false, syn: true, rst: false, psh: false, ack: true, urg: false }, new Uint8Array(0));
      conn.sendSeq++;
      return;
    }

    if (conn === undefined) return;

    // SYN+ACK を受信（クライアント側: ハンドシェイク完了）
    if (seg.header.flags.syn && seg.header.flags.ack && conn.state === TcpStateEnum.SynSent) {
      conn.recvAck = seg.header.seqNum + 1;
      // ACK を返す
      this.sendTcpSegment(dstIp, srcIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
        { fin: false, syn: false, rst: false, psh: false, ack: true, urg: false }, new Uint8Array(0));
      this.changeState(conn, TcpStateEnum.Established);
      return;
    }

    // ACK を受信
    if (seg.header.flags.ack) {
      if (conn.state === TcpStateEnum.SynReceived) {
        this.changeState(conn, TcpStateEnum.Established);
      }
      if (conn.state === TcpStateEnum.LastAck) {
        this.changeState(conn, TcpStateEnum.Closed);
        this.tcpConnections.delete(key);
        return;
      }
      if (conn.state === TcpStateEnum.FinWait1) {
        this.changeState(conn, TcpStateEnum.FinWait2);
      }
    }

    // FIN を受信
    if (seg.header.flags.fin) {
      conn.recvAck = seg.header.seqNum + 1;
      // ACK を返す
      this.sendTcpSegment(dstIp, srcIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
        { fin: false, syn: false, rst: false, psh: false, ack: true, urg: false }, new Uint8Array(0));

      if (conn.state === TcpStateEnum.Established) {
        this.changeState(conn, TcpStateEnum.CloseWait);
        // こちらからも FIN を送る
        this.sendTcpSegment(dstIp, srcIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
          { fin: true, syn: false, rst: false, psh: false, ack: true, urg: false }, new Uint8Array(0));
        conn.sendSeq++;
        this.changeState(conn, TcpStateEnum.LastAck);
      } else if (conn.state === TcpStateEnum.FinWait2) {
        this.changeState(conn, TcpStateEnum.TimeWait);
        this.changeState(conn, TcpStateEnum.Closed);
        this.tcpConnections.delete(key);
      }
      return;
    }

    // データ受信
    if (seg.payload.length > 0) {
      conn.recvAck = seg.header.seqNum + seg.payload.length;
      // ACK を返す
      this.sendTcpSegment(dstIp, srcIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
        { fin: false, syn: false, rst: false, psh: false, ack: true, urg: false }, new Uint8Array(0));

      // 受信バッファに追加
      const newBuf = new Uint8Array(conn.recvBuffer.length + seg.payload.length);
      newBuf.set(conn.recvBuffer);
      newBuf.set(seg.payload, conn.recvBuffer.length);
      conn.recvBuffer = newBuf;

      // HTTP 処理（サーバモード）
      if (this.httpHandler !== undefined && conn.state === TcpStateEnum.Established) {
        this.handleHttpData(conn, dstIp, srcIp);
      }
    }
  }

  // TCP セグメントを送信
  private sendTcpSegment(
    _srcIp: string, dstIp: string,
    srcPort: number, dstPort: number,
    seq: number, ack: number,
    flags: TcpFlags, payload: Uint8Array,
  ): void {
    const flagStr = tcpFlagsToString(flags);
    this.emit({
      type: "tcp_send", srcPort, dstPort, flags: flagStr, seq, ack,
      size: payload.length, timestamp: this.timestamp(),
    });

    const tcpData = serializeTcp({
      header: {
        srcPort, dstPort, seqNum: seq, ackNum: ack,
        dataOffset: 20, flags, windowSize: 65535, checksum: 0,
      },
      payload,
    });

    this.sendIpPacket(dstIp, 6, tcpData);
  }

  // クライアント側: TCP 接続を開始し、HTTP GET を送信
  sendHttpRequest(dstIp: string, dstPort: number, request: HttpRequest): void {
    const localPort = this.nextEphemeralPort++;
    const key = this.connKey(localPort, dstIp, dstPort);
    const conn: TcpConnection = {
      state: TcpStateEnum.Closed,
      localPort,
      remoteIp: dstIp,
      remotePort: dstPort,
      sendSeq: 1000,
      recvAck: 0,
      recvBuffer: new Uint8Array(0),
    };
    this.tcpConnections.set(key, conn);

    this.emit({
      type: "http_request", method: request.method, path: request.path,
      host: request.headers.get("Host") ?? dstIp, timestamp: this.timestamp(),
    });

    // Established 時に HTTP データを送るコールバックを先に設定
    // （SYN送信 → SYN+ACK応答が同期的に処理されるため、SYN送信前に設定する必要がある）
    const origHandler = this.onTcpEstablished;
    this.onTcpEstablished = (c) => {
      if (c === conn) {
        const httpData = serializeHttpRequest(request);
        this.sendTcpSegment(
          this.nics[0]?.ip ?? "0.0.0.0", dstIp,
          localPort, dstPort, conn.sendSeq, conn.recvAck,
          { fin: false, syn: false, rst: false, psh: true, ack: true, urg: false },
          httpData,
        );
        conn.sendSeq += httpData.length;
        this.onTcpEstablished = origHandler;
      }
    };

    // SYN 送信（同期的にハンドシェイク全体が完了しうる）
    this.changeState(conn, TcpStateEnum.SynSent);
    this.sendTcpSegment(
      this.nics[0]?.ip ?? "0.0.0.0", dstIp,
      localPort, dstPort, conn.sendSeq, 0,
      { fin: false, syn: true, rst: false, psh: false, ack: false, urg: false },
      new Uint8Array(0),
    );
    conn.sendSeq++;
  }

  // コネクション確立時のコールバック（クライアント側で HTTP 送信をトリガー）
  private onTcpEstablished: ((conn: TcpConnection) => void) | undefined;

  // SYN+ACK を受信した時の処理を追加（クライアント側）
  // HTTP データの処理（サーバ側）
  private handleHttpData(conn: TcpConnection, localIp: string, remoteIp: string): void {
    // HTTP リクエストが完全に受信されたか確認（\r\n\r\n が含まれるか）
    const text = new TextDecoder().decode(conn.recvBuffer);
    if (!text.includes("\r\n\r\n")) return;

    const req = deserializeHttpRequest(conn.recvBuffer);
    conn.recvBuffer = new Uint8Array(0); // バッファクリア

    // ハンドラ呼び出し
    const res = this.httpHandler?.(req);
    if (res === undefined) return;

    this.emit({
      type: "http_response", statusCode: res.statusCode, statusText: res.statusText,
      bodySize: res.body.length, timestamp: this.timestamp(),
    });

    // レスポンス送信
    const resData = serializeHttpResponse(res);
    this.sendTcpSegment(localIp, remoteIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
      { fin: false, syn: false, rst: false, psh: true, ack: true, urg: false }, resData);
    conn.sendSeq += resData.length;

    // FIN 送信（Connection: close）
    this.sendTcpSegment(localIp, remoteIp, conn.localPort, conn.remotePort, conn.sendSeq, conn.recvAck,
      { fin: true, syn: false, rst: false, psh: false, ack: true, urg: false }, new Uint8Array(0));
    conn.sendSeq++;
    this.changeState(conn, TcpStateEnum.FinWait1);
  }

  private changeState(conn: TcpConnection, newState: TcpState): void {
    const from = conn.state;
    conn.state = newState;
    this.emit({ type: "tcp_state_change", from, to: newState, timestamp: this.timestamp() });

    // SYN+ACK 受信後の ACK（クライアント側ハンドシェイク完了）
    if (newState === TcpStateEnum.Established && this.onTcpEstablished !== undefined) {
      this.onTcpEstablished(conn);
    }
  }

  // プライベートIPか判定
  private isPrivateIp(ip: string): boolean {
    return ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.");
  }

  // TCP ポートを覗き見（NAT用）
  private peekTcpSrcPort(data: Uint8Array): number {
    if (data.length < 2) return 0;
    return new DataView(data.buffer, data.byteOffset).getUint16(0);
  }

  private peekTcpDstPort(data: Uint8Array): number {
    if (data.length < 4) return 0;
    return new DataView(data.buffer, data.byteOffset).getUint16(2);
  }

  private patchTcpDstPort(data: Uint8Array, port: number): void {
    if (data.length < 4) return;
    new DataView(data.buffer, data.byteOffset).setUint16(2, port);
  }

  // TCP コネクション一覧（デバッグ用）
  getConnections(): { key: string; state: TcpState }[] {
    const result: { key: string; state: TcpState }[] = [];
    for (const [key, conn] of this.tcpConnections) {
      result.push({ key, state: conn.state });
    }
    return result;
  }
}

// IP アドレスを数値に変換
function ipToNumber(ip: string): number {
  const parts = ip.split(".");
  return ((Number(parts[0] ?? 0) << 24) |
          (Number(parts[1] ?? 0) << 16) |
          (Number(parts[2] ?? 0) << 8) |
          Number(parts[3] ?? 0)) >>> 0;
}

// ビット数をカウント
function countBits(n: number): number {
  let count = 0;
  let v = n;
  while (v) {
    count += v & 1;
    v >>>= 1;
  }
  return count;
}
