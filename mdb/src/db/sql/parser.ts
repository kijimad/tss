/**
 * parser.ts — トークン列 → AST（再帰下降パーサー）
 *
 * トークナイザが出力したトークン列を、SQLの文法に従って AST に変換する。
 * 「再帰下降」とは、文法の各規則を1つの関数として実装する手法。
 *
 * 例: "SELECT name FROM users WHERE id = 1"
 *   → SelectStmt {
 *       columns: [{ expr: { type: "column_ref", column: "name" } }],
 *       from: { type: "table", name: "users" },
 *       where: { type: "binary_op", op: "=",
 *                left: { type: "column_ref", column: "id" },
 *                right: { type: "literal", value: 1 } }
 *     }
 *
 * 式の優先順位（低い→高い）:
 *   OR → AND → NOT → 比較/BETWEEN/IN/LIKE → || → +- → *×/% → 単項- → 一次式
 * 各優先度レベルを別々のメソッドとして実装し、
 * 高い優先度のメソッドから低い優先度のメソッドを呼ぶ構造にしている。
 */
import { TokenKind, type Token } from "./token-types.js";
import type {
  Stmt, SelectStmt, InsertStmt, UpdateStmt, DeleteStmt,
  CreateTableStmt, CreateIndexStmt, DropTableStmt,
  Expr, SelectColumn, FromClause, OrderByItem, JoinType,
  ColumnDef, ColumnType, BinaryOp,
} from "../types.js";

export class Parser {
  private tokens: Token[];
  private pos = 0;  // 現在読んでいるトークンの位置

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // SQL文を1つパースする（入力全体が1文であることを期待）
  parse(): Stmt {
    const stmt = this.parseStatement();
    if (this.check(TokenKind.Semicolon)) this.advance();
    this.expect(TokenKind.Eof);
    return stmt;
  }

