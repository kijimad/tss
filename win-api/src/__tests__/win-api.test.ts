import { describe, it, expect } from "vitest";
import { runWinApiSim } from "../engine/engine.js";
import { PRESETS } from "../engine/presets.js";
import type { WinApiCall } from "../engine/types.js";

// ── ヘルパー ──

function run(calls: WinApiCall[]) {
  return runWinApiSim(calls);
}

// ══════════════════════════════════════
//  ハンドルシステム
// ══════════════════════════════════════

describe("ハンドルシステム", () => {
  it("ウィンドウ作成でハンドルが割り当てられる", () => {
    const r = run([
      { api: "RegisterClass", className: "Test", wndProc: "TestProc" },
      { api: "CreateWindowEx", className: "Test", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
    ]);
    const snap = r.snapshots[2]!;
    const active = snap.handles.filter(h => !h.closed);
    expect(active.length).toBeGreaterThan(0);
    expect(active.some(h => h.type === "window")).toBe(true);
  });

  it("CloseHandleでハンドルが解放される", () => {
    const r = run([
      { api: "CreateFile", path: "test.txt", access: "READ" },
      { api: "CloseHandle", handle: 0x1000 },
    ]);
    const snap = r.snapshots[2]!;
    const closed = snap.handles.filter(h => h.closed);
    expect(closed.length).toBe(1);
  });

  it("無効なハンドルのCloseHandleでエラーイベント", () => {
    const r = run([
      { api: "CloseHandle", handle: 0x9999 },
    ]);
    expect(r.allEvents.some(e => e.type === "error")).toBe(true);
  });
});

// ══════════════════════════════════════
//  ウィンドウシステム
// ══════════════════════════════════════

describe("ウィンドウシステム", () => {
  it("RegisterClassでクラスが登録される", () => {
    const r = run([
      { api: "RegisterClass", className: "MyClass", wndProc: "MyProc" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.wndClasses).toHaveLength(1);
    expect(snap.wndClasses[0]!.className).toBe("MyClass");
  });

  it("CreateWindowExでウィンドウが作成される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "Test Window", x: 10, y: 20, w: 640, h: 480, parent: 0 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.windows).toHaveLength(1);
    expect(snap.windows[0]!.title).toBe("Test Window");
    expect(snap.windows[0]!.visible).toBe(false);
  });

  it("ShowWindowでvisibleになる", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "ShowWindow", hwnd: 0x1000, cmd: "SW_SHOW" },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.windows[0]!.visible).toBe(true);
  });

  it("CreateWindowExでWM_CREATEがキューに入る", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.messageQueue.some(m => m.msg === "WM_CREATE")).toBe(true);
  });

  it("DestroyWindowでウィンドウが破棄される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "DestroyWindow", hwnd: 0x1000 },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.windows).toHaveLength(0);
  });
});

// ══════════════════════════════════════
//  メッセージシステム
// ══════════════════════════════════════

describe("メッセージシステム", () => {
  it("PostMessageでキューにメッセージが追加される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "PostMessage", hwnd: 0x1000, msg: "WM_USER", wParam: 42, lParam: 0 },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.messageQueue.some(m => m.msg === "WM_USER")).toBe(true);
  });

  it("GetMessageでキューからメッセージが取り出される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "GetMessage" },
    ]);
    expect(r.allEvents.some(e => e.type === "msg_dispatch")).toBe(true);
  });

  it("PostQuitMessageでWM_QUITがキューに入る", () => {
    const r = run([
      { api: "PostQuitMessage", exitCode: 0 },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.messageQueue.some(m => m.msg === "WM_QUIT")).toBe(true);
  });

  it("SendMessageで同期呼び出しイベントが発生", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "SendMessage", hwnd: 0x1000, msg: "WM_TIMER", wParam: 1, lParam: 0 },
    ]);
    expect(r.allEvents.some(e => e.type === "msg_send")).toBe(true);
    expect(r.allEvents.some(e => e.type === "msg_proc")).toBe(true);
  });
});

// ══════════════════════════════════════
//  GDI
// ══════════════════════════════════════

