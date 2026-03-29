/**
 * サンプル Xクライアントアプリケーション
 * xterm, xclock, xeyes, xedit をシミュレート
 */

import { type XServer } from "../x11/protocol.js";
import { rgba, type Color } from "../hw/hardware.js";

// ========== Xクライアントアプリ定義 ==========
export interface XApp {
  name: string;
  className: string;
  title: string;
  width: number;
  height: number;
  background: Color;
  /** Canvas描画コールバック */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => void;
}

/** xterm: ターミナルエミュレータ */
export const xterm: XApp = {
  name: "xterm",
  className: "XTerm",
  title: "xterm",
  width: 400,
  height: 280,
  background: rgba(0, 0, 0),
  draw(ctx, w, h, _time) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "13px monospace";
    ctx.fillStyle = "#0f0";
    const lines = [
      "$ uname -a",
      "XWM-Sim 1.0 x86_64 GNU/Linux",
      "$ whoami",
      "user",
      "$ ls -la",
      "total 32",
      "drwxr-xr-x  4 user user 4096 Mar 29 12:00 .",
      "drwxr-xr-x  3 user user 4096 Mar 29 11:00 ..",
      "-rw-r--r--  1 user user  220 Mar 29 10:00 .bashrc",
      "-rw-r--r--  1 user user  807 Mar 29 10:00 .profile",
      "drwxr-xr-x  2 user user 4096 Mar 29 12:00 Documents",
      "$ _",
    ];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, 6, 18 + i * 18);
    }
  },
};

/** xclock: アナログ時計 */
export const xclock: XApp = {
  name: "xclock",
  className: "XClock",
  title: "xclock",
  width: 200,
  height: 200,
  background: rgba(230, 230, 230),
  draw(ctx, w, h, time) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 10;

    // 文字盤
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 目盛り
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6 - Math.PI / 2;
      const inner = i % 3 === 0 ? r - 12 : r - 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * (r - 2), cy + Math.sin(angle) * (r - 2));
      ctx.lineWidth = i % 3 === 0 ? 2 : 1;
      ctx.stroke();
    }

    // 時間 (シミュレーション時間ベース)
    const sec = (time / 1000) % 60;
    const min = ((time / 60000) % 60) + sec / 60;
    const hr = ((time / 3600000) % 12) + min / 60;

    // 短針
    const hAngle = (hr * Math.PI) / 6 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hAngle) * r * 0.5, cy + Math.sin(hAngle) * r * 0.5);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#222";
    ctx.stroke();

    // 長針
    const mAngle = (min * Math.PI) / 30 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(mAngle) * r * 0.7, cy + Math.sin(mAngle) * r * 0.7);
    ctx.lineWidth = 2;
    ctx.stroke();

    // 秒針
    const sAngle = (sec * Math.PI) / 30 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sAngle) * r * 0.8, cy + Math.sin(sAngle) * r * 0.8);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#c00";
    ctx.stroke();

    // 中心点
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#c00";
    ctx.fill();
  },
};

/** xeyes: マウス追従する目 */
export const xeyes: XApp = {
  name: "xeyes",
  className: "XEyes",
  title: "xeyes",
  width: 200,
  height: 140,
  background: rgba(230, 230, 230),
  draw(ctx, w, h, time) {
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, w, h);

    // マウス位置をシミュレート (時間で回転)
    const angle = (time / 2000) * Math.PI * 2;

    for (const ex of [w * 0.3, w * 0.7]) {
      const ey = h * 0.5;
      const rOuter = Math.min(w * 0.2, h * 0.35);
      const rInner = rOuter * 0.4;

      // 白目
      ctx.beginPath();
      ctx.ellipse(ex, ey, rOuter, rOuter * 1.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 瞳 (マウス方向に追従)
      const maxDist = rOuter - rInner;
      const px = ex + Math.cos(angle) * maxDist * 0.6;
      const py = ey + Math.sin(angle) * maxDist * 0.6;
      ctx.beginPath();
      ctx.arc(px, py, rInner, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();
    }
  },
};

/** xedit: テキストエディタ */
export const xedit: XApp = {
  name: "xedit",
  className: "Xedit",
  title: "xedit",
  width: 360,
  height: 240,
  background: rgba(255, 255, 255),
  draw(ctx, w, h, _time) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);

    // メニューバー
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, w, 22);
    ctx.strokeStyle = "#bbb";
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(w, 22);
    ctx.stroke();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#333";
    ctx.fillText("File", 8, 15);
    ctx.fillText("Edit", 50, 15);
    ctx.fillText("Help", 92, 15);

    // テキスト領域
    ctx.font = "13px monospace";
    ctx.fillStyle = "#222";
    const text = [
      "# X Window Manager シミュレータ",
      "",
      "このファイルはxeditで開いています。",
      "ウィンドウマネージャが装飾を",
      "管理しています。",
      "",
      "タイトルバーをドラッグして移動、",
      "右下をドラッグしてリサイズできます。",
    ];
    for (let i = 0; i < text.length; i++) {
      ctx.fillText(text[i]!, 6, 40 + i * 18);
    }

    // カーソル
    ctx.fillStyle = "#000";
    ctx.fillRect(6, 40 + text.length * 18, 8, 16);
  },
};

/** 全サンプルアプリ */
export const ALL_APPS: XApp[] = [xterm, xclock, xeyes, xedit];

/** Xサーバにアプリを起動 (ウィンドウ作成→プロパティ設定→マップ) */
export function launchApp(
  server: XServer,
  app: XApp,
  x?: number,
  y?: number,
): { clientId: number; windowId: number } {
  const client = server.connect(app.name);
  const px = x ?? 50 + Math.floor(Math.random() * 200);
  const py = y ?? 50 + Math.floor(Math.random() * 200);
  const windowId = server.createWindow(
    client.id, server.rootWindow,
    px, py, app.width, app.height, 0,
    { background: app.background },
  );
  server.setProperty(windowId, "WM_NAME", "STRING", app.title);
  server.setProperty(windowId, "WM_CLASS", "STRING", app.className);
  server.setProperty(windowId, "WM_PROTOCOLS", "ATOM", "WM_DELETE_WINDOW");
  server.mapWindow(windowId);

  return { clientId: client.id, windowId };
}
