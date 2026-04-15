/* メモリスワッピングシミュレーター 公開API */

export type {
  PageState, PageTableEntry, PhysicalFrame, SwapSlot, SwapProcess,
  ReplacementAlgorithm, AccessType, MemoryAccess,
  SwapEventType, EventSeverity, SwapEvent,
  TlbEntry, SwapSnapshot, SwapStats, SwapSimResult, SwapConfig, SwapPreset,
} from "./types.js";

export { runSwapSim, defaultConfig } from "./engine.js";
export type { SimInput } from "./engine.js";

export { PRESETS } from "./presets.js";
