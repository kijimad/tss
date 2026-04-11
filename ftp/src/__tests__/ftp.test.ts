import { describe, it, expect } from "vitest";
import { runSimulation, cloneFs, presets } from "../ftp/index.js";
import type { FsEntry, FtpUser, ClientCommand } from "../ftp/index.js";

const USERS: FtpUser[] = [
  { username: "admin", password: "secret", homeDir: "/home/admin" },
];

function makeSimpleFs(): FsEntry {
  return {
    name: "/", type: "directory", size: 0, modified: "2026-01-01 00:00",
    permissions: "rwxr-xr-x", owner: "root",
    children: [{
      name: "home", type: "directory", size: 0, modified: "2026-01-01 00:00",
      permissions: "rwxr-xr-x", owner: "root",
      children: [{
        name: "admin", type: "directory", size: 0, modified: "2026-01-01 00:00",
        permissions: "rwxr-x---", owner: "admin",
        children: [
          { name: "test.txt", type: "file", size: 11, modified: "2026-01-01 00:00",
            permissions: "rw-r--r--", owner: "admin", content: "hello world" },
          { name: "empty", type: "directory", size: 0, modified: "2026-01-01 00:00",
            permissions: "rwxr-xr-x", owner: "admin", children: [] },
        ],
      }],
    }],
  };
}

function run(commands: ClientCommand[]) {
  return runSimulation(USERS, makeSimpleFs(), commands);
}

function loginCommands(): ClientCommand[] {
  return [
    { cmd: "USER", arg: "admin" },
    { cmd: "PASS", arg: "secret" },
  ];
}

// === 認証 ===
describe("認証", () => {
  it("正しい資格情報でログインできる", () => {
    const result = run(loginCommands());
    const lastStep = result.steps[result.steps.length - 1]!;
    expect(lastStep.session.authenticated).toBe(true);
    expect(lastStep.session.username).toBe("admin");
  });

  it("不正なパスワードでログイン失敗する", () => {
    const result = run([
      { cmd: "USER", arg: "admin" },
      { cmd: "PASS", arg: "wrong" },
    ]);
    const passStep = result.steps.find((s) => s.command?.cmd === "PASS")!;
    expect(passStep.session.authenticated).toBe(false);
    expect(passStep.control.some((c) => c.raw.startsWith("530"))).toBe(true);
  });

  it("USER未送信でPASSを送信するとエラー", () => {
    const result = run([{ cmd: "PASS", arg: "secret" }]);
    const passStep = result.steps.find((s) => s.command?.cmd === "PASS")!;
    expect(passStep.control.some((c) => c.raw.startsWith("503"))).toBe(true);
  });
});

// === ディレクトリ操作 ===
describe("ディレクトリ操作", () => {
  it("PWDが現在のディレクトリを返す", () => {
    const result = run([...loginCommands(), { cmd: "PWD", arg: "" }]);
    const pwdStep = result.steps.find((s) => s.command?.cmd === "PWD")!;
    expect(pwdStep.control.some((c) => c.raw.includes("/home/admin"))).toBe(true);
  });

  it("CWDでディレクトリ移動できる", () => {
    const result = run([...loginCommands(), { cmd: "CWD", arg: "empty" }]);
    const cwdStep = result.steps.find((s) => s.command?.cmd === "CWD")!;
    expect(cwdStep.session.cwd).toBe("/home/admin/empty");
  });

  it("存在しないディレクトリへのCWDはエラー", () => {
    const result = run([...loginCommands(), { cmd: "CWD", arg: "nonexist" }]);
    const cwdStep = result.steps.find((s) => s.command?.cmd === "CWD")!;
    expect(cwdStep.control.some((c) => c.raw.startsWith("550"))).toBe(true);
  });

  it("CDUPで親ディレクトリに移動する", () => {
    const result = run([...loginCommands(), { cmd: "CWD", arg: "empty" }, { cmd: "CDUP", arg: "" }]);
    const cdupStep = result.steps.find((s) => s.command?.cmd === "CDUP")!;
    expect(cdupStep.session.cwd).toBe("/home/admin");
  });
});

// === LIST ===
describe("LIST", () => {
  it("ディレクトリ一覧を取得する", () => {
    const result = run([...loginCommands(), { cmd: "PASV", arg: "" }, { cmd: "LIST", arg: "" }]);
    const listStep = result.steps.find((s) => s.command?.cmd === "LIST")!;
    expect(listStep.dataTransfer).toBeDefined();
    expect(listStep.dataTransfer!.data).toContain("test.txt");
    expect(listStep.dataTransfer!.data).toContain("empty");
  });
});

