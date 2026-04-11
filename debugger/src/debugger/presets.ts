import type { Preset, SourceLine, StackFrame, Variable } from "./types.js";

/** サンプルソースコード: hello.c */
const helloSource: SourceLine[] = [
  { lineNo: 1, text: '#include <stdio.h>', addr: 0x401000 },
  { lineNo: 2, text: '', addr: 0x401000 },
  { lineNo: 3, text: 'int main(int argc, char *argv[]) {', addr: 0x401000 },
  { lineNo: 4, text: '    printf("Hello, World!\\n");', addr: 0x401004 },
  { lineNo: 5, text: '    return 0;', addr: 0x40100c },
  { lineNo: 6, text: '}', addr: 0x401010 },
];

/** サンプルソースコード: loop.c (ループ付き) */
const loopSource: SourceLine[] = [
  { lineNo: 1, text: '#include <stdio.h>', addr: 0x401000 },
  { lineNo: 2, text: '', addr: 0x401000 },
  { lineNo: 3, text: 'int sum(int a, int b) {', addr: 0x401050 },
  { lineNo: 4, text: '    return a + b;', addr: 0x401054 },
  { lineNo: 5, text: '}', addr: 0x401058 },
  { lineNo: 6, text: '', addr: 0x401058 },
  { lineNo: 7, text: 'int main() {', addr: 0x401000 },
  { lineNo: 8, text: '    int total = 0;', addr: 0x401004 },
  { lineNo: 9, text: '    for (int i = 0; i < 5; i++) {', addr: 0x401008 },
  { lineNo: 10, text: '        total = sum(total, i);', addr: 0x40100c },
  { lineNo: 11, text: '    }', addr: 0x401014 },
  { lineNo: 12, text: '    printf("total = %d\\n", total);', addr: 0x401018 },
  { lineNo: 13, text: '    return 0;', addr: 0x401020 },
  { lineNo: 14, text: '}', addr: 0x401024 },
];

/** サンプルソースコード: pointer.c (ポインタ + segfault) */
const pointerSource: SourceLine[] = [
  { lineNo: 1, text: '#include <stdlib.h>', addr: 0x401000 },
  { lineNo: 2, text: '', addr: 0x401000 },
  { lineNo: 3, text: 'int main() {', addr: 0x401000 },
  { lineNo: 4, text: '    int *p = (int *)malloc(sizeof(int));', addr: 0x401004 },
  { lineNo: 5, text: '    *p = 42;', addr: 0x40100c },
  { lineNo: 6, text: '    free(p);', addr: 0x401010 },
  { lineNo: 7, text: '    *p = 99;  // use-after-free!', addr: 0x401014 },
  { lineNo: 8, text: '    return 0;', addr: 0x401018 },
  { lineNo: 9, text: '}', addr: 0x40101c },
];

/** サンプルソースコード: struct.c (構造体) */
const structSource: SourceLine[] = [
  { lineNo: 1, text: '#include <stdio.h>', addr: 0x401000 },
  { lineNo: 2, text: '', addr: 0x401000 },
  { lineNo: 3, text: 'struct Point { int x; int y; };', addr: 0x401000 },
  { lineNo: 4, text: '', addr: 0x401000 },
  { lineNo: 5, text: 'int distance(struct Point *p) {', addr: 0x401050 },
  { lineNo: 6, text: '    return p->x * p->x + p->y * p->y;', addr: 0x401054 },
  { lineNo: 7, text: '}', addr: 0x40105c },
  { lineNo: 8, text: '', addr: 0x40105c },
  { lineNo: 9, text: 'int main() {', addr: 0x401000 },
  { lineNo: 10, text: '    struct Point pt = {3, 4};', addr: 0x401004 },
  { lineNo: 11, text: '    int d = distance(&pt);', addr: 0x40100c },
  { lineNo: 12, text: '    printf("d = %d\\n", d);', addr: 0x401014 },
  { lineNo: 13, text: '    return 0;', addr: 0x401018 },
  { lineNo: 14, text: '}', addr: 0x40101c },
];

/** 共通の変数定義ヘルパー */
function mkVar(name: string, type: string, addr: number, size: number, value: string, members?: Variable[]): Variable {
  return { name, type, addr, size, value, members };
}

/** コールスタックフレームヘルパー */
function mkFrame(level: number, funcName: string, file: string, line: number, addr: number,
  frameAddr: number, args: Variable[], locals: Variable[]): StackFrame {
  return { level, funcName, file, line, addr, frameAddr, args, locals };
}

