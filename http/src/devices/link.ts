/**
 * link.ts — L1 仮想リンク（物理的な接続のエミュレーション）
 *
 * 2つの NIC を結び、一方に送られた Ethernet フレームを他方に届ける。
 * 実際のケーブル/ハブに相当する。
 */

// フレームを受け取るコールバック
export type FrameReceiver = (frame: Uint8Array, fromLinkId: string) => void;

export class Link {
  readonly id: string;
  private endpoints: { receiver: FrameReceiver; name: string }[] = [];

  constructor(id: string) {
    this.id = id;
  }

  // エンドポイント（NIC）を接続
  attach(name: string, receiver: FrameReceiver): void {
    this.endpoints.push({ receiver, name });
  }

  // フレームを送信（送信元以外の全エンドポイントに届ける＝ハブ動作）
  transmit(frame: Uint8Array, senderName: string): void {
    for (const ep of this.endpoints) {
      if (ep.name !== senderName) {
        // コピーを渡す（バッファ共有を防ぐ）
        ep.receiver(frame.slice(), this.id);
      }
    }
  }
}
