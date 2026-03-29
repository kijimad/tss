/**
 * X Window Manager シミュレータ Web UI
 * シナリオ選択 + Canvas描画 + イベントログ のパターン
 */

import { XServer } from "../x11/protocol.js";
import { WindowManager, type FocusPolicy } from "../wm/manager.js";
import { ALL_APPS, launchApp, type XApp } from "../clients/apps.js";
import { colorToCSS } from "../hw/hardware.js";

/** シナリオ定義 */
interface Scenario {
  name: string;
  description: string;
  run: (ctx: ScenarioContext) => void;
}

/** シナリオ実行コンテキスト */
interface ScenarioContext {
  server: XServer;
  wm: WindowManager;
  runningApps: Map<number, XApp>;
}

/** シナリオ一覧 */
const SCENARIOS: Scenario[] = [
  {
    name: "デスクトップ起動 (3アプリ)",
    description:
`Xサーバを起動し、xterm, xclock, xeyes の3つの
クライアントアプリケーションをマップする。
WMがフレーム装飾(タイトルバー、枠、ボタン)を
付与し、フォーカスを管理する。`,
    run({ server, wm, runningApps }) {
      launch(server, runningApps, "xterm", 80, 60);
      launch(server, runningApps, "xclock", 540, 80);
      launch(server, runningApps, "xeyes", 540, 340);
    },
  },
  {
    name: "xedit を追加起動",
    description:
`xterm, xclock に加えて xedit (テキストエディタ) を
起動する。MapRequest → フレーミング → フォーカス
設定の流れをイベントログで確認できる。`,
    run({ server, wm, runningApps }) {
      launch(server, runningApps, "xterm", 80, 60);
      launch(server, runningApps, "xclock", 540, 80);
      launch(server, runningApps, "xedit", 200, 320);
    },
  },
  {
    name: "全アプリ起動",
    description:
`xterm, xclock, xeyes, xedit の全4アプリを起動。
各ウィンドウが重ならないよう配置される。
スタック順は起動順(後に起動した方が前面)。`,
    run({ server, wm, runningApps }) {
      launch(server, runningApps, "xterm", 40, 40);
      launch(server, runningApps, "xclock", 500, 40);
      launch(server, runningApps, "xeyes", 500, 300);
      launch(server, runningApps, "xedit", 40, 380);
    },
  },
  {
    name: "ウィンドウ最大化",
    description:
`xterm を起動後、toggleMaximize を呼び出して
画面全体に最大化する。最大化時はリサイズグリップ
が非表示になり、画面いっぱいに描画される。`,
    run({ server, wm, runningApps }) {
      const { windowId } = launch(server, runningApps, "xterm", 80, 60);
      wm.toggleMaximize(windowId);
    },
  },
  {
    name: "ウィンドウ最小化→復元",
    description:
`xterm と xclock を起動し、xterm を最小化した後
復元する。最小化中はフレームが非表示になり、
タスクバーのボタンから復元できる。`,
    run({ server, wm, runningApps }) {
      const { windowId } = launch(server, runningApps, "xterm", 80, 60);
      launch(server, runningApps, "xclock", 540, 80);
      // 最小化
      wm.toggleMinimize(windowId);
      // 復元
      wm.toggleMinimize(windowId);
    },
  },
  {
    name: "フォーカス切替",
    description:
`xterm, xclock, xeyes を起動し、フォーカスを
順番に切り替える。フォーカスされたウィンドウは
タイトルバーとボーダーの色が変化する。`,
    run({ server, wm, runningApps }) {
      const { windowId: w1 } = launch(server, runningApps, "xterm", 80, 60);
      const { windowId: w2 } = launch(server, runningApps, "xclock", 540, 80);
      const { windowId: w3 } = launch(server, runningApps, "xeyes", 540, 340);
      // フォーカスを順番に切り替え
      wm.focus(w1);
      wm.focus(w2);
      wm.focus(w3);
      wm.focus(w1);
    },
  },
  {
    name: "ウィンドウを閉じる",
    description:
`xterm と xclock を起動後、xclock に WM_DELETE_WINDOW
ClientMessage を送信してウィンドウを閉じる。
アンフレーム処理によりフレームも除去される。`,
    run({ server, wm, runningApps }) {
      launch(server, runningApps, "xterm", 80, 60);
      const { windowId: w2 } = launch(server, runningApps, "xclock", 540, 80);
      // xclock を閉じる
      wm.close(w2);
      runningApps.delete(w2);
    },
  },
  {
    name: "スロッピーフォーカス",
    description:
`フォーカスポリシーを sloppy (follow mouse) に設定。
マウスカーソルがウィンドウに入ると自動でフォーカスが
移動する。click-to-focus とは異なる操作感。`,
    run({ server, wm, runningApps }) {
      wm.setFocusPolicy("sloppy");
      launch(server, runningApps, "xterm", 80, 60);
      launch(server, runningApps, "xclock", 540, 80);
      launch(server, runningApps, "xeyes", 540, 340);
    },
  },
  {
    name: "単一アプリ (xclock)",
    description:
`xclock のみを起動するシンプルなシナリオ。
X11クライアントの接続→ウィンドウ作成→プロパティ設定
→MapRequest→フレーミング→表示の一連の流れを確認。`,
    run({ server, wm, runningApps }) {
      launch(server, runningApps, "xclock", 300, 200);
    },
  },
  {
    name: "空のデスクトップ",
    description:
`アプリを一切起動しない空のデスクトップ。
Xサーバのルートウィンドウ(背景)のみが表示される。
WMは待機状態。`,
    run() {
      // 何もしない
    },
  },
];

