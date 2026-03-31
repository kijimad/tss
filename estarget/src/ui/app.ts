import { transpile, ALL_TARGETS } from "../transpiler/index.js";
import type { ESTarget, TranspileResult } from "../transpiler/index.js";

/** サンプル例の型定義 */
export interface Example {
  name: string;
  /** 主に示す機能のバージョン境界 */
  boundary: string;
  code: string;
}

/** プリセット例 */
export const EXAMPLES: Example[] = [
  {
    name: "let/const + アロー関数 + テンプレートリテラル",
    boundary: "ES5 ↔ ES2015",
    code: `const greeting = "World";
let message = \`Hello, \${greeting}!\`;

const double = (x: number) => x * 2;
const add = (a: number, b: number) => {
  return a + b;
};

console.log(message);
console.log(double(21));`,
  },
  {
    name: "クラス + 継承",
    boundary: "ES5 ↔ ES2015",
    code: `class Animal {
  constructor(name: string) {
    this.name = name;
  }
  speak() {
    return \`\${this.name} makes a noise.\`;
  }
}

class Dog extends Animal {
  constructor(name: string) {
    super(name);
  }
  speak() {
    return \`\${this.name} barks.\`;
  }
}

const d = new Dog("Rex");
console.log(d.speak());`,
  },
  {
    name: "べき乗演算子 (**)",
    boundary: "ES2015 ↔ ES2016",
    code: `const base = 2;
const exponent = 10;
const result = base ** exponent;
console.log(\`\${base} ** \${exponent} = \${result}\`);

const area = 3.14 * radius ** 2;
const volume = (4 / 3) * 3.14 * radius ** 3;`,
  },
  {
    name: "async / await",
    boundary: "ES2016 ↔ ES2017",
    code: `async function fetchUser(id: number) {
  const response = await fetch(\`/api/users/\${id}\`);
  const data = await response.json();
  return data;
}

async function main() {
  const user = await fetchUser(1);
  console.log(user.name);
}

main();`,
  },
  {
    name: "optional chaining + nullish coalescing",
    boundary: "ES2019 ↔ ES2020",
    code: `const user = getUser();

const street = user?.address?.street;
const city = user?.address?.city ?? "Unknown";
const zip = user?.address?.zip ?? "00000";

const name = user?.name ?? "Anonymous";
const len = user?.friends?.length ?? 0;

console.log(name, street, city, zip, len);`,
  },
  {
    name: "論理代入演算子 (??=, ||=, &&=)",
    boundary: "ES2020 ↔ ES2021",
    code: `let config = getConfig();

config.host ??= "localhost";
config.port ??= 3000;
config.debug ||= false;
config.verbose &&= config.debug;

console.log(config);`,
  },
  {
    name: "クラスフィールド + #private",
    boundary: "ES2021 ↔ ES2022",
    code: `class Counter {
  count = 0;
  #max = 100;

  constructor(initial: number) {
    this.count = initial;
  }

  increment() {
    if (this.#max > this.count) {
      this.count++;
    }
  }

  getMax() {
    return this.#max;
  }
}

const c = new Counter(0);
c.increment();`,
  },
  {
    name: "総合: 全機能を含む複合例",
    boundary: "ES3 → ESNext",
    code: `class UserService {
  #baseUrl = "/api";
  timeout = 5000;

  async getUser(id: number) {
    const url = \`\${this.#baseUrl}/users/\${id}\`;
    const res = await fetch(url);
    return res.json();
  }
}

const svc = new UserService();

const user = await svc.getUser(1);
const name = user?.name ?? "Anonymous";
const score = user?.stats?.score ?? 0;
const level = 2 ** score;

let config = {};
config.retry ??= 3;
config.verbose ||= false;

const greet = (who: string = name) => \`Hello, \${who}!\`;
console.log(greet());`,
  },
];

/** ターゲットに対応するアクセントカラー */
function targetColor(target: ESTarget): string {
  const idx = ALL_TARGETS.findIndex((t) => t.value === target);
  const hue = (idx / ALL_TARGETS.length) * 300;
  return `hsl(${hue}, 70%, 65%)`;
}

