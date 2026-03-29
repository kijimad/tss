/**
 * 簡易シェーダ言語シミュレーション
 * 頂点シェーダ（位置変換、MVP行列）、フラグメントシェーダ（色、テクスチャサンプリング模倣）
 */

import type { Color, Fragment, TransformedVertex, Vec3, Vec4, Vertex } from './pipeline';

/** 4x4行列（列優先、OpenGL形式） */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/** 単位行列を生成 */
export function mat4Identity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** 平行移動行列を生成 */
export function mat4Translate(tx: number, ty: number, tz: number): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    tx, ty, tz, 1,
  ];
}

/** スケーリング行列を生成 */
export function mat4Scale(sx: number, sy: number, sz: number): Mat4 {
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1,
  ];
}

/** Y軸回転行列を生成 */
export function mat4RotateY(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

/** 透視投影行列を生成 */
export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

/** 行列×行列の乗算 */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const result: number[] = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[row + k * 4] ?? 0) * (b[k + col * 4] ?? 0);
      }
      result[row + col * 4] = sum;
    }
  }
  return result as unknown as Mat4;
}

/** 行列×Vec4の乗算 */
export function mat4MultiplyVec4(m: Mat4, v: Vec4): Vec4 {
  return {
    x: (m[0] ?? 0) * v.x + (m[4] ?? 0) * v.y + (m[8] ?? 0) * v.z + (m[12] ?? 0) * v.w,
    y: (m[1] ?? 0) * v.x + (m[5] ?? 0) * v.y + (m[9] ?? 0) * v.z + (m[13] ?? 0) * v.w,
    z: (m[2] ?? 0) * v.x + (m[6] ?? 0) * v.y + (m[10] ?? 0) * v.z + (m[14] ?? 0) * v.w,
    w: (m[3] ?? 0) * v.x + (m[7] ?? 0) * v.y + (m[11] ?? 0) * v.z + (m[15] ?? 0) * v.w,
  };
}

/** 簡易テクスチャ（チェッカーパターン） */
export interface SimpleTexture {
  /** テクスチャ幅 */
  width: number;
  /** テクスチャ高さ */
  height: number;
  /** ピクセルデータ（RGBA） */
  data: Float32Array;
}

/** チェッカーパターンテクスチャを生成 */
export function createCheckerTexture(
  width: number,
  height: number,
  color1: Color = { r: 1, g: 1, b: 1, a: 1 },
  color2: Color = { r: 0.2, g: 0.2, b: 0.2, a: 1 },
  gridSize = 4
): SimpleTexture {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isChecker = ((Math.floor(x / gridSize) + Math.floor(y / gridSize)) % 2) === 0;
      const color = isChecker ? color1 : color2;
      const idx = (y * width + x) * 4;
      data[idx] = color.r;
      data[idx + 1] = color.g;
      data[idx + 2] = color.b;
      data[idx + 3] = color.a;
    }
  }
  return { width, height, data };
}

/** テクスチャサンプリング（ニアレストネイバー） */
export function sampleTexture(texture: SimpleTexture, u: number, v: number): Color {
  // UV座標を[0,1]にラップ
  const wu = ((u % 1) + 1) % 1;
  const wv = ((v % 1) + 1) % 1;
  const x = Math.min(Math.floor(wu * texture.width), texture.width - 1);
  const y = Math.min(Math.floor(wv * texture.height), texture.height - 1);
  const idx = (y * texture.width + x) * 4;
  return {
    r: texture.data[idx] ?? 0,
    g: texture.data[idx + 1] ?? 0,
    b: texture.data[idx + 2] ?? 0,
    a: texture.data[idx + 3] ?? 0,
  };
}

/** 頂点シェーダを作成: MVP行列でposition変換、スクリーン座標に射影 */
export function createVertexShader(
  mvp: Mat4,
  viewportWidth: number,
  viewportHeight: number
): (vertex: Vertex) => TransformedVertex {
  return (vertex: Vertex): TransformedVertex => {
    const pos: Vec4 = { x: vertex.position.x, y: vertex.position.y, z: vertex.position.z, w: 1 };
    const clip = mat4MultiplyVec4(mvp, pos);

    // 透視除算
    const w = clip.w === 0 ? 1 : clip.w;
    const ndc = { x: clip.x / w, y: clip.y / w, z: clip.z / w };

    // NDC→スクリーン座標変換
    const screenX = (ndc.x + 1) * 0.5 * viewportWidth;
    const screenY = (1 - ndc.y) * 0.5 * viewportHeight;
    const depth = (ndc.z + 1) * 0.5; // 0〜1に正規化

    return {
      clipPosition: clip,
      screenX,
      screenY,
      depth,
      color: vertex.color,
      uv: vertex.uv,
      normal: vertex.normal,
    };
  };
}

/** フラグメントシェーダを作成: テクスチャサンプリング＋簡易ライティング */
export function createFragmentShader(
  texture: SimpleTexture | null,
  lightDir: Vec3 = { x: 0, y: 0, z: 1 },
  ambient = 0.3
): (fragment: Fragment) => Color {
  return (fragment: Fragment): Color => {
    // テクスチャ色（テクスチャがなければ頂点色を使用）
    let baseColor: Color;
    if (texture) {
      baseColor = sampleTexture(texture, fragment.uv.u, fragment.uv.v);
    } else {
      baseColor = fragment.color;
    }

    // 簡易ディフューズライティング
    const nLen = Math.sqrt(
      fragment.normal.x ** 2 + fragment.normal.y ** 2 + fragment.normal.z ** 2
    );
    const n: Vec3 = nLen > 0
      ? { x: fragment.normal.x / nLen, y: fragment.normal.y / nLen, z: fragment.normal.z / nLen }
      : { x: 0, y: 0, z: 1 };

    const dot = Math.max(0, n.x * lightDir.x + n.y * lightDir.y + n.z * lightDir.z);
    const intensity = Math.min(1, ambient + dot * (1 - ambient));

    return {
      r: baseColor.r * intensity,
      g: baseColor.g * intensity,
      b: baseColor.b * intensity,
      a: baseColor.a,
    };
  };
}
