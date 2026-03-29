/**
 * ウィンドウマネージャ (WM)
 * タイトルバー装飾、移動/リサイズ、フォーカスポリシー、ウィンドウ操作
 */

import { type XServer, type XEvent, EventMask } from "../x11/protocol.js";
import { rgba, type Color } from "../hw/hardware.js";

// ========== WM設定 ==========
export interface WMTheme {
  titleBarHeight: number;
  borderWidth: number;
  titleBarColor: Color;
  titleBarFocusedColor: Color;
  titleTextColor: Color;
  borderColor: Color;
  borderFocusedColor: Color;
  closeButtonColor: Color;
  maximizeButtonColor: Color;
  minimizeButtonColor: Color;
  buttonSize: number;
}

export const DEFAULT_THEME: WMTheme = {
  titleBarHeight: 24,
  borderWidth: 2,
  titleBarColor: rgba(60, 60, 80),
  titleBarFocusedColor: rgba(50, 100, 180),
  titleTextColor: rgba(240, 240, 240),
  borderColor: rgba(80, 80, 100),
  borderFocusedColor: rgba(70, 130, 220),
  closeButtonColor: rgba(220, 60, 60),
  maximizeButtonColor: rgba(60, 180, 60),
  minimizeButtonColor: rgba(220, 180, 40),
  buttonSize: 14,
};

// ========== フォーカスポリシー ==========
export type FocusPolicy = "click" | "sloppy" | "strict";

// ========== WM管理対象ウィンドウ情報 ==========
export interface ManagedWindow {
  clientWindowId: number;
  /** フレームウィンドウID (タイトルバー+枠を含むWM側ウィンドウ) */
  frameWindowId: number;
  title: string;
  maximized: boolean;
  minimized: boolean;
  /** 最大化前のジオメトリ */
  restoreGeometry: { x: number; y: number; width: number; height: number } | null;
}

// ========== ドラッグ状態 ==========
type DragMode = "move" | "resize" | null;

interface DragState {
  mode: DragMode;
  windowId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

// ========== ウィンドウマネージャ ==========
export class WindowManager {
  private server: XServer;
  private client;
  readonly theme: WMTheme;
  private focusPolicy: FocusPolicy = "click";

  private managed = new Map<number, ManagedWindow>();  // clientWindowId → ManagedWindow
  private frameToClient = new Map<number, number>();    // frameWindowId → clientWindowId
  private drag: DragState | null = null;
  /** WM自身による操作中はイベントハンドリングを抑制 */
  private wmAction = false;

  /** イベントリスナー (UI更新通知) */
  onUpdate?: () => void;
  onLog?: (msg: string) => void;

  constructor(server: XServer, theme: WMTheme = DEFAULT_THEME) {
    this.server = server;
    this.theme = theme;

    // WMとしてXサーバに接続
    this.client = server.connect("twm-sim");
    server.registerAsWM(this.client.id);

    // ルートウィンドウに SubstructureRedirect を設定
    server.selectInput(server.rootWindow,
      EventMask.SubstructureRedirect |
      EventMask.SubstructureNotify |
      EventMask.ButtonPress |
      EventMask.PointerMotion
    );

    // サーバイベントをフックして自動処理
    const prevOnEvent = server.onEvent;
    server.onEvent = (event) => {
      prevOnEvent?.(event);
      this.handleEvent(event);
    };
  }

  private log(msg: string): void {
    this.onLog?.(msg);
  }

  /** フォーカスポリシーを取得/設定 */
  getFocusPolicy(): FocusPolicy { return this.focusPolicy; }
  setFocusPolicy(policy: FocusPolicy): void {
    this.focusPolicy = policy;
    this.log(`フォーカスポリシー変更: ${policy}`);
  }

  /** 管理中ウィンドウ一覧 */
  getManagedWindows(): ManagedWindow[] {
    return [...this.managed.values()];
  }

  /** clientWindowId から ManagedWindow を取得 */
  getManaged(clientWindowId: number): ManagedWindow | undefined {
    return this.managed.get(clientWindowId);
  }

  // ========== イベントハンドリング ==========

  /** XイベントをWMとして処理する */
  handleEvent(event: XEvent): void {
    if (this.wmAction) return;
    switch (event.type) {
      case "MapRequest":
        this.onMapRequest(event);
        break;
      case "ConfigureRequest":
        this.onConfigureRequest(event);
        break;
      case "UnmapNotify":
        this.onUnmapNotify(event);
        break;
      case "DestroyNotify":
        this.onDestroyNotify(event);
        break;
    }
  }

  /** MapRequest: クライアントウィンドウにフレームを付けてマップ */
  private onMapRequest(event: XEvent): void {
    const clientWin = this.server.getWindow(event.window);
    if (!clientWin) return;

    // 既に管理済みなら無視
    if (this.managed.has(event.window)) {
      this.server.doMap(event.window);
      return;
    }

    this.frame(event.window);
    this.log(`MapRequest処理: id=${event.window} "${clientWin.title}"`);
  }

