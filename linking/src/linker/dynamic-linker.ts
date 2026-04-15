/**
 * dynamic-linker.ts — 動的リンカーのシミュレーション
 *
 * 動的リンカーの動作をエミュレートする。
 * オブジェクトファイルと共有ライブラリ (.so) を受け取り、
 * GOT (Global Offset Table) と PLT (Procedure Linkage Table) を構築して
 * 遅延バインディング（Lazy Binding）をシミュレートする。
 *
 * 動的リンクの処理フロー:
 * 1. 入力の確認     — オブジェクトファイルと共有ライブラリの一覧を把握
 * 2. ライブラリ解析 — 各 .so のエクスポートシンボルを収集し、ロードアドレスを割り当て
 * 3. GOT/PLT 構築   — 外部参照ごとに GOT/PLT エントリを作成
 * 4. 遅延バインディング — PLT → GOT → ld.so の間接参照チェーンをシミュレート
 * 5. 最終結果       — 依存ライブラリとテーブルサイズを報告
 *
 * 動的リンクの利点:
 * - メモリ効率: 複数プロセスが同じ .so を物理メモリ上で共有（mmap）
 * - 更新容易性: .so を差し替えるだけでバグ修正・機能追加が反映される
 * - バイナリサイズ: ライブラリコードを含まないため小さくなる
 *
 * 動的リンクの欠点:
 * - 起動時オーバーヘッド: ld.so によるシンボル解決に時間がかかる
 * - GOT/PLT による間接参照のオーバーヘッド（わずかだが存在）
 * - DLL地獄（ライブラリバージョンの不整合問題）のリスク
 * - セキュリティ: LD_PRELOAD による関数差し替え攻撃の可能性
 */

import type {
  ObjectFile,
  SharedLibrary,
  DynamicLinkResult,
  LinkStep,
} from "./types.js";

/**
 * GOT (Global Offset Table) のベースアドレス
 *
 * GOTは .got.plt セクションに配置され、外部シンボルの実行時アドレスを格納する。
 * 動的リンカー（ld.so）が実行時にこのテーブルを書き換えてアドレスを解決する。
 * 各エントリは8バイト（64ビットアドレス）。
 */
const GOT_BASE = 0x601000;

/**
 * PLT (Procedure Linkage Table) のベースアドレス
 *
 * PLTは .plt セクションに配置され、外部関数呼び出しのトランポリン（中継）として機能する。
 * 各エントリは16バイトで、以下の擬似命令から構成される:
 *   jmp *GOT[n]          ; GOTエントリを間接参照
 *   push n               ; リロケーションインデックスをスタックに積む
 *   jmp PLT[0]           ; 共通エントリ（ld.so の _dl_runtime_resolve）にジャンプ
 *
 * 初回呼び出し時は GOT にまだ実アドレスが書かれていないため、
 * PLT エントリの2行目以降が実行され、ld.so が呼ばれてシンボルを解決する。
 */
const PLT_BASE = 0x400800;

/**
 * 共有ライブラリのロードアドレスベース
 *
 * 実際のLinuxでは ASLR (Address Space Layout Randomization) により
 * ライブラリのロードアドレスは毎回ランダムに決まる。
 * 本シミュレータでは固定ベースアドレスを使用して動作を分かりやすくしている。
 * 各ライブラリは最低4KBアラインメントで連続配置される。
 */
const LIB_BASE = 0x7f0000;

/**
 * 動的リンクを実行する
 *
 * オブジェクトファイルの外部参照（リロケーション）を共有ライブラリのシンボルと照合し、
 * GOT/PLT テーブルを構築する。遅延バインディングの仕組みもシミュレートする。
 *
 * @param objects   - リンク対象のオブジェクトファイル一覧
 * @param libraries - 参照する共有ライブラリ一覧
 * @returns 動的リンク結果（GOT/PLT テーブル、依存ライブラリ一覧、処理ステップ）
 */
