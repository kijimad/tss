import {
  presets,
  runSegmentSimulation,
  runPagingSimulation,
  createSegmentTable,
  createPageTable,
} from "../mm/index.js";
import type { SimulationResult, TranslationStep, MemoryBlock, Preset } from "../mm/index.js";

export class MemMgrApp {
  private container!: HTMLElement;

  init(el: HTMLElement | null): void {
    if (!el) throw new Error("コンテナが見つかりません");
    this.container = el;
    this.render();
    this.runPreset(0);
  }

  private render(): void {
    this.container.innerHTML = `
      <div style="font-family: 'Segoe UI', system-ui, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; padding: 20px;">
        <div style="max-width: 1400px; margin: 0 auto;">
          <h1 style="font-size: 1.5rem; margin-bottom: 16px; color: #88ccff;">
            Memory Management Simulator
          </h1>
          <div style="margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
            <label style="font-size: 0.9rem; color: #aaa;">プリセット:</label>
            <select id="preset-select" style="
              padding: 8px 12px; background: #1a1a2e; color: #e0e0e0;
              border: 1px solid #333; border-radius: 6px; font-size: 0.9rem;
              min-width: 400px; cursor: pointer;
            ">
              ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
            </select>
          </div>
          <p id="preset-desc" style="color: #888; font-size: 0.85rem; margin-bottom: 20px;"></p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;" id="main-grid">
            <div id="panel-left"></div>
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

    const descEl = this.container.querySelector("#preset-desc") as HTMLElement;
    descEl.textContent = preset.description;

    let result: SimulationResult;
    if (preset.scheme === "segment" && preset.segmentTable) {
      const table = createSegmentTable(preset.segmentTable);
      result = runSegmentSimulation(table, preset.accesses);
    } else if (preset.scheme === "paging" && preset.pageTable) {
      const pageTable = createPageTable(preset.pageTable);
      result = runPagingSimulation(pageTable, preset.accesses, preset.pagingConfig);
    } else {
      return;
    }

    this.renderResult(result, preset);
  }

  private renderResult(result: SimulationResult, preset: Preset): void {
    const leftPanel = this.container.querySelector("#panel-left") as HTMLElement;
    const rightPanel = this.container.querySelector("#panel-right") as HTMLElement;

    // 左パネル: テーブル情報 + メモリマップ + 統計
    leftPanel.innerHTML = `
      ${this.renderTableInfo(preset)}
      ${this.renderMemoryMap(result.memoryMap)}
      ${this.renderStats(result)}
    `;

    // 右パネル: アドレス変換結果
    rightPanel.innerHTML = this.renderTranslations(result);
  }

  private renderTableInfo(preset: Preset): string {
    if (preset.scheme === "segment" && preset.segmentTable) {
      const rows = preset.segmentTable.map((s) => `
        <tr style="border-bottom: 1px solid #222;">
          <td style="padding: 6px 10px; color: #88ccff;">${s.id}</td>
          <td style="padding: 6px 10px;">${s.name}</td>
          <td style="padding: 6px 10px; font-family: monospace;">0x${s.base.toString(16).padStart(4, "0")}</td>
          <td style="padding: 6px 10px; font-family: monospace;">0x${s.limit.toString(16).padStart(4, "0")}</td>
          <td style="padding: 6px 10px;">${this.permBadges(s.readable, s.writable, s.executable)}</td>
          <td style="padding: 6px 10px;">${s.present ? '<span style="color:#4caf50;">●</span>' : '<span style="color:#f44336;">●</span>'}</td>
        </tr>
      `).join("");

      return `
        <div style="background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <h3 style="font-size: 0.95rem; color: #ffcc66; margin-bottom: 12px;">セグメントテーブル</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
            <thead><tr style="border-bottom: 2px solid #333; color: #888;">
              <th style="padding: 6px 10px; text-align: left;">ID</th>
              <th style="padding: 6px 10px; text-align: left;">名前</th>
              <th style="padding: 6px 10px; text-align: left;">ベース</th>
              <th style="padding: 6px 10px; text-align: left;">リミット</th>
              <th style="padding: 6px 10px; text-align: left;">権限</th>
              <th style="padding: 6px 10px; text-align: left;">状態</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }

