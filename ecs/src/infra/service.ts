/**
 * ECSサービス: 希望タスク数の管理、ローリングデプロイメント、
 * ロードバランサー連携、オートスケーリング、サービスディスカバリ
 */

import type { Cluster, ContainerInstance } from "./cluster.js";
import type { TaskDefinition } from "./taskdef.js";
import type { Task } from "./task.js";
import {
  createTask,
  startTask,
  stopTask,
  simulateCpuUtilization,
} from "./task.js";
import { scheduleTask } from "./scheduler.js";
import type { PlacementStrategy } from "./scheduler.js";

/** デプロイメント設定 */
export interface DeploymentConfiguration {
  /** 最小ヘルシー率（%） */
  minimumHealthyPercent: number;
  /** 最大率（%） */
  maximumPercent: number;
}

/** デプロイメントサーキットブレーカー */
export interface DeploymentCircuitBreaker {
  /** 有効かどうか */
  enable: boolean;
  /** 自動ロールバック */
  rollback: boolean;
  /** 連続失敗回数 */
  consecutiveFailures: number;
  /** 失敗閾値 */
  failureThreshold: number;
}

/** ロードバランサーのターゲットグループ */
export interface TargetGroup {
  /** ターゲットグループARN */
  targetGroupArn: string;
  /** ヘルスチェックパス */
  healthCheckPath: string;
  /** ヘルスチェック間隔（秒） */
  healthCheckInterval: number;
  /** ヘルシー閾値 */
  healthyThreshold: number;
  /** アンヘルシー閾値 */
  unhealthyThreshold: number;
  /** 登録済みターゲット */
  targets: TargetInfo[];
}

/** ターゲット情報 */
export interface TargetInfo {
  /** タスクID */
  taskId: string;
  /** ホスト */
  host: string;
  /** ポート */
  port: number;
  /** ヘルシーかどうか */
  healthy: boolean;
}

/** オートスケーリング設定 */
export interface AutoScalingConfig {
  /** 有効かどうか */
  enabled: boolean;
  /** 最小タスク数 */
  minCapacity: number;
  /** 最大タスク数 */
  maxCapacity: number;
  /** 目標CPU使用率（%） */
  targetCpuUtilization: number;
  /** スケールアウトクールダウン（秒） */
  scaleOutCooldown: number;
  /** スケールインクールダウン（秒） */
  scaleInCooldown: number;
  /** 最後のスケーリングアクション日時 */
  lastScalingAction?: number;
}

/** スケーリングイベント */
export interface ScalingEvent {
  /** イベント日時 */
  timestamp: number;
  /** イベント種類 */
  type: "scale-out" | "scale-in";
  /** 変更前のタスク数 */
  previousCount: number;
  /** 変更後のタスク数 */
  newCount: number;
  /** 理由 */
  reason: string;
}

/** サービスディスカバリエントリ */
export interface ServiceDiscoveryEntry {
  /** サービス名 */
  serviceName: string;
  /** ホスト名 */
  hostname: string;
  /** IPアドレス（シミュレート） */
  ipAddress: string;
  /** ポート */
  port: number;
  /** タスクID */
  taskId: string;
}

/** サービスディスカバリレジストリ */
export interface ServiceDiscoveryRegistry {
  /** ネームスペース */
  namespace: string;
  /** エントリ一覧 */
  entries: ServiceDiscoveryEntry[];
}

/** デプロイメント情報 */
export interface Deployment {
  /** デプロイメントID */
  deploymentId: string;
  /** タスク定義ARN */
  taskDefinitionArn: string;
  /** 希望タスク数 */
  desiredCount: number;
  /** 実行中のタスク数 */
  runningCount: number;
  /** 待機中のタスク数 */
  pendingCount: number;
  /** デプロイメント状態 */
  status: "PRIMARY" | "ACTIVE" | "INACTIVE";
  /** 作成日時 */
  createdAt: number;
}

