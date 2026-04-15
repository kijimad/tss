/**
 * kernel.ts — システムコールシミュレーションカーネル
 *
 * 【概要】
 * Linux カーネルにおけるシステムコール処理の流れを模倣したシミュレータ。
 * ユーザ空間のプログラムがカーネルの機能を利用する際の一連の遷移:
 *   ユーザモード → トラップ (INT 0x80 / syscall 命令) → カーネルモード → リターン
 * をステップごとに再現し、各状態変化をトレースとして記録する。
 *
 * 【システムコールの仕組み】
 * ユーザ空間のプロセスはカーネル空間に直接アクセスできない（特権レベルの分離）。
 * ハードウェアやOS機能を利用するには、以下の手順でカーネルに制御を移す:
 *   1. システムコール番号を RAX レジスタにセット（x86-64 の場合）
 *   2. 引数を RDI, RSI, RDX, R10, R8, R9 レジスタにセット
 *   3. `syscall` 命令（または旧式の `int 0x80`）でトラップを発生させる
 *   4. CPU が特権レベルをリング3→リング0に切り替え、カーネルのエントリポイントに飛ぶ
 *   5. カーネルが sys_call_table からハンドラを検索して実行
 *   6. 戻り値を RAX にセットしてユーザ空間に復帰
 *
 * 戻り値の規約: 成功時は 0 以上の値、失敗時は負の値（-errno）を返す。
 *
 * 【管理するリソース】
 * - fd テーブル: ファイルディスクリプタとファイル/パイプ/ソケットの対応
 * - プロセステーブル: PID, 親PID, 実行状態, プロセス名
 * - メモリマップ: テキスト/データ/ヒープ/スタック/mmap 領域
 * - VFS (仮想ファイルシステム): シミュレーション用のファイルツリー
 *
 * 【対応するシステムコールのカテゴリ】
 * - ファイル I/O: open, read, write, close, lseek, stat
 * - プロセス管理: fork, execve, exit, wait, getpid, getppid, kill
 * - メモリ管理: brk, mmap, munmap
 * - IPC (プロセス間通信): pipe, dup2, socket, bind, listen, accept, connect
 * - システム情報: uname
 *
 * 【参考: strace による実際のトレース例】
 * strace コマンドを使うと、実際の Linux プロセスのシステムコール呼び出しを観察できる。
 * 例: `strace -e trace=open,read,write cat /etc/hostname`
 * このシミュレータの trace 配列は strace の出力に相当する情報を提供する。
 *
 * 【参考: VDSO (Virtual Dynamic Shared Object)】
 * gettimeofday や clock_gettime のような頻繁に呼ばれるシステムコールは、
 * VDSO 最適化によりカーネル空間への遷移なしにユーザ空間で実行できる。
 * 本シミュレータでは VDSO は対象外とし、全てカーネル遷移を経由する。
 */

// ── 型定義 ──
// カーネルが管理するデータ構造のインターフェース群。
// 実際の Linux カーネルでは C の構造体として定義されるものに対応する。

/**
 * ファイルディスクリプタエントリ
 *
 * カーネル内の files_struct に相当する。各プロセスはこのテーブルを持ち、
 * fd (整数) をキーにしてオープン中のファイル/パイプ/ソケット等を管理する。
 * 標準入力=0, 標準出力=1, 標準エラー出力=2 が慣例的に予約されている。
 */
export interface FdEntry {
  /** ファイルディスクリプタ番号 (0 以上の整数、小さい番号から順に割り当て) */
  fd: number;
  /** ファイルパスまたはパイプ/ソケットの識別子 */
  path: string;
  /** オープンフラグ ("r"=読み取り, "w"=書き込み, "rw"=読み書き) */
  flags: string;
  /** 現在の読み書き位置 (バイトオフセット) */
  offset: number;
  /** エントリの種別: 通常ファイル, パイプ(読み/書き), ソケット, デバイスファイル */
  type: "file" | "pipe_r" | "pipe_w" | "socket" | "device";
}

/**
 * プロセス情報
 *
 * カーネル内の task_struct に相当する。各プロセスの識別情報と実行状態を保持する。
 * state のライフサイクル: running → sleeping ⇄ running → zombie → (wait で回収)
 */
