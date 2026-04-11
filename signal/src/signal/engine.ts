import type {
  Process, PendingSignal,
  SimOp, SimEvent, SimulationResult, EventType,
} from "./types.js";
import { SIGNAL_NAMES, DEFAULT_ACTIONS } from "./types.js";

function sigName(sig: number): string {
  return SIGNAL_NAMES[sig] ?? `SIG${sig}`;
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const processes: Process[] = [];
  const events: SimEvent[] = [];
  let step = 0;
  let clock = 0;

  const stats = {
    totalSignals: 0, delivered: 0, blocked: 0, ignored: 0,
    defaultActions: 0, customHandlers: 0,
    processesTerminated: 0, processesStopped: 0,
  };

  function emit(type: EventType, desc: string, pid?: number, signal?: number): void {
    events.push({ step, type, description: desc, pid, signal });
  }

  function findProc(pid: number): Process | undefined {
    return processes.find((p) => p.pid === pid);
  }

  /** シグナルを配送して処理 */
  function deliverSignal(proc: Process, sig: number, senderPid: number, value?: number): void {
    stats.totalSignals++;

    // SIGKILL/SIGSTOPはブロック・無視不可
    const uncatchable = sig === 9 || sig === 19;

    // ブロックチェック（マスクに含まれている場合はペンディングに追加）
    if (!uncatchable && proc.signalMask.includes(sig)) {
      proc.pendingSignals.push({ signal: sig, senderPid, value, timestamp: clock });
      stats.blocked++;
      emit("signal_blocked",
        `${sigName(sig)}(${sig}) ブロック中 — ペンディングキューに追加 (送信元PID=${senderPid})`,
        proc.pid, sig);
      return;
    }

    // ハンドラ検索
    const handler = proc.handlers.find((h) => h.signal === sig);
    const handlerType = handler?.type ?? "default";

    // IGNOREチェック
    if (!uncatchable && handlerType === "ignore") {
      stats.ignored++;
      emit("signal_ignored",
        `${sigName(sig)}(${sig}) — ハンドラ=SIG_IGN、無視`,
        proc.pid, sig);
      return;
    }

    stats.delivered++;
    emit("signal_deliver",
      `${sigName(sig)}(${sig}) 配送 → PID=${proc.pid} (送信元PID=${senderPid}${value !== undefined ? `, value=${value}` : ""})`,
      proc.pid, sig);

    // カスタムハンドラ
    if (!uncatchable && handlerType === "custom") {
      stats.customHandlers++;
      const desc = handler?.description ?? "user_handler";
      emit("handler_invoke",
        `ハンドラ呼び出し: ${desc}(${sigName(sig)})${handler?.siginfo ? ` [SA_SIGINFO, value=${value ?? "N/A"}]` : ""}`,
        proc.pid, sig);
      return;
    }

    // デフォルト動作
    const action = DEFAULT_ACTIONS[sig] ?? "terminate";
    stats.defaultActions++;

    switch (action) {
      case "terminate":
        proc.state = "terminated";
        stats.processesTerminated++;
        emit("process_terminate",
          `デフォルト動作: ${sigName(sig)} → プロセス終了 (PID=${proc.pid})`,
          proc.pid, sig);
        break;
      case "core_dump":
        proc.state = "terminated";
        stats.processesTerminated++;
        emit("core_dump",
          `デフォルト動作: ${sigName(sig)} → コアダンプ+終了 (PID=${proc.pid})`,
          proc.pid, sig);
        break;
      case "stop":
        proc.state = "stopped";
        stats.processesStopped++;
        emit("process_stop",
          `デフォルト動作: ${sigName(sig)} → プロセス停止 (PID=${proc.pid})`,
          proc.pid, sig);
        break;
      case "continue":
        if (proc.state === "stopped") {
          proc.state = "running";
          emit("process_continue",
            `デフォルト動作: ${sigName(sig)} → プロセス再開 (PID=${proc.pid})`,
            proc.pid, sig);
        } else {
          emit("signal_ignored",
            `${sigName(sig)} — プロセスは停止状態でない、無視`,
            proc.pid, sig);
        }
        break;
      case "ignore":
        emit("signal_ignored",
          `デフォルト動作: ${sigName(sig)} → 無視`,
          proc.pid, sig);
        break;
    }
  }

  /** ペンディングシグナルを配送 (アンブロック時) */
  function flushPending(proc: Process): void {
    // 標準シグナル: 同じシグナル番号の重複はマージ（最初のもの1つだけ配送）
    // リアルタイムシグナル(>=34): キューイング（全て配送、番号順）
    const toDeliver: PendingSignal[] = [];
    const seen = new Set<number>();

    // リアルタイムシグナルは番号順にソート
    const sorted = [...proc.pendingSignals].sort((a, b) => a.signal - b.signal);

    for (const pending of sorted) {
      if (proc.signalMask.includes(pending.signal)) continue; // まだブロック中
      if (pending.signal < 34) {
        // 標準シグナル: 同番号は1回だけ
        if (!seen.has(pending.signal)) {
          seen.add(pending.signal);
          toDeliver.push(pending);
        }
      } else {
        // リアルタイムシグナル: 全て配送
        toDeliver.push(pending);
      }
    }

    // ペンディングキューから配送分を除去
    proc.pendingSignals = proc.pendingSignals.filter((p) =>
      proc.signalMask.includes(p.signal) || !toDeliver.includes(p));

    for (const pending of toDeliver) {
      deliverSignal(proc, pending.signal, pending.senderPid, pending.value);
    }
  }

  for (const op of ops) {
    step++;
    clock++;

    switch (op.type) {
      case "process_create": {
        const proc: Process = {
          ...op.process,
          handlers: [],
          signalMask: [],
          pendingSignals: [],
        };
        processes.push(proc);
        emit("process_create",
          `プロセス作成: PID=${proc.pid} "${proc.name}" (PPID=${proc.ppid}, uid=${proc.uid})`,
          proc.pid);
        break;
      }

      case "kill": {
        const sender = findProc(op.senderPid);
        const target = findProc(op.targetPid);

        if (!target) {
          emit("error", `kill失敗: PID=${op.targetPid} が存在しない (ESRCH)`, op.senderPid, op.signal);
          break;
        }
        if (target.state === "terminated" || target.state === "zombie") {
          emit("error", `kill失敗: PID=${op.targetPid} は既に終了 (ESRCH)`, op.senderPid, op.signal);
          break;
        }

        // 権限チェック（root or 同一uid）
        if (sender && sender.uid !== 0 && sender.uid !== target.uid) {
          emit("error", `kill失敗: 権限不足 — uid=${sender.uid} → uid=${target.uid} (EPERM)`, op.senderPid, op.signal);
          break;
        }

        emit("signal_send",
          `kill(${op.targetPid}, ${sigName(op.signal)}) — PID=${op.senderPid} → PID=${op.targetPid}`,
          op.senderPid, op.signal);

        deliverSignal(target, op.signal, op.senderPid);
        break;
      }

      case "raise": {
        const proc = findProc(op.pid);
        if (!proc) break;

        emit("signal_send",
          `raise(${sigName(op.signal)}) — PID=${op.pid} が自分自身にシグナル送信`,
          op.pid, op.signal);

        deliverSignal(proc, op.signal, op.pid);
        break;
      }

      case "sigqueue": {
        const target = findProc(op.targetPid);
        if (!target) {
          emit("error", `sigqueue失敗: PID=${op.targetPid} が存在しない`, op.senderPid, op.signal);
          break;
        }

        emit("sigqueue_send",
          `sigqueue(${op.targetPid}, ${sigName(op.signal)}, value=${op.value}) — データ付きシグナル送信`,
          op.senderPid, op.signal);

        deliverSignal(target, op.signal, op.senderPid, op.value);
        break;
      }

      case "sigaction": {
        const proc = findProc(op.pid);
        if (!proc) break;

        const sig = op.handler.signal;
        // SIGKILL/SIGSTOPはハンドラ設定不可
        if (sig === 9 || sig === 19) {
          emit("error",
            `sigaction失敗: ${sigName(sig)} はハンドラ変更不可 (EINVAL)`,
            op.pid, sig);
          break;
        }

        // 既存ハンドラを置き換え
        const idx = proc.handlers.findIndex((h) => h.signal === sig);
        if (idx >= 0) {
          proc.handlers[idx] = op.handler;
        } else {
          proc.handlers.push(op.handler);
        }

        const typeDesc = op.handler.type === "custom"
          ? `カスタムハンドラ "${op.handler.description ?? "handler"}"`
          : op.handler.type === "ignore" ? "SIG_IGN (無視)" : "SIG_DFL (デフォルト)";
        let flags = "";
        if (op.handler.restart) flags += " SA_RESTART";
        if (op.handler.siginfo) flags += " SA_SIGINFO";
        if (op.handler.nocldstop) flags += " SA_NOCLDSTOP";

        emit("sigaction_set",
          `sigaction(${sigName(sig)}, ${typeDesc}${flags ? ` [${flags.trim()}]` : ""})`,
          op.pid, sig);
        break;
      }

      case "sigmask_block": {
        const proc = findProc(op.pid);
        if (!proc) break;

        const added: number[] = [];
        for (const sig of op.signals) {
          if (sig === 9 || sig === 19) continue; // SIGKILL/SIGSTOPはマスク不可
          if (!proc.signalMask.includes(sig)) {
            proc.signalMask.push(sig);
            added.push(sig);
          }
        }

        emit("sigmask_update",
          `sigprocmask(SIG_BLOCK, [${added.map((s) => sigName(s)).join(", ")}]) — マスクに追加`,
          op.pid);
        break;
      }

      case "sigmask_unblock": {
        const proc = findProc(op.pid);
        if (!proc) break;

        const removed: number[] = [];
        for (const sig of op.signals) {
          const idx = proc.signalMask.indexOf(sig);
          if (idx >= 0) {
            proc.signalMask.splice(idx, 1);
            removed.push(sig);
          }
        }

        emit("sigmask_update",
          `sigprocmask(SIG_UNBLOCK, [${removed.map((s) => sigName(s)).join(", ")}]) — マスクから除去`,
          op.pid);

        // ペンディングシグナルを配送
        if (removed.length > 0) {
          flushPending(proc);
        }
        break;
      }

      case "sigpending": {
        const proc = findProc(op.pid);
        if (!proc) break;

        const pending = proc.pendingSignals.map((p) => sigName(p.signal));
        emit("sigpending_check",
          `sigpending() → [${pending.length > 0 ? pending.join(", ") : "なし"}]`,
          op.pid);
        break;
      }

      case "sigsuspend": {
        const proc = findProc(op.pid);
        if (!proc) break;

        const oldMask = [...proc.signalMask];
        proc.signalMask = [...op.tempMask];

        emit("sigsuspend",
          `sigsuspend([${op.tempMask.map((s) => sigName(s)).join(", ") || "空"}]) — 一時マスクで待機 (元マスク=[${oldMask.map((s) => sigName(s)).join(", ") || "空"}])`,
          op.pid);

        // 一時マスクでペンディングシグナルを処理
        flushPending(proc);

        // マスクを復元
        proc.signalMask = oldMask;
        emit("sigmask_update",
          `sigsuspend復帰 — マスクを復元: [${oldMask.map((s) => sigName(s)).join(", ") || "空"}]`,
          op.pid);
        break;
      }

      case "killpg": {
        const targetProcs = processes.filter((p) =>
          p.pid === op.pgid && p.state !== "terminated" && p.state !== "zombie");

        emit("killpg",
          `killpg(${op.pgid}, ${sigName(op.signal)}) — プロセスグループ ${op.pgid} の全プロセスにシグナル送信`,
          op.senderPid, op.signal);

        for (const proc of targetProcs) {
          deliverSignal(proc, op.signal, op.senderPid);
        }
        break;
      }

      case "alarm": {
        const proc = findProc(op.pid);
        if (!proc) break;

        emit("alarm_set",
          `alarm(${op.seconds}) — ${op.seconds}秒後にSIGALRM配送予約`,
          op.pid, 14);

        // 即座にSIGALRM発火（シミュレーション簡略化）
        emit("alarm_fire",
          `SIGALRM発火 — タイマー${op.seconds}秒経過`,
          op.pid, 14);

        deliverSignal(proc, 14, 0); // カーネルからの送信(pid=0)
        break;
      }

      case "pause": {
        const proc = findProc(op.pid);
        if (!proc) break;

        emit("pause",
          `pause() — シグナル受信まで待機 (PID=${op.pid})`,
          op.pid);

        // ペンディングがあれば処理
        if (proc.pendingSignals.length > 0) {
          flushPending(proc);
        }
        break;
      }

      case "fork": {
        const parent = findProc(op.parentPid);
        if (!parent) break;

        // 子プロセス作成: ハンドラとマスクを継承、ペンディングはクリア
        const child: Process = {
          pid: op.childPid,
          ppid: op.parentPid,
          name: op.childName,
          state: "running",
          uid: parent.uid,
          handlers: parent.handlers.map((h) => ({ ...h })),
          signalMask: [...parent.signalMask],
          pendingSignals: [],
        };
        processes.push(child);

        emit("fork",
          `fork() → PID=${op.childPid} "${op.childName}" (親PID=${op.parentPid}) — ハンドラ・マスク継承、ペンディングクリア`,
          op.parentPid);
        break;
      }
    }
  }

  return { events, processes, stats };
}
