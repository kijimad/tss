/*
 * Unix V6 シミュレーター UI
 *
 * 2つのモードを提供:
 * A) プリセットモード — 事前定義された操作列をステップ実行
 * B) シェルモード — 自由にコマンドを入力してV6カーネルを操作
 *
 * 17パネル構成でV6カーネルの内部状態を可視化する:
 * 1. プロセステーブル — PID/状態/優先度/FDを色分け表示
 * 2. Inodeテーブル — モード/サイズ/リンク数/ブロックアドレス
 * 3. バッファキャッシュ — スロットグリッド (dirty/busy/valid)
 * 4. イベント — 種別ごとに色分けされたタイムライン
 * 5. ディスク/ファイルテーブル — ブロックレイアウト+sysfile+パイプ
 * 6. 実行ログ — 全ステップのメッセージ一覧
 * 7. strace — strace(1)風のシステムコールトレース表示
 * 8. コンテキストスイッチ — swtch()によるプロセス切り替え履歴
 * 9. namei — パス解決のコンポーネント毎追跡
 * 10. メモリマップ — PDP-11セグメント配置
 * 11. トラップ/割り込み — カーネルモード遷移とクロック割り込み
 * 12. TTY端末 — rawq/canq/outqキュー状態・フラグ・特殊文字
 * 13. テキストテーブル/スワップマップ — 共有テキストセグメント・スワップ領域
 * 14. マウントテーブル — マウント済みファイルシステム一覧
 * 15. 割り込みベクタ — PDP-11ベクタテーブル
 * 16. sysent[] — システムコールディスパッチテーブル
 * 17. デバイススイッチ — bdevsw[]/cdevsw[]テーブル
 *
 * ステップ実行(◀/▶)、自動再生、速度調整に対応。
 */

import { runSimulation, createSession } from "../v6/engine.js";
import type { V6Session } from "../v6/engine.js";
import { PRESETS } from "../v6/presets.js";
import { parseShellCommand, getShellHelp } from "../v6/shell.js";
import type { V6StepResult, V6Event, V6Inode } from "../v6/types.js";
import { V6_IFDIR } from "../v6/types.js";
// ─── 共有状態 ───

/** シミュレーション結果のステップ配列 */
let currentSteps: V6StepResult[] = [];
/** 全イベント(ステップ横断) */
let allEvents: V6Event[] = [];
/** 現在表示中のステップインデックス */
let currentStep = 0;
/** 自動再生中フラグ */
let playing = false;
/** 自動再生タイマーID */
let playTimer: ReturnType<typeof setInterval> | null = null;

// ─── シェルモード状態 ───

/** シェルセッション */
let shellSession: V6Session | null = null;
/** シェル出力履歴 */
let shellHistory: string[] = [];
/** コマンド履歴（上下キーで辿る用） */
let cmdHistory: string[] = [];
let cmdHistoryIdx = -1;

// ─── DOM初期化 ───

