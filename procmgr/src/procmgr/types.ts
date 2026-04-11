/** プロセス状態 */
export type ProcState = "running" | "sleeping" | "disk_sleep" | "stopped" | "zombie" | "dead";

/** プロセスエントリ (タスク構造体) */
export interface Process {
  pid: number;
  ppid: number;
  pgid: number;           // プロセスグループID
  sid: number;            // セッションID
  uid: number;
  gid: number;
  name: string;
  state: ProcState;
  exitCode?: number;
  tty?: string;           // 制御端末 ("/dev/pts/0" など)
  isSessionLeader: boolean;
  isGroupLeader: boolean;
  isDaemon: boolean;
  nice: number;           // -20 ~ 19
  startTime: number;
  children: number[];     // 子プロセスPID一覧
  threads: number;        // スレッド数
  vmSize: number;         // 仮想メモリサイズ (KB)
  vmRss: number;          // 物理メモリ使用量 (KB)
  fdCount: number;        // オープンfdの数
  cgroup?: string;        // cgroup パス
  namespace?: string;     // 名前空間情報
  waitedBy?: number;      // waitpid()で待っているプロセスのPID
}

/** プロセスグループ */
export interface ProcessGroup {
  pgid: number;
  leaderPid: number;
  members: number[];      // メンバーPID
  sessionId: number;
  isForeground: boolean;  // フォアグラウンドプロセスグループか
}

/** セッション */
export interface Session {
  sid: number;
  leaderPid: number;
  groups: number[];       // 所属プロセスグループID
  controllingTty?: string;
  foregroundPgid?: number;
}

/** waitpid のオプション */
export type WaitOption = "0" | "WNOHANG" | "WUNTRACED" | "WCONTINUED";

/** waitpid の結果 */
export interface WaitResult {
  pid: number;
  status: "exited" | "signaled" | "stopped" | "continued";
  exitCode?: number;
  signal?: string;
}

/** cgroup 設定 */
export interface Cgroup {
  path: string;
  cpuLimit?: number;      // CPU使用率上限 (%)
  memoryLimit?: number;   // メモリ上限 (KB)
  pidsMax?: number;       // PID数上限
  members: number[];
}

/** 名前空間 */
export interface Namespace {
  type: "pid" | "mnt" | "net" | "uts" | "ipc" | "user";
  id: number;
  members: number[];
}

/** シミュレーション操作 */
export type SimOp =
  // プロセス生成/終了
  | { type: "fork"; parentPid: number; childPid: number; childName: string }
  | { type: "exec"; pid: number; newName: string; newPath: string }
  | { type: "exit"; pid: number; code: number }
  | { type: "kill"; targetPid: number; signal: string; senderPid: number }

  // wait系
  | { type: "waitpid"; waiterPid: number; targetPid: number; options: WaitOption }
  | { type: "reap_zombie"; pid: number }
  | { type: "orphan_adopt"; orphanPid: number; newParentPid: number }

  // プロセスグループ
  | { type: "setpgid"; pid: number; pgid: number }
  | { type: "create_group"; pgid: number; leaderPid: number }
  | { type: "set_foreground"; pgid: number; tty: string }

  // セッション
  | { type: "setsid"; pid: number }
  | { type: "set_ctty"; pid: number; tty: string }
  | { type: "disconnect_tty"; sid: number }

  // ジョブ制御
  | { type: "job_bg"; pgid: number }
  | { type: "job_fg"; pgid: number; tty: string }
  | { type: "job_stop"; pgid: number; signal: string }
  | { type: "job_resume"; pgid: number; signal: string }

  // デーモン化
  | { type: "daemonize"; pid: number; steps: string[] }

  // cgroup
  | { type: "cgroup_create"; path: string; cpuLimit?: number; memoryLimit?: number; pidsMax?: number }
  | { type: "cgroup_attach"; path: string; pid: number }
  | { type: "cgroup_limit_hit"; path: string; resource: string; pid: number }

  // 名前空間
  | { type: "unshare"; pid: number; nsType: "pid" | "mnt" | "net" | "uts" }
  | { type: "ns_exec"; pid: number; nsType: string; targetPid: number }

  // プロセステーブル操作
  | { type: "init_system" }
  | { type: "ps_snapshot" };

/** イベント種別 */
export type EventType =
  | "fork" | "exec" | "exit" | "kill"
  | "waitpid" | "zombie" | "reap" | "orphan"
  | "pgid" | "session" | "tty"
  | "job_control"
  | "daemon"
  | "cgroup" | "namespace"
  | "process_table"
  | "info" | "error";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  processes: Process[];
  groups: ProcessGroup[];
  sessions: Session[];
  cgroups: Cgroup[];
  namespaces: Namespace[];
  stats: {
    totalSteps: number;
    forked: number;
    exited: number;
    zombies: number;
    reaped: number;
    orphansAdopted: number;
    signalsSent: number;
    sessionsCreated: number;
    groupsCreated: number;
    daemonized: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
