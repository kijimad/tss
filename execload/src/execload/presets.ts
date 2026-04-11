import type { Preset } from "./types.js";

/** 共通のELFヘッダ (x86_64, 動的リンク) */
const elfHeaderDynamic = {
  magic: "\\x7fELF",
  class: "ELFCLASS64" as const,
  endian: "little" as const,
  type: "ET_EXEC" as const,
  machine: "x86_64",
  entryPoint: 0x401080,
  phoff: 0x40,
  shoff: 0x3a98,
  phnum: 13,
  shnum: 31,
};

/** 共通のELFヘッダ (x86_64, 静的リンク) */
const elfHeaderStatic = {
  ...elfHeaderDynamic,
  entryPoint: 0x401000,
  phnum: 8,
  shnum: 20,
};

/** PIE実行ファイル用ヘッダ */
const elfHeaderPIE = {
  ...elfHeaderDynamic,
  type: "ET_DYN" as const,
  entryPoint: 0x1080,
  phnum: 13,
};

/** 共通のプログラムヘッダ */
const commonProgramHeaders = [
  { type: "PT_PHDR" as const, offset: 0x40, vaddr: 0x400040, paddr: 0x400040, filesz: 0x2d8, memsz: 0x2d8, flags: "R", align: 8 },
  { type: "PT_INTERP" as const, offset: 0x318, vaddr: 0x400318, paddr: 0x400318, filesz: 28, memsz: 28, flags: "R", align: 1 },
  { type: "PT_LOAD" as const, offset: 0, vaddr: 0x400000, paddr: 0x400000, filesz: 0x700, memsz: 0x700, flags: "R", align: 0x1000 },
  { type: "PT_LOAD" as const, offset: 0x1000, vaddr: 0x401000, paddr: 0x401000, filesz: 0x1ed, memsz: 0x1ed, flags: "RX", align: 0x1000 },
  { type: "PT_LOAD" as const, offset: 0x2000, vaddr: 0x402000, paddr: 0x402000, filesz: 0x158, memsz: 0x158, flags: "R", align: 0x1000 },
  { type: "PT_LOAD" as const, offset: 0x2e10, vaddr: 0x403e10, paddr: 0x403e10, filesz: 0x228, memsz: 0x240, flags: "RW", align: 0x1000 },
  { type: "PT_DYNAMIC" as const, offset: 0x2e20, vaddr: 0x403e20, paddr: 0x403e20, filesz: 0x1d0, memsz: 0x1d0, flags: "RW", align: 8 },
  { type: "PT_NOTE" as const, offset: 0x338, vaddr: 0x400338, paddr: 0x400338, filesz: 0x30, memsz: 0x30, flags: "R", align: 8 },
  { type: "PT_GNU_STACK" as const, offset: 0, vaddr: 0, paddr: 0, filesz: 0, memsz: 0, flags: "RW", align: 0x10 },
  { type: "PT_GNU_RELRO" as const, offset: 0x2e10, vaddr: 0x403e10, paddr: 0x403e10, filesz: 0x1f0, memsz: 0x1f0, flags: "R", align: 1 },
];

/** 共通のセクション定義 */
const commonSections = [
  { name: ".interp", vaddr: 0x400318, size: 28, flags: "A", description: "インタプリタパス" },
  { name: ".dynsym", vaddr: 0x400370, size: 0xa8, flags: "A", description: "動的シンボルテーブル" },
  { name: ".dynstr", vaddr: 0x400418, size: 0x8d, flags: "A", description: "動的文字列テーブル" },
  { name: ".rela.plt", vaddr: 0x400500, size: 0x48, flags: "AI", description: "PLTリロケーション" },
  { name: ".text", vaddr: 0x401080, size: 0x16d, flags: "AX", description: "コードセクション" },
  { name: ".rodata", vaddr: 0x402000, size: 0x20, flags: "A", description: "読み取り専用データ" },
  { name: ".got", vaddr: 0x403ff0, size: 0x10, flags: "WA", description: "Global Offset Table" },
  { name: ".got.plt", vaddr: 0x404000, size: 0x28, flags: "WA", description: "PLT用GOT" },
  { name: ".data", vaddr: 0x404028, size: 0x10, flags: "WA", description: "初期化済みデータ" },
  { name: ".bss", vaddr: 0x404038, size: 0x18, flags: "WA", description: "未初期化データ" },
  { name: ".plt", vaddr: 0x401020, size: 0x40, flags: "AX", description: "Procedure Linkage Table" },
  { name: ".init", vaddr: 0x401000, size: 0x1b, flags: "AX", description: "初期化コード" },
  { name: ".fini", vaddr: 0x4011ec, size: 0xd, flags: "AX", description: "終了コード" },
  { name: ".dynamic", vaddr: 0x403e20, size: 0x1d0, flags: "WA", description: "動的リンク情報" },
  { name: ".init_array", vaddr: 0x403e10, size: 8, flags: "WA", description: "初期化関数ポインタ配列" },
  { name: ".fini_array", vaddr: 0x403e18, size: 8, flags: "WA", description: "終了関数ポインタ配列" },
];

