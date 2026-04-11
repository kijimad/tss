export { runSimulation } from "./engine.js";
export { presets } from "./presets.js";
export type {
  Opcode, Insn, InsnOperand, CallInfo, CallFlag, InlineCache, MethodEntry,
  ISeqType, ISeq, LocalEntry, ArgInfo, CatchEntry,
  FrameType, ControlFrame,
  RubyValueType, RubyValue, ObjectFlag,
  FiberState, GCState, HeapPage, HeapSlot,
  VMState, ClassInfo,
  SimOp, EventType, SimEvent, SimulationResult, Preset,
} from "./types.js";
