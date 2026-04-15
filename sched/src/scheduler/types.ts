/**
 * CPUスケジューリングシミュレータの型定義モジュール
 *
 * このファイルでは、スケジューラシミュレーションに必要な全データ構造を定義する。
 * プロセスのライフサイクル（到着→レディ→実行→ブロック→終了）を表現し、
 * ガントチャートやタイムラインイベントを通じてスケジューリングの挙動を可視化する。
 */

/**
 * プロセスの状態遷移を表す型
 *
 * - "ready"     : レディキューで CPU 割り当てを待機中
 * - "running"   : CPU 上で実行中（単一CPUモデルのため同時に1つだけ）
 * - "blocked"   : I/Oバースト中で CPU を使用できない状態
 * - "terminated": 全バーストを完了し実行終了した状態
 */
export type ProcessState = "ready" | "running" | "blocked" | "terminated";

/**
 * サポートするCPUスケジューリングアルゴリズムの列挙型
 *
 * 各アルゴリズムの特徴：
 * - fcfs         : 先着順（First Come First Served）。非プリエンプティブ。
 *                  最もシンプルだが、コンボイ効果（長いプロセスが後続を待たせる）が発生しやすい。
 * - sjf          : 最短ジョブ優先（Shortest Job First）。非プリエンプティブ。
 *                  平均待ち時間を最小化するが、長いプロセスが飢餓（starvation）に陥る可能性がある。
 * - srtf         : 最短残余時間優先（Shortest Remaining Time First）。SJFのプリエンプティブ版。
 *                  より短い残り時間のプロセスが到着すると実行中プロセスを中断する。
 * - rr           : ラウンドロビン（Round Robin）。タイムクォンタムで区切り公平にCPU時間を配分。
 *                  対話型システムに適しているが、クォンタムの設定がスループットに影響する。
 * - priority     : 優先度スケジューリング（非プリエンプティブ）。優先度値が小さいほど高優先。
 *                  低優先度プロセスの飢餓が問題となる。エイジング（aging）で緩和可能。
 * - priority_pre : 優先度スケジューリング（プリエンプティブ）。高優先度プロセス到着時に即座に切替。
 * - mlfq         : マルチレベルフィードバックキュー（Multi-Level Feedback Queue）。
 *                  複数レベルのキューを持ち、CPU使用量に応じてプロセスを降格（demote）する。
 *                  対話型プロセスを高優先度に保ちつつ、バッチプロセスも実行できる。
 */
export type Algorithm =
  | "fcfs"           // 先着順スケジューリング
  | "sjf"            // 最短ジョブ優先（非プリエンプティブ）
  | "srtf"           // 最短残余時間優先（プリエンプティブ）
  | "rr"             // ラウンドロビン
  | "priority"       // 優先度スケジューリング（非プリエンプティブ）
  | "priority_pre"   // 優先度スケジューリング（プリエンプティブ）
  | "mlfq";          // マルチレベルフィードバックキュー

/**
 * プロセス定義（静的な入力情報）
 *
 * スケジューリングシミュレーションに投入するプロセスの仕様を表す。
 * cpuBurstsとioBurstsは交互に実行される：
 *   cpuBursts[0] → ioBursts[0] → cpuBursts[1] → ioBursts[1] → ...
 *
 * 例: cpuBursts=[3, 2], ioBursts=[4] の場合
 *   CPU実行3tick → I/O待ち4tick → CPU実行2tick → 終了
 */
export interface ProcessDef {
  /** プロセスID（一意な識別子） */
  pid: number;
  /** プロセス名（表示用） */
  name: string;
  /** 到着時刻（レディキューに入る時刻。0始まりのtick単位） */
  arrivalTime: number;
  /**
   * CPUバースト時間のリスト（I/Oバーストと交互に実行される）
   * CPUバースト＝プロセスがCPU上で連続して実行する時間の単位
   */
  cpuBursts: number[];
  /**
   * I/Oバースト時間のリスト
   * I/Oバースト＝プロセスがI/O操作を待っている時間の単位
   * cpuBursts.length - 1 個以下の要素を持つ
   */
  ioBursts: number[];
  /** 優先度（0が最高優先度、数値が大きいほど低優先度） */
  priority: number;
}

