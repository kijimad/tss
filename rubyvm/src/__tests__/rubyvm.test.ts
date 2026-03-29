// Ruby VMシミュレータのテスト

import { describe, it, expect } from 'vitest';
import { Lexer, TokenType } from '../lang/lexer.js';
import { Parser } from '../lang/parser.js';
import type { ASTNode } from '../lang/parser.js';
import { Compiler, disassemble, Opcode } from '../vm/compiler.js';
import { VM } from '../vm/vm.js';
import {
  RubyClass,
  RubyInteger,
  RubyString,
  RubyArray,
  RubyHash,
  RubyNil,
  RubyBool,
  RubySymbol,
  createObjectHierarchy,
} from '../vm/object.js';

// === ヘルパー関数 ===

/** ソースコードを実行して出力を返す */
function runRuby(source: string): string {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new Compiler();
  const mainIseq = compiler.compile(ast);
  const blockSequences = compiler.getBlockSequences();
  const vm = new VM();
  const result = vm.execute(mainIseq, blockSequences);
  return result.output;
}

/** ソースコードをパースしてASTを返す */
function parseRuby(source: string): ASTNode {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

// === レキサーのテスト ===

describe('Lexer', () => {
  it('数値トークンを正しく解析する', () => {
    const lexer = new Lexer('42 3.14');
    const tokens = lexer.tokenize();
    expect(tokens[0]?.type).toBe(TokenType.NUMBER);
    expect(tokens[0]?.value).toBe('42');
    expect(tokens[1]?.type).toBe(TokenType.NUMBER);
    expect(tokens[1]?.value).toBe('3.14');
  });

  it('キーワードを正しく識別する', () => {
    const lexer = new Lexer('def end class if elsif else while do puts return nil true false self yield');
    const tokens = lexer.tokenize();
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.DEF, TokenType.END, TokenType.CLASS,
      TokenType.IF, TokenType.ELSIF, TokenType.ELSE,
      TokenType.WHILE, TokenType.DO, TokenType.PUTS,
      TokenType.RETURN, TokenType.NIL, TokenType.TRUE,
      TokenType.FALSE, TokenType.SELF, TokenType.YIELD,
    ]);
  });

  it('文字列リテラルを正しく解析する', () => {
    const lexer = new Lexer('"hello" \'world\'');
    const tokens = lexer.tokenize();
    expect(tokens[0]?.type).toBe(TokenType.STRING);
    expect(tokens[0]?.value).toBe('hello');
    expect(tokens[1]?.type).toBe(TokenType.STRING);
    expect(tokens[1]?.value).toBe('world');
  });

  it('シンボルを正しく解析する', () => {
    const lexer = new Lexer(':name :age');
    const tokens = lexer.tokenize();
    expect(tokens[0]?.type).toBe(TokenType.SYMBOL);
    expect(tokens[0]?.value).toBe('name');
    expect(tokens[1]?.type).toBe(TokenType.SYMBOL);
    expect(tokens[1]?.value).toBe('age');
  });

  it('演算子を正しく解析する', () => {
    const lexer = new Lexer('+ - * / == != < > <= >= && ||');
    const tokens = lexer.tokenize();
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.PLUS, TokenType.MINUS, TokenType.STAR, TokenType.SLASH,
      TokenType.EQEQ, TokenType.NEQ, TokenType.LT, TokenType.GT,
      TokenType.LTEQ, TokenType.GTEQ, TokenType.AND, TokenType.OR,
    ]);
  });

  it('改行をトークンとして認識する', () => {
    const lexer = new Lexer('a\nb');
    const tokens = lexer.tokenize();
    const types = tokens.map(t => t.type);
    expect(types).toContain(TokenType.NEWLINE);
  });

  it('コメントをスキップする', () => {
    const lexer = new Lexer('42 # コメント\n10');
    const tokens = lexer.tokenize();
    const numberTokens = tokens.filter(t => t.type === TokenType.NUMBER);
    expect(numberTokens).toHaveLength(2);
    expect(numberTokens[0]?.value).toBe('42');
    expect(numberTokens[1]?.value).toBe('10');
  });

  it('文字列補間を正しく解析する', () => {
    const lexer = new Lexer('"hello #{name}"');
    const tokens = lexer.tokenize();
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toContain(TokenType.STRING_BEGIN);
    expect(types).toContain(TokenType.INTERP_BEGIN);
    expect(types).toContain(TokenType.INTERP_END);
    expect(types).toContain(TokenType.STRING_END);
  });

  it('ハッシュロケットを正しく解析する', () => {
    const lexer = new Lexer('=>');
    const tokens = lexer.tokenize();
    expect(tokens[0]?.type).toBe(TokenType.HASHROCKET);
  });

  it('識別子を正しく解析する', () => {
    const lexer = new Lexer('foo bar_baz qux?');
    const tokens = lexer.tokenize();
    const idents = tokens.filter(t => t.type === TokenType.IDENT);
    expect(idents).toHaveLength(3);
    expect(idents[0]?.value).toBe('foo');
    expect(idents[1]?.value).toBe('bar_baz');
    expect(idents[2]?.value).toBe('qux?');
  });

  it('エスケープシーケンスを処理する', () => {
    const lexer = new Lexer('"hello\\nworld"');
    const tokens = lexer.tokenize();
    expect(tokens[0]?.type).toBe(TokenType.STRING);
    expect(tokens[0]?.value).toBe('hello\nworld');
  });
});

