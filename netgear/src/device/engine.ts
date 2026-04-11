import type {
  NetworkDevice,
  EthernetFrame,
  Packet,
  ArpPacket,
  Port,
  SimEvent,
  SimulationResult,
  MacAddr,
  IPv4,
} from "./types.js";

/** ブロードキャストMAC */
const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";

// === デバイス生成ヘルパー ===

/** MACアドレス生成 */
export function mac(id: number, port: number): MacAddr {
  return `00:${id.toString(16).padStart(2, "0")}:00:00:00:${port.toString(16).padStart(2, "0")}`;
}

/** ポート生成 */
function makePort(id: number, deviceId: number): Port {
  return { id, name: `port${id}`, mac: mac(deviceId, id), linkUp: true, connectedTo: null, connectedPort: null };
}

/** NIC（ネットワークインタフェースカード）作成 */
export function createNic(id: string, name: string, ip: IPv4): NetworkDevice {
  const numId = parseInt(id.replace(/\D/g, ""), 10) || 1;
  return {
    id, kind: "nic", name, layer: "L2",
    ports: [makePort(0, numId)],
    ipAddresses: { 0: ip },
    arpTable: [],
  };
}

/** リピータ作成（L1, 2ポート） */
export function createRepeater(id: string, name: string): NetworkDevice {
  const numId = parseInt(id.replace(/\D/g, ""), 10) || 10;
  return {
    id, kind: "repeater", name, layer: "L1",
    ports: [makePort(0, numId), makePort(1, numId)],
  };
}

/** ハブ作成（L1, Nポート） */
export function createHub(id: string, name: string, portCount: number): NetworkDevice {
  const numId = parseInt(id.replace(/\D/g, ""), 10) || 20;
  return {
    id, kind: "hub", name, layer: "L1",
    ports: Array.from({ length: portCount }, (_, i) => makePort(i, numId)),
  };
}

/** ブリッジ作成（L2, 2ポート, MACテーブル） */
export function createBridge(id: string, name: string): NetworkDevice {
  const numId = parseInt(id.replace(/\D/g, ""), 10) || 30;
  return {
    id, kind: "bridge", name, layer: "L2",
    ports: [makePort(0, numId), makePort(1, numId)],
    macTable: [],
  };
}

/** L2スイッチ作成（L2, Nポート, MACテーブル） */
export function createSwitch(id: string, name: string, portCount: number): NetworkDevice {
  const numId = parseInt(id.replace(/\D/g, ""), 10) || 40;
  return {
    id, kind: "switch", name, layer: "L2",
    ports: Array.from({ length: portCount }, (_, i) => makePort(i, numId)),
    macTable: [],
  };
}

/** ルーター作成（L3, Nポート） */
export function createRouter(id: string, name: string, portCount: number, ips: Record<number, IPv4>): NetworkDevice {
  const numId = parseInt(id.replace(/\D/g, ""), 10) || 50;
  return {
    id, kind: "router", name, layer: "L3",
    ports: Array.from({ length: portCount }, (_, i) => makePort(i, numId)),
    routeTable: [],
    arpTable: [],
    macTable: [],
    ipAddresses: ips,
  };
}

/** リンク接続 */
export function connect(dev1: NetworkDevice, port1: number, dev2: NetworkDevice, port2: number): void {
  const p1 = dev1.ports[port1];
  const p2 = dev2.ports[port2];
  if (p1 && p2) {
    p1.connectedTo = dev2.id;
    p1.connectedPort = port2;
    p2.connectedTo = dev1.id;
    p2.connectedPort = port1;
  }
}

// === フレーム生成 ===

export function makeFrame(srcMac: MacAddr, dstMac: MacAddr, payload: Packet | ArpPacket): EthernetFrame {
  const etherType = payload.type === "arp" ? 0x0806 : 0x0800;
  return { srcMac, dstMac, etherType, payload, size: 64 };
}

