/**
 * ECSシミュレーターのテスト
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createCluster,
  registerContainerInstance,
  drainContainerInstance,
  deregisterContainerInstance,
  reserveResources,
  releaseResources,
  getClusterUtilization,
  getActiveInstances,
  resetIdCounter,
} from "../infra/cluster.js";
import type { Cluster, ContainerInstance } from "../infra/cluster.js";
import {
  createTaskDefinitionRegistry,
  registerTaskDefinition,
  createContainerDefinition,
  getLatestTaskDefinition,
  getTaskDefinition,
  deregisterTaskDefinition,
  getRequiredResources,
} from "../infra/taskdef.js";
import type { TaskDefinitionRegistry } from "../infra/taskdef.js";
import {
  createTask,
  startTask,
  stopTask,
  appendLog,
  checkTaskHealth,
  getTaskLogs,
  isTaskRunning,
  resetDynamicPortCounter,
} from "../infra/task.js";
import type { Task } from "../infra/task.js";
import {
  selectInstance,
  scheduleTask,
  scheduleTasks,
  getPlaceableCapacity,
} from "../infra/scheduler.js";
import {
  createService,
  reconcileService,
  updateServiceCounts,
  resolveService,
  rollingDeploy,
  evaluateAutoScaling,
  performTargetHealthCheck,
  routeRequest,
  resetIpCounter,
  resetRoundRobinIndex,
} from "../infra/service.js";
import type { TaskDefinition } from "../infra/taskdef.js";

/** テスト用のヘルパー関数 */
function createTestCluster(): Cluster {
  const cluster = createCluster("test-cluster");
  registerContainerInstance(cluster, "m5.large");
  registerContainerInstance(cluster, "m5.large");
  return cluster;
}

function createTestRegistry(): TaskDefinitionRegistry {
  return createTaskDefinitionRegistry();
}

function registerTestTaskDef(registry: TaskDefinitionRegistry): TaskDefinition {
  const container = createContainerDefinition({
    name: "test-app",
    image: "test:latest",
    cpu: 256,
    memory: 512,
    portMappings: [{ containerPort: 80, hostPort: 0, protocol: "tcp" }],
    environment: [{ name: "ENV", value: "test" }],
    healthCheck: {
      command: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
      interval: 30,
      timeout: 5,
      retries: 3,
      startPeriod: 60,
    },
  });
  return registerTaskDefinition(registry, "test-family", [container]);
}

