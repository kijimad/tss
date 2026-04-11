import { runSimulation } from "../execload/engine.js";
import { presets } from "../execload/presets.js";
import type { SimulationResult, MemoryMapping } from "../execload/types.js";

function hex(n: number): string {
  return `0x${n.toString(16).padStart(8, "0")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** イベントタイプ別の色 */
function eventColor(type: string): string {
  const colors: Record<string, string> = {
    shell_parse: "#94a3b8",
    fork: "#a78bfa",
    execve: "#f472b6",
    permission_check: "#fb923c",
    open_file: "#6ee7b7",
    read_magic: "#fbbf24",
    elf_header: "#60a5fa",
    program_header: "#38bdf8",
    section_parse: "#34d399",
    interp_check: "#c084fc",
    interp_load: "#a78bfa",
    mmap: "#f97316",
    bss_zero: "#84cc16",
    lib_load: "#e879f9",
    relocation: "#22d3ee",
    stack_setup: "#fb7185",
    auxv_setup: "#818cf8",
    process_image: "#4ade80",
    init_call: "#facc15",
    entry_jump: "#f43f5e",
    main_call: "#ef4444",
    script_detect: "#fbbf24",
    error: "#ef4444",
  };
  return colors[type] ?? "#94a3b8";
}

/** メモリマップのバーカラー */
function memColor(source: string): string {
  if (source === "[stack]") return "#fb7185";
  if (source === "[heap]") return "#4ade80";
  if (source === "[vdso]") return "#818cf8";
  if (source === "[vvar]") return "#a78bfa";
  if (source.includes("ld-linux")) return "#c084fc";
  if (source.includes("libc")) return "#60a5fa";
  if (source.includes("libm")) return "#22d3ee";
  if (source.includes("libpthread")) return "#e879f9";
  if (source.includes("lib")) return "#38bdf8";
  return "#f97316";
}

function renderElfHeader(result: SimulationResult): string {
  if (!result.elfHeader) return "";
  const h = result.elfHeader;
  return `
    <div class="panel">
      <h3>ELFヘッダ</h3>
      <table>
        <tr><td>Magic</td><td><code>${escapeHtml(h.magic)}</code></td></tr>
        <tr><td>Class</td><td>${h.class}</td></tr>
        <tr><td>Endian</td><td>${h.endian}</td></tr>
        <tr><td>Type</td><td>${h.type}</td></tr>
        <tr><td>Machine</td><td>${h.machine}</td></tr>
        <tr><td>Entry Point</td><td><code>${hex(h.entryPoint)}</code></td></tr>
        <tr><td>PH offset</td><td><code>${hex(h.phoff)}</code></td></tr>
        <tr><td>SH offset</td><td><code>${hex(h.shoff)}</code></td></tr>
        <tr><td>PH数</td><td>${h.phnum}</td></tr>
        <tr><td>SH数</td><td>${h.shnum}</td></tr>
      </table>
    </div>`;
}

function renderProgramHeaders(result: SimulationResult): string {
  if (result.programHeaders.length === 0) return "";
  return `
    <div class="panel">
      <h3>プログラムヘッダ (${result.programHeaders.length})</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Type</th><th>Offset</th><th>VAddr</th><th>FileSz</th><th>MemSz</th><th>Flags</th><th>Align</th></tr></thead>
          <tbody>${result.programHeaders.map((ph) => `
            <tr class="${ph.type === "PT_LOAD" ? "highlight" : ""}">
              <td><code>${ph.type}</code></td>
              <td><code>${hex(ph.offset)}</code></td>
              <td><code>${hex(ph.vaddr)}</code></td>
              <td>${ph.filesz}</td>
              <td>${ph.memsz}${ph.memsz > ph.filesz ? ` <span class="bss-mark">(+${ph.memsz - ph.filesz} BSS)</span>` : ""}</td>
              <td><code>${ph.flags}</code></td>
              <td>${ph.align}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderSections(result: SimulationResult): string {
  if (result.sections.length === 0) return "";
  return `
    <div class="panel">
      <h3>セクション (${result.sections.length})</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>名前</th><th>VAddr</th><th>サイズ</th><th>Flags</th><th>説明</th></tr></thead>
          <tbody>${result.sections.map((s) => `
            <tr>
              <td><code>${escapeHtml(String(s.name))}</code></td>
              <td><code>${hex(s.vaddr)}</code></td>
              <td>${s.size}</td>
              <td><code>${s.flags}</code></td>
              <td>${escapeHtml(s.description)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderMemoryMap(result: SimulationResult): string {
  if (result.memoryMap.length === 0) return "";
  // アドレス順にソート
  const sorted = [...result.memoryMap].sort((a, b) => a.start - b.start);
  const maxAddr = Math.max(...sorted.map((m) => m.end));
  const minAddr = Math.min(...sorted.map((m) => m.start));
  const range = maxAddr - minAddr || 1;

  return `
    <div class="panel">
      <h3>メモリマップ (${sorted.length}リージョン)</h3>
      <div class="memmap">
        ${sorted.map((m) => {
          const left = ((m.start - minAddr) / range) * 100;
          const width = Math.max(((m.end - m.start) / range) * 100, 0.5);
          return `<div class="memmap-bar" style="left:${left}%;width:${width}%;background:${memColor(m.source)}" title="${hex(m.start)}-${hex(m.end)} ${m.flags} ${m.source}"></div>`;
        }).join("")}
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Start</th><th>End</th><th>Flags</th><th>Source</th><th>説明</th></tr></thead>
          <tbody>${sorted.map((m: MemoryMapping) => `
            <tr>
              <td><code>${hex(m.start)}</code></td>
              <td><code>${hex(m.end)}</code></td>
              <td><code>${m.flags}</code></td>
              <td style="color:${memColor(m.source)}">${escapeHtml(m.source)}</td>
              <td>${escapeHtml(m.description)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderSharedLibs(result: SimulationResult): string {
  if (result.sharedLibs.length === 0) return "";
  return `
    <div class="panel">
      <h3>共有ライブラリ (${result.sharedLibs.length})</h3>
      <div class="libs">
        ${result.sharedLibs.map((lib) => `
          <div class="lib-card">
            <div class="lib-name">${escapeHtml(lib.name)}</div>
            <div class="lib-path">${escapeHtml(lib.path)}</div>
            <div class="lib-addr">Base: <code>${hex(lib.baseAddr)}</code></div>
            <div class="lib-symbols">${lib.symbols.map((s) => `<span class="sym">${escapeHtml(s)}</span>`).join("")}</div>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderRelocations(result: SimulationResult): string {
  if (result.relocations.length === 0) return "";
  return `
    <div class="panel">
      <h3>リロケーション / シンボル解決 (${result.relocations.length})</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Offset</th><th>シンボル</th><th>Type</th><th>解決先</th><th>状態</th></tr></thead>
          <tbody>${result.relocations.map((r) => `
            <tr>
              <td><code>${hex(r.offset)}</code></td>
              <td><code>${escapeHtml(r.symbol)}</code></td>
              <td><code>${r.type}</code></td>
              <td>${r.resolved ? `<code>${hex(r.resolvedAddr!)}</code>` : "-"}</td>
              <td>${r.resolved ? '<span class="resolved">即時解決</span>' : '<span class="lazy">遅延バインディング</span>'}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderProcessImage(result: SimulationResult): string {
  if (!result.processImage) return "";
  const img = result.processImage;
  return `
    <div class="panel">
      <h3>プロセスイメージ</h3>
      <table>
        <tr><td>PID</td><td>${img.pid}</td></tr>
        <tr><td>argv</td><td><code>[${img.argv.map((a) => `"${escapeHtml(a)}"`).join(", ")}]</code></td></tr>
        <tr><td>Entry Point</td><td><code>${hex(img.entryPoint)}</code></td></tr>
        <tr><td>Stack Pointer</td><td><code>${hex(img.stackPointer)}</code></td></tr>
        <tr><td>brk (ヒープ開始)</td><td><code>${hex(img.brkAddr)}</code></td></tr>
      </table>
    </div>`;
}

function renderStats(result: SimulationResult): string {
  const s = result.stats;
  return `
    <div class="panel stats-panel">
      <h3>統計</h3>
      <div class="stats-grid">
        <div class="stat"><span class="stat-val">${s.totalSteps}</span><span class="stat-label">ステップ数</span></div>
        <div class="stat"><span class="stat-val">${s.segmentsLoaded}</span><span class="stat-label">セグメント</span></div>
        <div class="stat"><span class="stat-val">${s.libsLoaded}</span><span class="stat-label">ライブラリ</span></div>
        <div class="stat"><span class="stat-val">${s.symbolsResolved}</span><span class="stat-label">シンボル解決</span></div>
        <div class="stat"><span class="stat-val">${s.mmapCalls}</span><span class="stat-label">mmap呼出</span></div>
        <div class="stat"><span class="stat-val">${(s.totalMapped / 1024).toFixed(1)}KB</span><span class="stat-label">マップ済み</span></div>
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
        ${renderElfHeader(result)}
        ${renderProgramHeaders(result)}
        ${renderSections(result)}
        ${renderSharedLibs(result)}
        ${renderRelocations(result)}
        ${renderProcessImage(result)}
        ${renderMemoryMap(result)}
      </div>
      <div class="col-right">
        ${renderEvents(result)}
      </div>
    </div>`;
}

function main(): void {
  document.title = "実行ファイルローダー シミュレーター";
  document.body.innerHTML = `
    <div id="header">
      <h1>実行ファイルローダー シミュレーター</h1>
      <p>execve → ELF解析 → 動的リンク → メモリマッピング → _start → main()</p>
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
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: normal; }
    tr.highlight td { background: rgba(96,165,250,0.08); }
    code { color: #fbbf24; font-size: 12px; }
    .bss-mark { color: #84cc16; font-size: 11px; }
    .table-scroll { overflow-x: auto; }

    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat { text-align: center; padding: 8px; background: rgba(96,165,250,0.08); border-radius: 6px; }
    .stat-val { display: block; font-size: 20px; font-weight: bold; color: #60a5fa; }
    .stat-label { display: block; font-size: 11px; color: var(--muted); }

    .memmap { position: relative; height: 32px; background: #0f172a; border-radius: 4px; margin-bottom: 12px; overflow: hidden; }
    .memmap-bar { position: absolute; top: 2px; height: 28px; border-radius: 3px; opacity: 0.85; cursor: pointer; min-width: 3px; }
    .memmap-bar:hover { opacity: 1; }

    .libs { display: flex; flex-wrap: wrap; gap: 8px; }
    .lib-card { background: rgba(232,121,249,0.08); border: 1px solid rgba(232,121,249,0.2); border-radius: 6px; padding: 8px 12px; }
    .lib-name { font-weight: bold; color: #e879f9; }
    .lib-path { font-size: 11px; color: var(--muted); }
    .lib-addr { font-size: 11px; margin-top: 4px; }
    .lib-symbols { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
    .sym { background: rgba(96,165,250,0.15); padding: 1px 6px; border-radius: 3px; font-size: 11px; color: #60a5fa; }

    .resolved { color: #4ade80; font-size: 11px; }
    .lazy { color: #fbbf24; font-size: 11px; }

    .event-list { max-height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .event { padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .event:hover { background: rgba(255,255,255,0.05); }
    .event-step { display: inline-block; width: 28px; color: var(--muted); font-size: 11px; text-align: right; margin-right: 6px; }
    .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; margin-right: 6px; min-width: 80px; text-align: center; }
    .event-desc { font-size: 12px; }
    .event-detail { margin-top: 3px; margin-left: 120px; font-size: 11px; color: var(--muted); }
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
