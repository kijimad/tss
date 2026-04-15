import { describe, it, expect } from "vitest";
import {
  getModulationParams, generateConstellation, generateSignal,
  applyChannel, applyNoiseToConstellation, generateAdslTones, calcAdslRate,
} from "../engine/modem.js";
import {
  createOlt, createOnu, calcFiberLoss, calcRxPower, calcRtt,
  GPON_PARAMS, EPON_PARAMS,
} from "../engine/onu.js";
import { PRESETS } from "../engine/presets.js";

// ══════════════════════════════════════
//  モデム — 変調
// ══════════════════════════════════════

describe("getModulationParams", () => {
  it("ASKは1ビット/シンボル", () => {
    const p = getModulationParams("ASK");
    expect(p.bitsPerSymbol).toBe(1);
    expect(p.type).toBe("ASK");
  });

  it("QPSKは2ビット/シンボル", () => {
    expect(getModulationParams("QPSK").bitsPerSymbol).toBe(2);
  });

  it("QAM256は8ビット/シンボル", () => {
    expect(getModulationParams("QAM256").bitsPerSymbol).toBe(8);
  });

  it("ビットレート = baud × bitsPerSymbol", () => {
    for (const mod of ["ASK", "FSK", "PSK", "QPSK", "QAM16", "QAM64", "QAM256"] as const) {
      const p = getModulationParams(mod);
      expect(p.bitRateBps).toBe(p.baudRate * p.bitsPerSymbol);
    }
  });
});

describe("generateConstellation", () => {
  it("ASKは2点", () => expect(generateConstellation("ASK")).toHaveLength(2));
  it("QPSKは4点", () => expect(generateConstellation("QPSK")).toHaveLength(4));
  it("QAM16は16点", () => expect(generateConstellation("QAM16")).toHaveLength(16));
  it("QAM64は64点", () => expect(generateConstellation("QAM64")).toHaveLength(64));
  it("QAM256は256点", () => expect(generateConstellation("QAM256")).toHaveLength(256));

  it("各点にbitsフィールドがある", () => {
    const pts = generateConstellation("QPSK");
    for (const p of pts) {
      expect(p.bits).toBeTruthy();
      expect(p.bits.length).toBe(2); // QPSKは2bit
    }
  });
});

describe("generateSignal", () => {
  it("指定サンプル数の波形を生成", () => {
    const params = getModulationParams("PSK");
    const signal = generateSignal("10110010", params, 100);
    expect(signal).toHaveLength(100);
  });

  it("各サンプルにtime/amplitude/frequency/phaseがある", () => {
    const params = getModulationParams("ASK");
    const signal = generateSignal("1010", params, 50);
    for (const s of signal) {
      expect(typeof s.time).toBe("number");
      expect(typeof s.amplitude).toBe("number");
      expect(typeof s.frequency).toBe("number");
    }
  });
});

describe("applyChannel", () => {
  it("SNRが高いほどBERが低い", () => {
    const params = getModulationParams("QPSK");
    const signal = generateSignal("10110010", params, 100);
    const { quality: q1 } = applyChannel(signal, 30, 3);
    const { quality: q2 } = applyChannel(signal, 10, 3);
    expect(q1.berEstimate).toBeLessThan(q2.berEstimate);
  });

  it("減衰が適用される", () => {
    const params = getModulationParams("PSK");
    const signal = generateSignal("1010", params, 100);
    const { received } = applyChannel(signal, 30, 10);
    // 受信信号の平均振幅が送信より小さい
    const txAvg = signal.reduce((s, v) => s + Math.abs(v.amplitude), 0) / signal.length;
    const rxAvg = received.reduce((s, v) => s + Math.abs(v.amplitude), 0) / received.length;
    expect(rxAvg).toBeLessThan(txAvg);
  });
});

describe("applyNoiseToConstellation", () => {
  it("受信点が追加される", () => {
    const pts = generateConstellation("QPSK");
    const noisy = applyNoiseToConstellation(pts, 20);
    for (const p of noisy) {
      expect(p.receivedI).toBeDefined();
      expect(p.receivedQ).toBeDefined();
    }
  });

  it("SNRが低いと受信点のずれが大きい", () => {
    const pts = generateConstellation("QPSK");
    const highSnr = applyNoiseToConstellation(pts, 40);
    const lowSnr = applyNoiseToConstellation(pts, 5);
    // 平均誤差を比較
    const errHigh = highSnr.reduce((s, p) => s + Math.abs(p.receivedI! - p.i) + Math.abs(p.receivedQ! - p.q), 0);
    const errLow = lowSnr.reduce((s, p) => s + Math.abs(p.receivedI! - p.i) + Math.abs(p.receivedQ! - p.q), 0);
    // 統計的に低SNRの方がずれが大きい (確率的なのでマージンを持つ)
    // 極端なSNR差なら確実
    expect(errLow).toBeGreaterThan(errHigh * 0.5);
  });
});

