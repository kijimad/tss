/**
 * builder.ts -- クラスファイルビルダー
 *
 * .class ファイルのバイナリをパースする代わりに、
 * TypeScript のコードから直接 ClassFile オブジェクトを構築する。
 * テストやデモ用のクラスを手軽に作るために使う。
 */
import { ConstTag, AccessFlag, type ClassFile, type MethodInfo, type ConstantPoolEntry } from "./types.js";

/**
 * クラスファイルビルダークラス
 *
 * コンスタントプールの構築とメソッドの追加を行い、
 * 最終的にClassFileオブジェクトを生成するビルダー。
 * テストやデモ用のクラスをプログラマティックに作成する際に使用する。
 */
export class ClassBuilder {
  /** クラスの完全修飾名（内部形式: 例 "java/lang/Object"） */
  private className: string;
  /** スーパークラスの完全修飾名 */
  private superName = "java/lang/Object";
  /** コンスタントプール（1-indexed、インデックス0は未使用） */
  private constantPool: (ConstantPoolEntry | undefined)[] = [undefined]; // 1-indexed
  /** メソッド一覧 */
  private methods: MethodInfo[] = [];

  /**
   * @param className - クラスの完全修飾名（内部形式）
   */
  constructor(className: string) {
    this.className = className;
  }

  /**
   * UTF8文字列をコンスタントプールに追加する
   *
   * 同じ値が既に存在する場合は既存のインデックスを返す（重複排除）。
   * @param value - 追加するUTF8文字列
   * @returns コンスタントプール内のインデックス
   */
  addUtf8(value: string): number {
    const idx = this.constantPool.findIndex((e, i) => i > 0 && e !== undefined && e.tag === 1 && e.value === value);
    if (idx >= 0) return idx;
    this.constantPool.push({ tag: ConstTag.Utf8, value });
    return this.constantPool.length - 1;
  }

  /**
   * クラス参照をコンスタントプールに追加する
   * @param name - クラスの完全修飾名（内部形式）
   * @returns コンスタントプール内のインデックス
   */
  addClassRef(name: string): number {
    const nameIdx = this.addUtf8(name);
    this.constantPool.push({ tag: ConstTag.Class, nameIndex: nameIdx });
    return this.constantPool.length - 1;
  }

  /**
   * 文字列定数への参照をコンスタントプールに追加する
   * @param value - 文字列リテラルの値
   * @returns コンスタントプール内のインデックス
   */
  addStringRef(value: string): number {
    const strIdx = this.addUtf8(value);
    this.constantPool.push({ tag: ConstTag.String, stringIndex: strIdx });
    return this.constantPool.length - 1;
  }

  /**
   * メソッド参照をコンスタントプールに追加する
   * @param className - メソッドが属するクラスの完全修飾名
   * @param methodName - メソッド名
   * @param descriptor - メソッドディスクリプタ（例: "(II)I"）
   * @returns コンスタントプール内のインデックス
   */
  addMethodRef(className: string, methodName: string, descriptor: string): number {
    const classIdx = this.addClassRef(className);
    const natIdx = this.addNameAndType(methodName, descriptor);
    this.constantPool.push({ tag: ConstTag.Methodref, classIndex: classIdx, nameAndTypeIndex: natIdx });
    return this.constantPool.length - 1;
  }

  /**
   * フィールド参照をコンスタントプールに追加する
   * @param className - フィールドが属するクラスの完全修飾名
   * @param fieldName - フィールド名
   * @param descriptor - フィールドディスクリプタ（例: "I", "Ljava/lang/String;"）
   * @returns コンスタントプール内のインデックス
   */
  addFieldRef(className: string, fieldName: string, descriptor: string): number {
    const classIdx = this.addClassRef(className);
    const natIdx = this.addNameAndType(fieldName, descriptor);
    this.constantPool.push({ tag: ConstTag.Fieldref, classIndex: classIdx, nameAndTypeIndex: natIdx });
    return this.constantPool.length - 1;
  }

  /**
   * NameAndTypeエントリをコンスタントプールに追加する
   * @param name - メソッド名またはフィールド名
   * @param descriptor - ディスクリプタ文字列
   * @returns コンスタントプール内のインデックス
   */
  addNameAndType(name: string, descriptor: string): number {
    const nameIdx = this.addUtf8(name);
    const descIdx = this.addUtf8(descriptor);
    this.constantPool.push({ tag: ConstTag.NameAndType, nameIndex: nameIdx, descriptorIndex: descIdx });
    return this.constantPool.length - 1;
  }

  /**
   * 整数定数をコンスタントプールに追加する
   * @param value - 整数値
   * @returns コンスタントプール内のインデックス
   */
  addInteger(value: number): number {
    this.constantPool.push({ tag: ConstTag.Integer, value });
    return this.constantPool.length - 1;
  }

  /**
   * メソッドをクラスに追加する
   * @param name - メソッド名
   * @param descriptor - メソッドディスクリプタ
   * @param flags - アクセスフラグ（AccessFlagの組み合わせ）
   * @param maxStack - オペランドスタックの最大深度
   * @param maxLocals - ローカル変数の最大数
   * @param bytecode - バイトコード命令の配列
   */
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

  /**
   * ClassFileオブジェクトを構築して返す
   *
   * これまでに追加したコンスタントプールとメソッドから
   * 完全なClassFileオブジェクトを生成する。
   * @returns 構築されたClassFileオブジェクト
   */
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

/**
 * 符号なし16ビット値を上位・下位バイトに分割する
 *
 * バイトコード中のコンスタントプールインデックス等、
 * 2バイトの値をビッグエンディアンで表現する際に使用する。
 * @param index - 分割する符号なし16ビット値
 * @returns [上位バイト, 下位バイト] のタプル
 */
export function u16(index: number): [number, number] {
  return [(index >> 8) & 0xff, index & 0xff];
}

/**
 * 符号付き16ビットオフセットを上位・下位バイトに分割する
 *
 * 分岐命令のジャンプオフセットなど、符号付きの
 * 16ビット値をビッグエンディアンで表現する際に使用する。
 * @param offset - 分割する符号付き16ビットオフセット
 * @returns [上位バイト, 下位バイト] のタプル
 */
export function s16(offset: number): [number, number] {
  const v = offset & 0xffff;
  return [(v >> 8) & 0xff, v & 0xff];
}
