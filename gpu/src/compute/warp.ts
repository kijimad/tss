/**
 * ワープ/ウェーブフロントの実行シミュレーション
 * 32スレッドSIMT実行、ワープダイバージェンス（if/elseの分岐）、
 * ワープスケジューラ、オキュパンシー計算
 */

/** ワープサイズ（NVIDIAの場合32スレッド） */
export const WARP_SIZE = 32;

/** 各スレッドの実行状態 */
export type ThreadState = 'active' | 'inactive' | 'diverged';

/** ワープ内スレッドの状態 */
export interface WarpState {
  /** ワープID */
  warpId: number;
  /** 各スレッドの状態 */
  threadStates: ThreadState[];
  /** 現在のプログラムカウンタ */
  pc: number;
  /** ワープがストール中かどうか */
  stalled: boolean;
  /** ストール理由 */
  stallReason: string | null;
}

/** 分岐結果: 各スレッドがtrue/falseどちらのパスを取るか */
export interface DivergenceResult {
  /** trueパスのスレッドマスク */
  trueMask: boolean[];
  /** falseパスのスレッドマスク */
  falseMask: boolean[];
  /** ダイバージェンスが発生したか（両パスにスレッドがいるか） */
  isDiverged: boolean;
  /** trueパスのスレッド数 */
  trueCount: number;
  /** falseパスのスレッド数 */
  falseCount: number;
  /** ダイバージェンスによる追加サイクル */
  penaltyCycles: number;
}

/** ワープ実行ユニット */
export class Warp {
  /** ワープID */
  readonly warpId: number;
  /** スレッド数（通常32） */
  readonly size: number;
  /** アクティブマスク: 各スレッドが有効かどうか */
  private activeMask: boolean[];
  /** プログラムカウンタ */
  private pc: number;
  /** 実行履歴 */
  private history: WarpState[];

  constructor(warpId: number, activeThreads = WARP_SIZE) {
    this.warpId = warpId;
    this.size = WARP_SIZE;
    // activeThreadsまでのスレッドをアクティブに設定
    this.activeMask = Array.from({ length: WARP_SIZE }, (_, i) => i < activeThreads);
    this.pc = 0;
    this.history = [];
  }

  /** 現在の状態を取得 */
  getState(): WarpState {
    return {
      warpId: this.warpId,
      threadStates: this.activeMask.map((active) => (active ? 'active' : 'inactive')),
      pc: this.pc,
      stalled: false,
      stallReason: null,
    };
  }

  /** アクティブスレッド数を取得 */
  getActiveCount(): number {
    return this.activeMask.filter(Boolean).length;
  }

  /** 分岐を評価: 各スレッドに条件関数を適用し、ダイバージェンスを検出 */
  evaluateBranch(condition: (threadLaneId: number) => boolean): DivergenceResult {
    const trueMask: boolean[] = [];
    const falseMask: boolean[] = [];
    let trueCount = 0;
    let falseCount = 0;

    for (let i = 0; i < this.size; i++) {
      const isActive = this.activeMask[i] ?? false;
      if (isActive) {
        const result = condition(i);
        trueMask.push(result);
        falseMask.push(!result);
        if (result) trueCount++;
        else falseCount++;
      } else {
        trueMask.push(false);
        falseMask.push(false);
      }
    }

    const isDiverged = trueCount > 0 && falseCount > 0;
    // ダイバージェンス発生時は両パスを逐次実行するためペナルティ
    const penaltyCycles = isDiverged ? 4 : 0;

    return { trueMask, falseMask, isDiverged, trueCount, falseCount, penaltyCycles };
  }

  /** SIMT命令を実行（アクティブスレッドに対して） */
  executeInstruction(instruction: string): void {
    this.history.push({
      ...this.getState(),
      threadStates: this.activeMask.map((a) => (a ? 'active' : 'inactive')),
    });
    this.pc++;
    // 命令のログ記録（簡略化）
    void instruction;
  }

  /** ダイバージェンス時のスレッド状態を可視化 */
  visualizeDivergence(divergence: DivergenceResult): string[] {
    const lines: string[] = [];
    lines.push(`ワープ ${this.warpId} ダイバージェンス解析:`);
    lines.push(`  ダイバージェンス: ${divergence.isDiverged ? 'あり' : 'なし'}`);
    lines.push(`  trueパス: ${divergence.trueCount}スレッド`);
    lines.push(`  falseパス: ${divergence.falseCount}スレッド`);
    lines.push(`  ペナルティ: ${divergence.penaltyCycles}サイクル`);

    // スレッドマスクの可視化
    let maskStr = '  スレッド: ';
    for (let i = 0; i < this.size; i++) {
      if (divergence.trueMask[i]) maskStr += 'T';
      else if (divergence.falseMask[i]) maskStr += 'F';
      else maskStr += '.';
    }
    lines.push(maskStr);

    return lines;
  }

