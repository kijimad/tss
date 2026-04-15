/**
 * app.ts — メモリスワッピング可視化UI
 *
 * 物理メモリフレーム、スワップ領域、ページテーブル、TLB、
 * イベントログをステップ実行で表示する。
 */

import { PRESETS } from "../swap/presets.js";
import type { SwapSnapshot, SwapEvent, PhysicalFrame, SwapSlot, TlbEntry, SwapSimResult, SwapStats } from "../swap/types.js";

// ── 色定義 ──

function eventColor(type: SwapEvent["type"]): string {
  switch (type) {
    case "access": return "#94a3b8";
    case "page_hit": return "#22c55e";
    case "page_fault": return "#f59e0b";
    case "swap_out": return "#ef4444";
    case "swap_in": return "#3b82f6";
    case "frame_alloc": return "#22d3ee";
    case "victim_select": return "#f97316";
    case "dirty_writeback": return "#dc2626";
    case "clock_hand": return "#a78bfa";
    case "ref_clear": return "#818cf8";
    case "tlb_hit": return "#4ade80";
    case "tlb_miss": return "#facc15";
    case "tlb_update": return "#06b6d4";
    case "thrash_detect": return "#ef4444";
    case "process_create": return "#8b5cf6";
    case "info": return "#64748b";
  }
}

function severityBg(sev: SwapEvent["severity"]): string {
  switch (sev) {
    case "normal": return "transparent";
    case "highlight": return "#1e293b";
    case "warning": return "#2a1a0a";
    case "danger": return "#2a0a0a";
  }
}

const PID_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#06b6d4", "#f97316", "#ec4899"];
function pidColor(pid: number): string { return PID_COLORS[(pid - 1) % PID_COLORS.length]!; }

// ── メインアプリ ──