  /** ConfigureRequest: WMがジオメトリを調整 */
  private onConfigureRequest(event: XEvent): void {
    // そのまま許可
    this.server.doConfigure(event.window, {
      x: event.x,
      y: event.y,
      width: event.width,
      height: event.height,
    });
  }

  /** UnmapNotify: アンフレーム */
  private onUnmapNotify(event: XEvent): void {
    if (this.managed.has(event.window)) {
      this.unframe(event.window);
    }
  }

  /** DestroyNotify: アンフレーム */
  private onDestroyNotify(event: XEvent): void {
    if (this.managed.has(event.window)) {
      this.unframe(event.window);
    }
  }

  // ========== フレーミング ==========

  /** クライアントウィンドウにフレーム（装飾）を付ける */
  frame(clientWindowId: number): void {
    const clientWin = this.server.getWindow(clientWindowId);
    if (!clientWin) return;

    const th = this.theme.titleBarHeight;
    const bw = this.theme.borderWidth;
    const g = clientWin.geometry;

    // フレームウィンドウをルート直下に作成
    const frameId = this.server.createWindow(
      this.client.id,
      this.server.rootWindow,
      g.x - bw, g.y - th - bw,
      g.width + bw * 2, g.height + th + bw * 2,
      0,
      { background: this.theme.borderColor },
    );

    const info: ManagedWindow = {
      clientWindowId,
      frameWindowId: frameId,
      title: clientWin.title || clientWin.className || `Window ${clientWindowId}`,
      maximized: false,
      minimized: false,
      restoreGeometry: null,
    };
    this.managed.set(clientWindowId, info);
    this.frameToClient.set(frameId, clientWindowId);

    // フレームをマップ
    this.server.doMap(frameId);
    // クライアントウィンドウをマップ
    this.server.doMap(clientWindowId);

    // フォーカスを設定
    this.focus(clientWindowId);
    this.onUpdate?.();
  }

  /** フレームを除去 */
  unframe(clientWindowId: number): void {
    const info = this.managed.get(clientWindowId);
    if (!info) return;

    this.frameToClient.delete(info.frameWindowId);
    this.managed.delete(clientWindowId);
    this.server.destroyWindow(info.frameWindowId);
    this.onUpdate?.();
    this.log(`アンフレーム: id=${clientWindowId}`);
  }

  // ========== ウィンドウ操作 ==========

  /** フォーカスを設定 */
  focus(clientWindowId: number): void {
    this.server.setInputFocus(clientWindowId);
    // フレームを最前面に
    const info = this.managed.get(clientWindowId);
    if (info) {
      this.server.raiseWindow(info.frameWindowId);
    }
    this.onUpdate?.();
  }

  /** ウィンドウを閉じる (ClientMessage: WM_DELETE_WINDOW) */
  close(clientWindowId: number): void {
    const info = this.managed.get(clientWindowId);
    if (!info) return;

    this.server.deliverEvent({
      type: "ClientMessage",
      window: clientWindowId,
      eventWindow: clientWindowId,
      data: "WM_DELETE_WINDOW",
    });

    // シミュレーションでは即座に破棄
    this.wmAction = true;
    this.server.unmapWindow(clientWindowId);
    this.unframe(clientWindowId);
    this.server.destroyWindow(clientWindowId);
    this.wmAction = false;
    this.log(`ウィンドウ閉じる: id=${clientWindowId}`);
  }

  /** 最大化トグル */
  toggleMaximize(clientWindowId: number): void {
    const info = this.managed.get(clientWindowId);
    if (!info) return;
    const clientWin = this.server.getWindow(clientWindowId);
    const frameWin = this.server.getWindow(info.frameWindowId);
    if (!clientWin || !frameWin) return;

    const th = this.theme.titleBarHeight;
    const bw = this.theme.borderWidth;

    if (info.maximized) {
      // 復元
      if (info.restoreGeometry) {
        const rg = info.restoreGeometry;
        this.server.doConfigure(info.frameWindowId, {
          x: rg.x - bw, y: rg.y - th - bw,
          width: rg.width + bw * 2, height: rg.height + th + bw * 2,
        });
        this.server.doConfigure(clientWindowId, rg);
      }
      info.maximized = false;
      info.restoreGeometry = null;
      this.log(`復元: id=${clientWindowId}`);
    } else {
      // 現在のジオメトリを保存
      info.restoreGeometry = { ...clientWin.geometry };
      // 画面いっぱいに
      this.server.doConfigure(info.frameWindowId, {
        x: 0, y: 0,
        width: this.server.screenWidth,
        height: this.server.screenHeight,
      });
      this.server.doConfigure(clientWindowId, {
        x: bw, y: th + bw,
        width: this.server.screenWidth - bw * 2,
        height: this.server.screenHeight - th - bw * 2,
      });
      info.maximized = true;
      this.log(`最大化: id=${clientWindowId}`);
    }
    this.onUpdate?.();
  }

