/*
 * Unix V6 シミュレーター エンジン
 *
 * 1975年のPDP-11/40向けUnix V6の主要サブシステムをTypeScriptで再現する。
 * Ken ThompsonとDennis Ritchieが開発し、John Lionsが解説書を書いた
 * この歴史的OSの内部動作を、ブラウザ上でステップ実行で学習できる。
 *
 * V6のソースコード構成との対応:
 * - プロセス管理 (slp.c, sys1.c):
 *     fork/exec/wait/exitモデル。ゾンビ回収と孤児のinit再配置。
 *     V6のforkは物理メモリのフルコピー(BSDのvforkやLinuxのCoWは後の発明)。
 *
 * - ファイルシステム (alloc.c, iget.c, nami.c, rdwri.c):
 *     i-node方式。addr[13]の13ブロックアドレスで
 *     小さなファイル(直接10個)から大きなファイル(間接3段階)まで効率的に管理。
 *     スーパーブロックのフリーリスト連鎖方式でブロック/inodeを管理。
 *
 * - バッファキャッシュ (bio.c):
 *     全ブロックI/Oの中間層。LRU置換とdirty writeback。
 *     V6ではBNBUF=15個の固定バッファプール。
 *
 * - パイプ (pipe.c):
 *     inode上に実装されたプロセス間通信。シェルの「|」の基盤。
 *     読み手がいないパイプへの書き込みはSIGPIPEで通知。
 *
 * - シグナル (sig.c):
 *     V6オリジナル13シグナル。SIGKILL(9)のみ捕捉・無視不可。
 *     ワンショットセマンティクス(ハンドラ実行後デフォルトに戻る)。
 *
 * - スケジューラ (slp.c: swtch):
 *     優先度ベースのラウンドロビン。
 *     priority = cpuUsage/2 + PUSER(50) + nice。
 *     CPU使用量が減衰することで、長時間CPUを使ったプロセスの
 *     優先度が自然に下がり、対話型プロセスが応答性を維持する。
 *
 * アーキテクチャ:
 *   SimState → executeOp(op) → emit(event) + 状態変更
 *                            → snapshot() でディープコピー → V6StepResult
 *   UIは全ステップのスナップショット配列を受け取り、◀/▶で巡回する。
 *
 * ═══════════════════════════════════════════════════════════════════
 * Lions本 9章構成とコード対応表
 * ═══════════════════════════════════════════════════════════════════
 *
 * 【第1章: プロセスサブシステム】 (proc.h, user.h, slp.c, sys1.c)
 *   - proc構造体 / user構造体 → V6Process (types.ts)
 *   - 3セグメントモデル (text/data/stack) → V6Segment (types.ts)
 *   - 状態遷移 (SNULL→SRUN→SSLEEP→SZOMB) → V6ProcState (types.ts)
 *   - fork/exec/wait/exit → handleFork/Exec/Wait/Exit (本ファイル)
 *   - swtch() / setpri() → handleSchedule (本ファイル)
 *   - sleep() / wakeup() → wakeup() (本ファイル)
 *   - sbreak() (データ領域拡張) → handleBreak (本ファイル)
 *   - PDP-11 APR (Active Page Register) → seg() ヘルパー
 *
 * 【第2章: スワッピング】 (slp.c: sched, text.c: xalloc/xfree)
 *   - sched() (PID 0 swapperメインループ) → handleSched (本ファイル)
 *   - xswap() (プロセスイメージ退避) → handleSwapOut (本ファイル)
 *   - xalloc/xfree (テキスト共有) → handleXalloc/Xfree (本ファイル)
 *   - スワップマップ (dmr.c: malloc) → allocSwapSpace (本ファイル)
 *
 * 【第3章: 割り込みとトラップ】 (m40.s, trap.c, clock.c)
 *   - PDP-11ベクタ割り込み (BR4-BR7) → initInterruptVectors (本ファイル)
 *   - trap命令→sysent[]ディスパッチ → initSysent, executeOp (本ファイル)
 *   - clock() (60Hz割り込み) → handleClockTick (本ファイル)
 *   - calloutテーブル → V6CalloutEntry (types.ts)
 *   - grow() (スタック自動拡張) → handleGrow (本ファイル)
 *
 * 【第4章: シグナル】 (sig.c: psignal/issig/psig, sys1.c: ssig)
 *   - 13シグナル → V6Signal (types.ts)
 *   - signal(2) / ssig() → handleSignal (本ファイル)
 *   - kill(2) → handleKill (本ファイル)
 *   - ワンショットセマンティクス → handleKill case "catch" (本ファイル)
 *   - ptrace(2) → handlePtrace (本ファイル)
 *
 * 【第5章: ブロックI/Oサブシステム】 (bio.c, buf.h)
 *   - buf構造体 (B_READ/B_DONE/B_BUSY/B_WANTED等) → V6BufFlags (types.ts)
 *   - b-list(ハッシュ)/av-list(LRU) → bufferCache配列 (本ファイル)
 *   - getblk/bread → bufferGet (本ファイル)
 *   - brelse → bufferRelease (本ファイル)
 *   - breada (先読み) → handleBreada (本ファイル)
 *   - bwrite/bawrite/bdwrite → bufferMarkDirty (本ファイル)
 *   - bflush → handleSync (本ファイル)
 *   - bdevsw[] / strategy/start/interrupt → initBdevsw, handleDevStrategy (本ファイル)
 *   - physio (raw I/O) → handlePhysio (本ファイル)
 *
 * 【第6章: ファイルシステム】 (alloc.c, iget.c, nami.c, rdwri.c, fio.c)
 *   - ディスクレイアウト (boot/super/inode/data) → handleBoot (本ファイル)
 *   - スーパーブロック (filsys.h) → V6SuperBlock (types.ts)
 *   - alloc/free (フリーブロック連鎖) → allocBlock/freeBlock (本ファイル)
 *   - ialloc/ifree → allocInode/freeInode (本ファイル)
 *   - iget/iput (参照カウント) → iget/iput (本ファイル)
 *   - bmap (ブロックマッピング) → handleWrite内の間接ブロック処理
 *   - itrunc → freeInode内のブロック解放, handleCreat内のtruncate
 *   - namei (パス解決) → resolvePath (本ファイル)
 *   - ディレクトリ (16バイトエントリ) → V6DirEntry (types.ts)
 *   - 3層ファイルテーブル → V6FileDescriptor/V6SysFile/V6Inode (types.ts)
 *   - open/creat/close/read/write → handle* 関数群 (本ファイル)
 *   - link/unlink → handleLink/Unlink (本ファイル)
 *   - seek → handleSeek (本ファイル)
 *   - mknod → handleMknod (本ファイル)
 *   - mount/umount → handleMount/Umount (本ファイル)
 *
 * 【第7章: パイプ】 (pipe.c)
 *   - pipe() → handlePipe (本ファイル)
 *   - readp/writep → handleRead/Write内のパイプ分岐
 *   - plock/prele (排他制御) → handlePlock/Prele (本ファイル)
 *   - dup(2) → handleDup (本ファイル)
 *   - SIGPIPE (broken pipe) → handleWrite内のパイプ分岐
 *
 * 【第8章: キャラクタI/O】 (tty.c, kl.c, tty.h)
 *   - cblock/clist → V6Cblock/V6Clist (types.ts)
 *   - cdevsw[] → initCdevsw (本ファイル)
 *   - tty構造体 → V6Tty (types.ts)
 *   - ttyinput (rawq格納) → handleTtyInput (本ファイル)
 *   - canon (rawq→canq行編集) → handleTtyInput内のcanon処理
 *   - ttyoutput (タブ展開/LCASE/CRパディング) → handleTtyOutput (本ファイル)
 *   - ttread/ttwrite → handleTtyInput/Output (本ファイル)
 *   - stty/gtty → handleTtyIoctl (本ファイル)
 *   - 特殊文字 (DEL→SIGINT, FS→SIGQUIT, #=消去, @=行削除)
 *
 * 【第9章: システムブート】 (m40.s, main.c, alloc.c: iinit, bio.c: binit)
 *   - ブートブロック→カーネルロード → handleBoot冒頭 (本ファイル)
 *   - main() → handleBoot (本ファイル)
 *   - binit (バッファキャッシュ初期化) → createState (本ファイル)
 *   - iinit (スーパーブロック読込) → handleBoot内のsb初期化
 *   - プロセス0/1 → handleBoot末尾 (本ファイル)
 *   - getty→login→shell → プリセット「ブートシーケンス詳細」
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import type {
  V6Process, V6Inode, V6SuperBlock, V6Buffer, V6SysFile, V6Pipe,
  V6DiskBlock, V6Operation, V6Event, V6EventType, V6StepResult,
  V6SimResult, V6Config, V6Signal, V6DirEntry,
  V6Segment, V6TextEntry, V6SwapMapEntry, V6Tty, V6Clist,
  V6MountEntry, V6InterruptVector, V6SysEntry, V6Bdevsw, V6Cdevsw,
  V6CalloutEntry,
} from "./types.js";

import {
  V6_BLOCK_SIZE, V6_DIRECT_BLOCKS, V6_INDIRECT_START,
  V6_FILENAME_MAX, V6_NOFILE, V6_NBUF, V6_NPROC, V6_NFILE,
  V6_IFREG, V6_IFDIR, V6_IFCHR, V6_IFBLK,
} from "./types.js";

// ─── 内部状態 ───

/**
 * シミュレーション全体の可変状態。
 *
 * V6カーネルのグローバル変数群に対応する:
 * - procs     → proc[] (slp.c)    プロセステーブル
 * - inodes    → inode[] (iget.c)  インコアinode配列
 * - superblock → s (alloc.c)      マウント済みスーパーブロック
 * - bufferCache → buf[] (bio.c)   バッファキャッシュプール
 * - sysFileTable → file[] (fio.c) システムファイルテーブル
 * - pipes     → (pipe.c)          アクティブなパイプ
 * - disk      → (表示用)           ディスクブロックのメタデータ
 *
 * 各操作(executeOp)でこの状態が更新され、
 * snapshot()でディープコピーしてV6StepResultに保存する。
 */
interface SimState {
  /** プロセステーブル。V6のproc[]配列に対応。pid→プロセス情報のMap */
  procs: Map<number, V6Process>;
  /** インコアinode。ディスクから読み込まれたinodeのキャッシュ。inodeNum→inode */
  inodes: Map<number, V6Inode>;
  /** マウント済みファイルシステムのスーパーブロック */
  superblock: V6SuperBlock;
  /** バッファキャッシュプール。最大V6_NBUF(15)個 */
  bufferCache: V6Buffer[];
  /** システムファイルテーブル。全プロセスで共有されるオープンファイル情報 */
  sysFileTable: V6SysFile[];
  /** アクティブなパイプの一覧 */
  pipes: V6Pipe[];
  /** ディスクブロックのメタデータ(UI表示用) */
  disk: V6DiskBlock[];
  /** 記録されたイベントの時系列リスト */
  events: V6Event[];
  /** 次に割り当てるPID */
  nextPid: number;
  /** 次に割り当てるinode番号 */
  nextInodeNum: number;
  /** 次に割り当てるシステムファイルテーブルインデックス */
  nextSysFileIdx: number;
  /** 次に割り当てるパイプID */
  nextPipeId: number;
  /** 現在のステップ番号 */
  step: number;
  /** 論理クロック。各操作で++され、LRU管理やタイムスタンプに使用 */
  clock: number;
  /** 累積統計情報 */
  stats: V6SimResult["stats"];
  /** strace風トレースの累積リスト */
  syscallTraces: string[];
  /** コンテキストスイッチトレースの累積リスト */
  contextSwitchTraces: string[];
  /** namei（パス解決）トレースの累積リスト */
  nameiTraces: string[];
  /** プロセスメモリマップトレースの累積リスト */
  memoryMapTraces: string[];
  /** 割り込み/トラップトレースの累積リスト */
  trapTraces: string[];
  /**
   * フリーブロック連鎖リスト (alloc.c)。
   * V6ではs_free[100]が枯渇すると、先頭ブロックの中身を読んで次の100個を補充する。
   * この配列は「ディスク上に書き出された」フリーブロックバッチの連鎖を模擬する。
   */
  freeBlockChain: number[][];
  /** テキストテーブル (text.h: struct text)。共有テキストセグメント管理 */
  textTable: V6TextEntry[];
  /** スワップマップ (スワップデバイスの空き領域管理) */
  swapMap: V6SwapMapEntry[];
  /** TTYデバイステーブル */
  ttys: V6Tty[];
  /** マウントテーブル (mount.h: struct mount, NMOUNT=5) */
  mounts: V6MountEntry[];
  /** 割り込みベクタテーブル */
  interruptVectors: V6InterruptVector[];
  /** sysent[] (システムコールディスパッチテーブル) */
  sysent: V6SysEntry[];
  /** ブロックデバイススイッチテーブル */
  bdevsw: V6Bdevsw[];
  /** キャラクタデバイススイッチテーブル */
  cdevsw: V6Cdevsw[];
  /** calloutテーブル (clock.c: struct callo callout[]) */
  callouts: V6CalloutEntry[];
  /** runrunフラグ — クロック割り込みで設定、次のtrapリターンでswtch()発動 */
  runrun: boolean;
  /** 次のテキストテーブルインデックス */
  nextTextIdx: number;
}

// ─── 初期化テーブル ───

/** PDP-11 割り込みベクタテーブルを初期化 */
function initInterruptVectors(): V6InterruptVector[] {
  return [
    { address: 0o000, handler: "bus_error", priority: 7, description: "バスエラー (奇数アドレスアクセス)" },
    { address: 0o004, handler: "illegal_instr", priority: 7, description: "不正命令トラップ" },
    { address: 0o010, handler: "bpt_trap", priority: 7, description: "BPTトラップ (ptrace用)" },
    { address: 0o014, handler: "iot_trap", priority: 7, description: "IOT命令トラップ" },
    { address: 0o020, handler: "power_fail", priority: 7, description: "電源異常" },
    { address: 0o024, handler: "emt_trap", priority: 7, description: "EMT命令トラップ" },
    { address: 0o030, handler: "trap_instr", priority: 7, description: "TRAP命令 (システムコール)" },
    { address: 0o060, handler: "clock", priority: 6, description: "クロック割り込み (60Hz)" },
    { address: 0o070, handler: "clock1", priority: 6, description: "補助クロック (プロファイリング)" },
    { address: 0o100, handler: "kl11_rcv", priority: 4, description: "KL11端末受信 (コンソール)" },
    { address: 0o104, handler: "kl11_xmt", priority: 4, description: "KL11端末送信" },
    { address: 0o200, handler: "lp11", priority: 4, description: "LP11ラインプリンタ" },
    { address: 0o220, handler: "rk11", priority: 5, description: "RK11ディスク割り込み" },
    { address: 0o300, handler: "dl11_rcv", priority: 4, description: "DL11端末受信 (追加端末)" },
    { address: 0o304, handler: "dl11_xmt", priority: 4, description: "DL11端末送信" },
  ];
}

/**
 * sysent[] (システムコールディスパッチテーブル) を初期化。
 * V6のtrap()ハンドラはr0レジスタの値をインデックスとして
 * このテーブルを引き、対応するカーネル関数を呼び出す。
 * V6には約50個のシステムコールが定義されている。
 */
function initSysent(): V6SysEntry[] {
  return [
    { number: 0, name: "indir", narg: 0, handler: "nosys" },
    { number: 1, name: "exit", narg: 0, handler: "rexit" },
    { number: 2, name: "fork", narg: 0, handler: "fork" },
    { number: 3, name: "read", narg: 2, handler: "read" },
    { number: 4, name: "write", narg: 2, handler: "write" },
    { number: 5, name: "open", narg: 2, handler: "open" },
    { number: 6, name: "close", narg: 0, handler: "close" },
    { number: 7, name: "wait", narg: 0, handler: "wait" },
    { number: 8, name: "creat", narg: 2, handler: "creat" },
    { number: 9, name: "link", narg: 2, handler: "link" },
    { number: 10, name: "unlink", narg: 1, handler: "unlink" },
    { number: 11, name: "exec", narg: 2, handler: "exec" },
    { number: 12, name: "chdir", narg: 1, handler: "chdir" },
    { number: 13, name: "time", narg: 0, handler: "gtime" },
    { number: 14, name: "mknod", narg: 3, handler: "mknod" },
    { number: 15, name: "chmod", narg: 2, handler: "chmod" },
    { number: 16, name: "chown", narg: 2, handler: "chown" },
    { number: 17, name: "break", narg: 1, handler: "sbreak" },
    { number: 18, name: "stat", narg: 2, handler: "stat" },
    { number: 19, name: "seek", narg: 3, handler: "seek" },
    { number: 20, name: "getpid", narg: 0, handler: "getpid" },
    { number: 21, name: "mount", narg: 3, handler: "smount" },
    { number: 22, name: "umount", narg: 1, handler: "sumount" },
    { number: 23, name: "setuid", narg: 0, handler: "setuid" },
    { number: 24, name: "getuid", narg: 0, handler: "getuid" },
    { number: 25, name: "stime", narg: 1, handler: "stime" },
    { number: 26, name: "ptrace", narg: 3, handler: "ptrace" },
    { number: 27, name: "alarm", narg: 1, handler: "alarm" },
    { number: 28, name: "fstat", narg: 2, handler: "fstat" },
    { number: 29, name: "pause", narg: 0, handler: "pause" },
    { number: 30, name: "stty", narg: 2, handler: "stty" },
    { number: 31, name: "gtty", narg: 2, handler: "gtty" },
    { number: 33, name: "access", narg: 2, handler: "saccess" },
    { number: 34, name: "nice", narg: 1, handler: "nice" },
    { number: 35, name: "sleep", narg: 0, handler: "sslep" },
    { number: 36, name: "sync", narg: 0, handler: "sync" },
    { number: 37, name: "kill", narg: 2, handler: "kill" },
    { number: 41, name: "dup", narg: 0, handler: "dup" },
    { number: 42, name: "pipe", narg: 0, handler: "pipe" },
    { number: 46, name: "setgid", narg: 0, handler: "setgid" },
    { number: 47, name: "getgid", narg: 0, handler: "getgid" },
    { number: 48, name: "signal", narg: 2, handler: "ssig" },
  ];
}

/** bdevsw[] (ブロックデバイススイッチテーブル) を初期化 */
function initBdevsw(): V6Bdevsw[] {
  return [
    { major: 0, name: "rk", d_open: "rkopen", d_close: "nulldev", d_strategy: "rkstrategy", d_root: true },
    { major: 1, name: "rp", d_open: "rpopen", d_close: "nulldev", d_strategy: "rpstrategy", d_root: false },
    { major: 2, name: "rf", d_open: "rfopen", d_close: "nulldev", d_strategy: "rfstrategy", d_root: false },
    { major: 3, name: "tm", d_open: "tmopen", d_close: "tmclose", d_strategy: "tmstrategy", d_root: false },
  ];
}

/** cdevsw[] (キャラクタデバイススイッチテーブル) を初期化 */
function initCdevsw(): V6Cdevsw[] {
  return [
    { major: 0, name: "console", d_open: "klopen", d_close: "klclose", d_read: "klread", d_write: "klwrite", d_sgtty: "klsgtty" },
    { major: 1, name: "pc", d_open: "pcopen", d_close: "pcclose", d_read: "pcread", d_write: "pcwrite", d_sgtty: "nodev" },
    { major: 2, name: "lp", d_open: "lpopen", d_close: "lpclose", d_read: "nodev", d_write: "lpwrite", d_sgtty: "nodev" },
    { major: 3, name: "dc", d_open: "dcopen", d_close: "dcclose", d_read: "dcread", d_write: "dcwrite", d_sgtty: "dcsgtty" },
  ];
}

/** TTYを初期化 (コンソール + 端末×2) */
function initTtys(): V6Tty[] {
  const mkClist = (): V6Clist => ({ data: "", count: 0 });
  return [
    {
      device: 0, name: "/dev/console",
      rawq: mkClist(), canq: mkClist(), outq: mkClist(),
      flags: { echo: true, crmod: true, raw: false, xtabs: true, hupcl: false },
      eraseChar: "#", killChar: "@", intrChar: "\x7f", quitChar: "\x1c",
      pgrp: 0, isOpen: false, speed: 9600, column: 0, lcase: false,
    },
    {
      device: 1, name: "/dev/tty0",
      rawq: mkClist(), canq: mkClist(), outq: mkClist(),
      flags: { echo: true, crmod: true, raw: false, xtabs: true, hupcl: true },
      eraseChar: "#", killChar: "@", intrChar: "\x7f", quitChar: "\x1c",
      pgrp: 0, isOpen: false, speed: 300, column: 0, lcase: false,
    },
    {
      device: 2, name: "/dev/tty1",
      rawq: mkClist(), canq: mkClist(), outq: mkClist(),
      flags: { echo: true, crmod: true, raw: false, xtabs: true, hupcl: true },
      eraseChar: "#", killChar: "@", intrChar: "\x7f", quitChar: "\x1c",
      pgrp: 0, isOpen: false, speed: 300, column: 0, lcase: false,
    },
  ];
}

// ─── ヘルパー ───

/** シミュレーション状態を初期値で生成。ブート操作で実際のFS構造が構築される */
function createState(): SimState {
  return {
    procs: new Map(),
    inodes: new Map(),
    superblock: {
      totalBlocks: 1024, totalInodes: 256,
      freeBlockList: [], freeInodeList: [],
      freeBlockCount: 0, freeInodeCount: 0,
      modified: false, readOnly: false,
    },
    bufferCache: [],
    sysFileTable: [],
    pipes: [],
    disk: [],
    events: [],
    nextPid: 0,
    nextInodeNum: 1, // inode 1 = ルート
    nextSysFileIdx: 0,
    nextPipeId: 0,
    step: 0,
    clock: 0,
    stats: {
      totalSyscalls: 0, forkCount: 0,
      bufferHits: 0, bufferMisses: 0,
      blocksAllocated: 0, blocksFreed: 0,
      inodesAllocated: 0, inodesFreed: 0,
      contextSwitches: 0, signalsDelivered: 0,
      pipeBytesTransferred: 0,
      swapOuts: 0, swapIns: 0, textShares: 0,
      ttyInputChars: 0, ttyOutputChars: 0,
      deviceIOs: 0, permDenied: 0,
    },
    syscallTraces: [],
    contextSwitchTraces: [],
    nameiTraces: [],
    memoryMapTraces: [],
    trapTraces: [],
    freeBlockChain: [],
    textTable: [],
    swapMap: [{ addr: 0, size: 4000 }], // スワップデバイス: 4000ブロック
    ttys: initTtys(),
    mounts: [],
    interruptVectors: initInterruptVectors(),
    sysent: initSysent(),
    bdevsw: initBdevsw(),
    cdevsw: initCdevsw(),
    callouts: [],
    runrun: false,
    nextTextIdx: 0,
  };
}

