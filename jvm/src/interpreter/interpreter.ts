/**
 * interpreter.ts -- JVM バイトコードインタプリタ
 *
 * フェッチ → デコード → 実行 のサイクルでバイトコードを1命令ずつ実行する。
 * OS の CPU エミュレータと同じ構造だが、レジスタマシンではなくスタックマシン。
 *
 *   レジスタマシン (OS の CPU):  ADD R0, R1     → R0 = R0 + R1
 *   スタックマシン (JVM):        iload_0; iload_1; iadd; → push(pop() + pop())
 */
import { OpCode, OP_NAMES, ConstTag } from "../classfile/types.js";
import type { JvmRuntime, JvmValue, Frame, JvmObject, JvmArray } from "../runtime/runtime.js";

/**
 * バイトコードを1命令だけ実行する
 *
 * フェッチ→デコード→実行のサイクルを1回行う。
 * 現在のフレームのプログラムカウンタが指す命令を読み取り、
 * 対応する処理を実行してPCを進める。
 *
 * @param rt - JVMランタイムインスタンス
 * @returns 実行を継続できる場合true、終了した場合false
 */
export function step(rt: JvmRuntime): boolean {
  const frame = rt.currentFrame();
  if (frame === undefined) return false;
  if (frame.method.code === undefined) return false;

  const code = frame.method.code.bytecode;
  if (frame.pc >= code.length) {
    rt.callStack.pop();
    return rt.callStack.length > 0;
  }

  const pc = frame.pc;
  const op = code[pc] ?? 0;
  const opName = OP_NAMES[op] ?? `0x${op.toString(16)}`;

  rt.cycles++;

  // ヘルパー: バイトコードから値を読む
  const readU8 = (): number => { const v = code[frame.pc] ?? 0; frame.pc++; return v; };
  const readU16 = (): number => { const hi = readU8(); const lo = readU8(); return (hi << 8) | lo; };
  const readS16 = (): number => { const v = readU16(); return v >= 0x8000 ? v - 0x10000 : v; };

  frame.pc++;

  switch (op) {
    // === 定数ロード ===
    case OpCode.nop: break;
    case OpCode.aconst_null: rt.push(frame, null); break;
    case OpCode.iconst_m1: rt.push(frame, -1); break;
    case OpCode.iconst_0: rt.push(frame, 0); break;
    case OpCode.iconst_1: rt.push(frame, 1); break;
    case OpCode.iconst_2: rt.push(frame, 2); break;
    case OpCode.iconst_3: rt.push(frame, 3); break;
    case OpCode.iconst_4: rt.push(frame, 4); break;
    case OpCode.iconst_5: rt.push(frame, 5); break;
    case OpCode.lconst_0: rt.push(frame, 0n); break;
    case OpCode.lconst_1: rt.push(frame, 1n); break;
    case OpCode.fconst_0: rt.push(frame, 0.0); break;
    case OpCode.fconst_1: rt.push(frame, 1.0); break;
    case OpCode.dconst_0: rt.push(frame, 0.0); break;
    case OpCode.dconst_1: rt.push(frame, 1.0); break;
    case OpCode.bipush: rt.push(frame, readU8()); break;
    case OpCode.sipush: rt.push(frame, readS16()); break;
    case OpCode.ldc: {
      const idx = readU8();
      const entry = rt.resolveConstant(frame.classFile, idx);
      if (entry !== undefined) {
        if (entry.tag === ConstTag.Integer || entry.tag === ConstTag.Float) {
          rt.push(frame, entry.value);
        } else if (entry.tag === ConstTag.String) {
          rt.push(frame, rt.resolveUtf8(frame.classFile, entry.stringIndex));
        }
      }
      break;
    }

    // === ローカル変数ロード ===
    case OpCode.iload: case OpCode.aload: rt.push(frame, rt.getLocal(frame, readU8())); break;
    case OpCode.iload_0: case OpCode.aload_0: rt.push(frame, rt.getLocal(frame, 0)); break;
    case OpCode.iload_1: case OpCode.aload_1: rt.push(frame, rt.getLocal(frame, 1)); break;
    case OpCode.iload_2: case OpCode.aload_2: rt.push(frame, rt.getLocal(frame, 2)); break;
    case OpCode.iload_3: rt.push(frame, rt.getLocal(frame, 3)); break;

    // === ローカル変数ストア ===
    case OpCode.istore: case OpCode.astore: rt.setLocal(frame, readU8(), rt.pop(frame)); break;
    case OpCode.istore_0: case OpCode.astore_0: rt.setLocal(frame, 0, rt.pop(frame)); break;
    case OpCode.istore_1: case OpCode.astore_1: rt.setLocal(frame, 1, rt.pop(frame)); break;
    case OpCode.istore_2: rt.setLocal(frame, 2, rt.pop(frame)); break;
    case OpCode.istore_3: rt.setLocal(frame, 3, rt.pop(frame)); break;

    // === スタック操作 ===
    case OpCode.pop: rt.pop(frame); break;
    case OpCode.dup: {
      const v = rt.pop(frame);
      rt.push(frame, v);
      rt.push(frame, v);
      break;
    }
    case OpCode.swap: {
      const a = rt.pop(frame);
      const b = rt.pop(frame);
      rt.push(frame, a);
      rt.push(frame, b);
      break;
    }

    // === 算術演算 ===
    case OpCode.iadd: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, (a + b) | 0); break; }
    case OpCode.isub: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, (a - b) | 0); break; }
    case OpCode.imul: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, Math.imul(a, b)); break; }
    case OpCode.idiv: {
      const b = toInt(rt.pop(frame));
      const a = toInt(rt.pop(frame));
      if (b === 0) throw new Error("ArithmeticException: / by zero");
      rt.push(frame, (a / b) | 0);
      break;
    }
    case OpCode.irem: {
      const b = toInt(rt.pop(frame));
      const a = toInt(rt.pop(frame));
      if (b === 0) throw new Error("ArithmeticException: / by zero");
      rt.push(frame, a % b);
      break;
    }
    case OpCode.ineg: rt.push(frame, -toInt(rt.pop(frame))); break;
    case OpCode.ishl: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, (a << b) | 0); break; }
    case OpCode.ishr: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, (a >> b) | 0); break; }
    case OpCode.iand: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, a & b); break; }
    case OpCode.ior: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, a | b); break; }
    case OpCode.ixor: { const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); rt.push(frame, a ^ b); break; }
    case OpCode.iinc: {
      const idx = readU8();
      const inc = readU8();
      const signedInc = inc >= 128 ? inc - 256 : inc;
      rt.setLocal(frame, idx, toInt(rt.getLocal(frame, idx)) + signedInc);
      break;
    }
    case OpCode.ladd: { const b = toBigInt(rt.pop(frame)); const a = toBigInt(rt.pop(frame)); rt.push(frame, a + b); break; }

    // === 型変換 ===
    case OpCode.i2l: rt.push(frame, BigInt(toInt(rt.pop(frame)))); break;
    case OpCode.i2f: case OpCode.i2d: break; // number のまま
    case OpCode.l2i: rt.push(frame, Number(toBigInt(rt.pop(frame))) | 0); break;
    case OpCode.i2b: rt.push(frame, (toInt(rt.pop(frame)) << 24) >> 24); break;
    case OpCode.i2c: rt.push(frame, toInt(rt.pop(frame)) & 0xffff); break;
    case OpCode.i2s: rt.push(frame, (toInt(rt.pop(frame)) << 16) >> 16); break;

    // === 比較・分岐 ===
    case OpCode.ifeq: { const offset = readS16(); const v = toInt(rt.pop(frame)); if (v === 0) frame.pc = pc + offset; break; }
    case OpCode.ifne: { const offset = readS16(); const v = toInt(rt.pop(frame)); if (v !== 0) frame.pc = pc + offset; break; }
    case OpCode.iflt: { const offset = readS16(); const v = toInt(rt.pop(frame)); if (v < 0) frame.pc = pc + offset; break; }
    case OpCode.ifge: { const offset = readS16(); const v = toInt(rt.pop(frame)); if (v >= 0) frame.pc = pc + offset; break; }
    case OpCode.ifgt: { const offset = readS16(); const v = toInt(rt.pop(frame)); if (v > 0) frame.pc = pc + offset; break; }
    case OpCode.ifle: { const offset = readS16(); const v = toInt(rt.pop(frame)); if (v <= 0) frame.pc = pc + offset; break; }
    case OpCode.if_icmpeq: { const offset = readS16(); const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); if (a === b) frame.pc = pc + offset; break; }
    case OpCode.if_icmpne: { const offset = readS16(); const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); if (a !== b) frame.pc = pc + offset; break; }
    case OpCode.if_icmplt: { const offset = readS16(); const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); if (a < b) frame.pc = pc + offset; break; }
    case OpCode.if_icmpge: { const offset = readS16(); const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); if (a >= b) frame.pc = pc + offset; break; }
    case OpCode.if_icmpgt: { const offset = readS16(); const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); if (a > b) frame.pc = pc + offset; break; }
    case OpCode.if_icmple: { const offset = readS16(); const b = toInt(rt.pop(frame)); const a = toInt(rt.pop(frame)); if (a <= b) frame.pc = pc + offset; break; }
    case OpCode.goto: { const offset = readS16(); frame.pc = pc + offset; break; }
    case OpCode.ifnull: { const offset = readS16(); if (rt.pop(frame) === null) frame.pc = pc + offset; break; }
    case OpCode.ifnonnull: { const offset = readS16(); if (rt.pop(frame) !== null) frame.pc = pc + offset; break; }

    // === メソッド呼び出し ===
    case OpCode.invokevirtual:
    case OpCode.invokespecial:
    case OpCode.invokestatic: {
      const idx = readU16();
      const ref = rt.resolveMethodRef(frame.classFile, idx);
      if (ref === undefined) break;

      // 組み込みメソッドを処理
      if (handleBuiltin(rt, frame, ref.className, ref.methodName, ref.descriptor)) break;

      // ユーザ定義メソッドを呼び出し
      const target = rt.findMethod(ref.className, ref.methodName, ref.descriptor);
      if (target === undefined) break;

      // 引数を収集
      const argCount = countParams(ref.descriptor);
      const args: JvmValue[] = [];
      for (let i = 0; i < argCount; i++) args.unshift(rt.pop(frame));
      // invokevirtual/invokespecial: this も引数に含める
      if (op !== OpCode.invokestatic) args.unshift(rt.pop(frame));

      rt.invokeMethod(target.classFile, target.method, args);
      break;
    }

    // === 復帰 ===
    case OpCode.return: {
      rt.callStack.pop();
      rt.emit({ type: "return", value: "void" });
      break;
    }
    case OpCode.ireturn: case OpCode.lreturn: case OpCode.areturn: {
      const retVal = rt.pop(frame);
      rt.callStack.pop();
      const caller = rt.currentFrame();
      if (caller !== undefined) rt.push(caller, retVal);
      rt.emit({ type: "return", value: rt.valueToString(retVal) });
      break;
    }

    // === フィールドアクセス ===
    case OpCode.getstatic: {
      readU16();
      // System.out 等の静的フィールド → ダミー値
      rt.push(frame, null);
      break;
    }
    case OpCode.putstatic: {
      readU16();
      rt.pop(frame);
      break;
    }
    case OpCode.getfield: {
      const idx = readU16();
      const ref = rt.resolveFieldRef(frame.classFile, idx);
      const obj = rt.pop(frame);
      if (obj !== null && typeof obj === "object" && "type" in obj && obj.type === "object") {
        rt.push(frame, obj.fields.get(ref?.fieldName ?? "") ?? null);
      } else {
        rt.push(frame, null);
      }
      break;
    }
    case OpCode.putfield: {
      const idx = readU16();
      const ref = rt.resolveFieldRef(frame.classFile, idx);
      const value = rt.pop(frame);
      const obj = rt.pop(frame);
      if (obj !== null && typeof obj === "object" && "type" in obj && obj.type === "object") {
        obj.fields.set(ref?.fieldName ?? "", value);
      }
      break;
    }

    // === オブジェクト ===
    case OpCode.new: {
      const idx = readU16();
      const className = rt.resolveClassName(frame.classFile, idx);
      const obj: JvmObject = { type: "object", className, fields: new Map() };
      rt.push(frame, obj);
      break;
    }

    // === 配列 ===
    case OpCode.newarray: {
      const atype = readU8();
      const count = toInt(rt.pop(frame));
      const elements: JvmValue[] = new Array(count).fill(0);
      const typeNames: Record<number, string | undefined> = { 4: "boolean", 5: "char", 6: "float", 7: "double", 8: "byte", 9: "short", 10: "int", 11: "long" };
      const arr: JvmArray = { type: "array", elementType: typeNames[atype] ?? "int", elements };
      rt.push(frame, arr);
      break;
    }
    case OpCode.arraylength: {
      const arr = rt.pop(frame);
      if (arr !== null && typeof arr === "object" && "type" in arr && arr.type === "array") {
        rt.push(frame, arr.elements.length);
      } else {
        throw new Error("NullPointerException: arraylength");
      }
      break;
    }
    case OpCode.iaload: case OpCode.aaload: {
      const idx = toInt(rt.pop(frame));
      const arr = rt.pop(frame);
      if (arr !== null && typeof arr === "object" && "type" in arr && arr.type === "array") {
        rt.push(frame, arr.elements[idx] ?? null);
      } else {
        throw new Error("NullPointerException");
      }
      break;
    }
    case OpCode.iastore: case OpCode.aastore: {
      const val = rt.pop(frame);
      const idx = toInt(rt.pop(frame));
      const arr = rt.pop(frame);
      if (arr !== null && typeof arr === "object" && "type" in arr && arr.type === "array") {
        arr.elements[idx] = val;
      }
      break;
    }

    default:
      rt.emit({ type: "exec", pc, opName: `UNKNOWN:0x${op.toString(16)}`, detail: "" });
  }

  rt.emit({ type: "exec", pc, opName, detail: `stack=[${frame.operandStack.map(v => rt.valueToString(v)).join(", ")}]` });

  return rt.callStack.length > 0;
}

