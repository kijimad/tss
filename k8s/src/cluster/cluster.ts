/**
 * cluster.ts — Kubernetes クラスタシミュレーション
 *
 * コントロールプレーン (API Server, Scheduler, Controller Manager, etcd) と
 * ワーカーノード (kubelet, Pod) を tick ベースでシミュレートする。
 */

// ── リソース型 ──

/** Pod のライフサイクルフェーズを表す型 */
export type PodPhase = "Pending" | "ContainerCreating" | "Running" | "Succeeded" | "Failed" | "Terminating" | "Evicted";

/**
 * コンテナの定義
 * Pod 内で実行される個々のコンテナのリソース要求を含む
 */
export interface Container {
  /** コンテナ名 */
  name: string;
  /** コンテナイメージ (例: nginx:1.25) */
  image: string;
  /** CPU リクエスト (ミリコア単位, 例: 100 = 0.1コア) */
  cpuRequest: number;
  /** メモリリクエスト (MiB 単位) */
  memRequest: number;
}

/**
 * Pod リソースの定義
 * Kubernetes における最小デプロイ単位。1つ以上のコンテナを含む
 */
export interface Pod {
  /** Pod 名 (例: web-pod-1) */
  name: string;
  /** 所属する名前空間 */
  namespace: string;
  /** ラベルセレクタ用のキーバリューペア */
  labels: Record<string, string>;
  /** Pod 内のコンテナ一覧 */
  containers: Container[];
  /** 現在のフェーズ */
  phase: PodPhase;
  /** スケジュールされたノード名 (未スケジュール時は null) */
  nodeName: string | null;
  /** コンテナの再起動回数 */
  restarts: number;
  /** 作成された tick 番号 */
  createdAt: number;
  /** Pod 全体の CPU request 合計 */
  totalCpu: number;
  /** Pod 全体のメモリ request 合計 */
  totalMem: number;
}

/**
 * Kubernetes ノードの定義
 * ワーカーノードのリソース容量・割当量・状態を管理する
 */
export interface K8sNode {
  /** ノード名 (例: node-1) */
  name: string;
  /** CPU 容量 (ミリコア単位) */
  cpuCapacity: number;
  /** メモリ容量 (MiB 単位) */
  memCapacity: number;
  /** 現在割り当て済みの CPU (ミリコア) */
  cpuAllocated: number;
  /** 現在割り当て済みのメモリ (MiB) */
  memAllocated: number;
  /** ノードが Ready 状態かどうか */
  ready: boolean;
  /** このノード上で稼働中の Pod 名一覧 */
  pods: string[];
  /** ノードに付与された taint 一覧 (例: NoSchedule) */
  taints: string[];
}

/**
 * ReplicaSet リソースの定義
 * 指定されたレプリカ数の Pod を維持する責務を持つ
 */
export interface ReplicaSet {
  /** ReplicaSet 名 */
  name: string;
  /** 所属する名前空間 */
  namespace: string;
  /** 目標レプリカ数 */
  replicas: number;
  /** Pod を選択するためのラベルセレクタ */
  selector: Record<string, string>;
  /** Pod テンプレート (ラベルとコンテナ定義) */
  template: { labels: Record<string, string>; containers: Container[] };
  /** 現在稼働中のレプリカ数 */
  currentReplicas: number;
}

/**
 * Deployment リソースの定義
 * ReplicaSet を管理し、宣言的なアップデートとロールバックを提供する
 */
export interface Deployment {
  /** Deployment 名 */
  name: string;
  /** 所属する名前空間 */
  namespace: string;
  /** 目標レプリカ数 */
  replicas: number;
  /** Pod を選択するためのラベルセレクタ */
  selector: Record<string, string>;
  /** Pod テンプレート */
  template: { labels: Record<string, string>; containers: Container[] };
  /** 更新戦略 (RollingUpdate: 段階的更新, Recreate: 全停止後再作成) */
  strategy: "RollingUpdate" | "Recreate";
  /** ローリングアップデート時に許容する最大利用不可 Pod 数 */
  maxUnavailable: number;
  /** ローリングアップデート時に許容する最大超過 Pod 数 */
  maxSurge: number;
}

