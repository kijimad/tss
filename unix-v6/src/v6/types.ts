/*
 * Unix V6 シミュレーター 型定義
 *
 * Unix V6 (1975年、AT&Tベル研究所) はKen ThompsonとDennis Ritchieが
 * PDP-11ミニコンピュータ向けに開発したオペレーティングシステム。
 * John Lionsの「Lions' Commentary on UNIX」(1977年)で解説され、
 * 世界中の大学でOS教育の教材となった歴史的に重要なシステムである。
 *
 * このファイルではV6の主要なデータ構造を型として定義する。
 * 実機のCソースコード (param.h, proc.h, inode.h, buf.h, file.h等) の
 * 構造体に対応している。
 */

// ─── 定数 ───
// V6実機の param.h に定義されていた定数群

/**
 * V6ブロックサイズ: 512バイト。
 * PDP-11のRK05ディスクパック (2.5MB) のセクタサイズに由来する。
 * 現代のファイルシステム(4096バイト)と比べると非常に小さい。
 */
export const V6_BLOCK_SIZE = 512;

/**
 * inodeのブロックアドレス数: 13個。
 * V6のinodeはディスク上で32バイト固定長。13個のブロックアドレスを持ち、
 * 各アドレスは3バイト(24ビット)で表現される。
 * この「13アドレス」方式は現代のext2/3/4にまで受け継がれている。
 */
export const V6_INODE_ADDRS = 13;

/**
 * 直接ブロック数: 10個。
 * addr[0]〜addr[9] はデータブロックを直接指す。
 * 512B × 10 = 5120バイトまでのファイルは間接ブロック不要。
 * 当時のファイルは小さかったため、大半のファイルがこの範囲に収まった。
 */
export const V6_DIRECT_BLOCKS = 10;

/**
 * 間接ブロック開始位置: addr[10]。
 * addr[10] = 単純間接 (256 × 512B = 128KB 追加)
 * addr[11] = 二重間接 (256 × 256 × 512B = 32MB 追加)
 * addr[12] = 三重間接 (256^3 × 512B = 8GB 追加、理論値)
 * 実際にはPDP-11の16ビットアドレス空間の制約で、
 * ファイルサイズは約16MBが上限だった。
 */
export const V6_INDIRECT_START = 10;

/**
 * ディレクトリエントリのファイル名最大長: 14文字。
 * V6のディレクトリエントリは16バイト固定:
 * - 2バイト: inode番号 (16ビット、最大65535 inodes)
 * - 14バイト: ファイル名 (NUL終端なし、短ければNULパディング)
 * この14文字制限はBSD 4.2 (1983年) のFFS導入まで続いた。
 */
export const V6_FILENAME_MAX = 14;

/**
 * 最大プロセス数: 50 (V6実機では param.h で NPROC=50)。
 * PDP-11/40の64KB物理メモリでは、同時に走れるプロセス数は限られた。
 * proc[]テーブルは固定長配列で、空きスロットを線形探索して使う。
 */
export const V6_NPROC = 50;

/**
 * プロセスあたり最大オープンファイル数: 15。
 * V6のuser構造体(u.u_ofile[NOFILE])で管理される。
 * 0=stdin, 1=stdout, 2=stderr がシェルによって慣例的に割り当てられる。
 * (V6カーネル自体はfd番号に特別な意味を持たせていない)
 */
export const V6_NOFILE = 15;

/**
 * システムファイルテーブルの最大エントリ数: 100 (file.h: NFILE)。
 * V6カーネル全体で同時にオープンできるファイル数の上限。
 * 個々のプロセスのNOFILE(15)とは別に、カーネル全体の上限として機能する。
 * file[NFILE]配列はfalloc() (fio.c)で空きスロットを線形探索する。
 */
export const V6_NFILE = 100;

/**
 * バッファキャッシュサイズ: 15バッファ。
 * V6実機では NBUF=15 (param.h)。ブロックI/Oはすべてこのキャッシュを経由する。
 * V6のバッファキャッシュはUNIX史上最初の本格的なディスクキャッシュ実装であり、
 * その設計(LRU置換、遅延書き込み)は現代のOSにも影響を与えている。
 */
export const V6_NBUF = 15;

// ─── スワッピング / メモリ管理 ───
// V6のスワッピングサブシステム (slp.c: sched(), text.h: struct text)
// PDP-11の限られた物理メモリ(64KB〜256KB)でマルチプロセスを実現するため、
// 実行中でないプロセスをスワップデバイス(RK05ディスク)に退避する。
//
// スワッパ(PID 0, sched()):
// - 最も長くスワップアウトされているプロセスをスワップインする
// - メモリ不足ならスリープ中のプロセスをスワップアウトする
// - テキストセグメント共有によりメモリを節約
//
// テキストセグメント共有 (text.h, text.c):
// - 同じ実行ファイルのテキスト(コード)セグメントを複数プロセスで共有
// - xalloc(): テキストセグメントの割当(既存ならx_count++)
// - xfree(): テキストセグメントの解放(x_count--、0なら物理メモリ解放)
// - xccdec(): テキストセグメントのコア側カウントをデクリメント

/**
 * テキストテーブルエントリ (text.h: struct text)。
 * 共有テキストセグメントを管理する。
 * 同じ実行ファイルの複数プロセスがテキストセグメントを共有することで
 * メモリを節約する。V6のtext[]は固定長テーブル(NTEXT=40)。
 */
export interface V6TextEntry {
  /** テキストテーブル内のインデックス */
  index: number;
  /** このテキストセグメントに対応するinode番号 (text.h: x_iptr) */
  inodeNum: number;
  /** テキストセグメントの物理アドレス (text.h: x_caddr) */
  coreAddr: number;
  /** スワップデバイス上のアドレス (text.h: x_daddr) */
  swapAddr: number;
  /** テキストセグメントのサイズ (text.h: x_size) */
  size: number;
  /** このテキストを参照しているプロセス数 (text.h: x_count) */
  refCount: number;
  /** コア(物理メモリ)上のコピー数 (text.h: x_ccount) */
  coreCount: number;
  /** 実行ファイルパス (表示用) */
  path: string;
}

/**
 * スワップマップエントリ。
 * V6のスワップデバイス上の空き領域を管理する (dmr.c: struct map)。
 * map[]配列のエントリは(サイズ, アドレス)のペア。
 * malloc() (dmr.c) でfirst-fitアルゴリズムで空き領域を検索する。
 */
export interface V6SwapMapEntry {
  /** 空き領域の開始ブロック */
  addr: number;
  /** 空き領域のサイズ(ブロック数) */
  size: number;
}

// ─── 割り込み / トラップ ───
// V6のPDP-11はベクタ割り込み方式を採用。
// 割り込みベクタは物理アドレス0番地から配置され、
// 各ベクタは(PC, PSW)の2ワード(4バイト)で構成される。
//
// 割り込み優先レベル (BR4-BR7):
// - BR7: 最高優先度 (メモリ管理フォルト)
// - BR6: クロック
// - BR5: ディスク (RK11等)
// - BR4: 端末 (KL11等)
//
// トラップ:
// - trap命令(0134000): システムコール呼び出し
// - BPT(0000003): ブレークポイントトラップ(ptrace)
// - EMT(0104000): エミュレータトラップ
// - IOT(0000004): I/Oトラップ

