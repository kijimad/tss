/* ===== WebAssembly シミュレーター プリセット ===== */

import {
  type WasmModule,
  type WasmPreset,
  type WasmValue,
  type HostFunc,
  type Instruction,
  Opcode,
} from './types';
import { emptyModule, WasmVM } from './engine';

/* ---------- 命令ビルダー ---------- */

/** 即値付き命令を生成 */
function instr(opcode: Opcode, immediate?: number | bigint): Instruction {
  return { opcode, immediate };
}

/** ブロック命令を生成 */
function blockInstr(opcode: Opcode, blockType: 'void' | 'i32' | 'i64' | 'f32' | 'f64' = 'void'): Instruction {
  return { opcode, blockType };
}

/** メモリ命令を生成 */
function memInstr(opcode: Opcode, offset = 0, align = 2): Instruction {
  return { opcode, offset, align };
}

/** call_indirect 命令を生成 */
function callIndirectInstr(typeIndex: number): Instruction {
  return { opcode: Opcode.CallIndirect, immediate: typeIndex };
}

/** End命令 */
const END: Instruction = { opcode: Opcode.End };

/* ---------- ヘルパー ---------- */

/** 基本的なVM実行ヘルパー */
function runPreset(
  mod: WasmModule,
  exportName: string,
  args: WasmValue[] = [],
  hostFuncs: HostFunc[] = [],
) {
  const vm = new WasmVM();
  vm.loadModule(mod, hostFuncs);
  vm.instantiate();
  return vm.callExport(exportName, args);
}

/* ========== プリセット定義 ========== */

/** 1. 基本的な加算 (i32.add) */
function buildAddition(): WasmModule {
  const mod = emptyModule();
  /* (i32, i32) -> i32 */
  mod.types.push({ params: ['i32', 'i32'], results: ['i32'] });
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      instr(Opcode.LocalGet, 0),   // a
      instr(Opcode.LocalGet, 1),   // b
      instr(Opcode.I32Add),         // a + b
      END,
    ],
  });
  mod.exports.push({ name: 'add', kind: 'func', index: 0 });
  return mod;
}

/** 2. フィボナッチ (再帰) */
function buildFibonacci(): WasmModule {
  const mod = emptyModule();
  /* (i32) -> i32 */
  mod.types.push({ params: ['i32'], results: ['i32'] });
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      // if (n <= 1) return n
      instr(Opcode.LocalGet, 0),
      instr(Opcode.I32Const, 2),
      instr(Opcode.I32LtS),
      blockInstr(Opcode.If, 'i32'),
        instr(Opcode.LocalGet, 0),
      { opcode: Opcode.Else },
        // fib(n-1) + fib(n-2)
        instr(Opcode.LocalGet, 0),
        instr(Opcode.I32Const, 1),
        instr(Opcode.I32Sub),
        instr(Opcode.Call, 0),
        instr(Opcode.LocalGet, 0),
        instr(Opcode.I32Const, 2),
        instr(Opcode.I32Sub),
        instr(Opcode.Call, 0),
        instr(Opcode.I32Add),
      END,
      END,
    ],
  });
  mod.exports.push({ name: 'fib', kind: 'func', index: 0 });
  return mod;
}

/** 3. 階乗 (ループ版) */
function buildFactorial(): WasmModule {
  const mod = emptyModule();
  mod.types.push({ params: ['i32'], results: ['i32'] });
  mod.functions.push(0);
  mod.codes.push({
    locals: ['i32', 'i32'], // result, i
    instructions: [
      // result = 1
      instr(Opcode.I32Const, 1),
      instr(Opcode.LocalSet, 1),
      // i = 1
      instr(Opcode.I32Const, 1),
      instr(Opcode.LocalSet, 2),
      // block { loop {
      blockInstr(Opcode.Block, 'void'),
        blockInstr(Opcode.Loop, 'void'),
          // if (i > n) break
          instr(Opcode.LocalGet, 2),
          instr(Opcode.LocalGet, 0),
          instr(Opcode.I32GtS),
          instr(Opcode.BrIf, 1),
          // result *= i
          instr(Opcode.LocalGet, 1),
          instr(Opcode.LocalGet, 2),
          instr(Opcode.I32Mul),
          instr(Opcode.LocalSet, 1),
          // i++
          instr(Opcode.LocalGet, 2),
          instr(Opcode.I32Const, 1),
          instr(Opcode.I32Add),
          instr(Opcode.LocalSet, 2),
          // continue loop
          instr(Opcode.Br, 0),
        END, // loop end
      END, // block end
      // return result
      instr(Opcode.LocalGet, 1),
      END,
    ],
  });
  mod.exports.push({ name: 'factorial', kind: 'func', index: 0 });
  return mod;
}

