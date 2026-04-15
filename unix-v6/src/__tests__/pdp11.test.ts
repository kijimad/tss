/* PDP-11 エミュレータ テスト */

import { describe, it, expect } from "vitest";
import {
  PDP11, PDP11Asm, runPDP11, createPDP11Session,
  R0, R1, R2, R3, R4, R5, SP,
  imm, ind, ainc, adec, idx, abs,
} from "../v6/pdp11.js";
import { PDP11_PRESETS } from "../v6/pdp11-presets.js";

/** テスト用ヘルパー: 簡単なプログラムを実行 */
function exec(setup: (a: PDP11Asm) => void, sp = 0o776): PDP11 {
  const a = new PDP11Asm(0o1000, "", sp);
  setup(a);
  a.halt();
  const cpu = new PDP11();
  cpu.load(a.build());
  while (!cpu.halted && cpu.stepCount < 1000) {
    cpu.step();
  }
  return cpu;
}

// ─── レジスタと算術 ───

describe("レジスタと算術演算", () => {
  it("MOV: レジスタ間のデータ転送", () => {
    const cpu = exec(a => {
      a.mov(imm(0o1234), R0);
      a.mov(R0, R1);
    });
    expect(cpu.r[0]).toBe(0o1234);
    expect(cpu.r[1]).toBe(0o1234);
  });

  it("ADD: 加算と条件コード", () => {
    const cpu = exec(a => {
      a.mov(imm(100), R0);
      a.mov(imm(200), R1);
      a.add(R0, R1);
    });
    expect(cpu.r[1]).toBe(300);
    expect(cpu.psw & 4).toBe(0); // Z=0
    expect(cpu.psw & 8).toBe(0); // N=0
  });

  it("SUB: 減算とNフラグ", () => {
    const cpu = exec(a => {
      a.mov(imm(10), R0);
      a.mov(imm(5), R1);
      a.sub(R0, R1);
    });
    // R1 = 5 - 10 = -5 = 0xFFFB
    expect(cpu.r[1]).toBe(0xFFFB);
    expect(cpu.psw & 8).toBeTruthy(); // N=1
  });

  it("INC/DEC: インクリメント/デクリメント", () => {
    const cpu = exec(a => {
      a.mov(imm(0o77), R0);
      a.inc(R0);
      a.mov(imm(0o100), R1);
      a.dec(R1);
    });
    expect(cpu.r[0]).toBe(0o100);
    expect(cpu.r[1]).toBe(0o77);
  });

  it("NEG: 2の補数", () => {
    const cpu = exec(a => {
      a.mov(imm(42), R0);
      a.neg(R0);
    });
    expect(cpu.r[0]).toBe((-42 + 0x10000) & 0xFFFF);
  });

  it("CLR: ゼロクリアとZフラグ", () => {
    const cpu = exec(a => {
      a.mov(imm(0o12345), R0);
      a.clr(R0);
    });
    expect(cpu.r[0]).toBe(0);
    expect(cpu.psw & 4).toBeTruthy(); // Z=1
  });

  it("CMP: 比較のフラグ設定", () => {
    const cpu = exec(a => {
      a.mov(imm(10), R0);
      a.mov(imm(10), R1);
      a.cmp(R0, R1);
    });
    expect(cpu.psw & 4).toBeTruthy(); // Z=1 (等しい)
  });
});

// ─── アドレッシングモード ───

describe("アドレッシングモード", () => {
  it("レジスタ間接 (Rn): メモリへの読み書き", () => {
    const cpu = exec(a => {
      a.mov(imm(0o3000), R0);       // R0 = アドレス
      a.mov(imm(0o4567), ind(0));   // (R0) = 0o4567
      a.mov(ind(0), R1);            // R1 = (R0)
    });
    expect(cpu.r[1]).toBe(0o4567);
  });

  it("オートインクリメント (Rn)+: ポインタ自動進行", () => {
    const cpu = exec(a => {
      a.mov(imm(0o3000), R0);
      a.mov(imm(0o111), ainc(0));   // (R0)+ : R0→3002
      a.mov(imm(0o222), ainc(0));   // (R0)+ : R0→3004
    });
    expect(cpu.r[0]).toBe(0o3004);
    expect(cpu.readWord(0o3000)).toBe(0o111);
    expect(cpu.readWord(0o3002)).toBe(0o222);
  });

  it("オートデクリメント -(Rn): スタックPUSH/POP", () => {
    const cpu = exec(a => {
      a.mov(imm(0o3010), R0);
      a.mov(imm(0o777), adec(0));   // -(R0) : R0→3006
    });
    expect(cpu.r[0]).toBe(0o3006);
    expect(cpu.readWord(0o3006)).toBe(0o777);
  });

  it("インデックス X(Rn): ベース+オフセット", () => {
    const cpu = exec(a => {
      a.mov(imm(0o3000), R0);
      a.mov(imm(0o12345), idx(0, 10)); // 10(R0) = 0o12345
      a.mov(idx(0, 10), R1);            // R1 = 10(R0)
    });
    expect(cpu.r[1]).toBe(0o12345);
  });

  it("即値 #n: PCオートインクリメント", () => {
    const cpu = exec(a => {
      a.mov(imm(0o54321), R0);
    });
    expect(cpu.r[0]).toBe(0o54321);
  });
});

