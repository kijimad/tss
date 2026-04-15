/**
 * WebGL コンテキストシミュレーション
 *
 * WebGL の GL状態マシンをTypeScriptで完全にエミュレートする。
 * 全APIコール（createBuffer, bindBuffer, drawArrays等）を忠実に再現し、
 * 各ステージ（頂点フェッチ→頂点シェーダ→プリミティブアセンブリ→
 * ラスタライズ→フラグメントシェーダ→Per-Fragment Ops→フレームバッファ書込）
 * をステップごとに可視化する。
 */

import type {
  GLuint, GLState, GLEvent, GLCall, StepSnapshot, PipelineStats,
  BufferObject, BufferTarget, BufferUsage,
  ShaderObject, ShaderType, ProgramObject, UniformValue,
  VertexShaderFn, FragmentShaderFn,
  VAOObject, VertexAttribPointer,
  TextureObject, WrapMode, FilterMode, StencilOp,
  DrawMode, TransformedVertex, Fragment,
  Color, WebGLSimResult,
} from './types';
import { clamp, lerp } from './math';

/** GL状態マシンのデフォルト値を生成 */
function defaultGLState(width: number, height: number): GLState {
  return {
    depthTestEnabled: false,
    depthFunc: 'LESS',
    depthWriteMask: true,
    blendEnabled: false,
    blendSrcFactor: 'ONE',
    blendDstFactor: 'ZERO',
    blendEquation: 'FUNC_ADD',
    cullFaceEnabled: false,
    cullFaceMode: 'BACK',
    frontFace: 'CCW',
    stencilTestEnabled: false,
    stencilFunc: 'ALWAYS',
    stencilRef: 0,
    stencilMask: 0xFF,
    stencilOpFail: 'KEEP',
    stencilOpZFail: 'KEEP',
    stencilOpZPass: 'KEEP',
    viewport: { x: 0, y: 0, width, height },
    clearColor: { r: 0, g: 0, b: 0, a: 0 },
    clearDepth: 1.0,
    clearStencil: 0,
    currentProgram: null,
    boundArrayBuffer: null,
    boundElementArrayBuffer: null,
    boundVAO: null,
    activeTextureUnit: 0,
    boundTextures: new Map(),
  };
}

/**
 * WebGL コンテキスト
 *
 * WebGL APIの全メソッドをシミュレーションとして提供する。
 * 内部でフレームバッファ（カラー/深度/ステンシル）を管理し、
 * drawArrays/drawElements呼び出し時にソフトウェアレンダリングパイプラインを実行する。
 */
