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

/**
 * デバイスの状態を表す定数オブジェクト。
 *
 * POST（Power-On Self-Test）の各フェーズにおいて、
 * ハードウェアデバイスは以下の状態遷移を辿る:
 *
 *   NotDetected → Detecting → OK (正常) / Failed (故障)
 *
 * BIOSは電源投入直後、全デバイスを NotDetected として扱い、
 * 検出・テストを経て最終的な状態を決定する。
 * Disabled はCMOS設定でユーザーが無効化したデバイスに使用される。
 */
export const DeviceStatus = {
  /** 未検出: POST開始前の初期状態 */
  NotDetected: "not_detected",
  /** 検出中: BIOSがデバイスを認識しテスト実行中 */
  Detecting: "detecting",
  /** 正常: テスト合格、使用可能 */
  OK: "ok",
  /** 故障: テスト不合格、使用不可 */
  Failed: "failed",
  /** 無効: CMOS設定により無効化されている */
  Disabled: "disabled",
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

/**
 * CPU情報インターフェース。
 *
 * BIOSはPOSTの最初の段階でCPUのCPUID命令を実行し、
 * ベンダー文字列（例: "GenuineIntel"）やモデル名、
 * 対応する命令セット拡張（SSE、AVX等）を取得する。
 *
 * リアルモード（16ビット）で動作するBIOSにとって、
 * CPUの検出は全てのハードウェア初期化の前提条件となる。
 * CPU自己テストに失敗した場合、POST続行不可能となり
 * ビープコード（例: 5回短音）で通知される。
 */
export interface CpuInfo {
  /** CPUベンダーID文字列（CPUID命令で取得） */
  vendor: string;       // "GenuineIntel" | "AuthenticAMD"
  /** CPUモデル名（ブランド文字列） */
  model: string;        // "Intel Core i7-13700K"
  /** 物理コア数 */
  cores: number;
  /** 論理スレッド数（Hyper-Threading有効時はcoresの倍） */
  threads: number;
  /** ベースクロック周波数（MHz単位） */
  clockMhz: number;
  /** L1キャッシュサイズ（KB）- 命令/データキャッシュ合計 */
  cacheL1: number;
  /** L2キャッシュサイズ（KB）- コアごとの統合キャッシュ */
  cacheL2: number;
  /** L3キャッシュサイズ（KB）- 全コア共有のLLCキャッシュ */
  cacheL3: number;
  /** 対応CPU機能フラグ（CPUID命令で検出） */
  features: string[];   // ["SSE4.2", "AVX2", "AES-NI", ...]
  /** デバイス状態 */
  status: DeviceStatus;
}

/**
 * RAMスロット情報インターフェース。
 *
 * BIOSはSPD（Serial Presence Detect）を通じて各DIMMスロットの
 * メモリモジュール情報を読み取る。SPDはメモリモジュール上の
 * 小さなEEPROMチップに格納されており、I2Cバス経由でアクセスされる。
 *
 * その後、メモリテスト（パターンテスト: 0x00, 0xFF, 0x55, 0xAA）を
 * 実行し、全アドレスへの読み書きが正常に行えるか検証する。
 * メモリ不良はビープコード（長1回+短2回）で通知され、POST失敗となる。
 *
 * デュアルチャネル構成の場合、A1+B1 または A2+B2 の対で
 * 装着することで帯域幅が倍増する。
 */
export interface RamSlot {
  /** スロット名称（例: "DIMM A1"）- マザーボード上の物理位置 */
  slot: string;
  /** メモリサイズ（MB単位）。0の場合はスロットが空 */
  size: number;
  /** メモリ規格（例: "DDR5-5600"）- SPDから取得 */
  type: string;
  /** メモリモジュール製造元 */
  manufacturer: string;
  /** 動作クロック速度（MHz単位） */
  speed: number;
  /** デバイス状態 */
  status: DeviceStatus;
}

/**
 * ストレージデバイス情報インターフェース。
 *
 * BIOSはINT 13h（ディスクサービス割り込み）を通じて
 * ストレージデバイスへアクセスする。POST完了後のブートシーケンスでは、
 * CMOS設定のブート順序に従い、各デバイスの先頭セクタ（512バイト）を
 * 読み込み、MBR（Master Boot Record）シグネチャ（0x55AA）の有無を確認する。
 *
 * MBRの構造（512バイト）:
 *   - オフセット 0x000〜0x1BD: ブートストラップコード（446バイト）
 *   - オフセット 0x1BE〜0x1FD: パーティションテーブル（4エントリ×16バイト）
 *   - オフセット 0x1FE〜0x1FF: ブートシグネチャ（0x55, 0xAA）
 *
 * 有効なMBRが見つかると、BIOSはその512バイトを物理アドレス
 * 0x0000:7C00にロードし、そこにジャンプしてブートローダーに制御を渡す。
 */
export interface StorageDevice {
  /** デバイス識別番号 */
  id: number;
  /** デバイス種別: HDD（磁気ディスク）、SSD（SATA接続フラッシュ）、NVMe（PCIe接続フラッシュ）、USB、CD-ROM */
  type: "hdd" | "ssd" | "nvme" | "usb" | "cdrom";
  /** デバイス名称（メーカー・型番） */
  name: string;
  /** 容量（MB単位） */
  sizeMB: number;
  /** 接続インターフェース規格 */
  interface: string;    // "SATA III", "NVMe PCIe 4.0"
  /** シリアル番号（デバイス固有識別子） */
  serialNumber: string;
  /** ブート可能フラグ: MBRまたはGPTが存在するか */
  bootable: boolean;
  /** MBRデータ（先頭512バイト）。ブート不可の場合はundefined */
  mbr: Uint8Array | undefined;
  /** デバイス状態 */
  status: DeviceStatus;
}

/**
 * PCIデバイス情報インターフェース。
 *
 * BIOSはPOST中にPCI（Peripheral Component Interconnect）バスを
 * スキャンし、接続されている全デバイスを列挙する。
 * 各デバイスはバス番号:デバイス番号:ファンクション番号（BDF）で
 * 一意に識別される。
 *
 * PCIコンフィギュレーション空間（256バイト）の先頭にある
 * ベンダーID（2バイト）とデバイスID（2バイト）で
 * デバイスの種類を特定する。ベンダーID 0xFFFFは
 * デバイスが存在しないことを意味する。
 *
 * BIOSはPCIデバイスにI/Oポートアドレスやメモリマップドアドレスを
 * 割り当て、割り込み線（IRQ）を設定する。
 */
export interface PciDevice {
  /** PCIバス番号（0〜255） */
  bus: number;
  /** デバイス番号（0〜31）- バス上の物理スロット位置 */
  device: number;
  /** ファンクション番号（0〜7）- マルチファンクションデバイス用 */
  function: number;
  /** ベンダーID（16ビット）- PCI-SIG管理のメーカー識別子（例: 0x8086=Intel, 0x10DE=NVIDIA） */
  vendorId: number;
  /** デバイスID（16ビット）- ベンダー固有の製品識別子 */
  deviceId: number;
  /** PCIクラス名（デバイスの機能カテゴリ） */
  className: string;    // "VGA Compatible Controller"
  /** ベンダー名称（人間可読） */
  vendorName: string;   // "NVIDIA"
  /** デバイス名称（人間可読） */
  deviceName: string;   // "GeForce RTX 4090"
  /** デバイス状態 */
  status: DeviceStatus;
}

/**
 * USBデバイス情報インターフェース。
 *
 * BIOSはUSBコントローラ（xHCI/EHCI/OHCI）を初期化した後、
 * 接続されているUSBデバイスを列挙する。
 * キーボードやマウスについてはUSBレガシーサポートにより、
 * INT 16h（キーボード）やINT 33h（マウス）経由で
 * リアルモードからもアクセス可能にする。
 *
 * USBブートが有効な場合、USBストレージデバイスも
 * ブートデバイス候補として扱われる。
 */
export interface UsbDevice {
  /** USBポート番号 */
  port: number;
  /** USBベンダーID（例: 0x046D=Logitech） */
  vendorId: number;
  /** USB製品ID */
  productId: number;
  /** デバイス名称 */
  name: string;
  /** デバイス種別 */
  type: "keyboard" | "mouse" | "storage" | "hub" | "other";
  /** デバイス状態 */
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