describe("Cluster", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("クラスターを作成できる", () => {
    const cluster = createCluster("my-cluster");
    expect(cluster.clusterName).toBe("my-cluster");
    expect(cluster.status).toBe("ACTIVE");
    expect(cluster.containerInstances).toHaveLength(0);
    expect(cluster.clusterArn).toContain("my-cluster");
  });

  it("コンテナインスタンスを登録できる", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");

    expect(instance.instanceType).toBe("m5.large");
    expect(instance.registeredCpu).toBe(2048);
    expect(instance.registeredMemory).toBe(8192);
    expect(instance.availableCpu).toBe(2048);
    expect(instance.availableMemory).toBe(8192);
    expect(instance.status).toBe("ACTIVE");
    expect(cluster.containerInstances).toHaveLength(1);
    expect(cluster.registeredContainerInstancesCount).toBe(1);
  });

  it("不明なインスタンスタイプで例外をスローする", () => {
    const cluster = createCluster("test");
    expect(() => registerContainerInstance(cluster, "unknown.type")).toThrow(
      "不明なインスタンスタイプ",
    );
  });

  it("インスタンスをドレインモードに変更できる", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");
    const drained = drainContainerInstance(cluster, instance.instanceId);
    expect(drained.status).toBe("DRAINING");
  });

  it("存在しないインスタンスのドレインで例外をスローする", () => {
    const cluster = createCluster("test");
    expect(() => drainContainerInstance(cluster, "nonexistent")).toThrow(
      "インスタンスが見つかりません",
    );
  });

  it("インスタンスを登録解除できる", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");
    deregisterContainerInstance(cluster, instance.instanceId);
    expect(cluster.containerInstances).toHaveLength(0);
    expect(cluster.registeredContainerInstancesCount).toBe(0);
  });

  it("タスク実行中のインスタンス登録解除で例外をスローする", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");
    instance.runningTaskIds.push("task-1");
    expect(() => deregisterContainerInstance(cluster, instance.instanceId)).toThrow(
      "タスクが実行中",
    );
  });

  it("リソースを予約できる", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");
    const result = reserveResources(instance, 512, 1024);
    expect(result).toBe(true);
    expect(instance.availableCpu).toBe(2048 - 512);
    expect(instance.availableMemory).toBe(8192 - 1024);
  });

  it("リソース不足の場合は予約に失敗する", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "t3.micro");
    const result = reserveResources(instance, 4096, 2048);
    expect(result).toBe(false);
  });

  it("リソースを解放できる", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");
    reserveResources(instance, 512, 1024);
    releaseResources(instance, 512, 1024);
    expect(instance.availableCpu).toBe(2048);
    expect(instance.availableMemory).toBe(8192);
  });

  it("クラスター利用状況を取得できる", () => {
    const cluster = createCluster("test");
    const instance = registerContainerInstance(cluster, "m5.large");
    reserveResources(instance, 1024, 4096);

    const util = getClusterUtilization(cluster);
    expect(util.totalCpu).toBe(2048);
    expect(util.usedCpu).toBe(1024);
    expect(util.cpuUtilization).toBe(50);
    expect(util.memoryUtilization).toBe(50);
  });

  it("空のクラスターの利用率は0", () => {
    const cluster = createCluster("test");
    const util = getClusterUtilization(cluster);
    expect(util.cpuUtilization).toBe(0);
    expect(util.memoryUtilization).toBe(0);
  });

  it("アクティブなインスタンスのみ取得できる", () => {
    const cluster = createCluster("test");
    registerContainerInstance(cluster, "m5.large");
    const inst2 = registerContainerInstance(cluster, "m5.large");
    drainContainerInstance(cluster, inst2.instanceId);

    const active = getActiveInstances(cluster);
    expect(active).toHaveLength(1);
  });
});

describe("TaskDefinition", () => {
  let registry: TaskDefinitionRegistry;

  beforeEach(() => {
    registry = createTestRegistry();
  });

  it("コンテナ定義を作成できる", () => {
    const container = createContainerDefinition({
      name: "web",
      image: "nginx:latest",
      cpu: 256,
      memory: 512,
    });
    expect(container.name).toBe("web");
    expect(container.image).toBe("nginx:latest");
    expect(container.cpu).toBe(256);
    expect(container.memory).toBe(512);
    expect(container.essential).toBe(true);
    expect(container.logDriver).toBe("awslogs");
    expect(container.portMappings).toHaveLength(0);
  });

  it("タスク定義を登録できる", () => {
    const taskDef = registerTestTaskDef(registry);
    expect(taskDef.family).toBe("test-family");
    expect(taskDef.revision).toBe(1);
    expect(taskDef.status).toBe("ACTIVE");
    expect(taskDef.cpu).toBe(256);
    expect(taskDef.memory).toBe(512);
    expect(taskDef.containerDefinitions).toHaveLength(1);
  });

  it("新しいリビジョンを登録すると前のリビジョンが非アクティブになる", () => {
    registerTestTaskDef(registry);
    const container = createContainerDefinition({
      name: "test-app-v2",
      image: "test:v2",
      cpu: 512,
      memory: 1024,
    });
    const taskDefV2 = registerTaskDefinition(registry, "test-family", [container]);

    expect(taskDefV2.revision).toBe(2);
    const v1 = getTaskDefinition(registry, "test-family", 1);
    expect(v1?.status).toBe("INACTIVE");
    expect(taskDefV2.status).toBe("ACTIVE");
  });

  it("最新のタスク定義を取得できる", () => {
    registerTestTaskDef(registry);
    const container = createContainerDefinition({
      name: "v2",
      image: "test:v2",
      cpu: 512,
      memory: 1024,
    });
    registerTaskDefinition(registry, "test-family", [container]);

    const latest = getLatestTaskDefinition(registry, "test-family");
    expect(latest?.revision).toBe(2);
  });

  it("存在しないファミリーはundefinedを返す", () => {
    const latest = getLatestTaskDefinition(registry, "nonexistent");
    expect(latest).toBeUndefined();
  });

  it("空のコンテナ定義でエラーをスローする", () => {
    expect(() => registerTaskDefinition(registry, "empty", [])).toThrow(
      "コンテナ定義が1つ以上必要",
    );
  });

  it("必須コンテナがない場合エラーをスローする", () => {
    const container = createContainerDefinition({
      name: "sidecar",
      image: "sidecar:latest",
      cpu: 128,
      memory: 256,
      essential: false,
    });
    expect(() =>
      registerTaskDefinition(registry, "no-essential", [container]),
    ).toThrow("必須（essential）コンテナ");
  });

  it("タスク定義を非アクティブ化できる", () => {
    registerTestTaskDef(registry);
    deregisterTaskDefinition(registry, "test-family", 1);
    const taskDef = getTaskDefinition(registry, "test-family", 1);
    expect(taskDef?.status).toBe("INACTIVE");
  });

  it("存在しないタスク定義の非アクティブ化でエラーをスローする", () => {
    expect(() => deregisterTaskDefinition(registry, "test-family", 99)).toThrow(
      "タスク定義が見つかりません",
    );
  });

  it("必要リソースを計算できる", () => {
    const taskDef = registerTestTaskDef(registry);
    const resources = getRequiredResources(taskDef);
    expect(resources.cpu).toBe(256);
    expect(resources.memory).toBe(512);
  });
});