/** イベントをタイムラインに記録。UIのイベントパネルに表示される */
function emit(state: SimState, type: V6EventType, message: string, extra?: Partial<V6Event>): void {
  state.events.push({ step: state.step, type, message, ...extra });
}

/**
 * strace風のシステムコールトレースを記録する。
 * 実際のstrace(1)と同じ形式でシステムコールの呼び出しと返り値を表示:
 *   [pid  2] open("/etc/motd", O_RDONLY) = 3
 *   [pid  3] fork()                     = 4
 *   [pid  2] read(3, "Hello...", 512)   = 19
 */
function strace(state: SimState, pid: number, call: string, ret: string): void {
  const padPid = String(pid).padStart(2);
  state.syscallTraces.push(`[pid ${padPid}] ${call} = ${ret}`);
}

/**
 * コンテキストスイッチトレースを記録する。
 * V6のswtch()によるプロセス切り替えを可視化する。
 */
function traceContextSwitch(state: SimState, fromPid: number, fromName: string, toPid: number, toName: string, fromPri: number, toPri: number, toCpu: number): void {
  state.contextSwitchTraces.push(
    `[clock ${String(state.clock).padStart(3)}] swtch: pid ${fromPid} (${fromName}) → pid ${toPid} (${toName}) (pri ${fromPri}→${toPri}, cpu=${toCpu})`
  );
}

/**
 * namei（パス解決）トレースを記録する。
 * V6のnamei()がディレクトリコンポーネントを辿る過程を可視化する。
 */
function traceNamei(state: SimState, path: string, steps: { name: string; ino: number }[]): void {
  const chain = steps.map(s => `"${s.name}" (ino=${s.ino})`).join(" → ");
  state.nameiTraces.push(`[namei] "${path}": ${chain}`);
}

/**
 * プロセスメモリマップトレースを記録する。
 * PDP-11のセグメンテーション方式によるメモリ配置を可視化する。
 */
function traceMemoryMap(state: SimState, pid: number, name: string, text: V6Segment, data: V6Segment, stack: V6Segment): void {
  const hex = (n: number) => "0x" + n.toString(16).padStart(4, "0");
  const segStr = (s: V6Segment) => s.size > 0 ? `${hex(s.base)}-${hex(s.base + s.size)}` : "none";
  state.memoryMapTraces.push(
    `[mem] pid ${String(pid).padStart(2)} (${name}): text=${segStr(text)} data=${segStr(data)} stack=${segStr(stack)}`
  );
}

/**
 * 割り込み/トラップトレースを記録する。
 * V6のトラップベクタとカーネル/ユーザーモード遷移を可視化する。
 */
function traceTrap(state: SimState, pid: number, syscallName: string, direction: "entry" | "return"): void {
  if (direction === "entry") {
    state.trapTraces.push(`[trap] pid ${String(pid).padStart(2)}: syscall ${syscallName}() entry → kernel mode`);
  } else {
    state.trapTraces.push(`[trap] pid ${String(pid).padStart(2)}: syscall ${syscallName}() return → user mode`);
  }
}

/** クロック割り込みトレースを記録する */
function traceClockInterrupt(state: SimState, runrun: boolean): void {
  state.trapTraces.push(`[intr] clock tick #${state.clock}${runrun ? ", runrun=1 (reschedule needed)" : ""}`);
}

/** メモリセグメント記述子を生成 (V6のu.u_tsize等に相当) */
function seg(base: number, size: number): V6Segment {
  return { base, size };
}

