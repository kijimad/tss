/**
 * modem.ts — モデム (変調/復調) シミュレーション
 *
 * デジタル信号をアナログ信号に変調し、伝送路のノイズ・減衰を経て
 * 受信側で復調する過程をステップ実行でシミュレートする。
 *
 * 変調方式: ASK, FSK, PSK, QPSK, QAM-16, QAM-64, QAM-256
 * 物理現象: ガウスノイズ、信号減衰、ビットエラー
 */

import type {
  ModulationType, ModulationParams, SignalSample, ConstellationPoint,
  SignalQuality, AdslTone, AdslBand,
} from "./types.js";

// ── 定数 ──

const TWO_PI = 2 * Math.PI;

/** 変調方式のパラメータ */
export function getModulationParams(type: ModulationType, carrierHz = 1800): ModulationParams {
  const map: Record<ModulationType, { bps: number; baud: number }> = {
    ASK:    { bps: 1, baud: 300 },
    FSK:    { bps: 1, baud: 1200 },
    PSK:    { bps: 1, baud: 2400 },
    QPSK:   { bps: 2, baud: 2400 },
    QAM16:  { bps: 4, baud: 2400 },
    QAM64:  { bps: 6, baud: 2400 },
    QAM256: { bps: 8, baud: 2400 },
  };
  const p = map[type];
  return {
    type, carrierFreqHz: carrierHz, baudRate: p.baud,
    bitsPerSymbol: p.bps, bitRateBps: p.bps * p.baud,
  };
}

// ── ガウスノイズ ──

