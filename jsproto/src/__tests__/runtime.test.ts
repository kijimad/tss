import { describe, it, expect, beforeEach } from "vitest";
import { JsHeap } from "../engine/runtime.js";
import { EXAMPLES } from "../ui/app.js";
import type { JsValue } from "../engine/runtime.js";

const str = (s: string): JsValue => ({ type: "string", value: s });
const num = (n: number): JsValue => ({ type: "number", value: n });

describe("JsHeap 基本", () => {
  let heap: JsHeap;
  beforeEach(() => { heap = new JsHeap(); });

  it("Object.prototype と Function.prototype が初期化される", () => {
    expect(heap.getObject(heap.objectProtoId)).toBeDefined();
    expect(heap.getObject(heap.functionProtoId)).toBeDefined();
  });

  it("Object.prototype の [[Prototype]] は null", () => {
    expect(heap.getObject(heap.objectProtoId)!.proto).toBeNull();
  });

  it("Function.prototype の [[Prototype]] は Object.prototype", () => {
    expect(heap.getObject(heap.functionProtoId)!.proto).toBe(heap.objectProtoId);
  });
});

describe("プロパティ探索", () => {
  let heap: JsHeap;
  beforeEach(() => { heap = new JsHeap(); });

  it("own property を見つける", () => {
    const id = heap.allocate("obj", heap.objectProtoId);
    heap.setProp(id, "x", num(42));
    heap.resetTrace();
    const { value } = heap.getProperty(id, "x");
    expect(value).toEqual(num(42));
  });

  it("プロトタイプから継承したプロパティを見つける", () => {
    const id = heap.allocate("obj", heap.objectProtoId);
    heap.resetTrace();
    const { value } = heap.getProperty(id, "toString");
    expect(value).toBeDefined();
    expect(value!.type).toBe("string");
  });

  it("存在しないプロパティは undefined", () => {
    const id = heap.allocate("obj", heap.objectProtoId);
    heap.resetTrace();
    const { value } = heap.getProperty(id, "nonexistent");
    expect(value).toBeUndefined();
  });

  it("チェーンの各ステップが記録される", () => {
    const id = heap.allocate("obj", heap.objectProtoId);
    heap.resetTrace();
    const { chain } = heap.getProperty(id, "toString");
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain[chain.length - 1]!.found).toBe(true);
  });
});

describe("new 演算子", () => {
  it("コンストラクタからインスタンスを作成する", () => {
    const heap = new JsHeap();
    const ctorId = heap.defineConstructor("Person", "this.name = name;", {
      greet: str("function greet() {}"),
    });
    heap.resetTrace();
    const instId = heap.simulateNew(ctorId, "alice", { name: str("Alice") });
    const inst = heap.getObject(instId);
    expect(inst).toBeDefined();
    expect(inst!.properties.get("name")?.value).toEqual(str("Alice"));
  });

  it("[[Prototype]] が Constructor.prototype に設定される", () => {
    const heap = new JsHeap();
    const ctorId = heap.defineConstructor("Foo", "", {});
    const ctor = heap.getObject(ctorId)!;
    const instId = heap.simulateNew(ctorId, "foo", {});
    expect(heap.getObject(instId)!.proto).toBe(ctor.prototypeId);
  });

  it("prototype のメソッドが継承される", () => {
    const heap = new JsHeap();
    const ctorId = heap.defineConstructor("Dog", "this.name = name;", {
      bark: str("function bark() { return 'Woof!'; }"),
    });
    const instId = heap.simulateNew(ctorId, "rex", { name: str("Rex") });
    heap.resetTrace();
    const { value } = heap.getProperty(instId, "bark");
    expect(value).toEqual(str("function bark() { return 'Woof!'; }"));
  });
});

describe("hasOwnProperty", () => {
  it("own property → true", () => {
    const heap = new JsHeap();
    const id = heap.allocate("obj", heap.objectProtoId);
    heap.setProp(id, "x", num(1));
    expect(heap.hasOwnProperty(id, "x")).toBe(true);
  });

  it("継承プロパティ → false", () => {
    const heap = new JsHeap();
    const id = heap.allocate("obj", heap.objectProtoId);
    expect(heap.hasOwnProperty(id, "toString")).toBe(false);
  });
});

describe("プロパティシャドーイング", () => {
  it("own property がプロトタイプを隠す", () => {
    const heap = new JsHeap();
    const id = heap.allocate("obj", heap.objectProtoId);
    heap.shadowProperty(id, "toString", str("custom"));
    heap.resetTrace();
    const { value, chain } = heap.getProperty(id, "toString");
    expect(value).toEqual(str("custom"));
    expect(chain[0]!.found).toBe(true); // 自身で発見
    expect(chain[0]!.objId).toBe(id);
  });
});

describe("Object.create(null)", () => {
  it("[[Prototype]] = null → toString も undefined", () => {
    const heap = new JsHeap();
    const id = heap.objectCreate(null, "dict");
    heap.setProp(id, "key", str("value"));
    heap.resetTrace();
    const { value } = heap.getProperty(id, "toString");
    expect(value).toBeUndefined();
  });
});

describe("instanceof", () => {
  it("直接のインスタンスで true", () => {
    const heap = new JsHeap();
    const ctorId = heap.defineConstructor("Foo", "", {});
    const instId = heap.simulateNew(ctorId, "foo", {});
    expect(heap.simulateInstanceof(instId, ctorId)).toBe(true);
  });

  it("多段継承でも true", () => {
    const heap = new JsHeap();
    const aId = heap.defineConstructor("A", "", {});
    const aProtoId = heap.getObject(aId)!.prototypeId!;
    const bProtoId = heap.objectCreate(aProtoId, "B.prototype");
    const bId = heap.allocate("B", heap.functionProtoId);
    heap.getObject(bId)!.prototypeId = bProtoId;
    heap.getObject(bId)!.constructorBody = "";
    const instId = heap.simulateNew(bId, "b", {});
    expect(heap.simulateInstanceof(instId, bId)).toBe(true);
    expect(heap.simulateInstanceof(instId, aId)).toBe(true);
  });
});

describe("EXAMPLES", () => {
  it("7 つのサンプル", () => { expect(EXAMPLES).toHaveLength(7); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 実行可能`, () => {
      const heap = new JsHeap();
      heap.resetTrace();
      ex.run(heap);
      expect(heap.traceLog.length).toBeGreaterThan(0);
      expect(heap.allObjects.length).toBeGreaterThan(2);
    });
  }
});
