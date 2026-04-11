/* ネットワークプリンタ シミュレーター 公開API */

export type {
  PrinterState, PrinterType, PaperSize, PrintQuality, Protocol,
  Printer, PrintJob, NetPacket, Client,
  EventType, SimEvent, PrintInstr, SimConfig, SimOp,
  StepResult, SimulationResult, Preset,
} from "./types.js";

export {
  simulate, executeSimulation, defaultConfig,
} from "./engine.js";

export { PRESETS } from "./presets.js";
