import { describe, it, expect } from "vitest";
import { EventLoop } from "../runtime/event-loop.js";
import { NodeRuntime } from "../runtime/node-runtime.js";

describe("イベントループ", () => {
  it("setTimeout が正しいタイミングで発火する", () => {
    const loop = new EventLoop();
    let fired = false;
    loop.setTimeout(() => { fired = true; }, 3);
    // 3 tick 後に発火するはず
    loop.tick(); expect(fired).toBe(false); // tick 1
    loop.tick(); expect(fired).toBe(false); // tick 2
    loop.tick(); expect(fired).toBe(true);  // tick 3
  });

  it("setInterval が繰り返し発火する", () => {
    const loop = new EventLoop();
    let count = 0;
    loop.setInterval(() => { count++; }, 2);
    for (let i = 0; i < 10; i++) loop.tick();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it("clearTimeout でタイマーをキャンセルできる", () => {
    const loop = new EventLoop();
    let fired = false;
    const id = loop.setTimeout(() => { fired = true; }, 1);
    loop.clearTimeout(id);
    loop.run(10);
    expect(fired).toBe(false);
  });

  it("setImmediate は check フェーズで発火する", () => {
    const loop = new EventLoop();
    let fired = false;
    loop.setImmediate(() => { fired = true; });
    loop.tick();
    expect(fired).toBe(true);
  });

  it("process.nextTick は microtask より先に実行される", () => {
    const loop = new EventLoop();
    const order: string[] = [];
    loop.queueMicrotask(() => order.push("microtask"));
    loop.nextTick(() => order.push("nextTick"));
    loop.tick();
    expect(order).toEqual(["nextTick", "microtask"]);
  });

  it("I/O コールバックが pending_callbacks フェーズで発火する", () => {
    const loop = new EventLoop();
    let result = "";
    loop.enqueuePendingCallback(() => { result = "done"; }, "test io");
    loop.tick();
    expect(result).toBe("done");
  });

  it("全ての処理が完了するとループが終了する", () => {
    const loop = new EventLoop();
    let count = 0;
    loop.setTimeout(() => { count++; }, 0);
    const ticks = loop.run(100);
    expect(count).toBe(1);
    expect(ticks).toBeLessThan(10);
  });

  it("トレースイベントが記録される", () => {
    const loop = new EventLoop();
    loop.setTimeout(() => {}, 0);
    loop.run(5);
    const phases = loop.events.filter(e => e.type === "phase_enter");
    expect(phases.length).toBeGreaterThan(0);
    const timerFires = loop.events.filter(e => e.type === "timer_fire");
    expect(timerFires.length).toBe(1);
  });
});

describe("Node.js ランタイム", () => {
  describe("console", () => {
    it("console.log で stdout に出力される", () => {
      const rt = new NodeRuntime();
      const result = rt.run('console.log("Hello, Node!");');
      expect(result.stdout).toBe("Hello, Node!\n");
    });

    it("複数引数をスペース区切りで出力する", () => {
      const rt = new NodeRuntime();
      const result = rt.run('console.log("a", 1, true);');
      expect(result.stdout).toBe("a 1 true\n");
    });

    it("console.error で stderr に出力される", () => {
      const rt = new NodeRuntime();
      const result = rt.run('console.error("oops");');
      expect(result.stderr).toBe("oops\n");
    });
  });

  describe("タイマー", () => {
    it("setTimeout で遅延実行される", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        console.log("1");
        setTimeout(() => console.log("3"), 0);
        console.log("2");
      `);
      expect(result.stdout).toBe("1\n2\n3\n");
    });

    it("setTimeout の実行順序が正しい", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        setTimeout(() => console.log("b"), 2);
        setTimeout(() => console.log("a"), 1);
      `);
      expect(result.stdout).toBe("a\nb\n");
    });

    it("setInterval で繰り返し実行される", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        let count = 0;
        const id = setInterval(() => {
          count++;
          console.log(count);
          if (count >= 3) clearInterval(id);
        }, 1);
      `);
      expect(result.stdout).toContain("1\n");
      expect(result.stdout).toContain("2\n");
      expect(result.stdout).toContain("3\n");
    });
  });

  describe("process", () => {
    it("process.nextTick が setTimeout より先に実行される", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        setTimeout(() => console.log("timeout"), 0);
        process.nextTick(() => console.log("nextTick"));
      `);
      expect(result.stdout).toBe("nextTick\ntimeout\n");
    });

    it("process.env にアクセスできる", () => {
      const rt = new NodeRuntime();
      const result = rt.run('console.log(process.env.NODE_ENV);');
      expect(result.stdout).toBe("development\n");
    });

    it("process.exit で終了する", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        console.log("before");
        process.exit(42);
        console.log("after");
      `);
      expect(result.stdout).toBe("before\n");
      expect(result.exitCode).toBe(42);
    });
  });

  describe("require (モジュール)", () => {
    it("fs.readFileSync でファイルを読む", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        const fs = require("fs");
        const content = fs.readFileSync("/hello.txt");
        console.log(content.trim());
      `);
      expect(result.stdout).toBe("Hello from virtual FS!\n");
    });

    it("fs.readFile で非同期にファイルを読む", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        const fs = require("fs");
        fs.readFile("/hello.txt", "utf8", (err, data) => {
          console.log(data.trim());
        });
      `);
      expect(result.stdout).toBe("Hello from virtual FS!\n");
    });

    it("fs.writeFileSync + readFileSync で書き込み・読み取り", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        const fs = require("fs");
        fs.writeFileSync("/tmp.txt", "written!");
        console.log(fs.readFileSync("/tmp.txt"));
      `);
      expect(result.stdout).toBe("written!\n");
    });

    it("path.join でパスを結合する", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        const path = require("path");
        console.log(path.join("/home", "user", "file.txt"));
      `);
      expect(result.stdout).toBe("/home/user/file.txt\n");
    });

    it("path.basename, dirname, extname", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        const path = require("path");
        console.log(path.basename("/home/user/doc.txt"));
        console.log(path.dirname("/home/user/doc.txt"));
        console.log(path.extname("/home/user/doc.txt"));
      `);
      expect(result.stdout).toBe("doc.txt\n/home/user\n.txt\n");
    });

    it("EventEmitter が動作する", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        const events = require("events");
        const ee = new events.EventEmitter();
        ee.on("data", function(msg) { console.log("got: " + msg); });
        ee.emit("data", "hello");
      `);
      expect(result.stdout).toBe("got: hello\n");
    });

    it("存在しないモジュールでエラー", () => {
      const rt = new NodeRuntime();
      const result = rt.run('require("nonexistent");');
      expect(result.error).toContain("Cannot find module");
    });
  });

  describe("エラーハンドリング", () => {
    it("構文エラーが報告される", () => {
      const rt = new NodeRuntime();
      const result = rt.run("const x = ;");
      expect(result.error).toBeDefined();
    });

    it("ランタイムエラーが報告される", () => {
      const rt = new NodeRuntime();
      const result = rt.run("undefinedVar.prop;");
      expect(result.error).toBeDefined();
    });
  });

  describe("非同期パターン", () => {
    it("setTimeout のネストが正しく動く", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        setTimeout(() => {
          console.log("first");
          setTimeout(() => {
            console.log("second");
          }, 1);
        }, 1);
      `);
      expect(result.stdout).toBe("first\nsecond\n");
    });

    it("setImmediate と setTimeout(0) が両方実行される", () => {
      const rt = new NodeRuntime();
      const result = rt.run(`
        setTimeout(() => console.log("timeout"), 0);
        setImmediate(() => console.log("immediate"));
      `);
      // 両方実行される（順序はイベントループの実装依存）
      expect(result.stdout).toContain("timeout");
      expect(result.stdout).toContain("immediate");
    });
  });
});
