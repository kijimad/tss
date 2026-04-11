/* SQLインジェクション シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, simulateAttack,
  createDefaultDb, parseSql, executeSql,
  escapeSqlInput, wafCheck, validateInput, whitelistCheck,
  noDefense, parameterizedOnly, escapingOnly, wafOnly, fullDefense,
} from "../sqli/engine.js";
import { PRESETS } from "../sqli/presets.js";
import type { SimOp } from "../sqli/types.js";

describe("SQLi Engine", () => {
  // ─── データベース ───

  describe("データベース", () => {
    it("デフォルトDBに3テーブルが存在する", () => {
      const db = createDefaultDb();
      expect(Object.keys(db.tables)).toHaveLength(3);
      expect(db.tables["users"]).toBeDefined();
      expect(db.tables["products"]).toBeDefined();
      expect(db.tables["secrets"]).toBeDefined();
    });

    it("usersテーブルに4行ある", () => {
      const db = createDefaultDb();
      expect(db.tables["users"].rows).toHaveLength(4);
    });
  });

  // ─── SQLパーサー ───

  describe("SQLパーサー", () => {
    it("SELECT文をパースできる", () => {
      const parsed = parseSql("SELECT * FROM users WHERE id = 1");
      expect(parsed.type).toBe("SELECT");
      expect(parsed.table).toBe("users");
      expect(parsed.where).toContain("id = 1");
    });

    it("UNION SELECTを検出する", () => {
      const parsed = parseSql("SELECT * FROM users UNION SELECT * FROM secrets");
      expect(parsed.type).toBe("UNION");
      expect(parsed.hasUnion).toBe(true);
    });

    it("DROP TABLE をパースできる", () => {
      const parsed = parseSql("DROP TABLE users");
      expect(parsed.type).toBe("DROP");
      expect(parsed.table).toBe("users");
    });

    it("スタックドクエリを分割できる", () => {
      const parsed = parseSql("SELECT * FROM users; DROP TABLE users");
      expect(parsed.stacked).toHaveLength(1);
      expect(parsed.stacked![0]).toContain("DROP TABLE");
    });

    it("DELETE文をパースできる", () => {
      const parsed = parseSql("DELETE FROM users WHERE id = 1");
      expect(parsed.type).toBe("DELETE");
      expect(parsed.table).toBe("users");
    });

    it("UPDATE文をパースできる", () => {
      const parsed = parseSql("UPDATE users SET role = 'admin' WHERE id = 1");
      expect(parsed.type).toBe("UPDATE");
      expect(parsed.table).toBe("users");
    });
  });

  // ─── SQL実行 ───

  describe("SQL実行", () => {
    it("正常なSELECTが実行される", () => {
      const db = createDefaultDb();
      const result = executeSql(db, "SELECT * FROM users WHERE username = 'admin'");
      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]["username"]).toBe("admin");
    });

    it("WHERE条件でフィルタリングされる", () => {
      const db = createDefaultDb();
      const result = executeSql(db, "SELECT * FROM users WHERE role = 'user'");
      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(2);
    });

    it("存在しないテーブルはエラーになる", () => {
      const db = createDefaultDb();
      const result = executeSql(db, "SELECT * FROM nonexistent");
      expect(result.success).toBe(false);
    });

    it("OR 1=1 で全行が返る", () => {
      const db = createDefaultDb();
      const result = executeSql(db, "SELECT * FROM users WHERE username = 'x' OR 1=1");
      expect(result.success).toBe(true);
      expect(result.rows.length).toBeGreaterThan(1);
    });

    it("UNION SELECTで別テーブルのデータが結合される", () => {
      const db = createDefaultDb();
      const result = executeSql(db, "SELECT id, name FROM products WHERE category = 'none' UNION SELECT id, key_name FROM secrets");
      expect(result.success).toBe(true);
      expect(result.rows.some(r => "key_name" in r || Object.values(r).includes("api_key"))).toBe(true);
    });
  });

  // ─── エスケープ ───

  describe("エスケープ", () => {
    it("シングルクォートがエスケープされる", () => {
      expect(escapeSqlInput("' OR '1'='1")).toContain("''");
    });

    it("バックスラッシュがエスケープされる", () => {
      expect(escapeSqlInput("test\\path")).toContain("\\\\");
    });
  });

  // ─── WAF ───

  describe("WAF", () => {
    it("UNION SELECTパターンを検出する", () => {
      expect(wafCheck("' UNION SELECT * FROM users").blocked).toBe(true);
    });

    it("OR 1=1パターンを検出する", () => {
      expect(wafCheck("' OR 1=1 --").blocked).toBe(true);
    });

    it("DROP TABLEを検出する", () => {
      expect(wafCheck("1; DROP TABLE users").blocked).toBe(true);
    });

    it("SLEEP関数を検出する", () => {
      expect(wafCheck("1; SELECT SLEEP(5)").blocked).toBe(true);
    });

    it("正常な入力はブロックしない", () => {
      expect(wafCheck("admin").blocked).toBe(false);
    });

    it("SQLコメントを検出する", () => {
      expect(wafCheck("admin' --").blocked).toBe(true);
    });
  });

  // ─── バリデーション ───

  describe("入力バリデーション", () => {
    it("整数型で文字列が拒否される", () => {
      expect(validateInput("1 OR 1=1", "integer").valid).toBe(false);
    });

    it("整数型で数値が許可される", () => {
      expect(validateInput("123", "integer").valid).toBe(true);
    });

    it("テキスト型で特殊文字が拒否される", () => {
      expect(validateInput("admin'--", "text").valid).toBe(false);
    });

    it("テキスト型で通常文字列が許可される", () => {
      expect(validateInput("admin", "text").valid).toBe(true);
    });
  });

  // ─── ホワイトリスト ───

  describe("ホワイトリスト", () => {
    it("パターン一致で許可される", () => {
      expect(whitelistCheck("admin", /^[\w]+$/).valid).toBe(true);
    });

    it("パターン不一致で拒否される", () => {
      expect(whitelistCheck("' OR 1=1", /^[\w]+$/).valid).toBe(false);
    });
  });

  // ─── 攻撃シミュレーション ───

  describe("攻撃シミュレーション", () => {
    it("クラシックSQLi（防御なし）で認証バイパスする", () => {
      const op: SimOp = {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'pass'",
        payload: "' OR '1'='1' --",
        defense: noDefense(), legitimateInput: "admin",
      };
      const result = simulateAttack(op);
      expect(result.injectionSucceeded).toBe(true);
      expect(result.authBypassed).toBe(true);
    });

    it("パラメータ化クエリでSQLiがブロックされる", () => {
      const op: SimOp = {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'pass'",
        payload: "' OR '1'='1' --",
        defense: parameterizedOnly(), legitimateInput: "admin",
      };
      const result = simulateAttack(op);
      expect(result.injectionSucceeded).toBe(false);
      expect(result.blocked.length).toBeGreaterThan(0);
    });

    it("WAFでUNION SELECTがブロックされる", () => {
      const op: SimOp = {
        type: "attack", injectionType: "union_based", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM products WHERE category = '${input}'",
        payload: "' UNION SELECT id, key_name, key_value FROM secrets --",
        defense: wafOnly(), legitimateInput: "electronics",
      };
      const result = simulateAttack(op);
      expect(result.blocked.length).toBeGreaterThan(0);
      expect(result.dataLeaked).toBe(false);
    });

    it("UNION型でデータが漏洩する（防御なし）", () => {
      const op: SimOp = {
        type: "attack", injectionType: "union_based", inputMethod: "url_param",
        queryTemplate: "SELECT id, name, price FROM products WHERE category = '${input}'",
        payload: "' UNION SELECT id, key_name, key_value FROM secrets --",
        defense: noDefense(), legitimateInput: "electronics",
      };
      const result = simulateAttack(op);
      expect(result.injectionSucceeded).toBe(true);
      expect(result.dataLeaked).toBe(true);
    });

    it("スタックドクエリでDROP TABLEが実行される（防御なし）", () => {
      const op: SimOp = {
        type: "attack", injectionType: "stacked", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1; DROP TABLE users",
        defense: noDefense(), legitimateInput: "1",
      };
      const result = simulateAttack(op);
      expect(result.dataModified).toBe(true);
    });

    it("最小権限でDROP TABLEがブロックされる", () => {
      const op: SimOp = {
        type: "attack", injectionType: "stacked", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1; DROP TABLE users",
        defense: { ...noDefense(), leastPrivilege: true }, legitimateInput: "1",
      };
      const result = simulateAttack(op);
      expect(result.blocked.length).toBeGreaterThan(0);
      expect(result.dataModified).toBe(false);
    });

    it("入力バリデーションで数値以外が拒否される", () => {
      const op: SimOp = {
        type: "attack", injectionType: "blind_boolean", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1 AND 1=1",
        defense: { ...noDefense(), inputValidation: true }, legitimateInput: "1",
      };
      const result = simulateAttack(op);
      expect(result.blocked.length).toBeGreaterThan(0);
    });

    it("フル防御で全攻撃がブロックされる", () => {
      const op: SimOp = {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'test'",
        payload: "' OR '1'='1' --",
        defense: fullDefense(), legitimateInput: "admin",
      };
      const result = simulateAttack(op);
      expect(result.injectionSucceeded).toBe(false);
      expect(result.dataLeaked).toBe(false);
    });

    it("防御勧告が生成される（防御なし）", () => {
      const op: SimOp = {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}'",
        payload: "' OR '1'='1' --",
        defense: noDefense(), legitimateInput: "admin",
      };
      const result = simulateAttack(op);
      expect(result.mitigations.length).toBeGreaterThan(0);
      expect(result.mitigations.some(m => m.includes("パラメータ化"))).toBe(true);
    });

    it("フル防御では「適切」メッセージが出る", () => {
      const op: SimOp = {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}'",
        payload: "' OR '1'='1' --",
        defense: fullDefense(), legitimateInput: "admin",
      };
      const result = simulateAttack(op);
      expect(result.mitigations.some(m => m.includes("適切"))).toBe(true);
    });

    it("エラーメッセージ隠蔽が機能する", () => {
      const op: SimOp = {
        type: "attack", injectionType: "error_based", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM ${input}",
        payload: "nonexistent_table",
        defense: { ...noDefense(), hideErrors: true }, legitimateInput: "products",
      };
      const result = simulateAttack(op);
      // 詳細なエラーが隠蔽される
      if (result.queryResult.error) {
        expect(result.queryResult.error).not.toContain("nonexistent_table");
      }
    });
  });

  // ─── simulate関数 ───

  describe("simulate", () => {
    it("複数攻撃が実行される", () => {
      const ops: SimOp[] = [
        { type: "attack", injectionType: "classic", inputMethod: "form_post", queryTemplate: "SELECT * FROM users WHERE username = '${input}'", payload: "' OR '1'='1'", defense: noDefense() },
        { type: "attack", injectionType: "classic", inputMethod: "form_post", queryTemplate: "SELECT * FROM users WHERE username = '${input}'", payload: "' OR '1'='1'", defense: parameterizedOnly() },
      ];
      const r = simulate(ops);
      expect(r.results).toHaveLength(2);
      expect(r.results[0].injectionSucceeded).toBe(true);
      expect(r.results[1].injectionSucceeded).toBe(false);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.results.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
