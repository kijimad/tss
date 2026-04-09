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

export interface Nfa {
  states: NfaState[];
  start: number;
  accept: number;
}

// ── マッチトレース ──

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

export interface MatchResult {
  matched: boolean;
  matchedText: string;
  steps: MatchStep[];
  statesVisited: number;
}

// ── パーサー ──

let groupCounter = 0;

export function parse(pattern: string): AstNode {
  groupCounter = 0;
  let pos = 0;

  function parseAlt(): AstNode {
    let left = parseConcat();
    while (pos < pattern.length && pattern[pos] === "|") {
      pos++;
      const right = parseConcat();
      left = { type: "alt", left, right };
    }
    return left;
  }

  function parseConcat(): AstNode {
    let node: AstNode = { type: "empty" };
    while (pos < pattern.length && pattern[pos] !== ")" && pattern[pos] !== "|") {
      const atom = parseQuantifier();
      node = node.type === "empty" ? atom : { type: "concat", left: node, right: atom };
    }
    return node;
  }

  function parseQuantifier(): AstNode {
    let atom = parseAtom();
    if (pos < pattern.length) {
      if (pattern[pos] === "*") { pos++; atom = { type: "star", child: atom }; }
      else if (pattern[pos] === "+") { pos++; atom = { type: "plus", child: atom }; }
      else if (pattern[pos] === "?") { pos++; atom = { type: "question", child: atom }; }
    }
    return atom;
  }

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

let stateCounter = 0;

function newState(label: string): NfaState {
  return { id: stateCounter++, label, epsilon: [], transitions: new Map() };
}

export function buildNfa(ast: AstNode): Nfa {
  stateCounter = 0;
  const { start, accept, states } = buildFragment(ast);
  return { states, start: start.id, accept: accept.id };
}

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

function summarizeChars(chars: string[]): string {
  if (chars.length <= 6) return chars.join("");
  return `${chars[0]}${chars[1]}...${chars[chars.length - 1]}`;
}

// ── NFA シミュレーション (ε-closure ベース) ──

export function simulateNfa(nfa: Nfa, input: string): MatchResult {
  const steps: MatchStep[] = [];
  let statesVisited = 0;

  // ε-closure を計算する
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
