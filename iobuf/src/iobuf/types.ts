/** stdioバッファリングモード */
export type BufferMode = "unbuffered" | "line_buffered" | "fully_buffered";

/** ファイルディスクリプタの種類 */
export type FdType = "regular" | "terminal" | "pipe" | "socket" | "block_device";

/** ファイルオープンフラグ */
export type OpenFlag = "O_RDONLY" | "O_WRONLY" | "O_RDWR" | "O_APPEND" | "O_CREAT" | "O_TRUNC" | "O_SYNC" | "O_DSYNC" | "O_DIRECT";

/** stdioバッファ (ユーザ空間) */
export interface StdioBuffer {
  fd: number;
  mode: BufferMode;
  capacity: number;        // バッファサイズ (通常4096 or 8192)
  data: string[];           // バッファ内容 (文字列の配列)
  used: number;             // 使用量 (バイト)
  dirty: boolean;           // 未フラッシュデータあり
  stream: string;           // "stdout", "stderr", "FILE *fp" など
}

/** カーネルページキャッシュのページ */
export interface CachePage {
  pageNo: number;           // ページ番号
  blockNo: number;          // ディスク上のブロック番号
  data: string;             // ページ内容 (概略)
  dirty: boolean;           // ダーティフラグ
  refCount: number;         // 参照カウント
  lastAccess: number;       // 最終アクセス時刻 (ステップ)
  uptodate: boolean;        // ディスクと同期済み
}

/** カーネルバッファキャッシュ */
export interface PageCache {
  pages: CachePage[];
  totalPages: number;
  dirtyPages: number;
  hitCount: number;
  missCount: number;
  writebackThreshold: number; // ダーティページ閾値 (%)
}

/** ディスクブロック */
export interface DiskBlock {
  blockNo: number;
  data: string;
  lastWrite: number;        // 最終書き込みステップ
}

/** ファイル状態 */
export interface FileState {
  fd: number;
  path: string;
  flags: OpenFlag[];
  fdType: FdType;
  offset: number;           // 現在のファイルオフセット
  size: number;
  inode: number;
  stdioBuf: StdioBuffer;
}

/** 書き込みの到達レベル */
export type WriteLevel =
  | "app"                   // アプリケーション内 (printf等でstdioバッファに)
  | "stdio"                 // stdioバッファ内
  | "kernel"                // カーネルページキャッシュ内
  | "disk_queue"            // ディスクI/Oキュー (エレベータ)
  | "disk_cache"            // ディスクコントローラキャッシュ
  | "disk_platter";         // ディスク媒体 (永続化完了)

/** I/Oスケジューラのアルゴリズム */
export type IoScheduler = "noop" | "cfq" | "deadline" | "mq-deadline";

/** シミュレーション操作 */
export type SimOp =
  // ファイル操作
  | { type: "open"; fd: number; path: string; flags: OpenFlag[]; fdType: FdType }
  | { type: "close"; fd: number }
  | { type: "dup2"; oldFd: number; newFd: number }

  // stdio書き込み
  | { type: "printf"; fd: number; text: string }
  | { type: "fputs"; fd: number; text: string }
  | { type: "fputc"; fd: number; char: string }
  | { type: "fwrite"; fd: number; data: string; size: number }

  // stdio読み取り
  | { type: "fgets"; fd: number; maxLen: number }
  | { type: "fread"; fd: number; size: number }
  | { type: "fgetc"; fd: number }

  // 低レベルI/O (バッファリングなし)
  | { type: "write"; fd: number; data: string; size: number }
  | { type: "read"; fd: number; size: number }
  | { type: "pwrite"; fd: number; data: string; offset: number; size: number }
  | { type: "pread"; fd: number; offset: number; size: number }

  // バッファ制御
  | { type: "fflush"; fd: number }
  | { type: "setvbuf"; fd: number; mode: BufferMode; size: number }
  | { type: "setbuf"; fd: number; enabled: boolean }

  // カーネル同期
  | { type: "fsync"; fd: number }
  | { type: "fdatasync"; fd: number }
  | { type: "sync" }
  | { type: "sync_file_range"; fd: number; offset: number; size: number }

  // カーネル内部動作
  | { type: "page_cache_hit"; blockNo: number }
  | { type: "page_cache_miss"; blockNo: number }
  | { type: "readahead"; fd: number; startBlock: number; count: number }
  | { type: "writeback_flush"; reason: string; pages: number }
  | { type: "dirty_expire"; ageMs: number }
  | { type: "pdflush_wakeup"; dirtyRatio: number }

  // ディスクI/O
  | { type: "submit_bio"; blockNo: number; direction: "read" | "write"; size: number }
  | { type: "disk_complete"; blockNo: number; direction: "read" | "write"; latencyUs: number }

  // 特殊
  | { type: "o_direct_write"; fd: number; data: string; size: number }
  | { type: "mmap_write"; fd: number; offset: number; data: string }
  | { type: "fork_cow"; fd: number }
  | { type: "pipe_write"; fd: number; data: string; size: number; pipeCapacity: number; used: number };

/** イベント種別 */
export type EventType =
  | "open" | "close" | "dup"
  | "stdio_write" | "stdio_read" | "stdio_flush"
  | "buffer_fill" | "buffer_auto_flush"
  | "kernel_write" | "kernel_read"
  | "page_cache_hit" | "page_cache_miss" | "page_cache_alloc"
  | "readahead"
  | "writeback" | "dirty_expire" | "pdflush"
  | "disk_io" | "disk_complete"
  | "fsync" | "fdatasync" | "sync"
  | "setvbuf"
  | "o_direct" | "mmap" | "pipe"
  | "fork"
  | "info" | "error";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
  level?: WriteLevel;       // データの到達レベル
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  files: FileState[];
  pageCache: PageCache;
  diskBlocks: DiskBlock[];
  stats: {
    totalSteps: number;
    stdioWrites: number;
    stdioReads: number;
    stdioFlushes: number;
    autoFlushes: number;
    kernelWrites: number;
    kernelReads: number;
    pageCacheHits: number;
    pageCacheMisses: number;
    diskIOs: number;
    fsyncs: number;
    bytesWritten: number;
    bytesRead: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
