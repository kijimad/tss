// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { EXAMPLES, buildUI, Example } from "../ui";

// EXAMPLES配列のテスト
describe("EXAMPLES", () => {
  it("5つのプリセット例が定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各例が必須フィールドを持つ", () => {
    for (const example of EXAMPLES) {
      expect(example.name).toBeTruthy();
      expect(example.algorithm).toBeTruthy();
      expect(example.tasks.length).toBeGreaterThan(0);
    }
  });

  it("正しい名前で定義されている", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(names).toContain("FCFS 基本");
    expect(names).toContain("SJF プリエンプティブ");
    expect(names).toContain("優先度スケジューリング");
    expect(names).toContain("ラウンドロビン (量子=2)");
    expect(names).toContain("ラウンドロビン (量子=4)");
  });

  it("正しいアルゴリズムが設定されている", () => {
    const algoMap = new Map<string, string>();
    for (const e of EXAMPLES) {
      algoMap.set(e.name, e.algorithm);
    }
    expect(algoMap.get("FCFS 基本")).toBe("fcfs");
    expect(algoMap.get("SJF プリエンプティブ")).toBe("sjf");
    expect(algoMap.get("優先度スケジューリング")).toBe("priority");
    expect(algoMap.get("ラウンドロビン (量子=2)")).toBe("roundRobin");
    expect(algoMap.get("ラウンドロビン (量子=4)")).toBe("roundRobin");
  });

  it("ラウンドロビン例にtimeQuantumが設定されている", () => {
    const rr2 = EXAMPLES.find((e) => e.name === "ラウンドロビン (量子=2)");
    const rr4 = EXAMPLES.find((e) => e.name === "ラウンドロビン (量子=4)");
    expect(rr2?.timeQuantum).toBe(2);
    expect(rr4?.timeQuantum).toBe(4);
  });

  it("各タスクが必須フィールドを持つ", () => {
    for (const example of EXAMPLES) {
      for (const task of example.tasks) {
        expect(typeof task.name).toBe("string");
        expect(typeof task.burstTime).toBe("number");
        expect(typeof task.arrivalTime).toBe("number");
        expect(typeof task.priority).toBe("number");
        expect(task.burstTime).toBeGreaterThan(0);
        expect(task.arrivalTime).toBeGreaterThanOrEqual(0);
        expect(task.priority).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("FCFS基本例は4つのタスクを持つ", () => {
    const fcfs = EXAMPLES.find((e) => e.name === "FCFS 基本");
    expect(fcfs?.tasks).toHaveLength(4);
  });
});

// buildUIのプリセット選択機能テスト
describe("buildUI プリセット選択", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  it("プリセットselectが返却オブジェクトに含まれる", () => {
    const ui = buildUI(root);
    expect(ui.exampleSelect).toBeInstanceOf(HTMLSelectElement);
  });

  it("プリセットselectにEXAMPLES+1個のoptionがある", () => {
    const ui = buildUI(root);
    // デフォルト「-- 選択 --」 + 5つのプリセット
    expect(ui.exampleSelect.options).toHaveLength(EXAMPLES.length + 1);
  });

  it("プリセットselectのデフォルト値が空文字", () => {
    const ui = buildUI(root);
    expect(ui.exampleSelect.value).toBe("");
  });

  it("プリセット選択時にアルゴリズムが変更される", () => {
    const ui = buildUI(root);
    // SJFプリエンプティブ（インデックス1）を選択
    ui.exampleSelect.value = "1";
    ui.exampleSelect.dispatchEvent(new Event("change"));
    expect(ui.algorithmSelect.value).toBe("sjf");
  });

  it("ラウンドロビンプリセット選択時にタイムクォンタムが設定される", () => {
    const ui = buildUI(root);
    // ラウンドロビン (量子=4)（インデックス4）を選択
    ui.exampleSelect.value = "4";
    ui.exampleSelect.dispatchEvent(new Event("change"));
    expect(ui.algorithmSelect.value).toBe("roundRobin");
    expect(ui.quantumInput.value).toBe("4");
  });

  it("プリセット選択時にタスクが正しい数だけ生成される", () => {
    const ui = buildUI(root);
    // FCFS基本を選択
    ui.exampleSelect.value = "0";
    ui.exampleSelect.dispatchEvent(new Event("change"));
    const tasks = ui.getTasks();
    expect(tasks).toHaveLength(EXAMPLES[0]!.tasks.length);
  });

  it("プリセット選択時にタスクのデータが正しく設定される", () => {
    const ui = buildUI(root);
    // 優先度スケジューリング（インデックス2）を選択
    ui.exampleSelect.value = "2";
    ui.exampleSelect.dispatchEvent(new Event("change"));
    const tasks = ui.getTasks();
    const example = EXAMPLES[2]!;

    for (let i = 0; i < example.tasks.length; i++) {
      expect(tasks[i]!.name).toBe(example.tasks[i]!.name);
      expect(tasks[i]!.burstTime).toBe(example.tasks[i]!.burstTime);
      expect(tasks[i]!.arrivalTime).toBe(example.tasks[i]!.arrivalTime);
      expect(tasks[i]!.priority).toBe(example.tasks[i]!.priority);
    }
  });

  it("無効な値を選択しても既存タスクが保持される", () => {
    const ui = buildUI(root);
    const tasksBefore = ui.getTasks();
    // 無効値（デフォルト）を選択
    ui.exampleSelect.value = "";
    ui.exampleSelect.dispatchEvent(new Event("change"));
    const tasksAfter = ui.getTasks();
    expect(tasksAfter).toHaveLength(tasksBefore.length);
  });
});
