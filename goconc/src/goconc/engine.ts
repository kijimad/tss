import type {
  Goroutine, Channel, Mutex, WaitGroup, Processor, MachineThread,
  SimOp, SimEvent, SimulationResult, EventType,
} from "./types.js";

export function runSimulation(ops: SimOp[]): SimulationResult {
  const goroutines: Goroutine[] = [];
  const channels: Channel[] = [];
  const mutexes: Mutex[] = [];
  const waitGroups: WaitGroup[] = [];
  const processors: Processor[] = [{ id: 0, localRunQueue: [] }];
  const threads: MachineThread[] = [{ id: 0, pId: 0, state: "running" }];
  const events: SimEvent[] = [];
  let step = 0;
  let gomaxprocs = 1;

  const stats = {
    goroutinesCreated: 0, goroutinesExited: 0,
    channelSends: 0, channelRecvs: 0,
    mutexLocks: 0, contextSwitches: 0, deadlocks: 0,
  };

  // main goroutineを暗黙作成
  goroutines.push({ id: 0, name: "main", state: "running", pId: 0, stackSize: 8 });
  processors[0]!.currentG = 0;
  threads[0]!.currentG = 0;
  stats.goroutinesCreated++;

  function emit(type: EventType, desc: string, gId?: number, chId?: number): void {
    events.push({ step, type, description: desc, goroutineId: gId, chanId: chId });
  }

  function findG(id: number): Goroutine | undefined {
    return goroutines.find((g) => g.id === id);
  }
  function findCh(id: number): Channel | undefined {
    return channels.find((c) => c.id === id);
  }
  function findMu(id: number): Mutex | undefined {
    return mutexes.find((m) => m.id === id);
  }
  function findWg(id: number): WaitGroup | undefined {
    return waitGroups.find((w) => w.id === id);
  }

  /** goroutineをブロック状態にする */
  function blockG(g: Goroutine, reason: string): void {
    g.state = "blocked";
    g.blockReason = reason;
    emit("goroutine_block", `G${g.id} "${g.name}" ブロック: ${reason}`, g.id);
  }

  /** goroutineをランナブルに復帰 */
  function unblockG(g: Goroutine): void {
    g.state = "runnable";
    g.blockReason = undefined;
    // ローカルランキューに追加
    const p = processors[0];
    if (p && !p.localRunQueue.includes(g.id)) {
      p.localRunQueue.push(g.id);
    }
    emit("goroutine_unblock", `G${g.id} "${g.name}" ランナブルに復帰`, g.id);
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "go": {
        const g: Goroutine = {
          id: op.id, name: op.name, state: "runnable", stackSize: 2,
        };
        goroutines.push(g);
        stats.goroutinesCreated++;

        // ランキューに追加
        const p = processors[0];
        if (p) p.localRunQueue.push(op.id);

        emit("goroutine_create",
          `go ${op.name}() → G${op.id} 作成 (初期スタック=2KB, state=runnable)`,
          op.id);
        break;
      }

      case "chan_make": {
        const ch: Channel = {
          id: op.id, name: op.name, capacity: op.capacity,
          buffer: [], sendQueue: [], recvQueue: [], closed: false,
        };
        channels.push(ch);
        const bufType = op.capacity === 0 ? "unbuffered" : `buffered(cap=${op.capacity})`;
        emit("chan_make",
          `make(chan ${op.name}, ${op.capacity}) → Ch${op.id} [${bufType}]`,
          undefined, op.id);
        break;
      }

      case "chan_send": {
        const g = findG(op.goroutineId);
        const ch = findCh(op.chanId);
        if (!g || !ch) break;

        if (ch.closed) {
          emit("panic", `panic: send on closed channel (G${g.id} → Ch${ch.id} "${ch.name}")`, g.id, ch.id);
          g.state = "dead";
          break;
        }

        stats.channelSends++;

        if (ch.capacity === 0) {
          // unbuffered: 受信者がいれば直接渡す、なければブロック
          if (ch.recvQueue.length > 0) {
            const recvGId = ch.recvQueue.shift()!;
            const recvG = findG(recvGId);
            emit("chan_send",
              `Ch${ch.id} "${ch.name}" ← "${op.value}" (G${g.id}→G${recvGId}, 同期渡し)`,
              g.id, ch.id);
            if (recvG) unblockG(recvG);
          } else {
            ch.sendQueue.push(g.id);
            ch.buffer.push(op.value); // 一時的にバッファに保持
            emit("chan_send_block",
              `G${g.id} ブロック: Ch${ch.id} "${ch.name}" への送信待ち (unbuffered, 受信者なし)`,
              g.id, ch.id);
            blockG(g, `ch send: ${ch.name}`);
          }
        } else {
          // buffered: バッファに空きがあれば書き込み、なければブロック
          if (ch.buffer.length < ch.capacity) {
            ch.buffer.push(op.value);
            emit("chan_send",
              `Ch${ch.id} "${ch.name}" ← "${op.value}" (buf: ${ch.buffer.length}/${ch.capacity})`,
              g.id, ch.id);
            // 受信待ちがいれば起こす
            if (ch.recvQueue.length > 0) {
              const recvGId = ch.recvQueue.shift()!;
              const recvG = findG(recvGId);
              if (recvG) unblockG(recvG);
            }
          } else {
            ch.sendQueue.push(g.id);
            emit("chan_send_block",
              `G${g.id} ブロック: Ch${ch.id} "${ch.name}" バッファ満杯 (${ch.buffer.length}/${ch.capacity})`,
              g.id, ch.id);
            blockG(g, `ch send: ${ch.name} (full)`);
          }
        }
        break;
      }

      case "chan_recv": {
        const g = findG(op.goroutineId);
        const ch = findCh(op.chanId);
        if (!g || !ch) break;

        stats.channelRecvs++;

        if (ch.buffer.length > 0) {
          const val = ch.buffer.shift()!;
          emit("chan_recv",
            `"${val}" ← Ch${ch.id} "${ch.name}" (G${g.id} 受信${ch.closed ? ", closed" : ""})`,
            g.id, ch.id);
          // 送信待ちがいれば起こす
          if (ch.sendQueue.length > 0) {
            const sendGId = ch.sendQueue.shift()!;
            const sendG = findG(sendGId);
            if (sendG) unblockG(sendG);
          }
        } else if (ch.closed) {
          emit("chan_recv_closed",
            `zero-value ← Ch${ch.id} "${ch.name}" (closed, G${g.id})`,
            g.id, ch.id);
        } else {
          // ブロック
          ch.recvQueue.push(g.id);
          emit("chan_recv_block",
            `G${g.id} ブロック: Ch${ch.id} "${ch.name}" からの受信待ち`,
            g.id, ch.id);
          blockG(g, `ch recv: ${ch.name}`);

          // unbufferedで送信待ちがいれば解決
          if (ch.capacity === 0 && ch.sendQueue.length > 0) {
            const sendGId = ch.sendQueue.shift()!;
            const sendG = findG(sendGId);
            if (sendG) {
              // 受信キューから自身を除去して解決
              const recvIdx = ch.recvQueue.indexOf(g.id);
              if (recvIdx >= 0) ch.recvQueue.splice(recvIdx, 1);
              const val = ch.buffer.shift() ?? "";
              unblockG(g);
              unblockG(sendG);
              emit("chan_recv",
                `"${val}" ← Ch${ch.id} "${ch.name}" (G${sendGId}→G${g.id}, 同期渡し解決)`,
                g.id, ch.id);
            }
          }
        }
        break;
      }

      case "chan_close": {
        const ch = findCh(op.chanId);
        if (!ch) break;

        if (ch.closed) {
          emit("panic", `panic: close of closed channel (Ch${ch.id})`, op.goroutineId, ch.id);
          break;
        }

        ch.closed = true;
        emit("chan_close",
          `close(Ch${ch.id} "${ch.name}") — G${op.goroutineId}がチャネルをクローズ`,
          op.goroutineId, ch.id);

        // 受信待ちの全goroutineを起こす（zero-value受信）
        while (ch.recvQueue.length > 0) {
          const gId = ch.recvQueue.shift()!;
          const g = findG(gId);
          if (g) {
            unblockG(g);
            emit("chan_recv_closed",
              `G${gId}: zero-value受信 (チャネルclose)`,
              gId, ch.id);
          }
        }
        break;
      }

      case "select": {
        const g = findG(op.goroutineId);
        if (!g) break;

        emit("select_enter",
          `G${g.id}: select { ${op.cases.length}ケース }`,
          g.id);

        // ready なケースを探す
        let resolved = false;
        for (const c of op.cases) {
          if (c.isDefault) continue;
          const ch = findCh(c.chanId);
          if (!ch) continue;

          if (c.dir === "recv" && (ch.buffer.length > 0 || ch.closed)) {
            const val = ch.buffer.length > 0 ? ch.buffer.shift()! : "zero-value";
            emit("select_case",
              `select → case "${val}" ← Ch${ch.id} "${ch.name}" (ready)`,
              g.id, ch.id);
            stats.channelRecvs++;
            if (ch.sendQueue.length > 0) {
              const sendGId = ch.sendQueue.shift()!;
              const sendG = findG(sendGId);
              if (sendG) unblockG(sendG);
            }
            resolved = true;
            break;
          }

          if (c.dir === "send" && ch.capacity > 0 && ch.buffer.length < ch.capacity) {
            ch.buffer.push(c.value ?? "");
            emit("select_case",
              `select → case Ch${ch.id} "${ch.name}" ← "${c.value}" (ready, buf=${ch.buffer.length}/${ch.capacity})`,
              g.id, ch.id);
            stats.channelSends++;
            resolved = true;
            break;
          }

          if (c.dir === "send" && ch.capacity === 0 && ch.recvQueue.length > 0) {
            const recvGId = ch.recvQueue.shift()!;
            const recvG = findG(recvGId);
            emit("select_case",
              `select → case Ch${ch.id} "${ch.name}" ← "${c.value}" (同期渡し→G${recvGId})`,
              g.id, ch.id);
            stats.channelSends++;
            if (recvG) unblockG(recvG);
            resolved = true;
            break;
          }
        }

        if (!resolved) {
          // default caseがあればそれを実行
          const defaultCase = op.cases.find((c) => c.isDefault);
          if (defaultCase) {
            emit("select_default", `select → default (全ケースブロック)`, g.id);
          } else {
            // 全ケースブロック → goroutineブロック
            blockG(g, "select: all cases blocked");
            for (const c of op.cases) {
              const ch = findCh(c.chanId);
              if (!ch) continue;
              if (c.dir === "recv") ch.recvQueue.push(g.id);
              else ch.sendQueue.push(g.id);
            }
          }
        }
        break;
      }

      case "mutex_make": {
        mutexes.push({ id: op.id, name: op.name, locked: false, waitQueue: [] });
        emit("mutex_lock", `var ${op.name} sync.Mutex — Mutex${op.id} 作成`, undefined);
        break;
      }

      case "mutex_lock": {
        const g = findG(op.goroutineId);
        const mu = findMu(op.mutexId);
        if (!g || !mu) break;

        stats.mutexLocks++;

        if (!mu.locked) {
          mu.locked = true;
          mu.owner = g.id;
          emit("mutex_lock",
            `G${g.id}: ${mu.name}.Lock() — ロック取得成功`,
            g.id);
        } else {
          mu.waitQueue.push(g.id);
          emit("mutex_lock_block",
            `G${g.id}: ${mu.name}.Lock() — ブロック (所有者=G${mu.owner})`,
            g.id);
          blockG(g, `mutex: ${mu.name} (owner=G${mu.owner})`);
        }
        break;
      }

      case "mutex_unlock": {
        const mu = findMu(op.mutexId);
        if (!mu) break;

        if (!mu.locked || mu.owner !== op.goroutineId) {
          emit("panic", `panic: sync: unlock of unlocked mutex (G${op.goroutineId})`, op.goroutineId);
          break;
        }

        emit("mutex_unlock",
          `G${op.goroutineId}: ${mu.name}.Unlock() — ロック解放`,
          op.goroutineId);

        if (mu.waitQueue.length > 0) {
          const nextGId = mu.waitQueue.shift()!;
          mu.owner = nextGId;
          const nextG = findG(nextGId);
          if (nextG) {
            unblockG(nextG);
            emit("mutex_lock",
              `G${nextGId}: ${mu.name}.Lock() — 待機解除、ロック取得`,
              nextGId);
          }
        } else {
          mu.locked = false;
          mu.owner = undefined;
        }
        break;
      }

      case "wg_make": {
        waitGroups.push({ id: op.id, name: op.name, counter: 0, waiters: [] });
        emit("wg_add", `var ${op.name} sync.WaitGroup — WG${op.id} 作成`, undefined);
        break;
      }

      case "wg_add": {
        const wg = findWg(op.wgId);
        if (!wg) break;
        wg.counter += op.delta;
        emit("wg_add",
          `${wg.name}.Add(${op.delta}) → counter=${wg.counter}`,
          undefined);

        if (wg.counter < 0) {
          emit("panic", `panic: sync: negative WaitGroup counter`, undefined);
        }
        break;
      }

      case "wg_done": {
        const wg = findWg(op.wgId);
        if (!wg) break;
        wg.counter--;
        emit("wg_done",
          `G${op.goroutineId}: ${wg.name}.Done() → counter=${wg.counter}`,
          op.goroutineId);

        if (wg.counter === 0) {
          // 全waiterを起こす
          emit("wg_release",
            `${wg.name}: counter=0 → ${wg.waiters.length}個のWait()を解放`,
            undefined);
          while (wg.waiters.length > 0) {
            const gId = wg.waiters.shift()!;
            const g = findG(gId);
            if (g) unblockG(g);
          }
        }

        if (wg.counter < 0) {
          emit("panic", `panic: sync: negative WaitGroup counter`, op.goroutineId);
        }
        break;
      }

      case "wg_wait": {
        const g = findG(op.goroutineId);
        const wg = findWg(op.wgId);
        if (!g || !wg) break;

        if (wg.counter === 0) {
          emit("wg_wait",
            `G${g.id}: ${wg.name}.Wait() — counter=0、即座に復帰`,
            g.id);
        } else {
          wg.waiters.push(g.id);
          emit("wg_wait_block",
            `G${g.id}: ${wg.name}.Wait() — ブロック (counter=${wg.counter})`,
            g.id);
          blockG(g, `WaitGroup: ${wg.name} (counter=${wg.counter})`);
        }
        break;
      }

      case "goroutine_exit": {
        const g = findG(op.goroutineId);
        if (!g) break;
        g.state = "dead";
        stats.goroutinesExited++;

        // Pから除去
        for (const p of processors) {
          if (p.currentG === g.id) p.currentG = undefined;
          p.localRunQueue = p.localRunQueue.filter((id) => id !== g.id);
        }

        emit("goroutine_exit",
          `G${g.id} "${g.name}" 終了 (state=dead)`,
          g.id);
        break;
      }

      case "schedule": {
        stats.contextSwitches++;
        emit("schedule", `スケジューラ起動 — コンテキストスイッチ`, undefined);

        for (const p of processors) {
          if (p.localRunQueue.length > 0 && p.currentG === undefined) {
            const nextGId = p.localRunQueue.shift()!;
            const nextG = findG(nextGId);
            if (nextG && nextG.state === "runnable") {
              nextG.state = "running";
              nextG.pId = p.id;
              p.currentG = nextGId;
              emit("goroutine_run",
                `P${p.id}: G${nextGId} "${nextG.name}" を実行開始`,
                nextGId);
            }
          }
        }
        break;
      }

      case "set_gomaxprocs": {
        const oldN = gomaxprocs;
        gomaxprocs = op.n;
        // Pを追加
        while (processors.length < op.n) {
          const pId = processors.length;
          processors.push({ id: pId, localRunQueue: [] });
          threads.push({ id: threads.length, pId, state: "idle" });
        }
        emit("set_gomaxprocs",
          `runtime.GOMAXPROCS(${op.n}) — P数: ${oldN} → ${op.n}`,
          undefined);
        break;
      }
    }
  }

  // デッドロック検出: ブロック中のgoroutineがいて、runnableが全くない場合
  const alive = goroutines.filter((g) => g.state !== "dead");
  const blocked = alive.filter((g) => g.state === "blocked");
  if (blocked.length > 0 && alive.every((g) => g.state === "blocked" || g.state === "dead")) {
    stats.deadlocks++;
    emit("deadlock",
      `fatal error: all goroutines are asleep — deadlock! (${blocked.length}個のgoroutineがブロック中)`,
      undefined);
  }

  return { events, goroutines, channels, mutexes, waitGroups, processors, threads, stats };
}
