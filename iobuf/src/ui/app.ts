import { runSimulation } from "../iobuf/engine.js";
import { presets } from "../iobuf/presets.js";
import type { SimulationResult, WriteLevel } from "../iobuf/types.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** イベントタイプ別の色 */
function eventColor(type: string): string {
  const c: Record<string, string> = {
    open: "#6ee7b7", close: "#94a3b8", dup: "#94a3b8",
    stdio_write: "#60a5fa", stdio_read: "#38bdf8", stdio_flush: "#fbbf24",
    buffer_fill: "#818cf8", buffer_auto_flush: "#f97316",
    kernel_write: "#e879f9", kernel_read: "#c084fc",
    page_cache_hit: "#4ade80", page_cache_miss: "#f43f5e", page_cache_alloc: "#a78bfa",
    readahead: "#22d3ee",
    writeback: "#fb923c", dirty_expire: "#fb7185", pdflush: "#f472b6",
    disk_io: "#ef4444", disk_complete: "#84cc16",
    fsync: "#fbbf24", fdatasync: "#facc15", sync: "#fbbf24",
    setvbuf: "#94a3b8",
    o_direct: "#f43f5e", mmap: "#a78bfa", pipe: "#22d3ee",
    fork: "#e879f9",
    info: "#64748b", error: "#ef4444",
  };
  return c[type] ?? "#94a3b8";
}

/** 書き込みレベルの色 */
function levelColor(level?: WriteLevel): string {
  if (!level) return "transparent";
  const c: Record<WriteLevel, string> = {
    app: "#60a5fa", stdio: "#818cf8", kernel: "#e879f9",
    disk_queue: "#fb923c", disk_cache: "#fbbf24", disk_platter: "#4ade80",
  };
  return c[level];
}

function levelLabel(level?: WriteLevel): string {
  if (!level) return "";
  const l: Record<WriteLevel, string> = {
    app: "APP", stdio: "STDIO", kernel: "KERNEL",
    disk_queue: "QUEUE", disk_cache: "D$", disk_platter: "DISK",
  };
  return l[level];
}

function renderDataPath(_result: SimulationResult): string {
  // データフローの可視化: App → stdio → kernel → disk
  const layers: { name: string; color: string; desc: string }[] = [
    { name: "アプリケーション", color: "#60a5fa", desc: "printf / fputs / fwrite" },
    { name: "stdio バッファ", color: "#818cf8", desc: "ユーザ空間, 4-8KB" },
    { name: "カーネル ページキャッシュ", color: "#e879f9", desc: "write() システムコール" },
    { name: "I/O スケジューラ", color: "#fb923c", desc: "エレベータ, マージ" },
    { name: "ディスク", color: "#4ade80", desc: "永続化, fsync()" },
  ];

  return `
    <div class="panel">
      <h3>データフロー</h3>
      <div class="dataflow">
        ${layers.map((l, i) => `
          <div class="flow-layer" style="border-color:${l.color}">
            <span class="flow-name" style="color:${l.color}">${l.name}</span>
            <span class="flow-desc">${l.desc}</span>
          </div>
          ${i < layers.length - 1 ? '<div class="flow-arrow">↓</div>' : ""}`).join("")}
      </div>
    </div>`;
}

