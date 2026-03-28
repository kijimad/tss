import { describe, it, expect } from "vitest";
import { Kernel } from "../kernel/kernel.js";
import { Shell } from "../shell/shell.js";

describe("ファイルシステム", () => {
  it("初期ディレクトリが存在する", () => {
    const kernel = new Kernel();
    kernel.boot();
    expect(kernel.fs.exists("/bin")).toBe(true);
    expect(kernel.fs.exists("/home")).toBe(true);
    expect(kernel.fs.exists("/tmp")).toBe(true);
    expect(kernel.fs.exists("/etc")).toBe(true);
  });

  it("ファイルの作成と読み取り", () => {
    const kernel = new Kernel();
    kernel.boot();
    kernel.fs.writeFile("/tmp/test.txt", "hello world");
    expect(kernel.fs.readTextFile("/tmp/test.txt")).toBe("hello world");
  });

  it("ディレクトリ一覧", () => {
    const kernel = new Kernel();
    kernel.boot();
    kernel.fs.writeFile("/tmp/a.txt", "aaa");
    kernel.fs.writeFile("/tmp/b.txt", "bbb");
    const entries = kernel.fs.listDir("/tmp");
    expect(entries).toHaveLength(2);
    expect(entries?.map(e => e.name)).toContain("a.txt");
    expect(entries?.map(e => e.name)).toContain("b.txt");
  });

  it("ファイル削除", () => {
    const kernel = new Kernel();
    kernel.boot();
    kernel.fs.writeFile("/tmp/del.txt", "delete me");
    expect(kernel.fs.remove("/tmp/del.txt")).toBe(true);
    expect(kernel.fs.exists("/tmp/del.txt")).toBe(false);
  });

  it("サブディレクトリ作成", () => {
    const kernel = new Kernel();
    kernel.boot();
    kernel.fs.mkdir("/home/user");
    expect(kernel.fs.exists("/home/user")).toBe(true);
    kernel.fs.writeFile("/home/user/doc.txt", "my doc");
    expect(kernel.fs.readTextFile("/home/user/doc.txt")).toBe("my doc");
  });
});

describe("シェル", () => {
  function createShell(): { shell: Shell; output: string[] } {
    const kernel = new Kernel();
    kernel.boot();
    const shell = new Shell(kernel);
    const output: string[] = [];
    shell.onOutput = (text) => output.push(text);
    return { shell, output };
  }

  it("ls でディレクトリ一覧を表示する", () => {
    const { shell, output } = createShell();
    shell.execute("ls /");
    expect(output.join("")).toContain("bin/");
    expect(output.join("")).toContain("home/");
  });

  it("echo でテキストを表示する", () => {
    const { shell, output } = createShell();
    shell.execute("echo hello world");
    expect(output.join("")).toBe("hello world\n");
  });

  it("mkdir + ls でディレクトリを作成・確認する", () => {
    const { shell, output } = createShell();
    shell.execute("mkdir /tmp/mydir");
    shell.execute("ls /tmp");
    expect(output.join("")).toContain("mydir/");
  });

  it("write + cat でファイルの書き込み・読み取り", () => {
    const { shell, output } = createShell();
    shell.execute("write /tmp/msg.txt hello from shell");
    output.length = 0;
    shell.execute("cat /tmp/msg.txt");
    expect(output.join("")).toContain("hello from shell");
  });

  it("pwd でカレントディレクトリを表示する", () => {
    const { shell, output } = createShell();
    shell.execute("pwd");
    expect(output.join("")).toBe("/\n");
  });

  it("cd でディレクトリを移動する", () => {
    const { shell, output } = createShell();
    shell.execute("cd /tmp");
    shell.execute("pwd");
    expect(output.join("")).toBe("/tmp\n");
  });

  it("cd .. で親ディレクトリに移動する", () => {
    const { shell, output } = createShell();
    shell.execute("cd /tmp");
    shell.execute("cd ..");
    output.length = 0;
    shell.execute("pwd");
    expect(output.join("")).toBe("/\n");
  });

  it("rm でファイルを削除する", () => {
    const { shell, output } = createShell();
    shell.execute("touch /tmp/del.txt");
    shell.execute("rm /tmp/del.txt");
    output.length = 0;
    shell.execute("ls /tmp");
    expect(output.join("")).not.toContain("del.txt");
  });

  it("ps でプロセス一覧を表示する", () => {
    const { shell, output } = createShell();
    shell.execute("ps");
    const text = output.join("");
    expect(text).toContain("PID");
    expect(text).toContain("shell");
  });

  it("uname でシステム情報を表示する", () => {
    const { shell, output } = createShell();
    shell.execute("uname");
    expect(output.join("")).toContain("BrowserOS");
  });

  it("help でコマンド一覧を表示する", () => {
    const { shell, output } = createShell();
    shell.execute("help");
    const text = output.join("");
    expect(text).toContain("ls");
    expect(text).toContain("cat");
    expect(text).toContain("mkdir");
  });

  it("存在しないコマンドでエラーメッセージを表示する", () => {
    const { shell, output } = createShell();
    shell.execute("nonexistent");
    expect(output.join("")).toContain("command not found");
  });

  it("stat でファイル情報を表示する", () => {
    const { shell, output } = createShell();
    shell.execute("write /tmp/info.txt some content");
    output.length = 0;
    shell.execute("stat /tmp/info.txt");
    const text = output.join("");
    expect(text).toContain("Type: file");
    expect(text).toContain("Size:");
  });

  it("相対パスで操作できる", () => {
    const { shell, output } = createShell();
    shell.execute("cd /tmp");
    shell.execute("touch myfile.txt");
    output.length = 0;
    shell.execute("ls");
    expect(output.join("")).toContain("myfile.txt");
  });
});

describe("プロセス管理", () => {
  it("boot でシェルプロセスが作られる", () => {
    const kernel = new Kernel();
    kernel.boot();
    const procs = kernel.processTable.listAll();
    expect(procs.length).toBeGreaterThan(0);
    expect(procs[0]?.name).toBe("shell");
  });
});
