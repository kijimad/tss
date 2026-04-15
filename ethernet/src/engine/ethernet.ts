/**
 * ethernet.ts — Ethernet (イーサネット) シミュレーションエンジン
 *
 * IEEE 802.3 規格に基づくレイヤー2（データリンク層）の
 * Ethernet フレーム処理をソフトウェア上でエミュレートするモジュール。
 *
 * 主な機能:
 *   - Ethernet フレームの構築（プリアンブル、SFD、MAC アドレス、EtherType、ペイロード、FCS）
 *   - CRC-32 による FCS（Frame Check Sequence）の簡易計算
 *   - MAC アドレス学習テーブルの管理
 *   - CSMA/CD（Carrier Sense Multiple Access / Collision Detection）衝突検出シミュレーション
 *   - 802.1Q VLAN タギングによるブロードキャストドメインの分離
 *   - STP（Spanning Tree Protocol）ポート状態によるループ防止
 *   - ユニキャスト転送 / ブロードキャスト（フラッディング）の判定
 *   - フレーム構造の分解表示（Wireshark 的なディセクション）
 *
 * Ethernet フレーム構造（IEEE 802.3）:
 *   ┌──────────┬─────┬────────┬────────┬────────────┬──────────────┬─────────┬─────┐
 *   │Preamble  │ SFD │Dst MAC │Src MAC │[802.1Q Tag]│EtherType/Len│ Payload │ FCS │
 *   │  7 bytes │ 1 B │  6 B   │  6 B   │  (4 B)     │    2 B      │46-1500B │ 4 B │
 *   └──────────┴─────┴────────┴────────┴────────────┴──────────────┴─────────┴─────┘
 *
 * CSMA/CD（半二重通信時）:
 *   1. キャリア検知（Carrier Sense）: 回線が空いているか確認
 *   2. 送信開始: 空いていればフレームを送信
 *   3. 衝突検出（Collision Detection）: 送信中に衝突が発生したら JAM 信号を送出
 *   4. 指数バックオフ: ランダムな時間待機して再送信
 *   ※ 現代の全二重 Ethernet では CSMA/CD は不要だが、教育目的でシミュレート
 *
 * MAC アドレス:
 *   - 48 ビット（6 バイト）のハードウェアアドレス
 *   - 上位 24 ビット: OUI（Organizationally Unique Identifier、ベンダー識別）
 *   - 下位 24 ビット: NIC 固有の識別子
 *   - ブロードキャストアドレス: FF:FF:FF:FF:FF:FF
 *
 * MTU（Maximum Transmission Unit）:
 *   - 標準 Ethernet: 1500 バイト
 *   - ジャンボフレーム: 最大 9000 バイト（本シミュレータでは未対応）
 *   - 最小ペイロード: 46 バイト（不足分はパディングで補填）
 */

// ── フレーム構造 ──

/**
 * Ethernet フレームを表すインターフェース。
 *
 * IEEE 802.3 フレームの各フィールドをモデル化する。
 * 実際の Ethernet フレームは最小 64 バイト、最大 1518 バイト（VLAN タグ付きは 1522 バイト）。
 */
export interface EthernetFrame {
  /** プリアンブル (7 バイト 0xAA + SFD 0xAB)。受信側のクロック同期に使用される */
  preamble: string;
  /** 宛先 MAC アドレス（6 バイト）。ブロードキャストの場合は FF:FF:FF:FF:FF:FF */
  dstMac: string;
  /** 送信元 MAC アドレス（6 バイト）。送信デバイスの物理アドレス */
  srcMac: string;
  /** 802.1Q VLAN タグ（4 バイト）。VLAN 非使用時は null */
  vlanTag: VlanTag | null;
  /** EtherType（2 バイト）。上位プロトコルを識別する値（例: 0x0800=IPv4, 0x0806=ARP） */
  etherType: number;
  /** EtherType の人間が読める名称（例: "IPv4", "ARP", "IPv6"） */
  etherTypeName: string;
  /** ペイロード。上位層のデータ（最小 46 バイト、最大 1500 バイト） */
  payload: string;
  /** ペイロードの実際のデータ長（パディング前のバイト数） */
  payloadSize: number;
  /** FCS（Frame Check Sequence）。CRC-32 によるフレーム整合性検証値 */
  fcs: string;
  /** フレーム全体のサイズ（プリアンブル + ヘッダ + ペイロード + FCS、バイト単位） */
  totalSize: number;
}

