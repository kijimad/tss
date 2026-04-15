/* ===== CDK シミュレーター UI ===== */

import { presets } from '../engine/presets';
import type { CdkSimResult, CdkStepSnapshot, ConstructNode, CdkPhase } from '../engine/types';

/* ---------- 色定義 ---------- */

const PHASE_COLORS: Record<CdkPhase, string> = {
  construct: '#7dd3fc',
  prepare: '#a78bfa',
  validate: '#fbbf24',
  aspect: '#f97316',
  synthesize: '#34d399',
  resolve: '#60a5fa',
  deploy: '#f472b6',
  complete: '#4ade80',
};

const EVENT_COLORS: Record<string, string> = {
  app_create: '#7dd3fc',
  stack_create: '#7dd3fc',
  construct_create: '#60a5fa',
  construct_add_child: '#818cf8',
  dependency_add: '#a78bfa',
  token_create: '#c084fc',
  token_resolve: '#e879f9',
  aspect_visit: '#f97316',
  aspect_warning: '#fbbf24',
  aspect_error: '#ef4444',
  aspect_fix: '#4ade80',
  synth_start: '#34d399',
  synth_resource: '#2dd4bf',
  synth_output: '#22d3ee',
  synth_export: '#38bdf8',
  synth_import: '#818cf8',
  synth_complete: '#4ade80',
  deploy_start: '#f472b6',
  deploy_resource_create: '#fb923c',
  deploy_resource_complete: '#4ade80',
  deploy_resource_failed: '#ef4444',
  deploy_rollback: '#f87171',
  deploy_complete: '#4ade80',
  info: '#888',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  creating: '#fbbf24',
  updating: '#60a5fa',
  deleting: '#f97316',
  complete: '#4ade80',
  failed: '#ef4444',
  rollback: '#f87171',
};

/* ---------- 状態 ---------- */

let currentResult: CdkSimResult | null = null;
let currentStep = 0;
let playing = false;
let playTimer = 0;
let speed = 500;

/* ---------- メイン ---------- */

function main(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = buildLayout();

  const select = document.getElementById('preset-select') as HTMLSelectElement;
  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  document.getElementById('btn-run')!.addEventListener('click', run);
  document.getElementById('btn-prev')!.addEventListener('click', () => stepTo(currentStep - 1));
  document.getElementById('btn-next')!.addEventListener('click', () => stepTo(currentStep + 1));
  document.getElementById('btn-play')!.addEventListener('click', togglePlay);
  document.getElementById('speed')!.addEventListener('input', (e) => {
    speed = 1050 - Number((e.target as HTMLInputElement).value);
  });

  run();
}

function run(): void {
  stopPlay();
  const idx = Number((document.getElementById('preset-select') as HTMLSelectElement).value);
  const preset = presets[idx];
  if (!preset) return;
  document.getElementById('preset-desc')!.textContent = preset.description;
  currentResult = preset.build();
  currentStep = 0;
  render();
}

function stepTo(n: number): void {
  if (!currentResult) return;
  currentStep = Math.max(0, Math.min(n, currentResult.steps.length - 1));
  render();
}

function togglePlay(): void {
  if (playing) { stopPlay(); return; }
  playing = true;
  document.getElementById('btn-play')!.textContent = '⏸';
  tick();
}

function stopPlay(): void {
  playing = false;
  clearTimeout(playTimer);
  document.getElementById('btn-play')!.textContent = '▶';
}

function tick(): void {
  if (!playing || !currentResult) return;
  if (currentStep < currentResult.steps.length - 1) {
    currentStep++;
    render();
    playTimer = window.setTimeout(tick, speed);
  } else {
    stopPlay();
  }
}

/* ---------- レイアウト ---------- */

function buildLayout(): string {
  return `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <select id="preset-select" style="background:#1a1a3a;color:#e0e0e0;border:1px solid #333;padding:6px 10px;border-radius:4px;font-family:inherit;font-size:13px;min-width:240px"></select>
      <button id="btn-run" style="background:#1a1a3a;color:#7dd3fc;border:1px solid #333;padding:6px 14px;border-radius:4px;cursor:pointer;font-family:inherit">実行</button>
      <button id="btn-prev" style="background:#1a1a3a;color:#ccc;border:1px solid #333;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:inherit">◀</button>
      <button id="btn-next" style="background:#1a1a3a;color:#ccc;border:1px solid #333;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:inherit">▶</button>
      <button id="btn-play" style="background:#1a1a3a;color:#4ade80;border:1px solid #333;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:inherit">▶</button>
      <input id="speed" type="range" min="50" max="1000" value="550" style="width:100px" title="速度">
      <span id="step-info" style="color:#888;font-size:12px"></span>
    </div>
    <div id="preset-desc" style="color:#888;font-size:11px;margin-bottom:12px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px" id="panels">
      <div>
        <div id="panel-tree" class="panel"></div>
        <div id="panel-template" class="panel" style="margin-top:12px"></div>
      </div>
      <div>
        <div id="panel-aspects" class="panel"></div>
        <div id="panel-deploy" class="panel" style="margin-top:12px"></div>
      </div>
      <div>
        <div id="panel-events" class="panel"></div>
        <div id="panel-stats" class="panel" style="margin-top:12px"></div>
      </div>
    </div>
    <style>
      .panel{background:#111128;border:1px solid #1e1e3e;border-radius:6px;padding:12px;font-size:12px;max-height:400px;overflow-y:auto}
      .panel h3{font-size:12px;color:#7dd3fc;margin-bottom:8px;border-bottom:1px solid #1e1e3e;padding-bottom:4px}
      .tree-node{margin-left:16px;border-left:1px solid #333;padding-left:8px;margin-top:2px}
      .tree-root{margin-left:0;border-left:none;padding-left:0}
    </style>
  `;
}

