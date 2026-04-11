import { describe, it, expect } from "vitest";
import {
  createIdt,
  createPic,
  createCpu,
  runSimulation,
  presets,
} from "../interrupt/index.js";
import type { IdtEntry, InterruptRequest } from "../interrupt/index.js";

/** テスト用IDTエントリ */
const timerEntry: IdtEntry = {
  vector: 32, name: "タイマー", handlerName: "timer_handler",
  class: "hardware", device: "timer", priority: 0,
  maskable: true, handlerCycles: 3,
};

const kbdEntry: IdtEntry = {
  vector: 33, name: "キーボード", handlerName: "kbd_handler",
  class: "hardware", device: "keyboard", priority: 1,
  maskable: true, handlerCycles: 4,
};

const diskEntry: IdtEntry = {
  vector: 38, name: "ディスク", handlerName: "disk_handler",
  class: "hardware", device: "disk", priority: 4,
  maskable: true, handlerCycles: 8,
};

const nmiEntry: IdtEntry = {
  vector: 0, name: "除算エラー", handlerName: "div_error",
  class: "exception", device: "cpu", priority: 0,
  maskable: false, handlerCycles: 5,
};

const syscallEntry: IdtEntry = {
  vector: 0x80, name: "システムコール", handlerName: "syscall_handler",
  class: "software", device: "software", priority: 3,
  maskable: true, handlerCycles: 6,
};

describe("IDT・PIC・CPU初期化", () => {
  it("IDTを作成できる", () => {
    const idt = createIdt([timerEntry, kbdEntry]);
    expect(idt.size).toBe(2);
    expect(idt.get(32)?.name).toBe("タイマー");
    expect(idt.get(33)?.name).toBe("キーボード");
  });

  it("PICの初期状態が正しい", () => {
    const pic = createPic(0xFF);
    expect(pic.imr).toBe(0xFF);
    expect(pic.irr).toBe(0);
    expect(pic.isr).toBe(0);
  });

  it("CPUの初期状態が正しい", () => {
    const cpu = createCpu();
    expect(cpu.mode).toBe("user");
    expect(cpu.interruptEnabled).toBe(true);
    expect(cpu.currentVector).toBeNull();
  });
});

describe("基本的な割り込み処理", () => {
  it("単一のタイマー割り込みを処理できる", () => {
    const idt = createIdt([timerEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.handledCount).toBe(1);
    expect(result.maskedCount).toBe(0);
    expect(result.events.some((e) => e.type === "handler_start")).toBe(true);
    expect(result.events.some((e) => e.type === "handler_end")).toBe(true);
  });

  it("複数の割り込みを順次処理できる", () => {
    const idt = createIdt([timerEntry, kbdEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
      { irq: 1, vector: 33, triggerCycle: 20, device: "キーボード", description: "key" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.handledCount).toBe(2);
  });

  it("コンテキスト保存と復帰が行われる", () => {
    const idt = createIdt([timerEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.events.some((e) => e.type === "context_save")).toBe(true);
    expect(result.events.some((e) => e.type === "context_restore")).toBe(true);
  });

  it("user→kernelモード遷移が行われる", () => {
    const idt = createIdt([timerEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.events.some((e) => e.type === "mode_switch")).toBe(true);
    expect(result.events.some((e) => e.type === "mode_return")).toBe(true);
  });

  it("EOIが送信される", () => {
    const idt = createIdt([timerEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.events.some((e) => e.type === "eoi")).toBe(true);
  });
});

describe("割り込みマスク（IMR）", () => {
  it("マスクされたIRQは処理されない", () => {
    const idt = createIdt([timerEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
    ];
    // IRQ0をマスク（ビット0）
    const result = runSimulation(idt, requests, 0b00000001);
    expect(result.handledCount).toBe(0);
    expect(result.maskedCount).toBe(1);
    expect(result.events.some((e) => e.type === "irq_masked")).toBe(true);
  });

  it("マスクされていないIRQは処理される", () => {
    const idt = createIdt([timerEntry, kbdEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
      { irq: 1, vector: 33, triggerCycle: 20, device: "キーボード", description: "key" },
    ];
    // IRQ1のみマスク
    const result = runSimulation(idt, requests, 0b00000010);
    expect(result.handledCount).toBe(1);
    expect(result.maskedCount).toBe(1);
  });
});

describe("NMI（マスク不可割り込み）", () => {
  it("NMIはIMRに関係なく処理される", () => {
    const idt = createIdt([nmiEntry]);
    const requests: InterruptRequest[] = [
      { vector: 0, triggerCycle: 5, device: "CPU", description: "除算エラー" },
    ];
    // 全IRQマスクでもNMIは通る
    const result = runSimulation(idt, requests, 0xFF);
    expect(result.handledCount).toBe(1);
    expect(result.events.some((e) => e.type === "nmi")).toBe(true);
  });
});

describe("ネスト割り込み", () => {
  it("高優先度の割り込みが低優先度を中断する", () => {
    const idt = createIdt([timerEntry, diskEntry]);
    const requests: InterruptRequest[] = [
      { irq: 6, vector: 38, triggerCycle: 5, device: "ディスク", description: "DMA完了" },
      { irq: 0, vector: 32, triggerCycle: 8, device: "タイマー", description: "tick" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.nestedCount).toBeGreaterThan(0);
    expect(result.events.some((e) => e.type === "nested_interrupt")).toBe(true);
  });
});

describe("CLI/STI", () => {
  it("ハンドラ開始時にCLIが自動実行される", () => {
    const idt = createIdt([timerEntry]);
    const requests: InterruptRequest[] = [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "tick" },
    ];
    const result = runSimulation(idt, requests);
    const cliEvents = result.events.filter((e) => e.type === "cli");
    expect(cliEvents.length).toBeGreaterThan(0);
  });
});

describe("システムコール", () => {
  it("INT 0x80でシステムコールが処理される", () => {
    const idt = createIdt([syscallEntry]);
    const requests: InterruptRequest[] = [
      { vector: 0x80, triggerCycle: 5, device: "プロセス", description: "syscall" },
    ];
    const result = runSimulation(idt, requests);
    expect(result.handledCount).toBe(1);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const idt = createIdt(preset.idt);
      const result = runSimulation(idt, preset.requests, preset.initialImr);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
      expect(result.totalCycles, `${preset.name}: サイクルが0`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });

  it("ハードウェア割り込みプリセットで割り込みが処理される", () => {
    const preset = presets[0]!; // タイマー割り込み
    const idt = createIdt(preset.idt);
    const result = runSimulation(idt, preset.requests, preset.initialImr);
    expect(result.handledCount).toBeGreaterThan(0);
  });

  it("マスクプリセットでマスクされた割り込みがカウントされる", () => {
    const preset = presets[2]!; // IMRプリセット
    const idt = createIdt(preset.idt);
    const result = runSimulation(idt, preset.requests, preset.initialImr);
    expect(result.maskedCount).toBeGreaterThan(0);
  });
});
