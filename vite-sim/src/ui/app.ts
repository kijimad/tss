import { VirtualFileSystem } from "../server/vfs.js";
import { ViteDevServer, type ServerEvent } from "../server/dev-server.js";

const SAMPLE_PROJECT: Record<string, string> = {
  "/index.html": `<!DOCTYPE html>
<html>
<head>
  <title>My Vite App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>`,
  "/src/main.ts": `import { App } from './App.ts';
import { greet } from './utils.ts';
import './style.css';

const message: string = greet("Vite");
console.log(message);
App();`,
  "/src/App.ts": `import { Header } from './Header.ts';

export function App(): void {
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = Header() + '<p>Welcome to Vite!</p>';
  }
}`,
  "/src/Header.ts": `export function Header(): string {
  const title: string = "My App";
  return '<h1>' + title + '</h1>';
}`,
  "/src/utils.ts": `export function greet(name: string): string {
  return "Hello, " + name + "!";
}

export function add(a: number, b: number): number {
  return a + b;
}`,
  "/src/style.css": `body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 20px;
  background: #f5f5f5;
}

h1 {
  color: #646cff;
}`,
  "/data.json": `{
  "name": "vite-app",
  "version": "1.0.0"
}`,
};

export class ViteApp {
  private vfs!: VirtualFileSystem;
  private server!: ViteDevServer;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#1b1b1f;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #2e2e32;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Vite Dev Server Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#bd34fe;";
    header.appendChild(title);
    const indicator = document.createElement("span");
    indicator.style.cssText = "font-size:11px;color:#41d1ff;background:#1a1a2e;padding:2px 8px;border-radius:4px;";
    indicator.textContent = "localhost:5173";
    header.appendChild(indicator);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ファイルツリー + エディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:50%;display:flex;flex-direction:column;border-right:1px solid #2e2e32;";

    // ファイルツリー
    const treeDiv = document.createElement("div");
    treeDiv.style.cssText = "max-height:180px;overflow-y:auto;border-bottom:1px solid #2e2e32;font-size:12px;";
    leftPanel.appendChild(treeDiv);

    // エディタ
    const editorLabel = document.createElement("div");
    editorLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#bd34fe;border-bottom:1px solid #2e2e32;";
    editorLabel.textContent = "Editor";
    leftPanel.appendChild(editorLabel);
    const editorArea = document.createElement("textarea");
    editorArea.style.cssText = "flex:1;padding:8px;font-family:monospace;font-size:12px;background:#1b1b1f;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    editorArea.spellcheck = false;
    leftPanel.appendChild(editorArea);

    // 保存ボタン
    const saveRow = document.createElement("div");
    saveRow.style.cssText = "padding:4px 12px;border-top:1px solid #2e2e32;display:flex;gap:8px;";
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save + HMR";
    saveBtn.style.cssText = "padding:3px 12px;background:#bd34fe;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;";
    saveRow.appendChild(saveBtn);
    const reqBtn = document.createElement("button");
    reqBtn.textContent = "Request File";
    reqBtn.style.cssText = "padding:3px 12px;background:#41d1ff;color:#1b1b1f;border:none;border-radius:4px;cursor:pointer;font-size:12px;";
    saveRow.appendChild(reqBtn);
    leftPanel.appendChild(saveRow);

    main.appendChild(leftPanel);

    // 右: レスポンス + 変換ステップ + イベントログ + 依存グラフ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#41d1ff;border-bottom:1px solid #2e2e32;";
    resLabel.textContent = "Transformed Output";
    rightPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:8px;font-family:monospace;font-size:11px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #2e2e32;color:#a0a0b0;";
    rightPanel.appendChild(resDiv);

    const stepsLabel = document.createElement("div");
    stepsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #2e2e32;";
    stepsLabel.textContent = "Transform Pipeline";
    rightPanel.appendChild(stepsLabel);
    const stepsDiv = document.createElement("div");
    stepsDiv.style.cssText = "max-height:120px;overflow-y:auto;font-size:10px;font-family:monospace;border-bottom:1px solid #2e2e32;";
    rightPanel.appendChild(stepsDiv);

    const logLabel = document.createElement("div");
    logLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #2e2e32;";
    logLabel.textContent = "Server Log";
    rightPanel.appendChild(logLabel);
    const logDiv = document.createElement("div");
    logDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // 初期化
    this.vfs = new VirtualFileSystem();
    for (const [path, content] of Object.entries(SAMPLE_PROJECT)) {
      this.vfs.writeFile(path, content);
    }
    this.server = new ViteDevServer(this.vfs);
    this.server.onEvent = (e) => addLog(logDiv, e);
    this.server.start();

