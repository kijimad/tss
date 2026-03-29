/**
 * vm.ts -- V8 仮想マシン (Ignition インタプリタ相当)
 *
 * バイトコードを1命令ずつ実行する。
 * アキュムレータ + レジスタファイル + スタック のハイブリッドアーキテクチャ。
 *
 * メモリモデル:
 *   ヒープ: オブジェクト、配列、クロージャ → GC 対象
 *   スタック: フレーム(レジスタ + PC) → 関数呼び出しごとに積む
 */
import { Op, OP_NAMES, type CompiledFunction, type Instruction } from "../compiler/bytecode.js";

// JS値
export type JsValue = number | string | boolean | null | undefined | JsObject | JsArray | JsClosure | JsNativeFunction;

export interface JsObject { kind: "object"; properties: Map<string, JsValue>; }
export interface JsArray { kind: "array"; elements: JsValue[]; }
export interface JsClosure { kind: "closure"; func: CompiledFunction; capturedScope: Map<string, JsValue>; }
export interface JsNativeFunction { kind: "native"; name: string; fn: (...args: JsValue[]) => JsValue; }

// スタックフレーム
interface Frame {
  func: CompiledFunction;
  pc: number;
  registers: JsValue[];
  accumulator: JsValue;
  stack: JsValue[];     // 引数渡し用
}

// ヒープオブジェクト（GC 追跡用）
interface HeapEntry {
  value: JsObject | JsArray | JsClosure;
  marked: boolean;
  size: number;
}

// VM イベント
export type VmEvent =
  | { type: "exec"; pc: number; op: string; detail: string }
  | { type: "push_frame"; func: string }
  | { type: "pop_frame"; func: string }
  | { type: "gc_start"; heapSize: number; objectCount: number }
  | { type: "gc_mark"; marked: number }
  | { type: "gc_sweep"; freed: number; remaining: number }
  | { type: "heap_alloc"; kind: string; size: number }
  | { type: "stdout"; text: string };

export class VM {
  // グローバルスコープ
  private globals = new Map<string, JsValue>();
  // コールスタック
  private callStack: Frame[] = [];
  // ヒープ
  private heap: HeapEntry[] = [];
  private heapSize = 0;
  private gcThreshold = 50000; // バイト
  // 出力
  stdout = "";
  // トレース
  events: VmEvent[] = [];
  onEvent: ((event: VmEvent) => void) | undefined;
  cycles = 0;

