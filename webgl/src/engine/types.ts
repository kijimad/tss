/**
 * WebGL シミュレーター型定義
 *
 * WebGL の主要概念をTypeScriptの型で表現する:
 * - GL状態マシン（ブレンド、深度テスト、カリング等）
 * - バッファオブジェクト（VBO, EBO, VAO）
 * - シェーダプログラム（頂点/フラグメントシェーダ）
 * - テクスチャとサンプラー
 * - レンダリングパイプラインの各ステージ
 */

// ======== ベクトル・行列 ========

/** 2次元ベクトル */
export interface Vec2 { x: number; y: number }

/** 3次元ベクトル */
export interface Vec3 { x: number; y: number; z: number }

/** 4次元ベクトル（同次座標） */
export interface Vec4 { x: number; y: number; z: number; w: number }

/** RGBA色（各成分0〜1） */
export interface Color { r: number; g: number; b: number; a: number }

/** 4x4行列（列優先、OpenGL形式） */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

// ======== GLオブジェクトハンドル ========

/** GLオブジェクトID（WebGLではGLuintハンドル） */
export type GLuint = number;

// ======== バッファオブジェクト ========

/** バッファ使用区分 */
export type BufferTarget = 'ARRAY_BUFFER' | 'ELEMENT_ARRAY_BUFFER';

/** バッファ使用ヒント */
export type BufferUsage = 'STATIC_DRAW' | 'DYNAMIC_DRAW' | 'STREAM_DRAW';

/** VBO / EBO */
export interface BufferObject {
  /** オブジェクトID */
  id: GLuint;
  /** データ */
  data: number[];
  /** バイトサイズ */
  sizeBytes: number;
  /** 使用ヒント */
  usage: BufferUsage;
}

/** 頂点属性ポインタ設定（glVertexAttribPointer相当） */
export interface VertexAttribPointer {
  /** attribute location */
  index: number;
  /** 成分数（1,2,3,4） */
  size: number;
  /** ストライド（バイト） */
  stride: number;
  /** オフセット（バイト） */
  offset: number;
  /** バインド時のVBO ID */
  bufferRef: GLuint;
}

/** VAO（Vertex Array Object） */
export interface VAOObject {
  /** オブジェクトID */
  id: GLuint;
  /** 属性ポインタ設定 */
  attribPointers: Map<number, VertexAttribPointer>;
  /** バインドされたEBO */
  elementBuffer: GLuint | null;
  /** 有効な属性 */
  enabledAttribs: Set<number>;
}

// ======== シェーダ ========

/** シェーダ種別 */
export type ShaderType = 'VERTEX_SHADER' | 'FRAGMENT_SHADER';

/** GLSL変数宣言 */
export interface VariableDecl {
  /** 修飾子 */
  qualifier: 'attribute' | 'uniform' | 'varying';
  /** GLSL型名 */
  type: string;
  /** 変数名 */
  name: string;
}

/** シェーダオブジェクト */
export interface ShaderObject {
  id: GLuint;
  type: ShaderType;
  source: string;
  compiled: boolean;
  infoLog: string;
  /** パース済み変数宣言 */
  variables: VariableDecl[];
}

/** プログラムオブジェクト */
export interface ProgramObject {
  id: GLuint;
  vertexShader: GLuint | null;
  fragmentShader: GLuint | null;
  linked: boolean;
  infoLog: string;
  /** attribute名→location */
  attributeLocations: Map<string, number>;
  /** uniform名→location */
  uniformLocations: Map<string, number>;
  /** uniform値の格納 */
  uniformValues: Map<string, UniformValue>;
  /** 頂点シェーダ実行関数 */
  vertexShaderFn: VertexShaderFn | null;
  /** フラグメントシェーダ実行関数 */
  fragmentShaderFn: FragmentShaderFn | null;
}

/** uniform値 */
export type UniformValue = number | Vec2 | Vec3 | Vec4 | Mat4;

/** 頂点シェーダ関数の型 */
export type VertexShaderFn = (
  attributes: Map<string, number[]>,
  uniforms: Map<string, UniformValue>,
) => VertexShaderOutput;

/** 頂点シェーダ出力 */
export interface VertexShaderOutput {
  /** gl_Position */
  position: Vec4;
  /** varying変数出力 */
  varyings: Map<string, number[]>;
}

/** フラグメントシェーダ関数の型 */
export type FragmentShaderFn = (
  varyings: Map<string, number[]>,
  uniforms: Map<string, UniformValue>,
  textureSampler: (unit: number, u: number, v: number) => Color,
) => Color;

// ======== テクスチャ ========

/** テクスチャラップモード */
export type WrapMode = 'REPEAT' | 'CLAMP_TO_EDGE' | 'MIRRORED_REPEAT';

/** テクスチャフィルタモード */
export type FilterMode = 'NEAREST' | 'LINEAR';

/** テクスチャオブジェクト */
export interface TextureObject {
  id: GLuint;
  width: number;
  height: number;
  /** RGBAピクセルデータ（Float32、各ピクセル4値） */
  data: Float32Array;
  wrapS: WrapMode;
  wrapT: WrapMode;
  minFilter: FilterMode;
  magFilter: FilterMode;
}

