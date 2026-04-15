/**
 * onu.ts — ONU / PON シミュレーション
 *
 * GPON/EPON における光信号の伝送、OLT-ONU間の通信、
 * レンジング、動的帯域割当 (DBA)、光スプリッターの物理特性をシミュレートする。
 */

import type {
  PonType, OnuInfo, OltInfo, FiberParams, PonFrame,
  SimEvent,
} from "./types.js";

// ── 定数 ──

/** 光の伝搬速度 (ファイバー内、約2/3光速) */
const FIBER_SPEED_KM_PER_US = 0.2; // km/μs

/** GPON デフォルトパラメータ */
export const GPON_PARAMS = {
  downstreamGbps: 2.488,
  upstreamGbps: 1.244,
  maxOnus: 128,
  maxDistanceKm: 20,
  downstreamWavelengthNm: 1490,
  upstreamWavelengthNm: 1310,
  splitRatio: 32,
  frameTimeUs: 125, // 125μsフレーム
};

/** EPON デフォルトパラメータ */
export const EPON_PARAMS = {
  downstreamGbps: 1.25,
  upstreamGbps: 1.25,
  maxOnus: 32,
  maxDistanceKm: 20,
  downstreamWavelengthNm: 1490,
  upstreamWavelengthNm: 1310,
  splitRatio: 32,
  frameTimeUs: 2000, // 2msフレーム
};

// ── 光ファイバーの物理計算 ──

/** 光ファイバーの損失を計算 */
export function calcFiberLoss(
  lengthKm: number, splitRatio: number, numConnectors: number = 2,
): FiberParams {
  const attenPerKm = 0.35; // dB/km (1310nm)
  const fiberLoss = lengthKm * attenPerKm;
  const splitterLoss = 10 * Math.log10(splitRatio); // 1:32 = 15.05dB
  const connectorLoss = numConnectors * 0.5;
  return {
    lengthKm, attenuationDbPerKm: attenPerKm,
    splitterLossDb: Math.round(splitterLoss * 100) / 100,
    connectorLossDb: connectorLoss,
    totalLossDb: Math.round((fiberLoss + splitterLoss + connectorLoss) * 100) / 100,
  };
}

/** ONU の受信パワーを計算 */
export function calcRxPower(txPowerDbm: number, fiberParams: FiberParams): number {
  return Math.round((txPowerDbm - fiberParams.totalLossDb) * 100) / 100;
}

/** 距離からRTTを計算 */
export function calcRtt(distanceKm: number): number {
  return Math.round((2 * distanceKm / FIBER_SPEED_KM_PER_US) * 100) / 100;
}

// ── OLT/ONU 生成 ──

/** OLT を初期化 */
export function createOlt(ponType: PonType): OltInfo {
  const params = ponType === "GPON" ? GPON_PARAMS : EPON_PARAMS;
  return {
    id: "OLT-1",
    ponType,
    maxOnus: params.maxOnus,
    registeredOnus: [],
    downstreamGbps: params.downstreamGbps,
    upstreamGbps: params.upstreamGbps,
    splitRatio: params.splitRatio,
    maxDistanceKm: params.maxDistanceKm,
  };
}

/** ONU を作成 */
export function createOnu(id: number, distanceKm: number, ponType: PonType): OnuInfo {
  const params = ponType === "GPON" ? GPON_PARAMS : EPON_PARAMS;
  const fiber = calcFiberLoss(distanceKm, params.splitRatio);
  const txPower = 3; // dBm (典型的ONU送信パワー)
  const rxPower = calcRxPower(txPower, fiber);

  return {
    id, serial: `HWTC${String(id).padStart(8, "0")}`,
    state: "inactive", distanceKm,
    rttUs: calcRtt(distanceKm),
    rxPowerDbm: rxPower, txPowerDbm: txPower,
    allocatedBwMbps: 0,
    upstreamWavelength: params.upstreamWavelengthNm,
    downstreamWavelength: params.downstreamWavelengthNm,
  };
}

// ── PON フレーム生成 ──

/** 下り PLOAM (Physical Layer OAM) メッセージ */
export function createPloamFrame(oltId: string, msgType: string, destOnuId: number): PonFrame {
  return {
    direction: "downstream", frameType: "ploam",
    wavelengthNm: GPON_PARAMS.downstreamWavelengthNm,
    sourceId: oltId, destId: `ONU-${destOnuId}`,
    payloadBits: 13 * 8, // 13バイトPLOAM
    description: `PLOAM: ${msgType} → ONU-${destOnuId}`,
  };
}

