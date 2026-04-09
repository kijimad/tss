import { FontRenderer, BUILTIN_FONT } from "../engine/font.js";
import type { RenderConfig, TextRenderResult, RenderTrace, RasterResult } from "../engine/font.js";

export interface Example {
  name: string;
  description: string;
  text: string;
  config: RenderConfig;
}

export const EXAMPLES: Example[] = [
  {
    name: "基本レンダリング (AA なし)",
    description: "1-bit ラスタライズ。アンチエイリアスなしでジャギーが目立つ。",
    text: "Hello",
    config: { fontSize: 48, antialiasLevel: 1, hinting: false, subpixelRendering: false },
  },
  {
    name: "アンチエイリアス 4x",
    description: "4x スーパーサンプリングでエッジが滑らかになる。カバレッジ→グレースケール変換。",
    text: "Hello",
    config: { fontSize: 48, antialiasLevel: 4, hinting: false, subpixelRendering: false },
  },
  {
    name: "アンチエイリアス 8x (高品質)",
    description: "8x スーパーサンプリング。64サンプル/ピクセルで非常に滑らか。",
    text: "Hello",
    config: { fontSize: 48, antialiasLevel: 8, hinting: false, subpixelRendering: false },
  },
  {
    name: "ヒンティング有効",
    description: "グリッドフィッティングで輪郭をピクセル境界に合わせる。小サイズで鮮明になる。",
    text: "Hello",
    config: { fontSize: 24, antialiasLevel: 4, hinting: true, subpixelRendering: false },
  },
  {
    name: "小さいフォントサイズ (12px)",
    description: "12px での描画。ヒンティングと AA の重要性が顕著になる。",
    text: "Hello World",
    config: { fontSize: 12, antialiasLevel: 4, hinting: true, subpixelRendering: false },
  },
  {
    name: "カーニング比較",
    description: "AW ペアにカーニングが適用され文字間が詰まる。",
    text: "AW Hello",
    config: { fontSize: 48, antialiasLevel: 4, hinting: false, subpixelRendering: false },
  },
  {
    name: "大サイズ (96px) ベジェ曲線",
    description: "96px でベジェ曲線の滑らかさを確認。セグメント分割が細かくなる。",
    text: "ABed",
    config: { fontSize: 96, antialiasLevel: 4, hinting: false, subpixelRendering: false },
  },
];

function traceColor(phase: RenderTrace["phase"]): string {
  switch (phase) {
    case "glyph_lookup": return "#3b82f6";
    case "scaling":      return "#f59e0b";
    case "hinting":      return "#a78bfa";
    case "outline":      return "#06b6d4";
    case "rasterize":    return "#22c55e";
    case "antialias":    return "#ec4899";
    case "composite":    return "#f97316";
    case "kerning":      return "#10b981";
  }
}

/** ピクセルグリッドを Canvas に描画する */
function drawRaster(ctx: CanvasRenderingContext2D, raster: RasterResult, x: number, y: number, pixelScale: number, color: string): void {
  const [r, g, b] = hexToRgb(color);
  for (let py = 0; py < raster.height; py++) {
    for (let px = 0; px < raster.width; px++) {
      const alpha = raster.pixels[py * raster.width + px] ?? 0;
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect((x + px) * pixelScale, (y + py) * pixelScale, pixelScale, pixelScale);
    }
  }
}

