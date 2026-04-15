/**
 * PDP-11 エミュレータ プリセット集
 *
 * PDP-11のアーキテクチャを教育的に可視化するための10個のプリセット。
 * 各プリセットは特定のCPU機能に焦点を当てた短いプログラム。
 */

import type { PDP11Preset } from "./pdp11.js";
import { PDP11Asm, R0, R1, R2, R3, R4, R5, SP, imm, ind, ainc, adec, idx, abs } from "./pdp11.js";

export const PDP11_PRESETS: PDP11Preset[] = [

  // ─── 1. レジスタ操作と算術演算 ───
  {
    name: "レジスタ操作と算術演算",
    description: "MOV, ADD, SUB, INC, DEC, NEGの基本操作。PDP-11の16ビット演算と条件コードの動作を確認する。",
    build() {
      const a = new PDP11Asm(0o1000, "基本的なレジスタ操作と算術演算を実行し、条件コード(NZVC)の変化を観察する");
      // MOV #100, R0  ; R0 = 100 (8進)
      a.mov(imm(0o100), R0);
      // MOV #50, R1   ; R1 = 50
      a.mov(imm(0o50), R1);
      // ADD R0, R1    ; R1 = R1 + R0 = 150
      a.add(R0, R1);
      // SUB R1, R0    ; R0 = R0 - R1 = -50 → N=1
      a.sub(R1, R0);
      // INC R0        ; R0++
      a.inc(R0);
      // DEC R1        ; R1--
      a.dec(R1);
      // NEG R0        ; R0 = -R0 (2の補数)
      a.neg(R0);
      // CLR R2        ; R2 = 0 → Z=1
      a.clr(R2);
      // MOV #177777, R3 ; R3 = -1 (0xFFFF)
      a.mov(imm(0o177777), R3);
      // INC R3        ; R3 = 0 → Z=1, C=1 (オーバーフロー)
      a.inc(R3);
      a.halt();
      return a.build();
    },
  },

  // ─── 2. アドレッシングモード ───
  {
    name: "8種アドレッシングモード",
    description: "PDP-11の全8種アドレッシングモードを実演。レジスタ直接からインデックス間接まで、メモリアクセスの多様性を確認する。",
    build() {
      const a = new PDP11Asm(0o1000, "PDP-11の8種類のアドレッシングモードを順に実行");

      // データ領域のアドレス
      const dataAddr = 0o2000;

      // データ領域にテスト値を配置 (asm後に手動設定)
      // Mode 0: レジスタ直接 — Rn
      a.mov(imm(0o111), R0);           // R0 = 111

      // Mode 1: レジスタ間接 — (Rn)
      a.mov(imm(dataAddr), R1);        // R1 = データ領域アドレス
      a.mov(imm(0o222), ind(1));       // (R1) = 222

      // Mode 2: オートインクリメント — (Rn)+
      a.mov(imm(dataAddr + 2), R2);    // R2 → データ+2
      a.mov(imm(0o333), ainc(2));      // (R2)+ = 333, R2+=2

      // Mode 4: オートデクリメント — -(Rn)
      a.mov(imm(dataAddr + 8), R3);    // R3 → データ+8
      a.mov(imm(0o444), adec(3));      // -(R3) = 444, R3-=2

      // Mode 6: インデックス — X(Rn)
      a.mov(imm(dataAddr), R4);        // R4 = ベースアドレス
      a.mov(imm(0o555), idx(4, 10));   // 10(R4) = 555

      // 結果を読み出して確認
      a.mov(ind(1), R5);               // R5 = (R1) = 222
      a.mov(idx(4, 10), R0);           // R0 = 10(R4) = 555

      a.halt();
      return a.build();
    },
  },

  // ─── 3. 条件分岐 ───
  {
    name: "条件分岐とループ",
    description: "BNE, BEQ, BGT, BLE, SOBを使ったループと条件判定。1からNまでの合計を計算する。",
    build() {
      const a = new PDP11Asm(0o1000, "1+2+...+10 = 55 を計算。SOBループカウンタとBEQ/BNE分岐を使用");

      // 1からNまでの合計を計算
      a.mov(imm(10), R0);              // R0 = ループカウンタ (10回)
      a.clr(R1);                        // R1 = 合計値 (0)

      // ループ開始
      a.label("loop");
      a.add(R0, R1);                    // R1 += R0
      a.sob(0, "loop");                 // R0--; R0≠0なら loop へ

      // R1 = 1+2+...+10 = 55(8進) = 45(10進)... 実際は10+9+...+1 = 55(10進) = 67(8進)

      // 結果が正しいか確認
      a.cmp(imm(0o67), R1);            // 55(10進) = 67(8進) と比較
      a.beq("ok");                      // 等しければ ok へ
      a.mov(imm(0o177777), R2);         // R2 = -1 (エラー)
      a.br("done");
      a.label("ok");
      a.mov(imm(1), R2);               // R2 = 1 (成功)
      a.label("done");
      a.halt();
      return a.build();
    },
  },

  // ─── 4. サブルーチン呼び出し (JSR/RTS) ───
  {
    name: "サブルーチン呼び出し (JSR/RTS)",
    description: "JSR/RTSによるサブルーチンコールの仕組み。スタックフレームの変化とリンクレジスタの使い方を可視化する。",
    build() {
      const a = new PDP11Asm(0o1000, "JSR PC,subでサブルーチン呼出し→スタック操作→RTS PCで復帰", 0o776);

      // メインプログラム
      a.mov(imm(0o12), R0);             // 引数: R0 = 10(10進)
      a.jsr(7, "double");               // JSR PC, double — PCリンクのサブルーチン呼出し
      // 戻り: R0 = 20(10進)
      a.mov(R0, R1);                     // R1 = 結果を保存

      // 2回目の呼出し
      a.mov(imm(0o144), R0);            // R0 = 100(10進)
      a.jsr(7, "double");               // JSR PC, double
      a.mov(R0, R2);                     // R2 = 200(10進)
      a.halt();

      // サブルーチン: 引数を2倍にして返す
      a.label("double");
      a.asl(R0);                         // R0 <<= 1 (2倍)
      a.rts(7);                          // RTS PC — 呼出し元に復帰
      return a.build();
    },
  },

  // ─── 5. スタック操作 ───
  {
    name: "スタック操作とフレーム",
    description: "-(SP)でPUSH、(SP)+でPOPするスタック操作。C言語の関数呼出し規約の基盤を理解する。",
    build() {
      const a = new PDP11Asm(0o1000, "PDP-11のスタック操作: PUSH/POP、引数渡し、ローカル変数", 0o776);

      // スタックに値をプッシュ
      a.mov(imm(0o111), adec(6));       // PUSH 111 (-(SP))
      a.mov(imm(0o222), adec(6));       // PUSH 222
      a.mov(imm(0o333), adec(6));       // PUSH 333

      // スタックからポップ (LIFO順)
      a.mov(ainc(6), R0);               // POP → R0 = 333 (最後にPUSH)
      a.mov(ainc(6), R1);               // POP → R1 = 222
      a.mov(ainc(6), R2);               // POP → R2 = 111 (最初にPUSH)

      // サブルーチン呼出し時の引数渡し (C calling convention)
      a.mov(imm(3), adec(6));           // PUSH arg2 = 3
      a.mov(imm(5), adec(6));           // PUSH arg1 = 5
      a.jsr(7, "add_func");             // JSR PC, add_func
      // 引数をクリーンアップ (caller cleanup)
      a.add(imm(4), SP);               // SP += 4 (2引数×2バイト)
      a.halt();

      // add_func(a, b): R0 = a + b
      a.label("add_func");
      a.mov(idx(6, 2), R0);            // R0 = 2(SP) = arg1 = 5
      a.add(idx(6, 4), R0);            // R0 += 4(SP) = arg2 = 3 → R0 = 8
      a.rts(7);                          // RTS PC
      return a.build();
    },
  },

  // ─── 6. TRAP命令 (V6システムコール機構) ───
  {
    name: "TRAP命令 — V6システムコール機構",
    description: "TRAP命令によるユーザー→カーネルモード切替。Unix V6のシステムコール発行の実際の仕組みを再現する。",
    build() {
      const a2 = new PDP11Asm(0o1000, "TRAP命令によるV6システムコール機構の実演", 0o776);

      // --- トラップハンドラ (0o2000に配置) ---
      // 実際のV6では trap() (trap.c) が呼ばれる

      // --- メインプログラム ---
      // ユーザーモード設定 (PSW bit15-14 = 11)
      // シミュレーションでは省略し、TRAPの動作のみ示す

      a2.mov(imm(0o42), R0);            // R0 = syscall番号 (例: write = 4)
      a2.trap(4);                        // TRAP 4 — V6のwrite()相当
      // RTI後ここに戻る
      a2.mov(imm(0o1), R1);             // R1 = 1 (syscall完了マーカー)

      a2.mov(imm(0o21), R0);            // R0 = syscall番号 (例: open = 5)
      a2.trap(5);                        // TRAP 5 — V6のopen()相当
      a2.mov(imm(0o2), R2);             // R2 = 2 (2回目のsyscall完了)
      a2.halt();

      // --- トラップハンドラ ---
      a2.label("trap_handler");
      // スタックからPC(戻りアドレス)を取得してsyscall番号を特定できる
      // V6ではtrap.cでu.u_ar0[R0]からsyscall番号を取る
      a2.mov(imm(0o177), R5);           // R5 = マーカー (ハンドラ実行証拠)
      a2.rti();                          // RTI: PC,PSWを復元して復帰

      const result = a2.build();

      // トラップベクタ034を手動設定
      // trap_handlerのアドレスを取得
      const handlerAddr = a2.getLabelAddr("trap_handler")!;
      result.memory[0o34] = handlerAddr & 0xFF;
      result.memory[0o35] = (handlerAddr >> 8) & 0xFF;
      result.memory[0o36] = 0;  // 新PSW = 0 (カーネルモード, 優先度0)
      result.memory[0o37] = 0;

      return result;
    },
  },

  // ─── 7. コンソール出力 (メモリマップドI/O) ───
  {
    name: "コンソール出力 (メモリマップドI/O)",
    description: "PDP-11のUNIBUSメモリマップドI/Oでコンソールに文字列を出力する。デバイスレジスタへの書き込みが I/O操作になる仕組み。",
    build() {
      const a = new PDP11Asm(0o1000, "メモリマップドI/Oでコンソールに 'HELLO\\n' を出力", 0o776);

      // コンソール送信バッファのアドレス
      // CONSOLE_XBUF = 0o177566

      // 文字列 "HELLO\n" を1文字ずつコンソールに出力
      a.mov(imm(0o110), abs(0o177566));   // 'H' = 0o110
      a.mov(imm(0o105), abs(0o177566));   // 'E' = 0o105
      a.mov(imm(0o114), abs(0o177566));   // 'L' = 0o114
      a.mov(imm(0o114), abs(0o177566));   // 'L' = 0o114
      a.mov(imm(0o117), abs(0o177566));   // 'O' = 0o117
      a.mov(imm(0o12), abs(0o177566));    // '\n' = 0o12
      a.halt();
      return a.build();
    },
  },

  // ─── 8. 文字列操作 (オートインクリメント活用) ───
  {
    name: "文字列コピー (オートインクリメント)",
    description: "オートインクリメントモードを活用した文字列コピー。PDP-11のアドレッシングモードがC言語の *dst++ = *src++ に直接対応する。",
    build() {
      const a = new PDP11Asm(0o1000, "オートインクリメントで文字列コピー: *dst++ = *src++ のPDP-11実装", 0o776);

      const srcAddr = 0o2000;
      const dstAddr = 0o2100;

      // ソースアドレスとデスティネーションアドレスを設定
      a.mov(imm(srcAddr), R0);           // R0 = src ポインタ
      a.mov(imm(dstAddr), R1);           // R1 = dst ポインタ

      // バイトコピーループ: MOVB (R0)+, (R1)+ が *dst++ = *src++ と完全対応
      a.label("copy");
      a.movb(ainc(0), ainc(1));           // *dst++ = *src++ (1バイトコピー)
      a.bne("copy");                      // 直前のMOVBが非ゼロならループ

      // コピー完了: R0, R1は文字列末尾+1を指す
      a.sub(imm(srcAddr), R0);           // R0 = コピーしたバイト数
      a.halt();

      // ソース文字列を手動配置
      const result = a.build();
      const str = "UNIX V6\0";
      for (let i = 0; i < str.length; i++) {
        result.memory[srcAddr + i] = str.charCodeAt(i);
      }
      return result;
    },
  },

  // ─── 9. 階乗計算 (再帰サブルーチン) ───
  {
    name: "階乗計算 (再帰)",
    description: "再帰サブルーチンで N! を計算。スタックフレームの成長と巻き戻りを観察する。",
    build() {
      const a = new PDP11Asm(0o1000, "factorial(5) = 120 を再帰で計算。スタックの深さ変化を観察", 0o776);

      // メイン: factorial(5) を計算
      a.mov(imm(5), R0);                // R0 = 5 (引数)
      a.jsr(7, "factorial");             // JSR PC, factorial
      // R0 = 120 (= 5!)
      a.halt();

      // factorial(n): R0 = n → R0 = n!
      a.label("factorial");
      a.tst(R0);                          // n == 0?
      a.bne("recurse");                   // n≠0なら再帰
      a.mov(imm(1), R0);                 // 0! = 1
      a.rts(7);                            // return 1

      a.label("recurse");
      a.mov(R0, adec(6));                // PUSH n (スタックに保存)
      a.dec(R0);                           // R0 = n-1
      a.jsr(7, "factorial");              // factorial(n-1) → R0 = (n-1)!
      // R0 = (n-1)!, スタックトップ = n
      a.mul(0, ainc(6));                  // MUL R0, (SP)+ → R0:R1 = R0 × n
      a.mov(R1, R0);                      // R0 = 結果の下位ワード (n!)
      a.rts(7);                            // return n!
      return a.build();
    },
  },

  // ─── 10. ビット操作とシフト ───
  {
    name: "ビット操作とシフト演算",
    description: "BIT, BIC, BIS, ASL, ASR, ROR, ROL, SWAB, XORの動作。ビットフラグ操作とデータ変換の基本。",
    build() {
      const a = new PDP11Asm(0o1000, "各種ビット操作命令の動作と条件コードへの影響を観察", 0o776);

      a.mov(imm(0o125252), R0);          // R0 = 1010101010101010 (ビットパターン)
      a.mov(imm(0o052525), R1);          // R1 = 0101010101010101 (反転パターン)

      // BIT: AND演算でビットテスト (結果は捨てる)
      a.bit(R0, R1);                      // R0 & R1 = 0 → Z=1

      // BIS: ビットセット (OR)
      a.mov(imm(0o17), R2);              // R2 = 0000_0000_0000_1111
      a.bis(imm(0o360), R2);             // R2 |= 0000_0000_1111_0000 → 0xFF

      // BIC: ビットクリア (AND NOT)
      a.bic(imm(0o17), R2);              // R2 &= ~0o17 → 0xF0

      // ASL: 算術左シフト (×2)
      a.mov(imm(0o25), R3);              // R3 = 21
      a.asl(R3);                           // R3 = 42
      a.asl(R3);                           // R3 = 84

      // ASR: 算術右シフト (÷2、符号保持)
      a.mov(imm(0o177700), R4);           // R4 = -64 (符号付き)
      a.asr(R4);                           // R4 = -32 (符号保持)

      // SWAB: 上位・下位バイト交換
      a.mov(imm(0o1402), R5);            // R5 = 0x0302
      a.swab(R5);                          // R5 = 0x0203

      // XOR
      a.mov(imm(0o177777), R0);          // R0 = 0xFFFF
      a.xor(0, R1);                       // R1 ^= R0 → R1 = ~R1

      a.halt();
      return a.build();
    },
  },
];
