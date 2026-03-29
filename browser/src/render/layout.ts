/**
 * レイアウト（リフロー）エンジン
 * ブロックレイアウトとインラインレイアウトを計算する
 * ボックスモデル（content, padding, border, margin）を処理する
 */

import type { DomNode, ElementNode } from '../dom/dom';
import type { StyleMap, ComputedStyles } from './style';

/** ボックスモデルの各辺のサイズ */
export interface EdgeSizes {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** レイアウトボックスの寸法 */
export interface Dimensions {
  /** コンテンツ領域 */
  content: { x: number; y: number; width: number; height: number };
  padding: EdgeSizes;
  border: EdgeSizes;
  margin: EdgeSizes;
}

/** レイアウトボックスの種類 */
export type BoxType = 'block' | 'inline' | 'none';

/** レイアウトボックス */
export interface LayoutBox {
  dimensions: Dimensions;
  boxType: BoxType;
  node: ElementNode | null;
  children: LayoutBox[];
}

/**
 * エッジサイズの初期値（全て0）
 */
function zeroEdges(): EdgeSizes {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * 寸法の初期値
 */
function zeroDimensions(): Dimensions {
  return {
    content: { x: 0, y: 0, width: 0, height: 0 },
    padding: zeroEdges(),
    border: zeroEdges(),
    margin: zeroEdges(),
  };
}

/**
 * CSSの値をピクセル数に変換する
 */
export function parsePx(value: string | undefined): number {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

/**
 * ボックスの表示種類を判定する
 */
function getBoxType(styles: ComputedStyles | undefined): BoxType {
  const display = styles?.get('display') ?? 'block';
  if (display === 'none') return 'none';
  if (display === 'inline') return 'inline';
  return 'block';
}

/**
 * DOMツリーからレイアウトツリーを構築する
 */
export function buildLayoutTree(root: DomNode, styleMap: StyleMap): LayoutBox | null {
  if (root.type === 'text') {
    // テキストノードはインラインボックスとして扱う
    return {
      dimensions: zeroDimensions(),
      boxType: 'inline',
      node: null,
      children: [],
    };
  }

  const styles = styleMap.get(root);
  const boxType = getBoxType(styles);

  if (boxType === 'none') return null;

  const children: LayoutBox[] = [];
  for (const child of root.children) {
    const childBox = buildLayoutTree(child, styleMap);
    if (childBox) {
      children.push(childBox);
    }
  }

  return {
    dimensions: zeroDimensions(),
    boxType,
    node: root,
    children,
  };
}

/**
 * レイアウト計算を実行する
 * 親コンテナの幅を基にレイアウトを行う
 */
export function computeLayout(box: LayoutBox, containerWidth: number, styleMap: StyleMap): void {
  if (box.boxType === 'block') {
    layoutBlock(box, containerWidth, styleMap);
  } else if (box.boxType === 'inline') {
    layoutInline(box, styleMap);
  }
}

/**
 * ブロックレイアウト: 上から下へ、親の幅いっぱいに配置する
 */
function layoutBlock(box: LayoutBox, containerWidth: number, styleMap: StyleMap): void {
  const styles = box.node ? styleMap.get(box.node) : undefined;
  const d = box.dimensions;

  // マージン、パディング、ボーダーを計算
  d.margin.top = parsePx(styles?.get('margin-top') ?? styles?.get('margin'));
  d.margin.bottom = parsePx(styles?.get('margin-bottom') ?? styles?.get('margin'));
  d.margin.left = parsePx(styles?.get('margin-left') ?? styles?.get('margin'));
  d.margin.right = parsePx(styles?.get('margin-right') ?? styles?.get('margin'));

  d.padding.top = parsePx(styles?.get('padding-top') ?? styles?.get('padding'));
  d.padding.bottom = parsePx(styles?.get('padding-bottom') ?? styles?.get('padding'));
  d.padding.left = parsePx(styles?.get('padding-left') ?? styles?.get('padding'));
  d.padding.right = parsePx(styles?.get('padding-right') ?? styles?.get('padding'));

  d.border.top = parsePx(styles?.get('border-width'));
  d.border.bottom = parsePx(styles?.get('border-width'));
  d.border.left = parsePx(styles?.get('border-width'));
  d.border.right = parsePx(styles?.get('border-width'));

  // 幅を計算（明示的な幅があればそれを使用、なければ親の幅 - マージン等）
  const specifiedWidth = styles?.get('width');
  if (specifiedWidth) {
    d.content.width = parsePx(specifiedWidth);
  } else {
    const totalHorizontal =
      d.margin.left + d.border.left + d.padding.left +
      d.padding.right + d.border.right + d.margin.right;
    d.content.width = Math.max(0, containerWidth - totalHorizontal);
  }

  // 子要素をレイアウト
  let cursorY = 0;
  for (const child of box.children) {
    computeLayout(child, d.content.width, styleMap);
    const childD = child.dimensions;

    // 子のY位置を設定
    childD.content.y = cursorY + childD.margin.top + childD.border.top + childD.padding.top;
    childD.content.x = childD.margin.left + childD.border.left + childD.padding.left;

    // 次の子のY位置を更新
    cursorY = childD.content.y + childD.content.height +
      childD.padding.bottom + childD.border.bottom + childD.margin.bottom;
  }

  // 高さを計算（明示的な高さがなければ子要素の合計高さ）
  const specifiedHeight = styles?.get('height');
  if (specifiedHeight) {
    d.content.height = parsePx(specifiedHeight);
  } else {
    d.content.height = cursorY;
  }
}

/**
 * インラインレイアウト: 左から右へ配置する
 * テキスト幅は仮の値を使用（文字数 * フォントサイズの概算）
 */
function layoutInline(box: LayoutBox, styleMap: StyleMap): void {
  const styles = box.node ? styleMap.get(box.node) : undefined;
  const fontSize = parsePx(styles?.get('font-size')) || 16;

  // インライン要素の仮のサイズ
  box.dimensions.content.width = parsePx(styles?.get('width')) || fontSize * 5;
  box.dimensions.content.height = parsePx(styles?.get('height')) || fontSize;
}

/**
 * ボックスの外側の総幅を計算する
 */
export function marginBoxWidth(d: Dimensions): number {
  return d.content.width +
    d.padding.left + d.padding.right +
    d.border.left + d.border.right +
    d.margin.left + d.margin.right;
}

/**
 * ボックスの外側の総高さを計算する
 */
export function marginBoxHeight(d: Dimensions): number {
  return d.content.height +
    d.padding.top + d.padding.bottom +
    d.border.top + d.border.bottom +
    d.margin.top + d.margin.bottom;
}
