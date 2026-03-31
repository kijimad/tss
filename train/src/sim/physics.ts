/**
 * physics.ts — 鉄道車両の運動物理シミュレーション
 *
 * 列車の力行・惰行・制動をニュートン力学でシミュレートする。
 *   F = ma  (牽引力 − 走行抵抗 − ブレーキ力 − 勾配抵抗 − 曲線抵抗)
 *
 * 走行抵抗の経験式（Davis 式簡易版）:
 *   R = a + b*v + c*v²   [N]
 */

// ── 型定義 ──

/** 車両スペック */
export interface TrainSpec {
  name: string;
  /** 編成質量 (t) */
  mass: number;
  /** 編成両数 */
  cars: number;
  /** 最大牽引力 (kN) */
  maxTraction: number;
  /** 最大ブレーキ力 (kN) — 常用最大 */
  maxBrake: number;
  /** 非常ブレーキ力 (kN) */
  emergencyBrake: number;
  /** 設計最高速度 (km/h) */
  maxSpeed: number;
  /** 走行抵抗係数 a (N) — 転がり抵抗 */
  resistA: number;
  /** 走行抵抗係数 b (N/(km/h)) — 軸受抵抗 */
  resistB: number;
  /** 走行抵抗係数 c (N/(km/h)²) — 空気抵抗 */
  resistC: number;
  /** 駆動方式 */
  driveType: string;
  /** 主電動機 */
  motor: string;
}

/** 路線の区間定義 */
export interface TrackSection {
  /** 区間開始距離 (m) */
  startKm: number;
  /** 区間終了距離 (m) */
  endKm: number;
  /** 勾配 (‰ パーミル) — 正が上り */
  gradient: number;
  /** 曲線半径 (m, 0 で直線) */
  curveRadius: number;
  /** 制限速度 (km/h, 0 で制限なし) */
  speedLimit: number;
  /** ラベル */
  label: string;
}

/** 駅定義 */
export interface Station {
  name: string;
  /** 距離 (m) */
  distanceM: number;
  /** 停車時間 (秒) */
  dwellTime: number;
}

/** 信号現示 */
export type SignalAspect = "G" | "YG" | "Y" | "YY" | "R";

/** 信号機 */
export interface Signal {
  distanceM: number;
  aspect: SignalAspect;
  /** 現示に対応する制限速度 (km/h) */
  speedLimit: number;
}

/** 運転操作 */
export type NotchPosition =
  | { type: "power"; level: number }   // 0〜1 (力行)
  | { type: "coast" }                  // 惰行
  | { type: "brake"; level: number }   // 0〜1 (常用制動)
  | { type: "emergency" };             // 非常制動

/** シミュレーションのスナップショット（1 tick） */
export interface TrainState {
  time: number;         // 秒
  distance: number;     // m
  speed: number;        // km/h
  acceleration: number; // m/s²
  notch: NotchPosition;
  tractionForce: number;  // kN
  brakeForce: number;     // kN
  resistance: number;     // kN (走行抵抗)
  gradientForce: number;  // kN (勾配抵抗)
  gradient: number;       // ‰
  power: number;          // kW (消費電力)
  nextSignal: Signal | null;
  currentSection: string;
  atStation: string | null;
}

/** シミュレーション結果 */
export interface SimResult {
  snapshots: TrainState[];
  totalTime: number;
  maxSpeed: number;
  totalDistance: number;
  energyKwh: number;
}

// ── 物理定数 ──

const G = 9.80665; // 重力加速度 (m/s²)
const DT = 0.5;    // シミュレーション刻み (秒)

// ── エンジン ──

/** 信号現示 → 制限速度 */
export function signalSpeedLimit(aspect: SignalAspect): number {
  switch (aspect) {
    case "G":  return 999; // 進行 (制限なし)
    case "YG": return 75;  // 減速
    case "Y":  return 45;  // 注意
    case "YY": return 25;  // 警戒
    case "R":  return 0;   // 停止
  }
}

/** 走行抵抗を計算する (kN) */
export function runningResistance(spec: TrainSpec, speedKmh: number): number {
  const v = Math.abs(speedKmh);
  return (spec.resistA + spec.resistB * v + spec.resistC * v * v) / 1000; // N → kN
}

/** 勾配抵抗を計算する (kN) */
export function gradientResistance(massT: number, gradientPermil: number): number {
  // F = m * g * sin(θ) ≈ m * g * (gradient / 1000)
  return massT * G * (gradientPermil / 1000);
}

/** 曲線抵抗を計算する (kN) */
export function curveResistance(massT: number, radiusM: number): number {
  if (radiusM <= 0) return 0;
  // 曲線抵抗 (N) ≈ 800 / R * m * g （経験式）
  return (800 / radiusM) * massT * G / 1000;
}

/** 現在区間を取得 */
function currentSection(distance: number, sections: TrackSection[]): TrackSection | undefined {
  return sections.find((s) => distance >= s.startKm && distance < s.endKm);
}

/** 次の信号を取得 */
function nextSignal(distance: number, signals: Signal[]): Signal | null {
  return signals.find((s) => s.distanceM > distance) ?? null;
}

/** 停車中の駅を取得 */
function atStation(distance: number, stations: Station[]): Station | null {
  return stations.find((s) => Math.abs(distance - s.distanceM) < 20) ?? null;
}

