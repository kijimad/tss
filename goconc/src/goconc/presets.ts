import type { Preset } from "./types.js";

export const presets: Preset[] = [
  // 1. 基本goroutine
  {
    name: "1. goroutine — 基本的な並行実行",
    description: "go文で軽量スレッド(goroutine)を生成。初期スタック2KB、M:Nスケジューリング。main goroutineが終了すると全goroutineが停止。",
    ops: [
      { type: "go", id: 1, name: "worker1" },
      { type: "go", id: 2, name: "worker2" },
      { type: "go", id: 3, name: "worker3" },
      { type: "schedule" },
      { type: "goroutine_exit", goroutineId: 1 },
      { type: "goroutine_exit", goroutineId: 2 },
      { type: "goroutine_exit", goroutineId: 3 },
    ],
  },

  // 2. unbuffered channel
  {
    name: "2. unbuffered channel — 同期的なデータ受け渡し",
    description: "容量0のチャネル。送信者は受信者が来るまでブロック、受信者は送信者が来るまでブロック。goroutine間の同期ポイントとして機能。",
    ops: [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "go", id: 1, name: "sender" },
      { type: "go", id: 2, name: "receiver" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "hello" },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "world" },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
    ],
  },

  // 3. buffered channel
  {
    name: "3. buffered channel — 非同期バッファ付きチャネル",
    description: "容量N>0のバッファ付きチャネル。バッファに空きがある間は送信がブロックしない。バッファ満杯で送信ブロック、バッファ空で受信ブロック。",
    ops: [
      { type: "chan_make", id: 1, name: "jobs", capacity: 3 },
      { type: "go", id: 1, name: "producer" },
      { type: "go", id: 2, name: "consumer" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "job1" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "job2" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "job3" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "job4" },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
    ],
  },

  // 4. channel close + range
  {
    name: "4. channel close — チャネルのクローズとfor-range",
    description: "close()でチャネルをクローズ。クローズ後の受信はバッファ残を返し、空になるとzero-valueとfalse。受信待ちgoroutineは全て起こされる。",
    ops: [
      { type: "chan_make", id: 1, name: "ch", capacity: 2 },
      { type: "go", id: 1, name: "producer" },
      { type: "go", id: 2, name: "consumer" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "A" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "B" },
      { type: "chan_close", goroutineId: 1, chanId: 1 },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
    ],
  },

  // 5. select
  {
    name: "5. select — 複数チャネルの多重待ち",
    description: "select文で複数チャネルを同時に待機。readyなケースからランダムに1つ選択。defaultケースがあればブロックしない。タイムアウトパターン。",
    ops: [
      { type: "chan_make", id: 1, name: "ch1", capacity: 1 },
      { type: "chan_make", id: 2, name: "ch2", capacity: 1 },
      { type: "go", id: 1, name: "worker1" },
      { type: "go", id: 2, name: "worker2" },
      { type: "go", id: 3, name: "selector" },
      { type: "chan_send", goroutineId: 1, chanId: 1, value: "from ch1" },
      { type: "select", goroutineId: 3, cases: [
        { dir: "recv", chanId: 1 },
        { dir: "recv", chanId: 2 },
      ]},
      { type: "chan_send", goroutineId: 2, chanId: 2, value: "from ch2" },
      { type: "select", goroutineId: 3, cases: [
        { dir: "recv", chanId: 1 },
        { dir: "recv", chanId: 2 },
      ]},
      // defaultケース
      { type: "select", goroutineId: 3, cases: [
        { dir: "recv", chanId: 1 },
        { dir: "recv", chanId: 2 },
        { dir: "recv", chanId: 1, isDefault: true },
      ]},
    ],
  },

  // 6. sync.Mutex
  {
    name: "6. sync.Mutex — 排他ロック",
    description: "Mutex.Lock()でクリティカルセクションを保護。既にロック済みならブロック。Unlock()で次の待機goroutineにロックを渡す。",
    ops: [
      { type: "mutex_make", id: 1, name: "mu" },
      { type: "go", id: 1, name: "goroutine1" },
      { type: "go", id: 2, name: "goroutine2" },
      { type: "go", id: 3, name: "goroutine3" },
      { type: "mutex_lock", goroutineId: 1, mutexId: 1 },
      { type: "mutex_lock", goroutineId: 2, mutexId: 1 },
      { type: "mutex_lock", goroutineId: 3, mutexId: 1 },
      { type: "mutex_unlock", goroutineId: 1, mutexId: 1 },
      { type: "mutex_unlock", goroutineId: 2, mutexId: 1 },
      { type: "mutex_unlock", goroutineId: 3, mutexId: 1 },
    ],
  },

  // 7. sync.WaitGroup
  {
    name: "7. sync.WaitGroup — goroutine完了待ち",
    description: "Add(n)でカウンタ加算、Done()で減算、Wait()でカウンタ0まで待機。fan-outパターンでワーカー全員の完了を待つ定番。",
    ops: [
      { type: "wg_make", id: 1, name: "wg" },
      { type: "wg_add", wgId: 1, delta: 3 },
      { type: "go", id: 1, name: "worker1" },
      { type: "go", id: 2, name: "worker2" },
      { type: "go", id: 3, name: "worker3" },
      { type: "wg_wait", goroutineId: 0, wgId: 1 },
      { type: "wg_done", goroutineId: 1, wgId: 1 },
      { type: "wg_done", goroutineId: 2, wgId: 1 },
      { type: "wg_done", goroutineId: 3, wgId: 1 },
    ],
  },

  // 8. Fan-out / Fan-in パターン
  {
    name: "8. Fan-out / Fan-in — ワーカープールパターン",
    description: "1つのジョブチャネルから複数ワーカーが受信(fan-out)、各ワーカーが結果を結果チャネルに送信(fan-in)。並列処理の定番パターン。",
    ops: [
      { type: "chan_make", id: 1, name: "jobs", capacity: 5 },
      { type: "chan_make", id: 2, name: "results", capacity: 5 },
      { type: "go", id: 1, name: "worker1" },
      { type: "go", id: 2, name: "worker2" },
      { type: "go", id: 3, name: "worker3" },
      // producer: ジョブ送信
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "job-A" },
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "job-B" },
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "job-C" },
      // workers: 受信→処理→結果送信
      { type: "chan_recv", goroutineId: 1, chanId: 1 },
      { type: "chan_send", goroutineId: 1, chanId: 2, value: "result-A" },
      { type: "chan_recv", goroutineId: 2, chanId: 1 },
      { type: "chan_send", goroutineId: 2, chanId: 2, value: "result-B" },
      { type: "chan_recv", goroutineId: 3, chanId: 1 },
      { type: "chan_send", goroutineId: 3, chanId: 2, value: "result-C" },
      // main: 結果受信
      { type: "chan_recv", goroutineId: 0, chanId: 2 },
      { type: "chan_recv", goroutineId: 0, chanId: 2 },
      { type: "chan_recv", goroutineId: 0, chanId: 2 },
    ],
  },

  // 9. デッドロック検出
  {
    name: "9. デッドロック — 全goroutineブロック検出",
    description: "全goroutineがチャネル操作でブロックするとGoランタイムがデッドロックを検出。'fatal error: all goroutines are asleep — deadlock!'",
    ops: [
      { type: "chan_make", id: 1, name: "ch", capacity: 0 },
      { type: "go", id: 1, name: "blocked" },
      // main: unbufferedチャネルに送信（受信者なし）
      { type: "chan_send", goroutineId: 0, chanId: 1, value: "stuck" },
      // goroutine1も受信待ち
      { type: "chan_make", id: 2, name: "ch2", capacity: 0 },
      { type: "chan_recv", goroutineId: 1, chanId: 2 },
    ],
  },

  // 10. GMP スケジューラ
  {
    name: "10. GMP スケジューラ — GOMAXPROCS と P/M/G",
    description: "GoのGMPモデル: G(goroutine), M(OS Thread), P(Processor)。GOMAXPROCS=Pの数。各PがローカルランキューからGを取得して実行。M:Nスケジューリング。",
    ops: [
      { type: "set_gomaxprocs", n: 4 },
      { type: "go", id: 1, name: "compute1" },
      { type: "go", id: 2, name: "compute2" },
      { type: "go", id: 3, name: "compute3" },
      { type: "go", id: 4, name: "compute4" },
      { type: "go", id: 5, name: "compute5" },
      { type: "schedule" },
      { type: "schedule" },
      { type: "goroutine_exit", goroutineId: 1 },
      { type: "schedule" },
      { type: "goroutine_exit", goroutineId: 2 },
      { type: "goroutine_exit", goroutineId: 3 },
      { type: "goroutine_exit", goroutineId: 4 },
      { type: "goroutine_exit", goroutineId: 5 },
    ],
  },
];
