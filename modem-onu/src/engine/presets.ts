/**
 * presets.ts — モデム・ONU プリセット
 */

import type { SimPreset, SimResult, SimEvent, SimSnapshot, PonFrame } from "./types.js";
import {
  getModulationParams, generateConstellation, generateSignal,
  applyChannel, applyNoiseToConstellation, generateAdslTones, calcAdslRate,
} from "./modem.js";
import {
  createOlt, createOnu, calcFiberLoss, calcRxPower,
  simulateRanging, simulateDba, GPON_PARAMS,
  createGrantFrame, createUpstreamFrame,
} from "./onu.js";

// ── ヘルパー ──

function makeResult(name: string, desc: string, snapshots: SimSnapshot[], events: SimEvent[]): SimResult {
  return { name, description: desc, snapshots, allEvents: events };
}

// ── プリセット ──

/** 1. ASK/FSK/PSK 基本変調 */
function presetBasicModulation(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];
  const bits = "10110010";
  let s = 0;

  for (const modType of ["ASK", "FSK", "PSK"] as const) {
    s++;
    const params = getModulationParams(modType);
    const constellation = generateConstellation(modType);
    const txSignal = generateSignal(bits, params, 200);
    const { received, quality } = applyChannel(txSignal, 20, 3);

    events.push({ step: s, type: "digital_input", severity: "info", from: "DTE", to: "モデム", label: `入力データ: ${bits}`, detail: `${bits.length}ビット`, data: { bits } });
    events.push({ step: s, type: "modulate", severity: "success", from: "モデム", to: "回線", label: `${modType} 変調`, detail: `搬送波: ${params.carrierFreqHz}Hz, ${params.baudRate}baud, ${params.bitRateBps}bps`, data: { carrier: `${params.carrierFreqHz}Hz`, baud: `${params.baudRate}`, bps: `${params.bitRateBps}` } });
    events.push({ step: s, type: "noise", severity: "warning", from: "回線", to: "回線", label: `伝送路 (SNR=${quality.snrDb}dB)`, detail: `減衰: ${quality.attenuationDb}dB, BER≈${quality.berEstimate.toExponential(2)}` });
    events.push({ step: s, type: "demodulate", severity: "success", from: "回線", to: "モデム", label: `${modType} 復調`, detail: `EVM: ${quality.evm}%` });

    snapshots.push({
      step: s, events: [...events.filter(e => e.step === s)],
      modulation: params, constellation, signalQuality: quality,
      txSignal, rxSignal: received,
    });
  }

  return makeResult("ASK/FSK/PSK 基本変調", "3つの基本変調方式を比較 — 振幅/周波数/位相の変化", snapshots, events);
}

/** 2. QPSK — 2ビット/シンボル */
function presetQpsk(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];
  const bits = "10110011001110";
  const params = getModulationParams("QPSK");
  const constellation = generateConstellation("QPSK");
  const noisyConst = applyNoiseToConstellation(constellation, 15);

  const txSignal = generateSignal(bits, params, 300);
  const { received, quality } = applyChannel(txSignal, 15, 5);

  events.push({ step: 1, type: "digital_input", severity: "info", from: "DTE", to: "モデム", label: `入力: ${bits}`, detail: `${bits.length}ビット → ${bits.length / 2}シンボル` });
  events.push({ step: 1, type: "modulate", severity: "success", from: "モデム", to: "回線", label: "QPSK 変調", detail: `2ビット/シンボル — 4つの位相点 (45°, 135°, 225°, 315°)`, data: { bitsPerSymbol: "2", phases: "4" } });
  events.push({ step: 1, type: "constellation", severity: "info", from: "モデム", to: "モデム", label: "コンスタレーション", detail: "I/Q平面上の4点 — ノイズにより受信点がずれる" });
  events.push({ step: 1, type: "transmit", severity: "info", from: "モデム", to: "回線", label: `伝送 (SNR=${quality.snrDb}dB)`, detail: `減衰: ${quality.attenuationDb}dB` });
  events.push({ step: 1, type: "demodulate", severity: "success", from: "回線", to: "モデム", label: "QPSK 復調", detail: `EVM: ${quality.evm}%, BER≈${quality.berEstimate.toExponential(2)}` });

  snapshots.push({
    step: 1, events: [...events],
    modulation: params, constellation: noisyConst, signalQuality: quality,
    txSignal, rxSignal: received,
  });

  return makeResult("QPSK 変調", "2ビット/シンボル — 位相変調、コンスタレーション", snapshots, events);
}

