import type {
  PageTableEntry,
  TlbEntry,
  VirtualAddress,
  PhysicalAddress,
  TranslationResult,
  TranslationStep,
  MemoryAccess,
  MemoryBlock,
  SimulationResult,
  SimulationStats,
} from "./types.js";

/** ページサイズ（デフォルト256バイト = 8ビットオフセット） */
const DEFAULT_PAGE_SIZE = 256;
/** TLBの最大エントリ数 */
const DEFAULT_TLB_SIZE = 4;
/** 物理メモリの総フレーム数 */
const DEFAULT_TOTAL_FRAMES = 256; // 64KB / 256 = 256フレーム

export interface PagingConfig {
  pageSize: number;
  tlbSize: number;
  totalFrames: number;
}

const defaultConfig: PagingConfig = {
  pageSize: DEFAULT_PAGE_SIZE,
  tlbSize: DEFAULT_TLB_SIZE,
  totalFrames: DEFAULT_TOTAL_FRAMES,
};

/** 仮想アドレスをページ番号とオフセットに分解 */
export function splitVirtualAddress(address: number, pageSize: number): VirtualAddress {
  const pageNumber = Math.floor(address / pageSize);
  const offset = address % pageSize;
  return { address, pageNumber, offset };
}

/** 物理アドレスをフレーム番号とオフセットに分解 */
export function splitPhysicalAddress(address: number, pageSize: number): PhysicalAddress {
  const frameNumber = Math.floor(address / pageSize);
  const offset = address % pageSize;
  return { address, frameNumber, offset };
}

/** ページテーブルを作成 */
export function createPageTable(entries: Partial<PageTableEntry>[]): PageTableEntry[] {
  return entries.map((e, i) => ({
    pageNumber: e.pageNumber ?? i,
    frameNumber: e.frameNumber ?? 0,
    present: e.present ?? false,
    dirty: e.dirty ?? false,
    referenced: e.referenced ?? false,
    readable: e.readable ?? true,
    writable: e.writable ?? true,
    executable: e.executable ?? false,
  }));
}

/** TLBを検索 */
function lookupTlb(tlb: TlbEntry[], pageNumber: number): TlbEntry | undefined {
  return tlb.find((e) => e.pageNumber === pageNumber);
}

/** TLBを更新（LRU置換） */
function updateTlb(
  tlb: TlbEntry[],
  pageNumber: number,
  frameNumber: number,
  time: number,
  maxSize: number
): TlbEntry[] {
  const newTlb = tlb.filter((e) => e.pageNumber !== pageNumber);
  const entry: TlbEntry = { pageNumber, frameNumber, lastAccess: time };

  if (newTlb.length >= maxSize) {
    // LRU: 最も古いエントリを削除
    newTlb.sort((a, b) => a.lastAccess - b.lastAccess);
    newTlb.shift();
  }
  newTlb.push(entry);
  return newTlb;
}

/** ページ方式でアドレス変換を行う */
export function translatePageAddress(
  pageTable: PageTableEntry[],
  tlb: TlbEntry[],
  address: number,
  accessType: "read" | "write" | "execute",
  time: number,
  config: PagingConfig = defaultConfig
): { result: TranslationResult; newTlb: TlbEntry[]; tlbHit: boolean; pageFault: boolean } {
  const steps: TranslationStep[] = [];
  const va = splitVirtualAddress(address, config.pageSize);

  steps.push({
    description: `仮想アドレス 0x${address.toString(16)} → ページ番号=${va.pageNumber}, オフセット=0x${va.offset.toString(16)}`,
    type: "info",
    values: { address, pageNumber: va.pageNumber, offset: va.offset },
  });

  let frameNumber: number;
  let tlbHit = false;
  let newTlb = [...tlb];

  // TLB検索
  const tlbEntry = lookupTlb(tlb, va.pageNumber);
  if (tlbEntry) {
    tlbHit = true;
    frameNumber = tlbEntry.frameNumber;
    steps.push({
      description: `TLBヒット！ ページ ${va.pageNumber} → フレーム ${frameNumber}`,
      type: "tlb_hit",
      values: { frameNumber },
    });
    // TLBのアクセス時間更新
    newTlb = newTlb.map((e) =>
      e.pageNumber === va.pageNumber ? { ...e, lastAccess: time } : e
    );
  } else {
    steps.push({
      description: `TLBミス: ページ ${va.pageNumber} がTLBに存在しません`,
      type: "tlb_miss",
    });

    // ページテーブル検索
    const pte = pageTable.find((e) => e.pageNumber === va.pageNumber);
    if (!pte) {
      steps.push({
        description: `ページ ${va.pageNumber} がページテーブルに存在しません`,
        type: "error",
      });
      return {
        result: { success: false, inputAddress: address, error: "無効なページ番号", steps },
        newTlb,
        tlbHit: false,
        pageFault: true,
      };
    }

    steps.push({
      description: `ページテーブル参照: ページ ${pte.pageNumber} → フレーム ${pte.frameNumber} (present=${pte.present})`,
      type: "lookup",
      values: { frameNumber: pte.frameNumber, present: pte.present },
    });

    if (!pte.present) {
      steps.push({
        description: `ページフォールト発生！ ページ ${va.pageNumber} はディスク上にあります`,
        type: "page_fault",
      });
      // ページフォールトはエラーとして返す（簡易シミュレーション）
      return {
        result: { success: false, inputAddress: address, error: "ページフォールト", steps },
        newTlb,
        tlbHit: false,
        pageFault: true,
      };
    }

    // 保護チェック
    const permError = checkPagePermission(pte, accessType);
    if (permError) {
      steps.push({ description: permError, type: "error" });
      return {
        result: { success: false, inputAddress: address, error: permError, steps },
        newTlb,
        tlbHit: false,
        pageFault: false,
      };
    }

    frameNumber = pte.frameNumber;

    // TLB更新
    newTlb = updateTlb(newTlb, va.pageNumber, frameNumber, time, config.tlbSize);
    steps.push({
      description: `TLBにエントリ追加: ページ ${va.pageNumber} → フレーム ${frameNumber}`,
      type: "calc",
    });
  }

  // 物理アドレス計算
  const physicalAddress = frameNumber * config.pageSize + va.offset;
  steps.push({
    description: `物理アドレス = フレーム(${frameNumber}) × ページサイズ(${config.pageSize}) + オフセット(0x${va.offset.toString(16)}) = 0x${physicalAddress.toString(16)}`,
    type: "success",
    values: { physicalAddress },
  });

  return {
    result: { success: true, inputAddress: address, physicalAddress, steps },
    newTlb,
    tlbHit,
    pageFault: false,
  };
}

