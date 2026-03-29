/**
 * ハードウェアシミュレーション
 * フレームバッファ、キーボード、マウスの物理層
 */

// ========== RGBA色 ==========
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function rgba(r: number, g: number, b: number, a: number = 255): Color {
  return { r, g, b, a };
}

export function colorToCSS(c: Color): string {
  return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
}

// ========== フレームバッファ ==========
export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly depth: number; // ビット深度
  /** ピクセルデータ (RGBA) */
  readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number, depth: number = 24) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  /** 単一ピクセルを設定 */
  setPixel(x: number, y: number, color: Color): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = color.r;
    this.pixels[i + 1] = color.g;
    this.pixels[i + 2] = color.b;
    this.pixels[i + 3] = color.a;
  }

  /** 矩形を塗りつぶす */
  fillRect(x: number, y: number, w: number, h: number, color: Color): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.width + px) * 4;
        this.pixels[i] = color.r;
        this.pixels[i + 1] = color.g;
        this.pixels[i + 2] = color.b;
        this.pixels[i + 3] = color.a;
      }
    }
  }

  /** 全画面をクリア */
  clear(color: Color): void {
    this.fillRect(0, 0, this.width, this.height, color);
  }

  /** ImageData に変換 (Canvas描画用) */
  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.pixels), this.width, this.height);
  }
}

// ========== マウスボタン ==========
export enum MouseButton {
  None = 0,
  Left = 1,
  Middle = 2,
  Right = 3,
  ScrollUp = 4,
  ScrollDown = 5,
}

// ========== マウス状態 ==========
export interface MouseState {
  x: number;
  y: number;
  buttons: Set<MouseButton>;
}

// ========== キーコード (X11互換のサブセット) ==========
export enum KeySym {
  Escape = 0xff1b,
  Return = 0xff0d,
  BackSpace = 0xff08,
  Tab = 0xff09,
  Space = 0x0020,
  Delete = 0xffff,
  Left = 0xff51,
  Up = 0xff52,
  Right = 0xff53,
  Down = 0xff54,
  Shift_L = 0xffe1,
  Control_L = 0xffe3,
  Alt_L = 0xffe9,
  Super_L = 0xffeb,
  // ASCII文字 (0x20-0x7e はそのまま)
  a = 0x61, b = 0x62, c = 0x63, d = 0x64, e = 0x65,
  f = 0x66, g = 0x67, h = 0x68, i = 0x69, j = 0x6a,
  k = 0x6b, l = 0x6c, m = 0x6d, n = 0x6e, o = 0x6f,
  p = 0x70, q = 0x71, r = 0x72, s = 0x73, t = 0x74,
  u = 0x75, v = 0x76, w = 0x77, x = 0x78, y = 0x79,
  z = 0x7a,
  _1 = 0x31, _2 = 0x32, _3 = 0x33, _4 = 0x34,
}

// ========== ディスプレイ ==========
export interface Display {
  name: string;        // ":0" など
  screen: number;
  framebuffer: Framebuffer;
  mouse: MouseState;
  dpi: number;
}

/** デフォルトのディスプレイを生成 */
export function createDisplay(width: number = 1024, height: number = 768): Display {
  return {
    name: ":0",
    screen: 0,
    framebuffer: new Framebuffer(width, height),
    mouse: { x: width / 2, y: height / 2, buttons: new Set() },
    dpi: 96,
  };
}
