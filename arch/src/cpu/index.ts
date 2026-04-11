/**
 * index.ts — コンピュータ・アーキテクチャシミュレータの公開API
 */

export type {
  Opcode,
  Instruction,
  Flags,
  CpuState,
  PipelineStage,
  CycleTrace,
  ExecutionResult,
} from "./types.js";

export { execute, createInitialState, REG_NAMES } from "./cpu.js";
