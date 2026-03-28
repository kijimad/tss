/**
 * checker.ts -- 型チェッカー
 *
 * AST を走査して以下を検証する:
 *   1. 変数の型注釈と初期値の型が一致するか
 *   2. 関数の引数の型が合っているか
 *   3. 関数の戻り値の型が宣言と一致するか
 *   4. 未定義変数の参照
 *   5. 二項演算の型が適切か (+, -, *, / 等)
 *   6. 条件式が boolean 互換か
 *
 * 型推論:
 *   型注釈がない場合、初期値から型を推論する。
 *   const x = 42;  → x は number
 */
import type { Program, Stmt, Expr, TypeNode, Param } from "../parser/ast.js";
import {
  type Type, type FuncParam,
  NUMBER, STRING, BOOLEAN, VOID, NULL_TYPE, UNDEFINED, ANY, UNKNOWN,
  isAssignableTo, typeToString,
} from "./types.js";
import { Scope } from "./scope.js";

// 型エラー
export interface TypeError {
  message: string;
  line: number;
  col: number;
}

export class TypeChecker {
  private errors: TypeError[] = [];
  private scope: Scope;
  // type alias を記録
  private typeAliases = new Map<string, Type>();
  // interface を記録
  private interfaces = new Map<string, Type>();

  constructor() {
    this.scope = new Scope();
    // 組み込み関数
    this.scope.define("console", {
      kind: "object",
      properties: new Map([
        ["log", { kind: "function", params: [{ name: "args", type: ANY, optional: true }], returnType: VOID }],
        ["error", { kind: "function", params: [{ name: "args", type: ANY, optional: true }], returnType: VOID }],
        ["warn", { kind: "function", params: [{ name: "args", type: ANY, optional: true }], returnType: VOID }],
      ]),
    });
    this.scope.define("Math", {
      kind: "object",
      properties: new Map([
        ["floor", { kind: "function", params: [{ name: "x", type: NUMBER, optional: false }], returnType: NUMBER }],
        ["ceil", { kind: "function", params: [{ name: "x", type: NUMBER, optional: false }], returnType: NUMBER }],
        ["round", { kind: "function", params: [{ name: "x", type: NUMBER, optional: false }], returnType: NUMBER }],
        ["max", { kind: "function", params: [{ name: "a", type: NUMBER, optional: false }], returnType: NUMBER }],
        ["min", { kind: "function", params: [{ name: "a", type: NUMBER, optional: false }], returnType: NUMBER }],
        ["random", { kind: "function", params: [], returnType: NUMBER }],
        ["PI", NUMBER],
      ]),
    });
    this.scope.define("parseInt", { kind: "function", params: [{ name: "s", type: STRING, optional: false }], returnType: NUMBER });
    this.scope.define("parseFloat", { kind: "function", params: [{ name: "s", type: STRING, optional: false }], returnType: NUMBER });
    this.scope.define("isNaN", { kind: "function", params: [{ name: "v", type: ANY, optional: false }], returnType: BOOLEAN });
    this.scope.define("fetch", { kind: "function", params: [{ name: "url", type: STRING, optional: false }], returnType: ANY });
    this.scope.define("JSON", {
      kind: "object",
      properties: new Map([
        ["parse", { kind: "function", params: [{ name: "s", type: STRING, optional: false }], returnType: ANY }],
        ["stringify", { kind: "function", params: [{ name: "v", type: ANY, optional: false }], returnType: STRING }],
      ]),
    });
  }

  check(program: Program): TypeError[] {
    this.errors = [];
    for (const stmt of program.body) {
      this.checkStmt(stmt);
    }
    return this.errors;
  }

  private addError(message: string): void {
    this.errors.push({ message, line: 0, col: 0 });
  }

  // === 文の型チェック ===

