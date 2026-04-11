/* RPC シミュレーター エンジン */

import type {
  RpcProtocol, Transport,
  JsonRpcRequest, JsonRpcResponse, JsonRpcError,
  XmlRpcRequest, XmlRpcResponse, XmlRpcValue,
  GrpcMessage, GrpcCallType, GrpcStatusCode,
  TrpcRequest, TrpcResponse, TrpcProcedureType,
  RpcMethod, RpcService, NetworkCondition, WireData,
  RpcCall, RpcCallResult, SimOp, SimEvent,
  SimulationResult,
} from "./types.js";
import { JSON_RPC_ERRORS, GRPC_STATUS_NAMES } from "./types.js";

// ─── サービスレジストリ ───

/** デフォルトサービス定義（シミュレーション用） */
function defaultServices(): RpcService[] {
  return [
    {
      name: "MathService",
      methods: [
        {
          name: "add",
          params: [{ name: "a", type: "number" }, { name: "b", type: "number" }],
          returnType: "number",
          handler: (p: unknown) => {
            const { a, b } = p as { a: number; b: number };
            return a + b;
          },
        },
        {
          name: "multiply",
          params: [{ name: "a", type: "number" }, { name: "b", type: "number" }],
          returnType: "number",
          handler: (p: unknown) => {
            const { a, b } = p as { a: number; b: number };
            return a * b;
          },
        },
        {
          name: "divide",
          params: [{ name: "a", type: "number" }, { name: "b", type: "number" }],
          returnType: "number",
          handler: (p: unknown) => {
            const { a, b } = p as { a: number; b: number };
            if (b === 0) throw new Error("Division by zero");
            return a / b;
          },
        },
      ],
    },
    {
      name: "UserService",
      methods: [
        {
          name: "getUser",
          params: [{ name: "id", type: "number" }],
          returnType: "User",
          handler: (p: unknown) => {
            const { id } = p as { id: number };
            return { id, name: `User_${id}`, email: `user${id}@example.com` };
          },
        },
        {
          name: "listUsers",
          params: [],
          returnType: "User[]",
          handler: () => {
            return [
              { id: 1, name: "Alice", email: "alice@example.com" },
              { id: 2, name: "Bob", email: "bob@example.com" },
              { id: 3, name: "Charlie", email: "charlie@example.com" },
            ];
          },
        },
        {
          name: "createUser",
          params: [{ name: "name", type: "string" }, { name: "email", type: "string" }],
          returnType: "User",
          handler: (p: unknown) => {
            const { name, email } = p as { name: string; email: string };
            return { id: Math.floor(Math.random() * 1000), name, email };
          },
        },
      ],
    },
    {
      name: "StreamService",
      methods: [
        {
          name: "serverStream",
          params: [{ name: "count", type: "number" }],
          returnType: "stream",
          handler: (p: unknown) => {
            const { count } = p as { count: number };
            return Array.from({ length: count }, (_, i) => ({ index: i, value: `item_${i}` }));
          },
        },
        {
          name: "echo",
          params: [{ name: "message", type: "string" }],
          returnType: "string",
          handler: (p: unknown) => {
            const { message } = p as { message: string };
            return `Echo: ${message}`;
          },
        },
      ],
    },
  ];
}

// ─── メソッド解決 ───

/** サービス・メソッド名からハンドラを検索 */
function resolveMethod(
  services: RpcService[],
  serviceName: string,
  methodName: string,
): RpcMethod | undefined {
  const svc = services.find(s => s.name === serviceName);
  return svc?.methods.find(m => m.name === methodName);
}

// ─── シリアライゼーション ───

/** JSON シリアライズ */
function serializeJson(data: unknown): WireData {
  const start = performance.now();
  const raw = JSON.stringify(data, null, 0);
  const elapsed = performance.now() - start;
  return {
    format: "json",
    raw,
    sizeBytes: new TextEncoder().encode(raw).length,
    parseTimeMs: Math.max(0.01, elapsed),
  };
}

