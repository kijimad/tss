/**
 * @module engine
 * VLANシミュレーションのコアエンジンモジュール。
 * スイッチ、ホスト、フレームの生成ヘルパーと、
 * IEEE 802.1Qに基づくVLANフレーム転送シミュレーションロジックを提供する。
 * BFSキューベースでフレームの伝搬をエミュレートし、
 * MAC学習・フラッディング・ユニキャスト転送・VLANフィルタリングを再現する。
 */

import type {
  MacAddr, VlanId, Dot1QTag, EthernetFrame, SwitchPort,
  VlanEntry, VlanSwitch, Host, SimEvent, InjectFrame, SimulationResult,
} from "./types.js";

/**
 * MACアドレス生成ヘルパー。
 * 数値IDから "00:00:00:00:00:xx" 形式のMACアドレスを生成する。
 * @param id - MACアドレスの末尾に使用する数値（0〜255）
 * @returns 生成されたMACアドレス文字列
 */
export function mac(id: number): MacAddr {
  const hex = id.toString(16).padStart(2, "0");
  return `00:00:00:00:00:${hex}`;
}

/** ブロードキャストMACアドレス */
export const BROADCAST_MAC: MacAddr = "ff:ff:ff:ff:ff:ff";

/**
 * IEEE 802.1Qタグを生成する。
 * @param vid - VLAN ID
 * @param pcp - 優先度コードポイント（デフォルト: 0）
 * @param dei - 破棄適格インジケータ（デフォルト: 0）
 * @returns 生成された802.1Qタグオブジェクト
 */
export function makeTag(vid: VlanId, pcp = 0, dei = 0): Dot1QTag {
  return { tpid: 0x8100, pcp, dei, vid };
}

/**
 * イーサネットフレームを生成する。
 * @param src - 送信元MACアドレス
 * @param dst - 宛先MACアドレス
 * @param payload - ペイロードデータ
 * @param tag - オプションの802.1Qタグ
 * @returns 生成されたイーサネットフレーム
 */
export function makeFrame(src: MacAddr, dst: MacAddr, payload: string, tag?: Dot1QTag): EthernetFrame {
  return { src, dst, payload, ...(tag ? { tag } : {}) };
}

/**
 * アクセスモードのスイッチポートを生成する。
 * アクセスポートは単一のVLANに所属し、タグなしフレームのみを扱う。
 * @param id - ポート番号
 * @param vlan - 割り当てるVLAN ID
 * @returns 生成されたアクセスポート
 */
export function makeAccessPort(id: number, vlan: VlanId): SwitchPort {
  return { id, mode: "access", accessVlan: vlan, allowedVlans: [], nativeVlan: 1 };
}

/**
 * トランクモードのスイッチポートを生成する。
 * トランクポートは複数のVLANのフレームを802.1Qタグ付きで伝送する。
 * @param id - ポート番号
 * @param allowedVlans - 通過を許可するVLAN IDのリスト
 * @param nativeVlan - ネイティブVLAN ID（タグなしフレームに適用、デフォルト: 1）
 * @returns 生成されたトランクポート
 */
export function makeTrunkPort(id: number, allowedVlans: VlanId[], nativeVlan: VlanId = 1): SwitchPort {
  return { id, mode: "trunk", accessVlan: 1, allowedVlans, nativeVlan };
}

/**
 * VLANスイッチを生成する。
 * ポートとVLAN設定を持つL2スイッチインスタンスを作成する。
 * @param id - スイッチの一意識別子
 * @param name - スイッチの表示名
 * @param ports - スイッチポートの配列
 * @param vlans - VLAN定義の配列
 * @returns 生成されたVLANスイッチ
 */
export function createSwitch(
  id: string, name: string, ports: SwitchPort[], vlans: VlanEntry[],
): VlanSwitch {
  return { id, name, ports: ports.map((p) => ({ ...p })), macTable: [], vlans: [...vlans] };
}

/**
 * ホスト（エンドデバイス）を生成する。
 * @param id - ホストの一意識別子
 * @param name - ホストの表示名
 * @param macAddr - ホストのMACアドレス
 * @returns 生成されたホスト
 */
export function createHost(id: string, name: string, macAddr: MacAddr): Host {
  return { id, name, mac: macAddr };
}