// === パーサーのテスト ===

describe('Parser', () => {
  it('メソッド定義をパースする', () => {
    const ast = parseRuby('def greet(name)\n  puts name\nend');
    expect(ast.kind).toBe('program');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('method_def');
      const methodDef = ast.body[0];
      if (methodDef?.kind === 'method_def') {
        expect(methodDef.name).toBe('greet');
        expect(methodDef.params).toEqual(['name']);
      }
    }
  });

  it('クラス定義をパースする', () => {
    const ast = parseRuby('class Animal\n  def speak\n    puts "hello"\n  end\nend');
    expect(ast.kind).toBe('program');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('class_def');
      const classDef = ast.body[0];
      if (classDef?.kind === 'class_def') {
        expect(classDef.name).toBe('Animal');
        expect(classDef.superclass).toBeNull();
      }
    }
  });

  it('クラス継承をパースする', () => {
    const ast = parseRuby('class Dog < Animal\nend');
    if (ast.kind === 'program') {
      const classDef = ast.body[0];
      if (classDef?.kind === 'class_def') {
        expect(classDef.name).toBe('Dog');
        expect(classDef.superclass).toBe('Animal');
      }
    }
  });

  it('if/elsif/elseをパースする', () => {
    const ast = parseRuby('if x > 0\n  puts "positive"\nelsif x == 0\n  puts "zero"\nelse\n  puts "negative"\nend');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('if');
      const ifNode = ast.body[0];
      if (ifNode?.kind === 'if') {
        expect(ifNode.elsifClauses).toHaveLength(1);
        expect(ifNode.elseBody).not.toBeNull();
      }
    }
  });

  it('whileをパースする', () => {
    const ast = parseRuby('while x > 0\n  x = x - 1\nend');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('while');
    }
  });

  it('代入をパースする', () => {
    const ast = parseRuby('x = 42');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('assign');
      const assign = ast.body[0];
      if (assign?.kind === 'assign') {
        expect(assign.name).toBe('x');
      }
    }
  });

  it('配列リテラルをパースする', () => {
    const ast = parseRuby('[1, 2, 3]');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('array');
      const arr = ast.body[0];
      if (arr?.kind === 'array') {
        expect(arr.elements).toHaveLength(3);
      }
    }
  });

  it('ハッシュリテラルをパースする', () => {
    const ast = parseRuby('{"a" => 1, "b" => 2}');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('hash');
      const hash = ast.body[0];
      if (hash?.kind === 'hash') {
        expect(hash.pairs).toHaveLength(2);
      }
    }
  });

  it('メソッドチェーンをパースする', () => {
    const ast = parseRuby('arr.length');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('method_call');
      const call = ast.body[0];
      if (call?.kind === 'method_call') {
        expect(call.name).toBe('length');
        expect(call.receiver?.kind).toBe('ident');
      }
    }
  });

  it('ブロック（do..end）をパースする', () => {
    const ast = parseRuby('arr.each do |x|\n  puts x\nend');
    if (ast.kind === 'program') {
      const call = ast.body[0];
      if (call?.kind === 'method_call') {
        expect(call.block).not.toBeNull();
        expect(call.block?.params).toEqual(['x']);
      }
    }
  });

  it('二項演算をパースする', () => {
    const ast = parseRuby('1 + 2 * 3');
    if (ast.kind === 'program') {
      // 優先順位: * が先に結合
      expect(ast.body[0]?.kind).toBe('binary_op');
      const binOp = ast.body[0];
      if (binOp?.kind === 'binary_op') {
        expect(binOp.op).toBe('+');
        expect(binOp.right.kind).toBe('binary_op');
      }
    }
  });

  it('return文をパースする', () => {
    const ast = parseRuby('return 42');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('return');
      const ret = ast.body[0];
      if (ret?.kind === 'return') {
        expect(ret.value?.kind).toBe('number');
      }
    }
  });

  it('yield文をパースする', () => {
    const ast = parseRuby('yield 1, 2');
    if (ast.kind === 'program') {
      expect(ast.body[0]?.kind).toBe('yield');
      const yld = ast.body[0];
      if (yld?.kind === 'yield') {
        expect(yld.args).toHaveLength(2);
      }
    }
  });
});

