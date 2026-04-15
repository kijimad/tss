// ══════════════════════════════════════
//  Windows API シミュレーター — 型定義
// ══════════════════════════════════════

// ── ハンドルシステム ──

/** カーネルオブジェクト種別 */
export type HandleType =
  | "window" | "dc" | "process" | "thread" | "file"
  | "mutex" | "event" | "semaphore" | "registry_key"
  | "module" | "heap" | "memory";

/** ハンドルエントリ（カーネルオブジェクトテーブル） */
export interface HandleEntry {
  handle: number;        // HANDLE値
  type: HandleType;
  name: string;          // オブジェクト名
  refCount: number;      // 参照カウント
  closed: boolean;
}

// ── ウィンドウシステム ──

/** ウィンドウメッセージ定数 */
export type WinMsg =
  | "WM_CREATE" | "WM_DESTROY" | "WM_CLOSE" | "WM_PAINT"
  | "WM_KEYDOWN" | "WM_KEYUP" | "WM_CHAR"
  | "WM_MOUSEMOVE" | "WM_LBUTTONDOWN" | "WM_LBUTTONUP"
  | "WM_TIMER" | "WM_SIZE" | "WM_MOVE"
  | "WM_COMMAND" | "WM_QUIT" | "WM_USER";

/** メッセージキューエントリ */
export interface WinMessage {
  hwnd: number;
  msg: WinMsg;
  wParam: number;
  lParam: number;
  time: number;
}

/** ウィンドウクラス (WNDCLASS) */
export interface WndClass {
  className: string;
  style: number;         // CS_HREDRAW | CS_VREDRAW etc
  wndProc: string;       // プロシージャ名
  hInstance: number;
}

/** ウィンドウ情報 (HWND) */
export interface WindowInfo {
  hwnd: number;
  className: string;
  title: string;
  x: number; y: number;
  width: number; height: number;
  visible: boolean;
  parent: number;        // 親ウィンドウ (0=デスクトップ)
  children: number[];
  style: number;         // WS_OVERLAPPEDWINDOW etc
}

// ── GDI ──

/** GDI描画コマンド */
export type GdiCommand =
  | { op: "TextOut"; x: number; y: number; text: string }
  | { op: "Rectangle"; x1: number; y1: number; x2: number; y2: number }
  | { op: "Ellipse"; x1: number; y1: number; x2: number; y2: number }
  | { op: "LineTo"; x: number; y: number }
  | { op: "MoveTo"; x: number; y: number }
  | { op: "SetPixel"; x: number; y: number; color: string }
  | { op: "SelectPen"; color: string; width: number }
  | { op: "SelectBrush"; color: string }
  | { op: "FillRect"; x1: number; y1: number; x2: number; y2: number; color: string };

/** デバイスコンテキスト (HDC) */
export interface DeviceContext {
  hdc: number;
  hwnd: number;          // 対象ウィンドウ
  penColor: string;
  penWidth: number;
  brushColor: string;
  textColor: string;
  commands: GdiCommand[];
}

// ── プロセス / スレッド ──

/** プロセス状態 */
export type ProcessState = "running" | "suspended" | "terminated";

/** スレッド状態 */
export type ThreadState = "running" | "ready" | "waiting" | "suspended" | "terminated";

/** プロセス情報 */
export interface ProcessInfo {
  pid: number;
  name: string;
  hProcess: number;
  state: ProcessState;
  exitCode: number;
  threads: ThreadInfo[];
  heaps: HeapInfo[];
  modules: ModuleInfo[];
}

/** スレッド情報 */
export interface ThreadInfo {
  tid: number;
  hThread: number;
  pid: number;
  state: ThreadState;
  priority: number;
  waitObject: number;   // 待機中のハンドル (0=なし)
  exitCode: number;
}

// ── 仮想メモリ ──

/** メモリページ状態 */
export type MemPageState = "free" | "reserved" | "committed";
/** メモリ保護属性 */
export type MemProtect = "PAGE_NOACCESS" | "PAGE_READONLY" | "PAGE_READWRITE" | "PAGE_EXECUTE_READ";

