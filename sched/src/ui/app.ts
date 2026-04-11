import { presets, runScheduler } from "../scheduler/index.js";
import type { SimulationResult, GanttEntry, ProcessStats, TimelineEvent } from "../scheduler/index.js";

/** プロセスごとの色 */
const COLORS = [
  "#4dd0e1", "#ff7043", "#66bb6a", "#ab47bc", "#ffca28",
  "#42a5f5", "#ef5350", "#26a69a", "#8d6e63", "#78909c",
];

export class SchedApp {
  private container!: HTMLElement;

  init(el: HTMLElement | null): void {
    if (!el) throw new Error("コンテナが見つかりません");
    this.container = el;
    this.render();
    this.runPreset(0);
  }

  private render(): void {
    this.container.innerHTML = `
      <div style="font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#e0e0e0;min-height:100vh;padding:20px;">
        <div style="max-width:1500px;margin:0 auto;">
          <h1 style="font-size:1.5rem;margin-bottom:16px;color:#88ccff;">Multitask Scheduler Simulator</h1>
          <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <label style="font-size:0.9rem;color:#aaa;">プリセット:</label>
            <select id="preset-select" style="padding:8px 12px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:6px;font-size:0.9rem;min-width:400px;cursor:pointer;">
              ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
            </select>
          </div>
          <p id="preset-desc" style="color:#888;font-size:0.85rem;margin-bottom:20px;"></p>
          <div id="content"></div>
        </div>
      </div>
    `;
    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
  }

  private runPreset(index: number): void {
    const preset = presets[index];
    if (!preset) return;
    (this.container.querySelector("#preset-desc") as HTMLElement).textContent = preset.description;
    const result = runScheduler(preset.processes, preset.config);
    this.renderResult(result);
  }

  private renderResult(result: SimulationResult): void {
    const el = this.container.querySelector("#content") as HTMLElement;
    el.innerHTML = `
      ${this.renderStats(result)}
      ${this.renderGantt(result.gantt, result.totalTime)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>${this.renderProcessTable(result.processStats)}</div>
        <div>${this.renderEvents(result.events)}</div>
      </div>
    `;
  }

  private card(title: string, content: string): string {
    return `<div style="background:#12121a;border:1px solid #222;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="font-size:0.9rem;color:#ffcc66;margin-bottom:10px;">${title}</h3>${content}</div>`;
  }

  private renderStats(result: SimulationResult): string {
    const algoNames: Record<string, string> = {
      fcfs: "FCFS", sjf: "SJF", srtf: "SRTF", rr: "Round Robin",
      priority: "優先度", priority_pre: "優先度(P)", mlfq: "MLFQ",
    };
    const items = [
      { label: "アルゴリズム", value: algoNames[result.algorithm] ?? result.algorithm, color: "#88ccff" },
      { label: "平均TAT", value: result.avgTurnaround.toFixed(1), color: "#4dd0e1" },
      { label: "平均待ち", value: result.avgWait.toFixed(1), color: "#ffca28" },
      { label: "平均応答", value: result.avgResponse.toFixed(1), color: "#66bb6a" },
      { label: "CPU利用率", value: `${result.cpuUtilization.toFixed(0)}%`, color: "#ef5350" },
      { label: "総時間", value: `${result.totalTime}`, color: "#aaa" },
    ];
    const html = items.map((i) => `
      <div style="text-align:center;">
        <div style="font-size:1.2rem;font-weight:bold;color:${i.color};">${i.value}</div>
        <div style="font-size:0.7rem;color:#888;">${i.label}</div>
      </div>
    `).join("");
    return this.card("統計", `<div style="display:flex;gap:28px;justify-content:center;flex-wrap:wrap;">${html}</div>`);
  }

