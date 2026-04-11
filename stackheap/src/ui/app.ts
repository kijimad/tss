/* スタック＆ヒープ シミュレーター UI */

import { simulate } from "../stackheap/engine.js";
import { PRESETS } from "../stackheap/presets.js";
import type { SimOp, StepResult, CallStack, Heap, MemoryLayout } from "../stackheap/types.js";

/** アプリ初期化 */
export function initApp(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="container">
      <h1>Stack &amp; Heap シミュレーター</h1>
      <div class="controls">
        <label for="preset">プリセット:</label>
        <select id="preset"></select>
        <button id="run">実行</button>
      </div>
      <div class="step-nav">
        <button id="prev" disabled>&lt; 前</button>
        <span id="step-info">-</span>
        <button id="next">次 &gt;</button>
      </div>
      <div id="output"></div>
    </div>
  `;

  const select = document.getElementById("preset") as HTMLSelectElement;
  PRESETS.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${p.name} — ${p.description}`;
    select.appendChild(opt);
  });

  document.getElementById("run")!.addEventListener("click", run);
  document.getElementById("prev")!.addEventListener("click", () => navigate(-1));
  document.getElementById("next")!.addEventListener("click", () => navigate(1));
  run();
}

let currentSteps: StepResult[] = [];
let currentStep = 0;

/** シミュレーション実行 */
function run(): void {
  const idx = parseInt((document.getElementById("preset") as HTMLSelectElement).value, 10);
  const preset = PRESETS[idx];
  const ops: SimOp[] = preset.build();
  const result = simulate(ops);
  currentSteps = result.steps;
  currentStep = 0;
  renderStep();
}

/** ステップナビゲーション */
function navigate(delta: number): void {
  currentStep = Math.max(0, Math.min(currentSteps.length - 1, currentStep + delta));
  renderStep();
}

/** 現在のステップを描画 */
function renderStep(): void {
  if (currentSteps.length === 0) return;
  const step = currentSteps[currentStep];

  (document.getElementById("prev") as HTMLButtonElement).disabled = currentStep === 0;
  (document.getElementById("next") as HTMLButtonElement).disabled = currentStep === currentSteps.length - 1;
  document.getElementById("step-info")!.textContent = `ステップ ${currentStep + 1} / ${currentSteps.length}`;

  const output = document.getElementById("output")!;
  output.innerHTML = `
    <div class="step-message ${step.warning ? 'warn' : ''}">
      <div class="msg">${esc(step.message)}</div>
      ${step.detail ? `<div class="detail">${esc(step.detail)}</div>` : ""}
      ${step.warning ? `<div class="warning">${esc(step.warning)}</div>` : ""}
    </div>
    <div class="mem-grid">
      <div class="mem-col">
        <h2>コールスタック</h2>
        ${renderStack(step.stack)}
      </div>
      <div class="mem-col">
        <h2>ヒープ</h2>
        ${renderHeap(step.heap)}
      </div>
    </div>
    <div class="layout-section">
      <h2>メモリレイアウト</h2>
      ${renderLayout(step.layout)}
    </div>
  `;
}

/** コールスタック描画 */
function renderStack(stack: CallStack): string {
  if (stack.frames.length === 0) {
    return '<div class="empty">スタック空</div>';
  }

  const used = 0x7FFF - stack.sp;
  let html = `<div class="stack-info">SP: 0x${stack.sp.toString(16)} | 使用: ${used}/${stack.maxSize} bytes${stack.overflow ? ' | <span class="overflow">OVERFLOW</span>' : ""}</div>`;

  // 上が高アドレス（最初のフレーム）、下が低アドレス（最新のフレーム）
  // 表示は下が最新のフレーム
  const reversed = [...stack.frames].reverse();
  html += '<div class="stack-frames">';
  reversed.forEach((frame, i) => {
    const isCurrent = i === 0;
    html += `
      <div class="frame ${isCurrent ? 'frame-current' : ''}">
        <div class="frame-header">${esc(frame.functionName)}()${isCurrent ? " (現在)" : ""}</div>
        <div class="frame-meta">BP: 0x${frame.basePointer.toString(16)} | Ret: 0x${frame.returnAddress.toString(16)} | ${frame.frameSize}B</div>
    `;
    // ローカル変数
    for (const v of frame.locals) {
      html += `<div class="var"><span class="var-name">${esc(v.name)}</span><span class="var-type">${v.value.type}</span><span class="var-val">${esc(v.value.display)}</span></div>`;
    }
    // 引数
    for (const a of frame.args) {
      html += `<div class="var arg"><span class="var-name">${esc(a.name)}</span><span class="var-type">${a.value.type} (arg)</span><span class="var-val">${esc(a.value.display)}</span></div>`;
    }
    html += `</div>`;
  });
  html += '</div>';
  return html;
}

/** ヒープ描画 */
function renderHeap(heap: Heap): string {
  if (heap.blocks.length === 0) {
    return '<div class="empty">ヒープ空</div>';
  }

  let html = `<div class="heap-info">使用: ${heap.totalAllocated}/${heap.maxSize} bytes | 断片化: ${heap.fragmentation}%</div>`;
  html += '<div class="heap-blocks">';
  for (const b of heap.blocks) {
    const cls = b.status === "allocated" ? "block-alloc" : b.status === "freed" ? "block-freed" : "block-corrupt";
    const statusLabel = b.status === "allocated" ? "割当済" : b.status === "freed" ? "解放済" : "破損";
    html += `
      <div class="heap-block ${cls}">
        <div class="block-header">
          <span class="block-addr">0x${b.address.toString(16)}</span>
          <span class="block-label">${esc(b.label)}</span>
          <span class="block-size">${b.size}B</span>
          <span class="block-status">${statusLabel}</span>
        </div>
        ${b.status === "allocated" ? `<div class="block-content">${esc(b.content)}</div>` : ""}
        ${b.marked ? '<div class="block-mark">GC: marked</div>' : ""}
      </div>
    `;
  }
  html += '</div>';
  return html;
}

/** メモリレイアウト描画 */
function renderLayout(layout: MemoryLayout): string {
  let html = '<div class="layout-bar">';
  for (const seg of layout.segments) {
    const size = seg.endAddr - seg.startAddr;
    const pct = Math.max(2, (size / layout.totalSize) * 100);
    html += `
      <div class="seg seg-${seg.region}" style="flex:${pct}" title="${seg.label}: 0x${seg.startAddr.toString(16)}-0x${seg.endAddr.toString(16)}">
        <span class="seg-label">${seg.label}</span>
        <span class="seg-addr">0x${seg.startAddr.toString(16)}</span>
        ${seg.used > 0 ? `<span class="seg-used">${seg.used}B</span>` : ""}
      </div>
    `;
  }
  html += '</div>';
  html += '<div class="layout-legend">低アドレス ← → 高アドレス</div>';
  return html;
}

/** HTMLエスケープ */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

initApp();
