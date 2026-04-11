/* UNIX 端末入出力 シミュレーター エンジン */

import type {
  Termios, TTY, PTY, TermProcess, FileDescriptor,
  SimEvent, TermInstr, SimConfig, SimOp,
  StepResult, SimulationResult, SignalType, ControlChars,
} from "./types.js";

// ─── デフォルト設定 ───

/** デフォルトtermios（正規モード） */
export function defaultTermios(): Termios {
  return {
    iflag: { ICRNL: true, INLCR: false, ISTRIP: false, IXON: true },
    oflag: { OPOST: true, ONLCR: true },
    lflag: { ECHO: true, ICANON: true, ISIG: true, ECHONL: false, ECHOCTL: true },
    cc: {
      VINTR: "\x03", VQUIT: "\x1c", VSUSP: "\x1a", VEOF: "\x04",
      VERASE: "\x7f", VKILL: "\x15", VSTART: "\x11", VSTOP: "\x13",
      VEOL: "\n", VMIN: 1, VTIME: 0,
    },
  };
}

/** rawモードtermios */
export function rawTermios(): Termios {
  return {
    iflag: { ICRNL: false, INLCR: false, ISTRIP: false, IXON: false },
    oflag: { OPOST: false, ONLCR: false },
    lflag: { ECHO: false, ICANON: false, ISIG: false, ECHONL: false, ECHOCTL: false },
    cc: {
      VINTR: "\x03", VQUIT: "\x1c", VSUSP: "\x1a", VEOF: "\x04",
      VERASE: "\x7f", VKILL: "\x15", VSTART: "\x11", VSTOP: "\x13",
      VEOL: "\n", VMIN: 1, VTIME: 0,
    },
  };
}

/** cbreakモードtermios */
export function cbreakTermios(): Termios {
  return {
    iflag: { ICRNL: true, INLCR: false, ISTRIP: false, IXON: true },
    oflag: { OPOST: true, ONLCR: true },
    lflag: { ECHO: false, ICANON: false, ISIG: true, ECHONL: false, ECHOCTL: true },
    cc: {
      VINTR: "\x03", VQUIT: "\x1c", VSUSP: "\x1a", VEOF: "\x04",
      VERASE: "\x7f", VKILL: "\x15", VSTART: "\x11", VSTOP: "\x13",
      VEOL: "\n", VMIN: 1, VTIME: 0,
    },
  };
}

/** デフォルトシミュレーション設定 */
export function defaultConfig(): SimConfig {
  return { maxTicks: 200 };
}

// ─── 制御文字のヒューマンリーダブル表記 ───

/** 制御文字を表示名に変換 */
export function charName(c: string): string {
  const map: Record<string, string> = {
    "\x03": "Ctrl+C", "\x04": "Ctrl+D", "\x1a": "Ctrl+Z",
    "\x1c": "Ctrl+\\", "\x7f": "Backspace", "\x15": "Ctrl+U",
    "\x11": "Ctrl+Q", "\x13": "Ctrl+S", "\n": "Enter(LF)",
    "\r": "Enter(CR)", "\x1b": "ESC", "\t": "Tab",
    " ": "Space",
  };
  if (map[c]) return map[c];
  if (c.length === 1 && c.charCodeAt(0) < 32) {
    return `Ctrl+${String.fromCharCode(c.charCodeAt(0) + 64)}`;
  }
  return `'${c}'`;
}

/** シグナル名と制御文字の対応 */
function signalForChar(c: string, cc: ControlChars): SignalType | null {
  if (c === cc.VINTR) return "SIGINT";
  if (c === cc.VQUIT) return "SIGQUIT";
  if (c === cc.VSUSP) return "SIGTSTP";
  return null;
}

// ─── シミュレーション状態 ───

interface SimState {
  tty: TTY;
  pty: PTY | null;
  processes: TermProcess[];
  events: SimEvent[];
  tick: number;
  nextPid: number;
  nextFd: number;
  /** 直近のread結果 */
  lastRead: string | null;
}