/**
 * 実行中のプロセスのランタイム状態
 *
 * シミュレーション中にプロセスの動的な状態を追跡する。
 * 各tickでスケジューラがこの情報を参照してスケジューリング判断を行う。
 */
export interface ProcessRuntime {
  /** このランタイムに対応するプロセスの静的定義 */
  def: ProcessDef;
  /** 現在のプロセス状態（ready/running/blocked/terminated） */
  state: ProcessState;
  /**
   * 現在のCPUバーストインデックス
   * cpuBursts配列内の何番目のバーストを実行中かを示す
   */
  burstIndex: number;
  /**
   * 現在のCPUバーストの残り実行時間（tick単位）
   * SRTF等のプリエンプティブアルゴリズムで比較に使用される
   */
  remainingBurst: number;
  /**
   * 最初にCPU上で実行された時刻（レスポンスタイム計算用）
   * レスポンスタイム ＝ firstRunTime - arrivalTime
   * まだ一度も実行されていなければnull
   */
  firstRunTime: number | null;
  /** プロセスが全バーストを完了して終了した時刻。未完了ならnull */
  finishTime: number | null;
  /**
   * 累積待ち時間（レディキューで待機していたtick数の合計）
   * 待ち時間が大きいほど、そのプロセスはCPU割り当てを長く待たされたことを意味する
   */
  waitTime: number;
  /**
   * I/O完了予定時刻
   * プロセスがblocked状態の時、I/Oが完了してreadyに戻る時刻を示す
   */
  ioCompleteTime: number | null;
  /**
   * MLFQにおける現在のキューレベル（0が最高優先度）
   * タイムスライスを使い切るたびに降格（demote）される
   */
  queueLevel: number;
  /**
   * 現在のタイムスライス内で消費したtick数
   * RRやMLFQでタイムクォンタム到達を判定するために使用
   */
  sliceUsed: number;
}

/**
 * スケジューラ設定
 *
 * シミュレーションで使用するアルゴリズムとそのパラメータを指定する。
 * タイムクォンタムはRRとMLFQで使用され、値が小さいほどコンテキストスイッチが頻繁に発生するが
 * レスポンスタイムは改善される。逆に大きい値はスループット向上に寄与する。
 */
export interface SchedulerConfig {
  /** 使用するスケジューリングアルゴリズム */
  algorithm: Algorithm;
  /**
   * タイムクォンタム（RR, MLFQ用）
   * プロセスがプリエンプションされるまでに連続使用できるCPU時間（tick数）
   */
  timeQuantum: number;
  /**
   * MLFQのキューレベル数
   * レベル0が最高優先度、レベル(mlfqLevels-1)が最低優先度
   */
  mlfqLevels: number;
  /**
   * MLFQの各レベルごとのタイムクォンタム
   * 通常、低優先度キューほどクォンタムを大きくする（例: [2, 4, 8]）
   * これにより、CPU集約型プロセスは降格後により長く実行でき、スイッチオーバーヘッドを軽減する
   */
  mlfqQuantums: number[];
}

/**
 * タイムラインイベント
 *
 * シミュレーション中に発生した各イベントを記録する。
 * これらのイベントはUI上でイベントログとして時系列表示される。
 *
 * イベント種別：
 * - arrive        : プロセスがレディキューに到着した
 * - dispatch      : プロセスがCPUに割り当てられ実行開始した
 * - preempt       : 実行中プロセスがCPUから追い出された（プリエンプション）
 * - block_io      : CPUバースト完了後、I/O待ちに入った
 * - io_complete   : I/O完了し、レディキューに復帰した
 * - terminate     : プロセスが全処理を完了し終了した
 * - idle          : CPUがアイドル状態（実行可能プロセスなし）
 * - queue_demote  : MLFQ内でキューレベルが降格された
 * - context_switch: コンテキストスイッチ（CPU上のプロセス切り替え）が発生した
 */
