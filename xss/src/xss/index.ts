/* XSS シミュレーター 公開API */

export {
  simulate, simulateAttack,
  escapeHtml, escapeJs, escapeUrl, escapeCss,
  extractTags, extractAttributes, extractProtocols,
  sanitize, applyEncoding, renderInContext, detectExecution, checkCsp,
  noDefense, htmlEscapeOnly, fullEscape, withSanitizer, withCsp, fullDefense,
  mkPayload,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  XssType, InjectionContext, XssPayload,
  OutputEncoding, SanitizerConfig, CspPolicy, PageConfig,
  SimStep, AttackResult,
  SimOp, SimEvent, EventType, SimulationResult, Preset,
} from "./types.js";
