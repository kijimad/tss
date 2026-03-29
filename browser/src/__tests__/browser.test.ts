/**
 * ブラウザエンジンシミュレータのテスト
 * HTMLパーサー、CSSパーサー、DOM操作、スタイル解決、レイアウト、ペイントを検証する
 */

import { describe, it, expect } from 'vitest';
import { tokenize, parse } from '../parser/html';
import { parseCss, parseSelector, calculateSpecificity } from '../parser/css';
import {
  createElement,
  createTextNode,
  getElementById,
  getElementsByTagName,
  querySelector,
  printDomTree,
} from '../dom/dom';
import type { ElementNode } from '../dom/dom';
import { resolveStyles, matchesSelector } from '../render/style';
import {
  buildLayoutTree,
  computeLayout,
  parsePx,
  marginBoxWidth,
  marginBoxHeight,
} from '../render/layout';
import { buildDisplayList } from '../render/paint';

// ========================================================
// HTMLトークナイザーのテスト
// ========================================================
describe('HTMLトークナイザー', () => {
  it('テキストのみをトークン化できる', () => {
    const tokens = tokenize('Hello');
    expect(tokens).toHaveLength(2); // Text + EOF
    expect(tokens[0]?.type).toBe('Text');
    expect(tokens[0]?.text).toBe('Hello');
  });

  it('開始タグと閉じタグをトークン化できる', () => {
    const tokens = tokenize('<div>content</div>');
    expect(tokens[0]?.type).toBe('StartTag');
    expect(tokens[0]?.tagName).toBe('div');
    expect(tokens[1]?.type).toBe('Text');
    expect(tokens[1]?.text).toBe('content');
    expect(tokens[2]?.type).toBe('EndTag');
    expect(tokens[2]?.tagName).toBe('div');
  });

  it('属性付きタグをトークン化できる', () => {
    const tokens = tokenize('<a href="https://example.com" class="link">click</a>');
    expect(tokens[0]?.type).toBe('StartTag');
    expect(tokens[0]?.attributes?.get('href')).toBe('https://example.com');
    expect(tokens[0]?.attributes?.get('class')).toBe('link');
  });

  it('自己閉じタグ(img)を処理できる', () => {
    const tokens = tokenize('<img src="test.png"/>');
    expect(tokens[0]?.type).toBe('StartTag');
    expect(tokens[0]?.tagName).toBe('img');
    expect(tokens[1]?.type).toBe('EndTag');
    expect(tokens[1]?.tagName).toBe('img');
  });

  it('HTMLコメントをスキップする', () => {
    const tokens = tokenize('<!-- comment --><p>text</p>');
    expect(tokens[0]?.type).toBe('StartTag');
    expect(tokens[0]?.tagName).toBe('p');
  });

  it('空白のみのテキストを無視する', () => {
    const tokens = tokenize('<div>   </div>');
    expect(tokens.filter(t => t.type === 'Text')).toHaveLength(0);
  });

  it('EOFトークンが末尾に付与される', () => {
    const tokens = tokenize('<p>test</p>');
    expect(tokens[tokens.length - 1]?.type).toBe('EOF');
  });
});

