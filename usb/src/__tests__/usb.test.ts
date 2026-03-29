import { describe, it, expect } from "vitest";
import {
  createHostController,
  createKeyboard,
  createMouse,
  createFlashDrive,
  createAudioDevice,
  createDefaultSetup,
  connectDevice,
  disconnectDevice,
  UsbClass,
  UsbSpeed,
  PortStatus,
  TransferType,
  EndpointDirection,
} from "../hw/hardware.js";
import { UsbCore } from "../usb/driver.js";

describe("USBハードウェア", () => {
  it("ホストコントローラが4ポートで生成される", () => {
    const hc = createHostController();
    expect(hc.rootHub.ports).toHaveLength(4);
    expect(hc.name).toBe("xHCI Host Controller");
    expect(hc.vendorId).toBe(0x8086);
    expect(hc.nextAddress).toBe(1);
    for (const port of hc.rootHub.ports) {
      expect(port.status).toBe(PortStatus.Powered);
      expect(port.device).toBeNull();
    }
  });

  it("キーボードデバイスが正しく生成される", () => {
    const kb = createKeyboard();
    expect(kb.descriptor.deviceClass).toBe(UsbClass.HID);
    expect(kb.descriptor.deviceProtocol).toBe(1); // キーボード
    expect(kb.descriptor.vendorId).toBe(0x046d);
    expect(kb.descriptor.manufacturer).toBe("Logitech");
    expect(kb.speed).toBe(UsbSpeed.Low);
    expect(kb.address).toBe(0);
    // Interruptエンドポイントを持つ
    const ep = kb.descriptor.configurations[0]?.interfaces[0]?.endpoints[0];
    expect(ep?.transferType).toBe(TransferType.Interrupt);
    expect(ep?.direction).toBe(EndpointDirection.In);
  });

  it("マウスデバイスが正しく生成される", () => {
    const ms = createMouse();
    expect(ms.descriptor.deviceProtocol).toBe(2); // マウス
    expect(ms.descriptor.product).toContain("Mouse");
    expect(ms.speed).toBe(UsbSpeed.Low);
  });

  it("フラッシュドライブのブートセクタシグネチャが正しい", () => {
    const fd = createFlashDrive();
    expect(fd.descriptor.deviceClass).toBe(UsbClass.MassStorage);
    expect(fd.speed).toBe(UsbSpeed.High);
    // MBR風シグネチャ
    expect(fd.dataBuffer[510]).toBe(0x55);
    expect(fd.dataBuffer[511]).toBe(0xaa);
    // ジャンプ命令
    expect(fd.dataBuffer[0]).toBe(0xeb);
    // Bulkエンドポイント (IN + OUT)
    const eps = fd.descriptor.configurations[0]?.interfaces[0]?.endpoints ?? [];
    expect(eps).toHaveLength(2);
    expect(eps.some(e => e.direction === EndpointDirection.In)).toBe(true);
    expect(eps.some(e => e.direction === EndpointDirection.Out)).toBe(true);
  });

  it("オーディオデバイスが複数インターフェースを持つ", () => {
    const audio = createAudioDevice();
    expect(audio.descriptor.deviceClass).toBe(UsbClass.Audio);
    const ifaces = audio.descriptor.configurations[0]?.interfaces ?? [];
    expect(ifaces.length).toBeGreaterThanOrEqual(3);
    // Isochronousエンドポイントを持つ
    const isoEp = ifaces.flatMap(i => i.endpoints).find(
      e => e.transferType === TransferType.Isochronous
    );
    expect(isoEp).toBeDefined();
  });

  it("デバイスの接続と切断が正しく動作する", () => {
    const hc = createHostController();
    const kb = createKeyboard();

    // 接続
    expect(connectDevice(hc, 1, kb)).toBe(true);
    expect(hc.rootHub.ports[0]?.status).toBe(PortStatus.Connected);
    expect(hc.rootHub.ports[0]?.device).toBe(kb);

    // 同じポートに二重接続は失敗
    expect(connectDevice(hc, 1, createMouse())).toBe(false);

    // 切断
    const removed = disconnectDevice(hc, 1);
    expect(removed).toBe(kb);
    expect(hc.rootHub.ports[0]?.status).toBe(PortStatus.Powered);
    expect(hc.rootHub.ports[0]?.device).toBeNull();
  });

  it("デフォルトセットアップが3デバイスを接続する", () => {
    const hc = createDefaultSetup();
    const connected = hc.rootHub.ports.filter(p => p.device !== null);
    expect(connected).toHaveLength(3);
  });
});