/** 初期状態を作成 */
function createState(op: SimOp): SimState {
  const tty: TTY = {
    name: op.ttyName,
    termios: defaultTermios(),
    inputBuffer: "",
    outputBuffer: "",
    screen: [],
    stopped: false,
    foregroundPgid: 1,
  };

  const shellFds: FileDescriptor[] = [
    { fd: 0, target: "tty", mode: "read", name: op.ttyName },
    { fd: 1, target: "tty", mode: "write", name: op.ttyName },
    { fd: 2, target: "tty", mode: "write", name: op.ttyName },
  ];

  const shell: TermProcess = {
    pid: 1, name: "shell", pgid: 1, sid: 1,
    fds: shellFds, state: "running",
  };

  return {
    tty, pty: null, processes: [shell], events: [], tick: 0,
    nextPid: 2, nextFd: 3, lastRead: null,
  };
}

// ─── 入力処理（line discipline） ───

/** 入力文字をline disciplineを通して処理 */
function processInput(state: SimState, char: string): string {
  const { tty } = state;
  const { termios } = tty;
  const events = state.events;

  // フロー制御 (IXON)
  if (termios.iflag.IXON) {
    if (char === termios.cc.VSTOP) {
      tty.stopped = true;
      events.push({ type: "flow_control", tick: state.tick, message: "XOFF: 出力停止 (Ctrl+S)" });
      return "";
    }
    if (char === termios.cc.VSTART) {
      tty.stopped = false;
      events.push({ type: "flow_control", tick: state.tick, message: "XON: 出力再開 (Ctrl+Q)" });
      return "";
    }
  }

  // シグナル生成 (ISIG)
  if (termios.lflag.ISIG) {
    const sig = signalForChar(char, termios.cc);
    if (sig) {
      deliverSignal(state, sig);
      if (termios.lflag.ECHO && termios.lflag.ECHOCTL) {
        const display = `^${String.fromCharCode(char.charCodeAt(0) + 64)}`;
        appendScreen(tty, display);
        events.push({ type: "echo", tick: state.tick, message: `エコー: ${display}` });
      }
      // 正規モード時はバッファクリア
      if (termios.lflag.ICANON) {
        tty.inputBuffer = "";
      }
      return "";
    }
  }

  // 入力変換 (c_iflag)
  let processed = char;
  if (termios.iflag.ICRNL && char === "\r") {
    processed = "\n";
    events.push({ type: "line_discipline", tick: state.tick, message: "ICRNL: CR → NL 変換" });
  }
  if (termios.iflag.INLCR && char === "\n") {
    processed = "\r";
    events.push({ type: "line_discipline", tick: state.tick, message: "INLCR: NL → CR 変換" });
  }
  if (termios.iflag.ISTRIP) {
    processed = String.fromCharCode(processed.charCodeAt(0) & 0x7f);
  }

  // 正規モード (ICANON)
  if (termios.lflag.ICANON) {
    // EOF
    if (processed === termios.cc.VEOF) {
      events.push({ type: "line_discipline", tick: state.tick, message: "EOF検出 (Ctrl+D)" });
      if (tty.inputBuffer.length > 0) {
        // バッファ内容をフラッシュ
        state.lastRead = tty.inputBuffer;
        tty.inputBuffer = "";
        events.push({ type: "input", tick: state.tick, message: `EOF: バッファフラッシュ "${state.lastRead}"` });
      } else {
        state.lastRead = "";
        events.push({ type: "input", tick: state.tick, message: "EOF: 空読み（ファイル終端）" });
      }
      return "";
    }

    // 行削除 (VKILL)
    if (processed === termios.cc.VKILL) {
      const killed = tty.inputBuffer;
      tty.inputBuffer = "";
      events.push({ type: "line_discipline", tick: state.tick, message: `行削除: "${killed}" を破棄 (Ctrl+U)` });
      if (termios.lflag.ECHO) {
        appendScreen(tty, "\r\n");
      }
      return "";
    }

    // 文字削除 (VERASE)
    if (processed === termios.cc.VERASE) {
      if (tty.inputBuffer.length > 0) {
        const erased = tty.inputBuffer[tty.inputBuffer.length - 1];
        tty.inputBuffer = tty.inputBuffer.slice(0, -1);
        events.push({ type: "line_discipline", tick: state.tick, message: `文字削除: '${erased}' (Backspace)` });
        if (termios.lflag.ECHO) {
          // Backspace + Space + Backspace で画面から消す
          appendScreen(tty, "\b \b");
        }
      }
      return "";
    }

    // 改行 → バッファフラッシュ
    if (processed === "\n") {
      tty.inputBuffer += processed;
      state.lastRead = tty.inputBuffer;
      tty.inputBuffer = "";
      events.push({ type: "input", tick: state.tick, message: `行完成: "${escapeForDisplay(state.lastRead)}"` });
      if (termios.lflag.ECHO || termios.lflag.ECHONL) {
        appendScreen(tty, "\n");
        events.push({ type: "echo", tick: state.tick, message: "エコー: 改行" });
      }
      return state.lastRead;
    }

    // 通常文字 → バッファに追加
    tty.inputBuffer += processed;
    events.push({ type: "line_discipline", tick: state.tick, message: `バッファ追加: '${processed}' → "${tty.inputBuffer}"` });
    if (termios.lflag.ECHO) {
      appendScreen(tty, processed);
      events.push({ type: "echo", tick: state.tick, message: `エコー: '${processed}'` });
    }
    return "";

  } else {
    // rawモード / cbreakモード → 即座に利用可能
    state.lastRead = processed;
    events.push({ type: "input", tick: state.tick, message: `raw入力: ${charName(processed)} (0x${processed.charCodeAt(0).toString(16).padStart(2, "0")})` });
    if (termios.lflag.ECHO) {
      if (processed.charCodeAt(0) < 32 && termios.lflag.ECHOCTL) {
        const display = `^${String.fromCharCode(processed.charCodeAt(0) + 64)}`;
        appendScreen(tty, display);
      } else {
        appendScreen(tty, processed);
      }
      events.push({ type: "echo", tick: state.tick, message: `エコー: ${charName(processed)}` });
    }
    return processed;
  }
}