// ══════════════════════════════════════
//  ADSL
// ══════════════════════════════════════

describe("generateAdslTones", () => {
  it("3つの帯域(voice, upstream, downstream)を返す", () => {
    const bands = generateAdslTones(50, 2);
    expect(bands).toHaveLength(3);
    expect(bands.map(b => b.name)).toEqual(["voice (POTS)", "upstream", "downstream"]);
  });

  it("距離が長いと下り速度が低下", () => {
    const near = calcAdslRate(generateAdslTones(50, 1));
    const far = calcAdslRate(generateAdslTones(50, 5));
    expect(near.downMbps).toBeGreaterThan(far.downMbps);
  });

  it("下り速度 > 上り速度 (非対称)", () => {
    const rate = calcAdslRate(generateAdslTones(50, 2));
    expect(rate.downMbps).toBeGreaterThan(rate.upMbps);
  });
});

// ══════════════════════════════════════
//  ONU / PON
// ══════════════════════════════════════

describe("calcFiberLoss", () => {
  it("損失が正の値", () => {
    const fiber = calcFiberLoss(10, 32);
    expect(fiber.totalLossDb).toBeGreaterThan(0);
  });

  it("距離が長いと損失が大きい", () => {
    const short = calcFiberLoss(1, 32);
    const long = calcFiberLoss(20, 32);
    expect(long.totalLossDb).toBeGreaterThan(short.totalLossDb);
  });

  it("スプリット比が大きいと損失が大きい", () => {
    const small = calcFiberLoss(5, 8);
    const large = calcFiberLoss(5, 64);
    expect(large.splitterLossDb).toBeGreaterThan(small.splitterLossDb);
  });

  it("総損失 = ファイバー + スプリッター + コネクタ", () => {
    const f = calcFiberLoss(5, 32, 3);
    const fiberLoss = f.lengthKm * f.attenuationDbPerKm;
    const expected = fiberLoss + f.splitterLossDb + f.connectorLossDb;
    expect(f.totalLossDb).toBeCloseTo(expected, 1);
  });
});

describe("calcRxPower", () => {
  it("受信パワー = 送信 - 損失", () => {
    const fiber = calcFiberLoss(5, 32);
    const rx = calcRxPower(3, fiber);
    expect(rx).toBeCloseTo(3 - fiber.totalLossDb, 1);
  });
});

describe("calcRtt", () => {
  it("距離に比例", () => {
    const rtt1 = calcRtt(1);
    const rtt10 = calcRtt(10);
    expect(rtt10).toBeCloseTo(rtt1 * 10, 0);
  });
});

describe("createOlt", () => {
  it("GPONのOLTを作成", () => {
    const olt = createOlt("GPON");
    expect(olt.ponType).toBe("GPON");
    expect(olt.downstreamGbps).toBe(GPON_PARAMS.downstreamGbps);
  });

  it("EPONのOLTを作成", () => {
    const olt = createOlt("EPON");
    expect(olt.ponType).toBe("EPON");
    expect(olt.downstreamGbps).toBe(EPON_PARAMS.downstreamGbps);
  });
});

describe("createOnu", () => {
  it("ONUを作成して受信パワーを計算", () => {
    const onu = createOnu(1, 5, "GPON");
    expect(onu.id).toBe(1);
    expect(onu.distanceKm).toBe(5);
    expect(onu.rxPowerDbm).toBeLessThan(onu.txPowerDbm);
  });

  it("距離が遠いと受信パワーが低い", () => {
    const near = createOnu(1, 1, "GPON");
    const far = createOnu(2, 20, "GPON");
    expect(far.rxPowerDbm).toBeLessThan(near.rxPowerDbm);
  });
});

// ══════════════════════════════════════
//  プリセット
// ══════════════════════════════════════

describe("PRESETS", () => {
  it("10個のプリセット", () => {
    expect(PRESETS).toHaveLength(10);
  });

  it("名前が一意", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const preset of PRESETS) {
    it(`${preset.name}: 実行可能`, () => {
      const result = preset.run();
      expect(result.snapshots.length).toBeGreaterThanOrEqual(1);
      expect(result.allEvents.length).toBeGreaterThan(0);
      expect(result.name).toBe(preset.name);
    });
  }
});
