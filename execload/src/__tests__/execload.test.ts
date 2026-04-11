import { describe, it, expect } from "vitest";
import { runSimulation } from "../execload/engine.js";
import { presets } from "../execload/presets.js";
import type { SimOp } from "../execload/types.js";

describe("shell_parse + fork + execve", () => {
  it("シェル解析イベントが生成される", () => {
    const ops: SimOp[] = [
      { type: "shell_parse", command: "./hello" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "shell_parse")).toBe(true);
  });

  it("fork + execveでプロセス作成", () => {
    const ops: SimOp[] = [
      { type: "fork" },
      { type: "execve", path: "/usr/bin/hello", argv: ["hello"], envp: ["PATH=/usr/bin"] },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "fork")).toBe(true);
    expect(result.events.some((e) => e.type === "execve")).toBe(true);
    expect(result.events.some((e) => e.type === "permission_check")).toBe(true);
  });
});

describe("ELFヘッダ解析", () => {
  it("ELFマジックナンバーが検出される", () => {
    const ops: SimOp[] = [
      { type: "read_magic", magic: "\\x7fELF", format: "ELF" },
    ];
    const result = runSimulation(ops);
    expect(result.events.filter((e) => e.type === "read_magic").length).toBe(2);
  });

  it("スクリプト形式が検出される", () => {
    const ops: SimOp[] = [
      { type: "read_magic", magic: "#!/bin/bash", format: "script" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "script_detect")).toBe(true);
  });

  it("ELFヘッダが解析される", () => {
    const ops: SimOp[] = [
      { type: "parse_elf_header", header: {
        magic: "\\x7fELF", class: "ELFCLASS64", endian: "little",
        type: "ET_EXEC", machine: "x86_64", entryPoint: 0x401080,
        phoff: 0x40, shoff: 0x3a98, phnum: 13, shnum: 31,
      }},
    ];
    const result = runSimulation(ops);
    expect(result.elfHeader).toBeDefined();
    expect(result.elfHeader!.entryPoint).toBe(0x401080);
    expect(result.events.filter((e) => e.type === "elf_header").length).toBe(2);
  });
});

