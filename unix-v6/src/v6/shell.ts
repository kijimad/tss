/**
 * V6 シェルコマンドパーサー
 *
 * ユーザー入力のシェルコマンドを V6Operation 列に変換する。
 * V6の /bin/sh に相当する簡易シェルを実装。
 *
 * 対応コマンド:
 *   ls [dir]        — ディレクトリ一覧
 *   cat file        — ファイル内容表示
 *   mkdir dir       — ディレクトリ作成
 *   touch file      — ファイル作成 (creat)
 *   rm file         — ファイル削除 (unlink)
 *   ln src dst      — ハードリンク作成
 *   cd dir          — カレントディレクトリ変更
 *   pwd             — カレントディレクトリ表示
 *   echo text > file — ファイルへ書き込み
 *   cp src dst      — ファイルコピー
 *   mv src dst      — ファイル移動 (同一FS)
 *   stat file       — inode情報表示
 *   chmod mode file — パーミッション変更
 *   ps              — プロセス一覧
 *   kill -SIG pid   — シグナル送信
 *   sync            — バッファ同期
 *   cmd | cmd       — パイプライン
 *   cmd &           — バックグラウンド実行
 */

import type { V6Operation, V6Signal } from "./types.js";

/** パース結果 */
export interface ShellParseResult {
  /** 実行する操作列 */
  operations: V6Operation[];
  /** パース時のエラーメッセージ（あれば） */
  error?: string;
  /** コマンド実行後にforkした子プロセスをwait/exitする操作も含むか */
  needsForkExec: boolean;
}

/** シグナル名のマッピング */
const SIGNAL_MAP: Record<string, V6Signal> = {
  "1": "SIGHUP", HUP: "SIGHUP", SIGHUP: "SIGHUP",
  "2": "SIGINT", INT: "SIGINT", SIGINT: "SIGINT",
  "3": "SIGQUIT", QUIT: "SIGQUIT", SIGQUIT: "SIGQUIT",
  "9": "SIGKILL", KILL: "SIGKILL", SIGKILL: "SIGKILL",
  "13": "SIGPIPE", PIPE: "SIGPIPE", SIGPIPE: "SIGPIPE",
  "15": "SIGHUP", TERM: "SIGHUP",  // V6にはSIGTERMがない、SIGHUPで代用
};

/**
 * シェルコマンド文字列を V6Operation 列にパースする。
 *
 * @param input ユーザー入力文字列
 * @param shellPid シェルプロセスのPID
 * @param nextPidHint 次に割り当てられるPIDの推測値（fork用）
 */
export function parseShellCommand(
  input: string,
  shellPid: number,
  nextPidHint: number,
): ShellParseResult {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return { operations: [{ op: "comment", text: trimmed || "(空行)" }], needsForkExec: false };
  }

  // パイプライン検出
  if (trimmed.includes("|")) {
    return parsePipeline(trimmed, shellPid, nextPidHint);
  }

  // リダイレクト検出
  if (trimmed.includes(">")) {
    return parseRedirect(trimmed, shellPid, nextPidHint);
  }

  // バックグラウンド検出
  const bg = trimmed.endsWith("&");
  const cmd = bg ? trimmed.slice(0, -1).trim() : trimmed;

  const tokens = tokenize(cmd);
  if (tokens.length === 0) {
    return { operations: [], needsForkExec: false };
  }

  const command = tokens[0]!;
  const args = tokens.slice(1);

  switch (command) {
    case "ls":
      return parseLs(shellPid, nextPidHint, args, bg);
    case "cat":
      return parseCat(shellPid, nextPidHint, args, bg);
    case "mkdir":
      return parseMkdir(shellPid, args);
    case "touch":
    case "creat":
      return parseTouch(shellPid, args);
    case "rm":
      return parseRm(shellPid, args);
    case "ln":
      return parseLn(shellPid, args);
    case "cd":
      return parseCd(shellPid, args);
    case "pwd":
      return { operations: [{ op: "comment", text: "pwd: カレントディレクトリを表示" }, { op: "stat", pid: shellPid, path: "." }], needsForkExec: false };
    case "stat":
      return parseStat(shellPid, args);
    case "chmod":
      return parseChmod(shellPid, args);
    case "cp":
      return parseCp(shellPid, nextPidHint, args);
    case "mv":
      return parseMv(shellPid, args);
    case "ps":
      return { operations: [{ op: "comment", text: "ps: プロセス一覧" }], needsForkExec: false };
    case "kill":
      return parseKill(shellPid, args);
    case "sync":
      return { operations: [{ op: "sync" }], needsForkExec: false };
    case "exit":
      return { operations: [{ op: "comment", text: "exit: シェル終了" }], needsForkExec: false };
    case "echo":
      return { operations: [{ op: "comment", text: `echo: ${args.join(" ")}` }], needsForkExec: false };
    case "nice":
      return parseNice(shellPid, args);
    default:
      // 未知のコマンド → fork/exec として扱う
      return parseExternalCommand(shellPid, nextPidHint, command, args, bg);
  }
}