/** アプリ名で起動するヘルパー */
function launch(
  server: XServer,
  runningApps: Map<number, XApp>,
  appName: string,
  x: number,
  y: number,
): { windowId: number } {
  const app = ALL_APPS.find(a => a.name === appName)!;
  const { windowId } = launchApp(server, app, x, y);
  runningApps.set(windowId, app);
  return { windowId };
}

export class XwmApp {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private logEl!: HTMLElement;
  private descArea!: HTMLTextAreaElement;
  private server!: XServer;
  private wm!: WindowManager;

  /** 起動済みアプリ: windowId → XApp */
  private runningApps = new Map<number, XApp>();
  /** アニメーションID */
  private _animId = 0;
  private startTime = 0;

  private readonly W = 1024;
  private readonly H = 768;

  init(el: HTMLElement | null) {
    if (!el) return;
    this.root = el;
    this.build();
  }

  /** UI構築とイベント接続 */
  private build() {
    this.root.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ========== ヘッダ ==========
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "X Window Manager Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#00d4ff;";
    header.appendChild(title);

    // シナリオ選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < SCENARIOS.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = SCENARIOS[i]!.name;
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#00d4ff;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    // ディスプレイ情報
    const info = document.createElement("span");
    info.style.cssText = "margin-left:auto;font-size:10px;color:#555;font-family:monospace;";
    info.textContent = `Display :0 | ${this.W}x${this.H} | 24bpp`;
    header.appendChild(info);

    this.root.appendChild(header);

    // ========== メイン ==========
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: Canvas (Xデスクトップ)
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid #1e293b;";

    // シナリオ説明テキストエリア
    const descLabel = document.createElement("div");
    descLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#00d4ff;border-bottom:1px solid #1e293b;";
    descLabel.textContent = "シナリオ説明";
    leftPanel.appendChild(descLabel);

    this.descArea = document.createElement("textarea");
    this.descArea.style.cssText = "height:80px;padding:8px 12px;font-family:'Fira Code',monospace;font-size:12px;background:#0f172a;color:#94a3b8;border:none;outline:none;resize:none;border-bottom:1px solid #1e293b;";
    this.descArea.readOnly = true;
    this.descArea.spellcheck = false;
    this.descArea.value = SCENARIOS[0]!.description;
    leftPanel.appendChild(this.descArea);

    // Canvas表示エリア
    const canvasWrap = document.createElement("div");
    canvasWrap.style.cssText = "flex:1;display:flex;justify-content:center;align-items:center;background:#111;overflow:auto;padding:8px;";

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.cssText = "border:1px solid #333;cursor:default;image-rendering:auto;max-width:100%;max-height:100%;";
    canvasWrap.appendChild(this.canvas);
    leftPanel.appendChild(canvasWrap);

    main.appendChild(leftPanel);

    // 右パネル: イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:300px;display:flex;flex-direction:column;";

    const logLabel = document.createElement("div");
    logLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    logLabel.textContent = "X11 Event Log";
    rightPanel.appendChild(logLabel);

    this.logEl = document.createElement("div");
    this.logEl.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;line-height:1.5;color:#888;";
    rightPanel.appendChild(this.logEl);

    main.appendChild(rightPanel);
    this.root.appendChild(main);

    this.ctx = this.canvas.getContext("2d")!;

    // ========== イベントリスナー ==========

    // シナリオ変更
    select.addEventListener("change", () => {
      const scenario = SCENARIOS[Number(select.value)];
      if (scenario) {
        this.descArea.value = scenario.description;
      }
    });

    // 実行ボタン
    runBtn.addEventListener("click", () => {
      this.runScenario(Number(select.value));
    });

    // マウスイベント
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseup", () => this.wm.onButtonRelease());
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // 初回実行
    this.runScenario(0);
  }

