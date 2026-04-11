/** 実行ファイル形式 */
export type ExecFormat = "ELF" | "a.out" | "script";

/** ELFクラス */
export type ElfClass = "ELFCLASS32" | "ELFCLASS64";

/** ELFタイプ */
export type ElfType = "ET_EXEC" | "ET_DYN" | "ET_REL";

/** ELFヘッダ */
export interface ElfHeader {
  magic: string;          // "\x7fELF"
  class: ElfClass;
  endian: "little" | "big";
  type: ElfType;
  machine: string;        // "x86_64", "aarch64" など
  entryPoint: number;     // _start アドレス
  phoff: number;          // プログラムヘッダオフセット
  shoff: number;          // セクションヘッダオフセット
  phnum: number;          // プログラムヘッダ数
  shnum: number;          // セクションヘッダ数
}

/** プログラムヘッダ (セグメント) */
export type SegmentType = "PT_NULL" | "PT_LOAD" | "PT_DYNAMIC" | "PT_INTERP" | "PT_NOTE" | "PT_PHDR" | "PT_TLS" | "PT_GNU_STACK" | "PT_GNU_RELRO";

export interface ProgramHeader {
  type: SegmentType;
  offset: number;         // ファイルオフセット
  vaddr: number;          // 仮想アドレス
  paddr: number;          // 物理アドレス
  filesz: number;         // ファイル内サイズ
  memsz: number;          // メモリ内サイズ
  flags: string;          // "R", "RW", "RX", "RWX"
  align: number;
}

/** セクション */
export type SectionType = ".text" | ".data" | ".bss" | ".rodata" | ".got" | ".got.plt" | ".plt" | ".dynsym" | ".dynstr" | ".rela.plt" | ".rela.dyn" | ".interp" | ".dynamic" | ".init" | ".fini" | ".init_array" | ".fini_array" | ".note" | ".eh_frame" | ".comment" | ".symtab" | ".strtab" | ".shstrtab";

export interface Section {
  name: SectionType | string;
  vaddr: number;
  size: number;
  flags: string;
  description: string;
}

/** 動的ライブラリ */
export interface SharedLib {
  name: string;           // "libc.so.6"
  path: string;           // "/lib/x86_64-linux-gnu/libc.so.6"
  baseAddr: number;       // ロードアドレス
  symbols: string[];      // エクスポートシンボル
}

/** リロケーション */
export interface Relocation {
  offset: number;
  symbol: string;
  type: string;           // "R_X86_64_JUMP_SLOT" など
  addend: number;
  resolved: boolean;
  resolvedAddr?: number;
}

/** メモリマッピング */
export interface MemoryMapping {
  start: number;
  end: number;
  flags: string;          // "r-xp", "rw-p" など
  source: string;         // ファイル名 or "[stack]", "[heap]" など
  description: string;
}

/** プロセスイメージ */
export interface ProcessImage {
  pid: number;
  argv: string[];
  envp: string[];
  mappings: MemoryMapping[];
  stackPointer: number;
  entryPoint: number;
  brkAddr: number;        // ヒープ開始
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "shell_parse"; command: string }
  | { type: "fork" }
  | { type: "execve"; path: string; argv: string[]; envp: string[] }
  | { type: "open_file"; path: string }
  | { type: "read_magic"; magic: string; format: ExecFormat }
  | { type: "parse_elf_header"; header: ElfHeader }
  | { type: "parse_program_headers"; headers: ProgramHeader[] }
  | { type: "parse_sections"; sections: Section[] }
  | { type: "check_interp"; interpreter: string }
  | { type: "load_interp"; path: string; baseAddr: number }
  | { type: "mmap_segment"; segment: ProgramHeader; source: string }
  | { type: "setup_bss"; vaddr: number; size: number }
  | { type: "load_shared_lib"; lib: SharedLib }
  | { type: "resolve_symbols"; relocations: Relocation[] }
  | { type: "setup_stack"; argv: string[]; envp: string[]; auxv: AuxvEntry[] }
  | { type: "setup_process_image"; image: ProcessImage }
  | { type: "call_init"; funcs: string[] }
  | { type: "jump_to_entry"; addr: number }
  | { type: "call_main"; argc: number; argv_addr: number; envp_addr: number }
  | { type: "script_exec"; interpreter: string; script: string };

/** 補助ベクトルエントリ */
export interface AuxvEntry {
  type: string;
  value: number | string;
  description: string;
}

/** イベント種別 */
export type EventType =
  | "shell_parse"
  | "fork"
  | "execve"
  | "open_file"
  | "read_magic"
  | "elf_header"
  | "program_header"
  | "section_parse"
  | "interp_check"
  | "interp_load"
  | "mmap"
  | "bss_zero"
  | "lib_load"
  | "symbol_resolve"
  | "relocation"
  | "stack_setup"
  | "auxv_setup"
  | "process_image"
  | "init_call"
  | "entry_jump"
  | "main_call"
  | "script_detect"
  | "permission_check"
  | "error";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  elfHeader?: ElfHeader;
  programHeaders: ProgramHeader[];
  sections: Section[];
  sharedLibs: SharedLib[];
  relocations: Relocation[];
  memoryMap: MemoryMapping[];
  processImage?: ProcessImage;
  stats: {
    totalSteps: number;
    segmentsLoaded: number;
    libsLoaded: number;
    symbolsResolved: number;
    mmapCalls: number;
    totalMapped: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
