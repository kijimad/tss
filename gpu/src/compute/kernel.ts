/**
 * CUDAライクなコンピュートカーネルシミュレーション
 * グリッド次元、ブロック次元、スレッドインデックス（threadIdx, blockIdx, blockDim）、
 * 並列演算用の簡易命令セット
 */

/** 3次元インデックス */
export interface Dim3 {
  x: number;
  y: number;
  z: number;
}

/** スレッドコンテキスト: カーネル実行時の各スレッドが持つ情報 */
export interface ThreadContext {
  /** スレッドID（ブロック内） */
  threadIdx: Dim3;
  /** ブロックID（グリッド内） */
  blockIdx: Dim3;
  /** ブロック次元 */
  blockDim: Dim3;
  /** グリッド次元 */
  gridDim: Dim3;
}

/** カーネル関数の型 */
export type KernelFunction = (ctx: ThreadContext, args: KernelArgs) => void;

/** カーネル引数（Float32配列ベース） */
export interface KernelArgs {
  /** 入出力バッファ */
  buffers: Float32Array[];
  /** スカラーパラメータ */
  params: number[];
}

/** カーネル起動設定 */
export interface LaunchConfig {
  /** グリッド次元（ブロック数） */
  gridDim: Dim3;
  /** ブロック次元（スレッド数） */
  blockDim: Dim3;
}

/** カーネル実行結果 */
export interface KernelResult {
  /** 総スレッド数 */
  totalThreads: number;
  /** 総ブロック数 */
  totalBlocks: number;
  /** 実行済みスレッドコンテキスト一覧 */
  executedThreads: ThreadContext[];
  /** 実行時間（シミュレーション上のサイクル数） */
  executionCycles: number;
}

/** dim3ヘルパー：1次元の場合 */
export function dim3(x: number, y = 1, z = 1): Dim3 {
  return { x, y, z };
}

/** Dim3の総要素数 */
export function dim3Size(d: Dim3): number {
  return d.x * d.y * d.z;
}

/** グローバルスレッドIDを計算（1次元展開） */
export function globalThreadId(ctx: ThreadContext): number {
  const blockId =
    ctx.blockIdx.x +
    ctx.blockIdx.y * ctx.gridDim.x +
    ctx.blockIdx.z * ctx.gridDim.x * ctx.gridDim.y;
  const threadsPerBlock = dim3Size(ctx.blockDim);
  const localId =
    ctx.threadIdx.x +
    ctx.threadIdx.y * ctx.blockDim.x +
    ctx.threadIdx.z * ctx.blockDim.x * ctx.blockDim.y;
  return blockId * threadsPerBlock + localId;
}

/** カーネルランチャー: グリッド×ブロックでカーネル関数を実行 */
export function launchKernel(
  config: LaunchConfig,
  kernelFn: KernelFunction,
  args: KernelArgs
): KernelResult {
  const executedThreads: ThreadContext[] = [];
  const totalBlocks = dim3Size(config.gridDim);
  const totalThreads = totalBlocks * dim3Size(config.blockDim);

  // ブロック毎にスレッドを実行
  for (let bz = 0; bz < config.gridDim.z; bz++) {
    for (let by = 0; by < config.gridDim.y; by++) {
      for (let bx = 0; bx < config.gridDim.x; bx++) {
        // ブロック内の全スレッドを実行
        for (let tz = 0; tz < config.blockDim.z; tz++) {
          for (let ty = 0; ty < config.blockDim.y; ty++) {
            for (let tx = 0; tx < config.blockDim.x; tx++) {
              const ctx: ThreadContext = {
                threadIdx: { x: tx, y: ty, z: tz },
                blockIdx: { x: bx, y: by, z: bz },
                blockDim: config.blockDim,
                gridDim: config.gridDim,
              };
              kernelFn(ctx, args);
              executedThreads.push(ctx);
            }
          }
        }
      }
    }
  }

  // 実行サイクルの概算：各ワープ（32スレッド）が順次実行と想定
  const warpsCount = Math.ceil(totalThreads / 32);
  const executionCycles = warpsCount * 4; // ワープ毎に4サイクル（簡略化）

  return {
    totalThreads,
    totalBlocks,
    executedThreads,
    executionCycles,
  };
}

/** ベクトル加算カーネル: C[i] = A[i] + B[i] */
export const vectorAddKernel: KernelFunction = (ctx, args) => {
  const gid = globalThreadId(ctx);
  const a = args.buffers[0];
  const b = args.buffers[1];
  const c = args.buffers[2];
  if (a && b && c && gid < a.length) {
    c[gid] = (a[gid] ?? 0) + (b[gid] ?? 0);
  }
};

/** 行列乗算カーネル: C = A * B（正方行列、サイズNはparams[0]） */
export const matMulKernel: KernelFunction = (ctx, args) => {
  const n = args.params[0] ?? 0;
  const a = args.buffers[0];
  const b = args.buffers[1];
  const c = args.buffers[2];
  if (!a || !b || !c) return;

  const row = ctx.blockIdx.y * ctx.blockDim.y + ctx.threadIdx.y;
  const col = ctx.blockIdx.x * ctx.blockDim.x + ctx.threadIdx.x;

  if (row < n && col < n) {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += (a[row * n + k] ?? 0) * (b[k * n + col] ?? 0);
    }
    c[row * n + col] = sum;
  }
};

/** 並列リダクション（合計）カーネル: ブロック内で合計を計算 */
export const reductionKernel: KernelFunction = (ctx, args) => {
  const input = args.buffers[0];
  const output = args.buffers[1];
  if (!input || !output) return;

  const tid = ctx.threadIdx.x;
  const blockSize = ctx.blockDim.x;
  const blockStart = ctx.blockIdx.x * blockSize;

  // 各スレッドが担当する要素を取得（共有メモリ模倣）
  if (tid === 0) {
    // ブロック内の全要素を合計（簡略化：スレッド0が集約）
    let sum = 0;
    for (let i = 0; i < blockSize; i++) {
      const idx = blockStart + i;
      if (idx < input.length) {
        sum += input[idx] ?? 0;
      }
    }
    output[ctx.blockIdx.x] = sum;
  }
};