/** 4. 線形メモリ操作 */
function buildLinearMemory(): WasmModule {
  const mod = emptyModule();
  mod.types.push({ params: [], results: ['i32'] });
  mod.memories.push({ limits: { min: 1 } });
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      // memory[0] = 42
      instr(Opcode.I32Const, 0),
      instr(Opcode.I32Const, 42),
      memInstr(Opcode.I32Store),
      // memory[4] = 100
      instr(Opcode.I32Const, 4),
      instr(Opcode.I32Const, 100),
      memInstr(Opcode.I32Store),
      // return memory[0] + memory[4]
      instr(Opcode.I32Const, 0),
      memInstr(Opcode.I32Load),
      instr(Opcode.I32Const, 4),
      memInstr(Opcode.I32Load),
      instr(Opcode.I32Add),
      END,
    ],
  });
  mod.exports.push({ name: 'test_memory', kind: 'func', index: 0 });
  mod.exports.push({ name: 'memory', kind: 'memory', index: 0 });
  return mod;
}

/** 5. スタックマシン操作 */
function buildStackMachine(): WasmModule {
  const mod = emptyModule();
  /* () -> i32 */
  mod.types.push({ params: [], results: ['i32'] });
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      // (3 + 5) * (10 - 2) をスタックで計算
      instr(Opcode.I32Const, 3),   // [3]
      instr(Opcode.I32Const, 5),   // [3, 5]
      instr(Opcode.I32Add),         // [8]
      instr(Opcode.I32Const, 10),  // [8, 10]
      instr(Opcode.I32Const, 2),   // [8, 10, 2]
      instr(Opcode.I32Sub),         // [8, 8]
      instr(Opcode.I32Mul),         // [64]
      END,
    ],
  });
  mod.exports.push({ name: 'calc', kind: 'func', index: 0 });
  return mod;
}

/** 6. グローバル変数 */
function buildGlobals(): WasmModule {
  const mod = emptyModule();
  /* () -> i32 */
  mod.types.push({ params: [], results: ['i32'] });

  /* グローバル: mutableカウンタ */
  mod.globals.push({
    type: { valType: 'i32', mutable: true },
    value: { type: 'i32', value: 0 },
  });
  /* グローバル: 定数 */
  mod.globals.push({
    type: { valType: 'i32', mutable: false },
    value: { type: 'i32', value: 10 },
  });

  /* increment関数: counter += constant; return counter */
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      instr(Opcode.GlobalGet, 0),  // counter
      instr(Opcode.GlobalGet, 1),  // constant
      instr(Opcode.I32Add),
      instr(Opcode.GlobalSet, 0),  // counter = counter + constant
      instr(Opcode.GlobalGet, 0),  // return counter
      END,
    ],
  });
  mod.exports.push({ name: 'increment', kind: 'func', index: 0 });
  return mod;
}

/** 7. ホスト関数インポート */
function buildHostImport(): WasmModule {
  const mod = emptyModule();
  /* インポート関数型: (i32) -> void */
  mod.types.push({ params: ['i32'], results: [] });
  /* モジュール関数型: (i32) -> i32 */
  mod.types.push({ params: ['i32'], results: ['i32'] });

  mod.imports.push({
    module: 'env',
    name: 'log',
    kind: 'func',
    typeIndex: 0,
  });

  /* 関数: double(x) = x * 2, then log(result) */
  mod.functions.push(1);
  mod.codes.push({
    locals: ['i32'],
    instructions: [
      instr(Opcode.LocalGet, 0),
      instr(Opcode.I32Const, 2),
      instr(Opcode.I32Mul),
      instr(Opcode.LocalTee, 1),  // result
      // call imported log(result)
      instr(Opcode.Call, 0),       // call import[0] = env.log
      instr(Opcode.LocalGet, 1),  // return result
      END,
    ],
  });
  /* エクスポート: funcIndex=1 (import[0]がfunc0, この関数がfunc1) */
  mod.exports.push({ name: 'double_and_log', kind: 'func', index: 1 });
  return mod;
}