/** ページの保護チェック */
function checkPagePermission(
  pte: PageTableEntry,
  accessType: "read" | "write" | "execute"
): string | null {
  switch (accessType) {
    case "read":
      if (!pte.readable) return `ページ ${pte.pageNumber} は読み取り不可`;
      break;
    case "write":
      if (!pte.writable) return `ページ ${pte.pageNumber} は書き込み不可（保護違反）`;
      break;
    case "execute":
      if (!pte.executable) return `ページ ${pte.pageNumber} は実行不可（保護違反）`;
      break;
  }
  return null;
}

/** ページ方式でシミュレーション実行 */
export function runPagingSimulation(
  pageTable: PageTableEntry[],
  accesses: MemoryAccess[],
  config: PagingConfig = defaultConfig
): SimulationResult {
  let tlb: TlbEntry[] = [];
  let tlbHits = 0;
  let tlbMisses = 0;
  let pageFaults = 0;

  const translations = accesses.map((access, i) => {
    const { result, newTlb, tlbHit, pageFault } = translatePageAddress(
      pageTable,
      tlb,
      access.address,
      access.type,
      i,
      config
    );
    tlb = newTlb;
    if (tlbHit) tlbHits++;
    else tlbMisses++;
    if (pageFault) pageFaults++;

    if (access.label) {
      result.steps.unshift({
        description: `[${access.label}] ${access.type}アクセス`,
        type: "info",
      });
    }
    return result;
  });

  // 物理メモリマップ生成
  const memoryMap = buildPageMemoryMap(pageTable, config);

  const stats: SimulationStats = {
    totalAccesses: accesses.length,
    successCount: translations.filter((t) => t.success).length,
    errorCount: translations.filter((t) => !t.success).length,
    tlbHits,
    tlbMisses,
    pageFaults,
  };

  return { scheme: "paging", translations, memoryMap, stats };
}

/** ページテーブルから物理メモリマップを構築 */
function buildPageMemoryMap(
  pageTable: PageTableEntry[],
  config: PagingConfig
): MemoryBlock[] {
  const blocks: MemoryBlock[] = [];
  const usedFrames = new Map<number, number>(); // frame → pageNumber

  for (const pte of pageTable) {
    if (pte.present) {
      usedFrames.set(pte.frameNumber, pte.pageNumber);
    }
  }

  for (let f = 0; f < config.totalFrames; f++) {
    const pageNum = usedFrames.get(f);
    if (pageNum !== undefined) {
      blocks.push({
        start: f * config.pageSize,
        size: config.pageSize,
        label: `フレーム${f} (ページ${pageNum})`,
        used: true,
      });
    } else {
      // 連続する空きフレームをまとめる
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && !lastBlock.used) {
        lastBlock.size += config.pageSize;
      } else {
        blocks.push({
          start: f * config.pageSize,
          size: config.pageSize,
          label: "空き",
          used: false,
        });
      }
    }
  }

  return blocks;
}
