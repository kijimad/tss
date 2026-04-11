export type {
  MacAddr, IPv4, OsiLayer, DeviceKind,
  EthernetFrame, Packet, ArpPacket,
  Port, MacTableEntry, RouteEntry, ArpEntry,
  NetworkDevice, SimEvent, SimulationResult,
} from "./types.js";

export {
  mac, createNic, createRepeater, createHub, createBridge, createSwitch, createRouter,
  connect, makeFrame, makeIpPacket, makeArpRequest, makeArpReply,
  runSimulation,
} from "./engine.js";

export { presets } from "./presets.js";
export type { Preset } from "./presets.js";
