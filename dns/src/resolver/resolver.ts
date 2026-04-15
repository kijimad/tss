/**
 * resolver.ts — 再帰 DNS リゾルバ
 *
 * 実際のDNSリゾルバと同じアルゴリズムで名前解決を行う:
 *
 *   1. キャッシュを確認
 *   2. ルートサーバに問い合わせ
 *   3. 応答に Answer があればそれを返す
 *   4. 応答に Authority（NS レコード）があれば、そのサーバに再問い合わせ
 *   5. 最終的に Answer が得られるまで繰り返す
 *
 * 例: "www.example.com" の解決
 *   → ルートサーバ: ".com の NS は a.gtld-servers.net (192.5.6.30)"
 *   → .com サーバ: "example.com の NS は ns1.example.com (93.184.216.34)"
 *   → example.com の権威: "www.example.com の A は 93.184.216.34"
 */
import type { DnsRecord, RecordType, NetworkEvent, ResolveTrace } from "../protocol/types.js";
import { RecordClass, ResponseCode, recordTypeToString } from "../protocol/types.js";
import { encodeDnsMessage } from "../protocol/encoder.js";
import { decodeDnsMessage } from "../protocol/decoder.js";
import type { VirtualNetwork } from "../network/virtual-network.js";
import type { DnsCache } from "./cache.js";

/** ルートサーバのIPアドレス（再帰解決の起点） */
const ROOT_SERVER_IP = "198.41.0.4";

/**
 * 再帰 DNS リゾルバ
 *
 * ルートサーバから順に権威サーバへ辿り、最終的なレコードを取得する。
 * キャッシュを活用し、解決過程のトレースも記録する。
 */
export class DnsResolver {
  /** 仮想ネットワーク（パケット送受信用） */
  private network: VirtualNetwork;
  /** DNSレコードキャッシュ */
  private cache: DnsCache;
  /** 次に使用するトランザクションID */
  private nextId = 1;

  /** トレース用イベントログ */
  private events: NetworkEvent[] = [];
  /** トレース開始時刻 */
  private traceStartTime = 0;

  /**
   * @param network - パケット送受信に使用する仮想ネットワーク
   * @param cache - DNSレコードキャッシュ
   */
  constructor(network: VirtualNetwork, cache: DnsCache) {
    this.network = network;
    this.cache = cache;
  }

  // ドメイン名を解決する（トレース付き）
  async resolve(name: string, type: RecordType): Promise<ResolveTrace> {
    this.events = [];
    this.traceStartTime = performance.now();

    // キャッシュとネットワークのトレースを収集
    this.cache.setStartTime(this.traceStartTime);
    this.cache.onEvent = (event) => this.events.push(event);
    this.network.startTrace();

    let totalQueries = 0;
    let cacheHits = 0;

    // キャッシュチェック
    const cached = this.cache.lookup(name, type);
    if (cached !== undefined) {
      cacheHits++;
      const elapsed = performance.now() - this.traceStartTime;
      return {
        query: name,
        recordType: recordTypeToString(type),
        events: this.events,
        totalQueries: 0,
        cacheHits,
        result: cached,
        elapsedMs: elapsed,
      };
    }

    // 再帰解決
    let serverIp = ROOT_SERVER_IP;
    let result: DnsRecord[] = [];
    const maxIterations = 10; // 無限ループ防止

    for (let i = 0; i < maxIterations; i++) {
      this.events.push({
        type: "resolve_step",
        serverName: serverIp,
        serverIp,
        question: `${name} ${recordTypeToString(type)}`,
        timestamp: performance.now() - this.traceStartTime,
      });

      // クエリを送信
      const queryMsg = this.buildQuery(name, type);
      const queryData = encodeDnsMessage(queryMsg);
      totalQueries++;

      const responsePacket = await this.network.sendPacketWithTrace(
        {
          source: { ip: "127.0.0.1", port: 53 },
          destination: { ip: serverIp, port: 53 },
          data: queryData,
        },
        name,
        queryMsg.header.id,
      );

      if (responsePacket === undefined) {
        break; // サーバに到達できない
      }

      const response = decodeDnsMessage(responsePacket.data);

      // ネットワークイベントの answerCount を更新
      const lastEvent = this.events[this.events.length - 1];
      if (lastEvent !== undefined && lastEvent.type === "udp_recv") {
        // 直接変更はできないので新しいイベントを差し替え
        this.events[this.events.length - 1] = {
          ...lastEvent,
          answerCount: response.header.ancount,
        };
      }

      // Answer があればキャッシュして返す
      if (response.answers.length > 0) {
        result = response.answers;
        this.cache.store(result);
        // Authority/Additional もキャッシュ
        if (response.authorities.length > 0) this.cache.store(response.authorities);
        if (response.additionals.length > 0) this.cache.store(response.additionals);
        break;
      }

      // Authority セクションに NS レコードがあれば委任先に問い合わせ
      if (response.authorities.length > 0) {
        this.cache.store(response.authorities);
        if (response.additionals.length > 0) this.cache.store(response.additionals);

        // NS の IP を Additional から取得（グルーレコード）
        const nsRecord = response.authorities[0];
        if (nsRecord === undefined) break;

        // Additional から NS の A レコードを探す
        const glue = response.additionals.find(
          r => r.name === nsRecord.data && r.type === 1,
        );
        if (glue !== undefined) {
          serverIp = glue.data;
        } else {
          // グルーレコードがない場合、NS の IP をキャッシュから取得
          const cachedNs = this.cache.lookup(nsRecord.data, 1);
          if (cachedNs !== undefined && cachedNs[0] !== undefined) {
            serverIp = cachedNs[0].data;
          } else {
            break; // NS の IP が分からない
          }
        }
        continue;
      }

      // 何も得られなかった
      break;
    }

    // ネットワークイベントも統合
    this.events.push(...this.network.getEvents());

    const elapsed = performance.now() - this.traceStartTime;
    return {
      query: name,
      recordType: recordTypeToString(type),
      events: this.events,
      totalQueries,
      cacheHits,
      result,
      elapsedMs: elapsed,
    };
  }

  // DNS クエリメッセージを構築
  private buildQuery(name: string, type: RecordType) {
    const id = this.nextId++;
    return {
      header: {
        id,
        qr: 0 as const,
        opcode: 0,
        aa: false,
        tc: false,
        rd: true,  // 再帰要求
        ra: false,
        rcode: ResponseCode.NoError,
        qdcount: 1,
        ancount: 0,
        nscount: 0,
        arcount: 0,
      },
      questions: [{ name, type, class: RecordClass.IN }],
      answers: [],
      authorities: [],
      additionals: [],
    };
  }
}
