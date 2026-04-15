/* ===== GraphQL シミュレーター エンジン ===== */

import type {
  Token,
  TokenKind,
  DocumentNode,
  OperationNode,
  FieldNode,
  SelectionNode,
  ArgumentNode,
  FragmentDefNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  VariableDefNode,
  DirectiveNode,
  GQLValue,
  GQLSchema,
  ObjectTypeDef,
  FieldDef,
  TypeRef,
  ResolverMap,
  ResolverContext,
  GQLEvent,
  StepSnapshot,
  GQLSimResult,
} from './types';

/* ================================================================
   1. レキサー (Lexer)
   ================================================================ */

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  tokens: Token[] = [];
  events: GQLEvent[] = [];

  constructor(source: string) {
    this.src = source;
  }

  /** 全トークンを生成 */
  tokenize(): Token[] {
    this.events.push({ type: 'lex', severity: 'info', message: '字句解析を開始' });
    while (this.pos < this.src.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.src.length) break;
      const tok = this.readToken();
      if (tok) {
        this.tokens.push(tok);
        this.events.push({
          type: 'lex',
          severity: 'detail',
          message: `トークン: ${tok.kind} "${tok.value}" (${tok.line}:${tok.col})`,
        });
      }
    }
    this.tokens.push({ kind: 'EOF', value: '', line: this.line, col: this.col });
    this.events.push({ type: 'lex', severity: 'info', message: `字句解析完了: ${this.tokens.length}トークン` });
    return this.tokens;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === ' ' || ch === '\t' || ch === ',') {
        this.advance();
      } else if (ch === '\n' || ch === '\r') {
        this.advance();
        if (ch === '\r' && this.src[this.pos] === '\n') this.advance();
        this.line++;
        this.col = 1;
      } else if (ch === '#') {
        /* コメントは行末まで */
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.advance();
      } else {
        break;
      }
    }
  }

  private readToken(): Token | null {
    const ch = this.src[this.pos]!;
    const startLine = this.line;
    const startCol = this.col;

    /* 記号 */
    const punct: Record<string, TokenKind> = {
      '{': 'BraceL', '}': 'BraceR', '(': 'ParenL', ')': 'ParenR',
      '[': 'BracketL', ']': 'BracketR', ':': 'Colon', '!': 'Bang',
      '$': 'Dollar', '@': 'At', '=': 'Eq', '|': 'Pipe',
    };
    if (punct[ch]) {
      this.advance();
      return { kind: punct[ch]!, value: ch, line: startLine, col: startCol };
    }

    /* 三点リーダ */
    if (ch === '.' && this.src[this.pos + 1] === '.' && this.src[this.pos + 2] === '.') {
      this.advance(); this.advance(); this.advance();
      return { kind: 'Spread', value: '...', line: startLine, col: startCol };
    }

    /* 文字列 */
    if (ch === '"') {
      return this.readString(startLine, startCol);
    }

    /* 数値 */
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      return this.readNumber(startLine, startCol);
    }

    /* 名前 / キーワード */
    if (isNameStart(ch)) {
      return this.readName(startLine, startCol);
    }

    /* 不明な文字をスキップ */
    this.advance();
    return null;
  }

  private readString(line: number, col: number): Token {
    this.advance(); // 開始 "
    let val = '';
    while (this.pos < this.src.length && this.src[this.pos] !== '"') {
      if (this.src[this.pos] === '\\') {
        this.advance();
        const esc = this.src[this.pos];
        if (esc === 'n') val += '\n';
        else if (esc === 't') val += '\t';
        else if (esc === '"') val += '"';
        else if (esc === '\\') val += '\\';
        else val += esc ?? '';
      } else {
        val += this.src[this.pos];
      }
      this.advance();
    }
    this.advance(); // 終了 "
    return { kind: 'String', value: val, line, col };
  }

  private readNumber(line: number, col: number): Token {
    let val = '';
    let isFloat = false;
    if (this.src[this.pos] === '-') { val += '-'; this.advance(); }
    while (this.pos < this.src.length && this.src[this.pos]! >= '0' && this.src[this.pos]! <= '9') {
      val += this.src[this.pos]; this.advance();
    }
    if (this.src[this.pos] === '.') {
      isFloat = true;
      val += '.'; this.advance();
      while (this.pos < this.src.length && this.src[this.pos]! >= '0' && this.src[this.pos]! <= '9') {
        val += this.src[this.pos]; this.advance();
      }
    }
    return { kind: isFloat ? 'Float' : 'Int', value: val, line, col };
  }

  private readName(line: number, col: number): Token {
    let val = '';
    while (this.pos < this.src.length && isNameContinue(this.src[this.pos]!)) {
      val += this.src[this.pos]; this.advance();
    }
    if (val === 'true' || val === 'false') {
      return { kind: 'Boolean', value: val, line, col };
    }
    return { kind: 'Name', value: val, line, col };
  }

  private advance(): void {
    this.pos++;
    this.col++;
  }
}

function isNameStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isNameContinue(ch: string): boolean {
  return isNameStart(ch) || (ch >= '0' && ch <= '9');
}

/* ================================================================
   2. パーサー (Parser)
   ================================================================ */

export class Parser {
  private tokens: Token[];
  private pos = 0;
  events: GQLEvent[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /** ドキュメントをパース */
  parse(): DocumentNode {
    this.events.push({ type: 'parse', severity: 'info', message: '構文解析を開始' });
    const definitions: (OperationNode | FragmentDefNode)[] = [];

    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.kind === 'Name') {
        if (tok.value === 'query' || tok.value === 'mutation' || tok.value === 'subscription') {
          definitions.push(this.parseOperation());
        } else if (tok.value === 'fragment') {
          definitions.push(this.parseFragmentDef());
        } else {
          /* 名前無しクエリ（selectionSet直書き） */
          definitions.push(this.parseShorthandQuery());
          break;
        }
      } else if (tok.kind === 'BraceL') {
        definitions.push(this.parseShorthandQuery());
      } else {
        this.advance(); // スキップ
      }
    }

    this.events.push({ type: 'parse', severity: 'info', message: `構文解析完了: ${definitions.length}定義` });
    return { kind: 'Document', definitions };
  }

  private parseOperation(): OperationNode {
    const opTok = this.expect('Name');
    const operation = opTok.value as 'query' | 'mutation' | 'subscription';
    this.events.push({ type: 'parse', severity: 'detail', message: `${operation}操作をパース` });

    let name: string | undefined;
    if (this.peek().kind === 'Name') {
      name = this.advance().value;
    }

    let variableDefs: VariableDefNode[] = [];
    if (this.peek().kind === 'ParenL') {
      variableDefs = this.parseVariableDefs();
    }

    const directives = this.parseDirectives();
    const selectionSet = this.parseSelectionSet();

    return { kind: 'Operation', operation, name, variableDefs, directives, selectionSet };
  }

  private parseShorthandQuery(): OperationNode {
    this.events.push({ type: 'parse', severity: 'detail', message: '省略形クエリをパース' });
    const selectionSet = this.parseSelectionSet();
    return {
      kind: 'Operation', operation: 'query', variableDefs: [], directives: [], selectionSet,
    };
  }

  private parseSelectionSet(): SelectionNode[] {
    const selections: SelectionNode[] = [];
    this.expect('BraceL');
    while (!this.atEnd() && this.peek().kind !== 'BraceR') {
      if (this.peek().kind === 'Spread') {
        this.advance(); // ...
        if (this.peek().kind === 'Name' && this.peek().value !== 'on') {
          /* フラグメントスプレッド */
          selections.push(this.parseFragmentSpread());
        } else {
          /* インラインフラグメント */
          selections.push(this.parseInlineFragment());
        }
      } else {
        selections.push(this.parseField());
      }
    }
    this.expect('BraceR');
    return selections;
  }

  private parseField(): FieldNode {
    let alias: string | undefined;
    let name: string;
    const first = this.expect('Name').value;

    if (this.peek().kind === 'Colon') {
      this.advance(); // :
      alias = first;
      name = this.expect('Name').value;
    } else {
      name = first;
    }

    const args = this.peek().kind === 'ParenL' ? this.parseArguments() : [];
    const directives = this.parseDirectives();
    const selectionSet = this.peek().kind === 'BraceL' ? this.parseSelectionSet() : [];

    this.events.push({
      type: 'parse', severity: 'detail',
      message: `フィールド: ${alias ? alias + ':' : ''}${name}${args.length > 0 ? `(${args.length}引数)` : ''}`,
    });

    return { kind: 'Field', alias, name, arguments: args, directives, selectionSet };
  }

  private parseArguments(): ArgumentNode[] {
    this.expect('ParenL');
    const args: ArgumentNode[] = [];
    while (!this.atEnd() && this.peek().kind !== 'ParenR') {
      const name = this.expect('Name').value;
      this.expect('Colon');
      const value = this.parseValue();
      args.push({ kind: 'Argument', name, value });
    }
    this.expect('ParenR');
    return args;
  }

  private parseValue(): GQLValue {
    const tok = this.peek();
    if (tok.kind === 'Int') {
      this.advance();
      return { kind: 'IntValue', value: parseInt(tok.value, 10) };
    }
    if (tok.kind === 'Float') {
      this.advance();
      return { kind: 'FloatValue', value: parseFloat(tok.value) };
    }
    if (tok.kind === 'String') {
      this.advance();
      return { kind: 'StringValue', value: tok.value };
    }
    if (tok.kind === 'Boolean') {
      this.advance();
      return { kind: 'BooleanValue', value: tok.value === 'true' };
    }
    if (tok.kind === 'Name' && tok.value === 'null') {
      this.advance();
      return { kind: 'NullValue' };
    }
    if (tok.kind === 'Name') {
      this.advance();
      return { kind: 'EnumValue', value: tok.value };
    }
    if (tok.kind === 'Dollar') {
      this.advance();
      const name = this.expect('Name').value;
      return { kind: 'Variable', name };
    }
    if (tok.kind === 'BracketL') {
      this.advance();
      const values: GQLValue[] = [];
      while (!this.atEnd() && this.peek().kind !== 'BracketR') {
        values.push(this.parseValue());
      }
      this.expect('BracketR');
      return { kind: 'ListValue', values };
    }
    if (tok.kind === 'BraceL') {
      this.advance();
      const fields: { name: string; value: GQLValue }[] = [];
      while (!this.atEnd() && this.peek().kind !== 'BraceR') {
        const fname = this.expect('Name').value;
        this.expect('Colon');
        fields.push({ name: fname, value: this.parseValue() });
      }
      this.expect('BraceR');
      return { kind: 'ObjectValue', fields };
    }
    /* フォールバック */
    this.advance();
    return { kind: 'NullValue' };
  }

  private parseFragmentDef(): FragmentDefNode {
    this.expect('Name'); // "fragment"
    const name = this.expect('Name').value;
    this.expectName('on');
    const typeCondition = this.expect('Name').value;
    const selectionSet = this.parseSelectionSet();
    this.events.push({ type: 'parse', severity: 'detail', message: `フラグメント定義: ${name} on ${typeCondition}` });
    return { kind: 'FragmentDef', name, typeCondition, selectionSet };
  }

  private parseFragmentSpread(): FragmentSpreadNode {
    const name = this.expect('Name').value;
    const directives = this.parseDirectives();
    this.events.push({ type: 'parse', severity: 'detail', message: `フラグメントスプレッド: ...${name}` });
    return { kind: 'FragmentSpread', name, directives };
  }

  private parseInlineFragment(): InlineFragmentNode {
    let typeCondition: string | undefined;
    if (this.peek().kind === 'Name' && this.peek().value === 'on') {
      this.advance(); // on
      typeCondition = this.expect('Name').value;
    }
    const selectionSet = this.parseSelectionSet();
    return { kind: 'InlineFragment', typeCondition, selectionSet };
  }

  private parseVariableDefs(): VariableDefNode[] {
    this.expect('ParenL');
    const defs: VariableDefNode[] = [];
    while (!this.atEnd() && this.peek().kind !== 'ParenR') {
      this.expect('Dollar');
      const name = this.expect('Name').value;
      this.expect('Colon');
      const typeName = this.expect('Name').value;
      const nullable = this.peek().kind !== 'Bang';
      if (!nullable) this.advance();
      let defaultValue: GQLValue | undefined;
      if (this.peek().kind === 'Eq') {
        this.advance();
        defaultValue = this.parseValue();
      }
      defs.push({ kind: 'VariableDef', name, typeName, nullable, defaultValue });
      this.events.push({ type: 'parse', severity: 'detail', message: `変数定義: $${name}: ${typeName}${nullable ? '' : '!'}` });
    }
    this.expect('ParenR');
    return defs;
  }

  private parseDirectives(): DirectiveNode[] {
    const dirs: DirectiveNode[] = [];
    while (this.peek().kind === 'At') {
      this.advance(); // @
      const name = this.expect('Name').value;
      const args = this.peek().kind === 'ParenL' ? this.parseArguments() : [];
      dirs.push({ kind: 'Directive', name, arguments: args });
      this.events.push({ type: 'parse', severity: 'detail', message: `ディレクティブ: @${name}` });
    }
    return dirs;
  }

  /* ---- ユーティリティ ---- */

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: 'EOF', value: '', line: 0, col: 0 };
  }

  private advance(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  private expect(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      this.events.push({ type: 'error', severity: 'error', message: `期待: ${kind}, 実際: ${tok.kind} "${tok.value}" (${tok.line}:${tok.col})` });
      return tok;
    }
    return this.advance();
  }

  private expectName(value: string): Token {
    const tok = this.peek();
    if (tok.kind !== 'Name' || tok.value !== value) {
      this.events.push({ type: 'error', severity: 'error', message: `期待: "${value}", 実際: "${tok.value}"` });
    }
    return this.advance();
  }

  private atEnd(): boolean {
    return this.peek().kind === 'EOF';
  }
}

