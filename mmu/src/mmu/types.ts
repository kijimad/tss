/**
 * ページ置換アルゴリズムの種別を定義する型。
 *
 * MMU（Memory Management Unit）では、物理メモリが不足した際にどのページを
 * 追い出す（エビクトする）かを決定するためにページ置換アルゴリズムを使用する。
 *
 * - "fifo"    : 先入れ先出し。最も早くロードされたページを追い出す。
 *               実装が簡単だが、Beladyの異常現象が発生しうる。
 * - "lru"     : 最近最も使われていない（Least Recently Used）ページを追い出す。
 *               時間的局所性を活用し、実用上優れた性能を示す。
 * - "clock"   : Second Chance アルゴリズム。参照ビットを使い、
 *               FIFOを改良した近似LRU。ハードウェア実装に適している。
 * - "optimal" : Beladyの最適アルゴリズム。将来最も長く使われないページを追い出す。
 *               理論上最適だが、将来のアクセスパターンが必要なため実装不可能。
 *               他のアルゴリズムの性能比較基準として使用される。
 */
export type ReplacementAlgo = "fifo" | "lru" | "clock" | "optimal";

/**
 * メモリアクセス種別を定義する型。
 *
 * CPUがメモリにアクセスする際の操作の種類を表す。
 * MMUはこの種別とページテーブルエントリの保護ビット（R/W/X）を照合し、
 * 不正なアクセスを検出すると保護違反（Protection Fault）を発生させる。
 *
 * - "read"    : データの読み取り（ロード命令に対応）
 * - "write"   : データの書き込み（ストア命令に対応）。ダーティビットがセットされる。
 * - "execute" : 命令の実行（命令フェッチに対応）。NXビットで制御される。
 */
export type AccessType = "read" | "write" | "execute";

/**
 * ページテーブルエントリ（PTE: Page Table Entry）。
 *
 * ページテーブルはMMUが仮想アドレスを物理アドレスに変換するための
 * 中核的なデータ構造である。各エントリは1つの仮想ページに対応し、
 * 物理フレームへのマッピング情報、状態ビット、保護ビットを保持する。
 *
 * 実際のハードウェアでは、ページテーブルはメインメモリ上に配置され、
 * CR3レジスタ（x86）やTTBR（ARM）がそのベースアドレスを指す。
 */
export interface PageTableEntry {
  /** 仮想ページ番号（VPN: Virtual Page Number）。仮想アドレスの上位ビットから算出される。 */
  vpn: number;
  /** 物理フレーム番号（PFN: Physical Frame Number）。-1は未マッピング状態を示す。 */
  pfn: number;
  /**
   * 有効（Present）ビット。
   * trueの場合、このページは物理メモリ上に存在する。
   * falseの場合、ディスク上にありアクセス時にページフォルトが発生する。
   */
  present: boolean;
  /**
   * ダーティ（Dirty / Modified）ビット。
   * trueの場合、ページに書き込みが行われたことを示す。
   * エビクト時にこのビットがtrueなら、ディスクへの書き戻し（ライトバック）が必要。
   */
  dirty: boolean;
  /**
   * 参照（Referenced / Accessed）ビット。
   * ページがアクセスされるとハードウェアにより自動的にセットされる。
   * Clockアルゴリズムではこのビットを利用してSecond Chanceを判定する。
   */
  referenced: boolean;
  /** 読み取り許可ビット（R）。falseの場合、読み取りアクセスで保護違反が発生する。 */
  readable: boolean;
  /** 書き込み許可ビット（W）。falseの場合、書き込みアクセスで保護違反が発生する。 */
  writable: boolean;
  /**
   * 実行許可ビット（X）。
   * falseの場合、NX（No-eXecute）保護が有効であり、命令実行で保護違反が発生する。
   * バッファオーバーフロー攻撃への対策として重要なセキュリティ機構。
   */
  executable: boolean;
  /** 最終アクセス時刻（論理タイムスタンプ）。LRU置換アルゴリズムで使用される。 */
  lastAccess: number;
  /** ロード時刻（論理タイムスタンプ）。FIFO置換アルゴリズムで使用される。 */
  loadTime: number;
}