/**
 * Service リソースの定義
 * Pod 群に対する安定したネットワークエンドポイントを提供する
 */
export interface Service {
  /** Service 名 */
  name: string;
  /** 所属する名前空間 */
  namespace: string;
  /** Service タイプ (ClusterIP: 内部のみ, NodePort: ノードポート公開, LoadBalancer: 外部LB) */
  type: "ClusterIP" | "NodePort" | "LoadBalancer";
  /** バックエンド Pod を選択するためのラベルセレクタ */
  selector: Record<string, string>;
  /** ポートマッピング (Service ポート → Pod ターゲットポート) */
  ports: { port: number; targetPort: number }[];
  /** クラスタ内部 IP アドレス */
  clusterIP: string;
  /** 現在のエンドポイント (Running 状態の Pod 名一覧) */
  endpoints: string[];
}

// ── イベント ──

/**
 * Kubernetes イベント
 * クラスタ内で発生した操作や状態変化を記録する
 */
export interface K8sEvent {
  /** イベント発生時の tick 番号 */
  tick: number;
  /** リソースの種類 (Pod, Node, Deployment 等) */
  kind: string;
  /** リソース名 */
  name: string;
  /** イベントの理由 (Created, Scheduled, Killing 等) */
  reason: string;
  /** イベントの詳細メッセージ */
  message: string;
}

// ── スナップショット ──

/**
 * クラスタの状態スナップショット
 * ある時点でのクラスタ全体の状態を不変のコピーとして提供する
 */
export interface ClusterSnapshot {
  /** 現在の tick 番号 */
  tick: number;
  /** 全ノードの状態 */
  nodes: K8sNode[];
  /** 全 Pod の状態 */
  pods: Pod[];
  /** 全 ReplicaSet の状態 */
  replicaSets: ReplicaSet[];
  /** 全 Deployment の状態 */
  deployments: Deployment[];
  /** 全 Service の状態 */
  services: Service[];
}

// ── kubectl コマンド ──

/**
 * kubectl コマンドの型定義
 * シミュレータが受け付ける操作コマンドを Union 型で表現する
 */
export type KubectlCommand =
  | { cmd: "apply-deployment"; deployment: Deployment }
  | { cmd: "apply-service"; service: Service }
  | { cmd: "scale"; deployment: string; replicas: number }
  | { cmd: "delete-pod"; name: string }
  | { cmd: "cordon"; node: string }
  | { cmd: "uncordon"; node: string }
  | { cmd: "drain"; node: string }
  | { cmd: "rollout-restart"; deployment: string };

// ── クラスタ ──

/**
 * Kubernetes クラスタシミュレータ本体
 *
 * コントロールプレーンの動作（スケジューリング、レプリカ管理、エンドポイント更新）を
 * tick ベースでエミュレートする。各 tick で reconcile ループが 1 回実行される。
 */
export class Cluster {
  /** クラスタ内の全ノード */
  private nodes: K8sNode[] = [];
  /** クラスタ内の全 Pod */
  private pods: Pod[] = [];
  /** クラスタ内の全 ReplicaSet */
  private replicaSets: ReplicaSet[] = [];
  /** クラスタ内の全 Deployment */
  private deployments: Deployment[] = [];
  /** クラスタ内の全 Service */
  private services: Service[] = [];
  /** イベントログ */
  private events: K8sEvent[] = [];
  /** 現在の tick 番号 */
  private tick = 0;
  /** Pod ID の自動採番カウンタ */
  private nextPodId = 1;
  /** ReplicaSet ID の自動採番カウンタ */
  private nextRsId = 1;

  /**
   * クラスタを初期化する
   * @param nodes - ノード定義の配列 (名前、CPU容量、メモリ容量、taint)
   */
  constructor(nodes: { name: string; cpuCapacity: number; memCapacity: number; taints?: string[] }[]) {
    for (const n of nodes) {
      this.nodes.push({
        name: n.name,
        cpuCapacity: n.cpuCapacity,
        memCapacity: n.memCapacity,
        cpuAllocated: 0,
        memAllocated: 0,
        ready: true,
        pods: [],
        taints: n.taints ?? [],
      });
    }
  }

