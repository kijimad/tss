import { transpile } from "../transpiler/index.js";
import type { ModuleSystem, EmitResult } from "../transpiler/index.js";

/** サンプル例の型定義 */
export interface Example {
  name: string;
  code: string;
}

/** 全モジュールシステム一覧 */
export const MODULE_SYSTEMS: { value: ModuleSystem; label: string }[] = [
  { value: "commonjs", label: "CommonJS" },
  { value: "esm", label: "ES Modules" },
  { value: "amd", label: "AMD" },
  { value: "umd", label: "UMD" },
  { value: "system", label: "SystemJS" },
];

/** プリセット例 */
export const EXAMPLES: Example[] = [
  {
    name: "名前付きインポート/エクスポート",
    code: `import { readFile, writeFile } from 'fs';
import { join } from 'path';

export const VERSION = '1.0.0';

export function loadConfig(dir: string): string {
  const path = join(dir, 'config.json');
  return readFile(path);
}`,
  },
  {
    name: "デフォルトエクスポート",
    code: `import EventEmitter from 'events';
import { Logger } from './logger';

const logger = new Logger('app');

export default class Application {
  private emitter = new EventEmitter();

  start(): void {
    logger.info('Application started');
    this.emitter.emit('start');
  }
}`,
  },
  {
    name: "名前空間インポート",
    code: `import * as path from 'path';
import * as fs from 'fs';

export function resolve(base: string, relative: string): string {
  return path.resolve(base, relative);
}

export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}`,
  },
  {
    name: "再エクスポート",
    code: `export { useState, useEffect } from 'react';
export { default as Router } from './router';
export * from './utils';
export * as helpers from './helpers';

export const APP_NAME = 'MyApp';`,
  },
  {
    name: "型のみのインポート (削除される)",
    code: `import type { Request, Response } from 'express';
import { Router } from 'express';

export type RouteHandler = (req: Request, res: Response) => void;

export interface AppConfig {
  port: number;
  host: string;
}

export const router = Router();

export function createHandler(config: AppConfig): RouteHandler {
  return (req, res) => {
    res.json({ status: 'ok' });
  };
}`,
  },
  {
    name: "混合パターン",
    code: `import http from 'http';
import { EventEmitter } from 'events';
import * as url from 'url';
import type { IncomingMessage } from 'http';

const emitter = new EventEmitter();
const PORT = 3000;

export function parseUrl(raw: string): url.URL {
  return new url.URL(raw);
}

export class Server {
  listen() {
    http.createServer().listen(PORT);
  }
}

export default function createApp() {
  return new Server();
}

export { emitter, PORT };`,
  },
];

/** モジュールシステムに対応するアクセントカラー */
function systemColor(sys: ModuleSystem): string {
  switch (sys) {
    case "commonjs": return "#68d391";
    case "esm":      return "#63b3ed";
    case "amd":      return "#f6ad55";
    case "umd":      return "#fc8181";
    case "system":   return "#d6bcfa";
  }
}

