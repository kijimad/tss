import { describe, it, expect } from "vitest";
import {
  runSimulation, isMulticastAddr, multicastIpToMac,
  getMulticastScope, ttlInScope,
} from "../udpmcast/engine.js";
import { presets } from "../udpmcast/presets.js";
import type { SimOp, Host, Router } from "../udpmcast/types.js";

const hostA: Host = { name: "A", ip: "192.168.1.10", joinedGroups: [], iface: "eth0" };
const hostB: Host = { name: "B", ip: "192.168.1.20", joinedGroups: [], iface: "eth0" };
const hostC: Host = { name: "C", ip: "192.168.1.30", joinedGroups: [], iface: "eth0" };
const router1: Router = {
  name: "R1", ip: "192.168.1.1",
  interfaces: [{ name: "eth0", ip: "192.168.1.1", groups: [] }],
};

describe("ユーティリティ関数", () => {
  it("マルチキャストアドレス判定: 224.x-239.x", () => {
    expect(isMulticastAddr("224.0.0.1")).toBe(true);
    expect(isMulticastAddr("239.255.255.255")).toBe(true);
    expect(isMulticastAddr("192.168.1.1")).toBe(false);
    expect(isMulticastAddr("240.0.0.1")).toBe(false);
  });

  it("マルチキャストIP→MAC変換", () => {
    expect(multicastIpToMac("224.0.0.1")).toBe("01:00:5e:00:00:01");
    expect(multicastIpToMac("239.1.2.3")).toBe("01:00:5e:01:02:03");
    expect(multicastIpToMac("224.128.1.1")).toBe("01:00:5e:00:01:01");
  });

  it("マルチキャストスコープ判定", () => {
    expect(getMulticastScope("224.0.0.1")).toBe("link_local");
    expect(getMulticastScope("224.0.0.251")).toBe("link_local");
    expect(getMulticastScope("239.1.1.1")).toBe("site_local");
    expect(getMulticastScope("224.1.1.1")).toBe("global");
  });

  it("TTLスコープ検証", () => {
    expect(ttlInScope(1, "link_local")).toBe(true);
    expect(ttlInScope(32, "site_local")).toBe(true);
    expect(ttlInScope(33, "site_local")).toBe(false);
    expect(ttlInScope(1, "global")).toBe(true);
    expect(ttlInScope(0, "global")).toBe(false);
  });
});

describe("IGMPグループ参加/離脱", () => {
  it("IGMP Joinでグループテーブルにメンバー追加", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
    ];
    const result = runSimulation(ops);
    expect(result.groupTable["239.1.1.1"]).toEqual(["192.168.1.10", "192.168.1.20"]);
  });

  it("IGMP Leaveでグループテーブルからメンバー削除", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "igmp_leave", hostIp: "192.168.1.10", group: "239.1.1.1" },
    ];
    const result = runSimulation(ops);
    expect(result.groupTable["239.1.1.1"]).toEqual(["192.168.1.20"]);
  });

  it("全メンバー離脱でグループテーブルからグループ削除", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_leave", hostIp: "192.168.1.10", group: "239.1.1.1" },
    ];
    const result = runSimulation(ops);
    expect(result.groupTable["239.1.1.1"]).toBeUndefined();
  });

  it("IGMPメッセージ数がカウントされる", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.igmpMessages).toBe(1);
  });

  it("重複Joinで同じメンバーが二重登録されない", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
    ];
    const result = runSimulation(ops);
    expect(result.groupTable["239.1.1.1"]).toEqual(["192.168.1.10"]);
  });
});