/** inodeのモードビットをls -l形式の文字列に変換 (例: "drwxr-xr-x") */
function modeStr(mode: number): string {
  const t = (mode & 0o170000) === V6_IFDIR ? "d" : "-";
  const rwx = (m: number) =>
    ((m & 4) ? "r" : "-") + ((m & 2) ? "w" : "-") + ((m & 1) ? "x" : "-");
  return t + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

/** 空きfdを探す */
function allocFd(proc: V6Process): number {
  for (let i = 0; i < V6_NOFILE; i++) {
    if (proc.openFiles[i] === null) return i;
  }
  return -1;
}

// ─── inode/ブロック管理 ───
// alloc.c に実装されているフリーリスト管理。
//
// ■ フリーブロック管理 (連鎖方式):
//   スーパーブロックに最大100個のフリーブロック番号を保持する。
//   alloc()でリスト末尾からpop。リストが空になったら
//   先頭ブロック(s_free[0])が指すブロックを読み込み、
//   その中に格納された次の100個のフリーブロック番号をロードする。
//   free()ではリストが満杯(100個)なら現在のリスト全体を
//   フリーブロックに書き出して新しいチェーンリンクを作る。
//
// ■ フリーinode管理 (キャッシュ方式):
//   スーパーブロックに最大100個のフリーinode番号をキャッシュ。
//   ialloc()でキャッシュからpop。空になったらinode領域を
//   先頭から線形走査(remembered inode以降)して補充する。
//   ifree()ではキャッシュに追加。満杯なら捨てる
//   (次の走査で再発見されるので問題ない)。
//
// この非対称な設計(ブロック=連鎖、inode=走査)はV6の特徴的な部分で、
// ブロック割当の高速性とinode管理の簡潔さを両立している。

/**
 * 新しいinodeを割り当てる (alloc.c: ialloc)。
 *
 * アルゴリズム:
 * 1. フリーinodeリストにエントリがあればpop
 * 2. なければ連番で新規割当(実機ではinode走査で補充)
 * 3. 32バイトのinode構造体を初期化(mode, nlink=1, addr[13]=0, etc.)
 * 4. ディスク上のinodeブロック位置を計算して記録
 *    (1ブロック = 16 inodes × 32バイト = 512バイト)
 */
function allocInode(state: SimState, mode: number): V6Inode {
  let num: number;
  if (state.superblock.freeInodeList.length > 0) {
    num = state.superblock.freeInodeList.shift()!;
  } else {
    // フリーリストが空の場合、使用中でない番号を探す (ialloc走査相当)
    num = state.nextInodeNum++;
    while (state.inodes.has(num)) {
      num = state.nextInodeNum++;
    }
  }
  const inode: V6Inode = {
    inodeNum: num, mode, nlink: 1, uid: 0, gid: 0, size: 0,
    addr: Array(13).fill(0), refCount: 1,
    atime: state.clock, mtime: state.clock,
  };
  state.inodes.set(num, inode);
  state.superblock.freeInodeCount--;
  state.superblock.modified = true;
  state.stats.inodesAllocated++;
  emit(state, "inode_alloc", `inode#${num} 割当 (${modeStr(mode)})`, { inodeNum: num });
  // ディスク上のinodeブロックを記録
  const blk = Math.floor(num / 16) + 2; // ブロック2からinodeテーブル開始
  ensureDiskBlock(state, blk, "inode", `inode block (inode ${Math.floor(num / 16) * 16}-${Math.floor(num / 16) * 16 + 15})`);
  return inode;
}

/** inode解放。所有ブロックもすべて解放し、フリーリストに戻す。V6のifree()相当 */
function freeInode(state: SimState, inodeNum: number): void {
  const inode = state.inodes.get(inodeNum);
  if (!inode) return;
  // ブロック解放 (iget.c: itrunc相当)
  // 直接ブロック解放
  for (let i = 0; i < V6_DIRECT_BLOCKS; i++) {
    if (inode.addr[i] !== 0) {
      freeBlock(state, inode.addr[i]);
      inode.addr[i] = 0;
    }
  }
  // 間接ブロック: 配下のデータブロックを先に解放してから間接ブロック自体を解放
  for (let i = V6_DIRECT_BLOCKS; i < 13; i++) {
    if (inode.addr[i] !== 0) {
      const indDisk = state.disk.find(b => b.blockNum === inode.addr[i]);
      if (indDisk && indDisk.content.startsWith("indirect:")) {
        const refs = indDisk.content.replace("indirect:", "").split(",").filter(Boolean).map(Number);
        for (const ref of refs) {
          if (ref !== 0) freeBlock(state, ref);
        }
        emit(state, "syscall", `itrunc: 間接ブロック#${inode.addr[i]}配下の${refs.length}データブロック解放`, { inodeNum });
      }
      freeBlock(state, inode.addr[i]);
      inode.addr[i] = 0;
    }
  }
  state.inodes.delete(inodeNum);
  state.superblock.freeInodeList.push(inodeNum);
  state.superblock.freeInodeCount++;
  state.superblock.modified = true;
  state.stats.inodesFreed++;
  emit(state, "inode_free", `inode#${inodeNum} 解放`, { inodeNum });
}

/**
 * データブロック割当。V6のalloc() (alloc.c) 相当。
 *
 * s_free[]からpop。リストが空になったら連鎖ブロックから次の100個を補充する。
 * V6実機ではs_free[0]に格納されたブロック番号のディスクブロックを読み、
 * その中身（次の100個のフリーブロック番号）をs_free[]にコピーする。
 */
function allocBlock(state: SimState): number {
  const sb = state.superblock;
  // s_freeが空の場合、連鎖ブロックから次のバッチを補充
  if (sb.freeBlockList.length === 0 && state.freeBlockChain.length > 0) {
    const nextBatch = state.freeBlockChain.shift()!;
    sb.freeBlockList = nextBatch;
    emit(state, "block_alloc", `フリーブロック連鎖読込: ${nextBatch.length}個補充`, {
      detail: `連鎖バッチ読込 (alloc.c: s_nfree==0 → ディスクから次の${nextBatch.length}ブロック番号をロード)`,
    });
  }
  let blk: number;
  if (sb.freeBlockList.length > 0) {
    blk = sb.freeBlockList.shift()!;
  } else {
    // フリーブロック完全枯渇 — V6ではENOSPCだが、シミュレーション用にフォールバック
    blk = 2 + Math.ceil(sb.totalInodes / 16) + state.stats.blocksAllocated;
  }
  sb.freeBlockCount--;
  sb.modified = true;
  state.stats.blocksAllocated++;
  ensureDiskBlock(state, blk, "data", `data block #${blk}`);
  emit(state, "block_alloc", `ブロック#${blk} 割当`, { blockNum: blk });
  return blk;
}

/**
 * ブロック解放。V6のfree() (alloc.c) 相当。
 *
 * s_free[]が100個に達している場合、現在のリストを解放するブロックに書き出し、
 * リストをリセットして新しい連鎖リンクを作成する。
 */
function freeBlock(state: SimState, blockNum: number): void {
  const sb = state.superblock;
  // s_freeが100個満杯なら、現在のリストを連鎖ブロックとして退避
  if (sb.freeBlockList.length >= 100) {
    state.freeBlockChain.unshift([...sb.freeBlockList]);
    emit(state, "block_free", `フリーブロック連鎖書出: ${sb.freeBlockList.length}個をブロック#${blockNum}に退避`, {
      detail: `連鎖バッチ書出 (alloc.c: s_nfree==100 → 現在のs_free[]をディスクに書き出し)`,
    });
    sb.freeBlockList = [];
  }
  sb.freeBlockList.push(blockNum);
  sb.freeBlockCount++;
  sb.modified = true;
  state.stats.blocksFreed++;
  // ディスク上のタイプを更新
  const db = state.disk.find(d => d.blockNum === blockNum);
  if (db) db.type = "free";
  emit(state, "block_free", `ブロック#${blockNum} 解放`, { blockNum });
}

/** ディスクブロックのメタデータを登録/更新。UI表示用のディスクレイアウトを構築する */
function ensureDiskBlock(state: SimState, blockNum: number, type: V6DiskBlock["type"], content: string): void {
  const existing = state.disk.find(d => d.blockNum === blockNum);
  if (existing) {
    existing.type = type;
    existing.content = content;
  } else {
    state.disk.push({ blockNum, content, type });
    state.disk.sort((a, b) => a.blockNum - b.blockNum);
  }
}

// ─── バッファキャッシュ ───
// bio.c に実装されているブロックI/Oバッファリング層。
// V6のすべてのディスクアクセスはこのキャッシュを経由する。
//
// ■ 設計の要点 (Dennis Ritchieの設計):
//   - NBUF(=15)個の固定バッファプール
//   - 各バッファはdevice+blockNumの組み合わせでインデックスされる
//   - V6実機ではハッシュチェーン(b_forw/b_back)で高速検索、
//     AVリスト(av_forw/av_back)でLRU管理の二重連結リスト構造
//   - このシミュレータでは配列+lastAccessフィールドで簡易化
//
// ■ getblk()のアルゴリズム (bio.c):
//   1. ハッシュチェーンを検索 → ヒットならbusyフラグを立てて返す
//   2. ミスならAVリスト末尾(最古)から非busyバッファを取得
//   3. そのバッファがdirtyなら先にディスクに書き戻す
//   4. バッファを新しいdevice+blockNumで初期化して返す
//
// ■ bread/bwrite/bdwrite:
//   - bread: getblk + ディスク読み込み
//   - bwrite: バッファに書き込み + 即座にディスク書き出し
//   - bdwrite (delayed write): dirtyフラグを立てるだけ(遅延書き込み)
//     → V6のwrite(2)はbdwriteを使い、sync(2)でフラッシュする
//
// この遅延書き込み設計により書き込みパフォーマンスが大幅に向上するが、
// クラッシュ時にデータが失われるリスクがある(V6は30秒ごとにsyncを実行)。

/**
 * バッファキャッシュからブロックを取得する (bio.c: getblk)。
 *
 * アルゴリズム:
 * 1. キャッシュ内をdevice+blockNumで検索
 * 2. ヒット: lastAccessを更新、busyフラグを立てて返す
 * 3. ミス: キャッシュが満杯なら非busyバッファの中で最もlastAccessが古いものを選択
 *    3a. そのバッファがdirtyなら書き戻しイベントを発火
 *    3b. バッファをエビクトして新しいエントリを作成
 * 4. 新規バッファをキャッシュに追加して返す
 */
function bufferGet(state: SimState, device: number, blockNum: number, context?: string): V6Buffer {
  // キャッシュ内を検索
  const found = state.bufferCache.find(b => b.device === device && b.blockNum === blockNum);
  if (found) {
    // V6 bio.c: バッファがbusyなら B_WANTED を立てて sleep(&buf)
    if (found.flags.busy) {
      found.flags.wanted = true;
      emit(state, "buf_sleep", `バッファビジー待ち: dev=${device} blk=${blockNum} (B_WANTED, sleep)`, {
        blockNum,
        detail: `bio.c: getblk() → B_BUSY → sleep(&buf) B_WANTED`,
      });
    }
    found.lastAccess = state.clock;
    found.flags.busy = true;
    state.stats.bufferHits++;
    emit(state, "buf_hit", `バッファヒット: dev=${device} blk=${blockNum}`, {
      blockNum,
      detail: context ? `${context}: バッファヒット blk=${blockNum}` : undefined,
    });
    return found;
  }

  state.stats.bufferMisses++;
  emit(state, "buf_miss", `バッファミス: dev=${device} blk=${blockNum}`, { blockNum });

  // キャッシュに空きがない場合、LRUをエビクト
  if (state.bufferCache.length >= V6_NBUF) {
    const nonBusy = state.bufferCache
      .filter(b => !b.flags.busy)
      .sort((a, b) => a.lastAccess - b.lastAccess);
    if (nonBusy.length > 0) {
      const victim = nonBusy[0];
      if (victim.flags.dirty) {
        emit(state, "buf_writeback", `バッファ書き戻し: dev=${victim.device} blk=${victim.blockNum}`, { blockNum: victim.blockNum });
      }
      emit(state, "buf_evict", `バッファエビクト: dev=${victim.device} blk=${victim.blockNum}`, { blockNum: victim.blockNum });
      state.bufferCache = state.bufferCache.filter(b => b !== victim);
    }
  }

  // 新しいバッファを作成
  const diskBlk = state.disk.find(d => d.blockNum === blockNum);
  const buf: V6Buffer = {
    device, blockNum,
    data: diskBlk?.content ?? `block ${blockNum}`,
    flags: { valid: true, dirty: false, busy: true, wanted: false },
    lastAccess: state.clock,
  };
  state.bufferCache.push(buf);
  return buf;
}

/**
 * バッファを解放してbusyフラグをクリア。V6のbrelse() (bio.c) 相当。
 * B_WANTEDフラグが立っていればwakeup(&buf)で待機プロセスを起床させる。
 */
function bufferRelease(state: SimState, buf: V6Buffer): void {
  if (buf.flags.wanted) {
    buf.flags.wanted = false;
    emit(state, "buf_wakeup", `バッファ解放→wakeup: dev=${buf.device} blk=${buf.blockNum} (B_WANTED)`, {
      blockNum: buf.blockNum,
      detail: `bio.c: brelse() → B_WANTED → wakeup(&buf)`,
    });
  }
  buf.flags.busy = false;
}

/**
 * V6のwakeup(chan) (slp.c) 相当。
 * プロセステーブル全体をスキャンし、指定チャネルでsleep中の全プロセスをreadyにする。
 * V6の特徴: thundering herd — 1つだけでなく全プロセスを起床させる。
 * これは単純だが非効率で、起床した全プロセスがリソースを再確認する必要がある。
 */
function wakeup(state: SimState, channel: string): void {
  let wokenCount = 0;
  for (const [, proc] of state.procs) {
    if (proc.state === "sleeping" && proc.waitChannel === channel) {
      proc.state = "ready";
      proc.waitChannel = "";
      wokenCount++;
    }
  }
  emit(state, "syscall", `wakeup("${channel}"): ${wokenCount}プロセス起床 (slp.c thundering herd)`, {
    detail: `slp.c: wakeup(chan) → proc[]全スキャン → ${wokenCount}プロセスを SSLEEP→SRUN`,
  });
}

/** バッファにdirtyフラグを立てる。sync時またはエビクト時にディスクへ書き戻される */
function bufferMarkDirty(buf: V6Buffer): void {
  buf.flags.dirty = true;
}

// ─── パス解決 ───
// nami.c に実装されているパス名→inode番号の変換。
// V6のnamei()はカーネルで最もよく呼ばれる関数の一つで、
// open, creat, stat, chdir, exec等のファイル関連システムコールから呼ばれる。
//
// ■ アルゴリズム:
//   1. パスが"/"で始まれば絶対パス(ルートinode#1から開始)
//      そうでなければ相対パス(u.u_cdirから開始)
//   2. パスを"/"で分割してコンポーネント列に変換
//      例: "/usr/src/sys/main.c" → ["usr", "src", "sys", "main.c"]
//   3. 各コンポーネントについて:
//      a. 現在のinodeがディレクトリか確認
//      b. ディレクトリのデータブロックを読み、16バイトエントリを線形探索
//      c. 一致するエントリがあればそのinode番号を取得
//      d. なければエラー
//   4. 最後のコンポーネントのinode番号を返す
//
// ■ V6の面白い特徴:
//   - ".."のハードコーディングなし。単なるディレクトリエントリとして処理
//   - シンボリックリンクは存在しない(BSD 4.2で導入)
//   - パス長の制限なし(各コンポーネントは14文字以下)

/**
 * パス名をinode番号に解決する (nami.c: namei)。
 *
 * 絶対パスはinode#1(ルート)から、相対パスはcwdInodeから開始。
 * 各コンポーネントでdir_lookupイベントを発火し、
 * UIでパス解決の過程(/ → usr → src → sys → main.c)をステップごとに観察できる。
 */
function resolvePath(state: SimState, path: string, cwdInode: number): number {
  const isAbsolute = path.startsWith("/");
  let currentInode = isAbsolute ? 1 : cwdInode; // inode 1 = ルート

  const components = path.split("/").filter(c => c.length > 0);
  if (components.length === 0) return currentInode;

  emit(state, "path_resolve", `パス解決: "${path}" (${isAbsolute ? "絶対" : "相対"}パス)`);

  // nameiトレース: コンポーネント毎の解決過程を記録
  const nameiSteps: { name: string; ino: number }[] = [
    { name: isAbsolute ? "/" : `[cwd:${cwdInode}]`, ino: currentInode },
  ];

  for (const comp of components) {
    const dir = state.inodes.get(currentInode);
    if (!dir || (dir.mode & 0o170000) !== V6_IFDIR) {
      emit(state, "error", `パス解決エラー: inode#${currentInode} はディレクトリでない`);
      return -1;
    }

    const entry = lookupDir(state, currentInode, comp);
    if (entry < 0) {
      emit(state, "error", `パス解決エラー: "${comp}" が見つからない (inode#${currentInode})`);
      return -1;
    }
    emit(state, "dir_lookup", `dir_lookup: "${comp}" → inode#${entry} (in inode#${currentInode})`, { inodeNum: entry });
    nameiSteps.push({ name: comp, ino: entry });
    currentInode = entry;
  }

  // パス解決完了時にnameiトレースを記録
  traceNamei(state, path, nameiSteps);

  return currentInode;
}

/**
 * ディレクトリ内のエントリを名前で検索し、対応するinode番号を返す。
 * V6ではディレクトリは16バイト固定長エントリ(2バイトinode+14バイトファイル名)の列。
 * 線形探索で一致するエントリを探す。
 */
function lookupDir(state: SimState, dirInode: number, name: string): number {
  const inode = state.inodes.get(dirInode);
  if (!inode) return -1;

  // ディレクトリのデータブロックからエントリを探す
  for (let i = 0; i < V6_DIRECT_BLOCKS; i++) {
    if (inode.addr[i] === 0) continue;
    // getDirEntriesがバッファキャッシュ経由でブロックを読むため、
    // lookupDirでは直接bufferGetを呼ばない (二重取得防止)
    const entries = getDirEntries(state, dirInode);
    for (const e of entries) {
      if (e.name === name) return e.inode;
    }
    break; // エントリはgetDirEntriesで全取得済み
  }
  return -1;
}

/**
 * ディレクトリのエントリ一覧を取得。
 * V6のnamei() (nami.c) に倣い、ディレクトリのデータブロックを
 * バッファキャッシュ (bread) 経由で読み込む。
 * ディスクブロックの内容を "dir:name1=ino1,name2=ino2,..." 形式で保持し、
 * それをパースしてV6DirEntry配列を返す。
 */
function getDirEntries(state: SimState, dirInode: number): V6DirEntry[] {
  const inode = state.inodes.get(dirInode);
  if (!inode) return [];
  const entries: V6DirEntry[] = [];
  for (let i = 0; i < V6_DIRECT_BLOCKS; i++) {
    if (inode.addr[i] === 0) continue;
    // バッファキャッシュ経由でディレクトリブロックを読込 (nami.c: bread)
    const buf = bufferGet(state, 0, inode.addr[i], "namei");
    const content = buf.data;
    bufferRelease(state, buf);
    if (typeof content === "string" && content.startsWith("dir:")) {
      const parts = content.slice(4).split(",");
      for (const p of parts) {
        const [n, ino] = p.split("=");
        if (n && ino) entries.push({ name: n, inode: parseInt(ino) });
      }
    }
  }
  return entries;
}

/**
 * ディレクトリにエントリを追加。V6のwdir()相当。
 * ファイル名はV6_FILENAME_MAX(14文字)で切り詰められる。
 * 既存のデータブロックに追記するか、新しいブロックを割り当てる。
 * 1エントリ = 16バイト (2バイトinode番号 + 14バイトファイル名)
 */
function addDirEntry(state: SimState, dirInode: number, name: string, childInode: number): void {
  const inode = state.inodes.get(dirInode);
  if (!inode) return;

  const truncName = name.slice(0, V6_FILENAME_MAX);

  // 既存のデータブロックに追加
  let added = false;
  for (let i = 0; i < V6_DIRECT_BLOCKS && !added; i++) {
    if (inode.addr[i] === 0) {
      // 新しいブロックを割当
      inode.addr[i] = allocBlock(state);
      ensureDiskBlock(state, inode.addr[i], "data", `dir:${truncName}=${childInode}`);
      added = true;
    } else {
      const db = state.disk.find(d => d.blockNum === inode.addr[i]);
      if (db && db.content.startsWith("dir:")) {
        db.content += `,${truncName}=${childInode}`;
        added = true;
        const buf = bufferGet(state, 0, inode.addr[i]);
        buf.data = db.content;
        bufferMarkDirty(buf);
        bufferRelease(state, buf);
      }
    }
  }

  inode.size += 16; // 1エントリ = 16バイト
  inode.mtime = state.clock;
  emit(state, "dir_add", `ディレクトリエントリ追加: "${truncName}" → inode#${childInode} (in inode#${dirInode})`, { inodeNum: dirInode });
}

/** ディレクトリからエントリを削除。該当エントリをフィルタで除去しブロックを更新する */
function removeDirEntry(state: SimState, dirInode: number, name: string): void {
  const inode = state.inodes.get(dirInode);
  if (!inode) return;

  for (let i = 0; i < V6_DIRECT_BLOCKS; i++) {
    if (inode.addr[i] === 0) continue;
    const db = state.disk.find(d => d.blockNum === inode.addr[i]);
    if (db && db.content.startsWith("dir:")) {
      const parts = db.content.slice(4).split(",");
      const filtered = parts.filter(p => !p.startsWith(name + "="));
      db.content = "dir:" + filtered.join(",");
      const buf = bufferGet(state, 0, inode.addr[i]);
      buf.data = db.content;
      bufferMarkDirty(buf);
      bufferRelease(state, buf);
    }
  }

  inode.size = Math.max(0, inode.size - 16);
  inode.mtime = state.clock;
  emit(state, "dir_remove", `ディレクトリエントリ削除: "${name}" (from inode#${dirInode})`, { inodeNum: dirInode });
}

// ─── プロセス管理 ───
// proc.h/slp.c/sys1.c に実装されているプロセス管理。
//
// ■ V6のプロセスモデル:
//   fork() → exec() → exit() → wait() の4つのシステムコールが中核。
//   この設計は「プロセス複製」と「イメージ置換」を分離している点が画期的で、
//   シェルスクリプトやパイプラインを自然に実装できる基盤となった。
//
// ■ 状態遷移:
//   embryo → ready → running → zombie
//                ↑       ↓
//                ready ← sleeping (I/O待ち、wait等)
//                ↑       ↓
//                ←── swapped (メモリ不足時)
//
// ■ fork()の動作:
//   1. 空きプロセステーブルスロットを探す
//   2. 親プロセスのメモリイメージをフルコピー(V6にはCoWなし)
//   3. ファイルディスクリプタをコピーし、各sysfileのrefCount++
//   4. 子プロセスを"ready"状態にする
//   ※ BSDのvfork()(1979)やLinuxのCopy-on-Write(1991)は後の改良
//
// ■ exec()の動作:
//   1. パスを解決して実行ファイルのinodeを取得
//   2. a.outヘッダを読んでテキスト/データサイズを取得
//   3. プロセスのメモリイメージを新しい実行ファイルで置換
//   4. シグナルハンドラをデフォルトにリセット
//   5. argv/envpをスタックに配置

/** プロセステーブルに新しいエントリを作成。初期状態は"embryo" */
function createProcess(state: SimState, name: string, ppid: number, uid: number): V6Process {
  const pid = state.nextPid++;
  const proc: V6Process = {
    pid, ppid, uid, gid: uid,
    state: "embryo", name,
    priority: 60, nice: 0, cpuUsage: 0,
    waitChannel: "", exitCode: 0,
    textSeg: seg(0, 0), dataSeg: seg(0, 0), stackSeg: seg(0, 0),
    openFiles: Array(V6_NOFILE).fill(null),
    pendingSignals: [], signalHandlers: {},
    traced: false,
    execPath: "", argv: [], cwd: 1,
  };
  state.procs.set(pid, proc);
  return proc;
}

// ─── 命令実行 ───

/** 操作を1つ実行し、結果メッセージを返す。clockを進めてから各ハンドラに委譲する */
function executeOp(state: SimState, op: V6Operation): string {
  state.clock++;

  switch (op.op) {
    case "boot": return handleBoot(state);
    case "fork": return handleFork(state, op);
    case "exec": return handleExec(state, op);
    case "wait": return handleWait(state, op);
    case "exit": return handleExit(state, op);
    case "open": return handleOpen(state, op);
    case "creat": return handleCreat(state, op);
    case "close": return handleClose(state, op);
    case "read": return handleRead(state, op);
    case "write": return handleWrite(state, op);
    case "link": return handleLink(state, op);
    case "unlink": return handleUnlink(state, op);
    case "chdir": return handleChdir(state, op);
    case "stat": return handleStat(state, op);
    case "chmod": return handleChmod(state, op);
    case "mkdir": return handleMkdir(state, op);
    case "pipe": return handlePipe(state, op);
    case "dup": return handleDup(state, op);
    case "signal": return handleSignal(state, op);
    case "kill": return handleKill(state, op);
    case "schedule": return handleSchedule(state);
    case "nice": return handleNice(state, op);
    case "sync": return handleSync(state);
    case "swap_out": return handleSwapOut(state, op);
    case "swap_in": return handleSwapIn(state, op);
    case "xalloc": return handleXalloc(state, op);
    case "xfree": return handleXfree(state, op);
    case "tty_input": return handleTtyInput(state, op);
    case "tty_output": return handleTtyOutput(state, op);
    case "tty_ioctl": return handleTtyIoctl(state, op);
    case "dev_strategy": return handleDevStrategy(state, op);
    case "dev_interrupt": return handleDevInterrupt(state, op);
    case "mount": return handleMount(state, op);
    case "umount": return handleUmount(state, op);
    case "break": return handleBreak(state, op);
    case "seek": return handleSeek(state, op);
    case "mknod": return handleMknod(state, op);
    case "ptrace": return handlePtrace(state, op);
    case "grow": return handleGrow(state, op);
    case "breada": return handleBreada(state, op);
    case "physio": return handlePhysio(state, op);
    case "plock": return handlePlock(state, op);
    case "prele": return handlePrele(state, op);
    case "sched": return handleSched(state);
    case "clock_tick": return handleClockTick(state);
    case "comment": {
      emit(state, "comment", op.text);
      return op.text;
    }
  }
}

// ─── ブート ───

/**
 * Unix V6ブートシーケンスをシミュレート。
 * 1. スーパーブロック初期化 (フリーブロック/inodeリスト構築)
 * 2. ルートinode(#1)とディレクトリ構造(/dev,/etc,/bin,/tmp,/usr)作成
 * 3. 基本実行ファイル(/etc/init, /etc/rc, /bin/sh等)配置
 * 4. PID 0(swapper)とPID 1(init)を起動
 * V6実機ではブートブロック→カーネルロード→main()の流れだが、
 * ここではFS初期化とプロセス起動をまとめて行う。
 */
function handleBoot(state: SimState): string {
  emit(state, "boot", "Unix V6 ブートシーケンス開始");

  // スーパーブロック初期化
  const sb = state.superblock;
  sb.totalBlocks = 1024;
  sb.totalInodes = 256;
  // フリーブロックリスト — V6連鎖方式 (alloc.c: s_free[100])
  // ブロック割当順: dataStart+10 から sb.totalBlocks-1 まで
  // 最初の100個はs_freeに、残りは100個ずつ連鎖ブロックに格納
  const dataStart = 2 + Math.ceil(sb.totalInodes / 16); // block 0=boot, 1=superblock, 2~=inode
  const allFreeBlocks: number[] = [];
  for (let i = dataStart + 10; i < sb.totalBlocks; i++) {
    allFreeBlocks.push(i);
  }
  // 先頭100個（またはそれ以下）をスーパーブロックのs_freeに
  sb.freeBlockList = allFreeBlocks.splice(0, 100);
  // 残りを100個ずつ連鎖バッチに格納
  while (allFreeBlocks.length > 0) {
    state.freeBlockChain.push(allFreeBlocks.splice(0, 100));
  }
  sb.freeBlockCount = sb.freeBlockList.length +
    state.freeBlockChain.reduce((sum, batch) => sum + batch.length, 0);
  // フリーinodeリスト（inode 10以降をフリーに）
  for (let i = 10; i < 110; i++) {
    sb.freeInodeList.push(i);
  }
  sb.freeInodeCount = sb.freeInodeList.length;

  ensureDiskBlock(state, 0, "superblock", "boot block");
  ensureDiskBlock(state, 1, "superblock", "superblock: 1024blk, 256inode");
  emit(state, "superblock_read", `スーパーブロック読込: ${sb.totalBlocks}ブロック, ${sb.totalInodes} inode`);

  // ルートinode (inode#1) — V6ではinode#1がルートディレクトリ
  // allocInodeはフリーリストから番号を取るため、直接inode#1として構築する
  const rootInode: V6Inode = {
    inodeNum: 1, mode: V6_IFDIR | 0o755, nlink: 1, uid: 0, gid: 0, size: 0,
    addr: Array(13).fill(0), refCount: 1,
    atime: state.clock, mtime: state.clock,
  };
  state.inodes.set(1, rootInode);
  state.stats.inodesAllocated++;
  emit(state, "inode_alloc", `inode#1 割当 (${modeStr(V6_IFDIR | 0o755)})`, { inodeNum: 1 });
  ensureDiskBlock(state, Math.floor(1 / 16) + 2, "inode", `inode block (inode 0-15)`);
  // ルートディレクトリにデフォルトエントリ
  const rootBlk = allocBlock(state);
  rootInode.addr[0] = rootBlk;
  ensureDiskBlock(state, rootBlk, "data", "dir:.=1,..=1");
  rootInode.size = 32;

  // /dev, /etc, /bin, /tmp, /usr ディレクトリ作成
  const dirs = ["dev", "etc", "bin", "tmp", "usr"];
  for (const d of dirs) {
    const dirInode = allocInode(state, V6_IFDIR | 0o755);
    const dirBlk = allocBlock(state);
    dirInode.addr[0] = dirBlk;
    ensureDiskBlock(state, dirBlk, "data", `dir:.=${dirInode.inodeNum},..=1`);
    dirInode.size = 32;
    addDirEntry(state, 1, d, dirInode.inodeNum);
  }

  // /etc/init, /etc/rc, /bin/sh を通常ファイルとして作成
  const etcIno = lookupDir(state, 1, "etc");
  const binIno = lookupDir(state, 1, "bin");
  if (etcIno > 0) {
    const initFile = allocInode(state, V6_IFREG | 0o755);
    addDirEntry(state, etcIno, "init", initFile.inodeNum);
    const rcFile = allocInode(state, V6_IFREG | 0o644);
    addDirEntry(state, etcIno, "rc", rcFile.inodeNum);
  }
  if (binIno > 0) {
    // V6の/binに含まれる主要コマンド群
    const binCmds = ["sh", "ls", "cat", "cp", "mv", "mkdir", "rm", "ln",
                     "chmod", "echo", "grep", "wc", "ed", "od", "dd"];
    for (const cmd of binCmds) {
      const file = allocInode(state, V6_IFREG | 0o755);
      addDirEntry(state, binIno, cmd, file.inodeNum);
    }
  }

  // カーネルプロセス (PID 0: swapper)
  const swapper = createProcess(state, "swapper", 0, 0);
  swapper.state = "running";
  swapper.execPath = "[kernel]";
  swapper.textSeg = seg(0x0000, 0x2000);
  swapper.dataSeg = seg(0x2000, 0x1000);

  // initプロセス (PID 1)
  const init = createProcess(state, "init", 0, 0);
  init.state = "ready";
  init.execPath = "/etc/init";
  init.textSeg = seg(0x4000, 0x1000);
  init.dataSeg = seg(0x5000, 0x0800);
  init.stackSeg = seg(0xF000, 0x0400);
  emit(state, "init_start", "initプロセス (PID 1) 起動", { pid: 1 });
  // ブート時のメモリマップトレース
  traceMemoryMap(state, swapper.pid, swapper.name, swapper.textSeg, swapper.dataSeg, swapper.stackSeg);
  traceMemoryMap(state, init.pid, init.name, init.textSeg, init.dataSeg, init.stackSeg);

  state.nextInodeNum = Math.max(state.nextInodeNum, ...Array.from(state.inodes.keys())) + 1;

  return "Unix V6 ブート完了";
}

// ─── プロセス系 ───

/**
 * fork: 親プロセスを複製して子プロセスを作成。V6のfork()相当。
 * - メモリセグメントをフルコピー(V6にはCopy-on-Writeなし)
 * - ファイルディスクリプタをコピーし、システムファイルテーブルのrefCount++
 * - cwd(カレントディレクトリ)を継承
 */
function handleFork(state: SimState, op: { parentPid: number; childName: string }): string {
  state.stats.totalSyscalls++;
  const parent = state.procs.get(op.parentPid);
  if (!parent) {
    emit(state, "error", `fork失敗: PID ${op.parentPid} が存在しない`);
    return `fork失敗: PID ${op.parentPid} が存在しない`;
  }

  // V6仕様: proc[]はNPROC(=50)の固定長配列。満杯ならEAGAIN (proc.h)
  if (state.procs.size >= V6_NPROC) {
    emit(state, "error", `fork失敗: プロセステーブル満杯 (NPROC=${V6_NPROC}) EAGAIN`, { pid: op.parentPid });
    strace(state, op.parentPid, `fork()`, `-1 EAGAIN`);
    return `fork失敗: EAGAIN (proc table full)`;
  }

  const child = createProcess(state, op.childName, parent.pid, parent.uid);
  child.state = "ready";
  child.cwd = parent.cwd;
  // V6仕様: テキストセグメントは親子で共有 (text.h: x_count++, sys1.c)
  // データ/スタックはフルコピーされるが、テキスト（コード領域）は同じアドレスを参照
  child.textSeg = { base: parent.textSeg.base, size: parent.textSeg.size };
  child.dataSeg = { ...parent.dataSeg };
  child.stackSeg = { ...parent.stackSeg };
  child.execPath = parent.execPath;
  child.argv = [...parent.argv];
  // ファイルディスクリプタをコピー（refCount++）
  for (let i = 0; i < V6_NOFILE; i++) {
    if (parent.openFiles[i]) {
      child.openFiles[i] = { fd: parent.openFiles[i]!.fd, sysFileIdx: parent.openFiles[i]!.sysFileIdx };
      const sf = state.sysFileTable.find(f => f.index === parent.openFiles[i]!.sysFileIdx);
      if (sf) sf.refCount++;
    }
  }
  state.stats.forkCount++;
  emit(state, "fork", `fork: PID ${parent.pid} (${parent.name}) → PID ${child.pid} (${child.name})`, {
    pid: child.pid,
    detail: `テキストセグメント共有: base=0${parent.textSeg.base.toString(8)} size=${parent.textSeg.size} (text.h: x_count++)`,
  });
  emit(state, "syscall", `sys_fork() → 子PID ${child.pid}`, { pid: parent.pid });
  // トラップ/メモリマップトレース
  traceTrap(state, parent.pid, "fork", "entry");
  traceMemoryMap(state, child.pid, child.name, child.textSeg, child.dataSeg, child.stackSeg);
  traceTrap(state, parent.pid, "fork", "return");
  strace(state, parent.pid, `fork()`, `${child.pid}`);
  return `fork: ${parent.name}(${parent.pid}) → ${child.name}(${child.pid})`;
}

/**
 * exec: プロセスイメージを新しい実行ファイルに置換。V6のexec()相当。
 * - パスを解決して実行ファイルのinodeを取得
 * - テキスト/データ/スタックセグメントを再配置
 * - シグナルハンドラをデフォルトにリセット(V6のexec仕様)
 * - ファイルディスクリプタは保持される(close-on-exec未実装)
 */
function handleExec(state: SimState, op: { pid: number; path: string; argv: string[] }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `exec失敗: PID ${op.pid} が存在しない`);
    return `exec失敗`;
  }

  // パス解決
  const inodeNum = resolvePath(state, op.path, proc.cwd);
  if (inodeNum < 0) {
    emit(state, "error", `exec失敗: "${op.path}" が見つからない`, { pid: op.pid });
    return `exec失敗: "${op.path}" not found`;
  }

  const inode = state.inodes.get(inodeNum);
  if (!inode || (inode.mode & 0o170000) !== V6_IFREG) {
    emit(state, "error", `exec失敗: "${op.path}" は実行可能ファイルでない`, { pid: op.pid });
    return `exec失敗: not executable`;
  }

  // V6仕様: 実行権限チェック (sys1.c: access IEXEC)
  if (!checkPermission(state, proc, inode, "x")) {
    emit(state, "error", `exec失敗: "${op.path}" に実行権限がない EACCES`, { pid: op.pid });
    strace(state, op.pid, `execve("${op.path}", [${op.argv.map(a => `"${a}"`).join(", ")}])`, `-1 EACCES`);
    return `exec失敗: EACCES (no execute permission)`;
  }

  // V6仕様: SUID/SGIDビットの処理 (sys1.c)
  // setuidビット(04000)がセットされていれば、実行時にファイル所有者のuidに切り替え
  if (inode.mode & 0o4000) {
    const oldUid = proc.uid;
    proc.uid = inode.uid;
    emit(state, "suid_exec",
      `exec: SUID "${op.path}" uid ${oldUid}→${proc.uid} (ファイル所有者の権限で実行)`,
      { pid: op.pid });
  }
  // setgidビット(02000)がセットされていれば、gidを切り替え
  if (inode.mode & 0o2000) {
    proc.gid = inode.gid;
  }

  // プロセスイメージ置換
  proc.execPath = op.path;
  proc.name = op.path.split("/").pop() ?? op.path;
  proc.argv = op.argv;
  // メモリセグメント再配置
  const base = 0x4000 + (proc.pid * 0x2000) % 0x8000;
  proc.textSeg = seg(base, 0x1000);
  proc.dataSeg = seg(base + 0x1000, 0x0800);
  proc.stackSeg = seg(0xF000 - proc.pid * 0x400, 0x0400);
  // シグナルハンドラをデフォルトにリセット（V6のexec仕様）
  proc.signalHandlers = {};
  proc.state = "ready";

  emit(state, "exec", `exec: PID ${proc.pid} → "${op.path}" [${op.argv.join(", ")}]`, { pid: op.pid });
  emit(state, "syscall", `sys_exec("${op.path}")`, { pid: op.pid });
  // トラップ/メモリマップトレース
  traceTrap(state, op.pid, "exec", "entry");
  traceMemoryMap(state, proc.pid, proc.name, proc.textSeg, proc.dataSeg, proc.stackSeg);
  traceTrap(state, op.pid, "exec", "return");
  strace(state, op.pid, `execve("${op.path}", [${op.argv.map(a => `"${a}"`).join(", ")}])`, `0`);
  return `exec: PID ${proc.pid} → ${proc.name}`;
}

/**
 * wait: 子プロセスの終了を待つ。V6のwait()相当。
 * zombieの子がいれば即座に回収(プロセステーブルから削除)。
 * いなければ"child_exit"チャネルでsleep状態に遷移。
 */
function handleWait(state: SimState, op: { pid: number }): string {
  state.stats.totalSyscalls++;
  const parent = state.procs.get(op.pid);
  if (!parent) return `wait失敗: PID ${op.pid} が存在しない`;

  // ゾンビの子を探す
  const zombie = [...state.procs.values()].find(
    p => p.ppid === op.pid && p.state === "zombie"
  );

  traceTrap(state, op.pid, "wait", "entry");

  if (zombie) {
    const code = zombie.exitCode;
    state.procs.delete(zombie.pid);
    emit(state, "zombie_reap", `wait: PID ${op.pid} がゾンビ PID ${zombie.pid} を回収 (exit=${code})`, { pid: op.pid });
    emit(state, "syscall", `sys_wait() → PID ${zombie.pid}, exit=${code}`, { pid: op.pid });
    traceTrap(state, op.pid, "wait", "return");
    strace(state, op.pid, `wait(&status)`, `${zombie.pid} [exit=${code}]`);
    return `wait: reaped PID ${zombie.pid} (exit=${code})`;
  }

  // ゾンビがなければsleep
  parent.state = "sleeping";
  parent.waitChannel = `child_exit_${op.pid}`;
  emit(state, "wait", `wait: PID ${op.pid} 子プロセス終了待ち (sleep)`, { pid: op.pid });
  strace(state, op.pid, `wait(&status)`, `-1 ECHILD (sleeping)`);
  return `wait: PID ${op.pid} sleeping`;
}

