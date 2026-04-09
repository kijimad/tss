/**
 * igp.ts — Interior Gateway Protocol シミュレーション
 *
 * OSPF (リンクステート / ダイクストラ法) と
 * RIP (距離ベクトル / ベルマンフォード) を同一トポロジで比較。
 *
 * ルータ間のリンクコスト・障害・復旧をシミュレートし、
 * 経路テーブルの収束過程をトレースする。
 */

// ── トポロジ定義 ──

export interface Router {
  id: string;
  name: string;
  /** Canvas 描画用座標 */
  x: number;
  y: number;
  area?: number;
}

export interface Link {
  from: string;
  to: string;
  cost: number;
  bandwidth: string;
  up: boolean;
}

export interface Topology {
  routers: Router[];
  links: Link[];
}

// ── 経路テーブル ──

export interface RouteEntry {
  destination: string;
  nextHop: string;
  metric: number;
  /** OSPF: コスト, RIP: ホップ数 */
  via: string;
}

// ── トレース ──

export interface IgpTrace {
  tick: number;
  phase: "init" | "hello" | "lsa_flood" | "spf_calc" | "route_update" | "dv_send" | "dv_recv" | "converged" | "link_down" | "link_up" | "poison";
  router: string;
  detail: string;
}

// ── OSPF ──

export interface OspfState {
  routerId: string;
  /** LSDB: 全ルータのリンク情報 */
  lsdb: Map<string, { neighbors: { id: string; cost: number }[] }>;
  routingTable: RouteEntry[];
}

/** OSPF シミュレーションの結果 */
export interface OspfResult {
  states: Map<string, OspfState>;
  trace: IgpTrace[];
  convergedAt: number;
}

/** ダイクストラ法で最短経路ツリーを計算する */
export function dijkstra(
  source: string,
  lsdb: Map<string, { neighbors: { id: string; cost: number }[] }>,
): { dist: Map<string, number>; prev: Map<string, string | null> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const id of lsdb.keys()) {
    dist.set(id, Infinity);
    prev.set(id, null);
  }
  dist.set(source, 0);

  while (true) {
    let u: string | null = null;
    let minDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < minDist) {
        minDist = d;
        u = id;
      }
    }
    if (u === null) break;
    visited.add(u);

    const entry = lsdb.get(u);
    if (entry === undefined) continue;
    for (const neighbor of entry.neighbors) {
      if (visited.has(neighbor.id)) continue;
      const alt = minDist + neighbor.cost;
      if (alt < (dist.get(neighbor.id) ?? Infinity)) {
        dist.set(neighbor.id, alt);
        prev.set(neighbor.id, u);
      }
    }
  }

  return { dist, prev };
}

/** prev マップから next-hop を逆算する */
function getNextHop(source: string, dest: string, prev: Map<string, string | null>): string {
  let current = dest;
  while (true) {
    const p = prev.get(current);
    if (p === null || p === undefined || p === source) return current;
    current = p;
  }
}

/** OSPF シミュレーションを実行する */
export function simulateOspf(topology: Topology): OspfResult {
  const trace: IgpTrace[] = [];
  let tick = 0;

  // 1. 初期化: 各ルータの LSDB を構築
  const states = new Map<string, OspfState>();
  for (const router of topology.routers) {
    states.set(router.id, {
      routerId: router.id,
      lsdb: new Map(),
      routingTable: [],
    });
  }

  // 2. Hello パケット交換 (隣接関係確立)
  tick++;
  for (const router of topology.routers) {
    const neighbors = topology.links
      .filter((l) => l.up && (l.from === router.id || l.to === router.id))
      .map((l) => (l.from === router.id ? l.to : l.from));
    trace.push({ tick, phase: "hello", router: router.id, detail: `Hello 送信 → 隣接: ${neighbors.join(", ") || "(なし)"}` });
  }

  // 3. LSA フラッディング
  tick++;
  const globalLsdb = new Map<string, { neighbors: { id: string; cost: number }[] }>();

  for (const router of topology.routers) {
    const neighbors: { id: string; cost: number }[] = [];
    for (const link of topology.links) {
      if (!link.up) continue;
      if (link.from === router.id) neighbors.push({ id: link.to, cost: link.cost });
      else if (link.to === router.id) neighbors.push({ id: link.from, cost: link.cost });
    }
    globalLsdb.set(router.id, { neighbors });
    trace.push({ tick, phase: "lsa_flood", router: router.id, detail: `LSA 生成: ${neighbors.map((n) => `→${n.id}(cost=${n.cost})`).join(", ") || "(隣接なし)"}` });
  }

  // 全ルータの LSDB を同期 (フラッディング完了)
  tick++;
  for (const [routerId, state] of states) {
    state.lsdb = new Map(globalLsdb);
    trace.push({ tick, phase: "lsa_flood", router: routerId, detail: `LSDB 同期完了 (${state.lsdb.size} エントリ)` });
  }

  // 4. SPF 計算 (ダイクストラ法)
  tick++;
  for (const [routerId, state] of states) {
    const { dist, prev } = dijkstra(routerId, state.lsdb);
    const table: RouteEntry[] = [];
    for (const [destId, cost] of dist) {
      if (destId === routerId) continue;
      if (cost === Infinity) continue;
      const nextHop = getNextHop(routerId, destId, prev);
      table.push({ destination: destId, nextHop, metric: cost, via: nextHop });
    }
    state.routingTable = table;
    trace.push({
      tick, phase: "spf_calc", router: routerId,
      detail: `SPF 完了: ${table.map((r) => `${r.destination}→${r.nextHop}(${r.metric})`).join(", ")}`,
    });
  }

  trace.push({ tick, phase: "converged", router: "*", detail: `OSPF 収束完了 (tick=${tick})` });

  return { states, trace, convergedAt: tick };
}

