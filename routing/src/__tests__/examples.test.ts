import { describe, it, expect } from "vitest";
import { buildInternetTopology } from "../net/topology.js";

// EXAMPLES配列をテスト用に直接定義（app.tsのEXAMPLESと同じ内容）
// app.tsからエクスポートするとUIコードとの結合が強くなるため、テスト側で同値を検証する
const EXAMPLES = [
  { name: "同一AS内ルーティング", source: "R1", destination: "R4", speed: 500 },
  { name: "AS間ルーティング", source: "R1", destination: "R6", speed: 600 },
  { name: "最長経路", source: "R3", destination: "R10", speed: 700 },
  { name: "隣接ルータ", source: "R1", destination: "R2", speed: 300 },
] as const;

describe("EXAMPLES プリセット", () => {
  const graph = buildInternetTopology();

  it("すべての例のソースルータがトポロジに存在する", () => {
    for (const ex of EXAMPLES) {
      expect(graph.getRouter(ex.source), `${ex.name}: ソース ${ex.source} が存在しない`).toBeDefined();
    }
  });

  it("すべての例の宛先ルータがトポロジに存在する", () => {
    for (const ex of EXAMPLES) {
      expect(graph.getRouter(ex.destination), `${ex.name}: 宛先 ${ex.destination} が存在しない`).toBeDefined();
    }
  });

  it("すべての例でソースと宛先が異なる", () => {
    for (const ex of EXAMPLES) {
      expect(ex.source, `${ex.name}: ソースと宛先が同じ`).not.toBe(ex.destination);
    }
  });

  it("すべての例の速度が有効範囲内である (100-1500ms)", () => {
    for (const ex of EXAMPLES) {
      expect(ex.speed, `${ex.name}: 速度が範囲外`).toBeGreaterThanOrEqual(100);
      expect(ex.speed, `${ex.name}: 速度が範囲外`).toBeLessThanOrEqual(1500);
    }
  });

  it("すべての例の名前がユニークである", () => {
    const names = EXAMPLES.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("「同一AS内ルーティング」のソースと宛先が同じASに属する", () => {
    const ex = EXAMPLES.find(e => e.name === "同一AS内ルーティング");
    expect(ex).toBeDefined();
    if (ex === undefined) return;
    const src = graph.getRouter(ex.source);
    const dst = graph.getRouter(ex.destination);
    expect(src).toBeDefined();
    expect(dst).toBeDefined();
    expect(src?.as).toBe(dst?.as);
  });

  it("「AS間ルーティング」のソースと宛先が異なるASに属する", () => {
    const ex = EXAMPLES.find(e => e.name === "AS間ルーティング");
    expect(ex).toBeDefined();
    if (ex === undefined) return;
    const src = graph.getRouter(ex.source);
    const dst = graph.getRouter(ex.destination);
    expect(src).toBeDefined();
    expect(dst).toBeDefined();
    expect(src?.as).not.toBe(dst?.as);
  });

  it("「隣接ルータ」のソースと宛先が直接リンクで接続されている", () => {
    const ex = EXAMPLES.find(e => e.name === "隣接ルータ");
    expect(ex).toBeDefined();
    if (ex === undefined) return;
    const hasDirectLink = graph.links.some(
      l => (l.from === ex.source && l.to === ex.destination) ||
           (l.from === ex.destination && l.to === ex.source),
    );
    expect(hasDirectLink, "直接リンクが見つからない").toBe(true);
  });
});
