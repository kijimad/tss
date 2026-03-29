import { describe, it, expect } from "vitest";
import { Framebuffer, rgba, colorToCSS, createDisplay } from "../hw/hardware.js";
import { XServer, EventMask } from "../x11/protocol.js";
import { WindowManager, DEFAULT_THEME } from "../wm/manager.js";
import { ALL_APPS, launchApp, xterm, xclock, xeyes, xedit } from "../clients/apps.js";

describe("ハードウェア", () => {
  it("フレームバッファのピクセル操作が正しい", () => {
    const fb = new Framebuffer(100, 100);
    const red = rgba(255, 0, 0);
    fb.setPixel(10, 20, red);
    const i = (20 * 100 + 10) * 4;
    expect(fb.pixels[i]).toBe(255);
    expect(fb.pixels[i + 1]).toBe(0);
    expect(fb.pixels[i + 2]).toBe(0);
    expect(fb.pixels[i + 3]).toBe(255);
  });

  it("フレームバッファの矩形塗りつぶしが正しい", () => {
    const fb = new Framebuffer(50, 50);
    fb.fillRect(10, 10, 20, 20, rgba(0, 255, 0));
    // 範囲内のピクセル
    const inside = (15 * 50 + 15) * 4;
    expect(fb.pixels[inside + 1]).toBe(255);
    // 範囲外のピクセル
    const outside = (5 * 50 + 5) * 4;
    expect(fb.pixels[outside + 1]).toBe(0);
  });

  it("colorToCSS が正しい文字列を返す", () => {
    expect(colorToCSS(rgba(255, 128, 0, 255))).toBe("rgba(255,128,0,1)");
    expect(colorToCSS(rgba(0, 0, 0, 128))).toContain("0.5");
  });

  it("ディスプレイが正しく生成される", () => {
    const d = createDisplay(800, 600);
    expect(d.name).toBe(":0");
    expect(d.framebuffer.width).toBe(800);
    expect(d.framebuffer.height).toBe(600);
    expect(d.dpi).toBe(96);
  });
});

describe("X11プロトコル", () => {
  it("Xサーバのルートウィンドウが存在する", () => {
    const server = new XServer(1024, 768);
    const root = server.getWindow(server.rootWindow);
    expect(root).toBeDefined();
    expect(root!.geometry.width).toBe(1024);
    expect(root!.geometry.height).toBe(768);
    expect(root!.mapped).toBe(true);
  });

  it("クライアント接続と切断が動作する", () => {
    const server = new XServer();
    const client = server.connect("test-app");
    expect(client.id).toBeGreaterThan(0);
    expect(client.name).toBe("test-app");
    server.disconnect(client.id);
  });

  it("ウィンドウの作成とマップが動作する", () => {
    const server = new XServer();
    const client = server.connect("test");
    const wid = server.createWindow(client.id, server.rootWindow, 100, 100, 300, 200);
    expect(wid).toBeGreaterThan(1);

    const win = server.getWindow(wid);
    expect(win).toBeDefined();
    expect(win!.mapped).toBe(false);
    expect(win!.geometry.width).toBe(300);

    // WMなしなのでそのままマップされる
    server.mapWindow(wid);
    expect(server.getWindow(wid)!.mapped).toBe(true);
  });

  it("ウィンドウの破棄が動作する", () => {
    const server = new XServer();
    const client = server.connect("test");
    const wid = server.createWindow(client.id, server.rootWindow, 0, 0, 100, 100);
    server.destroyWindow(wid);
    expect(server.getWindow(wid)).toBeUndefined();
  });

  it("プロパティ設定で WM_NAME がタイトルに反映される", () => {
    const server = new XServer();
    const client = server.connect("test");
    const wid = server.createWindow(client.id, server.rootWindow, 0, 0, 100, 100);
    server.setProperty(wid, "WM_NAME", "STRING", "Test Window");
    expect(server.getWindow(wid)!.title).toBe("Test Window");
  });

  it("フォーカス設定が動作する", () => {
    const server = new XServer();
    const client = server.connect("test");
    const w1 = server.createWindow(client.id, server.rootWindow, 0, 0, 100, 100);
    const w2 = server.createWindow(client.id, server.rootWindow, 200, 0, 100, 100);

    server.setInputFocus(w1);
    expect(server.getFocusedWindow()).toBe(w1);

    server.setInputFocus(w2);
    expect(server.getFocusedWindow()).toBe(w2);
  });

  it("ウィンドウのスタック順変更が動作する", () => {
    const server = new XServer();
    const client = server.connect("test");
    const w1 = server.createWindow(client.id, server.rootWindow, 0, 0, 100, 100);
    const w2 = server.createWindow(client.id, server.rootWindow, 0, 0, 100, 100);

    const root = server.getWindow(server.rootWindow)!;
    expect(root.children[root.children.length - 1]).toBe(w2);

    server.raiseWindow(w1);
    expect(root.children[root.children.length - 1]).toBe(w1);
  });

  it("座標からウィンドウを検索できる", () => {
    const server = new XServer(800, 600);
    const client = server.connect("test");
    const wid = server.createWindow(client.id, server.rootWindow, 100, 100, 200, 200);
    server.doMap(wid);

    // ウィンドウ内の座標
    expect(server.findWindowAt(150, 150)).toBe(wid);
    // ウィンドウ外の座標
    expect(server.findWindowAt(50, 50)).toBe(server.rootWindow);
  });

  it("WM登録後 MapRequest が WM に配信される", () => {
    const server = new XServer();
    const wmClient = server.connect("wm");
    server.registerAsWM(wmClient.id);
    server.selectInput(server.rootWindow, EventMask.SubstructureRedirect);

    const appClient = server.connect("app");
    const wid = server.createWindow(appClient.id, server.rootWindow, 0, 0, 300, 200);
    server.setProperty(wid, "WM_NAME", "STRING", "Test");
    server.mapWindow(wid);

    // WM のイベントキューに MapRequest がある
    expect(wmClient.eventQueue.some(e => e.type === "MapRequest")).toBe(true);
    // ウィンドウはまだマップされていない (WM が処理する)
    expect(server.getWindow(wid)!.mapped).toBe(false);
  });
});

