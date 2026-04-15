/**
 * Kageシェーダ エミュレーション
 *
 * EbitenのKageシェーダ言語をJavaScript関数として表現する。
 * 各シェーダは per-pixel のフラグメント関数として定義され、
 * applyShader() でEbitenImageの全ピクセルに適用される。
 */

import type { Color, KageShader, PixelBuffer, ShaderUniforms } from "./types.js";

/** グレースケール変換シェーダ */
const grayscale: KageShader = {
  name: "grayscale",
  description: "グレースケール変換 (ITU-R BT.601)",
  fragment: (_pos, src, _u) => {
    const lum = 0.299 * src.r + 0.587 * src.g + 0.114 * src.b;
    return { r: lum, g: lum, b: lum, a: src.a };
  },
};

/** 色反転シェーダ */
const invert: KageShader = {
  name: "invert",
  description: "RGB色反転",
  fragment: (_pos, src, _u) => ({
    r: 1 - src.r,
    g: 1 - src.g,
    b: 1 - src.b,
    a: src.a,
  }),
};

/** セピア調シェーダ */
const sepia: KageShader = {
  name: "sepia",
  description: "セピア調変換",
  fragment: (_pos, src, _u) => ({
    r: Math.min(1, src.r * 0.393 + src.g * 0.769 + src.b * 0.189),
    g: Math.min(1, src.r * 0.349 + src.g * 0.686 + src.b * 0.168),
    b: Math.min(1, src.r * 0.272 + src.g * 0.534 + src.b * 0.131),
    a: src.a,
  }),
};

/** ビネットエフェクトシェーダ */
const vignette: KageShader = {
  name: "vignette",
  description: "ビネット（周辺減光）エフェクト",
  fragment: (pos, src, uniforms) => {
    const strength = (typeof uniforms["strength"] === "number" ? uniforms["strength"] : 0.5);
    const dx = pos.x - 0.5;
    const dy = pos.y - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy) * 1.414; // 0〜1に正規化
    const factor = 1 - dist * strength;
    return {
      r: src.r * factor,
      g: src.g * factor,
      b: src.b * factor,
      a: src.a,
    };
  },
};

/** 波状歪みシェーダ */
const wave: KageShader = {
  name: "wave",
  description: "波状歪みエフェクト",
  fragment: (pos, src, uniforms) => {
    const time = (typeof uniforms["time"] === "number" ? uniforms["time"] : 0);
    const amplitude = (typeof uniforms["amplitude"] === "number" ? uniforms["amplitude"] : 0.02);
    const frequency = (typeof uniforms["frequency"] === "number" ? uniforms["frequency"] : 10);
    // 座標をオフセットして元ピクセルを参照（簡略版: 色のみ変調）
    const offset = Math.sin(pos.y * frequency + time) * amplitude;
    const brightness = 1 + offset;
    return {
      r: Math.min(1, src.r * brightness),
      g: Math.min(1, src.g * brightness),
      b: Math.min(1, src.b * brightness),
      a: src.a,
    };
  },
};

/** ピクセレーション（モザイク）シェーダ */
const pixelate: KageShader = {
  name: "pixelate",
  description: "ピクセレーション（モザイク）",
  fragment: (pos, src, uniforms) => {
    // ピクセレーションはper-pixel関数では完全に実現できないが、
    // 座標の量子化による近似を行う
    const _size = (typeof uniforms["pixelSize"] === "number" ? uniforms["pixelSize"] : 0.05);
    // 簡略版: 色の量子化
    const levels = Math.max(2, Math.floor(1 / _size));
    return {
      r: Math.floor(src.r * levels) / levels,
      g: Math.floor(src.g * levels) / levels,
      b: Math.floor(src.b * levels) / levels,
      a: src.a,
    };
  },
};

/** ブルーム風グローシェーダ */
const bloom: KageShader = {
  name: "bloom",
  description: "ブルーム風グローエフェクト",
  fragment: (_pos, src, uniforms) => {
    const threshold = (typeof uniforms["threshold"] === "number" ? uniforms["threshold"] : 0.7);
    const intensity = (typeof uniforms["intensity"] === "number" ? uniforms["intensity"] : 0.3);
    const lum = 0.299 * src.r + 0.587 * src.g + 0.114 * src.b;
    const glow = lum > threshold ? (lum - threshold) * intensity : 0;
    return {
      r: Math.min(1, src.r + glow),
      g: Math.min(1, src.g + glow),
      b: Math.min(1, src.b + glow),
      a: src.a,
    };
  },
};

/** 組み込みシェーダ一覧 */
export const BUILTIN_SHADERS: KageShader[] = [
  grayscale, invert, sepia, vignette, wave, pixelate, bloom,
];

/** 画像にシェーダを適用（全ピクセルにフラグメント関数を実行） */
export function applyShader(
  src: PixelBuffer,
  dst: PixelBuffer,
  shader: KageShader,
  uniforms: ShaderUniforms,
): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const srcColor = src.getPixel(x, y);
      // 正規化座標 (0〜1)
      const normPos = {
        x: src.width > 1 ? x / (src.width - 1) : 0,
        y: src.height > 1 ? y / (src.height - 1) : 0,
      };
      const dstColor = shader.fragment(normPos, srcColor, uniforms);
      dst.setPixel(x, y, {
        r: Math.max(0, Math.min(1, dstColor.r)),
        g: Math.max(0, Math.min(1, dstColor.g)),
        b: Math.max(0, Math.min(1, dstColor.b)),
        a: Math.max(0, Math.min(1, dstColor.a)),
      });
    }
  }
}
