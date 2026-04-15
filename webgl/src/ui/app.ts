/**
 * WebGL シミュレーター ブラウザUI
 *
 * プリセット選択 → Run ボタン → 左パネル（GL APIトレース）+ 右パネル（統計 + Canvas出力）
 * の構成でWebGLの動作を可視化する。
 */

import { presets } from '../engine/presets';
import type { WebGLSimResult } from '../engine/types';

/** ステージごとの色 */
const STAGE_COLORS: Record<string, string> = {
  API: '#94a3b8',
  STATE: '#fbbf24',
  VERTEX_FETCH: '#60a5fa',
  VERTEX_SHADER: '#34d399',
  PRIMITIVE_ASSEMBLY: '#a78bfa',
  RASTERIZATION: '#fb923c',
  FRAGMENT_SHADER: '#f472b6',
  PER_FRAGMENT_OPS: '#22d3ee',
  FRAMEBUFFER_WRITE: '#4ade80',
};

/** 重要度ごとの色 */
const SEV_COLORS: Record<string, string> = {
  info: '#94a3b8',
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
};

/** WebGLシミュレーターアプリケーション */
export class WebGLApp {
  /** UIを初期化してコンテナに描画する */
  init(container: HTMLElement): void {
    container.style.cssText = 'display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;';

    // ヘッダ
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-shrink:0;';

    const title = document.createElement('h1');
    title.textContent = 'WebGL Simulator';
    title.style.cssText = 'margin:0;font-size:15px;color:#60a5fa;';
    header.appendChild(title);

    // プリセット選択
    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;';
    for (let i = 0; i < presets.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = presets[i]?.name ?? '';
      select.appendChild(opt);
    }
    header.appendChild(select);

    // Runボタン
    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run';
    runBtn.style.cssText = 'padding:4px 16px;background:#60a5fa;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
    header.appendChild(runBtn);

    container.appendChild(header);

    // メインエリア
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;overflow:hidden;';

    // 左パネル: APIトレース
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = 'width:40%;display:flex;flex-direction:column;border-right:1px solid #1e293b;';

    const descLabel = document.createElement('div');
    descLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#60a5fa;border-bottom:1px solid #1e293b;flex-shrink:0;';
    descLabel.textContent = 'GL API トレース';
    leftPanel.appendChild(descLabel);

    const descArea = document.createElement('div');
    descArea.style.cssText = 'padding:8px 12px;font-size:12px;color:#94a3b8;white-space:pre-wrap;border-bottom:1px solid #1e293b;flex-shrink:0;max-height:80px;overflow-y:auto;';
    leftPanel.appendChild(descArea);

    const traceArea = document.createElement('div');
    traceArea.style.cssText = 'flex:1;padding:8px;font-family:monospace;font-size:11px;overflow-y:auto;';
    leftPanel.appendChild(traceArea);

    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow-y:auto;';

    // 統計
    const statsLabel = document.createElement('div');
    statsLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#60a5fa;border-bottom:1px solid #1e293b;flex-shrink:0;';
    statsLabel.textContent = 'パイプライン統計';
    rightPanel.appendChild(statsLabel);

    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = 'padding:8px 12px;font-family:monospace;font-size:12px;border-bottom:1px solid #1e293b;flex-shrink:0;';
    rightPanel.appendChild(statsDiv);

    // イベントログ
    const evtLabel = document.createElement('div');
    evtLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#60a5fa;border-bottom:1px solid #1e293b;flex-shrink:0;';
    evtLabel.textContent = 'パイプラインイベント';
    rightPanel.appendChild(evtLabel);

    const evtDiv = document.createElement('div');
    evtDiv.style.cssText = 'padding:8px;font-family:monospace;font-size:11px;max-height:200px;overflow-y:auto;border-bottom:1px solid #1e293b;flex-shrink:0;';
    rightPanel.appendChild(evtDiv);

    // Canvas
    const canvasLabel = document.createElement('div');
    canvasLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#60a5fa;border-bottom:1px solid #1e293b;flex-shrink:0;';
    canvasLabel.textContent = 'Framebuffer Output';
    rightPanel.appendChild(canvasLabel);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'padding:12px;flex-shrink:0;';
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    canvas.style.cssText = 'border:1px solid #334155;image-rendering:pixelated;width:256px;height:256px;';
    canvasWrap.appendChild(canvas);
    rightPanel.appendChild(canvasWrap);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // 描画ロジック
    const renderResult = (result: WebGLSimResult): void => {
      // APIトレース
      traceArea.innerHTML = '';
      for (const snap of result.snapshots) {
        const line = document.createElement('div');
        line.style.cssText = 'margin-bottom:2px;padding:2px 4px;border-radius:2px;';
        const stepSpan = `<span style="color:#475569">[${String(snap.step).padStart(3)}]</span>`;
        const apiSpan = `<span style="color:#60a5fa">${escapeHtml(snap.call.api)}</span>`;
        const argSpan = `<span style="color:#94a3b8">(${escapeHtml(snap.call.args.join(', '))})</span>`;
        let statsSpan = '';
        if (snap.stats) {
          statsSpan = ` <span style="color:#4ade80">→ ${String(snap.stats.pixelsWritten)}px</span>`;
        }
        line.innerHTML = `${stepSpan} ${apiSpan}${argSpan}${statsSpan}`;
        traceArea.appendChild(line);
      }

      // 統計
      const s = result.totalStats;
      statsDiv.innerHTML = [
        `<span style="color:#60a5fa">頂点フェッチ:</span> ${String(s.verticesFetched)}`,
        `<span style="color:#34d399">頂点シェーダ:</span> ${String(s.verticesTransformed)} 頂点変換`,
        `<span style="color:#a78bfa">プリミティブ:</span> ${String(s.primitivesAssembled)} 構成 / ${String(s.primitivesCulled)} カリング`,
        `<span style="color:#fb923c">ラスタライズ:</span> ${String(s.fragmentsGenerated)} フラグメント生成`,
        `<span style="color:#22d3ee">深度テスト通過:</span> ${String(s.fragmentsPassedDepth)}`,
        `<span style="color:#f472b6">ブレンド:</span> ${String(s.fragmentsBlended)}`,
        `<span style="color:#4ade80">ピクセル書込:</span> ${String(s.pixelsWritten)}`,
      ].join('<br>');

      // イベントログ
      evtDiv.innerHTML = '';
      for (const evt of result.events) {
        const line = document.createElement('div');
        line.style.marginBottom = '1px';
        const stageColor = STAGE_COLORS[evt.stage] ?? '#94a3b8';
        const sevColor = SEV_COLORS[evt.severity] ?? '#94a3b8';
        line.innerHTML = `<span style="color:${stageColor}">[${escapeHtml(evt.stage)}]</span> <span style="color:${sevColor}">${escapeHtml(evt.message)}</span>`;
        evtDiv.appendChild(line);
      }

      // Canvas描画
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = result.width;
        canvas.height = result.height;
        const imageData = ctx.createImageData(result.width, result.height);
        imageData.data.set(result.framebuffer);
        ctx.putImageData(imageData, 0, 0);
      }
    };

    // プリセット説明更新
    const updateDesc = (): void => {
      const preset = presets[Number(select.value)];
      if (preset) descArea.textContent = preset.description;
    };

    // イベントリスナー
    select.addEventListener('change', updateDesc);
    runBtn.addEventListener('click', () => {
      const preset = presets[Number(select.value)];
      if (!preset) return;
      updateDesc();
      const result = preset.build();
      renderResult(result);
    });

    // 初回実行
    updateDesc();
    runBtn.click();
  }
}

/** HTML エスケープ */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// アプリ起動
const app = new WebGLApp();
const el = document.getElementById('app');
if (el) app.init(el);