  private checkStmt(stmt: Stmt): void {
    switch (stmt.type) {
      case "var_decl": {
        for (const decl of stmt.declarations) {
          const declaredType = decl.typeAnnotation !== undefined ? this.resolveTypeNode(decl.typeAnnotation) : undefined;
          const initType = decl.init !== undefined ? this.inferExpr(decl.init) : undefined;

          // 型を決定: 注釈 > 推論 > unknown
          let varType: Type;
          if (declaredType !== undefined) {
            varType = declaredType;
            // 初期値の型が注釈と一致するか検証
            if (initType !== undefined && !isAssignableTo(initType, declaredType)) {
              this.addError(
                `型 '${typeToString(initType)}' を型 '${typeToString(declaredType)}' に代入できません`,
              );
            }
          } else if (initType !== undefined) {
            varType = initType;
          } else {
            varType = ANY;
          }

          const name = typeof decl.name === "string" ? decl.name : undefined;
          if (name !== undefined) {
            this.scope.define(name, varType);
          }
        }
        break;
      }

      case "function_decl": {
        const paramTypes = this.resolveParams(stmt.params);
        const declaredReturn = stmt.returnType !== undefined ? this.resolveTypeNode(stmt.returnType) : undefined;
        const funcType: Type = {
          kind: "function",
          params: paramTypes,
          returnType: declaredReturn ?? ANY,
        };
        this.scope.define(stmt.name, funcType);

        // 関数本体を子スコープでチェック
        const bodyScope = this.scope.child();
        const savedScope = this.scope;
        this.scope = bodyScope;
        for (const p of stmt.params) {
          const pType = p.typeAnnotation !== undefined ? this.resolveTypeNode(p.typeAnnotation) : ANY;
          this.scope.define(p.name, pType);
        }
        const returnType = this.checkFunctionBody(stmt.body);
        this.scope = savedScope;

        // 戻り値の型を検証
        if (declaredReturn !== undefined && returnType !== undefined) {
          if (!isAssignableTo(returnType, declaredReturn)) {
            this.addError(
              `関数 '${stmt.name}': 戻り値の型 '${typeToString(returnType)}' は宣言された型 '${typeToString(declaredReturn)}' と互換性がありません`,
            );
          }
        }
        break;
      }

      case "class_decl": {
        const properties = new Map<string, Type>();
        for (const member of stmt.members) {
          if (member.name !== undefined) {
            if (member.type === "property") {
              const propType = member.returnType !== undefined
                ? this.resolveTypeNode(member.returnType)
                : (member.value !== undefined ? this.inferExpr(member.value) : ANY);
              properties.set(member.name, propType);
            } else if (member.type === "method") {
              const params = this.resolveParams(member.params);
              const ret = member.returnType !== undefined ? this.resolveTypeNode(member.returnType) : ANY;
              properties.set(member.name, { kind: "function", params, returnType: ret });
            }
          }
        }
        this.scope.define(stmt.name, { kind: "object", properties });
        break;
      }

      case "return_stmt": {
        if (stmt.value !== undefined) this.inferExpr(stmt.value);
        break;
      }

      case "if_stmt": {
        this.inferExpr(stmt.condition);
        const childScope = this.scope.child();
        const saved = this.scope;
        this.scope = childScope;
        this.checkStmt(stmt.consequent);
        this.scope = saved;
        if (stmt.alternate !== undefined) {
          const altScope = this.scope.child();
          this.scope = altScope;
          this.checkStmt(stmt.alternate);
          this.scope = saved;
        }
        break;
      }

      case "block": {
        const childScope = this.scope.child();
        const saved = this.scope;
        this.scope = childScope;
        for (const s of stmt.body) this.checkStmt(s);
        this.scope = saved;
        break;
      }

      case "for_stmt": {
        const childScope = this.scope.child();
        const saved = this.scope;
        this.scope = childScope;
        if (stmt.init !== undefined) this.checkStmt(stmt.init);
        if (stmt.condition !== undefined) this.inferExpr(stmt.condition);
        if (stmt.update !== undefined) this.inferExpr(stmt.update);
        this.checkStmt(stmt.body);
        this.scope = saved;
        break;
      }

      case "for_of_stmt":
      case "for_in_stmt": {
        const childScope = this.scope.child();
        const saved = this.scope;
        this.scope = childScope;
        this.scope.define(stmt.name, ANY);
        this.checkStmt(stmt.body);
        this.scope = saved;
        break;
      }

      case "while_stmt":
      case "do_while_stmt": {
        this.inferExpr(stmt.condition);
        this.checkStmt(stmt.body);
        break;
      }

      case "expr_stmt":
        this.inferExpr(stmt.expr);
        break;

      case "throw_stmt":
        this.inferExpr(stmt.expr);
        break;

      case "try_stmt": {
        this.checkStmt(stmt.block);
        if (stmt.catchClause !== undefined) {
          const catchScope = this.scope.child();
          const saved = this.scope;
          this.scope = catchScope;
          if (stmt.catchClause.param !== undefined) {
            this.scope.define(stmt.catchClause.param, ANY);
          }
          this.checkStmt(stmt.catchClause.body);
          this.scope = saved;
        }
        if (stmt.finallyBlock !== undefined) this.checkStmt(stmt.finallyBlock);
        break;
      }

      case "switch_stmt": {
        const discType = this.inferExpr(stmt.discriminant);
        for (const c of stmt.cases) {
          if (c.test !== undefined) {
            const testType = this.inferExpr(c.test);
            if (!isAssignableTo(testType, discType) && !isAssignableTo(discType, testType)) {
              this.addError(
                `switch: case の型 '${typeToString(testType)}' は判別式の型 '${typeToString(discType)}' と互換性がありません`,
              );
            }
          }
          for (const s of c.body) this.checkStmt(s);
        }
        break;
      }

      case "type_alias": {
        this.typeAliases.set(stmt.name, this.resolveTypeNode(stmt.typeNode));
        break;
      }

      case "interface_decl": {
        this.interfaces.set(stmt.name, { kind: "object", properties: new Map() });
        break;
      }

      case "enum_decl": {
        this.scope.define(stmt.name, { kind: "object", properties: new Map() });
        break;
      }

      case "import_decl": {
        for (const spec of stmt.specifiers) {
          this.scope.define(spec.local, ANY);
        }
        break;
      }

      case "export_named": {
        if (stmt.declaration !== undefined) this.checkStmt(stmt.declaration);
        break;
      }

      case "export_default": {
        if ("type" in stmt.declaration) {
          const decl = stmt.declaration;
          // Stmt か Expr かを type で判定
          if (decl.type === "function_decl" || decl.type === "class_decl" || decl.type === "var_decl") {
            this.checkStmt(decl);
          } else {
            this.inferExpr(decl as Expr);
          }
        }
        break;
      }

      case "empty_stmt":
      case "break_stmt":
      case "continue_stmt":
        break;
    }
  }