/**
 * exit: プロセス終了。V6のexit()相当。
 * 1. 全ファイルディスクリプタをクローズ
 * 2. zombie状態に遷移し終了コードを記録
 * 3. 子プロセスがいれば孤児としてinit(PID 1)に再配置
 * 4. 親がwait中ならwakeup
 */
function handleExit(state: SimState, op: { pid: number; code: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `exit失敗: PID ${op.pid} が存在しない`;

  traceTrap(state, op.pid, "exit", "entry");

  // 全fdをクローズ
  for (let i = 0; i < V6_NOFILE; i++) {
    if (proc.openFiles[i]) {
      closeFileDescriptor(state, proc, i);
    }
  }

  proc.state = "zombie";
  proc.exitCode = op.code;
  emit(state, "exit", `exit: PID ${proc.pid} (${proc.name}) → zombie (code=${op.code})`, { pid: op.pid });

  // 孤児の子プロセスをinitに再配置 (sys1.c: exit)
  let hasOrphans = false;
  for (const [, child] of state.procs) {
    if (child.ppid === op.pid && child.pid !== op.pid) {
      child.ppid = 1;
      hasOrphans = true;
      emit(state, "orphan_reparent", `孤児プロセス PID ${child.pid} → init (PID 1) に再配置`, { pid: child.pid });
    }
  }
  // V6仕様: 孤児をinitに再配置した後、initをwakeupしてゾンビ回収を促す (slp.c)
  if (hasOrphans) {
    wakeup(state, "child_exit_1");
  }

  // V6仕様: wakeup(親プロセス) — 親がwait中なら起床 (slp.c: thundering herd)
  wakeup(state, `child_exit_${proc.ppid}`);

  emit(state, "syscall", `sys_exit(${op.code})`, { pid: op.pid });
  strace(state, op.pid, `exit(${op.code})`, `?`);
  return `exit: PID ${proc.pid} (${proc.name}) code=${op.code}`;
}

// ─── ファイル操作 ───
// fio.c/rdwri.c に実装されているファイルI/O。
//
// ■ V6の3層ファイルテーブル構造:
//
//   プロセスA            カーネル共有              ディスク
//   u_ofile[0] ──→ file[3] {off=100, ref=2} ──→ inode#42
//   u_ofile[1] ──→ file[5] {off=0, ref=1}   ──→ inode#42
//                                                    ↑ 同じinode
//   プロセスB (Aのfork子)                              │ でも別offset
//   u_ofile[0] ──→ file[3] (Aと同じ!) ───────────────┘
//   u_ofile[1] ──→ file[5] (別エントリ)
//
//   この設計のポイント:
//   ① u_ofile[] → file[]: fork()で同じfileエントリを共有(refCount++)
//      → 親子がファイルオフセットを共有する
//      → パイプ通信が自然に機能する理由
//   ② 別々にopen()すると異なるfile[]エントリが作られる
//      → 独立したオフセットになる
//   ③ dup()は同じfile[]エントリを指す別のfd
//      → シェルのI/Oリダイレクション(2>&1等)の基盤
//
// ■ read/writeの流れ:
//   1. fd → u_ofile[fd] → file[idx] → inode
//   2. file.offset からブロック番号を計算: blockIdx = offset / 512
//   3. inode.addr[blockIdx] でディスクブロック番号を取得
//      (blockIdx >= 10 の場合は間接ブロック経由)
//   4. バッファキャッシュ(bio.c)を経由してブロックを読み書き
//   5. file.offset を更新、inode.size を必要に応じて拡張

/** open: ファイルを開きfdを返す。パス解決→sysfileエントリ作成→fdテーブル登録 */
function handleOpen(state: SimState, op: { pid: number; path: string; mode: "read" | "write" | "readwrite" }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `open失敗: PID ${op.pid} が存在しない`;

  const inodeNum = resolvePath(state, op.path, proc.cwd);
  if (inodeNum < 0) {
    emit(state, "error", `open失敗: "${op.path}" が見つからない`, { pid: op.pid });
    return `open失敗: "${op.path}" not found`;
  }

  // システムファイルテーブル上限チェック (file.h: NFILE, fio.c: falloc)
  if (state.sysFileTable.length >= V6_NFILE) {
    emit(state, "error", `open失敗: システムファイルテーブル満杯 ENFILE (file.h: NFILE=${V6_NFILE})`, { pid: op.pid });
    strace(state, op.pid, `open("${op.path}", ${op.mode})`, `-1 ENFILE`);
    return `open失敗: ENFILE (system file table overflow)`;
  }

  const fd = allocFd(proc);
  if (fd < 0) {
    emit(state, "error", `open失敗: fdテーブル満杯`, { pid: op.pid });
    return `open失敗: no free fd`;
  }

  // iget: inode��照カウント増加 (iget.c)
  iget(state, inodeNum);

  // システムファイルテーブルにエントリ作成
  const sysIdx = state.nextSysFileIdx++;
  state.sysFileTable.push({
    index: sysIdx, inodeNum, offset: 0, refCount: 1, mode: op.mode,
  });

  proc.openFiles[fd] = { fd, sysFileIdx: sysIdx };
  traceTrap(state, op.pid, "open", "entry");
  emit(state, "file_open", `open: PID ${proc.pid} "${op.path}" → fd=${fd} (${op.mode})`, { pid: op.pid, inodeNum });
  emit(state, "syscall", `sys_open("${op.path}", ${op.mode}) → fd=${fd}`, { pid: op.pid });
  traceTrap(state, op.pid, "open", "return");
  const oFlag = op.mode === "read" ? "O_RDONLY" : op.mode === "write" ? "O_WRONLY" : "O_RDWR";
  strace(state, op.pid, `open("${op.path}", ${oFlag})`, `${fd}`);
  return `open: "${op.path}" → fd=${fd}`;
}

/** creat: 新しいファイルを作成しfdを返す。inode割当→ディレクトリエントリ追加→fd登録 */
function handleCreat(state: SimState, op: { pid: number; path: string; perm: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `creat失敗: PID ${op.pid} が存在しない`;

  // 親ディレクトリを解決
  const parts = op.path.split("/");
  const fileName = parts.pop()!;
  const dirPath = parts.join("/") || "/";
  const dirIno = resolvePath(state, dirPath, proc.cwd);
  if (dirIno < 0) {
    emit(state, "error", `creat失敗: 親ディレクトリ "${dirPath}" が見つからない`, { pid: op.pid });
    return `creat失敗: parent dir not found`;
  }

  // 既存ファイルの有無をチェック (sys2.c: creatの仕様)
  const existingIno = lookupDir(state, dirIno, fileName);
  let inode: V6Inode;
  if (existingIno >= 0) {
    // 既存ファイルをtruncate (sys2.c: creat既存ファイル → itrunc)
    inode = state.inodes.get(existingIno)!;
    // データブロックを解放
    for (let i = 0; i < V6_DIRECT_BLOCKS; i++) {
      if (inode.addr[i] !== 0) {
        freeBlock(state, inode.addr[i]);
        inode.addr[i] = 0;
      }
    }
    // 間接ブロックも解放
    for (let i = V6_DIRECT_BLOCKS; i < 13; i++) {
      if (inode.addr[i] !== 0) {
        // 間接ブロック配下のデータブロックを解放
        const indirectBlock = state.disk.find(b => b.blockNum === inode.addr[i]);
        if (indirectBlock && indirectBlock.content.startsWith("indirect:")) {
          const refs = indirectBlock.content.replace("indirect:", "").split(",").filter(Boolean).map(Number);
          for (const ref of refs) {
            if (ref !== 0) freeBlock(state, ref);
          }
        }
        freeBlock(state, inode.addr[i]);
        inode.addr[i] = 0;
      }
    }
    inode.size = 0;
    inode.mode = V6_IFREG | (op.perm & 0o7777);
    emit(state, "syscall", `creat: "${op.path}" 既存ファイルをtruncate (sys2.c: itrunc) inode#${inode.inodeNum}`, { pid: op.pid, inodeNum: inode.inodeNum });
  } else {
    // 新しいinode割当
    inode = allocInode(state, V6_IFREG | (op.perm & 0o7777));
    inode.uid = proc.uid;

    // ディレクトリにエントリ追加
    addDirEntry(state, dirIno, fileName, inode.inodeNum);
  }

  // システムファイルテーブル上限チェック (file.h: NFILE, fio.c: falloc)
  if (state.sysFileTable.length >= V6_NFILE) {
    emit(state, "error", `creat失敗: システムファイルテーブル満杯 ENFILE (file.h: NFILE=${V6_NFILE})`, { pid: op.pid });
    strace(state, op.pid, `creat("${op.path}", ${op.perm.toString(8).padStart(4, "0")})`, `-1 ENFILE`);
    return `creat失敗: ENFILE (system file table overflow)`;
  }

  // fdを割当
  const fd = allocFd(proc);
  if (fd < 0) {
    emit(state, "error", `creat: fdテーブル満杯`, { pid: op.pid });
    return `creat: no free fd`;
  }
  const sysIdx = state.nextSysFileIdx++;
  state.sysFileTable.push({
    index: sysIdx, inodeNum: inode.inodeNum, offset: 0, refCount: 1, mode: "write",
  });
  proc.openFiles[fd] = { fd, sysFileIdx: sysIdx };

  emit(state, "file_creat", `creat: "${op.path}" → inode#${inode.inodeNum}, fd=${fd}`, { pid: op.pid, inodeNum: inode.inodeNum });
  emit(state, "syscall", `sys_creat("${op.path}", ${modeStr(V6_IFREG | op.perm)}) → fd=${fd}`, { pid: op.pid });
  strace(state, op.pid, `creat("${op.path}", ${op.perm.toString(8).padStart(4, "0")})`, `${fd}`);
  return `creat: "${op.path}" → inode#${inode.inodeNum}, fd=${fd}`;
}

/** close: fdをクローズ。sysfileのrefCount--、0になればエントリ削除 */
function handleClose(state: SimState, op: { pid: number; fd: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `close失敗: PID ${op.pid} が存在しない`;

  if (!proc.openFiles[op.fd]) {
    emit(state, "error", `close失敗: fd=${op.fd} が未オープン`, { pid: op.pid });
    return `close失敗: bad fd`;
  }

  closeFileDescriptor(state, proc, op.fd);
  emit(state, "syscall", `sys_close(${op.fd})`, { pid: op.pid });
  strace(state, op.pid, `close(${op.fd})`, `0`);
  return `close: PID ${proc.pid} fd=${op.fd}`;
}

/** fd個別クローズの内部処理。sysfile参照カウント管理とパイプのreader/writer追跡を行う */
function closeFileDescriptor(state: SimState, proc: V6Process, fdNum: number): void {
  const fdEntry = proc.openFiles[fdNum];
  if (!fdEntry) return;

  const sf = state.sysFileTable.find(f => f.index === fdEntry.sysFileIdx);
  if (sf) {
    sf.refCount--;
    if (sf.refCount <= 0) {
      // iput: inode参照カウント減少 (iget.c)
      iput(state, sf.inodeNum);
      state.sysFileTable = state.sysFileTable.filter(f => f.index !== sf.index);
    }
  }

  // パイプの場合
  const pipe = state.pipes.find(p =>
    p.readFd === fdEntry.sysFileIdx || p.writeFd === fdEntry.sysFileIdx
  );
  if (pipe) {
    if (pipe.readFd === fdEntry.sysFileIdx) pipe.readerCount--;
    if (pipe.writeFd === fdEntry.sysFileIdx) pipe.writerCount--;
    emit(state, "pipe_close", `パイプクローズ: PID ${proc.pid} fd=${fdNum}`, { pid: proc.pid });
  }

  proc.openFiles[fdNum] = null;
  emit(state, "file_close", `close: PID ${proc.pid} fd=${fdNum}`, { pid: proc.pid });
}

/**
 * read: ファイルまたはパイプからデータを読み取る。
 * パイプの場合: バッファからデキュー。
 * 通常ファイル: sysfileのoffsetからブロック番号を計算し、バッファキャッシュ経由で読む。
 * 間接ブロックの場合は間接ブロック自体も読み込む。
 */
function handleRead(state: SimState, op: { pid: number; fd: number; size: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `read失敗: PID ${op.pid} が存在しない`;

  const fdEntry = proc.openFiles[op.fd];
  if (!fdEntry) {
    emit(state, "error", `read失敗: fd=${op.fd} が未オープン`, { pid: op.pid });
    return `read失敗: bad fd`;
  }

  const sf = state.sysFileTable.find(f => f.index === fdEntry.sysFileIdx);
  if (!sf) return `read失敗: sysfile not found`;

  // パイプ読み取り
  const pipe = state.pipes.find(p => p.readFd === fdEntry.sysFileIdx);
  if (pipe) {
    const data = pipe.buffer.splice(0, 1).join("");
    state.stats.pipeBytesTransferred += data.length;
    emit(state, "pipe_read", `pipe_read: PID ${proc.pid} fd=${op.fd} → "${data}"`, { pid: op.pid });
    return `read(pipe): "${data}"`;
  }

  // 通常ファイル読み取り
  const inode = state.inodes.get(sf.inodeNum);
  if (!inode) return `read失敗: inode not found`;

  // バッファキャッシュ経由でブロック読み取り
  const blockIdx = Math.floor(sf.offset / V6_BLOCK_SIZE);
  if (blockIdx < V6_DIRECT_BLOCKS && inode.addr[blockIdx] !== 0) {
    const buf = bufferGet(state, 0, inode.addr[blockIdx]);
    bufferRelease(state, buf);
  } else if (blockIdx >= V6_DIRECT_BLOCKS && blockIdx < V6_DIRECT_BLOCKS + 256) {
    // 間接ブロック経由
    if (inode.addr[V6_INDIRECT_START] !== 0) {
      const indBuf = bufferGet(state, 0, inode.addr[V6_INDIRECT_START]);
      bufferRelease(state, indBuf);
      emit(state, "inode_read", `間接ブロック#${inode.addr[V6_INDIRECT_START]} 読込`, { inodeNum: inode.inodeNum });
    }
  }

  const bytesRead = Math.min(op.size, inode.size - sf.offset);
  sf.offset += bytesRead;
  inode.atime = state.clock;

  traceTrap(state, op.pid, "read", "entry");
  emit(state, "file_read", `read: PID ${proc.pid} fd=${op.fd} ${bytesRead}B (offset→${sf.offset})`, { pid: op.pid, inodeNum: sf.inodeNum });
  emit(state, "syscall", `sys_read(${op.fd}, ${op.size}) → ${bytesRead}B`, { pid: op.pid });
  traceTrap(state, op.pid, "read", "return");
  strace(state, op.pid, `read(${op.fd}, buf, ${op.size})`, `${bytesRead}`);
  return `read: fd=${op.fd} ${bytesRead}B`;
}

/**
 * write: ファイルまたはパイプにデータを書き込む。
 * パイプの場合: readerがいなければSIGPIPE、いればバッファにエンキュー。
 * 通常ファイル: offsetからブロック番号を計算。直接ブロック(addr[0-9])か
 * 間接ブロック(addr[10])経由でデータブロックを割り当て・書き込む。
 */
function handleWrite(state: SimState, op: { pid: number; fd: number; data: string }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `write失敗: PID ${op.pid} が存在しない`;

  const fdEntry = proc.openFiles[op.fd];
  if (!fdEntry) {
    emit(state, "error", `write失敗: fd=${op.fd} が未オープン`, { pid: op.pid });
    return `write失敗: bad fd`;
  }

  const sf = state.sysFileTable.find(f => f.index === fdEntry.sysFileIdx);
  if (!sf) return `write失敗: sysfile not found`;

  // パイプ書き込み
  const pipe = state.pipes.find(p => p.writeFd === fdEntry.sysFileIdx);
  if (pipe) {
    if (pipe.readerCount <= 0) {
      // SIGPIPE
      proc.pendingSignals.push("SIGPIPE");
      emit(state, "signal_send", `SIGPIPE → PID ${proc.pid} (broken pipe)`, { pid: proc.pid });
      return `write(pipe): SIGPIPE`;
    }
    pipe.buffer.push(op.data);
    state.stats.pipeBytesTransferred += op.data.length;
    emit(state, "pipe_write", `pipe_write: PID ${proc.pid} fd=${op.fd} "${op.data}"`, { pid: op.pid });
    return `write(pipe): "${op.data}"`;
  }

  // 通常ファイル書き込み
  const inode = state.inodes.get(sf.inodeNum);
  if (!inode) return `write失敗: inode not found`;

  const bytes = op.data.length;

  // V6 rdwri.c: ブロック境界を跨ぐ書き込みをループで処理
  let remaining = bytes;
  let dataOffset = 0;
  while (remaining > 0) {
    const blockIdx = Math.floor(sf.offset / V6_BLOCK_SIZE);
    const offsetInBlock = sf.offset % V6_BLOCK_SIZE;
    const writeSize = Math.min(remaining, V6_BLOCK_SIZE - offsetInBlock);

    if (blockIdx < V6_DIRECT_BLOCKS) {
      // 直接ブロック
      if (inode.addr[blockIdx] === 0) {
        inode.addr[blockIdx] = allocBlock(state);
      }
      const buf = bufferGet(state, 0, inode.addr[blockIdx]);
      const chunk = op.data.slice(dataOffset, dataOffset + writeSize);
      buf.data = chunk.slice(0, 64) + (chunk.length > 64 ? "..." : "");
      bufferMarkDirty(buf);
      bufferRelease(state, buf);
    } else {
      // 間接ブロック (rdwri.c: bmap経由で間接参照)
      if (inode.addr[V6_INDIRECT_START] === 0) {
        inode.addr[V6_INDIRECT_START] = allocBlock(state);
        ensureDiskBlock(state, inode.addr[V6_INDIRECT_START], "indirect", `indirect block for inode#${inode.inodeNum}`);
        emit(state, "block_alloc", `間接ブロック#${inode.addr[V6_INDIRECT_START]} 割当 (inode#${inode.inodeNum})`, { inodeNum: inode.inodeNum });
      }
      const dataBlk = allocBlock(state);
      // 間接ブロックのディスクメタデータにデータブロック参照を記録 (iget.c: itrunc用)
      const indDisk = state.disk.find(b => b.blockNum === inode.addr[V6_INDIRECT_START]);
      if (indDisk) {
        const existing = indDisk.content.startsWith("indirect:") ? indDisk.content.replace("indirect:", "") : "";
        const refs = existing ? existing.split(",").filter(Boolean) : [];
        refs.push(String(dataBlk));
        indDisk.content = "indirect:" + refs.join(",");
      }
      const buf = bufferGet(state, 0, dataBlk);
      const chunk = op.data.slice(dataOffset, dataOffset + writeSize);
      buf.data = chunk.slice(0, 64) + (chunk.length > 64 ? "..." : "");
      bufferMarkDirty(buf);
      bufferRelease(state, buf);
    }

    sf.offset += writeSize;
    dataOffset += writeSize;
    remaining -= writeSize;
  }
  inode.size = Math.max(inode.size, sf.offset);
  inode.mtime = state.clock;

  traceTrap(state, op.pid, "write", "entry");
  emit(state, "file_write", `write: PID ${proc.pid} fd=${op.fd} ${bytes}B → inode#${sf.inodeNum} (size=${inode.size})`, { pid: op.pid, inodeNum: sf.inodeNum });
  emit(state, "syscall", `sys_write(${op.fd}, "${op.data.slice(0, 20)}${op.data.length > 20 ? "..." : ""}", ${bytes}) → ${bytes}`, { pid: op.pid });
  traceTrap(state, op.pid, "write", "return");
  const preview = op.data.length > 24 ? op.data.slice(0, 24) + "..." : op.data;
  strace(state, op.pid, `write(${op.fd}, "${preview.replace(/\n/g, "\\n")}", ${bytes})`, `${bytes}`);
  return `write: fd=${op.fd} ${bytes}B`;
}

/** link: ハードリンク作成。既存inodeのnlink++し、新しいディレクトリエントリを追加 */
function handleLink(state: SimState, op: { pid: number; existingPath: string; newPath: string }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `link失敗`;

  const existIno = resolvePath(state, op.existingPath, proc.cwd);
  if (existIno < 0) return `link失敗: "${op.existingPath}" not found`;

  const inode = state.inodes.get(existIno);
  if (!inode) return `link失敗: inode not found`;

  // 新しいパスの親ディレクトリ
  const parts = op.newPath.split("/");
  const name = parts.pop()!;
  const dirPath = parts.join("/") || "/";
  const dirIno = resolvePath(state, dirPath, proc.cwd);
  if (dirIno < 0) return `link失敗: parent dir not found`;

  addDirEntry(state, dirIno, name, existIno);
  inode.nlink++;

  emit(state, "link_create", `link: "${op.existingPath}" → "${op.newPath}" (nlink=${inode.nlink})`, { pid: op.pid, inodeNum: existIno });
  emit(state, "syscall", `sys_link("${op.existingPath}", "${op.newPath}")`, { pid: op.pid });
  strace(state, op.pid, `link("${op.existingPath}", "${op.newPath}")`, `0`);
  return `link: "${op.existingPath}" → "${op.newPath}"`;
}

/**
 * unlink: ディレクトリエントリを削除しnlink--。
 * nlink=0かつ誰もopenしていなければinodeとブロックを完全解放する。
 * openされている場合はclose時まで解放を遅延する(V6の仕様通り)。
 */
function handleUnlink(state: SimState, op: { pid: number; path: string }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `unlink失敗`;

  const inodeNum = resolvePath(state, op.path, proc.cwd);
  if (inodeNum < 0) return `unlink失敗: "${op.path}" not found`;

  const inode = state.inodes.get(inodeNum);
  if (!inode) return `unlink失敗: inode not found`;

  // 親ディレクトリからエントリ削除
  const parts = op.path.split("/");
  const name = parts.pop()!;
  const dirPath = parts.join("/") || "/";
  const dirIno = resolvePath(state, dirPath, proc.cwd);
  if (dirIno >= 0) {
    removeDirEntry(state, dirIno, name);
  }

  inode.nlink--;
  emit(state, "unlink_remove", `unlink: "${op.path}" (nlink→${inode.nlink})`, { pid: op.pid, inodeNum });

  // nlink=0 かつ誰もopenしていなければinode解放
  if (inode.nlink <= 0) {
    const inUse = state.sysFileTable.some(f => f.inodeNum === inodeNum);
    if (!inUse) {
      freeInode(state, inodeNum);
    }
  }

  emit(state, "syscall", `sys_unlink("${op.path}")`, { pid: op.pid });
  strace(state, op.pid, `unlink("${op.path}")`, `0`);
  return `unlink: "${op.path}"`;
}

/** chdir: カレントディレクトリを変更。proc.cwdをパス解決後のinode番号に更新 */
function handleChdir(state: SimState, op: { pid: number; path: string }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `chdir失敗`;

  const inodeNum = resolvePath(state, op.path, proc.cwd);
  if (inodeNum < 0) return `chdir失敗: "${op.path}" not found`;

  proc.cwd = inodeNum;
  emit(state, "syscall", `sys_chdir("${op.path}") → inode#${inodeNum}`, { pid: op.pid });
  strace(state, op.pid, `chdir("${op.path}")`, `0`);
  return `chdir: "${op.path}" → inode#${inodeNum}`;
}

/** stat: ファイルのinode情報を取得。パス解決してmode/size/nlinkを返す */
function handleStat(state: SimState, op: { pid: number; path: string }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `stat失敗`;

  const inodeNum = resolvePath(state, op.path, proc.cwd);
  if (inodeNum < 0) return `stat失敗: "${op.path}" not found`;

  const inode = state.inodes.get(inodeNum);
  if (!inode) return `stat失敗: inode not found`;

  emit(state, "inode_read", `stat: "${op.path}" → inode#${inodeNum} mode=${modeStr(inode.mode)} size=${inode.size} nlink=${inode.nlink}`, { pid: op.pid, inodeNum });
  emit(state, "syscall", `sys_stat("${op.path}") → {ino=${inodeNum}, mode=${modeStr(inode.mode)}, size=${inode.size}, nlink=${inode.nlink}}`, { pid: op.pid });
  strace(state, op.pid, `stat("${op.path}", &buf)`, `0 {ino=${inodeNum}, size=${inode.size}, nlink=${inode.nlink}}`);
  return `stat: "${op.path}" ino=${inodeNum} ${modeStr(inode.mode)} size=${inode.size}`;
}

/** chmod: ファイルのパーミッションビットを変更。ファイル種別(上位4ビット)は保持する */
function handleChmod(state: SimState, op: { pid: number; path: string; mode: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `chmod失敗`;

  const inodeNum = resolvePath(state, op.path, proc.cwd);
  if (inodeNum < 0) return `chmod失敗: "${op.path}" not found`;

  const inode = state.inodes.get(inodeNum);
  if (!inode) return `chmod失敗`;

  const oldMode = inode.mode;
  inode.mode = (inode.mode & 0o170000) | (op.mode & 0o7777);
  emit(state, "inode_write", `chmod: "${op.path}" ${modeStr(oldMode)} → ${modeStr(inode.mode)}`, { pid: op.pid, inodeNum });
  emit(state, "syscall", `sys_chmod("${op.path}", ${op.mode.toString(8)})`, { pid: op.pid });
  strace(state, op.pid, `chmod("${op.path}", 0${(op.mode & 0o7777).toString(8)})`, `0`);
  return `chmod: "${op.path}" → ${modeStr(inode.mode)}`;
}

/**
 * mkdir: ディレクトリ作成。
 * 新しいinode(IFDIR)を割り当て、"."と".."エントリを含むデータブロックを確保。
 * 親ディレクトリのnlinkも++する(".."エントリ分)。
 */
function handleMkdir(state: SimState, op: { pid: number; path: string }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `mkdir失敗`;

  const parts = op.path.split("/");
  const dirName = parts.pop()!;
  const parentPath = parts.join("/") || "/";
  const parentIno = resolvePath(state, parentPath, proc.cwd);
  if (parentIno < 0) return `mkdir失敗: parent not found`;

  const dirInode = allocInode(state, V6_IFDIR | 0o755);
  dirInode.uid = proc.uid;
  const dirBlk = allocBlock(state);
  dirInode.addr[0] = dirBlk;
  ensureDiskBlock(state, dirBlk, "data", `dir:.=${dirInode.inodeNum},..=${parentIno}`);
  dirInode.size = 32;

  addDirEntry(state, parentIno, dirName, dirInode.inodeNum);

  // 親のnlink++（".."エントリ）
  const parentInode = state.inodes.get(parentIno);
  if (parentInode) parentInode.nlink++;

  emit(state, "syscall", `sys_mkdir("${op.path}")`, { pid: op.pid, inodeNum: dirInode.inodeNum });
  strace(state, op.pid, `mkdir("${op.path}", 0755)`, `0`);
  return `mkdir: "${op.path}" → inode#${dirInode.inodeNum}`;
}

// ─── パイプ ───
// pipe.c に実装されたプロセス間通信機構。
//
// ■ パイプの内部構造:
//   - 専用のinodeを1つ割り当て、そのデータブロックをバッファとして使用
//   - V6実機ではパイプバッファは PIPSIZ(=4096+512=4608)バイト
//   - 読み取りオフセット(inode.addr[0])と書き込みオフセット(inode.addr[1])を
//     inode上に格納する独特な実装
//
// ■ pipe()の典型的な使用パターン (シェルの"|"):
//   1. pipe() → fd[0]=read, fd[1]=write
//   2. fork() → 子プロセスがfdを継承
//   3. 親: close(fd[0]); write(fd[1], data); close(fd[1]);
//      子: close(fd[1]); read(fd[0], buf); close(fd[0]);
//   4. 読み手がいないパイプにwrite → SIGPIPE送信
//
// ■ dup()との連携:
//   「ls | grep foo」の実装:
//   1. pipe(p)
//   2. fork() → 子1(ls): close(stdout); dup(p[1]); close(p[0]); close(p[1]); exec("ls")
//   3. fork() → 子2(grep): close(stdin); dup(p[0]); close(p[0]); close(p[1]); exec("grep", "foo")
//   4. 親: close(p[0]); close(p[1]); wait; wait

/**
 * pipe: パイプ作成。V6のpipe()相当。
 * 2つのfd(読み取り用と書き込み用)を返す。
 * パイプ用のinodeとsysfileエントリを作成し、reader/writerカウントを1で初期化。
 */
function handlePipe(state: SimState, op: { pid: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `pipe失敗`;

  const rFd = allocFd(proc);
  if (rFd < 0) return `pipe失敗: no free fd`;
  // 一時的にnullでないものを設定して次のfdを探す
  proc.openFiles[rFd] = { fd: rFd, sysFileIdx: -1 };
  const wFd = allocFd(proc);
  if (wFd < 0) {
    proc.openFiles[rFd] = null;
    return `pipe失敗: no free fd`;
  }

  // パイプ用inode
  const pipeInode = allocInode(state, V6_IFREG | 0o600);

  const rSysIdx = state.nextSysFileIdx++;
  const wSysIdx = state.nextSysFileIdx++;
  state.sysFileTable.push(
    { index: rSysIdx, inodeNum: pipeInode.inodeNum, offset: 0, refCount: 1, mode: "read" },
    { index: wSysIdx, inodeNum: pipeInode.inodeNum, offset: 0, refCount: 1, mode: "write" },
  );

  proc.openFiles[rFd] = { fd: rFd, sysFileIdx: rSysIdx };
  proc.openFiles[wFd] = { fd: wFd, sysFileIdx: wSysIdx };

  const pipe: V6Pipe = {
    id: state.nextPipeId++, inodeNum: pipeInode.inodeNum,
    buffer: [], readFd: rSysIdx, writeFd: wSysIdx,
    readerPid: proc.pid, writerPid: proc.pid,
    readerCount: 1, writerCount: 1,
    locked: false, waitingPids: [],
  };
  state.pipes.push(pipe);

  emit(state, "pipe_create", `pipe: PID ${proc.pid} → read=fd${rFd}, write=fd${wFd}`, { pid: op.pid });
  emit(state, "syscall", `sys_pipe() → [${rFd}, ${wFd}]`, { pid: op.pid });
  strace(state, op.pid, `pipe([${rFd}, ${wFd}])`, `0`);
  return `pipe: fd${rFd}(read), fd${wFd}(write)`;
}

/** dup: fdを複製。同じsysfileエントリを指す新しいfdを作成しrefCount++ */
function handleDup(state: SimState, op: { pid: number; fd: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `dup失敗`;

  const srcFd = proc.openFiles[op.fd];
  if (!srcFd) return `dup失敗: bad fd`;

  const newFd = allocFd(proc);
  if (newFd < 0) return `dup失敗: no free fd`;

  proc.openFiles[newFd] = { fd: newFd, sysFileIdx: srcFd.sysFileIdx };
  const sf = state.sysFileTable.find(f => f.index === srcFd.sysFileIdx);
  if (sf) sf.refCount++;

  // パイプのrefCount更新
  const pipe = state.pipes.find(p =>
    p.readFd === srcFd.sysFileIdx || p.writeFd === srcFd.sysFileIdx
  );
  if (pipe) {
    if (pipe.readFd === srcFd.sysFileIdx) pipe.readerCount++;
    if (pipe.writeFd === srcFd.sysFileIdx) pipe.writerCount++;
  }

  emit(state, "syscall", `sys_dup(${op.fd}) → ${newFd}`, { pid: op.pid });
  strace(state, op.pid, `dup(${op.fd})`, `${newFd}`);
  return `dup: fd${op.fd} → fd${newFd}`;
}

// ─── シグナル ───
// sig.c に実装されたシグナル機構。POSIXシグナルの原型。
//
// ■ V6のシグナルセマンティクス:
//   - ハンドラは3択: SIG_DFL(0)/SIG_IGN(1)/関数ポインタ
//   - 「ワンショット」: ハンドラ実行後、自動的にSIG_DFLに戻る
//     → ハンドラ内で再度signal()を呼ぶ必要がある(レース条件あり)
//     → BSD 4.2のsigvec()/sigaction()で改善された
//   - シグナルマスクなし(BSD 4.2で導入)
//   - SIGKILL(9)のみ捕捉・無視不可
//
// ■ シグナル配送のタイミング:
//   V6ではシグナルはプロセスがカーネルモードからユーザーモードに
//   戻る直前にチェックされる(issig()/psig())。
//   つまりシステムコール実行中はシグナルが遅延する。
//
// ■ デフォルト動作:
//   大半のシグナルはプロセス終了。
//   SIGQUIT, SIGILL, SIGTRAP, SIGIOT, SIGEMT, SIGFPE, SIGBUS, SIGSEGV
//   はコアダンプ付き終了。

/** signal: シグナルハンドラを設定。SIGKILLは変更不可(V6の仕様) */
function handleSignal(state: SimState, op: { pid: number; sig: V6Signal; action: "default" | "ignore" | "catch" }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `signal失敗`;

  if (op.sig === "SIGKILL") {
    emit(state, "error", `signal: SIGKILL のハンドラ変更不可`, { pid: op.pid });
    return `signal: SIGKILL は変更不可`;
  }

  proc.signalHandlers[op.sig] = op.action;
  emit(state, "syscall", `sys_signal(${op.sig}, ${op.action})`, { pid: op.pid });
  const act = op.action === "catch" ? "SIG_CATCH" : op.action === "ignore" ? "SIG_IGN" : "SIG_DFL";
  strace(state, op.pid, `signal(${op.sig}, ${act})`, `0`);
  return `signal: PID ${proc.pid} ${op.sig} → ${op.action}`;
}

/**
 * kill: プロセスにシグナルを送信。V6のkill()相当。
 * - SIGKILL: 即座にzombie化(孤児処理含む)。捕捉・無視不可
 * - catch: ハンドラ実行(sleep中ならwakeup)
 * - ignore: 何もしない
 * - default: 大半のシグナルでプロセス終了
 */
function handleKill(state: SimState, op: { senderPid: number; targetPid: number; sig: V6Signal }): string {
  state.stats.totalSyscalls++;
  const target = state.procs.get(op.targetPid);
  if (!target) {
    emit(state, "error", `kill失敗: PID ${op.targetPid} が存在しない`);
    return `kill失敗: no such process`;
  }

  traceTrap(state, op.senderPid, "kill", "entry");
  emit(state, "signal_send", `kill: PID ${op.senderPid} → PID ${op.targetPid} (${op.sig})`, { pid: op.targetPid });
  traceTrap(state, op.senderPid, "kill", "return");
  strace(state, op.senderPid, `kill(${op.targetPid}, ${op.sig})`, `0`);

  // SIGKILL は捕捉・無視不可
  if (op.sig === "SIGKILL") {
    // 全fdをクローズ (exit同様、V6のexit()と同じ後処理が必要)
    for (let i = 0; i < V6_NOFILE; i++) {
      if (target.openFiles[i]) {
        closeFileDescriptor(state, target, i);
      }
    }
    target.state = "zombie";
    target.exitCode = 9;
    state.stats.signalsDelivered++;
    emit(state, "signal_deliver", `SIGKILL: PID ${op.targetPid} 強制終了`, { pid: op.targetPid });
    // 孤児の子プロセスをinitに再配置 (sys1.c: exit)
    let hasOrphans = false;
    for (const [, child] of state.procs) {
      if (child.ppid === op.targetPid && child.pid !== op.targetPid) {
        child.ppid = 1;
        hasOrphans = true;
        emit(state, "orphan_reparent", `孤児プロセス PID ${child.pid} → init (PID 1) に再配置`, { pid: child.pid });
      }
    }
    if (hasOrphans) {
      wakeup(state, "child_exit_1");
    }
    wakeup(state, `child_exit_${target.ppid}`);
    return `kill: SIGKILL → PID ${op.targetPid}`;
  }

  const handler = target.signalHandlers[op.sig] ?? "default";
  state.stats.signalsDelivered++;

  switch (handler) {
    case "ignore":
      emit(state, "signal_ignore", `${op.sig}: PID ${op.targetPid} 無視`, { pid: op.targetPid });
      return `kill: ${op.sig} → PID ${op.targetPid} (ignored)`;
    case "catch":
      emit(state, "signal_catch", `${op.sig}: PID ${op.targetPid} ハンドラ実行`, { pid: op.targetPid });
      // V6仕様: ワンショットセマンティクス (sig.c)
      // ハンドラ実行後、自動的にSIG_DFLに戻る
      // (BSDのsigvec()/POSIXのsigaction()で改善された)
      target.signalHandlers[op.sig] = "default";
      emit(state, "syscall", `signal one-shot reset: ${op.sig} → SIG_DFL (V6 semantics)`, { pid: op.targetPid });
      // sleep中ならwakeup
      if (target.state === "sleeping") {
        target.state = "ready";
        target.waitChannel = "";
      }
      return `kill: ${op.sig} → PID ${op.targetPid} (caught, reset to SIG_DFL)`;
    case "default":
    default: {
      // デフォルト動作: 大半は終了
      const termSignals: V6Signal[] = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGILL", "SIGTRAP", "SIGIOT", "SIGEMT", "SIGFPE", "SIGBUS", "SIGSEGV", "SIGSYS", "SIGPIPE"];
      if (termSignals.includes(op.sig)) {
        // 全fdをクローズ (exit同様)
        for (let i = 0; i < V6_NOFILE; i++) {
          if (target.openFiles[i]) {
            closeFileDescriptor(state, target, i);
          }
        }
        target.state = "zombie";
        target.exitCode = 128;
        emit(state, "signal_default", `${op.sig}: PID ${op.targetPid} デフォルト動作 → 終了`, { pid: op.targetPid });
        // 孤児の子プロセスをinitに再配置
        let hasOrphans = false;
        for (const [, child] of state.procs) {
          if (child.ppid === op.targetPid && child.pid !== op.targetPid) {
            child.ppid = 1;
            hasOrphans = true;
            emit(state, "orphan_reparent", `孤児プロセス PID ${child.pid} → init (PID 1) に再配置`, { pid: child.pid });
          }
        }
        if (hasOrphans) {
          wakeup(state, "child_exit_1");
        }
        wakeup(state, `child_exit_${target.ppid}`);
        return `kill: ${op.sig} → PID ${op.targetPid} (terminated)`;
      }
      emit(state, "signal_default", `${op.sig}: PID ${op.targetPid} デフォルト動作`, { pid: op.targetPid });
      return `kill: ${op.sig} → PID ${op.targetPid} (default)`;
    }
  }
}

// ─── スケジューリング ───

/**
 * schedule: V6のスケジューラ (slp.c: swtch)。
 *
 * ■ 優先度計算:
 *   priority = cpuUsage / 2 + PUSER + nice
 *
 *   - PUSER(=50): ユーザープロセスの基本優先度
 *     (カーネルモードプロセスは0〜49の範囲でスリープ優先度を持つ)
 *   - cpuUsage: クロック割り込み(60Hz)ごとに実行中プロセスの値を++
 *     スケジュール時に半減(decay): p_cpu = p_cpu / 2
 *     → CPUを多く使ったプロセスの優先度が自然に下がる
 *     → 対話型プロセス(すぐsleepする)は低いcpuUsageを維持し高優先度
 *   - nice: ユーザーが設定する優先度調整値(-20〜19)
 *     正の値でプロセスの優先度を下げる(他に譲る=nice)
 *
 * ■ swtch()の動作:
 *   1. 全readyプロセスのcpuUsageを半減
 *   2. 優先度を再計算
 *   3. 最小priority値のプロセスを選択
 *   4. コンテキストスイッチ(レジスタ/スタック/MMU設定を切り替え)
 *
 * この設計は「多段フィードバックキュー」の変形で、
 * CPU集中型プロセスの優先度を自動的に下げ、
 * I/O集中型・対話型プロセスの応答性を維持する。
 */
function handleSchedule(state: SimState): string {
  const PUSER = 50;
  const ready = [...state.procs.values()].filter(p => p.state === "ready" || p.state === "running");
  if (ready.length === 0) return "schedule: 実行可能プロセスなし";

  // CPU使用量を減衰
  for (const p of ready) {
    p.cpuUsage = Math.floor(p.cpuUsage / 2);
    p.priority = Math.floor(p.cpuUsage / 2) + PUSER + p.nice;
  }

  // 最高優先度（最小値）を選択
  ready.sort((a, b) => a.priority - b.priority);
  const current = [...state.procs.values()].find(p => p.state === "running");
  const next = ready[0];

  // クロック割り込みトレース（スケジューラ呼び出し契機）
  const needReschedule = current !== undefined && current.pid !== next.pid;
  traceClockInterrupt(state, needReschedule);

  if (current && current.pid !== next.pid) {
    const fromPri = current.priority;
    current.state = "ready";
    emit(state, "sched_switch", `コンテキストスイッチ: PID ${current.pid} → PID ${next.pid}`, { pid: next.pid });
    state.stats.contextSwitches++;
    // コンテキストスイッチトレース
    traceContextSwitch(state, current.pid, current.name, next.pid, next.name, fromPri, next.priority, next.cpuUsage);
  }

  next.state = "running";
  next.cpuUsage++;

  for (const p of ready) {
    emit(state, "sched_priority", `PID ${p.pid} (${p.name}): priority=${p.priority} (cpu=${p.cpuUsage}, nice=${p.nice})`, { pid: p.pid });
  }

  return `schedule: PID ${next.pid} (${next.name}) 実行中`;
}

/** nice: プロセスの優先度調整値を設定。-20(高優先度)～19(低優先度)にクランプ */
function handleNice(state: SimState, op: { pid: number; value: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) return `nice失敗`;

  proc.nice = Math.max(-20, Math.min(19, op.value));
  emit(state, "syscall", `sys_nice(${op.value})`, { pid: op.pid });
  strace(state, op.pid, `nice(${op.value})`, `${proc.nice}`);
  return `nice: PID ${proc.pid} → ${proc.nice}`;
}

// ─── バッファキャッシュ同期 ───

/** sync: 全dirtyバッファをディスクに書き戻す。V6のupdate()相当 */
function handleSync(state: SimState): string {
  state.stats.totalSyscalls++;
  let written = 0;
  for (const buf of state.bufferCache) {
    if (buf.flags.dirty) {
      buf.flags.dirty = false;
      written++;
      emit(state, "buf_writeback", `sync: dev=${buf.device} blk=${buf.blockNum} 書き戻し`, { blockNum: buf.blockNum });
    }
  }
  state.superblock.modified = false;
  emit(state, "syscall", `sys_sync() → ${written}ブロック書き戻し`);
  strace(state, 0, `sync()`, `0 [${written} blocks]`);
  return `sync: ${written} dirty buffers written`;
}

// ─── スワッピング ───
// 【Lions本 第2章: スワッピング】
// V6はページングではなくスワッピングでメモリ管理を行う。
// PDP-11/40の物理メモリは最大256KBで、複数プロセスをすべて常駐させることは困難。
//
// ■ スワッパ (PID 0, sched(), slp.c):
//   カーネル初期化後にmain()の末尾でsched()に突入し、二度と戻らない。
//   無限ループで以下を繰り返す:
//   1. スワップアウトされたrunnable(SRUN+SLOAD解除)プロセスの中で最長待ちを選択
//   2. そのプロセスに必要なコアメモリを確保 → 確保できなければ手順3
//   3. sleeping中の最低優先度プロセスをスワップアウトしてメモリを空ける
//   4. プロセスをスワップインしてready状態にする
//
// ■ xswap() (text.c):
//   プロセスのdata+stackセグメントをスワップデバイスにコピー。
//   テキストセグメントはプロセス間で共有されるためスワップせず、
//   xccdec()でコア側参照カウント(x_ccount)のみデクリメントする。
//
// ■ スワップマップ (dmr.c: struct map swapmap[]):
//   first-fitアルゴリズムでスワップデバイス上の空き領域を管理。
//   malloc(swapmap, size)で割当、mfree(swapmap, size, addr)で解放。

/**
 * swap_out: プロセスをスワップアウト (slp.c: sched → xswap)。
 * V6のスワッパ(PID 0)はメモリ不足時に、最も長くスリープしている
 * プロセスをスワップデバイスに退避する。
 * xswap()はプロセスのデータ+スタックをスワップデバイスにコピーし、
 * テキストセグメントはxccdec()でコア側カウントをデクリメントする。
 */
function handleSwapOut(state: SimState, op: { pid: number }): string {
  const proc = state.procs.get(op.pid);
  if (!proc) return `swap_out失敗: PID ${op.pid} 不明`;
  if (proc.state === "swapped") return `swap_out: PID ${op.pid} は既にスワップ済み`;

  // スワップデバイス上の領域を確保
  const neededBlocks = Math.ceil((proc.dataSeg.size + proc.stackSeg.size) / V6_BLOCK_SIZE) || 1;
  const swapSlot = allocSwapSpace(state, neededBlocks);
  if (swapSlot < 0) {
    emit(state, "error", `swap_out失敗: スワップ空間不足`, { pid: op.pid });
    return `swap_out失敗: スワップ空間不足`;
  }

  const prevState = proc.state;
  proc.state = "swapped";
  state.stats.swapOuts++;

  // テキストセグメント共有のコアカウントをデクリメント
  const textEntry = state.textTable.find(t => t.path === proc.execPath && t.refCount > 0);
  if (textEntry && textEntry.coreCount > 0) {
    textEntry.coreCount--;
    emit(state, "text_free", `xccdec: "${textEntry.path}" coreCount=${textEntry.coreCount}`, { pid: op.pid });
  }

  emit(state, "swap_out",
    `sched: PID ${op.pid} (${proc.name}) スワップアウト [${prevState}→swapped] ` +
    `data=${proc.dataSeg.size}B stack=${proc.stackSeg.size}B → swap[${swapSlot}]`,
    { pid: op.pid });
  strace(state, 0, `xswap(pid=${op.pid}, size=${neededBlocks})`, `0`);
  traceTrap(state, 0, "sched/swap_out", "entry");
  traceTrap(state, 0, "sched/swap_out", "return");

  return `swap_out: PID ${op.pid} (${proc.name}) → スワップデバイス [${neededBlocks}ブロック]`;
}

/**
 * swap_in: プロセスをスワップイン (slp.c: sched)。
 * スワッパはスワップアウトされた実行可能プロセスの中から
 * 最も長くスワップアウトされているものをメモリに読み込む。
 */
function handleSwapIn(state: SimState, op: { pid: number }): string {
  const proc = state.procs.get(op.pid);
  if (!proc) return `swap_in失敗: PID ${op.pid} 不明`;
  if (proc.state !== "swapped") return `swap_in: PID ${op.pid} はスワップされていない`;

  proc.state = "ready";
  state.stats.swapIns++;

  // テキストセグメントのコアカウントをインクリメント
  const textEntry = state.textTable.find(t => t.path === proc.execPath && t.refCount > 0);
  if (textEntry) {
    textEntry.coreCount++;
    emit(state, "text_alloc", `xalloc(swap_in): "${textEntry.path}" coreCount=${textEntry.coreCount}`, { pid: op.pid });
  }

  emit(state, "swap_in",
    `sched: PID ${op.pid} (${proc.name}) スワップイン [swapped→ready]`,
    { pid: op.pid });
  strace(state, 0, `swapin(pid=${op.pid})`, `0`);

  return `swap_in: PID ${op.pid} (${proc.name}) → メモリ上`;
}

/** スワップデバイスから空き領域を確保。first-fitアルゴリズム */
function allocSwapSpace(state: SimState, blocks: number): number {
  for (let i = 0; i < state.swapMap.length; i++) {
    if (state.swapMap[i].size >= blocks) {
      const addr = state.swapMap[i].addr;
      state.swapMap[i].addr += blocks;
      state.swapMap[i].size -= blocks;
      if (state.swapMap[i].size === 0) state.swapMap.splice(i, 1);
      return addr;
    }
  }
  return -1;
}

/**
 * xalloc: テキストセグメントを割当/共有 (text.c: xalloc)。
 * 同じ実行ファイルを使用する既存テキストエントリがあればrefCount++で共有。
 * なければ新しいテキストテーブルエントリを作成する。
 */
function handleXalloc(state: SimState, op: { pid: number; path: string }): string {
  const proc = state.procs.get(op.pid);
  if (!proc) return `xalloc失敗: PID ${op.pid} 不明`;

  // 既存テキストエントリを探す
  const existing = state.textTable.find(t => t.path === op.path && t.refCount > 0);
  if (existing) {
    existing.refCount++;
    existing.coreCount++;
    state.stats.textShares++;
    // テキストセグメントを共有
    proc.textSeg = seg(existing.coreAddr, existing.size);
    emit(state, "text_share",
      `xalloc: PID ${op.pid} が "${op.path}" のテキストを共有 (refCount=${existing.refCount})`,
      { pid: op.pid });
    strace(state, op.pid, `xalloc("${op.path}", shared)`, `0 [refCount=${existing.refCount}]`);
    return `xalloc: PID ${op.pid} → テキスト共有 "${op.path}" (refCount=${existing.refCount})`;
  }

  // 新規テキストエントリを作成
  const idx = state.nextTextIdx++;
  const coreAddr = 0x2000 + idx * 0x1000;
  const size = 0x800; // 2KB テキストセグメント
  const entry: V6TextEntry = {
    index: idx, inodeNum: 0, coreAddr, swapAddr: 0, size,
    refCount: 1, coreCount: 1, path: op.path,
  };
  state.textTable.push(entry);
  proc.textSeg = seg(coreAddr, size);

  emit(state, "text_alloc",
    `xalloc: PID ${op.pid} に "${op.path}" の新テキストセグメント割当 (core=0x${coreAddr.toString(16)})`,
    { pid: op.pid });
  strace(state, op.pid, `xalloc("${op.path}", new)`, `0 [core=0x${coreAddr.toString(16)}]`);
  return `xalloc: PID ${op.pid} → テキスト新規割当 "${op.path}"`;
}

/**
 * xfree: テキストセグメントを解放 (text.c: xfree)。
 * refCount--し、0になったらテキストテーブルエントリを解放。
 */
function handleXfree(state: SimState, op: { pid: number }): string {
  const proc = state.procs.get(op.pid);
  if (!proc) return `xfree失敗: PID ${op.pid} 不明`;

  const entry = state.textTable.find(t => t.path === proc.execPath && t.refCount > 0);
  if (!entry) return `xfree: PID ${op.pid} のテキストセグメントなし`;

  entry.refCount--;
  entry.coreCount = Math.max(0, entry.coreCount - 1);
  const freed = entry.refCount === 0;
  if (freed) {
    // テキストテーブルから除去
    const idx = state.textTable.indexOf(entry);
    if (idx >= 0) state.textTable.splice(idx, 1);
  }

  emit(state, "text_free",
    `xfree: PID ${op.pid} (${proc.name}) テキスト "${entry.path}" 解放 (refCount=${entry.refCount})${freed ? " → エントリ削除" : ""}`,
    { pid: op.pid });
  strace(state, op.pid, `xfree("${entry.path}")`, `0`);
  return `xfree: PID ${op.pid} → テキスト解放 "${entry.path}" (refCount=${entry.refCount})`;
}

// ─── キャラクタI/O / TTY ───

/**
 * tty_input: 端末からの入力 (kl.c: klrint → ttyinput → canon)。
 * 割り込みドリブン: KL11デバイスが1文字受信するたびに割り込みが発生し、
 * klrint()が呼ばれ、ttyinput()でrawqに格納される。
 * 特殊文字(DEL/FS/改行等)の処理もここで行う。
 */
function handleTtyInput(state: SimState, op: { device: number; chars: string }): string {
  const tty = state.ttys.find(t => t.device === op.device);
  if (!tty) {
    emit(state, "error", `tty_input失敗: デバイス${op.device} 不明`);
    return `tty_input失敗: デバイス${op.device} 不明`;
  }

  state.stats.ttyInputChars += op.chars.length;
  let processed = "";

  for (const ch of op.chars) {
    // 割り込み文字チェック
    if (ch === tty.intrChar || ch === "\x03") { // DEL or ^C
      emit(state, "tty_intr", `${tty.name}: 割り込み文字 → SIGINT送信 (pgrp=${tty.pgrp})`);
      // pgrpのプロセスにSIGINTを送信
      for (const [, p] of state.procs) {
        if (p.pid === tty.pgrp || p.ppid === tty.pgrp) {
          p.pendingSignals.push("SIGINT");
        }
      }
      continue;
    }
    if (ch === tty.quitChar || ch === "\x1c") { // FS or Ctrl-backslash
      emit(state, "tty_intr", `${tty.name}: 終了文字 → SIGQUIT送信 (pgrp=${tty.pgrp})`);
      for (const [, p] of state.procs) {
        if (p.pid === tty.pgrp || p.ppid === tty.pgrp) {
          p.pendingSignals.push("SIGQUIT");
        }
      }
      continue;
    }

    if (tty.flags.raw) {
      // RAWモード: そのままcanqに入れる
      tty.canq.data += ch;
      tty.canq.count++;
    } else {
      // 正規モード (canonモード)
      if (ch === tty.eraseChar || ch === "\b") {
        // 消去文字: rawqから1文字削除
        if (tty.rawq.count > 0) {
          tty.rawq.data = tty.rawq.data.slice(0, -1);
          tty.rawq.count--;
        }
      } else if (ch === tty.killChar) {
        // 行削除文字: rawqをクリア
        tty.rawq.data = "";
        tty.rawq.count = 0;
      } else if (ch === "\n" || ch === "\r" || ch === "\x04") {
        // 改行/CR/EOT: rawqの内容をcanqに移動 (canon処理完了)
        if (ch !== "\x04") tty.rawq.data += ch;
        tty.canq.data += tty.rawq.data;
        tty.canq.count += tty.rawq.count + (ch !== "\x04" ? 1 : 0);
        emit(state, "tty_canon", `${tty.name}: canon完了 "${tty.rawq.data.replace(/\n/g, "\\n")}" → canq`);
        tty.rawq.data = "";
        tty.rawq.count = 0;
      } else {
        // 通常文字: rawqに追加
        tty.rawq.data += ch;
        tty.rawq.count++;
      }
    }

    // エコーバック
    if (tty.flags.echo) {
      tty.outq.data += ch;
      tty.outq.count++;
    }

    processed += ch;
  }

  emit(state, "tty_input",
    `${tty.name}: 入力 "${op.chars.replace(/\n/g, "\\n")}" [rawq=${tty.rawq.count} canq=${tty.canq.count}]`);
  state.trapTraces.push(`[intr] ${tty.name} 受信割り込み: ${op.chars.length}文字`);

  return `tty_input: ${tty.name} ← "${op.chars.replace(/\n/g, "\\n")}"`;
}

/**
 * tty_output: 端末への出力 (tty.c: ttwrite → 出力割り込み)。
 * プロセスのwrite()がtty用fdに対して実行された場合に呼ばれる。
 * outqにデータを入れ、出力割り込みハンドラがデバイスに送信する。
 */
function handleTtyOutput(state: SimState, op: { pid: number; device: number; chars: string }): string {
  const tty = state.ttys.find(t => t.device === op.device);
  if (!tty) {
    emit(state, "error", `tty_output失敗: デバイス${op.device} 不明`);
    return `tty_output失敗: デバイス${op.device} 不明`;
  }
  const proc = state.procs.get(op.pid);
  if (!proc) return `tty_output失敗: PID ${op.pid} 不明`;

  state.stats.ttyOutputChars += op.chars.length;

  // ttyoutput() — 1文字ずつ処理 (tty.c)
  let output = "";
  for (const ch of op.chars) {
    // LCASEフラグ: 大文字端末用変換 (旧式テレタイプ)
    // 小文字→大文字、元の大文字��は\プレフィックス
    if (tty.lcase) {
      if (ch >= "a" && ch <= "z") {
        output += ch.toUpperCase();
        tty.column++;
        continue;
      } else if (ch >= "A" && ch <= "Z") {
        output += "\\" + ch;
        tty.column += 2;
        continue;
      }
    }

    if (ch === "\n") {
      // CRMODフラグ: LFをCR+LFに変換
      if (tty.flags.crmod) {
        output += "\r\n";
        // CRパディング: 低速端末ではCR後にNUL文字を挿入
        // (キャリッジリターンの物理的な復帰時間を確保)
        if (tty.speed <= 300) {
          output += "\0"; // NULパディング
        }
      } else {
        output += "\n";
      }
      tty.column = 0;
    } else if (ch === "\t") {
      // XTABSフラグ: タブをカラム境界までのスペースに展開
      if (tty.flags.xtabs) {
        const spaces = 8 - (tty.column % 8);
        output += " ".repeat(spaces);
        tty.column += spaces;
      } else {
        output += "\t";
        tty.column = (tty.column + 8) & ~7;
      }
    } else if (ch === "\r") {
      output += "\r";
      tty.column = 0;
    } else {
      output += ch;
      tty.column++;
    }
  }

  tty.outq.data += output;
  tty.outq.count += output.length;

  traceTrap(state, op.pid, "write(tty)", "entry");
  emit(state, "tty_output",
    `${tty.name}: PID ${op.pid} 出力 "${op.chars.replace(/\n/g, "\\n")}" [outq=${tty.outq.count}]`,
    { pid: op.pid });
  traceTrap(state, op.pid, "write(tty)", "return");

  return `tty_output: PID ${op.pid} → ${tty.name} "${op.chars.replace(/\n/g, "\\n")}"`;
}

/**
 * tty_ioctl: 端末制御 (tty.c: stty/gtty)。
 * V6ではstty(fd, buf)/gtty(fd, buf)でTTY設定を変更/取得する。
 */
function handleTtyIoctl(state: SimState, op: { pid: number; device: number; cmd: string; value?: number }): string {
  const tty = state.ttys.find(t => t.device === op.device);
  if (!tty) return `tty_ioctl失敗: デバイス${op.device} 不明`;

  state.stats.totalSyscalls++;

  switch (op.cmd) {
    case "echo":
      tty.flags.echo = !tty.flags.echo;
      emit(state, "tty_ioctl", `${tty.name}: ECHO=${tty.flags.echo}`);
      strace(state, op.pid, `stty(${op.device}, ECHO=${tty.flags.echo})`, `0`);
      return `stty: ${tty.name} ECHO=${tty.flags.echo}`;
    case "raw":
      tty.flags.raw = !tty.flags.raw;
      emit(state, "tty_ioctl", `${tty.name}: RAW=${tty.flags.raw} (${tty.flags.raw ? "ライン規約バイパス" : "正規モード"})`);
      strace(state, op.pid, `stty(${op.device}, RAW=${tty.flags.raw})`, `0`);
      return `stty: ${tty.name} RAW=${tty.flags.raw}`;
    case "crmod":
      tty.flags.crmod = !tty.flags.crmod;
      emit(state, "tty_ioctl", `${tty.name}: CRMOD=${tty.flags.crmod}`);
      strace(state, op.pid, `stty(${op.device}, CRMOD=${tty.flags.crmod})`, `0`);
      return `stty: ${tty.name} CRMOD=${tty.flags.crmod}`;
    case "speed":
      tty.speed = op.value ?? 9600;
      emit(state, "tty_ioctl", `${tty.name}: speed=${tty.speed} baud`);
      strace(state, op.pid, `stty(${op.device}, speed=${tty.speed})`, `0`);
      return `stty: ${tty.name} speed=${tty.speed}`;
    case "lcase":
      tty.lcase = !tty.lcase;
      emit(state, "tty_ioctl", `${tty.name}: LCASE=${tty.lcase} (${tty.lcase ? "大文字端末モード" : "通常モード"})`);
      strace(state, op.pid, `stty(${op.device}, LCASE=${tty.lcase})`, `0`);
      return `stty: ${tty.name} LCASE=${tty.lcase}`;
    default:
      return `stty: 不明なコマンド ${op.cmd}`;
  }
}

// ─── ブロックデバイスドライバ ───
// 【Lions本 第5章: ブロックI/Oサブシステム (デバイスドライバ部)】
//
// V6のブロックデバイスドライバは3フェーズモデルで動作する:
//
// ■ フェーズ1 — strategy(bp) (rk.c: rkstrategy):
//   buf構造体(I/O要求)をデバイスキューに投入する。
//   buf.b_devにデバイス番号、b_blknoにブロック番号、b_addrにバッファアドレスが
//   セットされた状態で呼ばれる。キューに投入後、すぐにstart()を呼ぶ。
//
// ■ フェーズ2 — start() (rk.c: rkstart):
//   デバイスレジスタ(RKCS, RKDA, RKBA等)にパラメータを設定し、
//   DMA転送を開始する。この時点でCPUはデバイスの完了を待たずに他の処理を続ける。
//   V6のRK11ドライバはFIFOキューだが、後のBSDではエレベータ(C-SCAN)アルゴリズムを採用。
//
// ■ フェーズ3 — interrupt() (rk.c: rkintr):
//   DMA転送完了でデバイスがBR5割り込みを発生。
//   割り込みハンドラがb_flagsにB_DONEを立て、iodone(bp)を呼ぶ。
//   iodone()内でbrelse(bp)してバッファを解放し、wakeup(&buf)で
//   バッファ待ちのプロセスを起床させる。
//
// ■ RK05ディスクパック (rk.c):
//   容量: 2.5MB (4872ブロック × 512バイト)
//   アドレッシング: シリンダ(203) × サーフェス(2) × セクタ(12)
//   平均シーク時間: 50ms、回転待ち: 12.5ms

/**
 * dev_strategy: ブロックI/O要求の投入 (rk.c: rkstrategy)。
 * strategy()はデバイスドライバのメインエントリポイント。
 * buf構造体(I/O要求)をデバイスキューに投入し、start()でデバイスを起動する。
 * V6のRK11ドライバでは、I/Oキューは単純なFIFO。
 */
function handleDevStrategy(state: SimState, op: { device: number; blockNum: number; write: boolean }): string {
  state.stats.deviceIOs++;
  const dev = state.bdevsw.find(d => d.major === op.device);
  const devName = dev?.name ?? `dev${op.device}`;
  const rwStr = op.write ? "write" : "read";

  emit(state, "dev_strategy",
    `${devName}: ${dev?.d_strategy ?? "strategy"}(blk=${op.blockNum}, ${rwStr})`,
    { blockNum: op.blockNum });

  // start: デバイスに転送開始を指示
  emit(state, "dev_start",
    `${devName}: start() → DMA転送開始 blk=${op.blockNum}`,
    { blockNum: op.blockNum });

  state.trapTraces.push(
    `[intr] ${devName} strategy: blk=${op.blockNum} ${rwStr} → キュー投入+start`
  );

  strace(state, 0, `${dev?.d_strategy ?? "strategy"}(dev=${op.device}, blk=${op.blockNum}, ${rwStr})`, `0`);
  return `dev_strategy: ${devName} blk=${op.blockNum} ${rwStr}`;
}

/**
 * dev_interrupt: デバイス割り込み完了 (rk.c: rkintr)。
 * DMA転送完了後にデバイスが割り込みを発生させ、
 * 割り込みハンドラがbrelse()でバッファを解放し、
 * iodone()でI/O完了を通知する。
 */
function handleDevInterrupt(state: SimState, op: { device: number }): string {
  const dev = state.bdevsw.find(d => d.major === op.device);
  const devName = dev?.name ?? `dev${op.device}`;

  emit(state, "dev_interrupt",
    `${devName}: 割り込み → 転送完了`,
    {});
  emit(state, "dev_complete",
    `${devName}: iodone() → brelse() → バッファ解放`,
    {});

  state.trapTraces.push(
    `[intr] ${devName} interrupt: DMA転送完了 → iodone → wakeup(&buf)`
  );

  return `dev_interrupt: ${devName} 転送完了`;
}

// ─── マウント ───
// 【Lions本 第6章: ファイルシステム (マウント部)】
//
// V6のマウント機構 (sys3.c: smount/sumount):
// mount[]テーブルは固定長配列 (NMOUNT=5)。各エントリは:
//   - m_dev:   マウントされたブロックデバイスのデバイス番号
//   - m_bufp:  デバイスのスーパーブロックを保持するbufのアドレス
//   - m_inodp: マウントポイントのinodeのアドレス
//
// namei()がパスコンポーネントを辿る際にマウントポイントを越える処理:
//   1. 現在のinodeがマウントポイント(m_inodp)と一致するか確認
//   2. 一致すればm_bufp経由で別デバイスのスーパーブロックを参照
//   3. マウントされたFSのルートinode(inode#1)に遷移
//   ".."でマウントポイントを逆方向に越える処理も同様にnamei()で行う。

/**
 * mount: ファイルシステムをマウント (sys3.c: smount)。
 * V6のmount()はブロックデバイスをディレクトリにマウントする。
 * マウントテーブル(NMOUNT=5)にエントリを追加し、
 * namei()がマウントポイントを越えるときにデバイスを切り替える。
 */
function handleMount(state: SimState, op: { pid: number; device: string; path: string }): string {
  state.stats.totalSyscalls++;
  traceTrap(state, op.pid, "mount", "entry");

  if (state.mounts.length >= 5) {
    emit(state, "error", `mount失敗: マウントテーブル満杯 (NMOUNT=5)`);
    strace(state, op.pid, `mount("${op.device}", "${op.path}")`, `-1 EBUSY`);
    traceTrap(state, op.pid, "mount", "return");
    return `mount失敗: マウントテーブル満杯`;
  }

  // マウントポイントの解決
  const proc = state.procs.get(op.pid);
  const cwdIno = proc?.cwd ?? 1;
  const mountInodeNum = resolvePath(state, op.path, cwdIno);
  if (mountInodeNum < 0) {
    emit(state, "error", `mount失敗: "${op.path}" パス解決失敗`);
    strace(state, op.pid, `mount("${op.device}", "${op.path}")`, `-1 ENOENT`);
    traceTrap(state, op.pid, "mount", "return");
    return `mount失敗: パス解決失敗`;
  }

  const deviceNum = state.mounts.length + 1;
  const mountSb: V6SuperBlock = {
    totalBlocks: 512, totalInodes: 64,
    freeBlockList: Array.from({ length: 50 }, (_, i) => 20 + i),
    freeInodeList: Array.from({ length: 20 }, (_, i) => 2 + i),
    freeBlockCount: 50, freeInodeCount: 20,
    modified: false, readOnly: false,
  };

  state.mounts.push({
    device: deviceNum,
    mountPoint: mountInodeNum,
    superblock: mountSb,
    deviceName: op.device,
    mountPath: op.path,
  });

  emit(state, "mount", `mount: "${op.device}" → "${op.path}" (dev=${deviceNum})`);
  strace(state, op.pid, `mount("${op.device}", "${op.path}", 0)`, `0`);
  traceTrap(state, op.pid, "mount", "return");

  return `mount: ${op.device} → ${op.path}`;
}

/**
 * umount: ファイルシステムをアンマウント (sys3.c: sumount)。
 * マウントされたデバイスのdirtyバッファを書き戻し、
 * マウントテーブルからエントリを除去する。
 */
function handleUmount(state: SimState, op: { pid: number; device: string }): string {
  state.stats.totalSyscalls++;
  traceTrap(state, op.pid, "umount", "entry");

  const idx = state.mounts.findIndex(m => m.deviceName === op.device);
  if (idx < 0) {
    emit(state, "error", `umount失敗: "${op.device}" はマウントされていない`);
    strace(state, op.pid, `umount("${op.device}")`, `-1 EINVAL`);
    traceTrap(state, op.pid, "umount", "return");
    return `umount失敗: "${op.device}" はマウントされていない`;
  }

  const mount = state.mounts[idx];
  state.mounts.splice(idx, 1);

  emit(state, "umount", `umount: "${op.device}" (マウントポイント: "${mount.mountPath}")`);
  strace(state, op.pid, `umount("${op.device}")`, `0`);
  traceTrap(state, op.pid, "umount", "return");

  return `umount: ${op.device}`;
}

// ─── パーミッションチェック ───

/**
 * V6のパーミッションチェック (fio.c: access, iget.c)。
 * uid, gid, モードビットに基づいてアクセス権を判定する。
 * V6ではuid=0(root/スーパーユーザー)は全てのアクセスが許可される。
 *
 * チェック順序: owner → group → other
 * - owner: mode bits [8:6] (rwx)
 * - group: mode bits [5:3] (rwx)
 * - other: mode bits [2:0] (rwx)
 */
function checkPermission(state: SimState, proc: V6Process, inode: V6Inode, mode: "r" | "w" | "x"): boolean {
  // root(uid=0)はr/wは常に許可、xは少なくとも1つのxビットが必要
  if (proc.uid === 0) {
    if (mode !== "x") {
      emit(state, "perm_check",
        `access ok: PID ${proc.pid} (uid=0 root) ${mode} inode#${inode.inodeNum} mode=${modeStr(inode.mode)}`,
        { pid: proc.pid, inodeNum: inode.inodeNum });
      return true;
    }
    // V6仕様: rootでもexecは全くxビットがなければ拒否
    if ((inode.mode & 0o111) !== 0) {
      emit(state, "perm_check",
        `access ok: PID ${proc.pid} (uid=0 root) ${mode} inode#${inode.inodeNum} mode=${modeStr(inode.mode)}`,
        { pid: proc.pid, inodeNum: inode.inodeNum });
      return true;
    }
    // xビットが1つもない → root でも実行不可
  }

  const shift = proc.uid === inode.uid ? 6 : (proc.gid === inode.gid ? 3 : 0);
  const bits = (inode.mode >> shift) & 7;
  const needed = mode === "r" ? 4 : mode === "w" ? 2 : 1;

  const allowed = (bits & needed) !== 0;
  if (!allowed) {
    state.stats.permDenied++;
    emit(state, "perm_denied",
      `access denied: PID ${proc.pid} (uid=${proc.uid}) ${mode} inode#${inode.inodeNum} mode=${modeStr(inode.mode)}`,
      { pid: proc.pid, inodeNum: inode.inodeNum });
  } else {
    emit(state, "perm_check",
      `access ok: PID ${proc.pid} (uid=${proc.uid}) ${mode} inode#${inode.inodeNum} mode=${modeStr(inode.mode)}`,
      { pid: proc.pid, inodeNum: inode.inodeNum });
  }
  return allowed;
}

// ─── break / expand() ───
// 【Lions本 第1章: プロセスサブシステム (メモリ管理部)】
//
// V6のプロセスメモリは3セグメントモデル:
//   テキスト(命令) | データ(変数+ヒープ) | [空き] | スタック
//                   ↑上方向に成長          ↑下方向に成長
//
// PDP-11のMMU(Memory Management Unit)は各セグメントにAPR(Active Page Register)を割当。
// APRはPAR(Page Address Register)とPDR(Page Description Register)のペアで、
// セグメントの物理アドレスとサイズ/方向/保護を管理する。
//
// break(2) / sbreak() (sys1.c):
//   データセグメントの上限を変更する。C言語のmalloc()はbrk()の上にラッパーとして実装。
//   estabur()でAPRを再設定し、必要ならcopyout()でデータをコピーする。
//   スタックセグメントとの衝突チェックを行い、衝突ならENOMEM。

/**
 * break(2) / sbreak() — データ領域拡張 (sys1.c)。
 * V6の brk() システムコール。プロセスのデータセグメントのサイズを変更する。
 * PDP-11ではデータセグメントは上方向に成長し、スタックは下方向に成長する。
 * 両者が衝突するとENOMEMエラーとなる。
 */
function handleBreak(state: SimState, op: { pid: number; newSize: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `break失敗: PID ${op.pid} が存在しない`);
    return `break失敗`;
  }

  const oldSize = proc.dataSeg.size;
  // スタックセグメントとの衝突チェック
  const dataEnd = proc.dataSeg.base + op.newSize;
  if (dataEnd > proc.stackSeg.base && proc.stackSeg.size > 0) {
    emit(state, "error", `break失敗: データ領域(${dataEnd})がスタック領域(${proc.stackSeg.base})と衝突`, { pid: op.pid });
    strace(state, op.pid, `brk(0x${op.newSize.toString(16)})`, `-1 ENOMEM`);
    return `break失敗: ENOMEM`;
  }

  proc.dataSeg.size = op.newSize;
  emit(state, "data_expand",
    `break: PID ${op.pid} データセグメント ${oldSize}→${op.newSize} bytes (expand)`,
    { pid: op.pid });
  traceTrap(state, op.pid, "break", "entry");
  traceTrap(state, op.pid, "break", "return");
  traceMemoryMap(state, proc.pid, proc.name, proc.textSeg, proc.dataSeg, proc.stackSeg);
  strace(state, op.pid, `brk(0x${op.newSize.toString(16)})`, `0`);
  return `break: data ${oldSize}→${op.newSize}`;
}

// ─── seek ───
// 【Lions本 第6章: ファイルシステム (ファイル操作部)】
//
// seek(2) (sys2.c) はファイルポインタ(file構造体のf_offset)を移動する。
// V6のseek()は現代のlseek()の原型。V7でlseek()にリネームされた。
//
// whenceパラメータ:
//   0: ファイル先頭からの絶対位置 (SEEK_SET)
//   1: 現在位置からの相対移動 (SEEK_CUR)
//   2: ファイル末尾からの相対移動 (SEEK_END)
//
// V6ではf_offsetは16ビット(最大65535バイト)。これを超えるファイルでは
// seek()の第3引数に3/4/5を指定して512バイト単位で移動する(V6独特の仕様)。

/**
 * seek(2) — ファイルポインタ移動 (sys2.c)。
 * V6の seek() はwhenceで3モードを選択:
 * - 0: ファイル先頭からのオフセット
 * - 1: 現在位置からの相対オフセット
 * - 2: ファイル末尾からの相対オフセット
 */
function handleSeek(state: SimState, op: { pid: number; fd: number; offset: number; whence: 0 | 1 | 2 }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `seek失敗: PID ${op.pid} が存在しない`);
    return `seek失敗`;
  }

  const fdEntry = proc.openFiles[op.fd];
  if (!fdEntry) {
    emit(state, "error", `seek失敗: fd ${op.fd} が無効`, { pid: op.pid });
    strace(state, op.pid, `seek(${op.fd}, ${op.offset}, ${op.whence})`, `-1 EBADF`);
    return `seek失敗: EBADF`;
  }

  const sf = state.sysFileTable.find(f => f.index === fdEntry.sysFileIdx);
  if (!sf) {
    strace(state, op.pid, `seek(${op.fd}, ${op.offset}, ${op.whence})`, `-1 EBADF`);
    return `seek失敗: sysfile not found`;
  }

  const inode = state.inodes.get(sf.inodeNum);
  const oldOff = sf.offset;

  switch (op.whence) {
    case 0: sf.offset = op.offset; break;
    case 1: sf.offset += op.offset; break;
    case 2: sf.offset = (inode?.size ?? 0) + op.offset; break;
  }
  if (sf.offset < 0) sf.offset = 0;

  emit(state, "file_seek",
    `seek: PID ${op.pid} fd=${op.fd} offset ${oldOff}→${sf.offset} (whence=${op.whence})`,
    { pid: op.pid });
  traceTrap(state, op.pid, "seek", "entry");
  traceTrap(state, op.pid, "seek", "return");
  strace(state, op.pid, `seek(${op.fd}, ${op.offset}, ${op.whence})`, `${sf.offset}`);
  return `seek: fd${op.fd} → offset ${sf.offset}`;
}

// ─── mknod ───
// 【Lions本 第6章: ファイルシステム (特殊ファイル部)】
//
// mknod(2) (sys2.c) はデバイスファイルや特殊ファイルを作成する。
// V6にはmkdir(2)がなく、ディレクトリもmknodで作成されていた
// (mkdir(1)コマンドはshell scriptとして実装: mknod dir d; link dir dir/.; link .. dir/..)
//
// デバイスファイルの仕組み:
//   - inode.i_mode の上位4ビットでファイル種別を判別
//     IFCHR(020000): キャラクタデバイス (端末、プリンタ等)
//     IFBLK(060000): ブロックデバイス (ディスク等)
//   - inode.i_addr[0] にメジャー/マイナー番号を格納
//   - open/read/writeでデバイスファイルを操作すると、
//     カーネルがcdevsw[major]/bdevsw[major]テーブルを引いて
//     対応するデバイスドライバの関数を呼び出す
//
// スーパーユーザー(uid=0)のみ実行可能(sys2.c: suser()チェック)。

/**
 * mknod(2) — デバイスファイル作成 (sys2.c)。
 * V6のmkdirはmknodの特殊ケースで、mkdir(2)は存在しなかった。
 * mknod(path, mode, dev) で:
 * - mode の上位ビットがIFCHR(020000)ならキャラクタデバイス
 * - mode の上位ビットがIFBLK(060000)ならブロックデバイス
 * - dev は major/minor番号（addr[0]に格納）
 * スーパーユーザー(uid=0)のみ実行可能。
 */
function handleMknod(state: SimState, op: { pid: number; path: string; mode: number; dev: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `mknod失敗: PID ${op.pid} が存在しない`);
    return `mknod失敗`;
  }

  // root権限チェック
  if (proc.uid !== 0) {
    emit(state, "perm_denied", `mknod: uid=${proc.uid} は root でない EPERM`, { pid: op.pid });
    strace(state, op.pid, `mknod("${op.path}", 0${op.mode.toString(8)}, ${op.dev})`, `-1 EPERM`);
    return `mknod失敗: EPERM`;
  }

  const inode = allocInode(state, op.mode);
  inode.uid = proc.uid;
  inode.gid = proc.gid;
  // デバイスファイルの場合、addr[0] に major/minor 番号を格納
  if ((op.mode & 0o170000) === V6_IFCHR || (op.mode & 0o170000) === V6_IFBLK) {
    inode.addr[0] = op.dev;
  }

  // ディレクトリエントリ追加
  const parts = op.path.split("/").filter(Boolean);
  const name = parts.pop()!;
  const parentPath = "/" + parts.join("/");
  const parentIno = resolvePath(state, parentPath, proc.cwd);
  if (parentIno >= 0) {
    addDirEntry(state, parentIno, name, inode.inodeNum);
  }

  const typeStr = (op.mode & 0o170000) === V6_IFCHR ? "char" :
    (op.mode & 0o170000) === V6_IFBLK ? "block" :
    (op.mode & 0o170000) === V6_IFDIR ? "dir" : "file";
  emit(state, "mknod",
    `mknod: "${op.path}" type=${typeStr} mode=0${op.mode.toString(8)} dev=${op.dev} → inode#${inode.inodeNum}`,
    { pid: op.pid, inodeNum: inode.inodeNum });
  traceTrap(state, op.pid, "mknod", "entry");
  traceTrap(state, op.pid, "mknod", "return");
  strace(state, op.pid, `mknod("${op.path}", 0${op.mode.toString(8)}, ${op.dev})`, `0`);
  return `mknod: ${op.path} (${typeStr}, dev=${op.dev})`;
}

// ─── ptrace ───
// 【Lions本 第4章: シグナル (ptrace部)】
//
// ptrace(2) (sys1.c) はデバッガ(adb)がプロセスを制御するための仕組み。
// V6のptraceは現代のgdbの基盤となったシステムコールである。
//
// ■ トレースの流れ:
//   1. 親プロセス(デバッガ)がfork()で子を作成
//   2. 子がptrace(0, 0, 0, 0) [TRACEME] を呼んでトレース可能にする
//   3. 子がexec()で被デバッグプログラムを実行
//   4. 子のexec()完了後、SIGTRAP停止(proc.p_flag & STRC)
//   5. 親がwait()で子の停止を検知
//   6. 親がptrace(req, pid, addr, data) で子のメモリ読み書き/実行制御
//
// ■ procxmt() (sys1.c):
//   実際のメモリ読み書きはprocxmt()で行う。
//   子プロセスがSTOPPED状態でsleep中に、
//   親の指示をu.u_arg[]経由で受け取って実行する。
//
// ■ BPTトラップ (PDP-11):
//   SINGLESTEP(request=9)はPSWのTビットを設定し、
//   次の1命令実行後にBPTトラップ(ベクタ014)を発生させる。

/**
 * ptrace(2) — プロセストレース (sys1.c)。
 * デバッガ(adb)がプロセスを制御するために使用する。
 * request:
 *   0: 子がトレースを要求（PTRACE_TRACEME）
 *   1-3: 親が子のtext/data/user領域を読む
 *   4-6: 親が子のtext/data/user領域に書く
 *   7: 子の実行を再開（PTRACE_CONT）
 *   8: 子を終了させる
 *   9: 単一命令実行（PTRACE_SINGLESTEP）
 */
function handlePtrace(state: SimState, op: { pid: number; targetPid: number; request: number; addr: number; data: number }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `ptrace失敗: PID ${op.pid} が存在しない`);
    return `ptrace失敗`;
  }

  if (op.request === 0) {
    // PTRACE_TRACEME: 自分自身がトレースされることを許可
    proc.traced = true;
    emit(state, "ptrace_request",
      `ptrace: PID ${op.pid} TRACEME — 親プロセスによるトレースを許可`,
      { pid: op.pid });
    strace(state, op.pid, `ptrace(TRACEME, 0, 0, 0)`, `0`);
    return `ptrace: TRACEME`;
  }

  const target = state.procs.get(op.targetPid);
  if (!target) {
    emit(state, "error", `ptrace失敗: 対象 PID ${op.targetPid} が存在しない`, { pid: op.pid });
    strace(state, op.pid, `ptrace(${op.request}, ${op.targetPid}, ${op.addr}, ${op.data})`, `-1 ESRCH`);
    return `ptrace失敗: ESRCH`;
  }

  if (!target.traced) {
    emit(state, "error", `ptrace失敗: PID ${op.targetPid} はトレース可能でない`, { pid: op.pid });
    strace(state, op.pid, `ptrace(${op.request}, ${op.targetPid}, ${op.addr}, ${op.data})`, `-1 EPERM`);
    return `ptrace失敗: EPERM`;
  }

  const reqNames: Record<number, string> = {
    1: "PEEKTEXT", 2: "PEEKDATA", 3: "PEEKUSER",
    4: "POKETEXT", 5: "POKEDATA", 6: "POKEUSER",
    7: "CONT", 8: "KILL", 9: "SINGLESTEP",
  };
  const reqName = reqNames[op.request] ?? `REQ${op.request}`;

  if (op.request >= 1 && op.request <= 3) {
    // PEEK: 子プロセスのメモリ読み取り
    emit(state, "ptrace_request",
      `ptrace: PID ${op.pid} → ${reqName}(PID ${op.targetPid}, addr=0x${op.addr.toString(16)})`,
      { pid: op.pid });
  } else if (op.request >= 4 && op.request <= 6) {
    // POKE: 子プロセスのメモリ書き込み
    emit(state, "ptrace_request",
      `ptrace: PID ${op.pid} → ${reqName}(PID ${op.targetPid}, addr=0x${op.addr.toString(16)}, data=0x${op.data.toString(16)})`,
      { pid: op.pid });
  } else if (op.request === 7) {
    // CONT: 子プロセスの実行再開
    target.state = "ready";
    emit(state, "ptrace_request",
      `ptrace: PID ${op.pid} → CONT(PID ${op.targetPid}) — 実行再開`,
      { pid: op.pid });
  } else if (op.request === 8) {
    // KILL: 子プロセスの終了
    target.state = "zombie";
    target.exitCode = 9;
    emit(state, "ptrace_request",
      `ptrace: PID ${op.pid} → KILL(PID ${op.targetPid}) — 強制終了`,
      { pid: op.pid });
  } else if (op.request === 9) {
    // SINGLESTEP: 単一命令実行
    target.state = "stopped";
    target.pendingSignals.push("SIGTRAP");
    emit(state, "ptrace_stop",
      `ptrace: PID ${op.targetPid} SINGLESTEP → STOPPED (SIGTRAP)`,
      { pid: op.targetPid });
  }

  traceTrap(state, op.pid, "ptrace", "entry");
  traceTrap(state, op.pid, "ptrace", "return");
  strace(state, op.pid, `ptrace(${reqName}, ${op.targetPid}, 0x${op.addr.toString(16)}, 0x${op.data.toString(16)})`, `0`);
  return `ptrace: ${reqName} (PID ${op.targetPid})`;
}

// ─── grow ───
// 【Lions本 第3章: 割り込みとトラップ (trap.c: grow部)】
//
// PDP-11のMMUはスタックセグメントの範囲外アクセスを検出すると
// セグメンテーション違反トラップ(ベクタ250)を発生させる。
// trap()ハンドラ内でgrow()が呼ばれ、以下を行う:
//   1. フォルトアドレスがスタックの直下(正当な拡張)か判定
//   2. データセグメントとの衝突がないか確認
//   3. 衝突がなければestabur()でAPRを更新しスタックを拡張
//   4. 衝突があればSIGSEGVを送信してプロセスを終了
//
// これにより、Cプログラムは明示的にスタックサイズを指定せずとも
// 関数呼び出しの深さに応じて自動的にスタックが成長する。

/**
 * grow() — スタック自動拡張 (trap.c)。
 * PDP-11のMMUがスタック領域外アクセスを検出すると、
 * セグメンテーション違反トラップが発生する。
 * カーネルのtrap()ハンドラがgrow()を呼んでスタックを拡張する。
 * データ領域との衝突がある場合はSIGSEGVで終了。
 */
function handleGrow(state: SimState, op: { pid: number; newStackSize: number }): string {
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `grow失敗: PID ${op.pid} が存在しない`);
    return `grow失敗`;
  }

  const oldSize = proc.stackSeg.size;
  // スタックは下方向に成長するため、baseを下げる
  const newBase = proc.stackSeg.base + proc.stackSeg.size - op.newStackSize;
  const dataEnd = proc.dataSeg.base + proc.dataSeg.size;

  if (newBase < dataEnd) {
    // データ領域と衝突 → SIGSEGV
    proc.pendingSignals.push("SIGSEGV");
    emit(state, "error",
      `grow失敗: スタック拡張(0x${newBase.toString(16)})がデータ領域(0x${dataEnd.toString(16)})と衝突 → SIGSEGV`,
      { pid: op.pid });
    return `grow失敗: SIGSEGV`;
  }

  proc.stackSeg.base = newBase;
  proc.stackSeg.size = op.newStackSize;
  emit(state, "stack_grow",
    `grow: PID ${op.pid} スタック ${oldSize}→${op.newStackSize} bytes (auto expand)`,
    { pid: op.pid });
  traceTrap(state, op.pid, "grow", "entry");
  traceTrap(state, op.pid, "grow", "return");
  traceMemoryMap(state, proc.pid, proc.name, proc.textSeg, proc.dataSeg, proc.stackSeg);
  return `grow: stack ${oldSize}→${op.newStackSize}`;
}

