/**
 * @module presets
 * LLVM シミュレーターの実験プリセット定義モジュール。
 * ブラウザのセレクトボックスから選択可能な定義済み実験を提供する。
 * 各プリセットは IR モジュール定義と最適化/実行操作の組み合わせで構成される。
 */

import type { Preset } from "./types.js";

/** i32 型定数 — プリセット定義で頻繁に使用 */
const i32 = { kind: "i32" as const };
/** i1 型定数 — 条件分岐で使用する1ビット整数型 */
const i1 = { kind: "i1" as const };

/**
 * i32 型のレジスタオペランドを生成するヘルパー。
 * @param name - レジスタ名 (% プレフィックスなし)
 */
function reg(name: string) { return { kind: "reg" as const, name, type: i32 }; }
/**
 * i1 型のレジスタオペランドを生成するヘルパー。
 * @param name - レジスタ名 (% プレフィックスなし)
 */
function regI1(name: string) { return { kind: "reg" as const, name, type: i1 }; }
/**
 * i32 型の即値定数オペランドを生成するヘルパー。
 * @param value - 即値
 */
function imm(value: number) { return { kind: "const" as const, value, type: i32 }; }
/**
 * ラベルオペランドを生成するヘルパー (分岐先指定用)。
 * @param name - ラベル名
 */
function label(name: string) { return { kind: "label" as const, name }; }

