/**
 * lambda.ts — AWS Lambda ランタイムシミュレーション
 *
 * 実行環境のライフサイクル (INIT → INVOKE → SHUTDOWN)、
 * コールドスタート、同時実行、課金計算をシミュレートする。
 */

// ── 型定義 ──

/** Lambda 関数の設定 */
export interface LambdaConfig {
  functionName: string;
  runtime: string;
  handler: string;
  memoryMb: number;
  timeoutSec: number;
  envVars: Record<string, string>;
  layers: string[];
  /** Provisioned Concurrency (0 で無効) */
  provisionedConcurrency: number;
  /** 同時実行上限 */
  reservedConcurrency: number;
  /** ハンドラのコード（表示用） */
  code: string;
}

/** イベントソースの種類 */
export type EventSourceType = "api-gateway" | "s3" | "sqs" | "cloudwatch-events" | "direct";

/** Lambda に渡されるイベント */
export interface LambdaEvent {
  source: EventSourceType;
  label: string;
  payload: Record<string, unknown>;
}

/** 実行環境の状態 */
export type EnvState = "cold" | "init" | "ready" | "busy" | "frozen" | "shutdown";

/** 実行環境 */
export interface ExecutionEnv {
  id: string;
  state: EnvState;
  createdAt: number;
  lastInvokeAt: number;
  invokeCount: number;
}

/** 実行フェーズのトレース */
export interface LambdaTrace {
  phase: "event_receive" | "env_check" | "cold_start" | "init" | "invoke" | "response" | "billing" | "error" | "scale" | "warm" | "timeout" | "freeze";
  detail: string;
  durationMs: number;
}

/** 1 回の呼び出し結果 */
export interface InvocationResult {
  requestId: string;
  event: LambdaEvent;
  coldStart: boolean;
  /** INIT フェーズの時間 (ms) */
  initDurationMs: number;
  /** ハンドラ実行時間 (ms) */
  durationMs: number;
  /** 課金対象時間 (ms, 1ms 単位切り上げ) */
  billedDurationMs: number;
  /** メモリ設定 (MB) */
  memorySizeMb: number;
  /** 実際のメモリ使用量 (MB) */
  memoryUsedMb: number;
  /** 課金額 (USD) */
  costUsd: number;
  /** レスポンス */
  response: unknown;
  /** エラーメッセージ (あれば) */
  error: string | null;
  /** タイムアウトしたか */
  timedOut: boolean;
  /** 使用した実行環境 ID */
  envId: string;
  trace: LambdaTrace[];
}

/** 全体の統計 */
export interface LambdaStats {
  totalInvocations: number;
  coldStarts: number;
  warmStarts: number;
  errors: number;
  timeouts: number;
  totalBilledMs: number;
  totalCostUsd: number;
  avgDurationMs: number;
  activeEnvs: number;
}

// ── 定数 ──

/** リクエスト料金: $0.20 / 1M リクエスト */
const PRICE_PER_REQUEST = 0.0000002;

// ── Lambda サービス ──

export class LambdaService {
  readonly config: LambdaConfig;
  private envs: ExecutionEnv[] = [];
  private nextEnvId = 1;
  private invocations: InvocationResult[] = [];
  private clock = 0;
  /** ハンドラのシミュレーション関数 */
  private handlerFn: (event: LambdaEvent, memoryMb: number) => { result: unknown; durationMs: number; memoryUsedMb: number; error?: string };

  constructor(
    config: LambdaConfig,
    handlerFn: (event: LambdaEvent, memoryMb: number) => { result: unknown; durationMs: number; memoryUsedMb: number; error?: string },
  ) {
    this.config = config;
    this.handlerFn = handlerFn;

    // Provisioned Concurrency の事前ウォーム
    for (let i = 0; i < config.provisionedConcurrency; i++) {
      this.envs.push(this.createEnv("ready"));
    }
  }

  /** 呼び出し履歴 */
  get history(): readonly InvocationResult[] {
    return this.invocations;
  }

  /** 実行環境一覧 */
  get environments(): readonly ExecutionEnv[] {
    return this.envs;
  }

  /** 統計 */
  get stats(): LambdaStats {
    const cold = this.invocations.filter((i) => i.coldStart).length;
    const errors = this.invocations.filter((i) => i.error !== null).length;
    const timeouts = this.invocations.filter((i) => i.timedOut).length;
    const totalBilled = this.invocations.reduce((s, i) => s + i.billedDurationMs, 0);
    const totalCost = this.invocations.reduce((s, i) => s + i.costUsd, 0);
    const totalDur = this.invocations.reduce((s, i) => s + i.durationMs, 0);
    return {
      totalInvocations: this.invocations.length,
      coldStarts: cold,
      warmStarts: this.invocations.length - cold,
      errors, timeouts,
      totalBilledMs: totalBilled,
      totalCostUsd: totalCost,
      avgDurationMs: this.invocations.length > 0 ? totalDur / this.invocations.length : 0,
      activeEnvs: this.envs.filter((e) => e.state !== "shutdown").length,
    };
  }