export class EsTargetApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "ES Target Transpiler";
    title.style.cssText = "margin:0;font-size:15px;color:#fbbf24;";
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

    // ターゲット選択
    const targetSelect = document.createElement("select");
    targetSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;font-weight:600;";
    for (const t of ALL_TARGETS) {
      const opt = document.createElement("option");
      opt.value = t.value;
      opt.textContent = `${t.label} (${t.year})`;
      targetSelect.appendChild(opt);
    }
    targetSelect.value = "es5";
    header.appendChild(targetSelect);

    // Transpile ボタン
    const transpileBtn = document.createElement("button");
    transpileBtn.textContent = "Transpile";
    transpileBtn.style.cssText =
      "padding:4px 16px;background:#fbbf24;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(transpileBtn);

    // 全ターゲット比較ボタン
    const compareBtn = document.createElement("button");
    compareBtn.textContent = "全ターゲット比較";
    compareBtn.style.cssText =
      "padding:4px 12px;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:4px;cursor:pointer;font-size:11px;";
    header.appendChild(compareBtn);

    container.appendChild(header);

    // ── メインパネル ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: TypeScript ソース
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const tsLabel = document.createElement("div");
    tsLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#3178c6;border-bottom:1px solid #1e293b;";
    tsLabel.textContent = "TypeScript (入力)";
    leftPanel.appendChild(tsLabel);

    const tsArea = document.createElement("textarea");
    tsArea.style.cssText =
      "flex:1;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;line-height:1.6;";
    tsArea.spellcheck = false;
    tsArea.value = EXAMPLES[0]!.code;
    leftPanel.appendChild(tsArea);
    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // 出力ラベル
    const jsLabel = document.createElement("div");
    jsLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;";
    const jsLabelText = document.createElement("span");
    jsLabelText.textContent = "JavaScript (出力)";
    jsLabelText.style.color = "#fbbf24";
    jsLabel.appendChild(jsLabelText);
    const targetTag = document.createElement("span");
    targetTag.style.cssText = "padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;";
    jsLabel.appendChild(targetTag);
    rightPanel.appendChild(jsLabel);

    // 出力エリア
    const jsArea = document.createElement("textarea");
    jsArea.style.cssText =
      "flex:1;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#a5f3fc;border:none;outline:none;resize:none;tab-size:2;line-height:1.6;";
    jsArea.readOnly = true;
    jsArea.spellcheck = false;
    rightPanel.appendChild(jsArea);

    // 変換情報パネル
    const infoDiv = document.createElement("div");
    infoDiv.style.cssText =
      "padding:8px 12px;font-size:11px;color:#94a3b8;border-top:1px solid #1e293b;line-height:1.6;max-height:120px;overflow-y:auto;";
    rightPanel.appendChild(infoDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 比較パネル（非表示で待機） ──
    const comparePanel = document.createElement("div");
    comparePanel.style.cssText = "display:none;flex:1;overflow-y:auto;";
    container.appendChild(comparePanel);
    let compareMode = false;

    // ── ロジック ──
    const doTranspile = () => {
      const target = targetSelect.value as ESTarget;
      const result = transpile(tsArea.value, target);
      jsArea.value = result.code;
      renderInfo(result, target);
    };

    const renderInfo = (result: TranspileResult, target: ESTarget) => {
      const color = targetColor(target);
      const label = ALL_TARGETS.find((t) => t.value === target)?.label ?? target;
      targetTag.textContent = label;
      targetTag.style.cssText = `padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44;`;
      jsLabelText.style.color = color;

      infoDiv.innerHTML = "";
      if (result.appliedPasses.length > 0) {
        const passTitle = document.createElement("div");
        passTitle.style.cssText = "color:#fbbf24;font-weight:600;margin-bottom:2px;";
        passTitle.textContent = `適用された変換 (${result.appliedPasses.length}):`;
        infoDiv.appendChild(passTitle);
        for (const pass of result.appliedPasses) {
          const item = document.createElement("div");
          item.style.cssText = "padding-left:8px;";
          item.textContent = `\u2192 ${pass}`;
          infoDiv.appendChild(item);
        }
      }
      if (result.downleveledFeatures.length > 0) {
        const dlTitle = document.createElement("div");
        dlTitle.style.cssText = "color:#f87171;font-weight:600;margin-top:4px;margin-bottom:2px;";
        dlTitle.textContent = "ダウンレベル:";
        infoDiv.appendChild(dlTitle);
        const dlText = document.createElement("div");
        dlText.style.paddingLeft = "8px";
        dlText.textContent = result.downleveledFeatures.join(", ");
        infoDiv.appendChild(dlText);
      }
      if (result.nativeFeatures.length > 0) {
        const nTitle = document.createElement("div");
        nTitle.style.cssText = "color:#10b981;font-weight:600;margin-top:4px;margin-bottom:2px;";
        nTitle.textContent = "ネイティブサポート:";
        infoDiv.appendChild(nTitle);
        const nText = document.createElement("div");
        nText.style.paddingLeft = "8px";
        nText.textContent = result.nativeFeatures.join(", ");
        infoDiv.appendChild(nText);
      }
    };

    const showCompare = () => {
      comparePanel.innerHTML = "";
      const grid = document.createElement("div");
      grid.style.cssText = "display:flex;flex-wrap:wrap;gap:0;";

      for (const t of ALL_TARGETS) {
        const result = transpile(tsArea.value, t.value);
        const card = document.createElement("div");
        const color = targetColor(t.value);
        card.style.cssText = "flex:1;min-width:280px;border-right:1px solid #1e293b;border-bottom:1px solid #1e293b;display:flex;flex-direction:column;";

        const cardHeader = document.createElement("div");
        cardHeader.style.cssText = `padding:4px 10px;font-size:11px;font-weight:600;color:${color};border-bottom:1px solid #1e293b;background:#0f172a;display:flex;justify-content:space-between;`;

        const labelSpan = document.createElement("span");
        labelSpan.textContent = `${t.label} (${t.year})`;
        cardHeader.appendChild(labelSpan);

        const passCount = document.createElement("span");
        passCount.style.cssText = "font-size:9px;color:#64748b;";
        passCount.textContent = `${result.appliedPasses.length} passes`;
        cardHeader.appendChild(passCount);

        card.appendChild(cardHeader);

        const pre = document.createElement("pre");
        pre.style.cssText =
          "flex:1;padding:8px 10px;font-family:inherit;font-size:10px;color:#cbd5e1;overflow:auto;white-space:pre;margin:0;background:#0f172a;line-height:1.5;min-height:200px;max-height:400px;";
        pre.textContent = result.code;
        card.appendChild(pre);

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
        compareBtn.style.background = "#fbbf24";
        compareBtn.style.color = "#0f172a";
        showCompare();
      } else {
        main.style.display = "flex";
        comparePanel.style.display = "none";
        compareBtn.textContent = "全ターゲット比較";
        compareBtn.style.background = "#334155";
        compareBtn.style.color = "#94a3b8";
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
    targetSelect.addEventListener("change", doTranspile);
    transpileBtn.addEventListener("click", () => {
      doTranspile();
      if (compareMode) showCompare();
    });
    compareBtn.addEventListener("click", toggleCompare);

    // 初期表示
    doTranspile();
  }
}