/**
 * 組み込みメソッドを処理する
 *
 * System.out.println、StringBuilder、String.valueOf など、
 * JVMの標準ライブラリメソッドをネイティブに実装する。
 * 対象メソッドが組み込みとして処理された場合trueを返す。
 *
 * @param rt - JVMランタイムインスタンス
 * @param frame - 現在のスタックフレーム
 * @param className - 呼び出し先クラス名
 * @param methodName - 呼び出し先メソッド名
 * @param descriptor - メソッドディスクリプタ
 * @returns 組み込みとして処理できた場合true
 */
function handleBuiltin(rt: JvmRuntime, frame: Frame, className: string, methodName: string, descriptor: string): boolean {
  // System.out.println (スタック: [this, arg] → this=System.out(null), arg=表示する値)
  if (className === "java/io/PrintStream" && methodName === "println") {
    const arg = rt.pop(frame);   // 引数
    rt.pop(frame);               // this (System.out)
    rt.printStdout(rt.valueToString(arg).replace(/^"|"$/g, "") + "\n");
    return true;
  }
  if (className === "java/io/PrintStream" && methodName === "print") {
    const arg = rt.pop(frame);
    rt.pop(frame);               // this
    rt.printStdout(rt.valueToString(arg).replace(/^"|"$/g, ""));
    return true;
  }
  // StringBuilder
  if (className === "java/lang/StringBuilder") {
    if (methodName === "<init>") { rt.pop(frame); return true; } // this を消費
    if (methodName === "append") {
      const arg = rt.pop(frame);
      const sb = rt.pop(frame);
      if (sb !== null && typeof sb === "object" && "type" in sb && sb.type === "object") {
        const current = sb.fields.get("value") ?? "";
        sb.fields.set("value", String(current) + rt.valueToString(arg).replace(/^"|"$/g, ""));
      }
      rt.push(frame, sb); // メソッドチェーンのために自身を返す
      return true;
    }
    if (methodName === "toString") {
      const sb = rt.pop(frame);
      if (sb !== null && typeof sb === "object" && "type" in sb && sb.type === "object") {
        rt.push(frame, String(sb.fields.get("value") ?? ""));
      } else {
        rt.push(frame, "");
      }
      return true;
    }
  }
  // String.valueOf
  if (className === "java/lang/String" && methodName === "valueOf") {
    const arg = rt.pop(frame);
    rt.push(frame, rt.valueToString(arg).replace(/^"|"$/g, ""));
    return true;
  }
  // Object.<init>
  if (methodName === "<init>" && className === "java/lang/Object") {
    rt.pop(frame); // this
    return true;
  }
  return false;
}

