/**
 * 仮想DOM要素の定義
 * React.createElementに相当する関数とVNode型を提供する
 */

/** VNodeのプロパティ型 */
export type Props = Record<string, unknown>;

/** 仮想DOMノードの型定義 */
export interface VNode {
  /** 要素タイプ（タグ名またはコンポーネント関数） */
  type: string | ComponentFunction;
  /** プロパティ */
  props: Props;
  /** 子ノード */
  children: VNode[];
  /** キー（再順序付けの最適化用） */
  key: string | number | null;
}

/** テキストノードを表す特別なタイプ */
export const TEXT_NODE = '__TEXT__';

/** コンポーネント関数の型 */
export type ComponentFunction = (props: Props) => VNode;

/**
 * テキストVNodeを作成する
 * @param text - テキスト内容
 * @returns テキストVNode
 */
export function createTextNode(text: string | number): VNode {
  return {
    type: TEXT_NODE,
    props: { nodeValue: String(text) },
    children: [],
    key: null,
  };
}

/**
 * 仮想DOM要素を作成する（React.createElementに相当）
 * @param type - 要素タイプ（タグ名またはコンポーネント関数）
 * @param props - プロパティ（nullの場合は空オブジェクト）
 * @param children - 子要素（可変長引数）
 * @returns VNode
 */
export function createElement(
  type: string | ComponentFunction,
  props: Props | null,
  ...children: (VNode | string | number | null | undefined | boolean)[]
): VNode {
  const resolvedProps = props ?? {};
  const key = (resolvedProps['key'] as string | number | null) ?? null;

  // keyはpropsから除外する
  const filteredProps: Props = {};
  for (const [k, v] of Object.entries(resolvedProps)) {
    if (k !== 'key') {
      filteredProps[k] = v;
    }
  }

  // 子要素をVNodeに正規化する
  const normalizedChildren: VNode[] = children
    .filter((c): c is VNode | string | number => c != null && typeof c !== 'boolean')
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return createTextNode(child);
      }
      return child;
    });

  return {
    type,
    props: filteredProps,
    children: normalizedChildren,
    key,
  };
}

/**
 * VNodeがテキストノードかどうかを判定する
 */
export function isTextNode(node: VNode): boolean {
  return node.type === TEXT_NODE;
}

/**
 * VNodeがコンポーネントかどうかを判定する
 */
export function isComponent(node: VNode): boolean {
  return typeof node.type === 'function';
}