/**
 * 割り込みベクタエントリ (vectors.s に対応)。
 * PDP-11の割り込みベクタテーブルを表現する。
 */
export interface V6InterruptVector {
  /** ベクタアドレス (0, 4, 8, ..., 1000) */
  address: number;
  /** 割り込みハンドラ名 */
  handler: string;
  /** 割り込み優先レベル (0-7, 7が最高) */
  priority: number;
  /** 説明 */
  description: string;
}

/**
 * sysent[]エントリ (sysent.c: struct sysent)。
 * V6のシステムコールディスパッチテーブル。
 * trap()ハンドラがr0レジスタのシステムコール番号をインデックスとして
 * sysent[]を引き、対応する関数を呼び出す。
 */
export interface V6SysEntry {
  /** システムコール番号 (0〜63) */
  number: number;
  /** システムコール名 */
  name: string;
  /** 引数の数 (sysent.c: narg) */
  narg: number;
  /** カーネル内ハンドラ関数名 (sysent.c: call) */
  handler: string;
}

// ─── キャラクタI/O / TTY ───
// V6のキャラクタI/Oサブシステム (tty.c, kl.c)
// 端末(テレタイプ)とカーネルの間のデータフローを管理する。
//
// clist (文字リスト):
// - cblock(6文字)の連結リストで可変長文字キューを実現
// - putc()/getc() で1文字ずつ操作
// - 割り込みハンドラとプロセスが共有するため、spl5()で排他制御
//
// TTY構造体 (tty.h: struct tty):
// - t_rawq: 生入力キュー (エコーバック用)
// - t_canq: 正規入力キュー (行編集完了後の行)
// - t_outq: 出力キュー
// - ライン規約 (line discipline): 行編集、特殊文字処理
//
// 特殊文字:
// - DEL (0177): 割り込み文字 → SIGINT
// - FS (034): 終了文字 → SIGQUIT (+ コアダンプ)
// - @ (0100): 行削除 (V6独特の仕様)
// - # (043): 文字削除 (BSの代わり、V6独特)
// - EOT (004): EOF (^D)

/**
 * cblock (tty.h: struct cblock)。
 * キャラクタリスト(clist)の基本単位。6文字を保持する小さなバッファ。
 * 割り込みレベルで操作されるため、フリーリストからの割当/解放は
 * SPL5()で割り込みを禁止して行う。
 */
export interface V6Cblock {
  /** ブロック内の文字データ (最大6文字) */
  chars: string;
  /** フリーリストまたは次のcblockへのポインタ (表示用) */
  next: number;
}

/**
 * clist (キャラクタリスト)。
 * cblockの連結リストで実装される可変長文字キュー。
 * putc(c, q)/getc(q) でFIFO操作される。
 */
export interface V6Clist {
  /** キュー内の文字データ (簡略化: cblock連結ではなく文字列で表現) */
  data: string;
  /** キュー内の文字数 (tty.h: c_cc) */
  count: number;
}

/**
 * TTY構造体 (tty.h: struct tty)。
 * 端末デバイスの状態を管理する。V6では各端末(コンソール、テレタイプ)に
 * 1つのtty構造体が対応する。
 */
export interface V6Tty {
  /** デバイス番号 (tty.h: t_dev) */
  device: number;
  /** 端末名 (例: "/dev/tty0", "/dev/console") */
  name: string;
  /**
   * 生入力キュー (tty.h: t_rawq)。
   * 割り込みハンドラが受信文字をここに入れる。
   * エコーバックは生入力キューから行われる。
   */
  rawq: V6Clist;
  /**
   * 正規入力キュー (tty.h: t_canq)。
   * ライン規約(canon)処理後の行が入る。
   * プロセスのread()はこのキューからデータを取得する。
   * 改行またはEOTで行が完成し、rawqからcanqに移動される。
   */
  canq: V6Clist;
  /**
   * 出力キュー (tty.h: t_outq)。
   * プロセスのwrite()で文字がここに入り、
   * 出力割り込みハンドラがデバイスに送信する。
   */
  outq: V6Clist;
  /** TTY状態フラグ (tty.h: t_flags) */
  flags: {
    /** ECHO: 入力文字のエコーバック */
    echo: boolean;
    /** CRMOD: CRをCR+LFに変換 */
    crmod: boolean;
    /** RAW: 生モード(ライン規約バイパス) */
    raw: boolean;
    /** XTABS: タブをスペースに展開 */
    xtabs: boolean;
    /** HUPCL: 最後のclose時にハングアップ */
    hupcl: boolean;
  };
  /**
   * 消去文字 (tty.h: t_erase)。
   * V6では '#'(0x23)。現代では Backspace。
   */
  eraseChar: string;
  /**
   * 行削除文字 (tty.h: t_kill)。
   * V6では '@'(0x40)。現代では Ctrl-U。
   */
  killChar: string;
  /** 割り込み文字 → SIGINT。V6では DEL (0x7F) */
  intrChar: string;
  /** 終了文字 → SIGQUIT。V6では FS (0x1C, Ctrl-\) */
  quitChar: string;
  /** このTTYを制御端末とするプロセスグループ (表示用) */
  pgrp: number;
  /** 接続状態 */
  isOpen: boolean;
  /** ボーレート (tty.h: t_speeds) */
  speed: number;
  /**
   * 現在の出力カラム位置 (tty.h: t_col)。
   * ttyoutput()でタブ展開をカラム境界に合わせるために使用。
   * 改行でリセット、文字出力で++。
   */
  column: number;
  /**
   * LCASE: 大文字端末フラグ (tty.h: t_flags & LCASE)。
   * 旧式のテレタイプ端末は大文字しか出力できなかったため、
   * 小文字→大文字変換し、元の大文字には\プレフィックスを付与する。
   */
  lcase: boolean;
}

// ─── ブロックデバイスドライバ ───
// V6のデバイスドライバはbdevsw[]/cdevsw[]テーブルで管理される。
// ブロックデバイス(ディスク)とキャラクタデバイス(端末)で
// 異なるインターフェースを提供する。
//
// ブロックデバイスドライバの3フェーズ:
// 1. strategy(bp): I/O要求をデバイスキューに投入
// 2. start(): 物理デバイスの転送を開始
// 3. interrupt(): 転送完了割り込みを処理し、brelse()でバッファ解放
//
// V6のRK11ディスクドライバ (rk.c):
// - RK05ディスクパック: 2.5MB, 4872ブロック
// - シリンダ/サーフェス/セクタでアドレッシング
// - ソフトウェアI/Oキューはエレベータアルゴリズム(C-SCAN)ではなく単純FIFO

/**
 * ブロックデバイススイッチテーブルエントリ (conf.h: struct bdevsw)。
 * デバイス番号(メジャー番号)をインデックスとして、
 * 対応するドライバの関数群を取得する。
 */