    if (preset.scheme === "paging" && preset.pageTable) {
      const rows = preset.pageTable.map((p) => `
        <tr style="border-bottom: 1px solid #222;">
          <td style="padding: 6px 10px; color: #88ccff;">${p.pageNumber}</td>
          <td style="padding: 6px 10px; font-family: monospace;">${p.frameNumber}</td>
          <td style="padding: 6px 10px;">${this.permBadges(p.readable, p.writable, p.executable)}</td>
          <td style="padding: 6px 10px;">${p.present ? '<span style="color:#4caf50;">●</span>' : '<span style="color:#f44336;">●</span>'}</td>
        </tr>
      `).join("");

      return `
        <div style="background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <h3 style="font-size: 0.95rem; color: #ffcc66; margin-bottom: 12px;">ページテーブル</h3>
          ${preset.pagingConfig ? `<p style="font-size: 0.8rem; color: #888; margin-bottom: 8px;">ページサイズ: ${preset.pagingConfig.pageSize}B, TLBサイズ: ${preset.pagingConfig.tlbSize}エントリ</p>` : ""}
          <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
            <thead><tr style="border-bottom: 2px solid #333; color: #888;">
              <th style="padding: 6px 10px; text-align: left;">ページ#</th>
              <th style="padding: 6px 10px; text-align: left;">フレーム#</th>
              <th style="padding: 6px 10px; text-align: left;">権限</th>
              <th style="padding: 6px 10px; text-align: left;">状態</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }

    return "";
  }

  private permBadges(r: boolean, w: boolean, x: boolean): string {
    const badges: string[] = [];
    if (r) badges.push('<span style="background:#1b5e20;color:#a5d6a7;padding:1px 5px;border-radius:3px;font-size:0.75rem;">R</span>');
    if (w) badges.push('<span style="background:#b71c1c;color:#ef9a9a;padding:1px 5px;border-radius:3px;font-size:0.75rem;">W</span>');
    if (x) badges.push('<span style="background:#0d47a1;color:#90caf9;padding:1px 5px;border-radius:3px;font-size:0.75rem;">X</span>');
    return badges.join(" ");
  }

  private renderMemoryMap(memoryMap: MemoryBlock[]): string {
    // 表示用に先頭の数ブロックだけ使う（物理メモリ全体だと大きすぎる）
    const relevantBlocks = memoryMap.filter((b) => b.used || b.size <= 0x4000);
    const maxAddr = Math.max(...relevantBlocks.map((b) => b.start + b.size));
    const totalDisplay = Math.min(maxAddr, 0x10000);

    const barBlocks = relevantBlocks
      .filter((b) => b.start < totalDisplay)
      .map((b) => {
        const width = Math.max((b.size / totalDisplay) * 100, 1);
        const bg = b.used ? this.blockColor(b.label) : "#1a1a2e";
        const border = b.used ? "none" : "1px solid #333";
        return `<div title="${b.label}\n0x${b.start.toString(16)} - 0x${(b.start + b.size).toString(16)} (${b.size}B)"
          style="width:${width}%;height:28px;background:${bg};border:${border};
          display:flex;align-items:center;justify-content:center;
          font-size:0.65rem;overflow:hidden;white-space:nowrap;color:#fff;text-shadow:0 0 2px #000;">
          ${width > 5 ? b.label : ""}
        </div>`;
      }).join("");

    return `
      <div style="background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <h3 style="font-size: 0.95rem; color: #ffcc66; margin-bottom: 12px;">物理メモリマップ</h3>
        <div style="display: flex; width: 100%; border-radius: 4px; overflow: hidden;">
          ${barBlocks}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #666; margin-top: 4px;">
          <span>0x0000</span>
          <span>0x${totalDisplay.toString(16)}</span>
        </div>
      </div>
    `;
  }

  private blockColor(label: string): string {
    // ラベルからハッシュでカラー生成
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 50%, 30%)`;
  }