// ========================================================
// HTMLパーサーのテスト
// ========================================================
describe('HTMLパーサー', () => {
  it('単純なHTML構造をパースできる', () => {
    const dom = parse('<html><body><p>Hello</p></body></html>');
    expect(dom.type).toBe('element');
    if (dom.type === 'element') {
      expect(dom.tagName).toBe('html');
      expect(dom.children).toHaveLength(1); // body
    }
  });

  it('ネストした要素を正しくパースする', () => {
    const dom = parse('<div><p><span>text</span></p></div>');
    if (dom.type === 'element') {
      const div = dom.children[0];
      expect(div?.type).toBe('element');
      if (div?.type === 'element') {
        expect(div.tagName).toBe('div');
        const p = div.children[0];
        if (p?.type === 'element') {
          expect(p.tagName).toBe('p');
          const span = p.children[0];
          if (span?.type === 'element') {
            expect(span.tagName).toBe('span');
          }
        }
      }
    }
  });

  it('属性を保持する', () => {
    const dom = parse('<div id="main" class="container">text</div>');
    if (dom.type === 'element') {
      const div = dom.children[0];
      if (div?.type === 'element') {
        expect(div.attributes['id']).toBe('main');
        expect(div.attributes['class']).toBe('container');
      }
    }
  });

  it('テキストノードを含める', () => {
    const dom = parse('<p>Hello World</p>');
    if (dom.type === 'element') {
      const p = dom.children[0];
      if (p?.type === 'element') {
        expect(p.children[0]?.type).toBe('text');
        if (p.children[0]?.type === 'text') {
          expect(p.children[0].text).toBe('Hello World');
        }
      }
    }
  });

  it('複数の子要素をパースできる', () => {
    const dom = parse('<ul><li>A</li><li>B</li><li>C</li></ul>');
    if (dom.type === 'element') {
      const ul = dom.children[0];
      if (ul?.type === 'element') {
        expect(ul.tagName).toBe('ul');
        expect(ul.children).toHaveLength(3);
      }
    }
  });

  it('h1-h3タグをパースできる', () => {
    const dom = parse('<h1>Title</h1>');
    if (dom.type === 'element') {
      const h1 = dom.children[0];
      if (h1?.type === 'element') {
        expect(h1.tagName).toBe('h1');
      }
    }
  });

  it('strong/emタグをパースできる', () => {
    const dom = parse('<p><strong>bold</strong> and <em>italic</em></p>');
    if (dom.type === 'element') {
      const p = dom.children[0];
      if (p?.type === 'element') {
        const strong = p.children[0];
        const em = p.children[2];
        if (strong?.type === 'element') expect(strong.tagName).toBe('strong');
        if (em?.type === 'element') expect(em.tagName).toBe('em');
      }
    }
  });
});

// ========================================================
// DOM操作のテスト
// ========================================================
describe('DOM操作', () => {
  it('createElementで要素を生成できる', () => {
    const el = createElement('div', { id: 'test' }, []);
    expect(el.type).toBe('element');
    expect(el.tagName).toBe('div');
    expect(el.attributes['id']).toBe('test');
  });

  it('createTextNodeでテキストノードを生成できる', () => {
    const text = createTextNode('hello');
    expect(text.type).toBe('text');
    expect(text.text).toBe('hello');
  });

  it('getElementByIdで要素を検索できる', () => {
    const tree = createElement('div', {}, [
      createElement('p', { id: 'target' }, [createTextNode('found')]),
      createElement('span', {}, []),
    ]);
    const result = getElementById(tree, 'target');
    expect(result).not.toBeNull();
    expect(result?.tagName).toBe('p');
  });

  it('getElementByIdで見つからない場合nullを返す', () => {
    const tree = createElement('div', {}, []);
    expect(getElementById(tree, 'missing')).toBeNull();
  });

  it('getElementsByTagNameで要素を検索できる', () => {
    const tree = createElement('div', {}, [
      createElement('p', {}, []),
      createElement('span', {}, []),
      createElement('p', {}, []),
    ]);
    const results = getElementsByTagName(tree, 'p');
    expect(results).toHaveLength(2);
  });

  it('querySelectorでタグ名検索できる', () => {
    const tree = createElement('div', {}, [
      createElement('p', {}, []),
    ]);
    expect(querySelector(tree, 'p')?.tagName).toBe('p');
  });

  it('querySelectorでクラス名検索できる', () => {
    const tree = createElement('div', {}, [
      createElement('p', { class: 'highlight' }, []),
    ]);
    expect(querySelector(tree, '.highlight')?.tagName).toBe('p');
  });

  it('querySelectorでID検索できる', () => {
    const tree = createElement('div', {}, [
      createElement('span', { id: 'unique' }, []),
    ]);
    expect(querySelector(tree, '#unique')?.tagName).toBe('span');
  });

  it('printDomTreeで整形出力できる', () => {
    const tree = createElement('div', { id: 'root' }, [
      createTextNode('hello'),
    ]);
    const output = printDomTree(tree);
    expect(output).toContain('<div');
    expect(output).toContain('id="root"');
    expect(output).toContain('"hello"');
  });
});

