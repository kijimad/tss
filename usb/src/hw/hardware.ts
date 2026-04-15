/**
 * USBハードウェアシミュレーションモジュール
 *
 * USB規格に基づくホストコントローラ、ハブ、デバイスの物理層をモデル化する。
 * デバイスディスクリプタ、エンドポイント、コンフィグレーション等のデータ構造と、
 * キーボード・マウス・フラッシュドライブ・オーディオデバイスのファクトリ関数を提供する。
 * 実際のハードウェアの電気的特性やタイミングはコード上でエミュレートされる。
 */

// ========== USB速度規格 ==========
/** USB通信速度の規格を表す列挙型 */
export enum UsbSpeed {
  Low = "1.5 Mbps",   // USB 1.0 Low Speed
  Full = "12 Mbps",   // USB 1.1 Full Speed
  High = "480 Mbps",  // USB 2.0 High Speed
  Super = "5 Gbps",   // USB 3.0 SuperSpeed
}

// ========== USBデバイスクラス ==========
/** USBデバイスクラスコードの列挙型（デバイスの機能分類を示す） */
export enum UsbClass {
  HID = 0x03,          // ヒューマンインターフェースデバイス
  MassStorage = 0x08,  // マスストレージ
  Audio = 0x01,        // オーディオ
  Printer = 0x07,      // プリンタ
  Hub = 0x09,          // ハブ
  Video = 0x0e,        // ビデオ
  Wireless = 0xe0,     // ワイヤレス
}

// ========== 転送タイプ ==========
/** USB転送タイプの列挙型（データ転送の方式を定義する） */
export enum TransferType {
  Control = "control",
  Bulk = "bulk",
  Interrupt = "interrupt",
  Isochronous = "isochronous",
}

// ========== エンドポイント方向 ==========
/** エンドポイントのデータ転送方向（ホスト視点でのIN/OUT） */
export enum EndpointDirection {
  In = "IN",
  Out = "OUT",
}

// ========== デバイスの接続状態 ==========
/** USBポートの接続状態を表す列挙型 */
export enum PortStatus {
  Empty = "empty",
  Powered = "powered",
  Connected = "connected",
  Enabled = "enabled",
  Suspended = "suspended",
}

// ========== USBエンドポイント ==========
/** USBエンドポイントの定義（デバイスとの通信チャネルを表す） */
export interface UsbEndpoint {
  address: number;           // エンドポイント番号 (1-15)
  direction: EndpointDirection;
  transferType: TransferType;
  maxPacketSize: number;     // 最大パケットサイズ (バイト)
  interval: number;          // ポーリング間隔 (ms、Interruptのみ)
}

// ========== USBインターフェース ==========
/** USBインターフェースの定義（デバイスの論理的な機能単位を表す） */
export interface UsbInterface {
  interfaceNumber: number;
  classCode: UsbClass;
  subClass: number;
  protocol: number;
  endpoints: UsbEndpoint[];
  description: string;
}

// ========== USBコンフィグレーション ==========
/** USBコンフィグレーションの定義（デバイスの動作モードと電力設定を表す） */
export interface UsbConfiguration {
  configValue: number;
  maxPower: number;       // mA単位
  selfPowered: boolean;
  interfaces: UsbInterface[];
  description: string;
}

// ========== USBデバイスディスクリプタ ==========
/** USBデバイスディスクリプタの定義（デバイスの識別情報と能力を記述する） */
export interface UsbDeviceDescriptor {
  usbVersion: string;        // "2.0", "3.0" など
  deviceClass: UsbClass;
  deviceSubClass: number;
  deviceProtocol: number;
  maxPacketSize0: number;     // EP0の最大パケットサイズ
  vendorId: number;           // ベンダーID
  productId: number;          // プロダクトID
  deviceVersion: string;
  manufacturer: string;
  product: string;
  serialNumber: string;
  configurations: UsbConfiguration[];
}

