/* ===== WebAssembly シミュレーター テスト ===== */

import { describe, it, expect } from 'vitest';
import { emptyModule, runSimulation } from '../engine/engine';
import {
  type WasmModule,
  type WasmValue,
  type HostFunc,
  type Instruction,
  Opcode,
} from '../engine/types';
import { presets } from '../engine/presets';

/* ---------- ヘルパー ---------- */

function i32(v: number): WasmValue {
  return { type: 'i32', value: v };
}

function instr(opcode: Opcode, immediate?: number | bigint): Instruction {
  return { opcode, immediate };
}

const END: Instruction = { opcode: Opcode.End };

/** シンプルな関数モジュールを作成 */
function simpleFuncModule(
  params: WasmValue['type'][],
  results: WasmValue['type'][],
  locals: WasmValue['type'][],
  instructions: Instruction[],
): WasmModule {
  const mod = emptyModule();
  mod.types.push({ params, results });
  mod.functions.push(0);
  mod.codes.push({ locals, instructions: [...instructions, END] });
  mod.exports.push({ name: 'test', kind: 'func', index: 0 });
  return mod;
}

/* ========== テスト ========== */

describe('WasmVM: 基本操作', () => {
  it('i32.const + i32.add で加算する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 10),
      instr(Opcode.I32Const, 20),
      instr(Opcode.I32Add),
    ]);
    const result = runSimulation(mod, 'test');
    expect(result.result).toEqual([i32(30)]);
  });

  it('引数を受け取って計算する', () => {
    const mod = simpleFuncModule(['i32', 'i32'], ['i32'], [], [
      instr(Opcode.LocalGet, 0),
      instr(Opcode.LocalGet, 1),
      instr(Opcode.I32Mul),
    ]);
    const result = runSimulation(mod, 'test', [i32(7), i32(6)]);
    expect(result.result).toEqual([i32(42)]);
  });

  it('ローカル変数を使う', () => {
    const mod = simpleFuncModule(['i32'], ['i32'], ['i32'], [
      instr(Opcode.LocalGet, 0),
      instr(Opcode.I32Const, 5),
      instr(Opcode.I32Add),
      instr(Opcode.LocalSet, 1),
      instr(Opcode.LocalGet, 1),
    ]);
    const result = runSimulation(mod, 'test', [i32(10)]);
    expect(result.result).toEqual([i32(15)]);
  });

  it('i32.sub で減算する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 100),
      instr(Opcode.I32Const, 37),
      instr(Opcode.I32Sub),
    ]);
    const result = runSimulation(mod, 'test');
    expect(result.result).toEqual([i32(63)]);
  });

  it('i32.div_s でゼロ除算はtrapする', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 10),
      instr(Opcode.I32Const, 0),
      instr(Opcode.I32DivS),
    ]);
    const result = runSimulation(mod, 'test');
    expect(result.result).toBeNull();
    expect(result.stats.traps).toBeGreaterThan(0);
  });
});

describe('WasmVM: 比較命令', () => {
  it('i32.eqz が正しく動作する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 0),
      instr(Opcode.I32Eqz),
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(1)]);
  });

  it('i32.lt_s が正しく動作する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 5),
      instr(Opcode.I32Const, 10),
      instr(Opcode.I32LtS),
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(1)]);
  });
});

describe('WasmVM: ビット演算', () => {
  it('i32.and / i32.or / i32.xor が正しく動作する', () => {
    /* 0xFF & 0x0F = 0x0F */
    const modAnd = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 0xFF),
      instr(Opcode.I32Const, 0x0F),
      instr(Opcode.I32And),
    ]);
    expect(runSimulation(modAnd, 'test').result).toEqual([i32(0x0F)]);

    /* 0xF0 | 0x0F = 0xFF */
    const modOr = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 0xF0),
      instr(Opcode.I32Const, 0x0F),
      instr(Opcode.I32Or),
    ]);
    expect(runSimulation(modOr, 'test').result).toEqual([i32(0xFF)]);
  });

  it('i32.shl / i32.shr_u が正しく動作する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 1),
      instr(Opcode.I32Const, 4),
      instr(Opcode.I32Shl),
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(16)]);
  });
});

