import { describe, it, expect } from "vitest";
import {
  createTokyoChannels,
  simulateReception,
  uhfFrequency,
  describeSegmentLayout,
} from "../broadcast/isdb.js";

describe("uhfFrequency", () => {
  it("ch13 → 473 MHz", () => {
    expect(uhfFrequency(13)).toBe(476);
  });
  it("ch27 (NHK総合) → 557 MHz 付近", () => {
    expect(uhfFrequency(27)).toBeGreaterThan(550);
    expect(uhfFrequency(27)).toBeLessThanOrEqual(560);
  });
});

describe("createTokyoChannels", () => {
  const channels = createTokyoChannels();

  it("7 局が定義されている", () => {
    expect(channels).toHaveLength(7);
  });

  it("各チャンネルに 13 セグメント構成がある (1 + 12)", () => {
    for (const ch of channels) {
      const totalSeg = ch.layers.reduce((s, l) => s + l.segments, 0);
      expect(totalSeg).toBe(13);
    }
  });

  it("全チャンネルが 8K FFT を使用", () => {
    for (const ch of channels) {
      expect(ch.fftMode).toBe("8K");
    }
  });

  it("NHK総合はリモコン 1", () => {
    const nhk = channels.find((c) => c.name === "NHK総合");
    expect(nhk).toBeDefined();
    expect(nhk!.remoteId).toBe(1);
  });

  it("各チャンネルに番組情報がある", () => {
    for (const ch of channels) {
      expect(ch.programs.length).toBeGreaterThan(0);
    }
  });
});

describe("simulateReception", () => {
  const channels = createTokyoChannels();
  const nhk = channels.find((c) => c.physCh === 27)!;

  it("ノイズ 0 で正常に受信できる", () => {
    const result = simulateReception(nhk, 0);
    expect(result.locked).toBe(true);
    expect(result.segments).toHaveLength(13);
    expect(result.tsPackets.length).toBeGreaterThan(0);
  });

  it("全トレースステップが生成される", () => {
    const result = simulateReception(nhk, 0);
    const phases = result.steps.map((s) => s.phase);
    expect(phases).toContain("tune");
    expect(phases).toContain("agc");
    expect(phases).toContain("fft");
    expect(phases).toContain("demod");
    expect(phases).toContain("fec");
    expect(phases).toContain("ts_sync");
    expect(phases).toContain("demux");
    expect(phases).toContain("decode");
    expect(phases).toContain("output");
  });

  it("TS パケットに PAT, PMT, Video, Audio が含まれる", () => {
    const result = simulateReception(nhk, 0);
    const pidNames = result.tsPackets.map((p) => p.pidName);
    expect(pidNames).toContain("PAT");
    expect(pidNames).toContain("PMT");
    expect(pidNames).toContain("Video");
    expect(pidNames).toContain("Audio");
  });

  it("全 TS パケットの sync byte が 0x47", () => {
    const result = simulateReception(nhk, 0);
    for (const pkt of result.tsPackets) {
      expect(pkt.syncByte).toBe(0x47);
    }
  });

  it("ノイズ 30 で受信不可になる", () => {
    const result = simulateReception(nhk, 30);
    expect(result.locked).toBe(false);
    expect(result.segments).toHaveLength(0);
    expect(result.tsPackets).toHaveLength(0);
  });

  it("ノイズ 8 で受信可能 (BER 上昇)", () => {
    const result = simulateReception(nhk, 8);
    expect(result.locked).toBe(true);
  });
});

describe("describeSegmentLayout", () => {
  it("セグメント配置図が生成される", () => {
    const channels = createTokyoChannels();
    const layout = describeSegmentLayout(channels[0]!);
    expect(layout.length).toBeGreaterThan(0);
    expect(layout.some((l) => l.includes("13"))).toBe(true);
  });
});
