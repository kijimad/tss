import { describe, it, expect } from "vitest";
import { createDefaultHardware, createFaultyHardware, DeviceStatus } from "../hw/hardware.js";
import { BiosPost } from "../bios/post.js";

describe("ハードウェア", () => {
  it("デフォルト構成が作れる", () => {
    const hw = createDefaultHardware();
    expect(hw.cpu.model).toContain("Intel");
    expect(hw.ram.filter(r => r.size > 0)).toHaveLength(2);
    expect(hw.storage).toHaveLength(3);
    expect(hw.pciDevices.length).toBeGreaterThan(0);
  });

  it("MBR シグネチャが正しい", () => {
    const hw = createDefaultHardware();
    const bootDisk = hw.storage[0];
    expect(bootDisk?.mbr?.[510]).toBe(0x55);
    expect(bootDisk?.mbr?.[511]).toBe(0xAA);
  });
});

describe("BIOS POST", () => {
  it("正常な POST が成功する", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    expect(result.success).toBe(true);
    expect(result.totalMemoryMB).toBe(32768); // 16GB * 2
    expect(result.bootDevice).toBeDefined();
    expect(result.errorCode).toBeUndefined();
  });

  it("CPU が検出される", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    await bios.runPost();
    expect(hw.cpu.status).toBe(DeviceStatus.OK);
  });

  it("RAM が検出・テストされる", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    await bios.runPost();
    expect(hw.ram[0]?.status).toBe(DeviceStatus.OK);
    expect(hw.ram[1]?.status).toBe(DeviceStatus.NotDetected); // 空スロット
  });

  it("PCI デバイスが列挙される", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    const pciEvents = result.events.filter(e => e.type === "pci_enum");
    expect(pciEvents.length).toBe(hw.pciDevices.length);
  });

  it("ストレージが検出される", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    await bios.runPost();
    expect(hw.storage.every(d => d.status === DeviceStatus.OK)).toBe(true);
  });

  it("MBR を読んでブートする", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    const mbrEvents = result.events.filter(e => e.type === "mbr_read");
    expect(mbrEvents.length).toBe(1);
    if (mbrEvents[0]?.type === "mbr_read") expect(mbrEvents[0].valid).toBe(true);
  });

  it("ブートジャンプイベントが記録される", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    const jumpEvents = result.events.filter(e => e.type === "boot_jump");
    expect(jumpEvents.length).toBe(1);
  });

  it("POST ビープが鳴る", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    const beeps = result.events.filter(e => e.type === "beep");
    expect(beeps.length).toBeGreaterThan(0);
    // 正常時は 1 short beep
    const successBeep = beeps.find(e => e.type === "beep" && e.count === 1);
    expect(successBeep).toBeDefined();
  });

  it("メモリ不良で POST が失敗する", async () => {
    const hw = createFaultyHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBeDefined();
    const errorBeeps = result.events.filter(e => e.type === "beep" && e.count === 3);
    expect(errorBeeps.length).toBe(1);
  });

  it("イベントの順序が正しい", async () => {
    const hw = createDefaultHardware();
    const bios = new BiosPost(hw);
    const result = await bios.runPost();
    const phases = result.events.filter(e => e.type === "phase").map(e => e.type === "phase" ? e.phase : "");
    expect(phases[0]).toBe("CPU Reset");
    expect(phases[1]).toBe("POST");
    expect(phases).toContain("Memory Test");
    expect(phases).toContain("PCI Enumeration");
    expect(phases).toContain("Boot");
  });
});