/** 8. メモリ成長 */
function buildMemoryGrow(): WasmModule {
  const mod = emptyModule();
  mod.types.push({ params: [], results: ['i32'] });
  mod.memories.push({ limits: { min: 1, max: 4 } });
  mod.functions.push(0);
  mod.codes.push({
    locals: ['i32'],
    instructions: [
      // 現在のメモリサイズを取得 (1ページ)
      { opcode: Opcode.MemorySize },
      instr(Opcode.LocalSet, 0),
      // 2ページ成長させる
      instr(Opcode.I32Const, 2),
      { opcode: Opcode.MemoryGrow },
      instr(Opcode.Drop),           // 旧サイズを捨てる
      // 新しいサイズを取得 (3ページ)
      { opcode: Opcode.MemorySize },
      // 新しい領域にデータを書き込む
      instr(Opcode.I32Const, 65536), // 2ページ目の先頭
      instr(Opcode.I32Const, 999),
      memInstr(Opcode.I32Store),
      // 読み返し
      instr(Opcode.I32Const, 65536),
      memInstr(Opcode.I32Load),
      END,
    ],
  });
  mod.exports.push({ name: 'test_grow', kind: 'func', index: 0 });
  return mod;
}

/** 9. 制御フロー (block / loop / br_if) */
function buildControlFlow(): WasmModule {
  const mod = emptyModule();
  /* (i32) -> i32: 1からnまでの合計を計算 */
  mod.types.push({ params: ['i32'], results: ['i32'] });
  mod.functions.push(0);
  mod.codes.push({
    locals: ['i32', 'i32'], // sum, i
    instructions: [
      instr(Opcode.I32Const, 0),
      instr(Opcode.LocalSet, 1),    // sum = 0
      instr(Opcode.I32Const, 1),
      instr(Opcode.LocalSet, 2),    // i = 1
      blockInstr(Opcode.Block, 'void'),
        blockInstr(Opcode.Loop, 'void'),
          // sum += i
          instr(Opcode.LocalGet, 1),
          instr(Opcode.LocalGet, 2),
          instr(Opcode.I32Add),
          instr(Opcode.LocalSet, 1),
          // i++
          instr(Opcode.LocalGet, 2),
          instr(Opcode.I32Const, 1),
          instr(Opcode.I32Add),
          instr(Opcode.LocalSet, 2),
          // if (i > n) break
          instr(Opcode.LocalGet, 2),
          instr(Opcode.LocalGet, 0),
          instr(Opcode.I32GtS),
          instr(Opcode.BrIf, 1),     // break outer block
          // continue
          instr(Opcode.Br, 0),        // loop back
        END,
      END,
      instr(Opcode.LocalGet, 1),    // return sum
      END,
    ],
  });
  mod.exports.push({ name: 'sum_to_n', kind: 'func', index: 0 });
  return mod;
}

