/**
 * USB ドライバシミュレータ Web UI
 * Node.jsシミュレータと同じパターンのUI:
 *   セレクト + Runボタン / 左: 説明テキストエリア / 右: イベントログ
 */

import {
  createHostController,
  createKeyboard,
  createMouse,
  createFlashDrive,
  createAudioDevice,
  connectDevice,
  type UsbHostController,
  EndpointDirection,
  TransferType,
} from "../hw/hardware.js";
import { UsbCore, type DriverEvent } from "../usb/driver.js";

/** シナリオ定義 */
interface UsbExample {
  name: string;
  description: string;
  run: (ctx: RunContext) => Promise<void>;
}

/** シナリオ実行コンテキスト */
interface RunContext {
  log: (text: string, color?: string) => void;
  delayMs: number;
}

/** イベントをログ文字列と色に変換 */
function formatEvent(ev: DriverEvent): { text: string; color: string } {
  switch (ev.type) {
    case "reset":
      return { text: `[RESET] ${ev.detail}`, color: "#ff8800" };
    case "port_scan": {
      const hasDevice = ev.data?.["hasDevice"];
      return { text: `[SCAN]  ${ev.detail}`, color: hasDevice ? "#00d4ff" : "#555" };
    }
    case "device_detect":
      return { text: `[FOUND] ${ev.detail}`, color: "#10b981" };
    case "speed_detect":
      return { text: `[SPEED] ${ev.detail}`, color: "#5eead4" };
    case "address_assign":
      return { text: `[ADDR]  ${ev.detail}`, color: "#ffcc00" };
    case "descriptor_get":
      return { text: `[DESC]  ${ev.detail}`, color: "#c084fc" };
    case "config_set":
      return { text: `[CONF]  ${ev.detail}`, color: "#38bdf8" };
    case "driver_bind":
      return { text: `[BIND]  ${ev.detail}`, color: "#34d399" };
    case "transfer":
      return { text: `[XFER]  ${ev.detail}`, color: "#60a5fa" };
    case "packet": {
      const p = ev.packet;
      if (p) {
        const dataLen = p.data ? ` [${p.data.length}B]` : "";
        return { text: `  ${p.pid.padEnd(6)} addr=${p.address} ep=${p.endpoint}${dataLen}`, color: "#666" };
      }
      return { text: `[PKT]   ${ev.detail}`, color: "#666" };
    }
    case "disconnect":
      return { text: `[DISC]  ${ev.detail}`, color: "#ff4444" };
    case "error":
      return { text: `[ERROR] ${ev.detail}`, color: "#ff0000" };
    case "log":
      return { text: `[INFO]  ${ev.detail}`, color: "#888" };
  }
}

/** エニュメレーション (3デバイス) を実行するヘルパー */
async function runEnumeration(hc: UsbHostController, ctx: RunContext, onEvent: (ev: DriverEvent) => void): Promise<UsbCore> {
  const core = new UsbCore(hc, ctx.delayMs);
  core.onEvent = onEvent;
  ctx.log("=== USBエニュメレーション開始 ===\n", "#00d4ff");
  await core.scanAndEnumerate();
  ctx.log("\n=== エニュメレーション完了 ===", "#00d4ff");
  return core;
}