/**
 * IEEE 802.1Q VLAN タグを表すインターフェース。
 *
 * VLAN（Virtual LAN）はレイヤー2 スイッチ上で
 * ブロードキャストドメインを論理的に分割する技術。
 * タグは 4 バイトで構成され、送信元 MAC と EtherType の間に挿入される。
 *
 * 構造（4 バイト = 32 ビット）:
 *   ┌────────────┬─────┬─────┬─────────────┐
 *   │ TPID (16b) │PCP  │DEI  │  VID (12b)  │
 *   │  0x8100    │(3b) │(1b) │ 0-4094      │
 *   └────────────┴─────┴─────┴─────────────┘
 */
export interface VlanTag {
  /** TPID（Tag Protocol Identifier）。802.1Q では常に 0x8100 */
  tpid: number;
  /** PCP（Priority Code Point, 3 ビット）。フレームの優先度（0-7、QoS 用） */
  pcp: number;
  /** DEI（Drop Eligible Indicator, 1 ビット）。輻輳時に破棄可能かどうか */
  dei: number;
  /** VID（VLAN Identifier, 12 ビット）。VLAN の識別番号（0-4094） */
  vid: number;
}

// ── ネットワーク機器 ──

/**
 * ネットワーク上のホスト（端末）を表すインターフェース。
 *
 * PC やサーバーなどの端末デバイスをモデル化する。
 * 各ホストは固有の MAC アドレスを持ち、スイッチの特定ポートに接続される。
 */
export interface Host {
  /** ホスト名（表示用識別子。例: "PC-A", "Server"） */
  name: string;
  /** MAC アドレス（48 ビット。形式: "XX:XX:XX:XX:XX:XX"） */
  mac: string;
  /** IP アドレス（レイヤー3 識別子。本シミュレータでは表示目的のみ使用） */
  ip: string;
  /** 接続先スイッチのポート番号 */
  port: number;
  /** 所属 VLAN ID（省略時はデフォルト VLAN 1 として扱われる） */
  vlan?: number;
}

export interface SwitchPort {
  id: number;
  host: string | null;
  vlan: number;
  mode: "access" | "trunk";
  stpState: "forwarding" | "blocking" | "listening" | "learning" | "disabled";
}

export interface MacTableEntry {
  mac: string;
  port: number;
  vlan: number;
  age: number;
}

export interface L2Switch {
  name: string;
  ports: SwitchPort[];
  macTable: MacTableEntry[];
}

// ── トレース ──

export interface EthTrace {
  tick: number;
  phase: "frame_build" | "preamble" | "csma_cd" | "collision" | "backoff" | "transmit" |
    "mac_learn" | "mac_lookup" | "forward" | "broadcast" | "vlan_tag" | "vlan_filter" |
    "stp" | "receive" | "drop" | "fcs_check";
  device: string;
  detail: string;
}

// ── EtherType 定数 ──

export const ETHERTYPES: Record<number, string> = {
  0x0800: "IPv4",
  0x0806: "ARP",
  0x86DD: "IPv6",
  0x8100: "802.1Q VLAN",
  0x8847: "MPLS",
  0x88CC: "LLDP",
};

// ── CRC-32 簡易シミュレーション ──

export function crc32(data: string): string {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
}

/** MAC アドレス生成 */
export function genMac(prefix: string, id: number): string {
  return `${prefix}:${id.toString(16).padStart(2, "0")}`;
}

// ── フレーム構築 ──

export function buildFrame(
  srcMac: string,
  dstMac: string,
  etherType: number,
  payload: string,
  vlan?: number,
): EthernetFrame {
  const vlanTag: VlanTag | null = vlan !== undefined ? { tpid: 0x8100, pcp: 0, dei: 0, vid: vlan } : null;
  const payloadSize = Math.min(payload.length, 1500);
  const paddedPayload = payloadSize < 46 ? payload.padEnd(46, "\0") : payload.slice(0, 1500);
  const fcs = crc32(dstMac + srcMac + etherType.toString(16) + paddedPayload);
  const headerSize = 14 + (vlanTag !== null ? 4 : 0);
  const totalSize = 8 + headerSize + Math.max(46, payloadSize) + 4; // preamble + header + payload + FCS

  return {
    preamble: "AA AA AA AA AA AA AA AB",
    dstMac, srcMac,
    vlanTag,
    etherType,
    etherTypeName: ETHERTYPES[etherType] ?? `0x${etherType.toString(16)}`,
    payload: paddedPayload,
    payloadSize,
    fcs,
    totalSize,
  };
}

// ── Ethernet ネットワークシミュレータ ──

