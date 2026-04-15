/* ===== ファミコン シミュレーター UI ===== */

import { presets } from '../engine/presets';
import type { FamicomSimResult, StepSnapshot, FamicomEvent } from '../engine/types';
import { NES_PALETTE, FLAG_C, FLAG_Z, FLAG_I, FLAG_D, FLAG_B, FLAG_V, FLAG_N } from '../engine/types';

/* ---------- 色定義 ---------- */

const EVENT_COLORS: Record<string, string> = {
  cpu_fetch: '#61afef',
  cpu_execute: '#98c379',
  cpu_flag: '#e5c07b',
  memory_read: '#56b6c2',
  memory_write: '#d19a66',
  ppu_reg: '#c678dd',
  ppu_render: '#e06c75',
  ppu_scroll: '#c678dd',
  ppu_vblank: '#e06c75',
  sprite_dma: '#d19a66',
  apu_reg: '#56b6c2',
  controller: '#98c379',
  interrupt: '#e06c75',
  stack: '#e5c07b',
};

/* ---------- メイン ---------- */

function main(): void {
  const app = document.getElementById('app');
  if (!app) return;

  let currentResult: FamicomSimResult | null = null;
  let currentStep = 0;
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  let speed = 200;

  app.innerHTML = buildLayout();

  const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement;
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;
  const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
  const stepLabel = document.getElementById('step-label') as HTMLSpanElement;

  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  });

  runBtn.addEventListener('click', () => {
    const idx = parseInt(presetSelect.value, 10);
    const preset = presets[idx];
    if (!preset) return;
    currentResult = preset.build();
    currentStep = 0;
    stopPlay();
    render();
  });
  prevBtn.addEventListener('click', () => { if (currentStep > 0) { currentStep--; render(); } });
  nextBtn.addEventListener('click', () => {
    if (currentResult && currentStep < currentResult.steps.length - 1) { currentStep++; render(); }
  });
  playBtn.addEventListener('click', () => { if (playing) stopPlay(); else startPlay(); });
  speedSlider.addEventListener('input', () => {
    speed = 500 - parseInt(speedSlider.value, 10);
    if (playing) { stopPlay(); startPlay(); }
  });

  function startPlay(): void {
    playing = true;
    playBtn.textContent = '⏸ 停止';
    playTimer = setInterval(() => {
      if (!currentResult || currentStep >= currentResult.steps.length - 1) { stopPlay(); return; }
      currentStep++; render();
    }, speed);
  }

  function stopPlay(): void {
    playing = false;
    playBtn.textContent = '▶ 再生';
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
  }

  function render(): void {
    if (!currentResult) return;
    const step = currentResult.steps[currentStep];
    if (!step) return;
    stepLabel.textContent = `ステップ ${currentStep + 1} / ${currentResult.steps.length}`;
    renderDisasm(step);
    renderRegisters(step);
    renderFlags(step);
    renderStack(step);
    renderZeroPage(step);
    renderPPU(step);
    renderEvents(step);
    renderStats(currentResult);
    renderPalette(currentResult);
  }

  if (presets.length > 0) {
    currentResult = presets[0]!.build();
    render();
  }
}

/* ---------- レイアウト ---------- */

