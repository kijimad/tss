/**
 * graph.ts -- ネットワークトポロジ（グラフ構造）
 *
 * ルータとリンクからなるグラフを管理する。
 * ダイクストラ法で最短経路を計算し、各ルータのルーティングテーブルを構築する。
 */
import type { Router, Link, RouteEntry } from "./types.js";

export class NetworkGraph {
  readonly routers: Map<string, Router> = new Map();
  readonly links: Link[] = [];
  // ルータID → 隣接リスト
  private adjacency = new Map<string, { neighbor: string; cost: number; linkId: string }[]>();

  addRouter(router: Router): void {
    this.routers.set(router.id, router);
    if (!this.adjacency.has(router.id)) {
      this.adjacency.set(router.id, []);
    }
  }

  addLink(link: Link): void {
    this.links.push(link);
    // 双方向
    const fromAdj = this.adjacency.get(link.from);
    if (fromAdj !== undefined) {
      fromAdj.push({ neighbor: link.to, cost: link.cost, linkId: link.id });
    }
    const toAdj = this.adjacency.get(link.to);
    if (toAdj !== undefined) {
      toAdj.push({ neighbor: link.from, cost: link.cost, linkId: link.id });
    }
  }

  getRouter(id: string): Router | undefined {
    return this.routers.get(id);
  }

  // IP アドレスからルータを検索
  findRouterByIp(ip: string): Router | undefined {
    for (const [, r] of this.routers) {
      if (r.ip === ip) return r;
    }
    return undefined;
  }

  // 2つのルータ間のリンクを検索
  findLink(from: string, to: string): Link | undefined {
    return this.links.find(l =>
      (l.from === from && l.to === to) || (l.from === to && l.to === from),
    );
  }

  // ダイクストラ法で全ルータのルーティングテーブルを計算
  computeAllRoutes(): void {
    for (const [id] of this.routers) {
      const table = this.dijkstra(id);
      const router = this.routers.get(id);
      if (router !== undefined) {
        router.routingTable = table;
      }
    }
  }

  // 単一始点最短経路（ダイクストラ法）
  private dijkstra(source: string): RouteEntry[] {
    // コスト: ルータID → 最小コスト
    const dist = new Map<string, number>();
    // 前のノード: ルータID → 前のルータID
    const prev = new Map<string, string>();
    // 未訪問ノード
    const unvisited = new Set<string>();

    for (const [id] of this.routers) {
      dist.set(id, id === source ? 0 : Infinity);
      unvisited.add(id);
    }

    while (unvisited.size > 0) {
      // 未訪問で最小コストのノードを選ぶ
      let current: string | undefined;
      let minDist = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id) ?? Infinity;
        if (d < minDist) {
          minDist = d;
          current = id;
        }
      }
      if (current === undefined || minDist === Infinity) break;

      unvisited.delete(current);

      // 隣接ノードを更新
      const neighbors = this.adjacency.get(current) ?? [];
      for (const { neighbor, cost } of neighbors) {
        if (!unvisited.has(neighbor)) continue;
        const alt = minDist + cost;
        if (alt < (dist.get(neighbor) ?? Infinity)) {
          dist.set(neighbor, alt);
          prev.set(neighbor, current);
        }
      }
    }

    // ルーティングテーブルを構築
    const table: RouteEntry[] = [];
    for (const [id] of this.routers) {
      if (id === source) continue;
      const cost = dist.get(id) ?? Infinity;
      if (cost === Infinity) continue;

      // パスを逆順に辿る
      const path: string[] = [];
      let node: string | undefined = id;
      while (node !== undefined && node !== source) {
        path.unshift(node);
        node = prev.get(node);
      }
      path.unshift(source);

      // ネクストホップ = パスの2番目のノード
      const nextHop = path[1] ?? id;

      table.push({ destination: id, nextHop, cost, path });
    }

    return table;
  }
}
