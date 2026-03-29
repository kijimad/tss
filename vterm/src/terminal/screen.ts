/**
 * screen.ts -- VT100 ターミナルエミュレータ
 *
 * VT100 エスケープシーケンスを解釈してスクリーンバッファを更新する。
 *
 * スクリーンバッファ:
 *   rows × cols のセル配列。各セルは1文字 + 属性(色、太字等)。
 *   カーソル位置 (row, col) を管理。
 *
 * エスケープシーケンス (CSI = ESC [ ):
 *   ESC [ n A     カーソル上に n 行移動
 *   ESC [ n B     カーソル下に n 行移動
 *   ESC [ n C     カーソル右に n 列移動
 *   ESC [ n D     カーソル左に n 列移動
 *   ESC [ n ; m H カーソルを (n, m) に移動
 *   ESC [ 2 J     画面クリア
 *   ESC [ K       行末までクリア
 *   ESC [ n m     SGR: 色・属性設定
 *     0=リセット 1=太字 30-37=前景色 40-47=背景色 90-97=明るい前景色
 */

// セル（1文字分）
export interface Cell {
  char: string;
  fg: number;      // 前景色 (0-15, -1=デフォルト)
  bg: number;      // 背景色
  bold: boolean;
  underline: boolean;
  inverse: boolean;
}

// ターミナルイベント
export type TermEvent =
  | { type: "char"; char: string; row: number; col: number }
  | { type: "escape"; sequence: string; description: string }
  | { type: "cursor_move"; row: number; col: number }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "clear"; area: string };

const DEFAULT_CELL: Cell = { char: " ", fg: -1, bg: -1, bold: false, underline: false, inverse: false };

export class TerminalScreen {
  readonly rows: number;
  readonly cols: number;
  buffer: Cell[][];
  cursorRow = 0;
  cursorCol = 0;
  // 現在の属性
  private currentFg = -1;
  private currentBg = -1;
  private currentBold = false;
  private currentUnderline = false;
  private currentInverse = false;
  // パーサー状態
  private parseState: "normal" | "escape" | "csi" = "normal";
  private csiBuffer = "";
  // スクロールリージョン
  private scrollTop = 0;
  private scrollBottom: number;
  // 代替バッファ（vim 等で使用）
  private savedBuffer: Cell[][] | undefined;
  private savedCursor: { row: number; col: number } | undefined;

  events: TermEvent[] = [];
  onEvent: ((event: TermEvent) => void) | undefined;

  constructor(rows = 24, cols = 80) {
    this.rows = rows;
    this.cols = cols;
    this.scrollBottom = rows - 1;
    this.buffer = [];
    for (let r = 0; r < rows; r++) {
      this.buffer.push(this.newRow());
    }
  }

  private emit(event: TermEvent): void { this.events.push(event); this.onEvent?.(event); }

  // データを書き込む（エスケープシーケンスを含む）
  write(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i] ?? "";
      const code = ch.charCodeAt(0);

