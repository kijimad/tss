export type {
  MacAddr, VlanId, Dot1QTag, EthernetFrame, SwitchPort, MacTableEntry,
  VlanEntry, VlanSwitch, Host, SimEvent, InjectFrame, SimulationResult, Preset,
  PortMode, EventType,
} from "./types.js";

export {
  mac, BROADCAST_MAC, makeTag, makeFrame,
  makeAccessPort, makeTrunkPort,
  createSwitch, createHost,
  connectHostToSwitch, connectSwitches,
  runSimulation,
} from "./engine.js";

export { presets } from "./presets.js";
