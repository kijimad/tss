/**
 * EXAMPLES 配列とプリセットドロップダウンのテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("EXAMPLES プリセット", () => {
  beforeEach(() => {
    // Canvas の getContext モック
    const mockCtx = {
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      quadraticCurveTo: vi.fn(),
      setLineDash: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
      shadowColor: "",
      shadowBlur: 0,
      font: "",
      textAlign: "start" as CanvasTextAlign,
      textBaseline: "alphabetic" as CanvasTextBaseline,
    };

    // canvas の getContext をモック（HTMLCanvasElement のプロトタイプを差し替え）
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      mockCtx as unknown as CanvasRenderingContext2D,
    );
  });

  // ヘルパー: NetApp を初期化して container を返す
  async function initApp(): Promise<HTMLElement> {
    const { NetApp } = await import("../ui/app.js");
    const app = new NetApp();
    const container = document.createElement("div");
    app.init(container);
    return container;
  }

  it("EXAMPLES 配列に 4 つのプリセットが含まれる", async () => {
    const container = await initApp();
    const select = container.querySelector("select");
    expect(select).not.toBeNull();

    // option の数: デフォルト（"-- 例を選択 --"）+ 4 プリセット = 5
    const options = select!.querySelectorAll("option");
    expect(options.length).toBe(5);
  });

  it("各プリセットの名前が正しい", async () => {
    const container = await initApp();
    const select = container.querySelector("select")!;
    const options = Array.from(select.querySelectorAll("option"));

    // デフォルト選択肢
    expect(options[0]?.textContent).toBe("-- 例を選択 --");
    expect(options[0]?.value).toBe("");

    // プリセット名の検証
    const expectedNames = [
      "GET リクエスト",
      "API エンドポイント",
      "404 Not Found",
      "大きなレスポンス",
    ];
    for (let i = 0; i < expectedNames.length; i++) {
      expect(options[i + 1]?.textContent).toBe(expectedNames[i]);
    }
  });

  it("プリセットを選択すると URL 入力欄が更新される", async () => {
    const container = await initApp();
    const select = container.querySelector("select")!;
    const input = container.querySelector<HTMLInputElement>("input[type='text']")!;

    // "API エンドポイント" を選択
    select.value = "API エンドポイント";
    select.dispatchEvent(new Event("change"));

    expect(input.value).toBe("http://93.184.216.34/api/users");
  });

  it("プリセットを選択すると速度スライダーが更新される", async () => {
    const container = await initApp();
    const select = container.querySelector("select")!;
    const speedSlider = container.querySelector<HTMLInputElement>("input[type='range']")!;

    // "大きなレスポンス" を選択（speed: 500）
    select.value = "大きなレスポンス";
    select.dispatchEvent(new Event("change"));

    expect(speedSlider.value).toBe("500");
  });

  it("デフォルト選択肢では URL が変更されない", async () => {
    const container = await initApp();
    const select = container.querySelector("select")!;
    const input = container.querySelector<HTMLInputElement>("input[type='text']")!;
    const originalUrl = input.value;

    // デフォルト選択肢を選択
    select.value = "";
    select.dispatchEvent(new Event("change"));

    // URL は変更されない
    expect(input.value).toBe(originalUrl);
  });
});
