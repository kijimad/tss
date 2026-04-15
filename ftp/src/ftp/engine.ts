/**
 * FTPプロトコルシミュレーションエンジンモジュール。
 * 仮想ファイルシステム上でFTPコマンドを順次実行し、
 * コントロール接続メッセージ、データ転送、セッション状態の変化を記録する。
 * RFC 959準拠のレスポンスコードを返す。
 * @module ftp/engine
 */

import type {
  FtpCommand, DataType, FsEntry, FtpUser,
  ControlMessage, DataTransfer, SessionState, SimStep,
  SimulationResult, ClientCommand,
} from "./types.js";

// === ファイルシステム操作 ===

/** パスを正規化 */
function normalizePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  return "/" + resolved.join("/");
}

/** 絶対パスに変換 */
function toAbsolute(cwd: string, path: string): string {
  if (path.startsWith("/")) return normalizePath(path);
  return normalizePath(cwd + "/" + path);
}

/** パスからエントリを取得 */
function resolvePath(root: FsEntry, path: string): FsEntry | null {
  const normalized = normalizePath(path);
  if (normalized === "/") return root;
  const parts = normalized.split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (current.type !== "directory" || !current.children) return null;
    const child = current.children.find((c) => c.name === part);
    if (!child) return null;
    current = child;
  }
  return current;
}

/** 親ディレクトリとファイル名を取得 */
function resolveParent(root: FsEntry, path: string): { parent: FsEntry; name: string } | null {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const name = parts.pop()!;
  const parentPath = "/" + parts.join("/");
  const parent = resolvePath(root, parentPath);
  if (!parent || parent.type !== "directory") return null;
  return { parent, name };
}

/** ディレクトリ内のファイルをLIST形式で列挙 */
function formatListing(entry: FsEntry): string {
  if (entry.type !== "directory" || !entry.children) return "";
  return entry.children.map((child) => {
    const typeChar = child.type === "directory" ? "d" : "-";
    const perm = child.permissions;
    const size = child.size.toString().padStart(8);
    return `${typeChar}${perm}  1 ${child.owner.padEnd(8)} ${child.owner.padEnd(8)} ${size} ${child.modified} ${child.name}`;
  }).join("\r\n");
}

/** ファイルシステムをディープコピー */
export function cloneFs(fs: FsEntry): FsEntry {
  return JSON.parse(JSON.stringify(fs));
}

/** タイムスタンプ */
const NOW = "2026-04-10 12:00";

// === FTPレスポンスコード ===

/**
 * FTPサーバーレスポンスメッセージを生成する。
 * @param code - FTPレスポンスコード（例: 200, 530）
 * @param msg - レスポンスメッセージ本文
 * @returns サーバー方向のコントロールメッセージ
 */
function reply(code: number, msg: string): ControlMessage {
  return { direction: "server", raw: `${code} ${msg}`, description: msg };
}

/**
 * クライアントから送信されたFTPコマンドメッセージを生成する。
 * @param cmd - FTPコマンド名
 * @param arg - コマンド引数
 * @returns クライアント方向のコントロールメッセージ
 */
function clientMsg(cmd: FtpCommand, arg: string): ControlMessage {
  const raw = arg ? `${cmd} ${arg}` : cmd;
  return { direction: "client", raw, description: `${cmd}コマンド送信` };
}

// === シミュレーションエンジン ===

/**
 * FTPセッションのシミュレーションを実行する。
 * 与えられたコマンド列を順次処理し、各ステップでのコントロールメッセージ、
 * データ転送、セッション状態の変化を記録した結果を返す。
 * @param users - 認証に使用するFTPユーザー一覧
 * @param initialFs - シミュレーション開始時の仮想ファイルシステム
 * @param commands - 実行するFTPコマンドの配列
 * @returns シミュレーション結果（ステップ一覧と最終ファイルシステム状態）
 */
