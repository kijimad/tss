import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { RecordType } from "../protocol/types.js";

describe("EXAMPLES プリセット配列", () => {
  it("5件のプリセット例が定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各プリセットが name, domain, recordType を持つ", () => {
    for (const ex of EXAMPLES) {
      expect(ex).toHaveProperty("name");
      expect(ex).toHaveProperty("domain");
      expect(ex).toHaveProperty("recordType");
      expect(typeof ex.name).toBe("string");
      expect(typeof ex.domain).toBe("string");
      expect(typeof ex.recordType).toBe("number");
    }
  });

  it("基本: A レコードのプリセットが正しい", () => {
    const a = EXAMPLES.find((ex) => ex.name === "基本: A レコード");
    expect(a).toBeDefined();
    expect(a!.domain).toBe("www.example.com");
    expect(a!.recordType).toBe(RecordType.A);
  });

  it("メールサーバ (MX) のプリセットが正しい", () => {
    const mx = EXAMPLES.find((ex) => ex.name === "メールサーバ (MX)");
    expect(mx).toBeDefined();
    expect(mx!.domain).toBe("example.com");
    expect(mx!.recordType).toBe(RecordType.MX);
  });

  it("ネームサーバ (NS) のプリセットが正しい", () => {
    const ns = EXAMPLES.find((ex) => ex.name === "ネームサーバ (NS)");
    expect(ns).toBeDefined();
    expect(ns!.domain).toBe("example.com");
    expect(ns!.recordType).toBe(RecordType.NS);
  });

  it("CNAME エイリアスのプリセットが正しい", () => {
    const cname = EXAMPLES.find((ex) => ex.name === "CNAME エイリアス");
    expect(cname).toBeDefined();
    expect(cname!.domain).toBe("blog.example.com");
    expect(cname!.recordType).toBe(RecordType.CNAME);
  });

  it("TXT レコードのプリセットが正しい", () => {
    const txt = EXAMPLES.find((ex) => ex.name === "TXT レコード");
    expect(txt).toBeDefined();
    expect(txt!.domain).toBe("example.com");
    expect(txt!.recordType).toBe(RecordType.TXT);
  });

  it("name が重複していない", () => {
    const names = EXAMPLES.map((ex) => ex.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
