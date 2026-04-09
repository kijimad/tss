import { NetdevSimulator, port, route, acl } from "../engine/netdev.js";
import type { Topology, FlowScenario, SimResult, SimEvent, Device, Frame } from "../engine/netdev.js";

export interface Experiment { name: string; description: string; topology: Topology; scenarios: FlowScenario[]; }

// ── フレームヘルパー ──
function frame(src: MacAddr, dst: MacAddr, opts: Partial<Frame> = {}): Frame {
  return { srcMac: src, dstMac: dst, etherType: opts.etherType ?? "IPv4", srcIp: opts.srcIp, dstIp: opts.dstIp, protocol: opts.protocol, srcPort: opts.srcPort, dstPort: opts.dstPort, ttl: opts.ttl ?? 64, size: opts.size ?? 64, vlan: opts.vlan };
}
type MacAddr = string;

// ── プリセット ──

export const EXPERIMENTS: Experiment[] = [
  {
    name: "L2 スイッチ — MAC 学習 & 転送",
    description: "3 台のホストが L2 スイッチに接続。MAC アドレスの動的学習、ユニキャスト転送、不明宛先のフラッディングを観察。",
    topology: {
      devices: [
        { name: "SW1", type: "l2-switch", model: "Catalyst 2960", ports: [port("p1", "Fa0/1", { vlans: [1] }), port("p2", "Fa0/2", { vlans: [1] }), port("p3", "Fa0/3", { vlans: [1] })], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [{ id: 1, name: "default", subnet: "192.168.1.0", gateway: "192.168.1.1" }], stpRoot: true, stpPriority: 32768 },
        { name: "PC-A", type: "host", model: "PC", ip: "192.168.1.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "PC-B", type: "host", model: "PC", ip: "192.168.1.20", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "PC-C", type: "host", model: "PC", ip: "192.168.1.30", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["SW1:p1", "PC-A:eth0"], ["SW1:p2", "PC-B:eth0"], ["SW1:p3", "PC-C:eth0"]],
    },
    scenarios: [
      { name: "PC-A → PC-B (初回、フラッディング)", frame: frame("aa:00:00:00:00:01", "bb:00:00:00:00:02", { srcIp: "192.168.1.10", dstIp: "192.168.1.20", protocol: "icmp" }), ingressDevice: "SW1", ingressPort: "p1" },
      { name: "PC-B → PC-A (MAC 学習済み)", frame: frame("bb:00:00:00:00:02", "aa:00:00:00:00:01", { srcIp: "192.168.1.20", dstIp: "192.168.1.10", protocol: "icmp" }), ingressDevice: "SW1", ingressPort: "p2" },
    ],
  },
  {
    name: "VLAN — セグメント分離",
    description: "VLAN 10 と VLAN 20 を設定。同一 VLAN 内は通信可、異なる VLAN 間は L2 で通信不可。",
    topology: {
      devices: [
        { name: "SW1", type: "l2-switch", model: "Catalyst 3560", ports: [port("p1", "Fa0/1", { vlans: [10] }), port("p2", "Fa0/2", { vlans: [10] }), port("p3", "Fa0/3", { vlans: [20] }), port("p4", "Fa0/4", { vlans: [20] })], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [{ id: 10, name: "Sales", subnet: "10.10.0.0", gateway: "10.10.0.1" }, { id: 20, name: "Dev", subnet: "10.20.0.0", gateway: "10.20.0.1" }] },
        { name: "Sales-1", type: "host", model: "PC", ip: "10.10.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "Sales-2", type: "host", model: "PC", ip: "10.10.0.20", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "Dev-1", type: "host", model: "PC", ip: "10.20.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["SW1:p1", "Sales-1:eth0"], ["SW1:p2", "Sales-2:eth0"], ["SW1:p3", "Dev-1:eth0"]],
    },
    scenarios: [
      { name: "Sales-1 → Sales-2 (同一VLAN OK)", frame: frame("aa:10:00:00:00:01", "aa:10:00:00:00:02", { srcIp: "10.10.0.10", dstIp: "10.10.0.20", vlan: 10 }), ingressDevice: "SW1", ingressPort: "p1" },
      { name: "Sales-1 → Dev-1 (異なるVLAN NG)", frame: frame("aa:10:00:00:00:01", "aa:20:00:00:00:01", { srcIp: "10.10.0.10", dstIp: "10.20.0.10", vlan: 10 }), ingressDevice: "SW1", ingressPort: "p1" },
    ],
  },
  {
    name: "L3 ルーター — スタティックルーティング",
    description: "2 つのサブネットを L3 ルーターで接続。ルーティングテーブルの参照、TTL デクリメントを観察。",
    topology: {
      devices: [
        { name: "R1", type: "l3-router", model: "ISR 4331", ip: "10.0.0.1", ports: [port("g0", "Gi0/0"), port("g1", "Gi0/1")], macTable: [], routeTable: [route("10.0.0.0", "255.255.255.0", "0.0.0.0", "g0", { type: "connected" }), route("10.0.1.0", "255.255.255.0", "0.0.0.0", "g1", { type: "connected" }), route("0.0.0.0", "0.0.0.0", "10.0.0.254", "g0", { type: "static", metric: 1 })], aclRules: [], natTable: [], vlans: [] },
        { name: "PC-LAN", type: "host", model: "PC", ip: "10.0.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "Server", type: "host", model: "Server", ip: "10.0.1.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["R1:g0", "PC-LAN:eth0"], ["R1:g1", "Server:eth0"]],
    },
    scenarios: [
      { name: "PC → Server (ルーティング)", frame: frame("aa:00:01:00:00:01", "00:00:00:00:00:R1", { srcIp: "10.0.0.10", dstIp: "10.0.1.10", protocol: "tcp", dstPort: 80 }), ingressDevice: "R1", ingressPort: "g0" },
      { name: "PC → 外部 (デフォルトルート)", frame: frame("aa:00:01:00:00:01", "00:00:00:00:00:R1", { srcIp: "10.0.0.10", dstIp: "8.8.8.8", protocol: "udp", dstPort: 53 }), ingressDevice: "R1", ingressPort: "g0" },
    ],
  },
  {
    name: "ファイアウォール — ゾーン & ACL",
    description: "Trust/Untrust/DMZ の 3 ゾーン構成。ACL でウェブトラフィックは許可、SSH は拒否する。",
    topology: {
      devices: [
        { name: "FW", type: "firewall", model: "FortiGate 60F", ip: "192.168.1.1", ports: [port("p1", "port1"), port("p2", "port2"), port("p3", "port3")], macTable: [], routeTable: [route("192.168.1.0", "255.255.255.0", "0.0.0.0", "p1"), route("10.0.0.0", "255.255.255.0", "0.0.0.0", "p2"), route("172.16.0.0", "255.255.255.0", "0.0.0.0", "p3")], aclRules: [acl(10, "permit", "tcp", "any", "any", { dstPort: "80" }), acl(20, "permit", "tcp", "any", "any", { dstPort: "443" }), acl(30, "deny", "tcp", "any", "any", { dstPort: "22", stateful: true }), acl(100, "permit", "any", "any", "any")], natTable: [], vlans: [], fwZones: [{ name: "trust", ports: ["p1"], trust: "trusted" }, { name: "untrust", ports: ["p2"], trust: "untrusted" }, { name: "dmz", ports: ["p3"], trust: "dmz" }] },
        { name: "LAN-PC", type: "host", model: "PC", ip: "192.168.1.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "Web-Srv", type: "host", model: "Server", ip: "172.16.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["FW:p1", "LAN-PC:eth0"], ["FW:p3", "Web-Srv:eth0"]],
    },
    scenarios: [
      { name: "LAN → Web (HTTP 許可)", frame: frame("aa:01:00:00:00:01", "00:FW:00:00:00:01", { srcIp: "192.168.1.10", dstIp: "172.16.0.10", protocol: "tcp", dstPort: 80 }), ingressDevice: "FW", ingressPort: "p1" },
      { name: "LAN → Web (SSH 拒否)", frame: frame("aa:01:00:00:00:01", "00:FW:00:00:00:01", { srcIp: "192.168.1.10", dstIp: "172.16.0.10", protocol: "tcp", dstPort: 22 }), ingressDevice: "FW", ingressPort: "p1" },
      { name: "LAN → Web (HTTPS 許可)", frame: frame("aa:01:00:00:00:01", "00:FW:00:00:00:01", { srcIp: "192.168.1.10", dstIp: "172.16.0.10", protocol: "tcp", dstPort: 443 }), ingressDevice: "FW", ingressPort: "p1" },
    ],
  },
  {
    name: "NAT ゲートウェイ — SNAT/PAT",
    description: "プライベート IP をグローバル IP に変換。SNAT (1:1) と PAT (N:1) の違いを観察。",
    topology: {
      devices: [
        { name: "NAT-GW", type: "nat-gateway", model: "NAT Gateway", ip: "203.0.113.1", ports: [port("inside", "inside"), port("outside", "outside")], macTable: [], routeTable: [route("192.168.0.0", "255.255.255.0", "0.0.0.0", "inside"), route("0.0.0.0", "0.0.0.0", "203.0.113.254", "outside")], aclRules: [], natTable: [{ type: "snat", insideLocal: "192.168.0.10", insideGlobal: "203.0.113.10", outsideGlobal: "" }, { type: "pat", insideLocal: "192.168.0.20", insideGlobal: "203.0.113.1", outsideGlobal: "", port: 12345, translatedPort: 40001 }], vlans: [] },
        { name: "PC-1", type: "host", model: "PC", ip: "192.168.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "Internet", type: "host", model: "Cloud", ip: "8.8.8.8", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["NAT-GW:inside", "PC-1:eth0"], ["NAT-GW:outside", "Internet:eth0"]],
    },
    scenarios: [
      { name: "PC-1 → Internet (SNAT)", frame: frame("aa:00:00:00:00:01", "00:NAT:00:00:00:01", { srcIp: "192.168.0.10", dstIp: "8.8.8.8", protocol: "tcp", dstPort: 443 }), ingressDevice: "NAT-GW", ingressPort: "inside" },
      { name: "PC-2 → Internet (PAT)", frame: frame("aa:00:00:00:00:02", "00:NAT:00:00:00:01", { srcIp: "192.168.0.20", dstIp: "8.8.8.8", protocol: "tcp", srcPort: 12345, dstPort: 80 }), ingressDevice: "NAT-GW", ingressPort: "inside" },
    ],
  },
  {
    name: "無線 AP — WiFi ブリッジ",
    description: "無線 AP が WiFi クライアントのフレームを有線ネットワークにブリッジ。SSID/チャネル/セキュリティも表示。",
    topology: {
      devices: [
        { name: "AP1", type: "wireless-ap", model: "UniFi U6-Pro", ports: [port("wlan0", "wlan0"), port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [], wireless: { ssid: "Office-WiFi", channel: 36, band: "5GHz", security: "WPA3-SAE", maxClients: 128, txPower: 20 } },
        { name: "SW1", type: "l2-switch", model: "Switch", ports: [port("p1", "Fa0/1", { vlans: [1] }), port("p2", "Fa0/2", { vlans: [1] })], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "Server", type: "host", model: "Server", ip: "10.0.0.100", ports: [port("eth0", "eth0")], macTable: [{ mac: "cc:00:00:00:00:01", port: "eth0", vlan: 1, type: "static", age: 0 }], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["AP1:eth0", "SW1:p1"], ["SW1:p2", "Server:eth0"]],
    },
    scenarios: [
      { name: "WiFi Client → Server", frame: frame("dd:00:00:00:00:01", "cc:00:00:00:00:01", { srcIp: "10.0.0.50", dstIp: "10.0.0.100", protocol: "tcp", dstPort: 443 }), ingressDevice: "AP1", ingressPort: "wlan0" },
    ],
  },
  {
    name: "L4 ロードバランサー",
    description: "VIP に着信したリクエストを Round Robin/Least Connections でバックエンドに分散。ヘルスチェック結果も反映。",
    topology: {
      devices: [
        { name: "LB", type: "load-balancer", model: "HAProxy", ip: "10.0.0.100", ports: [port("vip", "vip"), port("be", "backend")], macTable: [], routeTable: [route("10.0.1.0", "255.255.255.0", "0.0.0.0", "be")], aclRules: [], natTable: [], vlans: [], lbBackends: [{ ip: "10.0.1.10", port: 8080, weight: 3, healthy: true, connections: 2 }, { ip: "10.0.1.11", port: 8080, weight: 2, healthy: true, connections: 5 }, { ip: "10.0.1.12", port: 8080, weight: 1, healthy: false, connections: 0 }], lbAlgorithm: "least-connections" },
        { name: "Web-1", type: "host", model: "Server", ip: "10.0.1.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["LB:be", "Web-1:eth0"]],
    },
    scenarios: [
      { name: "Client → VIP (least-conn)", frame: frame("cc:cc:cc:00:00:01", "00:LB:00:00:00:01", { srcIp: "203.0.113.50", dstIp: "10.0.0.100", protocol: "tcp", dstPort: 80 }), ingressDevice: "LB", ingressPort: "vip" },
      { name: "Client → VIP (2回目)", frame: frame("cc:cc:cc:00:00:02", "00:LB:00:00:00:01", { srcIp: "203.0.113.51", dstIp: "10.0.0.100", protocol: "tcp", dstPort: 80 }), ingressDevice: "LB", ingressPort: "vip" },
    ],
  },
  {
    name: "STP — ループ防止",
    description: "2 台のスイッチ間に冗長リンク。STP により片方のポートが Blocking 状態になりループを防止する。",
    topology: {
      devices: [
        { name: "SW1", type: "l2-switch", model: "Switch", ports: [port("p1", "Fa0/1"), port("p2", "Fa0/2"), port("p3", "Fa0/3")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [{ id: 1, name: "default", subnet: "10.0.0.0", gateway: "10.0.0.1" }], stpRoot: true, stpPriority: 4096 },
        { name: "SW2", type: "l2-switch", model: "Switch", ports: [port("p1", "Fa0/1"), port("p2", "Fa0/2", { stpState: "blocking" }), port("p3", "Fa0/3")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [{ id: 1, name: "default", subnet: "10.0.0.0", gateway: "10.0.0.1" }], stpPriority: 32768 },
        { name: "PC-A", type: "host", model: "PC", ip: "10.0.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "PC-B", type: "host", model: "PC", ip: "10.0.0.20", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["SW1:p1", "SW2:p1"], ["SW1:p2", "SW2:p2"], ["SW1:p3", "PC-A:eth0"], ["SW2:p3", "PC-B:eth0"]],
    },
    scenarios: [
      { name: "PC-A → PC-B (STP forwarding 経路)", frame: frame("aa:00:00:00:00:0a", "bb:00:00:00:00:0b", { srcIp: "10.0.0.10", dstIp: "10.0.0.20" }), ingressDevice: "SW1", ingressPort: "p3" },
    ],
  },
  {
    name: "企業ネットワーク統合構成",
    description: "スイッチ→ルーター→ファイアウォール→インターネット。複数機器を通過するパケットの全処理を追跡。",
    topology: {
      devices: [
        { name: "SW1", type: "l2-switch", model: "Switch", ports: [port("p1", "Fa0/1"), port("p2", "Uplink")], macTable: [{ mac: "aa:00:00:00:00:01", port: "p1", vlan: 1, type: "dynamic", age: 0 }], routeTable: [], aclRules: [], natTable: [], vlans: [{ id: 1, name: "default", subnet: "10.0.0.0", gateway: "10.0.0.1" }] },
        { name: "R1", type: "l3-router", model: "Router", ip: "10.0.0.1", ports: [port("g0", "Gi0/0"), port("g1", "Gi0/1")], macTable: [], routeTable: [route("10.0.0.0", "255.255.255.0", "0.0.0.0", "g0", { type: "connected" }), route("0.0.0.0", "0.0.0.0", "172.16.0.1", "g1")], aclRules: [], natTable: [], vlans: [] },
        { name: "FW", type: "firewall", model: "Firewall", ip: "172.16.0.1", ports: [port("in", "inside"), port("out", "outside")], macTable: [], routeTable: [route("172.16.0.0", "255.255.255.0", "0.0.0.0", "in"), route("0.0.0.0", "0.0.0.0", "203.0.113.1", "out")], aclRules: [acl(10, "permit", "tcp", "any", "any", { dstPort: "443" }), acl(20, "deny", "any", "any", "any")], natTable: [], vlans: [], fwZones: [{ name: "inside", ports: ["in"], trust: "trusted" }, { name: "outside", ports: ["out"], trust: "untrusted" }] },
        { name: "Internet", type: "host", model: "Cloud", ip: "203.0.113.50", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
        { name: "PC", type: "host", model: "PC", ip: "10.0.0.10", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["SW1:p1", "PC:eth0"], ["SW1:p2", "R1:g0"], ["R1:g1", "FW:in"], ["FW:out", "Internet:eth0"]],
    },
    scenarios: [
      { name: "PC → Internet HTTPS (全機器通過)", frame: frame("aa:00:00:00:00:01", "ff:ff:ff:ff:ff:ff", { srcIp: "10.0.0.10", dstIp: "203.0.113.50", protocol: "tcp", dstPort: 443 }), ingressDevice: "SW1", ingressPort: "p1" },
      { name: "PC → Internet SSH (FW で拒否)", frame: frame("aa:00:00:00:00:01", "ff:ff:ff:ff:ff:ff", { srcIp: "10.0.0.10", dstIp: "203.0.113.50", protocol: "tcp", dstPort: 22 }), ingressDevice: "SW1", ingressPort: "p1" },
    ],
  },
];

// ── 色 ──
const LAYER_COLORS: Record<string, string> = { L1: "#475569", L2: "#3b82f6", L3: "#22c55e", L4: "#f59e0b", L7: "#e2e8f0", STP: "#a78bfa", VLAN: "#06b6d4", ACL: "#ef4444", NAT: "#f97316", WiFi: "#ec4899", LB: "#10b981" };
const TYPE_ICONS: Record<string, string> = { rx: "←", tx: "→", learn: "📖", forward: "➤", drop: "✗", route: "🔀", translate: "⇄", filter: "⚙", info: "●" };
const DEV_COLORS: Record<string, string> = { "l2-switch": "#3b82f6", "l3-router": "#22c55e", firewall: "#ef4444", "nat-gateway": "#f97316", "wireless-ap": "#ec4899", "load-balancer": "#10b981", host: "#94a3b8" };

export class NetdevApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";
    const header = document.createElement("div"); header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "Network Device Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;"; header.appendChild(title);
    const exSelect = document.createElement("select"); exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;"; header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;"; header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:380px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const ms = (l: string, c: string) => { const lb = document.createElement("div"); lb.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${c};border-bottom:1px solid #1e293b;`; lb.textContent = l; leftPanel.appendChild(lb); const d = document.createElement("div"); d.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(d); return d; };
    const devDiv = ms("Devices", "#f59e0b");
    const flowDiv = ms("Flow Results", "#22c55e");
    const macLabel = document.createElement("div"); macLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;"; macLabel.textContent = "MAC Tables"; leftPanel.appendChild(macLabel);
    const macDiv = document.createElement("div"); macDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;font-size:9px;"; leftPanel.appendChild(macDiv);
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Packet Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel); container.appendChild(main);

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => { const r = document.createElement("div"); r.style.marginBottom = "2px"; r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`; p.appendChild(r); };

    const renderDevices = (topo: Topology) => { devDiv.innerHTML = ""; for (const d of topo.devices) { addRow(devDiv, d.name, `${d.type} (${d.model})${d.ip ? " " + d.ip : ""}`, DEV_COLORS[d.type] ?? "#94a3b8"); } };
    const renderFlows = (r: SimResult) => { flowDiv.innerHTML = ""; for (const f of r.flowResults) { addRow(flowDiv, f.name, f.reached ? `✓ ${f.reason} [${f.path.join("→")}]` : `✗ ${f.reason}`, f.reached ? "#22c55e" : "#ef4444"); } };
    const renderMac = (m: Map<string, import("../engine/netdev.js").MacEntry[]>) => { macDiv.innerHTML = ""; for (const [dev, entries] of m) { if (entries.length === 0) continue; const h = document.createElement("div"); h.style.cssText = "color:#3b82f6;font-weight:600;margin:4px 0 2px;"; h.textContent = dev; macDiv.appendChild(h); for (const e of entries) { const r = document.createElement("div"); r.style.cssText = "margin-left:8px;color:#64748b;"; r.textContent = `${e.mac} → ${e.port} (VLAN ${e.vlan}, ${e.type})`; macDiv.appendChild(r); } } };
    const renderEvents = (events: SimEvent[]) => { evDiv.innerHTML = ""; for (const ev of events) { const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;"; const lc = LAYER_COLORS[ev.layer] ?? "#94a3b8"; el.innerHTML = `<span style="min-width:30px;color:#475569;text-align:right;">${ev.time}</span><span style="color:${ev.type === "drop" ? "#ef4444" : "#94a3b8"};min-width:14px;">${TYPE_ICONS[ev.type] ?? "●"}</span><span style="min-width:40px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span><span style="color:#64748b;min-width:50px;">${ev.device}</span><span style="color:#cbd5e1;">${ev.detail}</span>`; evDiv.appendChild(el); } };

    const load = (e: Experiment) => { descSpan.textContent = e.description; renderDevices(e.topology); flowDiv.innerHTML = '<span style="color:#475569;">▶ Run</span>'; macDiv.innerHTML = ""; evDiv.innerHTML = ""; };
    const run = (e: Experiment) => { const sim = new NetdevSimulator(e.topology); const r = sim.simulate(e.scenarios); renderDevices(e.topology); renderFlows(r); renderMac(r.macTables); renderEvents(r.events); };
    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) load(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) run(e); });
    load(EXPERIMENTS[0]!);
  }
}
