// ══════════════════════════════════════
//  Windows API シミュレーター — エンジン
// ══════════════════════════════════════

import type {
  HandleEntry, HandleType, WindowInfo, WndClass, WinMessage,
  DeviceContext, ProcessInfo, ThreadInfo,
  VirtualMemRegion,
  FileInfo, RegistryKey, RegistryValue,
  ModuleInfo, MutexInfo, EventInfo, SemaphoreInfo,
  WinApiCall, WinEvent, WinEventType, EventSeverity, WinSnapshot, WinSimResult,
} from "./types.js";

// ── 内部状態 ──

interface SimState {
  nextHandle: number;
  handles: HandleEntry[];
  wndClasses: WndClass[];
  windows: WindowInfo[];
  messageQueue: WinMessage[];
  currentMsg: WinMessage | null;
  deviceContexts: DeviceContext[];
  processes: ProcessInfo[];
  threads: ThreadInfo[];
  virtualMemory: VirtualMemRegion[];
  files: FileInfo[];
  registryKeys: RegistryKey[];
  modules: ModuleInfo[];
  mutexes: MutexInfo[];
  events: EventInfo[];
  semaphores: SemaphoreInfo[];
  step: number;
  clock: number;
  quitPosted: boolean;
  stepEvents: WinEvent[];
}

// ── ハンドル管理 ──

function allocHandle(state: SimState, type: HandleType, name: string): number {
  const handle = state.nextHandle++;
  state.handles.push({ handle, type, name, refCount: 1, closed: false });
  return handle;
}

function closeHandle(state: SimState, handle: number): HandleEntry | null {
  const entry = state.handles.find(h => h.handle === handle && !h.closed);
  if (!entry) return null;
  entry.refCount--;
  if (entry.refCount <= 0) entry.closed = true;
  return entry;
}

function findHandle(state: SimState, handle: number): HandleEntry | undefined {
  return state.handles.find(h => h.handle === handle && !h.closed);
}

// ── イベント発行 ──

function emit(state: SimState, type: WinEventType, severity: EventSeverity, message: string, detail?: string) {
  state.stepEvents.push({ step: state.step, type, severity, message, detail });
}

// ── 初期状態 ──

function initState(): SimState {
  return {
    nextHandle: 0x1000,
    handles: [],
    wndClasses: [],
    windows: [],
    messageQueue: [],
    currentMsg: null,
    deviceContexts: [],
    processes: [{
      pid: 1,
      name: "WinMain.exe",
      hProcess: 0x0FFF,
      state: "running",
      exitCode: 0,
      threads: [{
        tid: 1, hThread: 0x0FFE, pid: 1, state: "running",
        priority: 8, waitObject: 0, exitCode: 0,
      }],
      heaps: [{
        hHeap: 0x0FFD, totalSize: 65536, usedSize: 0, allocations: [],
      }],
      modules: [],
    }],
    threads: [],
    virtualMemory: [],
    files: [],
    registryKeys: [],
    modules: [],
    mutexes: [],
    events: [],
    semaphores: [],
    step: 0,
    clock: 0,
    quitPosted: false,
    stepEvents: [],
  };
}

// ── スナップショット生成 ──

function snapshot(state: SimState, apiCall: WinApiCall | null): WinSnapshot {
  return {
    step: state.step,
    apiCall,
    handles: state.handles.map(h => ({ ...h })),
    windows: state.windows.map(w => ({ ...w, children: [...w.children] })),
    wndClasses: state.wndClasses.map(c => ({ ...c })),
    messageQueue: state.messageQueue.map(m => ({ ...m })),
    deviceContexts: state.deviceContexts.map(dc => ({ ...dc, commands: [...dc.commands] })),
    processes: state.processes.map(p => ({
      ...p,
      threads: p.threads.map(t => ({ ...t })),
      heaps: p.heaps.map(h => ({
        ...h, allocations: h.allocations.map(a => ({ ...a })),
      })),
      modules: p.modules.map(m => ({ ...m, exports: [...m.exports] })),
    })),
    virtualMemory: state.virtualMemory.map(v => ({ ...v })),
    files: state.files.map(f => ({ ...f })),
    registryKeys: state.registryKeys.map(k => ({
      ...k, values: k.values.map(v => ({ ...v })), subKeys: [...k.subKeys],
    })),
    modules: state.modules.map(m => ({ ...m, exports: [...m.exports] })),
    mutexes: state.mutexes.map(m => ({ ...m })),
    events: state.events.map(e => ({ ...e })),
    semaphores: state.semaphores.map(s => ({ ...s })),
    simEvents: [...state.stepEvents],
  };
}

