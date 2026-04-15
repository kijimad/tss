/**
 * app.ts — Bluetooth シミュレーター UI / プリセット定義
 *
 * ═══════════════════════════════════════════════════════════════
 * プリセット一覧 (7 実験)
 * ═══════════════════════════════════════════════════════════════
 *
 * 各プリセットは実際の BLE デバイスのユースケースを再現する:
 *
 *   1. 心拍計 — GATT 基本フロー
 *      接続 → サービス検出 → Heart Rate Measurement の通知購読。
 *      BLE の最も標準的なフロー。
 *
 *   2. 環境センサー — 温湿度読み取り
 *      Environmental Sensing Service から Temperature/Humidity を取得。
 *      2M PHY で高速通信。
 *
 *   3. スマートロック — Passkey ペアリング + 書き込み
 *      セキュアペアリング後にカスタムサービスへ Write でコマンド送信。
 *      IoT セキュリティの実例。
 *
 *   4. BT スピーカー — Numeric Comparison ペアリング
 *      両デバイスで 6 桁を確認する最も推奨されるペアリング方式。
 *
 *   5. Just Works ペアリング — MITM 保護なし
 *      IO 能力のないデバイス同士。手軽だがセキュリティは低い。
 *
 *   6. BLE 5 2M PHY — 高速通信
 *      PHY Update で 2Mbps に切り替え。フィットネスウォッチの例。
 *
 *   7. Coded PHY — 長距離通信
 *      FEC (前方誤り訂正) 付きで到達距離を ×4 に拡大。遠距離センサー。
 *
 * ═══════════════════════════════════════════════════════════════
 * UI 構成
 * ═══════════════════════════════════════════════════════════════
 *
 *   ┌─ ヘッダ ─────────────────────────────────────────┐
 *   │  [プリセット選択 ▼]  [▶ Run]  説明テキスト        │
 *   ├─ 左パネル ─────────┬─ 右パネル ──────────────────┤
 *   │  Devices           │                             │
 *   │  Connection        │  Protocol Trace             │
 *   │  GATT Services     │  (時刻/方向/層/詳細の       │
 *   │  Values &          │   プロトコルトレース)         │
 *   │   Notifications    │                             │
 *   └───────────────────┴─────────────────────────────┘
 */

import {
  BluetoothSimulator, createDevice, svc, char, uuidName,
} from "../engine/bluetooth.js";
import type { SimConfig, SimResult, SimEvent, GattService, BleDevice } from "../engine/bluetooth.js";

// ══════════════════════════════════════════════════════════════
// プリセット実験
// ══════════════════════════════════════════════════════════════

export interface Experiment {
  name: string;
  description: string;
  config: SimConfig;
}

// ── デバイスとプロファイル ──
// 各デバイスは実在する BLE デバイスカテゴリを模倣している

// 心拍計バンド: Heart Rate Service (0x180D) が中核。
// Heart Rate Measurement (0x2A37) は notify 専用 — 接続後に CCCD を有効化して受信する。
// 値のフォーマット: [Flags(1B)][Heart Rate(1-2B)][Energy Expended(opt)][RR-Interval(opt)]
const heartRatePeripheral = createDevice("HR-Band", "AA:BB:CC:01:02:03", [
  svc("180d", "Heart Rate", [
    char("2a37", "Heart Rate Measurement", ["notify"], "10 48", "72 bpm (sensor: chest)", ),
    char("2a38", "Body Sensor Location", ["read"], "01", "Chest"),
  ]),
  svc("180f", "Battery Service", [
    char("2a19", "Battery Level", ["read", "notify"], "5a", "90%"),
  ]),
  svc("180a", "Device Information", [
    char("2a29", "Manufacturer Name", ["read"], "4578616d706c65", "Example Inc."),
    char("2a24", "Model Number", ["read"], "48522d42616e64", "HR-Band"),
    char("2a26", "Firmware Revision", ["read"], "312e322e33", "1.2.3"),
  ]),
], { ioCap: "no-io", distance: 0.5 });

