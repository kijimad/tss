import { runSimulation } from "../procmgr/engine.js";
import { presets } from "../procmgr/presets.js";
import type { SimulationResult, Process, ProcessGroup, Session, Cgroup, Namespace } from "../procmgr/types.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** プロセス状態の色 */
function stateColor(state: string): string {
  const c: Record<string, string> = {
    running: "#4ade80", sleeping: "#60a5fa", disk_sleep: "#f97316",
    stopped: "#fbbf24", zombie: "#ef4444", dead: "#64748b",
  };
  return c[state] ?? "#94a3b8";
}

/** イベントタイプ別の色 */
function eventColor(type: string): string {
  const c: Record<string, string> = {
    fork: "#4ade80", exec: "#60a5fa", exit: "#ef4444", kill: "#f97316",
    waitpid: "#818cf8", zombie: "#f43f5e", reap: "#84cc16", orphan: "#e879f9",
    pgid: "#38bdf8", session: "#a78bfa", tty: "#22d3ee",
    job_control: "#fbbf24", daemon: "#fb923c",
    cgroup: "#f472b6", namespace: "#6ee7b7",
    process_table: "#94a3b8", info: "#64748b", error: "#ef4444",
  };
  return c[type] ?? "#94a3b8";
}

/** プロセスツリーを構築 */
function renderProcessTree(result: SimulationResult): string {
  const alive = result.processes.filter((p) => p.state !== "dead");
  if (alive.length === 0) return "";

  function buildTree(pid: number, depth: number): string {
    const proc = alive.find((p) => p.pid === pid);
    if (!proc) return "";
    const children = alive.filter((p) => p.ppid === pid && p.pid !== pid);
    const prefix = depth === 0 ? "" : "│  ".repeat(depth - 1) + "├─ ";
    const stateIcon = proc.state === "running" ? "●" : proc.state === "zombie" ? "☠" :
      proc.state === "stopped" ? "◼" : proc.state === "sleeping" ? "◎" : "○";
    const line = `<span class="tree-line"><span class="tree-prefix">${prefix}</span><span class="tree-icon" style="color:${stateColor(proc.state)}">${stateIcon}</span> <span class="tree-pid">PID ${proc.pid}</span> <span class="tree-name">${escapeHtml(proc.name)}</span><span class="tree-meta"> PGID=${proc.pgid} SID=${proc.sid}${proc.tty ? ` TTY=${proc.tty}` : ""}${proc.state !== "running" ? ` [${proc.state}]` : ""}</span></span>`;
    const childrenHtml = children.map((c) => buildTree(c.pid, depth + 1)).join("");
    return line + childrenHtml;
  }

  // ルート (PID 0 の子 = init, kthreadd、および ppid=0 のプロセス)
  const roots = alive.filter((p) => p.ppid === 0 || !alive.find((pp) => pp.pid === p.ppid && pp.pid !== p.pid));
  const treeHtml = roots.map((r) => buildTree(r.pid, 0)).join("");

  return `
    <div class="panel">
      <h3>プロセスツリー</h3>
      <div class="tree">${treeHtml}</div>
    </div>`;
}

