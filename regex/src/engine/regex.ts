/**
 * regex.ts — 正規表現エンジン
 *
 * パイプライン:
 *   パターン文字列 → パーサー (AST) → Thompson's construction (NFA) →
 *   NFA シミュレーション (ε-closure) → マッチ結果
 *
 * 対応構文:
 *   リテラル, . (任意), | (選択), * (0回以上), + (1回以上),
 *   ? (0 or 1回), () グループ, [] 文字クラス, ^ $, \d \w \s
 */

// ── AST ──

/**
 * 正規表現の抽象構文木（AST）を表す共用体型。
 * パーサーがパターン文字列を解析して生成するノードの型定義。
 *
 * - literal: 単一文字リテラル
 * - dot: 任意の1文字にマッチ（.）
 * - charClass: 文字クラス（[a-z] など）
 * - concat: 連結（左右のノードを順番にマッチ）
 * - alt: 選択（|）
 * - star: 0回以上の繰り返し（*）
 * - plus: 1回以上の繰り返し（+）
 * - question: 0回または1回（?）
 * - group: グループ化（()）
 * - anchor: アンカー（^ または $）
 * - empty: 空ノード
 */
export type AstNode =
  | { type: "literal"; char: string }
  | { type: "dot" }
  | { type: "charClass"; chars: string[]; negated: boolean }
  | { type: "concat"; left: AstNode; right: AstNode }
  | { type: "alt"; left: AstNode; right: AstNode }
  | { type: "star"; child: AstNode }
  | { type: "plus"; child: AstNode }
  | { type: "question"; child: AstNode }
  | { type: "group"; child: AstNode; index: number }
  | { type: "anchor"; which: "^" | "$" }
  | { type: "empty" };

// ── NFA ──

/**
 * NFA（非決定性有限オートマトン）の個々の状態を表すインターフェース。
 * 各状態はε遷移、文字遷移、述語遷移を持つことができる。
 */
export interface NfaState {
  id: number;
  label: string;
  /** ε 遷移先 */
  epsilon: number[];
  /** 文字遷移: char → 遷移先 state ID */
  transitions: Map<string, number>;
  /** 文字クラス判定関数 */
  predicate?: (ch: string) => boolean;
  predicateLabel?: string;
  /** グループ開始/終了マーカー */
  groupStart?: number;
  groupEnd?: number;
}

/**
 * NFA全体を表すインターフェース。
 * 状態の配列と、開始状態・受理状態のIDを保持する。
 */
export interface Nfa {
  /** 全状態の配列 */
  states: NfaState[];
  /** 開始状態のID */
  start: number;
  /** 受理状態のID */
  accept: number;
}

// ── マッチトレース ──

/**
 * NFAシミュレーションの1ステップを表すインターフェース。
 * シミュレーションの各段階（初期化、ε閉包計算、文字遷移、受理/拒否）を記録する。
 */
export interface MatchStep {
  /** 現在のアクティブ状態集合 */
  activeStates: number[];
  /** 読んだ文字 */
  char: string | null;
  /** 入力位置 */
  pos: number;
  phase: "start" | "epsilon_closure" | "char_advance" | "accept" | "reject";
  detail: string;
}

/**
 * NFAシミュレーションの最終結果を表すインターフェース。
 * マッチの成否、マッチしたテキスト、シミュレーションの全ステップ、訪問した状態数を保持する。
 */
export interface MatchResult {
  /** マッチが成功したかどうか */
  matched: boolean;
  /** マッチした文字列（不一致の場合は空文字列） */
  matchedText: string;
  /** シミュレーションの全ステップ */
  steps: MatchStep[];
  /** 訪問した状態の総数 */
  statesVisited: number;
}

// ── パーサー ──

/** グループのインデックスカウンター（パース時にリセットされる） */
let groupCounter = 0;

/**
 * 正規表現パターン文字列をパースしてASTを生成する。
 * 再帰下降パーサーを使用し、演算子の優先順位を正しく処理する。
 * 優先順位: 選択(|) < 連結 < 量指定子(*, +, ?)
 *
 * @param pattern - パースする正規表現パターン文字列
 * @returns パースされたASTのルートノード
 */
