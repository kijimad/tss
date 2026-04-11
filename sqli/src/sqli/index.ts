/* SQLインジェクション シミュレーター 公開API */

export {
  simulate, simulateAttack,
  createDefaultDb, parseSql, executeSql,
  escapeSqlInput, wafCheck, validateInput, whitelistCheck,
  inputMethodLabel, injectionTypeLabel,
  noDefense, parameterizedOnly, escapingOnly, wafOnly, fullDefense,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  ColumnType, ColumnDef, TableDef, Row, TableData, Database,
  SqlStatementType, ParsedSql, QueryResult,
  InjectionType, InputMethod, Defense,
  SimStep, AttackResult, SimOp, SimEvent, EventType,
  SimulationResult, Preset,
} from "./types.js";
