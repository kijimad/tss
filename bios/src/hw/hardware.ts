/**
 * hardware.ts -- コンピュータのハードウェアをエミュレート
 *
 * 電源 ON から BIOS が検出する全デバイスを定義する。
 *
 *   マザーボード
 *   ├── CPU (Intel/AMD)
 *   ├── RAM (DIMM スロット)
 *   ├── チップセット (ノースブリッジ + サウスブリッジ)
 *   ├── BIOS ROM (フラッシュメモリ)
 *   ├── CMOS + バッテリー (設定保存)
 *   ├── PCI バス
 *   │     ├── GPU (ビデオカード)
 *   │     ├── NIC (ネットワークカード)
 *   │     └── SATA コントローラ
 *   ├── ストレージ
 *   │     ├── HDD/SSD (SATA)
 *   │     └── NVMe SSD (PCIe)
 *   ├── USB コントローラ
 *   │     ├── キーボード
 *   │     └── マウス
 *   └── スーパーI/O
 *         ├── シリアルポート
 *         └── PS/2 コントローラ
 */

// デバイスの状態
export const DeviceStatus = {
  NotDetected: "not_detected",
  Detecting: "detecting",
  OK: "ok",
  Failed: "failed",
  Disabled: "disabled",
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

// CPU
export interface CpuInfo {
  vendor: string;       // "GenuineIntel" | "AuthenticAMD"
  model: string;        // "Intel Core i7-13700K"
  cores: number;
  threads: number;
  clockMhz: number;     // ベースクロック
  cacheL1: number;      // KB
  cacheL2: number;      // KB
  cacheL3: number;      // KB
  features: string[];   // ["SSE4.2", "AVX2", "AES-NI", ...]
  status: DeviceStatus;
}

// RAM
export interface RamSlot {
  slot: string;         // "DIMM A1", "DIMM B1"
  size: number;         // MB (0=空)
  type: string;         // "DDR4-3200", "DDR5-5600"
  manufacturer: string;
  speed: number;        // MHz
  status: DeviceStatus;
}

// ストレージ
export interface StorageDevice {
  id: number;
  type: "hdd" | "ssd" | "nvme" | "usb" | "cdrom";
  name: string;         // "Samsung 980 PRO 1TB"
  sizeMB: number;
  interface: string;    // "SATA III", "NVMe PCIe 4.0"
  serialNumber: string;
  bootable: boolean;    // MBR/GPT があるか
  mbr: Uint8Array | undefined; // 先頭512バイト
  status: DeviceStatus;
}

// PCI デバイス
export interface PciDevice {
  bus: number;
  device: number;
  function: number;
  vendorId: number;
  deviceId: number;
  className: string;    // "VGA Compatible Controller"
  vendorName: string;   // "NVIDIA"
  deviceName: string;   // "GeForce RTX 4090"
  status: DeviceStatus;
}

// USB デバイス
export interface UsbDevice {
  port: number;
  vendorId: number;
  productId: number;
  name: string;
  type: "keyboard" | "mouse" | "storage" | "hub" | "other";
  status: DeviceStatus;
}

// CMOS 設定 (NVRAM)
export interface CmosSettings {
  bootOrder: string[];        // ["hdd0", "cdrom", "usb", "network"]
  date: string;
  time: string;
  cpuFreqOverride: number;    // 0=auto
  memorySpeed: string;        // "auto" | "3200" | "3600"
  virtualization: boolean;
  secureBootEnabled: boolean;
  fastBoot: boolean;
  legacyBoot: boolean;
  biosPassword: string;       // "" = なし
}

// マザーボード全体
export interface Motherboard {
  manufacturer: string;
  model: string;
  biosVersion: string;
  biosDate: string;
  chipset: string;
  cpu: CpuInfo;
  ram: RamSlot[];
  storage: StorageDevice[];
  pciDevices: PciDevice[];
  usbDevices: UsbDevice[];
  cmos: CmosSettings;
}

// デフォルトのハードウェア構成
export function createDefaultHardware(): Motherboard {
  // ブート可能なディスクの MBR
  const mbr = new Uint8Array(512);
  // MBR シグネチャ (0x55AA at offset 510-511)
  mbr[510] = 0x55;
  mbr[511] = 0xAA;
  // ブートコード（簡易）
  const bootMsg = "Loading OS...";
  for (let i = 0; i < bootMsg.length; i++) mbr[i] = bootMsg.charCodeAt(i);

  return {
    manufacturer: "ASUS",
    model: "ROG STRIX Z790-E",
    biosVersion: "1.0.0",
    biosDate: "2024/01/15",
    chipset: "Intel Z790",

    cpu: {
      vendor: "GenuineIntel",
      model: "Intel Core i7-13700K",
      cores: 16, threads: 24,
      clockMhz: 3400,
      cacheL1: 80, cacheL2: 2048, cacheL3: 30720,
      features: ["SSE4.2", "AVX2", "AES-NI", "VT-x", "VT-d", "Hyper-Threading"],
      status: DeviceStatus.NotDetected,
    },

    ram: [
      { slot: "DIMM A1", size: 16384, type: "DDR5-5600", manufacturer: "G.Skill", speed: 5600, status: DeviceStatus.NotDetected },
      { slot: "DIMM A2", size: 0, type: "", manufacturer: "", speed: 0, status: DeviceStatus.NotDetected },
      { slot: "DIMM B1", size: 16384, type: "DDR5-5600", manufacturer: "G.Skill", speed: 5600, status: DeviceStatus.NotDetected },
      { slot: "DIMM B2", size: 0, type: "", manufacturer: "", speed: 0, status: DeviceStatus.NotDetected },
    ],

    storage: [
      { id: 0, type: "nvme", name: "Samsung 980 PRO 1TB", sizeMB: 953869, interface: "NVMe PCIe 4.0 x4", serialNumber: "S6B0NX0T123456", bootable: true, mbr, status: DeviceStatus.NotDetected },
      { id: 1, type: "ssd", name: "Crucial MX500 2TB", sizeMB: 1907729, interface: "SATA III 6Gb/s", serialNumber: "CT2000MX500SSD1", bootable: false, mbr: undefined, status: DeviceStatus.NotDetected },
      { id: 2, type: "cdrom", name: "ASUS DRW-24D5MT", sizeMB: 0, interface: "SATA", serialNumber: "", bootable: false, mbr: undefined, status: DeviceStatus.NotDetected },
    ],

    pciDevices: [
      { bus: 0, device: 2, function: 0, vendorId: 0x8086, deviceId: 0x4680, className: "VGA Compatible Controller", vendorName: "Intel", deviceName: "UHD Graphics 770", status: DeviceStatus.NotDetected },
      { bus: 1, device: 0, function: 0, vendorId: 0x10DE, deviceId: 0x2684, className: "3D Controller", vendorName: "NVIDIA", deviceName: "GeForce RTX 4090", status: DeviceStatus.NotDetected },
      { bus: 3, device: 0, function: 0, vendorId: 0x8086, deviceId: 0x15F3, className: "Ethernet Controller", vendorName: "Intel", deviceName: "I225-V 2.5GbE", status: DeviceStatus.NotDetected },
      { bus: 4, device: 0, function: 0, vendorId: 0x8086, deviceId: 0xA0B0, className: "USB Controller", vendorName: "Intel", deviceName: "USB 3.2 xHCI", status: DeviceStatus.NotDetected },
      { bus: 0, device: 31, function: 0, vendorId: 0x8086, deviceId: 0x7A04, className: "ISA Bridge", vendorName: "Intel", deviceName: "Z790 LPC/eSPI", status: DeviceStatus.NotDetected },
      { bus: 0, device: 31, function: 3, vendorId: 0x8086, deviceId: 0x7AD0, className: "Audio Device", vendorName: "Intel", deviceName: "Alder Lake-S HD Audio", status: DeviceStatus.NotDetected },
    ],

    usbDevices: [
      { port: 1, vendorId: 0x046D, productId: 0xC52B, name: "Logitech USB Receiver", type: "keyboard", status: DeviceStatus.NotDetected },
      { port: 2, vendorId: 0x046D, productId: 0xC077, name: "Logitech M105 Mouse", type: "mouse", status: DeviceStatus.NotDetected },
    ],

    cmos: {
      bootOrder: ["nvme0", "ssd1", "cdrom", "usb", "network"],
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString().slice(11, 19),
      cpuFreqOverride: 0,
      memorySpeed: "auto",
      virtualization: true,
      secureBootEnabled: false,
      fastBoot: true,
      legacyBoot: false,
      biosPassword: "",
    },
  };
}

// 故障ハードウェア（テスト用）
export function createFaultyHardware(): Motherboard {
  const hw = createDefaultHardware();
  hw.ram[0] = { slot: "DIMM A1", size: 16384, type: "DDR5-5600", manufacturer: "Faulty", speed: 5600, status: DeviceStatus.NotDetected };
  // RAMスロット0を不良にする
  (hw as { _faultyRam: boolean })._faultyRam = true;
  return hw;
}
