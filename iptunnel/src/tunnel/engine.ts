import type {
  IpHeader, GreHeader, EspHeader, Packet,
  SimEvent, SimulationResult, Preset,
} from "./types.js";

// === ヘルパー ===

/** IPプロトコル番号 */
const PROTO = {
  IPIP: 4,
  IPV6: 41,
  GRE: 47,
  ESP: 50,
  UDP: 17,
} as const;

/** GREプロトコルタイプ */
const GRE_TYPE = {
  IPv4: 0x0800,
  IPv6: 0x86DD,
} as const;

let packetId = 1000;

/** IPv4ヘッダ生成 */
export function makeIpHeader(
  src: string, dst: string, protocol: number, totalLen: number, ttl = 64, version: 4 | 6 = 4,
): IpHeader {
  return {
    version, headerLen: 20, tos: 0, totalLen, id: packetId++,
    flags: { df: false, mf: false }, ttl, protocol, src, dst,
  };
}

/** GREヘッダ生成 */
export function makeGreHeader(innerVersion: 4 | 6, key?: number, seq?: number): GreHeader {
  return {
    checksumPresent: false,
    keyPresent: key !== undefined,
    sequencePresent: seq !== undefined,
    protocolType: innerVersion === 4 ? GRE_TYPE.IPv4 : GRE_TYPE.IPv6,
    key, sequence: seq,
  };
}

/** ESPヘッダ生成 */
export function makeEspHeader(spi: number, seq: number): EspHeader {
  return { spi, sequenceNumber: seq, encrypted: true };
}

/** GREヘッダサイズ計算 */
function greHeaderSize(gre: GreHeader): number {
  let size = 4; // 基本4バイト
  if (gre.keyPresent) size += 4;
  if (gre.sequencePresent) size += 4;
  if (gre.checksumPresent) size += 4;
  return size;
}

/** ヘキサダンプ生成（簡易） */
function hexDump(label: string, fields: [string, string | number][]): string {
  return `[${label}] ` + fields.map(([k, v]) => `${k}=${v}`).join(" ");
}

/** IPヘッダのヘキサ表現 */
function ipHeaderHex(h: IpHeader): string {
  return hexDump("IP", [
    ["ver", h.version], ["hlen", h.headerLen], ["tot", h.totalLen],
    ["id", `0x${h.id.toString(16)}`], ["ttl", h.ttl],
    ["proto", h.protocol], ["src", h.src], ["dst", h.dst],
  ]);
}

/** GREヘッダのヘキサ表現 */
function greHeaderHex(g: GreHeader): string {
  const fields: [string, string | number][] = [
    ["type", `0x${g.protocolType.toString(16)}`],
  ];
  if (g.keyPresent) fields.push(["key", g.key!]);
  if (g.sequencePresent) fields.push(["seq", g.sequence!]);
  return hexDump("GRE", fields);
}

/** ESPヘッダのヘキサ表現 */
function espHeaderHex(e: EspHeader): string {
  return hexDump("ESP", [["spi", `0x${e.spi.toString(16)}`], ["seq", e.sequenceNumber]]);
}

// === シミュレーションエンジン ===

