// ══════════════════════════════════════
//  Windows API シミュレーター — プリセット
// ══════════════════════════════════════

import type { WinApiCall, WinPreset, WinSimResult } from "./types.js";
import { runWinApiSim } from "./engine.js";

// ── ヘルパー ──

function makeResult(calls: WinApiCall[]): WinSimResult {
  return runWinApiSim(calls);
}

// ── 1. ウィンドウ作成とメッセージループ ──

function presetWindowAndMsgLoop(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── ステップ1: ウィンドウクラス登録 ──" },
    { api: "RegisterClass", className: "MyWindowClass", wndProc: "MyWndProc" },
    { api: "Comment", text: "── ステップ2: ウィンドウ作成 ──" },
    { api: "CreateWindowEx", className: "MyWindowClass", title: "Hello Win32", x: 100, y: 100, w: 640, h: 480, parent: 0 },
    { api: "Comment", text: "── ステップ3: ウィンドウ表示 ──" },
    { api: "ShowWindow", hwnd: 0x1000, cmd: "SW_SHOW" },
    { api: "Comment", text: "── ステップ4: メッセージループ ──" },
    { api: "GetMessage" },
    { api: "DispatchMessage" },
    { api: "GetMessage" },
    { api: "DispatchMessage" },
    { api: "Comment", text: "── ステップ5: WM_CLOSEからWM_QUITへ ──" },
    { api: "SendMessage", hwnd: 0x1000, msg: "WM_CLOSE", wParam: 0, lParam: 0 },
    { api: "DestroyWindow", hwnd: 0x1000 },
    { api: "PostQuitMessage", exitCode: 0 },
    { api: "GetMessage" },
  ]);
}

// ── 2. GDI描画 ──

function presetGdiDrawing(): WinSimResult {
  return makeResult([
    { api: "RegisterClass", className: "DrawClass", wndProc: "DrawWndProc" },
    { api: "CreateWindowEx", className: "DrawClass", title: "GDI Drawing", x: 50, y: 50, w: 400, h: 300, parent: 0 },
    { api: "ShowWindow", hwnd: 0x1000, cmd: "SW_SHOW" },
    { api: "Comment", text: "── WM_PAINTハンドラ: BeginPaint ──" },
    { api: "BeginPaint", hwnd: 0x1000 },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "SelectPen", color: "#0000ff", width: 2 } },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "SelectBrush", color: "#ffff00" } },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "Rectangle", x1: 10, y1: 10, x2: 200, y2: 150 } },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "Ellipse", x1: 50, y1: 50, x2: 180, y2: 130 } },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "TextOut", x: 60, y: 80, text: "Hello GDI!" } },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "MoveTo", x: 10, y: 200 } },
    { api: "GdiDraw", hdc: 0x1002, cmd: { op: "LineTo", x: 350, y: 200 } },
    { api: "EndPaint", hwnd: 0x1000 },
  ]);
}

// ── 3. プロセス作成と終了 ──

function presetProcessLifecycle(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── 子プロセスの作成 ──" },
    { api: "CreateProcess", name: "child.exe", commandLine: "child.exe --mode=test" },
    { api: "Comment", text: "── 子プロセスの状態確認 ──" },
    { api: "GetExitCodeProcess", hProcess: 0x1000 },
    { api: "Comment", text: "── 子プロセスで作業 ──" },
    { api: "Sleep", ms: 100 },
    { api: "Comment", text: "── 子プロセスの終了 ──" },
    { api: "TerminateProcess", hProcess: 0x1000, exitCode: 0 },
    { api: "Comment", text: "── 終了を待機 ──" },
    { api: "WaitForSingleObject", handle: 0x1000, timeout: 5000 },
    { api: "GetExitCodeProcess", hProcess: 0x1000 },
    { api: "CloseHandle", handle: 0x1000 },
    { api: "CloseHandle", handle: 0x1001 },
  ]);
}

// ── 4. スレッドとMutex ──