/** 空白分割（クォート非対応の簡易版） */
function tokenize(input: string): string[] {
  return input.split(/\s+/).filter(t => t.length > 0);
}

// ─── 各コマンドのパーサー ───

function parseLs(shellPid: number, nextPid: number, args: string[], bg: boolean): ShellParseResult {
  const dir = args[0] ?? ".";
  const ops: V6Operation[] = [
    { op: "comment", text: `$ ls ${dir}` },
    { op: "fork", parentPid: shellPid, childName: "ls" },
    { op: "exec", pid: nextPid, path: "/bin/ls", argv: ["ls", dir] },
    { op: "open", pid: nextPid, path: dir, mode: "read" },
    { op: "read", pid: nextPid, fd: 0, size: 512 },
    { op: "close", pid: nextPid, fd: 0 },
    { op: "exit", pid: nextPid, code: 0 },
  ];
  if (!bg) {
    ops.push({ op: "wait", pid: shellPid });
  }
  return { operations: ops, needsForkExec: true };
}

function parseCat(shellPid: number, nextPid: number, args: string[], bg: boolean): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "cat: 引数が必要です", needsForkExec: false };
  }
  const file = args[0]!;
  const ops: V6Operation[] = [
    { op: "comment", text: `$ cat ${file}` },
    { op: "fork", parentPid: shellPid, childName: "cat" },
    { op: "exec", pid: nextPid, path: "/bin/cat", argv: ["cat", file] },
    { op: "open", pid: nextPid, path: file, mode: "read" },
    { op: "read", pid: nextPid, fd: 0, size: 512 },
    { op: "close", pid: nextPid, fd: 0 },
    { op: "exit", pid: nextPid, code: 0 },
  ];
  if (!bg) {
    ops.push({ op: "wait", pid: shellPid });
  }
  return { operations: ops, needsForkExec: true };
}

function parseMkdir(shellPid: number, args: string[]): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "mkdir: 引数が必要です", needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ mkdir ${args[0]}` },
      { op: "mkdir", pid: shellPid, path: args[0]! },
    ],
    needsForkExec: false,
  };
}

function parseTouch(shellPid: number, args: string[]): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "touch: 引数が必要です", needsForkExec: false };
  }
  const file = args[0]!;
  return {
    operations: [
      { op: "comment", text: `$ touch ${file}` },
      { op: "creat", pid: shellPid, path: file, perm: 0o644 },
      // creatで返されたfdを閉じる（fd 0/1/2未使用のため最初の空きfd=0）
      { op: "close", pid: shellPid, fd: 0 },
    ],
    needsForkExec: false,
  };
}

function parseRm(shellPid: number, args: string[]): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "rm: 引数が必要です", needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ rm ${args[0]}` },
      { op: "unlink", pid: shellPid, path: args[0]! },
    ],
    needsForkExec: false,
  };
}

function parseLn(shellPid: number, args: string[]): ShellParseResult {
  if (args.length < 2) {
    return { operations: [], error: "ln: 引数が2つ必要です (ln src dst)", needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ ln ${args[0]} ${args[1]}` },
      { op: "link", pid: shellPid, existingPath: args[0]!, newPath: args[1]! },
    ],
    needsForkExec: false,
  };
}

function parseCd(shellPid: number, args: string[]): ShellParseResult {
  const dir = args[0] ?? "/";
  return {
    operations: [
      { op: "comment", text: `$ cd ${dir}` },
      { op: "chdir", pid: shellPid, path: dir },
    ],
    needsForkExec: false,
  };
}

function parseStat(shellPid: number, args: string[]): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "stat: 引数が必要です", needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ stat ${args[0]}` },
      { op: "stat", pid: shellPid, path: args[0]! },
    ],
    needsForkExec: false,
  };
}

