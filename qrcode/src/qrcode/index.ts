/* QRコード シミュレーター 公開API */

export { simulate, generateQr, detectMode, selectVersion, getVersionInfo, encodeData } from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  EncodingMode, ErrorCorrectionLevel, QrVersion,
  VersionInfo, EcBlockInfo, MaskPattern, MaskPenalty,
  Module, ModuleType, DataAnalysis, EncodedData, MatrixResult,
  SimOp, SimStep, SimEvent, EventType,
  QrResult, SimulationResult, Preset,
} from "./types.js";