export const presets: Preset[] = [
  {
    name: "基本: ブレークポイントとステップ実行",
    description: "INT3ブレークポイント設置、ヒット、ステップ実行 (step/next) の仕組み",
    ops: [
      { type: "start", program: "hello.c", args: ["hello"], source: helloSource },
      { type: "break", line: 4, file: "hello.c" },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 4 },
      { type: "info_regs", regs: {
        rax: 0, rbx: 0, rcx: 0, rdx: 0,
        rsi: 0x7fffffffe110, rdi: 1, rbp: 0x7fffffffe000, rsp: 0x7fffffffdff0,
        r8: 0, r9: 0, r10: 0, r11: 0, r12: 0, r13: 0, r14: 0, r15: 0,
        rip: 0x401004, rflags: 0x206,
      }},
      { type: "step" },
      { type: "exec_line", line: 4, registers: { rip: 0x401004, rdi: 0x402000 } },
      { type: "next" },
      { type: "exec_line", line: 5, registers: { rip: 0x40100c, rax: 14 } },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "条件付きブレークポイント",
    description: "条件式が真の場合のみ停止する条件付きブレークポイントの動作",
    ops: [
      { type: "start", program: "loop.c", args: ["loop"], source: loopSource },
      { type: "cond_break", line: 10, condition: "i == 3" },
      { type: "continue" },
      // i=0,1,2 は条件が偽なのでスキップ
      { type: "exec_line", line: 10, registers: { rip: 0x40100c }, memChanges: [
        { addr: 0x7fffffffdfe8, oldBytes: [0, 0, 0, 0], newBytes: [0, 0, 0, 0], description: "total = sum(0, 0) = 0" },
      ]},
      { type: "exec_line", line: 10, registers: { rip: 0x40100c }, memChanges: [
        { addr: 0x7fffffffdfe8, oldBytes: [0, 0, 0, 0], newBytes: [1, 0, 0, 0], description: "total = sum(0, 1) = 1" },
      ]},
      { type: "exec_line", line: 10, registers: { rip: 0x40100c }, memChanges: [
        { addr: 0x7fffffffdfe8, oldBytes: [1, 0, 0, 0], newBytes: [3, 0, 0, 0], description: "total = sum(1, 2) = 3" },
      ]},
      // i=3 で条件成立 → 停止
      { type: "hit_breakpoint", bpId: 1, line: 10 },
      { type: "print", expr: "i", result: mkVar("i", "int", 0x7fffffffdfe4, 4, "3") },
      { type: "print", expr: "total", result: mkVar("total", "int", 0x7fffffffdfe8, 4, "3") },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "ウォッチポイント (ハードウェア)",
    description: "x86デバッグレジスタ (DR0-DR3/DR7) を使ったハードウェアウォッチポイント",
    ops: [
      { type: "start", program: "loop.c", args: ["loop"], source: loopSource },
      { type: "break", line: 8 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 8 },
      { type: "exec_line", line: 8, registers: { rip: 0x401004 } },
      // total変数にウォッチポイント設定
      { type: "watch", expr: "total", watchType: "write", addr: 0x7fffffffdfe8, size: 4 },
      { type: "continue" },
      // totalが変更されるたびにヒット
      { type: "hit_watchpoint", wpId: 1, oldVal: "0", newVal: "0" },
      { type: "print", expr: "i", result: mkVar("i", "int", 0x7fffffffdfe4, 4, "0") },
      { type: "continue" },
      { type: "hit_watchpoint", wpId: 1, oldVal: "0", newVal: "1" },
      { type: "print", expr: "i", result: mkVar("i", "int", 0x7fffffffdfe4, 4, "1") },
      { type: "continue" },
      { type: "hit_watchpoint", wpId: 1, oldVal: "1", newVal: "3" },
      { type: "print", expr: "i", result: mkVar("i", "int", 0x7fffffffdfe4, 4, "2") },
      { type: "delete_watch", id: 1 },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "コールスタックとフレーム",
    description: "関数呼び出し/復帰のスタックフレーム構築と backtrace の仕組み",
    ops: [
      { type: "start", program: "loop.c", args: ["loop"], source: loopSource },
      { type: "break", line: 4 },
      { type: "continue" },
      // sum() 内でブレークポイントヒット
      { type: "hit_breakpoint", bpId: 1, line: 4 },
      { type: "call_function", funcName: "sum", args: [
        mkVar("a", "int", 0x7fffffffdfc0, 4, "0"),
        mkVar("b", "int", 0x7fffffffdfc4, 4, "0"),
      ], returnAddr: 0x401010, newFrame: mkFrame(0, "sum", "loop.c", 4, 0x401054, 0x7fffffffdfa0, [
        mkVar("a", "int", 0x7fffffffdfc0, 4, "0"),
        mkVar("b", "int", 0x7fffffffdfc4, 4, "0"),
      ], []) },
      // backtrace表示
      { type: "backtrace", frames: [
        mkFrame(0, "sum", "loop.c", 4, 0x401054, 0x7fffffffdfa0, [
          mkVar("a", "int", 0x7fffffffdfc0, 4, "0"),
          mkVar("b", "int", 0x7fffffffdfc4, 4, "0"),
        ], []),
        mkFrame(1, "main", "loop.c", 10, 0x40100c, 0x7fffffffe000, [], [
          mkVar("total", "int", 0x7fffffffdfe8, 4, "0"),
          mkVar("i", "int", 0x7fffffffdfe4, 4, "0"),
        ]),
      ]},
      // フレーム切り替え
      { type: "frame", level: 1 },
      { type: "print", expr: "total", result: mkVar("total", "int", 0x7fffffffdfe8, 4, "0") },
      { type: "frame", level: 0 },
      // ステップアウト
      { type: "step_out" },
      { type: "return_function", funcName: "sum", returnValue: "0", frame: mkFrame(0, "main", "loop.c", 10, 0x40100c, 0x7fffffffe000, [], [
        mkVar("total", "int", 0x7fffffffdfe8, 4, "0"),
        mkVar("i", "int", 0x7fffffffdfe4, 4, "0"),
      ]) },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "メモリ検査と変数操作",
    description: "メモリダンプ (examine)、変数値の読み取り/変更、ポインタ追跡",
    ops: [
      { type: "start", program: "pointer.c", args: ["pointer"], source: pointerSource },
      { type: "break", line: 5 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 5 },
      // ポインタ変数の表示
      { type: "print", expr: "p", result: mkVar("p", "int *", 0x7fffffffdfe0, 8, "0x00406010") },
      // ポインタが指す先のメモリ
      { type: "examine", addr: 0x406010, count: 16, bytes: [0, 0, 0, 0, 0, 0, 0, 0, 0x21, 0, 0, 0, 0, 0, 0, 0] },
      // 次の行へ (*p = 42)
      { type: "next" },
      { type: "exec_line", line: 5, registers: { rip: 0x40100c }, memChanges: [
        { addr: 0x406010, oldBytes: [0, 0, 0, 0], newBytes: [42, 0, 0, 0], description: "*p = 42" },
      ]},
      // 変更後のメモリ確認
      { type: "examine", addr: 0x406010, count: 4, bytes: [42, 0, 0, 0] },
      { type: "print", expr: "*p", result: mkVar("*p", "int", 0x406010, 4, "42") },
      // 変数値を変更
      { type: "set_var", name: "*p", value: "42", addr: 0x406010, newValue: "100" },
      { type: "examine", addr: 0x406010, count: 4, bytes: [100, 0, 0, 0] },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "SIGSEGV (セグフォ) デバッグ",
    description: "use-after-free によるセグメンテーション違反をデバッガでキャッチ",
    ops: [
      { type: "start", program: "pointer.c", args: ["pointer"], source: pointerSource },
      { type: "continue" },
      // free後のアクセスでSIGSEGV
      { type: "exec_line", line: 4, registers: { rip: 0x401004 } },
      { type: "exec_line", line: 5, registers: { rip: 0x40100c } },
      { type: "exec_line", line: 6, registers: { rip: 0x401010 } },
      { type: "segfault", addr: 0x406010, reason: "解放済みメモリへの書き込み (use-after-free)" },
      // クラッシュ時のデバッグ情報
      { type: "backtrace", frames: [
        mkFrame(0, "main", "pointer.c", 7, 0x401014, 0x7fffffffe000, [], [
          mkVar("p", "int *", 0x7fffffffdfe0, 8, "0x00406010 (freed)"),
        ]),
      ]},
      { type: "info_regs", regs: {
        rax: 0x406010, rbx: 0, rcx: 99, rdx: 0,
        rsi: 0, rdi: 0x406010, rbp: 0x7fffffffe000, rsp: 0x7fffffffdff0,
        r8: 0, r9: 0, r10: 0, r11: 0, r12: 0, r13: 0, r14: 0, r15: 0,
        rip: 0x401014, rflags: 0x10206,
      }},
      { type: "examine", addr: 0x406010, count: 8, bytes: [0xba, 0xad, 0xf0, 0x0d, 0xba, 0xad, 0xf0, 0x0d] },
      { type: "disassemble", addr: 0x401010, instructions: [
        { addr: 0x401010, bytes: "bf 10 60 40 00", mnemonic: "mov", operands: "edi, 0x406010", isCurrentInstr: false },
        { addr: 0x401014, bytes: "c7 07 63 00 00 00", mnemonic: "mov", operands: "dword ptr [rdi], 99", isCurrentInstr: true },
        { addr: 0x40101a, bytes: "31 c0", mnemonic: "xor", operands: "eax, eax", isCurrentInstr: false },
        { addr: 0x40101c, bytes: "c9", mnemonic: "leave", operands: "", isCurrentInstr: false },
        { addr: 0x40101d, bytes: "c3", mnemonic: "ret", operands: "", isCurrentInstr: false },
      ]},
    ],
  },
  {
    name: "逆アセンブルとレジスタ",
    description: "機械語レベルのデバッグ: 逆アセンブル表示とレジスタ操作",
    ops: [
      { type: "start", program: "hello.c", args: ["hello"], source: helloSource },
      { type: "break", line: 3 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 3 },
      // 逆アセンブル表示
      { type: "disassemble", addr: 0x401000, instructions: [
        { addr: 0x401000, bytes: "55", mnemonic: "push", operands: "rbp", isCurrentInstr: true },
        { addr: 0x401001, bytes: "48 89 e5", mnemonic: "mov", operands: "rbp, rsp", isCurrentInstr: false },
        { addr: 0x401004, bytes: "48 8d 3d f5 0f 00 00", mnemonic: "lea", operands: "rdi, [rip+0xff5]", isCurrentInstr: false },
        { addr: 0x40100b, bytes: "e8 f0 fe ff ff", mnemonic: "call", operands: "puts@plt", isCurrentInstr: false },
        { addr: 0x401010, bytes: "31 c0", mnemonic: "xor", operands: "eax, eax", isCurrentInstr: false },
        { addr: 0x401012, bytes: "5d", mnemonic: "pop", operands: "rbp", isCurrentInstr: false },
        { addr: 0x401013, bytes: "c3", mnemonic: "ret", operands: "", isCurrentInstr: false },
      ]},
      // ステップ (命令レベル)
      { type: "step" },
      { type: "exec_line", line: 3, registers: { rip: 0x401001, rsp: 0x7fffffffdff8 } },
      { type: "step" },
      { type: "exec_line", line: 3, registers: { rip: 0x401004, rbp: 0x7fffffffdff8 } },
      // レジスタ全表示
      { type: "info_regs", regs: {
        rax: 0, rbx: 0, rcx: 0, rdx: 0,
        rsi: 0x7fffffffe110, rdi: 1, rbp: 0x7fffffffdff8, rsp: 0x7fffffffdff8,
        r8: 0, r9: 0, r10: 0, r11: 0, r12: 0x401000, r13: 0, r14: 0, r15: 0,
        rip: 0x401004, rflags: 0x202,
      }},
      // レジスタ変更
      { type: "set_reg", reg: "rdi", value: 0x402010 },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "構造体の検査",
    description: "構造体メンバの表示、ポインタ経由のアクセス、ネストした変数の展開",
    ops: [
      { type: "start", program: "struct.c", args: ["struct"], source: structSource },
      { type: "break", line: 11 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 11 },
      // 構造体変数の表示
      { type: "print", expr: "pt", result: mkVar("pt", "struct Point", 0x7fffffffdfe0, 8, "{x = 3, y = 4}", [
        mkVar("x", "int", 0x7fffffffdfe0, 4, "3"),
        mkVar("y", "int", 0x7fffffffdfe4, 4, "4"),
      ]) },
      // メモリ上のレイアウト確認
      { type: "examine", addr: 0x7fffffffdfe0, count: 8, bytes: [3, 0, 0, 0, 4, 0, 0, 0] },
      // ポインタのアドレス確認
      { type: "print", expr: "&pt", result: mkVar("&pt", "struct Point *", 0x7fffffffdfe0, 8, "0x7fffffffdfe0") },
      // 関数に入る
      { type: "step" },
      { type: "call_function", funcName: "distance", args: [
        mkVar("p", "struct Point *", 0x7fffffffdfc0, 8, "0x7fffffffdfe0"),
      ], returnAddr: 0x401010, newFrame: mkFrame(0, "distance", "struct.c", 6, 0x401054, 0x7fffffffdfa0, [
        mkVar("p", "struct Point *", 0x7fffffffdfc0, 8, "0x7fffffffdfe0"),
      ], []) },
      // ポインタ経由で構造体アクセス
      { type: "print", expr: "*p", result: mkVar("*p", "struct Point", 0x7fffffffdfe0, 8, "{x = 3, y = 4}", [
        mkVar("x", "int", 0x7fffffffdfe0, 4, "3"),
        mkVar("y", "int", 0x7fffffffdfe4, 4, "4"),
      ]) },
      { type: "print", expr: "p->x", result: mkVar("p->x", "int", 0x7fffffffdfe0, 4, "3") },
      { type: "step_out" },
      { type: "return_function", funcName: "distance", returnValue: "25", frame: mkFrame(0, "main", "struct.c", 11, 0x40100c, 0x7fffffffe000, [], [
        mkVar("pt", "struct Point", 0x7fffffffdfe0, 8, "{x = 3, y = 4}"),
        mkVar("d", "int", 0x7fffffffdfdc, 4, "25"),
      ]) },
      { type: "print", expr: "d", result: mkVar("d", "int", 0x7fffffffdfdc, 4, "25") },
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "シグナルハンドリング",
    description: "デバッガによるシグナルの横取り、転送/破棄の制御",
    ops: [
      { type: "start", program: "loop.c", args: ["loop"], source: loopSource },
      { type: "catch_signal", signame: "SIGINT" },
      { type: "catch_signal", signame: "SIGUSR1" },
      { type: "break", line: 10 },
      { type: "continue" },
      { type: "hit_breakpoint", bpId: 1, line: 10 },
      // 外部からシグナル送信
      { type: "signal", signo: 10, signame: "SIGUSR1" },
      // デバッガがシグナルをキャッチして表示
      { type: "info_regs", regs: {
        rax: 0, rbx: 0, rcx: 0, rdx: 0,
        rsi: 0, rdi: 0, rbp: 0x7fffffffe000, rsp: 0x7fffffffdff0,
        r8: 0, r9: 0, r10: 0, r11: 0, r12: 0, r13: 0, r14: 0, r15: 0,
        rip: 0x40100c, rflags: 0x202,
      }},
      { type: "continue" },
      // SIGINT (Ctrl+C) のキャッチ
      { type: "signal", signo: 2, signame: "SIGINT" },
      { type: "backtrace", frames: [
        mkFrame(0, "main", "loop.c", 10, 0x40100c, 0x7fffffffe000, [], [
          mkVar("total", "int", 0x7fffffffdfe8, 4, "6"),
          mkVar("i", "int", 0x7fffffffdfe4, 4, "3"),
        ]),
      ]},
      { type: "continue" },
      { type: "exit", code: 0 },
    ],
  },
  {
    name: "システムコールトレース",
    description: "ptrace(PTRACE_SYSCALL) によるシステムコールのentry/exitトレース",
    ops: [
      { type: "start", program: "hello.c", args: ["hello"], source: helloSource },
      // syscallトレース開始
      { type: "syscall_trace", name: "brk", args: ["0"], retval: 0x405000 },
      { type: "syscall_trace", name: "mmap", args: ["NULL", "8192", "PROT_READ|PROT_WRITE", "MAP_PRIVATE|MAP_ANONYMOUS", "-1", "0"], retval: 0x7ffff7fc0000 },
      { type: "syscall_trace", name: "access", args: ["\"/etc/ld.so.preload\"", "R_OK"], retval: -2 },
      { type: "syscall_trace", name: "openat", args: ["AT_FDCWD", "\"/lib/x86_64-linux-gnu/libc.so.6\"", "O_RDONLY|O_CLOEXEC"], retval: 3 },
      { type: "syscall_trace", name: "read", args: ["3", "buf", "832"], retval: 832 },
      { type: "syscall_trace", name: "mmap", args: ["NULL", "1921024", "PROT_READ", "MAP_PRIVATE|MAP_DENYWRITE", "3", "0"], retval: 0x7ffff7c00000 },
      { type: "syscall_trace", name: "close", args: ["3"], retval: 0 },
      { type: "syscall_trace", name: "write", args: ["1", "\"Hello, World!\\n\"", "14"], retval: 14 },
      { type: "syscall_trace", name: "exit_group", args: ["0"], retval: 0 },
      { type: "exit", code: 0 },
    ],
  },
];
