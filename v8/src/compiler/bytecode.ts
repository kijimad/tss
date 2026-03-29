/**
 * bytecode.ts -- バイトコード定義 + コンパイラ
 *
 * V8 の Ignition インタプリタに相当。
 * AST をレジスタベースのバイトコードに変換する。
 *
 * V8 の Ignition は「アキュムレータ + レジスタ」方式。
 * 結果はアキュムレータに残り、レジスタはローカル変数用。
 * ここではスタックベースの簡易版で実装する。
 */
import type { Program, Stmt, Expr } from "../parser/ast.js";

// バイトコード命令
export const Op = {
  // 定数ロード
  LdaConst: 0x01,      // アキュムレータに定数ロード (idx)
  LdaUndefined: 0x02,
  LdaNull: 0x03,
  LdaTrue: 0x04,
  LdaFalse: 0x05,
  LdaZero: 0x06,
  LdaSmi: 0x07,        // 小整数ロード (value)

  // ローカル変数
  Ldar: 0x10,          // レジスタ → アキュムレータ (reg)
  Star: 0x11,          // アキュムレータ → レジスタ (reg)

  // グローバル/プロパティ
  LdaGlobal: 0x15,     // グローバル変数ロード (name_idx)
  StaGlobal: 0x16,     // グローバル変数ストア (name_idx)
  LdaProperty: 0x17,   // プロパティロード (obj_reg, name_idx)
  StaProperty: 0x18,   // プロパティストア (obj_reg, name_idx)

  // 算術
  Add: 0x20,           // acc = acc + reg
  Sub: 0x21,
  Mul: 0x22,
  Div: 0x23,
  Mod: 0x24,

  // 比較
  CmpEq: 0x30,
  CmpStrictEq: 0x31,
  CmpLt: 0x32,
  CmpGt: 0x33,
  CmpLtEq: 0x34,
  CmpGtEq: 0x35,

  // 論理
  LogNot: 0x38,
  TypeOf: 0x39,

  // 分岐
  Jump: 0x40,           // 無条件ジャンプ (offset)
  JumpIfTrue: 0x41,
  JumpIfFalse: 0x42,

  // 関数
  CallRuntime: 0x50,    // ランタイム関数呼び出し (func_idx, arg_count)
  Call: 0x51,           // ユーザ関数呼び出し (callee_reg, arg_count)
  Return: 0x52,

  // オブジェクト
  CreateObject: 0x60,
  CreateArray: 0x61,
  CreateClosure: 0x62,  // クロージャ作成 (func_idx)

  // スタック
  Push: 0x70,           // アキュムレータをスタックにプッシュ
  Pop: 0x71,            // スタックからアキュムレータにポップ

  // その他
  Nop: 0x00,
  Debugger: 0xFF,
} as const;

export const OP_NAMES: Record<number, string> = {};
for (const [name, code] of Object.entries(Op)) { OP_NAMES[code] = name; }

// バイトコード命令
export interface Instruction {
  op: number;
  operands: number[];
  line: number;        // ソースの行番号
}

// コンパイル済み関数
export interface CompiledFunction {
  name: string;
  params: string[];
  instructions: Instruction[];
  constants: unknown[];     // 定数テーブル
  localNames: string[];     // ローカル変数名（レジスタ番号に対応）
  maxRegisters: number;
}

// AST → バイトコードコンパイラ
export class BytecodeCompiler {
  private constants: unknown[] = [];
  private instructions: Instruction[] = [];
  private locals = new Map<string, number>(); // 変数名 → レジスタ番号
  private nextReg = 0;
  private compiledFunctions: CompiledFunction[] = [];

