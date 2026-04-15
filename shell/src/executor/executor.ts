/**
 * executor.ts -- シェル実行エンジン
 *
 * パースされた AST を実行する。実際のシェルの仕事:
 *
 *   1. 変数展開 ($HOME → /home/user)
 *   2. グロブ展開 (*.txt → a.txt b.txt)
 *   3. fork() でプロセス作成
 *   4. リダイレクト設定 (dup2)
 *   5. パイプ接続 (pipe + dup2)
 *   6. exec() でコマンド実行
 *   7. wait() で終了待ち
 *
 * ここでは fork/exec の代わりに関数呼び出しでシミュレートする。
 */
import { parse, type ListNode, type PipelineNode, type SimpleCommand } from "../parser/parser.js";

/** プロセス情報。シミュレートされたプロセスの状態と出力を保持する */
export interface Process {
  pid: number;
  command: string;
  state: "running" | "stopped" | "done";
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** ジョブ情報。バックグラウンド実行を含むプロセスグループを管理する */
export interface Job {
  id: number;
  processes: Process[];
  command: string;
  background: boolean;
  state: "running" | "stopped" | "done";
}

/** シェルイベント型。実行トレース表示用に各種操作を通知するための共用体型 */
export type ShellEvent =
  | { type: "parse"; ast: string }
  | { type: "expand"; original: string; expanded: string }
  | { type: "fork"; pid: number; command: string }
  | { type: "exec"; pid: number; command: string; args: string[] }
  | { type: "pipe"; fromPid: number; toPid: number }
  | { type: "redirect"; pid: number; fd: number; target: string; mode: string }
  | { type: "wait"; pid: number; exitCode: number }
  | { type: "builtin"; command: string }
  | { type: "signal"; signal: string; pid: number }
  | { type: "job"; action: string; jobId: number; command: string }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string };

/**
 * シェル実行エンジンクラス
 * 仮想ファイルシステム・環境変数・ジョブ管理を内蔵し、
 * パースされたASTを解釈実行する。fork/execの代わりに関数呼び出しでシミュレートする。
 */
export class ShellExecutor {
  // 環境変数
  env: Record<string, string> = {
    HOME: "/home/user", USER: "user", SHELL: "/bin/bash",
    PATH: "/usr/local/bin:/usr/bin:/bin", PWD: "/home/user",
    PS1: "\\u@\\h:\\w$ ", TERM: "xterm-256color",
    "?": "0", // 最後の終了コード
  };
  // 仮想ファイルシステム
  fs = new Map<string, string>([
    ["/etc/hostname", "shell-host"],
    ["/etc/passwd", "root:x:0:0::/root:/bin/bash\nuser:x:1000:1000::/home/user:/bin/bash"],
    ["/home/user/.bashrc", '# .bashrc\nalias ll="ls -la"\nalias grep="grep --color"'],
    ["/home/user/hello.txt", "Hello, Shell!"],
    ["/home/user/data.csv", "name,age\nAlice,30\nBob,25\nCharlie,35"],
    ["/home/user/script.sh", '#!/bin/bash\necho "Running script"\nfor i in 1 2 3; do\n  echo "Item $i"\ndone'],
    ["/home/user/numbers.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"],
    ["/tmp/.keep", ""],
  ]);
  // エイリアス
  aliases: Record<string, string> = { ll: "ls -la", la: "ls -a" };
  // ジョブテーブル
  jobs: Job[] = [];
  private nextPid = 1000;
  private nextJobId = 1;
  // コマンド履歴
  history: string[] = [];
  // 出力
  stdout = "";
  stderr = "";
  // イベント
  events: ShellEvent[] = [];
  onEvent: ((event: ShellEvent) => void) | undefined;

  /** イベントを記録し、登録されたリスナーに通知する */
  private emit(event: ShellEvent): void { this.events.push(event); this.onEvent?.(event); }

  /**
   * コマンド文字列を受け取り、エイリアス展開・パース・実行を行う
   * @param input - ユーザーが入力したコマンド文字列
   * @returns 標準出力に書き込まれた文字列
   */
  execute(input: string): string {
    this.stdout = ""; this.stderr = ""; this.events = [];
    if (input.trim().length === 0) return "";
    this.history.push(input);

    // エイリアス展開
    const expanded = this.expandAliases(input);

    // パース
    const ast = parse(expanded);
    this.emit({ type: "parse", ast: JSON.stringify(ast, null, 2).slice(0, 200) });

    // 実行
    this.executeList(ast);
    return this.stdout;
  }