/* ================================================================
   3. バリデーター (Validator)
   ================================================================ */

export class Validator {
  private schema: GQLSchema;
  private fragments: Map<string, FragmentDefNode>;
  errors: string[] = [];
  events: GQLEvent[] = [];

  constructor(schema: GQLSchema, fragments: Map<string, FragmentDefNode>) {
    this.schema = schema;
    this.fragments = fragments;
  }

  /** ドキュメントを検証 */
  validate(doc: DocumentNode): boolean {
    this.events.push({ type: 'validate', severity: 'info', message: 'バリデーションを開始' });

    for (const def of doc.definitions) {
      if (def.kind === 'Operation') {
        const rootTypeName = def.operation === 'mutation'
          ? this.schema.mutationType ?? 'Mutation'
          : this.schema.queryType;
        const rootType = this.schema.types.get(rootTypeName);
        if (!rootType || rootType.kind !== 'ObjectType') {
          this.addError(`ルート型 "${rootTypeName}" がスキーマに存在しません`);
          continue;
        }
        this.validateSelectionSet(def.selectionSet, rootType, 1);
      }
    }

    if (this.errors.length === 0) {
      this.events.push({ type: 'validate', severity: 'info', message: 'バリデーション成功' });
    } else {
      this.events.push({ type: 'validate', severity: 'error', message: `バリデーションエラー: ${this.errors.length}件` });
    }
    return this.errors.length === 0;
  }

