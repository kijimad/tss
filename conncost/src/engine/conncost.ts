/**
 * conncost.ts — コネクション確立コスト エミュレーションエンジン
 *
 * TCP / TLS 1.2 / TLS 1.3 / QUIC の接続確立コストを
 * RTT・CPU・メモリの各次元でシミュレーションし、
 * プロトコル間・シナリオ間のコスト差を可視化する。
 *
 * 接続確立フェーズ:
 *   DNS → TCP 3-way HS → TLS ハンドシェイク →
 *   アプリ認証 → リクエスト送信 (= TTFB)
 */

// ── 基本型 ──

/** プロトコルスタック */
export type Protocol =
  | "tcp"              // TCP のみ (平文)
  | "tls12"            // TCP + TLS 1.2 (2-RTT HS)
  | "tls13"            // TCP + TLS 1.3 (1-RTT HS)
  | "tls13-0rtt"       // TCP + TLS 1.3 0-RTT (再接続)
  | "quic"             // QUIC (1-RTT, UDP ベース)
  | "quic-0rtt";       // QUIC 0-RTT (再接続)

/** 接続モード */
export type ConnMode =
  | "new-per-request"  // リクエストごとに新規接続
  | "keep-alive"       // HTTP/1.1 Keep-Alive
  | "multiplex"        // HTTP/2 多重化
  | "pooled";          // コネクションプール

/** ネットワーク環境 */
export interface NetworkEnv {
  name: string;
  /** RTT (ms) */
  rttMs: number;
  /** DNS 解決時間 (ms, キャッシュ済みなら 0) */
  dnsMs: number;
  /** パケットロス率 */
  lossRate: number;
  /** 帯域 (Mbps) */
  bandwidthMbps: number;
}

/** サーバー設定 */
export interface ServerConfig {
  /** アプリ認証のコスト (ms) */
  authCostMs: number;
  /** TLS セッション再開対応 */
  sessionResumption: boolean;
  /** サーバー処理時間 (ms) */
  processingMs: number;
}

/** 接続フェーズとそのコスト */
export interface Phasecost {
  phase: string;
  /** 所要時間 (ms) */
  durationMs: number;
  /** CPU コスト (相対値 0-100) */
  cpuCost: number;
  /** 消費メモリ (bytes) */
  memoryCost: number;
  /** 使用した RTT 数 */
  rtts: number;
  /** パケット数 (往復合計) */
  packets: number;
  /** 備考 */
  note: string;
}

/** 1 リクエストの結果 */
export interface RequestResult {
  requestIndex: number;
  /** 接続が新規か再利用か */
  connectionReused: boolean;
  /** 各フェーズのコスト */
  phases: Phasecost[];
  /** 合計所要時間 (ms) — TTFB */
  totalMs: number;
  /** 合計 RTT 数 */
  totalRtts: number;
  /** 合計パケット数 */
  totalPackets: number;
  /** 合計 CPU コスト */
  totalCpu: number;
  /** 合計メモリコスト */
  totalMemory: number;
}

/** シミュレーション設定 */
export interface SimConfig {
  protocol: Protocol;
  connMode: ConnMode;
  network: NetworkEnv;
  server: ServerConfig;
  /** 送信するリクエスト数 */
  requestCount: number;
}

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  reqIndex: number;
  phase: string;
  type: "start" | "end" | "rtt" | "crypto" | "reuse" | "info";
  detail: string;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  requests: RequestResult[];
  /** 集計 */
  summary: {
    totalTimeMs: number;
    avgTtfbMs: number;
    totalRtts: number;
    totalPackets: number;
    connectionsCreated: number;
    connectionsReused: number;
    handshakeOverheadMs: number;
    handshakeOverheadPercent: number;
  };
}

// ── コスト定数 ──

/** TCP 3-way HS のコスト (1 RTT) */
export function tcpHandshakeCost(rtt: number): Phasecost {
  return { phase: "TCP Handshake", durationMs: rtt, cpuCost: 2, memoryCost: 280, rtts: 1, packets: 3, note: "SYN → SYN-ACK → ACK" };
}

