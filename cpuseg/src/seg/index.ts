export { runSimulation, parseSelector, encodeSelector, effectiveLimit, linearAddress } from "./engine.js";
export { presets } from "./presets.js";
export type {
  SegmentDescriptor, SegmentSelector, SegmentRegister, CpuState,
  MemoryOp, SimEvent, EventType, SimulationResult, Preset,
  SegmentType, PrivilegeLevel, TableType,
} from "./types.js";