  private validateSelectionSet(selections: SelectionNode[], parentType: ObjectTypeDef, depth: number): void {
    for (const sel of selections) {
      if (sel.kind === 'Field') {
        /* __typename は常に有効 */
        if (sel.name === '__typename') {
          this.events.push({ type: 'validate', severity: 'detail', message: `  ${' '.repeat(depth)}✓ __typename (内蔵)`, depth });
          continue;
        }
        /* イントロスペクションフィールド */
        if (sel.name === '__schema' || sel.name === '__type') {
          this.events.push({ type: 'validate', severity: 'detail', message: `  ${' '.repeat(depth)}✓ ${sel.name} (イントロスペクション)`, depth });
          continue;
        }

        const fieldDef = parentType.fields.find(f => f.name === sel.name);
        if (!fieldDef) {
          this.addError(`フィールド "${sel.name}" は型 "${parentType.name}" に存在しません`);
          continue;
        }
        this.events.push({
          type: 'validate', severity: 'detail',
          message: `  ${' '.repeat(depth)}✓ ${parentType.name}.${sel.name}: ${typeRefToStr(fieldDef.type)}`,
          depth,
        });

        /* サブセレクションの検証 */
        if (sel.selectionSet.length > 0) {
          const innerTypeName = unwrapTypeName(fieldDef.type);
          const innerType = this.schema.types.get(innerTypeName);
          if (innerType && innerType.kind === 'ObjectType') {
            this.validateSelectionSet(sel.selectionSet, innerType, depth + 1);
          }
        }
      } else if (sel.kind === 'FragmentSpread') {
        const frag = this.fragments.get(sel.name);
        if (!frag) {
          this.addError(`フラグメント "${sel.name}" が未定義です`);
        } else {
          this.events.push({ type: 'validate', severity: 'detail', message: `  ${' '.repeat(depth)}✓ ...${sel.name}`, depth });
          const fragType = this.schema.types.get(frag.typeCondition);
          if (fragType && fragType.kind === 'ObjectType') {
            this.validateSelectionSet(frag.selectionSet, fragType, depth + 1);
          }
        }
      } else if (sel.kind === 'InlineFragment') {
        const typeName = sel.typeCondition ?? parentType.name;
        const fragType = this.schema.types.get(typeName);
        if (fragType && fragType.kind === 'ObjectType') {
          this.validateSelectionSet(sel.selectionSet, fragType, depth + 1);
        }
      }
    }
  }