// ─── breada ───
// 【Lions本 第5章: ブロックI/Oサブシステム (先読み部)】
//
// breada(dev, blkno, rablkno) (bio.c):
//   bread()の拡張版。要求ブロック(blkno)の読み込みに加えて、
//   次の連続ブロック(rablkno)を非同期で先読みする。
//   シーケンシャルファイルアクセスのパフォーマンスを大幅に向上させる。
//
//   アルゴリズム:
//   1. getblk(dev, blkno) でメインブロックのバッファを取得
//   2. バッファが有効でなければ通常のI/Oを発行して待機(iowait)
//   3. getblk(dev, rablkno) で先読みブロックのバッファを取得
//   4. 先読みバッファが有効でなければ非同期I/Oを発行(B_ASYNCフラグ)
//      → I/O完了を待たずにメインブロックを返す
//   5. 次のbread/breadaでは先読みブロックがキャッシュにヒットする
//
//   V6ではreadp()(パイプ読み取り)やreadi()(通常ファイル読み取り)で使用。

/**
 * breada() — 先読み (bio.c)。
 * bread()の拡張版で、要求ブロックと次の連続ブロックを同時にフェッチする。
 * シーケンシャルアクセスのパフォーマンスを向上させる。
 * V6ではreadp(), writep(), readi() 等から呼ばれる。
 */