describe("GDI描画", () => {
  it("BeginPaintでDCが作成される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "BeginPaint", hwnd: 0x1000 },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.deviceContexts).toHaveLength(1);
    expect(snap.handles.some(h => h.type === "dc")).toBe(true);
  });

  it("GdiDrawで描画コマンドが記録される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "BeginPaint", hwnd: 0x1000 },
      { api: "GdiDraw", hdc: 0x1001, cmd: { op: "Rectangle", x1: 0, y1: 0, x2: 50, y2: 50 } },
      { api: "GdiDraw", hdc: 0x1001, cmd: { op: "TextOut", x: 10, y: 10, text: "Hello" } },
    ]);
    const snap = r.snapshots[5]!;
    expect(snap.deviceContexts[0]!.commands).toHaveLength(2);
  });

  it("EndPaintでDCが解放される", () => {
    const r = run([
      { api: "RegisterClass", className: "WC", wndProc: "WP" },
      { api: "CreateWindowEx", className: "WC", title: "T", x: 0, y: 0, w: 100, h: 100, parent: 0 },
      { api: "BeginPaint", hwnd: 0x1000 },
      { api: "EndPaint", hwnd: 0x1000 },
    ]);
    const snap = r.snapshots[4]!;
    expect(snap.deviceContexts).toHaveLength(0);
  });
});

// ══════════════════════════════════════
//  プロセス / スレッド
// ══════════════════════════════════════

