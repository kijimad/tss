/**
 * WebGL シミュレーター プリセット集
 *
 * WebGLの各概念を教育的に示す12のプリセットを定義する。
 * 各プリセットはGLContextを使ってAPI呼び出しを順番に実行し、
 * パイプラインの動作を可視化する。
 */

import type { WebGLPreset, Color, Vec4, UniformValue, Mat4 } from './types';
import { GLContext } from './engine';
import {
  mat4Identity, mat4Multiply, mat4Perspective, mat4RotateY, mat4RotateX,
  mat4Translate, mat4MulVec4,
} from './math';

/** チェッカーパターンテクスチャを生成 */
function generateChecker(
  w: number, h: number, gridSize: number,
  c1: Color = { r: 1, g: 1, b: 1, a: 1 },
  c2: Color = { r: 0.2, g: 0.2, b: 0.2, a: 1 },
): Float32Array {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = ((Math.floor(x / gridSize) + Math.floor(y / gridSize)) % 2 === 0) ? c1 : c2;
      const i = (y * w + x) * 4;
      data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = c.a;
    }
  }
  return data;
}

/** グラデーションテクスチャを生成 */
function generateGradient(w: number, h: number, top: Color, bottom: Color): Float32Array {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const r = top.r * (1 - t) + bottom.r * t;
    const g = top.g * (1 - t) + bottom.g * t;
    const b = top.b * (1 - t) + bottom.b * t;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  return data;
}

/** 基本的な頂点シェーダ: MVP変換 + varying色/UV出力 */
function basicVertexShader(
  attrs: Map<string, number[]>,
  uniforms: Map<string, UniformValue>,
) {
  const pos = attrs.get('aPosition') ?? [0, 0, 0];
  const col = attrs.get('aColor') ?? [1, 1, 1, 1];
  const uv = attrs.get('aTexCoord') ?? [0, 0];
  const mvp = (uniforms.get('uMVP') ?? mat4Identity()) as Mat4;
  const v: Vec4 = { x: pos[0] ?? 0, y: pos[1] ?? 0, z: pos[2] ?? 0, w: 1 };
  const clipPos = mat4MulVec4(mvp, v);
  const varyings = new Map<string, number[]>();
  varyings.set('vColor', [...col]);
  varyings.set('vTexCoord', [...uv]);
  return { position: clipPos, varyings };
}

/** 基本的なフラグメントシェーダ: varying色をそのまま出力 */
function colorFragmentShader(
  varyings: Map<string, number[]>,
  _uniforms: Map<string, UniformValue>,
  _texSampler: (unit: number, u: number, v: number) => Color,
): Color {
  const c = varyings.get('vColor') ?? [1, 1, 1, 1];
  return { r: c[0] ?? 1, g: c[1] ?? 1, b: c[2] ?? 1, a: c[3] ?? 1 };
}

/** テクスチャフラグメントシェーダ */
function textureFragmentShader(
  varyings: Map<string, number[]>,
  _uniforms: Map<string, UniformValue>,
  texSampler: (unit: number, u: number, v: number) => Color,
): Color {
  const uv = varyings.get('vTexCoord') ?? [0, 0];
  return texSampler(0, uv[0] ?? 0, uv[1] ?? 0);
}


/** GLコンテキストにシンプルなVAOセットアップ */
function setupTriangleVAO(
  gl: GLContext, progId: number,
  vertices: number[], hasColor: boolean, hasUV: boolean,
): void {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer('ARRAY_BUFFER', vbo);
  gl.bufferData('ARRAY_BUFFER', vertices, 'STATIC_DRAW');

  // position: 3 floats
  let stride = 3;
  if (hasColor) stride += 4;
  if (hasUV) stride += 2;
  const strideBytes = stride * 4;

  const posLoc = gl.getAttribLocation(progId, 'aPosition');
  gl.vertexAttribPointer(posLoc, 3, strideBytes, 0);
  gl.enableVertexAttribArray(posLoc);

  let offset = 3 * 4;
  if (hasColor) {
    const colLoc = gl.getAttribLocation(progId, 'aColor');
    gl.vertexAttribPointer(colLoc, 4, strideBytes, offset);
    gl.enableVertexAttribArray(colLoc);
    offset += 4 * 4;
  }
  if (hasUV) {
    const uvLoc = gl.getAttribLocation(progId, 'aTexCoord');
    gl.vertexAttribPointer(uvLoc, 2, strideBytes, offset);
    gl.enableVertexAttribArray(uvLoc);
  }
}

