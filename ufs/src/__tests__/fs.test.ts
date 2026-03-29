import { describe, it, expect, beforeEach } from "vitest";
import { BlockDevice } from "../hw/disk.js";
import { UnixFS } from "../fs/filesystem.js";
import { InodeMode } from "../fs/types.js";

let disk: BlockDevice;
let fs: UnixFS;

beforeEach(() => {
  disk = new BlockDevice();
  fs = new UnixFS(disk);
  fs.format();
});

describe("ディスク", () => {
  it("ブロック読み書き", () => {
    const data = new Uint8Array(512);
    data[0] = 0xAA;
    data[511] = 0xBB;
    disk.writeBlock(100, data);
    const read = disk.readBlock(100);
    expect(read[0]).toBe(0xAA);
    expect(read[511]).toBe(0xBB);
  });
});

describe("フォーマット", () => {
  it("スーパーブロックが書き込まれる", () => {
    const sb = fs.getSuperBlock();
    expect(sb.magic).toBe(0x0F5F);
    expect(sb.blockSize).toBe(512);
  });

  it("ルートディレクトリが存在する", () => {
    expect(fs.exists("/")).toBe(true);
    const entries = fs.readdir("/");
    expect(entries).toBeDefined();
    // . と .. が存在する
    const names = entries?.map(e => e.name) ?? [];
    expect(names).toContain(".");
    expect(names).toContain("..");
  });

  it("ルート inode はディレクトリ", () => {
    const info = fs.stat("/");
    expect(info).toBeDefined();
    expect(info?.inode.mode & 0o170000).toBe(InodeMode.Directory);
  });
});

describe("ディレクトリ操作", () => {
  it("mkdir でディレクトリを作成する", () => {
    expect(fs.mkdir("/home")).toBe(true);
    expect(fs.exists("/home")).toBe(true);
    const info = fs.stat("/home");
    expect(info?.inode.mode & 0o170000).toBe(InodeMode.Directory);
  });

  it("ネストしたディレクトリを作成する", () => {
    fs.mkdir("/home");
    fs.mkdir("/home/user");
    expect(fs.exists("/home/user")).toBe(true);
  });

  it("mkdir した中に . と .. がある", () => {
    fs.mkdir("/tmp");
    const entries = fs.readdir("/tmp");
    const names = entries?.map(e => e.name) ?? [];
    expect(names).toContain(".");
    expect(names).toContain("..");
  });

  it("既存ディレクトリの作成は失敗する", () => {
    fs.mkdir("/tmp");
    expect(fs.mkdir("/tmp")).toBe(false);
  });

  it("readdir でエントリ一覧を取得する", () => {
    fs.mkdir("/a");
    fs.mkdir("/b");
    fs.createFile("/c.txt", "hello");
    const entries = fs.readdir("/");
    const names = entries?.map(e => e.name) ?? [];
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).toContain("c.txt");
  });
});

describe("ファイル操作", () => {
  it("ファイルを作成して読み取る", () => {
    fs.createFile("/hello.txt", "Hello, World!");
    const content = fs.readTextFile("/hello.txt");
    expect(content).toBe("Hello, World!");
  });

  it("ファイルを上書きする", () => {
    fs.createFile("/data.txt", "old");
    fs.writeFile("/data.txt", "new content");
    expect(fs.readTextFile("/data.txt")).toBe("new content");
  });

  it("存在しないファイルの writeFile は新規作成する", () => {
    fs.writeFile("/new.txt", "created");
    expect(fs.readTextFile("/new.txt")).toBe("created");
  });

  it("サブディレクトリにファイルを作成する", () => {
    fs.mkdir("/docs");
    fs.createFile("/docs/readme.md", "# Title");
    expect(fs.readTextFile("/docs/readme.md")).toBe("# Title");
  });

  it("大きなファイルを読み書きする（複数ブロック）", () => {
    const bigContent = "x".repeat(2000); // 4ブロック分
    fs.createFile("/big.txt", bigContent);
    expect(fs.readTextFile("/big.txt")).toBe(bigContent);
  });

  it("空ファイルを作成する", () => {
    fs.createFile("/empty.txt");
    const content = fs.readFile("/empty.txt");
    expect(content).toBeDefined();
    expect(content?.length).toBe(0);
  });

  it("stat でファイル情報を取得する", () => {
    fs.createFile("/info.txt", "test data");
    const info = fs.stat("/info.txt");
    expect(info).toBeDefined();
    expect(info?.inode.size).toBe(9);
    expect(info?.inode.mode & 0o170000).toBe(InodeMode.File);
    expect(info?.inode.links).toBe(1);
  });
});

describe("削除", () => {
  it("ファイルを削除する", () => {
    fs.createFile("/del.txt", "bye");
    expect(fs.unlink("/del.txt")).toBe(true);
    expect(fs.exists("/del.txt")).toBe(false);
  });

  it("空ディレクトリを削除する", () => {
    fs.mkdir("/empty_dir");
    expect(fs.unlink("/empty_dir")).toBe(true);
    expect(fs.exists("/empty_dir")).toBe(false);
  });

  it("空でないディレクトリの削除は失敗する", () => {
    fs.mkdir("/notempty");
    fs.createFile("/notempty/file.txt", "x");
    expect(fs.unlink("/notempty")).toBe(false);
  });

  it("削除後に inode が再利用される", () => {
    const sb1 = fs.getSuperBlock();
    fs.createFile("/tmp.txt", "temp");
    const sb2 = fs.getSuperBlock();
    expect(sb2.freeInodes).toBe(sb1.freeInodes - 1);
    fs.unlink("/tmp.txt");
    const sb3 = fs.getSuperBlock();
    expect(sb3.freeInodes).toBe(sb1.freeInodes);
  });
});

describe("ディスクI/Oトレース", () => {
  it("ファイル操作でディスクイベントが記録される", () => {
    disk.resetEvents();
    fs.createFile("/trace.txt", "data");
    expect(disk.events.length).toBeGreaterThan(0);
    const reads = disk.events.filter(e => e.type === "read");
    const writes = disk.events.filter(e => e.type === "write");
    expect(reads.length).toBeGreaterThan(0);
    expect(writes.length).toBeGreaterThan(0);
  });
});

describe("FSイベントトレース", () => {
  it("ファイル作成で FS イベントが記録される", () => {
    fs.resetEvents();
    fs.createFile("/ev.txt", "hello");
    const allocs = fs.events.filter(e => e.type === "inode_alloc");
    expect(allocs.length).toBe(1);
    const dirAdds = fs.events.filter(e => e.type === "dir_add");
    expect(dirAdds.length).toBe(1);
  });
});