export function dynamicLink(
  objects: ObjectFile[],
  libraries: SharedLibrary[],
): DynamicLinkResult {
  const steps: LinkStep[] = [];
  const errors: string[] = [];
  /** GOT: 外部シンボルの実行時アドレスを格納するテーブル */
  const got = new Map<string, { index: number; resolvedAddress: number | null }>();
  /** PLT: 外部関数呼び出しのトランポリンテーブル */
  const plt = new Map<string, { index: number; gotEntry: number }>();
  /** 実行時に必要な共有ライブラリ（ELF の DT_NEEDED エントリに相当） */
  const neededLibraries: string[] = [];

  // ── フェーズ1: 入力の確認 ──
  // リンク対象のオブジェクトファイルと利用可能な共有ライブラリを列挙する
  steps.push({
    phase: "入力収集",
    description: `${objects.length} オブジェクト + ${libraries.length} 共有ライブラリ`,
    detail: [
      "オブジェクトファイル:",
      ...objects.map((o) => `  ${o.name} (${o.relocations.length} リロケーション)`),
      "共有ライブラリ:",
      ...libraries.map((l) => `  ${l.name} (${l.exportedSymbols.length} エクスポート)`),
    ].join("\n"),
  });

  // ── フェーズ2: 共有ライブラリのシンボル収集 ──
  // 各共有ライブラリを仮想アドレス空間にマップし、
  // エクスポートされたシンボルのアドレスを計算する。
  // 実際の ld.so は mmap(2) でライブラリをメモリにマップし、
  // .dynsym セクション（動的シンボルテーブル）からシンボル情報を読み取る。

  /** ライブラリのエクスポートシンボルとそのアドレスを格納するマップ */
  const libSymbols = new Map<string, { library: string; address: number }>();
  /** 次のライブラリのロードオフセット（累積） */
  let libOffset = 0;

  for (const lib of libraries) {
    // このライブラリを依存リストに追加（DT_NEEDED に相当）
    neededLibraries.push(lib.name);
    // ライブラリのロードアドレスを計算
    const loadAddr = LIB_BASE + libOffset;

    // ライブラリのエクスポートシンボルをアドレス付きで登録
    for (const sym of lib.exportedSymbols) {
      const addr = loadAddr + sym.offset;
      libSymbols.set(sym.name, { library: lib.name, address: addr });
    }

    // 次のライブラリの配置位置を計算（ページアラインメント: 最低4KB = 0x1000）
    // 実際のOSではページ境界にアラインされ、ライブラリ間にガードページが挿入されることもある
    const libSize = lib.sections.reduce((sum, s) => sum + s.size, 0);
    libOffset += Math.max(libSize, 0x1000); // 最低4KBアラインメント
  }

  steps.push({
    phase: "ライブラリ解析",
    description: `${libSymbols.size} 個のエクスポートシンボルを発見`,
    detail: [...libSymbols.entries()]
      .map(
        ([name, info]) =>
          `  ${name}: 0x${info.address.toString(16).padStart(6, "0")} (${info.library})`,
      )
      .join("\n"),
  });

  // ── フェーズ3: 外部参照を特定し GOT/PLT を構築 ──
  // オブジェクトファイル内で定義済みのシンボルと、リロケーション（未解決参照）を
  // 比較し、外部（共有ライブラリ側）で解決すべきシンボルを特定する。
  // 外部参照ごとに GOT エントリを、関数参照にはさらに PLT エントリを作成する。

  /** オブジェクトファイル群の中で定義されているグローバルシンボルの集合 */
  const localSymbols = new Set<string>();
  for (const obj of objects) {
    for (const sym of obj.symbols) {
      // グローバルシンボルのみ登録（ローカルは他ファイルから参照不可）
      if (sym.binding === "global") localSymbols.add(sym.name);
    }
  }

  /**
   * 外部参照の収集
   * リロケーションのうち、ローカルに定義がないものが外部参照となる。
   * これらのシンボルは共有ライブラリから解決する必要がある。
   */
  const externalRefs = new Set<string>();
  for (const obj of objects) {
    for (const reloc of obj.relocations) {
      if (!localSymbols.has(reloc.symbol)) {
        externalRefs.add(reloc.symbol);
      }
    }
  }

  /** GOT テーブルの現在のインデックス */
  let gotIndex = 0;
  /** PLT テーブルの現在のインデックス */
  let pltIndex = 0;
  /** UI表示用の GOT 詳細テキスト */
  const gotDetails: string[] = [];
  /** UI表示用の PLT 詳細テキスト */
  const pltDetails: string[] = [];

  for (const ref of externalRefs) {
    const libSym = libSymbols.get(ref);

    // GOT エントリを作成
    // 初期値は未解決（null）。遅延バインディングでは初回呼び出し時に ld.so が解決する。
    // LD_BIND_NOW=1 や -z now フラグを使うと起動時に全シンボルを即時解決する。
    const gotAddr = GOT_BASE + gotIndex * 8;
    got.set(ref, {
      index: gotIndex,
      resolvedAddress: libSym ? libSym.address : null,
    });
    gotDetails.push(
      `  GOT[${gotIndex}] (0x${gotAddr.toString(16)}): ${ref} → ${libSym ? `0x${libSym.address.toString(16).padStart(6, "0")}` : "未解決"}`,
    );

    // 関数参照の場合は PLT エントリも作成する。
    // 変数参照は GOT のみで間に合う（PLT は不要）。
    // PLT は関数呼び出しの遅延バインディングに特化した仕組み。
    const isFunction = libSym
      ? libraries.some((l) =>
          l.exportedSymbols.some(
            (s) => s.name === ref && s.kind === "function",
          ),
        )
      : true; // シンボルが見つからない場合は関数と仮定

    if (isFunction) {
      // PLT エントリのアドレス（各エントリ16バイト）
      const pltAddr = PLT_BASE + pltIndex * 16;
      plt.set(ref, { index: pltIndex, gotEntry: gotIndex });
      pltDetails.push(
        `  PLT[${pltIndex}] (0x${pltAddr.toString(16)}): ${ref} → GOT[${gotIndex}]`,
      );
      pltIndex++;
    }

    gotIndex++;

    // 共有ライブラリにシンボルが見つからない場合はエラー
    if (!libSym) {
      errors.push(
        `未定義参照: シンボル '${ref}' がどの共有ライブラリにも見つかりません`,
      );
    }
  }

  steps.push({
    phase: "GOT 構築",
    description: `${got.size} エントリの GOT (Global Offset Table) を構築`,
    detail:
      gotDetails.length > 0
        ? [
            `  ベースアドレス: 0x${GOT_BASE.toString(16)}`,
            `  エントリサイズ: 8 バイト`,
            "",
            ...gotDetails,
          ].join("\n")
        : "  外部参照なし",
  });

  steps.push({
    phase: "PLT 構築",
    description: `${plt.size} エントリの PLT (Procedure Linkage Table) を構築`,
    detail:
      pltDetails.length > 0
        ? [
            `  ベースアドレス: 0x${PLT_BASE.toString(16)}`,
            `  エントリサイズ: 16 バイト`,
            "",
            ...pltDetails,
            "",
            "  PLT の仕組み:",
            "    1. 関数呼び出し → PLT エントリにジャンプ",
            "    2. PLT → GOT から実アドレスを間接参照",
            "    3. 初回は動的リンカー (ld.so) に制御が渡る",
            "    4. ld.so がシンボルを解決し GOT を更新",
            "    5. 2回目以降は GOT から直接ジャンプ（遅延バインディング）",
          ].join("\n")
        : "  関数の外部参照なし",
  });

  if (errors.length > 0) {
    return { success: false, steps, got, plt, neededLibraries, errors };
  }

  // ── フェーズ4: 遅延バインディングのシミュレーション ──
  // PLT/GOT を使った遅延バインディングの動作を具体的にシミュレートする。
  //
  // 遅延バインディング（Lazy Binding）の詳細:
  //   初回の関数呼び出し:
  //     call func@PLT
  //     → PLT[n]: jmp *GOT[n]          ; GOT にはまだ PLT+6 のアドレスが入っている
  //     → PLT[n]+6: push n             ; リロケーションインデックス
  //     → PLT[0]: jmp _dl_runtime_resolve
  //     → ld.so がシンボル "func" を検索し、GOT[n] に実アドレスを書き込む
  //
  //   2回目以降:
  //     call func@PLT
  //     → PLT[n]: jmp *GOT[n]          ; GOT には解決済みアドレスが入っている
  //     → 直接 func の本体にジャンプ（ld.so を経由しない）

  const lazyDetails: string[] = [];
  for (const [name, pltEntry] of plt) {
    const gotEntry = got.get(name)!;
    const gotAddr = GOT_BASE + pltEntry.gotEntry * 8;
    lazyDetails.push(
      `  call ${name}:`,
      `    → JMP *0x${gotAddr.toString(16)}         ; PLT[${pltEntry.index}] → GOT[${pltEntry.gotEntry}]`,
      `    初回: GOT[${pltEntry.gotEntry}] = PLT+6 → _dl_runtime_resolve`,
      `    解決後: GOT[${pltEntry.gotEntry}] = 0x${(gotEntry.resolvedAddress ?? 0).toString(16).padStart(6, "0")}`,
      "",
    );
  }

  steps.push({
    phase: "遅延バインディング",
    description: "PLT/GOT による遅延バインディングの流れ",
    detail:
      lazyDetails.length > 0
        ? lazyDetails.join("\n")
        : "  外部関数呼び出しなし",
  });

  // ── フェーズ5: 最終結果 ──
  // 動的リンクの完了を報告し、静的リンクとの違いを整理する
  steps.push({
    phase: "リンク完了",
    description: `動的リンク成功 — ${neededLibraries.length} 共有ライブラリに依存`,
    detail: [
      `  必要なライブラリ: ${neededLibraries.join(", ")}`,
      `  GOT エントリ数: ${got.size}`,
      `  PLT エントリ数: ${plt.size}`,
      "",
      "  静的リンクとの違い:",
      "    ・ライブラリコードはバイナリに含まれない",
      "    ・実行時に ld.so がライブラリをロード",
      "    ・GOT/PLT を通じてシンボルを間接参照",
      "    ・ライブラリ更新時にリコンパイル不要",
      "    ・メモリ上でライブラリを複数プロセスで共有可能",
    ].join("\n"),
  });

  return { success: true, steps, got, plt, neededLibraries, errors };
}
