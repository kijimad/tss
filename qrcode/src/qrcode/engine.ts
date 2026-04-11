/* QRコード シミュレーター エンジン */

import type {
  EncodingMode, ErrorCorrectionLevel, QrVersion,
  VersionInfo, EcBlockInfo, MaskPattern, MaskPenalty,
  Module, ModuleType, DataAnalysis, EncodedData, MatrixResult,
  SimOp, SimStep, SimEvent, QrResult, SimulationResult,
} from "./types.js";
import { MODE_INDICATORS, MASK_FUNCTIONS } from "./types.js";

// ─── 英数字テーブル ───

const ALPHANUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

// ─── バージョン情報テーブル（Version 1-10） ───

/** 文字数インジケータのビット長 */
const CHAR_COUNT_BITS: Record<EncodingMode, number[]> = {
  // [V1-9, V10-26, V27-40]
  numeric:      [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte:         [8, 16, 16],
  kanji:        [8, 10, 12],
};

/** バージョン別情報（V1-V10） */
const VERSION_TABLE: VersionInfo[] = [
  {
    version: 1, size: 21,
    dataCapacity: { L: 19, M: 16, Q: 13, H: 9 },
    alignmentPositions: [],
    ecBlocks: {
      L: [{ count: 1, dataCodewords: 19, ecCodewords: 7 }],
      M: [{ count: 1, dataCodewords: 16, ecCodewords: 10 }],
      Q: [{ count: 1, dataCodewords: 13, ecCodewords: 13 }],
      H: [{ count: 1, dataCodewords: 9, ecCodewords: 17 }],
    },
  },
  {
    version: 2, size: 25,
    dataCapacity: { L: 34, M: 28, Q: 22, H: 16 },
    alignmentPositions: [18],
    ecBlocks: {
      L: [{ count: 1, dataCodewords: 34, ecCodewords: 10 }],
      M: [{ count: 1, dataCodewords: 28, ecCodewords: 16 }],
      Q: [{ count: 1, dataCodewords: 22, ecCodewords: 22 }],
      H: [{ count: 1, dataCodewords: 16, ecCodewords: 28 }],
    },
  },
  {
    version: 3, size: 29,
    dataCapacity: { L: 55, M: 44, Q: 34, H: 24 },
    alignmentPositions: [22],
    ecBlocks: {
      L: [{ count: 1, dataCodewords: 55, ecCodewords: 15 }],
      M: [{ count: 1, dataCodewords: 44, ecCodewords: 26 }],
      Q: [{ count: 2, dataCodewords: 17, ecCodewords: 18 }],
      H: [{ count: 2, dataCodewords: 12, ecCodewords: 22 }],
    },
  },
  {
    version: 4, size: 33,
    dataCapacity: { L: 80, M: 64, Q: 48, H: 36 },
    alignmentPositions: [26],
    ecBlocks: {
      L: [{ count: 1, dataCodewords: 80, ecCodewords: 20 }],
      M: [{ count: 2, dataCodewords: 32, ecCodewords: 18 }],
      Q: [{ count: 2, dataCodewords: 24, ecCodewords: 26 }],
      H: [{ count: 4, dataCodewords: 9, ecCodewords: 16 }],
    },
  },
  {
    version: 5, size: 37,
    dataCapacity: { L: 108, M: 86, Q: 62, H: 46 },
    alignmentPositions: [30],
    ecBlocks: {
      L: [{ count: 1, dataCodewords: 108, ecCodewords: 26 }],
      M: [{ count: 2, dataCodewords: 43, ecCodewords: 24 }],
      Q: [{ count: 2, dataCodewords: 15, ecCodewords: 18 }, { count: 2, dataCodewords: 16, ecCodewords: 18 }],
      H: [{ count: 2, dataCodewords: 11, ecCodewords: 22 }, { count: 2, dataCodewords: 12, ecCodewords: 22 }],
    },
  },
  {
    version: 6, size: 41,
    dataCapacity: { L: 136, M: 108, Q: 76, H: 60 },
    alignmentPositions: [34],
    ecBlocks: {
      L: [{ count: 2, dataCodewords: 68, ecCodewords: 18 }],
      M: [{ count: 4, dataCodewords: 27, ecCodewords: 16 }],
      Q: [{ count: 4, dataCodewords: 19, ecCodewords: 24 }],
      H: [{ count: 4, dataCodewords: 15, ecCodewords: 28 }],
    },
  },
  {
    version: 7, size: 45,
    dataCapacity: { L: 156, M: 124, Q: 88, H: 66 },
    alignmentPositions: [6, 22, 38],
    ecBlocks: {
      L: [{ count: 2, dataCodewords: 78, ecCodewords: 20 }],
      M: [{ count: 4, dataCodewords: 31, ecCodewords: 18 }],
      Q: [{ count: 2, dataCodewords: 14, ecCodewords: 18 }, { count: 4, dataCodewords: 15, ecCodewords: 18 }],
      H: [{ count: 4, dataCodewords: 13, ecCodewords: 26 }, { count: 1, dataCodewords: 14, ecCodewords: 26 }],
    },
  },
  {
    version: 8, size: 49,
    dataCapacity: { L: 192, M: 154, Q: 110, H: 86 },
    alignmentPositions: [6, 24, 42],
    ecBlocks: {
      L: [{ count: 2, dataCodewords: 97, ecCodewords: 24 }],
      M: [{ count: 2, dataCodewords: 38, ecCodewords: 22 }, { count: 2, dataCodewords: 39, ecCodewords: 22 }],
      Q: [{ count: 4, dataCodewords: 18, ecCodewords: 22 }, { count: 2, dataCodewords: 19, ecCodewords: 22 }],
      H: [{ count: 4, dataCodewords: 14, ecCodewords: 26 }, { count: 2, dataCodewords: 15, ecCodewords: 26 }],
    },
  },
  {
    version: 9, size: 53,
    dataCapacity: { L: 230, M: 182, Q: 132, H: 100 },
    alignmentPositions: [6, 26, 46],
    ecBlocks: {
      L: [{ count: 2, dataCodewords: 116, ecCodewords: 30 }],
      M: [{ count: 3, dataCodewords: 36, ecCodewords: 22 }, { count: 2, dataCodewords: 37, ecCodewords: 22 }],
      Q: [{ count: 4, dataCodewords: 16, ecCodewords: 20 }, { count: 4, dataCodewords: 17, ecCodewords: 20 }],
      H: [{ count: 4, dataCodewords: 12, ecCodewords: 24 }, { count: 4, dataCodewords: 13, ecCodewords: 24 }],
    },
  },
  {
    version: 10, size: 57,
    dataCapacity: { L: 271, M: 216, Q: 151, H: 119 },
    alignmentPositions: [6, 28, 50],
    ecBlocks: {
      L: [{ count: 2, dataCodewords: 68, ecCodewords: 18 }, { count: 2, dataCodewords: 69, ecCodewords: 18 }],
      M: [{ count: 4, dataCodewords: 43, ecCodewords: 26 }, { count: 1, dataCodewords: 44, ecCodewords: 26 }],
      Q: [{ count: 6, dataCodewords: 19, ecCodewords: 24 }, { count: 2, dataCodewords: 20, ecCodewords: 24 }],
      H: [{ count: 6, dataCodewords: 15, ecCodewords: 28 }, { count: 2, dataCodewords: 16, ecCodewords: 28 }],
    },
  },
];

/** バージョン情報取得 */
export function getVersionInfo(v: QrVersion): VersionInfo {
  const info = VERSION_TABLE[v - 1];
  if (!info) throw new Error(`未対応バージョン: ${v}`);
  return info;
}

// ─── データ分析 ───

/** 最適なエンコードモード判定 */
export function detectMode(data: string): EncodingMode {
  if (/^\d+$/.test(data)) return "numeric";
  if ([...data].every(c => ALPHANUM_CHARS.includes(c))) return "alphanumeric";
  return "byte";
}

/** 文字数インジケータのビット長取得 */
function getCharCountBits(mode: EncodingMode, version: QrVersion): number {
  const idx = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return CHAR_COUNT_BITS[mode][idx];
}

/** 最小バージョン自動選択 */
export function selectVersion(
  data: string,
  mode: EncodingMode,
  ecLevel: ErrorCorrectionLevel,
): QrVersion {
  const dataLen = new TextEncoder().encode(data).length;

  for (const vi of VERSION_TABLE) {
    const capacity = vi.dataCapacity[ecLevel];
    // モードインジケータ(4) + 文字数インジケータ + データビット + 終端(4)
    const charCountBits = getCharCountBits(mode, vi.version);
    let dataBits: number;
    switch (mode) {
      case "numeric":
        dataBits = Math.floor(data.length / 3) * 10
          + (data.length % 3 === 2 ? 7 : data.length % 3 === 1 ? 4 : 0);
        break;
      case "alphanumeric":
        dataBits = Math.floor(data.length / 2) * 11
          + (data.length % 2 === 1 ? 6 : 0);
        break;
      case "byte":
        dataBits = dataLen * 8;
        break;
      case "kanji":
        dataBits = data.length * 13;
        break;
    }

    const totalBits = 4 + charCountBits + dataBits;
    const totalBytes = Math.ceil(totalBits / 8);

    if (totalBytes <= capacity) return vi.version;
  }

  // V10まででフィールドに収まらない場合はV10を返す（シミュレーション用）
  return 10;
}

// ─── データエンコード ───

/** 数字モードエンコード */
function encodeNumeric(data: string): string {
  let bits = "";
  for (let i = 0; i < data.length; i += 3) {
    const group = data.slice(i, i + 3);
    const val = parseInt(group, 10);
    const len = group.length === 3 ? 10 : group.length === 2 ? 7 : 4;
    bits += val.toString(2).padStart(len, "0");
  }
  return bits;
}

/** 英数字モードエンコード */
function encodeAlphanumeric(data: string): string {
  let bits = "";
  for (let i = 0; i < data.length; i += 2) {
    if (i + 1 < data.length) {
      const val = ALPHANUM_CHARS.indexOf(data[i]) * 45 + ALPHANUM_CHARS.indexOf(data[i + 1]);
      bits += val.toString(2).padStart(11, "0");
    } else {
      const val = ALPHANUM_CHARS.indexOf(data[i]);
      bits += val.toString(2).padStart(6, "0");
    }
  }
  return bits;
}

/** バイトモードエンコード */
function encodeByte(data: string): string {
  const bytes = new TextEncoder().encode(data);
  return [...bytes].map(b => b.toString(2).padStart(8, "0")).join("");
}

/** データエンコード実行 */
export function encodeData(
  data: string,
  mode: EncodingMode,
  version: QrVersion,
  ecLevel: ErrorCorrectionLevel,
  events: SimEvent[],
  steps: SimStep[],
): EncodedData {
  const vInfo = getVersionInfo(version);

  // モードインジケータ
  const modeIndicator = MODE_INDICATORS[mode];
  steps.push({ phase: "encode", message: `モードインジケータ: ${modeIndicator} (${mode})` });

  // 文字数インジケータ
  const charCountBitLen = getCharCountBits(mode, version);
  const charCount = mode === "byte" ? new TextEncoder().encode(data).length : data.length;
  const charCountIndicator = charCount.toString(2).padStart(charCountBitLen, "0");
  steps.push({ phase: "encode", message: `文字数インジケータ: ${charCountIndicator} (${charCount}文字, ${charCountBitLen}bit)` });

  // データビット
  let dataBits: string;
  switch (mode) {
    case "numeric":
      dataBits = encodeNumeric(data);
      break;
    case "alphanumeric":
      dataBits = encodeAlphanumeric(data);
      break;
    case "byte":
      dataBits = encodeByte(data);
      break;
    default:
      dataBits = encodeByte(data);
  }
  steps.push({ phase: "encode", message: `データビット: ${dataBits.length}bit` });
  events.push({ type: "encode", message: `データを${mode}モードでエンコード (${dataBits.length}bit)` });

  // ビットストリーム構築
  let bitstream = modeIndicator + charCountIndicator + dataBits;

  // 終端パターン
  const capacity = vInfo.dataCapacity[ecLevel] * 8;
  const terminatorLen = Math.min(4, capacity - bitstream.length);
  bitstream += "0".repeat(terminatorLen);

  // 8bit境界パディング
  if (bitstream.length % 8 !== 0) {
    bitstream += "0".repeat(8 - (bitstream.length % 8));
  }

  // パッドコードワード (11101100, 00010001 の繰り返し)
  const padWords = ["11101100", "00010001"];
  let padIdx = 0;
  while (bitstream.length < capacity) {
    bitstream += padWords[padIdx % 2];
    padIdx++;
  }

  // ビットストリームが容量を超えないようにトリミング
  bitstream = bitstream.slice(0, capacity);

  steps.push({ phase: "encode", message: `パディング後: ${bitstream.length}bit (容量: ${capacity}bit)` });

  // コードワード分割
  const dataCodewords: number[] = [];
  for (let i = 0; i < bitstream.length; i += 8) {
    dataCodewords.push(parseInt(bitstream.slice(i, i + 8), 2));
  }

  // 誤り訂正コードワード生成
  const ecBlocks = vInfo.ecBlocks[ecLevel];
  const ecCodewords = generateEcCodewords(dataCodewords, ecBlocks, events, steps);

  // インターリーブ
  const finalCodewords = interleave(dataCodewords, ecCodewords, ecBlocks, events, steps);

  return {
    modeIndicator,
    charCountIndicator,
    dataBits,
    fullBitstream: bitstream,
    dataCodewords,
    ecCodewords,
    finalCodewords,
  };
}

// ─── Reed-Solomon 誤り訂正 ───

/** GF(256) のログ/逆ログテーブル */
const GF_EXP = new Uint8Array(256);
const GF_LOG = new Uint8Array(256);

// テーブル初期化
(function initGfTables() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_LOG[val] = i;
    val <<= 1;
    if (val >= 256) val ^= 0x11d; // 原始多項式
  }
  GF_EXP[255] = GF_EXP[0];
})();