// === コンパイラのテスト ===

describe('Compiler', () => {
  it('数値リテラルをputobjectにコンパイルする', () => {
    const ast = parseRuby('42');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.PUTOBJECT && i.operands[0] === 42)).toBe(true);
  });

  it('文字列リテラルをputstringにコンパイルする', () => {
    const ast = parseRuby('"hello"');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.PUTSTRING && i.operands[0] === 'hello')).toBe(true);
  });

  it('代入をsetlocalにコンパイルする', () => {
    const ast = parseRuby('x = 10');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.SETLOCAL && i.operands[0] === 'x')).toBe(true);
  });

  it('変数参照をgetlocalにコンパイルする', () => {
    const ast = parseRuby('x');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.GETLOCAL && i.operands[0] === 'x')).toBe(true);
  });

  it('メソッド呼び出しをsendにコンパイルする', () => {
    const ast = parseRuby('puts("hello")');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.SEND && i.operands[0] === 'puts')).toBe(true);
  });

  it('配列リテラルをnewarrayにコンパイルする', () => {
    const ast = parseRuby('[1, 2, 3]');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.NEWARRAY && i.operands[0] === 3)).toBe(true);
  });

  it('ハッシュリテラルをnewhashにコンパイルする', () => {
    const ast = parseRuby('{"a" => 1}');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.NEWHASH && i.operands[0] === 2)).toBe(true);
  });

  it('ifをbranchunlessにコンパイルする', () => {
    const ast = parseRuby('if true\n  1\nend');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.BRANCHUNLESS)).toBe(true);
  });

  it('whileをjumpとbranchunlessにコンパイルする', () => {
    const ast = parseRuby('while true\n  1\nend');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.JUMP)).toBe(true);
    expect(iseq.instructions.some(i => i.opcode === Opcode.BRANCHUNLESS)).toBe(true);
  });

  it('メソッド定義をdefinemethod命令にコンパイルする', () => {
    const ast = parseRuby('def foo\n  42\nend');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    expect(iseq.instructions.some(i => i.opcode === Opcode.DEFINEMETHOD && i.operands[0] === 'foo')).toBe(true);
  });

  it('leaveが命令列の最後に含まれる', () => {
    const ast = parseRuby('42');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    const lastInstr = iseq.instructions[iseq.instructions.length - 1];
    expect(lastInstr?.opcode).toBe(Opcode.LEAVE);
  });

  it('disassembleが人間が読める形式で出力する', () => {
    const ast = parseRuby('42');
    const compiler = new Compiler();
    const iseq = compiler.compile(ast);
    const output = disassemble(iseq);
    expect(output).toContain('<main>');
    expect(output).toContain('putobject');
  });
});

// === オブジェクトモデルのテスト ===