  private addError(msg: string): void {
    this.errors.push(msg);
    this.events.push({ type: 'error', severity: 'error', message: msg });
  }
}

/* ================================================================
   4. エグゼキューター (Executor)
   ================================================================ */

export class Executor {
  private schema: GQLSchema;
  private resolvers: ResolverMap;
  private context: ResolverContext;
  private fragments: Map<string, FragmentDefNode>;
  events: GQLEvent[] = [];
  private fieldResolves = 0;
  private maxDepth = 0;
  private fragmentCount = 0;
  private directiveCount = 0;
  private variableCount = 0;
  private n1Count = 0;
  /** N+1検出: 親リスト内で繰り返されるリゾルバ呼び出しを追跡 */
  private resolveTracker: Map<string, number> = new Map();

  constructor(
    schema: GQLSchema,
    resolvers: ResolverMap,
    context: ResolverContext,
    fragments: Map<string, FragmentDefNode>,
  ) {
    this.schema = schema;
    this.resolvers = resolvers;
    this.context = context;
    this.fragments = fragments;
  }

  /** 操作を実行 */
  execute(op: OperationNode): { data: unknown; errors: string[] } {
    this.events.push({ type: 'execute', severity: 'info', message: `${op.operation}の実行を開始` });
    const errors: string[] = [];

    const rootTypeName = op.operation === 'mutation'
      ? this.schema.mutationType ?? 'Mutation'
      : this.schema.queryType;

    const rootType = this.schema.types.get(rootTypeName);
    if (!rootType || rootType.kind !== 'ObjectType') {
      errors.push(`ルート型 "${rootTypeName}" が見つかりません`);
      return { data: null, errors };
    }

    const data = this.resolveSelectionSet(op.selectionSet, rootType, {}, rootTypeName, 1);
    this.events.push({ type: 'execute', severity: 'info', message: '実行完了' });

    /* N+1検出 */
    for (const [path, count] of this.resolveTracker) {
      if (count >= 3) {
        this.n1Count++;
        this.events.push({
          type: 'n_plus_one', severity: 'warn',
          message: `N+1問題の可能性: "${path}" が${count}回呼び出されました`,
          path,
        });
      }
    }

    return { data, errors };
  }

