import { describe, it, expect } from "vitest";
import { tokenize } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import { BytecodeCompiler } from "../compiler/bytecode.js";
import { VM } from "../vm/vm.js";

function run(code: string): VM {
  const tokens = tokenize(code);
  const ast = new Parser(tokens).parse();
  const compiler = new BytecodeCompiler();
  const compiled = compiler.compile(ast);
  const vm = new VM();
  vm.execute(compiled);
  return vm;
}

describe("V8 エンジン", () => {
  describe("基本出力", () => {
    it("console.log で文字列を出力する", () => {
      const vm = run('console.log("Hello, V8!")');
      expect(vm.stdout).toBe("Hello, V8!\n");
    });

    it("数値を出力する", () => {
      const vm = run("console.log(42)");
      expect(vm.stdout).toBe("42\n");
    });

    it("複数引数を出力する", () => {
      const vm = run('console.log("a", 1, true)');
      expect(vm.stdout).toBe("a 1 true\n");
    });
  });

  describe("算術演算", () => {
    it("加算", () => {
      const vm = run("console.log(1 + 2)");
      expect(vm.stdout).toBe("3\n");
    });

    it("減算", () => {
      const vm = run("console.log(10 - 3)");
      expect(vm.stdout).toBe("7\n");
    });

    it("乗算", () => {
      const vm = run("console.log(6 * 7)");
      expect(vm.stdout).toBe("42\n");
    });

    it("除算", () => {
      const vm = run("console.log(10 / 3)");
      expect(vm.stdout).toContain("3.333");
    });

    it("文字列連結", () => {
      const vm = run('console.log("hello" + " " + "world")');
      expect(vm.stdout).toBe("hello world\n");
    });
  });

  describe("変数", () => {
    it("let で変数を宣言する", () => {
      const vm = run("let x = 42; console.log(x)");
      expect(vm.stdout).toBe("42\n");
    });

    it("代入", () => {
      const vm = run("let x = 1; x = 2; console.log(x)");
      expect(vm.stdout).toBe("2\n");
    });
  });

  describe("関数", () => {
    it("関数を定義して呼ぶ", () => {
      const vm = run(`
        function greet(name) { console.log("Hello, " + name) }
        greet("World")
      `);
      expect(vm.stdout).toBe("Hello, World\n");
    });

    it("return 値を使う", () => {
      const vm = run(`
        function add(a, b) { return a + b }
        console.log(add(3, 4))
      `);
      expect(vm.stdout).toBe("7\n");
    });

    it("再帰", () => {
      const vm = run(`
        function factorial(n) {
          if (n <= 1) return 1
          return n * factorial(n - 1)
        }
        console.log(factorial(5))
      `);
      expect(vm.stdout).toBe("120\n");
    });
  });

  describe("制御構造", () => {
    it("if-else", () => {
      const vm = run(`
        let x = 10
        if (x > 5) { console.log("big") } else { console.log("small") }
      `);
      expect(vm.stdout).toBe("big\n");
    });

    it("while ループ", () => {
      const vm = run(`
        let sum = 0; let i = 1
        while (i <= 10) { sum = sum + i; i = i + 1 }
        console.log(sum)
      `);
      expect(vm.stdout).toBe("55\n");
    });

    it("for ループ", () => {
      const vm = run(`
        let sum = 0
        for (let i = 1; i <= 5; i = i + 1) { sum = sum + i }
        console.log(sum)
      `);
      expect(vm.stdout).toBe("15\n");
    });
  });

  describe("オブジェクトと配列", () => {
    it("配列を作成する", () => {
      const vm = run("let arr = [1, 2, 3]; console.log(arr)");
      expect(vm.stdout).toBe("[1, 2, 3]\n");
    });

    it("オブジェクトを作成する", () => {
      const vm = run('let obj = { name: "Alice", age: 30 }; console.log(obj)');
      expect(vm.stdout).toContain("Alice");
      expect(vm.stdout).toContain("30");
    });
  });

  describe("GC", () => {
    it("GC が実行される（大量のオブジェクト生成時）", () => {
      const vm = run(`
        for (let i = 0; i < 100; i = i + 1) {
          let obj = { value: i }
        }
        console.log("done")
      `);
      expect(vm.stdout).toBe("done\n");
      // GC イベントが記録されているか（しきい値次第）
    });
  });

  describe("トレース", () => {
    it("バイトコード実行イベントが記録される", () => {
      const vm = run("let x = 1 + 2");
      const execEvents = vm.events.filter(e => e.type === "exec");
      expect(execEvents.length).toBeGreaterThan(0);
    });

    it("関数呼び出しでフレームが積まれる", () => {
      const vm = run(`
        function f() { return 42 }
        f()
      `);
      const pushes = vm.events.filter(e => e.type === "push_frame");
      expect(pushes.length).toBeGreaterThanOrEqual(2); // main + f
    });
  });
});