  /** イベントログを読み取り専用で取得する */
  get eventLog(): readonly K8sEvent[] { return this.events; }

  /** 現在のスナップショットを返す */
  snapshot(): ClusterSnapshot {
    return {
      tick: this.tick,
      nodes: this.nodes.map((n) => ({ ...n, pods: [...n.pods] })),
      pods: this.pods.map((p) => ({ ...p })),
      replicaSets: this.replicaSets.map((r) => ({ ...r })),
      deployments: this.deployments.map((d) => ({ ...d })),
      services: this.services.map((s) => ({ ...s, endpoints: [...s.endpoints] })),
    };
  }

  /** kubectl コマンドを実行する */
  kubectl(command: KubectlCommand): void {
    switch (command.cmd) {
      case "apply-deployment":
        this.applyDeployment(command.deployment);
        break;
      case "apply-service":
        this.applyService(command.service);
        break;
      case "scale":
        this.scaleDeployment(command.deployment, command.replicas);
        break;
      case "delete-pod":
        this.deletePod(command.name);
        break;
      case "cordon":
        this.cordonNode(command.node, true);
        break;
      case "uncordon":
        this.cordonNode(command.node, false);
        break;
      case "drain":
        this.drainNode(command.node);
        break;
      case "rollout-restart":
        this.rolloutRestart(command.deployment);
        break;
    }
  }

  /** コントロールループを 1 tick 進める */
  step(): void {
    this.tick++;
    this.reconcileReplicaSets();
    this.schedulePendingPods();
    this.updatePodPhases();
    this.updateEndpoints();
  }

  /** 複数 tick 進める */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  // ── Deployment ──

  /**
   * Deployment を適用する (作成または更新)
   * @param d - 適用する Deployment 定義
   */
  private applyDeployment(d: Deployment): void {
    const existing = this.deployments.find((e) => e.name === d.name);
    if (existing !== undefined) {
      existing.replicas = d.replicas;
      existing.template = d.template;
      this.emit("Deployment", d.name, "Updated", `replicas=${d.replicas}`);
    } else {
      this.deployments.push({ ...d });
      this.emit("Deployment", d.name, "Created", `replicas=${d.replicas}`);
    }
    // ReplicaSet を作成/更新
    this.ensureReplicaSet(d);
  }

  /**
   * Deployment に対応する ReplicaSet を確保する (存在しなければ作成)
   * @param d - 対象の Deployment
   */
  private ensureReplicaSet(d: Deployment): void {
    let rs = this.replicaSets.find((r) => r.name.startsWith(d.name));
    if (rs === undefined) {
      rs = {
        name: `${d.name}-rs-${this.nextRsId++}`,
        namespace: d.namespace,
        replicas: d.replicas,
        selector: d.selector,
        template: d.template,
        currentReplicas: 0,
      };
      this.replicaSets.push(rs);
      this.emit("ReplicaSet", rs.name, "Created", `desired=${d.replicas}`);
    } else {
      rs.replicas = d.replicas;
      rs.template = d.template;
    }
  }

  /**
   * Deployment のレプリカ数を変更する
   * @param name - Deployment 名
   * @param replicas - 新しいレプリカ数
   */
  private scaleDeployment(name: string, replicas: number): void {
    const d = this.deployments.find((e) => e.name === name);
    if (d === undefined) return;
    d.replicas = replicas;
    const rs = this.replicaSets.find((r) => r.name.startsWith(name));
    if (rs !== undefined) rs.replicas = replicas;
    this.emit("Deployment", name, "Scaled", `replicas=${replicas}`);
  }

  /**
   * Deployment のローリングリスタートを実行する
   * 既存の全 Pod を Terminating にし、ReplicaSet が新しい Pod を再作成する
   * @param name - Deployment 名
   */
  private rolloutRestart(name: string): void {
    const d = this.deployments.find((e) => e.name === name);
    if (d === undefined) return;
    // 古い Pod を全削除（新 RS で再作成される）
    const matching = this.pods.filter((p) => this.matchLabels(p.labels, d.selector) && p.phase !== "Terminating");
    for (const p of matching) {
      p.phase = "Terminating";
      this.emit("Pod", p.name, "Killing", "rollout restart");
    }
    this.emit("Deployment", name, "RolloutRestart", `${matching.length} pods terminating`);
  }

