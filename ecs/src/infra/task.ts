/**
 * タスク: タスク定義の実行インスタンス管理
 * ライフサイクル: PENDING → RUNNING → STOPPED
 * コンテナステータス、配置情報、ログ
 */

import type { TaskDefinition } from "./taskdef.js";
import type { ContainerInstance } from "./cluster.js";
import { generateId, reserveResources, releaseResources } from "./cluster.js";

/** タスクの状態 */
export type TaskStatus = "PENDING" | "RUNNING" | "STOPPED";

/** コンテナの状態 */
export type ContainerStatus =
  | "PENDING"
  | "RUNNING"
  | "STOPPED";

/** ヘルスの状態 */
export type HealthStatus = "HEALTHY" | "UNHEALTHY" | "UNKNOWN";

/** コンテナの実行状態 */
export interface ContainerState {
  /** コンテナ名 */
  name: string;
  /** コンテナのイメージ */
  image: string;
  /** コンテナの状態 */
  status: ContainerStatus;
  /** ヘルス状態 */
  healthStatus: HealthStatus;
  /** 終了コード（停止時のみ） */
  exitCode?: number;
  /** 停止理由 */
  reason?: string;
  /** コンテナのネットワークバインディング */
  networkBindings: { containerPort: number; hostPort: number; protocol: string }[];
}

/** ログエントリ */
export interface LogEntry {
  /** タイムスタンプ */
  timestamp: number;
  /** ストリーム（stdout or stderr） */
  stream: "stdout" | "stderr";
  /** メッセージ */
  message: string;
}

/** タスクの定義 */
export interface Task {
  /** タスクARN */
  taskArn: string;
  /** タスクID */
  taskId: string;
  /** タスク定義ARN */
  taskDefinitionArn: string;
  /** クラスターARN */
  clusterArn: string;
  /** コンテナインスタンスID（配置先） */
  containerInstanceId?: string;
  /** タスクの状態 */
  lastStatus: TaskStatus;
  /** 希望状態 */
  desiredStatus: TaskStatus;
  /** コンテナの状態一覧 */
  containers: ContainerState[];
  /** タスクのCPUユニット */
  cpu: number;
  /** タスクのメモリ（MiB） */
  memory: number;
  /** タスクの開始日時 */
  startedAt?: number;
  /** タスクの停止日時 */
  stoppedAt?: number;
  /** 停止理由 */
  stoppedReason?: string;
  /** コンテナログ */
  logs: LogEntry[];
  /** 作成日時 */
  createdAt: number;
  /** タスクが属するサービス名（オプション） */
  serviceName?: string;
  /** ヘルスチェック結果 */
  healthStatus: HealthStatus;
}

/** 動的ポート割り当て用のカウンター */
let dynamicPortCounter = 49152;

/** 動的ポートカウンターをリセットする（テスト用） */
export function resetDynamicPortCounter(): void {
  dynamicPortCounter = 49152;
}

/** 動的ポートを割り当てる */
function allocateDynamicPort(): number {
  const port = dynamicPortCounter;
  dynamicPortCounter++;
  if (dynamicPortCounter > 65535) {
    dynamicPortCounter = 49152;
  }
  return port;
}

/** タスクを作成する（PENDINGステータス） */
export function createTask(
  taskDef: TaskDefinition,
  clusterArn: string,
  serviceName?: string,
): Task {
  const taskId = generateId("task");
  const containers: ContainerState[] = taskDef.containerDefinitions.map(
    (cd) => ({
      name: cd.name,
      image: cd.image,
      status: "PENDING" as ContainerStatus,
      healthStatus: "UNKNOWN" as HealthStatus,
      networkBindings: cd.portMappings.map((pm) => ({
        containerPort: pm.containerPort,
        hostPort: pm.hostPort === 0 ? allocateDynamicPort() : pm.hostPort,
        protocol: pm.protocol,
      })),
    }),
  );

  return {
    taskArn: `arn:aws:ecs:ap-northeast-1:123456789012:task/${taskId}`,
    taskId,
    taskDefinitionArn: taskDef.taskDefinitionArn,
    clusterArn,
    lastStatus: "PENDING",
    desiredStatus: "RUNNING",
    containers,
    cpu: taskDef.cpu,
    memory: taskDef.memory,
    logs: [],
    createdAt: Date.now(),
    serviceName,
    healthStatus: "UNKNOWN",
  };
}