export interface V6Bdevsw {
  /** メジャーデバイス番号 */
  major: number;
  /** デバイス名 */
  name: string;
  /** open関数名 */
  d_open: string;
  /** close関数名 */
  d_close: string;
  /** strategy関数名 (ブロックI/O要求の投入) */
  d_strategy: string;
  /** ルートデバイスとして使用可能か */
  d_root: boolean;
}

/**
 * キャラクタデバイススイッチテーブルエントリ (conf.h: struct cdevsw)。
 * 端末、プリンタなどのキャラクタデバイスのドライバインターフェース。
 */
export interface V6Cdevsw {
  /** メジャーデバイス番号 */
  major: number;
  /** デバイス名 */
  name: string;
  /** open関数名 */
  d_open: string;
  /** close関数名 */
  d_close: string;
  /** read関数名 */
  d_read: string;
  /** write関数名 */
  d_write: string;
  /** ioctl関数名 (V6では sgtty) */
  d_sgtty: string;
}

// ─── マウント ───
// V6のmount()はファイルシステムをディレクトリツリーに接合する。
// mount[]テーブル(NMOUNT=5)で管理され、namei()がマウントポイントを
// 越えるときにm_bufpのスーパーブロック経由で別デバイスに遷移する。

/**
 * マウントテーブルエントリ (mount.h: struct mount)。
 * V6は最大5つのファイルシステムを同時マウント可能。
 */
export interface V6MountEntry {
  /** マウントされたデバイス番号 (mount.h: m_dev) */
  device: number;
  /** マウント先のinode番号 (mount.h: m_inodp) */
  mountPoint: number;
  /** デバイスのスーパーブロック (mount.h: m_bufp) */
  superblock: V6SuperBlock;
  /** デバイス名 (表示用) */
  deviceName: string;
  /** マウントポイントのパス (表示用) */
  mountPath: string;
}

// ─── プロセスサブシステム ───
// V6のプロセス管理はproc.h/slp.cで実装されている。
// プロセステーブル(proc[])は固定長配列で、各エントリがプロセスの状態を保持する。
// V6のプロセスモデルはfork/exec/wait/exitの4つのシステムコールが中核で、
// この設計は50年経った現在のLinux/macOSでも基本的に変わっていない。

/**
 * V6プロセス状態。proc.h の p_stat フィールドに対応する。
 *
 * 状態遷移:
 *   unused → embryo(fork) → ready(メモリ取得) → running(CPU割当)
 *   running → sleeping(I/O待ち等) → ready(wakeup) → running
 *   running → zombie(exit) → [親のwaitで回収]
 *   running/ready ⇄ swapped(メモリ不足時にスワップアウト)
 *
 * V6ではこの状態遷移がslp.c/swtch()で管理されていた。
 */
export type V6ProcState =
  | "unused"    // SNULL: プロセステーブル空きスロット
  | "embryo"    // fork()直後、まだメモリイメージが完成していない
  | "ready"     // SRUN: 実行可能、CPUの割当を待っている
  | "running"   // SRUN+SLOAD: CPU上で実行中(同時に1つのみ)
  | "sleeping"  // SSLEEP: チャネル(waitChannel)でイベント待ち
  | "zombie"    // SZOMB: 終了済み、親のwait()による回収待ち
  | "stopped"   // SSTOP: シグナル(SIGTRAP等)で停止中
  | "swapped";  // SSWAP: メモリからスワップデバイスに退避中

/**
 * V6シグナル（オリジナル13個）。sig.h で定義されていた。
 *
 * V6のシグナル機構は非常にシンプルで、ハンドラは3択:
 * - SIG_DFL (0): デフォルト動作(大半は終了)
 * - SIG_IGN (1): 無視
 * - 関数ポインタ: ユーザー定義ハンドラ(一度だけ実行後デフォルトに戻る)
 *
 * この「ワンショット」セマンティクスは後にBSD/POSIXで改善された。
 * V6ではシグナルマスクやシグナルキューの概念はなく、
 * 保留シグナルはプロセスのp_sigフィールドにビットマップで保持された。
 */
export type V6Signal =
  | "SIGHUP"    // 1: 端末(ハングアップ)切断。モデム接続断等
  | "SIGINT"    // 2: 端末割り込み。DELキーで送信
  | "SIGQUIT"   // 3: 終了+コアダンプ。FSキー(Ctrl-\)で送信
  | "SIGILL"    // 4: 不正命令。PDP-11の未定義命令実行時
  | "SIGTRAP"   // 5: トレーストラップ。ptrace()デバッグ用
  | "SIGIOT"    // 6: IOT命令。PDP-11固有のI/Oトラップ
  | "SIGEMT"    // 7: EMT命令。PDP-11のエミュレータトラップ
  | "SIGFPE"    // 8: 浮動小数点例外。0除算やオーバーフロー
  | "SIGKILL"   // 9: 強制終了。唯一の捕捉・無視不可シグナル
  | "SIGBUS"    // 10: バスエラー。奇数アドレスへのワードアクセス等
  | "SIGSEGV"   // 11: セグメンテーション違反。メモリ保護違反
  | "SIGSYS"    // 12: 不正システムコール番号
  | "SIGPIPE";  // 13: パイプ破壊。読み手のいないパイプへの書き込み

/**
 * メモリセグメント。PDP-11のメモリ管理ユニット(MMU)による
 * セグメンテーション方式に対応する。V6はページングではなく
 * セグメンテーションでメモリ保護を行っていた。
 */
export interface V6Segment {
  /** セグメントの物理アドレス開始位置 */
  base: number;
  /** セグメントのサイズ(バイト) */
  size: number;
}

/**
 * V6プロセステーブルエントリ。
 * proc.h の struct proc と user.h の struct user を統合したもの。
 *
 * V6実機ではプロセス情報が2箇所に分散していた:
 * - proc[]: 常にメモリに常駐する最小限の情報(状態、優先度、PID等)
 * - user構造体(u.): プロセス実行中のみ参照可能な拡張情報(FDテーブル、cwd等)
 *
 * proc[]は全プロセスの状態を見る必要があるためスワップ対象外だが、
 * user構造体はプロセスごとにスワップされる。
 * このシミュレータでは簡潔さのため両者を1つのインターフェースに統合している。
 */
