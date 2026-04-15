/**
 * parser.ts -- シェルコマンドパーサー
 *
 * bash のコマンドライン構文を解析する:
 *
 *   echo hello | grep h > out.txt 2>&1 && echo done ; echo next &
 *
 * パース結果:
 *   Pipeline [ echo hello, grep h ] > out.txt 2>&1
 *   && Pipeline [ echo done ]
 *   ; Pipeline [ echo next ] &
 *
 * 構文要素:
 *   - パイプ |         : 左の stdout を右の stdin に接続
 *   - リダイレクト > >> < : ファイルへの入出力
 *   - 2>&1             : stderr を stdout に統合
 *   - && ||            : 前のコマンドの成否で次を実行
 *   - ;                : コマンド区切り（順次実行）
 *   - &                : バックグラウンド実行
 *   - $VAR ${VAR}      : 変数展開
 *   - "..." '...'      : クォート
 *   - $(cmd) `cmd`     : コマンド置換
 */

/** トークンの型定義。レキサーが生成するすべてのトークン種別を表す */
export type Token =
  | { type: "word"; value: string }
  | { type: "pipe" }          // |
  | { type: "and" }           // &&
  | { type: "or" }            // ||
  | { type: "semi" }          // ;
  | { type: "bg" }            // &
  | { type: "redirect_out"; fd: number; append: boolean }  // > >>
  | { type: "redirect_in" }   // <
  | { type: "redirect_fd"; srcFd: number; dstFd: number } // 2>&1
  | { type: "eof" };

/** AST: 単純コマンドノード。引数・リダイレクト・バックグラウンド実行フラグを持つ */
export interface SimpleCommand {
  type: "simple";
  args: string[];           // ["echo", "hello"]
  redirects: Redirect[];
  background: boolean;
}

/** リダイレクト情報。入出力先のファイルとファイルディスクリプタを保持 */
export interface Redirect {
  type: "out" | "append" | "in";
  fd: number;               // 1=stdout, 2=stderr
  target: string;           // ファイル名
}

/** パイプラインノード。パイプ(|)で接続された一連のコマンドを表す */
export interface PipelineNode {
  type: "pipeline";
  commands: SimpleCommand[];
}

/** リストノード。セミコロンや&&、||で接続されたパイプラインの列を表す */
export interface ListNode {
  type: "list";
  pipelines: { pipeline: PipelineNode; operator: ";" | "&&" | "||" | "" }[];
}

