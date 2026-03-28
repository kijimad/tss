/**
 * builder.ts -- クラスファイルビルダー
 *
 * .class ファイルのバイナリをパースする代わりに、
 * TypeScript のコードから直接 ClassFile オブジェクトを構築する。
 * テストやデモ用のクラスを手軽に作るために使う。
 */
import { ConstTag, AccessFlag, type ClassFile, type MethodInfo, type ConstantPoolEntry } from "./types.js";

export class ClassBuilder {
  private className: string;
  private superName = "java/lang/Object";
  private constantPool: (ConstantPoolEntry | undefined)[] = [undefined]; // 1-indexed
  private methods: MethodInfo[] = [];

  constructor(className: string) {
    this.className = className;
  }

  // コンスタントプールにエントリを追加し、インデックスを返す
  addUtf8(value: string): number {
    const idx = this.constantPool.findIndex((e, i) => i > 0 && e !== undefined && e.tag === 1 && e.value === value);
    if (idx >= 0) return idx;
    this.constantPool.push({ tag: ConstTag.Utf8, value });
    return this.constantPool.length - 1;
  }

  addClassRef(name: string): number {
    const nameIdx = this.addUtf8(name);
    this.constantPool.push({ tag: ConstTag.Class, nameIndex: nameIdx });
    return this.constantPool.length - 1;
  }

  addStringRef(value: string): number {
    const strIdx = this.addUtf8(value);
    this.constantPool.push({ tag: ConstTag.String, stringIndex: strIdx });
    return this.constantPool.length - 1;
  }

  addMethodRef(className: string, methodName: string, descriptor: string): number {
    const classIdx = this.addClassRef(className);
    const natIdx = this.addNameAndType(methodName, descriptor);
    this.constantPool.push({ tag: ConstTag.Methodref, classIndex: classIdx, nameAndTypeIndex: natIdx });
    return this.constantPool.length - 1;
  }

  addFieldRef(className: string, fieldName: string, descriptor: string): number {
    const classIdx = this.addClassRef(className);
    const natIdx = this.addNameAndType(fieldName, descriptor);
    this.constantPool.push({ tag: ConstTag.Fieldref, classIndex: classIdx, nameAndTypeIndex: natIdx });
    return this.constantPool.length - 1;
  }

  addNameAndType(name: string, descriptor: string): number {
    const nameIdx = this.addUtf8(name);
    const descIdx = this.addUtf8(descriptor);
    this.constantPool.push({ tag: ConstTag.NameAndType, nameIndex: nameIdx, descriptorIndex: descIdx });
    return this.constantPool.length - 1;
  }

  addInteger(value: number): number {
    this.constantPool.push({ tag: ConstTag.Integer, value });
    return this.constantPool.length - 1;
  }

  // メソッドを追加
  addMethod(name: string, descriptor: string, flags: number, maxStack: number, maxLocals: number, bytecode: number[]): void {
    this.methods.push({
      accessFlags: flags,
      name,
      descriptor,
      code: {
        maxStack,
        maxLocals,
        bytecode: new Uint8Array(bytecode),
      },
    });
  }

  build(): ClassFile {
    return {
      majorVersion: 52,
      minorVersion: 0,
      constantPool: this.constantPool,
      accessFlags: AccessFlag.Public | AccessFlag.Super,
      thisClass: this.className,
      superClass: this.superName,
      interfaces: [],
      fields: [],
      methods: this.methods,
    };
  }
}

// バイトコードヘルパー: 2バイトインデックスを分割
export function u16(index: number): [number, number] {
  return [(index >> 8) & 0xff, index & 0xff];
}

// 符号付き16ビットオフセットを分割
export function s16(offset: number): [number, number] {
  const v = offset & 0xffff;
  return [(v >> 8) & 0xff, v & 0xff];
}
