// タスクの定義
export interface Task {
        id: number;
        name: string;
        burstTime: number; // 実行に必要な総時間
        priority: number; // 優先度（小さいほど高い）
        arrivalTime: number; // 到着時刻
        color: string;
}

// 実行ログの1ステップ
export interface ScheduleStep {
        time: number;
        taskId: number | null; // null = アイドル
        remaining: Map<number, number>; // 各タスクの残り時間
        queue: number[]; // 待ちキューのタスクID
}

export type Algorithm = "fcfs" | "sjf" | "priority" | "roundRobin";

export interface SchedulerConfig {
        algorithm: Algorithm;
        timeQuantum: number; // ラウンドロビン用
        tasks: Task[];
}

// スケジューリングをシミュレートし、全ステップのログを返す
export function simulate(config: SchedulerConfig): ScheduleStep[] {
        const { algorithm, timeQuantum, tasks } = config;

        if (tasks.length === 0) return [];

        const remaining = new Map<number, number>();
        for (const t of tasks) {
                remaining.set(t.id, t.burstTime);
        }

        const maxTime = tasks.reduce((sum, t) => sum + t.burstTime, 0) + Math.max(...tasks.map((t) => t.arrivalTime));
        const steps: ScheduleStep[] = [];

        let currentTaskId: number | null = null;
        // ラウンドロビンでローテーション先を決めるために、直前に実行していたタスクを記憶する
        let lastRanTaskId: number | null = null;
        let quantumLeft = timeQuantum;

        for (let time = 0; time < maxTime; time++) {
                // この時刻までに到着した未完了タスク
                const ready = tasks
                        .filter((t) => t.arrivalTime <= time && (remaining.get(t.id) ?? 0) > 0)
                        .map((t) => t.id);

                if (ready.length === 0) {
                        // 全タスク完了ならループ終了
                        const allDone = tasks.every((t) => (remaining.get(t.id) ?? 0) === 0);
                        if (allDone) break;

                        steps.push({
                                time,
                                taskId: null,
                                remaining: new Map(remaining),
                                queue: [],
                        });
                        continue;
                }

                const nextId = pickTask(algorithm, ready, remaining, tasks, currentTaskId, lastRanTaskId, quantumLeft);

                // タスクが切り替わったらクォンタムリセット
                if (nextId !== currentTaskId) {
                        quantumLeft = timeQuantum;
                }

                currentTaskId = nextId;
                lastRanTaskId = nextId;

                const queue = ready.filter((id) => id !== currentTaskId);

                steps.push({
                        time,
                        taskId: currentTaskId,
                        remaining: new Map(remaining),
                        queue,
                });

                // 1単位時間実行
                const prev = remaining.get(currentTaskId) ?? 0;
                remaining.set(currentTaskId, prev - 1);
                quantumLeft--;

                // タスク完了でリセット
                if ((remaining.get(currentTaskId) ?? 0) <= 0) {
                        currentTaskId = null;
                        quantumLeft = timeQuantum;
                }
                // クォンタム消費でリセット（タスク完了と別で判定）
                else if (algorithm === "roundRobin" && quantumLeft <= 0) {
                        currentTaskId = null;
                        quantumLeft = timeQuantum;
                }
        }

        return steps;
}

// アルゴリズムに応じて次に実行するタスクを選ぶ
function pickTask(
        algorithm: Algorithm,
        ready: number[],
        remaining: Map<number, number>,
        tasks: Task[],
        currentTaskId: number | null,
        lastRanTaskId: number | null,
        quantumLeft: number
): number {
        const taskMap = new Map(tasks.map((t) => [t.id, t]));

        switch (algorithm) {
                case "fcfs": {
                        // 到着順（同着ならID順）
                        const sorted = [...ready].sort((a, b) => {
                                const ta = taskMap.get(a);
                                const tb = taskMap.get(b);
                                if (!ta || !tb) return 0;
                                return ta.arrivalTime - tb.arrivalTime || ta.id - tb.id;
                        });
                        // 非プリエンプティブ: 現在実行中のタスクがまだ残っていれば続行
                        if (currentTaskId !== null && ready.includes(currentTaskId) && (remaining.get(currentTaskId) ?? 0) > 0) {
                                return currentTaskId;
                        }
                        return sorted[0] ?? ready[0] ?? -1;
                }

                case "sjf": {
                        // 残り時間が最短のタスク（プリエンプティブ = SRTF）
                        const sorted = [...ready].sort((a, b) => {
                                return (remaining.get(a) ?? 0) - (remaining.get(b) ?? 0) || a - b;
                        });
                        return sorted[0] ?? ready[0] ?? -1;
                }

                case "priority": {
                        // 優先度が高い（数値が小さい）タスク（プリエンプティブ）
                        const sorted = [...ready].sort((a, b) => {
                                const ta = taskMap.get(a);
                                const tb = taskMap.get(b);
                                if (!ta || !tb) return 0;
                                return ta.priority - tb.priority || ta.arrivalTime - tb.arrivalTime || ta.id - tb.id;
                        });
                        return sorted[0] ?? ready[0] ?? -1;
                }

                case "roundRobin": {
                        // 現在のタスクがまだクォンタム残っていれば続行
                        if (currentTaskId !== null && ready.includes(currentTaskId) && quantumLeft > 0 && (remaining.get(currentTaskId) ?? 0) > 0) {
                                return currentTaskId;
                        }
                        // 到着順でソート
                        const sorted = [...ready].sort((a, b) => {
                                const ta = taskMap.get(a);
                                const tb = taskMap.get(b);
                                if (!ta || !tb) return 0;
                                return ta.arrivalTime - tb.arrivalTime || ta.id - tb.id;
                        });
                        // 直前に実行していたタスクの次からローテーション
                        if (lastRanTaskId !== null) {
                                const idx = sorted.indexOf(lastRanTaskId);
                                if (idx !== -1) {
                                        // lastRanTaskId の次から順に探す
                                        for (let i = 1; i <= sorted.length; i++) {
                                                const candidate = sorted[(idx + i) % sorted.length];
                                                if (candidate !== undefined && (remaining.get(candidate) ?? 0) > 0) {
                                                        return candidate;
                                                }
                                        }
                                }
                        }
                        return sorted[0] ?? ready[0] ?? -1;
                }
        }
}
