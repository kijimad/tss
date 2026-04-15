/**
 * refs.ts -- 参照ストア（ブランチ、タグ、HEAD の管理）
 *
 * ====================================================================
 * Git の参照（refs）システム
 * ====================================================================
 *
 * Git の参照は、コミットハッシュ（40桁の16進数）に人間が読める名前を付ける仕組み。
 * 実際の Git では .git/refs/ ディレクトリ配下にテキストファイルとして保存される。
 *
 * 参照の種類:
 *   refs/heads/<name>  → ブランチ。コミットハッシュを直接指す。
 *   refs/tags/<name>   → 軽量タグ。コミットハッシュを直接指す。
 *                        （注釈付きタグは tag オブジェクトを経由するが本シミュレータでは省略）
 *   refs/remotes/<remote>/<name> → リモート追跡ブランチ（本シミュレータでは未実装）
 *
 * HEAD（.git/HEAD に相当）:
 *   通常は「シンボリック参照」で、現在チェックアウトしているブランチを指す。
 *     例: ref: refs/heads/main
 *   特定のコミットを直接チェックアウトすると「detached HEAD」状態になり、
 *   ブランチ名ではなくコミットハッシュを直接指す。
 *     例: abc123def456...
 *
 * ====================================================================
 * ブランチの本質
 * ====================================================================
 *
 * ブランチ = 「最新コミットを指す可動ポインタ」。
 * コミットするたびにポインタが自動的に新しいコミットに進む。
 * ブランチの作成・削除はポインタの追加・削除に過ぎず、
 * コミット履歴（DAG）自体は変更されない。
 *
 * 図示:
 *   main ──→ C3 ──→ C2 ──→ C1  （各コミットは親を指す）
 *            HEAD
 *
 *   コミット後:
 *   main ──→ C4 ──→ C3 ──→ C2 ──→ C1
 *            HEAD
 *
 * 補足: reflog（参照ログ）は HEAD やブランチの移動履歴を記録する仕組みで、
 *       誤操作からの復旧に役立つ。本シミュレータでは省略している。
 */

/**
 * 参照ストアクラス（.git/refs/ と .git/HEAD に相当）
 *
 * 全ての参照（ブランチ、タグ）とHEADの状態を管理する。
 * 実際の Git では各参照はテキストファイルだが、ここでは Map で表現する。
 */
export class RefStore {
  /**
   * 参照テーブル: 参照パス → コミットハッシュ
   * 例: "refs/heads/main" → "abc1234def5678"
   *     "refs/tags/v1.0"  → "abc1234def5678"
   */
  private refs = new Map<string, string>();

  /**
   * HEAD の参照先。
   * - 通常モード: ブランチへのシンボリック参照（例: "refs/heads/main"）
   * - detached モード: コミットハッシュを直接保持
   */
  private headRef = "refs/heads/main";

  /**
   * detached HEAD 状態かどうかのフラグ。
   * true の場合、headRef にはコミットハッシュが直接格納されている。
   * detached HEAD では新しいコミットがどのブランチにも属さないため、
   * ブランチを作成しないと到達不能（ガベージコレクション対象）になる。
   */
  private headDetached = false;

  /**
   * HEAD が指すコミットハッシュを取得する。
   * detached の場合は直接ハッシュを返し、
   * 通常の場合はシンボリック参照を解決してブランチの先端コミットを返す。
   */
  getHead(): string | undefined {
    if (this.headDetached) {
      return this.headRef;
    }
    return this.refs.get(this.headRef);
  }

  /**
   * HEAD が指しているブランチ名を取得する。
   * detached HEAD 状態の場合は undefined を返す。
   * `git branch` コマンドで現在のブランチを「*」で表示するために使用。
   */
  getHeadBranch(): string | undefined {
    if (this.headDetached) return undefined;
    return this.headRef.replace("refs/heads/", "");
  }

