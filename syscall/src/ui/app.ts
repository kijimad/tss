import { Kernel } from "../kernel/kernel.js";
import type {
  SyscallInvocation,
  SyscallResult,
  KernelSnapshot,
  TraceStep,
  FdEntry,
  ProcessInfo,
  MemRegion,
} from "../kernel/kernel.js";

export interface Example {
  name: string;
  description: string;
  calls: SyscallInvocation[];
}

export const EXAMPLES: Example[] = [
  {
    name: "ファイル I/O (open/read/write/close)",
    description: "ファイルを開いて読み書きし、閉じる基本操作。fd テーブルの変化に注目。",
    calls: [
      { code: 'fd = open("/etc/hostname", O_RDONLY)', name: "open", args: ["/etc/hostname", "O_RDONLY"] },
      { code: "n = read(fd, buf, 128)", name: "read", args: [3, 128] },
      { code: 'fd2 = open("/tmp/out.txt", O_WRONLY|O_CREAT)', name: "open", args: ["/tmp/out.txt", "O_WRONLY,O_CREAT"] },
      { code: 'write(fd2, "Hello, World!\\n")', name: "write", args: [4, "Hello, World!\n"] },
      { code: "close(fd)", name: "close", args: [3] },
      { code: "close(fd2)", name: "close", args: [4] },
    ],
  },
  {
    name: "プロセス管理 (fork/exec/wait)",
    description: "fork で子プロセス作成、execve でプログラム置換、wait で回収。プロセステーブルの変化に注目。",
    calls: [
      { code: "pid = getpid()", name: "getpid", args: [] },
      { code: "child = fork()", name: "fork", args: [] },
      { code: 'execve("/bin/ls")', name: "execve", args: ["/bin/ls"] },
      { code: "exit(0)", name: "exit", args: [0] },
      { code: "wpid = wait()", name: "wait", args: [] },
      { code: "ppid = getppid()", name: "getppid", args: [] },
    ],
  },
  {
    name: "メモリ管理 (brk/mmap/munmap)",
    description: "brk でヒープ拡張、mmap で匿名マッピング作成、munmap で解放。メモリマップの変化に注目。",
    calls: [
      { code: "brk(4096)", name: "brk", args: [4096] },
      { code: "brk(8192)", name: "brk", args: [8192] },
      { code: 'addr1 = mmap(65536, "rw-p")', name: "mmap", args: [65536, "rw-p"] },
      { code: 'addr2 = mmap(32768, "r--p")', name: "mmap", args: [32768, "r--p"] },
      { code: "munmap(addr1)", name: "munmap", args: [0x7f00_0000] },
      { code: "brk(16384)", name: "brk", args: [16384] },
    ],
  },
  {
    name: "パイプ通信 (pipe/fork/dup2)",
    description: "pipe で通信路作成、fork で子プロセスへ、dup2 でリダイレクト。fd テーブルの変化に注目。",
    calls: [
      { code: "pipe(pipefd)", name: "pipe", args: [] },
      { code: "child = fork()", name: "fork", args: [] },
      { code: "close(pipefd[0])  /* 子: 読み取り側を閉じる */", name: "close", args: [3] },
      { code: "dup2(pipefd[1], STDOUT)  /* 子: stdout をパイプに */", name: "dup2", args: [4, 1] },
      { code: 'write(STDOUT, "data from child")', name: "write", args: [1, "data from child"] },
      { code: "close(pipefd[1])  /* 子: 書き込み側を閉じる */", name: "close", args: [4] },
    ],
  },
  {
    name: "ソケット通信 (socket/bind/listen/accept)",
    description: "TCP サーバの構築手順。socket → bind → listen → accept の流れ。",
    calls: [
      { code: 'sfd = socket(AF_INET, SOCK_STREAM)', name: "socket", args: ["AF_INET", "SOCK_STREAM"] },
      { code: 'bind(sfd, "0.0.0.0", 8080)', name: "bind", args: [3, "0.0.0.0", 8080] },
      { code: "listen(sfd, 128)", name: "listen", args: [3, 128] },
      { code: "cfd = accept(sfd)", name: "accept", args: [3] },
      { code: 'write(cfd, "HTTP/1.1 200 OK\\r\\n")', name: "write", args: [4, "HTTP/1.1 200 OK\r\n"] },
      { code: "close(cfd)", name: "close", args: [4] },
    ],
  },
  {
    name: "シグナルとプロセス終了",
    description: "fork で子プロセスを作り、kill でシグナルを送信して終了させる。",
    calls: [
      { code: "child = fork()", name: "fork", args: [] },
      { code: "pid = getpid()", name: "getpid", args: [] },
      { code: "kill(child, SIGTERM)", name: "kill", args: [101, 15] },
      { code: "wpid = wait()", name: "wait", args: [] },
      { code: "uname()", name: "uname", args: [] },
      { code: "exit(0)", name: "exit", args: [0] },
    ],
  },
];

