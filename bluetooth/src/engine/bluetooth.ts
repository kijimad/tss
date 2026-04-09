/**
 * bluetooth.ts — Bluetooth / BLE エミュレーションエンジン
 *
 * Bluetooth Classic と BLE (Bluetooth Low Energy) の
 * プロトコルスタックをコード上でシミュレーションする。
 *
 * 機能:
 *   アドバタイズ → スキャン → 接続 → ペアリング →
 *   GATT サービス検出 → Characteristic 読み書き → 通知 → 切断
 */

// ── 基本型 ──

/** Bluetooth アドレス */
export type BdAddr = string;

/** UUID (16-bit short / 128-bit full) */
export type UUID = string;

/** Bluetooth バージョン */
export type BtVersion = "4.0" | "4.2" | "5.0" | "5.2" | "5.3";

/** PHY (物理層) */
export type PhyType = "1M" | "2M" | "Coded-S2" | "Coded-S8";

/** アドバタイズタイプ */
export type AdvType = "ADV_IND" | "ADV_DIRECT_IND" | "ADV_NONCONN_IND" | "ADV_SCAN_IND" | "ADV_EXT_IND";

/** ペアリング方式 */
export type PairingMethod = "just-works" | "passkey" | "numeric-comparison" | "oob";

/** 接続状態 */
export type ConnectionState = "disconnected" | "advertising" | "scanning" | "connecting" | "connected" | "paired" | "bonded";

/** GATT 権限 */
export type CharPermission = "read" | "write" | "write-no-response" | "notify" | "indicate";

// ── GATT 構造 ──

/** GATT Characteristic */
export interface GattCharacteristic {
  uuid: UUID;
  name: string;
  permissions: CharPermission[];
  /** 現在の値 (hex 文字列) */
  value: string;
  /** 値の人間可読表現 */
  displayValue: string;
  /** 通知が有効か */
  notifying: boolean;
  /** Descriptor 一覧 */
  descriptors: GattDescriptor[];
}

/** GATT Descriptor */
export interface GattDescriptor {
  uuid: UUID;
  name: string;
  value: string;
}

/** GATT Service */
export interface GattService {
  uuid: UUID;
  name: string;
  primary: boolean;
  characteristics: GattCharacteristic[];
}

/** GATT プロファイル (サービスの集合) */
export interface GattProfile {
  services: GattService[];
}

// ── デバイス定義 ──

/** アドバタイズデータ */
export interface AdvData {
  /** ローカル名 */
  localName: string;
  /** 送信電力 (dBm) */
  txPower: number;
  /** サービス UUID リスト */
  serviceUuids: UUID[];
  /** メーカー固有データ (hex) */
  manufacturerData?: string;
  /** サービスデータ */
  serviceData?: { uuid: UUID; data: string }[];
  /** フラグ */
  flags: number;
}

/** BLE デバイス */
export interface BleDevice {
  address: BdAddr;
  name: string;
  version: BtVersion;
  /** 対応 PHY */
  supportedPhy: PhyType[];
  /** RSSI (dBm, 距離に応じて変動) */
  rssi: number;
  /** 距離 (m) */
  distance: number;
  /** アドバタイズデータ */
  advData: AdvData;
  /** アドバタイズ間隔 (ms) */
  advInterval: number;
  /** アドバタイズタイプ */
  advType: AdvType;
  /** GATT プロファイル */
  gattProfile: GattProfile;
  /** IO Capability (ペアリング用) */
  ioCap: "display-only" | "display-yesno" | "keyboard-only" | "keyboard-display" | "no-io";
  /** ボンディングキー (保存済みの場合) */
  bondKey?: string;
  /** 接続可能か */
  connectable: boolean;
  /** MTU */
  mtu: number;
}

/** L2CAP パケット */
export interface L2capPacket {
  /** チャネル ID */
  cid: number;
  /** チャネル名 */
  channelName: string;
  /** ペイロード長 */
  length: number;
  /** ペイロード概要 */
  payload: string;
}

