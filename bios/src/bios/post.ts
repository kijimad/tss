/**
 * post.ts -- BIOS POST (Power-On Self Test) + ブートシーケンス
 *
 * PC の電源 ON からOS起動までの全過程:
 *
 *   1. CPU リセットベクタ (0xFFFF:FFF0) → BIOS ROM にジャンプ
 *   2. POST (Power-On Self Test)
 *      a. CPU テスト
 *      b. BIOS ROM チェックサム検証
 *      c. CMOS/RTC 読み取り
 *      d. DMA コントローラ初期化
 *      e. メモリテスト (RAM サイズ検出 + パターンテスト)
 *      f. 割り込みコントローラ (8259A PIC) 初期化
 *      g. タイマー (8254 PIT) 初期化
 *      h. キーボードコントローラ (8042) テスト
 *   3. ビデオ初期化 (VGA BIOS 実行)
 *   4. PCI バス列挙
 *   5. USB デバイス検出
 *   6. ストレージデバイス検出
 *   7. BIOS セットアップ画面表示 (F2/DEL で入る)
 *   8. ブートデバイス選択
 *   9. MBR (先頭512バイト) 読み込み + 検証 (0x55AA)
 *  10. ブートローダーにジャンプ → OS 起動
 */
import {
  type Motherboard, type StorageDevice,
  DeviceStatus,
} from "../hw/hardware.js";

// POST イベント
export type PostEvent =
  | { type: "phase"; phase: string; description: string }
  | { type: "test"; component: string; result: "ok" | "fail" | "skip"; detail: string }
  | { type: "detect"; category: string; device: string; detail: string }
  | { type: "memory_test"; tested: number; total: number; pattern: string }
  | { type: "pci_enum"; bus: number; device: number; vendor: string; name: string }
  | { type: "boot_select"; device: string; reason: string }
  | { type: "mbr_read"; device: string; signature: string; valid: boolean }
  | { type: "boot_jump"; address: string; message: string }
  | { type: "beep"; count: number; pattern: string; meaning: string }
  | { type: "error"; code: string; message: string }
  | { type: "log"; message: string; level: "info" | "warn" | "error" };

// POST 結果
export interface PostResult {
  success: boolean;
  events: PostEvent[];
  totalMemoryMB: number;
  bootDevice: string | undefined;
  errorCode: string | undefined;
  durationMs: number;
}

export class BiosPost {
  private hw: Motherboard;
  private events: PostEvent[] = [];
  onEvent: ((event: PostEvent) => void) | undefined;
  // 遅延シミュレーション用
  private delayMs: number;

  constructor(hw: Motherboard, delayMs = 0) {
    this.hw = hw;
    this.delayMs = delayMs;
  }

  private emit(event: PostEvent): void { this.events.push(event); this.onEvent?.(event); }

