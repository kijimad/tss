import { PageType, type SqlValue, type CellData } from "../types.js";
import type { Pager } from "../storage/pager.js";
import {
  readPageType, readCellCount, readRightChild,
  getCellOffset,
  decodeLeafCell, decodeInteriorCell,
  encodeLeafCell, encodeInteriorCell,
  insertCellIntoPage, removeCellFromPage,
  initPage,
} from "../storage/page.js";
import { compareKeys } from "./node.js";

// B+Tree 実装
export class BTree {
  constructor(
    private pager: Pager,
    private rootPageId: number,
  ) {}

  getRootPageId(): number {
    return this.rootPageId;
  }

  // === 検索 ===
  async search(key: SqlValue[]): Promise<SqlValue[] | undefined> {
    return this.searchInNode(this.rootPageId, key);
  }

  private async searchInNode(pageId: number, key: SqlValue[]): Promise<SqlValue[] | undefined> {
    const buf = await this.pager.getPage(pageId);
    const pageType = readPageType(buf);

    if (pageType === PageType.Leaf) {
      return this.searchInLeaf(buf, key);
    }

    // Interior ノード: 適切な子ノードを見つける
    const childPageId = this.findChildPage(buf, key);
    return this.searchInNode(childPageId, key);
  }

  private searchInLeaf(buf: ArrayBuffer, key: SqlValue[]): SqlValue[] | undefined {
    const cellCount = readCellCount(buf);
    const data = new Uint8Array(buf);

    for (let i = 0; i < cellCount; i++) {
      const offset = getCellOffset(buf, i);
      const cell = decodeLeafCell(data, offset);
      const cmp = compareKeys(cell.key, key);
      if (cmp === 0) return cell.value;
      if (cmp > 0) return undefined; // ソート済みなので、超えたら見つからない
    }
    return undefined;
  }

  private findChildPage(buf: ArrayBuffer, key: SqlValue[]): number {
    const cellCount = readCellCount(buf);
    const data = new Uint8Array(buf);

    for (let i = 0; i < cellCount; i++) {
      const offset = getCellOffset(buf, i);
      const cell = decodeInteriorCell(data, offset);
      if (compareKeys(key, cell.key) < 0) {
        return cell.childPageId;
      }
    }
    // 全てのキーより大きい場合は rightChild
    return readRightChild(buf);
  }

  // === 挿入 ===
  async insert(key: SqlValue[], value: SqlValue[]): Promise<void> {
    const result = await this.insertInNode(this.rootPageId, key, value);
    if (result !== undefined) {
      // ルートが分割された → 新しいルートを作る
      const { pageId: newRootPageId, buffer: newRoot } = await this.pager.allocatePage(PageType.Interior);
      const cellData = encodeInteriorCell(result.splitKey, this.rootPageId);
      insertCellIntoPage(newRoot, cellData, 0);
      // rightChildを新しい右ページに設定
      new DataView(newRoot).setUint32(4, result.newPageId);
      this.pager.markDirty(newRootPageId);
      this.rootPageId = newRootPageId;
    }
  }

  private async insertInNode(
    pageId: number,
    key: SqlValue[],
    value: SqlValue[],
  ): Promise<{ splitKey: SqlValue[]; newPageId: number } | undefined> {
    const buf = await this.pager.getPage(pageId);
    const pageType = readPageType(buf);

    if (pageType === PageType.Leaf) {
      return this.insertInLeaf(pageId, buf, key, value);
    }

    // Interior: 子に挿入
    const childPageId = this.findChildPage(buf, key);
    const result = await this.insertInNode(childPageId, key, value);
    if (result === undefined) return undefined;

    // 子が分割された → このノードに新しいキーを挿入
    return this.insertInInterior(pageId, buf, result.splitKey, result.newPageId);
  }

