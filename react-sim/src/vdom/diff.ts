/**
 * 仮想DOMの差分検出（Reconciliation）アルゴリズム
 * 旧VNodeツリーと新VNodeツリーを比較し、最小限のパッチを生成する
 */

import type { VNode, Props } from './element.js';
import { TEXT_NODE } from './element.js';

/** パッチの種類 */
export enum PatchType {
  /** 新しいノードを挿入 */
  INSERT = 'INSERT',
  /** ノードを削除 */
  REMOVE = 'REMOVE',
  /** プロパティを更新 */
  UPDATE = 'UPDATE',
  /** ノードを置換 */
  REPLACE = 'REPLACE',
  /** 子ノードの並び替え（キー付き） */
  REORDER = 'REORDER',
}

/** パッチ操作の型定義 */
export interface Patch {
  type: PatchType;
  /** パッチ適用先のパス（ルートからのインデックス列） */
  path: number[];
  /** 新しいVNode（INSERT, REPLACEの場合） */
  newNode?: VNode;
  /** 古いVNode（REMOVE, REPLACEの場合） */
  oldNode?: VNode;
  /** 更新するプロパティ（UPDATEの場合） */
  propChanges?: PropChange[];
  /** 並び替え移動操作（REORDERの場合） */
  moves?: ReorderMove[];
}

/** プロパティ変更の詳細 */
export interface PropChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

/** 並び替え操作の型 */
export interface ReorderMove {
  type: 'insert' | 'remove';
  index: number;
  node?: VNode;
}

/**
 * 二つのVNodeツリーを比較して差分パッチのリストを生成する
 * @param oldTree - 旧ツリー（nullは初回レンダリングを意味する）
 * @param newTree - 新ツリー（nullはアンマウントを意味する）
 * @param path - 現在のパス（再帰用）
 * @returns パッチの配列
 */
export function diff(
  oldTree: VNode | null,
  newTree: VNode | null,
  path: number[] = [],
): Patch[] {
  const patches: Patch[] = [];

  // 旧ノードが無い場合：挿入
  if (oldTree === null && newTree !== null) {
    patches.push({ type: PatchType.INSERT, path: [...path], newNode: newTree });
    return patches;
  }

  // 新ノードが無い場合：削除
  if (oldTree !== null && newTree === null) {
    patches.push({ type: PatchType.REMOVE, path: [...path], oldNode: oldTree });
    return patches;
  }

  // 両方nullの場合：何もしない
  if (oldTree === null || newTree === null) {
    return patches;
  }

  // ノードのタイプが異なる場合：置換
  if (oldTree.type !== newTree.type) {
    patches.push({
      type: PatchType.REPLACE,
      path: [...path],
      oldNode: oldTree,
      newNode: newTree,
    });
    return patches;
  }

  // テキストノードの場合：値が変わったら更新
  if (oldTree.type === TEXT_NODE && newTree.type === TEXT_NODE) {
    if (oldTree.props['nodeValue'] !== newTree.props['nodeValue']) {
      patches.push({
        type: PatchType.UPDATE,
        path: [...path],
        propChanges: [
          {
            key: 'nodeValue',
            oldValue: oldTree.props['nodeValue'],
            newValue: newTree.props['nodeValue'],
          },
        ],
      });
    }
    return patches;
  }

  // プロパティの差分を検出
  const propChanges = diffProps(oldTree.props, newTree.props);
  if (propChanges.length > 0) {
    patches.push({
      type: PatchType.UPDATE,
      path: [...path],
      propChanges,
    });
  }

  // 子ノードの差分を検出（キー付きの場合はREORDERを使う）
  const childPatches = diffChildren(oldTree.children, newTree.children, path);
  patches.push(...childPatches);

  return patches;
}

/**
 * プロパティの差分を検出する
 * @param oldProps - 旧プロパティ
 * @param newProps - 新プロパティ
 * @returns プロパティ変更の配列
 */
export function diffProps(oldProps: Props, newProps: Props): PropChange[] {
  const changes: PropChange[] = [];
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);

  for (const key of allKeys) {
    const oldVal = oldProps[key];
    const newVal = newProps[key];

    if (oldVal !== newVal) {
      changes.push({ key, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}

/**
 * 子ノードリストの差分を検出する
 * キーが存在する場合はREORDER操作を生成する
 */
export function diffChildren(
  oldChildren: VNode[],
  newChildren: VNode[],
  parentPath: number[],
): Patch[] {
  const patches: Patch[] = [];

  // キー付きノードが存在するかチェック
  const hasKeys =
    oldChildren.some((c) => c.key !== null) || newChildren.some((c) => c.key !== null);

  if (hasKeys) {
    // キーベースの差分検出
    const keyedPatches = diffKeyedChildren(oldChildren, newChildren, parentPath);
    patches.push(...keyedPatches);
  } else {
    // インデックスベースの差分検出
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
      const oldChild = oldChildren[i] ?? null;
      const newChild = newChildren[i] ?? null;
      const childPatches = diff(oldChild, newChild, [...parentPath, i]);
      patches.push(...childPatches);
    }
  }

  return patches;
}

/**
 * キー付き子ノードの差分検出（REORDER対応）
 */
function diffKeyedChildren(
  oldChildren: VNode[],
  newChildren: VNode[],
  parentPath: number[],
): Patch[] {
  const patches: Patch[] = [];
  const moves: ReorderMove[] = [];

  // 旧ノードをキーでマップ化
  const oldKeyMap = new Map<string | number, { node: VNode; index: number }>();
  oldChildren.forEach((child, index) => {
    if (child.key !== null) {
      oldKeyMap.set(child.key, { node: child, index });
    }
  });

  // 新しいキーのセット
  const newKeySet = new Set(newChildren.map((c) => c.key).filter((k) => k !== null));

  // 旧リストから削除されたノードを検出
  for (const [key, { index }] of oldKeyMap) {
    if (!newKeySet.has(key)) {
      moves.push({ type: 'remove', index });
    }
  }

  // 新リストの各ノードを処理
  newChildren.forEach((newChild, newIndex) => {
    if (newChild.key !== null) {
      const oldEntry = oldKeyMap.get(newChild.key);
      if (oldEntry) {
        // 既存ノードの更新：再帰的にdiffを実行
        const childPatches = diff(oldEntry.node, newChild, [...parentPath, newIndex]);
        patches.push(...childPatches);
      } else {
        // 新規ノードの挿入
        moves.push({ type: 'insert', index: newIndex, node: newChild });
      }
    } else {
      // キーなしノードはインデックスベースで処理
      const oldChild = oldChildren[newIndex] ?? null;
      const childPatches = diff(oldChild, newChild, [...parentPath, newIndex]);
      patches.push(...childPatches);
    }
  });

  if (moves.length > 0) {
    patches.push({
      type: PatchType.REORDER,
      path: [...parentPath],
      moves,
    });
  }

  return patches;
}