// 環境センサー: Environmental Sensing Service (0x181A)
// Temperature (0x2A6E): sint16 (0.01℃単位), Humidity (0x2A6F): uint16 (0.01%単位)
// 例: 0xC800 = 200 → 2.00°C... ではなく 20.0°C (表現はシミュレーション上の表示値)
const envSensor = createDevice("EnvSensor-01", "DD:EE:FF:11:22:33", [
  svc("181a", "Environmental Sensing", [
    char("2a6e", "Temperature", ["read", "notify"], "c800", "20.0°C"),
    char("2a6f", "Humidity", ["read", "notify"], "1027", "40.0%"),
  ]),
  svc("180f", "Battery Service", [
    char("2a19", "Battery Level", ["read"], "4b", "75%"),
  ]),
  svc("180a", "Device Information", [
    char("2a29", "Manufacturer Name", ["read"], "53656e736f72436f", "SensorCo"),
  ]),
], { ioCap: "no-io", distance: 3, version: "5.2" });

// スマートロック: ベンダー独自サービス (0xFEE0) でロック制御。
// ioCap="keyboard-display" → Passkey ペアリングが可能 (MITM 保護あり)。
// セキュリティが重要な IoT デバイスでは必ずペアリングを行うべき。
const smartLock = createDevice("SmartLock-X1", "11:22:33:AA:BB:CC", [
  svc("1800", "Generic Access", [
    char("2a00", "Device Name", ["read"], "536d6172744c6f636b2d5831", "SmartLock-X1"),
  ]),
  svc("fee0", "Lock Control", [
    char("fee1", "Lock State", ["read", "notify"], "00", "Locked"),
    char("fee2", "Lock Command", ["write"], "00", ""),
  ]),
  svc("180f", "Battery Service", [
    char("2a19", "Battery Level", ["read"], "32", "50%"),
  ]),
], { ioCap: "keyboard-display", distance: 1, mtu: 185 });

// BT スピーカー: ioCap="display-yesno" → Numeric Comparison が利用可能。
// BLE 5.3 + Coded PHY 対応。Generic Access (0x1800) で Appearance を公開。
const speaker = createDevice("BT-Speaker", "55:66:77:88:99:AA", [
  svc("1800", "Generic Access", [
    char("2a00", "Device Name", ["read"], "42542d537065616b6572", "BT-Speaker"),
    char("2a01", "Appearance", ["read"], "0841", "Speaker"),
  ]),
  svc("180a", "Device Information", [
    char("2a29", "Manufacturer Name", ["read"], "41756469", "Audi"),
    char("2a26", "Firmware Revision", ["read"], "322e302e31", "2.0.1"),
  ]),
], { ioCap: "display-yesno", distance: 2, version: "5.3", supportedPhy: ["1M", "2M", "Coded-S2"] });

// フィットネスウォッチ: Heart Rate + CSC (Cycling Speed and Cadence) の複合デバイス。
// MTU=512 で大量データ転送に対応。2M PHY で高速通信。
const fitnessWatch = createDevice("FitWatch-Pro", "CC:DD:EE:FF:00:11", [
  svc("180d", "Heart Rate", [
    char("2a37", "Heart Rate Measurement", ["notify"], "10 55", "85 bpm"),
    char("2a38", "Body Sensor Location", ["read"], "02", "Wrist"),
  ]),
  svc("1816", "Cycling Speed and Cadence", [
    char("2a5b", "CSC Measurement", ["notify"], "03 1400 0a00", "speed=20, cadence=10"),
  ]),
  svc("180f", "Battery Service", [
    char("2a19", "Battery Level", ["read", "notify"], "3c", "60%"),
  ]),
], { ioCap: "display-yesno", distance: 0.3, version: "5.2", mtu: 512, supportedPhy: ["1M", "2M"] });

// セントラルデバイス群
// GAP ロールではセントラル = スキャンして接続を開始する側
const centralPhone = createDevice("My-Phone", "00:11:22:33:44:55", [], { ioCap: "keyboard-display", mtu: 517, supportedPhy: ["1M", "2M", "Coded-S2"] }); // スマートフォン: 全 PHY 対応、高 MTU
const centralPc = createDevice("My-PC", "AA:00:BB:11:CC:22", [], { ioCap: "display-yesno", mtu: 247 }); // PC: 標準 MTU
const centralNoIo = createDevice("Hub-01", "FF:EE:DD:CC:BB:AA", [], { ioCap: "no-io", mtu: 247 }); // IoT ハブ: IO なし → Just Works のみ

