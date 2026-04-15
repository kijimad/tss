/*
 * UNIX セマフォ シミュレーター 型定義
 *
 * Dijkstra（ダイクストラ）が1965年に提案したセマフォの概念を
 * TypeScriptでモデル化するための型定義ファイル。
 *
 * セマフォは、共有リソースへの同時アクセスを制御するための
 * 同期プリミティブである。内部に非負整数カウンタを持ち、
 * P操作（wait / down）とV操作（signal / up）の2つのアトミック操作で
 * プロセス間の排他制御や同期を実現する。
 *
 * このシミュレーターでは以下のPOSIXセマフォAPIを模倣する:
 *   - sem_init: 無名セマフォの初期化
 *   - sem_open: 名前付きセマフォのオープン（プロセス間共有用）
 *   - sem_wait: P操作（値が0ならブロック）
 *   - sem_trywait: ノンブロッキングP操作（失敗時にEAGAINを返す）
 *   - sem_timedwait: タイムアウト付きP操作（ETIMEDOUT）
 *   - sem_post: V操作（値をインクリメント、待ちプロセスを起床）
 *   - sem_getvalue: セマフォの現在値を取得
 *   - sem_close: 名前付きセマフォのクローズ
 *   - sem_destroy: 無名セマフォの破棄
 */

/**
 * プロセス/スレッドID
 *
 * POSIXにおけるpid_tやpthread_tに相当する識別子。
 * メインプロセスはpid=0、子プロセスは1から昇順で割り当てられる。
 */
export type Pid = number;

/**
 * プロセス状態
 *
 * OSのプロセス状態遷移モデルを簡略化したもの:
 *   - "ready": 実行可能状態（CPUの割り当てを待っている）
 *   - "running": 実行中（CPUを使用中）
 *   - "blocked": 待ち状態（セマフォ待ち、sleep、join待ちなどでブロック中）
 *   - "terminated": 終了状態（exit済み）
 */
export type ProcessState = "ready" | "running" | "blocked" | "terminated";

/**
 * ブロック理由
 *
 * プロセスがblocked状態になった原因を示す:
 *   - "sem_wait": sem_waitまたはsem_timedwaitでセマフォ待ち中
 *   - "sleep": sleep命令で指定ティック数だけ休止中
 *   - "join": 他プロセスの終了待ち（pthread_joinに相当）
 */
export type BlockReason = "sem_wait" | "sleep" | "join";

/**
 * プロセス/スレッド
 *
 * シミュレーション内のプロセス（スレッド）を表す構造体。
 * 各プロセスは独自のプログラムカウンタ(pc)とローカル変数を持ち、
 * 共有変数やセマフォを通じて他プロセスと相互作用する。
 */
export interface Process {
  /** プロセスID（一意な識別子） */
  pid: Pid;
  /** プロセス名（デバッグ表示用） */
  name: string;
  /** 現在のプロセス状態 */
  state: ProcessState;
  /** プログラムカウンタ（次に実行する命令のインデックス） */
  pc: number;
  /** ブロック理由（blocked状態のときのみ設定される） */
  blockReason?: BlockReason;
  /** ブロックの詳細情報（待っているセマフォ名やsleep残りティック数など） */
  blockDetail?: string;
  /** join待ちの対象プロセスID（blockReason="join"のとき設定） */
  joinTarget?: Pid;
  /** CPU使用時間（実際に命令を実行したティック数の累計） */
  cpuTime: number;
  /** 待ち時間（blocked状態で過ごしたティック数の累計） */
  waitTime: number;
  /** ローカル変数テーブル（sem_getvalueやread命令の結果を格納） */
  locals: Record<string, number>;
}

/**
 * セマフォ種別
 *
 *   - "counting": カウンティングセマフォ（値は0以上の任意の整数）
 *     同時にN個のプロセスがリソースにアクセスできるよう制御する。
 *     例: 接続プール、バッファスロット数の管理
 *
 *   - "binary": バイナリセマフォ（値は0または1のみ）
 *     ミューテックス（mutex）の代替として排他制御に使用する。
 *     sem_postで値が1を超えることはない。
 */
export type SemType = "counting" | "binary";

/**
 * セマフォ
 *
 * Dijkstraのセマフォをモデル化した構造体。
 * 内部カウンタ(value)と待ちキュー(waitQueue)を持つ。
 *
 * P操作（sem_wait）:
 *   value > 0 → valueをデクリメントして通過（クリティカルセクションに入る）
 *   value == 0 → プロセスを待ちキューに追加してブロック
 *
 * V操作（sem_post）:
 *   待ちキューが空でない → 先頭プロセスを起床（FIFO順）
 *   待ちキューが空 → valueをインクリメント
 */
