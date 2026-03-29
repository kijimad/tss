/**
 * vm.ts -- Go VM (goroutine スケジューラ + チャネル)
 *
 * Go のランタイムをエミュレート:
 *   - goroutine: 軽量スレッド。協調的スケジューリングで切り替え
 *   - channel: goroutine 間の通信
 *   - defer: 関数終了時に逆順で実行
 */
import type { Program, Stmt, Expr, Param } from "../parser/ast.js";

export type GoValue = number | string | boolean | null | GoSlice | GoMap | GoChan | GoFunc | undefined;
export interface GoSlice { kind: "slice"; elements: GoValue[]; }
export interface GoMap { kind: "map"; entries: Map<string, GoValue>; }
export interface GoChan { kind: "chan"; buffer: GoValue[]; capacity: number; waitingSend: { value: GoValue; resolve: () => void }[]; waitingRecv: { resolve: (v: GoValue) => void }[]; }
export interface GoFunc { kind: "func"; params: Param[]; body: Stmt[]; closure: Scope; }

type Scope = Map<string, GoValue>;

// Goroutine
interface Goroutine {
  id: number;
  state: "running" | "blocked" | "done";
  // 実行する関数
  run: () => void;
}

export type VmEvent =
  | { type: "stdout"; text: string }
  | { type: "goroutine_create"; id: number; name: string }
  | { type: "goroutine_done"; id: number }
  | { type: "goroutine_block"; id: number; reason: string }
  | { type: "goroutine_resume"; id: number }
  | { type: "chan_send"; goroutine: number; value: string }
  | { type: "chan_recv"; goroutine: number; value: string }
  | { type: "defer_exec"; func: string }
  | { type: "exec"; stmt: string };

export class GoVM {
  stdout = "";
  events: VmEvent[] = [];
  onEvent: ((event: VmEvent) => void) | undefined;
  private globalScope: Scope = new Map();
  private goroutines: Goroutine[] = [];
  private nextGoroutineId = 1;
  private currentGoroutineId = 0;

  private emit(event: VmEvent): void { this.events.push(event); this.onEvent?.(event); }

  execute(program: Program): void {
    this.stdout = ""; this.events = []; this.globalScope = new Map();
    this.goroutines = []; this.nextGoroutineId = 1;

    // 組み込み関数
    this.globalScope.set("println", { kind: "func", params: [], body: [], closure: new Map() });
    this.globalScope.set("fmt", null); // fmt.Println は特別扱い

    // トップレベル関数を先に登録
    for (const stmt of program.body) {
      if (stmt.type === "func_decl") {
        const fn: GoFunc = { kind: "func", params: stmt.params, body: stmt.body, closure: new Map(this.globalScope) };
        this.globalScope.set(stmt.name, fn);
      }
    }

    // main() を実行
    const mainFn = this.globalScope.get("main");
    if (mainFn !== undefined && mainFn !== null && typeof mainFn === "object" && "kind" in mainFn && mainFn.kind === "func") {
      this.currentGoroutineId = 0;
      this.emit({ type: "goroutine_create", id: 0, name: "main" });
      this.execBlock(mainFn.body, new Map(this.globalScope));
    } else {
      // main がなければトップレベルを実行
      this.execBlock(program.body, this.globalScope);
    }
  }

  private execBlock(stmts: Stmt[], scope: Scope): GoValue {
    const deferred: { fn: GoFunc; args: GoValue[] }[] = [];

    for (const stmt of stmts) {
      const result = this.execStmt(stmt, scope, deferred);
      if (result !== undefined && result !== null && typeof result === "object" && "returnValue" in result) {
        // defer を実行
        this.runDeferred(deferred);
        return (result as { returnValue: GoValue[] }).returnValue[0];
      }
    }
    this.runDeferred(deferred);
    return undefined;
  }

  private runDeferred(deferred: { fn: GoFunc; args: GoValue[] }[]): void {
    while (deferred.length > 0) {
      const d = deferred.pop();
      if (d !== undefined) {
        this.emit({ type: "defer_exec", func: "deferred" });
        const childScope = new Map(d.fn.closure);
        for (let i = 0; i < d.fn.params.length; i++) {
          const p = d.fn.params[i]; if (p !== undefined) childScope.set(p.name, d.args[i]);
        }
        this.execBlock(d.fn.body, childScope);
      }
    }
  }

