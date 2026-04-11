import { describe, it, expect } from "vitest";
import { runSimulation } from "../debugger/engine.js";
import { presets } from "../debugger/presets.js";
import type { SimOp, SourceLine } from "../debugger/types.js";

const testSource: SourceLine[] = [
  { lineNo: 1, text: "int main() {", addr: 0x401000 },
  { lineNo: 2, text: "  int x = 10;", addr: 0x401004 },
  { lineNo: 3, text: "  int y = 20;", addr: 0x401008 },
  { lineNo: 4, text: "  return x + y;", addr: 0x40100c },
  { lineNo: 5, text: "}", addr: 0x401010 },
];

describe("プロセス起動", () => {
  it("startでデバッグ対象プロセスが作成される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.pid).toBeGreaterThan(0);
    expect(result.debuggee.state).toBe("stopped");
    expect(result.debuggee.source.length).toBe(5);
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_TRACEME")).toBe(true);
    expect(result.callStack.length).toBe(1);
    expect(result.callStack[0]!.funcName).toBe("main");
  });

  it("attachで既存プロセスにアタッチできる", () => {
    const ops: SimOp[] = [
      { type: "attach", pid: 1234 },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.pid).toBe(1234);
    expect(result.debuggee.state).toBe("stopped");
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_ATTACH")).toBe(true);
  });

  it("detachでプロセスから切り離される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "detach" },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.state).toBe("running");
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_DETACH")).toBe(true);
  });
});

describe("ブレークポイント", () => {
  it("ブレークポイントが設定される (INT3)", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "break", line: 3, file: "test.c" },
    ];
    const result = runSimulation(ops);
    expect(result.breakpoints.length).toBe(1);
    expect(result.breakpoints[0]!.line).toBe(3);
    expect(result.breakpoints[0]!.enabled).toBe(true);
    expect(result.events.some((e) => e.type === "memory")).toBe(true);
  });

  it("ブレークポイントがヒットする", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "break", line: 3 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.breakpoints[0]!.hitCount).toBe(1);
    expect(result.stats.breakpointsHit).toBe(1);
    expect(result.debuggee.state).toBe("stopped");
    expect(result.debuggee.currentLine).toBe(3);
  });

  it("ブレークポイントの有効化/無効化", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "break", line: 3 },
      { type: "disable_break", id: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.breakpoints[0]!.enabled).toBe(false);
  });

  it("ブレークポイントの削除", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "break", line: 3 },
      { type: "delete_break", id: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.breakpoints[0]!.enabled).toBe(false);
  });

  it("条件付きブレークポイント", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "cond_break", line: 3, condition: "x > 5" },
    ];
    const result = runSimulation(ops);
    expect(result.breakpoints[0]!.condition).toBe("x > 5");
  });
});

describe("ウォッチポイント", () => {
  it("ウォッチポイントが設定される (ハードウェアDR)", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "watch", expr: "x", watchType: "write", addr: 0x7fffffffdfe0, size: 4 },
    ];
    const result = runSimulation(ops);
    expect(result.watchpoints.length).toBe(1);
    expect(result.watchpoints[0]!.expr).toBe("x");
    expect(result.watchpoints[0]!.type).toBe("write");
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_POKEUSER")).toBe(true);
  });

  it("ウォッチポイントがヒットする", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "watch", expr: "x", watchType: "write", addr: 0x7fffffffdfe0, size: 4 },
      { type: "hit_watchpoint", wpId: 1, oldVal: "0", newVal: "10" },
    ];
    const result = runSimulation(ops);
    expect(result.watchpoints[0]!.hitCount).toBe(1);
    expect(result.watchpoints[0]!.oldValue).toBe("0");
    expect(result.watchpoints[0]!.currentValue).toBe("10");
    expect(result.stats.watchpointsHit).toBe(1);
  });

  it("ウォッチポイントの削除", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "watch", expr: "x", watchType: "write", addr: 0x7fffffffdfe0, size: 4 },
      { type: "delete_watch", id: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.watchpoints[0]!.enabled).toBe(false);
  });
});

describe("ステップ実行", () => {
  it("step (PTRACE_SINGLESTEP)", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "step" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_SINGLESTEP")).toBe(true);
    expect(result.stats.instructionsExecuted).toBe(1);
  });

  it("next (ステップオーバー)", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "next" },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.currentLine).toBe(2); // line 1 → 2
    expect(result.stats.instructionsExecuted).toBe(1);
  });

  it("step_out (ステップアウト)", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "step_out" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_CONT")).toBe(true);
  });

  it("continue (PTRACE_CONT)", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "continue" },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.state).toBe("running");
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_CONT")).toBe(true);
  });

  it("exec_lineで行が実行される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "exec_line", line: 2, registers: { rip: 0x401004 } },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.currentLine).toBe(2);
    expect(result.registers.rip).toBe(0x401004);
    expect(result.stats.instructionsExecuted).toBe(1);
  });
});

describe("変数とメモリ", () => {
  it("print で変数値を表示", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "print", expr: "x", result: { name: "x", type: "int", addr: 0x7fffffffdfe0, size: 4, value: "10" } },
    ];
    const result = runSimulation(ops);
    expect(result.variables.length).toBe(1);
    expect(result.variables[0]!.name).toBe("x");
    expect(result.variables[0]!.value).toBe("10");
  });

  it("set_var で変数値を変更", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "print", expr: "x", result: { name: "x", type: "int", addr: 0x7fffffffdfe0, size: 4, value: "10" } },
      { type: "set_var", name: "x", value: "10", addr: 0x7fffffffdfe0, newValue: "99" },
    ];
    const result = runSimulation(ops);
    expect(result.variables.find((v) => v.name === "x")?.value).toBe("99");
  });

  it("examine でメモリダンプ", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "examine", addr: 0x401000, count: 8, bytes: [0x55, 0x48, 0x89, 0xe5, 0x48, 0x8d, 0x3d, 0xf5] },
    ];
    const result = runSimulation(ops);
    expect(result.memoryDump.length).toBe(8);
    expect(result.memoryDump[0]!.value).toBe(0x55);
  });
});