/** 10. 間接呼び出し (call_indirect) */
function buildCallIndirect(): WasmModule {
  const mod = emptyModule();
  /* (i32, i32) -> i32 : 二項演算 */
  mod.types.push({ params: ['i32', 'i32'], results: ['i32'] });
  /* (i32, i32, i32) -> i32 : dispatch(a, b, op) */
  mod.types.push({ params: ['i32', 'i32', 'i32'], results: ['i32'] });

  /* func 0: add(a, b) */
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      instr(Opcode.LocalGet, 0),
      instr(Opcode.LocalGet, 1),
      instr(Opcode.I32Add),
      END,
    ],
  });

  /* func 1: sub(a, b) */
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      instr(Opcode.LocalGet, 0),
      instr(Opcode.LocalGet, 1),
      instr(Opcode.I32Sub),
      END,
    ],
  });

  /* func 2: mul(a, b) */
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      instr(Opcode.LocalGet, 0),
      instr(Opcode.LocalGet, 1),
      instr(Opcode.I32Mul),
      END,
    ],
  });

  /* func 3: dispatch(a, b, op) — call_indirect */
  mod.functions.push(1);
  mod.codes.push({
    locals: [],
    instructions: [
      instr(Opcode.LocalGet, 0),     // a
      instr(Opcode.LocalGet, 1),     // b
      instr(Opcode.LocalGet, 2),     // op (table index)
      callIndirectInstr(0),           // call_indirect type=0
      END,
    ],
  });

  /* テーブル */
  mod.tables.push({ elementType: 'funcref', limits: { min: 3 } });
  /* エレメントセグメント: table[0]=func0, table[1]=func1, table[2]=func2 */
  mod.elements.push({
    tableIndex: 0,
    offset: 0,
    funcIndices: [0, 1, 2],
  });

  mod.exports.push({ name: 'dispatch', kind: 'func', index: 3 });
  return mod;
}

/** 11. データセグメントとメモリ初期化 */
function buildDataSegment(): WasmModule {
  const mod = emptyModule();
  mod.types.push({ params: [], results: ['i32'] });
  mod.memories.push({ limits: { min: 1 } });

  /* "Hello" のバイト列をメモリに配置 */
  const hello = [72, 101, 108, 108, 111]; // H, e, l, l, o
  mod.data.push({
    memoryIndex: 0,
    offset: 0,
    data: hello,
  });
  /* 数値データを別の位置に配置 */
  mod.data.push({
    memoryIndex: 0,
    offset: 100,
    data: [0x2A, 0x00, 0x00, 0x00], // 42 (little endian i32)
  });

  /* 関数: メモリから読み出して検証 */
  mod.functions.push(0);
  mod.codes.push({
    locals: ['i32'],
    instructions: [
      // memory[0] = 'H' (72) を読み出し
      instr(Opcode.I32Const, 0),
      memInstr(Opcode.I32Load8U),
      instr(Opcode.LocalSet, 0),
      // memory[100] = 42 を読み出し
      instr(Opcode.I32Const, 100),
      memInstr(Opcode.I32Load),
      // H (72) + 42 = 114
      instr(Opcode.LocalGet, 0),
      instr(Opcode.I32Add),
      END,
    ],
  });
  mod.exports.push({ name: 'read_data', kind: 'func', index: 0 });
  return mod;
}

/** 12. select命令とdrop命令 */
function buildSelectDrop(): WasmModule {
  const mod = emptyModule();
  mod.types.push({ params: ['i32'], results: ['i32'] });
  mod.functions.push(0);
  mod.codes.push({
    locals: [],
    instructions: [
      // max(input, 100) を select で実装
      instr(Opcode.LocalGet, 0),    // input
      instr(Opcode.I32Const, 100),  // 100
      // condition: input > 100
      instr(Opcode.LocalGet, 0),
      instr(Opcode.I32Const, 100),
      instr(Opcode.I32GtS),
      { opcode: Opcode.Select },     // input > 100 ? input : 100

      // drop のデモ: 余分な値をプッシュしてドロップ
      instr(Opcode.I32Const, 999),
      { opcode: Opcode.Drop },
      END,
    ],
  });
  mod.exports.push({ name: 'clamp_min', kind: 'func', index: 0 });
  return mod;
}

/* ========== プリセット一覧 ========== */

