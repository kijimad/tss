/**
 * DOMツリーの定義と操作
 * 要素ノードとテキストノードの構造を提供する
 */

/** 要素ノード */
export interface ElementNode {
  type: 'element';
  tagName: string;
  attributes: Record<string, string>;
  children: DomNode[];
}

/** テキストノード */
export interface TextNode {
  type: 'text';
  text: string;
}

/** DOMノード（要素またはテキスト） */
export type DomNode = ElementNode | TextNode;

/**
 * 要素ノードを生成する
 */
export function createElement(
  tagName: string,
  attributes: Record<string, string> = {},
  children: DomNode[] = [],
): ElementNode {
  return { type: 'element', tagName, attributes, children };
}

/**
 * テキストノードを生成する
 */
export function createTextNode(text: string): TextNode {
  return { type: 'text', text };
}

/**
 * IDで要素を検索する（深さ優先探索）
 */
export function getElementById(root: DomNode, id: string): ElementNode | null {
  if (root.type === 'text') return null;

  if (root.attributes['id'] === id) {
    return root;
  }

  for (const child of root.children) {
    const found = getElementById(child, id);
    if (found) return found;
  }

  return null;
}

/**
 * タグ名で要素を検索する（深さ優先探索）
 */
export function getElementsByTagName(root: DomNode, tagName: string): ElementNode[] {
  const results: ElementNode[] = [];

  function walk(node: DomNode): void {
    if (node.type === 'text') return;

    if (node.tagName === tagName) {
      results.push(node);
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  return results;
}

/**
 * 簡易querySelectorの実装
 * タグ名、.クラス名、#ID のシンプルなセレクタに対応
 */
export function querySelector(root: DomNode, selector: string): ElementNode | null {
  function matches(node: ElementNode, sel: string): boolean {
    if (sel.startsWith('#')) {
      return node.attributes['id'] === sel.slice(1);
    }
    if (sel.startsWith('.')) {
      const classes = (node.attributes['class'] ?? '').split(/\s+/);
      return classes.includes(sel.slice(1));
    }
    return node.tagName === sel;
  }

  function walk(node: DomNode): ElementNode | null {
    if (node.type === 'text') return null;

    if (matches(node, selector)) {
      return node;
    }

    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }

    return null;
  }

  return walk(root);
}

/**
 * DOMツリーを文字列として整形する（デバッグ用）
 */
export function printDomTree(node: DomNode, indent: number = 0): string {
  const pad = '  '.repeat(indent);

  if (node.type === 'text') {
    return `${pad}"${node.text}"`;
  }

  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');

  const lines = [`${pad}<${node.tagName}${attrs}>`];

  for (const child of node.children) {
    lines.push(printDomTree(child, indent + 1));
  }

  lines.push(`${pad}</${node.tagName}>`);
  return lines.join('\n');
}