  /** 選択セットを解決 */
  private resolveSelectionSet(
    selections: SelectionNode[],
    parentType: ObjectTypeDef,
    parentObj: Record<string, unknown>,
    path: string,
    depth: number,
  ): Record<string, unknown> {
    if (depth > this.maxDepth) this.maxDepth = depth;
    const result: Record<string, unknown> = {};

    for (const sel of selections) {
      if (sel.kind === 'Field') {
        /* ディレクティブ処理 */
        if (this.shouldSkip(sel.directives)) {
          this.directiveCount++;
          this.events.push({
            type: 'directive', severity: 'detail',
            message: `@skip/@include によりフィールド "${sel.name}" をスキップ`,
            path: `${path}.${sel.name}`, depth,
          });
          continue;
        }

        const key = sel.alias ?? sel.name;
        const fieldPath = `${path}.${sel.name}`;

        /* __typename 特殊処理 */
        if (sel.name === '__typename') {
          result[key] = parentType.name;
          this.events.push({ type: 'resolve', severity: 'detail', message: `${fieldPath} → "${parentType.name}"`, path: fieldPath, depth });
          this.fieldResolves++;
          continue;
        }

        /* リゾルバ解決 */
        const args = this.resolveArgs(sel.arguments);
        const resolvedValue = this.callResolver(parentType.name, sel.name, parentObj, args, fieldPath, depth);

        /* フィールド定義から型を取得 */
        const fieldDef = parentType.fields.find(f => f.name === sel.name);
        const innerTypeName = fieldDef ? unwrapTypeName(fieldDef.type) : null;
        const innerType = innerTypeName ? this.schema.types.get(innerTypeName) : null;

        if (sel.selectionSet.length > 0 && innerType && innerType.kind === 'ObjectType') {
          if (Array.isArray(resolvedValue)) {
            /* リスト解決 */
            this.events.push({
              type: 'resolve_list', severity: 'detail',
              message: `${fieldPath} → リスト (${resolvedValue.length}件)`,
              path: fieldPath, depth,
            });
            result[key] = resolvedValue.map((item, i) =>
              this.resolveSelectionSet(sel.selectionSet, innerType, item as Record<string, unknown>, `${fieldPath}[${i}]`, depth + 1)
            );
          } else if (resolvedValue !== null && resolvedValue !== undefined) {
            result[key] = this.resolveSelectionSet(sel.selectionSet, innerType, resolvedValue as Record<string, unknown>, fieldPath, depth + 1);
          } else {
            result[key] = null;
          }
        } else {
          result[key] = resolvedValue ?? null;
        }
      } else if (sel.kind === 'FragmentSpread') {
        if (this.shouldSkip(sel.directives)) continue;
        const frag = this.fragments.get(sel.name);
        if (frag) {
          this.fragmentCount++;
          this.events.push({ type: 'fragment', severity: 'detail', message: `フラグメント展開: ...${sel.name} on ${frag.typeCondition}`, path, depth });
          const fragType = this.schema.types.get(frag.typeCondition);
          if (fragType && fragType.kind === 'ObjectType') {
            const fragResult = this.resolveSelectionSet(frag.selectionSet, fragType, parentObj, path, depth);
            Object.assign(result, fragResult);
          }
        }
      } else if (sel.kind === 'InlineFragment') {
        const typeName = sel.typeCondition ?? parentType.name;
        /* 型条件のチェック: parentObj.__typename が一致するか */
        const objTypeName = parentObj['__typename'] as string | undefined;
        if (!sel.typeCondition || objTypeName === typeName || parentType.name === typeName) {
          const fragType = this.schema.types.get(typeName);
          if (fragType && fragType.kind === 'ObjectType') {
            const fragResult = this.resolveSelectionSet(sel.selectionSet, fragType, parentObj, path, depth);
            Object.assign(result, fragResult);
          }
        }
      }
    }
    return result;
  }

