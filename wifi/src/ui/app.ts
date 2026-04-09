import { simulate, STANDARDS, rssiToBar, rssiQuality } from "../engine/wifi.js";
import type { SimConfig, SimResult, WifiTrace, WifiFrame, Station } from "../engine/wifi.js";

export interface Example {
  name: string;
  description: string;
  config: SimConfig;
}

const laptop: Station = { name: "Laptop", mac: "DC:A6:32:01:02:03", x: 5, y: 0, supportedStandards: ["802.11ax", "802.11ac", "802.11n"] };
const phone: Station = { name: "iPhone", mac: "F0:18:98:AA:BB:CC", x: 15, y: 0, supportedStandards: ["802.11ax", "802.11ac"] };
const iot: Station = { name: "IoT-Sensor", mac: "B8:27:EB:00:00:01", x: 3, y: 0, supportedStandards: ["802.11n", "802.11g"] };

export const EXAMPLES: Example[] = [
  {
    name: "Wi-Fi 6 接続 (WPA3, 近距離)",
    description: "802.11ax (Wi-Fi 6) + WPA3-SAE。5m 距離で最高品質。SAE (Dragonfly) 認証と OFDMA。",
    config: {
      ap: { ssid: "Home-WiFi6", bssid: "AA:BB:CC:DD:EE:01", channel: 36, frequency: 5180, standard: "802.11ax", security: "WPA3-SAE", txPower: 20, beaconInterval: 100, connectedStations: 3, x: 0, y: 0 },
      station: { ...laptop, x: 5 },
      dataPayload: "GET /index.html HTTP/1.1\r\nHost: example.com",
      hiddenNode: false, lossRate: 0,
    },
  },
  {
    name: "Wi-Fi 5 WPA2-PSK (一般的な接続)",
    description: "802.11ac (Wi-Fi 5) + WPA2-PSK。4-way handshake による鍵交換。10m 距離。",
    config: {
      ap: { ssid: "Office-5G", bssid: "11:22:33:44:55:01", channel: 44, frequency: 5220, standard: "802.11ac", security: "WPA2-PSK", txPower: 20, beaconInterval: 100, connectedStations: 15, x: 0, y: 0 },
      station: { ...phone, x: 10 },
      dataPayload: '{"action":"sync","data":[1,2,3]}',
      hiddenNode: false, lossRate: 0,
    },
  },
  {
    name: "2.4 GHz 遠距離 (信号劣化)",
    description: "802.11n 2.4GHz で 30m。RSSI が低下しデータレートが落ちる。",
    config: {
      ap: { ssid: "LongRange-2G", bssid: "AA:BB:CC:00:00:02", channel: 6, frequency: 2437, standard: "802.11n", security: "WPA2-PSK", txPower: 20, beaconInterval: 100, connectedStations: 5, x: 0, y: 0 },
      station: { ...laptop, x: 30 },
      dataPayload: "Ping from 30m away",
      hiddenNode: false, lossRate: 0.1,
    },
  },
  {
    name: "隠れ端末問題 (RTS/CTS)",
    description: "互いに見えない端末が同一 AP に送信。RTS/CTS で衝突を回避。",
    config: {
      ap: { ssid: "RTS-CTS-Demo", bssid: "AA:BB:CC:00:00:03", channel: 1, frequency: 2412, standard: "802.11g", security: "WPA2-PSK", txPower: 20, beaconInterval: 100, connectedStations: 8, x: 0, y: 0 },
      station: { ...laptop, x: 12 },
      dataPayload: "Data with RTS/CTS protection",
      hiddenNode: true, lossRate: 0,
    },
  },
  {
    name: "オープンネットワーク (暗号化なし)",
    description: "セキュリティなしの公衆 Wi-Fi。認証・鍵交換がスキップされ、平文で通信。",
    config: {
      ap: { ssid: "Free-WiFi", bssid: "00:11:22:33:44:55", channel: 11, frequency: 2462, standard: "802.11n", security: "Open", txPower: 18, beaconInterval: 100, connectedStations: 30, x: 0, y: 0 },
      station: { ...phone, x: 8 },
      dataPayload: "password=secret123&user=admin",
      hiddenNode: false, lossRate: 0,
    },
  },
  {
    name: "圏外 (接続不可)",
    description: "AP から 100m。RSSI が -90 dBm 以下で接続失敗。",
    config: {
      ap: { ssid: "FarAway-AP", bssid: "FF:00:FF:00:FF:00", channel: 36, frequency: 5180, standard: "802.11ac", security: "WPA2-PSK", txPower: 20, beaconInterval: 100, connectedStations: 0, x: 0, y: 0 },
      station: { ...laptop, x: 100 },
      dataPayload: "Will this arrive?",
      hiddenNode: false, lossRate: 0,
    },
  },
  {
    name: "パケットロス + 再送",
    description: "不安定な環境 (lossRate=30%)。ACK タイムアウト → 再送 → CW 倍増。",
    config: {
      ap: { ssid: "Lossy-Net", bssid: "AA:00:BB:00:CC:00", channel: 6, frequency: 2437, standard: "802.11n", security: "WPA2-PSK", txPower: 20, beaconInterval: 100, connectedStations: 20, x: 0, y: 0 },
      station: { ...iot, x: 20 },
      dataPayload: "sensor_data=42.5",
      hiddenNode: false, lossRate: 0.9,
    },
  },
  {
    name: "IoT デバイス (802.11g, 低速)",
    description: "レガシーな 802.11g IoT センサー。低データレート、小ペイロード。",
    config: {
      ap: { ssid: "IoT-Gateway", bssid: "B0:B0:B0:00:00:01", channel: 1, frequency: 2412, standard: "802.11g", security: "WPA2-PSK", txPower: 15, beaconInterval: 100, connectedStations: 50, x: 0, y: 0 },
      station: iot,
      dataPayload: '{"temp":22.5}',
      hiddenNode: false, lossRate: 0,
    },
  },
];

