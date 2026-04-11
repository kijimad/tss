/* RPC シミュレーター 型定義 */

// ─── RPCプロトコル種別 ───

/** RPCプロトコル */
export type RpcProtocol = "json_rpc" | "xml_rpc" | "grpc" | "trpc";

/** シリアライゼーション形式 */
export type SerializationFormat = "json" | "xml" | "protobuf";

/** トランスポート */
export type Transport = "http1" | "http2" | "websocket";

// ─── メッセージ定義 ───

/** JSON-RPC リクエスト */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[] | Record<string, unknown>;
  id: number | string | null;  // nullならNotification
}

/** JSON-RPC レスポンス */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: number | string | null;
}

/** JSON-RPC エラー */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPCエラーコード定義 */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
} as const;

/** XML-RPC リクエスト */
export interface XmlRpcRequest {
  methodName: string;
  params: XmlRpcValue[];
}

/** XML-RPC レスポンス */
export interface XmlRpcResponse {
  params?: XmlRpcValue[];
  fault?: { faultCode: number; faultString: string };
}

/** XML-RPC 値型 */
export type XmlRpcValue =
  | { type: "int"; value: number }
  | { type: "double"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "string"; value: string }
  | { type: "dateTime"; value: string }
  | { type: "base64"; value: string }
  | { type: "array"; value: XmlRpcValue[] }
  | { type: "struct"; value: Record<string, XmlRpcValue> };

/** gRPC メッセージ */
export interface GrpcMessage {
  service: string;
  method: string;
  /** Protobufフィールド定義 */
  fields: Array<{ name: string; type: string; number: number; value: unknown }>;
}

/** gRPC呼び出しタイプ */
export type GrpcCallType = "unary" | "server_stream" | "client_stream" | "bidi_stream";

/** gRPC メタデータ */
export interface GrpcMetadata {
  [key: string]: string;
}

/** gRPC ステータスコード */
export type GrpcStatusCode =
  | 0   // OK
  | 1   // CANCELLED
  | 2   // UNKNOWN
  | 3   // INVALID_ARGUMENT
  | 4   // DEADLINE_EXCEEDED
  | 5   // NOT_FOUND
  | 12  // UNIMPLEMENTED
  | 13  // INTERNAL
  | 14; // UNAVAILABLE

export const GRPC_STATUS_NAMES: Record<GrpcStatusCode, string> = {
  0: "OK", 1: "CANCELLED", 2: "UNKNOWN",
  3: "INVALID_ARGUMENT", 4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND", 12: "UNIMPLEMENTED",
  13: "INTERNAL", 14: "UNAVAILABLE",
};

/** tRPC プロシージャタイプ */
export type TrpcProcedureType = "query" | "mutation" | "subscription";

/** tRPC リクエスト */
export interface TrpcRequest {
  type: TrpcProcedureType;
  path: string;
  input?: unknown;
}

/** tRPC レスポンス */
export interface TrpcResponse {
  result?: { data: unknown };
  error?: { code: string; message: string; data?: unknown };
}

// ─── サービス定義 ───

/** RPCサービスメソッド */
export interface RpcMethod {
  name: string;
  /** 入力パラメータ定義 */
  params: Array<{ name: string; type: string }>;
  /** 戻り値の型 */
  returnType: string;
  /** ハンドラ（シミュレーション用） */
  handler: (params: unknown) => unknown;
}

/** RPCサービス */
export interface RpcService {
  name: string;
  methods: RpcMethod[];
}

// ─── ネットワークシミュレーション ───

/** ネットワーク条件 */
export interface NetworkCondition {
  latency: number;   // ms
  jitter: number;    // ms
  lossRate: number;   // 0-1
}

/** ワイヤフォーマット（シリアライズ結果） */
export interface WireData {
  format: SerializationFormat;
  raw: string;
  sizeBytes: number;
  parseTimeMs: number;
}

// ─── シミュレーション ───

/** RPC呼び出し */
export interface RpcCall {
  protocol: RpcProtocol;
  transport: Transport;
  service: string;
  method: string;
  params: unknown;
  /** gRPCストリームタイプ */
  callType?: GrpcCallType;
  /** バッチ呼び出し */
  batch?: boolean;
}

/** RPC呼び出し結果 */
export interface RpcCallResult {
  call: RpcCall;
  /** リクエストのワイヤデータ */
  requestWire: WireData;
  /** レスポンスのワイヤデータ */
  responseWire: WireData;
  /** 結果 */
  result?: unknown;
  /** エラー */
  error?: { code: number | string; message: string };
  /** ストリームメッセージ（gRPC streaming） */
  streamMessages?: Array<{ direction: "send" | "recv"; data: unknown; index: number }>;
  /** 所要時間(ms) */
  duration: number;
  /** 成功 */
  success: boolean;
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "call"; call: RpcCall; network: NetworkCondition }
  | { type: "batch_call"; calls: RpcCall[]; network: NetworkCondition }
  | { type: "notification"; protocol: "json_rpc"; method: string; params: unknown };

/** イベント種別 */
export type EventType =
  | "serialize" | "send" | "receive" | "deserialize"
  | "dispatch" | "execute" | "respond" | "error"
  | "stream_msg" | "batch" | "notification" | "info";

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  type: EventType;
  protocol: RpcProtocol;
  message: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  callResults: RpcCallResult[];
  events: SimEvent[];
  totalDuration: number;
  totalBytes: number;
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