/**
 * TLB（Translation Lookaside Buffer）エントリ。
 *
 * TLBはページテーブルの高速キャッシュであり、MMU内のハードウェアに実装される。
 * 仮想→物理アドレス変換のたびにメモリ上のページテーブルを参照すると遅いため、
 * 最近使われた変換結果をTLBにキャッシュすることで高速化する。
 *
 * TLBヒット時はメモリアクセス1回分のレイテンシで変換が完了するが、
 * TLBミス時はページテーブルウォーク（1段なら1回、2段なら2回のメモリアクセス）が必要。
 * このため、TLBヒット率はシステム性能に大きく影響する。
 */
export interface TlbEntry {
  /** 仮想ページ番号（検索キー） */
  vpn: number;
  /** 対応する物理フレーム番号（変換結果） */
  pfn: number;
  /** エントリの有効性。falseはエビクト等により無効化されたことを示す。 */
  valid: boolean;
  /** ダーティビット。TLBにもダーティ情報を保持し、書き戻しの必要性を追跡する。 */
  dirty: boolean;
  /** LRU用タイムスタンプ。TLBエビクト時に最も古いエントリを特定するために使用。 */
  lastAccess: number;
}

/**
 * 物理フレーム（Physical Frame / Page Frame）。
 *
 * 物理メモリはページサイズ（通常4KB、本シミュレータでは256B）単位の
 * フレームに分割される。各フレームには最大1つの仮想ページを格納できる。
 * 物理フレーム数は実装メモリ量に依存し、仮想ページ数より少ないのが一般的。
 * フレームが全て使用中の場合、新しいページをロードするにはページ置換が必要。
 */
export interface PhysicalFrame {
  /** 物理フレーム番号（PFN）。物理アドレス = PFN * ページサイズ + オフセット。 */
  pfn: number;
  /** 現在格納中の仮想ページ番号。-1は空きフレームを示す。 */
  vpn: number;
  /** フレームが使用中かどうか。falseなら即座にページをロード可能。 */
  occupied: boolean;
  /** 格納データの表示用文字列。UIでのフレーム内容の可視化に使用。 */
  data: string;
}

/**
 * メモリアクセス命令。
 *
 * CPUが発行するメモリアクセス要求を表す。
 * 仮想アドレスはMMUにより物理アドレスに変換され、
 * アクセス種別に基づいて保護ビットのチェックが行われる。
 */
export interface MemoryAccess {
  /**
   * 仮想アドレス。
   * MMUによって VPN（仮想ページ番号）とオフセットに分解される。
   * 例: ページサイズ256Bの場合、アドレス0x0A0Aは VPN=0x0A, オフセット=0x0A。
   */
  virtualAddress: number;
  /** アクセス種別（読み取り / 書き込み / 実行） */
  accessType: AccessType;
  /** 書き込みデータ（write時のみ使用）。シミュレーション上の表示用。 */
  data?: string;
}

/**
 * シミュレーションイベント種別。
 *
 * MMUのアドレス変換過程で発生する各ステップをイベントとして記録する。
 * これにより、UIでアドレス変換の詳細な過程をステップバイステップで可視化できる。
 *
 * アドレス変換の典型的な流れ:
 * 1. access_start    → アクセス開始
 * 2. addr_split      → 仮想アドレスをVPN+オフセットに分解
 * 3. tlb_lookup      → TLBを検索
 * 4. tlb_hit/miss    → TLBヒットまたはミス
 * 5. pt_walk(_l2/l1) → ミス時はページテーブルウォーク
 * 6. page_fault      → ページが物理メモリにない場合
 * 7. page_evict      → フレーム不足時のページ追い出し
 * 8. page_load       → ディスクからページをロード
 * 9. tlb_update      → TLBに変換結果を登録
 * 10. physical_access → 物理アドレスにアクセス
 * 11. access_complete → アクセス完了
 */