// ─── 出力処理 ───

/** 出力をline disciplineを通して処理 */
function processOutput(state: SimState, text: string, stream: "stdout" | "stderr"): void {
  const { tty } = state;
  const { termios } = tty;

  let output = text;

  // 出力処理 (c_oflag)
  if (termios.oflag.OPOST) {
    if (termios.oflag.ONLCR) {
      output = output.replace(/\n/g, "\r\n");
    }
  }

  // フロー制御で停止中
  if (tty.stopped) {
    tty.outputBuffer += output;
    state.events.push({ type: "flow_control", tick: state.tick, message: `出力バッファリング（XOFF中）: "${escapeForDisplay(output)}"` });
    return;
  }

  appendScreen(tty, output);
  state.events.push({
    type: "output", tick: state.tick,
    message: `${stream}: "${escapeForDisplay(output)}"`,
    detail: termios.oflag.ONLCR ? "ONLCR適用" : undefined,
  });
}

/** 画面にテキストを追加 */
function appendScreen(tty: TTY, text: string): void {
  if (tty.screen.length === 0) tty.screen.push("");
  // \r\n を改行として事前処理
  const normalized = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "\n") {
      tty.screen.push("");
    } else if (ch === "\r") {
      // キャリッジリターン：カーソルを行頭に（上書き用）
      // 単独CRは行頭移動（内容は保持、次の文字で上書き可能）
      tty.screen[tty.screen.length - 1] = "";
    } else if (ch === "\b") {
      const last = tty.screen[tty.screen.length - 1];
      tty.screen[tty.screen.length - 1] = last.slice(0, -1);
    } else {
      tty.screen[tty.screen.length - 1] += ch;
    }
  }
}

// ─── シグナル配送 ───

/** シグナルをフォアグラウンドプロセスグループに配送 */
function deliverSignal(state: SimState, signal: SignalType): void {
  const targets = state.processes.filter(p =>
    p.pgid === state.tty.foregroundPgid && p.state !== "terminated"
  );

  for (const proc of targets) {
    switch (signal) {
      case "SIGINT":
      case "SIGQUIT":
        proc.state = "terminated";
        break;
      case "SIGTSTP":
        proc.state = "stopped";
        break;
      case "SIGCONT":
        if (proc.state === "stopped") proc.state = "running";
        break;
    }
  }

  state.events.push({
    type: "signal", tick: state.tick,
    message: `${signal} → pgid=${state.tty.foregroundPgid} (${targets.map(p => `P${p.pid}:${p.name}`).join(", ")})`,
  });
}

