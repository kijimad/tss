/**
 * index.ts — アセンブラシミュレータの公開API
 */

export type {
  Register,
  OperandType,
  Operand,
  Opcode,
  Instruction,
  EncodedInstruction,
  AssembleStep,
  AssembleResult,
} from "./types.js";

export { parse, parseOperand } from "./parser.js";
export { encodeInstruction } from "./encoder.js";
export { assemble } from "./assembler.js";
