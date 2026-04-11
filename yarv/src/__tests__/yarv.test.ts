import { describe, it, expect } from "vitest";
import { runSimulation } from "../yarv/engine.js";
import { presets } from "../yarv/presets.js";
import type { SimOp, ISeq } from "../yarv/types.js";

/** ヘルパー: 簡単な ISeq を作成 */
function mkISeq(label: string, insns: ISeq["insns"], locals: ISeq["localTable"] = []): ISeq {
  return {
    label, type: "top", path: "(eval)",
    localTable: locals, catchTable: [],
    argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
    stackMax: 8, insns,
  };
}

describe("putobject / putnil / putself", () => {
  it("Fixnum をスタックにプッシュ", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [42], lineno: 1, pos: 0 },
          { op: "leave", operands: [], lineno: 1, pos: 1 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.totalInsns).toBeGreaterThanOrEqual(2);
    expect(result.events.some((e) => e.description.includes("42"))).toBe(true);
  });

  it("putnil は nil をプッシュ", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putnil", operands: [], lineno: 1, pos: 0 },
          { op: "leave", operands: [], lineno: 1, pos: 1 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("putnil"))).toBe(true);
  });
});

describe("opt_plus (スペシャル命令)", () => {
  it("Fixnum 同士の加算が最適化される", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [3], lineno: 1, pos: 0 },
          { op: "putobject", operands: [4], lineno: 1, pos: 1 },
          { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 2 },
          { op: "leave", operands: [], lineno: 1, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.optInsns).toBeGreaterThanOrEqual(1);
    expect(result.events.some((e) => e.description.includes("7"))).toBe(true);
  });

  it("String 連結も opt_plus で処理される", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putstring", operands: ["hello "], lineno: 1, pos: 0 },
          { op: "putstring", operands: ["world"], lineno: 1, pos: 1 },
          { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 2 },
          { op: "leave", operands: [], lineno: 1, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("hello world"))).toBe(true);
  });
});

describe("opt_lt / opt_eq", () => {
  it("比較演算が最適化される", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [3], lineno: 1, pos: 0 },
          { op: "putobject", operands: [5], lineno: 1, pos: 1 },
          { op: "opt_lt", operands: [{ mid: "<", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 2 },
          { op: "leave", operands: [], lineno: 1, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("true"))).toBe(true);
  });
});

describe("ローカル変数", () => {
  it("setlocal / getlocal で値を保存・取得", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [99], lineno: 1, pos: 0 },
          { op: "setlocal_wc_0", operands: [0], lineno: 1, pos: 1 },
          { op: "getlocal_wc_0", operands: [0], lineno: 2, pos: 2 },
          { op: "leave", operands: [], lineno: 2, pos: 3 },
        ], [{ name: "x", index: 0, kind: "local" }]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("x") && e.description.includes("99"))).toBe(true);
  });
});

describe("分岐命令", () => {
  it("branchunless は falsy でジャンプ", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [false], lineno: 1, pos: 0 },
          { op: "branchunless", operands: [3], lineno: 1, pos: 1 },
          { op: "putobject", operands: [1], lineno: 2, pos: 2 },  // スキップされる
          { op: "putobject", operands: [2], lineno: 3, pos: 3 },  // ジャンプ先
          { op: "leave", operands: [], lineno: 3, pos: 4 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("falsy") && e.description.includes("jump"))).toBe(true);
  });

  it("branchif は truthy でジャンプ", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [true], lineno: 1, pos: 0 },
          { op: "branchif", operands: [3], lineno: 1, pos: 1 },
          { op: "putobject", operands: [1], lineno: 2, pos: 2 },
          { op: "putobject", operands: [2], lineno: 3, pos: 3 },
          { op: "leave", operands: [], lineno: 3, pos: 4 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("truthy") && e.description.includes("jump"))).toBe(true);
  });
});

describe("send (メソッド呼び出し)", () => {
  it("puts を呼び出しできる", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putself", operands: [], lineno: 1, pos: 0 },
          { op: "putobject", operands: [42], lineno: 1, pos: 1 },
          { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 1, pos: 2 },
          { op: "leave", operands: [], lineno: 1, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.vm.output).toContain("42");
  });
});

describe("インラインキャッシュ", () => {
  it("ユーザ定義メソッドの2回目呼び出しでキャッシュヒット", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("greet", [
          { op: "putobject", operands: [1], lineno: 1, pos: 0 },
          { op: "leave", operands: [], lineno: 1, pos: 1 },
        ]),
      },
      {
        type: "define_method", klass: "Object",
        entry: { owner: "Object", name: "greet", type: "iseq", iseqLabel: "greet", visibility: "public" },
      },
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          // 1回目: キャッシュミス
          { op: "putself", operands: [], lineno: 1, pos: 0 },
          { op: "send", operands: [{ mid: "greet", argc: 0, flags: ["FCALL"] }], lineno: 1, pos: 1 },
          { op: "pop", operands: [], lineno: 1, pos: 2 },
          // 2回目: キャッシュヒット
          { op: "putself", operands: [], lineno: 2, pos: 3 },
          { op: "send", operands: [{ mid: "greet", argc: 0, flags: ["FCALL"] }], lineno: 2, pos: 4 },
          { op: "leave", operands: [], lineno: 2, pos: 5 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.cacheHits).toBeGreaterThanOrEqual(1);
    expect(result.stats.cacheMisses).toBeGreaterThanOrEqual(1);
  });
});