  /** リストノードを実行する。&&/||の条件分岐と;の順次実行を処理する */
  private executeList(list: ListNode): void {
    let lastExitCode = 0;
    for (const item of list.pipelines) {
      // && : 前が成功(0)なら実行
      if (item.operator === "&&" && lastExitCode !== 0) continue;
      // || : 前が失敗(!0)なら実行
      if (item.operator === "||" && lastExitCode === 0) continue;

      lastExitCode = this.executePipeline(item.pipeline);
      this.env["?"] = String(lastExitCode);
    }
  }

  /** パイプラインを実行する。各コマンドのstdoutを次のコマンドのstdinに接続する */
  private executePipeline(pipeline: PipelineNode): number {
    if (pipeline.commands.length === 1) {
      const cmd = pipeline.commands[0];
      if (cmd === undefined) return 1;
      return this.executeSimple(cmd, undefined);
    }

    // パイプライン: 各コマンドの stdout を次の stdin に接続
    let prevOutput: string | undefined;
    let lastExitCode = 0;

    for (let i = 0; i < pipeline.commands.length; i++) {
      const cmd = pipeline.commands[i];
      if (cmd === undefined) continue;
      const isLast = i === pipeline.commands.length - 1;

      // fork + exec シミュレーション
      const pid = this.nextPid++;
      this.emit({ type: "fork", pid, command: cmd.args.join(" ") });
      if (i > 0) {
        this.emit({ type: "pipe", fromPid: pid - 1, toPid: pid });
      }

      const output = this.executeSimpleCapture(cmd, prevOutput);
      this.emit({ type: "wait", pid, exitCode: 0 });

      if (isLast) {
        // 最後のコマンドの出力を表示
        if (output.length > 0) {
          this.writeStdout(output);
        }
      }
      prevOutput = output;
    }

    return lastExitCode;
  }

  /** 単純コマンドを実行する。変数展開・リダイレクト処理・バックグラウンド実行を含む */
  private executeSimple(cmd: SimpleCommand, stdin: string | undefined): number {
    const args = cmd.args.map(a => this.expandVariables(a));
    if (args.length === 0) return 0;

    // リダイレクト
    let inputData = stdin;
    let outputFile: string | undefined;
    let appendMode = false;
    for (const r of cmd.redirects) {
      if (r.type === "in") { inputData = this.fs.get(this.resolvePath(r.target)) ?? ""; this.emit({ type: "redirect", pid: 0, fd: 0, target: r.target, mode: "in" }); }
      if (r.type === "out" || r.type === "append") { outputFile = r.target; appendMode = r.type === "append"; this.emit({ type: "redirect", pid: 0, fd: r.fd, target: r.target, mode: r.type }); }
    }

    const result = this.runCommand(args, inputData);

    if (outputFile !== undefined) {
      const path = this.resolvePath(outputFile);
      if (appendMode) {
        this.fs.set(path, (this.fs.get(path) ?? "") + result);
      } else {
        this.fs.set(path, result);
      }
    } else {
      if (result.length > 0) this.writeStdout(result);
    }

    // バックグラウンド
    if (cmd.background) {
      const jobId = this.nextJobId++;
      const job: Job = { id: jobId, processes: [{ pid: this.nextPid++, command: args.join(" "), state: "done", exitCode: 0, stdout: result, stderr: "" }], command: args.join(" "), background: true, state: "done" };
      this.jobs.push(job);
      this.emit({ type: "job", action: "start", jobId, command: args.join(" ") });
      this.writeStdout(`[${String(jobId)}] ${String(job.processes[0]?.pid ?? 0)}\n`);
    }

    return 0;
  }

  // キャプチャモード（パイプライン用）
  private executeSimpleCapture(cmd: SimpleCommand, stdin: string | undefined): string {
    const args = cmd.args.map(a => this.expandVariables(a));
    if (args.length === 0) return "";
    return this.runCommand(args, stdin);
  }

