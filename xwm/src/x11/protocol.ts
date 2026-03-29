/**
 * X11 プロトコルシミュレーション
 * Xサーバ、ウィンドウ階層、Xイベント、クライアント接続
 */

import { type Color, rgba } from "../hw/hardware.js";

// ========== ウィンドウ属性 ==========
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth: number;
}

// ========== X イベントマスク ==========
export enum EventMask {
  NoEvent = 0,
  KeyPress = 1 << 0,
  KeyRelease = 1 << 1,
  ButtonPress = 1 << 2,
  ButtonRelease = 1 << 3,
  PointerMotion = 1 << 5,
  EnterWindow = 1 << 4,
  LeaveWindow = 1 << 6,
  Exposure = 1 << 15,
  StructureNotify = 1 << 17,
  SubstructureNotify = 1 << 19,
  SubstructureRedirect = 1 << 20,
  FocusChange = 1 << 21,
  PropertyChange = 1 << 22,
}

// ========== X イベントタイプ ==========
export type XEventType =
  | "KeyPress" | "KeyRelease"
  | "ButtonPress" | "ButtonRelease"
  | "MotionNotify"
  | "EnterNotify" | "LeaveNotify"
  | "Expose"
  | "MapRequest" | "MapNotify"
  | "UnmapNotify"
  | "ConfigureRequest" | "ConfigureNotify"
  | "DestroyNotify"
  | "FocusIn" | "FocusOut"
  | "PropertyNotify"
  | "ClientMessage";

// ========== X イベント ==========
export interface XEvent {
  type: XEventType;
  window: number;       // ウィンドウID
  /** イベント送信先 (SubstructureRedirect 時はルートウィンドウ) */
  eventWindow: number;
  x?: number;
  y?: number;
  rootX?: number;
  rootY?: number;
  button?: number;
  keycode?: number;
  width?: number;
  height?: number;
  data?: string;
}

// ========== Xプロパティ (EWMH/ICCCM) ==========
export interface XProperty {
  name: string;
  type: string;
  value: string | number | number[];
}

// ========== X ウィンドウ ==========
export interface XWindow {
  id: number;
  parent: number;          // 親ウィンドウID
  geometry: WindowGeometry;
  mapped: boolean;         // 表示状態
  overrideRedirect: boolean;  // WM をバイパスするか
  eventMask: number;
  background: Color;
  borderColor: Color;
  properties: Map<string, XProperty>;
  clientId: number | null; // 所有するクライアントID (ルートはnull)
  children: number[];      // 子ウィンドウID
  title: string;
  className: string;
  inputOnly: boolean;
}

// ========== Xクライアント (アプリケーション接続) ==========
export interface XClient {
  id: number;
  name: string;
  windowIds: number[];     // このクライアントが所有するウィンドウ
  eventQueue: XEvent[];
}

// ========== Xサーバ ==========
export class XServer {
  readonly displayName: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly rootWindow: number;

  private nextWindowId = 2;   // 1 = ルートウィンドウ
  private nextClientId = 1;
  private windows = new Map<number, XWindow>();
  private clients = new Map<number, XClient>();

  /** WMクライアントID (SubstructureRedirect を受ける) */
  private wmClientId: number | null = null;

  /** イベントリスナー (UIレンダリング用) */
  onEvent?: (event: XEvent) => void;
  /** ログリスナー */
  onLog?: (msg: string) => void;

  constructor(width: number = 1024, height: number = 768) {
    this.displayName = ":0";
    this.screenWidth = width;
    this.screenHeight = height;

    // ルートウィンドウを作成
    this.rootWindow = 1;
    this.windows.set(1, {
      id: 1,
      parent: 0,
      geometry: { x: 0, y: 0, width, height, borderWidth: 0 },
      mapped: true,
      overrideRedirect: false,
      eventMask: 0,
      background: rgba(47, 79, 79),  // DarkSlateGray
      borderColor: rgba(0, 0, 0),
      properties: new Map(),
      clientId: null,
      children: [],
      title: "Root Window",
      className: "root",
      inputOnly: false,
    });
  }