export function makeIpPacket(srcIp: IPv4, dstIp: IPv4, data: string, ttl = 64): Packet {
  return { type: "ip", srcIp, dstIp, ttl, protocol: "icmp", data };
}

export function makeArpRequest(senderMac: MacAddr, senderIp: IPv4, targetIp: IPv4): ArpPacket {
  return { type: "arp", operation: "request", senderMac, senderIp, targetMac: "00:00:00:00:00:00", targetIp };
}

export function makeArpReply(senderMac: MacAddr, senderIp: IPv4, targetMac: MacAddr, targetIp: IPv4): ArpPacket {
  return { type: "arp", operation: "reply", senderMac, senderIp, targetMac, targetIp };
}

// === シミュレーションエンジン ===

interface SimContext {
  devices: Map<string, NetworkDevice>;
  events: SimEvent[];
  step: number;
  totalFrames: number;
  collisions: number;
  /** フレーム転送キュー */
  queue: Array<{ deviceId: string; port: number; frame: EthernetFrame }>;
}

/** シミュレーション実行 */
export function runSimulation(
  devices: NetworkDevice[],
  initialFrames: Array<{ fromDevice: string; fromPort: number; frame: EthernetFrame }>
): SimulationResult {
  const ctx: SimContext = {
    devices: new Map(devices.map((d) => [d.id, structuredClone(d)])),
    events: [],
    step: 0,
    totalFrames: 0,
    collisions: 0,
    queue: [],
  };

  // 初期フレームをキューに追加
  for (const f of initialFrames) {
    ctx.queue.push({ deviceId: f.fromDevice, port: f.fromPort, frame: f.frame });
  }

  // キュー処理（最大100ステップで打ち切り）
  while (ctx.queue.length > 0 && ctx.step < 100) {
    const item = ctx.queue.shift()!;
    ctx.step++;
    ctx.totalFrames++;
    processFrame(ctx, item.deviceId, item.port, item.frame);
  }

  return {
    events: ctx.events,
    devices: [...ctx.devices.values()],
    totalFrames: ctx.totalFrames,
    collisions: ctx.collisions,
  };
}

/** デバイスがフレームを受信した時の処理 */
function processFrame(ctx: SimContext, deviceId: string, inPort: number, frame: EthernetFrame): void {
  const device = ctx.devices.get(deviceId);
  if (!device) return;

  ctx.events.push({
    step: ctx.step, device: device.name, type: "receive",
    description: `${device.name} のポート${inPort}でフレーム受信: ${frame.srcMac} → ${frame.dstMac}`,
    port: inPort, frame,
  });

  switch (device.kind) {
    case "nic": return processNic(ctx, device, inPort, frame);
    case "repeater": return processRepeater(ctx, device, inPort, frame);
    case "hub": return processHub(ctx, device, inPort, frame);
    case "bridge": return processBridge(ctx, device, inPort, frame);
    case "switch": return processSwitch(ctx, device, inPort, frame);
    case "router": return processRouter(ctx, device, inPort, frame);
  }
}

/** NIC: 自分宛のフレームのみ受け取る */
function processNic(ctx: SimContext, device: NetworkDevice, inPort: number, frame: EthernetFrame): void {
  const port = device.ports[inPort];
  if (!port) return;

  if (frame.dstMac === port.mac || frame.dstMac === BROADCAST_MAC) {
    ctx.events.push({
      step: ctx.step, device: device.name, type: "forward",
      description: `${device.name}: フレーム受理（自分宛 or ブロードキャスト）`,
    });

    // ARP処理
    if (frame.etherType === 0x0806) {
      const arp = frame.payload as ArpPacket;
      const myIp = device.ipAddresses?.[inPort];
      if (arp.operation === "request" && myIp && arp.targetIp === myIp) {
        // ARP応答を返す
        const reply = makeArpReply(port.mac, myIp, arp.senderMac, arp.senderIp);
        const replyFrame = makeFrame(port.mac, arp.senderMac, reply);
        ctx.events.push({
          step: ctx.step, device: device.name, type: "arp_reply",
          description: `${device.name}: ARP応答送信 ${myIp} は ${port.mac}`,
        });
        sendFrame(ctx, device, inPort, replyFrame);
      }
      if (arp.operation === "reply") {
        if (!device.arpTable) device.arpTable = [];
        device.arpTable.push({ ip: arp.senderIp, mac: arp.senderMac });
        ctx.events.push({
          step: ctx.step, device: device.name, type: "info",
          description: `${device.name}: ARPテーブル更新 ${arp.senderIp} → ${arp.senderMac}`,
        });
      }
    }
  } else {
    ctx.events.push({
      step: ctx.step, device: device.name, type: "drop",
      description: `${device.name}: 宛先MAC不一致、フレーム破棄`,
    });
  }
}

