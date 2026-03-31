/**
 * kernel.ts — システムコールシミュレーションカーネル
 *
 * ユーザモード → トラップ (INT 0x80 / syscall) → カーネルモード → リターン
 * の遷移をシミュレートし、fd テーブル・プロセステーブル・メモリマップを管理する。
 */

// ── 型定義 ──

/** ファイルディスクリプタエントリ */
export interface FdEntry {
  fd: number;
  path: string;
  flags: string;
  offset: number;
  type: "file" | "pipe_r" | "pipe_w" | "socket" | "device";
}

/** プロセス情報 */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  state: "running" | "sleeping" | "zombie" | "stopped";
  name: string;
  exitCode?: number;
}

/** メモリ領域 */
export interface MemRegion {
  start: number;
  size: number;
  perm: string;
  name: string;
}

/** VFS ノード */
export interface VfsNode {
  type: "file" | "dir" | "device";
  content: string;
  perm: number;
}

/** トレースのステップ */
export interface TraceStep {
  mode: "user" | "trap" | "kernel" | "return" | "error";
  detail: string;
}

/** システムコール実行結果 */
export interface SyscallResult {
  returnValue: number;
  errno: number;
  errname: string;
  trace: TraceStep[];
}

/** カーネル状態のスナップショット */
export interface KernelSnapshot {
  fdTable: FdEntry[];
  processes: ProcessInfo[];
  memory: MemRegion[];
}

/** システムコール呼び出し */
export interface SyscallInvocation {
  /** C 風の呼び出し表記 */
  code: string;
  /** システムコール名 */
  name: string;
  /** 引数 */
  args: unknown[];
}

// ── エラー番号 ──

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

export class Kernel {
  private fdTable: FdEntry[] = [];
  private processes: ProcessInfo[] = [];
  private memory: MemRegion[] = [];
  private vfs = new Map<string, VfsNode>();
  private nextFd = 3;
  private nextPid = 101;
  private heapBreak = 0x0040_0000;
  private nextMmapAddr = 0x7f00_0000;
  private pipeCounter = 0;
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
