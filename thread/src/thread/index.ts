/**
 * UNIX スレッド シミュレーター 公開APIモジュール
 *
 * シミュレーターの全ての公開関数・型・プリセットを再エクスポートする。
 * 外部からはこのモジュールを通じてシミュレーターの機能にアクセスする。
 */

/** エンジンの主要関数をエクスポート */
export {
  simulate, executeSimulation,
  schedule, detectDeadlock, detectRaces,
  defaultConfig, fifoConfig,
} from "./engine.js";

/** プリセット定義をエクスポート */
export { PRESETS } from "./presets.js";

/** 全ての型定義をエクスポート */
export type {
  Thread, Tid, ThreadState, BlockReason,
  Mutex, CondVar, RwLock, Barrier,
  SharedVar, ThreadInstr,
  SchedulerType, SimConfig, TickResult,
  SimOp, SimEvent, EventType, SimulationResult, Preset,
} from "./types.js";
