/**
 * ブラウザUI
 * Node.jsシミュレータと同じUIパターンで
 * コンポーネント定義エディタ、VDOMツリー可視化、差分パッチビューア、
 * ファイバーツリー、Hooks状態インスペクタを提供する
 */

import { createElement, type VNode } from '../vdom/element.js';
import { diff, type Patch, PatchType } from '../vdom/diff.js';
import { Renderer } from '../vdom/renderer.js';
import { createFiberFromVNode, collectFibers, type Fiber, FiberTag } from '../fiber/fiber.js';
import { Scheduler, Lane } from '../fiber/scheduler.js';
import {
  useState,
  useEffect,
  useMemo,
  setCurrentFiber,
  clearCurrentFiber,
  flushEffects,
  batchUpdates,
  resetHookState,
  setRerenderCallback,
} from '../hooks/hooks.js';
import { createFiber, EffectTag } from '../fiber/fiber.js';

/** サンプル定義 */
const EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'Hello World (単純レンダリング)',
    code: `// 単純なcreateElementツリーをレンダリングしてVDOMを表示する
createElement(
  'div',
  { className: 'app' },
  createElement('h1', null, 'Hello React Sim'),
  createElement('p', null, 'VDOMの基本構造'),
)`,
  },
  {
    name: '差分検出 (テキスト変更)',
    code: `// 旧VDOMと新VDOMを比較してパッチを表示する
// --- old ---
const oldTree = createElement('div', null,
  createElement('h1', null, 'Hello'),
  createElement('p', null, '旧テキスト'),
);
// --- new ---
const newTree = createElement('div', null,
  createElement('h1', null, 'Hello'),
  createElement('p', null, '新テキスト'),
);`,
  },
  {
    name: 'リスト差分 (キー付き)',
    code: `// キー付きリストの並び替えでREORDERパッチを表示する
// --- old ---
const oldTree = createElement('ul', null,
  createElement('li', { key: 'a' }, 'Apple'),
  createElement('li', { key: 'b' }, 'Banana'),
  createElement('li', { key: 'c' }, 'Cherry'),
);
// --- new ---
const newTree = createElement('ul', null,
  createElement('li', { key: 'c' }, 'Cherry'),
  createElement('li', { key: 'a' }, 'Apple'),
  createElement('li', { key: 'd' }, 'Dragonfruit'),
);`,
  },
  {
    name: 'useState カウンター',
    code: `// useStateで状態更新と再レンダリングをシミュレートする
// 初期値: 0 → setState(1) → setState(prev => prev + 1) → 最終値: 2
const initialValue = 0;
// updates: [1, prev => prev + 1]`,
  },
  {
    name: 'useEffect (マウント/アンマウント)',
    code: `// useEffectのスケジューリングをシミュレートする
// マウント時にエフェクトが登録され、flushで実行される
// 依存配列が変わるとクリーンアップ後に再実行される
// deps: [] → [1] (変更あり → 再実行)`,
  },
  {
    name: 'useMemo (メモ化)',
    code: `// useMemoの再計算スキップをシミュレートする
// 依存配列が同じ場合は再計算しない
// deps: [1, 2] → [1, 2] (同じ → スキップ)
// deps: [1, 2] → [1, 3] (異なる → 再計算)`,
  },
  {
    name: 'Fiber ツリー構築',
    code: `// VNodeツリーからFiberツリーを構築し
// child/sibling/returnポインタを表示する
createElement(
  'div',
  { id: 'root' },
  createElement('h1', null, 'Title'),
  createElement('ul', null,
    createElement('li', { key: '1' }, 'Item 1'),
    createElement('li', { key: '2' }, 'Item 2'),
  ),
)`,
  },
  {
    name: '優先度スケジューリング',
    code: `// Sync vs Default vs Idle レーンの処理順序を表示する
// Sync(1) → Default(2) → Idle(3) の順で処理される
// lanes: [Idle, Sync, Default]`,
  },
  {
    name: 'バッチ更新',
    code: `// 1つのハンドラ内で複数のsetStateをバッチ処理する
// batchUpdates内では再レンダリングが1回に集約される
// setState(1) → setState(2) → setState(3) → 最終値: 3`,
  },
  {
    name: 'コンポーネント追加/削除',
    code: `// INSERT/REMOVEパッチの生成を表示する
// --- old ---
const oldTree = createElement('div', null,
  createElement('p', null, '段落A'),
  createElement('p', null, '段落B'),
);
// --- new ---
const newTree = createElement('div', null,
  createElement('p', null, '段落A'),
  createElement('p', null, '段落B'),
  createElement('p', null, '段落C（新規）'),
);`,
  },
];

