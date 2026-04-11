/* UNIX 擬似端末 (PTY) シミュレーター 公開API */

export type {
  Fd, Pid, Sid, PtyState, PtyPair, PtyProcess, FdEntry, DataFlow,
  EventType, SimEvent, PtyInstr, SimConfig, SimOp,
  StepResult, SimulationResult, Preset,
} from "./types.js";

export {
  simulate, executeSimulation, defaultConfig,
} from "./engine.js";

export { PRESETS } from "./presets.js";
