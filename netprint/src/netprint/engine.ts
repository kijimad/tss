/* ネットワークプリンタ シミュレーター エンジン */

import type {
  Printer, PrintJob, NetPacket, Client,
  SimEvent, PrintInstr, SimOp, StepResult, SimulationResult,
  Protocol,
} from "./types.js";

// ─── 状態管理 ───

interface SimState {
  printers: Map<string, Printer>;
  clients: Map<string, Client>;
  packets: NetPacket[];
  events: SimEvent[];
  tick: number;
  nextJobId: number;
}

function createState(): SimState {
  return {
    printers: new Map(), clients: new Map(),
    packets: [], events: [], tick: 0, nextJobId: 1,
  };
}

// ─── ヘルパー ───

/** 転送速度を計算（バイト/tick） */
function transferRate(protocol: Protocol): number {
  switch (protocol) {
    case "ipp": return 65536;     // IPP over HTTP
    case "lpd": return 32768;     // LPD（レガシー）
    case "raw9100": return 131072; // Raw 9100（高速）
    default: return 65536;
  }
}

/** プロトコル表示名 */
function protoName(p: Protocol): string {
  switch (p) {
    case "ipp": return "IPP (TCP/631)";
    case "lpd": return "LPD (TCP/515)";
    case "raw9100": return "Raw (TCP/9100)";
    case "snmp": return "SNMP (UDP/161)";
    case "bonjour": return "Bonjour/mDNS";
    case "ws_discovery": return "WS-Discovery";
  }
}

// ─── 命令実行 ───

