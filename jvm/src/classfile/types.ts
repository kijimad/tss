/**
 * types.ts -- JVM クラスファイルの型定義
 *
 * .class ファイルのバイナリ構造を TypeScript で表現する。
 * 参考: JVM Specification Chapter 4 "The class File Format"
 *
 * クラスファイル構造:
 *   magic (0xCAFEBABE)
 *   version
 *   constant_pool    ← 文字列、数値、クラス名、メソッド名等の定数テーブル
 *   access_flags
 *   this_class / super_class
 *   interfaces
 *   fields
 *   methods           ← バイトコードはここに含まれる
 *   attributes
 */

// コンスタントプールのタグ
export const ConstTag = {
  Utf8: 1,
  Integer: 3,
  Float: 4,
  Long: 5,
  Double: 6,
  Class: 7,
  String: 8,
  Fieldref: 9,
  Methodref: 10,
  InterfaceMethodref: 11,
  NameAndType: 12,
} as const;

// コンスタントプールエントリ
export type ConstantPoolEntry =
  | { tag: 1; value: string }                                    // Utf8
  | { tag: 3; value: number }                                    // Integer
  | { tag: 4; value: number }                                    // Float
  | { tag: 5; value: bigint }                                    // Long
  | { tag: 6; value: number }                                    // Double
  | { tag: 7; nameIndex: number }                                // Class
  | { tag: 8; stringIndex: number }                              // String
  | { tag: 9; classIndex: number; nameAndTypeIndex: number }     // Fieldref
  | { tag: 10; classIndex: number; nameAndTypeIndex: number }    // Methodref
  | { tag: 11; classIndex: number; nameAndTypeIndex: number }    // InterfaceMethodref
  | { tag: 12; nameIndex: number; descriptorIndex: number };     // NameAndType

// メソッド情報
export interface MethodInfo {
  accessFlags: number;
  name: string;
  descriptor: string;    // "(II)I" = int method(int, int)
  code: CodeAttribute | undefined;
}

// Code 属性 (バイトコード本体)
export interface CodeAttribute {
  maxStack: number;
  maxLocals: number;
  bytecode: Uint8Array;
}

// フィールド情報
export interface FieldInfo {
  accessFlags: number;
  name: string;
  descriptor: string;
}

// パースされたクラスファイル
export interface ClassFile {
  majorVersion: number;
  minorVersion: number;
  constantPool: (ConstantPoolEntry | undefined)[];  // 1-indexed (0は未使用)
  accessFlags: number;
  thisClass: string;
  superClass: string;
  interfaces: string[];
  fields: FieldInfo[];
  methods: MethodInfo[];
}

// アクセスフラグ
export const AccessFlag = {
  Public: 0x0001,
  Private: 0x0002,
  Protected: 0x0004,
  Static: 0x0008,
  Final: 0x0010,
  Super: 0x0020,
  Abstract: 0x0400,
} as const;

// JVM バイトコード命令
export const OpCode = {
  // 定数ロード
  nop: 0x00,
  aconst_null: 0x01,
  iconst_m1: 0x02,
  iconst_0: 0x03,
  iconst_1: 0x04,
  iconst_2: 0x05,
  iconst_3: 0x06,
  iconst_4: 0x07,
  iconst_5: 0x08,
  lconst_0: 0x09,
  lconst_1: 0x0a,
  fconst_0: 0x0b,
  fconst_1: 0x0c,
  dconst_0: 0x0e,
  dconst_1: 0x0f,
  bipush: 0x10,      // byte を push
  sipush: 0x11,      // short を push
  ldc: 0x12,         // コンスタントプールからロード

  // ローカル変数ロード
  iload: 0x15,
  lload: 0x16,
  aload: 0x19,
  iload_0: 0x1a,
  iload_1: 0x1b,
  iload_2: 0x1c,
  iload_3: 0x1d,
  aload_0: 0x2a,
  aload_1: 0x2b,
  aload_2: 0x2c,

  // ローカル変数ストア
  istore: 0x36,
  astore: 0x3a,
  istore_0: 0x3b,
  istore_1: 0x3c,
  istore_2: 0x3d,
  istore_3: 0x3e,
  astore_0: 0x4b,
  astore_1: 0x4c,

  // スタック操作
  pop: 0x57,
  dup: 0x59,
  swap: 0x5f,

  // 算術演算
  iadd: 0x60,
  ladd: 0x61,
  isub: 0x64,
  imul: 0x68,
  idiv: 0x6c,
  irem: 0x70,
  ineg: 0x74,
  ishl: 0x78,
  ishr: 0x7a,
  iand: 0x7e,
  ior: 0x80,
  ixor: 0x82,
  iinc: 0x84,        // ローカル変数をインクリメント

  // 型変換
  i2l: 0x85,
  i2f: 0x86,
  i2d: 0x87,
  l2i: 0x88,
  i2b: 0x91,
  i2c: 0x92,
  i2s: 0x93,

  // 比較・分岐
  lcmp: 0x94,
  ifeq: 0x99,
  ifne: 0x9a,
  iflt: 0x9b,
  ifge: 0x9c,
  ifgt: 0x9d,
  ifle: 0x9e,
  if_icmpeq: 0x9f,
  if_icmpne: 0xa0,
  if_icmplt: 0xa1,
  if_icmpge: 0xa2,
  if_icmpgt: 0xa3,
  if_icmple: 0xa4,
  if_acmpeq: 0xa5,
  if_acmpne: 0xa6,
  goto: 0xa7,
  ifnull: 0xc6,
  ifnonnull: 0xc7,

  // メソッド呼び出し・復帰
  ireturn: 0xac,
  lreturn: 0xad,
  areturn: 0xb0,
  return: 0xb1,
  getstatic: 0xb2,
  putstatic: 0xb3,
  getfield: 0xb4,
  putfield: 0xb5,
  invokevirtual: 0xb6,
  invokespecial: 0xb7,
  invokestatic: 0xb8,

  // オブジェクト
  new: 0xbb,

  // 配列
  newarray: 0xbc,
  arraylength: 0xbe,
  iaload: 0x2e,
  iastore: 0x4f,
  aaload: 0x32,
  aastore: 0x53,
} as const;

// オペコード名のマップ
export const OP_NAMES: Record<number, string | undefined> = {};
for (const [name, code] of Object.entries(OpCode)) {
  (OP_NAMES)[code] = name;
}
