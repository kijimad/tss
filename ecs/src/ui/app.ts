/**
 * ブラウザUI: ECSシミュレーターのダッシュボード
 * Node.jsシミュレーターのUIパターンに準拠
 */

import {
  createCluster,
  registerContainerInstance,
  getClusterUtilization,
} from "../infra/cluster.js";
import type { Cluster } from "../infra/cluster.js";
import {
  createTaskDefinitionRegistry,
  registerTaskDefinition,
  createContainerDefinition,
} from "../infra/taskdef.js";
import type { TaskDefinitionRegistry, TaskDefinition } from "../infra/taskdef.js";
import {
  createService,
  reconcileService,
  evaluateAutoScaling,
  performTargetHealthCheck,
  routeRequest,
  rollingDeploy,
} from "../infra/service.js";
import type { Service, ScalingEvent } from "../infra/service.js";

/** シナリオ定義 */
interface Scenario {
  /** シナリオ名 */
  name: string;
  /** シナリオの説明コード（表示用） */
  code: string;
  /** シナリオ実行関数 */
  run: () => ScenarioResult;
}

/** シナリオ実行結果 */
interface ScenarioResult {
  /** クラスター情報 */
  cluster: Cluster;
  /** サービス一覧 */
  services: Service[];
  /** イベントログ */
  events: string[];
}

/** シナリオ一覧 */
const SCENARIOS: Scenario[] = [
  {
    name: "クラスタ作成 + タスク実行",
    code: `// クラスターを作成し、インスタンスを登録、タスク定義を作成してタスクを実行する
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "web", image: "nginx:latest", cpu: 256, memory: 512,
  portMappings: [{ containerPort: 80, hostPort: 0, protocol: "tcp" }],
});
const taskDef = registerTaskDefinition(registry, "web-service", [container]);

const service = createService(cluster.clusterArn, "web-service", taskDef, 2, {
  placementStrategy: "spread",
  targetGroup: { healthCheckPath: "/" },
});
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "web",
        image: "nginx:latest",
        cpu: 256,
        memory: 512,
        portMappings: [{ containerPort: 80, hostPort: 0, protocol: "tcp" }],
      });
      const taskDef = registerTaskDefinition(registry, "web-service", [container]);

      const service = createService(cluster.clusterArn, "web-service", taskDef, 2, {
        placementStrategy: "spread",
        targetGroup: { healthCheckPath: "/" },
      });
      const result = reconcileService(service, cluster);

      return {
        cluster,
        services: [service],
        events: [
          "クラスター production を作成",
          "m5.large インスタンス x2 を登録",
          `タスク定義 web-service:1 を登録`,
          `サービス web-service を作成 (desired=2)`,
          `reconcile: launched=${String(result.launched)}, failed=${String(result.failed)}`,
        ],
      };
    },
  },
  {
    name: "サービス作成 (desired=3)",
    code: `// 3つのタスクを持つサービスを作成する
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.xlarge");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "api", image: "node:20-alpine", cpu: 512, memory: 1024,
  portMappings: [{ containerPort: 3000, hostPort: 0, protocol: "tcp" }],
});
const taskDef = registerTaskDefinition(registry, "api-service", [container]);