// ========================================================
// CSSパーサーのテスト
// ========================================================
describe('CSSパーサー', () => {
  it('タグセレクタとプロパティをパースできる', () => {
    const sheet = parseCss('p { color: red; }');
    expect(sheet.rules).toHaveLength(1);
    expect(sheet.rules[0]?.declarations[0]?.property).toBe('color');
    expect(sheet.rules[0]?.declarations[0]?.value).toBe('red');
  });

  it('クラスセレクタをパースできる', () => {
    const sheet = parseCss('.main { margin: 10px; }');
    const parts = sheet.rules[0]?.selector.parts[0];
    expect(parts?.[0]?.type).toBe('class');
    expect(parts?.[0]?.name).toBe('main');
  });

  it('IDセレクタをパースできる', () => {
    const sheet = parseCss('#header { padding: 5px; }');
    const parts = sheet.rules[0]?.selector.parts[0];
    expect(parts?.[0]?.type).toBe('id');
    expect(parts?.[0]?.name).toBe('header');
  });

  it('子孫コンビネータをパースできる', () => {
    const sheet = parseCss('div p { color: blue; }');
    const selector = sheet.rules[0]?.selector;
    expect(selector?.parts).toHaveLength(2);
    expect(selector?.parts[0]?.[0]?.name).toBe('div');
    expect(selector?.parts[1]?.[0]?.name).toBe('p');
  });

  it('複数のルールをパースできる', () => {
    const sheet = parseCss('h1 { font-size: 24px; } p { color: black; }');
    expect(sheet.rules).toHaveLength(2);
  });

  it('複数の宣言をパースできる', () => {
    const sheet = parseCss('div { color: red; margin: 10px; padding: 5px; }');
    expect(sheet.rules[0]?.declarations).toHaveLength(3);
  });

  it('CSSコメントを無視する', () => {
    const sheet = parseCss('/* comment */ p { color: red; }');
    expect(sheet.rules).toHaveLength(1);
  });

  it('サポートされていないプロパティを無視する', () => {
    const sheet = parseCss('p { color: red; transform: rotate(45deg); }');
    expect(sheet.rules[0]?.declarations).toHaveLength(1);
  });
});

// ========================================================
// 詳細度計算のテスト
// ========================================================
describe('詳細度（specificity）計算', () => {
  it('タグセレクタの詳細度は1', () => {
    const sel = parseSelector('p');
    expect(calculateSpecificity(sel)).toBe(1);
  });

  it('クラスセレクタの詳細度は10', () => {
    const sel = parseSelector('.main');
    expect(calculateSpecificity(sel)).toBe(10);
  });

  it('IDセレクタの詳細度は100', () => {
    const sel = parseSelector('#header');
    expect(calculateSpecificity(sel)).toBe(100);
  });

  it('複合セレクタの詳細度が正しく加算される', () => {
    // div.main = tag(1) + class(10) = 11
    const sel = parseSelector('div.main');
    expect(calculateSpecificity(sel)).toBe(11);
  });

  it('子孫セレクタの詳細度が正しく加算される', () => {
    // div p = tag(1) + tag(1) = 2
    const sel = parseSelector('div p');
    expect(calculateSpecificity(sel)).toBe(2);
  });

  it('#id .class tag の詳細度は111', () => {
    // #id .class tag = 100 + 10 + 1 = 111
    const sel = parseSelector('#id .class tag');
    // 3セグメント: [#id], [.class], [tag]
    expect(calculateSpecificity(sel)).toBe(111);
  });
});