/**
 * VNodeツリーをテキスト形式で可視化する
 */
function renderVNodeTree(node: VNode, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  const typeName = typeof node.type === 'function' ? node.type.name : node.type;

  if (node.type === '__TEXT__') {
    return `${pad}"${String(node.props['nodeValue'] ?? '')}"\n`;
  }

  const propsStr = Object.entries(node.props)
    .map(([k, v]) => `${k}="${String(v)}"`)
    .join(' ');

  let text = `${pad}<${typeName}${propsStr ? ' ' + propsStr : ''}>\n`;
  for (const child of node.children) {
    text += renderVNodeTree(child, indent + 1);
  }
  text += `${pad}</${typeName}>\n`;
  return text;
}

/**
 * パッチリストをテキスト形式で表示する
 */
function renderPatches(patches: Patch[]): string {
  if (patches.length === 0) return 'パッチなし\n';

  return patches
    .map((p) => {
      const pathStr = `[${p.path.join(', ')}]`;
      switch (p.type) {
        case PatchType.INSERT:
          return `  INSERT @ ${pathStr}`;
        case PatchType.REMOVE:
          return `  REMOVE @ ${pathStr}`;
        case PatchType.UPDATE:
          return `  UPDATE @ ${pathStr}: ${(p.propChanges ?? []).map((c) => `${c.key}: ${String(c.oldValue)} → ${String(c.newValue)}`).join(', ')}`;
        case PatchType.REPLACE:
          return `  REPLACE @ ${pathStr}`;
        case PatchType.REORDER:
          return `  REORDER @ ${pathStr}: ${(p.moves ?? []).map((m) => `${m.type}@${String(m.index)}`).join(', ')}`;
      }
    })
    .join('\n') + '\n';
}

/**
 * ファイバーツリーをテキスト形式で表示する
 */
function renderFiberTree(fiber: Fiber, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  const typeName = fiber.vnode
    ? typeof fiber.vnode.type === 'function'
      ? fiber.vnode.type.name
      : fiber.vnode.type
    : 'root';

  let text = `${pad}[${fiber.tag}] ${typeName} (${fiber.effectTag})`;
  if (fiber.hooks.length > 0) {
    text += ` hooks:${String(fiber.hooks.length)}`;
  }

  // child/sibling/returnポインタ情報
  const pointers: string[] = [];
  if (fiber.child) pointers.push('child');
  if (fiber.sibling) pointers.push('sibling');
  if (fiber.return) pointers.push('return');
  if (pointers.length > 0) {
    text += ` → {${pointers.join(', ')}}`;
  }
  text += '\n';

  if (fiber.child) {
    text += renderFiberTree(fiber.child, indent + 1);
  }
  if (fiber.sibling) {
    text += renderFiberTree(fiber.sibling, indent);
  }

  return text;
}

/**
 * ファイバーの子ノードを構築する
 */
function buildFiberChildren(parentFiber: Fiber, vnode: VNode): void {
  let prevSibling: Fiber | null = null;

  for (const child of vnode.children) {
    const childFiber = createFiberFromVNode(child);
    childFiber.return = parentFiber;

    if (!prevSibling) {
      parentFiber.child = childFiber;
    } else {
      prevSibling.sibling = childFiber;
    }

    prevSibling = childFiber;
    buildFiberChildren(childFiber, child);
  }
}

/**
 * コード文字列からVNodeツリーをパースする（簡易的にcreateElementを実行）
 */
