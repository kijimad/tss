/**
 * app.ts — Kubernetes シミュレータの UI モジュール
 *
 * ブラウザ上でクラスタの状態を可視化する。
 * セレクトボックスからプリセット実験を選択し、ステップ実行またはオート実行で
 * Kubernetes のスケジューリング・スケーリング・障害復旧などの動作を観察できる。
 */

import { Cluster } from "../cluster/cluster.js";
import type { KubectlCommand, ClusterSnapshot, Pod, K8sEvent, Deployment, Container } from "../cluster/cluster.js";

/**
 * 実験プリセットの定義
 * セレクトボックスから選択可能なシナリオを表す
 */
export interface Example {
  /** プリセット名 (UI のセレクトボックスに表示) */
  name: string;
  /** シナリオの説明文 */
  description: string;
  /** シミュレーションで使用するノード構成 */
  nodes: { name: string; cpuCapacity: number; memCapacity: number; taints?: string[] }[];
  /** 順番に実行する kubectl コマンド + advance */
  steps: { commands: KubectlCommand[]; advanceTicks: number; label: string }[];
}

// ── コンテナテンプレート定義 ──
// 各シナリオで使い回すコンテナ定義

/** Web サーバ (nginx) コンテナ: 軽量 (100m CPU, 128Mi メモリ) */
const webContainer: Container = { name: "nginx", image: "nginx:1.25", cpuRequest: 100, memRequest: 128 };
/** API サーバ (Node.js) コンテナ: 中程度 (250m CPU, 256Mi メモリ) */
const apiContainer: Container = { name: "api", image: "node:20-slim", cpuRequest: 250, memRequest: 256 };
/** ワーカー (Python) コンテナ: 重い (500m CPU, 512Mi メモリ) */
const workerContainer: Container = { name: "worker", image: "python:3.12", cpuRequest: 500, memRequest: 512 };
/** データベース (PostgreSQL) コンテナ: 重い (500m CPU, 512Mi メモリ) */
const dbContainer: Container = { name: "postgres", image: "postgres:16", cpuRequest: 500, memRequest: 512 };

/**
 * Deployment オブジェクトを簡易生成するヘルパー関数
 * @param name - Deployment 名 (ラベルセレクタ app=name も自動設定)
 * @param replicas - レプリカ数
 * @param containers - コンテナ定義の配列
 * @param strategy - 更新戦略 (デフォルト: RollingUpdate)
 * @returns Deployment 定義オブジェクト
 */
function dep(name: string, replicas: number, containers: Container[], strategy: "RollingUpdate" | "Recreate" = "RollingUpdate"): Deployment {
  return {
    name, namespace: "default", replicas, selector: { app: name },
    template: { labels: { app: name }, containers },
    strategy, maxUnavailable: 1, maxSurge: 1,
  };
}

