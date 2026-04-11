import type {
  IdtEntry,
  PicState,
  CpuState,
  InterruptRequest,
  StackFrame,
  SimEvent,
  SimulationResult,
  VectorNumber,
} from "./types.js";

/** IDT（割り込み記述子テーブル）を作成 */
export function createIdt(entries: IdtEntry[]): Map<VectorNumber, IdtEntry> {
  const idt = new Map<VectorNumber, IdtEntry>();
  for (const entry of entries) {
    idt.set(entry.vector, entry);
  }
  return idt;
}

/** PICの初期状態を作成 */
export function createPic(imr: number = 0): PicState {
  return { imr, irr: 0, isr: 0 };
}

/** CPUの初期状態を作成 */
export function createCpu(): CpuState {
  return {
    mode: "user",
    interruptEnabled: true,
    currentVector: null,
    pc: 0x1000,
    sp: 0xFFFC,
    registers: { eax: 0, ebx: 0, ecx: 0, edx: 0 },
    cycle: 0,
  };
}

/** 割り込みシミュレーションを実行 */
export function runSimulation(
  idt: Map<VectorNumber, IdtEntry>,
  requests: InterruptRequest[],
  initialImr: number = 0,
  maxCycles: number = 200
): SimulationResult {
  const events: SimEvent[] = [];
  const pic = createPic(initialImr);
  const cpu = createCpu();
  const stack: StackFrame[] = [];
  let handledCount = 0;
  let maskedCount = 0;
  let nestedCount = 0;

  // 割り込みをサイクル順にソート
  const sortedRequests = [...requests].sort((a, b) => a.triggerCycle - b.triggerCycle);
  let reqIndex = 0;

  // 現在処理中のハンドラの残りサイクル
  let handlerRemaining = 0;
  let handlerVector: VectorNumber | null = null;

  while (cpu.cycle < maxCycles) {
    // 1. このサイクルで発生する割り込みをチェック
    while (reqIndex < sortedRequests.length && sortedRequests[reqIndex]!.triggerCycle <= cpu.cycle) {
      const req = sortedRequests[reqIndex]!;
      reqIndex++;

      events.push({
        cycle: cpu.cycle,
        type: "irq_raised",
        description: `${req.device}: ${req.description} (IRQ${req.irq ?? "N/A"}, vector=${req.vector})`,
        details: { device: req.device, vector: req.vector, irq: req.irq ?? -1 },
      });

      const entry = idt.get(req.vector);
      if (!entry) {
        events.push({
          cycle: cpu.cycle,
          type: "exception",
          description: `ベクタ ${req.vector} がIDTに存在しません`,
        });
        continue;
      }

      // NMI（マスク不可割り込み）
      if (!entry.maskable) {
        events.push({
          cycle: cpu.cycle,
          type: "nmi",
          description: `NMI: ${entry.name} — マスク不可、即座に処理`,
        });
        processInterrupt(cpu, pic, idt, stack, req.vector, events, handlerVector !== null);
        if (handlerVector !== null) nestedCount++;
        handlerVector = req.vector;
        handlerRemaining = entry.handlerCycles;
        handledCount++;
        continue;
      }

      // IRQベースのマスクチェック
      if (req.irq !== undefined) {
        const irqBit = 1 << req.irq;

        // PICのIMRでマスクされているか
        if (pic.imr & irqBit) {
          events.push({
            cycle: cpu.cycle,
            type: "irq_masked",
            description: `IRQ${req.irq} はIMRでマスク中 (IMR=0b${pic.imr.toString(2).padStart(8, "0")})`,
            details: { irq: req.irq, imr: pic.imr },
          });
          maskedCount++;
          continue;
        }

        // IRRにセット
        pic.irr |= irqBit;
        events.push({
          cycle: cpu.cycle,
          type: "irq_pending",
          description: `IRQ${req.irq} をIRRにセット (IRR=0b${pic.irr.toString(2).padStart(8, "0")})`,
          details: { irr: pic.irr },
        });
      }

      // CPUの割り込み許可フラグチェック
      if (!cpu.interruptEnabled) {
        events.push({
          cycle: cpu.cycle,
          type: "cli",
          description: `CPUのIFフラグ=0: 割り込み禁止中、ペンディングのまま`,
        });
        continue;
      }

      // 優先度チェック（現在処理中の割り込みよりも高優先度か）
      if (handlerVector !== null) {
        const currentEntry = idt.get(handlerVector);
        if (currentEntry && entry.priority >= currentEntry.priority) {
          events.push({
            cycle: cpu.cycle,
            type: "info",
            description: `優先度不足: ${entry.name}(pri=${entry.priority}) ≤ 現在処理中(pri=${currentEntry.priority})`,
          });
          continue;
        }
        // ネスト割り込み
        nestedCount++;
        events.push({
          cycle: cpu.cycle,
          type: "nested_interrupt",
          description: `ネスト割り込み: ${entry.name}(pri=${entry.priority}) が ${currentEntry?.name}(pri=${currentEntry?.priority}) を中断`,
        });
      }

      // 割り込み受付
      processInterrupt(cpu, pic, idt, stack, req.vector, events, handlerVector !== null);
      handlerVector = req.vector;
      handlerRemaining = entry.handlerCycles;
      handledCount++;
    }

    // 2. ハンドラ実行中ならサイクル消費
    if (handlerRemaining > 0) {
      handlerRemaining--;
      if (handlerRemaining === 0) {
        // ハンドラ完了
        const entry = idt.get(handlerVector!);
        events.push({
          cycle: cpu.cycle,
          type: "handler_end",
          description: `${entry?.handlerName ?? "handler"} 実行完了`,
        });

        // EOI
        if (entry) {
          const irqReq = requests.find((r) => r.vector === handlerVector);
          if (irqReq?.irq !== undefined) {
            const irqBit = 1 << irqReq.irq;
            pic.isr &= ~irqBit;
            pic.irr &= ~irqBit;
          }
          events.push({
            cycle: cpu.cycle,
            type: "eoi",
            description: `EOI送信: ベクタ ${handlerVector} の処理完了をPICに通知`,
            details: { isr: pic.isr },
          });
        }

        // コンテキスト復帰
        if (stack.length > 0) {
          const frame = stack.pop()!;
          cpu.pc = frame.returnAddress;
          cpu.mode = frame.previousMode;
          cpu.registers = { ...frame.savedRegisters };
          cpu.interruptEnabled = true;

          events.push({
            cycle: cpu.cycle,
            type: "context_restore",
            description: `コンテキスト復帰: PC=0x${frame.returnAddress.toString(16)}, mode=${frame.previousMode}`,
          });

          if (frame.previousMode === "user") {
            events.push({
              cycle: cpu.cycle,
              type: "mode_return",
              description: `kernel → user モード復帰 (IRET)`,
            });
          }
        }

        // ネストされていた場合、前の割り込みに戻る
        handlerVector = cpu.currentVector;
        if (handlerVector !== null) {
          const prevEntry = idt.get(handlerVector);
          handlerRemaining = 1; // 残り処理の簡略化
          events.push({
            cycle: cpu.cycle,
            type: "info",
            description: `中断されていた ${prevEntry?.name ?? "handler"} の処理を再開`,
          });
        }
        cpu.currentVector = null;
      }
    }

    cpu.cycle++;

    // 全リクエスト処理済み＆ハンドラなしなら終了
    if (reqIndex >= sortedRequests.length && handlerRemaining === 0 && cpu.cycle > (sortedRequests[sortedRequests.length - 1]?.triggerCycle ?? 0) + 10) {
      break;
    }
  }

  return {
    events,
    finalCpu: { ...cpu },
    finalPic: { ...pic },
    handledCount,
    maskedCount,
    nestedCount,
    totalCycles: cpu.cycle,
  };
}

