/* RPC シミュレーター テスト */

import { describe, it, expect } from "vitest";
import { simulate, mkCall, mkNetwork } from "../rpc/engine.js";
import { PRESETS } from "../rpc/presets.js";
import type { SimOp } from "../rpc/types.js";

describe("RPC Engine", () => {
  // ─── JSON-RPC ───

  describe("JSON-RPC", () => {
    it("基本的な呼び出しが成功する", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 3, b: 5 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults).toHaveLength(1);
      expect(r.callResults[0].success).toBe(true);
      expect(r.callResults[0].result).toBe(8);
    });

    it("リクエストがJSON形式でシリアライズされる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 1, b: 2 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].requestWire.format).toBe("json");
      const parsed = JSON.parse(r.callResults[0].requestWire.raw);
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("MathService.add");
    });

    it("存在しないメソッドでエラーが返る", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "nonexistent", {}), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(false);
      expect(r.callResults[0].error?.code).toBe(-32601); // METHOD_NOT_FOUND
    });

    it("実行時エラーがINTERNAL_ERRORとして返る", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "divide", { a: 10, b: 0 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(false);
      expect(r.callResults[0].error?.code).toBe(-32603); // INTERNAL_ERROR
      expect(r.callResults[0].error?.message).toContain("Division by zero");
    });

    it("バッチリクエストが処理される", () => {
      const ops: SimOp[] = [
        {
          type: "batch_call",
          calls: [
            mkCall("json_rpc", "MathService", "add", { a: 1, b: 2 }),
            mkCall("json_rpc", "MathService", "multiply", { a: 3, b: 4 }),
          ],
          network: mkNetwork(),
        },
      ];
      const r = simulate(ops);
      expect(r.callResults).toHaveLength(2);
      expect(r.callResults[0].result).toBe(3);
      expect(r.callResults[1].result).toBe(12);
      expect(r.callResults[0].call.batch).toBe(true);
    });

    it("Notificationはレスポンスなしで成功する", () => {
      const ops: SimOp[] = [
        { type: "notification", protocol: "json_rpc", method: "log.info", params: { msg: "test" } },
      ];
      const r = simulate(ops);
      expect(r.callResults).toHaveLength(1);
      expect(r.callResults[0].success).toBe(true);
      expect(r.callResults[0].responseWire.sizeBytes).toBe(0); // レスポンスなし
    });

    it("Notificationのリクエストにidがnullとなる", () => {
      const ops: SimOp[] = [
        { type: "notification", protocol: "json_rpc", method: "test", params: {} },
      ];
      const r = simulate(ops);
      const parsed = JSON.parse(r.callResults[0].requestWire.raw);
      expect(parsed.id).toBeNull();
    });
  });

  // ─── XML-RPC ───

  describe("XML-RPC", () => {
    it("基本的な呼び出しが成功する", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("xml_rpc", "MathService", "add", { a: 7, b: 8 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(true);
      expect(r.callResults[0].result).toBe(15);
    });

    it("リクエストがXML形式でシリアライズされる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("xml_rpc", "MathService", "add", { a: 1, b: 2 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].requestWire.format).toBe("xml");
      expect(r.callResults[0].requestWire.raw).toContain("<methodCall>");
      expect(r.callResults[0].requestWire.raw).toContain("<methodName>MathService.add</methodName>");
    });

    it("レスポンスがXML形式でシリアライズされる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("xml_rpc", "MathService", "add", { a: 1, b: 2 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].responseWire.format).toBe("xml");
      expect(r.callResults[0].responseWire.raw).toContain("<methodResponse>");
    });

    it("存在しないメソッドでfaultが返る", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("xml_rpc", "MathService", "unknown", {}), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(false);
      expect(r.callResults[0].responseWire.raw).toContain("<fault>");
    });

    it("XMLはJSONよりサイズが大きい", () => {
      const params = { a: 42, b: 58 };
      const jsonOps: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", params), network: mkNetwork() },
      ];
      const xmlOps: SimOp[] = [
        { type: "call", call: mkCall("xml_rpc", "MathService", "add", params), network: mkNetwork() },
      ];
      const jsonR = simulate(jsonOps);
      const xmlR = simulate(xmlOps);
      expect(xmlR.callResults[0].requestWire.sizeBytes).toBeGreaterThan(
        jsonR.callResults[0].requestWire.sizeBytes
      );
    });
  });

  // ─── gRPC ───

  describe("gRPC", () => {
    it("Unary呼び出しが成功する", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "MathService", "add", { a: 100, b: 200 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(true);
      expect(r.callResults[0].result).toBe(300);
    });

    it("ProtobufフォーマットでシリアライズされるHTTP/2トランスポート", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "MathService", "add", { a: 1, b: 2 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].requestWire.format).toBe("protobuf");
      expect(r.callResults[0].call.transport).toBe("http2");
    });

    it("Protobufフォーマットでエンコードされる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "MathService", "add", { a: 42, b: 58 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].requestWire.format).toBe("protobuf");
      expect(r.callResults[0].requestWire.raw).toContain("grpc:MathService/add");
      expect(r.callResults[0].requestWire.sizeBytes).toBeGreaterThan(0);
    });

    it("Server Streamingでストリームメッセージが生成される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "StreamService", "serverStream", { count: 3 }, { callType: "server_stream" }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(true);
      expect(r.callResults[0].streamMessages).toBeDefined();
      expect(r.callResults[0].streamMessages!.length).toBe(3);
      expect(r.callResults[0].streamMessages!.every(m => m.direction === "recv")).toBe(true);
    });

    it("Client Streamingで送信→受信パターンになる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "StreamService", "echo", { message: "hi" }, { callType: "client_stream" }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].streamMessages).toBeDefined();
      const msgs = r.callResults[0].streamMessages!;
      const sends = msgs.filter(m => m.direction === "send");
      const recvs = msgs.filter(m => m.direction === "recv");
      expect(sends.length).toBeGreaterThan(0);
      expect(recvs.length).toBe(1); // 最後に1レスポンス
    });

    it("Bidi Streamingで送受信が交互になる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "StreamService", "serverStream", { count: 2 }, { callType: "bidi_stream" }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      const msgs = r.callResults[0].streamMessages!;
      expect(msgs.length).toBeGreaterThan(0);
      // 送受信が混在する
      const dirs = new Set(msgs.map(m => m.direction));
      expect(dirs.has("send")).toBe(true);
      expect(dirs.has("recv")).toBe(true);
    });

    it("存在しないメソッドでUNIMPLEMENTEDが返る", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "MathService", "unknown", {}), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(false);
      expect(r.callResults[0].error?.code).toBe(12); // UNIMPLEMENTED
    });
  });

  // ─── tRPC ───

  describe("tRPC", () => {
    it("Query呼び出しが成功する", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("trpc", "UserService", "getUser", { id: 5 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(true);
      expect(r.callResults[0].result).toEqual({ id: 5, name: "User_5", email: "user5@example.com" });
    });

    it("QueryはGETリクエストとして構築される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("trpc", "UserService", "getUser", { id: 1 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].requestWire.raw).toContain("GET /api/trpc/");
    });

    it("MutationはPOSTリクエストとして構築される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("trpc", "UserService", "createUser", { name: "Test", email: "test@test.com" }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].requestWire.raw).toContain("POST /api/trpc/");
    });

    it("レスポンスがJSON形式", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("trpc", "UserService", "listUsers", {}), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].responseWire.format).toBe("json");
    });

    it("存在しないプロシージャでNOT_FOUNDが返る", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("trpc", "UserService", "unknown", {}), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(false);
      expect(r.callResults[0].error?.code).toBe("NOT_FOUND");
    });
  });

  // ─── ネットワーク ───

  describe("ネットワーク", () => {
    it("レイテンシがdurationに反映される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 1, b: 1 }), network: mkNetwork(100, 0) },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].duration).toBeGreaterThanOrEqual(90);
    });

    it("パケットロスでタイムアウトエラーになる", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 1, b: 1 }), network: mkNetwork(10, 0, 1.0) },
      ];
      const r = simulate(ops);
      expect(r.callResults[0].success).toBe(false);
      expect(r.callResults[0].error?.code).toBe("TIMEOUT");
    });

    it("合計バイト数が正しく計算される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 1, b: 2 }), network: mkNetwork(0, 0) },
        { type: "call", call: mkCall("json_rpc", "MathService", "multiply", { a: 3, b: 4 }), network: mkNetwork(0, 0) },
      ];
      const r = simulate(ops);
      const expectedBytes = r.callResults.reduce(
        (s, c) => s + c.requestWire.sizeBytes + c.responseWire.sizeBytes, 0
      );
      expect(r.totalBytes).toBe(expectedBytes);
    });
  });

  // ─── イベント ───

  describe("イベント", () => {
    it("呼び出しごとにイベントが記録される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 1, b: 2 }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      expect(r.events.length).toBeGreaterThan(0);
      // シリアライズ→送信→ディスパッチ→実行→レスポンス→受信のイベント
      const types = r.events.map(e => e.type);
      expect(types).toContain("serialize");
      expect(types).toContain("send");
      expect(types).toContain("dispatch");
      expect(types).toContain("execute");
    });

    it("ストリーミングでstream_msgイベントが記録される", () => {
      const ops: SimOp[] = [
        { type: "call", call: mkCall("grpc", "StreamService", "serverStream", { count: 3 }, { callType: "server_stream" }), network: mkNetwork() },
      ];
      const r = simulate(ops);
      const streamEvents = r.events.filter(e => e.type === "stream_msg");
      expect(streamEvents.length).toBe(3);
    });

    it("バッチ呼び出しでbatchイベントが記録される", () => {
      const ops: SimOp[] = [
        {
          type: "batch_call",
          calls: [
            mkCall("json_rpc", "MathService", "add", { a: 1, b: 2 }),
            mkCall("json_rpc", "MathService", "multiply", { a: 3, b: 4 }),
          ],
          network: mkNetwork(),
        },
      ];
      const r = simulate(ops);
      const batchEvents = r.events.filter(e => e.type === "batch");
      expect(batchEvents.length).toBeGreaterThan(0);
    });

    it("Notificationでnotificationイベントが記録される", () => {
      const ops: SimOp[] = [
        { type: "notification", protocol: "json_rpc", method: "test", params: {} },
      ];
      const r = simulate(ops);
      const notifEvents = r.events.filter(e => e.type === "notification");
      expect(notifEvents.length).toBe(1);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.callResults.length).toBeGreaterThan(0);
        expect(r.events.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });

    it("プロトコル比較プリセットで4プロトコルが使われる", () => {
      const preset = PRESETS.find(p => p.name.includes("比較"));
      expect(preset).toBeDefined();
      const ops = preset!.build();
      const r = simulate(ops);
      const protocols = new Set(r.callResults.map(c => c.call.protocol));
      expect(protocols.size).toBe(4);
    });
  });
});