export interface ProcessInfo {
  /** プロセスID (Process ID) — プロセスを一意に識別する正の整数 */
  pid: number;
  /** 親プロセスID (Parent PID) — このプロセスを fork した親の PID */
  ppid: number;
  /**
   * プロセスの実行状態:
   * - running: CPU で実行中 or 実行可能キューで待機中
   * - sleeping: I/O 待ちなどでスリープ中
   * - zombie: 終了済みだが親が wait で回収していない状態
   * - stopped: シグナル (SIGSTOP/SIGTSTP) により停止中
   */
  state: "running" | "sleeping" | "zombie" | "stopped";
  /** プロセス名 (実行ファイル名) */
  name: string;
  /** 終了コード (exit 時に設定される。シグナルによる終了は 128+シグナル番号) */
  exitCode?: number;
}

/**
 * メモリ領域
 *
 * カーネル内の vm_area_struct に相当する。プロセスの仮想アドレス空間内の
 * 各領域 (テキスト, データ, ヒープ, スタック, mmap) を表現する。
 * 実際のプロセスのメモリマップは /proc/[pid]/maps で確認できる。
 */
export interface MemRegion {
  /** 領域の開始仮想アドレス */
  start: number;
  /** 領域のサイズ (バイト) */
  size: number;
  /** パーミッション文字列 (例: "r-xp"=読み取り+実行+プライベート, "rw-p"=読み書き+プライベート) */
  perm: string;
  /** 領域の名前 (例: "[text]", "[heap]", "[stack]", "[anon:mmap]") */
  name: string;
}

/**
 * VFS (Virtual File System) ノード
 *
 * Linux の VFS 層における inode に相当する。ファイルの種類、内容、パーミッションを保持する。
 * VFS は複数のファイルシステム (ext4, tmpfs, devtmpfs 等) を統一的に扱う抽象化レイヤーである。
 */
export interface VfsNode {
  /** ノードの種別: 通常ファイル, ディレクトリ, デバイスファイル */
  type: "file" | "dir" | "device";
  /** ファイルの内容 (シミュレーション用に文字列として保持) */
  content: string;
  /** パーミッション (8進数表記。例: 0o644 = rw-r--r--) */
  perm: number;
}

/**
 * トレースのステップ
 *
 * システムコール実行過程の各段階を記録する。strace コマンドの出力に類似した
 * デバッグ情報を提供する。各モードはシステムコール処理の段階に対応する。
 */
export interface TraceStep {
  /**
   * 処理段階:
   * - user: ユーザ空間でのシステムコール呼び出し (C ライブラリのラッパー関数)
   * - trap: トラップ命令 (int 0x80 / syscall) によるカーネルへの遷移
   * - kernel: カーネル空間での処理 (sys_call_table によるディスパッチ後)
   * - return: カーネルからユーザ空間への復帰 (RAX に戻り値をセット)
   * - error: エラー発生 (errno が設定される)
   */
  mode: "user" | "trap" | "kernel" | "return" | "error";
  /** この段階での詳細情報 (人間が読める形式) */
  detail: string;
}

/**
 * システムコール実行結果
 *
 * 各システムコールの完了後に返される結果。Linux の慣例に従い、
 * 成功時は returnValue ≥ 0、失敗時は returnValue = -1 かつ errno にエラー番号がセットされる。
 */
export interface SyscallResult {
  /** 戻り値 (成功時: 0以上の値、失敗時: -1) */
  returnValue: number;
  /** エラー番号 (成功時: 0、失敗時: ERRNO テーブルの値) */
  errno: number;
  /** エラー名 (例: "ENOENT", "EBADF"。成功時は空文字列) */
  errname: string;
  /** 実行過程のトレース (user → trap → kernel → return の各ステップ) */
  trace: TraceStep[];
}

/**
 * カーネル状態のスナップショット
 *
 * ある時点でのカーネルの主要データ構造の読み取り専用コピー。
 * UI がカーネル状態を表示する際に使用する。各フィールドはコピーなので
 * 変更してもカーネル内部の状態には影響しない。
 */
