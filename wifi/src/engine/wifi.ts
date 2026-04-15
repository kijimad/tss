/**
 * wifi.ts — IEEE 802.11 Wi-Fi シミュレーションエンジン
 *
 * IEEE 802.11 は無線 LAN (WLAN) の国際標準規格であり、
 * 2.4GHz / 5GHz / 6GHz の周波数帯で無線通信を行う。
 *
 * このモジュールでは、以下の Wi-Fi プロトコルスタックをエミュレートする:
 *
 * 【接続シーケンス】
 *   1. ビーコン受信 — AP が定期的にブロードキャストする管理フレーム
 *   2. プローブ交換 — STA が AP の能力情報を要求・取得
 *   3. 認証 (Authentication) — Open System 認証 または SAE (WPA3)
 *   4. アソシエーション — STA が AP の BSS (Basic Service Set) に参加
 *   5. 4-way Handshake (WPA2/WPA3) — EAPOL によるペアワイズ鍵 (PTK) の確立
 *
 * 【データ転送 (DCF: Distributed Coordination Function)】
 *   6. CSMA/CA — キャリアセンス多重アクセス/衝突回避方式
 *      (イーサネットの CSMA/CD と異なり、衝突を「回避」する方式)
 *   7. バックオフ — コンテンションウィンドウ (CW) に基づくランダム待機
 *   8. RTS/CTS (任意) — 隠れ端末問題の対策
 *   9. データフレーム送信 — ペイロードの送信 (暗号化あり/なし)
 *  10. ACK — SIFS 間隔後の受信確認
 *
 * 【電波伝搬モデル】
 *   - FSPL (自由空間パスロス) に基づく RSSI 計算
 *   - 距離と周波数から信号強度を推定
 */

// ── 802.11 規格定義 ──
// Wi-Fi は世代ごとに異なる変調方式・帯域幅・最大データレートを持つ。
// 802.11b (1999) から 802.11ax (Wi-Fi 6, 2020) まで、
// 各世代で通信速度と効率が大幅に改善されている。

/**
 * Wi-Fi 規格の定義インタフェース
 *
 * IEEE 802.11 の各世代 (a/b/g/n/ac/ax) に対応する
 * 物理層パラメータを保持する。
 */
export interface WifiStandard {
  /** 規格名 (例: "802.11ax") */
  name: string;
  /** Wi-Fi Alliance のマーケティング名 (例: "Wi-Fi 6") */
  generation: string;
  /** 使用周波数帯 (例: "2.4/5/6 GHz") */
  band: string;
  /** 理論上の最大データレート (例: "9.6 Gbps") */
  maxRate: string;
  /** チャネル帯域幅 (MHz)。広いほど高スループット */
  channelWidth: number;
  /** 変調方式 (例: "OFDMA+MU-MIMO") */
  modulation: string;
}

export const STANDARDS: Record<string, WifiStandard> = {
  "802.11b":  { name: "802.11b",  generation: "Wi-Fi 1", band: "2.4 GHz", maxRate: "11 Mbps",   channelWidth: 22, modulation: "DSSS/CCK" },
  "802.11a":  { name: "802.11a",  generation: "Wi-Fi 2", band: "5 GHz",   maxRate: "54 Mbps",   channelWidth: 20, modulation: "OFDM" },
  "802.11g":  { name: "802.11g",  generation: "Wi-Fi 3", band: "2.4 GHz", maxRate: "54 Mbps",   channelWidth: 20, modulation: "OFDM" },
  "802.11n":  { name: "802.11n",  generation: "Wi-Fi 4", band: "2.4/5 GHz", maxRate: "600 Mbps", channelWidth: 40, modulation: "OFDM+MIMO" },
  "802.11ac": { name: "802.11ac", generation: "Wi-Fi 5", band: "5 GHz",   maxRate: "6.9 Gbps",  channelWidth: 160, modulation: "OFDM+MU-MIMO" },
  "802.11ax": { name: "802.11ax", generation: "Wi-Fi 6", band: "2.4/5/6 GHz", maxRate: "9.6 Gbps", channelWidth: 160, modulation: "OFDMA+MU-MIMO" },
};

// ── セキュリティ ──

export type SecurityMode = "Open" | "WEP" | "WPA2-PSK" | "WPA3-SAE";

export interface SecurityConfig {
  mode: SecurityMode;
  /** 4-way handshake の詳細 */
  details: string;
}

