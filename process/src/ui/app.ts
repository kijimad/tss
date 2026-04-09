import { ProcessSimulator, createInitProc, defaultFds } from "../engine/process.js";
import type { SyscallOp, SimResult, SimEvent, Process } from "../engine/process.js";

export interface Experiment { name: string; description: string; initProc: ReturnType<typeof createInitProc>; ops: SyscallOp[]; }

export const EXPERIMENTS: Experiment[] = [
  {
    name: "fork + exec — 子プロセス起動",
    description: "bash が fork() で子を作成し、exec() で ls に置換する。CoW メモリマップ、FD 継承、アドレス空間置換を観察。",
    initProc: createInitProc("bash", "/bin/bash", { argv: ["/bin/bash"] }),
    ops: [
      { op: "fork", parentPid: 1, childName: "bash (fork)", childExec: "/bin/bash" },
      { op: "exec", pid: 2, newExec: "/bin/ls", argv: ["ls", "-la", "/home"] },
      { op: "schedule" },
      { op: "exit", pid: 2, code: 0 },
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "パイプ — ls | grep",
    description: "pipe() でパイプ作成→fork→dup2 で stdin/stdout をリダイレクト。Unix パイプラインの内部動作。",
    initProc: createInitProc("bash", "/bin/bash"),
    ops: [
      { op: "pipe", pid: 1, name: "ls|grep" },
      { op: "fork", parentPid: 1, childName: "ls" },
      { op: "dup2", pid: 2, oldFd: 4, newFd: 1 },
      { op: "close", pid: 2, fd: 3 },
      { op: "exec", pid: 2, newExec: "/bin/ls", argv: ["ls", "-la"] },
      { op: "fork", parentPid: 1, childName: "grep" },
      { op: "dup2", pid: 3, oldFd: 3, newFd: 0 },
      { op: "close", pid: 3, fd: 4 },
      { op: "exec", pid: 3, newExec: "/bin/grep", argv: ["grep", "txt"] },
      { op: "close", pid: 1, fd: 3 },
      { op: "close", pid: 1, fd: 4 },
      { op: "write", pid: 2, fd: 1, data: "file1.txt\nfile2.log\nfile3.txt\n" },
      { op: "read", pid: 3, fd: 0 },
      { op: "exit", pid: 2, code: 0 },
      { op: "exit", pid: 3, code: 0 },
      { op: "wait", pid: 1 },
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "シグナル — SIGTERM / SIGKILL",
    description: "SIGTERM (捕捉可能) と SIGKILL (捕捉不可) の違い。カスタムハンドラが登録されていれば SIGTERM は処理される。",
    initProc: createInitProc("daemon", "/usr/sbin/nginx", { handlers: { SIGTERM: "handle", SIGUSR1: "handle" } }),
    ops: [
      { op: "fork", parentPid: 1, childName: "worker" },
      { op: "schedule" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGTERM" },
      { op: "kill", senderPid: 1, targetPid: 1, signal: "SIGUSR1" },
      { op: "fork", parentPid: 1, childName: "rogue" },
      { op: "kill", senderPid: 1, targetPid: 3, signal: "SIGKILL" },
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "SIGSTOP / SIGCONT — プロセス一時停止",
    description: "SIGSTOP で stopped、SIGCONT で再開。Ctrl+Z → bg の内部動作。",
    initProc: createInitProc("bash", "/bin/bash"),
    ops: [
      { op: "fork", parentPid: 1, childName: "long-task" },
      { op: "schedule" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGSTOP" },
      { op: "schedule" },
      { op: "kill", senderPid: 1, targetPid: 2, signal: "SIGCONT" },
      { op: "schedule" },
      { op: "exit", pid: 2, code: 0 },
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "zombie プロセス — wait 忘れ",
    description: "子が終了しても親が wait() しないと zombie が残る。ps で <defunct> として表示される状態。",
    initProc: createInitProc("parent", "/app/parent"),
    ops: [
      { op: "fork", parentPid: 1, childName: "child-1" },
      { op: "fork", parentPid: 1, childName: "child-2" },
      { op: "fork", parentPid: 1, childName: "child-3" },
      { op: "exit", pid: 2, code: 0 },
      { op: "exit", pid: 3, code: 1 },
      { op: "exit", pid: 4, code: 0 },
      { op: "schedule" },
      // 親は wait しない → 3 zombie
      // 後から 1 つだけ回収
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "孤児プロセス — 親が先に終了",
    description: "親プロセスが先に exit すると子は孤児になり、init (PID=1) に再配置される。",
    initProc: createInitProc("init", "/sbin/init"),
    ops: [
      { op: "fork", parentPid: 1, childName: "parent" },
      { op: "fork", parentPid: 2, childName: "orphan-child" },
      { op: "exit", pid: 2, code: 0 },
      { op: "wait", pid: 1 },
      { op: "schedule" },
      { op: "exit", pid: 3, code: 0 },
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "デーモン化 (ダブル fork)",
    description: "fork → setsid 相当 → fork で完全にデタッチ。stdin/stdout/stderr を /dev/null にリダイレクト。",
    initProc: createInitProc("bash", "/bin/bash"),
    ops: [
      { op: "fork", parentPid: 1, childName: "daemon-stage1" },
      { op: "fork", parentPid: 2, childName: "daemon-stage2" },
      { op: "exit", pid: 2, code: 0 },
      { op: "wait", pid: 1 },
      { op: "close", pid: 3, fd: 0 },
      { op: "close", pid: 3, fd: 1 },
      { op: "close", pid: 3, fd: 2 },
      { op: "exec", pid: 3, newExec: "/usr/sbin/myservice", argv: ["myservice", "--daemon"] },
      { op: "schedule" },
    ],
  },
  {
    name: "nice — 優先度変更",
    description: "nice 値を変更してスケジューリング優先度を調整。nice=-5 (高優先) と nice=19 (最低優先) の差を観察。",
    initProc: createInitProc("bash", "/bin/bash"),
    ops: [
      { op: "fork", parentPid: 1, childName: "high-prio" },
      { op: "fork", parentPid: 1, childName: "low-prio" },
      { op: "nice", pid: 2, value: -5 },
      { op: "nice", pid: 3, value: 19 },
      { op: "schedule" },
      { op: "exit", pid: 2, code: 0 },
      { op: "exit", pid: 3, code: 0 },
      { op: "wait", pid: 1 },
      { op: "wait", pid: 1 },
    ],
  },
  {
    name: "sleep — タイマーとスケジューラ",
    description: "sleep() でプロセスを sleeping 状態に。タイマー満了で SIGALRM 相当のイベントにより起床。",
    initProc: createInitProc("bash", "/bin/bash"),
    ops: [
      { op: "fork", parentPid: 1, childName: "sleeper" },
      { op: "sleep", pid: 2, ms: 100 },
      { op: "schedule" },
      { op: "exit", pid: 2, code: 0 },
      { op: "wait", pid: 1 },
    ],
  },
];

// ── 色 ──
const LC: Record<string, string> = { Kernel: "#64748b", Syscall: "#3b82f6", Signal: "#ef4444", Sched: "#f59e0b", Memory: "#a78bfa", IPC: "#22c55e", FD: "#06b6d4", App: "#e2e8f0" };
const SC: Record<string, string> = { created: "#64748b", ready: "#3b82f6", running: "#22c55e", sleeping: "#a78bfa", stopped: "#f59e0b", zombie: "#ef4444", terminated: "#475569" };
const TI: Record<string, string> = { info: "●", create: "+", state: "⇄", signal: "⚡", ipc: "↔", fd: "📁", error: "✗", exit: "☠" };

export class ProcessApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";
    const header = document.createElement("div"); header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "Process Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;"; header.appendChild(title);
    const exSelect = document.createElement("select"); exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;"; header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;"; header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:380px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const ms = (l: string, c: string) => { const lb = document.createElement("div"); lb.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${c};border-bottom:1px solid #1e293b;`; lb.textContent = l; leftPanel.appendChild(lb); const d = document.createElement("div"); d.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(d); return d; };
    const treeDiv = ms("Process Tree", "#22c55e");
    const procLabel = document.createElement("div"); procLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;"; procLabel.textContent = "Process Details"; leftPanel.appendChild(procLabel);
    const procDiv = document.createElement("div"); procDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;font-size:9px;"; leftPanel.appendChild(procDiv);
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Kernel Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel); container.appendChild(main);

    const renderTree = (tree: SimResult["processTree"]) => {
      treeDiv.innerHTML = "";
      const roots = tree.filter((p) => p.ppid === 0);
      const renderNode = (node: typeof tree[0], depth: number) => {
        const el = document.createElement("div"); el.style.cssText = `margin-left:${depth * 16}px;margin-bottom:2px;`;
        el.innerHTML = `<span style="color:${SC[node.state] ?? "#94a3b8"};font-weight:600;">●</span> <span style="color:#e2e8f0;">PID=${node.pid}</span> <span style="color:#94a3b8;">${node.name}</span> <span style="color:${SC[node.state] ?? "#94a3b8"};font-size:8px;">[${node.state}]</span>`;
        treeDiv.appendChild(el);
        for (const child of tree.filter((p) => p.ppid === node.pid)) renderNode(child, depth + 1);
      };
      for (const r of roots) renderNode(r, 0);
    };

    const renderProcs = (procs: Process[]) => {
      procDiv.innerHTML = "";
      for (const p of procs) {
        const card = document.createElement("div"); card.style.cssText = "margin-bottom:6px;padding:4px 6px;background:#0a0a1e;border:1px solid #1e293b;border-radius:3px;";
        let html = `<div><span style="color:${SC[p.state] ?? "#94a3b8"};font-weight:600;">PID=${p.pid}</span> <span style="color:#e2e8f0;">${p.name}</span> <span style="color:#64748b;">${p.execPath} ppid=${p.ppid} uid=${p.uid} nice=${p.nice}</span></div>`;
        html += `<div style="color:#64748b;font-size:8px;">state=${p.state} cpu=${p.cpuTime}ms mem=${p.memoryKb}KB${p.exitCode !== undefined ? ` exit=${p.exitCode}` : ""}</div>`;
        if (p.fds.length > 0) html += `<div style="color:#06b6d4;font-size:8px;">FD: ${p.fds.map((f) => `${f.fd}→${f.path}`).join(", ")}</div>`;
        if (p.children.length > 0) html += `<div style="color:#22c55e;font-size:8px;">children: [${p.children.join(", ")}]</div>`;
        card.innerHTML = html; procDiv.appendChild(card);
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const lc = LC[ev.layer] ?? "#94a3b8";
        el.innerHTML = `<span style="min-width:30px;color:#475569;text-align:right;">${ev.time}</span><span style="color:${ev.type === "error" || ev.type === "exit" ? "#ef4444" : ev.type === "signal" ? "#f59e0b" : "#94a3b8"};min-width:14px;">${TI[ev.type] ?? "●"}</span><span style="min-width:46px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span>${ev.pid !== undefined ? `<span style="color:#475569;min-width:32px;">P${ev.pid}</span>` : ""}<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    const load = (e: Experiment) => { descSpan.textContent = e.description; treeDiv.innerHTML = ""; procDiv.innerHTML = '<span style="color:#475569;">▶ Run</span>'; evDiv.innerHTML = ""; };
    const run = (e: Experiment) => {
      const sim = new ProcessSimulator();
      const r = sim.simulate(e.initProc, e.ops);
      renderTree(r.processTree); renderProcs(r.processes); renderEvents(r.events);
    };
    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) load(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) run(e); });
    load(EXPERIMENTS[0]!);
  }
}
