/**
 * process.ts — Unix プロセスエミュレーションエンジン
 *
 * fork / exec / wait / exit / signal / pipe / IPC、
 * プロセス状態遷移、スケジューリング、メモリマップ、
 * ファイルディスクリプタをシミュレーションする。
 */

// ── 基本型 ──

/** プロセス状態 */
export type ProcState = "created" | "ready" | "running" | "sleeping" | "stopped" | "zombie" | "terminated";

/** シグナル */
export type Signal = "SIGHUP" | "SIGINT" | "SIGQUIT" | "SIGKILL" | "SIGTERM" | "SIGSTOP" | "SIGCONT" | "SIGCHLD" | "SIGUSR1" | "SIGUSR2" | "SIGPIPE" | "SIGALRM" | "SIGSEGV";

/** シグナル番号 */
export const SIG_NUM: Record<Signal, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15, SIGSTOP: 19,
  SIGCONT: 18, SIGCHLD: 17, SIGUSR1: 10, SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGSEGV: 11,
};

/** シグナルハンドラのデフォルト動作 */
export const SIG_DEFAULT: Record<Signal, "terminate" | "stop" | "continue" | "ignore" | "core"> = {
  SIGHUP: "terminate", SIGINT: "terminate", SIGQUIT: "core", SIGKILL: "terminate",
  SIGTERM: "terminate", SIGSTOP: "stop", SIGCONT: "continue", SIGCHLD: "ignore",
  SIGUSR1: "terminate", SIGUSR2: "terminate", SIGPIPE: "terminate", SIGALRM: "terminate", SIGSEGV: "core",
};

/** ファイルディスクリプタ */
export interface FileDescriptor {
  fd: number;
  type: "file" | "pipe-read" | "pipe-write" | "socket" | "device";
  path: string;
  /** 読み取り可能か */
  readable: boolean;
  /** 書き込み可能か */
  writable: boolean;
}

/** メモリ領域 */
export interface MemoryRegion {
  name: string;
  startAddr: string;
  endAddr: string;
  size: number;
  permissions: string;
  /** CoW (fork 時) */
  cow: boolean;
}

/** プロセス */
export interface Process {
  pid: number;
  ppid: number;
  name: string;
  state: ProcState;
  /** 実行バイナリパス */
  execPath: string;
  /** コマンドライン引数 */
  argv: string[];
  /** 環境変数 (抜粋) */
  env: Record<string, string>;
  /** UID */
  uid: number;
  /** GID */
  gid: number;
  /** 優先度 (nice 値) */
  nice: number;
  /** CPU 使用時間 (ms) */
  cpuTime: number;
  /** メモリ使用量 (KB) */
  memoryKb: number;
  /** ファイルディスクリプタ */
  fds: FileDescriptor[];
  /** メモリマップ */
  memoryMap: MemoryRegion[];
  /** シグナルハンドラ (カスタム登録済み) */
  signalHandlers: Partial<Record<Signal, "handle" | "ignore">>;
  /** 終了コード */
  exitCode?: number;
  /** 子プロセス PID 一覧 */
  children: number[];
}

/** パイプ */
export interface Pipe {
  id: number;
  readFd: number;
  writeFd: number;
  /** パイプ名 */
  name: string;
  /** バッファ内データ */
  buffer: string[];
}

/** カーネル操作 */
export type SyscallOp =
  | { op: "fork"; parentPid: number; childName: string; childExec?: string }
  | { op: "exec"; pid: number; newExec: string; argv: string[] }
  | { op: "exit"; pid: number; code: number }
  | { op: "wait"; pid: number; targetPid?: number }
  | { op: "kill"; senderPid: number; targetPid: number; signal: Signal }
  | { op: "pipe"; pid: number; name: string }
  | { op: "write"; pid: number; fd: number; data: string }
  | { op: "read"; pid: number; fd: number }
  | { op: "dup2"; pid: number; oldFd: number; newFd: number }
  | { op: "close"; pid: number; fd: number }
  | { op: "sleep"; pid: number; ms: number }
  | { op: "nice"; pid: number; value: number }
  | { op: "schedule" };

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  layer: "Kernel" | "Syscall" | "Signal" | "Sched" | "Memory" | "IPC" | "FD" | "App";
  type: "info" | "create" | "state" | "signal" | "ipc" | "fd" | "error" | "exit";
  detail: string;
  pid?: number;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  processes: Process[];
  pipes: Pipe[];
  /** プロセスツリー */
  processTree: { pid: number; ppid: number; name: string; state: ProcState }[];
  totalTime: number;
}

