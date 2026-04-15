/**
 * Ebitenシミュレーター プリセット
 *
 * 12個のプリセットでEbitenの主要機能をデモする。
 * 各プリセットは Game interface を実装するクラス。
 */

import type {
  Game, InputState, PixelBuffer, GameStateSnapshot, Color,
  EbitenPreset, WaveType,
} from "../ebiten/types.js";
import { GeoM } from "../ebiten/geom.js";
import { EbitenImage, defaultColorScale } from "../ebiten/image.js";
import { BUILTIN_SHADERS, applyShader } from "../ebiten/shader.js";
import { generateWave } from "../ebiten/audio.js";

// ─── 1. Hello World ───

class HelloWorldGame implements Game {
  private x = 40;
  private y = 40;
  private dx = 2;
  private dy = 1.5;
  private tick = 0;

  update(_input: InputState): string | null {
    this.tick++;
    this.x += this.dx;
    this.y += this.dy;
    if (this.x <= 0 || this.x >= 320 - 40) this.dx = -this.dx;
    if (this.y <= 0 || this.y >= 240 - 30) this.dy = -this.dy;
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.05, g: 0.05, b: 0.1, a: 1 });
    // 動く矩形
    const hue = (this.tick * 2) % 360;
    const c = hslToRgb(hue, 0.8, 0.6);
    screen.drawRect(this.x, this.y, 40, 30, { ...c, a: 1 });
    screen.drawText(4, 4, "HELLO EBITEN!", { r: 1, g: 1, b: 1, a: 1 });
  }

  layout(_ow: number, _oh: number) { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [{ name: "rect", x: this.x, y: this.y, properties: { dx: this.dx, dy: this.dy } }],
      debugInfo: { tick: this.tick, "rect.x": Math.round(this.x), "rect.y": Math.round(this.y) },
    };
  }
}

// ─── 2. Sprite Animation ───

class SpriteAnimationGame implements Game {
  private frameIndex = 0;
  private frameTimer = 0;
  private totalFrames = 8;
  private spriteSize = 32;
  private sprites: EbitenImage[] = [];
  private tick = 0;

  constructor() {
    // 手続き的にスプライトフレームを生成
    for (let i = 0; i < this.totalFrames; i++) {
      const img = new EbitenImage(this.spriteSize, this.spriteSize);
      const hue = (i * 45) % 360;
      const c = hslToRgb(hue, 0.9, 0.5);
      // 回転する「腕」の角度でアニメーションを表現
      const angle = (i / this.totalFrames) * Math.PI * 2;
      img.drawCircle(16, 16, 12, { ...c, a: 1 });
      const armX = 16 + Math.cos(angle) * 10;
      const armY = 16 + Math.sin(angle) * 10;
      img.drawLine(16, 16, armX, armY, { r: 1, g: 1, b: 1, a: 1 });
      this.sprites.push(img);
    }
  }

  update(_input: InputState): string | null {
    this.tick++;
    this.frameTimer++;
    if (this.frameTimer >= 8) {
      this.frameTimer = 0;
      this.frameIndex = (this.frameIndex + 1) % this.totalFrames;
    }
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.08, g: 0.08, b: 0.12, a: 1 });
    // 中央にスプライト表示
    const sprite = this.sprites[this.frameIndex];
    if (sprite) {
      const geoM = new GeoM();
      geoM.translate(144, 104);
      screen.drawImage(sprite, { geoM: geoM.toData(), colorScale: defaultColorScale() });
    }
    // フレーム番号表示
    screen.drawText(4, 4, `FRAME: ${this.frameIndex}/${this.totalFrames}`, { r: 0.7, g: 0.7, b: 0.7, a: 1 });
    // 全フレームのサムネイル
    for (let i = 0; i < this.totalFrames; i++) {
      const s = this.sprites[i];
      if (!s) continue;
      const geoM = new GeoM();
      geoM.scale(0.5, 0.5);
      geoM.translate(10 + i * 20, 200);
      const cs = i === this.frameIndex
        ? defaultColorScale()
        : { r: 0.5, g: 0.5, b: 0.5, a: 0.7 };
      screen.drawImage(s, { geoM: geoM.toData(), colorScale: cs });
    }
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [{ name: "sprite", x: 144, y: 104, properties: { frame: this.frameIndex } }],
      debugInfo: { tick: this.tick, frameIndex: this.frameIndex, frameTimer: this.frameTimer },
    };
  }
}

