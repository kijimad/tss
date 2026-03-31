import { describe, it, expect } from "vitest";
import {
  runningResistance,
  gradientResistance,
  curveResistance,
  signalSpeedLimit,
  simulate,
} from "../sim/physics.js";
import type { TrainSpec, TrackSection, OperationSchedule } from "../sim/physics.js";

const testSpec: TrainSpec = {
  name: "Test", mass: 300, cars: 10, maxTraction: 200, maxBrake: 150,
  emergencyBrake: 250, maxSpeed: 120, resistA: 1500, resistB: 30, resistC: 0.5,
  driveType: "VVVF", motor: "Test Motor",
};

describe("runningResistance", () => {
  it("速度 0 で最小抵抗 (転がり抵抗のみ)", () => {
    const r = runningResistance(testSpec, 0);
    expect(r).toBeCloseTo(1.5, 1); // 1500N = 1.5kN
  });

  it("速度が上がると抵抗が増大する", () => {
    const r0 = runningResistance(testSpec, 0);
    const r100 = runningResistance(testSpec, 100);
    expect(r100).toBeGreaterThan(r0);
  });
});

describe("gradientResistance", () => {
  it("平坦 (0‰) で 0", () => {
    expect(gradientResistance(300, 0)).toBe(0);
  });

  it("上り勾配で正の抵抗", () => {
    const r = gradientResistance(300, 10);
    expect(r).toBeGreaterThan(0);
  });

  it("下り勾配で負の値 (加速方向)", () => {
    const r = gradientResistance(300, -10);
    expect(r).toBeLessThan(0);
  });
});

describe("curveResistance", () => {
  it("直線 (R=0) で 0", () => {
    expect(curveResistance(300, 0)).toBe(0);
  });

  it("曲線で正の抵抗", () => {
    const r = curveResistance(300, 300);
    expect(r).toBeGreaterThan(0);
  });

  it("半径が小さいほど抵抗が大きい", () => {
    const r200 = curveResistance(300, 200);
    const r600 = curveResistance(300, 600);
    expect(r200).toBeGreaterThan(r600);
  });
});

describe("signalSpeedLimit", () => {
  it("G → 制限なし (999)", () => {
    expect(signalSpeedLimit("G")).toBe(999);
  });
  it("R → 停止 (0)", () => {
    expect(signalSpeedLimit("R")).toBe(0);
  });
  it("Y → 45km/h", () => {
    expect(signalSpeedLimit("Y")).toBe(45);
  });
});

describe("simulate", () => {
  const flatTrack: TrackSection[] = [
    { startKm: 0, endKm: 5000, gradient: 0, curveRadius: 0, speedLimit: 0, label: "flat" },
  ];

  it("力行で加速する", () => {
    const schedule: OperationSchedule = {
      entries: [{ distanceM: 0, notch: { type: "power", level: 1 } }],
    };
    const result = simulate(testSpec, flatTrack, [], [], schedule, 30);
    expect(result.snapshots.length).toBeGreaterThan(0);
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.speed).toBeGreaterThan(0);
  });

  it("制動で減速する", () => {
    const schedule: OperationSchedule = {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1 } },
        { distanceM: 500, notch: { type: "brake", level: 1 } },
      ],
    };
    const result = simulate(testSpec, flatTrack, [], [], schedule, 60);
    // 最高速度 > 最終速度
    expect(result.maxSpeed).toBeGreaterThan(result.snapshots[result.snapshots.length - 1]!.speed);
  });

  it("上り勾配で速度が低下する", () => {
    const uphill: TrackSection[] = [
      { startKm: 0, endKm: 5000, gradient: 25, curveRadius: 0, speedLimit: 0, label: "uphill" },
    ];
    const flat = simulate(testSpec, flatTrack, [], [], { entries: [{ distanceM: 0, notch: { type: "power", level: 1 } }] }, 30);
    const hill = simulate(testSpec, uphill, [], [], { entries: [{ distanceM: 0, notch: { type: "power", level: 1 } }] }, 30);
    expect(hill.maxSpeed).toBeLessThan(flat.maxSpeed);
  });

  it("惰行で徐々に減速する", () => {
    const schedule: OperationSchedule = {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1 } },
        { distanceM: 300, notch: { type: "coast" } },
      ],
    };
    const result = simulate(testSpec, flatTrack, [], [], schedule, 60);
    const midIdx = Math.floor(result.snapshots.length / 2);
    const endIdx = result.snapshots.length - 1;
    // 惰行後は減速する
    expect(result.snapshots[endIdx]!.speed).toBeLessThanOrEqual(result.snapshots[midIdx]!.speed + 1);
  });

  it("スナップショットに各種力が記録される", () => {
    const schedule: OperationSchedule = {
      entries: [{ distanceM: 0, notch: { type: "power", level: 1 } }],
    };
    const result = simulate(testSpec, flatTrack, [], [], schedule, 10);
    const s = result.snapshots[result.snapshots.length - 1]!;
    expect(s.tractionForce).toBeGreaterThan(0);
    expect(s.resistance).toBeGreaterThanOrEqual(0);
    expect(typeof s.speed).toBe("number");
    expect(typeof s.distance).toBe("number");
  });
});
