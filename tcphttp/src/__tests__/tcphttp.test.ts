import { describe, it, expect } from "vitest";
import { runSimulation } from "../tcphttp/engine.js";
import { presets } from "../tcphttp/presets.js";
import type { SimOp, SocketAddr } from "../tcphttp/types.js";

const CLIENT: SocketAddr = { ip: "192.168.1.10", port: 50000 };
const SERVER: SocketAddr = { ip: "93.184.216.34", port: 80 };

/** ヘルパー: 基本ハンドシェイク操作 */
function handshakeOps(): SimOp[] {
  return [
    { type: "socket_create", side: "client" },
    { type: "socket_create", side: "server" },
    { type: "bind", side: "server", port: 80 },
    { type: "listen", side: "server" },
    { type: "connect", side: "client" },
  ];
}

describe("TCPソケット + HTTP シミュレーション", () => {
  // --- 3ウェイハンドシェイク ---
  it("3ウェイハンドシェイクで3つのセグメントが生成される", () => {
    const result = runSimulation(CLIENT, SERVER, handshakeOps());
    expect(result.stats.handshakeSegments).toBe(3);
  });

  it("ハンドシェイク後に両ソケットがESTABLISHED", () => {
    const result = runSimulation(CLIENT, SERVER, handshakeOps());
    expect(result.clientSocket.state).toBe("ESTABLISHED");
    expect(result.serverSocket.state).toBe("ESTABLISHED");
  });

  it("SYNセグメントのフラグが正しい", () => {
    const result = runSimulation(CLIENT, SERVER, handshakeOps());
    const syn = result.segments[0]!;
    expect(syn.flags.syn).toBe(true);
    expect(syn.flags.ack).toBe(false);
  });

  it("SYN+ACKセグメントのフラグが正しい", () => {
    const result = runSimulation(CLIENT, SERVER, handshakeOps());
    const synAck = result.segments[1]!;
    expect(synAck.flags.syn).toBe(true);
    expect(synAck.flags.ack).toBe(true);
  });

  it("ACKセグメントのシーケンス番号がISN+1", () => {
    const result = runSimulation(CLIENT, SERVER, handshakeOps());
    const ack = result.segments[2]!;
    expect(ack.flags.syn).toBe(false);
    expect(ack.flags.ack).toBe(true);
    expect(ack.seq).toBe(1001);
  });

  // --- データ送受信 ---
  it("データ送信でPSH+ACKセグメントが生成される", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "send", side: "client", data: "Hello" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    const dataSeg = result.segments[3]!;
    expect(dataSeg.flags.psh).toBe(true);
    expect(dataSeg.flags.ack).toBe(true);
    expect(dataSeg.payloadSize).toBe(5);
  });

  it("データ送信後にACKセグメントが返される", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "send", side: "client", data: "Hello" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    const ackSeg = result.segments[4]!;
    expect(ackSeg.flags.ack).toBe(true);
    expect(ackSeg.flags.psh).toBe(false);
  });

  it("シーケンス番号がデータ長分進む", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "send", side: "client", data: "Hello" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.clientSocket.sendNext).toBe(1006); // 1001 + 5
  });

  it("recv()で最後に受信したデータが取得できる", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "send", side: "client", data: "TestData" },
      { type: "recv", side: "server" },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    const recvEvent = result.events.find(e => e.type === "data_recv");
    expect(recvEvent).toBeDefined();
    expect(recvEvent!.description).toContain("TestData");
  });

  it("双方向のデータ送信でバッファに記録される", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "send", side: "client", data: "Req" },
      { type: "send", side: "server", data: "Res" },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.clientSocket.sendBuffer).toEqual(["Req"]);
    expect(result.serverSocket.sendBuffer).toEqual(["Res"]);
    expect(result.serverSocket.recvBuffer).toEqual(["Req"]);
    expect(result.clientSocket.recvBuffer).toEqual(["Res"]);
  });

  // --- 4ウェイ切断 ---
  it("close()でFINハンドシェイクが実行される", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "close", side: "client" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.stats.teardownSegments).toBeGreaterThanOrEqual(4);
  });

  it("close後にクライアントがTIME_WAIT", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "close", side: "client" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.clientSocket.state).toBe("TIME_WAIT");
  });

  it("close後にサーバーがCLOSED", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "close", side: "client" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.serverSocket.state).toBe("CLOSED");
  });

  // --- RST ---
  it("RST送信で両ソケットがCLOSED", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "rst", side: "server" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.clientSocket.state).toBe("CLOSED");
    expect(result.serverSocket.state).toBe("CLOSED");
  });

  it("RSTイベントが記録される", () => {
    const ops: SimOp[] = [...handshakeOps(), { type: "rst", side: "server" }];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.events.some(e => e.type === "rst_send")).toBe(true);
    expect(result.events.some(e => e.type === "rst_recv")).toBe(true);
  });

  // --- HTTPリクエスト/レスポンス ---
  it("HTTPリクエストがTCPセグメントで送信される", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "http_request", request: { method: "GET", path: "/", version: "1.1", headers: { Host: "example.com" } } },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.stats.dataSegments).toBe(1);
    expect(result.httpExchanges.length).toBe(1);
    expect(result.httpExchanges[0]!.request!.method).toBe("GET");
  });

  it("HTTPレスポンスがTCPセグメントで返される", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "http_request", request: { method: "GET", path: "/", version: "1.1", headers: { Host: "example.com" } } },
      { type: "http_response", response: { statusCode: 200, statusText: "OK", version: "1.1", headers: { "Content-Type": "text/html" }, body: "<html>OK</html>" } },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.httpExchanges[0]!.response!.statusCode).toBe(200);
  });

  it("Keep-Aliveイベントが生成される (HTTP/1.1, Connection!=close)", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "http_request", request: { method: "GET", path: "/", version: "1.1", headers: { Host: "example.com" } } },
      { type: "http_response", response: { statusCode: 200, statusText: "OK", version: "1.1", headers: { "Connection": "keep-alive" } } },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.events.some(e => e.type === "keep_alive")).toBe(true);
  });

  it("HTTP/1.0 Connection:closeではKeep-Aliveイベントなし", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "http_request", request: { method: "GET", path: "/", version: "1.0", headers: { Host: "example.com" } } },
      { type: "http_response", response: { statusCode: 200, statusText: "OK", version: "1.0", headers: { "Connection": "close" } } },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.events.some(e => e.type === "keep_alive")).toBe(false);
  });

  // --- 統計 ---
  it("統計情報が正しく計算される", () => {
    const ops: SimOp[] = [
      ...handshakeOps(),
      { type: "send", side: "client", data: "data" },
      { type: "close", side: "client" },
    ];
    const result = runSimulation(CLIENT, SERVER, ops);
    expect(result.stats.handshakeSegments).toBe(3);
    expect(result.stats.dataSegments).toBe(1);
    expect(result.stats.ackSegments).toBeGreaterThan(0);
    expect(result.stats.teardownSegments).toBeGreaterThanOrEqual(4);
  });

  // --- プリセット ---
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.clientAddr, preset.serverAddr, preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("プリセット1（3ウェイハンドシェイク）がESTABLISHED", () => {
    const p = presets[0]!;
    const result = runSimulation(p.clientAddr, p.serverAddr, p.ops);
    expect(result.clientSocket.state).toBe("ESTABLISHED");
    expect(result.serverSocket.state).toBe("ESTABLISHED");
  });
});