export function runSimulation(
  users: FtpUser[], initialFs: FsEntry, commands: ClientCommand[],
): SimulationResult {
  const fs = cloneFs(initialFs);
  const steps: SimStep[] = [];
  let step = 0;

  // セッション状態
  const session: SessionState = {
    connected: false,
    authenticated: false,
    username: "",
    cwd: "/",
    transferMode: "passive",
    dataType: "A",
    renameFrom: null,
    pasvPort: null,
  };

  /** 認証待ちのユーザー名（USERコマンド送信後、PASS待ち） */
  let pendingUser: string | null = null;
  /** パッシブモードで割り当てるポート番号のカウンター */
  let pasvPortCounter = 50000;

  /** 現在のセッション状態のスナップショットを取得する */
  function snap(): SessionState {
    return { ...session };
  }

  // 接続イベント
  steps.push({
    step: step++,
    control: [
      reply(220, "Welcome to FTP Simulator (RFC 959)"),
    ],
    session: snap(),
    description: "サーバーに接続、ウェルカムメッセージ受信",
  });
  session.connected = true;

  // コマンド処理
  for (const cmd of commands) {
    const control: ControlMessage[] = [clientMsg(cmd.cmd, cmd.arg)];
    let dataTransfer: DataTransfer | undefined;
    let desc = "";

    switch (cmd.cmd) {
      case "USER": {
        pendingUser = cmd.arg;
        control.push(reply(331, `Password required for ${cmd.arg}`));
        desc = `ユーザー名 "${cmd.arg}" を送信`;
        break;
      }

      case "PASS": {
        if (!pendingUser) {
          control.push(reply(503, "Login with USER first"));
          desc = "USER未送信でPASS送信（エラー）";
          break;
        }
        const user = users.find((u) => u.username === pendingUser && u.password === cmd.arg);
        if (user) {
          session.authenticated = true;
          session.username = user.username;
          session.cwd = user.homeDir;
          control.push(reply(230, `User ${user.username} logged in`));
          desc = `認証成功: ${user.username}としてログイン`;
        } else {
          control.push(reply(530, "Login incorrect"));
          desc = "認証失敗: ユーザー名またはパスワードが不正";
        }
        pendingUser = null;
        break;
      }

      case "SYST": {
        control.push(reply(215, "UNIX Type: L8"));
        desc = "システム情報取得: UNIX Type: L8";
        break;
      }

      case "FEAT": {
        control.push(
          { direction: "server", raw: "211-Features:", description: "機能一覧開始" },
          { direction: "server", raw: " SIZE", description: "SIZE対応" },
          { direction: "server", raw: " UTF8", description: "UTF8対応" },
          { direction: "server", raw: " PASV", description: "PASV対応" },
          { direction: "server", raw: "211 End", description: "機能一覧終了" },
        );
        desc = "サーバー機能一覧を取得";
        break;
      }

      case "OPTS": {
        if (cmd.arg.toUpperCase() === "UTF8 ON") {
          control.push(reply(200, "UTF8 set to on"));
          desc = "UTF8オプション有効化";
        } else {
          control.push(reply(501, "Option not understood"));
          desc = `不明なオプション: ${cmd.arg}`;
        }
        break;
      }

      case "PWD": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でPWD実行（エラー）";
          break;
        }
        control.push(reply(257, `"${session.cwd}" is the current directory`));
        desc = `現在のディレクトリ: ${session.cwd}`;
        break;
      }

      case "CWD": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でCWD実行（エラー）";
          break;
        }
        const targetPath = toAbsolute(session.cwd, cmd.arg);
        const target = resolvePath(fs, targetPath);
        if (target && target.type === "directory") {
          session.cwd = targetPath;
          control.push(reply(250, `Directory changed to ${targetPath}`));
          desc = `ディレクトリ移動: ${targetPath}`;
        } else {
          control.push(reply(550, `${cmd.arg}: No such directory`));
          desc = `ディレクトリ移動失敗: ${cmd.arg} が存在しない`;
        }
        break;
      }

      case "CDUP": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でCDUP実行（エラー）";
          break;
        }
        session.cwd = normalizePath(session.cwd + "/..");
        control.push(reply(250, `Directory changed to ${session.cwd}`));
        desc = `親ディレクトリへ移動: ${session.cwd}`;
        break;
      }

      case "TYPE": {
        const t = cmd.arg.toUpperCase();
        if (t === "A" || t === "I") {
          session.dataType = t as DataType;
          const name = t === "A" ? "ASCII" : "Binary";
          control.push(reply(200, `Type set to ${name}`));
          desc = `転送タイプを${name}に設定`;
        } else {
          control.push(reply(504, `Type ${cmd.arg} not implemented`));
          desc = `不明な転送タイプ: ${cmd.arg}`;
        }
        break;
      }

      case "PASV": {
        session.transferMode = "passive";
        session.pasvPort = pasvPortCounter++;
        const p1 = Math.floor(session.pasvPort / 256);
        const p2 = session.pasvPort % 256;
        control.push(reply(227, `Entering Passive Mode (127,0,0,1,${p1},${p2})`));
        desc = `パッシブモード開始 (ポート ${session.pasvPort})`;
        break;
      }

      case "PORT": {
        session.transferMode = "active";
        const parts = cmd.arg.split(",");
        if (parts.length === 6) {
          const p1 = parseInt(parts[4]!, 10);
          const p2 = parseInt(parts[5]!, 10);
          const port = p1 * 256 + p2;
          control.push(reply(200, `PORT command successful`));
          desc = `アクティブモード: クライアントポート ${port}`;
        } else {
          control.push(reply(501, "Syntax error in PORT command"));
          desc = "PORTコマンド構文エラー";
        }
        break;
      }

      case "LIST": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でLIST実行（エラー）";
          break;
        }
        const listPath = cmd.arg ? toAbsolute(session.cwd, cmd.arg) : session.cwd;
        const listDir = resolvePath(fs, listPath);
        if (!listDir || listDir.type !== "directory") {
          control.push(reply(550, "No such directory"));
          desc = `ディレクトリ一覧取得失敗: ${listPath}`;
          break;
        }
        const listing = formatListing(listDir);
        control.push(reply(150, `Opening ${session.dataType === "A" ? "ASCII" : "BINARY"} mode data connection for file list`));
        dataTransfer = {
          mode: session.transferMode,
          type: session.dataType,
          direction: "listing",
          data: listing,
          size: listing.length,
        };
        control.push(reply(226, "Transfer complete"));
        desc = `ディレクトリ一覧取得: ${listPath} (${listDir.children?.length ?? 0}件)`;
        break;
      }

      case "NLST": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でNLST実行（エラー）";
          break;
        }
        const nlstPath = cmd.arg ? toAbsolute(session.cwd, cmd.arg) : session.cwd;
        const nlstDir = resolvePath(fs, nlstPath);
        if (!nlstDir || nlstDir.type !== "directory") {
          control.push(reply(550, "No such directory"));
          desc = `NLST失敗: ${nlstPath}`;
          break;
        }
        const names = (nlstDir.children ?? []).map((c) => c.name).join("\r\n");
        control.push(reply(150, "Opening data connection for name list"));
        dataTransfer = {
          mode: session.transferMode,
          type: session.dataType,
          direction: "listing",
          data: names,
          size: names.length,
        };
        control.push(reply(226, "Transfer complete"));
        desc = `ファイル名一覧取得: ${nlstPath}`;
        break;
      }

      case "RETR": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でRETR実行（エラー）";
          break;
        }
        const retrPath = toAbsolute(session.cwd, cmd.arg);
        const file = resolvePath(fs, retrPath);
        if (!file || file.type !== "file") {
          control.push(reply(550, `${cmd.arg}: No such file`));
          desc = `ファイルダウンロード失敗: ${cmd.arg}`;
          break;
        }
        const fileData = file.content ?? "";
        control.push(reply(150, `Opening ${session.dataType === "A" ? "ASCII" : "BINARY"} mode data connection for ${cmd.arg} (${file.size} bytes)`));
        dataTransfer = {
          mode: session.transferMode,
          type: session.dataType,
          direction: "download",
          data: fileData,
          size: file.size,
        };
        control.push(reply(226, "Transfer complete"));
        desc = `ファイルダウンロード: ${cmd.arg} (${file.size} bytes)`;
        break;
      }

      case "STOR": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でSTOR実行（エラー）";
          break;
        }
        const storPath = toAbsolute(session.cwd, cmd.arg);
        const storParent = resolveParent(fs, storPath);
        if (!storParent) {
          control.push(reply(553, "Could not create file"));
          desc = `ファイルアップロード失敗: 親ディレクトリが存在しない`;
          break;
        }
        const uploadData = `[uploaded content for ${cmd.arg}]`;
        control.push(reply(150, `Opening ${session.dataType === "A" ? "ASCII" : "BINARY"} mode data connection for ${cmd.arg}`));
        dataTransfer = {
          mode: session.transferMode,
          type: session.dataType,
          direction: "upload",
          data: uploadData,
          size: uploadData.length,
        };
        // ファイルシステムに追加
        const existing = storParent.parent.children!.find((c) => c.name === storParent.name);
        if (existing) {
          existing.content = uploadData;
          existing.size = uploadData.length;
          existing.modified = NOW;
        } else {
          storParent.parent.children!.push({
            name: storParent.name,
            type: "file",
            size: uploadData.length,
            modified: NOW,
            permissions: "rw-r--r--",
            owner: session.username,
            content: uploadData,
          });
        }
        control.push(reply(226, "Transfer complete"));
        desc = `ファイルアップロード: ${cmd.arg}`;
        break;
      }

      case "DELE": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でDELE実行（エラー）";
          break;
        }
        const delePath = toAbsolute(session.cwd, cmd.arg);
        const deleParent = resolveParent(fs, delePath);
        if (!deleParent) {
          control.push(reply(550, `${cmd.arg}: No such file`));
          desc = `ファイル削除失敗: ${cmd.arg}`;
          break;
        }
        const idx = deleParent.parent.children!.findIndex(
          (c) => c.name === deleParent.name && c.type === "file",
        );
        if (idx === -1) {
          control.push(reply(550, `${cmd.arg}: No such file`));
          desc = `ファイル削除失敗: ${cmd.arg}`;
        } else {
          deleParent.parent.children!.splice(idx, 1);
          control.push(reply(250, `${cmd.arg} deleted`));
          desc = `ファイル削除: ${cmd.arg}`;
        }
        break;
      }

      case "MKD": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でMKD実行（エラー）";
          break;
        }
        const mkdPath = toAbsolute(session.cwd, cmd.arg);
        const mkdParent = resolveParent(fs, mkdPath);
        if (!mkdParent) {
          control.push(reply(550, "Cannot create directory"));
          desc = `ディレクトリ作成失敗: 親が存在しない`;
          break;
        }
        const existsAlready = mkdParent.parent.children!.find((c) => c.name === mkdParent.name);
        if (existsAlready) {
          control.push(reply(550, `${cmd.arg}: Directory already exists`));
          desc = `ディレクトリ作成失敗: ${cmd.arg} は既に存在`;
        } else {
          mkdParent.parent.children!.push({
            name: mkdParent.name,
            type: "directory",
            size: 0,
            modified: NOW,
            permissions: "rwxr-xr-x",
            owner: session.username,
            children: [],
          });
          control.push(reply(257, `"${mkdPath}" created`));
          desc = `ディレクトリ作成: ${mkdPath}`;
        }
        break;
      }

      case "RMD": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でRMD実行（エラー）";
          break;
        }
        const rmdPath = toAbsolute(session.cwd, cmd.arg);
        const rmdParent = resolveParent(fs, rmdPath);
        if (!rmdParent) {
          control.push(reply(550, `${cmd.arg}: No such directory`));
          desc = `ディレクトリ削除失敗: ${cmd.arg}`;
          break;
        }
        const rmdIdx = rmdParent.parent.children!.findIndex(
          (c) => c.name === rmdParent.name && c.type === "directory",
        );
        if (rmdIdx === -1) {
          control.push(reply(550, `${cmd.arg}: No such directory`));
          desc = `ディレクトリ削除失敗: ${cmd.arg}`;
        } else {
          rmdParent.parent.children!.splice(rmdIdx, 1);
          control.push(reply(250, `${cmd.arg} removed`));
          desc = `ディレクトリ削除: ${cmd.arg}`;
        }
        break;
      }

      case "RNFR": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でRNFR実行（エラー）";
          break;
        }
        const rnfrPath = toAbsolute(session.cwd, cmd.arg);
        const rnfrEntry = resolvePath(fs, rnfrPath);
        if (!rnfrEntry) {
          control.push(reply(550, `${cmd.arg}: No such file or directory`));
          desc = `リネーム元が存在しない: ${cmd.arg}`;
        } else {
          session.renameFrom = rnfrPath;
          control.push(reply(350, "Ready for RNTO"));
          desc = `リネーム元指定: ${cmd.arg}`;
        }
        break;
      }

      case "RNTO": {
        if (!session.renameFrom) {
          control.push(reply(503, "RNFR required first"));
          desc = "RNFR未実行でRNTO送信（エラー）";
          break;
        }
        const rntoSrc = resolveParent(fs, session.renameFrom);
        if (!rntoSrc) {
          control.push(reply(550, "Rename failed"));
          desc = "リネーム失敗: 元ファイルが見つからない";
          session.renameFrom = null;
          break;
        }
        const srcEntry = rntoSrc.parent.children!.find((c) => c.name === rntoSrc.name);
        if (!srcEntry) {
          control.push(reply(550, "Rename failed"));
          desc = "リネーム失敗";
          session.renameFrom = null;
          break;
        }
        const rntoDstPath = toAbsolute(session.cwd, cmd.arg);
        const rntoDst = resolveParent(fs, rntoDstPath);
        if (!rntoDst) {
          control.push(reply(553, "Rename failed: invalid destination"));
          desc = "リネーム失敗: 宛先が不正";
          session.renameFrom = null;
          break;
        }
        // 元から削除して先に追加
        const srcIdx = rntoSrc.parent.children!.indexOf(srcEntry);
        rntoSrc.parent.children!.splice(srcIdx, 1);
        srcEntry.name = rntoDst.name;
        rntoDst.parent.children!.push(srcEntry);
        control.push(reply(250, "Rename successful"));
        desc = `リネーム: ${session.renameFrom} → ${rntoDstPath}`;
        session.renameFrom = null;
        break;
      }

      case "SIZE": {
        if (!session.authenticated) {
          control.push(reply(530, "Not logged in"));
          desc = "未認証でSIZE実行（エラー）";
          break;
        }
        const sizePath = toAbsolute(session.cwd, cmd.arg);
        const sizeFile = resolvePath(fs, sizePath);
        if (!sizeFile || sizeFile.type !== "file") {
          control.push(reply(550, `${cmd.arg}: No such file`));
          desc = `サイズ取得失敗: ${cmd.arg}`;
        } else {
          control.push(reply(213, `${sizeFile.size}`));
          desc = `ファイルサイズ: ${cmd.arg} = ${sizeFile.size} bytes`;
        }
        break;
      }

      case "STAT": {
        control.push(
          { direction: "server", raw: "211-FTP Server Status", description: "ステータス開始" },
          { direction: "server", raw: `  Connected as: ${session.username || "(anonymous)"}`, description: "接続ユーザー" },
          { direction: "server", raw: `  Current dir: ${session.cwd}`, description: "カレントディレクトリ" },
          { direction: "server", raw: `  Transfer mode: ${session.transferMode}`, description: "転送モード" },
          { direction: "server", raw: `  Data type: ${session.dataType === "A" ? "ASCII" : "Binary"}`, description: "データタイプ" },
          { direction: "server", raw: "211 End of status", description: "ステータス終了" },
        );
        desc = "サーバーステータス取得";
        break;
      }

      case "NOOP": {
        control.push(reply(200, "NOOP ok"));
        desc = "NOOP（無操作）";
        break;
      }

      case "QUIT": {
        control.push(reply(221, "Goodbye"));
        session.connected = false;
        session.authenticated = false;
        desc = "セッション切断";
        break;
      }

      default: {
        control.push(reply(502, `${cmd.cmd} not implemented`));
        desc = `未実装コマンド: ${cmd.cmd}`;
      }
    }

    steps.push({
      step: step++,
      command: cmd,
      control,
      dataTransfer,
      session: snap(),
      description: desc,
    });
  }

  return { steps, finalFs: fs };
}