// ─── 3. GeoM Transforms ───

class GeoMTransformGame implements Game {
  private angle = 0;
  private scaleVal = 1;
  private scaleDir = 1;
  private tick = 0;
  private box: EbitenImage;

  constructor() {
    this.box = new EbitenImage(30, 30);
    this.box.fill({ r: 0.2, g: 0.6, b: 1, a: 1 });
    // 十字マーク
    this.box.drawLine(15, 0, 15, 29, { r: 1, g: 1, b: 1, a: 0.5 });
    this.box.drawLine(0, 15, 29, 15, { r: 1, g: 1, b: 1, a: 0.5 });
  }

  update(_input: InputState): string | null {
    this.tick++;
    this.angle += 0.03;
    this.scaleVal += 0.01 * this.scaleDir;
    if (this.scaleVal > 2 || this.scaleVal < 0.5) this.scaleDir = -this.scaleDir;
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.04, g: 0.04, b: 0.08, a: 1 });

    // 1: 平行移動のみ
    const g1 = new GeoM();
    g1.translate(40, 60);
    screen.drawImage(this.box, { geoM: g1.toData(), colorScale: defaultColorScale() });
    screen.drawText(35, 50, "TRANSLATE", { r: 0.6, g: 0.6, b: 0.6, a: 1 });

    // 2: 回転
    const g2 = new GeoM();
    g2.translate(-15, -15);
    g2.rotate(this.angle);
    g2.translate(160, 75);
    screen.drawImage(this.box, { geoM: g2.toData(), colorScale: defaultColorScale() });
    screen.drawText(140, 50, "ROTATE", { r: 0.6, g: 0.6, b: 0.6, a: 1 });

    // 3: スケール
    const g3 = new GeoM();
    g3.translate(-15, -15);
    g3.scale(this.scaleVal, this.scaleVal);
    g3.translate(260, 75);
    screen.drawImage(this.box, { geoM: g3.toData(), colorScale: defaultColorScale() });
    screen.drawText(245, 50, "SCALE", { r: 0.6, g: 0.6, b: 0.6, a: 1 });

    // 4: 合成（回転+スケール）
    const g4 = new GeoM();
    g4.translate(-15, -15);
    g4.rotate(this.angle * 0.5);
    g4.scale(this.scaleVal * 0.8, this.scaleVal * 0.8);
    g4.translate(100, 170);
    screen.drawImage(this.box, { geoM: g4.toData(), colorScale: { r: 1, g: 0.5, b: 0.5, a: 1 } });
    screen.drawText(70, 140, "ROTATE+SCALE", { r: 0.6, g: 0.6, b: 0.6, a: 1 });

    // 行列要素表示
    const [a, b, c, d, tx, ty] = g4.getElements();
    screen.drawText(4, 220, `M=[${a.toFixed(2)},${b.toFixed(2)},${c.toFixed(2)},${d.toFixed(2)},${tx.toFixed(0)},${ty.toFixed(0)}]`, { r: 0.4, g: 0.8, b: 0.4, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [],
      debugInfo: { angle: +(this.angle.toFixed(2)), scale: +(this.scaleVal.toFixed(2)), tick: this.tick },
    };
  }
}

// ─── 4. Keyboard Input ───

class KeyboardInputGame implements Game {
  private px = 150;
  private py = 110;
  private speed = 3;
  private trail: Array<{ x: number; y: number }> = [];
  private tick = 0;