/** 共通の環境変数 */
const commonEnvp = [
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "HOME=/home/user",
  "LANG=en_US.UTF-8",
  "TERM=xterm-256color",
  "SHELL=/bin/bash",
  "USER=user",
  "LD_LIBRARY_PATH=",
];

/** 共通の補助ベクトル */
const commonAuxv = [
  { type: "AT_PHDR", value: 0x400040, description: "プログラムヘッダテーブルのアドレス" },
  { type: "AT_PHENT", value: 56, description: "プログラムヘッダエントリサイズ" },
  { type: "AT_PHNUM", value: 13, description: "プログラムヘッダ数" },
  { type: "AT_PAGESZ", value: 4096, description: "ページサイズ" },
  { type: "AT_BASE", value: 0x7ffff7fc5000, description: "インタプリタベースアドレス" },
  { type: "AT_ENTRY", value: 0x401080, description: "プログラムエントリポイント" },
  { type: "AT_UID", value: 1000, description: "実ユーザID" },
  { type: "AT_EUID", value: 1000, description: "実効ユーザID" },
  { type: "AT_RANDOM", value: 0x7fffffffe3a9, description: "16バイトの乱数アドレス" },
  { type: "AT_EXECFN", value: "/usr/bin/hello", description: "実行ファイル名" },
  { type: "AT_PLATFORM", value: "x86_64", description: "プラットフォーム文字列" },
  { type: "AT_SYSINFO_EHDR", value: 0x7ffff7fc0000, description: "vDSOのELFヘッダ" },
];

/** libc共有ライブラリ */
const libc: { name: string; path: string; baseAddr: number; symbols: string[] } = {
  name: "libc.so.6",
  path: "/lib/x86_64-linux-gnu/libc.so.6",
  baseAddr: 0x7ffff7c00000,
  symbols: ["printf", "puts", "malloc", "free", "exit", "__libc_start_main", "write", "read", "open", "close"],
};

/** libm共有ライブラリ */
const libm: { name: string; path: string; baseAddr: number; symbols: string[] } = {
  name: "libm.so.6",
  path: "/lib/x86_64-linux-gnu/libm.so.6",
  baseAddr: 0x7ffff7a00000,
  symbols: ["sin", "cos", "sqrt", "pow", "log", "exp"],
};

/** libpthread共有ライブラリ */
const libpthread: { name: string; path: string; baseAddr: number; symbols: string[] } = {
  name: "libpthread.so.0",
  path: "/lib/x86_64-linux-gnu/libpthread.so.0",
  baseAddr: 0x7ffff7800000,
  symbols: ["pthread_create", "pthread_join", "pthread_mutex_lock", "pthread_mutex_unlock"],
};