export function parse(pattern: string): AstNode {
  groupCounter = 0;
  let pos = 0;

  /** 選択（|）をパースする。最も低い優先順位の演算子。 */
  function parseAlt(): AstNode {
    let left = parseConcat();
    while (pos < pattern.length && pattern[pos] === "|") {
      pos++;
      const right = parseConcat();
      left = { type: "alt", left, right };
    }
    return left;
  }

  /** 連結をパースする。アトムを左から右へ順に結合する。 */
  function parseConcat(): AstNode {
    let node: AstNode = { type: "empty" };
    while (pos < pattern.length && pattern[pos] !== ")" && pattern[pos] !== "|") {
      const atom = parseQuantifier();
      node = node.type === "empty" ? atom : { type: "concat", left: node, right: atom };
    }
    return node;
  }

  /** 量指定子（*, +, ?）をパースする。アトムの後に付く繰り返し演算子を処理。 */
  function parseQuantifier(): AstNode {
    let atom = parseAtom();
    if (pos < pattern.length) {
      if (pattern[pos] === "*") { pos++; atom = { type: "star", child: atom }; }
      else if (pattern[pos] === "+") { pos++; atom = { type: "plus", child: atom }; }
      else if (pattern[pos] === "?") { pos++; atom = { type: "question", child: atom }; }
    }
    return atom;
  }

  /** アトム（基本要素）をパースする。リテラル、グループ、文字クラス、ドット、アンカー、エスケープシーケンスを処理。 */
  function parseAtom(): AstNode {
    if (pos >= pattern.length) return { type: "empty" };
    const ch = pattern[pos]!;

    if (ch === "(") {
      pos++;
      const index = ++groupCounter;
      const child = parseAlt();
      if (pos < pattern.length && pattern[pos] === ")") pos++;
      return { type: "group", child, index };
    }

    if (ch === "[") {
      return parseCharClass();
    }

    if (ch === ".") { pos++; return { type: "dot" }; }
    if (ch === "^") { pos++; return { type: "anchor", which: "^" }; }
    if (ch === "$") { pos++; return { type: "anchor", which: "$" }; }

    if (ch === "\\") {
      pos++;
      const next = pattern[pos];
      pos++;
      if (next === "d") return { type: "charClass", chars: ["0","1","2","3","4","5","6","7","8","9"], negated: false };
      if (next === "w") return { type: "charClass", chars: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split(""), negated: false };
      if (next === "s") return { type: "charClass", chars: [" ", "\t", "\n", "\r"], negated: false };
      if (next === "D") return { type: "charClass", chars: ["0","1","2","3","4","5","6","7","8","9"], negated: true };
      return { type: "literal", char: next ?? "\\" };
    }

    pos++;
    return { type: "literal", char: ch };
  }

  /** 文字クラス（[a-z]、[^0-9] など）をパースする。範囲指定（a-z）と否定（^）に対応。 */
  function parseCharClass(): AstNode {
    pos++; // skip [
    let negated = false;
    if (pos < pattern.length && pattern[pos] === "^") { negated = true; pos++; }
    const chars: string[] = [];
    while (pos < pattern.length && pattern[pos] !== "]") {
      if (pos + 2 < pattern.length && pattern[pos + 1] === "-") {
        const from = pattern[pos]!.charCodeAt(0);
        const to = pattern[pos + 2]!.charCodeAt(0);
        for (let c = from; c <= to; c++) chars.push(String.fromCharCode(c));
        pos += 3;
      } else {
        chars.push(pattern[pos]!);
        pos++;
      }
    }
    if (pos < pattern.length) pos++; // skip ]
    return { type: "charClass", chars, negated };
  }

  return parseAlt();
}

// ── Thompson's NFA 構築 ──

/** NFA状態のIDカウンター（NFA構築時にリセットされる） */
let stateCounter = 0;

/**
 * 新しいNFA状態を生成する。
 * @param label - 状態の表示ラベル（デバッグ・可視化用）
 * @returns 新しいNfaStateオブジェクト
 */
function newState(label: string): NfaState {
  return { id: stateCounter++, label, epsilon: [], transitions: new Map() };
}

/**
 * ASTからThompsonの構成法を用いてNFAを構築する。
 * 各ASTノードをNFAフラグメントに変換し、それらを結合して完全なNFAを生成する。
 *
 * @param ast - 変換対象のASTルートノード
 * @returns 構築されたNFA
 */
export function buildNfa(ast: AstNode): Nfa {
  stateCounter = 0;
  const { start, accept, states } = buildFragment(ast);
  return { states, start: start.id, accept: accept.id };
}