function parseVNodeCode(code: string): { oldTree: VNode | null; newTree: VNode | null } {
  // oldTree / newTree パターンを検出
  const hasOldNew = code.includes('const oldTree') && code.includes('const newTree');

  try {
    /* eslint-disable @typescript-eslint/no-implied-eval */
    const fn = new Function('createElement', code + (hasOldNew ? '\nreturn { oldTree, newTree };' : '\nreturn { newTree: (() => { try { return eval(arguments[1]) } catch { return null } })() };'));
    /* eslint-enable @typescript-eslint/no-implied-eval */
    // createElementのみ渡す（コード内でcreateElementを使えるようにする）
    const result = fn(createElement, code) as { oldTree?: VNode; newTree?: VNode };
    return {
      oldTree: result.oldTree ?? null,
      newTree: result.newTree ?? null,
    };
  } catch {
    // パース失敗時：コード全体をcreateElementの呼び出しとして試行
    try {
      /* eslint-disable @typescript-eslint/no-implied-eval */
      const fn2 = new Function('createElement', `return ${code}`);
      /* eslint-enable @typescript-eslint/no-implied-eval */
      const tree = fn2(createElement) as VNode;
      return { oldTree: null, newTree: tree };
    } catch {
      return { oldTree: null, newTree: null };
    }
  }
}

/**
 * サンプルごとの実行ロジック
 */