/** TLS 1.2 HS のコスト (2 RTT) */
export function tls12HandshakeCost(rtt: number): PhaseCount {
  return { phase: "TLS 1.2 Handshake", durationMs: rtt * 2, cpuCost: 35, memoryCost: 8500, rtts: 2, packets: 10, note: "ClientHello → ServerHello+Cert+KeyExch → ClientKeyExch+Finished → Finished" };
}

/** TLS 1.3 HS のコスト (1 RTT) */
export function tls13HandshakeCost(rtt: number): PhaseCount {
  return { phase: "TLS 1.3 Handshake", durationMs: rtt, cpuCost: 25, memoryCost: 6000, rtts: 1, packets: 6, note: "ClientHello(+key_share) → ServerHello+EncExt+Finished → Finished" };
}

/** TLS 1.3 0-RTT のコスト (0 RTT) */
export function tls13ZeroRttCost(): PhaseCount {
  return { phase: "TLS 1.3 0-RTT", durationMs: 0, cpuCost: 10, memoryCost: 2000, rtts: 0, packets: 2, note: "PSK + early_data (セッション再開、リプレイ攻撃リスクあり)" };
}

/** QUIC HS のコスト (1 RTT, TCP+TLS 統合) */
export function quicHandshakeCost(rtt: number): PhaseCount {
  return { phase: "QUIC Handshake", durationMs: rtt, cpuCost: 20, memoryCost: 5000, rtts: 1, packets: 4, note: "Initial(ClientHello) → Initial(ServerHello)+Handshake → Handshake(Finished)" };
}

/** QUIC 0-RTT のコスト */
export function quicZeroRttCost(): PhaseCount {
  return { phase: "QUIC 0-RTT", durationMs: 0, cpuCost: 8, memoryCost: 1500, rtts: 0, packets: 1, note: "Initial + 0-RTT data (セッション再開)" };
}

/** DNS 解決コスト */
export function dnsCost(dnsMs: number): PhaseCount {
  return { phase: "DNS Lookup", durationMs: dnsMs, cpuCost: 1, memoryCost: 200, rtts: dnsMs > 0 ? 1 : 0, packets: dnsMs > 0 ? 2 : 0, note: dnsMs > 0 ? "A/AAAA クエリ → 応答" : "キャッシュ済み" };
}

/** アプリ認証コスト */
export function authCost(authMs: number, rtt: number): PhaseCount {
  if (authMs <= 0) return { phase: "Auth", durationMs: 0, cpuCost: 0, memoryCost: 0, rtts: 0, packets: 0, note: "認証なし" };
  return { phase: "App Auth", durationMs: authMs + rtt, cpuCost: 15, memoryCost: 1024, rtts: 1, packets: 2, note: "認証トークン検証/セッション確立" };
}

/** リクエスト送信+レスポンス受信 */
export function requestCost(processingMs: number, rtt: number): PhaseCount {
  return { phase: "Request/Response", durationMs: processingMs + rtt, cpuCost: 5, memoryCost: 4096, rtts: 1, packets: 4, note: "HTTP リクエスト送信 → サーバー処理 → レスポンス受信" };
}

/** Keep-Alive 再利用 (接続確立コスト=0) */
export function reuseCost(): PhaseCount {
  return { phase: "Connection Reuse", durationMs: 0, cpuCost: 0, memoryCost: 0, rtts: 0, packets: 0, note: "既存接続を再利用 (HS コストなし)" };
}

// PhaseCount はレガシーエイリアス
type PhaseCount = Phasecost;
type PhaseCost = Phasecost;

// ── シミュレーター ──

