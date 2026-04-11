export type {
  MemoryScheme,
  SegmentType,
  SegmentEntry,
  SegmentAddress,
  PageTableEntry,
  TlbEntry,
  VirtualAddress,
  PhysicalAddress,
  TranslationStep,
  TranslationResult,
  MemoryAccess,
  MemoryBlock,
  SimulationResult,
  SimulationStats,
} from "./types.js";

export {
  createSegmentTable,
  translateSegmentAddress,
  runSegmentSimulation,
} from "./segment.js";

export {
  splitVirtualAddress,
  splitPhysicalAddress,
  createPageTable,
  translatePageAddress,
  runPagingSimulation,
} from "./paging.js";
export type { PagingConfig } from "./paging.js";

export { presets } from "./presets.js";
export type { Preset } from "./presets.js";
