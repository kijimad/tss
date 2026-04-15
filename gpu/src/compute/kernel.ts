/**
 * CUDAライクなコンピュートカーネルシミュレーション
 *
 * GPUコンピューティングの中核概念:
 * - GPUは「超並列プロセッサ」であり、数千〜数万のスレッドを同時に実行できる
 * - CUDA/OpenCLでは、計算処理を「カーネル関数」として定義し、
 *   大量のスレッドで並列実行する（SIMT: Single Instruction, Multiple Threads）
 *
 * スレッド階層（CUDA用語）:
 * - グリッド（Grid）: カーネル起動単位。複数のブロックで構成される
 * - ブロック（Block / Thread Block）: SM上でスケジュールされる単位。
 *   ブロック内のスレッドは共有メモリを介して協調できる
 * - スレッド（Thread）: 最小の実行単位。各スレッドは固有のインデックスを持つ
 *   （threadIdx, blockIdx, blockDim, gridDim）
 *
 * 各スレッドは自身のインデックスを使って、担当するデータ要素を計算する。
 * 例: グローバルスレッドID = blockIdx * blockDim + threadIdx
 *
 * このモジュールでは、グリッド次元、ブロック次元、スレッドインデックス、
 * 並列演算用の簡易命令セット、代表的なカーネル（ベクトル加算、行列乗算、リダクション）を提供する。
 */

/**
 * 3次元インデックス（CUDAのdim3に対応）
 *
 * CUDAでは、グリッドやブロックのサイズを3次元で指定できる。
 * これにより、1次元配列、2次元画像、3次元ボリュームなど
 * 様々なデータ構造に対して自然なスレッド配置が可能になる。
 *
 * 例: 画像処理では blockDim = (16, 16, 1) として、
 *     16×16ピクセルのタイルを1ブロックで処理する。
 */
export interface Dim3 {
  x: number;
  y: number;
  z: number;
}

/**
 * スレッドコンテキスト: カーネル実行時の各スレッドが持つ情報
 *
 * CUDAカーネル内では、各スレッドが自身の位置を知るために
 * 以下の組み込み変数にアクセスする。これにより、
 * 各スレッドが自分の担当するデータ要素を特定できる。
 *
 * CPUとの違い: CPUでは逐次ループで要素を処理するが、
 * GPUでは全要素が同時に（並列に）処理される。
 */
export interface ThreadContext {
  /** スレッドID（ブロック内でのローカルインデックス） */
  threadIdx: Dim3;
  /** ブロックID（グリッド内でのブロック番号） */
  blockIdx: Dim3;
  /** ブロック次元（1ブロック内のスレッド数） */
  blockDim: Dim3;
  /** グリッド次元（グリッド内のブロック数） */
  gridDim: Dim3;
}

/**
 * カーネル関数の型
 *
 * GPUカーネルは全スレッドが同じ関数を実行するが、
 * threadIdx/blockIdxが異なるため、各スレッドは異なるデータを処理する。
 * これがSIMT（Single Instruction, Multiple Threads）の基本原理。
 */
export type KernelFunction = (ctx: ThreadContext, args: KernelArgs) => void;

/**
 * カーネル引数（Float32配列ベース）
 *
 * GPU上のカーネルには、グローバルメモリ（VRAM）上に確保された
 * バッファへのポインタとスカラー定数を渡す。
 * 実際のCUDAでは cudaMalloc でデバイスメモリを確保し、
 * cudaMemcpy でホスト↔デバイス間のデータ転送を行う。
 */
export interface KernelArgs {
  /** 入出力バッファ（グローバルメモリ上のデータ配列） */
  buffers: Float32Array[];
  /** スカラーパラメータ（カーネルへの定数引数） */
  params: number[];
}

/**
 * カーネル起動設定
 *
 * CUDAでのカーネル起動構文: kernel<<<gridDim, blockDim>>>(args)
 * - gridDim: グリッド内のブロック数を指定
 * - blockDim: 各ブロック内のスレッド数を指定
 *
 * ブロックサイズの選択は性能に大きく影響する:
 * - 小さすぎるとSMの利用率（オキュパンシー）が低下
 * - 大きすぎるとレジスタや共有メモリが不足してブロック数が制限される
 * - 一般に32の倍数（ワープサイズ）が推奨される
 */
export interface LaunchConfig {
  /** グリッド次元（ブロック数。データサイズに応じて決定する） */
  gridDim: Dim3;
  /** ブロック次元（ブロック内スレッド数。通常128〜1024） */
  blockDim: Dim3;
}