  private async insertInLeaf(
    pageId: number,
    buf: ArrayBuffer,
    key: SqlValue[],
    value: SqlValue[],
  ): Promise<{ splitKey: SqlValue[]; newPageId: number } | undefined> {
    const cellCount = readCellCount(buf);
    const data = new Uint8Array(buf);

    // 挿入位置を見つける
    let insertAt = cellCount;
    for (let i = 0; i < cellCount; i++) {
      const offset = getCellOffset(buf, i);
      const cell = decodeLeafCell(data, offset);
      const cmp = compareKeys(cell.key, key);
      if (cmp === 0) {
        // 既存キーの更新: 削除して再挿入
        removeCellFromPage(buf, i);
        this.pager.markDirty(pageId);
        return this.insertInLeaf(pageId, buf, key, value);
      }
      if (cmp > 0) {
        insertAt = i;
        break;
      }
    }

    const cellData = encodeLeafCell(key, value);
    if (insertCellIntoPage(buf, cellData, insertAt)) {
      this.pager.markDirty(pageId);
      return undefined;
    }

    // ページが満杯 → 分割
    return this.splitLeaf(pageId, buf, key, value);
  }

  private async splitLeaf(
    pageId: number,
    buf: ArrayBuffer,
    newKey: SqlValue[],
    newValue: SqlValue[],
  ): Promise<{ splitKey: SqlValue[]; newPageId: number }> {
    // 全セルを収集
    const cellCount = readCellCount(buf);
    const data = new Uint8Array(buf);
    const cells: CellData[] = [];

    for (let i = 0; i < cellCount; i++) {
      const offset = getCellOffset(buf, i);
      const cell = decodeLeafCell(data, offset);
      cells.push(cell);
    }
    cells.push({ key: newKey, value: newValue });
    cells.sort((a, b) => compareKeys(a.key, b.key));

    const mid = Math.floor(cells.length / 2);
    const oldNextLeaf = readRightChild(buf);

    // 新しい右リーフを作成
    const { pageId: newPageId, buffer: newBuf } = await this.pager.allocatePage(PageType.Leaf);

    // 左リーフを再構築
    const leftBuf = initPage(PageType.Leaf);
    for (let i = 0; i < mid; i++) {
      const c = cells[i];
      if (c === undefined) continue;
      const encoded = encodeLeafCell(c.key, c.value);
      insertCellIntoPage(leftBuf, encoded, i);
    }
    // 左の nextLeaf = 新しい右ページ
    new DataView(leftBuf).setUint32(4, newPageId);

    // 右リーフ
    for (let i = mid; i < cells.length; i++) {
      const c = cells[i];
      if (c === undefined) continue;
      const encoded = encodeLeafCell(c.key, c.value);
      insertCellIntoPage(newBuf, encoded, i - mid);
    }
    // 右の nextLeaf = 元の nextLeaf
    new DataView(newBuf).setUint32(4, oldNextLeaf);

    // ページを更新
    new Uint8Array(buf).set(new Uint8Array(leftBuf));
    this.pager.markDirty(pageId);
    this.pager.markDirty(newPageId);

    const midCell = cells[mid];
    if (midCell === undefined) throw new Error("分割エラー: 中間セルが見つかりません");
    return { splitKey: midCell.key, newPageId };
  }