/** GF(256) 乗算 */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

/** 生成多項式の生成 */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const newPoly = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      newPoly[j] ^= poly[j];
      newPoly[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = newPoly;
  }
  return poly;
}

/** Reed-Solomon ECコードワード計算 */
function rsEncode(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const result = new Array(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i];
  }

  for (let i = 0; i < data.length; i++) {
    const coef = result[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        result[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }

  return result.slice(data.length);
}

/** ECコードワード生成 */
function generateEcCodewords(
  dataCodewords: number[],
  ecBlocks: EcBlockInfo[],
  events: SimEvent[],
  steps: SimStep[],
): number[] {
  const allEc: number[] = [];
  let offset = 0;

  for (const block of ecBlocks) {
    for (let i = 0; i < block.count; i++) {
      const blockData = dataCodewords.slice(offset, offset + block.dataCodewords);
      const ec = rsEncode(blockData, block.ecCodewords);
      allEc.push(...ec);
      offset += block.dataCodewords;
    }
  }

  const totalBlocks = ecBlocks.reduce((s, b) => s + b.count, 0);
  steps.push({ phase: "ec", message: `RS誤り訂正コードワード生成: ${allEc.length}個 (${totalBlocks}ブロック)` });
  events.push({ type: "ec_generate", message: `Reed-Solomon: ${allEc.length}個のECコードワード生成` });

  return allEc;
}

/** データとECのインターリーブ */
function interleave(
  dataCodewords: number[],
  ecCodewords: number[],
  ecBlocks: EcBlockInfo[],
  events: SimEvent[],
  steps: SimStep[],
): number[] {
  // データブロックに分割
  const dataBlocks: number[][] = [];
  const ecBlocksArr: number[][] = [];
  let dOff = 0;
  let eOff = 0;

  for (const block of ecBlocks) {
    for (let i = 0; i < block.count; i++) {
      dataBlocks.push(dataCodewords.slice(dOff, dOff + block.dataCodewords));
      ecBlocksArr.push(ecCodewords.slice(eOff, eOff + block.ecCodewords));
      dOff += block.dataCodewords;
      eOff += block.ecCodewords;
    }
  }

  // データインターリーブ
  const result: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }

  // ECインターリーブ
  const maxEcLen = Math.max(...ecBlocksArr.map(b => b.length));
  for (let i = 0; i < maxEcLen; i++) {
    for (const block of ecBlocksArr) {
      if (i < block.length) result.push(block[i]);
    }
  }

  steps.push({ phase: "interleave", message: `インターリーブ: ${result.length}コードワード` });
  events.push({ type: "interleave", message: `${dataBlocks.length}ブロックをインターリーブ` });

  return result;
}