  update(input: InputState): string | null {
    this.tick++;
    let moved = false;
    if (input.pressedKeys.has("ArrowUp") || input.pressedKeys.has("KeyW")) { this.py -= this.speed; moved = true; }
    if (input.pressedKeys.has("ArrowDown") || input.pressedKeys.has("KeyS")) { this.py += this.speed; moved = true; }
    if (input.pressedKeys.has("ArrowLeft") || input.pressedKeys.has("KeyA")) { this.px -= this.speed; moved = true; }
    if (input.pressedKeys.has("ArrowRight") || input.pressedKeys.has("KeyD")) { this.px += this.speed; moved = true; }
    // 画面内にクランプ
    this.px = Math.max(0, Math.min(304, this.px));
    this.py = Math.max(0, Math.min(224, this.py));
    if (moved) {
      this.trail.push({ x: this.px, y: this.py });
      if (this.trail.length > 50) this.trail.shift();
    }
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.05, g: 0.05, b: 0.1, a: 1 });
    // 軌跡
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i]!;
      const alpha = i / this.trail.length * 0.5;
      screen.drawRect(t.x + 4, t.y + 4, 8, 8, { r: 0.3, g: 0.5, b: 1, a: alpha });
    }
    // プレイヤー
    screen.drawRect(this.px, this.py, 16, 16, { r: 0.3, g: 0.8, b: 1, a: 1 });
    screen.drawText(4, 4, "ARROW KEYS TO MOVE", { r: 0.6, g: 0.6, b: 0.6, a: 1 });
    screen.drawText(4, 16, `POS: (${Math.round(this.px)}, ${Math.round(this.py)})`, { r: 0.4, g: 0.8, b: 0.4, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [{ name: "player", x: this.px, y: this.py, properties: { speed: this.speed, trailLen: this.trail.length } }],
      debugInfo: { tick: this.tick, "player.x": Math.round(this.px), "player.y": Math.round(this.py) },
    };
  }
}

// ─── 5. Mouse Input ───

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: Color;
  size: number;
}

class MouseInputGame implements Game {
  private particles: Particle[] = [];
  private tick = 0;

  update(input: InputState): string | null {
    this.tick++;
    // クリックでパーティクル生成
    for (const click of input.clicks) {
      for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        const baseColor = hslToRgb(Math.random() * 360, 0.8, 0.6);
        this.particles.push({
          x: click.x, y: click.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 60, maxLife: 60,
          color: { ...baseColor, a: 1 },
          size: 2 + Math.random() * 3,
        });
      }
    }
    // パーティクル更新
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // 重力
      p.life--;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.03, g: 0.03, b: 0.06, a: 1 });
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      screen.drawCircle(p.x, p.y, p.size * alpha, { ...p.color, a: alpha });
    }
    screen.drawText(4, 4, "CLICK TO SPAWN PARTICLES", { r: 0.6, g: 0.6, b: 0.6, a: 1 });
    screen.drawText(4, 16, `PARTICLES: ${this.particles.length}`, { r: 0.4, g: 0.8, b: 0.4, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: this.particles.slice(0, 10).map((p, i) => ({
        name: `particle_${i}`, x: Math.round(p.x), y: Math.round(p.y),
        properties: { life: p.life, size: +(p.size.toFixed(1)) },
      })),
      debugInfo: { tick: this.tick, particleCount: this.particles.length },
    };
  }
}

// ─── 6. Collision Detection ───

interface Box {
  x: number; y: number; w: number; h: number;
  dx: number; dy: number; color: Color; colliding: boolean;
}

class CollisionGame implements Game {
  private boxes: Box[] = [];
  private tick = 0;

  constructor() {
    for (let i = 0; i < 6; i++) {
      this.boxes.push({
        x: 30 + i * 50, y: 60 + (i % 3) * 40,
        w: 25, h: 25,
        dx: (Math.random() - 0.5) * 3, dy: (Math.random() - 0.5) * 3,
        color: { ...hslToRgb(i * 60, 0.7, 0.5), a: 1 },
        colliding: false,
      });
    }
  }