/** XML シリアライズ（XML-RPC用） */
function serializeXml(data: XmlRpcRequest | XmlRpcResponse): WireData {
  const start = performance.now();
  let xml: string;

  if ("methodName" in data) {
    // リクエスト
    xml = `<?xml version="1.0"?>\n<methodCall>\n  <methodName>${data.methodName}</methodName>\n  <params>\n${data.params.map(p => `    <param>${xmlValue(p)}</param>`).join("\n")}\n  </params>\n</methodCall>`;
  } else {
    // レスポンス
    if (data.fault) {
      xml = `<?xml version="1.0"?>\n<methodResponse>\n  <fault>\n    <value><struct>\n      <member><name>faultCode</name><value><int>${data.fault.faultCode}</int></value></member>\n      <member><name>faultString</name><value><string>${escapeXml(data.fault.faultString)}</string></value></member>\n    </struct></value>\n  </fault>\n</methodResponse>`;
    } else {
      xml = `<?xml version="1.0"?>\n<methodResponse>\n  <params>\n${(data.params ?? []).map(p => `    <param>${xmlValue(p)}</param>`).join("\n")}\n  </params>\n</methodResponse>`;
    }
  }

  const elapsed = performance.now() - start;
  return {
    format: "xml",
    raw: xml,
    sizeBytes: new TextEncoder().encode(xml).length,
    parseTimeMs: Math.max(0.01, elapsed),
  };
}

