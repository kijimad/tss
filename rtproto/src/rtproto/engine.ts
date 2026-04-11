/* ルーティングプロトコル シミュレーションエンジン */

import type {
  Router, Link, RouteEntry, Protocol,
  OspfLsa, BgpAttributes, BgpPeer, BgpRoute,
  SimOp, SimEvent, SimulationResult,
} from "./types.js";
import { ADMIN_DISTANCE } from "./types.js";

// ─── ユーティリティ ───

/** ルーター生成 */
export function mkRouter(
  id: string, name: string, asNumber: number,
  x: number, y: number, protocols: Protocol[],
  ospfArea = 0,
): Router {
  return {
    id, name, asNumber, x, y,
    protocolRoutes: new Map(),
    rib: [],
    ospfState: { lsdb: [], neighborTable: [], routerId: id },
    bgpState: { peers: [], adjRibIn: [], locRib: [], adjRibOut: [] },
    ripState: {
      distanceVector: new Map(),
      splitHorizon: true,
      poisonReverse: false,
    },
    enabledProtocols: protocols,
    ospfArea,
    isABR: false,
  };
}

/** リンク生成 */
export function mkLink(from: string, to: string, cost: number, bandwidth = 1000): Link {
  return { from, to, cost, bandwidth, status: "up" };
}

/** 隣接ルーター取得 */
function getNeighbors(routerId: string, links: Link[]): Array<{ neighborId: string; cost: number }> {
  const result: Array<{ neighborId: string; cost: number }> = [];
  for (const l of links) {
    if (l.status === "down") continue;
    if (l.from === routerId) result.push({ neighborId: l.to, cost: l.cost });
    if (l.to === routerId) result.push({ neighborId: l.from, cost: l.cost });
  }
  return result;
}

/** ルーターマップ構築 */
function buildRouterMap(routers: Router[]): Map<string, Router> {
  const m = new Map<string, Router>();
  for (const r of routers) m.set(r.id, r);
  return m;
}

// ─── RIP エンジン ───

/** RIP距離ベクトル初期化 */
function ripInit(routers: Router[], links: Link[]): void {
  for (const r of routers) {
    if (!r.enabledProtocols.includes("rip")) continue;
    r.ripState.distanceVector.clear();
    // 自身への距離=0
    r.ripState.distanceVector.set(r.id, { metric: 0, nextHop: r.id, changed: true });
    // 直接接続隣接ルーター
    for (const n of getNeighbors(r.id, links)) {
      r.ripState.distanceVector.set(n.neighborId, {
        metric: 1, nextHop: n.neighborId, changed: true,
      });
    }
  }
}

/** RIPアップデート送受信（1ティック分） */
function ripTick(
  routers: Router[], links: Link[], routerMap: Map<string, Router>,
  events: SimEvent[], ops: SimOp[], tick: number,
): boolean {
  let changed = false;

  for (const r of routers) {
    if (!r.enabledProtocols.includes("rip")) continue;
    const neighbors = getNeighbors(r.id, links);

    for (const n of neighbors) {
      const neighbor = routerMap.get(n.neighborId);
      if (!neighbor || !neighbor.enabledProtocols.includes("rip")) continue;

      // 隣接ルーターのDVを受信
      for (const [dest, entry] of neighbor.ripState.distanceVector) {
        // スプリットホライズン: 学習元へは広告しない
        if (r.ripState.splitHorizon && entry.nextHop === r.id) continue;

        const newMetric = Math.min(entry.metric + 1, 16); // 16=到達不能
        const current = r.ripState.distanceVector.get(dest);

        if (!current || newMetric < current.metric) {
          r.ripState.distanceVector.set(dest, {
            metric: newMetric, nextHop: n.neighborId, changed: true,
          });
          changed = true;
          events.push({
            tick, type: "rip_update",
            message: `${r.name}: ${dest}への経路更新 metric=${newMetric} via ${neighbor.name}`,
            routerId: r.id, protocol: "rip",
          });
        }
      }

      ops.push({ type: "rip_receive_update", routerId: r.id, fromId: n.neighborId });
    }

    ops.push({ type: "rip_send_update", routerId: r.id });
  }

  return changed;
}

