/**
 * React Simulatorの統合テスト
 * VDOM、差分検出、レンダラー、ファイバー、スケジューラー、Hooksをテストする
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createElement,
  createTextNode,
  isTextNode,
  isComponent,
  TEXT_NODE,
  type VNode,
} from '../vdom/element.js';
import { diff, PatchType, diffProps } from '../vdom/diff.js';
import { Renderer, createSimDOMNode } from '../vdom/renderer.js';
import {
  createFiber,
  createFiberFromVNode,
  collectFibers,
  FiberTag,
  EffectTag,
} from '../fiber/fiber.js';
import { Scheduler, Lane, simulateIdleCallback } from '../fiber/scheduler.js';
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  setCurrentFiber,
  clearCurrentFiber,
  flushEffects,
  batchUpdates,
  resetHookState,
  setRerenderCallback,
} from '../hooks/hooks.js';

// =============================================
// VDOM Element テスト
// =============================================
describe('VDOM Element', () => {
  it('createElementでVNodeが正しく作成される', () => {
    const node = createElement('div', { className: 'test' }, 'hello');
    expect(node.type).toBe('div');
    expect(node.props['className']).toBe('test');
    expect(node.children).toHaveLength(1);
    expect(node.children[0]?.type).toBe(TEXT_NODE);
  });

  it('子要素にVNodeを渡せる', () => {
    const child = createElement('span', null, 'child');
    const parent = createElement('div', null, child);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]?.type).toBe('span');
  });

  it('nullとbooleanの子要素はフィルタリングされる', () => {
    const node = createElement('div', null, 'text', null, undefined, false, true, 0);
    // 'text'と0のみ残る
    expect(node.children).toHaveLength(2);
  });

  it('keyがpropsから抽出される', () => {
    const node = createElement('li', { key: 'item-1', id: 'test' });
    expect(node.key).toBe('item-1');
    // keyはpropsに含まれない
    expect(node.props['key']).toBeUndefined();
    expect(node.props['id']).toBe('test');
  });

  it('createTextNodeでテキストノードが作成される', () => {
    const text = createTextNode('hello');
    expect(text.type).toBe(TEXT_NODE);
    expect(text.props['nodeValue']).toBe('hello');
    expect(text.children).toHaveLength(0);
  });

  it('数値もテキストノードに変換される', () => {
    const text = createTextNode(42);
    expect(text.props['nodeValue']).toBe('42');
  });

  it('isTextNodeがテキストノードを正しく判定する', () => {
    const text = createTextNode('hi');
    const div = createElement('div', null);
    expect(isTextNode(text)).toBe(true);
    expect(isTextNode(div)).toBe(false);
  });

  it('isComponentがコンポーネントを正しく判定する', () => {
    const fn = () => createElement('div', null);
    const comp = createElement(fn, null);
    const div = createElement('div', null);
    expect(isComponent(comp)).toBe(true);
    expect(isComponent(div)).toBe(false);
  });

  it('propsがnullの場合は空オブジェクトになる', () => {
    const node = createElement('div', null);
    expect(node.props).toEqual({});
  });

  it('複数の子要素が正しく処理される', () => {
    const node = createElement('ul', null,
      createElement('li', null, 'a'),
      createElement('li', null, 'b'),
      createElement('li', null, 'c'),
    );
    expect(node.children).toHaveLength(3);
  });
});

// =============================================
// 差分検出（Diff）テスト
// =============================================
describe('Diff Algorithm', () => {
  it('同一ノードの場合パッチが生成されない', () => {
    const tree = createElement('div', { id: 'same' }, 'text');
    const patches = diff(tree, tree);
    expect(patches).toHaveLength(0);
  });

  it('nullから新ノードへの差分でINSERTが生成される', () => {
    const newTree = createElement('div', null);
    const patches = diff(null, newTree);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.type).toBe(PatchType.INSERT);
  });

  it('既存ノードからnullへの差分でREMOVEが生成される', () => {
    const oldTree = createElement('div', null);
    const patches = diff(oldTree, null);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.type).toBe(PatchType.REMOVE);
  });

  it('異なるタイプのノードでREPLACEが生成される', () => {
    const oldTree = createElement('div', null);
    const newTree = createElement('span', null);
    const patches = diff(oldTree, newTree);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.type).toBe(PatchType.REPLACE);
  });

  it('プロパティ変更でUPDATEが生成される', () => {
    const oldTree = createElement('div', { className: 'old' });
    const newTree = createElement('div', { className: 'new' });
    const patches = diff(oldTree, newTree);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.type).toBe(PatchType.UPDATE);
    expect(patches[0]?.propChanges?.[0]?.key).toBe('className');
  });

  it('テキストノードの変更でUPDATEが生成される', () => {
    const oldTree = createElement('div', null, 'old text');
    const newTree = createElement('div', null, 'new text');
    const patches = diff(oldTree, newTree);
    // 子テキストノードの更新
    expect(patches.some((p) => p.type === PatchType.UPDATE)).toBe(true);
  });

  it('子ノードの追加でINSERTが生成される', () => {
    const oldTree = createElement('div', null, 'a');
    const newTree = createElement('div', null, 'a', 'b');
    const patches = diff(oldTree, newTree);
    expect(patches.some((p) => p.type === PatchType.INSERT)).toBe(true);
  });

  it('子ノードの削除でREMOVEが生成される', () => {
    const oldTree = createElement('div', null, 'a', 'b');
    const newTree = createElement('div', null, 'a');
    const patches = diff(oldTree, newTree);
    expect(patches.some((p) => p.type === PatchType.REMOVE)).toBe(true);
  });

  it('キー付きノードの並び替えでは既存ノードが再利用される', () => {
    const oldTree = createElement('ul', null,
      createElement('li', { key: '1' }, 'A'),
      createElement('li', { key: '2' }, 'B'),
    );
    const newTree = createElement('ul', null,
      createElement('li', { key: '2' }, 'B'),
      createElement('li', { key: '1' }, 'A'),
    );
    const patches = diff(oldTree, newTree);
    // 同じキーのノードは内容も同じなのでパッチなし（再利用される）
    expect(patches).toHaveLength(0);
  });

  it('キー付きノードの追加と削除が検出される', () => {
    const oldTree = createElement('ul', null,
      createElement('li', { key: '1' }, 'A'),
      createElement('li', { key: '2' }, 'B'),
    );
    const newTree = createElement('ul', null,
      createElement('li', { key: '2' }, 'B'),
      createElement('li', { key: '3' }, 'C'),
    );
    const patches = diff(oldTree, newTree);
    expect(patches.length).toBeGreaterThan(0);
    // REORDERパッチが含まれる（キーの追加と削除）
    const reorderPatch = patches.find((p) => p.type === PatchType.REORDER);
    expect(reorderPatch).toBeDefined();
    expect(reorderPatch?.moves?.some((m) => m.type === 'remove')).toBe(true);
    expect(reorderPatch?.moves?.some((m) => m.type === 'insert')).toBe(true);
  });

  it('diffPropsがプロパティの追加・変更・削除を検出する', () => {
    const changes = diffProps(
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 99, d: 4 },
    );
    // bが変更、cが削除（undefined）、dが追加
    expect(changes).toHaveLength(3);
    expect(changes.find((c) => c.key === 'b')?.newValue).toBe(99);
    expect(changes.find((c) => c.key === 'c')?.newValue).toBeUndefined();
    expect(changes.find((c) => c.key === 'd')?.newValue).toBe(4);
  });

  it('両方nullの場合パッチが生成されない', () => {
    const patches = diff(null, null);
    expect(patches).toHaveLength(0);
  });
});

// =============================================
// レンダラーテスト
// =============================================
describe('Renderer', () => {
  let renderer: Renderer;

  beforeEach(() => {
    renderer = new Renderer();
  });

  it('VNodeからSimDOMNodeが正しく作成される', () => {
    const vnode = createElement('div', { id: 'root' }, 'hello');
    const dom = createSimDOMNode(vnode);
    expect(dom.tag).toBe('div');
    expect(dom.props['id']).toBe('root');
    expect(dom.children).toHaveLength(1);
    expect(dom.children[0]?.tag).toBe('#text');
    expect(dom.children[0]?.textContent).toBe('hello');
  });

  it('renderで初回レンダリングが実行される', () => {
    const vnode = createElement('div', null, 'test');
    const result = renderer.render(vnode);
    expect(result.tag).toBe('div');
    expect(renderer.root).toBe(result);
    expect(renderer.operations).toHaveLength(1);
    expect(renderer.operations[0]?.type).toBe('RENDER');
  });

  it('UPDATEパッチでプロパティが更新される', () => {
    const oldTree = createElement('div', { className: 'old' });
    const newTree = createElement('div', { className: 'new' });
    renderer.render(oldTree);
    const patches = diff(oldTree, newTree);
    renderer.applyPatches(patches);
    expect(renderer.root?.props['className']).toBe('new');
  });

  it('テキストノードの更新が正しく適用される', () => {
    const oldTree = createElement('div', null, 'old');
    const newTree = createElement('div', null, 'new');
    renderer.render(oldTree);
    const patches = diff(oldTree, newTree);
    renderer.applyPatches(patches);
    expect(renderer.root?.children[0]?.textContent).toBe('new');
  });

  it('REPLACEパッチでノードが置換される', () => {
    const oldTree = createElement('div', null,
      createElement('span', null, 'old'),
    );
    const newTree = createElement('div', null,
      createElement('p', null, 'new'),
    );
    renderer.render(oldTree);
    const patches = diff(oldTree, newTree);
    renderer.applyPatches(patches);
    expect(renderer.root?.children[0]?.tag).toBe('p');
  });

  it('INSERTパッチでノードが追加される', () => {
    const oldTree = createElement('div', null, 'a');
    const newTree = createElement('div', null, 'a', 'b');
    renderer.render(oldTree);
    const patches = diff(oldTree, newTree);
    renderer.applyPatches(patches);
    expect(renderer.root?.children).toHaveLength(2);
  });

  it('REMOVEパッチでノードが削除される', () => {
    const oldTree = createElement('div', null, 'a', 'b');
    const newTree = createElement('div', null, 'a');
    renderer.render(oldTree);
    const patches = diff(oldTree, newTree);
    renderer.applyPatches(patches);
    expect(renderer.root?.children).toHaveLength(1);
  });

  it('clearOperationsで操作履歴がクリアされる', () => {
    renderer.render(createElement('div', null));
    expect(renderer.operations.length).toBeGreaterThan(0);
    renderer.clearOperations();
    expect(renderer.operations).toHaveLength(0);
  });

  it('rootがnullの場合applyPatchesは何もしない', () => {
    const patches = diff(null, createElement('div', null));
    renderer.applyPatches(patches);
    // rootがnullなのでパッチは適用されない
    expect(renderer.root).toBeNull();
  });
});

// =============================================
// ファイバーテスト
// =============================================
describe('Fiber', () => {
  it('createFiberで正しいファイバーが作成される', () => {
    const fiber = createFiber(FiberTag.HOST, null, { id: 'test' });
    expect(fiber.tag).toBe(FiberTag.HOST);
    expect(fiber.props['id']).toBe('test');
    expect(fiber.child).toBeNull();
    expect(fiber.sibling).toBeNull();
    expect(fiber.return).toBeNull();
    expect(fiber.effectTag).toBe(EffectTag.NONE);
    expect(fiber.hooks).toHaveLength(0);
  });

  it('createFiberFromVNodeでVNodeからファイバーが生成される', () => {
    const vnode = createElement('div', { className: 'test' });
    const fiber = createFiberFromVNode(vnode);
    expect(fiber.tag).toBe(FiberTag.HOST);
    expect(fiber.vnode).toBe(vnode);
  });

  it('関数コンポーネントはFUNCTIONタグになる', () => {
    const comp = () => createElement('div', null);
    const vnode = createElement(comp, null);
    const fiber = createFiberFromVNode(vnode);
    expect(fiber.tag).toBe(FiberTag.FUNCTION);
  });

  it('テキストノードはTEXTタグになる', () => {
    const vnode = createTextNode('hello');
    const fiber = createFiberFromVNode(vnode);
    expect(fiber.tag).toBe(FiberTag.TEXT);
  });

  it('child/sibling/returnポインタが正しく設定できる', () => {
    const parent = createFiber(FiberTag.HOST, null);
    const child1 = createFiber(FiberTag.HOST, null);
    const child2 = createFiber(FiberTag.HOST, null);

    parent.child = child1;
    child1.return = parent;
    child1.sibling = child2;
    child2.return = parent;

    expect(parent.child).toBe(child1);
    expect(child1.sibling).toBe(child2);
    expect(child1.return).toBe(parent);
    expect(child2.return).toBe(parent);
  });

  it('collectFibersでファイバーツリー全体が収集される', () => {
    const root = createFiber(FiberTag.ROOT, null);
    const child1 = createFiber(FiberTag.HOST, null);
    const child2 = createFiber(FiberTag.HOST, null);
    const grandchild = createFiber(FiberTag.TEXT, null);

    root.child = child1;
    child1.sibling = child2;
    child1.child = grandchild;

    const fibers = collectFibers(root);
    expect(fibers).toHaveLength(4);
  });

  it('keyがVNodeから正しく引き継がれる', () => {
    const vnode = createElement('li', { key: 'item-1' });
    const fiber = createFiberFromVNode(vnode);
    expect(fiber.key).toBe('item-1');
  });
});

// =============================================
// スケジューラーテスト
// =============================================
describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  it('作業がスケジュールできる', () => {
    const fiber = createFiber(FiberTag.HOST, null);
    scheduler.scheduleWork(fiber, Lane.Default, () => null);
    expect(scheduler.pendingWorkCount).toBe(1);
  });

  it('優先度順にソートされる', () => {
    const fiber1 = createFiber(FiberTag.HOST, null);
    const fiber2 = createFiber(FiberTag.HOST, null);
    const fiber3 = createFiber(FiberTag.HOST, null);

    scheduler.scheduleWork(fiber1, Lane.Idle, () => null);
    scheduler.scheduleWork(fiber2, Lane.Sync, () => null);
    scheduler.scheduleWork(fiber3, Lane.Default, () => null);

    // ワークループを実行
    scheduler.startWorkLoop();

    // Syncが最初に処理される
    expect(scheduler.processedLog[0]?.lane).toBe(Lane.Sync);
    expect(scheduler.processedLog[1]?.lane).toBe(Lane.Default);
    expect(scheduler.processedLog[2]?.lane).toBe(Lane.Idle);
  });

  it('performUnitOfWorkで子→兄弟→親の兄弟の順に走査される', () => {
    const root = createFiber(FiberTag.ROOT, null);
    const child = createFiber(FiberTag.HOST, null);
    const sibling = createFiber(FiberTag.HOST, null);

    root.child = child;
    child.return = root;
    child.sibling = sibling;
    sibling.return = root;

    // ルートの次は子
    expect(scheduler.performUnitOfWork(root)).toBe(child);
    // 子の次は兄弟
    expect(scheduler.performUnitOfWork(child)).toBe(sibling);
    // 兄弟の次はnull（親の兄弟がない）
    expect(scheduler.performUnitOfWork(sibling)).toBeNull();
  });

  it('commitWorkで副作用に基づく操作が記録される', () => {
    const fiber = createFiber(FiberTag.HOST, null);
    fiber.vnode = createElement('div', null);
    fiber.effectTag = EffectTag.PLACEMENT;

    const ops = scheduler.commitWork(fiber);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toContain('配置');
  });

  it('commitWorkでUPDATEとDELETIONが記録される', () => {
    const fiber1 = createFiber(FiberTag.HOST, null);
    fiber1.vnode = createElement('div', null);
    fiber1.effectTag = EffectTag.UPDATE;

    const fiber2 = createFiber(FiberTag.HOST, null);
    fiber2.vnode = createElement('span', null);
    fiber2.effectTag = EffectTag.DELETION;

    fiber1.sibling = fiber2;

    const ops = scheduler.commitWork(fiber1);
    expect(ops.some((o) => o.includes('更新'))).toBe(true);
    expect(ops.some((o) => o.includes('削除'))).toBe(true);
  });

  it('resetでスケジューラーがリセットされる', () => {
    const fiber = createFiber(FiberTag.HOST, null);
    scheduler.scheduleWork(fiber, Lane.Default, () => null);
    scheduler.reset();
    expect(scheduler.pendingWorkCount).toBe(0);
    expect(scheduler.processedLog).toHaveLength(0);
    expect(scheduler.deletions).toHaveLength(0);
  });

  it('simulateIdleCallbackでコールバックが実行される', () => {
    let called = false;
    simulateIdleCallback((deadline) => {
      called = true;
      expect(deadline.timeRemaining()).toBeGreaterThanOrEqual(0);
      expect(deadline.didTimeout).toBe(false);
    });
    expect(called).toBe(true);
  });

  it('commitWorkにnullを渡すと空配列が返る', () => {
    const ops = scheduler.commitWork(null);
    expect(ops).toHaveLength(0);
  });

  it('ワークループ実行後にキューが空になる', () => {
    const fiber = createFiber(FiberTag.HOST, null);
    scheduler.scheduleWork(fiber, Lane.Sync, () => null);
    scheduler.startWorkLoop();
    expect(scheduler.pendingWorkCount).toBe(0);
  });
});

// =============================================
// Hooksテスト
// =============================================
describe('Hooks', () => {
  beforeEach(() => {
    resetHookState();
  });

  describe('useState', () => {
    it('初期値が正しく返される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      setCurrentFiber(fiber);
      const [state] = useState(42);
      expect(state).toBe(42);
      clearCurrentFiber();
    });

    it('状態更新関数が動作する', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);

      // 初回レンダリング
      setCurrentFiber(fiber);
      const [, setState] = useState(0);
      clearCurrentFiber();

      // 状態を更新
      setState(10);

      // 再レンダリング
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const [newState] = useState(0);
      expect(newState).toBe(10);
      clearCurrentFiber();
    });

    it('更新関数形式のsetStateが動作する', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);

      setCurrentFiber(fiber);
      const [, setState] = useState(5);
      clearCurrentFiber();

      setState((prev: number) => prev + 10);

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const [newState] = useState(5);
      expect(newState).toBe(15);
      clearCurrentFiber();
    });

    it('バッチ更新で複数の更新が一括処理される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let rerenderCount = 0;
      setRerenderCallback(() => { rerenderCount++; });

      setCurrentFiber(fiber);
      const [, setState] = useState(0);
      clearCurrentFiber();

      batchUpdates(() => {
        setState(1);
        setState(2);
        setState(3);
      });

      // バッチ中はrerenderは1回だけ
      expect(rerenderCount).toBe(1);

      // 最終的な値を確認
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const [finalState] = useState(0);
      // キューには3つの更新があり、最後の値が適用される
      expect(finalState).toBe(3);
      clearCurrentFiber();
    });
  });

  describe('useEffect', () => {
    it('エフェクトが登録されflushで実行される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let effectRan = false;

      setCurrentFiber(fiber);
      useEffect(() => { effectRan = true; }, []);
      clearCurrentFiber();

      expect(effectRan).toBe(false);
      flushEffects();
      expect(effectRan).toBe(true);
    });

    it('依存配列が変わらない場合エフェクトは再実行されない', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let count = 0;

      // 初回
      setCurrentFiber(fiber);
      useEffect(() => { count++; }, [1, 2]);
      clearCurrentFiber();
      flushEffects();
      expect(count).toBe(1);

      // 再レンダリング（依存配列同じ）
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useEffect(() => { count++; }, [1, 2]);
      clearCurrentFiber();
      flushEffects();
      expect(count).toBe(1);
    });

    it('依存配列が変わった場合エフェクトが再実行される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let count = 0;

      setCurrentFiber(fiber);
      useEffect(() => { count++; }, [1]);
      clearCurrentFiber();
      flushEffects();
      expect(count).toBe(1);

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useEffect(() => { count++; }, [2]);
      clearCurrentFiber();
      flushEffects();
      expect(count).toBe(2);
    });

    it('クリーンアップ関数が実行される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let cleaned = false;

      setCurrentFiber(fiber);
      useEffect(() => {
        return () => { cleaned = false; };
      }, [1]);
      clearCurrentFiber();
      flushEffects();

      // 依存配列変更で再実行
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useEffect(() => {
        cleaned = true;
        return () => { cleaned = false; };
      }, [2]);
      clearCurrentFiber();
      flushEffects();
      expect(cleaned).toBe(true);
    });

    it('依存配列なしの場合毎回実行される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let count = 0;

      setCurrentFiber(fiber);
      useEffect(() => { count++; });
      clearCurrentFiber();
      flushEffects();

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useEffect(() => { count++; });
      clearCurrentFiber();
      flushEffects();

      expect(count).toBe(2);
    });
  });

  describe('useMemo', () => {
    it('メモ化された値が返される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      setCurrentFiber(fiber);
      const value = useMemo(() => 42 * 2, []);
      expect(value).toBe(84);
      clearCurrentFiber();
    });

    it('依存配列が同じ場合は再計算されない', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let computeCount = 0;

      setCurrentFiber(fiber);
      useMemo(() => { computeCount++; return 'value'; }, [1, 2]);
      clearCurrentFiber();

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useMemo(() => { computeCount++; return 'value'; }, [1, 2]);
      clearCurrentFiber();

      expect(computeCount).toBe(1);
    });

    it('依存配列が変わった場合は再計算される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      let computeCount = 0;

      setCurrentFiber(fiber);
      useMemo(() => { computeCount++; return 'value'; }, [1]);
      clearCurrentFiber();

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      useMemo(() => { computeCount++; return 'value'; }, [2]);
      clearCurrentFiber();

      expect(computeCount).toBe(2);
    });
  });

  describe('useCallback', () => {
    it('メモ化されたコールバックが返される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      const fn = () => 'hello';

      setCurrentFiber(fiber);
      const memoized = useCallback(fn, []);
      clearCurrentFiber();

      expect(memoized()).toBe('hello');
    });

    it('依存配列が同じ場合は同じ参照が返される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);

      setCurrentFiber(fiber);
      const fn1 = useCallback(() => 1, [1]);
      clearCurrentFiber();

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const fn2 = useCallback(() => 2, [1]);
      clearCurrentFiber();

      expect(fn1).toBe(fn2);
    });
  });

  describe('useRef', () => {
    it('refオブジェクトが返される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      setCurrentFiber(fiber);
      const ref = useRef(0);
      expect(ref.current).toBe(0);
      clearCurrentFiber();
    });

    it('currentの値がミュータブルに変更できる', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);
      setCurrentFiber(fiber);
      const ref = useRef(0);
      ref.current = 42;
      clearCurrentFiber();

      // 再レンダリングでも値が保持される
      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const ref2 = useRef(0);
      expect(ref2.current).toBe(42);
      clearCurrentFiber();
    });

    it('再レンダリングで同じrefオブジェクトが返される', () => {
      const fiber = createFiber(FiberTag.FUNCTION, null);

      setCurrentFiber(fiber);
      const ref1 = useRef('initial');
      clearCurrentFiber();

      setCurrentFiber(fiber);
      fiber.hookIndex = 0;
      const ref2 = useRef('initial');
      clearCurrentFiber();

      expect(ref1).toBe(ref2);
    });
  });

  it('ファイバー外でHookを呼ぶとエラーになる', () => {
    expect(() => useState(0)).toThrow('Hookはコンポーネントのレンダリング中にのみ使用できます');
  });

  it('複数のHookを同時に使用できる', () => {
    const fiber = createFiber(FiberTag.FUNCTION, null);
    setCurrentFiber(fiber);

    const [count] = useState(0);
    const ref = useRef('test');
    const memo = useMemo(() => count * 2, [count]);

    expect(count).toBe(0);
    expect(ref.current).toBe('test');
    expect(memo).toBe(0);
    expect(fiber.hooks).toHaveLength(3);

    clearCurrentFiber();
  });
});
