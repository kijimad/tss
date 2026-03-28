/**
 * syscall.ts — システムコール
 *
 * ユーザプログラムがカーネルの機能を使うためのインターフェース。
 * SYSCALL 命令で CPU が割り込みを発生させ、カーネルが処理する。
 *
 * 呼び出し規約:
 *   R0 = システムコール番号
 *   R1, R2, R3 = 引数
 *   R0 = 戻り値
 *
 * システムコール一覧:
 *   0: exit(code)           — プロセス終了
 *   1: write(fd, addr, len) — 出力（fd=1: stdout）
 *   2: read(fd, addr, len)  — 入力
 *   3: open(pathAddr, len)  — ファイルオープン
 *   4: close(fd)            — ファイルクローズ
 *   5: fork()               — プロセス複製
 *   6: exec(pathAddr, len)  — プログラム実行
 *   7: getpid()             — プロセスID取得
 *   8: sleep(ticks)         — スリープ
 *   9: mkdir(pathAddr, len) — ディレクトリ作成
 *  10: readdir(pathAddr, len, bufAddr) — ディレクトリ読み取り
 */

export const SyscallNumber = {
  Exit: 0,
  Write: 1,
  Read: 2,
  Open: 3,
  Close: 4,
  Fork: 5,
  Exec: 6,
  GetPid: 7,
  Sleep: 8,
  Mkdir: 9,
  ReadDir: 10,
} as const;
export type SyscallNumber = (typeof SyscallNumber)[keyof typeof SyscallNumber];