// ─── マトリクス構築 ───

/** 空マトリクス生成 */
function createMatrix(size: number): Module[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      dark: false,
      type: "empty" as ModuleType,
      masked: false,
    }))
  );
}

/** ファインダーパターン配置 */
function placeFinderPatterns(matrix: Module[][]): void {
  const size = matrix.length;
  const positions: [number, number][] = [[0, 0], [0, size - 7], [size - 7, 0]];

  for (const [r, c] of positions) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const row = r + dr;
        const col = c + dc;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;

        // 外周、中央の3x3、残りは白
        const dark =
          dr === 0 || dr === 6 || dc === 0 || dc === 6 || // 外枠
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);     // 中央

        matrix[row][col] = { dark, type: "finder", masked: false };
      }
    }
  }
}

/** セパレータ配置 */
function placeSeparators(matrix: Module[][]): void {
  const size = matrix.length;

  const hLines: [number, number, number][] = [
    [7, 0, 8], [7, size - 8, 8],   // 上左、上右
    [size - 8, 0, 8],               // 下左
  ];

  for (const [r, c, len] of hLines) {
    for (let i = 0; i < len; i++) {
      if (r >= 0 && r < size && c + i >= 0 && c + i < size && matrix[r][c + i].type === "empty") {
        matrix[r][c + i] = { dark: false, type: "separator", masked: false };
      }
    }
  }

  const vLines: [number, number, number][] = [
    [0, 7, 7], [0, size - 8, 7],
    [size - 7, 7, 7],
  ];

  for (const [r, c, len] of vLines) {
    for (let i = 0; i < len; i++) {
      if (r + i >= 0 && r + i < size && c >= 0 && c < size && matrix[r + i][c].type === "empty") {
        matrix[r + i][c] = { dark: false, type: "separator", masked: false };
      }
    }
  }
}

