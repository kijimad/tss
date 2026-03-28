/**
 * kernel.ts — カーネル本体
 *
 * ハードウェア（CPU, メモリ, ディスク, タイマー）の上で動作し、
 * プロセス管理、メモリ管理、ファイルシステム、システムコールを提供する。
 *
 * 起動シーケンス:
 *   1. ハードウェア初期化
 *   2. ファイルシステム初期化
 *   3. init プロセス（シェル）を生成
 *   4. スケジューラ開始
 */
import { Cpu } from "../hw/cpu.js";
import { Memory } from "../hw/memory.js";
import { Timer } from "../hw/timer.js";
import { Disk } from "../hw/disk.js";
import { assemble } from "../hw/assembler.js";
import { Register, InterruptType, MemoryLayout, type HwEvent } from "../hw/types.js";
import { ProcessTable, ProcessState, type Process } from "./process.js";
import { SyscallNumber } from "./syscall.js";
import { FileSystem } from "../fs/filesystem.js";

// ユーザプログラムの割り当てメモリ（プロセスごとに分割）
const PROCESS_MEM_SIZE = 0x1000; // 4KB per process

export class Kernel {
  readonly cpu: Cpu;
  readonly memory: Memory;
  readonly timer: Timer;
  readonly disk: Disk;
  readonly processTable: ProcessTable;
  readonly fs: FileSystem;

  // カーネルイベント
  onEvent: ((event: HwEvent) => void) | undefined;
  // コンソール出力コールバック（シェルUIが受け取る）
  onConsoleOutput: ((pid: number, text: string) => void) | undefined;
  // コンソール入力バッファ
  private inputBuffer: string[] = [];
  private inputWaiters: { pid: number; addr: number; maxLen: number }[] = [];

  // 次のプロセスに割り当てるメモリ開始位置
  private nextProcessMem: number = MemoryLayout.UserStart;

  constructor() {
    this.memory = new Memory();
    this.timer = new Timer();
    this.cpu = new Cpu(this.memory, this.timer);
    this.disk = new Disk();
    this.processTable = new ProcessTable();
    this.fs = new FileSystem();

    // CPU割り込みハンドラを設定
    this.cpu.setInterruptHandler((type, data) => this.handleInterrupt(type, data));

    // イベント転送
    this.cpu.onEvent = (e) => this.onEvent?.(e);
    this.memory.onEvent = (e) => this.onEvent?.(e);
    this.disk.onEvent = (e) => this.onEvent?.(e);
    this.timer.onEvent = (e) => this.onEvent?.(e);
  }

  // カーネル起動
  boot(): void {
    // ファイルシステムに組み込みプログラムを配置
    this.installBuiltinPrograms();

    // タイマー有効化（プリエンプティブスケジューリング）
    this.timer.interval = 50;
    this.timer.enabled = true;

    // init プロセスを起動（最初のプロセス）
    this.spawnProgram("shell", 0);
  }

  // プログラムを新しいプロセスとして起動
  spawnProgram(name: string, parentPid: number): Process | undefined {
    // ファイルシステムからプログラムを読み取る
    const source = this.fs.readTextFile(`/bin/${name}`);
    if (source === undefined) return undefined;

    // メモリ領域を割り当て
    const memStart = this.nextProcessMem;
    const memEnd = memStart + PROCESS_MEM_SIZE;
    if (memEnd > MemoryLayout.UserEnd) return undefined; // メモリ不足
    this.nextProcessMem = memEnd;

    // アセンブル & ロード
    const code = assemble(source, memStart);
    this.memory.loadBytes(memStart, code);

    // プロセス作成
    const proc = this.processTable.create(name, memStart, memEnd, memStart, parentPid);
    // SP をプロセスのメモリ末尾に設定
    proc.registers[Register.SP] = memEnd;

    return proc;
  }

  // CPU を1ステップ実行
  step(): boolean {
    if (this.processTable.listActive().length === 0) return false;

    // 現在のプロセスがなければスケジュール
    if (this.processTable.currentPid === 0) {
      this.schedule();
    }

    return this.cpu.step();
  }

  // 指定サイクル数実行
  run(cycles: number): number {
    let executed = 0;
    for (let i = 0; i < cycles; i++) {
      if (!this.step()) break;
      executed++;
    }
    return executed;
  }

  // コンソール入力を受け取る
  pushInput(text: string): void {
    this.inputBuffer.push(text);
    this.processInputWaiters();
  }

  // === 割り込み処理 ===

  private handleInterrupt(type: InterruptType, data: number): void {
    switch (type) {
      case InterruptType.Timer:
        this.handleTimerInterrupt();
        break;
      case InterruptType.Syscall:
        this.handleSyscall(data);
        break;
    }
  }

  // タイマー割り込み → コンテキストスイッチ
  private handleTimerInterrupt(): void {
    this.schedule();
  }

