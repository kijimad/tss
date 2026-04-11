import { describe, it, expect } from "vitest";
import { tokenize } from "../compiler/lexer.js";
import { parse } from "../compiler/parser.js";
import { compile } from "../compiler/compiler.js";
import { presets } from "../compiler/presets.js";

// ===== 字句解析 =====

describe("レキサー", () => {
  it("基本的なトークンを正しく分解する", () => {
    const tokens = tokenize("int main() { return 42; }");
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual([
      "int", "ident", "lparen", "rparen", "lbrace",
      "return", "number", "semicolon", "rbrace", "eof",
    ]);
  });

  it("数値リテラルの値が正しい", () => {
    const tokens = tokenize("123 0 9999");
    expect(tokens[0]!.value).toBe("123");
    expect(tokens[1]!.value).toBe("0");
    expect(tokens[2]!.value).toBe("9999");
  });

  it("演算子を正しく認識する", () => {
    const tokens = tokenize("+ - * / % == != < <= > >=");
    const kinds = tokens.filter((t) => t.kind !== "eof").map((t) => t.kind);
    expect(kinds).toEqual([
      "plus", "minus", "star", "slash", "percent",
      "eq", "neq", "lt", "le", "gt", "ge",
    ]);
  });

  it("文字列リテラルを解析する", () => {
    const tokens = tokenize('"Hello\\nWorld"');
    expect(tokens[0]!.kind).toBe("string");
    expect(tokens[0]!.value).toBe("Hello\nWorld");
  });

  it("キーワードと識別子を区別する", () => {
    const tokens = tokenize("int x if else while for myVar");
    const kinds = tokens.filter((t) => t.kind !== "eof").map((t) => t.kind);
    expect(kinds).toEqual(["int", "ident", "if", "else", "while", "for", "ident"]);
  });

  it("行コメントをスキップする", () => {
    const tokens = tokenize("int x; // コメント\nint y;");
    const idents = tokens.filter((t) => t.kind === "ident");
    expect(idents).toHaveLength(2);
  });

  it("行番号と列番号を追跡する", () => {
    const tokens = tokenize("int\nx");
    const xToken = tokens.find((t) => t.value === "x");
    expect(xToken!.line).toBe(2);
    expect(xToken!.col).toBe(1);
  });
});

// ===== 構文解析 =====