describe("ウィンドウマネージャ", () => {
  function setup() {
    const server = new XServer(1024, 768);
    const wm = new WindowManager(server);
    return { server, wm };
  }

  it("アプリ起動時にフレーミングされる", () => {
    const { server, wm } = setup();
    const { windowId } = launchApp(server, xterm, 100, 100);

    // WMイベントを処理
    const wmClient = server.connect("_dummy");
    // MapRequest はWMが内部処理している
    const managed = wm.getManagedWindows();
    expect(managed).toHaveLength(1);
    expect(managed[0]!.clientWindowId).toBe(windowId);
    expect(managed[0]!.title).toBe("xterm");
  });

  it("複数ウィンドウが管理される", () => {
    const { server, wm } = setup();
    launchApp(server, xterm, 50, 50);
    launchApp(server, xclock, 300, 100);
    launchApp(server, xedit, 200, 200);

    expect(wm.getManagedWindows()).toHaveLength(3);
  });

  it("フォーカスが切り替わる", () => {
    const { server, wm } = setup();
    const { windowId: w1 } = launchApp(server, xterm, 50, 50);
    const { windowId: w2 } = launchApp(server, xclock, 300, 100);

    wm.focus(w1);
    expect(server.getFocusedWindow()).toBe(w1);

    wm.focus(w2);
    expect(server.getFocusedWindow()).toBe(w2);
  });

  it("ウィンドウを閉じるとアンフレームされる", () => {
    const { server, wm } = setup();
    const { windowId } = launchApp(server, xterm, 100, 100);
    expect(wm.getManagedWindows()).toHaveLength(1);

    wm.close(windowId);
    expect(wm.getManagedWindows()).toHaveLength(0);
  });

  it("最大化と復元が動作する", () => {
    const { server, wm } = setup();
    const { windowId } = launchApp(server, xterm, 100, 100);
    const info = wm.getManaged(windowId)!;

    expect(info.maximized).toBe(false);
    wm.toggleMaximize(windowId);
    expect(info.maximized).toBe(true);
    expect(info.restoreGeometry).not.toBeNull();

    wm.toggleMaximize(windowId);
    expect(info.maximized).toBe(false);
  });

  it("最小化と復元が動作する", () => {
    const { server, wm } = setup();
    const { windowId } = launchApp(server, xterm, 100, 100);
    const info = wm.getManaged(windowId)!;

    expect(info.minimized).toBe(false);
    wm.toggleMinimize(windowId);
    expect(info.minimized).toBe(true);

    wm.toggleMinimize(windowId);
    expect(info.minimized).toBe(false);
  });

  it("フォーカスポリシーが変更できる", () => {
    const { wm } = setup();
    expect(wm.getFocusPolicy()).toBe("click");
    wm.setFocusPolicy("sloppy");
    expect(wm.getFocusPolicy()).toBe("sloppy");
  });

  it("テーマ設定が正しい", () => {
    const { wm } = setup();
    expect(wm.theme.titleBarHeight).toBe(24);
    expect(wm.theme.buttonSize).toBe(14);
  });
});

describe("Xクライアントアプリ", () => {
  it("全アプリが定義されている", () => {
    expect(ALL_APPS).toHaveLength(4);
    expect(ALL_APPS.map(a => a.name)).toEqual(["xterm", "xclock", "xeyes", "xedit"]);
  });

  it("各アプリに必要なプロパティがある", () => {
    for (const app of ALL_APPS) {
      expect(app.name).toBeTruthy();
      expect(app.className).toBeTruthy();
      expect(app.width).toBeGreaterThan(0);
      expect(app.height).toBeGreaterThan(0);
      expect(typeof app.draw).toBe("function");
    }
  });

  it("launchApp でウィンドウが作成される", () => {
    const server = new XServer();
    const wm = new WindowManager(server);
    const { clientId, windowId } = launchApp(server, xterm, 100, 100);
    expect(clientId).toBeGreaterThan(0);
    expect(windowId).toBeGreaterThan(1);

    const win = server.getWindow(windowId);
    expect(win!.title).toBe("xterm");
    expect(win!.className).toBe("XTerm");
  });
});