  private async insertInInterior(
    pageId: number,
    buf: ArrayBuffer,
    splitKey: SqlValue[],
    newChildPageId: number,
  ): Promise<{ splitKey: SqlValue[]; newPageId: number } | undefined> {
    const cellCount = readCellCount(buf);
    const data = new Uint8Array(buf);

    // 挿入位置を見つける
    let insertAt = cellCount;
    for (let i = 0; i < cellCount; i++) {
      const offset = getCellOffset(buf, i);
      const cell = decodeInteriorCell(data, offset);
      if (compareKeys(splitKey, cell.key) < 0) {
        insertAt = i;
        break;
      }
    }

    // 新しいセルでは、childPageIdは既存の子ポインタ（挿入位置の左側）
    // そして rightChild を新しいchildに更新する必要がある
    // Interior ノードのセル: key + leftChildPageId
    // 挿入するセルの childPageId は挿入位置より前の子ページ
    // rightChild of the inserted cell's position = newChildPageId
    // 実際の構造: cell[i].childPageId は key[i] 未満のページを指す

    // 挿入位置の前にある子ポインタを取得
    let leftChildOfInsertPos: number;
    if (insertAt < cellCount) {
      const offset = getCellOffset(buf, insertAt);
      const cell = decodeInteriorCell(data, offset);
      leftChildOfInsertPos = cell.childPageId;
    } else {
      leftChildOfInsertPos = readRightChild(buf);
    }

    // 元の挿入位置の子ポインタを splitKey の左側子として使う
    // 新しいセルの childPageId = leftChildOfInsertPos (splitKey未満の元のページ)
    // そして元の insertAt の childPageId を newChildPageId に更新

    // 実装: セルの childPageId は「そのキーより小さい値が入っている子ページ」
    // splitKey を挿入 → childPageId = leftChildOfInsertPos
    // 元の insertAt 以降のセルの childPageId はそのまま

    // insertAt位置のセルのchildPointerをnewChildPageIdに差し替える必要がある
    if (insertAt < cellCount) {
      // 挿入位置のセルのchildPageIdを変更
      const offset = getCellOffset(buf, insertAt);
      const cell = decodeInteriorCell(data, offset);
      // 元のセルを削除して、childPageId変更版を再挿入
      removeCellFromPage(buf, insertAt);
      const reencoded = encodeInteriorCell(cell.key, newChildPageId);
      insertCellIntoPage(buf, reencoded, insertAt);
    } else {
      // 末尾に挿入 → rightChild を更新
      new DataView(buf).setUint32(4, newChildPageId);
    }

    const cellDataBuf = encodeInteriorCell(splitKey, leftChildOfInsertPos);
    if (insertCellIntoPage(buf, cellDataBuf, insertAt)) {
      this.pager.markDirty(pageId);
      return undefined;
    }

    // Interior ノードも分割
    return this.splitInterior(pageId, buf, splitKey, leftChildOfInsertPos, newChildPageId);
  }

  private async splitInterior(
    pageId: number,
    buf: ArrayBuffer,
    newKey: SqlValue[],
    _newLeftChild: number,
    _newRightChild: number,
  ): Promise<{ splitKey: SqlValue[]; newPageId: number }> {
    // 全セルを収集
    const cellCount = readCellCount(buf);
    const data = new Uint8Array(buf);
    const cells: { key: SqlValue[]; childPageId: number }[] = [];

    for (let i = 0; i < cellCount; i++) {
      const offset = getCellOffset(buf, i);
      cells.push(decodeInteriorCell(data, offset));
    }
    // 新しいキーも追加（既に挿入失敗した場合のフォールバック）
    cells.push({ key: newKey, childPageId: _newLeftChild });
    cells.sort((a, b) => compareKeys(a.key, b.key));

    const mid = Math.floor(cells.length / 2);
    const midCell = cells[mid];
    if (midCell === undefined) throw new Error("分割エラー");

    // 左ノード再構築
    const leftBuf = initPage(PageType.Interior);
    for (let i = 0; i < mid; i++) {
      const c = cells[i];
      if (c === undefined) continue;
      const encoded = encodeInteriorCell(c.key, c.childPageId);
      insertCellIntoPage(leftBuf, encoded, i);
    }
    // 左のrightChild = midのchildPageId
    new DataView(leftBuf).setUint32(4, midCell.childPageId);

    // 右ノード作成
    const { pageId: newPageId, buffer: rightBuf } = await this.pager.allocatePage(PageType.Interior);
    for (let i = mid + 1; i < cells.length; i++) {
      const c = cells[i];
      if (c === undefined) continue;
      const encoded = encodeInteriorCell(c.key, c.childPageId);
      insertCellIntoPage(rightBuf, encoded, i - mid - 1);
    }
    // 右のrightChild = 元のrightChild
    new DataView(rightBuf).setUint32(4, readRightChild(buf));

    // 左ノードをオリジナルバッファに上書き
    new Uint8Array(buf).set(new Uint8Array(leftBuf));
    this.pager.markDirty(pageId);
    this.pager.markDirty(newPageId);

    return { splitKey: midCell.key, newPageId };
  }

