/**
 * USBドライバスタック
 * ホストコントローラドライバ → USBコア → デバイスドライバ の3層構造
 */

import {
  type UsbHostController,
  type UsbDevice,
  type UsbPacket,
  type UsbPort,
  type UsbEndpoint,
  UsbClass,
  PortStatus,
  EndpointDirection,
} from "../hw/hardware.js";

// ========== ドライバイベント ==========
export type DriverEventType =
  | "reset"           // バスリセット
  | "port_scan"       // ポートスキャン
  | "device_detect"   // デバイス検出
  | "speed_detect"    // 速度ネゴシエーション
  | "address_assign"  // アドレス割当
  | "descriptor_get"  // ディスクリプタ取得
  | "config_set"      // コンフィグレーション設定
  | "driver_bind"     // ドライババインド
  | "transfer"        // データ転送
  | "packet"          // パケット送受信
  | "error"           // エラー
  | "disconnect"      // 切断検出
  | "log";            // 一般ログ

export interface DriverEvent {
  type: DriverEventType;
  timestamp: number;
  port?: number;
  address?: number;
  detail: string;
  data?: Record<string, unknown>;
  packet?: UsbPacket;
}

// ========== デバイスドライバ (各クラス用) ==========
export interface UsbDeviceDriver {
  name: string;
  supportedClass: UsbClass;
  /** ドライバがデバイスをサポートするか判定 */
  probe(device: UsbDevice): boolean;
  /** ドライバを初期化し、デバイスと紐付ける */
  attach(device: UsbDevice): string;
}

/** HIDドライバ (キーボード/マウス) */
const hidDriver: UsbDeviceDriver = {
  name: "usbhid",
  supportedClass: UsbClass.HID,
  probe(device) {
    return device.descriptor.deviceClass === UsbClass.HID ||
      device.descriptor.configurations.some(c =>
        c.interfaces.some(i => i.classCode === UsbClass.HID)
      );
  },
  attach(device) {
    const proto = device.descriptor.deviceProtocol;
    if (proto === 1) return "input: キーボード (Boot Protocol)";
    if (proto === 2) return "input: マウス (Boot Protocol)";
    return "input: HIDデバイス";
  },
};

/** マスストレージドライバ */
const massStorageDriver: UsbDeviceDriver = {
  name: "usb-storage",
  supportedClass: UsbClass.MassStorage,
  probe(device) {
    return device.descriptor.deviceClass === UsbClass.MassStorage ||
      device.descriptor.configurations.some(c =>
        c.interfaces.some(i => i.classCode === UsbClass.MassStorage)
      );
  },
  attach(dev) {
    const size = dev.dataBuffer.length;
    return `scsi: マスストレージ (${size} bytes buffer)`;
  },
};

/** オーディオドライバ */
const audioDriver: UsbDeviceDriver = {
  name: "snd-usb-audio",
  supportedClass: UsbClass.Audio,
  probe(device) {
    return device.descriptor.deviceClass === UsbClass.Audio ||
      device.descriptor.configurations.some(c =>
        c.interfaces.some(i => i.classCode === UsbClass.Audio)
      );
  },
  attach(_device) {
    return "sound: USBオーディオデバイス";
  },
};

/** 登録済みドライバ一覧 */
const registeredDrivers: UsbDeviceDriver[] = [hidDriver, massStorageDriver, audioDriver];

// ========== USBコア (ドライバスタック本体) ==========
export class UsbCore {
  private hc: UsbHostController;
  private events: DriverEvent[] = [];
  private delayMs: number;
  onEvent?: (event: DriverEvent) => void;

  constructor(hc: UsbHostController, delayMs: number = 50) {
    this.hc = hc;
    this.delayMs = delayMs;
  }

  /** 全イベントログを取得 */
  getEvents(): DriverEvent[] {
    return [...this.events];
  }

  /** イベントを発行 */
  private emit(event: Omit<DriverEvent, "timestamp">): DriverEvent {
    const full: DriverEvent = { ...event, timestamp: performance.now() };
    this.events.push(full);
    this.onEvent?.(full);
    return full;
  }

  /** 遅延 */
  private wait(): Promise<void> {
    if (this.delayMs <= 0) return Promise.resolve();
    return new Promise(r => setTimeout(r, this.delayMs));
  }

  // ========== コントロール転送のシミュレーション ==========

  /** SETUPパケットを送信 (コントロール転送のセットアップフェーズ) */
  private sendSetupPacket(address: number, endpoint: number, setupData: Uint8Array): UsbPacket {
    const packet: UsbPacket = {
      pid: "SETUP",
      address,
      endpoint,
      data: setupData,
    };
    this.emit({
      type: "packet",
      address,
      detail: `SETUP → addr=${address} ep=${endpoint} [${setupData.length}B]`,
      packet,
    });
    return packet;
  }