/** タイミングパターン配置 */
function placeTimingPatterns(matrix: Module[][]): void {
  const size = matrix.length;

  // 水平タイミング（行6）
  for (let c = 8; c < size - 8; c++) {
    if (matrix[6][c].type === "empty") {
      matrix[6][c] = { dark: c % 2 === 0, type: "timing", masked: false };
    }
  }

  // 垂直タイミング（列6）
  for (let r = 8; r < size - 8; r++) {
    if (matrix[r][6].type === "empty") {
      matrix[r][6] = { dark: r % 2 === 0, type: "timing", masked: false };
    }
  }
}

/** アライメントパターン配置 */
function placeAlignmentPatterns(matrix: Module[][], positions: number[]): void {
  if (positions.length === 0) return;

  // V2以上: 6とpositionsの各値の組み合わせ
  const coords: number[] = [6, ...positions];
  const size = matrix.length;

  for (const r of coords) {
    for (const c of coords) {
      // ファインダーパターンと重なるか確認
      if (r < 9 && c < 9) continue;              // 左上
      if (r < 9 && c > size - 9) continue;       // 右上
      if (r > size - 9 && c < 9) continue;       // 左下

      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const row = r + dr;
          const col = c + dc;
          if (row < 0 || row >= size || col < 0 || col >= size) continue;

          const dark =
            Math.abs(dr) === 2 || Math.abs(dc) === 2 || // 外周
            (dr === 0 && dc === 0);                       // 中央

          matrix[row][col] = { dark, type: "alignment", masked: false };
        }
      }
    }
  }
}

