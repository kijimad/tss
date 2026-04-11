import type {
  GcAlgorithm, HeapObject, GcRoot, HeapAction,
  SimEvent, SimulationResult, EventType,
} from "./types.js";

/** ヒープアドレス割り当て用カウンタ */
let nextAddress = 0;

/** ヒープとルートの深いコピー */
function cloneHeap(heap: HeapObject[]): HeapObject[] {
  return heap.map((o) => ({ ...o, refs: [...o.refs] }));
}
function cloneRoots(roots: GcRoot[]): GcRoot[] {
  return roots.map((r) => ({ ...r }));
}

/** シミュレーション実行 */
export function runSimulation(
  algorithm: GcAlgorithm,
  initialRoots: GcRoot[],
  actions: HeapAction[],
): SimulationResult {
  const heap: HeapObject[] = [];
  const roots: GcRoot[] = cloneRoots(initialRoots);
  const events: SimEvent[] = [];
  let step = 0;
  let totalAllocated = 0;
  let totalFreed = 0;
  let gcCycles = 0;
  let peakHeapSize = 0;
  nextAddress = 0;

  function emit(type: EventType, desc: string, targetIds: string[] = []): void {
    events.push({
      step,
      type,
      description: desc,
      heapSnapshot: cloneHeap(heap),
      rootSnapshot: cloneRoots(roots),
      targetIds,
    });
  }

  function currentHeapSize(): number {
    return heap.reduce((s, o) => s + o.size, 0);
  }

  function updatePeak(): void {
    const size = currentHeapSize();
    if (size > peakHeapSize) peakHeapSize = size;
  }

  function findObject(id: string): HeapObject | undefined {
    return heap.find((o) => o.id === id);
  }

  /** ルートから到達可能なすべてのオブジェクトIDを返す */
  function reachableIds(): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const root of roots) {
      if (root.targetId) queue.push(root.targetId);
    }
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const obj = findObject(id);
      if (obj) {
        for (const ref of obj.refs) queue.push(ref);
      }
    }
    return visited;
  }

  // ── Mark-Sweep GC ──
  function markSweepGc(): void {
    gcCycles++;
    emit("gc_start", `Mark-Sweep GC 開始 (サイクル #${gcCycles})`);

    // マークフェーズ: 全オブジェクトのマークをクリア
    for (const obj of heap) obj.marked = false;

    // ルートからマーク
    const markQueue: string[] = [];
    for (const root of roots) {
      if (root.targetId) {
        const obj = findObject(root.targetId);
        if (obj && !obj.marked) {
          obj.marked = true;
          markQueue.push(root.targetId);
          emit("gc_mark_root", `ルート "${root.name}" → ${obj.name} をマーク`, [obj.id]);
        }
      }
    }

    // トレース（参照を辿る）
    while (markQueue.length > 0) {
      const id = markQueue.pop()!;
      const obj = findObject(id);
      if (!obj) continue;
      for (const refId of obj.refs) {
        const target = findObject(refId);
        if (target && !target.marked) {
          target.marked = true;
          markQueue.push(refId);
          emit("gc_mark_traverse", `${obj.name} → ${target.name} をマーク`, [obj.id, target.id]);
        }
      }
    }

    emit("gc_mark_complete", `マークフェーズ完了: ${heap.filter((o) => o.marked).length}個が到達可能`);

    // スイープフェーズ
    emit("gc_sweep", "スイープフェーズ開始");
    const toRemove: string[] = [];
    for (const obj of heap) {
      if (!obj.marked) {
        toRemove.push(obj.id);
        totalFreed += obj.size;
        emit("gc_sweep_free", `${obj.name} (${obj.size}B, addr:${obj.address}) を解放`, [obj.id]);
      } else {
        obj.survivalCount++;
        emit("gc_sweep_survive", `${obj.name} は生存 (${obj.survivalCount}回目)`, [obj.id]);
      }
    }
    for (const id of toRemove) {
      const idx = heap.findIndex((o) => o.id === id);
      if (idx >= 0) heap.splice(idx, 1);
    }

    emit("gc_complete", `GC完了: ${toRemove.length}個解放, ヒープ残${heap.length}個 (${currentHeapSize()}B)`);
  }

  // ── Mark-Compact GC ──
  function markCompactGc(): void {
    gcCycles++;
    emit("gc_start", `Mark-Compact GC 開始 (サイクル #${gcCycles})`);

    // マークフェーズ（Mark-Sweepと同じ）
    for (const obj of heap) obj.marked = false;

    const markQueue: string[] = [];
    for (const root of roots) {
      if (root.targetId) {
        const obj = findObject(root.targetId);
        if (obj && !obj.marked) {
          obj.marked = true;
          markQueue.push(root.targetId);
          emit("gc_mark_root", `ルート "${root.name}" → ${obj.name} をマーク`, [obj.id]);
        }
      }
    }

    while (markQueue.length > 0) {
      const id = markQueue.pop()!;
      const obj = findObject(id);
      if (!obj) continue;
      for (const refId of obj.refs) {
        const target = findObject(refId);
        if (target && !target.marked) {
          target.marked = true;
          markQueue.push(refId);
          emit("gc_mark_traverse", `${obj.name} → ${target.name} をマーク`, [obj.id, target.id]);
        }
      }
    }

    emit("gc_mark_complete", `マークフェーズ完了: ${heap.filter((o) => o.marked).length}個が到達可能`);

    // コンパクションフェーズ: 転送先アドレスを計算
    let compactAddr = 0;
    const deadIds: string[] = [];
    for (const obj of heap) {
      if (obj.marked) {
        obj.forwardingAddress = compactAddr;
        emit("gc_compact_compute",
          `${obj.name}: addr ${obj.address} → ${compactAddr} (転送先計算)`, [obj.id]);
        compactAddr += obj.size;
        obj.survivalCount++;
      } else {
        deadIds.push(obj.id);
        totalFreed += obj.size;
        emit("gc_sweep_free", `${obj.name} (${obj.size}B) を解放`, [obj.id]);
      }
    }

    // 死んだオブジェクトを削除
    for (const id of deadIds) {
      const idx = heap.findIndex((o) => o.id === id);
      if (idx >= 0) heap.splice(idx, 1);
    }

    // 生存オブジェクトのアドレスを更新（コンパクション）
    for (const obj of heap) {
      if (obj.forwardingAddress !== undefined) {
        const oldAddr = obj.address;
        obj.address = obj.forwardingAddress;
        delete obj.forwardingAddress;
        emit("gc_compact_move", `${obj.name}: addr ${oldAddr} → ${obj.address} に移動`, [obj.id]);
      }
    }

    // 参照の更新（コンパクション後のアドレスに）
    emit("gc_compact_update_ref", `全参照を更新（コンパクション後のアドレスに合わせる）`);

    emit("gc_complete",
      `GC完了: ${deadIds.length}個解放, ヒープ${heap.length}個 (${currentHeapSize()}B), フラグメンテーション解消`);
  }

  // ── Reference Counting GC ──
  function refCountOnRef(_fromId: string, toId: string): void {
    const target = findObject(toId);
    if (target) {
      target.refCount++;
      emit("refcount_inc", `${target.name} の参照カウント: ${target.refCount - 1} → ${target.refCount}`, [target.id]);
    }
  }

  function refCountOnDeref(_fromId: string, toId: string): void {
    const target = findObject(toId);
    if (target) {
      target.refCount--;
      emit("refcount_dec", `${target.name} の参照カウント: ${target.refCount + 1} → ${target.refCount}`, [target.id]);
      if (target.refCount <= 0) {
        // カスケード解放
        refCountFree(target);
      }
    }
  }

  function refCountFree(obj: HeapObject): void {
    totalFreed += obj.size;
    emit("refcount_free", `${obj.name} (参照カウント=0) を即座に解放`, [obj.id]);
    // 参照先のカウントも減らす
    for (const refId of obj.refs) {
      const ref = findObject(refId);
      if (ref) {
        ref.refCount--;
        emit("refcount_dec", `  → ${ref.name} の参照カウント: ${ref.refCount + 1} → ${ref.refCount}`, [ref.id]);
        if (ref.refCount <= 0) {
          refCountFree(ref);
        }
      }
    }
    const idx = heap.findIndex((o) => o.id === obj.id);
    if (idx >= 0) heap.splice(idx, 1);
  }

  function refCountRootSet(rootName: string, newTargetId: string | null): void {
    const root = roots.find((r) => r.name === rootName);
    if (!root) return;

    // 旧参照先のカウントを減らす
    if (root.targetId) {
      const old = findObject(root.targetId);
      if (old) {
        old.refCount--;
        emit("refcount_dec", `ルート "${rootName}" 解除 → ${old.name} の参照カウント: ${old.refCount + 1} → ${old.refCount}`, [old.id]);
        if (old.refCount <= 0) {
          refCountFree(old);
        }
      }
    }

    // 新参照先のカウントを増やす
    root.targetId = newTargetId;
    if (newTargetId) {
      const obj = findObject(newTargetId);
      if (obj) {
        obj.refCount++;
        emit("refcount_inc", `ルート "${rootName}" → ${obj.name} の参照カウント: ${obj.refCount - 1} → ${obj.refCount}`, [obj.id]);
      }
    }
  }

  // ── Generational GC ──
  function generationalGc(): void {
    gcCycles++;
    const youngObjs = heap.filter((o) => o.generation === "young");
    const needsMajor = youngObjs.length === 0 || gcCycles % 5 === 0;

    if (needsMajor) {
      // Major GC: 全世代対象
      emit("gen_major_gc", `Major GC 開始 (サイクル #${gcCycles}) — 全世代対象`);
      performGenerationalCollection("all");
    } else {
      // Minor GC: Young世代のみ
      emit("gen_minor_gc", `Minor GC 開始 (サイクル #${gcCycles}) — Young世代のみ`);
      performGenerationalCollection("young");
    }
  }

  function performGenerationalCollection(scope: "young" | "all"): void {
    // マーク
    for (const obj of heap) obj.marked = false;
    const markQueue: string[] = [];
    for (const root of roots) {
      if (root.targetId) {
        const obj = findObject(root.targetId);
        if (obj && !obj.marked) {
          obj.marked = true;
          markQueue.push(root.targetId);
          emit("gc_mark_root", `ルート "${root.name}" → ${obj.name} をマーク`, [obj.id]);
        }
      }
    }
    while (markQueue.length > 0) {
      const id = markQueue.pop()!;
      const obj = findObject(id);
      if (!obj) continue;
      for (const refId of obj.refs) {
        const target = findObject(refId);
        if (target && !target.marked) {
          target.marked = true;
          markQueue.push(refId);
          emit("gc_mark_traverse", `${obj.name} → ${target.name} をマーク`, [obj.id, target.id]);
        }
      }
    }

    // スイープ
    const toRemove: string[] = [];
    for (const obj of heap) {
      if (scope === "young" && obj.generation === "old") {
        // Minor GCではOld世代はスキップ
        continue;
      }
      if (!obj.marked) {
        toRemove.push(obj.id);
        totalFreed += obj.size;
        emit("gc_sweep_free", `${obj.name} (${obj.generation}, ${obj.size}B) を解放`, [obj.id]);
      } else {
        obj.survivalCount++;
        // Young世代で2回以上生き残ったらOldに昇格
        if (obj.generation === "young" && obj.survivalCount >= 2) {
          obj.generation = "old";
          emit("gen_promote", `${obj.name} をOld世代に昇格 (${obj.survivalCount}回生存)`, [obj.id]);
        }
      }
    }
    for (const id of toRemove) {
      const idx = heap.findIndex((o) => o.id === id);
      if (idx >= 0) heap.splice(idx, 1);
    }

    emit("gc_complete",
      `GC完了: ${toRemove.length}個解放, Young=${heap.filter((o) => o.generation === "young").length}, Old=${heap.filter((o) => o.generation === "old").length}`);
  }

  // ── アクション実行 ──

  for (const action of actions) {
    step++;

    switch (action.type) {
      case "alloc": {
        const obj: HeapObject = {
          id: action.objectId,
          name: action.name,
          size: action.size,
          refs: [],
          marked: false,
          refCount: 0,
          generation: "young",
          survivalCount: 0,
          address: nextAddress,
        };
        nextAddress += action.size;
        heap.push(obj);
        totalAllocated += action.size;
        updatePeak();
        emit("alloc", `${obj.name} を割り当て (${obj.size}B, addr:${obj.address})`, [obj.id]);
        break;
      }

      case "root_set": {
        if (algorithm === "ref-count") {
          refCountRootSet(action.rootName, action.targetId);
        } else {
          const root = roots.find((r) => r.name === action.rootName);
          if (root) {
            root.targetId = action.targetId;
          }
        }
        const targetName = action.targetId ? findObject(action.targetId)?.name ?? action.targetId : "null";
        emit("root_set", `ルート "${action.rootName}" → ${targetName}`,
          action.targetId ? [action.targetId] : []);
        break;
      }

      case "ref": {
        const from = findObject(action.fromId);
        if (from && !from.refs.includes(action.toId)) {
          from.refs.push(action.toId);
          if (algorithm === "ref-count") {
            refCountOnRef(action.fromId, action.toId);
          }
          const toName = findObject(action.toId)?.name ?? action.toId;
          emit("ref_add", `${from.name} → ${toName} への参照を追加`, [action.fromId, action.toId]);
        }
        break;
      }

      case "deref": {
        const from = findObject(action.fromId);
        if (from) {
          const idx = from.refs.indexOf(action.toId);
          if (idx >= 0) {
            from.refs.splice(idx, 1);
            if (algorithm === "ref-count") {
              refCountOnDeref(action.fromId, action.toId);
            }
            const toName = findObject(action.toId)?.name ?? action.toId;
            emit("ref_remove", `${from.name} → ${toName} への参照を削除`, [action.fromId, action.toId]);
          }
        }
        break;
      }

      case "gc": {
        switch (algorithm) {
          case "mark-sweep":
            markSweepGc();
            break;
          case "mark-compact":
            markCompactGc();
            break;
          case "ref-count":
            // 参照カウントは即時解放なのでGCトリガー時は循環参照のみ検出
            gcCycles++;
            emit("gc_start", `循環参照検出GC (サイクル #${gcCycles})`);
            {
              const reachable = reachableIds();
              const toRemove: string[] = [];
              for (const obj of heap) {
                if (!reachable.has(obj.id)) {
                  toRemove.push(obj.id);
                  totalFreed += obj.size;
                  emit("refcount_free", `循環参照を検出: ${obj.name} (refCount=${obj.refCount}) を強制解放`, [obj.id]);
                }
              }
              for (const id of toRemove) {
                const idx = heap.findIndex((o) => o.id === id);
                if (idx >= 0) heap.splice(idx, 1);
              }
              emit("gc_complete", `循環参照GC完了: ${toRemove.length}個解放`);
            }
            break;
          case "generational":
            generationalGc();
            break;
        }
        break;
      }
    }
  }

  // フラグメンテーション率を計算
  const finalSize = currentHeapSize();
  const maxAddr = heap.length > 0
    ? Math.max(...heap.map((o) => o.address + o.size))
    : 0;
  const fragmentationRatio = maxAddr > 0 ? 1 - (finalSize / maxAddr) : 0;

  return {
    events,
    finalHeap: cloneHeap(heap),
    finalRoots: cloneRoots(roots),
    stats: {
      totalAllocated,
      totalFreed,
      gcCycles,
      peakHeapSize,
      finalHeapSize: finalSize,
      fragmentationRatio: Math.max(0, fragmentationRatio),
    },
  };
}
