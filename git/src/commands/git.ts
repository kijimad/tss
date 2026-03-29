/**
 * git.ts -- Git コマンド実装
 *
 * ワーキングツリー（仮想FS）+ ステージングエリア（index）+
 * オブジェクトストア + 参照 を統合して Git コマンドを提供する。
 *
 * コマンド:
 *   init, add, commit, status, log, diff,
 *   branch, checkout, merge, tag, show, cat-file
 */
import { ObjectStore, type GitObject, type TreeEntry, hashObject } from "../store/objects.js";
import { RefStore } from "../store/refs.js";

// ワーキングツリー（仮想ファイルシステム）
export type WorkTree = Map<string, string>; // path → content

// ステージングエリア（index）
export type Index = Map<string, string>;    // path → blob hash

// Git イベント（可視化用）
export type GitEvent =
  | { type: "object_create"; objectType: string; hash: string; detail: string }
  | { type: "ref_update"; ref: string; oldHash: string; newHash: string }
  | { type: "index_add"; path: string; hash: string }
  | { type: "checkout"; branch: string }
  | { type: "merge"; from: string; to: string; conflicts: string[] }
  | { type: "info"; message: string };

export class Git {
  readonly objects: ObjectStore;
  readonly refs: RefStore;
  readonly workTree: WorkTree;
  readonly index: Index;
  events: GitEvent[] = [];
  onEvent: ((event: GitEvent) => void) | undefined;

  constructor() {
    this.objects = new ObjectStore();
    this.refs = new RefStore();
    this.workTree = new Map();
    this.index = new Map();
  }

  private emit(event: GitEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  // === init ===
  init(): string {
    this.emit({ type: "info", message: "Initialized empty Git repository" });
    return "Initialized empty Git repository";
  }

  // === add ===
  add(paths: string[]): string {
    const lines: string[] = [];
    for (const path of paths) {
      if (path === ".") {
        // 全ファイル追加
        for (const [p, content] of this.workTree) {
          this.stageFile(p, content);
          lines.push(`  add '${p}'`);
        }
      } else {
        const content = this.workTree.get(path);
        if (content === undefined) {
          // 削除されたファイル: index からも削除
          this.index.delete(path);
          lines.push(`  remove '${path}'`);
        } else {
          this.stageFile(path, content);
          lines.push(`  add '${path}'`);
        }
      }
    }
    return lines.join("\n");
  }

  private stageFile(path: string, content: string): void {
    const blob: GitObject = { type: "blob", content };
    const blobHash = this.objects.store(blob);
    this.index.set(path, blobHash);
    this.emit({ type: "object_create", objectType: "blob", hash: blobHash, detail: path });
    this.emit({ type: "index_add", path, hash: blobHash });
  }

  // === commit ===
  commit(message: string, author = "User <user@example.com>"): string {
    if (this.index.size === 0) return "nothing to commit";

    // index から tree オブジェクトを構築
    const treeHash = this.buildTree();

    // 親コミット
    const parentHash = this.refs.getHead();
    const parents = parentHash !== undefined ? [parentHash] : [];

    // commit オブジェクト作成
    const commitObj: GitObject = {
      type: "commit",
      tree: treeHash,
      parents,
      author,
      date: Date.now(),
      message,
    };
    const commitHash = this.objects.store(commitObj);

    const oldHead = this.refs.getHead() ?? "(none)";
    this.refs.updateHead(commitHash);

    // 初回コミットならブランチ作成
    if (parentHash === undefined) {
      this.refs.createBranch("main", commitHash);
    }

    this.emit({ type: "object_create", objectType: "commit", hash: commitHash, detail: message });
    this.emit({ type: "ref_update", ref: this.refs.getHeadBranch() ?? "HEAD", oldHash: oldHead, newHash: commitHash });

    const short = commitHash.slice(0, 7);
    const branch = this.refs.getHeadBranch() ?? "detached";
    return `[${branch} ${short}] ${message}`;
  }

  // index からツリーを構築（ディレクトリ階層を再帰的に作る）
  private buildTree(): string {
    // パスをディレクトリ構造に変換
    const root = new Map<string, string | Map<string, unknown>>();

    for (const [path, blobHash] of this.index) {
      const parts = path.split("/");
      let current: Map<string, unknown> = root as Map<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i] ?? "";
        let sub = current.get(dir);
        if (!(sub instanceof Map)) {
          sub = new Map<string, unknown>();
          current.set(dir, sub);
        }
        current = sub as Map<string, unknown>;
      }
      const fileName = parts[parts.length - 1] ?? "";
      current.set(fileName, blobHash);
    }

