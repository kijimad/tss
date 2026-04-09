/**
 * font.ts — フォントレンダリングエンジン
 *
 * TrueType/OpenType 風のグリフアウトライン（2次ベジェ曲線）を
 * 定義し、ラスタライズしてピクセルグリッドに描画する。
 *
 * パイプライン:
 *   グリフ選択 → スケーリング → ヒンティング →
 *   アウトライン展開 → ラスタライズ → アンチエイリアス → 出力
 */

// ── 基本型 ──

export interface Point {
  x: number;
  y: number;
}

/** ベジェ曲線セグメント */
export type PathSegment =
  | { type: "move"; to: Point }
  | { type: "line"; to: Point }
  | { type: "quad"; control: Point; to: Point }
  | { type: "cubic"; c1: Point; c2: Point; to: Point }
  | { type: "close" };

/** グリフアウトライン */
export interface GlyphOutline {
  char: string;
  advanceWidth: number;
  /** 設計座標 (em 単位, 通常 1000 or 2048 unitsPerEm) */
  path: PathSegment[];
  /** 左サイドベアリング */
  lsb: number;
}

/** カーニングペア */
export interface KerningPair {
  left: string;
  right: string;
  value: number;
}

/** フォントデータ */
export interface FontData {
  name: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  glyphs: GlyphOutline[];
  kerning: KerningPair[];
}

/** レンダリング設定 */
export interface RenderConfig {
  fontSize: number;
  /** ピクセルあたりのサブピクセル分割数 (1=なし, 4=4xAA) */
  antialiasLevel: 1 | 2 | 4 | 8;
  /** グリッドフィッティング */
  hinting: boolean;
  /** サブピクセルレンダリング (LCD) */
  subpixelRendering: boolean;
}

/** ラスタライズ結果 (グレースケールピクセルグリッド) */
export interface RasterResult {
  width: number;
  height: number;
  /** 0.0〜1.0 のカバレッジ値 */
  pixels: number[];
  /** サブピクセル (R,G,B 各 0〜1) — subpixelRendering 時のみ */
  subpixels?: { r: number; g: number; b: number }[];
}

/** パイプラインのトレース */
export interface RenderTrace {
  phase: "glyph_lookup" | "scaling" | "hinting" | "outline" | "rasterize" | "antialias" | "composite" | "kerning";
  detail: string;
  data?: string;
}

/** 1文字のレンダリング結果 */
export interface GlyphRender {
  char: string;
  raster: RasterResult;
  /** 描画 X オフセット (カーニング含む) */
  xOffset: number;
  advancePx: number;
}

/** テキスト全体のレンダリング結果 */
export interface TextRenderResult {
  glyphs: GlyphRender[];
  /** 合成後のピクセルグリッド */
  composite: RasterResult;
  trace: RenderTrace[];
  totalWidth: number;
}

// ── ベジェ曲線の評価 ──

/** 2次ベジェ曲線を分割して点列にする */
export function evalQuadBezier(p0: Point, cp: Point, p1: Point, steps: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
    });
  }
  return pts;
}

/** 3次ベジェ曲線を分割して点列にする */
export function evalCubicBezier(p0: Point, c1: Point, c2: Point, p1: Point, steps: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return pts;
}

// ── アウトラインを点列に展開 ──

export function outlineToPoints(path: PathSegment[], scale: number, curveSteps: number): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };

  for (const seg of path) {
    switch (seg.type) {
      case "move":
        if (current.length > 0) contours.push(current);
        current = [];
        cursor = { x: seg.to.x * scale, y: seg.to.y * scale };
        current.push(cursor);
        break;
      case "line":
        cursor = { x: seg.to.x * scale, y: seg.to.y * scale };
        current.push(cursor);
        break;
      case "quad": {
        const pts = evalQuadBezier(
          cursor,
          { x: seg.control.x * scale, y: seg.control.y * scale },
          { x: seg.to.x * scale, y: seg.to.y * scale },
          curveSteps,
        );
        current.push(...pts.slice(1));
        cursor = pts[pts.length - 1]!;
        break;
      }
      case "cubic": {
        const pts = evalCubicBezier(
          cursor,
          { x: seg.c1.x * scale, y: seg.c1.y * scale },
          { x: seg.c2.x * scale, y: seg.c2.y * scale },
          { x: seg.to.x * scale, y: seg.to.y * scale },
          curveSteps,
        );
        current.push(...pts.slice(1));
        cursor = pts[pts.length - 1]!;
        break;
      }
      case "close":
        if (current.length > 0) contours.push(current);
        current = [];
        break;
    }
  }
  if (current.length > 0) contours.push(current);
  return contours;
}

// ── ラスタライズ (スキャンライン塗りつぶし) ──

