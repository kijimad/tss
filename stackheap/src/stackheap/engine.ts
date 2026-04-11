/* スタック＆ヒープ シミュレーター エンジン */

import type {
  MemValue, StackFrame, StackVariable, CallStack,
  HeapBlock, Heap, MemoryLayout, MemorySegment,
  StepResult, SimOp, SimEvent,
  SimulationResult,
} from "./types.js";

// ─── 定数 ───

/** デフォルトスタックサイズ（バイト） */
const DEFAULT_STACK_SIZE = 1024;
/** デフォルトヒープサイズ（バイト） */
const DEFAULT_HEAP_SIZE = 4096;
/** ヒープ開始アドレス */
const HEAP_BASE = 0x1000;
/** スタック開始アドレス（高位アドレス、下方向に成長） */
const STACK_BASE = 0x7FFF;
/** テキストセグメント開始 */
const TEXT_BASE = 0x0100;
/** データセグメント開始 */
const DATA_BASE = 0x0800;

// ─── 値ヘルパー ───

/** 整数値 */
export function intVal(n: number): MemValue {
  return { kind: "primitive", type: "int", display: String(n), size: 4 };
}

/** 浮動小数点値 */
export function floatVal(n: number): MemValue {
  return { kind: "primitive", type: "float", display: n.toFixed(2), size: 8 };
}

/** 真偽値 */
export function boolVal(b: boolean): MemValue {
  return { kind: "primitive", type: "bool", display: String(b), size: 1 };
}

/** 文字値 */
export function charVal(c: string): MemValue {
  return { kind: "primitive", type: "char", display: `'${c}'`, size: 1 };
}

/** ポインタ値 */
export function ptrVal(addr: number): MemValue {
  return { kind: "reference", type: "pointer", display: `0x${addr.toString(16)}`, size: 8, heapAddr: addr };
}

/** 参照値（オブジェクト/配列） */
export function refVal(type: "object" | "array" | "string", addr: number): MemValue {
  return { kind: "reference", type, display: `→ 0x${addr.toString(16)}`, size: 8, heapAddr: addr };
}

/** 戻りアドレス */
export function retAddr(addr: number): MemValue {
  return { kind: "return_address", type: "pointer", display: `ret: 0x${addr.toString(16)}`, size: 8 };
}

// ─── コールスタック操作 ───

/** 空のコールスタックを作成 */
export function createStack(maxSize: number = DEFAULT_STACK_SIZE): CallStack {
  return { frames: [], sp: STACK_BASE, maxSize, overflow: false };
}

/** 関数呼び出し（プッシュ） */
export function pushFrame(
  stack: CallStack, functionName: string,
  args: { name: string; value: MemValue }[],
  events: SimEvent[],
): CallStack {
  const returnAddress = TEXT_BASE + stack.frames.length * 0x20;

  // 引数のスタック変数化
  const stackArgs: StackVariable[] = args.map((a, i) => ({
    name: a.name,
    value: a.value,
    offset: i * 8,
  }));

  // フレームサイズ = 戻りアドレス(8) + ベースポインタ(8) + 引数
  const frameSize = 16 + stackArgs.reduce((s, a) => s + a.value.size, 0);
  const newSp = stack.sp - frameSize;

  // スタックオーバーフロー判定
  if (STACK_BASE - newSp > stack.maxSize) {
    events.push({
      type: "overflow",
      message: `スタックオーバーフロー: ${functionName}() の呼び出しでスタック領域を超過`,
      detail: `使用量: ${STACK_BASE - newSp} / ${stack.maxSize} bytes`,
    });
    return { ...stack, overflow: true };
  }

  const frame: StackFrame = {
    functionName,
    returnAddress,
    basePointer: stack.sp,
    locals: [],
    args: stackArgs,
    frameSize,
  };

  events.push({
    type: "push",
    message: `${functionName}() をコールスタックにプッシュ`,
    detail: `SP: 0x${stack.sp.toString(16)} → 0x${newSp.toString(16)} (${frameSize} bytes)`,
  });

  return {
    ...stack,
    frames: [...stack.frames, frame],
    sp: newSp,
  };
}