  update(_input: InputState): string | null {
    this.tick++;
    // 移動
    for (const b of this.boxes) {
      b.x += b.dx;
      b.y += b.dy;
      if (b.x <= 0 || b.x + b.w >= 320) b.dx = -b.dx;
      if (b.y <= 0 || b.y + b.h >= 240) b.dy = -b.dy;
      b.x = Math.max(0, Math.min(320 - b.w, b.x));
      b.y = Math.max(0, Math.min(240 - b.h, b.y));
      b.colliding = false;
    }
    // AABB衝突検出
    for (let i = 0; i < this.boxes.length; i++) {
      for (let j = i + 1; j < this.boxes.length; j++) {
        const a = this.boxes[i]!, b = this.boxes[j]!;
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          a.colliding = true;
          b.colliding = true;
          // 反発
          const tmpDx = a.dx; a.dx = b.dx; b.dx = tmpDx;
          const tmpDy = a.dy; a.dy = b.dy; b.dy = tmpDy;
        }
      }
    }
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.04, g: 0.04, b: 0.08, a: 1 });
    for (const b of this.boxes) {
      const c = b.colliding ? { r: 1, g: 0.3, b: 0.3, a: 1 } : { ...b.color, a: 1 };
      screen.drawRect(b.x, b.y, b.w, b.h, c);
      if (b.colliding) {
        screen.drawRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, { r: 1, g: 1, b: 0, a: 0.3 });
      }
    }
    screen.drawText(4, 4, "AABB COLLISION DETECTION", { r: 0.6, g: 0.6, b: 0.6, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: this.boxes.map((b, i) => ({
        name: `box_${i}`, x: Math.round(b.x), y: Math.round(b.y),
        properties: { colliding: b.colliding, dx: +(b.dx.toFixed(1)), dy: +(b.dy.toFixed(1)) },
      })),
      debugInfo: { tick: this.tick, collisions: this.boxes.filter(b => b.colliding).length },
    };
  }
}

// ─── 7. Tile Map ───

class TileMapGame implements Game {
  private map: number[][] = [];
  private cameraX = 0;
  private cameraY = 0;
  private tileSize = 16;
  private mapW = 30;
  private mapH = 20;
  private tick = 0;
  private tileColors: Color[] = [
    { r: 0.2, g: 0.6, b: 0.2, a: 1 }, // 草
    { r: 0.2, g: 0.3, b: 0.8, a: 1 }, // 水
    { r: 0.5, g: 0.5, b: 0.5, a: 1 }, // 石
    { r: 0.1, g: 0.4, b: 0.1, a: 1 }, // 木
  ];

  constructor() {
    // 手続き的マップ生成
    for (let y = 0; y < this.mapH; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.mapW; x++) {
        const noise = Math.sin(x * 0.3) * Math.cos(y * 0.4) + Math.sin(x * 0.7 + y * 0.5);
        if (noise < -0.5) row.push(1); // 水
        else if (noise > 0.8) row.push(3); // 木
        else if (noise > 0.5) row.push(2); // 石
        else row.push(0); // 草
      }
      this.map.push(row);
    }
  }

  update(input: InputState): string | null {
    this.tick++;
    const scrollSpeed = 2;
    if (input.pressedKeys.has("ArrowLeft")) this.cameraX -= scrollSpeed;
    if (input.pressedKeys.has("ArrowRight")) this.cameraX += scrollSpeed;
    if (input.pressedKeys.has("ArrowUp")) this.cameraY -= scrollSpeed;
    if (input.pressedKeys.has("ArrowDown")) this.cameraY += scrollSpeed;
    this.cameraX = Math.max(0, Math.min(this.mapW * this.tileSize - 320, this.cameraX));
    this.cameraY = Math.max(0, Math.min(this.mapH * this.tileSize - 240, this.cameraY));
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.1, g: 0.1, b: 0.15, a: 1 });
    const startTX = Math.floor(this.cameraX / this.tileSize);
    const startTY = Math.floor(this.cameraY / this.tileSize);
    const endTX = Math.min(this.mapW, startTX + Math.ceil(320 / this.tileSize) + 1);
    const endTY = Math.min(this.mapH, startTY + Math.ceil(240 / this.tileSize) + 1);

    for (let ty = startTY; ty < endTY; ty++) {
      for (let tx = startTX; tx < endTX; tx++) {
        const tile = this.map[ty]?.[tx] ?? 0;
        const color = this.tileColors[tile] ?? this.tileColors[0]!;
        const sx = tx * this.tileSize - this.cameraX;
        const sy = ty * this.tileSize - this.cameraY;
        screen.drawRect(sx, sy, this.tileSize - 1, this.tileSize - 1, color);
      }
    }
    screen.drawText(4, 4, "TILE MAP (ARROWS TO SCROLL)", { r: 1, g: 1, b: 1, a: 0.8 });
    screen.drawText(4, 16, `CAM: (${Math.round(this.cameraX)}, ${Math.round(this.cameraY)})`, { r: 0.4, g: 0.8, b: 0.4, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [{ name: "camera", x: Math.round(this.cameraX), y: Math.round(this.cameraY), properties: {} }],
      debugInfo: { tick: this.tick, cameraX: Math.round(this.cameraX), cameraY: Math.round(this.cameraY), mapSize: `${this.mapW}x${this.mapH}` },
    };
  }
}