/** タスクをコンテナインスタンスに配置する */
export function placeTask(
  task: Task,
  instance: ContainerInstance,
): boolean {
  /** リソースを予約する */
  const reserved = reserveResources(instance, task.cpu, task.memory);
  if (!reserved) {
    return false;
  }

  task.containerInstanceId = instance.instanceId;
  instance.runningTaskIds.push(task.taskId);
  return true;
}

/** タスクを開始する（PENDING→RUNNING） */
export function startTask(task: Task): void {
  if (task.lastStatus !== "PENDING") {
    throw new Error(`タスクをPENDING以外から開始できません: ${task.lastStatus}`);
  }

  task.lastStatus = "RUNNING";
  task.startedAt = Date.now();

  /** すべてのコンテナをRUNNINGに変更する */
  for (const container of task.containers) {
    container.status = "RUNNING";
  }

  /** 開始ログを記録する */
  appendLog(task, "stdout", `タスク ${task.taskId} が開始されました`);
}

/** タスクを停止する（→STOPPED） */
export function stopTask(
  task: Task,
  instance: ContainerInstance | undefined,
  reason: string = "ユーザーによる停止",
  exitCode: number = 0,
): void {
  task.lastStatus = "STOPPED";
  task.desiredStatus = "STOPPED";
  task.stoppedAt = Date.now();
  task.stoppedReason = reason;

  /** すべてのコンテナを停止する */
  for (const container of task.containers) {
    container.status = "STOPPED";
    container.exitCode = exitCode;
    container.reason = reason;
  }

  /** コンテナインスタンスのリソースを解放する */
  if (instance) {
    releaseResources(instance, task.cpu, task.memory);
    instance.runningTaskIds = instance.runningTaskIds.filter(
      (id) => id !== task.taskId,
    );
  }

  /** 停止ログを記録する */
  appendLog(task, "stdout", `タスク ${task.taskId} が停止しました: ${reason}`);
}

/** タスクにログを追加する */
export function appendLog(
  task: Task,
  stream: "stdout" | "stderr",
  message: string,
): void {
  task.logs.push({
    timestamp: Date.now(),
    stream,
    message,
  });
}

/** タスクのヘルスチェックを実行する */
export function checkTaskHealth(task: Task): HealthStatus {
  if (task.lastStatus !== "RUNNING") {
    task.healthStatus = "UNKNOWN";
    return "UNKNOWN";
  }

  /** すべてのコンテナがRUNNINGであればHEALTHY */
  const allRunning = task.containers.every((c) => c.status === "RUNNING");
  if (allRunning) {
    task.healthStatus = "HEALTHY";
    for (const container of task.containers) {
      container.healthStatus = "HEALTHY";
    }
    return "HEALTHY";
  }

  task.healthStatus = "UNHEALTHY";
  return "UNHEALTHY";
}

/** タスクのログを取得する */
export function getTaskLogs(
  task: Task,
  stream?: "stdout" | "stderr",
): LogEntry[] {
  if (stream) {
    return task.logs.filter((log) => log.stream === stream);
  }
  return task.logs;
}

/** 実行中のタスクかどうかを判定する */
export function isTaskRunning(task: Task): boolean {
  return task.lastStatus === "RUNNING";
}

/** タスクのCPU使用率をシミュレートする（0-100%） */
export function simulateCpuUtilization(task: Task): number {
  if (task.lastStatus !== "RUNNING") {
    return 0;
  }
  /** ランダムなCPU使用率（20-80%の範囲でシミュレート） */
  return 20 + Math.random() * 60;
}