/** シナリオ一覧 */
const EXAMPLES: UsbExample[] = [
  {
    name: "エニュメレーション (3デバイス)",
    description: `キーボード・マウス・フラッシュドライブの3台を
ポート1〜3に接続し、USBエニュメレーションを実行します。

処理の流れ:
  1. ホストコントローラ初期化 (xHCI)
  2. バスリセット
  3. 全4ポートのスキャン
  4. 検出されたデバイスごとに:
     - ポートリセット / 速度ネゴシエーション
     - GET_DESCRIPTOR (8B → 18B)
     - SET_ADDRESS
     - SET_CONFIGURATION
     - ドライババインド (usbhid / usb-storage)

デバイス:
  ポート1: Logitech USB Keyboard K120 (Low Speed)
  ポート2: Logitech USB Optical Mouse M100 (Low Speed)
  ポート3: SanDisk Cruzer Blade 16MB (High Speed)
  ポート4: 空`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      await runEnumeration(hc, ctx, (ev) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      });
    },
  },
  {
    name: "ホットプラグ (Audio)",
    description: `3台接続済みの状態でオーディオデバイスを
ポート4にホットプラグ接続します。

処理の流れ:
  1. まず3台 (KB/Mouse/Flash) をエニュメレーション
  2. ポート4に Focusrite Scarlett Solo USB を接続
  3. ホットプラグ検出 → 単体エニュメレーション
  4. snd-usb-audio ドライバがバインドされる

Audioデバイスは3つのインターフェースを持ちます:
  - AudioControl
  - AudioStreaming (再生 / Isochronous OUT)
  - AudioStreaming (録音 / Isochronous IN)`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      const onEvent = (ev: DriverEvent) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      };
      const core = await runEnumeration(hc, ctx, onEvent);
      ctx.log("\n--- ホットプラグ: Audioデバイス → ポート4 ---\n", "#f0c040");
      connectDevice(hc, 4, createAudioDevice());
      const core2 = new UsbCore(hc, ctx.delayMs);
      core2.onEvent = onEvent;
      // coreのイベント履歴は不要なので新しいインスタンスで実行
      void core;
      await core2.hotplugEnumerate(4);
      ctx.log("\n=== ホットプラグ完了 ===", "#f0c040");
    },
  },
  {
    name: "Bulk転送 (1024B)",
    description: `フラッシュドライブに1024バイトのBulk転送を行います。

処理の流れ:
  1. 3台エニュメレーション
  2. フラッシュドライブ (addr=3) のOUTエンドポイントを特定
  3. 1024バイトのテストデータを作成
  4. maxPacketSize=512 で分割送信 → 2パケット
  5. 各パケット: SETUP → DATA0/DATA1 → ACK

USBのBulk転送はトグルビット (DATA0/DATA1) を
交互に使ってパケットの順序を保証します。`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      const onEvent = (ev: DriverEvent) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      };
      const core = await runEnumeration(hc, ctx, onEvent);
      // フラッシュドライブのOUTエンドポイントを取得
      const fd = hc.addressTable.get(3);
      const ep = fd?.descriptor.configurations[0]?.interfaces[0]?.endpoints.find(
        (e) => e.direction === EndpointDirection.Out
      );
      if (!fd || !ep) {
        ctx.log("[ERROR] フラッシュドライブが見つからない", "#ff0000");
        return;
      }
      const testData = new Uint8Array(1024);
      for (let i = 0; i < testData.length; i++) testData[i] = i & 0xff;
      ctx.log(`\n--- Bulk転送: addr=3, ${testData.length}B ---\n`, "#10b981");
      const core2 = new UsbCore(hc, ctx.delayMs);
      core2.onEvent = onEvent;
      void core;
      await core2.bulkTransfer(3, ep, testData);
      ctx.log("\n=== Bulk転送完了 ===", "#10b981");
    },
  },
  {
    name: "デバイス切断 (ポート3)",
    description: `3台接続済みの状態からポート3 (フラッシュドライブ) を
切断します。

処理の流れ:
  1. 3台エニュメレーション
  2. ポート3の切断を実行
     - アドレステーブルから削除
     - ポート状態を Powered にリセット
     - デバイスのアドレスとコンフィグをクリア

切断後、ポート3は再びデバイス接続可能な状態に戻ります。`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      const onEvent = (ev: DriverEvent) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      };
      const core = await runEnumeration(hc, ctx, onEvent);
      ctx.log("\n--- デバイス切断: ポート3 ---\n", "#ff4444");
      const core2 = new UsbCore(hc, ctx.delayMs);
      core2.onEvent = onEvent;
      void core;
      await core2.handleDisconnect(3);
      ctx.log("\n=== 切断処理完了 ===", "#ff4444");
    },
  },
  {
    name: "キーボード入力 (Interrupt転送)",
    description: `キーボードからのInterrupt転送をシミュレートします。

処理の流れ:
  1. 3台エニュメレーション
  2. キーボード (addr=1) のINエンドポイントを特定
  3. HIDレポート (8バイト) を送信
     - バイト0: 修飾キー (0x00 = なし)
     - バイト2: キーコード (0x04 = 'a')
  4. IN → DATA1 → ACK の順でパケット交換

Interrupt転送はポーリング間隔 (interval=10ms) で
ホストが定期的にデバイスに問い合わせる方式です。`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      const onEvent = (ev: DriverEvent) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      };
      const core = await runEnumeration(hc, ctx, onEvent);
      // キーボードのINエンドポイント
      const kb = hc.addressTable.get(1);
      const ep = kb?.descriptor.configurations[0]?.interfaces[0]?.endpoints[0];
      if (!kb || !ep) {
        ctx.log("[ERROR] キーボードが見つからない", "#ff0000");
        return;
      }
      // HIDレポート: 'a'キー押下
      const keyData = new Uint8Array([0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]);
      ctx.log("\n--- Interrupt転送: キーボード 'a'キー押下 ---\n", "#60a5fa");
      const core2 = new UsbCore(hc, ctx.delayMs);
      core2.onEvent = onEvent;
      void core;
      await core2.interruptTransfer(1, ep, keyData);
      ctx.log("\n=== Interrupt転送完了 ===", "#60a5fa");
    },
  },
  {
    name: "単一デバイス (キーボードのみ)",
    description: `ポート1にキーボードだけを接続してエニュメレーションします。

最小構成でのUSBエニュメレーションフローを確認できます。
他のポートはすべて空です。

デバイス:
  ポート1: Logitech USB Keyboard K120 (Low Speed, 1.5 Mbps)
  ポート2: 空
  ポート3: 空
  ポート4: 空`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      await runEnumeration(hc, ctx, (ev) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      });
    },
  },
  {
    name: "全ポート使用",
    description: `4ポートすべてにデバイスを接続してエニュメレーションします。

デバイス:
  ポート1: Logitech USB Keyboard K120 (Low Speed)
  ポート2: Logitech USB Optical Mouse M100 (Low Speed)
  ポート3: SanDisk Cruzer Blade 16MB (High Speed)
  ポート4: Focusrite Scarlett Solo USB (High Speed)

4台すべてが順にエニュメレーションされ、
アドレス1〜4が割り当てられます。`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      connectDevice(hc, 4, createAudioDevice());
      await runEnumeration(hc, ctx, (ev) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      });
    },
  },
  {
    name: "速度ネゴシエーション",
    description: `各デバイスの速度検出 (Speed Negotiation) に注目した
シナリオです。

USBデバイスはD+/D-信号線の電圧レベルで速度が決まります:
  - Low Speed (1.5 Mbps): D- にプルアップ
  - Full Speed (12 Mbps): D+ にプルアップ
  - High Speed (480 Mbps): チャープシーケンス

接続デバイスと速度:
  ポート1: キーボード → 1.5 Mbps (Low Speed)
  ポート2: マウス → 1.5 Mbps (Low Speed)
  ポート3: フラッシュドライブ → 480 Mbps (High Speed)
  ポート4: オーディオ → 480 Mbps (High Speed)`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createKeyboard());
      connectDevice(hc, 2, createMouse());
      connectDevice(hc, 3, createFlashDrive());
      connectDevice(hc, 4, createAudioDevice());
      await runEnumeration(hc, ctx, (ev) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      });
    },
  },
  {
    name: "存在しないアドレスへの転送",
    description: `存在しないデバイスアドレス (addr=99) に対して
Bulk転送を試みるエラーケースです。

ホストコントローラのアドレステーブルに該当デバイスが
ないため、即座にエラーが返されます。

実際のUSBバスでは、デバイスが応答しない場合
NAK/STALLパケットやタイムアウトが発生します。`,
    async run(ctx) {
      const hc = createHostController();
      const core = new UsbCore(hc, ctx.delayMs);
      core.onEvent = (ev) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      };
      ctx.log("=== 存在しないアドレスへの転送テスト ===\n", "#ff8800");
      const ep = {
        address: 1,
        direction: EndpointDirection.Out as const,
        transferType: TransferType.Bulk as const,
        maxPacketSize: 512,
        interval: 0,
      };
      const result = await core.bulkTransfer(99, ep, new Uint8Array(64));
      ctx.log(`\n転送結果: ${result ? "成功" : "失敗"}`, result ? "#10b981" : "#ff4444");
      ctx.log("\n=== テスト完了 ===", "#ff8800");
    },
  },
  {
    name: "接続→転送→切断",
    description: `デバイスのライフサイクル全体をシミュレートします。

処理の流れ:
  1. フラッシュドライブのみ接続 → エニュメレーション
  2. 512バイトのBulk転送 (書き込み)
  3. デバイス切断

USBデバイスの典型的な使用パターン:
  接続 → 認識 → データ転送 → 安全な取り外し
の全フローを1つのシナリオで確認できます。`,
    async run(ctx) {
      const hc = createHostController();
      connectDevice(hc, 1, createFlashDrive());
      const onEvent = (ev: DriverEvent) => {
        const { text, color } = formatEvent(ev);
        ctx.log(text, color);
      };

      // フェーズ1: 接続とエニュメレーション
      ctx.log("=== フェーズ1: 接続とエニュメレーション ===\n", "#00d4ff");
      const core1 = new UsbCore(hc, ctx.delayMs);
      core1.onEvent = onEvent;
      await core1.scanAndEnumerate();

      // フェーズ2: Bulk転送
      const fd = hc.addressTable.get(1);
      const ep = fd?.descriptor.configurations[0]?.interfaces[0]?.endpoints.find(
        (e) => e.direction === EndpointDirection.Out
      );
      if (!fd || !ep) {
        ctx.log("[ERROR] フラッシュドライブが見つからない", "#ff0000");
        return;
      }
      ctx.log("\n=== フェーズ2: Bulk転送 (512B) ===\n", "#10b981");
      const testData = new Uint8Array(512);
      for (let i = 0; i < testData.length; i++) testData[i] = i & 0xff;
      const core2 = new UsbCore(hc, ctx.delayMs);
      core2.onEvent = onEvent;
      await core2.bulkTransfer(1, ep, testData);

      // フェーズ3: 切断
      ctx.log("\n=== フェーズ3: デバイス切断 ===\n", "#ff4444");
      const core3 = new UsbCore(hc, ctx.delayMs);
      core3.onEvent = onEvent;
      await core3.handleDisconnect(1);
      ctx.log("\n=== ライフサイクル完了 ===", "#888");
    },
  },
];