export interface KernelSnapshot {
  /** オープン中のファイルディスクリプタ一覧 */
  fdTable: FdEntry[];
  /** 全プロセスの一覧 */
  processes: ProcessInfo[];
  /** メモリマップの領域一覧 */
  memory: MemRegion[];
}

/**
 * システムコール呼び出し
 *
 * ユーザプログラムからのシステムコール要求を表現する。
 * 実際の Linux では、glibc のラッパー関数がレジスタにセットして syscall 命令を発行する。
 */
export interface SyscallInvocation {
  /** C 風の呼び出し表記 (表示用。例: 'fd = open("/etc/hostname", O_RDONLY)') */
  code: string;
  /** システムコール名 (例: "open", "fork", "mmap") */
  name: string;
  /** 引数の配列 (システムコールごとに型と個数が異なる) */
  args: unknown[];
}

// ── エラー番号 (errno) ──
// Linux カーネルはエラーを整数の errno 値で表現する。
// システムコールが失敗すると、戻り値は -1 となり、
// カーネル内部では -errno の値（例: -ENOENT = -2）を返す。
// ユーザ空間の C ライブラリが負の値を検出し、errno グローバル変数にセットする。
// 各定数の意味:
//   ENOENT (2): ファイルまたはディレクトリが存在しない (No such file or directory)
//   EBADF  (9): 無効なファイルディスクリプタ (Bad file descriptor)
//   ECHILD(10): 子プロセスが存在しない (No child processes)
//   EAGAIN(11): リソースが一時的に利用不可 (Try again)
//   ENOMEM(12): メモリ不足 (Out of memory)
//   EACCES(13): 権限が不足 (Permission denied)
//   EEXIST(17): ファイルが既に存在する (File exists)
//   EINVAL(22): 無効な引数 (Invalid argument)
//   EMFILE(24): オープン可能なファイル数の上限超過 (Too many open files)
//   ENOSYS(38): 未実装のシステムコール (Function not implemented)
//   EADDRINUSE (98): アドレスが既に使用中 (Address already in use)
//   ECONNREFUSED(111): 接続が拒否された (Connection refused)

const ERRNO: Record<string, number> = {
  ENOENT: 2,
  EBADF: 9,
  ECHILD: 10,
  EAGAIN: 11,
  ENOMEM: 12,
  EACCES: 13,
  EEXIST: 17,
  EINVAL: 22,
  EMFILE: 24,
  ENOSYS: 38,
  EADDRINUSE: 98,
  ECONNREFUSED: 111,
};

// ── カーネル ──
// シミュレーション用カーネルの本体。
// 実際の Linux カーネルの主要サブシステム (VFS, プロセス管理, メモリ管理, IPC) を
// 簡略化して再現している。

export class Kernel {
  /** オープン中のファイルディスクリプタテーブル (カーネル内の files_struct に相当) */
  private fdTable: FdEntry[] = [];
  /** プロセステーブル (カーネル内の task_struct のリストに相当) */
  private processes: ProcessInfo[] = [];
  /** 仮想メモリマップ (カーネル内の mm_struct → vm_area_struct のリストに相当) */
  private memory: MemRegion[] = [];
  /** 仮想ファイルシステム (VFS レイヤー。パス → inode のマッピング) */
  private vfs = new Map<string, VfsNode>();
  /** 次に割り当てる fd 番号 (0,1,2 は標準入出力で予約済み) */
  private nextFd = 3;
  /** 次に割り当てる PID (init=1, user_prog=100 の次から) */
  private nextPid = 101;
  /** 現在のヒープブレーク位置 (brk システムコールで伸長される) */
  private heapBreak = 0x0040_0000;
  /** 次の mmap 割り当てアドレス (スタックの下方に向かって配置) */
  private nextMmapAddr = 0x7f00_0000;
  /** パイプの通し番号 (pipe:[N] の N に使用) */
  private pipeCounter = 0;
  /** ソケットの通し番号 (socket:[N] の N に使用) */
  private socketCounter = 0;

  constructor() {
    this.reset();
  }