function init(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="mode-tabs">
      <div class="mode-tab active" data-mode="preset">プリセットモード</div>
      <div class="mode-tab" data-mode="shell">シェルモード</div>
    </div>

    <!-- プリセットモード -->
    <div id="mode-preset" class="mode-content active">
      <div class="controls">
        <label>プリセット:
          <select id="preset">${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}</select>
        </label>
        <span id="presetDesc" class="desc"></span>
      </div>
      <div class="controls">
        <button id="run">実行</button>
        <button id="stepBack" disabled>◀</button>
        <button id="stepFwd" disabled>▶</button>
        <button id="playPause" disabled>▶ 再生</button>
        <label>速度: <input id="speed" type="range" min="100" max="1500" value="500" step="100"></label>
        <span id="stepInfo" class="step-info"></span>
      </div>
    </div>

    <!-- シェルモード -->
    <div id="mode-shell" class="mode-content">
      <div class="panels shell-row">
        <div class="panel shell-panel">
          <h3>/bin/sh — V6 シェル</h3>
          <div id="shellOutput" class="shell-output"></div>
          <div class="shell-input-row">
            <span class="prompt-label" id="shellPrompt"># </span>
            <input type="text" id="shellInput" placeholder="コマンドを入力 (help でヘルプ)" autocomplete="off" spellcheck="false">
            <button id="shellExec">実行</button>
          </div>
          <div class="shell-help-text">Enter で実行 / ↑↓ で履歴 / help でコマンド一覧</div>
        </div>
      </div>
      <div class="controls">
        <button id="shellStepBack" disabled>◀</button>
        <button id="shellStepFwd" disabled>▶</button>
        <button id="shellPlayPause" disabled>▶ 再生</button>
        <label>速度: <input id="shellSpeed" type="range" min="100" max="1500" value="500" step="100"></label>
        <span id="shellStepInfo" class="step-info"></span>
        <button id="shellReset">リセット</button>
      </div>
    </div>

    <!-- 共有パネル -->
    <div class="panels top">
      <div class="panel"><h3>プロセステーブル</h3><div id="procTable"></div></div>
      <div class="panel"><h3>Inodeテーブル</h3><div id="inodeTable"></div></div>
    </div>
    <div class="panels mid">
      <div class="panel"><h3>バッファキャッシュ</h3><div id="bufCache"></div></div>
      <div class="panel"><h3>イベント</h3><div id="eventList"></div></div>
    </div>
    <div class="panels bot2">
      <div class="panel"><h3>ディスクブロック / ファイルテーブル</h3><div id="diskInfo"></div></div>
      <div class="panel"><h3>実行ログ</h3><div id="logList"></div></div>
    </div>
    <div class="panels strace-row">
      <div class="panel strace-panel"><h3>$ strace -f -p 1 (システムコールトレース)</h3><div id="straceOut"></div></div>
    </div>
    <div class="panels trace-grid">
      <div class="panel trace-panel ctx-panel"><h3>swtch() コンテキストスイッチ</h3><div id="ctxTrace"></div></div>
      <div class="panel trace-panel namei-panel"><h3>namei() パス解決トレース</h3><div id="nameiTrace"></div></div>
    </div>
    <div class="panels trace-grid">
      <div class="panel trace-panel mem-panel"><h3>メモリマップ (PDP-11セグメント)</h3><div id="memTrace"></div></div>
      <div class="panel trace-panel trap-panel"><h3>trap/割り込みトレース</h3><div id="trapTrace"></div></div>
    </div>
    <div class="panels top">
      <div class="panel"><h3>TTY端末 (rawq/canq/outq)</h3><div id="ttyPanel"></div></div>
      <div class="panel"><h3>テキストテーブル / スワップマップ</h3><div id="swapPanel"></div></div>
    </div>
    <div class="panels top">
      <div class="panel"><h3>マウントテーブル</h3><div id="mountPanel"></div></div>
      <div class="panel"><h3>統計 (新サブシステム)</h3><div id="newStats"></div></div>
    </div>
    <div class="panels hw-grid">
      <div class="panel"><h3>割り込みベクタ (PDP-11)</h3><div id="vecPanel"></div></div>
      <div class="panel"><h3>sysent[] システムコール</h3><div id="sysentPanel"></div></div>
      <div class="panel"><h3>bdevsw[] / cdevsw[]</h3><div id="devswPanel"></div></div>
    </div>
  `;

  // モードタブ切り替え
  document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".mode-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      const mode = (tab as HTMLElement).dataset["mode"]!;
      document.getElementById(`mode-${mode}`)!.classList.add("active");
      if (mode === "shell" && !shellSession) {
        initShell();
      }
    });
  });

  // プリセットモード
  document.getElementById("preset")!.addEventListener("change", updateDesc);
  document.getElementById("run")!.addEventListener("click", runSim);
  document.getElementById("stepBack")!.addEventListener("click", () => step(-1));
  document.getElementById("stepFwd")!.addEventListener("click", () => step(1));
  document.getElementById("playPause")!.addEventListener("click", togglePlay);

  // シェルモード
  document.getElementById("shellExec")!.addEventListener("click", execShellCommand);
  document.getElementById("shellInput")!.addEventListener("keydown", onShellKeyDown);
  document.getElementById("shellStepBack")!.addEventListener("click", () => step(-1));
  document.getElementById("shellStepFwd")!.addEventListener("click", () => step(1));
  document.getElementById("shellPlayPause")!.addEventListener("click", toggleShellPlay);
  document.getElementById("shellReset")!.addEventListener("click", initShell);

  updateDesc();
}

// ─── プリセットモード ───

function updateDesc(): void {
  const idx = (document.getElementById("preset") as HTMLSelectElement).selectedIndex;
  document.getElementById("presetDesc")!.textContent = PRESETS[idx].description;
}

function runSim(): void {
  stopPlay();
  const idx = (document.getElementById("preset") as HTMLSelectElement).selectedIndex;
  const { config, operations } = PRESETS[idx].build();
  const result = runSimulation(config, operations);
  currentSteps = result.steps;
  allEvents = result.events;
  currentStep = 0;
  (document.getElementById("stepBack") as HTMLButtonElement).disabled = false;
  (document.getElementById("stepFwd") as HTMLButtonElement).disabled = false;
  (document.getElementById("playPause") as HTMLButtonElement).disabled = false;
  render();
}

function step(d: number): void {
  const n = currentStep + d;
  if (n >= 0 && n < currentSteps.length) { currentStep = n; render(); }
}

function togglePlay(): void {
  if (playing) { stopPlay(); return; }
  playing = true;
  document.getElementById("playPause")!.textContent = "⏸ 停止";
  const speed = parseInt((document.getElementById("speed") as HTMLInputElement).value);
  playTimer = setInterval(() => {
    if (currentStep < currentSteps.length - 1) { currentStep++; render(); }
    else stopPlay();
  }, speed);
}

function toggleShellPlay(): void {
  if (playing) { stopPlay(); return; }
  playing = true;
  const btn = document.getElementById("shellPlayPause");
  if (btn) btn.textContent = "⏸ 停止";
  const speed = parseInt((document.getElementById("shellSpeed") as HTMLInputElement).value);
  playTimer = setInterval(() => {
    if (currentStep < currentSteps.length - 1) { currentStep++; render(); }
    else stopPlay();
  }, speed);
}

function stopPlay(): void {
  playing = false;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  const btn1 = document.getElementById("playPause");
  if (btn1) btn1.textContent = "▶ 再生";
  const btn2 = document.getElementById("shellPlayPause");
  if (btn2) btn2.textContent = "▶ 再生";
}

// ─── シェルモード ───

/** シェルセッションを初期化（boot + sh起動） */
function initShell(): void {
  stopPlay();
  shellSession = createSession();
  currentSteps = shellSession.getSteps();
  allEvents = shellSession.getEvents();
  currentStep = currentSteps.length - 1;
  shellHistory = [];
  cmdHistory = [];
  cmdHistoryIdx = -1;

  // シェルの初期出力
  appendShellOutput("info", "Unix V6 シミュレーター — シェルモード");
  appendShellOutput("info", "ブート完了。/bin/sh (PID " + shellSession.getShellPid() + ") で実行中");
  appendShellOutput("info", '"help" でコマンド一覧を表示\n');

  updateShellControls();
  render();
  focusShellInput();
}

/** シェルコマンド実行 */
function execShellCommand(): void {
  if (!shellSession) return;
  const inputEl = document.getElementById("shellInput") as HTMLInputElement;
  const cmd = inputEl.value.trim();
  inputEl.value = "";

  if (cmd === "") return;

  // コマンド履歴に追加
  cmdHistory.push(cmd);
  cmdHistoryIdx = cmdHistory.length;

  // プロンプト + コマンドを出力
  appendShellOutput("prompt", "# ");
  appendShellOutput("cmd", cmd + "\n");

  // help コマンド
  if (cmd === "help") {
    for (const line of getShellHelp()) {
      appendShellOutput("info", "  " + line);
    }
    appendShellOutput("info", "");
    renderShellOutput();
    return;
  }

  // パース
  const shellPid = shellSession.getShellPid();
  // エンジン内部の次PIDカウンタを使用（maxPid+1の推測ではなく正確な値）
  const nextPid = shellSession.getNextPid();
  const result = parseShellCommand(cmd, shellPid, nextPid);

  if (result.error) {
    appendShellOutput("error", result.error + "\n");
    renderShellOutput();
    return;
  }

  // 操作列を実行
  const newSteps = shellSession.executeBatch(result.operations);

  // 結果をシェル出力に追加
  for (const s of newSteps) {
    // コメント操作のメッセージはスキップ（既にプロンプトで表示済み）
    if (s.operation.op === "comment") continue;
    // エラー含みのメッセージを表示
    if (s.message.includes("失敗") || s.message.includes("エラー")) {
      appendShellOutput("error", s.message);
    } else if (s.message !== "") {
      appendShellOutput("result", s.message);
    }
  }
  appendShellOutput("result", "");

  // UIステップ更新
  currentSteps = shellSession.getSteps();
  allEvents = shellSession.getEvents();
  currentStep = currentSteps.length - 1;

  updateShellControls();
  renderShellOutput();
  render();
  focusShellInput();
}

/** シェル入力でのキーハンドリング */
function onShellKeyDown(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    e.preventDefault();
    execShellCommand();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (cmdHistoryIdx > 0) {
      cmdHistoryIdx--;
      (document.getElementById("shellInput") as HTMLInputElement).value = cmdHistory[cmdHistoryIdx] ?? "";
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (cmdHistoryIdx < cmdHistory.length - 1) {
      cmdHistoryIdx++;
      (document.getElementById("shellInput") as HTMLInputElement).value = cmdHistory[cmdHistoryIdx] ?? "";
    } else {
      cmdHistoryIdx = cmdHistory.length;
      (document.getElementById("shellInput") as HTMLInputElement).value = "";
    }
  }
}

/** シェル出力に行を追加 */
function appendShellOutput(cls: string, text: string): void {
  shellHistory.push(`<span class="sh-${cls}">${esc(text)}</span>`);
}

/** シェル出力をDOMに描画 */
function renderShellOutput(): void {
  const el = document.getElementById("shellOutput");
  if (!el) return;
  el.innerHTML = shellHistory.join("");
  el.scrollTop = el.scrollHeight;
}

/** シェルモードのコントロールを更新 */
function updateShellControls(): void {
  const hasSteps = currentSteps.length > 0;
  (document.getElementById("shellStepBack") as HTMLButtonElement).disabled = !hasSteps;
  (document.getElementById("shellStepFwd") as HTMLButtonElement).disabled = !hasSteps;
  (document.getElementById("shellPlayPause") as HTMLButtonElement).disabled = !hasSteps;
  const info = document.getElementById("shellStepInfo");
  if (info) info.textContent = `Step ${currentStep + 1} / ${currentSteps.length}`;
}

/** シェル入力にフォーカス */
function focusShellInput(): void {
  const el = document.getElementById("shellInput");
  if (el) (el as HTMLInputElement).focus();
}

// ─── 共通レンダリング ───

function modeStr(mode: number): string {
  const t = (mode & 0o170000) === V6_IFDIR ? "d" : "-";
  const rwx = (m: number) =>
    ((m & 4) ? "r" : "-") + ((m & 2) ? "w" : "-") + ((m & 1) ? "x" : "-");
  return t + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

/** 現在のステップに基づいて全パネルを再描画する */
function render(): void {
  if (currentSteps.length === 0) return;
  const s = currentSteps[currentStep];

  // ステップ情報
  const presetStepInfo = document.getElementById("stepInfo");
  if (presetStepInfo) presetStepInfo.textContent = `Step ${currentStep + 1} / ${currentSteps.length}`;
  const shellStepInfo = document.getElementById("shellStepInfo");
  if (shellStepInfo) shellStepInfo.textContent = `Step ${currentStep + 1} / ${currentSteps.length}`;

  // プロセステーブル
  const procHtml = s.processes.length === 0
    ? '<div class="empty">プロセスなし</div>'
    : `<table class="tbl"><tr><th>PID</th><th>PPID</th><th>State</th><th>Name</th><th>Pri</th><th>FDs</th></tr>
      ${s.processes.map(p => {
        const cls = p.state === "running" ? "st-run" : p.state === "zombie" ? "st-zom" :
          p.state === "sleeping" ? "st-slp" : p.state === "ready" ? "st-rdy" : "st-other";
        const fds = p.openFiles.filter(f => f !== null).map(f => `${f!.fd}`).join(",");
        return `<tr class="${cls}"><td>${p.pid}</td><td>${p.ppid}</td><td>${p.state}</td><td>${esc(p.name)}</td><td>${p.priority}</td><td>${fds || "-"}</td></tr>`;
      }).join("")}</table>`;
  document.getElementById("procTable")!.innerHTML = procHtml;

  // Inodeテーブル
  const inodes = s.inodes.filter(i => i.inodeNum > 0).slice(0, 20);
  const inodeHtml = inodes.length === 0
    ? '<div class="empty">inodeなし</div>'
    : `<table class="tbl"><tr><th>#</th><th>Mode</th><th>Size</th><th>Nlink</th><th>Blocks</th></tr>
      ${inodes.map((i: V6Inode) => {
        const blocks = i.addr.filter(a => a !== 0).map((a, idx) =>
          idx >= 10 ? `<span class="ind">[${a}]</span>` : `${a}`
        ).join(" ");
        return `<tr><td>${i.inodeNum}</td><td class="mode">${modeStr(i.mode)}</td><td>${i.size}</td><td>${i.nlink}</td><td class="blks">${blocks || "-"}</td></tr>`;
      }).join("")}</table>`;
  document.getElementById("inodeTable")!.innerHTML = inodeHtml;

  // バッファキャッシュ
  const bufHtml = s.bufferCache.length === 0
    ? '<div class="empty">バッファ空</div>'
    : `<div class="buf-grid">${s.bufferCache.map(b => {
        const cls = b.flags.dirty ? "buf-dirty" : b.flags.busy ? "buf-busy" : "buf-clean";
        return `<div class="buf-slot ${cls}">
          <div class="buf-id">${b.device}:${b.blockNum}</div>
          <div class="buf-flags">${b.flags.dirty ? "D" : ""}${b.flags.busy ? "B" : ""}${b.flags.valid ? "V" : ""}</div>
        </div>`;
      }).join("")}</div>`;
  document.getElementById("bufCache")!.innerHTML = bufHtml;

  // イベント（全件表示）
  const evUpTo = allEvents.filter(e => e.step <= s.step);
  const eventHtml = evUpTo.map(e => {
    const detail = e.detail ? `<div class="ev-detail">${esc(e.detail)}</div>` : "";
    return `<div class="ev ev-${e.type}">[${e.step}] ${esc(e.message)}${detail}</div>`;
  }).join("");
  const evEl = document.getElementById("eventList")!;
  evEl.innerHTML = `<div class="ev-count">イベント数: ${evUpTo.length} / ${allEvents.length}</div>${eventHtml}`;
  evEl.scrollTop = evEl.scrollHeight;

  // ディスク/ファイルテーブル
  const diskBlocks = s.disk.slice(0, 30).map(d =>
    `<span class="dblk dblk-${d.type}" title="${esc(d.content)}">${d.blockNum}</span>`
  ).join("");
  const sysFiles = s.sysFileTable.map(f =>
    `<div class="sf">sys[${f.index}] ino=${f.inodeNum} off=${f.offset} ref=${f.refCount} ${f.mode}</div>`
  ).join("");
  const pipes = s.pipes.map(p =>
    `<div class="pp">pipe#${p.id} buf=${p.buffer.length} r=${p.readerCount} w=${p.writerCount}</div>`
  ).join("");
  document.getElementById("diskInfo")!.innerHTML =
    `<div class="disk-row">${diskBlocks}</div>
     <div class="sub-section"><strong>SysFile:</strong> ${sysFiles || "なし"}</div>
     <div class="sub-section"><strong>Pipes:</strong> ${pipes || "なし"}</div>`;

  // ログ
  const logHtml = currentSteps.slice(0, currentStep + 1).map((st, i) => {
    const cls = i === currentStep ? "log-cur" : "";
    return `<div class="log ${cls}">[${st.step}] ${esc(st.message)}</div>`;
  }).join("");
  document.getElementById("logList")!.innerHTML = logHtml;
  const logEl = document.getElementById("logList")!;
  logEl.scrollTop = logEl.scrollHeight;

  // strace
  const traces = s.syscallTrace ?? [];
  const straceHtml = traces.length === 0
    ? '<div class="empty">システムコールなし</div>'
    : traces.map((t, i) => {
        const prevLen = currentStep > 0 ? (currentSteps[currentStep - 1].syscallTrace?.length ?? 0) : 0;
        const cls = i >= prevLen ? "strace-new" : "";
        return `<div class="strace-line ${cls}">${esc(t)}</div>`;
      }).join("");
  document.getElementById("straceOut")!.innerHTML = straceHtml;
  const straceEl = document.getElementById("straceOut")!;
  straceEl.scrollTop = straceEl.scrollHeight;

  // トレースパネル群
  renderTracePanel(s.contextSwitchTrace ?? [], "ctxTrace", "ctx-new", "コンテキストスイッチなし",
    currentStep > 0 ? (currentSteps[currentStep - 1].contextSwitchTrace?.length ?? 0) : 0);
  renderTracePanel(s.nameiTrace ?? [], "nameiTrace", "namei-new", "パス解決なし",
    currentStep > 0 ? (currentSteps[currentStep - 1].nameiTrace?.length ?? 0) : 0);
  renderTracePanel(s.memoryMapTrace ?? [], "memTrace", "mem-new", "メモリマップなし",
    currentStep > 0 ? (currentSteps[currentStep - 1].memoryMapTrace?.length ?? 0) : 0);
  renderTracePanel(s.trapTrace ?? [], "trapTrace", "trap-new", "トラップなし",
    currentStep > 0 ? (currentSteps[currentStep - 1].trapTrace?.length ?? 0) : 0);

  // TTY端末パネル
  const ttys = s.ttys ?? [];
  const ttyHtml = ttys.length === 0
    ? '<div class="empty">TTYデバイスなし</div>'
    : `<div class="tty-grid">${ttys.map(t => {
        const flags = [
          t.flags.echo ? "ECHO" : "", t.flags.raw ? "RAW" : "",
          t.flags.crmod ? "CRMOD" : "", t.flags.xtabs ? "XTABS" : ""
        ].filter(Boolean).join(" ");
        return `<div class="tty-card">
          <div class="tty-name">${esc(t.name)} (dev=${t.device})</div>
          <div class="tty-q">rawq: <b>${t.rawq.count}</b> canq: <b>${t.canq.count}</b> outq: <b>${t.outq.count}</b></div>
          <div class="tty-flags">flags: ${flags || "なし"}</div>
          <div class="tty-special">erase='${esc(t.eraseChar)}' kill='${esc(t.killChar)}' intr='${esc(t.intrChar)}' quit='${esc(t.quitChar)}'</div>
          <div class="tty-q">pgrp=${t.pgrp} speed=${t.speed}</div>
        </div>`;
      }).join("")}</div>`;
  document.getElementById("ttyPanel")!.innerHTML = ttyHtml;

  // テキストテーブル / スワップマップ
  const textTable = s.textTable ?? [];
  const swapMap = s.swapMap ?? [];
  const textHtml = textTable.length === 0
    ? '<div class="swap-entry">テキストエントリなし</div>'
    : textTable.map(t => {
        const shared = t.refCount > 1 ? ' class="text-shared"' : '';
        return `<div class="text-entry"${shared}>text[${t.index}] ino=${t.inodeNum} core=0x${t.coreAddr.toString(16)} swap=0x${t.swapAddr.toString(16)} size=${t.size} ref=${t.refCount} coreN=${t.coreCount}${t.path ? ` ${esc(t.path)}` : ""}</div>`;
      }).join("");
  const swapHtml = swapMap.map(e =>
    `<div class="swap-entry">addr=0x${e.addr.toString(16)} size=${e.size} blocks</div>`
  ).join("");
  document.getElementById("swapPanel")!.innerHTML =
    `<div class="swap-section"><strong>テキストテーブル (text.h):</strong>${textHtml}</div>
     <div class="swap-section"><strong>スワップマップ:</strong>${swapHtml || '<div class="swap-entry">空</div>'}</div>`;

  // マウントテーブル
  const mounts = s.mounts ?? [];
  const mountHtml = mounts.length === 0
    ? '<div class="empty">マウントなし</div>'
    : mounts.map(m =>
        `<div class="mount-entry"><span class="mount-dev">${esc(m.deviceName)}</span> → <span class="mount-path">${esc(m.mountPath)}</span> (dev=${m.device} ino=${m.mountPoint})</div>`
      ).join("");
  document.getElementById("mountPanel")!.innerHTML = mountHtml;

  // 統計（新サブシステム） — イベントから集計
  const evBefore = allEvents.filter(e => e.step <= s.step);
  const countType = (t: string) => evBefore.filter(e => e.type === t).length;
  document.getElementById("newStats")!.innerHTML = `<table class="tbl">
    <tr><th>項目</th><th>値</th></tr>
    <tr><td>swap_out</td><td>${countType("swap_out")}</td></tr>
    <tr><td>swap_in</td><td>${countType("swap_in")}</td></tr>
    <tr><td>text_share</td><td>${countType("text_share")}</td></tr>
    <tr><td>tty_input</td><td>${countType("tty_input")}</td></tr>
    <tr><td>tty_output</td><td>${countType("tty_output")}</td></tr>
    <tr><td>dev_strategy</td><td>${countType("dev_strategy")}</td></tr>
    <tr><td>dev_interrupt</td><td>${countType("dev_interrupt")}</td></tr>
    <tr><td>mount</td><td>${countType("mount")}</td></tr>
    <tr><td>perm_denied</td><td>${countType("perm_denied")}</td></tr>
    <tr><td>suid_exec</td><td>${countType("suid_exec")}</td></tr>
  </table>`;

  // 割り込みベクタ
  const vecs = s.interruptVectors ?? [];
  const vecHtml = vecs.length === 0
    ? '<div class="empty">ベクタなし</div>'
    : `<table class="vec-tbl"><tr><th>Addr</th><th>Handler</th><th>Pri</th><th>説明</th></tr>
      ${vecs.map(v =>
        `<tr><td>0${v.address.toString(8)}</td><td>${esc(v.handler)}</td><td class="vec-pri">BR${v.priority}</td><td>${esc(v.description)}</td></tr>`
      ).join("")}</table>`;
  document.getElementById("vecPanel")!.innerHTML = vecHtml;

  // sysent[]
  const sysent = s.sysent ?? [];
  const sysentHtml = sysent.length === 0
    ? '<div class="empty">sysent[]なし</div>'
    : `<table class="vec-tbl sysent-tbl"><tr><th>#</th><th>Name</th><th>Args</th><th>Handler</th></tr>
      ${sysent.map(e =>
        `<tr><td>${e.number}</td><td>${esc(e.name)}</td><td>${e.narg}</td><td>${esc(e.handler)}</td></tr>`
      ).join("")}</table>`;
  document.getElementById("sysentPanel")!.innerHTML = sysentHtml;

  // bdevsw[] / cdevsw[]
  const bdevsw = s.bdevsw ?? [];
  const cdevsw = s.cdevsw ?? [];
  const bdevHtml = bdevsw.length === 0 ? ""
    : `<strong style="color:#fb923c;font-size:11px">bdevsw[] (ブロック):</strong>
      <table class="vec-tbl devsw-tbl"><tr><th>Major</th><th>Name</th><th>Strategy</th><th>Root</th></tr>
      ${bdevsw.map(d =>
        `<tr><td>${d.major}</td><td>${esc(d.name)}</td><td>${esc(d.d_strategy)}</td><td>${d.d_root ? "✓" : ""}</td></tr>`
      ).join("")}</table>`;
  const cdevHtml = cdevsw.length === 0 ? ""
    : `<strong style="color:#22d3ee;font-size:11px;margin-top:6px;display:block">cdevsw[] (キャラクタ):</strong>
      <table class="vec-tbl devsw-tbl"><tr><th>Major</th><th>Name</th><th>Read</th><th>Write</th></tr>
      ${cdevsw.map(d =>
        `<tr><td>${d.major}</td><td>${esc(d.name)}</td><td>${esc(d.d_read)}</td><td>${esc(d.d_write)}</td></tr>`
      ).join("")}</table>`;
  // calloutテーブル
  const callouts = s.callouts ?? [];
  const calloutHtml = callouts.length === 0 ? ""
    : `<strong style="color:#facc15;font-size:11px;margin-top:6px;display:block">callout[]:</strong>
      <table class="vec-tbl"><tr><th>Ticks</th><th>Handler</th><th>Arg</th></tr>
      ${callouts.map(c =>
        `<tr><td>${c.ticks}</td><td>${esc(c.handler)}</td><td>${c.arg}</td></tr>`
      ).join("")}</table>`;
  document.getElementById("devswPanel")!.innerHTML = (bdevHtml + cdevHtml + calloutHtml) || '<div class="empty">デバイスなし</div>';
}

function renderTracePanel(traces: string[], elementId: string, newClass: string, emptyMsg: string, prevLen: number): void {
  const html = traces.length === 0
    ? `<div class="empty">${emptyMsg}</div>`
    : traces.map((t, i) => {
        const cls = i >= prevLen ? newClass : "";
        return `<div class="trace-line ${cls}">${esc(t)}</div>`;
      }).join("");
  const el = document.getElementById(elementId)!;
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", init);
