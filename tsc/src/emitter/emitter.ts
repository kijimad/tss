/**
 * emitter.ts — AST → JavaScript コード生成
 *
 * TypeScript の AST を走査し、型注釈を除去した JavaScript を出力する。
 * 処理内容:
 *   - 型注釈（: Type）→ 除去
 *   - interface / type alias → 除去
 *   - as Type → 除去（式だけ残す）
 *   - x! (non-null assertion) → x
 *   - enum → オブジェクトに変換
 *   - アクセス修飾子 (public/private/protected) → 除去
 *   - readonly → 除去
 *   - import type → 除去
 *   - 関数の型引数 → 除去
 *   - それ以外 → そのまま出力
 */
import type { Program, Stmt, Expr, Param, ClassMember, ObjProperty, VarDeclarator } from "../parser/ast.js";

// Expr かどうかを判定する（Stmt との discriminated union を区別）
const EXPR_TYPES = new Set([
  "number_literal", "string_literal", "template_literal", "boolean_literal",
  "null_literal", "undefined_literal", "identifier", "this",
  "binary", "unary_prefix", "unary_postfix", "assignment", "conditional",
  "call", "new_expr", "member", "computed_member", "optional_member",
  "array_literal", "object_literal", "arrow_function", "function_expr",
  "spread", "typeof_expr", "as_expr", "non_null", "await_expr", "paren",
]);

function isExpr(node: { type: string }): node is Expr {
  return EXPR_TYPES.has(node.type);
}

