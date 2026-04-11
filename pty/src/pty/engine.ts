/* UNIX 擬似端末 (PTY) シミュレーター エンジン */

import type {
  Fd, Pid, Sid, PtyPair, PtyProcess, FdEntry, DataFlow,
  SimEvent, PtyInstr, SimOp, StepResult, SimulationResult,
} from "./types.js";

// ─── シミュレーション状態 ───

interface SimState {
  ptyPairs: PtyPair[];
  processes: PtyProcess[];
  dataFlows: DataFlow[];
  events: SimEvent[];
  tick: number;
  nextFd: Fd;
  nextPid: Pid;
  nextPtyId: number;
  /** 現在実行中のプロセスPID */
  currentPid: Pid;
  /** プロセスごとの命令キュー */
  instrQueues: Map<Pid, PtyInstr[]>;
}

/** 初期状態を作成 */
function createState(op: SimOp): SimState {
  const initProc: PtyProcess = {
    pid: 1, name: "init", ppid: 0, pgid: 1, sid: 1,
    state: "running", fds: [
      { fd: 0, target: "/dev/console", mode: "read" },
      { fd: 1, target: "/dev/console", mode: "write" },
      { fd: 2, target: "/dev/console", mode: "write" },
    ],
    sessionLeader: true, ctty: "/dev/console",
  };

  const instrQueues = new Map<Pid, PtyInstr[]>();
  instrQueues.set(1, op.instructions);

  return {
    ptyPairs: [], processes: [initProc], dataFlows: [],
    events: [], tick: 0, nextFd: 3, nextPid: 2, nextPtyId: 0,
    currentPid: 1, instrQueues,
  };
}

// ─── ヘルパー ───

/** プロセスを取得 */
function getProc(state: SimState, pid: Pid): PtyProcess | undefined {
  return state.processes.find(p => p.pid === pid);
}

/** 現在のプロセスを取得 */
function curProc(state: SimState): PtyProcess {
  return getProc(state, state.currentPid)!;
}

/** 現在のPTY（最後に作成されたもの）を取得 */
function curPty(state: SimState): PtyPair | undefined {
  return state.ptyPairs[state.ptyPairs.length - 1];
}

/** FDを追加 */
function addFd(proc: PtyProcess, target: string, mode: FdEntry["mode"], state: SimState): Fd {
  const fd = state.nextFd++;
  proc.fds.push({ fd, target, mode });
  return fd;
}

