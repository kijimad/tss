export interface Preset {
  name: string;
  description: string;
  source: string;
}

export const presets: Preset[] = [
  {
    name: "基本: return定数",
    description: "最小のC関数。即値のPUSH、RET命令、.textセクションのみ",
    source: `int main() {
  return 42;
}`,
  },
  {
    name: "四則演算",
    description: "算術式のコード生成。スタックベースの演算命令列（ADD, SUB, MUL, DIV）",
    source: `int calc() {
  int a = 10;
  int b = 3;
  int sum = a + b;
  int diff = a - b;
  int prod = a * b;
  int quot = a / b;
  return sum + diff + prod + quot;
}`,
  },
  {
    name: "if-else分岐",
    description: "条件分岐のコード生成。CMP + 条件ジャンプ命令、パッチによるジャンプ先解決",
    source: `int abs_val(int x) {
  if (x < 0) {
    return -x;
  } else {
    return x;
  }
}

int main() {
  return abs_val(-5);
}`,
  },
  {
    name: "whileループ",
    description: "ループのコード生成。ループトップへのJMP、終了条件のJE、アドレスパッチ",
    source: `int sum_to(int n) {
  int total = 0;
  int i = 1;
  while (i <= n) {
    total = total + i;
    i = i + 1;
  }
  return total;
}

int main() {
  return sum_to(100);
}`,
  },
  {
    name: "forループ",
    description: "for文のコード生成。初期化・条件・更新・本体の4ブロック構造",
    source: `int factorial(int n) {
  int result = 1;
  for (int i = 1; i <= n; i = i + 1) {
    result = result * i;
  }
  return result;
}

int main() {
  return factorial(6);
}`,
  },
  {
    name: "関数呼び出しとリロケーション",
    description: "CALL命令のR_REL32リロケーション。複数関数間の相互参照",
    source: `int square(int x) {
  return x * x;
}

int add(int a, int b) {
  return a + b;
}

int main() {
  int a = square(5);
  int b = square(3);
  return add(a, b);
}`,
  },
  {
    name: "文字列リテラルと.rodata",
    description: "文字列定数の.rodataセクション配置、R_DATA_ADDRリロケーション",
    source: `int puts(int msg) {
  return 0;
}

int main() {
  puts("Hello, World!");
  puts("Compiler output");
  return 0;
}`,
  },
  {
    name: "外部シンボル参照",
    description: "未定義シンボルのR_ABS32/R_REL32リロケーション。リンカーが解決する参照",
    source: `int printf(int fmt) {
  return 0;
}

int global_func(int x) {
  return x + 1;
}

int main() {
  int val = global_func(10);
  printf(val);
  return 0;
}`,
  },
  {
    name: "再帰関数（フィボナッチ）",
    description: "再帰呼び出しのコード生成。CALL命令の再帰的使用とスタックフレーム管理",
    source: `int fib(int n) {
  if (n <= 1) {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

int main() {
  return fib(10);
}`,
  },
  {
    name: "複合式とネスト",
    description: "ネストした式・制御構造のコード生成。複雑なスタック操作",
    source: `int max(int a, int b) {
  if (a > b) {
    return a;
  }
  return b;
}

int clamp(int val, int lo, int hi) {
  if (val < lo) {
    return lo;
  }
  if (val > hi) {
    return hi;
  }
  return val;
}

int main() {
  int x = max(10, 20);
  int y = clamp(x, 5, 15);
  return y;
}`,
  },
];