export interface V6Process {
  /** プロセスID。V6ではshortで0〜32767 */
  pid: number;
  /** 親プロセスID。fork()時に設定される */
  ppid: number;
  /** ユーザーID。ファイルアクセス権チェックに使用 */
  uid: number;
  /** グループID */
  gid: number;
  /** プロセス状態 (proc.h: p_stat) */
  state: V6ProcState;
  /** プロセス名(コマンド名)。表示用 */
  name: string;
  /**
   * スケジューリング優先度 (proc.h: p_pri)。
   * 値が小さいほど高優先度。0がカーネルモード最高、50+(PUSER)がユーザーモード。
   * 計算式: priority = cpuUsage / 2 + PUSER + nice
   */
  priority: number;
  /** nice値。ユーザーが設定する優先度調整値。正の値でプロセスの優先度を下げる */
  nice: number;
  /**
   * 最近のCPU使用量 (proc.h: p_cpu)。
   * クロック割り込みごとに++され、スケジューリング時に半減(p_cpu = p_cpu/2)。
   * この「減衰」により、長時間CPUを使ったプロセスの優先度が徐々に下がる。
   */
  cpuUsage: number;
  /**
   * sleep中のチャネル名 (proc.h: p_wchan)。
   * V6のsleep/wakeupはチャネル(アドレス)ベース。
   * sleep(chan)で指定チャネルで寝て、wakeup(chan)で同じチャネルの全プロセスを起こす。
   * この設計は「thundering herd問題」を引き起こすが、シンプルで効果的だった。
   */
  waitChannel: string;
  /** 終了コード (user.h: u_arg[0] at exit) */
  exitCode: number;
  /**
   * テキストセグメント (命令コード)。
   * PDP-11のI空間に配置。V6では複数プロセスでテキストセグメントを共有可能
   * (text構造体で管理。いわゆる「共有テキスト」機能)。
   */
  textSeg: V6Segment;
  /**
   * データセグメント (グローバル変数、ヒープ)。
   * PDP-11のD空間に配置。brk()システムコールで拡張可能。
   */
  dataSeg: V6Segment;
  /**
   * スタックセグメント。上位アドレスから下方向に成長する。
   * PDP-11ではスタックオーバーフローをハードウェアで検出し、
   * 自動的にセグメントサイズを拡張する。
   */
  stackSeg: V6Segment;
  /**
   * ファイルディスクリプタテーブル (user.h: u_ofile[NOFILE])。
   * 最大15個。各エントリはシステムファイルテーブルへのポインタ。
   * fork()時にコピーされ、exec()時に保持される。
   * nullはそのfdスロットが空いていることを示す。
   */
  openFiles: (V6FileDescriptor | null)[];
  /** 保留シグナル (proc.h: p_sig)。V6ではビットマップだが、ここでは配列で表現 */
  pendingSignals: V6Signal[];
  /**
   * シグナルハンドラ設定 (user.h: u_signal[NSIG])。
   * V6では各シグナルに対して3つの動作を設定可能:
   * - "default": デフォルト動作(大半は終了)
   * - "ignore": シグナルを無視
   * - "catch": ユーザー定義ハンドラを実行(V6ではワンショット)
   */
  signalHandlers: Partial<Record<V6Signal, "default" | "ignore" | "catch">>;

  /**
   * ptrace(2)トレースフラグ (proc.h: p_flag & STRC)。
   * trueの場合、このプロセスは親プロセスによりトレースされている。
   * システムコール前後やシグナル受信時にSTOPPED状態になり、
   * 親プロセスにSIGTRAPを送信する。
   */
  traced: boolean;
  /** 実行ファイルのパス名 */
  execPath: string;
  /** コマンド引数 (exec時に設定) */
  argv: string[];
  /**
   * カレントディレクトリのinode番号 (user.h: u_cdir)。
   * chdir()で変更される。パス解決の起点となる。
   * fork()で子プロセスに継承される。
   */
  cwd: number;
}

// ─── ファイルシステム ───
// V6ファイルシステムはKen Thompsonが設計した「i-node」方式の元祖。
// ファイル名とファイルデータを分離し、inodeにメタデータを集約する設計は
// 革新的で、ext2/3/4, XFS, UFS等の現代FSの直接の祖先となった。
//
// ディスクレイアウト:
//   ブロック0: ブートブロック (ブートローダ)
//   ブロック1: スーパーブロック (FS全体のメタデータ)
//   ブロック2〜: inodeテーブル (1ブロック = 16 inodes × 32バイト)
//   残り:       データブロック (ファイルデータ、ディレクトリ、間接ブロック)

/**
 * V6ファイルモードビット (inode.h: i_mode の上位4ビット)。
 * mode の構造: [ファイル種別 4bit][SUID/SGID/sticky 3bit][rwx×3 9bit]
 *
 * 例: 0o100644 = 通常ファイル、owner=rw、group=r、other=r
 * 例: 0o040755 = ディレクトリ、owner=rwx、group=rx、other=rx
 */
export const V6_IFREG = 0o100000;  // 通常ファイル
export const V6_IFDIR = 0o040000;  // ディレクトリ
export const V6_IFCHR = 0o020000;  // キャラクタデバイス (端末、プリンタ等)
export const V6_IFBLK = 0o060000;  // ブロックデバイス (ディスク等)

/**
 * V6 inode（ディスク上の表現）。inode.h の struct inode に対応する。
 *
 * V6のinodeはディスク上で32バイト固定長:
 *   i_mode (2B) + i_nlink (1B) + i_uid (1B) + i_gid (1B) + i_size0 (1B)
 *   + i_size1 (2B) + i_addr[8] (16B=8×2B圧縮) + i_atime (4B) + i_mtime (4B)
 *
 * 注: ディスク上のaddr[]は8エントリだが、メモリ上のinodeでは13エントリに展開される。
 * (ディスクでは各アドレスが3バイト×8を2バイト×8に圧縮して格納)
 *
 * inodeはファイルの「すべて」を知っている:
 * - ファイルの種類(通常/ディレクトリ/デバイス)
 * - 所有者とパーミッション
 * - ファイルサイズ
 * - データブロックの場所(addr[])
 * - タイムスタンプ
 * ただしファイル名は知らない(ディレクトリエントリが名前→inodeの対応を持つ)。
 */
export interface V6Inode {
  /** inode番号。ファイルシステム内でファイルを一意に識別する。inode#1がルートディレクトリ */
  inodeNum: number;
  /**
   * ファイル種別 + パーミッション (inode.h: i_mode)。
   * 上位4ビットがファイル種別(IFREG/IFDIR/IFCHR/IFBLK)、
   * 下位12ビットがSUID/SGID/sticky + rwxパーミッション。
   */
  mode: number;
  /**
   * ハードリンク数 (inode.h: i_nlink)。
   * このinodeを参照するディレクトリエントリの数。
   * nlink=0 になるとファイルが削除される(ただしオープン中は遅延解放)。
   * ディレクトリは "." と親の ".." で最低2。
   */
  nlink: number;
  /** ファイル所有者のユーザーID */
  uid: number;
  /** ファイル所有者のグループID */
  gid: number;
  /**
   * ファイルサイズ（バイト）。
   * V6では24ビット(i_size0:8bit + i_size1:16bit)で表現。最大16MB。
   */
  size: number;
  /**
   * 13ブロックアドレス (inode.h: i_addr[])。
   * V6のファイルデータの場所を指定する核心部分:
   *
   *   addr[0]〜addr[9]:  直接ブロック (各512B、計5120B)
   *   addr[10]:          単純間接ブロック
   *                      → 間接ブロック内に256個のアドレスが入る
   *                      → 256 × 512B = 128KB 追加
   *   addr[11]:          二重間接ブロック
   *                      → 256 × 256 × 512B = 32MB 追加
   *   addr[12]:          三重間接ブロック
   *                      → 256^3 × 512B = 8GB 追加 (理論値)
   *
   * 値0はブロック未割当を示す(スパースファイル対応)。
   *
   * 例: 6000バイトのファイル
   *   addr[0]=100  → ブロック100にデータ(0〜511バイト目)
   *   ...
   *   addr[9]=109  → ブロック109にデータ(4608〜5119バイト目)
   *   addr[10]=200 → ブロック200は間接ブロック
   *     間接ブロック内: [110, 0, 0, ...]
   *       ブロック110にデータ(5120〜5631バイト目)
   */
  addr: number[];
  /**
   * メモリ内参照カウント (iget/iput)。
   * iget()で++、iput()で--。0かつnlink==0でinode解放。
   * V6実機ではinodeテーブルの各エントリがi_countフィールドを持っていた。
   * open, exec, chdir等でinodeにアクセスする際にiget()で参照を取得し、
   * 使用後にiput()で解放する。
   */
  refCount: number;
  /** アクセス時刻。V6ではエポック(1970-01-01)からの秒数 */
  atime: number;
  /** 最終更新時刻 */
  mtime: number;
}

