/* HLS シミュレーター プリセット */

import type { Preset, SimOp } from "./types.js";
import { mkSegments, mkRendition, mkMaster, mkNetwork } from "./engine.js";

/** 標準マルチビットレート構成 */
function standardMaster(segCount = 20, segDuration = 6, encrypted = false) {
  return mkMaster([
    mkRendition(400_000, 426, 240, mkSegments(segCount, segDuration, 400_000, "240p", { encrypted })),
    mkRendition(800_000, 640, 360, mkSegments(segCount, segDuration, 800_000, "360p", { encrypted })),
    mkRendition(1_500_000, 854, 480, mkSegments(segCount, segDuration, 1_500_000, "480p", { encrypted })),
    mkRendition(3_000_000, 1280, 720, mkSegments(segCount, segDuration, 3_000_000, "720p", { encrypted })),
    mkRendition(6_000_000, 1920, 1080, mkSegments(segCount, segDuration, 6_000_000, "1080p", { encrypted })),
  ]);
}

export const PRESETS: Preset[] = [
  {
    name: "VOD 基本再生",
    description: "安定ネットワークでのVOD再生（帯域幅ベースABR）",
    build: (): SimOp[] => [{
      type: "vod",
      master: standardMaster(15),
      abr: "bandwidth",
      network: mkNetwork(5_000_000, 30, 5),
    }],
  },
  {
    name: "帯域幅変動",
    description: "帯域幅が段階的に変化する環境での適応的再生",
    build: (): SimOp[] => [{
      type: "vod",
      master: standardMaster(20),
      abr: "bandwidth",
      network: mkNetwork(6_000_000, 30, 5),
      networkChanges: [
        { atTime: 3000, condition: mkNetwork(2_000_000, 50, 10) },
        { atTime: 8000, condition: mkNetwork(800_000, 80, 20) },
        { atTime: 15000, condition: mkNetwork(5_000_000, 30, 5) },
        { atTime: 25000, condition: mkNetwork(10_000_000, 20, 5) },
      ],
    }],
  },
  {
    name: "ABRアルゴリズム比較",
    description: "帯域幅/バッファ/ハイブリッドの3方式を同条件で比較",
    build: (): SimOp[] => [{
      type: "abr_compare",
      master: standardMaster(15),
      algorithms: ["bandwidth", "buffer", "hybrid"],
      network: mkNetwork(4_000_000, 40, 10),
      networkChanges: [
        { atTime: 5000, condition: mkNetwork(1_000_000, 80, 20) },
        { atTime: 12000, condition: mkNetwork(6_000_000, 30, 5) },
      ],
    }],
  },
  {
    name: "低帯域幅環境",
    description: "モバイル3G相当の低帯域幅環境でのストリーミング",
    build: (): SimOp[] => [{
      type: "vod",
      master: standardMaster(12),
      abr: "hybrid",
      network: mkNetwork(500_000, 100, 30, 0.02),
    }],
  },
  {
    name: "ライブストリーミング",
    description: "ライブ配信（スライディングウィンドウ方式）",
    build: (): SimOp[] => [{
      type: "live",
      master: standardMaster(30, 4),
      abr: "bandwidth",
      network: mkNetwork(5_000_000, 40, 10),
      windowSize: 5,
    }],
  },
  {
    name: "暗号化コンテンツ (AES-128)",
    description: "AES-128暗号化されたHLSコンテンツの再生",
    build: (): SimOp[] => [{
      type: "vod",
      master: standardMaster(10, 6, true),
      abr: "bandwidth",
      network: mkNetwork(5_000_000, 30, 5),
    }],
  },
  {
    name: "ネットワーク断",
    description: "一時的なネットワーク断によるリバッファリング",
    build: (): SimOp[] => [{
      type: "vod",
      master: standardMaster(15),
      abr: "hybrid",
      network: mkNetwork(5_000_000, 30, 5),
      networkChanges: [
        { atTime: 4000, condition: mkNetwork(100_000, 500, 100, 0.5) },
        { atTime: 10000, condition: mkNetwork(5_000_000, 30, 5) },
      ],
    }],
  },
  {
    name: "高品質4K配信",
    description: "4K UHD高ビットレート配信（HEVC/H.265）",
    build: (): SimOp[] => {
      const master = mkMaster([
        mkRendition(1_500_000, 854, 480, mkSegments(12, 6, 1_500_000, "480p"), { codec: "hvc1.1.6.L93.B0,mp4a.40.2" }),
        mkRendition(4_000_000, 1280, 720, mkSegments(12, 6, 4_000_000, "720p"), { codec: "hvc1.1.6.L120.B0,mp4a.40.2" }),
        mkRendition(8_000_000, 1920, 1080, mkSegments(12, 6, 8_000_000, "1080p"), { codec: "hvc1.1.6.L150.B0,mp4a.40.2" }),
        mkRendition(15_000_000, 3840, 2160, mkSegments(12, 6, 15_000_000, "4k"), { codec: "hvc1.2.4.L153.B0,mp4a.40.2" }),
      ]);
      return [{
        type: "vod",
        master,
        abr: "hybrid",
        network: mkNetwork(20_000_000, 20, 5),
      }];
    },
  },
  {
    name: "バッファベースABR",
    description: "バッファ駆動型ABR（BBA）による適応制御",
    build: (): SimOp[] => [{
      type: "vod",
      master: standardMaster(18),
      abr: "buffer",
      network: mkNetwork(3_000_000, 40, 15),
      networkChanges: [
        { atTime: 6000, condition: mkNetwork(1_500_000, 60, 20) },
        { atTime: 14000, condition: mkNetwork(8_000_000, 20, 5) },
      ],
    }],
  },
  {
    name: "セグメント長比較",
    description: "2秒 vs 6秒 vs 10秒セグメントの挙動比較",
    build: (): SimOp[] => {
      const net = mkNetwork(3_000_000, 40, 10);
      const changes = [
        { atTime: 4000, condition: mkNetwork(1_000_000, 80, 20) },
        { atTime: 10000, condition: mkNetwork(5_000_000, 30, 5) },
      ];
      return [
        {
          type: "vod",
          master: mkMaster([
            mkRendition(800_000, 640, 360, mkSegments(30, 2, 800_000, "360p_2s"), { targetDuration: 2 }),
            mkRendition(3_000_000, 1280, 720, mkSegments(30, 2, 3_000_000, "720p_2s"), { targetDuration: 2 }),
          ]),
          abr: "bandwidth",
          network: net,
          networkChanges: changes,
        },
        {
          type: "vod",
          master: mkMaster([
            mkRendition(800_000, 640, 360, mkSegments(10, 6, 800_000, "360p_6s"), { targetDuration: 6 }),
            mkRendition(3_000_000, 1280, 720, mkSegments(10, 6, 3_000_000, "720p_6s"), { targetDuration: 6 }),
          ]),
          abr: "bandwidth",
          network: net,
          networkChanges: changes,
        },
        {
          type: "vod",
          master: mkMaster([
            mkRendition(800_000, 640, 360, mkSegments(6, 10, 800_000, "360p_10s"), { targetDuration: 10 }),
            mkRendition(3_000_000, 1280, 720, mkSegments(6, 10, 3_000_000, "720p_10s"), { targetDuration: 10 }),
          ]),
          abr: "bandwidth",
          network: net,
          networkChanges: changes,
        },
      ];
    },
  },
];