/** RIP経路テーブル構築 */
function ripBuildRoutes(routers: Router[], routerMap: Map<string, Router>, tick: number): void {
  for (const r of routers) {
    if (!r.enabledProtocols.includes("rip")) continue;
    const routes: RouteEntry[] = [];

    for (const [dest, entry] of r.ripState.distanceVector) {
      if (dest === r.id || entry.metric >= 16) continue;
      // パス構築（簡易）
      const path = buildPath(r.id, dest, routerMap, "rip");
      routes.push({
        destination: dest, nextHop: entry.nextHop,
        metric: entry.metric, protocol: "rip",
        ad: ADMIN_DISTANCE.rip, path, learnedAt: tick,
      });
    }
    r.protocolRoutes.set("rip", routes);
  }
}

// ─── OSPF エンジン ───

/** OSPF Hello / LSA初期化 */
function ospfInit(routers: Router[], links: Link[], events: SimEvent[], ops: SimOp[]): void {
  for (const r of routers) {
    if (!r.enabledProtocols.includes("ospf")) continue;

    // Hello送信 → 隣接関係確立
    const neighbors = getNeighbors(r.id, links);
    r.ospfState.neighborTable = neighbors.map(n => ({
      routerId: n.neighborId, state: "full" as const,
    }));

    ops.push({ type: "ospf_send_hello", routerId: r.id });
    events.push({
      tick: 0, type: "ospf_hello",
      message: `${r.name}: Hello送信 → ${neighbors.length}隣接確立`,
      routerId: r.id, protocol: "ospf",
    });

    // Router LSA生成
    const lsa: OspfLsa = {
      type: "router", originRouter: r.id, area: r.ospfArea,
      linkStateId: r.id,
      neighbors: neighbors.map(n => ({ routerId: n.neighborId, cost: n.cost })),
      sequence: 1, age: 0,
    };
    r.ospfState.lsdb.push(lsa);
    ops.push({ type: "ospf_flood_lsa", routerId: r.id, lsa });
  }
}

/** OSPF LSAフラッディング */
function ospfFloodLsas(
  routers: Router[], links: Link[], routerMap: Map<string, Router>,
  events: SimEvent[], _ops: SimOp[],
): void {
  // 全ルーターのLSAを全隣接に配布
  for (const r of routers) {
    if (!r.enabledProtocols.includes("ospf")) continue;
    for (const src of routers) {
      if (src.id === r.id) continue;
      if (!src.enabledProtocols.includes("ospf")) continue;
      // 同一エリアまたはABR経由
      const sameArea = src.ospfArea === r.ospfArea;
      const viaABR = src.isABR || r.isABR;
      if (!sameArea && !viaABR) continue;

      for (const lsa of src.ospfState.lsdb) {
        const exists = r.ospfState.lsdb.find(
          l => l.originRouter === lsa.originRouter && l.linkStateId === lsa.linkStateId
        );
        if (!exists) {
          // ABR → Summary LSA変換
          if (!sameArea && (src.isABR || r.isABR)) {
            const summaryLsa: OspfLsa = {
              ...lsa, type: "summary", area: r.ospfArea,
            };
            r.ospfState.lsdb.push(summaryLsa);
          } else {
            r.ospfState.lsdb.push({ ...lsa });
          }
        }
      }
    }
  }

  // 隣接ルーターのLSAも直接追加（リンク情報から）
  for (const r of routers) {
    if (!r.enabledProtocols.includes("ospf")) continue;
    const neighbors = getNeighbors(r.id, links);
    for (const n of neighbors) {
      const nr = routerMap.get(n.neighborId);
      if (!nr || !nr.enabledProtocols.includes("ospf")) continue;
      for (const lsa of nr.ospfState.lsdb) {
        const exists = r.ospfState.lsdb.find(
          l => l.originRouter === lsa.originRouter && l.linkStateId === lsa.linkStateId
        );
        if (!exists) {
          r.ospfState.lsdb.push({ ...lsa });
        }
      }
    }
  }

  events.push({
    tick: 1, type: "ospf_lsa",
    message: `LSAフラッディング完了: 全ルーターのLSDBを同期`,
    protocol: "ospf",
  });
}