export class GLContext {
  /** フレームバッファ幅 */
  readonly width: number;
  /** フレームバッファ高さ */
  readonly height: number;
  /** カラーバッファ（RGBA float） */
  private colorBuffer: Float32Array;
  /** 深度バッファ */
  private depthBuffer: Float32Array;
  /** ステンシルバッファ */
  private stencilBuffer: Uint8Array;
  /** GL状態 */
  private state: GLState;
  /** 次のオブジェクトID */
  private nextId = 1;
  /** バッファオブジェクト */
  private buffers = new Map<GLuint, BufferObject>();
  /** シェーダオブジェクト */
  private shaders = new Map<GLuint, ShaderObject>();
  /** プログラムオブジェクト */
  private programs = new Map<GLuint, ProgramObject>();
  /** VAOオブジェクト */
  private vaos = new Map<GLuint, VAOObject>();
  /** テクスチャオブジェクト */
  private textures = new Map<GLuint, TextureObject>();
  /** イベントログ */
  private events: GLEvent[] = [];
  /** API呼び出し記録 */
  private calls: GLCall[] = [];
  /** スナップショット */
  private snapshots: StepSnapshot[] = [];
  /** ステップカウンタ */
  private step = 0;
  /** 累積統計 */
  private totalStats: PipelineStats = this.emptyStats();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.colorBuffer = new Float32Array(width * height * 4);
    this.depthBuffer = new Float32Array(width * height).fill(1.0);
    this.stencilBuffer = new Uint8Array(width * height);
    this.state = defaultGLState(width, height);
  }

  /** 空の統計を生成 */
  private emptyStats(): PipelineStats {
    return {
      verticesFetched: 0, verticesTransformed: 0,
      primitivesAssembled: 0, primitivesCulled: 0,
      fragmentsGenerated: 0, fragmentsPassedDepth: 0,
      fragmentsPassedStencil: 0, fragmentsBlended: 0,
      pixelsWritten: 0,
    };
  }

  /** イベントを記録 */
  private emit(stage: GLEvent['stage'], severity: GLEvent['severity'], message: string): void {
    this.events.push({ step: this.step, stage, severity, message });
  }

  /** API呼び出しを記録 */
  private recordCall(api: string, args: string[], description: string, stats: PipelineStats | null = null): void {
    const call: GLCall = { api, args, description };
    this.calls.push(call);
    this.snapshots.push({ step: this.step, call, stats });
    this.emit('API', 'info', `${api}(${args.join(', ')})`);
    this.step++;
  }

  // ======== 状態取得 ========

  /** 現在のGL状態のコピーを取得 */
  getState(): GLState {
    return { ...this.state, boundTextures: new Map(this.state.boundTextures) };
  }

  /** シミュレーション結果を取得 */
  getResult(): WebGLSimResult {
    return {
      snapshots: [...this.snapshots],
      events: [...this.events],
      framebuffer: this.toUint8Array(),
      width: this.width,
      height: this.height,
      totalStats: { ...this.totalStats },
    };
  }

  // ======== クリア操作 ========

  /** クリア色の設定 */
  clearColor(r: number, g: number, b: number, a: number): void {
    this.state.clearColor = { r, g, b, a };
    this.recordCall('clearColor', [r.toFixed(2), g.toFixed(2), b.toFixed(2), a.toFixed(2)],
      'クリア色を設定');
  }

  /** clearDepth */
  clearDepth(d: number): void {
    this.state.clearDepth = d;
    this.recordCall('clearDepth', [String(d)], '深度クリア値を設定');
  }

  /** バッファをクリア */
  clear(color: boolean, depth: boolean, stencil: boolean): void {
    const masks: string[] = [];
    if (color) {
      masks.push('COLOR');
      const c = this.state.clearColor;
      for (let i = 0; i < this.width * this.height; i++) {
        this.colorBuffer[i * 4] = c.r;
        this.colorBuffer[i * 4 + 1] = c.g;
        this.colorBuffer[i * 4 + 2] = c.b;
        this.colorBuffer[i * 4 + 3] = c.a;
      }
    }
    if (depth) {
      masks.push('DEPTH');
      this.depthBuffer.fill(this.state.clearDepth);
    }
    if (stencil) {
      masks.push('STENCIL');
      this.stencilBuffer.fill(this.state.clearStencil);
    }
    this.recordCall('clear', masks, `バッファクリア: ${masks.join(' | ')}`);
  }

  // ======== 状態制御 ========

  /** 機能を有効化 */
  enable(cap: string): void {
    switch (cap) {
      case 'DEPTH_TEST': this.state.depthTestEnabled = true; break;
      case 'BLEND': this.state.blendEnabled = true; break;
      case 'CULL_FACE': this.state.cullFaceEnabled = true; break;
      case 'STENCIL_TEST': this.state.stencilTestEnabled = true; break;
    }
    this.recordCall('enable', [cap], `${cap} を有効化`);
  }

  /** 機能を無効化 */
  disable(cap: string): void {
    switch (cap) {
      case 'DEPTH_TEST': this.state.depthTestEnabled = false; break;
      case 'BLEND': this.state.blendEnabled = false; break;
      case 'CULL_FACE': this.state.cullFaceEnabled = false; break;
      case 'STENCIL_TEST': this.state.stencilTestEnabled = false; break;
    }
    this.recordCall('disable', [cap], `${cap} を無効化`);
  }

  /** 深度テスト関数の設定 */
  depthFunc(func: GLState['depthFunc']): void {
    this.state.depthFunc = func;
    this.recordCall('depthFunc', [func], `深度関数: ${func}`);
  }

  /** 深度書き込みマスク */
  depthMask(flag: boolean): void {
    this.state.depthWriteMask = flag;
    this.recordCall('depthMask', [String(flag)], `深度書込: ${flag ? 'ON' : 'OFF'}`);
  }

  /** ブレンド関数の設定 */
  blendFunc(src: GLState['blendSrcFactor'], dst: GLState['blendDstFactor']): void {
    this.state.blendSrcFactor = src;
    this.state.blendDstFactor = dst;
    this.recordCall('blendFunc', [src, dst], `ブレンド関数: ${src}, ${dst}`);
  }

  /** ブレンド方程式の設定 */
  blendEquation(eq: GLState['blendEquation']): void {
    this.state.blendEquation = eq;
    this.recordCall('blendEquation', [eq], `ブレンド方程式: ${eq}`);
  }

  /** カリング面の設定 */
  cullFace(mode: GLState['cullFaceMode']): void {
    this.state.cullFaceMode = mode;
    this.recordCall('cullFace', [mode], `カリング面: ${mode}`);
  }

  /** 前面の巻き方向 */
  frontFace(dir: 'CW' | 'CCW'): void {
    this.state.frontFace = dir;
    this.recordCall('frontFace', [dir], `前面巻き方向: ${dir}`);
  }

  /** ステンシル関数 */
  stencilFunc(func: GLState['stencilFunc'], ref: number, mask: number): void {
    this.state.stencilFunc = func;
    this.state.stencilRef = ref;
    this.state.stencilMask = mask;
    this.recordCall('stencilFunc', [func, String(ref), `0x${mask.toString(16)}`],
      `ステンシル関数: ${func}, ref=${String(ref)}`);
  }

  /** ステンシルオペレーション */
  stencilOp(fail: StencilOp, zfail: StencilOp, zpass: StencilOp): void {
    this.state.stencilOpFail = fail;
    this.state.stencilOpZFail = zfail;
    this.state.stencilOpZPass = zpass;
    this.recordCall('stencilOp', [fail, zfail, zpass],
      `ステンシルOP: fail=${fail}, zfail=${zfail}, zpass=${zpass}`);
  }

  /** ビューポート設定 */
  viewport(x: number, y: number, w: number, h: number): void {
    this.state.viewport = { x, y, width: w, height: h };
    this.recordCall('viewport', [String(x), String(y), String(w), String(h)],
      `ビューポート: ${String(w)}x${String(h)}`);
  }

  // ======== バッファオブジェクト ========

  /** バッファを生成 */
  createBuffer(): GLuint {
    const id = this.nextId++;
    this.buffers.set(id, { id, data: [], sizeBytes: 0, usage: 'STATIC_DRAW' });
    this.recordCall('createBuffer', [], `バッファ #${String(id)} を生成`);
    return id;
  }

  /** バッファをバインド */
  bindBuffer(target: BufferTarget, id: GLuint | null): void {
    if (target === 'ARRAY_BUFFER') {
      this.state.boundArrayBuffer = id;
    } else {
      this.state.boundElementArrayBuffer = id;
      // VAOにEBOをバインド
      const vao = this.state.boundVAO !== null ? this.vaos.get(this.state.boundVAO) : undefined;
      if (vao) vao.elementBuffer = id;
    }
    this.recordCall('bindBuffer', [target, id !== null ? `#${String(id)}` : 'null'],
      `${target} に #${String(id)} をバインド`);
  }

  /** バッファにデータをアップロード */
  bufferData(target: BufferTarget, data: number[], usage: BufferUsage): void {
    const id = target === 'ARRAY_BUFFER' ? this.state.boundArrayBuffer : this.state.boundElementArrayBuffer;
    if (id === null) {
      this.emit('API', 'error', 'bufferData: バッファがバインドされていない');
      return;
    }
    const buf = this.buffers.get(id);
    if (!buf) return;
    buf.data = [...data];
    buf.sizeBytes = data.length * 4;
    buf.usage = usage;
    this.recordCall('bufferData', [target, `${String(data.length)} floats`, usage],
      `#${String(id)} に ${String(data.length)} 要素をアップロード`);
  }

  // ======== VAO ========

  /** VAOを生成 */
  createVertexArray(): GLuint {
    const id = this.nextId++;
    this.vaos.set(id, {
      id,
      attribPointers: new Map(),
      elementBuffer: null,
      enabledAttribs: new Set(),
    });
    this.recordCall('createVertexArray', [], `VAO #${String(id)} を生成`);
    return id;
  }

  /** VAOをバインド */
  bindVertexArray(id: GLuint | null): void {
    this.state.boundVAO = id;
    if (id !== null) {
      const vao = this.vaos.get(id);
      if (vao && vao.elementBuffer !== null) {
        this.state.boundElementArrayBuffer = vao.elementBuffer;
      }
    }
    this.recordCall('bindVertexArray', [id !== null ? `#${String(id)}` : 'null'],
      `VAO #${String(id)} をバインド`);
  }

  /** 頂点属性を有効化 */
  enableVertexAttribArray(index: number): void {
    const vao = this.state.boundVAO !== null ? this.vaos.get(this.state.boundVAO) : undefined;
    if (vao) vao.enabledAttribs.add(index);
    this.recordCall('enableVertexAttribArray', [String(index)],
      `属性 loc=${String(index)} を有効化`);
  }

  /** 頂点属性ポインタの設定 */
  vertexAttribPointer(index: number, size: number, stride: number, offset: number): void {
    const vao = this.state.boundVAO !== null ? this.vaos.get(this.state.boundVAO) : undefined;
    const bufRef = this.state.boundArrayBuffer;
    if (!vao || bufRef === null) {
      this.emit('API', 'error', 'vertexAttribPointer: VAOまたはVBOがバインドされていない');
      return;
    }
    const ptr: VertexAttribPointer = { index, size, stride, offset, bufferRef: bufRef };
    vao.attribPointers.set(index, ptr);
    this.recordCall('vertexAttribPointer',
      [String(index), String(size), String(stride), String(offset)],
      `属性 loc=${String(index)}: size=${String(size)}, stride=${String(stride)}, offset=${String(offset)}`);
  }

  // ======== シェーダ ========

  /** シェーダを生成 */
  createShader(type: ShaderType): GLuint {
    const id = this.nextId++;
    this.shaders.set(id, {
      id, type, source: '', compiled: false, infoLog: '', variables: [],
    });
    this.recordCall('createShader', [type], `${type} #${String(id)} を生成`);
    return id;
  }

  /** シェーダソースを設定 */
  shaderSource(id: GLuint, source: string): void {
    const shader = this.shaders.get(id);
    if (!shader) return;
    shader.source = source;
    this.recordCall('shaderSource', [`#${String(id)}`, `"${source.slice(0, 40)}..."`],
      `シェーダ #${String(id)} にソースを設定`);
  }

  /** シェーダをコンパイル */
  compileShader(id: GLuint): void {
    const shader = this.shaders.get(id);
    if (!shader) return;

    // GLSLソースから変数宣言をパース
    shader.variables = parseGLSLDeclarations(shader.source);
    shader.compiled = true;
    shader.infoLog = '';

    this.emit('API', 'success', `シェーダ #${String(id)} コンパイル成功: ${String(shader.variables.length)} 変数`);
    this.recordCall('compileShader', [`#${String(id)}`],
      `${shader.type} #${String(id)} をコンパイル`);
  }

  // ======== プログラム ========

  /** プログラムを生成 */
  createProgram(): GLuint {
    const id = this.nextId++;
    this.programs.set(id, {
      id,
      vertexShader: null,
      fragmentShader: null,
      linked: false,
      infoLog: '',
      attributeLocations: new Map(),
      uniformLocations: new Map(),
      uniformValues: new Map(),
      vertexShaderFn: null,
      fragmentShaderFn: null,
    });
    this.recordCall('createProgram', [], `プログラム #${String(id)} を生成`);
    return id;
  }

  /** シェーダをプログラムにアタッチ */
  attachShader(progId: GLuint, shaderId: GLuint): void {
    const prog = this.programs.get(progId);
    const shader = this.shaders.get(shaderId);
    if (!prog || !shader) return;
    if (shader.type === 'VERTEX_SHADER') prog.vertexShader = shaderId;
    else prog.fragmentShader = shaderId;
    this.recordCall('attachShader', [`#${String(progId)}`, `#${String(shaderId)}`],
      `プログラム #${String(progId)} にシェーダ #${String(shaderId)} をアタッチ`);
  }

  /** プログラムをリンク */
  linkProgram(progId: GLuint): void {
    const prog = this.programs.get(progId);
    if (!prog) return;

    // attribute/uniformのlocationを割り当て
    let attrLoc = 0;
    let uniLoc = 0;
    const vsId = prog.vertexShader;
    const fsId = prog.fragmentShader;

    if (vsId !== null) {
      const vs = this.shaders.get(vsId);
      if (vs) {
        for (const v of vs.variables) {
          if (v.qualifier === 'attribute' && !prog.attributeLocations.has(v.name)) {
            prog.attributeLocations.set(v.name, attrLoc++);
          }
          if (v.qualifier === 'uniform' && !prog.uniformLocations.has(v.name)) {
            prog.uniformLocations.set(v.name, uniLoc++);
          }
        }
      }
    }
    if (fsId !== null) {
      const fs = this.shaders.get(fsId);
      if (fs) {
        for (const v of fs.variables) {
          if (v.qualifier === 'uniform' && !prog.uniformLocations.has(v.name)) {
            prog.uniformLocations.set(v.name, uniLoc++);
          }
        }
      }
    }

    prog.linked = true;
    this.emit('API', 'success',
      `プログラム #${String(progId)} リンク成功: ${String(prog.attributeLocations.size)} attributes, ${String(prog.uniformLocations.size)} uniforms`);
    this.recordCall('linkProgram', [`#${String(progId)}`],
      `プログラム #${String(progId)} をリンク`);
  }

  /** プログラムを使用 */
  useProgram(id: GLuint | null): void {
    this.state.currentProgram = id;
    this.recordCall('useProgram', [id !== null ? `#${String(id)}` : 'null'],
      `プログラム #${String(id)} を使用`);
  }

  /** シェーダ実行関数を設定（TypeScript関数でGLSLの動作をエミュレート） */
  setShaderFunctions(progId: GLuint, vs: VertexShaderFn, fs: FragmentShaderFn): void {
    const prog = this.programs.get(progId);
    if (!prog) return;
    prog.vertexShaderFn = vs;
    prog.fragmentShaderFn = fs;
  }

  /** attribute locationを取得 */
  getAttribLocation(progId: GLuint, name: string): number {
    const prog = this.programs.get(progId);
    return prog?.attributeLocations.get(name) ?? -1;
  }

  /** uniform locationを取得 */
  getUniformLocation(progId: GLuint, name: string): number {
    const prog = this.programs.get(progId);
    return prog?.uniformLocations.get(name) ?? -1;
  }

  /** uniform値を設定 */
  setUniform(name: string, value: UniformValue): void {
    const progId = this.state.currentProgram;
    if (progId === null) return;
    const prog = this.programs.get(progId);
    if (!prog) return;
    prog.uniformValues.set(name, value);
    const valStr = typeof value === 'number' ? value.toFixed(3) : 'matrix/vec';
    this.recordCall('uniform', [name, valStr],
      `uniform ${name} = ${valStr}`);
  }

  // ======== テクスチャ ========

  /** テクスチャを生成 */
  createTexture(): GLuint {
    const id = this.nextId++;
    this.textures.set(id, {
      id, width: 0, height: 0, data: new Float32Array(0),
      wrapS: 'REPEAT', wrapT: 'REPEAT',
      minFilter: 'NEAREST', magFilter: 'NEAREST',
    });
    this.recordCall('createTexture', [], `テクスチャ #${String(id)} を生成`);
    return id;
  }

  /** テクスチャをバインド */
  bindTexture(id: GLuint | null): void {
    if (id !== null) {
      this.state.boundTextures.set(this.state.activeTextureUnit, id);
    } else {
      this.state.boundTextures.delete(this.state.activeTextureUnit);
    }
    this.recordCall('bindTexture', [id !== null ? `#${String(id)}` : 'null'],
      `テクスチャユニット${String(this.state.activeTextureUnit)} に #${String(id)} をバインド`);
  }

  /** アクティブテクスチャユニット */
  activeTexture(unit: number): void {
    this.state.activeTextureUnit = unit;
    this.recordCall('activeTexture', [`TEXTURE${String(unit)}`],
      `テクスチャユニット ${String(unit)} をアクティブに`);
  }

  /** テクスチャ画像データを設定 */
  texImage2D(width: number, height: number, data: Float32Array): void {
    const texId = this.state.boundTextures.get(this.state.activeTextureUnit);
    if (texId === undefined) return;
    const tex = this.textures.get(texId);
    if (!tex) return;
    tex.width = width;
    tex.height = height;
    tex.data = new Float32Array(data);
    this.recordCall('texImage2D', [String(width), String(height), `${String(data.length)} floats`],
      `テクスチャ #${String(texId)} に ${String(width)}x${String(height)} 画像を設定`);
  }

  /** テクスチャパラメータを設定 */
  texParameteri(param: string, value: string): void {
    const texId = this.state.boundTextures.get(this.state.activeTextureUnit);
    if (texId === undefined) return;
    const tex = this.textures.get(texId);
    if (!tex) return;
    switch (param) {
      case 'TEXTURE_WRAP_S': tex.wrapS = value as WrapMode; break;
      case 'TEXTURE_WRAP_T': tex.wrapT = value as WrapMode; break;
      case 'TEXTURE_MIN_FILTER': tex.minFilter = value as FilterMode; break;
      case 'TEXTURE_MAG_FILTER': tex.magFilter = value as FilterMode; break;
    }
    this.recordCall('texParameteri', [param, value], `テクスチャパラメータ: ${param} = ${value}`);
  }

  // ======== 描画 ========

  /** drawArrays */
  drawArrays(mode: DrawMode, first: number, count: number): void {
    const stats = this.executePipeline(mode, first, count, false);
    this.accumulateStats(stats);
    this.recordCall('drawArrays', [mode, String(first), String(count)],
      `${mode} を描画: ${String(count)} 頂点`, stats);
  }

  /** drawElements */
  drawElements(mode: DrawMode, count: number, offset: number): void {
    const stats = this.executePipeline(mode, offset, count, true);
    this.accumulateStats(stats);
    this.recordCall('drawElements', [mode, String(count), String(offset)],
      `${mode} をインデックス描画: ${String(count)} インデックス`, stats);
  }

  /** 統計を累積 */
  private accumulateStats(stats: PipelineStats): void {
    this.totalStats.verticesFetched += stats.verticesFetched;
    this.totalStats.verticesTransformed += stats.verticesTransformed;
    this.totalStats.primitivesAssembled += stats.primitivesAssembled;
    this.totalStats.primitivesCulled += stats.primitivesCulled;
    this.totalStats.fragmentsGenerated += stats.fragmentsGenerated;
    this.totalStats.fragmentsPassedDepth += stats.fragmentsPassedDepth;
    this.totalStats.fragmentsPassedStencil += stats.fragmentsPassedStencil;
    this.totalStats.fragmentsBlended += stats.fragmentsBlended;
    this.totalStats.pixelsWritten += stats.pixelsWritten;
  }

  // ======== レンダリングパイプライン ========

  /** パイプラインを実行 */
  private executePipeline(mode: DrawMode, first: number, count: number, indexed: boolean): PipelineStats {
    const stats = this.emptyStats();
    const progId = this.state.currentProgram;
    if (progId === null) {
      this.emit('API', 'error', 'drawArrays/drawElements: プログラムがバインドされていない');
      return stats;
    }
    const prog = this.programs.get(progId);
    if (!prog || !prog.vertexShaderFn || !prog.fragmentShaderFn) {
      this.emit('API', 'error', 'シェーダ関数が設定されていない');
      return stats;
    }
    const vaoId = this.state.boundVAO;
    const vao = vaoId !== null ? this.vaos.get(vaoId) : undefined;
    if (!vao) {
      this.emit('API', 'error', 'VAOがバインドされていない');
      return stats;
    }

    // ステージ1: 頂点フェッチ
    const indices = this.fetchIndices(vao, first, count, indexed);
    stats.verticesFetched = indices.length;
    this.emit('VERTEX_FETCH', 'info', `${String(indices.length)} 頂点をフェッチ`);

    // ステージ2: 頂点シェーダ実行
    const transformed: TransformedVertex[] = [];
    const vp = this.state.viewport;
    for (const idx of indices) {
      const attrs = this.fetchVertexAttributes(vao, idx);
      const output = prog.vertexShaderFn(attrs, prog.uniformValues);
      // 透視除算 + ビューポート変換
      const w = output.position.w === 0 ? 1 : output.position.w;
      const ndcX = output.position.x / w;
      const ndcY = output.position.y / w;
      const ndcZ = output.position.z / w;
      transformed.push({
        clipPos: output.position,
        screenX: (ndcX + 1) * 0.5 * vp.width + vp.x,
        screenY: (1 - ndcY) * 0.5 * vp.height + vp.y,
        depth: (ndcZ + 1) * 0.5,
        varyings: output.varyings,
      });
    }
    stats.verticesTransformed = transformed.length;
    this.emit('VERTEX_SHADER', 'info', `${String(transformed.length)} 頂点を変換`);

    // ステージ3: プリミティブアセンブリ
    const triangles = this.assembleTriangles(mode, transformed);
    stats.primitivesAssembled = triangles.length;
    this.emit('PRIMITIVE_ASSEMBLY', 'info', `${String(triangles.length)} 三角形を構成`);

    // バックフェスカリング
    const visibleTriangles: [TransformedVertex, TransformedVertex, TransformedVertex][] = [];
    for (const tri of triangles) {
      if (this.state.cullFaceEnabled) {
        const isFront = this.isFrontFace(tri[0], tri[1], tri[2]);
        const cull = this.state.cullFaceMode;
        if ((cull === 'BACK' && !isFront) || (cull === 'FRONT' && isFront) || cull === 'FRONT_AND_BACK') {
          stats.primitivesCulled++;
          continue;
        }
      }
      visibleTriangles.push(tri);
    }
    if (stats.primitivesCulled > 0) {
      this.emit('PRIMITIVE_ASSEMBLY', 'info', `${String(stats.primitivesCulled)} 三角形をカリング`);
    }

    // ステージ4: ラスタライゼーション + フラグメントシェーダ + Per-Fragment Ops
    for (const [v0, v1, v2] of visibleTriangles) {
      const fragments = this.rasterize(v0, v1, v2);
      stats.fragmentsGenerated += fragments.length;

      for (const frag of fragments) {
        // テクスチャサンプラー
        const texSampler = (unit: number, u: number, v: number): Color => {
          return this.sampleTextureUnit(unit, u, v);
        };

        // フラグメントシェーダ実行
        const fragColor = prog.fragmentShaderFn(frag.varyings, prog.uniformValues, texSampler);

        // ステンシルテスト
        if (this.state.stencilTestEnabled) {
          if (!this.stencilTest(frag.x, frag.y)) {
            this.applyStencilOp(frag.x, frag.y, this.state.stencilOpFail);
            continue;
          }
          stats.fragmentsPassedStencil++;
        } else {
          stats.fragmentsPassedStencil++;
        }

        // 深度テスト
        if (this.state.depthTestEnabled) {
          if (!this.depthTest(frag.x, frag.y, frag.depth)) {
            if (this.state.stencilTestEnabled) {
              this.applyStencilOp(frag.x, frag.y, this.state.stencilOpZFail);
            }
            continue;
          }
          stats.fragmentsPassedDepth++;
          if (this.state.depthWriteMask) {
            this.depthBuffer[frag.y * this.width + frag.x] = frag.depth;
          }
        } else {
          stats.fragmentsPassedDepth++;
        }

        // ステンシル更新（zpass）
        if (this.state.stencilTestEnabled) {
          this.applyStencilOp(frag.x, frag.y, this.state.stencilOpZPass);
        }

        // ブレンディング
        let finalColor: Color;
        if (this.state.blendEnabled) {
          const dstColor = this.readPixel(frag.x, frag.y);
          finalColor = this.blend(fragColor, dstColor);
          stats.fragmentsBlended++;
        } else {
          finalColor = fragColor;
        }

        // フレームバッファ書込
        this.writePixel(frag.x, frag.y, finalColor);
        stats.pixelsWritten++;
      }
    }

    this.emit('FRAMEBUFFER_WRITE', 'success',
      `${String(stats.pixelsWritten)} ピクセルを書込 (${String(stats.fragmentsGenerated)} フラグメント生成)`);
    return stats;
  }

  // ======== パイプラインヘルパー ========

  /** インデックスをフェッチ */
  private fetchIndices(vao: VAOObject, first: number, count: number, indexed: boolean): number[] {
    if (!indexed) {
      return Array.from({ length: count }, (_, i) => first + i);
    }
    const eboId = vao.elementBuffer ?? this.state.boundElementArrayBuffer;
    if (eboId === null) return [];
    const ebo = this.buffers.get(eboId);
    if (!ebo) return [];
    return ebo.data.slice(first, first + count);
  }

  /** 頂点属性を1頂点分フェッチ */
  private fetchVertexAttributes(vao: VAOObject, vertexIndex: number): Map<string, number[]> {
    const attrs = new Map<string, number[]>();
    const progId = this.state.currentProgram;
    if (progId === null) return attrs;
    const prog = this.programs.get(progId);
    if (!prog) return attrs;

    // attribute名→locationの逆引き
    for (const [name, loc] of prog.attributeLocations) {
      if (!vao.enabledAttribs.has(loc)) continue;
      const ptr = vao.attribPointers.get(loc);
      if (!ptr) continue;
      const buf = this.buffers.get(ptr.bufferRef);
      if (!buf) continue;

      // ストライドが0の場合はsize * 4（float）を使う
      const stride = ptr.stride === 0 ? ptr.size : ptr.stride / 4;
      const baseIndex = vertexIndex * stride + ptr.offset / 4;
      const values: number[] = [];
      for (let i = 0; i < ptr.size; i++) {
        values.push(buf.data[baseIndex + i] ?? 0);
      }
      attrs.set(name, values);
    }
    return attrs;
  }

  /** 三角形を組み立て */
  private assembleTriangles(
    mode: DrawMode, vertices: TransformedVertex[],
  ): [TransformedVertex, TransformedVertex, TransformedVertex][] {
    const tris: [TransformedVertex, TransformedVertex, TransformedVertex][] = [];
    if (mode === 'TRIANGLES') {
      for (let i = 0; i + 2 < vertices.length; i += 3) {
        const a = vertices[i], b = vertices[i + 1], c = vertices[i + 2];
        if (a && b && c) tris.push([a, b, c]);
      }
    } else if (mode === 'TRIANGLE_STRIP') {
      for (let i = 0; i + 2 < vertices.length; i++) {
        const a = vertices[i], b = vertices[i + 1], c = vertices[i + 2];
        if (a && b && c) {
          tris.push(i % 2 === 0 ? [a, b, c] : [b, a, c]);
        }
      }
    } else if (mode === 'TRIANGLE_FAN') {
      const center = vertices[0];
      if (center) {
        for (let i = 1; i + 1 < vertices.length; i++) {
          const b = vertices[i], c = vertices[i + 1];
          if (b && c) tris.push([center, b, c]);
        }
      }
    }
    return tris;
  }

  /** 前面判定（巻き方向による） */
  private isFrontFace(v0: TransformedVertex, v1: TransformedVertex, v2: TransformedVertex): boolean {
    // スクリーン座標での符号付き面積
    const area = (v1.screenX - v0.screenX) * (v2.screenY - v0.screenY) -
                 (v2.screenX - v0.screenX) * (v1.screenY - v0.screenY);
    // CCWが前面の場合、面積が正なら前面
    return this.state.frontFace === 'CCW' ? area > 0 : area < 0;
  }

  /** ラスタライゼーション（重心座標によるスキャンライン） */
  private rasterize(v0: TransformedVertex, v1: TransformedVertex, v2: TransformedVertex): Fragment[] {
    const fragments: Fragment[] = [];
    const minX = Math.max(0, Math.floor(Math.min(v0.screenX, v1.screenX, v2.screenX)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(v0.screenX, v1.screenX, v2.screenX)));
    const minY = Math.max(0, Math.floor(Math.min(v0.screenY, v1.screenY, v2.screenY)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(v0.screenY, v1.screenY, v2.screenY)));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const bary = barycentric(x + 0.5, y + 0.5, v0, v1, v2);
        if (!bary) continue;
        if (bary.u < 0 || bary.v < 0 || bary.w < 0) continue;

        const depth = v0.depth * bary.u + v1.depth * bary.v + v2.depth * bary.w;

        // varying補間
        const varyings = new Map<string, number[]>();
        for (const [key, val0] of v0.varyings) {
          const val1 = v1.varyings.get(key);
          const val2 = v2.varyings.get(key);
          if (!val1 || !val2) continue;
          const interpolated: number[] = [];
          for (let i = 0; i < val0.length; i++) {
            interpolated.push(
              (val0[i] ?? 0) * bary.u + (val1[i] ?? 0) * bary.v + (val2[i] ?? 0) * bary.w,
            );
          }
          varyings.set(key, interpolated);
        }

        fragments.push({ x, y, depth, varyings });
      }
    }
    return fragments;
  }

  /** 深度テスト */
  private depthTest(x: number, y: number, depth: number): boolean {
    const idx = y * this.width + x;
    const current = this.depthBuffer[idx] ?? 1.0;
    return compareFunc(this.state.depthFunc, depth, current);
  }

  /** ステンシルテスト */
  private stencilTest(x: number, y: number): boolean {
    const idx = y * this.width + x;
    const current = (this.stencilBuffer[idx] ?? 0) & this.state.stencilMask;
    const ref = this.state.stencilRef & this.state.stencilMask;
    return compareFunc(this.state.stencilFunc, ref, current);
  }

  /** ステンシルオペレーションを適用 */
  private applyStencilOp(x: number, y: number, op: StencilOp): void {
    const idx = y * this.width + x;
    const current = this.stencilBuffer[idx] ?? 0;
    switch (op) {
      case 'KEEP': break;
      case 'ZERO': this.stencilBuffer[idx] = 0; break;
      case 'REPLACE': this.stencilBuffer[idx] = this.state.stencilRef; break;
      case 'INCR': this.stencilBuffer[idx] = Math.min(255, current + 1); break;
      case 'DECR': this.stencilBuffer[idx] = Math.max(0, current - 1); break;
      case 'INVERT': this.stencilBuffer[idx] = (~current) & 0xFF; break;
    }
  }

  /** ブレンディング */
  private blend(src: Color, dst: Color): Color {
    const sf = blendFactorValue(this.state.blendSrcFactor, src, dst);
    const df = blendFactorValue(this.state.blendDstFactor, src, dst);

    const blendChannel = (s: number, d: number, sfv: number, dfv: number): number => {
      switch (this.state.blendEquation) {
        case 'FUNC_ADD': return s * sfv + d * dfv;
        case 'FUNC_SUBTRACT': return s * sfv - d * dfv;
        case 'FUNC_REVERSE_SUBTRACT': return d * dfv - s * sfv;
        default: return s * sfv + d * dfv;
      }
    };

    return {
      r: clamp(blendChannel(src.r, dst.r, sf, df), 0, 1),
      g: clamp(blendChannel(src.g, dst.g, sf, df), 0, 1),
      b: clamp(blendChannel(src.b, dst.b, sf, df), 0, 1),
      a: clamp(blendChannel(src.a, dst.a, sf, df), 0, 1),
    };
  }

  /** テクスチャユニットからサンプリング */
  private sampleTextureUnit(unit: number, u: number, v: number): Color {
    const texId = this.state.boundTextures.get(unit);
    if (texId === undefined) return { r: 1, g: 0, b: 1, a: 1 }; // マゼンタ: テクスチャなし
    const tex = this.textures.get(texId);
    if (!tex || tex.width === 0) return { r: 1, g: 0, b: 1, a: 1 };
    return sampleTexture(tex, u, v);
  }

  /** ピクセル読み取り */
  private readPixel(x: number, y: number): Color {
    const idx = (y * this.width + x) * 4;
    return {
      r: this.colorBuffer[idx] ?? 0,
      g: this.colorBuffer[idx + 1] ?? 0,
      b: this.colorBuffer[idx + 2] ?? 0,
      a: this.colorBuffer[idx + 3] ?? 0,
    };
  }

  /** ピクセル書き込み */
  private writePixel(x: number, y: number, color: Color): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    this.colorBuffer[idx] = color.r;
    this.colorBuffer[idx + 1] = color.g;
    this.colorBuffer[idx + 2] = color.b;
    this.colorBuffer[idx + 3] = color.a;
  }

  /** フレームバッファをUint8Arrayに変換（Canvas描画用） */
  private toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < this.colorBuffer.length; i++) {
      result[i] = Math.round(clamp(this.colorBuffer[i] ?? 0, 0, 1) * 255);
    }
    return result;
  }
}