/* ---------- 描画 ---------- */

function render(): void {
  if (!currentResult) return;
  const snap = currentResult.steps[currentStep];
  if (!snap) return;

  document.getElementById('step-info')!.textContent =
    `Step ${snap.step}/${currentResult.steps.length} — ${snap.phase.toUpperCase()} — ${snap.message}`;

  renderTree(snap);
  renderTemplate(snap);
  renderAspects(snap);
  renderDeploy(snap);
  renderEvents(snap);
  renderStats();
}

function renderTree(snap: CdkStepSnapshot): void {
  const el = document.getElementById('panel-tree')!;
  const constructs = snap.constructs;
  const roots = constructs.filter(c => c.parentId === null);

  let html = '<h3>Construct ツリー</h3>';
  for (const root of roots) {
    html += renderNode(root, constructs, 0);
  }
  el.innerHTML = html;
}

function renderNode(node: ConstructNode, all: ConstructNode[], depth: number): string {
  const kindColors: Record<string, string> = {
    app: '#7dd3fc', stack: '#a78bfa', l1: '#fbbf24', l2: '#34d399', l3: '#f472b6',
    output: '#22d3ee', parameter: '#818cf8', custom: '#888',
  };
  const color = kindColors[node.kind] ?? '#888';
  const cls = depth === 0 ? 'tree-root' : 'tree-node';
  const typeStr = node.cfnType ? ` <span style="color:#666">${node.cfnType}</span>` : '';
  const logStr = node.logicalId ? ` <span style="color:#555">[${node.logicalId}]</span>` : '';
  const depStr = node.dependsOn?.length ? ` <span style="color:#f97316">→ ${node.dependsOn.join(', ')}</span>` : '';

  let html = `<div class="${cls}">`;
  html += `<span style="color:${color};font-weight:bold">${esc(node.kind.toUpperCase())}</span> `;
  html += `${esc(node.name)}${typeStr}${logStr}${depStr}`;

  const children = all.filter(c => c.parentId === node.id);
  for (const child of children) {
    html += renderNode(child, all, depth + 1);
  }
  html += '</div>';
  return html;
}

function renderTemplate(snap: CdkStepSnapshot): void {
  const el = document.getElementById('panel-template')!;
  let html = '<h3>CloudFormation テンプレート</h3>';

  if (snap.templates.size === 0) {
    html += '<div style="color:#555">（合成未完了）</div>';
    el.innerHTML = html;
    return;
  }

  for (const [stackName, template] of snap.templates) {
    html += `<div style="color:#a78bfa;margin-bottom:4px">Stack: ${esc(stackName)}</div>`;

    /* Parameters */
    if (template.Parameters && Object.keys(template.Parameters).length > 0) {
      html += '<div style="color:#818cf8;margin:4px 0 2px">Parameters:</div>';
      for (const [id, def] of Object.entries(template.Parameters)) {
        html += `<div style="margin-left:12px;color:#ccc">${esc(id)}: <span style="color:#888">${esc(JSON.stringify(def))}</span></div>`;
      }
    }

    /* Resources */
    html += `<div style="color:#34d399;margin:4px 0 2px">Resources (${Object.keys(template.Resources).length}):</div>`;
    for (const [id, res] of Object.entries(template.Resources)) {
      const deps = res.DependsOn ? ` <span style="color:#f97316">DependsOn: [${res.DependsOn.join(', ')}]</span>` : '';
      html += `<div style="margin-left:12px">`;
      html += `<span style="color:#fbbf24">${esc(id)}</span>: <span style="color:#888">${esc(res.Type)}</span>${deps}`;
      if (res.Properties) {
        const propsStr = JSON.stringify(res.Properties, null, 2);
        if (propsStr.length <= 200) {
          html += `<pre style="color:#555;margin:2px 0 4px 12px;font-size:10px;white-space:pre-wrap">${esc(propsStr)}</pre>`;
        } else {
          html += `<pre style="color:#555;margin:2px 0 4px 12px;font-size:10px;white-space:pre-wrap">${esc(propsStr.slice(0, 200))}...</pre>`;
        }
      }
      html += '</div>';
    }

    /* Outputs */
    if (template.Outputs && Object.keys(template.Outputs).length > 0) {
      html += '<div style="color:#22d3ee;margin:4px 0 2px">Outputs:</div>';
      for (const [id, def] of Object.entries(template.Outputs)) {
        html += `<div style="margin-left:12px;color:#ccc">${esc(id)}: <span style="color:#888">${esc(JSON.stringify(def))}</span></div>`;
      }
    }
  }

  el.innerHTML = html;
}