  /** Lambda 関数を呼び出す */
  invoke(event: LambdaEvent): InvocationResult {
    this.clock += 100;
    const requestId = `req-${crypto.randomUUID().slice(0, 8)}`;
    const trace: LambdaTrace[] = [];
    let coldStart = false;
    let initDurationMs = 0;

    // 1. イベント受信
    trace.push({ phase: "event_receive", detail: `[${event.source}] ${event.label}`, durationMs: 0 });

    // 2. 同時実行チェック
    const busyCount = this.envs.filter((e) => e.state === "busy").length;
    if (busyCount >= this.config.reservedConcurrency) {
      trace.push({ phase: "error", detail: `同時実行上限 (${this.config.reservedConcurrency}) に到達 → TooManyRequestsException`, durationMs: 0 });
      const result: InvocationResult = {
        requestId, event, coldStart: false, initDurationMs: 0, durationMs: 0,
        billedDurationMs: 0, memorySizeMb: this.config.memoryMb, memoryUsedMb: 0,
        costUsd: PRICE_PER_REQUEST, response: null, error: "TooManyRequestsException",
        timedOut: false, envId: "", trace,
      };
      this.invocations.push(result);
      return result;
    }

    // 3. 実行環境の選択
    let env = this.envs.find((e) => e.state === "ready" || e.state === "frozen");
    if (env !== undefined) {
      // ウォームスタート
      if (env.state === "frozen") {
        trace.push({ phase: "warm", detail: `実行環境 ${env.id} を解凍 (frozen → ready)`, durationMs: 2 });
      } else {
        trace.push({ phase: "warm", detail: `実行環境 ${env.id} を再利用 (ウォームスタート)`, durationMs: 0 });
      }
      env.state = "busy";
    } else {
      // コールドスタート
      coldStart = true;
      env = this.createEnv("busy");
      this.envs.push(env);

      // INIT フェーズ
      const runtimeInit = this.runtimeInitMs();
      const layersInit = this.config.layers.length * 50;
      initDurationMs = runtimeInit + layersInit;

      trace.push({ phase: "cold_start", detail: `新しい実行環境 ${env.id} を作成 (コールドスタート)`, durationMs: 0 });
      trace.push({ phase: "scale", detail: `サンドボックス作成 + ランタイム (${this.config.runtime}) 起動`, durationMs: runtimeInit });
      if (this.config.layers.length > 0) {
        trace.push({ phase: "init", detail: `レイヤー読み込み: ${this.config.layers.join(", ")}`, durationMs: layersInit });
      }
      trace.push({ phase: "init", detail: `ハンドラ初期化 (${this.config.handler})`, durationMs: 50 });
      initDurationMs += 50;
    }

    // 4. ハンドラ実行
    trace.push({ phase: "invoke", detail: `${this.config.handler} を実行 (event=${event.label})`, durationMs: 0 });

    const handlerResult = this.handlerFn(event, this.config.memoryMb);
    let durationMs = handlerResult.durationMs;
    let error: string | null = handlerResult.error ?? null;
    let timedOut = false;

    // タイムアウトチェック
    if (durationMs > this.config.timeoutSec * 1000) {
      timedOut = true;
      durationMs = this.config.timeoutSec * 1000;
      error = `Task timed out after ${this.config.timeoutSec} seconds`;
      trace.push({ phase: "timeout", detail: `タイムアウト (${this.config.timeoutSec}s)`, durationMs });
    } else {
      trace.push({ phase: "invoke", detail: `実行完了 (${durationMs}ms, メモリ ${handlerResult.memoryUsedMb}MB/${this.config.memoryMb}MB)`, durationMs });
    }

    // 5. レスポンス
    const response = timedOut ? null : handlerResult.result;
    if (error !== null) {
      trace.push({ phase: "error", detail: error, durationMs: 0 });
    } else {
      const resStr = JSON.stringify(response);
      trace.push({ phase: "response", detail: `レスポンス: ${resStr.length > 80 ? resStr.slice(0, 80) + "..." : resStr}`, durationMs: 1 });
    }

    // 6. 課金計算
    const billedDurationMs = Math.ceil(durationMs);
    const gbSec = (this.config.memoryMb / 1024) * (billedDurationMs / 1000);
    const costCompute = gbSec * 0.0000166667;
    const costUsd = costCompute + PRICE_PER_REQUEST;
    trace.push({
      phase: "billing",
      detail: `課金: ${billedDurationMs}ms × ${this.config.memoryMb}MB = ${gbSec.toFixed(6)} GB-s → $${costUsd.toFixed(8)}`,
      durationMs: 0,
    });

    // 7. 実行環境を FREEZE
    env.state = "frozen";
    env.lastInvokeAt = this.clock;
    env.invokeCount++;
    trace.push({ phase: "freeze", detail: `実行環境 ${env.id} をフリーズ`, durationMs: 0 });

    const result: InvocationResult = {
      requestId, event, coldStart, initDurationMs, durationMs,
      billedDurationMs, memorySizeMb: this.config.memoryMb,
      memoryUsedMb: handlerResult.memoryUsedMb,
      costUsd, response, error, timedOut, envId: env.id, trace,
    };
    this.invocations.push(result);
    return result;
  }

  /** 履歴をリセットする */
  reset(): void {
    this.invocations = [];
    this.envs = [];
    this.nextEnvId = 1;
    this.clock = 0;
    for (let i = 0; i < this.config.provisionedConcurrency; i++) {
      this.envs.push(this.createEnv("ready"));
    }
  }

  /** ランタイム初期化時間 (ms) */
  private runtimeInitMs(): number {
    switch (this.config.runtime) {
      case "nodejs22.x":  return 150 + Math.floor(Math.random() * 50);
      case "python3.13":  return 200 + Math.floor(Math.random() * 80);
      case "java21":      return 800 + Math.floor(Math.random() * 400);
      case "go1.x":       return 80 + Math.floor(Math.random() * 30);
      case "dotnet8":     return 400 + Math.floor(Math.random() * 200);
      default:            return 200;
    }
  }

  /** 実行環境を作成する */
  private createEnv(state: EnvState): ExecutionEnv {
    return {
      id: `env-${this.nextEnvId++}`,
      state,
      createdAt: this.clock,
      lastInvokeAt: this.clock,
      invokeCount: 0,
    };
  }
}
