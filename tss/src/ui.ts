import { Algorithm, Task } from "./scheduler";

// プリセット例の型定義
export interface Example {
  name: string;
  algorithm: Algorithm;
  tasks: Omit<Task, "id" | "color">[];
  timeQuantum?: number;
}

// プリセット例の一覧
export const EXAMPLES: Example[] = [
  {
    name: "FCFS 基本",
    algorithm: "fcfs",
    tasks: [
      { name: "P1", burstTime: 6, arrivalTime: 0, priority: 1 },
      { name: "P2", burstTime: 4, arrivalTime: 1, priority: 1 },
      { name: "P3", burstTime: 2, arrivalTime: 3, priority: 1 },
      { name: "P4", burstTime: 5, arrivalTime: 5, priority: 1 },
    ],
  },
  {
    name: "SJF プリエンプティブ",
    algorithm: "sjf",
    tasks: [
      { name: "P1", burstTime: 8, arrivalTime: 0, priority: 1 },
      { name: "P2", burstTime: 2, arrivalTime: 1, priority: 1 },
      { name: "P3", burstTime: 4, arrivalTime: 2, priority: 1 },
      { name: "P4", burstTime: 1, arrivalTime: 3, priority: 1 },
    ],
  },
  {
    name: "優先度スケジューリング",
    algorithm: "priority",
    tasks: [
      { name: "P1", burstTime: 5, arrivalTime: 0, priority: 3 },
      { name: "P2", burstTime: 3, arrivalTime: 0, priority: 1 },
      { name: "P3", burstTime: 8, arrivalTime: 0, priority: 4 },
      { name: "P4", burstTime: 2, arrivalTime: 0, priority: 2 },
    ],
  },
  {
    name: "ラウンドロビン (量子=2)",
    algorithm: "roundRobin",
    timeQuantum: 2,
    tasks: [
      { name: "P1", burstTime: 5, arrivalTime: 0, priority: 1 },
      { name: "P2", burstTime: 3, arrivalTime: 1, priority: 1 },
      { name: "P3", burstTime: 6, arrivalTime: 2, priority: 1 },
      { name: "P4", burstTime: 4, arrivalTime: 3, priority: 1 },
    ],
  },
  {
    name: "ラウンドロビン (量子=4)",
    algorithm: "roundRobin",
    timeQuantum: 4,
    tasks: [
      { name: "P1", burstTime: 7, arrivalTime: 0, priority: 1 },
      { name: "P2", burstTime: 3, arrivalTime: 1, priority: 1 },
      { name: "P3", burstTime: 5, arrivalTime: 2, priority: 1 },
      { name: "P4", burstTime: 4, arrivalTime: 4, priority: 1 },
    ],
  },
];

const TASK_COLORS = [
  "#4fc3f7", "#81c784", "#ffb74d", "#e57373",
  "#ba68c8", "#4dd0e1", "#fff176", "#f06292",
  "#aed581", "#ff8a65",
];

let nextId = 1;