  // 組み込み + 外部コマンド実行
  private runCommand(args: string[], stdin: string | undefined): string {
    const cmd = args[0] ?? "";
    const rest = args.slice(1);

    // グロブ展開
    const expandedArgs = rest.flatMap(a => this.expandGlob(a));

    switch (cmd) {
      case "echo": return this.cmdEcho(expandedArgs);
      case "cat": return this.cmdCat(expandedArgs, stdin);
      case "ls": return this.cmdLs(expandedArgs);
      case "cd": return this.cmdCd(expandedArgs);
      case "pwd": return this.env["PWD"] + "\n";
      case "mkdir": { const p = this.resolvePath(expandedArgs[0] ?? ""); this.fs.set(p + "/.keep", ""); return ""; }
      case "touch": { const p = this.resolvePath(expandedArgs[0] ?? ""); if (!this.fs.has(p)) this.fs.set(p, ""); return ""; }
      case "rm": { this.fs.delete(this.resolvePath(expandedArgs[0] ?? "")); return ""; }
      case "cp": { const s = this.fs.get(this.resolvePath(expandedArgs[0] ?? "")); if (s !== undefined) this.fs.set(this.resolvePath(expandedArgs[1] ?? ""), s); return ""; }
      case "mv": { const s = this.fs.get(this.resolvePath(expandedArgs[0] ?? "")); if (s !== undefined) { this.fs.set(this.resolvePath(expandedArgs[1] ?? ""), s); this.fs.delete(this.resolvePath(expandedArgs[0] ?? "")); } return ""; }
      case "grep": return this.cmdGrep(expandedArgs, stdin);
      case "wc": return this.cmdWc(expandedArgs, stdin);
      case "head": return this.cmdHead(expandedArgs, stdin);
      case "tail": return this.cmdTail(expandedArgs, stdin);
      case "sort": return this.cmdSort(stdin);
      case "uniq": return this.cmdUniq(stdin);
      case "tr": return this.cmdTr(expandedArgs, stdin);
      case "cut": return this.cmdCut(expandedArgs, stdin);
      case "tee": return this.cmdTee(expandedArgs, stdin);
      case "seq": return this.cmdSeq(expandedArgs);
      case "whoami": return (this.env["USER"] ?? "user") + "\n";
      case "hostname": return (this.fs.get("/etc/hostname") ?? "host") + "\n";
      case "date": return new Date().toISOString() + "\n";
      case "env": return Object.entries(this.env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
      case "export": { const a = expandedArgs[0] ?? ""; const eq = a.indexOf("="); if (eq > 0) this.env[a.slice(0, eq)] = a.slice(eq + 1); return ""; }
      case "unset": { delete this.env[expandedArgs[0] ?? ""]; return ""; }
      case "alias": {
        if (expandedArgs.length === 0) return Object.entries(this.aliases).map(([k, v]) => `alias ${k}='${v}'`).join("\n") + "\n";
        const a = expandedArgs[0] ?? ""; const eq = a.indexOf("="); if (eq > 0) this.aliases[a.slice(0, eq)] = a.slice(eq + 1).replace(/^['"]|['"]$/g, "");
        return "";
      }
      case "history": return this.history.map((c, i) => `  ${String(i + 1).padStart(4)}  ${c}`).join("\n") + "\n";
      case "type": {
        const target = expandedArgs[0] ?? "";
        if (["echo", "cd", "pwd", "export", "alias", "type", "history", "jobs", "source"].includes(target)) return `${target} is a shell builtin\n`;
        return `${target} is /usr/bin/${target}\n`;
      }
      case "jobs": return this.jobs.map(j => `[${String(j.id)}]  ${j.state.padEnd(8)} ${j.command}`).join("\n") + (this.jobs.length > 0 ? "\n" : "");
      case "source": case ".": return this.cmdSource(expandedArgs);
      case "test": case "[": return this.cmdTest(expandedArgs) ? "" : "";
      case "true": return "";
      case "false": { this.env["?"] = "1"; return ""; }
      case "printf": return this.cmdPrintf(expandedArgs);
      case "read": { this.env[expandedArgs[0] ?? "REPLY"] = stdin?.trim() ?? ""; return ""; }
      case "clear": return "\x1b[2J\x1b[H";
      case "help": return this.cmdHelp();
      default: {
        this.emit({ type: "exec", pid: this.nextPid++, command: cmd, args: expandedArgs });
        return `${cmd}: command not found\n`;
      }
    }
  }

  // === 組み込みコマンド ===

  /** echoコマンド。-eでエスケープ解釈、-nで改行なし出力 */
  private cmdEcho(args: string[]): string {
    let interpret = false; let noNewline = false;
    const filtered = args.filter(a => { if (a === "-e") { interpret = true; return false; } if (a === "-n") { noNewline = true; return false; } return true; });
    let text = filtered.join(" ");
    if (interpret) text = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\e/g, "\x1b");
    return text + (noNewline ? "" : "\n");
  }

  /** catコマンド。ファイルの内容を連結して出力する。引数なしの場合はstdinを返す */
  private cmdCat(args: string[], stdin: string | undefined): string {
    if (args.length === 0 && stdin !== undefined) return stdin;
    let output = "";
    for (const file of args) {
      if (file === "-") { output += stdin ?? ""; continue; }
      const content = this.fs.get(this.resolvePath(file));
      if (content !== undefined) output += content + (content.endsWith("\n") ? "" : "\n");
      else { this.writeStderr(`cat: ${file}: No such file\n`); }
    }
    return output;
  }

  /** lsコマンド。仮想ファイルシステム上のディレクトリ内容を一覧表示する */
  private cmdLs(args: string[]): string {
    const long = args.includes("-l") || args.includes("-la");
    const showHidden = args.includes("-a") || args.includes("-la");
    const dir = this.resolvePath(args.find(a => !a.startsWith("-")) ?? (this.env["PWD"] ?? "/"));
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const entries: string[] = [];
    for (const path of this.fs.keys()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name !== undefined && name.length > 0 && !entries.includes(name)) {
          if (!showHidden && name.startsWith(".")) continue;
          entries.push(name);
        }
      }
    }
    entries.sort();
    if (long) {
      return entries.map(name => {
        const fullPath = prefix + name;
        const isDir = [...this.fs.keys()].some(p => p.startsWith(fullPath + "/"));
        const size = this.fs.get(fullPath)?.length ?? 0;
        return `${isDir ? "d" : "-"}rw-r--r--  ${String(size).padStart(6)}  ${name}`;
      }).join("\n") + "\n";
    }
    return entries.join("  ") + (entries.length > 0 ? "\n" : "");
  }

