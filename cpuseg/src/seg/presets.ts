import type { Preset, SegmentDescriptor, SegmentSelector, CpuState, PrivilegeLevel } from "./types.js";

/** ヘルパー: コードセグメント作成 */
function code(index: number, name: string, base: number, limit: number, dpl: PrivilegeLevel, opts?: { conforming?: boolean; readable?: boolean }): SegmentDescriptor {
  return {
    index, name, base, limit, type: "code", dpl, present: true,
    granularity: false, readable: opts?.readable ?? true, writable: false,
    conforming: opts?.conforming ?? false, accessed: false,
  };
}

/** ヘルパー: データセグメント作成 */
function data(index: number, name: string, base: number, limit: number, dpl: PrivilegeLevel, opts?: { writable?: boolean }): SegmentDescriptor {
  return {
    index, name, base, limit, type: "data", dpl, present: true,
    granularity: false, readable: true, writable: opts?.writable ?? true,
    conforming: false, accessed: false,
  };
}

/** ヘルパー: スタックセグメント作成 */
function stack(index: number, name: string, base: number, limit: number, dpl: PrivilegeLevel): SegmentDescriptor {
  return {
    index, name, base, limit, type: "stack", dpl, present: true,
    granularity: false, readable: true, writable: true,
    conforming: false, accessed: false,
  };
}

/** ヘルパー: ヌルディスクリプタ */
function nullDesc(): SegmentDescriptor {
  return {
    index: 0, name: "NULL", base: 0, limit: 0, type: "null", dpl: 0,
    present: false, granularity: false, readable: false, writable: false,
    conforming: false, accessed: false,
  };
}

/** ヘルパー: コールゲート */
function callGate(index: number, name: string, dpl: PrivilegeLevel, targetSelector: number, targetOffset: number): SegmentDescriptor {
  return {
    index, name, base: 0, limit: 0, type: "call_gate", dpl, present: true,
    granularity: false, readable: false, writable: false, conforming: false,
    accessed: false, gateSelector: targetSelector, gateOffset: targetOffset,
  };
}

function sel(index: number, ti: "gdt" | "ldt" = "gdt", rpl: PrivilegeLevel = 0): SegmentSelector {
  return { index, ti, rpl };
}

function cpuState(cpl: PrivilegeLevel, cs: SegmentSelector, ds: SegmentSelector, ss: SegmentSelector): CpuState {
  return {
    cpl,
    registers: [
      { name: "CS", selector: cs },
      { name: "DS", selector: ds },
      { name: "SS", selector: ss },
      { name: "ES", selector: { index: 0, ti: "gdt", rpl: 0 } },
      { name: "FS", selector: { index: 0, ti: "gdt", rpl: 0 } },
      { name: "GS", selector: { index: 0, ti: "gdt", rpl: 0 } },
    ],
  };
}

