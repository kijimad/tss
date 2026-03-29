/**
 * Fiberノード構造の定義
 * Reactの内部ファイバーアーキテクチャをシミュレートする
 */

import type { VNode, Props } from '../vdom/element.js';

/** Fiberノードのタグ（種類） */
export enum FiberTag {
  /** ホスト（DOM）要素 */
  HOST = 'HOST',
  /** 関数コンポーネント */
  FUNCTION = 'FUNCTION',
  /** テキストノード */
  TEXT = 'TEXT',
  /** ルートファイバー */
  ROOT = 'ROOT',
}

/** 副作用タグ */
export enum EffectTag {
  /** 新規配置 */
  PLACEMENT = 'PLACEMENT',
  /** 更新 */
  UPDATE = 'UPDATE',
  /** 削除 */
  DELETION = 'DELETION',
  /** なし */
  NONE = 'NONE',
}

/** Hookの型定義 */
export interface Hook {
  /** Hook の種類 */
  tag: 'state' | 'effect' | 'memo' | 'callback' | 'ref';
  /** 現在の状態またはメモ化された値 */
  memoizedState: unknown;
  /** 状態更新キュー（useStateの場合） */
  queue: Array<StateUpdate>;
  /** 依存配列（useEffect, useMemoの場合） */
  deps: unknown[] | null;
  /** クリーンアップ関数（useEffectの場合） */
  cleanup: (() => void) | null;
}

/** 状態更新のキュー要素 */
export interface StateUpdate {
  /** 新しい値、または更新関数 */
  action: unknown | ((prev: unknown) => unknown);
}

/** Fiberノード */
export interface Fiber {
  /** ファイバーの種類 */
  tag: FiberTag;
  /** 対応するVNode */
  vnode: VNode | null;
  /** プロパティ */
  props: Props;
  /** 実DOM（シミュレーション上の参照） */
  stateNode: unknown;

  /** 最初の子ファイバー */
  child: Fiber | null;
  /** 兄弟ファイバー */
  sibling: Fiber | null;
  /** 親ファイバー */
  return: Fiber | null;

  /** 副作用タグ */
  effectTag: EffectTag;
  /** Hookリスト */
  hooks: Hook[];
  /** 現在のHookインデックス（レンダリング中に使用） */
  hookIndex: number;

  /** 代替ファイバー（ダブルバッファリング用） */
  alternate: Fiber | null;
  /** キー */
  key: string | number | null;
}

/**
 * 新しいFiberノードを作成する
 */
export function createFiber(
  tag: FiberTag,
  vnode: VNode | null,
  props: Props = {},
): Fiber {
  return {
    tag,
    vnode,
    props,
    stateNode: null,
    child: null,
    sibling: null,
    return: null,
    effectTag: EffectTag.NONE,
    hooks: [],
    hookIndex: 0,
    alternate: null,
    key: vnode?.key ?? null,
  };
}

/**
 * VNodeからFiberを生成する
 */
export function createFiberFromVNode(vnode: VNode): Fiber {
  const tag = getFiberTag(vnode);
  const fiber = createFiber(tag, vnode, vnode.props);
  fiber.key = vnode.key;
  return fiber;
}

/**
 * VNodeに対応するFiberTagを決定する
 */
function getFiberTag(vnode: VNode): FiberTag {
  if (typeof vnode.type === 'function') {
    return FiberTag.FUNCTION;
  }
  if (vnode.type === '__TEXT__') {
    return FiberTag.TEXT;
  }
  return FiberTag.HOST;
}

/**
 * Fiberツリーを走査してすべてのファイバーを収集する（デバッグ用）
 */
export function collectFibers(root: Fiber): Fiber[] {
  const fibers: Fiber[] = [];

  function traverse(fiber: Fiber | null): void {
    if (!fiber) return;
    fibers.push(fiber);
    traverse(fiber.child);
    traverse(fiber.sibling);
  }

  traverse(root);
  return fibers;
}
