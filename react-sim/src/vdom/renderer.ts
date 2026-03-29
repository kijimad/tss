/**
 * 仮想DOMレンダラー
 * パッチをシミュレートされたDOMに適用し、操作履歴を追跡する
 */

import type { VNode } from './element.js';
import { TEXT_NODE } from './element.js';
import type { Patch } from './diff.js';
import { PatchType } from './diff.js';

/** シミュレートされたDOM要素 */
export interface SimDOMNode {
  /** タグ名（テキストノードの場合は'#text'） */
  tag: string;
  /** プロパティ */
  props: Record<string, unknown>;
  /** 子ノード */
  children: SimDOMNode[];
  /** テキスト内容（テキストノードの場合） */
  textContent?: string;
}

/** レンダリング操作の記録 */
export interface RenderOperation {
  /** 操作の種類 */
  type: string;
  /** 対象パス */
  path: number[];
  /** 操作の詳細 */
  detail: string;
  /** タイムスタンプ */
  timestamp: number;
}

/**
 * VNodeからシミュレートされたDOMノードを作成する
 */
export function createSimDOMNode(vnode: VNode): SimDOMNode {
  if (vnode.type === TEXT_NODE) {
    return {
      tag: '#text',
      props: {},
      children: [],
      textContent: String(vnode.props['nodeValue'] ?? ''),
    };
  }

  const node: SimDOMNode = {
    tag: typeof vnode.type === 'string' ? vnode.type : 'component',
    props: { ...vnode.props },
    children: vnode.children.map(createSimDOMNode),
  };

  return node;
}

/**
 * パスを辿ってDOMノードを取得する
 */
function getNodeAtPath(root: SimDOMNode, path: number[]): SimDOMNode | null {
  let current: SimDOMNode | undefined = root;
  for (const index of path) {
    current = current?.children[index];
    if (!current) return null;
  }
  return current;
}

/**
 * パスを辿って親ノードとインデックスを取得する
 */
function getParentAndIndex(
  root: SimDOMNode,
  path: number[],
): { parent: SimDOMNode; index: number } | null {
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  if (index === undefined) return null;
  const parent = parentPath.length === 0 ? root : getNodeAtPath(root, parentPath);
  if (!parent) return null;
  return { parent, index };
}

/**
 * シミュレートされたDOMレンダラー
 * パッチ適用と操作履歴を管理する
 */
export class Renderer {
  /** 現在のDOMツリー */
  root: SimDOMNode | null = null;
  /** 操作履歴 */
  operations: RenderOperation[] = [];

  /**
   * VNodeからの初回レンダリング
   */
  render(vnode: VNode): SimDOMNode {
    this.root = createSimDOMNode(vnode);
    this.recordOperation('RENDER', [], `初回レンダリング: ${this.getNodeDesc(this.root)}`);
    return this.root;
  }

  /**
   * パッチ配列をDOMに適用する
   */
  applyPatches(patches: Patch[]): void {
    if (!this.root) return;

    for (const patch of patches) {
      this.applyPatch(patch);
    }
  }

  /**
   * 単一パッチの適用
   */
  private applyPatch(patch: Patch): void {
    if (!this.root) return;

    switch (patch.type) {
      case PatchType.INSERT: {
        if (patch.newNode) {
          const newDOMNode = createSimDOMNode(patch.newNode);
          if (patch.path.length === 0) {
            // ルートノードの挿入
            this.root = newDOMNode;
          } else {
            const result = getParentAndIndex(this.root, patch.path);
            if (result) {
              result.parent.children.splice(result.index, 0, newDOMNode);
            }
          }
          this.recordOperation('INSERT', patch.path, `ノード挿入: ${this.getNodeDesc(newDOMNode)}`);
        }
        break;
      }

      case PatchType.REMOVE: {
        const result = getParentAndIndex(this.root, patch.path);
        if (result) {
          result.parent.children.splice(result.index, 1);
        }
        this.recordOperation('REMOVE', patch.path, 'ノード削除');
        break;
      }

      case PatchType.UPDATE: {
        const node = patch.path.length === 0 ? this.root : getNodeAtPath(this.root, patch.path);
        if (node && patch.propChanges) {
          for (const change of patch.propChanges) {
            if (change.key === 'nodeValue' && node.tag === '#text') {
              node.textContent = String(change.newValue ?? '');
            } else if (change.newValue === undefined) {
              // プロパティの削除
              const { [change.key]: _, ...rest } = node.props;
              void _;
              node.props = rest;
            } else {
              node.props[change.key] = change.newValue;
            }
          }
          const details = patch.propChanges.map((c) => `${c.key}: ${String(c.oldValue)} → ${String(c.newValue)}`).join(', ');
          this.recordOperation('UPDATE', patch.path, `プロパティ更新: ${details}`);
        }
        break;
      }

      case PatchType.REPLACE: {
        if (patch.newNode) {
          const newDOMNode = createSimDOMNode(patch.newNode);
          if (patch.path.length === 0) {
            this.root = newDOMNode;
          } else {
            const result = getParentAndIndex(this.root, patch.path);
            if (result) {
              result.parent.children[result.index] = newDOMNode;
            }
          }
          this.recordOperation('REPLACE', patch.path, `ノード置換: ${this.getNodeDesc(newDOMNode)}`);
        }
        break;
      }

      case PatchType.REORDER: {
        if (patch.moves) {
          const moveDescs = patch.moves.map(
            (m) => `${m.type}@${String(m.index)}`,
          );
          this.recordOperation('REORDER', patch.path, `並び替え: ${moveDescs.join(', ')}`);
        }
        break;
      }
    }
  }

  /** ノードの簡易説明文を生成する */
  private getNodeDesc(node: SimDOMNode): string {
    if (node.tag === '#text') {
      return `text("${node.textContent ?? ''}")`;
    }
    return `<${node.tag}>`;
  }

  /** 操作履歴を記録する */
  private recordOperation(type: string, path: number[], detail: string): void {
    this.operations.push({
      type,
      path: [...path],
      detail,
      timestamp: Date.now(),
    });
  }

  /** 操作履歴をクリアする */
  clearOperations(): void {
    this.operations = [];
  }
}