/** XML値のシリアライズ */
function xmlValue(v: XmlRpcValue): string {
  switch (v.type) {
    case "int": return `<value><int>${v.value}</int></value>`;
    case "double": return `<value><double>${v.value}</double></value>`;
    case "boolean": return `<value><boolean>${v.value ? 1 : 0}</boolean></value>`;
    case "string": return `<value><string>${escapeXml(v.value)}</string></value>`;
    case "dateTime": return `<value><dateTime.iso8601>${v.value}</dateTime.iso8601></value>`;
    case "base64": return `<value><base64>${v.value}</base64></value>`;
    case "array":
      return `<value><array><data>${v.value.map(xmlValue).join("")}</data></array></value>`;
    case "struct": {
      const members = Object.entries(v.value).map(
        ([k, sv]) => `<member><name>${k}</name>${xmlValue(sv)}</member>`
      ).join("");
      return `<value><struct>${members}</struct></value>`;
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Protobuf風シリアライズ（バイナリ模擬） */
function serializeProtobuf(msg: GrpcMessage): WireData {
  const start = performance.now();
  // フィールドをTLV風にエンコード（シミュレーション）
  const parts: string[] = [];
  for (const f of msg.fields) {
    const wireType = f.type === "string" ? 2 : f.type === "bytes" ? 2 : 0;
    const val = String(f.value);
    parts.push(`[${f.number}:${wireType}]${val}`);
  }
  const raw = `grpc:${msg.service}/${msg.method}|${parts.join(",")}`;
  const elapsed = performance.now() - start;
  // Protobufはバイナリのため通常JSONより小さい（0.6倍と仮定）
  const jsonSize = new TextEncoder().encode(JSON.stringify(msg)).length;
  return {
    format: "protobuf",
    raw,
    sizeBytes: Math.ceil(jsonSize * 0.6),
    parseTimeMs: Math.max(0.01, elapsed),
  };
}

/** プロトコルに応じたトランスポート取得 */
function getTransport(protocol: RpcProtocol): Transport {
  switch (protocol) {
    case "grpc": return "http2";
    case "json_rpc": return "http1";
    case "xml_rpc": return "http1";
    case "trpc": return "http1";
  }
}

// ─── ネットワークシミュレーション ───

/** ネットワーク遅延計算 */
function calcLatency(net: NetworkCondition): number {
  const jitter = (Math.random() - 0.5) * 2 * net.jitter;
  return Math.max(0, net.latency + jitter);
}

/** パケットロス判定 */
function isLost(net: NetworkCondition): boolean {
  return Math.random() < net.lossRate;
}

// ─── JSON-RPC 2.0 ───

/** JSON-RPCリクエスト構築 */
function buildJsonRpcRequest(
  method: string,
  params: unknown,
  id: number | string | null,
): JsonRpcRequest {
  return { jsonrpc: "2.0", method, params: params as JsonRpcRequest["params"], id };
}

/** JSON-RPCレスポンス構築 */
function buildJsonRpcResponse(
  id: number | string | null,
  result?: unknown,
  error?: JsonRpcError,
): JsonRpcResponse {
  const res: JsonRpcResponse = { jsonrpc: "2.0", id };
  if (error) res.error = error;
  else res.result = result;
  return res;
}

/** JSON-RPC呼び出し処理 */
function processJsonRpc(
  call: RpcCall,
  services: RpcService[],
  events: SimEvent[],
  time: number,
): { result?: unknown; error?: { code: number | string; message: string }; reqWire: WireData; resWire: WireData } {
  // リクエスト構築
  const rpcReq = buildJsonRpcRequest(
    `${call.service}.${call.method}`,
    call.params,
    1,
  );

  events.push({ time, type: "serialize", protocol: "json_rpc", message: "JSON-RPCリクエストをシリアライズ" });
  const reqWire = serializeJson(rpcReq);

  events.push({ time, type: "send", protocol: "json_rpc", message: `リクエスト送信 (${reqWire.sizeBytes} bytes)`, detail: reqWire.raw });

  // メソッド解決
  const method = resolveMethod(services, call.service, call.method);
  events.push({ time, type: "dispatch", protocol: "json_rpc", message: `メソッド解決: ${call.service}.${call.method}` });

  let rpcRes: JsonRpcResponse;
  if (!method) {
    rpcRes = buildJsonRpcResponse(1, undefined, JSON_RPC_ERRORS.METHOD_NOT_FOUND);
    events.push({ time, type: "error", protocol: "json_rpc", message: `メソッド未検出: ${call.method}` });
  } else {
    try {
      events.push({ time, type: "execute", protocol: "json_rpc", message: `${call.method} 実行中` });
      const result = method.handler(call.params);
      rpcRes = buildJsonRpcResponse(1, result);
      events.push({ time, type: "respond", protocol: "json_rpc", message: "実行成功" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      rpcRes = buildJsonRpcResponse(1, undefined, { code: JSON_RPC_ERRORS.INTERNAL_ERROR.code, message: msg });
      events.push({ time, type: "error", protocol: "json_rpc", message: `実行エラー: ${msg}` });
    }
  }

  events.push({ time, type: "serialize", protocol: "json_rpc", message: "JSON-RPCレスポンスをシリアライズ" });
  const resWire = serializeJson(rpcRes);

  events.push({ time, type: "receive", protocol: "json_rpc", message: `レスポンス受信 (${resWire.sizeBytes} bytes)`, detail: resWire.raw });

  if (rpcRes.error) {
    return { error: { code: rpcRes.error.code, message: rpcRes.error.message }, reqWire, resWire };
  }
  return { result: rpcRes.result, reqWire, resWire };
}

// ─── XML-RPC ───

/** JSの値をXmlRpcValueに変換 */
function toXmlRpcValue(v: unknown): XmlRpcValue {
  if (typeof v === "number") {
    return Number.isInteger(v) ? { type: "int", value: v } : { type: "double", value: v };
  }
  if (typeof v === "boolean") return { type: "boolean", value: v };
  if (typeof v === "string") return { type: "string", value: v };
  if (Array.isArray(v)) return { type: "array", value: v.map(toXmlRpcValue) };
  if (v && typeof v === "object") {
    const struct: Record<string, XmlRpcValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      struct[k] = toXmlRpcValue(val);
    }
    return { type: "struct", value: struct };
  }
  return { type: "string", value: String(v) };
}

/** XmlRpcValueからJSの値に変換 */
function fromXmlRpcValue(v: XmlRpcValue): unknown {
  switch (v.type) {
    case "int": case "double": case "boolean": case "string":
    case "dateTime": case "base64":
      return v.value;
    case "array":
      return v.value.map(fromXmlRpcValue);
    case "struct": {
      const obj: Record<string, unknown> = {};
      for (const [k, sv] of Object.entries(v.value)) {
        obj[k] = fromXmlRpcValue(sv);
      }
      return obj;
    }
  }
}

/** XML-RPC呼び出し処理 */
function processXmlRpc(
  call: RpcCall,
  services: RpcService[],
  events: SimEvent[],
  time: number,
): { result?: unknown; error?: { code: number | string; message: string }; reqWire: WireData; resWire: WireData } {
  // パラメータをXmlRpcValueに変換
  const params: XmlRpcValue[] = Array.isArray(call.params)
    ? (call.params as unknown[]).map(toXmlRpcValue)
    : call.params ? [toXmlRpcValue(call.params)] : [];

  const xmlReq: XmlRpcRequest = {
    methodName: `${call.service}.${call.method}`,
    params,
  };

  events.push({ time, type: "serialize", protocol: "xml_rpc", message: "XML-RPCリクエストをXMLにシリアライズ" });
  const reqWire = serializeXml(xmlReq);

  events.push({ time, type: "send", protocol: "xml_rpc", message: `リクエスト送信 (${reqWire.sizeBytes} bytes)`, detail: reqWire.raw.slice(0, 200) });

  const method = resolveMethod(services, call.service, call.method);
  events.push({ time, type: "dispatch", protocol: "xml_rpc", message: `メソッド解決: ${call.service}.${call.method}` });

  let xmlRes: XmlRpcResponse;
  if (!method) {
    xmlRes = { fault: { faultCode: -1, faultString: `Method not found: ${call.method}` } };
    events.push({ time, type: "error", protocol: "xml_rpc", message: `メソッド未検出: ${call.method}` });
  } else {
    try {
      events.push({ time, type: "execute", protocol: "xml_rpc", message: `${call.method} 実行中` });
      // パラメータを単一オブジェクトに復元
      const paramObj = params.length === 1 ? fromXmlRpcValue(params[0]) : fromXmlRpcValue({ type: "array", value: params } as XmlRpcValue);
      const result = method.handler(paramObj);
      xmlRes = { params: [toXmlRpcValue(result)] };
      events.push({ time, type: "respond", protocol: "xml_rpc", message: "実行成功" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      xmlRes = { fault: { faultCode: -1, faultString: msg } };
      events.push({ time, type: "error", protocol: "xml_rpc", message: `実行エラー: ${msg}` });
    }
  }

  events.push({ time, type: "serialize", protocol: "xml_rpc", message: "XML-RPCレスポンスをXMLにシリアライズ" });
  const resWire = serializeXml(xmlRes);

  events.push({ time, type: "receive", protocol: "xml_rpc", message: `レスポンス受信 (${resWire.sizeBytes} bytes)`, detail: resWire.raw.slice(0, 200) });

  if (xmlRes.fault) {
    return { error: { code: xmlRes.fault.faultCode, message: xmlRes.fault.faultString }, reqWire, resWire };
  }
  const result = xmlRes.params?.[0] ? fromXmlRpcValue(xmlRes.params[0]) : undefined;
  return { result, reqWire, resWire };
}

// ─── gRPC ───

/** gRPCメッセージ構築 */
function buildGrpcMessage(service: string, method: string, params: unknown): GrpcMessage {
  const fields: GrpcMessage["fields"] = [];
  if (params && typeof params === "object") {
    let fieldNum = 1;
    for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
      const type = typeof value === "number" ? "int32"
        : typeof value === "string" ? "string"
        : typeof value === "boolean" ? "bool"
        : "bytes";
      fields.push({ name, type, number: fieldNum++, value });
    }
  }
  return { service, method, fields };
}

/** gRPCストリームメッセージ生成 */
function generateStreamMessages(
  callType: GrpcCallType,
  result: unknown,
): Array<{ direction: "send" | "recv"; data: unknown; index: number }> {
  const messages: Array<{ direction: "send" | "recv"; data: unknown; index: number }> = [];

  if (callType === "server_stream") {
    // サーバーストリーム: 結果が配列なら各要素を個別メッセージとして送信
    const items = Array.isArray(result) ? result : [result];
    items.forEach((item, i) => {
      messages.push({ direction: "recv", data: item, index: i });
    });
  } else if (callType === "client_stream") {
    // クライアントストリーム: クライアントが複数メッセージ送信→サーバーが1レスポンス
    messages.push({ direction: "send", data: { chunk: 1 }, index: 0 });
    messages.push({ direction: "send", data: { chunk: 2 }, index: 1 });
    messages.push({ direction: "send", data: { chunk: 3 }, index: 2 });
    messages.push({ direction: "recv", data: result, index: 3 });
  } else if (callType === "bidi_stream") {
    // 双方向ストリーム
    const items = Array.isArray(result) ? result : [result];
    items.forEach((item, i) => {
      messages.push({ direction: "send", data: { request: i }, index: i * 2 });
      messages.push({ direction: "recv", data: item, index: i * 2 + 1 });
    });
  }

  return messages;
}

/** gRPC呼び出し処理 */
function processGrpc(
  call: RpcCall,
  services: RpcService[],
  events: SimEvent[],
  time: number,
): { result?: unknown; error?: { code: number | string; message: string }; reqWire: WireData; resWire: WireData; streamMessages?: RpcCallResult["streamMessages"] } {
  const callType = call.callType ?? "unary";
  const grpcMsg = buildGrpcMessage(call.service, call.method, call.params);

  events.push({ time, type: "serialize", protocol: "grpc", message: `gRPCリクエストをProtobufにシリアライズ (${callType})` });
  const reqWire = serializeProtobuf(grpcMsg);

  events.push({ time, type: "send", protocol: "grpc", message: `HTTP/2フレーム送信 (${reqWire.sizeBytes} bytes)`, detail: `${call.service}/${call.method}` });

  const method = resolveMethod(services, call.service, call.method);
  events.push({ time, type: "dispatch", protocol: "grpc", message: `gRPCメソッド解決: ${call.service}/${call.method}` });

  if (!method) {
    const statusCode: GrpcStatusCode = 12; // UNIMPLEMENTED
    const statusName = GRPC_STATUS_NAMES[statusCode];
    events.push({ time, type: "error", protocol: "grpc", message: `gRPCステータス: ${statusCode} ${statusName}` });

    const errMsg = buildGrpcMessage(call.service, call.method, { status: statusCode, message: statusName });
    const resWire = serializeProtobuf(errMsg);

    return { error: { code: statusCode, message: statusName }, reqWire, resWire };
  }

  try {
    events.push({ time, type: "execute", protocol: "grpc", message: `${call.method} 実行中 (${callType})` });
    const result = method.handler(call.params);

    let streamMessages: RpcCallResult["streamMessages"];
    if (callType !== "unary") {
      streamMessages = generateStreamMessages(callType, result);
      for (const sm of streamMessages) {
        events.push({
          time,
          type: "stream_msg",
          protocol: "grpc",
          message: `ストリーム ${sm.direction === "send" ? "送信" : "受信"} #${sm.index}`,
          detail: JSON.stringify(sm.data).slice(0, 100),
        });
      }
    }

    events.push({ time, type: "respond", protocol: "grpc", message: `gRPCステータス: 0 OK` });

    const resMsg = buildGrpcMessage(call.service, call.method, result && typeof result === "object" ? result as Record<string, unknown> : { value: result });
    const resWire = serializeProtobuf(resMsg);

    events.push({ time, type: "receive", protocol: "grpc", message: `レスポンス受信 (${resWire.sizeBytes} bytes)` });

    return { result, reqWire, resWire, streamMessages };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const statusCode: GrpcStatusCode = 13; // INTERNAL
    events.push({ time, type: "error", protocol: "grpc", message: `gRPCステータス: ${statusCode} INTERNAL - ${msg}` });

    const errMsg = buildGrpcMessage(call.service, call.method, { status: statusCode, message: msg });
    const resWire = serializeProtobuf(errMsg);

    return { error: { code: statusCode, message: msg }, reqWire, resWire };
  }
}

// ─── tRPC ───

/** tRPCリクエスト構築 */
function buildTrpcRequest(
  type: TrpcProcedureType,
  path: string,
  input?: unknown,
): TrpcRequest {
  return { type, path, input };
}

/** tRPCレスポンス構築 */
function buildTrpcResponse(
  result?: unknown,
  error?: { code: string; message: string; data?: unknown },
): TrpcResponse {
  if (error) return { error };
  return { result: { data: result } };
}

/** tRPCプロシージャタイプ推定 */
function inferTrpcType(method: string): TrpcProcedureType {
  if (method.startsWith("get") || method.startsWith("list") || method.startsWith("find")) return "query";
  if (method.startsWith("create") || method.startsWith("update") || method.startsWith("delete")) return "mutation";
  return "query";
}

/** tRPC呼び出し処理 */
function processTrpc(
  call: RpcCall,
  services: RpcService[],
  events: SimEvent[],
  time: number,
): { result?: unknown; error?: { code: number | string; message: string }; reqWire: WireData; resWire: WireData } {
  const procType = inferTrpcType(call.method);
  const path = `${call.service}.${call.method}`;
  buildTrpcRequest(procType, path, call.params);

  events.push({ time, type: "serialize", protocol: "trpc", message: `tRPCリクエスト構築 (${procType})` });

  // tRPCはクエリならGETパラメータ、ミューテーションならPOSTボディ
  let reqRaw: string;
  if (procType === "query") {
    const input = call.params ? encodeURIComponent(JSON.stringify(call.params)) : "";
    reqRaw = `GET /api/trpc/${path}?input=${input}`;
  } else {
    reqRaw = `POST /api/trpc/${path}\n${JSON.stringify({ json: call.params })}`;
  }
  const reqWire: WireData = {
    format: "json",
    raw: reqRaw,
    sizeBytes: new TextEncoder().encode(reqRaw).length,
    parseTimeMs: 0.01,
  };

  events.push({ time, type: "send", protocol: "trpc", message: `${procType === "query" ? "GET" : "POST"} /api/trpc/${path} (${reqWire.sizeBytes} bytes)` });

  const method = resolveMethod(services, call.service, call.method);
  events.push({ time, type: "dispatch", protocol: "trpc", message: `プロシージャ解決: ${path}` });

  let trpcRes: TrpcResponse;
  if (!method) {
    trpcRes = buildTrpcResponse(undefined, { code: "NOT_FOUND", message: `Procedure not found: ${path}` });
    events.push({ time, type: "error", protocol: "trpc", message: `プロシージャ未検出: ${path}` });
  } else {
    try {
      events.push({ time, type: "execute", protocol: "trpc", message: `${call.method} 実行中 (${procType})` });
      const result = method.handler(call.params);
      trpcRes = buildTrpcResponse(result);
      events.push({ time, type: "respond", protocol: "trpc", message: "実行成功" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      trpcRes = buildTrpcResponse(undefined, { code: "INTERNAL_SERVER_ERROR", message: msg });
      events.push({ time, type: "error", protocol: "trpc", message: `実行エラー: ${msg}` });
    }
  }

  events.push({ time, type: "serialize", protocol: "trpc", message: "tRPCレスポンスをシリアライズ" });
  const resWire = serializeJson(trpcRes);

  events.push({ time, type: "receive", protocol: "trpc", message: `レスポンス受信 (${resWire.sizeBytes} bytes)` });

  if (trpcRes.error) {
    return { error: { code: trpcRes.error.code, message: trpcRes.error.message }, reqWire, resWire };
  }
  return { result: trpcRes.result?.data, reqWire, resWire };
}

// ─── 呼び出しディスパッチ ───

/** 単一RPC呼び出し実行 */
function executeCall(
  call: RpcCall,
  network: NetworkCondition,
  services: RpcService[],
  events: SimEvent[],
  baseTime: number,
): RpcCallResult {
  const transport = call.transport ?? getTransport(call.protocol);
  const latency = calcLatency(network);
  const time = baseTime;

  events.push({
    time,
    type: "info",
    protocol: call.protocol,
    message: `RPC呼び出し開始: ${call.protocol} via ${transport}`,
    detail: `${call.service}.${call.method}`,
  });

  // パケットロス判定
  if (isLost(network)) {
    events.push({ time, type: "error", protocol: call.protocol, message: "パケットロス発生 - タイムアウト" });
    const emptyWire: WireData = { format: "json", raw: "", sizeBytes: 0, parseTimeMs: 0 };
    return {
      call: { ...call, transport },
      requestWire: emptyWire,
      responseWire: emptyWire,
      error: { code: "TIMEOUT", message: "Network packet lost" },
      duration: latency * 3, // タイムアウト
      success: false,
    };
  }

  let processed: { result?: unknown; error?: { code: number | string; message: string }; reqWire: WireData; resWire: WireData; streamMessages?: RpcCallResult["streamMessages"] };

  switch (call.protocol) {
    case "json_rpc":
      processed = processJsonRpc(call, services, events, time);
      break;
    case "xml_rpc":
      processed = processXmlRpc(call, services, events, time);
      break;
    case "grpc":
      processed = processGrpc(call, services, events, time);
      break;
    case "trpc":
      processed = processTrpc(call, services, events, time);
      break;
  }

  const duration = latency + processed.reqWire.parseTimeMs + processed.resWire.parseTimeMs;

  return {
    call: { ...call, transport },
    requestWire: processed.reqWire,
    responseWire: processed.resWire,
    result: processed.result,
    error: processed.error,
    streamMessages: processed.streamMessages,
    duration,
    success: !processed.error,
  };
}

// ─── バッチ処理（JSON-RPC） ───

/** JSON-RPCバッチ処理 */
function executeBatch(
  calls: RpcCall[],
  network: NetworkCondition,
  services: RpcService[],
  events: SimEvent[],
  baseTime: number,
): RpcCallResult[] {
  events.push({
    time: baseTime,
    type: "batch",
    protocol: "json_rpc",
    message: `バッチリクエスト開始 (${calls.length}件)`,
  });

  // バッチリクエスト構築
  const batchReqs = calls.map((c, i) =>
    buildJsonRpcRequest(`${c.service}.${c.method}`, c.params, i + 1)
  );

  const batchReqWire = serializeJson(batchReqs);
  events.push({
    time: baseTime,
    type: "serialize",
    protocol: "json_rpc",
    message: `バッチリクエストをシリアライズ (${batchReqWire.sizeBytes} bytes, ${calls.length}件)`,
  });

  // 各呼び出しを個別実行（結果収集用）
  const results: RpcCallResult[] = [];
  const batchResponses: JsonRpcResponse[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const method = resolveMethod(services, call.service, call.method);

    let rpcRes: JsonRpcResponse;
    if (!method) {
      rpcRes = buildJsonRpcResponse(i + 1, undefined, JSON_RPC_ERRORS.METHOD_NOT_FOUND);
    } else {
      try {
        const result = method.handler(call.params);
        rpcRes = buildJsonRpcResponse(i + 1, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        rpcRes = buildJsonRpcResponse(i + 1, undefined, { code: JSON_RPC_ERRORS.INTERNAL_ERROR.code, message: msg });
      }
    }
    batchResponses.push(rpcRes);
  }

  const batchResWire = serializeJson(batchResponses);
  const latency = calcLatency(network);
  const duration = latency + batchReqWire.parseTimeMs + batchResWire.parseTimeMs;

  events.push({
    time: baseTime,
    type: "batch",
    protocol: "json_rpc",
    message: `バッチレスポンス受信 (${batchResWire.sizeBytes} bytes, ${calls.length}件)`,
  });

  // 個別結果にマッピング
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const rpcRes = batchResponses[i];
    results.push({
      call: { ...call, batch: true },
      requestWire: batchReqWire,
      responseWire: batchResWire,
      result: rpcRes.result,
      error: rpcRes.error ? { code: rpcRes.error.code, message: rpcRes.error.message } : undefined,
      duration,
      success: !rpcRes.error,
    });
  }

  return results;
}

// ─── Notification（JSON-RPC） ───

/** JSON-RPC Notification処理 */
function processNotification(
  protocol: "json_rpc",
  method: string,
  params: unknown,
  events: SimEvent[],
  time: number,
): RpcCallResult {
  const req = buildJsonRpcRequest(method, params, null);

  events.push({ time, type: "notification", protocol, message: `Notification送信: ${method}` });

  const reqWire = serializeJson(req);
  events.push({ time, type: "send", protocol, message: `Notification送信 (${reqWire.sizeBytes} bytes, レスポンスなし)` });

  // Notificationはレスポンスなし
  const emptyWire: WireData = { format: "json", raw: "", sizeBytes: 0, parseTimeMs: 0 };

  return {
    call: { protocol, transport: "http1", service: "", method, params },
    requestWire: reqWire,
    responseWire: emptyWire,
    duration: reqWire.parseTimeMs,
    success: true,
  };
}

// ─── メインシミュレーション ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const services = defaultServices();
  const events: SimEvent[] = [];
  const callResults: RpcCallResult[] = [];
  let time = 0;

  for (const op of ops) {
    switch (op.type) {
      case "call": {
        const result = executeCall(op.call, op.network, services, events, time);
        callResults.push(result);
        time += result.duration;
        break;
      }
      case "batch_call": {
        const results = executeBatch(op.calls, op.network, services, events, time);
        callResults.push(...results);
        if (results.length > 0) time += results[0].duration;
        break;
      }
      case "notification": {
        const result = processNotification(op.protocol, op.method, op.params, events, time);
        callResults.push(result);
        time += result.duration;
        break;
      }
    }
  }

  const totalBytes = callResults.reduce(
    (sum, r) => sum + r.requestWire.sizeBytes + r.responseWire.sizeBytes, 0
  );

  return {
    callResults,
    events,
    totalDuration: time,
    totalBytes,
  };
}

// ─── ヘルパー（プリセット用） ───

/** RPC呼び出し作成ヘルパー */
export function mkCall(
  protocol: RpcProtocol,
  service: string,
  method: string,
  params: unknown,
  opts?: { callType?: GrpcCallType; batch?: boolean },
): RpcCall {
  return {
    protocol,
    transport: getTransport(protocol),
    service,
    method,
    params,
    callType: opts?.callType,
    batch: opts?.batch,
  };
}

/** ネットワーク条件作成ヘルパー */
export function mkNetwork(latency = 10, jitter = 2, lossRate = 0): NetworkCondition {
  return { latency, jitter, lossRate };
}