  private execStmt(stmt: Stmt, scope: Scope, deferred: { fn: GoFunc; args: GoValue[] }[]): unknown {
    this.emit({ type: "exec", stmt: stmt.type });

    switch (stmt.type) {
      case "empty": case "package_decl": case "import_decl": break;
      case "func_decl": {
        const fn: GoFunc = { kind: "func", params: stmt.params, body: stmt.body, closure: new Map(scope) };
        scope.set(stmt.name, fn);
        this.globalScope.set(stmt.name, fn);
        break;
      }
      case "var_decl": scope.set(stmt.name, stmt.init !== undefined ? this.evalExpr(stmt.init, scope) : this.defaultValue(stmt.typeName)); break;
      case "short_decl": scope.set(stmt.name, this.evalExpr(stmt.init, scope)); break;
      case "assign": {
        const val = this.evalExpr(stmt.value, scope);
        if (stmt.target.type === "ident") {
          const old = scope.get(stmt.target.name);
          if (stmt.op === "+=") scope.set(stmt.target.name, add(old, val));
          else if (stmt.op === "-=") scope.set(stmt.target.name, toNum(old) - toNum(val));
          else scope.set(stmt.target.name, val);
        } else if (stmt.target.type === "index") {
          const obj = this.evalExpr(stmt.target.object, scope);
          const idx = this.evalExpr(stmt.target.index, scope);
          if (obj !== null && obj !== undefined && typeof obj === "object" && "kind" in obj) {
            if (obj.kind === "slice") obj.elements[toNum(idx)] = val;
            if (obj.kind === "map") obj.entries.set(String(idx ?? ""), val);
          }
        }
        break;
      }
      case "inc_dec": {
        if (stmt.target.type === "ident") {
          const old = toNum(scope.get(stmt.target.name));
          scope.set(stmt.target.name, stmt.op === "++" ? old + 1 : old - 1);
        }
        break;
      }
      case "expr_stmt": this.evalExpr(stmt.expr, scope); break;
      case "return_stmt": {
        const values = stmt.values.map(v => this.evalExpr(v, scope));
        return { returnValue: values };
      }
      case "if_stmt": {
        const childScope = new Map(scope);
        if (stmt.init !== undefined) this.execStmt(stmt.init, childScope, deferred);
        if (toBool(this.evalExpr(stmt.cond, childScope))) {
          const r = this.execBlock(stmt.body, childScope);
          if (r !== undefined) return { returnValue: [r] };
        } else if (stmt.elseBody !== undefined) {
          const r = this.execBlock(stmt.elseBody, childScope);
          if (r !== undefined) return { returnValue: [r] };
        }
        break;
      }
      case "for_stmt": {
        // init がある場合のみ子スコープ（:= で新変数を作る場合）
        const childScope = stmt.init !== undefined ? new Map(scope) : scope;
        if (stmt.init !== undefined) this.execStmt(stmt.init, childScope, deferred);
        let limit = 10000;
        while (limit-- > 0) {
          if (stmt.cond !== undefined && !toBool(this.evalExpr(stmt.cond, childScope))) break;
          let brk = false;
          for (const s of stmt.body) {
            if (s.type === "break_stmt") { brk = true; break; }
            if (s.type === "continue_stmt") break;
            const r = this.execStmt(s, childScope, deferred);
            if (r !== undefined && typeof r === "object" && r !== null && "returnValue" in r) return r;
          }
          if (brk) break;
          if (stmt.post !== undefined) this.execStmt(stmt.post, childScope, deferred);
        }
        break;
      }
      case "for_range": {
        const iterable = this.evalExpr(stmt.iterable, scope);
        if (iterable !== null && iterable !== undefined && typeof iterable === "object" && "kind" in iterable && iterable.kind === "slice") {
          for (let i = 0; i < iterable.elements.length; i++) {
            const childScope = new Map(scope);
            childScope.set(stmt.key, i);
            if (stmt.value !== undefined) childScope.set(stmt.value, iterable.elements[i]);
            let brk = false;
            for (const s of stmt.body) {
              if (s.type === "break_stmt") { brk = true; break; }
              const r = this.execStmt(s, childScope, deferred);
              if (r !== undefined && typeof r === "object" && r !== null && "returnValue" in r) return r;
            }
            if (brk) break;
          }
        } else if (typeof iterable === "string") {
          for (let i = 0; i < iterable.length; i++) {
            const childScope = new Map(scope);
            childScope.set(stmt.key, i);
            if (stmt.value !== undefined) childScope.set(stmt.value, iterable.charCodeAt(i));
            for (const s of stmt.body) { this.execStmt(s, childScope, deferred); }
          }
        }
        break;
      }
      case "switch_stmt": {
        const tag = stmt.tag !== undefined ? this.evalExpr(stmt.tag, scope) : true;
        let matched = false;
        for (const c of stmt.cases) {
          if (c.exprs.length === 0) { if (!matched) { this.execBlock(c.body, scope); matched = true; } }
          else {
            for (const e of c.exprs) { if (this.evalExpr(e, scope) === tag) { this.execBlock(c.body, scope); matched = true; break; } }
          }
          if (matched) break;
        }
        break;
      }
      case "go_stmt": {
        if (stmt.call.type === "call") {
          const fn = this.evalExpr(stmt.call.callee, scope);
          const args = stmt.call.args.map(a => this.evalExpr(a, scope));
          if (fn !== null && fn !== undefined && typeof fn === "object" && "kind" in fn && fn.kind === "func") {
            const id = this.nextGoroutineId++;
            this.emit({ type: "goroutine_create", id, name: stmt.call.callee.type === "ident" ? stmt.call.callee.name : "anon" });
            const childScope = new Map(fn.closure);
            for (let i = 0; i < fn.params.length; i++) { const p = fn.params[i]; if (p !== undefined) childScope.set(p.name, args[i]); }
            // 同期的に実行（簡易版）
            this.currentGoroutineId = id;
            this.execBlock(fn.body, childScope);
            this.emit({ type: "goroutine_done", id });
            this.currentGoroutineId = 0;
          }
        }
        break;
      }
      case "chan_send": {
        const ch = this.evalExpr(stmt.channel, scope);
        const val = this.evalExpr(stmt.value, scope);
        if (ch !== null && ch !== undefined && typeof ch === "object" && "kind" in ch && ch.kind === "chan") {
          ch.buffer.push(val);
          this.emit({ type: "chan_send", goroutine: this.currentGoroutineId, value: String(val ?? "") });
        }
        break;
      }
      case "defer_stmt": {
        if (stmt.call.type === "call") {
          const fn = this.evalExpr(stmt.call.callee, scope);
          const args = stmt.call.args.map(a => this.evalExpr(a, scope));
          if (fn !== null && fn !== undefined && typeof fn === "object" && "kind" in fn && fn.kind === "func") {
            deferred.push({ fn, args });
          }
        }
        break;
      }
      case "block": {
        const r = this.execBlock(stmt.body, new Map(scope));
        if (r !== undefined) return { returnValue: [r] };
        break;
      }
    }
    return undefined;
  }

