import { tokenize } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import { GoVM, type VmEvent } from "../vm/vm.js";

const EXAMPLES: { name: string; code: string }[] = [
  { name: "Hello World", code: `package main

func main() {
	println("Hello, Go!")
}` },
  { name: "Variables + Arithmetic", code: `package main

func main() {
	x := 10
	y := 20
	println(x + y)
	println(x * y)
}` },
  { name: "FizzBuzz", code: `package main

func main() {
	for i := 1; i <= 20; i++ {
		if i % 15 == 0 {
			println("FizzBuzz")
		} else if i % 3 == 0 {
			println("Fizz")
		} else if i % 5 == 0 {
			println("Buzz")
		} else {
			println(i)
		}
	}
}` },
  { name: "Factorial (recursion)", code: `package main

func factorial(n int) int {
	if n <= 1 {
		return 1
	}
	return n * factorial(n - 1)
}

func main() {
	println(factorial(10))
}` },
  { name: "Fibonacci", code: `package main

func fib(n int) int {
	if n <= 1 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

func main() {
	for i := 0; i <= 10; i++ {
		println(fib(i))
	}
}` },
  { name: "Slice + for-range", code: `package main

func main() {
	nums := []int{10, 20, 30, 40, 50}
	sum := 0
	for _, v := range nums {
		sum += v
	}
	println("sum:", sum)
	println("len:", len(nums))
	nums = append(nums, 60)
	println("after append len:", len(nums))
}` },
  { name: "Goroutine + Channel", code: `package main

func worker(id int, ch chan int) {
	result := id * 10
	ch <- result
}

func main() {
	ch := make(chan int)
	go worker(1, ch)
	go worker(2, ch)
	go worker(3, ch)
	println(<-ch)
	println(<-ch)
	println(<-ch)
}` },
  { name: "Defer", code: `package main

func greet(msg string) {
	println(msg)
}

func main() {
	println("start")
	defer greet("third (deferred)")
	defer greet("second (deferred)")
	println("end")
}` },
  { name: "Switch", code: `package main

func dayName(d int) string {
	switch d {
	case 1:
		return "Monday"
	case 2:
		return "Tuesday"
	case 3:
		return "Wednesday"
	default:
		return "Unknown"
	}
}

func main() {
	println(dayName(1))
	println(dayName(2))
	println(dayName(5))
}` },
  { name: "Higher-order function", code: `package main

func apply(f func(int) int, x int) int {
	return f(x)
}

func double(n int) int {
	return n * 2
}

func main() {
	println(apply(double, 21))
}` },
];

export class GoApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Go Compiler + VM";
    title.style.cssText = "margin:0;font-size:15px;color:#00ADD8;";
    header.appendChild(title);

    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    EXAMPLES.forEach((ex, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = ex.name; select.appendChild(o); });
    header.appendChild(select);

    const runBtn = document.createElement("button");
    runBtn.textContent = "go run";
    runBtn.style.cssText = "padding:4px 16px;background:#00ADD8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#00ADD8;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "main.go";
    leftPanel.appendChild(codeLabel);
    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:8px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:4;";
    codeArea.spellcheck = false;
    codeArea.value = EXAMPLES[0]?.code ?? "";
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const outLabel = document.createElement("div");
    outLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "Output";
    rightPanel.appendChild(outLabel);
    const outDiv = document.createElement("div");
    outDiv.style.cssText = "flex:1;padding:8px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;color:#6ee7b7;background:#022c22;";
    rightPanel.appendChild(outDiv);

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Runtime Events";
    rightPanel.appendChild(traceLabel);
    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    select.addEventListener("change", () => { codeArea.value = EXAMPLES[Number(select.value)]?.code ?? ""; });

    runBtn.addEventListener("click", () => {
      outDiv.textContent = ""; traceDiv.innerHTML = "";
      try {
        const tokens = tokenize(codeArea.value);
        const ast = new Parser(tokens).parse();
        const vm = new GoVM();
        vm.execute(ast);
        outDiv.textContent = vm.stdout || "(no output)";
        for (const event of vm.events) {
          const row = document.createElement("div");
          row.style.cssText = `padding:1px 12px;color:${evColor(event)};`;
          row.textContent = evFormat(event);
          traceDiv.appendChild(row);
        }
      } catch (e) {
        outDiv.style.color = "#f87171";
        outDiv.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
    runBtn.click();
  }
}

function evColor(e: VmEvent): string {
  switch (e.type) { case "stdout": return "#10b981"; case "goroutine_create": return "#00ADD8"; case "goroutine_done": return "#64748b"; case "chan_send": return "#f59e0b"; case "chan_recv": return "#3b82f6"; case "defer_exec": return "#a78bfa"; default: return "#475569"; }
}
function evFormat(e: VmEvent): string {
  switch (e.type) { case "stdout": return `>>> ${e.text.replace(/\n$/, "")}`; case "goroutine_create": return `goroutine ${String(e.id)}: ${e.name} started`; case "goroutine_done": return `goroutine ${String(e.id)}: done`; case "chan_send": return `chan <- ${e.value} (goroutine ${String(e.goroutine)})`; case "chan_recv": return `<-chan = ${e.value} (goroutine ${String(e.goroutine)})`; case "defer_exec": return `defer: ${e.func}`; case "exec": return `  ${e.stmt}`; default: return ""; }
}