/** シェーダプログラムを作成しリンク */
function createAndLinkProgram(
  gl: GLContext,
  vsSrc: string, fsSrc: string,
  vsFn: typeof basicVertexShader, fsFn: typeof colorFragmentShader,
): number {
  const vs = gl.createShader('VERTEX_SHADER');
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);

  const fs = gl.createShader('FRAGMENT_SHADER');
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.setShaderFunctions(prog, vsFn, fsFn);
  return prog;
}

// GLSL ソースコード (表示用)
const BASIC_VS = `attribute vec3 aPosition;
attribute vec4 aColor;
attribute vec2 aTexCoord;
uniform mat4 uMVP;
varying vec4 vColor;
varying vec2 vTexCoord;
void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);
  vColor = aColor;
  vTexCoord = aTexCoord;
}`;

const COLOR_FS = `varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;

const TEX_FS = `uniform sampler2D uTexture;
varying vec2 vTexCoord;
void main() {
  gl_FragColor = texture2D(uTexture, vTexCoord);
}`;

const SIZE = 128;

/** 全プリセット */
export const presets: WebGLPreset[] = [
  // 1. 三角形の描画
  {
    name: '三角形の描画',
    description: '最小限のGL呼び出しで1つのカラフルな三角形を描画する。\n' +
      'VBO→VAO→シェーダプログラム→drawArraysの基本フロー。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, false);

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // 頂点データ: position(3) + color(4)
      const verts = [
        // x, y, z, r, g, b, a
         0.0,  0.7, 0.0,  1, 0, 0, 1,
        -0.6, -0.5, 0.0,  0, 1, 0, 1,
         0.6, -0.5, 0.0,  0, 0, 1, 1,
      ];
      setupTriangleVAO(gl, prog, verts, true, false);

      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 2. シェーダコンパイルとリンク
  {
    name: 'シェーダコンパイルとリンク',
    description: '頂点シェーダとフラグメントシェーダのコンパイル・リンクプロセスを表示。\n' +
      'attribute/uniform/varyingの宣言がどのようにパースされ、\nプログラムオブジェクトにリンクされるかを可視化する。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.05, 0.05, 0.1, 1);
      gl.clear(true, true, false);

      // シェーダコンパイルのプロセスが見えるように個別に実行
      const vs = gl.createShader('VERTEX_SHADER');
      gl.shaderSource(vs, BASIC_VS);
      gl.compileShader(vs);

      const fs = gl.createShader('FRAGMENT_SHADER');
      gl.shaderSource(fs, COLOR_FS);
      gl.compileShader(fs);

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.useProgram(prog);
      gl.setShaderFunctions(prog, basicVertexShader, colorFragmentShader);

      // 結果表示用に小さな三角形を描画
      const verts = [
        0.0, 0.5, 0.0,  0.8, 0.6, 1.0, 1.0,
       -0.4, -0.3, 0.0,  0.6, 0.8, 1.0, 1.0,
        0.4, -0.3, 0.0,  1.0, 0.6, 0.8, 1.0,
      ];
      setupTriangleVAO(gl, prog, verts, true, false);
      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 3. VBO + EBO（インデックスバッファ）
  {
    name: 'VBO + EBO（インデックスバッファ）',
    description: '四角形を2つの三角形で描画する。\n' +
      'EBO（Element Buffer Object）で頂点を共有し、\n4頂点で四角形を効率的に描く。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, false);

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      // 4頂点: position(3) + color(4)
      const vbo = gl.createBuffer();
      gl.bindBuffer('ARRAY_BUFFER', vbo);
      gl.bufferData('ARRAY_BUFFER', [
        -0.5,  0.5, 0.0,  1, 0, 0, 1,  // 左上
         0.5,  0.5, 0.0,  0, 1, 0, 1,  // 右上
         0.5, -0.5, 0.0,  0, 0, 1, 1,  // 右下
        -0.5, -0.5, 0.0,  1, 1, 0, 1,  // 左下
      ], 'STATIC_DRAW');

      const posLoc = gl.getAttribLocation(prog, 'aPosition');
      gl.vertexAttribPointer(posLoc, 3, 28, 0);
      gl.enableVertexAttribArray(posLoc);
      const colLoc = gl.getAttribLocation(prog, 'aColor');
      gl.vertexAttribPointer(colLoc, 4, 28, 12);
      gl.enableVertexAttribArray(colLoc);

      // インデックスバッファ: 2三角形
      const ebo = gl.createBuffer();
      gl.bindBuffer('ELEMENT_ARRAY_BUFFER', ebo);
      gl.bufferData('ELEMENT_ARRAY_BUFFER', [0, 1, 2, 0, 2, 3], 'STATIC_DRAW');

      gl.setUniform('uMVP', mat4Identity());
      gl.drawElements('TRIANGLES', 6, 0);
      return gl.getResult();
    },
  },

  // 4. MVP変換パイプライン
  {
    name: 'MVP変換パイプライン',
    description: 'Model→View→Projection変換の各ステージを可視化。\n' +
      'モデル行列（回転）、ビュー行列（カメラ位置）、\n投影行列（透視投影）の合成で3D→2D変換を行う。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.05, 0.05, 0.1, 1);
      gl.clear(true, true, false);
      gl.enable('DEPTH_TEST');

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // 三角形のモデルデータ
      const verts = [
         0.0,  0.5, 0.0,  1, 0.3, 0.3, 1,
        -0.5, -0.3, 0.0,  0.3, 1, 0.3, 1,
         0.5, -0.3, 0.0,  0.3, 0.3, 1, 1,
      ];
      setupTriangleVAO(gl, prog, verts, true, false);

      // MVP行列の構成
      const model = mat4Multiply(mat4RotateY(0.5), mat4RotateX(0.3));
      const view = mat4Translate(0, 0, -3);
      const projection = mat4Perspective(Math.PI / 4, 1, 0.1, 100);
      const mvp = mat4Multiply(projection, mat4Multiply(view, model));

      gl.setUniform('uMVP', mvp);
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 5. テクスチャマッピング
  {
    name: 'テクスチャマッピング',
    description: 'チェッカーパターンテクスチャを四角形にマッピング。\n' +
      'UV座標でテクセルをフェッチし、フラグメントシェーダでサンプリングする。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, false);

      const prog = createAndLinkProgram(gl, BASIC_VS, TEX_FS, basicVertexShader, textureFragmentShader);

      // テクスチャ作成
      const tex = gl.createTexture();
      gl.activeTexture(0);
      gl.bindTexture(tex);
      gl.texImage2D(8, 8, generateChecker(8, 8, 2,
        { r: 0.2, g: 0.6, b: 1.0, a: 1 },
        { r: 0.1, g: 0.1, b: 0.2, a: 1 }));
      gl.texParameteri('TEXTURE_MIN_FILTER', 'NEAREST');
      gl.texParameteri('TEXTURE_MAG_FILTER', 'NEAREST');

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      // position(3) + uv(2)
      const vbo = gl.createBuffer();
      gl.bindBuffer('ARRAY_BUFFER', vbo);
      gl.bufferData('ARRAY_BUFFER', [
        -0.6,  0.6, 0.0,  0, 0,
         0.6,  0.6, 0.0,  1, 0,
         0.6, -0.6, 0.0,  1, 1,
        -0.6,  0.6, 0.0,  0, 0,
         0.6, -0.6, 0.0,  1, 1,
        -0.6, -0.6, 0.0,  0, 1,
      ], 'STATIC_DRAW');

      const posLoc = gl.getAttribLocation(prog, 'aPosition');
      gl.vertexAttribPointer(posLoc, 3, 20, 0);
      gl.enableVertexAttribArray(posLoc);
      const uvLoc = gl.getAttribLocation(prog, 'aTexCoord');
      gl.vertexAttribPointer(uvLoc, 2, 20, 12);
      gl.enableVertexAttribArray(uvLoc);

      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 6);
      return gl.getResult();
    },
  },

  // 6. テクスチャラップ/フィルタ比較
  {
    name: 'テクスチャラップ/フィルタ比較',
    description: 'UV座標を0〜2に拡大して3つのラップモードを比較:\n' +
      '左: REPEAT（繰り返し）\n中: CLAMP_TO_EDGE（端固定）\n右: MIRRORED_REPEAT（鏡像反復）',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, false);

      const texData = generateGradient(8, 8,
        { r: 1, g: 0.4, b: 0.1, a: 1 },
        { r: 0.1, g: 0.4, b: 1.0, a: 1 });

      const modes: [string, string][] = [
        ['REPEAT', 'REPEAT'],
        ['CLAMP_TO_EDGE', 'CLAMP_TO_EDGE'],
        ['MIRRORED_REPEAT', 'MIRRORED_REPEAT'],
      ];

      for (let i = 0; i < modes.length; i++) {
        const prog = createAndLinkProgram(gl, BASIC_VS, TEX_FS, basicVertexShader, textureFragmentShader);

        const tex = gl.createTexture();
        gl.activeTexture(0);
        gl.bindTexture(tex);
        gl.texImage2D(8, 8, texData);
        gl.texParameteri('TEXTURE_WRAP_S', modes[i]?.[0] ?? 'REPEAT');
        gl.texParameteri('TEXTURE_WRAP_T', modes[i]?.[1] ?? 'REPEAT');
        gl.texParameteri('TEXTURE_MAG_FILTER', 'NEAREST');

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // 3列に並べる
        const x0 = -0.95 + i * 0.65;
        const x1 = x0 + 0.6;
        const vbo = gl.createBuffer();
        gl.bindBuffer('ARRAY_BUFFER', vbo);
        gl.bufferData('ARRAY_BUFFER', [
          x0, 0.5, 0, 0, 0,
          x1, 0.5, 0, 2, 0,  // UV 0〜2
          x1, -0.5, 0, 2, 2,
          x0, 0.5, 0, 0, 0,
          x1, -0.5, 0, 2, 2,
          x0, -0.5, 0, 0, 2,
        ], 'STATIC_DRAW');

        const posLoc = gl.getAttribLocation(prog, 'aPosition');
        gl.vertexAttribPointer(posLoc, 3, 20, 0);
        gl.enableVertexAttribArray(posLoc);
        const uvLoc = gl.getAttribLocation(prog, 'aTexCoord');
        gl.vertexAttribPointer(uvLoc, 2, 20, 12);
        gl.enableVertexAttribArray(uvLoc);

        gl.setUniform('uMVP', mat4Identity());
        gl.drawArrays('TRIANGLES', 0, 6);
      }
      return gl.getResult();
    },
  },

  // 7. 深度テスト
  {
    name: '深度テスト',
    description: '重なる2つの三角形を描画し、深度テストの効果を確認する。\n' +
      '赤い三角形（z=0.0）が青い三角形（z=0.5）の手前に表示される。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, false);
      gl.enable('DEPTH_TEST');
      gl.depthFunc('LESS');

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // 奥の三角形（青）を先に描画
      const verts1 = [
        -0.3,  0.6, 0.5,  0.2, 0.3, 0.9, 1,
        -0.7, -0.4, 0.5,  0.2, 0.3, 0.9, 1,
         0.3, -0.2, 0.5,  0.2, 0.3, 0.9, 1,
      ];
      setupTriangleVAO(gl, prog, verts1, true, false);
      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);

      // 手前の三角形（赤）
      const verts2 = [
         0.3,  0.5, 0.0,  0.9, 0.2, 0.2, 1,
        -0.3, -0.3, 0.0,  0.9, 0.2, 0.2, 1,
         0.7,  0.0, 0.0,  0.9, 0.2, 0.2, 1,
      ];
      setupTriangleVAO(gl, prog, verts2, true, false);
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 8. アルファブレンディング
  {
    name: 'アルファブレンディング',
    description: '半透明オブジェクトの描画を示す。\n' +
      'SRC_ALPHA / ONE_MINUS_SRC_ALPHA ブレンドで\n背景の色と半透明のオブジェクトが混合される。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.15, 0.15, 0.2, 1);
      gl.clear(true, true, false);
      gl.enable('BLEND');
      gl.blendFunc('SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA');

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // 不透明な緑の三角形（背景）
      const bg = [
        -0.6,  0.6, 0.0,  0.1, 0.8, 0.2, 1.0,
        -0.8, -0.6, 0.0,  0.1, 0.8, 0.2, 1.0,
         0.4, -0.2, 0.0,  0.1, 0.8, 0.2, 1.0,
      ];
      setupTriangleVAO(gl, prog, bg, true, false);
      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);

      // 半透明の赤い三角形
      const fg = [
         0.0,  0.7, 0.0,  1.0, 0.2, 0.2, 0.5,
        -0.4, -0.5, 0.0,  1.0, 0.2, 0.2, 0.5,
         0.7, -0.1, 0.0,  1.0, 0.2, 0.2, 0.5,
      ];
      setupTriangleVAO(gl, prog, fg, true, false);
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 9. バックフェスカリング
  {
    name: 'バックフェスカリング',
    description: '表面（CCW）と裏面（CW）の三角形を描画し、\nカリングにより裏面が棄却される様子を示す。\n左: 表面（描画される）/ 右: 裏面（カリングされる）',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, false);
      gl.enable('CULL_FACE');
      gl.cullFace('BACK');
      gl.frontFace('CCW');

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // 左: CCW（表面） → 描画される
      const ccw = [
        -0.7,  0.5, 0.0,  0.2, 0.8, 0.4, 1,
        -0.9, -0.5, 0.0,  0.2, 0.8, 0.4, 1,
        -0.1, -0.5, 0.0,  0.2, 0.8, 0.4, 1,
      ];
      setupTriangleVAO(gl, prog, ccw, true, false);
      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);

      // 右: CW（裏面） → カリングされる
      const cw = [
        0.7,  0.5, 0.0,  0.8, 0.2, 0.2, 1,
        0.9, -0.5, 0.0,  0.8, 0.2, 0.2, 1,
        0.1, -0.5, 0.0,  0.8, 0.2, 0.2, 1,
      ];
      setupTriangleVAO(gl, prog, cw, true, false);
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 10. ステンシルテスト
  {
    name: 'ステンシルテスト',
    description: 'ステンシルバッファでマスク領域を作成し、\nその領域内にのみ描画を制限する。\n1. 中央に小さな三角形でステンシル=1を書込\n2. ステンシル=1の領域のみカラフルな三角形を描画',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(true, true, true);
      gl.enable('STENCIL_TEST');

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // パス1: ステンシルバッファに書込（色は書かない）
      gl.stencilFunc('ALWAYS', 1, 0xFF);
      gl.stencilOp('KEEP', 'KEEP', 'REPLACE');

      // マスク用の小さな三角形
      const mask = [
         0.0,  0.4, 0.0,  0, 0, 0, 0,
        -0.3, -0.2, 0.0,  0, 0, 0, 0,
         0.3, -0.2, 0.0,  0, 0, 0, 0,
      ];
      setupTriangleVAO(gl, prog, mask, true, false);
      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);

      // パス2: ステンシル=1の領域のみ描画
      gl.stencilFunc('EQUAL', 1, 0xFF);
      gl.stencilOp('KEEP', 'KEEP', 'KEEP');

      // 大きなカラフル三角形（ステンシルマスクでクリップされる）
      const big = [
         0.0,  0.8, 0.0,  1, 0.3, 0.1, 1,
        -0.8, -0.7, 0.0,  0.1, 1, 0.3, 1,
         0.8, -0.7, 0.0,  0.1, 0.3, 1, 1,
      ];
      setupTriangleVAO(gl, prog, big, true, false);
      gl.drawArrays('TRIANGLES', 0, 3);
      return gl.getResult();
    },
  },

  // 11. GL状態マシン
  {
    name: 'GL状態マシン',
    description: 'WebGLの状態マシンの概念を示す。\n' +
      'enable/disable/bind呼び出しがどのように内部状態を変更し、\n' +
      'drawArrays時にパイプラインの動作に影響するかを可視化する。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.05, 0.05, 0.1, 1);
      gl.clear(true, true, false);

      // 状態変更のデモ
      gl.viewport(0, 0, SIZE, SIZE);
      gl.enable('DEPTH_TEST');
      gl.depthFunc('LEQUAL');
      gl.enable('BLEND');
      gl.blendFunc('SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA');
      gl.enable('CULL_FACE');
      gl.cullFace('BACK');
      gl.frontFace('CCW');

      const prog = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);

      // 3つの重なる半透明三角形を描画
      const colors = [
        [0.9, 0.2, 0.2, 0.7],
        [0.2, 0.9, 0.2, 0.7],
        [0.2, 0.2, 0.9, 0.7],
      ];

      for (let i = 0; i < 3; i++) {
        const offset = (i - 1) * 0.3;
        const z = i * 0.1;
        const c = colors[i] ?? [1, 1, 1, 1];
        const verts = [
          0.0 + offset,  0.6, z,  c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1,
          -0.5 + offset, -0.4, z,  c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1,
          0.5 + offset, -0.4, z,  c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1,
        ];
        setupTriangleVAO(gl, prog, verts, true, false);
        gl.setUniform('uMVP', mat4Identity());
        gl.drawArrays('TRIANGLES', 0, 3);
      }

      // 状態を元に戻す
      gl.disable('BLEND');
      gl.disable('CULL_FACE');
      return gl.getResult();
    },
  },

  // 12. 複数drawCall合成
  {
    name: '複数drawCall合成',
    description: '複数のオブジェクトを異なるシェーダ・テクスチャで描画する。\n' +
      '各drawCallの前に状態を切り替え、\nフレームバッファに順次合成される過程を確認する。',
    build() {
      const gl = new GLContext(SIZE, SIZE);
      gl.clearColor(0.08, 0.08, 0.12, 1);
      gl.clear(true, true, false);
      gl.enable('DEPTH_TEST');

      // drawCall 1: テクスチャ付き四角形（背景）
      const prog1 = createAndLinkProgram(gl, BASIC_VS, TEX_FS, basicVertexShader, textureFragmentShader);
      const tex = gl.createTexture();
      gl.activeTexture(0);
      gl.bindTexture(tex);
      gl.texImage2D(16, 16, generateChecker(16, 16, 4,
        { r: 0.15, g: 0.15, b: 0.25, a: 1 },
        { r: 0.1, g: 0.1, b: 0.18, a: 1 }));
      gl.texParameteri('TEXTURE_MAG_FILTER', 'NEAREST');

      const vao1 = gl.createVertexArray();
      gl.bindVertexArray(vao1);
      const vbo1 = gl.createBuffer();
      gl.bindBuffer('ARRAY_BUFFER', vbo1);
      gl.bufferData('ARRAY_BUFFER', [
        -1, 1, 0.9,  0, 0,
         1, 1, 0.9,  2, 0,
         1, -1, 0.9,  2, 2,
        -1, 1, 0.9,  0, 0,
         1, -1, 0.9,  2, 2,
        -1, -1, 0.9,  0, 2,
      ], 'STATIC_DRAW');
      gl.vertexAttribPointer(gl.getAttribLocation(prog1, 'aPosition'), 3, 20, 0);
      gl.enableVertexAttribArray(gl.getAttribLocation(prog1, 'aPosition'));
      gl.vertexAttribPointer(gl.getAttribLocation(prog1, 'aTexCoord'), 2, 20, 12);
      gl.enableVertexAttribArray(gl.getAttribLocation(prog1, 'aTexCoord'));

      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 6);

      // drawCall 2: 色付き三角形（前景）
      const prog2 = createAndLinkProgram(gl, BASIC_VS, COLOR_FS, basicVertexShader, colorFragmentShader);
      const verts2 = [
         0.0,  0.7, 0.0,  1.0, 0.8, 0.2, 1,
        -0.5, -0.3, 0.0,  0.2, 1.0, 0.5, 1,
         0.5, -0.3, 0.0,  0.5, 0.2, 1.0, 1,
      ];
      setupTriangleVAO(gl, prog2, verts2, true, false);
      gl.setUniform('uMVP', mat4Identity());
      gl.drawArrays('TRIANGLES', 0, 3);

      return gl.getResult();
    },
  },
];
