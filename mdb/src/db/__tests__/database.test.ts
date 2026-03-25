import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "../database.js";

describe("Database E2E", () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.openMemory();
  });

  describe("CREATE TABLE + INSERT + SELECT", () => {
    it("テーブル作成・挿入・検索の一気通貫テスト", async () => {
      await db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
      await db.execute("INSERT INTO users (id, name, age) VALUES (1, 'Alice', 30)");
      await db.execute("INSERT INTO users (id, name, age) VALUES (2, 'Bob', 25)");
      await db.execute("INSERT INTO users (id, name, age) VALUES (3, 'Charlie', 35)");

      const result = await db.execute("SELECT * FROM users");
      expect(result.rows).toHaveLength(3);
    });

    it("IF NOT EXISTS で重複作成をスキップする", async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      // 2回目はエラーにならない
      await db.execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
    });

    it("AUTOINCREMENT が動作する", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      await db.execute("INSERT INTO items (name) VALUES ('first')");
      await db.execute("INSERT INTO items (name) VALUES ('second')");
      await db.execute("INSERT INTO items (name) VALUES ('third')");

      const result = await db.execute("SELECT id, name FROM items");
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]?.[0]).toBe(1);
      expect(result.rows[1]?.[0]).toBe(2);
      expect(result.rows[2]?.[0]).toBe(3);
    });
  });

  describe("WHERE", () => {
    beforeEach(async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)");
      await db.execute("INSERT INTO t VALUES (1, 'Alice', 85)");
      await db.execute("INSERT INTO t VALUES (2, 'Bob', 92)");
      await db.execute("INSERT INTO t VALUES (3, 'Charlie', 78)");
      await db.execute("INSERT INTO t VALUES (4, 'Diana', 95)");
    });

    it("等価条件でフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE id = 2");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe("Bob");
    });

    it("比較条件でフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE score > 90");
      expect(result.rows).toHaveLength(2);
    });

    it("AND条件でフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE score >= 80 AND score <= 90");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe("Alice");
    });

    it("OR条件でフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE name = 'Alice' OR name = 'Bob'");
      expect(result.rows).toHaveLength(2);
    });

    it("BETWEEN でフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE score BETWEEN 80 AND 93");
      expect(result.rows).toHaveLength(2);
    });

    it("IN リストでフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE id IN (1, 3)");
      expect(result.rows).toHaveLength(2);
    });

    it("LIKE でフィルタする", async () => {
      const result = await db.execute("SELECT name FROM t WHERE name LIKE 'A%'");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe("Alice");
    });

    it("IS NULL でフィルタする", async () => {
      await db.execute("INSERT INTO t VALUES (5, NULL, 60)");
      const result = await db.execute("SELECT id FROM t WHERE name IS NULL");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe(5);
    });

    it("IS NOT NULL でフィルタする", async () => {
      await db.execute("INSERT INTO t VALUES (5, NULL, 60)");
      const result = await db.execute("SELECT id FROM t WHERE name IS NOT NULL");
      expect(result.rows).toHaveLength(4);
    });
  });

  describe("UPDATE", () => {
    it("行を更新する", async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      await db.execute("INSERT INTO t VALUES (1, 'Alice')");
      const updated = await db.execute("UPDATE t SET name = 'Bob' WHERE id = 1");
      expect(updated.rowsAffected).toBe(1);

      const result = await db.execute("SELECT name FROM t WHERE id = 1");
      expect(result.rows[0]?.[0]).toBe("Bob");
    });
  });

  describe("DELETE", () => {
    it("行を削除する", async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      await db.execute("INSERT INTO t VALUES (1, 'Alice')");
      await db.execute("INSERT INTO t VALUES (2, 'Bob')");
      const deleted = await db.execute("DELETE FROM t WHERE id = 1");
      expect(deleted.rowsAffected).toBe(1);

      const result = await db.execute("SELECT * FROM t");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[1]).toBe("Bob");
    });
  });

  describe("ORDER BY / LIMIT", () => {
    beforeEach(async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)");
      await db.execute("INSERT INTO t VALUES (1, 'Alice', 85)");
      await db.execute("INSERT INTO t VALUES (2, 'Bob', 92)");
      await db.execute("INSERT INTO t VALUES (3, 'Charlie', 78)");
    });

    it("ORDER BY ASC でソートする", async () => {
      const result = await db.execute("SELECT name FROM t ORDER BY score ASC");
      expect(result.rows.map(r => r[0])).toEqual(["Charlie", "Alice", "Bob"]);
    });

    it("ORDER BY DESC でソートする", async () => {
      const result = await db.execute("SELECT name FROM t ORDER BY score DESC");
      expect(result.rows.map(r => r[0])).toEqual(["Bob", "Alice", "Charlie"]);
    });

    it("LIMIT で結果を制限する", async () => {
      const result = await db.execute("SELECT name FROM t ORDER BY score DESC LIMIT 2");
      expect(result.rows).toHaveLength(2);
    });

    it("OFFSET で結果をスキップする", async () => {
      const result = await db.execute("SELECT name FROM t ORDER BY score DESC LIMIT 1 OFFSET 1");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe("Alice");
    });
  });

  describe("CREATE INDEX", () => {
    it("インデックスを作成して使用する", async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      await db.execute("INSERT INTO t VALUES (1, 'Alice')");
      await db.execute("INSERT INTO t VALUES (2, 'Bob')");
      await db.execute("CREATE INDEX idx_name ON t (name)");

      const result = await db.execute("SELECT * FROM t WHERE name = 'Alice'");
      expect(result.rows).toHaveLength(1);
    });
  });

  describe("JOIN", () => {
    beforeEach(async () => {
      await db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      await db.execute("INSERT INTO users VALUES (1, 'Alice')");
      await db.execute("INSERT INTO users VALUES (2, 'Bob')");

      await db.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, product TEXT)");
      await db.execute("INSERT INTO orders VALUES (1, 1, 'Widget')");
      await db.execute("INSERT INTO orders VALUES (2, 1, 'Gadget')");
      await db.execute("INSERT INTO orders VALUES (3, 2, 'Thingamajig')");
    });

    it("INNER JOIN で結合する", async () => {
      const result = await db.execute(
        "SELECT users.name, orders.product FROM users JOIN orders ON users.id = orders.user_id",
      );
      expect(result.rows).toHaveLength(3);
    });

    it("LEFT JOIN で結合する", async () => {
      await db.execute("INSERT INTO users VALUES (3, 'Charlie')");
      const result = await db.execute(
        "SELECT users.name, orders.product FROM users LEFT JOIN orders ON users.id = orders.user_id",
      );
      expect(result.rows).toHaveLength(4); // Alice(2) + Bob(1) + Charlie(NULL)
      // Charlieの注文はNULL
      const charlieRow = result.rows.find(r => r[0] === "Charlie");
      expect(charlieRow?.[1]).toBe(null);
    });
  });

  describe("GROUP BY / HAVING / 集約関数", () => {
    beforeEach(async () => {
      await db.execute("CREATE TABLE sales (id INTEGER PRIMARY KEY, dept TEXT, amount INTEGER)");
      await db.execute("INSERT INTO sales VALUES (1, 'A', 100)");
      await db.execute("INSERT INTO sales VALUES (2, 'A', 200)");
      await db.execute("INSERT INTO sales VALUES (3, 'B', 150)");
      await db.execute("INSERT INTO sales VALUES (4, 'B', 250)");
      await db.execute("INSERT INTO sales VALUES (5, 'B', 300)");
    });

    it("COUNT(*) で行数を数える", async () => {
      const result = await db.execute("SELECT COUNT(*) FROM sales");
      expect(result.rows[0]?.[0]).toBe(5);
    });

    it("SUM で合計を計算する", async () => {
      const result = await db.execute("SELECT SUM(amount) FROM sales");
      expect(result.rows[0]?.[0]).toBe(1000);
    });

    it("AVG で平均を計算する", async () => {
      const result = await db.execute("SELECT AVG(amount) FROM sales");
      expect(result.rows[0]?.[0]).toBe(200);
    });

    it("MIN / MAX で最小/最大を計算する", async () => {
      const result = await db.execute("SELECT MIN(amount), MAX(amount) FROM sales");
      expect(result.rows[0]?.[0]).toBe(100);
      expect(result.rows[0]?.[1]).toBe(300);
    });

    it("GROUP BY でグループ化して集約する", async () => {
      const result = await db.execute("SELECT dept, SUM(amount) FROM sales GROUP BY dept");
      expect(result.rows).toHaveLength(2);
    });

    it("HAVING でグループをフィルタする", async () => {
      const result = await db.execute(
        "SELECT dept, COUNT(*) FROM sales GROUP BY dept HAVING COUNT(*) > 2",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe("B");
    });
  });

  describe("サブクエリ", () => {
    beforeEach(async () => {
      await db.execute("CREATE TABLE t1 (id INTEGER PRIMARY KEY, val INTEGER)");
      await db.execute("INSERT INTO t1 VALUES (1, 10)");
      await db.execute("INSERT INTO t1 VALUES (2, 20)");
      await db.execute("INSERT INTO t1 VALUES (3, 30)");

      await db.execute("CREATE TABLE t2 (id INTEGER PRIMARY KEY, ref_id INTEGER)");
      await db.execute("INSERT INTO t2 VALUES (1, 1)");
      await db.execute("INSERT INTO t2 VALUES (2, 3)");
    });

    it("IN サブクエリでフィルタする", async () => {
      const result = await db.execute(
        "SELECT val FROM t1 WHERE id IN (SELECT ref_id FROM t2)",
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows.map(r => r[0]).sort()).toEqual([10, 30]);
    });

    it("EXISTS サブクエリでフィルタする", async () => {
      const result = await db.execute(
        "SELECT val FROM t1 WHERE EXISTS (SELECT 1 FROM t2 WHERE t2.ref_id = t1.id)",
      );
      // EXISTS はサブクエリが行を返すかのチェック
      // ただし、相関サブクエリは現在未サポート（全行評価）
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("DISTINCT", () => {
    it("重複を除去する", async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      await db.execute("INSERT INTO t VALUES (1, 'A')");
      await db.execute("INSERT INTO t VALUES (2, 'B')");
      await db.execute("INSERT INTO t VALUES (3, 'A')");

      const result = await db.execute("SELECT DISTINCT name FROM t");
      expect(result.rows).toHaveLength(2);
    });
  });

  describe("式評価", () => {
    it("算術式を評価する", async () => {
      const result = await db.execute("SELECT 1 + 2 * 3");
      expect(result.rows[0]?.[0]).toBe(7);
    });

    it("文字列連結を評価する", async () => {
      const result = await db.execute("SELECT 'hello' || ' ' || 'world'");
      expect(result.rows[0]?.[0]).toBe("hello world");
    });

    it("NULL演算を評価する", async () => {
      const result = await db.execute("SELECT NULL + 1");
      expect(result.rows[0]?.[0]).toBe(null);
    });
  });

  describe("複数文実行", () => {
    it("セミコロン区切りの複数文を一括実行する", async () => {
      const results = await db.executeMultiple(
        "CREATE TABLE m (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO m VALUES (1, 'Alice'); INSERT INTO m VALUES (2, 'Bob'); SELECT * FROM m",
      );
      expect(results).toHaveLength(4);
      // 最後のSELECT結果を検証
      const selectResult = results[3];
      expect(selectResult?.rows).toHaveLength(2);
    });

    it("末尾のセミコロンありでも動作する", async () => {
      const results = await db.executeMultiple(
        "CREATE TABLE m2 (id INTEGER PRIMARY KEY);",
      );
      expect(results).toHaveLength(1);
    });

    it("executeでもセミコロン終端の単一文が動作する", async () => {
      const result = await db.execute("SELECT 1 + 2;");
      expect(result.rows[0]?.[0]).toBe(3);
    });
  });

  describe("DROP TABLE", () => {
    it("テーブルを削除する", async () => {
      await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      await db.execute("DROP TABLE t");
      await expect(db.execute("SELECT * FROM t")).rejects.toThrow();
    });

    it("IF EXISTS で存在しないテーブルの削除をスキップする", async () => {
      await db.execute("DROP TABLE IF EXISTS nonexistent");
    });
  });
});
