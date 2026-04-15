/**
 * EbitenEngine — ゲームループエンジン
 *
 * Ebitenのゲームループ（60TPS固定Update + 可変FPS Draw）をエミュレートする。
 * ステップ実行、一時停止、メトリクス計測、イベントログをサポート。
 */

import type {
  Game, PerformanceMetrics, EventLogEntry, EventCategory,
  GameStateSnapshot,
} from "./types.js";
import { DEFAULT_TPS } from "./types.js";
import { EbitenImage } from "./image.js";
import { InputManager } from "./input.js";
import { EbitenAudioContext } from "./audio.js";

/** シミュレーション結果（テスト用） */
export interface SimulationResult {
  /** 全ティックのスナップショット */
  snapshots: GameStateSnapshot[];
  /** メトリクス */
  metrics: PerformanceMetrics;
  /** イベントログ */
  events: EventLogEntry[];
  /** 最終スクリーン */
  screen: EbitenImage;
}

/** エンジン本体 */
export class EbitenEngine {
  private game: Game;
  private screen: EbitenImage;
  private input: InputManager;
  private audio: EbitenAudioContext;
  private metrics: PerformanceMetrics;
  private eventLog: EventLogEntry[];
  private running = false;
  private paused = false;
  private targetTPS: number;
  private tickCount = 0;
  private frameCount = 0;
  /** ブラウザのrAFで使うコールバックID */
  private animFrameId: number | null = null;
  /** TPS制御用のアキュムレータ（ms） */
  private accumulator = 0;
  private lastTimestamp = 0;

  constructor(game: Game, screenWidth: number, screenHeight: number) {
    this.game = game;
    this.screen = new EbitenImage(screenWidth, screenHeight);
    this.input = new InputManager();
    this.audio = new EbitenAudioContext();
    this.targetTPS = DEFAULT_TPS;
    this.metrics = {
      currentTPS: 0,
      currentFPS: 0,
      updateTimeMs: 0,
      drawTimeMs: 0,
      totalTicks: 0,
      totalFrames: 0,
    };
    this.eventLog = [];
    this.addEvent("system", "エンジン初期化完了");
  }

  /** ゲームループ開始 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    this.addEvent("system", "ゲームループ開始");
    this.animFrameId = requestAnimationFrame((ts) => this.loop(ts));
  }

  /** 一時停止 */
  pause(): void {
    this.paused = true;
    this.addEvent("system", "一時停止");
  }

  /** 再開 */
  resume(): void {
    if (!this.running) return;
    this.paused = false;
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    this.addEvent("system", "再開");
  }

  /** 停止 */
  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.addEvent("system", "ゲームループ停止");
  }

  /** 1ティック手動実行（ステップ実行用） */
  step(): void {
    this.runUpdate();
    this.runDraw();
  }

  /** N ティック一括実行（テスト用、rAF不使用） */
  runTicks(count: number): void {
    for (let i = 0; i < count; i++) {
      this.runUpdate();
    }
    this.runDraw();
  }

  /** メインループ（requestAnimationFrame） */
  private loop(timestamp: number): void {
    if (!this.running) return;

    if (!this.paused) {
      const delta = timestamp - this.lastTimestamp;
      this.lastTimestamp = timestamp;
      this.accumulator += delta;

      const tickInterval = 1000 / this.targetTPS;
      // Update()を固定TPS分だけ実行（最大10回で安全弁）
      let updates = 0;
      while (this.accumulator >= tickInterval && updates < 10) {
        this.runUpdate();
        this.accumulator -= tickInterval;
        updates++;
      }

      // Draw()は毎フレーム1回
      this.runDraw();
    }

    this.animFrameId = requestAnimationFrame((ts) => this.loop(ts));
  }

  /** Update実行 */
  private runUpdate(): void {
    const start = performance.now();
    const inputState = this.input.getState();
    const error = this.game.update(inputState);
    this.input.endTick();
    if (error) {
      this.addEvent("system", `Update エラー: ${error}`);
    }
    this.tickCount++;
    this.metrics.totalTicks = this.tickCount;
    this.metrics.updateTimeMs = performance.now() - start;
    // 簡易TPS計算（直近値）
    this.metrics.currentTPS = this.targetTPS;
  }

  /** Draw実行 */
  private runDraw(): void {
    const start = performance.now();
    this.screen.clear();
    this.game.draw(this.screen);
    this.frameCount++;
    this.metrics.totalFrames = this.frameCount;
    this.metrics.drawTimeMs = performance.now() - start;
    this.metrics.currentFPS = 60; // ブラウザのrAFは約60fps
  }

  /** イベントログ追加 */
  addEvent(category: EventCategory, message: string): void {
    this.eventLog.push({
      tick: this.tickCount,
      category,
      message,
    });
    // ログ上限
    if (this.eventLog.length > 500) {
      this.eventLog.splice(0, this.eventLog.length - 500);
    }
  }

  /** スクリーンバッファ取得 */
  getScreen(): EbitenImage { return this.screen; }
  /** メトリクス取得 */
  getMetrics(): PerformanceMetrics { return { ...this.metrics }; }
  /** イベントログ取得 */
  getEventLog(): EventLogEntry[] { return this.eventLog; }
  /** 入力マネージャ取得 */
  getInput(): InputManager { return this.input; }
  /** オーディオコンテキスト取得 */
  getAudio(): EbitenAudioContext { return this.audio; }
  /** ゲーム状態スナップショット取得 */
  getGameState(): GameStateSnapshot { return this.game.getStateSnapshot(); }
  /** ティック数取得 */
  getTickCount(): number { return this.tickCount; }
  /** 実行中か */
  isRunning(): boolean { return this.running; }
  /** 一時停止中か */
  isPaused(): boolean { return this.paused; }
  /** ゲームインスタンス取得 */
  getGame(): Game { return this.game; }
}

/**
 * テスト用: ゲームをN ティック実行してスナップショットを収集する
 */
export function simulateGame(game: Game, ticks: number, screenWidth = 320, screenHeight = 240): SimulationResult {
  const engine = new EbitenEngine(game, screenWidth, screenHeight);
  const snapshots: GameStateSnapshot[] = [];

  for (let i = 0; i < ticks; i++) {
    engine.step();
    snapshots.push(engine.getGameState());
  }

  return {
    snapshots,
    metrics: engine.getMetrics(),
    events: engine.getEventLog(),
    screen: engine.getScreen(),
  };
}