/** OSPF SPF計算（Dijkstra） */
function ospfRunSpf(
  router: Router, _routers: Router[], links: Link[],
  events: SimEvent[], ops: SimOp[], tick: number,
): void {
  if (!router.enabledProtocols.includes("ospf")) return;

  // LSDBからグラフを構築
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(router.id, 0);
  const queue = new Set<string>();

  // LSDBに含まれる全ルーターを候補に
  for (const lsa of router.ospfState.lsdb) {
    queue.add(lsa.originRouter);
    for (const n of lsa.neighbors) queue.add(n.routerId);
  }
  queue.add(router.id);

  // Dijkstra
  while (true) {
    let u: string | null = null;
    let minDist = Infinity;
    for (const node of queue) {
      if (visited.has(node)) continue;
      const d = dist.get(node) ?? Infinity;
      if (d < minDist) { minDist = d; u = node; }
    }
    if (u === null || minDist === Infinity) break;
    visited.add(u);

    // uのLSAから隣接を探す
    const lsa = router.ospfState.lsdb.find(l => l.originRouter === u);
    if (!lsa) continue;

    for (const neighbor of lsa.neighbors) {
      // リンクが生きているか確認
      const linkAlive = links.some(l =>
        l.status === "up" && (
          (l.from === u && l.to === neighbor.routerId) ||
          (l.to === u && l.from === neighbor.routerId)
        )
      );
      if (!linkAlive) continue;

      const alt = minDist + neighbor.cost;
      const cur = dist.get(neighbor.routerId) ?? Infinity;
      if (alt < cur) {
        dist.set(neighbor.routerId, alt);
        prev.set(neighbor.routerId, u!);
      }
    }
  }

  // 経路テーブル構築
  const routes: RouteEntry[] = [];
  for (const [destId, cost] of dist) {
    if (destId === router.id) continue;
    // パス逆順構築
    const path: string[] = [];
    let cur: string | undefined = destId;
    while (cur && cur !== router.id) {
      path.unshift(cur);
      cur = prev.get(cur);
    }
    if (cur !== router.id) continue; // 到達不能
    path.unshift(router.id);

    // 次ホップ
    const nextHop = path.length > 1 ? path[1]! : destId;
    routes.push({
      destination: destId, nextHop, metric: cost,
      protocol: "ospf", ad: ADMIN_DISTANCE.ospf,
      path, learnedAt: tick,
    });
  }

  router.protocolRoutes.set("ospf", routes);
  ops.push({ type: "ospf_run_spf", routerId: router.id });
  events.push({
    tick, type: "ospf_spf",
    message: `${router.name}: SPF計算完了 → ${routes.length}経路算出`,
    routerId: router.id, protocol: "ospf",
  });
}

// ─── BGP エンジン ───

/** BGPピア確立 */
function bgpEstablishPeers(
  routers: Router[], links: Link[], routerMap: Map<string, Router>,
  events: SimEvent[], ops: SimOp[],
): void {
  for (const r of routers) {
    if (!r.enabledProtocols.includes("bgp")) continue;
    const neighbors = getNeighbors(r.id, links);

    for (const n of neighbors) {
      const nr = routerMap.get(n.neighborId);
      if (!nr || !nr.enabledProtocols.includes("bgp")) continue;

      // ピアが既に存在するか
      const exists = r.bgpState.peers.find(p => p.peerId === nr.id);
      if (exists) continue;

      const peerType = r.asNumber === nr.asNumber ? "ibgp" : "ebgp";
      const peer: BgpPeer = {
        peerId: nr.id, peerAs: nr.asNumber, localAs: r.asNumber,
        type: peerType, state: "established",
        receivedRoutes: [], advertisedRoutes: [],
      };
      r.bgpState.peers.push(peer);

      ops.push({ type: "bgp_open", peerId: nr.id, routerId: r.id });
      events.push({
        tick: 0, type: "bgp_open",
        message: `${r.name}: BGP ${peerType}ピア確立 → ${nr.name} (AS${nr.asNumber})`,
        routerId: r.id, protocol: "bgp",
      });
    }
  }
}