function parseChmod(shellPid: number, args: string[]): ShellParseResult {
  if (args.length < 2) {
    return { operations: [], error: "chmod: 引数が2つ必要です (chmod mode file)", needsForkExec: false };
  }
  const mode = parseInt(args[0]!, 8);
  if (isNaN(mode)) {
    return { operations: [], error: `chmod: 無効なモード: ${args[0]}`, needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ chmod ${args[0]} ${args[1]}` },
      { op: "chmod", pid: shellPid, path: args[1]!, mode },
    ],
    needsForkExec: false,
  };
}

function parseCp(shellPid: number, nextPid: number, args: string[]): ShellParseResult {
  if (args.length < 2) {
    return { operations: [], error: "cp: 引数が2つ必要です (cp src dst)", needsForkExec: false };
  }
  const [src, dst] = args as [string, string];
  return {
    operations: [
      { op: "comment", text: `$ cp ${src} ${dst}` },
      { op: "fork", parentPid: shellPid, childName: "cp" },
      { op: "exec", pid: nextPid, path: "/bin/cp", argv: ["cp", src, dst] },
      // open(src) → fd=0, creat(dst) → fd=1 (プリセットのcpと同じ)
      { op: "open", pid: nextPid, path: src, mode: "read" },
      { op: "read", pid: nextPid, fd: 0, size: 512 },
      { op: "creat", pid: nextPid, path: dst, perm: 0o644 },
      { op: "write", pid: nextPid, fd: 1, data: `[copy of ${src}]` },
      { op: "close", pid: nextPid, fd: 0 },
      { op: "close", pid: nextPid, fd: 1 },
      { op: "exit", pid: nextPid, code: 0 },
      { op: "wait", pid: shellPid },
    ],
    needsForkExec: true,
  };
}

function parseMv(shellPid: number, args: string[]): ShellParseResult {
  if (args.length < 2) {
    return { operations: [], error: "mv: 引数が2つ必要です (mv src dst)", needsForkExec: false };
  }
  const [src, dst] = args as [string, string];
  return {
    operations: [
      { op: "comment", text: `$ mv ${src} ${dst}` },
      { op: "link", pid: shellPid, existingPath: src, newPath: dst },
      { op: "unlink", pid: shellPid, path: src },
    ],
    needsForkExec: false,
  };
}

function parseKill(shellPid: number, args: string[]): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "kill: 引数が必要です (kill [-SIG] pid)", needsForkExec: false };
  }
  let sig: V6Signal = "SIGHUP";
  let pidStr: string;
  if (args[0]!.startsWith("-")) {
    const sigName = args[0]!.slice(1);
    sig = SIGNAL_MAP[sigName] ?? "SIGHUP";
    pidStr = args[1] ?? "0";
  } else {
    pidStr = args[0]!;
  }
  const targetPid = parseInt(pidStr, 10);
  if (isNaN(targetPid)) {
    return { operations: [], error: `kill: 無効なPID: ${pidStr}`, needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ kill -${sig} ${targetPid}` },
      { op: "kill", senderPid: shellPid, targetPid, sig },
    ],
    needsForkExec: false,
  };
}

function parseNice(shellPid: number, args: string[]): ShellParseResult {
  if (args.length === 0) {
    return { operations: [], error: "nice: 引数が必要です (nice value)", needsForkExec: false };
  }
  const value = parseInt(args[0]!, 10);
  if (isNaN(value)) {
    return { operations: [], error: `nice: 無効な値: ${args[0]}`, needsForkExec: false };
  }
  return {
    operations: [
      { op: "comment", text: `$ nice ${value}` },
      { op: "nice", pid: shellPid, value },
    ],
    needsForkExec: false,
  };
}