describe("マルチキャスト送信・配送", () => {
  it("グループメンバーにデータが配送される", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.1.1.1" },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "Hello", ttl: 32 },
    ];
    const result = runSimulation(ops);
    // 送信者以外のメンバー（HostB）に配送
    expect(result.stats.deliveredCount).toBe(1);
  });

  it("グループメンバー外にはデータが配送されない", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_host", host: hostC },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      // HostB, HostCは未参加
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "Data", ttl: 32 },
    ];
    const result = runSimulation(ops);
    // 送信者しかいないので配送なし
    expect(result.stats.deliveredCount).toBe(0);
  });

  it("メンバーなしグループへの送信は破棄される", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.9.9.9", dstPort: 5000, data: "NoOne", ttl: 32 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.droppedCount).toBe(1);
  });

  it("マルチキャストデータグラムが記録される", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "send_multicast", srcIp: "192.168.1.10", srcPort: 5000, group: "239.1.1.1", dstPort: 5000, data: "Test", ttl: 32 },
    ];
    const result = runSimulation(ops);
    expect(result.datagrams.length).toBe(1);
    expect(result.datagrams[0]!.isMulticast).toBe(true);
    expect(result.stats.multicastDatagrams).toBe(1);
  });
});

describe("ユニキャスト", () => {
  it("ユニキャスト送信が配送される", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "send_unicast", srcIp: "192.168.1.10", srcPort: 5000, dstIp: "192.168.1.20", dstPort: 5000, data: "Hello" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.unicastDatagrams).toBe(1);
    expect(result.stats.deliveredCount).toBe(1);
  });

  it("存在しない宛先へのユニキャストは破棄される", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "send_unicast", srcIp: "192.168.1.10", srcPort: 5000, dstIp: "192.168.1.99", dstPort: 5000, data: "Lost" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.droppedCount).toBe(1);
  });
});

describe("TTLとスコープ", () => {
  it("TTL=1のデータグラムは1ホップで期限切れ", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "ttl_expire", srcIp: "192.168.1.10", group: "239.1.1.1", ttl: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.ttlExpired).toBe(1);
  });

  it("TTL=3のデータグラムは3ホップで期限切れ", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "ttl_expire", srcIp: "192.168.1.10", group: "239.1.1.1", ttl: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.ttlExpired).toBe(1);
    const decrements = result.events.filter(e => e.type === "ttl_decrement");
    expect(decrements.length).toBe(3);
  });
});

describe("IGMP Query", () => {
  it("General Queryで全メンバーが応答する", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.2.2.2" },
      { type: "igmp_query", routerIp: "192.168.1.1" },
    ];
    const result = runSimulation(ops);
    const responses = result.events.filter(e => e.type === "igmp_query_response");
    expect(responses.length).toBe(2);
  });

  it("Group-Specific Queryで該当グループのメンバーのみ応答", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_host", host: hostB },
      { type: "add_router", router: router1 },
      { type: "igmp_join", hostIp: "192.168.1.10", group: "239.1.1.1" },
      { type: "igmp_join", hostIp: "192.168.1.20", group: "239.2.2.2" },
      { type: "igmp_query", routerIp: "192.168.1.1", group: "239.1.1.1" },
    ];
    const result = runSimulation(ops);
    const responses = result.events.filter(e => e.type === "igmp_query_response");
    expect(responses.length).toBe(1);
  });
});

describe("IGMPv3ソースフィルタ", () => {
  it("IGMPv3 INCLUDEモードでグループ参加", () => {
    const ops: SimOp[] = [
      { type: "add_host", host: hostA },
      { type: "add_router", router: router1 },
      { type: "igmp_v3_join", hostIp: "192.168.1.10", group: "232.1.1.1", filterMode: "include", sourceList: ["10.0.0.1"] },
    ];
    const result = runSimulation(ops);
    expect(result.groupTable["232.1.1.1"]).toEqual(["192.168.1.10"]);
    const reportEvent = result.events.find(e => e.type === "igmp_report");
    expect(reportEvent?.igmp?.filterMode).toBe("include");
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("プリセット2（マルチキャスト送信）でデータが配送される", () => {
    const p = presets[1]!;
    const result = runSimulation(p.ops);
    expect(result.stats.deliveredCount).toBeGreaterThan(0);
  });
});