/**
 * V6ディレクトリエントリ。
 *
 * V6のディレクトリは「特殊なファイル」で、データが16バイト固定長エントリの列:
 *   struct { int d_ino; char d_name[14]; };
 *
 * - d_ino: inode番号(2バイト、リトルエンディアン)。0は空きエントリ
 * - d_name: ファイル名(14バイト、NUL終端なし)
 *
 * 特殊エントリ:
 * - "."  : 自分自身のinode
 * - ".." : 親ディレクトリのinode
 *
 * ファイル名の14文字制限は長年UNIXユーザーを悩ませ、
 * BSD 4.2のFFS(1983年)で255文字に拡張された。
 */
export interface V6DirEntry {
  name: string;
  inode: number;
}

/**
 * V6スーパーブロック (filsys.h の struct filsys)。
 * ディスクのブロック1に格納される、ファイルシステム全体のメタデータ。
 *
 * V6のフリーブロック管理は「連鎖方式」(linked list free block management):
 * - スーパーブロックに最大100個のフリーブロック番号を保持
 * - リストの先頭(s_free[0])は次の100個のフリーブロック番号を格納した
 *   ブロックを指す(チェーン)
 * - alloc時はリスト末尾からpop、リストが空になったら先頭ブロックから
 *   次の100個をロード
 *
 * フリーinode管理:
 * - スーパーブロックに最大100個のフリーinode番号をキャッシュ
 * - キャッシュが空になったらinode領域を線形走査して補充
 * - free時はキャッシュに追加(満杯なら捨てる、次の走査で再発見される)
 */
export interface V6SuperBlock {
  /** ファイルシステム総ブロック数 (filsys.h: s_fsize) */
  totalBlocks: number;
  /** inode総数 (filsys.h: s_isize × 16) */
  totalInodes: number;
  /**
   * フリーブロックリスト (filsys.h: s_free[100])。
   * 連鎖方式: リスト先頭のブロック内に次の100個のフリーブロック番号が入っている
   */
  freeBlockList: number[];
  /**
   * フリーinodeリスト (filsys.h: s_inode[100])。
   * 最大100個のキャッシュ。枯渇時はinode領域をスキャンして補充する
   */
  freeInodeList: number[];
  /** フリーブロック総数 (filsys.h: s_tfree) */
  freeBlockCount: number;
  /** フリーinode総数 (filsys.h: s_tinode) */
  freeInodeCount: number;
  /** 変更フラグ (filsys.h: s_fmod)。trueならsync時にディスクへ書き戻す */
  modified: boolean;
  /** 読み取り専用マウントフラグ (filsys.h: s_ronly) */
  readOnly: boolean;
}

// ─── バッファキャッシュ ───
// V6のバッファキャッシュ(bio.c)はブロックI/Oの中間層。
// 全てのディスクアクセスはこのキャッシュを経由する。
//
// 動作原理:
// 1. ブロック読込要求 → キャッシュにあれば即座に返す(ヒット)
// 2. キャッシュになければディスクから読み込み、キャッシュに格納(ミス)
// 3. 書き込みはキャッシュ上のバッファを更新しdirtyフラグを立てる
// 4. dirtyバッファはsync時またはLRUエビクト時にディスクに書き戻す
//
// V6実機ではバッファは二重連結リスト(av_forw/av_back)でLRU管理され、
// ハッシュチェーン(b_forw/b_back)で高速検索される。
// このシミュレータでは配列とlastAccessフィールドで簡易的に再現する。

/**
 * バッファフラグ (buf.h: b_flags)。
 * V6実機では B_READ, B_WRITE, B_DONE, B_ERROR, B_BUSY, B_WANTED,
 * B_ASYNC, B_DELWRI 等のビットフラグで管理されていた。
 */
export interface V6BufFlags {
  /** B_DONE相当: バッファのデータが有効(ディスクから読み込み済み) */
  valid: boolean;
  /** B_DELWRI相当: データが変更されており、ディスクへの書き戻しが必要 */
  dirty: boolean;
  /** B_BUSY相当: このバッファは現在使用中(他プロセスは待機する必要がある) */
  busy: boolean;
  /** B_WANTED相当: busyバッファの解放を待っているプロセスがいる */
  wanted: boolean;
}

/**
 * バッファキャッシュエントリ (buf.h: struct buf)。
 * ディスクの1ブロック(512バイト)分のデータをメモリ上にキャッシュする。
 * device + blockNum の組み合わせでキャッシュキーとする。
 */
export interface V6Buffer {
  /** デバイス番号 (buf.h: b_dev)。複数ディスクを区別する */
  device: number;
  /** ブロック番号 (buf.h: b_blkno)。ディスク上のブロック位置 */
  blockNum: number;
  /** ブロックデータの表示用サマリ (実機では b_addr が512バイトのメモリ領域を指す) */
  data: string;
  /** バッファの状態フラグ */
  flags: V6BufFlags;
  /** LRU管理用タイムスタンプ。最もlastAccessが古いバッファがエビクト対象 */
  lastAccess: number;
}

// ─── ファイルテーブル ───
// V6のファイルI/Oは3層のテーブルで管理される:
//
//   プロセス            カーネル共有            ディスク
//   ┌─────────┐      ┌──────────────┐      ┌────────┐
//   │u_ofile[]│─────→│file[] (sysfile)│─────→│inode[] │
//   │ fd=0    │  idx │ offset=1024   │ ino# │ mode   │
//   │ fd=1    │      │ refCount=2    │      │ size   │
//   │ fd=2    │      │ mode="read"   │      │ addr[] │
//   └─────────┘      └──────────────┘      └────────┘
//
// この3層構造の設計意図:
// 1. fdテーブル: プロセスごとに独立。fork()でコピーされる
// 2. sysfile: プロセス間で共有可能。fork()でrefCount++
//    → 親子プロセスが同じoffsetを共有する(V6のforkの重要な特性)
// 3. inode: ファイルの実体。複数のsysfileから参照可能(open2回など)
//
// この設計により:
// - fork後の親子がファイルオフセットを共有する(パイプ通信の基盤)
// - 同じファイルを別々にopenすると独立したoffsetになる
// - dup()は同じsysfileを共有する(I/Oリダイレクションの基盤)

