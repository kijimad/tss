/**
 * graph.ts -- ネットワークトポロジ（グラフ構造）とルーティングテーブル計算
 *
 * ============================================================
 * 概要:
 * ============================================================
 * ルータ（ノード）とリンク（エッジ）からなる無向重み付きグラフとしてネットワークを管理する。
 * OSPFなどのリンクステート型ルーティングプロトコルと同様に、ダイクストラ法（Dijkstra's algorithm）
 * で各ルータから他の全ルータへの最短経路を計算し、ルーティングテーブルを構築する。
 *
 * ■ リンクステート型プロトコル (OSPF) の動作原理:
 *   1. 各ルータが自分の隣接情報（リンクステートアドバタイズメント: LSA）をフラッディングで全体に配信
 *   2. 全ルータが同一のトポロジデータベース (LSDB) を保持
 *   3. ダイクストラ法で最短パスツリー (SPT) を計算
 *   4. SPTに基づきルーティングテーブルを生成
 *
 * 本クラスでは手順1-2をaddRouter/addLinkで直接構築し、手順3-4をcomputeAllRoutesで実行する。
 *
 * ■ 隣接リスト (Adjacency List):
 *   グラフの内部表現として隣接リストを使用する。
 *   各ルータIDに対して、隣接するルータとそのリンクコストのリストを保持する。
 *   リンクは双方向（無向グラフ）として扱われる。
 */
import type { Router, Link, RouteEntry } from "./types.js";

/**
 * ネットワークグラフ
 *
 * ルータとリンクの集合をグラフ構造として管理し、
 * ダイクストラ法によるルーティングテーブル計算機能を提供する。
 */
export class NetworkGraph {
  /** 全ルータのマップ（ルータID → Routerオブジェクト） */
  readonly routers: Map<string, Router> = new Map();
  /** 全リンクの配列 */
  readonly links: Link[] = [];
  /**
   * 隣接リスト（ルータID → 隣接ノード情報の配列）
   *
   * グラフ理論における隣接リスト表現。各ルータから直接到達可能な
   * 隣接ルータとそのリンクコスト・リンクIDを保持する。
   * 双方向リンクなので、addLinkで両方向のエントリを追加する。
   */
  private adjacency = new Map<string, { neighbor: string; cost: number; linkId: string }[]>();

  /**
   * ルータをネットワークに追加する。
   * 同時に隣接リストのエントリも初期化する。
   */
  addRouter(router: Router): void {
    this.routers.set(router.id, router);
    if (!this.adjacency.has(router.id)) {
      this.adjacency.set(router.id, []);
    }
  }

  /**
   * リンク（物理接続）をネットワークに追加する。
   *
   * リンクは双方向として扱われるため、from→to と to→from の両方の
   * 隣接リストエントリを追加する。これはイーサネットなどの全二重通信を模している。
   */
  addLink(link: Link): void {
    this.links.push(link);
    // 双方向リンクとして隣接リストの両側に追加
    const fromAdj = this.adjacency.get(link.from);
    if (fromAdj !== undefined) {
      fromAdj.push({ neighbor: link.to, cost: link.cost, linkId: link.id });
    }
    const toAdj = this.adjacency.get(link.to);
    if (toAdj !== undefined) {
      toAdj.push({ neighbor: link.from, cost: link.cost, linkId: link.id });
    }
  }

  /** ルータIDからルータオブジェクトを取得する */
  getRouter(id: string): Router | undefined {
    return this.routers.get(id);
  }

  /**
   * IPアドレスからルータを検索する。
   * 実際のネットワークではARP（アドレス解決プロトコル）がIPアドレスと
   * MACアドレスの対応を解決するが、ここでは単純な線形探索で代替する。
   */
  findRouterByIp(ip: string): Router | undefined {
    for (const [, r] of this.routers) {
      if (r.ip === ip) return r;
    }
    return undefined;
  }

  /**
   * 2つのルータ間の直接リンクを検索する。
   * リンクは双方向なので、from/toの順序に関わらず一致するものを返す。
   */
  findLink(from: string, to: string): Link | undefined {
    return this.links.find(l =>
      (l.from === from && l.to === to) || (l.from === to && l.to === from),
    );
  }