  /** DATAパケットを送信 */
  private sendDataPacket(address: number, endpoint: number, data: Uint8Array, toggle: 0 | 1): UsbPacket {
    const pid = toggle === 0 ? "DATA0" : "DATA1";
    const packet: UsbPacket = { pid, address, endpoint, data };
    this.emit({
      type: "packet",
      address,
      detail: `${pid} → addr=${address} ep=${endpoint} [${data.length}B]`,
      packet,
    });
    return packet;
  }

  /** ACKパケットを受信 */
  private receiveAck(address: number, endpoint: number): UsbPacket {
    const packet: UsbPacket = { pid: "ACK", address, endpoint };
    this.emit({
      type: "packet",
      address,
      detail: `ACK ← addr=${address} ep=${endpoint}`,
      packet,
    });
    return packet;
  }

  // ========== GET_DESCRIPTOR コントロール転送 ==========
  private buildGetDescriptorSetup(type: number, index: number, length: number): Uint8Array {
    // bmRequestType=0x80 (Device→Host), bRequest=0x06 (GET_DESCRIPTOR)
    const buf = new Uint8Array(8);
    buf[0] = 0x80;       // bmRequestType: IN, Standard, Device
    buf[1] = 0x06;       // bRequest: GET_DESCRIPTOR
    buf[2] = index;      // wValue low (descriptor index)
    buf[3] = type;       // wValue high (descriptor type)
    buf[4] = 0x00;       // wIndex low
    buf[5] = 0x00;       // wIndex high
    buf[6] = length & 0xff;        // wLength low
    buf[7] = (length >> 8) & 0xff; // wLength high
    return buf;
  }

  // ========== SET_ADDRESS コントロール転送 ==========
  private buildSetAddressSetup(address: number): Uint8Array {
    // bmRequestType=0x00 (Host→Device), bRequest=0x05 (SET_ADDRESS)
    const buf = new Uint8Array(8);
    buf[0] = 0x00;
    buf[1] = 0x05;
    buf[2] = address & 0xff;
    buf[3] = 0x00;
    buf[4] = 0x00;
    buf[5] = 0x00;
    buf[6] = 0x00;
    buf[7] = 0x00;
    return buf;
  }

  // ========== SET_CONFIGURATION コントロール転送 ==========
  private buildSetConfigSetup(configValue: number): Uint8Array {
    const buf = new Uint8Array(8);
    buf[0] = 0x00;
    buf[1] = 0x09;   // SET_CONFIGURATION
    buf[2] = configValue & 0xff;
    buf[3] = 0x00;
    buf[4] = 0x00;
    buf[5] = 0x00;
    buf[6] = 0x00;
    buf[7] = 0x00;
    return buf;
  }

  // ========== エニュメレーション (デバイス列挙) ==========