export function rasterize(
  contours: Point[][],
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  aaLevel: number,
): RasterResult {
  const pixels = new Array<number>(width * height).fill(0);
  const subStep = 1 / aaLevel;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let coverage = 0;
      // スーパーサンプリング
      for (let sy = 0; sy < aaLevel; sy++) {
        for (let sx = 0; sx < aaLevel; sx++) {
          const sampleX = px + (sx + 0.5) * subStep + offsetX;
          const sampleY = py + (sy + 0.5) * subStep + offsetY;
          if (isInsideContours(contours, sampleX, sampleY)) {
            coverage++;
          }
        }
      }
      pixels[py * width + px] = coverage / (aaLevel * aaLevel);
    }
  }

  return { width, height, pixels };
}

/** 偶奇ルールで点がアウトライン内部かを判定 */
function isInsideContours(contours: Point[][], x: number, y: number): boolean {
  let inside = false;
  for (const contour of contours) {
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const pi = contour[i]!;
      const pj = contour[j]!;
      if ((pi.y > y) !== (pj.y > y) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ── ヒンティング (グリッドフィッティング簡易版) ──

export function applyHinting(contours: Point[][]): Point[][] {
  return contours.map((c) =>
    c.map((p) => ({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 })),
  );
}

// ── レンダラー ──

export class FontRenderer {
  private font: FontData;

  constructor(font: FontData) {
    this.font = font;
  }

  get fontData(): FontData {
    return this.font;
  }

  /** テキストをレンダリングする */
  renderText(text: string, config: RenderConfig): TextRenderResult {
    const trace: RenderTrace[] = [];
    const scale = config.fontSize / this.font.unitsPerEm;
    const lineHeight = Math.ceil((this.font.ascender - this.font.descender) * scale);
    const baseline = Math.ceil(this.font.ascender * scale);

    trace.push({ phase: "scaling", detail: `fontSize=${config.fontSize}px, scale=${scale.toFixed(4)}, lineHeight=${lineHeight}px` });

    const glyphRenders: GlyphRender[] = [];
    let cursorX = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;

      // 1. グリフ検索
      const glyph = this.font.glyphs.find((g) => g.char === ch);
      if (glyph === undefined) {
        trace.push({ phase: "glyph_lookup", detail: `"${ch}" → .notdef (グリフなし)` });
        cursorX += Math.ceil(config.fontSize * 0.6);
        continue;
      }
      trace.push({ phase: "glyph_lookup", detail: `"${ch}" → advance=${glyph.advanceWidth}, segments=${glyph.path.length}` });

      // 2. カーニング
      if (i > 0) {
        const prevCh = text[i - 1]!;
        const kern = this.font.kerning.find((k) => k.left === prevCh && k.right === ch);
        if (kern !== undefined) {
          const kernPx = Math.round(kern.value * scale);
          cursorX += kernPx;
          trace.push({ phase: "kerning", detail: `"${prevCh}${ch}" kern=${kern.value} → ${kernPx}px` });
        }
      }

      // 3. アウトライン展開
      const curveSteps = Math.max(4, Math.floor(config.fontSize / 3));
      let contours = outlineToPoints(glyph.path, scale, curveSteps);
      trace.push({ phase: "outline", detail: `"${ch}" ${contours.length} 輪郭, ${contours.reduce((s, c) => s + c.length, 0)} 点` });

      // 4. ヒンティング
      if (config.hinting) {
        contours = applyHinting(contours);
        trace.push({ phase: "hinting", detail: `グリッドフィッティング適用` });
      }

      // Y座標反転 (フォント座標は Y-up、ピクセルは Y-down)
      contours = contours.map((c) => c.map((p) => ({ x: p.x, y: baseline - p.y })));

      // 5. ラスタライズ
      const glyphW = Math.ceil(glyph.advanceWidth * scale) + 2;
      const raster = rasterize(contours, glyphW, lineHeight, 0, 0, config.antialiasLevel);
      const aaLabel = config.antialiasLevel === 1 ? "なし (1-bit)" : `${config.antialiasLevel}x supersampling`;
      trace.push({ phase: "rasterize", detail: `"${ch}" ${glyphW}x${lineHeight}px, AA=${aaLabel}` });

      if (config.antialiasLevel > 1) {
        trace.push({ phase: "antialias", detail: `カバレッジ → グレースケール (${config.antialiasLevel * config.antialiasLevel} サンプル/px)` });
      }

      glyphRenders.push({
        char: ch,
        raster,
        xOffset: cursorX,
        advancePx: glyphW,
      });

      cursorX += Math.ceil(glyph.advanceWidth * scale);
    }

    // 6. コンポジット
    const totalWidth = Math.max(cursorX, 1);
    const composite = this.compositeGlyphs(glyphRenders, totalWidth, lineHeight);
    trace.push({ phase: "composite", detail: `${glyphRenders.length} グリフ → ${totalWidth}x${lineHeight}px` });

    return { glyphs: glyphRenders, composite, trace, totalWidth };
  }

  /** 複数グリフを 1 つのピクセルバッファに合成する */
  private compositeGlyphs(glyphs: GlyphRender[], width: number, height: number): RasterResult {
    const pixels = new Array<number>(width * height).fill(0);
    for (const g of glyphs) {
      for (let y = 0; y < g.raster.height && y < height; y++) {
        for (let x = 0; x < g.raster.width; x++) {
          const dstX = x + g.xOffset;
          if (dstX < 0 || dstX >= width) continue;
          const srcIdx = y * g.raster.width + x;
          const dstIdx = y * width + dstX;
          const srcVal = g.raster.pixels[srcIdx] ?? 0;
          const dstVal = pixels[dstIdx] ?? 0;
          pixels[dstIdx] = Math.min(1, dstVal + srcVal);
        }
      }
    }
    return { width, height, pixels };
  }
}

// ── 組み込みフォントデータ (簡易ピクセルアウトライン) ──

function M(x: number, y: number): PathSegment { return { type: "move", to: { x, y } }; }
function L(x: number, y: number): PathSegment { return { type: "line", to: { x, y } }; }
function Q(cx: number, cy: number, x: number, y: number): PathSegment { return { type: "quad", control: { x: cx, y: cy }, to: { x, y } }; }
function C(): PathSegment { return { type: "close" }; }

/** ベクターフォントのグリフ定義 (簡易版、em=1000) */
export const BUILTIN_FONT: FontData = {
  name: "SimSans", unitsPerEm: 1000, ascender: 800, descender: -200,
  glyphs: [
    { char: "A", advanceWidth: 650, lsb: 0, path: [
      M(0, 0), L(280, 700), L(370, 700), L(650, 0), L(530, 0), L(460, 180), L(190, 180), L(120, 0), C(),
      M(220, 280), L(325, 560), L(430, 280), C(),
    ]},
    { char: "B", advanceWidth: 600, lsb: 80, path: [
      M(80, 0), L(80, 700), L(380, 700), Q(520, 700, 520, 560), Q(520, 440, 400, 400),
      Q(540, 360, 540, 240), Q(540, 0, 380, 0), C(),
      M(180, 400), L(180, 620), L(360, 620), Q(420, 620, 420, 560), Q(420, 480, 360, 480), L(180, 480), C(),
      M(180, 80), L(180, 320), L(370, 320), Q(440, 320, 440, 240), Q(440, 80, 370, 80), C(),
    ]},
    { char: "H", advanceWidth: 620, lsb: 80, path: [
      M(80, 0), L(80, 700), L(180, 700), L(180, 400), L(440, 400), L(440, 700), L(540, 700), L(540, 0), L(440, 0), L(440, 320), L(180, 320), L(180, 0), C(),
    ]},
    { char: "e", advanceWidth: 500, lsb: 40, path: [
      M(40, 220), Q(40, 500, 250, 500), Q(460, 500, 460, 260), L(140, 260),
      Q(150, 100, 250, 100), Q(350, 100, 400, 200), L(460, 160),
      Q(420, 0, 250, 0), Q(40, 0, 40, 220), C(),
      M(140, 330), L(360, 330), Q(350, 420, 250, 420), Q(150, 420, 140, 330), C(),
    ]},
    { char: "l", advanceWidth: 250, lsb: 70, path: [
      M(70, 0), L(70, 700), L(170, 700), L(170, 0), C(),
    ]},
    { char: "o", advanceWidth: 520, lsb: 40, path: [
      M(40, 250), Q(40, 500, 260, 500), Q(480, 500, 480, 250), Q(480, 0, 260, 0), Q(40, 0, 40, 250), C(),
      M(140, 250), Q(140, 80, 260, 80), Q(380, 80, 380, 250), Q(380, 420, 260, 420), Q(140, 420, 140, 250), C(),
    ]},
    { char: " ", advanceWidth: 250, lsb: 0, path: [] },
    { char: "W", advanceWidth: 800, lsb: 0, path: [
      M(0, 700), L(150, 700), L(240, 200), L(350, 600), L(450, 600), L(560, 200), L(650, 700), L(800, 700), L(640, 0), L(520, 0), L(400, 440), L(280, 0), L(160, 0), C(),
    ]},
    { char: "r", advanceWidth: 360, lsb: 80, path: [
      M(80, 0), L(80, 500), L(170, 500), L(170, 400), Q(220, 500, 340, 500), L(340, 410), Q(230, 410, 170, 340), L(170, 0), C(),
    ]},
    { char: "d", advanceWidth: 550, lsb: 40, path: [
      M(40, 250), Q(40, 500, 250, 500), Q(370, 500, 430, 380), L(430, 700), L(520, 700), L(520, 0), L(430, 0), L(430, 120),
      Q(370, 0, 250, 0), Q(40, 0, 40, 250), C(),
      M(140, 250), Q(140, 80, 260, 80), Q(380, 80, 430, 200), L(430, 300), Q(380, 420, 260, 420), Q(140, 420, 140, 250), C(),
    ]},
  ],
  kerning: [
    { left: "A", right: "W", value: -30 },
    { left: "W", right: "o", value: -20 },
    { left: "H", right: "e", value: -10 },
  ],
};