// ========================================================
// セレクタマッチングのテスト
// ========================================================
describe('セレクタマッチング', () => {
  it('タグセレクタがマッチする', () => {
    const el = createElement('p', {}, []);
    const sel = parseSelector('p');
    expect(matchesSelector(el, sel, [])).toBe(true);
  });

  it('異なるタグにはマッチしない', () => {
    const el = createElement('div', {}, []);
    const sel = parseSelector('p');
    expect(matchesSelector(el, sel, [])).toBe(false);
  });

  it('クラスセレクタがマッチする', () => {
    const el = createElement('div', { class: 'highlight' }, []);
    const sel = parseSelector('.highlight');
    expect(matchesSelector(el, sel, [])).toBe(true);
  });

  it('IDセレクタがマッチする', () => {
    const el = createElement('div', { id: 'main' }, []);
    const sel = parseSelector('#main');
    expect(matchesSelector(el, sel, [])).toBe(true);
  });

  it('子孫コンビネータがマッチする', () => {
    const parent = createElement('div', {}, []);
    const child = createElement('p', {}, []);
    const sel = parseSelector('div p');
    expect(matchesSelector(child, sel, [parent])).toBe(true);
  });

  it('子孫が存在しない場合マッチしない', () => {
    const child = createElement('p', {}, []);
    const sel = parseSelector('div p');
    expect(matchesSelector(child, sel, [])).toBe(false);
  });
});

// ========================================================
// スタイル解決のテスト
// ========================================================
describe('スタイル解決', () => {
  it('CSSルールが要素に適用される', () => {
    const dom = parse('<html><body><p>text</p></body></html>');
    const sheet = parseCss('p { color: red; }');
    const styleMap = resolveStyles(dom, sheet);

    // DOMツリーからp要素を見つける
    const pElements = findElements(dom, 'p');
    expect(pElements.length).toBeGreaterThan(0);
    const pStyle = styleMap.get(pElements[0]!);
    expect(pStyle?.get('color')).toBe('red');
  });

  it('詳細度の高いルールが優先される', () => {
    const dom = parse('<html><body><p class="intro">text</p></body></html>');
    const sheet = parseCss('p { color: red; } .intro { color: blue; }');
    const styleMap = resolveStyles(dom, sheet);

    const pElements = findElements(dom, 'p');
    const pStyle = styleMap.get(pElements[0]!);
    // .intro(10) > p(1) なのでblueが優先
    expect(pStyle?.get('color')).toBe('blue');
  });

  it('同じ詳細度なら後のルールが優先される', () => {
    const dom = parse('<html><body><p>text</p></body></html>');
    const sheet = parseCss('p { color: red; } p { color: green; }');
    const styleMap = resolveStyles(dom, sheet);

    const pElements = findElements(dom, 'p');
    const pStyle = styleMap.get(pElements[0]!);
    expect(pStyle?.get('color')).toBe('green');
  });

  it('colorプロパティが子要素に継承される', () => {
    const dom = parse('<html><body><div><span>text</span></div></body></html>');
    const sheet = parseCss('div { color: purple; }');
    const styleMap = resolveStyles(dom, sheet);

    const spanElements = findElements(dom, 'span');
    const spanStyle = styleMap.get(spanElements[0]!);
    expect(spanStyle?.get('color')).toBe('purple');
  });

  it('marginは継承されない', () => {
    const dom = parse('<html><body><div><p>text</p></div></body></html>');
    const sheet = parseCss('div { margin: 20px; }');
    const styleMap = resolveStyles(dom, sheet);

    const pElements = findElements(dom, 'p');
    const pStyle = styleMap.get(pElements[0]!);
    expect(pStyle?.has('margin')).toBe(false);
  });

  it('デフォルトのdisplayスタイルが適用される', () => {
    const dom = parse('<html><body><div>block</div><span>inline</span></body></html>');
    const sheet = parseCss('');
    const styleMap = resolveStyles(dom, sheet);

    const divElements = findElements(dom, 'div');
    const spanElements = findElements(dom, 'span');
    expect(styleMap.get(divElements[0]!)?.get('display')).toBe('block');
    expect(styleMap.get(spanElements[0]!)?.get('display')).toBe('inline');
  });
});