  /** 最小化トグル */
  toggleMinimize(clientWindowId: number): void {
    const info = this.managed.get(clientWindowId);
    if (!info) return;

    this.wmAction = true;
    if (info.minimized) {
      this.server.doMap(info.frameWindowId);
      this.server.doMap(clientWindowId);
      info.minimized = false;
      this.wmAction = false;
      this.focus(clientWindowId);
      this.log(`復元 (最小化解除): id=${clientWindowId}`);
    } else {
      this.server.unmapWindow(info.frameWindowId);
      this.server.unmapWindow(clientWindowId);
      info.minimized = true;
      this.wmAction = false;
      this.log(`最小化: id=${clientWindowId}`);
    }
    this.onUpdate?.();
  }

  // ========== マウスインタラクション ==========

  /** マウスボタン押下: ドラッグ開始 or フォーカス */
  onButtonPress(x: number, y: number, button: number): void {
    // フレームウィンドウ内のクリックを判定
    for (const info of this.managed.values()) {
      const frame = this.server.getWindow(info.frameWindowId);
      if (!frame || !frame.mapped) continue;
      const fg = frame.geometry;

      if (x >= fg.x && x < fg.x + fg.width && y >= fg.y && y < fg.y + fg.height) {
        // フォーカス設定
        this.focus(info.clientWindowId);

        const localY = y - fg.y;
        const localX = x - fg.x;
        const th = this.theme.titleBarHeight;
        const bw = this.theme.borderWidth;
        const bsz = this.theme.buttonSize;

        // タイトルバー領域
        if (localY < th + bw) {
          // 閉じるボタン判定
          const closeBtnX = fg.width - bw - bsz - 4;
          if (localX >= closeBtnX && localX < closeBtnX + bsz && localY >= bw + 4 && localY < bw + 4 + bsz) {
            this.close(info.clientWindowId);
            return;
          }
          // 最大化ボタン判定
          const maxBtnX = closeBtnX - bsz - 4;
          if (localX >= maxBtnX && localX < maxBtnX + bsz && localY >= bw + 4 && localY < bw + 4 + bsz) {
            this.toggleMaximize(info.clientWindowId);
            return;
          }
          // 最小化ボタン判定
          const minBtnX = maxBtnX - bsz - 4;
          if (localX >= minBtnX && localX < minBtnX + bsz && localY >= bw + 4 && localY < bw + 4 + bsz) {
            this.toggleMinimize(info.clientWindowId);
            return;
          }

          // タイトルバードラッグ → 移動
          if (button === 1) {
            this.drag = {
              mode: "move",
              windowId: info.clientWindowId,
              startX: x, startY: y,
              origX: fg.x, origY: fg.y,
              origW: fg.width, origH: fg.height,
            };
          }
          return;
        }

        // 右下角のリサイズ判定 (16pxの領域)
        if (localX >= fg.width - 16 && localY >= fg.height - 16 && button === 1) {
          this.drag = {
            mode: "resize",
            windowId: info.clientWindowId,
            startX: x, startY: y,
            origX: fg.x, origY: fg.y,
            origW: fg.width, origH: fg.height,
          };
          return;
        }

        // クライアント領域のクリック → Xイベントを配信
        this.server.handlePointerEvent("ButtonPress", x, y, button);
        return;
      }
    }

    // ルートウィンドウのクリック
    this.server.handlePointerEvent("ButtonPress", x, y, button);
  }

  /** マウス移動: ドラッグ中なら移動/リサイズ */
  onMotionNotify(x: number, y: number): void {
    if (!this.drag) {
      if (this.focusPolicy === "sloppy") {
        // スロッピーフォーカス: マウスの下のウィンドウにフォーカス
        for (const info of this.managed.values()) {
          const frame = this.server.getWindow(info.frameWindowId);
          if (!frame || !frame.mapped) continue;
          const fg = frame.geometry;
          if (x >= fg.x && x < fg.x + fg.width && y >= fg.y && y < fg.y + fg.height) {
            const focused = this.server.getFocusedWindow();
            if (focused !== info.clientWindowId) {
              this.focus(info.clientWindowId);
            }
            break;
          }
        }
      }
      return;
    }

    const dx = x - this.drag.startX;
    const dy = y - this.drag.startY;
    const info = this.managed.get(this.drag.windowId);
    if (!info) return;

    const th = this.theme.titleBarHeight;
    const bw = this.theme.borderWidth;

    if (this.drag.mode === "move") {
      const newX = this.drag.origX + dx;
      const newY = this.drag.origY + dy;
      this.server.doConfigure(info.frameWindowId, { x: newX, y: newY });
      // クライアントウィンドウも同期
      this.server.doConfigure(info.clientWindowId, {
        x: newX + bw,
        y: newY + th + bw,
      });
    } else if (this.drag.mode === "resize") {
      const newW = Math.max(100, this.drag.origW + dx);
      const newH = Math.max(60, this.drag.origH + dy);
      this.server.doConfigure(info.frameWindowId, { width: newW, height: newH });
      this.server.doConfigure(info.clientWindowId, {
        width: newW - bw * 2,
        height: newH - th - bw * 2,
      });
    }
    this.onUpdate?.();
  }

  /** マウスボタン解放: ドラッグ終了 */
  onButtonRelease(): void {
    this.drag = null;
  }

  /** ドラッグ中かどうか */
  isDragging(): boolean {
    return this.drag !== null;
  }
}
