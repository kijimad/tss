import { presets, compile } from "../compiler/index.js";
import type { CompileResult, Section, SymbolEntry, RelocationEntry, AstNode, CompileStep } from "../compiler/index.js";

export class ObjccApp {
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
          <h1 style="font-size:1.5rem;margin-bottom:16px;color:#88ccff;">Object File Compiler</h1>
          <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <label style="font-size:0.9rem;color:#aaa;">プリセット:</label>
            <select id="preset-select" style="padding:8px 12px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:6px;font-size:0.9rem;min-width:400px;cursor:pointer;">
              ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
            </select>
          </div>
          <p id="preset-desc" style="color:#888;font-size:0.85rem;margin-bottom:20px;"></p>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;" id="main-grid">
            <div id="panel-source"></div>
            <div id="panel-obj"></div>
            <div id="panel-steps"></div>
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
    const result = compile(preset.source);
    this.renderResult(preset.source, result);
  }

  private renderResult(source: string, result: CompileResult): void {
    const srcPanel = this.container.querySelector("#panel-source") as HTMLElement;
    const objPanel = this.container.querySelector("#panel-obj") as HTMLElement;
    const stepsPanel = this.container.querySelector("#panel-steps") as HTMLElement;

    // 左: ソースコード + トークン + AST
    srcPanel.innerHTML = `
      ${this.renderSource(source)}
      ${this.renderTokens(result)}
      ${result.ast ? this.renderAst(result.ast) : ""}
    `;

    // 中央: オブジェクトファイル
    objPanel.innerHTML = result.objectFile ? `
      ${this.renderSections(result.objectFile.sections)}
      ${this.renderSymbols(result.objectFile.symbols)}
      ${this.renderRelocations(result.objectFile.relocations)}
    ` : this.card("エラー", `<div style="color:#f44336;">${result.errors.join("<br>")}</div>`);

    // 右: コンパイルステップ
    stepsPanel.innerHTML = this.renderSteps(result.steps);
  }

  private card(title: string, content: string): string {
    return `<div style="background:#12121a;border:1px solid #222;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="font-size:0.9rem;color:#ffcc66;margin-bottom:10px;">${title}</h3>${content}</div>`;
  }

  private renderSource(source: string): string {
    const lines = source.split("\n").map((line, i) =>
      `<div style="display:flex;"><span style="color:#555;min-width:30px;text-align:right;padding-right:10px;user-select:none;">${i + 1}</span><span>${this.escapeHtml(line)}</span></div>`
    ).join("");
    return this.card("ソースコード", `<pre style="font-family:'Menlo','Consolas',monospace;font-size:0.8rem;line-height:1.5;overflow-x:auto;">${lines}</pre>`);
  }

  private renderTokens(result: CompileResult): string {
    const toks = result.tokens.filter((t) => t.kind !== "eof").map((t) => {
      const bg = this.tokenColor(t.kind);
      return `<span style="display:inline-block;background:${bg};padding:1px 6px;border-radius:3px;margin:2px;font-size:0.72rem;font-family:monospace;" title="${t.kind}">${this.escapeHtml(t.value)}</span>`;
    }).join("");
    return this.card(`トークン (${result.tokens.length - 1})`, `<div style="line-height:2;">${toks}</div>`);
  }

  private tokenColor(kind: string): string {
    if (["int", "return", "if", "else", "while", "for"].includes(kind)) return "#1a237e";
    if (kind === "number") return "#1b5e20";
    if (kind === "string") return "#4e342e";
    if (kind === "ident") return "#0d47a1";
    return "#333";
  }

  private renderAst(ast: AstNode): string {
    const treeHtml = this.astToHtml(ast, 0);
    return this.card("AST", `<div style="font-size:0.78rem;font-family:monospace;max-height:300px;overflow-y:auto;">${treeHtml}</div>`);
  }

  private astToHtml(node: AstNode, depth: number): string {
    const indent = "&nbsp;".repeat(depth * 2);
    const label = node.name ? `${node.kind} <span style="color:#88ccff;">${node.name}</span>` :
                  node.value !== undefined ? `${node.kind} <span style="color:#66bb6a;">${node.value}</span>` :
                  node.strValue !== undefined ? `${node.kind} <span style="color:#ffab91;">"${this.escapeHtml(node.strValue)}"</span>` :
                  node.op ? `${node.kind} <span style="color:#ce93d8;">${node.op}</span>` :
                  node.kind;
    let html = `<div>${indent}<span style="color:#aaa;">├─</span> ${label}</div>`;
    for (const child of node.children) {
      html += this.astToHtml(child, depth + 1);
    }
    return html;
  }

  private renderSections(sections: Section[]): string {
    const items = sections.map((s) => {
      const hexDump = this.hexDump(s.data);
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="color:#88ccff;font-weight:bold;font-size:0.85rem;">${s.name}</span>
            <span style="color:#666;font-size:0.75rem;">${s.data.length} bytes | align=${s.alignment} | ${s.flags.join(", ")}</span>
          </div>
          <div style="background:#0a0a12;border:1px solid #1a1a30;border-radius:4px;padding:8px;font-family:monospace;font-size:0.72rem;overflow-x:auto;max-height:150px;overflow-y:auto;">
            ${hexDump}
          </div>
        </div>`;
    }).join("");
    return this.card("セクション", items);
  }

  private hexDump(data: number[]): string {
    if (data.length === 0) return '<span style="color:#555;">(空)</span>';
    const lines: string[] = [];
    for (let i = 0; i < data.length; i += 16) {
      const addr = `<span style="color:#666;">${i.toString(16).padStart(4, "0")}:</span>`;
      const hex = data.slice(i, i + 16).map((b) => `<span style="color:#7986cb;">${(b ?? 0).toString(16).padStart(2, "0")}</span>`).join(" ");
      const ascii = data.slice(i, i + 16).map((b) => {
        const v = b ?? 0;
        return v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : ".";
      }).join("");
      lines.push(`${addr} ${hex.padEnd(48)}  <span style="color:#888;">${this.escapeHtml(ascii)}</span>`);
    }
    return lines.join("\n");
  }

  private renderSymbols(symbols: SymbolEntry[]): string {
    if (symbols.length === 0) return "";
    const rows = symbols.map((s) => `
      <tr style="border-bottom:1px solid #1a1a30;">
        <td style="padding:4px 8px;color:#88ccff;">${s.name}</td>
        <td style="padding:4px 8px;">${s.type}</td>
        <td style="padding:4px 8px;">${s.bind}</td>
        <td style="padding:4px 8px;font-family:monospace;">${s.section}</td>
        <td style="padding:4px 8px;font-family:monospace;">0x${s.offset.toString(16)}</td>
        <td style="padding:4px 8px;font-family:monospace;">${s.size}</td>
      </tr>
    `).join("");
    return this.card("シンボルテーブル", `
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
        <thead><tr style="border-bottom:2px solid #333;color:#888;">
          <th style="padding:4px 8px;text-align:left;">名前</th>
          <th style="padding:4px 8px;text-align:left;">種別</th>
          <th style="padding:4px 8px;text-align:left;">バインド</th>
          <th style="padding:4px 8px;text-align:left;">セクション</th>
          <th style="padding:4px 8px;text-align:left;">オフセット</th>
          <th style="padding:4px 8px;text-align:left;">サイズ</th>
        </tr></thead><tbody>${rows}</tbody>
      </table>`);
  }

  private renderRelocations(relocs: RelocationEntry[]): string {
    if (relocs.length === 0) return this.card("リロケーション", '<span style="color:#666;font-size:0.8rem;">リロケーションなし</span>');
    const rows = relocs.map((r) => `
      <tr style="border-bottom:1px solid #1a1a30;">
        <td style="padding:4px 8px;font-family:monospace;">${r.section}+0x${r.offset.toString(16)}</td>
        <td style="padding:4px 8px;"><span style="padding:2px 6px;background:#1a237e;border-radius:3px;font-size:0.72rem;">${r.type}</span></td>
        <td style="padding:4px 8px;color:#88ccff;">${r.symbol}</td>
        <td style="padding:4px 8px;font-family:monospace;">${r.addend >= 0 ? "+" : ""}${r.addend}</td>
      </tr>
    `).join("");
    return this.card(`リロケーション (${relocs.length})`, `
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
        <thead><tr style="border-bottom:2px solid #333;color:#888;">
          <th style="padding:4px 8px;text-align:left;">場所</th>
          <th style="padding:4px 8px;text-align:left;">種別</th>
          <th style="padding:4px 8px;text-align:left;">シンボル</th>
          <th style="padding:4px 8px;text-align:left;">加算値</th>
        </tr></thead><tbody>${rows}</tbody>
      </table>`);
  }

  private renderSteps(steps: CompileStep[]): string {
    const phaseColors: Record<string, string> = {
      lex: "#4dd0e1", parse: "#ce93d8", codegen: "#ffcc66", object: "#66bb6a",
    };
    const phaseLabels: Record<string, string> = {
      lex: "LEX", parse: "PARSE", codegen: "CODEGEN", object: "OBJ",
    };
    const items = steps.map((s) => {
      const color = phaseColors[s.phase] ?? "#888";
      const label = phaseLabels[s.phase] ?? s.phase;
      return `
        <div style="padding:6px 0;border-bottom:1px solid #1a1a30;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:${color}22;color:${color};padding:1px 6px;border-radius:3px;font-size:0.7rem;font-weight:bold;min-width:60px;text-align:center;">${label}</span>
            <span style="font-size:0.8rem;">${s.description}</span>
          </div>
          ${s.detail ? `<div style="font-size:0.72rem;color:#888;margin-top:4px;padding-left:72px;word-break:break-all;">${this.escapeHtml(s.detail)}</div>` : ""}
        </div>`;
    }).join("");
    return this.card(`コンパイル過程 (${steps.length} ステップ)`, `<div style="max-height:600px;overflow-y:auto;">${items}</div>`);
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