// ─── 8. Audio Synthesis ───

class AudioSynthGame implements Game {
  private waveTypes: WaveType[] = ["sine", "square", "triangle", "sawtooth", "noise"];
  private currentWave = 0;
  private frequency = 440;
  private tick = 0;
  private pcmBuffer: number[] = [];
  private sampleRate = 44100;

  update(_input: InputState): string | null {
    this.tick++;
    // 2秒ごとに波形を切り替え
    if (this.tick % 120 === 0) {
      this.currentWave = (this.currentWave + 1) % this.waveTypes.length;
    }
    // 可視化用PCM生成（1フレーム分 = 44100/60 ≈ 735サンプル）
    const samplesPerFrame = Math.ceil(this.sampleRate / 60);
    this.pcmBuffer = generateWave(this.waveTypes[this.currentWave]!, this.frequency, this.sampleRate, samplesPerFrame);
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.04, g: 0.04, b: 0.08, a: 1 });
    // 波形名
    screen.drawText(4, 4, `WAVE: ${(this.waveTypes[this.currentWave] ?? "?").toUpperCase()}`, { r: 0.3, g: 0.8, b: 1, a: 1 });
    screen.drawText(4, 16, `FREQ: ${this.frequency}HZ`, { r: 0.4, g: 0.8, b: 0.4, a: 1 });

    // オシロスコープ表示
    const waveY = 120;
    const waveH = 60;
    // 背景枠
    screen.drawRect(10, waveY - waveH, 300, waveH * 2, { r: 0.06, g: 0.06, b: 0.1, a: 1 });
    // 中心線
    screen.drawLine(10, waveY, 310, waveY, { r: 0.2, g: 0.2, b: 0.3, a: 1 });

    // 波形描画（PCMバッファの先頭300サンプルを表示）
    const displaySamples = Math.min(300, this.pcmBuffer.length);
    for (let i = 0; i < displaySamples - 1; i++) {
      const x0 = 10 + i;
      const y0 = waveY - (this.pcmBuffer[i] ?? 0) * waveH;
      const x1 = 10 + i + 1;
      const y1 = waveY - (this.pcmBuffer[i + 1] ?? 0) * waveH;
      screen.drawLine(x0, y0, x1, y1, { r: 0.3, g: 1, b: 0.5, a: 0.9 });
    }
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [],
      debugInfo: {
        tick: this.tick,
        waveType: this.waveTypes[this.currentWave] ?? "?",
        frequency: this.frequency,
        bufferSize: this.pcmBuffer.length,
      },
    };
  }
}

// ─── 9. Particle System ───

class ParticleSystemGame implements Game {
  private particles: Particle[] = [];
  private tick = 0;
  private emitterX = 160;
  private emitterY = 200;