describe("Task", () => {
  let cluster: Cluster;
  let taskDef: TaskDefinition;

  beforeEach(() => {
    resetIdCounter();
    resetDynamicPortCounter();
    cluster = createTestCluster();
    const registry = createTestRegistry();
    taskDef = registerTestTaskDef(registry);
  });

  it("タスクを作成できる（PENDINGステータス）", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    expect(task.lastStatus).toBe("PENDING");
    expect(task.desiredStatus).toBe("RUNNING");
    expect(task.containers).toHaveLength(1);
    expect(task.containers[0]?.status).toBe("PENDING");
    expect(task.cpu).toBe(256);
    expect(task.memory).toBe(512);
  });

  it("タスクを開始できる（PENDING→RUNNING）", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    startTask(task);
    expect(task.lastStatus).toBe("RUNNING");
    expect(task.startedAt).toBeDefined();
    expect(task.containers[0]?.status).toBe("RUNNING");
    expect(task.logs.length).toBeGreaterThan(0);
  });

  it("RUNNING状態のタスクは開始できない", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    startTask(task);
    expect(() => startTask(task)).toThrow("PENDING以外から開始できません");
  });

  it("タスクを停止できる", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    const instance = cluster.containerInstances[0]!;
    reserveResources(instance, task.cpu, task.memory);
    instance.runningTaskIds.push(task.taskId);

    startTask(task);
    stopTask(task, instance, "テスト停止", 0);

    expect(task.lastStatus).toBe("STOPPED");
    expect(task.stoppedAt).toBeDefined();
    expect(task.stoppedReason).toBe("テスト停止");
    expect(task.containers[0]?.exitCode).toBe(0);
    /** リソースが解放されていることを確認 */
    expect(instance.availableCpu).toBe(instance.registeredCpu);
    expect(instance.runningTaskIds).not.toContain(task.taskId);
  });

  it("インスタンスなしでもタスクを停止できる", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    startTask(task);
    stopTask(task, undefined, "テスト");
    expect(task.lastStatus).toBe("STOPPED");
  });

  it("ログを追加できる", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    appendLog(task, "stdout", "テストメッセージ");
    appendLog(task, "stderr", "エラーメッセージ");

    const allLogs = getTaskLogs(task);
    expect(allLogs).toHaveLength(2);

    const stdoutLogs = getTaskLogs(task, "stdout");
    expect(stdoutLogs).toHaveLength(1);
    expect(stdoutLogs[0]?.message).toBe("テストメッセージ");

    const stderrLogs = getTaskLogs(task, "stderr");
    expect(stderrLogs).toHaveLength(1);
  });

  it("ヘルスチェックを実行できる", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    /** PENDING状態はUNKNOWN */
    expect(checkTaskHealth(task)).toBe("UNKNOWN");

    startTask(task);
    /** RUNNING状態はHEALTHY */
    expect(checkTaskHealth(task)).toBe("HEALTHY");
    expect(task.containers[0]?.healthStatus).toBe("HEALTHY");
  });

  it("isTaskRunningが正しく動作する", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    expect(isTaskRunning(task)).toBe(false);
    startTask(task);
    expect(isTaskRunning(task)).toBe(true);
    stopTask(task, undefined);
    expect(isTaskRunning(task)).toBe(false);
  });

  it("動的ポートが割り当てられる", () => {
    const task1 = createTask(taskDef, cluster.clusterArn);
    const task2 = createTask(taskDef, cluster.clusterArn);

    const port1 = task1.containers[0]?.networkBindings[0]?.hostPort;
    const port2 = task2.containers[0]?.networkBindings[0]?.hostPort;

    expect(port1).toBeDefined();
    expect(port2).toBeDefined();
    expect(port1).not.toBe(port2);
  });

  it("サービス名を設定できる", () => {
    const task = createTask(taskDef, cluster.clusterArn, "my-service");
    expect(task.serviceName).toBe("my-service");
  });
});

