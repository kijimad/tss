/**
 * GPU シミュレーター ブラウザUI
 * Node.js シミュレーターのUIパターンに準拠:
 *   セレクト + Run ボタン → 左パネル（シナリオ詳細）＋ 右パネル（実行結果）
 */

import { createDefaultGPU } from '../hw/device';
import type { GPUDevice } from '../hw/device';
import { GPUMemorySystem } from '../hw/memory';
import {
  dim3,
  launchKernel,
  vectorAddKernel,
  matMulKernel,
  reductionKernel,
} from '../compute/kernel';
import type { KernelResult } from '../compute/kernel';
import { Warp, WarpScheduler, calculateOccupancy, WARP_SIZE } from '../compute/warp';
import { Framebuffer, executeRenderPipeline } from '../render/pipeline';
import type { Vertex } from '../render/pipeline';
import {
  mat4Identity,
  mat4Multiply,
  mat4Perspective,
  mat4RotateY,
  mat4Translate,
  createVertexShader,
  createFragmentShader,
  createCheckerTexture,
  sampleTexture,
} from '../render/shader';

/** シナリオ定義 */
interface Scenario {
  name: string;
  description: string;
  run: (gpu: GPUDevice, memory: GPUMemorySystem) => ScenarioResult;
}

/** シナリオ実行結果 */
interface ScenarioResult {
  /** メイン出力テキスト */
  output: string;
  /** Canvas に描画するフレームバッファ（レンダリング系のみ） */
  framebuffer?: Framebuffer;
}

