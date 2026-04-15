/* ===== GraphQL シミュレーター テスト ===== */

import { describe, it, expect } from 'vitest';
import {
  Lexer,
  Parser,
  Validator,
  runGraphQL,
  objectType,
  field,
  named,
  nonNull,
  list,
} from '../engine/engine';
import type {
  GQLSchema,
  GQLTypeDef,
  ResolverMap,
  FragmentDefNode,
} from '../engine/types';
import { presets } from '../engine/presets';

/* ---------- テスト用スキーマ ---------- */

function testSchema(): GQLSchema {
  const types = new Map<string, GQLTypeDef>();
  types.set('Query', objectType('Query', [
    field('hello', nonNull(named('String'))),
    field('user', named('User'), [{ name: 'id', type: nonNull(named('Int')) }]),
    field('users', list(named('User'))),
  ]));
  types.set('User', objectType('User', [
    field('id', nonNull(named('Int'))),
    field('name', nonNull(named('String'))),
    field('email', named('String')),
    field('posts', list(named('Post'))),
  ]));
  types.set('Post', objectType('Post', [
    field('id', nonNull(named('Int'))),
    field('title', nonNull(named('String'))),
    field('author', named('User')),
  ]));
  return { types, queryType: 'Query' };
}

function testResolvers(): ResolverMap {
  return {
    Query: {
      hello: () => 'world',
      user: (_p, args, ctx) => {
        const users = ctx.store['users'] as Record<string, unknown>[] ?? [];
        return users.find(u => u['id'] === args['id']) ?? null;
      },
      users: (_p, _a, ctx) => ctx.store['users'] ?? [],
    },
    User: {
      posts: (parent, _a, ctx) => {
        const posts = ctx.store['posts'] as Record<string, unknown>[] ?? [];
        return posts.filter(p => p['authorId'] === parent['id']);
      },
    },
    Post: {
      author: (parent, _a, ctx) => {
        const users = ctx.store['users'] as Record<string, unknown>[] ?? [];
        return users.find(u => u['id'] === parent['authorId']) ?? null;
      },
    },
  };
}

function testStore() {
  return {
    users: [
      { id: 1, name: 'Alice', email: 'alice@test.com' },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ],
    posts: [
      { id: 1, title: 'Hello World', authorId: 1 },
      { id: 2, title: 'GraphQL Guide', authorId: 2 },
      { id: 3, title: 'TypeScript Tips', authorId: 1 },
    ],
  };
}

/* ========== テスト ========== */

describe('Lexer: 字句解析', () => {
  it('基本的なクエリをトークナイズする', () => {
    const lexer = new Lexer('{ hello }');
    const tokens = lexer.tokenize();
    expect(tokens.map(t => t.kind)).toEqual(['BraceL', 'Name', 'BraceR', 'EOF']);
  });

  it('引数付きクエリをトークナイズする', () => {
    const lexer = new Lexer('query { user(id: 1) { name } }');
    const tokens = lexer.tokenize();
    const kinds = tokens.map(t => t.kind);
    expect(kinds).toContain('ParenL');
    expect(kinds).toContain('Int');
    expect(kinds).toContain('Colon');
  });

  it('文字列リテラルを認識する', () => {
    const lexer = new Lexer('{ name(arg: "hello world") }');
    const tokens = lexer.tokenize();
    const strToken = tokens.find(t => t.kind === 'String');
    expect(strToken?.value).toBe('hello world');
  });

  it('コメントをスキップする', () => {
    const lexer = new Lexer('{ # this is a comment\n  hello }');
    const tokens = lexer.tokenize();
    expect(tokens.map(t => t.kind)).toEqual(['BraceL', 'Name', 'BraceR', 'EOF']);
  });

  it('三点リーダをSpreadトークンとして認識する', () => {
    const lexer = new Lexer('{ ...Fragment }');
    const tokens = lexer.tokenize();
    expect(tokens[1]!.kind).toBe('Spread');
  });

  it('ブーリアン値を認識する', () => {
    const lexer = new Lexer('{ field @skip(if: true) }');
    const tokens = lexer.tokenize();
    const boolToken = tokens.find(t => t.kind === 'Boolean');
    expect(boolToken?.value).toBe('true');
  });
});

