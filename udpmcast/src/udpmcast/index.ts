export { runSimulation, isMulticastAddr, multicastIpToMac, getMulticastScope, ttlInScope } from "./engine.js";
export { presets } from "./presets.js";
export type {
  NetAddr, Host, Router, RouterInterface, GroupMembership,
  UdpDatagram, IgmpType, IgmpMessage, MulticastScope,
  SimOp, EventType, SimEvent, SimulationResult, Preset,
} from "./types.js";
