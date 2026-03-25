import { describe, it, expect } from "vitest";
import { tokenize } from "../sql/tokenizer.js";
import { Parser } from "../sql/parser.js";
import type { SelectStmt, InsertStmt, CreateTableStmt, UpdateStmt, DeleteStmt, CreateIndexStmt } from "../types.js";

function parse(sql: string) {
  return new Parser(tokenize(sql)).parse();
}

describe("parser", () => {
  describe("SELECT", () => {
    it("基本的なSELECTをパースする", () => {
      const stmt = parse("SELECT * FROM users");
      expect(stmt.type).toBe("select");
      const select = stmt as SelectStmt;
      expect(select.columns).toHaveLength(1);
      expect(select.columns[0]?.expr.type).toBe("wildcard");
      expect(select.from?.type).toBe("table");
    });

    it("WHERE句をパースする", () => {
      const stmt = parse("SELECT id, name FROM users WHERE id = 1");
      expect(stmt.type).toBe("select");
      const select = stmt as SelectStmt;
      expect(select.columns).toHaveLength(2);
      expect(select.where?.type).toBe("binary_op");
    });

    it("ORDER BY をパースする", () => {
      const stmt = parse("SELECT * FROM users ORDER BY name ASC, id DESC");
      const select = stmt as SelectStmt;
      expect(select.orderBy).toHaveLength(2);
      expect(select.orderBy?.[0]?.direction).toBe("ASC");
      expect(select.orderBy?.[1]?.direction).toBe("DESC");
    });

    it("LIMIT / OFFSET をパースする", () => {
      const stmt = parse("SELECT * FROM users LIMIT 10 OFFSET 5");
      const select = stmt as SelectStmt;
      expect(select.limit?.type).toBe("literal");
      expect(select.offset?.type).toBe("literal");
    });

    it("GROUP BY / HAVING をパースする", () => {
      const stmt = parse("SELECT dept, COUNT(*) FROM emp GROUP BY dept HAVING COUNT(*) > 5");
      const select = stmt as SelectStmt;
      expect(select.groupBy).toHaveLength(1);
      expect(select.having).toBeDefined();
    });

    it("DISTINCT をパースする", () => {
      const stmt = parse("SELECT DISTINCT name FROM users");
      const select = stmt as SelectStmt;
      expect(select.distinct).toBe(true);
    });

    it("JOIN をパースする", () => {
      const stmt = parse("SELECT * FROM users JOIN orders ON users.id = orders.user_id");
      const select = stmt as SelectStmt;
      expect(select.from?.type).toBe("join");
    });

    it("LEFT JOIN をパースする", () => {
      const stmt = parse("SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id");
      const select = stmt as SelectStmt;
      if (select.from?.type === "join") {
        expect(select.from.joinType).toBe("LEFT");
      }
    });

    it("エイリアスをパースする", () => {
      const stmt = parse("SELECT u.name AS user_name FROM users u");
      const select = stmt as SelectStmt;
      expect(select.columns[0]?.alias).toBe("user_name");
    });

    it("BETWEEN をパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE x BETWEEN 1 AND 10");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("between");
    });

    it("IN リストをパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE x IN (1, 2, 3)");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("in_list");
    });

    it("LIKE をパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE name LIKE '%test%'");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("like");
    });

    it("IS NULL をパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE x IS NULL");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("is_null");
    });

    it("IS NOT NULL をパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE x IS NOT NULL");
      const select = stmt as SelectStmt;
      if (select.where?.type === "is_null") {
        expect(select.where.not).toBe(true);
      }
    });

    it("サブクエリをパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE x IN (SELECT id FROM t2)");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("in_subquery");
    });

    it("EXISTS をパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE EXISTS (SELECT 1 FROM t2)");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("exists");
    });
  });

  describe("INSERT", () => {
    it("基本的なINSERTをパースする", () => {
      const stmt = parse("INSERT INTO users (name, age) VALUES ('Alice', 30)");
      expect(stmt.type).toBe("insert");
      const insert = stmt as InsertStmt;
      expect(insert.table).toBe("users");
      expect(insert.columns).toEqual(["name", "age"]);
      expect(insert.values).toHaveLength(1);
    });

    it("複数行INSERTをパースする", () => {
      const stmt = parse("INSERT INTO t VALUES (1, 'a'), (2, 'b')");
      const insert = stmt as InsertStmt;
      expect(insert.values).toHaveLength(2);
    });
  });

  describe("UPDATE", () => {
    it("UPDATEをパースする", () => {
      const stmt = parse("UPDATE users SET name = 'Bob' WHERE id = 1");
      expect(stmt.type).toBe("update");
      const update = stmt as UpdateStmt;
      expect(update.table).toBe("users");
      expect(update.set).toHaveLength(1);
      expect(update.where).toBeDefined();
    });
  });

  describe("DELETE", () => {
    it("DELETEをパースする", () => {
      const stmt = parse("DELETE FROM users WHERE id = 1");
      expect(stmt.type).toBe("delete");
      const del = stmt as DeleteStmt;
      expect(del.table).toBe("users");
      expect(del.where).toBeDefined();
    });
  });

  describe("CREATE TABLE", () => {
    it("CREATE TABLEをパースする", () => {
      const stmt = parse("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)");
      expect(stmt.type).toBe("create_table");
      const create = stmt as CreateTableStmt;
      expect(create.name).toBe("users");
      expect(create.columns).toHaveLength(3);
      expect(create.columns[0]?.primaryKey).toBe(true);
      expect(create.columns[1]?.notNull).toBe(true);
    });

    it("IF NOT EXISTS をパースする", () => {
      const stmt = parse("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)");
      const create = stmt as CreateTableStmt;
      expect(create.ifNotExists).toBe(true);
    });

    it("AUTOINCREMENT をパースする", () => {
      const stmt = parse("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)");
      const create = stmt as CreateTableStmt;
      expect(create.columns[0]?.autoIncrement).toBe(true);
    });
  });

  describe("CREATE INDEX", () => {
    it("CREATE INDEX をパースする", () => {
      const stmt = parse("CREATE INDEX idx_name ON users (name)");
      expect(stmt.type).toBe("create_index");
      const idx = stmt as CreateIndexStmt;
      expect(idx.name).toBe("idx_name");
      expect(idx.table).toBe("users");
      expect(idx.columns).toEqual(["name"]);
    });

    it("UNIQUE INDEX をパースする", () => {
      const stmt = parse("CREATE UNIQUE INDEX idx ON t (col)");
      const idx = stmt as CreateIndexStmt;
      expect(idx.unique).toBe(true);
    });
  });

  describe("DROP TABLE", () => {
    it("DROP TABLE をパースする", () => {
      const stmt = parse("DROP TABLE users");
      expect(stmt.type).toBe("drop_table");
    });

    it("DROP TABLE IF EXISTS をパースする", () => {
      const stmt = parse("DROP TABLE IF EXISTS users");
      expect(stmt.type).toBe("drop_table");
    });
  });

  describe("式", () => {
    it("算術式をパースする", () => {
      const stmt = parse("SELECT 1 + 2 * 3");
      const select = stmt as SelectStmt;
      const expr = select.columns[0]?.expr;
      // 1 + (2 * 3) の優先度
      expect(expr?.type).toBe("binary_op");
      if (expr?.type === "binary_op") {
        expect(expr.op).toBe("+");
        expect(expr.right.type).toBe("binary_op");
      }
    });

    it("NOT をパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE NOT x = 1");
      const select = stmt as SelectStmt;
      expect(select.where?.type).toBe("unary_op");
    });

    it("AND/OR の優先度を正しくパースする", () => {
      const stmt = parse("SELECT * FROM t WHERE a = 1 OR b = 2 AND c = 3");
      const select = stmt as SelectStmt;
      // OR が最上位: a=1 OR (b=2 AND c=3)
      expect(select.where?.type).toBe("binary_op");
      if (select.where?.type === "binary_op") {
        expect(select.where.op).toBe("OR");
      }
    });
  });
});
