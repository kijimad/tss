import { parse, buildNfa, simulateNfa, astToString } from "../engine/regex.js";
import type { Nfa, MatchResult, MatchStep } from "../engine/regex.js";

export interface Example {
  name: string;
  description: string;
  pattern: string;
  inputs: string[];
}

export const EXAMPLES: Example[] = [
  {
    name: "リテラルマッチ",
    description: "単純な文字列マッチ。NFA の状態遷移が 1 対 1 で対応。",
    pattern: "abc",
    inputs: ["abc", "ab", "abcd", "xabc", ""],
  },
  {
    name: "選択 (|)",
    description: "cat|dog — NFA が分岐して並行探索。",
    pattern: "cat|dog",
    inputs: ["cat", "dog", "cats", "do", "catdog"],
  },
  {
    name: "繰り返し (* + ?)",
    description: "ab*c — b が 0 回以上。ε 遷移でループ構造が作られる。",
    pattern: "ab*c",
    inputs: ["ac", "abc", "abbc", "abbbc", "adc"],
  },
  {
    name: "ドット (.) 任意文字",
    description: "a.c — 真ん中が任意の 1 文字。predicate 遷移。",
    pattern: "a.c",
    inputs: ["abc", "axc", "a1c", "ac", "abbc"],
  },
  {
    name: "文字クラス [a-z]",
    description: "[0-9]+ — 1 文字以上の数字列。文字クラスの NFA 構築を確認。",
    pattern: "[0-9]+",
    inputs: ["123", "0", "abc", "12ab", ""],
  },
  {
    name: "グループと量指定子",
    description: "(ab)+c — ab の繰り返し + c。グループの NFA 構造。",
    pattern: "(ab)+c",
    inputs: ["abc", "ababc", "abababc", "ac", "ab"],
  },
  {
    name: "メールアドレス風",
    description: "\\w+@\\w+\\.\\w+ — 簡易メールアドレスパターン。\\w 文字クラスの展開。",
    pattern: "\\w+@\\w+\\.\\w+",
    inputs: ["user@example.com", "a@b.c", "user@", "@domain.com", "no-at-sign"],
  },
  {
    name: "複雑な選択と繰り返し",
    description: "(foo|bar)baz* — 選択 + 連結 + 繰り返しの組み合わせ。",
    pattern: "(foo|bar)baz*",
    inputs: ["fooba", "foobaz", "foobazzz", "barba", "barbazz", "baz"],
  },
];

function stepColor(phase: MatchStep["phase"]): string {
  switch (phase) {
    case "start":          return "#60a5fa";
    case "epsilon_closure": return "#a78bfa";
    case "char_advance":   return "#22c55e";
    case "accept":         return "#10b981";
    case "reject":         return "#ef4444";
  }
}

