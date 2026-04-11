import type { Preset, Host, Router } from "./types.js";

const hostA: Host = { name: "HostA", ip: "192.168.1.10", joinedGroups: [], iface: "eth0" };
const hostB: Host = { name: "HostB", ip: "192.168.1.20", joinedGroups: [], iface: "eth0" };
const hostC: Host = { name: "HostC", ip: "192.168.1.30", joinedGroups: [], iface: "eth0" };
const hostD: Host = { name: "HostD", ip: "192.168.2.10", joinedGroups: [], iface: "eth0" };
const hostE: Host = { name: "HostE", ip: "192.168.2.20", joinedGroups: [], iface: "eth0" };
const sender: Host = { name: "Sender", ip: "10.0.0.1", joinedGroups: [], iface: "eth0" };

const router1: Router = {
  name: "Router1", ip: "192.168.1.1",
  interfaces: [
    { name: "eth0", ip: "192.168.1.1", groups: [] },
    { name: "eth1", ip: "192.168.2.1", groups: [] },
    { name: "wan0", ip: "10.0.0.254", groups: [] },
  ],
};

export const presets: Preset[] = [
  // 1. IGMPグループ参加
  {
    name: "1. IGMP Join — マルチキャストグループ参加",
    description: "ホストがIGMP Membership Reportを送信してマルチキャストグループに参加。ルーターがグループメンバーシップテーブルを更新。マルチキャストIP→MACアドレス変換も確認。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.30", group: "239.1.1.1" },
    ],
  },

  // 2. マルチキャスト送信と配送
  {
    name: "2. マルチキャスト送信 — グループメンバーへ配送",
    description: "グループ参加後にマルチキャストデータを送信。同じグループに参加している全メンバーにデータが配送される。参加していないホストには届かない。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      // HostCは参加しない
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "Hello Multicast Group!", ttl: 32 },
    ],
  },

  // 3. IGMP Leave — グループ離脱
  {
    name: "3. IGMP Leave — グループ離脱と残存メンバー確認",
    description: "ホストがIGMP Leave Groupメッセージを送信してグループから離脱。離脱後のマルチキャスト送信では、残りのメンバーにのみデータが配送される。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.30", group: "239.1.1.1" },
      { type: "igmp_leave", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "After HostB left", ttl: 32 },
    ],
  },

  // 4. IGMP General Query
  {
    name: "4. IGMP Query — ルーターによるメンバーシップ確認",
    description: "ルーターがGeneral Queryを送信し、サブネット内の全ホストにグループメンバーシップを問い合わせ。各ホストがMembership Reportで応答。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.2.2.2" },
      { type: "igmp_join", hostIp: "192.168.1.30", group: "239.1.1.1" },
      { type: "igmp_query", routerIp: "192.168.1.1" },
    ],
  },

  // 5. 複数グループ
  {
    name: "5. 複数グループ — グループごとの独立配送",
    description: "複数のマルチキャストグループに異なるデータを送信。各グループのメンバーにはそのグループ宛のデータのみが配送される。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.2.2.2" },
      { type: "igmp_join", hostIp: "192.168.1.30", group: "239.2.2.2" },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "Video stream", ttl: 32 },
      { type: "send_multicast", srcIp: "192.168.1.30", srcPort: 6000, group: "239.2.2.2", dstPort: 6000, data: "Audio stream", ttl: 32 },
    ],
  },

  // 6. TTLスコープとホップ制限
  {
    name: "6. TTL スコープ — ホップ制限によるスコープ制御",
    description: "TTL値でマルチキャストの到達範囲を制御。TTL=1はリンクローカル（ルーター越え不可）、TTL=2は1ホップまで、TTL=32はサイトローカル。TTLが0になるとデータグラムは破棄される。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "ttl_expire", srcIp: "192.168.1.20", group: "239.1.1.1", ttl: 1 },
      { type: "ttl_expire", srcIp: "192.168.1.20", group: "239.1.1.1", ttl: 3 },
      { type: "ttl_expire", srcIp: "192.168.1.20", group: "224.0.0.1", ttl: 1 },
    ],
  },

  // 7. リンクローカルマルチキャスト
  {
    name: "7. リンクローカル (224.0.0.x) — サブネット限定",
    description: "224.0.0.0/24のリンクローカルマルチキャストはTTL=1に制限され、ルーターを越えない。OSPF(224.0.0.5)やIGMP(224.0.0.22)などのプロトコルで使用。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "224.0.0.251" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "224.0.0.251" },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5353, group: "224.0.0.251", dstPort: 5353, data: "mDNS query: _http._tcp.local", ttl: 1 },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5353, group: "224.0.0.251", dstPort: 5353, data: "mDNS with wrong TTL", ttl: 5 },
    ],
  },

  // 8. IGMPv3 ソースフィルタリング
  {
    name: "8. IGMPv3 — ソースフィルタリング (SSM)",
    description: "IGMPv3のソース特定マルチキャスト(SSM)。INCLUDEモードで特定ソースのみ受信、EXCLUDEモードで特定ソースを除外。きめ細かいマルチキャスト制御。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_v3_join", hostIp: "192.168.1.10", group: "232.1.1.1", filterMode: "include", sourceList: ["10.0.0.1", "10.0.0.2"] },
      { type: "igmp_v3_join", hostIp: "192.168.1.20", group: "232.1.1.1", filterMode: "exclude", sourceList: ["10.0.0.3"] },
      { type: "igmp_v3_join", hostIp: "192.168.1.30", group: "232.1.1.1", filterMode: "include", sourceList: ["10.0.0.1"] },
    ],
  },

  // 9. マルチキャストルーティング（転送）
  {
    name: "9. マルチキャスト転送 — ルーターによるインターフェース間転送",
    description: "ルーターが異なるインターフェース間でマルチキャストパケットを転送。入力インターフェースで受信し、メンバーが存在する出力インターフェースにのみ転送。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostD },
      { type: "add_host", host: hostE },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.2.10", group: "239.1.1.1" },
      { type: "multicast_forward", routerIp: "192.168.1.1", group: "239.1.1.1", inIface: "wan0", outIfaces: ["eth0", "eth1"] },
    ],
  },

  // 10. ユニキャスト vs マルチキャスト比較
  {
    name: "10. ユニキャスト vs マルチキャスト — 効率比較",
    description: "同じデータを3台のホストに送る場合、ユニキャストでは3回送信が必要だが、マルチキャストでは1回の送信で全メンバーに配送。ネットワーク帯域の効率的な利用。",
    ops: [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_host", host: sender },
      { type: "add_router", router: router1 },
      // ユニキャスト: 3回送信
      { type: "send_unicast", srcIp: "10.0.0.1", srcPort: 5000, dstIp: "192.168.1.10", dstPort: 5000, data: "Stream data (unicast 1/3)" },
      { type: "send_unicast", srcIp: "10.0.0.1", srcPort: 5000, dstIp: "192.168.1.20", dstPort: 5000, data: "Stream data (unicast 2/3)" },
      { type: "send_unicast", srcIp: "10.0.0.1", srcPort: 5000, dstIp: "192.168.1.30", dstPort: 5000, data: "Stream data (unicast 3/3)" },
      // マルチキャスト: 1回送信
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.30", group: "239.1.1.1" },
      { type: "send_multicast", srcIp: "10.0.0.1", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "Stream data (multicast)", ttl: 32 },
    ],
  },
];