// ── シミュレーター ──

export class ProcessSimulator {
  private procs: Map<number, Process> = new Map();
  private pipes: Pipe[] = [];
  private nextPid = 1;
  private nextPipeId = 1;
  private nextFd = 3;

  simulate(initProc: Omit<Process, "pid" | "ppid" | "children" | "state" | "cpuTime" | "exitCode">, ops: SyscallOp[]): SimResult {
    const events: SimEvent[] = [];
    let time = 0;

    // init プロセス (PID 1)
    const init: Process = {
      ...initProc, pid: this.nextPid++, ppid: 0, children: [],
      state: "running", cpuTime: 0, exitCode: undefined,
    };
    this.procs.set(init.pid, init);
    events.push({ time, layer: "Kernel", type: "create", detail: `プロセス作成: PID=${init.pid} "${init.name}" (${init.execPath})`, pid: init.pid });
    this.logMemoryMap(init, time, events);

    for (const op of ops) {
      time += 2;
      switch (op.op) {
        case "fork": this.handleFork(op, time, events); break;
        case "exec": this.handleExec(op, time, events); break;
        case "exit": this.handleExit(op, time, events); break;
        case "wait": this.handleWait(op, time, events); break;
        case "kill": this.handleKill(op, time, events); break;
        case "pipe": this.handlePipe(op, time, events); break;
        case "write": this.handleWrite(op, time, events); break;
        case "read": this.handleRead(op, time, events); break;
        case "dup2": this.handleDup2(op, time, events); break;
        case "close": this.handleClose(op, time, events); break;
        case "sleep": this.handleSleep(op, time, events); break;
        case "nice": this.handleNice(op, time, events); break;
        case "schedule": this.handleSchedule(time, events); break;
      }
    }

    const processTree = [...this.procs.values()].map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, state: p.state }));
    return { events, processes: [...this.procs.values()], pipes: this.pipes, processTree, totalTime: time };
  }

  private handleFork(op: Extract<SyscallOp, { op: "fork" }>, time: number, events: SimEvent[]): void {
    const parent = this.procs.get(op.parentPid);
    if (!parent) { events.push({ time, layer: "Syscall", type: "error", detail: `fork 失敗: PID=${op.parentPid} が存在しない` }); return; }

    const childPid = this.nextPid++;
    const child: Process = {
      pid: childPid, ppid: parent.pid, name: op.childName,
      state: "ready", execPath: op.childExec ?? parent.execPath, argv: [...parent.argv],
      env: { ...parent.env }, uid: parent.uid, gid: parent.gid, nice: parent.nice,
      cpuTime: 0, memoryKb: parent.memoryKb,
      fds: parent.fds.map((fd) => ({ ...fd })),
      memoryMap: parent.memoryMap.map((r) => ({ ...r, cow: true })),
      signalHandlers: { ...parent.signalHandlers },
      children: [],
    };
    this.procs.set(childPid, child);
    parent.children.push(childPid);

    events.push({ time, layer: "Syscall", type: "create", detail: `fork(): PID=${parent.pid} → 子 PID=${childPid} "${op.childName}"`, pid: parent.pid });
    events.push({ time, layer: "Memory", type: "info", detail: `CoW (Copy-on-Write): 親のメモリマップをマーク (${child.memoryMap.length} 領域)`, pid: childPid });
    events.push({ time, layer: "FD", type: "fd", detail: `ファイルディスクリプタ継承: ${child.fds.map((f) => `fd${f.fd}(${f.type})`).join(", ")}`, pid: childPid });

    // SIGCHLD を親に通知 (後で)
    events.push({ time, layer: "Signal", type: "signal", detail: `SIGCHLD → PID=${parent.pid} (子プロセス作成)`, pid: parent.pid });
  }

  private handleExec(op: Extract<SyscallOp, { op: "exec" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;

    events.push({ time, layer: "Syscall", type: "state", detail: `exec("${op.newExec}", [${op.argv.join(", ")}])`, pid: op.pid });

    // メモリマップを新しいバイナリで置換
    const oldMap = proc.memoryMap.length;
    proc.execPath = op.newExec;
    proc.argv = op.argv;
    proc.name = op.newExec.split("/").pop() ?? op.newExec;
    proc.memoryMap = defaultMemoryMap(op.newExec);
    proc.signalHandlers = {};
    proc.state = "running";

    events.push({ time, layer: "Memory", type: "info", detail: `アドレス空間置換: ${oldMap} 領域 → ${proc.memoryMap.length} 領域 (${op.newExec})`, pid: op.pid });
    this.logMemoryMap(proc, time, events);
    events.push({ time, layer: "FD", type: "fd", detail: `FD はそのまま継承 (close-on-exec 以外)`, pid: op.pid });
  }

  private handleExit(op: Extract<SyscallOp, { op: "exit" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;

    proc.exitCode = op.code;
    proc.state = "zombie";
    events.push({ time, layer: "Syscall", type: "exit", detail: `exit(${op.code}): PID=${op.pid} → zombie (親の wait 待ち)`, pid: op.pid });

    // FD をクローズ
    events.push({ time, layer: "FD", type: "fd", detail: `全 FD クローズ: ${proc.fds.map((f) => `fd${f.fd}`).join(", ")}`, pid: op.pid });
    proc.fds = [];

    // 親に SIGCHLD
    const parent = this.procs.get(proc.ppid);
    if (parent) {
      events.push({ time, layer: "Signal", type: "signal", detail: `SIGCHLD → PID=${parent.pid} (子 PID=${op.pid} 終了, code=${op.code})`, pid: parent.pid });
    }

    // 孤児プロセスを init (PID=1) に再配置
    for (const childPid of proc.children) {
      const child = this.procs.get(childPid);
      if (child && child.state !== "terminated") {
        child.ppid = 1;
        events.push({ time, layer: "Kernel", type: "info", detail: `孤児プロセス: PID=${childPid} の親を init (PID=1) に変更`, pid: childPid });
      }
    }
  }

  private handleWait(op: Extract<SyscallOp, { op: "wait" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;

    // zombie の子を探す
    const target = op.targetPid
      ? this.procs.get(op.targetPid)
      : [...this.procs.values()].find((p) => p.ppid === op.pid && p.state === "zombie");

    if (target && target.state === "zombie") {
      events.push({ time, layer: "Syscall", type: "state", detail: `wait(): PID=${target.pid} を回収 (exit code=${target.exitCode})`, pid: op.pid });
      target.state = "terminated";
      events.push({ time, layer: "Kernel", type: "info", detail: `PID=${target.pid} のプロセステーブルエントリ解放`, pid: target.pid });
    } else {
      events.push({ time, layer: "Syscall", type: "state", detail: `wait(): 終了した子なし → PID=${op.pid} がブロック (sleeping)`, pid: op.pid });
      proc.state = "sleeping";
    }
  }

  private handleKill(op: Extract<SyscallOp, { op: "kill" }>, time: number, events: SimEvent[]): void {
    const target = this.procs.get(op.targetPid);
    if (!target) { events.push({ time, layer: "Syscall", type: "error", detail: `kill: PID=${op.targetPid} が存在しない`, pid: op.senderPid }); return; }

    events.push({ time, layer: "Signal", type: "signal", detail: `kill(${op.targetPid}, ${op.signal}[${SIG_NUM[op.signal]}])`, pid: op.senderPid });

    // SIGKILL / SIGSTOP はハンドラ無視
    if (op.signal === "SIGKILL") {
      target.state = "zombie";
      target.exitCode = 128 + SIG_NUM.SIGKILL;
      events.push({ time, layer: "Signal", type: "exit", detail: `SIGKILL: PID=${op.targetPid} を強制終了 (捕捉不可)`, pid: op.targetPid });
      return;
    }
    if (op.signal === "SIGSTOP") {
      target.state = "stopped";
      events.push({ time, layer: "Signal", type: "state", detail: `SIGSTOP: PID=${op.targetPid} を停止 (捕捉不可)`, pid: op.targetPid });
      return;
    }
    if (op.signal === "SIGCONT") {
      if (target.state === "stopped") { target.state = "ready"; }
      events.push({ time, layer: "Signal", type: "state", detail: `SIGCONT: PID=${op.targetPid} を再開`, pid: op.targetPid });
      return;
    }

    // カスタムハンドラ確認
    const handler = target.signalHandlers[op.signal];
    if (handler === "ignore") {
      events.push({ time, layer: "Signal", type: "info", detail: `${op.signal}: PID=${op.targetPid} はハンドラで無視`, pid: op.targetPid });
      return;
    }
    if (handler === "handle") {
      events.push({ time, layer: "Signal", type: "signal", detail: `${op.signal}: PID=${op.targetPid} のカスタムハンドラ実行`, pid: op.targetPid });
      return;
    }

    // デフォルト動作
    const defAction = SIG_DEFAULT[op.signal];
    if (defAction === "terminate" || defAction === "core") {
      target.state = "zombie";
      target.exitCode = 128 + SIG_NUM[op.signal];
      events.push({ time, layer: "Signal", type: "exit", detail: `${op.signal} デフォルト動作: PID=${op.targetPid} 終了${defAction === "core" ? " (core dump)" : ""}`, pid: op.targetPid });
    } else if (defAction === "stop") {
      target.state = "stopped";
      events.push({ time, layer: "Signal", type: "state", detail: `${op.signal}: PID=${op.targetPid} 停止`, pid: op.targetPid });
    } else {
      events.push({ time, layer: "Signal", type: "info", detail: `${op.signal}: デフォルト動作 = 無視`, pid: op.targetPid });
    }
  }

  private handlePipe(op: Extract<SyscallOp, { op: "pipe" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;

    const readFd = this.nextFd++;
    const writeFd = this.nextFd++;
    const pipe: Pipe = { id: this.nextPipeId++, readFd, writeFd, name: op.name, buffer: [] };
    this.pipes.push(pipe);

    proc.fds.push({ fd: readFd, type: "pipe-read", path: `pipe:[${pipe.id}]`, readable: true, writable: false });
    proc.fds.push({ fd: writeFd, type: "pipe-write", path: `pipe:[${pipe.id}]`, readable: false, writable: true });

    events.push({ time, layer: "Syscall", type: "ipc", detail: `pipe(): fd[${readFd}](read), fd[${writeFd}](write) → "${op.name}"`, pid: op.pid });
  }

  private handleWrite(op: Extract<SyscallOp, { op: "write" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;
    const fd = proc.fds.find((f) => f.fd === op.fd);
    if (!fd) { events.push({ time, layer: "Syscall", type: "error", detail: `write: fd${op.fd} が存在しない`, pid: op.pid }); return; }

    if (fd.type === "pipe-write") {
      const pipe = this.pipes.find((p) => p.writeFd === op.fd);
      if (pipe) { pipe.buffer.push(op.data); }
    }
    events.push({ time, layer: "IPC", type: "ipc", detail: `write(fd${op.fd}, "${op.data.slice(0, 40)}${op.data.length > 40 ? "..." : ""}", ${op.data.length}) → ${fd.path}`, pid: op.pid });
  }

  private handleRead(op: Extract<SyscallOp, { op: "read" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;
    const fd = proc.fds.find((f) => f.fd === op.fd);
    if (!fd) { events.push({ time, layer: "Syscall", type: "error", detail: `read: fd${op.fd} が存在しない`, pid: op.pid }); return; }

    let data = "(empty)";
    if (fd.type === "pipe-read") {
      const pipe = this.pipes.find((p) => p.readFd === op.fd);
      if (pipe && pipe.buffer.length > 0) { data = pipe.buffer.shift()!; }
    }
    events.push({ time, layer: "IPC", type: "ipc", detail: `read(fd${op.fd}) → "${data.slice(0, 40)}" from ${fd.path}`, pid: op.pid });
  }

  private handleDup2(op: Extract<SyscallOp, { op: "dup2" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;
    const src = proc.fds.find((f) => f.fd === op.oldFd);
    if (!src) return;
    // newFd があれば閉じる
    proc.fds = proc.fds.filter((f) => f.fd !== op.newFd);
    proc.fds.push({ ...src, fd: op.newFd });
    events.push({ time, layer: "FD", type: "fd", detail: `dup2(${op.oldFd}, ${op.newFd}): fd${op.newFd} → ${src.path}`, pid: op.pid });
  }

  private handleClose(op: Extract<SyscallOp, { op: "close" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;
    const fd = proc.fds.find((f) => f.fd === op.fd);
    proc.fds = proc.fds.filter((f) => f.fd !== op.fd);
    events.push({ time, layer: "FD", type: "fd", detail: `close(${op.fd})${fd ? ` — ${fd.path}` : ""}`, pid: op.pid });
  }

  private handleSleep(op: Extract<SyscallOp, { op: "sleep" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;
    proc.state = "sleeping";
    events.push({ time, layer: "Syscall", type: "state", detail: `sleep(${op.ms}ms): PID=${op.pid} → sleeping`, pid: op.pid });
    // 起床
    proc.state = "ready";
    events.push({ time: time + op.ms, layer: "Sched", type: "state", detail: `PID=${op.pid} 起床 → ready (SIGALRM)`, pid: op.pid });
  }

  private handleNice(op: Extract<SyscallOp, { op: "nice" }>, time: number, events: SimEvent[]): void {
    const proc = this.procs.get(op.pid);
    if (!proc) return;
    const old = proc.nice;
    proc.nice = Math.max(-20, Math.min(19, op.value));
    events.push({ time, layer: "Sched", type: "info", detail: `nice: PID=${op.pid} 優先度 ${old} → ${proc.nice}`, pid: op.pid });
  }

  private handleSchedule(time: number, events: SimEvent[]): void {
    const ready = [...this.procs.values()].filter((p) => p.state === "ready" || p.state === "running");
    if (ready.length === 0) return;
    // CFS 風: nice 値でソート
    ready.sort((a, b) => a.nice - b.nice);
    for (const p of ready) {
      p.state = "running";
      p.cpuTime += 10;
    }
    events.push({ time, layer: "Sched", type: "info", detail: `スケジューラ: ${ready.map((p) => `PID=${p.pid}(nice=${p.nice})`).join(", ")} を実行` });
  }

  private logMemoryMap(proc: Process, time: number, events: SimEvent[]): void {
    for (const r of proc.memoryMap) {
      events.push({ time, layer: "Memory", type: "info", detail: `  ${r.startAddr}-${r.endAddr} ${r.permissions} ${r.name}${r.cow ? " [CoW]" : ""} (${r.size}KB)`, pid: proc.pid });
    }
  }
}

// ── ヘルパー ──

/** デフォルトのメモリマップを生成する */
export function defaultMemoryMap(execPath: string): MemoryRegion[] {
  return [
    { name: `${execPath} .text`, startAddr: "0x00400000", endAddr: "0x00420000", size: 128, permissions: "r-xp", cow: false },
    { name: `${execPath} .data`, startAddr: "0x00620000", endAddr: "0x00621000", size: 4, permissions: "rw-p", cow: false },
    { name: "[heap]", startAddr: "0x00700000", endAddr: "0x00800000", size: 1024, permissions: "rw-p", cow: false },
    { name: "libc.so.6", startAddr: "0x7f000000", endAddr: "0x7f200000", size: 2048, permissions: "r-xp", cow: false },
    { name: "[stack]", startAddr: "0x7fffe000", endAddr: "0x7ffff000", size: 8192, permissions: "rw-p", cow: false },
    { name: "[vdso]", startAddr: "0x7ffff000", endAddr: "0x7ffff800", size: 4, permissions: "r-xp", cow: false },
  ];
}

/** デフォルトの FD を生成する */
export function defaultFds(): FileDescriptor[] {
  return [
    { fd: 0, type: "device", path: "/dev/pts/0", readable: true, writable: false },
    { fd: 1, type: "device", path: "/dev/pts/0", readable: false, writable: true },
    { fd: 2, type: "device", path: "/dev/pts/0", readable: false, writable: true },
  ];
}

/** 初期プロセスを作成する */
export function createInitProc(name: string, exec: string, opts?: { argv?: string[]; uid?: number; nice?: number; env?: Record<string, string>; memKb?: number; fds?: FileDescriptor[]; handlers?: Partial<Record<Signal, "handle" | "ignore">> }): Omit<Process, "pid" | "ppid" | "children" | "state" | "cpuTime" | "exitCode"> {
  return {
    name, execPath: exec, argv: opts?.argv ?? [exec],
    env: opts?.env ?? { PATH: "/usr/bin:/bin", HOME: "/root", SHELL: "/bin/bash" },
    uid: opts?.uid ?? 0, gid: opts?.uid ?? 0, nice: opts?.nice ?? 0,
    memoryKb: opts?.memKb ?? 4096, fds: opts?.fds ?? defaultFds(),
    memoryMap: defaultMemoryMap(exec),
    signalHandlers: opts?.handlers ?? {},
  };
}