// ─── 分岐命令 ───

describe("分岐命令", () => {
  it("BNE: 非ゼロで分岐", () => {
    const cpu = exec(a => {
      a.mov(imm(3), R0);
      a.label("loop");
      a.dec(R0);
      a.bne("loop");
    });
    expect(cpu.r[0]).toBe(0);
  });

  it("BEQ: ゼロで分岐", () => {
    const cpu = exec(a => {
      a.clr(R0);
      a.tst(R0);
      a.beq("zero");
      a.mov(imm(1), R1);
      a.br("end");
      a.label("zero");
      a.mov(imm(2), R1);
      a.label("end");
    });
    expect(cpu.r[1]).toBe(2); // Z=1なので"zero"に分岐
  });

  it("BGT/BLE: 符号付き比較分岐", () => {
    const cpu = exec(a => {
      a.mov(imm(10), R0);
      a.cmp(R0, imm(5));
      a.bgt("greater");
      a.mov(imm(0), R1);
      a.br("end");
      a.label("greater");
      a.mov(imm(1), R1);
      a.label("end");
    });
    expect(cpu.r[1]).toBe(1); // 10 > 5 なので分岐
  });

  it("SOB: ループカウンタ", () => {
    const cpu = exec(a => {
      a.mov(imm(5), R0);
      a.clr(R1);
      a.label("loop");
      a.inc(R1);
      a.sob(0, "loop");
    });
    expect(cpu.r[0]).toBe(0);
    expect(cpu.r[1]).toBe(5); // 5回ループ
  });
});

// ─── サブルーチン ───

describe("サブルーチン (JSR/RTS)", () => {
  it("JSR/RTS: 基本的なサブルーチン呼出しと復帰", () => {
    const cpu = exec(a => {
      a.mov(imm(10), R0);
      a.jsr(7, "sub");
      a.mov(imm(0o77), R2);  // 復帰後ここに来るべき
      a.br("end");

      a.label("sub");
      a.add(R0, R0);         // R0 *= 2
      a.rts(7);

      a.label("end");
    });
    expect(cpu.r[0]).toBe(20);   // 10 * 2
    expect(cpu.r[2]).toBe(0o77); // 復帰後に実行された
  });

  it("再帰: 階乗計算 (5! = 120)", () => {
    const preset = PDP11_PRESETS.find(p => p.name.includes("階乗"));
    expect(preset).toBeDefined();
    const result = runPDP11(preset!);
    const last = result.steps[result.steps.length - 1];
    expect(last.registers[0]).toBe(120); // 5! = 120
  });
});

// ─── スタック ───

describe("スタック操作", () => {
  it("PUSH/POP: LIFO順", () => {
    const cpu = exec(a => {
      a.mov(imm(0o111), adec(6)); // PUSH 111
      a.mov(imm(0o222), adec(6)); // PUSH 222
      a.mov(ainc(6), R0);          // POP → R0 = 222
      a.mov(ainc(6), R1);          // POP → R1 = 111
    });
    expect(cpu.r[0]).toBe(0o222);
    expect(cpu.r[1]).toBe(0o111);
  });
});

// ─── トラップ ───

describe("トラップ機構", () => {
  it("TRAP命令: ベクタ034へジャンプしRTIで復帰", () => {
    const preset = PDP11_PRESETS.find(p => p.name.includes("TRAP"));
    expect(preset).toBeDefined();
    const result = runPDP11(preset!);
    const last = result.steps[result.steps.length - 1];
    // R5 = 0o177 (トラップハンドラが実行された証拠)
    expect(last.registers[5]).toBe(0o177);
    // R1 = 1 (1回目のTRAP後に実行)
    expect(last.registers[1]).toBe(1);
    // R2 = 2 (2回目のTRAP後に実行)
    expect(last.registers[2]).toBe(2);
    // トラップイベントが発生
    expect(result.events.some(e => e.type === "trap")).toBe(true);
  });
});

// ─── コンソールI/O ───

describe("コンソール出力 (MMIO)", () => {
  it("コンソールデバイスへの書き込みで文字出力", () => {
    const preset = PDP11_PRESETS.find(p => p.name.includes("コンソール"));
    expect(preset).toBeDefined();
    const result = runPDP11(preset!);
    expect(result.consoleOutput).toBe("HELLO\n");
  });
});

// ─── ビット操作 ───

