import type { Preset } from "./types.js";

export const presets: Preset[] = [
  {
    name: "基本: putobject → opt_plus → leave",
    description: "1 + 2 の実行 — スペシャル命令による最適化",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 2,
          insns: [
            // 1 + 2
            { op: "putobject", operands: [1], lineno: 1, pos: 0 },
            { op: "putobject", operands: [2], lineno: 1, pos: 1 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 2 },
            // puts result
            { op: "putself", operands: [], lineno: 1, pos: 3 },
            { op: "swap", operands: [], lineno: 1, pos: 4 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 1, pos: 5 },
            { op: "leave", operands: [], lineno: 1, pos: 6 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
  {
    name: "ローカル変数と EP チェーン",
    description: "getlocal / setlocal — 環境ポインタによるスコープアクセス",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [
            { name: "x", index: 0, kind: "local" },
            { name: "y", index: 1, kind: "local" },
            { name: "z", index: 2, kind: "local" },
          ],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // x = 10
            { op: "putobject", operands: [10], lineno: 1, pos: 0 },
            { op: "setlocal_wc_0", operands: [0], lineno: 1, pos: 1 },
            // y = 20
            { op: "putobject", operands: [20], lineno: 2, pos: 2 },
            { op: "setlocal_wc_0", operands: [1], lineno: 2, pos: 3 },
            // z = x + y
            { op: "getlocal_wc_0", operands: [0], lineno: 3, pos: 4 },
            { op: "getlocal_wc_0", operands: [1], lineno: 3, pos: 5 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 3, pos: 6 },
            { op: "setlocal_wc_0", operands: [2], lineno: 3, pos: 7 },
            // puts z
            { op: "putself", operands: [], lineno: 4, pos: 8 },
            { op: "getlocal_wc_0", operands: [2], lineno: 4, pos: 9 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 4, pos: 10 },
            { op: "leave", operands: [], lineno: 4, pos: 11 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
  {
    name: "メソッド定義と呼び出し",
    description: "definemethod → send — フレームプッシュ/ポップとメソッドディスパッチ",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "add", type: "method", path: "(eval)",
          localTable: [
            { name: "a", index: 0, kind: "arg" },
            { name: "b", index: 1, kind: "arg" },
          ],
          catchTable: [],
          argInfo: { lead: 2, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 2,
          insns: [
            { op: "getlocal_wc_0", operands: [0], lineno: 2, pos: 0 },
            { op: "getlocal_wc_0", operands: [1], lineno: 2, pos: 1 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 2, pos: 2 },
            { op: "leave", operands: [], lineno: 3, pos: 3 },
          ],
        },
      },
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // def add(a, b) ... end
            { op: "definemethod", operands: ["add", "add"], lineno: 1, pos: 0 },
            // puts add(3, 4)
            { op: "putself", operands: [], lineno: 4, pos: 1 },
            { op: "putself", operands: [], lineno: 4, pos: 2 },
            { op: "putobject", operands: [3], lineno: 4, pos: 3 },
            { op: "putobject", operands: [4], lineno: 4, pos: 4 },
            { op: "send", operands: [{ mid: "add", argc: 2, flags: ["FCALL"] }], lineno: 4, pos: 5 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 4, pos: 6 },
            { op: "leave", operands: [], lineno: 4, pos: 7 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
  {
    name: "インラインキャッシュ",
    description: "メソッドディスパッチのキャッシュヒット/ミスの挙動",
    ops: [
      { type: "define_class", name: "Dog", superclass: "Object" },
      {
        type: "define_method",
        klass: "Dog",
        entry: { owner: "Dog", name: "speak", type: "cfunc", visibility: "public" },
      },
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // 1回目: キャッシュミス
            { op: "putobject", operands: [42], lineno: 1, pos: 0 },
            { op: "send", operands: [{ mid: "to_s", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 1 },
            { op: "pop", operands: [], lineno: 1, pos: 2 },
            // 2回目: キャッシュヒット
            { op: "putobject", operands: [99], lineno: 2, pos: 3 },
            { op: "send", operands: [{ mid: "to_s", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 2, pos: 4 },
            { op: "pop", operands: [], lineno: 2, pos: 5 },
            // 3回目: キャッシュヒット
            { op: "putobject", operands: [7], lineno: 3, pos: 6 },
            { op: "send", operands: [{ mid: "to_s", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 3, pos: 7 },
            { op: "pop", operands: [], lineno: 3, pos: 8 },
            { op: "putnil", operands: [], lineno: 3, pos: 9 },
            { op: "leave", operands: [], lineno: 3, pos: 10 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
      { type: "check_cache", mid: "to_s", receiver: "Integer" },
    ],
  },
  {
    name: "スペシャル命令 vs 汎用 send",
    description: "opt_plus の最適化パスと send フォールバックの比較",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [{ name: "result", index: 0, kind: "local" }],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // Fixnum: opt_plus (高速パス)
            { op: "putobject", operands: [100], lineno: 1, pos: 0 },
            { op: "putobject", operands: [200], lineno: 1, pos: 1 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 1, pos: 2 },
            { op: "pop", operands: [], lineno: 1, pos: 3 },

            // String: opt_plus (文字列連結パス)
            { op: "putstring", operands: ["hello "], lineno: 2, pos: 4 },
            { op: "putstring", operands: ["world"], lineno: 2, pos: 5 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 2, pos: 6 },
            { op: "pop", operands: [], lineno: 2, pos: 7 },

            // 比較: opt_eq, opt_lt, opt_gt
            { op: "putobject", operands: [5], lineno: 3, pos: 8 },
            { op: "putobject", operands: [3], lineno: 3, pos: 9 },
            { op: "opt_gt", operands: [{ mid: ">", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 3, pos: 10 },
            { op: "pop", operands: [], lineno: 3, pos: 11 },

            // opt_length
            { op: "putstring", operands: ["Ruby"], lineno: 4, pos: 12 },
            { op: "opt_length", operands: [{ mid: "length", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 4, pos: 13 },
            { op: "pop", operands: [], lineno: 4, pos: 14 },

            // opt_nil_p
            { op: "putnil", operands: [], lineno: 5, pos: 15 },
            { op: "opt_nil_p", operands: [{ mid: "nil?", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 5, pos: 16 },
            { op: "pop", operands: [], lineno: 5, pos: 17 },

            // opt_not
            { op: "putobject", operands: [true], lineno: 6, pos: 18 },
            { op: "opt_not", operands: [{ mid: "!", argc: 0, flags: ["ARGS_SIMPLE"] }], lineno: 6, pos: 19 },
            { op: "pop", operands: [], lineno: 6, pos: 20 },

            { op: "putnil", operands: [], lineno: 6, pos: 21 },
            { op: "leave", operands: [], lineno: 6, pos: 22 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
  {
    name: "制御フロー (if / while)",
    description: "branchunless / branchif / jump — 条件分岐とループ",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [
            { name: "i", index: 0, kind: "local" },
            { name: "sum", index: 1, kind: "local" },
          ],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // i = 0
            { op: "putobject", operands: [0], lineno: 1, pos: 0 },
            { op: "setlocal_wc_0", operands: [0], lineno: 1, pos: 1 },
            // sum = 0
            { op: "putobject", operands: [0], lineno: 2, pos: 2 },
            { op: "setlocal_wc_0", operands: [1], lineno: 2, pos: 3 },
            // while i < 5  (pos 4)
            { op: "getlocal_wc_0", operands: [0], lineno: 3, pos: 4 },
            { op: "putobject", operands: [5], lineno: 3, pos: 5 },
            { op: "opt_lt", operands: [{ mid: "<", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 3, pos: 6 },
            { op: "branchunless", operands: [16], lineno: 3, pos: 7 },
            //   sum = sum + i
            { op: "getlocal_wc_0", operands: [1], lineno: 4, pos: 8 },
            { op: "getlocal_wc_0", operands: [0], lineno: 4, pos: 9 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 4, pos: 10 },
            { op: "setlocal_wc_0", operands: [1], lineno: 4, pos: 11 },
            //   i = i + 1
            { op: "getlocal_wc_0", operands: [0], lineno: 5, pos: 12 },
            { op: "putobject", operands: [1], lineno: 5, pos: 13 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 5, pos: 14 },
            { op: "setlocal_wc_0", operands: [0], lineno: 5, pos: 15 },
            // jump back to while condition (intentionally targets pos 4)
            // Note: this is insn index 16 but jumps to insn at pos 4
            { op: "jump", operands: [4], lineno: 6, pos: 16 },
            // end while (pos 17 = target of branchunless)
            // puts sum
            { op: "putself", operands: [], lineno: 7, pos: 17 },
            { op: "getlocal_wc_0", operands: [1], lineno: 7, pos: 18 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 7, pos: 19 },
            { op: "leave", operands: [], lineno: 7, pos: 20 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>", maxSteps: 200 },
    ],
  },
  {
    name: "クラス定義とインスタンス変数",
    description: "defineclass, setinstancevariable, getinstancevariable — オブジェクト指向",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "Point#initialize", type: "method", path: "(eval)",
          localTable: [
            { name: "x", index: 0, kind: "arg" },
            { name: "y", index: 1, kind: "arg" },
          ],
          catchTable: [],
          argInfo: { lead: 2, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 2,
          insns: [
            { op: "getlocal_wc_0", operands: [0], lineno: 3, pos: 0 },
            { op: "setinstancevariable", operands: ["@x"], lineno: 3, pos: 1 },
            { op: "getlocal_wc_0", operands: [1], lineno: 4, pos: 2 },
            { op: "setinstancevariable", operands: ["@y"], lineno: 4, pos: 3 },
            { op: "putnil", operands: [], lineno: 5, pos: 4 },
            { op: "leave", operands: [], lineno: 5, pos: 5 },
          ],
        },
      },
      {
        type: "define_iseq",
        iseq: {
          label: "Point#to_s", type: "method", path: "(eval)",
          localTable: [],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            { op: "putstring", operands: ["("], lineno: 7, pos: 0 },
            { op: "getinstancevariable", operands: ["@x"], lineno: 7, pos: 1 },
            { op: "tostring", operands: [], lineno: 7, pos: 2 },
            { op: "concatstrings", operands: [2], lineno: 7, pos: 3 },
            { op: "putstring", operands: [", "], lineno: 7, pos: 4 },
            { op: "concatstrings", operands: [2], lineno: 7, pos: 5 },
            { op: "getinstancevariable", operands: ["@y"], lineno: 7, pos: 6 },
            { op: "tostring", operands: [], lineno: 7, pos: 7 },
            { op: "concatstrings", operands: [2], lineno: 7, pos: 8 },
            { op: "putstring", operands: [")"], lineno: 7, pos: 9 },
            { op: "concatstrings", operands: [2], lineno: 7, pos: 10 },
            { op: "leave", operands: [], lineno: 7, pos: 11 },
          ],
        },
      },
      { type: "define_class", name: "Point", superclass: "Object" },
      {
        type: "define_method", klass: "Point",
        entry: { owner: "Point", name: "initialize", type: "iseq", iseqLabel: "Point#initialize", visibility: "private" },
      },
      {
        type: "define_method", klass: "Point",
        entry: { owner: "Point", name: "to_s", type: "iseq", iseqLabel: "Point#to_s", visibility: "public" },
      },
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [{ name: "pt", index: 0, kind: "local" }],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 6,
          insns: [
            // pt = Point.new(3, 7) — ここでは簡略化
            // initialize 直接呼び出しをシミュレート
            { op: "putstring", operands: ["Point(3, 7)作成:"], lineno: 10, pos: 0 },
            { op: "pop", operands: [], lineno: 10, pos: 1 },
            // initialize に相当する ivar 設定
            { op: "putobject", operands: [3], lineno: 10, pos: 2 },
            { op: "setinstancevariable", operands: ["@x"], lineno: 10, pos: 3 },
            { op: "putobject", operands: [7], lineno: 10, pos: 4 },
            { op: "setinstancevariable", operands: ["@y"], lineno: 10, pos: 5 },
            // to_s
            { op: "getinstancevariable", operands: ["@x"], lineno: 11, pos: 6 },
            { op: "putself", operands: [], lineno: 11, pos: 7 },
            { op: "swap", operands: [], lineno: 11, pos: 8 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 11, pos: 9 },
            { op: "getinstancevariable", operands: ["@y"], lineno: 12, pos: 10 },
            { op: "putself", operands: [], lineno: 12, pos: 11 },
            { op: "swap", operands: [], lineno: 12, pos: 12 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 12, pos: 13 },
            { op: "putnil", operands: [], lineno: 12, pos: 14 },
            { op: "leave", operands: [], lineno: 12, pos: 15 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
  {
    name: "文字列操作と putstring vs putobject",
    description: "putstring は毎回新規オブジェクト、putobject は frozen 再利用",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [
            { name: "a", index: 0, kind: "local" },
            { name: "b", index: 1, kind: "local" },
          ],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // a = "hello" (putstring: 新規 String 割り当て)
            { op: "putstring", operands: ["hello"], lineno: 1, pos: 0 },
            { op: "dup", operands: [], lineno: 1, pos: 1 },
            { op: "setlocal_wc_0", operands: [0], lineno: 1, pos: 2 },
            { op: "pop", operands: [], lineno: 1, pos: 3 },
            // b = "hello" (別のオブジェクト!)
            { op: "putstring", operands: ["hello"], lineno: 2, pos: 4 },
            { op: "setlocal_wc_0", operands: [1], lineno: 2, pos: 5 },
            // a + " world"
            { op: "getlocal_wc_0", operands: [0], lineno: 3, pos: 6 },
            { op: "putstring", operands: [" world"], lineno: 3, pos: 7 },
            { op: "opt_plus", operands: [{ mid: "+", argc: 1, flags: ["ARGS_SIMPLE"] }], lineno: 3, pos: 8 },
            { op: "pop", operands: [], lineno: 3, pos: 9 },
            // 文字列補間: "result: #{a}"
            { op: "putstring", operands: ["result: "], lineno: 4, pos: 10 },
            { op: "getlocal_wc_0", operands: [0], lineno: 4, pos: 11 },
            { op: "tostring", operands: [], lineno: 4, pos: 12 },
            { op: "concatstrings", operands: [2], lineno: 4, pos: 13 },
            { op: "putself", operands: [], lineno: 4, pos: 14 },
            { op: "swap", operands: [], lineno: 4, pos: 15 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 4, pos: 16 },
            { op: "leave", operands: [], lineno: 4, pos: 17 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
  {
    name: "GC (マーク & スイープ)",
    description: "オブジェクト割り当て → GC マーキング → スイープ — ヒープ管理",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [{ name: "arr", index: 0, kind: "local" }],
          catchTable: [],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // 大量のオブジェクトを割り当て
            { op: "putstring", operands: ["aaa"], lineno: 1, pos: 0 },
            { op: "pop", operands: [], lineno: 1, pos: 1 },
            { op: "putstring", operands: ["bbb"], lineno: 2, pos: 2 },
            { op: "pop", operands: [], lineno: 2, pos: 3 },
            { op: "putstring", operands: ["ccc"], lineno: 3, pos: 4 },
            { op: "pop", operands: [], lineno: 3, pos: 5 },
            // 配列に保持 (GC ルート)
            { op: "putstring", operands: ["kept1"], lineno: 4, pos: 6 },
            { op: "putstring", operands: ["kept2"], lineno: 4, pos: 7 },
            { op: "newarray", operands: [2], lineno: 4, pos: 8 },
            { op: "setlocal_wc_0", operands: [0], lineno: 4, pos: 9 },
            // さらに一時オブジェクト
            { op: "putstring", operands: ["tmp1"], lineno: 5, pos: 10 },
            { op: "pop", operands: [], lineno: 5, pos: 11 },
            { op: "putstring", operands: ["tmp2"], lineno: 6, pos: 12 },
            { op: "pop", operands: [], lineno: 6, pos: 13 },
            { op: "putnil", operands: [], lineno: 7, pos: 14 },
            { op: "leave", operands: [], lineno: 7, pos: 15 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
      { type: "gc_trigger", reason: "malloc_limit 到達" },
      { type: "snapshot" },
    ],
  },
  {
    name: "catch table と throw",
    description: "例外処理 — rescue/ensure の catch table による制御フロー",
    ops: [
      {
        type: "define_iseq",
        iseq: {
          label: "<main>", type: "top", path: "(eval)",
          localTable: [{ name: "x", index: 0, kind: "local" }],
          catchTable: [
            // break を pos 0..5 の範囲でキャッチ → pos 6 に続行
            { type: "break", start: 0, end: 5, cont: 6, sp: 0 },
          ],
          argInfo: { lead: 0, opt: 0, rest: false, post: 0, keyword: [], kwrest: false, block: false },
          stackMax: 4,
          insns: [
            // x = 10
            { op: "putobject", operands: [10], lineno: 1, pos: 0 },
            { op: "setlocal_wc_0", operands: [0], lineno: 1, pos: 1 },
            // throw :break (break 相当)
            { op: "putobject", operands: [99], lineno: 2, pos: 2 },
            { op: "throw", operands: [1], lineno: 2, pos: 3 },
            // ここはスキップされる
            { op: "putobject", operands: [0], lineno: 3, pos: 4 },
            { op: "setlocal_wc_0", operands: [0], lineno: 3, pos: 5 },
            // catch table の cont (pos 6)
            { op: "putself", operands: [], lineno: 5, pos: 6 },
            { op: "getlocal_wc_0", operands: [0], lineno: 5, pos: 7 },
            { op: "send", operands: [{ mid: "puts", argc: 1, flags: ["FCALL"] }], lineno: 5, pos: 8 },
            { op: "leave", operands: [], lineno: 5, pos: 9 },
          ],
        },
      },
      { type: "execute", iseqLabel: "<main>" },
    ],
  },
];