// ── 各API実装 ──

function execApi(state: SimState, call: WinApiCall): void {
  switch (call.api) {
    // ── ウィンドウ ──
    case "RegisterClass": {
      state.wndClasses.push({
        className: call.className,
        style: 0x0003, // CS_HREDRAW | CS_VREDRAW
        wndProc: call.wndProc,
        hInstance: 0x00400000,
      });
      emit(state, "window_create", "info",
        `RegisterClass("${call.className}") — WndProc: ${call.wndProc}`);
      break;
    }
    case "CreateWindowEx": {
      const hwnd = allocHandle(state, "window", call.title);
      const win: WindowInfo = {
        hwnd, className: call.className, title: call.title,
        x: call.x, y: call.y, width: call.w, height: call.h,
        visible: false, parent: call.parent, children: [], style: 0x00CF0000,
      };
      state.windows.push(win);
      if (call.parent > 0) {
        const parent = state.windows.find(w => w.hwnd === call.parent);
        if (parent) parent.children.push(hwnd);
      }
      // WM_CREATEを自動送信
      state.messageQueue.push({
        hwnd, msg: "WM_CREATE", wParam: 0, lParam: 0, time: state.clock++,
      });
      emit(state, "handle_create", "success",
        `CreateWindowEx → HWND=0x${hwnd.toString(16)}`, `class="${call.className}" title="${call.title}"`);
      emit(state, "window_create", "info",
        `ウィンドウ作成: "${call.title}" (${call.w}×${call.h})`);
      emit(state, "msg_post", "info", `WM_CREATE をキューに追加`);
      break;
    }
    case "ShowWindow": {
      const win = state.windows.find(w => w.hwnd === call.hwnd);
      if (win) {
        win.visible = call.cmd === "SW_SHOW";
        emit(state, "window_show", "info",
          `ShowWindow(0x${call.hwnd.toString(16)}, ${call.cmd})`);
        // WM_PAINTを追加
        if (win.visible) {
          state.messageQueue.push({
            hwnd: call.hwnd, msg: "WM_PAINT", wParam: 0, lParam: 0, time: state.clock++,
          });
          emit(state, "msg_post", "info", `WM_PAINT をキューに追加`);
        }
      } else {
        emit(state, "error", "error", `ShowWindow: 無効なHWND 0x${call.hwnd.toString(16)}`);
      }
      break;
    }
    case "DestroyWindow": {
      const idx = state.windows.findIndex(w => w.hwnd === call.hwnd);
      if (idx >= 0) {
        const win = state.windows[idx]!;
        // WM_DESTROYを送信
        emit(state, "msg_send", "info", `WM_DESTROY を送信`);
        emit(state, "window_destroy", "warning", `DestroyWindow("${win.title}")`);
        state.windows.splice(idx, 1);
        closeHandle(state, call.hwnd);
        emit(state, "handle_close", "info", `HWND=0x${call.hwnd.toString(16)} を解放`);
      }
      break;
    }
    case "PostMessage": {
      state.messageQueue.push({
        hwnd: call.hwnd, msg: call.msg,
        wParam: call.wParam, lParam: call.lParam,
        time: state.clock++,
      });
      emit(state, "msg_post", "info",
        `PostMessage(0x${call.hwnd.toString(16)}, ${call.msg}, ${call.wParam}, ${call.lParam})`);
      break;
    }
    case "SendMessage": {
      // SendMessageは即座にWndProcを呼び出す（同期的）
      emit(state, "msg_send", "info",
        `SendMessage(0x${call.hwnd.toString(16)}, ${call.msg}) — 同期呼び出し`);
      const wc = state.wndClasses.find(c =>
        state.windows.some(w => w.hwnd === call.hwnd && w.className === c.className));
      if (wc) {
        emit(state, "msg_proc", "success",
          `${wc.wndProc}(${call.msg}) を直接呼び出し`);
      }
      break;
    }
    case "GetMessage": {
      if (state.quitPosted) {
        emit(state, "msg_quit", "warning", `GetMessage → FALSE (WM_QUIT受信、ループ終了)`);
      } else if (state.messageQueue.length > 0) {
        state.currentMsg = state.messageQueue.shift()!;
        emit(state, "msg_dispatch", "info",
          `GetMessage → ${state.currentMsg.msg} (HWND=0x${state.currentMsg.hwnd.toString(16)})`);
      } else {
        emit(state, "msg_dispatch", "info", `GetMessage — キュー空、待機中...`);
      }
      break;
    }
    case "DispatchMessage": {
      if (state.currentMsg) {
        const msg = state.currentMsg;
        const win = state.windows.find(w => w.hwnd === msg.hwnd);
        const wc = win ? state.wndClasses.find(c => c.className === win.className) : null;
        if (wc) {
          emit(state, "msg_proc", "success",
            `DispatchMessage → ${wc.wndProc}(${msg.msg})`);
        } else {
          emit(state, "msg_default", "info",
            `DispatchMessage → DefWindowProc(${msg.msg})`);
        }
        state.currentMsg = null;
      }
      break;
    }
    case "PostQuitMessage": {
      state.quitPosted = true;
      state.messageQueue.push({
        hwnd: 0, msg: "WM_QUIT", wParam: call.exitCode, lParam: 0, time: state.clock++,
      });
      emit(state, "msg_quit", "warning",
        `PostQuitMessage(${call.exitCode}) — WM_QUITをキューに追加`);
      break;
    }
    case "DefWindowProc": {
      emit(state, "msg_default", "info",
        `DefWindowProc(0x${call.hwnd.toString(16)}, ${call.msg}) — デフォルト処理`);
      break;
    }

    // ── GDI ──
    case "BeginPaint": {
      const hdc = allocHandle(state, "dc", `DC(0x${call.hwnd.toString(16)})`);
      state.deviceContexts.push({
        hdc, hwnd: call.hwnd,
        penColor: "#000000", penWidth: 1,
        brushColor: "#ffffff", textColor: "#000000",
        commands: [],
      });
      emit(state, "gdi_binddc", "info",
        `BeginPaint(0x${call.hwnd.toString(16)}) → HDC=0x${hdc.toString(16)}`);
      break;
    }
    case "EndPaint": {
      const dcIdx = state.deviceContexts.findIndex(dc => dc.hwnd === call.hwnd);
      if (dcIdx >= 0) {
        const dc = state.deviceContexts[dcIdx]!;
        emit(state, "gdi_releasedc", "info",
          `EndPaint — ${dc.commands.length}個の描画コマンド実行済み`);
        closeHandle(state, dc.hdc);
        state.deviceContexts.splice(dcIdx, 1);
      }
      break;
    }
    case "GetDC": {
      const hdc = allocHandle(state, "dc", `DC(0x${call.hwnd.toString(16)})`);
      state.deviceContexts.push({
        hdc, hwnd: call.hwnd,
        penColor: "#000000", penWidth: 1,
        brushColor: "#ffffff", textColor: "#000000",
        commands: [],
      });
      emit(state, "gdi_binddc", "info",
        `GetDC(0x${call.hwnd.toString(16)}) → HDC=0x${hdc.toString(16)}`);
      break;
    }
    case "ReleaseDC": {
      const dcIdx = state.deviceContexts.findIndex(dc => dc.hwnd === call.hwnd);
      if (dcIdx >= 0) {
        const dc = state.deviceContexts[dcIdx]!;
        closeHandle(state, dc.hdc);
        state.deviceContexts.splice(dcIdx, 1);
        emit(state, "gdi_releasedc", "info", `ReleaseDC(0x${call.hwnd.toString(16)})`);
      }
      break;
    }
    case "GdiDraw": {
      const dc = state.deviceContexts.find(d => d.hdc === call.hdc);
      if (dc) {
        dc.commands.push(call.cmd);
        // ペン/ブラシの更新
        if (call.cmd.op === "SelectPen") {
          dc.penColor = call.cmd.color;
          dc.penWidth = call.cmd.width;
        } else if (call.cmd.op === "SelectBrush") {
          dc.brushColor = call.cmd.color;
        }
        emit(state, "gdi_draw", "info",
          `${call.cmd.op} on HDC=0x${call.hdc.toString(16)}`,
          JSON.stringify(call.cmd));
      } else {
        emit(state, "error", "error", `GdiDraw: 無効なHDC 0x${call.hdc.toString(16)}`);
      }
      break;
    }

    // ── プロセス/スレッド ──
    case "CreateProcess": {
      const hProcess = allocHandle(state, "process", call.name);
      const hThread = allocHandle(state, "thread", `${call.name}:main`);
      const pid = state.processes.length + 1;
      const tid = state.processes.reduce((s, p) => s + p.threads.length, 0) + 1;
      const proc: ProcessInfo = {
        pid, name: call.name, hProcess, state: "running", exitCode: 0,
        threads: [{ tid, hThread, pid, state: "running", priority: 8, waitObject: 0, exitCode: 0 }],
        heaps: [{ hHeap: allocHandle(state, "heap", `${call.name}:heap`), totalSize: 65536, usedSize: 0, allocations: [] }],
        modules: [],
      };
      state.processes.push(proc);
      emit(state, "process_create", "success",
        `CreateProcess("${call.name}") → PID=${pid}, hProcess=0x${hProcess.toString(16)}`,
        `CommandLine: ${call.commandLine}`);
      emit(state, "thread_create", "info",
        `メインスレッド TID=${tid} 作成`);
      break;
    }
    case "ExitProcess": {
      const proc = state.processes.find(p => p.state === "running");
      if (proc) {
        proc.state = "terminated";
        proc.exitCode = call.exitCode;
        proc.threads.forEach(t => { t.state = "terminated"; t.exitCode = call.exitCode; });
        emit(state, "process_exit", "warning",
          `ExitProcess(${call.exitCode}) — PID=${proc.pid} "${proc.name}" 終了`);
      }
      break;
    }
    case "TerminateProcess": {
      const entry = findHandle(state, call.hProcess);
      const proc = entry ? state.processes.find(p => p.hProcess === call.hProcess) : null;
      if (proc) {
        proc.state = "terminated";
        proc.exitCode = call.exitCode;
        proc.threads.forEach(t => { t.state = "terminated"; });
        emit(state, "process_terminate", "error",
          `TerminateProcess(0x${call.hProcess.toString(16)}, ${call.exitCode}) — 強制終了`);
      }
      break;
    }
    case "GetExitCodeProcess": {
      const proc = state.processes.find(p => p.hProcess === call.hProcess);
      if (proc) {
        const code = proc.state === "terminated" ? proc.exitCode : 259; // STILL_ACTIVE
        emit(state, "return_value", "info",
          `GetExitCodeProcess → ${code === 259 ? "STILL_ACTIVE" : code}`);
      }
      break;
    }
    case "CreateThread": {
      const proc = state.processes.find(p => p.state === "running");
      if (proc) {
        const hThread = allocHandle(state, "thread", call.entryPoint);
        const tid = state.processes.reduce((s, p) => s + p.threads.length, 0) + 1;
        proc.threads.push({
          tid, hThread, pid: proc.pid, state: "running",
          priority: 8, waitObject: 0, exitCode: 0,
        });
        emit(state, "thread_create", "success",
          `CreateThread("${call.entryPoint}") → TID=${tid}, hThread=0x${hThread.toString(16)}`);
      }
      break;
    }
    case "ExitThread": {
      const proc = state.processes.find(p => p.state === "running");
      if (proc && proc.threads.length > 0) {
        const t = proc.threads[proc.threads.length - 1]!;
        t.state = "terminated";
        t.exitCode = call.exitCode;
        emit(state, "thread_exit", "warning",
          `ExitThread(${call.exitCode}) — TID=${t.tid} 終了`);
      }
      break;
    }
    case "SuspendThread": {
      for (const proc of state.processes) {
        const t = proc.threads.find(t => t.hThread === call.hThread);
        if (t) {
          t.state = "suspended";
          emit(state, "thread_suspend", "info",
            `SuspendThread(TID=${t.tid}) — 一時停止`);
          break;
        }
      }
      break;
    }
    case "ResumeThread": {
      for (const proc of state.processes) {
        const t = proc.threads.find(t => t.hThread === call.hThread);
        if (t) {
          t.state = "running";
          emit(state, "thread_resume", "info",
            `ResumeThread(TID=${t.tid}) — 再開`);
          break;
        }
      }
      break;
    }

    // ── 仮想メモリ ──
    case "VirtualAlloc": {
      const region: VirtualMemRegion = {
        baseAddress: call.address || (0x10000 + state.virtualMemory.length * 0x1000),
        size: call.size,
        state: call.allocType === "RESERVE" ? "reserved" : "committed",
        protect: call.protect,
        content: "",
      };
      state.virtualMemory.push(region);
      const evType: WinEventType = call.allocType === "RESERVE" ? "vmem_reserve" : "vmem_commit";
      emit(state, evType, "success",
        `VirtualAlloc(0x${region.baseAddress.toString(16)}, ${call.size}, ${call.allocType}) → ${call.protect}`,
        `アドレス空間 ${call.size} バイトを${call.allocType === "RESERVE" ? "予約" : "コミット"}`);
      break;
    }
    case "VirtualFree": {
      const idx = state.virtualMemory.findIndex(v => v.baseAddress === call.address);
      if (idx >= 0) {
        if (call.freeType === "DECOMMIT") {
          state.virtualMemory[idx]!.state = "reserved";
          state.virtualMemory[idx]!.content = "";
          emit(state, "vmem_decommit", "info",
            `VirtualFree(0x${call.address.toString(16)}, DECOMMIT) — 物理ページ解放`);
        } else {
          state.virtualMemory.splice(idx, 1);
          emit(state, "vmem_release", "warning",
            `VirtualFree(0x${call.address.toString(16)}, RELEASE) — アドレス空間解放`);
        }
      }
      break;
    }

    // ── ヒープ ──
    case "HeapCreate": {
      const hHeap = allocHandle(state, "heap", "UserHeap");
      const proc = state.processes.find(p => p.state === "running");
      if (proc) {
        proc.heaps.push({
          hHeap, totalSize: call.maxSize || 65536, usedSize: 0, allocations: [],
        });
      }
      emit(state, "heap_create", "success",
        `HeapCreate(${call.initialSize}, ${call.maxSize}) → hHeap=0x${hHeap.toString(16)}`);
      break;
    }
    case "HeapAlloc": {
      const proc = state.processes.find(p => p.state === "running");
      const heap = proc?.heaps.find(h => h.hHeap === call.hHeap);
      if (heap) {
        const addr = heap.hHeap * 0x100 + heap.allocations.length * call.size;
        heap.allocations.push({ address: addr, size: call.size, content: call.content });
        heap.usedSize += call.size;
        emit(state, "heap_alloc", "info",
          `HeapAlloc(${call.size}B) → 0x${addr.toString(16)}`,
          `内容: "${call.content}"`);
      }
      break;
    }
    case "HeapFree": {
      const proc = state.processes.find(p => p.state === "running");
      const heap = proc?.heaps.find(h => h.hHeap === call.hHeap);
      if (heap) {
        const idx = heap.allocations.findIndex(a => a.address === call.address);
        if (idx >= 0) {
          const alloc = heap.allocations[idx]!;
          heap.usedSize -= alloc.size;
          heap.allocations.splice(idx, 1);
          emit(state, "heap_free", "info",
            `HeapFree(0x${call.address.toString(16)}) — ${alloc.size}B 解放`);
        }
      }
      break;
    }
    case "HeapDestroy": {
      const proc = state.processes.find(p => p.state === "running");
      if (proc) {
        const idx = proc.heaps.findIndex(h => h.hHeap === call.hHeap);
        if (idx >= 0) {
          proc.heaps.splice(idx, 1);
          closeHandle(state, call.hHeap);
          emit(state, "heap_destroy", "warning",
            `HeapDestroy(0x${call.hHeap.toString(16)}) — ヒープ全体を解放`);
        }
      }
      break;
    }

    // ── ファイルI/O ──
    case "CreateFile": {
      const hFile = allocHandle(state, "file", call.path);
      state.files.push({
        hFile, path: call.path, accessMode: call.access,
        position: 0, size: 0, content: "",
      });
      emit(state, "file_open", "success",
        `CreateFile("${call.path}", ${call.access}) → hFile=0x${hFile.toString(16)}`);
      break;
    }
    case "WriteFile": {
      const file = state.files.find(f => f.hFile === call.hFile);
      if (file) {
        file.content = file.content.substring(0, file.position)
          + call.data
          + file.content.substring(file.position + call.data.length);
        file.position += call.data.length;
        file.size = file.content.length;
        emit(state, "file_write", "info",
          `WriteFile(0x${call.hFile.toString(16)}, ${call.data.length}B)`,
          `書込み: "${call.data.substring(0, 50)}${call.data.length > 50 ? "..." : ""}"`);
      }
      break;
    }
    case "ReadFile": {
      const file = state.files.find(f => f.hFile === call.hFile);
      if (file) {
        const data = file.content.substring(file.position, file.position + call.bytes);
        file.position += data.length;
        emit(state, "file_read", "info",
          `ReadFile(0x${call.hFile.toString(16)}, ${call.bytes}B) → "${data.substring(0, 50)}"`);
      }
      break;
    }
    case "SetFilePointer": {
      const file = state.files.find(f => f.hFile === call.hFile);
      if (file) {
        file.position = call.offset;
        emit(state, "file_seek", "info",
          `SetFilePointer(0x${call.hFile.toString(16)}, ${call.offset})`);
      }
      break;
    }
    case "CloseHandle": {
      const entry = closeHandle(state, call.handle);
      if (entry) {
        // ファイルの場合はfiles配列からも除去
        if (entry.type === "file") {
          const idx = state.files.findIndex(f => f.hFile === call.handle);
          if (idx >= 0) state.files.splice(idx, 1);
        }
        emit(state, "handle_close", "info",
          `CloseHandle(0x${call.handle.toString(16)}) — ${entry.type} "${entry.name}"`);
      } else {
        emit(state, "error", "error",
          `CloseHandle: 無効なハンドル 0x${call.handle.toString(16)}`);
      }
      break;
    }

    // ── レジストリ ──
    case "RegCreateKeyEx": {
      const hKey = allocHandle(state, "registry_key", call.path);
      state.registryKeys.push({ hKey, path: call.path, values: [], subKeys: [] });
      emit(state, "reg_create", "success",
        `RegCreateKeyEx("${call.path}") → hKey=0x${hKey.toString(16)}`);
      break;
    }
    case "RegSetValueEx": {
      const key = state.registryKeys.find(k => k.hKey === call.hKey);
      if (key) {
        const existing = key.values.findIndex(v => v.name === call.name);
        const val: RegistryValue = { name: call.name, type: call.type, data: call.data };
        if (existing >= 0) key.values[existing] = val;
        else key.values.push(val);
        emit(state, "reg_set", "info",
          `RegSetValueEx("${call.name}", ${call.type}, ${JSON.stringify(call.data)})`);
      }
      break;
    }
    case "RegQueryValueEx": {
      const key = state.registryKeys.find(k => k.hKey === call.hKey);
      if (key) {
        const val = key.values.find(v => v.name === call.name);
        if (val) {
          emit(state, "reg_query", "info",
            `RegQueryValueEx("${call.name}") → ${val.type}: ${JSON.stringify(val.data)}`);
        } else {
          emit(state, "error", "error",
            `RegQueryValueEx("${call.name}") — 値が見つからない (ERROR_FILE_NOT_FOUND)`);
        }
      }
      break;
    }
    case "RegDeleteValue": {
      const key = state.registryKeys.find(k => k.hKey === call.hKey);
      if (key) {
        const idx = key.values.findIndex(v => v.name === call.name);
        if (idx >= 0) {
          key.values.splice(idx, 1);
          emit(state, "reg_delete", "warning",
            `RegDeleteValue("${call.name}") — 削除完了`);
        }
      }
      break;
    }
    case "RegCloseKey": {
      const key = state.registryKeys.find(k => k.hKey === call.hKey);
      if (key) {
        closeHandle(state, call.hKey);
        emit(state, "reg_close", "info",
          `RegCloseKey("${key.path}")`);
      }
      break;
    }

    // ── DLL ──
    case "LoadLibrary": {
      const hModule = allocHandle(state, "module", call.name);
      const mod: ModuleInfo = {
        hModule, name: call.name,
        baseAddress: 0x70000000 + state.modules.length * 0x10000,
        exports: call.exports,
        refCount: 1,
      };
      state.modules.push(mod);
      const proc = state.processes.find(p => p.state === "running");
      if (proc) proc.modules.push({ ...mod });
      emit(state, "dll_load", "success",
        `LoadLibrary("${call.name}") → hModule=0x${hModule.toString(16)}`,
        `Base=0x${mod.baseAddress.toString(16)}, Exports: ${call.exports.join(", ")}`);
      break;
    }
    case "GetProcAddress": {
      const mod = state.modules.find(m => m.hModule === call.hModule);
      if (mod) {
        const found = mod.exports.includes(call.procName);
        if (found) {
          const addr = mod.baseAddress + mod.exports.indexOf(call.procName) * 0x10;
          emit(state, "dll_getproc", "success",
            `GetProcAddress("${call.procName}") → 0x${addr.toString(16)}`);
        } else {
          emit(state, "error", "error",
            `GetProcAddress("${call.procName}") — エクスポートに見つからない`);
        }
      }
      break;
    }
    case "FreeLibrary": {
      const modIdx = state.modules.findIndex(m => m.hModule === call.hModule);
      if (modIdx >= 0) {
        const mod = state.modules[modIdx]!;
        mod.refCount--;
        if (mod.refCount <= 0) {
          state.modules.splice(modIdx, 1);
          closeHandle(state, call.hModule);
          emit(state, "dll_free", "warning",
            `FreeLibrary("${mod.name}") — アンロード`);
        } else {
          emit(state, "dll_free", "info",
            `FreeLibrary("${mod.name}") — refCount=${mod.refCount}`);
        }
      }
      break;
    }

    // ── 同期オブジェクト ──
    case "CreateMutex": {
      const hMutex = allocHandle(state, "mutex", call.name);
      state.mutexes.push({ hMutex, name: call.name, ownerTid: 0, signaled: true });
      emit(state, "sync_create", "success",
        `CreateMutex("${call.name}") → hMutex=0x${hMutex.toString(16)}`);
      break;
    }
    case "CreateEvent": {
      const hEvent = allocHandle(state, "event", call.name);
      state.events.push({ hEvent, name: call.name, manualReset: call.manualReset, signaled: false });
      emit(state, "sync_create", "success",
        `CreateEvent("${call.name}", manualReset=${call.manualReset}) → hEvent=0x${hEvent.toString(16)}`);
      break;
    }
    case "CreateSemaphore": {
      const hSem = allocHandle(state, "semaphore", call.name);
      state.semaphores.push({
        hSemaphore: hSem, name: call.name,
        count: call.initialCount, maxCount: call.maxCount,
      });
      emit(state, "sync_create", "success",
        `CreateSemaphore("${call.name}", ${call.initialCount}/${call.maxCount})`);
      break;
    }
    case "WaitForSingleObject": {
      const entry = findHandle(state, call.handle);
      if (!entry) {
        emit(state, "error", "error", `WaitForSingleObject: 無効なハンドル`);
        break;
      }
      if (entry.type === "mutex") {
        const mtx = state.mutexes.find(m => m.hMutex === call.handle);
        if (mtx) {
          if (mtx.signaled) {
            mtx.signaled = false;
            mtx.ownerTid = 1; // 現在のスレッド
            emit(state, "sync_wait", "success",
              `WaitForSingleObject(Mutex "${mtx.name}") → WAIT_OBJECT_0 (即座に取得)`);
          } else {
            emit(state, "sync_wait", "warning",
              `WaitForSingleObject(Mutex "${mtx.name}") → ブロック中 (他スレッドが所有)`);
            // タイムアウトチェック
            if (call.timeout === 0) {
              emit(state, "sync_timeout", "warning", `WAIT_TIMEOUT — タイムアウト`);
            }
          }
        }
      } else if (entry.type === "event") {
        const evt = state.events.find(e => e.hEvent === call.handle);
        if (evt) {
          if (evt.signaled) {
            if (!evt.manualReset) evt.signaled = false; // 自動リセット
            emit(state, "sync_wait", "success",
              `WaitForSingleObject(Event "${evt.name}") → WAIT_OBJECT_0`);
          } else {
            emit(state, "sync_wait", "warning",
              `WaitForSingleObject(Event "${evt.name}") → ブロック中`);
          }
        }
      } else if (entry.type === "semaphore") {
        const sem = state.semaphores.find(s => s.hSemaphore === call.handle);
        if (sem) {
          if (sem.count > 0) {
            sem.count--;
            emit(state, "sync_wait", "success",
              `WaitForSingleObject(Semaphore "${sem.name}") → WAIT_OBJECT_0 (count=${sem.count})`);
          } else {
            emit(state, "sync_wait", "warning",
              `WaitForSingleObject(Semaphore "${sem.name}") → ブロック中 (count=0)`);
          }
        }
      } else if (entry.type === "process") {
        const proc = state.processes.find(p => p.hProcess === call.handle);
        if (proc && proc.state === "terminated") {
          emit(state, "sync_wait", "success",
            `WaitForSingleObject(Process) → WAIT_OBJECT_0 (プロセス終了済み)`);
        } else {
          emit(state, "sync_wait", "warning",
            `WaitForSingleObject(Process) → ブロック中 (プロセス実行中)`);
        }
      }
      break;
    }
    case "ReleaseMutex": {
      const mtx = state.mutexes.find(m => m.hMutex === call.hMutex);
      if (mtx) {
        mtx.signaled = true;
        mtx.ownerTid = 0;
        emit(state, "sync_release", "info",
          `ReleaseMutex("${mtx.name}") — シグナル状態に`);
      }
      break;
    }
    case "SetEvent": {
      const evt = state.events.find(e => e.hEvent === call.hEvent);
      if (evt) {
        evt.signaled = true;
        emit(state, "sync_signal", "success",
          `SetEvent("${evt.name}") — シグナル状態に`);
        // 待機中のスレッドを起床
        for (const proc of state.processes) {
          for (const t of proc.threads) {
            if (t.waitObject === call.hEvent) {
              t.state = "running";
              t.waitObject = 0;
              emit(state, "thread_wake", "info",
                `TID=${t.tid} が起床 (Event "${evt.name}" シグナル)`);
            }
          }
        }
      }
      break;
    }
    case "ResetEvent": {
      const evt = state.events.find(e => e.hEvent === call.hEvent);
      if (evt) {
        evt.signaled = false;
        emit(state, "sync_signal", "info",
          `ResetEvent("${evt.name}") — 非シグナル状態に`);
      }
      break;
    }
    case "ReleaseSemaphore": {
      const sem = state.semaphores.find(s => s.hSemaphore === call.hSemaphore);
      if (sem) {
        const prev = sem.count;
        sem.count = Math.min(sem.count + call.releaseCount, sem.maxCount);
        emit(state, "sync_release", "info",
          `ReleaseSemaphore("${sem.name}", ${call.releaseCount}) — count: ${prev}→${sem.count}`);
      }
      break;
    }

    // ── その他 ──
    case "Sleep": {
      emit(state, "thread_wait", "info", `Sleep(${call.ms}ms) — スレッド一時停止`);
      break;
    }
    case "Comment": {
      emit(state, "comment", "info", call.text);
      break;
    }
  }
}

// ── 公開API ──

/** シミュレーション実行 */
export function runWinApiSim(calls: WinApiCall[]): WinSimResult {
  const state = initState();
  const allEvents: WinEvent[] = [];
  const snapshots: WinSnapshot[] = [];

  // 初期スナップショット
  emit(state, "comment", "info", "Win32 API シミュレーション開始");
  snapshots.push(snapshot(state, null));
  allEvents.push(...state.stepEvents);
  state.stepEvents = [];

  for (const call of calls) {
    state.step++;
    execApi(state, call);
    snapshots.push(snapshot(state, call));
    allEvents.push(...state.stepEvents);
    state.stepEvents = [];
  }

  return { snapshots, allEvents };
}
