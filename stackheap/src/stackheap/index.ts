/* スタック＆ヒープ シミュレーター 公開API */

export {
  simulate, executeProgram,
  createStack, pushFrame, popFrame, addLocal, assignVar,
  createHeap, heapAlloc, heapFree,
  gcMarkSweep, gcRefCount,
  buildLayout, stackUsage, heapUsage,
  intVal, floatVal, boolVal, charVal, ptrVal, refVal, retAddr,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  PrimitiveType, ValueKind, MemValue,
  StackVariable, StackFrame, CallStack,
  HeapBlock, BlockStatus, Heap,
  MemRegion, MemorySegment, MemoryLayout,
  Instruction, StepResult,
  SimOp, SimEvent, EventType, SimulationResult, Preset,
} from "./types.js";