export const EXPERIMENTS: Experiment[] = [
  {
    name: "心拍計 — BLE GATT 基本フロー",
    description: "スキャン → 接続 → GATT サービス検出 → Heart Rate Measurement 通知受信の標準的な BLE フロー。",
    config: {
      central: centralPhone, peripheral: heartRatePeripheral, phy: "1M",
      pairing: false, pairingMethod: "just-works",
      readCharacteristics: ["2a38", "2a19", "2a29", "2a24", "2a26"],
      writeCharacteristics: [],
      enableNotifications: ["2a37"],
      notificationValues: [
        { uuid: "2a37", value: "10 48", displayValue: "72 bpm" },
        { uuid: "2a37", value: "10 4e", displayValue: "78 bpm" },
        { uuid: "2a37", value: "10 52", displayValue: "82 bpm" },
      ],
      noiseFloor: -90, latencyMs: 8,
    },
  },
  {
    name: "環境センサー — 温湿度読み取り",
    description: "BLE 5.2 の環境センサーから Temperature / Humidity を読み取り、通知も購読する。",
    config: {
      central: centralPhone, peripheral: envSensor, phy: "2M",
      pairing: false, pairingMethod: "just-works",
      readCharacteristics: ["2a6e", "2a6f", "2a19", "2a29"],
      writeCharacteristics: [],
      enableNotifications: ["2a6e", "2a6f"],
      notificationValues: [
        { uuid: "2a6e", value: "ca00", displayValue: "20.2°C" },
        { uuid: "2a6f", value: "1127", displayValue: "40.5%" },
      ],
      noiseFloor: -90, latencyMs: 10,
    },
  },
  {
    name: "スマートロック — Passkey ペアリング + 書き込み",
    description: "Passkey Entry でセキュアペアリング後、Lock Command に書き込んで解錠する。",
    config: {
      central: centralPhone, peripheral: smartLock, phy: "1M",
      pairing: true, pairingMethod: "passkey",
      readCharacteristics: ["fee1", "2a19"],
      writeCharacteristics: [
        { uuid: "fee2", value: "01", displayValue: "Unlock" },
      ],
      enableNotifications: ["fee1"],
      notificationValues: [
        { uuid: "fee1", value: "01", displayValue: "Unlocked" },
      ],
      noiseFloor: -85, latencyMs: 12,
    },
  },
  {
    name: "BT スピーカー — Numeric Comparison ペアリング",
    description: "両デバイスに 6 桁の数字が表示され、ユーザーが一致を確認する LE Secure Connections。",
    config: {
      central: centralPc, peripheral: speaker, phy: "1M",
      pairing: true, pairingMethod: "numeric-comparison",
      readCharacteristics: ["2a00", "2a01", "2a29", "2a26"],
      writeCharacteristics: [],
      enableNotifications: [],
      notificationValues: [],
      noiseFloor: -88, latencyMs: 15,
    },
  },
  {
    name: "Just Works ペアリング (MITM なし)",
    description: "IO Capability が no-io 同士の場合に使われる。ユーザー操作不要だが MITM 保護なし。IoT ハブの例。",
    config: {
      central: centralNoIo, peripheral: envSensor, phy: "1M",
      pairing: true, pairingMethod: "just-works",
      readCharacteristics: ["2a6e"],
      writeCharacteristics: [],
      enableNotifications: [],
      notificationValues: [],
      noiseFloor: -90, latencyMs: 10,
    },
  },
  {
    name: "BLE 5 2M PHY — 高速通信",
    description: "2M PHY に切り替えてスループットを倍増。PHY Update 手順を含む接続パラメータ交渉。",
    config: {
      central: centralPhone, peripheral: fitnessWatch, phy: "2M",
      pairing: false, pairingMethod: "just-works",
      readCharacteristics: ["2a38", "2a19"],
      writeCharacteristics: [],
      enableNotifications: ["2a37", "2a5b", "2a19"],
      notificationValues: [
        { uuid: "2a37", value: "10 58", displayValue: "88 bpm" },
        { uuid: "2a5b", value: "03 1600 0c00", displayValue: "speed=22, cadence=12" },
        { uuid: "2a19", value: "3b", displayValue: "59%" },
      ],
      noiseFloor: -85, latencyMs: 6,
    },
  },
  {
    name: "Coded PHY — 長距離通信",
    description: "BLE 5.0 Coded PHY (S=2) で遠距離 (30m) の環境センサーに接続。データレートは低下するが到達距離が約 4 倍。",
    config: {
      central: centralPhone,
      peripheral: createDevice("FarSensor", "EE:FF:00:11:22:33", [
        svc("181a", "Environmental Sensing", [
          char("2a6e", "Temperature", ["read", "notify"], "0001", "25.6°C"),
        ]),
        svc("180f", "Battery Service", [
          char("2a19", "Battery Level", ["read"], "14", "20%"),
        ]),
      ], { distance: 30, version: "5.0", supportedPhy: ["1M", "Coded-S2"] }),
      phy: "Coded-S2",
      pairing: false, pairingMethod: "just-works",
      readCharacteristics: ["2a6e", "2a19"],
      writeCharacteristics: [],
      enableNotifications: ["2a6e"],
      notificationValues: [{ uuid: "2a6e", value: "0101", displayValue: "25.7°C" }],
      noiseFloor: -95, latencyMs: 20,
    },
  },
];