  /** cdコマンド。カレントディレクトリを変更する。引数なしでHOMEに移動 */
  private cmdCd(args: string[]): string {
    const target = args[0] ?? this.env["HOME"] ?? "/";
    const resolved = target === "-" ? (this.env["OLDPWD"] ?? "/") : this.resolvePath(target);
    this.env["OLDPWD"] = this.env["PWD"] ?? "/";
    this.env["PWD"] = resolved;
    return "";
  }

  /** grepコマンド。正規表現でテキストを検索する。-i, -v, -c, -nオプション対応 */
  private cmdGrep(args: string[], stdin: string | undefined): string {
    const pattern = args.find(a => !a.startsWith("-")) ?? "";
    const ignoreCase = args.includes("-i");
    const invert = args.includes("-v");
    const count = args.includes("-c");
    const lineNum = args.includes("-n");
    const fileArg = args.find(a => !a.startsWith("-") && a !== pattern);
    const input = fileArg !== undefined ? (this.fs.get(this.resolvePath(fileArg)) ?? "") : (stdin ?? "");
    const regex = new RegExp(pattern, ignoreCase ? "i" : "");
    const lines = input.split("\n");
    let matched = lines.map((line, i) => ({ line, num: i + 1, match: regex.test(line) })).filter(l => invert ? !l.match : l.match);
    if (count) return String(matched.length) + "\n";
    return matched.map(l => (lineNum ? `${String(l.num)}:` : "") + l.line).join("\n") + "\n";
  }

  /** wcコマンド。行数・単語数・文字数をカウントする */
  private cmdWc(args: string[], stdin: string | undefined): string {
    const fileArg = args.find(a => !a.startsWith("-"));
    const input = fileArg !== undefined ? (this.fs.get(this.resolvePath(fileArg)) ?? "") : (stdin ?? "");
    const lines = input.split("\n").length - (input.endsWith("\n") ? 1 : 0);
    const words = input.split(/\s+/).filter(w => w.length > 0).length;
    const chars = input.length;
    if (args.includes("-l")) return String(lines) + "\n";
    if (args.includes("-w")) return String(words) + "\n";
    if (args.includes("-c")) return String(chars) + "\n";
    return `  ${String(lines)}  ${String(words)}  ${String(chars)}\n`;
  }