/** ATC/ATS 自動制限速度を算出 */
function effectiveSpeedLimit(
  distance: number,
  speed: number,
  sections: TrackSection[],
  signals: Signal[],
): number {
  let limit = 999;
  const section = currentSection(distance, sections);
  if (section !== undefined && section.speedLimit > 0) {
    limit = Math.min(limit, section.speedLimit);
  }
  const sig = nextSignal(distance, signals);
  if (sig !== null) {
    const sigLimit = signalSpeedLimit(sig.aspect);
    // 信号までの距離に基づく制動パターン
    const distToSignal = sig.distanceM - distance;
    if (distToSignal < 600) {
      limit = Math.min(limit, sigLimit);
    } else if (distToSignal < 1200 && sigLimit < speed) {
      limit = Math.min(limit, sigLimit + 30);
    }
  }
  return limit;
}

/** 運転操作スケジュール */
export interface OperationSchedule {
  /** 距離 (m) に対する操作 */
  entries: { distanceM: number; notch: NotchPosition }[];
}

/** シミュレーションを実行する */
export function simulate(
  spec: TrainSpec,
  sections: TrackSection[],
  stations: Station[],
  signals: Signal[],
  schedule: OperationSchedule,
  maxTime: number,
): SimResult {
  const snapshots: TrainState[] = [];
  let time = 0;
  let distance = 0;     // m
  let speedMs = 0;       // m/s
  let totalEnergy = 0;   // kWs
  let maxSpeedKmh = 0;
  let dwellRemaining = 0;
  let schedIdx = 0;
  let currentNotch: NotchPosition = { type: "coast" };

  while (time < maxTime && distance < (sections[sections.length - 1]?.endKm ?? 10000)) {
    const speedKmh = speedMs * 3.6;
    if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh;

    // 停車中の処理
    const sta = atStation(distance, stations);
    if (sta !== null && speedKmh < 1 && dwellRemaining > 0) {
      dwellRemaining -= DT;
      snapshots.push({
        time, distance, speed: 0, acceleration: 0,
        notch: { type: "brake", level: 1 },
        tractionForce: 0, brakeForce: 0, resistance: 0,
        gradientForce: 0, gradient: 0, power: 0,
        nextSignal: nextSignal(distance, signals),
        currentSection: sta.name + " (停車中)",
        atStation: sta.name,
      });
      time += DT;
      continue;
    }

    // 運転操作スケジュールを適用
    while (schedIdx < schedule.entries.length) {
      const entry = schedule.entries[schedIdx]!;
      if (distance >= entry.distanceM) {
        currentNotch = entry.notch;
        schedIdx++;
      } else {
        break;
      }
    }

    // ATC/ATS による自動制限
    const limit = effectiveSpeedLimit(distance, speedKmh, sections, signals);
    let notch = currentNotch;
    if (speedKmh > limit + 5) {
      notch = { type: "brake", level: Math.min(1, (speedKmh - limit) / 20) };
    } else if (speedKmh > spec.maxSpeed) {
      notch = { type: "coast" };
    }

    // 力の計算
    const section = currentSection(distance, sections);
    const grad = section?.gradient ?? 0;
    const radius = section?.curveRadius ?? 0;

    let traction = 0;
    let brake = 0;

    switch (notch.type) {
      case "power":
        traction = spec.maxTraction * notch.level;
        // 高速域で牽引力が低下（定出力特性の簡易モデル）
        if (speedKmh > 40) {
          traction *= Math.min(1, 40 / speedKmh);
        }
        break;
      case "brake":
        brake = spec.maxBrake * notch.level;
        break;
      case "emergency":
        brake = spec.emergencyBrake;
        break;
    }

    const resist = runningResistance(spec, speedKmh);
    const gradF = gradientResistance(spec.mass, grad);
    const curveF = curveResistance(spec.mass, radius);

    // F = ma → a = F / m
    const netForce = traction - brake - resist - gradF - curveF;
    const accel = (netForce * 1000) / (spec.mass * 1000); // kN → N, t → kg

    // 速度・距離の更新
    speedMs += accel * DT;
    if (speedMs < 0) speedMs = 0;
    distance += speedMs * DT;

    // 消費電力 (簡易)
    const powerKw = traction > 0 ? (traction * speedMs) : 0;
    totalEnergy += powerKw * DT;

    // 駅到着チェック
    const arrivedSta = atStation(distance, stations);
    if (arrivedSta !== null && speedKmh < 5 && dwellRemaining <= 0) {
      dwellRemaining = arrivedSta.dwellTime;
    }

    snapshots.push({
      time, distance,
      speed: speedKmh,
      acceleration: accel,
      notch,
      tractionForce: traction,
      brakeForce: brake,
      resistance: resist + curveF,
      gradientForce: gradF,
      gradient: grad,
      power: powerKw,
      nextSignal: nextSignal(distance, signals),
      currentSection: section?.label ?? "",
      atStation: arrivedSta?.name ?? null,
    });

    time += DT;
  }

  return {
    snapshots,
    totalTime: time,
    maxSpeed: maxSpeedKmh,
    totalDistance: distance,
    energyKwh: totalEnergy / 3600,
  };
}
