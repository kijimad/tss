import { tokenize } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import { BytecodeCompiler, OP_NAMES } from "../compiler/bytecode.js";
import { VM, type VmEvent } from "../vm/vm.js";

const EXAMPLES: { name: string; code: string }[] = [
  { name: "Hello World", code: 'console.log("Hello, V8!")' },
  { name: "Arithmetic", code: "console.log(2 + 3 * 4)\nconsole.log(10 / 3)\nconsole.log(17 % 5)" },
  { name: "Variables", code: 'let x = 10\nlet y = 20\nlet z = x + y\nconsole.log("x + y =", z)' },
  { name: "Function", code: 'function greet(name) {\n  return "Hello, " + name + "!"\n}\nconsole.log(greet("World"))' },
  { name: "Factorial (recursion)", code: "function factorial(n) {\n  if (n <= 1) return 1\n  return n * factorial(n - 1)\n}\nconsole.log(factorial(10))" },
  { name: "While loop (1..10 sum)", code: "let sum = 0\nlet i = 1\nwhile (i <= 10) {\n  sum = sum + i\n  i = i + 1\n}\nconsole.log(sum)" },
  { name: "For loop (FizzBuzz)", code: 'for (let i = 1; i <= 20; i = i + 1) {\n  if (i % 15 === 0) { console.log("FizzBuzz") }\n  else if (i % 3 === 0) { console.log("Fizz") }\n  else if (i % 5 === 0) { console.log("Buzz") }\n  else { console.log(i) }\n}' },
  { name: "Array + Object", code: 'let arr = [1, 2, 3]\nconsole.log(arr)\nlet obj = { name: "Alice", age: 30 }\nconsole.log(obj)' },
  { name: "Higher-order function", code: "function apply(f, x) { return f(x) }\nfunction double(n) { return n * 2 }\nconsole.log(apply(double, 21))" },
  { name: "Math built-in", code: "console.log(Math.floor(3.7))\nconsole.log(Math.ceil(3.2))\nconsole.log(Math.abs(-42))\nconsole.log(Math.max(1, 5, 3))" },
];

export class V8App {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "V8 JavaScript Engine";
    title.style.cssText = "margin:0;font-size:15px;color:#4fc3f7;";
    header.appendChild(title);

    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    EXAMPLES.forEach((ex, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = ex.name; select.appendChild(o); });
    header.appendChild(select);

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#4fc3f7;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左上: コード / 左下: バイトコード
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#4fc3f7;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "Source Code";
    leftPanel.appendChild(codeLabel);
    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:8px;font-family:monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;border-bottom:1px solid #1e293b;";
    codeArea.spellcheck = false;
    codeArea.value = EXAMPLES[0]?.code ?? "";
    leftPanel.appendChild(codeArea);

    const bcLabel = document.createElement("div");
    bcLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    bcLabel.textContent = "Bytecode (Ignition)";
    leftPanel.appendChild(bcLabel);
    const bcDiv = document.createElement("div");
    bcDiv.style.cssText = "flex:1;padding:8px;font-family:monospace;font-size:10px;overflow-y:auto;color:#94a3b8;";
    leftPanel.appendChild(bcDiv);

    main.appendChild(leftPanel);

    // 右: stdout + VM trace + heap
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    const outLabel = document.createElement("div");
    outLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "stdout";
    rightPanel.appendChild(outLabel);
    const outDiv = document.createElement("div");
    outDiv.style.cssText = "min-height:80px;padding:8px;font-family:monospace;font-size:13px;white-space:pre-wrap;border-bottom:1px solid #1e293b;color:#6ee7b7;background:#022c22;overflow-y:auto;";
    rightPanel.appendChild(outDiv);

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "VM Execution Trace";
    rightPanel.appendChild(traceLabel);
    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;";
    rightPanel.appendChild(traceDiv);

