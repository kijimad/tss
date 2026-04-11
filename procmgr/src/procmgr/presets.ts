import type { Preset } from "./types.js";

export const presets: Preset[] = [
  {
    name: "基本: fork → exec → exit → wait",
    description: "プロセスのライフサイクル — 生成、プログラム実行、終了、回収",
    ops: [
      { type: "init_system" },
      // shell (bash) の起動
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "exec", pid: 100, newName: "bash", newPath: "/bin/bash" },
      { type: "set_ctty", pid: 100, tty: "/dev/pts/0" },
      // コマンド実行: ls
      { type: "fork", parentPid: 100, childPid: 101, childName: "bash" },
      { type: "exec", pid: 101, newName: "ls", newPath: "/bin/ls" },
      { type: "set_foreground", pgid: 101, tty: "/dev/pts/0" },
      // ls の実行と終了
      { type: "exit", pid: 101, code: 0 },
      { type: "waitpid", waiterPid: 100, targetPid: 101, options: "0" },
      { type: "ps_snapshot" },
    ],
  },
  {
    name: "zombie プロセスの発生と回収",
    description: "親がwait()しないと子はzombie化する。initによる孤児回収。",
    ops: [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "parent" },
      // 子プロセスを3つfork
      { type: "fork", parentPid: 100, childPid: 201, childName: "child1" },
      { type: "fork", parentPid: 100, childPid: 202, childName: "child2" },
      { type: "fork", parentPid: 100, childPid: 203, childName: "child3" },
      // 子が先に終了 → zombie
      { type: "exit", pid: 201, code: 0 },
      { type: "exit", pid: 202, code: 1 },
      { type: "ps_snapshot" },
      // 親がwaitpidで回収
      { type: "waitpid", waiterPid: 100, targetPid: -1, options: "0" },
      { type: "waitpid", waiterPid: 100, targetPid: -1, options: "0" },
      // child3 はまだ実行中
      { type: "ps_snapshot" },
      // 親が終了 → child3 は孤児 → init に養子縁組
      { type: "exit", pid: 100, code: 0 },
      { type: "reap_zombie", pid: 100 },
      // child3 終了 → init がreap
      { type: "exit", pid: 203, code: 0 },
      { type: "reap_zombie", pid: 203 },
      { type: "ps_snapshot" },
    ],
  },
  {
    name: "プロセスグループとパイプライン",
    description: "ls | grep | wc のパイプラインがプロセスグループを形成",
    ops: [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "set_ctty", pid: 100, tty: "/dev/pts/0" },
      // パイプライン: ls | grep foo | wc -l
      { type: "fork", parentPid: 100, childPid: 301, childName: "ls" },
      { type: "fork", parentPid: 100, childPid: 302, childName: "grep" },
      { type: "fork", parentPid: 100, childPid: 303, childName: "wc" },
      // 全て同じプロセスグループに設定 (PGID=301)
      { type: "create_group", pgid: 301, leaderPid: 301 },
      { type: "setpgid", pid: 302, pgid: 301 },
      { type: "setpgid", pid: 303, pgid: 301 },
      // フォアグラウンドに設定
      { type: "set_foreground", pgid: 301, tty: "/dev/pts/0" },
      { type: "ps_snapshot" },
      // パイプライン完了
      { type: "exit", pid: 301, code: 0 },
      { type: "exit", pid: 302, code: 0 },
      { type: "exit", pid: 303, code: 0 },
      { type: "waitpid", waiterPid: 100, targetPid: 301, options: "0" },
      { type: "waitpid", waiterPid: 100, targetPid: 302, options: "0" },
      { type: "waitpid", waiterPid: 100, targetPid: 303, options: "0" },
      // bash がフォアグラウンドに戻る
      { type: "set_foreground", pgid: 100, tty: "/dev/pts/0" },
    ],
  },
  {
    name: "ジョブ制御 (Ctrl+Z, bg, fg)",
    description: "フォアグラウンドジョブの停止 (SIGTSTP)、バックグラウンド移行、復帰",
    ops: [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "set_ctty", pid: 100, tty: "/dev/pts/0" },
      // vim 起動
      { type: "fork", parentPid: 100, childPid: 401, childName: "vim" },
      { type: "create_group", pgid: 401, leaderPid: 401 },
      { type: "set_foreground", pgid: 401, tty: "/dev/pts/0" },
      // Ctrl+Z → SIGTSTP
      { type: "job_stop", pgid: 401, signal: "SIGTSTP" },
      // bash がフォアグラウンドに戻る
      { type: "set_foreground", pgid: 100, tty: "/dev/pts/0" },
      // sleep をバックグラウンドで起動
      { type: "fork", parentPid: 100, childPid: 402, childName: "sleep" },
      { type: "create_group", pgid: 402, leaderPid: 402 },
      { type: "job_bg", pgid: 402 },
      { type: "ps_snapshot" },
      // fg で vim を復帰
      { type: "job_fg", pgid: 401, tty: "/dev/pts/0" },
      { type: "job_resume", pgid: 401, signal: "SIGCONT" },
      // vim 終了
      { type: "exit", pid: 401, code: 0 },
      { type: "waitpid", waiterPid: 100, targetPid: 401, options: "0" },
      { type: "set_foreground", pgid: 100, tty: "/dev/pts/0" },
    ],
  },
  {
    name: "セッションと制御端末",
    description: "セッション、プロセスグループ、制御端末の階層構造",
    ops: [
      { type: "init_system" },
      // login → bash
      { type: "fork", parentPid: 1, childPid: 500, childName: "login" },
      { type: "setsid", pid: 500 },
      { type: "set_ctty", pid: 500, tty: "/dev/pts/0" },
      { type: "exec", pid: 500, newName: "bash", newPath: "/bin/bash" },
      // 別の端末
      { type: "fork", parentPid: 1, childPid: 600, childName: "login" },
      { type: "setsid", pid: 600 },
      { type: "set_ctty", pid: 600, tty: "/dev/pts/1" },
      { type: "exec", pid: 600, newName: "bash", newPath: "/bin/bash" },
      // pts/0 でコマンド実行
      { type: "fork", parentPid: 500, childPid: 501, childName: "top" },
      { type: "set_foreground", pgid: 501, tty: "/dev/pts/0" },
      // pts/1 でコマンド実行
      { type: "fork", parentPid: 600, childPid: 601, childName: "htop" },
      { type: "set_foreground", pgid: 601, tty: "/dev/pts/1" },
      { type: "ps_snapshot" },
      // 端末切断 → SIGHUP
      { type: "disconnect_tty", sid: 500 },
    ],
  },
  {
    name: "デーモン化の手順",
    description: "二重fork + setsid + 端末切り離し + fd閉じ — 標準デーモン化手順",
    ops: [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "set_ctty", pid: 100, tty: "/dev/pts/0" },
      // sshd を起動 (デーモン化)
      { type: "fork", parentPid: 100, childPid: 700, childName: "sshd" },
      { type: "daemonize", pid: 700, steps: [
        "fork() — 第1子を生成、親は exit() で終了",
        "setsid() — 新セッション作成、制御端末を切り離し",
        "fork() — 第2子を生成 (セッションリーダーでなくする)、第1子は exit()",
        "chdir(\"/\") — カレントディレクトリをルートに",
        "umask(0) — ファイル作成マスクをクリア",
        "close(0,1,2) — stdin/stdout/stderr を閉じる",
        "open(\"/dev/null\") — fd 0,1,2 を /dev/null にリダイレクト",
        "pidfile 書き出し: /var/run/sshd.pid",
      ]},
      // 二重fork の表現
      { type: "fork", parentPid: 700, childPid: 701, childName: "sshd" },
      { type: "exit", pid: 700, code: 0 },
      { type: "setsid", pid: 701 },
      { type: "fork", parentPid: 701, childPid: 702, childName: "sshd" },
      { type: "exit", pid: 701, code: 0 },
      { type: "reap_zombie", pid: 700 },
      { type: "reap_zombie", pid: 701 },
      { type: "ps_snapshot" },
    ],
  },
  {
    name: "cgroup — リソース制限",
    description: "cgroupによるCPU, メモリ, PID数の制限とOOM Killer",
    ops: [
      { type: "init_system" },
      // cgroup 作成
      { type: "cgroup_create", path: "app/web", cpuLimit: 50, memoryLimit: 524288, pidsMax: 100 },
      { type: "cgroup_create", path: "app/worker", cpuLimit: 80, memoryLimit: 1048576 },
      // プロセスをcgroupに配置
      { type: "fork", parentPid: 1, childPid: 800, childName: "nginx" },
      { type: "cgroup_attach", path: "app/web", pid: 800 },
      { type: "fork", parentPid: 800, childPid: 801, childName: "nginx-worker" },
      { type: "cgroup_attach", path: "app/web", pid: 801 },
      { type: "fork", parentPid: 1, childPid: 810, childName: "celery" },
      { type: "cgroup_attach", path: "app/worker", pid: 810 },
      { type: "ps_snapshot" },
      // メモリ制限ヒット → OOM
      { type: "cgroup_limit_hit", path: "app/web", resource: "memory", pid: 801 },
      // PID制限ヒット → fork失敗
      { type: "cgroup_limit_hit", path: "app/web", resource: "pids", pid: 800 },
    ],
  },
  {
    name: "名前空間 (コンテナの基礎)",
    description: "unshare/nsenterによるPID, NET, MNT名前空間の分離",
    ops: [
      { type: "init_system" },
      // コンテナランタイム
      { type: "fork", parentPid: 1, childPid: 900, childName: "containerd" },
      // PID名前空間の作成
      { type: "unshare", pid: 900, nsType: "pid" },
      // NET名前空間
      { type: "unshare", pid: 900, nsType: "net" },
      // MNT名前空間
      { type: "unshare", pid: 900, nsType: "mnt" },
      // コンテナ内プロセス (名前空間内PID 1)
      { type: "fork", parentPid: 900, childPid: 901, childName: "container-init" },
      { type: "fork", parentPid: 901, childPid: 902, childName: "app" },
      // 別コンテナ
      { type: "fork", parentPid: 1, childPid: 910, childName: "containerd" },
      { type: "unshare", pid: 910, nsType: "pid" },
      { type: "unshare", pid: 910, nsType: "net" },
      { type: "fork", parentPid: 910, childPid: 911, childName: "container-init" },
      { type: "ps_snapshot" },
      // nsenter で名前空間に参加
      { type: "ns_exec", pid: 1, nsType: "pid", targetPid: 900 },
    ],
  },
  {
    name: "シグナルによるプロセス制御",
    description: "SIGTERM, SIGKILL, SIGSTOP, SIGCONT によるプロセス制御",
    ops: [
      { type: "init_system" },
      { type: "fork", parentPid: 1, childPid: 100, childName: "bash" },
      { type: "fork", parentPid: 100, childPid: 1001, childName: "server" },
      { type: "fork", parentPid: 100, childPid: 1002, childName: "worker" },
      { type: "fork", parentPid: 100, childPid: 1003, childName: "logger" },
      // 正常終了要求
      { type: "kill", targetPid: 1001, signal: "SIGTERM", senderPid: 100 },
      // 停止
      { type: "kill", targetPid: 1002, signal: "SIGSTOP", senderPid: 100 },
      { type: "ps_snapshot" },
      // 再開
      { type: "kill", targetPid: 1002, signal: "SIGCONT", senderPid: 100 },
      // 強制終了
      { type: "kill", targetPid: 1003, signal: "SIGKILL", senderPid: 100 },
      { type: "waitpid", waiterPid: 100, targetPid: 1003, options: "0" },
      { type: "ps_snapshot" },
    ],
  },
  {
    name: "プロセスツリー (pstree)",
    description: "init → サービス群 → ユーザプロセスの典型的なプロセスツリー",
    ops: [
      { type: "init_system" },
      // システムサービス
      { type: "fork", parentPid: 1, childPid: 10, childName: "systemd-journal" },
      { type: "fork", parentPid: 1, childPid: 11, childName: "systemd-udevd" },
      { type: "fork", parentPid: 1, childPid: 12, childName: "sshd" },
      { type: "fork", parentPid: 1, childPid: 13, childName: "cron" },
      { type: "fork", parentPid: 1, childPid: 14, childName: "nginx" },
      // nginx ワーカー
      { type: "fork", parentPid: 14, childPid: 141, childName: "nginx-worker" },
      { type: "fork", parentPid: 14, childPid: 142, childName: "nginx-worker" },
      // SSH接続
      { type: "fork", parentPid: 12, childPid: 120, childName: "sshd" },
      { type: "setsid", pid: 120 },
      { type: "fork", parentPid: 120, childPid: 121, childName: "bash" },
      { type: "set_ctty", pid: 121, tty: "/dev/pts/0" },
      // ユーザコマンド
      { type: "fork", parentPid: 121, childPid: 1210, childName: "vim" },
      // 別のSSH接続
      { type: "fork", parentPid: 12, childPid: 130, childName: "sshd" },
      { type: "setsid", pid: 130 },
      { type: "fork", parentPid: 130, childPid: 131, childName: "bash" },
      { type: "set_ctty", pid: 131, tty: "/dev/pts/1" },
      { type: "fork", parentPid: 131, childPid: 1310, childName: "top" },
      { type: "ps_snapshot" },
    ],
  },
];