  private renderStats(result: SimulationResult): string {
    const s = result.stats;
    const items: string[] = [
      `<div style="text-align:center;"><div style="font-size:1.3rem;font-weight:bold;color:#88ccff;">${s.totalAccesses}</div><div style="font-size:0.75rem;color:#888;">総アクセス</div></div>`,
      `<div style="text-align:center;"><div style="font-size:1.3rem;font-weight:bold;color:#4caf50;">${s.successCount}</div><div style="font-size:0.75rem;color:#888;">成功</div></div>`,
      `<div style="text-align:center;"><div style="font-size:1.3rem;font-weight:bold;color:#f44336;">${s.errorCount}</div><div style="font-size:0.75rem;color:#888;">エラー</div></div>`,
    ];

    if (s.tlbHits !== undefined) {
      const hitRate = s.tlbHits + s.tlbMisses! > 0
        ? ((s.tlbHits / (s.tlbHits + s.tlbMisses!)) * 100).toFixed(1)
        : "0";
      items.push(
        `<div style="text-align:center;"><div style="font-size:1.3rem;font-weight:bold;color:#ffcc66;">${hitRate}%</div><div style="font-size:0.75rem;color:#888;">TLBヒット率</div></div>`,
        `<div style="text-align:center;"><div style="font-size:1.3rem;font-weight:bold;color:#ff9800;">${s.pageFaults ?? 0}</div><div style="font-size:0.75rem;color:#888;">ページフォールト</div></div>`
      );
    }
    if (s.segmentFaults !== undefined) {
      items.push(
        `<div style="text-align:center;"><div style="font-size:1.3rem;font-weight:bold;color:#ff9800;">${s.segmentFaults}</div><div style="font-size:0.75rem;color:#888;">セグメントフォールト</div></div>`
      );
    }

    return `
      <div style="background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px;">
        <h3 style="font-size: 0.95rem; color: #ffcc66; margin-bottom: 12px;">統計</h3>
        <div style="display: flex; gap: 20px; flex-wrap: wrap;">${items.join("")}</div>
      </div>
    `;
  }

  private renderTranslations(result: SimulationResult): string {
    const cards = result.translations.map((t, i) => {
      const statusColor = t.success ? "#4caf50" : "#f44336";
      const statusText = t.success ? "成功" : "エラー";

      const stepsHtml = t.steps.map((s) => this.renderStep(s)).join("");

      return `
        <div style="background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="font-size: 0.85rem; color: #ccc;">アクセス #${i + 1}</span>
            <span style="color: ${statusColor}; font-size: 0.8rem; font-weight: bold; padding: 2px 8px; border: 1px solid ${statusColor}; border-radius: 4px;">
              ${statusText}
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${stepsHtml}
          </div>
          ${t.success ? `<div style="margin-top: 8px; font-family: monospace; font-size: 0.85rem; color: #4caf50;">→ 物理アドレス: 0x${t.physicalAddress!.toString(16)}</div>` : ""}
          ${t.error ? `<div style="margin-top: 8px; font-size: 0.85rem; color: #f44336;">✗ ${t.error}</div>` : ""}
        </div>
      `;
    }).join("");

    return `
      <div>
        <h3 style="font-size: 0.95rem; color: #ffcc66; margin-bottom: 12px;">アドレス変換結果</h3>
        ${cards}
      </div>
    `;
  }

  private renderStep(step: TranslationStep): string {
    const colors: Record<string, string> = {
      info: "#78909c",
      lookup: "#7986cb",
      calc: "#4dd0e1",
      success: "#4caf50",
      error: "#f44336",
      tlb_hit: "#66bb6a",
      tlb_miss: "#ffa726",
      page_fault: "#ef5350",
    };
    const icons: Record<string, string> = {
      info: "ℹ",
      lookup: "🔍",
      calc: "⚙",
      success: "✓",
      error: "✗",
      tlb_hit: "⚡",
      tlb_miss: "○",
      page_fault: "⚠",
    };
    const color = colors[step.type] ?? "#888";
    const icon = icons[step.type] ?? "•";

    return `
      <div style="font-size: 0.8rem; color: ${color}; padding: 3px 0; padding-left: 16px; position: relative;">
        <span style="position: absolute; left: 0;">${icon}</span>
        ${step.description}
      </div>
    `;
  }
}
