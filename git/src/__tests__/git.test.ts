import { describe, it, expect, beforeEach } from "vitest";
import { Git } from "../commands/git.js";
import { hash } from "../store/objects.js";

let git: Git;

beforeEach(() => {
  git = new Git();
  git.init();
});

describe("オブジェクトストア", () => {
  it("同じ内容は同じハッシュになる", () => {
    expect(hash("hello")).toBe(hash("hello"));
    expect(hash("hello")).not.toBe(hash("world"));
  });
});

describe("init + add + commit", () => {
  it("ファイルを追加してコミットする", () => {
    git.workTree.set("README.md", "# My Project");
    git.add(["README.md"]);
    const result = git.commit("Initial commit");
    expect(result).toContain("Initial commit");
    expect(result).toContain("main");
  });

  it("複数ファイルをコミットする", () => {
    git.workTree.set("a.txt", "aaa");
    git.workTree.set("b.txt", "bbb");
    git.add(["."]);
    git.commit("Add two files");

    const headTree = git.objects.get(git.refs.getHead() ?? "");
    expect(headTree?.type).toBe("commit");
  });

  it("コミットが親を持つ", () => {
    git.workTree.set("a.txt", "v1");
    git.add(["."]);
    git.commit("First");

    git.workTree.set("a.txt", "v2");
    git.add(["."]);
    git.commit("Second");

    const head = git.refs.getHead() ?? "";
    const commit = git.objects.get(head);
    expect(commit?.type).toBe("commit");
    if (commit?.type === "commit") {
      expect(commit.parents).toHaveLength(1);
    }
  });
});

describe("status", () => {
  it("未追跡ファイルを表示する", () => {
    git.workTree.set("new.txt", "new");
    const status = git.status();
    expect(status).toContain("Untracked");
    expect(status).toContain("new.txt");
  });

  it("ステージ済みファイルを表示する", () => {
    git.workTree.set("staged.txt", "content");
    git.add(["staged.txt"]);
    const status = git.status();
    expect(status).toContain("Changes to be committed");
    expect(status).toContain("staged.txt");
  });

  it("変更のないクリーンな状態を表示する", () => {
    git.workTree.set("clean.txt", "ok");
    git.add(["."]);
    git.commit("clean");
    const status = git.status();
    expect(status).toContain("nothing to commit");
  });

  it("コミット後に変更したファイルを検出する", () => {
    git.workTree.set("file.txt", "v1");
    git.add(["."]);
    git.commit("v1");
    git.workTree.set("file.txt", "v2");
    const status = git.status();
    expect(status).toContain("Changes not staged");
    expect(status).toContain("file.txt");
  });
});

describe("log", () => {
  it("コミット履歴を表示する", () => {
    git.workTree.set("a.txt", "1");
    git.add(["."]);
    git.commit("First");
    git.workTree.set("a.txt", "2");
    git.add(["."]);
    git.commit("Second");

    const log = git.log();
    expect(log).toContain("Second");
    expect(log).toContain("First");
    // Second が先に表示される（新しい順）
    expect(log.indexOf("Second")).toBeLessThan(log.indexOf("First"));
  });
});

describe("diff", () => {
  it("変更された行を表示する", () => {
    git.workTree.set("file.txt", "line1\nline2");
    git.add(["."]);
    git.workTree.set("file.txt", "line1\nchanged");
    const d = git.diff();
    expect(d).toContain("-line2");
    expect(d).toContain("+changed");
  });
});

describe("branch", () => {
  it("ブランチを作成して一覧に表示する", () => {
    git.workTree.set("a.txt", "1");
    git.add(["."]);
    git.commit("init");

    git.branch("feature");
    const list = git.branch();
    expect(list).toContain("main");
    expect(list).toContain("feature");
  });
});

describe("checkout", () => {
  it("ブランチを切り替える", () => {
    git.workTree.set("a.txt", "main content");
    git.add(["."]);
    git.commit("on main");

    git.branch("dev");
    git.checkout("dev");
    expect(git.refs.getHeadBranch()).toBe("dev");
  });

  it("ブランチ切り替えでワーキングツリーが復元される", () => {
    git.workTree.set("a.txt", "main");
    git.add(["."]);
    git.commit("on main");

    git.branch("dev");
    git.checkout("dev");

    git.workTree.set("a.txt", "dev change");
    git.add(["."]);
    git.commit("on dev");

    git.checkout("main");
    expect(git.workTree.get("a.txt")).toBe("main");
  });
});

describe("merge", () => {
  it("fast-forward マージ", () => {
    git.workTree.set("a.txt", "1");
    git.add(["."]);
    git.commit("init");

    git.branch("feature");
    git.checkout("feature");

    git.workTree.set("b.txt", "new");
    git.add(["."]);
    git.commit("add b");

    git.checkout("main");
    const result = git.merge("feature");
    expect(result).toContain("Fast-forward");
    expect(git.workTree.has("b.txt")).toBe(true);
  });

  it("コンフリクトを検出する", () => {
    git.workTree.set("a.txt", "original");
    git.add(["."]);
    git.commit("init");

    git.branch("feature");

    // main で変更
    git.workTree.set("a.txt", "main change");
    git.add(["."]);
    git.commit("main change");

    // feature で異なる変更
    git.checkout("feature");
    git.workTree.set("a.txt", "feature change");
    git.add(["."]);
    git.commit("feature change");

    git.checkout("main");
    const result = git.merge("feature");
    expect(result).toContain("CONFLICT");
    // コンフリクトマーカーがワーキングツリーに
    const content = git.workTree.get("a.txt") ?? "";
    expect(content).toContain("<<<<<<<");
    expect(content).toContain(">>>>>>>");
  });
});

describe("tag", () => {
  it("タグを作成して一覧表示する", () => {
    git.workTree.set("a.txt", "1");
    git.add(["."]);
    git.commit("init");
    git.tag("v1.0");
    expect(git.tag()).toContain("v1.0");
  });

  it("log にタグが表示される", () => {
    git.workTree.set("a.txt", "1");
    git.add(["."]);
    git.commit("init");
    git.tag("v1.0");
    const log = git.log();
    expect(log).toContain("tag: v1.0");
  });
});

describe("イベントトレース", () => {
  it("コミット時にオブジェクト作成イベントが記録される", () => {
    git.workTree.set("a.txt", "1");
    git.add(["."]);
    git.resetEvents();
    git.commit("test");

    const blobEvents = git.events.filter(e => e.type === "object_create" && e.objectType === "blob");
    const treeEvents = git.events.filter(e => e.type === "object_create" && e.objectType === "tree");
    const commitEvents = git.events.filter(e => e.type === "object_create" && e.objectType === "commit");
    // blob は add で既に作られているので commit 時には tree と commit
    expect(treeEvents.length).toBeGreaterThan(0);
    expect(commitEvents.length).toBe(1);
  });
});
