import { LambdaService } from "../runtime/lambda.js";
import type {
  LambdaConfig, LambdaEvent, InvocationResult, LambdaTrace, LambdaStats,
} from "../runtime/lambda.js";

export interface Example {
  name: string;
  description: string;
  config: LambdaConfig;
  events: LambdaEvent[];
  handler: (event: LambdaEvent, memoryMb: number) => { result: unknown; durationMs: number; memoryUsedMb: number; error?: string };
}

export const EXAMPLES: Example[] = [
  {
    name: "Hello World (コールドスタート)",
    description: "初回呼び出しでコールドスタートが発生し、2回目以降はウォームスタートで高速化。",
    config: {
      functionName: "hello-function", runtime: "nodejs22.x", handler: "index.handler",
      memoryMb: 128, timeoutSec: 30, envVars: { NODE_ENV: "production" },
      layers: [], provisionedConcurrency: 0, reservedConcurrency: 100,
      code: `exports.handler = async (event) => {\n  return {\n    statusCode: 200,\n    body: JSON.stringify({ message: "Hello, Lambda!" })\n  };\n};`,
    },
    events: [
      { source: "direct", label: "Invoke #1 (cold)", payload: { key: "value1" } },
      { source: "direct", label: "Invoke #2 (warm)", payload: { key: "value2" } },
      { source: "direct", label: "Invoke #3 (warm)", payload: { key: "value3" } },
    ],
    handler: () => ({ result: { statusCode: 200, body: '{"message":"Hello, Lambda!"}' }, durationMs: 5 + Math.floor(Math.random() * 10), memoryUsedMb: 58 }),
  },
  {
    name: "API Gateway → Lambda",
    description: "REST API のリクエストを Lambda で処理。パスパラメータやクエリ文字列を受け取る。",
    config: {
      functionName: "api-handler", runtime: "nodejs22.x", handler: "api.handler",
      memoryMb: 256, timeoutSec: 29, envVars: { DB_HOST: "rds.example.com" },
      layers: ["arn:aws:lambda:layer:common-utils:3"], provisionedConcurrency: 0, reservedConcurrency: 100,
      code: `exports.handler = async (event) => {\n  const userId = event.pathParameters?.id;\n  const user = await db.getUser(userId);\n  return {\n    statusCode: 200,\n    body: JSON.stringify(user)\n  };\n};`,
    },
    events: [
      { source: "api-gateway", label: "GET /users/1", payload: { httpMethod: "GET", path: "/users/1", pathParameters: { id: "1" } } },
      { source: "api-gateway", label: "GET /users/2", payload: { httpMethod: "GET", path: "/users/2", pathParameters: { id: "2" } } },
      { source: "api-gateway", label: "POST /users", payload: { httpMethod: "POST", path: "/users", body: '{"name":"Alice"}' } },
    ],
    handler: (ev) => ({
      result: { statusCode: 200, body: JSON.stringify({ id: (ev.payload["pathParameters"] as Record<string,string>)?.["id"] ?? "new", name: "Alice" }) },
      durationMs: 25 + Math.floor(Math.random() * 30), memoryUsedMb: 85,
    }),
  },
  {
    name: "S3 イベント → Lambda",
    description: "S3 にファイルがアップロードされるとリサイズ処理が自動実行される。画像サイズに比例して処理時間が変動。",
    config: {
      functionName: "image-resizer", runtime: "python3.13", handler: "resize.handler",
      memoryMb: 512, timeoutSec: 60, envVars: { DEST_BUCKET: "thumbnails-bucket" },
      layers: ["arn:aws:lambda:layer:pillow:2"], provisionedConcurrency: 0, reservedConcurrency: 50,
      code: `def handler(event, context):\n    for record in event['Records']:\n        bucket = record['s3']['bucket']['name']\n        key = record['s3']['object']['key']\n        img = download(bucket, key)\n        thumbnail = resize(img, 200, 200)\n        upload('thumbnails-bucket', key, thumbnail)`,
    },
    events: [
      { source: "s3", label: "photo_small.jpg (500KB)", payload: { Records: [{ s3: { bucket: { name: "uploads" }, object: { key: "photo_small.jpg", size: 500000 } } }] } },
      { source: "s3", label: "photo_large.jpg (5MB)", payload: { Records: [{ s3: { bucket: { name: "uploads" }, object: { key: "photo_large.jpg", size: 5000000 } } }] } },
      { source: "s3", label: "photo_huge.jpg (15MB)", payload: { Records: [{ s3: { bucket: { name: "uploads" }, object: { key: "photo_huge.jpg", size: 15000000 } } }] } },
    ],
    handler: (ev) => {
      const records = ev.payload["Records"] as { s3: { object: { size: number } } }[];
      const size = records?.[0]?.s3.object.size ?? 0;
      const dur = Math.floor(size / 10000) + 50;
      return { result: { resized: true, originalSize: size }, durationMs: dur, memoryUsedMb: 150 + Math.floor(size / 100000) };
    },
  },
  {
    name: "Java ランタイム (重いコールドスタート)",
    description: "Java は JVM 起動のためコールドスタートが 1 秒以上。ウォームスタートは高速。Provisioned Concurrency で改善。",
    config: {
      functionName: "java-api", runtime: "java21", handler: "com.example.Handler::handleRequest",
      memoryMb: 1024, timeoutSec: 30, envVars: {},
      layers: [], provisionedConcurrency: 0, reservedConcurrency: 100,
      code: `public class Handler implements RequestHandler<Event, Response> {\n    @Override\n    public Response handleRequest(Event event, Context context) {\n        return new Response(200, "OK from Java");\n    }\n}`,
    },
    events: [
      { source: "direct", label: "1st invoke (cold JVM)", payload: {} },
      { source: "direct", label: "2nd invoke (warm)", payload: {} },
      { source: "direct", label: "3rd invoke (warm)", payload: {} },
    ],
    handler: () => ({ result: { statusCode: 200, body: "OK from Java" }, durationMs: 15 + Math.floor(Math.random() * 10), memoryUsedMb: 220 }),
  },
  {
    name: "タイムアウト発生",
    description: "外部 API のレスポンスが遅延しタイムアウト。Lambda は設定した秒数で強制終了される。",
    config: {
      functionName: "timeout-demo", runtime: "nodejs22.x", handler: "slow.handler",
      memoryMb: 128, timeoutSec: 3, envVars: {},
      layers: [], provisionedConcurrency: 0, reservedConcurrency: 100,
      code: `exports.handler = async (event) => {\n  // 外部APIが遅い...\n  const data = await fetch("https://slow-api.example.com/data");\n  return { statusCode: 200, body: data };\n};`,
    },
    events: [
      { source: "direct", label: "正常リクエスト (200ms)", payload: { delay: 200 } },
      { source: "direct", label: "遅延リクエスト (5000ms → timeout)", payload: { delay: 5000 } },
      { source: "direct", label: "正常リクエスト (100ms)", payload: { delay: 100 } },
    ],
    handler: (ev) => {
      const delay = (ev.payload["delay"] as number) ?? 100;
      if (delay > 3000) return { result: null, durationMs: delay, memoryUsedMb: 60, error: undefined };
      return { result: { data: "ok" }, durationMs: delay, memoryUsedMb: 60 };
    },
  },
  {
    name: "メモリ設定による速度差",
    description: "メモリを増やすと CPU パワーも比例増加。同じ処理が 128MB→1024MB で大幅に高速化される。",
    config: {
      functionName: "compute-heavy", runtime: "nodejs22.x", handler: "compute.handler",
      memoryMb: 128, timeoutSec: 30, envVars: {},
      layers: [], provisionedConcurrency: 0, reservedConcurrency: 100,
      code: `exports.handler = async (event) => {\n  // CPU重い処理 (暗号計算など)\n  const result = heavyComputation();\n  return { result };\n};`,
    },
    events: [
      { source: "direct", label: "128MB で実行", payload: { memoryMb: 128 } },
      { source: "direct", label: "512MB で実行", payload: { memoryMb: 512 } },
      { source: "direct", label: "1024MB で実行", payload: { memoryMb: 1024 } },
      { source: "direct", label: "3008MB で実行", payload: { memoryMb: 3008 } },
    ],
    handler: (_ev, memoryMb) => {
      // メモリ(=CPU)に反比例する処理時間をシミュレート
      const baseDuration = 1500;
      const dur = Math.floor(baseDuration * (128 / memoryMb));
      return { result: { computed: true }, durationMs: dur, memoryUsedMb: Math.floor(memoryMb * 0.6) };
    },
  },
  {
    name: "Provisioned Concurrency",
    description: "事前に実行環境をウォーム状態に。コールドスタートが完全に排除される。",
    config: {
      functionName: "provisioned-fn", runtime: "nodejs22.x", handler: "index.handler",
      memoryMb: 256, timeoutSec: 30, envVars: {},
      layers: [], provisionedConcurrency: 3, reservedConcurrency: 100,
      code: `exports.handler = async (event) => {\n  return { statusCode: 200, body: "fast!" };\n};`,
    },
    events: [
      { source: "direct", label: "Invoke #1 (provisioned)", payload: {} },
      { source: "direct", label: "Invoke #2 (provisioned)", payload: {} },
      { source: "direct", label: "Invoke #3 (provisioned)", payload: {} },
      { source: "direct", label: "Invoke #4 (beyond provisioned)", payload: {} },
    ],
    handler: () => ({ result: { statusCode: 200, body: "fast!" }, durationMs: 3, memoryUsedMb: 55 }),
  },
];

