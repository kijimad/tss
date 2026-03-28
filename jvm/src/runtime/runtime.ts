/**
 * runtime.ts -- JVM ランタイムデータ領域
 *
 * JVM はスタックマシン。各メソッド呼び出しで「フレーム」がスタックに積まれる。
 *
 * フレームの構成:
 *   ┌─────────────────────┐
 *   │ オペランドスタック     │ ← バイトコード命令がここにプッシュ/ポップ
 *   ├─────────────────────┤
 *   │ ローカル変数テーブル   │ ← 引数とローカル変数
 *   ├─────────────────────┤
 *   │ PC (プログラムカウンタ) │
 *   │ 呼び出し元メソッド情報  │
 *   └─────────────────────┘
 *
 * OS の CPU がレジスタマシンだったのに対し、JVM はスタックマシン。
 * 「レジスタに入れる」代わりに「スタックに積む」。
 */
import type { ClassFile, MethodInfo, ConstantPoolEntry } from "../classfile/types.js";
import { ConstTag } from "../classfile/types.js";

// JVM の値
export type JvmValue = number | bigint | string | JvmObject | JvmArray | null;

// オブジェクト（ヒープ上）
export interface JvmObject {
  type: "object";
  className: string;
  fields: Map<string, JvmValue>;
}

// 配列
export interface JvmArray {
  type: "array";
  elementType: string;
  elements: JvmValue[];
}

// スタックフレーム
export interface Frame {
  classFile: ClassFile;
  method: MethodInfo;
  pc: number;                    // プログラムカウンタ（バイトコード内のオフセット）
  localVariables: JvmValue[];    // ローカル変数テーブル
  operandStack: JvmValue[];      // オペランドスタック
}

// 実行トレース用イベント
export type JvmEvent =
  | { type: "push"; value: string; stackDepth: number }
  | { type: "pop"; value: string; stackDepth: number }
  | { type: "exec"; pc: number; opName: string; detail: string }
  | { type: "invoke"; className: string; methodName: string; descriptor: string }
  | { type: "return"; value: string }
  | { type: "stdout"; text: string }
  | { type: "branch"; target: number; taken: boolean }
  | { type: "local_set"; index: number; value: string }
  | { type: "local_get"; index: number; value: string };

// JVM ランタイム
export class JvmRuntime {
  // ロードされたクラス
  readonly classes = new Map<string, ClassFile>();
  // コールスタック（フレームの配列）
  readonly callStack: Frame[] = [];
  // 標準出力バッファ
  stdout = "";
  // 実行イベント
  events: JvmEvent[] = [];
  // イベントコールバック
  onEvent: ((event: JvmEvent) => void) | undefined;
  // 実行サイクル数
  cycles = 0;

