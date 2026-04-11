/* QRコード シミュレーター プリセット */

import type { Preset, SimOp } from "./types.js";

export const PRESETS: Preset[] = [
  {
    name: "数字エンコード",
    description: "数字モードで短い数値をQRコードにエンコード",
    build: (): SimOp[] => [
      { type: "encode", data: "0123456789", ecLevel: "M" },
    ],
  },
  {
    name: "英数字エンコード",
    description: "英数字モードでURLをエンコード",
    build: (): SimOp[] => [
      { type: "encode", data: "HTTPS://EXAMPLE.COM", ecLevel: "M" },
    ],
  },
  {
    name: "バイトエンコード",
    description: "バイトモードで日本語テキストをエンコード",
    build: (): SimOp[] => [
      { type: "encode", data: "Hello, World!", ecLevel: "M" },
    ],
  },
  {
    name: "誤り訂正レベル比較",
    description: "同じデータをL/M/Q/Hの4レベルでエンコードし比較",
    build: (): SimOp[] => [
      { type: "encode_compare", data: "QR Code Test", ecLevels: ["L", "M", "Q", "H"] },
    ],
  },
  {
    name: "バージョン比較",
    description: "データ量の異なるテキストでバージョン変化を確認",
    build: (): SimOp[] => [
      { type: "encode", data: "Hi", ecLevel: "M" },
      { type: "encode", data: "Hello, World! This is QR.", ecLevel: "M" },
      { type: "encode", data: "The quick brown fox jumps over the lazy dog. 0123456789", ecLevel: "M" },
    ],
  },
  {
    name: "マスクパターン",
    description: "最適マスクパターン選択とペナルティスコア",
    build: (): SimOp[] => [
      { type: "mask_compare", data: "MASK TEST", ecLevel: "M" },
    ],
  },
  {
    name: "最大容量テスト",
    description: "各モードで容量ギリギリのデータをエンコード",
    build: (): SimOp[] => [
      { type: "encode", data: "1234567890123456", ecLevel: "L" },
      { type: "encode", data: "ABCDEFGHIJ", ecLevel: "L" },
      { type: "encode", data: "Hello QR Code!", ecLevel: "L" },
    ],
  },
  {
    name: "URL エンコード",
    description: "実用的なURLをQRコードにエンコード",
    build: (): SimOp[] => [
      { type: "encode", data: "https://example.com/path?q=test", ecLevel: "M" },
    ],
  },
  {
    name: "高誤り訂正",
    description: "Hレベル(30%復元)でエンコードしデータ効率を確認",
    build: (): SimOp[] => [
      { type: "encode", data: "HIGH EC", ecLevel: "H" },
      { type: "encode", data: "HIGH EC", ecLevel: "L" },
    ],
  },
  {
    name: "WiFi接続情報",
    description: "WiFi接続用QRコード(SSID/パスワード)",
    build: (): SimOp[] => [
      { type: "encode", data: "WIFI:T:WPA;S:MyNetwork;P:password123;;", ecLevel: "M" },
    ],
  },
];
