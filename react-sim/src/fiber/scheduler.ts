/**
 * ファイバースケジューラー
 * ワークループ、タイムスライシング、優先度レーンをシミュレートする
 */

import type { Fiber } from './fiber.js';
import { EffectTag } from './fiber.js';

/** 優先度レーン */
export enum Lane {
  /** 同期（最高優先度：ユーザー入力など） */
  Sync = 1,
  /** デフォルト（通常の更新） */
  Default = 2,
  /** アイドル（低優先度：プリフェッチなど） */
  Idle = 3,
}

/** スケジュールされた作業単位 */
export interface WorkUnit {
  /** 対象ファイバー */
  fiber: Fiber;
  /** 優先度レーン */
  lane: Lane;
  /** コールバック */
  callback: () => Fiber | null;
}

/** タイムスライスの締め切り情報 */
export interface Deadline {
  /** 残り時間（ミリ秒） */
  timeRemaining: () => number;
  /** タイムアウトしたかどうか */
  didTimeout: boolean;
}

/**
 * requestIdleCallbackのシミュレーション
 * 指定されたフレーム予算内でコールバックを実行する
 */
export function simulateIdleCallback(
  callback: (deadline: Deadline) => void,
  frameBudgetMs: number = 16,
): void {
  const startTime = Date.now();
  const deadline: Deadline = {
    timeRemaining: () => Math.max(0, frameBudgetMs - (Date.now() - startTime)),
    didTimeout: false,
  };
  callback(deadline);
}

/**
 * ファイバースケジューラー
 * Reactのワークループとタイムスライシングをシミュレートする
 */
export class Scheduler {
  /** 作業キュー（優先度順） */
  private workQueue: WorkUnit[] = [];
  /** 現在処理中の作業単位 */
  private currentWork: Fiber | null = null;
  /** 削除対象のファイバーリスト */
  deletions: Fiber[] = [];
  /** 処理済みファイバーのログ */
  processedLog: Array<{ fiber: Fiber; lane: Lane; timestamp: number }> = [];
  /** スケジューラーが実行中かどうか */
  private running = false;

  /**
   * 作業単位をスケジュールする
   */
  scheduleWork(fiber: Fiber, lane: Lane, callback: () => Fiber | null): void {
    this.workQueue.push({ fiber, lane, callback });
    // 優先度順にソート（数値が小さい方が高優先度）
    this.workQueue.sort((a, b) => a.lane - b.lane);
  }

  /**
   * ワークループを開始する
   * タイムスライシングをシミュレートしながらキューの作業を処理する
   */
  startWorkLoop(frameBudgetMs: number = 16): void {
    if (this.running) return;
    this.running = true;

    while (this.workQueue.length > 0) {
      simulateIdleCallback((deadline) => {
        this.performWorkLoop(deadline);
      }, frameBudgetMs);
    }

    this.running = false;
  }

  /**
   * 1フレーム分の作業を実行する
   */
  private performWorkLoop(deadline: Deadline): void {
    let shouldYield = false;

    while (this.workQueue.length > 0 && !shouldYield) {
      const work = this.workQueue[0];
      if (!work) break;

      // Syncレーンは必ず即座に処理する
      if (work.lane === Lane.Sync || deadline.timeRemaining() > 0) {
        this.workQueue.shift();
        this.currentWork = work.fiber;

        const nextFiber = work.callback();
        this.processedLog.push({
          fiber: work.fiber,
          lane: work.lane,
          timestamp: Date.now(),
        });

        // 次のファイバーがあれば同じ優先度でスケジュール
        if (nextFiber) {
          this.scheduleWork(nextFiber, work.lane, () => this.performUnitOfWork(nextFiber));
        }
      }

      // Idleレーンの作業はタイムスライスを尊重する
      if (work.lane === Lane.Idle) {
        shouldYield = deadline.timeRemaining() <= 0;
      }
    }

    this.currentWork = null;
  }

  /**
   * 1つのファイバーに対する作業を実行する
   * 子→兄弟→親の兄弟の順で次の作業単位を返す
   */
  performUnitOfWork(fiber: Fiber): Fiber | null {
    // 子ファイバーがあれば次はそれを処理
    if (fiber.child) {
      return fiber.child;
    }

    // 子がなければ兄弟を探す、なければ親の兄弟を探す
    let current: Fiber | null = fiber;
    while (current) {
      if (current.sibling) {
        return current.sibling;
      }
      current = current.return;
    }

    return null;
  }

  /**
   * ファイバーの副作用タグに基づいてコミット処理を実行する
   */
  commitWork(fiber: Fiber | null): string[] {
    const operations: string[] = [];

    if (!fiber) return operations;

    switch (fiber.effectTag) {
      case EffectTag.PLACEMENT:
        operations.push(`配置: ${this.describeFiber(fiber)}`);
        break;
      case EffectTag.UPDATE:
        operations.push(`更新: ${this.describeFiber(fiber)}`);
        break;
      case EffectTag.DELETION:
        operations.push(`削除: ${this.describeFiber(fiber)}`);
        break;
    }

    // 再帰的にコミット
    operations.push(...this.commitWork(fiber.child));
    operations.push(...this.commitWork(fiber.sibling));

    return operations;
  }

  /** ファイバーの簡易説明を返す */
  private describeFiber(fiber: Fiber): string {
    if (!fiber.vnode) return 'root';
    const typeName =
      typeof fiber.vnode.type === 'function' ? fiber.vnode.type.name : fiber.vnode.type;
    return typeName;
  }

  /** スケジューラーの状態をリセットする */
  reset(): void {
    this.workQueue = [];
    this.currentWork = null;
    this.deletions = [];
    this.processedLog = [];
    this.running = false;
  }

  /** キュー内の作業数を返す */
  get pendingWorkCount(): number {
    return this.workQueue.length;
  }
}