function runExample(
  index: number,
  code: string,
): { output: string; trace: string } {
  const lines: string[] = [];
  const traceLines: string[] = [];

  switch (index) {
    case 0: {
      // Hello World（単純レンダリング）
      const { newTree } = parseVNodeCode(code);
      if (newTree) {
        const renderer = new Renderer();
        renderer.render(newTree);

        lines.push('=== VDOMツリー ===');
        lines.push(renderVNodeTree(newTree));
        lines.push('=== レンダリング結果 ===');
        lines.push(`root: <${renderer.root?.tag ?? 'null'}>`);
        lines.push(`子ノード数: ${String(renderer.root?.children.length ?? 0)}`);

        for (const op of renderer.operations) {
          traceLines.push(`[${op.type}] ${op.detail}`);
        }
      } else {
        lines.push('Error: VNodeのパースに失敗しました');
      }
      break;
    }

    case 1: {
      // 差分検出（テキスト変更）
      const { oldTree, newTree } = parseVNodeCode(code);
      if (oldTree && newTree) {
        const patches = diff(oldTree, newTree);

        lines.push('=== 旧VDOMツリー ===');
        lines.push(renderVNodeTree(oldTree));
        lines.push('=== 新VDOMツリー ===');
        lines.push(renderVNodeTree(newTree));
        lines.push(`=== パッチ (${String(patches.length)}件) ===`);
        lines.push(renderPatches(patches));

        traceLines.push(`差分検出完了: ${String(patches.length)}件のパッチ`);
        for (const p of patches) {
          traceLines.push(`  ${p.type} @ [${p.path.join(', ')}]`);
        }
      } else {
        lines.push('Error: oldTree/newTreeのパースに失敗しました');
      }
      break;
    }

    case 2: {
      // リスト差分（キー付き）
      const { oldTree, newTree } = parseVNodeCode(code);
      if (oldTree && newTree) {
        const patches = diff(oldTree, newTree);

        lines.push('=== 旧VDOMツリー ===');
        lines.push(renderVNodeTree(oldTree));
        lines.push('=== 新VDOMツリー ===');
        lines.push(renderVNodeTree(newTree));
        lines.push(`=== パッチ (${String(patches.length)}件) ===`);
        lines.push(renderPatches(patches));

        const reorderPatch = patches.find((p) => p.type === PatchType.REORDER);
        if (reorderPatch) {
          traceLines.push('REORDERパッチ検出:');
          for (const move of reorderPatch.moves ?? []) {
            traceLines.push(`  ${move.type} @ index ${String(move.index)}`);
          }
        }
        for (const p of patches) {
          if (p.type !== PatchType.REORDER) {
            traceLines.push(`${p.type} @ [${p.path.join(', ')}]`);
          }
        }
      } else {
        lines.push('Error: oldTree/newTreeのパースに失敗しました');
      }
      break;
    }

    case 3: {
      // useState カウンター
      resetHookState();
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let rerenderCount = 0;
      setRerenderCallback(() => { rerenderCount++; });

      // 初回レンダリング
      setCurrentFiber(fiber);
      const [state0, setState] = useState(0);
      clearCurrentFiber();
      lines.push(`初回レンダリング: state = ${String(state0)}`);
      traceLines.push(`[useState] 初期値: ${String(state0)}`);

      // setState(1)
      setState(1);
      traceLines.push('[setState] action: 1');

      // 再レンダリング
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const [state1, setState2] = useState(0);
      clearCurrentFiber();
      lines.push(`setState(1)後: state = ${String(state1)}`);
      traceLines.push(`[再レンダリング] state = ${String(state1)}`);

      // setState(prev => prev + 1)
      setState2((prev: number) => prev + 1);
      traceLines.push('[setState] action: prev => prev + 1');

      // 再レンダリング
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const [state2] = useState(0);
      clearCurrentFiber();
      lines.push(`setState(prev => prev + 1)後: state = ${String(state2)}`);
      traceLines.push(`[再レンダリング] state = ${String(state2)}`);

      lines.push(`\n再レンダリング回数: ${String(rerenderCount)}`);
      resetHookState();
      break;
    }

    case 4: {
      // useEffect（マウント/アンマウント）
      resetHookState();
      const fiber = createFiber(FiberTag.FUNCTION, null);
      const effectLog: string[] = [];

      // マウント: deps = []
      setCurrentFiber(fiber);
      useEffect(() => {
        effectLog.push('マウントエフェクト実行');
        return () => { effectLog.push('クリーンアップ実行'); };
      }, []);
      clearCurrentFiber();
      lines.push('=== マウントフェーズ ===');
      lines.push('useEffect登録完了 (deps: [])');
      traceLines.push('[useEffect] 登録 (deps: [])');

      flushEffects();
      lines.push(`flush後: ${effectLog[effectLog.length - 1] ?? ''}`);
      traceLines.push('[flushEffects] エフェクト実行');
      for (const log of effectLog) {
        traceLines.push(`  → ${log}`);
      }

      // 依存配列変更: deps = [1]
      lines.push('\n=== 依存配列変更フェーズ ===');
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useEffect(() => {
        effectLog.push('更新エフェクト実行');
        return () => { effectLog.push('更新クリーンアップ実行'); };
      }, [1]);
      clearCurrentFiber();
      traceLines.push('[useEffect] 依存配列変更 (deps: [1])');

      flushEffects();
      lines.push(`flush後: ${effectLog[effectLog.length - 1] ?? ''}`);
      traceLines.push('[flushEffects] 更新エフェクト実行');

      lines.push('\n=== エフェクトログ ===');
      for (const log of effectLog) {
        lines.push(`  ${log}`);
      }

      resetHookState();
      break;
    }

    case 5: {
      // useMemo（メモ化）
      resetHookState();
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let computeCount = 0;

      // 初回計算
      setCurrentFiber(fiber);
      const val1 = useMemo(() => { computeCount++; return 42 * 2; }, [1, 2]);
      clearCurrentFiber();
      lines.push(`初回計算: value = ${String(val1)}, 計算回数 = ${String(computeCount)}`);
      traceLines.push(`[useMemo] 初回計算 deps:[1,2] → ${String(val1)}`);

      // 同じ依存配列でスキップ
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const val2 = useMemo(() => { computeCount++; return 42 * 2; }, [1, 2]);
      clearCurrentFiber();
      lines.push(`同じdeps: value = ${String(val2)}, 計算回数 = ${String(computeCount)} (スキップ)`);
      traceLines.push(`[useMemo] deps同一 → スキップ (計算回数: ${String(computeCount)})`);

      // 依存配列変更で再計算
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const val3 = useMemo(() => { computeCount++; return 99; }, [1, 3]);
      clearCurrentFiber();
      lines.push(`deps変更: value = ${String(val3)}, 計算回数 = ${String(computeCount)} (再計算)`);
      traceLines.push(`[useMemo] deps変更 [1,3] → 再計算 (計算回数: ${String(computeCount)})`);

      resetHookState();
      break;
    }

    case 6: {
      // Fiberツリー構築
      const { newTree } = parseVNodeCode(code);
      if (newTree) {
        const rootFiber = createFiberFromVNode(newTree);
        buildFiberChildren(rootFiber, newTree);

        lines.push('=== VDOMツリー ===');
        lines.push(renderVNodeTree(newTree));
        lines.push('=== Fiberツリー ===');
        lines.push(renderFiberTree(rootFiber));

        const allFibers = collectFibers(rootFiber);
        lines.push(`ファイバー数: ${String(allFibers.length)}`);

        traceLines.push('Fiberツリー構築完了');
        for (const f of allFibers) {
          const name = f.vnode
            ? typeof f.vnode.type === 'function' ? f.vnode.type.name : f.vnode.type
            : 'root';
          traceLines.push(`  [${f.tag}] ${name}`);
        }
      } else {
        lines.push('Error: VNodeのパースに失敗しました');
      }
      break;
    }

    case 7: {
      // 優先度スケジューリング
      const scheduler = new Scheduler();
      const fiber1 = createFiber(FiberTag.HOST, null);
      const fiber2 = createFiber(FiberTag.HOST, null);
      const fiber3 = createFiber(FiberTag.HOST, null);
      fiber1.vnode = createElement('div', { id: 'idle' });
      fiber2.vnode = createElement('div', { id: 'sync' });
      fiber3.vnode = createElement('div', { id: 'default' });

      lines.push('=== スケジュール順序 ===');
      lines.push('  1. Idle (優先度3)');
      lines.push('  2. Sync (優先度1)');
      lines.push('  3. Default (優先度2)');
      traceLines.push('[schedule] Idle レーン登録');

      scheduler.scheduleWork(fiber1, Lane.Idle, () => null);
      traceLines.push('[schedule] Sync レーン登録');
      scheduler.scheduleWork(fiber2, Lane.Sync, () => null);
      traceLines.push('[schedule] Default レーン登録');
      scheduler.scheduleWork(fiber3, Lane.Default, () => null);

      scheduler.startWorkLoop();

      lines.push('\n=== 実行順序 ===');
      const laneNames: Record<number, string> = { 1: 'Sync', 2: 'Default', 3: 'Idle' };
      for (let i = 0; i < scheduler.processedLog.length; i++) {
        const entry = scheduler.processedLog[i];
        if (entry) {
          const laneName = laneNames[entry.lane] ?? String(entry.lane);
          const id = entry.fiber.vnode ? String((entry.fiber.vnode.props as Record<string, unknown>)['id'] ?? '') : '';
          lines.push(`  ${String(i + 1)}. ${laneName} (${id})`);
          traceLines.push(`[処理] ${laneName}: ${id}`);
        }
      }

      lines.push(`\n処理済み: ${String(scheduler.processedLog.length)}件`);
      break;
    }

    case 8: {
      // バッチ更新
      resetHookState();
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let rerenderCount = 0;
      setRerenderCallback(() => { rerenderCount++; });

      setCurrentFiber(fiber);
      const [initial, setState] = useState(0);
      clearCurrentFiber();
      lines.push(`初期値: ${String(initial)}`);
      traceLines.push(`[useState] 初期値: ${String(initial)}`);

      // バッチ更新
      traceLines.push('[batchUpdates] 開始');
      batchUpdates(() => {
        setState(1);
        traceLines.push('  [setState] 1');
        setState(2);
        traceLines.push('  [setState] 2');
        setState(3);
        traceLines.push('  [setState] 3');
      });
      traceLines.push('[batchUpdates] 終了');
      traceLines.push(`再レンダリング回数: ${String(rerenderCount)}`);

      lines.push(`バッチ更新中のsetState: 3回`);
      lines.push(`再レンダリング回数: ${String(rerenderCount)} (1回に集約)`);

      // 最終値を確認
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const [finalState] = useState(0);
      clearCurrentFiber();
      lines.push(`最終値: ${String(finalState)}`);
      traceLines.push(`[最終値] state = ${String(finalState)}`);

      resetHookState();
      break;
    }

    case 9: {
      // コンポーネント追加/削除
      const { oldTree, newTree } = parseVNodeCode(code);
      if (oldTree && newTree) {
        const renderer = new Renderer();
        renderer.render(oldTree);
        const patches = diff(oldTree, newTree);
        renderer.applyPatches(patches);

        lines.push('=== 旧VDOMツリー ===');
        lines.push(renderVNodeTree(oldTree));
        lines.push('=== 新VDOMツリー ===');
        lines.push(renderVNodeTree(newTree));
        lines.push(`=== パッチ (${String(patches.length)}件) ===`);
        lines.push(renderPatches(patches));

        lines.push('=== レンダリング後DOM ===');
        lines.push(`root: <${renderer.root?.tag ?? 'null'}>`);
        lines.push(`子ノード数: ${String(renderer.root?.children.length ?? 0)}`);

        for (const op of renderer.operations) {
          traceLines.push(`[${op.type}] ${op.detail}`);
        }
      } else {
        lines.push('Error: oldTree/newTreeのパースに失敗しました');
      }
      break;
    }

    default: {
      lines.push('未対応のサンプルです');
      break;
    }
  }

  return {
    output: lines.join('\n'),
    trace: traceLines.join('\n'),
  };
}