function renderAspects(snap: CdkStepSnapshot): void {
  const el = document.getElementById('panel-aspects')!;
  let html = '<h3>Aspect 結果</h3>';

  if (snap.aspectResults.length === 0) {
    html += '<div style="color:#555">（Aspect未実行 or 問題なし）</div>';
  } else {
    for (const r of snap.aspectResults) {
      const color = r.severity === 'error' ? '#ef4444' : r.severity === 'warning' ? '#fbbf24' : '#4ade80';
      const icon = r.severity === 'error' ? '✗' : r.severity === 'warning' ? '⚠' : '✓';
      const fix = r.autoFixed ? ' <span style="color:#4ade80">[自動修正済]</span>' : '';
      html += `<div style="margin-bottom:6px">`;
      html += `<span style="color:${color}">${icon}</span> `;
      html += `<span style="color:#888">[${esc(r.aspectName)}]</span> `;
      html += `${esc(r.message)}${fix}`;
      html += `</div>`;
    }
  }

  /* Token一覧 */
  if (snap.tokens.length > 0) {
    html += '<h3 style="margin-top:12px">Token</h3>';
    for (const t of snap.tokens) {
      const resolved = t.resolved ? `→ ${JSON.stringify(t.resolved)}` : '（未解決）';
      html += `<div><span style="color:#c084fc">${esc(t.tokenId)}</span>: ${esc(t.targetLogicalId)}`;
      if (t.attribute) html += `.${esc(t.attribute)}`;
      html += ` <span style="color:#888">${esc(resolved)}</span></div>`;
    }
  }

  el.innerHTML = html;
}

function renderDeploy(snap: CdkStepSnapshot): void {
  const el = document.getElementById('panel-deploy')!;
  let html = '<h3>デプロイ状態</h3>';

  if (snap.deployedResources.length === 0) {
    html += '<div style="color:#555">（デプロイ未開始）</div>';
  } else {
    for (const r of snap.deployedResources) {
      const color = STATUS_COLORS[r.status] ?? '#888';
      html += `<div style="margin-bottom:4px">`;
      html += `<span style="color:${color}">●</span> `;
      html += `<span style="color:#fbbf24">${esc(r.logicalId)}</span> `;
      html += `<span style="color:#888">(${esc(r.type)})</span> `;
      html += `<span style="color:${color}">${esc(r.status.toUpperCase())}</span>`;
      if (r.status === 'complete') {
        html += ` <span style="color:#555;font-size:10px">${esc(r.physicalId)}</span>`;
      }
      html += `</div>`;
    }
  }

  el.innerHTML = html;
}

function renderEvents(snap: CdkStepSnapshot): void {
  const el = document.getElementById('panel-events')!;
  let html = '<h3>イベントログ</h3>';

  const eventsToShow = snap.events.slice(-50);
  for (const evt of eventsToShow) {
    const color = EVENT_COLORS[evt.type] ?? '#888';
    const phaseColor = PHASE_COLORS[evt.phase] ?? '#888';
    html += `<div style="margin-bottom:2px">`;
    html += `<span style="color:${phaseColor};font-size:10px">[${esc(evt.phase)}]</span> `;
    html += `<span style="color:${color}">${esc(evt.message)}</span>`;
    html += `</div>`;
  }

  el.innerHTML = html;
}

function renderStats(): void {
  if (!currentResult) return;
  const el = document.getElementById('panel-stats')!;
  const s = currentResult.stats;

  let html = '<h3>統計情報</h3>';
  html += `<div>Construct数: <span style="color:#7dd3fc">${s.totalConstructs}</span></div>`;
  html += `<div>リソース数: <span style="color:#34d399">${s.totalResources}</span></div>`;
  html += `<div>Token数: <span style="color:#c084fc">${s.totalTokens}</span></div>`;
  html += `<div>Aspect問題: <span style="color:#fbbf24">${s.totalAspectIssues}</span></div>`;
  html += `<div>デプロイ成功: <span style="color:#4ade80">${s.deployedCount}</span></div>`;
  html += `<div>デプロイ失敗: <span style="color:#ef4444">${s.failedCount}</span></div>`;
  html += `<div>スタック数: <span style="color:#a78bfa">${currentResult.stacks.length}</span></div>`;
  html += `<div>ステップ数: <span style="color:#888">${currentResult.steps.length}</span></div>`;
  html += `<div>イベント数: <span style="color:#888">${currentResult.events.length}</span></div>`;

  el.innerHTML = html;
}

/* ---------- ユーティリティ ---------- */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- 起動 ---------- */

document.addEventListener('DOMContentLoaded', main);