describe('WasmVM: メモリ操作', () => {
  it('i32.store / i32.load で読み書きする', () => {
    const mod = emptyModule();
    mod.types.push({ params: [], results: ['i32'] });
    mod.memories.push({ limits: { min: 1 } });
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.I32Const, 0),
        instr(Opcode.I32Const, 42),
        { opcode: Opcode.I32Store, offset: 0, align: 2 },
        instr(Opcode.I32Const, 0),
        { opcode: Opcode.I32Load, offset: 0, align: 2 },
        END,
      ],
    });
    mod.exports.push({ name: 'test', kind: 'func', index: 0 });
    const result = runSimulation(mod, 'test');
    expect(result.result).toEqual([i32(42)]);
  });

  it('メモリ範囲外アクセスでtrapする', () => {
    const mod = emptyModule();
    mod.types.push({ params: [], results: ['i32'] });
    mod.memories.push({ limits: { min: 1 } });
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.I32Const, 70000), // 1ページ(65536バイト)を超える
        { opcode: Opcode.I32Load, offset: 0, align: 2 },
        END,
      ],
    });
    mod.exports.push({ name: 'test', kind: 'func', index: 0 });
    const result = runSimulation(mod, 'test');
    expect(result.result).toBeNull();
    expect(result.stats.traps).toBeGreaterThan(0);
  });

  it('memory.grow でメモリを拡張する', () => {
    const mod = emptyModule();
    mod.types.push({ params: [], results: ['i32'] });
    mod.memories.push({ limits: { min: 1, max: 4 } });
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.I32Const, 2),
        { opcode: Opcode.MemoryGrow },
        // 旧サイズ(1)が返る
        END,
      ],
    });
    mod.exports.push({ name: 'test', kind: 'func', index: 0 });
    const result = runSimulation(mod, 'test');
    expect(result.result).toEqual([i32(1)]); // 旧ページ数
    expect(result.stats.memoryPeakPages).toBe(3);
  });
});

describe('WasmVM: 制御フロー', () => {
  it('if/else が正しく分岐する', () => {
    /* if (1) { 10 } else { 20 } => 10 */
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 1),
      { opcode: Opcode.If, blockType: 'i32' },
        instr(Opcode.I32Const, 10),
      { opcode: Opcode.Else },
        instr(Opcode.I32Const, 20),
      END,
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(10)]);
  });

  it('if条件偽でelse節を実行する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 0),
      { opcode: Opcode.If, blockType: 'i32' },
        instr(Opcode.I32Const, 10),
      { opcode: Opcode.Else },
        instr(Opcode.I32Const, 20),
      END,
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(20)]);
  });

  it('loop/br_if でループする', () => {
    /* sum = 0; i = 0; while (i < 5) { sum += i; i++; } return sum; => 10 */
    const mod = simpleFuncModule([], ['i32'], ['i32', 'i32'], [
      instr(Opcode.I32Const, 0),
      instr(Opcode.LocalSet, 0), // sum = 0
      instr(Opcode.I32Const, 0),
      instr(Opcode.LocalSet, 1), // i = 0
      { opcode: Opcode.Block, blockType: 'void' },
        { opcode: Opcode.Loop, blockType: 'void' },
          // if i >= 5 break
          instr(Opcode.LocalGet, 1),
          instr(Opcode.I32Const, 5),
          instr(Opcode.I32GeS),
          instr(Opcode.BrIf, 1),
          // sum += i
          instr(Opcode.LocalGet, 0),
          instr(Opcode.LocalGet, 1),
          instr(Opcode.I32Add),
          instr(Opcode.LocalSet, 0),
          // i++
          instr(Opcode.LocalGet, 1),
          instr(Opcode.I32Const, 1),
          instr(Opcode.I32Add),
          instr(Opcode.LocalSet, 1),
          instr(Opcode.Br, 0), // continue loop
        END,
      END,
      instr(Opcode.LocalGet, 0),
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(10)]);
  });
});

describe('WasmVM: 関数呼び出し', () => {
  it('内部関数を呼び出す', () => {
    const mod = emptyModule();
    /* func 0: double(x) = x * 2 */
    mod.types.push({ params: ['i32'], results: ['i32'] });
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.LocalGet, 0),
        instr(Opcode.I32Const, 2),
        instr(Opcode.I32Mul),
        END,
      ],
    });
    /* func 1: main() = double(21) */
    mod.types.push({ params: [], results: ['i32'] });
    mod.functions.push(1);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.I32Const, 21),
        instr(Opcode.Call, 0),
        END,
      ],
    });
    mod.exports.push({ name: 'main', kind: 'func', index: 1 });
    expect(runSimulation(mod, 'main').result).toEqual([i32(42)]);
  });

  it('ホスト関数をインポートして呼び出す', () => {
    const mod = emptyModule();
    mod.types.push({ params: ['i32'], results: ['i32'] });
    mod.imports.push({
      module: 'env',
      name: 'square',
      kind: 'func',
      typeIndex: 0,
    });
    /* func 1: test(x) = square(x) + 1 */
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.LocalGet, 0),
        instr(Opcode.Call, 0), // call import
        instr(Opcode.I32Const, 1),
        instr(Opcode.I32Add),
        END,
      ],
    });
    mod.exports.push({ name: 'test', kind: 'func', index: 1 });

    const hostSquare: HostFunc = {
      module: 'env',
      name: 'square',
      type: { params: ['i32'], results: ['i32'] },
      invoke: (args) => [i32((args[0]!.value as number) ** 2)],
    };

    const result = runSimulation(mod, 'test', [i32(5)], [hostSquare]);
    expect(result.result).toEqual([i32(26)]); // 5^2 + 1 = 26
    expect(result.stats.hostCalls).toBe(1);
  });
});