/** イベントトレースの行に色を付ける */
function traceColor(line: string): string {
  if (line.startsWith('[useState]') || line.startsWith('[setState]')) return '#f59e0b';
  if (line.startsWith('[useEffect]') || line.startsWith('[flushEffects]')) return '#8b5cf6';
  if (line.startsWith('[useMemo]')) return '#06b6d4';
  if (line.startsWith('[batchUpdates]')) return '#ec4899';
  if (line.startsWith('[schedule]') || line.startsWith('[処理]')) return '#3b82f6';
  if (line.startsWith('[再レンダリング]') || line.startsWith('[最終値]')) return '#68d391';
  if (line.includes('INSERT')) return '#3fb950';
  if (line.includes('REMOVE') || line.includes('DELETION')) return '#f85149';
  if (line.includes('UPDATE') || line.includes('RENDER')) return '#d29922';
  if (line.includes('REPLACE')) return '#58a6ff';
  if (line.includes('REORDER')) return '#bc8cff';
  if (line.startsWith('  ')) return '#8b949e';
  return '#e2e8f0';
}

/**
 * メインUIクラス（Node.jsシミュレータと同じパターン）
 */
export class ReactSimApp {
  init(container: HTMLElement): void {
    container.style.cssText = 'display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;';

    // ヘッダ
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;';
    const title = document.createElement('h1');
    title.textContent = 'React Internal Simulator';
    title.style.cssText = 'margin:0;font-size:15px;color:#58a6ff;';
    header.appendChild(title);

    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;';
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? '';
      select.appendChild(opt);
    }
    header.appendChild(select);

    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run';
    runBtn.style.cssText = 'padding:4px 16px;background:#58a6ff;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
    header.appendChild(runBtn);
    container.appendChild(header);

