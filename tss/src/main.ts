import { simulate, ScheduleStep, Algorithm } from "./scheduler";
import { renderGantt } from "./renderer";
import { buildUI } from "./ui";

function main(): void {
  const root = document.getElementById("app");
  if (!root) return;

  const ui = buildUI(root);
  const ctxOrNull = ui.canvas.getContext("2d");
  if (!ctxOrNull) return;
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  let steps: ScheduleStep[] = [];
  let currentStep = -1;
  let playing = false;
  let timerId: number | null = null;

  // シミュレーションを実行してチャートを再描画
  function runSimulation(): void {
    const tasks = ui.getTasks();
    const algorithm = ui.algorithmSelect.value;
    const timeQuantum = parseInt(ui.quantumInput.value, 10) || 2;

    // アルゴリズムが正当な値かチェック
    const validAlgorithms: Algorithm[] = ["fcfs", "sjf", "priority", "roundRobin"];
    const selectedAlgorithm: Algorithm = validAlgorithms.includes(algorithm as Algorithm)
      ? (algorithm as Algorithm)
      : "fcfs";

    steps = simulate({
      algorithm: selectedAlgorithm,
      timeQuantum,
      tasks,
    });

    currentStep = steps.length - 1;
    updateStepLabel();
    renderGantt(ctx, ui.canvas, steps, tasks, currentStep);
  }

  function updateStepLabel(): void {
    if (steps.length === 0) {
      ui.stepLabel.textContent = "";
      return;
    }
    ui.stepLabel.textContent = `ステップ: ${currentStep + 1} / ${steps.length}`;
  }

  // アニメーション再生
  function play(): void {
    if (playing) {
      stop();
      return;
    }

    // 最後まで行っていたら最初から
    if (currentStep >= steps.length - 1) {
      currentStep = -1;
    }

    playing = true;
    ui.playBtn.textContent = "⏸ 一時停止";

    function tick(): void {
      if (!playing) return;
      currentStep++;
      if (currentStep >= steps.length) {
        stop();
        return;
      }
      updateStepLabel();
      renderGantt(ctx, ui.canvas, steps, ui.getTasks(), currentStep);
      const speed = parseInt(ui.speedInput.value, 10) || 3;
      const delay = Math.max(50, 600 - speed * 55);
      timerId = window.setTimeout(tick, delay);
    }

    tick();
  }

  function stop(): void {
    playing = false;
    ui.playBtn.textContent = "▶ 再生";
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function reset(): void {
    stop();
    currentStep = -1;
    updateStepLabel();
    renderGantt(ctx, ui.canvas, steps, ui.getTasks(), currentStep);
  }

  // タイムクォンタムの表示切替
  function updateQuantumVisibility(): void {
    const isRR = ui.algorithmSelect.value === "roundRobin";
    ui.quantumInput.style.display = isRR ? "" : "none";
    ui.quantumLabel.style.display = isRR ? "" : "none";
  }

  // イベントバインド
  ui.algorithmSelect.addEventListener("change", () => {
    updateQuantumVisibility();
    runSimulation();
  });
  ui.quantumInput.addEventListener("change", runSimulation);
  ui.playBtn.addEventListener("click", play);
  ui.resetBtn.addEventListener("click", reset);

  // タスクリストの変更を監視（input イベントで即時反映）
  ui.taskListEl.addEventListener("input", () => {
    stop();
    runSimulation();
  });
  ui.addTaskBtn.addEventListener("click", () => {
    // 少し遅延して新しい行が DOM に追加されてからシミュレーション
    requestAnimationFrame(runSimulation);
  });

  // 初回実行
  updateQuantumVisibility();
  runSimulation();
}

main();