/** 関数リターン（ポップ） */
export function popFrame(stack: CallStack, events: SimEvent[]): CallStack {
  if (stack.frames.length === 0) {
    events.push({ type: "warn", message: "空のスタックからポップしようとしました" });
    return stack;
  }

  const frame = stack.frames[stack.frames.length - 1];
  const newSp = frame.basePointer;

  events.push({
    type: "pop",
    message: `${frame.functionName}() をコールスタックからポップ`,
    detail: `SP: 0x${stack.sp.toString(16)} → 0x${newSp.toString(16)} (${frame.frameSize} bytes 解放)`,
  });

  return {
    ...stack,
    frames: stack.frames.slice(0, -1),
    sp: newSp,
  };
}

/** ローカル変数をフレームに追加 */
export function addLocal(
  stack: CallStack, name: string, value: MemValue, events: SimEvent[],
): CallStack {
  if (stack.frames.length === 0) return stack;

  const frames = [...stack.frames];
  const frame = { ...frames[frames.length - 1] };

  const offset = frame.locals.reduce((s, l) => s + l.value.size, 0) + frame.args.reduce((s, a) => s + a.value.size, 0);
  const variable: StackVariable = { name, value, offset };
  frame.locals = [...frame.locals, variable];
  frame.frameSize += value.size;

  const newSp = stack.sp - value.size;
  frames[frames.length - 1] = frame;

  events.push({
    type: "push",
    message: `ローカル変数 '${name}' をスタックに確保 (${value.size} bytes)`,
    detail: `値: ${value.display}, 型: ${value.type}, SP: 0x${newSp.toString(16)}`,
  });

  return { ...stack, frames, sp: newSp };
}

/** 変数の値を更新 */
export function assignVar(
  stack: CallStack, varName: string, value: MemValue, events: SimEvent[],
): CallStack {
  if (stack.frames.length === 0) return stack;

  const frames = [...stack.frames];
  const frame = { ...frames[frames.length - 1] };

  // ローカル変数から検索
  const localIdx = frame.locals.findIndex(l => l.name === varName);
  if (localIdx >= 0) {
    frame.locals = [...frame.locals];
    frame.locals[localIdx] = { ...frame.locals[localIdx], value };
    frames[frames.length - 1] = frame;
    events.push({
      type: "info",
      message: `変数 '${varName}' を更新: ${value.display}`,
    });
    return { ...stack, frames };
  }

  // 引数から検索
  const argIdx = frame.args.findIndex(a => a.name === varName);
  if (argIdx >= 0) {
    frame.args = [...frame.args];
    frame.args[argIdx] = { ...frame.args[argIdx], value };
    frames[frames.length - 1] = frame;
    events.push({
      type: "info",
      message: `引数 '${varName}' を更新: ${value.display}`,
    });
    return { ...stack, frames };
  }

  return stack;
}

// ─── ヒープ操作 ───

/** 空のヒープを作成 */
export function createHeap(maxSize: number = DEFAULT_HEAP_SIZE): Heap {
  return { blocks: [], nextAddress: HEAP_BASE, maxSize, totalAllocated: 0, fragmentation: 0 };
}