      switch (this.parseState) {
        case "normal":
          if (code === 0x1b) {
            this.parseState = "escape";
          } else if (ch === "\r") {
            this.cursorCol = 0;
          } else if (ch === "\n") {
            this.lineFeed();
          } else if (ch === "\b") {
            if (this.cursorCol > 0) this.cursorCol--;
          } else if (ch === "\t") {
            this.cursorCol = Math.min(this.cols - 1, (Math.floor(this.cursorCol / 8) + 1) * 8);
          } else if (code === 7) {
            // BEL (ベル) — 無視
          } else if (code >= 32) {
            this.putChar(ch);
          }
          break;

        case "escape":
          if (ch === "[") {
            this.parseState = "csi";
            this.csiBuffer = "";
          } else if (ch === "7") {
            // カーソル位置保存
            this.savedCursor = { row: this.cursorRow, col: this.cursorCol };
            this.parseState = "normal";
          } else if (ch === "8") {
            // カーソル位置復元
            if (this.savedCursor !== undefined) {
              this.cursorRow = this.savedCursor.row;
              this.cursorCol = this.savedCursor.col;
            }
            this.parseState = "normal";
          } else {
            this.parseState = "normal";
          }
          break;

        case "csi":
          if ((code >= 0x30 && code <= 0x3f) || ch === ";") {
            // パラメータ文字を収集
            this.csiBuffer += ch;
          } else {
            // 終端文字
            this.executeCsi(this.csiBuffer, ch);
            this.parseState = "normal";
          }
          break;
      }
    }
  }

  // CSI シーケンスを実行
  private executeCsi(params: string, command: string): void {
    const args = params.split(";").map(s => s === "" ? 0 : Number(s));
    const n = args[0] ?? 1;
    const m = args[1] ?? 1;

    switch (command) {
      case "A": // カーソル上
        this.cursorRow = Math.max(0, this.cursorRow - (n || 1));
        this.emit({ type: "escape", sequence: `CSI ${params}A`, description: `Cursor up ${String(n || 1)}` });
        break;
      case "B": // カーソル下
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + (n || 1));
        this.emit({ type: "escape", sequence: `CSI ${params}B`, description: `Cursor down ${String(n || 1)}` });
        break;
      case "C": // カーソル右
        this.cursorCol = Math.min(this.cols - 1, this.cursorCol + (n || 1));
        this.emit({ type: "escape", sequence: `CSI ${params}C`, description: `Cursor right ${String(n || 1)}` });
        break;
      case "D": // カーソル左
        this.cursorCol = Math.max(0, this.cursorCol - (n || 1));
        this.emit({ type: "escape", sequence: `CSI ${params}D`, description: `Cursor left ${String(n || 1)}` });
        break;
      case "H": case "f": // カーソル位置設定
        this.cursorRow = Math.min(this.rows - 1, Math.max(0, (n || 1) - 1));
        this.cursorCol = Math.min(this.cols - 1, Math.max(0, (m || 1) - 1));
        this.emit({ type: "escape", sequence: `CSI ${params}H`, description: `Cursor to (${String(this.cursorRow)},${String(this.cursorCol)})` });
        break;
      case "J": // 画面クリア
        if (n === 2 || n === 3) {
          // 全画面クリア
          for (let r = 0; r < this.rows; r++) this.buffer[r] = this.newRow();
          this.emit({ type: "clear", area: "screen" });
        } else if (n === 0) {
          // カーソル以降をクリア
          for (let c = this.cursorCol; c < this.cols; c++) this.setCell(this.cursorRow, c, DEFAULT_CELL);
          for (let r = this.cursorRow + 1; r < this.rows; r++) this.buffer[r] = this.newRow();
        } else if (n === 1) {
          // カーソル以前をクリア
          for (let r = 0; r < this.cursorRow; r++) this.buffer[r] = this.newRow();
          for (let c = 0; c <= this.cursorCol; c++) this.setCell(this.cursorRow, c, DEFAULT_CELL);
        }
        break;
      case "K": // 行クリア
        if (n === 0 || params === "") {
          for (let c = this.cursorCol; c < this.cols; c++) this.setCell(this.cursorRow, c, DEFAULT_CELL);
        } else if (n === 1) {
          for (let c = 0; c <= this.cursorCol; c++) this.setCell(this.cursorRow, c, DEFAULT_CELL);
        } else if (n === 2) {
          this.buffer[this.cursorRow] = this.newRow();
        }
        this.emit({ type: "clear", area: `line ${String(n)}` });
        break;
      case "m": // SGR (色・属性)
        this.applySgr(args);
        break;
      case "r": // スクロールリージョン設定
        this.scrollTop = (n || 1) - 1;
        this.scrollBottom = (m || this.rows) - 1;
        break;
      case "h": // モード設定
        if (params === "?1049") {
          // 代替バッファに切り替え
          this.savedBuffer = this.buffer.map(row => [...row]);
          for (let r = 0; r < this.rows; r++) this.buffer[r] = this.newRow();
        }
        if (params === "?25") {
          // カーソル表示（無視）
        }
        break;
      case "l": // モード解除
        if (params === "?1049" && this.savedBuffer !== undefined) {
          this.buffer = this.savedBuffer;
          this.savedBuffer = undefined;
        }
        break;
      case "G": // カーソルを列 n に移動
        this.cursorCol = Math.min(this.cols - 1, Math.max(0, (n || 1) - 1));
        break;
      case "d": // カーソルを行 n に移動
        this.cursorRow = Math.min(this.rows - 1, Math.max(0, (n || 1) - 1));
        break;
    }
  }

  // SGR (Select Graphic Rendition) — 色と属性
  private applySgr(args: number[]): void {
    for (const code of args) {
      if (code === 0) { this.currentFg = -1; this.currentBg = -1; this.currentBold = false; this.currentUnderline = false; this.currentInverse = false; }
      else if (code === 1) this.currentBold = true;
      else if (code === 4) this.currentUnderline = true;
      else if (code === 7) this.currentInverse = true;
      else if (code === 22) this.currentBold = false;
      else if (code === 24) this.currentUnderline = false;
      else if (code === 27) this.currentInverse = false;
      else if (code >= 30 && code <= 37) this.currentFg = code - 30;
      else if (code >= 40 && code <= 47) this.currentBg = code - 40;
      else if (code >= 90 && code <= 97) this.currentFg = code - 90 + 8;
      else if (code >= 100 && code <= 107) this.currentBg = code - 100 + 8;
      else if (code === 39) this.currentFg = -1;
      else if (code === 49) this.currentBg = -1;
    }
    this.emit({ type: "escape", sequence: `SGR ${args.join(";")}`, description: `fg=${String(this.currentFg)} bg=${String(this.currentBg)} bold=${String(this.currentBold)}` });
  }

  // 文字を書き込む
  private putChar(ch: string): void {
    if (this.cursorCol >= this.cols) {
      this.cursorCol = 0;
      this.lineFeed();
    }
    this.setCell(this.cursorRow, this.cursorCol, {
      char: ch, fg: this.currentFg, bg: this.currentBg,
      bold: this.currentBold, underline: this.currentUnderline, inverse: this.currentInverse,
    });
    this.emit({ type: "char", char: ch, row: this.cursorRow, col: this.cursorCol });
    this.cursorCol++;
  }

  // 改行
  private lineFeed(): void {
    if (this.cursorRow >= this.scrollBottom) {
      this.scrollUp();
    } else {
      this.cursorRow++;
    }
    this.emit({ type: "cursor_move", row: this.cursorRow, col: this.cursorCol });
  }

  // スクロールアップ（最上行を消して最下行に空行を追加）
  private scrollUp(): void {
    this.buffer.splice(this.scrollTop, 1);
    const newRow = this.newRow();
    this.buffer.splice(this.scrollBottom, 0, newRow);
    this.emit({ type: "scroll", direction: "up" });
  }

  private newRow(): Cell[] {
    return new Array(this.cols).fill(null).map(() => ({ ...DEFAULT_CELL }));
  }

  private setCell(row: number, col: number, cell: Cell): void {
    const r = this.buffer[row];
    if (r !== undefined) r[col] = cell;
  }

  getCell(row: number, col: number): Cell {
    return this.buffer[row]?.[col] ?? DEFAULT_CELL;
  }

  // 画面の全テキストを取得（デバッグ用）
  getText(): string {
    return this.buffer.map(row => row.map(c => c.char).join("").trimEnd()).join("\n");
  }

  // 特定行のテキスト
  getLineText(row: number): string {
    return (this.buffer[row] ?? []).map(c => c.char).join("").trimEnd();
  }

  resetEvents(): void { this.events = []; }
}

// ANSI カラー (0-15)
export const ANSI_COLORS = [
  "#000000", "#cc0000", "#00cc00", "#cccc00", "#0000cc", "#cc00cc", "#00cccc", "#cccccc", // 0-7 通常
  "#666666", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff", // 8-15 明るい
];
