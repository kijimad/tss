import { buildRegistry } from "../registry/registry.js";
import { DependencyResolver } from "../resolver/resolver.js";
import type { NpmEvent, ResolvedPackage, InstalledPackage } from "../registry/types.js";

const EXAMPLES: { name: string; deps: Record<string, string> }[] = [
  { name: "express only", deps: { "express": "^4.18.0" } },
  { name: "express + lodash", deps: { "express": "^4.18.0", "lodash": "^4.17.0" } },
  { name: "express + axios + lodash", deps: { "express": "^4.18.0", "axios": "^1.6.0", "lodash": "^4.17.0" } },
  { name: "axios only", deps: { "axios": "^1.6.0" } },
  { name: "lodash only", deps: { "lodash": "^4.17.0" } },
  { name: "pinned versions", deps: { "express": "4.18.2", "debug": "2.6.9" } },
];

export class NpmApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "npm install simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#cb3837;";
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

    const installBtn = document.createElement("button");
    installBtn.textContent = "npm install";
    installBtn.style.cssText = "padding:4px 16px;background:#cb3837;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(installBtn);
    container.appendChild(header);

    // メイン
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: package.json + 依存ツリー
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow:hidden;";

    // package.json エディタ
    const jsonLabel = document.createElement("div");
    jsonLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#cb3837;border-bottom:1px solid #1e293b;";
    jsonLabel.textContent = "package.json";
    leftPanel.appendChild(jsonLabel);

    const jsonArea = document.createElement("textarea");
    jsonArea.style.cssText = "height:120px;padding:8px;font-family:monospace;font-size:12px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;border-bottom:1px solid #1e293b;";
    jsonArea.spellcheck = false;
    leftPanel.appendChild(jsonArea);

    // 依存ツリー
    const treeLabel = document.createElement("div");
    treeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22d3ee;border-bottom:1px solid #1e293b;";
    treeLabel.textContent = "Dependency Tree";
    leftPanel.appendChild(treeLabel);

    const treeDiv = document.createElement("div");
    treeDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:11px;overflow-y:auto;";
    leftPanel.appendChild(treeDiv);

    main.appendChild(leftPanel);

    // 右: node_modules + イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:380px;display:flex;flex-direction:column;overflow:hidden;";

    // node_modules
    const nmLabel = document.createElement("div");
    nmLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    nmLabel.textContent = "node_modules/";
    rightPanel.appendChild(nmLabel);

    const nmDiv = document.createElement("div");
    nmDiv.style.cssText = "max-height:200px;padding:4px 12px;font-family:monospace;font-size:11px;overflow-y:auto;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(nmDiv);

    // イベントログ
    const logLabel = document.createElement("div");
    logLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    logLabel.textContent = "npm install log";
    rightPanel.appendChild(logLabel);

    const logDiv = document.createElement("div");
    logDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // 初期表示
    const updateJson = () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex === undefined) return;
      const pkg = { name: "my-app", version: "1.0.0", dependencies: ex.deps };
      jsonArea.value = JSON.stringify(pkg, null, 2);
    };
    select.addEventListener("change", updateJson);
    updateJson();

    installBtn.addEventListener("click", () => {
      treeDiv.innerHTML = "";
      nmDiv.innerHTML = "";
      logDiv.innerHTML = "";

      let deps: Record<string, string>;
      try {
        const pkg = JSON.parse(jsonArea.value);
        deps = pkg.dependencies ?? {};
      } catch {
        logDiv.textContent = "Invalid package.json";
        return;
      }

      const reg = buildRegistry();
      const resolver = new DependencyResolver(reg);

      // イベントをリアルタイム表示
      resolver.onEvent = (event) => addLogEntry(logDiv, event);

      // 解決
      const resolved = resolver.resolve(deps);
      // フラット化
      const installed = resolver.flatten(resolved);
      // ロックファイル
      const lockfile = resolver.generateLockfile(resolved);

      // 依存ツリー表示
      renderTree(treeDiv, resolved);

      // node_modules 表示
      renderNodeModules(nmDiv, installed);

      // サマリー
      const totalSize = installed.reduce((sum, p) => sum + p.size, 0);
      const summary = document.createElement("div");
      summary.style.cssText = "padding:8px 12px;font-size:12px;color:#10b981;border-top:1px solid #1e293b;";
      summary.textContent = `added ${String(installed.length)} packages (${formatSize(totalSize)}) | lockfile: ${String(Object.keys(lockfile).length)} entries`;
      logDiv.appendChild(summary);
    });
  }
}

