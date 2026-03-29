# Go Compiler + VM シミュレータ

ブラウザ上で動作する Go コンパイラ。Go のソースコードをレキサー → パーサー → VM で実行する。goroutine、チャネル、defer、for-range、スライス、switch 等の Go 固有機能をサポート。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **左**: Go ソースコードエディタ（10個のサンプルプログラム）
- **右上**: 実行結果（stdout 出力）
- **右下**: ランタイムイベント（goroutine 生成/終了、チャネル送受信、defer 実行）

## サポートする Go 機能

| 機能 | 例 |
|------|---|
| 変数宣言 | `var x int = 10`, `x := 10` |
| 関数 | `func add(a int, b int) int { return a + b }` |
| if/else | `if x > 0 { ... } else { ... }` |
| for ループ | `for i := 0; i < 10; i++ { ... }` |
| for-range | `for i, v := range slice { ... }` |
| switch | `switch x { case 1: ... default: ... }` |
| スライス | `[]int{1, 2, 3}`, `append()`, `len()` |
| goroutine | `go func() { ... }()` |
| チャネル | `ch := make(chan int)`, `ch <- 42`, `<-ch` |
| defer | `defer println("cleanup")` |
| 関数リテラル | `f := func(x int) int { return x * 2 }` |
| 自動セミコロン挿入 | Go 仕様準拠 |

---

## 実験

### 実験 1: Hello World

```go
package main

func main() {
    println("Hello, Go!")
}
```

`go run` で実行。右パネルに `Hello, Go!` が出力される。

---

### 実験 2: FizzBuzz

```go
package main

func main() {
    for i := 1; i <= 20; i++ {
        if i % 15 == 0 {
            println("FizzBuzz")
        } else if i % 3 == 0 {
            println("Fizz")
        } else if i % 5 == 0 {
            println("Buzz")
        } else {
            println(i)
        }
    }
}
```

Go の `if` は `(` `)` が不要。`:=` で変数宣言と代入を同時に行う。

---

### 実験 3: 再帰（階乗）

```go
package main

func factorial(n int) int {
    if n <= 1 {
        return 1
    }
    return n * factorial(n - 1)
}

func main() {
    println(factorial(10))
}
```

Go の関数は戻り値の型を引数の後に書く。`3628800` が出力される。

---

### 実験 4: スライスと for-range

```go
package main

func main() {
    nums := []int{10, 20, 30, 40, 50}
    sum := 0
    for _, v := range nums {
        sum += v
    }
    println("sum:", sum)
    println("len:", len(nums))
    nums = append(nums, 60)
    println("after append:", len(nums))
}
```

`_` でインデックスを無視。`append` はスライスに要素を追加して新しいスライスを返す。

---

### 実験 5: goroutine + チャネル

```go
package main

func worker(id int, ch chan int) {
    result := id * 10
    ch <- result
}

func main() {
    ch := make(chan int)
    go worker(1, ch)
    go worker(2, ch)
    go worker(3, ch)
    println(<-ch)
    println(<-ch)
    println(<-ch)
}
```

`go` キーワードで goroutine（軽量スレッド）を起動。チャネルで結果を受け取る。右パネルに goroutine の生成・チャネル送受信イベントが表示される。

---

### 実験 6: defer（後始末）

```go
package main

func greet(msg string) {
    println(msg)
}

func main() {
    println("start")
    defer greet("third (deferred)")
    defer greet("second (deferred)")
    println("end")
}
```

`defer` は関数終了時に**逆順**で実行される。出力: `start` → `end` → `second` → `third`。リソース解放（ファイルクローズ等）に使う。

---

### 実験 7: switch

```go
package main

func dayName(d int) string {
    switch d {
    case 1:
        return "Monday"
    case 2:
        return "Tuesday"
    case 3:
        return "Wednesday"
    default:
        return "Unknown"
    }
}

func main() {
    println(dayName(1))
    println(dayName(2))
    println(dayName(5))
}
```

Go の switch は `break` 不要（自動で break する）。`fallthrough` を書かない限り次の case に落ちない。

---

### 実験 8: 高階関数

```go
package main

func apply(f func(int) int, x int) int {
    return f(x)
}

func double(n int) int {
    return n * 2
}

func main() {
    println(apply(double, 21))
}
```

Go でも関数を引数として渡せる。`func(int) int` が関数型。

---

### 実験 9: Fibonacci

```go
package main

func fib(n int) int {
    if n <= 1 {
        return n
    }
    return fib(n-1) + fib(n-2)
}

func main() {
    for i := 0; i <= 10; i++ {
        println(fib(i))
    }
}
```

0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55 が出力される。

---

### 実験 10: 自由にコードを書く

エディタに任意の Go コードを入力して `go run`。パースエラーがあれば右上にエラーメッセージが表示される。

---

## Go と JavaScript/TypeScript の違い

| Go | JavaScript |
|----|-----------|
| 静的型付け (`int`, `string`) | 動的型付け |
| `:=` 短縮宣言 | `const`/`let` |
| 自動セミコロン挿入 | 自動セミコロン挿入（ルールが異なる） |
| goroutine + channel | async/await + Promise |
| `defer` | `try-finally` |
| 複数戻り値 `return a, b` | 配列/オブジェクトで返す |
| `for` のみ（while なし） | `for`, `while`, `do-while` |
| パッケージシステム | ESM / CommonJS |
| コンパイル言語 | インタプリタ（V8 で JIT） |