export interface Semaphore {
  /** セマフォ名（POSIXの名前付きセマフォではスラッシュ始まり: "/my_sem"） */
  name: string;
  /** 現在の値（0以上。0のときsem_waitを呼ぶとブロックされる） */
  value: number;
  /** 初期値（sem_initまたはsem_openで指定された値） */
  initialValue: number;
  /** 種別（カウンティング or バイナリ） */
  type: SemType;
  /** 待ちキュー（sem_waitでブロックされたプロセスのPID、FIFO順） */
  waitQueue: Pid[];
  /** 名前付きセマフォか（sem_openで作成された場合true、プロセス間共有可能） */
  named: boolean;
  /** 累計post回数（V操作の実行回数、統計用） */
  postCount: number;
  /** 累計wait回数（P操作の実行回数、統計用） */
  waitCount: number;
}

/**
 * 共有変数
 *
 * 複数プロセスが共有するメモリ上の変数を表す。
 * セマフォによる適切な同期なしにアクセスすると
 * 競合状態（レースコンディション）が発生する可能性がある。
 */
export interface SharedVar {
  /** 変数名 */
  name: string;
  /** 現在の値 */
  value: number;
  /** 最後に書き込みを行ったプロセスのPID（null=未書き込み） */
  lastWriter: Pid | null;
  /** 全アクセス履歴（競合状態の分析に使用） */
  accessLog: AccessLog[];
}

/**
 * アクセスログ
 *
 * 共有変数への個々のアクセスを記録する。
 * 異なるプロセスからの同一変数への読み書き順序を追跡し、
 * 競合状態の検出・可視化に利用する。
 */
export interface AccessLog {
  /** アクセスしたプロセスのPID */
  pid: Pid;
  /** 操作種別（読み取りまたは書き込み） */
  op: "read" | "write";
  /** 読み取った値 or 書き込んだ値 */
  value: number;
  /** アクセス時点のシミュレーションティック */
  tick: number;
}

/**
 * 命令（シミュレーション用命令セット）
 *
 * セマフォ操作、プロセス管理、共有変数操作、制御命令を
 * 判別共用体（tagged union）で表現する。
 * 各プロセスはこの命令列を順番に実行する。
 *
 * セマフォ操作:
 *   - sem_init: 無名セマフォの初期化（POSIX sem_init相当）
 *   - sem_open: 名前付きセマフォのオープン（POSIX sem_open相当）
 *   - sem_wait: P操作 / ダウン操作（POSIX sem_wait相当）
 *   - sem_trywait: ノンブロッキングP操作（POSIX sem_trywait相当、失敗時EAGAIN）
 *   - sem_timedwait: タイムアウト付きP操作（POSIX sem_timedwait相当、ETIMEDOUT）
 *   - sem_post: V操作 / アップ操作（POSIX sem_post相当）
 *   - sem_getvalue: セマフォ値の取得（POSIX sem_getvalue相当）
 *   - sem_close: 名前付きセマフォのクローズ（POSIX sem_close相当）
 *   - sem_destroy: 無名セマフォの破棄（POSIX sem_destroy相当）
 *
 * プロセス管理:
 *   - create: 子プロセス/スレッドの生成（pthread_create相当）
 *   - join: 子プロセスの終了待ち（pthread_join相当）
 *   - exit: プロセスの終了
 *   - sleep: 指定ティック数だけ休止
 *   - yield: CPUを明け渡す（sched_yield相当）
 *
 * 共有変数操作:
 *   - read: 共有変数の値をローカル変数に読み込み
 *   - write: 共有変数に値を書き込み
 *   - increment: 共有変数をアトミックでないインクリメント（read→加算→write）
 *   - decrement: 共有変数をアトミックでないデクリメント（read→減算→write）
 *
 * その他:
 *   - comment: UI上に表示するコメント（実行には影響しない）
 */
export type SemInstr =
  | { op: "sem_init"; name: string; value: number; type?: SemType }
  | { op: "sem_open"; name: string; value: number }
  | { op: "sem_wait"; name: string }
  | { op: "sem_trywait"; name: string }
  | { op: "sem_timedwait"; name: string; timeout: number }
  | { op: "sem_post"; name: string }
  | { op: "sem_getvalue"; name: string; into: string }
  | { op: "sem_close"; name: string }
  | { op: "sem_destroy"; name: string }
  | { op: "create"; name: string; instructions: SemInstr[] }
  | { op: "join"; pid: Pid }
  | { op: "read"; varName: string; into: string }
  | { op: "write"; varName: string; value: number }
  | { op: "increment"; varName: string }
  | { op: "decrement"; varName: string }
  | { op: "sleep"; ticks: number }
  | { op: "yield" }
  | { op: "exit"; code?: number }
  | { op: "comment"; text: string };

/**
 * シミュレーション設定
 *
 * スケジューラの挙動とシミュレーションの上限を制御する。
 */
