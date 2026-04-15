/**
 * FTPシミュレーションのブラウザUIモジュール。
 * プリセット選択、ターミナル表示、ステップ表示、ファイルシステムツリー表示を行う。
 * @module ui/app
 */

import { presets, runSimulation, cloneFs } from "../ftp/index.js";
import type { SimulationResult, FsEntry } from "../ftp/index.js";

/**
 * FTPシミュレーションのブラウザアプリケーションクラス。
 * プリセット選択UI、ターミナルログ、ステップ一覧、ファイルシステムツリーを描画する。
 */
export class FtpApp {
  /** アプリケーションのルートコンテナ要素 */
  private container!: HTMLElement;

  /**
   * アプリケーションを初期化し、指定されたDOM要素にUIを描画する。
   * @param el - マウント先のHTML要素（nullの場合は何もしない）
   */
  init(el: HTMLElement | null): void {
    if (!el) return;
    this.container = el;
    this.render();
  }

  /** アプリケーション全体のHTML構造とスタイルを描画し、イベントリスナーを設定する */
  private render(): void {
    this.container.innerHTML = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: "SF Mono", "Cascadia Code", "Consolas", monospace; background: #0a0a0f; color: #c8ccd0; }
        .app { max-width: 1440px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 20px; color: #e2e5e8; margin-bottom: 16px; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        select { background: #1a1a2e; color: #c8ccd0; border: 1px solid #333; padding: 8px 12px;
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 320px; }
        .desc { color: #888; font-size: 12px; margin-bottom: 16px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .panel { background: #12121c; border: 1px solid #1e1e30; border-radius: 6px; padding: 14px; }
        .panel h2 { font-size: 13px; color: #7f8fa6; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .full { grid-column: 1 / -1; }
        .terminal { background: #000; border-radius: 4px; padding: 12px; font-size: 12px; line-height: 1.6;
                    max-height: 500px; overflow-y: auto; }
        .term-line { white-space: pre-wrap; word-break: break-all; }
        .term-client { color: #2ecc71; }
        .term-client::before { content: ">>> "; color: #27ae60; }
        .term-server { color: #3498db; }
        .term-server::before { content: "<<< "; color: #2980b9; }
        .term-data { color: #f39c12; font-style: italic; }
        .term-data::before { content: "--- "; color: #e67e22; }
        .step-card { border: 1px solid #1e1e30; border-radius: 4px; padding: 10px; margin-bottom: 8px;
                     background: #0d1117; }
        .step-num { color: #555; font-size: 10px; }
        .step-desc { color: #e2e5e8; font-size: 13px; margin: 4px 0; }
        .step-session { font-size: 11px; color: #666; }
        .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #fff; margin-right: 4px; }
        .badge-cmd { background: #2980b9; }
        .badge-data { background: #e67e22; }
        .badge-ok { background: #27ae60; }
        .badge-err { background: #e74c3c; }
        .fs-tree { font-size: 12px; line-height: 1.5; }
        .fs-dir { color: #3498db; font-weight: bold; }
        .fs-file { color: #c8ccd0; }
        .fs-size { color: #666; font-size: 10px; }
        .events-scroll { max-height: 520px; overflow-y: auto; }
      </style>
      <div class="app">
        <h1>FTP Protocol Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel full" id="terminal-panel"></div>
          <div class="panel" id="steps-panel"></div>
          <div class="panel" id="fs-panel"></div>
        </div>
      </div>
    `;

    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
    this.runPreset(0);
  }

  /**
   * 指定されたプリセットでFTPシミュレーションを実行し、結果を各パネルに描画する。
   * @param index - プリセット配列のインデックス
   */
  private runPreset(index: number): void {
    const preset = presets[index]!;
    const result = runSimulation(preset.users, cloneFs(preset.fs), preset.commands);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderTerminal(result);
    this.renderSteps(result);
    this.renderFs(result.finalFs);
  }

  /**
   * FTPセッションのコントロール接続ログをターミナル風に描画する。
   * クライアントコマンド、サーバーレスポンス、データ転送を色分けして表示する。
   * @param result - シミュレーション結果
   */
  private renderTerminal(result: SimulationResult): void {
    const el = this.container.querySelector("#terminal-panel")!;
    let html = "<h2>FTP Session (Control Connection)</h2><div class=\"terminal\">";

    for (const step of result.steps) {
      for (const msg of step.control) {
        const cls = msg.direction === "client" ? "term-client" : "term-server";
        html += `<div class="term-line ${cls}">${this.escapeHtml(msg.raw)}</div>`;
      }
      if (step.dataTransfer) {
        const dir = step.dataTransfer.direction === "upload" ? "UPLOAD"
          : step.dataTransfer.direction === "download" ? "DOWNLOAD" : "LISTING";
        const preview = step.dataTransfer.data.length > 200
          ? step.dataTransfer.data.slice(0, 200) + "..."
          : step.dataTransfer.data;
        html += `<div class="term-line term-data">[DATA ${dir} ${step.dataTransfer.size} bytes, mode=${step.dataTransfer.mode}]</div>`;
        for (const line of preview.split(/\r?\n/)) {
          html += `<div class="term-line term-data">  ${this.escapeHtml(line)}</div>`;
        }
      }
    }

    html += "</div>";
    el.innerHTML = html;
  }

  /**
   * シミュレーションの各ステップをカード形式で描画する。
   * コマンド名、成否バッジ、データ転送情報、セッション状態を表示する。
   * @param result - シミュレーション結果
   */
  private renderSteps(result: SimulationResult): void {
    const el = this.container.querySelector("#steps-panel")!;
    let html = "<h2>Steps</h2><div class=\"events-scroll\">";

    for (const step of result.steps) {
      const cmdBadge = step.command
        ? `<span class="badge badge-cmd">${step.command.cmd}</span>`
        : "";
      const dataBadge = step.dataTransfer
        ? `<span class="badge badge-data">${step.dataTransfer.direction} ${step.dataTransfer.size}B</span>`
        : "";
      const hasError = step.control.some((c) => c.direction === "server" && /^[45]/.test(c.raw));
      const statusBadge = step.command
        ? `<span class="badge ${hasError ? "badge-err" : "badge-ok"}">${hasError ? "ERR" : "OK"}</span>`
        : "";

      html += `<div class="step-card">
        <div class="step-num">Step ${step.step}</div>
        <div class="step-desc">${cmdBadge}${statusBadge}${dataBadge} ${this.escapeHtml(step.description)}</div>
        <div class="step-session">
          user=${step.session.username || "-"} cwd=${step.session.cwd}
          mode=${step.session.transferMode} type=${step.session.dataType}
        </div>
      </div>`;
    }

    html += "</div>";
    el.innerHTML = html;
  }

  /**
   * セッション終了後のファイルシステム状態をツリー形式で描画する。
   * @param fs - ファイルシステムのルートエントリ
   */
  private renderFs(fs: FsEntry): void {
    const el = this.container.querySelector("#fs-panel")!;
    let html = "<h2>File System (After Session)</h2><div class=\"fs-tree\">";
    html += this.renderFsEntry(fs, 0);
    html += "</div>";
    el.innerHTML = html;
  }

  /**
   * ファイルシステムエントリを再帰的にHTMLとして描画する。
   * ディレクトリはフォルダアイコン付き、ファイルはサイズ情報付きで表示する。
   * @param entry - 描画対象のファイルシステムエントリ
   * @param depth - インデントの深さ（ネスト階層）
   * @returns HTML文字列
   */
  private renderFsEntry(entry: FsEntry, depth: number): string {
    const indent = "&nbsp;".repeat(depth * 3);
    if (entry.type === "directory") {
      let html = `<div>${indent}<span class="fs-dir">📁 ${this.escapeHtml(entry.name)}/</span></div>`;
      for (const child of entry.children ?? []) {
        html += this.renderFsEntry(child, depth + 1);
      }
      return html;
    }
    return `<div>${indent}<span class="fs-file">📄 ${this.escapeHtml(entry.name)}</span> <span class="fs-size">(${entry.size}B)</span></div>`;
  }

  /**
   * HTML特殊文字をエスケープしてXSS攻撃を防止する。
   * @param s - エスケープ対象の文字列
   * @returns エスケープ済みの文字列
   */
  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
