import { describe, it, expect } from "vitest";
import { tokenize } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import { GoVM } from "../vm/vm.js";

function run(code: string): GoVM {
  const tokens = tokenize(code);
  const ast = new Parser(tokens).parse();
  const vm = new GoVM();
  vm.execute(ast);
  return vm;
}

describe("Go コンパイラ", () => {
  it("Hello World", () => {
    const vm = run(`package main\nfunc main() { println("Hello, Go!") }`);
    expect(vm.stdout).toBe("Hello, Go!\n");
  });

  it("変数と算術", () => {
    const vm = run(`package main\nfunc main() { x := 10; y := 20; println(x + y) }`);
    expect(vm.stdout).toBe("30\n");
  });

  it("if-else", () => {
    const vm = run(`package main\nfunc main() { x := 5; if x > 3 { println("big") } else { println("small") } }`);
    expect(vm.stdout).toBe("big\n");
  });

  it("for ループ", () => {
    const vm = run(`package main
func main() {
  sum := 0
  i := 1
  for i <= 10 {
    sum += i
    i++
  }
  println(sum)
}`);
    expect(vm.stdout).toBe("55\n");
  });

  it("関数と return", () => {
    const vm = run(`package main\nfunc add(a int, b int) int { return a + b }\nfunc main() { println(add(3, 4)) }`);
    expect(vm.stdout).toBe("7\n");
  });

  it("再帰 (factorial)", () => {
    const vm = run(`package main
func factorial(n int) int {
  if n <= 1 { return 1 }
  return n * factorial(n - 1)
}
func main() { println(factorial(5)) }`);
    expect(vm.stdout).toBe("120\n");
  });

  it("スライス", () => {
    const vm = run(`package main
func main() {
  s := []int{1, 2, 3}
  println(len(s))
  s = append(s, 4)
  println(len(s))
}`);
    expect(vm.stdout).toBe("3\n4\n");
  });

  it("for range", () => {
    const vm = run(`package main
func main() {
  nums := []int{10, 20, 30}
  for _, v := range nums {
    println(v)
  }
}`);
    expect(vm.stdout).toBe("10\n20\n30\n");
  });

  it("goroutine", () => {
    const vm = run(`package main
func say(msg string) { println(msg) }
func main() {
  go say("hello from goroutine")
  println("main")
}`);
    expect(vm.stdout).toContain("hello from goroutine");
    expect(vm.stdout).toContain("main");
  });

  it("チャネル", () => {
    const vm = run(`package main
func main() {
  ch := make(chan int)
  go func() { ch <- 42 }()
  v := <-ch
  println(v)
}`);
    expect(vm.stdout).toBe("42\n");
  });

  it("defer", () => {
    const vm = run(`package main
func greet(msg string) {
  println(msg)
}
func main() {
  println("start")
  defer greet("deferred")
  println("end")
}`);
    expect(vm.stdout).toBe("start\nend\ndeferred\n");
  });

  it("switch", () => {
    const vm = run(`package main
func main() {
  x := 2
  switch x {
  case 1:
    println("one")
  case 2:
    println("two")
  default:
    println("other")
  }
}`);
    expect(vm.stdout).toBe("two\n");
  });

  it("文字列連結", () => {
    const vm = run(`package main\nfunc main() { println("Hello, " + "World!") }`);
    expect(vm.stdout).toBe("Hello, World!\n");
  });

  it("FizzBuzz", () => {
    const vm = run(`package main
func main() {
  for i := 1; i <= 15; i++ {
    if i % 15 == 0 { println("FizzBuzz") } else if i % 3 == 0 { println("Fizz") } else if i % 5 == 0 { println("Buzz") } else { println(i) }
  }
}`);
    const lines = vm.stdout.trim().split("\n");
    expect(lines).toHaveLength(15);
    expect(lines[2]).toBe("Fizz");
    expect(lines[4]).toBe("Buzz");
    expect(lines[14]).toBe("FizzBuzz");
  });
});
