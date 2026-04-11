import type { Preset } from "./types.js";

export const presets: Preset[] = [
  {
    name: "基本: stdioバッファリング3モード比較",
    description: "unbuffered (stderr)、line-buffered (stdout→端末)、fully-buffered (ファイル) の動作の違い",
    ops: [
      // stderr: unbuffered
      { type: "open", fd: 2, path: "/dev/stderr", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "setvbuf", fd: 2, mode: "unbuffered", size: 0 },
      { type: "printf", fd: 2, text: "error!\n" },

      // stdout → 端末: line-buffered
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "printf", fd: 1, text: "hello " },
      { type: "printf", fd: 1, text: "world\n" },

      // ファイル: fully-buffered
      { type: "open", fd: 3, path: "/tmp/output.log", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      { type: "printf", fd: 3, text: "line 1\n" },
      { type: "printf", fd: 3, text: "line 2\n" },
      { type: "printf", fd: 3, text: "line 3\n" },
      { type: "fflush", fd: 3 },
      { type: "close", fd: 3 },
    ],
  },
  {
    name: "行バッファの改行タイミング",
    description: "行バッファモードで改行があるまでデータが蓄積される仕組み",
    ops: [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      // 改行なし → バッファに蓄積
      { type: "printf", fd: 1, text: "Loading" },
      { type: "printf", fd: 1, text: "..." },
      { type: "printf", fd: 1, text: "..." },
      // 改行で一括フラッシュ
      { type: "printf", fd: 1, text: " done!\n" },
      // 次の行
      { type: "printf", fd: 1, text: "Processing" },
      { type: "printf", fd: 1, text: "..." },
      // 明示的fflushで強制出力
      { type: "fflush", fd: 1 },
    ],
  },
  {
    name: "フルバッファ満杯 → 自動フラッシュ",
    description: "フルバッファモードでバッファが満杯になった時の自動フラッシュ動作",
    ops: [
      { type: "open", fd: 3, path: "/tmp/data.bin", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      { type: "setvbuf", fd: 3, mode: "fully_buffered", size: 32 },
      // 32Bバッファに少しずつ書き込み
      { type: "fwrite", fd: 3, data: "AAAAAAAAAA", size: 10 },
      { type: "fwrite", fd: 3, data: "BBBBBBBBBB", size: 10 },
      { type: "fwrite", fd: 3, data: "CCCCCCCCCC", size: 10 },
      // ↑ ここで30B → まだ満杯でない
      { type: "fwrite", fd: 3, data: "DD", size: 2 },
      // ↑ 32B → 満杯 → 自動フラッシュ!
      { type: "fwrite", fd: 3, data: "EEEEEE", size: 6 },
      { type: "fflush", fd: 3 },
      { type: "close", fd: 3 },
    ],
  },
  {
    name: "write() vs printf() — バッファリングの違い",
    description: "低レベルI/O write()はstdioバッファを経由しない。混在時の注意点。",
    ops: [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "open", fd: 3, path: "/tmp/log.txt", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      // printf → stdioバッファ (まだカーネルに行かない)
      { type: "printf", fd: 3, text: "printf first\n" },
      // write → 直接カーネルへ (stdioバッファをバイパス)
      { type: "write", fd: 3, data: "write second\n", size: 13 },
      // fflush → stdioバッファの内容がカーネルへ
      { type: "fflush", fd: 3 },
      // 結果: ファイルには "write second\nprintf first\n" の順になる！
      { type: "printf", fd: 1, text: "注意: write()とprintf()を混在させると出力順序が逆転する可能性\n" },
    ],
  },
  {
    name: "fflush vs fsync — 永続化の違い",
    description: "fflush()はカーネルまで、fsync()はディスクまで。電源断での安全性の違い。",
    ops: [
      { type: "open", fd: 3, path: "/var/lib/db/data.db", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      // データ書き込み
      { type: "printf", fd: 3, text: "COMMIT record\n" },
      // fflush: stdio → カーネルページキャッシュ (電源断で消える可能性)
      { type: "fflush", fd: 3 },
      // fsync: カーネルページキャッシュ → ディスク (電源断でも安全)
      { type: "fsync", fd: 3 },
      // fdatasync: データのみ (メタデータ省略で高速)
      { type: "printf", fd: 3, text: "WAL entry\n" },
      { type: "fflush", fd: 3 },
      { type: "fdatasync", fd: 3 },
      // sync: 全ファイルシステム
      { type: "printf", fd: 3, text: "checkpoint\n" },
      { type: "fflush", fd: 3 },
      { type: "sync" },
    ],
  },
  {
    name: "ページキャッシュ — ヒットとミス",
    description: "カーネルページキャッシュのヒット/ミスとreadahead (先読み) の動作",
    ops: [
      { type: "open", fd: 3, path: "/data/file.dat", flags: ["O_RDONLY"], fdType: "regular" },
      // 最初の読み取り → キャッシュミス → ディスクI/O
      { type: "fread", fd: 3, size: 4096 },
      // readahead: シーケンシャル検出で先読み
      { type: "readahead", fd: 3, startBlock: 1, count: 8 },
      // 次の読み取り → キャッシュヒット (先読み済み)
      { type: "fread", fd: 3, size: 4096 },
      { type: "fread", fd: 3, size: 4096 },
      // 明示的なキャッシュミス
      { type: "page_cache_miss", blockNo: 100 },
      { type: "page_cache_hit", blockNo: 1 },
      { type: "page_cache_hit", blockNo: 2 },
    ],
  },
  {
    name: "O_DIRECT — ページキャッシュバイパス",
    description: "O_DIRECTでカーネルバッファをスキップし、ユーザバッファ↔ディスク間で直接DMA転送",
    ops: [
      // 通常の書き込み (ページキャッシュ経由)
      { type: "open", fd: 3, path: "/data/normal.dat", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      { type: "write", fd: 3, data: "normal write data", size: 17 },

      // O_DIRECT (ページキャッシュバイパス)
      { type: "open", fd: 4, path: "/data/direct.dat", flags: ["O_WRONLY", "O_CREAT", "O_DIRECT"], fdType: "regular" },
      { type: "o_direct_write", fd: 4, data: "direct I/O data", size: 4096 },

      // O_SYNC (毎回fsync相当)
      { type: "open", fd: 5, path: "/data/sync.dat", flags: ["O_WRONLY", "O_CREAT", "O_SYNC"], fdType: "regular" },
      { type: "write", fd: 5, data: "sync write", size: 10 },
      { type: "fsync", fd: 5 },
    ],
  },
  {
    name: "ダーティページ回収",
    description: "カーネルのpdflush/bdi-flushスレッドによるバックグラウンドwriteback",
    ops: [
      { type: "open", fd: 3, path: "/tmp/bigfile.dat", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      // 大量書き込み → ダーティページ蓄積
      { type: "write", fd: 3, data: "block 0 data...", size: 4096 },
      { type: "write", fd: 3, data: "block 1 data...", size: 4096 },
      { type: "write", fd: 3, data: "block 2 data...", size: 4096 },
      { type: "write", fd: 3, data: "block 3 data...", size: 4096 },
      { type: "write", fd: 3, data: "block 4 data...", size: 4096 },
      // ダーティ率閾値超過 → pdflush起床
      { type: "pdflush_wakeup", dirtyRatio: 15 },
      // 30秒経過したダーティページの期限切れ
      { type: "dirty_expire", ageMs: 30000 },
      // 明示的writeback
      { type: "writeback_flush", reason: "メモリ逼迫 (kswapd)", pages: 3 },
    ],
  },
  {
    name: "パイプバッファリング",
    description: "パイプのカーネル内リングバッファ (64KB) とPIPE_BUF (4KB) のアトミック保証",
    ops: [
      { type: "open", fd: 3, path: "pipe:[12345]", flags: ["O_WRONLY"], fdType: "pipe" },
      { type: "open", fd: 4, path: "pipe:[12345]", flags: ["O_RDONLY"], fdType: "pipe" },
      // 小さい書き込み (< PIPE_BUF) → アトミック
      { type: "pipe_write", fd: 3, data: "small msg\n", size: 10, pipeCapacity: 65536, used: 0 },
      { type: "pipe_write", fd: 3, data: "another\n", size: 8, pipeCapacity: 65536, used: 10 },
      // 大きい書き込み → パイプ容量圧迫
      { type: "pipe_write", fd: 3, data: "(60KB data)", size: 61440, pipeCapacity: 65536, used: 18 },
      // バッファ満杯でブロック
      { type: "pipe_write", fd: 3, data: "overflow!", size: 5000, pipeCapacity: 65536, used: 61458 },
      // 読み取り側がデータ消費
      { type: "read", fd: 4, size: 32768 },
    ],
  },
  {
    name: "fork + stdioバッファの落とし穴",
    description: "fork()前にfflush()しないとstdioバッファが複製されてデータ重複が発生する",
    ops: [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY", "O_CREAT"], fdType: "regular" },
      // ファイルに書き込み (フルバッファなのでバッファに蓄積)
      { type: "printf", fd: 3, text: "hello from parent\n" },
      // stdout (行バッファ): 改行なしで蓄積
      { type: "printf", fd: 1, text: "message: " },
      // fork! stdioバッファがコピーされる
      { type: "fork_cow", fd: 3 },
      // 対策: fork前にfflush
      { type: "fflush", fd: 3 },
      { type: "fflush", fd: 1 },
      { type: "printf", fd: 1, text: "safe after fflush\n" },
      { type: "close", fd: 3 },
    ],
  },
];