/** BGPアップデート送受信 */
function bgpExchangeUpdates(
  routers: Router[], routerMap: Map<string, Router>,
  events: SimEvent[], ops: SimOp[], tick: number,
): boolean {
  let changed = false;

  for (const r of routers) {
    if (!r.enabledProtocols.includes("bgp")) continue;

    for (const peer of r.bgpState.peers) {
      const peerRouter = routerMap.get(peer.peerId);
      if (!peerRouter) continue;

      // ピアのlocRibから経路を受信
      for (const route of peerRouter.bgpState.locRib) {
        // eBGP: ASパスにループがないか確認
        if (route.attrs.asPath.includes(r.asNumber)) continue;

        const existing = r.bgpState.adjRibIn.find(
          ri => ri.prefix === route.prefix &&
            ri.attrs.nextHop === peerRouter.id
        );
        if (existing) continue;

        // 属性修正
        const newAttrs: BgpAttributes = {
          ...route.attrs,
          asPath: peer.type === "ebgp"
            ? [peerRouter.asNumber, ...route.attrs.asPath]
            : [...route.attrs.asPath],
          nextHop: peerRouter.id,
          // iBGPではlocalPrefを保持、eBGPではデフォルト100
          localPref: peer.type === "ibgp" ? route.attrs.localPref : 100,
          med: route.attrs.med,
        };

        const bgpRoute: BgpRoute = {
          prefix: route.prefix, attrs: newAttrs,
          bestPath: false, validRoute: true,
        };
        r.bgpState.adjRibIn.push(bgpRoute);
        peer.receivedRoutes.push(bgpRoute);
        changed = true;

        events.push({
          tick, type: "bgp_update",
          message: `${r.name}: BGP UPDATE受信 ${route.prefix} from ${peerRouter.name} AS-Path=[${newAttrs.asPath.join(",")}]`,
          routerId: r.id, protocol: "bgp",
        });
      }

      ops.push({ type: "bgp_update_recv", routerId: r.id, fromId: peer.peerId });
    }
  }

  return changed;
}

/** BGP経路選択アルゴリズム */
function bgpBestPathSelection(
  routers: Router[], events: SimEvent[], ops: SimOp[], tick: number,
): void {
  for (const r of routers) {
    if (!r.enabledProtocols.includes("bgp")) continue;

    // 自身をoriginとする経路
    const selfRoute: BgpRoute = {
      prefix: r.id,
      attrs: {
        asPath: [], localPref: 100, med: 0,
        origin: "igp", nextHop: r.id, community: [],
      },
      bestPath: true, validRoute: true,
    };

    // 全候補をプレフィックスごとにグループ化
    const prefixMap = new Map<string, BgpRoute[]>();
    for (const route of [selfRoute, ...r.bgpState.adjRibIn]) {
      if (!route.validRoute) continue;
      const list = prefixMap.get(route.prefix) ?? [];
      list.push(route);
      prefixMap.set(route.prefix, list);
    }

    const newLocRib: BgpRoute[] = [];
    for (const [prefix, candidates] of prefixMap) {
      if (prefix === r.id) {
        newLocRib.push(selfRoute);
        continue;
      }
      // BGP経路選択（簡略版）
      // 1. 最大Local Preference
      // 2. 最短AS Path
      // 3. 最小MED
      // 4. eBGP優先
      // 5. 最小Router ID（タイブレーク）
      const sorted = [...candidates].sort((a, b) => {
        // 1. Local Preference（大きいほうが優先）
        if (a.attrs.localPref !== b.attrs.localPref) {
          return b.attrs.localPref - a.attrs.localPref;
        }
        // 2. AS Path長（短いほうが優先）
        if (a.attrs.asPath.length !== b.attrs.asPath.length) {
          return a.attrs.asPath.length - b.attrs.asPath.length;
        }
        // 3. Origin（igp < egp < incomplete）
        const originOrder = { igp: 0, egp: 1, incomplete: 2 };
        if (originOrder[a.attrs.origin] !== originOrder[b.attrs.origin]) {
          return originOrder[a.attrs.origin] - originOrder[b.attrs.origin];
        }
        // 4. MED（小さいほうが優先、同一ASからのみ比較）
        if (a.attrs.med !== b.attrs.med) {
          return a.attrs.med - b.attrs.med;
        }
        // 5. NextHop（タイブレーク）
        return a.attrs.nextHop.localeCompare(b.attrs.nextHop);
      });

      const best = sorted[0];
      if (best) {
        best.bestPath = true;
        newLocRib.push(best);

        events.push({
          tick, type: "bgp_decision",
          message: `${r.name}: ${prefix}のベストパス選択 LP=${best.attrs.localPref} ASPath=[${best.attrs.asPath.join(",")}] via ${best.attrs.nextHop}`,
          routerId: r.id, protocol: "bgp",
        });
      }
    }

    r.bgpState.locRib = newLocRib;
    r.bgpState.adjRibOut = newLocRib.filter(rt => rt.prefix !== r.id);

    // protocolRoutesに変換
    const routes: RouteEntry[] = newLocRib
      .filter(rt => rt.prefix !== r.id)
      .map(rt => ({
        destination: rt.prefix,
        nextHop: rt.attrs.nextHop,
        metric: rt.attrs.asPath.length,
        protocol: "bgp" as Protocol,
        ad: r.bgpState.peers.find(p => p.peerId === rt.attrs.nextHop)?.type === "ibgp" ? 200 : ADMIN_DISTANCE.bgp,
        path: [r.id, ...rt.attrs.asPath.map(String)],
        bgpAttrs: rt.attrs,
        learnedAt: tick,
      }));
    r.protocolRoutes.set("bgp", routes);

    ops.push({ type: "bgp_best_path", routerId: r.id });
  }
}

