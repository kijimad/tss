/**
 * @module llvm
 * LLVM IR シミュレーターの公開 API モジュール。
 * エンジン、プリセット、型定義を一元的に再エクスポートする。
 */

export { runSimulation } from "./engine.js";
export { presets } from "./presets.js";
export { typeToString } from "./types.js";
export type {
  IRType, IROpcode, ICmpPred, FCmpPred, IRInsn, IROperand,
  BasicBlock, IRFunction, IRModule,
  PassKind, PassResult, PassChange,
  LiveInterval, InterferenceEdge, RegAllocResult,
  MachineInsn,
  SimOp, EventType, SimEvent, SimulationResult, Preset,
} from "./types.js";
