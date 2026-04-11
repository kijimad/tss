/**
 * presets.ts — 実験プリセット定義
 */

import type { ObjectFile, SharedLibrary } from "./types.js";
import { ObjectFileBuilder, buildSharedLibrary } from "./object-file.js";

/** プリセットの型 */
export interface Preset {
  name: string;
  description: string;
  mode: "static" | "dynamic" | "both";
  objects: ObjectFile[];
  libraries: SharedLibrary[];
}

/** 全プリセット */
export const PRESETS: Preset[] = [
  // ── 1. 基本的な静的リンク ──
  {
    name: "基本: 2つの .o を静的リンク",
    description:
      "main.o が math.o の add 関数を呼び出す。静的リンカーがシンボルを解決し、1つのバイナリに結合する。",
    mode: "static",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "mov edi, 3",
          "mov esi, 5",
          "call add",
          "pop rbp",
          "ret",
        ])
        .addRelocation("add")
        .build(),
      new ObjectFileBuilder("math.o")
        .addFunction("add", [
          "push rbp",
          "mov rbp, rsp",
          "add edi, esi",
          "mov eax, edi",
          "pop rbp",
          "ret",
        ])
        .addFunction("sub", [
          "push rbp",
          "mov rbp, rsp",
          "sub edi, esi",
          "mov eax, edi",
          "pop rbp",
          "ret",
        ])
        .build(),
    ],
    libraries: [],
  },

  // ── 2. 基本的な動的リンク ──
  {
    name: "基本: .so を動的リンク (GOT/PLT)",
    description:
      "main.o が libmath.so の add/sub を呼ぶ。GOT/PLT が構築され、遅延バインディングで実行時に解決される。",
    mode: "dynamic",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "mov edi, 10",
          "mov esi, 3",
          "call add@PLT",
          "mov edi, eax",
          "mov esi, 2",
          "call sub@PLT",
          "pop rbp",
          "ret",
        ])
        .addRelocation("add")
        .addRelocation("sub")
        .build(),
    ],
    libraries: [
      buildSharedLibrary("libmath.so", [
        {
          name: "add",
          body: ["push rbp", "add edi, esi", "mov eax, edi", "pop rbp", "ret"],
        },
        {
          name: "sub",
          body: ["push rbp", "sub edi, esi", "mov eax, edi", "pop rbp", "ret"],
        },
      ]),
    ],
  },

  // ── 3. 静的 vs 動的 比較 ──
  {
    name: "比較: 同じコードの静的 vs 動的リンク",
    description:
      "同じプログラムを静的・動的両方でリンクし、プロセスの違いを比較する。",
    mode: "both",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "call printf",
          'mov rdi, "Hello"',
          "call puts",
          "xor eax, eax",
          "pop rbp",
          "ret",
        ])
        .addRelocation("printf")
        .addRelocation("puts")
        .addVariable("msg", '"Hello, World!"')
        .build(),
    ],
    libraries: [
      buildSharedLibrary(
        "libc.so",
        [
          {
            name: "printf",
            body: ["push rbp", "mov rbp, rsp", "...", "pop rbp", "ret"],
          },
          {
            name: "puts",
            body: ["push rbp", "mov rbp, rsp", "...", "pop rbp", "ret"],
          },
          {
            name: "malloc",
            body: ["push rbp", "mov rbp, rsp", "...", "pop rbp", "ret"],
          },
          {
            name: "free",
            body: ["push rbp", "mov rbp, rsp", "...", "pop rbp", "ret"],
          },
        ],
        [{ name: "stdin", value: "FILE*" }, { name: "stdout", value: "FILE*" }],
      ),
    ],
  },

  // ── 4. 多重定義エラー ──
  {
    name: "エラー: シンボルの多重定義",
    description:
      "同じ名前のグローバルシンボルが複数の .o に存在する場合、リンカーはエラーを出す。",
    mode: "static",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "call helper",
          "pop rbp",
          "ret",
        ])
        .addFunction("helper", [
          "push rbp",
          "mov rbp, rsp",
          "mov eax, 1",
          "pop rbp",
          "ret",
        ])
        .addRelocation("helper")
        .build(),
      new ObjectFileBuilder("utils.o")
        .addFunction("helper", [
          "push rbp",
          "mov rbp, rsp",
          "mov eax, 2",
          "pop rbp",
          "ret",
        ])
        .build(),
    ],
    libraries: [],
  },

  // ── 5. 未定義シンボルエラー ──
  {
    name: "エラー: 未定義シンボル参照",
    description:
      "参照先のシンボルがどこにも定義されていない場合のリンクエラー。",
    mode: "static",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "call missing_function",
          "pop rbp",
          "ret",
        ])
        .addRelocation("missing_function")
        .build(),
    ],
    libraries: [],
  },

  // ── 6. 複数ライブラリの動的リンク ──
  {
    name: "複数 .so からの動的リンク",
    description:
      "複数の共有ライブラリから関数を呼び出し、それぞれに GOT/PLT エントリが生成される。",
    mode: "dynamic",
    objects: [
      new ObjectFileBuilder("app.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "call connect",
          "call query",
          "call log_info",
          "call log_error",
          "pop rbp",
          "ret",
        ])
        .addRelocation("connect")
        .addRelocation("query")
        .addRelocation("log_info")
        .addRelocation("log_error")
        .build(),
    ],
    libraries: [
      buildSharedLibrary("libdb.so", [
        {
          name: "connect",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
        {
          name: "query",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
        {
          name: "disconnect",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
      ]),
      buildSharedLibrary("liblog.so", [
        {
          name: "log_info",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
        {
          name: "log_error",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
      ]),
    ],
  },

  // ── 7. グローバル変数を含む静的リンク ──
  {
    name: "グローバル変数とデータセクション",
    description:
      ".text (コード) と .data (データ) の両セクションが結合される様子を観察する。",
    mode: "static",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "mov rdi, [config_path]",
          "call load_config",
          "pop rbp",
          "ret",
        ])
        .addVariable("config_path", '"/etc/app.conf"')
        .addRelocation("load_config")
        .addRelocation("config_path", ".text", "absolute")
        .build(),
      new ObjectFileBuilder("config.o")
        .addFunction("load_config", [
          "push rbp",
          "mov rbp, rsp",
          "mov rax, [default_timeout]",
          "pop rbp",
          "ret",
        ])
        .addVariable("default_timeout", "30")
        .addVariable("max_retries", "3")
        .build(),
    ],
    libraries: [],
  },

  // ── 8. 動的リンクで未定義シンボル ──
  {
    name: "エラー: .so にシンボルが見つからない",
    description:
      "動的リンク時に、どの共有ライブラリにも見つからないシンボルがある場合。",
    mode: "dynamic",
    objects: [
      new ObjectFileBuilder("main.o")
        .addFunction("main", [
          "push rbp",
          "mov rbp, rsp",
          "call encrypt",
          "call nonexistent_func",
          "pop rbp",
          "ret",
        ])
        .addRelocation("encrypt")
        .addRelocation("nonexistent_func")
        .build(),
    ],
    libraries: [
      buildSharedLibrary("libcrypto.so", [
        {
          name: "encrypt",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
        {
          name: "decrypt",
          body: ["push rbp", "...", "pop rbp", "ret"],
        },
      ]),
    ],
  },
];
