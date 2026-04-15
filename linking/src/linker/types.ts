/**
 * types.ts — リンカーシミュレータの型定義
 *
 * リンカーが扱う主要なデータ構造を定義する。
 * 実際のELFフォーマットを簡略化したモデルであり、
 * シンボル（関数・変数）、リロケーション（未解決参照）、
 * セクション（.text, .data など）、オブジェクトファイル（.o）、
 * 共有ライブラリ（.so/.dll）を表現する。
 */

/**
 * シンボルの種類
 *
 * ELFのシンボルテーブル (.symtab) では STT_FUNC / STT_OBJECT に対応する。
 * - "function": 実行可能コード（.text セクションに配置）
 * - "variable": データ（.data セクションに配置）
 */
export type SymbolKind = "function" | "variable";

/**
 * シンボルのバインディング（公開範囲・可視性）
 *
 * ELFでは STB_GLOBAL / STB_LOCAL に対応する。
 * - "global": 他のオブジェクトファイルから参照可能。リンカーがシンボル解決の対象とする
 * - "local":  定義元ファイル内でのみ有効。他ファイルからは見えない（static 修飾に相当）
 *
 * 補足: ELFには弱シンボル（STB_WEAK）も存在するが、本シミュレータでは省略している。
 * 弱シンボルは、同名のグローバルシンボルがあればそちらを優先し、
 * なければ弱シンボルの定義を使う仕組みである。
 */
export type SymbolBinding = "global" | "local";

/**
 * シンボル定義
 *
 * コンパイラが生成するオブジェクトファイル内のシンボルテーブルエントリに相当する。
 * 関数や変数の名前・種別・位置・サイズを保持する。
 * リンカーはこの情報をもとにシンボル解決（name resolution）を行い、
 * 各シンボルに最終的な仮想アドレスを割り当てる。
 */
export interface SymbolDef {
  /** シンボル名（関数名や変数名。例: "main", "printf"） */
  name: string;
  /** シンボルの種類（関数 or 変数） */
  kind: SymbolKind;
  /** バインディング（グローバル or ローカル） */
  binding: SymbolBinding;
  /**
   * シンボルが定義されているセクション名
   * - 関数なら ".text"（コードセクション）
   * - 変数なら ".data"（初期化済みデータセクション）
   * 補足: 未初期化変数は実際には .bss セクションに配置されるが、本シミュレータでは省略
   */
  section: string;
  /** セクション先頭からのオフセット（バイト単位） */
  offset: number;
  /** シンボルが占めるサイズ（バイト単位） */
  size: number;
}

/**
 * リロケーション（未解決の参照）
 *
 * コンパイラがオブジェクトファイルを生成する際、外部シンボルのアドレスは
 * まだ不明であるため、プレースホルダ（仮の値）を埋め込み、
 * リロケーションエントリとして「ここを後で書き換えてほしい」と記録する。
 * リンカーはシンボル解決後、この情報を使ってアドレスをパッチする。
 *
 * ELFの .rel.text / .rela.text セクションに対応する。
 */
export interface Relocation {
  /** 参照先のシンボル名（例: "printf", "add"） */
  symbol: string;
  /** リロケーションが存在するセクション（通常は ".text"） */
  section: string;
  /** セクション先頭からのオフセット（パッチ対象の位置） */
  offset: number;
  /**
   * リロケーション種別
   * - "absolute": 絶対アドレスに書き換える（R_X86_64_64 相当）
   *   → データ参照やジャンプテーブルなどで使用
   * - "relative": 相対アドレス（PC相対）に書き換える（R_X86_64_PC32 相当）
   *   → call 命令や近距離ジャンプで使用。命令位置からの相対差分を計算
   */
  type: "absolute" | "relative";
}

/**
 * セクション
 *
 * ELFファイル内のセクションを表す。主なセクション:
 * - .text:   機械語命令（実行可能コード）
 * - .data:   初期化済みグローバル/静的変数
 * - .bss:    未初期化グローバル/静的変数（ファイル上はサイズ0）
 * - .rodata: 読み取り専用データ（文字列リテラルなど）
 *
 * 本シミュレータでは .text と .data のみをモデル化している。
 */
export interface Section {
  /** セクション名（".text", ".data" など） */
  name: string;
  /** セクションの内容（アセンブリ命令やデータの文字列表現） */
  data: string[];
  /** セクションの合計サイズ（バイト単位） */
  size: number;
}

/**
 * オブジェクトファイル (.o)
 *
 * コンパイラが1つのソースファイル（翻訳単位）から生成する中間成果物。
 * まだリンクされておらず、外部参照が未解決のままリロケーションとして記録されている。
 *
 * 実際のELFオブジェクトファイルの構造:
 *   ELFヘッダ → セクションヘッダテーブル → 各セクション(.text, .data, .symtab, .rel.text, ...)
 *
 * リンカーは複数のオブジェクトファイルを入力として受け取り、
 * シンボル解決とリロケーション適用を経て実行可能ファイルを出力する。
 */
