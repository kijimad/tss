/**
 * process.ts — プロセス管理
 *
 * プロセス = 実行中のプログラム。各プロセスは独立したレジスタ状態を持つ。
 * カーネルがタイマー割り込みでプロセスを切り替える（プリエンプティブスケジューリング）。
 *
 * コンテキストスイッチ:
 *   1. タイマー割り込み発生
 *   2. 現在のプロセスのレジスタ状態を保存
 *   3. 次のプロセスのレジスタ状態を復元
 *   4. CPU が次のプロセスの続きから実行再開
 */

// プロセス状態
export const ProcessState = {
  Ready: "READY",         // 実行可能（CPU 待ち）
  Running: "RUNNING",     // 実行中
  Blocked: "BLOCKED",     // I/O 待ちなどで停止
  Terminated: "TERMINATED", // 終了
} as const;
export type ProcessState = (typeof ProcessState)[keyof typeof ProcessState];

// プロセス制御ブロック (PCB)
// カーネルがプロセスごとに管理する情報
export interface Process {
  pid: number;
  name: string;
  state: ProcessState;
  // 保存されたレジスタ状態（コンテキストスイッチ時に退避）
  registers: Uint16Array;
  // プロセスに割り当てられたメモリ領域
  memStart: number;
  memEnd: number;
  // 標準出力バッファ（シェルで表示するため）
  stdout: string;
  // 終了コード
  exitCode: number;
  // 親プロセスID
  parentPid: number;
}

// プロセステーブル
export class ProcessTable {
  private processes = new Map<number, Process>();
  private nextPid = 1;
  // 現在実行中のプロセスID
  currentPid = 0;

  // プロセス作成
  create(name: string, memStart: number, memEnd: number, pc: number, parentPid = 0): Process {
    const pid = this.nextPid++;
    const registers = new Uint16Array(11);
    registers[8] = pc;          // PC = プログラム開始アドレス
    registers[9] = memEnd;      // SP = 割り当て領域の末尾
    registers[10] = 0x08;       // FLAGS = 割り込み許可

    const proc: Process = {
      pid,
      name,
      state: ProcessState.Ready,
      registers,
      memStart,
      memEnd,
      stdout: "",
      exitCode: 0,
      parentPid,
    };
    this.processes.set(pid, proc);
    return proc;
  }

  get(pid: number): Process | undefined {
    return this.processes.get(pid);
  }

  getCurrent(): Process | undefined {
    return this.processes.get(this.currentPid);
  }

  // 実行可能な次のプロセスを選ぶ（ラウンドロビン）
  scheduleNext(): Process | undefined {
    const pids = [...this.processes.keys()].sort((a, b) => a - b);
    const currentIndex = pids.indexOf(this.currentPid);

    // 現在のプロセスの次から探す
    for (let i = 1; i <= pids.length; i++) {
      const idx = (currentIndex + i) % pids.length;
      const pid = pids[idx];
      if (pid === undefined) continue;
      const proc = this.processes.get(pid);
      if (proc !== undefined && proc.state === ProcessState.Ready) {
        return proc;
      }
    }
    return undefined;
  }

  // 終了したプロセスを除く全プロセスを返す
  listActive(): Process[] {
    const result: Process[] = [];
    for (const [, proc] of this.processes) {
      if (proc.state !== ProcessState.Terminated) {
        result.push(proc);
      }
    }
    return result;
  }

  listAll(): Process[] {
    return [...this.processes.values()];
  }

  remove(pid: number): void {
    this.processes.delete(pid);
  }
}