/**
 * プロセスごとのファイルディスクリプタ (user.h: u_ofile[NOFILE])。
 * fd番号からシステムファイルテーブルへのインデックスへのマッピング。
 * これがいわゆる「ファイルディスクリプタ」の正体。
 */
export interface V6FileDescriptor {
  /** ファイルディスクリプタ番号 (0〜14) */
  fd: number;
  /** システムファイルテーブルへのインデックス (user.h: u_ofile[fd] の値) */
  sysFileIdx: number;
}

/**
 * システムファイルテーブルエントリ (file.h: struct file)。
 * 全プロセスで共有されるカーネル内グローバルテーブル。
 *
 * fork()時: 子プロセスが同じエントリを指すようにし、refCount++。
 *   → 親子がオフセットを共有する(重要: パイプが機能する理由)
 * dup()時: 新しいfd が同じエントリを指し、refCount++。
 *   → I/Oリダイレクション(2>&1等)が機能する理由。
 * close()時: refCount--。0になったらエントリ解放。
 */
export interface V6SysFile {
  /** テーブル内インデックス */
  index: number;
  /** 対応するinode番号 (file.h: f_inode) */
  inodeNum: number;
  /**
   * 読み書きオフセット (file.h: f_offset)。
   * read/writeで自動的に進む。lseek()で任意位置に移動可能。
   * fork()で共有されるため、親がreadしたら子のoffsetも進む。
   */
  offset: number;
  /**
   * 参照カウント (file.h: f_count)。
   * fork()やdup()で++、close()で--。0になったらエントリ解放。
   */
  refCount: number;
  /** オープンモード (file.h: f_flag の FREAD/FWRITE) */
  mode: "read" | "write" | "readwrite";
}

/**
 * V6パイプ。
 *
 * V6のパイプは特殊なinodeを介して実装される(pipe.c):
 * - pipe()はinodeを1つ割り当て、読み取り用/書き込み用の2つのfdを返す
 * - パイプのバッファサイズはV6_BLOCK_SIZE × 10 = 5120バイト
 * - 読み手がいないパイプに書き込むとSIGPIPEが送信される
 *
 * パイプはfork()で子プロセスに継承されるため、
 * 典型的な使い方は: pipe() → fork() → 親がwrite → 子がread。
 * シェルの「|」演算子はこの仕組みで実現される。
 */
export interface V6Pipe {
  /** パイプID(表示用) */
  id: number;
  /** パイプ用に割り当てられたinode番号。パイプのバッファ領域として使用 */
  inodeNum: number;
  /** パイプバッファ。write()でpush、read()でshift */
  buffer: string[];
  /** 読み取り側のシステムファイルテーブルインデックス */
  readFd: number;
  /** 書き込み側のシステムファイルテーブルインデックス */
  writeFd: number;
  /** 読み取り側プロセスのPID(表示用) */
  readerPid: number;
  /** 書き込み側プロセスのPID(表示用) */
  writerPid: number;
  /** 読み取り側の参照カウント。0になると書き込み側にSIGPIPE */
  readerCount: number;
  /** 書き込み側の参照カウント */
  writerCount: number;
  /**
   * パイプロック (pipe.c: plock/prele)。
   * V6ではパイプの読み書き中にinodeをロックして排他制御する。
   * plock()でロック取得、prele()で解放+wakeup。
   */
  locked: boolean;
  /** ロック待ちのプロセスID一覧 */
  waitingPids: number[];
}

/**
 * V6 calloutテーブルエントリ (callout.h: struct callo)。
 * クロック割り込みハンドラ(clock.c)が毎tick処理するタイマーテーブル。
 * alarm(2)やデバイスタイムアウトで使用される。
 * c_time ticks後にc_func(c_arg)が呼び出される。
 */
export interface V6CalloutEntry {
  /** 残りtick数 (callout.h: c_time)。0になったらハンドラ発火 */
  ticks: number;
  /** ハンドラ関数名 (callout.h: c_func) */
  handler: string;
  /** 引数 (callout.h: c_arg) */
  arg: number;
}

// ─── ディスク ───
// V6の典型的なディスクレイアウト (RK05: 2.5MB, 4872ブロック):
//
//   ブロック 0:       ブートブロック (ブートローダのコード)
//   ブロック 1:       スーパーブロック (FS メタデータ)
//   ブロック 2〜17:   inodeテーブル (256 inodes = 16ブロック × 16 inodes/blk)
//   ブロック 18〜:    データブロック (ファイル/ディレクトリ/間接ブロック/フリー)

/** ディスクブロック種別。UI表示で色分けに使用 */
export type V6BlockType = "superblock" | "inode" | "data" | "indirect" | "free";

/** ディスクブロックのメタデータ。UI表示用にブロックの種別と内容サマリを保持 */
export interface V6DiskBlock {
  /** ディスク上のブロック番号 */
  blockNum: number;
  /** ブロック内容の人間可読なサマリ */
  content: string;
  /** ブロックの用途(UI表示の色分けに使用) */
  type: V6BlockType;
}

// ─── シミュレーション ───

/**
 * シミュレーション操作。V6のシステムコールとカーネル操作に対応する。
 *
 * V6のシステムコールは約50個で、現代のLinux(300+)と比べるとコンパクト。
 * trap命令(PDP-11)でカーネルモードに入り、r0レジスタにシステムコール番号を
 * セットする。このシミュレータでは各操作を判別共用体で表現する。
 *
 * 操作の分類:
 * - ブート: カーネル初期化(実際はシステムコールではないが便宜上含む)
 * - プロセス管理: fork(2), exec(2), wait(2), exit(2)
 * - ファイル操作: open(2), creat(2), close(2), read(2), write(2), etc.
 * - パイプ: pipe(2), dup(2)
 * - シグナル: signal(2), kill(2)
 * - スケジューリング: swtch()(カーネル内部), nice(2)
 * - バッファキャッシュ: sync(2)
 */
