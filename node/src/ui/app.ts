import { NodeRuntime } from "../runtime/node-runtime.js";
import type { LoopEvent } from "../runtime/event-loop.js";

const EXAMPLES: { name: string; code: string }[] = [
  {
    name: "Hello World",
    code: `console.log("Hello, Node.js!");`,
  },
  {
    name: "setTimeout の実行順序",
    code: `console.log("1: sync");
setTimeout(() => console.log("3: timeout 0ms"), 0);
console.log("2: sync");
// 同期コードが先に全部実行され、その後にタイマーが発火する`,
  },
  {
    name: "nextTick vs setTimeout vs setImmediate",
    code: `setTimeout(() => console.log("setTimeout"), 0);
setImmediate(() => console.log("setImmediate"));
process.nextTick(() => console.log("nextTick"));
queueMicrotask(() => console.log("microtask"));
console.log("sync");
// 順序: sync → nextTick → microtask → timers/check`,
  },
  {
    name: "fs.readFile (非同期I/O)",
    code: `const fs = require("fs");
console.log("reading file...");
fs.readFile("/hello.txt", "utf8", (err, data) => {
  if (err) { console.error(err.message); return; }
  console.log("content:", data.trim());
});
console.log("readFile called (callback is pending)");`,
  },
  {
    name: "fs.readFileSync (同期I/O)",
    code: `const fs = require("fs");
const content = fs.readFileSync("/data.json");
const data = JSON.parse(content);
console.log("name:", data.name);
console.log("version:", data.version);`,
  },
  {
    name: "setInterval + clearInterval",
    code: `let count = 0;
const id = setInterval(() => {
  count++;
  console.log("tick", count);
  if (count >= 5) {
    clearInterval(id);
    console.log("done!");
  }
}, 1);`,
  },
  {
    name: "EventEmitter",
    code: `const events = require("events");
const emitter = new events.EventEmitter();

emitter.on("data", function(chunk) {
  console.log("received:", chunk);
});

emitter.on("end", function() {
  console.log("stream ended");
});

emitter.emit("data", "chunk1");
emitter.emit("data", "chunk2");
emitter.emit("end");`,
  },
  {
    name: "path モジュール",
    code: `const path = require("path");
console.log("join:", path.join("/home", "user", "docs", "file.txt"));
console.log("basename:", path.basename("/home/user/docs/file.txt"));
console.log("dirname:", path.dirname("/home/user/docs/file.txt"));
console.log("extname:", path.extname("photo.jpg"));`,
  },
  {
    name: "process オブジェクト",
    code: `console.log("pid:", process.pid);
console.log("platform:", process.platform);
console.log("version:", process.version);
console.log("cwd:", process.cwd());
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("argv:", process.argv);`,
  },
  {
    name: "fs.writeFile + readFile",
    code: `const fs = require("fs");
fs.writeFile("/output.txt", "Hello from writeFile!", (err) => {
  if (err) { console.error(err); return; }
  console.log("file written!");
  fs.readFile("/output.txt", "utf8", (err2, data) => {
    if (err2) { console.error(err2); return; }
    console.log("read back:", data);
  });
});`,
  },
  {
    name: "ネストした setTimeout",
    code: `console.log("start");
setTimeout(() => {
  console.log("outer timeout");
  setTimeout(() => {
    console.log("inner timeout");
    setTimeout(() => {
      console.log("deepest timeout");
    }, 1);
  }, 1);
}, 1);
console.log("end (sync)");`,
  },
];

export class NodeApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Node.js Runtime Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#68d391;";
    header.appendChild(title);

    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#68d391;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    // メイン
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: コードエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "JavaScript (Node.js)";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    codeArea.value = EXAMPLES[0]?.code ?? "";
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右: 出力 + イベントループ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // stdout
    const outLabel = document.createElement("div");
    outLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "stdout / stderr";
    rightPanel.appendChild(outLabel);

    const outputDiv = document.createElement("div");
    outputDiv.style.cssText = "flex:1;padding:12px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(outputDiv);

    // イベントループトレース
    const loopLabel = document.createElement("div");
    loopLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    loopLabel.textContent = "Event Loop Trace";
    rightPanel.appendChild(loopLabel);

    const loopDiv = document.createElement("div");
    loopDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(loopDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // 実行
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) codeArea.value = ex.code;
    });

    runBtn.addEventListener("click", () => {
      outputDiv.innerHTML = "";
      loopDiv.innerHTML = "";

      const rt = new NodeRuntime();
      const result = rt.run(codeArea.value);

      // stdout
      if (result.stdout) {
        const stdoutEl = document.createElement("span");
        stdoutEl.style.color = "#e2e8f0";
        stdoutEl.textContent = result.stdout;
        outputDiv.appendChild(stdoutEl);
      }
      if (result.stderr) {
        const stderrEl = document.createElement("span");
        stderrEl.style.color = "#f87171";
        stderrEl.textContent = result.stderr;
        outputDiv.appendChild(stderrEl);
      }
      if (result.error !== undefined) {
        const errEl = document.createElement("div");
        errEl.style.cssText = "color:#f87171;margin-top:4px;";
        errEl.textContent = `Error: ${result.error}`;
        outputDiv.appendChild(errEl);
      }

      // 実行情報
      const infoEl = document.createElement("div");
      infoEl.style.cssText = "color:#64748b;margin-top:8px;font-size:11px;border-top:1px solid #1e293b;padding-top:4px;";
      infoEl.textContent = `Exit code: ${String(result.exitCode)} | Loop ticks: ${String(result.loopTicks)} | Events: ${String(result.loopEvents.length)}`;
      outputDiv.appendChild(infoEl);

      // イベントループトレース
      for (const event of result.loopEvents) {
        const row = document.createElement("div");
        row.style.cssText = `padding:1px 0;color:${eventColor(event)};`;
        row.textContent = formatLoopEvent(event);
        loopDiv.appendChild(row);
      }
    });

    // 初回実行
    runBtn.click();
  }
}

function eventColor(event: LoopEvent): string {
  switch (event.type) {
    case "phase_enter": return "#475569";
    case "timer_fire": return "#f59e0b";
    case "timer_register": return "#64748b";
    case "timer_cancel": return "#ef4444";
    case "io_callback": return "#3b82f6";
    case "immediate_fire": return "#8b5cf6";
    case "nexttick": return "#ec4899";
    case "microtask": return "#06b6d4";
    case "tick_complete": return "#334155";
    case "loop_idle": return "#475569";
    case "loop_exit": return "#64748b";
  }
}

function formatLoopEvent(event: LoopEvent): string {
  switch (event.type) {
    case "phase_enter": return `  [${event.phase}]`;
    case "timer_fire": return `    TIMER #${String(event.timerId)} fired (delay=${String(event.delay)}ms)`;
    case "timer_register": return `    timer #${String(event.timerId)} registered (${event.interval ? "interval" : "timeout"} ${String(event.delay)}ms)`;
    case "timer_cancel": return `    timer #${String(event.timerId)} cancelled`;
    case "io_callback": return `    I/O: ${event.description}`;
    case "immediate_fire": return `    setImmediate fired`;
    case "nexttick": return `    process.nextTick`;
    case "microtask": return `    microtask (Promise)`;
    case "tick_complete": return `--- tick ${String(event.tickNumber)} ---`;
    case "loop_idle": return `  (idle)`;
    case "loop_exit": return `  === loop exit ===`;
  }
}
