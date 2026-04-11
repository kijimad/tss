export { simulate, mkRouter, mkLink, addStaticRoute } from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  Router, Link, RouteEntry, Protocol,
  OspfLsa, BgpAttributes, BgpPeer, BgpRoute,
  SimOp, SimEvent, SimulationResult, Preset,
} from "./types.js";