  // 複数のSQL文をパースする（セミコロン区切り）
  parseMultiple(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.check(TokenKind.Eof)) {
      stmts.push(this.parseStatement());
      if (this.check(TokenKind.Semicolon)) this.advance();
    }
    return stmts;
  }

  // 先頭のキーワードで文の種類を判定し、対応するパースメソッドに振り分ける
  private parseStatement(): Stmt {
    if (this.check(TokenKind.Select)) return this.parseSelect();
    if (this.check(TokenKind.Insert)) return this.parseInsert();
    if (this.check(TokenKind.Update)) return this.parseUpdate();
    if (this.check(TokenKind.Delete)) return this.parseDelete();
    if (this.check(TokenKind.Create)) return this.parseCreate();
    if (this.check(TokenKind.Drop)) return this.parseDrop();
    throw this.error(`予期しないトークン: ${this.peek().value || this.peek().kind}`);
  }

  // =====================================================
  // SELECT文のパース
  // 構文: SELECT [DISTINCT] columns FROM table
  //       [WHERE expr] [GROUP BY exprs] [HAVING expr]
  //       [ORDER BY items] [LIMIT expr] [OFFSET expr]
  // =====================================================
  private parseSelect(): SelectStmt {
    this.expect(TokenKind.Select);
    let distinct = false;
    if (this.check(TokenKind.Distinct)) {
      this.advance();
      distinct = true;
    }

    const columns = this.parseSelectColumns();
    let from: FromClause | undefined;
    if (this.match(TokenKind.From)) {
      from = this.parseFromClause();
    }

    let where: Expr | undefined;
    if (this.match(TokenKind.Where)) {
      where = this.parseExpr();
    }

    let groupBy: Expr[] | undefined;
    if (this.check(TokenKind.Group)) {
      this.advance();
      this.expect(TokenKind.By);
      groupBy = [this.parseExpr()];
      while (this.match(TokenKind.Comma)) {
        groupBy.push(this.parseExpr());
      }
    }

    let having: Expr | undefined;
    if (this.match(TokenKind.Having)) {
      having = this.parseExpr();
    }

    let orderBy: OrderByItem[] | undefined;
    if (this.check(TokenKind.Order)) {
      this.advance();
      this.expect(TokenKind.By);
      orderBy = [this.parseOrderByItem()];
      while (this.match(TokenKind.Comma)) {
        orderBy.push(this.parseOrderByItem());
      }
    }

    let limit: Expr | undefined;
    if (this.match(TokenKind.Limit)) {
      limit = this.parseExpr();
    }

    let offset: Expr | undefined;
    if (this.match(TokenKind.Offset)) {
      offset = this.parseExpr();
    }

    return { type: "select", columns, from, where, groupBy, having, orderBy, limit, offset, distinct };
  }

  // SELECT句のカラムリスト（カンマ区切り）
  private parseSelectColumns(): SelectColumn[] {
    const cols: SelectColumn[] = [];
    cols.push(this.parseSelectColumn());
    while (this.match(TokenKind.Comma)) {
      cols.push(this.parseSelectColumn());
    }
    return cols;
  }

  // SELECT句の1カラム: 式 [AS alias]
  // 特殊ケース: "*"（全カラム）、"table.*"（特定テーブルの全カラム）
  private parseSelectColumn(): SelectColumn {
    // 3トークン先読みで table.* パターンを検出
    if (this.check(TokenKind.Identifier) && this.peekNext()?.kind === TokenKind.Dot && this.peekAt(2)?.kind === TokenKind.Star) {
      const table = this.advance().value;
      this.advance(); // .
      this.advance(); // *
      const alias = this.parseOptionalAlias();
      return { expr: { type: "wildcard", table }, alias };
    }
    if (this.check(TokenKind.Star)) {
      this.advance();
      return { expr: { type: "wildcard" } };
    }
    const expr = this.parseExpr();
    const alias = this.parseOptionalAlias();
    return { expr, alias };
  }

  // AS エイリアス（AS は省略可能）
  // "SELECT name AS n" → alias = "n"
  // "SELECT name n"    → alias = "n"（AS省略形）
  private parseOptionalAlias(): string | undefined {
    if (this.match(TokenKind.As)) {
      return this.expectIdentifier();
    }
    if (this.check(TokenKind.Identifier)) {
      return this.advance().value;
    }
    return undefined;
  }

  // ORDER BY の1要素: 式 [ASC|DESC]
  private parseOrderByItem(): OrderByItem {
    const expr = this.parseExpr();
    let direction: "ASC" | "DESC" = "ASC";
    if (this.match(TokenKind.Asc)) {
      direction = "ASC";
    } else if (this.match(TokenKind.Desc)) {
      direction = "DESC";
    }
    return { expr, direction };
  }

  // =====================================================
  // FROM句のパース
  // テーブル参照の後に JOIN が続く場合は左結合的に AST を構築する
  // 例: "users JOIN orders ON ..."
  //   → { type: "join", left: users, right: orders, on: ... }
  // =====================================================
  private parseFromClause(): FromClause {
    let left = this.parseFromItem();
    // JOIN がある限り繰り返し結合（左結合的に木を構築）
    while (this.checkJoin()) {
      const joinType = this.parseJoinType();
      const right = this.parseFromItem();
      this.expect(TokenKind.On);
      const on = this.parseExpr();
      left = { type: "join", left, right, joinType, on };
    }
    return left;
  }

  // FROM句の1要素: テーブル名 or サブクエリ
  private parseFromItem(): FromClause {
    if (this.check(TokenKind.LeftParen)) {
      // サブクエリ: (SELECT ...) [AS] alias
      this.advance();
      const query = this.parseSelect();
      this.expect(TokenKind.RightParen);
      const alias = this.parseOptionalAlias() ?? "";
      return { type: "subquery", query, alias };
    }
    const name = this.expectIdentifier();
    const alias = this.parseOptionalAlias();
    return { type: "table", name, alias };
  }

  // 次のトークンが JOIN 系キーワードか判定
  private checkJoin(): boolean {
    return this.check(TokenKind.Join)
      || this.check(TokenKind.Inner)
      || this.check(TokenKind.Left);
  }

  // JOIN の種類を判定して消費する
  // "JOIN" → INNER（デフォルト）、"INNER JOIN"、"LEFT JOIN"
  private parseJoinType(): JoinType {
    if (this.match(TokenKind.Inner)) {
      this.expect(TokenKind.Join);
      return "INNER";
    }
    if (this.match(TokenKind.Left)) {
      this.expect(TokenKind.Join);
      return "LEFT";
    }
    this.expect(TokenKind.Join);
    return "INNER";
  }

  // =====================================================
  // INSERT文のパース
  // 構文: INSERT INTO table [(columns)] VALUES (row), (row), ...
  // =====================================================
  private parseInsert(): InsertStmt {
    this.expect(TokenKind.Insert);
    this.expect(TokenKind.Into);
    const table = this.expectIdentifier();

    // カラム指定（オプション）: (col1, col2, ...)
    let columns: string[] | undefined;
    if (this.match(TokenKind.LeftParen)) {
      columns = [this.expectIdentifier()];
      while (this.match(TokenKind.Comma)) {
        columns.push(this.expectIdentifier());
      }
      this.expect(TokenKind.RightParen);
    }

    this.expect(TokenKind.Values);
    // 複数行の VALUES をサポート: VALUES (1, 'a'), (2, 'b')
    const values: Expr[][] = [];
    values.push(this.parseValueRow());
    while (this.match(TokenKind.Comma)) {
      values.push(this.parseValueRow());
    }

    return { type: "insert", table, columns, values };
  }

  // VALUES の1行: (expr, expr, ...)
  private parseValueRow(): Expr[] {
    this.expect(TokenKind.LeftParen);
    const row: Expr[] = [this.parseExpr()];
    while (this.match(TokenKind.Comma)) {
      row.push(this.parseExpr());
    }
    this.expect(TokenKind.RightParen);
    return row;
  }

  // =====================================================
  // UPDATE文のパース
  // 構文: UPDATE table SET col = expr, ... [WHERE expr]
  // =====================================================
  private parseUpdate(): UpdateStmt {
    this.expect(TokenKind.Update);
    const table = this.expectIdentifier();
    this.expect(TokenKind.Set);

    const set: { column: string; value: Expr }[] = [];
    set.push(this.parseSetItem());
    while (this.match(TokenKind.Comma)) {
      set.push(this.parseSetItem());
    }

    let where: Expr | undefined;
    if (this.match(TokenKind.Where)) {
      where = this.parseExpr();
    }

    return { type: "update", table, set, where };
  }

  // SET句の1要素: column = expr
  private parseSetItem(): { column: string; value: Expr } {
    const column = this.expectIdentifier();
    this.expect(TokenKind.Eq);
    const value = this.parseExpr();
    return { column, value };
  }

  // =====================================================
  // DELETE文のパース
  // 構文: DELETE FROM table [WHERE expr]
  // =====================================================
  private parseDelete(): DeleteStmt {
    this.expect(TokenKind.Delete);
    this.expect(TokenKind.From);
    const table = this.expectIdentifier();

    let where: Expr | undefined;
    if (this.match(TokenKind.Where)) {
      where = this.parseExpr();
    }

    return { type: "delete", table, where };
  }

  // =====================================================
  // CREATE文のパース
  // CREATE TABLE / CREATE [UNIQUE] INDEX を先頭キーワードで振り分け
  // =====================================================
  private parseCreate(): CreateTableStmt | CreateIndexStmt {
    this.expect(TokenKind.Create);

    if (this.check(TokenKind.Unique)) {
      this.advance();
      return this.parseCreateIndex(true);
    }
    if (this.check(TokenKind.Index)) {
      return this.parseCreateIndex(false);
    }

    return this.parseCreateTable();
  }

  // CREATE TABLE [IF NOT EXISTS] name (column_def, ...)
  private parseCreateTable(): CreateTableStmt {
    this.expect(TokenKind.Table);
    let ifNotExists = false;
    if (this.check(TokenKind.If)) {
      this.advance();
      this.expect(TokenKind.Not);
      this.expect(TokenKind.Exists);
      ifNotExists = true;
    }
    const name = this.expectIdentifier();
    this.expect(TokenKind.LeftParen);

    const columns: ColumnDef[] = [this.parseColumnDef()];
    while (this.match(TokenKind.Comma)) {
      // テーブルレベルの PRIMARY KEY 制約に遭遇したらカラム定義の読み取りを終了
      if (this.check(TokenKind.Primary)) break;
      columns.push(this.parseColumnDef());
    }

    // テーブルレベルの PRIMARY KEY (column_name) 制約
    if (this.check(TokenKind.Primary)) {
      this.advance();
      this.expect(TokenKind.Key);
      this.expect(TokenKind.LeftParen);
      const pkCol = this.expectIdentifier();
      this.expect(TokenKind.RightParen);
      for (const col of columns) {
        if (col.name === pkCol) col.primaryKey = true;
      }
    }

    this.expect(TokenKind.RightParen);
    return { type: "create_table", name, columns, ifNotExists };
  }

  // カラム定義: name TYPE [PRIMARY KEY] [NOT NULL] [AUTOINCREMENT]
  // 制約は任意の順序で出現可能
  private parseColumnDef(): ColumnDef {
    const name = this.expectIdentifier();
    const colType = this.parseColumnType();
    const col: ColumnDef = { name, type: colType };

    // カラムレベルの制約を繰り返し読み取る
    while (true) {
      if (this.check(TokenKind.Primary)) {
        this.advance();
        this.expect(TokenKind.Key);
        col.primaryKey = true;
        continue;
      }
      if (this.check(TokenKind.Not)) {
        this.advance();
        this.expect(TokenKind.Null);
        col.notNull = true;
        continue;
      }
      if (this.check(TokenKind.Autoincrement)) {
        this.advance();
        col.autoIncrement = true;
        continue;
      }
      break;
    }

    return col;
  }

  // カラム型キーワード: INTEGER | TEXT | REAL | BLOB
  private parseColumnType(): ColumnType {
    if (this.match(TokenKind.Integer)) return "INTEGER";
    if (this.match(TokenKind.Text)) return "TEXT";
    if (this.match(TokenKind.Real)) return "REAL";
    if (this.match(TokenKind.Blob)) return "BLOB";
    throw this.error(`カラム型が必要です: ${this.peek().kind}`);
  }

  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table (col, ...)
  private parseCreateIndex(unique: boolean): CreateIndexStmt {
    this.expect(TokenKind.Index);
    let ifNotExists = false;
    if (this.check(TokenKind.If)) {
      this.advance();
      this.expect(TokenKind.Not);
      this.expect(TokenKind.Exists);
      ifNotExists = true;
    }
    const name = this.expectIdentifier();
    this.expect(TokenKind.On);
    const table = this.expectIdentifier();
    this.expect(TokenKind.LeftParen);
    const columns = [this.expectIdentifier()];
    while (this.match(TokenKind.Comma)) {
      columns.push(this.expectIdentifier());
    }
    this.expect(TokenKind.RightParen);
    return { type: "create_index", name, table, columns, unique, ifNotExists };
  }

  // =====================================================
  // DROP TABLE [IF EXISTS] name
  // =====================================================
  private parseDrop(): DropTableStmt {
    this.expect(TokenKind.Drop);
    this.expect(TokenKind.Table);
    let ifExists = false;
    if (this.check(TokenKind.If)) {
      this.advance();
      this.expect(TokenKind.Exists);
      ifExists = true;
    }
    const name = this.expectIdentifier();
    return { type: "drop_table", name, ifExists };
  }

  // =====================================================
  // 式パーサー（演算子の優先順位に基づく再帰下降）
  //
  // 優先度（低→高）:
  //   parseOr        → OR
  //   parseAnd       → AND
  //   parseNot       → NOT（単項）
  //   parseComparison → =, !=, <, >, <=, >=, IS NULL, BETWEEN, IN, LIKE
  //   parseConcat    → ||（文字列連結）
  //   parseAddSub    → +, -
  //   parseMulDiv    → *, /, %
  //   parseUnary     → -（単項マイナス）
  //   parsePrimary   → リテラル、カラム参照、関数呼び出し、括弧、サブクエリ
  // =====================================================
  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match(TokenKind.Or)) {
      const right = this.parseAnd();
      left = { type: "binary_op", op: "OR", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.match(TokenKind.And)) {
      const right = this.parseNot();
      left = { type: "binary_op", op: "AND", left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.match(TokenKind.Not)) {
      const operand = this.parseNot();
      return { type: "unary_op", op: "NOT", operand };
    }
    return this.parseComparison();
  }

  // 比較演算子と特殊構文（IS NULL, BETWEEN, IN, LIKE）を処理する
  // NOT BETWEEN, NOT IN, NOT LIKE は比較レベルで NOT を消費する
  private parseComparison(): Expr {
    let left = this.parseConcat();

    // IS [NOT] NULL
    if (this.check(TokenKind.Is)) {
      this.advance();
      const not = this.match(TokenKind.Not);
      this.expect(TokenKind.Null);
      return { type: "is_null", expr: left, not };
    }

    // "NOT" が比較演算子の前に来る場合: NOT BETWEEN, NOT IN, NOT LIKE
    const not = this.match(TokenKind.Not);

    if (this.match(TokenKind.Between)) {
      // BETWEEN low AND high（この AND は論理演算ではなく BETWEEN の構文）
      const low = this.parseConcat();
      this.expect(TokenKind.And);
      const high = this.parseConcat();
      return { type: "between", expr: left, low, high, not };
    }

    if (this.match(TokenKind.In)) {
      this.expect(TokenKind.LeftParen);
      // IN の中が SELECT なら IN サブクエリ、それ以外は IN リスト
      if (this.check(TokenKind.Select)) {
        const query = this.parseSelect();
        this.expect(TokenKind.RightParen);
        return { type: "in_subquery", expr: left, query, not };
      }
      const values = [this.parseExpr()];
      while (this.match(TokenKind.Comma)) {
        values.push(this.parseExpr());
      }
      this.expect(TokenKind.RightParen);
      return { type: "in_list", expr: left, values, not };
    }

    if (this.match(TokenKind.Like)) {
      const pattern = this.parseConcat();
      return { type: "like", expr: left, pattern, not };
    }

    if (not) {
      throw this.error("NOT の後に BETWEEN, IN, LIKE が必要です");
    }

    // 通常の比較演算子: =, !=, <, >, <=, >=
    const opMap: Partial<Record<TokenKind, BinaryOp>> = {
      [TokenKind.Eq]: "=",
      [TokenKind.Neq]: "!=",
      [TokenKind.Lt]: "<",
      [TokenKind.Gt]: ">",
      [TokenKind.Lte]: "<=",
      [TokenKind.Gte]: ">=",
    };
    const op = opMap[this.peek().kind];
    if (op !== undefined) {
      this.advance();
      const right = this.parseConcat();
      left = { type: "binary_op", op, left, right };
    }

    return left;
  }

  // 文字列連結演算子 ||
  private parseConcat(): Expr {
    let left = this.parseAddSub();
    while (this.match(TokenKind.Concat)) {
      const right = this.parseAddSub();
      left = { type: "binary_op", op: "||", left, right };
    }
    return left;
  }

  // 加算・減算
  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (true) {
      if (this.match(TokenKind.Plus)) {
        left = { type: "binary_op", op: "+", left, right: this.parseMulDiv() };
      } else if (this.match(TokenKind.Minus)) {
        left = { type: "binary_op", op: "-", left, right: this.parseMulDiv() };
      } else break;
    }
    return left;
  }

  // 乗算・除算・剰余
  private parseMulDiv(): Expr {
    let left = this.parseUnary();
    while (true) {
      if (this.match(TokenKind.Star)) {
        left = { type: "binary_op", op: "*", left, right: this.parseUnary() };
      } else if (this.match(TokenKind.Slash)) {
        left = { type: "binary_op", op: "/", left, right: this.parseUnary() };
      } else if (this.match(TokenKind.Percent)) {
        left = { type: "binary_op", op: "%", left, right: this.parseUnary() };
      } else break;
    }
    return left;
  }

  // 単項マイナス: -expr
  private parseUnary(): Expr {
    if (this.match(TokenKind.Minus)) {
      return { type: "unary_op", op: "-", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  // 一次式: リテラル、カラム参照、関数呼び出し、括弧、サブクエリ
  private parsePrimary(): Expr {
    // EXISTS (SELECT ...)
    if (this.check(TokenKind.Exists)) {
      this.advance();
      this.expect(TokenKind.LeftParen);
      const query = this.parseSelect();
      this.expect(TokenKind.RightParen);
      return { type: "exists", query };
    }

    // 括弧: 通常の式グルーピング or スカラーサブクエリ
    if (this.check(TokenKind.LeftParen)) {
      this.advance();
      if (this.check(TokenKind.Select)) {
        const query = this.parseSelect();
        this.expect(TokenKind.RightParen);
        return { type: "subquery", query };
      }
      const expr = this.parseExpr();
      this.expect(TokenKind.RightParen);
      return expr;
    }

    // NULL リテラル
    if (this.match(TokenKind.Null)) {
      return { type: "literal", value: null };
    }

    // 数値リテラル
    if (this.check(TokenKind.Number)) {
      const val = this.advance().value;
      return { type: "literal", value: Number(val) };
    }

    // 文字列リテラル
    if (this.check(TokenKind.String)) {
      const val = this.advance().value;
      return { type: "literal", value: val };
    }

    // 識別子: カラム参照、関数呼び出し、テーブル修飾付きカラム参照
    if (this.check(TokenKind.Identifier)) {
      const name = this.advance().value;

      // 識別子の直後に "(" があれば関数呼び出し
      if (this.check(TokenKind.LeftParen)) {
        return this.parseFunctionCall(name);
      }

      // 識別子の直後に "." があればテーブル修飾: table.column or table.*
      if (this.match(TokenKind.Dot)) {
        if (this.check(TokenKind.Star)) {
          this.advance();
          return { type: "wildcard", table: name };
        }
        const col = this.expectIdentifier();
        return { type: "column_ref", table: name, column: col };
      }

      return { type: "column_ref", column: name };
    }

    // 型名キーワード（INTEGER, TEXT等）がカラム名や関数名として使われるケース
    const aggKeywords: readonly TokenKind[] = [TokenKind.Integer, TokenKind.Text, TokenKind.Real, TokenKind.Blob];
    if (aggKeywords.includes(this.peek().kind)) {
      const name = this.advance().value;
      if (this.check(TokenKind.LeftParen)) {
        return this.parseFunctionCall(name);
      }
      return { type: "column_ref", column: name };
    }

    // "*" が式として出現するケース（集約関数の引数として）
    if (this.check(TokenKind.Star)) {
      this.advance();
      return { type: "wildcard" };
    }

    throw this.error(`式が必要です: ${this.peek().value || this.peek().kind}`);
  }

  // 関数呼び出し: name(args...)
  // COUNT(*) と DISTINCT 修飾子を特別扱いする
  private parseFunctionCall(name: string): Expr {
    this.expect(TokenKind.LeftParen);
    const upperName = name.toUpperCase();

    // COUNT(*) の特殊構文
    if (this.check(TokenKind.Star) && upperName === "COUNT") {
      this.advance();
      this.expect(TokenKind.RightParen);
      return { type: "function_call", name: upperName, args: [{ type: "wildcard" }] };
    }

    // COUNT(DISTINCT col) 等の DISTINCT 修飾
    let distinct = false;
    if (this.match(TokenKind.Distinct)) {
      distinct = true;
    }

    // 引数なしの関数呼び出し
    if (this.check(TokenKind.RightParen)) {
      this.advance();
      return { type: "function_call", name: upperName, args: [], distinct };
    }

    // カンマ区切りの引数リスト
    const args: Expr[] = [this.parseExpr()];
    while (this.match(TokenKind.Comma)) {
      args.push(this.parseExpr());
    }
    this.expect(TokenKind.RightParen);
    return { type: "function_call", name: upperName, args, distinct };
  }

  // =====================================================
  // トークン操作ユーティリティ
  // peek()    — 現在のトークンを返す（消費しない）
  // advance() — 現在のトークンを返し、位置を1つ進める
  // check()   — 現在のトークンが指定種別か判定（消費しない）
  // match()   — check() が true なら advance() して true を返す
  // expect()  — check() が false ならエラーを投げる
  // =====================================================
  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: TokenKind.Eof, value: "", position: -1 };
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private peekAt(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private advance(): Token {
    const token = this.peek();
    this.pos++;
    return token;
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private match(kind: TokenKind): boolean {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(kind: TokenKind): Token {
    if (!this.check(kind)) {
      throw this.error(`'${kind}' が必要ですが '${this.peek().value || this.peek().kind}' が見つかりました`);
    }
    return this.advance();
  }

  // 識別子を期待するが、一部のキーワードも識別子として許容する
  // （例: "INTEGER" をカラム名として使う場合）
  private expectIdentifier(): string {
    const token = this.peek();
    if (token.kind === TokenKind.Identifier) {
      return this.advance().value;
    }
    const allowedKeywords: TokenKind[] = [
      TokenKind.Integer, TokenKind.Text, TokenKind.Real, TokenKind.Blob,
      TokenKind.Key, TokenKind.Index,
    ];
    if (allowedKeywords.includes(token.kind)) {
      return this.advance().value;
    }
    throw this.error(`識別子が必要ですが '${token.value || token.kind}' が見つかりました`);
  }

  private error(message: string): Error {
    const token = this.peek();
    return new Error(`パースエラー (位置 ${token.position}): ${message}`);
  }
}
