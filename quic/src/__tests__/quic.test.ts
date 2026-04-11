/* QUIC プロトコル シミュレーター テスト */

import { describe, it, expect } from "vitest";
import { simulate, createConnection } from "../quic/engine.js";
import { PRESETS } from "../quic/presets.js";
import type { NetworkCondition } from "../quic/types.js";

const NET: NetworkCondition = {
  latency: 50, lossRate: 0, bandwidth: 10_000_000, jitter: 5,
};

// ─── ハンドシェイク ───

describe("ハンドシェイク", () => {
  it("1-RTTハンドシェイクが完了する", () => {
    const result = simulate([{ type: "connect" }], NET);
    expect(result.connection.state).toBe("connected");
    expect(result.connection.tls.handshakeComplete).toBe(true);
    expect(result.handshakeRtts).toBe(1);
  });

  it("TLS 1.3メッセージが正しい順序", () => {
    const result = simulate([{ type: "connect" }], NET);
    const msgs = result.connection.tls.messages;
    expect(msgs).toContain("client_hello");
    expect(msgs).toContain("server_hello");
    expect(msgs).toContain("certificate");
    expect(msgs).toContain("finished");
    expect(msgs.indexOf("client_hello")).toBeLessThan(msgs.indexOf("server_hello"));
  });

  it("0-RTTハンドシェイクでデータが先行送信される", () => {
    const result = simulate([{ type: "connect_0rtt" }], NET);
    expect(result.connection.tls.zeroRttEnabled).toBe(true);
    expect(result.connection.tls.zeroRttAccepted).toBe(true);
    expect(result.handshakeRtts).toBe(0);
    // 0-RTTでストリームが作成されている
    expect(result.connection.streams.length).toBe(1);
    expect(result.connection.streams[0]!.sendOffset).toBe(200);
  });

  it("Initialパケットが送信される", () => {
    const result = simulate([{ type: "connect" }], NET);
    const initPkts = result.connection.sentPackets.filter(
      p => p.header.type === "initial"
    );
    expect(initPkts.length).toBeGreaterThan(0);
    expect(initPkts[0]!.header.longHeader).toBe(true);
  });
});

// ─── ストリーム ───

describe("ストリーム", () => {
  it("bidiストリームを開ける", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
    ], NET);
    expect(result.connection.streams.length).toBe(1);
    expect(result.connection.streams[0]!.id).toBe(0);
    expect(result.connection.streams[0]!.direction).toBe("bidi");
  });

  it("uniストリームのIDが正しい", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "uni" },
    ], NET);
    expect(result.connection.streams[0]!.id).toBe(2); // uni: 2, 6, 10...
  });

  it("複数ストリームの多重化", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 2000 },
      { type: "send_data", streamId: 4, size: 3000 },
    ], NET);
    expect(result.connection.streams.length).toBe(2);
    expect(result.connection.streams[0]!.sendOffset).toBeGreaterThan(0);
    expect(result.connection.streams[1]!.sendOffset).toBeGreaterThan(0);
  });

  it("ストリームクローズでFINが送信される", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 1000 },
      { type: "close_stream", streamId: 0 },
    ], NET);
    expect(result.connection.streams[0]!.state).toBe("closed");
    expect(result.connection.streams[0]!.finSent).toBe(true);
  });
});

// ─── データ転送 ───

describe("データ転送", () => {
  it("データ送信でパケットが生成される", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 5000 },
    ], NET);
    const streamPkts = result.connection.sentPackets.filter(
      p => p.frames.some(f => f.type === "stream")
    );
    expect(streamPkts.length).toBeGreaterThan(0);
    expect(result.totalBytesSent).toBeGreaterThanOrEqual(5000);
  });

  it("送信バイトが正しくカウントされる", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 10000 },
    ], NET);
    expect(result.totalBytesSent).toBeGreaterThanOrEqual(10000);
  });
});

// ─── 輻輳制御 ───

