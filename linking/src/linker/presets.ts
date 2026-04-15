/**
 * presets.ts — 実験プリセット定義
 *
 * リンカーシミュレータのブラウザUIで選択できる実験プリセットを定義する。
 * 各プリセットは、リンクの概念を理解するための具体的なシナリオを提供する:
 *
 * 1. 基本的な静的リンク     — 2つの .o ファイルのシンボル解決とセクション結合
 * 2. 基本的な動的リンク     — .so ライブラリと GOT/PLT の構築
 * 3. 静的 vs 動的 比較      — 同じコードの両方式による違いを比較
 * 4. 多重定義エラー         — 同名グローバルシンボルの衝突
 * 5. 未定義シンボルエラー   — 参照先が存在しない場合のリンクエラー
 * 6. 複数ライブラリの動的リンク — 複数の .so から関数を呼び出す
 * 7. グローバル変数         — .text と .data セクションの両方を結合
 * 8. 動的リンクの未定義シンボル — .so にシンボルが見つからない場合
 */

import type { ObjectFile, SharedLibrary } from "./types.js";
import { ObjectFileBuilder, buildSharedLibrary } from "./object-file.js";

/**
 * プリセットの型定義
 *
 * UIのセレクトボックスで選択可能な実験シナリオを表す。
 */
export interface Preset {
  /** プリセット名（セレクトボックスに表示） */
  name: string;
  /** プリセットの説明文（UIの下部に表示） */
  description: string;
  /** リンクモード: "static"（静的のみ）, "dynamic"（動的のみ）, "both"（両方比較） */
  mode: "static" | "dynamic" | "both";
  /** リンク対象のオブジェクトファイル一覧 */
  objects: ObjectFile[];
  /** 動的リンクで参照する共有ライブラリ一覧 */
  libraries: SharedLibrary[];
}

/**
 * 全プリセット一覧
 *
 * リンカーの基本動作からエラーケースまで、段階的に学習できるよう配置している。
 */
export const PRESETS: Preset[] = [
  // ── 1. 基本的な静的リンク ──
  // main.o が math.o の関数を呼び出す最もシンプルなケース。
  // コンパイラは main.o 内の "call add" をリロケーションとして記録し、
  // リンカーが math.o 内の add シンボルのアドレスで解決する。
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
  // main.o が共有ライブラリ libmath.so の関数を呼び出すケース。
  // 静的リンクと異なり、ライブラリのコードはバイナリに埋め込まれず、
  // GOT/PLT を通じた間接参照で実行時に解決される。
  // call add@PLT のように PLT 経由で呼び出す。
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
  // 同一プログラムを静的・動的の両方式でリンクし、処理の違いを可視化する。
  // 静的リンクでは libc の printf/puts が丸ごとバイナリに取り込まれるが、
  // 動的リンクでは GOT/PLT エントリだけが作成される。
  // mode: "both" を指定するとUIで並べて比較できる。
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
  // 同じ名前のグローバルシンボル "helper" が main.o と utils.o の両方で定義されている。
  // C言語の「一つ定義規則（One Definition Rule）」に違反しており、
  // リンカーは "multiple definition of 'helper'" エラーを出す。
  // 解決策: 片方を static にする、名前空間を分ける、弱シンボル (weak) にする等
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
  // main.o が "missing_function" を呼び出しているが、このシンボルは
  // どのオブジェクトファイルにも定義されていない。
  // リンカーは "undefined reference to 'missing_function'" エラーを出す。
  // よくある原因: ライブラリのリンク忘れ、関数名のタイプミス、宣言だけで定義がない等
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
  // app.o が libdb.so（データベース）と liblog.so（ロギング）の
  // 2つの共有ライブラリから関数を呼び出すケース。
  // 各外部関数に対して個別の GOT/PLT エントリが生成される。
  // 実際のアプリケーションでも、libc.so, libpthread.so, libssl.so 等
  // 複数のライブラリに同時に依存することが一般的。
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
  // コード (.text) とデータ (.data) の両方のセクションが結合される例。
  // main.o の .text + config.o の .text → 結合 .text セクション
  // main.o の .data + config.o の .data → 結合 .data セクション
  // データ参照には絶対アドレスリロケーション (R_X86_64_64) が使われる。
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
  // main.o が "encrypt"（libcrypto.so に存在）と "nonexistent_func"（どこにもない）
  // を呼び出すケース。encrypt は正常に GOT/PLT が構築されるが、
  // nonexistent_func は未定義参照エラーとなる。
  // 実際の動的リンクでも、-lxxx で指定したライブラリに
  // シンボルがなければリンクエラーになる。
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
