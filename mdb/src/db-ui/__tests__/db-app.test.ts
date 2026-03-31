import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../db-app.js";

describe("EXAMPLES", () => {
  it("サンプルが5件定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各サンプルにラベルとSQL文が含まれる", () => {
    for (const example of EXAMPLES) {
      expect(example.label).toBeTruthy();
      expect(example.sql).toBeTruthy();
      // SQL文にはセミコロンで終わる文が含まれる
      expect(example.sql).toMatch(/;\s*$/);
    }
  });

  it("ラベルが重複していない", () => {
    const labels = EXAMPLES.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("期待するカテゴリのサンプルが揃っている", () => {
    const labels = EXAMPLES.map((e) => e.label);
    // 各カテゴリが存在するか確認
    expect(labels).toContain("テーブル作成 + INSERT");
    expect(labels).toContain("SELECT + WHERE");
    expect(labels).toContain("集約関数");
    expect(labels).toContain("JOIN");
    expect(labels).toContain("サブクエリ");
  });

  it("CREATE TABLEサンプルにINSERT文も含まれる", () => {
    const createExample = EXAMPLES.find(
      (e) => e.label === "テーブル作成 + INSERT",
    );
    expect(createExample).toBeDefined();
    expect(createExample!.sql).toContain("CREATE TABLE");
    expect(createExample!.sql).toContain("INSERT INTO");
  });

  it("JOINサンプルにJOIN句が含まれる", () => {
    const joinExample = EXAMPLES.find((e) => e.label === "JOIN");
    expect(joinExample).toBeDefined();
    expect(joinExample!.sql).toContain("JOIN");
    expect(joinExample!.sql).toContain("ON");
  });

  it("サブクエリサンプルにネストされたSELECTが含まれる", () => {
    const subqueryExample = EXAMPLES.find((e) => e.label === "サブクエリ");
    expect(subqueryExample).toBeDefined();
    // メインSELECTと括弧内のサブSELECTの両方が存在する
    const selectCount = (subqueryExample!.sql.match(/SELECT/gi) ?? []).length;
    expect(selectCount).toBeGreaterThanOrEqual(2);
  });
});
