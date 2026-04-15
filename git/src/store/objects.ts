/**
 * objects.ts -- Git オブジェクトストア（内容アドレッシング方式のデータベース）
 *
 * ====================================================================
 * Git のオブジェクトモデル概要
 * ====================================================================
 *
 * Git は分散バージョン管理システム（DVCS）であり、
 * 全てのデータを「オブジェクト」として格納する。
 * オブジェクトには以下の3種類がある（本シミュレータではタグオブジェクトは省略）:
 *
 *   blob   -- ファイルの中身そのもの。ファイル名やパスの情報は持たない。
 *             同一内容のファイルは同じ blob として1つだけ保存される（重複排除）。
 *
 *   tree   -- ディレクトリの構造を表す。エントリのリスト（名前 → blob/tree のマッピング）。
 *             ファイルシステムのディレクトリに相当し、ネストして階層構造を形成する。
 *
 *   commit -- ある時点のプロジェクト全体のスナップショット。
 *             ルート tree（プロジェクト全体の構造）、親コミット（履歴の連結リスト）、
 *             著者情報、タイムスタンプ、コミットメッセージを持つ。
 *             親コミットへのポインタにより DAG（有向非巡回グラフ）を形成する。
 *
 * ====================================================================
 * 内容アドレッシング（Content-Addressable Storage）
 * ====================================================================
 *
 * 各オブジェクトは「型 + 内容」を SHA-1 ハッシュした値をキーとして格納される。
 * これにより以下の特性が得られる:
 *   - 同じ内容は必ず同じハッシュになる（冪等性）
 *   - ハッシュが一致すれば内容も一致する（改竄検出）
 *   - 重複データを自然に排除できる（ストレージ効率）
 *
 * 実際の Git では SHA-1（40桁の16進数）を使用するが、
 * このシミュレータでは簡易ハッシュ関数で代用している。
 *
 * ====================================================================
 * オブジェクトの関連図
 * ====================================================================
 *
 *   commit abc123
 *     ├── tree: def456          ← ルートディレクトリの tree
 *     │     ├── blob: 111  "README.md"     ← 個々のファイル
 *     │     ├── blob: 222  "index.js"
 *     │     └── tree: 333  "src/"           ← サブディレクトリ（再帰的構造）
 *     │           └── blob: 444  "main.js"
 *     ├── parent: (前のコミット) ← DAG の辺。マージコミットは複数の親を持つ
 *     ├── author: "Alice <alice@example.com>"
 *     └── message: "Initial commit"
 *
 * 補足: 実際の Git には packfile（複数オブジェクトを圧縮パック化する仕組み）があり、
 *       差分圧縮でストレージを節約する。本シミュレータでは省略している。
 */

/**
 * Git オブジェクトの型定義（判別共用体: discriminated union）
 *
 * - blob:   ファイル内容を保持。ファイル名は tree エントリ側が管理する。
 * - tree:   ディレクトリ構造。各エントリはモード・名前・子オブジェクトのハッシュを持つ。
 * - commit: スナップショット。tree（ルートディレクトリ）、parents（親コミット群）、
 *           author（著者）、date（タイムスタンプ）、message（コミットメッセージ）で構成。
 *           parents が複数ある場合はマージコミットを表す。
 */
export type GitObject =
  | { type: "blob"; content: string }
  | { type: "tree"; entries: TreeEntry[] }
  | { type: "commit"; tree: string; parents: string[]; author: string; date: number; message: string };

/**
 * tree エントリ: tree オブジェクト内の1つのファイル/ディレクトリを表す。
 *
 * 実際の Git では mode は以下のような値を取る:
 *   100644 -- 通常のファイル
 *   100755 -- 実行可能ファイル
 *   120000 -- シンボリックリンク
 *   040000 -- サブディレクトリ（tree オブジェクトへの参照）
 *   160000 -- サブモジュール（gitlink）
 */
export interface TreeEntry {
  mode: string;    // "100644"（ファイル）または "040000"（ディレクトリ）
  name: string;    // エントリ名（ファイル名またはディレクトリ名）
  hash: string;    // 参照先オブジェクトの SHA ハッシュ（blob または tree）
}

/**
 * SHA-1 ハッシュの簡易実装
 *
 * 実際の Git では SHA-1（20バイト = 40桁の16進数）でオブジェクトを一意に識別する。
 * SHA-1 は暗号学的ハッシュ関数であり、異なる入力が同じハッシュになる確率（衝突）は
 * 極めて低い。Git 2.29以降では SHA-256 への移行も進んでいる。
 *
 * このシミュレータでは、ブラウザ環境での簡便さのため、
 * DJB2 系のハッシュ関数2つを組み合わせて14桁の16進数文字列を生成する。
 * 教育目的には十分な衝突耐性を持つ。
 *
 * @param content - ハッシュ対象の文字列
 * @returns 14桁の16進数ハッシュ文字列
 */