export interface EthNetwork {
  hosts: Host[];
  switches: L2Switch[];
}

export interface SimResult {
  frames: EthernetFrame[];
  trace: EthTrace[];
  macTableAfter: MacTableEntry[];
}

export function simulate(
  network: EthNetwork,
  srcHostName: string,
  dstHostName: string,
  etherType: number,
  payload: string,
): SimResult {
  const trace: EthTrace[] = [];
  let tick = 0;

  const srcHost = network.hosts.find((h) => h.name === srcHostName);
  const dstHost = network.hosts.find((h) => h.name === dstHostName);
  if (srcHost === undefined) {
    trace.push({ tick, phase: "drop", device: "?", detail: `送信元 "${srcHostName}" が見つからない` });
    return { frames: [], trace, macTableAfter: [] };
  }

  const sw = network.switches[0]!;
  const isBroadcast = dstHostName === "broadcast" || (dstHost === undefined);
  const dstMac = isBroadcast ? "FF:FF:FF:FF:FF:FF" : dstHost!.mac;

  // 1. フレーム構築
  tick++;
  const vlan = srcHost.vlan;
  const frame = buildFrame(srcHost.mac, dstMac, etherType, payload, vlan);
  trace.push({ tick, phase: "frame_build", device: srcHost.name,
    detail: `フレーム構築: ${srcHost.mac} → ${dstMac} (${frame.etherTypeName}, ${frame.totalSize}B)` });

  // フレーム詳細
  trace.push({ tick, phase: "preamble", device: srcHost.name,
    detail: `プリアンブル: ${frame.preamble} (7B 同期 + 1B SFD)` });

  if (frame.vlanTag !== null) {
    trace.push({ tick, phase: "vlan_tag", device: srcHost.name,
      detail: `802.1Q タグ: TPID=0x8100 VID=${frame.vlanTag.vid} PCP=${frame.vlanTag.pcp}` });
  }

  trace.push({ tick, phase: "fcs_check", device: srcHost.name,
    detail: `FCS (CRC-32): 0x${frame.fcs}` });

  // 2. CSMA/CD
  tick++;
  trace.push({ tick, phase: "csma_cd", device: srcHost.name,
    detail: "キャリア検知: 回線空き → 送信開始" });

  // 衝突チェック (シミュレーション: 同一 tick に複数送信があるかで判定)
  const collisionChance = Math.random();
  if (collisionChance < 0.05) {
    trace.push({ tick, phase: "collision", device: srcHost.name,
      detail: "衝突検出! JAM 信号送信 (48bit)" });
    tick++;
    const backoffSlots = Math.floor(Math.random() * 4);
    trace.push({ tick, phase: "backoff", device: srcHost.name,
      detail: `指数バックオフ: ${backoffSlots} スロット待機 (512 bit-time × ${backoffSlots})` });
    tick++;
    trace.push({ tick, phase: "csma_cd", device: srcHost.name,
      detail: "再送信: キャリア検知 OK → 送信" });
  }

  // 3. スイッチに到着
  tick++;
  trace.push({ tick, phase: "transmit", device: srcHost.name,
    detail: `フレームをポート ${srcHost.port} に送信` });

  // 4. MAC アドレス学習
  tick++;
  const existingEntry = sw.macTable.find((e) => e.mac === srcHost.mac);
  if (existingEntry === undefined) {
    sw.macTable.push({ mac: srcHost.mac, port: srcHost.port, vlan: vlan ?? 1, age: 0 });
    trace.push({ tick, phase: "mac_learn", device: sw.name,
      detail: `MAC 学習: ${srcHost.mac} → ポート ${srcHost.port} (VLAN ${vlan ?? 1})` });
  } else {
    existingEntry.age = 0;
    trace.push({ tick, phase: "mac_learn", device: sw.name,
      detail: `MAC テーブル更新: ${srcHost.mac} (age リセット)` });
  }

  // 5. STP チェック
  const srcPort = sw.ports.find((p) => p.id === srcHost.port);
  if (srcPort !== undefined && srcPort.stpState === "blocking") {
    trace.push({ tick, phase: "stp", device: sw.name,
      detail: `ポート ${srcHost.port} は STP Blocking → フレーム破棄` });
    return { frames: [frame], trace, macTableAfter: [...sw.macTable] };
  }

  // 6. 宛先 MAC ルックアップ
  tick++;
  if (isBroadcast) {
    trace.push({ tick, phase: "mac_lookup", device: sw.name,
      detail: `宛先 ${dstMac} → ブロードキャスト` });

    // 全ポートにフラッディング (送信元ポート除く)
    tick++;
    for (const port of sw.ports) {
      if (port.id === srcHost.port) continue;
      if (port.host === null) continue;

      // VLAN フィルタ
      if (vlan !== undefined && port.mode === "access" && port.vlan !== vlan) {
        trace.push({ tick, phase: "vlan_filter", device: sw.name,
          detail: `ポート ${port.id} (VLAN ${port.vlan}) → フィルタ (VLAN ${vlan} 不一致)` });
        continue;
      }

      trace.push({ tick, phase: "broadcast", device: sw.name,
        detail: `フラッディング → ポート ${port.id} (${port.host})` });

      const targetHost = network.hosts.find((h) => h.name === port.host);
      if (targetHost !== undefined) {
        trace.push({ tick, phase: "receive", device: targetHost.name,
          detail: `ブロードキャストフレーム受信 (${srcHost.mac} → ${dstMac})` });
      }
    }
  } else {
    const macEntry = sw.macTable.find((e) => e.mac === dstMac);
    if (macEntry !== undefined) {
      trace.push({ tick, phase: "mac_lookup", device: sw.name,
        detail: `MAC テーブルヒット: ${dstMac} → ポート ${macEntry.port}` });

      tick++;
      trace.push({ tick, phase: "forward", device: sw.name,
        detail: `ユニキャスト転送 → ポート ${macEntry.port}` });

      if (dstHost !== undefined) {
        trace.push({ tick, phase: "receive", device: dstHost.name,
          detail: `フレーム受信: ${srcHost.mac} → ${dstMac} (${frame.etherTypeName})` });
        trace.push({ tick, phase: "fcs_check", device: dstHost.name,
          detail: `FCS 検証: 0x${frame.fcs} → OK` });
      }
    } else {
      trace.push({ tick, phase: "mac_lookup", device: sw.name,
        detail: `MAC テーブルミス: ${dstMac} → フラッディング (Unknown Unicast)` });

      tick++;
      for (const port of sw.ports) {
        if (port.id === srcHost.port) continue;
        if (port.host === null) continue;

        if (vlan !== undefined && port.mode === "access" && port.vlan !== vlan) {
          trace.push({ tick, phase: "vlan_filter", device: sw.name,
            detail: `ポート ${port.id} (VLAN ${port.vlan}) → VLAN 不一致スキップ` });
          continue;
        }

        trace.push({ tick, phase: "broadcast", device: sw.name,
          detail: `Unknown Unicast フラッディング → ポート ${port.id} (${port.host})` });
      }
    }
  }

  return { frames: [frame], trace, macTableAfter: [...sw.macTable] };
}

