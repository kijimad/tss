/* UNIX 端末入出力 シミュレーター 公開API */

export type {
  TermMode, LocalFlags, InputFlags, OutputFlags, ControlChars,
  Termios, TTY, PTY, FileDescriptor, TermProcess, SignalType,
  SimEvent, TermInstr, SimConfig, SimOp, StepResult, SimulationResult, Preset,
} from "./types.js";

export {
  simulate, executeSimulation,
  defaultConfig, defaultTermios, rawTermios, cbreakTermios, charName,
} from "./engine.js";

export { PRESETS } from "./presets.js";