/**
 * ホストをスイッチの指定ポートに接続する。
 * 双方向のリンク情報を設定する。
 * @param host - 接続するホスト
 * @param sw - 接続先スイッチ
 * @param portId - 接続先ポート番号
 */
export function connectHostToSwitch(host: Host, sw: VlanSwitch, portId: number): void {
  host.portLink = { deviceId: sw.id, portId };
  const port = sw.ports.find((p) => p.id === portId);
  if (port) port.link = { deviceId: host.id, portId: 0 };
}

/**
 * 2台のスイッチ間をトランクリンクで接続する。
 * 双方のポートに相互のリンク情報を設定する。
 * @param sw1 - 接続元スイッチ
 * @param portId1 - 接続元ポート番号
 * @param sw2 - 接続先スイッチ
 * @param portId2 - 接続先ポート番号
 */
export function connectSwitches(
  sw1: VlanSwitch, portId1: number, sw2: VlanSwitch, portId2: number,
): void {
  const p1 = sw1.ports.find((p) => p.id === portId1);
  const p2 = sw2.ports.find((p) => p.id === portId2);
  if (p1) p1.link = { deviceId: sw2.id, portId: portId2 };
  if (p2) p2.link = { deviceId: sw1.id, portId: portId1 };
}

/**
 * フレーム受信時のVLAN IDを決定する（イングレス処理）。
 * アクセスポートではポートに割り当てられたVLANを返し、
 * トランクポートではタグのVLAN IDまたはネイティブVLANを返す。
 * 許可されていないVLANの場合はnullを返す。
 * @param port - フレームを受信したポート
 * @param frame - 受信したイーサネットフレーム
 * @returns 決定されたVLAN ID、またはフィルタ対象の場合null
 */
function determineIngressVlan(port: SwitchPort, frame: EthernetFrame): VlanId | null {
  if (port.mode === "access") {
    // アクセスポートではタグを無視してポートのVLANを使用
    return port.accessVlan;
  }
  // トランクポート
  if (frame.tag) {
    // タグ付きフレーム：許可VLANか確認
    if (port.allowedVlans.includes(frame.tag.vid)) {
      return frame.tag.vid;
    }
    return null; // 許可されていないVLAN
  }
  // タグなしフレーム：ネイティブVLAN
  return port.nativeVlan;
}

/**
 * MACアドレスを学習してMACアドレステーブルに登録する。
 * 既存エントリがあればポートを更新し、新規の場合はエントリを追加してイベントを記録する。
 * @param sw - 学習を行うスイッチ
 * @param srcMac - 学習するMACアドレス
 * @param vlan - MACアドレスが属するVLAN ID
 * @param portId - MACアドレスが検出されたポート番号
 * @param events - イベントログ配列
 * @param step - 現在のシミュレーションステップ
 */
function learnMac(
  sw: VlanSwitch, srcMac: MacAddr, vlan: VlanId, portId: number, events: SimEvent[], step: number,
): void {
  const existing = sw.macTable.find((e) => e.mac === srcMac && e.vlan === vlan);
  if (existing) {
    existing.port = portId;
  } else {
    sw.macTable.push({ mac: srcMac, vlan, port: portId });
    events.push({
      step, type: "mac_learn", device: sw.name, port: portId, vlan,
      description: `MAC ${srcMac} をVLAN ${vlan} ポート${portId}に学習`,
    });
  }
}

/**
 * フレーム送出時の加工処理（イーグレス処理）。
 * アクセスポートではタグを除去し、トランクポートではVLANに応じてタグ付け/除去を行う。
 * VLANフィルタリングにより送出不可の場合はnullを返す。
 * @param port - 送出先ポート
 * @param frame - 加工対象のフレーム
 * @param vlan - フレームが属するVLAN ID
 * @returns 加工済みフレーム、または送出不可の場合null
 */
function egressFrame(port: SwitchPort, frame: EthernetFrame, vlan: VlanId): EthernetFrame | null {
  if (port.mode === "access") {
    if (port.accessVlan !== vlan) return null; // VLAN不一致
    // アクセスポートからはタグなしで送出
    const { tag: _tag, ...rest } = frame;
    return rest;
  }
  // トランクポート
  if (!port.allowedVlans.includes(vlan)) return null; // 許可されていないVLAN
  if (vlan === port.nativeVlan) {
    // ネイティブVLANはタグなしで送出
    const { tag: _tag, ...rest } = frame;
    return rest;
  }
  // タグ付きで送出
  return { ...frame, tag: makeTag(vlan) };
}