  /** headコマンド。入力の先頭n行を出力する（デフォルト10行） */
  private cmdHead(args: string[], stdin: string | undefined): string {
    const n = Number(args.find(a => a.startsWith("-"))?.slice(1) ?? "10");
    const input = stdin ?? "";
    return input.split("\n").slice(0, n).join("\n") + "\n";
  }

  /** tailコマンド。入力の末尾n行を出力する（デフォルト10行） */
  private cmdTail(args: string[], stdin: string | undefined): string {
    const n = Number(args.find(a => a.startsWith("-"))?.slice(1) ?? "10");
    const input = stdin ?? "";
    const lines = input.split("\n").filter(l => l.length > 0);
    return lines.slice(-n).join("\n") + "\n";
  }

  /** sortコマンド。入力行をアルファベット順にソートする */
  private cmdSort(stdin: string | undefined): string {
    if (stdin === undefined) return "";
    return stdin.split("\n").filter(l => l.length > 0).sort().join("\n") + "\n";
  }

  /** uniqコマンド。連続する重複行を除去する */
  private cmdUniq(stdin: string | undefined): string {
    if (stdin === undefined) return "";
    const lines = stdin.split("\n"); let prev = ""; const result: string[] = [];
    for (const l of lines) { if (l !== prev) { result.push(l); prev = l; } }
    return result.join("\n") + "\n";
  }

  /** trコマンド。文字の置換を行う */
  private cmdTr(args: string[], stdin: string | undefined): string {
    if (stdin === undefined || args.length < 2) return stdin ?? "";
    const from = args[0] ?? ""; const to = args[1] ?? "";
    let result = stdin;
    for (let i = 0; i < from.length; i++) {
      const f = from[i]; const t = to[i] ?? to[to.length - 1] ?? "";
      if (f !== undefined) result = result.split(f).join(t);
    }
    return result;
  }

  /** cutコマンド。デリミタで区切られたフィールドを抽出する */
  private cmdCut(args: string[], stdin: string | undefined): string {
    if (stdin === undefined) return "";
    const dIdx = args.indexOf("-d"); const delim = dIdx >= 0 ? (args[dIdx + 1] ?? ",") : "\t";
    const fIdx = args.indexOf("-f"); const field = Number(fIdx >= 0 ? args[fIdx + 1] : "1") - 1;
    return stdin.split("\n").map(line => line.split(delim)[field] ?? "").join("\n") + "\n";
  }

  /** teeコマンド。入力をファイルに書き込みつつ、そのまま出力する */
  private cmdTee(args: string[], stdin: string | undefined): string {
    const file = args[0]; const input = stdin ?? "";
    if (file !== undefined) this.fs.set(this.resolvePath(file), input);
    return input;
  }

  /** seqコマンド。連続する整数列を生成する */
  private cmdSeq(args: string[]): string {
    const start = args.length >= 2 ? Number(args[0]) : 1;
    const end = Number(args[args.length - 1] ?? "1");
    const result: string[] = [];
    for (let i = start; i <= end; i++) result.push(String(i));
    return result.join("\n") + "\n";
  }

  /** sourceコマンド。ファイル内の各行をシェルコマンドとして実行する */
  private cmdSource(args: string[]): string {
    const file = args[0]; if (file === undefined) return "";
    const content = this.fs.get(this.resolvePath(file));
    if (content === undefined) return `source: ${file}: not found\n`;
    let output = "";
    for (const line of content.split("\n")) {
      if (line.trim().startsWith("#") || line.trim().length === 0) continue;
      output += this.execute(line.trim());
    }
    return output;
  }

