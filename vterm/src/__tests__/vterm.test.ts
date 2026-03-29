import { describe, it, expect } from "vitest";
import { PseudoTerminal } from "../pty/pty.js";
import { TerminalScreen, ANSI_COLORS } from "../terminal/screen.js";
import { Shell } from "../shell/shell.js";

describe("PTY", () => {
  it("マスター書き込み → エコー → マスター読み取り", () => {
    const pty = new PseudoTerminal();
    let received = "";
    pty.onMasterRead = (data) => { received += data; };
    pty.masterWrite("a");
    expect(received).toBe("a");
  });

  it("Enter で行がスレーブに送られる", () => {
    const pty = new PseudoTerminal();
    let slaveLine = "";
    pty.onSlaveRead = (data) => { slaveLine = data; };
    pty.masterWrite("hello\r");
    expect(slaveLine).toBe("hello");
  });

  it("Backspace で文字が消える", () => {
    const pty = new PseudoTerminal();
    let slaveLine = "";
    pty.onSlaveRead = (data) => { slaveLine = data; };
    pty.masterWrite("helo\x7F\x7Fllo\r");
    expect(slaveLine).toBe("hello");
  });

  it("Ctrl+C で SIGINT イベント", () => {
    const pty = new PseudoTerminal();
    pty.masterWrite("test\x03");
    const sigs = pty.events.filter(e => e.type === "signal");
    expect(sigs.length).toBe(1);
    if (sigs[0]?.type === "signal") expect(sigs[0].signal).toBe("SIGINT");
  });

  it("スレーブ書き込み → マスター読み取り", () => {
    const pty = new PseudoTerminal();
    let received = "";
    pty.onMasterRead = (data) => { received += data; };
    pty.slaveWrite("output from shell");
    expect(received).toBe("output from shell");
  });
});

describe("TerminalScreen", () => {
  it("文字を書き込む", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("Hello");
    expect(screen.getLineText(0)).toBe("Hello");
    expect(screen.cursorCol).toBe(5);
  });

  it("改行", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("Line1\r\nLine2");
    expect(screen.getLineText(0)).toBe("Line1");
    expect(screen.getLineText(1)).toBe("Line2");
  });

  it("画面クリア ESC[2J", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("text");
    screen.write("\x1b[2J");
    expect(screen.getLineText(0)).toBe("");
  });

  it("カーソル移動 ESC[H", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("\x1b[5;10H");
    expect(screen.cursorRow).toBe(4);
    expect(screen.cursorCol).toBe(9);
  });

  it("色設定 ESC[31m (赤)", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("\x1b[31mRed");
    const cell = screen.getCell(0, 0);
    expect(cell.fg).toBe(1); // 赤
    expect(cell.char).toBe("R");
  });

  it("太字 ESC[1m", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("\x1b[1mBold");
    expect(screen.getCell(0, 0).bold).toBe(true);
  });

  it("リセット ESC[0m", () => {
    const screen = new TerminalScreen(24, 80);
    screen.write("\x1b[31mRed\x1b[0mNormal");
    expect(screen.getCell(0, 0).fg).toBe(1);
    expect(screen.getCell(0, 3).fg).toBe(-1);
  });

  it("行末折り返し", () => {
    const screen = new TerminalScreen(24, 10);
    screen.write("1234567890AB");
    expect(screen.getLineText(0)).toBe("1234567890");
    expect(screen.getLineText(1)).toBe("AB");
  });

  it("スクロール", () => {
    const screen = new TerminalScreen(3, 80);
    screen.write("Line1\r\nLine2\r\nLine3\r\nLine4");
    // Line1 がスクロールアウトして Line2 が先頭に
    expect(screen.getLineText(0)).toBe("Line2");
    expect(screen.getLineText(2)).toBe("Line4");
  });

  it("ANSI_COLORS が16色定義されている", () => {
    expect(ANSI_COLORS).toHaveLength(16);
  });
});

describe("Shell + PTY + Screen 統合", () => {
  it("シェルが起動してプロンプトが表示される", () => {
    const pty = new PseudoTerminal();
    const screen = new TerminalScreen(24, 80);
    pty.onMasterRead = (data) => screen.write(data);
    const shell = new Shell(pty);
    shell.start();
    const text = screen.getText();
    expect(text).toContain("user@host");
    expect(text).toContain("$");
  });

  it("コマンドを実行して出力を得る", () => {
    const pty = new PseudoTerminal();
    const screen = new TerminalScreen(24, 80);
    pty.onMasterRead = (data) => screen.write(data);
    const shell = new Shell(pty);
    shell.start();
    pty.masterWrite("echo hello\r");
    const text = screen.getText();
    expect(text).toContain("hello");
  });
});