/** ダークモジュール配置（常にV*8+13行, 8列） */
function placeDarkModule(matrix: Module[][], version: QrVersion): void {
  const row = 4 * version + 9;
  if (row < matrix.length) {
    matrix[row][8] = { dark: true, type: "dark_module", masked: false };
  }
}

/** フォーマット情報領域を予約 */
function reserveFormatArea(matrix: Module[][]): void {
  const size = matrix.length;

  // 左上ファインダー周辺
  for (let i = 0; i <= 8; i++) {
    if (i < size && matrix[8][i].type === "empty") {
      matrix[8][i] = { dark: false, type: "format_info", masked: false };
    }
    if (i < size && matrix[i][8].type === "empty") {
      matrix[i][8] = { dark: false, type: "format_info", masked: false };
    }
  }

  // 右上・左下
  for (let i = 0; i < 8; i++) {
    if (size - 1 - i >= 0 && matrix[8][size - 1 - i].type === "empty") {
      matrix[8][size - 1 - i] = { dark: false, type: "format_info", masked: false };
    }
    if (size - 1 - i >= 0 && matrix[size - 1 - i][8].type === "empty") {
      matrix[size - 1 - i][8] = { dark: false, type: "format_info", masked: false };
    }
  }
}

/** バージョン情報領域予約（V7以上） */
function reserveVersionArea(matrix: Module[][], version: QrVersion): void {
  if (version < 7) return;
  const size = matrix.length;

  // 左下
  for (let r = 0; r < 6; r++) {
    for (let c = size - 11; c < size - 8; c++) {
      if (matrix[r][c].type === "empty") {
        matrix[r][c] = { dark: false, type: "version_info", masked: false };
      }
    }
  }

  // 右上
  for (let r = size - 11; r < size - 8; r++) {
    for (let c = 0; c < 6; c++) {
      if (matrix[r][c].type === "empty") {
        matrix[r][c] = { dark: false, type: "version_info", masked: false };
      }
    }
  }
}