/** Box-Muller変換によるガウス乱数 */
function gaussianNoise(stddev: number): number {
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  return stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

// ── コンスタレーション生成 ──

/** QAM コンスタレーション生成 */
export function generateConstellation(type: ModulationType): ConstellationPoint[] {
  const points: ConstellationPoint[] = [];
  switch (type) {
    case "ASK":
      points.push({ i: 0, q: 0, bits: "0" }, { i: 1, q: 0, bits: "1" });
      break;
    case "FSK":
      points.push({ i: -1, q: 0, bits: "0" }, { i: 1, q: 0, bits: "1" });
      break;
    case "PSK":
      points.push({ i: -1, q: 0, bits: "0" }, { i: 1, q: 0, bits: "1" });
      break;
    case "QPSK": {
      const vals = [[-1, -1, "00"], [-1, 1, "01"], [1, -1, "10"], [1, 1, "11"]];
      for (const [i, q, b] of vals) points.push({ i: i as number, q: q as number, bits: b as string });
      break;
    }
    case "QAM16": {
      const levels = [-3, -1, 1, 3];
      let idx = 0;
      for (const i of levels) for (const q of levels) {
        points.push({ i, q, bits: idx.toString(2).padStart(4, "0") });
        idx++;
      }
      break;
    }
    case "QAM64": {
      const levels = [-7, -5, -3, -1, 1, 3, 5, 7];
      let idx = 0;
      for (const i of levels) for (const q of levels) {
        points.push({ i, q, bits: idx.toString(2).padStart(6, "0") });
        idx++;
      }
      break;
    }
    case "QAM256": {
      const levels = [-15, -13, -11, -9, -7, -5, -3, -1, 1, 3, 5, 7, 9, 11, 13, 15];
      let idx = 0;
      for (const i of levels) for (const q of levels) {
        points.push({ i, q, bits: idx.toString(2).padStart(8, "0") });
        idx++;
      }
      break;
    }
  }
  return points;
}

// ── 信号生成 ──

/** 変調信号を生成 (シンプルな波形表現) */
export function generateSignal(
  bits: string, params: ModulationParams, numSamples: number,
): SignalSample[] {
  const samples: SignalSample[] = [];
  const symbolDuration = 1000 / params.baudRate; // ms
  const bps = params.bitsPerSymbol;
  const totalTime = (bits.length / bps) * symbolDuration;
  const dt = totalTime / numSamples;

  for (let s = 0; s < numSamples; s++) {
    const t = s * dt;
    const symbolIdx = Math.min(Math.floor(t / symbolDuration), Math.floor(bits.length / bps) - 1);
    const symbolBits = bits.slice(symbolIdx * bps, (symbolIdx + 1) * bps);
    const symbolVal = parseInt(symbolBits, 2) || 0;

    let amplitude = 0;
    let frequency = params.carrierFreqHz;
    let phase = 0;

    switch (params.type) {
      case "ASK":
        amplitude = symbolVal === 1 ? 1 : 0.2;
        phase = TWO_PI * frequency * (t / 1000);
        amplitude *= Math.sin(phase);
        break;
      case "FSK":
        frequency = symbolVal === 1 ? params.carrierFreqHz * 1.2 : params.carrierFreqHz * 0.8;
        phase = TWO_PI * frequency * (t / 1000);
        amplitude = Math.sin(phase);
        break;
      case "PSK":
        phase = symbolVal === 1 ? 0 : Math.PI;
        amplitude = Math.sin(TWO_PI * frequency * (t / 1000) + phase);
        break;
      case "QPSK":
      case "QAM16":
      case "QAM64":
      case "QAM256": {
        const constellation = generateConstellation(params.type);
        const point = constellation[symbolVal % constellation.length];
        if (point) {
          const maxLevel = params.type === "QPSK" ? 1 : params.type === "QAM16" ? 3 : params.type === "QAM64" ? 7 : 15;
          const normI = point.i / maxLevel;
          const normQ = point.q / maxLevel;
          const omega = TWO_PI * frequency * (t / 1000);
          amplitude = normI * Math.cos(omega) - normQ * Math.sin(omega);
        }
        break;
      }
    }

    samples.push({ time: t, amplitude, frequency, phase });
  }
  return samples;
}

/** 伝送路のノイズと減衰を適用 */
export function applyChannel(
  signal: SignalSample[], snrDb: number, attenuationDb: number,
): { received: SignalSample[]; quality: SignalQuality } {
  const attenFactor = Math.pow(10, -attenuationDb / 20);
  // 信号電力を推定
  let signalPower = 0;
  for (const s of signal) signalPower += s.amplitude * s.amplitude;
  signalPower /= signal.length;
  const noisePower = signalPower / Math.pow(10, snrDb / 10);
  const noiseStddev = Math.sqrt(noisePower);

  const received: SignalSample[] = [];
  let errorPower = 0;
  for (const s of signal) {
    const n = gaussianNoise(noiseStddev);
    const amp = s.amplitude * attenFactor + n;
    errorPower += n * n;
    received.push({ time: s.time, amplitude: amp, frequency: s.frequency, phase: s.phase });
  }

  const evm = signalPower > 0 ? Math.sqrt(errorPower / signal.length / signalPower) * 100 : 0;
  // BER推定 (近似式: erfc(sqrt(SNR_linear)))
  const snrLinear = Math.pow(10, snrDb / 10);
  const berEstimate = 0.5 * erfc(Math.sqrt(snrLinear));

  return {
    received,
    quality: { snrDb, berEstimate, evm: Math.round(evm * 10) / 10, attenuationDb },
  };
}

/** 相補誤差関数の近似 */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = poly * Math.exp(-x * x);
  return x >= 0 ? result : 2 - result;
}

/** コンスタレーションにノイズを適用 */
export function applyNoiseToConstellation(
  points: ConstellationPoint[], snrDb: number,
): ConstellationPoint[] {
  // 信号電力を推定
  let sigPow = 0;
  for (const p of points) sigPow += p.i * p.i + p.q * p.q;
  sigPow /= points.length;
  const noisePow = sigPow / Math.pow(10, snrDb / 10);
  const std = Math.sqrt(noisePow / 2);

  return points.map(p => ({
    ...p,
    receivedI: p.i + gaussianNoise(std),
    receivedQ: p.q + gaussianNoise(std),
  }));
}