export type V6Operation =
  // ブート — カーネル初期化。スーパーブロック読込、ルートFS構築、initプロセス起動
  | { op: "boot" }
  // プロセス管理 — V6のプロセスモデルの核心
  | { op: "fork"; parentPid: number; childName: string }   // fork(2): プロセス複製
  | { op: "exec"; pid: number; path: string; argv: string[] }  // exec(2): イメージ置換
  | { op: "wait"; pid: number }   // wait(2): 子プロセスの終了待ち+zombie回収
  | { op: "exit"; pid: number; code: number }  // exit(2): プロセス終了→zombie化
  // ファイル操作 — V6ファイルシステムI/O
  | { op: "open"; pid: number; path: string; mode: "read" | "write" | "readwrite" }  // open(2)
  | { op: "creat"; pid: number; path: string; perm: number }  // creat(2): V6ではcreateでなくcreat
  | { op: "close"; pid: number; fd: number }   // close(2)
  | { op: "read"; pid: number; fd: number; size: number }   // read(2)
  | { op: "write"; pid: number; fd: number; data: string }  // write(2)
  | { op: "link"; pid: number; existingPath: string; newPath: string }  // link(2): ハードリンク作成
  | { op: "unlink"; pid: number; path: string }  // unlink(2): ディレクトリエントリ削除
  | { op: "chdir"; pid: number; path: string }   // chdir(2): カレントディレクトリ変更
  | { op: "stat"; pid: number; path: string }     // stat(2): inode情報取得
  | { op: "chmod"; pid: number; path: string; mode: number }  // chmod(2): パーミッション変更
  | { op: "mkdir"; pid: number; path: string }    // V6にはmkdir(2)がなく、mknodを使っていた
  // パイプ — プロセス間通信
  | { op: "pipe"; pid: number }   // pipe(2): パイプ作成(read/write fdのペアを返す)
  | { op: "dup"; pid: number; fd: number }   // dup(2): fd複製(I/Oリダイレクション用)
  // シグナル — V6オリジナル13シグナル
  | { op: "signal"; pid: number; sig: V6Signal; action: "default" | "ignore" | "catch" }  // signal(2)
  | { op: "kill"; senderPid: number; targetPid: number; sig: V6Signal }  // kill(2)
  // スケジューリング — 優先度ベースのプリエンプティブスケジューラ
  | { op: "schedule" }  // swtch(): カーネル内部のコンテキストスイッチ
  | { op: "nice"; pid: number; value: number }  // nice(2): 優先度調整
  // バッファキャッシュ — ディスクI/Oバッファの同期
  | { op: "sync" }  // sync(2): 全dirtyバッファをディスクに書き戻し
  // スワッピング — メモリ管理サブシステム
  | { op: "swap_out"; pid: number }  // sched(): プロセスをスワップアウト
  | { op: "swap_in"; pid: number }   // sched(): プロセスをスワップイン
  | { op: "xalloc"; pid: number; path: string }  // xalloc(): テキストセグメント割当/共有
  | { op: "xfree"; pid: number }  // xfree(): テキストセグメント解放
  // キャラクタI/O — 端末デバイス操作
  | { op: "tty_input"; device: number; chars: string }  // 端末入力 (割り込みドリブン)
  | { op: "tty_output"; pid: number; device: number; chars: string }  // 端末出力
  | { op: "tty_ioctl"; pid: number; device: number; cmd: "echo" | "raw" | "crmod" | "speed" | "lcase"; value?: number }  // stty/gtty
  // ブロックデバイスドライバ — I/O操作
  | { op: "dev_strategy"; device: number; blockNum: number; write: boolean }  // strategy()呼び出し
  | { op: "dev_interrupt"; device: number }  // デバイス割り込み完了
  // マウント — ファイルシステムの接合
  | { op: "mount"; pid: number; device: string; path: string }  // mount(2)
  | { op: "umount"; pid: number; device: string }  // umount(2)
  // break — データ領域拡張 (sys1.c: sbreak(), syscall #17)
  | { op: "break"; pid: number; newSize: number }
  // seek — ファイルポインタ移動 (sys2.c: seek(), syscall #19)
  // whence: 0=先頭から, 1=現在位置から, 2=末尾から
  | { op: "seek"; pid: number; fd: number; offset: number; whence: 0 | 1 | 2 }
  // mknod — デバイスファイル作成 (sys2.c: mknod(), syscall #14)
  | { op: "mknod"; pid: number; path: string; mode: number; dev: number }
  // ptrace — プロセストレース (sys1.c: ptrace(), syscall #26)
  | { op: "ptrace"; pid: number; targetPid: number; request: number; addr: number; data: number }
  // grow — スタック自動拡張 (trap.c: grow())。ハードウェアトラップ起因
  | { op: "grow"; pid: number; newStackSize: number }
  // breada — 先読み (bio.c: breada())。通常readと次ブロック先読みを同時実行
  | { op: "breada"; device: number; blockNum: number; readAheadBlock: number }
  // physio — RAW I/O (bio.c: physio())。バッファキャッシュをバイパスする直接I/O
  | { op: "physio"; pid: number; device: number; blockNum: number; write: boolean }
  // plock/prele — パイプ排他制御 (pipe.c)
  | { op: "plock"; pid: number; pipeId: number }
  | { op: "prele"; pid: number; pipeId: number }
  // sched — スワッパー(PID 0)のスケジューリングループ (slp.c: sched())
  | { op: "sched" }
  // clock_tick — クロック割り込み (clock.c)。calloutテーブル処理、CPU使用量加算
  | { op: "clock_tick" }
  // コメント — プリセットの説明用。実行ログに表示される
  | { op: "comment"; text: string };

/**
 * イベント種別。各操作の実行過程で発火するイベントの分類。
 * UIのイベントパネルでは種別ごとに色分けして表示される。
 */
export type V6EventType =
  // ブート
  | "boot" | "superblock_read" | "init_start"
  // プロセス
  | "fork" | "exec" | "wait" | "exit" | "zombie_reap" | "orphan_reparent"
  // ファイルシステム
  | "inode_alloc" | "inode_free" | "inode_read" | "inode_write"
  | "block_alloc" | "block_free"
  | "dir_lookup" | "dir_add" | "dir_remove"
  | "path_resolve"
  | "file_open" | "file_close" | "file_read" | "file_write" | "file_creat"
  | "link_create" | "unlink_remove"
  // バッファキャッシュ
  | "buf_hit" | "buf_miss" | "buf_writeback" | "buf_evict"
  | "buf_sleep" | "buf_wakeup"
  // パイプ
  | "pipe_create" | "pipe_write" | "pipe_read" | "pipe_close"
  // シグナル
  | "signal_send" | "signal_deliver" | "signal_default" | "signal_ignore" | "signal_catch"
  // スケジューリング
  | "sched_switch" | "sched_priority"
  // スワッピング
  | "swap_out" | "swap_in" | "text_alloc" | "text_free" | "text_share"
  // キャラクタI/O / TTY
  | "tty_input" | "tty_output" | "tty_canon" | "tty_intr" | "tty_ioctl"
  // ブロックデバイスドライバ
  | "dev_strategy" | "dev_start" | "dev_interrupt" | "dev_complete"
  // マウント
  | "mount" | "umount"
  // パーミッション
  | "perm_check" | "perm_denied" | "suid_exec"
  // break/grow/seek
  | "data_expand" | "stack_grow" | "file_seek"
  // mknod
  | "mknod"
  // ptrace
  | "ptrace_request" | "ptrace_stop"
  // バッファキャッシュ拡張
  | "buf_readahead" | "physio"
  // パイプ排他制御
  | "pipe_lock" | "pipe_unlock"
  // callout / clock
  | "callout" | "clock_tick"
  // スワッパースケジューラ
  | "sched_swap"
  // inode参照カウント
  | "inode_ref" | "inode_unref"
  // システムコール
  | "syscall" | "error"
  // コメント
  | "comment";

