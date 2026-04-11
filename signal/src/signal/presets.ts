import type { Preset } from "./types.js";

export const presets: Preset[] = [
  // 1. 基本的なkill
  {
    name: "1. kill — 基本的なシグナル送信",
    description: "kill()でプロセスにシグナルを送信。SIGTERM(15)はデフォルトでプロセス終了、SIGKILL(9)はハンドラ・ブロック不可の強制終了。",
    ops: [
      { type: "process_create", process: { pid: 1, ppid: 0, name: "init", state: "running", uid: 0 } },
      { type: "process_create", process: { pid: 100, ppid: 1, name: "server", state: "running", uid: 1000 } },
      { type: "process_create", process: { pid: 200, ppid: 1, name: "worker", state: "running", uid: 1000 } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
      { type: "kill", senderPid: 1, targetPid: 200, signal: 9 },
    ],
  },

  // 2. シグナルハンドラ
  {
    name: "2. sigaction — カスタムハンドラ設定",
    description: "sigaction()でSIGINT/SIGTERMにカスタムハンドラを設定。ハンドラが呼ばれるとプロセスは終了せず処理を続行。SIGKILL(9)はハンドラ設定不可。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "app", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "custom", description: "graceful_shutdown" } },
      { type: "sigaction", pid: 100, handler: { signal: 15, type: "custom", description: "cleanup_and_exit" } },
      { type: "sigaction", pid: 100, handler: { signal: 9, type: "custom", description: "impossible" } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 2 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 9 },
    ],
  },

  // 3. シグナルマスク（ブロック）
  {
    name: "3. sigprocmask — シグナルのブロックとペンディング",
    description: "sigprocmask(SIG_BLOCK)でシグナルをマスク。ブロック中のシグナルはペンディングキューに溜まり、アンブロック時に配送。標準シグナルは重複マージ。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "app", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 10, type: "custom", description: "handle_usr1" } },
      { type: "sigmask_block", pid: 100, signals: [10, 12] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 12 },
      { type: "sigpending", pid: 100 },
      { type: "sigmask_unblock", pid: 100, signals: [10, 12] },
    ],
  },

  // 4. リアルタイムシグナル
  {
    name: "4. リアルタイムシグナル — キューイングと順序保証",
    description: "SIGRTMIN(34)以降のリアルタイムシグナルは、標準シグナルと異なりキューイングされる（重複も全て保持）。番号順に配送。sigqueueでデータも付加可能。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "rt_app", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 34, type: "custom", description: "rt_handler", siginfo: true } },
      { type: "sigaction", pid: 100, handler: { signal: 35, type: "custom", description: "rt_handler2", siginfo: true } },
      { type: "sigmask_block", pid: 100, signals: [34, 35] },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 34, value: 100 },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 34, value: 200 },
      { type: "sigqueue", senderPid: 1, targetPid: 100, signal: 35, value: 300 },
      { type: "sigpending", pid: 100 },
      { type: "sigmask_unblock", pid: 100, signals: [34, 35] },
    ],
  },

  // 5. SIGSTOP / SIGCONT
  {
    name: "5. SIGSTOP / SIGCONT — プロセスの停止と再開",
    description: "SIGSTOP(19)でプロセスを強制停止、SIGCONT(18)で再開。SIGSTOPはブロック・ハンドラ設定不可。SIGTSTP(20)はCtrl+Zに相当し、ハンドラ設定可能。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "app", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 19, type: "custom", description: "impossible" } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 19 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 18 },
      { type: "sigaction", pid: 100, handler: { signal: 20, type: "custom", description: "handle_tstp" } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 20 },
    ],
  },

  // 6. SIG_IGN — シグナル無視
  {
    name: "6. SIG_IGN — シグナルの無視設定",
    description: "sigaction()でSIG_IGNを設定するとシグナルが無視される。SIGCHLDをSIG_IGNにすると子プロセスがゾンビにならない。SIGKILL/SIGSTOPは無視設定不可。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "daemon", state: "running", uid: 0 } },
      { type: "sigaction", pid: 100, handler: { signal: 1, type: "ignore" } },
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "ignore" } },
      { type: "sigaction", pid: 100, handler: { signal: 15, type: "ignore" } },
      { type: "sigaction", pid: 100, handler: { signal: 17, type: "ignore", nocldstop: true } },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 1 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 2 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 9 },
    ],
  },

  // 7. raise / alarm
  {
    name: "7. raise / alarm — 自己シグナルとタイマー",
    description: "raise()で自分自身にシグナル送信。alarm()でSIGALRMタイマー設定。abort()はSIGABRT(6)をraise、タイムアウト処理にalarm+SIGALRMハンドラ。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "timer_app", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 14, type: "custom", description: "timeout_handler", restart: true } },
      { type: "alarm", pid: 100, seconds: 30 },
      { type: "raise", pid: 100, signal: 6 },
    ],
  },

  // 8. fork — ハンドラ・マスク継承
  {
    name: "8. fork — シグナルハンドラとマスクの継承",
    description: "fork()で子プロセスはハンドラテーブルとシグナルマスクを親から継承。ペンディングシグナルはクリア。exec()ではカスタムハンドラがSIG_DFLにリセット。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "parent", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "custom", description: "parent_sigint" } },
      { type: "sigaction", pid: 100, handler: { signal: 15, type: "ignore" } },
      { type: "sigmask_block", pid: 100, signals: [10] },
      { type: "fork", parentPid: 100, childPid: 101, childName: "child" },
      { type: "kill", senderPid: 1, targetPid: 101, signal: 2 },
      { type: "kill", senderPid: 1, targetPid: 101, signal: 15 },
      { type: "kill", senderPid: 1, targetPid: 101, signal: 10 },
      { type: "sigpending", pid: 101 },
    ],
  },

  // 9. 権限チェック
  {
    name: "9. 権限チェック — uid/rootによるシグナル送信制限",
    description: "一般ユーザーは自分のプロセスにのみシグナル送信可能。root(uid=0)は全プロセスに送信可能。異なるuidへの送信はEPERMエラー。",
    ops: [
      { type: "process_create", process: { pid: 1, ppid: 0, name: "init", state: "running", uid: 0 } },
      { type: "process_create", process: { pid: 100, ppid: 1, name: "alice_app", state: "running", uid: 1000 } },
      { type: "process_create", process: { pid: 200, ppid: 1, name: "bob_app", state: "running", uid: 1001 } },
      // root → 誰にでも送信可能
      { type: "kill", senderPid: 1, targetPid: 100, signal: 15 },
      // alice → bob: EPERM
      { type: "process_create", process: { pid: 101, ppid: 100, name: "alice_kill", state: "running", uid: 1000 } },
      { type: "kill", senderPid: 101, targetPid: 200, signal: 15 },
      // alice → alice自身: OK
      { type: "process_create", process: { pid: 102, ppid: 100, name: "alice_app2", state: "running", uid: 1000 } },
      { type: "kill", senderPid: 101, targetPid: 102, signal: 15 },
    ],
  },

  // 10. sigsuspend — アトミックなマスク変更+待機
  {
    name: "10. sigsuspend — アトミックなマスク変更と待機",
    description: "sigsuspend()はシグナルマスクを一時的に変更してpause()。クリティカルセクション後にブロックしていたシグナルをアトミックに受信。レース条件を回避。",
    ops: [
      { type: "process_create", process: { pid: 100, ppid: 1, name: "critical_app", state: "running", uid: 1000 } },
      { type: "sigaction", pid: 100, handler: { signal: 2, type: "custom", description: "handle_sigint" } },
      { type: "sigaction", pid: 100, handler: { signal: 10, type: "custom", description: "handle_usr1" } },
      // クリティカルセクション開始: SIGINT/SIGUSR1をブロック
      { type: "sigmask_block", pid: 100, signals: [2, 10] },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 2 },
      { type: "kill", senderPid: 1, targetPid: 100, signal: 10 },
      { type: "sigpending", pid: 100 },
      // sigsuspend: 一時的にマスクを空にして待機 → ペンディングが配送される
      { type: "sigsuspend", pid: 100, tempMask: [] },
    ],
  },
];