function executeInstr(state: SimState, instr: PrintInstr): string {
  switch (instr.op) {
    case "add_printer": {
      const p: Printer = {
        ...instr.printer,
        queue: [], currentJob: null, totalPrinted: 0,
      };
      state.printers.set(p.name, p);
      state.events.push({
        type: "network", tick: state.tick,
        message: `プリンタ追加: ${p.name} (${p.ip}, ${p.type})`,
        detail: `${p.ppm}ppm, ${p.color ? "カラー" : "モノクロ"}, ${p.duplex ? "両面対応" : "片面のみ"}`,
      });
      return `プリンタ追加: ${p.name} [${p.ip}]`;
    }

    case "add_client": {
      state.clients.set(instr.client.name, { ...instr.client });
      return `クライアント追加: ${instr.client.name} [${instr.client.ip}]`;
    }

    case "discover": {
      const client = state.clients.get(instr.clientName);
      if (!client) return `クライアント '${instr.clientName}' が未登録`;

      const found: string[] = [];
      for (const [, p] of state.printers) {
        if (p.protocols.includes(instr.protocol) && p.state !== "offline") {
          found.push(p.name);
          state.packets.push({
            src: client.ip, dst: p.ip, protocol: instr.protocol,
            type: "discovery", payload: `${protoName(instr.protocol)} discover`,
          });
          state.packets.push({
            src: p.ip, dst: client.ip, protocol: instr.protocol,
            type: "status_response",
            payload: `${p.name} (${p.type}, ${p.state})`,
          });
        }
      }
      state.events.push({
        type: "discovery", tick: state.tick,
        message: `${client.name} が ${protoName(instr.protocol)} でプリンタ探索 → ${found.length}台発見`,
        detail: found.join(", ") || "なし",
      });
      return `discover(${protoName(instr.protocol)}) → ${found.join(", ") || "なし"}`;
    }

    case "submit_job": {
      const client = state.clients.get(instr.clientName);
      const printer = state.printers.get(instr.printerName);
      if (!client) return `クライアント '${instr.clientName}' が未登録`;
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;

      if (printer.state === "offline") {
        state.events.push({
          type: "error", tick: state.tick,
          message: `ジョブ送信失敗: ${printer.name} はオフライン`,
        });
        return `submit失敗: ${printer.name} オフライン`;
      }

      const job: PrintJob = {
        ...instr.job,
        id: state.nextJobId++,
        printedPages: 0, transferredBytes: 0,
        state: "queued", createdAt: state.tick,
      };

      // プロトコルに応じたパケット生成
      state.packets.push({
        src: client.ip, dst: printer.ip, protocol: job.protocol,
        type: "job_submit",
        payload: `Job#${job.id}: "${job.name}" ${job.pages}p ${job.paperSize}`,
      });
      state.packets.push({
        src: printer.ip, dst: client.ip, protocol: job.protocol,
        type: "ack", payload: `Job#${job.id} accepted`,
      });

      printer.queue.push(job);
      state.events.push({
        type: "submit", tick: state.tick,
        message: `${client.name}→${printer.name}: Job#${job.id} "${job.name}" (${job.pages}p×${job.copies}部, ${job.protocol})`,
        detail: `${job.paperSize}, ${job.quality}, ${job.color ? "カラー" : "モノクロ"}, ${(job.sizeBytes / 1024).toFixed(0)}KB`,
      });
      return `submit Job#${job.id} "${job.name}" → ${printer.name}`;
    }

    case "transfer_data": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;

      // キュー内のqueued/transferringジョブをtransfer
      for (const job of printer.queue) {
        if (job.state === "queued") job.state = "transferring";
        if (job.state === "transferring") {
          const rate = transferRate(job.protocol);
          const remaining = job.sizeBytes - job.transferredBytes;
          const chunk = Math.min(rate, remaining);
          job.transferredBytes += chunk;

          state.packets.push({
            src: job.sourceIp, dst: printer.ip, protocol: job.protocol,
            type: "data_transfer",
            payload: `Job#${job.id}: ${(job.transferredBytes / 1024).toFixed(0)}/${(job.sizeBytes / 1024).toFixed(0)} KB`,
          });

          if (job.transferredBytes >= job.sizeBytes) {
            job.state = "processing";
            state.events.push({
              type: "transfer", tick: state.tick,
              message: `Job#${job.id}: 転送完了 (${(job.sizeBytes / 1024).toFixed(0)}KB, ${protoName(job.protocol)})`,
            });
          } else {
            const pct = ((job.transferredBytes / job.sizeBytes) * 100).toFixed(0);
            state.events.push({
              type: "transfer", tick: state.tick,
              message: `Job#${job.id}: 転送中 ${pct}%`,
            });
          }
        }
      }
      return `transfer_data: ${printer.name}`;
    }

    case "process_queue": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;

      if (printer.currentJob) {
        return `${printer.name}: 印刷中 (Job#${printer.currentJob.id})`;
      }

      if (printer.state === "error" || printer.state === "offline" || printer.state === "paper_jam") {
        return `${printer.name}: ${printer.state} のため処理不可`;
      }

      // 優先度順にprocessingのジョブを取得
      const ready = printer.queue
        .filter(j => j.state === "processing")
        .sort((a, b) => a.priority - b.priority);

      if (ready.length === 0) return `${printer.name}: 印刷待ちジョブなし`;

      const job = ready[0];

      // ウォームアップ
      if (printer.state === "idle" || printer.state === "sleep") {
        printer.state = "warming_up";
        state.events.push({
          type: "warmup", tick: state.tick,
          message: `${printer.name}: ウォームアップ開始 (${printer.warmupTicks} tick)`,
          detail: printer.type === "laser_bw" || printer.type === "laser_color"
            ? "定着器の加熱中..." : "ヘッド位置調整中...",
        });
        // 次のtickで印刷開始
        return `${printer.name}: warming up`;
      }

      // 印刷開始
      printer.currentJob = job;
      job.state = "printing";
      printer.state = "printing";
      state.events.push({
        type: "print_start", tick: state.tick,
        message: `${printer.name}: Job#${job.id} 印刷開始 (${job.pages}p×${job.copies}部)`,
      });
      return `${printer.name}: printing Job#${job.id}`;
    }

    case "print_tick": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;

      // ウォームアップ中
      if (printer.state === "warming_up") {
        printer.warmupTicks--;
        if (printer.warmupTicks <= 0) {
          printer.warmupTicks = printer.type.startsWith("laser") ? 3 : 1;
          state.events.push({
            type: "warmup", tick: state.tick,
            message: `${printer.name}: ウォームアップ完了`,
          });
          // ウォームアップ完了 → 印刷可能なジョブを即座に開始
          const ready = printer.queue
            .filter(j => j.state === "processing")
            .sort((a, b) => a.priority - b.priority);
          if (ready.length > 0) {
            const nextJob = ready[0];
            printer.currentJob = nextJob;
            nextJob.state = "printing";
            printer.state = "printing";
            state.events.push({
              type: "print_start", tick: state.tick,
              message: `${printer.name}: Job#${nextJob.id} 印刷開始 (${nextJob.pages}p×${nextJob.copies}部)`,
            });
            return `${printer.name}: warmup done → printing Job#${nextJob.id}`;
          }
          printer.state = "idle";
          return `${printer.name}: warmup done, no jobs`;
        }
        return `${printer.name}: warming up (${printer.warmupTicks} tick remaining)`;
      }

      if (!printer.currentJob) {
        return `${printer.name}: 印刷中ジョブなし`;
      }

      const job = printer.currentJob;
      const totalPages = job.pages * job.copies;

      // 用紙チェック
      if (printer.paperRemaining <= 0) {
        printer.state = "error";
        printer.errorMessage = "用紙切れ";
        state.events.push({
          type: "paper_out", tick: state.tick,
          message: `${printer.name}: 用紙切れ! Job#${job.id} 一時停止`,
        });
        return `${printer.name}: 用紙切れ`;
      }

      // トナーチェック
      if (printer.tonerLevel <= 0) {
        printer.state = "error";
        printer.errorMessage = "トナー/インク切れ";
        state.events.push({
          type: "toner_low", tick: state.tick,
          message: `${printer.name}: トナー/インク切れ!`,
        });
        return `${printer.name}: トナー/インク切れ`;
      }

      // 1 tick で ppm に応じたページを印刷
      const pagesToPrint = Math.min(
        Math.ceil(printer.ppm / 6), // ppmを6で割って1tickあたりのページ数
        totalPages - job.printedPages,
        printer.paperRemaining,
      );

      for (let i = 0; i < pagesToPrint; i++) {
        job.printedPages++;
        printer.paperRemaining--;
        printer.totalPrinted++;
        // トナー消費（カラーは倍消費）
        printer.tonerLevel -= job.color ? 0.3 : 0.15;
        if (printer.tonerLevel < 0) printer.tonerLevel = 0;
      }

      // トナー残量警告
      if (printer.tonerLevel > 0 && printer.tonerLevel <= 10) {
        state.events.push({
          type: "toner_low", tick: state.tick,
          message: `${printer.name}: トナー残量警告 (${printer.tonerLevel.toFixed(1)}%)`,
        });
      }

      state.events.push({
        type: "print_page", tick: state.tick,
        message: `${printer.name}: Job#${job.id} ${job.printedPages}/${totalPages}p`,
        detail: `用紙残=${printer.paperRemaining}, トナー=${printer.tonerLevel.toFixed(1)}%`,
      });

      // 完了チェック
      if (job.printedPages >= totalPages) {
        job.state = "completed";
        printer.currentJob = null;
        printer.state = "idle";
        printer.queue = printer.queue.filter(j => j.id !== job.id);
        state.events.push({
          type: "print_done", tick: state.tick,
          message: `${printer.name}: Job#${job.id} "${job.name}" 印刷完了 (${totalPages}p)`,
        });
      }

      return `${printer.name}: printing ${job.printedPages}/${totalPages}`;
    }

    case "cancel_job": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      const job = printer.queue.find(j => j.id === instr.jobId) ?? (printer.currentJob?.id === instr.jobId ? printer.currentJob : null);
      if (!job) return `Job#${instr.jobId} が見つからない`;
      job.state = "cancelled";
      if (printer.currentJob?.id === instr.jobId) {
        printer.currentJob = null;
        printer.state = "idle";
      }
      printer.queue = printer.queue.filter(j => j.id !== instr.jobId);
      state.events.push({
        type: "cancel", tick: state.tick,
        message: `Job#${instr.jobId} キャンセル (${printer.name})`,
      });
      return `cancel Job#${instr.jobId}`;
    }

    case "status_query": {
      const client = state.clients.get(instr.clientName);
      const printer = state.printers.get(instr.printerName);
      if (!client || !printer) return `クライアントまたはプリンタが未登録`;

      state.packets.push({
        src: client.ip, dst: printer.ip, protocol: instr.protocol,
        type: "status_query", payload: `Get-Printer-Attributes`,
      });

      const qLen = printer.queue.length + (printer.currentJob ? 1 : 0);
      const statusPayload = `state=${printer.state}, queue=${qLen}, paper=${printer.paperRemaining}, toner=${printer.tonerLevel.toFixed(0)}%`;
      state.packets.push({
        src: printer.ip, dst: client.ip, protocol: instr.protocol,
        type: "status_response", payload: statusPayload,
      });
      state.events.push({
        type: "status", tick: state.tick,
        message: `${client.name}→${printer.name}: ステータス照会 (${protoName(instr.protocol)})`,
        detail: statusPayload,
      });
      return `status: ${printer.name} → ${printer.state}`;
    }

    case "paper_jam": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      printer.state = "paper_jam";
      printer.errorMessage = "紙詰まり";
      if (printer.currentJob) {
        printer.currentJob.state = "error";
      }
      state.events.push({
        type: "paper_jam", tick: state.tick,
        message: `${printer.name}: 紙詰まり発生!`,
        detail: "用紙が搬送経路で詰まった。ジャムクリアが必要",
      });
      return `${printer.name}: PAPER JAM`;
    }

    case "clear_jam": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      printer.state = "idle";
      printer.errorMessage = undefined;
      if (printer.currentJob) {
        printer.currentJob.state = "processing";
      }
      state.events.push({
        type: "paper_jam", tick: state.tick,
        message: `${printer.name}: ジャムクリア完了、復帰`,
      });
      return `${printer.name}: jam cleared`;
    }

    case "add_paper": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      printer.paperRemaining += instr.sheets;
      if (printer.state === "error" && printer.errorMessage === "用紙切れ") {
        printer.state = "idle";
        printer.errorMessage = undefined;
      }
      state.events.push({
        type: "status", tick: state.tick,
        message: `${printer.name}: 用紙補充 +${instr.sheets}枚 (計${printer.paperRemaining}枚)`,
      });
      return `${printer.name}: +${instr.sheets} sheets`;
    }

    case "replace_toner": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      printer.tonerLevel = 100;
      if (printer.state === "error" && printer.errorMessage?.includes("トナー")) {
        printer.state = "idle";
        printer.errorMessage = undefined;
      }
      state.events.push({
        type: "status", tick: state.tick,
        message: `${printer.name}: トナー/インク交換 (100%)`,
      });
      return `${printer.name}: toner replaced`;
    }

    case "set_offline": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      printer.state = "offline";
      state.events.push({
        type: "status", tick: state.tick,
        message: `${printer.name}: オフラインに設定`,
      });
      return `${printer.name}: offline`;
    }

    case "set_online": {
      const printer = state.printers.get(instr.printerName);
      if (!printer) return `プリンタ '${instr.printerName}' が未登録`;
      printer.state = "idle";
      state.events.push({
        type: "status", tick: state.tick,
        message: `${printer.name}: オンラインに復帰`,
      });
      return `${printer.name}: online`;
    }

    case "comment": {
      state.events.push({ type: "comment", tick: state.tick, message: instr.text });
      return instr.text;
    }
  }
}