const service = createService(cluster.clusterArn, "api-service", taskDef, 3, {
  placementStrategy: "spread",
  targetGroup: { healthCheckPath: "/health" },
  autoScaling: { enabled: true, minCapacity: 2, maxCapacity: 8, targetCpuUtilization: 70 },
});
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.xlarge");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "api",
        image: "node:20-alpine",
        cpu: 512,
        memory: 1024,
        portMappings: [{ containerPort: 3000, hostPort: 0, protocol: "tcp" }],
      });
      const taskDef = registerTaskDefinition(registry, "api-service", [container]);

      const service = createService(cluster.clusterArn, "api-service", taskDef, 3, {
        placementStrategy: "spread",
        targetGroup: { healthCheckPath: "/health" },
        autoScaling: {
          enabled: true,
          minCapacity: 2,
          maxCapacity: 8,
          targetCpuUtilization: 70,
        },
      });
      const result = reconcileService(service, cluster);

      return {
        cluster,
        services: [service],
        events: [
          "クラスター production を作成",
          "m5.large + m5.xlarge インスタンスを登録",
          `タスク定義 api-service:1 を登録 (cpu=512, memory=1024)`,
          `サービス api-service を作成 (desired=3, spread配置)`,
          `reconcile: launched=${String(result.launched)}, failed=${String(result.failed)}`,
          `オートスケーリング: min=2, max=8, targetCPU=70%`,
        ],
      };
    },
  },
  {
    name: "ローリングデプロイ",
    code: `// 既存サービスを新しいタスク定義でローリングデプロイする
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.xlarge");

const registry = createTaskDefinitionRegistry();
const v1Container = createContainerDefinition({
  name: "web", image: "myapp:v1", cpu: 256, memory: 512,
});
const v1TaskDef = registerTaskDefinition(registry, "web-service", [v1Container]);

const service = createService(cluster.clusterArn, "web-service", v1TaskDef, 3, {
  deploymentConfig: { minimumHealthyPercent: 50, maximumPercent: 200 },
  targetGroup: { healthCheckPath: "/" },
});
reconcileService(service, cluster);

// v2にローリングデプロイ
const v2Container = createContainerDefinition({
  name: "web", image: "myapp:v2", cpu: 256, memory: 512,
});
const v2TaskDef = registerTaskDefinition(registry, "web-service", [v2Container]);
rollingDeploy(service, v2TaskDef, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.xlarge");

      const registry = createTaskDefinitionRegistry();
      const v1Container = createContainerDefinition({
        name: "web",
        image: "myapp:v1",
        cpu: 256,
        memory: 512,
      });
      const v1TaskDef = registerTaskDefinition(registry, "web-service", [v1Container]);

      const service = createService(cluster.clusterArn, "web-service", v1TaskDef, 3, {
        deploymentConfig: { minimumHealthyPercent: 50, maximumPercent: 200 },
        targetGroup: { healthCheckPath: "/" },
      });
      reconcileService(service, cluster);
      const v1Running = service.runningCount;

      const v2Container = createContainerDefinition({
        name: "web",
        image: "myapp:v2",
        cpu: 256,
        memory: 512,
      });
      const v2TaskDef = registerTaskDefinition(registry, "web-service", [v2Container]);
      const deployResult = rollingDeploy(service, v2TaskDef, cluster);

      return {
        cluster,
        services: [service],
        events: [
          `v1 タスクを ${String(v1Running)} 個起動完了`,
          `v2 タスク定義 web-service:2 を登録`,
          `ローリングデプロイ: deployed=${String(deployResult.deployed)}, failed=${String(deployResult.failed)}`,
          `minimumHealthyPercent=50%, maximumPercent=200%`,
          `現在のタスク定義: ${service.taskDefinition.taskDefinitionArn}`,
        ],
      };
    },
  },
  {
    name: "スケールアウト",
    code: `// サービスの希望タスク数を増加させる
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.xlarge");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "web", image: "nginx:latest", cpu: 256, memory: 512,
});
const taskDef = registerTaskDefinition(registry, "web-service", [container]);

const service = createService(cluster.clusterArn, "web-service", taskDef, 2, {
  placementStrategy: "spread",
  targetGroup: { healthCheckPath: "/" },
});
reconcileService(service, cluster);