export class UsbApp {
  init(container: HTMLElement | null): void {
    if (!container) return;
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0a0a0a;color:#e0e0e0;";

    // ヘッダ: セレクト + Runボタン
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1a1a2e;flex-wrap:wrap;background:#1a1a2e;";

    const title = document.createElement("h1");
    title.textContent = "USB Driver Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#00d4ff;";
    header.appendChild(title);

    // シナリオ選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText =
      "padding:4px 8px;background:#16213e;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    // Runボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText =
      "padding:4px 16px;background:#00d4ff;color:#0a0a0a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    container.appendChild(header);

    // メインエリア: 左右分割
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: シナリオ説明テキストエリア
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #333;";

    const descLabel = document.createElement("div");
    descLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#00d4ff;border-bottom:1px solid #333;";
    descLabel.textContent = "シナリオ説明";
    leftPanel.appendChild(descLabel);

    const descArea = document.createElement("textarea");
    descArea.style.cssText =
      "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0a0a0a;color:#e0e0e0;border:none;outline:none;resize:none;tab-size:2;";
    descArea.spellcheck = false;
    descArea.readOnly = true;
    descArea.value = EXAMPLES[0]?.description ?? "";
    leftPanel.appendChild(descArea);
    main.appendChild(leftPanel);

    // 右パネル: イベントログ出力
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    const logLabel = document.createElement("div");
    logLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#00d4ff;border-bottom:1px solid #333;";
    logLabel.textContent = "イベントログ";
    rightPanel.appendChild(logLabel);

    const logDiv = document.createElement("div");
    logDiv.style.cssText =
      "flex:1;padding:12px;font-family:monospace;font-size:12px;overflow-y:auto;white-space:pre-wrap;line-height:1.6;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // セレクト変更でテキストエリアを更新
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) descArea.value = ex.description;
    });

    // Runボタンクリックでシナリオ実行
    let running = false;
    runBtn.addEventListener("click", () => {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      runBtn.style.opacity = "0.5";
      logDiv.innerHTML = "";

      const ex = EXAMPLES[Number(select.value)];
      if (!ex) {
        running = false;
        runBtn.disabled = false;
        runBtn.style.opacity = "1";
        return;
      }

      const ctx: RunContext = {
        delayMs: 0,
        log(text: string, color: string = "#e0e0e0") {
          const span = document.createElement("span");
          span.style.color = color;
          span.textContent = text + "\n";
          logDiv.appendChild(span);
          logDiv.scrollTop = logDiv.scrollHeight;
        },
      };

      ex.run(ctx)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log(`[FATAL] ${msg}`, "#ff0000");
        })
        .finally(() => {
          running = false;
          runBtn.disabled = false;
          runBtn.style.opacity = "1";
        });
    });

    // 初回実行
    runBtn.click();
  }
}