  compile(program: Program): CompiledFunction {
    this.constants = [];
    this.instructions = [];
    this.locals.clear();
    this.nextReg = 0;

    for (const stmt of program.body) {
      this.compileStmt(stmt);
    }
    this.emit(Op.LdaUndefined, [], 0);
    this.emit(Op.Return, [], 0);

    return {
      name: "<main>",
      params: [],
      instructions: this.instructions,
      constants: this.constants,
      localNames: [...this.locals.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]),
      maxRegisters: this.nextReg,
    };
  }

  compileFunction(name: string, params: string[], body: Stmt[]): CompiledFunction {
    // 現在の状態を保存
    const savedConstants = this.constants;
    const savedInstructions = this.instructions;
    const savedLocals = this.locals;
    const savedNextReg = this.nextReg;

    this.constants = [];
    this.instructions = [];
    this.locals = new Map();
    this.nextReg = 0;

    // パラメータをローカル変数として登録
    for (const p of params) {
      this.locals.set(p, this.nextReg++);
    }

    for (const stmt of body) {
      this.compileStmt(stmt);
    }
    // 暗黙の return undefined
    this.emit(Op.LdaUndefined, [], 0);
    this.emit(Op.Return, [], 0);

    const func: CompiledFunction = {
      name,
      params,
      instructions: this.instructions,
      constants: this.constants,
      localNames: [...this.locals.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]),
      maxRegisters: this.nextReg,
    };

    // 復元
    this.constants = savedConstants;
    this.instructions = savedInstructions;
    this.locals = savedLocals;
    this.nextReg = savedNextReg;

    this.compiledFunctions.push(func);
    return func;
  }

  getCompiledFunctions(): CompiledFunction[] { return this.compiledFunctions; }

  private emit(op: number, operands: number[], line: number): number {
    const idx = this.instructions.length;
    this.instructions.push({ op, operands, line });
    return idx;
  }

  private addConstant(value: unknown): number {
    const idx = this.constants.indexOf(value);
    if (idx >= 0) return idx;
    this.constants.push(value);
    return this.constants.length - 1;
  }

  private getOrCreateLocal(name: string): number {
    const existing = this.locals.get(name);
    if (existing !== undefined) return existing;
    const reg = this.nextReg++;
    this.locals.set(name, reg);
    return reg;
  }

  // === 文のコンパイル ===

  private compileStmt(stmt: Stmt): void {
    switch (stmt.type) {
      case "expr_stmt": this.compileExpr(stmt.expr); break;
      case "var_decl": {
        const reg = this.getOrCreateLocal(stmt.name);
        if (stmt.init !== undefined) {
          this.compileExpr(stmt.init);
        } else {
          this.emit(Op.LdaUndefined, [], 0);
        }
        this.emit(Op.Star, [reg], 0);
        break;
      }
      case "function_decl": {
        const func = this.compileFunction(stmt.name, stmt.params, stmt.body);
        const funcIdx = this.addConstant(func);
        this.emit(Op.CreateClosure, [funcIdx], 0);
        const reg = this.getOrCreateLocal(stmt.name);
        this.emit(Op.Star, [reg], 0);
        // グローバルにも登録（再帰呼び出し用）
        this.emit(Op.StaGlobal, [this.addConstant(stmt.name)], 0);
        break;
      }
      case "return_stmt": {
        if (stmt.value !== undefined) this.compileExpr(stmt.value);
        else this.emit(Op.LdaUndefined, [], 0);
        this.emit(Op.Return, [], 0);
        break;
      }
      case "if_stmt": {
        this.compileExpr(stmt.test);
        const jumpIfFalse = this.emit(Op.JumpIfFalse, [0], 0); // パッチ対象
        this.compileStmt(stmt.consequent);
        if (stmt.alternate !== undefined) {
          const jumpOver = this.emit(Op.Jump, [0], 0);
          this.instructions[jumpIfFalse]!.operands[0] = this.instructions.length;
          this.compileStmt(stmt.alternate);
          this.instructions[jumpOver]!.operands[0] = this.instructions.length;
        } else {
          this.instructions[jumpIfFalse]!.operands[0] = this.instructions.length;
        }
        break;
      }
      case "while_stmt": {
        const loopStart = this.instructions.length;
        this.compileExpr(stmt.test);
        const jumpIfFalse = this.emit(Op.JumpIfFalse, [0], 0);
        this.compileStmt(stmt.body);
        this.emit(Op.Jump, [loopStart], 0);
        this.instructions[jumpIfFalse]!.operands[0] = this.instructions.length;
        break;
      }
      case "for_stmt": {
        if (stmt.init !== undefined) this.compileStmt(stmt.init);
        const loopStart = this.instructions.length;
        if (stmt.test !== undefined) {
          this.compileExpr(stmt.test);
        } else {
          this.emit(Op.LdaTrue, [], 0);
        }
        const jumpIfFalse = this.emit(Op.JumpIfFalse, [0], 0);
        this.compileStmt(stmt.body);
        if (stmt.update !== undefined) this.compileExpr(stmt.update);
        this.emit(Op.Jump, [loopStart], 0);
        this.instructions[jumpIfFalse]!.operands[0] = this.instructions.length;
        break;
      }
      case "block": for (const s of stmt.body) this.compileStmt(s); break;
      case "empty": break;
    }
  }

  // === 式のコンパイル ===

  private compileExpr(expr: Expr): void {
    switch (expr.type) {
      case "number":
        if (Number.isInteger(expr.value) && expr.value >= -128 && expr.value <= 127) {
          this.emit(Op.LdaSmi, [expr.value], 0);
        } else {
          this.emit(Op.LdaConst, [this.addConstant(expr.value)], 0);
        }
        break;
      case "string": this.emit(Op.LdaConst, [this.addConstant(expr.value)], 0); break;
      case "boolean": this.emit(expr.value ? Op.LdaTrue : Op.LdaFalse, [], 0); break;
      case "null": this.emit(Op.LdaNull, [], 0); break;
      case "undefined": this.emit(Op.LdaUndefined, [], 0); break;
      case "identifier": {
        const reg = this.locals.get(expr.name);
        if (reg !== undefined) {
          this.emit(Op.Ldar, [reg], 0);
        } else {
          this.emit(Op.LdaGlobal, [this.addConstant(expr.name)], 0);
        }
        break;
      }
      case "binary": {
        this.compileExpr(expr.left);
        const tempReg = this.nextReg++;
        this.emit(Op.Star, [tempReg], 0);
        this.compileExpr(expr.right);
        // acc = right, reg = left → swap して演算
        const rightReg = this.nextReg++;
        this.emit(Op.Star, [rightReg], 0);
        this.emit(Op.Ldar, [tempReg], 0);
        const opMap: Record<string, number | undefined> = {
          "+": Op.Add, "-": Op.Sub, "*": Op.Mul, "/": Op.Div, "%": Op.Mod,
          "==": Op.CmpEq, "===": Op.CmpStrictEq, "<": Op.CmpLt, ">": Op.CmpGt,
          "<=": Op.CmpLtEq, ">=": Op.CmpGtEq,
          "&&": Op.CmpEq, "||": Op.CmpEq, // 簡略化
        };
        const opCode = opMap[expr.op];
        if (opCode !== undefined) this.emit(opCode, [rightReg], 0);
        break;
      }
      case "assign": {
        this.compileExpr(expr.right);
        if (expr.left.type === "identifier") {
          const reg = this.locals.get(expr.left.name);
          if (reg !== undefined) {
            this.emit(Op.Star, [reg], 0);
          } else {
            this.emit(Op.StaGlobal, [this.addConstant(expr.left.name)], 0);
          }
        }
        break;
      }
      case "unary": {
        this.compileExpr(expr.operand);
        if (expr.op === "!") this.emit(Op.LogNot, [], 0);
        if (expr.op === "-") {
          const tempReg = this.nextReg++;
          this.emit(Op.Star, [tempReg], 0);
          this.emit(Op.LdaSmi, [0], 0);
          this.emit(Op.Sub, [tempReg], 0);
        }
        break;
      }
      case "call": {
        // 引数をレジスタに格納
        const argRegs: number[] = [];
        for (const arg of expr.args) {
          this.compileExpr(arg);
          const reg = this.nextReg++;
          this.emit(Op.Star, [reg], 0);
          argRegs.push(reg);
        }
        // callee をロード
        this.compileExpr(expr.callee);
        const calleeReg = this.nextReg++;
        this.emit(Op.Star, [calleeReg], 0);
        // 引数をプッシュ
        for (const r of argRegs) {
          this.emit(Op.Ldar, [r], 0);
          this.emit(Op.Push, [], 0);
        }
        this.emit(Op.Ldar, [calleeReg], 0);
        this.emit(Op.Call, [calleeReg, expr.args.length], 0);
        break;
      }
      case "member": {
        this.compileExpr(expr.object);
        const objReg = this.nextReg++;
        this.emit(Op.Star, [objReg], 0);
        this.emit(Op.LdaProperty, [objReg, this.addConstant(expr.property)], 0);
        break;
      }
      case "arrow":
      case "function_expr": {
        const name = expr.type === "function_expr" ? expr.name ?? "<anon>" : "<arrow>";
        const params = expr.params;
        const body = "body" in expr
          ? (Array.isArray(expr.body) ? expr.body : [expr.body])
          : [];
        // body が Expr の場合は return 文に変換
        let stmts: Stmt[];
        if (expr.type === "arrow" && !Array.isArray(expr.body) && expr.body.type !== "block") {
          stmts = [{ type: "return_stmt", value: expr.body }];
        } else if (expr.type === "arrow" && "body" in expr.body && expr.body.type === "block") {
          stmts = (expr.body as { type: "block"; body: Stmt[] }).body;
        } else if (expr.type === "function_expr") {
          stmts = expr.body;
        } else {
          stmts = body as Stmt[];
        }
        const func = this.compileFunction(name, params, stmts);
        const funcIdx = this.addConstant(func);
        this.emit(Op.CreateClosure, [funcIdx], 0);
        break;
      }
      case "array": {
        for (const el of expr.elements) {
          this.compileExpr(el);
          this.emit(Op.Push, [], 0);
        }
        this.emit(Op.CreateArray, [expr.elements.length], 0);
        break;
      }
      case "object": {
        for (const prop of expr.properties) {
          this.emit(Op.LdaConst, [this.addConstant(prop.key)], 0);
          this.emit(Op.Push, [], 0);
          this.compileExpr(prop.value);
          this.emit(Op.Push, [], 0);
        }
        this.emit(Op.CreateObject, [expr.properties.length], 0);
        break;
      }
      case "this": this.emit(Op.LdaGlobal, [this.addConstant("this")], 0); break;
      default: this.emit(Op.LdaUndefined, [], 0);
    }
  }
}