/** ピクセルグリッドを拡大表示する (デバッグ用) */
function drawPixelGrid(ctx: CanvasRenderingContext2D, raster: RasterResult, ox: number, oy: number, cellSize: number): void {
  for (let py = 0; py < raster.height; py++) {
    for (let px = 0; px < raster.width; px++) {
      const val = raster.pixels[py * raster.width + px] ?? 0;
      const gray = Math.round(val * 255);
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(ox + px * cellSize, oy + py * cellSize, cellSize - 1, cellSize - 1);
    }
  }
  // グリッド線
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= raster.width; i++) {
    ctx.beginPath(); ctx.moveTo(ox + i * cellSize, oy); ctx.lineTo(ox + i * cellSize, oy + raster.height * cellSize); ctx.stroke();
  }
  for (let i = 0; i <= raster.height; i++) {
    ctx.beginPath(); ctx.moveTo(ox, oy + i * cellSize); ctx.lineTo(ox + raster.width * cellSize, oy + i * cellSize); ctx.stroke();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export class FontApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Font Renderer Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e2e8f0;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Render";
    runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: 設定 + トレース
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Render Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Pipeline Trace";
    leftPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    leftPanel.appendChild(trDiv);

    main.appendChild(leftPanel);

    // 右: Canvas (上=実寸, 下=拡大ピクセル)
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    const prevLabel = document.createElement("div");
    prevLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    prevLabel.textContent = "Preview (実寸)";
    rightPanel.appendChild(prevLabel);

    const previewCanvas = document.createElement("canvas");
    previewCanvas.style.cssText = "height:120px;width:100%;background:#000;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(previewCanvas);

    const gridLabel = document.createElement("div");
    gridLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    gridLabel.textContent = "Pixel Grid (拡大)";
    rightPanel.appendChild(gridLabel);

    const gridCanvas = document.createElement("canvas");
    gridCanvas.style.cssText = "flex:1;width:100%;background:#000;";
    rightPanel.appendChild(gridCanvas);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderConfig = (ex: Example) => {
      cfgDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        cfgDiv.appendChild(r);
      };
      add("テキスト", `"${ex.text}"`, "#e2e8f0");
      add("フォント", BUILTIN_FONT.name, "#3b82f6");
      add("サイズ", `${ex.config.fontSize}px`, "#f59e0b");
      add("AA レベル", ex.config.antialiasLevel === 1 ? "なし (1-bit)" : `${ex.config.antialiasLevel}x (${ex.config.antialiasLevel ** 2} samples/px)`, "#ec4899");
      add("ヒンティング", ex.config.hinting ? "有効" : "無効", "#a78bfa");
      add("unitsPerEm", String(BUILTIN_FONT.unitsPerEm), "#64748b");
      add("ascender", String(BUILTIN_FONT.ascender), "#64748b");
      add("descender", String(BUILTIN_FONT.descender), "#64748b");
    };

    const renderTrace = (trace: RenderTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = traceColor(step.phase);
        el.innerHTML =
          `<span style="min-width:70px;padding:0 4px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    const renderPreview = (result: TextRenderResult) => {
      const dpr = devicePixelRatio;
      const cw = previewCanvas.clientWidth;
      const ch = previewCanvas.clientHeight;
      previewCanvas.width = cw * dpr;
      previewCanvas.height = ch * dpr;
      const ctx = previewCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      drawRaster(ctx, result.composite, 10, 10, 1, "#e2e8f0");
    };

    const renderGrid = (result: TextRenderResult) => {
      const dpr = devicePixelRatio;
      const cw = gridCanvas.clientWidth;
      const ch = gridCanvas.clientHeight;
      gridCanvas.width = cw * dpr;
      gridCanvas.height = ch * dpr;
      const ctx = gridCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      // 各グリフを個別に拡大表示
      let offsetX = 10;
      for (const g of result.glyphs) {
        if (g.char === " ") { offsetX += 30; continue; }
        const cellSize = Math.min(12, Math.floor((ch - 40) / g.raster.height));
        if (cellSize < 2) continue;

        // ラベル
        ctx.fillStyle = "#64748b";
        ctx.font = "10px monospace";
        ctx.fillText(`"${g.char}"`, offsetX, 14);

        drawPixelGrid(ctx, g.raster, offsetX, 20, cellSize);
        offsetX += g.raster.width * cellSize + 10;
        if (offsetX > cw - 20) break;
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderConfig(ex);
      trDiv.innerHTML = "";
    };

    const runRender = (ex: Example) => {
      const renderer = new FontRenderer(BUILTIN_FONT);
      const result = renderer.renderText(ex.text, ex.config);
      renderConfig(ex);
      renderTrace(result.trace);
      renderPreview(result);
      renderGrid(result);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runRender(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