function phaseColor(p: WifiTrace["phase"]): string {
  switch (p) {
    case "beacon":   return "#f59e0b";
    case "probe":    return "#06b6d4";
    case "auth":     return "#a78bfa";
    case "assoc":    return "#3b82f6";
    case "eapol":    return "#ec4899";
    case "csma_ca":  return "#22c55e";
    case "nav":      return "#64748b";
    case "backoff":  return "#f97316";
    case "rts_cts":  return "#10b981";
    case "data":     return "#3b82f6";
    case "ack":      return "#22c55e";
    case "retry":    return "#ef4444";
    case "channel":  return "#06b6d4";
    case "rssi":     return "#f59e0b";
    case "roam":     return "#8b5cf6";
    case "deauth":   return "#dc2626";
    case "error":    return "#ef4444";
  }
}

function frameTypeColor(t: WifiFrame["type"]): string {
  switch (t) { case "Management": return "#a78bfa"; case "Control": return "#22c55e"; case "Data": return "#3b82f6"; }
}

export class WifiApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Wi-Fi 802.11 Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Connect & Send";
    runBtn.style.cssText = "padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: AP 情報 + フレーム一覧
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:360px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    infoLabel.textContent = "Connection Info";
    leftPanel.appendChild(infoLabel);
    const infoDiv = document.createElement("div");
    infoDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(infoDiv);

    const frameLabel = document.createElement("div");
    frameLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    frameLabel.textContent = "802.11 Frames";
    leftPanel.appendChild(frameLabel);
    const frameDiv = document.createElement("div");
    frameDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;";
    leftPanel.appendChild(frameDiv);
    main.appendChild(leftPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Wi-Fi Protocol Trace";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderInfo = (config: SimConfig, result: SimResult) => {
      infoDiv.innerHTML = "";
      const { ap, station } = config;
      const std = STANDARDS[ap.standard];
      const bars = rssiToBar(result.rssi);
      const barStr = "\u2588".repeat(bars) + "\u2591".repeat(4 - bars);

      const add = (l: string, v: string, c: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;min-width:80px;display:inline-block;">${l}</span> <span style="color:#94a3b8;">${v}</span>`;
        infoDiv.appendChild(r);
      };

      add("SSID", `"${ap.ssid}"`, "#f59e0b");
      add("BSSID", ap.bssid, "#64748b");
      add("規格", `${std?.generation ?? "?"} (${ap.standard})`, "#3b82f6");
      add("チャネル", `${ap.channel} (${ap.frequency} MHz)`, "#06b6d4");
      add("帯域幅", `${std?.channelWidth ?? "?"}MHz`, "#06b6d4");
      add("変調", std?.modulation ?? "?", "#a78bfa");
      add("セキュリティ", ap.security, ap.security === "Open" ? "#ef4444" : "#22c55e");
      add("TX Power", `${ap.txPower} dBm`, "#64748b");
      add("RSSI", `${result.rssi.toFixed(1)} dBm [${barStr}] ${rssiQuality(result.rssi)}`, bars >= 3 ? "#22c55e" : bars >= 2 ? "#f59e0b" : "#ef4444");
      add("データレート", result.dataRate, "#22c55e");
      add("STA", `${station.name} (${station.mac})`, "#e2e8f0");
      add("接続", `${result.connectTicks} tick`, "#a78bfa");
      add("データ転送", `${result.dataTicks} tick`, "#3b82f6");
    };

    const renderFrames = (frames: WifiFrame[]) => {
      frameDiv.innerHTML = "";
      for (const f of frames) {
        const el = document.createElement("div");
        const c = frameTypeColor(f.type);
        el.style.cssText = `margin-bottom:3px;padding:4px 6px;border:1px solid ${c}33;border-radius:3px;background:${c}08;font-size:9px;`;
        const enc = f.encrypted ? " \u{1F512}" : "";
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:${c};font-weight:600;">${f.subtype}${enc}</span>` +
          `<span style="color:#64748b;">${f.size}B #${f.seqNum}</span>` +
          `</div>` +
          `<div style="color:#64748b;">Addr1=${f.addr1.slice(-8)} Addr2=${f.addr2.slice(-8)}</div>`;
        if (f.payload && f.type === "Data") {
          el.innerHTML += `<div style="color:#94a3b8;font-size:8px;margin-top:1px;">${f.payload.slice(0, 50)}${f.payload.length > 50 ? "..." : ""}</div>`;
        }
        frameDiv.appendChild(el);
      }
    };

    const renderTrace = (trace: WifiTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="color:#475569;min-width:18px;">t${step.tick}</span>` +
          `<span style="min-width:60px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#f59e0b;min-width:55px;">${step.device}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      infoDiv.innerHTML = ""; frameDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const result = simulate(ex.config);
      renderInfo(ex.config, result);
      renderFrames(result.frames);
      renderTrace(result.trace);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
