/* QUIC プリセット集 */

import type { Preset } from "./types.js";

/** 1. 1-RTTハンドシェイク基礎 */
const handshake1rtt: Preset = {
  name: "1-RTTハンドシェイク",
  description: "標準QUIC接続確立。TLS 1.3統合により1-RTTでハンドシェイク完了。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 5000 },
      { type: "close_connection" },
    ],
    network: { latency: 50, lossRate: 0, bandwidth: 10_000_000, jitter: 5 },
    congestionAlgo: "new_reno",
  }),
};

/** 2. 0-RTTハンドシェイク */
const handshake0rtt: Preset = {
  name: "0-RTTハンドシェイク",
  description: "PSKによる0-RTT接続。ハンドシェイク完了前にデータ送信開始。",
  build: () => ({
    ops: [
      { type: "connect_0rtt" },
      { type: "send_data", streamId: 0, size: 8000 },
      { type: "close_connection" },
    ],
    network: { latency: 50, lossRate: 0, bandwidth: 10_000_000, jitter: 5 },
    congestionAlgo: "new_reno",
  }),
};

/** 3. ストリーム多重化 */
const multiStream: Preset = {
  name: "ストリーム多重化",
  description: "複数ストリームの同時転送。HoLブロッキングなしの独立ストリーム。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },     // Stream 0
      { type: "open_stream", direction: "bidi" },     // Stream 4
      { type: "open_stream", direction: "uni" },      // Stream 2
      { type: "send_data", streamId: 0, size: 3000 },
      { type: "send_data", streamId: 4, size: 5000 },
      { type: "send_data", streamId: 2, size: 2000 },
      { type: "close_stream", streamId: 0 },
      { type: "close_stream", streamId: 4 },
      { type: "close_stream", streamId: 2 },
      { type: "close_connection" },
    ],
    network: { latency: 30, lossRate: 0, bandwidth: 10_000_000, jitter: 2 },
    congestionAlgo: "new_reno",
  }),
};

/** 4. パケットロスと再送 */
const packetLoss: Preset = {
  name: "パケットロスと再送",
  description: "ロス発生時の検出・再送・輻輳ウィンドウ縮小。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 20000 },
      { type: "close_connection" },
    ],
    network: { latency: 40, lossRate: 0.1, bandwidth: 10_000_000, jitter: 10 },
    congestionAlgo: "new_reno",
  }),
};

/** 5. NewReno輻輳制御 */
const newRenoCongestion: Preset = {
  name: "NewReno 輻輳制御",
  description: "スロースタート→輻輳回避。ロスでssthresh=cwnd/2に縮小。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 50000 },
      { type: "trigger_loss", packetNumbers: [10, 11, 12] },
      { type: "send_data", streamId: 0, size: 30000 },
      { type: "close_connection" },
    ],
    network: { latency: 30, lossRate: 0, bandwidth: 50_000_000, jitter: 3 },
    congestionAlgo: "new_reno",
  }),
};

/** 6. CUBIC輻輳制御 */
const cubicCongestion: Preset = {
  name: "CUBIC 輻輳制御",
  description: "3次関数ベースのcwnd増加。高BDP環境向けのアグレッシブな成長。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 50000 },
      { type: "trigger_loss", packetNumbers: [10] },
      { type: "send_data", streamId: 0, size: 40000 },
      { type: "close_connection" },
    ],
    network: { latency: 50, lossRate: 0, bandwidth: 100_000_000, jitter: 5 },
    congestionAlgo: "cubic",
  }),
};

/** 7. コネクションマイグレーション */
const migration: Preset = {
  name: "コネクションマイグレーション",
  description: "IPアドレス変更時の接続維持。PATH_CHALLENGE/RESPONSEによるパス検証。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 5000 },
      { type: "migrate_path", newAddr: "10.0.0.50:52000" },
      { type: "send_data", streamId: 0, size: 5000 },
      { type: "close_connection" },
    ],
    network: { latency: 40, lossRate: 0, bandwidth: 10_000_000, jitter: 5 },
    congestionAlgo: "new_reno",
  }),
};

/** 8. フロー制御 */
const flowControl: Preset = {
  name: "フロー制御",
  description: "コネクション/ストリームレベルのフロー制御。MAX_DATA/MAX_STREAM_DATAによる上限拡張。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 100000 },
      { type: "close_connection" },
    ],
    network: { latency: 20, lossRate: 0, bandwidth: 50_000_000, jitter: 2 },
    congestionAlgo: "new_reno",
  }),
};

/** 9. 高遅延環境 */
const highLatency: Preset = {
  name: "高遅延環境 (衛星回線)",
  description: "RTT=600msの高遅延環境でのQUIC動作。0-RTTの効果が顕著。",
  build: () => ({
    ops: [
      { type: "connect_0rtt" },
      { type: "send_data", streamId: 0, size: 10000 },
      { type: "close_connection" },
    ],
    network: { latency: 300, lossRate: 0.02, bandwidth: 5_000_000, jitter: 50 },
    congestionAlgo: "cubic",
  }),
};

/** 10. ネットワーク条件変化 */
const networkChange: Preset = {
  name: "ネットワーク条件変化",
  description: "転送中にネットワーク品質が劣化。輻輳制御の適応を観察。",
  build: () => ({
    ops: [
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 20000 },
      { type: "update_network", condition: { latency: 200, lossRate: 0.15 } },
      { type: "send_data", streamId: 0, size: 20000 },
      { type: "update_network", condition: { latency: 30, lossRate: 0 } },
      { type: "send_data", streamId: 0, size: 10000 },
      { type: "close_connection" },
    ],
    network: { latency: 30, lossRate: 0, bandwidth: 20_000_000, jitter: 3 },
    congestionAlgo: "new_reno",
  }),
};

export const PRESETS: Preset[] = [
  handshake1rtt,
  handshake0rtt,
  multiStream,
  packetLoss,
  newRenoCongestion,
  cubicCongestion,
  migration,
  flowControl,
  highLatency,
  networkChange,
];