  // POST 実行
  async runPost(): Promise<PostResult> {
    this.events = [];
    const startTime = performance.now();
    let totalMemoryMB = 0;
    let bootDevice: string | undefined;
    let errorCode: string | undefined;

    try {
      // === Phase 1: CPU Reset Vector ===
      this.emit({ type: "phase", phase: "CPU Reset", description: "CPU executes reset vector at 0xFFFF:FFF0 → jumps to BIOS ROM" });
      this.emit({ type: "log", message: `${this.hw.manufacturer} ${this.hw.model} BIOS v${this.hw.biosVersion} (${this.hw.biosDate})`, level: "info" });
      await this.delay();

      // === Phase 2: POST ===
      this.emit({ type: "phase", phase: "POST", description: "Power-On Self Test" });

      // 2a. CPU テスト
      this.emit({ type: "test", component: "CPU", result: "ok", detail: `${this.hw.cpu.model} @ ${String(this.hw.cpu.clockMhz)}MHz (${String(this.hw.cpu.cores)}C/${String(this.hw.cpu.threads)}T)` });
      this.hw.cpu.status = DeviceStatus.OK;
      this.emit({ type: "detect", category: "CPU", device: this.hw.cpu.model, detail: `Features: ${this.hw.cpu.features.join(", ")}` });
      this.emit({ type: "detect", category: "CPU Cache", device: "", detail: `L1: ${String(this.hw.cpu.cacheL1)}KB  L2: ${String(this.hw.cpu.cacheL2)}KB  L3: ${String(this.hw.cpu.cacheL3)}KB` });
      await this.delay();

      // 2b. BIOS ROM チェックサム
      this.emit({ type: "test", component: "BIOS ROM", result: "ok", detail: "Checksum verification passed" });
      await this.delay();

      // 2c. CMOS/RTC
      this.emit({ type: "test", component: "CMOS/RTC", result: "ok", detail: `Date: ${this.hw.cmos.date} Time: ${this.hw.cmos.time}` });
      await this.delay();

      // 2d. DMA コントローラ
      this.emit({ type: "test", component: "DMA Controller", result: "ok", detail: "8237A DMA channels 0-7 initialized" });
      await this.delay();

      // 2e. メモリテスト
      this.emit({ type: "phase", phase: "Memory Test", description: "Detecting and testing RAM" });
      for (const slot of this.hw.ram) {
        if (slot.size === 0) {
          slot.status = DeviceStatus.NotDetected;
          this.emit({ type: "detect", category: "RAM", device: slot.slot, detail: "(empty)" });
          continue;
        }
        slot.status = DeviceStatus.Detecting;
        this.emit({ type: "detect", category: "RAM", device: slot.slot, detail: `${String(slot.size)}MB ${slot.type} ${slot.manufacturer} @ ${String(slot.speed)}MHz` });

        // パターンテスト
        const isFaulty = (this.hw as { _faultyRam?: boolean })._faultyRam && slot.slot === "DIMM A1";
        const patterns = ["0x00", "0xFF", "0x55", "0xAA"];
        for (const pattern of patterns) {
          this.emit({ type: "memory_test", tested: slot.size, total: slot.size, pattern });
          await this.delay();
        }

        if (isFaulty) {
          slot.status = DeviceStatus.Failed;
          this.emit({ type: "test", component: `RAM ${slot.slot}`, result: "fail", detail: "Memory test failed at pattern 0xAA" });
          this.emit({ type: "beep", count: 3, pattern: "long-short-short", meaning: "Memory error" });
          this.emit({ type: "error", code: "0x0D", message: `Memory error in ${slot.slot}` });
          errorCode = "0x0D";
        } else {
          slot.status = DeviceStatus.OK;
          totalMemoryMB += slot.size;
          this.emit({ type: "test", component: `RAM ${slot.slot}`, result: "ok", detail: `${String(slot.size)}MB passed` });
        }
      }
      this.emit({ type: "log", message: `Total RAM: ${String(totalMemoryMB)}MB (${String(totalMemoryMB / 1024)}GB)`, level: "info" });
      await this.delay();

      // 2f. 割り込みコントローラ
      this.emit({ type: "test", component: "8259A PIC", result: "ok", detail: "Programmable Interrupt Controller initialized (IRQ 0-15)" });
      await this.delay();

      // 2g. タイマー
      this.emit({ type: "test", component: "8254 PIT", result: "ok", detail: "Programmable Interval Timer: Channel 0 = 18.2Hz" });
      await this.delay();

      // 2h. キーボード
      this.emit({ type: "test", component: "8042 Keyboard", result: "ok", detail: "PS/2 controller initialized, keyboard detected" });
      this.emit({ type: "beep", count: 1, pattern: "short", meaning: "POST successful" });
      await this.delay();

      // === Phase 3: ビデオ初期化 ===
      this.emit({ type: "phase", phase: "Video Init", description: "Initializing video adapter" });
      const gpu = this.hw.pciDevices.find(d => d.className.includes("VGA") || d.className.includes("3D"));
      if (gpu !== undefined) {
        gpu.status = DeviceStatus.OK;
        this.emit({ type: "detect", category: "GPU", device: `${gpu.vendorName} ${gpu.deviceName}`, detail: `PCI ${String(gpu.bus)}:${String(gpu.device)}.${String(gpu.function)}` });
      }
      await this.delay();

      // === Phase 4: PCI バス列挙 ===
      this.emit({ type: "phase", phase: "PCI Enumeration", description: "Scanning PCI bus for devices" });
      for (const dev of this.hw.pciDevices) {
        dev.status = DeviceStatus.OK;
        this.emit({
          type: "pci_enum",
          bus: dev.bus, device: dev.device,
          vendor: `${dev.vendorName} [${dev.vendorId.toString(16).padStart(4, "0")}:${dev.deviceId.toString(16).padStart(4, "0")}]`,
          name: `${dev.deviceName} (${dev.className})`,
        });
        await this.delay();
      }

      // === Phase 5: USB デバイス検出 ===
      this.emit({ type: "phase", phase: "USB Init", description: "Enumerating USB devices" });
      for (const dev of this.hw.usbDevices) {
        dev.status = DeviceStatus.OK;
        this.emit({ type: "detect", category: "USB", device: dev.name, detail: `Port ${String(dev.port)} [${dev.vendorId.toString(16)}:${dev.productId.toString(16)}] (${dev.type})` });
        await this.delay();
      }

      // === Phase 6: ストレージデバイス検出 ===
      this.emit({ type: "phase", phase: "Storage Init", description: "Detecting storage devices" });
      for (const dev of this.hw.storage) {
        dev.status = DeviceStatus.OK;
        this.emit({ type: "detect", category: "Storage", device: dev.name, detail: `${dev.interface} ${String(Math.round(dev.sizeMB / 1024))}GB S/N: ${dev.serialNumber}` });
        await this.delay();
      }

      // メモリエラーがあればここで停止
      if (errorCode !== undefined) {
        this.emit({ type: "error", code: errorCode, message: "POST failed — system halted" });
        return { success: false, events: this.events, totalMemoryMB, bootDevice: undefined, errorCode, durationMs: performance.now() - startTime };
      }

      // === Phase 7: BIOS セットアップ ===
      this.emit({ type: "log", message: "Press F2 for BIOS Setup, F12 for Boot Menu", level: "info" });
      await this.delay();

      // === Phase 8: ブートデバイス選択 ===
      this.emit({ type: "phase", phase: "Boot Device", description: "Selecting boot device from boot order" });
      for (const bootId of this.hw.cmos.bootOrder) {
        const dev = this.findBootDevice(bootId);
        if (dev === undefined) {
          this.emit({ type: "boot_select", device: bootId, reason: "not found" });
          continue;
        }
        if (!dev.bootable || dev.mbr === undefined) {
          this.emit({ type: "boot_select", device: dev.name, reason: "not bootable" });
          continue;
        }

        // === Phase 9: MBR 読み込み ===
        this.emit({ type: "phase", phase: "MBR Load", description: `Reading MBR from ${dev.name}` });
        const sig = dev.mbr[510] === 0x55 && dev.mbr[511] === 0xAA;
        this.emit({ type: "mbr_read", device: dev.name, signature: sig ? "0x55AA (valid)" : "invalid", valid: sig });

        if (sig) {
          bootDevice = dev.name;
          this.emit({ type: "boot_select", device: dev.name, reason: "valid MBR found" });

          // === Phase 10: ブートローダーにジャンプ ===
          this.emit({ type: "phase", phase: "Boot", description: "Jumping to boot loader" });
          this.emit({ type: "boot_jump", address: "0x0000:7C00", message: "Transferring control to boot loader..." });

          // MBR のブートメッセージを読む
          let bootMsg = "";
          for (let i = 0; i < 64; i++) {
            const b = dev.mbr[i] ?? 0;
            if (b >= 32 && b < 127) bootMsg += String.fromCharCode(b);
            else break;
          }
          if (bootMsg.length > 0) {
            this.emit({ type: "log", message: bootMsg, level: "info" });
          }
          this.emit({ type: "log", message: "Booting from " + dev.name + "...", level: "info" });
          break;
        }
      }

      if (bootDevice === undefined) {
        this.emit({ type: "error", code: "NO_BOOT", message: "No bootable device found. Press any key to retry." });
      }

    } catch (e) {
      errorCode = "FATAL";
      this.emit({ type: "error", code: "FATAL", message: e instanceof Error ? e.message : String(e) });
    }

    return {
      success: errorCode === undefined && bootDevice !== undefined,
      events: this.events,
      totalMemoryMB, bootDevice, errorCode,
      durationMs: performance.now() - startTime,
    };
  }

  private findBootDevice(id: string): StorageDevice | undefined {
    if (id.startsWith("nvme")) return this.hw.storage.find(d => d.type === "nvme");
    if (id.startsWith("ssd") || id.startsWith("hdd")) return this.hw.storage.find(d => d.type === "ssd" || d.type === "hdd");
    if (id === "cdrom") return this.hw.storage.find(d => d.type === "cdrom");
    if (id === "usb") return this.hw.storage.find(d => d.type === "usb");
    return undefined;
  }

  private async delay(): Promise<void> {
    if (this.delayMs > 0) await new Promise(resolve => setTimeout(resolve, this.delayMs));
  }

  getHardware(): Motherboard { return this.hw; }
}