/** HCI イベント */
export interface HciEvent {
  /** イベントコード */
  eventCode: number;
  name: string;
  params: string;
}

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  layer: "Radio" | "HCI" | "L2CAP" | "ATT" | "GATT" | "SMP" | "GAP" | "App";
  type: "adv" | "scan" | "connect" | "pair" | "gatt_discover" | "gatt_read" | "gatt_write" | "gatt_notify" | "disconnect" | "error" | "info";
  direction: "→" | "←" | "●";
  detail: string;
  packet?: L2capPacket;
  hci?: HciEvent;
}

/** シミュレーション設定 */
export interface SimConfig {
  /** セントラル (スキャナー/クライアント) デバイス */
  central: BleDevice;
  /** ペリフェラル (アドバタイザー/サーバー) デバイス */
  peripheral: BleDevice;
  /** 使用する PHY */
  phy: PhyType;
  /** ペアリングを行うか */
  pairing: boolean;
  /** ペアリング方式 (ペアリング時) */
  pairingMethod: PairingMethod;
  /** 読み込む Characteristic UUID リスト */
  readCharacteristics: UUID[];
  /** 書き込む Characteristic (UUID→値) */
  writeCharacteristics: { uuid: UUID; value: string; displayValue: string }[];
  /** 通知を有効にする Characteristic UUID リスト */
  enableNotifications: UUID[];
  /** 通知で受信するデータ */
  notificationValues: { uuid: UUID; value: string; displayValue: string }[];
  /** 環境ノイズレベル (dBm) */
  noiseFloor: number;
  /** シミュレーション遅延基準 (ms) */
  latencyMs: number;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  finalState: ConnectionState;
  /** 検出されたサービス */
  discoveredServices: GattService[];
  /** 読み取った値 */
  readValues: { uuid: UUID; name: string; value: string; displayValue: string }[];
  /** 受信した通知 */
  notifications: { uuid: UUID; name: string; value: string; displayValue: string }[];
  totalTime: number;
  /** 接続パラメータ */
  connectionParams?: { interval: number; latency: number; timeout: number; mtu: number; phy: PhyType };
}

// ── ユーティリティ ──

/** RSSI を距離から推定する (Free-space path loss 簡易モデル) */
export function rssiFromDistance(txPower: number, distanceM: number): number {
  if (distanceM <= 0) return txPower;
  // RSSI = txPower - 10 * n * log10(d) — n=2 (自由空間)
  return Math.round(txPower - 20 * Math.log10(distanceM));
}

/** ランダム BD_ADDR を生成する */
export function randomBdAddr(): BdAddr {
  const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return `${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`;
}

/** ペアリング方式を IO Capability から決定する */
export function determinePairingMethod(centralIo: BleDevice["ioCap"], peripheralIo: BleDevice["ioCap"]): PairingMethod {
  // BT Spec Vol 3 Part H Table 2.8 の簡易版
  if (centralIo === "no-io" || peripheralIo === "no-io") return "just-works";
  if (centralIo === "keyboard-display" && peripheralIo === "display-yesno") return "numeric-comparison";
  if (centralIo === "display-yesno" && peripheralIo === "display-yesno") return "numeric-comparison";
  if (centralIo === "keyboard-only" || peripheralIo === "keyboard-only") return "passkey";
  if (centralIo === "keyboard-display" || peripheralIo === "keyboard-display") return "passkey";
  return "just-works";
}