  private evalExpr(expr: Expr, scope: Scope): GoValue {
    switch (expr.type) {
      case "number": return expr.value;
      case "string": return expr.value;
      case "bool": return expr.value;
      case "nil": return null;
      case "ident": return scope.get(expr.name) ?? this.globalScope.get(expr.name);
      case "binary": {
        const l = this.evalExpr(expr.left, scope); const r = this.evalExpr(expr.right, scope);
        switch (expr.op) {
          case "+": return add(l, r);
          case "-": return toNum(l) - toNum(r);
          case "*": return toNum(l) * toNum(r);
          case "/": return toNum(r) !== 0 ? toNum(l) / toNum(r) : 0;
          case "%": return toNum(r) !== 0 ? toNum(l) % toNum(r) : 0;
          case "==": return l === r;
          case "!=": return l !== r;
          case "<": return toNum(l) < toNum(r);
          case ">": return toNum(l) > toNum(r);
          case "<=": return toNum(l) <= toNum(r);
          case ">=": return toNum(l) >= toNum(r);
          case "&&": return toBool(l) && toBool(r);
          case "||": return toBool(l) || toBool(r);
        }
        return undefined;
      }
      case "unary": {
        const v = this.evalExpr(expr.operand, scope);
        if (expr.op === "-") return -toNum(v);
        if (expr.op === "!") return !toBool(v);
        return v;
      }
      case "call": {
        const callee = this.evalExpr(expr.callee, scope);
        const args = expr.args.map(a => this.evalExpr(a, scope));
        // println 組み込み
        if (expr.callee.type === "ident" && expr.callee.name === "println") {
          const text = args.map(a => formatGo(a)).join(" ") + "\n";
          this.stdout += text; this.emit({ type: "stdout", text }); return undefined;
        }
        // fmt.Println
        if (expr.callee.type === "selector" && expr.callee.field === "Println") {
          const text = args.map(a => formatGo(a)).join(" ") + "\n";
          this.stdout += text; this.emit({ type: "stdout", text }); return undefined;
        }
        if (expr.callee.type === "selector" && expr.callee.field === "Sprintf") {
          return args.map(a => formatGo(a)).join(" ");
        }
        if (callee !== null && callee !== undefined && typeof callee === "object" && "kind" in callee && callee.kind === "func") {
          const childScope = new Map(callee.closure);
          for (let i = 0; i < callee.params.length; i++) { const p = callee.params[i]; if (p !== undefined) childScope.set(p.name, args[i]); }
          return this.execBlock(callee.body, childScope);
        }
        return undefined;
      }
      case "index": {
        const obj = this.evalExpr(expr.object, scope); const idx = this.evalExpr(expr.index, scope);
        if (obj !== null && obj !== undefined && typeof obj === "object" && "kind" in obj) {
          if (obj.kind === "slice") return obj.elements[toNum(idx)];
          if (obj.kind === "map") return obj.entries.get(String(idx ?? ""));
        }
        if (typeof obj === "string") return obj.charCodeAt(toNum(idx));
        return undefined;
      }
      case "selector": {
        const obj = this.evalExpr(expr.object, scope);
        if (obj !== null && obj !== undefined && typeof obj === "object" && "kind" in obj && obj.kind === "map") return obj.entries.get(expr.field);
        return undefined;
      }
      case "slice_lit": return { kind: "slice", elements: expr.elements.map(e => this.evalExpr(e, scope)) };
      case "map_lit": {
        const entries = new Map<string, GoValue>();
        for (const e of expr.entries) entries.set(String(this.evalExpr(e.key, scope) ?? ""), this.evalExpr(e.value, scope));
        return { kind: "map", entries };
      }
      case "make_expr": {
        if (expr.kind.startsWith("chan")) return { kind: "chan", buffer: [], capacity: 0, waitingSend: [], waitingRecv: [] };
        if (expr.kind.startsWith("[]")) return { kind: "slice", elements: new Array(toNum(expr.args[0] !== undefined ? this.evalExpr(expr.args[0], scope) : 0)).fill(0) };
        if (expr.kind.startsWith("map")) return { kind: "map", entries: new Map() };
        return undefined;
      }
      case "len_expr": {
        const v = this.evalExpr(expr.arg, scope);
        if (typeof v === "string") return v.length;
        if (v !== null && v !== undefined && typeof v === "object" && "kind" in v && v.kind === "slice") return v.elements.length;
        return 0;
      }
      case "append_expr": {
        const sl = this.evalExpr(expr.slice, scope);
        if (sl !== null && sl !== undefined && typeof sl === "object" && "kind" in sl && sl.kind === "slice") {
          const newEls = expr.elements.map(e => this.evalExpr(e, scope));
          return { kind: "slice", elements: [...sl.elements, ...newEls] };
        }
        return sl;
      }
      case "chan_recv": {
        const ch = this.evalExpr(expr.channel, scope);
        if (ch !== null && ch !== undefined && typeof ch === "object" && "kind" in ch && ch.kind === "chan") {
          const val = ch.buffer.shift();
          this.emit({ type: "chan_recv", goroutine: this.currentGoroutineId, value: String(val ?? "") });
          return val;
        }
        return undefined;
      }
      case "func_lit": return { kind: "func", params: expr.params, body: expr.body, closure: new Map(scope) };
      case "composite_lit": return undefined; // 簡略化
    }
    return undefined;
  }

  private defaultValue(typeName: string | undefined): GoValue {
    if (typeName === undefined) return undefined;
    if (typeName === "int" || typeName === "float64") return 0;
    if (typeName === "string") return "";
    if (typeName === "bool") return false;
    return undefined;
  }
}

function toNum(v: GoValue): number { return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0; }
function toBool(v: GoValue): boolean { return v !== null && v !== undefined && v !== 0 && v !== "" && v !== false; }
function add(a: GoValue, b: GoValue): GoValue {
  if (typeof a === "string" || typeof b === "string") return String(a ?? "") + String(b ?? "");
  return toNum(a) + toNum(b);
}
function formatGo(v: GoValue): string {
  if (v === null) return "<nil>";
  if (v === undefined) return "<nil>";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "kind" in v) {
    if (v.kind === "slice") return `[${v.elements.map(formatGo).join(" ")}]`;
    if (v.kind === "map") { const es = [...v.entries.entries()].map(([k, val]) => `${k}:${formatGo(val)}`); return `map[${es.join(" ")}]`; }
    if (v.kind === "chan") return "chan";
    if (v.kind === "func") return "func";
  }
  return String(v);
}
