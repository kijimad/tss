/**
 * レンダリングパイプラインシミュレーション
 * 頂点シェーダ（座標変換）→ プリミティブアセンブリ（三角形）→
 * ラスタライゼーション（スキャンライン）→ フラグメントシェーダ（色計算）→
 * フレームバッファ出力
 */

/** 3Dベクトル */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 4Dベクトル（同次座標） */
export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 色（RGBA、各0〜1） */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 頂点データ */
export interface Vertex {
  /** 位置座標 */
  position: Vec3;
  /** 法線ベクトル */
  normal: Vec3;
  /** 色 */
  color: Color;
  /** テクスチャ座標 */
  uv: { u: number; v: number };
}

/** 変換後の頂点 */
export interface TransformedVertex {
  /** クリップ空間座標 */
  clipPosition: Vec4;
  /** スクリーン座標（x, y） */
  screenX: number;
  screenY: number;
  /** 深度値 */
  depth: number;
  /** 補間用の元データ */
  color: Color;
  uv: { u: number; v: number };
  normal: Vec3;
}

/** 三角形プリミティブ */
export interface Triangle {
  v0: TransformedVertex;
  v1: TransformedVertex;
  v2: TransformedVertex;
}

/** フラグメント（ピクセル候補） */
export interface Fragment {
  /** スクリーン座標 */
  x: number;
  y: number;
  /** 深度値 */
  depth: number;
  /** 補間された色 */
  color: Color;
  /** 補間されたUV */
  uv: { u: number; v: number };
  /** 補間された法線 */
  normal: Vec3;
}

/** フレームバッファ */
export class Framebuffer {
  /** 幅 */
  readonly width: number;
  /** 高さ */
  readonly height: number;
  /** カラーバッファ（RGBA、各ピクセル4値） */
  readonly colorBuffer: Float32Array;
  /** 深度バッファ */
  readonly depthBuffer: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.colorBuffer = new Float32Array(width * height * 4);
    this.depthBuffer = new Float32Array(width * height).fill(1.0);
  }

  /** ピクセルを書き込み（深度テスト付き） */
  writePixel(x: number, y: number, depth: number, color: Color): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    const idx = y * this.width + x;
    const currentDepth = this.depthBuffer[idx];
    if (currentDepth === undefined || depth > currentDepth) return false;

    this.depthBuffer[idx] = depth;
    const colorIdx = idx * 4;
    this.colorBuffer[colorIdx] = color.r;
    this.colorBuffer[colorIdx + 1] = color.g;
    this.colorBuffer[colorIdx + 2] = color.b;
    this.colorBuffer[colorIdx + 3] = color.a;
    return true;
  }

  /** ピクセルの色を読み出し */
  readPixel(x: number, y: number): Color | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const idx = (y * this.width + x) * 4;
    return {
      r: this.colorBuffer[idx] ?? 0,
      g: this.colorBuffer[idx + 1] ?? 0,
      b: this.colorBuffer[idx + 2] ?? 0,
      a: this.colorBuffer[idx + 3] ?? 0,
    };
  }

  /** フレームバッファをクリア */
  clear(color: Color = { r: 0, g: 0, b: 0, a: 1 }): void {
    for (let i = 0; i < this.width * this.height; i++) {
      this.colorBuffer[i * 4] = color.r;
      this.colorBuffer[i * 4 + 1] = color.g;
      this.colorBuffer[i * 4 + 2] = color.b;
      this.colorBuffer[i * 4 + 3] = color.a;
      this.depthBuffer[i] = 1.0;
    }
  }

  /** Uint8Arrayに変換（Canvas描画用） */
  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < this.colorBuffer.length; i++) {
      result[i] = Math.round(Math.min(1, Math.max(0, this.colorBuffer[i] ?? 0)) * 255);
    }
    return result;
  }
}

/** プリミティブアセンブリ: 頂点リストを三角形に組み立て */
export function assembleTriangles(vertices: TransformedVertex[]): Triangle[] {
  const triangles: Triangle[] = [];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const v0 = vertices[i];
    const v1 = vertices[i + 1];
    const v2 = vertices[i + 2];
    if (v0 && v1 && v2) {
      triangles.push({ v0, v1, v2 });
    }
  }
  return triangles;
}