export interface ObjectFile {
  /** ファイル名（例: "main.o", "math.o"） */
  name: string;
  /** このファイルに含まれるセクションの一覧 */
  sections: Section[];
  /** このファイルが定義するシンボルの一覧（.symtab に相当） */
  symbols: SymbolDef[];
  /** 未解決の外部参照一覧（.rel.text / .rela.text に相当） */
  relocations: Relocation[];
}

/**
 * 共有ライブラリ (.so / .dll)
 *
 * 動的リンクで使用されるライブラリ。
 * 静的リンクとは異なり、ライブラリのコード自体はバイナリに埋め込まれず、
 * 実行時に動的リンカー（ld.so）がメモリ上にロードする。
 *
 * 共有ライブラリの利点:
 * - 複数プロセスがメモリ上で同じライブラリを共有できる（メモリ節約）
 * - ライブラリ更新時にアプリケーションのリコンパイルが不要
 * - PIC（位置独立コード）で生成され、任意のアドレスにロード可能
 */
export interface SharedLibrary {
  /** ライブラリ名（例: "libc.so", "libmath.so"） */
  name: string;
  /** 外部に公開（エクスポート）されるシンボルの一覧。シンボル可視性が "default" のもの */
  exportedSymbols: SymbolDef[];
  /** ライブラリ内のセクション */
  sections: Section[];
}

/**
 * リンク結果の1ステップ
 *
 * リンク処理の各フェーズを可視化するための情報を保持する。
 * UIでステップごとにカード表示し、リンカーの動作を段階的に理解できるようにする。
 */
export interface LinkStep {
  /** フェーズ名（例: "シンボル収集", "リロケーション", "セクション結合"） */
  phase: string;
  /** フェーズの概要説明 */
  description: string;
  /** フェーズの詳細情報（複数行テキスト） */
  detail: string;
}

/**
 * 静的リンク結果
 *
 * 静的リンカー（ld -static）の処理結果を表す。
 * 静的リンクでは、すべてのオブジェクトファイルと静的ライブラリ（.a アーカイブ）の
 * コードを1つの実行可能バイナリに結合する。
 *
 * 処理の流れ:
 * 1. 入力ファイルの列挙
 * 2. グローバルシンボルの収集と重複チェック
 * 3. リロケーションの解決（未定義参照の検出）
 * 4. 同名セクションの結合（.text同士、.data同士）
 * 5. 最終バイナリの生成
 */
export interface StaticLinkResult {
  /** リンクが成功したかどうか */
  success: boolean;
  /** 各フェーズの処理ログ（UI表示用） */
  steps: LinkStep[];
  /** 結合されたセクション（全オブジェクトの同名セクションをマージ） */
  mergedSections: Section[];
  /**
   * 解決済みシンボルテーブル
   * キー: シンボル名
   * 値: 最終仮想アドレスと定義元ファイル名
   */
  symbolTable: Map<string, { address: number; source: string }>;
  /** エラーメッセージ一覧（多重定義・未定義参照など） */
  errors: string[];
}

/**
 * 動的リンク結果
 *
 * 動的リンカーの処理結果を表す。
 * 動的リンクでは、共有ライブラリのコードはバイナリに埋め込まず、
 * GOT (Global Offset Table) と PLT (Procedure Linkage Table) を構築して
 * 実行時に動的リンカー（ld.so）がシンボルを解決する。
 *
 * GOT/PLTによる遅延バインディング（Lazy Binding）の仕組み:
 * 1. コードが外部関数を呼ぶ → PLT エントリにジャンプ
 * 2. PLT エントリが GOT のアドレスを間接参照
 * 3. 初回呼び出し時: GOT にはまだ実アドレスがないため ld.so に制御が渡る
 * 4. ld.so がシンボルを解決し、GOT エントリに実アドレスを書き込む
 * 5. 2回目以降: GOT から直接実アドレスにジャンプ（ld.so を経由しない）
 */
export interface DynamicLinkResult {
  /** リンクが成功したかどうか */
  success: boolean;
  /** 各フェーズの処理ログ（UI表示用） */
  steps: LinkStep[];
  /**
   * GOT (Global Offset Table)
   * 外部シンボルの実行時アドレスを格納するテーブル。
   * 動的リンカーが実行時にアドレスを書き込む。
   * キー: シンボル名
   * 値: GOTインデックスと解決済みアドレス（未解決の場合は null）
   */
  got: Map<string, { index: number; resolvedAddress: number | null }>;
  /**
   * PLT (Procedure Linkage Table)
   * 外部関数呼び出しのトランポリン（中継地点）。
   * 各 PLT エントリは対応する GOT エントリを間接参照する。
   * キー: シンボル名
   * 値: PLTインデックスと対応する GOT エントリの番号
   */
  plt: Map<string, { index: number; gotEntry: number }>;
  /** 実行時に必要な共有ライブラリの一覧（DT_NEEDED に相当） */
  neededLibraries: string[];
  /** エラーメッセージ一覧（未定義シンボルなど） */
  errors: string[];
}