// ========================================================
// レイアウト計算のテスト
// ========================================================
describe('レイアウト計算', () => {
  it('parsePxで数値をパースできる', () => {
    expect(parsePx('10px')).toBe(10);
    expect(parsePx('0')).toBe(0);
    expect(parsePx(undefined)).toBe(0);
    expect(parsePx('abc')).toBe(0);
  });

  it('ブロック要素がコンテナ幅いっぱいに広がる', () => {
    const dom = parse('<html><body><div>content</div></body></html>');
    const sheet = parseCss('');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    expect(layout).not.toBeNull();
    if (layout) {
      computeLayout(layout, 800, styleMap);
      // ルート要素の幅がコンテナ幅に等しい
      expect(layout.dimensions.content.width).toBe(800);
    }
  });

  it('マージンがレイアウトに反映される', () => {
    const dom = parse('<html><body><div>content</div></body></html>');
    const sheet = parseCss('div { margin: 10px; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      // divのレイアウトボックスを探す
      const divBox = findLayoutBox(layout, 'div');
      if (divBox) {
        expect(divBox.dimensions.margin.top).toBe(10);
        expect(divBox.dimensions.margin.left).toBe(10);
      }
    }
  });

  it('パディングがレイアウトに反映される', () => {
    const dom = parse('<html><body><div>content</div></body></html>');
    const sheet = parseCss('div { padding: 15px; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const divBox = findLayoutBox(layout, 'div');
      if (divBox) {
        expect(divBox.dimensions.padding.top).toBe(15);
        expect(divBox.dimensions.padding.left).toBe(15);
      }
    }
  });

  it('明示的な幅が設定される', () => {
    const dom = parse('<html><body><div>content</div></body></html>');
    const sheet = parseCss('div { width: 200px; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const divBox = findLayoutBox(layout, 'div');
      if (divBox) {
        expect(divBox.dimensions.content.width).toBe(200);
      }
    }
  });

  it('明示的な高さが設定される', () => {
    const dom = parse('<html><body><div>content</div></body></html>');
    const sheet = parseCss('div { height: 100px; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const divBox = findLayoutBox(layout, 'div');
      if (divBox) {
        expect(divBox.dimensions.content.height).toBe(100);
      }
    }
  });

  it('marginBoxWidthが正しく計算される', () => {
    const d = {
      content: { x: 0, y: 0, width: 100, height: 50 },
      padding: { top: 5, right: 5, bottom: 5, left: 5 },
      border: { top: 1, right: 1, bottom: 1, left: 1 },
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    expect(marginBoxWidth(d)).toBe(100 + 5 + 5 + 1 + 1 + 10 + 10);
  });

  it('marginBoxHeightが正しく計算される', () => {
    const d = {
      content: { x: 0, y: 0, width: 100, height: 50 },
      padding: { top: 5, right: 5, bottom: 5, left: 5 },
      border: { top: 1, right: 1, bottom: 1, left: 1 },
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    expect(marginBoxHeight(d)).toBe(50 + 5 + 5 + 1 + 1 + 10 + 10);
  });

  it('display:noneの要素はレイアウトツリーに含まれない', () => {
    const dom = parse('<html><head><title>Test</title></head><body><div>visible</div></body></html>');
    const sheet = parseCss('');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      const headBox = findLayoutBox(layout, 'head');
      expect(headBox).toBeNull();
    }
  });
});

// ========================================================
// ペイント（ディスプレイリスト）のテスト
// ========================================================
describe('ペイント', () => {
  it('背景色がディスプレイリストに含まれる', () => {
    const dom = parse('<html><body><div>text</div></body></html>');
    const sheet = parseCss('div { background: #ff0000; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const commands = buildDisplayList(layout, styleMap);
      const rects = commands.filter(c => c.type === 'rect');
      expect(rects.some(r => r.color === '#ff0000')).toBe(true);
    }
  });

  it('ボーダーがディスプレイリストに含まれる', () => {
    const dom = parse('<html><body><div>text</div></body></html>');
    const sheet = parseCss('div { border-width: 2px; border-color: blue; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const commands = buildDisplayList(layout, styleMap);
      const borders = commands.filter(c => c.type === 'border');
      expect(borders.length).toBeGreaterThan(0);
      expect(borders.some(b => b.type === 'border' && b.color === 'blue')).toBe(true);
    }
  });

  it('テキストがディスプレイリストに含まれる', () => {
    const dom = parse('<html><body><p>Hello World</p></body></html>');
    const sheet = parseCss('p { color: green; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const commands = buildDisplayList(layout, styleMap);
      const texts = commands.filter(c => c.type === 'text');
      expect(texts.some(t => t.type === 'text' && t.text === 'Hello World')).toBe(true);
      expect(texts.some(t => t.type === 'text' && t.color === 'green')).toBe(true);
    }
  });

  it('描画順序が背景→ボーダー→テキストの順になる', () => {
    const dom = parse('<html><body><div>text</div></body></html>');
    const sheet = parseCss('div { background: yellow; border-width: 1px; color: black; }');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);

    if (layout) {
      computeLayout(layout, 800, styleMap);
      const commands = buildDisplayList(layout, styleMap);

      // divのコマンドを抽出（背景→ボーダー→テキスト）
      const divRect = commands.findIndex(c => c.type === 'rect' && c.color === 'yellow');
      const divBorder = commands.findIndex(c => c.type === 'border');
      const divText = commands.findIndex(c => c.type === 'text' && c.text === 'text');

      if (divRect !== -1 && divBorder !== -1) {
        expect(divRect).toBeLessThan(divBorder);
      }
      if (divBorder !== -1 && divText !== -1) {
        expect(divBorder).toBeLessThan(divText);
      }
    }
  });
});

