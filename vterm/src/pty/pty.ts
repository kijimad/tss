/**
 * pty.ts -- 疑似端末 (Pseudo Terminal) デバイス
 *
 * 実際の PTY:
 *   カーネル内にマスター/スレーブのペアを作る。
 *   マスター側: ターミナルエミュレータ（xterm 等）が接続
 *   スレーブ側: シェル（bash 等）が /dev/pts/N として接続
 *
 *   ターミナル --write--> [master] ---> [kernel line discipline] ---> [slave] --read--> シェル
 *   ターミナル <--read--- [master] <--- [kernel line discipline] <--- [slave] <-write-- シェル
 *
 *   Line Discipline: エコー、行バッファリング、Ctrl+C 等のシグナル処理
 *
 * ここではマスター/スレーブの双方向パイプと Line Discipline をエミュレートする。
 */

// PTY イベント
export type PtyEvent =
  | { type: "master_write"; data: string; raw: number[] }
  | { type: "slave_write"; data: string; raw: number[] }
  | { type: "master_read"; data: string }
  | { type: "slave_read"; data: string }
  | { type: "signal"; signal: string; key: string }
  | { type: "echo"; char: string }
  | { type: "line_complete"; line: string }
  | { type: "resize"; cols: number; rows: number };

// PTY モード
export interface TerminalMode {
  echo: boolean;        // 入力をエコーバック
  icanon: boolean;      // カノニカルモード（行バッファリング）
  isig: boolean;        // シグナル処理（Ctrl+C → SIGINT）
}

export class PseudoTerminal {
  // サイズ
  cols = 80;
  rows = 24;

  // ターミナルモード
  mode: TerminalMode = { echo: true, icanon: true, isig: true };

  // Line Discipline バッファ（カノニカルモード用）
  private lineBuffer = "";

  // マスター → スレーブ のパイプ
  private masterToSlave: string[] = [];
  // スレーブ → マスター のパイプ
  private slaveToMaster: string[] = [];

  // コールバック
  onMasterRead: ((data: string) => void) | undefined;   // ターミナルが受け取る
  onSlaveRead: ((data: string) => void) | undefined;     // シェルが受け取る

  events: PtyEvent[] = [];
  onEvent: ((event: PtyEvent) => void) | undefined;

  private emit(event: PtyEvent): void { this.events.push(event); this.onEvent?.(event); }

  // === マスター側（ターミナルエミュレータ）===

  // ターミナルからの入力（キーボード → PTY）
  masterWrite(data: string): void {
    const raw = [...data].map(c => c.charCodeAt(0));
    this.emit({ type: "master_write", data: escapeForLog(data), raw });

    for (const ch of data) {
      const code = ch.charCodeAt(0);

      // シグナル処理
      if (this.mode.isig) {
        if (code === 3) { // Ctrl+C → SIGINT
          this.emit({ type: "signal", signal: "SIGINT", key: "Ctrl+C" });
          this.lineBuffer = "";
          this.slaveToMaster.push("\n");
          this.flushToMaster();
          continue;
        }
        if (code === 4) { // Ctrl+D → EOF
          this.emit({ type: "signal", signal: "EOF", key: "Ctrl+D" });
          if (this.lineBuffer.length === 0) {
            this.onSlaveRead?.("__EOF__");
          }
          continue;
        }
        if (code === 26) { // Ctrl+Z → SIGTSTP
          this.emit({ type: "signal", signal: "SIGTSTP", key: "Ctrl+Z" });
          continue;
        }
      }

      if (this.mode.icanon) {
        // カノニカルモード: 行バッファリング
        if (code === 127 || code === 8) {
          // Backspace
          if (this.lineBuffer.length > 0) {
            this.lineBuffer = this.lineBuffer.slice(0, -1);
            if (this.mode.echo) {
              // バックスペース + スペース + バックスペース で画面から消す
              this.slaveToMaster.push("\b \b");
              this.flushToMaster();
            }
          }
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          // Enter → 行をシェルに送る
          if (this.mode.echo) {
            this.slaveToMaster.push("\r\n");
            this.flushToMaster();
          }
          const line = this.lineBuffer;
          this.lineBuffer = "";
          this.emit({ type: "line_complete", line });
          this.onSlaveRead?.(line);
          continue;
        }
        // 通常文字をバッファに追加
        this.lineBuffer += ch;
        if (this.mode.echo) {
          this.emit({ type: "echo", char: ch });
          this.slaveToMaster.push(ch);
          this.flushToMaster();
        }
      } else {
        // Raw モード: 1文字ずつ即座にシェルに送る
        if (this.mode.echo) {
          this.slaveToMaster.push(ch);
          this.flushToMaster();
        }
        this.onSlaveRead?.(ch);
      }
    }
  }

  // ターミナルがデータを読む（PTY → 画面描画）
  masterRead(): string {
    const data = this.slaveToMaster.join("");
    this.slaveToMaster = [];
    if (data.length > 0) {
      this.emit({ type: "master_read", data: escapeForLog(data) });
    }
    return data;
  }

  // === スレーブ側（シェルプロセス）===

  // シェルからの出力（シェル → PTY → ターミナル）
  slaveWrite(data: string): void {
    const raw = [...data].map(c => c.charCodeAt(0));
    this.emit({ type: "slave_write", data: escapeForLog(data), raw });
    this.slaveToMaster.push(data);
    this.flushToMaster();
  }

  // リサイズ（SIGWINCH）
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.emit({ type: "resize", cols, rows });
  }

  // マスター側にフラッシュ
  private flushToMaster(): void {
    const data = this.slaveToMaster.join("");
    this.slaveToMaster = [];
    if (data.length > 0) {
      this.onMasterRead?.(data);
    }
  }

  resetEvents(): void { this.events = []; }
}

function escapeForLog(s: string): string {
  return s.replace(/\x1b/g, "\\e").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