/** 3. QAM-16/64/256 比較 */
function presetQamComparison(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];
  const bits = "10110011001110001011001100111000";
  let s = 0;

  for (const modType of ["QAM16", "QAM64", "QAM256"] as const) {
    s++;
    const params = getModulationParams(modType);
    const constellation = generateConstellation(modType);
    const snr = modType === "QAM16" ? 20 : modType === "QAM64" ? 26 : 32;
    const noisyConst = applyNoiseToConstellation(
      constellation.slice(0, 16), // 表示用に16点に制限
      snr,
    );

    const usedBits = bits.slice(0, Math.floor(bits.length / params.bitsPerSymbol) * params.bitsPerSymbol);
    const txSignal = generateSignal(usedBits, params, 300);
    const { received, quality } = applyChannel(txSignal, snr, 5);

    events.push({ step: s, type: "modulate", severity: "success", from: "モデム", to: "回線", label: `${modType} 変調`, detail: `${params.bitsPerSymbol}ビット/シンボル, ${params.bitRateBps}bps, 要求SNR≈${snr}dB`, data: { bitsPerSymbol: `${params.bitsPerSymbol}`, points: `${constellation.length}`, snr: `${snr}dB` } });
    events.push({ step: s, type: "constellation", severity: "info", from: "モデム", to: "モデム", label: `コンスタレーション (${constellation.length}点)`, detail: `高次QAMほど密集 → ノイズ耐性が低下` });
    events.push({ step: s, type: "demodulate", severity: "success", from: "回線", to: "モデム", label: `${modType} 復調`, detail: `EVM: ${quality.evm}%, BER≈${quality.berEstimate.toExponential(2)}` });

    snapshots.push({
      step: s, events: events.filter(e => e.step === s),
      modulation: params, constellation: noisyConst, signalQuality: quality,
      txSignal, rxSignal: received,
    });
  }

  return makeResult("QAM-16/64/256 比較", "高次QAMの速度 vs ノイズ耐性トレードオフ", snapshots, events);
}

/** 4. SNRとビットエラー率 */
function presetSnrBer(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];
  const bits = "1011001100111000";
  const params = getModulationParams("QAM16");
  let s = 0;

  for (const snr of [5, 10, 15, 20, 30]) {
    s++;
    const constellation = generateConstellation("QAM16");
    const noisyConst = applyNoiseToConstellation(constellation, snr);
    const txSignal = generateSignal(bits, params, 200);
    const { received, quality } = applyChannel(txSignal, snr, 3);

    events.push({ step: s, type: "snr_measure", severity: snr < 10 ? "error" : snr < 17 ? "warning" : "success", from: "回線", to: "モデム", label: `SNR = ${snr} dB`, detail: `BER≈${quality.berEstimate.toExponential(2)}, EVM=${quality.evm}%`, data: { snr: `${snr}dB`, ber: quality.berEstimate.toExponential(2), evm: `${quality.evm}%` } });

    if (snr < 10) {
      events.push({ step: s, type: "error_detect", severity: "error", from: "モデム", to: "DTE", label: "通信品質低下!", detail: `SNR=${snr}dB — QAM-16の最低要件(17dB)を下回る → 低次変調にフォールバック` });
    }

    snapshots.push({
      step: s, events: events.filter(e => e.step === s),
      modulation: params, constellation: noisyConst, signalQuality: quality,
      txSignal, rxSignal: received,
    });
  }

  return makeResult("SNR と ビットエラー率", "SNRが下がるとコンスタレーションが拡散しBERが増加", snapshots, events);
}

