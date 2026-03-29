/**
 * ECSクラスター: コンテナインスタンス（EC2）の管理、CPU/メモリリソースの追跡
 */

/** コンテナインスタンスの状態 */
export type InstanceStatus = "ACTIVE" | "DRAINING" | "INACTIVE";

/** コンテナインスタンスの定義 */
export interface ContainerInstance {
  /** インスタンスID */
  instanceId: string;
  /** インスタンスタイプ（例: t3.medium） */
  instanceType: string;
  /** 登録済みCPUユニット */
  registeredCpu: number;
  /** 登録済みメモリ（MiB） */
  registeredMemory: number;
  /** 利用可能なCPUユニット */
  availableCpu: number;
  /** 利用可能なメモリ（MiB） */
  availableMemory: number;
  /** インスタンスの状態 */
  status: InstanceStatus;
  /** 実行中のタスクID一覧 */
  runningTaskIds: string[];
  /** 登録日時 */
  registeredAt: number;
}

/** クラスターの状態 */
export type ClusterStatus = "ACTIVE" | "INACTIVE" | "PROVISIONING";

/** クラスターの定義 */
export interface Cluster {
  /** クラスター名 */
  clusterName: string;
  /** クラスターARN */
  clusterArn: string;
  /** クラスターの状態 */
  status: ClusterStatus;
  /** コンテナインスタンス一覧 */
  containerInstances: ContainerInstance[];
  /** 登録済みインスタンス数 */
  registeredContainerInstancesCount: number;
  /** 実行中のタスク数 */
  runningTasksCount: number;
  /** 待機中のタスク数 */
  pendingTasksCount: number;
  /** アクティブなサービス数 */
  activeServicesCount: number;
  /** 作成日時 */
  createdAt: number;
}

/** インスタンスタイプごとのスペック定義 */
const INSTANCE_SPECS: Record<string, { cpu: number; memory: number }> = {
  "t3.micro": { cpu: 2048, memory: 1024 },
  "t3.small": { cpu: 2048, memory: 2048 },
  "t3.medium": { cpu: 2048, memory: 4096 },
  "t3.large": { cpu: 2048, memory: 8192 },
  "m5.large": { cpu: 2048, memory: 8192 },
  "m5.xlarge": { cpu: 4096, memory: 16384 },
  "c5.large": { cpu: 2048, memory: 4096 },
  "c5.xlarge": { cpu: 4096, memory: 8192 },
};

/** 一意なIDを生成する */
let idCounter = 0;
export function generateId(prefix: string): string {
  idCounter++;
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${rand}-${idCounter}`;
}

/** IDカウンターをリセットする（テスト用） */
export function resetIdCounter(): void {
  idCounter = 0;
}

/** クラスターを作成する */
export function createCluster(name: string): Cluster {
  return {
    clusterName: name,
    clusterArn: `arn:aws:ecs:ap-northeast-1:123456789012:cluster/${name}`,
    status: "ACTIVE",
    containerInstances: [],
    registeredContainerInstancesCount: 0,
    runningTasksCount: 0,
    pendingTasksCount: 0,
    activeServicesCount: 0,
    createdAt: Date.now(),
  };
}

/** コンテナインスタンスをクラスターに登録する */
export function registerContainerInstance(
  cluster: Cluster,
  instanceType: string,
): ContainerInstance {
  const spec = INSTANCE_SPECS[instanceType];
  if (!spec) {
    throw new Error(`不明なインスタンスタイプ: ${instanceType}`);
  }

  const instance: ContainerInstance = {
    instanceId: generateId("ci"),
    instanceType,
    registeredCpu: spec.cpu,
    registeredMemory: spec.memory,
    availableCpu: spec.cpu,
    availableMemory: spec.memory,
    status: "ACTIVE",
    runningTaskIds: [],
    registeredAt: Date.now(),
  };

  cluster.containerInstances.push(instance);
  cluster.registeredContainerInstancesCount = cluster.containerInstances.length;
  return instance;
}

/** コンテナインスタンスをドレインモードに設定する */
export function drainContainerInstance(
  cluster: Cluster,
  instanceId: string,
): ContainerInstance {
  const instance = cluster.containerInstances.find(
    (ci) => ci.instanceId === instanceId,
  );
  if (!instance) {
    throw new Error(`インスタンスが見つかりません: ${instanceId}`);
  }
  instance.status = "DRAINING";
  return instance;
}

/** コンテナインスタンスをクラスターから登録解除する */
export function deregisterContainerInstance(
  cluster: Cluster,
  instanceId: string,
): void {
  const index = cluster.containerInstances.findIndex(
    (ci) => ci.instanceId === instanceId,
  );
  if (index === -1) {
    throw new Error(`インスタンスが見つかりません: ${instanceId}`);
  }
  const instance = cluster.containerInstances[index];
  if (instance && instance.runningTaskIds.length > 0) {
    throw new Error(
      `インスタンス上でタスクが実行中です。先にドレインしてください: ${instanceId}`,
    );
  }
  cluster.containerInstances.splice(index, 1);
  cluster.registeredContainerInstancesCount = cluster.containerInstances.length;
}

/** コンテナインスタンスのリソースを予約する */
export function reserveResources(
  instance: ContainerInstance,
  cpu: number,
  memory: number,
): boolean {
  if (instance.availableCpu < cpu || instance.availableMemory < memory) {
    return false;
  }
  instance.availableCpu -= cpu;
  instance.availableMemory -= memory;
  return true;
}

/** コンテナインスタンスのリソースを解放する */
export function releaseResources(
  instance: ContainerInstance,
  cpu: number,
  memory: number,
): void {
  instance.availableCpu = Math.min(
    instance.registeredCpu,
    instance.availableCpu + cpu,
  );
  instance.availableMemory = Math.min(
    instance.registeredMemory,
    instance.availableMemory + memory,
  );
}

/** クラスター全体の利用状況を取得する */
export function getClusterUtilization(cluster: Cluster): {
  totalCpu: number;
  totalMemory: number;
  usedCpu: number;
  usedMemory: number;
  cpuUtilization: number;
  memoryUtilization: number;
} {
  let totalCpu = 0;
  let totalMemory = 0;
  let usedCpu = 0;
  let usedMemory = 0;

  for (const instance of cluster.containerInstances) {
    if (instance.status !== "INACTIVE") {
      totalCpu += instance.registeredCpu;
      totalMemory += instance.registeredMemory;
      usedCpu += instance.registeredCpu - instance.availableCpu;
      usedMemory += instance.registeredMemory - instance.availableMemory;
    }
  }

  return {
    totalCpu,
    totalMemory,
    usedCpu,
    usedMemory,
    cpuUtilization: totalCpu > 0 ? (usedCpu / totalCpu) * 100 : 0,
    memoryUtilization: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
  };
}

/** アクティブなコンテナインスタンスのみ取得する */
export function getActiveInstances(cluster: Cluster): ContainerInstance[] {
  return cluster.containerInstances.filter((ci) => ci.status === "ACTIVE");
}
