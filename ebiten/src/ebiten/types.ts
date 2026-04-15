/**
 * Ebiten ゲームエンジン シミュレーター 型定義
 *
 * Go言語の2Dゲームエンジン Ebiten の主要概念をTypeScriptで再現する。
 * Game interface, Image, GeoM, Input, Audio, Shader の型を定義。
 */

// ─── 色 ───

/** RGBA色（各チャンネル 0〜1） */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 色スケール（DrawImageOptions用、各チャンネルに乗算される） */
export interface ColorScale {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ─── GeoM ───

/** 2Dアフィン変換行列データ（3x2、[a, b, c, d, tx, ty]） */
export interface GeoMData {
  /**
   * [a, b, c, d, tx, ty]
   * | a  b  tx |
   * | c  d  ty |
   * | 0  0  1  |
   * a,d = スケール、b,c = 回転/せん断、tx,ty = 平行移動
   */
  elements: [number, number, number, number, number, number];
}

// ─── 描画 ───

/** DrawImageのオプション */
export interface DrawImageOptions {
  geoM: GeoMData;
  colorScale: ColorScale;
  /** サブイメージ矩形（スプライトシート用） */
  subImage?: { x: number; y: number; width: number; height: number };
}

// ─── 入力 ───

/** キーボードキー */
export type Key =
  | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
  | "Space" | "Enter" | "Escape"
  | "KeyA" | "KeyD" | "KeyS" | "KeyW"
  | "KeyZ" | "KeyX";

/** マウスボタン */
export type MouseButton = "Left" | "Right" | "Middle";

/** 入力状態スナップショット */
export interface InputState {
  pressedKeys: Set<Key>;
  cursorX: number;
  cursorY: number;
  pressedMouseButtons: Set<MouseButton>;
  /** このティックで発生したクリック */
  clicks: Array<{ x: number; y: number; button: MouseButton }>;
}

// ─── オーディオ ───

/** 波形タイプ */
export type WaveType = "sine" | "square" | "triangle" | "sawtooth" | "noise";

/** オーディオプレイヤー状態 */
export interface AudioPlayerState {
  id: string;
  waveType: WaveType;
  frequency: number;
  volume: number;
  isPlaying: boolean;
  /** 再生位置（サンプル数） */
  position: number;
}

/** オーディオコンテキスト状態 */
export interface AudioState {
  sampleRate: number;
  /** PCMバッファ（可視化用、1フレーム分） */
  pcmBuffer: number[];
  players: AudioPlayerState[];
}

// ─── シェーダ ───

/** シェーダユニフォーム */
export interface ShaderUniforms {
  [key: string]: number | number[];
}

/** Kageシェーダ定義（per-pixel関数として表現） */
export interface KageShader {
  name: string;
  description: string;
  /** フラグメントシェーダ: (正規化座標, ソース色, ユニフォーム) → 出力色 */
  fragment: (
    position: { x: number; y: number },
    srcColor: Color,
    uniforms: ShaderUniforms,
  ) => Color;
}

// ─── ゲームインターフェース ───

/** エンティティ情報（インスペクタ用） */
export interface EntityInfo {
  name: string;
  x: number;
  y: number;
  properties: Record<string, string | number | boolean>;
}

/** ゲーム状態スナップショット（インスペクタ用） */
export interface GameStateSnapshot {
  entities: EntityInfo[];
  debugInfo: Record<string, string | number>;
}

/** Ebitenの Game interface に対応 */
export interface Game {
  /** ゲームロジック更新（60TPS固定）。null=正常、string=エラー */
  update(input: InputState): string | null;
  /** 画面描画 */
  draw(screen: PixelBuffer): void;
  /** レイアウト計算 */
  layout(outsideWidth: number, outsideHeight: number): { width: number; height: number };
  /** 状態スナップショット取得（インスペクタ用） */
  getStateSnapshot(): GameStateSnapshot;
}

/**
 * ピクセルバッファインターフェース。
 * EbitenImageの描画先として使用される。
 */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  fill(color: Color): void;
  clear(): void;
  setPixel(x: number, y: number, color: Color): void;
  getPixel(x: number, y: number): Color;
  drawRect(x: number, y: number, w: number, h: number, color: Color): void;
  drawCircle(cx: number, cy: number, r: number, color: Color): void;
  drawLine(x0: number, y0: number, x1: number, y1: number, color: Color): void;
  drawText(x: number, y: number, text: string, color: Color, scale?: number): void;
  drawImage(src: PixelBuffer, opts: DrawImageOptions): void;
  getPixels(): Uint8ClampedArray;
}

// ─── パフォーマンス ───

/** パフォーマンスメトリクス */
export interface PerformanceMetrics {
  currentTPS: number;
  currentFPS: number;
  updateTimeMs: number;
  drawTimeMs: number;
  totalTicks: number;
  totalFrames: number;
}

// ─── イベントログ ───

/** イベントカテゴリ */
export type EventCategory = "input" | "state" | "collision" | "audio" | "shader" | "system";

/** イベントログエントリ */
export interface EventLogEntry {
  tick: number;
  category: EventCategory;
  message: string;
}

// ─── プリセット ───

/** プリセット定義 */
export interface EbitenPreset {
  name: string;
  description: string;
  /** ゲームインスタンスを生成 */
  createGame(): Game;
  /** スクリーンサイズ */
  screenWidth: number;
  screenHeight: number;
}

// ─── 定数 ───

/** デフォルトTPS（Ebitenのデフォルト値） */
export const DEFAULT_TPS = 60;

/** デフォルトスクリーンサイズ */
export const DEFAULT_SCREEN_WIDTH = 320;
export const DEFAULT_SCREEN_HEIGHT = 240;