/** 未知のコマンド → fork/exec/exit/wait */
function parseExternalCommand(
  shellPid: number, nextPid: number,
  command: string, args: string[], bg: boolean,
): ShellParseResult {
  const ops: V6Operation[] = [
    { op: "comment", text: `$ ${command} ${args.join(" ")}`.trim() },
    { op: "fork", parentPid: shellPid, childName: command },
    { op: "exec", pid: nextPid, path: `/bin/${command}`, argv: [command, ...args] },
    { op: "exit", pid: nextPid, code: 0 },
  ];
  if (!bg) {
    ops.push({ op: "wait", pid: shellPid });
  }
  return { operations: ops, needsForkExec: true };
}

/** リダイレクト付きコマンド (echo hello > file) */
function parseRedirect(input: string, shellPid: number, _nextPid: number): ShellParseResult {
  const append = input.includes(">>");
  const parts = input.split(append ? ">>" : ">");
  if (parts.length < 2) {
    return { operations: [], error: "リダイレクト: ファイル名が必要です", needsForkExec: false };
  }

  const cmdPart = parts[0]!.trim();
  const filePart = parts[1]!.trim();
  const tokens = tokenize(cmdPart);
  const data = tokens.slice(1).join(" ") || cmdPart;

  if (append) {
    // >> : open(write) + write + close（fd=0: 最初の空きfd）
    return {
      operations: [
        { op: "comment", text: `$ ${input}` },
        { op: "open", pid: shellPid, path: filePart, mode: "write" },
        { op: "write", pid: shellPid, fd: 0, data },
        { op: "close", pid: shellPid, fd: 0 },
      ],
      needsForkExec: false,
    };
  } else {
    // > : creat + write + close（fd=0: 最初の空きfd）
    return {
      operations: [
        { op: "comment", text: `$ ${input}` },
        { op: "creat", pid: shellPid, path: filePart, perm: 0o644 },
        { op: "write", pid: shellPid, fd: 0, data },
        { op: "close", pid: shellPid, fd: 0 },
      ],
      needsForkExec: false,
    };
  }
}

/** パイプライン (cmd1 | cmd2 | cmd3) */
function parsePipeline(input: string, shellPid: number, nextPidBase: number): ShellParseResult {
  const segments = input.split("|").map(s => s.trim()).filter(s => s.length > 0);
  if (segments.length < 2) {
    return { operations: [], error: "パイプライン: 2つ以上のコマンドが必要です", needsForkExec: false };
  }

  const ops: V6Operation[] = [
    { op: "comment", text: `$ ${input}` },
  ];

  // パイプを segments.length - 1 個作成
  for (let i = 0; i < segments.length - 1; i++) {
    ops.push({ op: "pipe", pid: shellPid });
  }

  // 各コマンドをfork/exec
  for (let i = 0; i < segments.length; i++) {
    const tokens = tokenize(segments[i]!);
    const cmd = tokens[0] ?? "true";
    const childPid = nextPidBase + i;
    ops.push(
      { op: "fork", parentPid: shellPid, childName: cmd },
      { op: "exec", pid: childPid, path: `/bin/${cmd}`, argv: tokens },
    );
  }

  // 各子プロセスを終了 → シェルがwait
  for (let i = 0; i < segments.length; i++) {
    ops.push({ op: "exit", pid: nextPidBase + i, code: 0 });
  }
  for (let i = 0; i < segments.length; i++) {
    ops.push({ op: "wait", pid: shellPid });
  }

  return { operations: ops, needsForkExec: true };
}

/**
 * ヘルプメッセージ用のコマンド一覧を返す
 */
export function getShellHelp(): string[] {
  return [
    "ls [dir]          — ディレクトリ一覧",
    "cat file          — ファイル内容表示",
    "mkdir dir         — ディレクトリ作成",
    "touch file        — ファイル作成",
    "rm file           — ファイル削除",
    "ln src dst        — ハードリンク作成",
    "cd dir            — ディレクトリ変更",
    "pwd               — カレントディレクトリ",
    "echo text > file  — ファイルへ書き込み",
    "cp src dst        — ファイルコピー",
    "mv src dst        — ファイル移動",
    "stat file         — inode情報",
    "chmod mode file   — パーミッション変更",
    "ps                — プロセス一覧",
    "kill [-SIG] pid   — シグナル送信",
    "sync              — バッファ同期",
    "cmd1 | cmd2       — パイプライン",
    "cmd &             — バックグラウンド",
    "help              — このヘルプ",
  ];
}