export interface TimelineEvent {
  /** イベント発生時刻（tick単位） */
  time: number;
  /** イベント種別 */
  type:
    | "arrive"         // プロセス到着
    | "dispatch"       // CPUにディスパッチ
    | "preempt"        // プリエンプション（CPU横取り）
    | "block_io"       // I/Oブロック（CPU → I/O待ち）
    | "io_complete"    // I/O完了（I/O待ち → レディキュー）
    | "terminate"      // プロセス終了
    | "idle"           // CPUアイドル
    | "queue_demote"   // MLFQキュー降格
    | "context_switch"; // コンテキストスイッチ発生
  /** 関連するプロセスID（アイドルイベント時はundefined） */
  pid?: number;
  /** 日本語の説明文（UI表示用） */
  description: string;
}

/**
 * ガントチャートのエントリ
 *
 * ガントチャートはCPUの使用状況を時間軸上で可視化したもの。
 * 各エントリは、ある時間区間にどのプロセスがCPUを使用していたかを表す。
 */
export interface GanttEntry {
  /** 実行していたプロセスのID。nullの場合はCPUアイドル状態 */
  pid: number | null;
  /** プロセス名またはアイドル表示文字列 */
  name: string;
  /** 実行開始時刻（tick単位） */
  start: number;
  /** 実行終了時刻（tick単位） */
  end: number;
}

/**
 * プロセスごとのスケジューリング統計
 *
 * スケジューリングアルゴリズムの性能評価に使う主要メトリクス：
 * - ターンアラウンドタイム（TAT）: プロセスの到着から終了までの総経過時間
 *     TAT = finishTime - arrivalTime
 * - 待ち時間: レディキューで待機していた合計時間（I/O待ちは含まない）
 * - レスポンスタイム: 到着してから最初にCPU実行されるまでの時間
 *     responseTime = firstRunTime - arrivalTime
 */
export interface ProcessStats {
  /** プロセスID */
  pid: number;
  /** プロセス名 */
  name: string;
  /** 到着時刻 */
  arrivalTime: number;
  /** 完了時刻 */
  finishTime: number;
  /**
   * ターンアラウンドタイム（到着から完了までの経過時間）
   * 小さいほどプロセスが早く完了したことを意味する
   */
  turnaroundTime: number;
  /**
   * 待ち時間（レディキューで待っていた合計tick数）
   * SJFは理論上この値の平均を最小化するアルゴリズムである
   */
  waitTime: number;
  /**
   * レスポンスタイム（到着から最初のCPU実行までの時間）
   * 対話型システムではこの値が小さいことが重要
   */
  responseTime: number;
}

/**
 * シミュレーション結果
 *
 * スケジューラエンジンの実行結果をまとめた構造体。
 * ガントチャート、イベントログ、プロセスごとの統計、およびシステム全体のメトリクスを含む。
 * UIはこの結果を受け取り、ブラウザ上にスケジューリングの挙動を可視化する。
 */
export interface SimulationResult {
  /** 使用されたスケジューリングアルゴリズム */
  algorithm: Algorithm;
  /** シミュレーションに使用した設定 */
  config: SchedulerConfig;
  /** ガントチャート（CPUの時間軸上の使用状況） */
  gantt: GanttEntry[];
  /** タイムラインイベント（シミュレーション中に発生した全イベントの時系列記録） */
  events: TimelineEvent[];
  /** プロセスごとの個別統計 */
  processStats: ProcessStats[];
  /**
   * 平均ターンアラウンドタイム
   * 全プロセスのターンアラウンドタイムの算術平均
   */
  avgTurnaround: number;
  /**
   * 平均待ち時間
   * 全プロセスの待ち時間の算術平均。アルゴリズムの効率比較に最もよく使われる指標
   */
  avgWait: number;
  /**
   * 平均レスポンスタイム
   * 全プロセスのレスポンスタイムの算術平均。対話型システムの応答性の指標
   */
  avgResponse: number;
  /**
   * CPU利用率（%）
   * CPUがプロセスを実行していた時間の割合。100%に近いほどCPUを有効活用している
   * cpuUtilization = (busyTime / totalTime) * 100
   */
  cpuUtilization: number;
  /** シミュレーション総時間（tick数） */
  totalTime: number;
}
