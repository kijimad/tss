import { describe, it, expect } from "vitest";
import { BTree } from "../btree/btree.js";
import { Pager } from "../storage/pager.js";
import { MemoryPageStore } from "../storage/idb-backend.js";
import { PageType } from "../types.js";

async function createTestTree(): Promise<BTree> {
  const store = new MemoryPageStore();
  const pager = new Pager(store);
  await pager.init();
  const { pageId } = await pager.allocatePage(PageType.Leaf);
  return new BTree(pager, pageId);
}

describe("B+Tree", () => {
  it("単一の値を挿入して検索する", async () => {
    const tree = await createTestTree();
    await tree.insert([1], ["hello"]);
    const result = await tree.search([1]);
    expect(result).toEqual(["hello"]);
  });

  it("存在しないキーを検索するとundefinedを返す", async () => {
    const tree = await createTestTree();
    await tree.insert([1], ["hello"]);
    const result = await tree.search([999]);
    expect(result).toBeUndefined();
  });

  it("複数の値を挿入して検索する", async () => {
    const tree = await createTestTree();
    for (let i = 0; i < 20; i++) {
      await tree.insert([i], [`value_${String(i)}`]);
    }

    for (let i = 0; i < 20; i++) {
      const result = await tree.search([i]);
      expect(result).toEqual([`value_${String(i)}`]);
    }
  });

  it("大量データでページ分割が発生しても正しく検索できる", async () => {
    const tree = await createTestTree();
    const count = 200;

    for (let i = 0; i < count; i++) {
      await tree.insert([i], [`val_${String(i)}`, i * 10]);
    }

    for (let i = 0; i < count; i++) {
      const result = await tree.search([i]);
      expect(result).toEqual([`val_${String(i)}`, i * 10]);
    }
  });

  it("キーの更新ができる", async () => {
    const tree = await createTestTree();
    await tree.insert([1], ["original"]);
    await tree.insert([1], ["updated"]);
    const result = await tree.search([1]);
    expect(result).toEqual(["updated"]);
  });

  it("値を削除する", async () => {
    const tree = await createTestTree();
    await tree.insert([1], ["hello"]);
    await tree.insert([2], ["world"]);
    const deleted = await tree.delete([1]);
    expect(deleted).toBe(true);
    expect(await tree.search([1])).toBeUndefined();
    expect(await tree.search([2])).toEqual(["world"]);
  });

  it("存在しないキーの削除はfalseを返す", async () => {
    const tree = await createTestTree();
    const deleted = await tree.delete([999]);
    expect(deleted).toBe(false);
  });

  it("フルスキャンで全データを取得する", async () => {
    const tree = await createTestTree();
    for (let i = 0; i < 10; i++) {
      await tree.insert([i], [`val_${String(i)}`]);
    }

    const results = [];
    for await (const cell of tree.fullScan()) {
      results.push(cell);
    }

    expect(results).toHaveLength(10);
    // ソート順で返される
    for (let i = 0; i < 10; i++) {
      expect(results[i]?.key).toEqual([i]);
    }
  });

  it("範囲スキャンでデータを取得する", async () => {
    const tree = await createTestTree();
    for (let i = 0; i < 20; i++) {
      await tree.insert([i], [`val_${String(i)}`]);
    }

    const results = [];
    for await (const cell of tree.rangeScan([5], [15])) {
      results.push(cell);
    }

    expect(results).toHaveLength(11); // 5〜15
    expect(results[0]?.key).toEqual([5]);
    expect(results[10]?.key).toEqual([15]);
  });

  it("文字列キーで動作する", async () => {
    const tree = await createTestTree();
    await tree.insert(["apple"], [1]);
    await tree.insert(["banana"], [2]);
    await tree.insert(["cherry"], [3]);

    expect(await tree.search(["banana"])).toEqual([2]);
    expect(await tree.search(["date"])).toBeUndefined();
  });

  it("逆順挿入でも正しく動作する", async () => {
    const tree = await createTestTree();
    for (let i = 50; i >= 0; i--) {
      await tree.insert([i], [i * 2]);
    }

    for (let i = 0; i <= 50; i++) {
      const result = await tree.search([i]);
      expect(result).toEqual([i * 2]);
    }
  });
});