/** ヒープにメモリを割り当て */
export function heapAlloc(
  heap: Heap, size: number, label: string, content: string, events: SimEvent[],
): { heap: Heap; address: number } {
  // フリーブロックの再利用（First Fit）
  const freeIdx = heap.blocks.findIndex(b => b.status === "freed" && b.size >= size);
  if (freeIdx >= 0) {
    const block = heap.blocks[freeIdx];
    const newBlocks = [...heap.blocks];
    newBlocks[freeIdx] = {
      ...block, status: "allocated", label, content, refCount: 1, marked: false,
    };
    events.push({
      type: "alloc",
      message: `ヒープ再利用: '${label}' (${size} bytes) @ 0x${block.address.toString(16)}`,
      detail: `フリーブロックを再利用`,
    });
    return {
      heap: { ...heap, blocks: newBlocks, totalAllocated: heap.totalAllocated + size, fragmentation: calcFragmentation(newBlocks) },
      address: block.address,
    };
  }

  // 新規割り当て
  const address = heap.nextAddress;
  if (address + size - HEAP_BASE > heap.maxSize) {
    events.push({
      type: "warn",
      message: `ヒープ領域不足: ${size} bytes の割当に失敗`,
      detail: `使用量: ${heap.totalAllocated} / ${heap.maxSize} bytes`,
    });
    return { heap, address: 0 };
  }

  const block: HeapBlock = {
    address, size, status: "allocated",
    label, content, refCount: 1, marked: false,
  };

  events.push({
    type: "alloc",
    message: `ヒープ割当: '${label}' (${size} bytes) @ 0x${address.toString(16)}`,
    detail: `内容: ${content}`,
  });

  const newBlocks = [...heap.blocks, block];
  return {
    heap: {
      ...heap,
      blocks: newBlocks,
      nextAddress: address + size,
      totalAllocated: heap.totalAllocated + size,
      fragmentation: calcFragmentation(newBlocks),
    },
    address,
  };
}

/** ヒープメモリを解放 */
export function heapFree(
  heap: Heap, address: number, events: SimEvent[],
): Heap {
  const idx = heap.blocks.findIndex(b => b.address === address);
  if (idx < 0) {
    events.push({
      type: "dangling",
      message: `無効なアドレス 0x${address.toString(16)} の解放を試行（ダングリングポインタ）`,
    });
    return heap;
  }

  const block = heap.blocks[idx];
  if (block.status === "freed") {
    events.push({
      type: "warn",
      message: `二重解放検出: 0x${address.toString(16)} は既に解放済み`,
    });
    const newBlocks = [...heap.blocks];
    newBlocks[idx] = { ...block, status: "corrupted" };
    return { ...heap, blocks: newBlocks };
  }

  const newBlocks = [...heap.blocks];
  newBlocks[idx] = { ...block, status: "freed", refCount: 0 };

  events.push({
    type: "free",
    message: `ヒープ解放: '${block.label}' (${block.size} bytes) @ 0x${address.toString(16)}`,
  });

  return {
    ...heap,
    blocks: newBlocks,
    totalAllocated: heap.totalAllocated - block.size,
    fragmentation: calcFragmentation(newBlocks),
  };
}

/** 断片化率の計算 */
function calcFragmentation(blocks: HeapBlock[]): number {
  const allocated = blocks.filter(b => b.status === "allocated");
  const freed = blocks.filter(b => b.status === "freed");
  if (allocated.length === 0 && freed.length === 0) return 0;
  const totalUsed = allocated.reduce((s, b) => s + b.size, 0);
  const totalFreed = freed.reduce((s, b) => s + b.size, 0);
  if (totalUsed + totalFreed === 0) return 0;
  // フリーブロック数が多いほど断片化が高い
  return Math.round((freed.length / (allocated.length + freed.length)) * 100);
}

// ─── ガベージコレクション ───

/** Mark & Sweep GC */
export function gcMarkSweep(
  stack: CallStack, heap: Heap, events: SimEvent[],
): Heap {
  events.push({ type: "gc", message: "GC開始: Mark & Sweep" });

  // マークフェーズ: スタックからの参照を辿る
  const reachable = new Set<number>();
  for (const frame of stack.frames) {
    for (const v of [...frame.locals, ...frame.args]) {
      if (v.value.heapAddr !== undefined) {
        reachable.add(v.value.heapAddr);
      }
    }
  }

  events.push({
    type: "gc",
    message: `マークフェーズ: ${reachable.size} 個のオブジェクトに到達可能`,
  });

  // スイープフェーズ: 到達不能なブロックを解放
  let swept = 0;
  let freedSize = 0;
  const newBlocks = heap.blocks.map(b => {
    if (b.status === "allocated" && !reachable.has(b.address)) {
      swept++;
      freedSize += b.size;
      return { ...b, status: "freed" as const, refCount: 0, marked: false };
    }
    return { ...b, marked: reachable.has(b.address) };
  });

  events.push({
    type: "gc",
    message: `スイープフェーズ: ${swept} 個のオブジェクト (${freedSize} bytes) を回収`,
  });

  return {
    ...heap,
    blocks: newBlocks,
    totalAllocated: heap.totalAllocated - freedSize,
    fragmentation: calcFragmentation(newBlocks),
  };
}