describe("フレーム管理", () => {
  it("メソッド呼び出しでフレームがプッシュされる", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("greet", [
          { op: "putobject", operands: [42], lineno: 2, pos: 0 },
          { op: "leave", operands: [], lineno: 3, pos: 1 },
        ], []),
      },
      {
        type: "define_method", klass: "Object",
        entry: { owner: "Object", name: "greet", type: "iseq", iseqLabel: "greet", visibility: "public" },
      },
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putself", operands: [], lineno: 1, pos: 0 },
          { op: "send", operands: [{ mid: "greet", argc: 0, flags: ["FCALL"] }], lineno: 1, pos: 1 },
          { op: "leave", operands: [], lineno: 1, pos: 2 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.framePushes).toBeGreaterThanOrEqual(2); // TOP + METHOD
    expect(result.events.some((e) => e.type === "frame_push" && e.description.includes("METHOD"))).toBe(true);
  });
});

describe("インスタンス変数", () => {
  it("setinstancevariable / getinstancevariable で値を保存・取得", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [42], lineno: 1, pos: 0 },
          { op: "setinstancevariable", operands: ["@val"], lineno: 1, pos: 1 },
          { op: "getinstancevariable", operands: ["@val"], lineno: 2, pos: 2 },
          { op: "leave", operands: [], lineno: 2, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "ivar_access" && e.description.includes("@val"))).toBe(true);
  });
});

describe("GC", () => {
  it("GCでオブジェクトが回収される", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putstring", operands: ["temp"], lineno: 1, pos: 0 },
          { op: "pop", operands: [], lineno: 1, pos: 1 },
          { op: "putnil", operands: [], lineno: 2, pos: 2 },
          { op: "leave", operands: [], lineno: 2, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
      { type: "gc_trigger", reason: "test" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.gcRuns).toBe(1);
    expect(result.events.some((e) => e.type === "gc_sweep")).toBe(true);
  });
});

describe("catch table / throw", () => {
  it("throw がcatch tableでキャッチされる", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [],
          catchTable: [{ type: "break", start: 0, end: 3, cont: 4, sp: 0 }],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            { op: "putobject", operands: [1], lineno: 1, pos: 0 },
            { op: "putobject", operands: [99], lineno: 2, pos: 1 },
            { op: "throw", operands: [1], lineno: 2, pos: 2 },  // break
            { op: "putobject", operands: [2], lineno: 3, pos: 3 },  // スキップ
            { op: "leave", operands: [], lineno: 4, pos: 4 },      // catch 後の cont
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "catch")).toBe(true);
  });
});

describe("クラス定義", () => {
  it("define_classでクラスが作成される", () => {
    const ops: SimOp[] = [
      { type: "define_class", name: "Animal", superclass: "Object" },
      { type: "define_class", name: "Dog", superclass: "Animal" },
    ];
    const result = runSimulation(ops);
    const dogInfo = result.vm.classes.get("Dog");
    expect(dogInfo).toBeDefined();
    expect(dogInfo!.superclass).toBe("Animal");
    expect(dogInfo!.ancestors).toContain("Animal");
    expect(dogInfo!.ancestors).toContain("Object");
  });
});

describe("newarray / newhash", () => {
  it("newarrayでスタックから配列を生成", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [1], lineno: 1, pos: 0 },
          { op: "putobject", operands: [2], lineno: 1, pos: 1 },
          { op: "putobject", operands: [3], lineno: 1, pos: 2 },
          { op: "newarray", operands: [3], lineno: 1, pos: 3 },
          { op: "leave", operands: [], lineno: 1, pos: 4 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("newarray 3"))).toBe(true);
  });
});

describe("concatstrings (文字列補間)", () => {
  it("文字列が連結される", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putstring", operands: ["Hello, "], lineno: 1, pos: 0 },
          { op: "putstring", operands: ["world!"], lineno: 1, pos: 1 },
          { op: "concatstrings", operands: [2], lineno: 1, pos: 2 },
          { op: "leave", operands: [], lineno: 1, pos: 3 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("Hello, world!"))).toBe(true);
  });
});

describe("opt_not / opt_nil_p", () => {
  it("opt_not で論理否定", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putobject", operands: [true], lineno: 1, pos: 0 },
          { op: "opt_not", operands: [{ mid: "!", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 1 },
          { op: "leave", operands: [], lineno: 1, pos: 2 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("false"))).toBe(true);
  });

  it("opt_nil_p で nil 判定", () => {
    const ops: SimOp[] = [
      {
        type: "define_iseq",
        iseq: mkISeq("<main>", [
          { op: "putnil", operands: [], lineno: 1, pos: 0 },
          { op: "opt_nil_p", operands: [{ mid: "nil?", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 1 },
          { op: "leave", operands: [], lineno: 1, pos: 2 },
        ]),
      },
      { type: "execute", iseqLabel: "<main>" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("true"))).toBe(true);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });
});
