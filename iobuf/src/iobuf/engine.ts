import type {
  BufferMode, FdType, CachePage, PageCache,
  DiskBlock, FileState, WriteLevel,
  SimOp, SimEvent, EventType, SimulationResult,
} from "./types.js";

/** デフォルトバッファモードの決定 */
function defaultBufferMode(fdType: FdType): BufferMode {
  if (fdType === "terminal") return "line_buffered";
  return "fully_buffered";
}

/** デフォルトバッファサイズ */
function defaultBufSize(fdType: FdType): number {
  if (fdType === "terminal") return 1024;
  return 4096; // BUFSIZ
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const events: SimEvent[] = [];
  const files: FileState[] = [];
  const pageCache: PageCache = {
    pages: [],
    totalPages: 0,
    dirtyPages: 0,
    hitCount: 0,
    missCount: 0,
    writebackThreshold: 20,
  };
  const diskBlocks: DiskBlock[] = [];
  let step = 0;

  const stats = {
    totalSteps: 0,
    stdioWrites: 0,
    stdioReads: 0,
    stdioFlushes: 0,
    autoFlushes: 0,
    kernelWrites: 0,
    kernelReads: 0,
    pageCacheHits: 0,
    pageCacheMisses: 0,
    diskIOs: 0,
    fsyncs: 0,
    bytesWritten: 0,
    bytesRead: 0,
  };

  function emit(type: EventType, desc: string, detail?: string, level?: WriteLevel): void {
    events.push({ step, type, description: desc, detail, level });
    stats.totalSteps++;
  }

  function getFile(fd: number): FileState | undefined {
    return files.find((f) => f.fd === fd);
  }

  /** stdioバッファをフラッシュ (→ カーネルページキャッシュへ) */
  function flushStdio(file: FileState, reason: string): void {
    const buf = file.stdioBuf;
    if (buf.used === 0) return;

    const content = buf.data.join("");
    emit("stdio_flush",
      `fflush(${buf.stream}) — ${buf.used}B をカーネルに転送 [${reason}]`,
      `stdioバッファ → write(${file.fd}, "${truncate(content)}", ${buf.used}) → カーネルページキャッシュ`,
      "kernel");

    // カーネルページキャッシュに書き込み
    writeToPageCache(file, content, buf.used);

    stats.stdioFlushes++;
    buf.data = [];
    buf.used = 0;
    buf.dirty = false;
  }

  /** カーネルページキャッシュに書き込み */
  function writeToPageCache(file: FileState, data: string, size: number): void {
    const blockNo = Math.floor(file.offset / 4096);
    let page = pageCache.pages.find((p) => p.blockNo === blockNo);

    if (page) {
      page.data = data;
      page.dirty = true;
      page.lastAccess = step;
      page.refCount++;
      pageCache.hitCount++;
      stats.pageCacheHits++;
    } else {
      page = {
        pageNo: pageCache.totalPages++,
        blockNo,
        data,
        dirty: true,
        refCount: 1,
        lastAccess: step,
        uptodate: true,
      };
      pageCache.pages.push(page);
      pageCache.dirtyPages++;
    }

    emit("kernel_write",
      `ページキャッシュ書き込み: block ${blockNo}, ${size}B → dirty`,
      `ページ #${page.pageNo}: dirty=${page.dirty}, refCount=${page.refCount}`,
      "kernel");

    stats.kernelWrites++;
    file.offset += size;
    stats.bytesWritten += size;
  }

  /** ページキャッシュから読み取り */
  function readFromPageCache(file: FileState, size: number): boolean {
    const blockNo = Math.floor(file.offset / 4096);
    const page = pageCache.pages.find((p) => p.blockNo === blockNo);

    if (page) {
      page.lastAccess = step;
      page.refCount++;
      pageCache.hitCount++;
      stats.pageCacheHits++;
      emit("page_cache_hit",
        `ページキャッシュヒット: block ${blockNo}`,
        `ページ #${page.pageNo}: "${truncate(page.data)}" — ディスクI/O不要`,
        "kernel");
      file.offset += size;
      stats.bytesRead += size;
      return true;
    }

    // キャッシュミス → ディスクから読む
    pageCache.missCount++;
    stats.pageCacheMisses++;
    emit("page_cache_miss",
      `ページキャッシュミス: block ${blockNo} — ディスクI/O発生`,
      `submit_bio(READ, block=${blockNo}) → I/Oスケジューラ → ディスク`,
      "disk_platter");

    // ディスクから読み込んでキャッシュに格納
    const diskBlock = diskBlocks.find((b) => b.blockNo === blockNo);
    const newPage: CachePage = {
      pageNo: pageCache.totalPages++,
      blockNo,
      data: diskBlock ? diskBlock.data : `(block ${blockNo} data)`,
      dirty: false,
      refCount: 1,
      lastAccess: step,
      uptodate: true,
    };
    pageCache.pages.push(newPage);
    stats.diskIOs++;
    stats.kernelReads++;
    file.offset += size;
    stats.bytesRead += size;
    return false;
  }

  /** ダーティページをディスクに書き出し */
  function writebackPages(reason: string, count?: number): number {
    const dirtyPages = pageCache.pages.filter((p) => p.dirty);
    const toFlush = count ? dirtyPages.slice(0, count) : dirtyPages;

    for (const page of toFlush) {
      page.dirty = false;
      page.uptodate = true;
      pageCache.dirtyPages = Math.max(0, pageCache.dirtyPages - 1);

      // ディスクブロック更新
      let block = diskBlocks.find((b) => b.blockNo === page.blockNo);
      if (!block) {
        block = { blockNo: page.blockNo, data: page.data, lastWrite: step };
        diskBlocks.push(block);
      } else {
        block.data = page.data;
        block.lastWrite = step;
      }
      stats.diskIOs++;
    }

    if (toFlush.length > 0) {
      emit("writeback",
        `writeback: ${toFlush.length}ページをディスクに書き出し [${reason}]`,
        `ブロック: ${toFlush.map((p) => p.blockNo).join(", ")} — dirty → clean`,
        "disk_platter");
    }

    return toFlush.length;
  }

  function truncate(s: string, max: number = 30): string {
    return s.length > max ? s.slice(0, max) + "..." : s;
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "open": {
        const mode = defaultBufferMode(op.fdType);
        const bufSize = defaultBufSize(op.fdType);
        const file: FileState = {
          fd: op.fd,
          path: op.path,
          flags: op.flags,
          fdType: op.fdType,
          offset: 0,
          size: 0,
          inode: 1000 + op.fd,
          stdioBuf: {
            fd: op.fd,
            mode,
            capacity: bufSize,
            data: [],
            used: 0,
            dirty: false,
            stream: op.fd === 1 ? "stdout" : op.fd === 2 ? "stderr" : `fp(fd=${op.fd})`,
          },
        };
        files.push(file);

        const modeStr = mode === "unbuffered" ? "バッファなし (_IONBF)" :
          mode === "line_buffered" ? "行バッファ (_IOLBF)" : "フルバッファ (_IOFBF)";

        emit("open",
          `open("${op.path}", ${op.flags.join("|")}) = ${op.fd}`,
          `fdType=${op.fdType}, バッファモード=${modeStr}, バッファサイズ=${bufSize}B`);
        break;
      }

      case "close": {
        const file = getFile(op.fd);
        if (file) {
          // close前にstdioバッファをフラッシュ
          if (file.stdioBuf.used > 0) {
            flushStdio(file, "close時の暗黙フラッシュ");
          }
          emit("close",
            `close(${op.fd}) — ${file.path}`,
            `残りバッファデータをフラッシュしてfdを解放`);
        }
        break;
      }

      case "dup2": {
        const file = getFile(op.oldFd);
        if (file) {
          emit("dup",
            `dup2(${op.oldFd}, ${op.newFd}) — fd複製`,
            `fd ${op.newFd} が fd ${op.oldFd} と同じファイルを指す。stdioバッファは共有されない。`);
        }
        break;
      }

      case "printf":
      case "fputs":
      case "fwrite": {
        const file = getFile(op.fd);
        if (!file) break;
        const buf = file.stdioBuf;
        const text = op.type === "fwrite" ? op.data : op.text;
        const size = op.type === "fwrite" ? op.size : text.length;
        stats.stdioWrites++;

        const funcName = op.type === "printf" ? "printf" : op.type === "fputs" ? "fputs" : "fwrite";
        emit("stdio_write",
          `${funcName}("${truncate(text)}") → ${buf.stream} [${buf.mode}]`,
          `${size}B をstdioバッファに書き込み (現在 ${buf.used}/${buf.capacity}B)`,
          "stdio");

        if (buf.mode === "unbuffered") {
          // アンバッファード: 即座にwrite()システムコール
          emit("buffer_auto_flush",
            `unbuffered: 即座に write(${file.fd}, ..., ${size}) システムコール`,
            `stdioバッファを経由せず直接カーネルへ`,
            "kernel");
          writeToPageCache(file, text, size);
          stats.autoFlushes++;
        } else if (buf.mode === "line_buffered") {
          buf.data.push(text);
          buf.used += size;
          buf.dirty = true;

          if (text.includes("\n")) {
            // 改行でフラッシュ
            emit("buffer_auto_flush",
              `line_buffered: 改行検出 → 自動フラッシュ`,
              `"\\n" を検出。行バッファモードでは改行でwrite()が呼ばれる。`,
              "kernel");
            flushStdio(file, "改行による自動フラッシュ");
            stats.autoFlushes++;
          } else {
            emit("buffer_fill",
              `行バッファ: ${buf.used}/${buf.capacity}B 蓄積中 (改行待ち)`,
              `改行 (\\n) が来るかバッファが満杯になるまでカーネルへの転送を遅延`,
              "stdio");

            // バッファ満杯チェック
            if (buf.used >= buf.capacity) {
              emit("buffer_auto_flush",
                `バッファ満杯 (${buf.used} >= ${buf.capacity}) → 強制フラッシュ`,
                `改行がなくてもバッファ満杯で write() が呼ばれる`,
                "kernel");
              flushStdio(file, "バッファ満杯");
              stats.autoFlushes++;
            }
          }
        } else {
          // fully_buffered
          buf.data.push(text);
          buf.used += size;
          buf.dirty = true;

          emit("buffer_fill",
            `フルバッファ: ${buf.used}/${buf.capacity}B 蓄積中`,
            `バッファが満杯 (${buf.capacity}B) になるか fflush()/fclose() が呼ばれるまで蓄積`,
            "stdio");

          if (buf.used >= buf.capacity) {
            emit("buffer_auto_flush",
              `バッファ満杯 (${buf.used} >= ${buf.capacity}) → 自動フラッシュ`,
              `write(${file.fd}, buf, ${buf.used}) システムコール発行`,
              "kernel");
            flushStdio(file, "バッファ満杯");
            stats.autoFlushes++;
          }
        }
        break;
      }

      case "fputc": {
        const file = getFile(op.fd);
        if (!file) break;
        const buf = file.stdioBuf;
        stats.stdioWrites++;

        emit("stdio_write",
          `fputc('${op.char}') → ${buf.stream} [${buf.mode}]`,
          `1B をstdioバッファに追加`,
          "stdio");

        buf.data.push(op.char);
        buf.used += 1;
        buf.dirty = true;

        if (buf.mode === "unbuffered") {
          flushStdio(file, "unbuffered");
          stats.autoFlushes++;
        } else if (buf.mode === "line_buffered" && op.char === "\n") {
          emit("buffer_auto_flush",
            `'\\n' 検出 → 行バッファ自動フラッシュ`,
            undefined, "kernel");
          flushStdio(file, "改行");
          stats.autoFlushes++;
        }
        break;
      }

      case "fgets":
      case "fread":
      case "fgetc": {
        const file = getFile(op.fd);
        if (!file) break;
        const size = op.type === "fgets" ? op.maxLen : op.type === "fread" ? op.size : 1;
        stats.stdioReads++;

        const funcName = op.type === "fgets" ? "fgets" : op.type === "fread" ? "fread" : "fgetc";
        emit("stdio_read",
          `${funcName}(fd=${op.fd}, ${size}B)`,
          `stdioバッファに十分なデータがあればバッファから返す。なければ read() でカーネルから補充。`,
          "stdio");

        // stdioバッファが空ならカーネルから読む
        if (file.stdioBuf.used === 0) {
          emit("kernel_read",
            `stdioバッファ空 → read(${file.fd}, buf, ${file.stdioBuf.capacity}) でカーネルから一括読み込み`,
            `バッファサイズ分を先読みして、次の読み取りに備える`,
            "kernel");
          readFromPageCache(file, file.stdioBuf.capacity);
          file.stdioBuf.used = file.stdioBuf.capacity;
        }

        // バッファからデータを返す
        const delivered = Math.min(size, file.stdioBuf.used);
        file.stdioBuf.used -= delivered;
        emit("stdio_read",
          `stdioバッファから ${delivered}B を返却 (残り ${file.stdioBuf.used}B)`,
          undefined, "app");
        break;
      }

      case "write": {
        const file = getFile(op.fd);
        if (!file) break;
        stats.kernelWrites++;

        emit("kernel_write",
          `write(${op.fd}, "${truncate(op.data)}", ${op.size}) — stdioバッファをバイパス`,
          `低レベルI/O: ユーザ空間バッファを使わず直接カーネルページキャッシュに書き込み`,
          "kernel");

        writeToPageCache(file, op.data, op.size);
        break;
      }

      case "read": {
        const file = getFile(op.fd);
        if (!file) break;
        stats.kernelReads++;

        emit("kernel_read",
          `read(${op.fd}, buf, ${op.size}) — stdioバッファをバイパス`,
          `低レベルI/O: カーネルページキャッシュから直接読み取り`,
          "kernel");

        readFromPageCache(file, op.size);
        break;
      }

      case "pwrite": {
        const file = getFile(op.fd);
        if (!file) break;
        const savedOffset = file.offset;
        file.offset = op.offset;

        emit("kernel_write",
          `pwrite(${op.fd}, "${truncate(op.data)}", ${op.size}, offset=${op.offset})`,
          `指定オフセットに書き込み。ファイルオフセットは変更しない (アトミック)。`,
          "kernel");

        writeToPageCache(file, op.data, op.size);
        file.offset = savedOffset;
        break;
      }

      case "pread": {
        const file = getFile(op.fd);
        if (!file) break;
        const savedOffset = file.offset;
        file.offset = op.offset;

        emit("kernel_read",
          `pread(${op.fd}, buf, ${op.size}, offset=${op.offset})`,
          `指定オフセットから読み取り。ファイルオフセットは変更しない。`,
          "kernel");

        readFromPageCache(file, op.size);
        file.offset = savedOffset;
        break;
      }

      case "fflush": {
        const file = getFile(op.fd);
        if (file) {
          emit("stdio_flush",
            `fflush(${file.stdioBuf.stream}) — 明示的フラッシュ`,
            `stdioバッファの未書き込みデータを write() でカーネルに転送。注意: ディスク書き込みは保証しない。`);
          flushStdio(file, "明示的 fflush()");
        } else if (op.fd === 0) {
          // fflush(NULL) — 全ストリームフラッシュ
          emit("stdio_flush",
            `fflush(NULL) — 全ストリームをフラッシュ`,
            `オープン中の全FILEストリームのstdioバッファをカーネルに転送`);
          for (const f of files) {
            if (f.stdioBuf.used > 0) {
              flushStdio(f, "fflush(NULL)");
            }
          }
        }
        break;
      }

      case "setvbuf": {
        const file = getFile(op.fd);
        if (!file) break;
        const oldMode = file.stdioBuf.mode;
        file.stdioBuf.mode = op.mode;
        file.stdioBuf.capacity = op.size;

        const modeStr = op.mode === "unbuffered" ? "_IONBF (バッファなし)" :
          op.mode === "line_buffered" ? "_IOLBF (行バッファ)" : "_IOFBF (フルバッファ)";

        emit("setvbuf",
          `setvbuf(${file.stdioBuf.stream}, ${modeStr}, ${op.size}B)`,
          `バッファモード変更: ${oldMode} → ${op.mode}, サイズ: ${op.size}B`);
        break;
      }

      case "setbuf": {
        const file = getFile(op.fd);
        if (!file) break;

        if (op.enabled) {
          file.stdioBuf.mode = "fully_buffered";
          emit("setvbuf",
            `setbuf(${file.stdioBuf.stream}, buf) — フルバッファに設定`,
            `setvbuf(stream, buf, _IOFBF, BUFSIZ) と等価`);
        } else {
          file.stdioBuf.mode = "unbuffered";
          file.stdioBuf.capacity = 0;
          emit("setvbuf",
            `setbuf(${file.stdioBuf.stream}, NULL) — バッファリング無効化`,
            `setvbuf(stream, NULL, _IONBF, 0) と等価。stderr のデフォルト。`);
        }
        break;
      }

      case "fsync": {
        const file = getFile(op.fd);
        if (!file) break;

        // まずstdioバッファをフラッシュ
        if (file.stdioBuf.used > 0) {
          flushStdio(file, "fsync前の暗黙フラッシュ");
        }

        emit("fsync",
          `fsync(${op.fd}) — データ+メタデータをディスクに強制書き出し`,
          `カーネルページキャッシュのダーティページを全てディスクに書き出し。inode (mtime, size) も更新。ディスク書き込み完了まで関数はブロック。`,
          "disk_platter");

        // ダーティページを書き出し
        const written = writebackPages("fsync");
        stats.fsyncs++;

        emit("disk_complete",
          `fsync完了: ${written}ページ書き出し — データがディスク媒体に到達`,
          `この時点でデータは電源断に対して安全`,
          "disk_platter");
        break;
      }

      case "fdatasync": {
        const file = getFile(op.fd);
        if (!file) break;

        if (file.stdioBuf.used > 0) {
          flushStdio(file, "fdatasync前の暗黙フラッシュ");
        }

        emit("fdatasync",
          `fdatasync(${op.fd}) — データのみディスクに強制書き出し`,
          `fsyncと異なりメタデータ (atime等) の書き出しを省略。ファイルサイズが変わらない場合に高速。`,
          "disk_platter");

        const written = writebackPages("fdatasync");
        stats.fsyncs++;

        emit("disk_complete",
          `fdatasync完了: ${written}ページ — メタデータ更新はスキップ`,
          undefined, "disk_platter");
        break;
      }

      case "sync": {
        emit("sync",
          `sync() — 全ファイルシステムのダーティデータを書き出し開始`,
          `全マウントポイントのダーティページの書き出しを開始するが、完了を待たない (Linux)。sync; sync 慣習の由来。`);

        const written = writebackPages("sync");
        emit("writeback",
          `${written}ページの書き出しを開始`,
          undefined, "disk_platter");
        break;
      }

      case "sync_file_range": {
        emit("sync",
          `sync_file_range(${op.fd}, offset=${op.offset}, len=${op.size})`,
          `指定範囲のダーティページのみ非同期で書き出し。データベースエンジン (PostgreSQL WAL等) で使用。`,
          "disk_platter");
        break;
      }

      case "page_cache_hit": {
        pageCache.hitCount++;
        stats.pageCacheHits++;
        const page = pageCache.pages.find((p) => p.blockNo === op.blockNo);
        emit("page_cache_hit",
          `ページキャッシュヒット: block ${op.blockNo}`,
          page ? `ページ #${page.pageNo}: dirty=${page.dirty}, refCount=${page.refCount}` : undefined,
          "kernel");
        break;
      }

      case "page_cache_miss": {
        pageCache.missCount++;
        stats.pageCacheMisses++;
        emit("page_cache_miss",
          `ページキャッシュミス: block ${op.blockNo} → ディスクI/O`,
          `submit_bio(READ) → I/Oスケジューラ → ブロックデバイスドライバ → ディスク`,
          "disk_platter");
        stats.diskIOs++;
        break;
      }

      case "readahead": {
        emit("readahead",
          `readahead: block ${op.startBlock}〜${op.startBlock + op.count - 1} (${op.count}ブロック)`,
          `シーケンシャル読み取りを検出 → 先読み。次のread()でページキャッシュヒットになる確率を上げる。`);

        for (let i = 0; i < op.count; i++) {
          const blockNo = op.startBlock + i;
          if (!pageCache.pages.find((p) => p.blockNo === blockNo)) {
            pageCache.pages.push({
              pageNo: pageCache.totalPages++,
              blockNo,
              data: `(readahead block ${blockNo})`,
              dirty: false,
              refCount: 0,
              lastAccess: step,
              uptodate: true,
            });
            stats.diskIOs++;
          }
        }
        break;
      }

      case "writeback_flush": {
        emit("writeback",
          `writeback: ${op.reason} — ${op.pages}ページ書き出し`,
          `カーネルのbdi-flush / pdflush スレッドがバックグラウンドでダーティページを書き出し`);
        writebackPages(op.reason, op.pages);
        break;
      }

      case "dirty_expire": {
        const expiredPages = pageCache.pages.filter(
          (p) => p.dirty && (step - p.lastAccess) > 5
        );
        emit("dirty_expire",
          `dirty_expire: ${op.ageMs}ms超過のダーティページを書き出し`,
          `/proc/sys/vm/dirty_expire_centisecs (デフォルト 3000 = 30秒) — ${expiredPages.length}ページ対象`);
        writebackPages("dirty_expire", expiredPages.length);
        break;
      }

      case "pdflush_wakeup": {
        emit("pdflush",
          `pdflush 起床: ダーティ率 ${op.dirtyRatio}% ≥ 閾値 ${pageCache.writebackThreshold}%`,
          `/proc/sys/vm/dirty_background_ratio (デフォルト 10%) 超過でバックグラウンド書き出し開始`);
        writebackPages("pdflush", 5);
        break;
      }

      case "submit_bio": {
        stats.diskIOs++;
        const dir = op.direction === "read" ? "READ" : "WRITE";
        emit("disk_io",
          `submit_bio(${dir}, block=${op.blockNo}, ${op.size}B)`,
          `ブロックI/OリクエストをI/Oスケジューラに投入。エレベータアルゴリズムでリクエストをマージ・ソート。`,
          "disk_queue");
        break;
      }

      case "disk_complete": {
        const dir = op.direction === "read" ? "READ" : "WRITE";
        emit("disk_complete",
          `ディスクI/O完了: ${dir} block ${op.blockNo} (${op.latencyUs}μs)`,
          `ディスクコントローラ → 媒体書き込み完了。IRQ でカーネルに通知。`,
          "disk_platter");
        break;
      }

      case "o_direct_write": {
        const file = getFile(op.fd);
        if (!file) break;

        emit("o_direct",
          `O_DIRECT write(${op.fd}, ${op.size}B) — ページキャッシュをバイパス`,
          `ユーザバッファから直接ディスクへDMA転送。データベース (MySQL InnoDB, PostgreSQL) が独自バッファプールを使う場合に有用。アライメント要件あり (通常512B or 4KB境界)。`,
          "disk_platter");

        stats.diskIOs++;
        stats.bytesWritten += op.size;
        break;
      }

      case "mmap_write": {
        const file = getFile(op.fd);
        if (!file) break;

        emit("mmap",
          `mmap書き込み: fd=${op.fd}, offset=${op.offset}, "${truncate(op.data)}"`,
          `mmap()でファイルをメモリにマッピング。書き込みはページフォルト → ページキャッシュのページを直接変更 → dirty マーク。write()システムコール不要。`,
          "kernel");

        writeToPageCache(file, op.data, op.data.length);
        break;
      }

      case "fork_cow": {
        emit("fork",
          `fork() — ページキャッシュのCoW (Copy-on-Write)`,
          `fork後、親子はページキャッシュのページを共有。書き込み時にページがコピーされる。stdioバッファは各プロセスに複製されるため、fflush前のfork()でデータ重複の危険。`);
        break;
      }

      case "pipe_write": {
        emit("pipe",
          `pipe write(${op.fd}, ${op.size}B) — パイプバッファ (${op.used}/${op.pipeCapacity}B)`,
          `パイプはカーネル内リングバッファ (デフォルト64KB, 16ページ)。バッファ満杯で書き込み側ブロック、空で読み取り側ブロック。PIPE_BUF (4KB) 以下の書き込みはアトミック。`,
          "kernel");

        if (op.used + op.size > op.pipeCapacity) {
          emit("pipe",
            `パイプバッファ満杯 (${op.used + op.size} > ${op.pipeCapacity}) — 書き込みブロック`,
            `読み取り側がデータを消費するまで write() はブロック。`);
        }
        break;
      }
    }
  }

  return { events, files, pageCache, diskBlocks, stats };
}