  // ── Service ──

  /**
   * Service を適用する (作成または更新)
   * @param s - 適用する Service 定義
   */
  private applyService(s: Service): void {
    const existing = this.services.find((e) => e.name === s.name);
    if (existing !== undefined) {
      existing.selector = s.selector;
      existing.ports = s.ports;
    } else {
      this.services.push({ ...s, endpoints: [] });
      this.emit("Service", s.name, "Created", `type=${s.type} clusterIP=${s.clusterIP}`);
    }
  }

  // ── Pod ──

  /**
   * Pod を削除する (Terminating フェーズに移行)
   * @param name - 削除対象の Pod 名
   */
  private deletePod(name: string): void {
    const pod = this.pods.find((p) => p.name === name);
    if (pod === undefined) return;
    pod.phase = "Terminating";
    this.emit("Pod", name, "Killing", "kubectl delete");
  }

  // ── Node ──

  /**
   * ノードの cordon/uncordon を切り替える
   * cordon するとノードに NoSchedule taint が付与され、新規 Pod がスケジュールされなくなる
   * @param name - ノード名
   * @param cordon - true で cordon、false で uncordon
   */
  private cordonNode(name: string, cordon: boolean): void {
    const node = this.nodes.find((n) => n.name === name);
    if (node === undefined) return;
    if (cordon) {
      if (!node.taints.includes("NoSchedule")) node.taints.push("NoSchedule");
      this.emit("Node", name, "Cordoned", "NoSchedule taint added");
    } else {
      node.taints = node.taints.filter((t) => t !== "NoSchedule");
      this.emit("Node", name, "Uncordoned", "NoSchedule taint removed");
    }
  }

  /**
   * ノードを drain する (cordon + 全 Pod を退避)
   * メンテナンス時にノード上の Pod を安全に別ノードへ移動させる
   * @param name - ノード名
   */
  private drainNode(name: string): void {
    this.cordonNode(name, true);
    const podsOnNode = this.pods.filter((p) => p.nodeName === name && p.phase === "Running");
    for (const p of podsOnNode) {
      p.phase = "Terminating";
      this.emit("Pod", p.name, "Evicting", `drain node ${name}`);
    }
    this.emit("Node", name, "Drained", `${podsOnNode.length} pods evicted`);
  }

  // ── コントロールループ ──

  /** ReplicaSet の desired ↔ actual を調整する */
  private reconcileReplicaSets(): void {
    for (const rs of this.replicaSets) {
      // Terminating 済みを除去
      this.pods = this.pods.filter((p) => {
        if (p.phase === "Terminating") {
          this.removePodFromNode(p);
          return false;
        }
        return true;
      });

      const matchingPods = this.pods.filter(
        (p) => this.matchLabels(p.labels, rs.selector) && p.phase !== "Terminating" && p.phase !== "Failed" && p.phase !== "Evicted",
      );
      rs.currentReplicas = matchingPods.length;

      // スケールアップ
      while (matchingPods.length < rs.replicas) {
        const pod = this.createPod(rs);
        this.pods.push(pod);
        matchingPods.push(pod);
        this.emit("Pod", pod.name, "Created", `by ${rs.name}`);
      }

      // スケールダウン
      while (matchingPods.length > rs.replicas) {
        const victim = matchingPods.pop()!;
        victim.phase = "Terminating";
        this.emit("Pod", victim.name, "Killing", `scale down ${rs.name}`);
      }
    }
  }

