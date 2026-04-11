import { presets, createIdt, runSimulation } from "../interrupt/index.js";
import type { SimulationResult, SimEvent, IdtEntry, PicState } from "../interrupt/index.js";

export class HwintApp {
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
          <h1 style="font-size:1.5rem;margin-bottom:16px;color:#88ccff;">Hardware Interrupt Simulator</h1>
          <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <label style="font-size:0.9rem;color:#aaa;">プリセット:</label>
            <select id="preset-select" style="padding:8px 12px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:6px;font-size:0.9rem;min-width:400px;cursor:pointer;">
              ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
            </select>
          </div>
          <p id="preset-desc" style="color:#888;font-size:0.85rem;margin-bottom:20px;"></p>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;" id="main-grid">
            <div id="panel-left"></div>
            <div id="panel-center"></div>
            <div id="panel-right"></div>
          </div>
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

    const idt = createIdt(preset.idt);
    const result = runSimulation(idt, preset.requests, preset.initialImr);
    this.renderResult(result, preset.idt, preset.initialImr);
  }

  private renderResult(result: SimulationResult, idtEntries: IdtEntry[], imr: number): void {
    const left = this.container.querySelector("#panel-left") as HTMLElement;
    const center = this.container.querySelector("#panel-center") as HTMLElement;
    const right = this.container.querySelector("#panel-right") as HTMLElement;

    left.innerHTML = `
      ${this.renderStats(result)}
      ${this.renderIdt(idtEntries)}
      ${this.renderPic(result.finalPic, imr)}
    `;

    center.innerHTML = this.renderTimeline(result);
    right.innerHTML = this.renderEvents(result.events);
  }

  private card(title: string, content: string): string {
    return `<div style="background:#12121a;border:1px solid #222;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="font-size:0.9rem;color:#ffcc66;margin-bottom:10px;">${title}</h3>${content}</div>`;
  }

  private renderStats(result: SimulationResult): string {
    const items = [
      { label: "処理済み", value: result.handledCount, color: "#4caf50" },
      { label: "マスク", value: result.maskedCount, color: "#f44336" },
      { label: "ネスト", value: result.nestedCount, color: "#ff9800" },
      { label: "総サイクル", value: result.totalCycles, color: "#88ccff" },
    ];
    const html = items.map((i) => `
      <div style="text-align:center;">
        <div style="font-size:1.4rem;font-weight:bold;color:${i.color};">${i.value}</div>
        <div style="font-size:0.72rem;color:#888;">${i.label}</div>
      </div>
    `).join("");
    return this.card("統計", `<div style="display:flex;gap:24px;justify-content:center;">${html}</div>`);
  }

  private renderIdt(entries: IdtEntry[]): string {
    const rows = entries.map((e) => {
      const clsColor = e.class === "hardware" ? "#4dd0e1" : e.class === "exception" ? "#f44336" : "#ce93d8";
      return `<tr style="border-bottom:1px solid #1a1a30;">
        <td style="padding:3px 6px;font-family:monospace;color:#88ccff;">${e.vector}</td>
        <td style="padding:3px 6px;">${e.name}</td>
        <td style="padding:3px 6px;"><span style="color:${clsColor};font-size:0.72rem;">${e.class}</span></td>
        <td style="padding:3px 6px;text-align:center;">${e.priority}</td>
        <td style="padding:3px 6px;">${e.maskable ? '<span style="color:#4caf50;">●</span>' : '<span style="color:#f44336;">NMI</span>'}</td>
      </tr>`;
    }).join("");
    return this.card("IDT（割り込み記述子テーブル）", `
      <div style="max-height:250px;overflow-y:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <thead><tr style="border-bottom:2px solid #333;color:#888;">
          <th style="padding:3px 6px;text-align:left;">Vec</th>
          <th style="padding:3px 6px;text-align:left;">名前</th>
          <th style="padding:3px 6px;text-align:left;">種別</th>
          <th style="padding:3px 6px;text-align:center;">優先度</th>
          <th style="padding:3px 6px;text-align:left;">マスク</th>
        </tr></thead><tbody>${rows}</tbody>
      </table></div>`);
  }

  private renderPic(pic: PicState, imr: number): string {
    const renderBits = (val: number, label: string): string => {
      const bits = Array.from({ length: 8 }, (_, i) => {
        const set = (val >> (7 - i)) & 1;
        const bg = set ? "#c62828" : "#1b5e20";
        return `<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:${bg};border-radius:3px;margin:1px;font-size:0.7rem;font-family:monospace;">${set}</span>`;
      }).join("");
      return `<div style="margin-bottom:8px;"><span style="color:#888;font-size:0.75rem;min-width:40px;display:inline-block;">${label}:</span>${bits}<span style="color:#555;font-size:0.7rem;margin-left:6px;">IRQ 7←0</span></div>`;
    };
    return this.card("PIC（割り込みコントローラ）", `
      ${renderBits(imr, "IMR")}
      ${renderBits(pic.irr, "IRR")}
      ${renderBits(pic.isr, "ISR")}
      <div style="font-size:0.7rem;color:#666;margin-top:4px;">IMR=マスク IRR=要求 ISR=処理中</div>
    `);
  }

  private renderTimeline(result: SimulationResult): string {
    const maxCycle = result.totalCycles;
    const events = result.events.filter((e) =>
      ["irq_raised", "handler_start", "handler_end", "irq_masked", "nmi", "context_save", "context_restore"].includes(e.type)
    );

    const bars = events.map((e) => {
      const left = (e.cycle / maxCycle) * 100;
      const color = this.eventColor(e.type);
      const icon = this.eventIcon(e.type);
      return `<div style="position:absolute;left:${left}%;transform:translateX(-50%);bottom:0;display:flex;flex-direction:column;align-items:center;" title="cycle ${e.cycle}: ${e.description}">
        <div style="font-size:0.6rem;color:${color};white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;">${e.description.substring(0, 15)}</div>
        <div style="width:3px;height:20px;background:${color};border-radius:1px;"></div>
        <div style="font-size:0.65rem;">${icon}</div>
        <div style="font-size:0.6rem;color:#555;">${e.cycle}</div>
      </div>`;
    }).join("");

    return this.card("タイムライン", `
      <div style="position:relative;height:100px;background:#0a0a12;border:1px solid #1a1a30;border-radius:4px;padding:10px;margin-bottom:8px;overflow-x:auto;">
        <div style="position:absolute;bottom:30px;left:0;right:0;height:1px;background:#333;"></div>
        ${bars}
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.7rem;">
        ${this.legendItem("#4caf50", "IRQ発生")}
        ${this.legendItem("#f44336", "マスク")}
        ${this.legendItem("#ff9800", "NMI")}
        ${this.legendItem("#4dd0e1", "ハンドラ開始")}
        ${this.legendItem("#7986cb", "ハンドラ終了")}
        ${this.legendItem("#ce93d8", "コンテキスト保存/復帰")}
      </div>
    `);
  }

  private legendItem(color: string, label: string): string {
    return `<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${color};border-radius:2px;display:inline-block;"></span>${label}</span>`;
  }

  private renderEvents(events: SimEvent[]): string {
    const items = events.map((e) => {
      const color = this.eventColor(e.type);
      const icon = this.eventIcon(e.type);
      return `<div style="padding:5px 0;border-bottom:1px solid #1a1a30;display:flex;gap:8px;align-items:flex-start;">
        <span style="min-width:36px;color:#555;font-size:0.72rem;font-family:monospace;text-align:right;">T=${e.cycle}</span>
        <span style="font-size:0.85rem;">${icon}</span>
        <div style="flex:1;">
          <div style="font-size:0.78rem;color:${color};">${e.description}</div>
          ${e.details ? `<div style="font-size:0.68rem;color:#666;margin-top:2px;">${Object.entries(e.details).map(([k, v]) => `${k}=${v}`).join(", ")}</div>` : ""}
        </div>
      </div>`;
    }).join("");
    return this.card(`イベントログ (${events.length})`, `<div style="max-height:600px;overflow-y:auto;">${items}</div>`);
  }

  private eventColor(type: SimEvent["type"]): string {
    const map: Record<string, string> = {
      irq_raised: "#4caf50", irq_masked: "#f44336", irq_pending: "#ffcc66",
      cpu_ack: "#4dd0e1", vector_dispatch: "#7986cb", context_save: "#ce93d8",
      mode_switch: "#ff9800", handler_start: "#4dd0e1", handler_end: "#7986cb",
      eoi: "#66bb6a", context_restore: "#ce93d8", mode_return: "#ff9800",
      nested_interrupt: "#ff5722", cli: "#ef5350", sti: "#66bb6a",
      exception: "#f44336", nmi: "#ff9800", info: "#888",
    };
    return map[type] ?? "#888";
  }

  private eventIcon(type: SimEvent["type"]): string {
    const map: Record<string, string> = {
      irq_raised: "⚡", irq_masked: "🚫", irq_pending: "⏳",
      cpu_ack: "✓", vector_dispatch: "🔍", context_save: "💾",
      mode_switch: "🔄", handler_start: "▶", handler_end: "■",
      eoi: "✉", context_restore: "📂", mode_return: "↩",
      nested_interrupt: "⚡⚡", cli: "🔒", sti: "🔓",
      exception: "⚠", nmi: "🔴", info: "ℹ",
    };
    return map[type] ?? "•";
  }
}
