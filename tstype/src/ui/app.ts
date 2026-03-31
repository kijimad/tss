import { analyze } from "../analyzer/resolver.js";
import { typeToString } from "../analyzer/types.js";
import type { TypeNode, TypeDef, ResolutionStep, AnalysisResult } from "../analyzer/types.js";

/** サンプル例 */
export interface Example {
  name: string;
  /** 表示用の TypeScript コード */
  code: string;
  /** 解析対象の型定義 */
  definitions: TypeDef[];
  /** 解決対象の型名 */
  target: string;
}

// ── ヘルパー ──
const prim = (n: string): TypeNode => ({ kind: "primitive", name: n });
const lit = (v: string | number | boolean): TypeNode => ({ kind: "literal", value: v });
const ref = (n: string): TypeNode => ({ kind: "ref", name: n });
const union = (...ms: TypeNode[]): TypeNode => ({ kind: "union", members: ms });
const obj = (...ps: [string, TypeNode, boolean?, boolean?][]): TypeNode => ({
  kind: "object",
  properties: ps.map(([name, type, optional, readonly]) => ({
    name, type, optional: optional ?? false, readonly: readonly ?? false,
  })),
});
const gen = (name: string, ...args: TypeNode[]): TypeNode => ({ kind: "generic", name, args });
const fn = (params: [string, TypeNode][], ret: TypeNode): TypeNode => ({
  kind: "function",
  params: params.map(([name, type]) => ({ name, type })),
  returnType: ret,
});

