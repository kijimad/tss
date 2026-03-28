import { ClassBuilder, u16 } from "../classfile/builder.js";
import { OpCode, AccessFlag } from "../classfile/types.js";
import { JvmRuntime, type JvmEvent } from "../runtime/runtime.js";
import { step, run } from "../interpreter/interpreter.js";

const EXAMPLES: { name: string; build: () => ClassBuilder }[] = [
  {
    name: "Hello World",
    build: () => {
      const b = new ClassBuilder("HelloWorld");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(Ljava/lang/String;)V");
      const sysOut = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      const helloStr = b.addStringRef("Hello, JVM!");
      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOut), OpCode.ldc, helloStr, OpCode.invokevirtual, ...u16(printRef), OpCode.return,
      ]);
      return b;
    },
  },
  {
    name: "1 + 2 + ... + 10 = 55",
    build: () => {
      const b = new ClassBuilder("Sum");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOut = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 3, [
        OpCode.iconst_0, OpCode.istore_1, OpCode.iconst_1, OpCode.istore_2,
        OpCode.iload_2, OpCode.bipush, 10, OpCode.if_icmpgt, ...u16(21 - 7),
        OpCode.iload_1, OpCode.iload_2, OpCode.iadd, OpCode.istore_1,
        OpCode.iinc, 2, 1,
        OpCode.goto, ...s16(4 - 17),
        OpCode.getstatic, ...u16(sysOut), OpCode.iload_1, OpCode.invokevirtual, ...u16(printRef), OpCode.return,
      ]);
      return b;
    },
  },
  {
    name: "Factorial(5) = 120",
    build: () => {
      const b = new ClassBuilder("Factorial");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOut = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      const factRef = b.addMethodRef("Factorial", "factorial", "(I)I");
      b.addMethod("factorial", "(I)I", AccessFlag.Public | AccessFlag.Static, 4, 1, [
        OpCode.iload_0, OpCode.iconst_1, OpCode.if_icmpgt, ...u16(8 - 2),
        OpCode.iconst_1, OpCode.ireturn,
        OpCode.nop,
        OpCode.iload_0, OpCode.iload_0, OpCode.iconst_1, OpCode.isub,
        OpCode.invokestatic, ...u16(factRef), OpCode.imul, OpCode.ireturn,
      ]);
      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOut), OpCode.bipush, 5,
        OpCode.invokestatic, ...u16(factRef), OpCode.invokevirtual, ...u16(printRef), OpCode.return,
      ]);
      return b;
    },
  },
  {
    name: "FizzBuzz (1-20)",
    build: () => {
      const b = new ClassBuilder("FizzBuzz");
      const printlnI = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const printlnS = b.addMethodRef("java/io/PrintStream", "println", "(Ljava/lang/String;)V");
      const sysOut = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      const fizzStr = b.addStringRef("Fizz");
      const buzzStr = b.addStringRef("Buzz");
      const fbStr = b.addStringRef("FizzBuzz");
      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 2, [
        OpCode.iconst_1, OpCode.istore_1,
        // loop: (pc=2)
        OpCode.iload_1, OpCode.bipush, 20, OpCode.if_icmpgt, ...u16(62 - 6), // goto end
        // if i%15==0
        OpCode.iload_1, OpCode.bipush, 15, OpCode.irem,
        OpCode.ifne, ...u16(23 - 13), // goto check3
        OpCode.getstatic, ...u16(sysOut), OpCode.ldc, fbStr, OpCode.invokevirtual, ...u16(printlnS),
        OpCode.goto, ...u16(56 - 23), // goto inc
        // check3: if i%3==0 (pc=23)
        OpCode.iload_1, OpCode.iconst_3, OpCode.irem,
        OpCode.ifne, ...u16(36 - 28), // goto check5
        OpCode.getstatic, ...u16(sysOut), OpCode.ldc, fizzStr, OpCode.invokevirtual, ...u16(printlnS),
        OpCode.goto, ...u16(56 - 36), // goto inc
        // check5: if i%5==0 (pc=36)
        OpCode.iload_1, OpCode.iconst_5, OpCode.irem,
        OpCode.ifne, ...u16(49 - 41), // goto printNum
        OpCode.getstatic, ...u16(sysOut), OpCode.ldc, buzzStr, OpCode.invokevirtual, ...u16(printlnS),
        OpCode.goto, ...u16(56 - 49), // goto inc
        // printNum (pc=49)
        OpCode.getstatic, ...u16(sysOut), OpCode.iload_1, OpCode.invokevirtual, ...u16(printlnI),
        // inc (pc=56)
        OpCode.iinc, 1, 1,
        OpCode.goto, ...s16(2 - 59), // goto loop
        // end (pc=62)
        OpCode.return,
      ]);
      return b;
    },
  },
];

