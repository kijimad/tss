/**
 * EbitenImage — 2Dピクセルバッファ
 *
 * Ebitenの ebiten.Image をTypeScriptで再現する。
 * RGBA形式のUint8ClampedArrayでピクセルデータを保持し、
 * drawImage() で GeoM アフィン変換付きの画像合成を行う。
 */

import type { Color, ColorScale, DrawImageOptions, PixelBuffer } from "./types.js";
import { GeoM } from "./geom.js";

/** 簡易ビットマップフォント（5x7ピクセル、ASCII 32-126） */
const FONT: Record<string, number[]> = {
  // 各文字を5列×7行のビットマップとして定義（1=ピクセルあり）
  " ": [0, 0, 0, 0, 0, 0, 0],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x0a, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  ":": [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x04],
  ",": [0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08],
  "-": [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  "+": [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  "=": [0x00, 0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0x00, 0x04],
  "*": [0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00],
  "<": [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  ">": [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  "[": [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e],
  "]": [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e],
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  "%": [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  "@": [0x0e, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0e],
};

export class EbitenImage implements PixelBuffer {
  readonly width: number;
  readonly height: number;
  /** RGBAピクセルデータ (width * height * 4 bytes) */
  private pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  /** 全ピクセルを指定色で塗りつぶし */
  fill(color: Color): void {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = Math.round(color.a * 255);
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = r;
      this.pixels[i + 1] = g;
      this.pixels[i + 2] = b;
      this.pixels[i + 3] = a;
    }
  }

  /** バッファクリア（透明黒） */
  clear(): void {
    this.pixels.fill(0);
  }

  /** ピクセル書き込み（アルファブレンディング） */
  setPixel(x: number, y: number, color: Color): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    const sa = color.a;
    if (sa >= 1) {
      this.pixels[idx] = Math.round(color.r * 255);
      this.pixels[idx + 1] = Math.round(color.g * 255);
      this.pixels[idx + 2] = Math.round(color.b * 255);
      this.pixels[idx + 3] = 255;
    } else if (sa > 0) {
      // アルファブレンディング (src over)
      const da = (this.pixels[idx + 3] ?? 0) / 255;
      const outA = sa + da * (1 - sa);
      if (outA > 0) {
        this.pixels[idx] = Math.round(((color.r * sa + (this.pixels[idx] ?? 0) / 255 * da * (1 - sa)) / outA) * 255);
        this.pixels[idx + 1] = Math.round(((color.g * sa + (this.pixels[idx + 1] ?? 0) / 255 * da * (1 - sa)) / outA) * 255);
        this.pixels[idx + 2] = Math.round(((color.b * sa + (this.pixels[idx + 2] ?? 0) / 255 * da * (1 - sa)) / outA) * 255);
        this.pixels[idx + 3] = Math.round(outA * 255);
      }
    }
  }

  /** ピクセル読み取り */
  getPixel(x: number, y: number): Color {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const idx = (iy * this.width + ix) * 4;
    return {
      r: (this.pixels[idx] ?? 0) / 255,
      g: (this.pixels[idx + 1] ?? 0) / 255,
      b: (this.pixels[idx + 2] ?? 0) / 255,
      a: (this.pixels[idx + 3] ?? 0) / 255,
    };
  }

  /** 矩形描画 */
  drawRect(x: number, y: number, w: number, h: number, color: Color): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, color);
      }
    }
  }

  /** 円描画（ブレゼンハム風の塗りつぶし円） */
  drawCircle(cx: number, cy: number, r: number, color: Color): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.width, Math.ceil(cx + r));
    const y1 = Math.min(this.height, Math.ceil(cy + r));
    const r2 = r * r;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = px - cx + 0.5;
        const dy = py - cy + 0.5;
        if (dx * dx + dy * dy <= r2) {
          this.setPixel(px, py, color);
        }
      }
    }
  }

  /** 直線描画（ブレゼンハムアルゴリズム） */
  drawLine(x0: number, y0: number, x1: number, y1: number, color: Color): void {
    let ix0 = Math.floor(x0);
    let iy0 = Math.floor(y0);
    const ix1 = Math.floor(x1);
    const iy1 = Math.floor(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.setPixel(ix0, iy0, color);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; ix0 += sx; }
      if (e2 < dx) { err += dx; iy0 += sy; }
    }
  }

  /** テキスト描画（簡易ビットマップフォント） */
  drawText(x: number, y: number, text: string, color: Color, scale: number = 1): void {
    let curX = Math.floor(x);
    const curY = Math.floor(y);
    for (const ch of text) {
      const bitmap = FONT[ch.toUpperCase()] ?? FONT["?"];
      if (bitmap) {
        for (let row = 0; row < 7; row++) {
          const bits = bitmap[row] ?? 0;
          for (let col = 0; col < 5; col++) {
            if (bits & (1 << (4 - col))) {
              if (scale <= 1) {
                this.setPixel(curX + col, curY + row, color);
              } else {
                this.drawRect(curX + col * scale, curY + row * scale, scale, scale, color);
              }
            }
          }
        }
      }
      curX += Math.ceil(6 * scale);
    }
  }

  /** アフィン変換付き画像描画（逆変換マッピング方式） */
  drawImage(src: PixelBuffer, opts: DrawImageOptions): void {
    const geoM = GeoM.fromData(opts.geoM);
    const inv = geoM.invert();
    if (!inv) return;

    // ソース画像の範囲
    const sub = opts.subImage;
    const srcX = sub ? sub.x : 0;
    const srcY = sub ? sub.y : 0;
    const srcW = sub ? sub.width : src.width;
    const srcH = sub ? sub.height : src.height;

    // 変換後のバウンディングボックスを計算
    const corners = [
      geoM.apply(0, 0),
      geoM.apply(srcW, 0),
      geoM.apply(0, srcH),
      geoM.apply(srcW, srcH),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }

    // バウンディングボックスをクリップ
    const dstX0 = Math.max(0, Math.floor(minX));
    const dstY0 = Math.max(0, Math.floor(minY));
    const dstX1 = Math.min(this.width, Math.ceil(maxX));
    const dstY1 = Math.min(this.height, Math.ceil(maxY));

    const cs = opts.colorScale;

    // 逆マッピングでソース座標を求めてサンプリング
    for (let dy = dstY0; dy < dstY1; dy++) {
      for (let dx = dstX0; dx < dstX1; dx++) {
        const sp = inv.apply(dx + 0.5, dy + 0.5);
        const sx = Math.floor(sp.x);
        const sy = Math.floor(sp.y);
        if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
          const c = src.getPixel(srcX + sx, srcY + sy);
          if (c.a > 0) {
            this.setPixel(dx, dy, {
              r: c.r * cs.r,
              g: c.g * cs.g,
              b: c.b * cs.b,
              a: c.a * cs.a,
            });
          }
        }
      }
    }
  }

  /** 生のピクセルデータ取得（Canvas描画用） */
  getPixels(): Uint8ClampedArray {
    return this.pixels;
  }
}

/** デフォルトのColorScaleを返す（無変換） */
export function defaultColorScale(): ColorScale {
  return { r: 1, g: 1, b: 1, a: 1 };
}

/** デフォルトのGeoMDataを返す（単位行列） */
export function defaultGeoMData(): import("./types.js").GeoMData {
  return { elements: [1, 0, 0, 1, 0, 0] };
}
