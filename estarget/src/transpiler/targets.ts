/** サポートする全 ES ターゲット */
export type ESTarget =
  | "es3"
  | "es5"
  | "es2015"
  | "es2016"
  | "es2017"
  | "es2018"
  | "es2019"
  | "es2020"
  | "es2021"
  | "es2022"
  | "es2023"
  | "esnext";

/** ターゲットの数値レベル（比較用） */
const TARGET_LEVEL: Record<ESTarget, number> = {
  es3: 3,
  es5: 5,
  es2015: 2015,
  es2016: 2016,
  es2017: 2017,
  es2018: 2018,
  es2019: 2019,
  es2020: 2020,
  es2021: 2021,
  es2022: 2022,
  es2023: 2023,
  esnext: 9999,
};

/** ターゲットが指定バージョン未満かどうか */
export function targetBelow(target: ESTarget, version: ESTarget): boolean {
  return TARGET_LEVEL[target] < TARGET_LEVEL[version];
}

/** 全ターゲット一覧（表示用） */
export const ALL_TARGETS: { value: ESTarget; label: string; year: string }[] = [
  { value: "es3", label: "ES3", year: "1999" },
  { value: "es5", label: "ES5", year: "2009" },
  { value: "es2015", label: "ES2015 (ES6)", year: "2015" },
  { value: "es2016", label: "ES2016", year: "2016" },
  { value: "es2017", label: "ES2017", year: "2017" },
  { value: "es2018", label: "ES2018", year: "2018" },
  { value: "es2019", label: "ES2019", year: "2019" },
  { value: "es2020", label: "ES2020", year: "2020" },
  { value: "es2021", label: "ES2021", year: "2021" },
  { value: "es2022", label: "ES2022", year: "2022" },
  { value: "es2023", label: "ES2023", year: "2023" },
  { value: "esnext", label: "ESNext", year: "latest" },
];

/** 各バージョンで導入された主な構文機能 */
export const FEATURES_BY_VERSION: Record<string, string[]> = {
  es2015: [
    "let / const",
    "アロー関数",
    "クラス構文",
    "テンプレートリテラル",
    "デフォルト引数",
    "分割代入",
    "for...of",
    "スプレッド構文",
    "省略プロパティ",
  ],
  es2016: ["べき乗演算子 (**)"],
  es2017: ["async / await"],
  es2018: ["オブジェクト rest/spread"],
  es2019: ["optional catch binding"],
  es2020: ["optional chaining (?.)","nullish coalescing (??)"],
  es2021: ["論理代入 (??=, ||=, &&=)"],
  es2022: ["クラスフィールド", "トップレベル await", "#private フィールド"],
  es2023: ["Array findLast / findLastIndex (ライブラリ)"],
  esnext: ["using 宣言 (Explicit Resource Management)"],
};