/**
 * BFSキューの要素。
 * 転送待ちフレームのスイッチ、受信ポート、フレーム内容、VLAN情報を保持する。
 */
interface QueueItem {
  switchId: string;
  portId: number;
  frame: EthernetFrame;
  vlan: VlanId;
}

/**
 * VLANシミュレーションを実行する。
 * 注入フレームをホストから送信し、スイッチ間のフレーム転送をBFSで処理する。
 * MAC学習、VLANフィルタリング、フラッディング、ユニキャスト転送を再現し、
 * 各処理ステップのイベントログを記録する。
 * @param switches - シミュレーション対象のスイッチ配列
 * @param hosts - シミュレーション対象のホスト配列
 * @param injections - 注入するフレームの配列
 * @returns シミュレーション結果（イベントログとスイッチの最終状態）
 */
export function runSimulation(
  switches: VlanSwitch[], hosts: Host[], injections: InjectFrame[],
): SimulationResult {
  const events: SimEvent[] = [];
  let step = 0;

  // デバイスマップ構築
  const switchMap = new Map<string, VlanSwitch>();
  for (const sw of switches) switchMap.set(sw.id, sw);
  const hostMap = new Map<string, Host>();
  for (const h of hosts) hostMap.set(h.id, h);

  const queue: QueueItem[] = [];

  // フレーム注入
  for (const inj of injections) {
    const host = hostMap.get(inj.fromHost);
    if (!host?.portLink) continue;

    const sw = switchMap.get(host.portLink.deviceId);
    if (!sw) continue;

    const port = sw.ports.find((p) => p.id === host.portLink!.portId);
    if (!port) continue;

    const vlan = determineIngressVlan(port, inj.frame);
    if (vlan === null) {
      events.push({
        step, type: "vlan_filter", device: sw.name, port: port.id,
        description: `フレームがVLANフィルタにより破棄（送信元: ${host.name}）`,
      });
      step++;
      continue;
    }

    events.push({
      step, type: "receive", device: sw.name, port: port.id, vlan,
      frame: inj.frame,
      description: `${host.name}からフレーム受信 (src=${inj.frame.src}, dst=${inj.frame.dst}, VLAN=${vlan})`,
    });

    if (port.mode === "access") {
      events.push({
        step, type: "tag_add", device: sw.name, port: port.id, vlan,
        description: `アクセスポート${port.id}でVLAN ${vlan}タグを内部付与`,
      });
    } else if (!inj.frame.tag) {
      events.push({
        step, type: "native_vlan", device: sw.name, port: port.id, vlan,
        description: `トランクポート${port.id}でネイティブVLAN ${vlan}を適用`,
      });
    }

    // MAC学習
    learnMac(sw, inj.frame.src, vlan, port.id, events, step);

    queue.push({ switchId: sw.id, portId: port.id, frame: inj.frame, vlan });
    step++;
  }

  // キュー処理（BFS）
  let iterations = 0;
  const MAX_ITERATIONS = 200;

  while (queue.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    const item = queue.shift()!;
    const sw = switchMap.get(item.switchId);
    if (!sw) continue;

    const isBroadcast = item.frame.dst === BROADCAST_MAC;

    // MACテーブル検索
    const macEntry = isBroadcast
      ? undefined
      : sw.macTable.find((e) => e.mac === item.frame.dst && e.vlan === item.vlan);

    if (isBroadcast || !macEntry) {
      // フラッディング：同一VLANの全ポート（受信ポート除く）に転送
      const eventType = isBroadcast ? "flood" as const : "flood" as const;
      events.push({
        step, type: eventType, device: sw.name, vlan: item.vlan,
        description: isBroadcast
          ? `ブロードキャストフレームをVLAN ${item.vlan}内でフラッディング`
          : `宛先MAC未学習のためVLAN ${item.vlan}内でフラッディング`,
      });

      for (const port of sw.ports) {
        if (port.id === item.portId) continue; // 受信ポートには送らない

        const outFrame = egressFrame(port, item.frame, item.vlan);
        if (!outFrame) continue;

        if (port.mode === "access") {
          events.push({
            step, type: "tag_remove", device: sw.name, port: port.id, vlan: item.vlan,
            description: `アクセスポート${port.id}からタグなしで送出`,
          });
        } else {
          const action = item.vlan === port.nativeVlan ? "ネイティブVLAN（タグなし）" : "タグ付き";
          events.push({
            step, type: "trunk_forward", device: sw.name, port: port.id, vlan: item.vlan,
            description: `トランクポート${port.id}から${action}で送出`,
          });
        }

        // 接続先へ配送
        deliverFrame(sw, port, outFrame, item.vlan, events, step, queue, switchMap, hostMap);
      }
    } else {
      // ユニキャスト転送
      const targetPort = sw.ports.find((p) => p.id === macEntry.port);
      if (!targetPort) continue;

      const outFrame = egressFrame(targetPort, item.frame, item.vlan);
      if (!outFrame) {
        events.push({
          step, type: "drop", device: sw.name, port: targetPort.id, vlan: item.vlan,
          description: `VLANフィルタにより破棄（ポート${targetPort.id}はVLAN ${item.vlan}に非対応）`,
        });
        step++;
        continue;
      }

      events.push({
        step, type: "forward", device: sw.name, port: targetPort.id, vlan: item.vlan,
        description: `MACテーブルヒット: ポート${targetPort.id}へユニキャスト転送 (VLAN ${item.vlan})`,
      });

      if (targetPort.mode === "access") {
        events.push({
          step, type: "tag_remove", device: sw.name, port: targetPort.id, vlan: item.vlan,
          description: `アクセスポート${targetPort.id}からタグなしで送出`,
        });
      }

      deliverFrame(sw, targetPort, outFrame, item.vlan, events, step, queue, switchMap, hostMap);
    }

    step++;
  }

  return { events, switches };
}