/** 5. ADSL DMT (Discrete Multi-Tone) */
function presetAdslDmt(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];
  let s = 0;

  for (const dist of [1, 3, 5]) {
    s++;
    const lineSnr = 55; // dB (良好な回線)
    const bands = generateAdslTones(lineSnr, dist);
    const rate = calcAdslRate(bands);

    events.push({ step: s, type: "freq_split", severity: "info", from: "DSLAM", to: "モデム", label: `回線距離: ${dist}km`, detail: `音声(0-4kHz) | 上り(25-138kHz) | 下り(138-1104kHz)` });
    events.push({ step: s, type: "dmt_tone", severity: "success", from: "モデム", to: "モデム", label: "DMTトーン割当", detail: `256トーン × 4.3125kHz間隔 — 各トーンのSNRに応じてビット数を決定`, data: { tones: "256", spacing: "4.3125kHz" } });
    events.push({ step: s, type: "snr_measure", severity: "info", from: "回線", to: "モデム", label: `理論速度: 下り${rate.downMbps}Mbps / 上り${rate.upMbps}Mbps`, detail: `距離${dist}kmでの周波数依存減衰を反映` });

    if (dist >= 5) {
      events.push({ step: s, type: "attenuation", severity: "warning", from: "回線", to: "回線", label: "高周波の大幅減衰", detail: "距離5km: 高周波トーンのSNRが低下 → ビット割当が減少 → 速度低下" });
    }

    snapshots.push({ step: s, events: events.filter(e => e.step === s), adslBands: bands });
  }

  return makeResult("ADSL DMT マルチトーン", "256サブキャリアの周波数分割多重 — 距離による速度変化", snapshots, events);
}

/** 6. GPON 基本構成 */
function presetGponBasic(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];

  const olt = createOlt("GPON");
  const onus = [
    createOnu(1, 2, "GPON"),
    createOnu(2, 8, "GPON"),
    createOnu(3, 15, "GPON"),
  ];

  // ONU登録
  for (const onu of onus) {
    onu.state = "registered";
    olt.registeredOnus.push(onu);
  }

  events.push({ step: 1, type: "info", severity: "info", from: "OLT", to: "OLT", label: "GPON ネットワーク構成", detail: `下り: ${olt.downstreamGbps}Gbps (λ=${GPON_PARAMS.downstreamWavelengthNm}nm), 上り: ${olt.upstreamGbps}Gbps (λ=${GPON_PARAMS.upstreamWavelengthNm}nm)`, data: { splitRatio: `1:${olt.splitRatio}`, maxDistance: `${olt.maxDistanceKm}km`, onus: `${onus.length}` } });

  // 各ONUの物理パラメータ
  for (const onu of onus) {
    const fiber = calcFiberLoss(onu.distanceKm, olt.splitRatio);
    events.push({ step: 1, type: "physical", severity: "info", from: "OLT", to: `ONU-${onu.id}`, label: `ONU-${onu.id}: ${onu.distanceKm}km`, detail: `ファイバー損失: ${fiber.totalLossDb}dB (ファイバー: ${(fiber.attenuationDbPerKm * onu.distanceKm).toFixed(1)}dB + スプリッター: ${fiber.splitterLossDb}dB + コネクタ: ${fiber.connectorLossDb}dB)`, data: { rxPower: `${onu.rxPowerDbm}dBm`, rtt: `${onu.rttUs}μs` } });
  }

  // 下りブロードキャスト
  events.push({ step: 1, type: "optical_tx", severity: "success", from: "OLT", to: "スプリッター", label: "下りデータ送信 (ブロードキャスト)", detail: `λ=${GPON_PARAMS.downstreamWavelengthNm}nm — 全ONUに同一信号を送信、GEMポートIDで宛先識別` });
  events.push({ step: 1, type: "splitter", severity: "info", from: "スプリッター", to: "ONU群", label: `1:${olt.splitRatio} スプリッター`, detail: `光信号を${olt.splitRatio}分岐 — 損失: ${calcFiberLoss(0, olt.splitRatio).splitterLossDb}dB` });

  // 上りTDMA
  events.push({ step: 1, type: "info", severity: "info", from: "ONU群", to: "OLT", label: "上りTDMA (時分割多重)", detail: "各ONUが割り当てられたタイムスロットで送信 — 衝突回避" });

  snapshots.push({ step: 1, events: [...events], olt: { ...olt, registeredOnus: onus.map(o => ({ ...o })) }, fiber: calcFiberLoss(10, olt.splitRatio) });

  return makeResult("GPON 基本構成", "OLT-スプリッター-ONU の光ネットワーク構成", snapshots, events);
}