function renderFiles(result: SimulationResult): string {
  if (result.files.length === 0) return "";
  return `
    <div class="panel">
      <h3>ファイル / ストリーム</h3>
      <div class="files">
        ${result.files.map((f) => {
          const modeLabel = f.stdioBuf.mode === "unbuffered" ? "バッファなし" :
            f.stdioBuf.mode === "line_buffered" ? "行バッファ" : "フルバッファ";
          const fillPct = f.stdioBuf.capacity > 0 ? (f.stdioBuf.used / f.stdioBuf.capacity * 100) : 0;
          return `
            <div class="file-card">
              <div class="file-header">
                <span class="file-fd">fd=${f.fd}</span>
                <span class="file-path">${escapeHtml(f.path)}</span>
                <span class="file-type">${f.fdType}</span>
              </div>
              <div class="file-buf">
                <span class="buf-mode">${modeLabel}</span>
                <div class="buf-bar-container">
                  <div class="buf-bar" style="width:${fillPct}%;background:${f.stdioBuf.dirty ? "#f97316" : "#4ade80"}"></div>
                </div>
                <span class="buf-usage">${f.stdioBuf.used}/${f.stdioBuf.capacity}B</span>
              </div>
              ${f.stdioBuf.data.length > 0 ? `<div class="buf-content">"${escapeHtml(f.stdioBuf.data.join("").slice(0, 60))}"</div>` : ""}
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

function renderPageCache(result: SimulationResult): string {
  const pc = result.pageCache;
  if (pc.pages.length === 0 && pc.hitCount === 0 && pc.missCount === 0) return "";
  const hitRate = pc.hitCount + pc.missCount > 0
    ? (pc.hitCount / (pc.hitCount + pc.missCount) * 100).toFixed(1) : "N/A";
  return `
    <div class="panel">
      <h3>ページキャッシュ</h3>
      <div class="cache-stats">
        <span class="cache-stat"><strong>${pc.hitCount}</strong> ヒット</span>
        <span class="cache-stat"><strong>${pc.missCount}</strong> ミス</span>
        <span class="cache-stat">ヒット率 <strong>${hitRate}%</strong></span>
        <span class="cache-stat">ダーティ <strong>${pc.dirtyPages}</strong></span>
      </div>
      ${pc.pages.length > 0 ? `
        <div class="cache-pages">
          ${pc.pages.map((p) => `
            <div class="cache-page ${p.dirty ? "dirty" : "clean"}">
              <span class="page-no">#${p.pageNo}</span>
              <span class="page-block">blk ${p.blockNo}</span>
              <span class="page-dirty">${p.dirty ? "D" : "C"}</span>
            </div>`).join("")}
        </div>` : ""}
    </div>`;
}

function renderStats(result: SimulationResult): string {
  const s = result.stats;
  return `
    <div class="panel">
      <h3>統計</h3>
      <div class="stats-grid">
        <div class="stat"><span class="stat-val">${s.stdioWrites}</span><span class="stat-label">stdio書込</span></div>
        <div class="stat"><span class="stat-val">${s.stdioFlushes}</span><span class="stat-label">フラッシュ</span></div>
        <div class="stat"><span class="stat-val">${s.autoFlushes}</span><span class="stat-label">自動flush</span></div>
        <div class="stat"><span class="stat-val">${s.kernelWrites}</span><span class="stat-label">kernel書込</span></div>
        <div class="stat"><span class="stat-val">${s.pageCacheHits}</span><span class="stat-label">cache hit</span></div>
        <div class="stat"><span class="stat-val">${s.pageCacheMisses}</span><span class="stat-label">cache miss</span></div>
        <div class="stat"><span class="stat-val">${s.diskIOs}</span><span class="stat-label">disk I/O</span></div>
        <div class="stat"><span class="stat-val">${s.fsyncs}</span><span class="stat-label">fsync</span></div>
        <div class="stat"><span class="stat-val">${s.bytesWritten}</span><span class="stat-label">書込B</span></div>
      </div>
    </div>`;
}

function renderEvents(result: SimulationResult): string {
  return `
    <div class="panel">
      <h3>イベントログ (${result.events.length})</h3>
      <div class="event-list">
        ${result.events.map((e) => `
          <div class="event">
            <span class="event-step">${e.step}</span>
            ${e.level ? `<span class="event-level" style="background:${levelColor(e.level)}">${levelLabel(e.level)}</span>` : ""}
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
        ${renderDataPath(result)}
        ${renderFiles(result)}
        ${renderPageCache(result)}
      </div>
      <div class="col-right">
        ${renderEvents(result)}
      </div>
    </div>`;
}

function main(): void {
  document.title = "I/O バッファリング シミュレーター";
  document.body.innerHTML = `
    <div id="header">
      <h1>UNIX I/O バッファリング シミュレーター</h1>
      <p>stdio バッファ → カーネル ページキャッシュ → ディスク — fflush / fsync / O_DIRECT</p>
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

    .dataflow { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .flow-layer { border: 1px solid; border-radius: 6px; padding: 8px 16px; width: 100%; display: flex; justify-content: space-between; }
    .flow-name { font-weight: bold; font-size: 13px; }
    .flow-desc { font-size: 11px; color: var(--muted); }
    .flow-arrow { color: var(--muted); font-size: 16px; }

    .files { display: flex; flex-direction: column; gap: 8px; }
    .file-card { background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
    .file-header { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
    .file-fd { color: #fbbf24; font-weight: bold; }
    .file-path { color: var(--text); flex: 1; }
    .file-type { color: var(--muted); font-size: 11px; }
    .file-buf { display: flex; align-items: center; gap: 8px; }
    .buf-mode { font-size: 11px; color: #818cf8; width: 80px; }
    .buf-bar-container { flex: 1; height: 12px; background: #0f172a; border-radius: 3px; overflow: hidden; }
    .buf-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .buf-usage { font-size: 11px; color: var(--muted); width: 80px; text-align: right; }
    .buf-content { margin-top: 4px; font-size: 11px; color: #84cc16; word-break: break-all; }

    .cache-stats { display: flex; gap: 16px; margin-bottom: 10px; font-size: 12px; }
    .cache-stat { color: var(--muted); }
    .cache-stat strong { color: var(--text); }
    .cache-pages { display: flex; flex-wrap: wrap; gap: 4px; }
    .cache-page { display: flex; gap: 4px; padding: 3px 8px; border-radius: 4px; font-size: 11px; }
    .cache-page.dirty { background: rgba(249,115,22,0.15); border: 1px solid rgba(249,115,22,0.3); }
    .cache-page.clean { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); }
    .page-no { color: var(--muted); }
    .page-block { color: var(--text); }
    .page-dirty { font-weight: bold; }
    .dirty .page-dirty { color: #f97316; }
    .clean .page-dirty { color: #4ade80; }

    .event-list { max-height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .event { padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .event:hover { background: rgba(255,255,255,0.05); }
    .event-step { display: inline-block; width: 24px; color: var(--muted); font-size: 11px; text-align: right; margin-right: 6px; }
    .event-level { display: inline-block; padding: 1px 4px; border-radius: 3px; font-size: 9px; color: #0f172a; font-weight: bold; margin-right: 4px; min-width: 42px; text-align: center; }
    .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; margin-right: 6px; min-width: 80px; text-align: center; }
    .event-desc { font-size: 12px; }
    .event-detail { margin-top: 3px; margin-left: 110px; font-size: 11px; color: var(--muted); }
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