describe('WasmVM: グローバル変数', () => {
  it('mutableグローバルを読み書きする', () => {
    const mod = emptyModule();
    mod.types.push({ params: [], results: ['i32'] });
    mod.globals.push({
      type: { valType: 'i32', mutable: true },
      value: i32(100),
    });
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.GlobalGet, 0),
        instr(Opcode.I32Const, 50),
        instr(Opcode.I32Add),
        instr(Opcode.GlobalSet, 0),
        instr(Opcode.GlobalGet, 0),
        END,
      ],
    });
    mod.exports.push({ name: 'test', kind: 'func', index: 0 });
    expect(runSimulation(mod, 'test').result).toEqual([i32(150)]);
  });
});

describe('WasmVM: テーブルと間接呼び出し', () => {
  it('call_indirect でテーブル経由の関数を呼び出す', () => {
    const mod = emptyModule();
    mod.types.push({ params: ['i32', 'i32'], results: ['i32'] });

    /* func 0: add */
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

    /* func 1: sub */
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

    /* func 2: dispatch(a, b, op) */
    mod.types.push({ params: ['i32', 'i32', 'i32'], results: ['i32'] });
    mod.functions.push(1);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.LocalGet, 0),
        instr(Opcode.LocalGet, 1),
        instr(Opcode.LocalGet, 2),
        { opcode: Opcode.CallIndirect, immediate: 0 },
        END,
      ],
    });

    mod.tables.push({ elementType: 'funcref', limits: { min: 2 } });
    mod.elements.push({ tableIndex: 0, offset: 0, funcIndices: [0, 1] });
    mod.exports.push({ name: 'dispatch', kind: 'func', index: 2 });

    /* dispatch(10, 3, 0) = add(10, 3) = 13 */
    expect(runSimulation(mod, 'dispatch', [i32(10), i32(3), i32(0)]).result).toEqual([i32(13)]);
    /* dispatch(10, 3, 1) = sub(10, 3) = 7 */
    expect(runSimulation(mod, 'dispatch', [i32(10), i32(3), i32(1)]).result).toEqual([i32(7)]);
  });
});

describe('WasmVM: データセグメント', () => {
  it('初期データがメモリに配置される', () => {
    const mod = emptyModule();
    mod.types.push({ params: [], results: ['i32'] });
    mod.memories.push({ limits: { min: 1 } });
    mod.data.push({
      memoryIndex: 0,
      offset: 0,
      data: [0x2A, 0x00, 0x00, 0x00], // 42 as i32 LE
    });
    mod.functions.push(0);
    mod.codes.push({
      locals: [],
      instructions: [
        instr(Opcode.I32Const, 0),
        { opcode: Opcode.I32Load, offset: 0, align: 2 },
        END,
      ],
    });
    mod.exports.push({ name: 'test', kind: 'func', index: 0 });
    expect(runSimulation(mod, 'test').result).toEqual([i32(42)]);
  });
});

describe('WasmVM: パラメトリック命令', () => {
  it('select が条件に応じて値を選択する', () => {
    /* select(10, 20, 1) = 10 */
    const mod1 = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 10),
      instr(Opcode.I32Const, 20),
      instr(Opcode.I32Const, 1),
      { opcode: Opcode.Select },
    ]);
    expect(runSimulation(mod1, 'test').result).toEqual([i32(10)]);

    /* select(10, 20, 0) = 20 */
    const mod2 = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 10),
      instr(Opcode.I32Const, 20),
      instr(Opcode.I32Const, 0),
      { opcode: Opcode.Select },
    ]);
    expect(runSimulation(mod2, 'test').result).toEqual([i32(20)]);
  });

  it('drop がスタックトップを除去する', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 999),
      instr(Opcode.I32Const, 42),
      { opcode: Opcode.Drop },
    ]);
    expect(runSimulation(mod, 'test').result).toEqual([i32(999)]);
  });
});

describe('WasmVM: 統計情報', () => {
  it('実行統計が正しく記録される', () => {
    const mod = simpleFuncModule([], ['i32'], [], [
      instr(Opcode.I32Const, 1),
      instr(Opcode.I32Const, 2),
      instr(Opcode.I32Add),
    ]);
    const result = runSimulation(mod, 'test');
    expect(result.stats.totalInstructions).toBeGreaterThan(0);
    expect(result.stats.maxStackDepth).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});

describe('プリセット', () => {
  it('全プリセットが正常に実行される', () => {
    expect(presets.length).toBeGreaterThanOrEqual(12);
    for (const preset of presets) {
      const result = preset.build();
      expect(result.steps.length).toBeGreaterThan(0);
    }
  });

  it('加算プリセットが正しい結果を返す', () => {
    const result = presets[0]!.build();
    expect(result.result).toEqual([i32(42)]);
  });

  it('スタックマシンプリセットが正しい結果を返す', () => {
    const result = presets[4]!.build();
    expect(result.result).toEqual([i32(64)]); // (3+5)*(10-2) = 64
  });

  it('線形メモリプリセットが正しい結果を返す', () => {
    const result = presets[3]!.build();
    expect(result.result).toEqual([i32(142)]); // 42 + 100
  });
});