function presetThreadMutex(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── Mutex作成 ──" },
    { api: "CreateMutex", name: "SharedResourceMutex" },
    { api: "Comment", text: "── ワーカースレッド作成 ──" },
    { api: "CreateThread", entryPoint: "WorkerThread1" },
    { api: "CreateThread", entryPoint: "WorkerThread2" },
    { api: "CreateThread", entryPoint: "WorkerThread3" },
    { api: "Comment", text: "── Thread1がMutex取得 ──" },
    { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    { api: "Comment", text: "── Thread2がMutex取得を試行 (ブロック) ──" },
    { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    { api: "Comment", text: "── Thread1がMutex解放 ──" },
    { api: "ReleaseMutex", hMutex: 0x1000 },
    { api: "Comment", text: "── Thread2がMutex取得 ──" },
    { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    { api: "ReleaseMutex", hMutex: 0x1000 },
    { api: "Comment", text: "── スレッド終了 ──" },
    { api: "ExitThread", exitCode: 0 },
  ]);
}

// ── 5. 仮想メモリ管理 ──

function presetVirtualMemory(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── アドレス空間の予約 (RESERVE) ──" },
    { api: "VirtualAlloc", address: 0x10000, size: 65536, allocType: "RESERVE", protect: "PAGE_NOACCESS" },
    { api: "Comment", text: "── 一部をコミット (COMMIT) ──" },
    { api: "VirtualAlloc", address: 0x10000, size: 4096, allocType: "COMMIT", protect: "PAGE_READWRITE" },
    { api: "VirtualAlloc", address: 0x11000, size: 4096, allocType: "COMMIT", protect: "PAGE_READWRITE" },
    { api: "Comment", text: "── 読み取り専用領域 ──" },
    { api: "VirtualAlloc", address: 0x20000, size: 4096, allocType: "COMMIT", protect: "PAGE_READONLY" },
    { api: "Comment", text: "── 実行可能領域 ──" },
    { api: "VirtualAlloc", address: 0x30000, size: 4096, allocType: "COMMIT", protect: "PAGE_EXECUTE_READ" },
    { api: "Comment", text: "── デコミット ──" },
    { api: "VirtualFree", address: 0x11000, freeType: "DECOMMIT" },
    { api: "Comment", text: "── 完全解放 ──" },
    { api: "VirtualFree", address: 0x20000, freeType: "RELEASE" },
  ]);
}

// ── 6. ファイルI/O ──

function presetFileIO(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── ファイル作成 ──" },
    { api: "CreateFile", path: "C:\\temp\\test.txt", access: "READWRITE" },
    { api: "Comment", text: "── データ書き込み ──" },
    { api: "WriteFile", hFile: 0x1000, data: "Hello, Windows API!\n" },
    { api: "WriteFile", hFile: 0x1000, data: "This is a test file.\n" },
    { api: "WriteFile", hFile: 0x1000, data: "Win32 File I/O demo.\n" },
    { api: "Comment", text: "── ファイル先頭に戻る ──" },
    { api: "SetFilePointer", hFile: 0x1000, offset: 0 },
    { api: "Comment", text: "── データ読み取り ──" },
    { api: "ReadFile", hFile: 0x1000, bytes: 20 },
    { api: "ReadFile", hFile: 0x1000, bytes: 21 },
    { api: "Comment", text: "── ファイルクローズ ──" },
    { api: "CloseHandle", handle: 0x1000 },
  ]);
}

// ── 7. レジストリ操作 ──