/** ECSサービス */
export interface Service {
  /** サービス名 */
  serviceName: string;
  /** サービスARN */
  serviceArn: string;
  /** クラスターARN */
  clusterArn: string;
  /** タスク定義 */
  taskDefinition: TaskDefinition;
  /** 希望タスク数 */
  desiredCount: number;
  /** 実行中のタスク数 */
  runningCount: number;
  /** 待機中のタスク数 */
  pendingCount: number;
  /** 実行中のタスク一覧 */
  tasks: Task[];
  /** デプロイメント設定 */
  deploymentConfiguration: DeploymentConfiguration;
  /** サーキットブレーカー */
  circuitBreaker: DeploymentCircuitBreaker;
  /** デプロイメント一覧 */
  deployments: Deployment[];
  /** 配置戦略 */
  placementStrategy: PlacementStrategy;
  /** ターゲットグループ */
  targetGroup?: TargetGroup;
  /** オートスケーリング設定 */
  autoScaling?: AutoScalingConfig;
  /** スケーリングイベント履歴 */
  scalingEvents: ScalingEvent[];
  /** サービスディスカバリ */
  serviceDiscovery?: ServiceDiscoveryRegistry;
  /** サービスの状態 */
  status: "ACTIVE" | "DRAINING" | "INACTIVE";
  /** 作成日時 */
  createdAt: number;
}

