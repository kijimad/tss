/**
 * FTPシミュレーションライブラリのエントリーポイント。
 * 型定義、シミュレーションエンジン、プリセットを再エクスポートする。
 * @module ftp
 */

export type {
  FtpCommand, TransferMode, DataType, FsEntry, FtpUser,
  ControlMessage, DataTransfer, SessionState, SimStep,
  SimulationResult, ClientCommand, Preset,
} from "./types.js";

export { runSimulation, cloneFs } from "./engine.js";
export { presets } from "./presets.js";