// ======== ヘルパー関数 ========

/** GLSLソースから変数宣言をパース */
function parseGLSLDeclarations(source: string): import('./types').VariableDecl[] {
  const decls: import('./types').VariableDecl[] = [];
  const regex = /\b(attribute|uniform|varying)\s+([\w]+)\s+([\w]+)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    decls.push({
      qualifier: match[1] as 'attribute' | 'uniform' | 'varying',
      type: match[2] ?? '',
      name: match[3] ?? '',
    });
  }
  return decls;
}

/** 重心座標を計算 */
function barycentric(
  px: number, py: number,
  v0: TransformedVertex, v1: TransformedVertex, v2: TransformedVertex,
): { u: number; v: number; w: number } | null {
  const d00 = (v1.screenX - v0.screenX) ** 2 + (v1.screenY - v0.screenY) ** 2;
  const d01 = (v1.screenX - v0.screenX) * (v2.screenX - v0.screenX) +
              (v1.screenY - v0.screenY) * (v2.screenY - v0.screenY);
  const d11 = (v2.screenX - v0.screenX) ** 2 + (v2.screenY - v0.screenY) ** 2;
  const d20 = (px - v0.screenX) * (v1.screenX - v0.screenX) +
              (py - v0.screenY) * (v1.screenY - v0.screenY);
  const d21 = (px - v0.screenX) * (v2.screenX - v0.screenX) +
              (py - v0.screenY) * (v2.screenY - v0.screenY);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-10) return null;
  const bv = (d11 * d20 - d01 * d21) / denom;
  const bw = (d00 * d21 - d01 * d20) / denom;
  return { u: 1.0 - bv - bw, v: bv, w: bw };
}

