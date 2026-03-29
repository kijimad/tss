/**
 * React Hooksのシミュレーション
 * useState, useEffect, useMemo, useCallback, useRefを実装する
 */

import type { Fiber, Hook } from '../fiber/fiber.js';

/** 現在レンダリング中のファイバー */
let currentFiber: Fiber | null = null;
/** 現在のHookインデックス */
let hookIndex = 0;
/** バッチ更新中かどうか */
let isBatching = false;
/** バッチ更新後の再レンダリングコールバック */
let batchCallback: (() => void) | null = null;
/** 保留中のエフェクト */
const pendingEffects: Array<() => void> = [];

/**
 * 現在のファイバーを設定する（レンダリング開始時に呼ばれる）
 */
export function setCurrentFiber(fiber: Fiber): void {
  currentFiber = fiber;
  hookIndex = 0;
  fiber.hookIndex = 0;
}

/**
 * 現在のファイバーをクリアする（レンダリング終了時に呼ばれる）
 */
export function clearCurrentFiber(): void {
  currentFiber = null;
  hookIndex = 0;
}

/**
 * 再レンダリングのコールバックを登録する
 */
export function setRerenderCallback(callback: () => void): void {
  batchCallback = callback;
}

/**
 * 現在のファイバーからHookを取得または作成する
 */
function getOrCreateHook(tag: Hook['tag']): Hook {
  if (!currentFiber) {
    throw new Error('Hookはコンポーネントのレンダリング中にのみ使用できます');
  }

  const existingHook = currentFiber.hooks[hookIndex];
  if (existingHook) {
    hookIndex++;
    currentFiber.hookIndex = hookIndex;
    return existingHook;
  }

  const newHook: Hook = {
    tag,
    memoizedState: null,
    queue: [],
    deps: null,
    cleanup: null,
  };

  currentFiber.hooks.push(newHook);
  hookIndex++;
  currentFiber.hookIndex = hookIndex;
  return newHook;
}

/**
 * useState: 状態管理Hook
 * @param initialValue - 初期値
 * @returns [現在の状態, 状態更新関数] のタプル
 */
export function useState<T>(initialValue: T): [T, (action: T | ((prev: T) => T)) => void] {
  const hook = getOrCreateHook('state');

  // 初回レンダリング時は初期値を設定
  if (hook.memoizedState === null && hook.queue.length === 0) {
    hook.memoizedState = initialValue;
  }

  // キューにたまった更新を適用
  for (const update of hook.queue) {
    const action = update.action;
    if (typeof action === 'function') {
      hook.memoizedState = (action as (prev: T) => T)(hook.memoizedState as T);
    } else {
      hook.memoizedState = action;
    }
  }
  hook.queue = [];

  const state = hook.memoizedState as T;

  // 更新関数をキャプチャ（hookへの参照を保持）
  const capturedHook = hook;
  const setState = (action: T | ((prev: T) => T)): void => {
    capturedHook.queue.push({ action });

    if (!isBatching && batchCallback) {
      batchCallback();
    }
  };

  return [state, setState];
}

/**
 * useEffect: 副作用Hook
 * @param effect - 副作用関数
 * @param deps - 依存配列（省略時は毎回実行）
 */
export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  const hook = getOrCreateHook('effect');
  const prevDeps = hook.deps;

  // 依存配列の比較
  const hasChanged =
    !prevDeps || !deps || deps.some((dep, i) => !Object.is(dep, prevDeps[i]));

  if (hasChanged) {
    hook.deps = deps ?? null;

    // エフェクトを保留リストに追加（コミットフェーズで実行）
    pendingEffects.push(() => {
      // 前回のクリーンアップを実行
      if (hook.cleanup) {
        hook.cleanup();
      }
      const cleanup = effect();
      hook.cleanup = typeof cleanup === 'function' ? cleanup : null;
    });
  }
}

/**
 * useMemo: メモ化Hook
 * @param factory - 値を生成する関数
 * @param deps - 依存配列
 * @returns メモ化された値
 */
export function useMemo<T>(factory: () => T, deps: unknown[]): T {
  const hook = getOrCreateHook('memo');
  const prevDeps = hook.deps;

  const hasChanged =
    !prevDeps || deps.some((dep, i) => !Object.is(dep, prevDeps[i]));

  if (hasChanged) {
    hook.memoizedState = factory();
    hook.deps = deps;
  }

  return hook.memoizedState as T;
}

/**
 * useCallback: コールバックメモ化Hook
 * @param callback - メモ化するコールバック関数
 * @param deps - 依存配列
 * @returns メモ化されたコールバック
 */
export function useCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  deps: unknown[],
): T {
  return useMemo(() => callback, deps);
}

/**
 * useRef: ミュータブル参照Hook
 * @param initialValue - 初期値
 * @returns currentプロパティを持つrefオブジェクト
 */
export function useRef<T>(initialValue: T): { current: T } {
  const hook = getOrCreateHook('ref');

  if (hook.memoizedState === null) {
    hook.memoizedState = { current: initialValue };
  }

  return hook.memoizedState as { current: T };
}

/**
 * バッチ更新を開始する
 * 複数のsetStateを一括で処理する
 */
export function batchUpdates(fn: () => void): void {
  isBatching = true;
  fn();
  isBatching = false;

  // バッチ終了後に再レンダリング
  if (batchCallback) {
    batchCallback();
  }
}

/**
 * 保留中のエフェクトを実行する
 */
export function flushEffects(): void {
  const effects = [...pendingEffects];
  pendingEffects.length = 0;
  for (const effect of effects) {
    effect();
  }
}

/**
 * Hookシステムの状態をリセットする（テスト用）
 */
export function resetHookState(): void {
  currentFiber = null;
  hookIndex = 0;
  isBatching = false;
  batchCallback = null;
  pendingEffects.length = 0;
}