// ─── スタティックルート ───

/** スタティック経路の設定 */
export function addStaticRoute(
  router: Router, destination: string, nextHop: string, metric = 0,
): void {
  const routes = router.protocolRoutes.get("static") ?? [];
  routes.push({
    destination, nextHop, metric,
    protocol: "static", ad: ADMIN_DISTANCE.static,
    path: [router.id, nextHop, destination],
    learnedAt: 0,
  });
  router.protocolRoutes.set("static", routes);
}

// ─── RIB統合 ───

/** 全プロトコルの経路からRIB（最良経路）を構築 */
function buildRib(router: Router, events: SimEvent[], ops: SimOp[], tick: number): void {
  const bestRoutes = new Map<string, RouteEntry>();

  for (const proto of router.enabledProtocols) {
    const routes = router.protocolRoutes.get(proto) ?? [];
    for (const route of routes) {
      const existing = bestRoutes.get(route.destination);
      if (!existing || route.ad < existing.ad ||
          (route.ad === existing.ad && route.metric < existing.metric)) {
        bestRoutes.set(route.destination, route);
      }
    }
  }

  const newRib = [...bestRoutes.values()];

  // 変更検出
  const oldDests = new Set(router.rib.map(r => `${r.destination}:${r.protocol}:${r.nextHop}`));
  const newDests = new Set(newRib.map(r => `${r.destination}:${r.protocol}:${r.nextHop}`));

  let changed = false;
  for (const d of newDests) {
    if (!oldDests.has(d)) changed = true;
  }
  for (const d of oldDests) {
    if (!newDests.has(d)) changed = true;
  }

  if (changed) {
    router.rib = newRib;
    ops.push({ type: "rib_update", routerId: router.id, protocol: router.enabledProtocols[0]! });
    events.push({
      tick, type: "rib_install",
      message: `${router.name}: RIB更新 → ${newRib.length}経路 (AD比較でベスト選択)`,
      routerId: router.id,
    });
  } else {
    router.rib = newRib;
  }
}

// ─── 経路パス構築 ───

