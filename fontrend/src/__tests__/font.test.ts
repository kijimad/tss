import { describe, it, expect } from "vitest";
import {
  evalQuadBezier, evalCubicBezier, outlineToPoints,
  rasterize, applyHinting, FontRenderer, BUILTIN_FONT,
} from "../engine/font.js";
import { EXAMPLES } from "../ui/app.js";

describe("evalQuadBezier", () => {
  it("始点と終点を含む", () => {
    const pts = evalQuadBezier({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 10);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("指定ステップ数+1 個の点を生成する", () => {
    const pts = evalQuadBezier({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 8);
    expect(pts).toHaveLength(9);
  });

  it("中間点が制御点側に膨らむ", () => {
    const pts = evalQuadBezier({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 10);
    const mid = pts[5]!;
    expect(mid.y).toBeGreaterThan(0);
  });
});

describe("evalCubicBezier", () => {
  it("始点と終点を含む", () => {
    const pts = evalCubicBezier({ x: 0, y: 0 }, { x: 30, y: 100 }, { x: 70, y: 100 }, { x: 100, y: 0 }, 10);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });
});

describe("outlineToPoints", () => {
  it("パスセグメントを点列に変換する", () => {
    const path = BUILTIN_FONT.glyphs.find((g) => g.char === "l")!.path;
    const contours = outlineToPoints(path, 0.048, 8);
    expect(contours.length).toBeGreaterThan(0);
    expect(contours[0]!.length).toBeGreaterThan(0);
  });

  it("空のパスは空の配列を返す", () => {
    const contours = outlineToPoints([], 1, 8);
    expect(contours).toHaveLength(0);
  });
});

describe("rasterize", () => {
  it("正方形の輪郭をラスタライズする", () => {
    const contours = [[
      { x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 },
    ]];
    const result = rasterize(contours, 10, 10, 0, 0, 1);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    // 内部のピクセルは 1.0 (完全にカバー)
    const centerVal = result.pixels[5 * 10 + 5]!;
    expect(centerVal).toBe(1);
    // 外部のピクセルは 0
    expect(result.pixels[0]).toBe(0);
  });

  it("AA レベルが高いとエッジが中間値になる", () => {
    const contours = [[
      { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 }, { x: 5.5, y: 5.5 }, { x: 1.5, y: 5.5 },
    ]];
    const result = rasterize(contours, 7, 7, 0, 0, 4);
    // エッジピクセルは 0 < val < 1
    const edgeVal = result.pixels[1 * 7 + 1]!;
    expect(edgeVal).toBeGreaterThan(0);
    expect(edgeVal).toBeLessThanOrEqual(1);
  });
});

describe("applyHinting", () => {
  it("座標をハーフピクセルに丸める", () => {
    const contours = [[{ x: 1.3, y: 2.7 }, { x: 3.8, y: 4.1 }]];
    const hinted = applyHinting(contours);
    expect(hinted[0]![0]!.x).toBe(1.5);
    expect(hinted[0]![0]!.y).toBe(2.5);
  });
});

describe("FontRenderer", () => {
  const renderer = new FontRenderer(BUILTIN_FONT);

  it("テキストをレンダリングできる", () => {
    const result = renderer.renderText("Hello", { fontSize: 32, antialiasLevel: 1, hinting: false, subpixelRendering: false });
    expect(result.glyphs.length).toBeGreaterThan(0);
    expect(result.composite.width).toBeGreaterThan(0);
    expect(result.composite.height).toBeGreaterThan(0);
    expect(result.trace.length).toBeGreaterThan(0);
  });

  it("AA レベルが高いほどピクセルに中間値が多い", () => {
    const noAA = renderer.renderText("A", { fontSize: 32, antialiasLevel: 1, hinting: false, subpixelRendering: false });
    const aa4 = renderer.renderText("A", { fontSize: 32, antialiasLevel: 4, hinting: false, subpixelRendering: false });
    const midNoAA = noAA.composite.pixels.filter((v) => v > 0 && v < 1).length;
    const midAA4 = aa4.composite.pixels.filter((v) => v > 0 && v < 1).length;
    expect(midAA4).toBeGreaterThanOrEqual(midNoAA);
  });

  it("カーニングがトレースに記録される", () => {
    const result = renderer.renderText("AW", { fontSize: 48, antialiasLevel: 1, hinting: false, subpixelRendering: false });
    expect(result.trace.some((t) => t.phase === "kerning")).toBe(true);
  });

  it("存在しない文字はスキップされる", () => {
    const result = renderer.renderText("A!Z", { fontSize: 32, antialiasLevel: 1, hinting: false, subpixelRendering: false });
    expect(result.trace.some((t) => t.detail.includes(".notdef"))).toBe(true);
  });
});

describe("BUILTIN_FONT", () => {
  it("グリフが定義されている", () => {
    expect(BUILTIN_FONT.glyphs.length).toBeGreaterThan(5);
  });

  it("カーニングペアが定義されている", () => {
    expect(BUILTIN_FONT.kerning.length).toBeGreaterThan(0);
  });
});

describe("EXAMPLES", () => {
  it("7 つのサンプル", () => { expect(EXAMPLES).toHaveLength(7); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: レンダリング可能`, () => {
      const renderer = new FontRenderer(BUILTIN_FONT);
      const result = renderer.renderText(ex.text, ex.config);
      expect(result.trace.length).toBeGreaterThan(0);
      expect(result.composite.pixels.length).toBeGreaterThan(0);
    });
  }
});