export class ConnCostSimulator {
  simulate(config: SimConfig): SimResult {
    const events: SimEvent[] = [];
    const requests: RequestResult[] = [];
    let time = 0;
    let connsCreated = 0;
    let connsReused = 0;
    let totalHandshakeMs = 0;
    const rtt = config.network.rttMs;

    for (let i = 0; i < config.requestCount; i++) {
      const phases: PhaseCost[] = [];
      const isFirst = i === 0;
      const canReuse = !isFirst && config.connMode !== "new-per-request";

      events.push({ time, reqIndex: i, phase: "Request", type: "start", detail: `リクエスト #${i + 1} 開始` });

      if (canReuse) {
        // 接続再利用
        phases.push(reuseCost());
        connsReused++;
        events.push({ time, reqIndex: i, phase: "Reuse", type: "reuse", detail: `既存接続を再利用 (${config.connMode})` });
      } else {
        // 新規接続確立
        connsCreated++;

        // DNS
        const dns = dnsCost(i === 0 ? config.network.dnsMs : 0);
        phases.push(dns);
        if (dns.durationMs > 0) {
          events.push({ time, reqIndex: i, phase: dns.phase, type: "rtt", detail: `DNS 解決: ${dns.durationMs}ms (${dns.note})` });
          time += dns.durationMs;
        }

        // プロトコル別のハンドシェイク
        switch (config.protocol) {
          case "tcp": {
            const tcp = tcpHandshakeCost(rtt);
            phases.push(tcp);
            events.push({ time, reqIndex: i, phase: tcp.phase, type: "rtt", detail: `${tcp.note} (${tcp.durationMs}ms, ${tcp.rtts} RTT)` });
            time += tcp.durationMs;
            totalHandshakeMs += tcp.durationMs;
            break;
          }
          case "tls12": {
            const tcp = tcpHandshakeCost(rtt);
            phases.push(tcp);
            events.push({ time, reqIndex: i, phase: tcp.phase, type: "rtt", detail: `${tcp.note} (${tcp.durationMs}ms)` });
            time += tcp.durationMs;
            const tls = tls12HandshakeCost(rtt);
            phases.push(tls);
            events.push({ time, reqIndex: i, phase: tls.phase, type: "crypto", detail: `${tls.note} (${tls.durationMs}ms, ${tls.rtts} RTT, CPU=${tls.cpuCost})` });
            time += tls.durationMs;
            totalHandshakeMs += tcp.durationMs + tls.durationMs;
            break;
          }
          case "tls13": {
            const tcp = tcpHandshakeCost(rtt);
            phases.push(tcp);
            events.push({ time, reqIndex: i, phase: tcp.phase, type: "rtt", detail: `${tcp.note} (${tcp.durationMs}ms)` });
            time += tcp.durationMs;
            const tls = tls13HandshakeCost(rtt);
            phases.push(tls);
            events.push({ time, reqIndex: i, phase: tls.phase, type: "crypto", detail: `${tls.note} (${tls.durationMs}ms, ${tls.rtts} RTT)` });
            time += tls.durationMs;
            totalHandshakeMs += tcp.durationMs + tls.durationMs;
            break;
          }
          case "tls13-0rtt": {
            if (isFirst) {
              // 初回はフル TLS 1.3
              const tcp = tcpHandshakeCost(rtt);
              phases.push(tcp);
              time += tcp.durationMs;
              events.push({ time, reqIndex: i, phase: tcp.phase, type: "rtt", detail: tcp.note });
              const tls = tls13HandshakeCost(rtt);
              phases.push(tls);
              time += tls.durationMs;
              events.push({ time, reqIndex: i, phase: tls.phase, type: "crypto", detail: `初回: フル TLS 1.3 (${tls.durationMs}ms)` });
              totalHandshakeMs += tcp.durationMs + tls.durationMs;
            } else {
              const tcp = tcpHandshakeCost(rtt);
              phases.push(tcp);
              time += tcp.durationMs;
              events.push({ time, reqIndex: i, phase: tcp.phase, type: "rtt", detail: tcp.note });
              const z = tls13ZeroRttCost();
              phases.push(z);
              events.push({ time, reqIndex: i, phase: z.phase, type: "crypto", detail: `0-RTT 再開: ${z.note}` });
              totalHandshakeMs += tcp.durationMs;
            }
            break;
          }
          case "quic": {
            const q = quicHandshakeCost(rtt);
            phases.push(q);
            events.push({ time, reqIndex: i, phase: q.phase, type: "rtt", detail: `${q.note} (${q.durationMs}ms, TCP+TLS 統合)` });
            time += q.durationMs;
            totalHandshakeMs += q.durationMs;
            break;
          }
          case "quic-0rtt": {
            if (isFirst) {
              const q = quicHandshakeCost(rtt);
              phases.push(q);
              time += q.durationMs;
              events.push({ time, reqIndex: i, phase: q.phase, type: "rtt", detail: `初回: ${q.note}` });
              totalHandshakeMs += q.durationMs;
            } else {
              const z = quicZeroRttCost();
              phases.push(z);
              events.push({ time, reqIndex: i, phase: z.phase, type: "crypto", detail: `QUIC 0-RTT: ${z.note}` });
            }
            break;
          }
        }

        // アプリ認証
        const auth = authCost(config.server.authCostMs, rtt);
        if (auth.durationMs > 0) {
          phases.push(auth);
          events.push({ time, reqIndex: i, phase: auth.phase, type: "rtt", detail: `${auth.note} (${auth.durationMs}ms)` });
          time += auth.durationMs;
          totalHandshakeMs += auth.durationMs;
        }
      }

      // パケットロスによるリトライ
      if (config.network.lossRate > 0 && Math.random() < config.network.lossRate) {
        const retryMs = rtt * 2;
        phases.push({ phase: "Packet Loss Retry", durationMs: retryMs, cpuCost: 1, memoryCost: 0, rtts: 1, packets: 2, note: "TCP 再送" });
        events.push({ time, reqIndex: i, phase: "Retry", type: "rtt", detail: `パケットロス → TCP 再送 (+${retryMs}ms)` });
        time += retryMs;
      }

      // リクエスト/レスポンス
      const req = requestCost(config.server.processingMs, rtt);
      phases.push(req);
      events.push({ time, reqIndex: i, phase: req.phase, type: "rtt", detail: `${req.note} (${req.durationMs}ms)` });
      time += req.durationMs;

      const totalMs = phases.reduce((s, p) => s + p.durationMs, 0);
      const totalRtts = phases.reduce((s, p) => s + p.rtts, 0);
      const totalPackets = phases.reduce((s, p) => s + p.packets, 0);
      const totalCpu = phases.reduce((s, p) => s + p.cpuCost, 0);
      const totalMemory = phases.reduce((s, p) => s + p.memoryCost, 0);

      events.push({ time, reqIndex: i, phase: "Request", type: "end", detail: `#${i + 1} 完了: TTFB=${totalMs.toFixed(1)}ms (${totalRtts} RTT, ${totalPackets} pkt)` });

      requests.push({ requestIndex: i, connectionReused: canReuse, phases, totalMs, totalRtts, totalPackets, totalCpu, totalMemory });
    }

    const avgTtfb = requests.reduce((s, r) => s + r.totalMs, 0) / requests.length;
    const totalTimeMs = requests.reduce((s, r) => s + r.totalMs, 0);
    const sumRtts = requests.reduce((s, r) => s + r.totalRtts, 0);
    const sumPkts = requests.reduce((s, r) => s + r.totalPackets, 0);

    return {
      events, requests,
      summary: {
        totalTimeMs, avgTtfbMs: avgTtfb, totalRtts: sumRtts, totalPackets: sumPkts,
        connectionsCreated: connsCreated, connectionsReused: connsReused,
        handshakeOverheadMs: totalHandshakeMs,
        handshakeOverheadPercent: totalTimeMs > 0 ? (totalHandshakeMs / totalTimeMs) * 100 : 0,
      },
    };
  }
}