describe("パーサー", () => {
  it("関数宣言をパースする", () => {
    const tokens = tokenize("int main() { return 0; }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(ast.kind).toBe("program");
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0]!.kind).toBe("func_decl");
    expect(ast.children[0]!.name).toBe("main");
  });

  it("変数宣言と初期化をパースする", () => {
    const tokens = tokenize("int f() { int x = 42; return x; }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const body = ast.children[0]!.children[1]!;
    expect(body.children[0]!.kind).toBe("var_decl");
    expect(body.children[0]!.name).toBe("x");
  });

  it("if-else文をパースする", () => {
    const tokens = tokenize("int f() { if (x > 0) { return 1; } else { return 0; } }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const ifStmt = ast.children[0]!.children[1]!.children[0]!;
    expect(ifStmt.kind).toBe("if_stmt");
    expect(ifStmt.children).toHaveLength(3); // 条件、then、else
  });

  it("while文をパースする", () => {
    const tokens = tokenize("int f() { while (i < 10) { i = i + 1; } return 0; }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const whileStmt = ast.children[0]!.children[1]!.children[0]!;
    expect(whileStmt.kind).toBe("while_stmt");
  });

  it("for文をパースする", () => {
    const tokens = tokenize("int f() { for (int i = 0; i < 10; i = i + 1) { x = x + 1; } return 0; }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const forStmt = ast.children[0]!.children[1]!.children[0]!;
    expect(forStmt.kind).toBe("for_stmt");
    expect(forStmt.children).toHaveLength(4); // init, cond, update, body
  });

  it("関数呼び出しをパースする", () => {
    const tokens = tokenize("int f() { return add(1, 2); }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const ret = ast.children[0]!.children[1]!.children[0]!;
    const callExpr = ret.children[0]!;
    expect(callExpr.kind).toBe("call_expr");
    expect(callExpr.name).toBe("add");
    expect(callExpr.children).toHaveLength(2);
  });

  it("パラメータをパースする", () => {
    const tokens = tokenize("int add(int a, int b) { return a + b; }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const paramsBlock = ast.children[0]!.children[0]!;
    expect(paramsBlock.children).toHaveLength(2);
    expect(paramsBlock.children[0]!.name).toBe("a");
    expect(paramsBlock.children[1]!.name).toBe("b");
  });

  it("演算子の優先順位を正しく処理する", () => {
    const tokens = tokenize("int f() { return 1 + 2 * 3; }");
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    // + の右辺が * ノードになっているはず
    const retExpr = ast.children[0]!.children[1]!.children[0]!.children[0]!;
    expect(retExpr.kind).toBe("binary_expr");
    expect(retExpr.op).toBe("+");
    expect(retExpr.children[1]!.op).toBe("*");
  });
});

// ===== コンパイル =====

describe("コンパイラ", () => {
  it("最小プログラムをコンパイルできる", () => {
    const result = compile("int main() { return 0; }");
    expect(result.success).toBe(true);
    expect(result.objectFile).not.toBeNull();
    expect(result.objectFile!.sections.length).toBeGreaterThan(0);
  });

  it(".textセクションにコードが生成される", () => {
    const result = compile("int main() { return 42; }");
    const text = result.objectFile!.sections.find((s) => s.name === ".text");
    expect(text).toBeDefined();
    expect(text!.data.length).toBeGreaterThan(0);
  });

  it("関数がシンボルテーブルに登録される", () => {
    const result = compile("int foo() { return 1; } int bar() { return 2; }");
    const symbols = result.objectFile!.symbols;
    expect(symbols.find((s) => s.name === "foo")).toBeDefined();
    expect(symbols.find((s) => s.name === "bar")).toBeDefined();
  });

  it("関数シンボルのオフセットが正しい", () => {
    const result = compile("int first() { return 0; } int second() { return 0; }");
    const first = result.objectFile!.symbols.find((s) => s.name === "first");
    const second = result.objectFile!.symbols.find((s) => s.name === "second");
    expect(first!.offset).toBe(0);
    expect(second!.offset).toBeGreaterThan(0);
  });

  it("関数呼び出しでリロケーションが生成される", () => {
    const result = compile("int foo() { return 0; } int main() { return foo(); }");
    const relocs = result.objectFile!.relocations;
    const callReloc = relocs.find((r) => r.symbol === "foo" && r.type === "R_REL32");
    expect(callReloc).toBeDefined();
  });

  it("文字列リテラルが.rodataに配置される", () => {
    const result = compile('int f() { return 0; } int main() { f("hello"); return 0; }');
    // パース的にfの引数として文字列を渡す形
    expect(result.success).toBe(true);
    const rodata = result.objectFile!.sections.find((s) => s.name === ".rodata");
    expect(rodata).toBeDefined();
  });

  it("コンパイルステップが記録される", () => {
    const result = compile("int main() { return 0; }");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.some((s) => s.phase === "lex")).toBe(true);
    expect(result.steps.some((s) => s.phase === "parse")).toBe(true);
    expect(result.steps.some((s) => s.phase === "codegen")).toBe(true);
  });

  it("ローカル変数のSTORE/LOAD命令が生成される", () => {
    const result = compile("int main() { int x = 10; return x; }");
    expect(result.success).toBe(true);
    const text = result.objectFile!.sections.find((s) => s.name === ".text");
    expect(text!.data.length).toBeGreaterThan(5);
  });

  it("if文のジャンプ命令が生成される", () => {
    const result = compile("int main() { if (1) { return 1; } return 0; }");
    expect(result.success).toBe(true);
    // JE命令（0x22）が含まれるはず
    const text = result.objectFile!.sections.find((s) => s.name === ".text");
    expect(text!.data.includes(0x22)).toBe(true);
  });

  it("while文のJMP命令が生成される", () => {
    const result = compile("int main() { int i = 0; while (i < 10) { i = i + 1; } return i; }");
    expect(result.success).toBe(true);
    const text = result.objectFile!.sections.find((s) => s.name === ".text");
    // JMP命令（0x21）が含まれるはず
    expect(text!.data.includes(0x21)).toBe(true);
  });
});

// ===== プリセット =====

describe("プリセット", () => {
  it("全プリセットがエラーなくコンパイルできる", () => {
    for (const preset of presets) {
      const result = compile(preset.source);
      expect(result.success, `${preset.name}: ${result.errors.join(", ")}`).toBe(true);
      expect(result.objectFile, `${preset.name}: オブジェクトファイルが生成されない`).not.toBeNull();
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });

  it("全プリセットにシンボルが含まれる", () => {
    for (const preset of presets) {
      const result = compile(preset.source);
      expect(result.objectFile!.symbols.length, `${preset.name}`).toBeGreaterThan(0);
    }
  });
});