  /** リゾルバを呼び出す */
  private callResolver(
    typeName: string,
    fieldName: string,
    parent: Record<string, unknown>,
    args: Record<string, unknown>,
    path: string,
    depth: number,
  ): unknown {
    this.fieldResolves++;

    /* N+1トラッキング */
    const trackKey = `${typeName}.${fieldName}`;
    this.resolveTracker.set(trackKey, (this.resolveTracker.get(trackKey) ?? 0) + 1);

    /* カスタムリゾルバ */
    const typeResolvers = this.resolvers[typeName];
    const resolver = typeResolvers?.[fieldName];

    if (resolver) {
      const result = resolver(parent, args, this.context);
      this.events.push({
        type: 'resolve', severity: 'info',
        message: `${path} → ${summarizeValue(result)}`,
        path, depth,
      });
      return result;
    }

    /* デフォルトリゾルバ: parent[fieldName] */
    const defaultVal = parent[fieldName];
    this.events.push({
      type: 'resolve', severity: 'detail',
      message: `${path} → ${summarizeValue(defaultVal)} (デフォルト)`,
      path, depth,
    });
    return defaultVal;
  }

  /** 引数を解決 */
  private resolveArgs(args: ArgumentNode[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const arg of args) {
      result[arg.name] = this.resolveGQLValue(arg.value);
    }
    return result;
  }

  /** GQLValue を JS値に変換 */
  private resolveGQLValue(val: GQLValue): unknown {
    switch (val.kind) {
      case 'IntValue': return val.value;
      case 'FloatValue': return val.value;
      case 'StringValue': return val.value;
      case 'BooleanValue': return val.value;
      case 'NullValue': return null;
      case 'EnumValue': return val.value;
      case 'Variable': {
        this.variableCount++;
        const v = this.context.variables[val.name];
        this.events.push({ type: 'variable', severity: 'detail', message: `変数 $${val.name} = ${JSON.stringify(v)}` });
        return v;
      }
      case 'ListValue': return val.values.map(v => this.resolveGQLValue(v));
      case 'ObjectValue': {
        const obj: Record<string, unknown> = {};
        for (const f of val.fields) {
          obj[f.name] = this.resolveGQLValue(f.value);
        }
        return obj;
      }
    }
  }

  /** @skip / @include ディレクティブ評価 */
  private shouldSkip(directives: DirectiveNode[]): boolean {
    for (const d of directives) {
      if (d.name === 'skip') {
        const ifArg = d.arguments.find(a => a.name === 'if');
        if (ifArg) {
          const val = this.resolveGQLValue(ifArg.value);
          if (val === true) return true;
        }
      }
      if (d.name === 'include') {
        const ifArg = d.arguments.find(a => a.name === 'if');
        if (ifArg) {
          const val = this.resolveGQLValue(ifArg.value);
          if (val === false) return true;
        }
      }
    }
    return false;
  }

  /** 統計を取得 */
  getStats() {
    return {
      fieldResolves: this.fieldResolves,
      maxDepth: this.maxDepth,
      fragments: this.fragmentCount,
      directives: this.directiveCount,
      variables: this.variableCount,
      n1Queries: this.n1Count,
    };
  }
}

/* ================================================================
   5. 統合実行
   ================================================================ */