  // スケジューリング: 現在のプロセスを退避し、次のプロセスに切り替え
  private schedule(): void {
    // 現在のプロセスのレジスタを保存
    const current = this.processTable.getCurrent();
    if (current !== undefined && current.state === ProcessState.Running) {
      this.saveContext(current);
      current.state = ProcessState.Ready;
    }

    // 次のプロセスを選択
    const next = this.processTable.scheduleNext();
    if (next === undefined) {
      this.processTable.currentPid = 0;
      return;
    }

    // コンテキスト復元
    next.state = ProcessState.Running;
    this.processTable.currentPid = next.pid;
    this.restoreContext(next);
  }

  // レジスタ状態をプロセスに保存
  private saveContext(proc: Process): void {
    for (let i = 0; i < proc.registers.length; i++) {
      proc.registers[i] = this.cpu.registers[i] ?? 0;
    }
  }

  // プロセスのレジスタ状態を CPU に復元
  private restoreContext(proc: Process): void {
    for (let i = 0; i < proc.registers.length; i++) {
      this.cpu.registers[i] = proc.registers[i] ?? 0;
    }
  }

  // === システムコール処理 ===

  private handleSyscall(syscallNum: number): void {
    const proc = this.processTable.getCurrent();
    if (proc === undefined) return;

    const r1 = this.cpu.registers[Register.R1] ?? 0;
    const r2 = this.cpu.registers[Register.R2] ?? 0;
    const r3 = this.cpu.registers[Register.R3] ?? 0;

    switch (syscallNum) {
      case SyscallNumber.Exit:
        this.sysExit(proc, r1);
        break;
      case SyscallNumber.Write:
        this.sysWrite(proc, r1, r2, r3);
        break;
      case SyscallNumber.Read:
        this.sysRead(proc, r1, r2, r3);
        break;
      case SyscallNumber.GetPid:
        this.cpu.registers[Register.R0] = proc.pid;
        break;
      case SyscallNumber.Fork:
        this.sysFork(proc);
        break;
      case SyscallNumber.Exec:
        this.sysExec(proc, r1, r2);
        break;
      case SyscallNumber.Mkdir:
        this.sysMkdir(r1, r2);
        break;
      case SyscallNumber.ReadDir:
        this.sysReadDir(r1, r2, r3);
        break;
    }
  }

  // exit(code): プロセス終了
  private sysExit(proc: Process, code: number): void {
    proc.state = ProcessState.Terminated;
    proc.exitCode = code;
    this.schedule();
  }

  // write(fd, addr, len): メモリからテキストを読み出して出力
  //   fd=1: stdout
  private sysWrite(proc: Process, fd: number, addr: number, len: number): void {
    if (fd !== 1) return; // stdout のみサポート

    let text = "";
    for (let i = 0; i < len; i++) {
      const byte = this.memory.readByte(addr + i);
      if (byte === 0) break; // NUL 終端
      text += String.fromCharCode(byte);
    }

    proc.stdout += text;
    this.onConsoleOutput?.(proc.pid, text);
    this.cpu.registers[Register.R0] = text.length;
  }

  // read(fd, addr, maxLen): 入力バッファからデータを読む
  //   fd=0: stdin
  private sysRead(proc: Process, fd: number, addr: number, maxLen: number): void {
    if (fd !== 0) return;

    if (this.inputBuffer.length > 0) {
      const input = this.inputBuffer.shift() ?? "";
      this.writeStringToMemory(addr, input, maxLen);
      this.cpu.registers[Register.R0] = Math.min(input.length, maxLen);
    } else {
      // 入力がない → ブロック
      proc.state = ProcessState.Blocked;
      this.inputWaiters.push({ pid: proc.pid, addr, maxLen });
      this.schedule();
    }
  }

  // 入力待ちプロセスにデータを渡す
  private processInputWaiters(): void {
    while (this.inputWaiters.length > 0 && this.inputBuffer.length > 0) {
      const waiter = this.inputWaiters.shift();
      if (waiter === undefined) break;
      const input = this.inputBuffer.shift() ?? "";

      const proc = this.processTable.get(waiter.pid);
      if (proc === undefined || proc.state !== ProcessState.Blocked) continue;

      // 入力データをメモリに書き込む
      this.writeStringToMemory(waiter.addr, input, waiter.maxLen);

      // プロセスを再開
      proc.state = ProcessState.Ready;
      // 戻り値（読み取ったバイト数）を R0 に設定
      proc.registers[Register.R0] = Math.min(input.length, waiter.maxLen);
    }
  }

  // fork(): 現在のプロセスを複製
  private sysFork(proc: Process): void {
    const child = this.spawnProgram(proc.name, proc.pid);
    if (child === undefined) {
      this.cpu.registers[Register.R0] = 0; // エラー
      return;
    }
    // 親には子のPID、子には0を返す
    this.cpu.registers[Register.R0] = child.pid;
    child.registers[Register.R0] = 0;
  }

