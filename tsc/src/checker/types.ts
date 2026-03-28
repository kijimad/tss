/**
 * types.ts -- 型チェッカーの内部型表現
 *
 * TypeScript の型をチェッカー内部で扱うための表現。
 * AST の TypeNode (構文上の型) とは別に、
 * 型推論や比較のために正規化された型を定義する。
 */

// 内部型 (discriminated union)
export type Type =
  | { kind: "primitive"; name: "number" | "string" | "boolean" | "void" | "null" | "undefined" | "any" | "never" }
  | { kind: "array"; elementType: Type }
  | { kind: "union"; types: Type[] }
  | { kind: "function"; params: FuncParam[]; returnType: Type }
  | { kind: "object"; properties: Map<string, Type> }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "unknown" };  // 型が判定できない場合

export interface FuncParam {
  name: string;
  type: Type;
  optional: boolean;
}

// 組み込みプリミティブ型のショートカット
export const NUMBER: Type = { kind: "primitive", name: "number" };
export const STRING: Type = { kind: "primitive", name: "string" };
export const BOOLEAN: Type = { kind: "primitive", name: "boolean" };
export const VOID: Type = { kind: "primitive", name: "void" };
export const NULL_TYPE: Type = { kind: "primitive", name: "null" };
export const UNDEFINED: Type = { kind: "primitive", name: "undefined" };
export const ANY: Type = { kind: "primitive", name: "any" };
export const NEVER: Type = { kind: "primitive", name: "never" };
export const UNKNOWN: Type = { kind: "unknown" };

// 型を人間が読める文字列に変換
export function typeToString(type: Type): string {
  switch (type.kind) {
    case "primitive": return type.name;
    case "array": return `${typeToString(type.elementType)}[]`;
    case "union": return type.types.map(t => typeToString(t)).join(" | ");
    case "function": {
      const params = type.params.map(p => `${p.name}: ${typeToString(p.type)}`).join(", ");
      return `(${params}) => ${typeToString(type.returnType)}`;
    }
    case "object": {
      const props = [...type.properties.entries()].map(([k, v]) => `${k}: ${typeToString(v)}`).join("; ");
      return `{ ${props} }`;
    }
    case "literal": {
      if (typeof type.value === "string") return `"${type.value}"`;
      return String(type.value);
    }
    case "unknown": return "unknown";
  }
}

// 型Aが型Bに代入可能か判定
export function isAssignableTo(source: Type, target: Type): boolean {
  // any はどこにでも代入可能、any にはどこからでも代入可能
  if (source.kind === "primitive" && source.name === "any") return true;
  if (target.kind === "primitive" && target.name === "any") return true;

  // unknown は使う時に判定不要
  if (source.kind === "unknown" || target.kind === "unknown") return true;

  // never は全ての型に代入可能（空の型）
  if (source.kind === "primitive" && source.name === "never") return true;

  // 同じプリミティブ
  if (source.kind === "primitive" && target.kind === "primitive") {
    return source.name === target.name;
  }

  // リテラル型 → プリミティブ (例: "hello" は string に代入可能)
  if (source.kind === "literal" && target.kind === "primitive") {
    if (typeof source.value === "number" && target.name === "number") return true;
    if (typeof source.value === "string" && target.name === "string") return true;
    if (typeof source.value === "boolean" && target.name === "boolean") return true;
    return false;
  }

  // リテラル同士
  if (source.kind === "literal" && target.kind === "literal") {
    return source.value === target.value;
  }

  // 配列
  if (source.kind === "array" && target.kind === "array") {
    return isAssignableTo(source.elementType, target.elementType);
  }

  // union: source の全メンバーが target に代入可能
  if (source.kind === "union") {
    return source.types.every(t => isAssignableTo(t, target));
  }
  // target が union: source が union のいずれかに代入可能
  if (target.kind === "union") {
    return target.types.some(t => isAssignableTo(source, t));
  }

  // 関数
  if (source.kind === "function" && target.kind === "function") {
    // 引数は反変（target の引数が source の引数に代入可能）
    if (source.params.length < target.params.length) return false;
    for (let i = 0; i < target.params.length; i++) {
      const sp = source.params[i];
      const tp = target.params[i];
      if (sp === undefined || tp === undefined) return false;
      if (!isAssignableTo(tp.type, sp.type)) return false;
    }
    // 戻り値は共変
    return isAssignableTo(source.returnType, target.returnType);
  }

  // オブジェクト（構造的部分型: source が target の全プロパティを持っていればOK）
  if (source.kind === "object" && target.kind === "object") {
    for (const [key, targetType] of target.properties) {
      const sourceType = source.properties.get(key);
      if (sourceType === undefined) return false;
      if (!isAssignableTo(sourceType, targetType)) return false;
    }
    return true;
  }

  // null → void / undefined
  if (source.kind === "primitive" && source.name === "null") {
    if (target.kind === "primitive" && (target.name === "void" || target.name === "undefined")) return true;
  }

  return false;
}