/** 比較関数 */
function compareFunc(func: import('./types').DepthFunc, value: number, reference: number): boolean {
  switch (func) {
    case 'NEVER': return false;
    case 'LESS': return value < reference;
    case 'EQUAL': return Math.abs(value - reference) < 1e-6;
    case 'LEQUAL': return value <= reference + 1e-6;
    case 'GREATER': return value > reference;
    case 'NOTEQUAL': return Math.abs(value - reference) >= 1e-6;
    case 'GEQUAL': return value >= reference - 1e-6;
    case 'ALWAYS': return true;
    default: return true;
  }
}

/** ブレンドファクターの値を計算 */
function blendFactorValue(
  factor: import('./types').BlendFactor, src: Color, _dst: Color,
): number {
  switch (factor) {
    case 'ZERO': return 0;
    case 'ONE': return 1;
    case 'SRC_ALPHA': return src.a;
    case 'ONE_MINUS_SRC_ALPHA': return 1 - src.a;
    case 'DST_ALPHA': return _dst.a;
    case 'ONE_MINUS_DST_ALPHA': return 1 - _dst.a;
    default: return 1;
  }
}

/** テクスチャサンプリング */
function sampleTexture(tex: TextureObject, u: number, v: number): Color {
  const wu = wrapCoord(u, tex.wrapS);
  const wv = wrapCoord(v, tex.wrapT);

  if (tex.magFilter === 'LINEAR') {
    // バイリニア補間
    const fx = wu * tex.width - 0.5;
    const fy = wv * tex.height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = x0 + 1, y1 = y0 + 1;
    const tx = fx - x0, ty = fy - y0;
    const c00 = readTexel(tex, x0, y0);
    const c10 = readTexel(tex, x1, y0);
    const c01 = readTexel(tex, x0, y1);
    const c11 = readTexel(tex, x1, y1);
    return {
      r: lerp(lerp(c00.r, c10.r, tx), lerp(c01.r, c11.r, tx), ty),
      g: lerp(lerp(c00.g, c10.g, tx), lerp(c01.g, c11.g, tx), ty),
      b: lerp(lerp(c00.b, c10.b, tx), lerp(c01.b, c11.b, tx), ty),
      a: lerp(lerp(c00.a, c10.a, tx), lerp(c01.a, c11.a, tx), ty),
    };
  }

  // NEAREST
  const x = clamp(Math.floor(wu * tex.width), 0, tex.width - 1);
  const y = clamp(Math.floor(wv * tex.height), 0, tex.height - 1);
  return readTexel(tex, x, y);
}

/** テクセル読み取り */
function readTexel(tex: TextureObject, x: number, y: number): Color {
  const cx = ((x % tex.width) + tex.width) % tex.width;
  const cy = ((y % tex.height) + tex.height) % tex.height;
  const idx = (cy * tex.width + cx) * 4;
  return {
    r: tex.data[idx] ?? 0,
    g: tex.data[idx + 1] ?? 0,
    b: tex.data[idx + 2] ?? 0,
    a: tex.data[idx + 3] ?? 0,
  };
}

/** テクスチャ座標のラップ処理 */
function wrapCoord(coord: number, mode: WrapMode): number {
  switch (mode) {
    case 'REPEAT':
      return ((coord % 1) + 1) % 1;
    case 'CLAMP_TO_EDGE':
      return clamp(coord, 0, 1);
    case 'MIRRORED_REPEAT': {
      const t = ((coord % 2) + 2) % 2;
      return t > 1 ? 2 - t : t;
    }
    default:
      return ((coord % 1) + 1) % 1;
  }
}