  /**
   * HEAD を新しいコミットに更新する（コミット時に呼ばれる）。
   *
   * 通常モード: 現在のブランチのポインタを新しいコミットに進める。
   *             これが「ブランチが成長する」仕組みの本質。
   * detached モード: HEAD のハッシュを直接更新する。
   */
  updateHead(commitHash: string): void {
    if (this.headDetached) {
      this.headRef = commitHash;
    } else {
      this.refs.set(this.headRef, commitHash);
    }
  }

  /**
   * 新しいブランチを作成する。
   * ブランチの作成は、指定コミットを指す新しい参照を追加するだけ。
   * コミット履歴（DAG）は一切変更されない。
   */
  createBranch(name: string, commitHash: string): void {
    this.refs.set(`refs/heads/${name}`, commitHash);
  }

  /**
   * ブランチを削除する。
   * ブランチの削除はポインタを除去するだけで、コミット自体は残る。
   * ただし、他のブランチから到達不能になったコミットは
   * 実際の Git では gc（ガベージコレクション）で回収される。
   */
  deleteBranch(name: string): boolean {
    return this.refs.delete(`refs/heads/${name}`);
  }

  /**
   * ブランチを切り替える（`git checkout <branch>` に相当）。
   *
   * HEAD のシンボリック参照先を指定ブランチに変更する。
   * 実際の Git ではワーキングツリーの復元も行うが、
   * その処理は Git クラス側で実装している。
   *
   * @returns ブランチが存在すれば true、存在しなければ false
   */
  checkout(name: string): boolean {
    const ref = `refs/heads/${name}`;
    if (!this.refs.has(ref)) return false;
    this.headRef = ref;
    this.headDetached = false;
    return true;
  }

  /**
   * 特定のコミットを直接チェックアウトする（detached HEAD 状態に遷移）。
   *
   * detached HEAD では HEAD がブランチではなくコミットを直接指す。
   * この状態で新しいコミットを作成しても、どのブランチからも参照されないため、
   * ブランチを作成してから離れないとコミットが失われる可能性がある。
   */
  checkoutCommit(commitHash: string): void {
    this.headRef = commitHash;
    this.headDetached = true;
  }

  /**
   * 全ブランチの一覧を取得する。
   * 各ブランチについて名前、先端コミットのハッシュ、
   * 現在のブランチかどうかのフラグを返す。
   * 名前順にソートして返す。
   */
  listBranches(): { name: string; hash: string; current: boolean }[] {
    const result: { name: string; hash: string; current: boolean }[] = [];
    for (const [ref, hash] of this.refs) {
      if (ref.startsWith("refs/heads/")) {
        const name = ref.replace("refs/heads/", "");
        result.push({ name, hash, current: !this.headDetached && this.headRef === ref });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 指定ブランチの先端コミットハッシュを取得する。
   * マージ先のブランチのコミットを解決する際などに使用。
   */
  getBranch(name: string): string | undefined {
    return this.refs.get(`refs/heads/${name}`);
  }

  /**
   * 軽量タグを作成する。
   * 軽量タグはコミットハッシュを直接指す参照で、ブランチとの違いは
   * コミット時に自動的に進まない（不変のポインタ）こと。
   * 実際の Git には注釈付きタグ（annotated tag）もあり、
   * tag オブジェクトを経由してメッセージや署名を付加できる。
   */
  createTag(name: string, commitHash: string): void {
    this.refs.set(`refs/tags/${name}`, commitHash);
  }

  /**
   * 全タグの一覧を取得する。
   * 各タグの名前と参照先コミットハッシュを返す。
   */
  listTags(): { name: string; hash: string }[] {
    const result: { name: string; hash: string }[] = [];
    for (const [ref, hash] of this.refs) {
      if (ref.startsWith("refs/tags/")) {
        result.push({ name: ref.replace("refs/tags/", ""), hash });
      }
    }
    return result;
  }

  /** detached HEAD 状態かどうかを返す */
  isDetached(): boolean {
    return this.headDetached;
  }
}