/**
 * シミュレーションイベント。
 * 各操作の実行過程で記録され、UIのイベントタイムラインに表示される。
 * step番号で時系列に並び、typeで色分け、messageで詳細を表示する。
 */
export interface V6Event {
  /** 発生したステップ番号 */
  step: number;
  /** イベント種別(UIの色分けに使用) */
  type: V6EventType;
  /** 人間可読なメッセージ */
  message: string;
  /** 詳細情報(折りたたみ表示用) */
  detail?: string;
  /** 関連するプロセスID */
  pid?: number;
  /** 関連するinode番号 */
  inodeNum?: number;
  /** 関連するブロック番号 */
  blockNum?: number;
}

/**
 * ステップ結果（スナップショット付き）。
 * 各ステップの実行後のカーネル全体の状態をディープコピーで保持する。
 * UIでは◀/▶ボタンでステップ間を行き来でき、任意時点の状態を観察できる。
 * この「タイムトラベルデバッグ」的なUIはシミュレータの学習効果を高める。
 */
export interface V6StepResult {
  /** ステップ番号(0始まり) */
  step: number;
  /** このステップで実行された操作 */
  operation: V6Operation;
  /** プロセステーブルの全エントリ */
  processes: V6Process[];
  /** 使用中の全inode */
  inodes: V6Inode[];
  /** スーパーブロックの状態 */
  superblock: V6SuperBlock;
  /** バッファキャッシュの全エントリ */
  bufferCache: V6Buffer[];
  /** システムファイルテーブルの全エントリ */
  sysFileTable: V6SysFile[];
  /** アクティブなパイプ */
  pipes: V6Pipe[];
  /** テキストテーブル (共有テキストセグメント) */
  textTable: V6TextEntry[];
  /** スワップマップ (スワップデバイスの空き領域) */
  swapMap: V6SwapMapEntry[];
  /** TTYデバイス一覧 */
  ttys: V6Tty[];
  /** マウントテーブル */
  mounts: V6MountEntry[];
  /** 割り込みベクタテーブル */
  interruptVectors: V6InterruptVector[];
  /** sysent[] (システムコールディスパッチテーブル) */
  sysent: V6SysEntry[];
  /** ブロックデバイススイッチテーブル */
  bdevsw: V6Bdevsw[];
  /** キャラクタデバイススイッチテーブル */
  cdevsw: V6Cdevsw[];
  /** calloutテーブル (clock.c: callout[]) */
  callouts: V6CalloutEntry[];
  /** ディスクブロックのメタデータ一覧 */
  disk: V6DiskBlock[];
  /** 操作の結果メッセージ(ログ表示用) */
  message: string;
  /**
   * strace風のシステムコールトレース。
   * このステップまでに実行されたシステムコールを
   * strace(1)と同じ形式で記録する:
   *   [pid  2] open("/etc/motd", O_RDONLY) = 3
   *   [pid  2] read(3, "Welcome...", 512) = 19
   * V6のシステムコールがカーネル内部でどう処理されるかを可視化する。
   */
  syscallTrace: string[];
  /**
   * コンテキストスイッチトレース。
   * スケジューラがプロセスを切り替えるたびに記録:
   *   [clock 42] swtch: pid 3 (sh) → pid 5 (ls) (pri 60→55, cpu 4→2)
   * V6のswtch()がどのようにプロセスを選択するかを可視化する。
   */
  contextSwitchTrace: string[];
  /**
   * namei（パス解決）トレース。
   * open/exec/stat等でnamei()が呼ばれるたびにコンポーネント毎の解決過程を記録:
   *   [namei] "/usr/bin/sh": / (ino=1) → "usr" (ino=2) → "bin" (ino=4) → "sh" (ino=8)
   * V6のnamei()がディレクトリツリーをどう辿るかを可視化する。
   */
  nameiTrace: string[];
  /**
   * プロセスメモリマップトレース。
   * fork/exec時にプロセスのセグメント配置を記録:
   *   [mem] pid 3 (sh): text=0x4000-0x5000 data=0x5000-0x5800 stack=0xf000-0xf400
   * PDP-11のセグメンテーション方式によるメモリ管理を可視化する。
   */
  memoryMapTrace: string[];
  /**
   * 割り込み/トラップトレース。
   * システムコール(trap命令)やクロック割り込みのカーネルモード遷移を記録:
   *   [trap] pid 3: syscall open() entry → kernel mode
   *   [intr] clock tick #5, runrun=1
   * V6のトラップベクタとユーザー/カーネルモード遷移を可視化する。
   */
  trapTrace: string[];
}

/**
 * シミュレーション結果。
 * runSimulation()の戻り値で、全ステップのスナップショットとイベント、
 * 統計情報を含む。UIはこのデータを元に可視化を行う。
 */
export interface V6SimResult {
  /** 全ステップの結果(スナップショット)配列 */
  steps: V6StepResult[];
  /** 全イベントの時系列配列 */
  events: V6Event[];
  /** シミュレーション統計 */
  stats: {
    /** システムコール総数 */
    totalSyscalls: number;
    /** fork()実行回数 */
    forkCount: number;
    /** バッファキャッシュヒット数 */
    bufferHits: number;
    /** バッファキャッシュミス数 */
    bufferMisses: number;
    /** 割り当てられたブロック数 */
    blocksAllocated: number;
    /** 解放されたブロック数 */
    blocksFreed: number;
    /** 割り当てられたinode数 */
    inodesAllocated: number;
    /** 解放されたinode数 */
    inodesFreed: number;
    /** コンテキストスイッチ回数 */
    contextSwitches: number;
    /** 配送されたシグナル数 */
    signalsDelivered: number;
    /** パイプ経由の転送バイト数 */
    pipeBytesTransferred: number;
    /** スワップアウト回数 */
    swapOuts: number;
    /** スワップイン回数 */
    swapIns: number;
    /** テキストセグメント共有回数 */
    textShares: number;
    /** TTY入力文字数 */
    ttyInputChars: number;
    /** TTY出力文字数 */
    ttyOutputChars: number;
    /** デバイスI/O回数 */
    deviceIOs: number;
    /** パーミッション拒否回数 */
    permDenied: number;
  };
}

/** シミュレーション設定 */
export interface V6Config {
  /** 最大ステップ数。無限ループ防止用 */
  maxSteps: number;
}

/**
 * プリセット。特定のV6サブシステムを学習するためのシナリオ。
 * build()はシミュレーション設定と操作列を生成する。
 */
export interface V6Preset {
  /** プリセット名(セレクトボックスに表示) */
  name: string;
  /** プリセットの説明(UIに表示) */
  description: string;
  /** シミュレーション設定と操作列を構築する関数 */
  build: () => { config: V6Config; operations: V6Operation[] };
}