  emit(event: JvmEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  // クラスをロード
  loadClass(classFile: ClassFile): void {
    this.classes.set(classFile.thisClass, classFile);
  }

  // メソッドを検索
  findMethod(className: string, methodName: string, descriptor: string): { classFile: ClassFile; method: MethodInfo } | undefined {
    const cf = this.classes.get(className);
    if (cf === undefined) return undefined;
    const method = cf.methods.find(m => m.name === methodName && m.descriptor === descriptor);
    if (method === undefined) return undefined;
    return { classFile: cf, method };
  }

  // メソッドを呼び出し（フレームを作ってスタックに積む）
  invokeMethod(classFile: ClassFile, method: MethodInfo, args: JvmValue[]): void {
    if (method.code === undefined) return;

    this.emit({ type: "invoke", className: classFile.thisClass, methodName: method.name, descriptor: method.descriptor });

    const locals: JvmValue[] = new Array(method.code.maxLocals).fill(null);
    // 引数をローカル変数にコピー
    for (let i = 0; i < args.length; i++) {
      locals[i] = args[i] ?? null;
    }

    const frame: Frame = {
      classFile,
      method,
      pc: 0,
      localVariables: locals,
      operandStack: [],
    };
    this.callStack.push(frame);
  }

  // 現在のフレーム
  currentFrame(): Frame | undefined {
    return this.callStack[this.callStack.length - 1];
  }

  // オペランドスタック操作
  push(frame: Frame, value: JvmValue): void {
    frame.operandStack.push(value);
    this.emit({ type: "push", value: this.valueToString(value), stackDepth: frame.operandStack.length });
  }

  pop(frame: Frame): JvmValue {
    const value = frame.operandStack.pop() ?? null;
    this.emit({ type: "pop", value: this.valueToString(value), stackDepth: frame.operandStack.length });
    return value;
  }

  // ローカル変数操作
  getLocal(frame: Frame, index: number): JvmValue {
    const value = frame.localVariables[index] ?? null;
    this.emit({ type: "local_get", index, value: this.valueToString(value) });
    return value;
  }

  setLocal(frame: Frame, index: number, value: JvmValue): void {
    frame.localVariables[index] = value;
    this.emit({ type: "local_set", index, value: this.valueToString(value) });
  }

  // コンスタントプール解決
  resolveConstant(cf: ClassFile, index: number): ConstantPoolEntry | undefined {
    return cf.constantPool[index];
  }

  resolveUtf8(cf: ClassFile, index: number): string {
    const entry = cf.constantPool[index];
    if (entry !== undefined && entry.tag === ConstTag.Utf8) return entry.value;
    return "";
  }

  resolveClassName(cf: ClassFile, index: number): string {
    const entry = cf.constantPool[index];
    if (entry !== undefined && entry.tag === ConstTag.Class) {
      return this.resolveUtf8(cf, entry.nameIndex);
    }
    return "";
  }

  resolveMethodRef(cf: ClassFile, index: number): { className: string; methodName: string; descriptor: string } | undefined {
    const entry = cf.constantPool[index];
    if (entry === undefined || (entry.tag !== ConstTag.Methodref && entry.tag !== ConstTag.InterfaceMethodref)) return undefined;
    const className = this.resolveClassName(cf, entry.classIndex);
    const nat = cf.constantPool[entry.nameAndTypeIndex];
    if (nat === undefined || nat.tag !== ConstTag.NameAndType) return undefined;
    const methodName = this.resolveUtf8(cf, nat.nameIndex);
    const descriptor = this.resolveUtf8(cf, nat.descriptorIndex);
    return { className, methodName, descriptor };
  }

  resolveFieldRef(cf: ClassFile, index: number): { className: string; fieldName: string; descriptor: string } | undefined {
    const entry = cf.constantPool[index];
    if (entry === undefined || entry.tag !== ConstTag.Fieldref) return undefined;
    const className = this.resolveClassName(cf, entry.classIndex);
    const nat = cf.constantPool[entry.nameAndTypeIndex];
    if (nat === undefined || nat.tag !== ConstTag.NameAndType) return undefined;
    const fieldName = this.resolveUtf8(cf, nat.nameIndex);
    const descriptor = this.resolveUtf8(cf, nat.descriptorIndex);
    return { className, fieldName, descriptor };
  }

  resolveString(cf: ClassFile, index: number): string {
    const entry = cf.constantPool[index];
    if (entry !== undefined && entry.tag === ConstTag.String) {
      return this.resolveUtf8(cf, entry.stringIndex);
    }
    if (entry !== undefined && entry.tag === ConstTag.Integer) {
      return String(entry.value);
    }
    return "";
  }

  // 標準出力に書き込み
  printStdout(text: string): void {
    this.stdout += text;
    this.emit({ type: "stdout", text });
  }

  // 値を文字列化
  valueToString(value: JvmValue): string {
    if (value === null) return "null";
    if (typeof value === "number") return String(value);
    if (typeof value === "bigint") return `${String(value)}L`;
    if (typeof value === "string") return `"${value}"`;
    if (typeof value === "object" && "type" in value) {
      if (value.type === "object") return `${value.className}@obj`;
      if (value.type === "array") return `${value.elementType}[${String(value.elements.length)}]`;
    }
    return "?";
  }

  // リセット
  reset(): void {
    this.callStack.length = 0;
    this.stdout = "";
    this.events = [];
    this.cycles = 0;
  }
}