// === ファイル転送 ===
describe("ファイル転送", () => {
  it("RETRでファイルをダウンロードする", () => {
    const result = run([...loginCommands(), { cmd: "PASV", arg: "" }, { cmd: "RETR", arg: "test.txt" }]);
    const retrStep = result.steps.find((s) => s.command?.cmd === "RETR")!;
    expect(retrStep.dataTransfer).toBeDefined();
    expect(retrStep.dataTransfer!.data).toBe("hello world");
    expect(retrStep.dataTransfer!.direction).toBe("download");
  });

  it("存在しないファイルのRETRはエラー", () => {
    const result = run([...loginCommands(), { cmd: "RETR", arg: "missing.txt" }]);
    const retrStep = result.steps.find((s) => s.command?.cmd === "RETR")!;
    expect(retrStep.control.some((c) => c.raw.startsWith("550"))).toBe(true);
  });

  it("STORでファイルをアップロードする", () => {
    const result = run([...loginCommands(), { cmd: "PASV", arg: "" }, { cmd: "STOR", arg: "new.txt" }]);
    const storStep = result.steps.find((s) => s.command?.cmd === "STOR")!;
    expect(storStep.dataTransfer).toBeDefined();
    expect(storStep.dataTransfer!.direction).toBe("upload");
    // ファイルシステムに追加されていること
    const adminDir = result.finalFs.children![0]!.children![0]!;
    expect(adminDir.children!.some((c) => c.name === "new.txt")).toBe(true);
  });
});

// === 削除 ===
describe("削除", () => {
  it("DELEでファイルを削除する", () => {
    const result = run([...loginCommands(), { cmd: "DELE", arg: "test.txt" }]);
    const deleStep = result.steps.find((s) => s.command?.cmd === "DELE")!;
    expect(deleStep.control.some((c) => c.raw.includes("deleted"))).toBe(true);
    const adminDir = result.finalFs.children![0]!.children![0]!;
    expect(adminDir.children!.some((c) => c.name === "test.txt")).toBe(false);
  });

  it("RMDでディレクトリを削除する", () => {
    const result = run([...loginCommands(), { cmd: "RMD", arg: "empty" }]);
    const rmdStep = result.steps.find((s) => s.command?.cmd === "RMD")!;
    expect(rmdStep.control.some((c) => c.raw.includes("removed"))).toBe(true);
  });
});

// === MKD ===
describe("MKD", () => {
  it("新しいディレクトリを作成する", () => {
    const result = run([...loginCommands(), { cmd: "MKD", arg: "newdir" }]);
    const mkdStep = result.steps.find((s) => s.command?.cmd === "MKD")!;
    expect(mkdStep.control.some((c) => c.raw.includes("created"))).toBe(true);
    const adminDir = result.finalFs.children![0]!.children![0]!;
    expect(adminDir.children!.some((c) => c.name === "newdir" && c.type === "directory")).toBe(true);
  });
});

// === リネーム ===
describe("リネーム", () => {
  it("RNFR/RNTOでファイルをリネームする", () => {
    const result = run([
      ...loginCommands(),
      { cmd: "RNFR", arg: "test.txt" },
      { cmd: "RNTO", arg: "renamed.txt" },
    ]);
    const rntoStep = result.steps.find((s) => s.command?.cmd === "RNTO")!;
    expect(rntoStep.control.some((c) => c.raw.includes("Rename successful"))).toBe(true);
    const adminDir = result.finalFs.children![0]!.children![0]!;
    expect(adminDir.children!.some((c) => c.name === "renamed.txt")).toBe(true);
    expect(adminDir.children!.some((c) => c.name === "test.txt")).toBe(false);
  });
});

// === 転送モード ===
describe("転送モード", () => {
  it("PASVでパッシブモードに設定される", () => {
    const result = run([...loginCommands(), { cmd: "PASV", arg: "" }]);
    const pasvStep = result.steps.find((s) => s.command?.cmd === "PASV")!;
    expect(pasvStep.session.transferMode).toBe("passive");
    expect(pasvStep.control.some((c) => c.raw.includes("Passive Mode"))).toBe(true);
  });

  it("PORTでアクティブモードに設定される", () => {
    const result = run([...loginCommands(), { cmd: "PORT", arg: "127,0,0,1,200,10" }]);
    const portStep = result.steps.find((s) => s.command?.cmd === "PORT")!;
    expect(portStep.session.transferMode).toBe("active");
  });

  it("TYPEでデータタイプを変更する", () => {
    const result = run([...loginCommands(), { cmd: "TYPE", arg: "I" }]);
    const typeStep = result.steps.find((s) => s.command?.cmd === "TYPE")!;
    expect(typeStep.session.dataType).toBe("I");
  });
});

// === QUIT ===
describe("QUIT", () => {
  it("QUITでセッションを切断する", () => {
    const result = run([...loginCommands(), { cmd: "QUIT", arg: "" }]);
    const quitStep = result.steps.find((s) => s.command?.cmd === "QUIT")!;
    expect(quitStep.session.connected).toBe(false);
    expect(quitStep.control.some((c) => c.raw.includes("221"))).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.users, cloneFs(preset.fs), preset.commands);
      expect(result.steps.length, `${preset.name}: ステップが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
