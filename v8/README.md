# V8 JavaScript Engine シミュレータ

ブラウザ上で動作する V8 エンジンの実装。JavaScript のソースコードを**レキサー → パーサー → バイトコードコンパイラ → VM** のパイプラインで処理し、各段階の出力を可視化する。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **左上**: JavaScript ソースコードエディタ
- **左下**: **バイトコード (Ignition)** — コンパイラが生成したバイトコード命令列。V8 の Ignition インタプリタが実行する中間表現
- **右上**: **stdout** — console.log の出力
- **右中**: **VM 実行トレース** — バイトコードの1命令ごとの実行ログ。アキュムレータの値、関数呼び出し/復帰が見える
- **右下**: **ヒープ/GC** — ヒープ上のオブジェクト数、メモリ使用量、GC 実行回数

## V8 パイプライン

```
Source Code     "let x = 1 + 2"
    ↓ Lexer
Token Stream    [let] [x] [=] [1] [+] [2]
    ↓ Parser
AST             VarDecl { name: "x", init: BinaryExpr { op: "+", left: 1, right: 2 } }
    ↓ Bytecode Compiler (Ignition)
Bytecode        LdaSmi 1; Star r0; LdaSmi 2; Star r1; Ldar r0; Add r1; Star r2
    ↓ VM (Ignition Interpreter)
Execution       r0=1, r1=2, acc=3, r2=3
```

## サポートする JavaScript 機能

| 機能 | 例 |
|------|---|
| 変数宣言 | `let x = 1`, `const y = "hello"`, `var z = true` |
| 算術演算 | `+`, `-`, `*`, `/`, `%` |
| 比較 | `===`, `!==`, `<`, `>`, `<=`, `>=` |
| 論理 | `&&`, `\|\|`, `!` |
| 文字列連結 | `"hello" + " " + "world"` |
| if/else | `if (x > 0) { ... } else { ... }` |
| while | `while (i < 10) { ... }` |
| for | `for (let i = 0; i < 10; i = i + 1) { ... }` |
| 関数宣言 | `function f(x) { return x * 2 }` |
| 再帰 | `function fib(n) { ... return fib(n-1) + fib(n-2) }` |
| 配列 | `[1, 2, 3]` |
| オブジェクト | `{ name: "Alice", age: 30 }` |
| console.log | `console.log("hello", 42)` |
| Math | `Math.floor`, `Math.ceil`, `Math.abs`, `Math.max`, `Math.random` |

## バイトコード命令セット

| 命令 | 説明 |
|------|------|
| `LdaSmi n` | 小整数 n をアキュムレータにロード |
| `LdaConst idx` | 定数テーブルから値をロード |
| `LdaTrue/False/Null/Undefined` | 特殊値をロード |
| `Ldar rN` | レジスタ N からアキュムレータにロード |
| `Star rN` | アキュムレータをレジスタ N に格納 |
| `LdaGlobal idx` | グローバル変数をロード |
| `StaGlobal idx` | グローバル変数に格納 |
| `Add/Sub/Mul/Div/Mod rN` | acc = acc op rN |
| `CmpEq/Lt/Gt/... rN` | acc = acc op rN (結果は boolean) |
| `JumpIfFalse target` | acc が false なら target にジャンプ |
| `Jump target` | 無条件ジャンプ |
| `Call rN, argCount` | 関数呼び出し |
| `Return` | 関数から戻る |
| `CreateClosure idx` | クロージャを作成 |
| `CreateArray n` | スタックから n 個取って配列を作成 |
| `CreateObject n` | スタックから n 組取ってオブジェクトを作成 |

---

## 実験

### 実験 1: パイプラインの各段階を確認する

```javascript
let x = 1 + 2
console.log(x)
```

Run を押すと:
1. **左下のバイトコード**に `LdaSmi 1`, `Star r0`, `LdaSmi 2`, `Star r1`, `Ldar r0`, `Add r1` が表示される
2. **右中のトレース**で各命令の実行とアキュムレータの値の変化が見える
3. **右上**に `3` が出力される

---

### 実験 2: 関数呼び出しのフレーム

```javascript
function double(n) {
  return n * 2
}
console.log(double(21))
```

トレースで `>>> CALL double` → 関数内の命令列 → `<<< RET double` が見える。関数呼び出しでスタックフレームが積まれて戻る様子。

---

### 実験 3: 再帰呼び出しとスタック

```javascript
function factorial(n) {
  if (n <= 1) return 1
  return n * factorial(n - 1)
}
console.log(factorial(5))
```

トレースに `>>> CALL factorial` が5回続き、その後 `<<< RET` が5回続く。再帰の深さ分だけフレームが積まれる。

---

### 実験 4: ループとバイトコードのジャンプ命令

```javascript
let sum = 0
let i = 1
while (i <= 10) {
  sum = sum + i
  i = i + 1
}
console.log(sum)
```

バイトコードに `JumpIfFalse` と `Jump` が含まれる。`JumpIfFalse` はループ条件が false の時にループ外へ飛び、`Jump` はループの先頭に戻る。トレースでジャンプが10回繰り返されるのが見える。

---

### 実験 5: 文字列連結 vs 数値加算

```javascript
console.log(1 + 2)
console.log("hello" + " " + "world")
console.log("count: " + 42)
```

同じ `Add` 命令でも、オペランドが数値なら加算、文字列なら連結になる。V8 は実行時に型を見て動作を切り替える（動的型付け）。

---

### 実験 6: FizzBuzz でバイトコード量を確認する

```javascript
for (let i = 1; i <= 20; i = i + 1) {
  if (i % 15 === 0) { console.log("FizzBuzz") }
  else if (i % 3 === 0) { console.log("Fizz") }
  else if (i % 5 === 0) { console.log("Buzz") }
  else { console.log(i) }
}
```

短いソースコードから大量のバイトコードが生成される。if/else の連鎖が `JumpIfFalse` のチェーンになる。

---

### 実験 7: 高階関数

```javascript
function apply(f, x) { return f(x) }
function double(n) { return n * 2 }
console.log(apply(double, 21))
```

関数を引数として渡す。バイトコードでは `CreateClosure` で関数がオブジェクト化され、`Call` で呼ばれる。

---

### 実験 8: オブジェクトとヒープ割り当て

```javascript
let obj = { name: "Alice", age: 30 }
console.log(obj)
```

`CreateObject` 命令でヒープにオブジェクトが割り当てられる。右下のヒープ情報でオブジェクト数が増える。

---

### 実験 9: GC の発動

```javascript
for (let i = 0; i < 100; i = i + 1) {
  let obj = { value: i }
}
console.log("done")
```

ループ内で大量のオブジェクトを作る。ヒープ使用量が閾値を超えると GC が発動し、トレースに `[GC] start` → `[GC] marked` → `[GC] swept` が表示される。

---

### 実験 10: 自由にコードを書く

エディタに任意の JavaScript を入力して Run。エラーがあれば stdout にエラーメッセージが表示される。バイトコードとトレースを見比べることで「JavaScript がどう実行されるか」が見える。

---

## 実際の V8 との違い

| V8 | このシミュレータ |
|----|-----------------|
| C++ 100万行超 | TypeScript 数百行 |
| JIT コンパイラ (TurboFan) でネイティブコードに最適化 | バイトコードインタプリタのみ |
| Hidden Class / Inline Cache で高速化 | 単純な Map ベース |
| 世代別 GC (Scavenger + Mark-Sweep-Compact) | 単純な Mark-and-Sweep |
| Prototype chain | 未実装 |
| クロージャの変数キャプチャ | 簡易実装 |
