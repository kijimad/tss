/* UNIX セマフォ シミュレーター 公開API */

export type {
  Pid, ProcessState, BlockReason, Process,
  SemType, Semaphore, SharedVar, AccessLog,
  SemInstr, SimConfig, SimOp, EventType, SimEvent,
  TickResult, SimulationResult, Preset,
} from "./types.js";

export {
  simulate, executeSimulation, schedule, detectDeadlock,
  defaultConfig, fifoConfig,
} from "./engine.js";

export { PRESETS } from "./presets.js";