// ══════════════════════════════════════════════════════════════
// 色定義
// ══════════════════════════════════════════════════════════════
// プロトコルスタックの各層とイベント種別に色を割り当て、
// トレース表示でどの層の動作かを視覚的に識別できるようにする。

/** プロトコル層ごとの表示色 */
function layerColor(layer: SimEvent["layer"]): string {
  switch (layer) {
    case "Radio":   return "#64748b";
    case "HCI":     return "#a78bfa";
    case "L2CAP":   return "#3b82f6";
    case "ATT":     return "#06b6d4";
    case "GATT":    return "#22c55e";
    case "SMP":     return "#ec4899";
    case "GAP":     return "#f59e0b";
    case "App":     return "#e2e8f0";
  }
}

/** イベント種別ごとの表示色 */
function typeColor(type: SimEvent["type"]): string {
  switch (type) {
    case "adv":           return "#f59e0b";
    case "scan":          return "#3b82f6";
    case "connect":       return "#22c55e";
    case "pair":          return "#ec4899";
    case "gatt_discover": return "#06b6d4";
    case "gatt_read":     return "#a78bfa";
    case "gatt_write":    return "#f97316";
    case "gatt_notify":   return "#22c55e";
    case "disconnect":    return "#ef4444";
    case "error":         return "#ef4444";
    case "info":          return "#64748b";
  }
}

// ══════════════════════════════════════════════════════════════
// UI
// ══════════════════════════════════════════════════════════════
//
// 左パネル: デバイス情報、接続パラメータ、GATT ツリー、読取値/通知
// 右パネル: プロトコルトレース (時刻 → 方向 → 層 → 詳細)
//
// 操作フロー:
//   1. プリセット選択 → 左パネルにデバイス情報を表示
//   2. ▶ Run クリック → シミュレーション実行 → 全パネル更新

export class BluetoothApp {
  /** アプリケーションを初期化し、指定コンテナに UI を構築する */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "Bluetooth Simulator"; title.style.cssText = "margin:0;font-size:15px;color:#e2e8f0;white-space:nowrap;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run";
    runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:370px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const addSection = (label: string, color: string) => {
      const lbl = document.createElement("div");
      lbl.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${color};border-bottom:1px solid #1e293b;`;
      lbl.textContent = label; leftPanel.appendChild(lbl);
      const div = document.createElement("div"); div.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
      leftPanel.appendChild(div);
      return div;
    };