  private log(msg: string): void {
    this.onLog?.(msg);
  }

  // ========== クライアント管理 ==========

  /** 新しいクライアント接続を受け付ける */
  connect(name: string): XClient {
    const id = this.nextClientId++;
    const client: XClient = { id, name, windowIds: [], eventQueue: [] };
    this.clients.set(id, client);
    this.log(`クライアント接続: ${name} (id=${id})`);
    return client;
  }

  /** クライアント切断 */
  disconnect(clientId: number): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    // 所有ウィンドウをすべて破棄
    for (const wid of [...client.windowIds]) {
      this.destroyWindow(wid);
    }
    this.clients.delete(clientId);
    if (this.wmClientId === clientId) this.wmClientId = null;
    this.log(`クライアント切断: ${client.name}`);
  }

  // ========== ウィンドウ管理 ==========

  /** ウィンドウを取得 */
  getWindow(id: number): XWindow | undefined {
    return this.windows.get(id);
  }

  /** 全ウィンドウを取得 */
  getAllWindows(): XWindow[] {
    return [...this.windows.values()];
  }

  /** マップ済みトップレベルウィンドウ一覧 (ルート直下) */
  getMappedTopLevel(): XWindow[] {
    const root = this.windows.get(this.rootWindow)!;
    return root.children
      .map(id => this.windows.get(id))
      .filter((w): w is XWindow => w !== undefined && w.mapped);
  }

  /** ウィンドウを作成 (XCreateWindow) */
  createWindow(
    clientId: number,
    parent: number,
    x: number, y: number,
    width: number, height: number,
    borderWidth: number = 0,
    opts: {
      overrideRedirect?: boolean;
      background?: Color;
      inputOnly?: boolean;
    } = {},
  ): number {
    const parentWin = this.windows.get(parent);
    if (!parentWin) return -1;

    const id = this.nextWindowId++;
    const win: XWindow = {
      id,
      parent,
      geometry: { x, y, width, height, borderWidth },
      mapped: false,
      overrideRedirect: opts.overrideRedirect ?? false,
      eventMask: 0,
      background: opts.background ?? rgba(255, 255, 255),
      borderColor: rgba(0, 0, 0),
      properties: new Map(),
      clientId,
      children: [],
      title: "",
      className: "",
      inputOnly: opts.inputOnly ?? false,
    };
    this.windows.set(id, win);
    parentWin.children.push(id);

    const client = this.clients.get(clientId);
    if (client) client.windowIds.push(id);

    this.log(`CreateWindow: id=${id} parent=${parent} ${width}x${height}+${x}+${y}`);
    return id;
  }

  /** ウィンドウを破棄 (XDestroyWindow) */
  destroyWindow(windowId: number): void {
    const win = this.windows.get(windowId);
    if (!win || windowId === this.rootWindow) return;

    // 子ウィンドウも再帰的に破棄
    for (const child of [...win.children]) {
      this.destroyWindow(child);
    }

    // 親から削除
    const parent = this.windows.get(win.parent);
    if (parent) {
      parent.children = parent.children.filter(c => c !== windowId);
    }

    // クライアントから削除
    if (win.clientId !== null) {
      const client = this.clients.get(win.clientId);
      if (client) {
        client.windowIds = client.windowIds.filter(w => w !== windowId);
      }
    }

    this.windows.delete(windowId);
    this.deliverEvent({ type: "DestroyNotify", window: windowId, eventWindow: win.parent });
    this.log(`DestroyWindow: id=${windowId}`);
  }

  /** ウィンドウをマップ (XMapWindow) */
  mapWindow(windowId: number): void {
    const win = this.windows.get(windowId);
    if (!win || win.mapped) return;

    // overrideRedirect でないトップレベルウィンドウは WM に MapRequest を送る
    if (!win.overrideRedirect && win.parent === this.rootWindow && this.wmClientId !== null) {
      this.deliverEvent({
        type: "MapRequest",
        window: windowId,
        eventWindow: this.rootWindow,
      });
      this.log(`MapRequest: id=${windowId} → WM`);
      return;
    }

    // 直接マップ
    this.doMap(windowId);
  }

  /** 実際にマップを実行 (WMから呼ばれる) */
  doMap(windowId: number): void {
    const win = this.windows.get(windowId);
    if (!win) return;
    win.mapped = true;
    this.deliverEvent({ type: "MapNotify", window: windowId, eventWindow: windowId });
    this.deliverEvent({
      type: "Expose",
      window: windowId,
      eventWindow: windowId,
      x: 0, y: 0,
      width: win.geometry.width,
      height: win.geometry.height,
    });
    this.log(`MapNotify: id=${windowId} "${win.title}"`);
  }

  /** ウィンドウをアンマップ (XUnmapWindow) */
  unmapWindow(windowId: number): void {
    const win = this.windows.get(windowId);
    if (!win || !win.mapped) return;
    win.mapped = false;
    this.deliverEvent({ type: "UnmapNotify", window: windowId, eventWindow: win.parent });
    this.log(`UnmapNotify: id=${windowId}`);
  }

  /** ウィンドウ移動・リサイズ (XConfigureWindow) */
  configureWindow(windowId: number, changes: Partial<WindowGeometry>): void {
    const win = this.windows.get(windowId);
    if (!win) return;

    // WM が管理中ならConfigureRequestをWMに送る
    if (!win.overrideRedirect && win.parent === this.rootWindow && this.wmClientId !== null && win.clientId !== this.wmClientId) {
      this.deliverEvent({
        type: "ConfigureRequest",
        window: windowId,
        eventWindow: this.rootWindow,
        x: changes.x ?? win.geometry.x,
        y: changes.y ?? win.geometry.y,
        width: changes.width ?? win.geometry.width,
        height: changes.height ?? win.geometry.height,
      });
      return;
    }

    this.doConfigure(windowId, changes);
  }

  /** 実際にconfigureを実行 */
  doConfigure(windowId: number, changes: Partial<WindowGeometry>): void {
    const win = this.windows.get(windowId);
    if (!win) return;
    Object.assign(win.geometry, changes);
    this.deliverEvent({
      type: "ConfigureNotify",
      window: windowId,
      eventWindow: windowId,
      x: win.geometry.x,
      y: win.geometry.y,
      width: win.geometry.width,
      height: win.geometry.height,
    });
    this.log(`ConfigureNotify: id=${windowId} ${win.geometry.width}x${win.geometry.height}+${win.geometry.x}+${win.geometry.y}`);
  }

  /** プロパティ設定 (XChangeProperty) */
  setProperty(windowId: number, name: string, type: string, value: string | number | number[]): void {
    const win = this.windows.get(windowId);
    if (!win) return;
    win.properties.set(name, { name, type, value });

    // WM_NAME → titleに反映
    if (name === "WM_NAME" && typeof value === "string") {
      win.title = value;
    }
    if (name === "WM_CLASS" && typeof value === "string") {
      win.className = value;
    }

    this.deliverEvent({
      type: "PropertyNotify",
      window: windowId,
      eventWindow: windowId,
      data: name,
    });
  }

  /** イベントマスク設定 (XSelectInput) */
  selectInput(windowId: number, mask: number): void {
    const win = this.windows.get(windowId);
    if (!win) return;

    // SubstructureRedirect をルートウィンドウに設定 → WM登録
    if (windowId === this.rootWindow && (mask & EventMask.SubstructureRedirect)) {
      if (this.wmClientId !== null) {
        this.log("エラー: 別のWMが既に登録されています");
        return;
      }
      // マスクを設定したクライアントを探す
      for (const [cid, client] of this.clients) {
        if (client.windowIds.length === 0 || mask & EventMask.SubstructureRedirect) {
          this.wmClientId = cid;
          this.log(`WM登録: client=${cid} (${client.name})`);
          break;
        }
      }
    }
    win.eventMask = mask;
  }

  /** WMクライアントIDで登録 */
  registerAsWM(clientId: number): void {
    if (this.wmClientId !== null) {
      this.log("エラー: 別のWMが既に登録されています");
      return;
    }
    this.wmClientId = clientId;
    const client = this.clients.get(clientId);
    this.log(`WM登録: client=${clientId} (${client?.name ?? "unknown"})`);
  }

  /** ウィンドウのスタック順を最前面に */
  raiseWindow(windowId: number): void {
    const win = this.windows.get(windowId);
    if (!win) return;
    const parent = this.windows.get(win.parent);
    if (!parent) return;
    parent.children = parent.children.filter(c => c !== windowId);
    parent.children.push(windowId);
    this.log(`RaiseWindow: id=${windowId}`);
  }

  /** ウィンドウのスタック順を最背面に */
  lowerWindow(windowId: number): void {
    const win = this.windows.get(windowId);
    if (!win) return;
    const parent = this.windows.get(win.parent);
    if (!parent) return;
    parent.children = parent.children.filter(c => c !== windowId);
    parent.children.unshift(windowId);
  }

  /** フォーカス設定 (XSetInputFocus) */
  setInputFocus(windowId: number): void {
    // 現在フォーカスされているウィンドウにFocusOutを送る
    for (const w of this.windows.values()) {
      if (w.properties.has("_FOCUSED")) {
        w.properties.delete("_FOCUSED");
        this.deliverEvent({ type: "FocusOut", window: w.id, eventWindow: w.id });
      }
    }
    const win = this.windows.get(windowId);
    if (win) {
      win.properties.set("_FOCUSED", { name: "_FOCUSED", type: "CARDINAL", value: 1 });
      this.deliverEvent({ type: "FocusIn", window: windowId, eventWindow: windowId });
      this.log(`SetInputFocus: id=${windowId}`);
    }
  }

  /** フォーカス中のウィンドウIDを取得 */
  getFocusedWindow(): number | null {
    for (const w of this.windows.values()) {
      if (w.properties.has("_FOCUSED")) return w.id;
    }
    return null;
  }

  // ========== イベント配信 ==========

  /** イベントを配信 */
  deliverEvent(event: XEvent): void {
    this.onEvent?.(event);

    // WMクライアントに配信 (MapRequest, ConfigureRequest)
    if (event.type === "MapRequest" || event.type === "ConfigureRequest") {
      if (this.wmClientId !== null) {
        const wm = this.clients.get(this.wmClientId);
        wm?.eventQueue.push(event);
      }
      return;
    }

    // ウィンドウの所有クライアントに配信
    const win = this.windows.get(event.window);
    if (win?.clientId !== null && win?.clientId !== undefined) {
      const client = this.clients.get(win.clientId);
      client?.eventQueue.push(event);
    }
  }

  /** 座標からウィンドウを検索 (最前面優先) */
  findWindowAt(x: number, y: number): number {
    const root = this.windows.get(this.rootWindow)!;
    return this.findWindowAtRecursive(root, x, y);
  }

  private findWindowAtRecursive(parent: XWindow, x: number, y: number): number {
    // 子を逆順 (最前面から) に探索
    for (let i = parent.children.length - 1; i >= 0; i--) {
      const childId = parent.children[i]!;
      const child = this.windows.get(childId);
      if (!child || !child.mapped || child.inputOnly) continue;
      const g = child.geometry;
      if (x >= g.x && x < g.x + g.width && y >= g.y && y < g.y + g.height) {
        return this.findWindowAtRecursive(child, x - g.x, y - g.y);
      }
    }
    return parent.id;
  }

  /** マウスイベントをXイベントに変換して配信 */
  handlePointerEvent(type: "ButtonPress" | "ButtonRelease" | "MotionNotify", x: number, y: number, button?: number): void {
    const windowId = this.findWindowAt(x, y);
    this.deliverEvent({
      type,
      window: windowId,
      eventWindow: windowId,
      x, y,
      rootX: x, rootY: y,
      button,
    });
  }

  /** キーイベントを配信 */
  handleKeyEvent(type: "KeyPress" | "KeyRelease", keycode: number): void {
    const focused = this.getFocusedWindow() ?? this.rootWindow;
    this.deliverEvent({
      type,
      window: focused,
      eventWindow: focused,
      keycode,
    });
  }
}