export interface SimConfig {
  /**
   * スケジューリングアルゴリズム:
   *   - "round_robin": ラウンドロビン方式（タイムスライスごとにプロセスを切り替え）
   *   - "fifo": 先入先出方式（プロセスが自発的にCPUを手放すまで実行を継続）
   */
  scheduler: "round_robin" | "fifo";
  /** タイムスライス（ラウンドロビン時、何ティックで強制的にコンテキストスイッチするか） */
  timeSlice: number;
  /** シミュレーションの最大ティック数（無限ループ防止用の安全装置） */
  maxTicks: number;
}

/**
 * シミュレーション操作
 *
 * 1回のシミュレーション実行に必要な全情報をまとめた構造体。
 * 設定、共有変数の初期状態、メインプロセスの命令列を含む。
 */
export interface SimOp {
  /** 操作種別（現在は"execute"のみ対応） */
  type: "execute";
  /** シミュレーション設定 */
  config: SimConfig;
  /** 共有変数の初期定義リスト */
  sharedVars: { name: string; value: number }[];
  /** メインプロセス（pid=0）が実行する命令列 */
  mainInstructions: SemInstr[];
}

/**
 * イベント種別
 *
 * シミュレーション中に発生する注目すべきイベントの分類:
 *   - "create": プロセス生成イベント
 *   - "terminate": プロセス終了イベント
 *   - "schedule": スケジューラによるプロセス切り替え（コンテキストスイッチ）
 *   - "sem_wait": P操作の成功（セマフォ値のデクリメント）
 *   - "sem_post": V操作の成功（セマフォ値のインクリメント）
 *   - "sem_block": P操作によるブロック（セマフォ値が0のためプロセスが待機）
 *   - "sem_wakeup": V操作による待ちプロセスの起床
 *   - "sem_trywait_fail": sem_trywaitの失敗（EAGAIN）
 *   - "sem_timedout": sem_timedwaitのタイムアウト（ETIMEDOUT）
 *   - "deadlock": デッドロック検出
 *   - "race": 競合状態の検出
 *   - "comment": ユーザー定義コメント
 */
export type EventType =
  | "create" | "terminate" | "schedule"
  | "sem_wait" | "sem_post" | "sem_block" | "sem_wakeup"
  | "sem_trywait_fail" | "sem_timedout"
  | "deadlock" | "race" | "comment";

/**
 * シミュレーションイベント
 *
 * シミュレーション実行中に記録される個々のイベント。
 * ブラウザUI上のイベントログパネルに時系列で表示される。
 */
export interface SimEvent {
  /** イベントの種別 */
  type: EventType;
  /** イベントが発生したシミュレーションティック */
  tick: number;
  /** 人間が読めるイベントの説明文 */
  message: string;
}

/**
 * 1ティックの結果
 *
 * シミュレーションの各ステップ（1命令実行後）における
 * 全プロセス・セマフォ・共有変数のスナップショット。
 * ブラウザUIでステップ実行や再生時に各ステップの状態を表示するために使用する。
 */
export interface TickResult {
  /** シミュレーションティック番号 */
  tick: number;
  /** このティックで命令を実行したプロセスのPID（nullなら該当なし） */
  runningPid: Pid | null;
  /** このティックで実行された命令 */
  instruction?: SemInstr;
  /** 全プロセスの状態スナップショット（ディープコピー） */
  processes: Process[];
  /** 全セマフォの状態スナップショット（ディープコピー） */
  semaphores: Semaphore[];
  /** 全共有変数の状態スナップショット（ディープコピー） */
  sharedVars: SharedVar[];
  /** このティックの実行結果メッセージ */
  message: string;
  /** 警告メッセージ（デッドロックなど異常時に設定される） */
  warning?: string;
}

/**
 * シミュレーション結果
 *
 * シミュレーション全体の実行結果を格納する構造体。
 * 全ティックの状態履歴と発生イベント一覧を含む。
 */
export interface SimulationResult {
  /** 全ティックの状態スナップショット配列（時系列順） */
  ticks: TickResult[];
  /** シミュレーション中に発生した全イベント（時系列順） */
  events: SimEvent[];
  /** デッドロックが検出されたかどうか */
  deadlockDetected: boolean;
}

/**
 * プリセット
 *
 * セレクトボックスから選択可能な実験シナリオの定義。
 * 各プリセットはセマフォの代表的なユースケース
 * （生産者・消費者問題、読者・書者問題、食事する哲学者問題など）を
 * エミュレートする。
 */
export interface Preset {
  /** プリセット名（UI上のセレクトボックスに表示される） */
  name: string;
  /** プリセットの説明文 */
  description: string;
  /** シミュレーション操作列を構築するファクトリ関数 */
  build: () => SimOp[];
}
