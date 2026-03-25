/**
 * tokenizer.ts — SQL → トークン列
 *
 * SQL 文字列を1文字ずつ走査し、Token の配列に分割する（字句解析）。
 * トークナイザは SQL の「意味」は理解せず、文字パターンだけで分割する。
 * 意味の解析（構文解析）は parser.ts が担当する。
 *
 * 処理の流れ:
 *   "SELECT * FROM users WHERE id = 1"
 *   → [SELECT, *, FROM, users, WHERE, id, =, 1, EOF]
 */
import { KEYWORDS, TokenKind, type Token } from "./token-types.js";

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < sql.length) {
    // 空白文字（スペース、タブ、改行）はスキップ
    if (/\s/.test(sql[pos] ?? "")) {
      pos++;
      continue;
    }

    // 行コメント: "--" から行末まで無視
    if (sql[pos] === "-" && sql[pos + 1] === "-") {
      while (pos < sql.length && sql[pos] !== "\n") pos++;
      continue;
    }

    const start = pos;
    const ch = sql[pos] ?? "";

    // 文字列リテラル: シングルクォートで囲まれた部分を切り出す
    // SQL では '' でシングルクォートをエスケープする（例: 'it''s' → it's）
    if (ch === "'") {
      pos++;
      let value = "";
      while (pos < sql.length) {
        if (sql[pos] === "'") {
          if (sql[pos + 1] === "'") {
            // 連続するシングルクォート → エスケープ
            value += "'";
            pos += 2;
          } else {
            // 閉じクォート
            pos++;
            break;
          }
        } else {
          value += sql[pos];
          pos++;
        }
      }
      tokens.push({ kind: TokenKind.String, value, position: start });
      continue;
    }

    // 数値リテラル: 整数部.小数部（小数部はオプション）
    // ".5" のように小数点から始まるパターンもサポート
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[pos + 1] ?? ""))) {
      while (pos < sql.length && /[0-9]/.test(sql[pos] ?? "")) pos++;
      if (pos < sql.length && sql[pos] === ".") {
        pos++;
        while (pos < sql.length && /[0-9]/.test(sql[pos] ?? "")) pos++;
      }
      tokens.push({ kind: TokenKind.Number, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 識別子 / キーワード: 英字またはアンダースコアで始まる
    // 読み取った後に KEYWORDS マップで予約語かどうかを判定する
    if (/[a-zA-Z_]/.test(ch)) {
      while (pos < sql.length && /[a-zA-Z0-9_]/.test(sql[pos] ?? "")) pos++;
      const word = sql.slice(start, pos);
      const keyword = KEYWORDS.get(word.toUpperCase());
      if (keyword !== undefined) {
        tokens.push({ kind: keyword, value: word, position: start });
      } else {
        tokens.push({ kind: TokenKind.Identifier, value: word, position: start });
      }
      continue;
    }

    // 2文字の記号: 1文字記号より先にチェックする（ "<=" を "<" + "=" に誤分割しないため）
    const two = sql.slice(pos, pos + 2);
    if (two === "!=") { tokens.push({ kind: TokenKind.Neq, value: two, position: start }); pos += 2; continue; }
    if (two === "<>") { tokens.push({ kind: TokenKind.Neq, value: two, position: start }); pos += 2; continue; }
    if (two === "<=") { tokens.push({ kind: TokenKind.Lte, value: two, position: start }); pos += 2; continue; }
    if (two === ">=") { tokens.push({ kind: TokenKind.Gte, value: two, position: start }); pos += 2; continue; }
    if (two === "||") { tokens.push({ kind: TokenKind.Concat, value: two, position: start }); pos += 2; continue; }

    // 1文字の記号
    const singleCharMap: Record<string, TokenKind | undefined> = {
      "(": TokenKind.LeftParen,
      ")": TokenKind.RightParen,
      ",": TokenKind.Comma,
      ";": TokenKind.Semicolon,
      ".": TokenKind.Dot,
      "*": TokenKind.Star,
      "+": TokenKind.Plus,
      "-": TokenKind.Minus,
      "/": TokenKind.Slash,
      "%": TokenKind.Percent,
      "=": TokenKind.Eq,
      "<": TokenKind.Lt,
      ">": TokenKind.Gt,
    };
    const singleKind = singleCharMap[ch];
    if (singleKind !== undefined) {
      tokens.push({ kind: singleKind, value: ch, position: start });
      pos++;
      continue;
    }

    throw new Error(`予期しない文字: '${ch}' (位置 ${pos})`);
  }

  // 入力終端を示す番兵トークンを追加（パーサーが EOF 判定に使う）
  tokens.push({ kind: TokenKind.Eof, value: "", position: pos });
  return tokens;
}