describe("プログラムヘッダ / セクション", () => {
  it("プログラムヘッダが解析される", () => {
    const ops: SimOp[] = [
      { type: "parse_program_headers", headers: [
        { type: "PT_LOAD", offset: 0, vaddr: 0x400000, paddr: 0x400000, filesz: 0x700, memsz: 0x700, flags: "R", align: 0x1000 },
        { type: "PT_INTERP", offset: 0x318, vaddr: 0x400318, paddr: 0x400318, filesz: 28, memsz: 28, flags: "R", align: 1 },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.programHeaders.length).toBe(2);
    expect(result.events.filter((e) => e.type === "program_header").length).toBe(2);
  });

  it("セクションが解析される", () => {
    const ops: SimOp[] = [
      { type: "parse_sections", sections: [
        { name: ".text", vaddr: 0x401080, size: 0x16d, flags: "AX", description: "コード" },
        { name: ".data", vaddr: 0x404028, size: 0x10, flags: "WA", description: "データ" },
        { name: ".bss", vaddr: 0x404038, size: 0x18, flags: "WA", description: "BSS" },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.sections.length).toBe(3);
  });
});

describe("動的リンカ", () => {
  it("PT_INTERPでインタプリタが指定される", () => {
    const ops: SimOp[] = [
      { type: "check_interp", interpreter: "/lib64/ld-linux-x86-64.so.2" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "interp_check")).toBe(true);
  });

  it("動的リンカがロードされる", () => {
    const ops: SimOp[] = [
      { type: "load_interp", path: "/lib64/ld-linux-x86-64.so.2", baseAddr: 0x7ffff7fc5000 },
    ];
    const result = runSimulation(ops);
    expect(result.memoryMap.length).toBe(1);
    expect(result.stats.mmapCalls).toBe(1);
  });
});

describe("mmap / セグメントロード", () => {
  it("LOADセグメントがmmapされる", () => {
    const ops: SimOp[] = [
      { type: "mmap_segment", segment: {
        type: "PT_LOAD", offset: 0x1000, vaddr: 0x401000, paddr: 0x401000,
        filesz: 0x1ed, memsz: 0x1ed, flags: "RX", align: 0x1000,
      }, source: "/usr/bin/hello" },
    ];
    const result = runSimulation(ops);
    expect(result.memoryMap.length).toBe(1);
    expect(result.memoryMap[0]!.flags).toBe("r-xp");
    expect(result.stats.segmentsLoaded).toBe(1);
    expect(result.stats.totalMapped).toBe(0x1ed);
  });

  it("RWセグメントのパーミッション", () => {
    const ops: SimOp[] = [
      { type: "mmap_segment", segment: {
        type: "PT_LOAD", offset: 0x2e10, vaddr: 0x403e10, paddr: 0x403e10,
        filesz: 0x228, memsz: 0x240, flags: "RW", align: 0x1000,
      }, source: "/usr/bin/hello" },
    ];
    const result = runSimulation(ops);
    expect(result.memoryMap[0]!.flags).toBe("rw-p");
  });

  it(".bssがゼロ初期化される", () => {
    const ops: SimOp[] = [
      { type: "setup_bss", vaddr: 0x404038, size: 0x18 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "bss_zero")).toBe(true);
  });
});

describe("共有ライブラリ", () => {
  it("共有ライブラリがロードされる", () => {
    const ops: SimOp[] = [
      { type: "load_shared_lib", lib: {
        name: "libc.so.6", path: "/lib/x86_64-linux-gnu/libc.so.6",
        baseAddr: 0x7ffff7c00000, symbols: ["printf", "malloc"],
      }},
    ];
    const result = runSimulation(ops);
    expect(result.sharedLibs.length).toBe(1);
    expect(result.memoryMap.length).toBe(2); // .text + .data/.bss
    expect(result.stats.libsLoaded).toBe(1);
    expect(result.stats.mmapCalls).toBe(2);
  });

  it("複数ライブラリのロード", () => {
    const ops: SimOp[] = [
      { type: "load_shared_lib", lib: { name: "libc.so.6", path: "/lib/libc.so.6", baseAddr: 0x7ffff7c00000, symbols: ["printf"] }},
      { type: "load_shared_lib", lib: { name: "libm.so.6", path: "/lib/libm.so.6", baseAddr: 0x7ffff7a00000, symbols: ["sin"] }},
    ];
    const result = runSimulation(ops);
    expect(result.sharedLibs.length).toBe(2);
    expect(result.stats.libsLoaded).toBe(2);
  });
});

describe("シンボル解決", () => {
  it("即時バインディングでシンボルが解決される", () => {
    const ops: SimOp[] = [
      { type: "resolve_symbols", relocations: [
        { offset: 0x404008, symbol: "printf", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7ffff7c606b0 },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.relocations.length).toBe(1);
    expect(result.relocations[0]!.resolved).toBe(true);
    expect(result.stats.symbolsResolved).toBe(1);
  });

  it("遅延バインディング (lazy binding)", () => {
    const ops: SimOp[] = [
      { type: "resolve_symbols", relocations: [
        { offset: 0x404010, symbol: "puts", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.relocations[0]!.resolved).toBe(false);
    expect(result.stats.symbolsResolved).toBe(0);
  });
});

describe("スタック / プロセスイメージ", () => {
  it("スタックが初期化される", () => {
    const ops: SimOp[] = [
      { type: "setup_stack", argv: ["hello", "world"], envp: ["PATH=/usr/bin", "HOME=/home"], auxv: [
        { type: "AT_ENTRY", value: 0x401080, description: "エントリポイント" },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.memoryMap.some((m) => m.source === "[stack]")).toBe(true);
    expect(result.events.some((e) => e.type === "stack_setup")).toBe(true);
    expect(result.events.some((e) => e.type === "auxv_setup")).toBe(true);
  });

  it("プロセスイメージが構築される", () => {
    const ops: SimOp[] = [
      { type: "setup_process_image", image: {
        pid: 1234, argv: ["test"], envp: [],
        mappings: [], stackPointer: 0x7fffffffe000,
        entryPoint: 0x401080, brkAddr: 0x405000,
      }},
    ];
    const result = runSimulation(ops);
    expect(result.processImage).toBeDefined();
    expect(result.processImage!.pid).toBe(1234);
    // ヒープ, vDSO, vvarがマッピングに追加される
    expect(result.memoryMap.some((m) => m.source === "[heap]")).toBe(true);
    expect(result.memoryMap.some((m) => m.source === "[vdso]")).toBe(true);
    expect(result.memoryMap.some((m) => m.source === "[vvar]")).toBe(true);
  });
});

describe("初期化 / エントリ / main", () => {
  it("初期化関数が呼ばれる", () => {
    const ops: SimOp[] = [
      { type: "call_init", funcs: ["frame_dummy", "__do_global_ctors_aux"] },
    ];
    const result = runSimulation(ops);
    expect(result.events.filter((e) => e.type === "init_call").length).toBe(2);
  });

  it("エントリポイントにジャンプする", () => {
    const ops: SimOp[] = [
      { type: "jump_to_entry", addr: 0x401080 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "entry_jump")).toBe(true);
  });

  it("main()が呼ばれる", () => {
    const ops: SimOp[] = [
      { type: "call_main", argc: 2, argv_addr: 0x7fffffffe100, envp_addr: 0x7fffffffe110 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "main_call")).toBe(true);
  });
});

describe("スクリプト実行", () => {
  it("shebangでインタプリタが検出される", () => {
    const ops: SimOp[] = [
      { type: "script_exec", interpreter: "/bin/bash", script: "/home/user/script.sh" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "script_detect")).toBe(true);
  });
});

describe("統計", () => {
  it("統計が正しくカウントされる", () => {
    const ops: SimOp[] = [
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0, vaddr: 0x400000, paddr: 0, filesz: 0x100, memsz: 0x100, flags: "R", align: 0x1000 }, source: "test" },
      { type: "mmap_segment", segment: { type: "PT_LOAD", offset: 0x1000, vaddr: 0x401000, paddr: 0, filesz: 0x200, memsz: 0x200, flags: "RX", align: 0x1000 }, source: "test" },
      { type: "load_shared_lib", lib: { name: "lib.so", path: "/lib/lib.so", baseAddr: 0x7fff0000, symbols: ["foo"] }},
      { type: "resolve_symbols", relocations: [
        { offset: 0x4000, symbol: "foo", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: true, resolvedAddr: 0x7fff1000 },
        { offset: 0x4008, symbol: "bar", type: "R_X86_64_JUMP_SLOT", addend: 0, resolved: false },
      ]},
    ];
    const result = runSimulation(ops);
    expect(result.stats.segmentsLoaded).toBe(2);
    expect(result.stats.libsLoaded).toBe(1);
    expect(result.stats.symbolsResolved).toBe(1);
    expect(result.stats.mmapCalls).toBe(4); // 2 segments + 2 lib mappings
    expect(result.stats.totalMapped).toBe(0x300); // 0x100 + 0x200
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
