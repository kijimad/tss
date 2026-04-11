import type {
  SegmentEntry,
  SegmentAddress,
  TranslationResult,
  TranslationStep,
  MemoryAccess,
  MemoryBlock,
  SimulationResult,
  SimulationStats,
} from "./types.js";

/** セグメントテーブルを作成 */
export function createSegmentTable(entries: SegmentEntry[]): SegmentEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** セグメント方式でアドレス変換を行う */
export function translateSegmentAddress(
  table: SegmentEntry[],
  addr: SegmentAddress,
  accessType: "read" | "write" | "execute"
): TranslationResult {
  const steps: TranslationStep[] = [];

  steps.push({
    description: `論理アドレス: セグメント=${addr.segment}, オフセット=0x${addr.offset.toString(16)}`,
    type: "info",
    values: { segment: addr.segment, offset: addr.offset },
  });

  // セグメントテーブル検索
  const entry = table.find((e) => e.id === addr.segment);
  if (!entry) {
    steps.push({
      description: `セグメント ${addr.segment} がテーブルに存在しません`,
      type: "error",
    });
    return { success: false, inputAddress: addr.offset, error: "セグメント不在", steps };
  }

  steps.push({
    description: `セグメントテーブル参照: "${entry.name}" (base=0x${entry.base.toString(16)}, limit=0x${entry.limit.toString(16)})`,
    type: "lookup",
    values: { name: entry.name, base: entry.base, limit: entry.limit },
  });

  // presentビットチェック
  if (!entry.present) {
    steps.push({
      description: `セグメント "${entry.name}" はメモリ上に存在しません（present=false）`,
      type: "error",
    });
    return { success: false, inputAddress: addr.offset, error: "セグメントフォールト（not present）", steps };
  }

  // リミットチェック
  if (addr.offset >= entry.limit) {
    steps.push({
      description: `オフセット 0x${addr.offset.toString(16)} がリミット 0x${entry.limit.toString(16)} を超えています`,
      type: "error",
    });
    return { success: false, inputAddress: addr.offset, error: "セグメンテーションフォールト（limit超過）", steps };
  }

  steps.push({
    description: `リミットチェック OK: 0x${addr.offset.toString(16)} < 0x${entry.limit.toString(16)}`,
    type: "calc",
  });

  // 保護チェック
  const permError = checkSegmentPermission(entry, accessType);
  if (permError) {
    steps.push({
      description: permError,
      type: "error",
    });
    return { success: false, inputAddress: addr.offset, error: permError, steps };
  }

  steps.push({
    description: `保護チェック OK: ${accessType}アクセス許可あり`,
    type: "calc",
  });

  // 物理アドレス計算
  const physical = entry.base + addr.offset;
  steps.push({
    description: `物理アドレス = base(0x${entry.base.toString(16)}) + offset(0x${addr.offset.toString(16)}) = 0x${physical.toString(16)}`,
    type: "success",
    values: { physicalAddress: physical },
  });

  return { success: true, inputAddress: addr.offset, physicalAddress: physical, steps };
}

/** セグメントの保護チェック */
function checkSegmentPermission(
  entry: SegmentEntry,
  accessType: "read" | "write" | "execute"
): string | null {
  switch (accessType) {
    case "read":
      if (!entry.readable) return `セグメント "${entry.name}" は読み取り不可`;
      break;
    case "write":
      if (!entry.writable) return `セグメント "${entry.name}" は書き込み不可（保護違反）`;
      break;
    case "execute":
      if (!entry.executable) return `セグメント "${entry.name}" は実行不可（保護違反）`;
      break;
  }
  return null;
}

/** セグメント方式でシミュレーション実行 */
export function runSegmentSimulation(
  table: SegmentEntry[],
  accesses: MemoryAccess[]
): SimulationResult {
  const translations = accesses.map((access) => {
    const segAddr: SegmentAddress = {
      segment: access.segment ?? 0,
      offset: access.address,
    };
    const result = translateSegmentAddress(table, segAddr, access.type);
    if (access.label) {
      result.steps.unshift({
        description: `[${access.label}] ${access.type}アクセス`,
        type: "info",
      });
    }
    return result;
  });

  // 物理メモリマップ生成
  const memoryMap = buildSegmentMemoryMap(table);

  const stats: SimulationStats = {
    totalAccesses: accesses.length,
    successCount: translations.filter((t) => t.success).length,
    errorCount: translations.filter((t) => !t.success).length,
    segmentFaults: translations.filter((t) => !t.success).length,
  };

  return { scheme: "segment", translations, memoryMap, stats };
}

/** セグメントテーブルから物理メモリマップを構築 */
function buildSegmentMemoryMap(table: SegmentEntry[]): MemoryBlock[] {
  const blocks: MemoryBlock[] = [];
  // presentなセグメントをベースアドレスでソート
  const sorted = table
    .filter((e) => e.present)
    .sort((a, b) => a.base - b.base);

  let current = 0;
  for (const entry of sorted) {
    if (entry.base > current) {
      blocks.push({ start: current, size: entry.base - current, label: "空き", used: false });
    }
    blocks.push({
      start: entry.base,
      size: entry.limit,
      label: `${entry.name} (seg ${entry.id})`,
      used: true,
    });
    current = entry.base + entry.limit;
  }

  // 残りの空き領域（64KB物理メモリを仮定）
  const totalMemory = 0x10000;
  if (current < totalMemory) {
    blocks.push({ start: current, size: totalMemory - current, label: "空き", used: false });
  }

  return blocks;
}