function presetRegistry(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── レジストリキー作成 ──" },
    { api: "RegCreateKeyEx", path: "HKCU\\Software\\MyApp" },
    { api: "Comment", text: "── 値の設定 ──" },
    { api: "RegSetValueEx", hKey: 0x1000, name: "Version", type: "REG_SZ", data: "1.0.0" },
    { api: "RegSetValueEx", hKey: 0x1000, name: "InstallDate", type: "REG_SZ", data: "2026-04-12" },
    { api: "RegSetValueEx", hKey: 0x1000, name: "MaxRetries", type: "REG_DWORD", data: 3 },
    { api: "RegSetValueEx", hKey: 0x1000, name: "DebugMode", type: "REG_DWORD", data: 0 },
    { api: "Comment", text: "── 値の読み取り ──" },
    { api: "RegQueryValueEx", hKey: 0x1000, name: "Version" },
    { api: "RegQueryValueEx", hKey: 0x1000, name: "MaxRetries" },
    { api: "Comment", text: "── 存在しない値の読み取り ──" },
    { api: "RegQueryValueEx", hKey: 0x1000, name: "NonExistent" },
    { api: "Comment", text: "── 値の削除 ──" },
    { api: "RegDeleteValue", hKey: 0x1000, name: "DebugMode" },
    { api: "Comment", text: "── キークローズ ──" },
    { api: "RegCloseKey", hKey: 0x1000 },
  ]);
}

// ── 8. DLLロード ──

function presetDllLoading(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── kernel32.dll ロード ──" },
    { api: "LoadLibrary", name: "kernel32.dll", exports: ["CreateFileA", "ReadFile", "WriteFile", "CloseHandle", "GetLastError"] },
    { api: "Comment", text: "── user32.dll ロード ──" },
    { api: "LoadLibrary", name: "user32.dll", exports: ["MessageBoxA", "CreateWindowExA", "ShowWindow", "GetMessageA", "DispatchMessageA"] },
    { api: "Comment", text: "── 関数アドレス取得 ──" },
    { api: "GetProcAddress", hModule: 0x1000, procName: "CreateFileA" },
    { api: "GetProcAddress", hModule: 0x1001, procName: "MessageBoxA" },
    { api: "Comment", text: "── 存在しない関数 ──" },
    { api: "GetProcAddress", hModule: 0x1000, procName: "NonExistentFunc" },
    { api: "Comment", text: "── カスタムDLL ──" },
    { api: "LoadLibrary", name: "mylib.dll", exports: ["Initialize", "ProcessData", "Cleanup"] },
    { api: "GetProcAddress", hModule: 0x1002, procName: "Initialize" },
    { api: "GetProcAddress", hModule: 0x1002, procName: "ProcessData" },
    { api: "Comment", text: "── DLLアンロード ──" },
    { api: "FreeLibrary", hModule: 0x1002 },
  ]);
}

// ── 9. イベントとスレッド同期 ──

