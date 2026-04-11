/* MITM シミュレーター 公開API */

export {
  simulate, simulateAttack,
  defaultNodes, validCert, forgedCert,
  createPacket, tamperPacket, encryptPayload, tryDecrypt,
  normalArpTable, arpSpoof, normalDnsRecords, dnsSpoof,
  validateTls, attackMethodLabel,
  noDefense, fullDefense, hstsOnly, certDefense,
} from "./engine.js";
export { PRESETS } from "./presets.js";
export type {
  NodeRole, NetNode, Protocol, TlsVersion, Certificate,
  Packet, AttackMethod, ArpEntry, DnsRecord, Defense,
  AttackStep, AttackResult, SimOp, SimEvent, EventType,
  SimulationResult, Preset,
} from "./types.js";