/** リピータ: 受信ポートの反対側に信号を増幅して転送（L1） */
function processRepeater(ctx: SimContext, device: NetworkDevice, inPort: number, frame: EthernetFrame): void {
  const outPort = inPort === 0 ? 1 : 0;
  ctx.events.push({
    step: ctx.step, device: device.name, type: "signal_repeat",
    description: `${device.name}: 電気信号を増幅してポート${outPort}へ転送（L1）`,
    port: outPort,
  });
  sendFrame(ctx, device, outPort, frame);
}

/** ハブ: 受信ポート以外の全ポートにフラッディング（L1） */
function processHub(ctx: SimContext, device: NetworkDevice, inPort: number, frame: EthernetFrame): void {
  const outPorts = device.ports.filter((p) => p.id !== inPort && p.linkUp && p.connectedTo);
  ctx.events.push({
    step: ctx.step, device: device.name, type: "flood",
    description: `${device.name}: 全ポートにフラッディング（L1, ${outPorts.length}ポート）`,
  });
  for (const p of outPorts) {
    sendFrame(ctx, device, p.id, frame);
  }
}

/** ブリッジ: MACアドレス学習 + 選択的転送/フィルタリング（L2） */
function processBridge(ctx: SimContext, device: NetworkDevice, inPort: number, frame: EthernetFrame): void {
  if (!device.macTable) device.macTable = [];

  // MAC学習
  learnMac(ctx, device, frame.srcMac, inPort);

  // 転送判断
  if (frame.dstMac === BROADCAST_MAC) {
    const outPort = inPort === 0 ? 1 : 0;
    ctx.events.push({
      step: ctx.step, device: device.name, type: "broadcast",
      description: `${device.name}: ブロードキャスト → ポート${outPort}へ転送`,
    });
    sendFrame(ctx, device, outPort, frame);
    return;
  }

  const entry = device.macTable.find((e) => e.mac === frame.dstMac);
  if (entry) {
    if (entry.port === inPort) {
      // 同一セグメント: フィルタリング
      ctx.events.push({
        step: ctx.step, device: device.name, type: "filter",
        description: `${device.name}: 宛先 ${frame.dstMac} は同一セグメント（ポート${inPort}）→ フィルタリング`,
      });
    } else {
      ctx.events.push({
        step: ctx.step, device: device.name, type: "forward",
        description: `${device.name}: MACテーブルヒット → ポート${entry.port}へ転送`,
      });
      sendFrame(ctx, device, entry.port, frame);
    }
  } else {
    // 不明MAC: フラッディング
    const outPort = inPort === 0 ? 1 : 0;
    ctx.events.push({
      step: ctx.step, device: device.name, type: "flood",
      description: `${device.name}: 宛先MAC不明 → ポート${outPort}へフラッディング`,
    });
    sendFrame(ctx, device, outPort, frame);
  }
}

