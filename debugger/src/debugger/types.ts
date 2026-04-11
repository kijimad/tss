/** レジスタ名 (x86_64) */
export type RegisterName =
  | "rax" | "rbx" | "rcx" | "rdx"
  | "rsi" | "rdi" | "rbp" | "rsp"
  | "r8" | "r9" | "r10" | "r11"
  | "r12" | "r13" | "r14" | "r15"
  | "rip" | "rflags";

/** レジスタセット */
export type Registers = Record<RegisterName, number>;

/** メモリセグメント */
export interface MemorySegment {
  name: string;           // ".text", ".data", "[stack]" など
  start: number;
  size: number;
  perms: string;          // "r-x", "rw-", "r--"
}

/** メモリセル (表示用) */
export interface MemoryCell {
  addr: number;
  value: number;          // 1バイト (0-255)
  ascii: string;
}

/** 変数情報 */
export interface Variable {
  name: string;
  type: string;           // "int", "char*", "struct Point" など
  addr: number;
  size: number;
  value: string;          // 表示用の値
  members?: Variable[];   // 構造体メンバ
}

/** ソースコード行 */
export interface SourceLine {
  lineNo: number;
  text: string;
  addr: number;           // この行に対応する命令アドレス
}

/** ブレークポイント */
export interface Breakpoint {
  id: number;
  addr: number;
  line?: number;
  file?: string;
  condition?: string;     // 条件式 (条件付きブレークポイント)
  hitCount: number;
  enabled: boolean;
  originalByte: number;   // INT3で置き換え前の元のバイト
}

/** ウォッチポイント */
export interface Watchpoint {
  id: number;
  expr: string;           // 監視式
  type: "write" | "read" | "access";
  addr: number;
  size: number;
  oldValue: string;
  currentValue: string;
  hitCount: number;
  enabled: boolean;
}

/** コールスタックフレーム */
export interface StackFrame {
  level: number;          // #0, #1, #2, ...
  funcName: string;
  file: string;
  line: number;
  addr: number;
  frameAddr: number;      // rbp値
  args: Variable[];
  locals: Variable[];
}

/** シグナル情報 (デバッガに渡されるもの) */
export interface SignalInfo {
  signo: number;
  name: string;           // "SIGTRAP", "SIGSEGV" など
  code: string;           // "SI_KERNEL", "TRAP_BRKPT" など
  addr?: number;          // フォルトアドレス (SIGSEGV時)
}

/** ptrace操作 */
export type PtraceOp =
  | "PTRACE_TRACEME"
  | "PTRACE_ATTACH"
  | "PTRACE_PEEKTEXT"
  | "PTRACE_POKETEXT"
  | "PTRACE_PEEKUSER"
  | "PTRACE_POKEUSER"
  | "PTRACE_GETREGS"
  | "PTRACE_SETREGS"
  | "PTRACE_CONT"
  | "PTRACE_SINGLESTEP"
  | "PTRACE_DETACH"
  | "PTRACE_SYSCALL";

/** プロセス状態 */
export type ProcessState =
  | "running"
  | "stopped"             // ブレークポイントやシグナルで停止
  | "stepping"            // ステップ実行中
  | "exited"
  | "signaled";           // シグナルで終了

/** デバッグ対象プロセス */
export interface Debuggee {
  pid: number;
  state: ProcessState;
  exitCode?: number;
  signal?: SignalInfo;
  source: SourceLine[];
  currentLine: number;
  currentAddr: number;
}

