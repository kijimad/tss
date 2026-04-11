import { describe, it, expect } from "vitest";
import { runSimulation, presets } from "../gc/index.js";
import type { GcRoot, HeapAction } from "../gc/index.js";

/** ヘルパー: ルートとアクションを簡潔に書くためのユーティリティ */
function roots(...names: string[]): GcRoot[] {
  return names.map((n) => ({ name: n, targetId: null }));
}

// === Mark-Sweep ===
describe("Mark-Sweep", () => {
  it("到達可能なオブジェクトは生存する", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.finalHeap.length).toBe(1);
    expect(result.finalHeap[0]!.id).toBe("a");
  });

  it("到達不能なオブジェクトが解放される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "alloc", objectId: "b", name: "B", size: 32 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.finalHeap.length).toBe(1);
    expect(result.stats.totalFreed).toBe(32);
  });

  it("チェーン参照を辿って全オブジェクトがマークされる", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 32 },
      { type: "alloc", objectId: "b", name: "B", size: 32 },
      { type: "alloc", objectId: "c", name: "C", size: 32 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "c" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.finalHeap.length).toBe(3);
  });

  it("ルートから外されたオブジェクトがGCで回収される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "root_set", rootName: "r", targetId: null },
      { type: "gc" },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.finalHeap.length).toBe(0);
    expect(result.stats.totalFreed).toBe(64);
  });

  it("複数GCサイクルでsurivalCountが増加する", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 32 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },
      { type: "gc" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.finalHeap[0]!.survivalCount).toBe(3);
    expect(result.stats.gcCycles).toBe(3);
  });
});

// === Reference Counting ===
describe("Reference Counting", () => {
  it("参照カウントが0になると即座に解放される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "root_set", rootName: "r", targetId: null },
    ];
    const result = runSimulation("ref-count", roots("r"), actions);
    expect(result.finalHeap.length).toBe(0);
    expect(result.stats.totalFreed).toBe(64);
  });

  it("カスケード解放が起きる", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 32 },
      { type: "alloc", objectId: "b", name: "B", size: 32 },
      { type: "alloc", objectId: "c", name: "C", size: 32 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "c" },
      { type: "root_set", rootName: "r", targetId: null },
    ];
    const result = runSimulation("ref-count", roots("r"), actions);
    expect(result.finalHeap.length).toBe(0);
    expect(result.stats.totalFreed).toBe(96);
  });

  it("循環参照はカウントが0にならない（リーク）", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "alloc", objectId: "b", name: "B", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "a" },
      { type: "root_set", rootName: "r", targetId: null },
    ];
    const result = runSimulation("ref-count", roots("r"), actions);
    // 循環参照のため解放されない
    expect(result.finalHeap.length).toBe(2);
  });

  it("循環参照検出GCで循環参照が解放される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "alloc", objectId: "b", name: "B", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "a" },
      { type: "root_set", rootName: "r", targetId: null },
      { type: "gc" },
    ];
    const result = runSimulation("ref-count", roots("r"), actions);
    expect(result.finalHeap.length).toBe(0);
    expect(result.stats.totalFreed).toBe(128);
  });

  it("複数のルートから参照されていると解放されない", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "root_set", rootName: "r1", targetId: "a" },
      { type: "root_set", rootName: "r2", targetId: "a" },
      { type: "root_set", rootName: "r1", targetId: null },
    ];
    const result = runSimulation("ref-count", roots("r1", "r2"), actions);
    expect(result.finalHeap.length).toBe(1);
  });
});

// === Mark-Compact ===
describe("Mark-Compact", () => {
  it("到達不能なオブジェクトが解放される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "alloc", objectId: "b", name: "B", size: 128 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-compact", roots("r"), actions);
    expect(result.finalHeap.length).toBe(1);
    expect(result.stats.totalFreed).toBe(128);
  });

  it("コンパクション後にアドレスが詰められる", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },  // addr: 0
      { type: "alloc", objectId: "b", name: "B", size: 128 }, // addr: 64
      { type: "alloc", objectId: "c", name: "C", size: 32 },  // addr: 192
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "ref", fromId: "a", toId: "c" },
      // Bは到達不能 → 解放後、CはBの位置に移動
      { type: "gc" },
    ];
    const result = runSimulation("mark-compact", roots("r"), actions);
    expect(result.finalHeap.length).toBe(2);
    // コンパクション後: A=0, C=64（Aの直後）
    const objA = result.finalHeap.find((o) => o.id === "a");
    const objC = result.finalHeap.find((o) => o.id === "c");
    expect(objA!.address).toBe(0);
    expect(objC!.address).toBe(64);
  });

  it("フラグメンテーションが解消される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 32 },
      { type: "alloc", objectId: "b", name: "B", size: 64 },
      { type: "alloc", objectId: "c", name: "C", size: 32 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "ref", fromId: "a", toId: "c" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-compact", roots("r"), actions);
    expect(result.stats.fragmentationRatio).toBe(0);
  });
});

// === Generational GC ===
describe("Generational GC", () => {
  it("Young世代のゴミがMinor GCで回収される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "alloc", objectId: "t", name: "Temp", size: 16 },
      { type: "gc" },
    ];
    const result = runSimulation("generational", roots("r"), actions);
    expect(result.finalHeap.length).toBe(1);
    expect(result.stats.totalFreed).toBe(16);
  });

  it("2回生存でOld世代に昇格する", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },  // 1回目生存
      { type: "gc" },  // 2回目生存 → Old昇格
    ];
    const result = runSimulation("generational", roots("r"), actions);
    expect(result.finalHeap[0]!.generation).toBe("old");
    expect(result.events.some((e) => e.type === "gen_promote")).toBe(true);
  });

  it("新規オブジェクトはYoung世代で作成される", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
    ];
    const result = runSimulation("generational", roots("r"), actions);
    expect(result.finalHeap[0]!.generation).toBe("young");
  });
});

// === 統計 ===
describe("統計", () => {
  it("割り当て量と解放量が正しい", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 64 },
      { type: "alloc", objectId: "b", name: "B", size: 128 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.stats.totalAllocated).toBe(192);
    expect(result.stats.totalFreed).toBe(128);
    expect(result.stats.finalHeapSize).toBe(64);
  });

  it("ピークヒープサイズが正しい", () => {
    const actions: HeapAction[] = [
      { type: "alloc", objectId: "a", name: "A", size: 100 },
      { type: "alloc", objectId: "b", name: "B", size: 200 },
      { type: "root_set", rootName: "r", targetId: "a" },
      { type: "gc" },
      { type: "alloc", objectId: "c", name: "C", size: 50 },
    ];
    const result = runSimulation("mark-sweep", roots("r"), actions);
    expect(result.stats.peakHeapSize).toBe(300);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.algorithm, preset.roots, preset.actions);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