export function runSimulation(preset: Preset): SimulationResult {
  const events: SimEvent[] = [];
  let step = 0;
  const tunnel = preset.tunnel;

  let greSeq = 0;
  let espSeq = 0;

  for (const pkt of preset.packets) {
    const isIpv6 = pkt.ipv6 ?? false;
    const innerVersion: 4 | 6 = isIpv6 ? 6 : 4;
    const innerHeaderLen = isIpv6 ? 40 : 20;
    const ttl = pkt.ttl ?? 64;

    // 1. パケット生成
    const innerIp = makeIpHeader(
      pkt.src, pkt.dst,
      PROTO.UDP, innerHeaderLen + pkt.size, ttl, innerVersion,
    );
    const originalPacket: Packet = {
      innerIp, payload: pkt.payload, payloadSize: pkt.size,
    };

    events.push({
      step: step++, type: "originate", node: "送信元ホスト",
      packet: { ...originalPacket },
      description: `パケット生成: ${pkt.src} → ${pkt.dst} (${pkt.payload}, ${pkt.size}bytes, TTL=${ttl})`,
      headerBytes: ipHeaderHex(innerIp),
    });

    // 2. トンネル入口でカプセル化
    events.push({
      step: step++, type: "encapsulate", node: tunnel.name + " (入口)",
      packet: { ...originalPacket },
      description: `${tunnel.protocol}トンネルカプセル化開始`,
    });

    // プロトコル別処理
    let outerProtocol: number;
    let extraHeaderSize = 0;
    let greHeader: GreHeader | undefined;
    let espHeader: EspHeader | undefined;

    switch (tunnel.protocol) {
      case "IPIP": {
        outerProtocol = PROTO.IPIP;
        events.push({
          step: step++, type: "add_outer_ip", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `IP-in-IP: 外側IPv4ヘッダ付与 (proto=4, src=${tunnel.localEndpoint}, dst=${tunnel.remoteEndpoint})`,
        });
        break;
      }
      case "6in4": {
        outerProtocol = PROTO.IPV6;
        events.push({
          step: step++, type: "add_outer_ip", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `6in4: IPv6パケットをIPv4でカプセル化 (proto=41, src=${tunnel.localEndpoint}, dst=${tunnel.remoteEndpoint})`,
        });
        break;
      }
      case "GRE": {
        outerProtocol = PROTO.GRE;
        greHeader = makeGreHeader(innerVersion, tunnel.greKey, greSeq++);
        extraHeaderSize = greHeaderSize(greHeader);
        events.push({
          step: step++, type: "add_gre", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `GREヘッダ付与 (type=0x${greHeader.protocolType.toString(16)}${tunnel.greKey !== undefined ? `, key=${tunnel.greKey}` : ""}, seq=${greHeader.sequence})`,
          headerBytes: greHeaderHex(greHeader),
        });
        events.push({
          step: step++, type: "add_outer_ip", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `外側IPv4ヘッダ付与 (proto=47/GRE, src=${tunnel.localEndpoint}, dst=${tunnel.remoteEndpoint})`,
        });
        break;
      }
      case "GRE6": {
        outerProtocol = PROTO.GRE;
        greHeader = makeGreHeader(innerVersion, tunnel.greKey, greSeq++);
        extraHeaderSize = greHeaderSize(greHeader);
        events.push({
          step: step++, type: "add_gre", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `GREヘッダ付与 (IPv6 over GRE, key=${tunnel.greKey ?? "none"})`,
          headerBytes: greHeaderHex(greHeader),
        });
        events.push({
          step: step++, type: "add_outer_ip", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `外側IPヘッダ付与 (proto=47/GRE, src=${tunnel.localEndpoint}, dst=${tunnel.remoteEndpoint})`,
        });
        break;
      }
      case "IPsec": {
        outerProtocol = PROTO.ESP;
        espHeader = makeEspHeader(0x12345678, espSeq++);
        extraHeaderSize = 8; // ESPヘッダ基本8バイト
        events.push({
          step: step++, type: "encrypt", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `IPsec ESP暗号化 (SPI=0x${espHeader.spi.toString(16)}, seq=${espHeader.sequenceNumber})`,
        });
        events.push({
          step: step++, type: "add_esp", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `ESPヘッダ付与 + 認証トレイラ`,
          headerBytes: espHeaderHex(espHeader),
        });
        events.push({
          step: step++, type: "add_outer_ip", node: tunnel.name + " (入口)",
          packet: { ...originalPacket },
          description: `外側IPv4ヘッダ付与 (proto=50/ESP, src=${tunnel.localEndpoint}, dst=${tunnel.remoteEndpoint})`,
        });
        break;
      }
    }

    // 外側IPヘッダ構築
    const outerTotalLen = 20 + extraHeaderSize + innerIp.totalLen;
    const outerIp = makeIpHeader(
      tunnel.localEndpoint, tunnel.remoteEndpoint,
      outerProtocol, outerTotalLen, 64,
    );

    const encapPacket: Packet = {
      outerIp, greHeader, espHeader, innerIp, payload: pkt.payload, payloadSize: pkt.size,
    };

    events.push({
      step: step++, type: "encapsulate", node: tunnel.name + " (入口)",
      packet: { ...encapPacket },
      description: `カプセル化完了: 全体 ${outerTotalLen}bytes (外側IP:20 + ${extraHeaderSize > 0 ? `${tunnel.protocol}ヘッダ:${extraHeaderSize} + ` : ""}内側パケット:${innerIp.totalLen})`,
      headerBytes: ipHeaderHex(outerIp),
    });

    // MTU チェック
    if (outerTotalLen > tunnel.mtu) {
      if (innerIp.flags.df) {
        events.push({
          step: step++, type: "mtu_exceed", node: tunnel.name + " (入口)",
          packet: { ...encapPacket },
          description: `MTU超過: ${outerTotalLen} > ${tunnel.mtu}, DFビットが立っているため破棄 (ICMP Need Fragment送信)`,
        });
        continue;
      }
      events.push({
        step: step++, type: "fragment", node: tunnel.name + " (入口)",
        packet: { ...encapPacket },
        description: `MTU超過: ${outerTotalLen} > ${tunnel.mtu}, フラグメンテーション実行`,
      });
    }

    // 3. トンネル経路上の転送
    const transitNodes = preset.nodes.filter(
      (n) => n.type === "router" && n.id !== "src" && n.id !== "dst",
    );
    for (const node of transitNodes) {
      // 中継ルータはカプセル化されたパケットを外側IPヘッダだけ見て転送
      events.push({
        step: step++, type: "transit", node: node.name,
        packet: { ...encapPacket },
        description: `中継転送: 外側IP (${outerIp.src} → ${outerIp.dst}) を見てルーティング (内部パケットは不可視)`,
      });

      // TTL減算
      outerIp.ttl--;
      if (outerIp.ttl <= 0) {
        events.push({
          step: step++, type: "ttl_expire", node: node.name,
          packet: { ...encapPacket },
          description: `外側IPのTTL切れ: パケット破棄 (ICMP Time Exceeded送信)`,
        });
        break;
      }

      events.push({
        step: step++, type: "route", node: node.name,
        packet: { ...encapPacket },
        description: `ルーティング完了: proto=${outerIp.protocol} → 次ホップへ転送, TTL=${outerIp.ttl}`,
      });
    }

    if (outerIp.ttl <= 0) continue;

    // 4. トンネル出口でデカプセル化
    events.push({
      step: step++, type: "decapsulate", node: tunnel.name + " (出口)",
      packet: { ...encapPacket },
      description: `${tunnel.protocol}トンネルデカプセル化開始`,
    });

    events.push({
      step: step++, type: "remove_outer_ip", node: tunnel.name + " (出口)",
      packet: { ...encapPacket },
      description: `外側IPヘッダ除去 (src=${outerIp.src}, dst=${outerIp.dst}, proto=${outerIp.protocol})`,
    });

    // プロトコル別デカプセル化
    switch (tunnel.protocol) {
      case "GRE":
      case "GRE6": {
        events.push({
          step: step++, type: "remove_gre", node: tunnel.name + " (出口)",
          packet: { ...encapPacket },
          description: `GREヘッダ除去 (type=0x${greHeader!.protocolType.toString(16)}${greHeader!.keyPresent ? `, key=${greHeader!.key}` : ""})`,
        });
        break;
      }
      case "IPsec": {
        events.push({
          step: step++, type: "remove_esp", node: tunnel.name + " (出口)",
          packet: { ...encapPacket },
          description: `ESPヘッダ除去 (SPI=0x${espHeader!.spi.toString(16)})`,
        });
        events.push({
          step: step++, type: "decrypt", node: tunnel.name + " (出口)",
          packet: { ...encapPacket },
          description: `IPsec ESP復号 + 認証検証OK`,
        });
        break;
      }
      default:
        break;
    }

    // 内側パケット取り出し
    const decapPacket: Packet = {
      innerIp, payload: pkt.payload, payloadSize: pkt.size,
    };

    events.push({
      step: step++, type: "decapsulate", node: tunnel.name + " (出口)",
      packet: { ...decapPacket },
      description: `デカプセル化完了: 内側パケット取り出し (${innerIp.src} → ${innerIp.dst}, ${innerIp.totalLen}bytes)`,
      headerBytes: ipHeaderHex(innerIp),
    });

    // 5. 宛先ホストへ配送
    events.push({
      step: step++, type: "deliver", node: "宛先ホスト",
      packet: { ...decapPacket },
      description: `パケット配送完了: ${innerIp.src} → ${innerIp.dst} (payload="${pkt.payload}", ${pkt.size}bytes)`,
    });
  }

  return { events, tunnelConfig: tunnel };
}
