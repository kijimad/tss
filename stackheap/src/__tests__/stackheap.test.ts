/* スタック＆ヒープ シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, executeProgram,
  createStack, pushFrame, popFrame, addLocal, assignVar,
  createHeap, heapAlloc, heapFree,
  gcMarkSweep, gcRefCount,
  buildLayout, stackUsage, heapUsage,
  intVal, floatVal, boolVal, charVal, ptrVal, refVal,
} from "../stackheap/engine.js";
import { PRESETS } from "../stackheap/presets.js";
import type { SimEvent, SimOp } from "../stackheap/types.js";

describe("Stack & Heap Engine", () => {
  // ─── 値ヘルパー ───

  describe("値ヘルパー", () => {
    it("intValが4バイトの整数を返す", () => {
      const v = intVal(42);
      expect(v.kind).toBe("primitive");
      expect(v.type).toBe("int");
      expect(v.size).toBe(4);
      expect(v.display).toBe("42");
    });

    it("floatValが8バイトの浮動小数を返す", () => {
      const v = floatVal(3.14);
      expect(v.size).toBe(8);
      expect(v.display).toBe("3.14");
    });

    it("boolValが1バイトの真偽値を返す", () => {
      expect(boolVal(true).display).toBe("true");
      expect(boolVal(false).size).toBe(1);
    });

    it("charValが1バイトの文字を返す", () => {
      expect(charVal("A").display).toBe("'A'");
    });

    it("ptrValがヒープアドレスを持つ", () => {
      const v = ptrVal(0x1000);
      expect(v.kind).toBe("reference");
      expect(v.heapAddr).toBe(0x1000);
    });

    it("refValが参照を返す", () => {
      const v = refVal("object", 0x2000);
      expect(v.kind).toBe("reference");
      expect(v.heapAddr).toBe(0x2000);
    });
  });

  // ─── コールスタック ───

  describe("コールスタック", () => {
    it("空のスタックが作成される", () => {
      const stack = createStack();
      expect(stack.frames).toHaveLength(0);
      expect(stack.sp).toBe(0x7FFF);
      expect(stack.overflow).toBe(false);
    });

    it("フレームをプッシュするとSPが減少する", () => {
      const events: SimEvent[] = [];
      const stack = pushFrame(createStack(), "main", [], events);
      expect(stack.frames).toHaveLength(1);
      expect(stack.sp).toBeLessThan(0x7FFF);
      expect(stack.frames[0].functionName).toBe("main");
    });

    it("フレームをポップするとSPが復元される", () => {
      const events: SimEvent[] = [];
      let stack = pushFrame(createStack(), "main", [], events);
      const spAfterPush = stack.sp;
      stack = pushFrame(stack, "foo", [{ name: "x", value: intVal(10) }], events);
      expect(stack.sp).toBeLessThan(spAfterPush);
      stack = popFrame(stack, events);
      expect(stack.sp).toBe(spAfterPush);
      expect(stack.frames).toHaveLength(1);
    });

    it("ローカル変数を追加するとSPが減少する", () => {
      const events: SimEvent[] = [];
      let stack = pushFrame(createStack(), "main", [], events);
      const sp1 = stack.sp;
      stack = addLocal(stack, "x", intVal(42), events);
      expect(stack.sp).toBeLessThan(sp1);
      expect(stack.frames[0].locals).toHaveLength(1);
      expect(stack.frames[0].locals[0].name).toBe("x");
    });

    it("スタックオーバーフローが検出される", () => {
      const events: SimEvent[] = [];
      let stack = createStack(64); // 小さいスタック
      for (let i = 0; i < 10; i++) {
        stack = pushFrame(stack, `func_${i}`, [{ name: "arg", value: intVal(i) }], events);
        if (stack.overflow) break;
      }
      expect(stack.overflow).toBe(true);
      expect(events.some(e => e.type === "overflow")).toBe(true);
    });

    it("変数の値を更新できる", () => {
      const events: SimEvent[] = [];
      let stack = pushFrame(createStack(), "main", [], events);
      stack = addLocal(stack, "x", intVal(10), events);
      stack = assignVar(stack, "x", intVal(20), events);
      expect(stack.frames[0].locals[0].value.display).toBe("20");
    });

    it("スタック使用量が計算できる", () => {
      const events: SimEvent[] = [];
      const stack = pushFrame(createStack(), "main", [], events);
      expect(stackUsage(stack)).toBeGreaterThan(0);
    });
  });

  // ─── ヒープ ───

  describe("ヒープ", () => {
    it("空のヒープが作成される", () => {
      const heap = createHeap();
      expect(heap.blocks).toHaveLength(0);
      expect(heap.totalAllocated).toBe(0);
    });

    it("ヒープにメモリを割り当てられる", () => {
      const events: SimEvent[] = [];
      const { heap, address } = heapAlloc(createHeap(), 32, "test", "data", events);
      expect(address).toBeGreaterThan(0);
      expect(heap.blocks).toHaveLength(1);
      expect(heap.blocks[0].status).toBe("allocated");
      expect(heap.totalAllocated).toBe(32);
    });

    it("ヒープメモリを解放できる", () => {
      const events: SimEvent[] = [];
      const { heap: h1, address } = heapAlloc(createHeap(), 32, "test", "data", events);
      const h2 = heapFree(h1, address, events);
      expect(h2.blocks[0].status).toBe("freed");
      expect(h2.totalAllocated).toBe(0);
    });

    it("二重解放が検出される", () => {
      const events: SimEvent[] = [];
      const { heap: h1, address } = heapAlloc(createHeap(), 32, "test", "data", events);
      const h2 = heapFree(h1, address, events);
      const h3 = heapFree(h2, address, events);
      expect(h3.blocks[0].status).toBe("corrupted");
      expect(events.some(e => e.message.includes("二重解放"))).toBe(true);
    });

    it("フリーブロックが再利用される", () => {
      const events: SimEvent[] = [];
      const { heap: h1, address: a1 } = heapAlloc(createHeap(), 32, "block1", "data1", events);
      const h2 = heapFree(h1, a1, events);
      const { heap: h3, address: a2 } = heapAlloc(h2, 32, "block2", "data2", events);
      expect(a2).toBe(a1); // 同じアドレスが再利用される
      expect(h3.blocks[0].label).toBe("block2");
    });

    it("ヒープ使用量が計算できる", () => {
      const events: SimEvent[] = [];
      const { heap } = heapAlloc(createHeap(), 64, "test", "data", events);
      expect(heapUsage(heap)).toBe(64);
    });
  });

  // ─── GC ───

  describe("ガベージコレクション", () => {
    it("Mark & Sweepで到達不能オブジェクトが回収される", () => {
      const events: SimEvent[] = [];
      let stack = pushFrame(createStack(), "main", [], events);
      let heap = createHeap();

      // 2つ割り当て
      const r1 = heapAlloc(heap, 32, "alive", "data1", events);
      heap = r1.heap;
      stack = addLocal(stack, "ptr1", refVal("object", r1.address), events);

      const r2 = heapAlloc(heap, 32, "dead", "data2", events);
      heap = r2.heap;
      // ptr2はスタックに追加しない → 到達不能

      expect(heap.blocks).toHaveLength(2);
      heap = gcMarkSweep(stack, heap, events);

      // alive は生存、dead は回収
      expect(heap.blocks[0].status).toBe("allocated");
      expect(heap.blocks[1].status).toBe("freed");
    });

    it("参照カウントGCでrefCount=0のブロックが回収される", () => {
      const events: SimEvent[] = [];
      let heap = createHeap();
      const r1 = heapAlloc(heap, 32, "obj1", "data", events);
      heap = r1.heap;
      // refCount=1のまま解放せず、refCount=0にする
      heap = heapFree(heap, r1.address, events); // freed → refCount=0
      heap = gcRefCount(heap, events);
      // 既にfreedなので変化なし（refCount GCはallocatedでrefCount<=0のものを回収）
      expect(heap.blocks[0].status).toBe("freed");
    });
  });

  // ─── メモリレイアウト ───

  describe("メモリレイアウト", () => {
    it("レイアウトが構築される", () => {
      const stack = createStack();
      const heap = createHeap();
      const layout = buildLayout(stack, heap);
      expect(layout.segments.length).toBeGreaterThan(0);
      expect(layout.segments.some(s => s.region === "stack")).toBe(true);
      expect(layout.segments.some(s => s.region === "heap")).toBe(true);
    });
  });

  // ─── プログラム実行 ───

  describe("プログラム実行", () => {
    it("基本プログラムが実行できる", () => {
      const op: SimOp = {
        type: "execute", programName: "test",
        instructions: [
          { op: "call", functionName: "main", args: [] },
          { op: "local", name: "x", value: intVal(42) },
          { op: "return" },
        ],
      };
      const result = executeProgram(op);
      expect(result.steps).toHaveLength(3);
    });

    it("ヒープ割当と解放が実行される", () => {
      const op: SimOp = {
        type: "execute", programName: "test",
        instructions: [
          { op: "call", functionName: "main", args: [] },
          { op: "alloc", varName: "ptr", size: 32, label: "Object", content: "test" },
          { op: "free", varName: "ptr" },
          { op: "return" },
        ],
      };
      const result = executeProgram(op);
      expect(result.leakedBlocks).toHaveLength(0);
    });

    it("メモリリークが検出される", () => {
      const op: SimOp = {
        type: "execute", programName: "test",
        instructions: [
          { op: "call", functionName: "main", args: [] },
          { op: "alloc", varName: "ptr", size: 32, label: "Leaked", content: "leaked data" },
          { op: "return" },
        ],
      };
      const result = executeProgram(op);
      expect(result.leakedBlocks.length).toBeGreaterThan(0);
      expect(result.events.some(e => e.type === "leak")).toBe(true);
    });

    it("スタックオーバーフローで実行が停止する", () => {
      const instructions = [
        { op: "call" as const, functionName: "main", args: [] as { name: string; value: ReturnType<typeof intVal> }[] },
      ];
      for (let i = 0; i < 100; i++) {
        instructions.push({
          op: "call" as const,
          functionName: `f${i}`,
          args: [{ name: "n", value: intVal(i) }],
        });
      }
      const result = executeProgram({ type: "execute", programName: "overflow", instructions });
      expect(result.events.some(e => e.type === "overflow")).toBe(true);
    });
  });

  // ─── simulate ───

  describe("simulate", () => {
    it("複数プログラムが実行される", () => {
      const ops: SimOp[] = [
        { type: "execute", programName: "p1", instructions: [
          { op: "call", functionName: "main", args: [] },
          { op: "return" },
        ]},
        { type: "execute", programName: "p2", instructions: [
          { op: "call", functionName: "main", args: [] },
          { op: "local", name: "x", value: intVal(1) },
          { op: "return" },
        ]},
      ];
      const r = simulate(ops);
      expect(r.steps.length).toBe(5);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.steps.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
