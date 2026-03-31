import { DockerEngine, type EngineEvent, type Container, ContainerState } from "../engine/engine.js";
import type { BuildEvent } from "../image/image.js";

/** サンプルコマンドの例 */
export interface Example {
  /** 表示名 */
  name: string;
  /** 順番に自動実行するコマンド一覧 */
  commands: string[];
}

/** セレクトボックスに表示するサンプル例の配列 */
export const EXAMPLES: Example[] = [
  {
    name: "イメージ取得 + 実行",
    commands: ["docker pull ubuntu:22.04", "docker run --name my-ubuntu ubuntu:22.04"],
  },
  {
    name: "ポートマッピング",
    commands: ["docker pull nginx:latest", "docker run --name web-server -p 8080:80 nginx:latest"],
  },
  {
    name: "環境変数の設定",
    commands: [
      "docker pull node:20",
      "docker run --name app-server -e NODE_ENV=production -e PORT=3000 node:20",
    ],
  },
  {
    name: "コンテナ管理",
    commands: [
      "docker pull ubuntu:22.04",
      "docker run --name temp-container ubuntu:22.04",
      "docker ps -a",
      "docker stop temp-container",
      "docker rm temp-container",
      "docker ps -a",
    ],
  },
  {
    name: "Dockerfile ビルド",
    commands: ["docker build -t node-app", "docker images"],
  },
];

export class DockerApp {
  private engine!: DockerEngine;
  private termDiv!: HTMLElement;
  private containersDiv!: HTMLElement;
  private eventsDiv!: HTMLElement;
  private inputLine = "";
  private history: string[] = [];
  private historyIdx = -1;
  private currentInputSpan: HTMLSpanElement | null = null;
  private currentCursor: HTMLSpanElement | null = null;
  private currentPromptLine: HTMLDivElement | null = null;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Cascadia Code',monospace;background:#0c0c0c;color:#e0e0e0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;background:#1a1a2e;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333;";
    const dots = document.createElement("div"); dots.style.cssText = "display:flex;gap:6px;";
    for (const c of ["#ff5f56", "#ffbd2e", "#27c93f"]) { const d = document.createElement("div"); d.style.cssText = `width:10px;height:10px;border-radius:50%;background:${c};`; dots.appendChild(d); }
    header.appendChild(dots);
    const t = document.createElement("span"); t.textContent = "Docker Engine"; t.style.cssText = "color:#2496ED;font-size:12px;font-weight:600;"; header.appendChild(t);

