/* SQLインジェクション シミュレーター プリセット */

import type { Preset, SimOp } from "./types.js";
import { noDefense, parameterizedOnly, escapingOnly, wafOnly, fullDefense } from "./engine.js";

export const PRESETS: Preset[] = [
  {
    name: "クラシック SQLi（認証バイパス）",
    description: "' OR '1'='1' -- でログイン認証をバイパスする基本的な攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'pass123'",
        payload: "' OR '1'='1' --",
        defense: noDefense(), legitimateInput: "admin",
      },
      {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'pass123'",
        payload: "' OR '1'='1' --",
        defense: parameterizedOnly(), legitimateInput: "admin",
      },
    ],
  },
  {
    name: "UNION型 SQLi（情報漏洩）",
    description: "UNION SELECTで別テーブルのデータを窃取",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "union_based", inputMethod: "url_param",
        queryTemplate: "SELECT id, name, price FROM products WHERE category = '${input}'",
        payload: "' UNION SELECT id, key_name, key_value FROM secrets --",
        defense: noDefense(), legitimateInput: "electronics",
      },
      {
        type: "attack", injectionType: "union_based", inputMethod: "url_param",
        queryTemplate: "SELECT id, name, price FROM products WHERE category = '${input}'",
        payload: "' UNION SELECT id, username, password FROM users --",
        defense: noDefense(), legitimateInput: "electronics",
      },
    ],
  },
  {
    name: "ブラインド SQLi（真偽値ベース）",
    description: "レスポンスの違いから情報を推測するブラインド攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "blind_boolean", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1 AND 1=1",
        defense: noDefense(), legitimateInput: "1",
      },
      {
        type: "attack", injectionType: "blind_boolean", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1 AND 1=2",
        defense: noDefense(), legitimateInput: "1",
      },
      {
        type: "attack", injectionType: "blind_boolean", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1 AND 1=1",
        defense: { ...noDefense(), inputValidation: true }, legitimateInput: "1",
      },
    ],
  },
  {
    name: "ブラインド SQLi（時間ベース）",
    description: "SLEEP関数でレスポンス遅延を利用して情報推測",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "blind_time", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1; SELECT SLEEP(5) --",
        defense: noDefense(), legitimateInput: "1",
      },
      {
        type: "attack", injectionType: "blind_time", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1; SELECT SLEEP(5) --",
        defense: wafOnly(), legitimateInput: "1",
      },
    ],
  },
  {
    name: "エラーベース SQLi",
    description: "エラーメッセージから情報を取得する攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "error_based", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1 AND (SELECT 1 FROM nonexistent_table)",
        defense: noDefense(), legitimateInput: "1",
      },
      {
        type: "attack", injectionType: "error_based", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1 AND (SELECT 1 FROM nonexistent_table)",
        defense: { ...noDefense(), hideErrors: true }, legitimateInput: "1",
      },
    ],
  },
  {
    name: "スタックドクエリ（データ破壊）",
    description: "セミコロンで区切って破壊的なSQLを追加実行",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "stacked", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1; DROP TABLE users",
        defense: noDefense(), legitimateInput: "1",
      },
      {
        type: "attack", injectionType: "stacked", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1; DROP TABLE users",
        defense: { ...noDefense(), leastPrivilege: true }, legitimateInput: "1",
      },
      {
        type: "attack", injectionType: "stacked", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1; DROP TABLE users",
        defense: wafOnly(), legitimateInput: "1",
      },
    ],
  },
  {
    name: "セカンドオーダー SQLi",
    description: "保存データが別のクエリで使用される際に発動する攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "second_order", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}'",
        payload: "admin'--",
        defense: noDefense(), legitimateInput: "alice",
      },
      {
        type: "attack", injectionType: "second_order", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}'",
        payload: "admin'--",
        defense: parameterizedOnly(), legitimateInput: "alice",
      },
    ],
  },
  {
    name: "エスケープ防御の検証",
    description: "入力エスケープによる防御効果と限界の確認",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'test'",
        payload: "' OR '1'='1' --",
        defense: noDefense(), legitimateInput: "admin",
      },
      {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'test'",
        payload: "' OR '1'='1' --",
        defense: escapingOnly(), legitimateInput: "admin",
      },
      {
        type: "attack", injectionType: "classic", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE id = ${input}",
        payload: "1 OR 1=1",
        defense: escapingOnly(), legitimateInput: "1",
      },
    ],
  },
  {
    name: "WAF バイパス手法",
    description: "WAFの検知パターンを回避する高度な攻撃手法",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "classic", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}'",
        payload: "' OR 1=1 --",
        defense: wafOnly(), legitimateInput: "admin",
      },
      {
        type: "attack", injectionType: "union_based", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM products WHERE name = '${input}'",
        payload: "' UNION SELECT id,username,password,email,role FROM users --",
        defense: wafOnly(), legitimateInput: "ノートPC",
      },
      {
        type: "attack", injectionType: "classic", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}'",
        payload: "admin",
        defense: wafOnly(), legitimateInput: "admin",
      },
    ],
  },
  {
    name: "多層防御",
    description: "全防御メカニズムを有効にした場合の攻撃結果",
    build: (): SimOp[] => [
      {
        type: "attack", injectionType: "classic", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM users WHERE username = '${input}' AND password = 'test'",
        payload: "' OR '1'='1' --",
        defense: fullDefense(), legitimateInput: "admin",
      },
      {
        type: "attack", injectionType: "union_based", inputMethod: "url_param",
        queryTemplate: "SELECT * FROM products WHERE category = '${input}'",
        payload: "' UNION SELECT id, key_name, key_value FROM secrets --",
        defense: fullDefense(), legitimateInput: "electronics",
      },
      {
        type: "attack", injectionType: "stacked", inputMethod: "form_post",
        queryTemplate: "SELECT * FROM products WHERE id = ${input}",
        payload: "1; DROP TABLE users",
        defense: fullDefense(), legitimateInput: "1",
      },
    ],
  },
];