/** エスケープ表示 */
function esc(s: string): string {
  return s.replace(/\n/g, "\\n").replace(/\r/g, "\\r")
    .replace(/[\x00-\x1f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

// ─── 命令実行 ───

/** 1命令を実行 */
function executeInstr(state: SimState, instr: PtyInstr): string {
  const proc = curProc(state);

  switch (instr.op) {
    case "posix_openpt": {
      const id = state.nextPtyId++;
      const masterFd = addFd(proc, `/dev/ptmx`, "readwrite", state);
      const slavePath = `/dev/pts/${id}`;
      const pty: PtyPair = {
        id, masterFd, slavePath, slaveFd: null,
        state: "allocated",
        masterToSlave: "", slaveToMaster: "",
        controllingSession: null,
        winSize: { rows: 24, cols: 80 },
        echo: true, canonical: true,
      };
      state.ptyPairs.push(pty);
      state.events.push({
        type: "pty_alloc", tick: state.tick,
        message: `posix_openpt: PTY${id} 確保, master_fd=${masterFd}, slave=${slavePath}`,
        detail: "/dev/ptmx を open → カーネルが未使用のPTY番号を割当",
      });
      return `posix_openpt() → fd=${masterFd} (PTY${id})`;
    }

    case "grantpt": {
      const pty = curPty(state);
      if (!pty) return "grantpt: PTY未確保";
      pty.state = "granted";
      state.events.push({
        type: "pty_grant", tick: state.tick,
        message: `grantpt: ${pty.slavePath} のパーミッション設定`,
        detail: "スレーブデバイスの所有者をcalling processに変更、グループをttyに設定",
      });
      return `grantpt(${pty.masterFd}) → ${pty.slavePath} 権限付与`;
    }

    case "unlockpt": {
      const pty = curPty(state);
      if (!pty) return "unlockpt: PTY未確保";
      pty.state = "unlocked";
      state.events.push({
        type: "pty_unlock", tick: state.tick,
        message: `unlockpt: ${pty.slavePath} ロック解除`,
        detail: "スレーブ側をopen可能にする（デフォルトではロックされている）",
      });
      return `unlockpt(${pty.masterFd}) → ${pty.slavePath} 解錠`;
    }

    case "ptsname": {
      const pty = curPty(state);
      if (!pty) return "ptsname: PTY未確保";
      state.events.push({
        type: "pty_open", tick: state.tick,
        message: `ptsname: ${pty.slavePath}`,
        detail: `マスターfdからスレーブデバイスパスを取得`,
      });
      return `ptsname(${pty.masterFd}) → "${pty.slavePath}"`;
    }

    case "open_slave": {
      const pty = curPty(state);
      if (!pty) return "open_slave: PTY未確保";
      if (pty.state !== "unlocked" && pty.state !== "open") {
        return `open_slave: ${pty.slavePath} はまだロック中 (state=${pty.state})`;
      }
      const slaveFd = addFd(proc, pty.slavePath, "readwrite", state);
      pty.slaveFd = slaveFd;
      pty.state = "open";
      state.events.push({
        type: "pty_open", tick: state.tick,
        message: `open(${pty.slavePath}) → fd=${slaveFd}`,
        detail: "スレーブ側をopenしてfdを取得。プロセスのstdin/stdout/stderrにdup2する",
      });
      return `open(${pty.slavePath}) → fd=${slaveFd}`;
    }

    case "close_fd": {
      proc.fds = proc.fds.filter(f => f.fd !== instr.fd);
      // PTYのfdを閉じた場合の処理
      for (const pty of state.ptyPairs) {
        if (pty.masterFd === instr.fd) {
          state.events.push({
            type: "pty_close", tick: state.tick,
            message: `close(${instr.fd}): PTY${pty.id} マスター側クローズ`,
            detail: "マスター側を閉じるとスレーブ側にSIGHUPが送られる",
          });
        }
        if (pty.slaveFd === instr.fd) {
          pty.slaveFd = null;
          state.events.push({
            type: "pty_close", tick: state.tick,
            message: `close(${instr.fd}): PTY${pty.id} スレーブ側クローズ`,
          });
        }
      }
      return `close(${instr.fd})`;
    }

    case "write_master": {
      const pty = curPty(state);
      if (!pty) return "write_master: PTY未確保";
      pty.masterToSlave += instr.data;
      const flow: DataFlow = {
        from: `P${proc.pid}(${proc.name})`,
        through: `PTY${pty.id} line discipline`,
        to: `slave(${pty.slavePath})`,
        data: instr.data,
        direction: "master→slave",
      };
      state.dataFlows.push(flow);
      state.events.push({
        type: "data_flow", tick: state.tick,
        message: `write(master_fd=${pty.masterFd}, "${esc(instr.data)}")`,
        detail: `master→line discipline→slave: 端末エミュレータからシェルへの入力`,
      });
      return `write(${pty.masterFd}, "${esc(instr.data)}") → master→slave`;
    }

    case "read_master": {
      const pty = curPty(state);
      if (!pty) return "read_master: PTY未確保";
      const data = pty.slaveToMaster;
      pty.slaveToMaster = "";
      state.events.push({
        type: "data_flow", tick: state.tick,
        message: `read(master_fd=${pty.masterFd}) → "${esc(data)}" (${data.length} bytes)`,
        detail: "slave→line discipline→master: シェル出力を端末エミュレータが読む",
      });
      return `read(${pty.masterFd}) → "${esc(data)}"`;
    }

    case "write_slave": {
      const pty = curPty(state);
      if (!pty) return "write_slave: PTY未確保";
      let output = instr.data;
      // エコー処理
      if (pty.echo) {
        pty.slaveToMaster += output;
      }
      pty.slaveToMaster += output;
      const flow: DataFlow = {
        from: `P${proc.pid}(${proc.name})`,
        through: `PTY${pty.id} line discipline`,
        to: `master(fd=${pty.masterFd})`,
        data: instr.data,
        direction: "slave→master",
      };
      state.dataFlows.push(flow);
      state.events.push({
        type: "data_flow", tick: state.tick,
        message: `write(slave, "${esc(instr.data)}")`,
        detail: "slave→line discipline→master: プログラム出力がマスターへ",
      });
      return `write(slave, "${esc(instr.data)}") → slave→master`;
    }

    case "read_slave": {
      const pty = curPty(state);
      if (!pty) return "read_slave: PTY未確保";
      const data = pty.masterToSlave;
      pty.masterToSlave = "";
      if (data.length === 0) {
        return `read(slave) → ブロック（入力待ち）`;
      }
      state.events.push({
        type: "data_flow", tick: state.tick,
        message: `read(slave) → "${esc(data)}" (${data.length} bytes)`,
        detail: "master→line discipline→slave: キーボード入力をシェルが読む",
      });
      return `read(slave) → "${esc(data)}"`;
    }

    case "fork": {
      const childPid = state.nextPid++;
      // 子プロセスはfdをコピー
      const child: PtyProcess = {
        pid: childPid, name: instr.childName,
        ppid: proc.pid, pgid: proc.pgid, sid: proc.sid,
        state: "running",
        fds: proc.fds.map(f => ({ ...f })),
        sessionLeader: false, ctty: proc.ctty,
      };
      state.processes.push(child);
      if (instr.childInstrs) {
        state.instrQueues.set(childPid, instr.childInstrs);
      }
      state.events.push({
        type: "fork", tick: state.tick,
        message: `fork() → P${childPid}(${instr.childName}), ppid=${proc.pid}`,
        detail: "子プロセスは親のfdテーブルをコピー（PTYのfdも引き継ぐ）",
      });
      return `fork() → child P${childPid}(${instr.childName})`;
    }

    case "exec": {
      proc.name = instr.program;
      state.events.push({
        type: "exec", tick: state.tick,
        message: `exec("${instr.program}"): P${proc.pid} がプログラムを置換`,
        detail: "execveでプロセスイメージを置換。fdテーブルはCLOEXECでないfdを引き継ぐ",
      });
      return `exec("${instr.program}")`;
    }

    case "setsid": {
      const newSid = proc.pid as Sid;
      proc.sid = newSid;
      proc.pgid = proc.pid;
      proc.sessionLeader = true;
      proc.ctty = null; // 新セッションには制御端末がない
      state.events.push({
        type: "setsid", tick: state.tick,
        message: `setsid() → sid=${newSid}: P${proc.pid} が新セッション作成`,
        detail: "新しいセッションを作成。プロセスがセッションリーダーに。制御端末は切り離される",
      });
      return `setsid() → sid=${newSid}`;
    }

    case "ioctl_tiocsctty": {
      const pty = curPty(state);
      if (!pty) return "TIOCSCTTY: PTY未確保";
      if (!proc.sessionLeader) {
        return `TIOCSCTTY: P${proc.pid} はセッションリーダーではない`;
      }
      pty.controllingSession = proc.sid;
      proc.ctty = pty.slavePath;
      // 同じセッションの全プロセスに制御端末を設定
      for (const p of state.processes) {
        if (p.sid === proc.sid) p.ctty = pty.slavePath;
      }
      state.events.push({
        type: "ctty", tick: state.tick,
        message: `ioctl(TIOCSCTTY): ${pty.slavePath} を制御端末に設定 (session=${proc.sid})`,
        detail: "セッションリーダーがTIOCSCTTYで制御端末を確立。SIGHUP/SIGINTの配送先になる",
      });
      return `ioctl(TIOCSCTTY) → ctty=${pty.slavePath}`;
    }

    case "ioctl_tiocgwinsz": {
      const pty = curPty(state);
      if (!pty) return "TIOCGWINSZ: PTY未確保";
      state.events.push({
        type: "winsize", tick: state.tick,
        message: `ioctl(TIOCGWINSZ) → ${pty.winSize.rows}×${pty.winSize.cols}`,
      });
      return `ioctl(TIOCGWINSZ) → ${pty.winSize.rows} rows × ${pty.winSize.cols} cols`;
    }

    case "ioctl_tiocswinsz": {
      const pty = curPty(state);
      if (!pty) return "TIOCSWINSZ: PTY未確保";
      const oldSize = `${pty.winSize.rows}×${pty.winSize.cols}`;
      pty.winSize = { rows: instr.rows, cols: instr.cols };
      state.events.push({
        type: "winsize", tick: state.tick,
        message: `ioctl(TIOCSWINSZ): ${oldSize} → ${instr.rows}×${instr.cols}`,
        detail: "ウィンドウサイズ変更 → フォアグラウンドプロセスにSIGWINCHが送られる",
      });
      return `ioctl(TIOCSWINSZ) → ${instr.rows}×${instr.cols}`;
    }

    case "dup2": {
      // 既存のdst fdを閉じて、srcをdstにコピー
      proc.fds = proc.fds.filter(f => f.fd !== instr.dstFd);
      const src = proc.fds.find(f => f.fd === instr.srcFd);
      if (src) {
        proc.fds.push({ fd: instr.dstFd, target: src.target, mode: src.mode });
      }
      state.events.push({
        type: "ioctl", tick: state.tick,
        message: `dup2(${instr.srcFd}, ${instr.dstFd}): fd${instr.dstFd} → ${src?.target ?? "?"}`,
        detail: `fd${instr.dstFd}をfd${instr.srcFd}のコピーに。stdin/stdout/stderrをPTYスレーブに接続`,
      });
      return `dup2(${instr.srcFd}, ${instr.dstFd})`;
    }

    case "set_echo": {
      const pty = curPty(state);
      if (!pty) return "set_echo: PTY未確保";
      pty.echo = instr.enabled;
      state.events.push({
        type: "ioctl", tick: state.tick,
        message: `tcsetattr: ECHO=${instr.enabled ? "on" : "off"}`,
      });
      return `ECHO=${instr.enabled ? "on" : "off"}`;
    }

    case "set_canonical": {
      const pty = curPty(state);
      if (!pty) return "set_canonical: PTY未確保";
      pty.canonical = instr.enabled;
      state.events.push({
        type: "ioctl", tick: state.tick,
        message: `tcsetattr: ICANON=${instr.enabled ? "on" : "off"}`,
      });
      return `ICANON=${instr.enabled ? "on" : "off"}`;
    }

    case "send_sigwinch": {
      state.events.push({
        type: "signal", tick: state.tick,
        message: `SIGWINCH → フォアグラウンドプロセスグループ`,
        detail: "端末サイズ変更通知。curses/readlineがレイアウトを再計算",
      });
      return "SIGWINCH sent";
    }

    case "send_sigint": {
      const pty = curPty(state);
      if (!pty) return "SIGINT: PTY未確保";
      state.events.push({
        type: "signal", tick: state.tick,
        message: `SIGINT → session=${pty.controllingSession} フォアグラウンド`,
        detail: "Ctrl+C: マスター側にCtrl+Cを書き込み → line disciplineがSIGINTを生成",
      });
      return "SIGINT (Ctrl+C via PTY)";
    }

    case "send_sighup": {
      const pty = curPty(state);
      state.events.push({
        type: "signal", tick: state.tick,
        message: `SIGHUP → セッション全プロセス${pty ? ` (PTY${pty.id})` : ""}`,
        detail: "マスター側クローズ/切断時にSIGHUPが配送される",
      });
      return "SIGHUP sent";
    }

    case "wait_child": {
      state.events.push({
        type: "comment", tick: state.tick,
        message: `waitpid: P${proc.pid} が子プロセス終了を待機`,
      });
      return `waitpid(-1)`;
    }

    case "comment": {
      state.events.push({ type: "comment", tick: state.tick, message: instr.text });
      return instr.text;
    }
  }
}

// ─── シミュレーション実行 ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allSteps: StepResult[] = [];
  const allEvents: SimEvent[] = [];
  for (const op of ops) {
    const result = executeSimulation(op);
    allSteps.push(...result.steps);
    allEvents.push(...result.events);
  }
  return { steps: allSteps, events: allEvents };
}

/** 単一シミュレーション実行 */
export function executeSimulation(op: SimOp): SimulationResult {
  const state = createState(op);
  const steps: StepResult[] = [];

  // メインプロセスの命令を順次実行
  const mainInstrs = state.instrQueues.get(1) ?? [];
  for (let i = 0; i < mainInstrs.length && i < op.config.maxTicks; i++) {
    state.tick = i;
    state.currentPid = 1;
    const instr = mainInstrs[i];
    const evBefore = state.events.length;
    const msg = executeInstr(state, instr);
    const stepEvents = state.events.slice(evBefore);

    // forkされた子プロセスの命令を実行
    for (const [pid, childInstrs] of state.instrQueues) {
      if (pid === 1) continue;
      const childProc = getProc(state, pid);
      if (!childProc || childProc.state !== "running") continue;
      if (childInstrs.length > 0) {
        state.currentPid = pid;
        const childInstr = childInstrs.shift()!;
        const childEvBefore = state.events.length;
        const childMsg = executeInstr(state, childInstr);
        const childEvents = state.events.slice(childEvBefore);
        // 子プロセスのステップも追加
        steps.push({
          tick: state.tick, instruction: childInstr,
          ptyPairs: clonePtys(state), processes: cloneProcs(state),
          dataFlows: [...state.dataFlows], events: childEvents,
          message: `[P${pid}] ${childMsg}`,
        });
      }
    }

    state.currentPid = 1;
    steps.push({
      tick: i, instruction: instr,
      ptyPairs: clonePtys(state), processes: cloneProcs(state),
      dataFlows: [...state.dataFlows], events: stepEvents,
      message: msg,
    });
  }

  return { steps, events: state.events };
}

/** PTYのクローン */
function clonePtys(state: SimState): PtyPair[] {
  return state.ptyPairs.map(p => ({
    ...p, winSize: { ...p.winSize },
  }));
}

/** プロセスのクローン */
function cloneProcs(state: SimState): PtyProcess[] {
  return state.processes.map(p => ({
    ...p, fds: p.fds.map(f => ({ ...f })),
  }));
}

// ─── デフォルト設定 ───

/** デフォルト設定 */
export function defaultConfig(): SimOp["config"] {
  return { maxTicks: 200 };
}
