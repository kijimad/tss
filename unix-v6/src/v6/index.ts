/* Unix V6 シミュレーター 公開API */

export type {
  V6ProcState, V6Signal, V6Segment, V6Process,
  V6Inode, V6DirEntry, V6SuperBlock, V6BufFlags, V6Buffer,
  V6FileDescriptor, V6SysFile, V6Pipe,
  V6BlockType, V6DiskBlock,
  V6Operation, V6EventType, V6Event,
  V6StepResult, V6SimResult, V6Config, V6Preset,
} from "./types.js";

export {
  V6_BLOCK_SIZE, V6_DIRECT_BLOCKS, V6_INDIRECT_START,
  V6_FILENAME_MAX, V6_NPROC, V6_NOFILE, V6_NBUF,
  V6_IFREG, V6_IFDIR, V6_IFCHR, V6_IFBLK, V6_INODE_ADDRS,
} from "./types.js";

export { runSimulation, defaultConfig } from "./engine.js";

export { PRESETS } from "./presets.js";

// PDP-11 CPUエミュレータ
export type {
  PDP11Event, PDP11EventType, PDP11Decoded,
  PDP11StepResult, PDP11SimResult, PDP11Preset, PDP11Program, PDP11Session,
  Operand,
} from "./pdp11.js";

export {
  PDP11, PDP11Asm, runPDP11, createPDP11Session,
  R0, R1, R2, R3, R4, R5, SP, PC,
  imm, ind, ainc, aincDef, adec, adecDef, idx, idxDef, abs,
} from "./pdp11.js";

export { PDP11_PRESETS } from "./pdp11-presets.js";
