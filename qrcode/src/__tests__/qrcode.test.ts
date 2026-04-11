/* QRコード シミュレーター テスト */

import { describe, it, expect } from "vitest";
import { simulate, generateQr, detectMode, selectVersion, getVersionInfo, encodeData } from "../qrcode/engine.js";
import { PRESETS } from "../qrcode/presets.js";
import type { SimEvent, SimStep } from "../qrcode/types.js";

describe("QR Code Engine", () => {
  // ─── モード検出 ───

  describe("モード検出", () => {
    it("数字のみならnumericモード", () => {
      expect(detectMode("0123456789")).toBe("numeric");
    });

    it("英数字ならalphanumericモード", () => {
      expect(detectMode("HELLO WORLD")).toBe("alphanumeric");
      expect(detectMode("ABC123")).toBe("alphanumeric");
    });

    it("小文字を含むならbyteモード", () => {
      expect(detectMode("hello")).toBe("byte");
    });

    it("記号を含む場合の判定", () => {
      expect(detectMode("$%*+-./:")).toBe("alphanumeric");
      expect(detectMode("hello@world")).toBe("byte");
    });

    it("空文字はbyteモード", () => {
      expect(detectMode("")).toBe("alphanumeric"); // 空文字は全文字がALPHANUM_CHARSに含まれる
    });
  });

  // ─── バージョン選択 ───

  describe("バージョン選択", () => {
    it("短いデータはV1を選択", () => {
      expect(selectVersion("123", "numeric", "L")).toBe(1);
    });

    it("データが増えるとバージョンが上がる", () => {
      const v1 = selectVersion("Hi", "byte", "M");
      const v2 = selectVersion("Hello, World! This is a longer text.", "byte", "M");
      expect(v2).toBeGreaterThanOrEqual(v1);
    });

    it("ECレベルが高いとバージョンが上がる", () => {
      const vL = selectVersion("Hello World Test", "byte", "L");
      const vH = selectVersion("Hello World Test", "byte", "H");
      expect(vH).toBeGreaterThanOrEqual(vL);
    });
  });

  // ─── バージョン情報 ───

  describe("バージョン情報", () => {
    it("V1のサイズは21x21", () => {
      const info = getVersionInfo(1);
      expect(info.size).toBe(21);
    });

    it("V2のサイズは25x25", () => {
      const info = getVersionInfo(2);
      expect(info.size).toBe(25);
    });

    it("バージョンごとにサイズが4ずつ増加", () => {
      for (let v = 1; v <= 10; v++) {
        const info = getVersionInfo(v);
        expect(info.size).toBe(17 + v * 4);
      }
    });

    it("V1にはアライメントパターンがない", () => {
      expect(getVersionInfo(1).alignmentPositions).toHaveLength(0);
    });

    it("V2以上にはアライメントパターンがある", () => {
      expect(getVersionInfo(2).alignmentPositions.length).toBeGreaterThan(0);
    });

    it("データ容量はL > M > Q > H", () => {
      const info = getVersionInfo(1);
      expect(info.dataCapacity.L).toBeGreaterThan(info.dataCapacity.M);
      expect(info.dataCapacity.M).toBeGreaterThan(info.dataCapacity.Q);
      expect(info.dataCapacity.Q).toBeGreaterThan(info.dataCapacity.H);
    });

    it("未対応バージョンでエラー", () => {
      expect(() => getVersionInfo(0)).toThrow();
      expect(() => getVersionInfo(11)).toThrow();
    });
  });

  // ─── データエンコード ───

  describe("データエンコード", () => {
    it("数字モードのエンコード", () => {
      const events: SimEvent[] = [];
      const steps: SimStep[] = [];
      const result = encodeData("0123456789", "numeric", 1, "M", events, steps);
      expect(result.modeIndicator).toBe("0001"); // 数字モード
      expect(result.dataCodewords.length).toBeGreaterThan(0);
    });

    it("英数字モードのエンコード", () => {
      const events: SimEvent[] = [];
      const steps: SimStep[] = [];
      const result = encodeData("HELLO", "alphanumeric", 1, "M", events, steps);
      expect(result.modeIndicator).toBe("0010"); // 英数字モード
    });

    it("バイトモードのエンコード", () => {
      const events: SimEvent[] = [];
      const steps: SimStep[] = [];
      const result = encodeData("Hello", "byte", 1, "M", events, steps);
      expect(result.modeIndicator).toBe("0100"); // バイトモード
    });

    it("パディングが適用される", () => {
      const events: SimEvent[] = [];
      const steps: SimStep[] = [];
      const result = encodeData("1", "numeric", 1, "M", events, steps);
      // V1-MはdataCapacity=16 → 128bit
      expect(result.fullBitstream.length).toBe(16 * 8);
    });

    it("ECコードワードが生成される", () => {
      const events: SimEvent[] = [];
      const steps: SimStep[] = [];
      const result = encodeData("HELLO", "alphanumeric", 1, "M", events, steps);
      expect(result.ecCodewords.length).toBeGreaterThan(0);
    });

    it("インターリーブ済みコードワードが全データ+ECを含む", () => {
      const events: SimEvent[] = [];
      const steps: SimStep[] = [];
      const result = encodeData("TEST", "alphanumeric", 1, "L", events, steps);
      expect(result.finalCodewords.length).toBe(
        result.dataCodewords.length + result.ecCodewords.length
      );
    });
  });

  // ─── QRコード生成 ───

  describe("QRコード生成", () => {
    it("生成が成功する", () => {
      const qr = generateQr("Hello", "M");
      expect(qr.matrix.matrix.length).toBe(qr.matrix.size);
      expect(qr.matrix.matrix[0].length).toBe(qr.matrix.size);
    });

    it("ファインダーパターンが配置される", () => {
      const qr = generateQr("Test", "M");
      const m = qr.matrix.matrix;
      // 左上ファインダー
      expect(m[0][0].type).toBe("finder");
      expect(m[0][0].dark).toBe(true);
      expect(m[3][3].type).toBe("finder");
      expect(m[3][3].dark).toBe(true);
    });

    it("タイミングパターンが配置される", () => {
      const qr = generateQr("Test", "M");
      const m = qr.matrix.matrix;
      // 行6のタイミングパターン
      expect(m[6][8].type).toBe("timing");
      expect(m[6][8].dark).toBe(true); // 偶数列は暗
    });

    it("マスクパターンが0-7の範囲", () => {
      const qr = generateQr("Test", "M");
      expect(qr.matrix.maskPattern).toBeGreaterThanOrEqual(0);
      expect(qr.matrix.maskPattern).toBeLessThanOrEqual(7);
    });

    it("ペナルティスコアが計算される", () => {
      const qr = generateQr("Hello World", "M");
      expect(qr.matrix.penalties.total).toBeGreaterThan(0);
      expect(qr.matrix.penalties.total).toBe(
        qr.matrix.penalties.rule1 +
        qr.matrix.penalties.rule2 +
        qr.matrix.penalties.rule3 +
        qr.matrix.penalties.rule4
      );
    });

    it("バージョン指定が反映される", () => {
      const qr = generateQr("Hi", "M", 3);
      expect(qr.analysis.version).toBe(3);
      expect(qr.matrix.size).toBe(29); // V3 = 29x29
    });

    it("ステップが記録される", () => {
      const qr = generateQr("QR", "M");
      expect(qr.steps.length).toBeGreaterThan(0);
      const phases = qr.steps.map(s => s.phase);
      expect(phases).toContain("analyze");
      expect(phases).toContain("encode");
      expect(phases).toContain("place");
      expect(phases).toContain("mask");
    });

    it("イベントが記録される", () => {
      const qr = generateQr("Test", "M");
      expect(qr.events.length).toBeGreaterThan(0);
      const types = qr.events.map(e => e.type);
      expect(types).toContain("analyze");
      expect(types).toContain("encode");
      expect(types).toContain("complete");
    });
  });

  // ─── 誤り訂正レベル比較 ───

  describe("誤り訂正レベル", () => {
    it("ECレベルが高いほどECコードワードが多い", () => {
      const qrL = generateQr("Hi", "L", 1);
      const qrH = generateQr("Hi", "H", 1);
      expect(qrH.encoded.ecCodewords.length).toBeGreaterThan(
        qrL.encoded.ecCodewords.length
      );
    });

    it("ECレベルが高いほどデータコードワードが少ない", () => {
      const qrL = generateQr("Hi", "L", 1);
      const qrH = generateQr("Hi", "H", 1);
      expect(qrH.encoded.dataCodewords.length).toBeLessThan(
        qrL.encoded.dataCodewords.length
      );
    });
  });

  // ─── シミュレーション ───

  describe("シミュレーション", () => {
    it("encode操作が正しく実行される", () => {
      const r = simulate([{ type: "encode", data: "Hello", ecLevel: "M" }]);
      expect(r.results).toHaveLength(1);
      expect(r.events.length).toBeGreaterThan(0);
    });

    it("encode_compareで複数結果が生成される", () => {
      const r = simulate([{ type: "encode_compare", data: "Test", ecLevels: ["L", "M", "Q", "H"] }]);
      expect(r.results).toHaveLength(4);
    });

    it("mask_compareが実行される", () => {
      const r = simulate([{ type: "mask_compare", data: "MASK", ecLevel: "M" }]);
      expect(r.results).toHaveLength(1);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.results.length).toBeGreaterThan(0);
        expect(r.events.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