export const EXAMPLES: Example[] = [
  {
    name: "基本型 と Union / Intersection",
    code: `type ID = string | number;
type Name = string;
type User = { id: ID; name: Name; active: boolean };
type ActiveUser = User & { verified: true };`,
    definitions: [
      { name: "ID", params: [], body: union(prim("string"), prim("number")) },
      { name: "Name", params: [], body: prim("string") },
      { name: "User", params: [], body: obj(["id", ref("ID")], ["name", ref("Name")], ["active", prim("boolean")]) },
      { name: "ActiveUser", params: [], body: { kind: "intersection", members: [ref("User"), obj(["verified", lit(true)])] } },
    ],
    target: "ActiveUser",
  },
  {
    name: "Partial<T> の展開",
    code: `type User = {
  name: string;
  email: string;
  age: number;
};
type PartialUser = Partial<User>;`,
    definitions: [
      { name: "User", params: [], body: obj(["name", prim("string")], ["email", prim("string")], ["age", prim("number")]) },
      { name: "PartialUser", params: [], body: gen("Partial", ref("User")) },
    ],
    target: "PartialUser",
  },
  {
    name: "Pick<T, K> と Omit<T, K>",
    code: `type User = {
  id: number;
  name: string;
  email: string;
  role: string;
};
type UserPreview = Pick<User, "id" | "name">;
type UserWithoutEmail = Omit<User, "email">;`,
    definitions: [
      { name: "User", params: [], body: obj(["id", prim("number")], ["name", prim("string")], ["email", prim("string")], ["role", prim("string")]) },
      { name: "UserPreview", params: [], body: gen("Pick", ref("User"), union(lit("id"), lit("name"))) },
      { name: "UserWithoutEmail", params: [], body: gen("Omit", ref("User"), lit("email")) },
    ],
    target: "UserPreview",
  },
  {
    name: "Exclude<T, U> と Extract<T, U>",
    code: `type Status = "active" | "inactive" | "pending" | "banned";
type ActiveStatuses = Extract<Status, "active" | "pending">;
type SafeStatuses = Exclude<Status, "banned">;`,
    definitions: [
      { name: "Status", params: [], body: union(lit("active"), lit("inactive"), lit("pending"), lit("banned")) },
      { name: "ActiveStatuses", params: [], body: gen("Extract", ref("Status"), union(lit("active"), lit("pending"))) },
      { name: "SafeStatuses", params: [], body: gen("Exclude", ref("Status"), lit("banned")) },
    ],
    target: "ActiveStatuses",
  },
  {
    name: "Record<K, V>",
    code: `type Role = "admin" | "editor" | "viewer";
type Permission = { read: boolean; write: boolean };
type RolePermissions = Record<Role, Permission>;`,
    definitions: [
      { name: "Role", params: [], body: union(lit("admin"), lit("editor"), lit("viewer")) },
      { name: "Permission", params: [], body: obj(["read", prim("boolean")], ["write", prim("boolean")]) },
      { name: "RolePermissions", params: [], body: gen("Record", ref("Role"), ref("Permission")) },
    ],
    target: "RolePermissions",
  },
  {
    name: "ReturnType<T> と Parameters<T>",
    code: `type CreateUser = (name: string, age: number) => { id: number; name: string };
type Result = ReturnType<CreateUser>;
type Args = Parameters<CreateUser>;`,
    definitions: [
      { name: "CreateUser", params: [], body: fn([["name", prim("string")], ["age", prim("number")]], obj(["id", prim("number")], ["name", prim("string")])) },
      { name: "Result", params: [], body: gen("ReturnType", ref("CreateUser")) },
      { name: "Args", params: [], body: gen("Parameters", ref("CreateUser")) },
    ],
    target: "Result",
  },
  {
    name: "条件型 (Conditional Types)",
    code: `type IsString<T> = T extends string ? "yes" : "no";
type A = IsString<"hello">;  // "yes"
type B = IsString<42>;       // "no"
type C = IsString<string>;   // "yes"`,
    definitions: [
      { name: "IsString", params: ["T"], body: { kind: "conditional", check: ref("T"), extendsType: prim("string"), trueType: lit("yes"), falseType: lit("no") } },
      { name: "A", params: [], body: gen("IsString", lit("hello")) },
      { name: "B", params: [], body: gen("IsString", lit(42)) },
      { name: "C", params: [], body: gen("IsString", prim("string")) },
    ],
    target: "A",
  },
  {
    name: "NonNullable<T> と keyof",
    code: `type MaybeUser = {
  name: string | null;
  age: number | undefined;
} | null | undefined;

type DefiniteUser = NonNullable<MaybeUser>;
type UserKeys = keyof NonNullable<MaybeUser>;`,
    definitions: [
      { name: "MaybeUser", params: [], body: union(obj(["name", union(prim("string"), { kind: "null" })], ["age", union(prim("number"), { kind: "undefined" })]), { kind: "null" }, { kind: "undefined" }) },
      { name: "DefiniteUser", params: [], body: gen("NonNullable", ref("MaybeUser")) },
    ],
    target: "DefiniteUser",
  },
];

/** 型ノードの種類ごとの色 */
function kindColor(kind: TypeNode["kind"]): string {
  switch (kind) {
    case "primitive":    return "#3b82f6";
    case "literal":      return "#f59e0b";
    case "object":       return "#10b981";
    case "union":        return "#a78bfa";
    case "intersection": return "#ec4899";
    case "conditional":  return "#ef4444";
    case "mapped":       return "#06b6d4";
    case "keyof":        return "#f97316";
    case "indexed":      return "#14b8a6";
    case "generic":      return "#8b5cf6";
    case "function":     return "#6366f1";
    case "array":        return "#22c55e";
    case "tuple":        return "#eab308";
    case "ref":          return "#94a3b8";
    case "infer":        return "#f472b6";
    case "never":        return "#dc2626";
    case "template":     return "#fb923c";
    default:             return "#64748b";
  }
}