/**
 * メソッドディスクリプタから引数の数を計算する
 *
 * ディスクリプタ文字列（例: "(ILjava/lang/String;)V"）を解析し、
 * パラメータの個数を返す。オブジェクト型はセミコロンまで、
 * 配列型は次元を含めて1引数としてカウントする。
 *
 * @param descriptor - メソッドディスクリプタ文字列
 * @returns 引数の個数
 */
function countParams(descriptor: string): number {
  let count = 0;
  let i = 1; // '(' の次から
  while (i < descriptor.length && descriptor[i] !== ')') {
    const ch = descriptor[i];
    if (ch === 'L') {
      // オブジェクト型: ; まで読む
      while (i < descriptor.length && descriptor[i] !== ';') i++;
      i++;
      count++;
    } else if (ch === '[') {
      i++; // 配列の次元は1引数
    } else {
      i++;
      count++;
    }
  }
  return count;
}

/**
 * JVM値を32ビット整数に変換する
 * @param v - 変換元のJVM値
 * @returns 32ビット整数値（ビットOR 0で切り捨て）
 */
function toInt(v: JvmValue): number {
  if (typeof v === "number") return v | 0;
  if (typeof v === "bigint") return Number(v) | 0;
  return 0;
}

/**
 * JVM値をBigInt（long型相当）に変換する
 * @param v - 変換元のJVM値
 * @returns BigInt値
 */
function toBigInt(v: JvmValue): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return 0n;
}

/**
 * 複数サイクルを連続実行する
 *
 * 指定された最大サイクル数まで、またはプログラムが終了するまで
 * step()を繰り返し呼び出す。無限ループ防止のため上限を設ける。
 *
 * @param rt - JVMランタイムインスタンス
 * @param maxCycles - 最大実行サイクル数（デフォルト: 10000）
 */
export function run(rt: JvmRuntime, maxCycles = 10000): void {
  let executed = 0;
  while (executed < maxCycles && step(rt)) {
    executed++;
  }
}