describe('Parser: 構文解析', () => {
  it('シンプルなクエリをパースする', () => {
    const tokens = new Lexer('{ hello }').tokenize();
    const ast = new Parser(tokens).parse();
    expect(ast.kind).toBe('Document');
    expect(ast.definitions.length).toBe(1);
    const op = ast.definitions[0]!;
    expect(op.kind).toBe('Operation');
    if (op.kind === 'Operation') {
      expect(op.operation).toBe('query');
      expect(op.selectionSet.length).toBe(1);
    }
  });

  it('名前付きクエリをパースする', () => {
    const tokens = new Lexer('query GetUser { user(id: 1) { name } }').tokenize();
    const ast = new Parser(tokens).parse();
    const op = ast.definitions[0]!;
    if (op.kind === 'Operation') {
      expect(op.name).toBe('GetUser');
    }
  });

  it('引数付きフィールドをパースする', () => {
    const tokens = new Lexer('{ user(id: 42) { name } }').tokenize();
    const ast = new Parser(tokens).parse();
    const op = ast.definitions[0]!;
    if (op.kind === 'Operation') {
      const userField = op.selectionSet[0]!;
      if (userField.kind === 'Field') {
        expect(userField.name).toBe('user');
        expect(userField.arguments.length).toBe(1);
        expect(userField.arguments[0]!.name).toBe('id');
      }
    }
  });

  it('エイリアスをパースする', () => {
    const tokens = new Lexer('{ myUser: user(id: 1) { name } }').tokenize();
    const ast = new Parser(tokens).parse();
    const op = ast.definitions[0]!;
    if (op.kind === 'Operation') {
      const f = op.selectionSet[0]!;
      if (f.kind === 'Field') {
        expect(f.alias).toBe('myUser');
        expect(f.name).toBe('user');
      }
    }
  });

  it('フラグメント定義とスプレッドをパースする', () => {
    const src = `
      query { user(id: 1) { ...UserFields } }
      fragment UserFields on User { name email }
    `;
    const tokens = new Lexer(src).tokenize();
    const ast = new Parser(tokens).parse();
    expect(ast.definitions.length).toBe(2);
    expect(ast.definitions[1]!.kind).toBe('FragmentDef');
  });

  it('変数定義をパースする', () => {
    const src = 'query GetUser($id: Int!) { user(id: $id) { name } }';
    const tokens = new Lexer(src).tokenize();
    const ast = new Parser(tokens).parse();
    const op = ast.definitions[0]!;
    if (op.kind === 'Operation') {
      expect(op.variableDefs.length).toBe(1);
      expect(op.variableDefs[0]!.name).toBe('id');
      expect(op.variableDefs[0]!.nullable).toBe(false);
    }
  });

  it('ディレクティブをパースする', () => {
    const src = '{ name @skip(if: true) }';
    const tokens = new Lexer(src).tokenize();
    const ast = new Parser(tokens).parse();
    const op = ast.definitions[0]!;
    if (op.kind === 'Operation') {
      const f = op.selectionSet[0]!;
      if (f.kind === 'Field') {
        expect(f.directives.length).toBe(1);
        expect(f.directives[0]!.name).toBe('skip');
      }
    }
  });
});

describe('Validator: バリデーション', () => {
  it('有効なクエリを受け入れる', () => {
    const tokens = new Lexer('{ hello }').tokenize();
    const ast = new Parser(tokens).parse();
    const frags = new Map<string, FragmentDefNode>();
    const validator = new Validator(testSchema(), frags);
    expect(validator.validate(ast)).toBe(true);
  });

  it('存在しないフィールドを拒否する', () => {
    const tokens = new Lexer('{ nonExistent }').tokenize();
    const ast = new Parser(tokens).parse();
    const frags = new Map<string, FragmentDefNode>();
    const validator = new Validator(testSchema(), frags);
    expect(validator.validate(ast)).toBe(false);
    expect(validator.errors.length).toBeGreaterThan(0);
  });

  it('ネストしたフィールドを検証する', () => {
    const tokens = new Lexer('{ user(id: 1) { name email } }').tokenize();
    const ast = new Parser(tokens).parse();
    const frags = new Map<string, FragmentDefNode>();
    const validator = new Validator(testSchema(), frags);
    expect(validator.validate(ast)).toBe(true);
  });

  it('ネストしたフィールドの不存在を検出する', () => {
    const tokens = new Lexer('{ user(id: 1) { name phone } }').tokenize();
    const ast = new Parser(tokens).parse();
    const frags = new Map<string, FragmentDefNode>();
    const validator = new Validator(testSchema(), frags);
    expect(validator.validate(ast)).toBe(false);
    expect(validator.errors[0]).toContain('phone');
  });
});