  update(_input: InputState): string | null {
    this.tick++;
    // エミッターから毎ティック3粒子
    for (let i = 0; i < 3; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const speed = 1.5 + Math.random() * 2;
      this.particles.push({
        x: this.emitterX + (Math.random() - 0.5) * 10,
        y: this.emitterY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 40 + Math.floor(Math.random() * 40),
        maxLife: 80,
        color: { ...hslToRgb(10 + Math.random() * 30, 0.9, 0.5), a: 1 }, // 炎色
        size: 2 + Math.random() * 3,
      });
    }
    // 更新
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.02; // 上昇
      p.vx *= 0.99;
      p.life--;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    // 上限
    if (this.particles.length > 300) this.particles.splice(0, this.particles.length - 300);
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.02, g: 0.02, b: 0.04, a: 1 });
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      screen.drawCircle(p.x, p.y, p.size * t, { ...p.color, a: t * 0.8 });
    }
    // エミッター位置
    screen.drawRect(this.emitterX - 5, this.emitterY, 10, 4, { r: 0.5, g: 0.5, b: 0.5, a: 1 });
    screen.drawText(4, 4, "PARTICLE SYSTEM (FIRE)", { r: 0.7, g: 0.7, b: 0.7, a: 1 });
    screen.drawText(4, 16, `COUNT: ${this.particles.length}`, { r: 0.4, g: 0.8, b: 0.4, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [{ name: "emitter", x: this.emitterX, y: this.emitterY, properties: { particles: this.particles.length } }],
      debugInfo: { tick: this.tick, particleCount: this.particles.length },
    };
  }
}

// ─── 10. Simple Physics ───

interface Ball {
  x: number; y: number; vx: number; vy: number;
  radius: number; mass: number; color: Color;
}

class PhysicsGame implements Game {
  private balls: Ball[] = [];
  private gravity = 0.2;
  private restitution = 0.8;
  private tick = 0;

  constructor() {
    for (let i = 0; i < 8; i++) {
      this.balls.push({
        x: 30 + i * 35, y: 30 + Math.random() * 60,
        vx: (Math.random() - 0.5) * 3, vy: 0,
        radius: 8 + Math.random() * 8,
        mass: 1,
        color: { ...hslToRgb(i * 45, 0.7, 0.5), a: 1 },
      });
    }
  }

  update(_input: InputState): string | null {
    this.tick++;
    for (const b of this.balls) {
      b.vy += this.gravity;
      b.x += b.vx;
      b.y += b.vy;
      // 壁反射
      if (b.x - b.radius < 0) { b.x = b.radius; b.vx = Math.abs(b.vx) * this.restitution; }
      if (b.x + b.radius > 320) { b.x = 320 - b.radius; b.vx = -Math.abs(b.vx) * this.restitution; }
      if (b.y + b.radius > 230) { b.y = 230 - b.radius; b.vy = -Math.abs(b.vy) * this.restitution; }
      if (b.y - b.radius < 0) { b.y = b.radius; b.vy = Math.abs(b.vy) * this.restitution; }
    }
    // ボール同士の衝突
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i]!, b = this.balls[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius;
        if (dist < minDist && dist > 0) {
          // 正規化
          const nx = dx / dist, ny = dy / dist;
          // 反射速度
          const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
          const dvn = dvx * nx + dvy * ny;
          if (dvn > 0) {
            a.vx -= dvn * nx * this.restitution;
            a.vy -= dvn * ny * this.restitution;
            b.vx += dvn * nx * this.restitution;
            b.vy += dvn * ny * this.restitution;
          }
          // 重なり解消
          const overlap = (minDist - dist) / 2;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }
    return null;
  }

  draw(screen: PixelBuffer): void {
    screen.fill({ r: 0.04, g: 0.04, b: 0.08, a: 1 });
    // 床
    screen.drawRect(0, 230, 320, 10, { r: 0.3, g: 0.3, b: 0.3, a: 1 });
    for (const b of this.balls) {
      screen.drawCircle(b.x, b.y, b.radius, { ...b.color, a: 1 });
      // 速度ベクトル
      screen.drawLine(b.x, b.y, b.x + b.vx * 3, b.y + b.vy * 3, { r: 1, g: 1, b: 0, a: 0.5 });
    }
    screen.drawText(4, 4, "PHYSICS: GRAVITY + BOUNCE", { r: 0.7, g: 0.7, b: 0.7, a: 1 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: this.balls.map((b, i) => ({
        name: `ball_${i}`, x: Math.round(b.x), y: Math.round(b.y),
        properties: { r: +(b.radius.toFixed(0)), vx: +(b.vx.toFixed(1)), vy: +(b.vy.toFixed(1)) },
      })),
      debugInfo: { tick: this.tick, gravity: this.gravity, restitution: this.restitution },
    };
  }
}

// ─── 11. Game State Machine ───

type GameState = "title" | "playing" | "gameover";

class StateMachineGame implements Game {
  private state: GameState = "title";
  private score = 0;
  private timer = 0;
  private playerX = 150;
  private targetX = 0;
  private targetTimer = 0;
  private tick = 0;
  private stateTime = 0;