describe("コールスタック", () => {
  it("call_function でフレームが追加される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "call_function", funcName: "foo", args: [], returnAddr: 0x401010, newFrame: {
        level: 0, funcName: "foo", file: "test.c", line: 1,
        addr: 0x402000, frameAddr: 0x7fffffffdfe0, args: [], locals: [],
      }},
    ];
    const result = runSimulation(ops);
    expect(result.callStack.length).toBe(2);
    expect(result.callStack[0]!.funcName).toBe("foo");
  });

  it("return_function でフレームが除去される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "call_function", funcName: "foo", args: [], returnAddr: 0x401010, newFrame: {
        level: 0, funcName: "foo", file: "test.c", line: 1,
        addr: 0x402000, frameAddr: 0x7fffffffdfe0, args: [], locals: [],
      }},
      { type: "return_function", funcName: "foo", returnValue: "42", frame: {
        level: 0, funcName: "main", file: "test.c", line: 1,
        addr: 0x401000, frameAddr: 0x7fffffffe000, args: [], locals: [],
      }},
    ];
    const result = runSimulation(ops);
    expect(result.callStack.length).toBe(1);
    expect(result.callStack[0]!.funcName).toBe("main");
  });

  it("backtrace でスタック全体が更新される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "backtrace", frames: [
        { level: 0, funcName: "bar", file: "test.c", line: 2, addr: 0x403000, frameAddr: 0x7fffffffdfc0, args: [], locals: [] },
        { level: 1, funcName: "foo", file: "test.c", line: 5, addr: 0x402000, frameAddr: 0x7fffffffdfe0, args: [], locals: [] },
        { level: 2, funcName: "main", file: "test.c", line: 10, addr: 0x401000, frameAddr: 0x7fffffffe000, args: [], locals: [] },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.callStack.length).toBe(3);
  });
});

describe("シグナル", () => {
  it("シグナルが配送される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "signal", signo: 10, signame: "SIGUSR1" },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.signal?.name).toBe("SIGUSR1");
    expect(result.stats.signalsDelivered).toBeGreaterThan(0);
  });

  it("SIGSEGV でプロセスが停止", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "segfault", addr: 0x0, reason: "NULL pointer dereference" },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.state).toBe("signaled");
    expect(result.debuggee.signal?.name).toBe("SIGSEGV");
  });
});

describe("レジスタ", () => {
  it("info_regs でレジスタ表示", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "info_regs", regs: {
        rax: 0x42, rbx: 0, rcx: 0, rdx: 0,
        rsi: 0, rdi: 0, rbp: 0x7fffffffe000, rsp: 0x7fffffffdff0,
        r8: 0, r9: 0, r10: 0, r11: 0, r12: 0, r13: 0, r14: 0, r15: 0,
        rip: 0x401004, rflags: 0x202,
      }},
    ];
    const result = runSimulation(ops);
    expect(result.registers.rax).toBe(0x42);
    expect(result.registers.rip).toBe(0x401004);
  });

  it("set_reg でレジスタ変更", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "set_reg", reg: "rax", value: 0xdeadbeef },
    ];
    const result = runSimulation(ops);
    expect(result.registers.rax).toBe(0xdeadbeef);
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_SETREGS")).toBe(true);
  });
});

describe("逆アセンブル", () => {
  it("disassemble で逆アセンブルが表示される", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "disassemble", addr: 0x401000, instructions: [
        { addr: 0x401000, bytes: "55", mnemonic: "push", operands: "rbp", isCurrentInstr: true },
        { addr: 0x401001, bytes: "48 89 e5", mnemonic: "mov", operands: "rbp, rsp", isCurrentInstr: false },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.disassembly.length).toBe(2);
    expect(result.disassembly[0]!.mnemonic).toBe("push");
  });
});

describe("システムコールトレース", () => {
  it("syscall_trace でシステムコールがトレースされる", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "syscall_trace", name: "write", args: ["1", "\"hello\"", "5"], retval: 5 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.syscallsTraced).toBe(1);
    expect(result.events.some((e) => e.ptraceOp === "PTRACE_SYSCALL")).toBe(true);
  });
});

describe("プロセス終了", () => {
  it("exit でプロセスが終了する", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "exit", code: 0 },
    ];
    const result = runSimulation(ops);
    expect(result.debuggee.state).toBe("exited");
    expect(result.debuggee.exitCode).toBe(0);
  });
});

describe("統計", () => {
  it("統計が正しくカウントされる", () => {
    const ops: SimOp[] = [
      { type: "start", program: "test.c", args: ["test"], source: testSource },
      { type: "break", line: 3 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 3 },
      { type: "step" },
      { type: "syscall_trace", name: "write", args: ["1", "\"x\"", "1"], retval: 1 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.breakpointsHit).toBe(1);
    expect(result.stats.ptraceCalls).toBeGreaterThan(0);
    expect(result.stats.instructionsExecuted).toBe(1);
    expect(result.stats.syscallsTraced).toBe(1);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });
});