// ── ADSL シミュレーション ──

/** ADSL DMTトーンを生成 (256トーン、4.3125kHz間隔) */
export function generateAdslTones(lineSnrDb: number, distanceKm: number): AdslBand[] {
  const toneSpacing = 4.3125; // kHz
  const bands: AdslBand[] = [];

  // 音声帯域 (0-4kHz) — トーン0
  const voiceTones: AdslTone[] = [
    { toneNum: 0, freqKHz: 0, snrDb: 0, bitsPerTone: 0, modulation: "ASK", powerDbm: -40 },
  ];
  bands.push({ name: "voice (POTS)", startKHz: 0, endKHz: 4, tones: voiceTones });

  // 上り帯域 (25-138kHz) — トーン6-31
  const upTones: AdslTone[] = [];
  for (let t = 6; t <= 31; t++) {
    const freq = t * toneSpacing;
    // 距離による減衰 (周波数依存)
    const atten = distanceKm * (6 + freq / 50);
    const toneSnr = Math.max(0, lineSnrDb - atten);
    const bitsPerTone = snrToBits(toneSnr);
    upTones.push({
      toneNum: t, freqKHz: freq, snrDb: Math.round(toneSnr * 10) / 10,
      bitsPerTone, modulation: bitsToModulation(bitsPerTone),
      powerDbm: Math.round((-34 - atten / 3) * 10) / 10,
    });
  }
  bands.push({ name: "upstream", startKHz: 25, endKHz: 138, tones: upTones });

  // 下り帯域 (138-1104kHz) — トーン32-255
  const downTones: AdslTone[] = [];
  for (let t = 32; t <= 255; t++) {
    const freq = t * toneSpacing;
    const atten = distanceKm * (6 + freq / 30);
    const toneSnr = Math.max(0, lineSnrDb - atten);
    const bitsPerTone = snrToBits(toneSnr);
    downTones.push({
      toneNum: t, freqKHz: freq, snrDb: Math.round(toneSnr * 10) / 10,
      bitsPerTone, modulation: bitsToModulation(bitsPerTone),
      powerDbm: Math.round((-34 - atten / 3) * 10) / 10,
    });
  }
  bands.push({ name: "downstream", startKHz: 138, endKHz: 1104, tones: downTones });

  return bands;
}

/** SNRからビット数を決定 (Shannon容量に基づく近似) */
function snrToBits(snrDb: number): number {
  if (snrDb < 6) return 0;
  // 各変調方式の最低SNR要件
  if (snrDb >= 38) return 15;  // QAM-32768
  if (snrDb >= 34) return 12;  // QAM-4096
  if (snrDb >= 30) return 10;  // QAM-1024
  if (snrDb >= 25) return 8;   // QAM-256
  if (snrDb >= 22) return 6;   // QAM-64
  if (snrDb >= 17) return 4;   // QAM-16
  if (snrDb >= 12) return 2;   // QPSK
  if (snrDb >= 6) return 1;    // BPSK
  return 0;
}

function bitsToModulation(bits: number): ModulationType {
  if (bits >= 8) return "QAM256";
  if (bits >= 6) return "QAM64";
  if (bits >= 4) return "QAM16";
  if (bits >= 2) return "QPSK";
  return "PSK";
}

/** ADSL の理論速度を計算 */
export function calcAdslRate(bands: AdslBand[]): { upMbps: number; downMbps: number } {
  let upBits = 0;
  let downBits = 0;
  for (const band of bands) {
    for (const tone of band.tones) {
      if (band.name === "upstream") upBits += tone.bitsPerTone;
      if (band.name === "downstream") downBits += tone.bitsPerTone;
    }
  }
  // DMTシンボルレート: 4000 symbols/sec
  const symbolRate = 4000;
  return {
    upMbps: Math.round(upBits * symbolRate / 1_000_000 * 100) / 100,
    downMbps: Math.round(downBits * symbolRate / 1_000_000 * 100) / 100,
  };
}
