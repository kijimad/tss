import type {
  Process, ProcessGroup, Session,
  Cgroup, Namespace, WaitResult,
  SimOp, SimEvent, EventType, SimulationResult,
} from "./types.js";

export function runSimulation(ops: SimOp[]): SimulationResult {
  const events: SimEvent[] = [];
  const processes: Process[] = [];
  const groups: ProcessGroup[] = [];
  const sessions: Session[] = [];
  const cgroups: Cgroup[] = [];
  const namespaces: Namespace[] = [];
  let step = 0;

  const stats = {
    totalSteps: 0, forked: 0, exited: 0, zombies: 0, reaped: 0,
    orphansAdopted: 0, signalsSent: 0, sessionsCreated: 0,
    groupsCreated: 0, daemonized: 0,
  };

  function emit(type: EventType, desc: string, detail?: string): void {
    events.push({ step, type, description: desc, detail });
    stats.totalSteps++;
  }

  function getProc(pid: number): Process | undefined {
    return processes.find((p) => p.pid === pid);
  }

  function getGroup(pgid: number): ProcessGroup | undefined {
    return groups.find((g) => g.pgid === pgid);
  }

  function getSession(sid: number): Session | undefined {
    return sessions.find((s) => s.sid === sid);
  }

  /** initプロセスの作成 */
  function createInit(): void {
    const init: Process = {
      pid: 1, ppid: 0, pgid: 1, sid: 1,
      uid: 0, gid: 0, name: "init", state: "running",
      isSessionLeader: true, isGroupLeader: true, isDaemon: true,
      nice: 0, startTime: 0, children: [], threads: 1,
      vmSize: 4096, vmRss: 1024, fdCount: 3,
    };
    processes.push(init);

    const initGroup: ProcessGroup = {
      pgid: 1, leaderPid: 1, members: [1], sessionId: 1, isForeground: false,
    };
    groups.push(initGroup);

    const initSession: Session = {
      sid: 1, leaderPid: 1, groups: [1],
    };
    sessions.push(initSession);
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "init_system": {
        createInit();
        emit("process_table",
          `システム初期化: PID 1 (init/systemd) を作成`,
          `init は全プロセスの祖先。孤児プロセスの養親。zombie の回収を担当。PID=1, PPID=0, SID=1, PGID=1`);

        // kthreadd
        const kthreadd: Process = {
          pid: 2, ppid: 0, pgid: 0, sid: 0,
          uid: 0, gid: 0, name: "kthreadd", state: "sleeping",
          isSessionLeader: false, isGroupLeader: false, isDaemon: true,
          nice: -20, startTime: 0, children: [], threads: 1,
          vmSize: 0, vmRss: 0, fdCount: 0,
        };
        processes.push(kthreadd);

        emit("process_table",
          `PID 2 (kthreadd) — カーネルスレッドの親`,
          `全カーネルスレッド ([ksoftirqd], [kworker], [migration] 等) の親プロセス`);
        break;
      }

      case "fork": {
        const parent = getProc(op.parentPid);
        if (!parent) break;

        const child: Process = {
          pid: op.childPid,
          ppid: op.parentPid,
          pgid: parent.pgid,
          sid: parent.sid,
          uid: parent.uid,
          gid: parent.gid,
          name: op.childName,
          state: "running",
          isSessionLeader: false,
          isGroupLeader: false,
          isDaemon: false,
          nice: parent.nice,
          startTime: step,
          children: [],
          threads: 1,
          vmSize: parent.vmSize,
          vmRss: parent.vmRss,
          fdCount: parent.fdCount,
          tty: parent.tty,
          cgroup: parent.cgroup,
          namespace: parent.namespace,
        };
        processes.push(child);
        parent.children.push(op.childPid);
        stats.forked++;

        // プロセスグループに追加
        const group = getGroup(child.pgid);
        if (group) {
          group.members.push(op.childPid);
        }

        emit("fork",
          `fork(): PID ${op.parentPid} (${parent.name}) → PID ${op.childPid} (${op.childName})`,
          `子プロセス継承: PPID=${op.parentPid}, PGID=${parent.pgid}, SID=${parent.sid}, TTY=${parent.tty ?? "none"}, UID=${parent.uid}。PIDとPPIDのみ異なる。fdテーブル、シグナルハンドラ、メモリマッピング (CoW) を複製。`);
        break;
      }

      case "exec": {
        const proc = getProc(op.pid);
        if (!proc) break;

        const oldName = proc.name;
        proc.name = op.newName;

        emit("exec",
          `execve(): PID ${op.pid} "${oldName}" → "${op.newName}" (${op.newPath})`,
          `プロセスイメージを置換。PID, PPID, PGID, SID, fd (FD_CLOEXEC以外) は保持。テキスト/データ/スタックセグメントを新しいプログラムで置き換え。シグナルハンドラはデフォルトにリセット。`);
        break;
      }

      case "exit": {
        const proc = getProc(op.pid);
        if (!proc) break;

        proc.exitCode = op.code;

        // 親がwait中かチェック
        const parent = getProc(proc.ppid);
        if (parent && parent.waitedBy !== undefined) {
          // 親が待っている → 即座にreap
          proc.state = "dead";
          stats.exited++;
          emit("exit",
            `exit(${op.code}): PID ${op.pid} (${proc.name}) — 即座にreap`,
            `親 PID ${proc.ppid} が waitpid() 中なので zombie にならずに終了。終了ステータスを親に通知。`);
        } else {
          // zombie状態に
          proc.state = "zombie";
          stats.exited++;
          stats.zombies++;
          emit("zombie",
            `PID ${op.pid} (${proc.name}) → zombie (defunct)`,
            `exit(${op.code}) 実行。プロセステーブルのエントリのみ残存 (task_struct)。メモリは解放済み。親が wait() するまで PID は再利用不可。/proc/${op.pid}/status: State=Z (zombie)`);
        }

        // SIGCHLDを親に通知
        if (parent && parent.state !== "dead" && parent.state !== "zombie") {
          emit("kill",
            `SIGCHLD → PID ${proc.ppid} (${parent.name})`,
            `子プロセス終了通知。親が SA_NOCLDWAIT 設定時は自動reap。`);
          stats.signalsSent++;
        }

        // 子プロセスの養子縁組
        const orphans = processes.filter((p) => p.ppid === op.pid && p.state !== "dead");
        if (orphans.length > 0) {
          for (const orphan of orphans) {
            orphan.ppid = 1;
            const init = getProc(1);
            if (init) init.children.push(orphan.pid);
            stats.orphansAdopted++;
          }
          emit("orphan",
            `孤児プロセス ${orphans.length}個を init (PID 1) に養子縁組`,
            `PID: ${orphans.map((o) => o.pid).join(", ")} — PPID を 1 に変更。init が wait() で zombie を回収する。`);
        }
        break;
      }

      case "kill": {
        const target = getProc(op.targetPid);
        if (!target) break;
        stats.signalsSent++;

        if (op.signal === "SIGKILL") {
          target.state = "dead";
          target.exitCode = 137;
          stats.exited++;
          emit("kill",
            `kill(${op.targetPid}, SIGKILL) from PID ${op.senderPid}`,
            `SIGKILL はキャッチ不可、ブロック不可。カーネルが即座にプロセスを終了。exit code = 128 + 9 = 137。`);
        } else if (op.signal === "SIGSTOP") {
          target.state = "stopped";
          emit("kill",
            `kill(${op.targetPid}, SIGSTOP) from PID ${op.senderPid}`,
            `SIGSTOP はキャッチ不可。プロセスを停止 (T状態)。SIGCONT で再開。`);
        } else if (op.signal === "SIGCONT") {
          if (target.state === "stopped") {
            target.state = "running";
          }
          emit("kill",
            `kill(${op.targetPid}, SIGCONT) from PID ${op.senderPid}`,
            `停止中のプロセスを再開。フォアグラウンドジョブでなければバックグラウンドで実行。`);
        } else if (op.signal === "SIGTERM") {
          emit("kill",
            `kill(${op.targetPid}, SIGTERM) from PID ${op.senderPid}`,
            `正常終了要求。プロセスがハンドラでクリーンアップ処理を実行可能。キャッチされない場合はデフォルトで終了。`);
        } else {
          emit("kill",
            `kill(${op.targetPid}, ${op.signal}) from PID ${op.senderPid}`,
            `シグナル配送: PID ${op.targetPid} (${target.name}) に ${op.signal} を送信`);
        }
        break;
      }

      case "waitpid": {
        const waiter = getProc(op.waiterPid);
        if (!waiter) break;

        const target = op.targetPid === -1
          ? processes.find((p) => p.ppid === op.waiterPid && p.state === "zombie")
          : getProc(op.targetPid);

        if (target && target.state === "zombie") {
          // zombie を回収
          target.state = "dead";
          stats.reaped++;
          stats.zombies = Math.max(0, stats.zombies - 1);

          const result: WaitResult = {
            pid: target.pid,
            status: "exited",
            exitCode: target.exitCode,
          };

          emit("reap",
            `waitpid(${op.targetPid}) → PID ${target.pid} 回収: exit code ${result.exitCode}`,
            `zombie のタスク構造体を解放。PID が再利用可能に。WIFEXITED=true, WEXITSTATUS=${result.exitCode}`);

          // 親のchildren から除去
          waiter.children = waiter.children.filter((c) => c !== target.pid);
        } else if (op.options === "WNOHANG") {
          emit("waitpid",
            `waitpid(${op.targetPid}, WNOHANG) → 0 (該当なし)`,
            `WNOHANG: 待機可能な子がなければ即座に 0 を返す。ブロックしない。`);
        } else {
          waiter.waitedBy = op.waiterPid;
          emit("waitpid",
            `waitpid(${op.targetPid}) — ブロック中`,
            `子プロセスの終了を待機。SIGCHLD受信まで sleep 状態。`);
        }
        break;
      }

      case "reap_zombie": {
        const proc = getProc(op.pid);
        if (proc && proc.state === "zombie") {
          proc.state = "dead";
          stats.reaped++;
          stats.zombies = Math.max(0, stats.zombies - 1);
          emit("reap",
            `zombie 回収: PID ${op.pid} (${proc.name})`,
            `init (PID 1) が wait() で zombie を回収。task_struct 解放、PID 再利用可能。`);
        }
        break;
      }

      case "orphan_adopt": {
        const orphan = getProc(op.orphanPid);
        if (orphan) {
          orphan.ppid = op.newParentPid;
          stats.orphansAdopted++;
          emit("orphan",
            `孤児プロセス PID ${op.orphanPid} → 新しい親 PID ${op.newParentPid}`,
            `親プロセス終了時、init (PID 1) または subreaper が養親になる。prctl(PR_SET_CHILD_SUBREAPER) で subreaper を指定可能。`);
        }
        break;
      }

      case "setpgid": {
        const proc = getProc(op.pid);
        if (!proc) break;
        const oldPgid = proc.pgid;
        proc.pgid = op.pgid;

        // 旧グループから除去
        const oldGroup = getGroup(oldPgid);
        if (oldGroup) {
          oldGroup.members = oldGroup.members.filter((m) => m !== op.pid);
        }

        // 新グループに追加
        let newGroup = getGroup(op.pgid);
        if (!newGroup) {
          newGroup = {
            pgid: op.pgid, leaderPid: op.pid, members: [op.pid],
            sessionId: proc.sid, isForeground: false,
          };
          groups.push(newGroup);
          proc.isGroupLeader = true;
          stats.groupsCreated++;
        } else {
          newGroup.members.push(op.pid);
        }

        emit("pgid",
          `setpgid(${op.pid}, ${op.pgid}): PGID ${oldPgid} → ${op.pgid}`,
          `プロセスグループ変更。同一セッション内でのみ移動可能。exec後は変更不可。`);
        break;
      }

      case "create_group": {
        const leader = getProc(op.leaderPid);
        if (!leader) break;

        const group: ProcessGroup = {
          pgid: op.pgid, leaderPid: op.leaderPid,
          members: [op.leaderPid], sessionId: leader.sid,
          isForeground: false,
        };
        groups.push(group);
        leader.pgid = op.pgid;
        leader.isGroupLeader = true;
        stats.groupsCreated++;

        emit("pgid",
          `新プロセスグループ PGID=${op.pgid} (リーダー: PID ${op.leaderPid} "${leader.name}")`,
          `パイプラインの各コマンドは同じプロセスグループに属する (例: ls | grep | wc)`);
        break;
      }

      case "set_foreground": {
        // 旧フォアグラウンドをバックグラウンドに
        for (const g of groups) {
          if (g.isForeground) g.isForeground = false;
        }
        const group = getGroup(op.pgid);
        if (group) {
          group.isForeground = true;
          const sess = getSession(group.sessionId);
          if (sess) sess.foregroundPgid = op.pgid;
        }

        emit("job_control",
          `フォアグラウンド設定: PGID=${op.pgid} on ${op.tty}`,
          `tcsetpgrp(ttyfd, ${op.pgid}) — 端末の入力/シグナル (Ctrl+C, Ctrl+Z) がこのグループに送られる`);
        break;
      }

      case "setsid": {
        const proc = getProc(op.pid);
        if (!proc) break;

        if (proc.isGroupLeader) {
          emit("error",
            `setsid() 失敗: PID ${op.pid} はグループリーダー`,
            `プロセスグループリーダーは setsid() を呼べない (EPERM)。fork() してから子で setsid() する。`);
          break;
        }

        const newSid = op.pid;
        proc.sid = newSid;
        proc.pgid = newSid;
        proc.isSessionLeader = true;
        proc.isGroupLeader = true;
        proc.tty = undefined; // 制御端末を切り離し

        const session: Session = {
          sid: newSid, leaderPid: op.pid,
          groups: [newSid],
        };
        sessions.push(session);
        stats.sessionsCreated++;

        const group: ProcessGroup = {
          pgid: newSid, leaderPid: op.pid,
          members: [op.pid], sessionId: newSid, isForeground: false,
        };
        groups.push(group);
        stats.groupsCreated++;

        emit("session",
          `setsid(): PID ${op.pid} (${proc.name}) — 新セッション SID=${newSid}`,
          `新しいセッション + プロセスグループを作成。制御端末なし。デーモン化の第一歩。`);
        break;
      }

      case "set_ctty": {
        const proc = getProc(op.pid);
        if (!proc) break;
        proc.tty = op.tty;
        const sess = getSession(proc.sid);
        if (sess) sess.controllingTty = op.tty;

        emit("tty",
          `制御端末設定: PID ${op.pid} → ${op.tty}`,
          `ioctl(fd, TIOCSCTTY, 0) でセッションリーダーが制御端末を獲得。端末のHUP (hangup) でSIGHUPが全セッションに配送。`);
        break;
      }

      case "disconnect_tty": {
        const sess = getSession(op.sid);
        if (!sess) break;
        sess.controllingTty = undefined;

        for (const proc of processes) {
          if (proc.sid === op.sid) {
            proc.tty = undefined;
          }
        }

        emit("tty",
          `制御端末切り離し: SID=${op.sid}`,
          `TIOCNOTTY または setsid() で切り離し。SIGHUP がセッションリーダーに送信される。`);
        break;
      }

      case "job_bg": {
        const group = getGroup(op.pgid);
        if (group) {
          group.isForeground = false;
          emit("job_control",
            `bg %${op.pgid} — バックグラウンドに移行`,
            `SIGCONT を送信してバックグラウンドで実行再開。端末入力を読むと SIGTTIN で停止。`);
        }
        break;
      }

      case "job_fg": {
        for (const g of groups) g.isForeground = false;
        const group = getGroup(op.pgid);
        if (group) {
          group.isForeground = true;
          const sess = getSession(group.sessionId);
          if (sess) sess.foregroundPgid = op.pgid;

          emit("job_control",
            `fg %${op.pgid} — フォアグラウンドに移行`,
            `tcsetpgrp(ttyfd, ${op.pgid}) で端末制御権を移譲。SIGCONT で再開。Ctrl+C/Z がこのグループに送られる。`);
        }
        break;
      }

      case "job_stop": {
        const group = getGroup(op.pgid);
        if (group) {
          for (const pid of group.members) {
            const proc = getProc(pid);
            if (proc && proc.state === "running") {
              proc.state = "stopped";
            }
          }
          emit("job_control",
            `ジョブ停止: PGID=${op.pgid} (${op.signal})`,
            `Ctrl+Z → SIGTSTP がフォアグラウンドプロセスグループに送信。全メンバーが T (stopped) 状態に。`);
        }
        break;
      }

      case "job_resume": {
        const group = getGroup(op.pgid);
        if (group) {
          for (const pid of group.members) {
            const proc = getProc(pid);
            if (proc && proc.state === "stopped") {
              proc.state = "running";
            }
          }
          emit("job_control",
            `ジョブ再開: PGID=${op.pgid} (${op.signal})`,
            `SIGCONT でプロセスグループ全体を再開。T → R/S 状態遷移。`);
        }
        break;
      }

      case "daemonize": {
        const proc = getProc(op.pid);
        if (!proc) break;
        proc.isDaemon = true;
        stats.daemonized++;

        emit("daemon",
          `デーモン化: PID ${op.pid} (${proc.name})`,
          `標準的なデーモン化手順:`);

        for (let i = 0; i < op.steps.length; i++) {
          emit("daemon", `  ${i + 1}. ${op.steps[i]!}`, undefined);
        }
        break;
      }

      case "cgroup_create": {
        const cg: Cgroup = {
          path: op.path,
          cpuLimit: op.cpuLimit,
          memoryLimit: op.memoryLimit,
          pidsMax: op.pidsMax,
          members: [],
        };
        cgroups.push(cg);

        const limits = [
          op.cpuLimit ? `CPU: ${op.cpuLimit}%` : null,
          op.memoryLimit ? `Memory: ${op.memoryLimit}KB` : null,
          op.pidsMax ? `PIDs: max ${op.pidsMax}` : null,
        ].filter(Boolean).join(", ");

        emit("cgroup",
          `cgroup作成: ${op.path}`,
          `リソース制限: ${limits || "(制限なし)"}。/sys/fs/cgroup/${op.path}/ にディレクトリ作成。`);
        break;
      }

      case "cgroup_attach": {
        const cg = cgroups.find((c) => c.path === op.path);
        if (cg) {
          cg.members.push(op.pid);
          const proc = getProc(op.pid);
          if (proc) proc.cgroup = op.path;

          emit("cgroup",
            `cgroup アタッチ: PID ${op.pid} → ${op.path}`,
            `echo ${op.pid} > /sys/fs/cgroup/${op.path}/cgroup.procs で移動。子プロセスも同じ cgroup に所属。`);
        }
        break;
      }

      case "cgroup_limit_hit": {
        emit("cgroup",
          `cgroup 制限ヒット: ${op.path} — ${op.resource} (PID ${op.pid})`,
          `${op.resource === "memory" ? "OOM Killer 発動。メモリ使用量が上限超過。" : op.resource === "pids" ? "fork() が EAGAIN で失敗。PID数上限到達。" : "CPU スロットリング発動。"}`);
        break;
      }

      case "unshare": {
        const proc = getProc(op.pid);
        if (!proc) break;

        const nsId = 1000 + namespaces.length;
        const ns: Namespace = {
          type: op.nsType, id: nsId, members: [op.pid],
        };
        namespaces.push(ns);
        proc.namespace = `${op.nsType}:[${nsId}]`;

        emit("namespace",
          `unshare(CLONE_NEW${op.nsType.toUpperCase()}): PID ${op.pid}`,
          `新しい${op.nsType}名前空間を作成。${op.nsType === "pid" ? "子プロセスのPIDは名前空間内で1から始まる。" : op.nsType === "net" ? "独立したネットワークスタック (lo, iptables等)。" : op.nsType === "mnt" ? "独立したマウントポイント。" : "独立したホスト名。"}`);
        break;
      }

      case "ns_exec": {
        const proc = getProc(op.pid);
        if (!proc) break;

        emit("namespace",
          `nsenter --${op.nsType} --target ${op.targetPid}: PID ${op.pid}`,
          `PID ${op.targetPid} の ${op.nsType} 名前空間に参加。setns() システムコール使用。`);
        break;
      }

      case "ps_snapshot": {
        const alive = processes.filter((p) => p.state !== "dead");
        emit("process_table",
          `プロセステーブル: ${alive.length}プロセス`,
          alive.map((p) => `PID=${p.pid} PPID=${p.ppid} PGID=${p.pgid} SID=${p.sid} STATE=${p.state} ${p.name}${p.tty ? ` TTY=${p.tty}` : ""}`).join("\n"));
        break;
      }
    }
  }

  return { events, processes, groups, sessions, cgroups, namespaces, stats };
}