/** 全てのプリセット定義の配列。UI のセレクトボックスに表示される。 */
export const presets: Preset[] = [
  {
    name: "基本: 定数畳み込みと死コード除去",
    description: "constant_fold + DCE — コンパイル時定数の計算と未使用命令の除去",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "calc",
            retType: i32,
            params: [{ name: "x", type: i32 }],
            blocks: [{
              label: "entry",
              insns: [
                // 定数畳み込み可能
                { id: "i1", op: "add", result: "a", resultType: i32, operands: [imm(3), imm(4)] },
                { id: "i2", op: "mul", result: "b", resultType: i32, operands: [imm(5), imm(6)] },
                // x を使用
                { id: "i3", op: "add", result: "c", resultType: i32, operands: [reg("x"), reg("a")] },
                // 死コード (未使用)
                { id: "i4", op: "mul", result: "dead", resultType: i32, operands: [reg("a"), reg("b")] },
                { id: "i5", op: "ret", operands: [reg("c")] },
              ],
              preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
            }],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "calc", pass: "constant_fold" },
      { type: "run_pass", functionName: "calc", pass: "dce" },
      { type: "execute_ir", functionName: "calc", args: [10] },
    ],
  },
  {
    name: "命令結合 (InstCombine)",
    description: "代数的簡約と強度削減 — x+0→x, x*1→x, mul→shl",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "simplify",
            retType: i32,
            params: [{ name: "x", type: i32 }],
            blocks: [{
              label: "entry",
              insns: [
                { id: "i1", op: "add", result: "a", resultType: i32, operands: [reg("x"), imm(0)], comment: "x + 0 → x" },
                { id: "i2", op: "mul", result: "b", resultType: i32, operands: [reg("a"), imm(1)], comment: "x * 1 → x" },
                { id: "i3", op: "mul", result: "c", resultType: i32, operands: [reg("b"), imm(8)], comment: "x * 8 → shl x, 3" },
                { id: "i4", op: "mul", result: "d", resultType: i32, operands: [reg("c"), imm(16)], comment: "x * 16 → shl x, 4" },
                { id: "i5", op: "ret", operands: [reg("d")] },
              ],
              preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
            }],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "simplify", pass: "instcombine" },
      { type: "execute_ir", functionName: "simplify", args: [5] },
    ],
  },
  {
    name: "mem2reg (SSA 変換)",
    description: "alloca/store/load → SSA レジスタへの昇格と phi ノード挿入",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "ssa_demo",
            retType: i32,
            params: [{ name: "n", type: i32 }],
            blocks: [
              {
                label: "entry",
                insns: [
                  { id: "a1", op: "alloca", result: "x_ptr", allocaType: i32, operands: [] },
                  { id: "s1", op: "store", operands: [imm(0), reg("x_ptr")] },
                  { id: "cmp1", op: "icmp", result: "cond", resultType: i1, pred: "sgt", operands: [reg("n"), imm(0)] },
                  { id: "br1", op: "br_cond", operands: [regI1("cond"), label("then"), label("else")] },
                ],
                preds: [], succs: ["then", "else"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "then",
                insns: [
                  { id: "s2", op: "store", operands: [reg("n"), reg("x_ptr")] },
                  { id: "br2", op: "br", operands: [label("merge")] },
                ],
                preds: ["entry"], succs: ["merge"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "else",
                insns: [
                  { id: "neg", op: "sub", result: "neg_n", resultType: i32, operands: [imm(0), reg("n")] },
                  { id: "s3", op: "store", operands: [reg("neg_n"), reg("x_ptr")] },
                  { id: "br3", op: "br", operands: [label("merge")] },
                ],
                preds: ["entry"], succs: ["merge"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "merge",
                insns: [
                  { id: "l1", op: "load", result: "result", resultType: i32, operands: [reg("x_ptr")] },
                  { id: "ret1", op: "ret", operands: [reg("result")] },
                ],
                preds: ["then", "else"], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
            ],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "build_dom_tree", functionName: "ssa_demo" },
      { type: "run_pass", functionName: "ssa_demo", pass: "mem2reg" },
      { type: "snapshot" },
    ],
  },
  {
    name: "制御フローグラフと支配木",
    description: "CFG 構築、支配関係、支配境界の計算",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "cfg_demo",
            retType: i32,
            params: [{ name: "x", type: i32 }],
            blocks: [
              {
                label: "entry",
                insns: [
                  { id: "c1", op: "icmp", result: "cond1", resultType: i1, pred: "sgt", operands: [reg("x"), imm(10)] },
                  { id: "b1", op: "br_cond", operands: [regI1("cond1"), label("left"), label("right")] },
                ],
                preds: [], succs: ["left", "right"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "left",
                insns: [
                  { id: "a1", op: "add", result: "l_val", resultType: i32, operands: [reg("x"), imm(1)] },
                  { id: "b2", op: "br", operands: [label("join")] },
                ],
                preds: ["entry"], succs: ["join"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "right",
                insns: [
                  { id: "s1", op: "sub", result: "r_val", resultType: i32, operands: [reg("x"), imm(1)] },
                  { id: "b3", op: "br", operands: [label("join")] },
                ],
                preds: ["entry"], succs: ["join"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "join",
                insns: [
                  { id: "phi1", op: "phi", result: "result", resultType: i32, operands: [], phiIncoming: [
                    { value: reg("l_val"), block: "left" },
                    { value: reg("r_val"), block: "right" },
                  ]},
                  { id: "r1", op: "ret", operands: [reg("result")] },
                ],
                preds: ["left", "right"], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
            ],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "build_dom_tree", functionName: "cfg_demo" },
      { type: "execute_ir", functionName: "cfg_demo", args: [15] },
      { type: "execute_ir", functionName: "cfg_demo", args: [5] },
    ],
  },
  {
    name: "レジスタ割り当て (線形スキャン)",
    description: "生存区間分析、干渉グラフ、物理レジスタ割り当て、スピル",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "regalloc_demo",
            retType: i32,
            params: [{ name: "a", type: i32 }, { name: "b", type: i32 }],
            blocks: [{
              label: "entry",
              insns: [
                { id: "i1", op: "add", result: "sum", resultType: i32, operands: [reg("a"), reg("b")] },
                { id: "i2", op: "sub", result: "diff", resultType: i32, operands: [reg("a"), reg("b")] },
                { id: "i3", op: "mul", result: "prod", resultType: i32, operands: [reg("sum"), reg("diff")] },
                { id: "i4", op: "add", result: "extra", resultType: i32, operands: [reg("prod"), reg("sum")] },
                { id: "i5", op: "sub", result: "final", resultType: i32, operands: [reg("extra"), reg("diff")] },
                { id: "i6", op: "ret", operands: [reg("final")] },
              ],
              preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
            }],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "reg_alloc", functionName: "regalloc_demo", physRegs: ["eax", "ebx", "ecx"] },
      { type: "codegen", functionName: "regalloc_demo" },
      { type: "execute_ir", functionName: "regalloc_demo", args: [10, 3] },
    ],
  },
  {
    name: "コード生成パイプライン",
    description: "IR → 最適化 → レジスタ割り当て → x86-64 アセンブリ 全工程",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "square_sum",
            retType: i32,
            params: [{ name: "x", type: i32 }, { name: "y", type: i32 }],
            blocks: [{
              label: "entry",
              insns: [
                { id: "i1", op: "mul", result: "x2", resultType: i32, operands: [reg("x"), reg("x")] },
                { id: "i2", op: "mul", result: "y2", resultType: i32, operands: [reg("y"), reg("y")] },
                { id: "i3", op: "add", result: "sum", resultType: i32, operands: [reg("x2"), reg("y2")] },
                // 定数畳み込み対象
                { id: "i4", op: "add", result: "unused_const", resultType: i32, operands: [imm(10), imm(20)] },
                // 死コード
                { id: "i5", op: "mul", result: "dead", resultType: i32, operands: [imm(3), imm(7)] },
                { id: "i6", op: "ret", operands: [reg("sum")] },
              ],
              preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
            }],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "square_sum", pass: "constant_fold" },
      { type: "run_pass", functionName: "square_sum", pass: "dce" },
      { type: "reg_alloc", functionName: "square_sum", physRegs: ["eax", "ebx", "ecx", "edx"] },
      { type: "codegen", functionName: "square_sum" },
      { type: "execute_ir", functionName: "square_sum", args: [3, 4] },
      { type: "snapshot" },
    ],
  },
  {
    name: "ループと分岐",
    description: "while ループの IR 表現 — 基本ブロック構成と phi ノード",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "sum_to_n",
            retType: i32,
            params: [{ name: "n", type: i32 }],
            blocks: [
              {
                label: "entry",
                insns: [
                  { id: "br0", op: "br", operands: [label("loop")] },
                ],
                preds: [], succs: ["loop"], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
              {
                label: "loop",
                insns: [
                  { id: "phi_i", op: "phi", result: "i", resultType: i32, operands: [], phiIncoming: [
                    { value: imm(0), block: "entry" },
                    { value: reg("i_next"), block: "body" },
                  ]},
                  { id: "phi_sum", op: "phi", result: "sum", resultType: i32, operands: [], phiIncoming: [
                    { value: imm(0), block: "entry" },
                    { value: reg("sum_next"), block: "body" },
                  ]},
                  { id: "cmp", op: "icmp", result: "cond", resultType: i1, pred: "slt", operands: [reg("i"), reg("n")] },
                  { id: "br1", op: "br_cond", operands: [regI1("cond"), label("body"), label("exit")] },
                ],
                preds: ["entry", "body"], succs: ["body", "exit"], domFrontier: [], loopDepth: 1, isLoopHeader: true,
              },
              {
                label: "body",
                insns: [
                  { id: "add_sum", op: "add", result: "sum_next", resultType: i32, operands: [reg("sum"), reg("i")] },
                  { id: "inc", op: "add", result: "i_next", resultType: i32, operands: [reg("i"), imm(1)] },
                  { id: "br2", op: "br", operands: [label("loop")] },
                ],
                preds: ["loop"], succs: ["loop"], domFrontier: [], loopDepth: 1, isLoopHeader: false,
              },
              {
                label: "exit",
                insns: [
                  { id: "ret", op: "ret", operands: [reg("sum")] },
                ],
                preds: ["loop"], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              },
            ],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "build_dom_tree", functionName: "sum_to_n" },
      { type: "execute_ir", functionName: "sum_to_n", args: [10] },
      { type: "reg_alloc", functionName: "sum_to_n", physRegs: ["eax", "ebx", "ecx", "edx"] },
      { type: "codegen", functionName: "sum_to_n" },
    ],
  },
  {
    name: "スピルとレジスタ圧力",
    description: "物理レジスタ不足時のスピル — スタックへの退避と復帰",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "pressure",
            retType: i32,
            params: [{ name: "a", type: i32 }, { name: "b", type: i32 }],
            blocks: [{
              label: "entry",
              insns: [
                { id: "i1", op: "add", result: "v1", resultType: i32, operands: [reg("a"), imm(1)] },
                { id: "i2", op: "add", result: "v2", resultType: i32, operands: [reg("b"), imm(2)] },
                { id: "i3", op: "mul", result: "v3", resultType: i32, operands: [reg("v1"), reg("v2")] },
                { id: "i4", op: "add", result: "v4", resultType: i32, operands: [reg("v3"), reg("a")] },
                { id: "i5", op: "sub", result: "v5", resultType: i32, operands: [reg("v4"), reg("v1")] },
                { id: "i6", op: "mul", result: "v6", resultType: i32, operands: [reg("v5"), reg("v2")] },
                { id: "i7", op: "add", result: "v7", resultType: i32, operands: [reg("v6"), reg("v3")] },
                { id: "i8", op: "ret", operands: [reg("v7")] },
              ],
              preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
            }],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      // レジスタ2つのみ → 大量スピル
      { type: "reg_alloc", functionName: "pressure", physRegs: ["eax", "ebx"] },
      { type: "codegen", functionName: "pressure" },
      { type: "execute_ir", functionName: "pressure", args: [3, 5] },
    ],
  },
  {
    name: "関数呼び出しと ABI",
    description: "call 命令、引数渡し (System V AMD64)、戻り値",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [
            {
              name: "add",
              retType: i32,
              params: [{ name: "a", type: i32 }, { name: "b", type: i32 }],
              blocks: [{
                label: "entry",
                insns: [
                  { id: "a1", op: "add", result: "sum", resultType: i32, operands: [reg("a"), reg("b")] },
                  { id: "r1", op: "ret", operands: [reg("sum")] },
                ],
                preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              }],
              values: new Map(),
            },
            {
              name: "main",
              retType: i32,
              params: [],
              blocks: [{
                label: "entry",
                insns: [
                  { id: "c1", op: "call", result: "r1", resultType: i32, callee: "add", operands: [imm(3), imm(4)] },
                  { id: "c2", op: "call", result: "r2", resultType: i32, callee: "add", operands: [reg("r1"), imm(10)] },
                  { id: "ret", op: "ret", operands: [reg("r2")] },
                ],
                preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
              }],
              values: new Map(),
            },
          ],
          globals: [], structs: [],
        },
      },
      { type: "reg_alloc", functionName: "main", physRegs: ["eax", "ebx", "ecx", "edx"] },
      { type: "codegen", functionName: "main" },
    ],
  },
  {
    name: "複合最適化パイプライン",
    description: "mem2reg → constant_fold → instcombine → DCE の連鎖適用",
    ops: [
      {
        type: "define_module",
        module: {
          functions: [{
            name: "pipeline",
            retType: i32,
            params: [{ name: "n", type: i32 }],
            blocks: [{
              label: "entry",
              insns: [
                // alloca → mem2reg 対象
                { id: "a1", op: "alloca", result: "tmp_ptr", allocaType: i32, operands: [] },
                { id: "s1", op: "store", operands: [reg("n"), reg("tmp_ptr")] },
                { id: "l1", op: "load", result: "loaded", resultType: i32, operands: [reg("tmp_ptr")] },
                // 定数式
                { id: "c1", op: "add", result: "const_a", resultType: i32, operands: [imm(10), imm(20)] },
                { id: "c2", op: "mul", result: "const_b", resultType: i32, operands: [imm(3), imm(7)] },
                // 恒等変換
                { id: "id1", op: "add", result: "same", resultType: i32, operands: [reg("loaded"), imm(0)] },
                { id: "id2", op: "mul", result: "same2", resultType: i32, operands: [reg("same"), imm(1)] },
                // 強度削減
                { id: "sr1", op: "mul", result: "shifted", resultType: i32, operands: [reg("same2"), imm(4)] },
                // 死コード
                { id: "d1", op: "add", result: "unused1", resultType: i32, operands: [imm(100), imm(200)] },
                { id: "d2", op: "mul", result: "unused2", resultType: i32, operands: [reg("const_a"), reg("const_b")] },
                { id: "ret", op: "ret", operands: [reg("shifted")] },
              ],
              preds: [], succs: [], domFrontier: [], loopDepth: 0, isLoopHeader: false,
            }],
            values: new Map(),
          }],
          globals: [], structs: [],
        },
      },
      { type: "run_pass", functionName: "pipeline", pass: "mem2reg" },
      { type: "run_pass", functionName: "pipeline", pass: "constant_fold" },
      { type: "run_pass", functionName: "pipeline", pass: "instcombine" },
      { type: "run_pass", functionName: "pipeline", pass: "dce" },
      { type: "execute_ir", functionName: "pipeline", args: [7] },
      { type: "snapshot" },
    ],
  },
];