    const cfgDiv = addSection("Devices", "#f59e0b");
    const connDiv = addSection("Connection", "#22c55e");
    const gattDiv = addSection("GATT Services", "#06b6d4");
    const valDiv = addSection("Values & Notifications", "#a78bfa");

    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Protocol Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;";
    rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => {
      const r = document.createElement("div"); r.style.marginBottom = "2px";
      r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
      p.appendChild(r);
    };

    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      const pe = exp.config.peripheral; const ce = exp.config.central;
      addRow(cfgDiv, "Central", `${ce.name} (${ce.address})`, "#3b82f6");
      addRow(cfgDiv, "  IO Cap", ce.ioCap, "#64748b");
      addRow(cfgDiv, "Peripheral", `${pe.name} (${pe.address})`, "#22c55e");
      addRow(cfgDiv, "  RSSI", `${pe.rssi}dBm (${pe.distance}m)`, "#64748b");
      addRow(cfgDiv, "  IO Cap", pe.ioCap, "#64748b");
      addRow(cfgDiv, "  BT Version", pe.version, "#a78bfa");
      addRow(cfgDiv, "PHY", exp.config.phy, "#f59e0b");
      addRow(cfgDiv, "ペアリング", exp.config.pairing ? `${exp.config.pairingMethod}` : "なし", "#ec4899");
    };

    const renderConn = (result: SimResult) => {
      connDiv.innerHTML = "";
      if (!result.connectionParams) { connDiv.innerHTML = '<span style="color:#475569;">—</span>'; return; }
      const cp = result.connectionParams;
      addRow(connDiv, "Interval", `${cp.interval}ms`, "#e2e8f0");
      addRow(connDiv, "Latency", String(cp.latency), "#64748b");
      addRow(connDiv, "Timeout", `${cp.timeout}ms`, "#64748b");
      addRow(connDiv, "MTU", `${cp.mtu} bytes`, "#3b82f6");
      addRow(connDiv, "PHY", cp.phy, "#f59e0b");
      addRow(connDiv, "State", result.finalState, result.finalState === "bonded" ? "#ec4899" : "#22c55e");
      addRow(connDiv, "総時間", `${result.totalTime.toFixed(0)}ms`, "#06b6d4");
    };

    const renderGatt = (services: GattService[]) => {
      gattDiv.innerHTML = "";
      for (const s of services) {
        const svcEl = document.createElement("div"); svcEl.style.cssText = "margin-bottom:4px;";
        svcEl.innerHTML = `<span style="color:#22c55e;font-weight:600;">${uuidName(s.uuid)}</span> <span style="color:#475569;">(${s.uuid})</span>`;
        for (const c of s.characteristics) {
          const chEl = document.createElement("div"); chEl.style.cssText = "margin-left:12px;font-size:9px;";
          chEl.innerHTML = `<span style="color:#06b6d4;">${uuidName(c.uuid)}</span> <span style="color:#475569;">[${c.permissions.join(",")}]</span>`;
          svcEl.appendChild(chEl);
        }
        gattDiv.appendChild(svcEl);
      }
    };

    const renderValues = (result: SimResult) => {
      valDiv.innerHTML = "";
      if (result.readValues.length > 0) {
        const h = document.createElement("div"); h.style.cssText = "color:#a78bfa;font-weight:600;margin-bottom:3px;"; h.textContent = "Read Values";
        valDiv.appendChild(h);
        for (const v of result.readValues) {
          addRow(valDiv, `  ${v.name}`, `"${v.displayValue}" (0x${v.value})`, "#94a3b8");
        }
      }
      if (result.notifications.length > 0) {
        const h = document.createElement("div"); h.style.cssText = "color:#22c55e;font-weight:600;margin:6px 0 3px;"; h.textContent = "Notifications";
        valDiv.appendChild(h);
        for (const n of result.notifications) {
          addRow(valDiv, `  ${n.name}`, `"${n.displayValue}"`, "#06b6d4");
        }
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const lc = layerColor(ev.layer); const tc = typeColor(ev.type);
        let html =
          `<span style="min-width:36px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="color:${ev.direction === "→" ? "#22c55e" : ev.direction === "←" ? "#06b6d4" : "#f59e0b"};min-width:12px;text-align:center;">${ev.direction}</span>` +
          `<span style="min-width:40px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        if (ev.packet) html += ` <span style="color:#475569;font-size:8px;">[CID=${ev.packet.cid.toString(16)} ${ev.packet.length}B]</span>`;
        el.innerHTML = html;
        evDiv.appendChild(el);
      }
    };

    const loadExperiment = (exp: Experiment) => {
      descSpan.textContent = exp.description;
      renderConfig(exp);
      connDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリック</span>';
      gattDiv.innerHTML = ""; valDiv.innerHTML = ""; evDiv.innerHTML = "";
    };

    const runSimulation = (exp: Experiment) => {
      // ディープコピー (GATT の値が変更されるため)
      const config: SimConfig = {
        ...exp.config,
        peripheral: JSON.parse(JSON.stringify(exp.config.peripheral)),
      };
      const sim = new BluetoothSimulator();
      const result = sim.simulate(config);
      renderConfig(exp);
      renderConn(result);
      renderGatt(result.discoveredServices);
      renderValues(result);
      renderEvents(result.events);
    };

    exSelect.addEventListener("change", () => { const exp = EXPERIMENTS[Number(exSelect.value)]; if (exp) loadExperiment(exp); });
    runBtn.addEventListener("click", () => { const exp = EXPERIMENTS[Number(exSelect.value)]; if (exp) runSimulation(exp); });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