/** 全シナリオ一覧 */
const SCENARIOS: Scenario[] = [
  // 1. GPUスペック表示
  {
    name: 'GPUスペック表示',
    description: 'デバイス情報（SM数、コア数、VRAM、帯域幅）を表示',
    run: (gpu) => {
      return { output: gpu.getSpecSummary() };
    },
  },

  // 2. ベクトル加算 (CUDA)
  {
    name: 'ベクトル加算 (CUDA)',
    description: 'vectorAdd カーネル: C[i] = A[i] + B[i]',
    run: () => {
      const n = 64;
      const a = new Float32Array(n);
      const b = new Float32Array(n);
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) { a[i] = i; b[i] = i * 2; }

      const result: KernelResult = launchKernel(
        { gridDim: dim3(2), blockDim: dim3(32) },
        vectorAddKernel,
        { buffers: [a, b, c], params: [] },
      );

      const sample = Array.from(c.slice(0, 8)).map((v, i) => `C[${String(i)}]=${String(v)}`).join(', ');
      const lines = [
        `=== ベクトル加算 (N=${String(n)}) ===`,
        `グリッド: 2ブロック × 32スレッド`,
        `総スレッド数: ${String(result.totalThreads)}`,
        `総ブロック数: ${String(result.totalBlocks)}`,
        `実行サイクル: ${String(result.executionCycles)}`,
        ``,
        `結果サンプル (先頭8要素):`,
        `  ${sample}`,
        ``,
        `検証: C[0]=${String(c[0])} (期待: 0), C[63]=${String(c[63])} (期待: ${String(63 + 63 * 2)})`,
      ];
      return { output: lines.join('\n') };
    },
  },

  // 3. 行列乗算
  {
    name: '行列乗算',
    description: 'matMul カーネル: C = A × B (4×4 正方行列)',
    run: () => {
      const n = 4;
      const a = new Float32Array(n * n);
      const b = new Float32Array(n * n);
      const c = new Float32Array(n * n);
      // 単位行列風テスト
      for (let i = 0; i < n; i++) { a[i * n + i] = 1; b[i * n + i] = 2; }

      const result: KernelResult = launchKernel(
        { gridDim: dim3(1, 1), blockDim: dim3(n, n) },
        matMulKernel,
        { buffers: [a, b, c], params: [n] },
      );

      let matStr = '';
      for (let r = 0; r < n; r++) {
        matStr += '  [' + Array.from(c.slice(r * n, (r + 1) * n)).map(v => v.toFixed(1).padStart(5)).join(' ') + ']\n';
      }

      const lines = [
        `=== 行列乗算 (${String(n)}×${String(n)}) ===`,
        `グリッド: 1ブロック × ${String(n)}×${String(n)}スレッド`,
        `総スレッド数: ${String(result.totalThreads)}`,
        `実行サイクル: ${String(result.executionCycles)}`,
        ``,
        `入力A (単位行列):`,
        `  I(4×4)`,
        `入力B (対角2):`,
        `  diag(2,2,2,2)`,
        ``,
        `結果行列 C = A × B:`,
        matStr,
      ];
      return { output: lines.join('\n') };
    },
  },

  // 4. 並列リダクション
  {
    name: '並列リダクション',
    description: 'ブロック毎に部分和を計算して合計を求める',
    run: () => {
      const n = 128;
      const input = new Float32Array(n);
      for (let i = 0; i < n; i++) input[i] = 1;
      const blockSize = 32;
      const numBlocks = Math.ceil(n / blockSize);
      const partialSums = new Float32Array(numBlocks);

      const result: KernelResult = launchKernel(
        { gridDim: dim3(numBlocks), blockDim: dim3(blockSize) },
        reductionKernel,
        { buffers: [input, partialSums], params: [] },
      );

      const totalSum = Array.from(partialSums).reduce((s, v) => s + v, 0);
      const lines = [
        `=== 並列リダクション (N=${String(n)}) ===`,
        `入力: 全要素 = 1.0`,
        `グリッド: ${String(numBlocks)}ブロック × ${String(blockSize)}スレッド`,
        `総スレッド数: ${String(result.totalThreads)}`,
        `実行サイクル: ${String(result.executionCycles)}`,
        ``,
        `ブロック毎の部分和:`,
        `  [${Array.from(partialSums).map(v => String(v)).join(', ')}]`,
        ``,
        `合計: ${String(totalSum)} (期待: ${String(n)})`,
      ];
      return { output: lines.join('\n') };
    },
  },

  // 5. ワープ分岐 (divergence)
  {
    name: 'ワープ分岐 (divergence)',
    description: '偶数/奇数スレッドで分岐し、ダイバージェンスペナルティを表示',
    run: () => {
      const scheduler = new WarpScheduler();
      const warp = new Warp(0, WARP_SIZE);
      scheduler.addWarp(warp);

      // 偶数スレッドと奇数スレッドで分岐
      const divergence = warp.evaluateBranch((laneId) => laneId % 2 === 0);
      const vizLines = warp.visualizeDivergence(divergence);

      // 分岐なしケースとの比較
      const warp2 = new Warp(1, WARP_SIZE);
      const noDivergence = warp2.evaluateBranch(() => true);

      const lines = [
        `=== ワープ分岐 (divergence) デモ ===`,
        `ワープサイズ: ${String(WARP_SIZE)}スレッド`,
        ``,
        `--- ケース1: 偶数/奇数分岐 (laneId % 2 == 0) ---`,
        ...vizLines,
        ``,
        `--- ケース2: 全スレッド同一パス ---`,
        ...warp2.visualizeDivergence(noDivergence),
        ``,
        `ペナルティ比較:`,
        `  分岐あり: ${String(divergence.penaltyCycles)}サイクル追加`,
        `  分岐なし: ${String(noDivergence.penaltyCycles)}サイクル追加`,
        `  → ダイバージェンスは両パスを逐次実行するため性能が低下`,
      ];
      return { output: lines.join('\n') };
    },
  },

  // 6. メモリ階層 (レイテンシ)
  {
    name: 'メモリ階層 (レイテンシ)',
    description: 'グローバル / 共有 / レジスタのアクセスレイテンシを比較',
    run: (_gpu, memory) => {
      memory.resetAll();

      // グローバルメモリへの書き込みと読み出し
      memory.global.write(0, 42.0);
      memory.global.write(1, 84.0);
      const g1 = memory.global.read(0);
      const g2 = memory.global.read(1);

      // 共有メモリへのアクセス
      memory.shared.write(0, 100.0);
      const s1 = memory.shared.read(0);

      // レジスタアクセス
      memory.registers.write(0, 3.14);
      const r1 = memory.registers.read(0);

      // コンスタントメモリ
      memory.constant.write(0, 9.81);
      const c1 = memory.constant.read(0);

      const stats = memory.getAllStats();
      const lines = [
        `=== メモリ階層アクセスデモ ===`,
        ``,
        `グローバルメモリ (VRAM):`,
        `  書込: addr[0]=42, addr[1]=84`,
        `  読出: addr[0]=${String(g1.value)}, addr[1]=${String(g2.value)}`,
        `  レイテンシ: ${String(g1.latency)}サイクル/アクセス`,
        `  統計: ${String(stats.global.reads)}読 / ${String(stats.global.writes)}書`,
        ``,
        `共有メモリ (ブロック内):`,
        `  読出: addr[0]=${String(s1.value)}, レイテンシ: ${String(s1.latency)}サイクル`,
        `  統計: ${String(stats.shared.reads)}読 / ${String(stats.shared.writes)}書`,
        ``,
        `レジスタ (スレッド専用):`,
        `  読出: addr[0]=${String(r1.value)}, レイテンシ: ${String(r1.latency)}サイクル`,
        `  統計: ${String(stats.register.reads)}読 / ${String(stats.register.writes)}書`,
        ``,
        `コンスタントメモリ (キャッシュ):`,
        `  読出: addr[0]=${String(c1.value)}, レイテンシ: ${String(c1.latency)}サイクル`,
        `  統計: ${String(stats.constant.reads)}読 / ${String(stats.constant.writes)}書`,
        ``,
        `レイテンシ比較 (総サイクル):`,
        `  グローバル(${String(stats.global.totalLatency)}) >> 共有(${String(stats.shared.totalLatency)}) >> コンスタント(${String(stats.constant.totalLatency)}) >> レジスタ(${String(stats.register.totalLatency)})`,
      ];
      return { output: lines.join('\n') };
    },
  },

  // 7. オキュパンシー計算
  {
    name: 'オキュパンシー計算',
    description: 'ブロックサイズ・レジスタ・共有メモリからワープ占有率を算出',
    run: (gpu) => {
      // 設定パターンを複数試す
      const configs = [
        { threads: 256, regs: 32, smem: 4096, label: '標準構成' },
        { threads: 512, regs: 64, smem: 16384, label: 'レジスタ重い' },
        { threads: 128, regs: 16, smem: 0, label: '軽量カーネル' },
      ];

      const lines = [`=== オキュパンシー計算 ===`, ``];

      for (const cfg of configs) {
        const result = calculateOccupancy({
          maxWarpsPerSM: gpu.spec.smSpec.maxWarpsPerSM,
          registersPerSM: gpu.spec.smSpec.registersPerSM,
          sharedMemoryPerSM: gpu.spec.smSpec.sharedMemorySize,
          threadsPerBlock: cfg.threads,
          registersPerThread: cfg.regs,
          sharedMemoryPerBlock: cfg.smem,
        });

        lines.push(
          `--- ${cfg.label} ---`,
          `  ブロックサイズ: ${String(cfg.threads)}スレッド`,
          `  レジスタ/スレッド: ${String(cfg.regs)}`,
          `  共有メモリ/ブロック: ${String(cfg.smem)}B`,
          `  オキュパンシー: ${(result.occupancy * 100).toFixed(1)}%`,
          `  アクティブワープ: ${String(result.activeWarps)} / ${String(result.maxWarps)}`,
          `  SM当たりブロック数: ${String(result.blocksPerSM)}`,
          `  制限要因: ${result.limitingFactor}`,
          ``,
        );
      }
      return { output: lines.join('\n') };
    },
  },

  // 8. 三角形レンダリング
  {
    name: '三角形レンダリング',
    description: '頂点シェーダ → ラスタライズ → フラグメントシェーダ パイプライン',
    run: () => {
      const fb = new Framebuffer(128, 128);
      fb.clear();

      const vertices: Vertex[] = [
        { position: { x: 0, y: 0.6, z: 0 }, normal: { x: 0, y: 0, z: 1 }, color: { r: 1, g: 0, b: 0, a: 1 }, uv: { u: 0.5, v: 0 } },
        { position: { x: -0.5, y: -0.4, z: 0 }, normal: { x: 0, y: 0, z: 1 }, color: { r: 0, g: 1, b: 0, a: 1 }, uv: { u: 0, v: 1 } },
        { position: { x: 0.5, y: -0.4, z: 0 }, normal: { x: 0, y: 0, z: 1 }, color: { r: 0, g: 0, b: 1, a: 1 }, uv: { u: 1, v: 1 } },
      ];

      const model = mat4RotateY(0.3);
      const view = mat4Translate(0, 0, -2);
      const projection = mat4Perspective(Math.PI / 4, 1, 0.1, 100);
      const mv = mat4Multiply(view, model);
      const mvp = mat4Multiply(projection, mv);

      const vertexShader = createVertexShader(mvp, fb.width, fb.height);
      const fragmentShader = createFragmentShader(null);
      const stats = executeRenderPipeline(vertices, fb, vertexShader, fragmentShader);

      const lines = [
        `=== レンダリングパイプライン ===`,
        `フレームバッファ: ${String(fb.width)}×${String(fb.height)}`,
        ``,
        `パイプラインステージ:`,
        `  1. 頂点シェーダ (MVP変換): ${String(stats.inputVertices)}頂点 → ${String(stats.transformedVertices)}頂点`,
        `  2. プリミティブアセンブリ: ${String(stats.triangles)}三角形`,
        `  3. ラスタライゼーション: ${String(stats.fragments)}フラグメント生成`,
        `  4. フラグメントシェーダ + 深度テスト: ${String(stats.writtenPixels)}ピクセル書込`,
        ``,
        `→ 下の Canvas にフレームバッファ出力を表示`,
      ];
      return { output: lines.join('\n'), framebuffer: fb };
    },
  },

  // 9. テクスチャサンプリング
  {
    name: 'テクスチャサンプリング',
    description: 'チェッカーテクスチャを三角形にマッピング',
    run: () => {
      const fb = new Framebuffer(128, 128);
      fb.clear();

      const vertices: Vertex[] = [
        { position: { x: 0, y: 0.6, z: 0 }, normal: { x: 0, y: 0, z: 1 }, color: { r: 1, g: 1, b: 1, a: 1 }, uv: { u: 0.5, v: 0 } },
        { position: { x: -0.5, y: -0.4, z: 0 }, normal: { x: 0, y: 0, z: 1 }, color: { r: 1, g: 1, b: 1, a: 1 }, uv: { u: 0, v: 1 } },
        { position: { x: 0.5, y: -0.4, z: 0 }, normal: { x: 0, y: 0, z: 1 }, color: { r: 1, g: 1, b: 1, a: 1 }, uv: { u: 1, v: 1 } },
      ];

      const model = mat4RotateY(0.3);
      const view = mat4Translate(0, 0, -2);
      const projection = mat4Perspective(Math.PI / 4, 1, 0.1, 100);
      const mv = mat4Multiply(view, model);
      const mvp = mat4Multiply(projection, mv);

      const texture = createCheckerTexture(16, 16);
      const vertexShader = createVertexShader(mvp, fb.width, fb.height);
      const fragmentShader = createFragmentShader(texture);
      const stats = executeRenderPipeline(vertices, fb, vertexShader, fragmentShader);

      // テクスチャサンプリングのデモ
      const s00 = sampleTexture(texture, 0.0, 0.0);
      const s05 = sampleTexture(texture, 0.5, 0.5);

      const lines = [
        `=== テクスチャサンプリング ===`,
        `テクスチャ: 16×16 チェッカーパターン (gridSize=4)`,
        ``,
        `サンプリング結果:`,
        `  UV(0.0, 0.0) → RGBA(${s00.r.toFixed(2)}, ${s00.g.toFixed(2)}, ${s00.b.toFixed(2)}, ${s00.a.toFixed(2)})`,
        `  UV(0.5, 0.5) → RGBA(${s05.r.toFixed(2)}, ${s05.g.toFixed(2)}, ${s05.b.toFixed(2)}, ${s05.a.toFixed(2)})`,
        ``,
        `レンダリング統計:`,
        `  入力頂点: ${String(stats.inputVertices)}`,
        `  フラグメント: ${String(stats.fragments)}`,
        `  書込ピクセル: ${String(stats.writtenPixels)}`,
        ``,
        `→ 下の Canvas にテクスチャ適用結果を表示`,
      ];
      return { output: lines.join('\n'), framebuffer: fb };
    },
  },

  // 10. スレッドグリッド可視化
  {
    name: 'スレッドグリッド可視化',
    description: 'threadIdx / blockIdx のグリッド構成を表示',
    run: () => {
      const gridDim = dim3(2, 2);
      const blockDim = dim3(4, 4);

      const result = launchKernel(
        { gridDim, blockDim },
        // 何もしないカーネル（グリッド構造の確認用）
        () => { /* スレッドグリッド可視化用の空カーネル */ },
        { buffers: [], params: [] },
      );

      const lines = [
        `=== スレッドグリッド可視化 ===`,
        `グリッド次元: (${String(gridDim.x)}, ${String(gridDim.y)}, ${String(gridDim.z)})`,
        `ブロック次元: (${String(blockDim.x)}, ${String(blockDim.y)}, ${String(blockDim.z)})`,
        `総ブロック数: ${String(result.totalBlocks)}`,
        `総スレッド数: ${String(result.totalThreads)}`,
        ``,
      ];

      // 各ブロックのスレッド配置を表示
      for (let by = 0; by < gridDim.y; by++) {
        for (let bx = 0; bx < gridDim.x; bx++) {
          lines.push(`Block(${String(bx)},${String(by)}):`);
          for (let ty = 0; ty < blockDim.y; ty++) {
            let row = '  ';
            for (let tx = 0; tx < blockDim.x; tx++) {
              row += `(${String(tx)},${String(ty)}) `;
            }
            lines.push(row);
          }
          lines.push('');
        }
      }

      lines.push(
        `ワープ構成:`,
        `  スレッド/ブロック: ${String(blockDim.x * blockDim.y * blockDim.z)}`,
        `  ワープ/ブロック: ${String(Math.ceil((blockDim.x * blockDim.y * blockDim.z) / WARP_SIZE))}`,
        `  ワープサイズ: ${String(WARP_SIZE)}`,
      );
      return { output: lines.join('\n') };
    },
  },
];