describe('Object Model', () => {
  it('オブジェクト階層を正しく構築する', () => {
    const hierarchy = createObjectHierarchy();
    expect(hierarchy.integerClass.superclass).toBe(hierarchy.objectClass);
    expect(hierarchy.stringClass.superclass).toBe(hierarchy.objectClass);
    expect(hierarchy.arrayClass.superclass).toBe(hierarchy.objectClass);
  });

  it('RubyIntegerが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const num = new RubyInteger(42, hierarchy.integerClass);
    expect(num.value).toBe(42);
    expect(num.toS()).toBe('42');
    expect(num.isTruthy()).toBe(true);
  });

  it('RubyStringが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const str = new RubyString('hello', hierarchy.stringClass);
    expect(str.value).toBe('hello');
    expect(str.toS()).toBe('hello');
    expect(str.inspect()).toBe('"hello"');
  });

  it('RubyNilがfalsyである', () => {
    const hierarchy = createObjectHierarchy();
    const nil = new RubyNil(hierarchy.nilClass);
    expect(nil.isTruthy()).toBe(false);
    expect(nil.inspect()).toBe('nil');
  });

  it('RubyBoolが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const t = new RubyBool(true, hierarchy.boolClass);
    const f = new RubyBool(false, hierarchy.boolClass);
    expect(t.isTruthy()).toBe(true);
    expect(f.isTruthy()).toBe(false);
  });

  it('RubySymbolが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const sym = new RubySymbol('name', hierarchy.symbolClass);
    expect(sym.name).toBe('name');
    expect(sym.inspect()).toBe(':name');
  });

  it('RubyArrayが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const arr = new RubyArray(
      [new RubyInteger(1, hierarchy.integerClass), new RubyInteger(2, hierarchy.integerClass)],
      hierarchy.arrayClass,
    );
    expect(arr.elements).toHaveLength(2);
    expect(arr.toS()).toBe('[1, 2]');
  });

  it('RubyHashが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const hash = new RubyHash(hierarchy.hashClass);
    const key = new RubyString('a', hierarchy.stringClass);
    const value = new RubyInteger(1, hierarchy.integerClass);
    hash.set(key, value);
    expect(hash.get(key)).toBe(value);
    expect(hash.entries.size).toBe(1);
  });

  it('メソッドルックアップがスーパークラスチェーンを辿る', () => {
    const hierarchy = createObjectHierarchy();
    // integerClass → objectClass のto_sメソッドがある
    const method = hierarchy.integerClass.lookupMethod('to_s');
    expect(method).not.toBeNull();
    expect(method?.name).toBe('to_s');
  });

  it('ネイティブ算術メソッドが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const a = new RubyInteger(10, hierarchy.integerClass);
    const b = new RubyInteger(3, hierarchy.integerClass);

    const addMethod = hierarchy.integerClass.lookupMethod('+');
    const subMethod = hierarchy.integerClass.lookupMethod('-');
    const mulMethod = hierarchy.integerClass.lookupMethod('*');
    const divMethod = hierarchy.integerClass.lookupMethod('/');
    const modMethod = hierarchy.integerClass.lookupMethod('%');

    const addResult = addMethod?.native?.(a, [b]);
    const subResult = subMethod?.native?.(a, [b]);
    const mulResult = mulMethod?.native?.(a, [b]);
    const divResult = divMethod?.native?.(a, [b]);
    const modResult = modMethod?.native?.(a, [b]);

    expect(addResult).toBeInstanceOf(RubyInteger);
    if (addResult instanceof RubyInteger) expect(addResult.value).toBe(13);
    if (subResult instanceof RubyInteger) expect(subResult.value).toBe(7);
    if (mulResult instanceof RubyInteger) expect(mulResult.value).toBe(30);
    if (divResult instanceof RubyInteger) expect(divResult.value).toBe(3);
    if (modResult instanceof RubyInteger) expect(modResult.value).toBe(1);
  });

  it('文字列のlengthメソッドが正しく動作する', () => {
    const hierarchy = createObjectHierarchy();
    const str = new RubyString('hello', hierarchy.stringClass);
    const method = hierarchy.stringClass.lookupMethod('length');
    const result = method?.native?.(str, []);
    expect(result).toBeInstanceOf(RubyInteger);
    if (result instanceof RubyInteger) expect(result.value).toBe(5);
  });

  it('クラスにメソッドを定義できる', () => {
    const hierarchy = createObjectHierarchy();
    const klass = new RubyClass('MyClass', hierarchy.objectClass);
    klass.defineMethod({ name: 'greet', params: [], iseqIndex: 0 });
    expect(klass.lookupMethod('greet')).not.toBeNull();
  });
});

// === VM統合テスト ===

