import type {
  Registers, RegisterName, MemorySegment, MemoryCell, Variable,
  Breakpoint, Watchpoint, StackFrame, SignalInfo,
  DisasmLine, Debuggee, ProcessState,
  SimOp, SimEvent, EventType, SimulationResult, PtraceOp,
} from "./types.js";

function hex(n: number): string {
  return `0x${n.toString(16).padStart(8, "0")}`;
}

function hexShort(n: number): string {
  return `0x${n.toString(16)}`;
}

/** 初期レジスタ */
function initRegisters(): Registers {
  return {
    rax: 0, rbx: 0, rcx: 0, rdx: 0,
    rsi: 0, rdi: 0, rbp: 0x7fffffffe000, rsp: 0x7fffffffe000,
    r8: 0, r9: 0, r10: 0, r11: 0,
    r12: 0, r13: 0, r14: 0, r15: 0,
    rip: 0x401000, rflags: 0x202,
  };
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const events: SimEvent[] = [];
  let regs = initRegisters();
  const breakpoints: Breakpoint[] = [];
  const watchpoints: Watchpoint[] = [];
  let callStack: StackFrame[] = [];
  const memorySegments: MemorySegment[] = [
    { name: ".text", start: 0x401000, size: 0x1000, perms: "r-x" },
    { name: ".data", start: 0x404000, size: 0x1000, perms: "rw-" },
    { name: ".bss", start: 0x405000, size: 0x1000, perms: "rw-" },
    { name: "[stack]", start: 0x7ffffffde000, size: 0x22000, perms: "rw-" },
    { name: "[heap]", start: 0x406000, size: 0x21000, perms: "rw-" },
  ];
  let memoryDump: MemoryCell[] = [];
  let variables: Variable[] = [];
  let disassembly: DisasmLine[] = [];

  const debuggee: Debuggee = {
    pid: 0,
    state: "stopped" as ProcessState,
    source: [],
    currentLine: 0,
    currentAddr: 0x401000,
  };

  let step = 0;
  let bpIdCounter = 1;
  let wpIdCounter = 1;

  const stats = {
    totalSteps: 0,
    breakpointsHit: 0,
    watchpointsHit: 0,
    ptraceCalls: 0,
    signalsDelivered: 0,
    syscallsTraced: 0,
    instructionsExecuted: 0,
  };

  function emit(type: EventType, desc: string, detail?: string, ptraceOp?: PtraceOp): void {
    events.push({ step, type, description: desc, detail, ptraceOp });
    stats.totalSteps++;
    if (ptraceOp) stats.ptraceCalls++;
  }

  /** ソースコードからアドレスを取得 */
  function lineToAddr(line: number): number {
    const src = debuggee.source.find((s) => s.lineNo === line);
    return src ? src.addr : 0x401000 + (line - 1) * 4;
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "start": {
        debuggee.pid = 42000 + Math.floor(step * 7);
        debuggee.source = op.source;
        debuggee.state = "stopped";
        if (op.source.length > 0) {
          debuggee.currentLine = op.source[0]!.lineNo;
          debuggee.currentAddr = op.source[0]!.addr;
          regs.rip = op.source[0]!.addr;
        }

        emit("ptrace",
          `fork() → 子プロセス (PID ${debuggee.pid}) を作成`,
          `デバッガが fork() でデバッグ対象を生成。子プロセスはexecve()前にptrace(PTRACE_TRACEME)を呼ぶ。`,
          "PTRACE_TRACEME");

        emit("ptrace",
          `ptrace(PTRACE_TRACEME) — 子プロセスがトレース開始を宣言`,
          `以降、この子プロセスのexecve、シグナル配送、システムコールはデバッガに通知される。`,
          "PTRACE_TRACEME");

        emit("process",
          `execve("${op.program}", [${op.args.map((a) => `"${a}"`).join(", ")}])`,
          `子プロセスが実行ファイルをロード。SIGTRAP がデバッガに送られて停止。`);

        emit("signal",
          `SIGTRAP 受信 — execve完了で停止`,
          `waitpid()で子プロセスの停止を検出。デバッガがコントロールを取得。`);
        stats.signalsDelivered++;

        // 初期フレーム
        callStack = [{
          level: 0,
          funcName: "main",
          file: op.program,
          line: debuggee.currentLine,
          addr: debuggee.currentAddr,
          frameAddr: regs.rbp,
          args: [],
          locals: [],
        }];
        break;
      }

      case "attach": {
        debuggee.pid = op.pid;
        debuggee.state = "stopped";

        emit("ptrace",
          `ptrace(PTRACE_ATTACH, ${op.pid})`,
          `既存プロセスにアタッチ。カーネルがSIGSTOPを送信し、プロセスが停止。`,
          "PTRACE_ATTACH");

        emit("signal",
          `SIGSTOP → PID ${op.pid} 停止`,
          `waitpid()で停止確認後、デバッガが操作可能になる。`);
        stats.signalsDelivered++;
        break;
      }

      case "detach": {
        emit("ptrace",
          `ptrace(PTRACE_DETACH, ${debuggee.pid})`,
          `デバッガがプロセスから切り離し。ブレークポイントのINT3を元のバイトに復元。プロセスは通常実行を再開。`,
          "PTRACE_DETACH");
        debuggee.state = "running";
        break;
      }

      case "break": {
        const addr = lineToAddr(op.line);
        const bp: Breakpoint = {
          id: bpIdCounter++,
          addr,
          line: op.line,
          file: op.file,
          hitCount: 0,
          enabled: true,
          originalByte: 0x55, // push rbp (例)
        };
        breakpoints.push(bp);

        emit("breakpoint",
          `ブレークポイント #${bp.id} 設定: line ${op.line} (${hex(addr)})`,
          `ptrace(PTRACE_PEEKTEXT) で元のバイト (0x${bp.originalByte.toString(16)}) を保存 → ptrace(PTRACE_POKETEXT) で INT3 (0xCC) に書き換え`,
          "PTRACE_POKETEXT");

        emit("memory",
          `メモリ書き換え: ${hex(addr)}: 0x${bp.originalByte.toString(16)} → 0xCC (INT3)`,
          `CPU が INT3 を実行すると SIGTRAP が発生し、デバッガに制御が移る。`);
        break;
      }

      case "delete_break": {
        const bp = breakpoints.find((b) => b.id === op.id);
        if (bp) {
          emit("breakpoint",
            `ブレークポイント #${bp.id} 削除: ${hex(bp.addr)}`,
            `INT3 (0xCC) を元のバイト (0x${bp.originalByte.toString(16)}) に復元: ptrace(PTRACE_POKETEXT)`,
            "PTRACE_POKETEXT");
          bp.enabled = false;
        }
        break;
      }

      case "enable_break": {
        const bp = breakpoints.find((b) => b.id === op.id);
        if (bp) {
          bp.enabled = true;
          emit("breakpoint",
            `ブレークポイント #${bp.id} 有効化: INT3 再設置`,
            `${hex(bp.addr)}: 元バイト → 0xCC`,
            "PTRACE_POKETEXT");
        }
        break;
      }

      case "disable_break": {
        const bp = breakpoints.find((b) => b.id === op.id);
        if (bp) {
          bp.enabled = false;
          emit("breakpoint",
            `ブレークポイント #${bp.id} 無効化: INT3 → 元バイト復元`,
            `${hex(bp.addr)}: 0xCC → 0x${bp.originalByte.toString(16)}`,
            "PTRACE_POKETEXT");
        }
        break;
      }

      case "cond_break": {
        const addr = lineToAddr(op.line);
        const bp: Breakpoint = {
          id: bpIdCounter++,
          addr,
          line: op.line,
          condition: op.condition,
          hitCount: 0,
          enabled: true,
          originalByte: 0x48,
        };
        breakpoints.push(bp);

        emit("breakpoint",
          `条件付きブレークポイント #${bp.id}: line ${op.line} if (${op.condition})`,
          `停止はINT3で行うが、デバッガが条件式を評価して偽なら即座にPTRACE_CONTで再開。`,
          "PTRACE_POKETEXT");
        break;
      }

      case "watch": {
        const wp: Watchpoint = {
          id: wpIdCounter++,
          expr: op.expr,
          type: op.watchType,
          addr: op.addr,
          size: op.size,
          oldValue: "0",
          currentValue: "0",
          hitCount: 0,
          enabled: true,
        };
        watchpoints.push(wp);

        const typeStr = op.watchType === "write" ? "書き込み" : op.watchType === "read" ? "読み取り" : "アクセス";
        emit("watchpoint",
          `ウォッチポイント #${wp.id} 設定: ${op.expr} (${typeStr})`,
          `x86 デバッグレジスタ DR0-DR3 を使用。DR7 で条件 (${typeStr}) とサイズ (${op.size}B) を設定。ハードウェアが自動検出。`,
          "PTRACE_POKEUSER");
        break;
      }

      case "delete_watch": {
        const wp = watchpoints.find((w) => w.id === op.id);
        if (wp) {
          wp.enabled = false;
          emit("watchpoint",
            `ウォッチポイント #${wp.id} 削除: DR レジスタクリア`,
            `デバッグレジスタ DR0-DR3 の対応エントリと DR7 の有効ビットをクリア。`,
            "PTRACE_POKEUSER");
        }
        break;
      }

      case "continue": {
        emit("ptrace",
          `ptrace(PTRACE_CONT, ${debuggee.pid}) — 実行再開`,
          `デバッガがwaitpid()でブロック。子プロセスはSIGTRAP/シグナルが発生するまで実行を継続。`,
          "PTRACE_CONT");
        debuggee.state = "running";
        break;
      }

      case "step": {
        emit("ptrace",
          `ptrace(PTRACE_SINGLESTEP, ${debuggee.pid}) — 1命令ステップ`,
          `RFLAGS の TF (Trap Flag) をセット。1命令実行後に SIGTRAP が発生。`,
          "PTRACE_SINGLESTEP");

        debuggee.state = "stepping";
        stats.instructionsExecuted++;

        emit("ptrace",
          `ptrace(PTRACE_GETREGS) — レジスタ取得`,
          `ステップ後のレジスタ状態を読み取り、RIPから現在位置を特定。`,
          "PTRACE_GETREGS");
        break;
      }

      case "next": {
        // ステップオーバー: 現在行の次の行にテンポラリBPを設定
        const nextLine = debuggee.currentLine + 1;
        const nextAddr = lineToAddr(nextLine);

        emit("step",
          `next — ステップオーバー (line ${debuggee.currentLine} → ${nextLine})`,
          `現在行の次の行 (${hex(nextAddr)}) にテンポラリブレークポイントを設置して PTRACE_CONT。関数呼び出しがあっても戻ってくるまで停止しない。`);

        emit("ptrace",
          `テンポラリBP: ${hex(nextAddr)} に INT3 設置 → PTRACE_CONT`,
          `関数内部には入らず、呼び出し元に戻った時点で停止。`,
          "PTRACE_CONT");

        debuggee.currentLine = nextLine;
        debuggee.currentAddr = nextAddr;
        regs.rip = nextAddr;
        stats.instructionsExecuted++;
        break;
      }

      case "step_out": {
        if (callStack.length > 0) {
          const frame = callStack[0]!;
          emit("step",
            `finish — ステップアウト (${frame.funcName} から戻る)`,
            `リターンアドレス (${hex(frame.addr + 0x20)}) にテンポラリBPを設置して PTRACE_CONT。関数の残りを実行して呼び出し元に戻る。`);
        }
        emit("ptrace",
          `ptrace(PTRACE_CONT) — 関数終了まで実行`,
          `ret 命令でリターンアドレスにジャンプ → テンポラリBPでSIGTRAP停止。`,
          "PTRACE_CONT");
        break;
      }

      case "run_to": {
        const addr = lineToAddr(op.line);
        emit("step",
          `run to line ${op.line} (${hex(addr)})`,
          `テンポラリブレークポイントを設置して PTRACE_CONT。`);
        debuggee.currentLine = op.line;
        debuggee.currentAddr = addr;
        regs.rip = addr;
        break;
      }

      case "print": {
        const v = op.result;
        variables = variables.filter((vv) => vv.name !== v.name);
        variables.push(v);

        emit("variable",
          `print ${op.expr} = ${v.value}`,
          `ptrace(PTRACE_PEEKTEXT, ${hex(v.addr)}) でメモリ読み取り → 型 "${v.type}" に基づいてデコード`,
          "PTRACE_PEEKTEXT");

        if (v.members && v.members.length > 0) {
          for (const m of v.members) {
            emit("variable",
              `  .${m.name} = ${m.value} (${m.type}, ${hex(m.addr)})`,
              undefined);
          }
        }
        break;
      }

      case "set_var": {
        emit("variable",
          `set ${op.name} = ${op.newValue} (旧値: ${op.value})`,
          `ptrace(PTRACE_POKETEXT, ${hex(op.addr)}) でメモリに新しい値を書き込み。`,
          "PTRACE_POKETEXT");

        const existing = variables.find((v) => v.name === op.name);
        if (existing) {
          existing.value = op.newValue;
        }
        break;
      }

      case "examine": {
        const cells: MemoryCell[] = [];
        for (let i = 0; i < op.count; i++) {
          const b = op.bytes[i] ?? 0;
          cells.push({
            addr: op.addr + i,
            value: b,
            ascii: b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".",
          });
        }
        memoryDump = cells;

        const hexBytes = op.bytes.slice(0, Math.min(16, op.count)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        emit("memory",
          `x/${op.count}xb ${hex(op.addr)}: ${hexBytes}${op.count > 16 ? " ..." : ""}`,
          `ptrace(PTRACE_PEEKTEXT) を ${Math.ceil(op.count / 8)} 回呼び出してメモリ読み取り。`,
          "PTRACE_PEEKTEXT");
        break;
      }

      case "write_mem": {
        emit("memory",
          `メモリ書き込み: ${hex(op.addr)} ← [${op.bytes.map((b) => hexShort(b)).join(", ")}]`,
          `ptrace(PTRACE_POKETEXT) で ${op.bytes.length}バイトを書き込み。`,
          "PTRACE_POKETEXT");
        break;
      }

      case "backtrace": {
        callStack = op.frames;
        emit("stack",
          `backtrace — ${op.frames.length}フレーム`,
          op.frames.map((f) => `#${f.level} ${hex(f.addr)} in ${f.funcName} (${f.file}:${f.line})`).join("\n"));

        for (const frame of op.frames) {
          emit("stack",
            `#${frame.level} ${frame.funcName}() at ${frame.file}:${frame.line} [${hex(frame.addr)}]`,
            frame.locals.length > 0
              ? `ローカル変数: ${frame.locals.map((l) => `${l.name}=${l.value}`).join(", ")}`
              : undefined);
        }
        break;
      }

      case "frame": {
        const frame = callStack.find((f) => f.level === op.level);
        if (frame) {
          emit("stack",
            `frame ${op.level} — ${frame.funcName}() at ${frame.file}:${frame.line}`,
            `rbp=${hex(frame.frameAddr)}, ローカル変数: ${frame.locals.length}個`);
          variables = [...frame.locals, ...frame.args];
        }
        break;
      }

      case "info_regs": {
        regs = { ...regs, ...op.regs };
        emit("register",
          `info registers — 全レジスタ表示`,
          `ptrace(PTRACE_GETREGS) で struct user_regs_struct を読み取り。`,
          "PTRACE_GETREGS");

        // 主要レジスタのイベント
        const regEntries = Object.entries(op.regs) as [RegisterName, number][];
        const regStr = regEntries.map(([name, val]) => `${name}=${hex(val)}`).join(", ");
        emit("register", regStr, undefined);
        break;
      }

      case "set_reg": {
        const oldVal = regs[op.reg];
        regs[op.reg] = op.value;
        emit("register",
          `set $${op.reg} = ${hex(op.value)} (旧値: ${hex(oldVal)})`,
          `ptrace(PTRACE_SETREGS) で struct user_regs_struct を書き込み。`,
          "PTRACE_SETREGS");
        break;
      }

      case "signal": {
        const sig: SignalInfo = { signo: op.signo, name: op.signame, code: "SI_USER" };
        debuggee.signal = sig;
        stats.signalsDelivered++;

        emit("signal",
          `シグナル送信: ${op.signame} (${op.signo}) → PID ${debuggee.pid}`,
          `kill(${debuggee.pid}, ${op.signo}) でシグナルを送信。デバッガが先にシグナルを受け取り、処理を決定。`);

        emit("signal",
          `デバッガがシグナルを横取り — 転送/破棄を選択可能`,
          `ptrace(PTRACE_CONT, sig=${op.signo}) で転送、ptrace(PTRACE_CONT, sig=0) で破棄。`);
        break;
      }

      case "catch_signal": {
        emit("signal",
          `catch signal ${op.signame} — シグナルキャッチ設定`,
          `${op.signame} が配送されるとデバッガに制御が移り、プロセスは停止する。`);
        break;
      }

      case "syscall_trace": {
        stats.syscallsTraced++;
        emit("syscall",
          `syscall: ${op.name}(${op.args.join(", ")}) = ${op.retval}`,
          `ptrace(PTRACE_SYSCALL) でシステムコールのentry/exitをトレース。`,
          "PTRACE_SYSCALL");
        break;
      }

      case "disassemble": {
        disassembly = op.instructions;
        emit("disasm",
          `disassemble ${hex(op.addr)} — ${op.instructions.length}命令`,
          undefined);
        for (const instr of op.instructions) {
          const marker = instr.isCurrentInstr ? "→ " : "  ";
          emit("disasm",
            `${marker}${hex(instr.addr)}: ${instr.bytes.padEnd(24)} ${instr.mnemonic} ${instr.operands}`,
            undefined);
        }
        break;
      }

      case "hit_breakpoint": {
        const bp = breakpoints.find((b) => b.id === op.bpId);
        if (bp) {
          bp.hitCount++;
          stats.breakpointsHit++;
          debuggee.state = "stopped";
          debuggee.currentLine = op.line;
          debuggee.currentAddr = bp.addr;
          regs.rip = bp.addr;

          emit("signal",
            `SIGTRAP 受信 — INT3 ブレークポイント #${bp.id} ヒット`,
            `CPU が 0xCC (INT3) を実行 → SIGTRAP がデバッガに通知。waitpid() のステータスで検出。`);

          emit("breakpoint",
            `Breakpoint #${bp.id} hit at line ${op.line} (${hex(bp.addr)})`,
            `ヒット回数: ${bp.hitCount}${bp.condition ? `, 条件: ${bp.condition}` : ""}`);

          // RIPの巻き戻し
          emit("ptrace",
            `RIP 巻き戻し: ${hex(bp.addr + 1)} → ${hex(bp.addr)}`,
            `INT3実行後にRIPは次の命令を指す。元の位置に戻すためにRIPを1バイト巻き戻す。`,
            "PTRACE_SETREGS");

          // 元のバイト復元 → シングルステップ → INT3再設置
          emit("memory",
            `INT3 復元: ${hex(bp.addr)}: 0xCC → 0x${bp.originalByte.toString(16)} (元のバイト)`,
            `ブレークポイント位置を実行するため一時的にINT3を除去。`);

          emit("ptrace",
            `ptrace(PTRACE_SINGLESTEP) — 元の命令を1つ実行`,
            `TFセットで1命令だけ実行し、再びSIGTRAPで停止。`,
            "PTRACE_SINGLESTEP");

          emit("memory",
            `INT3 再設置: ${hex(bp.addr)}: 0x${bp.originalByte.toString(16)} → 0xCC`,
            `ブレークポイントを再び有効にするため、INT3を再度書き込み。`);
        }
        break;
      }

      case "hit_watchpoint": {
        const wp = watchpoints.find((w) => w.id === op.wpId);
        if (wp) {
          wp.hitCount++;
          wp.oldValue = op.oldVal;
          wp.currentValue = op.newVal;
          stats.watchpointsHit++;
          debuggee.state = "stopped";

          emit("signal",
            `SIGTRAP 受信 — ハードウェアウォッチポイント #${wp.id} ヒット`,
            `デバッグレジスタ DR6 のステータスビットでどのウォッチポイントがトリガーしたか判定。`);

          emit("watchpoint",
            `Watchpoint #${wp.id} hit: ${wp.expr} — ${op.oldVal} → ${op.newVal}`,
            `DR6 を確認後クリア。変数値が変化した箇所で停止。`);
        }
        break;
      }

      case "exec_line": {
        debuggee.currentLine = op.line;
        const addr = lineToAddr(op.line);
        debuggee.currentAddr = addr;
        stats.instructionsExecuted++;

        if (op.registers) {
          regs = { ...regs, ...op.registers };
          if (op.registers.rip !== undefined) {
            debuggee.currentAddr = op.registers.rip;
          }
        }

        const src = debuggee.source.find((s) => s.lineNo === op.line);
        emit("step",
          `line ${op.line}${src ? `: ${src.text.trim()}` : ""} [${hex(addr)}]`,
          undefined);

        if (op.memChanges) {
          for (const mc of op.memChanges) {
            emit("memory",
              `メモリ変更: ${hex(mc.addr)} — ${mc.description}`,
              `旧: [${mc.oldBytes.map((b) => hexShort(b)).join(",")}] → 新: [${mc.newBytes.map((b) => hexShort(b)).join(",")}]`);
          }
        }
        break;
      }

      case "call_function": {
        // スタックにフレームを追加
        callStack.unshift(op.newFrame);
        regs.rsp -= 8; // リターンアドレスをpush
        regs.rbp = regs.rsp;

        emit("stack",
          `call ${op.funcName}(${op.args.map((a) => `${a.name}=${a.value}`).join(", ")})`,
          `push リターンアドレス (${hex(op.returnAddr)}) → RSP=${hex(regs.rsp)}, 新フレーム RBP=${hex(regs.rbp)}`);

        emit("step",
          `${op.funcName} に入る — frame #${op.newFrame.level}`,
          `ローカル変数: ${op.newFrame.locals.map((l) => `${l.name}: ${l.type}`).join(", ") || "(なし)"}`);
        break;
      }

      case "return_function": {
        if (callStack.length > 0) {
          callStack.shift();
        }
        regs.rsp += 8;

        emit("stack",
          `return from ${op.funcName}() → ${op.returnValue}`,
          `スタックフレーム破棄、RSP=${hex(regs.rsp)}。戻り値はRAXに格納。`);

        if (callStack.length > 0) {
          const parent = callStack[0]!;
          emit("step",
            `呼び出し元に戻る: ${parent.funcName}() at ${parent.file}:${parent.line}`,
            undefined);
        }
        break;
      }

      case "segfault": {
        debuggee.state = "signaled";
        debuggee.signal = { signo: 11, name: "SIGSEGV", code: "SEGV_MAPERR", addr: op.addr };
        stats.signalsDelivered++;

        emit("signal",
          `SIGSEGV (セグメンテーション違反) at ${hex(op.addr)}`,
          `${op.reason}。デバッガが SIGSEGV をキャッチしてプロセスを停止。`);

        emit("info",
          `Program received signal SIGSEGV, Segmentation fault.`,
          `フォルトアドレス: ${hex(op.addr)}, RIP=${hex(regs.rip)}`);
        break;
      }

      case "exit": {
        debuggee.state = "exited";
        debuggee.exitCode = op.code;

        emit("process",
          `プロセス終了: exit(${op.code})`,
          `waitpid() で WIFEXITED=true, WEXITSTATUS=${op.code} を検出。`);

        emit("info",
          `[Inferior 1 (process ${debuggee.pid}) exited with code ${op.code}]`,
          undefined);
        break;
      }
    }
  }

  return {
    events, debuggee, breakpoints, watchpoints, callStack, registers: regs,
    memorySegments, memoryDump, variables, disassembly, stats,
  };
}