  /** シナリオを実行: サーバ・WMをリセットして再初期化 */
  private runScenario(index: number) {
    const scenario = SCENARIOS[index];
    if (!scenario) return;

    // アニメーション停止
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = 0;
    }

    // ログクリア
    this.logEl.innerHTML = "";
    this.runningApps.clear();

    // Xサーバ & WM 再初期化
    this.server = new XServer(this.W, this.H);
    this.wm = new WindowManager(this.server);
    this.server.onLog = (msg) => this.appendLog(msg);
    this.wm.onLog = (msg) => this.appendLog(`[WM] ${msg}`);

    this.appendLog(`=== シナリオ: ${scenario.name} ===`);

    // シナリオ実行
    scenario.run({
      server: this.server,
      wm: this.wm,
      runningApps: this.runningApps,
    });

    // レンダリングループ開始
    this.startTime = performance.now();
    this.animate();
  }

  /** ログ追加 */
  private appendLog(msg: string) {
    const div = document.createElement("div");
    div.textContent = msg;
    this.logEl.appendChild(div);
    if (this.logEl.children.length > 200) {
      this.logEl.removeChild(this.logEl.firstChild!);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // ========== マウスイベント ==========
  private canvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.W / rect.width;
    const scaleY = this.H / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  private onMouseDown(e: MouseEvent) {
    const { x, y } = this.canvasCoords(e);
    const button = e.button === 0 ? 1 : e.button === 2 ? 3 : 2;
    this.wm.onButtonPress(x, y, button);
  }

  private onMouseMove(e: MouseEvent) {
    const { x, y } = this.canvasCoords(e);
    this.wm.onMotionNotify(x, y);
    // ドラッグ中のカーソル変更
    if (this.wm.isDragging()) {
      this.canvas.style.cursor = "grabbing";
    } else {
      this.canvas.style.cursor = "default";
    }
  }

  // ========== レンダリング ==========
  private animate = () => {
    this.drawScreen();
    this._animId = requestAnimationFrame(this.animate);
  };

  private drawScreen() {
    const ctx = this.ctx;
    const time = performance.now() - this.startTime;

    // ルートウィンドウ (デスクトップ背景)
    const root = this.server.getWindow(this.server.rootWindow)!;
    ctx.fillStyle = colorToCSS(root.background);
    ctx.fillRect(0, 0, this.W, this.H);

    // 壁紙パターン
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    for (let y = 0; y < this.H; y += 32) {
      for (let x = 0; x < this.W; x += 32) {
        if ((x + y) % 64 === 0) ctx.fillRect(x, y, 32, 32);
      }
    }

    // マップ済みトップレベルウィンドウを描画 (スタック順)
    const topLevel = this.server.getMappedTopLevel();
    for (const frameWin of topLevel) {
      const managed = this.wm.getManagedWindows().find(m => m.frameWindowId === frameWin.id);
      if (!managed) continue;

      const clientWin = this.server.getWindow(managed.clientWindowId);
      if (!clientWin || !clientWin.mapped) continue;

      const fg = frameWin.geometry;
      const theme = this.wm.theme;
      const focused = this.server.getFocusedWindow() === managed.clientWindowId;

      // フレーム枠
      ctx.fillStyle = colorToCSS(focused ? theme.borderFocusedColor : theme.borderColor);
      ctx.fillRect(fg.x, fg.y, fg.width, fg.height);

      // タイトルバー
      const tbColor = focused ? theme.titleBarFocusedColor : theme.titleBarColor;
      ctx.fillStyle = colorToCSS(tbColor);
      ctx.fillRect(fg.x + theme.borderWidth, fg.y + theme.borderWidth,
        fg.width - theme.borderWidth * 2, theme.titleBarHeight);

      // タイトルテキスト
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = colorToCSS(theme.titleTextColor);
      ctx.fillText(managed.title, fg.x + theme.borderWidth + 8, fg.y + theme.borderWidth + 16, fg.width - 80);

      // ボタン (閉じる、最大化、最小化)
      const btnY = fg.y + theme.borderWidth + 4;
      const bsz = theme.buttonSize;
      const closeBtnX = fg.x + fg.width - theme.borderWidth - bsz - 4;
      const maxBtnX = closeBtnX - bsz - 4;
      const minBtnX = maxBtnX - bsz - 4;

      // 閉じるボタン
      ctx.fillStyle = colorToCSS(theme.closeButtonColor);
      ctx.fillRect(closeBtnX, btnY, bsz, bsz);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(closeBtnX + 3, btnY + 3);
      ctx.lineTo(closeBtnX + bsz - 3, btnY + bsz - 3);
      ctx.moveTo(closeBtnX + bsz - 3, btnY + 3);
      ctx.lineTo(closeBtnX + 3, btnY + bsz - 3);
      ctx.stroke();

      // 最大化ボタン
      ctx.fillStyle = colorToCSS(theme.maximizeButtonColor);
      ctx.fillRect(maxBtnX, btnY, bsz, bsz);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(maxBtnX + 3, btnY + 3, bsz - 6, bsz - 6);

      // 最小化ボタン
      ctx.fillStyle = colorToCSS(theme.minimizeButtonColor);
      ctx.fillRect(minBtnX, btnY, bsz, bsz);
      ctx.beginPath();
      ctx.moveTo(minBtnX + 3, btnY + bsz - 4);
      ctx.lineTo(minBtnX + bsz - 3, btnY + bsz - 4);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // クライアント領域
      const cx = fg.x + theme.borderWidth;
      const cy = fg.y + theme.borderWidth + theme.titleBarHeight;
      const cw = fg.width - theme.borderWidth * 2;
      const ch = fg.height - theme.titleBarHeight - theme.borderWidth * 2;

      // クリッピング
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cw, ch);
      ctx.clip();

      // アプリのdraw呼び出し
      const app = this.runningApps.get(managed.clientWindowId);
      if (app) {
        ctx.translate(cx, cy);
        app.draw(ctx, cw, ch, time);
        ctx.translate(-cx, -cy);
      } else {
        ctx.fillStyle = colorToCSS(clientWin.background);
        ctx.fillRect(cx, cy, cw, ch);
      }
      ctx.restore();

      // リサイズグリップ (右下三角)
      if (!managed.maximized) {
        const gx = fg.x + fg.width - 12;
        const gy = fg.y + fg.height - 12;
        ctx.beginPath();
        ctx.moveTo(gx + 12, gy);
        ctx.lineTo(gx + 12, gy + 12);
        ctx.lineTo(gx, gy + 12);
        ctx.closePath();
        ctx.fillStyle = focused ? "rgba(70,130,220,0.6)" : "rgba(100,100,120,0.5)";
        ctx.fill();
      }
    }
  }
}