export class SwapApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;background:#0a0a1a;color:#e0e0e0;font-family:'Menlo','Consolas',monospace;font-size:12px;";

    // ヘッダー
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Memory Swap Simulator";
    title.style.cssText = "margin:0;font-size:14px;color:#7dd3fc;";
    header.appendChild(title);

    const presetSelect = document.createElement("select");
    presetSelect.style.cssText = "padding:3px 8px;background:#111128;border:1px solid #2a2a4a;border-radius:4px;color:#e0e0e0;font-size:11px;max-width:300px;";
    for (let i = 0; i < PRESETS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = PRESETS[i]!.name;
      presetSelect.appendChild(o);
    }
    header.appendChild(presetSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 実行";
    runBtn.style.cssText = "padding:3px 14px;background:#22d3ee;color:#0a0a1a;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;";
    header.appendChild(runBtn);

    const stepLabel = document.createElement("span");
    stepLabel.style.cssText = "font-size:11px;color:#7dd3fc;";
    stepLabel.textContent = "Step: -";
    header.appendChild(stepLabel);

    const prevBtn = this.makeBtn("\u25C0");
    const nextBtn = this.makeBtn("\u25B6");
    const allBtn = this.makeBtn("\u25B6\u25B6 All");
    header.appendChild(prevBtn);
    header.appendChild(nextBtn);
    header.appendChild(allBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#888;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:grid;grid-template-columns:1fr 320px;grid-template-rows:auto 1fr;gap:0;overflow:hidden;";

    // 上部左: 物理メモリ + スワップ + TLB
    const topLeft = document.createElement("div");
    topLeft.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:8px;overflow-y:auto;border-right:1px solid #1e293b;border-bottom:1px solid #1e293b;";
    main.appendChild(topLeft);

    // 上部右: 統計
    const topRight = document.createElement("div");
    topRight.style.cssText = "padding:8px;border-bottom:1px solid #1e293b;overflow-y:auto;";
    main.appendChild(topRight);

    // 下部左: ページテーブル
    const botLeft = document.createElement("div");
    botLeft.style.cssText = "padding:8px;overflow-y:auto;border-right:1px solid #1e293b;";
    main.appendChild(botLeft);

    // 下部右: イベントログ
    const botRight = document.createElement("div");
    botRight.style.cssText = "padding:8px;overflow-y:auto;";
    main.appendChild(botRight);

    container.appendChild(main);

    // ── 状態 ──
    let result: SwapSimResult | null = null;
    let currentStep = 0;

    const render = () => {
      if (!result) return;
      const snap = result.snapshots[currentStep];
      if (!snap) return;
      stepLabel.textContent = `Step: ${currentStep} / ${result.snapshots.length - 1}`;
      this.renderFrames(topLeft, snap);
      this.renderStats(topRight, snap.stats, result.config.algorithm);
      this.renderPageTables(botLeft, snap);
      this.renderEvents(botRight, snap.events);
    };

    const runPreset = (idx: number) => {
      const preset = PRESETS[idx];
      if (!preset) return;
      descSpan.textContent = preset.description;
      result = preset.run();
      currentStep = 0;
      render();
    };

    presetSelect.addEventListener("change", () => {
      descSpan.textContent = PRESETS[Number(presetSelect.value)]?.description ?? "";
    });
    runBtn.addEventListener("click", () => runPreset(Number(presetSelect.value)));
    prevBtn.addEventListener("click", () => { if (result && currentStep > 0) { currentStep--; render(); } });
    nextBtn.addEventListener("click", () => { if (result && currentStep < result.snapshots.length - 1) { currentStep++; render(); } });
    allBtn.addEventListener("click", () => { if (result) { currentStep = result.snapshots.length - 1; render(); } });

    descSpan.textContent = PRESETS[0]?.description ?? "";
  }

  private makeBtn(text: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = "padding:3px 8px;background:#111128;border:1px solid #2a2a4a;border-radius:4px;color:#e0e0e0;cursor:pointer;font-size:11px;";
    return b;
  }

  // ── 物理メモリ + スワップ + TLB 描画 ──
  private renderFrames(container: HTMLElement, snap: SwapSnapshot): void {
    container.innerHTML = "";

    // 物理メモリ
    const memLabel = document.createElement("div");
    memLabel.style.cssText = "font-size:11px;font-weight:600;color:#7dd3fc;margin-bottom:4px;";
    memLabel.textContent = `物理メモリ (${snap.frames.length} フレーム)`;
    container.appendChild(memLabel);

    const memGrid = document.createElement("div");
    memGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;";
    for (const f of snap.frames) {
      memGrid.appendChild(this.renderFrame(f, snap));
    }
    container.appendChild(memGrid);

    // スワップ領域
    const swapLabel = document.createElement("div");
    swapLabel.style.cssText = "font-size:11px;font-weight:600;color:#f59e0b;margin-bottom:4px;";
    swapLabel.textContent = `スワップ領域 (${snap.swapSlots.length} スロット)`;
    container.appendChild(swapLabel);

    const swapGrid = document.createElement("div");
    swapGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;margin-bottom:10px;";
    for (const s of snap.swapSlots) {
      swapGrid.appendChild(this.renderSwapSlot(s));
    }
    container.appendChild(swapGrid);

    // TLB
    const tlbLabel = document.createElement("div");
    tlbLabel.style.cssText = "font-size:11px;font-weight:600;color:#22c55e;margin-bottom:4px;";
    tlbLabel.textContent = `TLB (${snap.tlb.length} エントリ)`;
    container.appendChild(tlbLabel);

    const tlbGrid = document.createElement("div");
    tlbGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;margin-bottom:10px;";
    for (const t of snap.tlb) {
      tlbGrid.appendChild(this.renderTlbEntry(t));
    }
    container.appendChild(tlbGrid);

    // Clock針
    if (snap.clockHand >= 0) {
      const clockDiv = document.createElement("div");
      clockDiv.style.cssText = "font-size:10px;color:#a78bfa;";
      clockDiv.textContent = `Clock 針位置: フレーム ${snap.clockHand}`;
      container.appendChild(clockDiv);
    }
  }

  private renderFrame(f: PhysicalFrame, snap: SwapSnapshot): HTMLElement {
    const el = document.createElement("div");
    const isAccessed = snap.access && snap.frames[f.frameNum] && !f.free && snap.access.vpn === f.vpn && snap.access.pid === f.pid;
    const borderColor = isAccessed ? "#7dd3fc" : f.free ? "#1e293b" : pidColor(f.pid) + "66";
    const bgColor = f.free ? "#0a0a1a" : pidColor(f.pid) + "11";
    el.style.cssText = `min-width:70px;padding:4px 6px;border:1px solid ${borderColor};border-radius:4px;background:${bgColor};`;
    if (f.free) {
      el.innerHTML = `<div style="font-size:9px;color:#555;">F${f.frameNum}</div><div style="color:#333;font-size:10px;">空き</div>`;
    } else {
      const proc = snap.processes.find(p => p.pid === f.pid);
      const pte = proc?.pageTable[f.vpn];
      const dirty = pte?.dirty ? " D" : "";
      const ref = pte?.referenced ? " R" : "";
      el.innerHTML =
        `<div style="font-size:9px;color:#888;">F${f.frameNum}</div>` +
        `<div style="color:${pidColor(f.pid)};font-size:10px;font-weight:600;">P${f.pid}:VP${f.vpn}</div>` +
        `<div style="font-size:8px;color:#888;">${f.data.slice(0, 10)}${dirty}${ref}</div>`;
    }
    return el;
  }

  private renderSwapSlot(s: SwapSlot): HTMLElement {
    const el = document.createElement("div");
    const bg = s.used ? "#1a1a0a" : "#0a0a1a";
    const border = s.used ? "#f59e0b44" : "#1e293b";
    el.style.cssText = `min-width:55px;padding:3px 5px;border:1px solid ${border};border-radius:3px;background:${bg};`;
    if (s.used) {
      el.innerHTML = `<div style="font-size:8px;color:#888;">S${s.slotNum}</div><div style="color:${pidColor(s.pid)};font-size:9px;">P${s.pid}:${s.vpn}</div>`;
    } else {
      el.innerHTML = `<div style="font-size:8px;color:#555;">S${s.slotNum}</div><div style="color:#333;font-size:9px;">-</div>`;
    }
    return el;
  }

  private renderTlbEntry(t: TlbEntry): HTMLElement {
    const el = document.createElement("div");
    const bg = t.valid ? "#0a1a0a" : "#0a0a1a";
    const border = t.valid ? "#22c55e44" : "#1e293b";
    el.style.cssText = `min-width:80px;padding:3px 5px;border:1px solid ${border};border-radius:3px;background:${bg};`;
    if (t.valid) {
      const d = t.dirty ? " D" : "";
      el.innerHTML = `<div style="color:${pidColor(t.pid)};font-size:9px;">P${t.pid}:VP${t.vpn}→F${t.pfn}${d}</div>`;
    } else {
      el.innerHTML = `<div style="color:#333;font-size:9px;">---</div>`;
    }
    return el;
  }

  // ── 統計 ──
  private renderStats(container: HTMLElement, stats: SwapStats, algorithm: string): void {
    container.innerHTML = "";
    const label = document.createElement("div");
    label.style.cssText = "font-size:11px;font-weight:600;color:#7dd3fc;margin-bottom:6px;";
    label.textContent = "統計";
    container.appendChild(label);

    const items: [string, string | number, string][] = [
      ["アルゴリズム", algorithm.toUpperCase(), "#a78bfa"],
      ["総アクセス", stats.totalAccesses, "#e0e0e0"],
      ["ページヒット", stats.pageHits, "#22c55e"],
      ["ページフォルト", stats.pageFaults, "#f59e0b"],
      ["フォルト率", `${stats.faultRate}%`, stats.faultRate > 50 ? "#ef4444" : stats.faultRate > 20 ? "#f59e0b" : "#22c55e"],
      ["スワップイン", stats.swapIns, "#3b82f6"],
      ["スワップアウト", stats.swapOuts, "#ef4444"],
      ["ダーティ書き戻し", stats.dirtyWritebacks, "#dc2626"],
      ["TLBヒット", stats.tlbHits, "#4ade80"],
      ["TLBミス", stats.tlbMisses, "#facc15"],
      ["TLBヒット率", `${stats.tlbHitRate}%`, stats.tlbHitRate > 70 ? "#22c55e" : "#f59e0b"],
    ];

    for (const [name, value, color] of items) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #111128;";
      row.innerHTML = `<span style="color:#888;font-size:10px;">${name}</span><span style="color:${color};font-size:10px;font-weight:600;">${value}</span>`;
      container.appendChild(row);
    }
  }

  // ── ページテーブル ──
  private renderPageTables(container: HTMLElement, snap: SwapSnapshot): void {
    container.innerHTML = "";
    const label = document.createElement("div");
    label.style.cssText = "font-size:11px;font-weight:600;color:#7dd3fc;margin-bottom:6px;";
    label.textContent = "ページテーブル";
    container.appendChild(label);

    for (const proc of snap.processes) {
      const procDiv = document.createElement("div");
      procDiv.style.cssText = "margin-bottom:8px;";
      procDiv.innerHTML = `<div style="font-size:10px;color:${pidColor(proc.pid)};font-weight:600;margin-bottom:3px;">${proc.name} (PID=${proc.pid})</div>`;

      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:9px;";
      table.innerHTML = `<tr style="background:#111128;color:#7dd3fc;"><th style="padding:2px 4px;">VP</th><th>状態</th><th>PFN</th><th>Swap</th><th>D</th><th>R</th></tr>`;
      for (const pte of proc.pageTable) {
        const stateColor = pte.state === "resident" ? "#22c55e" : pte.state === "swapped" ? "#f59e0b" : "#555";
        const isAccessed = snap.access && snap.access.pid === proc.pid && snap.access.vpn === pte.vpn;
        const bg = isAccessed ? "#1a1a3a" : "transparent";
        table.innerHTML +=
          `<tr style="border-top:1px solid #111128;background:${bg};">` +
          `<td style="padding:2px 4px;color:#e0e0e0;">${pte.vpn}</td>` +
          `<td style="color:${stateColor};">${pte.state}</td>` +
          `<td style="color:#e0e0e0;">${pte.valid ? pte.pfn : "-"}</td>` +
          `<td style="color:#f59e0b;">${pte.swapSlot >= 0 ? pte.swapSlot : "-"}</td>` +
          `<td style="color:${pte.dirty ? "#ef4444" : "#333"};">${pte.dirty ? "1" : "0"}</td>` +
          `<td style="color:${pte.referenced ? "#22c55e" : "#333"};">${pte.referenced ? "1" : "0"}</td>` +
          `</tr>`;
      }
      procDiv.appendChild(table);
      container.appendChild(procDiv);
    }
  }

  // ── イベントログ ──
  private renderEvents(container: HTMLElement, events: SwapEvent[]): void {
    container.innerHTML = "";
    const label = document.createElement("div");
    label.style.cssText = "font-size:11px;font-weight:600;color:#7dd3fc;margin-bottom:6px;";
    label.textContent = `イベント (${events.length})`;
    container.appendChild(label);

    for (const ev of events) {
      const el = document.createElement("div");
      const bg = severityBg(ev.severity);
      const color = eventColor(ev.type);
      el.style.cssText = `padding:3px 6px;margin-bottom:2px;border-radius:3px;background:${bg};border-left:2px solid ${color};`;
      el.innerHTML =
        `<div style="display:flex;gap:4px;align-items:center;">` +
        `<span style="font-size:8px;padding:0 3px;border-radius:2px;color:${color};background:${color}15;border:1px solid ${color}33;">${ev.type}</span>` +
        `<span style="color:#e0e0e0;font-size:10px;">${ev.message}</span>` +
        `</div>`;
      if (ev.detail) {
        el.innerHTML += `<div style="font-size:9px;color:#888;padding-left:8px;margin-top:1px;">${ev.detail}</div>`;
      }
      container.appendChild(el);
    }
  }
}
