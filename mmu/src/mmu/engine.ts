import type {
  MmuConfig, MemoryAccess, PageTableEntry, TlbEntry,
  PhysicalFrame, SimEvent, SimulationResult, EventType,
} from "./types.js";

export function runSimulation(
  config: MmuConfig,
  permissions: [number, boolean, boolean, boolean][],
  accesses: MemoryAccess[],
): SimulationResult {
  const { pageSize, physicalFrames, tlbSize, replacementAlgo, twoLevel } = config;

  const offsetBits = Math.log2(pageSize);
  const vpnMask = ~((1 << offsetBits) - 1);

  // ページテーブル初期化
  const pageTable: PageTableEntry[] = [];
  for (const [vpn, r, w, x] of permissions) {
    pageTable.push({
      vpn, pfn: -1, present: false,
      dirty: false, referenced: false,
      readable: r, writable: w, executable: x,
      lastAccess: 0, loadTime: 0,
    });
  }

  // TLB初期化
  const tlb: TlbEntry[] = [];

  // 物理フレーム初期化
  const frames: PhysicalFrame[] = [];
  for (let i = 0; i < physicalFrames; i++) {
    frames.push({ pfn: i, vpn: -1, occupied: false, data: "" });
  }

  const events: SimEvent[] = [];
  let step = 0;
  let clock = 0; // 論理時刻
  let clockHand = 0; // Clock アルゴリズムのハンド位置

  const stats = {
    totalAccesses: 0, tlbHits: 0, tlbMisses: 0,
    pageFaults: 0, pageEvictions: 0,
    dirtyWritebacks: 0, protectionFaults: 0,
  };

  function emit(type: EventType, desc: string, vpn?: number, pfn?: number): void {
    events.push({
      step, type, description: desc,
      highlight: vpn !== undefined || pfn !== undefined ? { vpn, pfn } : undefined,
    });
  }

  /** ページテーブルからエントリを検索（なければ作成） */
  function getPte(vpn: number): PageTableEntry {
    let pte = pageTable.find((p) => p.vpn === vpn);
    if (!pte) {
      pte = {
        vpn, pfn: -1, present: false,
        dirty: false, referenced: false,
        readable: true, writable: true, executable: false,
        lastAccess: 0, loadTime: 0,
      };
      pageTable.push(pte);
    }
    return pte;
  }

  /** TLBから検索 */
  function tlbLookup(vpn: number): TlbEntry | undefined {
    return tlb.find((e) => e.vpn === vpn && e.valid);
  }

  /** TLBに追加 */
  function tlbInsert(vpn: number, pfn: number, dirty: boolean): void {
    const newEntry: TlbEntry = { vpn, pfn, valid: true, dirty, lastAccess: clock };

    // 空きスロットを探す
    const invalidSlot = tlb.findIndex((e) => !e.valid);
    if (invalidSlot >= 0) {
      tlb[invalidSlot] = newEntry;
      emit("tlb_update", `TLB更新: VPN ${vpn} → PFN ${pfn}`, vpn, pfn);
      return;
    }

    // TLBがまだ満杯でない場合は追加
    if (tlb.length < tlbSize) {
      tlb.push(newEntry);
      emit("tlb_update", `TLB追加: VPN ${vpn} → PFN ${pfn}`, vpn, pfn);
      return;
    }

    // LRUで追い出し
    let oldestIdx = 0;
    for (let i = 1; i < tlb.length; i++) {
      if (tlb[i]!.lastAccess < tlb[oldestIdx]!.lastAccess) oldestIdx = i;
    }
    emit("tlb_evict", `TLBエビクト: VPN ${tlb[oldestIdx]!.vpn} (LRU)`, tlb[oldestIdx]!.vpn);
    tlb[oldestIdx] = newEntry;
    emit("tlb_update", `TLB更新: VPN ${vpn} → PFN ${pfn}`, vpn, pfn);
  }

  /** 空きフレームを取得 */
  function findFreeFrame(): PhysicalFrame | undefined {
    return frames.find((f) => !f.occupied);
  }

  /** ページ置換: 犠牲ページを選択 */
  function selectVictim(futureVpns: number[]): PhysicalFrame {
    const occupiedFrames = frames.filter((f) => f.occupied);

    switch (replacementAlgo) {
      case "fifo": {
        // 最も古くロードされたページ
        let oldest: { frame: PhysicalFrame; loadTime: number } | undefined;
        for (const frame of occupiedFrames) {
          const pte = pageTable.find((p) => p.vpn === frame.vpn && p.present);
          const lt = pte?.loadTime ?? 0;
          if (!oldest || lt < oldest.loadTime) {
            oldest = { frame, loadTime: lt };
          }
        }
        return oldest!.frame;
      }

      case "lru": {
        // 最も最近使われていないページ
        let lru: { frame: PhysicalFrame; lastAccess: number } | undefined;
        for (const frame of occupiedFrames) {
          const pte = pageTable.find((p) => p.vpn === frame.vpn && p.present);
          const la = pte?.lastAccess ?? 0;
          if (!lru || la < lru.lastAccess) {
            lru = { frame, lastAccess: la };
          }
        }
        return lru!.frame;
      }

      case "clock": {
        // Second Chance (Clock) アルゴリズム
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const frame = frames[clockHand % physicalFrames]!;
          if (frame.occupied) {
            const pte = pageTable.find((p) => p.vpn === frame.vpn && p.present);
            if (pte && pte.referenced) {
              pte.referenced = false;
              emit("clock_scan", `Clock: VPN ${frame.vpn} の参照ビットをクリア (second chance)`, frame.vpn, frame.pfn);
              clockHand = (clockHand + 1) % physicalFrames;
            } else {
              clockHand = (clockHand + 1) % physicalFrames;
              return frame;
            }
          } else {
            clockHand = (clockHand + 1) % physicalFrames;
            return frame;
          }
        }
      }

      case "optimal": {
        // 最も将来長く使われないページ（Bélády's algorithm）
        let best: { frame: PhysicalFrame; nextUse: number } | undefined;
        for (const frame of occupiedFrames) {
          const nextIdx = futureVpns.indexOf(frame.vpn);
          const nextUse = nextIdx === -1 ? Infinity : nextIdx;
          if (!best || nextUse > best.nextUse) {
            best = { frame, nextUse };
          }
        }
        return best!.frame;
      }
    }
  }

  /** ページをフレームにロード */
  function loadPage(vpn: number, frame: PhysicalFrame): void {
    frame.occupied = true;
    frame.vpn = vpn;
    frame.data = `Page ${vpn}`;
    const pte = getPte(vpn);
    pte.pfn = frame.pfn;
    pte.present = true;
    pte.dirty = false;
    pte.referenced = true;
    pte.loadTime = clock;
    pte.lastAccess = clock;
    emit("page_load", `ページ ${vpn} をフレーム ${frame.pfn} にロード`, vpn, frame.pfn);
  }

  /** ページをエビクト */
  function evictPage(frame: PhysicalFrame, _futureVpns: number[]): void {
    const pte = pageTable.find((p) => p.vpn === frame.vpn && p.present);
    if (pte) {
      if (pte.dirty) {
        stats.dirtyWritebacks++;
        emit("page_evict_dirty",
          `ページ ${pte.vpn} (フレーム ${frame.pfn}) をディスクに書き戻し (dirty)`, pte.vpn, frame.pfn);
      } else {
        emit("page_evict",
          `ページ ${pte.vpn} (フレーム ${frame.pfn}) をエビクト`, pte.vpn, frame.pfn);
      }
      pte.present = false;
      pte.pfn = -1;
      // TLBからも無効化
      const tlbEntry = tlb.find((t) => t.vpn === pte.vpn && t.valid);
      if (tlbEntry) {
        tlbEntry.valid = false;
        emit("tlb_evict", `TLB無効化: VPN ${pte.vpn}`, pte.vpn);
      }
    }
    stats.pageEvictions++;
    frame.occupied = false;
    frame.vpn = -1;
    frame.data = "";
  }

  // ── メインループ ──

  for (let i = 0; i < accesses.length; i++) {
    const access = accesses[i]!;
    step++;
    clock++;
    stats.totalAccesses++;

    const vpn = (access.virtualAddress & vpnMask) >>> offsetBits;
    const offset = access.virtualAddress & ((1 << offsetBits) - 1);
    const accessLabel = access.accessType === "read" ? "読み取り"
      : access.accessType === "write" ? "書き込み" : "実行";

    emit("access_start", `仮想アドレス 0x${access.virtualAddress.toString(16).padStart(4, "0")} を${accessLabel}`, vpn);
    emit("addr_split",
      `アドレス分解: VPN=${vpn}, オフセット=${offset} (ページサイズ=${pageSize}B)`, vpn);

    // 1. TLB検索
    emit("tlb_lookup", `TLB検索: VPN ${vpn}`, vpn);
    const tlbHit = tlbLookup(vpn);

    let pfn: number;

    if (tlbHit) {
      // TLBヒット
      stats.tlbHits++;
      pfn = tlbHit.pfn;
      tlbHit.lastAccess = clock;
      emit("tlb_hit", `TLBヒット! VPN ${vpn} → PFN ${pfn}`, vpn, pfn);
    } else {
      // TLBミス → ページテーブルウォーク
      stats.tlbMisses++;
      emit("tlb_miss", `TLBミス: VPN ${vpn} — ページテーブルウォーク開始`, vpn);

      if (twoLevel) {
        // 2段ページテーブル
        const l2Index = vpn >>> 4;
        const l1Index = vpn & 0xF;
        emit("pt_walk_l2", `L2ページテーブル[${l2Index}] を参照`, vpn);
        emit("pt_walk_l1", `L1ページテーブル[${l1Index}] を参照`, vpn);
      } else {
        emit("pt_walk", `ページテーブル[VPN=${vpn}] を参照`, vpn);
      }

      const pte = getPte(vpn);

      if (pte.present) {
        // ページテーブルヒット
        pfn = pte.pfn;
        emit("pt_hit", `ページテーブルヒット: VPN ${vpn} → PFN ${pfn}`, vpn, pfn);
      } else {
        // ページフォルト
        stats.pageFaults++;
        emit("page_fault", `ページフォルト! VPN ${vpn} はメモリ上にない`, vpn);

        // 空きフレームを探す
        let frame = findFreeFrame();
        if (!frame) {
          // 置換が必要
          const futureVpns = accesses.slice(i + 1).map((a) =>
            ((a.virtualAddress & vpnMask) >>> offsetBits));
          frame = selectVictim(futureVpns);
          evictPage(frame, futureVpns);
        }
        emit("frame_alloc", `フレーム ${frame.pfn} を割り当て`, vpn, frame.pfn);
        loadPage(vpn, frame);
        pfn = frame.pfn;
      }

      // TLBに登録
      tlbInsert(vpn, pfn, pte.dirty);
    }

    // 権限チェック
    const pte = getPte(vpn);
    if (access.accessType === "read" && !pte.readable) {
      stats.protectionFaults++;
      emit("protection_fault", `保護違反: VPN ${vpn} は読み取り不可`, vpn, pfn);
      continue;
    }
    if (access.accessType === "write" && !pte.writable) {
      stats.protectionFaults++;
      emit("protection_fault", `保護違反: VPN ${vpn} は書き込み不可`, vpn, pfn);
      continue;
    }
    if (access.accessType === "execute" && !pte.executable) {
      stats.protectionFaults++;
      emit("protection_fault", `保護違反: VPN ${vpn} は実行不可 (NX)`, vpn, pfn);
      continue;
    }

    // アクセス完了
    pte.referenced = true;
    pte.lastAccess = clock;
    if (access.accessType === "write") {
      pte.dirty = true;
      const tlbEntry = tlb.find((t) => t.vpn === vpn && t.valid);
      if (tlbEntry) tlbEntry.dirty = true;
      emit("dirty_set", `ダーティビットをセット: VPN ${vpn}`, vpn, pfn);
    }

    const physAddr = pfn * pageSize + offset;
    emit("physical_access",
      `物理アドレス 0x${physAddr.toString(16).padStart(4, "0")} (PFN ${pfn} + offset ${offset}) を${accessLabel}`, vpn, pfn);
    emit("access_complete",
      `アクセス完了: VA 0x${access.virtualAddress.toString(16).padStart(4, "0")} → PA 0x${physAddr.toString(16).padStart(4, "0")}`, vpn, pfn);
  }

  return {
    events,
    pageTable: pageTable.filter((p) => p.present || permissions.some(([v]) => v === p.vpn)),
    tlb: tlb.slice(),
    frames: frames.slice(),
    stats,
  };
}
