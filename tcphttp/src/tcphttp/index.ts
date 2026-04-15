/**
 * @module tcphttp
 * TCP/HTTPシミュレーションライブラリの公開エントリポイント。
 * シミュレーションエンジン、プリセット、および全型定義を再エクスポートする。
 */

export { runSimulation } from "./engine.js";
export { presets } from "./presets.js";
export type {
  TcpState, TcpFlags, TcpSegment, TcpSocket, SocketAddr,
  HttpMethod, HttpRequest, HttpResponse,
  SimOp, EventType, SimEvent, SimulationResult, Preset,
} from "./types.js";