  update(input: InputState): string | null {
    this.tick++;
    this.stateTime++;

    switch (this.state) {
      case "title":
        if (input.pressedKeys.has("Space") || input.clicks.length > 0) {
          this.state = "playing";
          this.score = 0;
          this.timer = 600; // 10秒
          this.stateTime = 0;
          this.targetX = Math.random() * 280 + 20;
          this.targetTimer = 0;
        }
        break;
      case "playing":
        this.timer--;
        this.targetTimer++;
        if (input.pressedKeys.has("ArrowLeft")) this.playerX -= 4;
        if (input.pressedKeys.has("ArrowRight")) this.playerX += 4;
        this.playerX = Math.max(10, Math.min(310, this.playerX));
        // ターゲットとの距離チェック
        if (Math.abs(this.playerX - this.targetX) < 15) {
          this.score += Math.max(1, 10 - Math.floor(this.targetTimer / 10));
          this.targetX = Math.random() * 280 + 20;
          this.targetTimer = 0;
        }
        if (this.timer <= 0) {
          this.state = "gameover";
          this.stateTime = 0;
        }
        break;
      case "gameover":
        if (this.stateTime > 60 && (input.pressedKeys.has("Space") || input.clicks.length > 0)) {
          this.state = "title";
          this.stateTime = 0;
        }
        break;
    }
    return null;
  }

  draw(screen: PixelBuffer): void {
    switch (this.state) {
      case "title":
        screen.fill({ r: 0.05, g: 0.05, b: 0.15, a: 1 });
        screen.drawText(80, 80, "CATCH GAME", { r: 1, g: 1, b: 1, a: 1 }, 2);
        screen.drawText(60, 140, "PRESS SPACE TO START", { r: 0.6, g: 0.6, b: 0.6, a: (this.stateTime % 60 < 30) ? 1 : 0.3 });
        break;
      case "playing": {
        screen.fill({ r: 0.04, g: 0.04, b: 0.08, a: 1 });
        // ターゲット
        screen.drawCircle(this.targetX, 60, 8, { r: 1, g: 0.3, b: 0.3, a: 1 });
        // プレイヤー
        screen.drawRect(this.playerX - 10, 200, 20, 10, { r: 0.3, g: 0.8, b: 1, a: 1 });
        // HUD
        screen.drawText(4, 4, `SCORE: ${this.score}`, { r: 1, g: 1, b: 1, a: 1 });
        screen.drawText(220, 4, `TIME: ${Math.ceil(this.timer / 60)}`, { r: 1, g: 0.8, b: 0.3, a: 1 });
        break;
      }
      case "gameover":
        screen.fill({ r: 0.1, g: 0.02, b: 0.02, a: 1 });
        screen.drawText(80, 80, "GAME OVER", { r: 1, g: 0.3, b: 0.3, a: 1 }, 2);
        screen.drawText(100, 130, `SCORE: ${this.score}`, { r: 1, g: 1, b: 1, a: 1 }, 2);
        screen.drawText(50, 180, "PRESS SPACE TO RETRY", { r: 0.6, g: 0.6, b: 0.6, a: (this.stateTime % 60 < 30) ? 1 : 0.3 });
        break;
    }
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    return {
      entities: [
        { name: "player", x: Math.round(this.playerX), y: 200, properties: {} },
        { name: "target", x: Math.round(this.targetX), y: 60, properties: {} },
      ],
      debugInfo: { tick: this.tick, state: this.state, score: this.score, timer: Math.ceil(this.timer / 60) },
    };
  }
}

// ─── 12. Shader Effect ───

class ShaderEffectGame implements Game {
  private shaderIndex = 0;
  private time = 0;
  private tick = 0;
  private baseImage: EbitenImage;