/** 割り込み処理（コンテキスト保存→モード遷移→ハンドラディスパッチ） */
function processInterrupt(
  cpu: CpuState,
  pic: PicState,
  idt: Map<VectorNumber, IdtEntry>,
  stack: StackFrame[],
  vector: VectorNumber,
  events: SimEvent[],
  _isNested: boolean
): void {
  const entry = idt.get(vector);
  if (!entry) return;

  // INTA（割り込み応答）
  events.push({
    cycle: cpu.cycle,
    type: "cpu_ack",
    description: `CPU → PIC: INTA信号送信、ベクタ ${vector} を受信`,
  });

  // IDT参照
  events.push({
    cycle: cpu.cycle,
    type: "vector_dispatch",
    description: `IDT[${vector}] → ${entry.handlerName} (${entry.name})`,
    details: { vector, handler: entry.handlerName, priority: entry.priority },
  });

  // コンテキスト保存
  const frame: StackFrame = {
    returnAddress: cpu.pc,
    flags: cpu.interruptEnabled ? 0x200 : 0,
    savedRegisters: { ...cpu.registers },
    previousMode: cpu.mode,
  };
  stack.push(frame);
  cpu.sp -= 12; // FLAGS, CS, EIP をプッシュ

  events.push({
    cycle: cpu.cycle,
    type: "context_save",
    description: `コンテキスト保存: PC=0x${cpu.pc.toString(16)}, FLAGS=0x${frame.flags.toString(16)}, SP=0x${cpu.sp.toString(16)}`,
    details: { pc: cpu.pc, sp: cpu.sp, flags: frame.flags },
  });

  // モード遷移
  if (cpu.mode === "user") {
    events.push({
      cycle: cpu.cycle,
      type: "mode_switch",
      description: `user → kernel モード遷移（特権レベル変更）`,
    });
  }
  cpu.mode = "kernel";

  // 割り込み禁止（自動的にCLI）
  cpu.interruptEnabled = false;
  events.push({
    cycle: cpu.cycle,
    type: "cli",
    description: `自動CLI: 割り込み禁止（IF=0）`,
  });

  // ISRビットセット
  const irqBit = findIrqForVector(vector, pic);
  if (irqBit >= 0) {
    pic.isr |= (1 << irqBit);
  }

  // ハンドラへジャンプ
  cpu.pc = 0x8000 + vector * 0x10; // ハンドラアドレス（仮想）
  cpu.currentVector = vector;

  events.push({
    cycle: cpu.cycle,
    type: "handler_start",
    description: `${entry.handlerName} 実行開始 (PC=0x${cpu.pc.toString(16)}, ${entry.handlerCycles}サイクル)`,
    details: { handler: entry.handlerName, cycles: entry.handlerCycles },
  });

  // ハンドラ内でSTI（マスク可能な割り込みはネスト許可）
  if (entry.maskable) {
    cpu.interruptEnabled = true;
    events.push({
      cycle: cpu.cycle,
      type: "sti",
      description: `ハンドラ内STI: 高優先度割り込みの受付を許可`,
    });
  }
}

/** ベクタからIRQ番号を逆引き（簡易） */
function findIrqForVector(_vector: VectorNumber, _pic: PicState): number {
  // 簡易実装: ベクタ32〜39はIRQ0〜7に対応
  if (_vector >= 32 && _vector <= 39) return _vector - 32;
  return -1;
}