/** 仮想メモリ領域 */
export interface VirtualMemRegion {
  baseAddress: number;
  size: number;
  state: MemPageState;
  protect: MemProtect;
  content: string;       // 表示用データ
}

// ── ヒープ ──

/** ヒープ情報 */
export interface HeapInfo {
  hHeap: number;
  totalSize: number;
  usedSize: number;
  allocations: HeapAllocation[];
}

/** ヒープ割当 */
export interface HeapAllocation {
  address: number;
  size: number;
  content: string;
}

// ── ファイルI/O ──

/** ファイル情報 */
export interface FileInfo {
  hFile: number;
  path: string;
  accessMode: "READ" | "WRITE" | "READWRITE";
  position: number;
  size: number;
  content: string;
}

// ── レジストリ ──

/** レジストリ値の型 */
export type RegValueType = "REG_SZ" | "REG_DWORD" | "REG_BINARY" | "REG_MULTI_SZ";

/** レジストリキー */
export interface RegistryKey {
  hKey: number;
  path: string;
  values: RegistryValue[];
  subKeys: string[];
}

/** レジストリ値 */
export interface RegistryValue {
  name: string;
  type: RegValueType;
  data: string | number;
}

// ── DLL / モジュール ──

/** モジュール情報 */
export interface ModuleInfo {
  hModule: number;
  name: string;
  baseAddress: number;
  exports: string[];     // エクスポート関数名一覧
  refCount: number;
}

// ── 同期オブジェクト ──

/** Mutex情報 */
export interface MutexInfo {
  hMutex: number;
  name: string;
  ownerTid: number;      // 0=所有者なし
  signaled: boolean;
}

/** Event情報 */
export interface EventInfo {
  hEvent: number;
  name: string;
  manualReset: boolean;
  signaled: boolean;
}

/** Semaphore情報 */
export interface SemaphoreInfo {
  hSemaphore: number;
  name: string;
  count: number;
  maxCount: number;
}

// ── シミュレーション ──

/** Win32 API呼び出し */
export type WinApiCall =
  // ウィンドウ
  | { api: "RegisterClass"; className: string; wndProc: string }
  | { api: "CreateWindowEx"; className: string; title: string; x: number; y: number; w: number; h: number; parent: number }
  | { api: "ShowWindow"; hwnd: number; cmd: "SW_SHOW" | "SW_HIDE" | "SW_MINIMIZE" }
  | { api: "DestroyWindow"; hwnd: number }
  | { api: "PostMessage"; hwnd: number; msg: WinMsg; wParam: number; lParam: number }
  | { api: "SendMessage"; hwnd: number; msg: WinMsg; wParam: number; lParam: number }
  | { api: "GetMessage" }
  | { api: "DispatchMessage" }
  | { api: "PostQuitMessage"; exitCode: number }
  | { api: "DefWindowProc"; hwnd: number; msg: WinMsg }
  // GDI
  | { api: "BeginPaint"; hwnd: number }
  | { api: "EndPaint"; hwnd: number }
  | { api: "GetDC"; hwnd: number }
  | { api: "ReleaseDC"; hwnd: number }
  | { api: "GdiDraw"; hdc: number; cmd: GdiCommand }
  // プロセス/スレッド
  | { api: "CreateProcess"; name: string; commandLine: string }
  | { api: "ExitProcess"; exitCode: number }
  | { api: "TerminateProcess"; hProcess: number; exitCode: number }
  | { api: "CreateThread"; entryPoint: string }
  | { api: "ExitThread"; exitCode: number }
  | { api: "SuspendThread"; hThread: number }
  | { api: "ResumeThread"; hThread: number }
  | { api: "GetExitCodeProcess"; hProcess: number }
  // メモリ
  | { api: "VirtualAlloc"; address: number; size: number; allocType: "RESERVE" | "COMMIT"; protect: MemProtect }
  | { api: "VirtualFree"; address: number; freeType: "DECOMMIT" | "RELEASE" }
  | { api: "HeapCreate"; initialSize: number; maxSize: number }
  | { api: "HeapAlloc"; hHeap: number; size: number; content: string }
  | { api: "HeapFree"; hHeap: number; address: number }
  | { api: "HeapDestroy"; hHeap: number }
  // ファイル
  | { api: "CreateFile"; path: string; access: "READ" | "WRITE" | "READWRITE" }
  | { api: "WriteFile"; hFile: number; data: string }
  | { api: "ReadFile"; hFile: number; bytes: number }
  | { api: "SetFilePointer"; hFile: number; offset: number }
  | { api: "CloseHandle"; handle: number }
  // レジストリ
  | { api: "RegCreateKeyEx"; path: string }
  | { api: "RegSetValueEx"; hKey: number; name: string; type: RegValueType; data: string | number }
  | { api: "RegQueryValueEx"; hKey: number; name: string }
  | { api: "RegDeleteValue"; hKey: number; name: string }
  | { api: "RegCloseKey"; hKey: number }
  // DLL
  | { api: "LoadLibrary"; name: string; exports: string[] }
  | { api: "GetProcAddress"; hModule: number; procName: string }
  | { api: "FreeLibrary"; hModule: number }
  // 同期
  | { api: "CreateMutex"; name: string }
  | { api: "CreateEvent"; name: string; manualReset: boolean }
  | { api: "CreateSemaphore"; name: string; initialCount: number; maxCount: number }
  | { api: "WaitForSingleObject"; handle: number; timeout: number }
  | { api: "ReleaseMutex"; hMutex: number }
  | { api: "SetEvent"; hEvent: number }
  | { api: "ResetEvent"; hEvent: number }
  | { api: "ReleaseSemaphore"; hSemaphore: number; releaseCount: number }
  // その他
  | { api: "Sleep"; ms: number }
  | { api: "Comment"; text: string };

