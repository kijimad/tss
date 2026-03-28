/**
 * types.ts — ネットワークシミュレータの型定義
 *
 * 構成図:
 *
 *   [PC]  ──── [ルータ] ──── [インターネット] ──── [サーバ]
 *   192.168.1.10   192.168.1.1 / 203.0.113.1       93.184.216.34
 *                       NAT
 *
 * パケットがこの経路を通る様子をアニメーションで表示する。
 * 各レイヤーでヘッダが付け外しされる過程も可視化する。
 */

// =====================================================
// ネットワーク機器
// =====================================================

// 機器の種類
export const DeviceType = {
        PC: "pc",
        Router: "router",
        Internet: "internet",  // ISP/バックボーンを抽象化
        Server: "server",
} as const;
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];

// 機器の定義
export interface NetworkDevice {
        id: string;
        type: DeviceType;
        name: string;
        ip: string;
        // 描画位置（キャンバス上の座標）
        x: number;
        y: number;
}

// =====================================================
// プロトコルレイヤー
// =====================================================

// イーサネットフレーム（L2）
export interface EthernetFrame {
        srcMac: string;
        dstMac: string;
        type: number;       // 0x0800 = IPv4
        payload: IpPacket;
}

// IPパケット（L3）
export interface IpPacket {
        version: 4;
        srcIp: string;
        dstIp: string;
        ttl: number;
        protocol: number;   // 6=TCP
        payload: TcpSegment;
}

// TCPセグメント（L4）
export interface TcpSegment {
        srcPort: number;
        dstPort: number;
        seqNum: number;
        ackNum: number;
        flags: TcpFlags;
        payload: string;    // HTTPデータ（テキスト）
}

export interface TcpFlags {
        syn: boolean;
        ack: boolean;
        fin: boolean;
        rst: boolean;
        psh: boolean;
}

// HTTPリクエスト/レスポンス（L7）
export interface HttpRequest {
        method: string;
        path: string;
        host: string;
        headers: Record<string, string>;
        body: string;
}

export interface HttpResponse {
        statusCode: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
}

// =====================================================
// シミュレーション
// =====================================================

// パケットの移動を表すイベント
export interface PacketEvent {
        id: number;
        fromDevice: string;    // 機器ID
        toDevice: string;      // 機器ID
        // パケットの中身（各レイヤー）
        ethernet: EthernetFrame;
        // 表示用の要約
        summary: string;
        // このパケットの役割
        label: string;         // "SYN", "SYN+ACK", "ACK", "HTTP GET", "HTTP 200", "FIN" 等
        direction: "request" | "response";
        // タイミング
        timestamp: number;
        // 色（種類で分ける）
        color: string;
}

// TCP接続状態
export const TcpState = {
        Closed: "CLOSED",
        SynSent: "SYN_SENT",
        SynReceived: "SYN_RECEIVED",
        Established: "ESTABLISHED",
        FinWait1: "FIN_WAIT_1",
        FinWait2: "FIN_WAIT_2",
        TimeWait: "TIME_WAIT",
} as const;
export type TcpState = (typeof TcpState)[keyof typeof TcpState];

// シミュレーション全体の結果
export interface SimulationResult {
        events: PacketEvent[];
        tcpStates: { state: TcpState; timestamp: number }[];
        httpRequest: HttpRequest;
        httpResponse: HttpResponse;
}