/** データ配置 */
function placeData(matrix: Module[][], codewords: number[]): void {
  const size = matrix.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;

  // 右端から左へ2列ずつ
  let col = size - 1;
  let upward = true;

  while (col >= 0) {
    // 列6（タイミングパターン）はスキップ
    if (col === 6) col--;

    for (let row = upward ? size - 1 : 0;
         upward ? row >= 0 : row < size;
         upward ? row-- : row++) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || c >= size) continue;
        if (matrix[row][c].type !== "empty") continue;

        const dark = bitIdx < totalBits
          ? ((codewords[Math.floor(bitIdx / 8)] >> (7 - (bitIdx % 8))) & 1) === 1
          : false;

        matrix[row][c] = { dark, type: "data", masked: false };
        bitIdx++;
      }
    }

    col -= 2;
    upward = !upward;
  }
}

// ─── マスク処理 ───

/** マスク適用 */
function applyMask(matrix: Module[][], pattern: MaskPattern): Module[][] {
  const size = matrix.length;
  const fn = MASK_FUNCTIONS[pattern];
  const masked = matrix.map(row => row.map(m => ({ ...m })));

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (masked[r][c].type === "data") {
        if (fn(r, c)) {
          masked[r][c] = { ...masked[r][c], dark: !masked[r][c].dark, masked: true };
        }
      }
    }
  }

  return masked;
}

/** ペナルティ計算 Rule 1: 同色の連続モジュール */
function penaltyRule1(matrix: Module[][]): number {
  const size = matrix.length;
  let penalty = 0;

  // 行方向
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c].dark === matrix[r][c - 1].dark) {
        count++;
      } else {
        if (count >= 5) penalty += count - 2;
        count = 1;
      }
    }
    if (count >= 5) penalty += count - 2;
  }

  // 列方向
  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c].dark === matrix[r - 1][c].dark) {
        count++;
      } else {
        if (count >= 5) penalty += count - 2;
        count = 1;
      }
    }
    if (count >= 5) penalty += count - 2;
  }

  return penalty;
}

/** ペナルティ計算 Rule 2: 2x2同色ブロック */
function penaltyRule2(matrix: Module[][]): number {
  const size = matrix.length;
  let penalty = 0;

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const d = matrix[r][c].dark;
      if (d === matrix[r][c + 1].dark &&
          d === matrix[r + 1][c].dark &&
          d === matrix[r + 1][c + 1].dark) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

/** ペナルティ計算 Rule 3: ファインダー類似パターン */
function penaltyRule3(matrix: Module[][]): number {
  const size = matrix.length;
  let penalty = 0;

  const pattern1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pattern2 = [false, false, false, false, true, false, true, true, true, false, true];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let match1 = true;
      let match2 = true;
      for (let i = 0; i < 11; i++) {
        if (matrix[r][c + i].dark !== pattern1[i]) match1 = false;
        if (matrix[r][c + i].dark !== pattern2[i]) match2 = false;
      }
      if (match1 || match2) penalty += 40;
    }
  }

  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let match1 = true;
      let match2 = true;
      for (let i = 0; i < 11; i++) {
        if (matrix[r + i][c].dark !== pattern1[i]) match1 = false;
        if (matrix[r + i][c].dark !== pattern2[i]) match2 = false;
      }
      if (match1 || match2) penalty += 40;
    }
  }

  return penalty;
}