/** 16-bit UUID を 128-bit に展開する */
export function expandUuid(short: string): UUID {
  if (short.length > 8) return short;
  return `0000${short.padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
}

// ── 既知の UUID ──

export const KNOWN_UUIDS: Record<string, string> = {
  "1800": "Generic Access",
  "1801": "Generic Attribute",
  "180a": "Device Information",
  "180d": "Heart Rate",
  "180f": "Battery Service",
  "1810": "Blood Pressure",
  "1816": "Cycling Speed and Cadence",
  "181a": "Environmental Sensing",
  "2a00": "Device Name",
  "2a01": "Appearance",
  "2a19": "Battery Level",
  "2a24": "Model Number String",
  "2a25": "Serial Number String",
  "2a26": "Firmware Revision",
  "2a27": "Hardware Revision",
  "2a28": "Software Revision",
  "2a29": "Manufacturer Name",
  "2a37": "Heart Rate Measurement",
  "2a38": "Body Sensor Location",
  "2a6e": "Temperature",
  "2a6f": "Humidity",
  "2902": "CCCD",
};

/** UUID の表示名を取得する */
export function uuidName(uuid: UUID): string {
  const short = uuid.length <= 8 ? uuid : uuid.slice(4, 8);
  return KNOWN_UUIDS[short.toLowerCase()] ?? uuid;
}

// ── シミュレーター ──

export class BluetoothSimulator {
  simulate(config: SimConfig): SimResult {
    const events: SimEvent[] = [];
    const readValues: SimResult["readValues"] = [];
    const notifications: SimResult["notifications"] = [];
    let time = 0;
    const lat = config.latencyMs;
    const p = config.peripheral;
    const c = config.central;

    // ── 1. アドバタイズ ──
    events.push({ time, layer: "GAP", type: "info", direction: "●", detail: `ペリフェラル "${p.name}" がアドバタイズ開始 (${p.advType}, interval=${p.advInterval}ms)` });

    const rssi = rssiFromDistance(p.advData.txPower, p.distance);
    for (let i = 0; i < 3; i++) {
      time += p.advInterval;
      events.push({
        time, layer: "Radio", type: "adv", direction: "←",
        detail: `ADV_IND ch=${37 + i}: "${p.advData.localName}" rssi=${rssi}dBm txPower=${p.advData.txPower}dBm`,
        hci: { eventCode: 0x3e, name: "LE Advertising Report", params: `addr=${p.address} rssi=${rssi} data=[flags=${p.advData.flags.toString(16)}, name="${p.advData.localName}"]` },
      });
    }

    // ── 2. スキャン ──
    time += lat;
    events.push({ time, layer: "GAP", type: "scan", direction: "●", detail: `セントラル "${c.name}" がスキャン開始 (active scan)` });
    events.push({
      time, layer: "HCI", type: "scan", direction: "→",
      detail: `LE Set Scan Enable (enable=1, filter_dup=1)`,
      hci: { eventCode: 0x0e, name: "Command Complete", params: "LE_Set_Scan_Enable" },
    });

    time += p.advInterval + lat;
    events.push({
      time, layer: "Radio", type: "scan", direction: "←",
      detail: `SCAN_RSP: services=[${p.advData.serviceUuids.map((u) => uuidName(u)).join(", ")}]${p.advData.manufacturerData ? ` mfr=${p.advData.manufacturerData.slice(0, 16)}...` : ""}`,
    });
    events.push({
      time, layer: "GAP", type: "scan", direction: "●",
      detail: `デバイス検出: "${p.name}" (${p.address}) RSSI=${rssi}dBm 距離≈${p.distance}m`,
    });

    // ── 3. 接続 ──
    time += lat;
    events.push({
      time, layer: "HCI", type: "connect", direction: "→",
      detail: `LE Create Connection (peer=${p.address}, phy=${config.phy})`,
      hci: { eventCode: 0x0e, name: "Command Status", params: "LE_Create_Connection" },
    });

    time += lat * 2;
    const connInterval = 7.5;
    const connLatency = 0;
    const supervisionTimeout = 4000;
    events.push({
      time, layer: "HCI", type: "connect", direction: "←",
      detail: `LE Connection Complete: handle=0x0040 interval=${connInterval}ms latency=${connLatency} timeout=${supervisionTimeout}ms`,
      hci: { eventCode: 0x3e, name: "LE Connection Complete", params: `handle=0x0040 role=central peer=${p.address}` },
    });
    events.push({
      time, layer: "L2CAP", type: "connect", direction: "●",
      detail: `L2CAP チャネル確立 (CID=0x0004 ATT, CID=0x0006 SMP)`,
      packet: { cid: 0x0004, channelName: "ATT", length: 0, payload: "channel open" },
    });

    // ── 4. MTU 交換 ──
    time += lat;
    const negotiatedMtu = Math.min(c.mtu, p.mtu);
    events.push({
      time, layer: "ATT", type: "gatt_read", direction: "→",
      detail: `Exchange MTU Request: client_mtu=${c.mtu}`,
      packet: { cid: 0x0004, channelName: "ATT", length: 3, payload: `opcode=0x02 mtu=${c.mtu}` },
    });
    time += lat;
    events.push({
      time, layer: "ATT", type: "gatt_read", direction: "←",
      detail: `Exchange MTU Response: server_mtu=${p.mtu} → negotiated=${negotiatedMtu}`,
      packet: { cid: 0x0004, channelName: "ATT", length: 3, payload: `opcode=0x03 mtu=${p.mtu}` },
    });

    // ── 5. PHY 更新 (5.0+) ──
    if (config.phy !== "1M" && p.supportedPhy.includes(config.phy)) {
      time += lat;
      events.push({ time, layer: "HCI", type: "connect", direction: "→", detail: `LE Set PHY: tx=${config.phy} rx=${config.phy}` });
      time += lat;
      events.push({ time, layer: "HCI", type: "connect", direction: "←", detail: `LE PHY Update Complete: tx=${config.phy} rx=${config.phy}` });
    }

    // ── 6. ペアリング (SMP) ──
    if (config.pairing) {
      time += lat;
      const method = config.pairingMethod;
      events.push({
        time, layer: "SMP", type: "pair", direction: "→",
        detail: `Pairing Request: io=${c.ioCap} oob=0 auth=bonding|mitm|sc max_key=16`,
        packet: { cid: 0x0006, channelName: "SMP", length: 7, payload: "opcode=0x01 Pairing Request" },
      });
      time += lat;
      events.push({
        time, layer: "SMP", type: "pair", direction: "←",
        detail: `Pairing Response: io=${p.ioCap} oob=0 auth=bonding|mitm|sc max_key=16`,
        packet: { cid: 0x0006, channelName: "SMP", length: 7, payload: "opcode=0x02 Pairing Response" },
      });

      events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: `ペアリング方式決定: ${method} (central=${c.ioCap}, peripheral=${p.ioCap})` });

      // 方式ごとの手順
      time += lat;
      switch (method) {
        case "just-works":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "Just Works: ユーザー操作なしで鍵交換 (MITM 保護なし)" });
          break;
        case "passkey":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "Passkey Entry: ペリフェラルが表示した 6 桁を入力 → 123456" });
          events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "Pairing Confirm (passkey commitment)" });
          time += lat;
          events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "Pairing Confirm (passkey commitment)" });
          break;
        case "numeric-comparison":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "Numeric Comparison: 両デバイスに 6 桁表示 → 854217 — ユーザーが「はい」" });
          events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "Pairing Confirm + DHKey Check" });
          time += lat;
          events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "Pairing Confirm + DHKey Check" });
          break;
        case "oob":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "OOB: NFC タップで鍵情報を交換" });
          break;
      }

      // LE Secure Connections の鍵交換
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "Public Key (ECDH P-256): 64 bytes" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "Public Key (ECDH P-256): 64 bytes" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "DHKey Check: 確認値送信" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "DHKey Check: 確認値送信" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "ペアリング完了: LTK (Long Term Key) 生成・保存 → ボンディング確立" });
      events.push({
        time, layer: "SMP", type: "pair", direction: "●",
        detail: `暗号化開始: AES-CCM (128-bit LTK)`,
      });
    }

    // ── 7. GATT サービス検出 ──
    time += lat;
    events.push({
      time, layer: "GATT", type: "gatt_discover", direction: "→",
      detail: "Discover All Primary Services (ATT Read By Group Type, uuid=0x2800)",
      packet: { cid: 0x0004, channelName: "ATT", length: 7, payload: "opcode=0x10 start=0x0001 end=0xFFFF uuid=0x2800" },
    });
    time += lat;

    const discoveredServices = p.gattProfile.services;
    let handle = 1;
    for (const svc of discoveredServices) {
      const svcName = uuidName(svc.uuid);
      events.push({
        time, layer: "GATT", type: "gatt_discover", direction: "←",
        detail: `Service: ${svcName} (${svc.uuid}) handles=${handle}–${handle + svc.characteristics.length * 2}`,
      });

      // Characteristic 検出
      for (const ch of svc.characteristics) {
        handle++;
        const chName = uuidName(ch.uuid);
        events.push({
          time: time + 1, layer: "GATT", type: "gatt_discover", direction: "←",
          detail: `  Char: ${chName} (${ch.uuid}) props=[${ch.permissions.join(",")}] handle=${handle}`,
        });
        handle++;
      }
      time += lat;
    }

    // ── 8. Characteristic 読み取り ──
    for (const readUuid of config.readCharacteristics) {
      const ch = this.findCharacteristic(discoveredServices, readUuid);
      if (!ch) continue;
      time += lat;
      const chName = uuidName(ch.uuid);
      events.push({
        time, layer: "ATT", type: "gatt_read", direction: "→",
        detail: `Read Request: ${chName} (${ch.uuid})`,
        packet: { cid: 0x0004, channelName: "ATT", length: 3, payload: `opcode=0x0A` },
      });
      time += lat;
      events.push({
        time, layer: "ATT", type: "gatt_read", direction: "←",
        detail: `Read Response: ${chName} = "${ch.displayValue}" (0x${ch.value})`,
        packet: { cid: 0x0004, channelName: "ATT", length: ch.value.length / 2 + 1, payload: `opcode=0x0B data=0x${ch.value}` },
      });
      readValues.push({ uuid: ch.uuid, name: chName, value: ch.value, displayValue: ch.displayValue });
    }

    // ── 9. Characteristic 書き込み ──
    for (const w of config.writeCharacteristics) {
      const ch = this.findCharacteristic(discoveredServices, w.uuid);
      if (!ch) continue;
      time += lat;
      const chName = uuidName(ch.uuid);
      const writeType = ch.permissions.includes("write-no-response") ? "Write Command (no response)" : "Write Request";
      events.push({
        time, layer: "ATT", type: "gatt_write", direction: "→",
        detail: `${writeType}: ${chName} ← "${w.displayValue}" (0x${w.value})`,
        packet: { cid: 0x0004, channelName: "ATT", length: w.value.length / 2 + 3, payload: `opcode=${ch.permissions.includes("write-no-response") ? "0x52" : "0x12"}` },
      });
      if (!ch.permissions.includes("write-no-response")) {
        time += lat;
        events.push({
          time, layer: "ATT", type: "gatt_write", direction: "←",
          detail: `Write Response: OK`,
          packet: { cid: 0x0004, channelName: "ATT", length: 1, payload: "opcode=0x13" },
        });
      }
      ch.value = w.value;
      ch.displayValue = w.displayValue;
    }

    // ── 10. 通知の有効化 ──
    for (const notifyUuid of config.enableNotifications) {
      const ch = this.findCharacteristic(discoveredServices, notifyUuid);
      if (!ch || !ch.permissions.includes("notify")) continue;
      time += lat;
      const chName = uuidName(ch.uuid);
      events.push({
        time, layer: "ATT", type: "gatt_write", direction: "→",
        detail: `Write CCCD: ${chName} 通知有効 (0x0100)`,
        packet: { cid: 0x0004, channelName: "ATT", length: 5, payload: "opcode=0x12 CCCD=0x0100" },
      });
      time += lat;
      events.push({ time, layer: "ATT", type: "gatt_write", direction: "←", detail: "Write Response: OK" });
      ch.notifying = true;
    }

    // ── 11. 通知受信 ──
    for (const n of config.notificationValues) {
      const ch = this.findCharacteristic(discoveredServices, n.uuid);
      if (!ch) continue;
      time += lat * 3;
      const chName = uuidName(ch.uuid);
      events.push({
        time, layer: "ATT", type: "gatt_notify", direction: "←",
        detail: `Handle Value Notification: ${chName} = "${n.displayValue}" (0x${n.value})`,
        packet: { cid: 0x0004, channelName: "ATT", length: n.value.length / 2 + 3, payload: `opcode=0x1B data=0x${n.value}` },
      });
      events.push({
        time, layer: "App", type: "gatt_notify", direction: "●",
        detail: `アプリ通知: ${chName} → ${n.displayValue}`,
      });
      notifications.push({ uuid: n.uuid, name: chName, value: n.value, displayValue: n.displayValue });
    }

    // ── 12. 切断 ──
    time += lat * 2;
    events.push({
      time, layer: "HCI", type: "disconnect", direction: "→",
      detail: "Disconnect (reason=0x13 Remote User Terminated)",
      hci: { eventCode: 0x05, name: "Disconnection Complete", params: "handle=0x0040 reason=0x13" },
    });
    time += lat;
    events.push({ time, layer: "GAP", type: "disconnect", direction: "●", detail: "接続終了" });

    return {
      events,
      finalState: config.pairing ? "bonded" : "disconnected",
      discoveredServices,
      readValues,
      notifications,
      totalTime: time,
      connectionParams: { interval: connInterval, latency: connLatency, timeout: supervisionTimeout, mtu: negotiatedMtu, phy: config.phy },
    };
  }

  private findCharacteristic(services: GattService[], uuid: UUID): GattCharacteristic | undefined {
    for (const svc of services) {
      const ch = svc.characteristics.find((c) => c.uuid === uuid);
      if (ch) return ch;
    }
    return undefined;
  }
}

// ── プリセット用ヘルパー ──

/** Characteristic を簡潔に作成する */
export function char(uuid: UUID, name: string, perms: CharPermission[], value: string, displayValue: string): GattCharacteristic {
  const descriptors: GattDescriptor[] = [];
  if (perms.includes("notify") || perms.includes("indicate")) {
    descriptors.push({ uuid: "2902", name: "CCCD", value: "0000" });
  }
  return { uuid, name, permissions: perms, value, displayValue, notifying: false, descriptors };
}

/** Service を簡潔に作成する */
export function svc(uuid: UUID, name: string, chars: GattCharacteristic[]): GattService {
  return { uuid, name, primary: true, characteristics: chars };
}

/** デフォルトの BLE デバイスを作成する */
export function createDevice(
  name: string, address: BdAddr, services: GattService[],
  opts?: Partial<Pick<BleDevice, "version" | "distance" | "ioCap" | "mtu" | "advType" | "connectable" | "supportedPhy">>,
): BleDevice {
  const txPower = -4;
  const distance = opts?.distance ?? 1;
  return {
    address, name, version: opts?.version ?? "5.0",
    supportedPhy: opts?.supportedPhy ?? ["1M", "2M"],
    rssi: rssiFromDistance(txPower, distance),
    distance,
    advData: {
      localName: name, txPower, serviceUuids: services.map((s) => s.uuid),
      flags: 0x06, manufacturerData: "4c000215",
    },
    advInterval: 100,
    advType: opts?.advType ?? "ADV_IND",
    gattProfile: { services },
    ioCap: opts?.ioCap ?? "no-io",
    connectable: opts?.connectable ?? true,
    mtu: opts?.mtu ?? 247,
  };
}