  /** 状態をリセットする */
  reset(): void {
    this.fdTable = [
      { fd: 0, path: "/dev/stdin", flags: "r", offset: 0, type: "device" },
      { fd: 1, path: "/dev/stdout", flags: "w", offset: 0, type: "device" },
      { fd: 2, path: "/dev/stderr", flags: "w", offset: 0, type: "device" },
    ];
    this.processes = [
      { pid: 1, ppid: 0, state: "sleeping", name: "init" },
      { pid: 100, ppid: 1, state: "running", name: "user_prog" },
    ];
    this.memory = [
      { start: 0x0010_0000, size: 0x0010_0000, perm: "r-xp", name: "[text]" },
      { start: 0x0020_0000, size: 0x0008_0000, perm: "rw-p", name: "[data]" },
      { start: 0x0030_0000, size: 0x0010_0000, perm: "rw-p", name: "[heap]" },
      { start: 0x7ffe_0000, size: 0x0002_0000, perm: "rw-p", name: "[stack]" },
    ];
    this.vfs.clear();
    this.initVfs();
    this.nextFd = 3;
    this.nextPid = 101;
    this.heapBreak = 0x0040_0000;
    this.nextMmapAddr = 0x7f00_0000;
    this.pipeCounter = 0;
    this.socketCounter = 0;
  }

  /** VFS 初期化 */
  private initVfs(): void {
    const files: [string, VfsNode][] = [
      ["/", { type: "dir", content: "", perm: 0o755 }],
      ["/dev", { type: "dir", content: "", perm: 0o755 }],
      ["/dev/null", { type: "device", content: "", perm: 0o666 }],
      ["/dev/zero", { type: "device", content: "\0", perm: 0o666 }],
      ["/etc", { type: "dir", content: "", perm: 0o755 }],
      ["/etc/hostname", { type: "file", content: "sim-host\n", perm: 0o644 }],
      ["/etc/passwd", { type: "file", content: "root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000::/home/user:/bin/bash\n", perm: 0o644 }],
      ["/tmp", { type: "dir", content: "", perm: 0o1777 }],
      ["/home", { type: "dir", content: "", perm: 0o755 }],
      ["/home/user", { type: "dir", content: "", perm: 0o700 }],
    ];
    for (const [path, node] of files) {
      this.vfs.set(path, node);
    }
  }

  /** カーネル状態のスナップショットを取得 */
  snapshot(): KernelSnapshot {
    return {
      fdTable: [...this.fdTable],
      processes: this.processes.map((p) => ({ ...p })),
      memory: [...this.memory],
    };
  }

  /** システムコールを実行する */
  execute(invocation: SyscallInvocation): SyscallResult {
    const trace: TraceStep[] = [];
    const { name, args } = invocation;

    // 1. ユーザモード
    trace.push({ mode: "user", detail: invocation.code });

    // 2. トラップ
    const sysnum = SYSCALL_TABLE[name];
    if (sysnum === undefined) {
      trace.push({ mode: "trap", detail: `INT 0x80 — syscall "${name}" は未知` });
      trace.push({ mode: "error", detail: `errno = ENOSYS (${ERRNO["ENOSYS"]})` });
      return { returnValue: -1, errno: ERRNO["ENOSYS"]!, errname: "ENOSYS", trace };
    }
    trace.push({ mode: "trap", detail: `INT 0x80 — RAX=${sysnum} (sys_${name})` });

    // 3. カーネルモード: ディスパッチ
    trace.push({ mode: "kernel", detail: `sys_call_table[${sysnum}] → sys_${name}()` });

    try {
      const result = this.dispatch(name, args, trace);
      // 4. リターン
      trace.push({ mode: "return", detail: `RAX = ${result.returnValue} (${result.errname || "success"})` });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace.push({ mode: "error", detail: msg });
      trace.push({ mode: "return", detail: "RAX = -1 (EINVAL)" });
      return { returnValue: -1, errno: ERRNO["EINVAL"]!, errname: "EINVAL", trace };
    }
  }