/** 型ノードを HTML 要素としてレンダリングする */
function renderTypeTree(t: TypeNode, depth: number): HTMLElement {
  const el = document.createElement("div");
  const color = kindColor(t.kind);
  el.style.cssText = `margin:${depth > 0 ? "3px" : "0"} 0 0 ${depth > 0 ? "16" : "0"}px;border-left:2px solid ${color}44;padding-left:8px;`;

  const label = document.createElement("div");
  label.style.cssText = `font-size:11px;display:flex;align-items:center;gap:4px;`;

  const badge = document.createElement("span");
  badge.style.cssText = `padding:0 4px;border-radius:3px;font-size:9px;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44;`;
  badge.textContent = t.kind;
  label.appendChild(badge);

  const text = document.createElement("span");
  text.style.color = "#e2e8f0";

  switch (t.kind) {
    case "primitive": text.textContent = t.name; break;
    case "literal": text.textContent = typeof t.value === "string" ? `"${t.value}"` : String(t.value); break;
    case "ref": text.textContent = t.name; break;
    case "never": case "unknown": case "any": case "void": case "null": case "undefined":
      text.textContent = t.kind; break;
    case "generic": text.textContent = `${t.name}<...>`; break;
    case "function": text.textContent = `(${t.params.length} params) => ...`; break;
    case "infer": text.textContent = t.name; break;
    case "array": text.textContent = "[]"; break;
    case "conditional": text.textContent = "... extends ... ? ... : ..."; break;
    case "mapped": text.textContent = `{ [${t.keyName} in ...]: ... }`; break;
    case "keyof": text.textContent = "keyof ..."; break;
    case "indexed": text.textContent = "...[...]"; break;
    case "union": text.textContent = `(${t.members.length} members)`; break;
    case "intersection": text.textContent = `(${t.members.length} members)`; break;
    case "object": text.textContent = `{ ${t.properties.length} props }`; break;
    case "tuple": text.textContent = `[${t.elements.length} elements]`; break;
    default: text.textContent = typeToString(t);
  }

  label.appendChild(text);
  el.appendChild(label);

  // 子要素を再帰描画
  if (depth < 5) {
    switch (t.kind) {
      case "object":
        for (const p of t.properties) {
          const propEl = document.createElement("div");
          propEl.style.cssText = `margin:2px 0 0 16px;font-size:10px;color:#94a3b8;`;
          const ro = p.readonly ? "readonly " : "";
          const opt = p.optional ? "?" : "";
          propEl.textContent = `${ro}${p.name}${opt}:`;
          el.appendChild(propEl);
          el.appendChild(renderTypeTree(p.type, depth + 1));
        }
        break;
      case "union": case "intersection":
        for (const m of t.members) el.appendChild(renderTypeTree(m, depth + 1));
        break;
      case "generic":
        for (const a of t.args) el.appendChild(renderTypeTree(a, depth + 1));
        break;
      case "conditional":
        el.appendChild(renderTypeTree(t.check, depth + 1));
        el.appendChild(renderTypeTree(t.extendsType, depth + 1));
        el.appendChild(renderTypeTree(t.trueType, depth + 1));
        el.appendChild(renderTypeTree(t.falseType, depth + 1));
        break;
      case "function":
        for (const p of t.params) el.appendChild(renderTypeTree(p.type, depth + 1));
        el.appendChild(renderTypeTree(t.returnType, depth + 1));
        break;
      case "keyof": el.appendChild(renderTypeTree(t.target, depth + 1)); break;
      case "indexed":
        el.appendChild(renderTypeTree(t.object, depth + 1));
        el.appendChild(renderTypeTree(t.index, depth + 1));
        break;
      case "mapped":
        el.appendChild(renderTypeTree(t.constraint, depth + 1));
        el.appendChild(renderTypeTree(t.valueType, depth + 1));
        break;
      case "array": el.appendChild(renderTypeTree(t.element, depth + 1)); break;
      case "tuple":
        for (const e of t.elements) el.appendChild(renderTypeTree(e, depth + 1));
        break;
    }
  }

  return el;
}

