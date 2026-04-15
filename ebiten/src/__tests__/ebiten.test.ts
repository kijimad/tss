/**
 * Ebitenシミュレーター テスト
 *
 * GeoM、EbitenImage、InputManager、Audio、Shader、Engine、全プリセットをテスト
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GeoM } from "../ebiten/geom.js";
import { EbitenImage, defaultColorScale, defaultGeoMData } from "../ebiten/image.js";
import { InputManager } from "../ebiten/input.js";
import {
  generateSineWave, generateSquareWave, generateTriangleWave,
  generateSawtoothWave, generateNoise, generateWave,
  EbitenAudioPlayer, EbitenAudioContext,
} from "../ebiten/audio.js";
import { BUILTIN_SHADERS, applyShader } from "../ebiten/shader.js";
import { EbitenEngine, simulateGame } from "../ebiten/engine.js";
import { PRESETS } from "../presets/presets.js";

// ─── GeoM テスト ───

describe("GeoM", () => {
  let g: GeoM;

  beforeEach(() => {
    g = new GeoM();
  });

  it("初期状態は単位行列", () => {
    const e = g.getElements();
    expect(e).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("translate: 平行移動", () => {
    g.translate(10, 20);
    const p = g.apply(0, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });

  it("scale: スケーリング", () => {
    g.scale(2, 3);
    const p = g.apply(5, 10);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(30);
  });

  it("rotate: 90度回転", () => {
    g.rotate(Math.PI / 2);
    const p = g.apply(1, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("concat: 行列の連結", () => {
    const g2 = new GeoM();
    g.translate(5, 0);
    g2.scale(2, 2);
    g.concat(g2);
    // this = translate(5,0) × scale(2,2)
    // apply(3,0): まずscale → (6,0) → translate → (11,0)
    const p = g.apply(3, 0);
    expect(p.x).toBeCloseTo(11);
    expect(p.y).toBeCloseTo(0);
  });

  it("invert: 逆行列", () => {
    g.translate(10, 20);
    g.scale(2, 3);
    const inv = g.invert();
    expect(inv).not.toBeNull();
    // 元の変換 → 逆変換 で元に戻る
    const p1 = g.apply(5, 7);
    const p2 = inv!.apply(p1.x, p1.y);
    expect(p2.x).toBeCloseTo(5);
    expect(p2.y).toBeCloseTo(7);
  });

  it("invert: ゼロ行列式で null", () => {
    g.scale(0, 0);
    expect(g.invert()).toBeNull();
  });

  it("reset: 単位行列に戻る", () => {
    g.translate(10, 20);
    g.reset();
    expect(g.getElements()).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("toData / fromData: シリアライゼーション", () => {
    g.translate(5, 10);
    g.rotate(0.5);
    const data = g.toData();
    const g2 = GeoM.fromData(data);
    expect(g2.getElements()).toEqual(g.getElements());
  });

  it("複合変換: translate→rotate→scale", () => {
    g.translate(-15, -15);
    g.rotate(Math.PI / 4);
    g.scale(2, 2);
    g.translate(100, 100);
    const p = g.apply(0, 0);
    // 変換が正常に適用されていることを確認
    expect(typeof p.x).toBe("number");
    expect(typeof p.y).toBe("number");
    expect(Number.isFinite(p.x)).toBe(true);
  });
});

// ─── EbitenImage テスト ───

describe("EbitenImage", () => {
  let img: EbitenImage;

  beforeEach(() => {
    img = new EbitenImage(10, 10);
  });

  it("バッファサイズが正しい", () => {
    expect(img.width).toBe(10);
    expect(img.height).toBe(10);
    expect(img.getPixels().length).toBe(10 * 10 * 4);
  });

  it("初期状態は透明黒", () => {
    const c = img.getPixel(0, 0);
    expect(c).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("fill: 塗りつぶし", () => {
    img.fill({ r: 1, g: 0.5, b: 0, a: 1 });
    const c = img.getPixel(5, 5);
    expect(c.r).toBeCloseTo(1, 1);
    expect(c.g).toBeCloseTo(0.5, 1);
    expect(c.b).toBeCloseTo(0, 1);
    expect(c.a).toBeCloseTo(1, 1);
  });

  it("clear: クリア", () => {
    img.fill({ r: 1, g: 1, b: 1, a: 1 });
    img.clear();
    const c = img.getPixel(0, 0);
    expect(c.a).toBe(0);
  });

  it("setPixel / getPixel: ピクセル読み書き", () => {
    img.setPixel(3, 4, { r: 0.2, g: 0.4, b: 0.6, a: 1 });
    const c = img.getPixel(3, 4);
    expect(c.r).toBeCloseTo(0.2, 1);
    expect(c.g).toBeCloseTo(0.4, 1);
    expect(c.b).toBeCloseTo(0.6, 1);
  });

  it("setPixel: 範囲外は無視", () => {
    // エラーが発生しないことを確認
    img.setPixel(-1, 0, { r: 1, g: 0, b: 0, a: 1 });
    img.setPixel(100, 0, { r: 1, g: 0, b: 0, a: 1 });
    expect(img.getPixel(0, 0).a).toBe(0);
  });

  it("getPixel: 範囲外は透明黒", () => {
    const c = img.getPixel(-1, -1);
    expect(c).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("drawRect: 矩形描画", () => {
    img.drawRect(2, 2, 3, 3, { r: 1, g: 0, b: 0, a: 1 });
    expect(img.getPixel(3, 3).r).toBeCloseTo(1, 1);
    expect(img.getPixel(0, 0).a).toBe(0); // 範囲外は未変更
  });

  it("drawCircle: 円描画", () => {
    img.drawCircle(5, 5, 3, { r: 0, g: 1, b: 0, a: 1 });
    // 中心は塗られている
    expect(img.getPixel(5, 5).g).toBeCloseTo(1, 1);
    // 角は塗られていない
    expect(img.getPixel(0, 0).a).toBe(0);
  });

  it("drawLine: 直線描画", () => {
    img.drawLine(0, 0, 9, 9, { r: 1, g: 1, b: 1, a: 1 });
    // 対角線上のピクセルが塗られている
    expect(img.getPixel(0, 0).r).toBeCloseTo(1, 1);
    expect(img.getPixel(5, 5).r).toBeCloseTo(1, 1);
    expect(img.getPixel(9, 9).r).toBeCloseTo(1, 1);
  });

  it("drawText: テキスト描画", () => {
    const big = new EbitenImage(100, 20);
    big.drawText(0, 0, "A", { r: 1, g: 1, b: 1, a: 1 });
    // 'A'の何かしらのピクセルが描画されている
    let hasPixel = false;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (big.getPixel(x, y).a > 0) hasPixel = true;
      }
    }
    expect(hasPixel).toBe(true);
  });

  it("drawImage: 単位行列で画像転写", () => {
    const src = new EbitenImage(5, 5);
    src.fill({ r: 1, g: 0, b: 0, a: 1 });
    const dst = new EbitenImage(10, 10);
    dst.drawImage(src, { geoM: defaultGeoMData(), colorScale: defaultColorScale() });
    // (2,2)は赤
    expect(dst.getPixel(2, 2).r).toBeCloseTo(1, 1);
    // (7,7)は未変更
    expect(dst.getPixel(7, 7).a).toBe(0);
  });

  it("drawImage: 平行移動付き", () => {
    const src = new EbitenImage(3, 3);
    src.fill({ r: 0, g: 1, b: 0, a: 1 });
    const dst = new EbitenImage(10, 10);
    const geoM = new GeoM();
    geoM.translate(5, 5);
    dst.drawImage(src, { geoM: geoM.toData(), colorScale: defaultColorScale() });
    // (6,6)は緑
    expect(dst.getPixel(6, 6).g).toBeCloseTo(1, 1);
    // (0,0)は未変更
    expect(dst.getPixel(0, 0).a).toBe(0);
  });

  it("drawImage: ColorScale適用", () => {
    const src = new EbitenImage(3, 3);
    src.fill({ r: 1, g: 1, b: 1, a: 1 });
    const dst = new EbitenImage(10, 10);
    dst.drawImage(src, {
      geoM: defaultGeoMData(),
      colorScale: { r: 0.5, g: 0, b: 0, a: 1 },
    });
    const c = dst.getPixel(1, 1);
    expect(c.r).toBeCloseTo(0.5, 1);
    expect(c.g).toBeCloseTo(0, 1);
  });

  it("アルファブレンディング", () => {
    img.fill({ r: 1, g: 0, b: 0, a: 1 }); // 赤背景
    img.setPixel(5, 5, { r: 0, g: 0, b: 1, a: 0.5 }); // 半透明青
    const c = img.getPixel(5, 5);
    // 赤と青のブレンド結果
    expect(c.r).toBeGreaterThan(0);
    expect(c.b).toBeGreaterThan(0);
    expect(c.a).toBeCloseTo(1, 1);
  });
});

// ─── InputManager テスト ───

describe("InputManager", () => {
  let input: InputManager;

  beforeEach(() => {
    input = new InputManager();
  });

  it("キー押下/解放", () => {
    input.handleKeyDown("ArrowUp");
    expect(input.isKeyPressed("ArrowUp")).toBe(true);
    input.handleKeyUp("ArrowUp");
    expect(input.isKeyPressed("ArrowUp")).toBe(false);
  });

  it("WASDキーマッピング", () => {
    input.handleKeyDown("w");
    expect(input.isKeyPressed("KeyW")).toBe(true);
  });

  it("マウス移動", () => {
    input.handleMouseMove(100, 200);
    const pos = input.cursorPosition();
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it("マウスボタン押下/解放", () => {
    input.handleMouseDown(0, 50, 60);
    expect(input.isMouseButtonPressed("Left")).toBe(true);
    input.handleMouseUp(0);
    expect(input.isMouseButtonPressed("Left")).toBe(false);
  });

  it("クリックイベント", () => {
    input.handleMouseDown(0, 50, 60);
    const state = input.getState();
    expect(state.clicks).toHaveLength(1);
    expect(state.clicks[0]).toEqual({ x: 50, y: 60, button: "Left" });
  });

  it("endTick: クリックリストクリア", () => {
    input.handleMouseDown(0, 50, 60);
    input.endTick();
    const state = input.getState();
    expect(state.clicks).toHaveLength(0);
  });

  it("simulateKeyPress/Release", () => {
    input.simulateKeyPress("Space");
    expect(input.isKeyPressed("Space")).toBe(true);
    input.simulateKeyRelease("Space");
    expect(input.isKeyPressed("Space")).toBe(false);
  });

  it("simulateClick", () => {
    input.simulateClick(100, 200);
    const state = input.getState();
    expect(state.clicks).toHaveLength(1);
    expect(state.clicks[0]!.x).toBe(100);
  });

  it("reset: 全状態クリア", () => {
    input.simulateKeyPress("ArrowUp");
    input.simulateClick(50, 50);
    input.reset();
    expect(input.isKeyPressed("ArrowUp")).toBe(false);
    expect(input.getState().clicks).toHaveLength(0);
  });

  it("getState: スナップショットは独立", () => {
    input.simulateKeyPress("ArrowUp");
    const state1 = input.getState();
    input.simulateKeyRelease("ArrowUp");
    // state1は変更されない
    expect(state1.pressedKeys.has("ArrowUp")).toBe(true);
  });
});

// ─── Audio テスト ───

describe("Audio", () => {
  describe("波形生成", () => {
    const sampleRate = 44100;
    const numSamples = 100;

    it("サイン波: 範囲が-1~1", () => {
      const buf = generateSineWave(440, sampleRate, numSamples);
      expect(buf).toHaveLength(numSamples);
      for (const v of buf) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("サイン波: 先頭は0付近", () => {
      const buf = generateSineWave(440, sampleRate, numSamples);
      expect(buf[0]).toBeCloseTo(0, 5);
    });

    it("矩形波: +1か-1", () => {
      const buf = generateSquareWave(440, sampleRate, numSamples);
      for (const v of buf) {
        expect(Math.abs(v)).toBeCloseTo(1, 5);
      }
    });

    it("三角波: 範囲が-1~1", () => {
      const buf = generateTriangleWave(440, sampleRate, numSamples);
      for (const v of buf) {
        expect(v).toBeGreaterThanOrEqual(-1.001);
        expect(v).toBeLessThanOrEqual(1.001);
      }
    });

    it("鋸歯状波: 範囲が-1~1", () => {
      const buf = generateSawtoothWave(440, sampleRate, numSamples);
      for (const v of buf) {
        expect(v).toBeGreaterThanOrEqual(-1.001);
        expect(v).toBeLessThanOrEqual(1.001);
      }
    });

    it("ノイズ: 再現性（同じシードで同じ出力）", () => {
      const buf1 = generateNoise(50, 123);
      const buf2 = generateNoise(50, 123);
      expect(buf1).toEqual(buf2);
    });

    it("generateWave: 全タイプが動作", () => {
      const types = ["sine", "square", "triangle", "sawtooth", "noise"] as const;
      for (const t of types) {
        const buf = generateWave(t, 440, sampleRate, numSamples);
        expect(buf).toHaveLength(numSamples);
      }
    });
  });

  describe("EbitenAudioPlayer", () => {
    it("play/pause切り替え", () => {
      const player = new EbitenAudioPlayer("test", "sine", 440);
      expect(player.isPlaying).toBe(false);
      player.play();
      expect(player.isPlaying).toBe(true);
      player.pause();
      expect(player.isPlaying).toBe(false);
    });

    it("setVolume: クランプ", () => {
      const player = new EbitenAudioPlayer("test", "sine", 440);
      player.setVolume(1.5);
      expect(player.volume).toBe(1);
      player.setVolume(-0.5);
      expect(player.volume).toBe(0);
    });

    it("getState: スナップショット", () => {
      const player = new EbitenAudioPlayer("p1", "square", 880);
      player.play();
      const state = player.getState();
      expect(state.id).toBe("p1");
      expect(state.waveType).toBe("square");
      expect(state.frequency).toBe(880);
      expect(state.isPlaying).toBe(true);
    });
  });

  describe("EbitenAudioContext", () => {
    it("プレイヤー作成/取得", () => {
      const ctx = new EbitenAudioContext();
      const p = ctx.createPlayer("bg", "sine", 440);
      expect(ctx.getPlayer("bg")).toBe(p);
      expect(ctx.getPlayer("missing")).toBeUndefined();
    });

    it("generateFrame: 再生中のプレイヤーをミキシング", () => {
      const ctx = new EbitenAudioContext(44100);
      const p1 = ctx.createPlayer("p1", "sine", 440);
      p1.play();
      const frame = ctx.generateFrame(100);
      expect(frame).toHaveLength(100);
      // 再生中なのでゼロでないサンプルが存在
      expect(frame.some(v => v !== 0)).toBe(true);
    });

    it("generateFrame: 再生していないプレイヤーは無視", () => {
      const ctx = new EbitenAudioContext(44100);
      ctx.createPlayer("p1", "sine", 440); // play()しない
      const frame = ctx.generateFrame(100);
      // 全サンプルがゼロ
      expect(frame.every(v => v === 0)).toBe(true);
    });

    it("getState: スナップショット", () => {
      const ctx = new EbitenAudioContext(22050);
      ctx.createPlayer("p1", "sine", 440);
      const state = ctx.getState();
      expect(state.sampleRate).toBe(22050);
      expect(state.players).toHaveLength(1);
    });
  });
});

// ─── Shader テスト ───

describe("Shader", () => {
  it("組み込みシェーダが7種類", () => {
    expect(BUILTIN_SHADERS).toHaveLength(7);
  });

  it("grayscale: 白は白のまま", () => {
    const gs = BUILTIN_SHADERS.find(s => s.name === "grayscale")!;
    const result = gs.fragment({ x: 0.5, y: 0.5 }, { r: 1, g: 1, b: 1, a: 1 }, {});
    expect(result.r).toBeCloseTo(1);
    expect(result.g).toBeCloseTo(1);
    expect(result.b).toBeCloseTo(1);
  });

  it("grayscale: 赤のルミナンス", () => {
    const gs = BUILTIN_SHADERS.find(s => s.name === "grayscale")!;
    const result = gs.fragment({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 1 }, {});
    expect(result.r).toBeCloseTo(0.299, 2);
    expect(result.g).toBeCloseTo(0.299, 2);
  });

  it("invert: 色反転", () => {
    const inv = BUILTIN_SHADERS.find(s => s.name === "invert")!;
    const result = inv.fragment({ x: 0, y: 0 }, { r: 1, g: 0, b: 0.5, a: 1 }, {});
    expect(result.r).toBeCloseTo(0);
    expect(result.g).toBeCloseTo(1);
    expect(result.b).toBeCloseTo(0.5);
  });

  it("sepia: 変換結果が有効範囲", () => {
    const sp = BUILTIN_SHADERS.find(s => s.name === "sepia")!;
    const result = sp.fragment({ x: 0, y: 0 }, { r: 0.5, g: 0.5, b: 0.5, a: 1 }, {});
    expect(result.r).toBeGreaterThanOrEqual(0);
    expect(result.r).toBeLessThanOrEqual(1);
  });

  it("applyShader: 画像全体に適用", () => {
    const src = new EbitenImage(4, 4);
    src.fill({ r: 1, g: 0, b: 0, a: 1 });
    const dst = new EbitenImage(4, 4);
    const inv = BUILTIN_SHADERS.find(s => s.name === "invert")!;
    applyShader(src, dst, inv, {});
    const c = dst.getPixel(2, 2);
    expect(c.r).toBeCloseTo(0, 1);
    expect(c.g).toBeCloseTo(1, 1);
  });

  it("全シェーダがエラーなしで実行", () => {
    const src = new EbitenImage(8, 8);
    src.fill({ r: 0.5, g: 0.3, b: 0.7, a: 1 });
    const dst = new EbitenImage(8, 8);
    for (const shader of BUILTIN_SHADERS) {
      applyShader(src, dst, shader, { time: 1, strength: 0.5 });
      const c = dst.getPixel(4, 4);
      expect(c.a).toBeGreaterThan(0);
    }
  });
});

// ─── Engine テスト ───

describe("EbitenEngine", () => {
  it("simulateGame: スナップショット収集", () => {
    const preset = PRESETS[0]!; // HelloWorld
    const result = simulateGame(preset.createGame(), 10, preset.screenWidth, preset.screenHeight);
    expect(result.snapshots).toHaveLength(10);
    expect(result.metrics.totalTicks).toBe(10);
    expect(result.metrics.totalFrames).toBeGreaterThan(0);
  });

  it("step: 1ティック実行", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    engine.step();
    expect(engine.getTickCount()).toBe(1);
    expect(engine.getMetrics().totalTicks).toBe(1);
  });

  it("runTicks: N ティック一括実行", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    engine.runTicks(5);
    expect(engine.getTickCount()).toBe(5);
  });

  it("イベントログ: 初期化イベント", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    const events = engine.getEventLog();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.category).toBe("system");
    expect(events[0]!.message).toContain("初期化");
  });

  it("addEvent: イベント追加", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    engine.addEvent("input", "テスト入力");
    const events = engine.getEventLog();
    const last = events[events.length - 1]!;
    expect(last.category).toBe("input");
    expect(last.message).toBe("テスト入力");
  });

  it("getScreen: スクリーンバッファ", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    engine.step();
    const screen = engine.getScreen();
    expect(screen.width).toBe(320);
    expect(screen.height).toBe(240);
    // draw後なのでピクセルが存在
    const pixels = screen.getPixels();
    expect(pixels.some(v => v > 0)).toBe(true);
  });

  it("getGameState: スナップショット取得", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    engine.step();
    const state = engine.getGameState();
    expect(state.entities).toBeDefined();
    expect(state.debugInfo).toBeDefined();
  });

  it("getInput: InputManager取得", () => {
    const preset = PRESETS[0]!;
    const engine = new EbitenEngine(preset.createGame(), preset.screenWidth, preset.screenHeight);
    const input = engine.getInput();
    input.simulateKeyPress("ArrowUp");
    expect(input.isKeyPressed("ArrowUp")).toBe(true);
  });
});

// ─── プリセット統合テスト ───

describe("プリセット", () => {
  it("12個のプリセットが定義されている", () => {
    expect(PRESETS).toHaveLength(12);
  });

  it("全プリセットがname/descriptionを持つ", () => {
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.screenWidth).toBeGreaterThan(0);
      expect(p.screenHeight).toBeGreaterThan(0);
    }
  });

  // 各プリセットを60ティック実行してエラーなしを確認
  for (let i = 0; i < 12; i++) {
    it(`プリセット ${i + 1}: ${PRESETS[i]!.name} — 60ティック正常実行`, () => {
      const preset = PRESETS[i]!;
      const game = preset.createGame();
      const result = simulateGame(game, 60, preset.screenWidth, preset.screenHeight);
      expect(result.snapshots).toHaveLength(60);
      // エラーイベントがないことを確認
      const errors = result.events.filter(e => e.message.includes("エラー"));
      expect(errors).toHaveLength(0);
      // スクリーンにピクセルが描画されている
      expect(result.screen.getPixels().some(v => v > 0)).toBe(true);
    });
  }

  it("HelloWorld: 矩形が移動する", () => {
    const game = PRESETS[0]!.createGame();
    const r1 = simulateGame(game, 1, 320, 240);
    const game2 = PRESETS[0]!.createGame();
    const r2 = simulateGame(game2, 30, 320, 240);
    const e1 = r1.snapshots[0]!.entities[0]!;
    const e2 = r2.snapshots[29]!.entities[0]!;
    // 位置が変わっている
    expect(e1.x !== e2.x || e1.y !== e2.y).toBe(true);
  });

  it("KeyboardInput: 入力で移動", () => {
    const preset = PRESETS[3]!;
    const game = preset.createGame();
    const engine = new EbitenEngine(game, preset.screenWidth, preset.screenHeight);
    engine.step();
    const before = engine.getGameState().entities[0]!;
    // 右キーを押して数ティック
    engine.getInput().simulateKeyPress("ArrowRight");
    for (let i = 0; i < 10; i++) engine.step();
    engine.getInput().simulateKeyRelease("ArrowRight");
    const after = engine.getGameState().entities[0]!;
    expect(after.x).toBeGreaterThan(before.x);
  });

  it("GameStateMachine: 状態遷移", () => {
    const preset = PRESETS[10]!;
    const game = preset.createGame();
    const engine = new EbitenEngine(game, preset.screenWidth, preset.screenHeight);
    engine.step();
    // 初期状態はtitle
    expect(engine.getGameState().debugInfo["state"]).toBe("title");
    // スペースでplaying
    engine.getInput().simulateKeyPress("Space");
    engine.step();
    engine.getInput().simulateKeyRelease("Space");
    expect(engine.getGameState().debugInfo["state"]).toBe("playing");
  });

  it("AudioSynth: 波形が切り替わる", () => {
    const preset = PRESETS[7]!;
    const game = preset.createGame();
    const r = simulateGame(game, 130, preset.screenWidth, preset.screenHeight);
    const wave1 = r.snapshots[0]!.debugInfo["waveType"];
    const wave2 = r.snapshots[129]!.debugInfo["waveType"];
    // 120ティック後に切り替わる
    expect(wave1).not.toBe(wave2);
  });

  it("SimplePhysics: ボールが落下する", () => {
    const preset = PRESETS[9]!;
    const game = preset.createGame();
    const r = simulateGame(game, 30, preset.screenWidth, preset.screenHeight);
    const ball0_start = r.snapshots[0]!.entities[0]!;
    const ball0_end = r.snapshots[29]!.entities[0]!;
    // 重力で下に移動
    expect(ball0_end.y).toBeGreaterThan(ball0_start.y);
  });

  it("ShaderEffect: シェーダが順次切り替わる", () => {
    const preset = PRESETS[11]!;
    const game = preset.createGame();
    const r = simulateGame(game, 190, preset.screenWidth, preset.screenHeight);
    const shader1 = r.snapshots[0]!.debugInfo["shader"];
    const shader2 = r.snapshots[189]!.debugInfo["shader"];
    expect(shader1).not.toBe(shader2);
  });
});

// ─── ヘルパー関数テスト ───

describe("ヘルパー", () => {
  it("defaultColorScale: 無変換", () => {
    const cs = defaultColorScale();
    expect(cs).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("defaultGeoMData: 単位行列", () => {
    const data = defaultGeoMData();
    expect(data.elements).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
