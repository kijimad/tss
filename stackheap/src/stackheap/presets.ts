/* スタック＆ヒープ シミュレーター プリセット */

import type { Preset, SimOp, Instruction } from "./types.js";
import { intVal, floatVal, boolVal, charVal } from "./engine.js";

export const PRESETS: Preset[] = [
  {
    name: "基本的な関数呼び出し",
    description: "main→add→return の単純なコールスタック動作",
    build: (): SimOp[] => [{
      type: "execute", programName: "basic_call",
      instructions: [
        { op: "comment", text: "── main() 開始 ──" },
        { op: "call", functionName: "main", args: [] },
        { op: "local", name: "x", value: intVal(10) },
        { op: "local", name: "y", value: intVal(20) },
        { op: "comment", text: "── add(x, y) 呼び出し ──" },
        { op: "call", functionName: "add", args: [{ name: "a", value: intVal(10) }, { name: "b", value: intVal(20) }] },
        { op: "local", name: "result", value: intVal(30) },
        { op: "return", value: intVal(30) },
        { op: "comment", text: "── main() に戻る ──" },
        { op: "local", name: "sum", value: intVal(30) },
        { op: "return" },
      ],
    }],
  },
  {
    name: "ネストした関数呼び出し",
    description: "main→foo→bar→baz の深いコールスタック",
    build: (): SimOp[] => [{
      type: "execute", programName: "nested_calls",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "local", name: "data", value: intVal(100) },
        { op: "call", functionName: "foo", args: [{ name: "n", value: intVal(100) }] },
        { op: "local", name: "temp", value: floatVal(3.14) },
        { op: "call", functionName: "bar", args: [{ name: "x", value: floatVal(3.14) }] },
        { op: "local", name: "flag", value: boolVal(true) },
        { op: "call", functionName: "baz", args: [{ name: "f", value: boolVal(true) }] },
        { op: "local", name: "c", value: charVal("Z") },
        { op: "comment", text: "── 4段目のフレーム。スタックが深い ──" },
        { op: "return", value: charVal("Z") },
        { op: "return", value: boolVal(true) },
        { op: "return", value: floatVal(3.14) },
        { op: "return" },
      ],
    }],
  },
  {
    name: "ヒープ割当と解放",
    description: "malloc/free の動作とメモリ管理",
    build: (): SimOp[] => [{
      type: "execute", programName: "heap_basic",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "comment", text: "── ヒープにオブジェクトを割り当て ──" },
        { op: "alloc", varName: "arr", size: 40, label: "int[10]", content: "[0,1,2,3,4,5,6,7,8,9]" },
        { op: "alloc", varName: "str", size: 16, label: "String", content: '"Hello, World!"' },
        { op: "alloc", varName: "obj", size: 32, label: "User", content: '{name:"Alice", age:30}' },
        { op: "comment", text: "── str を解放 ──" },
        { op: "free", varName: "str" },
        { op: "comment", text: "── obj を解放 ──" },
        { op: "free", varName: "obj" },
        { op: "comment", text: "── arr を解放せずにリターン → メモリリーク ──" },
        { op: "return" },
      ],
    }],
  },
  {
    name: "スタックオーバーフロー",
    description: "無限再帰によるスタック領域の枯渇",
    build: (): SimOp[] => {
      const instructions: Instruction[] = [
        { op: "call", functionName: "main", args: [] },
        { op: "comment", text: "── 無限再帰を開始 ──" },
      ];
      // 再帰呼び出しを繰り返す
      for (let i = 0; i < 80; i++) {
        instructions.push({
          op: "call", functionName: `recurse_${i}`,
          args: [{ name: "depth", value: intVal(i) }],
        });
        instructions.push({ op: "local", name: "buf", value: intVal(0) });
      }
      return [{ type: "execute", programName: "stack_overflow", instructions }];
    },
  },
  {
    name: "メモリリーク",
    description: "ヒープ割当後に解放を忘れるケース",
    build: (): SimOp[] => [{
      type: "execute", programName: "memory_leak",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "comment", text: "── ループ内でヒープ割当（解放なし） ──" },
        { op: "call", functionName: "processLoop", args: [] },
        { op: "alloc", varName: "item1", size: 64, label: "Buffer_1", content: "data chunk 1" },
        { op: "alloc", varName: "item2", size: 64, label: "Buffer_2", content: "data chunk 2" },
        { op: "alloc", varName: "item3", size: 64, label: "Buffer_3", content: "data chunk 3" },
        { op: "comment", text: "── 関数リターン。ポインタが失われメモリリーク ──" },
        { op: "return" },
        { op: "comment", text: "── main: ヒープ上に3ブロックが残存 ──" },
        { op: "return" },
      ],
    }],
  },
  {
    name: "ダングリングポインタ",
    description: "解放済みメモリへのアクセス（Use-After-Free）",
    build: (): SimOp[] => [{
      type: "execute", programName: "dangling_pointer",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "alloc", varName: "ptr", size: 32, label: "UserData", content: '{user:"admin"}' },
        { op: "comment", text: "── ヒープを解放 ──" },
        { op: "free", varName: "ptr" },
        { op: "comment", text: "── 解放済みポインタで再度解放を試行（二重解放） ──" },
        { op: "free", varName: "ptr" },
        { op: "return" },
      ],
    }],
  },
  {
    name: "Mark & Sweep GC",
    description: "到達不能オブジェクトをGCで回収",
    build: (): SimOp[] => [{
      type: "execute", programName: "gc_mark_sweep",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "alloc", varName: "alive1", size: 24, label: "LiveObj_A", content: "{active: true}" },
        { op: "alloc", varName: "alive2", size: 24, label: "LiveObj_B", content: "{active: true}" },
        { op: "alloc", varName: "temp", size: 48, label: "TempObj", content: "{temp: 'data'}" },
        { op: "comment", text: "── temp への参照を切る（ポインタを上書き） ──" },
        { op: "assign", varName: "temp", value: intVal(0) },
        { op: "comment", text: "── GC実行: temp は到達不能なので回収される ──" },
        { op: "gc", method: "mark_sweep" },
        { op: "comment", text: "── alive1, alive2 はスタックから参照されているので生存 ──" },
        { op: "return" },
      ],
    }],
  },
  {
    name: "ヒープ断片化",
    description: "割当と解放の繰り返しによる断片化",
    build: (): SimOp[] => [{
      type: "execute", programName: "fragmentation",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "comment", text: "── 連続して割り当て ──" },
        { op: "alloc", varName: "blk1", size: 64, label: "Block_1", content: "AAAA..." },
        { op: "alloc", varName: "blk2", size: 32, label: "Block_2", content: "BBBB..." },
        { op: "alloc", varName: "blk3", size: 64, label: "Block_3", content: "CCCC..." },
        { op: "alloc", varName: "blk4", size: 32, label: "Block_4", content: "DDDD..." },
        { op: "alloc", varName: "blk5", size: 64, label: "Block_5", content: "EEEE..." },
        { op: "comment", text: "── 偶数ブロックを解放 → 穴が空く ──" },
        { op: "free", varName: "blk2" },
        { op: "free", varName: "blk4" },
        { op: "comment", text: "── 新しい小さいブロックを割当（穴に入る） ──" },
        { op: "alloc", varName: "small1", size: 16, label: "Small_1", content: "xx" },
        { op: "comment", text: "── 大きいブロックは穴に入らない ──" },
        { op: "alloc", varName: "big", size: 128, label: "Big_Block", content: "ZZZZ..." },
        { op: "return" },
      ],
    }],
  },
  {
    name: "スタック vs ヒープ比較",
    description: "プリミティブ型(スタック)と参照型(ヒープ)の違い",
    build: (): SimOp[] => [{
      type: "execute", programName: "stack_vs_heap",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "comment", text: "── プリミティブ型はスタックに直接格納 ──" },
        { op: "local", name: "age", value: intVal(25) },
        { op: "local", name: "height", value: floatVal(175.5) },
        { op: "local", name: "active", value: boolVal(true) },
        { op: "local", name: "initial", value: charVal("T") },
        { op: "comment", text: "── 参照型はヒープに格納、スタックにポインタ ──" },
        { op: "alloc", varName: "name", size: 20, label: "String", content: '"Taro Yamada"' },
        { op: "alloc", varName: "scores", size: 40, label: "int[]", content: "[85, 92, 78, 95, 88]" },
        { op: "alloc", varName: "profile", size: 48, label: "Object", content: '{name:"Taro", age:25}' },
        { op: "comment", text: "── 関数呼び出しでプリミティブはコピー ──" },
        { op: "call", functionName: "processAge", args: [{ name: "a", value: intVal(25) }] },
        { op: "local", name: "doubled", value: intVal(50) },
        { op: "return", value: intVal(50) },
        { op: "comment", text: "── 関数リターン後もヒープのデータは生存 ──" },
        { op: "return" },
      ],
    }],
  },
  {
    name: "参照カウントGC",
    description: "参照カウント方式によるGCの動作",
    build: (): SimOp[] => [{
      type: "execute", programName: "gc_refcount",
      instructions: [
        { op: "call", functionName: "main", args: [] },
        { op: "alloc", varName: "obj1", size: 32, label: "Obj_A", content: "{data: 'A'}" },
        { op: "alloc", varName: "obj2", size: 32, label: "Obj_B", content: "{data: 'B'}" },
        { op: "alloc", varName: "obj3", size: 32, label: "Obj_C", content: "{data: 'C'}" },
        { op: "comment", text: "── obj2 を解放（参照カウント=0） ──" },
        { op: "free", varName: "obj2" },
        { op: "comment", text: "── 参照カウントGCを実行 ──" },
        { op: "gc", method: "ref_count" },
        { op: "comment", text: "── obj1, obj3 は参照カウント>0 なので生存 ──" },
        { op: "free", varName: "obj1" },
        { op: "free", varName: "obj3" },
        { op: "gc", method: "ref_count" },
        { op: "return" },
      ],
    }],
  },
];