  /** 実行履歴を取得 */
  getHistory(): readonly WarpState[] {
    return this.history;
  }
}

/** ワープスケジューラ: 複数ワープの実行順序を管理 */
export class WarpScheduler {
  /** 管理対象のワープ一覧 */
  private warps: Warp[];
  /** 現在の実行ワープインデックス */
  private currentIndex: number;
  /** 完了済みワープ数 */
  private completedWarps: number;

  constructor() {
    this.warps = [];
    this.currentIndex = 0;
    this.completedWarps = 0;
  }

  /** ワープを追加 */
  addWarp(warp: Warp): void {
    this.warps.push(warp);
  }

  /** 次に実行するワープを選択（ラウンドロビン） */
  selectNextWarp(): Warp | null {
    if (this.warps.length === 0) return null;
    const warp = this.warps[this.currentIndex % this.warps.length];
    this.currentIndex++;
    return warp ?? null;
  }

  /** 全ワープ数 */
  get totalWarps(): number {
    return this.warps.length;
  }

  /** 完了を記録 */
  markCompleted(): void {
    this.completedWarps++;
  }

  /** 完了済みワープ数 */
  get completed(): number {
    return this.completedWarps;
  }

  /** スケジューラをリセット */
  reset(): void {
    this.warps = [];
    this.currentIndex = 0;
    this.completedWarps = 0;
  }
}

/** オキュパンシー計算 */
export interface OccupancyConfig {
  /** SM当たりの最大ワープ数 */
  maxWarpsPerSM: number;
  /** SM当たりのレジスタ数 */
  registersPerSM: number;
  /** SM当たりの共有メモリサイズ */
  sharedMemoryPerSM: number;
  /** ブロック当たりのスレッド数 */
  threadsPerBlock: number;
  /** スレッド当たりのレジスタ使用数 */
  registersPerThread: number;
  /** ブロック当たりの共有メモリ使用量 */
  sharedMemoryPerBlock: number;
}

/** オキュパンシー計算結果 */
export interface OccupancyResult {
  /** ワープベースのオキュパンシー（0〜1） */
  occupancy: number;
  /** SM上のアクティブワープ数 */
  activeWarps: number;
  /** SM上の最大ワープ数 */
  maxWarps: number;
  /** 制限要因 */
  limitingFactor: 'warps' | 'registers' | 'shared_memory';
  /** SM上に配置可能なブロック数 */
  blocksPerSM: number;
}

/** オキュパンシーを計算 */
export function calculateOccupancy(config: OccupancyConfig): OccupancyResult {
  const warpsPerBlock = Math.ceil(config.threadsPerBlock / WARP_SIZE);

  // ワープ数による制限
  const maxBlocksByWarps = Math.floor(config.maxWarpsPerSM / warpsPerBlock);

  // レジスタ数による制限
  const regsPerBlock = config.registersPerThread * config.threadsPerBlock;
  const maxBlocksByRegs = regsPerBlock > 0
    ? Math.floor(config.registersPerSM / regsPerBlock)
    : maxBlocksByWarps;

  // 共有メモリによる制限
  const maxBlocksByShared = config.sharedMemoryPerBlock > 0
    ? Math.floor(config.sharedMemoryPerSM / config.sharedMemoryPerBlock)
    : maxBlocksByWarps;

  // 最も厳しい制限を適用
  const blocksPerSM = Math.min(maxBlocksByWarps, maxBlocksByRegs, maxBlocksByShared);

  // 制限要因を特定
  let limitingFactor: OccupancyResult['limitingFactor'] = 'warps';
  if (blocksPerSM === maxBlocksByRegs && maxBlocksByRegs < maxBlocksByWarps) {
    limitingFactor = 'registers';
  } else if (blocksPerSM === maxBlocksByShared && maxBlocksByShared < maxBlocksByWarps) {
    limitingFactor = 'shared_memory';
  }

  const activeWarps = blocksPerSM * warpsPerBlock;
  const occupancy = activeWarps / config.maxWarpsPerSM;

  return {
    occupancy: Math.min(occupancy, 1),
    activeWarps: Math.min(activeWarps, config.maxWarpsPerSM),
    maxWarps: config.maxWarpsPerSM,
    limitingFactor,
    blocksPerSM,
  };
}