  private renderGantt(gantt: GanttEntry[], totalTime: number): string {
    const unitWidth = Math.max(Math.min(40, 800 / totalTime), 12);
    const bars = gantt.map((g) => {
      const w = (g.end - g.start) * unitWidth;
      const bg = g.pid !== null ? COLORS[(g.pid - 1) % COLORS.length]! : "#1a1a2e";
      const border = g.pid === null ? "1px dashed #333" : "none";
      const label = g.pid !== null ? `P${g.pid}` : "";
      return `<div style="width:${w}px;height:36px;background:${bg};border:${border};display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:bold;color:#000;flex-shrink:0;" title="${g.name}: ${g.start}~${g.end}">${w > 20 ? label : ""}</div>`;
    }).join("");

    // 時間目盛り
    const ticks: string[] = [];
    const step = totalTime <= 30 ? 1 : totalTime <= 60 ? 2 : 5;
    for (let t = 0; t <= totalTime; t += step) {
      ticks.push(`<span style="position:absolute;left:${t * unitWidth}px;font-size:0.65rem;color:#555;">${t}</span>`);
    }

    return this.card("ガントチャート", `
      <div style="overflow-x:auto;">
        <div style="display:flex;">${bars}</div>
        <div style="position:relative;height:16px;margin-top:2px;">${ticks.join("")}</div>
      </div>
      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap;">
        ${this.buildLegend(gantt)}
      </div>
    `);
  }

  private buildLegend(gantt: GanttEntry[]): string {
    const seen = new Set<number>();
    return gantt.filter((g) => {
      if (g.pid === null || seen.has(g.pid)) return false;
      seen.add(g.pid);
      return true;
    }).map((g) => {
      const color = COLORS[(g.pid! - 1) % COLORS.length]!;
      return `<span style="display:flex;align-items:center;gap:4px;font-size:0.75rem;">
        <span style="width:12px;height:12px;background:${color};border-radius:2px;display:inline-block;"></span>
        P${g.pid}(${g.name})
      </span>`;
    }).join("");
  }

  private renderProcessTable(stats: ProcessStats[]): string {
    const rows = stats.map((s) => {
      const color = COLORS[(s.pid - 1) % COLORS.length]!;
      return `<tr style="border-bottom:1px solid #1a1a30;">
        <td style="padding:5px 8px;"><span style="color:${color};font-weight:bold;">P${s.pid}</span> ${s.name}</td>
        <td style="padding:5px 8px;text-align:center;">${s.arrivalTime}</td>
        <td style="padding:5px 8px;text-align:center;">${s.finishTime}</td>
        <td style="padding:5px 8px;text-align:center;color:#4dd0e1;">${s.turnaroundTime}</td>
        <td style="padding:5px 8px;text-align:center;color:#ffca28;">${s.waitTime}</td>
        <td style="padding:5px 8px;text-align:center;color:#66bb6a;">${s.responseTime}</td>
      </tr>`;
    }).join("");
    return this.card("プロセス統計", `
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
        <thead><tr style="border-bottom:2px solid #333;color:#888;">
          <th style="padding:5px 8px;text-align:left;">プロセス</th>
          <th style="padding:5px 8px;">到着</th>
          <th style="padding:5px 8px;">完了</th>
          <th style="padding:5px 8px;">TAT</th>
          <th style="padding:5px 8px;">待ち</th>
          <th style="padding:5px 8px;">応答</th>
        </tr></thead><tbody>${rows}</tbody>
      </table>`);
  }

  private renderEvents(events: TimelineEvent[]): string {
    const typeIcons: Record<string, string> = {
      arrive: "📥", dispatch: "▶", preempt: "⏸", block_io: "💤",
      io_complete: "📂", terminate: "✓", idle: "💤", queue_demote: "⬇",
      context_switch: "🔄",
    };
    const typeColors: Record<string, string> = {
      arrive: "#66bb6a", dispatch: "#4dd0e1", preempt: "#ff9800", block_io: "#78909c",
      io_complete: "#ab47bc", terminate: "#4caf50", idle: "#555", queue_demote: "#ef5350",
      context_switch: "#ffca28",
    };
    const items = events.map((e) => `
      <div style="padding:3px 0;border-bottom:1px solid #111;display:flex;gap:6px;align-items:center;">
        <span style="min-width:28px;color:#555;font-size:0.7rem;font-family:monospace;text-align:right;">T=${e.time}</span>
        <span style="font-size:0.8rem;">${typeIcons[e.type] ?? "•"}</span>
        <span style="font-size:0.75rem;color:${typeColors[e.type] ?? "#888"};">${e.description}</span>
      </div>
    `).join("");
    return this.card(`イベントログ (${events.length})`, `<div style="max-height:400px;overflow-y:auto;">${items}</div>`);
  }
}