/** BWmap (帯域マップ / グラント) */
export function createGrantFrame(oltId: string, onuId: number, startSlot: number, endSlot: number): PonFrame {
  return {
    direction: "downstream", frameType: "grant",
    wavelengthNm: GPON_PARAMS.downstreamWavelengthNm,
    sourceId: oltId, destId: `ONU-${onuId}`,
    payloadBits: 8 * 8,
    description: `BWmap Grant: ONU-${onuId} slots ${startSlot}-${endSlot}`,
  };
}

/** 上りデータフレーム */
export function createUpstreamFrame(onuId: number, oltId: string, sizeBits: number): PonFrame {
  return {
    direction: "upstream", frameType: "data",
    wavelengthNm: GPON_PARAMS.upstreamWavelengthNm,
    sourceId: `ONU-${onuId}`, destId: oltId,
    payloadBits: sizeBits,
    description: `上りデータ: ONU-${onuId} → OLT (${sizeBits} bits)`,
  };
}

// ── レンジングプロセス ──

/** ONU レンジング (距離測定) シミュレーション */
export function simulateRanging(
  olt: OltInfo, onu: OnuInfo, events: SimEvent[], step: number,
): { equalizedDelay: number } {
  const baseStep = step;

  // 1. OLTがレンジングウィンドウを開く
  events.push({
    step: baseStep, type: "ranging", severity: "info",
    from: olt.id, to: `ONU-${onu.id}`,
    label: "レンジングウィンドウ開放",
    detail: `OLTが静寂期間 (quiet window) を設定 — 他ONUの送信を停止`,
  });

  // 2. OLTがレンジングリクエスト送信
  events.push({
    step: baseStep, type: "pon_frame", severity: "info",
    from: olt.id, to: `ONU-${onu.id}`,
    label: "Ranging Request 送信",
    detail: `PLOAM: Serial_Number_Request (λ=${GPON_PARAMS.downstreamWavelengthNm}nm)`,
    data: { wavelength: `${GPON_PARAMS.downstreamWavelengthNm}nm`, direction: "downstream" },
  });

  // 3. ONUが応答 (SN_Response)
  const propagationUs = onu.distanceKm / FIBER_SPEED_KM_PER_US;
  events.push({
    step: baseStep, type: "pon_frame", severity: "info",
    from: `ONU-${onu.id}`, to: olt.id,
    label: "Serial Number Response",
    detail: `ONU-${onu.id} (${onu.serial}) が応答 — 片道遅延: ${propagationUs.toFixed(1)}μs`,
    data: { serial: onu.serial, distance: `${onu.distanceKm}km`, propagation: `${propagationUs.toFixed(1)}μs` },
  });

  // 4. RTT測定と等化遅延計算
  const rtt = onu.rttUs;
  const maxRtt = olt.maxDistanceKm * 2 / FIBER_SPEED_KM_PER_US;
  const equalizedDelay = Math.round((maxRtt - rtt) * 100) / 100;

  events.push({
    step: baseStep, type: "ranging", severity: "success",
    from: olt.id, to: `ONU-${onu.id}`,
    label: `RTT測定完了: ${rtt}μs`,
    detail: `等化遅延 (EqD) = ${equalizedDelay}μs — 全ONUのタイムスロットを整列`,
    data: { rtt: `${rtt}μs`, eqd: `${equalizedDelay}μs`, maxRtt: `${maxRtt}μs` },
  });

  return { equalizedDelay };
}

// ── DBA (動的帯域割当) ──

/** 簡易DBA: ONUの要求に応じて帯域を割り当て */
export function simulateDba(
  olt: OltInfo, onus: OnuInfo[],
  requestsMbps: Map<number, number>,
  events: SimEvent[], step: number,
): void {
  const totalUpBw = olt.upstreamGbps * 1000; // Mbps
  let totalRequested = 0;
  for (const [, bw] of requestsMbps) totalRequested += bw;

  events.push({
    step, type: "dba", severity: "info",
    from: olt.id, to: olt.id,
    label: "DBA 計算開始",
    detail: `上り総帯域: ${totalUpBw}Mbps, 総要求: ${totalRequested}Mbps`,
    data: { totalBw: `${totalUpBw}Mbps`, totalRequest: `${totalRequested}Mbps`, onus: `${onus.length}` },
  });

  // 比例配分
  for (const onu of onus) {
    const requested = requestsMbps.get(onu.id) ?? 0;
    let allocated: number;
    if (totalRequested <= totalUpBw) {
      allocated = requested;
    } else {
      allocated = Math.round((requested / totalRequested) * totalUpBw * 100) / 100;
    }
    onu.allocatedBwMbps = allocated;

    events.push({
      step, type: "olt_grant", severity: "success",
      from: olt.id, to: `ONU-${onu.id}`,
      label: `帯域割当: ${allocated}Mbps`,
      detail: `要求: ${requested}Mbps → 割当: ${allocated}Mbps`,
      data: { requested: `${requested}Mbps`, allocated: `${allocated}Mbps` },
    });
  }
}
