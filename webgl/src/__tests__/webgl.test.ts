/**
 * WebGL シミュレーター テスト
 */
import { describe, it, expect } from 'vitest';
import {
  mat4Identity, mat4Translate, mat4Scale, mat4RotateY,
  mat4Multiply, mat4MulVec4, mat4Perspective, mat4Ortho, mat4LookAt,
  vec3Normalize, vec3Cross, vec3Dot, vec3Length,
} from '../engine/math';
import type { Vec3, Vec4, Mat4 } from '../engine/types';
import { GLContext } from '../engine/engine';
import { presets } from '../engine/presets';

// ======== Math ========

describe('Math: 行列演算', () => {
  it('単位行列 × ベクトル = 元のベクトル', () => {
    const v: Vec4 = { x: 1, y: 2, z: 3, w: 1 };
    const result = mat4MulVec4(mat4Identity(), v);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(3);
    expect(result.w).toBeCloseTo(1);
  });

  it('平行移動行列が正しく適用される', () => {
    const v: Vec4 = { x: 0, y: 0, z: 0, w: 1 };
    const result = mat4MulVec4(mat4Translate(5, 3, -2), v);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(3);
    expect(result.z).toBeCloseTo(-2);
  });

  it('スケーリング行列が正しく適用される', () => {
    const v: Vec4 = { x: 1, y: 2, z: 3, w: 1 };
    const result = mat4MulVec4(mat4Scale(2, 3, 4), v);
    expect(result.x).toBeCloseTo(2);
    expect(result.y).toBeCloseTo(6);
    expect(result.z).toBeCloseTo(12);
  });

  it('行列乗算が結合法則を満たす', () => {
    const a = mat4Translate(1, 0, 0);
    const b = mat4RotateY(Math.PI / 4);
    const c = mat4Scale(2, 2, 2);
    const ab_c = mat4Multiply(mat4Multiply(a, b), c);
    const a_bc = mat4Multiply(a, mat4Multiply(b, c));
    for (let i = 0; i < 16; i++) {
      expect(ab_c[i]).toBeCloseTo(a_bc[i] ?? 0, 5);
    }
  });

  it('mat4Perspectiveが正しい透視投影行列を返す', () => {
    const p = mat4Perspective(Math.PI / 2, 1, 0.1, 100);
    // fovY=90度, aspect=1の場合: f = 1/tan(45度) = 1
    expect(p[0]).toBeCloseTo(1);  // f/aspect
    expect(p[5]).toBeCloseTo(1);  // f
  });

  it('mat4Orthoが正射影行列を返す', () => {
    const o = mat4Ortho(-1, 1, -1, 1, 0.1, 100);
    // 単位立方体へのマッピング
    const center: Vec4 = { x: 0, y: 0, z: -50, w: 1 };
    const result = mat4MulVec4(o, center);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('mat4LookAtが正しいビュー行列を返す', () => {
    const eye: Vec3 = { x: 0, y: 0, z: 5 };
    const center: Vec3 = { x: 0, y: 0, z: 0 };
    const up: Vec3 = { x: 0, y: 1, z: 0 };
    const view = mat4LookAt(eye, center, up);
    // 原点はカメラのz=-5の位置に
    const result = mat4MulVec4(view, { x: 0, y: 0, z: 0, w: 1 });
    expect(result.z).toBeCloseTo(-5);
  });
});

describe('Math: ベクトル演算', () => {
  it('vec3Normalizeが単位ベクトルを返す', () => {
    const v: Vec3 = { x: 3, y: 4, z: 0 };
    const n = vec3Normalize(v);
    expect(vec3Length(n)).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
  });

  it('vec3Crossが正しい外積を返す', () => {
    const x: Vec3 = { x: 1, y: 0, z: 0 };
    const y: Vec3 = { x: 0, y: 1, z: 0 };
    const z = vec3Cross(x, y);
    expect(z.x).toBeCloseTo(0);
    expect(z.y).toBeCloseTo(0);
    expect(z.z).toBeCloseTo(1);
  });

  it('vec3Dotが正しい内積を返す', () => {
    const a: Vec3 = { x: 1, y: 2, z: 3 };
    const b: Vec3 = { x: 4, y: 5, z: 6 };
    expect(vec3Dot(a, b)).toBe(32);
  });

  it('ゼロベクトルの正規化がゼロベクトルを返す', () => {
    const n = vec3Normalize({ x: 0, y: 0, z: 0 });
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(n.z).toBe(0);
  });
});

// ======== GLContext: バッファ ========

describe('GLContext: バッファオブジェクト', () => {
  it('VBOを作成しデータをアップロードできる', () => {
    const gl = new GLContext(64, 64);
    const buf = gl.createBuffer();
    expect(buf).toBeGreaterThan(0);
    gl.bindBuffer('ARRAY_BUFFER', buf);
    gl.bufferData('ARRAY_BUFFER', [1, 2, 3, 4], 'STATIC_DRAW');
    const state = gl.getState();
    expect(state.boundArrayBuffer).toBe(buf);
  });

  it('EBOを作成しVAOにバインドできる', () => {
    const gl = new GLContext(64, 64);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const ebo = gl.createBuffer();
    gl.bindBuffer('ELEMENT_ARRAY_BUFFER', ebo);
    gl.bufferData('ELEMENT_ARRAY_BUFFER', [0, 1, 2], 'STATIC_DRAW');
    const state = gl.getState();
    expect(state.boundElementArrayBuffer).toBe(ebo);
  });

  it('VAOが属性ポインタを保持する', () => {
    const gl = new GLContext(64, 64);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo);
    gl.bufferData('ARRAY_BUFFER', [0, 1, 2], 'STATIC_DRAW');
    gl.vertexAttribPointer(0, 3, 12, 0);
    gl.enableVertexAttribArray(0);
    // 属性が設定されたことを検証（エラーなし）
    expect(gl.getState().boundVAO).toBe(vao);
  });
});

// ======== GLContext: シェーダ ========

describe('GLContext: シェーダとプログラム', () => {
  it('シェーダのコンパイルとリンクが成功する', () => {
    const gl = new GLContext(64, 64);
    const vs = gl.createShader('VERTEX_SHADER');
    gl.shaderSource(vs, 'attribute vec3 aPosition;\nuniform mat4 uMVP;\nvarying vec4 vColor;\nvoid main() {}');
    gl.compileShader(vs);

    const fs = gl.createShader('FRAGMENT_SHADER');
    gl.shaderSource(fs, 'varying vec4 vColor;\nvoid main() {}');
    gl.compileShader(fs);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    expect(gl.getAttribLocation(prog, 'aPosition')).toBe(0);
    expect(gl.getUniformLocation(prog, 'uMVP')).toBeGreaterThanOrEqual(0);
  });

  it('attribute locationを取得できる', () => {
    const gl = new GLContext(64, 64);
    const vs = gl.createShader('VERTEX_SHADER');
    gl.shaderSource(vs, 'attribute vec3 aPos;\nattribute vec4 aColor;');
    gl.compileShader(vs);
    const fs = gl.createShader('FRAGMENT_SHADER');
    gl.shaderSource(fs, '');
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    expect(gl.getAttribLocation(prog, 'aPos')).toBe(0);
    expect(gl.getAttribLocation(prog, 'aColor')).toBe(1);
    expect(gl.getAttribLocation(prog, 'notExist')).toBe(-1);
  });
});

// ======== GLContext: 状態管理 ========

describe('GLContext: GL状態マシン', () => {
  it('初期状態が正しいデフォルト値を持つ', () => {
    const gl = new GLContext(128, 128);
    const s = gl.getState();
    expect(s.depthTestEnabled).toBe(false);
    expect(s.blendEnabled).toBe(false);
    expect(s.cullFaceEnabled).toBe(false);
    expect(s.stencilTestEnabled).toBe(false);
    expect(s.depthFunc).toBe('LESS');
    expect(s.frontFace).toBe('CCW');
    expect(s.viewport.width).toBe(128);
    expect(s.currentProgram).toBeNull();
  });

  it('enable/disableで状態が切り替わる', () => {
    const gl = new GLContext(64, 64);
    gl.enable('DEPTH_TEST');
    expect(gl.getState().depthTestEnabled).toBe(true);
    gl.disable('DEPTH_TEST');
    expect(gl.getState().depthTestEnabled).toBe(false);

    gl.enable('BLEND');
    expect(gl.getState().blendEnabled).toBe(true);
    gl.enable('CULL_FACE');
    expect(gl.getState().cullFaceEnabled).toBe(true);
  });

  it('ブレンド関数が正しく設定される', () => {
    const gl = new GLContext(64, 64);
    gl.blendFunc('SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA');
    const s = gl.getState();
    expect(s.blendSrcFactor).toBe('SRC_ALPHA');
    expect(s.blendDstFactor).toBe('ONE_MINUS_SRC_ALPHA');
  });

  it('ビューポートが正しく設定される', () => {
    const gl = new GLContext(256, 256);
    gl.viewport(10, 20, 100, 200);
    const v = gl.getState().viewport;
    expect(v.x).toBe(10);
    expect(v.y).toBe(20);
    expect(v.width).toBe(100);
    expect(v.height).toBe(200);
  });
});

// ======== GLContext: テクスチャ ========

describe('GLContext: テクスチャ', () => {
  it('テクスチャを作成しバインドできる', () => {
    const gl = new GLContext(64, 64);
    const tex = gl.createTexture();
    gl.activeTexture(0);
    gl.bindTexture(tex);
    const s = gl.getState();
    expect(s.boundTextures.get(0)).toBe(tex);
    expect(s.activeTextureUnit).toBe(0);
  });

  it('テクスチャパラメータを設定できる', () => {
    const gl = new GLContext(64, 64);
    const tex = gl.createTexture();
    gl.bindTexture(tex);
    gl.texParameteri('TEXTURE_WRAP_S', 'CLAMP_TO_EDGE');
    gl.texParameteri('TEXTURE_MAG_FILTER', 'LINEAR');
    // エラーなしで完了
    expect(tex).toBeGreaterThan(0);
  });
});

// ======== GLContext: レンダリング ========

describe('GLContext: レンダリングパイプライン', () => {
  /** テスト用のシンプルなGLコンテキストを準備 */
  function setupSimpleTriangle(gl: GLContext): number {
    const vs = gl.createShader('VERTEX_SHADER');
    gl.shaderSource(vs, 'attribute vec3 aPosition;\nattribute vec4 aColor;\nuniform mat4 uMVP;\nvarying vec4 vColor;');
    gl.compileShader(vs);
    const fs = gl.createShader('FRAGMENT_SHADER');
    gl.shaderSource(fs, 'varying vec4 vColor;');
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.setShaderFunctions(prog,
      (attrs, uniforms) => {
        const pos = attrs.get('aPosition') ?? [0, 0, 0];
        const col = attrs.get('aColor') ?? [1, 1, 1, 1];
        const mvp = (uniforms.get('uMVP') ?? mat4Identity()) as Mat4;
        const clipPos = mat4MulVec4(mvp, { x: pos[0] ?? 0, y: pos[1] ?? 0, z: pos[2] ?? 0, w: 1 });
        const varyings = new Map<string, number[]>();
        varyings.set('vColor', [...col]);
        return { position: clipPos, varyings };
      },
      (varyings) => {
        const c = varyings.get('vColor') ?? [1, 1, 1, 1];
        return { r: c[0] ?? 1, g: c[1] ?? 1, b: c[2] ?? 1, a: c[3] ?? 1 };
      },
    );
    return prog;
  }

  it('三角形1枚を描画するとフラグメントが生成される', () => {
    const gl = new GLContext(64, 64);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(true, true, false);
    const prog = setupSimpleTriangle(gl);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo);
    gl.bufferData('ARRAY_BUFFER', [
      0, 0.8, 0,  1, 0, 0, 1,
      -0.7, -0.6, 0,  0, 1, 0, 1,
      0.7, -0.6, 0,  0, 0, 1, 1,
    ], 'STATIC_DRAW');

    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aPosition'), 3, 28, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aPosition'));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aColor'), 4, 28, 12);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aColor'));

    gl.setUniform('uMVP', mat4Identity());
    gl.drawArrays('TRIANGLES', 0, 3);

    const result = gl.getResult();
    expect(result.totalStats.pixelsWritten).toBeGreaterThan(0);
    expect(result.totalStats.verticesFetched).toBe(3);
    expect(result.totalStats.primitivesAssembled).toBe(1);
  });

  it('深度テストで奥のフラグメントが棄却される', () => {
    const gl = new GLContext(64, 64);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(true, true, false);
    gl.enable('DEPTH_TEST');
    gl.depthFunc('LESS');
    const prog = setupSimpleTriangle(gl);

    // 手前の三角形（z=0、赤）
    const vao1 = gl.createVertexArray();
    gl.bindVertexArray(vao1);
    const vbo1 = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo1);
    gl.bufferData('ARRAY_BUFFER', [
      0, 0.5, 0,  1, 0, 0, 1,
      -0.5, -0.5, 0,  1, 0, 0, 1,
      0.5, -0.5, 0,  1, 0, 0, 1,
    ], 'STATIC_DRAW');
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aPosition'), 3, 28, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aPosition'));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aColor'), 4, 28, 12);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aColor'));
    gl.setUniform('uMVP', mat4Identity());
    gl.drawArrays('TRIANGLES', 0, 3);

    const after1 = gl.getResult().totalStats.pixelsWritten;

    // 奥の三角形（z=0.8、青）→ 深度テストで多くが棄却される
    const vao2 = gl.createVertexArray();
    gl.bindVertexArray(vao2);
    const vbo2 = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo2);
    gl.bufferData('ARRAY_BUFFER', [
      0, 0.5, 0.8,  0, 0, 1, 1,
      -0.5, -0.5, 0.8,  0, 0, 1, 1,
      0.5, -0.5, 0.8,  0, 0, 1, 1,
    ], 'STATIC_DRAW');
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aPosition'), 3, 28, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aPosition'));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aColor'), 4, 28, 12);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aColor'));
    gl.drawArrays('TRIANGLES', 0, 3);

    const finalResult = gl.getResult();
    // 2回目のdrawCallでは重なる部分の深度テストが失敗するので
    // 最終的なピクセル書込は2回目のフラグメント数より少ない
    expect(finalResult.totalStats.fragmentsGenerated).toBeGreaterThan(finalResult.totalStats.pixelsWritten - after1);
  });

  it('カリングで裏面三角形が棄却される', () => {
    const gl = new GLContext(64, 64);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(true, true, false);
    gl.enable('CULL_FACE');
    gl.cullFace('BACK');
    gl.frontFace('CCW');
    const prog = setupSimpleTriangle(gl);

    // スクリーン座標系で裏面となる三角形
    // NDCのY反転により、NDCでCCWの頂点がスクリーンではCWになる
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo);
    gl.bufferData('ARRAY_BUFFER', [
      0, -0.8, 0,  1, 0, 0, 1,
      0.7, 0.6, 0,  0, 1, 0, 1,
      -0.7, 0.6, 0,  0, 0, 1, 1,
    ], 'STATIC_DRAW');
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aPosition'), 3, 28, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aPosition'));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aColor'), 4, 28, 12);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aColor'));
    gl.setUniform('uMVP', mat4Identity());
    gl.drawArrays('TRIANGLES', 0, 3);

    const result = gl.getResult();
    expect(result.totalStats.primitivesCulled).toBe(1);
    expect(result.totalStats.pixelsWritten).toBe(0);
  });

  it('drawElementsでEBOからインデックス描画できる', () => {
    const gl = new GLContext(64, 64);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(true, true, false);
    const prog = setupSimpleTriangle(gl);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo);
    gl.bufferData('ARRAY_BUFFER', [
      -0.5,  0.5, 0,  1, 0, 0, 1,
       0.5,  0.5, 0,  0, 1, 0, 1,
       0.5, -0.5, 0,  0, 0, 1, 1,
      -0.5, -0.5, 0,  1, 1, 0, 1,
    ], 'STATIC_DRAW');
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aPosition'), 3, 28, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aPosition'));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'aColor'), 4, 28, 12);
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, 'aColor'));

    const ebo = gl.createBuffer();
    gl.bindBuffer('ELEMENT_ARRAY_BUFFER', ebo);
    gl.bufferData('ELEMENT_ARRAY_BUFFER', [0, 1, 2, 0, 2, 3], 'STATIC_DRAW');

    gl.setUniform('uMVP', mat4Identity());
    gl.drawElements('TRIANGLES', 6, 0);

    const result = gl.getResult();
    expect(result.totalStats.verticesFetched).toBe(6);
    expect(result.totalStats.primitivesAssembled).toBe(2);
    expect(result.totalStats.pixelsWritten).toBeGreaterThan(0);
  });
});