/** 実験プリセット一覧: セレクトボックスから選択できるシナリオの配列 */
export const EXAMPLES: Example[] = [
  {
    name: "Pod スケジューリング基礎",
    description: "3ノードに Web サーバ 3 Pod をデプロイ。Scheduler が LeastRequestedPriority でノードを選択。",
    nodes: [
      { name: "node-1", cpuCapacity: 2000, memCapacity: 4096 },
      { name: "node-2", cpuCapacity: 2000, memCapacity: 4096 },
      { name: "node-3", cpuCapacity: 2000, memCapacity: 4096 },
    ],
    steps: [
      { commands: [{ cmd: "apply-deployment", deployment: dep("web", 3, [webContainer]) }], advanceTicks: 3, label: "kubectl apply -f web-deployment.yaml (replicas=3)" },
      { commands: [{ cmd: "apply-service", service: { name: "web-svc", namespace: "default", type: "ClusterIP", selector: { app: "web" }, ports: [{ port: 80, targetPort: 80 }], clusterIP: "10.96.0.10", endpoints: [] } }], advanceTicks: 2, label: "kubectl apply -f web-service.yaml" },
    ],
  },
  {
    name: "スケールアウト / スケールイン",
    description: "Deployment を 2 → 5 → 2 にスケーリング。ReplicaSet がPod数を調整する。",
    nodes: [
      { name: "node-1", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-2", cpuCapacity: 4000, memCapacity: 8192 },
    ],
    steps: [
      { commands: [{ cmd: "apply-deployment", deployment: dep("api", 2, [apiContainer]) }], advanceTicks: 3, label: "kubectl apply (replicas=2)" },
      { commands: [{ cmd: "scale", deployment: "api", replicas: 5 }], advanceTicks: 3, label: "kubectl scale deployment/api --replicas=5" },
      { commands: [{ cmd: "scale", deployment: "api", replicas: 2 }], advanceTicks: 3, label: "kubectl scale deployment/api --replicas=2" },
    ],
  },
  {
    name: "リソース不足 (Pending Pod)",
    description: "小さいノード 2 台に大きな Pod をデプロイ。リソース不足で Pending のまま残る。",
    nodes: [
      { name: "node-1", cpuCapacity: 1000, memCapacity: 1024 },
      { name: "node-2", cpuCapacity: 1000, memCapacity: 1024 },
    ],
    steps: [
      { commands: [{ cmd: "apply-deployment", deployment: dep("heavy", 4, [workerContainer]) }], advanceTicks: 4, label: "kubectl apply (4 heavy pods, 500m CPU each)" },
    ],
  },
  {
    name: "Pod 障害と自動復旧",
    description: "Pod を手動削除すると、ReplicaSet が検知して自動的に新しい Pod を作成。",
    nodes: [
      { name: "node-1", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-2", cpuCapacity: 4000, memCapacity: 8192 },
    ],
    steps: [
      { commands: [{ cmd: "apply-deployment", deployment: dep("app", 3, [apiContainer]) }], advanceTicks: 3, label: "kubectl apply (replicas=3)" },
      { commands: [{ cmd: "delete-pod", name: "app-pod-1" }], advanceTicks: 3, label: "kubectl delete pod app-pod-1 (障害シミュレート)" },
      { commands: [{ cmd: "delete-pod", name: "app-pod-2" }], advanceTicks: 3, label: "kubectl delete pod app-pod-2 (もう1つ削除)" },
    ],
  },
  {
    name: "ノードの Drain (退避)",
    description: "メンテナンスのため node-1 を drain。Pod が別ノードに移動。",
    nodes: [
      { name: "node-1", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-2", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-3", cpuCapacity: 4000, memCapacity: 8192 },
    ],
    steps: [
      { commands: [{ cmd: "apply-deployment", deployment: dep("web", 4, [webContainer]) }], advanceTicks: 3, label: "kubectl apply (replicas=4)" },
      { commands: [{ cmd: "drain", node: "node-1" }], advanceTicks: 4, label: "kubectl drain node-1 --ignore-daemonsets" },
    ],
  },
  {
    name: "マルチサービス構成 (Web + API + DB)",
    description: "3 層構成のマイクロサービスを一括デプロイ。Service で Pod を紐づける。",
    nodes: [
      { name: "node-1", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-2", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-3", cpuCapacity: 4000, memCapacity: 8192 },
    ],
    steps: [
      {
        commands: [
          { cmd: "apply-deployment", deployment: dep("frontend", 2, [webContainer]) },
          { cmd: "apply-deployment", deployment: dep("backend", 2, [apiContainer]) },
          { cmd: "apply-deployment", deployment: dep("database", 1, [dbContainer]) },
        ],
        advanceTicks: 3,
        label: "kubectl apply -f frontend,backend,database",
      },
      {
        commands: [
          { cmd: "apply-service", service: { name: "frontend-svc", namespace: "default", type: "LoadBalancer", selector: { app: "frontend" }, ports: [{ port: 80, targetPort: 80 }], clusterIP: "10.96.0.10", endpoints: [] } },
          { cmd: "apply-service", service: { name: "backend-svc", namespace: "default", type: "ClusterIP", selector: { app: "backend" }, ports: [{ port: 3000, targetPort: 3000 }], clusterIP: "10.96.0.20", endpoints: [] } },
          { cmd: "apply-service", service: { name: "database-svc", namespace: "default", type: "ClusterIP", selector: { app: "database" }, ports: [{ port: 5432, targetPort: 5432 }], clusterIP: "10.96.0.30", endpoints: [] } },
        ],
        advanceTicks: 2,
        label: "kubectl apply -f services",
      },
    ],
  },
  {
    name: "Rolling Restart",
    description: "Deployment をローリングリスタート。古い Pod が順次削除され、新しい Pod に置き換わる。",
    nodes: [
      { name: "node-1", cpuCapacity: 4000, memCapacity: 8192 },
      { name: "node-2", cpuCapacity: 4000, memCapacity: 8192 },
    ],
    steps: [
      { commands: [{ cmd: "apply-deployment", deployment: dep("app", 4, [apiContainer]) }], advanceTicks: 3, label: "kubectl apply (replicas=4)" },
      { commands: [{ cmd: "rollout-restart", deployment: "app" }], advanceTicks: 5, label: "kubectl rollout restart deployment/app" },
    ],
  },
];

/**
 * Pod のフェーズに応じた表示色を返す
 * @param phase - Pod のライフサイクルフェーズ
 * @returns CSS カラーコード (16進数)
 */
function phaseColor(phase: Pod["phase"]): string {
  switch (phase) {
    case "Pending":           return "#f59e0b";
    case "ContainerCreating": return "#06b6d4";
    case "Running":           return "#22c55e";
    case "Succeeded":         return "#10b981";
    case "Failed":            return "#ef4444";
    case "Terminating":       return "#f97316";
    case "Evicted":           return "#dc2626";
  }
}

/**
 * Kubernetes シミュレータの UI アプリケーションクラス
 * ブラウザ上にクラスタの状態を3パネル構成で可視化する
 * - 左パネル: ノードと Pod の配置状況
 * - 中央パネル: Deployment と Service の状態
 * - 右パネル: イベントログ
 */
export class K8sApp {
  /**
   * アプリケーションを初期化し、指定されたコンテナ要素に UI を構築する
   * @param container - UI を描画するルート HTML 要素
   */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Kubernetes Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#326ce5;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run Scenario";
    runBtn.style.cssText = "padding:4px 16px;background:#326ce5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const stepBtn = document.createElement("button");
    stepBtn.textContent = "\u23ED Next Step";
    stepBtn.style.cssText = "padding:4px 12px;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:4px;cursor:pointer;font-size:12px;";
    header.appendChild(stepBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ノード可視化
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";
    const nodeLabel = document.createElement("div");
    nodeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#326ce5;border-bottom:1px solid #1e293b;";
    nodeLabel.textContent = "Cluster Nodes & Pods";
    leftPanel.appendChild(nodeLabel);
    const nodeDiv = document.createElement("div");
    nodeDiv.style.cssText = "padding:8px 12px;font-size:10px;";
    leftPanel.appendChild(nodeDiv);
    main.appendChild(leftPanel);

    // 中央: Service + Deployment
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "width:320px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const svcLabel = document.createElement("div");
    svcLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    svcLabel.textContent = "Deployments & Services";
    centerPanel.appendChild(svcLabel);
    const svcDiv = document.createElement("div");
    svcDiv.style.cssText = "padding:8px 12px;";
    centerPanel.appendChild(svcDiv);
    main.appendChild(centerPanel);

    // 右: イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:380px;display:flex;flex-direction:column;";
    const evLabel = document.createElement("div");
    evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Events";
    rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div");
    evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    /** ノードパネルを描画する: 各ノードのリソース使用率と Pod 配置を表示 */
    const renderNodes = (snap: ClusterSnapshot) => {
      nodeDiv.innerHTML = "";
      for (const node of snap.nodes) {
        const box = document.createElement("div");
        const readyColor = node.ready && !node.taints.includes("NoSchedule") ? "#326ce5" : "#ef4444";
        box.style.cssText = `margin-bottom:10px;border:1px solid ${readyColor}44;border-radius:6px;padding:8px;background:${readyColor}08;`;

        const hdr = document.createElement("div");
        hdr.style.cssText = "display:flex;justify-content:space-between;margin-bottom:4px;";
        const cpuPct = node.cpuCapacity > 0 ? ((node.cpuAllocated / node.cpuCapacity) * 100).toFixed(0) : "0";
        const memPct = node.memCapacity > 0 ? ((node.memAllocated / node.memCapacity) * 100).toFixed(0) : "0";
        const taintTag = node.taints.length > 0 ? ` <span style="color:#ef4444;font-size:8px;">[${node.taints.join(",")}]</span>` : "";
        hdr.innerHTML = `<span style="color:${readyColor};font-weight:600;">\u{1F5A5} ${node.name}${taintTag}</span><span style="color:#64748b;">CPU ${cpuPct}% | Mem ${memPct}%</span>`;
        box.appendChild(hdr);

        // CPU バー
        const cpuBar = document.createElement("div");
        cpuBar.style.cssText = "height:6px;background:#1e293b;border-radius:3px;margin-bottom:4px;overflow:hidden;";
        const cpuFill = document.createElement("div");
        cpuFill.style.cssText = `height:100%;width:${cpuPct}%;background:#3b82f6;border-radius:3px;transition:width 0.3s;`;
        cpuBar.appendChild(cpuFill);
        box.appendChild(cpuBar);

        // Pod 一覧
        const podsOnNode = snap.pods.filter((p) => p.nodeName === node.name);
        const podGrid = document.createElement("div");
        podGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;";
        for (const pod of podsOnNode) {
          const pEl = document.createElement("div");
          const pc = phaseColor(pod.phase);
          pEl.style.cssText = `padding:2px 6px;border:1px solid ${pc}44;border-radius:3px;background:${pc}15;font-size:9px;color:${pc};`;
          pEl.textContent = `${pod.name.replace(/-pod-/, "-")} [${pod.phase}]`;
          podGrid.appendChild(pEl);
        }
        box.appendChild(podGrid);
        nodeDiv.appendChild(box);
      }

      // Pending Pods (ノード未割当)
      const pending = snap.pods.filter((p) => p.nodeName === null);
      if (pending.length > 0) {
        const pBox = document.createElement("div");
        pBox.style.cssText = "margin-top:8px;border:1px dashed #f59e0b44;border-radius:6px;padding:8px;";
        pBox.innerHTML = `<div style="color:#f59e0b;font-weight:600;margin-bottom:4px;">\u23F3 Pending (unscheduled)</div>`;
        for (const p of pending) {
          const el = document.createElement("div");
          el.style.cssText = "color:#f59e0b;font-size:9px;";
          el.textContent = `${p.name} (cpu=${p.totalCpu}m, mem=${p.totalMem}Mi)`;
          pBox.appendChild(el);
        }
        nodeDiv.appendChild(pBox);
      }
    };

    /** 中央パネルを描画する: Deployment のレプリカ状態と Service のエンドポイントを表示 */
    const renderServices = (snap: ClusterSnapshot) => {
      svcDiv.innerHTML = "";
      // Deployments
      for (const d of snap.deployments) {
        const rs = snap.replicaSets.find((r) => r.name.startsWith(d.name));
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:6px;padding:4px 6px;border:1px solid #326ce544;border-radius:4px;";
        el.innerHTML =
          `<div style="color:#326ce5;font-weight:600;">Deployment/${d.name}</div>` +
          `<div style="color:#94a3b8;">replicas: ${rs?.currentReplicas ?? 0}/${d.replicas} | strategy: ${d.strategy}</div>`;
        svcDiv.appendChild(el);
      }
      // Services
      for (const s of snap.services) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:6px;padding:4px 6px;border:1px solid #22c55e44;border-radius:4px;";
        el.innerHTML =
          `<div style="color:#22c55e;font-weight:600;">Service/${s.name} (${s.type})</div>` +
          `<div style="color:#94a3b8;">clusterIP: ${s.clusterIP} | endpoints: ${s.endpoints.length}</div>` +
          `<div style="color:#64748b;font-size:9px;">ports: ${s.ports.map((p) => `${p.port}\u2192${p.targetPort}`).join(", ")}</div>`;
        svcDiv.appendChild(el);
      }
    };

    /** イベントパネルを描画する: 直近40件のイベントを時系列で表示 */
    const renderEvents = (events: readonly K8sEvent[]) => {
      evDiv.innerHTML = "";
      const recent = events.slice(-40);
      for (const ev of recent) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;margin-bottom:1px;";
        const kindColor = ev.kind === "Pod" ? "#22c55e" : ev.kind === "Node" ? "#3b82f6" : ev.kind === "Deployment" ? "#326ce5" : "#a78bfa";
        el.innerHTML =
          `<span style="color:#475569;min-width:20px;">t${ev.tick}</span>` +
          `<span style="color:${kindColor};min-width:70px;font-weight:600;">${ev.kind}</span>` +
          `<span style="color:#f59e0b;min-width:65px;">${ev.reason}</span>` +
          `<span style="color:#94a3b8;">${ev.name}: ${ev.message}</span>`;
        evDiv.appendChild(el);
      }
      evDiv.scrollTop = evDiv.scrollHeight;
    };

    // ── ロジック ──

    /** 現在実行中のクラスタインスタンス */
    let cluster: Cluster | null = null;
    /** 現在のシナリオのステップ一覧 */
    let currentSteps: Example["steps"] = [];
    /** 次に実行するステップのインデックス */
    let stepIdx = 0;

    /** 実験プリセットを読み込み、クラスタを初期化して画面をリセットする */
    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      cluster = new Cluster(ex.nodes);
      currentSteps = ex.steps;
      stepIdx = 0;
      const snap = cluster.snapshot();
      renderNodes(snap); renderServices(snap); evDiv.innerHTML = "";
    };

    /** 現在のステップを実行し、コマンド適用 → tick 進行 → 描画更新を行う */
    const executeStep = () => {
      if (cluster === null || stepIdx >= currentSteps.length) return;
      const step = currentSteps[stepIdx]!;
      for (const cmd of step.commands) cluster.kubectl(cmd);
      cluster.advance(step.advanceTicks);
      stepIdx++;
      const snap = cluster.snapshot();
      renderNodes(snap); renderServices(snap); renderEvents(cluster.eventLog);
    };

    /** 全ステップを 600ms 間隔で自動実行する */
    const runAll = () => {
      if (cluster === null) return;
      stepIdx = 0;
      const doStep = () => {
        if (stepIdx >= currentSteps.length) return;
        executeStep();
        setTimeout(doStep, 600);
      };
      doStep();
    };

    // ── イベントリスナー登録 ──
    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) { loadExample(ex); runAll(); } });
    stepBtn.addEventListener("click", executeStep);
    // 初期表示: 最初のプリセットを読み込む
    loadExample(EXAMPLES[0]!);
  }
}
