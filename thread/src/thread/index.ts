/* UNIX スレッド シミュレーター 公開API */

export {
  simulate, executeSimulation,
  schedule, detectDeadlock, detectRaces,
  defaultConfig, fifoConfig,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  Thread, Tid, ThreadState, BlockReason,
  Mutex, CondVar, RwLock, Barrier,
  SharedVar, ThreadInstr,
  SchedulerType, SimConfig, TickResult,
  SimOp, SimEvent, EventType, SimulationResult, Preset,
} from "./types.js";
