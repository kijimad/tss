/**
 * types.ts — TypeScript 型の内部表現
 */

/** 型ノードの種類 */
export type TypeNode =
  | { kind: "primitive"; name: string }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "object"; properties: PropertyDef[] }
  | { kind: "array"; element: TypeNode }
  | { kind: "tuple"; elements: TypeNode[] }
  | { kind: "union"; members: TypeNode[] }
  | { kind: "intersection"; members: TypeNode[] }
  | { kind: "conditional"; check: TypeNode; extendsType: TypeNode; trueType: TypeNode; falseType: TypeNode }
  | { kind: "mapped"; keyName: string; constraint: TypeNode; valueType: TypeNode; optional?: "+" | "-" | "preserve"; readonly?: "+" | "-" | "preserve" }
  | { kind: "keyof"; target: TypeNode }
  | { kind: "indexed"; object: TypeNode; index: TypeNode }
  | { kind: "generic"; name: string; args: TypeNode[] }
  | { kind: "ref"; name: string }
  | { kind: "function"; params: { name: string; type: TypeNode }[]; returnType: TypeNode }
  | { kind: "infer"; name: string }
  | { kind: "template"; parts: (string | TypeNode)[] }
  | { kind: "never" }
  | { kind: "unknown" }
  | { kind: "any" }
  | { kind: "void" }
  | { kind: "null" }
  | { kind: "undefined" };

/** オブジェクトのプロパティ定義 */
export interface PropertyDef {
  name: string;
  type: TypeNode;
  optional: boolean;
  readonly: boolean;
}

/** 型定義 (type Foo = ... / interface Foo { ... }) */
export interface TypeDef {
  name: string;
  params: string[];
  body: TypeNode;
}

/** 解決ステップ */
export interface ResolutionStep {
  label: string;
  type: TypeNode;
}

/** 解析結果 */
export interface AnalysisResult {
  definitions: TypeDef[];
  /** 最後に定義された型（またはターゲット型）の解決ステップ */
  target: string;
  steps: ResolutionStep[];
}

/** 型ノードを文字列に変換（表示用） */
export function typeToString(t: TypeNode, depth = 0): string {
  switch (t.kind) {
    case "primitive":  return t.name;
    case "literal":    return typeof t.value === "string" ? `"${t.value}"` : String(t.value);
    case "never":      return "never";
    case "unknown":    return "unknown";
    case "any":        return "any";
    case "void":       return "void";
    case "null":       return "null";
    case "undefined":  return "undefined";
    case "ref":        return t.name;
    case "infer":      return `infer ${t.name}`;
    case "array":      return `${typeToString(t.element)}[]`;
    case "tuple":      return `[${t.elements.map((e) => typeToString(e)).join(", ")}]`;
    case "union":      return t.members.map((m) => typeToString(m)).join(" | ");
    case "intersection": return t.members.map((m) => typeToString(m)).join(" & ");
    case "keyof":      return `keyof ${typeToString(t.target)}`;
    case "indexed":    return `${typeToString(t.object)}[${typeToString(t.index)}]`;
    case "generic":    return `${t.name}<${t.args.map((a) => typeToString(a)).join(", ")}>`;
    case "function": {
      const params = t.params.map((p) => `${p.name}: ${typeToString(p.type)}`).join(", ");
      return `(${params}) => ${typeToString(t.returnType)}`;
    }
    case "conditional":
      return `${typeToString(t.check)} extends ${typeToString(t.extendsType)} ? ${typeToString(t.trueType)} : ${typeToString(t.falseType)}`;
    case "mapped": {
      const opt = t.optional === "+" ? "?" : t.optional === "-" ? "-?" : "";
      const ro = t.readonly === "+" ? "readonly " : t.readonly === "-" ? "-readonly " : "";
      return `{ ${ro}[${t.keyName} in ${typeToString(t.constraint)}]${opt}: ${typeToString(t.valueType)} }`;
    }
    case "object": {
      if (t.properties.length === 0) return "{}";
      if (depth > 2) return "{ ... }";
      const props = t.properties.map((p) => {
        const ro = p.readonly ? "readonly " : "";
        const opt = p.optional ? "?" : "";
        return `${ro}${p.name}${opt}: ${typeToString(p.type, depth + 1)}`;
      });
      return `{ ${props.join("; ")} }`;
    }
    case "template": {
      const inner = t.parts.map((p) => typeof p === "string" ? p : `\${${typeToString(p)}}`).join("");
      return `\`${inner}\``;
    }
  }
}