// ======== GL状態マシン ========

/** 深度テスト関数 */
export type DepthFunc = 'NEVER' | 'LESS' | 'EQUAL' | 'LEQUAL' | 'GREATER' | 'NOTEQUAL' | 'GEQUAL' | 'ALWAYS';

/** ブレンドファクター */
export type BlendFactor = 'ZERO' | 'ONE' | 'SRC_ALPHA' | 'ONE_MINUS_SRC_ALPHA' | 'DST_ALPHA' | 'ONE_MINUS_DST_ALPHA';

/** ブレンド方程式 */
export type BlendEquation = 'FUNC_ADD' | 'FUNC_SUBTRACT' | 'FUNC_REVERSE_SUBTRACT';

/** カリングモード */
export type CullFaceMode = 'FRONT' | 'BACK' | 'FRONT_AND_BACK';

/** ステンシルオペレーション */
export type StencilOp = 'KEEP' | 'ZERO' | 'REPLACE' | 'INCR' | 'DECR' | 'INVERT';

/** 描画モード */
export type DrawMode = 'TRIANGLES' | 'TRIANGLE_STRIP' | 'TRIANGLE_FAN' | 'LINES' | 'LINE_STRIP' | 'POINTS';

/** GL状態マシン全体のスナップショット */
export interface GLState {
  /** 深度テスト有効 */
  depthTestEnabled: boolean;
  depthFunc: DepthFunc;
  depthWriteMask: boolean;
  /** ブレンド有効 */
  blendEnabled: boolean;
  blendSrcFactor: BlendFactor;
  blendDstFactor: BlendFactor;
  blendEquation: BlendEquation;
  /** カリング有効 */
  cullFaceEnabled: boolean;
  cullFaceMode: CullFaceMode;
  frontFace: 'CW' | 'CCW';
  /** ステンシルテスト有効 */
  stencilTestEnabled: boolean;
  stencilFunc: DepthFunc;
  stencilRef: number;
  stencilMask: number;
  stencilOpFail: StencilOp;
  stencilOpZFail: StencilOp;
  stencilOpZPass: StencilOp;
  /** ビューポート */
  viewport: { x: number; y: number; width: number; height: number };
  /** クリア色 */
  clearColor: Color;
  clearDepth: number;
  clearStencil: number;
  /** 現在のプログラム */
  currentProgram: GLuint | null;
  /** バインドされたバッファ */
  boundArrayBuffer: GLuint | null;
  boundElementArrayBuffer: GLuint | null;
  boundVAO: GLuint | null;
  /** アクティブテクスチャユニット */
  activeTextureUnit: number;
  /** テクスチャユニット→テクスチャID */
  boundTextures: Map<number, GLuint>;
}

// ======== パイプライン ========

/** パイプラインステージ名 */
export type PipelineStage =
  | 'VERTEX_FETCH' | 'VERTEX_SHADER' | 'PRIMITIVE_ASSEMBLY'
  | 'RASTERIZATION' | 'FRAGMENT_SHADER' | 'PER_FRAGMENT_OPS' | 'FRAMEBUFFER_WRITE';

/** 変換済み頂点 */
export interface TransformedVertex {
  /** クリップ空間座標 */
  clipPos: Vec4;
  /** スクリーン座標 */
  screenX: number;
  screenY: number;
  /** 正規化深度 */
  depth: number;
  /** varying変数 */
  varyings: Map<string, number[]>;
}

/** フラグメント */
export interface Fragment {
  x: number;
  y: number;
  depth: number;
  /** 補間されたvarying */
  varyings: Map<string, number[]>;
}

/** パイプライン実行統計 */
export interface PipelineStats {
  verticesFetched: number;
  verticesTransformed: number;
  primitivesAssembled: number;
  primitivesCulled: number;
  fragmentsGenerated: number;
  fragmentsPassedDepth: number;
  fragmentsPassedStencil: number;
  fragmentsBlended: number;
  pixelsWritten: number;
}

// ======== イベント / シミュレーション結果 ========

/** GLイベント（ログ用） */
export interface GLEvent {
  step: number;
  stage: PipelineStage | 'API' | 'STATE';
  severity: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

/** GL API呼び出し記録 */
export interface GLCall {
  api: string;
  args: string[];
  description: string;
}

/** 各ステップのスナップショット */
export interface StepSnapshot {
  step: number;
  call: GLCall;
  stats: PipelineStats | null;
}

/** シミュレーション結果 */
export interface WebGLSimResult {
  snapshots: StepSnapshot[];
  events: GLEvent[];
  /** 最終フレームバッファのRGBAデータ */
  framebuffer: Uint8Array;
  width: number;
  height: number;
  /** 累積パイプライン統計 */
  totalStats: PipelineStats;
}

/** プリセット定義 */
export interface WebGLPreset {
  name: string;
  description: string;
  build: () => WebGLSimResult;
}
