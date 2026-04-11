/* QRコード シミュレーター 型定義 */

// ─── エンコードモード ───

/** データエンコードモード */
export type EncodingMode = "numeric" | "alphanumeric" | "byte" | "kanji";

/** モードインジケータ（4bit） */
export const MODE_INDICATORS: Record<EncodingMode, string> = {
  numeric: "0001",
  alphanumeric: "0010",
  byte: "0100",
  kanji: "1000",
};

// ─── 誤り訂正 ───

/** 誤り訂正レベル */
export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

/** 誤り訂正レベルの訂正能力 (%) */
export const EC_CAPABILITY: Record<ErrorCorrectionLevel, number> = {
  L: 7,
  M: 15,
  Q: 25,
  H: 30,
};

// ─── バージョン ───

/** QRコードバージョン（1-40） */
export type QrVersion = number;

/** バージョン情報 */
export interface VersionInfo {
  version: QrVersion;
  /** モジュール数（辺） */
  size: number;
  /** 各ECレベルでのデータ容量(bytes) */
  dataCapacity: Record<ErrorCorrectionLevel, number>;
  /** アライメントパターン座標 */
  alignmentPositions: number[];
  /** ECブロック情報 */
  ecBlocks: Record<ErrorCorrectionLevel, EcBlockInfo[]>;
}

/** ECブロック情報 */
export interface EcBlockInfo {
  /** ブロック数 */
  count: number;
  /** データコードワード数 */
  dataCodewords: number;
  /** ECコードワード数 */
  ecCodewords: number;
}

// ─── マスクパターン ───

/** マスクパターン番号（0-7） */
export type MaskPattern = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** マスク条件式 */
export const MASK_FUNCTIONS: Record<MaskPattern, (row: number, col: number) => boolean> = {
  0: (r, c) => (r + c) % 2 === 0,
  1: (r) => r % 2 === 0,
  2: (_r, c) => c % 3 === 0,
  3: (r, c) => (r + c) % 3 === 0,
  4: (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  5: (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  6: (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  7: (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
};

// ─── モジュール ───

/** モジュールの種類 */
export type ModuleType =
  | "data"
  | "finder"
  | "separator"
  | "timing"
  | "alignment"
  | "format_info"
  | "version_info"
  | "dark_module"
  | "empty";

/** 単一モジュール */
export interface Module {
  /** 暗(true)/明(false) */
  dark: boolean;
  /** モジュールの種類 */
  type: ModuleType;
  /** マスク適用済みか */
  masked: boolean;
}

// ─── エンコード結果 ───

/** データ分析結果 */
export interface DataAnalysis {
  input: string;
  mode: EncodingMode;
  version: QrVersion;
  ecLevel: ErrorCorrectionLevel;
  /** 文字数 */
  charCount: number;
  /** ビットストリーム長 */
  bitLength: number;
}

/** エンコード済みデータ */
export interface EncodedData {
  /** モードインジケータ */
  modeIndicator: string;
  /** 文字数インジケータ */
  charCountIndicator: string;
  /** データビットストリーム */
  dataBits: string;
  /** パディング後の全ビット列 */
  fullBitstream: string;
  /** データコードワード */
  dataCodewords: number[];
  /** ECコードワード */
  ecCodewords: number[];
  /** インターリーブ済みコードワード */
  finalCodewords: number[];
}

/** マトリクス配置結果 */
export interface MatrixResult {
  /** モジュールマトリクス */
  matrix: Module[][];
  /** サイズ（辺） */
  size: number;
  /** マスクパターン */
  maskPattern: MaskPattern;
  /** マスクペナルティスコア */
  penalties: MaskPenalty;
}

/** マスクペナルティ */
export interface MaskPenalty {
  rule1: number;
  rule2: number;
  rule3: number;
  rule4: number;
  total: number;
}

// ─── シミュレーション ───

/** シミュレーション操作 */
export type SimOp =
  | { type: "encode"; data: string; ecLevel: ErrorCorrectionLevel; version?: QrVersion }
  | { type: "encode_compare"; data: string; ecLevels: ErrorCorrectionLevel[] }
  | { type: "mask_compare"; data: string; ecLevel: ErrorCorrectionLevel };

/** シミュレーションステップ */
export interface SimStep {
  phase: string;
  message: string;
  detail?: string;
}

/** イベント種別 */
export type EventType =
  | "analyze" | "encode" | "ec_generate" | "interleave"
  | "place" | "mask" | "format" | "complete" | "info" | "error";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  message: string;
  detail?: string;
}

/** QRコード生成結果 */
export interface QrResult {
  analysis: DataAnalysis;
  encoded: EncodedData;
  matrix: MatrixResult;
  steps: SimStep[];
  events: SimEvent[];
}

/** シミュレーション全体結果 */
export interface SimulationResult {
  results: QrResult[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
