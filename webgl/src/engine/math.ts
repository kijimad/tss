/**
 * 線形代数ユーティリティ
 *
 * WebGLで使用する行列・ベクトル演算を提供する:
 * - 4x4行列: 単位行列、平行移動、回転、スケーリング、射影
 * - ベクトル: 正規化、内積、外積、加減算
 */

import type { Mat4, Vec3, Vec4 } from './types';

// ======== 行列生成 ========

/** 単位行列 */
export function mat4Identity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** 平行移動行列 */
export function mat4Translate(tx: number, ty: number, tz: number): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    tx, ty, tz, 1,
  ];
}

/** スケーリング行列 */
export function mat4Scale(sx: number, sy: number, sz: number): Mat4 {
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1,
  ];
}

/** X軸回転行列 */
export function mat4RotateX(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
}

/** Y軸回転行列 */
export function mat4RotateY(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

/** Z軸回転行列 */
export function mat4RotateZ(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** 透視投影行列 */
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

/** 正射影行列 */
export function mat4Ortho(
  left: number, right: number, bottom: number, top: number, near: number, far: number,
): Mat4 {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return [
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
  ];
}

/** LookAt行列（ビュー行列） */
export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = vec3Normalize(vec3Sub(center, eye));
  const s = vec3Normalize(vec3Cross(f, up));
  const u = vec3Cross(s, f);
  return [
    s.x, u.x, -f.x, 0,
    s.y, u.y, -f.y, 0,
    s.z, u.z, -f.z, 0,
    -vec3Dot(s, eye), -vec3Dot(u, eye), vec3Dot(f, eye), 1,
  ];
}

// ======== 行列演算 ========

/** 行列×行列 */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[row + k * 4] ?? 0) * (b[k + col * 4] ?? 0);
      }
      r[row + col * 4] = sum;
    }
  }
  return r as unknown as Mat4;
}

/** 行列×Vec4 */
export function mat4MulVec4(m: Mat4, v: Vec4): Vec4 {
  return {
    x: (m[0] ?? 0) * v.x + (m[4] ?? 0) * v.y + (m[8] ?? 0) * v.z + (m[12] ?? 0) * v.w,
    y: (m[1] ?? 0) * v.x + (m[5] ?? 0) * v.y + (m[9] ?? 0) * v.z + (m[13] ?? 0) * v.w,
    z: (m[2] ?? 0) * v.x + (m[6] ?? 0) * v.y + (m[10] ?? 0) * v.z + (m[14] ?? 0) * v.w,
    w: (m[3] ?? 0) * v.x + (m[7] ?? 0) * v.y + (m[11] ?? 0) * v.z + (m[15] ?? 0) * v.w,
  };
}

// ======== ベクトル演算 ========

/** ベクトル加算 */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** ベクトル減算 */
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** 内積 */
export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** 外積 */
export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** ベクトル長 */
export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** 正規化 */
export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** クランプ */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** 線形補間 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
