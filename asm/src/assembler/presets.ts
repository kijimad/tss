/**
 * presets.ts — アセンブラ実験プリセット
 */

export interface Preset {
  name: string;
  description: string;
  code: string;
}

export const PRESETS: Preset[] = [
  // ── 1. Hello World (Linux syscall) ──
  {
    name: "Hello World (Linux syscall)",
    description:
      "write(2) と exit(2) のシステムコールで文字列を出力する最小プログラム。" +
      "レジスタに引数をセットし syscall 命令で呼び出す。",
    code: `; Hello World — Linux x86-64 syscall
msg:                    ; データラベル（文字列アドレス）

_start:
  mov rax, 1          ; sys_write
  mov rdi, 1          ; stdout
  mov rsi, msg        ; バッファアドレス
  mov rdx, 13         ; 長さ
  syscall

  mov rax, 60         ; sys_exit
  xor rdi, rdi        ; 終了コード 0
  syscall`,
  },

  // ── 2. レジスタ間演算 ──
  {
    name: "レジスタ間の算術演算",
    description:
      "ADD, SUB, IMUL, SHL などの基本算術命令がどのようにエンコードされるかを観察する。" +
      "REX プレフィックスと ModR/M バイトの構造に注目。",
    code: `; 基本的な算術演算
  mov rax, 100        ; rax = 100
  mov rbx, 25         ; rbx = 25
  add rax, rbx        ; rax += rbx (125)
  sub rax, 10         ; rax -= 10  (115)
  mov rcx, 3
  imul rcx            ; rax *= rcx (345)
  shl rax, 2          ; rax <<= 2  (1380)
  shr rax, 1          ; rax >>= 1  (690)
  neg rax             ; rax = -rax
  inc rbx             ; rbx++
  dec rbx             ; rbx--`,
  },

  // ── 3. 条件分岐 ──
  {
    name: "条件分岐 (if-else)",
    description:
      "CMP と条件ジャンプ命令 (JE, JNE, JG, JL) によるフロー制御。" +
      "2パスアセンブルでラベルの相対アドレスが解決される様子を確認できる。",
    code: `; if (rax > 10) rbx = 1 else rbx = 0
  mov rax, 15
  cmp rax, 10
  jg greater
  mov rbx, 0          ; else 分岐
  jmp done

greater:
  mov rbx, 1          ; then 分岐

done:
  nop`,
  },

  // ── 4. ループ ──
  {
    name: "ループ (1〜10の合計)",
    description:
      "CMP + JLE による繰り返し処理。ラベルへの後方参照と前方参照の両方を含む。" +
      "アセンブラの2パス処理が不可欠なケース。",
    code: `; sum = 1 + 2 + ... + 10
  mov rcx, 1          ; カウンタ i = 1
  mov rax, 0          ; 合計 sum = 0

loop:
  add rax, rcx        ; sum += i
  inc rcx             ; i++
  cmp rcx, 10
  jle loop            ; i <= 10 なら繰り返し

  ; rax = 55`,
  },

  // ── 5. スタック操作と関数呼び出し ──
  {
    name: "関数呼び出し (CALL/RET)",
    description:
      "PUSH/POP でスタックフレームを構築し、CALL/RET で関数を呼び出す。" +
      "x86-64 の呼び出し規約 (System V AMD64 ABI) の基本。",
    code: `; メイン
_start:
  mov rdi, 5          ; 引数: n = 5
  call double         ; double(5) を呼び出し
  ; rax = 10
  mov rdi, rax        ; 結果を exit コードに
  mov rax, 60
  syscall

; int double(int n) { return n * 2; }
double:
  push rbp
  mov rbp, rsp
  mov rax, rdi        ; 第1引数
  add rax, rax        ; n * 2
  pop rbp
  ret`,
  },

  // ── 6. ビット演算 ──
  {
    name: "ビット演算 (AND/OR/XOR/NOT)",
    description:
      "論理演算命令のエンコーディング。同じ 0x81 オペコードでも ModR/M の /r フィールドで演算が変わる。",
    code: `; ビットマスクとフラグ操作
  mov rax, 0xFF       ; 11111111
  mov rbx, 0x0F       ; 00001111
  and rax, rbx        ; rax = 0x0F (マスク)
  or  rax, 0xF0       ; rax = 0xFF (ビットセット)
  xor rax, rax        ; rax = 0 (ゼロクリア)
  not rbx             ; rbx = ~rbx (ビット反転)
  mov rcx, 0xAA
  test rcx, 0x80      ; ZF に影響 (非破壊テスト)`,
  },

  // ── 7. メモリアクセス ──
  {
    name: "メモリアクセスパターン",
    description:
      "MOV のメモリオペランド形式と LEA 命令。ModR/M + SIB + 変位バイトの構造を確認。",
    code: `; メモリの読み書き
  mov rax, [rbp]           ; ベースレジスタ間接
  mov [rsp], rbx           ; スタックへ書き込み
  lea rax, [rbp]           ; 実効アドレス計算
  mov rcx, 42
  push rcx                 ; スタックに積む
  pop rdx                  ; スタックから取り出す
  mov rax, [rsp]           ; スタックトップを読む`,
  },

  // ── 8. 32bit vs 64bit エンコーディング比較 ──
  {
    name: "32bit vs 64bit レジスタ比較",
    description:
      "同じ MOV/ADD 命令でも 32bit (eax) と 64bit (rax) で REX プレフィックスの有無が変わる。" +
      "エンコード結果のバイト数の違いに注目。",
    code: `; 32bit レジスタ (REX なし)
  mov eax, 100
  mov ebx, 200
  add eax, ebx
  sub eax, 50
  push eax
  pop ebx

; 64bit レジスタ (REX.W=1)
  mov rax, 100
  mov rbx, 200
  add rax, rbx
  sub rax, 50
  push rax
  pop rbx`,
  },

  // ── 9. 拡張レジスタ r8-r15 ──
  {
    name: "拡張レジスタ (r8-r15)",
    description:
      "x86-64 で追加された r8〜r15 レジスタ。REX.B / REX.R ビットが必要になる。",
    code: `; r8-r15 は REX プレフィックスが必須
  mov r8, 10
  mov r9, 20
  add r8, r9
  mov r10, r8
  sub r10, 5
  push r12
  pop r13
  inc r14
  dec r15
  xor r11, r11`,
  },

  // ── 10. エラーケース ──
  {
    name: "エラー: 不明な命令・未定義ラベル",
    description:
      "アセンブラがエラーを検出するケース。不明な命令や未定義ラベルへのジャンプ。",
    code: `; エラー例
  mov rax, 1
  foo rax             ; 不明な命令
  jmp undefined_label ; 未定義ラベル
  ret`,
  },
];