export const presets: Preset[] = [
  {
    name: "基本: 動的リンクELF実行",
    description: "hello worldプログラムの起動フロー全体 (shell→fork→execve→ELF解析→動的リンク→main)",
    ops: [
      { type: "shell_parse", command: "./hello" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/hello", argv: ["hello"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/hello" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderDynamic },
      { type: "parse_program_headers", headers: commonProgramHeaders },
      { type: "parse_sections", sections: commonSections },
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      // LOADセグメントをmmapでマッピング
      { type: "mmap_segment", segment: commonProgramHeaders[2]!, source: "/usr/bin/hello" },
      { type: "mmap_segment", segment: commonProgramHeaders[3]!, source: "/usr/bin/hello" },
      { type: "mmap_segment", segment: commonProgramHeaders[4]!, source: "/usr/bin/hello" },
      { type: "mmap_segment", segment: commonProgramHeaders[5]!, source: "/usr/bin/hello" },
      { type: "setup_bss", vaddr: 0x404038, size: 0x18 },
      { type: "load_shared_lib", lib: libc },
      { type: "resolve_symbols", relocations: [
        { offset: 0x404008, symbol: "puts", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404010, symbol: "__libc_start_main", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c29dc0 },
      ]},
      { type: "setup_stack", argv: ["hello"], envp: commonEnvp, auxv: commonAuxv },
      { type: "setup_process_image", image: {
        pid: 12345, argv: ["hello"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x401080, brkAddr: 0x405000,
      }},
      { type: "call_init", funcs: ["frame_dummy", "__do_global_ctors_aux"] },
      { type: "jump_to_entry", addr: 0x401080 },
      { type: "call_main", argc: 1, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe110 },
    ],
  },
  {
    name: "静的リンクELF実行",
    description: "静的リンクされた実行ファイル — 動的リンカ不要、直接_startにジャンプ",
    ops: [
      { type: "shell_parse", command: "./hello-static" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/hello-static", argv: ["hello-static"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/hello-static" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderStatic },
      { type: "parse_program_headers", headers: [
        commonProgramHeaders[0]!,
        { type: "PT_LOAD" as const, offset: 0, vaddr: 0x400000, paddr: 0x400000, filesz: 0xb4a98, memsz: 0xb4a98, flags: "R", align: 0x1000 },
        { type: "PT_LOAD" as const, offset: 0xb5000, vaddr: 0x4b5000, paddr: 0x4b5000, filesz: 0x7f1e5, memsz: 0x7f1e5, flags: "RX", align: 0x1000 },
        { type: "PT_LOAD" as const, offset: 0x135000, vaddr: 0x535000, paddr: 0x535000, filesz: 0x1abc8, memsz: 0x1abc8, flags: "R", align: 0x1000 },
        { type: "PT_LOAD" as const, offset: 0x150580, vaddr: 0x551580, paddr: 0x551580, filesz: 0x5a78, memsz: 0x7c60, flags: "RW", align: 0x1000 },
        { type: "PT_NOTE" as const, offset: 0x2f0, vaddr: 0x4002f0, paddr: 0x4002f0, filesz: 0x30, memsz: 0x30, flags: "R", align: 8 },
        { type: "PT_GNU_STACK" as const, offset: 0, vaddr: 0, paddr: 0, filesz: 0, memsz: 0, flags: "RW", align: 0x10 },
      ]},
      { type: "parse_sections", sections: [
        { name: ".text", vaddr: 0x4b5000, size: 0x7f1e5, flags: "AX", description: "コード (libc含む全コード)" },
        { name: ".rodata", vaddr: 0x535000, size: 0x1abc8, flags: "A", description: "読み取り専用データ" },
        { name: ".data", vaddr: 0x551580, size: 0x5a78, flags: "WA", description: "初期化済みデータ" },
        { name: ".bss", vaddr: 0x5569f8, size: 0x21e8, flags: "WA", description: "未初期化データ" },
      ]},
      // 静的リンク: PT_INTERPなし、動的リンカ不要
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0, vaddr: 0x400000, paddr: 0x400000, filesz: 0xb4a98, memsz: 0xb4a98, flags: "R", align: 0x1000 }, source: "/usr/bin/hello-static" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0xb5000, vaddr: 0x4b5000, paddr: 0x4b5000, filesz: 0x7f1e5, memsz: 0x7f1e5, flags: "RX", align: 0x1000 }, source: "/usr/bin/hello-static" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x135000, vaddr: 0x535000, paddr: 0x535000, filesz: 0x1abc8, memsz: 0x1abc8, flags: "R", align: 0x1000 }, source: "/usr/bin/hello-static" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x150580, vaddr: 0x551580, paddr: 0x551580, filesz: 0x5a78, memsz: 0x7c60, flags: "RW", align: 0x1000 }, source: "/usr/bin/hello-static" },
      { type: "setup_bss", vaddr: 0x5569f8, size: 0x21e8 },
      { type: "setup_stack", argv: ["hello-static"], envp: commonEnvp, auxv: [
        { type: "AT_PHDR", value: 0x400040, description: "プログラムヘッダテーブル" },
        { type: "AT_PHENT", value: 56, description: "PHエントリサイズ" },
        { type: "AT_PHNUM", value: 8, description: "PH数" },
        { type: "AT_PAGESZ", value: 4096, description: "ページサイズ" },
        { type: "AT_ENTRY", value: 0x401000, description: "エントリポイント" },
        { type: "AT_RANDOM", value: 0x7fffffffe3a9, description: "乱数" },
      ]},
      { type: "setup_process_image", image: {
        pid: 12346, argv: ["hello-static"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x401000, brkAddr: 0x558000,
      }},
      { type: "jump_to_entry", addr: 0x401000 },
      { type: "call_main", argc: 1, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe110 },
    ],
  },
  {
    name: "共有ライブラリの複数ロード",
    description: "libc + libm + libpthread の順にロードし、シンボル解決の流れを観察",
    ops: [
      { type: "shell_parse", command: "./math_threaded" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/math_threaded", argv: ["math_threaded", "--threads=4"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/math_threaded" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderDynamic },
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      { type: "mmap_segment", segment: commonProgramHeaders[3]!, source: "/usr/bin/math_threaded" },
      { type: "mmap_segment", segment: commonProgramHeaders[5]!, source: "/usr/bin/math_threaded" },
      // 3つの共有ライブラリをロード
      { type: "load_shared_lib", lib: libc },
      { type: "load_shared_lib", lib: libm },
      { type: "load_shared_lib", lib: libpthread },
      // シンボル解決
      { type: "resolve_symbols", relocations: [
        { offset: 0x404008, symbol: "printf", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c606b0 },
        { offset: 0x404010, symbol: "sin", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7a31a20 },
        { offset: 0x404018, symbol: "cos", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7a31fa0 },
        { offset: 0x404020, symbol: "sqrt", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7a38c70 },
        { offset: 0x404028, symbol: "pthread_create", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7809680 },
        { offset: 0x404030, symbol: "pthread_join", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff780a340 },
        { offset: 0x404038, symbol: "__libc_start_main", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c29dc0 },
      ]},
      { type: "setup_stack", argv: ["math_threaded", "--threads=4"], envp: commonEnvp, auxv: commonAuxv },
      { type: "setup_process_image", image: {
        pid: 12347, argv: ["math_threaded", "--threads=4"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x401080, brkAddr: 0x405000,
      }},
      { type: "call_init", funcs: ["frame_dummy", "init_libm_tables", "pthread_init"] },
      { type: "jump_to_entry", addr: 0x401080 },
      { type: "call_main", argc: 2, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe118 },
    ],
  },
  {
    name: "PIE (位置独立実行ファイル)",
    description: "PIE (ET_DYN) 実行ファイルのASLRによるランダムベースアドレスでのロード",
    ops: [
      { type: "shell_parse", command: "./hello-pie" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/hello-pie", argv: ["hello-pie"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/hello-pie" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderPIE },
      { type: "parse_program_headers", headers: [
        { type: "PT_PHDR" as const, offset: 0x40, vaddr: 0x40, paddr: 0x40, filesz: 0x2d8, memsz: 0x2d8, flags: "R", align: 8 },
        { type: "PT_INTERP" as const, offset: 0x318, vaddr: 0x318, paddr: 0x318, filesz: 28, memsz: 28, flags: "R", align: 1 },
        { type: "PT_LOAD" as const, offset: 0, vaddr: 0, paddr: 0, filesz: 0x600, memsz: 0x600, flags: "R", align: 0x1000 },
        { type: "PT_LOAD" as const, offset: 0x1000, vaddr: 0x1000, paddr: 0x1000, filesz: 0x1a5, memsz: 0x1a5, flags: "RX", align: 0x1000 },
        { type: "PT_LOAD" as const, offset: 0x2000, vaddr: 0x2000, paddr: 0x2000, filesz: 0x100, memsz: 0x100, flags: "R", align: 0x1000 },
        { type: "PT_LOAD" as const, offset: 0x2df8, vaddr: 0x3df8, paddr: 0x3df8, filesz: 0x220, memsz: 0x230, flags: "RW", align: 0x1000 },
        { type: "PT_DYNAMIC" as const, offset: 0x2e08, vaddr: 0x3e08, paddr: 0x3e08, filesz: 0x1c0, memsz: 0x1c0, flags: "RW", align: 8 },
      ]},
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      // PIEはET_DYNなのでベースアドレスがASLRでランダム化される
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0, vaddr: 0x555555554000, paddr: 0, filesz: 0x600, memsz: 0x600, flags: "R", align: 0x1000 }, source: "/usr/bin/hello-pie (ASLR base=0x555555554000)" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x1000, vaddr: 0x555555555000, paddr: 0, filesz: 0x1a5, memsz: 0x1a5, flags: "RX", align: 0x1000 }, source: "/usr/bin/hello-pie" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x2000, vaddr: 0x555555556000, paddr: 0, filesz: 0x100, memsz: 0x100, flags: "R", align: 0x1000 }, source: "/usr/bin/hello-pie" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x2df8, vaddr: 0x555555557df8, paddr: 0, filesz: 0x220, memsz: 0x230, flags: "RW", align: 0x1000 }, source: "/usr/bin/hello-pie" },
      { type: "load_shared_lib", lib: libc },
      { type: "resolve_symbols", relocations: [
        { offset: 0x555555558008, symbol: "puts", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x555555558010, symbol: "__libc_start_main", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c29dc0 },
      ]},
      { type: "setup_stack", argv: ["hello-pie"], envp: commonEnvp, auxv: [
        ...commonAuxv.slice(0, -2),
        { type: "AT_ENTRY", value: 0x555555555080, description: "PIEエントリ (ASLR後)" },
        { type: "AT_SYSINFO_EHDR", value: 0x7ffff7fc0000, description: "vDSO" },
      ]},
      { type: "setup_process_image", image: {
        pid: 12348, argv: ["hello-pie"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x555555555080, brkAddr: 0x555555559000,
      }},
      { type: "jump_to_entry", addr: 0x555555555080 },
      { type: "call_main", argc: 1, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe110 },
    ],
  },
  {
    name: "シェルスクリプト実行 (#!)",
    description: "shebang (#!) でインタプリタを検出し、再帰的にexecveを呼び出す流れ",
    ops: [
      { type: "shell_parse", command: "./script.sh" },
      { type: "fork" },
      { type: "execve", path: "/home/user/script.sh", argv: ["script.sh", "arg1"], envp: commonEnvp },
      { type: "open_file", path: "/home/user/script.sh" },
      { type: "read_magic", magic: "#!/bin/bash\\n", format: "script" },
      { type: "script_exec", interpreter: "/bin/bash", script: "/home/user/script.sh" },
      // bashの起動 (再帰的execve)
      { type: "open_file", path: "/bin/bash" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: { ...elfHeaderDynamic, entryPoint: 0x42a4c0, phnum: 11, shnum: 29 } },
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0, vaddr: 0x400000, paddr: 0x400000, filesz: 0x2c000, memsz: 0x2c000, flags: "R", align: 0x1000 }, source: "/bin/bash" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x2c000, vaddr: 0x42c000, paddr: 0x42c000, filesz: 0xc5000, memsz: 0xc5000, flags: "RX", align: 0x1000 }, source: "/bin/bash" },
      { type: "load_shared_lib", lib: libc },
      { type: "load_shared_lib", lib: { name: "libreadline.so.8", path: "/lib/x86_64-linux-gnu/libreadline.so.8", baseAddr: 0x7ffff7600000, symbols: ["readline", "add_history", "rl_complete"] } },
      { type: "setup_stack", argv: ["/bin/bash", "/home/user/script.sh", "arg1"], envp: commonEnvp, auxv: commonAuxv },
      { type: "setup_process_image", image: {
        pid: 12349, argv: ["/bin/bash", "/home/user/script.sh", "arg1"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x42a4c0, brkAddr: 0x500000,
      }},
      { type: "jump_to_entry", addr: 0x42a4c0 },
      { type: "call_main", argc: 3, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe120 },
    ],
  },
  {
    name: "ELFヘッダ詳細解析",
    description: "ELFヘッダ→プログラムヘッダ→セクションヘッダの解析過程を詳細に表示",
    ops: [
      { type: "open_file", path: "/usr/bin/example" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderDynamic },
      { type: "parse_program_headers", headers: commonProgramHeaders },
      { type: "parse_sections", sections: commonSections },
    ],
  },
  {
    name: "スタックレイアウト詳細",
    description: "プロセス起動時のスタック構造: argc, argv, envp, 補助ベクトル (auxv) の配置",
    ops: [
      { type: "shell_parse", command: "ls -la /tmp" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/ls", argv: ["ls", "-la", "/tmp"], envp: [
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/home/user",
        "LANG=ja_JP.UTF-8",
        "TERM=xterm-256color",
        "SHELL=/bin/bash",
        "USER=user",
        "COLUMNS=120",
        "LS_COLORS=rs=0:di=01;34:ln=01;36:mh=00",
      ]},
      { type: "setup_stack", argv: ["ls", "-la", "/tmp"], envp: [
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/home/user",
        "LANG=ja_JP.UTF-8",
        "TERM=xterm-256color",
        "SHELL=/bin/bash",
        "USER=user",
        "COLUMNS=120",
        "LS_COLORS=rs=0:di=01;34:ln=01;36:mh=00",
      ], auxv: [
        { type: "AT_PHDR", value: 0x400040, description: "プログラムヘッダテーブル" },
        { type: "AT_PHENT", value: 56, description: "PHエントリサイズ (56バイト)" },
        { type: "AT_PHNUM", value: 13, description: "PHエントリ数" },
        { type: "AT_PAGESZ", value: 4096, description: "システムページサイズ" },
        { type: "AT_FLAGS", value: 0, description: "フラグ" },
        { type: "AT_BASE", value: 0x7ffff7fc5000, description: "ld-linux ベースアドレス" },
        { type: "AT_ENTRY", value: 0x4049a0, description: "プログラムエントリポイント (_start)" },
        { type: "AT_UID", value: 1000, description: "実UID" },
        { type: "AT_EUID", value: 1000, description: "実効UID" },
        { type: "AT_GID", value: 1000, description: "実GID" },
        { type: "AT_EGID", value: 1000, description: "実効GID" },
        { type: "AT_CLKTCK", value: 100, description: "clock ticks/sec (sysconf(_SC_CLK_TCK))" },
        { type: "AT_RANDOM", value: 0x7fffffffe3a9, description: "16バイト乱数 (stack canary種)" },
        { type: "AT_SECURE", value: 0, description: "セキュアモード (setuid時に1)" },
        { type: "AT_EXECFN", value: "/usr/bin/ls", description: "実行ファイル名文字列へのポインタ" },
        { type: "AT_PLATFORM", value: "x86_64", description: "ハードウェアプラットフォーム" },
        { type: "AT_SYSINFO_EHDR", value: 0x7ffff7fc0000, description: "vDSO ELFヘッダ" },
        { type: "AT_NULL", value: 0, description: "auxv終端" },
      ]},
    ],
  },
  {
    name: "シンボル解決 (GOT/PLT)",
    description: "即時バインディングと遅延バインディング (lazy binding) の比較",
    ops: [
      { type: "shell_parse", command: "./app" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/app", argv: ["app"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/app" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderDynamic },
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      { type: "load_shared_lib", lib: libc },
      { type: "load_shared_lib", lib: libm },
      // 即時解決 (LD_BIND_NOW=1 相当のシンボル)
      { type: "resolve_symbols", relocations: [
        { offset: 0x403ff8, symbol: "__libc_start_main", type: "R_X86_64_GLOB_DAT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c29dc0 },
        { offset: 0x404000, symbol: "__gmon_start__", type: "R_X86_64_GLOB_DAT", addend: 0, resolved: true, resolvedAddr: 0 },
      ]},
      // 遅延バインディング (PLT経由)
      { type: "resolve_symbols", relocations: [
        { offset: 0x404018, symbol: "printf", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404020, symbol: "puts", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404028, symbol: "sin", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404030, symbol: "cos", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404038, symbol: "malloc", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404040, symbol: "free", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
      ]},
      { type: "jump_to_entry", addr: 0x401080 },
      { type: "call_main", argc: 1, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe110 },
    ],
  },
  {
    name: "メモリマッピング全体像",
    description: "プロセスの完全なメモリマップ: テキスト, データ, BSS, ヒープ, ライブラリ, スタック, vDSO",
    ops: [
      { type: "shell_parse", command: "./server" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/server", argv: ["server", "--port", "8080"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/server" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderDynamic },
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      // テキスト + データセグメント
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0, vaddr: 0x400000, paddr: 0x400000, filesz: 0x700, memsz: 0x700, flags: "R", align: 0x1000 }, source: "/usr/bin/server" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x1000, vaddr: 0x401000, paddr: 0x401000, filesz: 0x3000, memsz: 0x3000, flags: "RX", align: 0x1000 }, source: "/usr/bin/server" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x4000, vaddr: 0x404000, paddr: 0x404000, filesz: 0x1000, memsz: 0x1000, flags: "R", align: 0x1000 }, source: "/usr/bin/server" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x5000, vaddr: 0x405000, paddr: 0x405000, filesz: 0x500, memsz: 0x800, flags: "RW", align: 0x1000 }, source: "/usr/bin/server" },
      { type: "setup_bss", vaddr: 0x405500, size: 0x300 },
      // ライブラリ群
      { type: "load_shared_lib", lib: libc },
      { type: "load_shared_lib", lib: libpthread },
      { type: "load_shared_lib", lib: { name: "libssl.so.3", path: "/lib/x86_64-linux-gnu/libssl.so.3", baseAddr: 0x7ffff7400000, symbols: ["SSL_new", "SSL_read", "SSL_write", "SSL_connect"] } },
      // スタック + プロセスイメージ
      { type: "setup_stack", argv: ["server", "--port", "8080"], envp: commonEnvp, auxv: commonAuxv },
      { type: "setup_process_image", image: {
        pid: 12350, argv: ["server", "--port", "8080"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x401080, brkAddr: 0x406000,
      }},
      { type: "resolve_symbols", relocations: [
        { offset: 0x405008, symbol: "printf", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c606b0 },
        { offset: 0x405010, symbol: "pthread_create", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7809680 },
        { offset: 0x405018, symbol: "SSL_new", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7412340 },
        { offset: 0x405020, symbol: "malloc", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
      ]},
      { type: "call_init", funcs: ["frame_dummy", "ssl_init", "pthread_init"] },
      { type: "jump_to_entry", addr: 0x401080 },
      { type: "call_main", argc: 3, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe120 },
    ],
  },
  {
    name: "CRTスタートアップ詳細",
    description: "_start → __libc_start_main → main() のCRTスタートアップシーケンス全体",
    ops: [
      { type: "shell_parse", command: "./app" },
      { type: "fork" },
      { type: "execve", path: "/usr/bin/app", argv: ["app", "foo", "bar"], envp: commonEnvp },
      { type: "open_file", path: "/usr/bin/app" },
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
      { type: "parse_elf_header", header: elfHeaderDynamic },
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
      { type: "mmap_segment", segment: commonProgramHeaders[3]!, source: "/usr/bin/app" },
      { type: "mmap_segment", segment: commonProgramHeaders[5]!, source: "/usr/bin/app" },
      { type: "load_shared_lib", lib: libc },
      { type: "resolve_symbols", relocations: [
        { offset: 0x404008, symbol: "__libc_start_main", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c29dc0 },
        { offset: 0x404010, symbol: "puts", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
        { offset: 0x404018, symbol: "printf", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
      ]},
      { type: "setup_stack", argv: ["app", "foo", "bar"], envp: commonEnvp, auxv: commonAuxv },
      { type: "setup_process_image", image: {
        pid: 12351, argv: ["app", "foo", "bar"], envp: commonEnvp,
        mappings: [], stackPointer: 0x7fffffffe000, entryPoint: 0x401080, brkAddr: 0x405000,
      }},
      // 初期化関数群
      { type: "call_init", funcs: ["_init", "frame_dummy", "__do_global_ctors_aux", "register_atexit_handlers"] },
      // エントリポイントへジャンプ
      { type: "jump_to_entry", addr: 0x401080 },
      // CRTスタートアップ → main
      { type: "call_main", argc: 3, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe120 },
    ],
  },
];