export class RegexApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Regex Engine Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run";
    runBtn.style.cssText = "padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: パターン + AST + NFA 状態
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const patLabel = document.createElement("div");
    patLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    patLabel.textContent = "Pattern & AST";
    leftPanel.appendChild(patLabel);
    const patDiv = document.createElement("div");
    patDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(patDiv);

    const nfaLabel = document.createElement("div");
    nfaLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    nfaLabel.textContent = "NFA States";
    leftPanel.appendChild(nfaLabel);
    const nfaDiv = document.createElement("div");
    nfaDiv.style.cssText = "flex:1;padding:8px 12px;overflow-y:auto;";
    leftPanel.appendChild(nfaDiv);
    main.appendChild(leftPanel);

    // 中央: マッチ結果一覧
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "Match Results";
    centerPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resDiv);
    main.appendChild(centerPanel);

    // 右: ステップトレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:420px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "NFA Simulation Trace (click a result)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderPattern = (pattern: string) => {
      patDiv.innerHTML = "";
      const patEl = document.createElement("div");
      patEl.style.cssText = "margin-bottom:6px;padding:6px 8px;background:#1e293b;border-radius:4px;font-size:14px;color:#f59e0b;font-weight:600;";
      patEl.textContent = `/${pattern}/`;
      patDiv.appendChild(patEl);

      const ast = parse(pattern);
      const astPre = document.createElement("pre");
      astPre.style.cssText = "color:#94a3b8;font-size:9px;margin:0;white-space:pre-wrap;line-height:1.4;";
      astPre.textContent = astToString(ast);
      patDiv.appendChild(astPre);
    };

    const renderNfa = (nfa: Nfa) => {
      nfaDiv.innerHTML = "";
      const info = document.createElement("div");
      info.style.cssText = "color:#64748b;margin-bottom:6px;";
      info.textContent = `${nfa.states.length} 状態, start=${nfa.start}, accept=${nfa.accept}`;
      nfaDiv.appendChild(info);

      for (const state of nfa.states) {
        const el = document.createElement("div");
        const isStart = state.id === nfa.start;
        const isAccept = state.id === nfa.accept;
        const border = isAccept ? "#10b981" : isStart ? "#f59e0b" : "#334155";
        el.style.cssText = `margin-bottom:3px;padding:3px 6px;border:1px solid ${border};border-radius:3px;background:${border}08;`;

        const tag = isStart ? " \u25B6" : isAccept ? " \u2714" : "";
        const eps = state.epsilon.length > 0 ? ` \u03b5\u2192{${state.epsilon.join(",")}}` : "";
        const trans = [...state.transitions.entries()].map(([ch, to]) => `'${ch}'\u2192${to}`).join(" ");
        const pred = state.predicateLabel ? ` ${state.predicateLabel}\u2192${state.id + 1}` : "";
        const label = state.label ? ` [${state.label}]` : "";

        el.innerHTML = `<span style="color:${border};font-weight:600;">S${state.id}${tag}</span>` +
          `<span style="color:#94a3b8;">${label}${eps} ${trans}${pred}</span>`;
        nfaDiv.appendChild(el);
      }
    };

    const renderResults = (results: { input: string; result: MatchResult }[]) => {
      resDiv.innerHTML = "";
      for (const { input, result } of results) {
        const el = document.createElement("div");
        const ok = result.matched;
        const border = ok ? "#22c55e" : "#ef4444";
        el.style.cssText = `padding:6px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;

        const inputDisplay = input === "" ? '""' : `"${input}"`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${inputDisplay}</span>` +
          `<span style="color:${border};font-weight:600;">${ok ? "\u2714 Match" : "\u2718 No match"}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;">${result.steps.length} ステップ, ${result.statesVisited} 状態訪問</div>`;

        el.addEventListener("click", () => renderTrace(result.steps, input));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (steps: MatchStep[], input: string) => {
      trDiv.innerHTML = "";

      // 入力文字列のハイライト表示
      const inputEl = document.createElement("div");
      inputEl.style.cssText = "margin-bottom:8px;padding:6px 8px;background:#1e293b;border-radius:4px;";
      inputEl.innerHTML = `<span style="color:#64748b;">入力:</span> <span style="color:#e2e8f0;font-size:13px;font-weight:600;">"${input}"</span>`;
      trDiv.appendChild(inputEl);

      for (const step of steps) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = stepColor(step.phase);

        const posTag = step.char !== null ? `<span style="color:#f59e0b;min-width:28px;">'${step.char}'</span>` : `<span style="min-width:28px;"></span>`;

        el.innerHTML =
          `<span style="min-width:75px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          posTag +
          `<span style="color:#64748b;min-width:55px;">{${step.activeStates.join(",")}}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderPattern(ex.pattern);
      resDiv.innerHTML = "";
      trDiv.innerHTML = "";
      nfaDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      renderPattern(ex.pattern);
      const ast = parse(ex.pattern);
      const nfa = buildNfa(ast);
      renderNfa(nfa);

      const results: { input: string; result: MatchResult }[] = [];
      for (const input of ex.inputs) {
        results.push({ input, result: simulateNfa(nfa, input) });
      }
      renderResults(results);
      if (results[0]) renderTrace(results[0].result.steps, results[0].input);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
