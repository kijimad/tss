import type { Preset, FsEntry, FtpUser } from "./types.js";

/** テスト用ユーザー */
const USERS: FtpUser[] = [
  { username: "admin", password: "secret", homeDir: "/home/admin" },
  { username: "guest", password: "guest", homeDir: "/home/guest" },
];

/** テスト用ファイルシステム */
function makeFs(): FsEntry {
  return {
    name: "/", type: "directory", size: 0, modified: "2026-01-01 00:00",
    permissions: "rwxr-xr-x", owner: "root",
    children: [
      {
        name: "home", type: "directory", size: 0, modified: "2026-01-01 00:00",
        permissions: "rwxr-xr-x", owner: "root",
        children: [
          {
            name: "admin", type: "directory", size: 0, modified: "2026-03-15 10:30",
            permissions: "rwxr-x---", owner: "admin",
            children: [
              { name: "readme.txt", type: "file", size: 45, modified: "2026-03-10 09:00",
                permissions: "rw-r--r--", owner: "admin",
                content: "Welcome to the FTP server.\nEnjoy your stay!" },
              { name: "data.csv", type: "file", size: 128, modified: "2026-03-12 14:30",
                permissions: "rw-r--r--", owner: "admin",
                content: "id,name,value\n1,alpha,100\n2,beta,200\n3,gamma,300" },
              {
                name: "docs", type: "directory", size: 0, modified: "2026-03-14 16:00",
                permissions: "rwxr-xr-x", owner: "admin",
                children: [
                  { name: "report.pdf", type: "file", size: 2048, modified: "2026-03-14 16:00",
                    permissions: "rw-r--r--", owner: "admin",
                    content: "[PDF binary content...]" },
                  { name: "notes.md", type: "file", size: 320, modified: "2026-03-13 11:00",
                    permissions: "rw-r--r--", owner: "admin",
                    content: "# Project Notes\n\n- Task A: complete\n- Task B: in progress" },
                ],
              },
              {
                name: "backup", type: "directory", size: 0, modified: "2026-03-01 08:00",
                permissions: "rwx------", owner: "admin",
                children: [
                  { name: "old_config.txt", type: "file", size: 64, modified: "2026-02-28 12:00",
                    permissions: "rw-------", owner: "admin",
                    content: "server_name=oldserver\nport=8080" },
                ],
              },
            ],
          },
          {
            name: "guest", type: "directory", size: 0, modified: "2026-04-01 10:00",
            permissions: "rwxr-xr-x", owner: "guest",
            children: [
              { name: "hello.txt", type: "file", size: 12, modified: "2026-04-01 10:00",
                permissions: "rw-r--r--", owner: "guest",
                content: "Hello World!" },
            ],
          },
        ],
      },
      {
        name: "pub", type: "directory", size: 0, modified: "2026-02-01 00:00",
        permissions: "rwxr-xr-x", owner: "root",
        children: [
          { name: "release.tar.gz", type: "file", size: 10240, modified: "2026-02-01 00:00",
            permissions: "r--r--r--", owner: "root",
            content: "[binary tarball data...]" },
        ],
      },
    ],
  };
}