    // サンプル例を選択するドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText =
      "margin-left:auto;padding:2px 8px;font-size:11px;background:#0c0c0c;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;outline:none;";
    // デフォルトの選択肢
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- サンプルを選択 --";
    exampleSelect.appendChild(defaultOpt);
    // 各サンプル例をオプションとして追加
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exampleSelect.appendChild(opt);
    }
    // 選択変更時にサンプルコマンドを順番に自動実行
    exampleSelect.addEventListener("change", () => {
      const idx = Number(exampleSelect.value);
      if (!Number.isNaN(idx) && EXAMPLES[idx] !== undefined) {
        this.runExample(EXAMPLES[idx]!);
      }
      // セレクトをデフォルトに戻す
      exampleSelect.value = "";
    });
    header.appendChild(exampleSelect);

    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    this.termDiv = document.createElement("div");
    this.termDiv.style.cssText = "flex:1;padding:12px;overflow-y:auto;font-size:13px;line-height:1.6;cursor:text;outline:none;";
    this.termDiv.tabIndex = 0;
    main.appendChild(this.termDiv);

    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width:340px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";
    const cTitle = document.createElement("div"); cTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#2496ED;border-bottom:1px solid #333;"; cTitle.textContent = "Containers"; sidebar.appendChild(cTitle);
    this.containersDiv = document.createElement("div"); this.containersDiv.style.cssText = "max-height:200px;overflow-y:auto;font-size:10px;border-bottom:1px solid #333;"; sidebar.appendChild(this.containersDiv);
    const eTitle = document.createElement("div"); eTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #333;"; eTitle.textContent = "Engine Events"; sidebar.appendChild(eTitle);
    this.eventsDiv = document.createElement("div"); this.eventsDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;"; sidebar.appendChild(this.eventsDiv);
    main.appendChild(sidebar);
    container.appendChild(main);

    const style = document.createElement("style"); style.textContent = "@keyframes blink { 50% { opacity: 0; } }"; document.head.appendChild(style);

    this.engine = new DockerEngine();
    this.engine.onEvent = (e) => this.addEvent(e);

    this.appendText("Docker Engine Simulator\n");
    this.appendText("Type 'help' for commands.\n\n");
    this.showPrompt();
    this.updateContainers();

    this.termDiv.addEventListener("keydown", (e) => this.handleKey(e));
    this.termDiv.focus();
    this.termDiv.addEventListener("click", () => this.termDiv.focus());
  }

  /** 入力スパンにコマンドを設定し、次の行に進める */
  private setInputAndAdvance(cmd: string): void {
    if (this.currentInputSpan !== null) {
      this.currentInputSpan.textContent = cmd;
    }
    this.currentCursor?.remove();
    this.termDiv.appendChild(document.createElement("br"));
    this.currentInputSpan = null;
    this.currentPromptLine = null;
  }

  /** サンプル例のコマンドを順番に自動実行する */
  private runExample(example: Example): void {
    // ターミナルをクリア
    this.termDiv.innerHTML = "";
    this.currentInputSpan = null;
    this.currentCursor = null;
    this.currentPromptLine = null;

    this.appendText(`--- ${example.name} ---\n\n`, "#2496ED");

    // 各コマンドを順番に実行
    for (const cmd of example.commands) {
      this.showPrompt();
      // showPrompt() が currentInputSpan と currentCursor を再設定する
      this.setInputAndAdvance(cmd);

      // 履歴に追加
      this.history.push(cmd);
      this.historyIdx = this.history.length;

      this.execute(cmd);
      this.updateContainers();
    }

    // 最後に新しいプロンプトを表示
    this.showPrompt();
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
    this.termDiv.focus();
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.isComposing) return; e.preventDefault(); e.stopPropagation();
    if (e.key === "Enter") {
      this.currentCursor?.remove(); this.termDiv.appendChild(document.createElement("br"));
      const cmd = this.inputLine; this.inputLine = ""; this.currentInputSpan = null; this.currentPromptLine = null;
      if (cmd.trim()) { this.history.push(cmd); this.historyIdx = this.history.length; }
      this.execute(cmd.trim()); this.updateContainers(); this.showPrompt(); return;
    }
    if (e.key === "Backspace") { if (this.inputLine.length > 0) { this.inputLine = this.inputLine.slice(0, -1); this.updateInput(); } return; }
    if (e.key === "ArrowUp") { if (this.historyIdx > 0) { this.historyIdx--; this.inputLine = this.history[this.historyIdx] ?? ""; this.updateInput(); } return; }
    if (e.key === "ArrowDown") { if (this.historyIdx < this.history.length - 1) { this.historyIdx++; this.inputLine = this.history[this.historyIdx] ?? ""; } else { this.historyIdx = this.history.length; this.inputLine = ""; } this.updateInput(); return; }
    if (e.ctrlKey && e.key === "l") { this.termDiv.innerHTML = ""; this.showPrompt(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { this.inputLine += e.key; this.updateInput(); }
  }

  private execute(input: string): void {
    if (!input) return;
    const args = input.split(/\s+/);
    if (args[0] !== "docker") { if (args[0] === "help") { this.showHelp(); return; } if (args[0] === "clear") { this.termDiv.innerHTML = ""; return; } this.appendText(`command not found: ${args[0] ?? ""}\n`); return; }
    const sub = args[1]; const rest = args.slice(2);

    switch (sub) {
      case "pull": { const img = rest[0] ?? "ubuntu"; const [name, tag] = img.split(":"); this.engine.pull(name ?? img, tag ?? "latest"); this.appendText(`Pulled ${name ?? img}:${tag ?? "latest"}\n`); break; }
      case "build": {
        const name = rest.find(a => a.startsWith("-t"))?.replace("-t", "").replace("=", "") ?? rest[rest.indexOf("-t") + 1] ?? "my-app";
        const dockerfile = SAMPLE_DOCKERFILES[name] ?? SAMPLE_DOCKERFILES["node-app"] ?? "";
        const ctx = SAMPLE_CONTEXTS[name] ?? new Map();
        const { buildEvents } = this.engine.build(dockerfile, ctx, name, "latest");
        for (const e of buildEvents) this.appendText(`${e.step}: ${e.command} ${e.detail}\n`, e.type === "complete" ? "#10b981" : "#94a3b8");
        break;
      }
      case "run": {
        const img = rest.find(a => !a.startsWith("-")) ?? "ubuntu:22.04";
        const name = rest.includes("--name") ? rest[rest.indexOf("--name") + 1] : undefined;
        const portArg = rest.includes("-p") ? rest[rest.indexOf("-p") + 1] : undefined;
        const ports: { container: number; host: number }[] = [];
        if (portArg !== undefined) { const [h, c] = portArg.split(":"); ports.push({ host: Number(h), container: Number(c) }); }
        const envArgs: Record<string, string> = {};
        for (let i = 0; i < rest.length; i++) { if (rest[i] === "-e" && rest[i + 1] !== undefined) { const [k, v] = (rest[i + 1] ?? "").split("="); envArgs[k ?? ""] = v ?? ""; } }
        const c = this.engine.run(img, { name, ports, env: envArgs });
        this.appendText(`${c.id} (${c.name})\n`, "#10b981");
        break;
      }
      case "exec": {
        const id = rest[0] ?? "";
        const command = rest.slice(1).join(" ");
        const containers = this.engine.ps(true);
        const c = containers.find(c => c.id === id || c.name === id || c.id.startsWith(id));
        if (c === undefined) { this.appendText(`Error: container not found: ${id}\n`); break; }
        const output = this.engine.exec(c.id, command);
        this.appendText(output);
        break;
      }
      case "ps": {
        const all = rest.includes("-a");
        const containers = this.engine.ps(all);
        this.appendText("CONTAINER ID   NAME                IMAGE              STATUS\n", "#64748b");
        for (const c of containers) {
          const color = c.state === ContainerState.Running ? "#10b981" : "#94a3b8";
          this.appendText(`${c.id.slice(0, 12).padEnd(15)}${c.name.padEnd(20)}${c.image.padEnd(19)}${c.state}\n`, color);
        }
        break;
      }
      case "stop": {
        const id = rest[0] ?? "";
        const containers = this.engine.ps(true);
        const c = containers.find(c => c.id === id || c.name === id || c.id.startsWith(id));
        if (c !== undefined) { this.engine.stop(c.id); this.appendText(`Stopped ${c.id}\n`); }
        else this.appendText(`Error: ${id} not found\n`);
        break;
      }
      case "rm": {
        const id = rest[0] ?? "";
        const containers = this.engine.ps(true);
        const c = containers.find(c => c.id === id || c.name === id || c.id.startsWith(id));
        if (c !== undefined) { this.engine.rm(c.id); this.appendText(`Removed ${c.id}\n`); }
        else this.appendText(`Error: ${id} not found\n`);
        break;
      }
      case "images": {
        const images = this.engine.listImages();
        this.appendText("REPOSITORY         TAG       LAYERS  SIZE\n", "#64748b");
        for (const img of images) {
          const size = img.layers.reduce((s, l) => s + l.size, 0);
          this.appendText(`${img.name.padEnd(19)}${img.tag.padEnd(10)}${String(img.layers.length).padEnd(8)}${String(size)}B\n`);
        }
        break;
      }
      case "inspect": {
        const id = rest[0] ?? "";
        const containers = this.engine.ps(true);
        const c = containers.find(c => c.id === id || c.name === id || c.id.startsWith(id));
        if (c === undefined) { this.appendText(`Error: ${id} not found\n`); break; }
        this.appendText(`ID:        ${c.id}\n`);
        this.appendText(`Name:      ${c.name}\n`);
        this.appendText(`Image:     ${c.image}\n`);
        this.appendText(`State:     ${c.state}\n`);
        this.appendText(`PID:       ${String(c.pid)}\n`);
        this.appendText(`Hostname:  ${c.hostname}\n`);
        this.appendText(`IP:        ${c.ipAddress}\n`);
        this.appendText(`Ports:     ${c.ports.map(p => `${String(p.host)}:${String(p.container)}`).join(", ") || "none"}\n`);
        this.appendText(`Workdir:   ${c.workdir}\n`);
        this.appendText(`CMD:       ${c.cmd.join(" ")}\n`);
        this.appendText(`Layers:    ${String(c.readonlyLayers.length)} readonly + 1 writable\n`);
        this.appendText(`Memory:    ${String(c.memoryUsage)}B used\n`);
        break;
      }
      default: this.appendText(`docker: '${sub ?? ""}' is not a docker command\n`);
    }
  }

  private showHelp(): void {
    this.appendText("Docker commands:\n");
    for (const [c, d] of [
      ["docker pull <image>", "Pull an image"],
      ["docker build -t <name>", "Build from Dockerfile (node-app, python-app, nginx-app)"],
      ["docker run <image>", "Create and start a container"],
      ["  --name <name>", "Container name"],
      ["  -p <host>:<container>", "Port mapping"],
      ["  -e KEY=VALUE", "Environment variable"],
      ["docker exec <id> <cmd>", "Run command in container"],
      ["docker ps [-a]", "List containers"],
      ["docker stop <id>", "Stop a container"],
      ["docker rm <id>", "Remove a container"],
      ["docker images", "List images"],
      ["docker inspect <id>", "Container details"],
    ]) { this.appendText(`  ${(c ?? "").padEnd(32)}`, "#2496ED"); this.appendText(`${d}\n`, "#64748b"); }
    this.appendText("\nContainer exec commands: echo, cat, ls, pwd, hostname, env, whoami, ps, ip\n", "#64748b");
  }

  private showPrompt(): void {
    const line = document.createElement("div"); line.style.cssText = "display:flex;white-space:pre;";
    const ps = document.createElement("span"); ps.style.cssText = "color:#2496ED;"; ps.textContent = "$ ";
    line.appendChild(ps);
    const inp = document.createElement("span"); line.appendChild(inp);
    const cur = document.createElement("span"); cur.style.cssText = "background:#e0e0e0;color:#0c0c0c;animation:blink 1s step-end infinite;"; cur.textContent = "\u00A0";
    line.appendChild(cur);
    this.termDiv.appendChild(line);
    this.currentPromptLine = line; this.currentInputSpan = inp; this.currentCursor = cur; this.inputLine = "";
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private updateInput(): void { if (this.currentInputSpan) this.currentInputSpan.textContent = this.inputLine; this.termDiv.scrollTop = this.termDiv.scrollHeight; }

  private appendText(text: string, color = "#e0e0e0"): void {
    const span = document.createElement("span"); span.style.cssText = `white-space:pre-wrap;color:${color};`; span.textContent = text;
    if (this.currentPromptLine) this.termDiv.insertBefore(span, this.currentPromptLine);
    else this.termDiv.appendChild(span);
    this.termDiv.scrollTop = this.termDiv.scrollHeight;
  }

  private updateContainers(): void {
    this.containersDiv.innerHTML = "";
    for (const c of this.engine.ps(true)) {
      const row = document.createElement("div");
      const color = c.state === "running" ? "#10b981" : c.state === "stopped" ? "#f59e0b" : "#64748b";
      row.style.cssText = `padding:3px 12px;color:${color};display:flex;gap:8px;border-bottom:1px solid #1e293b11;`;
      row.innerHTML = `<span style="min-width:70px">${c.id.slice(0, 8)}</span><span style="min-width:90px">${c.name.slice(0, 12)}</span><span style="color:#64748b">${c.state}</span><span style="color:#475569">${c.ipAddress}</span>`;
      this.containersDiv.appendChild(row);
    }
    if (this.engine.ps(true).length === 0) {
      this.containersDiv.innerHTML = '<div style="padding:8px 12px;color:#475569">(no containers)</div>';
    }
  }

  private addEvent(event: EngineEvent): void {
    const row = document.createElement("div");
    const colors: Record<string, string> = {
      container_create: "#2496ED", container_start: "#10b981", container_stop: "#f59e0b",
      container_rm: "#ef4444", container_exec: "#94a3b8", namespace_create: "#a78bfa",
      cgroup_set: "#f59e0b", network_connect: "#06b6d4", port_map: "#3b82f6",
      layer_mount: "#8b5cf6", image_pull: "#2496ED", image_build: "#2496ED",
      stdout: "#64748b",
    };
    row.style.cssText = `padding:1px 12px;color:${colors[event.type] ?? "#94a3b8"};`;
    row.textContent = formatEvent(event);
    this.eventsDiv.appendChild(row);
    this.eventsDiv.scrollTop = this.eventsDiv.scrollHeight;
  }
}

function formatEvent(e: EngineEvent): string {
  switch (e.type) {
    case "image_pull": return `pull ${e.name}`;
    case "image_build": return `build ${e.name} (${String(e.layers)} layers)`;
    case "container_create": return `create ${e.id.slice(0, 8)} ${e.name} (${e.image})`;
    case "container_start": return `start ${e.name}`;
    case "container_stop": return `stop ${e.name}`;
    case "container_rm": return `rm ${e.name}`;
    case "container_exec": return `exec ${e.id.slice(0, 8)}: ${e.command}`;
    case "namespace_create": return `  ns:${e.nsType} ${e.detail}`;
    case "cgroup_set": return `  cgroup:${e.resource} limit=${e.limit}`;
    case "network_connect": return `  net: ${e.ip} -> ${e.bridge}`;
    case "port_map": return `  port: ${String(e.host)}:${String(e.container)}`;
    case "layer_mount": return `  mount: ${String(e.layers)} layers (${e.mode})`;
    case "stdout": return `  > ${e.text.trimEnd()}`;
  }
}

const SAMPLE_DOCKERFILES: Record<string, string> = {
  "node-app": `FROM node:20
WORKDIR /app
COPY package.json /app/package.json
RUN npm install
COPY server.js /app/server.js
EXPOSE 3000
CMD ["node", "server.js"]`,
  "python-app": `FROM python:3.12
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt
COPY app.py /app/app.py
EXPOSE 8000
CMD ["python3", "app.py"]`,
  "nginx-app": `FROM nginx:latest
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`,
};

const SAMPLE_CONTEXTS: Record<string, Map<string, string>> = {
  "node-app": new Map([
    ["package.json", '{"name":"my-app","version":"1.0.0","dependencies":{"express":"^4.18.0"}}'],
    ["server.js", "const express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.send('Hello!'));\napp.listen(3000);"],
  ]),
  "python-app": new Map([
    ["requirements.txt", "flask==3.0.0\nrequests==2.31.0"],
    ["app.py", "from flask import Flask\napp = Flask(__name__)\n@app.route('/')\ndef hello(): return 'Hello!'\napp.run(port=8000)"],
  ]),
  "nginx-app": new Map([
    ["index.html", "<!DOCTYPE html><html><body><h1>Hello from Docker!</h1></body></html>"],
  ]),
};