/** 7. ONU レンジング */
function presetRanging(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];

  const olt = createOlt("GPON");
  const onus = [createOnu(1, 3, "GPON"), createOnu(2, 12, "GPON")];

  let s = 0;
  for (const onu of onus) {
    s++;
    onu.state = "ranging";
    events.push({ step: s, type: "onu_register", severity: "info", from: `ONU-${onu.id}`, to: "OLT", label: `ONU-${onu.id} レンジング開始`, detail: `距離: ${onu.distanceKm}km, Serial: ${onu.serial}` });

    simulateRanging(olt, onu, events, s);

    onu.state = "registered";
    olt.registeredOnus.push(onu);
    events.push({ step: s, type: "onu_register", severity: "success", from: "OLT", to: `ONU-${onu.id}`, label: `ONU-${onu.id} 登録完了`, detail: `ONU-ID割当, 等化遅延設定完了` });

    snapshots.push({ step: s, events: events.filter(e => e.step === s), olt: { ...olt, registeredOnus: olt.registeredOnus.map(o => ({ ...o })) }, fiber: calcFiberLoss(onu.distanceKm, olt.splitRatio) });
  }

  return makeResult("ONU レンジング", "OLT-ONU間の距離測定と等化遅延の設定", snapshots, events);
}

/** 8. DBA 動的帯域割当 */
function presetDba(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];

  const olt = createOlt("GPON");
  const onus = [createOnu(1, 5, "GPON"), createOnu(2, 10, "GPON"), createOnu(3, 3, "GPON")];
  for (const onu of onus) { onu.state = "active"; olt.registeredOnus.push(onu); }

  // ラウンド1: 均等要求
  const req1 = new Map<number, number>([[1, 300], [2, 300], [3, 300]]);
  events.push({ step: 1, type: "info", severity: "info", from: "OLT", to: "OLT", label: "ラウンド1: 均等要求", detail: "各ONU 300Mbps要求 (合計900Mbps < 上り1244Mbps)" });
  simulateDba(olt, onus, req1, events, 1);
  const frames1: PonFrame[] = onus.map(o => createGrantFrame(olt.id, o.id, 0, 100));
  snapshots.push({ step: 1, events: events.filter(e => e.step === 1), olt: { ...olt, registeredOnus: onus.map(o => ({ ...o })) }, ponFrames: frames1 });

  // ラウンド2: 過負荷
  const req2 = new Map<number, number>([[1, 800], [2, 600], [3, 200]]);
  events.push({ step: 2, type: "info", severity: "warning", from: "OLT", to: "OLT", label: "ラウンド2: 過負荷要求", detail: "合計1600Mbps > 上り1244Mbps — 比例配分" });
  simulateDba(olt, onus, req2, events, 2);
  const frames2: PonFrame[] = [
    ...onus.map(o => createGrantFrame(olt.id, o.id, 0, 50)),
    ...onus.map(o => createUpstreamFrame(o.id, olt.id, o.allocatedBwMbps * 125)),
  ];
  snapshots.push({ step: 2, events: events.filter(e => e.step === 2), olt: { ...olt, registeredOnus: onus.map(o => ({ ...o })) }, ponFrames: frames2 });

  return makeResult("DBA 動的帯域割当", "OLTがONUの要求に応じて上り帯域を配分", snapshots, events);
}

/** 9. 光ファイバーの物理特性 */
function presetFiberPhysics(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];
  let s = 0;

  for (const dist of [1, 5, 10, 20]) {
    s++;
    const fiber = calcFiberLoss(dist, 32);
    const oltTxPower = 5; // dBm
    const rxPower = calcRxPower(oltTxPower, fiber);
    const sensitivity = -28; // dBm (GPON ONU感度)
    const margin = rxPower - sensitivity;

    events.push({ step: s, type: "optical_tx", severity: "info", from: "OLT", to: "ファイバー", label: `OLT送信: ${oltTxPower}dBm`, detail: `λ=1490nm` });
    events.push({ step: s, type: "attenuation", severity: "info", from: "ファイバー", to: "ファイバー", label: `ファイバー損失: ${(fiber.attenuationDbPerKm * dist).toFixed(1)}dB`, detail: `${dist}km × ${fiber.attenuationDbPerKm}dB/km` });
    events.push({ step: s, type: "splitter", severity: "info", from: "スプリッター", to: "ONU", label: `スプリッター損失: ${fiber.splitterLossDb}dB`, detail: `1:32分岐` });
    events.push({ step: s, type: "optical_rx", severity: margin > 3 ? "success" : margin > 0 ? "warning" : "error", from: "ファイバー", to: "ONU", label: `ONU受信: ${rxPower}dBm`, detail: `総損失: ${fiber.totalLossDb}dB, マージン: ${margin.toFixed(1)}dB (感度: ${sensitivity}dBm)`, data: { totalLoss: `${fiber.totalLossDb}dB`, margin: `${margin.toFixed(1)}dB`, ok: margin > 0 ? "OK" : "NG" } });

    if (margin <= 0) {
      events.push({ step: s, type: "error_detect", severity: "error", from: "ONU", to: "ONU", label: "受信不能!", detail: `受信パワーが感度を下回る — リンクダウン` });
    }

    snapshots.push({ step: s, events: events.filter(e => e.step === s), fiber });
  }

  return makeResult("光ファイバーの物理特性", "距離・スプリット比による光損失とリンクバジェット", snapshots, events);
}

