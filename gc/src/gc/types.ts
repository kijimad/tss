/**
 * GCアルゴリズム種別
 *
 * - "mark-sweep": マーク&スイープ方式。ルート集合（スタック・グローバル変数・レジスタ）から
 *   到達可能なオブジェクトをマークし、マークされなかったオブジェクトを解放する。
 *   実装が単純だが、ヒープの断片化（フラグメンテーション）が発生する。
 *   GC中はアプリケーションが停止する（Stop-the-World）。
 *
 * - "mark-compact": マーク&コンパクト方式。マークフェーズの後、生存オブジェクトを
 *   ヒープの先頭に詰めて再配置（コンパクション）する。断片化を解消できるが、
 *   オブジェクトの移動とポインタの更新が必要なためオーバーヘッドが大きい。
 *
 * - "ref-count": 参照カウント方式。各オブジェクトが被参照数を保持し、カウントが
 *   0になった時点で即座に解放する。Stop-the-Worldが不要で遅延が小さいが、
 *   循環参照（A→B→A）を検出できないためメモリリークが起きる弱点がある。
 *
 * - "generational": 世代別GC方式。「ほとんどのオブジェクトは若くして死ぬ」（弱い世代仮説）
 *   に基づき、ヒープをYoung世代とOld世代に分割する。Young世代のみを対象とする
 *   高速なMinor GCと、全世代を対象とするMajor GCを使い分ける。
 */
export type GcAlgorithm = "mark-sweep" | "mark-compact" | "ref-count" | "generational";

/**
 * オブジェクトの世代（Generational GC用）
 *
 * - "young": Young世代（新世代）。新しく割り当てられたオブジェクトはここに配置される。
 *   Minor GCの回収対象。短命なオブジェクトが多く、回収効率が高い。
 * - "old": Old世代（旧世代）。複数回のGCサイクルを生き残った長寿命オブジェクト。
 *   Major GCでのみ回収対象となる。昇格（プロモーション）によりYoungからOldへ移動する。
 */
export type Generation = "young" | "old";

/**
 * ヒープ上のオブジェクト
 *
 * GCが管理するメモリ上の個々のオブジェクトを表す。
 * 実際のランタイム（JVM、V8等）では、オブジェクトヘッダにマークビットや
 * 世代情報が格納される。このシミュレータでは全GCアルゴリズムのメタデータを
 * 一つの型にまとめている。
 */
export interface HeapObject {
  /** オブジェクトの一意な識別子 */
  id: string;
  /** 表示用の名前 */
  name: string;
  /** オブジェクトのバイトサイズ（メモリ使用量） */
  size: number;
  /**
   * このオブジェクトが参照している他のオブジェクトのIDリスト。
   * GCルートからこの参照グラフを辿ることで到達可能性を判定する（トレーシング）。
   */
  refs: string[];
  /**
   * マークビット（Mark-Sweep / Mark-Compact用）。
   * トレーシングGCのマークフェーズで、ルート集合から到達可能なオブジェクトに
   * trueが設定される。三色マーキング（白・灰・黒）の簡略版として、
   * false=白（未到達）、true=黒（到達済み）の二値で管理している。
   */
  marked: boolean;
  /**
   * 参照カウント（Reference Counting用）。
   * このオブジェクトを指しているポインタの数。カウントが0になると即座に解放される。
   * 循環参照がある場合、カウントが0にならずメモリリークが発生する。
   */
  refCount: number;
  /**
   * 所属する世代（Generational GC用）。
   * 新規オブジェクトはYoung世代に割り当てられ、複数回のGCを生き残ると
   * Old世代に昇格（プロモーション）する。
   */
  generation: Generation;
  /**
   * GCサイクルを生き残った回数。
   * Generational GCでは、この値が閾値（本シミュレータでは2）に達すると
   * Old世代に昇格する。Mark-Sweep等でも統計として記録される。
   */
  survivalCount: number;
  /**
   * ヒープ上の論理アドレス（Mark-Compact用）。
   * オブジェクトが配置されているメモリの先頭アドレスを表す。
   * コンパクション前後でアドレスが変化する。
   */
  address: number;
  /**
   * コンパクション後の転送先アドレス（Mark-Compact用）。
   * コンパクションフェーズで新しいアドレスが計算され、移動後にaddressに反映される。
   * フォワーディングポインタとも呼ばれ、移動済みオブジェクトへの参照を更新するために使用する。
   */
  forwardingAddress?: number;
}

/**
 * GCルート（ルート集合の一要素）
 *
 * GCルートとは、GCのトレーシング（到達可能性解析）の起点となる参照のこと。
 * 実際のランタイムでは以下がGCルートとなる：
 * - スタック上のローカル変数
 * - グローバル変数・静的変数
 * - CPUレジスタに保持されたポインタ
 * - JNIグローバル参照（JVM）など
 *
 * ルートから到達可能なオブジェクトは「生存」、到達不能なオブジェクトは「ゴミ」と判定される。
 */
export interface GcRoot {
  /** ルートの名前（変数名を模した識別子） */
  name: string;
  /** 参照先オブジェクトID（nullならルートが空＝どのオブジェクトも指していない） */
  targetId: string | null;
}