/** モードに対応する色 */
function modeColor(mode: TraceStep["mode"]): string {
  switch (mode) {
    case "user":   return "#10b981";
    case "trap":   return "#f59e0b";
    case "kernel": return "#3b82f6";
    case "return": return "#8b5cf6";
    case "error":  return "#ef4444";
  }
}

export class SyscallApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const kernel = new Kernel();

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "System Call Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exSelect.appendChild(opt);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run All";
    runBtn.style.cssText =
      "padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const stepBtn = document.createElement("button");
    stepBtn.textContent = "\u23ED Step";
    stepBtn.style.cssText =
      "padding:4px 12px;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:4px;cursor:pointer;font-size:12px;";
    header.appendChild(stepBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "\u21BB Reset";
    resetBtn.style.cssText =
      "padding:4px 12px;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:4px;cursor:pointer;font-size:12px;";
    header.appendChild(resetBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: コード + トレース
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    // コード一覧
    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "User Program (syscall sequence)";
    leftPanel.appendChild(codeLabel);

    const codeDiv = document.createElement("div");
    codeDiv.style.cssText = "padding:8px 12px;font-size:12px;border-bottom:1px solid #1e293b;max-height:160px;overflow-y:auto;";
    leftPanel.appendChild(codeDiv);

    // トレース
    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Execution Trace (user \u2192 trap \u2192 kernel \u2192 return)";
    leftPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.5;";
    leftPanel.appendChild(traceDiv);

    main.appendChild(leftPanel);

    // 右: カーネル状態
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:360px;display:flex;flex-direction:column;overflow-y:auto;";

    // fd テーブル
    const fdLabel = document.createElement("div");
    fdLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    fdLabel.textContent = "File Descriptor Table";
    rightPanel.appendChild(fdLabel);

    const fdDiv = document.createElement("div");
    fdDiv.style.cssText = "padding:6px 12px;font-size:10px;border-bottom:1px solid #1e293b;min-height:60px;";
    rightPanel.appendChild(fdDiv);

    // プロセステーブル
    const procLabel = document.createElement("div");
    procLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#8b5cf6;border-bottom:1px solid #1e293b;";
    procLabel.textContent = "Process Table";
    rightPanel.appendChild(procLabel);

    const procDiv = document.createElement("div");
    procDiv.style.cssText = "padding:6px 12px;font-size:10px;border-bottom:1px solid #1e293b;min-height:60px;";
    rightPanel.appendChild(procDiv);

    // メモリマップ
    const memLabel = document.createElement("div");
    memLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    memLabel.textContent = "Memory Map";
    rightPanel.appendChild(memLabel);

    const memDiv = document.createElement("div");
    memDiv.style.cssText = "flex:1;padding:6px 12px;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(memDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 状態 ──
    let currentCalls: SyscallInvocation[] = [];
    let stepIndex = 0;

    // ── 描画関数 ──

    const renderCode = (calls: SyscallInvocation[], highlight: number) => {
      codeDiv.innerHTML = "";
      calls.forEach((c, i) => {
        const line = document.createElement("div");
        const active = i === highlight;
        const done = i < highlight;
        const color = active ? "#f59e0b" : done ? "#475569" : "#94a3b8";
        const bg = active ? "#f59e0b11" : "transparent";
        line.style.cssText = `padding:2px 6px;color:${color};background:${bg};border-left:3px solid ${active ? "#f59e0b" : "transparent"};`;
        const prefix = active ? "\u25B6 " : done ? "\u2714 " : "  ";
        line.textContent = `${prefix}${c.code}`;
        codeDiv.appendChild(line);
      });
    };

    const renderTrace = (results: SyscallResult[]) => {
      traceDiv.innerHTML = "";
      for (let ri = 0; ri < results.length; ri++) {
        const res = results[ri]!;
        for (const step of res.trace) {
          const line = document.createElement("div");
          line.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";

          const badge = document.createElement("span");
          const color = modeColor(step.mode);
          badge.style.cssText = `min-width:50px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;`;
          badge.textContent = step.mode;
          line.appendChild(badge);

          const detail = document.createElement("span");
          detail.style.color = "#cbd5e1";
          detail.textContent = step.detail;
          line.appendChild(detail);

          traceDiv.appendChild(line);
        }
        // 区切り線
        if (ri < results.length - 1) {
          const hr = document.createElement("div");
          hr.style.cssText = "border-top:1px solid #1e293b;margin:4px 0;";
          traceDiv.appendChild(hr);
        }
      }
      traceDiv.scrollTop = traceDiv.scrollHeight;
    };

    const renderFdTable = (fds: FdEntry[]) => {
      fdDiv.innerHTML = "";
      if (fds.length === 0) {
        fdDiv.textContent = "(empty)";
        return;
      }
      for (const fd of fds) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;margin-bottom:2px;";

        const fdNum = document.createElement("span");
        fdNum.style.cssText = "color:#3b82f6;font-weight:600;min-width:24px;";
        fdNum.textContent = String(fd.fd);
        row.appendChild(fdNum);

        const typeSpan = document.createElement("span");
        const tColor = fd.type === "socket" ? "#f59e0b" : fd.type.startsWith("pipe") ? "#a78bfa" : "#64748b";
        typeSpan.style.cssText = `min-width:42px;color:${tColor};font-size:9px;`;
        typeSpan.textContent = fd.type;
        row.appendChild(typeSpan);

        const pathSpan = document.createElement("span");
        pathSpan.style.color = "#94a3b8";
        pathSpan.textContent = `${fd.path} [${fd.flags}]`;
        row.appendChild(pathSpan);

        fdDiv.appendChild(row);
      }
    };

    const renderProcesses = (procs: ProcessInfo[]) => {
      procDiv.innerHTML = "";
      for (const p of procs) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;margin-bottom:2px;";

        const pid = document.createElement("span");
        pid.style.cssText = "color:#8b5cf6;font-weight:600;min-width:34px;";
        pid.textContent = `PID ${p.pid}`;
        row.appendChild(pid);

        const state = document.createElement("span");
        const sColor = p.state === "running" ? "#10b981" : p.state === "zombie" ? "#ef4444" : "#64748b";
        state.style.cssText = `min-width:55px;color:${sColor};font-size:9px;`;
        state.textContent = p.state;
        row.appendChild(state);

        const name = document.createElement("span");
        name.style.color = "#94a3b8";
        name.textContent = `${p.name} (ppid=${p.ppid})`;
        row.appendChild(name);

        procDiv.appendChild(row);
      }
    };

    const renderMemory = (regions: MemRegion[]) => {
      memDiv.innerHTML = "";
      for (const r of regions) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;margin-bottom:2px;";

        const addr = document.createElement("span");
        addr.style.cssText = "color:#06b6d4;min-width:90px;";
        addr.textContent = `0x${r.start.toString(16).padStart(8, "0")}`;
        row.appendChild(addr);

        const size = document.createElement("span");
        size.style.cssText = "color:#64748b;min-width:50px;";
        size.textContent = `${(r.size / 1024).toFixed(0)}K`;
        row.appendChild(size);

        const perm = document.createElement("span");
        perm.style.cssText = "color:#f59e0b;min-width:35px;";
        perm.textContent = r.perm;
        row.appendChild(perm);

        const name = document.createElement("span");
        name.style.color = "#94a3b8";
        name.textContent = r.name;
        row.appendChild(name);

        memDiv.appendChild(row);
      }
    };

    const renderKernelState = (snap: KernelSnapshot) => {
      renderFdTable(snap.fdTable);
      renderProcesses(snap.processes);
      renderMemory(snap.memory);
    };

    // ── ロジック ──
    const allResults: SyscallResult[] = [];

    const loadExample = (ex: Example) => {
      kernel.reset();
      currentCalls = ex.calls;
      stepIndex = 0;
      allResults.length = 0;
      descSpan.textContent = ex.description;
      renderCode(currentCalls, -1);
      traceDiv.innerHTML = "";
      renderKernelState(kernel.snapshot());
    };

    const executeStep = () => {
      if (stepIndex >= currentCalls.length) return;
      const call = currentCalls[stepIndex]!;
      const result = kernel.execute(call);
      allResults.push(result);
      stepIndex++;
      renderCode(currentCalls, stepIndex);
      renderTrace(allResults);
      renderKernelState(kernel.snapshot());
    };

    const executeAll = () => {
      kernel.reset();
      allResults.length = 0;
      stepIndex = 0;
      const doStep = () => {
        if (stepIndex >= currentCalls.length) return;
        executeStep();
        setTimeout(doStep, 350);
      };
      doStep();
    };

    const resetState = () => {
      loadExample(EXAMPLES[Number(exSelect.value)]!);
    };

    // ── イベント ──
    exSelect.addEventListener("change", () => {
      loadExample(EXAMPLES[Number(exSelect.value)]!);
    });
    runBtn.addEventListener("click", executeAll);
    stepBtn.addEventListener("click", executeStep);
    resetBtn.addEventListener("click", resetState);

    // 初期表示
    loadExample(EXAMPLES[0]!);
  }
}