/** デバッガコマンド種別 */
export type DebugCommandType =
  | "start"               // プログラム開始 (fork + ptrace)
  | "attach"              // 既存プロセスにアタッチ
  | "detach"              // デタッチ
  | "break"               // ブレークポイント設定
  | "delete_break"        // ブレークポイント削除
  | "enable_break"        // ブレークポイント有効化
  | "disable_break"       // ブレークポイント無効化
  | "cond_break"          // 条件付きブレークポイント
  | "watch"               // ウォッチポイント設定
  | "delete_watch"        // ウォッチポイント削除
  | "continue"            // 実行再開
  | "step"                // ステップイン (1命令)
  | "next"                // ステップオーバー (1行、関数呼び出しは跨ぐ)
  | "step_out"            // ステップアウト (現在の関数から戻る)
  | "run_to"              // 指定行まで実行
  | "print"               // 変数値表示
  | "set_var"             // 変数値変更
  | "examine"             // メモリ読み取り
  | "write_mem"           // メモリ書き込み
  | "backtrace"           // コールスタック表示
  | "frame"               // フレーム選択
  | "info_regs"           // レジスタ表示
  | "set_reg"             // レジスタ変更
  | "signal"              // シグナル送信
  | "catch_signal"        // シグナルキャッチ設定
  | "syscall_trace"       // システムコールトレース
  | "disassemble";        // 逆アセンブル表示

/** シミュレーション操作 */
export type SimOp =
  | { type: "start"; program: string; args: string[]; source: SourceLine[] }
  | { type: "attach"; pid: number }
  | { type: "detach" }
  | { type: "break"; line: number; file?: string }
  | { type: "delete_break"; id: number }
  | { type: "enable_break"; id: number }
  | { type: "disable_break"; id: number }
  | { type: "cond_break"; line: number; condition: string }
  | { type: "watch"; expr: string; watchType: "write" | "read" | "access"; addr: number; size: number }
  | { type: "delete_watch"; id: number }
  | { type: "continue" }
  | { type: "step" }
  | { type: "next" }
  | { type: "step_out" }
  | { type: "run_to"; line: number }
  | { type: "print"; expr: string; result: Variable }
  | { type: "set_var"; name: string; value: string; addr: number; newValue: string }
  | { type: "examine"; addr: number; count: number; bytes: number[] }
  | { type: "write_mem"; addr: number; bytes: number[] }
  | { type: "backtrace"; frames: StackFrame[] }
  | { type: "frame"; level: number }
  | { type: "info_regs"; regs: Registers }
  | { type: "set_reg"; reg: RegisterName; value: number }
  | { type: "signal"; signo: number; signame: string }
  | { type: "catch_signal"; signame: string }
  | { type: "syscall_trace"; name: string; args: string[]; retval: number }
  | { type: "disassemble"; addr: number; instructions: DisasmLine[] }
  | { type: "hit_breakpoint"; bpId: number; line: number }
  | { type: "hit_watchpoint"; wpId: number; oldVal: string; newVal: string }
  | { type: "exec_line"; line: number; registers: Partial<Registers>; memChanges?: MemChange[] }
  | { type: "call_function"; funcName: string; args: Variable[]; returnAddr: number; newFrame: StackFrame }
  | { type: "return_function"; funcName: string; returnValue: string; frame: StackFrame }
  | { type: "segfault"; addr: number; reason: string }
  | { type: "exit"; code: number };

/** メモリ変更 */
export interface MemChange {
  addr: number;
  oldBytes: number[];
  newBytes: number[];
  description: string;
}

/** 逆アセンブル行 */
export interface DisasmLine {
  addr: number;
  bytes: string;
  mnemonic: string;
  operands: string;
  isCurrentInstr: boolean;
}

/** イベント種別 */
export type EventType =
  | "ptrace"
  | "breakpoint"
  | "watchpoint"
  | "step"
  | "continue"
  | "signal"
  | "syscall"
  | "memory"
  | "register"
  | "stack"
  | "variable"
  | "disasm"
  | "process"
  | "error"
  | "info";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
  ptraceOp?: PtraceOp;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  debuggee: Debuggee;
  breakpoints: Breakpoint[];
  watchpoints: Watchpoint[];
  callStack: StackFrame[];
  registers: Registers;
  memorySegments: MemorySegment[];
  memoryDump: MemoryCell[];
  variables: Variable[];
  disassembly: DisasmLine[];
  stats: {
    totalSteps: number;
    breakpointsHit: number;
    watchpointsHit: number;
    ptraceCalls: number;
    signalsDelivered: number;
    syscallsTraced: number;
    instructionsExecuted: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