    return this.buildTreeFromMap(root as Map<string, unknown>);
  }

  private buildTreeFromMap(entries: Map<string, unknown>): string {
    const treeEntries: TreeEntry[] = [];
    for (const [name, value] of entries) {
      if (typeof value === "string") {
        // blob
        treeEntries.push({ mode: "100644", name, hash: value });
      } else if (value instanceof Map) {
        // サブディレクトリ
        const subTreeHash = this.buildTreeFromMap(value as Map<string, unknown>);
        treeEntries.push({ mode: "040000", name, hash: subTreeHash });
      }
    }
    treeEntries.sort((a, b) => a.name.localeCompare(b.name));

    const treeObj: GitObject = { type: "tree", entries: treeEntries };
    const treeHash = this.objects.store(treeObj);
    this.emit({ type: "object_create", objectType: "tree", hash: treeHash, detail: `${String(treeEntries.length)} entries` });
    return treeHash;
  }

  // === status ===
  status(): string {
    const branch = this.refs.getHeadBranch();
    const lines: string[] = [];
    lines.push(`On branch ${branch ?? "(detached)"}`);

    // staged (index にあるがコミット済みと異なるもの)
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    // 最新コミットの tree を取得
    const headTree = this.getHeadTree();

    for (const [path, blobHash] of this.index) {
      const headBlobHash = headTree.get(path);
      if (headBlobHash !== blobHash) {
        staged.push(headBlobHash === undefined ? `new file:   ${path}` : `modified:   ${path}`);
      }
    }

    for (const [path, content] of this.workTree) {
      const indexHash = this.index.get(path);
      if (indexHash === undefined) {
        untracked.push(path);
      } else {
        const currentBlob: GitObject = { type: "blob", content };
        const currentHash = hashObject(currentBlob);
        if (currentHash !== indexHash) {
          unstaged.push(`modified:   ${path}`);
        }
      }
    }

    // index にあるがワーキングツリーにないファイル
    for (const [path] of this.index) {
      if (!this.workTree.has(path)) {
        unstaged.push(`deleted:    ${path}`);
      }
    }

    if (staged.length > 0) {
      lines.push("\nChanges to be committed:");
      for (const s of staged) lines.push(`  ${s}`);
    }
    if (unstaged.length > 0) {
      lines.push("\nChanges not staged for commit:");
      for (const s of unstaged) lines.push(`  ${s}`);
    }
    if (untracked.length > 0) {
      lines.push("\nUntracked files:");
      for (const u of untracked) lines.push(`  ${u}`);
    }
    if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
      lines.push("\nnothing to commit, working tree clean");
    }

    return lines.join("\n");
  }

  // HEAD コミットの tree から全 blob を取得
  private getHeadTree(): Map<string, string> {
    const result = new Map<string, string>();
    const headHash = this.refs.getHead();
    if (headHash === undefined) return result;

    const commit = this.objects.get(headHash);
    if (commit === undefined || commit.type !== "commit") return result;

    this.flattenTree(commit.tree, "", result);
    return result;
  }

  private flattenTree(treeHash: string, prefix: string, result: Map<string, string>): void {
    const tree = this.objects.get(treeHash);
    if (tree === undefined || tree.type !== "tree") return;

    for (const entry of tree.entries) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.mode === "040000") {
        this.flattenTree(entry.hash, fullPath, result);
      } else {
        result.set(fullPath, entry.hash);
      }
    }
  }

  // === log ===
  log(maxCount = 20): string {
    const lines: string[] = [];
    let commitHash = this.refs.getHead();
    let count = 0;

    while (commitHash !== undefined && count < maxCount) {
      const obj = this.objects.get(commitHash);
      if (obj === undefined || obj.type !== "commit") break;

      const short = commitHash.slice(0, 7);
      const date = new Date(obj.date).toISOString().slice(0, 19).replace("T", " ");
      // ブランチ表示
      const branchLabels = this.refs.listBranches()
        .filter(b => b.hash === commitHash)
        .map(b => b.current ? `HEAD -> ${b.name}` : b.name);
      const tagLabels = this.refs.listTags()
        .filter(t => t.hash === commitHash)
        .map(t => `tag: ${t.name}`);
      const labels = [...branchLabels, ...tagLabels];
      const labelStr = labels.length > 0 ? ` (${labels.join(", ")})` : "";

      lines.push(`commit ${short}${labelStr}`);
      lines.push(`Author: ${obj.author}`);
      lines.push(`Date:   ${date}`);
      lines.push(`\n    ${obj.message}\n`);

      commitHash = obj.parents[0];
      count++;
    }

    return lines.length > 0 ? lines.join("\n") : "No commits yet";
  }

  // === diff (ワーキングツリー vs index) ===
  diff(): string {
    const lines: string[] = [];

    for (const [path, content] of this.workTree) {
      const indexHash = this.index.get(path);
      if (indexHash === undefined) continue;

      const blob = this.objects.get(indexHash);
      if (blob === undefined || blob.type !== "blob") continue;

      if (blob.content !== content) {
        lines.push(`diff --git a/${path} b/${path}`);
        const oldLines = blob.content.split("\n");
        const newLines = content.split("\n");
        lines.push(`--- a/${path}`);
        lines.push(`+++ b/${path}`);
        // 簡易diff: 行ごとに比較
        const maxLen = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          const old = oldLines[i];
          const cur = newLines[i];
          if (old === cur) {
            if (old !== undefined) lines.push(` ${old}`);
          } else {
            if (old !== undefined) lines.push(`-${old}`);
            if (cur !== undefined) lines.push(`+${cur}`);
          }
        }
        lines.push("");
      }
    }

    return lines.length > 0 ? lines.join("\n") : "No changes";
  }

  // === branch ===
  branch(name?: string): string {
    if (name !== undefined) {
      const head = this.refs.getHead();
      if (head === undefined) return "fatal: not a valid object name: 'main'";
      this.refs.createBranch(name, head);
      this.emit({ type: "ref_update", ref: name, oldHash: "(none)", newHash: head });
      return `Created branch '${name}'`;
    }

    const branches = this.refs.listBranches();
    return branches.map(b => `${b.current ? "* " : "  "}${b.name}  ${b.hash.slice(0, 7)}`).join("\n");
  }

  // === checkout ===
  checkout(target: string): string {
    // ブランチ
    if (this.refs.checkout(target)) {
      // ワーキングツリーをそのブランチの tree で復元
      this.restoreWorkTree();
      this.emit({ type: "checkout", branch: target });
      return `Switched to branch '${target}'`;
    }
    return `error: pathspec '${target}' did not match`;
  }

  // コミットの tree からワーキングツリーと index を復元
  private restoreWorkTree(): void {
    this.workTree.clear();
    this.index.clear();
    const headTree = this.getHeadTree();
    for (const [path, blobHash] of headTree) {
      const blob = this.objects.get(blobHash);
      if (blob !== undefined && blob.type === "blob") {
        this.workTree.set(path, blob.content);
        this.index.set(path, blobHash);
      }
    }
  }

  // === merge (簡易: fast-forward + 3-way) ===
  merge(branchName: string): string {
    const targetHash = this.refs.getBranch(branchName);
    if (targetHash === undefined) return `merge: '${branchName}' - not found`;

    const currentHash = this.refs.getHead();
    if (currentHash === undefined) return "fatal: no commits";

    // 共通祖先を探す
    const currentAncestors = this.getAncestors(currentHash);
    const targetAncestors = this.getAncestors(targetHash);

    // Fast-forward: current が target の祖先ならポインタを進めるだけ
    if (targetAncestors.has(currentHash)) {
      this.refs.updateHead(targetHash);
      this.restoreWorkTree();
      this.emit({ type: "merge", from: branchName, to: this.refs.getHeadBranch() ?? "HEAD", conflicts: [] });
      return `Fast-forward to ${targetHash.slice(0, 7)}`;
    }

    // current が target の子孫なら何もしない
    if (currentAncestors.has(targetHash)) {
      return "Already up to date.";
    }

    // 3-way merge: 両方の tree を統合してマージコミットを作成
    const currentTree = this.getTreeAtCommit(currentHash);
    const targetTree = this.getTreeAtCommit(targetHash);
    const conflicts: string[] = [];

    // target のファイルを current にマージ
    for (const [path, targetBlobHash] of targetTree) {
      const currentBlobHash = currentTree.get(path);
      if (currentBlobHash === undefined) {
        // target にのみ存在 → 追加
        const blob = this.objects.get(targetBlobHash);
        if (blob !== undefined && blob.type === "blob") {
          this.workTree.set(path, blob.content);
          this.index.set(path, targetBlobHash);
        }
      } else if (currentBlobHash !== targetBlobHash) {
        // 両方で変更 → コンフリクト
        const currentBlob = this.objects.get(currentBlobHash);
        const targetBlob = this.objects.get(targetBlobHash);
        const currentContent = currentBlob?.type === "blob" ? currentBlob.content : "";
        const targetContent = targetBlob?.type === "blob" ? targetBlob.content : "";
        const merged = `<<<<<<< HEAD\n${currentContent}\n=======\n${targetContent}\n>>>>>>> ${branchName}\n`;
        this.workTree.set(path, merged);
        conflicts.push(path);
      }
    }

    if (conflicts.length > 0) {
      this.emit({ type: "merge", from: branchName, to: this.refs.getHeadBranch() ?? "HEAD", conflicts });
      return `CONFLICT in: ${conflicts.join(", ")}\nAutomatic merge failed; fix conflicts and then commit.`;
    }

    // コンフリクトなし → マージコミット自動作成
    this.add(["."]);
    const treeHash = this.buildTree();
    const mergeCommit: GitObject = {
      type: "commit",
      tree: treeHash,
      parents: [currentHash, targetHash],
      author: "User <user@example.com>",
      date: Date.now(),
      message: `Merge branch '${branchName}'`,
    };
    const mergeHash = this.objects.store(mergeCommit);
    this.refs.updateHead(mergeHash);
    this.emit({ type: "merge", from: branchName, to: this.refs.getHeadBranch() ?? "HEAD", conflicts: [] });
    return `Merge made by the 'recursive' strategy. ${mergeHash.slice(0, 7)}`;
  }

  private getAncestors(commitHash: string): Set<string> {
    const ancestors = new Set<string>();
    const queue = [commitHash];
    while (queue.length > 0) {
      const h = queue.shift();
      if (h === undefined || ancestors.has(h)) continue;
      ancestors.add(h);
      const obj = this.objects.get(h);
      if (obj !== undefined && obj.type === "commit") {
        for (const p of obj.parents) queue.push(p);
      }
    }
    return ancestors;
  }

  private getTreeAtCommit(commitHash: string): Map<string, string> {
    const result = new Map<string, string>();
    const obj = this.objects.get(commitHash);
    if (obj === undefined || obj.type !== "commit") return result;
    this.flattenTree(obj.tree, "", result);
    return result;
  }

  // === tag ===
  tag(name?: string): string {
    if (name !== undefined) {
      const head = this.refs.getHead();
      if (head === undefined) return "fatal: no commits";
      this.refs.createTag(name, head);
      return `Created tag '${name}' at ${head.slice(0, 7)}`;
    }
    const tags = this.refs.listTags();
    return tags.length > 0 ? tags.map(t => t.name).join("\n") : "No tags";
  }

  // === show (コミット詳細) ===
  show(ref?: string): string {
    const hash = ref ?? this.refs.getHead();
    if (hash === undefined) return "fatal: no commits";

    const obj = this.objects.get(hash);
    if (obj === undefined) return `fatal: bad object ${hash ?? ""}`;

    switch (obj.type) {
      case "commit": {
        const date = new Date(obj.date).toISOString().slice(0, 19).replace("T", " ");
        return `commit ${hash}\nAuthor: ${obj.author}\nDate:   ${date}\n\n    ${obj.message}\n\nTree: ${obj.tree}\nParents: ${obj.parents.join(", ") || "(none)"}`;
      }
      case "tree":
        return `tree ${hash}\n${obj.entries.map(e => `${e.mode} ${e.name} ${e.hash.slice(0, 7)}`).join("\n")}`;
      case "blob":
        return obj.content;
    }
  }

  // === cat-file (オブジェクト内容表示) ===
  catFile(hash: string): string {
    return this.show(hash);
  }

  resetEvents(): void {
    this.events = [];
  }
}