describe("ビット操作", () => {
  it("BIS: ビットセット (OR)", () => {
    const cpu = exec(a => {
      a.mov(imm(0o17), R0);
      a.bis(imm(0o360), R0);
    });
    expect(cpu.r[0]).toBe(0o377); // 0xFF
  });

  it("BIC: ビットクリア (AND NOT)", () => {
    const cpu = exec(a => {
      a.mov(imm(0o377), R0);
      a.bic(imm(0o17), R0);
    });
    expect(cpu.r[0]).toBe(0o360); // 0xF0
  });

  it("ASL/ASR: シフト演算", () => {
    const cpu = exec(a => {
      a.mov(imm(0o25), R0);
      a.asl(R0);              // 21 * 2 = 42
      a.mov(R0, R1);
      a.asr(R0);              // 42 / 2 = 21
    });
    expect(cpu.r[1]).toBe(42);
    expect(cpu.r[0]).toBe(21);
  });

  it("SWAB: バイト入れ替え", () => {
    const cpu = exec(a => {
      a.mov(imm(0x0102), R0);
      a.swab(R0);
    });
    expect(cpu.r[0]).toBe(0x0201);
  });

  it("XOR: 排他的論理和", () => {
    const cpu = exec(a => {
      a.mov(imm(0o177777), R0);
      a.mov(imm(0o125252), R1);
      a.xor(0, R1);
    });
    expect(cpu.r[1]).toBe(0o052525); // ビット反転
  });

  it("COM: 1の補数 (ビット反転)", () => {
    const cpu = exec(a => {
      a.mov(imm(0), R0);
      a.com(R0);
    });
    expect(cpu.r[0]).toBe(0xFFFF);
  });
});

// ─── 文字列操作 ───

describe("文字列操作", () => {
  it("MOVB + オートインクリメントで文字列コピー", () => {
    const preset = PDP11_PRESETS.find(p => p.name.includes("文字列コピー"));
    expect(preset).toBeDefined();
    const result = runPDP11(preset!);
    const last = result.steps[result.steps.length - 1];
    // R0 = コピーしたバイト数 (8 = "UNIX V6\0")
    expect(last.registers[0]).toBe(8);
  });
});

// ─── EIS命令 ───

describe("EIS (拡張命令セット)", () => {
  it("MUL: 乗算", () => {
    const cpu = exec(a => {
      a.mov(imm(7), R0);
      a.mul(0, imm(6));
    });
    // 7 × 6 = 42, 結果はR0:R1 (R0=上位, R1=下位)
    expect(cpu.r[1]).toBe(42);
  });

  it("DIV: 除算", () => {
    const cpu = exec(a => {
      a.clr(R0);              // R0 = 上位ワード = 0
      a.mov(imm(100), R1);   // R1 = 下位ワード = 100
      a.div(0, imm(7));      // 100 / 7 = 14余り2
    });
    expect(cpu.r[0]).toBe(14); // 商
    expect(cpu.r[1]).toBe(2);  // 余り
  });
});

// ─── セッションAPI ───

describe("セッションAPI", () => {
  it("createPDP11Session: インクリメンタル実行", () => {
    const preset = PDP11_PRESETS[0]; // レジスタ操作
    const session = createPDP11Session(preset);

    expect(session.isHalted()).toBe(false);
    const step1 = session.step();
    expect(step1.step).toBe(1);
    expect(step1.instruction.mnemonic).toBe("MOV");

    // 最後まで実行
    while (!session.isHalted()) {
      session.step();
    }
    expect(session.isHalted()).toBe(true);
  });
});

// ─── プリセット ───

describe("プリセット", () => {
  it("全10プリセットが定義されている", () => {
    expect(PDP11_PRESETS.length).toBe(10);
  });

  it("全プリセットがエラーなく実行完了する", () => {
    for (const preset of PDP11_PRESETS) {
      const result = runPDP11(preset);
      expect(result.steps.length).toBeGreaterThan(0);
      // 最後のステップでHALT
      const last = result.steps[result.steps.length - 1];
      expect(last.halted).toBe(true);
    }
  });

  it("合計計算プリセット: 1+2+...+10 = 55", () => {
    const preset = PDP11_PRESETS.find(p => p.name.includes("条件分岐"));
    expect(preset).toBeDefined();
    const result = runPDP11(preset!);
    const last = result.steps[result.steps.length - 1];
    // R1 = 55 (= 0o67)
    expect(last.registers[1]).toBe(55);
    // R2 = 1 (成功マーカー)
    expect(last.registers[2]).toBe(1);
  });
});

// ─── アセンブラ ───

describe("アセンブラ", () => {
  it("ラベルの前方参照が正しく解決される", () => {
    const a = new PDP11Asm(0o1000);
    a.br("end");           // 前方参照
    a.mov(imm(1), R0);    // スキップされる
    a.label("end");
    a.mov(imm(2), R0);    // ここに分岐
    a.halt();

    const cpu = new PDP11();
    cpu.load(a.build());
    while (!cpu.halted) cpu.step();
    expect(cpu.r[0]).toBe(2); // 前方参照が正しく解決
  });

  it("ラベルの後方参照が正しく解決される", () => {
    const a = new PDP11Asm(0o1000);
    a.mov(imm(3), R0);
    a.label("loop");
    a.dec(R0);
    a.bne("loop");         // 後方参照
    a.halt();

    const cpu = new PDP11();
    cpu.load(a.build());
    while (!cpu.halted) cpu.step();
    expect(cpu.r[0]).toBe(0);
  });
});