  /** システムコールディスパッチ */
  private dispatch(name: string, args: unknown[], trace: TraceStep[]): SyscallResult {
    switch (name) {
      case "open":   return this.sysOpen(args[0] as string, args[1] as string, trace);
      case "close":  return this.sysClose(args[0] as number, trace);
      case "read":   return this.sysRead(args[0] as number, args[1] as number, trace);
      case "write":  return this.sysWrite(args[0] as number, args[1] as string, trace);
      case "lseek":  return this.sysLseek(args[0] as number, args[1] as number, args[2] as string, trace);
      case "stat":   return this.sysStat(args[0] as string, trace);
      case "fork":   return this.sysFork(trace);
      case "execve": return this.sysExecve(args[0] as string, trace);
      case "exit":   return this.sysExit(args[0] as number, trace);
      case "wait":   return this.sysWait(trace);
      case "getpid": return this.sysGetpid(trace);
      case "getppid": return this.sysGetppid(trace);
      case "brk":    return this.sysBrk(args[0] as number, trace);
      case "mmap":   return this.sysMmap(args[0] as number, args[1] as string, trace);
      case "munmap": return this.sysMunmap(args[0] as number, trace);
      case "pipe":   return this.sysPipe(trace);
      case "dup2":   return this.sysDup2(args[0] as number, args[1] as number, trace);
      case "socket": return this.sysSocket(args[0] as string, args[1] as string, trace);
      case "bind":   return this.sysBind(args[0] as number, args[1] as string, args[2] as number, trace);
      case "listen": return this.sysListen(args[0] as number, args[1] as number, trace);
      case "accept": return this.sysAccept(args[0] as number, trace);
      case "connect": return this.sysConnect(args[0] as number, args[1] as string, args[2] as number, trace);
      case "kill":   return this.sysKill(args[0] as number, args[1] as number, trace);
      case "uname":  return this.sysUname(trace);
      default:
        return this.err("ENOSYS", trace);
    }
  }

  // ── ファイル I/O ──

