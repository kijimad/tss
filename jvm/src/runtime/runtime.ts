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

/**
 * JVMの値を表す型
 *
 * JVMのスタックやローカル変数に格納される全ての値の共用体型。
 * プリミティブ型（int, long, float, double）、文字列、
 * オブジェクト参照、配列参照、nullを含む。
 */
export type JvmValue = number | bigint | string | JvmObject | JvmArray | null;

/**
 * ヒープ上のオブジェクトインスタンスを表すインターフェース
 *
 * クラス名とフィールドのマップを保持する。
 * new命令で生成され、getfield/putfieldでフィールドにアクセスする。
 */
export interface JvmObject {
  type: "object";
  className: string;
  fields: Map<string, JvmValue>;
}

/**
 * 配列インスタンスを表すインターフェース
 *
 * newarray命令で生成され、iaload/iastore等でアクセスする。
 */
export interface JvmArray {
  type: "array";
  elementType: string;
  elements: JvmValue[];
}

/**
 * スタックフレームインターフェース
 *
 * メソッド呼び出しごとにコールスタックに積まれる実行コンテキスト。
 * プログラムカウンタ、ローカル変数テーブル、オペランドスタックを持つ。
 */
export interface Frame {
  classFile: ClassFile;
  method: MethodInfo;
  pc: number;                    // プログラムカウンタ（バイトコード内のオフセット）
  localVariables: JvmValue[];    // ローカル変数テーブル
  operandStack: JvmValue[];      // オペランドスタック
}

/**
 * 実行トレース用イベントの型定義
 *
 * インタプリタの実行過程を可視化するためのイベント。
 * UI側でリアルタイムに実行状況を表示するために使用する。
 */
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

/**
 * JVMランタイムクラス
 *
 * クラスのロード、メソッド呼び出し、スタック操作、
 * コンスタントプール解決など、JVM実行環境の中核を担う。
 * インタプリタ（interpreter.ts）がこのランタイムを操作して
 * バイトコードを実行する。
 */
export class JvmRuntime {
  /** ロードされたクラスの名前→ClassFileマップ */
  readonly classes = new Map<string, ClassFile>();
  /** コールスタック（フレームの配列、末尾が現在のフレーム） */
  readonly callStack: Frame[] = [];
  /** 標準出力バッファ（System.out.printlnの出力先） */
  stdout = "";
  /** 実行トレースイベントの記録 */
  events: JvmEvent[] = [];
  /** イベント発生時のコールバック関数 */
  onEvent: ((event: JvmEvent) => void) | undefined;
  /** 累計実行サイクル数 */
  cycles = 0;

  /**
   * イベントを記録し、コールバックに通知する
   * @param event - 発生したイベント
   */
  emit(event: JvmEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  /**
   * クラスファイルをランタイムにロードする
   * @param classFile - ロードするクラスファイル
   */
  loadClass(classFile: ClassFile): void {
    this.classes.set(classFile.thisClass, classFile);
  }

  /**
   * 指定されたクラスからメソッドを検索する
   * @param className - クラスの完全修飾名
   * @param methodName - メソッド名
   * @param descriptor - メソッドディスクリプタ
   * @returns クラスファイルとメソッド情報のペア、見つからない場合undefined
   */
  findMethod(className: string, methodName: string, descriptor: string): { classFile: ClassFile; method: MethodInfo } | undefined {
    const cf = this.classes.get(className);
    if (cf === undefined) return undefined;
    const method = cf.methods.find(m => m.name === methodName && m.descriptor === descriptor);
    if (method === undefined) return undefined;
    return { classFile: cf, method };
  }

  /**
   * メソッドを呼び出す（新しいフレームを作成しコールスタックに積む）
   *
   * 引数をローカル変数テーブルにコピーし、
   * 新しいスタックフレームを生成してコールスタックにプッシュする。
   *
   * @param classFile - メソッドが属するクラスファイル
   * @param method - 呼び出すメソッド情報
   * @param args - メソッドに渡す引数の配列
   */
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

  /**
   * 現在実行中のフレーム（コールスタックの先頭）を取得する
   * @returns 現在のフレーム、コールスタックが空の場合undefined
   */
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
