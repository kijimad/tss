import { describe, it, expect } from "vitest";
import { tokenize, parse } from "../parser/parser.js";
import { ShellExecutor } from "../executor/executor.js";

describe("パーサー", () => {
  it("単純なコマンド", () => {
    const tokens = tokenize("echo hello world");
    expect(tokens.filter(t => t.type === "word")).toHaveLength(3);
  });

  it("パイプ", () => {
    const ast = parse("echo hello | grep h");
    expect(ast.pipelines[0]?.pipeline.commands).toHaveLength(2);
  });

  it("リダイレクト", () => {
    const ast = parse("echo hello > out.txt");
    expect(ast.pipelines[0]?.pipeline.commands[0]?.redirects).toHaveLength(1);
  });

  it("&& 連結", () => {
    const ast = parse("true && echo ok");
    expect(ast.pipelines).toHaveLength(2);
    expect(ast.pipelines[1]?.operator).toBe("&&");
  });

  it("クォート文字列", () => {
    const tokens = tokenize('echo "hello world"');
    const words = tokens.filter(t => t.type === "word");
    expect(words[1]?.value).toBe("hello world");
  });

  it("セミコロン区切り", () => {
    const ast = parse("echo a ; echo b");
    expect(ast.pipelines).toHaveLength(2);
  });
});

describe("シェル実行", () => {
  it("echo", () => {
    const sh = new ShellExecutor();
    expect(sh.execute("echo hello")).toBe("hello\n");
  });

  it("変数展開", () => {
    const sh = new ShellExecutor();
    sh.env["NAME"] = "Alice";
    expect(sh.execute("echo $NAME")).toBe("Alice\n");
  });

  it("パイプ", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("echo hello | grep hell");
    expect(result).toContain("hello");
  });

  it("リダイレクト (>)", () => {
    const sh = new ShellExecutor();
    sh.execute("echo test > /tmp/out.txt");
    expect(sh.fs.get("/tmp/out.txt")).toBe("test\n");
  });

  it("リダイレクト (>>)", () => {
    const sh = new ShellExecutor();
    sh.execute("echo a > /tmp/app.txt");
    sh.execute("echo b >> /tmp/app.txt");
    expect(sh.fs.get("/tmp/app.txt")).toBe("a\nb\n");
  });

  it("&& (成功時のみ)", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("true && echo ok");
    expect(result).toContain("ok");
  });

  it("cat", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("cat /home/user/hello.txt");
    expect(result).toContain("Hello, Shell!");
  });

  it("wc -l", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("cat /home/user/numbers.txt | wc -l");
    expect(result.trim()).toBe("10");
  });

  it("sort", () => {
    const sh = new ShellExecutor();
    sh.fs.set("/tmp/unsorted.txt", "banana\napple\ncherry");
    const result = sh.execute("cat /tmp/unsorted.txt | sort");
    expect(result).toBe("apple\nbanana\ncherry\n");
  });

  it("head -3", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("cat /home/user/numbers.txt | head -3");
    expect(result).toBe("1\n2\n3\n");
  });

  it("grep -i (大文字小文字無視)", () => {
    const sh = new ShellExecutor();
    sh.fs.set("/tmp/test.txt", "Hello\nhello\nHELLO\nworld");
    const result = sh.execute("grep -i hello /tmp/test.txt");
    expect(result.split("\n").filter(l => l.length > 0)).toHaveLength(3);
  });

  it("cd + pwd", () => {
    const sh = new ShellExecutor();
    sh.execute("cd /tmp");
    expect(sh.execute("pwd").trim()).toBe("/tmp");
  });

  it("エイリアス", () => {
    const sh = new ShellExecutor();
    sh.aliases["greet"] = "echo hello";
    expect(sh.execute("greet")).toBe("hello\n");
  });

  it("seq", () => {
    const sh = new ShellExecutor();
    expect(sh.execute("seq 5").trim()).toBe("1\n2\n3\n4\n5");
  });

  it("cut -d, -f", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("cat /home/user/data.csv | cut -d , -f 1");
    expect(result).toContain("name");
    expect(result).toContain("Alice");
  });

  it("tr (文字変換)", () => {
    const sh = new ShellExecutor();
    const result = sh.execute("echo hello | tr e a");
    expect(result).toContain("hallo");
  });

  it("history", () => {
    const sh = new ShellExecutor();
    sh.execute("echo first");
    sh.execute("echo second");
    const result = sh.execute("history");
    expect(result).toContain("echo first");
    expect(result).toContain("echo second");
  });

  it("イベントが記録される", () => {
    const sh = new ShellExecutor();
    sh.execute("echo hello | grep h");
    expect(sh.events.filter(e => e.type === "fork").length).toBeGreaterThan(0);
    expect(sh.events.filter(e => e.type === "pipe").length).toBeGreaterThan(0);
  });
});
