export { runSimulation } from "./engine.js";
export { presets } from "./presets.js";
export type {
  ExecFormat, ElfClass, ElfType, ElfHeader,
  SegmentType, ProgramHeader, Section, SharedLib,
  Relocation, MemoryMapping, ProcessImage, AuxvEntry,
  SimOp, EventType, SimEvent, SimulationResult, Preset,
} from "./types.js";