function buildLayout(): string {
  return `
    <div style="padding:12px;max-width:1500px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <h1 style="font-size:18px;color:#e06c75;margin:0;">🎮 Famicom Simulator</h1>
        <select id="preset-select" style="padding:6px 10px;background:#1e1e1e;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-family:inherit;font-size:13px;min-width:280px;"></select>
        <button id="run-btn" style="padding:6px 16px;background:#e06c75;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:bold;">実行</button>
        <button id="prev-btn" style="padding:6px 10px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">◀</button>
        <span id="step-label" style="color:#888;font-size:13px;min-width:140px;">ステップ 0 / 0</span>
        <button id="next-btn" style="padding:6px 10px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">▶</button>
        <button id="play-btn" style="padding:6px 12px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">▶ 再生</button>
        <input id="speed-slider" type="range" min="50" max="450" value="300" style="width:100px;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <!-- 左列: 命令 + レジスタ + フラグ -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="panel">
            <h3>📝 逆アセンブル</h3>
            <div id="disasm-content" style="font-size:15px;padding:6px;"></div>
          </div>
          <div class="panel">
            <h3>📟 CPUレジスタ</h3>
            <div id="regs-content"></div>
          </div>
          <div class="panel">
            <h3>🚩 ステータスフラグ (NV-BDIZC)</h3>
            <div id="flags-content" style="font-size:16px;"></div>
          </div>
          <div class="panel">
            <h3>📚 スタック ($0100-$01FF)</h3>
            <div id="stack-content"></div>
          </div>
          <div class="panel">
            <h3>🎨 パレット</h3>
            <div id="palette-content"></div>
          </div>
        </div>

        <!-- 中央列: ゼロページ + PPU -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="panel">
            <h3>📦 ゼロページ ($00-$1F)</h3>
            <div id="zp-content" style="font-size:12px;line-height:1.6;"></div>
          </div>
          <div class="panel">
            <h3>📺 PPU状態</h3>
            <div id="ppu-content"></div>
          </div>
          <div class="panel">
            <h3>📊 統計</h3>
            <div id="stats-content"></div>
          </div>
        </div>

        <!-- 右列: イベント -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="panel" style="flex:1;">
            <h3>📋 イベントログ</h3>
            <div id="events-content" style="max-height:600px;overflow-y:auto;"></div>
          </div>
        </div>
      </div>
    </div>
    <style>
      .panel {
        background: #1a1a2e;
        border: 1px solid #333;
        border-radius: 6px;
        padding: 10px;
      }
      .panel h3 {
        margin: 0 0 8px 0;
        font-size: 13px;
        color: #888;
        border-bottom: 1px solid #333;
        padding-bottom: 6px;
      }
    </style>
  `;
}

/* ---------- パネル描画 ---------- */

function renderDisasm(step: StepSnapshot): void {
  const el = document.getElementById('disasm-content');
  if (!el) return;
  el.innerHTML = `<span style="color:#e5c07b;font-weight:bold;">${step.disasm}</span>
    <span style="color:#666;margin-left:12px;">(${step.cycles} cycles)</span>`;
}

function renderRegisters(step: StepSnapshot): void {
  const el = document.getElementById('regs-content');
  if (!el) return;
  const r = step.regs;
  const regs: [string, number, string][] = [
    ['A', r.A, '#e06c75'],
    ['X', r.X, '#61afef'],
    ['Y', r.Y, '#98c379'],
    ['SP', r.SP, '#d19a66'],
    ['PC', r.PC, '#c678dd'],
  ];
  el.innerHTML = regs.map(([name, val, color]) => {
    const hex = name === 'PC' ? h4(val) : h2(val);
    return `<div style="display:inline-block;margin:4px 8px;text-align:center;">
      <div style="color:#888;font-size:11px;">${name}</div>
      <div style="color:${color};font-size:16px;font-weight:bold;">$${hex}</div>
      <div style="color:#555;font-size:10px;">${val}</div>
    </div>`;
  }).join('');
}

function renderFlags(step: StepSnapshot): void {
  const el = document.getElementById('flags-content');
  if (!el) return;
  const p = step.regs.P;
  const flags = [
    ['N', FLAG_N], ['V', FLAG_V], ['-', 0], ['B', FLAG_B],
    ['D', FLAG_D], ['I', FLAG_I], ['Z', FLAG_Z], ['C', FLAG_C],
  ] as const;
  el.innerHTML = flags.map(([name, mask]) => {
    if (name === '-') return '<span style="color:#444;margin:0 2px;">-</span>';
    const on = mask ? (p & mask) !== 0 : false;
    return `<span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;margin:2px;border-radius:4px;background:${on ? '#2a4a2a' : '#1a1a1a'};border:1px solid ${on ? '#98c379' : '#333'};color:${on ? '#98c379' : '#555'};font-weight:bold;">${name}</span>`;
  }).join('');
}

function renderStack(step: StepSnapshot): void {
  const el = document.getElementById('stack-content');
  if (!el) return;
  if (step.stackPreview.length === 0) {
    el.innerHTML = '<span style="color:#666;">(空)</span>';
    return;
  }
  el.innerHTML = step.stackPreview.map((v, i) =>
    `<span style="display:inline-block;padding:2px 6px;margin:1px;background:${i === 0 ? '#2a2a3a' : '#1a1a1a'};border:1px solid #333;border-radius:3px;font-size:12px;">
      <span style="color:#888;">+${i}:</span><span style="color:#e5c07b;">$${h2(v)}</span>
    </span>`
  ).join('');
}

