/**
 * タスク配置スケジューラー: ビンパッキング戦略（最少インスタンスに詰め込む）、
 * スプレッド戦略（均等に分散）、リソース予約管理
 */

import type { Cluster, ContainerInstance } from "./cluster.js";
import type { Task } from "./task.js";
import { placeTask } from "./task.js";

/** 配置戦略の種類 */
export type PlacementStrategy = "binpack" | "spread";

/** 配置結果 */
export interface PlacementResult {
  /** 配置に成功したかどうか */
  success: boolean;
  /** 配置先のインスタンスID */
  instanceId?: string;
  /** 失敗理由 */
  reason?: string;
}

/**
 * ビンパッキング戦略: リソース使用率が高いインスタンスを優先して配置する
 * （使用中のインスタンス数を最小化する）
 */
function selectInstanceBinpack(
  instances: ContainerInstance[],
  requiredCpu: number,
  requiredMemory: number,
): ContainerInstance | undefined {
  /** 配置可能なインスタンスをフィルタする */
  const candidates = instances.filter(
    (inst) =>
      inst.status === "ACTIVE" &&
      inst.availableCpu >= requiredCpu &&
      inst.availableMemory >= requiredMemory,
  );

  if (candidates.length === 0) {
    return undefined;
  }

  /** 空き容量が最も少ないインスタンスを選択する（詰め込み優先） */
  candidates.sort((a, b) => {
    const aRemaining = a.availableCpu + a.availableMemory;
    const bRemaining = b.availableCpu + b.availableMemory;
    return aRemaining - bRemaining;
  });

  return candidates[0];
}

/**
 * スプレッド戦略: タスク数が少ないインスタンスを優先して配置する
 * （インスタンス間でタスクを均等に分散する）
 */
function selectInstanceSpread(
  instances: ContainerInstance[],
  requiredCpu: number,
  requiredMemory: number,
): ContainerInstance | undefined {
  /** 配置可能なインスタンスをフィルタする */
  const candidates = instances.filter(
    (inst) =>
      inst.status === "ACTIVE" &&
      inst.availableCpu >= requiredCpu &&
      inst.availableMemory >= requiredMemory,
  );

  if (candidates.length === 0) {
    return undefined;
  }

  /** タスク数が最も少ないインスタンスを選択する */
  candidates.sort((a, b) => a.runningTaskIds.length - b.runningTaskIds.length);

  return candidates[0];
}

/** 指定された戦略でインスタンスを選択する */
export function selectInstance(
  instances: ContainerInstance[],
  requiredCpu: number,
  requiredMemory: number,
  strategy: PlacementStrategy,
): ContainerInstance | undefined {
  if (strategy === "binpack") {
    return selectInstanceBinpack(instances, requiredCpu, requiredMemory);
  }
  return selectInstanceSpread(instances, requiredCpu, requiredMemory);
}

/** タスクをクラスターに配置する */
export function scheduleTask(
  cluster: Cluster,
  task: Task,
  strategy: PlacementStrategy = "binpack",
): PlacementResult {
  const instance = selectInstance(
    cluster.containerInstances,
    task.cpu,
    task.memory,
    strategy,
  );

  if (!instance) {
    return {
      success: false,
      reason: `リソース不足: CPU=${task.cpu}, Memory=${task.memory} を満たすインスタンスがありません`,
    };
  }

  const placed = placeTask(task, instance);
  if (!placed) {
    return {
      success: false,
      reason: `リソース予約に失敗しました: インスタンス ${instance.instanceId}`,
    };
  }

  return {
    success: true,
    instanceId: instance.instanceId,
  };
}

/** 複数タスクを一括で配置する */
export function scheduleTasks(
  cluster: Cluster,
  tasks: Task[],
  strategy: PlacementStrategy = "binpack",
): PlacementResult[] {
  return tasks.map((task) => scheduleTask(cluster, task, strategy));
}

/** クラスターの配置可能なキャパシティを取得する */
export function getPlaceableCapacity(
  cluster: Cluster,
): { maxCpu: number; maxMemory: number; totalAvailableCpu: number; totalAvailableMemory: number } {
  let maxCpu = 0;
  let maxMemory = 0;
  let totalAvailableCpu = 0;
  let totalAvailableMemory = 0;

  for (const instance of cluster.containerInstances) {
    if (instance.status === "ACTIVE") {
      maxCpu = Math.max(maxCpu, instance.availableCpu);
      maxMemory = Math.max(maxMemory, instance.availableMemory);
      totalAvailableCpu += instance.availableCpu;
      totalAvailableMemory += instance.availableMemory;
    }
  }

  return { maxCpu, maxMemory, totalAvailableCpu, totalAvailableMemory };
}