// ─── シミュレーション実行 ───

export function simulate(ops: SimOp[]): SimulationResult {
  const allSteps: StepResult[] = [];
  const allEvents: SimEvent[] = [];
  for (const op of ops) {
    const r = executeSimulation(op);
    allSteps.push(...r.steps);
    allEvents.push(...r.events);
  }
  return { steps: allSteps, events: allEvents };
}

export function executeSimulation(op: SimOp): SimulationResult {
  const state = createState();
  const steps: StepResult[] = [];

  for (let i = 0; i < op.instructions.length && i < op.config.maxTicks; i++) {
    state.tick = i;
    const instr = op.instructions[i];
    const msg = executeInstr(state, instr);

    steps.push({
      tick: i, instruction: instr,
      printers: clonePrinters(state),
      clients: [...state.clients.values()].map(c => ({ ...c })),
      packets: [...state.packets],
      message: msg,
    });
  }

  return { steps, events: state.events };
}

function clonePrinters(state: SimState): Printer[] {
  return [...state.printers.values()].map(p => ({
    ...p,
    queue: p.queue.map(j => ({ ...j })),
    currentJob: p.currentJob ? { ...p.currentJob } : null,
  }));
}

// ─── デフォルト設定 ───

export function defaultConfig(): SimOp["config"] {
  return { maxTicks: 200 };
}