/** L2スイッチ: マルチポートブリッジ（L2） */
function processSwitch(ctx: SimContext, device: NetworkDevice, inPort: number, frame: EthernetFrame): void {
  if (!device.macTable) device.macTable = [];

  // MAC学習
  learnMac(ctx, device, frame.srcMac, inPort);

  // ブロードキャスト
  if (frame.dstMac === BROADCAST_MAC) {
    const outPorts = device.ports.filter((p) => p.id !== inPort && p.linkUp && p.connectedTo);
    ctx.events.push({
      step: ctx.step, device: device.name, type: "broadcast",
      description: `${device.name}: ブロードキャスト → ${outPorts.length}ポートへフラッディング`,
    });
    for (const p of outPorts) {
      sendFrame(ctx, device, p.id, frame);
    }
    return;
  }

  // MACテーブル参照
  const entry = device.macTable.find((e) => e.mac === frame.dstMac);
  if (entry) {
    ctx.events.push({
      step: ctx.step, device: device.name, type: "mac_lookup",
      description: `${device.name}: MACテーブルヒット ${frame.dstMac} → ポート${entry.port}`,
    });
    if (entry.port === inPort) {
      ctx.events.push({
        step: ctx.step, device: device.name, type: "filter",
        description: `${device.name}: 同一ポート → フィルタリング`,
      });
    } else {
      ctx.events.push({
        step: ctx.step, device: device.name, type: "forward",
        description: `${device.name}: ポート${entry.port}へユニキャスト転送`,
      });
      sendFrame(ctx, device, entry.port, frame);
    }
  } else {
    // 不明MAC: フラッディング
    const outPorts = device.ports.filter((p) => p.id !== inPort && p.linkUp && p.connectedTo);
    ctx.events.push({
      step: ctx.step, device: device.name, type: "flood",
      description: `${device.name}: 宛先MAC不明 → ${outPorts.length}ポートへフラッディング`,
    });
    for (const p of outPorts) {
      sendFrame(ctx, device, p.id, frame);
    }
  }
}

