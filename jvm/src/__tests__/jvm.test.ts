import { describe, it, expect } from "vitest";
import { ClassBuilder, u16 } from "../classfile/builder.js";
import { OpCode, AccessFlag } from "../classfile/types.js";
import { JvmRuntime } from "../runtime/runtime.js";
import { run } from "../interpreter/interpreter.js";

// ヘルパー: クラスを作ってmainを実行
function runMain(builder: ClassBuilder): JvmRuntime {
  const rt = new JvmRuntime();
  const classFile = builder.build();
  rt.loadClass(classFile);
  const cls = rt.classes.get(classFile.thisClass);
  if (cls === undefined) throw new Error("class not found");
  const main = cls.methods.find(m => m.name === "main");
  if (main === undefined) throw new Error("main not found");
  rt.invokeMethod(cls, main, [null]);
  run(rt);
  return rt;
}

describe("JVM バイトコードインタプリタ", () => {
  describe("算術演算", () => {
    it("1 + 2 = 3 を計算する", () => {
      // public static void main(String[] args) {
      //   System.out.println(1 + 2);
      // }
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.iconst_1,
        OpCode.iconst_2,
        OpCode.iadd,
        OpCode.invokevirtual, ...u16(printRef),
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("3\n");
    });

    it("10 - 3 * 2 = 4 を計算する", () => {
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.bipush, 10,
        OpCode.iconst_3,
        OpCode.iconst_2,
        OpCode.imul,
        OpCode.isub,
        OpCode.invokevirtual, ...u16(printRef),
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("4\n");
    });
  });

  describe("ローカル変数", () => {
    it("変数に値を格納して読み出す", () => {
      // int x = 42; println(x);
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 2, [
        OpCode.bipush, 42,
        OpCode.istore_1,
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.iload_1,
        OpCode.invokevirtual, ...u16(printRef),
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("42\n");
    });
  });

  describe("条件分岐", () => {
    it("if-else で正しい分岐を選ぶ", () => {
      // int x = 5; if (x > 3) println(1); else println(0);
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 2, [
        // 0: bipush 5
        OpCode.bipush, 5,
        // 2: istore_1
        OpCode.istore_1,
        // 3: iload_1
        OpCode.iload_1,
        // 4: iconst_3
        OpCode.iconst_3,
        // 5: if_icmple offset -> else (pc=5+8=13)
        OpCode.if_icmple, 0, 8,
        // 8: getstatic, iconst_1, println (then)
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.iconst_1,
        OpCode.invokevirtual, ...u16(printRef),
        // 15: goto end (pc=15+8=23)
        OpCode.goto, 0, 8,
        // 18: getstatic, iconst_0, println (else)
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.iconst_0,
        OpCode.invokevirtual, ...u16(printRef),
        // 23: return
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("1\n"); // 5 > 3 なので 1
    });
  });

  describe("ループ", () => {
    it("for ループで 1+2+...+10=55 を計算する", () => {
      // int sum = 0; for (int i = 1; i <= 10; i++) sum += i; println(sum);
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 3, [
        // local[1] = sum = 0
        OpCode.iconst_0,
        OpCode.istore_1,
        // local[2] = i = 1
        OpCode.iconst_1,
        OpCode.istore_2,
        // 4: loop start
        // iload_2, bipush 10, if_icmpgt -> end
        OpCode.iload_2,
        OpCode.bipush, 10,
        OpCode.if_icmpgt, 0, 14,   // pc=7+14=21
        // sum += i
        OpCode.iload_1,
        OpCode.iload_2,
        OpCode.iadd,
        OpCode.istore_1,
        // i++
        OpCode.iinc, 2, 1,
        // goto loop start (pc=16, target=4, offset=4-16=-12)
        OpCode.goto, 0xFF, 0xF4 & 0xFF,  // -12 as signed 16-bit
        // 19: ここに来ない(計算ミス調整)
        // 実際のオフセットを再計算:
        // goto は pc=15 から、target=4, offset = 4-15 = -11
        // 上の計算が合わないので修正する...
      ]);

      // オフセットの手動計算が面倒なので、もっとシンプルに
      b.build().methods.length = 0; // リセット

      // 全命令のバイトオフセットを明示的に計算
      const code = [
        /* 0*/ OpCode.iconst_0,       // sum = 0
        /* 1*/ OpCode.istore_1,
        /* 2*/ OpCode.iconst_1,       // i = 1
        /* 3*/ OpCode.istore_2,
        // loop:
        /* 4*/ OpCode.iload_2,        // load i
        /* 5*/ OpCode.bipush, 10,     // push 10
        /* 7*/ OpCode.if_icmpgt, ...u16(21 - 7),  // if i > 10 goto end (pc=7, target=21, offset=14)
        /*10*/ OpCode.iload_1,        // load sum
        /*11*/ OpCode.iload_2,        // load i
        /*12*/ OpCode.iadd,           // sum + i
        /*13*/ OpCode.istore_1,       // sum = sum + i
        /*14*/ OpCode.iinc, 2, 1,     // i++
        /*17*/ OpCode.goto, ...u16ToSigned(4 - 17),  // goto loop
        // end:
        /*20*/ OpCode.getstatic, ...u16(sysOutRef),
        /*23*/ OpCode.iload_1,
        /*24*/ OpCode.invokevirtual, ...u16(printRef),
        /*27*/ OpCode.return,
      ];

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 3, code);

      const rt = runMain(b);
      expect(rt.stdout).toBe("55\n");
    });
  });

  describe("メソッド呼び出し", () => {
    it("static メソッドを呼び出して結果を得る", () => {
      // static int double(int x) { return x * 2; }
      // main: println(double(21));
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      const doubleRef = b.addMethodRef("Test", "double_", "(I)I");

      b.addMethod("double_", "(I)I", AccessFlag.Public | AccessFlag.Static, 4, 1, [
        OpCode.iload_0,
        OpCode.iconst_2,
        OpCode.imul,
        OpCode.ireturn,
      ]);

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.bipush, 21,
        OpCode.invokestatic, ...u16(doubleRef),
        OpCode.invokevirtual, ...u16(printRef),
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("42\n");
    });

    it("再帰メソッド(階乗)を実行する", () => {
      // static int factorial(int n) { if (n <= 1) return 1; return n * factorial(n-1); }
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(I)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      const factRef = b.addMethodRef("Test", "factorial", "(I)I");

      b.addMethod("factorial", "(I)I", AccessFlag.Public | AccessFlag.Static, 4, 1, [
        /* 0*/ OpCode.iload_0,        // n
        /* 1*/ OpCode.iconst_1,       // 1
        /* 2*/ OpCode.if_icmpgt, ...u16(8 - 2),  // if n > 1 goto recurse (offset 6)
        /* 5*/ OpCode.iconst_1,
        /* 6*/ OpCode.ireturn,        // return 1
        // recurse:
        /* 7*/ OpCode.nop,            // パディング
        /* 8*/ OpCode.iload_0,        // n
        /* 9*/ OpCode.iload_0,        // n
        /*10*/ OpCode.iconst_1,
        /*11*/ OpCode.isub,           // n - 1
        /*12*/ OpCode.invokestatic, ...u16(factRef),  // factorial(n-1)
        /*15*/ OpCode.imul,           // n * factorial(n-1)
        /*16*/ OpCode.ireturn,
      ]);

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.bipush, 5,
        OpCode.invokestatic, ...u16(factRef),
        OpCode.invokevirtual, ...u16(printRef),
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("120\n"); // 5! = 120
    });
  });

  describe("文字列出力", () => {
    it("System.out.println で文字列を出力する", () => {
      const b = new ClassBuilder("Test");
      const printRef = b.addMethodRef("java/io/PrintStream", "println", "(Ljava/lang/String;)V");
      const sysOutRef = b.addFieldRef("java/lang/System", "out", "Ljava/io/PrintStream;");
      const helloRef = b.addStringRef("Hello, JVM!");

      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 10, 1, [
        OpCode.getstatic, ...u16(sysOutRef),
        OpCode.ldc, helloRef,
        OpCode.invokevirtual, ...u16(printRef),
        OpCode.return,
      ]);

      const rt = runMain(b);
      expect(rt.stdout).toBe("Hello, JVM!\n");
    });
  });

  describe("実行トレース", () => {
    it("イベントが記録される", () => {
      const b = new ClassBuilder("Test");
      b.addMethod("main", "([Ljava/lang/String;)V", AccessFlag.Public | AccessFlag.Static, 4, 1, [
        OpCode.iconst_1,
        OpCode.iconst_2,
        OpCode.iadd,
        OpCode.pop,
        OpCode.return,
      ]);
      const rt = runMain(b);
      expect(rt.events.length).toBeGreaterThan(0);
      // push イベントがある
      const pushEvents = rt.events.filter(e => e.type === "push");
      expect(pushEvents.length).toBeGreaterThan(0);
    });
  });
});

// 符号付き16ビットオフセットをバイト列に変換
function u16ToSigned(offset: number): [number, number] {
  const v = offset & 0xffff;
  return [(v >> 8) & 0xff, v & 0xff];
}