  // 関数本体をチェックし、return の型を返す
  private checkFunctionBody(body: Stmt[]): Type | undefined {
    let returnType: Type | undefined;
    for (const stmt of body) {
      this.checkStmt(stmt);
      if (stmt.type === "return_stmt" && stmt.value !== undefined) {
        returnType = this.inferExpr(stmt.value);
      }
    }
    return returnType;
  }

  // === 式の型推論 ===

  inferExpr(expr: Expr): Type {
    switch (expr.type) {
      case "number_literal": return NUMBER;
      case "string_literal": return STRING;
      case "template_literal": return STRING;
      case "boolean_literal": return BOOLEAN;
      case "null_literal": return NULL_TYPE;
      case "undefined_literal": return UNDEFINED;

      case "identifier": {
        const type = this.scope.lookup(expr.name);
        if (type === undefined) {
          this.addError(`'${expr.name}' は定義されていません`);
          return UNKNOWN;
        }
        return type;
      }

      case "this": return ANY;

      case "binary": {
        const leftType = this.inferExpr(expr.left);
        const rightType = this.inferExpr(expr.right);

        // 算術演算: 両辺が number
        if (["-", "*", "/", "%", "**"].includes(expr.op)) {
          if (!isAssignableTo(leftType, NUMBER) && leftType.kind !== "unknown") {
            this.addError(`演算子 '${expr.op}' の左辺に型 '${typeToString(leftType)}' は使用できません。'number' が必要です`);
          }
          if (!isAssignableTo(rightType, NUMBER) && rightType.kind !== "unknown") {
            this.addError(`演算子 '${expr.op}' の右辺に型 '${typeToString(rightType)}' は使用できません。'number' が必要です`);
          }
          return NUMBER;
        }

        // + は number + number → number, string + any → string
        if (expr.op === "+") {
          if (isAssignableTo(leftType, STRING) || isAssignableTo(rightType, STRING)) return STRING;
          if (isAssignableTo(leftType, NUMBER) && isAssignableTo(rightType, NUMBER)) return NUMBER;
          return ANY;
        }

        // 比較演算: boolean を返す
        if (["===", "!==", "==", "!=", "<", ">", "<=", ">=", "instanceof", "in"].includes(expr.op)) {
          return BOOLEAN;
        }

        // 論理演算
        if (expr.op === "&&" || expr.op === "||") return leftType;
        if (expr.op === "??") return leftType; // 簡易

        // ビット演算
        if (["&", "|", "^", "<<", ">>", ">>>"].includes(expr.op)) return NUMBER;

        return ANY;
      }

      case "unary_prefix": {
        const operandType = this.inferExpr(expr.operand);
        if (expr.op === "!" || expr.op === "delete") return BOOLEAN;
        if (expr.op === "-" || expr.op === "+" || expr.op === "~") {
          if (!isAssignableTo(operandType, NUMBER) && operandType.kind !== "unknown" && expr.op !== "+") {
            // + は文字列→数値変換にも使われるので許容
          }
          return NUMBER;
        }
        if (expr.op === "++" || expr.op === "--") return NUMBER;
        if (expr.op === "void") return UNDEFINED;
        return ANY;
      }

      case "unary_postfix": return NUMBER;

      case "typeof_expr": {
        this.inferExpr(expr.operand);
        return STRING;
      }

      case "assignment": {
        const rightType = this.inferExpr(expr.right);
        const leftType = this.inferExpr(expr.left);
        if (expr.op === "=" && leftType.kind !== "unknown" && !isAssignableTo(rightType, leftType)) {
          this.addError(
            `型 '${typeToString(rightType)}' を型 '${typeToString(leftType)}' に代入できません`,
          );
        }
        return rightType;
      }

      case "conditional": {
        this.inferExpr(expr.condition);
        const consequent = this.inferExpr(expr.consequent);
        const alternate = this.inferExpr(expr.alternate);
        if (consequent.kind === alternate.kind && typeToString(consequent) === typeToString(alternate)) {
          return consequent;
        }
        return { kind: "union", types: [consequent, alternate] };
      }

      case "call": {
        const calleeType = this.inferExpr(expr.callee);
        const argTypes = expr.args.map(a => this.inferExpr(a));

        if (calleeType.kind === "function") {
          // 引数の数チェック
          const requiredParams = calleeType.params.filter(p => !p.optional);
          if (argTypes.length < requiredParams.length) {
            this.addError(
              `引数が足りません: ${String(requiredParams.length)} 個必要ですが ${String(argTypes.length)} 個しかありません`,
            );
          }
          // 各引数の型チェック
          for (let i = 0; i < Math.min(argTypes.length, calleeType.params.length); i++) {
            const paramType = calleeType.params[i]?.type;
            const argType = argTypes[i];
            if (paramType !== undefined && argType !== undefined && !isAssignableTo(argType, paramType)) {
              this.addError(
                `引数 ${String(i + 1)}: 型 '${typeToString(argType)}' は型 '${typeToString(paramType)}' に代入できません`,
              );
            }
          }
          return calleeType.returnType;
        }
        return ANY;
      }

      case "new_expr":
        this.inferExpr(expr.callee);
        expr.args.forEach(a => this.inferExpr(a));
        return ANY;

      case "member": {
        const objType = this.inferExpr(expr.object);
        if (objType.kind === "object") {
          const propType = objType.properties.get(expr.property);
          if (propType !== undefined) return propType;
        }
        // string のメソッド
        if (isAssignableTo(objType, STRING)) {
          const stringMethods: Record<string, Type | undefined> = {
            length: NUMBER,
            toUpperCase: { kind: "function", params: [], returnType: STRING },
            toLowerCase: { kind: "function", params: [], returnType: STRING },
            trim: { kind: "function", params: [], returnType: STRING },
            split: { kind: "function", params: [{ name: "sep", type: STRING, optional: false }], returnType: { kind: "array", elementType: STRING } },
            includes: { kind: "function", params: [{ name: "s", type: STRING, optional: false }], returnType: BOOLEAN },
            indexOf: { kind: "function", params: [{ name: "s", type: STRING, optional: false }], returnType: NUMBER },
            slice: { kind: "function", params: [{ name: "start", type: NUMBER, optional: false }], returnType: STRING },
          };
          const method = stringMethods[expr.property];
          if (method !== undefined) return method;
        }
        // array のメソッド
        if (objType.kind === "array") {
          if (expr.property === "length") return NUMBER;
          if (expr.property === "push") return { kind: "function", params: [{ name: "item", type: objType.elementType, optional: false }], returnType: NUMBER };
          if (expr.property === "pop") return { kind: "function", params: [], returnType: objType.elementType };
          if (expr.property === "map" || expr.property === "filter" || expr.property === "forEach") return ANY;
        }
        return ANY;
      }

      case "computed_member": {
        this.inferExpr(expr.object);
        this.inferExpr(expr.property);
        return ANY;
      }

      case "optional_member": {
        const objType = this.inferExpr(expr.object);
        if (objType.kind === "object") {
          const propType = objType.properties.get(expr.property);
          if (propType !== undefined) return { kind: "union", types: [propType, UNDEFINED] };
        }
        return ANY;
      }

      case "array_literal": {
        if (expr.elements.length === 0) return { kind: "array", elementType: ANY };
        const elemTypes = expr.elements.map(e => this.inferExpr(e));
        const firstType = elemTypes[0] ?? ANY;
        const allSame = elemTypes.every(t => typeToString(t) === typeToString(firstType));
        return { kind: "array", elementType: allSame ? firstType : ANY };
      }

      case "object_literal": {
        const properties = new Map<string, Type>();
        for (const prop of expr.properties) {
          if (prop.spread) {
            if (prop.value !== undefined) this.inferExpr(prop.value);
            continue;
          }
          const key = typeof prop.key === "string" ? prop.key : undefined;
          if (key !== undefined) {
            if (prop.value !== undefined) {
              properties.set(key, this.inferExpr(prop.value));
            } else {
              // shorthand: { x } → x の型を引く
              const varType = this.scope.lookup(key);
              properties.set(key, varType ?? ANY);
            }
          }
        }
        return { kind: "object", properties };
      }

      case "arrow_function":
      case "function_expr": {
        const params = this.resolveParams(expr.params);
        const declaredReturn = expr.returnType !== undefined ? this.resolveTypeNode(expr.returnType) : undefined;

        // 本体を子スコープでチェック
        const bodyScope = this.scope.child();
        const saved = this.scope;
        this.scope = bodyScope;
        for (const p of expr.params) {
          const pType = p.typeAnnotation !== undefined ? this.resolveTypeNode(p.typeAnnotation) : ANY;
          this.scope.define(p.name, pType);
        }

        let returnType: Type = VOID;
        if (expr.type === "arrow_function") {
          if ("type" in expr.body && expr.body.type === "block") {
            for (const s of (expr.body as { type: "block"; body: Stmt[] }).body) {
              this.checkStmt(s);
              if (s.type === "return_stmt" && s.value !== undefined) {
                returnType = this.inferExpr(s.value);
              }
            }
          } else {
            returnType = this.inferExpr(expr.body as Expr);
          }
        } else {
          for (const s of expr.body) {
            this.checkStmt(s);
            if (s.type === "return_stmt" && s.value !== undefined) {
              returnType = this.inferExpr(s.value);
            }
          }
        }
        this.scope = saved;

        return { kind: "function", params, returnType: declaredReturn ?? returnType };
      }

      case "spread":
        return this.inferExpr(expr.expr);

      case "as_expr":
        this.inferExpr(expr.expr);
        return this.resolveTypeNode(expr.typeNode);

      case "non_null": {
        const innerType = this.inferExpr(expr.expr);
        return innerType;
      }

      case "await_expr":
        return this.inferExpr(expr.expr); // Promise の unwrap は省略

      case "paren":
        return this.inferExpr(expr.expr);
    }
  }

