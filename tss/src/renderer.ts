import { ScheduleStep, Task } from "./scheduler";

const CELL_W = 48;
const CELL_H = 36;
const HEADER_H = 40;
const LEFT_MARGIN = 120;
const TOP_MARGIN = 20;
const PADDING = 16;

// ガントチャートとキュー状態を Canvas に描画する
export function renderGantt(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  steps: ScheduleStep[],
  tasks: Task[],
  currentStep: number
): void {
  const totalSteps = steps.length;
  const width = LEFT_MARGIN + CELL_W * totalSteps + PADDING * 2;
  const height = TOP_MARGIN + HEADER_H + CELL_H * tasks.length + PADDING * 2 + 60;

  canvas.width = Math.max(width, 600);
  canvas.height = Math.max(height, 300);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0e0e12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (totalSteps === 0) {
    ctx.fillStyle = "#888";
    ctx.font = "16px monospace";
    ctx.fillText("タスクを追加してください", 40, 80);
    return;
  }

  const x0 = LEFT_MARGIN + PADDING;
  const y0 = TOP_MARGIN + HEADER_H;

  // 時間軸ヘッダ
  ctx.fillStyle = "#aaa";
  ctx.font = "12px monospace";
  for (let t = 0; t < totalSteps; t++) {
    const x = x0 + t * CELL_W;
    ctx.fillText(String(t), x + CELL_W / 2 - 4, y0 - 8);
  }

  // タスク行
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task) continue;
    const y = y0 + i * CELL_H;

    // タスク名ラベル
    ctx.fillStyle = task.color;
    ctx.font = "bold 13px monospace";
    ctx.fillText(task.name, PADDING, y + CELL_H / 2 + 4);

    // 各ステップのセルを描画
    for (let t = 0; t < totalSteps; t++) {
      const step = steps[t];
      if (!step) continue;
      const x = x0 + t * CELL_W;

      if (step.taskId === task.id) {
        // 実行中
        ctx.fillStyle = task.color;
        ctx.globalAlpha = t <= currentStep ? 1.0 : 0.15;
        ctx.fillRect(x + 1, y + 2, CELL_W - 2, CELL_H - 4);
        ctx.globalAlpha = 1.0;

        // 残り時間テキスト
        ctx.fillStyle = "#000";
        ctx.font = "11px monospace";
        const rem = step.remaining.get(task.id) ?? 0;
        ctx.fillText(String(rem), x + CELL_W / 2 - 4, y + CELL_H / 2 + 4);
      } else if (step.queue.includes(task.id)) {
        // 待機中
        ctx.fillStyle = task.color;
        ctx.globalAlpha = t <= currentStep ? 0.3 : 0.08;
        ctx.fillRect(x + 1, y + 2, CELL_W - 2, CELL_H - 4);
        ctx.globalAlpha = 1.0;
      }

      // セル枠
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 1, y + 2, CELL_W - 2, CELL_H - 4);
    }
  }

  // 現在ステップのインジケータ
  if (currentStep >= 0 && currentStep < totalSteps) {
    const x = x0 + currentStep * CELL_W;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y0 - 2, CELL_W, CELL_H * tasks.length + 4);
  }

  // 凡例
  const legendY = y0 + CELL_H * tasks.length + 24;
  ctx.fillStyle = "#888";
  ctx.font = "12px monospace";
  ctx.fillText("■ 実行中   ■ 待機中   □ アイドル   数字=残り時間", PADDING, legendY);
}