function handleBreada(state: SimState, op: { device: number; blockNum: number; readAheadBlock: number }): string {
  // メインブロックの読み込み（通常のbread相当）
  const mainBuf = bufferGet(state, op.device, op.blockNum);
  const mainHit = mainBuf !== null;

  // 先読みブロック（非同期）
  const raExists = state.bufferCache.some(b => b.device === op.device && b.blockNum === op.readAheadBlock);
  if (!raExists) {
    // キャッシュにない → 先読み開始
    bufferGet(state, op.device, op.readAheadBlock);
    emit(state, "buf_readahead",
      `breada: 先読み dev=${op.device} blk=${op.readAheadBlock} (async)`,
      { blockNum: op.readAheadBlock });
  }

  emit(state, "syscall",
    `breada(dev=${op.device}, blk=${op.blockNum}, ra=${op.readAheadBlock}) main=${mainHit ? "hit" : "miss"}`,
    { blockNum: op.blockNum });
  return `breada: blk=${op.blockNum}${mainHit ? "(hit)" : "(miss)"} + ra=${op.readAheadBlock}`;
}

// ─── physio ───
// 【Lions本 第5章: ブロックI/Oサブシステム (raw I/O部)】
//
// physio(strat, bp, dev, rw) (bio.c):
//   バッファキャッシュをバイパスして直接デバイスI/Oを行う。
//   /dev/rmk0 (rawモードのRK05) などのキャラクタデバイス特殊ファイル経由で使用。
//
//   用途:
//   - fsck(8): ファイルシステム検査・修復
//   - dd(1): ディスクの生ブロックコピー
//   - mkfs(8): ファイルシステム作成
//
//   通常のread/writeはバッファキャッシュ(bio.c)を経由するが、
//   physioはユーザー空間のバッファから直接デバイスにDMA転送する。
//   これにより、大量データの転送でバッファキャッシュを汚さない。