  constructor() {
    // テスト画像生成（カラフルなグラデーション）
    this.baseImage = new EbitenImage(320, 240);
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 320; x++) {
        this.baseImage.setPixel(x, y, {
          r: x / 320,
          g: y / 240,
          b: Math.sin(x * 0.05) * 0.5 + 0.5,
          a: 1,
        });
      }
    }
    // 中央に白い円
    this.baseImage.drawCircle(160, 120, 40, { r: 1, g: 1, b: 1, a: 0.8 });
    // テキスト
    this.baseImage.drawText(100, 110, "EBITEN", { r: 0.2, g: 0.2, b: 0.2, a: 1 }, 2);
  }

  update(_input: InputState): string | null {
    this.tick++;
    this.time += 0.05;
    // 3秒ごとにシェーダを切り替え
    if (this.tick % 180 === 0) {
      this.shaderIndex = (this.shaderIndex + 1) % BUILTIN_SHADERS.length;
    }
    return null;
  }

  draw(screen: PixelBuffer): void {
    const shader = BUILTIN_SHADERS[this.shaderIndex];
    if (!shader) return;
    applyShader(this.baseImage, screen, shader, { time: this.time, strength: 0.6, amplitude: 0.03, frequency: 12 });
    // シェーダ名表示
    screen.drawText(4, 4, `SHADER: ${shader.name.toUpperCase()}`, { r: 1, g: 1, b: 1, a: 0.9 });
    screen.drawText(4, 16, shader.description, { r: 0.6, g: 0.6, b: 0.6, a: 0.8 });
  }

  layout() { return { width: 320, height: 240 }; }

  getStateSnapshot(): GameStateSnapshot {
    const shader = BUILTIN_SHADERS[this.shaderIndex];
    return {
      entities: [],
      debugInfo: {
        tick: this.tick,
        shader: shader?.name ?? "?",
        time: +(this.time.toFixed(2)),
        shaderCount: BUILTIN_SHADERS.length,
      },
    };
  }
}

// ─── ヘルパー ───

/** HSLからRGB変換 (h: 0-360, s: 0-1, l: 0-1) */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: r + m, g: g + m, b: b + m };
}

// ─── プリセット一覧 ───

export const PRESETS: EbitenPreset[] = [
  {
    name: "Hello World",
    description: "基本的なゲームループ — 色が変わる矩形が画面を跳ね回る",
    createGame: () => new HelloWorldGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Sprite Animation",
    description: "DrawImageとフレームアニメーション — スプライトシートの切り替え表示",
    createGame: () => new SpriteAnimationGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "GeoM Transforms",
    description: "GeoMアフィン変換 — Translate/Rotate/Scale/行列合成の可視化",
    createGame: () => new GeoMTransformGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Keyboard Input",
    description: "キーボード入力 — 矢印キーでプレイヤーキャラクターを移動",
    createGame: () => new KeyboardInputGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Mouse Input",
    description: "マウス入力 — クリック位置にパーティクルを生成",
    createGame: () => new MouseInputGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Collision Detection",
    description: "AABB衝突検出 — 矩形同士の衝突判定と反発",
    createGame: () => new CollisionGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Tile Map",
    description: "タイルマップ — グリッドベースの地形描画とカメラスクロール",
    createGame: () => new TileMapGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Audio Synthesis",
    description: "オーディオ合成 — 各種波形のPCM生成とオシロスコープ表示",
    createGame: () => new AudioSynthGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Particle System",
    description: "パーティクルシステム — 重力・速度・寿命ベースの炎エフェクト",
    createGame: () => new ParticleSystemGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Simple Physics",
    description: "物理シミュレーション — 重力・弾性衝突・壁反射するボール群",
    createGame: () => new PhysicsGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Game State Machine",
    description: "ゲーム状態管理 — Title→Playing→GameOver の状態遷移",
    createGame: () => new StateMachineGame(),
    screenWidth: 320, screenHeight: 240,
  },
  {
    name: "Shader Effect",
    description: "Kageシェーダ — グレースケール/反転/セピア/ビネット等のエフェクト",
    createGame: () => new ShaderEffectGame(),
    screenWidth: 320, screenHeight: 240,
  },
];