export const presets: Preset[] = [
  // 1. 基本ログイン＆PWD
  {
    name: "基本ログイン",
    description: "USER/PASSで認証し、PWDで現在のディレクトリを確認",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "SYST", arg: "" },
      { cmd: "PWD", arg: "" },
      { cmd: "QUIT", arg: "" },
    ],
  },

  // 2. ディレクトリ操作
  {
    name: "ディレクトリ操作",
    description: "CWD/CDUP/LISTでディレクトリを移動・一覧を取得",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "PWD", arg: "" },
      { cmd: "PASV", arg: "" },
      { cmd: "LIST", arg: "" },
      { cmd: "CWD", arg: "docs" },
      { cmd: "PWD", arg: "" },
      { cmd: "LIST", arg: "" },
      { cmd: "CDUP", arg: "" },
      { cmd: "PWD", arg: "" },
    ],
  },

  // 3. ファイルダウンロード
  {
    name: "ファイルダウンロード (RETR)",
    description: "ASCIIモードとBinaryモードでファイルをダウンロード",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "TYPE", arg: "A" },
      { cmd: "PASV", arg: "" },
      { cmd: "SIZE", arg: "readme.txt" },
      { cmd: "RETR", arg: "readme.txt" },
      { cmd: "TYPE", arg: "I" },
      { cmd: "PASV", arg: "" },
      { cmd: "CWD", arg: "docs" },
      { cmd: "RETR", arg: "report.pdf" },
    ],
  },

  // 4. ファイルアップロード
  {
    name: "ファイルアップロード (STOR)",
    description: "新しいファイルをサーバーにアップロードし、LISTで確認",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "PASV", arg: "" },
      { cmd: "TYPE", arg: "A" },
      { cmd: "STOR", arg: "newfile.txt" },
      { cmd: "LIST", arg: "" },
      { cmd: "CWD", arg: "docs" },
      { cmd: "STOR", arg: "draft.md" },
      { cmd: "LIST", arg: "" },
    ],
  },

  // 5. ファイル・ディレクトリ削除
  {
    name: "削除操作 (DELE/RMD)",
    description: "ファイル削除(DELE)とディレクトリ削除(RMD)を実行",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "PASV", arg: "" },
      { cmd: "LIST", arg: "" },
      { cmd: "DELE", arg: "data.csv" },
      { cmd: "LIST", arg: "" },
      { cmd: "CWD", arg: "backup" },
      { cmd: "DELE", arg: "old_config.txt" },
      { cmd: "CDUP", arg: "" },
      { cmd: "RMD", arg: "backup" },
      { cmd: "LIST", arg: "" },
    ],
  },

  // 6. ディレクトリ作成
  {
    name: "ディレクトリ作成 (MKD)",
    description: "新しいディレクトリを作成し、中にファイルをアップロード",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "MKD", arg: "projects" },
      { cmd: "CWD", arg: "projects" },
      { cmd: "PWD", arg: "" },
      { cmd: "PASV", arg: "" },
      { cmd: "STOR", arg: "index.html" },
      { cmd: "STOR", arg: "style.css" },
      { cmd: "LIST", arg: "" },
    ],
  },

  // 7. リネーム
  {
    name: "リネーム (RNFR/RNTO)",
    description: "ファイルのリネーム操作を実行",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "PASV", arg: "" },
      { cmd: "LIST", arg: "" },
      { cmd: "RNFR", arg: "readme.txt" },
      { cmd: "RNTO", arg: "README.md" },
      { cmd: "LIST", arg: "" },
      { cmd: "RNFR", arg: "data.csv" },
      { cmd: "RNTO", arg: "data_backup.csv" },
      { cmd: "LIST", arg: "" },
    ],
  },

  // 8. パッシブ/アクティブモード
  {
    name: "転送モード (PASV/PORT)",
    description: "パッシブモードとアクティブモードを切り替えてデータ転送",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "PASV", arg: "" },
      { cmd: "LIST", arg: "" },
      { cmd: "PORT", arg: "127,0,0,1,200,10" },
      { cmd: "LIST", arg: "" },
      { cmd: "PASV", arg: "" },
      { cmd: "RETR", arg: "readme.txt" },
    ],
  },

  // 9. 認証エラー＆コマンドエラー
  {
    name: "エラーハンドリング",
    description: "認証失敗、存在しないファイル、不正なコマンドのエラー処理",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "wrongpass" },
      { cmd: "LIST", arg: "" },
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "CWD", arg: "nonexistent" },
      { cmd: "RETR", arg: "missing.txt" },
      { cmd: "DELE", arg: "ghost.txt" },
      { cmd: "SIZE", arg: "nope.bin" },
      { cmd: "RNTO", arg: "something" },
    ],
  },

  // 10. 総合: 典型的FTPセッション
  {
    name: "総合: 典型的FTPセッション",
    description: "ログイン→ディレクトリ操作→ダウンロード→アップロード→クリーンアップ→切断",
    users: USERS,
    fs: makeFs(),
    commands: [
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "secret" },
      { cmd: "SYST", arg: "" },
      { cmd: "FEAT", arg: "" },
      { cmd: "OPTS", arg: "UTF8 ON" },
      { cmd: "PWD", arg: "" },
      { cmd: "TYPE", arg: "A" },
      { cmd: "PASV", arg: "" },
      { cmd: "LIST", arg: "" },
      { cmd: "SIZE", arg: "readme.txt" },
      { cmd: "RETR", arg: "readme.txt" },
      { cmd: "MKD", arg: "uploads" },
      { cmd: "CWD", arg: "uploads" },
      { cmd: "STOR", arg: "report_v2.txt" },
      { cmd: "LIST", arg: "" },
      { cmd: "CDUP", arg: "" },
      { cmd: "STAT", arg: "" },
      { cmd: "QUIT", arg: "" },
    ],
  },
];