/**
 * カーネル実行結果
 *
 * 実際のGPUでは、CUDA Profiler（nsight）等で
 * カーネルの実行時間、スレッド数、メモリスループット等を計測する。
 * このシミュレーターでは、ワープ単位の実行サイクルを概算している。
 */
export interface KernelResult {
  /** 総スレッド数（gridDim × blockDim の全要素数） */
  totalThreads: number;
  /** 総ブロック数（gridDim の全要素数） */
  totalBlocks: number;
  /** 実行済みスレッドコンテキスト一覧（デバッグ・可視化用） */
  executedThreads: ThreadContext[];
  /** 実行時間（シミュレーション上のサイクル数。ワープ単位の概算） */
  executionCycles: number;
}

/**
 * dim3ヘルパー: 未指定の次元はデフォルト1で3次元インデックスを生成
 *
 * CUDAでは dim3 gridDim(4) のように1次元指定すると y=1, z=1 になる。
 * 1次元配列の処理では dim3(N) で十分だが、
 * 2次元行列なら dim3(cols, rows)、3次元ボリュームなら dim3(x, y, z) を使う。
 */
export function dim3(x: number, y = 1, z = 1): Dim3 {
  return { x, y, z };
}

/**
 * Dim3の総要素数を計算
 *
 * 3次元空間の全要素数 = x * y * z。
 * ブロック内の総スレッド数やグリッド内の総ブロック数の計算に使用する。
 */
export function dim3Size(d: Dim3): number {
  return d.x * d.y * d.z;
}

/**
 * グローバルスレッドIDを計算（3次元→1次元の線形インデックスへ展開）
 *
 * 多次元のスレッド階層を1次元の連番IDに変換する。
 * これにより、各スレッドが1次元配列の何番目の要素を担当するかが決まる。
 *
 * 計算式:
 *   blockId = blockIdx.x + blockIdx.y * gridDim.x + blockIdx.z * gridDim.x * gridDim.y
 *   localId = threadIdx.x + threadIdx.y * blockDim.x + threadIdx.z * blockDim.x * blockDim.y
 *   globalId = blockId * threadsPerBlock + localId
 *
 * メモリコアレッシング（メモリアクセスの結合）の観点から、
 * 隣接するスレッド（連続するglobalId）が連続するメモリアドレスに
 * アクセスするようにデータ配置することが重要。
 */
export function globalThreadId(ctx: ThreadContext): number {
  // ブロックの線形インデックスを計算（行優先展開）
  const blockId =
    ctx.blockIdx.x +
    ctx.blockIdx.y * ctx.gridDim.x +
    ctx.blockIdx.z * ctx.gridDim.x * ctx.gridDim.y;
  const threadsPerBlock = dim3Size(ctx.blockDim);
  // ブロック内のスレッドの線形インデックスを計算
  const localId =
    ctx.threadIdx.x +
    ctx.threadIdx.y * ctx.blockDim.x +
    ctx.threadIdx.z * ctx.blockDim.x * ctx.blockDim.y;
  return blockId * threadsPerBlock + localId;
}

/**
 * カーネルランチャー: グリッド×ブロックでカーネル関数を全スレッドに対して実行
 *
 * 実際のGPUでは:
 * 1. ブロックがワープスケジューラによってSM（Streaming Multiprocessor）に割り当てられる
 * 2. 各ブロック内のスレッドは32スレッド単位の「ワープ」にグループ化される
 * 3. ワープ内の全スレッドが同じ命令を同時実行する（SIMT方式）
 * 4. メモリアクセス待ちのワープは一時停止し、別のワープが実行される（レイテンシ隠蔽）
 *
 * このシミュレーターでは逐次的に全スレッドを実行するが、
 * 実際のGPUでは大量のワープが並列かつインターリーブで実行される。
 */