function presetEventSync(): WinSimResult {
  return makeResult([
    { api: "Comment", text: "── 手動リセットイベント作成 ──" },
    { api: "CreateEvent", name: "DataReadyEvent", manualReset: true },
    { api: "Comment", text: "── 自動リセットイベント作成 ──" },
    { api: "CreateEvent", name: "WorkCompleteEvent", manualReset: false },
    { api: "Comment", text: "── ワーカースレッド作成 ──" },
    { api: "CreateThread", entryPoint: "ProducerThread" },
    { api: "CreateThread", entryPoint: "ConsumerThread" },
    { api: "Comment", text: "── Consumer: DataReadyEvent 待機 (ブロック) ──" },
    { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    { api: "Comment", text: "── Producer: データ準備完了 → SetEvent ──" },
    { api: "SetEvent", hEvent: 0x1000 },
    { api: "Comment", text: "── Consumer: 起床して処理 ──" },
    { api: "WaitForSingleObject", handle: 0x1000, timeout: -1 },
    { api: "Comment", text: "── 手動リセット: 明示的にResetEvent ──" },
    { api: "ResetEvent", hEvent: 0x1000 },
    { api: "Comment", text: "── 自動リセットイベント: SetEvent後にWaitで自動リセット ──" },
    { api: "SetEvent", hEvent: 0x1001 },
    { api: "WaitForSingleObject", handle: 0x1001, timeout: -1 },
    { api: "Comment", text: "── 再度Wait: 非シグナルなのでブロック ──" },
    { api: "WaitForSingleObject", handle: 0x1001, timeout: 0 },
  ]);
}

// ── 10. メッセージ送受信パターン ──

function presetMessagePatterns(): WinSimResult {
  return makeResult([
    { api: "RegisterClass", className: "MsgDemoClass", wndProc: "MsgDemoProc" },
    { api: "CreateWindowEx", className: "MsgDemoClass", title: "Message Demo", x: 0, y: 0, w: 320, h: 240, parent: 0 },
    { api: "ShowWindow", hwnd: 0x1000, cmd: "SW_SHOW" },
    { api: "Comment", text: "── PostMessage: キューに追加（非同期） ──" },
    { api: "PostMessage", hwnd: 0x1000, msg: "WM_USER", wParam: 42, lParam: 0 },
    { api: "PostMessage", hwnd: 0x1000, msg: "WM_KEYDOWN", wParam: 65, lParam: 0 },
    { api: "PostMessage", hwnd: 0x1000, msg: "WM_CHAR", wParam: 65, lParam: 0 },
    { api: "Comment", text: "── SendMessage: WndProcを直接呼び出し（同期） ──" },
    { api: "SendMessage", hwnd: 0x1000, msg: "WM_TIMER", wParam: 1, lParam: 0 },
    { api: "Comment", text: "── GetMessage + DispatchMessage ループ ──" },
    { api: "GetMessage" },
    { api: "DispatchMessage" },
    { api: "GetMessage" },
    { api: "DispatchMessage" },
    { api: "GetMessage" },
    { api: "DispatchMessage" },
    { api: "GetMessage" },
    { api: "DispatchMessage" },
    { api: "Comment", text: "── DefWindowProc: デフォルト処理 ──" },
    { api: "DefWindowProc", hwnd: 0x1000, msg: "WM_MOUSEMOVE" },
    { api: "Comment", text: "── ウィンドウ破棄 → WM_QUIT ──" },
    { api: "DestroyWindow", hwnd: 0x1000 },
    { api: "PostQuitMessage", exitCode: 0 },
    { api: "GetMessage" },
  ]);
}

// ── プリセット一覧 ──

export const PRESETS: WinPreset[] = [
  { name: "ウィンドウ作成とメッセージループ", description: "RegisterClass→CreateWindow→ShowWindow→メッセージポンプ→WM_QUIT", run: presetWindowAndMsgLoop },
  { name: "GDI描画", description: "BeginPaint→TextOut→Rectangle→Ellipse→LineTo→EndPaint", run: presetGdiDrawing },
  { name: "プロセス作成と終了", description: "CreateProcess→WaitForSingleObject→TerminateProcess→GetExitCodeProcess", run: presetProcessLifecycle },
  { name: "スレッドとMutex", description: "CreateThread×3→CreateMutex→WaitForSingleObject→ReleaseMutex", run: presetThreadMutex },
  { name: "仮想メモリ管理", description: "VirtualAlloc(RESERVE/COMMIT)→読み書き→VirtualFree(DECOMMIT/RELEASE)", run: presetVirtualMemory },
  { name: "ファイルI/O", description: "CreateFile→WriteFile→SetFilePointer→ReadFile→CloseHandle", run: presetFileIO },
  { name: "レジストリ操作", description: "RegCreateKeyEx→RegSetValueEx→RegQueryValueEx→RegDeleteValue→RegCloseKey", run: presetRegistry },
  { name: "DLLロード", description: "LoadLibrary→GetProcAddress→呼び出し→FreeLibrary", run: presetDllLoading },
  { name: "イベントとスレッド同期", description: "CreateEvent→SetEvent→WaitForSingleObject→ResetEvent", run: presetEventSync },
  { name: "メッセージ送受信パターン", description: "PostMessage(非同期)→SendMessage(同期)→GetMessage→DispatchMessage→DefWindowProc", run: presetMessagePatterns },
];
