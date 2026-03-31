/**
 * firewall.ts — セキュリティグループ / パケットフィルタリングエンジン
 *
 * AWS Security Group と同様のステートフルファイアウォールを
 * シミュレートする。デフォルト拒否 + 許可ルールで評価。
 */

/** プロトコル */
export type Protocol = "tcp" | "udp" | "icmp" | "all";

/** セキュリティグループのルール */
export interface Rule {
  protocol: Protocol;
  fromPort: number;
  toPort: number;
  /** CIDR (例: "0.0.0.0/0") またはセキュリティグループ ID (例: "sg-web") */
  source: string;
  description: string;
}

/** セキュリティグループ */
export interface SecurityGroup {
  id: string;
  name: string;
  inbound: Rule[];
  outbound: Rule[];
}

/** 仮想インスタンス */
export interface Instance {
  id: string;
  name: string;
  privateIp: string;
  /** 所属するサブネットの CIDR */
  subnet: string;
  /** アタッチされたセキュリティグループ ID */
  sgIds: string[];
}

/** ネットワークパケット */
export interface Packet {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: Protocol;
  label: string;
}

/** 評価トレースの1ステップ */
export interface TraceStep {
  phase: "lookup" | "sg_eval" | "rule_check" | "match" | "default_deny" | "stateful";
  sgId?: string;
  ruleSummary?: string;
  detail: string;
  result: "allow" | "deny" | "info" | "skip";
}

/** パケット評価結果 */
export interface EvalResult {
  packet: Packet;
  targetInstance: string;
  direction: "inbound" | "outbound";
  allowed: boolean;
  matchedRule: Rule | null;
  matchedSg: string | null;
  trace: TraceStep[];
}

/** CIDR にマッチするか判定する */
export function matchCidr(ip: string, cidr: string): boolean {
  if (cidr === "0.0.0.0/0") return true;
  const [cidrIp, prefixStr] = cidr.split("/");
  if (cidrIp === undefined) return false;
  const prefix = Number(prefixStr ?? "32");
  const ipNum = ipToNum(ip);
  const cidrNum = ipToNum(cidrIp);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

/** IP アドレスを数値に変換 */
function ipToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** ルールがパケットにマッチするか */
function ruleMatchesPacket(
  rule: Rule,
  packet: Packet,
  sourceIp: string,
  allGroups: Map<string, SecurityGroup>,
  allInstances: Instance[],
): boolean {
  // プロトコルチェック
  if (rule.protocol !== "all" && rule.protocol !== packet.protocol) return false;

  // ポートチェック (ICMP はポートなし)
  if (rule.protocol !== "icmp" && rule.protocol !== "all") {
    if (packet.dstPort < rule.fromPort || packet.dstPort > rule.toPort) return false;
  }

  // ソースチェック
  if (rule.source.startsWith("sg-")) {
    // セキュリティグループ参照: そのSGにアタッチされたインスタンスの IP か
    const sourceSgId = rule.source;
    const matchingInstances = allInstances.filter((inst) =>
      inst.sgIds.includes(sourceSgId),
    );
    return matchingInstances.some((inst) => inst.privateIp === sourceIp);
  }

  // CIDR マッチ
  return matchCidr(sourceIp, rule.source);
}

/** セキュリティグループエンジン */
export class FirewallEngine {
  private groups = new Map<string, SecurityGroup>();
  private instances: Instance[] = [];
  /** ステートフル追跡: 許可されたフローの逆方向を自動許可 */
  private stateTable = new Set<string>();

  constructor(groups: SecurityGroup[], instances: Instance[]) {
    for (const sg of groups) this.groups.set(sg.id, sg);
    this.instances = instances;
  }

  /** ステートテーブルをリセット */
  resetState(): void {
    this.stateTable.clear();
  }

  /** 全セキュリティグループ */
  get allGroups(): SecurityGroup[] {
    return [...this.groups.values()];
  }

  /** 全インスタンス */
  get allInstances(): Instance[] {
    return [...this.instances];
  }

  /** パケットを評価する */
  evaluate(packet: Packet, direction: "inbound" | "outbound"): EvalResult {
    const trace: TraceStep[] = [];

    // 1. 宛先/送信元インスタンスを特定
    const targetIp = direction === "inbound" ? packet.dstIp : packet.srcIp;
    const sourceIp = direction === "inbound" ? packet.srcIp : packet.dstIp;
    const instance = this.instances.find((i) => i.privateIp === targetIp);

    if (instance === undefined) {
      trace.push({ phase: "lookup", detail: `IP ${targetIp} に対応するインスタンスが見つからない`, result: "deny" });
      return { packet, targetInstance: "?", direction, allowed: false, matchedRule: null, matchedSg: null, trace };
    }

    trace.push({
      phase: "lookup",
      detail: `${direction === "inbound" ? "宛先" : "送信元"}: ${instance.name} (${instance.privateIp}) — SG: ${instance.sgIds.join(", ")}`,
      result: "info",
    });

    // 2. ステートフルチェック（逆方向のフローが既に許可されていればパス）
    const reverseKey = `${packet.dstIp}:${packet.dstPort}-${packet.srcIp}:${packet.srcPort}-${packet.protocol}`;
    if (this.stateTable.has(reverseKey)) {
      trace.push({
        phase: "stateful",
        detail: "ステートフル: 逆方向のフローが許可済み → 自動許可",
        result: "allow",
      });
      return { packet, targetInstance: instance.name, direction, allowed: true, matchedRule: null, matchedSg: "stateful", trace };
    }

    // 3. アタッチされた各 SG のルールを評価
    for (const sgId of instance.sgIds) {
      const sg = this.groups.get(sgId);
      if (sg === undefined) continue;

      const rules = direction === "inbound" ? sg.inbound : sg.outbound;
      trace.push({
        phase: "sg_eval",
        sgId,
        detail: `${sg.name} (${sgId}) の${direction === "inbound" ? "インバウンド" : "アウトバウンド"}ルールを評価 (${rules.length} ルール)`,
        result: "info",
      });

      for (const rule of rules) {
        const ruleSummary = `${rule.protocol.toUpperCase()} ${rule.fromPort}-${rule.toPort} from ${rule.source}`;
        trace.push({
          phase: "rule_check",
          sgId,
          ruleSummary,
          detail: `ルール: ${ruleSummary} — ${rule.description}`,
          result: "info",
        });

        if (ruleMatchesPacket(rule, packet, sourceIp, this.groups, this.instances)) {
          trace.push({
            phase: "match",
            sgId,
            ruleSummary,
            detail: `\u2714 マッチ! → 許可`,
            result: "allow",
          });

          // ステートテーブルに記録（逆方向の応答を自動許可するため）
          const flowKey = `${packet.srcIp}:${packet.srcPort}-${packet.dstIp}:${packet.dstPort}-${packet.protocol}`;
          this.stateTable.add(flowKey);

          return {
            packet,
            targetInstance: instance.name,
            direction,
            allowed: true,
            matchedRule: rule,
            matchedSg: sgId,
            trace,
          };
        }

        trace.push({
          phase: "rule_check",
          sgId,
          detail: `\u2718 マッチしない`,
          result: "skip",
        });
      }
    }

    // 4. どのルールにもマッチしなかった → デフォルト拒否
    trace.push({
      phase: "default_deny",
      detail: "全ルール不一致 → デフォルト拒否 (implicit deny)",
      result: "deny",
    });

    return { packet, targetInstance: instance.name, direction, allowed: false, matchedRule: null, matchedSg: null, trace };
  }
}