/** 再帰的パス構築 */
function buildPath(
  src: string, dst: string, routerMap: Map<string, Router>, _proto: Protocol,
): string[] {
  const path = [src];
  const visited = new Set<string>();
  visited.add(src);
  let cur = src;

  for (let i = 0; i < 20; i++) {
    const r = routerMap.get(cur);
    if (!r) break;
    const dv = r.ripState.distanceVector.get(dst);
    if (!dv) break;
    if (visited.has(dv.nextHop)) break;
    visited.add(dv.nextHop);
    path.push(dv.nextHop);
    if (dv.nextHop === dst) break;
    cur = dv.nextHop;
  }

  return path;
}

// ─── リンク障害 ───

/** リンク障害処理 */
function processLinkChange(
  op: SimOp & { type: "link_down" | "link_up" },
  links: Link[], events: SimEvent[], tick: number,
): void {
  const status = op.type === "link_down" ? "down" : "up";
  for (const l of links) {
    if ((l.from === op.from && l.to === op.to) ||
        (l.from === op.to && l.to === op.from)) {
      l.status = status;
    }
  }
  events.push({
    tick, type: "link_change",
    message: `リンク ${op.from}↔${op.to} が${status === "down" ? "ダウン" : "復旧"}`,
  });
}

// ─── 再配布 ───

/** プロトコル間の経路再配布 */
function redistribute(
  router: Router, from: Protocol, to: Protocol,
  events: SimEvent[], ops: SimOp[], tick: number,
): void {
  const srcRoutes = router.protocolRoutes.get(from) ?? [];
  const dstRoutes = router.protocolRoutes.get(to) ?? [];

  for (const route of srcRoutes) {
    const exists = dstRoutes.find(r => r.destination === route.destination);
    if (exists) continue;

    dstRoutes.push({
      ...route,
      protocol: to,
      ad: ADMIN_DISTANCE[to],
      learnedAt: tick,
    });

    events.push({
      tick, type: "redistribute",
      message: `${router.name}: ${from}→${to} 再配布 ${route.destination}`,
      routerId: router.id,
      detail: `metric=${route.metric}`,
    });
  }

  router.protocolRoutes.set(to, dstRoutes);
  ops.push({ type: "redistribute", from, to, routerId: router.id });
}

// ─── メインシミュレーション ───

