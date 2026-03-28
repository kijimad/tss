/**
 * cache.ts — DNS レコードキャッシュ
 *
 * TTL（Time To Live）付きのキャッシュ。
 * 各レコードは格納時刻 + TTL で有効期限が決まり、
 * 期限切れのレコードは検索時に自動的に無視される。
 */
import type { DnsRecord, RecordType, NetworkEvent } from "../protocol/types.js";
import { recordTypeToString } from "../protocol/types.js";

interface CacheEntry {
  record: DnsRecord;
  storedAt: number;  // 格納時刻（ms）
}

export class DnsCache {
  // キー: "name:type" (例: "example.com:1")
  private entries = new Map<string, CacheEntry[]>();

  // トレース用イベント収集関数
  onEvent: ((event: NetworkEvent) => void) | undefined;
  private startTime = 0;

  setStartTime(t: number): void {
    this.startTime = t;
  }

  // キャッシュからレコードを検索
  lookup(name: string, type: RecordType): DnsRecord[] | undefined {
    const key = `${name}:${String(type)}`;
    const entries = this.entries.get(key);
    if (entries === undefined || entries.length === 0) {
      this.onEvent?.({
        type: "cache_miss",
        name,
        recordType: recordTypeToString(type),
        timestamp: performance.now() - this.startTime,
      });
      return undefined;
    }

    // TTL 期限切れを除外
    const now = performance.now();
    const valid = entries.filter(e => {
      const expiresAt = e.storedAt + e.record.ttl * 1000;
      return now < expiresAt;
    });

    if (valid.length === 0) {
      this.entries.delete(key);
      this.onEvent?.({
        type: "cache_miss",
        name,
        recordType: recordTypeToString(type),
        timestamp: now - this.startTime,
      });
      return undefined;
    }

    // 残りTTLを計算して返す
    const results = valid.map(e => ({
      ...e.record,
      ttl: Math.max(0, Math.floor((e.storedAt + e.record.ttl * 1000 - now) / 1000)),
    }));

    this.onEvent?.({
      type: "cache_hit",
      name,
      recordType: recordTypeToString(type),
      ttl: results[0]?.ttl ?? 0,
      timestamp: now - this.startTime,
    });

    return results;
  }

  // レコードをキャッシュに格納
  store(records: DnsRecord[]): void {
    const now = performance.now();
    for (const record of records) {
      const key = `${record.name}:${String(record.type)}`;
      const existing = this.entries.get(key);
      const entry: CacheEntry = { record, storedAt: now };
      if (existing !== undefined) {
        existing.push(entry);
      } else {
        this.entries.set(key, [entry]);
      }
      this.onEvent?.({
        type: "cache_store",
        name: record.name,
        recordType: recordTypeToString(record.type),
        ttl: record.ttl,
        timestamp: now - this.startTime,
      });
    }
  }

  // キャッシュをクリア
  clear(): void {
    this.entries.clear();
  }

  // キャッシュの全エントリ（期限切れ含む）
  getAllEntries(): { name: string; type: string; ttl: number; data: string; expired: boolean }[] {
    const now = performance.now();
    const result: { name: string; type: string; ttl: number; data: string; expired: boolean }[] = [];
    for (const [, entries] of this.entries) {
      for (const e of entries) {
        const remainingTtl = Math.max(0, Math.floor((e.storedAt + e.record.ttl * 1000 - now) / 1000));
        result.push({
          name: e.record.name,
          type: recordTypeToString(e.record.type),
          ttl: remainingTtl,
          data: e.record.data,
          expired: remainingTtl <= 0,
        });
      }
    }
    return result;
  }
}