export const presets: Preset[] = [
  // 1. 基本的なセグメント変換
  {
    name: "1. 基本 — セグメント:オフセット → リニアアドレス",
    description: "セグメントベース+オフセットでリニアアドレスを計算。GDTからディスクリプタをロードし、リミットチェック・特権チェックを行う。",
    gdt: [
      nullDesc(),
      code(1, "KernelCode", 0x00000000, 0xFFFF, 0),
      data(2, "KernelData", 0x00000000, 0xFFFF, 0),
      stack(3, "KernelStack", 0x00010000, 0x0000, 0),
    ],
    ldt: [],
    initialCpu: cpuState(0, sel(1, "gdt", 0), sel(2, "gdt", 0), sel(3, "gdt", 0)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x100 },
      { type: "execute", segReg: "CS", offset: 0x200 },
      { type: "write", segReg: "DS", offset: 0x50, data: "0xDEAD" },
    ],
  },

  // 2. リミット違反
  {
    name: "2. リミット違反 — セグメント境界チェック",
    description: "オフセットがセグメントリミットを超えると#GPフォルトが発生。バッファオーバーフロー防止の基盤。",
    gdt: [
      nullDesc(),
      code(1, "Code", 0x1000, 0x00FF, 0),
      data(2, "SmallData", 0x2000, 0x003F, 0, { writable: true }),
      stack(3, "Stack", 0x3000, 0x0000, 0),
    ],
    ldt: [],
    initialCpu: cpuState(0, sel(1, "gdt", 0), sel(2, "gdt", 0), sel(3, "gdt", 0)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x20 },   // OK: 0x20 <= 0x3F
      { type: "read", segReg: "DS", offset: 0x3F },   // OK: ちょうどリミット
      { type: "read", segReg: "DS", offset: 0x40 },   // #GP: リミット超過
      { type: "write", segReg: "DS", offset: 0x100 },  // #GP: リミット超過
    ],
  },

  // 3. 特権レベル（Ring 0 vs Ring 3）
  {
    name: "3. 特権レベル — Ring 0/3 のアクセス制御",
    description: "Ring 3（ユーザー）からDPL=0（カーネル）セグメントへのアクセスは拒否。Ring 0はどこでもアクセス可。",
    gdt: [
      nullDesc(),
      code(1, "KernelCode", 0x00000, 0xFFFF, 0),
      data(2, "KernelData", 0x00000, 0xFFFF, 0),
      code(3, "UserCode", 0x10000, 0xFFFF, 3),
      data(4, "UserData", 0x20000, 0xFFFF, 3),
      stack(5, "UserStack", 0x30000, 0x0000, 3),
    ],
    ldt: [],
    initialCpu: cpuState(3, sel(3, "gdt", 3), sel(4, "gdt", 3), sel(5, "gdt", 3)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x10 },    // OK: UserData DPL=3
      { type: "load_seg", targetReg: "DS", newSelector: sel(2, "gdt", 3) },  // #GP: KernelData DPL=0
      { type: "load_seg", targetReg: "ES", newSelector: sel(4, "gdt", 3) },  // OK: UserData DPL=3
      { type: "read", segReg: "DS", offset: 0x20 },    // OK: DSはUserDataのまま
    ],
  },

  // 4. コンフォーミングコードセグメント
  {
    name: "4. コンフォーミング — 低特権からの呼び出し許可",
    description: "コンフォーミングコードセグメントはCPL >= DPLなら呼び出し可能。共有ライブラリに使用。CPLは変化しない。",
    gdt: [
      nullDesc(),
      code(1, "SharedLib (conf)", 0x5000, 0xFFFF, 0, { conforming: true }),
      code(2, "PrivLib (non-conf)", 0x6000, 0xFFFF, 0, { conforming: false }),
      code(3, "UserCode", 0x10000, 0xFFFF, 3),
      data(4, "UserData", 0x20000, 0xFFFF, 3),
      stack(5, "UserStack", 0x30000, 0x0000, 3),
    ],
    ldt: [],
    initialCpu: cpuState(3, sel(3, "gdt", 3), sel(4, "gdt", 3), sel(5, "gdt", 3)),
    ops: [
      { type: "far_jmp", newSelector: sel(1, "gdt", 3), offset: 0x00 },  // OK: コンフォーミング
      { type: "far_jmp", newSelector: sel(2, "gdt", 3), offset: 0x00 },  // #GP: 非コンフォーミング
    ],
  },

  // 5. コールゲートによるリング遷移
  {
    name: "5. コールゲート — Ring 3→Ring 0 遷移",
    description: "コールゲートを使いRing 3からRing 0のカーネルコードを呼び出す。システムコールの仕組み。ゲートのDPLが3なのでユーザーがアクセス可。",
    gdt: [
      nullDesc(),
      code(1, "KernelCode", 0x00000, 0xFFFF, 0),
      data(2, "KernelData", 0x00000, 0xFFFF, 0),
      code(3, "UserCode", 0x10000, 0xFFFF, 3),
      data(4, "UserData", 0x20000, 0xFFFF, 3),
      stack(5, "UserStack", 0x30000, 0x0000, 3),
      callGate(6, "SyscallGate", 3, (1 << 3) | 0, 0x100), // ゲートDPL=3, ターゲット=GDT[1]:0x100
    ],
    ldt: [],
    initialCpu: cpuState(3, sel(3, "gdt", 3), sel(4, "gdt", 3), sel(5, "gdt", 3)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x00 },     // 通常のユーザーアクセス
      { type: "far_call", newSelector: sel(6, "gdt", 3), offset: 0 },  // コールゲート経由でRing 0へ
    ],
  },

  // 6. ヌルセレクタ
  {
    name: "6. ヌルセレクタ — #GP フォルト",
    description: "GDTインデックス0はヌルディスクリプタ。このセレクタでメモリアクセスすると#GP。CS/SSにはロードも不可。",
    gdt: [
      nullDesc(),
      code(1, "Code", 0x1000, 0xFFFF, 0),
      data(2, "Data", 0x2000, 0xFFFF, 0),
      stack(3, "Stack", 0x3000, 0x0000, 0),
    ],
    ldt: [],
    initialCpu: cpuState(0, sel(1, "gdt", 0), sel(2, "gdt", 0), sel(3, "gdt", 0)),
    ops: [
      { type: "load_seg", targetReg: "ES", newSelector: sel(0, "gdt", 0) }, // OK: ES/FSにはヌルロード可
      { type: "load_seg", targetReg: "CS", newSelector: sel(0, "gdt", 0) }, // #GP: CSにヌル不可
      { type: "load_seg", targetReg: "SS", newSelector: sel(0, "gdt", 0) }, // #GP: SSにヌル不可
    ],
  },

  // 7. LDT（ローカルディスクリプタテーブル）
  {
    name: "7. LDT — プロセス固有のセグメント",
    description: "LDTはプロセスごとに異なるセグメントを提供。TIビット=1でLDTを参照。プロセス分離に使用。",
    gdt: [
      nullDesc(),
      code(1, "KernelCode", 0x00000, 0xFFFF, 0),
      data(2, "KernelData", 0x00000, 0xFFFF, 0),
    ],
    ldt: [
      code(1, "ProcA_Code", 0x40000, 0x1FFF, 3),
      data(2, "ProcA_Data", 0x42000, 0x0FFF, 3),
      stack(3, "ProcA_Stack", 0x50000, 0x0000, 3),
    ],
    initialCpu: cpuState(3, sel(1, "ldt", 3), sel(2, "ldt", 3), sel(3, "ldt", 3)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x100 },     // LDT[2] ProcA_Data
      { type: "execute", segReg: "CS", offset: 0x00 },    // LDT[1] ProcA_Code
      { type: "read", segReg: "DS", offset: 0x1000 },     // リミット超過 #GP
    ],
  },

  // 8. 非存在セグメント (#NP)
  {
    name: "8. 非存在セグメント — #NP フォルト",
    description: "Present=0のセグメントにアクセスすると#NP。スワップアウトされたセグメントや未初期化セグメントを検出。",
    gdt: [
      nullDesc(),
      code(1, "Code", 0x1000, 0xFFFF, 0),
      data(2, "Data", 0x2000, 0xFFFF, 0),
      { index: 3, name: "SwappedSeg", base: 0x5000, limit: 0xFFFF, type: "data", dpl: 0,
        present: false, granularity: false, readable: true, writable: true, conforming: false, accessed: false },
      stack(4, "Stack", 0x3000, 0x0000, 0),
    ],
    ldt: [],
    initialCpu: cpuState(0, sel(1, "gdt", 0), sel(2, "gdt", 0), sel(4, "gdt", 0)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x10 },       // OK
      { type: "load_seg", targetReg: "ES", newSelector: sel(3, "gdt", 0) },  // #NP
    ],
  },

  // 9. 4KB粒度セグメント
  {
    name: "9. 粒度ビット — 4KBページ粒度 vs バイト粒度",
    description: "Granularity=1のとき、リミットは4KB(4096)単位。limit=0xFFFFFで4GB全体を覆うフラットモデル。",
    gdt: [
      nullDesc(),
      code(1, "FlatCode", 0x00000000, 0xFFFF, 0),
      { index: 2, name: "FlatData(4KB)", base: 0x00000000, limit: 0x000F, type: "data", dpl: 0,
        present: true, granularity: true, readable: true, writable: true, conforming: false, accessed: false },
      { index: 3, name: "SmallData(byte)", base: 0x00000000, limit: 0x000F, type: "data", dpl: 0,
        present: true, granularity: false, readable: true, writable: true, conforming: false, accessed: false },
      stack(4, "Stack", 0x10000, 0x0000, 0),
    ],
    ldt: [],
    initialCpu: cpuState(0, sel(1, "gdt", 0), sel(2, "gdt", 0), sel(4, "gdt", 0)),
    ops: [
      { type: "read", segReg: "DS", offset: 0x1000 },   // OK: 4KB粒度なら0xFFFF以内
      { type: "load_seg", targetReg: "DS", newSelector: sel(3, "gdt", 0) },
      { type: "read", segReg: "DS", offset: 0x0F },     // OK: バイト粒度 limit=0x0F
      { type: "read", segReg: "DS", offset: 0x10 },     // #GP: バイト粒度 limit=0x0F超過
    ],
  },

  // 10. 書き込み保護とコードセグメント読み取り
  {
    name: "10. 種別チェック — 書き込み保護・コード読み取り制御",
    description: "コードセグメントへの書き込みは常に禁止。コードセグメントの読み取りはR=1の場合のみ可。データの読み取り専用も制御。",
    gdt: [
      nullDesc(),
      code(1, "ReadableCode", 0x1000, 0xFFFF, 0, { readable: true }),
      code(2, "ExecOnlyCode", 0x2000, 0xFFFF, 0, { readable: false }),
      data(3, "ReadOnlyData", 0x3000, 0xFFFF, 0, { writable: false }),
      data(4, "ReadWriteData", 0x4000, 0xFFFF, 0, { writable: true }),
      stack(5, "Stack", 0x5000, 0x0000, 0),
    ],
    ldt: [],
    initialCpu: cpuState(0, sel(1, "gdt", 0), sel(4, "gdt", 0), sel(5, "gdt", 0)),
    ops: [
      { type: "execute", segReg: "CS", offset: 0x00 },   // OK: コード実行
      { type: "write", segReg: "DS", offset: 0x10 },      // OK: ReadWriteData
      { type: "load_seg", targetReg: "DS", newSelector: sel(3, "gdt", 0) },
      { type: "write", segReg: "DS", offset: 0x10 },      // #GP: 読み取り専用
      { type: "read", segReg: "DS", offset: 0x10 },       // OK: 読み取りは可
      { type: "load_seg", targetReg: "CS", newSelector: sel(2, "gdt", 0) },
      // CS=ExecOnlyCode になったので読み取り不可のテストはload_seg後
    ],
  },
];
