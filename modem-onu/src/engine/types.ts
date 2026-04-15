/**
 * types.ts — モデム・ONU シミュレーターの型定義
 *
 * モデム: デジタル信号 ↔ アナログ信号の変調・復調
 * ONU: 光信号 ↔ 電気信号の変換 (FTTH/PON)
 */

// ══════════════════════════════════════
//  共通
// ══════════════════════════════════════

/** シミュレーション中の1イベント */
export interface SimEvent {
  step: number;
  type: EventType;
  severity: "info" | "success" | "warning" | "error";
  from: string;
  to: string;
  label: string;
  detail: string;
  data?: Record<string, string>;
}

export type EventType =
  // モデム
  | "digital_input"    // デジタルデータ入力
  | "modulate"         // 変調
  | "transmit"         // 伝送
  | "noise"            // ノイズ付加
  | "attenuation"      // 減衰
  | "receive"          // 受信
  | "demodulate"       // 復調
  | "digital_output"   // デジタルデータ出力
  | "error_detect"     // ビットエラー検出
  | "constellation"    // コンスタレーション表示
  // ADSL
  | "freq_split"       // 周波数分割
  | "dmt_tone"         // DMT トーン割り当て
  | "snr_measure"      // SNR測定
  // ONU/PON
  | "optical_tx"       // 光信号送信
  | "optical_rx"       // 光信号受信
  | "splitter"         // 光スプリッター
  | "wavelength"       // 波長選択
  | "pon_frame"        // PON フレーム
  | "ranging"          // レンジング (距離測定)
  | "dba"              // 動的帯域割当
  | "olt_grant"        // OLT グラント送信
  | "onu_register"     // ONU 登録
  // 共通
  | "info"
  | "physical";

// ══════════════════════════════════════
//  モデム — 変調方式
// ══════════════════════════════════════

/** 変調方式 */
export type ModulationType = "ASK" | "FSK" | "PSK" | "QPSK" | "QAM16" | "QAM64" | "QAM256";

/** 変調パラメータ */
export interface ModulationParams {
  type: ModulationType;
  carrierFreqHz: number;     // 搬送波周波数 (Hz)
  baudRate: number;           // シンボルレート (baud)
  bitsPerSymbol: number;      // 1シンボルあたりのビット数
  bitRateBps: number;         // ビットレート (bps)
}

/** 信号サンプル (波形表現) */
export interface SignalSample {
  time: number;       // 時刻 (ms)
  amplitude: number;  // 振幅 (-1.0 〜 1.0)
  frequency: number;  // 周波数 (Hz)
  phase: number;      // 位相 (rad)
}

/** コンスタレーション上の点 (I/Q) */
export interface ConstellationPoint {
  i: number;  // In-phase (実部)
  q: number;  // Quadrature (虚部)
  bits: string; // 対応するビット列
  /** ノイズ後の受信点 */
  receivedI?: number;
  receivedQ?: number;
}

/** 信号品質 */
export interface SignalQuality {
  snrDb: number;          // SNR (dB)
  berEstimate: number;    // ビットエラー率推定
  evm: number;            // Error Vector Magnitude (%)
  attenuationDb: number;  // 減衰 (dB)
}

// ══════════════════════════════════════
//  ADSL
// ══════════════════════════════════════

/** ADSL トーン (サブキャリア) */
export interface AdslTone {
  toneNum: number;       // トーン番号 (0-255)
  freqKHz: number;       // 中心周波数 (kHz)
  snrDb: number;         // そのトーンのSNR (dB)
  bitsPerTone: number;   // 割り当てビット数 (0-15)
  modulation: ModulationType; // そのトーンの変調方式
  powerDbm: number;      // 送信電力 (dBm)
}

/** ADSL 周波数帯 */
export interface AdslBand {
  name: string;        // "voice" | "upstream" | "downstream"
  startKHz: number;
  endKHz: number;
  tones: AdslTone[];
}

// ══════════════════════════════════════
//  ONU / PON
// ══════════════════════════════════════

/** PON種類 */
export type PonType = "GPON" | "EPON" | "XG-PON";

/** ONU 状態 */
export type OnuState = "inactive" | "ranging" | "registered" | "active" | "power_save";

/** ONU 情報 */
export interface OnuInfo {
  id: number;
  serial: string;
  state: OnuState;
  distanceKm: number;      // OLTからの距離 (km)
  rttUs: number;            // ラウンドトリップタイム (μs)
  rxPowerDbm: number;       // 受信光パワー (dBm)
  txPowerDbm: number;       // 送信光パワー (dBm)
  allocatedBwMbps: number;  // 割り当て帯域 (Mbps)
  /** 上り波長 (nm) */
  upstreamWavelength: number;
  /** 下り波長 (nm) */
  downstreamWavelength: number;
}

/** OLT (Optical Line Terminal) 情報 */
export interface OltInfo {
  id: string;
  ponType: PonType;
  maxOnus: number;
  registeredOnus: OnuInfo[];
  /** 下り総帯域 (Gbps) */
  downstreamGbps: number;
  /** 上り総帯域 (Gbps) */
  upstreamGbps: number;
  /** スプリット比 */
  splitRatio: number;
  /** 最大伝送距離 (km) */
  maxDistanceKm: number;
}

/** 光ファイバーの物理パラメータ */
export interface FiberParams {
  lengthKm: number;
  attenuationDbPerKm: number;  // 典型: 0.35 dB/km (1310nm), 0.25 dB/km (1490nm)
  splitterLossDb: number;      // スプリッター損失 (典型: 1:32 = 17dB)
  connectorLossDb: number;     // コネクタ損失 (典型: 0.5dB × 接続数)
  totalLossDb: number;         // 総損失
}

/** PON フレーム */
export interface PonFrame {
  direction: "downstream" | "upstream";
  frameType: "data" | "ploam" | "grant" | "ranging" | "registration";
  wavelengthNm: number;
  sourceId: string;
  destId: string;
  payloadBits: number;
  description: string;
}

// ══════════════════════════════════════
//  シミュレーション結果
// ══════════════════════════════════════

export interface SimSnapshot {
  step: number;
  events: SimEvent[];
  /** モデム状態 */
  modulation?: ModulationParams;
  constellation?: ConstellationPoint[];
  signalQuality?: SignalQuality;
  /** 波形サンプル (送信/受信) */
  txSignal?: SignalSample[];
  rxSignal?: SignalSample[];
  /** ADSL */
  adslBands?: AdslBand[];
  /** PON状態 */
  olt?: OltInfo;
  ponFrames?: PonFrame[];
  fiber?: FiberParams;
}

export interface SimResult {
  name: string;
  description: string;
  snapshots: SimSnapshot[];
  allEvents: SimEvent[];
}

export interface SimPreset {
  name: string;
  description: string;
  run: () => SimResult;
}
