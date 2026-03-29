/**
 * GPUデバイスモデル
 * ストリーミングマルチプロセッサ（SM）、CUDAコア、グローバルメモリ（VRAM）、
 * 共有メモリ、レジスタファイル、クロック速度、メモリ帯域幅をシミュレーション
 */

/** SMの仕様 */
export interface SMSpec {
  /** SM内のCUDAコア数 */
  coresPerSM: number;
  /** SM毎の最大ワープ数 */
  maxWarpsPerSM: number;
  /** SM毎の共有メモリサイズ（バイト） */
  sharedMemorySize: number;
  /** SM毎のレジスタ数 */
  registersPerSM: number;
}

/** GPUデバイスの仕様 */
export interface GPUDeviceSpec {
  /** デバイス名 */
  name: string;
  /** SM数 */
  smCount: number;
  /** SMの仕様 */
  smSpec: SMSpec;
  /** グローバルメモリサイズ（バイト） */
  globalMemorySize: number;
  /** コアクロック速度（MHz） */
  clockSpeedMHz: number;
  /** メモリ帯域幅（GB/s） */
  memoryBandwidthGBs: number;
  /** コンスタントメモリサイズ（バイト） */
  constantMemorySize: number;
}

/** GPUデバイスの状態 */
export interface GPUDeviceState {
  /** 各SMのアクティブワープ数 */
  activeWarpsPerSM: number[];
  /** グローバルメモリ使用量（バイト） */
  globalMemoryUsed: number;
  /** 実行中カーネル数 */
  activeKernels: number;
  /** 総実行サイクル数 */
  totalCycles: number;
}

/** GPUデバイスクラス */
export class GPUDevice {
  /** デバイス仕様 */
  readonly spec: GPUDeviceSpec;
  /** デバイス状態 */
  private state: GPUDeviceState;

  constructor(spec: GPUDeviceSpec) {
    this.spec = spec;
    this.state = {
      activeWarpsPerSM: new Array<number>(spec.smCount).fill(0),
      globalMemoryUsed: 0,
      activeKernels: 0,
      totalCycles: 0,
    };
  }

  /** 総CUDAコア数を取得 */
  get totalCores(): number {
    return this.spec.smCount * this.spec.smSpec.coresPerSM;
  }

  /** 理論ピーク演算性能（GFLOPS）を計算 */
  get peakGFLOPS(): number {
    // 各コアが1サイクルに1FMA（2FLOP）実行可能と仮定
    return (this.totalCores * this.spec.clockSpeedMHz * 2) / 1000;
  }

  /** デバイス状態を取得 */
  getState(): Readonly<GPUDeviceState> {
    return { ...this.state };
  }

  /** SM上のアクティブワープ数を設定 */
  setActiveWarps(smIndex: number, warpCount: number): void {
    if (smIndex < 0 || smIndex >= this.spec.smCount) {
      throw new Error(`無効なSMインデックス: ${smIndex}`);
    }
    if (warpCount < 0 || warpCount > this.spec.smSpec.maxWarpsPerSM) {
      throw new Error(`無効なワープ数: ${warpCount}（最大: ${this.spec.smSpec.maxWarpsPerSM}）`);
    }
    this.state.activeWarpsPerSM[smIndex] = warpCount;
  }

  /** SM毎のオキュパンシーを計算（0〜1） */
  getOccupancy(smIndex: number): number {
    if (smIndex < 0 || smIndex >= this.spec.smCount) {
      throw new Error(`無効なSMインデックス: ${smIndex}`);
    }
    const active = this.state.activeWarpsPerSM[smIndex] ?? 0;
    return active / this.spec.smSpec.maxWarpsPerSM;
  }

  /** 全SMの平均オキュパンシーを計算 */
  getAverageOccupancy(): number {
    const total = this.state.activeWarpsPerSM.reduce((sum, w) => sum + w, 0);
    return total / (this.spec.smCount * this.spec.smSpec.maxWarpsPerSM);
  }

  /** グローバルメモリを割り当て */
  allocateGlobalMemory(bytes: number): boolean {
    if (this.state.globalMemoryUsed + bytes > this.spec.globalMemorySize) {
      return false;
    }
    this.state.globalMemoryUsed += bytes;
    return true;
  }

  /** グローバルメモリを解放 */
  freeGlobalMemory(bytes: number): void {
    this.state.globalMemoryUsed = Math.max(0, this.state.globalMemoryUsed - bytes);
  }

  /** サイクルを進める */
  advanceCycles(count: number): void {
    this.state.totalCycles += count;
  }

  /** デバイスをリセット */
  reset(): void {
    this.state = {
      activeWarpsPerSM: new Array<number>(this.spec.smCount).fill(0),
      globalMemoryUsed: 0,
      activeKernels: 0,
      totalCycles: 0,
    };
  }

  /** デバイス仕様の文字列表現 */
  getSpecSummary(): string {
    const lines = [
      `デバイス: ${this.spec.name}`,
      `SM数: ${this.spec.smCount}`,
      `コア/SM: ${this.spec.smSpec.coresPerSM}`,
      `総コア数: ${this.totalCores}`,
      `クロック: ${this.spec.clockSpeedMHz} MHz`,
      `VRAM: ${(this.spec.globalMemorySize / (1024 * 1024 * 1024)).toFixed(1)} GB`,
      `メモリ帯域幅: ${this.spec.memoryBandwidthGBs} GB/s`,
      `共有メモリ/SM: ${(this.spec.smSpec.sharedMemorySize / 1024).toFixed(0)} KB`,
      `レジスタ/SM: ${this.spec.smSpec.registersPerSM}`,
      `最大ワープ/SM: ${this.spec.smSpec.maxWarpsPerSM}`,
      `ピーク性能: ${this.peakGFLOPS.toFixed(1)} GFLOPS`,
    ];
    return lines.join('\n');
  }
}

/** デフォルトのGPUデバイス仕様（中規模GPU想定） */
export function createDefaultGPU(): GPUDevice {
  return new GPUDevice({
    name: 'SimGPU-1080',
    smCount: 20,
    smSpec: {
      coresPerSM: 128,
      maxWarpsPerSM: 64,
      sharedMemorySize: 48 * 1024,
      registersPerSM: 65536,
    },
    globalMemorySize: 8 * 1024 * 1024 * 1024,
    clockSpeedMHz: 1600,
    memoryBandwidthGBs: 320,
    constantMemorySize: 64 * 1024,
  });
}
