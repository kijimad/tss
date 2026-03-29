/**
 * HTMLトークナイザーとパーサー
 * HTMLテキストをトークン化し、DOMツリーを構築する
 */

import { DomNode, createElement, createTextNode } from '../dom/dom';

/** トークンの種類 */
export type TokenType = 'StartTag' | 'EndTag' | 'Text' | 'EOF';

/** HTMLトークン */
export interface HtmlToken {
  type: TokenType;
  tagName?: string;
  attributes?: Map<string, string>;
  text?: string;
}

/** 対応しているHTMLタグ一覧 */
const SUPPORTED_TAGS = new Set([
  'html', 'head', 'title', 'body',
  'div', 'p', 'span',
  'h1', 'h2', 'h3',
  'ul', 'li',
  'a', 'img',
  'strong', 'em',
]);

/** 自己閉じタグ */
const VOID_ELEMENTS = new Set(['img']);

/**
 * HTMLトークナイザー: HTML文字列をトークン列に変換する
 */
export function tokenize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let pos = 0;

  while (pos < html.length) {
    if (html[pos] === '<') {
      // コメントをスキップ
      if (html.startsWith('<!--', pos)) {
        const end = html.indexOf('-->', pos);
        if (end !== -1) {
          pos = end + 3;
          continue;
        }
      }

      // 閉じタグ
      if (html[pos + 1] === '/') {
        const end = html.indexOf('>', pos);
        if (end !== -1) {
          const tagName = html.slice(pos + 2, end).trim().toLowerCase();
          tokens.push({ type: 'EndTag', tagName });
          pos = end + 1;
          continue;
        }
      }

      // 開始タグ
      const end = html.indexOf('>', pos);
      if (end !== -1) {
        const tagContent = html.slice(pos + 1, end).trim();
        const { tagName, attributes } = parseTagContent(tagContent);
        const lowerTag = tagName.toLowerCase();

        // 自己閉じタグの処理（"/" で終わる場合も対応）
        const isSelfClosing = VOID_ELEMENTS.has(lowerTag) || tagContent.endsWith('/');

        tokens.push({ type: 'StartTag', tagName: lowerTag, attributes });

        if (isSelfClosing) {
          tokens.push({ type: 'EndTag', tagName: lowerTag });
        }

        pos = end + 1;
        continue;
      }
    }

    // テキストノード
    const nextTag = html.indexOf('<', pos);
    const textEnd = nextTag === -1 ? html.length : nextTag;
    const text = html.slice(pos, textEnd);
    // 空白のみでないテキストを追加
    if (text.trim().length > 0) {
      tokens.push({ type: 'Text', text: text.trim() });
    }
    pos = textEnd;
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}

/**
 * タグの内容（タグ名と属性）を解析する
 */
function parseTagContent(content: string): { tagName: string; attributes: Map<string, string> } {
  const attributes = new Map<string, string>();

  // 末尾のスラッシュを除去（自己閉じタグ対応）
  let cleaned = content.endsWith('/') ? content.slice(0, -1).trim() : content;

  // タグ名を取得
  const spaceIndex = cleaned.indexOf(' ');
  if (spaceIndex === -1) {
    return { tagName: cleaned, attributes };
  }

  const tagName = cleaned.slice(0, spaceIndex);
  const attrString = cleaned.slice(spaceIndex + 1).trim();

  // 属性を解析（key="value" または key='value' 形式）
  const attrRegex = /([a-zA-Z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (key) {
      attributes.set(key, value);
    }
  }

  return { tagName, attributes };
}

/**
 * HTMLパーサー: トークン列からDOMツリーを構築する
 */
export function parse(html: string): DomNode {
  const tokens = tokenize(html);
  let pos = 0;

  /** 現在のトークンを取得 */
  function current(): HtmlToken {
    return tokens[pos] ?? { type: 'EOF' };
  }

  /** 次のトークンに進む */
  function advance(): void {
    if (pos < tokens.length) {
      pos++;
    }
  }

  /** ノードを再帰的に解析する */
  function parseNodes(): DomNode[] {
    const nodes: DomNode[] = [];

    while (pos < tokens.length) {
      const token = current();

      if (token.type === 'EOF' || token.type === 'EndTag') {
        break;
      }

      if (token.type === 'Text') {
        nodes.push(createTextNode(token.text ?? ''));
        advance();
        continue;
      }

      if (token.type === 'StartTag') {
        const tagName = token.tagName ?? 'div';
        const attrs: Record<string, string> = {};
        if (token.attributes) {
          for (const [k, v] of token.attributes) {
            attrs[k] = v;
          }
        }
        advance();

        // 子ノードを解析
        const children = SUPPORTED_TAGS.has(tagName) ? parseNodes() : [];

        // 対応する閉じタグをスキップ
        if (current().type === 'EndTag' && current().tagName === tagName) {
          advance();
        }

        const element = createElement(tagName, attrs, children);
        nodes.push(element);
        continue;
      }

      advance();
    }

    return nodes;
  }

  const children = parseNodes();

  // ルート要素がhtmlタグなら、そのまま返す
  if (children.length === 1 && children[0]?.type === 'element' && children[0].tagName === 'html') {
    return children[0];
  }

  // 複数のルートがある場合、htmlでラップする
  return createElement('html', {}, children);
}