// 2 → 5 にスケールアウト
service.desiredCount = 5;
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.xlarge");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "web",
        image: "nginx:latest",
        cpu: 256,
        memory: 512,
      });
      const taskDef = registerTaskDefinition(registry, "web-service", [container]);

      const service = createService(cluster.clusterArn, "web-service", taskDef, 2, {
        placementStrategy: "spread",
        targetGroup: { healthCheckPath: "/" },
      });
      reconcileService(service, cluster);
      const beforeCount = service.runningCount;

      service.desiredCount = 5;
      const result = reconcileService(service, cluster);

      return {
        cluster,
        services: [service],
        events: [
          `初期状態: runningCount=${String(beforeCount)}`,
          `desiredCount を 2 → 5 に変更`,
          `reconcile: launched=${String(result.launched)}, failed=${String(result.failed)}`,
          `現在: runningCount=${String(service.runningCount)}`,
        ],
      };
    },
  },
  {
    name: "スケールイン",
    code: `// サービスの希望タスク数を減少させる
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "web", image: "nginx:latest", cpu: 256, memory: 512,
});
const taskDef = registerTaskDefinition(registry, "web-service", [container]);

const service = createService(cluster.clusterArn, "web-service", taskDef, 5, {
  placementStrategy: "spread",
  targetGroup: { healthCheckPath: "/" },
});
reconcileService(service, cluster);

// 5 → 2 にスケールイン
service.desiredCount = 2;
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "web",
        image: "nginx:latest",
        cpu: 256,
        memory: 512,
      });
      const taskDef = registerTaskDefinition(registry, "web-service", [container]);

      const service = createService(cluster.clusterArn, "web-service", taskDef, 5, {
        placementStrategy: "spread",
        targetGroup: { healthCheckPath: "/" },
      });
      reconcileService(service, cluster);
      const beforeCount = service.runningCount;

      service.desiredCount = 2;
      const result = reconcileService(service, cluster);

      return {
        cluster,
        services: [service],
        events: [
          `初期状態: runningCount=${String(beforeCount)}`,
          `desiredCount を 5 → 2 に変更`,
          `reconcile: stopped=${String(result.stopped)}`,
          `現在: runningCount=${String(service.runningCount)}`,
          `停止されたタスクのリソースは解放済み`,
        ],
      };
    },
  },
  {
    name: "bin-packing配置",
    code: `// bin-packing戦略でタスクを配置する（最少インスタンスに詰め込む）
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.xlarge");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "worker", image: "worker:latest", cpu: 512, memory: 1024,
});
const taskDef = registerTaskDefinition(registry, "worker", [container]);

const service = createService(cluster.clusterArn, "worker", taskDef, 4, {
  placementStrategy: "binpack",
});
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.xlarge");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "worker",
        image: "worker:latest",
        cpu: 512,
        memory: 1024,
      });
      const taskDef = registerTaskDefinition(registry, "worker", [container]);

      const service = createService(cluster.clusterArn, "worker", taskDef, 4, {
        placementStrategy: "binpack",
      });
      reconcileService(service, cluster);

      const events: string[] = [
        `bin-packing戦略: 使用率が高いインスタンスを優先`,
        `タスク配置結果:`,
      ];
      for (const inst of cluster.containerInstances) {
        events.push(
          `  ${inst.instanceType} (${inst.instanceId.substring(0, 16)}...): タスク数=${String(inst.runningTaskIds.length)}, CPU空き=${String(inst.availableCpu)}/${String(inst.registeredCpu)}, メモリ空き=${String(inst.availableMemory)}/${String(inst.registeredMemory)}`,
        );
      }

      return {
        cluster,
        services: [service],
        events,
      };
    },
  },
  {
    name: "spread配置",
    code: `// spread戦略でタスクを配置する（インスタンス間で均等分散）
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.xlarge");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "web", image: "nginx:latest", cpu: 256, memory: 512,
});
const taskDef = registerTaskDefinition(registry, "web-service", [container]);

const service = createService(cluster.clusterArn, "web-service", taskDef, 6, {
  placementStrategy: "spread",
});
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.xlarge");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "web",
        image: "nginx:latest",
        cpu: 256,
        memory: 512,
      });
      const taskDef = registerTaskDefinition(registry, "web-service", [container]);

      const service = createService(cluster.clusterArn, "web-service", taskDef, 6, {
        placementStrategy: "spread",
      });
      reconcileService(service, cluster);

      const events: string[] = [
        `spread戦略: タスク数が少ないインスタンスを優先`,
        `タスク配置結果:`,
      ];
      for (const inst of cluster.containerInstances) {
        events.push(
          `  ${inst.instanceType} (${inst.instanceId.substring(0, 16)}...): タスク数=${String(inst.runningTaskIds.length)}, CPU空き=${String(inst.availableCpu)}/${String(inst.registeredCpu)}`,
        );
      }

      return {
        cluster,
        services: [service],
        events,
      };
    },
  },
  {
    name: "ヘルスチェック",
    code: `// ターゲットグループのヘルスチェックを実行する
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "web", image: "nginx:latest", cpu: 256, memory: 512,
  portMappings: [{ containerPort: 80, hostPort: 0, protocol: "tcp" }],
  healthCheck: {
    command: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
    interval: 30, timeout: 5, retries: 3, startPeriod: 60,
  },
});
const taskDef = registerTaskDefinition(registry, "web-service", [container]);