    // メイン
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;overflow:hidden;';

    // 左: コードエディタ
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;';

    const codeLabel = document.createElement('div');
    codeLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#58a6ff;border-bottom:1px solid #1e293b;';
    codeLabel.textContent = 'JSX-like Component Definition';
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement('textarea');
    codeArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    codeArea.value = EXAMPLES[0]?.code ?? '';
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右: 出力 + トレース
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;';

    // 出力
    const outLabel = document.createElement('div');
    outLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#58a6ff;border-bottom:1px solid #1e293b;';
    outLabel.textContent = 'Output';
    rightPanel.appendChild(outLabel);

    const outputDiv = document.createElement('div');
    outputDiv.style.cssText = 'flex:1;padding:12px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;';
    rightPanel.appendChild(outputDiv);

    // トレース
    const traceLabel = document.createElement('div');
    traceLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;';
    traceLabel.textContent = 'React Internals Trace';
    rightPanel.appendChild(traceLabel);

    const traceDiv = document.createElement('div');
    traceDiv.style.cssText = 'flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;';
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // サンプル選択時にコードを切り替え
    select.addEventListener('change', () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) codeArea.value = ex.code;
    });

    // 実行ボタン
    runBtn.addEventListener('click', () => {
      outputDiv.innerHTML = '';
      traceDiv.innerHTML = '';

      const idx = Number(select.value);
      const result = runExample(idx, codeArea.value);

      // 出力表示
      const outEl = document.createElement('span');
      outEl.style.color = '#e2e8f0';
      outEl.textContent = result.output;
      outputDiv.appendChild(outEl);

      // トレース表示
      const traceLines = result.trace.split('\n');
      for (const line of traceLines) {
        if (line === '') continue;
        const row = document.createElement('div');
        row.style.cssText = `padding:1px 0;color:${traceColor(line)};`;
        row.textContent = line;
        traceDiv.appendChild(row);
      }
    });

    // 初回実行
    runBtn.click();
  }
}

// テスト用にエクスポート
export {
  EXAMPLES,
  renderVNodeTree,
  renderPatches,
  renderFiberTree,
  buildFiberChildren,
  runExample,
  parseVNodeCode,
  traceColor,
};
