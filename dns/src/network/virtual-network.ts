/**
 * virtual-network.ts — 仮想ネットワーク
 *
 * 実際のUDPソケットの代わりに、メモリ上でパケットを配送する。
 * IP アドレスでサーバを識別し、送信されたパケットを対応するサーバに届ける。
 *
 *   クライアント → sendPacket(dest="198.41.0.4", data) → ルートサーバが受け取る
 *                                                         ↓
 *   クライアント ← 応答パケット ←─────────────────── ルートサーバが応答を返す
 *
 * 遅延シミュレーションはオプション（デフォルト0ms）。
 */
import type { UdpPacket, NetworkEvent } from "../protocol/types.js";

// パケットを受信するハンドラ
export type PacketHandler = (packet: UdpPacket) => UdpPacket | undefined;

export class VirtualNetwork {
  // IP → パケットハンドラ のマッピング
  private servers = new Map<string, PacketHandler>();

  // トレース用イベントログ
  private events: NetworkEvent[] = [];
  private startTime = 0;

  // 遅延シミュレーション（ms）
  latencyMs = 0;

  // サーバを登録する
  registerServer(ip: string, handler: PacketHandler): void {
    this.servers.set(ip, handler);
  }

  // トレース開始
  startTrace(): void {
    this.events = [];
    this.startTime = performance.now();
  }

  // トレース取得
  getEvents(): NetworkEvent[] {
    return this.events;
  }

  // パケットを送信し、応答を受け取る
  async sendPacket(packet: UdpPacket): Promise<UdpPacket | undefined> {
    const handler = this.servers.get(packet.destination.ip);
    if (handler === undefined) {
      return undefined; // 宛先が存在しない
    }

    // 遅延シミュレーション
    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }

    // 応答を返す
    const response = handler(packet);
    return response;
  }

  // トレース付きパケット送信
  async sendPacketWithTrace(
    packet: UdpPacket,
    questionName: string,
    messageId: number,
  ): Promise<UdpPacket | undefined> {
    this.events.push({
      type: "udp_send",
      from: packet.source.ip,
      to: packet.destination.ip,
      messageId,
      questionName,
      timestamp: performance.now() - this.startTime,
    });

    const response = await this.sendPacket(packet);

    if (response !== undefined) {
      this.events.push({
        type: "udp_recv",
        from: packet.destination.ip,
        to: packet.source.ip,
        messageId,
        answerCount: 0, // デコード前なのでダミー値（呼び出し側で上書き可能）
        timestamp: performance.now() - this.startTime,
      });
    }

    return response;
  }
}