// ─── 命令実行 ───

/** 1命令を実行 */
function executeInstr(state: SimState, instr: TermInstr): string {
  switch (instr.op) {
    case "keypress": {
      const result = processInput(state, instr.char);
      if (result) {
        return `キー入力: ${charName(instr.char)} → 読取可能: "${escapeForDisplay(result)}"`;
      }
      return `キー入力: ${charName(instr.char)}`;
    }

    case "write_stdout": {
      processOutput(state, instr.text, "stdout");
      return `write(1, "${escapeForDisplay(instr.text)}")`;
    }

    case "write_stderr": {
      processOutput(state, instr.text, "stderr");
      return `write(2, "${escapeForDisplay(instr.text)}")`;
    }

    case "read_stdin": {
      const data = state.lastRead;
      state.lastRead = null;
      if (data !== null) {
        state.events.push({ type: "input", tick: state.tick, message: `read(0) = "${escapeForDisplay(data)}" (${data.length} bytes)` });
        return `read(0) → "${escapeForDisplay(data)}" (${data.length} bytes)`;
      }
      state.events.push({ type: "input", tick: state.tick, message: "read(0): データなし（ブロック中）" });
      return "read(0) → ブロック（データ待ち）";
    }

    case "tcgetattr": {
      const t = state.tty.termios;
      const mode = t.lflag.ICANON ? "canonical" : (t.lflag.ISIG ? "cbreak" : "raw");
      state.events.push({
        type: "termios_change", tick: state.tick,
        message: `tcgetattr: mode=${mode}, ECHO=${t.lflag.ECHO}, ISIG=${t.lflag.ISIG}`,
      });
      return `tcgetattr: mode=${mode}`;
    }

    case "tcsetattr": {
      const t = state.tty.termios;
      const changes: string[] = [];
      if (instr.changes.lflag) {
        Object.assign(t.lflag, instr.changes.lflag);
        changes.push(...Object.entries(instr.changes.lflag).map(([k, v]) => `${k}=${v}`));
      }
      if (instr.changes.iflag) {
        Object.assign(t.iflag, instr.changes.iflag);
        changes.push(...Object.entries(instr.changes.iflag).map(([k, v]) => `${k}=${v}`));
      }
      if (instr.changes.oflag) {
        Object.assign(t.oflag, instr.changes.oflag);
        changes.push(...Object.entries(instr.changes.oflag).map(([k, v]) => `${k}=${v}`));
      }
      if (instr.changes.cc) {
        Object.assign(t.cc, instr.changes.cc);
        changes.push(...Object.entries(instr.changes.cc).map(([k, v]) => `${k}=${v}`));
      }
      state.events.push({ type: "termios_change", tick: state.tick, message: `tcsetattr: ${changes.join(", ")}` });
      return `tcsetattr: ${changes.join(", ")}`;
    }

    case "set_raw": {
      state.tty.termios = rawTermios();
      state.events.push({ type: "termios_change", tick: state.tick, message: "cfmakeraw: rawモードに切替（ECHO=off, ICANON=off, ISIG=off）" });
      return "cfmakeraw → rawモード";
    }

    case "set_canonical": {
      state.tty.termios = defaultTermios();
      state.events.push({ type: "termios_change", tick: state.tick, message: "正規モードに切替（ECHO=on, ICANON=on, ISIG=on）" });
      return "正規モード復元";
    }

    case "set_cbreak": {
      state.tty.termios = cbreakTermios();
      state.events.push({ type: "termios_change", tick: state.tick, message: "cbreakモードに切替（ECHO=off, ICANON=off, ISIG=on）" });
      return "cbreakモード";
    }

    case "pty_open": {
      const masterFd = state.nextFd++;
      const slaveName = `/dev/pts/${state.nextPid}`;
      state.pty = { masterFd, slaveName, masterOutput: "" };
      state.events.push({ type: "pty", tick: state.tick, message: `PTY開設: master_fd=${masterFd}, slave=${slaveName}` });
      return `posix_openpt → master_fd=${masterFd}, slave=${slaveName}`;
    }

    case "pty_write": {
      if (!state.pty) return "PTY未開設";
      state.pty.masterOutput += instr.text;
      processOutput(state, instr.text, "stdout");
      state.events.push({ type: "pty", tick: state.tick, message: `PTY write(master): "${escapeForDisplay(instr.text)}"` });
      return `write(pty_master, "${escapeForDisplay(instr.text)}")`;
    }

    case "pty_read": {
      if (!state.pty) return "PTY未開設";
      const data = state.lastRead ?? "";
      state.events.push({ type: "pty", tick: state.tick, message: `PTY read(master): "${escapeForDisplay(data)}"` });
      return `read(pty_master) → "${escapeForDisplay(data)}"`;
    }

    case "send_signal": {
      deliverSignal(state, instr.signal);
      return `kill(${instr.pid}, ${instr.signal})`;
    }

    case "fg_process": {
      const proc = state.processes.find(p => p.pid === instr.pid);
      if (!proc) return `プロセスP${instr.pid}が存在しない`;
      state.tty.foregroundPgid = proc.pgid;
      if (proc.state === "stopped") {
        proc.state = "running";
        deliverSignal(state, "SIGCONT");
      }
      state.events.push({ type: "signal", tick: state.tick, message: `fg: P${instr.pid}(${proc.name}) をフォアグラウンドに` });
      return `fg P${instr.pid}(${proc.name})`;
    }

    case "bg_process": {
      const proc = state.processes.find(p => p.pid === instr.pid);
      if (!proc) return `プロセスP${instr.pid}が存在しない`;
      if (proc.state === "stopped") {
        proc.state = "running";
      }
      state.events.push({ type: "signal", tick: state.tick, message: `bg: P${instr.pid}(${proc.name}) をバックグラウンドに` });
      return `bg P${instr.pid}(${proc.name})`;
    }

    case "spawn": {
      const pid = state.nextPid++;
      const pgid = instr.pgid ?? pid;
      const fds: FileDescriptor[] = [
        { fd: 0, target: "tty", mode: "read", name: state.tty.name },
        { fd: 1, target: "tty", mode: "write", name: state.tty.name },
        { fd: 2, target: "tty", mode: "write", name: state.tty.name },
      ];
      state.processes.push({ pid, name: instr.name, pgid, sid: 1, fds, state: "running" });
      state.events.push({ type: "comment", tick: state.tick, message: `spawn: P${pid}(${instr.name}), pgid=${pgid}` });
      return `spawn P${pid}(${instr.name}), pgid=${pgid}`;
    }

    case "ansi_escape": {
      appendScreen(state.tty, `\x1b${instr.seq}`);
      state.events.push({ type: "output", tick: state.tick, message: `ANSI: ESC${instr.seq} — ${instr.desc}` });
      return `ANSI: ESC${instr.seq} (${instr.desc})`;
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

  for (let i = 0; i < op.instructions.length && i < op.config.maxTicks; i++) {
    state.tick = i;
    const instr = op.instructions[i];
    const eventsBeforeCount = state.events.length;
    const msg = executeInstr(state, instr);
    const stepEvents = state.events.slice(eventsBeforeCount);

    steps.push({
      tick: i, instruction: instr,
      tty: cloneTTY(state.tty),
      pty: state.pty ? { ...state.pty } : null,
      processes: state.processes.map(p => ({ ...p, fds: p.fds.map(f => ({ ...f })) })),
      events: stepEvents,
      message: msg,
    });
  }

  return { steps, events: state.events };
}

/** TTYの深いコピー */
function cloneTTY(tty: TTY): TTY {
  return {
    ...tty,
    termios: {
      iflag: { ...tty.termios.iflag },
      oflag: { ...tty.termios.oflag },
      lflag: { ...tty.termios.lflag },
      cc: { ...tty.termios.cc },
    },
    screen: [...tty.screen],
  };
}

/** 表示用エスケープ */
function escapeForDisplay(s: string): string {
  return s.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
    .replace(/[\x00-\x1f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