export function runGraphQL(
  query: string,
  schema: GQLSchema,
  resolvers: ResolverMap,
  variables: Record<string, unknown> = {},
  store: Record<string, unknown[]> = {},
): GQLSimResult {
  const steps: StepSnapshot[] = [];
  let stepNum = 0;

  /* 1. 字句解析 */
  const lexer = new Lexer(query);
  const tokens = lexer.tokenize();
  steps.push({
    step: stepNum++, phase: 'lex', events: [...lexer.events],
    message: `${tokens.length}トークンを生成`,
  });

  /* 2. 構文解析 */
  const parser = new Parser(tokens);
  const ast = parser.parse();
  steps.push({
    step: stepNum++, phase: 'parse', events: [...parser.events],
    message: `${ast.definitions.length}定義をパース`,
  });

  /* フラグメントマップ */
  const fragments = new Map<string, FragmentDefNode>();
  for (const def of ast.definitions) {
    if (def.kind === 'FragmentDef') {
      fragments.set(def.name, def);
    }
  }

  /* 3. バリデーション */
  const validator = new Validator(schema, fragments);
  const op = ast.definitions.find((d): d is OperationNode => d.kind === 'Operation');
  let validationErrors: string[] = [];
  if (op) {
    validator.validate(ast);
    validationErrors = validator.errors;
  }
  steps.push({
    step: stepNum++, phase: 'validate', events: [...validator.events],
    message: validationErrors.length === 0 ? 'バリデーション成功' : `${validationErrors.length}件のエラー`,
  });

  /* 4. 実行 */
  let data: unknown = null;
  let errors: string[] = [...validationErrors];

  if (op && validationErrors.length === 0) {
    const context: ResolverContext = { store, variables };
    const executor = new Executor(schema, resolvers, context, fragments);
    const result = executor.execute(op);
    data = result.data;
    errors = [...errors, ...result.errors];

    /* 実行イベントをステップ化 */
    const execEvents = executor.events;
    const batchSize = 5;
    for (let i = 0; i < execEvents.length; i += batchSize) {
      const batch = execEvents.slice(i, i + batchSize);
      steps.push({
        step: stepNum++, phase: 'execute',
        events: batch,
        partialResult: data,
        message: batch.map(e => e.message).join('; '),
      });
    }

    const stats = executor.getStats();
    return {
      steps, tokens, ast, validationErrors, data, errors,
      stats: { tokenCount: tokens.length, ...stats },
    };
  }

  return {
    steps, tokens, ast, validationErrors, data, errors,
    stats: {
      tokenCount: tokens.length,
      fieldResolves: 0, maxDepth: 0, fragments: 0,
      directives: 0, variables: 0, n1Queries: 0,
    },
  };
}

/* ================================================================
   6. スキーマビルダーヘルパー
   ================================================================ */

/** 名前付き型参照 */
export function named(name: string): TypeRef {
  return { kind: 'Named', name };
}

/** NonNull 型参照 */
export function nonNull(inner: TypeRef): TypeRef {
  return { kind: 'NonNull', inner };
}

/** List 型参照 */
export function list(inner: TypeRef): TypeRef {
  return { kind: 'List', inner };
}

/** ObjectType を作成 */
export function objectType(name: string, fields: FieldDef[], interfaces: string[] = []): ObjectTypeDef {
  return { kind: 'ObjectType', name, fields, interfaces };
}

/** フィールド定義を作成 */
export function field(name: string, type: TypeRef, args: { name: string; type: TypeRef }[] = []): FieldDef {
  return { name, type, args: args.map(a => ({ name: a.name, type: a.type })) };
}

/* ---------- ユーティリティ ---------- */

/** TypeRef から内側の型名を取り出す */
export function unwrapTypeName(ref: TypeRef): string {
  if (ref.kind === 'Named') return ref.name;
  return unwrapTypeName(ref.inner);
}

/** TypeRef を文字列表現に変換 */
export function typeRefToStr(ref: TypeRef): string {
  if (ref.kind === 'Named') return ref.name;
  if (ref.kind === 'NonNull') return `${typeRefToStr(ref.inner)}!`;
  if (ref.kind === 'List') return `[${typeRefToStr(ref.inner)}]`;
  return '?';
}

/** 値を短い文字列に要約 */
function summarizeValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return val.length > 30 ? `"${val.slice(0, 30)}..."` : `"${val}"`;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `[${val.length}件]`;
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
  }
  return String(val);
}