/**
 * 単一のASTノードからNFAフラグメント（開始状態、受理状態、全状態の配列）を構築する。
 * Thompsonの構成法に基づき、各ノードタイプに応じたNFA構造を再帰的に生成する。
 *
 * @param node - 変換対象のASTノード
 * @returns 開始状態、受理状態、全状態を含むNFAフラグメント
 */
function buildFragment(node: AstNode): { start: NfaState; accept: NfaState; states: NfaState[] } {
  switch (node.type) {
    case "empty": {
      const s = newState("ε");
      const a = newState("accept");
      s.epsilon.push(a.id);
      return { start: s, accept: a, states: [s, a] };
    }
    case "literal": {
      const s = newState(`'${node.char}'`);
      const a = newState("");
      s.transitions.set(node.char, a.id);
      return { start: s, accept: a, states: [s, a] };
    }
    case "dot": {
      const s = newState(".");
      const a = newState("");
      s.predicate = () => true;
      s.predicateLabel = ".";
      return { start: s, accept: a, states: [s, a] };
    }
    case "charClass": {
      const s = newState(node.negated ? `[^...]` : `[...]`);
      const a = newState("");
      const set = new Set(node.chars);
      s.predicate = node.negated ? (ch) => !set.has(ch) : (ch) => set.has(ch);
      s.predicateLabel = node.negated ? `[^${summarizeChars(node.chars)}]` : `[${summarizeChars(node.chars)}]`;
      return { start: s, accept: a, states: [s, a] };
    }
    case "concat": {
      const left = buildFragment(node.left);
      const right = buildFragment(node.right);
      left.accept.epsilon.push(right.start.id);
      return { start: left.start, accept: right.accept, states: [...left.states, ...right.states] };
    }
    case "alt": {
      const s = newState("alt");
      const a = newState("");
      const left = buildFragment(node.left);
      const right = buildFragment(node.right);
      s.epsilon.push(left.start.id, right.start.id);
      left.accept.epsilon.push(a.id);
      right.accept.epsilon.push(a.id);
      return { start: s, accept: a, states: [s, ...left.states, ...right.states, a] };
    }
    case "star": {
      const s = newState("*");
      const a = newState("");
      const child = buildFragment(node.child);
      s.epsilon.push(child.start.id, a.id);
      child.accept.epsilon.push(child.start.id, a.id);
      return { start: s, accept: a, states: [s, ...child.states, a] };
    }
    case "plus": {
      const s = newState("+");
      const a = newState("");
      const child = buildFragment(node.child);
      s.epsilon.push(child.start.id);
      child.accept.epsilon.push(child.start.id, a.id);
      return { start: s, accept: a, states: [s, ...child.states, a] };
    }
    case "question": {
      const s = newState("?");
      const a = newState("");
      const child = buildFragment(node.child);
      s.epsilon.push(child.start.id, a.id);
      child.accept.epsilon.push(a.id);
      return { start: s, accept: a, states: [s, ...child.states, a] };
    }
    case "group": {
      const child = buildFragment(node.child);
      child.start.groupStart = node.index;
      child.accept.groupEnd = node.index;
      return child;
    }
    case "anchor": {
      const s = newState(node.which);
      const a = newState("");
      s.epsilon.push(a.id);
      return { start: s, accept: a, states: [s, a] };
    }
  }
}

/**
 * 文字配列を表示用に要約する。
 * 6文字以下ならそのまま結合し、それ以上なら先頭2文字と末尾1文字で省略表記にする。
 *
 * @param chars - 要約対象の文字配列
 * @returns 要約された文字列
 */
function summarizeChars(chars: string[]): string {
  if (chars.length <= 6) return chars.join("");
  return `${chars[0]}${chars[1]}...${chars[chars.length - 1]}`;
}

// ── NFA シミュレーション (ε-closure ベース) ──

/**
 * NFAを使って入力文字列のマッチングをシミュレーションする。
 * ε閉包ベースのNFAシミュレーションアルゴリズムを使用し、
 * 各ステップのトレース情報を記録しながら実行する。
 *
 * @param nfa - シミュレーション対象のNFA
 * @param input - マッチング対象の入力文字列
 * @returns マッチ結果（成否、ステップトレース、訪問状態数を含む）
 */