// UI全体を構築する
export function buildUI(root: HTMLElement): {
  canvas: HTMLCanvasElement;
  algorithmSelect: HTMLSelectElement;
  exampleSelect: HTMLSelectElement;
  quantumInput: HTMLInputElement;
  quantumLabel: HTMLElement;
  taskListEl: HTMLElement;
  addTaskBtn: HTMLButtonElement;
  playBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  speedInput: HTMLInputElement;
  stepLabel: HTMLElement;
  getTasks: () => Task[];
} {
  root.innerHTML = "";

  // スタイル注入
  const style = document.createElement("style");
  style.textContent = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0e0e12; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', monospace; }
    #app { padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 20px; margin-bottom: 16px; color: #fff; }
    .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    .controls label { font-size: 13px; color: #aaa; }
    .controls select, .controls input, .controls button {
      background: #1a1a24; color: #e0e0e0; border: 1px solid #333;
      padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 13px;
    }
    .controls button { cursor: pointer; border-color: #555; }
    .controls button:hover { background: #2a2a3a; }
    .task-list { margin-bottom: 16px; }
    .task-row {
      display: flex; gap: 8px; align-items: center; margin-bottom: 6px;
      padding: 6px 8px; background: #14141c; border-radius: 4px;
    }
    .task-row input { width: 80px; }
    .task-row .name-input { width: 100px; }
    .task-row .color-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
    .task-row .remove-btn {
      background: none; border: none; color: #e57373; cursor: pointer;
      font-size: 16px; padding: 0 4px; font-family: inherit;
    }
    .task-row label { font-size: 12px; color: #777; min-width: 50px; }
    canvas { border: 1px solid #222; border-radius: 4px; display: block; margin-top: 8px; }
    .play-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .step-label { font-size: 13px; color: #888; margin-left: 12px; }
  `;
  document.head.appendChild(style);

  const h1 = document.createElement("h1");
  h1.textContent = "Task Scheduler Simulator";
  root.appendChild(h1);

  // アルゴリズム選択
  const controls = document.createElement("div");
  controls.className = "controls";

  const algoLabel = document.createElement("label");
  algoLabel.textContent = "アルゴリズム:";
  const algorithmSelect = document.createElement("select");
  const algorithms: { value: Algorithm; label: string }[] = [
    { value: "fcfs", label: "FCFS (先着順)" },
    { value: "sjf", label: "SJF (最短残時間)" },
    { value: "priority", label: "Priority (優先度)" },
    { value: "roundRobin", label: "Round Robin" },
  ];
  for (const algo of algorithms) {
    const opt = document.createElement("option");
    opt.value = algo.value;
    opt.textContent = algo.label;
    algorithmSelect.appendChild(opt);
  }

  const quantumLabel = document.createElement("label");
  quantumLabel.textContent = "タイムクォンタム:";
  quantumLabel.style.display = "none";
  const quantumInput = document.createElement("input");
  quantumInput.type = "number";
  quantumInput.min = "1";
  quantumInput.max = "20";
  quantumInput.value = "2";
  quantumInput.style.width = "60px";
  quantumInput.style.display = "none";

  // プリセット例選択
  const exampleLabel = document.createElement("label");
  exampleLabel.textContent = "プリセット:";
  const exampleSelect = document.createElement("select");
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "-- 選択 --";
  exampleSelect.appendChild(defaultOpt);
  for (let i = 0; i < EXAMPLES.length; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = EXAMPLES[i]!.name;
    exampleSelect.appendChild(opt);
  }

  controls.appendChild(algoLabel);
  controls.appendChild(algorithmSelect);
  controls.appendChild(quantumLabel);
  controls.appendChild(quantumInput);
  controls.appendChild(exampleLabel);
  controls.appendChild(exampleSelect);
  root.appendChild(controls);

  // タスクリスト
  const taskHeader = document.createElement("div");
  taskHeader.className = "controls";
  const taskTitle = document.createElement("label");
  taskTitle.textContent = "タスク一覧:";
  taskTitle.style.fontWeight = "bold";
  taskTitle.style.color = "#ccc";
  const addTaskBtn = document.createElement("button");
  addTaskBtn.textContent = "+ 追加";
  taskHeader.appendChild(taskTitle);
  taskHeader.appendChild(addTaskBtn);
  root.appendChild(taskHeader);

  const taskListEl = document.createElement("div");
  taskListEl.className = "task-list";
  root.appendChild(taskListEl);

  // 再生コントロール
  const playControls = document.createElement("div");
  playControls.className = "play-controls";

  const playBtn = document.createElement("button");
  playBtn.textContent = "▶ 再生";
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "⏹ リセット";

  const speedLabel = document.createElement("label");
  speedLabel.textContent = "速度:";
  const speedInput = document.createElement("input");
  speedInput.type = "range";
  speedInput.min = "1";
  speedInput.max = "10";
  speedInput.value = "3";
  speedInput.style.width = "100px";

  const stepLabel = document.createElement("span");
  stepLabel.className = "step-label";

  playControls.appendChild(playBtn);
  playControls.appendChild(resetBtn);
  playControls.appendChild(speedLabel);
  playControls.appendChild(speedInput);
  playControls.appendChild(stepLabel);
  root.appendChild(playControls);

  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 300;
  root.appendChild(canvas);

  // タスク管理
  const taskRows: { el: HTMLElement; getData: () => Task }[] = [];

  function addTaskRow(initial?: Partial<Task>): void {
    const id = nextId++;
    const colorIndex = (id - 1) % TASK_COLORS.length;
    const color = TASK_COLORS[colorIndex] ?? TASK_COLORS[0] ?? "#4fc3f7";

    const row = document.createElement("div");
    row.className = "task-row";

    const dot = document.createElement("div");
    dot.className = "color-dot";
    dot.style.backgroundColor = color;

    const nameInput = document.createElement("input");
    nameInput.className = "name-input";
    nameInput.value = initial?.name ?? `P${id}`;
    nameInput.placeholder = "名前";

    const burstLabel = document.createElement("label");
    burstLabel.textContent = "実行時間:";
    const burstInput = document.createElement("input");
    burstInput.type = "number";
    burstInput.min = "1";
    burstInput.max = "50";
    burstInput.value = String(initial?.burstTime ?? 3 + Math.floor(Math.random() * 6));

    const arrivalLabel = document.createElement("label");
    arrivalLabel.textContent = "到着:";
    const arrivalInput = document.createElement("input");
    arrivalInput.type = "number";
    arrivalInput.min = "0";
    arrivalInput.max = "50";
    arrivalInput.value = String(initial?.arrivalTime ?? 0);

    const prioLabel = document.createElement("label");
    prioLabel.textContent = "優先度:";
    const prioInput = document.createElement("input");
    prioInput.type = "number";
    prioInput.min = "1";
    prioInput.max = "10";
    prioInput.value = String(initial?.priority ?? Math.floor(Math.random() * 5) + 1);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      const idx = taskRows.findIndex((r) => r.el === row);
      if (idx !== -1) taskRows.splice(idx, 1);
      row.remove();
    });

    row.appendChild(dot);
    row.appendChild(nameInput);
    row.appendChild(burstLabel);
    row.appendChild(burstInput);
    row.appendChild(arrivalLabel);
    row.appendChild(arrivalInput);
    row.appendChild(prioLabel);
    row.appendChild(prioInput);
    row.appendChild(removeBtn);
    taskListEl.appendChild(row);

    taskRows.push({
      el: row,
      getData: () => ({
        id,
        name: nameInput.value,
        burstTime: parseInt(burstInput.value, 10) || 1,
        priority: parseInt(prioInput.value, 10) || 1,
        arrivalTime: parseInt(arrivalInput.value, 10) || 0,
        color,
      }),
    });
  }

  // デフォルトタスク
  addTaskRow({ name: "P1", burstTime: 5, arrivalTime: 0, priority: 3 });
  addTaskRow({ name: "P2", burstTime: 3, arrivalTime: 1, priority: 1 });
  addTaskRow({ name: "P3", burstTime: 7, arrivalTime: 2, priority: 4 });
  addTaskRow({ name: "P4", burstTime: 2, arrivalTime: 4, priority: 2 });

  addTaskBtn.addEventListener("click", () => addTaskRow());

  // プリセット例選択時にフォームを反映する
  exampleSelect.addEventListener("change", () => {
    const idx = parseInt(exampleSelect.value, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= EXAMPLES.length) return;
    const example = EXAMPLES[idx]!;

    // アルゴリズムを設定
    algorithmSelect.value = example.algorithm;
    algorithmSelect.dispatchEvent(new Event("change"));

    // タイムクォンタムを設定
    if (example.timeQuantum !== undefined) {
      quantumInput.value = String(example.timeQuantum);
    }

    // 既存タスク行をすべて削除
    taskRows.length = 0;
    taskListEl.innerHTML = "";

    // プリセットのタスクを追加
    for (const task of example.tasks) {
      addTaskRow(task);
    }
  });

  return {
    canvas,
    algorithmSelect,
    exampleSelect,
    quantumInput,
    quantumLabel,
    taskListEl,
    addTaskBtn,
    playBtn,
    resetBtn,
    speedInput,
    stepLabel,
    getTasks: () => taskRows.map((r) => r.getData()),
  };
}
