import type { Preset } from "./types.js";

export const presets: Preset[] = [
  // 1. Mark-Sweep 基本
  {
    name: "1. Mark-Sweep — 基本的なGC",
    description: "3つのオブジェクトを割り当て、1つをルートから外してGC。到達不能なオブジェクトがスイープされる。",
    algorithm: "mark-sweep",
    roots: [{ name: "root1", targetId: null }, { name: "root2", targetId: null }],
    actions: [
      { type: "alloc", objectId: "a", name: "ObjA", size: 64 },
      { type: "alloc", objectId: "b", name: "ObjB", size: 128 },
      { type: "alloc", objectId: "c", name: "ObjC", size: 32 },
      { type: "root_set", rootName: "root1", targetId: "a" },
      { type: "root_set", rootName: "root2", targetId: "b" },
      { type: "ref", fromId: "a", toId: "c" },
      // ObjBをルートから外す → GCで回収
      { type: "root_set", rootName: "root2", targetId: null },
      { type: "gc" },
    ],
  },

  // 2. Mark-Sweep チェーン参照
  {
    name: "2. Mark-Sweep — チェーン参照の追跡",
    description: "A→B→C→Dのチェーン参照。ルートからAへの参照を辿り、全オブジェクトがマークされる過程を観察。",
    algorithm: "mark-sweep",
    roots: [{ name: "root", targetId: null }],
    actions: [
      { type: "alloc", objectId: "a", name: "A", size: 48 },
      { type: "alloc", objectId: "b", name: "B", size: 48 },
      { type: "alloc", objectId: "c", name: "C", size: 48 },
      { type: "alloc", objectId: "d", name: "D", size: 48 },
      { type: "alloc", objectId: "e", name: "E (孤立)", size: 96 },
      { type: "root_set", rootName: "root", targetId: "a" },
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "c" },
      { type: "ref", fromId: "c", toId: "d" },
      { type: "gc" },
    ],
  },

  // 3. Reference Counting 基本
  {
    name: "3. Reference Counting — 即時解放",
    description: "参照カウント方式。参照が0になった時点でオブジェクトが即座に解放される。GCの停止時間がない。",
    algorithm: "ref-count",
    roots: [{ name: "x", targetId: null }, { name: "y", targetId: null }],
    actions: [
      { type: "alloc", objectId: "a", name: "ObjA", size: 64 },
      { type: "alloc", objectId: "b", name: "ObjB", size: 128 },
      { type: "root_set", rootName: "x", targetId: "a" },
      { type: "root_set", rootName: "y", targetId: "b" },
      { type: "ref", fromId: "a", toId: "b" },
      // yからBの参照を外す（Aからの参照が残るので生存）
      { type: "root_set", rootName: "y", targetId: null },
      // AからBの参照も外す → Bのカウントが0に → 即座に解放
      { type: "deref", fromId: "a", toId: "b" },
    ],
  },

  // 4. Reference Counting 循環参照問題
  {
    name: "4. Reference Counting — 循環参照のメモリリーク",
    description: "参照カウント方式の弱点。A↔Bが相互参照し、ルートから切り離されてもカウントが0にならない。補助GCで検出。",
    algorithm: "ref-count",
    roots: [{ name: "root", targetId: null }],
    actions: [
      { type: "alloc", objectId: "a", name: "ObjA", size: 64 },
      { type: "alloc", objectId: "b", name: "ObjB", size: 64 },
      { type: "root_set", rootName: "root", targetId: "a" },
      // 循環参照を作成
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "a" },
      // ルートから切り離す → カウントは1のまま残る（リーク）
      { type: "root_set", rootName: "root", targetId: null },
      // 循環参照検出GCで解放
      { type: "gc" },
    ],
  },

  // 5. Mark-Compact
  {
    name: "5. Mark-Compact — コンパクションでフラグメンテーション解消",
    description: "Mark-Compact方式。マーク後に生存オブジェクトをヒープの先頭に詰めて配置し、断片化を解消する。",
    algorithm: "mark-compact",
    roots: [{ name: "root", targetId: null }],
    actions: [
      { type: "alloc", objectId: "a", name: "A (64B)", size: 64 },
      { type: "alloc", objectId: "b", name: "B (128B)", size: 128 },
      { type: "alloc", objectId: "c", name: "C (32B)", size: 32 },
      { type: "alloc", objectId: "d", name: "D (96B)", size: 96 },
      { type: "root_set", rootName: "root", targetId: "a" },
      { type: "ref", fromId: "a", toId: "c" },
      { type: "ref", fromId: "a", toId: "d" },
      // B,Cの間のBを解放することで断片化が発生→Compactで解消
      { type: "gc" },
    ],
  },

  // 6. Generational GC — Minor GC
  {
    name: "6. Generational — Minor GC (Young世代のみ)",
    description: "世代別GC。新しいオブジェクト（Young世代）だけを対象にする高速なMinor GC。「ほとんどのオブジェクトは若くして死ぬ」仮説に基づく。",
    algorithm: "generational",
    roots: [{ name: "long_lived", targetId: null }, { name: "temp", targetId: null }],
    actions: [
      { type: "alloc", objectId: "srv", name: "Server", size: 256 },
      { type: "root_set", rootName: "long_lived", targetId: "srv" },
      { type: "alloc", objectId: "req1", name: "Request1", size: 32 },
      { type: "root_set", rootName: "temp", targetId: "req1" },
      // リクエスト処理完了、一時変数をクリア
      { type: "root_set", rootName: "temp", targetId: null },
      { type: "alloc", objectId: "req2", name: "Request2", size: 32 },
      { type: "root_set", rootName: "temp", targetId: "req2" },
      { type: "root_set", rootName: "temp", targetId: null },
      // Minor GC: Young世代のみ回収
      { type: "gc" },
    ],
  },

  // 7. Generational GC — 昇格
  {
    name: "7. Generational — Old世代への昇格",
    description: "複数回のGCを生き残ったオブジェクトはOld世代に昇格する。Old世代はMajor GCでのみ回収対象になる。",
    algorithm: "generational",
    roots: [{ name: "cache", targetId: null }, { name: "temp", targetId: null }],
    actions: [
      { type: "alloc", objectId: "cache1", name: "CachedData", size: 512 },
      { type: "root_set", rootName: "cache", targetId: "cache1" },
      { type: "alloc", objectId: "t1", name: "Temp1", size: 16 },
      { type: "root_set", rootName: "temp", targetId: "t1" },
      { type: "root_set", rootName: "temp", targetId: null },
      { type: "gc" },   // 1回目: CachedData生存（survivalCount=1）
      { type: "alloc", objectId: "t2", name: "Temp2", size: 16 },
      { type: "root_set", rootName: "temp", targetId: "t2" },
      { type: "root_set", rootName: "temp", targetId: null },
      { type: "gc" },   // 2回目: CachedData昇格（Old世代へ）
      { type: "alloc", objectId: "t3", name: "Temp3", size: 16 },
      { type: "gc" },   // 3回目: Temp3回収、CachedDataはOldなのでMinorでスキップ
    ],
  },

  // 8. 大量オブジェクトのMark-Sweep
  {
    name: "8. Mark-Sweep — 大量割り当てと回収",
    description: "多数のオブジェクトを割り当て、一部だけルートから参照。GCで大量のゴミが一気に回収される。",
    algorithm: "mark-sweep",
    roots: [{ name: "keep", targetId: null }],
    actions: [
      { type: "alloc", objectId: "k", name: "Keep", size: 64 },
      { type: "root_set", rootName: "keep", targetId: "k" },
      { type: "alloc", objectId: "g1", name: "Garbage1", size: 32 },
      { type: "alloc", objectId: "g2", name: "Garbage2", size: 48 },
      { type: "alloc", objectId: "g3", name: "Garbage3", size: 64 },
      { type: "alloc", objectId: "g4", name: "Garbage4", size: 96 },
      { type: "alloc", objectId: "g5", name: "Garbage5", size: 128 },
      { type: "alloc", objectId: "g6", name: "Garbage6", size: 16 },
      { type: "ref", fromId: "k", toId: "g2" },
      // g2だけKeepから参照、残り5個はゴミ
      { type: "gc" },
    ],
  },

  // 9. カスケード解放（Reference Counting）
  {
    name: "9. Reference Counting — カスケード解放",
    description: "A→B→C→Dの連鎖。Aの参照カウントが0になると、B→C→Dと連鎖的に解放される。",
    algorithm: "ref-count",
    roots: [{ name: "root", targetId: null }],
    actions: [
      { type: "alloc", objectId: "a", name: "A", size: 32 },
      { type: "alloc", objectId: "b", name: "B", size: 32 },
      { type: "alloc", objectId: "c", name: "C", size: 32 },
      { type: "alloc", objectId: "d", name: "D", size: 32 },
      { type: "root_set", rootName: "root", targetId: "a" },
      { type: "ref", fromId: "a", toId: "b" },
      { type: "ref", fromId: "b", toId: "c" },
      { type: "ref", fromId: "c", toId: "d" },
      // ルートからAを外す → A解放 → B解放 → C解放 → D解放
      { type: "root_set", rootName: "root", targetId: null },
    ],
  },

  // 10. アルゴリズム比較用（Mark-Sweep 複数GCサイクル）
  {
    name: "10. Mark-Sweep — 複数GCサイクル",
    description: "割り当て→GC→割り当て→GCを繰り返し、ヒープの変遷を観察。GCが複数回走る実際的なシナリオ。",
    algorithm: "mark-sweep",
    roots: [{ name: "app", targetId: null }, { name: "temp", targetId: null }],
    actions: [
      { type: "alloc", objectId: "app", name: "App", size: 128 },
      { type: "root_set", rootName: "app", targetId: "app" },
      // フェーズ1: 一時オブジェクト
      { type: "alloc", objectId: "t1", name: "Temp1", size: 32 },
      { type: "root_set", rootName: "temp", targetId: "t1" },
      { type: "root_set", rootName: "temp", targetId: null },
      { type: "gc" },
      // フェーズ2: 新しい子オブジェクト
      { type: "alloc", objectId: "child", name: "Child", size: 64 },
      { type: "ref", fromId: "app", toId: "child" },
      { type: "alloc", objectId: "t2", name: "Temp2", size: 48 },
      { type: "gc" },
      // フェーズ3: childを差し替え
      { type: "deref", fromId: "app", toId: "child" },
      { type: "alloc", objectId: "child2", name: "Child2", size: 80 },
      { type: "ref", fromId: "app", toId: "child2" },
      { type: "gc" },
    ],
  },
];
