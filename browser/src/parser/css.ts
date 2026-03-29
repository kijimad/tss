/**
 * CSSパーサー
 * CSSテキストを解析し、ルール・セレクタ・プロパティを抽出する
 * 詳細度（specificity）の計算も行う
 */

/** CSSプロパティの値 */
export interface CssDeclaration {
  property: string;
  value: string;
}

/** セレクタの種類 */
export type SelectorPart =
  | { type: 'tag'; name: string }
  | { type: 'class'; name: string }
  | { type: 'id'; name: string };

/** セレクタ（子孫コンビネータ対応のため配列で表現） */
export interface Selector {
  parts: SelectorPart[][];
}

/** CSSルール（セレクタ + 宣言の集合） */
export interface CssRule {
  selector: Selector;
  declarations: CssDeclaration[];
  /** ルールの出現順序（カスケード用） */
  order: number;
}

/** パースされたスタイルシート */
export interface Stylesheet {
  rules: CssRule[];
}

/** 対応しているCSSプロパティ */
const SUPPORTED_PROPERTIES = new Set([
  'color', 'background', 'background-color',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'width', 'height',
  'display',
  'font-size',
  'border', 'border-width', 'border-color', 'border-style',
]);

/**
 * CSSテキストをパースしてスタイルシートを返す
 */
export function parseCss(css: string): Stylesheet {
  const rules: CssRule[] = [];
  let order = 0;

  // コメントを除去
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // ルールを抽出（セレクタ { 宣言 } の形式）
  const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(cleaned)) !== null) {
    const selectorText = match[1]?.trim();
    const declarationText = match[2]?.trim();

    if (!selectorText || declarationText === undefined) continue;

    const selector = parseSelector(selectorText);
    const declarations = parseDeclarations(declarationText);

    rules.push({ selector, declarations, order: order++ });
  }

  return { rules };
}

/**
 * セレクタ文字列をパースする
 * 子孫コンビネータ（空白区切り）に対応
 */
export function parseSelector(selectorText: string): Selector {
  const segments = selectorText.trim().split(/\s+/);
  const parts: SelectorPart[][] = [];

  for (const segment of segments) {
    const segmentParts = parseSelectorSegment(segment);
    parts.push(segmentParts);
  }

  return { parts };
}

/**
 * セレクタの1セグメントを解析する（例: div.class#id）
 */
function parseSelectorSegment(segment: string): SelectorPart[] {
  const result: SelectorPart[] = [];

  // トークン分割: #id, .class, tag をそれぞれ抽出
  const tokenRegex = /(#[a-zA-Z_-][a-zA-Z0-9_-]*)|(\.[a-zA-Z_-][a-zA-Z0-9_-]*)|([a-zA-Z][a-zA-Z0-9]*)/g;
  let tokenMatch: RegExpExecArray | null;

  while ((tokenMatch = tokenRegex.exec(segment)) !== null) {
    if (tokenMatch[1]) {
      result.push({ type: 'id', name: tokenMatch[1].slice(1) });
    } else if (tokenMatch[2]) {
      result.push({ type: 'class', name: tokenMatch[2].slice(1) });
    } else if (tokenMatch[3]) {
      result.push({ type: 'tag', name: tokenMatch[3] });
    }
  }

  return result;
}

/**
 * 宣言ブロックの中身をパースする
 */
function parseDeclarations(text: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];

  const parts = text.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const property = trimmed.slice(0, colonIndex).trim().toLowerCase();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (SUPPORTED_PROPERTIES.has(property) && value) {
      declarations.push({ property, value });
    }
  }

  return declarations;
}

/**
 * 詳細度（specificity）を計算する
 * ID = 100, クラス = 10, タグ = 1
 * 返り値: 数値（大きいほど優先度が高い）
 */
export function calculateSpecificity(selector: Selector): number {
  let specificity = 0;

  for (const segment of selector.parts) {
    for (const part of segment) {
      switch (part.type) {
        case 'id':
          specificity += 100;
          break;
        case 'class':
          specificity += 10;
          break;
        case 'tag':
          specificity += 1;
          break;
      }
    }
  }

  return specificity;
}