  private emit(event: VmEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  constructor() {
    this.installBuiltins();
  }

  // 組み込み関数を登録
  private installBuiltins(): void {
    // console.log
    const consoleObj: JsObject = {
      kind: "object",
      properties: new Map([
        ["log", this.native("console.log", (...args) => {
          const text = args.map(a => this.formatValue(a)).join(" ") + "\n";
          this.stdout += text;
          this.emit({ type: "stdout", text });
          return undefined;
        })],
      ]),
    };
    this.globals.set("console", consoleObj);

    // Math
    const mathObj: JsObject = {
      kind: "object",
      properties: new Map([
        ["floor", this.native("Math.floor", (x) => Math.floor(toNumber(x)))],
        ["ceil", this.native("Math.ceil", (x) => Math.ceil(toNumber(x)))],
        ["round", this.native("Math.round", (x) => Math.round(toNumber(x)))],
        ["random", this.native("Math.random", () => Math.random())],
        ["max", this.native("Math.max", (...args) => Math.max(...args.map(toNumber)))],
        ["min", this.native("Math.min", (...args) => Math.min(...args.map(toNumber)))],
        ["PI", Math.PI],
        ["abs", this.native("Math.abs", (x) => Math.abs(toNumber(x)))],
      ]),
    };
    this.globals.set("Math", mathObj);
    this.globals.set("parseInt", this.native("parseInt", (s) => parseInt(String(s ?? ""), 10)));
    this.globals.set("String", this.native("String", (v) => this.formatValue(v)));
    this.globals.set("Number", this.native("Number", (v) => toNumber(v)));
    this.globals.set("Array", this.native("Array", (...args) => {
      const arr: JsArray = { kind: "array", elements: [...args] };
      this.heapAlloc(arr, args.length * 8);
      return arr;
    }));
    this.globals.set("typeof", undefined); // typeof は演算子として処理
  }

  private native(name: string, fn: (...args: JsValue[]) => JsValue): JsNativeFunction {
    return { kind: "native", name, fn };
  }

  // メイン関数を実行
  execute(func: CompiledFunction, maxCycles = 10000): void {
    this.stdout = "";
    this.events = [];
    this.cycles = 0;
    this.pushFrame(func, []);
    while (this.callStack.length > 0 && this.cycles < maxCycles) {
      this.step();
    }
  }

  // 1命令実行
  step(): boolean {
    const frame = this.callStack[this.callStack.length - 1];
    if (frame === undefined) return false;

    const instr = frame.func.instructions[frame.pc];
    if (instr === undefined) { this.popFrame(undefined); return this.callStack.length > 0; }

    const opName = OP_NAMES[instr.op] ?? `0x${instr.op.toString(16)}`;
    frame.pc++;
    this.cycles++;

    switch (instr.op) {
      // 定数ロード
      case Op.LdaConst: frame.accumulator = frame.func.constants[instr.operands[0] ?? 0] as JsValue; break;
      case Op.LdaUndefined: frame.accumulator = undefined; break;
      case Op.LdaNull: frame.accumulator = null; break;
      case Op.LdaTrue: frame.accumulator = true; break;
      case Op.LdaFalse: frame.accumulator = false; break;
      case Op.LdaZero: frame.accumulator = 0; break;
      case Op.LdaSmi: frame.accumulator = instr.operands[0] ?? 0; break;

      // レジスタ
      case Op.Ldar: frame.accumulator = frame.registers[instr.operands[0] ?? 0]; break;
      case Op.Star: frame.registers[instr.operands[0] ?? 0] = frame.accumulator; break;

      // グローバル
      case Op.LdaGlobal: {
        const name = frame.func.constants[instr.operands[0] ?? 0];
        frame.accumulator = this.globals.get(String(name ?? ""));
        break;
      }
      case Op.StaGlobal: {
        const name = frame.func.constants[instr.operands[0] ?? 0];
        this.globals.set(String(name ?? ""), frame.accumulator);
        break;
      }

      // プロパティ
      case Op.LdaProperty: {
        const obj = frame.registers[instr.operands[0] ?? 0];
        const propName = String(frame.func.constants[instr.operands[1] ?? 0] ?? "");
        if (obj !== null && obj !== undefined && typeof obj === "object" && "kind" in obj && obj.kind === "object") {
          frame.accumulator = obj.properties.get(propName);
        } else if (obj !== null && obj !== undefined && typeof obj === "object" && "kind" in obj && obj.kind === "array") {
          if (propName === "length") frame.accumulator = obj.elements.length;
          else if (propName === "push") frame.accumulator = this.native("Array.push", (...args) => { obj.elements.push(...args); return obj.elements.length; });
          else frame.accumulator = obj.elements[Number(propName)];
        } else {
          frame.accumulator = undefined;
        }
        break;
      }

      // 算術
      case Op.Add: {
        const right = frame.registers[instr.operands[0] ?? 0];
        const left = frame.accumulator;
        if (typeof left === "string" || typeof right === "string") {
          frame.accumulator = String(left ?? "") + String(right ?? "");
        } else {
          frame.accumulator = toNumber(left) + toNumber(right);
        }
        break;
      }
      case Op.Sub: frame.accumulator = toNumber(frame.accumulator) - toNumber(frame.registers[instr.operands[0] ?? 0]); break;
      case Op.Mul: frame.accumulator = toNumber(frame.accumulator) * toNumber(frame.registers[instr.operands[0] ?? 0]); break;
      case Op.Div: { const d = toNumber(frame.registers[instr.operands[0] ?? 0]); frame.accumulator = d !== 0 ? toNumber(frame.accumulator) / d : NaN; break; }
      case Op.Mod: { const d = toNumber(frame.registers[instr.operands[0] ?? 0]); frame.accumulator = d !== 0 ? toNumber(frame.accumulator) % d : NaN; break; }

      // 比較
      case Op.CmpEq: frame.accumulator = frame.accumulator == frame.registers[instr.operands[0] ?? 0]; break;
      case Op.CmpStrictEq: frame.accumulator = frame.accumulator === frame.registers[instr.operands[0] ?? 0]; break;
      case Op.CmpLt: frame.accumulator = toNumber(frame.accumulator) < toNumber(frame.registers[instr.operands[0] ?? 0]); break;
      case Op.CmpGt: frame.accumulator = toNumber(frame.accumulator) > toNumber(frame.registers[instr.operands[0] ?? 0]); break;
      case Op.CmpLtEq: frame.accumulator = toNumber(frame.accumulator) <= toNumber(frame.registers[instr.operands[0] ?? 0]); break;
      case Op.CmpGtEq: frame.accumulator = toNumber(frame.accumulator) >= toNumber(frame.registers[instr.operands[0] ?? 0]); break;

      // 論理
      case Op.LogNot: frame.accumulator = !toBool(frame.accumulator); break;

      // 分岐
      case Op.Jump: frame.pc = instr.operands[0] ?? 0; break;
      case Op.JumpIfTrue: if (toBool(frame.accumulator)) frame.pc = instr.operands[0] ?? 0; break;
      case Op.JumpIfFalse: if (!toBool(frame.accumulator)) frame.pc = instr.operands[0] ?? 0; break;

      // スタック
      case Op.Push: frame.stack.push(frame.accumulator); break;
      case Op.Pop: frame.accumulator = frame.stack.pop(); break;

      // 関数呼び出し
      case Op.Call: {
        const argCount = instr.operands[1] ?? 0;
        const callee = frame.accumulator;
        const args: JsValue[] = [];
        for (let i = 0; i < argCount; i++) args.unshift(frame.stack.pop());

        if (callee !== null && callee !== undefined && typeof callee === "object" && "kind" in callee) {
          if (callee.kind === "native") {
            frame.accumulator = callee.fn(...args);
          } else if (callee.kind === "closure") {
            this.pushFrame(callee.func, args, callee.capturedScope);
          }
        } else {
          frame.accumulator = undefined;
        }
        break;
      }

      // Return
      case Op.Return: {
        const retVal = frame.accumulator;
        this.popFrame(retVal);
        break;
      }

      // クロージャ作成
      case Op.CreateClosure: {
        const funcDef = frame.func.constants[instr.operands[0] ?? 0] as CompiledFunction;
        const captured = new Map<string, JsValue>(this.globals);
        // ローカル変数もキャプチャ
        for (const [name, reg] of frame.func.localNames.entries()) {
          captured.set(reg, frame.registers[name]);
        }
        const closure: JsClosure = { kind: "closure", func: funcDef, capturedScope: captured };
        this.heapAlloc(closure, 100);
        frame.accumulator = closure;
        break;
      }

      // 配列作成
      case Op.CreateArray: {
        const count = instr.operands[0] ?? 0;
        const elements: JsValue[] = [];
        for (let i = 0; i < count; i++) elements.unshift(frame.stack.pop());
        const arr: JsArray = { kind: "array", elements };
        this.heapAlloc(arr, count * 8);
        frame.accumulator = arr;
        break;
      }

      // オブジェクト作成
      case Op.CreateObject: {
        const count = instr.operands[0] ?? 0;
        const properties = new Map<string, JsValue>();
        for (let i = 0; i < count; i++) {
          const value = frame.stack.pop();
          const key = frame.stack.pop();
          properties.set(String(key ?? ""), value);
        }
        const obj: JsObject = { kind: "object", properties };
        this.heapAlloc(obj, count * 16);
        frame.accumulator = obj;
        break;
      }
    }

    this.emit({ type: "exec", pc: frame.pc - 1, op: opName, detail: `acc=${this.formatValueShort(frame.accumulator)}` });

    // GC チェック
    if (this.heapSize > this.gcThreshold) this.gc();

    return this.callStack.length > 0;
  }

  private pushFrame(func: CompiledFunction, args: JsValue[], scope?: Map<string, JsValue>): void {
    const registers: JsValue[] = new Array(func.maxRegisters).fill(undefined);
    // 引数をレジスタにセット
    for (let i = 0; i < func.params.length; i++) {
      registers[i] = args[i];
    }
    // スコープの変数を復元
    if (scope !== undefined) {
      for (let i = 0; i < func.localNames.length; i++) {
        const name = func.localNames[i];
        if (name !== undefined && scope.has(name) && i >= func.params.length) {
          registers[i] = scope.get(name);
        }
      }
    }
    this.callStack.push({ func, pc: 0, registers, accumulator: undefined, stack: [] });
    this.emit({ type: "push_frame", func: func.name });
  }

  private popFrame(retVal: JsValue): void {
    const popped = this.callStack.pop();
    this.emit({ type: "pop_frame", func: popped?.func.name ?? "?" });
    const caller = this.callStack[this.callStack.length - 1];
    if (caller !== undefined) {
      caller.accumulator = retVal;
    }
  }

  // === ヒープ + GC ===

  private heapAlloc(value: JsObject | JsArray | JsClosure, size: number): void {
    this.heap.push({ value, marked: false, size });
    this.heapSize += size;
    this.emit({ type: "heap_alloc", kind: value.kind, size });
  }

  private gc(): void {
    this.emit({ type: "gc_start", heapSize: this.heapSize, objectCount: this.heap.length });

    // Mark: スタックとグローバルから到達可能なオブジェクトをマーク
    for (const entry of this.heap) entry.marked = false;

    const markValue = (val: JsValue) => {
      if (val === null || val === undefined || typeof val !== "object") return;
      if (!("kind" in val)) return;
      const entry = this.heap.find(e => e.value === val);
      if (entry === undefined || entry.marked) return;
      entry.marked = true;
      if (val.kind === "object") for (const v of val.properties.values()) markValue(v);
      if (val.kind === "array") for (const v of val.elements) markValue(v);
    };

    for (const v of this.globals.values()) markValue(v);
    for (const frame of this.callStack) {
      markValue(frame.accumulator);
      for (const r of frame.registers) markValue(r);
      for (const s of frame.stack) markValue(s);
    }

    const marked = this.heap.filter(e => e.marked).length;
    this.emit({ type: "gc_mark", marked });

    // Sweep: マークされていないオブジェクトを解放
    const before = this.heap.length;
    const kept: HeapEntry[] = [];
    let freedSize = 0;
    for (const entry of this.heap) {
      if (entry.marked) { kept.push(entry); }
      else { freedSize += entry.size; }
    }
    this.heap = kept;
    this.heapSize -= freedSize;
    this.emit({ type: "gc_sweep", freed: before - kept.length, remaining: kept.length });
  }

  formatValue(val: JsValue): string {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "object" && "kind" in val) {
      if (val.kind === "array") return `[${val.elements.map(v => this.formatValue(v)).join(", ")}]`;
      if (val.kind === "object") {
        const entries = [...val.properties.entries()].map(([k, v]) => `${k}: ${this.formatValue(v)}`);
        return `{ ${entries.join(", ")} }`;
      }
      if (val.kind === "closure") return `[Function: ${val.func.name}]`;
      if (val.kind === "native") return `[Native: ${val.name}]`;
    }
    return String(val);
  }

  private formatValueShort(val: JsValue): string {
    if (val === undefined) return "undefined";
    if (val === null) return "null";
    if (typeof val === "string") return val.length > 20 ? `"${val.slice(0, 20)}..."` : `"${val}"`;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "object" && "kind" in val) return `[${val.kind}]`;
    return "?";
  }

  getHeapInfo(): { objectCount: number; totalSize: number } {
    return { objectCount: this.heap.length, totalSize: this.heapSize };
  }

  getCallStackInfo(): { name: string; pc: number; accum: string }[] {
    return this.callStack.map(f => ({
      name: f.func.name, pc: f.pc,
      accum: this.formatValueShort(f.accumulator),
    }));
  }
}

function toNumber(v: JsValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

function toBool(v: JsValue): boolean {
  if (v === null || v === undefined || v === 0 || v === "" || v === false) return false;
  return true;
}