    const heapLabel = document.createElement("div");
    heapLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    heapLabel.textContent = "Heap / GC";
    rightPanel.appendChild(heapLabel);
    const heapDiv = document.createElement("div");
    heapDiv.style.cssText = "padding:8px;font-size:11px;border-top:1px solid #1e293b;color:#94a3b8;";
    rightPanel.appendChild(heapDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    select.addEventListener("change", () => { codeArea.value = EXAMPLES[Number(select.value)]?.code ?? ""; });

    runBtn.addEventListener("click", () => {
      bcDiv.innerHTML = "";
      outDiv.textContent = "";
      traceDiv.innerHTML = "";
      heapDiv.innerHTML = "";

      try {
        // パイプライン: Source → Tokens → AST → Bytecode → VM
        const tokens = tokenize(codeArea.value);
        const ast = new Parser(tokens).parse();
        const compiler = new BytecodeCompiler();
        const compiled = compiler.compile(ast);

        // バイトコード表示
        const renderFunc = (name: string, instrs: { op: number; operands: number[] }[], consts: unknown[]) => {
          const funcHeader = document.createElement("div");
          funcHeader.style.cssText = "color:#f59e0b;margin-top:4px;font-weight:bold;";
          funcHeader.textContent = `--- ${name} ---`;
          bcDiv.appendChild(funcHeader);
          instrs.forEach((instr, i) => {
            const row = document.createElement("div");
            row.style.cssText = "color:#94a3b8;";
            const opName = OP_NAMES[instr.op] ?? `0x${instr.op.toString(16)}`;
            const ops = instr.operands.map(o => {
              if (opName.includes("Const") || opName.includes("Global") || opName.includes("Property") || opName.includes("Closure")) {
                const c = consts[o];
                if (typeof c === "object" && c !== null && "name" in c) return `[${String((c as { name: string }).name)}]`;
                return `[${JSON.stringify(c)?.slice(0, 20) ?? String(o)}]`;
              }
              return `r${String(o)}`;
            }).join(", ");
            row.textContent = `  ${String(i).padStart(4)} ${opName.padEnd(16)} ${ops}`;
            bcDiv.appendChild(row);
          });
        };

        renderFunc("<main>", compiled.instructions, compiled.constants);
        for (const fn of compiler.getCompiledFunctions()) {
          renderFunc(fn.name, fn.instructions, fn.constants);
        }

        // VM 実行
        const vm = new VM();
        vm.execute(compiled);

        outDiv.textContent = vm.stdout || "(no output)";

        // トレース
        for (const event of vm.events) {
          const row = document.createElement("div");
          row.style.cssText = `padding:1px 12px;color:${eventColor(event)};`;
          row.textContent = formatEvent(event);
          traceDiv.appendChild(row);
        }

        // ヒープ情報
        const heap = vm.getHeapInfo();
        heapDiv.textContent = `Objects: ${String(heap.objectCount)} | Heap size: ${String(heap.totalSize)}B | Cycles: ${String(vm.cycles)}`;

        const gcEvents = vm.events.filter(e => e.type === "gc_sweep");
        if (gcEvents.length > 0) {
          heapDiv.textContent += ` | GC runs: ${String(gcEvents.length)}`;
        }
      } catch (e) {
        outDiv.style.color = "#f87171";
        outDiv.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    });

    runBtn.click();
  }
}

function eventColor(e: VmEvent): string {
  switch (e.type) {
    case "exec": return "#64748b";
    case "push_frame": return "#a78bfa";
    case "pop_frame": return "#818cf8";
    case "gc_start": return "#f59e0b";
    case "gc_mark": return "#eab308";
    case "gc_sweep": return "#22c55e";
    case "heap_alloc": return "#475569";
    case "stdout": return "#10b981";
  }
}

function formatEvent(e: VmEvent): string {
  switch (e.type) {
    case "exec": return `  ${String(e.pc).padStart(4)} ${e.op.padEnd(16)} ${e.detail}`;
    case "push_frame": return `>>> CALL ${e.func}`;
    case "pop_frame": return `<<< RET  ${e.func}`;
    case "gc_start": return `[GC] start (heap: ${String(e.heapSize)}B, ${String(e.objectCount)} objects)`;
    case "gc_mark": return `[GC] marked ${String(e.marked)} objects`;
    case "gc_sweep": return `[GC] swept ${String(e.freed)} objects, ${String(e.remaining)} remaining`;
    case "heap_alloc": return `  heap: alloc ${e.kind} (${String(e.size)}B)`;
    case "stdout": return `  >>> ${e.text.replace(/\n$/, "")}`;
  }
}