    let currentFile = "/src/main.ts";

    // ファイルツリー描画
    const renderTree = () => {
      treeDiv.innerHTML = "";
      for (const file of this.vfs.listFiles()) {
        const row = document.createElement("div");
        const isCurrent = file.path === currentFile;
        row.style.cssText = `padding:3px 12px;cursor:pointer;${isCurrent ? "background:#2e2e32;color:#bd34fe;" : "color:#a0a0b0;"}`;
        const ext = file.path.split(".").pop() ?? "";
        const icons: Record<string, string> = { ts: "TS", js: "JS", css: "CS", html: "HT", json: "JN", tsx: "TX" };
        row.textContent = `${icons[ext] ?? "  "} ${file.path}`;
        row.addEventListener("click", () => {
          currentFile = file.path;
          editorArea.value = file.content;
          editorLabel.textContent = `Editor: ${file.path}`;
          renderTree();
        });
        treeDiv.appendChild(row);
      }
    };
    renderTree();
    editorArea.value = this.vfs.readFile(currentFile) ?? "";
    editorLabel.textContent = `Editor: ${currentFile}`;

    // Save + HMR
    saveBtn.addEventListener("click", () => {
      this.vfs.updateFile(currentFile, editorArea.value);
      const hmr = this.server.handleFileChange(currentFile);
      // 再リクエスト
      const res = this.server.handleRequest({ method: "GET", path: currentFile, headers: {} });
      resDiv.textContent = res.body;
      renderSteps(stepsDiv, res.transformResult?.transforms ?? []);
      renderTree();
    });

    // Request File
    reqBtn.addEventListener("click", () => {
      const res = this.server.handleRequest({ method: "GET", path: currentFile, headers: {} });
      resDiv.textContent = res.body;
      renderSteps(stepsDiv, res.transformResult?.transforms ?? []);
    });

    // 初回リクエスト
    reqBtn.click();
  }
}

function renderSteps(container: HTMLElement, steps: { name: string; description: string }[]): void {
  container.innerHTML = "";
  if (steps.length === 0) {
    container.innerHTML = '<div style="padding:4px 12px;color:#475569;">(no transforms)</div>';
    return;
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) continue;
    const row = document.createElement("div");
    row.style.cssText = "padding:3px 12px;display:flex;gap:8px;border-bottom:1px solid #2e2e3211;";
    const num = document.createElement("span");
    num.style.cssText = "color:#bd34fe;min-width:16px;";
    num.textContent = String(i + 1);
    row.appendChild(num);
    const name = document.createElement("span");
    name.style.cssText = "color:#41d1ff;min-width:120px;";
    name.textContent = step.name;
    row.appendChild(name);
    const desc = document.createElement("span");
    desc.style.cssText = "color:#64748b;";
    desc.textContent = step.description;
    row.appendChild(desc);
    container.appendChild(row);
  }
}

function addLog(container: HTMLElement, event: ServerEvent): void {
  const row = document.createElement("div");
  const colors: Record<string, string> = {
    request: "#41d1ff", transform: "#bd34fe", hmr_update: "#f59e0b",
    hmr_full_reload: "#ef4444", dep_graph_update: "#64748b",
    prebundle: "#10b981", server_start: "#10b981",
  };
  row.style.cssText = `padding:1px 12px;color:${colors[event.type] ?? "#94a3b8"};`;
  row.textContent = formatEvent(event);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function formatEvent(e: ServerEvent): string {
  switch (e.type) {
    case "server_start": return `Server running at http://localhost:${String(e.port)}/`;
    case "prebundle": return `Pre-bundle: ${e.module}`;
    case "request": return `${e.method} ${e.path} [${String(e.status)}] ${e.contentType} (${e.transformTime.toFixed(1)}ms)`;
    case "transform": return `Transform: ${e.path} [${e.steps.join(" -> ")}]`;
    case "hmr_update": return `[HMR] ${e.file} -> boundary: ${e.boundary.join(", ")}`;
    case "hmr_full_reload": return `[HMR] Full reload: ${e.reason}`;
    case "dep_graph_update": return `Dep graph: ${String(e.modules)} modules, ${String(e.edges)} edges`;
  }
}
