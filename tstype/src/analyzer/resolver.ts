/**
 * resolver.ts — 型の解決エンジン
 *
 * 型定義を受け取り、ステップごとに型を展開・評価して
 * 最終的な具体型を得る。
 */

import type { TypeNode, TypeDef, PropertyDef, ResolutionStep, AnalysisResult } from "./types.js";
import { typeToString } from "./types.js";

/** 組み込みユーティリティ型の定義 */
const BUILTIN_UTILITIES: Record<string, (args: TypeNode[], ctx: ResolverContext) => { steps: ResolutionStep[]; result: TypeNode }> = {
  Partial: (args, ctx) => {
    const [target] = args;
    if (target === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(target);
    if (resolved.kind !== "object") return { steps: [], result: resolved };
    const result: TypeNode = {
      kind: "object",
      properties: resolved.properties.map((p) => ({ ...p, optional: true })),
    };
    return {
      steps: [
        { label: "マップ型に展開", type: { kind: "mapped", keyName: "K", constraint: { kind: "keyof", target }, valueType: { kind: "indexed", object: target, index: { kind: "ref", name: "K" } }, optional: "+" } },
        { label: "全プロパティを optional に", type: result },
      ],
      result,
    };
  },

  Required: (args, ctx) => {
    const [target] = args;
    if (target === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(target);
    if (resolved.kind !== "object") return { steps: [], result: resolved };
    const result: TypeNode = {
      kind: "object",
      properties: resolved.properties.map((p) => ({ ...p, optional: false })),
    };
    return {
      steps: [
        { label: "マップ型に展開", type: { kind: "mapped", keyName: "K", constraint: { kind: "keyof", target }, valueType: { kind: "indexed", object: target, index: { kind: "ref", name: "K" } }, optional: "-" } },
        { label: "全プロパティを必須に", type: result },
      ],
      result,
    };
  },

  Readonly: (args, ctx) => {
    const [target] = args;
    if (target === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(target);
    if (resolved.kind !== "object") return { steps: [], result: resolved };
    const result: TypeNode = {
      kind: "object",
      properties: resolved.properties.map((p) => ({ ...p, readonly: true })),
    };
    return {
      steps: [
        { label: "全プロパティを readonly に", type: result },
      ],
      result,
    };
  },

  Pick: (args, ctx) => {
    const [target, keys] = args;
    if (target === undefined || keys === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(target);
    if (resolved.kind !== "object") return { steps: [], result: resolved };
    const keyNames = extractUnionLiterals(keys);
    const result: TypeNode = {
      kind: "object",
      properties: resolved.properties.filter((p) => keyNames.includes(p.name)),
    };
    return {
      steps: [
        { label: `キー ${keyNames.map((k) => `"${k}"`).join(" | ")} を抽出`, type: { kind: "mapped", keyName: "K", constraint: keys, valueType: { kind: "indexed", object: target, index: { kind: "ref", name: "K" } } } },
        { label: "該当プロパティのみ残す", type: result },
      ],
      result,
    };
  },

  Omit: (args, ctx) => {
    const [target, keys] = args;
    if (target === undefined || keys === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(target);
    if (resolved.kind !== "object") return { steps: [], result: resolved };
    const keyNames = extractUnionLiterals(keys);
    const result: TypeNode = {
      kind: "object",
      properties: resolved.properties.filter((p) => !keyNames.includes(p.name)),
    };
    return {
      steps: [
        { label: `キー ${keyNames.map((k) => `"${k}"`).join(" | ")} を除外`, type: { kind: "generic", name: "Pick", args: [target, { kind: "generic", name: "Exclude", args: [{ kind: "keyof", target }, keys] }] } },
        { label: "残ったプロパティ", type: result },
      ],
      result,
    };
  },

  Record: (args, _ctx) => {
    const [keys, value] = args;
    if (keys === undefined || value === undefined) return { steps: [], result: { kind: "never" } };
    const keyNames = extractUnionLiterals(keys);
    if (keyNames.length > 0) {
      const result: TypeNode = {
        kind: "object",
        properties: keyNames.map((k) => ({ name: k, type: value, optional: false, readonly: false })),
      };
      return {
        steps: [
          { label: "マップ型に展開", type: { kind: "mapped", keyName: "K", constraint: keys, valueType: value } },
          { label: "各キーにプロパティを生成", type: result },
        ],
        result,
      };
    }
    return {
      steps: [{ label: "マップ型", type: { kind: "mapped", keyName: "K", constraint: keys, valueType: value } }],
      result: { kind: "mapped", keyName: "K", constraint: keys, valueType: value },
    };
  },

  Exclude: (args, ctx) => {
    let [union, excluded] = args;
    if (union === undefined || excluded === undefined) return { steps: [], result: { kind: "never" } };
    union = ctx.resolveType(union);
    excluded = ctx.resolveType(excluded);
    if (union.kind === "union") {
      const exNames = extractTypeNames(excluded);
      const remaining = union.members.filter((m) => !exNames.includes(typeToString(m)));
      const result: TypeNode = remaining.length === 0 ? { kind: "never" } : remaining.length === 1 ? remaining[0]! : { kind: "union", members: remaining };
      return {
        steps: [
          { label: "分配条件型として評価", type: { kind: "conditional", check: union, extendsType: excluded, trueType: { kind: "never" }, falseType: union } },
          { label: "一致するメンバーを除外", type: result },
        ],
        result,
      };
    }
    return { steps: [], result: union };
  },

  Extract: (args, ctx) => {
    let [union, target] = args;
    if (union === undefined || target === undefined) return { steps: [], result: { kind: "never" } };
    union = ctx.resolveType(union);
    target = ctx.resolveType(target);
    if (union.kind === "union") {
      const tgtNames = extractTypeNames(target);
      const matching = union.members.filter((m) => tgtNames.includes(typeToString(m)));
      const result: TypeNode = matching.length === 0 ? { kind: "never" } : matching.length === 1 ? matching[0]! : { kind: "union", members: matching };
      return {
        steps: [
          { label: "分配条件型として評価", type: { kind: "conditional", check: union, extendsType: target, trueType: union, falseType: { kind: "never" } } },
          { label: "一致するメンバーのみ抽出", type: result },
        ],
        result,
      };
    }
    return { steps: [], result: union };
  },

  ReturnType: (args, ctx) => {
    const [fn] = args;
    if (fn === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(fn);
    if (resolved.kind === "function") {
      return {
        steps: [
          { label: "条件型 + infer で戻り値を抽出", type: { kind: "conditional", check: resolved, extendsType: { kind: "function", params: [{ name: "...args", type: { kind: "any" } }], returnType: { kind: "infer", name: "R" } }, trueType: { kind: "ref", name: "R" }, falseType: { kind: "never" } } },
          { label: "infer R = 戻り値型", type: resolved.returnType },
        ],
        result: resolved.returnType,
      };
    }
    return { steps: [], result: { kind: "never" } };
  },

  Parameters: (args, ctx) => {
    const [fn] = args;
    if (fn === undefined) return { steps: [], result: { kind: "never" } };
    const resolved = ctx.resolveType(fn);
    if (resolved.kind === "function") {
      const result: TypeNode = { kind: "tuple", elements: resolved.params.map((p) => p.type) };
      return {
        steps: [
          { label: "条件型 + infer でパラメータを抽出", type: { kind: "conditional", check: resolved, extendsType: { kind: "function", params: [{ name: "...args", type: { kind: "infer", name: "P" } }], returnType: { kind: "any" } }, trueType: { kind: "ref", name: "P" }, falseType: { kind: "never" } } },
          { label: "infer P = パラメータのタプル", type: result },
        ],
        result,
      };
    }
    return { steps: [], result: { kind: "never" } };
  },

  NonNullable: (args, ctx) => {
    let [target] = args;
    if (target === undefined) return { steps: [], result: { kind: "never" } };
    target = ctx.resolveType(target);
    if (target.kind === "union") {
      const filtered = target.members.filter((m) => m.kind !== "null" && m.kind !== "undefined");
      const result: TypeNode = filtered.length === 0 ? { kind: "never" } : filtered.length === 1 ? filtered[0]! : { kind: "union", members: filtered };
      return {
        steps: [
          { label: "null と undefined を除外", type: { kind: "generic", name: "Exclude", args: [target, { kind: "union", members: [{ kind: "null" }, { kind: "undefined" }] }] } },
          { label: "結果", type: result },
        ],
        result,
      };
    }
    return { steps: [], result: target };
  },
};

/** ユニオンからリテラル文字列を抽出する */
function extractUnionLiterals(t: TypeNode): string[] {
  if (t.kind === "literal" && typeof t.value === "string") return [t.value];
  if (t.kind === "union") {
    return t.members.flatMap((m) => (m.kind === "literal" && typeof m.value === "string" ? [m.value] : []));
  }
  return [];
}

/** 型名の一覧を抽出する */
function extractTypeNames(t: TypeNode): string[] {
  if (t.kind === "union") return t.members.map((m) => typeToString(m));
  return [typeToString(t)];
}

/** リゾルバのコンテキスト */
interface ResolverContext {
  definitions: Map<string, TypeDef>;
  resolveType: (t: TypeNode) => TypeNode;
}

/** 型を解決する */
export function analyze(defs: TypeDef[], targetName?: string): AnalysisResult {
  const defMap = new Map<string, TypeDef>();
  for (const d of defs) defMap.set(d.name, d);

  const target = targetName ?? defs[defs.length - 1]?.name ?? "";
  const targetDef = defMap.get(target);
  if (targetDef === undefined) {
    return { definitions: defs, target, steps: [] };
  }

  const steps: ResolutionStep[] = [];
  steps.push({ label: "型定義", type: targetDef.body });

  const ctx: ResolverContext = {
    definitions: defMap,
    resolveType: (t) => resolveDeep(t, defMap, 0),
  };

  const resolved = resolveWithSteps(targetDef.body, defMap, steps, ctx);
  steps.push({ label: "最終型", type: resolved });

  return { definitions: defs, target, steps };
}

/** ステップを記録しながら型を解決する */
function resolveWithSteps(
  t: TypeNode,
  defs: Map<string, TypeDef>,
  steps: ResolutionStep[],
  ctx: ResolverContext,
): TypeNode {
  // ref → 定義を展開
  if (t.kind === "ref") {
    const def = defs.get(t.name);
    if (def !== undefined) {
      steps.push({ label: `"${t.name}" を展開`, type: def.body });
      return resolveWithSteps(def.body, defs, steps, ctx);
    }
    return t;
  }

  // generic (ユーティリティ型)
  if (t.kind === "generic") {
    const builtin = BUILTIN_UTILITIES[t.name];
    if (builtin !== undefined) {
      steps.push({ label: `${t.name}<...> を評価`, type: t });
      const { steps: innerSteps, result } = builtin(t.args, ctx);
      for (const s of innerSteps) steps.push(s);
      return result;
    }
    // ユーザー定義ジェネリクス
    const def = defs.get(t.name);
    if (def !== undefined && def.params.length > 0) {
      const substituted = substitute(def.body, def.params, t.args, defs);
      steps.push({ label: `${t.name}<...> の型パラメータを代入`, type: substituted });
      return resolveWithSteps(substituted, defs, steps, ctx);
    }
  }

  // conditional
  if (t.kind === "conditional") {
    steps.push({ label: "条件型を評価", type: t });
    const check = resolveDeep(t.check, defs, 0);
    const ext = resolveDeep(t.extendsType, defs, 0);
    const matches = isAssignableTo(check, ext);
    const branch = matches ? t.trueType : t.falseType;
    steps.push({ label: `${typeToString(check)} extends ${typeToString(ext)} → ${matches}`, type: branch });
    return resolveWithSteps(branch, defs, steps, ctx);
  }

  // keyof
  if (t.kind === "keyof") {
    const resolved = resolveDeep(t.target, defs, 0);
    if (resolved.kind === "object") {
      const keys = resolved.properties.map((p): TypeNode => ({ kind: "literal", value: p.name }));
      const result: TypeNode = keys.length === 1 ? keys[0]! : { kind: "union", members: keys };
      steps.push({ label: "keyof を展開", type: result });
      return result;
    }
  }

  // indexed access
  if (t.kind === "indexed") {
    const obj = resolveDeep(t.object, defs, 0);
    const idx = resolveDeep(t.index, defs, 0);
    if (obj.kind === "object" && idx.kind === "literal" && typeof idx.value === "string") {
      const prop = obj.properties.find((p) => p.name === idx.value);
      if (prop !== undefined) {
        steps.push({ label: `インデックスアクセス ["${idx.value}"]`, type: prop.type });
        return prop.type;
      }
    }
  }

  // intersection — メンバーを解決してマージ
  if (t.kind === "intersection") {
    const resolved = t.members.map((m) => resolveDeep(m, defs, 0));
    const merged = mergeIntersection(resolved);
    steps.push({ label: "intersection をマージ", type: merged });
    return merged;
  }

  // union — 各メンバーを解決
  if (t.kind === "union") {
    const resolved: TypeNode = { kind: "union", members: t.members.map((m) => resolveDeep(m, defs, 0)) };
    return resolved;
  }

  // object — 各プロパティの型を解決
  if (t.kind === "object") {
    return {
      kind: "object",
      properties: t.properties.map((p) => ({ ...p, type: resolveDeep(p.type, defs, 0) })),
    };
  }

  return t;
}

/** 型を再帰的に解決する（ステップなし） */
function resolveDeep(t: TypeNode, defs: Map<string, TypeDef>, depth: number): TypeNode {
  if (depth > 10) return t;
  switch (t.kind) {
    case "ref": {
      const def = defs.get(t.name);
      return def !== undefined ? resolveDeep(def.body, defs, depth + 1) : t;
    }
    case "union":
      return { kind: "union", members: t.members.map((m) => resolveDeep(m, defs, depth + 1)) };
    case "intersection":
      return mergeIntersection(t.members.map((m) => resolveDeep(m, defs, depth + 1)));
    case "keyof": {
      const resolved = resolveDeep(t.target, defs, depth + 1);
      if (resolved.kind === "object") {
        const keys = resolved.properties.map((p): TypeNode => ({ kind: "literal", value: p.name }));
        return keys.length === 1 ? keys[0]! : { kind: "union", members: keys };
      }
      return t;
    }
    case "indexed": {
      const obj = resolveDeep(t.object, defs, depth + 1);
      const idx = resolveDeep(t.index, defs, depth + 1);
      if (obj.kind === "object" && idx.kind === "literal" && typeof idx.value === "string") {
        const prop = obj.properties.find((p) => p.name === idx.value);
        if (prop !== undefined) return resolveDeep(prop.type, defs, depth + 1);
      }
      return t;
    }
    case "object":
      return { kind: "object", properties: t.properties.map((p) => ({ ...p, type: resolveDeep(p.type, defs, depth + 1) })) };
    case "generic": {
      const def = defs.get(t.name);
      if (def !== undefined && def.params.length > 0) {
        const substituted = substitute(def.body, def.params, t.args, defs);
        return resolveDeep(substituted, defs, depth + 1);
      }
      return t;
    }
    default:
      return t;
  }
}

/** ジェネリクス型パラメータを実引数で置換する */
function substitute(body: TypeNode, params: string[], args: TypeNode[], defs: Map<string, TypeDef>): TypeNode {
  const map = new Map<string, TypeNode>();
  for (let i = 0; i < params.length; i++) {
    const arg = args[i];
    if (arg !== undefined) map.set(params[i]!, arg);
  }
  return substNode(body, map, defs);
}

function substNode(t: TypeNode, map: Map<string, TypeNode>, defs: Map<string, TypeDef>): TypeNode {
  switch (t.kind) {
    case "ref":
      return map.get(t.name) ?? t;
    case "union":
      return { kind: "union", members: t.members.map((m) => substNode(m, map, defs)) };
    case "intersection":
      return { kind: "intersection", members: t.members.map((m) => substNode(m, map, defs)) };
    case "object":
      return { kind: "object", properties: t.properties.map((p) => ({ ...p, type: substNode(p.type, map, defs) })) };
    case "array":
      return { kind: "array", element: substNode(t.element, map, defs) };
    case "tuple":
      return { kind: "tuple", elements: t.elements.map((e) => substNode(e, map, defs)) };
    case "conditional":
      return { kind: "conditional", check: substNode(t.check, map, defs), extendsType: substNode(t.extendsType, map, defs), trueType: substNode(t.trueType, map, defs), falseType: substNode(t.falseType, map, defs) };
    case "keyof":
      return { kind: "keyof", target: substNode(t.target, map, defs) };
    case "indexed":
      return { kind: "indexed", object: substNode(t.object, map, defs), index: substNode(t.index, map, defs) };
    case "mapped":
      return { ...t, constraint: substNode(t.constraint, map, defs), valueType: substNode(t.valueType, map, defs) };
    case "generic":
      return { kind: "generic", name: t.name, args: t.args.map((a) => substNode(a, map, defs)) };
    case "function":
      return { kind: "function", params: t.params.map((p) => ({ ...p, type: substNode(p.type, map, defs) })), returnType: substNode(t.returnType, map, defs) };
    default:
      return t;
  }
}

/** intersection をマージする */
function mergeIntersection(members: TypeNode[]): TypeNode {
  const objects = members.filter((m): m is Extract<TypeNode, { kind: "object" }> => m.kind === "object");
  if (objects.length === members.length && objects.length > 0) {
    const allProps: PropertyDef[] = [];
    for (const obj of objects) {
      for (const prop of obj.properties) {
        if (!allProps.some((p) => p.name === prop.name)) allProps.push(prop);
      }
    }
    return { kind: "object", properties: allProps };
  }
  return members.length === 1 ? members[0]! : { kind: "intersection", members };
}

/** 簡易的な型代入可能性チェック */
function isAssignableTo(source: TypeNode, target: TypeNode): boolean {
  if (target.kind === "any" || target.kind === "unknown") return true;
  if (source.kind === "never") return true;
  if (source.kind === target.kind) {
    if (source.kind === "primitive" && target.kind === "primitive") return source.name === target.name;
    if (source.kind === "literal" && target.kind === "literal") return source.value === target.value;
    return true;
  }
  if (target.kind === "primitive" && source.kind === "literal") {
    if (target.name === "string" && typeof source.value === "string") return true;
    if (target.name === "number" && typeof source.value === "number") return true;
    if (target.name === "boolean" && typeof source.value === "boolean") return true;
  }
  if (target.kind === "union") {
    return target.members.some((m) => isAssignableTo(source, m));
  }
  return false;
}