  /** 単一ポートのデバイスをエニュメレーションする */
  async enumeratePort(port: UsbPort): Promise<boolean> {
    if (!port.device || port.status === PortStatus.Empty) {
      return false;
    }
    const device = port.device;

    // 1. ポートリセット
    this.emit({
      type: "reset",
      port: port.portNumber,
      detail: `ポート${port.portNumber}をリセット`,
    });
    await this.wait();

    // 2. 速度検出
    this.emit({
      type: "speed_detect",
      port: port.portNumber,
      detail: `速度ネゴシエーション: ${device.speed}`,
      data: { speed: device.speed },
    });
    await this.wait();

    // 3. デフォルトアドレス(0)でデバイスディスクリプタ取得 (最初の8バイト)
    this.sendSetupPacket(0, 0, this.buildGetDescriptorSetup(1, 0, 8));
    await this.wait();
    // デバイスがデータで応答
    const shortDesc = new Uint8Array(8);
    shortDesc[0] = 18;  // bLength
    shortDesc[1] = 1;   // bDescriptorType = DEVICE
    shortDesc[7] = device.descriptor.maxPacketSize0;
    this.sendDataPacket(0, 0, shortDesc, 1);
    this.receiveAck(0, 0);
    this.emit({
      type: "descriptor_get",
      port: port.portNumber,
      detail: `デバイスディスクリプタ (8B): maxPacketSize0=${device.descriptor.maxPacketSize0}`,
      data: { maxPacketSize0: device.descriptor.maxPacketSize0 },
    });
    await this.wait();

    // 4. アドレス割当
    const addr = this.hc.nextAddress++;
    this.sendSetupPacket(0, 0, this.buildSetAddressSetup(addr));
    await this.wait();
    this.receiveAck(0, 0);
    device.address = addr;
    this.hc.addressTable.set(addr, device);
    port.status = PortStatus.Enabled;
    this.emit({
      type: "address_assign",
      port: port.portNumber,
      address: addr,
      detail: `アドレス ${addr} を割当`,
    });
    await this.wait();

    // 5. 完全なデバイスディスクリプタ取得
    this.sendSetupPacket(addr, 0, this.buildGetDescriptorSetup(1, 0, 18));
    await this.wait();
    const fullDesc = new Uint8Array(18);
    fullDesc[0] = 18; fullDesc[1] = 1;
    fullDesc[8] = device.descriptor.vendorId & 0xff;
    fullDesc[9] = (device.descriptor.vendorId >> 8) & 0xff;
    fullDesc[10] = device.descriptor.productId & 0xff;
    fullDesc[11] = (device.descriptor.productId >> 8) & 0xff;
    this.sendDataPacket(addr, 0, fullDesc, 1);
    this.receiveAck(addr, 0);
    this.emit({
      type: "descriptor_get",
      port: port.portNumber,
      address: addr,
      detail: `デバイスディスクリプタ (18B): ${device.descriptor.manufacturer} ${device.descriptor.product}`,
      data: {
        vendorId: `0x${device.descriptor.vendorId.toString(16).padStart(4, "0")}`,
        productId: `0x${device.descriptor.productId.toString(16).padStart(4, "0")}`,
        manufacturer: device.descriptor.manufacturer,
        product: device.descriptor.product,
      },
    });
    await this.wait();

    // 6. コンフィグレーション設定
    const config = device.descriptor.configurations[0];
    if (!config) {
      this.emit({
        type: "error",
        port: port.portNumber,
        address: addr,
        detail: "コンフィグレーションが見つからない",
      });
      return false;
    }
    this.sendSetupPacket(addr, 0, this.buildSetConfigSetup(config.configValue));
    await this.wait();
    this.receiveAck(addr, 0);
    device.activeConfig = config.configValue;
    this.emit({
      type: "config_set",
      port: port.portNumber,
      address: addr,
      detail: `コンフィグレーション ${config.configValue} を設定 (${config.description}, ${config.maxPower}mA)`,
      data: {
        configValue: config.configValue,
        maxPower: config.maxPower,
        interfaces: config.interfaces.length,
      },
    });
    await this.wait();

    // 7. ドライババインド
    const driver = registeredDrivers.find(d => d.probe(device));
    if (driver) {
      const result = driver.attach(device);
      this.emit({
        type: "driver_bind",
        port: port.portNumber,
        address: addr,
        detail: `ドライバ "${driver.name}" をバインド → ${result}`,
        data: { driver: driver.name, result },
      });
    } else {
      this.emit({
        type: "log",
        port: port.portNumber,
        address: addr,
        detail: `対応するドライバが見つからない (class=0x${device.descriptor.deviceClass.toString(16)})`,
      });
    }
    await this.wait();

    return true;
  }

  /** 全ポートをスキャンしてエニュメレーション実行 */
  async scanAndEnumerate(): Promise<DriverEvent[]> {
    this.events = [];

    this.emit({
      type: "log",
      detail: `${this.hc.name} (vendor=0x${this.hc.vendorId.toString(16).padStart(4, "0")}) 初期化`,
    });
    await this.wait();

    // バスリセット
    this.emit({ type: "reset", detail: "USBバスリセット" });
    await this.wait();

    // ポートスキャン
    for (const port of this.hc.rootHub.ports) {
      this.emit({
        type: "port_scan",
        port: port.portNumber,
        detail: `ポート${port.portNumber}: ${port.device ? "デバイス検出" : "空"}`,
        data: { hasDevice: port.device !== null },
      });
      await this.wait();

      if (port.device) {
        this.emit({
          type: "device_detect",
          port: port.portNumber,
          detail: `デバイス検出: ${port.device.descriptor.product}`,
          data: { product: port.device.descriptor.product, speed: port.device.speed },
        });
        await this.wait();

        await this.enumeratePort(port);
      }
    }

    this.emit({
      type: "log",
      detail: `エニュメレーション完了: ${this.hc.addressTable.size} デバイス認識`,
    });

    return this.events;
  }

