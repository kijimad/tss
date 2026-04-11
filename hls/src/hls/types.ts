/* HLS シミュレーター 型定義 */

// ─── メディア ───

/** コーデック */
export type VideoCodec = "h264" | "h265" | "av1";
export type AudioCodec = "aac" | "ac3" | "opus";

/** メディアセグメント */
export interface MediaSegment {
  /** セグメント番号 */
  sequence: number;
  /** セグメント長(秒) */
  duration: number;
  /** ファイル名 */
  uri: string;
  /** サイズ(bytes) */
  sizeBytes: number;
  /** ビットレート(bps) */
  bitrate: number;
  /** キーフレーム(IDR)先頭か */
  isIdr: boolean;
  /** 暗号化済みか */
  encrypted: boolean;
  /** 不連続フラグ */
  discontinuity: boolean;
  /** プログラム日時 */
  programDateTime?: number;
}

/** レンディション（品質バリアント） */
export interface Rendition {
  /** バンド幅(bps) */
  bandwidth: number;
  /** 解像度 */
  resolution: { width: number; height: number };
  /** コーデック */
  codecs: string;
  /** フレームレート */
  frameRate: number;
  /** プレイリストURI */
  uri: string;
  /** セグメント一覧 */
  segments: MediaSegment[];
  /** セグメント長(秒) */
  targetDuration: number;
}

/** マスタープレイリスト */
export interface MasterPlaylist {
  /** バリアント一覧 */
  variants: Rendition[];
  /** 独立セグメント */
  independentSegments: boolean;
}

/** メディアプレイリスト */
export interface MediaPlaylist {
  /** ターゲットデュレーション */
  targetDuration: number;
  /** メディアシーケンス番号 */
  mediaSequence: number;
  /** セグメント一覧 */
  segments: MediaSegment[];
  /** VODかLiveか */
  type: "VOD" | "EVENT" | "LIVE";
  /** 終了タグ */
  endList: boolean;
  /** バージョン */
  version: number;
  /** 暗号化キー情報 */
  encryption?: EncryptionInfo;
}

// ─── 暗号化 ───

/** 暗号化方式 */
export type EncryptionMethod = "NONE" | "AES-128" | "SAMPLE-AES";

/** 暗号化情報 */
export interface EncryptionInfo {
  method: EncryptionMethod;
  uri: string;
  iv?: string;
}

// ─── ABR (Adaptive Bitrate) ───

/** ABRアルゴリズム */
export type AbrAlgorithm = "bandwidth" | "buffer" | "hybrid";

/** ABR判定結果 */
export interface AbrDecision {
  /** 選択されたレンディションインデックス */
  selectedIdx: number;
  /** 推定帯域幅(bps) */
  estimatedBandwidth: number;
  /** バッファ残量(秒) */
  bufferLevel: number;
  /** 理由 */
  reason: string;
}

// ─── プレイヤー状態 ───

/** プレイヤー状態 */
export type PlayerState = "idle" | "loading" | "playing" | "buffering" | "paused" | "ended" | "error";

/** バッファ情報 */
export interface BufferInfo {
  /** バッファ済み時間(秒) */
  buffered: number;
  /** 現在再生位置(秒) */
  currentTime: number;
  /** 合計時間(秒) */
  totalDuration: number;
  /** バッファヘルス(秒) */
  health: number;
}

/** プレイヤー */
export interface Player {
  state: PlayerState;
  buffer: BufferInfo;
  /** 現在のレンディションインデックス */
  currentRendition: number;
  /** ABRアルゴリズム */
  abrAlgorithm: AbrAlgorithm;
  /** ABR判定履歴 */
  abrHistory: AbrDecision[];
  /** ダウンロード済みセグメント */
  downloadedSegments: DownloadedSegment[];
  /** 品質切替回数 */
  qualitySwitches: number;
  /** リバッファ回数 */
  rebufferCount: number;
  /** リバッファ合計時間(ms) */
  rebufferDuration: number;
}

/** ダウンロード済みセグメント */
export interface DownloadedSegment {
  segment: MediaSegment;
  renditionIdx: number;
  /** ダウンロード時間(ms) */
  downloadTime: number;
  /** 実効帯域幅(bps) */
  throughput: number;
  /** 開始時刻(ms) */
  startTime: number;
}

// ─── ネットワーク ───

/** ネットワーク条件 */
export interface NetworkCondition {
  /** 帯域幅(bps) */
  bandwidth: number;
  /** レイテンシ(ms) */
  latency: number;
  /** ジッター(ms) */
  jitter: number;
  /** パケットロス率(0-1) */
  lossRate: number;
}

/** ネットワーク変化イベント */
export interface NetworkChange {
  /** 発生時刻(ms) */
  atTime: number;
  /** 新しい条件 */
  condition: NetworkCondition;
}

// ─── シミュレーション ───

/** シミュレーション操作 */
export type SimOp =
  | { type: "vod"; master: MasterPlaylist; abr: AbrAlgorithm; network: NetworkCondition; networkChanges?: NetworkChange[] }
  | { type: "live"; master: MasterPlaylist; abr: AbrAlgorithm; network: NetworkCondition; windowSize: number; networkChanges?: NetworkChange[] }
  | { type: "abr_compare"; master: MasterPlaylist; algorithms: AbrAlgorithm[]; network: NetworkCondition; networkChanges?: NetworkChange[] };

/** イベント種別 */
export type EventType =
  | "playlist_load" | "segment_download" | "segment_append"
  | "abr_switch" | "buffer_update" | "rebuffer"
  | "state_change" | "encryption" | "error" | "info"
  | "quality_up" | "quality_down" | "network_change";

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  type: EventType;
  message: string;
  detail?: string;
}

/** 再生結果 */
export interface PlaybackResult {
  player: Player;
  /** マスタープレイリスト文字列 */
  masterPlaylistStr: string;
  /** メディアプレイリスト文字列 */
  mediaPlaylistStr: string;
  events: SimEvent[];
}

/** シミュレーション結果 */
export interface SimulationResult {
  results: PlaybackResult[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