function s16(offset: number): [number, number] {
  const v = offset & 0xffff;
  return [(v >> 8) & 0xff, v & 0xff];
}

export class JvmApp {
  private rt!: JvmRuntime;
  private logDiv!: HTMLElement;
  private stdoutDiv!: HTMLElement;
  private stackDiv!: HTMLElement;
  private localsDiv!: HTMLElement;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:10px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "JVM Bytecode Interpreter";
    title.style.cssText = "margin:0;font-size:16px;color:#f8fafc;";
    header.appendChild(title);

    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:13px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const ex = EXAMPLES[i];
      if (ex === undefined) continue;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = ex.name;
      select.appendChild(opt);
    }
    header.appendChild(select);

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:5px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
    header.appendChild(runBtn);

    const stepBtn = document.createElement("button");
    stepBtn.textContent = "Step";
    stepBtn.style.cssText = "padding:5px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
    header.appendChild(stepBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.style.cssText = "padding:5px 16px;background:#475569;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
    header.appendChild(resetBtn);

    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: バイトコード + 実行ログ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const logTitle = document.createElement("div");
    logTitle.style.cssText = "padding:6px 12px;font-size:12px;font-weight:600;color:#94a3b8;border-bottom:1px solid #1e293b;";
    logTitle.textContent = "Execution Trace";
    leftPanel.appendChild(logTitle);

    this.logDiv = document.createElement("div");
    this.logDiv.style.cssText = "flex:1;overflow-y:auto;font-size:11px;font-family:monospace;";
    leftPanel.appendChild(this.logDiv);

    main.appendChild(leftPanel);

    // 右: stdout + stack + locals
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:300px;display:flex;flex-direction:column;border-left:1px solid #1e293b;";

    // stdout
    const outTitle = document.createElement("div");
    outTitle.style.cssText = "padding:6px 12px;font-size:12px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    outTitle.textContent = "System.out";
    rightPanel.appendChild(outTitle);
    this.stdoutDiv = document.createElement("div");
    this.stdoutDiv.style.cssText = "padding:8px 12px;font-family:monospace;font-size:13px;min-height:80px;white-space:pre-wrap;border-bottom:1px solid #1e293b;color:#6ee7b7;background:#022c22;";
    rightPanel.appendChild(this.stdoutDiv);

    // operand stack
    const stackTitle = document.createElement("div");
    stackTitle.style.cssText = "padding:6px 12px;font-size:12px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    stackTitle.textContent = "Operand Stack";
    rightPanel.appendChild(stackTitle);
    this.stackDiv = document.createElement("div");
    this.stackDiv.style.cssText = "padding:8px 12px;font-family:monospace;font-size:12px;min-height:60px;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(this.stackDiv);

    // locals
    const localsTitle = document.createElement("div");
    localsTitle.style.cssText = "padding:6px 12px;font-size:12px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    localsTitle.textContent = "Local Variables";
    rightPanel.appendChild(localsTitle);
    this.localsDiv = document.createElement("div");
    this.localsDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:12px;overflow-y:auto;";
    rightPanel.appendChild(this.localsDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // セットアップ
    this.rt = new JvmRuntime();
    this.loadExample(0);

    select.addEventListener("change", () => this.loadExample(Number(select.value)));
    runBtn.addEventListener("click", () => this.runAll());
    stepBtn.addEventListener("click", () => this.stepOne());
    resetBtn.addEventListener("click", () => this.loadExample(Number(select.value)));
  }

  private loadExample(index: number): void {
    const ex = EXAMPLES[index];
    if (ex === undefined) return;

    this.rt.reset();
    this.logDiv.innerHTML = "";
    this.stdoutDiv.textContent = "";
    this.stackDiv.innerHTML = "";
    this.localsDiv.innerHTML = "";

    const builder = ex.build();
    const classFile = builder.build();
    this.rt.loadClass(classFile);
    const cls = this.rt.classes.get(classFile.thisClass);
    if (cls === undefined) return;
    const main = cls.methods.find(m => m.name === "main");
    if (main === undefined) return;
    this.rt.invokeMethod(cls, main, [null]);

    this.addLog(`Loaded: ${classFile.thisClass}.main`, "#94a3b8");
    this.updateState();
  }

  private runAll(): void {
    this.rt.events = [];
    run(this.rt, 10000);
    for (const event of this.rt.events) {
      this.renderEvent(event);
    }
    this.stdoutDiv.textContent = this.rt.stdout;
    this.updateState();
  }

  private stepOne(): void {
    const eventsBefore = this.rt.events.length;
    const cont = step(this.rt);
    // 新しいイベントを表示
    for (let i = eventsBefore; i < this.rt.events.length; i++) {
      const ev = this.rt.events[i];
      if (ev !== undefined) this.renderEvent(ev);
    }
    this.stdoutDiv.textContent = this.rt.stdout;
    this.updateState();
    if (!cont) {
      this.addLog("--- HALT ---", "#ef4444");
    }
  }

  private renderEvent(event: JvmEvent): void {
    switch (event.type) {
      case "exec":
        this.addLog(`  ${String(event.pc).padStart(4)} ${event.opName.padEnd(16)} ${event.detail}`, "#94a3b8");
        break;
      case "push":
        this.addLog(`    push ${event.value}`, "#f59e0b");
        break;
      case "pop":
        this.addLog(`    pop  ${event.value}`, "#f97316");
        break;
      case "invoke":
        this.addLog(`INVOKE ${event.className}.${event.methodName}${event.descriptor}`, "#a78bfa");
        break;
      case "return":
        this.addLog(`RETURN ${event.value}`, "#818cf8");
        break;
      case "stdout":
        this.addLog(`>>> ${event.text.replace(/\n$/, "")}`, "#10b981");
        break;
      case "local_set":
        this.addLog(`    local[${String(event.index)}] = ${event.value}`, "#3b82f6");
        break;
      case "local_get":
        this.addLog(`    local[${String(event.index)}] -> ${event.value}`, "#60a5fa");
        break;
    }
  }

  private updateState(): void {
    const frame = this.rt.currentFrame();
    // Stack
    this.stackDiv.innerHTML = "";
    if (frame !== undefined) {
      for (let i = frame.operandStack.length - 1; i >= 0; i--) {
        const el = document.createElement("div");
        el.style.cssText = "padding:2px 0;border-bottom:1px solid #1e293b;color:#fbbf24;";
        el.textContent = `[${String(i)}] ${this.rt.valueToString(frame.operandStack[i] ?? null)}`;
        this.stackDiv.appendChild(el);
      }
      if (frame.operandStack.length === 0) {
        this.stackDiv.textContent = "(empty)";
        this.stackDiv.style.color = "#475569";
      }
    }
    // Locals
    this.localsDiv.innerHTML = "";
    if (frame !== undefined) {
      for (let i = 0; i < frame.localVariables.length; i++) {
        const v = frame.localVariables[i];
        if (v === null && i > 0) continue; // 未使用スロットはスキップ(0はargsなので表示)
        const el = document.createElement("div");
        el.style.cssText = "padding:2px 0;color:#93c5fd;";
        el.textContent = `[${String(i)}] ${this.rt.valueToString(v ?? null)}`;
        this.localsDiv.appendChild(el);
      }
    }
  }

  private addLog(text: string, color: string): void {
    const row = document.createElement("div");
    row.style.cssText = `padding:1px 12px;color:${color};`;
    row.textContent = text;
    this.logDiv.appendChild(row);
    this.logDiv.scrollTop = this.logDiv.scrollHeight;
  }
}