describe("USBドライバスタック", () => {
  it("全ポートスキャンとエニュメレーションが成功する", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    const events = await core.scanAndEnumerate();

    // バスリセットイベントが存在する
    expect(events.some(e => e.type === "reset")).toBe(true);

    // 4ポートすべてスキャンされる
    const portScans = events.filter(e => e.type === "port_scan");
    expect(portScans).toHaveLength(4);

    // 3デバイス検出
    const detects = events.filter(e => e.type === "device_detect");
    expect(detects).toHaveLength(3);

    // 3デバイスにアドレスが割り当てられる
    const assigns = events.filter(e => e.type === "address_assign");
    expect(assigns).toHaveLength(3);

    // アドレスが連番 (1, 2, 3)
    expect(assigns.map(e => e.address)).toEqual([1, 2, 3]);
  });

  it("エニュメレーション後にアドレステーブルが正しい", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    expect(hc.addressTable.size).toBe(3);
    // addr=1 はキーボード
    expect(hc.addressTable.get(1)?.descriptor.deviceProtocol).toBe(1);
    // addr=2 はマウス
    expect(hc.addressTable.get(2)?.descriptor.deviceProtocol).toBe(2);
    // addr=3 はマスストレージ
    expect(hc.addressTable.get(3)?.descriptor.deviceClass).toBe(UsbClass.MassStorage);
  });

  it("コントロール転送パケット (SETUP/DATA/ACK) が生成される", async () => {
    const hc = createHostController();
    connectDevice(hc, 1, createKeyboard());
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    const packets = core.getEvents().filter(e => e.type === "packet");
    // SETUPパケット (GET_DESCRIPTOR×2 + SET_ADDRESS + SET_CONFIGURATION = 4)
    const setups = packets.filter(e => e.packet?.pid === "SETUP");
    expect(setups.length).toBeGreaterThanOrEqual(4);
    // ACKパケットが存在
    const acks = packets.filter(e => e.packet?.pid === "ACK");
    expect(acks.length).toBeGreaterThanOrEqual(3);
    // DATAパケットが存在
    const datas = packets.filter(e => e.packet?.pid === "DATA0" || e.packet?.pid === "DATA1");
    expect(datas.length).toBeGreaterThanOrEqual(2);
  });

  it("ドライバがバインドされる", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    const binds = core.getEvents().filter(e => e.type === "driver_bind");
    expect(binds).toHaveLength(3);

    // HIDドライバ (キーボード)
    expect(binds[0]?.data?.["driver"]).toBe("usbhid");
    expect(binds[0]?.detail).toContain("キーボード");

    // HIDドライバ (マウス)
    expect(binds[1]?.data?.["driver"]).toBe("usbhid");
    expect(binds[1]?.detail).toContain("マウス");

    // マスストレージドライバ
    expect(binds[2]?.data?.["driver"]).toBe("usb-storage");
  });

  it("コンフィグレーションが設定される", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    const configs = core.getEvents().filter(e => e.type === "config_set");
    expect(configs).toHaveLength(3);

    // 全デバイスの activeConfig が 1 に設定される
    for (const [, dev] of hc.addressTable) {
      expect(dev.activeConfig).toBe(1);
    }
  });

  it("ディスクリプタ取得で VID/PID が正しい", async () => {
    const hc = createHostController();
    connectDevice(hc, 1, createKeyboard());
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    const descs = core.getEvents().filter(
      e => e.type === "descriptor_get" && e.data?.["vendorId"]
    );
    expect(descs).toHaveLength(1);
    expect(descs[0]?.data?.["vendorId"]).toBe("0x046d");
    expect(descs[0]?.data?.["productId"]).toBe("0xc31c");
  });

  it("Bulk転送がパケット分割される", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    // フラッシュドライブのOUTエンドポイント
    const fd = hc.addressTable.get(3)!;
    const ep = fd.descriptor.configurations[0]!.interfaces[0]!.endpoints.find(
      e => e.direction === EndpointDirection.Out
    )!;

    // 1024バイト送信 (maxPacketSize=512 → 2パケット)
    const data = new Uint8Array(1024);
    const result = await core.bulkTransfer(3, ep, data);
    expect(result).toBe(true);

    const transfers = core.getEvents().filter(e => e.type === "transfer");
    // 開始と完了の転送イベント
    expect(transfers.some(e => e.detail.includes("1024B"))).toBe(true);
    expect(transfers.some(e => e.detail.includes("2 パケット"))).toBe(true);
  });

  it("Interrupt転送が動作する", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    // キーボードのINエンドポイント
    const kb = hc.addressTable.get(1)!;
    const ep = kb.descriptor.configurations[0]!.interfaces[0]!.endpoints[0]!;

    // キー押下データ (8バイトHIDレポート)
    const keyData = new Uint8Array([0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]); // 'a'キー
    const result = await core.interruptTransfer(1, ep, keyData);
    expect(result).toBe(true);

    const xfers = core.getEvents().filter(e => e.type === "transfer");
    expect(xfers.some(e => e.detail.includes("Interrupt"))).toBe(true);
  });

  it("ホットプラグが動作する", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    // ポート4にオーディオデバイスを接続
    connectDevice(hc, 4, createAudioDevice());
    const hotplugEvents = await core.hotplugEnumerate(4);

    // ホットプラグでデバイス検出される
    expect(hotplugEvents.some(e => e.type === "device_detect")).toBe(true);
    // アドレスが割り当てられる (4番目)
    expect(hc.addressTable.get(4)?.descriptor.deviceClass).toBe(UsbClass.Audio);
    // ドライバがバインドされる
    expect(hotplugEvents.some(
      e => e.type === "driver_bind" && e.data?.["driver"] === "snd-usb-audio"
    )).toBe(true);
  });

  it("デバイス切断でアドレステーブルから削除される", async () => {
    const hc = createDefaultSetup();
    const core = new UsbCore(hc, 0);
    await core.scanAndEnumerate();

    expect(hc.addressTable.size).toBe(3);

    // ポート3 (フラッシュドライブ) を切断
    const discEvents = await core.handleDisconnect(3);
    expect(discEvents.some(e => e.type === "disconnect")).toBe(true);
    expect(hc.addressTable.size).toBe(2);
    expect(hc.addressTable.has(3)).toBe(false);

    // ポートが空になっている
    const port3 = hc.rootHub.ports.find(p => p.portNumber === 3)!;
    expect(port3.status).toBe(PortStatus.Powered);
    expect(port3.device).toBeNull();
  });

  it("存在しないアドレスへの転送がエラーになる", async () => {
    const hc = createHostController();
    const core = new UsbCore(hc, 0);

    const ep = {
      address: 1,
      direction: EndpointDirection.Out as const,
      transferType: TransferType.Bulk as const,
      maxPacketSize: 512,
      interval: 0,
    };
    const result = await core.bulkTransfer(99, ep, new Uint8Array(64));
    expect(result).toBe(false);
    expect(core.getEvents().some(e => e.type === "error")).toBe(true);
  });
});
