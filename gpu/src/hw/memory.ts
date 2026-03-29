/**
 * GPUメモリ階層シミュレーション
 * グローバルメモリ（高遅延）、共有メモリ（ブロック毎、高速）、
 * レジスタ（スレッド毎）、コンスタントメモリのアクセス遅延をシミュレーション
 */

/** メモリの種類 */
export type MemoryType = 'global' | 'shared' | 'register' | 'constant';

/** メモリアクセスの記録 */
export interface MemoryAccess {
  /** メモリ種類 */
  type: MemoryType;
  /** アドレス */
  address: number;
  /** 読み書き */
  operation: 'read' | 'write';
  /** レイテンシ（サイクル数） */
  latencyCycles: number;
  /** タイムスタンプ（サイクル） */
  timestamp: number;
}

/** メモリ種類ごとのレイテンシ設定（サイクル数） */
export interface MemoryLatencyConfig {
  /** グローバルメモリ（VRAM）アクセスレイテンシ */
  global: number;
  /** 共有メモリアクセスレイテンシ */
  shared: number;
  /** レジスタアクセスレイテンシ */
  register: number;
  /** コンスタントメモリアクセスレイテンシ（キャッシュヒット時） */
  constant: number;
}

/** デフォルトのレイテンシ設定 */
export const DEFAULT_LATENCY: MemoryLatencyConfig = {
  global: 400,
  shared: 20,
  register: 1,
  constant: 4,
};

/** メモリ領域 */
export class MemoryRegion {
  /** メモリ種類 */
  readonly type: MemoryType;
  /** メモリサイズ（バイト） */
  readonly size: number;
  /** アクセスレイテンシ（サイクル数） */
  readonly latency: number;
  /** メモリデータ */
  private data: Float32Array;
  /** アクセス履歴 */
  private accessLog: MemoryAccess[];
  /** 現在のサイクル数 */
  private currentCycle: number;

  constructor(type: MemoryType, size: number, latency: number) {
    this.type = type;
    this.size = size;
    this.latency = latency;
    // Float32として管理するため要素数は4分の1
    this.data = new Float32Array(Math.floor(size / 4));
    this.accessLog = [];
    this.currentCycle = 0;
  }

  /** アドレスのバリデーション */
  private validateAddress(address: number): void {
    const maxIndex = this.data.length;
    if (address < 0 || address >= maxIndex) {
      throw new Error(
        `メモリアクセス違反: ${this.type}メモリのアドレス${address}は範囲外（最大: ${maxIndex - 1}）`
      );
    }
  }

  /** メモリから読み出し */
  read(address: number): { value: number; latency: number } {
    this.validateAddress(address);
    const value = this.data[address] ?? 0;
    const access: MemoryAccess = {
      type: this.type,
      address,
      operation: 'read',
      latencyCycles: this.latency,
      timestamp: this.currentCycle,
    };
    this.accessLog.push(access);
    this.currentCycle += this.latency;
    return { value, latency: this.latency };
  }

  /** メモリへ書き込み */
  write(address: number, value: number): { latency: number } {
    this.validateAddress(address);
    this.data[address] = value;
    const access: MemoryAccess = {
      type: this.type,
      address,
      operation: 'write',
      latencyCycles: this.latency,
      timestamp: this.currentCycle,
    };
    this.accessLog.push(access);
    this.currentCycle += this.latency;
    return { latency: this.latency };
  }

  /** 一括読み出し */
  readBulk(startAddress: number, count: number): { values: number[]; totalLatency: number } {
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const result = this.read(startAddress + i);
      values.push(result.value);
    }
    // 一括アクセス時はコアレスドアクセスで最適化（最初の1回分＋追加分は1/4レイテンシ）
    const coalescedLatency = this.latency + Math.floor((count - 1) * this.latency * 0.25);
    return { values, totalLatency: coalescedLatency };
  }

  /** 一括書き込み */
  writeBulk(startAddress: number, values: number[]): { totalLatency: number } {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v !== undefined) {
        this.write(startAddress + i, v);
      }
    }
    const coalescedLatency = this.latency + Math.floor((values.length - 1) * this.latency * 0.25);
    return { totalLatency: coalescedLatency };
  }

  /** アクセス履歴を取得 */
  getAccessLog(): readonly MemoryAccess[] {
    return this.accessLog;
  }

  /** アクセス統計を取得 */
  getAccessStats(): { reads: number; writes: number; totalLatency: number } {
    let reads = 0;
    let writes = 0;
    let totalLatency = 0;
    for (const access of this.accessLog) {
      if (access.operation === 'read') reads++;
      else writes++;
      totalLatency += access.latencyCycles;
    }
    return { reads, writes, totalLatency };
  }

  /** メモリとログをリセット */
  reset(): void {
    this.data.fill(0);
    this.accessLog = [];
    this.currentCycle = 0;
  }

  /** 現在のサイクルを設定 */
  setCycle(cycle: number): void {
    this.currentCycle = cycle;
  }

  /** データの生スナップショットを取得 */
  getDataSnapshot(start: number, count: number): number[] {
    const result: number[] = [];
    for (let i = start; i < start + count && i < this.data.length; i++) {
      result.push(this.data[i] ?? 0);
    }
    return result;
  }
}

/** GPUメモリシステム全体 */
export class GPUMemorySystem {
  /** グローバルメモリ */
  readonly global: MemoryRegion;
  /** 共有メモリ（ブロック毎に1つ想定） */
  readonly shared: MemoryRegion;
  /** レジスタファイル */
  readonly registers: MemoryRegion;
  /** コンスタントメモリ */
  readonly constant: MemoryRegion;

  constructor(
    globalSize: number,
    sharedSize: number,
    registerSize: number,
    constantSize: number,
    latency: MemoryLatencyConfig = DEFAULT_LATENCY
  ) {
    this.global = new MemoryRegion('global', globalSize, latency.global);
    this.shared = new MemoryRegion('shared', sharedSize, latency.shared);
    this.registers = new MemoryRegion('register', registerSize, latency.register);
    this.constant = new MemoryRegion('constant', constantSize, latency.constant);
  }

  /** 指定したメモリ種類の領域を取得 */
  getRegion(type: MemoryType): MemoryRegion {
    switch (type) {
      case 'global': return this.global;
      case 'shared': return this.shared;
      case 'register': return this.registers;
      case 'constant': return this.constant;
    }
  }

  /** 全メモリの統計を取得 */
  getAllStats(): Record<MemoryType, { reads: number; writes: number; totalLatency: number }> {
    return {
      global: this.global.getAccessStats(),
      shared: this.shared.getAccessStats(),
      register: this.registers.getAccessStats(),
      constant: this.constant.getAccessStats(),
    };
  }

  /** 全メモリをリセット */
  resetAll(): void {
    this.global.reset();
    this.shared.reset();
    this.registers.reset();
    this.constant.reset();
  }
}