  private sysOpen(path: string, flags: string, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `vfs_open("${path}", ${flags})` });
    const node = this.vfs.get(path);

    if (node === undefined && flags.includes("O_CREAT")) {
      this.vfs.set(path, { type: "file", content: "", perm: 0o644 });
      trace.push({ mode: "kernel", detail: `VFS: "${path}" を新規作成` });
    } else if (node === undefined) {
      trace.push({ mode: "kernel", detail: `VFS: "${path}" が見つからない` });
      return this.err("ENOENT", trace);
    }

    const fd = this.nextFd++;
    const flagStr = flags.replace("O_CREAT", "").replace(",", "").trim() || "r";
    this.fdTable.push({ fd, path, flags: flagStr, offset: 0, type: "file" });
    trace.push({ mode: "kernel", detail: `fd_install: fd=${fd} → "${path}"` });
    return this.ok(fd, trace);
  }

  private sysClose(fd: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `fd_close(${fd})` });
    const idx = this.fdTable.findIndex((e) => e.fd === fd);
    if (idx === -1) return this.err("EBADF", trace);
    const entry = this.fdTable[idx]!;
    trace.push({ mode: "kernel", detail: `"${entry.path}" の fd=${fd} を解放` });
    this.fdTable.splice(idx, 1);
    return this.ok(0, trace);
  }

  private sysRead(fd: number, count: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `vfs_read(fd=${fd}, count=${count})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined) return this.err("EBADF", trace);

    const node = this.vfs.get(entry.path);
    if (node === undefined) {
      if (entry.type === "pipe_r") {
        trace.push({ mode: "kernel", detail: `pipe_read: ${count} バイト読み取り` });
        return this.ok(count, trace);
      }
      if (entry.type === "device") {
        trace.push({ mode: "kernel", detail: `dev_read("${entry.path}", ${count})` });
        return this.ok(count, trace);
      }
      return this.err("EBADF", trace);
    }

    const available = node.content.length - entry.offset;
    const bytesRead = Math.min(count, Math.max(0, available));
    entry.offset += bytesRead;
    trace.push({ mode: "kernel", detail: `${bytesRead} バイト読み取り (offset=${entry.offset})` });
    return this.ok(bytesRead, trace);
  }

  private sysWrite(fd: number, data: string, trace: TraceStep[]): SyscallResult {
    const count = data.length;
    trace.push({ mode: "kernel", detail: `vfs_write(fd=${fd}, count=${count})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined) return this.err("EBADF", trace);

    if (entry.type === "device" || entry.type === "pipe_w") {
      trace.push({ mode: "kernel", detail: `${entry.path}: "${data.slice(0, 40)}${data.length > 40 ? "..." : ""}"` });
      return this.ok(count, trace);
    }

    const node = this.vfs.get(entry.path);
    if (node !== undefined) {
      node.content += data;
      entry.offset += count;
      trace.push({ mode: "kernel", detail: `"${entry.path}" に ${count} バイト書き込み` });
    }
    return this.ok(count, trace);
  }

  private sysLseek(fd: number, offset: number, whence: string, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `vfs_lseek(fd=${fd}, ${offset}, ${whence})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined) return this.err("EBADF", trace);

    if (whence === "SEEK_SET") entry.offset = offset;
    else if (whence === "SEEK_CUR") entry.offset += offset;
    else if (whence === "SEEK_END") {
      const node = this.vfs.get(entry.path);
      entry.offset = (node?.content.length ?? 0) + offset;
    }
    trace.push({ mode: "kernel", detail: `新しい offset = ${entry.offset}` });
    return this.ok(entry.offset, trace);
  }

  private sysStat(path: string, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `vfs_stat("${path}")` });
    const node = this.vfs.get(path);
    if (node === undefined) return this.err("ENOENT", trace);
    const info = `type=${node.type} size=${node.content.length} perm=${node.perm.toString(8)}`;
    trace.push({ mode: "kernel", detail: info });
    return this.ok(0, trace);
  }

  // ── プロセス管理 ──

  private sysFork(trace: TraceStep[]): SyscallResult {
    const parent = this.processes.find((p) => p.state === "running");
    if (parent === undefined) return this.err("EAGAIN", trace);

    const childPid = this.nextPid++;
    trace.push({ mode: "kernel", detail: `copy_process: PID ${parent.pid} → 子 PID ${childPid}` });
    trace.push({ mode: "kernel", detail: "ページテーブル複製 (CoW), fd テーブル複製" });

    this.processes.push({
      pid: childPid,
      ppid: parent.pid,
      state: "running",
      name: parent.name,
    });
    trace.push({ mode: "kernel", detail: `子プロセス PID=${childPid} を実行キューに追加` });
    return this.ok(childPid, trace);
  }

  private sysExecve(path: string, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `do_execve("${path}")` });
    const node = this.vfs.get(path);
    if (node === undefined) {
      trace.push({ mode: "kernel", detail: `実行ファイル "${path}" が見つからない` });
      // シミュレーションでは仮想的に成功させる
    }
    const proc = this.processes.find((p) => p.state === "running" && p.pid !== 1);
    if (proc !== undefined) {
      proc.name = path.split("/").pop() ?? path;
      trace.push({ mode: "kernel", detail: `アドレス空間を置換: text/data/bss/stack を再初期化` });
      trace.push({ mode: "kernel", detail: `プロセス名 → "${proc.name}"` });
    }
    return this.ok(0, trace);
  }

  private sysExit(code: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `do_exit(${code})` });
    const proc = [...this.processes].reverse().find((p) => p.state === "running" && p.pid !== 1 && p.pid !== 100);
    if (proc !== undefined) {
      proc.state = "zombie";
      proc.exitCode = code;
      trace.push({ mode: "kernel", detail: `PID ${proc.pid} → zombie (exit_code=${code})` });
      trace.push({ mode: "kernel", detail: "fd テーブル解放、SIGCHLD を親に送信" });
    }
    return this.ok(0, trace);
  }

  private sysWait(trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: "do_wait: 子プロセスの終了を待機" });
    const zombie = this.processes.find((p) => p.state === "zombie");
    if (zombie !== undefined) {
      const pid = zombie.pid;
      const code = zombie.exitCode ?? 0;
      this.processes = this.processes.filter((p) => p !== zombie);
      trace.push({ mode: "kernel", detail: `子 PID ${pid} を回収 (exit_code=${code})` });
      return this.ok(pid, trace);
    }
    trace.push({ mode: "kernel", detail: "zombie の子プロセスなし" });
    return this.err("ECHILD", trace);
  }

  private sysGetpid(trace: TraceStep[]): SyscallResult {
    const proc = this.processes.find((p) => p.state === "running" && p.pid >= 100);
    const pid = proc?.pid ?? 100;
    trace.push({ mode: "kernel", detail: `current→pid = ${pid}` });
    return this.ok(pid, trace);
  }

  private sysGetppid(trace: TraceStep[]): SyscallResult {
    const proc = this.processes.find((p) => p.state === "running" && p.pid >= 100);
    const ppid = proc?.ppid ?? 1;
    trace.push({ mode: "kernel", detail: `current→ppid = ${ppid}` });
    return this.ok(ppid, trace);
  }

  // ── メモリ管理 ──

  private sysBrk(increment: number, trace: TraceStep[]): SyscallResult {
    const oldBreak = this.heapBreak;
    this.heapBreak += increment;
    trace.push({ mode: "kernel", detail: `heap break: 0x${oldBreak.toString(16)} → 0x${this.heapBreak.toString(16)} (+${increment})` });

    const heap = this.memory.find((m) => m.name === "[heap]");
    if (heap !== undefined) {
      heap.size += increment;
      trace.push({ mode: "kernel", detail: `[heap] サイズ = ${(heap.size / 1024).toFixed(0)} KB` });
    }
    return this.ok(this.heapBreak, trace);
  }

  private sysMmap(size: number, perm: string, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `do_mmap(size=${size}, prot=${perm})` });
    const addr = this.nextMmapAddr;
    this.nextMmapAddr += size + 0x1000;
    this.memory.push({ start: addr, size, perm, name: `[anon:mmap]` });
    trace.push({ mode: "kernel", detail: `マッピング作成: 0x${addr.toString(16)} (${(size / 1024).toFixed(0)} KB)` });
    return this.ok(addr, trace);
  }

  private sysMunmap(addr: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `do_munmap(addr=0x${addr.toString(16)})` });
    const idx = this.memory.findIndex((m) => m.start === addr);
    if (idx === -1) return this.err("EINVAL", trace);
    const region = this.memory[idx]!;
    trace.push({ mode: "kernel", detail: `"${region.name}" (${(region.size / 1024).toFixed(0)} KB) を解放` });
    this.memory.splice(idx, 1);
    return this.ok(0, trace);
  }

  // ── パイプ / IPC ──

  private sysPipe(trace: TraceStep[]): SyscallResult {
    const id = this.pipeCounter++;
    const readFd = this.nextFd++;
    const writeFd = this.nextFd++;
    trace.push({ mode: "kernel", detail: `pipe: fd[0]=${readFd} (read), fd[1]=${writeFd} (write)` });
    this.fdTable.push({ fd: readFd, path: `pipe:[${id}]`, flags: "r", offset: 0, type: "pipe_r" });
    this.fdTable.push({ fd: writeFd, path: `pipe:[${id}]`, flags: "w", offset: 0, type: "pipe_w" });
    trace.push({ mode: "kernel", detail: `カーネルバッファ割り当て (pipe#${id})` });
    return this.ok(0, trace);
  }

  private sysDup2(oldFd: number, newFd: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `dup2(${oldFd}, ${newFd})` });
    const src = this.fdTable.find((e) => e.fd === oldFd);
    if (src === undefined) return this.err("EBADF", trace);

    // 既存の newFd を閉じる
    this.fdTable = this.fdTable.filter((e) => e.fd !== newFd);
    this.fdTable.push({ ...src, fd: newFd });
    trace.push({ mode: "kernel", detail: `fd ${newFd} → "${src.path}" (fd ${oldFd} の複製)` });
    return this.ok(newFd, trace);
  }

  // ── ソケット ──

  private sysSocket(domain: string, type: string, trace: TraceStep[]): SyscallResult {
    const id = this.socketCounter++;
    const fd = this.nextFd++;
    trace.push({ mode: "kernel", detail: `socket(${domain}, ${type}) → fd=${fd}` });
    this.fdTable.push({ fd, path: `socket:[${id}]`, flags: "rw", offset: 0, type: "socket" });
    trace.push({ mode: "kernel", detail: `プロトコルスタック初期化 (${domain}/${type})` });
    return this.ok(fd, trace);
  }

  private sysBind(fd: number, addr: string, port: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `bind(fd=${fd}, ${addr}:${port})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined || entry.type !== "socket") return this.err("EBADF", trace);
    entry.path = `socket:[${addr}:${port}]`;
    trace.push({ mode: "kernel", detail: `ソケットをアドレス ${addr}:${port} にバインド` });
    return this.ok(0, trace);
  }

  private sysListen(fd: number, backlog: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `listen(fd=${fd}, backlog=${backlog})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined || entry.type !== "socket") return this.err("EBADF", trace);
    trace.push({ mode: "kernel", detail: `接続キュー作成 (最大 ${backlog} 接続)` });
    return this.ok(0, trace);
  }

  private sysAccept(fd: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `accept(fd=${fd})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined || entry.type !== "socket") return this.err("EBADF", trace);
    const newFd = this.nextFd++;
    const clientPort = 40000 + Math.floor(Math.random() * 10000);
    this.fdTable.push({ fd: newFd, path: `socket:[client:${clientPort}]`, flags: "rw", offset: 0, type: "socket" });
    trace.push({ mode: "kernel", detail: `新規接続 fd=${newFd} (client port=${clientPort})` });
    return this.ok(newFd, trace);
  }

  private sysConnect(fd: number, addr: string, port: number, trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: `connect(fd=${fd}, ${addr}:${port})` });
    const entry = this.fdTable.find((e) => e.fd === fd);
    if (entry === undefined || entry.type !== "socket") return this.err("EBADF", trace);
    entry.path = `socket:[→${addr}:${port}]`;
    trace.push({ mode: "kernel", detail: `TCP 3-way handshake: SYN → SYN-ACK → ACK` });
    trace.push({ mode: "kernel", detail: `接続確立: ${addr}:${port}` });
    return this.ok(0, trace);
  }

  // ── シグナル ──

  private sysKill(pid: number, sig: number, trace: TraceStep[]): SyscallResult {
    const sigName = SIG_NAMES[sig] ?? `SIG${sig}`;
    trace.push({ mode: "kernel", detail: `send_signal(pid=${pid}, ${sigName})` });
    const proc = this.processes.find((p) => p.pid === pid);
    if (proc === undefined) {
      trace.push({ mode: "kernel", detail: `PID ${pid} が見つからない` });
      return this.err("EINVAL", trace);
    }
    if (sig === 9 || sig === 15) {
      proc.state = "zombie";
      proc.exitCode = 128 + sig;
      trace.push({ mode: "kernel", detail: `PID ${pid} に ${sigName} を配信 → 終了` });
    } else {
      trace.push({ mode: "kernel", detail: `PID ${pid} に ${sigName} を配信` });
    }
    return this.ok(0, trace);
  }

  // ── システム情報 ──

  private sysUname(trace: TraceStep[]): SyscallResult {
    trace.push({ mode: "kernel", detail: "utsname 構造体をコピー" });
    trace.push({ mode: "kernel", detail: 'sysname="Linux" release="6.1.0-sim" machine="x86_64"' });
    return this.ok(0, trace);
  }

  // ── ヘルパー ──

  private ok(value: number, trace: TraceStep[]): SyscallResult {
    return { returnValue: value, errno: 0, errname: "", trace };
  }

  private err(errname: string, trace: TraceStep[]): SyscallResult {
    const errno = ERRNO[errname] ?? 22;
    trace.push({ mode: "kernel", detail: `エラー: ${errname} (errno=${errno})` });
    return { returnValue: -1, errno, errname, trace };
  }
}

/** システムコール番号テーブル (x86_64) */
const SYSCALL_TABLE: Record<string, number> = {
  read: 0, write: 1, open: 2, close: 3, stat: 4, lseek: 8,
  mmap: 9, munmap: 11, brk: 12, pipe: 22, dup2: 33,
  fork: 57, execve: 59, exit: 60, wait: 61, kill: 62,
  uname: 63, getpid: 39, getppid: 110,
  socket: 41, connect: 42, accept: 43, bind: 49, listen: 50,
};

/** シグナル名 */
const SIG_NAMES: Record<number, string> = {
  1: "SIGHUP", 2: "SIGINT", 3: "SIGQUIT", 9: "SIGKILL",
  11: "SIGSEGV", 13: "SIGPIPE", 14: "SIGALRM", 15: "SIGTERM",
  17: "SIGCHLD", 19: "SIGSTOP", 20: "SIGTSTP",
};