  /** Pending Pod をノードにスケジュールする (kube-scheduler) */
  private schedulePendingPods(): void {
    for (const pod of this.pods) {
      if (pod.phase !== "Pending") continue;

      // スコアリング: 空きリソースが最も多いノードを選択
      let bestNode: K8sNode | null = null;
      let bestScore = -1;

      for (const node of this.nodes) {
        if (!node.ready) continue;
        if (node.taints.includes("NoSchedule")) continue;

        const cpuFree = node.cpuCapacity - node.cpuAllocated;
        const memFree = node.memCapacity - node.memAllocated;

        if (cpuFree < pod.totalCpu || memFree < pod.totalMem) continue;

        // LeastRequestedPriority: 空きが多いほどスコアが高い
        const score = (cpuFree / node.cpuCapacity) * 50 + (memFree / node.memCapacity) * 50;
        if (score > bestScore) {
          bestScore = score;
          bestNode = node;
        }
      }

      if (bestNode !== null) {
        pod.nodeName = bestNode.name;
        pod.phase = "ContainerCreating";
        bestNode.cpuAllocated += pod.totalCpu;
        bestNode.memAllocated += pod.totalMem;
        bestNode.pods.push(pod.name);
        this.emit("Pod", pod.name, "Scheduled", `→ ${bestNode.name} (cpu=${pod.totalCpu}m, mem=${pod.totalMem}Mi)`);
      } else {
        this.emit("Pod", pod.name, "FailedScheduling", "Insufficient resources");
      }
    }
  }

  /** Pod フェーズの遷移 */
  private updatePodPhases(): void {
    for (const pod of this.pods) {
      if (pod.phase === "ContainerCreating") {
        // 次の tick で Running に（イメージ pull をシミュレート）
        pod.phase = "Running";
        this.emit("Pod", pod.name, "Started", `on ${pod.nodeName}`);
      }
    }
  }

  /** Service の Endpoints を更新する */
  private updateEndpoints(): void {
    for (const svc of this.services) {
      svc.endpoints = this.pods
        .filter((p) => p.phase === "Running" && this.matchLabels(p.labels, svc.selector))
        .map((p) => p.name);
    }
  }

  // ── ヘルパー ──

  /**
   * ReplicaSet のテンプレートから新しい Pod を生成する
   * @param rs - Pod の生成元となる ReplicaSet
   * @returns 生成された Pod (Pending 状態)
   */
  private createPod(rs: ReplicaSet): Pod {
    const id = this.nextPodId++;
    const containers = rs.template.containers;
    const totalCpu = containers.reduce((s, c) => s + c.cpuRequest, 0);
    const totalMem = containers.reduce((s, c) => s + c.memRequest, 0);
    return {
      name: `${rs.name.replace(/-rs-\d+$/, "")}-pod-${id}`,
      namespace: rs.namespace,
      labels: { ...rs.template.labels },
      containers,
      phase: "Pending",
      nodeName: null,
      restarts: 0,
      createdAt: this.tick,
      totalCpu,
      totalMem,
    };
  }

  /**
   * Pod のラベルがセレクタに一致するか判定する
   * セレクタの全キーバリューが Pod のラベルに含まれていれば true
   * @param podLabels - Pod のラベル
   * @param selector - マッチさせるセレクタ
   * @returns 一致すれば true
   */
  private matchLabels(podLabels: Record<string, string>, selector: Record<string, string>): boolean {
    for (const [key, value] of Object.entries(selector)) {
      if (podLabels[key] !== value) return false;
    }
    return true;
  }

  /**
   * Pod をノードから除去し、割り当てリソースを解放する
   * @param pod - 除去対象の Pod
   */
  private removePodFromNode(pod: Pod): void {
    if (pod.nodeName === null) return;
    const node = this.nodes.find((n) => n.name === pod.nodeName);
    if (node === undefined) return;
    node.pods = node.pods.filter((p) => p !== pod.name);
    node.cpuAllocated = Math.max(0, node.cpuAllocated - pod.totalCpu);
    node.memAllocated = Math.max(0, node.memAllocated - pod.totalMem);
  }

  /**
   * イベントをイベントログに追加する
   * @param kind - リソースの種類
   * @param name - リソース名
   * @param reason - イベントの理由
   * @param message - 詳細メッセージ
   */
  private emit(kind: string, name: string, reason: string, message: string): void {
    this.events.push({ tick: this.tick, kind, name, reason, message });
  }
}