/** プロセステーブル */
function renderProcessTable(result: SimulationResult): string {
  const alive = result.processes.filter((p) => p.state !== "dead");
  if (alive.length === 0) return "";

  return `
    <div class="panel">
      <h3>プロセステーブル (${alive.length})</h3>
      <div class="table-wrap">
        <table class="proc-table">
          <thead>
            <tr><th>PID</th><th>PPID</th><th>PGID</th><th>SID</th><th>STATE</th><th>NAME</th><th>TTY</th><th>CGROUP</th></tr>
          </thead>
          <tbody>
            ${alive.map((p) => `
              <tr>
                <td class="pid">${p.pid}</td>
                <td>${p.ppid}</td>
                <td>${p.pgid}</td>
                <td>${p.sid}</td>
                <td><span class="state-badge" style="background:${stateColor(p.state)}">${p.state}</span></td>
                <td class="proc-name">${escapeHtml(p.name)}${p.isDaemon ? " 🜲" : ""}${p.isSessionLeader ? " ★" : ""}${p.isGroupLeader ? " ◆" : ""}</td>
                <td>${p.tty ?? "-"}</td>
                <td>${p.cgroup ?? "-"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

/** プロセスグループ表示 */
function renderGroups(result: SimulationResult): string {
  const activeGroups = result.groups.filter((g) => g.members.some((m) => {
    const p = result.processes.find((pp) => pp.pid === m);
    return p && p.state !== "dead";
  }));
  if (activeGroups.length === 0) return "";

  return `
    <div class="panel">
      <h3>プロセスグループ (${activeGroups.length})</h3>
      <div class="groups">
        ${activeGroups.map((g: ProcessGroup) => {
          const members = g.members
            .map((m) => result.processes.find((p) => p.pid === m))
            .filter((p): p is Process => !!p && p.state !== "dead");
          return `
            <div class="group-card ${g.isForeground ? "fg" : "bg"}">
              <div class="group-header">
                <span class="group-pgid">PGID=${g.pgid}</span>
                <span class="group-type">${g.isForeground ? "FG" : "BG"}</span>
                <span class="group-session">SID=${g.sessionId}</span>
              </div>
              <div class="group-members">
                ${members.map((p) => `<span class="member" style="border-color:${stateColor(p.state)}">${p.pid} ${escapeHtml(p.name)}</span>`).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

/** セッション表示 */
function renderSessions(result: SimulationResult): string {
  if (result.sessions.length === 0) return "";

  return `
    <div class="panel">
      <h3>セッション (${result.sessions.length})</h3>
      <div class="sessions">
        ${result.sessions.map((s: Session) => `
          <div class="session-card">
            <div class="session-header">
              <span class="session-sid">SID=${s.sid}</span>
              <span class="session-tty">${s.controllingTty ?? "(no tty)"}</span>
              ${s.foregroundPgid ? `<span class="session-fg">FG: PGID=${s.foregroundPgid}</span>` : ""}
            </div>
            <div class="session-groups">
              ${s.groups.map((gid) => `<span class="session-group">PGID=${gid}</span>`).join("")}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

/** cgroup 表示 */
function renderCgroups(result: SimulationResult): string {
  if (result.cgroups.length === 0) return "";

  return `
    <div class="panel">
      <h3>cgroups (${result.cgroups.length})</h3>
      <div class="cgroups">
        ${result.cgroups.map((cg: Cgroup) => `
          <div class="cgroup-card">
            <div class="cgroup-header">
              <span class="cgroup-path">${escapeHtml(cg.path)}</span>
            </div>
            <div class="cgroup-limits">
              ${cg.cpuLimit ? `<span class="cgroup-limit">CPU: ${cg.cpuLimit}%</span>` : ""}
              ${cg.memoryLimit ? `<span class="cgroup-limit">MEM: ${cg.memoryLimit}KB</span>` : ""}
              ${cg.pidsMax ? `<span class="cgroup-limit">PIDs: max ${cg.pidsMax}</span>` : ""}
            </div>
            <div class="cgroup-members">
              ${cg.members.map((pid) => {
                const p = result.processes.find((pp) => pp.pid === pid);
                return `<span class="member">${pid} ${p ? escapeHtml(p.name) : "?"}</span>`;
              }).join("")}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

/** 名前空間表示 */
function renderNamespaces(result: SimulationResult): string {
  if (result.namespaces.length === 0) return "";

  const nsTypeColor: Record<string, string> = {
    pid: "#4ade80", net: "#60a5fa", mnt: "#e879f9", uts: "#fbbf24",
  };

  return `
    <div class="panel">
      <h3>名前空間 (${result.namespaces.length})</h3>
      <div class="namespaces">
        ${result.namespaces.map((ns: Namespace) => `
          <div class="ns-card" style="border-color:${nsTypeColor[ns.type] ?? "#94a3b8"}">
            <span class="ns-type" style="color:${nsTypeColor[ns.type] ?? "#94a3b8"}">${ns.type.toUpperCase()}</span>
            <span class="ns-id">[${ns.id}]</span>
            <span class="ns-members">${ns.members.map((pid) => `PID ${pid}`).join(", ")}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

/** 統計 */
function renderStats(result: SimulationResult): string {
  const s = result.stats;
  return `
    <div class="panel">
      <h3>統計</h3>
      <div class="stats-grid">
        <div class="stat"><span class="stat-val">${s.forked}</span><span class="stat-label">fork</span></div>
        <div class="stat"><span class="stat-val">${s.exited}</span><span class="stat-label">exit</span></div>
        <div class="stat"><span class="stat-val">${s.zombies}</span><span class="stat-label">zombie</span></div>
        <div class="stat"><span class="stat-val">${s.reaped}</span><span class="stat-label">reap</span></div>
        <div class="stat"><span class="stat-val">${s.orphansAdopted}</span><span class="stat-label">孤児</span></div>
        <div class="stat"><span class="stat-val">${s.signalsSent}</span><span class="stat-label">signal</span></div>
        <div class="stat"><span class="stat-val">${s.sessionsCreated}</span><span class="stat-label">session</span></div>
        <div class="stat"><span class="stat-val">${s.groupsCreated}</span><span class="stat-label">group</span></div>
        <div class="stat"><span class="stat-val">${s.daemonized}</span><span class="stat-label">daemon</span></div>
      </div>
    </div>`;
}

/** イベントログ */
function renderEvents(result: SimulationResult): string {
  return `
    <div class="panel">
      <h3>イベントログ (${result.events.length})</h3>
      <div class="event-list">
        ${result.events.map((e) => `
          <div class="event">
            <span class="event-step">${e.step}</span>
            <span class="event-type" style="background:${eventColor(e.type)}">${e.type}</span>
            <span class="event-desc">${escapeHtml(e.description)}</span>
            ${e.detail ? `<div class="event-detail">${escapeHtml(e.detail)}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

function render(result: SimulationResult): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="grid">
      <div class="col-left">
        ${renderStats(result)}
        ${renderProcessTree(result)}
        ${renderProcessTable(result)}
        ${renderGroups(result)}
        ${renderSessions(result)}
        ${renderCgroups(result)}
        ${renderNamespaces(result)}
      </div>
      <div class="col-right">
        ${renderEvents(result)}
      </div>
    </div>`;
}

function main(): void {
  document.title = "Unix プロセス管理 シミュレーター";
  document.body.innerHTML = `
    <div id="header">
      <h1>Unix プロセス管理 シミュレーター</h1>
      <p>fork / exec / exit / wait — プロセスグループ, セッション, ジョブ制御, cgroup, 名前空間</p>
      <select id="preset"></select>
    </div>
    <div id="app"></div>`;

  const style = document.createElement("style");
  style.textContent = `
    :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 13px; }
    #header { padding: 16px 24px; border-bottom: 1px solid var(--border); }
    #header h1 { font-size: 18px; margin-bottom: 4px; }
    #header p { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
    select { background: var(--surface); color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 4px; font-size: 13px; font-family: inherit; width: 100%; max-width: 600px; }
    #app { padding: 16px 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 1200px) { .grid { grid-template-columns: 1fr; } }
    .col-left, .col-right { display: flex; flex-direction: column; gap: 16px; }
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .panel h3 { font-size: 14px; margin-bottom: 10px; color: #60a5fa; }

    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat { text-align: center; padding: 6px; background: rgba(96,165,250,0.08); border-radius: 6px; }
    .stat-val { display: block; font-size: 18px; font-weight: bold; color: #60a5fa; }
    .stat-label { display: block; font-size: 10px; color: var(--muted); }

    .tree { font-size: 12px; line-height: 1.8; white-space: pre; }
    .tree-line { display: block; }
    .tree-prefix { color: var(--border); }
    .tree-icon { font-size: 10px; }
    .tree-pid { color: #fbbf24; font-weight: bold; }
    .tree-name { color: var(--text); }
    .tree-meta { color: var(--muted); font-size: 11px; }

    .table-wrap { overflow-x: auto; }
    .proc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .proc-table th { text-align: left; padding: 4px 8px; color: var(--muted); border-bottom: 1px solid var(--border); font-size: 11px; }
    .proc-table td { padding: 4px 8px; border-bottom: 1px solid rgba(51,65,85,0.5); }
    .pid { color: #fbbf24; font-weight: bold; }
    .proc-name { color: var(--text); }
    .state-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; }

    .groups { display: flex; flex-direction: column; gap: 8px; }
    .group-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
    .group-card.fg { border-color: #4ade80; background: rgba(74,222,128,0.05); }
    .group-card.bg { border-color: var(--border); }
    .group-header { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
    .group-pgid { color: #38bdf8; font-weight: bold; }
    .group-type { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; }
    .fg .group-type { background: #4ade80; color: #0f172a; }
    .bg .group-type { background: var(--border); color: var(--muted); }
    .group-session { color: var(--muted); font-size: 11px; }
    .group-members { display: flex; flex-wrap: wrap; gap: 4px; }
    .member { padding: 2px 8px; border: 1px solid; border-radius: 4px; font-size: 11px; }

    .sessions { display: flex; flex-direction: column; gap: 8px; }
    .session-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
    .session-header { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
    .session-sid { color: #a78bfa; font-weight: bold; }
    .session-tty { color: #22d3ee; font-size: 12px; }
    .session-fg { color: #4ade80; font-size: 11px; }
    .session-groups { display: flex; flex-wrap: wrap; gap: 4px; }
    .session-group { padding: 2px 8px; background: rgba(96,165,250,0.1); border-radius: 4px; font-size: 11px; color: var(--muted); }

    .cgroups { display: flex; flex-direction: column; gap: 8px; }
    .cgroup-card { border: 1px solid #f472b6; border-radius: 6px; padding: 10px; background: rgba(244,114,182,0.05); }
    .cgroup-header { margin-bottom: 6px; }
    .cgroup-path { color: #f472b6; font-weight: bold; }
    .cgroup-limits { display: flex; gap: 12px; margin-bottom: 6px; }
    .cgroup-limit { font-size: 11px; color: var(--muted); padding: 2px 6px; background: rgba(244,114,182,0.1); border-radius: 3px; }
    .cgroup-members { display: flex; flex-wrap: wrap; gap: 4px; }

    .namespaces { display: flex; flex-direction: column; gap: 6px; }
    .ns-card { display: flex; gap: 12px; align-items: center; border: 1px solid; border-radius: 6px; padding: 8px 12px; }
    .ns-type { font-weight: bold; font-size: 12px; min-width: 40px; }
    .ns-id { color: var(--muted); font-size: 11px; }
    .ns-members { color: var(--text); font-size: 11px; }

    .event-list { max-height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .event { padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .event:hover { background: rgba(255,255,255,0.05); }
    .event-step { display: inline-block; width: 24px; color: var(--muted); font-size: 11px; text-align: right; margin-right: 6px; }
    .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; margin-right: 6px; min-width: 80px; text-align: center; }
    .event-desc { font-size: 12px; }
    .event-detail { margin-top: 3px; margin-left: 110px; font-size: 11px; color: var(--muted); white-space: pre-wrap; }
  `;
  document.head.appendChild(style);

  const select = document.getElementById("preset") as HTMLSelectElement;
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.textContent = `${p.name} — ${p.description}`;
    select.appendChild(opt);
  }

  function run(): void {
    const preset = presets[select.selectedIndex]!;
    const result = runSimulation(preset.ops);
    render(result);
  }

  select.addEventListener("change", run);
  run();
}

main();