describe("Scheduler", () => {
  let cluster: Cluster;
  let taskDef: TaskDefinition;

  beforeEach(() => {
    resetIdCounter();
    resetDynamicPortCounter();
    cluster = createTestCluster();
    const registry = createTestRegistry();
    taskDef = registerTestTaskDef(registry);
  });

  it("ビンパッキング戦略: 使用率が高いインスタンスを優先する", () => {
    const inst1 = cluster.containerInstances[0]!;
    const inst2 = cluster.containerInstances[1]!;

    /** inst1にリソースを事前に使用させる */
    reserveResources(inst1, 1024, 4096);

    const selected = selectInstance(
      cluster.containerInstances,
      256,
      512,
      "binpack",
    );

    /** 空き容量が少ない（使用率が高い）inst1が選ばれる */
    expect(selected?.instanceId).toBe(inst1.instanceId);
  });

  it("スプレッド戦略: タスク数が少ないインスタンスを優先する", () => {
    const inst1 = cluster.containerInstances[0]!;
    const inst2 = cluster.containerInstances[1]!;

    /** inst1にタスクを配置済みにする */
    inst1.runningTaskIds.push("task-1", "task-2");
    inst2.runningTaskIds.push("task-3");

    const selected = selectInstance(
      cluster.containerInstances,
      256,
      512,
      "spread",
    );

    /** タスク数が少ないinst2が選ばれる */
    expect(selected?.instanceId).toBe(inst2.instanceId);
  });

  it("リソース不足の場合はundefinedを返す", () => {
    const selected = selectInstance(
      cluster.containerInstances,
      999999,
      999999,
      "binpack",
    );
    expect(selected).toBeUndefined();
  });

  it("タスクをスケジュールできる", () => {
    const task = createTask(taskDef, cluster.clusterArn);
    const result = scheduleTask(cluster, task);
    expect(result.success).toBe(true);
    expect(result.instanceId).toBeDefined();
    expect(task.containerInstanceId).toBeDefined();
  });

  it("リソース不足でスケジューリングに失敗する", () => {
    /** すべてのリソースを使い果たす */
    for (const inst of cluster.containerInstances) {
      reserveResources(inst, inst.registeredCpu, inst.registeredMemory);
    }

    const task = createTask(taskDef, cluster.clusterArn);
    const result = scheduleTask(cluster, task);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("リソース不足");
  });

  it("複数タスクを一括でスケジュールできる", () => {
    const tasks = [
      createTask(taskDef, cluster.clusterArn),
      createTask(taskDef, cluster.clusterArn),
      createTask(taskDef, cluster.clusterArn),
    ];

    const results = scheduleTasks(cluster, tasks);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("配置可能なキャパシティを取得できる", () => {
    const capacity = getPlaceableCapacity(cluster);
    expect(capacity.totalAvailableCpu).toBe(4096);
    expect(capacity.totalAvailableMemory).toBe(16384);
    expect(capacity.maxCpu).toBe(2048);
    expect(capacity.maxMemory).toBe(8192);
  });

  it("DRAININGインスタンスには配置しない", () => {
    drainContainerInstance(cluster, cluster.containerInstances[0]!.instanceId);

    const selected = selectInstance(
      cluster.containerInstances,
      256,
      512,
      "binpack",
    );

    /** DRAININGでない方が選ばれる */
    expect(selected?.instanceId).toBe(cluster.containerInstances[1]!.instanceId);
  });
});

describe("Service", () => {
  let cluster: Cluster;
  let taskDef: TaskDefinition;

  beforeEach(() => {
    resetIdCounter();
    resetDynamicPortCounter();
    resetIpCounter();
    resetRoundRobinIndex();
    cluster = createTestCluster();
    const registry = createTestRegistry();
    taskDef = registerTestTaskDef(registry);
  });

  it("サービスを作成できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      3,
    );
    expect(service.serviceName).toBe("my-service");
    expect(service.desiredCount).toBe(3);
    expect(service.runningCount).toBe(0);
    expect(service.status).toBe("ACTIVE");
    expect(service.placementStrategy).toBe("binpack");
  });

  it("サービスのタスクを調整できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      3,
    );
    const result = reconcileService(service, cluster);
    expect(result.launched).toBe(3);
    expect(result.failed).toBe(0);
    expect(service.runningCount).toBe(3);
  });

  it("サービスをスケールダウンできる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      3,
    );
    reconcileService(service, cluster);
    expect(service.runningCount).toBe(3);

    service.desiredCount = 1;
    const result = reconcileService(service, cluster);
    expect(result.stopped).toBe(2);
    expect(service.runningCount).toBe(1);
  });

  it("ターゲットグループ付きでサービスを作成できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        targetGroup: { healthCheckPath: "/health" },
      },
    );
    reconcileService(service, cluster);
    expect(service.targetGroup).toBeDefined();
    expect(service.targetGroup!.targets).toHaveLength(2);
    expect(service.targetGroup!.healthCheckPath).toBe("/health");
  });

  it("ターゲットグループのヘルスチェックを実行できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        targetGroup: { healthCheckPath: "/health" },
      },
    );
    reconcileService(service, cluster);

    const targets = performTargetHealthCheck(service);
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.healthy)).toBe(true);
  });

  it("リクエストをルーティングできる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        targetGroup: { healthCheckPath: "/health" },
      },
    );
    reconcileService(service, cluster);
    performTargetHealthCheck(service);

    const target1 = routeRequest(service);
    expect(target1).not.toBeNull();
    const target2 = routeRequest(service);
    expect(target2).not.toBeNull();

    /** ラウンドロビンなので異なるターゲットになるはず */
    if (service.targetGroup!.targets.length >= 2) {
      expect(target1!.taskId).not.toBe(target2!.taskId);
    }
  });

  it("ターゲットグループなしの場合routeRequestはnullを返す", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      1,
    );
    const target = routeRequest(service);
    expect(target).toBeNull();
  });

  it("サービスディスカバリを設定できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        serviceDiscoveryNamespace: "local",
      },
    );
    reconcileService(service, cluster);

    expect(service.serviceDiscovery).toBeDefined();
    expect(service.serviceDiscovery!.entries).toHaveLength(2);
    expect(service.serviceDiscovery!.entries[0]?.hostname).toBe(
      "my-service.local",
    );
  });

  it("サービスディスカバリでDNS解決できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        serviceDiscoveryNamespace: "local",
      },
    );
    reconcileService(service, cluster);

    const entries = resolveService(service);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.ipAddress).toMatch(/^10\.0\./);
  });

  it("サービスディスカバリなしの場合は空配列を返す", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      1,
    );
    const entries = resolveService(service);
    expect(entries).toHaveLength(0);
  });

  it("オートスケーリング設定を構成できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        autoScaling: {
          enabled: true,
          minCapacity: 1,
          maxCapacity: 10,
          targetCpuUtilization: 70,
        },
      },
    );
    expect(service.autoScaling).toBeDefined();
    expect(service.autoScaling!.minCapacity).toBe(1);
    expect(service.autoScaling!.maxCapacity).toBe(10);
    expect(service.autoScaling!.targetCpuUtilization).toBe(70);
  });

  it("オートスケーリング無効の場合はnullを返す", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
    );
    reconcileService(service, cluster);
    const event = evaluateAutoScaling(service, cluster);
    expect(event).toBeNull();
  });

  it("サーキットブレーカーを設定できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        circuitBreaker: {
          enable: true,
          rollback: true,
          failureThreshold: 3,
        },
      },
    );
    expect(service.circuitBreaker.enable).toBe(true);
    expect(service.circuitBreaker.rollback).toBe(true);
    expect(service.circuitBreaker.failureThreshold).toBe(3);
  });

  it("デプロイメント設定をカスタマイズできる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        deploymentConfig: {
          minimumHealthyPercent: 50,
          maximumPercent: 150,
        },
      },
    );
    expect(service.deploymentConfiguration.minimumHealthyPercent).toBe(50);
    expect(service.deploymentConfiguration.maximumPercent).toBe(150);
  });

  it("ローリングデプロイメントを実行できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        deploymentConfig: { minimumHealthyPercent: 50, maximumPercent: 200 },
      },
    );
    reconcileService(service, cluster);
    expect(service.runningCount).toBe(2);

    /** 新しいタスク定義でデプロイする */
    const registry = createTestRegistry();
    const newContainer = createContainerDefinition({
      name: "test-app-v2",
      image: "test:v2",
      cpu: 256,
      memory: 512,
    });
    const newTaskDef = registerTaskDefinition(registry, "test-v2", [newContainer]);

    const result = rollingDeploy(service, newTaskDef, cluster);
    expect(result.deployed).toBeGreaterThan(0);
    expect(service.taskDefinition).toBe(newTaskDef);
  });

  it("スケールダウン時にターゲットグループから登録解除される", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      3,
      {
        targetGroup: { healthCheckPath: "/health" },
      },
    );
    reconcileService(service, cluster);
    expect(service.targetGroup!.targets).toHaveLength(3);

    service.desiredCount = 1;
    reconcileService(service, cluster);
    expect(service.targetGroup!.targets).toHaveLength(1);
  });

  it("スケールダウン時にサービスディスカバリから登録解除される", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      3,
      {
        serviceDiscoveryNamespace: "local",
      },
    );
    reconcileService(service, cluster);
    expect(service.serviceDiscovery!.entries).toHaveLength(3);

    service.desiredCount = 1;
    reconcileService(service, cluster);
    expect(service.serviceDiscovery!.entries).toHaveLength(1);
  });

  it("配置戦略を指定できる", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
      {
        placementStrategy: "spread",
      },
    );
    expect(service.placementStrategy).toBe("spread");
  });

  it("updateServiceCountsが正しくカウントを更新する", () => {
    const service = createService(
      cluster.clusterArn,
      "my-service",
      taskDef,
      2,
    );
    reconcileService(service, cluster);

    /** 手動でカウントをリセットしてから再計算 */
    service.runningCount = 0;
    service.pendingCount = 0;
    updateServiceCounts(service);
    expect(service.runningCount).toBe(2);
  });

  it("リソース不足の場合にタスク起動が失敗する", () => {
    /** 小さいインスタンスのクラスターを作成 */
    const smallCluster = createCluster("small");
    registerContainerInstance(smallCluster, "t3.micro");

    /** 大量のタスクを要求する */
    const bigContainer = createContainerDefinition({
      name: "big",
      image: "big:latest",
      cpu: 1024,
      memory: 512,
    });
    const registry = createTestRegistry();
    const bigTaskDef = registerTaskDefinition(registry, "big-family", [bigContainer]);

    const service = createService(
      smallCluster.clusterArn,
      "big-service",
      bigTaskDef,
      5,
    );
    const result = reconcileService(service, smallCluster);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.launched).toBeLessThan(5);
  });
});