/** 参照カウントGC */
export function gcRefCount(
  heap: Heap, events: SimEvent[],
): Heap {
  events.push({ type: "gc", message: "GC開始: 参照カウント方式" });

  let freed = 0;
  let freedSize = 0;
  const newBlocks = heap.blocks.map(b => {
    if (b.status === "allocated" && b.refCount <= 0) {
      freed++;
      freedSize += b.size;
      return { ...b, status: "freed" as const };
    }
    return b;
  });

  events.push({
    type: "gc",
    message: `参照カウント=0 のオブジェクト ${freed} 個 (${freedSize} bytes) を回収`,
  });

  return {
    ...heap,
    blocks: newBlocks,
    totalAllocated: heap.totalAllocated - freedSize,
    fragmentation: calcFragmentation(newBlocks),
  };
}

// ─── メモリレイアウト ───

/** メモリレイアウトを構築 */
export function buildLayout(stack: CallStack, heap: Heap): MemoryLayout {
  const segments: MemorySegment[] = [
    { region: "text", startAddr: TEXT_BASE, endAddr: DATA_BASE - 1, label: "テキスト(コード)", used: 256 },
    { region: "data", startAddr: DATA_BASE, endAddr: HEAP_BASE - 1, label: "データ(グローバル変数)", used: 128 },
    {
      region: "heap", startAddr: HEAP_BASE, endAddr: HEAP_BASE + heap.maxSize - 1,
      label: "ヒープ(動的メモリ)", used: heap.totalAllocated,
    },
    {
      region: "free", startAddr: HEAP_BASE + heap.maxSize, endAddr: stack.sp - 1,
      label: "未使用領域", used: 0,
    },
    {
      region: "stack", startAddr: stack.sp, endAddr: STACK_BASE,
      label: "スタック(コールスタック)", used: STACK_BASE - stack.sp,
    },
  ];

  return { segments, totalSize: STACK_BASE - TEXT_BASE };
}

// ─── シミュレーション ───