/** 10. 波長分割多重 (WDM) */
function presetWdm(): SimResult {
  const events: SimEvent[] = [];
  const snapshots: SimSnapshot[] = [];

  events.push({ step: 1, type: "wavelength", severity: "info", from: "OLT", to: "ONU群", label: "WDM 波長割当", detail: "1本のファイバーに複数の波長を多重化 — 上り/下りで異なる波長を使用" });
  events.push({ step: 1, type: "optical_tx", severity: "success", from: "OLT", to: "ファイバー", label: "下り: λ=1490nm", detail: "GPON下りデータ — 全ONUにブロードキャスト" });
  events.push({ step: 1, type: "optical_tx", severity: "success", from: "ONU群", to: "ファイバー", label: "上り: λ=1310nm", detail: "GPON上りデータ — TDMA多重" });
  events.push({ step: 1, type: "wavelength", severity: "info", from: "OLT", to: "ファイバー", label: "映像: λ=1550nm", detail: "RF映像オーバーレイ (オプション)" });

  events.push({ step: 1, type: "info", severity: "info", from: "OLT", to: "OLT", label: "波長一覧", detail: "1310nm(上り) / 1490nm(下り) / 1550nm(映像) — 光フィルタで分離", data: { upstream: "1310nm", downstream: "1490nm", video: "1550nm", technology: "WDM-PON" } });

  // XG-PON拡張
  events.push({ step: 1, type: "wavelength", severity: "info", from: "OLT", to: "ONU群", label: "XG-PON (10Gbps)", detail: "下り: 1577nm (10Gbps), 上り: 1270nm (2.5Gbps) — GPONと共存可能", data: { xgDownstream: "1577nm / 10Gbps", xgUpstream: "1270nm / 2.5Gbps" } });

  const olt = createOlt("GPON");
  snapshots.push({ step: 1, events: [...events], olt });

  return makeResult("波長分割多重 (WDM)", "1本のファイバーに複数波長を多重化 — GPON/XG-PON共存", snapshots, events);
}

// ── 公開API ──

export const PRESETS: SimPreset[] = [
  { name: "ASK/FSK/PSK 基本変調", description: "3つの基本変調方式 — 振幅/周波数/位相の変化", run: presetBasicModulation },
  { name: "QPSK 変調", description: "2ビット/シンボル — I/Qコンスタレーション", run: presetQpsk },
  { name: "QAM-16/64/256 比較", description: "高次QAMの速度 vs ノイズ耐性トレードオフ", run: presetQamComparison },
  { name: "SNR と ビットエラー率", description: "SNR低下によるコンスタレーション拡散とBER増加", run: presetSnrBer },
  { name: "ADSL DMT マルチトーン", description: "256サブキャリアの周波数分割多重 — 距離による速度変化", run: presetAdslDmt },
  { name: "GPON 基本構成", description: "OLT-スプリッター-ONU の光ネットワーク", run: presetGponBasic },
  { name: "ONU レンジング", description: "OLT-ONU間の距離測定と等化遅延", run: presetRanging },
  { name: "DBA 動的帯域割当", description: "ONUの要求に応じた上り帯域の動的配分", run: presetDba },
  { name: "光ファイバーの物理特性", description: "距離・スプリット比による光損失とリンクバジェット", run: presetFiberPhysics },
  { name: "波長分割多重 (WDM)", description: "上り/下り/映像の波長多重とXG-PON共存", run: presetWdm },
];