export const presets: WasmPreset[] = [
  {
    name: '基本的な加算 (i32.add)',
    description: '2つのi32値を加算する最小のWASM関数。スタックマシンの基本操作を示す。',
    build: () => runPreset(
      buildAddition(),
      'add',
      [{ type: 'i32', value: 20 }, { type: 'i32', value: 22 }],
    ),
  },
  {
    name: 'フィボナッチ数列 (再帰)',
    description: '再帰的なcall命令でフィボナッチ数を計算。コールスタックの成長を観察。',
    build: () => runPreset(
      buildFibonacci(),
      'fib',
      [{ type: 'i32', value: 8 }],
    ),
  },
  {
    name: '階乗計算 (loop/br_if)',
    description: 'block/loop/br_if 制御フローで階乗を計算。WASMの構造化制御フローを体験。',
    build: () => runPreset(
      buildFactorial(),
      'factorial',
      [{ type: 'i32', value: 6 }],
    ),
  },
  {
    name: '線形メモリ (load/store)',
    description: '線形メモリにi32値を書き込み・読み出し。WASMのメモリモデルを可視化。',
    build: () => runPreset(buildLinearMemory(), 'test_memory'),
  },
  {
    name: 'スタックマシン演算',
    description: '(3+5)*(10-2) をスタック操作で計算。逆ポーランド記法的な実行過程を追跡。',
    build: () => runPreset(buildStackMachine(), 'calc'),
  },
  {
    name: 'グローバル変数',
    description: 'mutableグローバルカウンタをインクリメント。global.get / global.set の動作。',
    build: () => {
      const mod = buildGlobals();
      const vm = new WasmVM();
      vm.loadModule(mod);
      vm.instantiate();
      /* 3回インクリメント: 10, 20, 30 */
      vm.callExport('increment');
      vm.callExport('increment');
      return vm.callExport('increment');
    },
  },
  {
    name: 'ホスト関数インポート',
    description: 'env.log をホスト関数としてインポートし、WASMから呼び出す。外部環境との連携。',
    build: () => {
      const logged: number[] = [];
      const hostLog: HostFunc = {
        module: 'env',
        name: 'log',
        type: { params: ['i32'], results: [] },
        invoke: (args) => {
          logged.push(args[0]!.value as number);
          return [];
        },
      };
      return runPreset(
        buildHostImport(),
        'double_and_log',
        [{ type: 'i32', value: 21 }],
        [hostLog],
      );
    },
  },
  {
    name: 'メモリ成長 (memory.grow)',
    description: '実行時にメモリを拡張。memory.size / memory.grow の動作とページ管理。',
    build: () => runPreset(buildMemoryGrow(), 'test_grow'),
  },
  {
    name: '制御フロー (sum 1..N)',
    description: 'block/loop で1からNまでの合計を計算。br/br_if による分岐を追跡。',
    build: () => runPreset(
      buildControlFlow(),
      'sum_to_n',
      [{ type: 'i32', value: 10 }],
    ),
  },
  {
    name: '間接呼び出し (call_indirect)',
    description: 'テーブル経由で関数を動的にディスパッチ。add/sub/mulを切り替えて呼び出す。',
    build: () => {
      const mod = buildCallIndirect();
      const vm = new WasmVM();
      vm.loadModule(mod);
      vm.instantiate();
      /* op=0: add(10,3)=13, op=1: sub(10,3)=7, op=2: mul(10,3)=30 */
      vm.callExport('dispatch', [
        { type: 'i32', value: 10 },
        { type: 'i32', value: 3 },
        { type: 'i32', value: 0 }, // add
      ]);
      vm.callExport('dispatch', [
        { type: 'i32', value: 10 },
        { type: 'i32', value: 3 },
        { type: 'i32', value: 1 }, // sub
      ]);
      return vm.callExport('dispatch', [
        { type: 'i32', value: 10 },
        { type: 'i32', value: 3 },
        { type: 'i32', value: 2 }, // mul
      ]);
    },
  },
  {
    name: 'データセグメント',
    description: 'モジュール初期化時にメモリにデータを配置。文字列と数値の初期値設定。',
    build: () => runPreset(buildDataSegment(), 'read_data'),
  },
  {
    name: 'select / drop 命令',
    description: '条件選択(select)と値破棄(drop)のパラメトリック命令を実演。',
    build: () => {
      const mod = buildSelectDrop();
      const vm = new WasmVM();
      vm.loadModule(mod);
      vm.instantiate();
      /* 50 → clamped to 100 */
      vm.callExport('clamp_min', [{ type: 'i32', value: 50 }]);
      /* 200 → stays 200 */
      return vm.callExport('clamp_min', [{ type: 'i32', value: 200 }]);
    },
  },
];
