/** Prisma スキーマ言語パーサー */

import type { Attribute, AttributeArg, Field, FieldType, Model, Relation, Schema } from "./types.js";

/** スカラー型の一覧 */
const SCALAR_TYPES = new Set(["String", "Int", "Float", "Boolean", "DateTime"]);

/** パースエラー */
export class SchemaParseError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`スキーマパースエラー (行 ${line}): ${message}`);
    this.name = "SchemaParseError";
  }
}

/** アトリビュート引数をパースする */
function parseAttributeArgs(argsStr: string): AttributeArg[] {
  if (!argsStr.trim()) return [];

  const args: AttributeArg[] = [];
  let depth = 0;
  let current = "";

  /** カンマ区切りで引数を分割（括弧のネストを考慮） */
  for (const ch of argsStr) {
    if (ch === "(" || ch === "[") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      args.push(parseSingleArg(current.trim()));
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    args.push(parseSingleArg(current.trim()));
  }

  return args;
}

/** 単一の引数をパースする */
function parseSingleArg(arg: string): AttributeArg {
  const colonIdx = arg.indexOf(":");
  if (colonIdx !== -1) {
    /** 名前付き引数（例: fields: [authorId]） */
    return {
      name: arg.slice(0, colonIdx).trim(),
      value: arg.slice(colonIdx + 1).trim(),
    };
  }
  return { value: arg };
}

/** アトリビュートをパースする */
function parseAttributes(tokens: string[]): Attribute[] {
  const attributes: Attribute[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token?.startsWith("@")) continue;

    const attrStr = token.slice(1);
    /** 括弧付きアトリビュートの処理 */
    const parenIdx = attrStr.indexOf("(");

    if (parenIdx === -1) {
      attributes.push({ name: attrStr, args: [] });
    } else {
      /** 括弧の中身を結合して取得 */
      let fullStr = attrStr;
      let depth = 0;
      for (const ch of fullStr) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
      }

      /** 括弧が閉じていない場合、次のトークンを結合 */
      while (depth > 0 && i + 1 < tokens.length) {
        i++;
        const nextToken = tokens[i];
        if (nextToken) {
          fullStr += " " + nextToken;
          for (const ch of nextToken) {
            if (ch === "(") depth++;
            if (ch === ")") depth--;
          }
        }
      }

      const fullParenIdx = fullStr.indexOf("(");
      const name = fullStr.slice(0, fullParenIdx);
      const argsStr = fullStr.slice(fullParenIdx + 1, fullStr.lastIndexOf(")"));
      attributes.push({ name, args: parseAttributeArgs(argsStr) });
    }
  }

  return attributes;
}

/** フィールド型をパースする */
function parseFieldType(typeStr: string): FieldType {
  let name = typeStr;
  let isList = false;
  let isOptional = false;

  if (name.endsWith("[]")) {
    isList = true;
    name = name.slice(0, -2);
  } else if (name.endsWith("?")) {
    isOptional = true;
    name = name.slice(0, -1);
  }

  return {
    name,
    isScalar: SCALAR_TYPES.has(name),
    isList,
    isOptional,
  };
}

/** リレーション情報を抽出する */
function extractRelation(fieldType: FieldType, attributes: Attribute[]): Relation | undefined {
  if (fieldType.isScalar) return undefined;

  const relationAttr = attributes.find((a) => a.name === "relation");
  const relation: Relation = { model: fieldType.name };

  if (relationAttr) {
    /** リレーションアトリビュートの引数を処理 */
    for (const arg of relationAttr.args) {
      if (arg.name === "fields") {
        relation.fields = parseArrayArg(arg.value);
      } else if (arg.name === "references") {
        relation.references = parseArrayArg(arg.value);
      } else if (!arg.name) {
        relation.name = arg.value.replace(/"/g, "");
      }
    }
  }

  return relation;
}

/** 配列引数をパースする（例: [authorId, postId] → ["authorId", "postId"]） */
function parseArrayArg(value: string): string[] {
  const inner = value.replace(/^\[/, "").replace(/\]$/, "");
  return inner.split(",").map((s) => s.trim()).filter(Boolean);
}

/** フィールド行をパースする */
function parseField(line: string, lineNum: number): Field {
  /** アトリビュート内の空白を保持しつつトークン分割するために前処理 */
  const tokens: string[] = [];
  let current = "";
  let depth = 0;

  for (const ch of line) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;

    if ((ch === " " || ch === "\t") && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  if (tokens.length < 2) {
    throw new SchemaParseError(`フィールド定義が不正です: "${line}"`, lineNum);
  }

  const name = tokens[0]!;
  const typeStr = tokens[1]!;
  const fieldType = parseFieldType(typeStr);
  const attrTokens = tokens.slice(2);
  const attributes = parseAttributes(attrTokens);
  const relation = extractRelation(fieldType, attributes);

  return { name, type: fieldType, attributes, relation };
}

/** Prisma スキーマ文字列をパースして AST を返す */
export function parseSchema(input: string): Schema {
  const lines = input.split("\n");
  const models: Model[] = [];
  let currentModel: Model | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    const lineNum = i + 1;

    /** 空行・コメント行をスキップ */
    if (!line || line.startsWith("//")) continue;

    /** モデル定義の開始 */
    const modelMatch = line.match(/^model\s+(\w+)\s*\{$/);
    if (modelMatch) {
      const modelName = modelMatch[1]!;
      currentModel = { name: modelName, fields: [] };
      braceDepth = 1;
      continue;
    }

    /** ブロックの終了 */
    if (line === "}" && currentModel) {
      braceDepth--;
      if (braceDepth === 0) {
        models.push(currentModel);
        currentModel = null;
      }
      continue;
    }

    /** モデル内のフィールド定義 */
    if (currentModel && braceDepth > 0) {
      const field = parseField(line, lineNum);
      currentModel.fields.push(field);
    }
  }

  if (currentModel) {
    throw new SchemaParseError("モデル定義が閉じられていません", lines.length);
  }

  return { models };
}