  /** testコマンド。条件式を評価する（-f: ファイル存在, -d: ディレクトリ存在, -z/-n: 文字列長, =: 比較） */
  private cmdTest(args: string[]): boolean {
    if (args.includes("-f")) return this.fs.has(this.resolvePath(args[args.indexOf("-f") + 1] ?? ""));
    if (args.includes("-d")) return [...this.fs.keys()].some(k => k.startsWith(this.resolvePath(args[args.indexOf("-d") + 1] ?? "") + "/"));
    if (args.includes("-z")) return (args[args.indexOf("-z") + 1] ?? "").length === 0;
    if (args.includes("-n")) return (args[args.indexOf("-n") + 1] ?? "").length > 0;
    if (args.includes("=")) { const i = args.indexOf("="); return args[i - 1] === args[i + 1]; }
    return false;
  }

  /** printfコマンド。フォーマット文字列に従って出力する（%s, %d対応） */
  private cmdPrintf(args: string[]): string {
    const fmt = args[0] ?? ""; const rest = args.slice(1);
    let result = fmt; let i = 0;
    result = result.replace(/%s/g, () => rest[i++] ?? "");
    result = result.replace(/%d/g, () => String(Number(rest[i++] ?? "0")));
    result = result.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    return result;
  }

  /** helpコマンド。利用可能なコマンドと機能の一覧を表示する */
  private cmdHelp(): string {
    return [
      "Shell builtins: echo, cat, ls, cd, pwd, mkdir, touch, rm, cp, mv",
      "Text processing: grep, wc, head, tail, sort, uniq, tr, cut, tee, seq",
      "Shell features: export, unset, alias, history, type, jobs, source",
      "Operators: | (pipe), > >> (redirect), < (input), && || (conditional), ; (sequence), & (background)",
      "Variables: $VAR, ${VAR}, $? (exit code), $HOME, $PWD",
      'Quoting: "double" (expands vars), \'single\' (literal)',
      "Glob: *.txt, ?.sh",
      "Command substitution: $(cmd), `cmd`",
      "Special: printf, read, test, true, false, clear, help",
    ].join("\n") + "\n";
  }

  // === ヘルパー ===

  /** 変数展開。${VAR}、$VAR、~をそれぞれ対応する値に置換する */
  private expandVariables(s: string): string {
    return s.replace(/\$\{(\w+)\}/g, (_, name) => this.env[name] ?? "")
            .replace(/\$(\w+)/g, (_, name) => this.env[name] ?? "")
            .replace(/~/, this.env["HOME"] ?? "/home/user");
  }

  /** エイリアス展開。コマンド名が登録済みエイリアスに一致すれば置換する */
  private expandAliases(input: string): string {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0] ?? "";
    const alias = this.aliases[cmd];
    if (alias !== undefined) return alias + " " + parts.slice(1).join(" ");
    return input;
  }

  /** グロブ展開。*や?を含むパターンを仮想ファイルシステム上のファイル名に展開する */
  private expandGlob(pattern: string): string[] {
    if (!pattern.includes("*") && !pattern.includes("?")) return [pattern];
    const dir = this.env["PWD"] ?? "/";
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    const matches: string[] = [];
    for (const path of this.fs.keys()) {
      if (path.startsWith(prefix)) {
        const name = path.slice(prefix.length).split("/")[0];
        if (name !== undefined && regex.test(name) && !matches.includes(name)) matches.push(name);
      }
    }
    return matches.length > 0 ? matches.sort() : [pattern];
  }

  /** パス解決。相対パスをPWD基準の絶対パスに変換し、..や.を正規化する */
  private resolvePath(p: string): string {
    if (p.startsWith("/")) return p;
    if (p.startsWith("~")) return (this.env["HOME"] ?? "/home/user") + p.slice(1);
    const pwd = this.env["PWD"] ?? "/";
    const full = (pwd.endsWith("/") ? pwd : pwd + "/") + p;
    const parts = full.split("/").filter(s => s.length > 0);
    const resolved: string[] = [];
    for (const part of parts) { if (part === "..") resolved.pop(); else if (part !== ".") resolved.push(part); }
    return "/" + resolved.join("/");
  }

  /** 標準出力に文字列を書き込み、stdoutイベントを発行する */
  private writeStdout(text: string): void {
    this.stdout += text;
    this.emit({ type: "stdout", text });
  }

  /** 標準エラー出力に文字列を書き込み、stderrイベントを発行する */
  private writeStderr(text: string): void {
    this.stderr += text;
    this.emit({ type: "stderr", text });
  }

  /** イベントログをクリアする */
  resetEvents(): void { this.events = []; }
}
