/**
 * node-runtime.ts -- Node.js ランタイム
 *
 * JavaScript コードを受け取り、Node.js 互換の環境で実行する。
 * グローバルに console, setTimeout, setInterval, setImmediate,
 * process, require 等を注入し、イベントループで非同期処理を回す。
 *
 * 実際の Node.js の起動シーケンス:
 *   1. V8 エンジン初期化
 *   2. libuv イベントループ初期化
 *   3. 組み込みモジュール登録
 *   4. ユーザスクリプト実行（同期部分）
 *   5. イベントループ開始（非同期コールバック処理）
 *   6. イベントループが空になったら終了
 */
import { EventLoop, type LoopEvent } from "./event-loop.js";
import { VirtualFS, EventEmitter, pathModule } from "../modules/builtins.js";

// process.exit() 用の特殊エラー
class ProcessExitError extends Error {
  constructor() { super("process.exit"); }
}

// 実行結果
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  loopEvents: LoopEvent[];
  loopTicks: number;
  error: string | undefined;
}

export class NodeRuntime {
  readonly eventLoop: EventLoop;
  readonly fs: VirtualFS;
  stdout = "";
  stderr = "";
  exitCode = 0;

  // 外部コールバック
  onStdout: ((text: string) => void) | undefined;
  onStderr: ((text: string) => void) | undefined;

  constructor() {
    this.eventLoop = new EventLoop();
    this.fs = new VirtualFS();
  }

  // JavaScript コードを Node.js 環境で実行
  run(code: string, maxTicks = 500): RunResult {
    this.stdout = "";
    this.stderr = "";
    this.exitCode = 0;
    this.eventLoop.resetEvents();

    let error: string | undefined;

    // Node.js グローバル環境を構築
    const globals = this.buildGlobals();

    try {
      // ユーザスクリプトを実行（同期部分）
      const fn = new Function(...Object.keys(globals), code);
      fn(...Object.values(globals));
    } catch (e) {
      // process.exit() による終了は正常
      if (e instanceof ProcessExitError) {
        // exit 済み
      } else {
        error = e instanceof Error ? e.message : String(e);
        this.writeStderr(`Error: ${error}\n`);
      }
    }

    // イベントループ実行（非同期コールバック処理）
    if (error === undefined) {
      this.eventLoop.run(maxTicks);
    }

    return {
      stdout: this.stdout,
      stderr: this.stderr,
      exitCode: this.exitCode,
      loopEvents: this.eventLoop.events,
      loopTicks: this.eventLoop.getTickCount(),
      error,
    };
  }

  private writeStdout(text: string): void {
    this.stdout += text;
    this.onStdout?.(text);
  }

  private writeStderr(text: string): void {
    this.stderr += text;
    this.onStderr?.(text);
  }

  // Node.js のグローバルオブジェクトを構築
  private buildGlobals(): Record<string, unknown> {
    const loop = this.eventLoop;
    const vfs = this.fs;
    const self = this;

    // --- console ---
    const consoleObj = {
      log: (...args: unknown[]) => {
        self.writeStdout(args.map(formatValue).join(" ") + "\n");
      },
      error: (...args: unknown[]) => {
        self.writeStderr(args.map(formatValue).join(" ") + "\n");
      },
      warn: (...args: unknown[]) => {
        self.writeStderr(args.map(formatValue).join(" ") + "\n");
      },
      time: (label = "default") => {
        consoleTimers.set(label, loop.getCurrentTime());
      },
      timeEnd: (label = "default") => {
        const start = consoleTimers.get(label);
        if (start !== undefined) {
          self.writeStdout(`${label}: ${String(loop.getCurrentTime() - start)}ms\n`);
          consoleTimers.delete(label);
        }
      },
    };
    const consoleTimers = new Map<string, number>();

    // --- process ---
    const processObj = {
      argv: ["node", "script.js"],
      env: { NODE_ENV: "development", HOME: "/home/user" },
      pid: 1,
      platform: "browser-sim",
      version: "v0.1.0",
      exit: (code = 0) => {
        self.exitCode = code;
        loop.stop();
        throw new ProcessExitError();
      },
      nextTick: (callback: () => void) => {
        loop.nextTick(callback);
      },
      cwd: () => "/",
      stdout: {
        write: (text: string) => { self.writeStdout(text); },
      },
      stderr: {
        write: (text: string) => { self.writeStderr(text); },
      },
    };

    // --- require ---
    const requireFn = (moduleName: string): unknown => {
      switch (moduleName) {
        case "fs": return {
          readFileSync: (path: string) => vfs.readFileSync(path),
          writeFileSync: (path: string, content: string) => vfs.writeFileSync(path, content),
          existsSync: (path: string) => vfs.existsSync(path),
          unlinkSync: (path: string) => vfs.unlinkSync(path),
          readdirSync: (path: string) => vfs.readdirSync(path),
          readFile: (path: string, encoding: string, cb: (err: Error | null, data: string | null) => void) => {
            // encoding 引数は無視
            const callback = typeof encoding === "function" ? encoding : cb;
            vfs.readFile(path, loop, callback);
          },
          writeFile: (path: string, content: string, cb: (err: Error | null) => void) => {
            vfs.writeFile(path, content, loop, cb);
          },
        };
        case "path": return pathModule;
        case "events": return { EventEmitter };
        default:
          throw new Error(`Cannot find module '${moduleName}'`);
      }
    };

    // --- setTimeout / setInterval / setImmediate ---
    return {
      console: consoleObj,
      process: processObj,
      require: requireFn,
      setTimeout: (cb: () => void, ms: number) => loop.setTimeout(cb, ms),
      setInterval: (cb: () => void, ms: number) => loop.setInterval(cb, ms),
      clearTimeout: (id: number) => loop.clearTimeout(id),
      clearInterval: (id: number) => loop.clearInterval(id),
      setImmediate: (cb: () => void) => loop.setImmediate(cb),
      queueMicrotask: (cb: () => void) => loop.queueMicrotask(cb),
      Buffer: {
        from: (data: string) => ({ toString: () => data, length: data.length }),
      },
      EventEmitter,
      module: { exports: {} },
      exports: {},
      __filename: "/script.js",
      __dirname: "/",
    };
  }
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return `[ ${v.map(formatValue).join(", ")} ]`;
  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 2); }
    catch { return "[object Object]"; }
  }
  return String(v);
}
