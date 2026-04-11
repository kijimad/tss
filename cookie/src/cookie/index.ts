export {
  simulate, createJar, parseSetCookie,
  mkRequest, mkResponse,
  extractDomain, extractPath, extractScheme, extractOrigin,
  domainMatches, pathMatches, isSameSite,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  Cookie, CookieJar, SetCookieDirective,
  HttpRequest, HttpResponse, SameSitePolicy,
  SimOp, SimEvent, SimulationResult, Preset,
} from "./types.js";