/** ペナルティ計算 Rule 4: 明暗比率 */
function penaltyRule4(matrix: Module[][]): number {
  const size = matrix.length;
  let dark = 0;
  const total = size * size;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c].dark) dark++;
    }
  }

  const pct = (dark / total) * 100;
  const prev5 = Math.floor(pct / 5) * 5;
  const next5 = prev5 + 5;

  return Math.min(
    Math.abs(prev5 - 50) / 5,
    Math.abs(next5 - 50) / 5,
  ) * 10;
}

/** 全ペナルティ計算 */
function calculatePenalty(matrix: Module[][]): MaskPenalty {
  const rule1 = penaltyRule1(matrix);
  const rule2 = penaltyRule2(matrix);
  const rule3 = penaltyRule3(matrix);
  const rule4 = penaltyRule4(matrix);
  return { rule1, rule2, rule3, rule4, total: rule1 + rule2 + rule3 + rule4 };
}

/** 最適マスクパターン選択 */
function selectBestMask(matrix: Module[][]): { pattern: MaskPattern; masked: Module[][]; penalty: MaskPenalty } {
  let bestPenalty = Infinity;
  let bestPattern: MaskPattern = 0;
  let bestMatrix = matrix;
  let bestPenaltyDetail: MaskPenalty = { rule1: 0, rule2: 0, rule3: 0, rule4: 0, total: 0 };

  for (let p = 0; p < 8; p++) {
    const masked = applyMask(matrix, p as MaskPattern);
    const penalty = calculatePenalty(masked);
    if (penalty.total < bestPenalty) {
      bestPenalty = penalty.total;
      bestPattern = p as MaskPattern;
      bestMatrix = masked;
      bestPenaltyDetail = penalty;
    }
  }

  return { pattern: bestPattern, masked: bestMatrix, penalty: bestPenaltyDetail };
}

// ─── フォーマット情報書き込み ───

/** フォーマット情報ビット列生成 */
function formatInfoBits(ecLevel: ErrorCorrectionLevel, mask: MaskPattern): string {
  const ecBits: Record<ErrorCorrectionLevel, string> = { L: "01", M: "00", Q: "11", H: "10" };
  let data = ecBits[ecLevel] + mask.toString(2).padStart(3, "0");

  // BCH(15,5)エンコード
  let val = parseInt(data, 2) << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if (val & (1 << i)) {
      val ^= gen << (i - 10);
    }
  }
  const encoded = (parseInt(data, 2) << 10) | val;
  const masked = encoded ^ 0b101010000010010;
  return masked.toString(2).padStart(15, "0");
}

/** フォーマット情報配置 */
function placeFormatInfo(matrix: Module[][], ecLevel: ErrorCorrectionLevel, mask: MaskPattern): void {
  const bits = formatInfoBits(ecLevel, mask);
  const size = matrix.length;

  // 左上周辺（水平：列0-7, 行8）
  const hPos = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 0; i < 8; i++) {
    matrix[8][hPos[i]] = { dark: bits[i] === "1", type: "format_info", masked: false };
  }

  // 左上周辺（垂直：行0-7, 列8）
  const vPos = [8, 7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < 8; i++) {
    matrix[vPos[i]][8] = { dark: bits[i + 7] === "1", type: "format_info", masked: false };
  }

  // 右上水平
  for (let i = 0; i < 8; i++) {
    matrix[8][size - 1 - i] = { dark: bits[i] === "1", type: "format_info", masked: false };
  }

  // 左下垂直
  for (let i = 0; i < 7; i++) {
    matrix[size - 1 - i][8] = { dark: bits[i + 8] === "1", type: "format_info", masked: false };
  }
}

// ─── メイン処理 ───