/** GPUシミュレーターアプリケーション */
export class GpuApp {
  init(container: HTMLElement): void {
    container.style.cssText = 'display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;';

    // ヘッダ
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;';

    const title = document.createElement('h1');
    title.textContent = 'GPU Simulator';
    title.style.cssText = 'margin:0;font-size:15px;color:#f59e0b;';
    header.appendChild(title);

    // シナリオ選択
    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;';
    for (let i = 0; i < SCENARIOS.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = SCENARIOS[i]?.name ?? '';
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run';
    runBtn.style.cssText = 'padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
    header.appendChild(runBtn);

    container.appendChild(header);

    // メインエリア
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;overflow:hidden;';

    // 左パネル: シナリオ説明
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;';

    const descLabel = document.createElement('div');
    descLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;';
    descLabel.textContent = 'シナリオ詳細';
    leftPanel.appendChild(descLabel);

    const descArea = document.createElement('div');
    descArea.style.cssText = 'padding:12px;font-family:monospace;font-size:13px;color:#94a3b8;white-space:pre-wrap;';
    leftPanel.appendChild(descArea);

    main.appendChild(leftPanel);

    // 右パネル: 実行結果 + Canvas
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;';

    // 出力ラベル
    const outLabel = document.createElement('div');
    outLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;';
    outLabel.textContent = '実行結果';
    rightPanel.appendChild(outLabel);

    // 出力テキスト
    const outputDiv = document.createElement('div');
    outputDiv.style.cssText = 'flex:1;padding:12px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;';
    rightPanel.appendChild(outputDiv);

    // Canvas（レンダリング結果用）
    const canvasLabel = document.createElement('div');
    canvasLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;';
    canvasLabel.textContent = 'Framebuffer Output';
    rightPanel.appendChild(canvasLabel);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'padding:8px 12px;';
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    canvas.style.cssText = 'border:1px solid #334155;image-rendering:pixelated;';
    canvasWrap.appendChild(canvas);
    rightPanel.appendChild(canvasWrap);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // GPUデバイスとメモリの初期化
    const gpu = createDefaultGPU();
    const memory = new GPUMemorySystem(4096, 2048, 1024, 256);

    // 説明文を更新するヘルパー
    const updateDescription = (): void => {
      const scenario = SCENARIOS[Number(select.value)];
      if (scenario) {
        descArea.textContent = `${scenario.name}\n\n${scenario.description}`;
      }
    };

    // シナリオ選択変更
    select.addEventListener('change', () => {
      updateDescription();
    });

    // 実行ボタンクリック
    runBtn.addEventListener('click', () => {
      outputDiv.innerHTML = '';
      const scenario = SCENARIOS[Number(select.value)];
      if (!scenario) return;

      updateDescription();

      const result = scenario.run(gpu, memory);

      // テキスト出力
      const outEl = document.createElement('span');
      outEl.style.color = '#e2e8f0';
      outEl.textContent = result.output;
      outputDiv.appendChild(outEl);

      // Canvas にフレームバッファを描画
      const ctx = canvas.getContext('2d');
      if (ctx && result.framebuffer) {
        const fb = result.framebuffer;
        canvas.width = fb.width;
        canvas.height = fb.height;
        const imageData = ctx.createImageData(fb.width, fb.height);
        imageData.data.set(fb.toUint8Array());
        ctx.putImageData(imageData, 0, 0);
        canvasLabel.style.display = '';
        canvasWrap.style.display = '';
      } else {
        // レンダリング結果がない場合は Canvas を非表示
        canvasLabel.style.display = 'none';
        canvasWrap.style.display = 'none';
      }
    });

    // 初回: 説明を表示して実行
    updateDescription();
    runBtn.click();
  }
}
