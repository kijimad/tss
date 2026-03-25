import { describe, it, expect } from "vitest";
import {
  encodeSqlValue, decodeSqlValue,
  encodeLeafCell, decodeLeafCell,
  initPage, insertCellIntoPage, removeCellFromPage,
  readCellCount,
} from "../storage/page.js";
import { PageType } from "../types.js";

describe("値シリアライズ/デシリアライズ", () => {
  it("NULLをエンコード/デコードする", () => {
    const encoded = encodeSqlValue(null);
    const { value, bytesRead } = decodeSqlValue(encoded, 0);
    expect(value).toBe(null);
    expect(bytesRead).toBe(1);
  });

  it("整数をエンコード/デコードする", () => {
    const encoded = encodeSqlValue(42);
    const { value } = decodeSqlValue(encoded, 0);
    expect(value).toBe(42);
  });

  it("浮動小数点をエンコード/デコードする", () => {
    const encoded = encodeSqlValue(3.14);
    const { value } = decodeSqlValue(encoded, 0);
    expect(value).toBeCloseTo(3.14);
  });

  it("文字列をエンコード/デコードする", () => {
    const encoded = encodeSqlValue("hello world");
    const { value } = decodeSqlValue(encoded, 0);
    expect(value).toBe("hello world");
  });

  it("日本語文字列をエンコード/デコードする", () => {
    const encoded = encodeSqlValue("こんにちは");
    const { value } = decodeSqlValue(encoded, 0);
    expect(value).toBe("こんにちは");
  });

  it("BLOBをエンコード/デコードする", () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = encodeSqlValue(blob);
    const { value } = decodeSqlValue(encoded, 0);
    expect(value).toEqual(blob);
  });
});

describe("セルデータ操作", () => {
  it("リーフセルをエンコード/デコードする", () => {
    const key = [1, "test"];
    const value = ["hello", 42, null];
    const encoded = encodeLeafCell(key, value);
    const decoded = decodeLeafCell(encoded, 0);
    expect(decoded.key).toEqual(key);
    expect(decoded.value).toEqual(value);
  });
});

describe("ページ操作", () => {
  it("ページを初期化する", () => {
    const buf = initPage(PageType.Leaf);
    expect(buf.byteLength).toBe(4096);
    expect(readCellCount(buf)).toBe(0);
  });

  it("セルを挿入する", () => {
    const buf = initPage(PageType.Leaf);
    const cellData = encodeLeafCell([1], ["hello"]);
    const result = insertCellIntoPage(buf, cellData, 0);
    expect(result).toBe(true);
    expect(readCellCount(buf)).toBe(1);
  });

  it("複数セルを挿入する", () => {
    const buf = initPage(PageType.Leaf);
    for (let i = 0; i < 10; i++) {
      const cellData = encodeLeafCell([i], [`value_${String(i)}`]);
      insertCellIntoPage(buf, cellData, i);
    }
    expect(readCellCount(buf)).toBe(10);
  });

  it("セルを削除する", () => {
    const buf = initPage(PageType.Leaf);
    for (let i = 0; i < 3; i++) {
      const cellData = encodeLeafCell([i], [`val_${String(i)}`]);
      insertCellIntoPage(buf, cellData, i);
    }
    expect(readCellCount(buf)).toBe(3);
    removeCellFromPage(buf, 1);
    expect(readCellCount(buf)).toBe(2);
  });
});
