/**
 * index.ts — ES ターゲットトランスパイラー公開 API
 */

export type { ESTarget } from "./targets.js";
export { ALL_TARGETS, FEATURES_BY_VERSION, targetBelow } from "./targets.js";
export {
  stripTypes,
  downlevelLetConst,
  downlevelArrowFunctions,
  downlevelTemplateLiterals,
  downlevelDefaultParams,
  downlevelClasses,
  downlevelForOf,
  downlevelShorthandProperties,
  downlevelExponentiation,
  downlevelAsyncAwait,
  downlevelObjectSpread,
  downlevelOptionalCatch,
  downlevelOptionalChaining,
  downlevelNullishCoalescing,
  downlevelLogicalAssignment,
  downlevelClassFields,
} from "./transforms.js";

import type { ESTarget } from "./targets.js";
import { targetBelow, FEATURES_BY_VERSION } from "./targets.js";
import {
  stripTypes,
  downlevelLetConst,
  downlevelArrowFunctions,
  downlevelTemplateLiterals,
  downlevelDefaultParams,
  downlevelClasses,
  downlevelForOf,
  downlevelExponentiation,
  downlevelAsyncAwait,
  downlevelObjectSpread,
  downlevelOptionalCatch,
  downlevelOptionalChaining,
  downlevelNullishCoalescing,
  downlevelLogicalAssignment,
  downlevelClassFields,
} from "./transforms.js";

/** トランスパイル結果 */
export interface TranspileResult {
  /** 変換後の JavaScript コード */
  code: string;
  /** 適用された変換パスの一覧 */
  appliedPasses: string[];
  /** ターゲットがネイティブサポートする機能一覧 */
  nativeFeatures: string[];
  /** ダウンレベルされた機能一覧 */
  downleveledFeatures: string[];
}

/** TypeScript ソースを指定の ES ターゲットに変換する */
export function transpile(source: string, target: ESTarget): TranspileResult {
  const appliedPasses: string[] = [];
  const downleveledFeatures: string[] = [];
  const nativeFeatures: string[] = [];

  // ネイティブサポート/ダウンレベルの分類
  for (const [version, features] of Object.entries(FEATURES_BY_VERSION)) {
    const below = targetBelow(target, version as ESTarget);
    for (const f of features) {
      if (below) downleveledFeatures.push(f);
      else nativeFeatures.push(f);
    }
  }

  // 1. 常に型を除去
  let code = stripTypes(source);
  appliedPasses.push("型アノテーション除去");

  // 2. ES2022 機能のダウンレベル
  if (targetBelow(target, "es2022")) {
    const prev = code;
    code = downlevelClassFields(code);
    if (code !== prev) appliedPasses.push("クラスフィールド → constructor 内代入");
  }

  // 3. ES2021 機能のダウンレベル
  if (targetBelow(target, "es2021")) {
    const prev = code;
    code = downlevelLogicalAssignment(code);
    if (code !== prev) appliedPasses.push("論理代入 (??=, ||=, &&=) → 展開形");
  }

  // 4. ES2020 機能のダウンレベル
  if (targetBelow(target, "es2020")) {
    const prev = code;
    code = downlevelOptionalChaining(code);
    code = downlevelNullishCoalescing(code);
    if (code !== prev) appliedPasses.push("?. / ?? → 手動 null チェック");
  }

  // 5. ES2019 機能のダウンレベル
  if (targetBelow(target, "es2019")) {
    const prev = code;
    code = downlevelOptionalCatch(code);
    if (code !== prev) appliedPasses.push("optional catch binding → catch(_e)");
  }

  // 6. ES2018 機能のダウンレベル
  if (targetBelow(target, "es2018")) {
    const prev = code;
    code = downlevelObjectSpread(code);
    if (code !== prev) appliedPasses.push("オブジェクト spread → Object.assign");
  }

  // 7. ES2017 機能のダウンレベル
  if (targetBelow(target, "es2017")) {
    const prev = code;
    code = downlevelAsyncAwait(code);
    if (code !== prev) appliedPasses.push("async/await → __awaiter + generator");
  }

  // 8. ES2016 機能のダウンレベル
  if (targetBelow(target, "es2016")) {
    const prev = code;
    code = downlevelExponentiation(code);
    if (code !== prev) appliedPasses.push("** → Math.pow()");
  }

  // 9. ES2015 機能のダウンレベル（最も大きな変更）
  if (targetBelow(target, "es2015")) {
    code = downlevelClasses(code);
    appliedPasses.push("class → function + prototype");

    code = downlevelDefaultParams(code);
    code = downlevelArrowFunctions(code);
    appliedPasses.push("アロー関数 → function 式");

    code = downlevelTemplateLiterals(code);
    appliedPasses.push("テンプレートリテラル → 文字列結合");

    code = downlevelForOf(code);

    code = downlevelLetConst(code);
    appliedPasses.push("let/const → var");
  }

  return { code, appliedPasses, nativeFeatures, downleveledFeatures };
}