// ── アクセスポイント ──

export interface AccessPoint {
  ssid: string;
  bssid: string;
  channel: number;
  frequency: number;
  standard: string;
  security: SecurityMode;
  txPower: number;
  /** ビーコン間隔 (ms) */
  beaconInterval: number;
  /** 接続中のステーション数 */
  connectedStations: number;
  /** 位置 (距離計算用, m) */
  x: number;
  y: number;
}

// ── ステーション (クライアント) ──

export interface Station {
  name: string;
  mac: string;
  x: number;
  y: number;
  /** 対応規格 */
  supportedStandards: string[];
}

// ── 802.11 フレーム ──

export type FrameType = "Management" | "Control" | "Data";
export type FrameSubtype =
  | "Beacon" | "Probe Request" | "Probe Response"
  | "Authentication" | "Deauthentication"
  | "Association Request" | "Association Response"
  | "RTS" | "CTS" | "ACK"
  | "Data" | "QoS Data" | "Null";

export interface WifiFrame {
  type: FrameType;
  subtype: FrameSubtype;
  toDS: boolean;
  fromDS: boolean;
  addr1: string;
  addr2: string;
  addr3: string;
  duration: number;
  seqNum: number;
  payload: string;
  encrypted: boolean;
  size: number;
}

// ── トレース ──

export interface WifiTrace {
  tick: number;
  phase: "beacon" | "probe" | "auth" | "assoc" | "eapol" | "csma_ca" |
    "nav" | "backoff" | "rts_cts" | "data" | "ack" | "retry" |
    "channel" | "rssi" | "roam" | "deauth" | "error";
  device: string;
  detail: string;
  frame?: WifiFrame;
}

// ── 電波伝搬 ──

/** 自由空間パスロス (FSPL) を計算する (dB) */
export function fspl(distanceM: number, freqMhz: number): number {
  if (distanceM <= 0) return 0;
  return 20 * Math.log10(distanceM) + 20 * Math.log10(freqMhz) - 27.55;
}

/** RSSI を計算する (dBm) */
export function calcRssi(txPower: number, distanceM: number, freqMhz: number): number {
  return txPower - fspl(distanceM, freqMhz);
}

/** 2 点間の距離 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/** RSSI → シグナルバー数 */
export function rssiToBar(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  if (rssi >= -80) return 1;
  return 0;
}

/** RSSI → 品質ラベル */
export function rssiQuality(rssi: number): string {
  if (rssi >= -50) return "Excellent";
  if (rssi >= -60) return "Good";
  if (rssi >= -70) return "Fair";
  if (rssi >= -80) return "Weak";
  return "Unusable";
}

// ── フレーム生成 ──

let seqCounter = 0;

function mkFrame(
  type: FrameType, subtype: FrameSubtype,
  addr1: string, addr2: string, addr3: string,
  payload: string, encrypted = false,
): WifiFrame {
  const headerSize = 24 + (subtype === "QoS Data" ? 2 : 0);
  return {
    type, subtype, toDS: type === "Data", fromDS: false,
    addr1, addr2, addr3,
    duration: 0, seqNum: seqCounter++,
    payload, encrypted,
    size: headerSize + payload.length + 4, // + FCS
  };
}

// ── シミュレーション ──

export interface SimConfig {
  ap: AccessPoint;
  station: Station;
  /** 送信するデータ */
  dataPayload: string;
  /** 隠れ端末問題をシミュレートするか */
  hiddenNode: boolean;
  /** パケットロス率 (0〜1) */
  lossRate: number;
}

export interface SimResult {
  trace: WifiTrace[];
  rssi: number;
  dataRate: string;
  frames: WifiFrame[];
  /** 接続にかかった tick 数 */
  connectTicks: number;
  /** データ転送にかかった tick 数 */
  dataTicks: number;
}