// ========== USBデバイス (物理デバイス) ==========
/** USBデバイスの状態モデル（物理デバイスの接続状態とデータを保持する） */
export interface UsbDevice {
  descriptor: UsbDeviceDescriptor;
  speed: UsbSpeed;
  /** エニュメレーション後に割り当てられるアドレス (0=未割当) */
  address: number;
  /** 現在選択中のコンフィグレーション (0=未設定) */
  activeConfig: number;
  /** デバイス内部のデータバッファ (マスストレージ用など) */
  dataBuffer: Uint8Array;
}

// ========== USBポート (ハブ上の1ポート) ==========
/** USBポートの状態モデル（ハブ上の物理ポート1つに対応する） */
export interface UsbPort {
  portNumber: number;
  status: PortStatus;
  speed: UsbSpeed | null;
  device: UsbDevice | null;
}

// ========== USBハブ ==========
/** USBハブの状態モデル（複数ポートを持つ中継デバイスを表す） */
export interface UsbHub {
  ports: UsbPort[];
  tier: number;   // 階層 (ルートハブ=1)
  powered: boolean;
}

// ========== USBホストコントローラ (xHCI) ==========
/** USBホストコントローラの状態モデル（xHCI互換、ルートハブとアドレス管理を担う） */
export interface UsbHostController {
  name: string;
  vendorId: number;
  maxPorts: number;
  rootHub: UsbHub;
  /** 次に割り当てるデバイスアドレス */
  nextAddress: number;
  /** アドレス→デバイスのマッピング */
  addressTable: Map<number, UsbDevice>;
}

// ========== USBバス上のパケット ==========
/** USBバス上で送受信されるパケットの構造（PID・アドレス・エンドポイント・データを含む） */
export interface UsbPacket {
  pid: "SETUP" | "DATA0" | "DATA1" | "ACK" | "NAK" | "STALL" | "IN" | "OUT";
  address: number;
  endpoint: number;
  data?: Uint8Array;
}

// ========== ファクトリ関数 ==========

/**
 * USBキーボードデバイスを生成する
 *
 * Logitech K120互換のLow Speedキーボードを作成する。
 * HIDクラス・ブートプロトコル対応で、Interruptエンドポイント1つを持つ。
 * @returns 初期化済みのUSBキーボードデバイス
 */
export function createKeyboard(): UsbDevice {
  return {
    descriptor: {
      usbVersion: "2.0",
      deviceClass: UsbClass.HID,
      deviceSubClass: 1,   // ブートインターフェース
      deviceProtocol: 1,   // キーボード
      maxPacketSize0: 8,
      vendorId: 0x046d,    // Logitech
      productId: 0xc31c,
      deviceVersion: "1.00",
      manufacturer: "Logitech",
      product: "USB Keyboard K120",
      serialNumber: "KB-2026-001",
      configurations: [{
        configValue: 1,
        maxPower: 100,
        selfPowered: false,
        description: "デフォルト構成",
        interfaces: [{
          interfaceNumber: 0,
          classCode: UsbClass.HID,
          subClass: 1,
          protocol: 1,
          description: "ブートキーボード",
          endpoints: [{
            address: 1,
            direction: EndpointDirection.In,
            transferType: TransferType.Interrupt,
            maxPacketSize: 8,
            interval: 10,
          }],
        }],
      }],
    },
    speed: UsbSpeed.Low,
    address: 0,
    activeConfig: 0,
    dataBuffer: new Uint8Array(0),
  };
}

/**
 * USBマウスデバイスを生成する
 *
 * Logitech M100互換のLow Speedマウスを作成する。
 * HIDクラス・ブートプロトコル対応で、Interruptエンドポイント1つを持つ。
 * @returns 初期化済みのUSBマウスデバイス
 */
export function createMouse(): UsbDevice {
  return {
    descriptor: {
      usbVersion: "2.0",
      deviceClass: UsbClass.HID,
      deviceSubClass: 1,
      deviceProtocol: 2,   // マウス
      maxPacketSize0: 8,
      vendorId: 0x046d,    // Logitech
      productId: 0xc077,
      deviceVersion: "1.00",
      manufacturer: "Logitech",
      product: "USB Optical Mouse M100",
      serialNumber: "MS-2026-002",
      configurations: [{
        configValue: 1,
        maxPower: 100,
        selfPowered: false,
        description: "デフォルト構成",
        interfaces: [{
          interfaceNumber: 0,
          classCode: UsbClass.HID,
          subClass: 1,
          protocol: 2,
          description: "ブートマウス",
          endpoints: [{
            address: 1,
            direction: EndpointDirection.In,
            transferType: TransferType.Interrupt,
            maxPacketSize: 4,
            interval: 10,
          }],
        }],
      }],
    },
    speed: UsbSpeed.Low,
    address: 0,
    activeConfig: 0,
    dataBuffer: new Uint8Array(0),
  };
}