export class TsTypeApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "TypeScript Type Visualizer";
    title.style.cssText = "margin:0;font-size:15px;color:#3178c6;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exSelect.appendChild(opt);
    }
    header.appendChild(exSelect);

    // ターゲット型切り替え（例によっては複数のターゲットがある）
    const targetSelect = document.createElement("select");
    targetSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#94a3b8;font-size:11px;";
    header.appendChild(targetSelect);

    const analyzeBtn = document.createElement("button");
    analyzeBtn.textContent = "Analyze";
    analyzeBtn.style.cssText =
      "padding:4px 16px;background:#3178c6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(analyzeBtn);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: コード + 解決ステップ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3178c6;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "TypeScript Code";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText =
      "height:140px;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;line-height:1.6;border-bottom:1px solid #1e293b;";
    codeArea.readOnly = true;
    codeArea.spellcheck = false;
    leftPanel.appendChild(codeArea);

    const stepsLabel = document.createElement("div");
    stepsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    stepsLabel.textContent = "Resolution Steps";
    leftPanel.appendChild(stepsLabel);

    const stepsDiv = document.createElement("div");
    stepsDiv.style.cssText = "flex:1;padding:8px 12px;font-size:11px;overflow-y:auto;";
    leftPanel.appendChild(stepsDiv);

    main.appendChild(leftPanel);

    // 右: 型ツリー
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    const treeLabel = document.createElement("div");
    treeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    treeLabel.textContent = "Type Tree";
    rightPanel.appendChild(treeLabel);

    const treeDiv = document.createElement("div");
    treeDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;";
    rightPanel.appendChild(treeDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderSteps = (steps: ResolutionStep[]) => {
      stepsDiv.innerHTML = "";
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const stepEl = document.createElement("div");
        stepEl.style.cssText = "margin-bottom:8px;";

        const labelEl = document.createElement("div");
        labelEl.style.cssText = "color:#f59e0b;font-weight:600;font-size:10px;margin-bottom:2px;";
        labelEl.textContent = `Step ${i + 1}: ${step.label}`;
        stepEl.appendChild(labelEl);

        const typeEl = document.createElement("div");
        typeEl.style.cssText = "padding:4px 8px;background:#1e293b;border-radius:4px;color:#a5f3fc;font-size:11px;white-space:pre-wrap;word-break:break-all;line-height:1.5;";
        typeEl.textContent = typeToString(step.type);
        stepEl.appendChild(typeEl);

        if (i < steps.length - 1) {
          const arrow = document.createElement("div");
          arrow.style.cssText = "color:#475569;text-align:center;font-size:10px;margin:3px 0;";
          arrow.textContent = "\u2193";
          stepEl.appendChild(arrow);
        }

        stepsDiv.appendChild(stepEl);
      }
    };

    const renderTree = (result: AnalysisResult) => {
      treeDiv.innerHTML = "";
      const finalStep = result.steps[result.steps.length - 1];
      if (finalStep !== undefined) {
        const titleEl = document.createElement("div");
        titleEl.style.cssText = "font-size:12px;font-weight:600;color:#10b981;margin-bottom:8px;";
        titleEl.textContent = `type ${result.target} = ...`;
        treeDiv.appendChild(titleEl);
        treeDiv.appendChild(renderTypeTree(finalStep.type, 0));
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      codeArea.value = ex.code;
      targetSelect.innerHTML = "";
      for (const d of ex.definitions) {
        const opt = document.createElement("option");
        opt.value = d.name;
        opt.textContent = d.name;
        targetSelect.appendChild(opt);
      }
      targetSelect.value = ex.target;
      doAnalyze(ex, ex.target);
    };

    const doAnalyze = (ex: Example, target: string) => {
      const result = analyze(ex.definitions, target);
      renderSteps(result.steps);
      renderTree(result);
    };

    // ── イベント ──

    exSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) loadExample(ex);
    });

    targetSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) doAnalyze(ex, targetSelect.value);
    });

    analyzeBtn.addEventListener("click", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) doAnalyze(ex, targetSelect.value);
    });

    // 初期表示
    loadExample(EXAMPLES[0]!);
  }
}