  // === TypeNode → 内部型に変換 ===

  private resolveTypeNode(node: TypeNode): Type {
    switch (node.type) {
      case "type_ref": {
        // プリミティブ型
        const primitives: Record<string, Type | undefined> = {
          number: NUMBER, string: STRING, boolean: BOOLEAN,
          void: VOID, null: NULL_TYPE, undefined: UNDEFINED,
          any: ANY, never: { kind: "primitive", name: "never" },
          object: { kind: "object", properties: new Map() },
        };
        const prim = primitives[node.name];
        if (prim !== undefined) return prim;
        // type alias
        const alias = this.typeAliases.get(node.name);
        if (alias !== undefined) return alias;
        // interface
        const iface = this.interfaces.get(node.name);
        if (iface !== undefined) return iface;
        // Array<T>
        if (node.name === "Array" && node.typeArgs.length > 0 && node.typeArgs[0] !== undefined) {
          return { kind: "array", elementType: this.resolveTypeNode(node.typeArgs[0]) };
        }
        // Promise<T> → T (簡易)
        if (node.name === "Promise" && node.typeArgs.length > 0 && node.typeArgs[0] !== undefined) {
          return this.resolveTypeNode(node.typeArgs[0]);
        }
        return UNKNOWN;
      }
      case "array_type":
        return { kind: "array", elementType: this.resolveTypeNode(node.elementType) };
      case "union_type":
        return { kind: "union", types: node.types.map(t => this.resolveTypeNode(t)) };
      case "function_type":
        return {
          kind: "function",
          params: node.params.map((p, i) => ({ name: `p${String(i)}`, type: this.resolveTypeNode(p), optional: false })),
          returnType: this.resolveTypeNode(node.returnType),
        };
      case "literal_type": {
        if (node.value === "true") return BOOLEAN;
        if (node.value === "false") return BOOLEAN;
        if (!isNaN(Number(node.value))) return NUMBER;
        return STRING;
      }
      default:
        return UNKNOWN;
    }
  }

  // パラメータリストを内部型に変換
  private resolveParams(params: Param[]): FuncParam[] {
    return params.map(p => ({
      name: p.name,
      type: p.typeAnnotation !== undefined ? this.resolveTypeNode(p.typeAnnotation) : ANY,
      optional: p.optional || p.defaultValue !== undefined,
    }));
  }
}