/**
 * USBマスストレージ（フラッシュドライブ）を生成する
 *
 * SanDisk Cruzer Blade互換のHigh Speedフラッシュドライブを作成する。
 * SCSI / Bulk-Only Transportプロトコルに対応し、BulkのIN/OUTエンドポイントを持つ。
 * 内部にFAT12ブートセクタ風のシミュレーションデータを保持する。
 * @param sizeMB - ストレージ容量（MB単位、デフォルト16MB）
 * @returns 初期化済みのUSBフラッシュドライブデバイス
 */
export function createFlashDrive(sizeMB: number = 16): UsbDevice {
  // ストレージデータをシミュレート (FAT12ブートセクタ風)
  const data = new Uint8Array(512);
  // ブートセクタシグネチャ
  data[0] = 0xeb; data[1] = 0x3c; data[2] = 0x90;
  // OEM名
  const oem = "USBSIM  ";
  for (let i = 0; i < 8; i++) data[3 + i] = oem.charCodeAt(i);
  // セクタサイズ (512)
  data[11] = 0x00; data[12] = 0x02;
  // シグネチャ
  data[510] = 0x55; data[511] = 0xaa;

  return {
    descriptor: {
      usbVersion: "2.0",
      deviceClass: UsbClass.MassStorage,
      deviceSubClass: 6,   // SCSI
      deviceProtocol: 0x50, // Bulk-Only Transport
      maxPacketSize0: 64,
      vendorId: 0x0781,    // SanDisk
      productId: 0x5567,
      deviceVersion: "1.00",
      manufacturer: "SanDisk",
      product: `Cruzer Blade ${sizeMB}MB`,
      serialNumber: "SD-2026-003",
      configurations: [{
        configValue: 1,
        maxPower: 200,
        selfPowered: false,
        description: "デフォルト構成",
        interfaces: [{
          interfaceNumber: 0,
          classCode: UsbClass.MassStorage,
          subClass: 6,
          protocol: 0x50,
          description: "マスストレージ Bulk-Only",
          endpoints: [
            {
              address: 1,
              direction: EndpointDirection.In,
              transferType: TransferType.Bulk,
              maxPacketSize: 512,
              interval: 0,
            },
            {
              address: 2,
              direction: EndpointDirection.Out,
              transferType: TransferType.Bulk,
              maxPacketSize: 512,
              interval: 0,
            },
          ],
        }],
      }],
    },
    speed: UsbSpeed.High,
    address: 0,
    activeConfig: 0,
    dataBuffer: data,
  };
}

/**
 * USBオーディオデバイスを生成する
 *
 * Focusrite Scarlett Solo互換のHigh Speedオーディオインターフェースを作成する。
 * AudioControl、再生用AudioStreaming（Isochronous OUT）、録音用AudioStreaming（Isochronous IN）
 * の3つのインターフェースを持つ。
 * @returns 初期化済みのUSBオーディオデバイス
 */