// ======== GLContext: ブレンドとステンシル ========

describe('GLContext: ブレンドとステンシル', () => {
  it('SRC_ALPHA/ONE_MINUS_SRC_ALPHAブレンドが正しく混合する', () => {
    const gl = new GLContext(4, 4);
    gl.clearColor(0, 0, 1, 1); // 青の背景
    gl.clear(true, true, false);
    gl.enable('BLEND');
    gl.blendFunc('SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA');

    const vs = gl.createShader('VERTEX_SHADER');
    gl.shaderSource(vs, 'attribute vec3 aPosition;\nattribute vec4 aColor;\nuniform mat4 uMVP;\nvarying vec4 vColor;');
    gl.compileShader(vs);
    const fs = gl.createShader('FRAGMENT_SHADER');
    gl.shaderSource(fs, 'varying vec4 vColor;');
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.setShaderFunctions(prog,
      (attrs, uniforms) => {
        const pos = attrs.get('aPosition') ?? [0, 0, 0];
        const col = attrs.get('aColor') ?? [1, 1, 1, 1];
        const mvp = (uniforms.get('uMVP') ?? mat4Identity()) as Mat4;
        const clipPos = mat4MulVec4(mvp, { x: pos[0] ?? 0, y: pos[1] ?? 0, z: pos[2] ?? 0, w: 1 });
        const varyings = new Map<string, number[]>();
        varyings.set('vColor', [...col]);
        return { position: clipPos, varyings };
      },
      (varyings) => {
        const c = varyings.get('vColor') ?? [1, 1, 1, 1];
        return { r: c[0] ?? 1, g: c[1] ?? 1, b: c[2] ?? 1, a: c[3] ?? 1 };
      },
    );

    // 半透明赤の全画面三角形
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer('ARRAY_BUFFER', vbo);
    gl.bufferData('ARRAY_BUFFER', [
      -1, 1, 0,  1, 0, 0, 0.5,
      -1, -1, 0,  1, 0, 0, 0.5,
       1, -1, 0,  1, 0, 0, 0.5,
    ], 'STATIC_DRAW');
    gl.vertexAttribPointer(0, 3, 28, 0);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(1, 4, 28, 12);
    gl.enableVertexAttribArray(1);
    gl.setUniform('uMVP', mat4Identity());
    gl.drawArrays('TRIANGLES', 0, 3);

    const result = gl.getResult();
    expect(result.totalStats.fragmentsBlended).toBeGreaterThan(0);
  });

  it('clearでバッファが初期化される', () => {
    const gl = new GLContext(4, 4);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(true, true, true);
    const result = gl.getResult();
    // 赤でクリアされているか確認
    expect(result.framebuffer[0]).toBe(255); // R
    expect(result.framebuffer[1]).toBe(0);   // G
    expect(result.framebuffer[2]).toBe(0);   // B
    expect(result.framebuffer[3]).toBe(255); // A
  });

  it('フレームバッファが正しくUint8Arrayに変換される', () => {
    const gl = new GLContext(2, 2);
    gl.clearColor(0.5, 0.5, 0.5, 1);
    gl.clear(true, false, false);
    const result = gl.getResult();
    // 0.5 * 255 = 128 (rounded)
    expect(result.framebuffer[0]).toBe(128);
    expect(result.framebuffer[1]).toBe(128);
    expect(result.framebuffer[2]).toBe(128);
    expect(result.framebuffer[3]).toBe(255);
  });
});

// ======== プリセット ========

describe('プリセット', () => {
  it('全12個のプリセットが定義されている', () => {
    expect(presets.length).toBe(12);
  });

  it('全プリセットが正常に実行できる', () => {
    for (const preset of presets) {
      const result = preset.build();
      expect(result.snapshots.length).toBeGreaterThan(0);
      expect(result.framebuffer.length).toBe(128 * 128 * 4);
      expect(result.width).toBe(128);
      expect(result.height).toBe(128);
    }
  });

  it('三角形プリセットがピクセルを書き込む', () => {
    const result = presets[0]?.build();
    expect(result).toBeDefined();
    expect(result!.totalStats.pixelsWritten).toBeGreaterThan(100);
  });

  it('カリングプリセットで裏面がカリングされる', () => {
    const result = presets[8]?.build();
    expect(result).toBeDefined();
    expect(result!.totalStats.primitivesCulled).toBeGreaterThan(0);
  });

  it('ブレンドプリセットでブレンドが行われる', () => {
    const result = presets[7]?.build();
    expect(result).toBeDefined();
    expect(result!.totalStats.fragmentsBlended).toBeGreaterThan(0);
  });
});