// ========================================================
// 統合テスト
// ========================================================
describe('統合テスト', () => {
  it('完全なレンダリングパイプラインが動作する', () => {
    const html = `<html>
      <head><title>Test</title></head>
      <body>
        <div id="main" class="container">
          <h1>Title</h1>
          <p class="intro">Hello <strong>World</strong></p>
        </div>
      </body>
    </html>`;

    const css = `
      .container { margin: 10px; padding: 20px; background: #f0f0f0; }
      h1 { color: #333; font-size: 24px; }
      .intro { color: #666; }
      strong { color: red; }
    `;

    // パース
    const dom = parse(html);
    expect(dom.type).toBe('element');

    // スタイル解決
    const sheet = parseCss(css);
    const styleMap = resolveStyles(dom, sheet);

    // コンテナのスタイルを確認
    const mainEl = getElementById(dom, 'main');
    expect(mainEl).not.toBeNull();
    if (mainEl) {
      const mainStyle = styleMap.get(mainEl);
      expect(mainStyle?.get('background')).toBe('#f0f0f0');
      expect(mainStyle?.get('margin')).toBe('10px');
    }

    // レイアウト
    const layout = buildLayoutTree(dom, styleMap);
    expect(layout).not.toBeNull();
    if (layout) {
      computeLayout(layout, 800, styleMap);
      expect(layout.dimensions.content.width).toBe(800);
    }

    // ペイント
    if (layout) {
      const commands = buildDisplayList(layout, styleMap);
      expect(commands.length).toBeGreaterThan(0);

      // 背景、テキスト両方が含まれることを確認
      expect(commands.some(c => c.type === 'rect')).toBe(true);
      expect(commands.some(c => c.type === 'text')).toBe(true);
    }
  });

  it('空のHTMLでもクラッシュしない', () => {
    const dom = parse('');
    const sheet = parseCss('');
    const styleMap = resolveStyles(dom, sheet);
    const layout = buildLayoutTree(dom, styleMap);
    if (layout) {
      computeLayout(layout, 800, styleMap);
      const commands = buildDisplayList(layout, styleMap);
      expect(commands).toBeDefined();
    }
  });
});

// ========================================================
// ヘルパー関数
// ========================================================

/** DOMツリーから指定タグ名の要素を全て探す */
function findElements(node: import('../dom/dom').DomNode, tagName: string): ElementNode[] {
  const results: ElementNode[] = [];
  function walk(n: import('../dom/dom').DomNode): void {
    if (n.type === 'text') return;
    if (n.tagName === tagName) results.push(n);
    for (const child of n.children) walk(child);
  }
  walk(node);
  return results;
}

/** レイアウトツリーから指定タグ名のボックスを探す */
function findLayoutBox(box: import('../render/layout').LayoutBox, tagName: string): import('../render/layout').LayoutBox | null {
  if (box.node?.tagName === tagName) return box;
  for (const child of box.children) {
    const found = findLayoutBox(child, tagName);
    if (found) return found;
  }
  return null;
}
