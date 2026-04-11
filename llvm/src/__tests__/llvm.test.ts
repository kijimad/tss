import { describe, it, expect } from "vitest";
import { runSimulation } from "../llvm/engine.js";
import { presets } from "../llvm/presets.js";
import type { SimOp, IRFunction, BasicBlock, IRInsn } from "../llvm/types.js";

const i32 = { kind: "i32" as const };
const i1 = { kind: "i1" as const };
function reg(name: string) { return { kind: "reg" as const, name, type: i32 }; }
function regI1(name: string) { return { kind: "reg" as const, name, type: i1 }; }
function imm(value: number) { return { kind: "const" as const, value, type: i32 }; }
function label(name: string) { return { kind: "label" as const, name }; }

function mkBlock(lbl: string, insns: IRInsn[]): BasicBlock {
  return { label: lbl, insns, preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false };
}

function mkFn(name: string, params: { name: string }[], blocks: BasicBlock[]): IRFunction {
  return { name, retType: i32, params: params.map((p) => ({ name: p.name, type: i32 })), blocks, values: new Map() };
}

describe("定数畳み込み", () => {
  it("定数同士の加算を畳み込む", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [], [mkBlock("entry", [
            { id: "i1", op: "add", result: "a", resultType: i32, operands: [imm(3), imm(4)] },
            { id: "i2", op: "ret", operands: [reg("a")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "test", pass: "constant_fold" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.optimizedInsns).toBeGreaterThanOrEqual(1);
    expect(result.events.some((e) => e.type === "fold")).toBe(true);
  });

  it("乗算も畳み込む", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [], [mkBlock("entry", [
            { id: "i1", op: "mul", result: "a", resultType: i32, operands: [imm(5), imm(6)] },
            { id: "i2", op: "ret", operands: [reg("a")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "test", pass: "constant_fold" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("30"))).toBe(true);
  });
});

describe("死コード除去 (DCE)", () => {
  it("未使用の命令を除去", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "x" }], [mkBlock("entry", [
            { id: "i1", op: "add", result: "used", resultType: i32, operands: [reg("x"), imm(1)] },
            { id: "i2", op: "mul", result: "dead", resultType: i32, operands: [imm(3), imm(4)] },
            { id: "i3", op: "ret", operands: [reg("used")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "test", pass: "dce" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.eliminatedInsns).toBeGreaterThanOrEqual(1);
  });
});

describe("InstCombine", () => {
  it("x + 0 を検出する", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "x" }], [mkBlock("entry", [
            { id: "i1", op: "add", result: "a", resultType: i32, operands: [reg("x"), imm(0)] },
            { id: "i2", op: "ret", operands: [reg("a")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "test", pass: "instcombine" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.optimizedInsns).toBeGreaterThanOrEqual(1);
  });

  it("mul x, 8 → shl x, 3 (強度削減)", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "x" }], [mkBlock("entry", [
            { id: "i1", op: "mul", result: "a", resultType: i32, operands: [reg("x"), imm(8)] },
            { id: "i2", op: "ret", operands: [reg("a")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "test", pass: "instcombine" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.description.includes("shl"))).toBe(true);
  });
});

describe("mem2reg", () => {
  it("alloca/store/load を除去する", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "n" }], [mkBlock("entry", [
            { id: "a1", op: "alloca", result: "ptr", allocaType: i32, operands: [] },
            { id: "s1", op: "store", operands: [reg("n"), reg("ptr")] },
            { id: "l1", op: "load", result: "val", resultType: i32, operands: [reg("ptr")] },
            { id: "r1", op: "ret", operands: [reg("val")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "test", pass: "mem2reg" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.eliminatedInsns).toBeGreaterThanOrEqual(3); // alloca, store, load
    expect(result.events.some((e) => e.type === "ssa")).toBe(true);
  });
});

describe("支配木", () => {
  it("支配木が構築される", () => {
    const entry: BasicBlock = mkBlock("entry", [
      { id: "b1", op: "br_cond", operands: [regI1("c"), label("left"), label("right")] },
    ]);
    entry.succs = ["left", "right"];
    const left: BasicBlock = mkBlock("left", [
      { id: "b2", op: "br", operands: [label("join")] },
    ]);
    left.preds = ["entry"]; left.succs = ["join"];
    const right: BasicBlock = mkBlock("right", [
      { id: "b3", op: "br", operands: [label("join")] },
    ]);
    right.preds = ["entry"]; right.succs = ["join"];
    const join: BasicBlock = mkBlock("join", [
      { id: "r1", op: "ret", operands: [imm(0)] },
    ]);
    join.preds = ["left", "right"];

    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "c" }], [entry, left, right, join])],
          globals: [], structs: [],
        },
      },
      { type: "build_dom_tree", functionName: "test" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "dom")).toBe(true);
  });
});

describe("レジスタ割り当て", () => {
  it("物理レジスタが割り当てられる", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "a" }, { name: "b" }], [mkBlock("entry", [
            { id: "i1", op: "add", result: "sum", resultType: i32, operands: [reg("a"), reg("b")] },
            { id: "i2", op: "ret", operands: [reg("sum")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "reg_alloc", functionName: "test", physRegs: ["eax", "ebx", "ecx"] },
    ];
    const result = runSimulation(ops);
    expect(result.regAlloc).toBeDefined();
    expect(result.regAlloc!.coloring.size).toBeGreaterThan(0);
  });

  it("レジスタ不足時にスピルが発生", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "a" }, { name: "b" }], [mkBlock("entry", [
            { id: "i1", op: "add", result: "v1", resultType: i32, operands: [reg("a"), imm(1)] },
            { id: "i2", op: "add", result: "v2", resultType: i32, operands: [reg("b"), imm(2)] },
            { id: "i3", op: "mul", result: "v3", resultType: i32, operands: [reg("v1"), reg("v2")] },
            { id: "i4", op: "add", result: "v4", resultType: i32, operands: [reg("v3"), reg("a")] },
            { id: "i5", op: "ret", operands: [reg("v4")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "reg_alloc", functionName: "test", physRegs: ["eax"] },
    ];
    const result = runSimulation(ops);
    expect(result.stats.spillCount).toBeGreaterThan(0);
  });
});

describe("コード生成", () => {
  it("x86-64 アセンブリが生成される", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "x" }], [mkBlock("entry", [
            { id: "i1", op: "add", result: "r", resultType: i32, operands: [reg("x"), imm(1)] },
            { id: "i2", op: "ret", operands: [reg("r")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "codegen", functionName: "test" },
    ];
    const result = runSimulation(ops);
    expect(result.machineCode.length).toBeGreaterThan(0);
    expect(result.machineCode.some((mi) => mi.op === "ret")).toBe(true);
  });
});

describe("IR 実行", () => {
  it("算術演算の結果を返す", () => {
    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "x" }, { name: "y" }], [mkBlock("entry", [
            { id: "i1", op: "add", result: "sum", resultType: i32, operands: [reg("x"), reg("y")] },
            { id: "i2", op: "ret", operands: [reg("sum")] },
          ])])],
          globals: [], structs: [],
        },
      },
      { type: "execute_ir", functionName: "test", args: [10, 20] },
    ];
    const result = runSimulation(ops);
    expect(result.execResult).toBeDefined();
    expect(result.execResult!.retValue).toBe(30);
  });

  it("分岐が正しく動作する", () => {
    const entry: BasicBlock = mkBlock("entry", [
      { id: "cmp", op: "icmp", result: "cond", resultType: i1, pred: "sgt", operands: [reg("x"), imm(0)] },
      { id: "br", op: "br_cond", operands: [regI1("cond"), label("pos"), label("neg")] },
    ]);
    entry.succs = ["pos", "neg"];
    const pos: BasicBlock = mkBlock("pos", [
      { id: "r1", op: "ret", operands: [imm(1)] },
    ]);
    pos.preds = ["entry"];
    const neg: BasicBlock = mkBlock("neg", [
      { id: "r2", op: "ret", operands: [imm(0)] },
    ]);
    neg.preds = ["entry"];

    const ops: SimOp[] = [
      {
        type: "define_module",
        module: {
          functions: [mkFn("test", [{ name: "x" }], [entry, pos, neg])],
          globals: [], structs: [],
        },
      },
      { type: "execute_ir", functionName: "test", args: [5] },
    ];
    const result = runSimulation(ops);
    expect(result.execResult!.retValue).toBe(1);
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