export function simulateNfa(nfa: Nfa, input: string): MatchResult {
  const steps: MatchStep[] = [];
  let statesVisited = 0;

  /**
   * 与えられた状態集合のε閉包を計算する。
   * スタックベースの探索で、ε遷移で到達可能な全状態を収集する。
   *
   * @param stateIds - 起点となる状態IDの集合
   * @returns ε閉包（ε遷移で到達可能な全状態のID集合）
   */
  function epsilonClosure(stateIds: Set<number>): Set<number> {
    const stack = [...stateIds];
    const closure = new Set(stateIds);
    while (stack.length > 0) {
      const sid = stack.pop()!;
      const state = nfa.states.find((s) => s.id === sid);
      if (state === undefined) continue;
      for (const eid of state.epsilon) {
        if (!closure.has(eid)) {
          closure.add(eid);
          stack.push(eid);
        }
      }
    }
    return closure;
  }

  // 初期状態
  let current = epsilonClosure(new Set([nfa.start]));
  statesVisited += current.size;

  steps.push({
    activeStates: [...current], char: null, pos: 0,
    phase: "start",
    detail: `初期状態: {${[...current].join(",")}} (ε-closure)`,
  });

  // 各文字を読み進める
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    // 文字遷移
    const next = new Set<number>();
    for (const sid of current) {
      const state = nfa.states.find((s) => s.id === sid);
      if (state === undefined) continue;

      // 直接遷移
      const target = state.transitions.get(ch);
      if (target !== undefined) next.add(target);

      // predicate 遷移 (., [a-z] 等)
      if (state.predicate !== undefined && state.predicate(ch)) {
        // predicate を持つ状態は accept 状態への遷移を探す
        // NFA 構築で predicate 状態の次の状態を見つける
        for (const s2 of nfa.states) {
          if (state.transitions.has(ch) || state.epsilon.includes(s2.id)) continue;
        }
        // predicate マッチ: id+1 が accept (構築の慣例)
        const nextId = state.id + 1;
        if (nfa.states.some((s) => s.id === nextId)) next.add(nextId);
      }
    }

    steps.push({
      activeStates: [...next], char: ch, pos: i,
      phase: "char_advance",
      detail: `'${ch}' (pos=${i}): {${[...current].join(",")}} → {${[...next].join(",")}}`,
    });

    // ε-closure
    current = epsilonClosure(next);
    statesVisited += current.size;

    steps.push({
      activeStates: [...current], char: null, pos: i + 1,
      phase: "epsilon_closure",
      detail: `ε-closure: {${[...current].join(",")}}`,
    });

    if (current.size === 0) {
      steps.push({
        activeStates: [], char: null, pos: i + 1,
        phase: "reject",
        detail: `アクティブ状態が空 → 不一致 (pos=${i + 1})`,
      });
      return { matched: false, matchedText: "", steps, statesVisited };
    }
  }

  // 受理判定
  const matched = current.has(nfa.accept);
  steps.push({
    activeStates: [...current], char: null, pos: input.length,
    phase: matched ? "accept" : "reject",
    detail: matched
      ? `受理状態 ${nfa.accept} がアクティブ → マッチ成功!`
      : `受理状態 ${nfa.accept} がアクティブでない → 不一致`,
  });

  return {
    matched,
    matchedText: matched ? input : "",
    steps,
    statesVisited,
  };
}

// ── AST を文字列に変換 (デバッグ用) ──

/**
 * ASTをインデント付きの文字列表現に変換する（デバッグ・可視化用）。
 * 再帰的にノードを走査し、ツリー構造を読みやすい文字列にフォーマットする。
 *
 * @param node - 文字列化するASTノード
 * @param depth - 現在のインデント深さ（デフォルト: 0）
 * @returns ASTのインデント付き文字列表現
 */
export function astToString(node: AstNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  switch (node.type) {
    case "literal": return `${indent}Literal '${node.char}'`;
    case "dot": return `${indent}Dot (.)`;
    case "charClass": return `${indent}CharClass ${node.negated ? "[^" : "["}${summarizeChars(node.chars)}]`;
    case "concat": return `${indent}Concat\n${astToString(node.left, depth + 1)}\n${astToString(node.right, depth + 1)}`;
    case "alt": return `${indent}Alt (|)\n${astToString(node.left, depth + 1)}\n${astToString(node.right, depth + 1)}`;
    case "star": return `${indent}Star (*)\n${astToString(node.child, depth + 1)}`;
    case "plus": return `${indent}Plus (+)\n${astToString(node.child, depth + 1)}`;
    case "question": return `${indent}Question (?)\n${astToString(node.child, depth + 1)}`;
    case "group": return `${indent}Group (${node.index})\n${astToString(node.child, depth + 1)}`;
    case "anchor": return `${indent}Anchor ${node.which}`;
    case "empty": return `${indent}Empty`;
  }
}