export function hash(content: string): string {
  // 第1ハッシュ: 順方向に走査（DJB2 変種: h * 31 + ch）
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h = ((h << 5) - h + ch) | 0;
  }
  // 符号なし整数に変換し、7桁の16進数に正規化
  const hex = (h >>> 0).toString(16).padStart(7, "0");

  // 第2ハッシュ: 逆方向に走査（異なるビットシフトで独立性を高める）
  let h2 = 0;
  for (let i = content.length - 1; i >= 0; i--) {
    const ch = content.charCodeAt(i);
    h2 = ((h2 << 7) - h2 + ch) | 0;
  }

  // 2つのハッシュを連結して14桁にする（実際の Git の40桁より短いが十分）
  return hex + (h2 >>> 0).toString(16).padStart(7, "0");
}

/**
 * Git オブジェクトをシリアライズしてハッシュを計算する。
 *
 * 実際の Git では「型 SP サイズ NUL 内容」という形式でシリアライズしてから
 * SHA-1 ハッシュを計算する。同じ内容のオブジェクトは必ず同じハッシュになるため、
 * オブジェクトの同一性判定にも使える。
 *
 * @param obj - ハッシュを計算する Git オブジェクト
 * @returns オブジェクトのハッシュ文字列
 */
export function hashObject(obj: GitObject): string {
  return hash(serializeObject(obj));
}

/**
 * Git オブジェクトを文字列にシリアライズする。
 *
 * 実際の Git のフォーマットを簡略化して再現:
 *   blob:   "blob" NUL ファイル内容
 *   tree:   "tree" NUL (モード SP 名前 NUL ハッシュ) の繰り返し
 *   commit: "commit" NUL "tree ハッシュ" LF "parent ハッシュ"... LF "author ..." LF LF メッセージ
 *
 * NUL（\0）はヘッダと本体の区切りとして使われる（バイナリ安全な区切り文字）。
 */
function serializeObject(obj: GitObject): string {
  switch (obj.type) {
    case "blob":
      return `blob\0${obj.content}`;
    case "tree":
      return `tree\0${obj.entries.map(e => `${e.mode} ${e.name}\0${e.hash}`).join("\n")}`;
    case "commit":
      return `commit\0tree ${obj.tree}\n${obj.parents.map(p => `parent ${p}`).join("\n")}${obj.parents.length > 0 ? "\n" : ""}author ${obj.author} ${String(obj.date)}\n\n${obj.message}`;
  }
}

/**
 * オブジェクトデータベース（.git/objects/ に相当）
 *
 * Git のオブジェクトストアは、ハッシュをキーとしてオブジェクトを格納する
 * キーバリューストア（KVS）である。
 *
 * 実際の Git では .git/objects/ ディレクトリ配下に、
 * ハッシュの先頭2文字をディレクトリ名、残りをファイル名として保存する。
 * 例: ハッシュが abc123... なら .git/objects/ab/c123... に格納。
 *
 * また、大量のオブジェクトは packfile にまとめて差分圧縮される（gc 時）。
 * 本シミュレータでは Map で簡易的に実装している。
 */
export class ObjectStore {
  /** ハッシュ → GitObject のマッピング（インメモリのオブジェクトストア） */
  private objects = new Map<string, GitObject>();

  /**
   * オブジェクトをストアに格納し、ハッシュを返す。
   * 同じ内容のオブジェクトは同じハッシュになるため、自動的に重複排除される。
   */
  store(obj: GitObject): string {
    const h = hashObject(obj);
    this.objects.set(h, obj);
    return h;
  }

  /**
   * ハッシュからオブジェクトを取得する。
   * 実際の Git では `git cat-file -p <hash>` に相当する操作。
   */
  get(h: string): GitObject | undefined {
    return this.objects.get(h);
  }

  /** 指定ハッシュのオブジェクトが存在するか判定する */
  has(h: string): boolean {
    return this.objects.has(h);
  }

  /**
   * 全オブジェクトをリストとして取得する。
   * UI のオブジェクトストア表示パネルで使用される。
   */
  all(): { hash: string; object: GitObject }[] {
    const result: { hash: string; object: GitObject }[] = [];
    for (const [h, obj] of this.objects) {
      result.push({ hash: h, object: obj });
    }
    return result;
  }
}