  /**
   * 全ルータのルーティングテーブルを計算する。
   *
   * OSPFのSPF（Shortest Path First）計算に相当する処理。
   * 各ルータを始点としてダイクストラ法を実行し、
   * 他の全ルータへの最短経路とネクストホップを求める。
   *
   * 実際のOSPFでは、トポロジ変更（リンクダウン等）が発生するたびに
   * SPF計算が再実行され、ルーティングテーブルが更新される（コンバージェンス）。
   */
  computeAllRoutes(): void {
    for (const [id] of this.routers) {
      const table = this.dijkstra(id);
      const router = this.routers.get(id);
      if (router !== undefined) {
        router.routingTable = table;
      }
    }
  }

  /**
   * 単一始点最短経路（ダイクストラ法 / Dijkstra's Algorithm）
   *
   * 計算量: O(V^2)（本実装）。優先度付きキューを使うとO((V+E) log V)に改善可能。
   *
   * ■ アルゴリズムの手順:
   *   1. 始点ノードのコストを0、他のノードのコストを∞に初期化
   *   2. 未訪問ノードの中からコスト最小のノードを選択（貪欲法）
   *   3. 選択したノードの隣接ノードに対してコストの緩和（relaxation）を実行
   *   4. 全ノードを訪問するか、到達不能なノードのみになるまで繰り返す
   *   5. 各ノードへの最短経路からルーティングテーブル（ネクストホップ）を構築
   *
   * ■ ネクストホップの決定:
   *   最短パスツリーにおいて、宛先までのパスの2番目のノードがネクストホップとなる。
   *   例: A→B→C→D の場合、Aから見たDへのネクストホップはB。
   *   これがIPルーティングの核心的な仕組み: 各ルータは全経路を知らなくても、
   *   「次の1ホップ」さえ知っていればパケットを正しく転送できる。
   *
   * @param source - 始点ルータのID
   * @returns 始点から他の全ルータへのルーティングテーブルエントリの配列
   */
  private dijkstra(source: string): RouteEntry[] {
    // 各ルータへの最小コスト（距離ベクトル）
    const dist = new Map<string, number>();
    // 最短経路における直前のノード（経路復元用）
    const prev = new Map<string, string>();
    // 未訪問ノードの集合（訪問済みノードは最短距離が確定している）
    const unvisited = new Set<string>();

    // 初期化: 始点のコストを0、それ以外を∞に設定
    for (const [id] of this.routers) {
      dist.set(id, id === source ? 0 : Infinity);
      unvisited.add(id);
    }

    // メインループ: 全ノードの最短距離が確定するまで繰り返す
    while (unvisited.size > 0) {
      // 貪欲選択: 未訪問ノードの中からコスト最小のノードを選択する
      // （優先度付きキューを使わないO(V)の素朴な実装）
      let current: string | undefined;
      let minDist = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id) ?? Infinity;
        if (d < minDist) {
          minDist = d;
          current = id;
        }
      }
      // 到達不能なノードしか残っていなければ終了（非連結グラフの場合）
      if (current === undefined || minDist === Infinity) break;

      // 選択したノードを訪問済みにする（最短距離が確定）
      unvisited.delete(current);

      // 緩和 (Relaxation): 隣接ノードへの経路コストが改善できるか確認
      const neighbors = this.adjacency.get(current) ?? [];
      for (const { neighbor, cost } of neighbors) {
        if (!unvisited.has(neighbor)) continue;
        // 現在のノードを経由した場合のコスト
        const alt = minDist + cost;
        // より低コストの経路が見つかった場合、距離と前ノードを更新
        if (alt < (dist.get(neighbor) ?? Infinity)) {
          dist.set(neighbor, alt);
          prev.set(neighbor, current);
        }
      }
    }

    // ルーティングテーブルを構築: 最短パスツリーからネクストホップを抽出
    const table: RouteEntry[] = [];
    for (const [id] of this.routers) {
      // 始点自身へのエントリは不要
      if (id === source) continue;
      const cost = dist.get(id) ?? Infinity;
      // 到達不能なノードはスキップ（ルーティングテーブルに載せない）
      if (cost === Infinity) continue;

      // 経路復元: prevマップを宛先から始点に向かって逆順に辿る
      const path: string[] = [];
      let node: string | undefined = id;
      while (node !== undefined && node !== source) {
        path.unshift(node);
        node = prev.get(node);
      }
      path.unshift(source);

      // ネクストホップ = パスの2番目のノード（始点の次に転送すべきルータ）
      const nextHop = path[1] ?? id;

      table.push({ destination: id, nextHop, cost, path });
    }

    return table;
  }
}