/** 重心座標を計算 */
function barycentricCoords(
  px: number, py: number,
  v0: TransformedVertex, v1: TransformedVertex, v2: TransformedVertex
): { u: number; v: number; w: number } | null {
  const d00 = (v1.screenX - v0.screenX) * (v1.screenX - v0.screenX) +
    (v1.screenY - v0.screenY) * (v1.screenY - v0.screenY);
  const d01 = (v1.screenX - v0.screenX) * (v2.screenX - v0.screenX) +
    (v1.screenY - v0.screenY) * (v2.screenY - v0.screenY);
  const d11 = (v2.screenX - v0.screenX) * (v2.screenX - v0.screenX) +
    (v2.screenY - v0.screenY) * (v2.screenY - v0.screenY);
  const d20 = (px - v0.screenX) * (v1.screenX - v0.screenX) +
    (py - v0.screenY) * (v1.screenY - v0.screenY);
  const d21 = (px - v0.screenX) * (v2.screenX - v0.screenX) +
    (py - v0.screenY) * (v2.screenY - v0.screenY);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-10) return null;

  const bv = (d11 * d20 - d01 * d21) / denom;
  const bw = (d00 * d21 - d01 * d20) / denom;
  const bu = 1.0 - bv - bw;

  return { u: bu, v: bv, w: bw };
}

/** 色を補間 */
function interpolateColor(c0: Color, c1: Color, c2: Color, u: number, v: number, w: number): Color {
  return {
    r: c0.r * u + c1.r * v + c2.r * w,
    g: c0.g * u + c1.g * v + c2.g * w,
    b: c0.b * u + c1.b * v + c2.b * w,
    a: c0.a * u + c1.a * v + c2.a * w,
  };
}

/** ラスタライゼーション: 三角形をフラグメントに変換（スキャンライン法） */
export function rasterizeTriangle(triangle: Triangle, fbWidth: number, fbHeight: number): Fragment[] {
  const fragments: Fragment[] = [];
  const { v0, v1, v2 } = triangle;

  // バウンディングボックスを計算
  const minX = Math.max(0, Math.floor(Math.min(v0.screenX, v1.screenX, v2.screenX)));
  const maxX = Math.min(fbWidth - 1, Math.ceil(Math.max(v0.screenX, v1.screenX, v2.screenX)));
  const minY = Math.max(0, Math.floor(Math.min(v0.screenY, v1.screenY, v2.screenY)));
  const maxY = Math.min(fbHeight - 1, Math.ceil(Math.max(v0.screenY, v1.screenY, v2.screenY)));

  // スキャンライン走査
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const bary = barycentricCoords(x + 0.5, y + 0.5, v0, v1, v2);
      if (!bary) continue;

      // 重心座標が全て正なら三角形内部
      if (bary.u >= 0 && bary.v >= 0 && bary.w >= 0) {
        const depth = v0.depth * bary.u + v1.depth * bary.v + v2.depth * bary.w;
        const color = interpolateColor(v0.color, v1.color, v2.color, bary.u, bary.v, bary.w);
        const uv = {
          u: v0.uv.u * bary.u + v1.uv.u * bary.v + v2.uv.u * bary.w,
          v: v0.uv.v * bary.u + v1.uv.v * bary.v + v2.uv.v * bary.w,
        };
        const normal: Vec3 = {
          x: v0.normal.x * bary.u + v1.normal.x * bary.v + v2.normal.x * bary.w,
          y: v0.normal.y * bary.u + v1.normal.y * bary.v + v2.normal.y * bary.w,
          z: v0.normal.z * bary.u + v1.normal.z * bary.v + v2.normal.z * bary.w,
        };

        fragments.push({ x, y, depth, color, uv, normal });
      }
    }
  }

  return fragments;
}

/** レンダリングパイプラインの実行統計 */
export interface PipelineStats {
  /** 入力頂点数 */
  inputVertices: number;
  /** 変換後頂点数 */
  transformedVertices: number;
  /** 三角形数 */
  triangles: number;
  /** 生成フラグメント数 */
  fragments: number;
  /** 書き込みピクセル数（深度テスト通過） */
  writtenPixels: number;
}

/** レンダリングパイプライン全体を実行 */
export function executeRenderPipeline(
  vertices: Vertex[],
  framebuffer: Framebuffer,
  vertexShader: (v: Vertex) => TransformedVertex,
  fragmentShader: (f: Fragment) => Color
): PipelineStats {
  // ステージ1: 頂点シェーダ
  const transformed = vertices.map(vertexShader);

  // ステージ2: プリミティブアセンブリ
  const triangles = assembleTriangles(transformed);

  // ステージ3 & 4: ラスタライゼーション & フラグメントシェーダ
  let totalFragments = 0;
  let writtenPixels = 0;

  for (const tri of triangles) {
    const fragments = rasterizeTriangle(tri, framebuffer.width, framebuffer.height);
    totalFragments += fragments.length;

    for (const frag of fragments) {
      const color = fragmentShader(frag);
      if (framebuffer.writePixel(frag.x, frag.y, frag.depth, color)) {
        writtenPixels++;
      }
    }
  }

  return {
    inputVertices: vertices.length,
    transformedVertices: transformed.length,
    triangles: triangles.length,
    fragments: totalFragments,
    writtenPixels,
  };
}
