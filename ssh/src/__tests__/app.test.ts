import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";

describe("EXAMPLES 配列", () => {
  it("3 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(3);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex).toHaveProperty("label");
      expect(ex).toHaveProperty("host");
      expect(ex).toHaveProperty("password");
      expect(ex).toHaveProperty("authType");
      expect(["password", "publickey"]).toContain(ex.authType);
      // ホストは user@host 形式であること
      expect(ex.host).toMatch(/.+@.+/);
    }
  });

  it("パスワード認証サンプルの値が正しい", () => {
    const pw = EXAMPLES[0]!;
    expect(pw.label).toBe("パスワード認証");
    expect(pw.host).toBe("user@server.example.com");
    expect(pw.password).toBe("secret123");
    expect(pw.authType).toBe("password");
  });

  it("公開鍵認証サンプルの値が正しい", () => {
    const pk = EXAMPLES[1]!;
    expect(pk.label).toBe("公開鍵認証");
    expect(pk.host).toBe("admin@prod.example.com");
    expect(pk.password).toBe("");
    expect(pk.authType).toBe("publickey");
  });

  it("別ユーザーサンプルの値が正しい", () => {
    const other = EXAMPLES[2]!;
    expect(other.label).toBe("別ユーザー");
    expect(other.host).toBe("root@192.168.1.1");
    expect(other.password).toBe("toor");
    expect(other.authType).toBe("password");
  });

  it("ラベルが重複していない", () => {
    const labels = EXAMPLES.map((ex) => ex.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ホストが重複していない", () => {
    const hosts = EXAMPLES.map((ex) => ex.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