function renderZeroPage(step: StepSnapshot): void {
  const el = document.getElementById('zp-content');
  if (!el) return;
  let html = '<div style="font-family:monospace;">';
  for (let row = 0; row < 2; row++) {
    const addr = row * 16;
    const hex: string[] = [];
    for (let col = 0; col < 16; col++) {
      const val = step.zpPreview[addr + col] ?? 0;
      const color = val !== 0 ? '#e5c07b' : '#444';
      hex.push(`<span style="color:${color};">${h2(val)}</span>`);
    }
    html += `<div><span style="color:#888;">${h2(addr)}:</span> ${hex.join(' ')}</div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function renderPPU(step: StepSnapshot): void {
  const el = document.getElementById('ppu-content');
  if (!el) return;
  const p = step.ppu;
  const rows: [string, string][] = [
    ['PPUCTRL ($2000)', `$${h2(p.ctrl)}`],
    ['PPUMASK ($2001)', `$${h2(p.mask)}`],
    ['PPUSTATUS ($2002)', `$${h2(p.status)}`],
    ['スキャンライン', `${p.scanline}`],
    ['サイクル', `${p.cycle}`],
    ['ScrollX', `${p.scrollX}`],
    ['ScrollY', `${p.scrollY}`],
  ];
  el.innerHTML = rows.map(([label, val]) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 4px;">
      <span style="color:#888;">${label}</span>
      <span style="color:#c678dd;">${val}</span>
    </div>`
  ).join('');
}

function renderEvents(step: StepSnapshot): void {
  const el = document.getElementById('events-content');
  if (!el) return;
  if (step.events.length === 0) {
    el.innerHTML = '<span style="color:#666;">イベントなし</span>';
    return;
  }
  el.innerHTML = step.events.map((ev: FamicomEvent) => {
    const color = EVENT_COLORS[ev.type] ?? '#abb2bf';
    return `<div style="padding:2px 4px;border-left:3px solid ${color};margin:2px 0;font-size:12px;">
      <span style="color:${color};font-size:11px;">[${ev.type}]</span>
      <span style="color:#ddd;">${ev.message}</span>
    </div>`;
  }).join('');
}

function renderStats(result: FamicomSimResult): void {
  const el = document.getElementById('stats-content');
  if (!el) return;
  const s = result.stats;
  const rows: [string, string][] = [
    ['命令実行数', String(s.totalInstructions)],
    ['消費サイクル', String(s.totalCycles)],
    ['メモリ読取', String(s.memoryReads)],
    ['メモリ書込', String(s.memoryWrites)],
    ['PPUアクセス', String(s.ppuAccesses)],
    ['割り込み', String(s.interrupts)],
    ['分岐', String(s.branches)],
    ['スタック操作', String(s.stackOps)],
  ];
  el.innerHTML = rows.map(([label, val]) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 4px;">
      <span style="color:#888;">${label}</span>
      <span style="color:#e5c07b;">${val}</span>
    </div>`
  ).join('');
}

function renderPalette(result: FamicomSimResult): void {
  const el = document.getElementById('palette-content');
  if (!el) return;
  const pal = result.palette;
  let html = '<div style="display:flex;flex-wrap:wrap;gap:2px;">';
  for (let i = 0; i < 32; i++) {
    const colorIdx = pal[i] ?? 0;
    const rgb = NES_PALETTE[colorIdx & 0x3F] ?? [0, 0, 0];
    const bg = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    const border = i % 4 === 0 ? '2px solid #666' : '1px solid #333';
    html += `<div style="width:20px;height:20px;background:${bg};border:${border};border-radius:2px;" title="$${h2(colorIdx)} (#${i})"></div>`;
    if (i === 15) html += '<br>';
  }
  html += '</div>';
  el.innerHTML = html;
}

/* ---------- ユーティリティ ---------- */

function h2(n: number): string { return (n & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
function h4(n: number): string { return (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }

/* ---------- 起動 ---------- */

main();