/**
 * レキサー: 入力文字列をトークン列に分割する
 * @param input - シェルコマンドの入力文字列
 * @returns トークンの配列（末尾にeofトークンを含む）
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const src = input;

  while (pos < src.length) {
    const ch = src[pos] ?? "";
    if (ch === " " || ch === "\t") { pos++; continue; }

    // 2文字演算子
    const two = src.slice(pos, pos + 2);
    if (two === "&&") { tokens.push({ type: "and" }); pos += 2; continue; }
    if (two === "||") { tokens.push({ type: "or" }); pos += 2; continue; }
    if (two === ">>") { tokens.push({ type: "redirect_out", fd: 1, append: true }); pos += 2; continue; }

    // 2>&1 パターン
    if (/^\d>&\d/.test(src.slice(pos, pos + 4))) {
      const srcFd = Number(src[pos]);
      const dstFd = Number(src[pos + 3]);
      tokens.push({ type: "redirect_fd", srcFd, dstFd });
      pos += 4; continue;
    }

    // 1文字演算子
    if (ch === "|") { tokens.push({ type: "pipe" }); pos++; continue; }
    if (ch === ";") { tokens.push({ type: "semi" }); pos++; continue; }
    if (ch === "&") { tokens.push({ type: "bg" }); pos++; continue; }
    if (ch === ">") {
      // 2> パターン
      if (pos > 0 && src[pos - 1] === "2") {
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === "word" && lastToken.value === "2") {
          tokens.pop();
          tokens.push({ type: "redirect_out", fd: 2, append: false });
          pos++; continue;
        }
      }
      tokens.push({ type: "redirect_out", fd: 1, append: false }); pos++; continue;
    }
    if (ch === "<") { tokens.push({ type: "redirect_in" }); pos++; continue; }

    // クォート文字列
    if (ch === '"' || ch === "'") {
      const quote = ch; pos++;
      let value = "";
      while (pos < src.length && src[pos] !== quote) {
        if (src[pos] === "\\" && quote === '"') { pos++; value += src[pos] ?? ""; pos++; }
        else { value += src[pos] ?? ""; pos++; }
      }
      pos++; // 閉じクォート
      tokens.push({ type: "word", value });
      continue;
    }

    // $(...) コマンド置換
    if (ch === "$" && src[pos + 1] === "(") {
      pos += 2; let depth = 1; let cmd = "";
      while (pos < src.length && depth > 0) {
        if (src[pos] === "(") depth++;
        if (src[pos] === ")") { depth--; if (depth === 0) { pos++; break; } }
        cmd += src[pos]; pos++;
      }
      tokens.push({ type: "word", value: `$(${cmd})` });
      continue;
    }

    // バッククォート `cmd`
    if (ch === "`") {
      pos++; let cmd = "";
      while (pos < src.length && src[pos] !== "`") { cmd += src[pos] ?? ""; pos++; }
      pos++;
      tokens.push({ type: "word", value: `$(${cmd})` });
      continue;
    }

    // 通常の word
    let word = "";
    while (pos < src.length && !" \t|&;><\"'`".includes(src[pos] ?? "")) {
      word += src[pos]; pos++;
    }
    if (word.length > 0) tokens.push({ type: "word", value: word });
  }

  tokens.push({ type: "eof" });
  return tokens;
}

/**
 * パーサー: 入力文字列をAST（抽象構文木）に変換する
 * トークナイズ後、再帰下降パーサーでListNode → PipelineNode → SimpleCommandの階層構造を構築する
 * @param input - シェルコマンドの入力文字列
 * @returns パース結果のListNode（ASTのルートノード）
 */
export function parse(input: string): ListNode {
  const tokens = tokenize(input);
  let pos = 0;

  const peek = (): Token => tokens[pos] ?? { type: "eof" };
  const advance = (): Token => { const t = peek(); pos++; return t; };
  const is = (type: string): boolean => peek().type === type;

  const parseSimple = (): SimpleCommand => {
    const args: string[] = [];
    const redirects: Redirect[] = [];
    let background = false;

    while (!is("pipe") && !is("and") && !is("or") && !is("semi") && !is("bg") && !is("eof")) {
      const t = peek();
      if (t.type === "word") { args.push(t.value); advance(); }
      else if (t.type === "redirect_out") { advance(); const target = is("word") ? (advance() as { value: string }).value : ""; redirects.push({ type: t.append ? "append" : "out", fd: t.fd, target }); }
      else if (t.type === "redirect_in") { advance(); const target = is("word") ? (advance() as { value: string }).value : ""; redirects.push({ type: "in", fd: 0, target }); }
      else if (t.type === "redirect_fd") { advance(); }
      else break;
    }

    if (is("bg")) { background = true; advance(); }

    return { type: "simple", args, redirects, background };
  };

  const parsePipeline = (): PipelineNode => {
    const commands: SimpleCommand[] = [parseSimple()];
    while (is("pipe")) { advance(); commands.push(parseSimple()); }
    return { type: "pipeline", commands };
  };

  const parseList = (): ListNode => {
    const pipelines: { pipeline: PipelineNode; operator: ";" | "&&" | "||" | "" }[] = [];
    pipelines.push({ pipeline: parsePipeline(), operator: "" });
    while (is("and") || is("or") || is("semi")) {
      const op = peek().type === "and" ? "&&" : peek().type === "or" ? "||" : ";";
      advance();
      if (is("eof")) break;
      pipelines.push({ pipeline: parsePipeline(), operator: op as "&&" | "||" | ";" });
    }
    return { type: "list", pipelines };
  };

  return parseList();
}