/**
 * ヒープ操作（シミュレーションの入力アクション）
 *
 * アプリケーションのメモリ操作をモデル化したもの。
 * 実際のプログラムで発生する操作を以下のアクションで表現する：
 * - alloc: オブジェクトの割り当て（new演算子やmalloc相当）
 * - ref: オブジェクト間参照の追加（ポインタ代入）
 * - deref: オブジェクト間参照の削除（ポインタのクリア）
 * - root_set: GCルートの参照先を変更（ローカル変数への代入）
 * - gc: GCの手動トリガー（メモリ不足時に自動発動する場合もあるが、本シミュレータでは明示的に発動する）
 */
export type HeapAction =
  | { type: "alloc"; objectId: string; name: string; size: number }
  | { type: "ref"; fromId: string; toId: string }
  | { type: "deref"; fromId: string; toId: string }
  | { type: "root_set"; rootName: string; targetId: string | null }
  | { type: "gc" };

/**
 * シミュレーションイベント種別
 *
 * GCシミュレーションの各ステップで発生するイベントの種類。
 * UI側でイベントごとに色分けや説明を表示するために使用する。
 *
 * 【共通イベント】
 * - alloc: オブジェクトの割り当て
 * - root_set: ルート参照の変更
 * - ref_add / ref_remove: オブジェクト間参照の追加・削除
 *
 * 【マーク&スイープ / マーク&コンパクト共通】
 * - gc_start: GCサイクルの開始（Stop-the-Worldの開始点）
 * - gc_mark_root: ルートから直接参照されるオブジェクトのマーク
 * - gc_mark_traverse: 参照グラフの探索によるマーク（トレーシング）
 * - gc_mark_complete: マークフェーズの完了
 * - gc_sweep / gc_sweep_free / gc_sweep_survive: スイープフェーズの各ステップ
 * - gc_complete: GCサイクルの完了（Stop-the-Worldの終了点）
 *
 * 【マーク&コンパクト固有】
 * - gc_compact_compute: 転送先アドレスの計算（フォワーディングポインタ設定）
 * - gc_compact_move: オブジェクトの物理的な移動
 * - gc_compact_update_ref: 移動に伴う参照の更新
 *
 * 【参照カウント固有】
 * - refcount_inc / refcount_dec: 参照カウントの増減
 * - refcount_free: 参照カウントが0になったオブジェクトの即時解放
 *
 * 【世代別GC固有】
 * - gen_minor_gc: Minor GC（Young世代のみ対象）の開始
 * - gen_promote: Young世代からOld世代への昇格（プロモーション）
 * - gen_major_gc: Major GC（全世代対象、フルGC）の開始
 */
export type EventType =
  | "alloc"
  | "root_set"
  | "ref_add"
  | "ref_remove"
  | "gc_start"
  | "gc_mark_root"
  | "gc_mark_traverse"
  | "gc_mark_complete"
  | "gc_sweep"
  | "gc_sweep_free"
  | "gc_sweep_survive"
  | "gc_compact_compute"
  | "gc_compact_move"
  | "gc_compact_update_ref"
  | "gc_complete"
  | "refcount_inc"
  | "refcount_dec"
  | "refcount_free"
  | "gen_minor_gc"
  | "gen_promote"
  | "gen_major_gc";

/**
 * シミュレーションイベント
 *
 * GCシミュレーションの各ステップで発生したイベントの記録。
 * UIでステップ実行やイベントログの表示に使用する。
 * 各イベントはその時点のヒープとルートのスナップショットを保持しており、
 * 任意の時点のメモリ状態を再現できる。
 */
export interface SimEvent {
  /** アクションの通し番号（何番目の操作で発生したか） */
  step: number;
  /** イベントの種別 */
  type: EventType;
  /** イベントの日本語説明（UIのイベントログに表示） */
  description: string;
  /** このイベント発生時点のヒープの深いコピー（スナップショット） */
  heapSnapshot: HeapObject[];
  /** このイベント発生時点のルート集合の深いコピー（スナップショット） */
  rootSnapshot: GcRoot[];
  /** このイベントに関連するオブジェクトのID（UIでのハイライト表示用） */
  targetIds: string[];
}

/**
 * シミュレーション結果
 *
 * 全アクションの実行完了後に得られる最終結果。
 * イベントログ・最終状態・統計情報を含む。
 */
export interface SimulationResult {
  /** シミュレーション中に発生した全イベントの時系列リスト */
  events: SimEvent[];
  /** 全アクション実行後のヒープの最終状態（生存オブジェクト一覧） */
  finalHeap: HeapObject[];
  /** 全アクション実行後のルート集合の最終状態 */
  finalRoots: GcRoot[];
  /** GCの効率を示す統計情報 */
  stats: {
    /** 総割り当てバイト数（alloc操作で割り当てた累計） */
    totalAllocated: number;
    /** GCによって解放されたバイト数の累計 */
    totalFreed: number;
    /** GCが実行された回数 */
    gcCycles: number;
    /** ヒープサイズが最大だった時点のバイト数 */
    peakHeapSize: number;
    /** シミュレーション終了時のヒープサイズ（生存オブジェクトの合計） */
    finalHeapSize: number;
    /**
     * フラグメンテーション率（0.0〜1.0）
     * ヒープ上の使用アドレス範囲に対する空き領域の割合。
     * Mark-Compactではコンパクションにより0に近づく。
     * Mark-Sweepでは解放後に穴ができるため高くなりやすい。
     */
    fragmentationRatio: number;
  };
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  algorithm: GcAlgorithm;
  roots: GcRoot[];
  actions: HeapAction[];
}
