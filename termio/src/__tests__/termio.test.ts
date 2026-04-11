/* UNIX 端末入出力 シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, executeSimulation, defaultConfig,
  defaultTermios, rawTermios, cbreakTermios, charName,
} from "../termio/engine.js";
import { PRESETS } from "../termio/presets.js";
import type { SimOp } from "../termio/types.js";

/** ヘルパー: シンプルなSimOp作成 */
function mkOp(instructions: SimOp["instructions"]): SimOp {
  return { type: "execute", config: defaultConfig(), ttyName: "/dev/tty0", instructions };
}

describe("Terminal I/O Engine", () => {

  // ─── 正規モード ───

  describe("正規モード", () => {
    it("改行で入力バッファがフラッシュされる", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "a" },
        { op: "keypress", char: "b" },
        { op: "keypress", char: "\n" },
        { op: "read_stdin" },
      ]));
      // readイベントで "ab\n" が読める
      expect(result.events.some(e => e.type === "input" && e.message.includes("ab\\n"))).toBe(true);
    });

    it("エコーバックが画面に表示される", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "X" },
        { op: "keypress", char: "Y" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.tty.screen.some(l => l.includes("XY"))).toBe(true);
    });

    it("改行前のread_stdinはデータなし", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "a" },
        { op: "read_stdin" },
      ]));
      expect(result.events.some(e => e.message.includes("ブロック") || e.message.includes("データなし"))).toBe(true);
    });

    it("Backspaceで文字が削除される", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "a" },
        { op: "keypress", char: "b" },
        { op: "keypress", char: "\x7f" },
        { op: "keypress", char: "\n" },
        { op: "read_stdin" },
      ]));
      // バッファは "a\n"
      expect(result.events.some(e => e.type === "input" && e.message.includes("a\\n"))).toBe(true);
    });

    it("Ctrl+Uで行が削除される", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "h" },
        { op: "keypress", char: "e" },
        { op: "keypress", char: "l" },
        { op: "keypress", char: "\x15" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.tty.inputBuffer).toBe("");
      expect(result.events.some(e => e.message.includes("行削除"))).toBe(true);
    });
  });

  // ─── EOF ───

  describe("EOF (Ctrl+D)", () => {
    it("バッファ内容ありでCtrl+D → フラッシュ", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "A" },
        { op: "keypress", char: "\x04" },
      ]));
      expect(result.events.some(e => e.message.includes("EOF") && e.message.includes("バッファフラッシュ"))).toBe(true);
    });

    it("空バッファでCtrl+D → EOF", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "\x04" },
      ]));
      expect(result.events.some(e => e.message.includes("空読み") || e.message.includes("ファイル終端"))).toBe(true);
    });
  });

  // ─── rawモード ───

  describe("rawモード", () => {
    it("1文字ずつ即座に読める", () => {
      const result = executeSimulation(mkOp([
        { op: "set_raw" },
        { op: "keypress", char: "x" },
        { op: "read_stdin" },
      ]));
      expect(result.events.some(e => e.type === "input" && e.message.includes("raw入力"))).toBe(true);
    });

    it("Ctrl+Cがシグナルにならない", () => {
      const result = executeSimulation(mkOp([
        { op: "set_raw" },
        { op: "keypress", char: "\x03" },
      ]));
      // シグナルイベントなし
      expect(result.events.some(e => e.type === "signal")).toBe(false);
    });

    it("ECHOがオフ", () => {
      const result = executeSimulation(mkOp([
        { op: "set_raw" },
        { op: "keypress", char: "Z" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      // エコーなし → 画面に Z が表示されない
      expect(lastStep.tty.screen.every(l => !l.includes("Z"))).toBe(true);
    });
  });

  // ─── cbreakモード ───

  describe("cbreakモード", () => {
    it("Ctrl+Cがシグナルになる (ISIG=on)", () => {
      const result = executeSimulation(mkOp([
        { op: "set_cbreak" },
        { op: "keypress", char: "\x03" },
      ]));
      expect(result.events.some(e => e.type === "signal" && e.message.includes("SIGINT"))).toBe(true);
    });
  });

  // ─── シグナル ───

  describe("シグナル", () => {
    it("Ctrl+C → SIGINT でプロセスが終了", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "\x03" },
      ]));
      expect(result.events.some(e => e.type === "signal" && e.message.includes("SIGINT"))).toBe(true);
    });

    it("Ctrl+Z → SIGTSTP でプロセスが停止", () => {
      const result = executeSimulation(mkOp([
        { op: "spawn", name: "app", pgid: 1 },
        { op: "keypress", char: "\x1a" },
      ]));
      expect(result.events.some(e => e.type === "signal" && e.message.includes("SIGTSTP"))).toBe(true);
    });
  });

  // ─── 入力変換 ───

  describe("入力変換", () => {
    it("ICRNL: CR → NL", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "h" },
        { op: "keypress", char: "\r" },
      ]));
      expect(result.events.some(e => e.message.includes("ICRNL"))).toBe(true);
      // CRがNLに変換されて行完成
      expect(result.events.some(e => e.message.includes("行完成"))).toBe(true);
    });

    it("ICRNL=off でCRがそのまま", () => {
      const result = executeSimulation(mkOp([
        { op: "tcsetattr", changes: { iflag: { ICRNL: false } } },
        { op: "keypress", char: "\r" },
      ]));
      // ICRNL変換イベントが発生しないこと（tcsetattrのイベントは除外）
      expect(result.events.every(e => !e.message.includes("ICRNL: CR"))).toBe(true);
    });
  });

  // ─── 出力処理 ───

  describe("出力処理", () => {
    it("write_stdout が画面に反映される", () => {
      const result = executeSimulation(mkOp([
        { op: "write_stdout", text: "Hello\n" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.tty.screen.some(l => l.includes("Hello"))).toBe(true);
    });

    it("ONLCR: NL → CR+NL", () => {
      const result = executeSimulation(mkOp([
        { op: "write_stdout", text: "A\nB" },
      ]));
      expect(result.events.some(e => e.type === "output")).toBe(true);
    });
  });

  // ─── フロー制御 ───

  describe("フロー制御", () => {
    it("Ctrl+S で出力停止、Ctrl+Q で再開", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "\x13" },
        { op: "write_stdout", text: "buffered" },
        { op: "keypress", char: "\x11" },
      ]));
      expect(result.events.some(e => e.type === "flow_control" && e.message.includes("XOFF"))).toBe(true);
      expect(result.events.some(e => e.type === "flow_control" && e.message.includes("XON"))).toBe(true);
    });

    it("XOFF中の出力がバッファリングされる", () => {
      const result = executeSimulation(mkOp([
        { op: "keypress", char: "\x13" },
        { op: "write_stdout", text: "data" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.tty.outputBuffer.length).toBeGreaterThan(0);
    });
  });

  // ─── PTY ───

  describe("PTY", () => {
    it("PTYが開設される", () => {
      const result = executeSimulation(mkOp([
        { op: "pty_open" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.pty).not.toBeNull();
      expect(result.events.some(e => e.type === "pty")).toBe(true);
    });

    it("PTYマスターに書き込みできる", () => {
      const result = executeSimulation(mkOp([
        { op: "pty_open" },
        { op: "pty_write", text: "hello" },
      ]));
      expect(result.events.some(e => e.type === "pty" && e.message.includes("write"))).toBe(true);
    });
  });

  // ─── termios操作 ───

  describe("termios", () => {
    it("tcgetattr で現在の設定を取得", () => {
      const result = executeSimulation(mkOp([
        { op: "tcgetattr" },
      ]));
      expect(result.events.some(e => e.type === "termios_change" && e.message.includes("canonical"))).toBe(true);
    });

    it("tcsetattr で設定を変更", () => {
      const result = executeSimulation(mkOp([
        { op: "tcsetattr", changes: { lflag: { ECHO: false } } },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.tty.termios.lflag.ECHO).toBe(false);
    });
  });

  // ─── プロセス制御 ───

  describe("プロセス制御", () => {
    it("spawnでプロセスが生成される", () => {
      const result = executeSimulation(mkOp([
        { op: "spawn", name: "cat" },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.processes.length).toBe(2);
    });

    it("fg_processでフォアグラウンド変更", () => {
      const result = executeSimulation(mkOp([
        { op: "spawn", name: "vim", pgid: 2 },
        { op: "fg_process", pid: 2 },
      ]));
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.tty.foregroundPgid).toBe(2);
    });
  });

  // ─── ヘルパー ───

  describe("ヘルパー", () => {
    it("charName が制御文字を変換", () => {
      expect(charName("\x03")).toBe("Ctrl+C");
      expect(charName("\x04")).toBe("Ctrl+D");
      expect(charName("\x1a")).toBe("Ctrl+Z");
      expect(charName("\n")).toBe("Enter(LF)");
      expect(charName("a")).toBe("'a'");
    });

    it("defaultTermios が正規モード", () => {
      const t = defaultTermios();
      expect(t.lflag.ICANON).toBe(true);
      expect(t.lflag.ECHO).toBe(true);
      expect(t.lflag.ISIG).toBe(true);
    });

    it("rawTermios がrawモード", () => {
      const t = rawTermios();
      expect(t.lflag.ICANON).toBe(false);
      expect(t.lflag.ECHO).toBe(false);
      expect(t.lflag.ISIG).toBe(false);
    });

    it("cbreakTermios がcbreakモード", () => {
      const t = cbreakTermios();
      expect(t.lflag.ICANON).toBe(false);
      expect(t.lflag.ECHO).toBe(false);
      expect(t.lflag.ISIG).toBe(true);
    });
  });

  // ─── simulate ───

  describe("simulate", () => {
    it("複数操作が実行される", () => {
      const r = simulate([
        mkOp([{ op: "write_stdout", text: "a" }]),
        mkOp([{ op: "write_stdout", text: "b" }]),
      ]);
      expect(r.steps.length).toBe(2);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.steps.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
