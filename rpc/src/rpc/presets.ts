/* RPC シミュレーター プリセット */

import type { Preset, SimOp } from "./types.js";
import { mkCall, mkNetwork } from "./engine.js";

export const PRESETS: Preset[] = [
  {
    name: "JSON-RPC 基本呼び出し",
    description: "JSON-RPC 2.0の基本的なリクエスト/レスポンス",
    build: (): SimOp[] => {
      const net = mkNetwork(10, 2);
      return [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 3, b: 5 }), network: net },
        { type: "call", call: mkCall("json_rpc", "UserService", "getUser", { id: 42 }), network: net },
      ];
    },
  },
  {
    name: "JSON-RPC バッチ",
    description: "JSON-RPC 2.0バッチリクエストで複数呼び出しを一括送信",
    build: (): SimOp[] => {
      const net = mkNetwork(15, 3);
      return [
        {
          type: "batch_call",
          calls: [
            mkCall("json_rpc", "MathService", "add", { a: 1, b: 2 }),
            mkCall("json_rpc", "MathService", "multiply", { a: 3, b: 4 }),
            mkCall("json_rpc", "UserService", "listUsers", {}),
          ],
          network: net,
        },
      ];
    },
  },
  {
    name: "JSON-RPC Notification",
    description: "JSON-RPC Notification（レスポンス不要の一方向通知）",
    build: (): SimOp[] => {
      const net = mkNetwork(10, 2);
      return [
        { type: "notification", protocol: "json_rpc", method: "log.info", params: { message: "アプリケーション起動" } },
        { type: "notification", protocol: "json_rpc", method: "metrics.record", params: { name: "request_count", value: 1 } },
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 10, b: 20 }), network: net },
      ];
    },
  },
  {
    name: "JSON-RPC エラー",
    description: "メソッド未検出やパラメータエラーなどのエラーハンドリング",
    build: (): SimOp[] => {
      const net = mkNetwork(10, 2);
      return [
        { type: "call", call: mkCall("json_rpc", "MathService", "unknown", { x: 1 }), network: net },
        { type: "call", call: mkCall("json_rpc", "MathService", "divide", { a: 10, b: 0 }), network: net },
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 5, b: 3 }), network: net },
      ];
    },
  },
  {
    name: "XML-RPC 呼び出し",
    description: "XML-RPCのリクエスト/レスポンス（XMLシリアライズ）",
    build: (): SimOp[] => {
      const net = mkNetwork(12, 3);
      return [
        { type: "call", call: mkCall("xml_rpc", "MathService", "add", { a: 7, b: 8 }), network: net },
        { type: "call", call: mkCall("xml_rpc", "UserService", "getUser", { id: 1 }), network: net },
      ];
    },
  },
  {
    name: "gRPC Unary",
    description: "gRPC Unary呼び出し（Protobufシリアライズ, HTTP/2）",
    build: (): SimOp[] => {
      const net = mkNetwork(5, 1);
      return [
        { type: "call", call: mkCall("grpc", "MathService", "add", { a: 100, b: 200 }), network: net },
        { type: "call", call: mkCall("grpc", "UserService", "getUser", { id: 5 }), network: net },
      ];
    },
  },
  {
    name: "gRPC Streaming",
    description: "gRPCの各種ストリーミングパターン（Server/Client/Bidi）",
    build: (): SimOp[] => {
      const net = mkNetwork(5, 1);
      return [
        { type: "call", call: mkCall("grpc", "StreamService", "serverStream", { count: 5 }, { callType: "server_stream" }), network: net },
        { type: "call", call: mkCall("grpc", "StreamService", "echo", { message: "hello" }, { callType: "client_stream" }), network: net },
        { type: "call", call: mkCall("grpc", "StreamService", "serverStream", { count: 3 }, { callType: "bidi_stream" }), network: net },
      ];
    },
  },
  {
    name: "tRPC Query/Mutation",
    description: "tRPCのQuery（GET）とMutation（POST）パターン",
    build: (): SimOp[] => {
      const net = mkNetwork(8, 2);
      return [
        { type: "call", call: mkCall("trpc", "UserService", "getUser", { id: 10 }), network: net },
        { type: "call", call: mkCall("trpc", "UserService", "listUsers", {}), network: net },
        { type: "call", call: mkCall("trpc", "UserService", "createUser", { name: "Dave", email: "dave@example.com" }), network: net },
      ];
    },
  },
  {
    name: "プロトコル比較",
    description: "同じ呼び出しを4プロトコルで実行しワイヤサイズ・速度を比較",
    build: (): SimOp[] => {
      const net = mkNetwork(10, 0);
      const params = { a: 42, b: 58 };
      return [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", params), network: net },
        { type: "call", call: mkCall("xml_rpc", "MathService", "add", params), network: net },
        { type: "call", call: mkCall("grpc", "MathService", "add", params), network: net },
        { type: "call", call: mkCall("trpc", "MathService", "add", params), network: net },
      ];
    },
  },
  {
    name: "ネットワーク障害",
    description: "高レイテンシ・パケットロス環境でのRPC呼び出し",
    build: (): SimOp[] => {
      const badNet = mkNetwork(200, 50, 0.3);
      return [
        { type: "call", call: mkCall("json_rpc", "MathService", "add", { a: 1, b: 1 }), network: badNet },
        { type: "call", call: mkCall("grpc", "MathService", "add", { a: 1, b: 1 }), network: badNet },
        { type: "call", call: mkCall("json_rpc", "UserService", "listUsers", {}), network: badNet },
        { type: "call", call: mkCall("grpc", "UserService", "getUser", { id: 1 }), network: badNet },
      ];
    },
  },
];
