import type {
  ElfHeader, ProgramHeader, Section, SharedLib, Relocation,
  MemoryMapping, ProcessImage,
  SimOp, SimEvent, SimulationResult, EventType,
} from "./types.js";

function hex(n: number): string {
  return `0x${n.toString(16).padStart(8, "0")}`;
}

function flagsToPerms(flags: string): string {
  const r = flags.includes("R") ? "r" : "-";
  const w = flags.includes("W") ? "w" : "-";
  const x = flags.includes("X") ? "x" : "-";
  return `${r}${w}${x}p`;
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const events: SimEvent[] = [];
  let elfHeader: ElfHeader | undefined;
  const programHeaders: ProgramHeader[] = [];
  const sections: Section[] = [];
  const sharedLibs: SharedLib[] = [];
  const relocations: Relocation[] = [];
  const memoryMap: MemoryMapping[] = [];
  let processImage: ProcessImage | undefined;
  let step = 0;

  const stats = {
    totalSteps: 0, segmentsLoaded: 0, libsLoaded: 0,
    symbolsResolved: 0, mmapCalls: 0, totalMapped: 0,
  };

  function emit(type: EventType, desc: string, detail?: string): void {
    events.push({ step, type, description: desc, detail });
    stats.totalSteps++;
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "shell_parse": {
        emit("shell_parse",
          `シェルがコマンド解析: "${op.command}"`,
          `PATH検索 → 実行ファイル特定 → fork+execve準備`);
        break;
      }

      case "fork": {
        emit("fork",
          `fork() — 子プロセス作成`,
          `親プロセスのアドレス空間をコピー (Copy-on-Write)。子プロセスでexecve()を呼び出す。`);
        break;
      }

      case "execve": {
        emit("execve",
          `execve("${op.path}", [${op.argv.map((a) => `"${a}"`).join(", ")}], envp[${op.envp.length}])`,
          `カーネルが実行ファイルを開き、プロセスイメージを置き換える。現在のメモリマッピングは全て破棄。`);

        emit("permission_check",
          `権限チェック: ${op.path}`,
          `実行権限(x)確認、setuid/setgidビット確認、SELinuxコンテキスト確認`);
        break;
      }

      case "open_file": {
        emit("open_file",
          `open("${op.path}", O_RDONLY) — 実行ファイルオープン`,
          `VFS経由でinodeを取得。ファイルタイプとマジックナンバーを確認。`);
        break;
      }

      case "read_magic": {
        emit("read_magic",
          `先頭バイト読み取り: ${op.magic}`,
          `マジックナンバーで形式判定: ${op.format === "ELF" ? "\\x7fELF → ELF形式" : op.format === "script" ? "#! → スクリプト" : "a.out形式"}`);

        if (op.format === "ELF") {
          emit("read_magic",
            `ELF形式を検出 — binfmt_elf ハンドラに委譲`,
            `linux/fs/binfmt_elf.c の load_elf_binary() が処理`);
        } else if (op.format === "script") {
          emit("script_detect",
            `スクリプト検出 — binfmt_script ハンドラに委譲`,
            `#!行のインタプリタを実行し、スクリプトを引数として渡す`);
        }
        break;
      }

      case "parse_elf_header": {
        elfHeader = op.header;
        emit("elf_header",
          `ELFヘッダ解析`,
          `Class: ${op.header.class}, Endian: ${op.header.endian}, Type: ${op.header.type}, Machine: ${op.header.machine}`);
        emit("elf_header",
          `エントリポイント: ${hex(op.header.entryPoint)}`,
          `PHT: offset=${hex(op.header.phoff)}, ${op.header.phnum}エントリ | SHT: offset=${hex(op.header.shoff)}, ${op.header.shnum}エントリ`);
        break;
      }

      case "parse_program_headers": {
        for (const ph of op.headers) {
          programHeaders.push(ph);
          const desc = ph.type === "PT_LOAD"
            ? `LOADセグメント: ${hex(ph.vaddr)} (filesz=${ph.filesz}, memsz=${ph.memsz}, flags=${ph.flags})`
            : ph.type === "PT_INTERP"
              ? `インタプリタパス指定セグメント`
              : ph.type === "PT_DYNAMIC"
                ? `動的リンク情報セグメント`
                : `${ph.type}: vaddr=${hex(ph.vaddr)}`;

          emit("program_header", `プログラムヘッダ: ${ph.type} — ${desc}`,
            `offset=${hex(ph.offset)}, vaddr=${hex(ph.vaddr)}, filesz=${ph.filesz}, memsz=${ph.memsz}, align=${ph.align}`);
        }
        break;
      }

      case "parse_sections": {
        for (const sec of op.sections) {
          sections.push(sec);
        }
        emit("section_parse",
          `セクション解析: ${op.sections.length}セクション`,
          op.sections.map((s) => `${s.name}(${hex(s.vaddr)}, ${s.size}B, ${s.flags})`).join(", "));
        break;
      }

      case "check_interp": {
        emit("interp_check",
          `PT_INTERP: "${op.interpreter}"`,
          `動的リンカ(ld-linux)のパス。静的リンクの場合はPT_INTERPなし。`);
        break;
      }

      case "load_interp": {
        emit("interp_load",
          `動的リンカをロード: ${op.path} @ ${hex(op.baseAddr)}`,
          `ld-linux-x86-64.so.2自体もELF。カーネルがmmap()でマッピング。リンカが最初に実行され、共有ライブラリをロード後にアプリのエントリに飛ぶ。`);

        memoryMap.push({
          start: op.baseAddr, end: op.baseAddr + 0x30000,
          flags: "r-xp", source: op.path,
          description: "動的リンカ (.text)",
        });
        stats.mmapCalls++;
        break;
      }

      case "mmap_segment": {
        const seg = op.segment;
        const perms = flagsToPerms(seg.flags);

        memoryMap.push({
          start: seg.vaddr, end: seg.vaddr + seg.memsz,
          flags: perms, source: op.source,
          description: `${seg.type} segment (${seg.flags})`,
        });
        stats.mmapCalls++;
        stats.segmentsLoaded++;
        stats.totalMapped += seg.memsz;

        emit("mmap",
          `mmap(${hex(seg.vaddr)}, ${seg.memsz}, ${perms}) — ${op.source}`,
          `ファイルオフセット ${hex(seg.offset)} から ${seg.filesz}B をマッピング${seg.memsz > seg.filesz ? `、残り${seg.memsz - seg.filesz}Bはゼロ初期化(.bss)` : ""}`);
        break;
      }

      case "setup_bss": {
        emit("bss_zero",
          `.bss ゼロ初期化: ${hex(op.vaddr)} — ${op.size}B`,
          `未初期化グローバル変数領域。mmap時にMAP_ANONYMOUSで自動ゼロ化、またはPT_LOADのmemsz-fileszの差分をmemset(0)。`);
        break;
      }

      case "load_shared_lib": {
        sharedLibs.push(op.lib);
        stats.libsLoaded++;

        memoryMap.push({
          start: op.lib.baseAddr, end: op.lib.baseAddr + 0x200000,
          flags: "r-xp", source: op.lib.path,
          description: `${op.lib.name} (.text)`,
        });
        memoryMap.push({
          start: op.lib.baseAddr + 0x200000, end: op.lib.baseAddr + 0x210000,
          flags: "rw-p", source: op.lib.path,
          description: `${op.lib.name} (.data/.bss)`,
        });
        stats.mmapCalls += 2;

        emit("lib_load",
          `共有ライブラリロード: ${op.lib.name} @ ${hex(op.lib.baseAddr)}`,
          `${op.lib.path} — ${op.lib.symbols.length}シンボルエクスポート`);
        break;
      }

      case "resolve_symbols": {
        for (const rel of op.relocations) {
          relocations.push(rel);
          if (rel.resolved) {
            stats.symbolsResolved++;
            emit("relocation",
              `リロケーション: ${rel.symbol} @ ${hex(rel.offset)} → ${hex(rel.resolvedAddr!)} (${rel.type})`,
              `GOT/PLTエントリを解決済みアドレスで更新`);
          } else {
            emit("relocation",
              `遅延バインディング: ${rel.symbol} @ ${hex(rel.offset)} (${rel.type})`,
              `PLT経由で初回呼び出し時に解決 (lazy binding)`);
          }
        }
        break;
      }

      case "setup_stack": {
        const stackTop = 0x7fffffffe000;
        const stackSize = 0x800000; // 8MB
        memoryMap.push({
          start: stackTop - stackSize, end: stackTop,
          flags: "rw-p", source: "[stack]",
          description: "スタック (8MB)",
        });
        stats.mmapCalls++;

        emit("stack_setup",
          `スタック初期化: ${hex(stackTop - stackSize)}-${hex(stackTop)} (8MB)`,
          `スタック最上部からargv, envp, auxvを積む`);

        // スタックレイアウト
        let sp = stackTop - 0x100;
        emit("stack_setup",
          `argc=${op.argv.length} をスタックにpush (SP=${hex(sp)})`,
          `main()のargcに渡される値`);

        for (const arg of op.argv) {
          sp -= arg.length + 1;
          emit("stack_setup",
            `argv: "${arg}" → ${hex(sp)}`,
            undefined);
        }

        for (const env of op.envp.slice(0, 3)) {
          sp -= env.length + 1;
          emit("stack_setup",
            `envp: "${env}" → ${hex(sp)}`,
            undefined);
        }
        if (op.envp.length > 3) {
          emit("stack_setup",
            `envp: ... (他${op.envp.length - 3}個)`,
            undefined);
        }

        // 補助ベクトル
        emit("auxv_setup", `補助ベクトル(auxv)をスタックに配置`);
        for (const aux of op.auxv) {
          emit("auxv_setup",
            `${aux.type} = ${typeof aux.value === "number" ? hex(aux.value as number) : aux.value} — ${aux.description}`,
            undefined);
        }
        break;
      }

      case "setup_process_image": {
        processImage = op.image;

        // heap
        memoryMap.push({
          start: op.image.brkAddr, end: op.image.brkAddr + 0x21000,
          flags: "rw-p", source: "[heap]",
          description: "ヒープ",
        });
        // vdso
        memoryMap.push({
          start: 0x7ffff7fc0000, end: 0x7ffff7fc2000,
          flags: "r-xp", source: "[vdso]",
          description: "vDSO (仮想動的共有オブジェクト)",
        });
        // vvar
        memoryMap.push({
          start: 0x7ffff7fbe000, end: 0x7ffff7fc0000,
          flags: "r--p", source: "[vvar]",
          description: "vvar (カーネル変数)",
        });

        emit("process_image",
          `プロセスイメージ完成: PID=${op.image.pid}`,
          `エントリポイント=${hex(op.image.entryPoint)}, SP=${hex(op.image.stackPointer)}, brk=${hex(op.image.brkAddr)}`);
        break;
      }

      case "call_init": {
        for (const func of op.funcs) {
          emit("init_call",
            `初期化関数呼び出し: ${func}()`,
            `.init_array / .init セクションの関数。C++グローバルコンストラクタ、__attribute__((constructor)) など。`);
        }
        break;
      }

      case "jump_to_entry": {
        emit("entry_jump",
          `エントリポイントにジャンプ: ${hex(op.addr)}`,
          `動的リンカがすべてのセットアップ完了後、アプリの_startに制御を移す。_startはCRTの一部。`);
        break;
      }

      case "call_main": {
        emit("main_call",
          `_start → __libc_start_main() → main(${op.argc}, ${hex(op.argv_addr)}, ${hex(op.envp_addr)})`,
          `CRTスタートアップ: _start が __libc_start_main を呼び、main()の前にstdio初期化、TLS設定、atexit登録などを行う。`);
        break;
      }

      case "script_exec": {
        emit("script_detect",
          `#!${op.interpreter} を検出 — スクリプト実行`,
          `カーネルがexecve("${op.interpreter}", ["${op.interpreter}", "${op.script}"], envp)を再帰呼び出し`);
        break;
      }
    }
  }

  return { events, elfHeader, programHeaders, sections, sharedLibs, relocations, memoryMap, processImage, stats };
}