function renderTree(container: HTMLElement, packages: ResolvedPackage[], indent = 0): void {
  for (const pkg of packages) {
    const row = document.createElement("div");
    row.style.cssText = `padding:1px 0;color:${indent === 0 ? "#22d3ee" : "#94a3b8"};`;
    const prefix = indent === 0 ? "" : "  ".repeat(indent) + "\u251C\u2500 ";
    row.textContent = `${prefix}${pkg.name}@${pkg.version}`;
    container.appendChild(row);

    if (pkg.dependencies.length > 0) {
      renderTree(container, pkg.dependencies, indent + 1);
    }
  }
}

function renderNodeModules(container: HTMLElement, packages: InstalledPackage[]): void {
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  for (const pkg of sorted) {
    const row = document.createElement("div");
    row.style.cssText = "padding:1px 0;display:flex;gap:8px;";

    const nameSpan = document.createElement("span");
    nameSpan.style.cssText = "color:#e2e8f0;min-width:180px;";
    nameSpan.textContent = pkg.name;
    row.appendChild(nameSpan);

    const verSpan = document.createElement("span");
    verSpan.style.cssText = "color:#64748b;min-width:60px;";
    verSpan.textContent = pkg.version;
    row.appendChild(verSpan);

    const sizeSpan = document.createElement("span");
    sizeSpan.style.cssText = "color:#475569;";
    sizeSpan.textContent = formatSize(pkg.size);
    row.appendChild(sizeSpan);

    container.appendChild(row);
  }
}

function addLogEntry(container: HTMLElement, event: NpmEvent): void {
  const row = document.createElement("div");
  row.style.cssText = `padding:1px 12px;color:${eventColor(event)};`;
  row.textContent = formatEvent(event);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function eventColor(event: NpmEvent): string {
  switch (event.type) {
    case "registry_fetch": return "#64748b";
    case "registry_response": return "#3b82f6";
    case "version_resolve": return "#22d3ee";
    case "dependency_found": return "#94a3b8";
    case "download_start": return "#f59e0b";
    case "download_complete": return "#10b981";
    case "install": return "#10b981";
    case "conflict": return "#ef4444";
    case "dedupe": return "#8b5cf6";
    case "lockfile_write": return "#f59e0b";
    case "complete": return "#10b981";
  }
}

function formatEvent(event: NpmEvent): string {
  switch (event.type) {
    case "registry_fetch": return `GET /${event.package}`;
    case "registry_response": return `  200 OK (${String(event.versions)} versions)`;
    case "version_resolve": return `  resolve ${event.package} ${event.range} -> ${event.resolved}`;
    case "dependency_found": return `  ${"  ".repeat(event.depth)}dep: ${event.parent} -> ${event.child}@${event.range}`;
    case "download_start": return `  download ${event.package}@${event.version} (${formatSize(event.size)})`;
    case "download_complete": return `  downloaded ${event.package}@${event.version}`;
    case "install": return `  + ${event.package}@${event.version} -> ${event.path}`;
    case "conflict": return `  WARN ${event.package}: ${event.existing} vs ${event.requested}`;
    case "dedupe": return `  dedupe ${event.package}@${event.version}`;
    case "lockfile_write": return `wrote package-lock.json (${String(event.packages)} entries)`;
    case "complete": return `added ${String(event.installed)} packages (${formatSize(event.totalSize)})`;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