  // exec(pathAddr, pathLen): 新しいプログラムを実行
  private sysExec(proc: Process, pathAddr: number, pathLen: number): void {
    const path = this.readStringFromMemory(pathAddr, pathLen);
    const source = this.fs.readTextFile(path);
    if (source === undefined) {
      this.cpu.registers[Register.R0] = 0xFFFF; // エラー
      return;
    }

    // 現在のプロセスのメモリを再利用してプログラムを上書き
    const code = assemble(source, proc.memStart);
    this.memory.loadBytes(proc.memStart, code);
    this.cpu.registers[Register.PC] = proc.memStart;
    this.cpu.registers[Register.SP] = proc.memEnd;
    this.cpu.registers[Register.R0] = 0;
  }

  // mkdir(pathAddr, pathLen)
  private sysMkdir(pathAddr: number, pathLen: number): void {
    const path = this.readStringFromMemory(pathAddr, pathLen);
    const ok = this.fs.mkdir(path);
    this.cpu.registers[Register.R0] = ok ? 0 : 0xFFFF;
  }

  // readdir(pathAddr, pathLen, bufAddr)
  private sysReadDir(pathAddr: number, pathLen: number, bufAddr: number): void {
    const path = this.readStringFromMemory(pathAddr, pathLen);
    const entries = this.fs.listDir(path);
    if (entries === undefined) {
      this.cpu.registers[Register.R0] = 0xFFFF;
      return;
    }

    // エントリ名をNUL区切りでバッファに書き込む
    let offset = 0;
    for (const entry of entries) {
      const name = entry.type === "directory" ? entry.name + "/" : entry.name;
      for (let i = 0; i < name.length; i++) {
        this.memory.writeByte(bufAddr + offset, name.charCodeAt(i));
        offset++;
      }
      this.memory.writeByte(bufAddr + offset, 0x0A); // 改行区切り
      offset++;
    }
    this.memory.writeByte(bufAddr + offset, 0); // 終端
    this.cpu.registers[Register.R0] = entries.length;
  }

  // === ヘルパー ===

  private readStringFromMemory(addr: number, len: number): string {
    let s = "";
    for (let i = 0; i < len; i++) {
      const byte = this.memory.readByte(addr + i);
      if (byte === 0) break;
      s += String.fromCharCode(byte);
    }
    return s;
  }

  private writeStringToMemory(addr: number, str: string, maxLen: number): void {
    const len = Math.min(str.length, maxLen);
    for (let i = 0; i < len; i++) {
      this.memory.writeByte(addr + i, str.charCodeAt(i));
    }
    if (len < maxLen) {
      this.memory.writeByte(addr + len, 0); // NUL終端
    }
  }

  // 組み込みプログラムをファイルシステムに配置
  private installBuiltinPrograms(): void {
    // シェルプログラム（アセンブリ）
    // 簡易実装: 入力を読んで出力するループ
    this.fs.writeFile("/bin/shell", `
; シェル: 入力を読んで表示するループ
; メモリレイアウト: プログラムの後ろにバッファを確保

shell_start:
  ; プロンプト表示
  MOVI R1, 0       ; addr は後で計算
  ADDI R1, 0       ; prompt のアドレス（仮）
  MOVI R0, 1       ; syscall: write
  MOVI R2, 2       ; len: "$ " の2文字
  SYSCALL

  ; 入力待ち
  MOVI R0, 2       ; syscall: read
  MOVI R1, 0       ; stdin
  MOVI R2, 0       ; buffer addr（仮）
  MOVI R3, 256     ; max len
  SYSCALL

  ; 入力をそのまま出力
  MOVI R0, 1       ; syscall: write
  MOVI R1, 1       ; stdout
  ; R2 = buffer addr（上で設定済み）
  ; R3 = 読んだバイト数（R0に入っている → 移す必要あり）
  SYSCALL

  JMP shell_start
`);

    // hello プログラム
    this.fs.writeFile("/bin/hello", `
  MOVI R0, 1       ; syscall: write
  MOVI R1, 1       ; fd: stdout
  MOVI R2, 0       ; addr（仮、カーネルが文字列を直接処理）
  MOVI R3, 14      ; len
  SYSCALL
  MOVI R0, 0       ; syscall: exit
  MOVI R1, 0       ; code: 0
  SYSCALL
`);

    // counter プログラム（1から10まで数える）
    this.fs.writeFile("/bin/counter", `
  MOVI R4, 1       ; カウンタ
  MOVI R5, 11      ; 上限+1
count_loop:
  CMP R4, R5
  JZ count_done
  ; 数字を出力（簡易: カウンタ値を stdout に write）
  MOVI R0, 1       ; syscall: write
  MOVI R1, 1       ; stdout
  MOV R2, R4       ; カウンタ値をアドレスとして渡す
  MOVI R3, 1
  SYSCALL
  ADDI R4, 1
  JMP count_loop
count_done:
  MOVI R0, 0       ; exit
  MOVI R1, 0
  SYSCALL
`);
  }
}