/** ルーター: L3転送（デカプセル→ルーティング→再カプセル化） */
function processRouter(ctx: SimContext, device: NetworkDevice, inPort: number, frame: EthernetFrame): void {
  if (!device.macTable) device.macTable = [];
  if (!device.arpTable) device.arpTable = [];

  // MAC学習（ルーターもL2レベルで学習）
  learnMac(ctx, device, frame.srcMac, inPort);

  // ARP処理
  if (frame.etherType === 0x0806) {
    const arp = frame.payload as ArpPacket;
    const myIp = device.ipAddresses?.[inPort];

    if (arp.operation === "request" && myIp && arp.targetIp === myIp) {
      // ARP応答
      device.arpTable.push({ ip: arp.senderIp, mac: arp.senderMac });
      const port = device.ports[inPort]!;
      const reply = makeArpReply(port.mac, myIp, arp.senderMac, arp.senderIp);
      const replyFrame = makeFrame(port.mac, arp.senderMac, reply);
      ctx.events.push({
        step: ctx.step, device: device.name, type: "arp_reply",
        description: `${device.name}: ARP応答 ${myIp} は ${port.mac}`,
      });
      sendFrame(ctx, device, inPort, replyFrame);
      return;
    }
    if (arp.operation === "reply") {
      device.arpTable.push({ ip: arp.senderIp, mac: arp.senderMac });
      ctx.events.push({
        step: ctx.step, device: device.name, type: "info",
        description: `${device.name}: ARP学習 ${arp.senderIp} → ${arp.senderMac}`,
      });
      return;
    }
  }

  // IPパケット処理
  if (frame.etherType !== 0x0800) return;
  const pkt = frame.payload as Packet;

  // デカプセル化
  ctx.events.push({
    step: ctx.step, device: device.name, type: "decapsulate",
    description: `${device.name}: L2ヘッダ除去 → IPパケット ${pkt.srcIp} → ${pkt.dstIp}`,
  });

  // TTL減算
  const newTtl = pkt.ttl - 1;
  if (newTtl <= 0) {
    ctx.events.push({
      step: ctx.step, device: device.name, type: "ttl_decrement",
      description: `${device.name}: TTL=0 → パケット破棄（Time Exceeded）`,
    });
    return;
  }
  ctx.events.push({
    step: ctx.step, device: device.name, type: "ttl_decrement",
    description: `${device.name}: TTL ${pkt.ttl} → ${newTtl}`,
  });

  // ルーティング
  const route = device.routeTable?.find((r) => matchRoute(pkt.dstIp, r.network, r.mask));
  if (!route) {
    ctx.events.push({
      step: ctx.step, device: device.name, type: "drop",
      description: `${device.name}: ルート不明 ${pkt.dstIp} → パケット破棄`,
    });
    return;
  }

  ctx.events.push({
    step: ctx.step, device: device.name, type: "route_lookup",
    description: `${device.name}: ルート発見 ${route.network}/${route.mask} → ポート${route.iface} (gw=${route.gateway})`,
  });

  // ARP解決
  const nextHopIp = route.gateway === "0.0.0.0" ? pkt.dstIp : route.gateway;
  const arpEntry = device.arpTable.find((e) => e.ip === nextHopIp);
  let dstMac: MacAddr;

  if (arpEntry) {
    dstMac = arpEntry.mac;
  } else {
    // ARP要求送信
    const outPort = device.ports[route.iface]!;
    const arpReq = makeArpRequest(outPort.mac, device.ipAddresses?.[route.iface] ?? "0.0.0.0", nextHopIp);
    const arpFrame = makeFrame(outPort.mac, BROADCAST_MAC, arpReq);
    ctx.events.push({
      step: ctx.step, device: device.name, type: "arp_request",
      description: `${device.name}: ARP要求送信 Who has ${nextHopIp}?`,
    });
    sendFrame(ctx, device, route.iface, arpFrame);
    return; // ARP解決待ち（簡略化）
  }

  // 再カプセル化
  const outPort = device.ports[route.iface]!;
  const newPkt: Packet = { ...pkt, ttl: newTtl };
  const newFrame = makeFrame(outPort.mac, dstMac, newPkt);
  ctx.events.push({
    step: ctx.step, device: device.name, type: "encapsulate",
    description: `${device.name}: 再カプセル化 src=${outPort.mac} dst=${dstMac} → ポート${route.iface}`,
  });
  sendFrame(ctx, device, route.iface, newFrame);
}

// === ユーティリティ ===

/** MAC学習 */
function learnMac(ctx: SimContext, device: NetworkDevice, srcMac: MacAddr, port: number): void {
  if (!device.macTable) return;
  const existing = device.macTable.find((e) => e.mac === srcMac);
  if (!existing) {
    device.macTable.push({ mac: srcMac, port, age: 0 });
    ctx.events.push({
      step: ctx.step, device: device.name, type: "mac_learn",
      description: `${device.name}: MAC学習 ${srcMac} → ポート${port}`,
    });
  } else if (existing.port !== port) {
    existing.port = port;
    ctx.events.push({
      step: ctx.step, device: device.name, type: "mac_learn",
      description: `${device.name}: MACテーブル更新 ${srcMac} → ポート${port}`,
    });
  }
}

/** フレーム送信（接続先デバイスのキューに追加） */
function sendFrame(ctx: SimContext, device: NetworkDevice, outPort: number, frame: EthernetFrame): void {
  const port = device.ports[outPort];
  if (!port || !port.connectedTo || port.connectedPort === null) return;
  ctx.queue.push({ deviceId: port.connectedTo, port: port.connectedPort, frame });
}

/** IPアドレスのルートマッチング */
function matchRoute(ip: IPv4, network: IPv4, mask: IPv4): boolean {
  const ipNum = ipToNum(ip);
  const netNum = ipToNum(network);
  const maskNum = ipToNum(mask);
  return (ipNum & maskNum) === (netNum & maskNum);
}

function ipToNum(ip: IPv4): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}