export function launchKernel(
  config: LaunchConfig,
  kernelFn: KernelFunction,
  args: KernelArgs
): KernelResult {
  const executedThreads: ThreadContext[] = [];
  const totalBlocks = dim3Size(config.gridDim);
  const totalThreads = totalBlocks * dim3Size(config.blockDim);

  // グリッド内の全ブロックを走査（実際のGPUではSMに動的にディスパッチされる）
  for (let bz = 0; bz < config.gridDim.z; bz++) {
    for (let by = 0; by < config.gridDim.y; by++) {
      for (let bx = 0; bx < config.gridDim.x; bx++) {
        // ブロック内の全スレッドを実行
        // 実際のGPUではワープ（32スレッド）単位でSIMT実行される
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
  // 実際のGPUでは複数ワープが同時実行されるため、
  // スループットはオキュパンシー（SM上のアクティブワープ数）に大きく依存する
  const warpsCount = Math.ceil(totalThreads / 32);
  const executionCycles = warpsCount * 4; // ワープ毎に4サイクル（簡略化）

  return {
    totalThreads,
    totalBlocks,
    executedThreads,
    executionCycles,
  };
}

/**
 * ベクトル加算カーネル: C[i] = A[i] + B[i]
 *
 * GPUプログラミングの最も基本的なパターン。
 * 各スレッドが配列の1要素を担当し、独立に加算を行う。
 * データ間に依存関係がないため、完全並列（Embarrassingly Parallel）に実行できる。
 *
 * メモリコアレッシング: 隣接スレッド（連続するglobalThreadId）が
 * 連続するメモリアドレスにアクセスするため、最適なメモリアクセスパターンとなる。
 */
export const vectorAddKernel: KernelFunction = (ctx, args) => {
  // グローバルスレッドIDをインデックスとして使い、1スレッド1要素を処理
  const gid = globalThreadId(ctx);
  const a = args.buffers[0];
  const b = args.buffers[1];
  const c = args.buffers[2];
  // 配列サイズを超えるスレッドは何もしない（スレッド数 > データ数の場合の境界チェック）
  if (a && b && c && gid < a.length) {
    c[gid] = (a[gid] ?? 0) + (b[gid] ?? 0);
  }
};

/**
 * 行列乗算カーネル: C = A * B（正方行列、サイズNはparams[0]）
 *
 * 2次元スレッドブロックを使い、各スレッドがC行列の1要素を計算する。
 * blockIdx/threadIdxの2次元インデックスを使って行と列を決定する。
 *
 * 高速化のポイント（本シミュレーターでは未実装）:
 * - タイル化（Tiling）: 共有メモリにサブ行列をロードして再利用
 *   → グローバルメモリアクセスを大幅に削減
 * - メモリコアレッシング: B行列の列方向アクセスは非効率。
 *   転置やタイル化で改善可能
 * - 実際のcuBLASではSM毎に最適化されたタイルサイズを使用
 */
export const matMulKernel: KernelFunction = (ctx, args) => {
  const n = args.params[0] ?? 0;
  const a = args.buffers[0];
  const b = args.buffers[1];
  const c = args.buffers[2];
  if (!a || !b || !c) return;

  // 2次元スレッドインデックスから担当する行と列を計算
  const row = ctx.blockIdx.y * ctx.blockDim.y + ctx.threadIdx.y;
  const col = ctx.blockIdx.x * ctx.blockDim.x + ctx.threadIdx.x;

  if (row < n && col < n) {
    // 内積の計算: C[row][col] = Σ(k=0..n-1) A[row][k] * B[k][col]
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += (a[row * n + k] ?? 0) * (b[k * n + col] ?? 0);
    }
    c[row * n + col] = sum;
  }
};

/**
 * 並列リダクション（合計）カーネル: ブロック内で部分和を計算
 *
 * リダクションはGPU並列アルゴリズムの基本パターンの一つ。
 * 大量のデータを集約（合計、最大値、最小値等）する際に使用する。
 *
 * 本来の並列リダクションのアルゴリズム（ツリーリダクション）:
 * 1. 全スレッドがデータを共有メモリにロード
 * 2. ストライドを半分ずつ減らしながらペアで加算
 *   ステップ1: スレッド0がdata[0]+data[stride], スレッド1がdata[1]+data[stride+1]...
 *   ステップ2: ストライドを半分に...
 * 3. 最終的にスレッド0に合計値が集まる
 *
 * このシミュレーターでは簡略化のため、各ブロックのスレッド0が
 * ブロック内の全要素を逐次合計している。
 * 各ブロックの部分和を最終的にホスト側またはもう一段のカーネルで集約する。
 */
export const reductionKernel: KernelFunction = (ctx, args) => {
  const input = args.buffers[0];
  const output = args.buffers[1];
  if (!input || !output) return;

  const tid = ctx.threadIdx.x;
  const blockSize = ctx.blockDim.x;
  const blockStart = ctx.blockIdx.x * blockSize;

  // 簡略化: スレッド0のみがブロック内の全要素を集約
  // 実際のGPUでは共有メモリとsyncthreads()を使った並列ツリーリダクションを行う
  if (tid === 0) {
    let sum = 0;
    for (let i = 0; i < blockSize; i++) {
      const idx = blockStart + i;
      if (idx < input.length) {
        sum += input[idx] ?? 0;
      }
    }
    // ブロック毎の部分和を出力配列に書き込む
    output[ctx.blockIdx.x] = sum;
  }
};