/** QRコード生成 */
export function generateQr(
  data: string,
  ecLevel: ErrorCorrectionLevel,
  version?: QrVersion,
): QrResult {
  const events: SimEvent[] = [];
  const steps: SimStep[] = [];

  // 1. データ分析
  const mode = detectMode(data);
  const ver = version ?? selectVersion(data, mode, ecLevel);
  const vInfo = getVersionInfo(ver);

  const analysis: DataAnalysis = {
    input: data,
    mode,
    version: ver,
    ecLevel,
    charCount: data.length,
    bitLength: 0,
  };

  steps.push({ phase: "analyze", message: `入力データ: "${data.slice(0, 50)}${data.length > 50 ? "..." : ""}"` });
  steps.push({ phase: "analyze", message: `エンコードモード: ${mode}` });
  steps.push({ phase: "analyze", message: `バージョン: ${ver} (${vInfo.size}x${vInfo.size})` });
  steps.push({ phase: "analyze", message: `誤り訂正レベル: ${ecLevel} (${({ L: 7, M: 15, Q: 25, H: 30 })[ecLevel]}%復元)` });
  events.push({ type: "analyze", message: `データ分析: ${mode}モード, V${ver}, EC-${ecLevel}` });

  // 2. データエンコード
  const encoded = encodeData(data, mode, ver, ecLevel, events, steps);
  analysis.bitLength = encoded.fullBitstream.length;

  // 3. マトリクス構築
  const matrix = createMatrix(vInfo.size);
  steps.push({ phase: "place", message: `${vInfo.size}x${vInfo.size}マトリクス生成` });

  placeFinderPatterns(matrix);
  steps.push({ phase: "place", message: "ファインダーパターン配置 (3箇所)" });

  placeSeparators(matrix);
  steps.push({ phase: "place", message: "セパレータ配置" });

  placeTimingPatterns(matrix);
  steps.push({ phase: "place", message: "タイミングパターン配置" });

  placeAlignmentPatterns(matrix, vInfo.alignmentPositions);
  if (vInfo.alignmentPositions.length > 0) {
    steps.push({ phase: "place", message: `アライメントパターン配置 (座標: ${vInfo.alignmentPositions.join(", ")})` });
  }

  placeDarkModule(matrix, ver);
  steps.push({ phase: "place", message: "ダークモジュール配置" });

  reserveFormatArea(matrix);
  if (ver >= 7) reserveVersionArea(matrix, ver);

  events.push({ type: "place", message: `機能パターン配置完了 (${vInfo.size}x${vInfo.size})` });

  // 4. データ配置
  placeData(matrix, encoded.finalCodewords);
  steps.push({ phase: "place", message: `データモジュール配置 (${encoded.finalCodewords.length}コードワード)` });
  events.push({ type: "place", message: `${encoded.finalCodewords.length}コードワードのデータ配置` });

  // 5. マスク選択・適用
  const { pattern, masked, penalty } = selectBestMask(matrix);
  steps.push({
    phase: "mask",
    message: `マスクパターン${pattern}を選択`,
    detail: `ペナルティ: R1=${penalty.rule1} R2=${penalty.rule2} R3=${penalty.rule3} R4=${penalty.rule4} 合計=${penalty.total}`,
  });
  events.push({ type: "mask", message: `マスクパターン${pattern}適用 (ペナルティ: ${penalty.total})` });

  // 6. フォーマット情報
  placeFormatInfo(masked, ecLevel, pattern);
  steps.push({ phase: "format", message: `フォーマット情報書込 (EC: ${ecLevel}, Mask: ${pattern})` });
  events.push({ type: "format", message: "フォーマット情報書込完了" });

  events.push({ type: "complete", message: `QRコード生成完了 (V${ver}, ${vInfo.size}x${vInfo.size})` });

  const matrixResult: MatrixResult = {
    matrix: masked,
    size: vInfo.size,
    maskPattern: pattern,
    penalties: penalty,
  };

  return { analysis, encoded, matrix: matrixResult, steps, events };
}

// ─── シミュレーション ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allEvents: SimEvent[] = [];
  const results: QrResult[] = [];

  for (const op of ops) {
    switch (op.type) {
      case "encode": {
        const r = generateQr(op.data, op.ecLevel, op.version);
        results.push(r);
        allEvents.push(...r.events);
        break;
      }
      case "encode_compare": {
        for (const ecLevel of op.ecLevels) {
          const r = generateQr(op.data, ecLevel);
          results.push(r);
          allEvents.push(...r.events);
        }
        break;
      }
      case "mask_compare": {
        // 全マスクパターンの結果を比較
        const r = generateQr(op.data, op.ecLevel);
        results.push(r);
        allEvents.push(...r.events);
        break;
      }
    }
  }

  return { results, events: allEvents };
}