describe("輻輳制御", () => {
  it("NewRenoでスロースタートから開始", () => {
    const conn = createConnection("new_reno");
    expect(conn.congestion.phase).toBe("slow_start");
    expect(conn.congestion.cwnd).toBe(14720);
  });

  it("パケットロスでcwndが減少する", () => {
    const lossNet: NetworkCondition = { ...NET, lossRate: 0.3 };
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 50000 },
    ], lossNet);
    // ロス発生でssthreshが設定される
    expect(result.connection.congestion.ssthresh).not.toBe(Infinity);
    expect(result.lostPackets).toBeGreaterThan(0);
  });

  it("cwnd履歴が記録される", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 20000 },
    ], NET);
    expect(result.connection.congestion.cwndHistory.length).toBeGreaterThan(1);
  });

  it("CUBICアルゴリズムが使用できる", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 10000 },
    ], NET, "cubic");
    expect(result.connection.congestion.algo).toBe("cubic");
  });

  it("RTTが正しく更新される", () => {
    const result = simulate([{ type: "connect" }], NET);
    const cc = result.connection.congestion;
    // 初期RTT更新後
    expect(cc.smoothedRtt).toBeGreaterThan(0);
    expect(cc.minRtt).toBeLessThan(Infinity);
  });
});

// ─── フロー制御 ───

describe("フロー制御", () => {
  it("大量データ送信でMAX_DATAが拡張される", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 100000 },
    ], NET);
    // フロー制御上限が初期値から拡張されている
    expect(result.connection.flowControl.connMaxSend).toBeGreaterThan(65536);
  });
});

// ─── コネクションマイグレーション ───

describe("コネクションマイグレーション", () => {
  it("パスマイグレーションが成功する", () => {
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 3000 },
      { type: "migrate_path", newAddr: "10.0.0.50:52000" },
    ], NET);
    expect(result.connection.paths.length).toBe(2);
    const newPath = result.connection.paths[1]!;
    expect(newPath.active).toBe(true);
    expect(newPath.validated).toBe(true);
    expect(newPath.localAddr).toBe("10.0.0.50:52000");
  });

  it("PATH_CHALLENGE/RESPONSEパケットが交換される", () => {
    const result = simulate([
      { type: "connect" },
      { type: "migrate_path", newAddr: "10.0.0.1:9999" },
    ], NET);
    const challenge = result.connection.sentPackets.find(
      p => p.frames.some(f => f.type === "path_challenge")
    );
    const response = result.connection.recvPackets.find(
      p => p.frames.some(f => f.type === "path_response")
    );
    expect(challenge).toBeDefined();
    expect(response).toBeDefined();
  });
});

// ─── 接続クローズ ───

describe("接続クローズ", () => {
  it("正常クローズでdraining→closedになる", () => {
    const result = simulate([
      { type: "connect" },
      { type: "close_connection" },
    ], NET);
    expect(result.connection.state).toBe("closed");
  });

  it("CONNECTION_CLOSEフレームが送信される", () => {
    const result = simulate([
      { type: "connect" },
      { type: "close_connection" },
    ], NET);
    const closePkt = result.connection.sentPackets.find(
      p => p.frames.some(f => f.type === "connection_close")
    );
    expect(closePkt).toBeDefined();
  });
});

// ─── パケットロス ───

describe("パケットロス", () => {
  it("ロス率に応じてパケットがロストする", () => {
    const lossNet: NetworkCondition = { ...NET, lossRate: 0.5 };
    const result = simulate([
      { type: "connect" },
      { type: "open_stream", direction: "bidi" },
      { type: "send_data", streamId: 0, size: 30000 },
    ], lossNet);
    // 50%ロス率で一部ロスト
    expect(result.lostPackets).toBeGreaterThan(0);
  });
});

// ─── プリセット ───

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of PRESETS) {
      const { ops, network, congestionAlgo } = preset.build();
      const result = simulate(ops, network, congestionAlgo);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("プリセット数が10個ある", () => {
    expect(PRESETS.length).toBe(10);
  });

  it("全プリセットに一意の名前がある", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