export type EventType =
  | "access_start"       // メモリアクセス開始
  | "addr_split"         // 仮想アドレスをVPN+オフセットに分解
  | "tlb_lookup"         // TLB検索開始
  | "tlb_hit"            // TLBヒット（高速パス）
  | "tlb_miss"           // TLBミス（ページテーブルウォークが必要）
  | "pt_walk"            // 1段ページテーブルウォーク
  | "pt_walk_l2"         // 2段ページテーブル: L2（上位）テーブル参照
  | "pt_walk_l1"         // 2段ページテーブル: L1（下位）テーブル参照
  | "pt_hit"             // ページテーブルヒット（ページが物理メモリに存在）
  | "page_fault"         // ページフォルト（ページが物理メモリにない）
  | "page_load"          // ディスクからページをフレームにロード
  | "page_evict"         // クリーンページのエビクト（書き戻し不要）
  | "page_evict_dirty"   // ダーティページのエビクト（ディスクへの書き戻しが必要）
  | "clock_scan"         // Clockアルゴリズムの針の走査（参照ビットクリア）
  | "frame_alloc"        // 物理フレームの割り当て
  | "tlb_update"         // TLBエントリの追加・更新
  | "tlb_evict"          // TLBエントリのエビクト（容量不足またはページ無効化）
  | "access_complete"    // メモリアクセス完了
  | "protection_fault"   // 保護違反（権限チェック失敗）
  | "physical_access"    // 物理メモリへの実アクセス
  | "dirty_set";         // ダーティビットのセット（書き込みアクセス時）

/**
 * シミュレーションイベント。
 *
 * MMUのアドレス変換過程の各ステップを記録するデータ構造。
 * UIではこれをタイムライン形式で表示し、変換過程を可視化する。
 */
export interface SimEvent {
  /** イベントのステップ番号（何回目のメモリアクセスで発生したか） */
  step: number;
  /** イベント種別 */
  type: EventType;
  /** イベントの説明文（日本語） */
  description: string;
  /** UIでハイライト表示する対象のVPN/PFN。関連するテーブル行を強調するために使用。 */
  highlight?: { vpn?: number; pfn?: number };
}

/**
 * MMU（Memory Management Unit）の設定パラメータ。
 *
 * シミュレーションの動作を制御する設定値を定義する。
 * 各プリセットはこの設定を変えることで、異なるMMU構成での動作を実験できる。
 */
export interface MmuConfig {
  /**
   * ページサイズ（バイト）。2のべき乗である必要がある。
   * 典型的な値は4096（4KB）。本シミュレータでは256Bを使用し、
   * アドレス空間を小さく保つことで動作を理解しやすくしている。
   * ページサイズが大きいほどページテーブルは小さくなるが、内部断片化が増える。
   */
  pageSize: number;
  /**
   * 仮想アドレス空間のビット数。
   * 例: 16ビットなら仮想アドレス空間は 0x0000〜0xFFFF（64KB）。
   * 実際のx86-64では48ビット（256TB）の仮想アドレス空間を持つ。
   */
  virtualBits: number;
  /**
   * 物理フレーム数。物理メモリの総容量 = physicalFrames * pageSize。
   * 仮想ページ数より少ない場合、ページ置換が発生する（デマンドページングの基本）。
   */
  physicalFrames: number;
  /**
   * TLBエントリ数。TLBの容量を決定する。
   * 一般的なCPUでは64〜1024エントリ程度。
   * 小さい値にすることでTLBミスの発生とその影響を観察できる。
   */
  tlbSize: number;
  /** ページ置換アルゴリズム（FIFO / LRU / Clock / Optimal） */
  replacementAlgo: ReplacementAlgo;
  /**
   * 2段（マルチレベル）ページテーブルを使用するかどうか。
   * trueの場合、VPNをL2インデックスとL1インデックスに分割し、
   * 2段階でページテーブルを参照する。大きなアドレス空間で
   * ページテーブルのメモリ使用量を削減するために使われる技術。
   * 実際のx86-64では4段ページテーブルが使用される。
   */
  twoLevel: boolean;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  pageTable: PageTableEntry[];
  tlb: TlbEntry[];
  frames: PhysicalFrame[];
  stats: {
    totalAccesses: number;
    tlbHits: number;
    tlbMisses: number;
    pageFaults: number;
    pageEvictions: number;
    dirtyWritebacks: number;
    protectionFaults: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  config: MmuConfig;
  /** 初期ページ権限設定 [vpn, readable, writable, executable] */
  permissions: [number, boolean, boolean, boolean][];
  accesses: MemoryAccess[];
}