/** フレームの構造を分解して表示用の配列にする */
export function dissectFrame(frame: EthernetFrame): { field: string; value: string; size: string; color: string }[] {
  const fields: { field: string; value: string; size: string; color: string }[] = [
    { field: "Preamble + SFD", value: frame.preamble, size: "8 B", color: "#64748b" },
    { field: "Dst MAC", value: frame.dstMac, size: "6 B", color: "#ef4444" },
    { field: "Src MAC", value: frame.srcMac, size: "6 B", color: "#3b82f6" },
  ];

  if (frame.vlanTag !== null) {
    fields.push({ field: "802.1Q TPID", value: `0x${frame.vlanTag.tpid.toString(16)}`, size: "2 B", color: "#f59e0b" });
    fields.push({ field: "VLAN ID", value: String(frame.vlanTag.vid), size: "12 bit", color: "#f59e0b" });
    fields.push({ field: "PCP / DEI", value: `${frame.vlanTag.pcp} / ${frame.vlanTag.dei}`, size: "4 bit", color: "#f59e0b" });
  }

  fields.push({ field: "EtherType", value: `0x${frame.etherType.toString(16).padStart(4, "0")} (${frame.etherTypeName})`, size: "2 B", color: "#22c55e" });
  fields.push({ field: "Payload", value: frame.payload.slice(0, 40) + (frame.payloadSize > 40 ? "..." : ""), size: `${frame.payloadSize} B`, color: "#a78bfa" });

  if (frame.payloadSize < 46) {
    fields.push({ field: "Padding", value: `0x00 × ${46 - frame.payloadSize}`, size: `${46 - frame.payloadSize} B`, color: "#475569" });
  }

  fields.push({ field: "FCS (CRC-32)", value: `0x${frame.fcs}`, size: "4 B", color: "#ec4899" });

  return fields;
}