/** イベント種別 */
export type WinEventType =
  | "handle_create" | "handle_close" | "handle_ref"
  | "window_create" | "window_destroy" | "window_show"
  | "msg_post" | "msg_send" | "msg_dispatch" | "msg_proc" | "msg_default" | "msg_quit"
  | "gdi_binddc" | "gdi_releasedc" | "gdi_draw"
  | "process_create" | "process_exit" | "process_terminate"
  | "thread_create" | "thread_exit" | "thread_suspend" | "thread_resume" | "thread_wait" | "thread_wake"
  | "vmem_reserve" | "vmem_commit" | "vmem_decommit" | "vmem_release"
  | "heap_create" | "heap_alloc" | "heap_free" | "heap_destroy"
  | "file_open" | "file_write" | "file_read" | "file_seek" | "file_close"
  | "reg_create" | "reg_set" | "reg_query" | "reg_delete" | "reg_close"
  | "dll_load" | "dll_getproc" | "dll_free"
  | "sync_create" | "sync_wait" | "sync_signal" | "sync_release" | "sync_timeout"
  | "comment" | "error" | "return_value";

export type EventSeverity = "info" | "success" | "warning" | "error";

/** シミュレーションイベント */
export interface WinEvent {
  step: number;
  type: WinEventType;
  severity: EventSeverity;
  message: string;
  detail?: string;
}

/** シミュレーションスナップショット */
export interface WinSnapshot {
  step: number;
  apiCall: WinApiCall | null;
  handles: HandleEntry[];
  windows: WindowInfo[];
  wndClasses: WndClass[];
  messageQueue: WinMessage[];
  deviceContexts: DeviceContext[];
  processes: ProcessInfo[];
  virtualMemory: VirtualMemRegion[];
  files: FileInfo[];
  registryKeys: RegistryKey[];
  modules: ModuleInfo[];
  mutexes: MutexInfo[];
  events: EventInfo[];
  semaphores: SemaphoreInfo[];
  simEvents: WinEvent[];
}

/** シミュレーション結果 */
export interface WinSimResult {
  snapshots: WinSnapshot[];
  allEvents: WinEvent[];
}

/** プリセット定義 */
export interface WinPreset {
  name: string;
  description: string;
  run: () => WinSimResult;
}