/**
 * physio() — RAW I/O (bio.c)。
 * バッファキャッシュをバイパスして直接デバイスI/Oを行う。
 * キャラクタデバイスのraw I/O (/dev/rmk0 等) で使用される。
 * メモリ→デバイスまたはデバイス→メモリの直接転送。
 */
function handlePhysio(state: SimState, op: { pid: number; device: number; blockNum: number; write: boolean }): string {
  state.stats.totalSyscalls++;
  const proc = state.procs.get(op.pid);
  if (!proc) {
    emit(state, "error", `physio失敗: PID ${op.pid} が存在しない`);
    return `physio失敗`;
  }

  state.stats.deviceIOs++;
  const dir = op.write ? "write" : "read";
  emit(state, "physio",
    `physio: PID ${op.pid} raw ${dir} dev=${op.device} blk=${op.blockNum} (バッファキャッシュ未使用)`,
    { pid: op.pid, blockNum: op.blockNum });
  emit(state, "dev_strategy",
    `physio→strategy: dev=${op.device} blk=${op.blockNum} ${dir} (raw/direct)`,
    { blockNum: op.blockNum });
  emit(state, "dev_complete",
    `physio完了: dev=${op.device} blk=${op.blockNum}`,
    { blockNum: op.blockNum });

  traceTrap(state, op.pid, "physio", "entry");
  traceTrap(state, op.pid, "physio", "return");
  strace(state, op.pid, `physio(dev=${op.device}, blk=${op.blockNum}, ${dir})`, `0`);
  return `physio: raw ${dir} dev=${op.device} blk=${op.blockNum}`;
}