/** シミュレーション実行 */
export function simulate(
  routers: Router[], links: Link[], ops: SimOp[],
): SimulationResult {
  const events: SimEvent[] = [];
  const allOps: SimOp[] = [];
  const routerMap = buildRouterMap(routers);
  const convergence: Partial<Record<Protocol, number>> = {};

  // プロトコル別初期化
  const hasRip = routers.some(r => r.enabledProtocols.includes("rip"));
  const hasOspf = routers.some(r => r.enabledProtocols.includes("ospf"));
  const hasBgp = routers.some(r => r.enabledProtocols.includes("bgp"));

  // 操作のうちlink_down/link_upを抽出（特定tickで適用）
  const linkOps = ops.filter(o => o.type === "link_down" || o.type === "link_up") as Array<SimOp & { type: "link_down" | "link_up" }>;
  const redistributeOps = ops.filter(o => o.type === "redistribute") as Array<SimOp & { type: "redistribute" }>;

  events.push({
    tick: 0, type: "info",
    message: `トポロジ初期化: ${routers.length}ルーター, ${links.length}リンク`,
  });

  let tick = 0;

  // ─── Phase 1: OSPF ───
  if (hasOspf) {
    ospfInit(routers, links, events, allOps);
    ospfFloodLsas(routers, links, routerMap, events, allOps);
    tick = 2;
    for (const r of routers) {
      ospfRunSpf(r, routers, links, events, allOps, tick);
    }
    convergence.ospf = tick;
    events.push({
      tick, type: "ospf_converge",
      message: `OSPF収束完了 (tick=${tick})`,
      protocol: "ospf",
    });
  }

  // ─── Phase 2: RIP ───
  if (hasRip) {
    ripInit(routers, links);
    tick = Math.max(tick, 1);
    const maxTicks = 20;
    let ripConverged = false;

    for (let t = 0; t < maxTicks; t++) {
      tick++;
      const changed = ripTick(routers, links, routerMap, events, allOps, tick);
      if (!changed) {
        ripConverged = true;
        convergence.rip = tick;
        events.push({
          tick, type: "rip_converge",
          message: `RIP収束完了 (tick=${tick}, ${t + 1}反復)`,
          protocol: "rip",
        });
        break;
      }
    }
    if (!ripConverged) {
      convergence.rip = tick;
    }
    ripBuildRoutes(routers, routerMap, tick);
  }

  // ─── Phase 3: BGP ───
  if (hasBgp) {
    bgpEstablishPeers(routers, links, routerMap, events, allOps);

    // 自身のプレフィックス（ルーターID）をlocRibに追加
    for (const r of routers) {
      if (!r.enabledProtocols.includes("bgp")) continue;
      r.bgpState.locRib.push({
        prefix: r.id,
        attrs: {
          asPath: [], localPref: 100, med: 0,
          origin: "igp", nextHop: r.id, community: [],
        },
        bestPath: true, validRoute: true,
      });
    }

    tick = Math.max(tick, 1);
    const maxRounds = 10;
    for (let round = 0; round < maxRounds; round++) {
      tick++;
      const changed = bgpExchangeUpdates(routers, routerMap, events, allOps, tick);
      bgpBestPathSelection(routers, events, allOps, tick);
      if (!changed) {
        convergence.bgp = tick;
        events.push({
          tick, type: "bgp_converge",
          message: `BGP収束完了 (tick=${tick}, ${round + 1}ラウンド)`,
          protocol: "bgp",
        });
        break;
      }
    }
    if (!convergence.bgp) convergence.bgp = tick;
  }

  // ─── Phase 4: リンク障害処理 ───
  for (const lop of linkOps) {
    tick++;
    processLinkChange(lop, links, events, tick);

    // 再収束
    if (hasOspf) {
      // LSDBクリア＆再構築
      for (const r of routers) {
        if (!r.enabledProtocols.includes("ospf")) continue;
        r.ospfState.lsdb = [];
      }
      ospfInit(routers, links, events, allOps);
      ospfFloodLsas(routers, links, routerMap, events, allOps);
      tick++;
      for (const r of routers) {
        ospfRunSpf(r, routers, links, events, allOps, tick);
      }
      events.push({
        tick, type: "ospf_converge",
        message: `OSPF再収束完了 (リンク障害後)`,
        protocol: "ospf",
      });
    }

    if (hasRip) {
      // RIPリセット＆再収束
      ripInit(routers, links);
      for (let t = 0; t < 15; t++) {
        tick++;
        const changed = ripTick(routers, links, routerMap, events, allOps, tick);
        if (!changed) break;
      }
      ripBuildRoutes(routers, routerMap, tick);
      events.push({
        tick, type: "rip_converge",
        message: `RIP再収束完了 (リンク障害後)`,
        protocol: "rip",
      });
    }

    if (hasBgp) {
      // BGPピアリセット＆再収束
      for (const r of routers) {
        if (!r.enabledProtocols.includes("bgp")) continue;
        r.bgpState.adjRibIn = [];
        r.bgpState.locRib = [{
          prefix: r.id,
          attrs: {
            asPath: [], localPref: 100, med: 0,
            origin: "igp", nextHop: r.id, community: [],
          },
          bestPath: true, validRoute: true,
        }];
        r.bgpState.peers = [];
      }
      bgpEstablishPeers(routers, links, routerMap, events, allOps);
      for (let round = 0; round < 10; round++) {
        tick++;
        const changed = bgpExchangeUpdates(routers, routerMap, events, allOps, tick);
        bgpBestPathSelection(routers, events, allOps, tick);
        if (!changed) break;
      }
    }
  }

  // ─── Phase 5: 再配布 ───
  for (const rdOp of redistributeOps) {
    if (rdOp.type !== "redistribute") continue;
    tick++;
    const r = routerMap.get(rdOp.routerId);
    if (r) {
      redistribute(r, rdOp.from, rdOp.to, events, allOps, tick);
    }
  }

  // ─── Phase 6: RIB構築 ───
  tick++;
  for (const r of routers) {
    buildRib(r, events, allOps, tick);
  }

  return { routers, links, events, ops: allOps, ticks: tick, convergence };
}
