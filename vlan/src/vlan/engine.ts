import type {
  MacAddr, VlanId, Dot1QTag, EthernetFrame, SwitchPort,
  VlanEntry, VlanSwitch, Host, SimEvent, InjectFrame, SimulationResult,
} from "./types.js";

/** MACアドレス生成ヘルパー */
export function mac(id: number): MacAddr {
  const hex = id.toString(16).padStart(2, "0");
  return `00:00:00:00:00:${hex}`;
}

/** ブロードキャストMACアドレス */
export const BROADCAST_MAC: MacAddr = "ff:ff:ff:ff:ff:ff";

/** 802.1Qタグ生成 */
export function makeTag(vid: VlanId, pcp = 0, dei = 0): Dot1QTag {
  return { tpid: 0x8100, pcp, dei, vid };
}

/** フレーム生成 */
export function makeFrame(src: MacAddr, dst: MacAddr, payload: string, tag?: Dot1QTag): EthernetFrame {
  return { src, dst, payload, ...(tag ? { tag } : {}) };
}

/** アクセスポート生成 */
export function makeAccessPort(id: number, vlan: VlanId): SwitchPort {
  return { id, mode: "access", accessVlan: vlan, allowedVlans: [], nativeVlan: 1 };
}

/** トランクポート生成 */
export function makeTrunkPort(id: number, allowedVlans: VlanId[], nativeVlan: VlanId = 1): SwitchPort {
  return { id, mode: "trunk", accessVlan: 1, allowedVlans, nativeVlan };
}

/** スイッチ生成 */
export function createSwitch(
  id: string, name: string, ports: SwitchPort[], vlans: VlanEntry[],
): VlanSwitch {
  return { id, name, ports: ports.map((p) => ({ ...p })), macTable: [], vlans: [...vlans] };
}

/** ホスト生成 */
export function createHost(id: string, name: string, macAddr: MacAddr): Host {
  return { id, name, mac: macAddr };
}

/** ホストとスイッチポートを接続 */
export function connectHostToSwitch(host: Host, sw: VlanSwitch, portId: number): void {
  host.portLink = { deviceId: sw.id, portId };
  const port = sw.ports.find((p) => p.id === portId);
  if (port) port.link = { deviceId: host.id, portId: 0 };
}

/** スイッチ間トランク接続 */
export function connectSwitches(
  sw1: VlanSwitch, portId1: number, sw2: VlanSwitch, portId2: number,
): void {
  const p1 = sw1.ports.find((p) => p.id === portId1);
  const p2 = sw2.ports.find((p) => p.id === portId2);
  if (p1) p1.link = { deviceId: sw2.id, portId: portId2 };
  if (p2) p2.link = { deviceId: sw1.id, portId: portId1 };
}

/** フレームのVLAN IDを決定（受信時） */
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

/** MACアドレス学習 */
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

/** 送出時のフレーム加工 */
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

/** キュー要素 */
interface QueueItem {
  switchId: string;
  portId: number;
  frame: EthernetFrame;
  vlan: VlanId;
}

/** シミュレーション実行 */
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

/** フレーム配送ヘルパー */
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