/** IPアドレスをシミュレートして生成する */
let ipCounter = 1;
export function resetIpCounter(): void {
  ipCounter = 1;
}
function generateIp(): string {
  const ip = `10.0.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
  ipCounter++;
  return ip;
}

/** サービスを作成する */
export function createService(
  clusterArn: string,
  serviceName: string,
  taskDefinition: TaskDefinition,
  desiredCount: number,
  options?: {
    placementStrategy?: PlacementStrategy;
    deploymentConfig?: Partial<DeploymentConfiguration>;
    circuitBreaker?: Partial<DeploymentCircuitBreaker>;
    targetGroup?: Partial<TargetGroup>;
    autoScaling?: Partial<AutoScalingConfig>;
    serviceDiscoveryNamespace?: string;
  },
): Service {
  const service: Service = {
    serviceName,
    serviceArn: `arn:aws:ecs:ap-northeast-1:123456789012:service/${serviceName}`,
    clusterArn,
    taskDefinition,
    desiredCount,
    runningCount: 0,
    pendingCount: 0,
    tasks: [],
    deploymentConfiguration: {
      minimumHealthyPercent: options?.deploymentConfig?.minimumHealthyPercent ?? 100,
      maximumPercent: options?.deploymentConfig?.maximumPercent ?? 200,
    },
    circuitBreaker: {
      enable: options?.circuitBreaker?.enable ?? false,
      rollback: options?.circuitBreaker?.rollback ?? false,
      consecutiveFailures: 0,
      failureThreshold: options?.circuitBreaker?.failureThreshold ?? 5,
    },
    deployments: [],
    placementStrategy: options?.placementStrategy ?? "binpack",
    scalingEvents: [],
    status: "ACTIVE",
    createdAt: Date.now(),
  };

  /** ターゲットグループの設定 */
  if (options?.targetGroup) {
    service.targetGroup = {
      targetGroupArn:
        options.targetGroup.targetGroupArn ??
        `arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/${serviceName}/abc123`,
      healthCheckPath: options.targetGroup.healthCheckPath ?? "/health",
      healthCheckInterval: options.targetGroup.healthCheckInterval ?? 30,
      healthyThreshold: options.targetGroup.healthyThreshold ?? 3,
      unhealthyThreshold: options.targetGroup.unhealthyThreshold ?? 3,
      targets: [],
    };
  }

  /** オートスケーリングの設定 */
  if (options?.autoScaling) {
    service.autoScaling = {
      enabled: options.autoScaling.enabled ?? true,
      minCapacity: options.autoScaling.minCapacity ?? 1,
      maxCapacity: options.autoScaling.maxCapacity ?? 10,
      targetCpuUtilization: options.autoScaling.targetCpuUtilization ?? 70,
      scaleOutCooldown: options.autoScaling.scaleOutCooldown ?? 60,
      scaleInCooldown: options.autoScaling.scaleInCooldown ?? 300,
    };
  }

  /** サービスディスカバリの設定 */
  if (options?.serviceDiscoveryNamespace) {
    service.serviceDiscovery = {
      namespace: options.serviceDiscoveryNamespace,
      entries: [],
    };
  }

  return service;
}

/** サービスのタスクを調整する（希望数に合わせる） */
export function reconcileService(
  service: Service,
  cluster: Cluster,
): { launched: number; stopped: number; failed: number } {
  let launched = 0;
  let stopped = 0;
  let failed = 0;

  /** 実行中/待機中のタスクを数える */
  const activeTasks = service.tasks.filter(
    (t) => t.lastStatus === "RUNNING" || t.lastStatus === "PENDING",
  );
  const activeCount = activeTasks.length;

  /** タスク不足の場合: 新しいタスクを起動する */
  if (activeCount < service.desiredCount) {
    const toLaunch = service.desiredCount - activeCount;
    for (let i = 0; i < toLaunch; i++) {
      const task = createTask(
        service.taskDefinition,
        cluster.clusterArn,
        service.serviceName,
      );
      const result = scheduleTask(cluster, task, service.placementStrategy);
      if (result.success) {
        startTask(task);
        service.tasks.push(task);
        launched++;

        /** ターゲットグループに登録する */
        registerTaskToTargetGroup(service, task);
        /** サービスディスカバリに登録する */
        registerTaskToServiceDiscovery(service, task);
      } else {
        failed++;
        /** サーキットブレーカーのチェック */
        if (service.circuitBreaker.enable) {
          service.circuitBreaker.consecutiveFailures++;
        }
      }
    }
  }

  /** タスク過多の場合: 余分なタスクを停止する */
  if (activeCount > service.desiredCount) {
    const toStop = activeCount - service.desiredCount;
    const runningTasks = activeTasks.filter((t) => t.lastStatus === "RUNNING");
    for (let i = 0; i < toStop && i < runningTasks.length; i++) {
      const task = runningTasks[i]!;
      const instance = findInstanceForTask(cluster, task);
      stopTask(task, instance, "サービスのスケールダウン");
      stopped++;

      /** ターゲットグループから登録解除する */
      deregisterTaskFromTargetGroup(service, task);
      /** サービスディスカバリから登録解除する */
      deregisterTaskFromServiceDiscovery(service, task);
    }
  }

  /** カウンターを更新する */
  updateServiceCounts(service);

  return { launched, stopped, failed };
}

/** サービスのカウンターを更新する */
export function updateServiceCounts(service: Service): void {
  service.runningCount = service.tasks.filter(
    (t) => t.lastStatus === "RUNNING",
  ).length;
  service.pendingCount = service.tasks.filter(
    (t) => t.lastStatus === "PENDING",
  ).length;
}

/** タスクが配置されているインスタンスを見つける */
function findInstanceForTask(
  cluster: Cluster,
  task: Task,
): ContainerInstance | undefined {
  if (!task.containerInstanceId) {
    return undefined;
  }
  return cluster.containerInstances.find(
    (ci) => ci.instanceId === task.containerInstanceId,
  );
}

/** ターゲットグループにタスクを登録する */
function registerTaskToTargetGroup(service: Service, task: Task): void {
  if (!service.targetGroup) return;

  const firstBinding = task.containers[0]?.networkBindings[0];
  if (firstBinding) {
    service.targetGroup.targets.push({
      taskId: task.taskId,
      host: `10.0.0.${service.targetGroup.targets.length + 1}`,
      port: firstBinding.hostPort,
      healthy: true,
    });
  }
}

/** ターゲットグループからタスクを登録解除する */
function deregisterTaskFromTargetGroup(service: Service, task: Task): void {
  if (!service.targetGroup) return;
  service.targetGroup.targets = service.targetGroup.targets.filter(
    (t) => t.taskId !== task.taskId,
  );
}

/** サービスディスカバリにタスクを登録する */
function registerTaskToServiceDiscovery(service: Service, task: Task): void {
  if (!service.serviceDiscovery) return;

  const firstBinding = task.containers[0]?.networkBindings[0];
  if (firstBinding) {
    service.serviceDiscovery.entries.push({
      serviceName: service.serviceName,
      hostname: `${service.serviceName}.${service.serviceDiscovery.namespace}`,
      ipAddress: generateIp(),
      port: firstBinding.hostPort,
      taskId: task.taskId,
    });
  }
}

/** サービスディスカバリからタスクを登録解除する */
function deregisterTaskFromServiceDiscovery(
  service: Service,
  task: Task,
): void {
  if (!service.serviceDiscovery) return;
  service.serviceDiscovery.entries = service.serviceDiscovery.entries.filter(
    (e) => e.taskId !== task.taskId,
  );
}

/** サービスディスカバリでDNS名前解決する */
export function resolveService(
  service: Service,
): ServiceDiscoveryEntry[] {
  if (!service.serviceDiscovery) {
    return [];
  }
  return [...service.serviceDiscovery.entries];
}

/** ローリングデプロイメントを実行する */
export function rollingDeploy(
  service: Service,
  newTaskDef: TaskDefinition,
  cluster: Cluster,
): { deployed: number; failed: number } {
  const minHealthy = Math.floor(
    (service.desiredCount * service.deploymentConfiguration.minimumHealthyPercent) / 100,
  );
  const maxTotal = Math.ceil(
    (service.desiredCount * service.deploymentConfiguration.maximumPercent) / 100,
  );

  let deployed = 0;
  let failed = 0;

  /** 古いタスクの参照を保持する */
  const oldTasks = service.tasks.filter(
    (t) =>
      t.taskDefinitionArn === service.taskDefinition.taskDefinitionArn &&
      t.lastStatus === "RUNNING",
  );

  /** タスク定義を更新する */
  service.taskDefinition = newTaskDef;

  /** 新しいタスクを起動する（最大数の範囲内で） */
  const batchSize = maxTotal - service.desiredCount;
  const batches = Math.ceil(service.desiredCount / Math.max(batchSize, 1));

  for (let batch = 0; batch < batches; batch++) {
    const startIdx = batch * Math.max(batchSize, 1);
    const endIdx = Math.min(startIdx + Math.max(batchSize, 1), service.desiredCount);

    /** 新しいタスクを起動する */
    for (let i = startIdx; i < endIdx; i++) {
      const task = createTask(newTaskDef, cluster.clusterArn, service.serviceName);
      const result = scheduleTask(cluster, task, service.placementStrategy);
      if (result.success) {
        startTask(task);
        service.tasks.push(task);
        deployed++;

        registerTaskToTargetGroup(service, task);
        registerTaskToServiceDiscovery(service, task);
      } else {
        failed++;
        if (service.circuitBreaker.enable) {
          service.circuitBreaker.consecutiveFailures++;
          if (
            service.circuitBreaker.consecutiveFailures >=
            service.circuitBreaker.failureThreshold
          ) {
            /** サーキットブレーカー発動 */
            updateServiceCounts(service);
            return { deployed, failed };
          }
        }
      }
    }

    /** 古いタスクを停止する（最小ヘルシー数を維持） */
    const currentRunning = service.tasks.filter(
      (t) => t.lastStatus === "RUNNING",
    ).length;

    let toStopCount = currentRunning - service.desiredCount;
    for (let i = 0; i < toStopCount && i < oldTasks.length; i++) {
      const oldTask = oldTasks[i];
      if (oldTask && oldTask.lastStatus === "RUNNING") {
        /** 最小ヘルシー数を維持するか確認する */
        const runningNew = service.tasks.filter(
          (t) =>
            t.taskDefinitionArn === newTaskDef.taskDefinitionArn &&
            t.lastStatus === "RUNNING",
        ).length;
        if (runningNew >= minHealthy) {
          const instance = findInstanceForTask(cluster, oldTask);
          stopTask(oldTask, instance, "ローリングデプロイメント");
          deregisterTaskFromTargetGroup(service, oldTask);
          deregisterTaskFromServiceDiscovery(service, oldTask);
        }
      }
    }
  }

  updateServiceCounts(service);
  return { deployed, failed };
}

/** オートスケーリングを評価する */
export function evaluateAutoScaling(
  service: Service,
  cluster: Cluster,
): ScalingEvent | null {
  if (!service.autoScaling || !service.autoScaling.enabled) {
    return null;
  }

  const config = service.autoScaling;
  const now = Date.now();

  /** クールダウン期間中かチェックする */
  if (config.lastScalingAction) {
    const elapsed = (now - config.lastScalingAction) / 1000;
    /** スケールアウト/インのクールダウンの短い方でチェック */
    const minCooldown = Math.min(config.scaleOutCooldown, config.scaleInCooldown);
    if (elapsed < minCooldown) {
      return null;
    }
  }

  /** 平均CPU使用率を計算する */
  const runningTasks = service.tasks.filter((t) => t.lastStatus === "RUNNING");
  if (runningTasks.length === 0) {
    return null;
  }

  let totalCpu = 0;
  for (const task of runningTasks) {
    totalCpu += simulateCpuUtilization(task);
  }
  const avgCpu = totalCpu / runningTasks.length;

  let event: ScalingEvent | null = null;

  /** スケールアウト: CPU使用率が目標を超えている場合 */
  if (avgCpu > config.targetCpuUtilization && service.desiredCount < config.maxCapacity) {
    const previousCount = service.desiredCount;
    /** CPU比率に基づいてスケール数を計算する */
    const scaleFactor = avgCpu / config.targetCpuUtilization;
    const newDesired = Math.min(
      config.maxCapacity,
      Math.ceil(service.desiredCount * scaleFactor),
    );
    service.desiredCount = newDesired;

    event = {
      timestamp: now,
      type: "scale-out",
      previousCount,
      newCount: newDesired,
      reason: `CPU使用率 ${avgCpu.toFixed(1)}% が目標 ${config.targetCpuUtilization}% を超過`,
    };
  }

  /** スケールイン: CPU使用率が目標より大幅に低い場合 */
  if (avgCpu < config.targetCpuUtilization * 0.5 && service.desiredCount > config.minCapacity) {
    const previousCount = service.desiredCount;
    const newDesired = Math.max(config.minCapacity, service.desiredCount - 1);
    service.desiredCount = newDesired;

    event = {
      timestamp: now,
      type: "scale-in",
      previousCount,
      newCount: newDesired,
      reason: `CPU使用率 ${avgCpu.toFixed(1)}% が目標の50%未満`,
    };
  }

  if (event) {
    config.lastScalingAction = now;
    service.scalingEvents.push(event);
    /** スケーリング後にサービスを調整する */
    reconcileService(service, cluster);
  }

  return event;
}

/** ターゲットグループのヘルスチェックを実行する */
export function performTargetHealthCheck(service: Service): TargetInfo[] {
  if (!service.targetGroup) {
    return [];
  }

  /** 実行中のタスクIDを収集する */
  const runningTaskIds = new Set(
    service.tasks.filter((t) => t.lastStatus === "RUNNING").map((t) => t.taskId),
  );

  /** ターゲットのヘルスステータスを更新する */
  for (const target of service.targetGroup.targets) {
    target.healthy = runningTaskIds.has(target.taskId);
  }

  return service.targetGroup.targets;
}

/** ロードバランサーのルーティング先を取得する（ラウンドロビン） */
let roundRobinIndex = 0;
export function resetRoundRobinIndex(): void {
  roundRobinIndex = 0;
}

export function routeRequest(service: Service): TargetInfo | null {
  if (!service.targetGroup) {
    return null;
  }

  const healthyTargets = service.targetGroup.targets.filter((t) => t.healthy);
  if (healthyTargets.length === 0) {
    return null;
  }

  const target = healthyTargets[roundRobinIndex % healthyTargets.length]!;
  roundRobinIndex++;
  return target;
}