describe('Executor: 実行', () => {
  it('シンプルなクエリを実行する', () => {
    const result = runGraphQL(
      '{ hello }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    expect(result.data).toEqual({ hello: 'world' });
    expect(result.errors.length).toBe(0);
  });

  it('引数付きクエリを実行する', () => {
    const result = runGraphQL(
      '{ user(id: 1) { name email } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    expect(user['name']).toBe('Alice');
    expect(user['email']).toBe('alice@test.com');
  });

  it('ネストしたリゾルバを実行する', () => {
    const result = runGraphQL(
      '{ user(id: 1) { name posts { title } } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    const posts = user['posts'] as Record<string, unknown>[];
    expect(posts.length).toBe(2);
    expect(posts[0]!['title']).toBe('Hello World');
  });

  it('エイリアスが機能する', () => {
    const result = runGraphQL(
      '{ a: user(id: 1) { name } b: user(id: 2) { name } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const a = data['a'] as Record<string, unknown>;
    const b = data['b'] as Record<string, unknown>;
    expect(a['name']).toBe('Alice');
    expect(b['name']).toBe('Bob');
  });

  it('変数が解決される', () => {
    const result = runGraphQL(
      'query GetUser($uid: Int!) { user(id: $uid) { name } }',
      testSchema(), testResolvers(), { uid: 2 }, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    expect(user['name']).toBe('Bob');
  });

  it('@skip ディレクティブが機能する', () => {
    const result = runGraphQL(
      '{ user(id: 1) { name email @skip(if: true) } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    expect(user['name']).toBe('Alice');
    expect(user['email']).toBeUndefined();
  });

  it('@include(if: false) でフィールドが除外される', () => {
    const result = runGraphQL(
      '{ user(id: 1) { name email @include(if: false) } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    expect(user['email']).toBeUndefined();
  });

  it('フラグメントが展開される', () => {
    const result = runGraphQL(
      `query { user(id: 1) { ...F } }
       fragment F on User { name email }`,
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    expect(user['name']).toBe('Alice');
    expect(user['email']).toBe('alice@test.com');
  });

  it('__typename が返される', () => {
    const result = runGraphQL(
      '{ user(id: 1) { __typename name } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    const data = result.data as Record<string, unknown>;
    const user = data['user'] as Record<string, unknown>;
    expect(user['__typename']).toBe('User');
  });
});

describe('統合: 統計情報', () => {
  it('実行統計が正しく記録される', () => {
    const result = runGraphQL(
      '{ users { name posts { title } } }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    expect(result.stats.tokenCount).toBeGreaterThan(0);
    expect(result.stats.fieldResolves).toBeGreaterThan(0);
    expect(result.stats.maxDepth).toBeGreaterThanOrEqual(2);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('バリデーションエラーがあると実行されない', () => {
    const result = runGraphQL(
      '{ nonExistent }',
      testSchema(), testResolvers(), {}, testStore(),
    );
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.data).toBeNull();
  });
});

describe('プリセット', () => {
  it('全プリセットが正常に実行される', () => {
    expect(presets.length).toBeGreaterThanOrEqual(12);
    for (const preset of presets) {
      const result = preset.build();
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.tokens.length).toBeGreaterThan(0);
    }
  });

  it('基本クエリプリセットがデータを返す', () => {
    const result = presets[0]!.build();
    expect(result.data).not.toBeNull();
    expect(result.errors.length).toBe(0);
  });

  it('バリデーションエラープリセットがエラーを返す', () => {
    const errPreset = presets.find(p => p.name.includes('バリデーション'));
    expect(errPreset).toBeDefined();
    const result = errPreset!.build();
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});