function phaseColor(phase: LambdaTrace["phase"]): string {
  switch (phase) {
    case "event_receive": return "#60a5fa";
    case "env_check":     return "#94a3b8";
    case "cold_start":    return "#ef4444";
    case "init":          return "#f59e0b";
    case "invoke":        return "#22c55e";
    case "response":      return "#3b82f6";
    case "billing":       return "#a78bfa";
    case "error":         return "#ef4444";
    case "scale":         return "#f97316";
    case "warm":          return "#10b981";
    case "timeout":       return "#dc2626";
    case "freeze":        return "#64748b";
  }
}

export class LambdaApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "AWS Lambda Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f97316;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i); opt.textContent = EXAMPLES[i]!.name;
      exSelect.appendChild(opt);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Invoke All";
    runBtn.style.cssText = "padding:4px 16px;background:#f97316;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: 設定 + コード + 統計
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:320px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f97316;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Function Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "Handler Code";
    leftPanel.appendChild(codeLabel);
    const codeArea = document.createElement("pre");
    codeArea.style.cssText = "padding:8px 12px;font-size:10px;color:#94a3b8;border-bottom:1px solid #1e293b;margin:0;white-space:pre-wrap;max-height:140px;overflow-y:auto;";
    leftPanel.appendChild(codeArea);

    const statsLabel = document.createElement("div");
    statsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    statsLabel.textContent = "Stats";
    leftPanel.appendChild(statsLabel);
    const statsDiv = document.createElement("div");
    statsDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(statsDiv);

    main.appendChild(leftPanel);

    // 中央: 呼び出し結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "Invocations";
    centerPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resDiv);
    main.appendChild(centerPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:380px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Execution Trace (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderConfig = (c: LambdaConfig) => {
      cfgDiv.innerHTML = "";
      const add = (l: string, v: string, color: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${color};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        cfgDiv.appendChild(r);
      };
      add("関数名", c.functionName, "#f97316");
      add("ランタイム", c.runtime, "#22c55e");
      add("ハンドラ", c.handler, "#3b82f6");
      add("メモリ", `${c.memoryMb} MB`, "#a78bfa");
      add("タイムアウト", `${c.timeoutSec} 秒`, "#ef4444");
      add("同時実行上限", String(c.reservedConcurrency), "#64748b");
      add("Provisioned", c.provisionedConcurrency > 0 ? `${c.provisionedConcurrency} 環境` : "なし", "#f59e0b");
      if (c.layers.length > 0) add("レイヤー", c.layers.join(", "), "#06b6d4");
      const envKeys = Object.keys(c.envVars);
      if (envKeys.length > 0) add("環境変数", envKeys.join(", "), "#64748b");
    };

    const renderStats = (s: LambdaStats) => {
      statsDiv.innerHTML = "";
      const items: [string, string, string][] = [
        ["総呼び出し", String(s.totalInvocations), "#e2e8f0"],
        ["コールドスタート", String(s.coldStarts), "#ef4444"],
        ["ウォームスタート", String(s.warmStarts), "#10b981"],
        ["エラー", String(s.errors), "#ef4444"],
        ["タイムアウト", String(s.timeouts), "#dc2626"],
        ["平均実行時間", `${s.avgDurationMs.toFixed(1)} ms`, "#22c55e"],
        ["課金合計", `$${s.totalCostUsd.toFixed(8)}`, "#a78bfa"],
        ["アクティブ環境", String(s.activeEnvs), "#06b6d4"],
      ];
      for (const [l, v, c] of items) {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;">${v}</span> ${l}`;
        statsDiv.appendChild(r);
      }
    };

    const renderResults = (results: readonly InvocationResult[]) => {
      resDiv.innerHTML = "";
      for (const inv of results) {
        const el = document.createElement("div");
        const ok = inv.error === null;
        const coldTag = inv.coldStart ? '<span style="color:#ef4444;font-size:9px;"> \u2744 COLD</span>' : '<span style="color:#10b981;font-size:9px;"> \u{1F525} WARM</span>';
        const bg = ok ? "#10b98108" : "#ef444408";
        const border = ok ? "#10b981" : "#ef4444";
        el.style.cssText = `padding:5px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${bg};cursor:pointer;`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${inv.event.label}${coldTag}</span>` +
          `<span style="color:#a78bfa;font-size:11px;">${inv.durationMs}ms</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;margin-top:2px;">` +
          `${inv.requestId} | init=${inv.initDurationMs}ms | mem=${inv.memoryUsedMb}/${inv.memorySizeMb}MB | $${inv.costUsd.toFixed(8)}` +
          (inv.error ? ` | <span style="color:#ef4444;">${inv.error}</span>` : "") +
          `</div>`;
        el.addEventListener("click", () => renderTrace(inv.trace));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (trace: LambdaTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        const badge = document.createElement("span");
        badge.style.cssText = `min-width:65px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;`;
        badge.textContent = step.phase.replace("_", " ");
        el.appendChild(badge);
        if (step.durationMs > 0) {
          const dur = document.createElement("span");
          dur.style.cssText = "min-width:36px;text-align:right;color:#64748b;font-size:9px;";
          dur.textContent = `${step.durationMs}ms`;
          el.appendChild(dur);
        }
        const detail = document.createElement("span");
        detail.style.color = "#cbd5e1";
        detail.textContent = step.detail;
        el.appendChild(detail);
        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderConfig(ex.config);
      codeArea.textContent = ex.config.code;
      resDiv.innerHTML = ""; trDiv.innerHTML = ""; statsDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const svc = new LambdaService(ex.config, ex.handler);
      for (const ev of ex.events) svc.invoke(ev);
      renderResults(svc.history);
      renderStats(svc.stats);
      if (svc.history[0] !== undefined) renderTrace(svc.history[0].trace);
    };

    // ── イベント ──
    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runAll(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
