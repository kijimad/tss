/**
 * GPUシミュレーターのテストスイート
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GPUDevice, createDefaultGPU } from '../hw/device';
import { MemoryRegion, GPUMemorySystem, DEFAULT_LATENCY } from '../hw/memory';
import {
  dim3,
  dim3Size,
  globalThreadId,
  launchKernel,
  vectorAddKernel,
  matMulKernel,
  reductionKernel,
} from '../compute/kernel';
import type { ThreadContext } from '../compute/kernel';
import { Warp, WarpScheduler, calculateOccupancy, WARP_SIZE } from '../compute/warp';
import {
  Framebuffer,
  assembleTriangles,
  rasterizeTriangle,
  executeRenderPipeline,
} from '../render/pipeline';
import type { Vertex, TransformedVertex, Color } from '../render/pipeline';
import {
  mat4Identity,
  mat4Multiply,
  mat4MultiplyVec4,
  mat4Translate,
  mat4Scale,
  mat4RotateY,
  mat4Perspective,
  createCheckerTexture,
  sampleTexture,
  createVertexShader,
  createFragmentShader,
} from '../render/shader';

// ============================================================
// GPUデバイス テスト
// ============================================================
describe('GPUDevice', () => {
  let gpu: GPUDevice;

  beforeEach(() => {
    gpu = createDefaultGPU();
  });

  it('デフォルトGPUが正しい仕様で作成される', () => {
    expect(gpu.spec.name).toBe('SimGPU-1080');
    expect(gpu.spec.smCount).toBe(20);
    expect(gpu.spec.smSpec.coresPerSM).toBe(128);
  });

  it('総コア数が正しく計算される', () => {
    expect(gpu.totalCores).toBe(20 * 128);
  });

  it('ピークGFLOPSが正しく計算される', () => {
    // 2560コア × 1600MHz × 2FLOP / 1000
    const expected = (2560 * 1600 * 2) / 1000;
    expect(gpu.peakGFLOPS).toBe(expected);
  });

  it('オキュパンシーが正しく計算される', () => {
    gpu.setActiveWarps(0, 32);
    expect(gpu.getOccupancy(0)).toBe(32 / 64);
  });

  it('平均オキュパンシーが正しく計算される', () => {
    gpu.setActiveWarps(0, 64); // 100%
    gpu.setActiveWarps(1, 32); // 50%
    // 残りは0%なので合計 = (64 + 32) / (20 * 64)
    const expected = 96 / (20 * 64);
    expect(gpu.getAverageOccupancy()).toBeCloseTo(expected);
  });

  it('無効なSMインデックスでエラーが投げられる', () => {
    expect(() => gpu.setActiveWarps(-1, 0)).toThrow('無効なSMインデックス');
    expect(() => gpu.setActiveWarps(100, 0)).toThrow('無効なSMインデックス');
  });

  it('無効なワープ数でエラーが投げられる', () => {
    expect(() => gpu.setActiveWarps(0, -1)).toThrow('無効なワープ数');
    expect(() => gpu.setActiveWarps(0, 100)).toThrow('無効なワープ数');
  });

  it('グローバルメモリの割り当てと解放が動作する', () => {
    expect(gpu.allocateGlobalMemory(1024)).toBe(true);
    expect(gpu.getState().globalMemoryUsed).toBe(1024);
    gpu.freeGlobalMemory(512);
    expect(gpu.getState().globalMemoryUsed).toBe(512);
  });

  it('メモリ上限を超える割り当てが失敗する', () => {
    expect(gpu.allocateGlobalMemory(gpu.spec.globalMemorySize + 1)).toBe(false);
  });

  it('サイクルの進行が記録される', () => {
    gpu.advanceCycles(100);
    expect(gpu.getState().totalCycles).toBe(100);
  });

  it('リセットが正しく動作する', () => {
    gpu.setActiveWarps(0, 32);
    gpu.allocateGlobalMemory(1024);
    gpu.advanceCycles(100);
    gpu.reset();
    expect(gpu.getState().globalMemoryUsed).toBe(0);
    expect(gpu.getState().totalCycles).toBe(0);
    expect(gpu.getOccupancy(0)).toBe(0);
  });

  it('スペックサマリーが文字列を返す', () => {
    const summary = gpu.getSpecSummary();
    expect(summary).toContain('SimGPU-1080');
    expect(summary).toContain('SM数');
    expect(summary).toContain('GFLOPS');
  });
});

// ============================================================
// メモリ階層 テスト
// ============================================================
describe('MemoryRegion', () => {
  let region: MemoryRegion;

  beforeEach(() => {
    region = new MemoryRegion('global', 1024, 400);
  });

  it('読み書きが正しく動作する', () => {
    region.write(0, 42.0);
    const result = region.read(0);
    expect(result.value).toBe(42.0);
    expect(result.latency).toBe(400);
  });

  it('アクセス統計が正しく記録される', () => {
    region.write(0, 1);
    region.write(1, 2);
    region.read(0);
    const stats = region.getAccessStats();
    expect(stats.reads).toBe(1);
    expect(stats.writes).toBe(2);
    expect(stats.totalLatency).toBe(400 * 3);
  });

  it('範囲外アクセスでエラーが投げられる', () => {
    // 1024バイト / 4 = 256要素
    expect(() => region.read(300)).toThrow('メモリアクセス違反');
    expect(() => region.write(-1, 0)).toThrow('メモリアクセス違反');
  });

  it('一括読み書きが動作する', () => {
    region.writeBulk(0, [10, 20, 30]);
    const result = region.readBulk(0, 3);
    expect(result.values).toEqual([10, 20, 30]);
  });

  it('リセットが正しく動作する', () => {
    region.write(0, 99);
    region.reset();
    const result = region.read(0);
    expect(result.value).toBe(0);
    expect(region.getAccessLog().length).toBe(1); // リセット後の読み出しのみ
  });

  it('データスナップショットが取得できる', () => {
    region.write(0, 5);
    region.write(1, 10);
    const snap = region.getDataSnapshot(0, 3);
    expect(snap).toEqual([5, 10, 0]);
  });
});

describe('GPUMemorySystem', () => {
  it('各メモリ領域に正しいレイテンシが設定される', () => {
    const mem = new GPUMemorySystem(4096, 2048, 1024, 256);
    expect(mem.global.latency).toBe(DEFAULT_LATENCY.global);
    expect(mem.shared.latency).toBe(DEFAULT_LATENCY.shared);
    expect(mem.registers.latency).toBe(DEFAULT_LATENCY.register);
    expect(mem.constant.latency).toBe(DEFAULT_LATENCY.constant);
  });

  it('getRegionが正しい領域を返す', () => {
    const mem = new GPUMemorySystem(4096, 2048, 1024, 256);
    expect(mem.getRegion('global')).toBe(mem.global);
    expect(mem.getRegion('shared')).toBe(mem.shared);
    expect(mem.getRegion('register')).toBe(mem.registers);
    expect(mem.getRegion('constant')).toBe(mem.constant);
  });

  it('全統計が取得できる', () => {
    const mem = new GPUMemorySystem(4096, 2048, 1024, 256);
    mem.global.write(0, 1);
    mem.shared.write(0, 2);
    const stats = mem.getAllStats();
    expect(stats.global.writes).toBe(1);
    expect(stats.shared.writes).toBe(1);
  });

  it('全リセットが動作する', () => {
    const mem = new GPUMemorySystem(4096, 2048, 1024, 256);
    mem.global.write(0, 99);
    mem.resetAll();
    expect(mem.global.read(0).value).toBe(0);
  });
});

// ============================================================
// コンピュートカーネル テスト
// ============================================================
describe('Kernel', () => {
  it('dim3が正しく生成される', () => {
    const d = dim3(4, 2, 1);
    expect(d).toEqual({ x: 4, y: 2, z: 1 });
  });

  it('dim3Sizeが正しく計算される', () => {
    expect(dim3Size(dim3(4, 2, 3))).toBe(24);
  });

  it('globalThreadIdが正しく計算される', () => {
    const ctx: ThreadContext = {
      threadIdx: { x: 5, y: 0, z: 0 },
      blockIdx: { x: 2, y: 0, z: 0 },
      blockDim: { x: 32, y: 1, z: 1 },
      gridDim: { x: 4, y: 1, z: 1 },
    };
    // blockId=2, threadsPerBlock=32, localId=5 → 2*32+5=69
    expect(globalThreadId(ctx)).toBe(69);
  });

  it('2次元グリッドのglobalThreadIdが正しい', () => {
    const ctx: ThreadContext = {
      threadIdx: { x: 1, y: 2, z: 0 },
      blockIdx: { x: 1, y: 1, z: 0 },
      blockDim: { x: 4, y: 4, z: 1 },
      gridDim: { x: 2, y: 2, z: 1 },
    };
    // blockId = 1 + 1*2 = 3, threadsPerBlock = 16, localId = 1 + 2*4 = 9
    // globalId = 3*16 + 9 = 57
    expect(globalThreadId(ctx)).toBe(57);
  });

  it('ベクトル加算カーネルが正しく動作する', () => {
    const n = 64;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) { a[i] = i; b[i] = i * 10; }

    launchKernel(
      { gridDim: dim3(2), blockDim: dim3(32) },
      vectorAddKernel,
      { buffers: [a, b, c], params: [] }
    );

    for (let i = 0; i < n; i++) {
      expect(c[i]).toBe(i + i * 10);
    }
  });

  it('行列乗算カーネルが正しく動作する', () => {
    const n = 2;
    // A = [[1,2],[3,4]], B = [[5,6],[7,8]]
    const a = new Float32Array([1, 2, 3, 4]);
    const b = new Float32Array([5, 6, 7, 8]);
    const c = new Float32Array(n * n);

    launchKernel(
      { gridDim: dim3(1, 1), blockDim: dim3(n, n) },
      matMulKernel,
      { buffers: [a, b, c], params: [n] }
    );

    // C = A * B = [[1*5+2*7, 1*6+2*8], [3*5+4*7, 3*6+4*8]] = [[19,22],[43,50]]
    expect(c[0]).toBe(19);
    expect(c[1]).toBe(22);
    expect(c[2]).toBe(43);
    expect(c[3]).toBe(50);
  });

  it('並列リダクションが正しく合計する', () => {
    const input = new Float32Array(64);
    for (let i = 0; i < 64; i++) input[i] = 1;
    const output = new Float32Array(2);

    launchKernel(
      { gridDim: dim3(2), blockDim: dim3(32) },
      reductionKernel,
      { buffers: [input, output], params: [] }
    );

    expect(output[0]).toBe(32);
    expect(output[1]).toBe(32);
  });

  it('カーネル実行結果が正しい統計を返す', () => {
    const result = launchKernel(
      { gridDim: dim3(4), blockDim: dim3(32) },
      vectorAddKernel,
      { buffers: [new Float32Array(128), new Float32Array(128), new Float32Array(128)], params: [] }
    );
    expect(result.totalThreads).toBe(128);
    expect(result.totalBlocks).toBe(4);
    expect(result.executedThreads.length).toBe(128);
    expect(result.executionCycles).toBeGreaterThan(0);
  });
});

// ============================================================
// ワープ テスト
// ============================================================
describe('Warp', () => {
  it('ワープサイズが32', () => {
    expect(WARP_SIZE).toBe(32);
  });

  it('全スレッドがアクティブなワープを作成できる', () => {
    const warp = new Warp(0);
    expect(warp.getActiveCount()).toBe(32);
  });

  it('部分的にアクティブなワープを作成できる', () => {
    const warp = new Warp(0, 16);
    expect(warp.getActiveCount()).toBe(16);
  });

  it('ダイバージェンスなしの分岐を検出できる', () => {
    const warp = new Warp(0);
    const result = warp.evaluateBranch(() => true);
    expect(result.isDiverged).toBe(false);
    expect(result.trueCount).toBe(32);
    expect(result.falseCount).toBe(0);
    expect(result.penaltyCycles).toBe(0);
  });

  it('ダイバージェンスありの分岐を検出できる', () => {
    const warp = new Warp(0);
    const result = warp.evaluateBranch((laneId) => laneId % 2 === 0);
    expect(result.isDiverged).toBe(true);
    expect(result.trueCount).toBe(16);
    expect(result.falseCount).toBe(16);
    expect(result.penaltyCycles).toBe(4);
  });

  it('ダイバージェンスの可視化が正しいフォーマットを返す', () => {
    const warp = new Warp(0);
    const result = warp.evaluateBranch((laneId) => laneId < 8);
    const lines = warp.visualizeDivergence(result);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('ワープ 0');
  });

  it('命令実行で履歴が記録される', () => {
    const warp = new Warp(0);
    warp.executeInstruction('ADD');
    warp.executeInstruction('MUL');
    expect(warp.getHistory().length).toBe(2);
  });
});

describe('WarpScheduler', () => {
  it('ワープの追加と選択ができる', () => {
    const scheduler = new WarpScheduler();
    const w0 = new Warp(0);
    const w1 = new Warp(1);
    scheduler.addWarp(w0);
    scheduler.addWarp(w1);
    expect(scheduler.totalWarps).toBe(2);

    const selected = scheduler.selectNextWarp();
    expect(selected).toBe(w0);
  });

  it('ラウンドロビンで選択される', () => {
    const scheduler = new WarpScheduler();
    scheduler.addWarp(new Warp(0));
    scheduler.addWarp(new Warp(1));

    const first = scheduler.selectNextWarp();
    const second = scheduler.selectNextWarp();
    const third = scheduler.selectNextWarp();
    expect(first?.warpId).toBe(0);
    expect(second?.warpId).toBe(1);
    expect(third?.warpId).toBe(0); // ラウンドロビン
  });

  it('空のスケジューラからはnullが返る', () => {
    const scheduler = new WarpScheduler();
    expect(scheduler.selectNextWarp()).toBeNull();
  });

  it('完了カウントが記録される', () => {
    const scheduler = new WarpScheduler();
    scheduler.markCompleted();
    scheduler.markCompleted();
    expect(scheduler.completed).toBe(2);
  });

  it('リセットが動作する', () => {
    const scheduler = new WarpScheduler();
    scheduler.addWarp(new Warp(0));
    scheduler.markCompleted();
    scheduler.reset();
    expect(scheduler.totalWarps).toBe(0);
    expect(scheduler.completed).toBe(0);
  });
});

describe('Occupancy', () => {
  it('ワープ制限でのオキュパンシーが正しい', () => {
    const result = calculateOccupancy({
      maxWarpsPerSM: 64,
      registersPerSM: 65536,
      sharedMemoryPerSM: 49152,
      threadsPerBlock: 256,
      registersPerThread: 16,
      sharedMemoryPerBlock: 0,
    });
    // 256スレッド = 8ワープ/ブロック
    // レジスタ制限: 65536 / (16*256) = 16ブロック
    // ワープ制限: 64 / 8 = 8ブロック → 8ブロックが最小
    expect(result.blocksPerSM).toBe(8);
    expect(result.activeWarps).toBe(64);
    expect(result.occupancy).toBe(1.0);
  });

  it('レジスタ制限が正しく適用される', () => {
    const result = calculateOccupancy({
      maxWarpsPerSM: 64,
      registersPerSM: 65536,
      sharedMemoryPerSM: 49152,
      threadsPerBlock: 256,
      registersPerThread: 128,
      sharedMemoryPerBlock: 0,
    });
    // レジスタ制限: 65536 / (128*256) = 2ブロック
    // ワープ制限: 64/8 = 8ブロック
    // 最小は2 → 2*8 = 16ワープ → occupancy = 16/64 = 0.25
    expect(result.blocksPerSM).toBe(2);
    expect(result.limitingFactor).toBe('registers');
    expect(result.occupancy).toBe(0.25);
  });

  it('共有メモリ制限が正しく適用される', () => {
    const result = calculateOccupancy({
      maxWarpsPerSM: 64,
      registersPerSM: 65536,
      sharedMemoryPerSM: 49152,
      threadsPerBlock: 256,
      registersPerThread: 16,
      sharedMemoryPerBlock: 16384,
    });
    // 共有メモリ制限: 49152 / 16384 = 3ブロック
    // レジスタ制限: 65536 / (16*256) = 16ブロック
    // ワープ制限: 8ブロック
    // 最小は3
    expect(result.blocksPerSM).toBe(3);
    expect(result.limitingFactor).toBe('shared_memory');
  });
});

// ============================================================
// レンダリングパイプライン テスト
// ============================================================
describe('Framebuffer', () => {
  it('作成時にバッファが初期化される', () => {
    const fb = new Framebuffer(4, 4);
    expect(fb.width).toBe(4);
    expect(fb.height).toBe(4);
    expect(fb.colorBuffer.length).toBe(4 * 4 * 4);
    expect(fb.depthBuffer.length).toBe(4 * 4);
  });

  it('ピクセルの書き込みと読み出しが動作する', () => {
    const fb = new Framebuffer(4, 4);
    fb.clear();
    const color: Color = { r: 1, g: 0.5, b: 0.25, a: 1 };
    const written = fb.writePixel(1, 1, 0.5, color);
    expect(written).toBe(true);

    const readColor = fb.readPixel(1, 1);
    expect(readColor).not.toBeNull();
    expect(readColor!.r).toBeCloseTo(1);
    expect(readColor!.g).toBeCloseTo(0.5);
    expect(readColor!.b).toBeCloseTo(0.25);
  });

  it('深度テストが動作する', () => {
    const fb = new Framebuffer(4, 4);
    fb.clear();
    // depth=0.5を書き込み
    fb.writePixel(0, 0, 0.5, { r: 1, g: 0, b: 0, a: 1 });
    // depth=0.8は遠いので上書きされない
    const result = fb.writePixel(0, 0, 0.8, { r: 0, g: 1, b: 0, a: 1 });
    expect(result).toBe(false);
    expect(fb.readPixel(0, 0)!.r).toBeCloseTo(1); // 赤のまま
  });

  it('範囲外のピクセル書き込みが失敗する', () => {
    const fb = new Framebuffer(4, 4);
    expect(fb.writePixel(-1, 0, 0, { r: 0, g: 0, b: 0, a: 0 })).toBe(false);
    expect(fb.writePixel(4, 0, 0, { r: 0, g: 0, b: 0, a: 0 })).toBe(false);
  });

  it('範囲外のピクセル読み出しがnullを返す', () => {
    const fb = new Framebuffer(4, 4);
    expect(fb.readPixel(-1, 0)).toBeNull();
    expect(fb.readPixel(0, 4)).toBeNull();
  });

  it('クリアが動作する', () => {
    const fb = new Framebuffer(2, 2);
    fb.writePixel(0, 0, 0, { r: 1, g: 1, b: 1, a: 1 });
    fb.clear({ r: 0, g: 0, b: 0, a: 1 });
    expect(fb.readPixel(0, 0)!.r).toBe(0);
  });

  it('toUint8Arrayが正しく変換される', () => {
    const fb = new Framebuffer(1, 1);
    fb.clear();
    fb.writePixel(0, 0, 0, { r: 1, g: 0.5, b: 0, a: 1 });
    const arr = fb.toUint8Array();
    expect(arr[0]).toBe(255);
    expect(arr[1]).toBe(128);
    expect(arr[2]).toBe(0);
    expect(arr[3]).toBe(255);
  });
});

describe('assembleTriangles', () => {
  it('3頂点から1三角形が組み立てられる', () => {
    const vertices: TransformedVertex[] = [
      makeTransformedVertex(0, 0),
      makeTransformedVertex(10, 0),
      makeTransformedVertex(5, 10),
    ];
    const triangles = assembleTriangles(vertices);
    expect(triangles.length).toBe(1);
  });

  it('6頂点から2三角形が組み立てられる', () => {
    const vertices: TransformedVertex[] = Array.from({ length: 6 }, (_, i) =>
      makeTransformedVertex(i * 10, i * 5)
    );
    const triangles = assembleTriangles(vertices);
    expect(triangles.length).toBe(2);
  });

  it('2頂点では三角形が作れない', () => {
    const vertices: TransformedVertex[] = [
      makeTransformedVertex(0, 0),
      makeTransformedVertex(10, 0),
    ];
    const triangles = assembleTriangles(vertices);
    expect(triangles.length).toBe(0);
  });
});

describe('rasterizeTriangle', () => {
  it('小さな三角形からフラグメントが生成される', () => {
    const triangle = {
      v0: makeTransformedVertex(5, 0),
      v1: makeTransformedVertex(0, 10),
      v2: makeTransformedVertex(10, 10),
    };
    const fragments = rasterizeTriangle(triangle, 16, 16);
    expect(fragments.length).toBeGreaterThan(0);
  });

  it('画面外の三角形はフラグメントを生成しない', () => {
    const triangle = {
      v0: makeTransformedVertex(-100, -100),
      v1: makeTransformedVertex(-90, -100),
      v2: makeTransformedVertex(-95, -90),
    };
    const fragments = rasterizeTriangle(triangle, 16, 16);
    expect(fragments.length).toBe(0);
  });
});

describe('executeRenderPipeline', () => {
  it('三角形のレンダリングパイプラインが実行される', () => {
    const fb = new Framebuffer(32, 32);
    fb.clear();

    const vertices: Vertex[] = [
      makeVertex(0, 0.5, 0, { r: 1, g: 0, b: 0, a: 1 }),
      makeVertex(-0.5, -0.5, 0, { r: 0, g: 1, b: 0, a: 1 }),
      makeVertex(0.5, -0.5, 0, { r: 0, g: 0, b: 1, a: 1 }),
    ];

    const vertexShader = createVertexShader(mat4Identity(), fb.width, fb.height);
    const fragmentShader = createFragmentShader(null);

    const stats = executeRenderPipeline(vertices, fb, vertexShader, fragmentShader);
    expect(stats.inputVertices).toBe(3);
    expect(stats.triangles).toBe(1);
    expect(stats.fragments).toBeGreaterThan(0);
    expect(stats.writtenPixels).toBeGreaterThan(0);
  });
});

// ============================================================
// シェーダ テスト
// ============================================================
describe('Mat4', () => {
  it('単位行列×ベクトルが元のベクトルを返す', () => {
    const v = { x: 1, y: 2, z: 3, w: 1 };
    const result = mat4MultiplyVec4(mat4Identity(), v);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(3);
    expect(result.w).toBeCloseTo(1);
  });

  it('平行移動行列が正しく動作する', () => {
    const t = mat4Translate(5, 10, 15);
    const v = { x: 0, y: 0, z: 0, w: 1 };
    const result = mat4MultiplyVec4(t, v);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(10);
    expect(result.z).toBeCloseTo(15);
  });

  it('スケーリング行列が正しく動作する', () => {
    const s = mat4Scale(2, 3, 4);
    const v = { x: 1, y: 1, z: 1, w: 1 };
    const result = mat4MultiplyVec4(s, v);
    expect(result.x).toBeCloseTo(2);
    expect(result.y).toBeCloseTo(3);
    expect(result.z).toBeCloseTo(4);
  });

  it('行列乗算の結合法則を満たす', () => {
    const a = mat4Translate(1, 0, 0);
    const b = mat4Scale(2, 2, 2);
    const c = mat4RotateY(0.5);

    const ab_c = mat4Multiply(mat4Multiply(a, b), c);
    const a_bc = mat4Multiply(a, mat4Multiply(b, c));

    for (let i = 0; i < 16; i++) {
      expect(ab_c[i]).toBeCloseTo(a_bc[i]!, 5);
    }
  });

  it('Y軸回転行列が正しく動作する', () => {
    // 90度回転: (1,0,0) → (0,0,-1)（右手座標系）
    const r = mat4RotateY(Math.PI / 2);
    const v = { x: 1, y: 0, z: 0, w: 1 };
    const result = mat4MultiplyVec4(r, v);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(-1, 5);
  });
});

describe('Texture', () => {
  it('チェッカーテクスチャが正しいサイズで生成される', () => {
    const tex = createCheckerTexture(8, 8);
    expect(tex.width).toBe(8);
    expect(tex.height).toBe(8);
    expect(tex.data.length).toBe(8 * 8 * 4);
  });

  it('テクスチャサンプリングが動作する', () => {
    const tex = createCheckerTexture(8, 8);
    const c = sampleTexture(tex, 0, 0);
    expect(c.a).toBeGreaterThan(0);
  });

  it('UV座標のラップが正しく動作する', () => {
    const tex = createCheckerTexture(4, 4);
    // u=1.5はラップして0.5相当
    const c1 = sampleTexture(tex, 0.5, 0.5);
    const c2 = sampleTexture(tex, 1.5, 1.5);
    expect(c1.r).toBeCloseTo(c2.r);
    expect(c1.g).toBeCloseTo(c2.g);
  });
});

describe('VertexShader', () => {
  it('単位行列でスクリーン中心に射影される', () => {
    const vs = createVertexShader(mat4Identity(), 100, 100);
    const vertex = makeVertex(0, 0, 0, { r: 1, g: 1, b: 1, a: 1 });
    const result = vs(vertex);
    expect(result.screenX).toBeCloseTo(50);
    expect(result.screenY).toBeCloseTo(50);
  });
});

describe('FragmentShader', () => {
  it('テクスチャなしで頂点色がそのまま出力される', () => {
    const fs = createFragmentShader(null, { x: 0, y: 0, z: 1 }, 1.0);
    const fragment = makeFragment(0, 0, { r: 1, g: 0.5, b: 0.25, a: 1 });
    const color = fs(fragment);
    expect(color.r).toBeCloseTo(1);
    expect(color.g).toBeCloseTo(0.5);
    expect(color.b).toBeCloseTo(0.25);
  });

  it('ライティングが色を暗くする', () => {
    const fs = createFragmentShader(null, { x: 0, y: 0, z: 1 }, 0.2);
    // 法線がZ方向で光もZ方向→フルライティング
    const frag1 = makeFragment(0, 0, { r: 1, g: 1, b: 1, a: 1 }, { x: 0, y: 0, z: 1 });
    const c1 = fs(frag1);
    // 法線が反対方向→ambient光のみ
    const frag2 = makeFragment(0, 0, { r: 1, g: 1, b: 1, a: 1 }, { x: 0, y: 0, z: -1 });
    const c2 = fs(frag2);
    expect(c1.r).toBeGreaterThan(c2.r);
  });

  it('透視投影が正しく機能する', () => {
    const proj = mat4Perspective(Math.PI / 4, 1, 0.1, 100);
    const v = { x: 0, y: 0, z: -5, w: 1 };
    const result = mat4MultiplyVec4(proj, v);
    // w成分が負のz値に基づく
    expect(result.w).not.toBe(0);
  });
});

// ============================================================
// ヘルパー関数
// ============================================================

/** テスト用の変換済み頂点を作成 */
function makeTransformedVertex(
  screenX: number,
  screenY: number,
  depth = 0.5
): TransformedVertex {
  return {
    clipPosition: { x: 0, y: 0, z: 0, w: 1 },
    screenX,
    screenY,
    depth,
    color: { r: 1, g: 1, b: 1, a: 1 },
    uv: { u: 0, v: 0 },
    normal: { x: 0, y: 0, z: 1 },
  };
}

/** テスト用の頂点を作成 */
function makeVertex(
  x: number, y: number, z: number,
  color: Color
): Vertex {
  return {
    position: { x, y, z },
    normal: { x: 0, y: 0, z: 1 },
    color,
    uv: { u: 0, v: 0 },
  };
}

/** テスト用のフラグメントを作成 */
function makeFragment(
  x: number, y: number,
  color: Color,
  normal = { x: 0, y: 0, z: 1 }
): import('../render/pipeline').Fragment {
  return {
    x, y,
    depth: 0.5,
    color,
    uv: { u: 0, v: 0 },
    normal,
  };
}
