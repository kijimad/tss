/**
 * refs.ts -- 参照（ブランチ、タグ、HEAD）
 *
 * Git の参照はコミットハッシュへのポインタ:
 *   refs/heads/main   → abc123  (ブランチ)
 *   refs/heads/dev    → def456  (ブランチ)
 *   refs/tags/v1.0    → 789abc  (タグ)
 *   HEAD              → ref: refs/heads/main  (現在のブランチ)
 *                      or abc123  (detached HEAD)
 *
 * ブランチ = 「最新コミットを指すポインタ」。
 * コミットするたびにポインタが前に進む。それだけ。
 */

export class RefStore {
  // refs/heads/main → コミットハッシュ
  private refs = new Map<string, string>();
  // HEAD: ブランチ名 or コミットハッシュ
  private headRef = "refs/heads/main"; // symbolic ref
  private headDetached = false;

  // HEAD が指すコミットハッシュを取得
  getHead(): string | undefined {
    if (this.headDetached) {
      return this.headRef; // 直接ハッシュ
    }
    return this.refs.get(this.headRef);
  }

  // HEAD のブランチ名を取得（detached なら undefined）
  getHeadBranch(): string | undefined {
    if (this.headDetached) return undefined;
    return this.headRef.replace("refs/heads/", "");
  }

  // HEAD を更新（コミット時にブランチを進める）
  updateHead(commitHash: string): void {
    if (this.headDetached) {
      this.headRef = commitHash;
    } else {
      this.refs.set(this.headRef, commitHash);
    }
  }

  // ブランチ作成
  createBranch(name: string, commitHash: string): void {
    this.refs.set(`refs/heads/${name}`, commitHash);
  }

  // ブランチ削除
  deleteBranch(name: string): boolean {
    return this.refs.delete(`refs/heads/${name}`);
  }

  // ブランチ切り替え
  checkout(name: string): boolean {
    const ref = `refs/heads/${name}`;
    if (!this.refs.has(ref)) return false;
    this.headRef = ref;
    this.headDetached = false;
    return true;
  }

  // detached HEAD
  checkoutCommit(commitHash: string): void {
    this.headRef = commitHash;
    this.headDetached = true;
  }

  // ブランチ一覧
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

  // ブランチのコミットハッシュを取得
  getBranch(name: string): string | undefined {
    return this.refs.get(`refs/heads/${name}`);
  }

  // タグ作成
  createTag(name: string, commitHash: string): void {
    this.refs.set(`refs/tags/${name}`, commitHash);
  }

  // タグ一覧
  listTags(): { name: string; hash: string }[] {
    const result: { name: string; hash: string }[] = [];
    for (const [ref, hash] of this.refs) {
      if (ref.startsWith("refs/tags/")) {
        result.push({ name: ref.replace("refs/tags/", ""), hash });
      }
    }
    return result;
  }

  isDetached(): boolean {
    return this.headDetached;
  }
}
