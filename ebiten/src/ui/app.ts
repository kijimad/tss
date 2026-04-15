/**
 * Ebitenシミュレーター UI
 *
 * Canvas描画、プリセット選択、ステップ実行、状態インスペクタ、イベントログを提供。
 */

import { EbitenEngine } from "../ebiten/engine.js";
import { PRESETS } from "../presets/presets.js";
import type { EbitenPreset, EventLogEntry, GameStateSnapshot, PerformanceMetrics } from "../ebiten/types.js";

/** UI状態 */
let engine: EbitenEngine | null = null;
let currentPreset: EbitenPreset | null = null;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let canvasScale = 2;
let animId: number | null = null;

/** プリセット選択で初期化 */
function loadPreset(index: number): void {
  // 既存エンジン停止
  if (engine) engine.stop();
  if (animId !== null) cancelAnimationFrame(animId);

  const preset = PRESETS[index];
  if (!preset) return;
  currentPreset = preset;

  const game = preset.createGame();
  engine = new EbitenEngine(game, preset.screenWidth, preset.screenHeight);

  // Canvas設定
  canvas.width = preset.screenWidth * canvasScale;
  canvas.height = preset.screenHeight * canvasScale;
  ctx.imageSmoothingEnabled = false;

  // 入力バインド
  bindInput();
  updateInfo();
  renderCanvas();
}

/** Canvas描画 */
function renderCanvas(): void {
  if (!engine || !currentPreset) return;
  const screen = engine.getScreen();
  const pixels = screen.getPixels();
  const w = currentPreset.screenWidth;
  const h = currentPreset.screenHeight;

  const imageData = new ImageData(new Uint8ClampedArray(pixels), w, h);
  // 1xサイズで描画してからスケールアップ
  const offscreen = new OffscreenCanvas(w, h);
  const offCtx = offscreen.getContext("2d")!;
  offCtx.putImageData(imageData, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
}

/** 入力バインド */
function bindInput(): void {
  if (!engine) return;
  const input = engine.getInput();

  // キーボード
  document.onkeydown = (e) => {
    // UIショートカットとゲーム入力の両立
    if (e.key === "n" && !e.ctrlKey) { doStep(); return; }
    input.handleKeyDown(e.code || e.key);
  };
  document.onkeyup = (e) => {
    input.handleKeyUp(e.code || e.key);
  };

  // マウス（Canvas上のみ）
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    input.handleMouseMove(
      (e.clientX - rect.left) / canvasScale,
      (e.clientY - rect.top) / canvasScale,
    );
  };
  canvas.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    input.handleMouseDown(
      e.button,
      (e.clientX - rect.left) / canvasScale,
      (e.clientY - rect.top) / canvasScale,
    );
  };
  canvas.onmouseup = (e) => {
    input.handleMouseUp(e.button);
  };
}

/** 自動再生ループ */
function startLoop(): void {
  if (animId !== null) return;
  const loop = () => {
    if (!engine) return;
    engine.step();
    renderCanvas();
    updateInfo();
    animId = requestAnimationFrame(loop);
  };
  animId = requestAnimationFrame(loop);
}

/** 自動再生停止 */
function stopLoop(): void {
  if (animId !== null) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

/** 1ステップ実行 */
function doStep(): void {
  if (!engine) return;
  stopLoop();
  engine.step();
  renderCanvas();
  updateInfo();
}

/** 情報パネル更新 */
function updateInfo(): void {
  if (!engine) return;

  // メトリクス
  const m = engine.getMetrics();
  const metricsEl = document.getElementById("metrics")!;
  metricsEl.innerHTML = formatMetrics(m);

  // エンティティ
  const state = engine.getGameState();
  const entitiesEl = document.getElementById("entities")!;
  entitiesEl.innerHTML = formatEntities(state);

  // デバッグ情報
  const debugEl = document.getElementById("debug-info")!;
  debugEl.innerHTML = formatDebug(state);

  // イベントログ
  const events = engine.getEventLog();
  const eventsEl = document.getElementById("events")!;
  eventsEl.innerHTML = formatEvents(events);
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function formatMetrics(m: PerformanceMetrics): string {
  return `<tr><td>TPS</td><td>${m.currentTPS}</td></tr>
<tr><td>FPS</td><td>${m.currentFPS}</td></tr>
<tr><td>Update</td><td>${m.updateTimeMs.toFixed(2)}ms</td></tr>
<tr><td>Draw</td><td>${m.drawTimeMs.toFixed(2)}ms</td></tr>
<tr><td>Ticks</td><td>${m.totalTicks}</td></tr>
<tr><td>Frames</td><td>${m.totalFrames}</td></tr>`;
}

function formatEntities(state: GameStateSnapshot): string {
  if (state.entities.length === 0) return "<tr><td colspan='4'>なし</td></tr>";
  return state.entities.map(e => {
    const props = Object.entries(e.properties).map(([k, v]) => `${k}=${v}`).join(", ");
    return `<tr><td>${e.name}</td><td>${Math.round(e.x)}</td><td>${Math.round(e.y)}</td><td>${props}</td></tr>`;
  }).join("");
}

function formatDebug(state: GameStateSnapshot): string {
  return Object.entries(state.debugInfo).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join("");
}

const EVENT_COLORS: Record<string, string> = {
  input: "#4fc3f7",
  state: "#81c784",
  collision: "#ffb74d",
  audio: "#ce93d8",
  shader: "#f06292",
  system: "#90a4ae",
};

function formatEvents(events: EventLogEntry[]): string {
  const last50 = events.slice(-50);
  return last50.map(e => {
    const color = EVENT_COLORS[e.category] ?? "#aaa";
    return `<div style="color:${color}">[${e.tick}] <b>${e.category}</b> ${e.message}</div>`;
  }).join("");
}

/** DOM初期化 */
export function init(): void {
  canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  ctx = canvas.getContext("2d")!;

  // プリセットセレクト
  const select = document.getElementById("preset-select") as HTMLSelectElement;
  PRESETS.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i + 1}. ${p.name}`;
    select.appendChild(opt);
  });
  select.onchange = () => {
    stopLoop();
    loadPreset(Number(select.value));
  };

  // コントロールボタン
  document.getElementById("btn-play")!.onclick = startLoop;
  document.getElementById("btn-pause")!.onclick = stopLoop;
  document.getElementById("btn-step")!.onclick = doStep;
  document.getElementById("btn-reset")!.onclick = () => {
    stopLoop();
    loadPreset(Number(select.value));
  };

  // スケールスライダー
  const scaleSlider = document.getElementById("scale-slider") as HTMLInputElement;
  const scaleLabel = document.getElementById("scale-label")!;
  scaleSlider.oninput = () => {
    canvasScale = Number(scaleSlider.value);
    scaleLabel.textContent = `${canvasScale}x`;
    if (currentPreset) {
      canvas.width = currentPreset.screenWidth * canvasScale;
      canvas.height = currentPreset.screenHeight * canvasScale;
      ctx.imageSmoothingEnabled = false;
      renderCanvas();
    }
  };

  // プリセット詳細表示
  select.addEventListener("change", () => {
    const p = PRESETS[Number(select.value)];
    const descEl = document.getElementById("preset-desc")!;
    descEl.textContent = p ? p.description : "";
  });

  // 初期プリセット読み込み
  loadPreset(0);
  const descEl = document.getElementById("preset-desc")!;
  descEl.textContent = PRESETS[0]?.description ?? "";
}

// 起動
init();