// ── プリセット用ヘルパー ──

export const NETWORKS: Record<string, NetworkEnv> = {
  lan:       { name: "LAN (1ms)",         rttMs: 1,   dnsMs: 0,  lossRate: 0,    bandwidthMbps: 1000 },
  dc:        { name: "同一DC (2ms)",      rttMs: 2,   dnsMs: 1,  lossRate: 0,    bandwidthMbps: 10000 },
  regional:  { name: "同一リージョン (10ms)", rttMs: 10,  dnsMs: 5,  lossRate: 0,    bandwidthMbps: 1000 },
  crossReg:  { name: "クロスリージョン (80ms)", rttMs: 80,  dnsMs: 20, lossRate: 0.01, bandwidthMbps: 100 },
  global:    { name: "大陸間 (150ms)",     rttMs: 150, dnsMs: 40, lossRate: 0.02, bandwidthMbps: 50 },
  satellite: { name: "衛星回線 (600ms)",   rttMs: 600, dnsMs: 50, lossRate: 0.05, bandwidthMbps: 10 },
  mobile3g:  { name: "モバイル 3G (200ms)", rttMs: 200, dnsMs: 100, lossRate: 0.03, bandwidthMbps: 2 },
};

export const DEFAULT_SERVER: ServerConfig = { authCostMs: 5, sessionResumption: true, processingMs: 10 };
