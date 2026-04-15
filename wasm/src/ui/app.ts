/* ===== WebAssembly シミュレーター UI ===== */

import { presets } from '../engine/presets';
import type { StepSnapshot, WasmSimResult, WasmEvent } from '../engine/types';

/* ---------- 色定義 ---------- */

const EVENT_COLORS: Record<string, string> = {
  decode: '#61afef',
  validate: '#98c379',
  instantiate: '#c678dd',
  stack_push: '#56b6c2',
  stack_pop: '#56b6c2',
  call: '#e5c07b',
  return: '#e5c07b',
  host_call: '#d19a66',
  memory_read: '#61afef',
  memory_write: '#e06c75',
  memory_grow: '#c678dd',
  global_read: '#56b6c2',
  global_write: '#e06c75',
  branch: '#d19a66',
  table_call: '#e5c07b',
  trap: '#e06c75',
  execute: '#abb2bf',
  block_enter: '#98c379',
  block_exit: '#98c379',
};

const SEV_COLORS: Record<string, string> = {
  info: '#98c379',
  detail: '#abb2bf',
  warn: '#e5c07b',
  error: '#e06c75',
};

/* ---------- メイン ---------- */

function main(): void {
  const app = document.getElementById('app');
  if (!app) return;

  let currentResult: WasmSimResult | null = null;
  let currentStep = 0;
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  let speed = 300;

  /* 初期レンダリング */
  app.innerHTML = buildLayout();

  const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement;
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;
  const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
  const stepLabel = document.getElementById('step-label') as HTMLSpanElement;

  /* プリセット選択肢を設定 */
  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  });

  /* イベントハンドラ */
  runBtn.addEventListener('click', () => {
    const idx = parseInt(presetSelect.value, 10);
    const preset = presets[idx];
    if (!preset) return;
    currentResult = preset.build();
    currentStep = 0;
    stopPlay();
    render();
  });

  prevBtn.addEventListener('click', () => {
    if (currentStep > 0) { currentStep--; render(); }
  });

  nextBtn.addEventListener('click', () => {
    if (currentResult && currentStep < currentResult.steps.length - 1) {
      currentStep++;
      render();
    }
  });

  playBtn.addEventListener('click', () => {
    if (playing) {
      stopPlay();
    } else {
      startPlay();
    }
  });

  speedSlider.addEventListener('input', () => {
    speed = 600 - parseInt(speedSlider.value, 10);
    if (playing) { stopPlay(); startPlay(); }
  });

  function startPlay(): void {
    playing = true;
    playBtn.textContent = '⏸ 停止';
    playTimer = setInterval(() => {
      if (!currentResult || currentStep >= currentResult.steps.length - 1) {
        stopPlay();
        return;
      }
      currentStep++;
      render();
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
    renderStack(step);
    renderLocals(step);
    renderGlobals(step);
    renderMemory(step);
    renderCallStack(step);
    renderEvents(step);
    renderStats(currentResult);
    renderInstruction(step);
    renderTable(step);
  }

  /* 初期実行 */
  if (presets.length > 0) {
    currentResult = presets[0]!.build();
    render();
  }
}

/* ---------- レイアウト ---------- */

function buildLayout(): string {
  return `
    <div style="padding:12px;max-width:1400px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <h1 style="font-size:18px;color:#61afef;margin:0;">🔧 WebAssembly Simulator</h1>
        <select id="preset-select" style="padding:6px 10px;background:#1e1e1e;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-family:inherit;font-size:13px;min-width:260px;"></select>
        <button id="run-btn" style="padding:6px 16px;background:#61afef;color:#000;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:bold;">実行</button>
        <button id="prev-btn" style="padding:6px 10px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">◀</button>
        <span id="step-label" style="color:#888;font-size:13px;min-width:140px;">ステップ 0 / 0</span>
        <button id="next-btn" style="padding:6px 10px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">▶</button>
        <button id="play-btn" style="padding:6px 12px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">▶ 再生</button>
        <input id="speed-slider" type="range" min="50" max="550" value="300" style="width:100px;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <!-- 左列: 命令 + スタック + ローカル -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div id="panel-instr" class="panel">
            <h3>📝 現在の命令</h3>
            <div id="instr-content" style="font-size:16px;color:#e5c07b;padding:8px;"></div>
          </div>
          <div id="panel-stack" class="panel">
            <h3>📚 オペランドスタック</h3>
            <div id="stack-content"></div>
          </div>
          <div id="panel-locals" class="panel">
            <h3>📦 ローカル変数</h3>
            <div id="locals-content"></div>
          </div>
          <div id="panel-globals" class="panel">
            <h3>🌐 グローバル変数</h3>
            <div id="globals-content"></div>
          </div>
        </div>

        <!-- 中央列: メモリ + テーブル -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div id="panel-memory" class="panel" style="flex:1;">
            <h3>💾 線形メモリ</h3>
            <div id="memory-content" style="font-size:11px;line-height:1.6;"></div>
          </div>
          <div id="panel-table" class="panel">
            <h3>📋 テーブル</h3>
            <div id="table-content"></div>
          </div>
          <div id="panel-callstack" class="panel">
            <h3>📞 コールスタック</h3>
            <div id="callstack-content"></div>
          </div>
        </div>

        <!-- 右列: イベント + 統計 -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div id="panel-stats" class="panel">
            <h3>📊 統計</h3>
            <div id="stats-content"></div>
          </div>
          <div id="panel-events" class="panel" style="flex:1;">
            <h3>📋 イベントログ</h3>
            <div id="events-content" style="max-height:500px;overflow-y:auto;"></div>
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

function renderInstruction(step: StepSnapshot): void {
  const el = document.getElementById('instr-content');
  if (!el) return;
  el.textContent = step.instruction;
}

function renderStack(step: StepSnapshot): void {
  const el = document.getElementById('stack-content');
  if (!el) return;
  if (step.stack.length === 0) {
    el.innerHTML = '<span style="color:#666;">(空)</span>';
    return;
  }
  /* スタックを上(top)から表示 */
  el.innerHTML = [...step.stack].reverse().map((v, i) => {
    const isTop = i === 0;
    const bg = isTop ? '#2a3a2a' : 'transparent';
    const label = isTop ? ' ← top' : '';
    return `<div style="padding:3px 6px;background:${bg};border-radius:3px;margin:1px 0;">
      <span style="color:#888;">${step.stack.length - 1 - i}:</span>
      <span style="color:#56b6c2;">${v.type}</span>
      <span style="color:#e5c07b;">${formatValue(v)}</span>
      <span style="color:#666;font-size:11px;">${label}</span>
    </div>`;
  }).join('');
}

function renderLocals(step: StepSnapshot): void {
  const el = document.getElementById('locals-content');
  if (!el) return;
  if (step.locals.length === 0) {
    el.innerHTML = '<span style="color:#666;">(なし)</span>';
    return;
  }
  el.innerHTML = step.locals.map((v, i) =>
    `<div style="padding:2px 6px;">
      <span style="color:#888;">$${i}:</span>
      <span style="color:#56b6c2;">${v.type}</span> =
      <span style="color:#98c379;">${formatValue(v)}</span>
    </div>`
  ).join('');
}

function renderGlobals(step: StepSnapshot): void {
  const el = document.getElementById('globals-content');
  if (!el) return;
  if (step.globals.length === 0) {
    el.innerHTML = '<span style="color:#666;">(なし)</span>';
    return;
  }
  el.innerHTML = step.globals.map((v, i) =>
    `<div style="padding:2px 6px;">
      <span style="color:#888;">g${i}:</span>
      <span style="color:#56b6c2;">${v.type}</span> =
      <span style="color:#c678dd;">${formatValue(v)}</span>
    </div>`
  ).join('');
}

function renderMemory(step: StepSnapshot): void {
  const el = document.getElementById('memory-content');
  if (!el) return;
  if (step.memoryPages === 0) {
    el.innerHTML = '<span style="color:#666;">メモリなし</span>';
    return;
  }

  /* ヘッダ */
  let html = `<div style="color:#888;margin-bottom:4px;">${step.memoryPages}ページ (${step.memoryPages * 64}KB)</div>`;

  /* ヘックスダンプ（先頭256バイト） */
  const preview = step.memoryPreview;
  html += '<div style="font-family:monospace;">';
  for (let row = 0; row < Math.min(16, Math.ceil(preview.length / 16)); row++) {
    const addr = row * 16;
    const hex: string[] = [];
    const ascii: string[] = [];
    for (let col = 0; col < 16; col++) {
      const idx = addr + col;
      const byte = preview[idx] ?? 0;
      const isNonZero = byte !== 0;
      const color = isNonZero ? '#e5c07b' : '#444';
      hex.push(`<span style="color:${color};">${byte.toString(16).padStart(2, '0')}</span>`);
      ascii.push(byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.');
    }
    const addrStr = `<span style="color:#888;">${addr.toString(16).padStart(4, '0')}</span>`;
    html += `<div>${addrStr}: ${hex.join(' ')} <span style="color:#666;">|${ascii.join('')}|</span></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function renderTable(step: StepSnapshot): void {
  const el = document.getElementById('table-content');
  if (!el) return;
  if (step.table.length === 0) {
    el.innerHTML = '<span style="color:#666;">テーブルなし</span>';
    return;
  }
  el.innerHTML = step.table.map((v, i) =>
    `<span style="display:inline-block;padding:3px 8px;margin:2px;background:${v !== null ? '#2a2a3a' : '#1a1a1a'};border:1px solid #444;border-radius:3px;">
      <span style="color:#888;">[${i}]</span>
      <span style="color:${v !== null ? '#e5c07b' : '#666'};">${v !== null ? `func${v}` : 'null'}</span>
    </span>`
  ).join('');
}

function renderCallStack(step: StepSnapshot): void {
  const el = document.getElementById('callstack-content');
  if (!el) return;
  if (step.callStack.length === 0) {
    el.innerHTML = '<span style="color:#666;">(空)</span>';
    return;
  }
  el.innerHTML = [...step.callStack].reverse().map((f, i) =>
    `<div style="padding:2px 6px;${i === 0 ? 'color:#e5c07b;' : 'color:#888;'}">
      func${f.funcIndex} (pc=${f.pc})${i === 0 ? ' ← 現在' : ''}
    </div>`
  ).join('');
}

function renderEvents(step: StepSnapshot): void {
  const el = document.getElementById('events-content');
  if (!el) return;

  /* 全ステップのイベントを表示（累積） */
  const allEvents: { step: number; event: WasmEvent }[] = [];
  /* 現在のステップまでのイベントを収集（直近30件） */
  const result = (window as unknown as { __wasmResult?: WasmSimResult }).__wasmResult;
  if (result) {
    for (let s = 0; s <= Math.min(step.step, result.steps.length - 1); s++) {
      const st = result.steps[s];
      if (st) {
        for (const ev of st.events) {
          allEvents.push({ step: s, event: ev });
        }
      }
    }
  }
  /* 現在のステップのイベントだけ表示 */
  const events = step.events;
  if (events.length === 0) {
    el.innerHTML = '<span style="color:#666;">イベントなし</span>';
    return;
  }
  el.innerHTML = events.map(ev => {
    const color = EVENT_COLORS[ev.type] ?? '#abb2bf';
    const sevColor = SEV_COLORS[ev.severity] ?? '#abb2bf';
    return `<div style="padding:2px 4px;border-left:3px solid ${color};margin:2px 0;">
      <span style="color:${sevColor};font-size:11px;">[${ev.type}]</span>
      <span style="color:#ddd;font-size:12px;">${ev.message}</span>
    </div>`;
  }).join('');
}

function renderStats(result: WasmSimResult): void {
  const el = document.getElementById('stats-content');
  if (!el) return;
  const s = result.stats;
  const rows = [
    ['命令実行数', String(s.totalInstructions)],
    ['最大スタック深度', String(s.maxStackDepth)],
    ['最大コール深度', String(s.maxCallDepth)],
    ['メモリ最大ページ数', String(s.memoryPeakPages)],
    ['ホスト関数呼出', String(s.hostCalls)],
    ['分岐回数', String(s.branches)],
    ['トラップ数', String(s.traps)],
    ['戻り値', result.result ? result.result.map(v => `${v.type}:${formatValue(v)}`).join(', ') : '(なし)'],
  ];
  el.innerHTML = rows.map(([label, val]) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 4px;">
      <span style="color:#888;">${label}</span>
      <span style="color:#e5c07b;">${val}</span>
    </div>`
  ).join('');
}

/* ---------- ユーティリティ ---------- */

function formatValue(v: { type: string; value: unknown }): string {
  if (v.type === 'i64') return `${v.value}n`;
  if (v.type === 'f32' || v.type === 'f64') {
    const n = v.value as number;
    return Number.isInteger(n) ? `${n}.0` : String(n);
  }
  return String(v.value);
}

/* ---------- 起動 ---------- */

main();
