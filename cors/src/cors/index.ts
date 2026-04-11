export {
  simulate, processRequest, classifyRequest,
  mkRequest, mkServerConfig,
  extractOrigin, isSameOrigin,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  CorsRequest, CorsServerConfig, CorsResponseHeaders,
  HttpMethod, RequestClassification, CorsVerdict,
  SimStep, SimEvent, RequestResult, SimulationResult, Preset,
} from "./types.js";