describe("プロセス管理", () => {
  it("CreateProcessでプロセスが作成される", () => {
    const r = run([
      { api: "CreateProcess", name: "test.exe", commandLine: "test.exe" },
    ]);
    const snap = r.snapshots[1]!;
    // 初期プロセス + 新規プロセス
    expect(snap.processes).toHaveLength(2);
    expect(snap.processes[1]!.name).toBe("test.exe");
    expect(snap.processes[1]!.state).toBe("running");
  });

  it("TerminateProcessでプロセスが終了する", () => {
    const r = run([
      { api: "CreateProcess", name: "test.exe", commandLine: "" },
      { api: "TerminateProcess", hProcess: 0x1000, exitCode: 1 },
    ]);
    const snap = r.snapshots[2]!;
    const proc = snap.processes.find(p => p.name === "test.exe");
    expect(proc!.state).toBe("terminated");
    expect(proc!.exitCode).toBe(1);
  });

  it("CreateThreadでスレッドが追加される", () => {
    const r = run([
      { api: "CreateThread", entryPoint: "Worker" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.processes[0]!.threads.length).toBeGreaterThan(1);
  });
});

// ══════════════════════════════════════
//  仮想メモリ
// ══════════════════════════════════════

describe("仮想メモリ", () => {
  it("VirtualAlloc RESERVEで予約状態になる", () => {
    const r = run([
      { api: "VirtualAlloc", address: 0x10000, size: 4096, allocType: "RESERVE", protect: "PAGE_NOACCESS" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.virtualMemory).toHaveLength(1);
    expect(snap.virtualMemory[0]!.state).toBe("reserved");
  });

  it("VirtualAlloc COMMITでコミット状態になる", () => {
    const r = run([
      { api: "VirtualAlloc", address: 0x10000, size: 4096, allocType: "COMMIT", protect: "PAGE_READWRITE" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.virtualMemory[0]!.state).toBe("committed");
    expect(snap.virtualMemory[0]!.protect).toBe("PAGE_READWRITE");
  });

  it("VirtualFree DECOMMITで予約状態に戻る", () => {
    const r = run([
      { api: "VirtualAlloc", address: 0x10000, size: 4096, allocType: "COMMIT", protect: "PAGE_READWRITE" },
      { api: "VirtualFree", address: 0x10000, freeType: "DECOMMIT" },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.virtualMemory[0]!.state).toBe("reserved");
  });

  it("VirtualFree RELEASEで領域が解放される", () => {
    const r = run([
      { api: "VirtualAlloc", address: 0x10000, size: 4096, allocType: "COMMIT", protect: "PAGE_READWRITE" },
      { api: "VirtualFree", address: 0x10000, freeType: "RELEASE" },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.virtualMemory).toHaveLength(0);
  });
});

// ══════════════════════════════════════
//  ファイルI/O
// ══════════════════════════════════════

describe("ファイルI/O", () => {
  it("CreateFileでファイルが開かれる", () => {
    const r = run([
      { api: "CreateFile", path: "C:\\test.txt", access: "READWRITE" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.files).toHaveLength(1);
    expect(snap.files[0]!.path).toBe("C:\\test.txt");
  });

  it("WriteFileでデータが書き込まれる", () => {
    const r = run([
      { api: "CreateFile", path: "test.txt", access: "WRITE" },
      { api: "WriteFile", hFile: 0x1000, data: "Hello" },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.files[0]!.content).toBe("Hello");
    expect(snap.files[0]!.size).toBe(5);
  });

  it("SetFilePointer + ReadFileで読み取りできる", () => {
    const r = run([
      { api: "CreateFile", path: "test.txt", access: "READWRITE" },
      { api: "WriteFile", hFile: 0x1000, data: "Hello World" },
      { api: "SetFilePointer", hFile: 0x1000, offset: 0 },
      { api: "ReadFile", hFile: 0x1000, bytes: 5 },
    ]);
    expect(r.allEvents.some(e => e.type === "file_read" && e.message.includes("Hello"))).toBe(true);
  });

  it("CloseHandleでファイルが閉じられる", () => {
    const r = run([
      { api: "CreateFile", path: "test.txt", access: "READ" },
      { api: "CloseHandle", handle: 0x1000 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.files).toHaveLength(0);
  });
});

// ══════════════════════════════════════
//  レジストリ
// ══════════════════════════════════════

describe("レジストリ", () => {
  it("RegCreateKeyExでキーが作成される", () => {
    const r = run([
      { api: "RegCreateKeyEx", path: "HKCU\\Software\\Test" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.registryKeys).toHaveLength(1);
    expect(snap.registryKeys[0]!.path).toBe("HKCU\\Software\\Test");
  });

  it("RegSetValueExで値が設定される", () => {
    const r = run([
      { api: "RegCreateKeyEx", path: "HKCU\\Test" },
      { api: "RegSetValueEx", hKey: 0x1000, name: "Name", type: "REG_SZ", data: "Test" },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.registryKeys[0]!.values).toHaveLength(1);
    expect(snap.registryKeys[0]!.values[0]!.data).toBe("Test");
  });

  it("RegDeleteValueで値が削除される", () => {
    const r = run([
      { api: "RegCreateKeyEx", path: "HKCU\\Test" },
      { api: "RegSetValueEx", hKey: 0x1000, name: "Name", type: "REG_SZ", data: "Test" },
      { api: "RegDeleteValue", hKey: 0x1000, name: "Name" },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.registryKeys[0]!.values).toHaveLength(0);
  });

  it("存在しない値のRegQueryValueExでエラー", () => {
    const r = run([
      { api: "RegCreateKeyEx", path: "HKCU\\Test" },
      { api: "RegQueryValueEx", hKey: 0x1000, name: "NonExistent" },
    ]);
    expect(r.allEvents.some(e => e.type === "error")).toBe(true);
  });
});

// ══════════════════════════════════════
//  DLL
// ══════════════════════════════════════

describe("DLLロード", () => {
  it("LoadLibraryでモジュールがロードされる", () => {
    const r = run([
      { api: "LoadLibrary", name: "test.dll", exports: ["Func1", "Func2"] },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.modules).toHaveLength(1);
    expect(snap.modules[0]!.name).toBe("test.dll");
    expect(snap.modules[0]!.exports).toEqual(["Func1", "Func2"]);
  });

  it("GetProcAddressで関数アドレスが取得できる", () => {
    const r = run([
      { api: "LoadLibrary", name: "test.dll", exports: ["Func1"] },
      { api: "GetProcAddress", hModule: 0x1000, procName: "Func1" },
    ]);
    expect(r.allEvents.some(e => e.type === "dll_getproc" && e.severity === "success")).toBe(true);
  });

  it("存在しない関数のGetProcAddressでエラー", () => {
    const r = run([
      { api: "LoadLibrary", name: "test.dll", exports: ["Func1"] },
      { api: "GetProcAddress", hModule: 0x1000, procName: "NoSuchFunc" },
    ]);
    expect(r.allEvents.some(e => e.type === "error")).toBe(true);
  });

  it("FreeLibraryでモジュールがアンロードされる", () => {
    const r = run([
      { api: "LoadLibrary", name: "test.dll", exports: [] },
      { api: "FreeLibrary", hModule: 0x1000 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.modules).toHaveLength(0);
  });
});

// ══════════════════════════════════════
//  同期オブジェクト
// ══════════════════════════════════════

describe("同期オブジェクト", () => {
  it("CreateMutexでMutexが作成される（初期シグナル状態）", () => {
    const r = run([
      { api: "CreateMutex", name: "TestMutex" },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.mutexes).toHaveLength(1);
    expect(snap.mutexes[0]!.signaled).toBe(true);
  });

  it("WaitForSingleObjectでMutexが取得される", () => {
    const r = run([
      { api: "CreateMutex", name: "M" },
      { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.mutexes[0]!.signaled).toBe(false);
    expect(snap.mutexes[0]!.ownerTid).toBe(1);
  });

  it("ReleaseMutexでMutexが解放される", () => {
    const r = run([
      { api: "CreateMutex", name: "M" },
      { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
      { api: "ReleaseMutex", hMutex: 0x1000 },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.mutexes[0]!.signaled).toBe(true);
    expect(snap.mutexes[0]!.ownerTid).toBe(0);
  });

  it("CreateEventでイベントが作成される（初期非シグナル）", () => {
    const r = run([
      { api: "CreateEvent", name: "E", manualReset: true },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]!.signaled).toBe(false);
  });

  it("SetEventでイベントがシグナル状態になる", () => {
    const r = run([
      { api: "CreateEvent", name: "E", manualReset: true },
      { api: "SetEvent", hEvent: 0x1000 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.events[0]!.signaled).toBe(true);
  });

  it("自動リセットイベントはWait後に非シグナルに戻る", () => {
    const r = run([
      { api: "CreateEvent", name: "E", manualReset: false },
      { api: "SetEvent", hEvent: 0x1000 },
      { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    ]);
    const snap = r.snapshots[3]!;
    expect(snap.events[0]!.signaled).toBe(false);
  });

  it("CreateSemaphoreでセマフォが作成される", () => {
    const r = run([
      { api: "CreateSemaphore", name: "S", initialCount: 3, maxCount: 5 },
    ]);
    const snap = r.snapshots[1]!;
    expect(snap.semaphores).toHaveLength(1);
    expect(snap.semaphores[0]!.count).toBe(3);
    expect(snap.semaphores[0]!.maxCount).toBe(5);
  });

  it("WaitForSingleObjectでセマフォのカウントが減る", () => {
    const r = run([
      { api: "CreateSemaphore", name: "S", initialCount: 2, maxCount: 5 },
      { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    ]);
    const snap = r.snapshots[2]!;
    expect(snap.semaphores[0]!.count).toBe(1);
  });
});

// ══════════════════════════════════════
//  ヒープ
// ══════════════════════════════════════

describe("ヒープ管理", () => {
  it("HeapAllocでメモリが割り当てられる", () => {
    const r = run([
      { api: "HeapAlloc", hHeap: 0x0FFD, size: 256, content: "data" },
    ]);
    const snap = r.snapshots[1]!;
    const heap = snap.processes[0]!.heaps[0]!;
    expect(heap.allocations).toHaveLength(1);
    expect(heap.usedSize).toBe(256);
  });

  it("HeapFreeでメモリが解放される", () => {
    const r = run([
      { api: "HeapAlloc", hHeap: 0x0FFD, size: 256, content: "data" },
    ]);
    const addr = r.snapshots[1]!.processes[0]!.heaps[0]!.allocations[0]!.address;
    const r2 = run([
      { api: "HeapAlloc", hHeap: 0x0FFD, size: 256, content: "data" },
      { api: "HeapFree", hHeap: 0x0FFD, address: addr },
    ]);
    const snap = r2.snapshots[2]!;
    expect(snap.processes[0]!.heaps[0]!.allocations).toHaveLength(0);
  });
});

// ══════════════════════════════════════
//  初期状態
// ══════════════════════════════════════

describe("初期状態", () => {
  it("初期スナップショットが存在する", () => {
    const r = run([]);
    expect(r.snapshots).toHaveLength(1);
    expect(r.snapshots[0]!.step).toBe(0);
  });

  it("初期プロセスが存在する", () => {
    const r = run([]);
    expect(r.snapshots[0]!.processes).toHaveLength(1);
    expect(r.snapshots[0]!.processes[0]!.name).toBe("WinMain.exe");
  });

  it("初期プロセスにメインスレッドがある", () => {
    const r = run([]);
    expect(r.snapshots[0]!.processes[0]!.threads).toHaveLength(1);
    expect(r.snapshots[0]!.processes[0]!.threads[0]!.state).toBe("running");
  });

  it("初期プロセスにデフォルトヒープがある", () => {
    const r = run([]);
    expect(r.snapshots[0]!.processes[0]!.heaps).toHaveLength(1);
  });
});

// ══════════════════════════════════════
//  プリセット
// ══════════════════════════════════════

describe("PRESETS", () => {
  it("10個のプリセット", () => {
    expect(PRESETS).toHaveLength(10);
  });

  it("名前が一意", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const preset of PRESETS) {
    it(`${preset.name}: 実行可能`, () => {
      const result = preset.run();
      expect(result.snapshots.length).toBeGreaterThanOrEqual(2);
      expect(result.allEvents.length).toBeGreaterThan(0);
    });
  }
});