// ── RIP ──

export interface RipState {
  routerId: string;
  /** 距離ベクトルテーブル: destination → { metric, nextHop } */
  distanceVector: Map<string, { metric: number; nextHop: string }>;
  routingTable: RouteEntry[];
}

export interface RipResult {
  states: Map<string, RipState>;
  trace: IgpTrace[];
  convergedAt: number;
  /** 各 tick のスナップショット */
  snapshots: { tick: number; tables: Map<string, RouteEntry[]> }[];
}

/** RIP シミュレーションを実行する */
export function simulateRip(topology: Topology, maxTicks = 20): RipResult {
  const trace: IgpTrace[] = [];
  const snapshots: { tick: number; tables: Map<string, RouteEntry[]> }[] = [];

  // 初期化
  const states = new Map<string, RipState>();
  for (const router of topology.routers) {
    const dv = new Map<string, { metric: number; nextHop: string }>();
    dv.set(router.id, { metric: 0, nextHop: "-" });
    states.set(router.id, { routerId: router.id, distanceVector: dv, routingTable: [] });
  }

  let tick = 0;
  let convergedAt = 0;

  // ベルマンフォード反復
  for (let iter = 0; iter < maxTicks; iter++) {
    tick++;
    let changed = false;

    // 各ルータが隣接ルータに DV を送信
    for (const router of topology.routers) {
      const state = states.get(router.id)!;
      const neighbors = topology.links
        .filter((l) => l.up && (l.from === router.id || l.to === router.id))
        .map((l) => ({
          id: l.from === router.id ? l.to : l.from,
          cost: l.from === router.id ? l.cost : l.cost,
        }));

      trace.push({
        tick, phase: "dv_send", router: router.id,
        detail: `DV 送信 (${state.distanceVector.size} エントリ) → ${neighbors.map((n) => n.id).join(", ")}`,
      });

      // 隣接ルータが受信して更新
      for (const neighbor of neighbors) {
        const neighborState = states.get(neighbor.id)!;

        for (const [dest, entry] of state.distanceVector) {
          const newMetric = entry.metric + neighbor.cost;
          if (newMetric >= 16) continue; // RIP の無限大 = 16

          const current = neighborState.distanceVector.get(dest);
          if (current === undefined || newMetric < current.metric) {
            neighborState.distanceVector.set(dest, { metric: newMetric, nextHop: router.id });
            changed = true;
            trace.push({
              tick, phase: "dv_recv", router: neighbor.id,
              detail: `${dest} の経路更新: metric ${current?.metric ?? "∞"} → ${newMetric} via ${router.id}`,
            });
          }
        }
      }
    }

    // ルーティングテーブル生成
    for (const [routerId, state] of states) {
      state.routingTable = [];
      for (const [dest, entry] of state.distanceVector) {
        if (dest === routerId) continue;
        state.routingTable.push({ destination: dest, nextHop: entry.nextHop, metric: entry.metric, via: entry.nextHop });
      }
    }

    // スナップショット保存
    const tables = new Map<string, RouteEntry[]>();
    for (const [id, state] of states) tables.set(id, [...state.routingTable]);
    snapshots.push({ tick, tables });

    if (!changed) {
      convergedAt = tick;
      trace.push({ tick, phase: "converged", router: "*", detail: `RIP 収束完了 (tick=${tick}, ${iter + 1} 反復)` });
      break;
    }
    convergedAt = tick;
  }

  return { states, trace, convergedAt, snapshots };
}

// ── リンク障害シミュレーション ──

/** リンクをダウンさせて再計算する */
export function simulateLinkFailure(
  topology: Topology,
  failFrom: string,
  failTo: string,
): { ospf: OspfResult; rip: RipResult; trace: IgpTrace[] } {
  const trace: IgpTrace[] = [];

  // リンクダウン
  const failedTopology: Topology = {
    routers: topology.routers,
    links: topology.links.map((l) => {
      if ((l.from === failFrom && l.to === failTo) || (l.from === failTo && l.to === failFrom)) {
        return { ...l, up: false };
      }
      return l;
    }),
  };

  trace.push({ tick: 0, phase: "link_down", router: failFrom, detail: `リンク ${failFrom}↔${failTo} ダウン` });

  // 再計算
  const ospfAfter = simulateOspf(failedTopology);
  const ripAfter = simulateRip(failedTopology);

  return {
    ospf: ospfAfter,
    rip: ripAfter,
    trace: [...trace, ...ospfAfter.trace, ...ripAfter.trace],
  };
}