/** プログラムを実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allSteps: StepResult[] = [];
  const allEvents: SimEvent[] = [];
  let allLeaked: HeapBlock[] = [];
  let allDangling: string[] = [];

  for (const op of ops) {
    const result = executeProgram(op);
    allSteps.push(...result.steps);
    allEvents.push(...result.events);
    allLeaked = [...allLeaked, ...result.leakedBlocks];
    allDangling = [...allDangling, ...result.danglingPointers];
  }

  return { steps: allSteps, events: allEvents, leakedBlocks: allLeaked, danglingPointers: allDangling };
}

/** 単一プログラムを実行 */
export function executeProgram(op: SimOp): SimulationResult {
  let stack = createStack();
  let heap = createHeap();
  const steps: StepResult[] = [];
  const events: SimEvent[] = [];
  const danglingPointers: string[] = [];

  // スタック上の変数名→ヒープアドレスのマッピング
  const varHeapMap = new Map<string, number>();

  events.push({ type: "info", message: `プログラム '${op.programName}' の実行を開始` });

  for (const instr of op.instructions) {
    let message = "";
    let detail: string | undefined;
    let warning: string | undefined;

    switch (instr.op) {
      case "call": {
        stack = pushFrame(stack, instr.functionName, instr.args, events);
        message = `関数 ${instr.functionName}() を呼び出し`;
        detail = instr.args.length > 0
          ? `引数: ${instr.args.map(a => `${a.name}=${a.value.display}`).join(", ")}`
          : "引数なし";
        if (stack.overflow) warning = "スタックオーバーフロー!";
        break;
      }

      case "return": {
        const fname = stack.frames.length > 0 ? stack.frames[stack.frames.length - 1].functionName : "?";
        stack = popFrame(stack, events);
        message = `関数 ${fname}() からリターン`;
        detail = instr.value ? `戻り値: ${instr.value.display}` : undefined;
        break;
      }

      case "local": {
        stack = addLocal(stack, instr.name, instr.value, events);
        message = `ローカル変数 '${instr.name}' を宣言`;
        detail = `型: ${instr.value.type}, 値: ${instr.value.display}, サイズ: ${instr.value.size} bytes`;
        break;
      }

      case "alloc": {
        const { heap: newHeap, address } = heapAlloc(heap, instr.size, instr.label, instr.content, events);
        heap = newHeap;
        if (address > 0) {
          // スタック上にポインタ変数を追加
          const ref = refVal("object", address);
          stack = addLocal(stack, instr.varName, ref, events);
          varHeapMap.set(instr.varName, address);
          message = `ヒープ割当: ${instr.varName} → 0x${address.toString(16)}`;
          detail = `サイズ: ${instr.size} bytes, 内容: ${instr.content}`;
        } else {
          warning = "ヒープ割当失敗";
          message = `ヒープ割当失敗: ${instr.varName}`;
        }
        break;
      }

      case "free": {
        const addr = varHeapMap.get(instr.varName);
        if (addr !== undefined) {
          heap = heapFree(heap, addr, events);
          varHeapMap.delete(instr.varName);
          message = `ヒープ解放: ${instr.varName} (0x${addr.toString(16)})`;
        } else {
          danglingPointers.push(instr.varName);
          events.push({ type: "dangling", message: `ダングリングポインタ: '${instr.varName}' は有効なヒープアドレスを持っていません` });
          warning = "ダングリングポインタ";
          message = `無効な解放: ${instr.varName}`;
        }
        break;
      }

      case "assign": {
        stack = assignVar(stack, instr.varName, instr.value, events);
        // 参照の場合、前の参照カウントを減らし新しい参照カウントを増やす
        if (instr.value.heapAddr !== undefined) {
          varHeapMap.set(instr.varName, instr.value.heapAddr);
        }
        message = `変数 '${instr.varName}' に代入`;
        detail = `値: ${instr.value.display}`;
        break;
      }

      case "gc": {
        if (instr.method === "mark_sweep") {
          heap = gcMarkSweep(stack, heap, events);
        } else {
          heap = gcRefCount(heap, events);
        }
        message = `GC実行: ${instr.method === "mark_sweep" ? "Mark & Sweep" : "参照カウント"}`;
        const freedBlocks = heap.blocks.filter(b => b.status === "freed").length;
        detail = `解放済みブロック: ${freedBlocks}, 断片化率: ${heap.fragmentation}%`;
        break;
      }

      case "comment": {
        message = instr.text;
        events.push({ type: "info", message: instr.text });
        break;
      }
    }

    steps.push({
      instruction: instr,
      stack: structuredClone(stack),
      heap: structuredClone(heap),
      layout: buildLayout(stack, heap),
      message, detail, warning,
    });

    if (stack.overflow) break;
  }

  // メモリリーク検出
  const leakedBlocks = heap.blocks.filter(b => b.status === "allocated");
  if (leakedBlocks.length > 0) {
    const totalLeak = leakedBlocks.reduce((s, b) => s + b.size, 0);
    events.push({
      type: "leak",
      message: `メモリリーク検出: ${leakedBlocks.length} ブロック (${totalLeak} bytes)`,
      detail: leakedBlocks.map(b => `  0x${b.address.toString(16)}: '${b.label}' (${b.size} bytes)`).join("\n"),
    });
  }

  return { steps, events, leakedBlocks, danglingPointers };
}

// ─── スタック使用量 ───

/** スタック使用量を計算 */
export function stackUsage(stack: CallStack): number {
  return STACK_BASE - stack.sp;
}

/** ヒープ使用量を計算 */
export function heapUsage(heap: Heap): number {
  return heap.totalAllocated;
}