export function emit(program: Program): string {
  const lines: string[] = [];
  for (const stmt of program.body) {
    const code = emitStmt(stmt, 0);
    if (code !== "") lines.push(code);
  }
  return lines.join("\n") + "\n";
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function emitStmt(stmt: Stmt, level: number): string {
  switch (stmt.type) {
    case "empty_stmt":
      return "";

    case "var_decl": {
      const decls = stmt.declarations.map(d => emitVarDeclarator(d, level)).join(", ");
      return `${indent(level)}${stmt.kind} ${decls};`;
    }

    case "expr_stmt":
      return `${indent(level)}${emitExpr(stmt.expr)};`;

    case "return_stmt":
      return stmt.value !== undefined
        ? `${indent(level)}return ${emitExpr(stmt.value)};`
        : `${indent(level)}return;`;

    case "if_stmt": {
      let code = `${indent(level)}if (${emitExpr(stmt.condition)}) ${emitStmtBody(stmt.consequent, level)}`;
      if (stmt.alternate !== undefined) {
        code += ` else ${emitStmtBody(stmt.alternate, level)}`;
      }
      return code;
    }

    case "block":
      return `${indent(level)}{\n${stmt.body.map(s => emitStmt(s, level + 1)).filter(s => s !== "").join("\n")}\n${indent(level)}}`;

    case "for_stmt": {
      const init = stmt.init !== undefined ? emitStmt(stmt.init, 0).replace(/;$/, "") : "";
      const cond = stmt.condition !== undefined ? emitExpr(stmt.condition) : "";
      const update = stmt.update !== undefined ? emitExpr(stmt.update) : "";
      return `${indent(level)}for (${init}; ${cond}; ${update}) ${emitStmtBody(stmt.body, level)}`;
    }

    case "for_of_stmt":
      return `${indent(level)}for (${stmt.kind} ${stmt.name} of ${emitExpr(stmt.iterable)}) ${emitStmtBody(stmt.body, level)}`;

    case "for_in_stmt":
      return `${indent(level)}for (${stmt.kind} ${stmt.name} in ${emitExpr(stmt.object)}) ${emitStmtBody(stmt.body, level)}`;

    case "while_stmt":
      return `${indent(level)}while (${emitExpr(stmt.condition)}) ${emitStmtBody(stmt.body, level)}`;

    case "do_while_stmt":
      return `${indent(level)}do ${emitStmtBody(stmt.body, level)} while (${emitExpr(stmt.condition)});`;

    case "break_stmt":
      return `${indent(level)}break;`;

    case "continue_stmt":
      return `${indent(level)}continue;`;

    case "throw_stmt":
      return `${indent(level)}throw ${emitExpr(stmt.expr)};`;

    case "try_stmt": {
      let code = `${indent(level)}try ${emitStmtBody(stmt.block, level)}`;
      if (stmt.catchClause !== undefined) {
        const param = stmt.catchClause.param !== undefined ? `(${stmt.catchClause.param})` : "";
        code += ` catch ${param} ${emitStmtBody(stmt.catchClause.body, level)}`;
      }
      if (stmt.finallyBlock !== undefined) {
        code += ` finally ${emitStmtBody(stmt.finallyBlock, level)}`;
      }
      return code;
    }

    case "switch_stmt": {
      let code = `${indent(level)}switch (${emitExpr(stmt.discriminant)}) {\n`;
      for (const c of stmt.cases) {
        if (c.test !== undefined) {
          code += `${indent(level + 1)}case ${emitExpr(c.test)}:\n`;
        } else {
          code += `${indent(level + 1)}default:\n`;
        }
        for (const s of c.body) {
          const line = emitStmt(s, level + 2);
          if (line !== "") code += line + "\n";
        }
      }
      code += `${indent(level)}}`;
      return code;
    }

    case "function_decl": {
      const async_ = stmt.async ? "async " : "";
      const exported = stmt.exported ? "export " : "";
      const params = stmt.params.map(p => emitParam(p)).join(", ");
      // 型注釈（returnType）は除去
      const body = stmt.body.map(s => emitStmt(s, level + 1)).filter(s => s !== "").join("\n");
      return `${indent(level)}${exported}${async_}function ${stmt.name}(${params}) {\n${body}\n${indent(level)}}`;
    }

    case "class_decl": {
      const exported = stmt.exported ? "export " : "";
      const ext = stmt.superClass !== undefined ? ` extends ${emitExpr(stmt.superClass)}` : "";
      let code = `${indent(level)}${exported}class ${stmt.name}${ext} {\n`;
      for (const member of stmt.members) {
        const line = emitClassMember(member, level + 1);
        if (line !== "") code += line + "\n";
      }
      code += `${indent(level)}}`;
      return code;
    }

    case "import_decl": {
      if (stmt.specifiers.length === 0) {
        return `${indent(level)}import '${stmt.source}';`;
      }
      const parts: string[] = [];
      const defaultSpec = stmt.specifiers.find(s => s.type === "default");
      const namedSpecs = stmt.specifiers.filter(s => s.type === "named");
      const nsSpec = stmt.specifiers.find(s => s.type === "namespace");
      if (defaultSpec !== undefined) parts.push(defaultSpec.local);
      if (nsSpec !== undefined) parts.push(`* as ${nsSpec.local}`);
      if (namedSpecs.length > 0) {
        const named = namedSpecs.map(s =>
          s.imported === s.local ? s.local : `${s.imported} as ${s.local}`,
        ).join(", ");
        parts.push(`{ ${named} }`);
      }
      return `${indent(level)}import ${parts.join(", ")} from '${stmt.source}';`;
    }

    case "export_named": {
      if (stmt.declaration !== undefined) {
        return emitStmt(stmt.declaration, level);
      }
      const specs = stmt.specifiers.map(s =>
        s.local === s.exported ? s.local : `${s.local} as ${s.exported}`,
      ).join(", ");
      return `${indent(level)}export { ${specs} };`;
    }

    case "export_default": {
      const decl = stmt.declaration;
      if (decl.type === "function_decl" || decl.type === "class_decl") {
        return `${indent(level)}export default ${emitStmt(decl, level).replace(/^export /, "")}`;
      }
      if (isExpr(decl)) {
        return `${indent(level)}export default ${emitExpr(decl)};`;
      }
      return `${indent(level)}export default ${emitStmt(decl, level)}`;
    }

    // TypeScript 固有: トランスパイル時に除去
    case "type_alias":
    case "interface_decl":
      return ""; // 完全に除去

    case "enum_decl": {
      // enum → オブジェクトに変換
      const exported = stmt.exported ? "export " : "";
      let code = `${indent(level)}${exported}const ${stmt.name} = {\n`;
      let autoValue = 0;
      for (const member of stmt.members) {
        let value: string;
        if (member.value !== undefined) {
          value = emitExpr(member.value);
          // 数値なら auto-increment の基準を更新
          if (member.value.type === "number_literal") {
            autoValue = Number(member.value.value) + 1;
          }
        } else {
          value = String(autoValue);
          autoValue++;
        }
        code += `${indent(level + 1)}${member.name}: ${value},\n`;
      }
      code += `${indent(level)}};`;
      return code;
    }
  }
}

function emitStmtBody(stmt: Stmt, level: number): string {
  if (stmt.type === "block") {
    return `{\n${stmt.body.map(s => emitStmt(s, level + 1)).filter(s => s !== "").join("\n")}\n${indent(level)}}`;
  }
  return emitStmt(stmt, level + 1);
}

function emitVarDeclarator(d: VarDeclarator, _level: number): string {
  const name = typeof d.name === "string" ? d.name : "/* pattern */";
  // 型注釈は除去
  if (d.init !== undefined) {
    return `${name} = ${emitExpr(d.init)}`;
  }
  return name;
}

function emitParam(p: Param): string {
  // アクセス修飾子、型注釈は除去
  let code = "";
  if (p.rest) code += "...";
  code += p.name;
  // デフォルト値は残す
  if (p.defaultValue !== undefined) {
    code += ` = ${emitExpr(p.defaultValue)}`;
  }
  return code;
}

function emitClassMember(member: ClassMember, level: number): string {
  if (member.abstract) return ""; // abstract メンバは除去

  switch (member.type) {
    case "constructor": {
      const params = member.params.map(p => emitParam(p)).join(", ");
      if (member.body === undefined) return "";
      // コンストラクタ引数のプロパティ初期化 (TS の省略記法)
      const propInits: string[] = [];
      for (const p of member.params) {
        if (p.accessibility !== undefined) {
          propInits.push(`${indent(level + 1)}this.${p.name} = ${p.name};`);
        }
      }
      const body = member.body.map(s => emitStmt(s, level + 1)).filter(s => s !== "");
      const allBody = [...propInits, ...body].join("\n");
      return `${indent(level)}constructor(${params}) {\n${allBody}\n${indent(level)}}`;
    }

    case "method": {
      const static_ = member.static ? "static " : "";
      const async_ = member.async ? "async " : "";
      const params = member.params.map(p => emitParam(p)).join(", ");
      if (member.body === undefined) return "";
      const body = member.body.map(s => emitStmt(s, level + 1)).filter(s => s !== "").join("\n");
      return `${indent(level)}${static_}${async_}${member.name ?? ""}(${params}) {\n${body}\n${indent(level)}}`;
    }

    case "property": {
      const static_ = member.static ? "static " : "";
      if (member.value !== undefined) {
        return `${indent(level)}${static_}${member.name ?? ""} = ${emitExpr(member.value)};`;
      }
      return `${indent(level)}${static_}${member.name ?? ""};`;
    }
  }
}

function emitExpr(expr: Expr): string {
  switch (expr.type) {
    case "number_literal": return expr.value;
    case "string_literal": return `'${expr.value}'`;
    case "template_literal": return `\`${expr.value}\``;
    case "boolean_literal": return expr.value ? "true" : "false";
    case "null_literal": return "null";
    case "undefined_literal": return "undefined";
    case "identifier": return expr.name;
    case "this": return "this";

    case "binary":
      return `${emitExpr(expr.left)} ${expr.op} ${emitExpr(expr.right)}`;

    case "unary_prefix":
      if (expr.op === "!" || expr.op === "~" || expr.op === "-" || expr.op === "+" || expr.op === "void" || expr.op === "delete") {
        return `${expr.op}${expr.op.length > 1 ? " " : ""}${emitExpr(expr.operand)}`;
      }
      return `${expr.op}${emitExpr(expr.operand)}`;

    case "unary_postfix":
      return `${emitExpr(expr.operand)}${expr.op}`;

    case "assignment":
      return `${emitExpr(expr.left)} ${expr.op} ${emitExpr(expr.right)}`;

    case "conditional":
      return `${emitExpr(expr.condition)} ? ${emitExpr(expr.consequent)} : ${emitExpr(expr.alternate)}`;

    case "call": {
      // 型引数は除去
      const args = expr.args.map(a => emitExpr(a)).join(", ");
      return `${emitExpr(expr.callee)}(${args})`;
    }

    case "new_expr": {
      const args = expr.args.map(a => emitExpr(a)).join(", ");
      return `new ${emitExpr(expr.callee)}(${args})`;
    }

    case "member":
      return `${emitExpr(expr.object)}.${expr.property}`;

    case "computed_member":
      return `${emitExpr(expr.object)}[${emitExpr(expr.property)}]`;

    case "optional_member":
      return `${emitExpr(expr.object)}?.${expr.property}`;

    case "array_literal": {
      const elements = expr.elements.map(e => emitExpr(e)).join(", ");
      return `[${elements}]`;
    }

    case "object_literal": {
      if (expr.properties.length === 0) return "{}";
      const props = expr.properties.map(p => emitObjProperty(p)).join(", ");
      return `{ ${props} }`;
    }

    case "arrow_function": {
      const async_ = expr.async ? "async " : "";
      const params = expr.params.map(p => emitParam(p)).join(", ");
      const needsParens = expr.params.length !== 1 || expr.params[0]?.defaultValue !== undefined || expr.params[0]?.rest;
      const paramStr = needsParens ? `(${params})` : params;
      // 型注釈（returnType）は除去
      if ("type" in expr.body && expr.body.type === "block") {
        return `${async_}${paramStr} => ${emitStmtBody(expr.body, 0)}`;
      }
      return `${async_}${paramStr} => ${emitExpr(expr.body)}`;
    }

    case "function_expr": {
      const async_ = expr.async ? "async " : "";
      const name = expr.name ?? "";
      const params = expr.params.map(p => emitParam(p)).join(", ");
      const body = expr.body.map(s => emitStmt(s, 1)).filter(s => s !== "").join("\n");
      return `${async_}function ${name}(${params}) {\n${body}\n}`;
    }

    case "spread":
      return `...${emitExpr(expr.expr)}`;

    case "typeof_expr":
      return `typeof ${emitExpr(expr.operand)}`;

    // TS: as Type → 式だけ残す
    case "as_expr":
      return emitExpr(expr.expr);

    // TS: x! → x
    case "non_null":
      return emitExpr(expr.expr);

    case "await_expr":
      return `await ${emitExpr(expr.expr)}`;

    case "paren":
      return `(${emitExpr(expr.expr)})`;
  }
}

function emitObjProperty(p: ObjProperty): string {
  if (p.spread) return `...${p.value !== undefined ? emitExpr(p.value) : ""}`;
  if (p.value === undefined) return typeof p.key === "string" ? p.key : emitExpr(p.key);
  const keyStr = p.computed ? `[${typeof p.key === "string" ? p.key : emitExpr(p.key)}]` : (typeof p.key === "string" ? p.key : emitExpr(p.key));
  if (p.method && p.value.type === "function_expr") {
    const params = p.value.params.map(pp => emitParam(pp)).join(", ");
    const body = p.value.body.map(s => emitStmt(s, 1)).filter(s => s !== "").join("\n");
    return `${keyStr}(${params}) {\n${body}\n}`;
  }
  return `${keyStr}: ${emitExpr(p.value)}`;
}
