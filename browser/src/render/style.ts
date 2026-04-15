/**
 * スタイル解決モジュール
 * CSSOMから各要素の計算済みスタイルを決定する
 * カスケード、詳細度、継承を処理する
 */

import type { DomNode, ElementNode } from '../dom/dom';
import type { Stylesheet, CssRule, Selector, SelectorPart } from '../parser/css';
import { calculateSpecificity } from '../parser/css';

/** 計算済みスタイル（プロパティ名→値のマップ） */
export type ComputedStyles = Map<string, string>;

/** 要素とその計算済みスタイルの対応 */
export type StyleMap = Map<ElementNode, ComputedStyles>;

/** 継承するプロパティの一覧 */
const INHERITED_PROPERTIES = new Set([
  'color',
  'font-size',
]);

/** デフォルトスタイル（ユーザーエージェントスタイルシート相当） */
const DEFAULT_STYLES: Record<string, Record<string, string>> = {
  div: { display: 'block' },
  p: { display: 'block' },
  h1: { display: 'block', 'font-size': '32px' },
  h2: { display: 'block', 'font-size': '24px' },
  h3: { display: 'block', 'font-size': '20px' },
  ul: { display: 'block' },
  li: { display: 'block' },
  span: { display: 'inline' },
  strong: { display: 'inline' },
  em: { display: 'inline' },
  a: { display: 'inline', color: 'blue' },
  body: { display: 'block' },
  html: { display: 'block' },
  head: { display: 'none' },
  title: { display: 'none' },
  img: { display: 'inline' },
};

/**
 * セレクタが要素にマッチするか判定する
 * 子孫コンビネータも処理する
 */
export function matchesSelector(
  element: ElementNode,
  selector: Selector,
  ancestors: ElementNode[],
): boolean {
  const { parts } = selector;

  if (parts.length === 0) return false;

  // 最後のセグメントが対象要素にマッチするか確認
  const lastSegment = parts[parts.length - 1];
  if (!lastSegment || !matchesSegment(element, lastSegment)) {
    return false;
  }

  // 子孫コンビネータ: 残りのセグメントが先祖にマッチするか確認
  if (parts.length === 1) return true;

  let segmentIdx = parts.length - 2;
  for (let i = ancestors.length - 1; i >= 0 && segmentIdx >= 0; i--) {
    const ancestor = ancestors[i];
    const segment = parts[segmentIdx];
    if (ancestor && segment && matchesSegment(ancestor, segment)) {
      segmentIdx--;
    }
  }

  return segmentIdx < 0;
}

/**
 * 1つのセレクタセグメントが要素にマッチするか確認する
 */
function matchesSegment(element: ElementNode, segment: SelectorPart[]): boolean {
  for (const part of segment) {
    switch (part.type) {
      case 'tag':
        if (element.tagName !== part.name) return false;
        break;
      case 'class': {
        const classes = (element.attributes['class'] ?? '').split(/\s+/);
        if (!classes.includes(part.name)) return false;
        break;
      }
      case 'id':
        if (element.attributes['id'] !== part.name) return false;
        break;
    }
  }
  return true;
}

/**
 * マッチしたルールを詳細度と出現順でソートする
 */
interface MatchedRule {
  rule: CssRule;
  specificity: number;
}

/**
 * DOMツリー全体のスタイルを解決する
 */
export function resolveStyles(root: DomNode, stylesheet: Stylesheet): StyleMap {
  const styleMap: StyleMap = new Map();

  /** DOMツリーを再帰的に走査し、各要素のスタイルを計算する */
  function walk(node: DomNode, ancestors: ElementNode[], parentStyles: ComputedStyles): void {
    if (node.type === 'text') return;

    // この要素の計算済みスタイルを決定
    const computed = computeStyleForElement(node, ancestors, stylesheet, parentStyles);
    styleMap.set(node, computed);

    // 子要素を再帰的に処理
    const newAncestors = [...ancestors, node];
    for (const child of node.children) {
      walk(child, newAncestors, computed);
    }
  }

  walk(root, [], new Map());
  return styleMap;
}

/**
 * 1つの要素の計算済みスタイルを決定する
 */
function computeStyleForElement(
  element: ElementNode,
  ancestors: ElementNode[],
  stylesheet: Stylesheet,
  parentStyles: ComputedStyles,
): ComputedStyles {
  const computed: ComputedStyles = new Map();

  // 1. デフォルトスタイルを適用
  const defaults = DEFAULT_STYLES[element.tagName];
  if (defaults) {
    for (const [prop, val] of Object.entries(defaults)) {
      computed.set(prop, val);
    }
  }

  // 2. 親からの継承プロパティを適用
  for (const prop of INHERITED_PROPERTIES) {
    const parentValue = parentStyles.get(prop);
    if (parentValue) {
      computed.set(prop, parentValue);
    }
  }

  // 3. マッチするCSSルールを収集し、詳細度順に適用（カスケード）
  const matched: MatchedRule[] = [];

  for (const rule of stylesheet.rules) {
    if (matchesSelector(element, rule.selector, ancestors)) {
      matched.push({
        rule,
        specificity: calculateSpecificity(rule.selector),
      });
    }
  }

  // 詳細度昇順→出現順昇順でソート（後のものが優先）
  matched.sort((a, b) => {
    if (a.specificity !== b.specificity) {
      return a.specificity - b.specificity;
    }
    return a.rule.order - b.rule.order;
  });

  // ソート順に適用（最後に適用されたものが有効）
  for (const { rule } of matched) {
    for (const decl of rule.declarations) {
      computed.set(decl.property, decl.value);
    }
  }

  return computed;
}