/**
 * フレームを接続先デバイスに配送するヘルパー関数。
 * 接続先がホストの場合はMACアドレスを照合して受信/破棄を判定し、
 * 接続先がスイッチの場合はイングレス処理を行いキューに追加する。
 * @param _sw - 送出元スイッチ（現在未使用）
 * @param port - フレームを送出するポート
 * @param frame - 送出するフレーム
 * @param _vlan - フレームのVLAN ID（現在未使用）
 * @param events - イベントログ配列
 * @param step - 現在のシミュレーションステップ
 * @param queue - BFS処理キュー
 * @param switchMap - スイッチIDからスイッチへのマップ
 * @param hostMap - ホストIDからホストへのマップ
 */
function deliverFrame(
  _sw: VlanSwitch,
  port: SwitchPort,
  frame: EthernetFrame,
  _vlan: VlanId,
  events: SimEvent[],
  step: number,
  queue: QueueItem[],
  switchMap: Map<string, VlanSwitch>,
  hostMap: Map<string, Host>,
): void {
  if (!port.link) return;

  const targetHost = hostMap.get(port.link.deviceId);
  if (targetHost) {
    // ホストへ配送
    const isMine = frame.dst === targetHost.mac || frame.dst === BROADCAST_MAC;
    if (isMine) {
      events.push({
        step, type: "receive", device: targetHost.name,
        description: `${targetHost.name}がフレームを受信 (payload=${frame.payload})`,
      });
    } else {
      events.push({
        step, type: "drop", device: targetHost.name,
        description: `${targetHost.name}は宛先MAC不一致のため破棄`,
      });
    }
    return;
  }

  const targetSw = switchMap.get(port.link.deviceId);
  if (targetSw) {
    // 隣接スイッチへ
    const inPort = targetSw.ports.find((p) => p.id === port.link!.portId);
    if (!inPort) return;

    const ingressVlan = determineIngressVlan(inPort, frame);
    if (ingressVlan === null) {
      events.push({
        step, type: "vlan_filter", device: targetSw.name, port: inPort.id,
        description: `${targetSw.name}のポート${inPort.id}でVLANフィルタにより破棄`,
      });
      return;
    }

    events.push({
      step, type: "receive", device: targetSw.name, port: inPort.id, vlan: ingressVlan,
      frame,
      description: `${targetSw.name}のポート${inPort.id}でフレーム受信 (VLAN=${ingressVlan})`,
    });

    // MAC学習
    learnMac(targetSw, frame.src, ingressVlan, inPort.id, events, step);

    queue.push({ switchId: targetSw.id, portId: inPort.id, frame, vlan: ingressVlan });
  }
}