export function createAudioDevice(): UsbDevice {
  return {
    descriptor: {
      usbVersion: "2.0",
      deviceClass: UsbClass.Audio,
      deviceSubClass: 1,
      deviceProtocol: 0,
      maxPacketSize0: 64,
      vendorId: 0x1235,    // Focusrite
      productId: 0x8210,
      deviceVersion: "2.00",
      manufacturer: "Focusrite",
      product: "Scarlett Solo USB",
      serialNumber: "AU-2026-004",
      configurations: [{
        configValue: 1,
        maxPower: 500,
        selfPowered: false,
        description: "デフォルト構成",
        interfaces: [
          {
            interfaceNumber: 0,
            classCode: UsbClass.Audio,
            subClass: 1,     // AudioControl
            protocol: 0,
            description: "オーディオコントロール",
            endpoints: [],
          },
          {
            interfaceNumber: 1,
            classCode: UsbClass.Audio,
            subClass: 2,     // AudioStreaming
            protocol: 0,
            description: "オーディオストリーミング (再生)",
            endpoints: [{
              address: 1,
              direction: EndpointDirection.Out,
              transferType: TransferType.Isochronous,
              maxPacketSize: 192,
              interval: 1,
            }],
          },
          {
            interfaceNumber: 2,
            classCode: UsbClass.Audio,
            subClass: 2,
            protocol: 0,
            description: "オーディオストリーミング (録音)",
            endpoints: [{
              address: 2,
              direction: EndpointDirection.In,
              transferType: TransferType.Isochronous,
              maxPacketSize: 192,
              interval: 1,
            }],
          },
        ],
      }],
    },
    speed: UsbSpeed.High,
    address: 0,
    activeConfig: 0,
    dataBuffer: new Uint8Array(0),
  };
}

/**
 * USBホストコントローラを生成する（4ポートルートハブ付き）
 *
 * Intel製xHCI互換のホストコントローラを作成する。
 * 4つのポートを持つルートハブが初期化され、すべてPowered状態になる。
 * @returns 初期化済みのUSBホストコントローラ
 */
export function createHostController(): UsbHostController {
  const ports: UsbPort[] = [];
  for (let i = 1; i <= 4; i++) {
    ports.push({
      portNumber: i,
      status: PortStatus.Powered,
      speed: null,
      device: null,
    });
  }
  return {
    name: "xHCI Host Controller",
    vendorId: 0x8086,   // Intel
    maxPorts: 4,
    rootHub: {
      ports,
      tier: 1,
      powered: true,
    },
    nextAddress: 1,
    addressTable: new Map(),
  };
}

/**
 * デフォルト構成のホストコントローラを生成する
 *
 * キーボード（ポート1）、マウス（ポート2）、フラッシュドライブ（ポート3）を
 * 接続した状態のホストコントローラを返す。ポート4は空。
 * @returns デバイス接続済みのUSBホストコントローラ
 */
export function createDefaultSetup(): UsbHostController {
  const hc = createHostController();
  connectDevice(hc, 1, createKeyboard());
  connectDevice(hc, 2, createMouse());
  connectDevice(hc, 3, createFlashDrive());
  return hc;
}

/**
 * ホットプラグ: デバイスをポートに接続する
 *
 * 指定ポートにデバイスを接続し、ポート状態をConnectedに変更する。
 * 既にデバイスが接続されているポートには接続できない。
 * @param hc - ホストコントローラ
 * @param portNumber - 接続先のポート番号
 * @param device - 接続するUSBデバイス
 * @returns 接続成功時true、ポートが使用中またはポートが存在しない場合false
 */
export function connectDevice(hc: UsbHostController, portNumber: number, device: UsbDevice): boolean {
  const port = hc.rootHub.ports.find(p => p.portNumber === portNumber);
  if (!port || port.device !== null) return false;
  port.device = device;
  port.status = PortStatus.Connected;
  port.speed = device.speed;
  return true;
}

/**
 * デバイスをポートから切断する
 *
 * 指定ポートのデバイスを切断し、アドレステーブルからも削除する。
 * ポートはPowered状態にリセットされ、再接続可能になる。
 * @param hc - ホストコントローラ
 * @param portNumber - 切断するポート番号
 * @returns 切断されたデバイス、またはデバイスが存在しない場合null
 */
export function disconnectDevice(hc: UsbHostController, portNumber: number): UsbDevice | null {
  const port = hc.rootHub.ports.find(p => p.portNumber === portNumber);
  if (!port || !port.device) return null;
  const device = port.device;
  // アドレステーブルから削除
  if (device.address > 0) {
    hc.addressTable.delete(device.address);
  }
  device.address = 0;
  device.activeConfig = 0;
  port.device = null;
  port.status = PortStatus.Powered;
  port.speed = null;
  return device;
}
