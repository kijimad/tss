/**
 * cluster.ts — Kubernetes クラスタシミュレーション
 *
 * コントロールプレーン (API Server, Scheduler, Controller Manager, etcd) と
 * ワーカーノード (kubelet, Pod) を tick ベースでシミュレートする。
 */

// ── リソース型 ──

export type PodPhase = "Pending" | "ContainerCreating" | "Running" | "Succeeded" | "Failed" | "Terminating" | "Evicted";

export interface Container {
  name: string;
  image: string;
  cpuRequest: number;   // ミリコア (m)
  memRequest: number;   // MiB
}

export interface Pod {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  containers: Container[];
  phase: PodPhase;
  nodeName: string | null;
  restarts: number;
  createdAt: number;
  /** Pod 全体の CPU request 合計 */
  totalCpu: number;
  /** Pod 全体のメモリ request 合計 */
  totalMem: number;
}

export interface K8sNode {
  name: string;
  cpuCapacity: number;   // ミリコア
  memCapacity: number;   // MiB
  cpuAllocated: number;
  memAllocated: number;
  ready: boolean;
  pods: string[];
  taints: string[];
}

export interface ReplicaSet {
  name: string;
  namespace: string;
  replicas: number;
  selector: Record<string, string>;
  template: { labels: Record<string, string>; containers: Container[] };
  currentReplicas: number;
}

export interface Deployment {
  name: string;
  namespace: string;
  replicas: number;
  selector: Record<string, string>;
  template: { labels: Record<string, string>; containers: Container[] };
  strategy: "RollingUpdate" | "Recreate";
  maxUnavailable: number;
  maxSurge: number;
}

export interface Service {
  name: string;
  namespace: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer";
  selector: Record<string, string>;
  ports: { port: number; targetPort: number }[];
  clusterIP: string;
  endpoints: string[];
}

// ── イベント ──

export interface K8sEvent {
  tick: number;
  kind: string;
  name: string;
  reason: string;
  message: string;
}

// ── スナップショット ──

export interface ClusterSnapshot {
  tick: number;
  nodes: K8sNode[];
  pods: Pod[];
  replicaSets: ReplicaSet[];
  deployments: Deployment[];
  services: Service[];
}

// ── kubectl コマンド ──

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

export class Cluster {
  private nodes: K8sNode[] = [];
  private pods: Pod[] = [];
  private replicaSets: ReplicaSet[] = [];
  private deployments: Deployment[] = [];
  private services: Service[] = [];
  private events: K8sEvent[] = [];
  private tick = 0;
  private nextPodId = 1;
  private nextRsId = 1;

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

  private scaleDeployment(name: string, replicas: number): void {
    const d = this.deployments.find((e) => e.name === name);
    if (d === undefined) return;
    d.replicas = replicas;
    const rs = this.replicaSets.find((r) => r.name.startsWith(name));
    if (rs !== undefined) rs.replicas = replicas;
    this.emit("Deployment", name, "Scaled", `replicas=${replicas}`);
  }

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

  private deletePod(name: string): void {
    const pod = this.pods.find((p) => p.name === name);
    if (pod === undefined) return;
    pod.phase = "Terminating";
    this.emit("Pod", name, "Killing", "kubectl delete");
  }

  // ── Node ──

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

  private matchLabels(podLabels: Record<string, string>, selector: Record<string, string>): boolean {
    for (const [key, value] of Object.entries(selector)) {
      if (podLabels[key] !== value) return false;
    }
    return true;
  }

  private removePodFromNode(pod: Pod): void {
    if (pod.nodeName === null) return;
    const node = this.nodes.find((n) => n.name === pod.nodeName);
    if (node === undefined) return;
    node.pods = node.pods.filter((p) => p !== pod.name);
    node.cpuAllocated = Math.max(0, node.cpuAllocated - pod.totalCpu);
    node.memAllocated = Math.max(0, node.memAllocated - pod.totalMem);
  }

  private emit(kind: string, name: string, reason: string, message: string): void {
    this.events.push({ tick: this.tick, kind, name, reason, message });
  }
}