export class ModulesApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Module System Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#63b3ed;";
    header.appendChild(title);

    // サンプル選択
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exampleSelect.appendChild(opt);
    }
    header.appendChild(exampleSelect);

    // モジュールシステム選択
    const sysSelect = document.createElement("select");
    sysSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;font-weight:600;";
    for (const sys of MODULE_SYSTEMS) {
      const opt = document.createElement("option");
      opt.value = sys.value;
      opt.textContent = sys.label;
      sysSelect.appendChild(opt);
    }
    header.appendChild(sysSelect);

    // 変換ボタン
    const transpileBtn = document.createElement("button");
    transpileBtn.textContent = "Transpile";
    transpileBtn.style.cssText =
      "padding:4px 16px;background:#63b3ed;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(transpileBtn);

    // 「全比較」ボタン
    const compareBtn = document.createElement("button");
    compareBtn.textContent = "全形式を比較";
    compareBtn.style.cssText =
      "padding:4px 12px;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:4px;cursor:pointer;font-size:11px;";
    header.appendChild(compareBtn);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: TypeScript ソース
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const tsLabel = document.createElement("div");
    tsLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#3178c6;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;";
    tsLabel.textContent = "TypeScript (入力)";
    const tsIcon = document.createElement("span");
    tsIcon.style.cssText = "font-size:9px;color:#64748b;";
    tsIcon.textContent = "import / export 構文";
    tsLabel.appendChild(tsIcon);
    leftPanel.appendChild(tsLabel);

    const tsArea = document.createElement("textarea");
    tsArea.style.cssText =
      "flex:1;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;line-height:1.6;";
    tsArea.spellcheck = false;
    tsArea.value = EXAMPLES[0]!.code;
    leftPanel.appendChild(tsArea);
    main.appendChild(leftPanel);

    // 右パネル: 出力
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // 出力ラベル
    const jsLabel = document.createElement("div");
    jsLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;";
    const jsLabelText = document.createElement("span");
    jsLabelText.textContent = "JavaScript (出力)";
    jsLabelText.style.color = "#68d391";
    jsLabel.appendChild(jsLabelText);
    const sysTag = document.createElement("span");
    sysTag.style.cssText =
      "padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;";
    jsLabel.appendChild(sysTag);
    rightPanel.appendChild(jsLabel);

    // 出力エリア
    const jsArea = document.createElement("textarea");
    jsArea.style.cssText =
      "flex:1;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#a5f3fc;border:none;outline:none;resize:none;tab-size:2;line-height:1.6;";
    jsArea.readOnly = true;
    jsArea.spellcheck = false;
    rightPanel.appendChild(jsArea);

    // 説明エリア
    const descDiv = document.createElement("div");
    descDiv.style.cssText =
      "padding:8px 12px;font-size:11px;color:#94a3b8;border-top:1px solid #1e293b;line-height:1.5;min-height:40px;";
    rightPanel.appendChild(descDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 比較ビュー（非表示で待機） ──
    const comparePanel = document.createElement("div");
    comparePanel.style.cssText =
      "display:none;flex:1;overflow-y:auto;padding:0;";
    container.appendChild(comparePanel);

    let compareMode = false;

    // ── ロジック ──

    const doTranspile = () => {
      const target = sysSelect.value as ModuleSystem;
      const result = transpile(tsArea.value, target);
      jsArea.value = result.code;
      descDiv.textContent = result.description;
      const color = systemColor(target);
      sysTag.textContent = sysSelect.options[sysSelect.selectedIndex]?.text ?? "";
      sysTag.style.cssText = `padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44;`;
      jsLabelText.style.color = color;
    };

    const showCompare = () => {
      const results: { sys: typeof MODULE_SYSTEMS[number]; result: EmitResult }[] = [];
      for (const sys of MODULE_SYSTEMS) {
        results.push({ sys, result: transpile(tsArea.value, sys.value) });
      }
      comparePanel.innerHTML = "";
      const grid = document.createElement("div");
      grid.style.cssText = "display:flex;flex-wrap:wrap;gap:0;";

      for (const { sys, result } of results) {
        const card = document.createElement("div");
        const color = systemColor(sys.value);
        card.style.cssText = `flex:1;min-width:300px;border-right:1px solid #1e293b;border-bottom:1px solid #1e293b;display:flex;flex-direction:column;`;

        const cardHeader = document.createElement("div");
        cardHeader.style.cssText = `padding:4px 10px;font-size:11px;font-weight:600;color:${color};border-bottom:1px solid #1e293b;background:#0f172a;`;
        cardHeader.textContent = sys.label;
        card.appendChild(cardHeader);

        const codeDiv = document.createElement("pre");
        codeDiv.style.cssText =
          "flex:1;padding:8px 10px;font-family:inherit;font-size:10px;color:#cbd5e1;overflow:auto;white-space:pre;margin:0;background:#0f172a;line-height:1.5;min-height:200px;max-height:400px;";
        codeDiv.textContent = result.code;
        card.appendChild(codeDiv);

        grid.appendChild(card);
      }
      comparePanel.appendChild(grid);
    };

    const toggleCompare = () => {
      compareMode = !compareMode;
      if (compareMode) {
        main.style.display = "none";
        comparePanel.style.display = "flex";
        compareBtn.textContent = "単一表示に戻す";
        compareBtn.style.background = "#63b3ed";
        compareBtn.style.color = "#0f172a";
        compareBtn.style.borderColor = "#63b3ed";
        showCompare();
      } else {
        main.style.display = "flex";
        comparePanel.style.display = "none";
        compareBtn.textContent = "全形式を比較";
        compareBtn.style.background = "#334155";
        compareBtn.style.color = "#94a3b8";
        compareBtn.style.borderColor = "#475569";
      }
    };

    // ── イベント ──

    exampleSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exampleSelect.value)];
      if (ex !== undefined) {
        tsArea.value = ex.code;
        doTranspile();
        if (compareMode) showCompare();
      }
    });

    sysSelect.addEventListener("change", doTranspile);
    transpileBtn.addEventListener("click", () => {
      doTranspile();
      if (compareMode) showCompare();
    });
    compareBtn.addEventListener("click", toggleCompare);

    // 初期変換
    doTranspile();
  }
}
