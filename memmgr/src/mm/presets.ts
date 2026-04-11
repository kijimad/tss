import type { SegmentEntry, PageTableEntry, MemoryAccess } from "./types.js";
import type { PagingConfig } from "./paging.js";

export interface Preset {
  name: string;
  description: string;
  scheme: "segment" | "paging";
  /** セグメント方式の場合 */
  segmentTable?: SegmentEntry[];
  /** ページ方式の場合 */
  pageTable?: PageTableEntry[];
  pagingConfig?: PagingConfig;
  accesses: MemoryAccess[];
}

/** セグメントのデフォルト権限 */
const seg = (
  id: number, name: string, type: SegmentEntry["type"],
  base: number, limit: number,
  opts: Partial<Pick<SegmentEntry, "readable" | "writable" | "executable" | "present">> = {}
): SegmentEntry => ({
  id, name, type, base, limit,
  readable: opts.readable ?? true,
  writable: opts.writable ?? (type !== "code"),
  executable: opts.executable ?? (type === "code"),
  present: opts.present ?? true,
});

export const presets: Preset[] = [
  // === セグメント方式 ===
  {
    name: "セグメント: 基本アドレス変換",
    description: "コード・データ・スタックの3セグメントでのアドレス変換の基本動作",
    scheme: "segment",
    segmentTable: [
      seg(0, "コード", "code", 0x1000, 0x0800),
      seg(1, "データ", "data", 0x2000, 0x1000),
      seg(2, "スタック", "stack", 0x4000, 0x0800),
    ],
    accesses: [
      { type: "execute", address: 0x0000, segment: 0, label: "コード先頭を実行" },
      { type: "execute", address: 0x0100, segment: 0, label: "コード0x100を実行" },
      { type: "read", address: 0x0000, segment: 1, label: "データ先頭を読み取り" },
      { type: "write", address: 0x0500, segment: 1, label: "データ0x500に書き込み" },
      { type: "read", address: 0x0200, segment: 2, label: "スタック0x200を読み取り" },
      { type: "write", address: 0x0300, segment: 2, label: "スタック0x300に書き込み" },
    ],
  },
  {
    name: "セグメント: 保護違反",
    description: "コードセグメントへの書き込みやリミット超過などの保護違反をシミュレーション",
    scheme: "segment",
    segmentTable: [
      seg(0, "コード", "code", 0x1000, 0x0400, { writable: false }),
      seg(1, "データ", "data", 0x2000, 0x0800, { executable: false }),
      seg(2, "読み専用データ", "data", 0x3000, 0x0400, { writable: false }),
    ],
    accesses: [
      { type: "execute", address: 0x0100, segment: 0, label: "コード実行（正常）" },
      { type: "write", address: 0x0100, segment: 0, label: "コードに書き込み（違反！）" },
      { type: "read", address: 0x0200, segment: 1, label: "データ読み取り（正常）" },
      { type: "execute", address: 0x0000, segment: 1, label: "データを実行（違反！）" },
      { type: "read", address: 0x0100, segment: 2, label: "読み専用データ読み取り（正常）" },
      { type: "write", address: 0x0100, segment: 2, label: "読み専用に書き込み（違反！）" },
      { type: "read", address: 0x0500, segment: 0, label: "リミット超過（違反！）" },
      { type: "read", address: 0x0000, segment: 5, label: "存在しないセグメント（違反！）" },
    ],
  },
  {
    name: "セグメント: メモリ断片化",
    description: "複数セグメントの配置による外部断片化の可視化",
    scheme: "segment",
    segmentTable: [
      seg(0, "コード", "code", 0x0000, 0x1000),
      seg(1, "ヒープA", "heap", 0x1000, 0x0800),
      // 0x1800〜0x2000 は空き（断片化）
      seg(2, "データ", "data", 0x2000, 0x0400),
      // 0x2400〜0x3000 は空き（断片化）
      seg(3, "ヒープB", "heap", 0x3000, 0x0C00),
      // 0x3C00〜0x4000 は空き（断片化）
      seg(4, "スタック", "stack", 0x4000, 0x0800),
    ],
    accesses: [
      { type: "execute", address: 0x0100, segment: 0, label: "コード実行" },
      { type: "write", address: 0x0400, segment: 1, label: "ヒープA書き込み" },
      { type: "read", address: 0x0200, segment: 2, label: "データ読み取り" },
      { type: "write", address: 0x0800, segment: 3, label: "ヒープB書き込み" },
      { type: "write", address: 0x0100, segment: 4, label: "スタック書き込み" },
    ],
  },
  {
    name: "セグメント: 不在セグメント",
    description: "メモリ上に存在しないセグメントへのアクセスによるセグメントフォールト",
    scheme: "segment",
    segmentTable: [
      seg(0, "コード", "code", 0x1000, 0x0800),
      seg(1, "データ", "data", 0x2000, 0x1000),
      seg(2, "スワップ済みデータ", "data", 0x0000, 0x0800, { present: false }),
      seg(3, "未ロードライブラリ", "code", 0x0000, 0x0400, { present: false }),
    ],
    accesses: [
      { type: "execute", address: 0x0100, segment: 0, label: "コード実行（正常）" },
      { type: "read", address: 0x0100, segment: 1, label: "データ読み取り（正常）" },
      { type: "read", address: 0x0100, segment: 2, label: "スワップ済みデータ（フォールト！）" },
      { type: "execute", address: 0x0000, segment: 3, label: "未ロードライブラリ実行（フォールト！）" },
    ],
  },

  // === ページ方式 ===
  {
    name: "ページ: 基本アドレス変換",
    description: "ページテーブルによる仮想→物理アドレス変換の基本動作",
    scheme: "paging",
    pageTable: [
      { pageNumber: 0, frameNumber: 3, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: true },
      { pageNumber: 1, frameNumber: 7, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 2, frameNumber: 1, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 3, frameNumber: 5, present: true, dirty: false, referenced: false, readable: true, writable: false, executable: false },
    ],
    accesses: [
      { type: "read", address: 0x0010, label: "ページ0のオフセット0x10を読み取り" },
      { type: "read", address: 0x0120, label: "ページ1のオフセット0x20を読み取り" },
      { type: "write", address: 0x0280, label: "ページ2のオフセット0x80に書き込み" },
      { type: "read", address: 0x03FF, label: "ページ3の末尾を読み取り" },
    ],
  },
  {
    name: "ページ: TLBヒット/ミス",
    description: "TLBのキャッシュ効果とLRU置換の動作を観察",
    scheme: "paging",
    pagingConfig: { pageSize: 256, tlbSize: 3, totalFrames: 256 },
    pageTable: [
      { pageNumber: 0, frameNumber: 2, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 1, frameNumber: 5, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 2, frameNumber: 8, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 3, frameNumber: 11, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 4, frameNumber: 14, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
    ],
    accesses: [
      { type: "read", address: 0x0010, label: "ページ0（TLBミス→登録）" },
      { type: "read", address: 0x0120, label: "ページ1（TLBミス→登録）" },
      { type: "read", address: 0x0030, label: "ページ0（TLBヒット！）" },
      { type: "read", address: 0x0220, label: "ページ2（TLBミス→登録、TLB満杯）" },
      { type: "read", address: 0x0310, label: "ページ3（TLBミス→LRU置換）" },
      { type: "read", address: 0x0050, label: "ページ0（TLBヒット！）" },
      { type: "read", address: 0x0140, label: "ページ1（TLBから追い出されてミス）" },
      { type: "read", address: 0x0410, label: "ページ4（TLBミス→LRU置換）" },
    ],
  },
  {
    name: "ページ: ページフォールト",
    description: "メモリ上に存在しないページへのアクセスによるページフォールト",
    scheme: "paging",
    pageTable: [
      { pageNumber: 0, frameNumber: 2, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: true },
      { pageNumber: 1, frameNumber: 5, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 2, frameNumber: 0, present: false, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 3, frameNumber: 8, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 4, frameNumber: 0, present: false, dirty: false, referenced: false, readable: true, writable: true, executable: false },
    ],
    accesses: [
      { type: "read", address: 0x0010, label: "ページ0（正常）" },
      { type: "read", address: 0x0110, label: "ページ1（正常）" },
      { type: "read", address: 0x0210, label: "ページ2（フォールト！）" },
      { type: "read", address: 0x0310, label: "ページ3（正常）" },
      { type: "write", address: 0x0410, label: "ページ4（フォールト！）" },
      { type: "read", address: 0x0050, label: "ページ0（TLBヒット）" },
    ],
  },
  {
    name: "ページ: 保護違反",
    description: "読み取り専用ページへの書き込みや実行不可ページの実行などの保護違反",
    scheme: "paging",
    pageTable: [
      { pageNumber: 0, frameNumber: 1, present: true, dirty: false, referenced: false, readable: true, writable: false, executable: true },
      { pageNumber: 1, frameNumber: 4, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
      { pageNumber: 2, frameNumber: 7, present: true, dirty: false, referenced: false, readable: false, writable: false, executable: false },
    ],
    accesses: [
      { type: "execute", address: 0x0010, label: "コードページ実行（正常）" },
      { type: "read", address: 0x0020, label: "コードページ読み取り（正常）" },
      { type: "write", address: 0x0030, label: "コードページ書き込み（違反！）" },
      { type: "read", address: 0x0110, label: "データページ読み取り（正常）" },
      { type: "write", address: 0x0120, label: "データページ書き込み（正常）" },
      { type: "execute", address: 0x0130, label: "データページ実行（違反！）" },
      { type: "read", address: 0x0210, label: "アクセス禁止ページ読み取り（違反！）" },
    ],
  },
  {
    name: "ページ: 局所性とTLB効率",
    description: "時間的・空間的局所性があるアクセスパターンでのTLBヒット率の違い",
    scheme: "paging",
    pagingConfig: { pageSize: 256, tlbSize: 4, totalFrames: 256 },
    pageTable: Array.from({ length: 8 }, (_, i) => ({
      pageNumber: i, frameNumber: i * 2, present: true, dirty: false,
      referenced: false, readable: true, writable: true, executable: false,
    })),
    accesses: [
      // 時間的局所性: 同じページに繰り返しアクセス
      { type: "read", address: 0x0010, label: "ページ0（ミス）" },
      { type: "read", address: 0x0020, label: "ページ0（ヒット）" },
      { type: "read", address: 0x0030, label: "ページ0（ヒット）" },
      // 空間的局所性: 隣接ページに順次アクセス
      { type: "read", address: 0x0110, label: "ページ1（ミス）" },
      { type: "read", address: 0x0150, label: "ページ1（ヒット）" },
      { type: "read", address: 0x0210, label: "ページ2（ミス）" },
      { type: "read", address: 0x0250, label: "ページ2（ヒット）" },
      // スラッシング: TLBサイズを超えるページにアクセス
      { type: "read", address: 0x0310, label: "ページ3（ミス）" },
      { type: "read", address: 0x0410, label: "ページ4（ミス→ページ0追い出し）" },
      { type: "read", address: 0x0040, label: "ページ0（追い出し後ミス）" },
      { type: "read", address: 0x0510, label: "ページ5（ミス→ページ1追い出し）" },
    ],
  },
  {
    name: "比較: セグメントvsページの違い",
    description: "同じメモリ空間をセグメント方式とページ方式で管理した場合の比較用（セグメント）",
    scheme: "segment",
    segmentTable: [
      seg(0, "プロセスA-コード", "code", 0x0000, 0x0400),
      seg(1, "プロセスA-データ", "data", 0x0400, 0x0400),
      seg(2, "プロセスA-スタック", "stack", 0x0800, 0x0200),
      seg(3, "プロセスB-コード", "code", 0x0A00, 0x0300),
      seg(4, "プロセスB-データ", "data", 0x0D00, 0x0500),
    ],
    accesses: [
      { type: "execute", address: 0x0100, segment: 0, label: "A: コード実行" },
      { type: "write", address: 0x0200, segment: 1, label: "A: データ書き込み" },
      { type: "read", address: 0x0100, segment: 2, label: "A: スタック読み取り" },
      { type: "execute", address: 0x0100, segment: 3, label: "B: コード実行" },
      { type: "write", address: 0x0300, segment: 4, label: "B: データ書き込み" },
    ],
  },
];
