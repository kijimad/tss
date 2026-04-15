/**
 * GeoM — 2Dアフィン変換行列
 *
 * Ebitenの GeoM 構造体をTypeScriptで再現する。
 * 3x2行列として [a, b, c, d, tx, ty] を保持。
 *
 * | a  b  tx |
 * | c  d  ty |
 * | 0  0  1  |
 *
 * 変換の適用順序はEbitenと同じ: translate→rotate は
 * 「先に平行移動、次に回転」を意味する。
 */

import type { GeoMData } from "./types.js";

export class GeoM {
  /** [a, b, c, d, tx, ty] */
  private e: [number, number, number, number, number, number];

  constructor() {
    // 単位行列で初期化
    this.e = [1, 0, 0, 1, 0, 0];
  }

  /** 単位行列にリセット */
  reset(): void {
    this.e = [1, 0, 0, 1, 0, 0];
  }

  /** 平行移動を追加 */
  translate(tx: number, ty: number): void {
    // 新行列 = 現在の行列 × 平行移動行列
    this.e[4] += this.e[0] * tx + this.e[2] * ty;
    this.e[5] += this.e[1] * tx + this.e[3] * ty;
  }

  /** スケーリングを追加 */
  scale(sx: number, sy: number): void {
    this.e[0] *= sx;
    this.e[1] *= sx;
    this.e[2] *= sy;
    this.e[3] *= sy;
  }

  /** 回転を追加（ラジアン） */
  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const a = this.e[0];
    const b = this.e[1];
    const c = this.e[2];
    const d = this.e[3];
    this.e[0] = a * cos + c * sin;
    this.e[1] = b * cos + d * sin;
    this.e[2] = -a * sin + c * cos;
    this.e[3] = -b * sin + d * cos;
  }

  /** 別のGeoMを右から連結: this = this × other */
  concat(other: GeoM): void {
    const [a1, b1, c1, d1, tx1, ty1] = this.e;
    const [a2, b2, c2, d2, tx2, ty2] = other.e;
    this.e[0] = a1 * a2 + c1 * b2;
    this.e[1] = b1 * a2 + d1 * b2;
    this.e[2] = a1 * c2 + c1 * d2;
    this.e[3] = b1 * c2 + d1 * d2;
    this.e[4] = a1 * tx2 + c1 * ty2 + tx1;
    this.e[5] = b1 * tx2 + d1 * ty2 + ty1;
  }

  /** 逆行列を計算。行列式が0の場合はnullを返す */
  invert(): GeoM | null {
    const [a, b, c, d, tx, ty] = this.e;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-15) return null;
    const invDet = 1 / det;
    const result = new GeoM();
    result.e[0] = d * invDet;
    result.e[1] = -b * invDet;
    result.e[2] = -c * invDet;
    result.e[3] = a * invDet;
    result.e[4] = (c * ty - d * tx) * invDet;
    result.e[5] = (b * tx - a * ty) * invDet;
    return result;
  }

  /** 点 (x, y) を変換 */
  apply(x: number, y: number): { x: number; y: number } {
    return {
      x: this.e[0] * x + this.e[2] * y + this.e[4],
      y: this.e[1] * x + this.e[3] * y + this.e[5],
    };
  }

  /** GeoMDataとしてエクスポート */
  toData(): GeoMData {
    return { elements: [...this.e] };
  }

  /** GeoMDataからインポート */
  static fromData(data: GeoMData): GeoM {
    const g = new GeoM();
    g.e = [...data.elements];
    return g;
  }

  /** 現在の行列要素を取得（デバッグ用） */
  getElements(): readonly [number, number, number, number, number, number] {
    return this.e;
  }
}