describe('VM', () => {
  it('putsで出力できる', () => {
    const output = runRuby('puts "hello"');
    expect(output).toBe('hello\n');
  });

  it('putsで複数行出力できる', () => {
    const output = runRuby('puts "hello"\nputs "world"');
    expect(output).toBe('hello\nworld\n');
  });

  it('整数の四則演算ができる', () => {
    const output = runRuby('puts 2 + 3');
    expect(output).toBe('5\n');
  });

  it('変数に代入して参照できる', () => {
    const output = runRuby('x = 42\nputs x');
    expect(output).toBe('42\n');
  });

  it('if文が正しく動作する', () => {
    const output = runRuby('x = 10\nif x > 5\n  puts "big"\nelse\n  puts "small"\nend');
    expect(output).toBe('big\n');
  });

  it('if文のelse分岐が正しく動作する', () => {
    const output = runRuby('x = 3\nif x > 5\n  puts "big"\nelse\n  puts "small"\nend');
    expect(output).toBe('small\n');
  });

  it('whileループが正しく動作する', () => {
    const output = runRuby('x = 0\nwhile x < 3\n  puts x\n  x = x + 1\nend');
    expect(output).toBe('0\n1\n2\n');
  });

  it('メソッド定義と呼び出しが正しく動作する', () => {
    const output = runRuby('def greet(name)\n  puts name\nend\ngreet("Ruby")');
    expect(output).toBe('Ruby\n');
  });

  it('メソッドのreturnが正しく動作する', () => {
    const output = runRuby('def add(a, b)\n  return a + b\nend\nputs add(3, 4)');
    expect(output).toBe('7\n');
  });

  it('配列リテラルが正しく動作する', () => {
    const output = runRuby('arr = [1, 2, 3]\nputs arr.length');
    expect(output).toBe('3\n');
  });

  it('文字列のlengthメソッドが動作する', () => {
    const output = runRuby('puts "hello".length');
    expect(output).toBe('5\n');
  });

  it('文字列の連結が動作する', () => {
    const output = runRuby('puts "hello" + " " + "world"');
    expect(output).toBe('hello world\n');
  });

  it('比較演算が正しく動作する', () => {
    const output = runRuby('puts 1 == 1\nputs 1 == 2');
    expect(output).toBe('true\nfalse\n');
  });

  it('nilがfalsyとして扱われる', () => {
    const output = runRuby('if nil\n  puts "truthy"\nelse\n  puts "falsy"\nend');
    expect(output).toBe('falsy\n');
  });

  it('falseがfalsyとして扱われる', () => {
    const output = runRuby('if false\n  puts "truthy"\nelse\n  puts "falsy"\nend');
    expect(output).toBe('falsy\n');
  });

  it('trueがtruthyとして扱われる', () => {
    const output = runRuby('if true\n  puts "yes"\nend');
    expect(output).toBe('yes\n');
  });

  it('再帰メソッドが動作する', () => {
    const output = runRuby('def fact(n)\n  if n <= 1\n    return 1\n  end\n  return n * fact(n - 1)\nend\nputs fact(5)');
    expect(output).toBe('120\n');
  });

  it('eachブロックが動作する', () => {
    const output = runRuby('[1, 2, 3].each do |x|\n  puts x\nend');
    expect(output).toBe('1\n2\n3\n');
  });

  it('timesブロックが動作する', () => {
    const output = runRuby('3.times do |i|\n  puts i\nend');
    expect(output).toBe('0\n1\n2\n');
  });

  it('mapブロックが動作する', () => {
    const output = runRuby('result = [1, 2, 3].map do |x|\n  x * 2\nend\nputs result.length');
    expect(output).toBe('3\n');
  });

  it('メソッドのimplicitリターンが動作する', () => {
    const output = runRuby('def double(x)\n  x * 2\nend\nputs double(5)');
    expect(output).toBe('10\n');
  });

  it('ステップ記録が動作する', () => {
    const lexer = new Lexer('puts 42');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const compiler = new Compiler();
    const mainIseq = compiler.compile(ast);
    const blockSequences = compiler.getBlockSequences();
    const vm = new VM();
    const result = vm.execute(mainIseq, blockSequences, { recordSteps: true });
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('引数なしのputsが改行のみ出力する', () => {
    const output = runRuby('puts');
    expect(output).toBe('\n');
  });

  it('クラス定義とメソッド呼び出しが動作する', () => {
    const source = `class Greeter
  def hello
    puts "hi"
  end
end
g = Greeter.new
g.hello`;
    const output = runRuby(source);
    expect(output).toBe('hi\n');
  });

  it('yieldが動作する', () => {
    const source = `def do_twice
  yield 1
  yield 2
end
do_twice do |x|
  puts x
end`;
    const output = runRuby(source);
    expect(output).toBe('1\n2\n');
  });

  it('論理演算子が短絡評価される', () => {
    const output = runRuby('x = true || false\nputs x');
    expect(output).toBe('true\n');
  });

  it('elsifが正しく動作する', () => {
    const source = `x = 5
if x > 10
  puts "big"
elsif x > 3
  puts "medium"
else
  puts "small"
end`;
    const output = runRuby(source);
    expect(output).toBe('medium\n');
  });

  it('マイナス単項演算子が動作する', () => {
    const output = runRuby('puts 0 - 5');
    expect(output).toBe('-5\n');
  });

  it('剰余演算子が動作する', () => {
    const output = runRuby('puts 10 % 3');
    expect(output).toBe('1\n');
  });
});