const service = createService(cluster.clusterArn, "web-service", taskDef, 3, {
  targetGroup: { healthCheckPath: "/" },
});
reconcileService(service, cluster);

// ヘルスチェック実行
const targets = performTargetHealthCheck(service);
// リクエストルーティング
const target = routeRequest(service);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "web",
        image: "nginx:latest",
        cpu: 256,
        memory: 512,
        portMappings: [{ containerPort: 80, hostPort: 0, protocol: "tcp" }],
        healthCheck: {
          command: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 60,
        },
      });
      const taskDef = registerTaskDefinition(registry, "web-service", [container]);

      const service = createService(cluster.clusterArn, "web-service", taskDef, 3, {
        targetGroup: { healthCheckPath: "/" },
      });
      reconcileService(service, cluster);

      const targets = performTargetHealthCheck(service);
      const healthyCount = targets.filter((t) => t.healthy).length;
      const unhealthyCount = targets.filter((t) => !t.healthy).length;

      const routedTarget = routeRequest(service);

      const events: string[] = [
        `ヘルスチェック実行完了`,
        `ターゲット数: ${String(targets.length)}`,
        `ヘルシー: ${String(healthyCount)}, アンヘルシー: ${String(unhealthyCount)}`,
      ];
      for (const t of targets) {
        events.push(`  ${t.taskId.substring(0, 16)}... → ${t.host}:${String(t.port)} [${t.healthy ? "HEALTHY" : "UNHEALTHY"}]`);
      }
      if (routedTarget) {
        events.push(`リクエストルーティング先: ${routedTarget.host}:${String(routedTarget.port)}`);
      }

      return {
        cluster,
        services: [service],
        events,
      };
    },
  },
  {
    name: "オートスケーリング (CPU)",
    code: `// CPU使用率に基づくオートスケーリングを評価する
const cluster = createCluster("production");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.large");
registerContainerInstance(cluster, "m5.xlarge");

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "api", image: "node:20-alpine", cpu: 512, memory: 1024,
});
const taskDef = registerTaskDefinition(registry, "api-service", [container]);

const service = createService(cluster.clusterArn, "api-service", taskDef, 2, {
  autoScaling: {
    enabled: true, minCapacity: 1, maxCapacity: 6, targetCpuUtilization: 60,
  },
});
reconcileService(service, cluster);

// オートスケーリング評価（CPU使用率はシミュレートされる）
const event = evaluateAutoScaling(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.large");
      registerContainerInstance(cluster, "m5.xlarge");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "api",
        image: "node:20-alpine",
        cpu: 512,
        memory: 1024,
      });
      const taskDef = registerTaskDefinition(registry, "api-service", [container]);

      const service = createService(cluster.clusterArn, "api-service", taskDef, 2, {
        autoScaling: {
          enabled: true,
          minCapacity: 1,
          maxCapacity: 6,
          targetCpuUtilization: 60,
        },
      });
      reconcileService(service, cluster);
      const beforeCount = service.desiredCount;

      const scalingEvent = evaluateAutoScaling(service, cluster);

      const events: string[] = [
        `オートスケーリング設定: min=1, max=6, targetCPU=60%`,
        `評価前: desiredCount=${String(beforeCount)}`,
      ];

      if (scalingEvent) {
        events.push(`スケーリングイベント: ${scalingEvent.type}`);
        events.push(`  ${String(scalingEvent.previousCount)} → ${String(scalingEvent.newCount)}`);
        events.push(`  理由: ${scalingEvent.reason}`);
      } else {
        events.push(`スケーリング不要（CPU使用率が目標範囲内）`);
      }
      events.push(`評価後: desiredCount=${String(service.desiredCount)}, runningCount=${String(service.runningCount)}`);

      return {
        cluster,
        services: [service],
        events,
      };
    },
  },
  {
    name: "リソース不足",
    code: `// インスタンスのCPU/メモリが足りない場合のタスク配置失敗
const cluster = createCluster("production");
registerContainerInstance(cluster, "t3.micro"); // CPU=2048, Memory=1024

const registry = createTaskDefinitionRegistry();
const container = createContainerDefinition({
  name: "heavy", image: "heavy:latest", cpu: 1024, memory: 512,
});
const taskDef = registerTaskDefinition(registry, "heavy-service", [container]);

// t3.microではCPU=2048しかないので、3つ目のタスクは失敗する
const service = createService(cluster.clusterArn, "heavy-service", taskDef, 5);
reconcileService(service, cluster);`,
    run: () => {
      const cluster = createCluster("production");
      registerContainerInstance(cluster, "t3.micro");

      const registry = createTaskDefinitionRegistry();
      const container = createContainerDefinition({
        name: "heavy",
        image: "heavy:latest",
        cpu: 1024,
        memory: 512,
      });
      const taskDef = registerTaskDefinition(registry, "heavy-service", [container]);

      const service = createService(cluster.clusterArn, "heavy-service", taskDef, 5);
      const result = reconcileService(service, cluster);

      const util = getClusterUtilization(cluster);

      return {
        cluster,
        services: [service],
        events: [
          `t3.micro インスタンス1台 (CPU=2048, Memory=1024)`,
          `タスク定義: cpu=1024, memory=512`,
          `希望タスク数: 5`,
          `起動成功: ${String(result.launched)}, 起動失敗: ${String(result.failed)}`,
          `CPU使用率: ${util.cpuUtilization.toFixed(1)}%`,
          `メモリ使用率: ${util.memoryUtilization.toFixed(1)}%`,
          `リソース不足により ${String(result.failed)} タスクの配置に失敗`,
        ],
      };
    },
  },
];

/** ECSシミュレーターアプリケーション */
export class EcsApp {
  /** アプリケーションを初期化してコンテナにマウントする */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "ECS Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#58a6ff;";
    header.appendChild(title);

    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < SCENARIOS.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = SCENARIOS[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#58a6ff;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    // メイン
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: シナリオコード
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#58a6ff;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "Scenario (TypeScript)";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    codeArea.value = SCENARIOS[0]?.code ?? "";
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右: 結果パネル
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // クラスター情報
    const clusterLabel = document.createElement("div");
    clusterLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#58a6ff;border-bottom:1px solid #1e293b;";
    clusterLabel.textContent = "Cluster / Services";
    rightPanel.appendChild(clusterLabel);

    const clusterDiv = document.createElement("div");
    clusterDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:11px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(clusterDiv);

    // イベントログ
    const eventLabel = document.createElement("div");
    eventLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    eventLabel.textContent = "Event Log";
    rightPanel.appendChild(eventLabel);

    const eventDiv = document.createElement("div");
    eventDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(eventDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // シナリオ選択時にコードを更新する
    select.addEventListener("change", () => {
      const scenario = SCENARIOS[Number(select.value)];
      if (scenario !== undefined) codeArea.value = scenario.code;
    });

    // 実行ボタン
    runBtn.addEventListener("click", () => {
      clusterDiv.innerHTML = "";
      eventDiv.innerHTML = "";

      const scenario = SCENARIOS[Number(select.value)];
      if (!scenario) return;

      const result = scenario.run();

      // クラスター情報を表示する
      renderClusterInfo(clusterDiv, result.cluster);
      for (const svc of result.services) {
        renderServiceInfo(clusterDiv, svc);
      }

      // イベントログを表示する
      for (const evt of result.events) {
        const row = document.createElement("div");
        row.style.cssText = "padding:1px 0;color:#e2e8f0;";
        row.textContent = evt;
        eventDiv.appendChild(row);
      }
    });

    // 初回実行
    runBtn.click();
  }
}

/** クラスター情報をレンダリングする */
function renderClusterInfo(container: HTMLElement, cluster: Cluster): void {
  const util = getClusterUtilization(cluster);

  // クラスター概要
  const clusterHeader = document.createElement("div");
  clusterHeader.style.cssText = "color:#58a6ff;font-weight:bold;margin-bottom:4px;font-size:12px;";
  clusterHeader.textContent = `クラスター: ${cluster.clusterName} [${cluster.status}]`;
  container.appendChild(clusterHeader);

  const metricsLine = document.createElement("div");
  metricsLine.style.cssText = "color:#8b949e;margin-bottom:4px;";
  metricsLine.textContent = `インスタンス: ${String(cluster.containerInstances.length)} | CPU: ${String(util.usedCpu)}/${String(util.totalCpu)} (${util.cpuUtilization.toFixed(1)}%) | メモリ: ${String(util.usedMemory)}/${String(util.totalMemory)} (${util.memoryUtilization.toFixed(1)}%)`;
  container.appendChild(metricsLine);

  // インスタンス一覧
  for (const inst of cluster.containerInstances) {
    const instLine = document.createElement("div");
    const statusColor = inst.status === "ACTIVE" ? "#3fb950" : inst.status === "DRAINING" ? "#d29922" : "#f85149";
    instLine.style.cssText = `color:${statusColor};padding-left:8px;`;
    instLine.textContent = `${inst.instanceType} [${inst.status}] CPU: ${String(inst.availableCpu)}/${String(inst.registeredCpu)} MEM: ${String(inst.availableMemory)}/${String(inst.registeredMemory)} tasks: ${String(inst.runningTaskIds.length)}`;
    container.appendChild(instLine);
  }

  // 区切り線
  const separator = document.createElement("div");
  separator.style.cssText = "border-bottom:1px solid #1e293b;margin:6px 0;";
  container.appendChild(separator);
}

/** サービス情報をレンダリングする */
function renderServiceInfo(container: HTMLElement, service: Service): void {
  // サービス概要
  const svcHeader = document.createElement("div");
  svcHeader.style.cssText = "color:#58a6ff;font-weight:bold;margin-bottom:4px;font-size:12px;";
  svcHeader.textContent = `サービス: ${service.serviceName} [${service.status}]`;
  container.appendChild(svcHeader);

  const svcMetrics = document.createElement("div");
  svcMetrics.style.cssText = "color:#8b949e;margin-bottom:2px;";
  svcMetrics.textContent = `desired=${String(service.desiredCount)} running=${String(service.runningCount)} pending=${String(service.pendingCount)} strategy=${service.placementStrategy}`;
  container.appendChild(svcMetrics);

  // ターゲットグループ情報
  if (service.targetGroup) {
    const tgLine = document.createElement("div");
    const healthyCount = service.targetGroup.targets.filter((t) => t.healthy).length;
    tgLine.style.cssText = "color:#8b949e;margin-bottom:2px;";
    tgLine.textContent = `ターゲット: ${String(healthyCount)}/${String(service.targetGroup.targets.length)} healthy (path=${service.targetGroup.healthCheckPath})`;
    container.appendChild(tgLine);
  }

  // オートスケーリング情報
  if (service.autoScaling) {
    const asLine = document.createElement("div");
    asLine.style.cssText = "color:#8b949e;margin-bottom:2px;";
    asLine.textContent = `オートスケーリング: min=${String(service.autoScaling.minCapacity)} max=${String(service.autoScaling.maxCapacity)} targetCPU=${String(service.autoScaling.targetCpuUtilization)}%`;
    container.appendChild(asLine);
  }

  // タスク一覧
  const activeTasks = service.tasks.filter((t) => t.lastStatus !== "STOPPED");
  for (const task of activeTasks) {
    const taskLine = document.createElement("div");
    const taskColor = task.lastStatus === "RUNNING" ? "#3fb950" : task.lastStatus === "PENDING" ? "#d29922" : "#f85149";
    taskLine.style.cssText = `color:${taskColor};padding-left:8px;`;
    const containers = task.containers.map((c) => `${c.name}(${c.status})`).join(", ");
    taskLine.textContent = `${task.taskId.substring(0, 20)}... [${task.lastStatus}] ${containers}`;
    container.appendChild(taskLine);
  }

  // スケーリングイベント
  if (service.scalingEvents.length > 0) {
    const evtHeader = document.createElement("div");
    evtHeader.style.cssText = "color:#f59e0b;margin-top:4px;font-weight:bold;font-size:11px;";
    evtHeader.textContent = "スケーリングイベント:";
    container.appendChild(evtHeader);

    for (const evt of service.scalingEvents.slice(-5)) {
      const evtLine = document.createElement("div");
      evtLine.style.cssText = "color:#f59e0b;padding-left:8px;";
      evtLine.textContent = `${evt.type}: ${String(evt.previousCount)} → ${String(evt.newCount)} (${evt.reason})`;
      container.appendChild(evtLine);
    }
  }

  // 区切り線
  const separator = document.createElement("div");
  separator.style.cssText = "border-bottom:1px solid #1e293b;margin:6px 0;";
  container.appendChild(separator);
}