  /** ホットプラグ: 接続済みデバイスの単体エニュメレーション */
  async hotplugEnumerate(portNumber: number): Promise<DriverEvent[]> {
    const prevEvents = [...this.events];
    const port = this.hc.rootHub.ports.find(p => p.portNumber === portNumber);
    if (!port || !port.device) {
      this.emit({
        type: "error",
        port: portNumber,
        detail: `ポート${portNumber}にデバイスがない`,
      });
      return this.events.slice(prevEvents.length);
    }

    this.emit({
      type: "device_detect",
      port: portNumber,
      detail: `ホットプラグ検出: ${port.device.descriptor.product}`,
      data: { product: port.device.descriptor.product },
    });
    await this.wait();

    await this.enumeratePort(port);
    return this.events.slice(prevEvents.length);
  }

  /** Bulk転送シミュレーション */
  async bulkTransfer(
    address: number,
    endpoint: UsbEndpoint,
    data: Uint8Array,
  ): Promise<boolean> {
    const device = this.hc.addressTable.get(address);
    if (!device) {
      this.emit({ type: "error", address, detail: `アドレス ${address} のデバイスが見つからない` });
      return false;
    }

    const maxPacket = endpoint.maxPacketSize;
    let offset = 0;
    let toggle: 0 | 1 = 0;

    this.emit({
      type: "transfer",
      address,
      detail: `Bulk ${endpoint.direction}: ${data.length}B → ep${endpoint.address}`,
      data: { totalBytes: data.length, maxPacketSize: maxPacket },
    });
    await this.wait();

    // パケット分割して送信
    while (offset < data.length) {
      const chunk = data.slice(offset, offset + maxPacket);
      if (endpoint.direction === EndpointDirection.Out) {
        this.sendSetupPacket(address, endpoint.address,
          new Uint8Array([0x00])); // OUT token
        this.sendDataPacket(address, endpoint.address, chunk, toggle);
        this.receiveAck(address, endpoint.address);
      } else {
        // IN方向: デバイスからデータを受信
        const packet: UsbPacket = { pid: "IN", address, endpoint: endpoint.address };
        this.emit({ type: "packet", address, detail: `IN → addr=${address} ep=${endpoint.address}`, packet });
        this.sendDataPacket(address, endpoint.address, chunk, toggle);
        this.receiveAck(address, endpoint.address);
      }

      toggle = toggle === 0 ? 1 : 0;
      offset += maxPacket;
      await this.wait();
    }

    this.emit({
      type: "transfer",
      address,
      detail: `Bulk転送完了: ${data.length}B, ${Math.ceil(data.length / maxPacket)} パケット`,
    });

    return true;
  }

  /** Interrupt転送シミュレーション (HIDデバイス向け) */
  async interruptTransfer(
    address: number,
    endpoint: UsbEndpoint,
    data: Uint8Array,
  ): Promise<boolean> {
    const device = this.hc.addressTable.get(address);
    if (!device) {
      this.emit({ type: "error", address, detail: `アドレス ${address} のデバイスが見つからない` });
      return false;
    }

    this.emit({
      type: "transfer",
      address,
      detail: `Interrupt ${endpoint.direction}: ${data.length}B (interval=${endpoint.interval}ms)`,
      data: { bytes: data.length, interval: endpoint.interval },
    });
    await this.wait();

    // INトークン → DATA → ACK
    const inPacket: UsbPacket = { pid: "IN", address, endpoint: endpoint.address };
    this.emit({ type: "packet", address, detail: `IN → addr=${address} ep=${endpoint.address}`, packet: inPacket });
    this.sendDataPacket(address, endpoint.address, data, 1);
    this.receiveAck(address, endpoint.address);

    this.emit({
      type: "transfer",
      address,
      detail: `Interrupt転送完了: ${data.length}B`,
    });

    return true;
  }

  /** デバイス切断処理 */
  async handleDisconnect(portNumber: number): Promise<DriverEvent[]> {
    const startLen = this.events.length;
    const port = this.hc.rootHub.ports.find(p => p.portNumber === portNumber);
    if (!port || !port.device) {
      this.emit({ type: "error", port: portNumber, detail: `ポート${portNumber}: 切断するデバイスがない` });
      return this.events.slice(startLen);
    }

    const device = port.device;
    this.emit({
      type: "disconnect",
      port: portNumber,
      address: device.address,
      detail: `切断: ${device.descriptor.product} (addr=${device.address})`,
    });

    // アドレステーブルから削除
    if (device.address > 0) {
      this.hc.addressTable.delete(device.address);
    }
    device.address = 0;
    device.activeConfig = 0;
    port.device = null;
    port.status = PortStatus.Powered;
    port.speed = null;

    await this.wait();
    return this.events.slice(startLen);
  }
}
