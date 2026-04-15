/* ===== GraphQL シミュレーター UI ===== */

import { presets } from '../engine/presets';
import type { GQLSimResult, StepSnapshot, GQLEvent } from '../engine/types';

/* ---------- 色定義 ---------- */

const EVENT_COLORS: Record<string, string> = {
  lex: '#56b6c2',
  parse: '#61afef',
  validate: '#98c379',
  execute: '#c678dd',
  resolve: '#e5c07b',
  resolve_list: '#d19a66',
  coerce: '#56b6c2',
  directive: '#c678dd',
  fragment: '#61afef',
  variable: '#d19a66',
  error: '#e06c75',
  n_plus_one: '#e06c75',
  introspect: '#98c379',
};

const PHASE_LABELS: Record<string, string> = {
  lex: '字句解析',
  parse: '構文解析',
  validate: 'バリデーション',
  execute: '実行',
};

/* ---------- メイン ---------- */

function main(): void {
  const app = document.getElementById('app');
  if (!app) return;

  let currentResult: GQLSimResult | null = null;
  let currentStep = 0;
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  let speed = 400;

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
    if (playing) stopPlay(); else startPlay();
  });

  speedSlider.addEventListener('input', () => {
    speed = 700 - parseInt(speedSlider.value, 10);
    if (playing) { stopPlay(); startPlay(); }
  });

  function startPlay(): void {
    playing = true;
    playBtn.textContent = '⏸ 停止';
    playTimer = setInterval(() => {
      if (!currentResult || currentStep >= currentResult.steps.length - 1) {
        stopPlay(); return;
      }
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
    renderPhase(step);
    renderEvents(step);
    renderResult(currentResult);
    renderStats(currentResult);
    renderTokens(currentResult);
    renderAST(currentResult);
    renderErrors(currentResult);
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
    <div style="padding:12px;max-width:1500px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <h1 style="font-size:18px;color:#e5397d;margin:0;">⬡ GraphQL Simulator</h1>
        <select id="preset-select" style="padding:6px 10px;background:#1e1e1e;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-family:inherit;font-size:13px;min-width:280px;"></select>
        <button id="run-btn" style="padding:6px 16px;background:#e5397d;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:bold;">実行</button>
        <button id="prev-btn" style="padding:6px 10px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">◀</button>
        <span id="step-label" style="color:#888;font-size:13px;min-width:140px;">ステップ 0 / 0</span>
        <button id="next-btn" style="padding:6px 10px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">▶</button>
        <button id="play-btn" style="padding:6px 12px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;">▶ 再生</button>
        <input id="speed-slider" type="range" min="100" max="600" value="300" style="width:100px;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <!-- 左列 -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="panel">
            <h3>📍 現在のフェーズ</h3>
            <div id="phase-content" style="font-size:15px;padding:6px;"></div>
          </div>
          <div class="panel" style="flex:1;">
            <h3>🔤 トークン列</h3>
            <div id="tokens-content" style="max-height:300px;overflow-y:auto;font-size:12px;line-height:1.5;"></div>
          </div>
          <div class="panel">
            <h3>🌳 AST (操作)</h3>
            <div id="ast-content" style="max-height:300px;overflow-y:auto;font-size:12px;line-height:1.5;"></div>
          </div>
        </div>

        <!-- 中央列 -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="panel" style="flex:1;">
            <h3>📋 イベントログ</h3>
            <div id="events-content" style="max-height:500px;overflow-y:auto;"></div>
          </div>
          <div class="panel">
            <h3>⚠ エラー</h3>
            <div id="errors-content"></div>
          </div>
        </div>

        <!-- 右列 -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="panel">
            <h3>📊 統計</h3>
            <div id="stats-content"></div>
          </div>
          <div class="panel" style="flex:1;">
            <h3>📦 実行結果 (data)</h3>
            <div id="result-content" style="max-height:500px;overflow-y:auto;font-size:12px;"></div>
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

function renderPhase(step: StepSnapshot): void {
  const el = document.getElementById('phase-content');
  if (!el) return;
  const label = PHASE_LABELS[step.phase] ?? step.phase;
  const colors: Record<string, string> = {
    lex: '#56b6c2', parse: '#61afef', validate: '#98c379', execute: '#c678dd',
  };
  const color = colors[step.phase] ?? '#e0e0e0';
  el.innerHTML = `
    <span style="color:${color};font-weight:bold;font-size:16px;">${label}</span>
    <div style="color:#aaa;margin-top:4px;font-size:13px;">${step.message}</div>
  `;
}

function renderEvents(step: StepSnapshot): void {
  const el = document.getElementById('events-content');
  if (!el) return;
  if (step.events.length === 0) {
    el.innerHTML = '<span style="color:#666;">イベントなし</span>';
    return;
  }
  el.innerHTML = step.events.map((ev: GQLEvent) => {
    const color = EVENT_COLORS[ev.type] ?? '#abb2bf';
    const indent = ev.depth ? '  '.repeat(ev.depth) : '';
    return `<div style="padding:2px 4px;border-left:3px solid ${color};margin:2px 0;font-size:12px;">
      <span style="color:${color};">[${ev.type}]</span>
      <span style="color:#ddd;">${indent}${ev.message}</span>
      ${ev.path ? `<span style="color:#666;font-size:11px;"> (${ev.path})</span>` : ''}
    </div>`;
  }).join('');
}

function renderResult(result: GQLSimResult): void {
  const el = document.getElementById('result-content');
  if (!el) return;
  if (result.data === null) {
    el.innerHTML = '<span style="color:#666;">null</span>';
    return;
  }
  el.innerHTML = `<pre style="color:#98c379;white-space:pre-wrap;word-break:break-all;margin:0;">${JSON.stringify(result.data, null, 2)}</pre>`;
}

function renderStats(result: GQLSimResult): void {
  const el = document.getElementById('stats-content');
  if (!el) return;
  const s = result.stats;
  const rows: [string, string][] = [
    ['トークン数', String(s.tokenCount)],
    ['フィールド解決数', String(s.fieldResolves)],
    ['最大深度', String(s.maxDepth)],
    ['フラグメント展開', String(s.fragments)],
    ['ディレクティブ適用', String(s.directives)],
    ['変数解決', String(s.variables)],
    ['N+1問題検出', s.n1Queries > 0 ? `<span style="color:#e06c75;">${s.n1Queries}件</span>` : '0'],
  ];
  el.innerHTML = rows.map(([label, val]) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 4px;">
      <span style="color:#888;">${label}</span>
      <span style="color:#e5c07b;">${val}</span>
    </div>`
  ).join('');
}

function renderTokens(result: GQLSimResult): void {
  const el = document.getElementById('tokens-content');
  if (!el) return;
  el.innerHTML = result.tokens
    .filter(t => t.kind !== 'EOF')
    .map(t => {
      const colors: Record<string, string> = {
        Name: '#61afef', Int: '#d19a66', Float: '#d19a66', String: '#98c379',
        Boolean: '#d19a66', BraceL: '#888', BraceR: '#888', ParenL: '#888',
        ParenR: '#888', Colon: '#888', Bang: '#e06c75', Dollar: '#c678dd',
        At: '#c678dd', Spread: '#e5c07b',
      };
      const c = colors[t.kind] ?? '#e0e0e0';
      return `<span style="display:inline-block;padding:1px 5px;margin:1px;background:#222;border-radius:3px;border:1px solid #333;">
        <span style="color:#666;font-size:10px;">${t.kind}</span>
        <span style="color:${c};">${escapeHtml(t.value || t.kind)}</span>
      </span>`;
    }).join('');
}

function renderAST(result: GQLSimResult): void {
  const el = document.getElementById('ast-content');
  if (!el) return;
  if (!result.ast) {
    el.innerHTML = '<span style="color:#666;">AST なし</span>';
    return;
  }
  const lines: string[] = [];
  for (const def of result.ast.definitions) {
    renderASTNode(def, 0, lines);
  }
  el.innerHTML = lines.join('');
}

function renderASTNode(node: unknown, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;

  if (n['kind'] === 'Operation') {
    lines.push(`<div style="color:#c678dd;">${indent}${n['operation']}${n['name'] ? ' ' + n['name'] : ''}</div>`);
    const sels = n['selectionSet'] as unknown[] ?? [];
    for (const s of sels) renderASTNode(s, depth + 1, lines);
  } else if (n['kind'] === 'Field') {
    const alias = n['alias'] ? `${n['alias']}: ` : '';
    const args = (n['arguments'] as unknown[] ?? []).length;
    const argsStr = args > 0 ? `(${args}引数)` : '';
    lines.push(`<div style="color:#61afef;">${indent}${alias}<span style="color:#e5c07b;">${n['name']}</span>${argsStr}</div>`);
    const sels = n['selectionSet'] as unknown[] ?? [];
    for (const s of sels) renderASTNode(s, depth + 1, lines);
  } else if (n['kind'] === 'FragmentSpread') {
    lines.push(`<div style="color:#d19a66;">${indent}...${n['name']}</div>`);
  } else if (n['kind'] === 'InlineFragment') {
    lines.push(`<div style="color:#d19a66;">${indent}... on ${n['typeCondition'] ?? '?'}</div>`);
    const sels = n['selectionSet'] as unknown[] ?? [];
    for (const s of sels) renderASTNode(s, depth + 1, lines);
  } else if (n['kind'] === 'FragmentDef') {
    lines.push(`<div style="color:#98c379;">${indent}fragment ${n['name']} on ${n['typeCondition']}</div>`);
    const sels = n['selectionSet'] as unknown[] ?? [];
    for (const s of sels) renderASTNode(s, depth + 1, lines);
  }
}

function renderErrors(result: GQLSimResult): void {
  const el = document.getElementById('errors-content');
  if (!el) return;
  const allErrors = [...result.validationErrors, ...result.errors];
  if (allErrors.length === 0) {
    el.innerHTML = '<span style="color:#98c379;">エラーなし</span>';
    return;
  }
  el.innerHTML = allErrors.map(e =>
    `<div style="color:#e06c75;padding:2px 4px;border-left:3px solid #e06c75;margin:2px 0;font-size:12px;">${escapeHtml(e)}</div>`
  ).join('');
}

/* ---------- ユーティリティ ---------- */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- 起動 ---------- */

main();