// ─── plock / prele ───
// 【Lions本 第7章: パイプ (排他制御部)】
//
// V6のパイプはinode上に実装されるため、readp()とwritep()が
// 同じinodeに同時アクセスする可能性がある。
// plock(ip) / prele(ip) (pipe.c) で排他制御する:
//
//   plock(ip):
//     while (ip->i_flag & ILOCK) {
//       ip->i_flag |= IWANT;
//       sleep(&ip, PINOD);     // ロック待ち
//     }
//     ip->i_flag |= ILOCK;     // ロック取得
//
//   prele(ip):
//     ip->i_flag &= ~ILOCK;    // ロック解放
//     if (ip->i_flag & IWANT) {
//       ip->i_flag &= ~IWANT;
//       wakeup(&ip);           // 待機プロセス起床
//     }
//
// この sleep/wakeup による排他制御は、V6カーネル全体で
// 広く使われるパターンである(バッファキャッシュのB_BUSY/B_WANTEDも同様)。

/**
 * plock() — パイプロック取得 (pipe.c)。
 * パイプの読み書き中にinodeをロックして排他制御する。
 * ロックが取得できない場合はプロセスをスリープさせる。
 */
function handlePlock(state: SimState, op: { pid: number; pipeId: number }): string {
  const pipe = state.pipes.find(p => p.id === op.pipeId);
  if (!pipe) {
    emit(state, "error", `plock失敗: パイプ#${op.pipeId} が存在しない`);
    return `plock失敗`;
  }

  if (pipe.locked) {
    // すでにロック済み — プロセスをスリープ
    const proc = state.procs.get(op.pid);
    if (proc) {
      proc.state = "sleeping";
      proc.waitChannel = `pipe_lock_${op.pipeId}`;
      pipe.waitingPids.push(op.pid);
    }
    emit(state, "pipe_lock",
      `plock: PID ${op.pid} パイプ#${op.pipeId} ロック待ち (sleep)`,
      { pid: op.pid });
    return `plock: ロック待ち`;
  }

  pipe.locked = true;
  emit(state, "pipe_lock",
    `plock: PID ${op.pid} パイプ#${op.pipeId} ロック取得`,
    { pid: op.pid });
  return `plock: パイプ#${op.pipeId} ロック取得`;
}

/**
 * prele() — パイプロック解放 (pipe.c)。
 * ロックを解放し、待機中のプロセスをwakeupする。
 */
function handlePrele(state: SimState, op: { pid: number; pipeId: number }): string {
  const pipe = state.pipes.find(p => p.id === op.pipeId);
  if (!pipe) {
    emit(state, "error", `prele失敗: パイプ#${op.pipeId} が存在しない`);
    return `prele失敗`;
  }

  pipe.locked = false;
  // 待機中プロセスをwakeup
  for (const wPid of pipe.waitingPids) {
    const wp = state.procs.get(wPid);
    if (wp && wp.state === "sleeping") {
      wp.state = "ready";
      wp.waitChannel = "";
    }
  }
  if (pipe.waitingPids.length > 0) {
    emit(state, "pipe_unlock",
      `prele: パイプ#${op.pipeId} ロック解放 + wakeup ${pipe.waitingPids.length}プロセス`,
      { pid: op.pid });
  } else {
    emit(state, "pipe_unlock",
      `prele: パイプ#${op.pipeId} ロック解放`,
      { pid: op.pid });
  }
  pipe.waitingPids = [];
  return `prele: パイプ#${op.pipeId} ロック解放`;
}

// ─── sched ───
// 【Lions本 第2章: スワッピング (sched部)】
//
// sched()はPID 0 (swapper/scheduler) が実行する無限ループ。
// V6のmain()はカーネル初期化後にsched()に突入し、二度と戻らない。
// このループは「スワッパ」としてプロセスのスワップイン/アウトを管理する。
//
// アルゴリズム (slp.c: sched()):
//   loop:
//     1. SRUN かつ SLOAD解除(=swapped out)のプロセスを全走査
//     2. 最も長くスワップアウトされているものを選択
//     3. そのプロセスに必要なコアメモリがあるか確認
//     4. メモリ不足なら:
//        a. SSLEEP中で最低優先度のプロセスをスワップアウト
//        b. メモリ解放を待って再試行
//     5. メモリ十分なら: スワップインしてSLOADをセット
//     6. スワップ対象がなければsleep(&runout)でスワッパ自身がスリープ
//        (wakeup(&runout)はfork/exitで呼ばれる)

/**
 * sched() — スワッパー/スケジューラ (slp.c)。
 * PID 0 (swapper) が実行するメインループ。
 * 1. スワップアウトされたプロセスの中で最も長く待っているものを選択
 * 2. 十分なコアメモリがあればスワップイン
 * 3. メモリ不足ならスリープ中のプロセスをスワップアウトして空ける
 */
function handleSched(state: SimState): string {
  // スワップアウト中で最も長く待っているプロセスを探す
  let swapInCandidate: V6Process | null = null;
  let longestWait = -1;
  for (const proc of state.procs.values()) {
    if (proc.state === "swapped") {
      const wait = state.clock - proc.cpuUsage; // 簡易待ち時間推定
      if (wait > longestWait) {
        longestWait = wait;
        swapInCandidate = proc;
      }
    }
  }

  if (!swapInCandidate) {
    emit(state, "sched_swap", `sched: スワップアウト中のプロセスなし`);
    return `sched: スワップ対象なし`;
  }

  // スワップイン試行
  swapInCandidate.state = "ready";
  state.stats.swapIns++;
  emit(state, "swap_in",
    `sched: PID ${swapInCandidate.pid} (${swapInCandidate.name}) スワップイン (最長待ち)`,
    { pid: swapInCandidate.pid });

  // コアメモリが不足している場合、sleepingプロセスをスワップアウト
  let swapOutTarget: V6Process | null = null;
  let lowestPri = -1;
  for (const proc of state.procs.values()) {
    if (proc.state === "sleeping" && proc.priority > lowestPri) {
      lowestPri = proc.priority;
      swapOutTarget = proc;
    }
  }
  if (swapOutTarget) {
    swapOutTarget.state = "swapped";
    state.stats.swapOuts++;
    emit(state, "swap_out",
      `sched: PID ${swapOutTarget.pid} (${swapOutTarget.name}) スワップアウト (低優先度sleeping)`,
      { pid: swapOutTarget.pid });
  }

  emit(state, "sched_swap",
    `sched: swap in PID ${swapInCandidate.pid}${swapOutTarget ? `, swap out PID ${swapOutTarget.pid}` : ""}`);
  return `sched: in=${swapInCandidate.pid}${swapOutTarget ? `, out=${swapOutTarget.pid}` : ""}`;
}

// ─── clock_tick ───
// 【Lions本 第3章: 割り込みとトラップ (clock部)】
//
// PDP-11のLKS(Line Clock Status)レジスタが50Hz(または60Hz)で割り込む。
// clock()ハンドラ (clock.c) は以下の処理を毎tick実行する:
//
// 1. callout[]テーブルの先頭エントリのc_timeをデクリメント
//    0以下になったらc_func(c_arg)を呼び出す(タイマー発火)
//    alarm(2)のタイムアウトやデバイスのウォッチドッグに使用
//
// 2. 実行中プロセスのp_cpuを++(usr/kernに応じて)
//    この値はsetpri()で優先度計算に使われる
//
// 3. 約1秒ごと(lbolt):
//    全プロセスのp_cpuをp_cpu = p_cpu/2 で減衰(decay)
//    → CPUバウンドプロセスの優先度が徐々に下がる
//    → I/Oバウンド/対話型プロセスが相対的に高優先度を維持
//
// 4. setpri(): priority = p_cpu/2 + PUSER + p_nice を再計算
//    現在実行中よりも高優先度のプロセスがいればrunrun=1を設定
//    → 次のtrapリターン時にswtch()が呼ばれる(プリエンプション)

/**
 * clock() — クロック割り込みハンドラ (clock.c)。
 * PDP-11のLKS(Line Clock Status)レジスタが50Hz(または60Hz)で割り込む。
 * 各tickで以下を処理:
 * 1. 現在実行中プロセスのcpuUsage++
 * 2. calloutテーブルの全エントリのticks--、0になったらハンドラ発火
 * 3. 実行中プロセスの優先度を再計算
 * 4. 必要ならrunrun=1でswtch()をスケジュール
 */
function handleClockTick(state: SimState): string {
  state.clock++;

  // 実行中プロセスのCPU使用量を加算
  let runningProc: V6Process | null = null;
  for (const proc of state.procs.values()) {
    if (proc.state === "running") {
      proc.cpuUsage++;
      runningProc = proc;
      break;
    }
  }

  // calloutテーブル処理
  const firedCallouts: string[] = [];
  state.callouts = state.callouts.filter(c => {
    c.ticks--;
    if (c.ticks <= 0) {
      firedCallouts.push(c.handler);
      emit(state, "callout",
        `callout: ${c.handler}(${c.arg}) 発火 — タイマー満了`);
      return false; // 削除
    }
    return true;
  });

  // 優先度再計算 (setpri相当)
  const PUSER = 50;
  if (runningProc) {
    const newPri = Math.floor(runningProc.cpuUsage / 2) + PUSER + runningProc.nice;
    // より高優先度のreadyプロセスがいるか確認
    for (const proc of state.procs.values()) {
      if (proc.state === "ready" && proc.priority < newPri) {
        state.runrun = true;
        break;
      }
    }
    runningProc.priority = newPri;
  }

  const tickMsg = `clock tick #${state.clock}${runningProc ? ` (PID ${runningProc.pid} cpu=${runningProc.cpuUsage})` : ""}${state.runrun ? " runrun=1" : ""}`;
  emit(state, "clock_tick", tickMsg);
  state.trapTraces.push(`[intr] ${tickMsg}${firedCallouts.length > 0 ? ` callout: ${firedCallouts.join(",")}` : ""}`);
  return tickMsg;
}

// ─── iget / iput ヘルパー ───
// 【Lions本 第6章: ファイルシステム (inode管理部)】
//
// V6のインコアinode管理 (iget.c):
// ディスク上のinode(32バイト固定)をカーネルメモリ上のinode構造体にキャッシュする。
// inode[]テーブルはINODE(=100)個の固定長配列。
//
// ■ iget(dev, ino):
//   1. インコアinode配列をスキャンし、(dev, ino)が一致するエントリを探す
//   2. 見つかればi_count++(参照カウント増加)して返す
//   3. 見つからなければフリーエントリ(i_count==0)を探してディスクから読込
//   4. i_countが0のエントリはすべてのプロセスが使用終了したことを意味する
//
// ■ iput(ip):
//   1. i_count--(参照カウント減少)
//   2. i_count==0 かつ i_nlink==0 → itrunc(ip) + ifree() でinode完全解放
//   3. i_count==0 かつ i_nlink>0 → インコアテーブルから外すだけ
//      (次にigetされたときにディスクから再読込)
//
// この参照カウント方式により、open中のファイルをunlinkしても
// close()されるまでinodeとデータブロックが保持される(V6の重要な仕様)。

/**
 * iget() — inode取得 (iget.c)。
 * インコアinodeテーブルからinodeを取得し、参照カウントを増加。
 * テーブルにない場合はディスクから読み込む(このシミュレータでは既にMap内)。
 */
function iget(state: SimState, inodeNum: number): V6Inode | null {
  const inode = state.inodes.get(inodeNum);
  if (!inode) return null;
  inode.refCount++;
  emit(state, "inode_ref",
    `iget: inode#${inodeNum} refCount → ${inode.refCount}`,
    { inodeNum });
  return inode;
}

/**
 * iput() — inode解放 (iget.c)。
 * 参照カウントを減少。0かつnlink==0ならinodeとブロックを完全解放。
 */
function iput(state: SimState, inodeNum: number): void {
  const inode = state.inodes.get(inodeNum);
  if (!inode) return;
  inode.refCount--;
  emit(state, "inode_unref",
    `iput: inode#${inodeNum} refCount → ${inode.refCount}`,
    { inodeNum });
  if (inode.refCount <= 0 && inode.nlink <= 0) {
    freeInode(state, inodeNum);
  }
}

// ─── スナップショット ───

/**
 * 現在の状態をディープコピーして返す。
 * 各ステップの結果として保存され、UIでの前後移動を可能にする。
 * Map/配列/ネストオブジェクトすべてをコピーして参照の共有を防ぐ。
 */
function snapshot(state: SimState): Omit<V6StepResult, "step" | "operation" | "message" | "syscallTrace" | "contextSwitchTrace" | "nameiTrace" | "memoryMapTrace" | "trapTrace"> {
  return {
    processes: [...state.procs.values()].map(p => ({
      ...p,
      openFiles: [...p.openFiles],
      pendingSignals: [...p.pendingSignals],
      signalHandlers: { ...p.signalHandlers },
      textSeg: { ...p.textSeg },
      dataSeg: { ...p.dataSeg },
      stackSeg: { ...p.stackSeg },
      argv: [...p.argv],
    })),
    inodes: [...state.inodes.values()].map(i => ({ ...i, addr: [...i.addr] })),
    superblock: {
      ...state.superblock,
      freeBlockList: [...state.superblock.freeBlockList],
      freeInodeList: [...state.superblock.freeInodeList],
    },
    bufferCache: state.bufferCache.map(b => ({ ...b, flags: { ...b.flags } })),
    sysFileTable: state.sysFileTable.map(f => ({ ...f })),
    pipes: state.pipes.map(p => ({ ...p, buffer: [...p.buffer], waitingPids: [...p.waitingPids] })),
    textTable: state.textTable.map(t => ({ ...t })),
    swapMap: state.swapMap.map(s => ({ ...s })),
    ttys: state.ttys.map(t => ({
      ...t,
      rawq: { ...t.rawq }, canq: { ...t.canq }, outq: { ...t.outq },
      flags: { ...t.flags },
    })),
    mounts: state.mounts.map(m => ({
      ...m,
      superblock: {
        ...m.superblock,
        freeBlockList: [...m.superblock.freeBlockList],
        freeInodeList: [...m.superblock.freeInodeList],
      },
    })),
    interruptVectors: state.interruptVectors.map(v => ({ ...v })),
    sysent: state.sysent.map(s => ({ ...s })),
    bdevsw: state.bdevsw.map(b => ({ ...b })),
    cdevsw: state.cdevsw.map(c => ({ ...c })),
    callouts: state.callouts.map(c => ({ ...c })),
    disk: state.disk.map(d => ({ ...d })),
  };
}

// ─── シミュレーション実行 ───

/** デフォルト設定を返す */
export function defaultConfig(): V6Config {
  return { maxSteps: 300 };
}

/**
 * シミュレーションのメインエントリポイント。
 * 操作列を順に実行し、各ステップのスナップショットとイベントを記録する。
 * UIはこの戻り値を使ってステップ実行・巻き戻しを実現する。
 */
export function runSimulation(config: V6Config, operations: V6Operation[]): V6SimResult {
  const state = createState();
  const steps: V6StepResult[] = [];

  for (let i = 0; i < operations.length && i < config.maxSteps; i++) {
    state.step = i;
    const op = operations[i];
    const msg = executeOp(state, op);

    steps.push({
      step: i,
      operation: op,
      ...snapshot(state),
      message: msg,
      syscallTrace: [...state.syscallTraces],
      contextSwitchTrace: [...state.contextSwitchTraces],
      nameiTrace: [...state.nameiTraces],
      memoryMapTrace: [...state.memoryMapTraces],
      trapTrace: [...state.trapTraces],
    });
  }

  return { steps, events: state.events, stats: { ...state.stats } };
}

// ─── インクリメンタル実行 API ───

/**
 * インタラクティブシェル用のセッション。
 * 状態を保持しながら操作を逐次実行できる。
 */
export interface V6Session {
  /** 操作を実行し、結果ステップを返す */
  execute(op: V6Operation): V6StepResult;
  /** 操作列を一括実行し、全結果ステップを返す */
  executeBatch(ops: V6Operation[]): V6StepResult[];
  /** 現在の全ステップを取得 */
  getSteps(): V6StepResult[];
  /** 全イベントを取得 */
  getEvents(): V6Event[];
  /** 統計情報を取得 */
  getStats(): V6SimResult["stats"];
  /** シェルプロセスのPIDを取得 */
  getShellPid(): number;
  /** シェルプロセスのcwd inode番号を取得 */
  getCwd(): number;
  /** 次に割り当てられるPIDを取得（fork時のPID予測に使用） */
  getNextPid(): number;
}

/**
 * インタラクティブセッションを作成する。
 * boot + init → shell (fork/exec) を自動実行し、シェルプロセスが使える状態で返す。
 */
export function createSession(): V6Session {
  const state = createState();
  const steps: V6StepResult[] = [];

  /** 操作を1つ実行しステップを記録 */
  function exec(op: V6Operation): V6StepResult {
    state.step = steps.length;
    const msg = executeOp(state, op);
    const step: V6StepResult = {
      step: state.step,
      operation: op,
      ...snapshot(state),
      message: msg,
      syscallTrace: [...state.syscallTraces],
      contextSwitchTrace: [...state.contextSwitchTraces],
      nameiTrace: [...state.nameiTraces],
      memoryMapTrace: [...state.memoryMapTraces],
      trapTrace: [...state.trapTraces],
    };
    steps.push(step);
    return step;
  }

  // ブートとシェル起動
  exec({ op: "boot" });
  exec({ op: "fork", parentPid: 1, childName: "sh" });
  const shPid = steps[steps.length - 1]!.processes.find(p => p.name === "sh")?.pid ?? 2;
  exec({ op: "exec", pid: shPid, path: "/bin/sh", argv: ["/bin/sh"] });

  return {
    execute(op: V6Operation): V6StepResult {
      return exec(op);
    },
    executeBatch(ops: V6Operation[]): V6StepResult[] {
      return ops.map(op => exec(op));
    },
    getSteps(): V6StepResult[] {
      return steps;
    },
    getEvents(): V6Event[] {
      return state.events;
    },
    getStats(): V6SimResult["stats"] {
      return { ...state.stats };
    },
    getShellPid(): number {
      return shPid;
    },
    getCwd(): number {
      return state.procs.get(shPid)?.cwd ?? 1;
    },
    getNextPid(): number {
      return state.nextPid;
    },
  };
}