export function simulate(config: SimConfig): SimResult {
  const { ap, station } = config;
  const trace: WifiTrace[] = [];
  const frames: WifiFrame[] = [];
  let tick = 0;

  const dist = distance(ap.x, ap.y, station.x, station.y);
  const rssi = calcRssi(ap.txPower, dist, ap.frequency);
  const bars = rssiToBar(rssi);
  const quality = rssiQuality(rssi);
  const std = STANDARDS[ap.standard];

  // ── 電波環境 ──
  tick++;
  trace.push({ tick, phase: "rssi", device: station.name,
    detail: `距離 ${dist.toFixed(1)}m, RSSI ${rssi.toFixed(1)} dBm (${quality}, ${bars} bars)` });
  trace.push({ tick, phase: "channel", device: ap.ssid,
    detail: `Ch ${ap.channel} (${ap.frequency} MHz), ${std?.generation ?? ap.standard}, ${std?.maxRate ?? "?"}` });

  if (rssi < -90) {
    trace.push({ tick, phase: "error", device: station.name, detail: "信号が弱すぎて接続不可 (RSSI < -90 dBm)" });
    return { trace, rssi, dataRate: "0", frames, connectTicks: 0, dataTicks: 0 };
  }

  // ── 1. ビーコン受信 ──
  tick++;
  const beaconFrame = mkFrame("Management", "Beacon", "FF:FF:FF:FF:FF:FF", ap.bssid, ap.bssid,
    `SSID=${ap.ssid} Ch=${ap.channel} Security=${ap.security}`);
  frames.push(beaconFrame);
  trace.push({ tick, phase: "beacon", device: ap.ssid,
    detail: `ビーコン送信 (${ap.beaconInterval}ms 間隔): SSID="${ap.ssid}" ${ap.security}`,
    frame: beaconFrame });

  // ── 2. プローブ ──
  tick++;
  const probeReq = mkFrame("Management", "Probe Request", "FF:FF:FF:FF:FF:FF", station.mac, "FF:FF:FF:FF:FF:FF",
    `SSID=${ap.ssid}`);
  frames.push(probeReq);
  trace.push({ tick, phase: "probe", device: station.name,
    detail: `Probe Request 送信: SSID="${ap.ssid}"`, frame: probeReq });

  tick++;
  const probeResp = mkFrame("Management", "Probe Response", station.mac, ap.bssid, ap.bssid,
    `Supported Rates, RSN, HT Capabilities`);
  frames.push(probeResp);
  trace.push({ tick, phase: "probe", device: ap.ssid,
    detail: `Probe Response: 対応レート、暗号情報を通知`, frame: probeResp });

  // ── 3. 認証 ──
  tick++;
  const authReq = mkFrame("Management", "Authentication", ap.bssid, station.mac, ap.bssid,
    `Auth Algorithm=${ap.security === "WPA3-SAE" ? "SAE" : "Open System"} SeqNo=1`);
  frames.push(authReq);
  trace.push({ tick, phase: "auth", device: station.name,
    detail: `Authentication Request (${ap.security === "WPA3-SAE" ? "SAE Commit" : "Open System"})`,
    frame: authReq });

  tick++;
  const authResp = mkFrame("Management", "Authentication", station.mac, ap.bssid, ap.bssid,
    `Status=Success SeqNo=2`);
  frames.push(authResp);
  trace.push({ tick, phase: "auth", device: ap.ssid,
    detail: `Authentication Response: Status=Success`, frame: authResp });

  if (ap.security === "WPA3-SAE") {
    tick++;
    trace.push({ tick, phase: "auth", device: station.name,
      detail: "SAE Confirm 交換 (Dragonfly 鍵交換: 楕円曲線上の離散対数問題)" });
    tick++;
    trace.push({ tick, phase: "auth", device: ap.ssid, detail: "SAE Confirm 応答 → PMK 導出完了" });
  }

  // ── 4. アソシエーション ──
  tick++;
  const assocReq = mkFrame("Management", "Association Request", ap.bssid, station.mac, ap.bssid,
    `SSID=${ap.ssid} Supported Rates HT/VHT Capabilities`);
  frames.push(assocReq);
  trace.push({ tick, phase: "assoc", device: station.name,
    detail: `Association Request: SSID="${ap.ssid}", 対応規格を通知`, frame: assocReq });

  tick++;
  const assocResp = mkFrame("Management", "Association Response", station.mac, ap.bssid, ap.bssid,
    `Status=Success AID=1`);
  frames.push(assocResp);
  trace.push({ tick, phase: "assoc", device: ap.ssid,
    detail: `Association Response: Success, AID=1 割り当て`, frame: assocResp });

  // ── 5. 4-way Handshake (WPA2/WPA3) ──
  if (ap.security === "WPA2-PSK" || ap.security === "WPA3-SAE") {
    for (let msg = 1; msg <= 4; msg++) {
      tick++;
      const sender = msg % 2 === 1 ? ap.ssid : station.name;
      const detail = [
        "EAPOL Msg 1/4: AP → STA (ANonce)",
        "EAPOL Msg 2/4: STA → AP (SNonce + MIC)",
        "EAPOL Msg 3/4: AP → STA (GTK + MIC, encrypted)",
        "EAPOL Msg 4/4: STA → AP (確認 ACK)",
      ][msg - 1]!;
      trace.push({ tick, phase: "eapol", device: sender, detail });
    }
    trace.push({ tick, phase: "eapol", device: station.name,
      detail: `PTK/GTK インストール完了 → 暗号化通信開始 (${STANDARDS[ap.standard]?.modulation ?? "?"})` });
  }

  const connectTicks = tick;

  // ── 6. CSMA/CA + データ転送 ──
  tick++;
  trace.push({ tick, phase: "csma_ca", device: station.name,
    detail: "DCF: チャネル監視 → DIFS (34μs) 待機" });

  // NAV (Network Allocation Vector)
  tick++;
  const backoffSlots = Math.floor(Math.random() * 16);
  trace.push({ tick, phase: "backoff", device: station.name,
    detail: `ランダムバックオフ: CW=[0,15] → ${backoffSlots} スロット (${backoffSlots * 9}μs)` });

  // RTS/CTS (隠れ端末問題対策)
  if (config.hiddenNode) {
    tick++;
    const rts = mkFrame("Control", "RTS", ap.bssid, station.mac, "", `Duration=${config.dataPayload.length}`);
    frames.push(rts);
    trace.push({ tick, phase: "rts_cts", device: station.name,
      detail: `RTS 送信 (隠れ端末対策): Duration=${rts.duration}μs`, frame: rts });

    tick++;
    const cts = mkFrame("Control", "CTS", station.mac, ap.bssid, "", `Duration`);
    frames.push(cts);
    trace.push({ tick, phase: "rts_cts", device: ap.ssid,
      detail: `CTS 応答 → NAV 設定 (他局は送信抑止)`, frame: cts });

    trace.push({ tick, phase: "nav", device: "*",
      detail: "周囲の端末: NAV タイマーにより送信を延期" });
  }

  // データフレーム送信
  tick++;
  const encrypted = ap.security !== "Open" && ap.security !== "WEP";
  const dataFrame = mkFrame("Data", encrypted ? "QoS Data" : "Data",
    ap.bssid, station.mac, ap.bssid, config.dataPayload, encrypted);
  frames.push(dataFrame);
  trace.push({ tick, phase: "data", device: station.name,
    detail: `データフレーム送信: ${dataFrame.size}B${encrypted ? " (暗号化)" : ""} → ${ap.ssid}`,
    frame: dataFrame });

  // パケットロスチェック
  if (Math.random() < config.lossRate) {
    tick++;
    trace.push({ tick, phase: "error", device: station.name,
      detail: "ACK タイムアウト → 再送" });
    tick++;
    trace.push({ tick, phase: "retry", device: station.name,
      detail: `再送 (リトライカウンタ +1), CW 倍増 → [0,31]` });
    tick++;
    const retryFrame = mkFrame("Data", "Data", ap.bssid, station.mac, ap.bssid, config.dataPayload, encrypted);
    frames.push(retryFrame);
    trace.push({ tick, phase: "data", device: station.name,
      detail: `再送データフレーム: ${retryFrame.size}B`, frame: retryFrame });
  }

  // ACK
  tick++;
  const ackFrame = mkFrame("Control", "ACK", station.mac, ap.bssid, "", "");
  frames.push(ackFrame);
  trace.push({ tick, phase: "ack", device: ap.ssid,
    detail: `ACK 送信 (SIFS=16μs 後): フレーム #${dataFrame.seqNum} 確認`,
    frame: ackFrame });

  const dataTicks = tick - connectTicks;

  // データレート推定
  const baseRate = std !== undefined ? parseInt(std.maxRate) : 54;
  const rateMultiplier = rssi >= -50 ? 1.0 : rssi >= -60 ? 0.7 : rssi >= -70 ? 0.4 : 0.2;
  const effectiveRate = Math.round(baseRate * rateMultiplier);
  const dataRate = `${effectiveRate} Mbps`;

  return { trace, rssi, dataRate, frames, connectTicks, dataTicks };
}