  // === 削除（簡易: リーフからのみ削除、リバランスなし） ===
  async delete(key: SqlValue[]): Promise<boolean> {
    return this.deleteFromNode(this.rootPageId, key);
  }

  private async deleteFromNode(pageId: number, key: SqlValue[]): Promise<boolean> {
    const buf = await this.pager.getPage(pageId);
    const pageType = readPageType(buf);

    if (pageType === PageType.Leaf) {
      const cellCount = readCellCount(buf);
      const data = new Uint8Array(buf);
      for (let i = 0; i < cellCount; i++) {
        const offset = getCellOffset(buf, i);
        const cell = decodeLeafCell(data, offset);
        if (compareKeys(cell.key, key) === 0) {
          removeCellFromPage(buf, i);
          this.pager.markDirty(pageId);
          return true;
        }
      }
      return false;
    }

    const childPageId = this.findChildPage(buf, key);
    return this.deleteFromNode(childPageId, key);
  }

  // === フルスキャン（AsyncGenerator） ===
  async *fullScan(): AsyncGenerator<CellData> {
    // 最左リーフを見つける
    let pageId = this.rootPageId;
    while (true) {
      const buf = await this.pager.getPage(pageId);
      const pageType = readPageType(buf);
      if (pageType === PageType.Leaf) break;
      // 最左の子に下降
      const cellCount = readCellCount(buf);
      if (cellCount > 0) {
        const data = new Uint8Array(buf);
        const offset = getCellOffset(buf, 0);
        const cell = decodeInteriorCell(data, offset);
        pageId = cell.childPageId;
      } else {
        pageId = readRightChild(buf);
      }
    }

    // リーフチェーンを走査
    while (pageId !== 0) {
      const buf = await this.pager.getPage(pageId);
      const cellCount = readCellCount(buf);
      const data = new Uint8Array(buf);

      for (let i = 0; i < cellCount; i++) {
        const offset = getCellOffset(buf, i);
        const cell = decodeLeafCell(data, offset);
        yield cell;
      }

      pageId = readRightChild(buf);
    }
  }

  // === 範囲スキャン ===
  async *rangeScan(
    startKey?: SqlValue[],
    endKey?: SqlValue[],
  ): AsyncGenerator<CellData> {
    // startKeyがある場合、該当リーフまで下降
    let pageId = this.rootPageId;
    if (startKey !== undefined) {
      while (true) {
        const buf = await this.pager.getPage(pageId);
        const pageType = readPageType(buf);
        if (pageType === PageType.Leaf) break;
        pageId = this.findChildPage(buf, startKey);
      }
    } else {
      // 最左リーフを見つける
      while (true) {
        const buf = await this.pager.getPage(pageId);
        const pageType = readPageType(buf);
        if (pageType === PageType.Leaf) break;
        const cellCount = readCellCount(buf);
        if (cellCount > 0) {
          const data = new Uint8Array(buf);
          const offset = getCellOffset(buf, 0);
          const cell = decodeInteriorCell(data, offset);
          pageId = cell.childPageId;
        } else {
          pageId = readRightChild(buf);
        }
      }
    }

    // リーフチェーンを走査
    while (pageId !== 0) {
      const buf = await this.pager.getPage(pageId);
      const cellCount = readCellCount(buf);
      const data = new Uint8Array(buf);

      for (let i = 0; i < cellCount; i++) {
        const offset = getCellOffset(buf, i);
        const cell = decodeLeafCell(data, offset);

        if (startKey !== undefined && compareKeys(cell.key, startKey) < 0) continue;
        if (endKey !== undefined && compareKeys(cell.key, endKey) > 0) return;

        yield cell;
      }

      pageId = readRightChild(buf);
    }
  }
}
