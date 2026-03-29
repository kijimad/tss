# Unix Shell インタプリタ

ブラウザ上で動作する bash 風シェル。パイプ、リダイレクト、&&/||、変数展開、グロブ、エイリアス、ジョブ制御、テキスト処理コマンド群を実装。右パネルで fork/exec/pipe/redirect の過程が見える。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **左**: ターミナル（Tab で補完、↑↓ で履歴）
- **右**: **Execution Trace** — パース結果、fork/exec、パイプ接続、リダイレクト設定、プロセス終了待ち

## シェル機能

| 機能 | 構文 | 例 |
|------|------|---|
| パイプ | `cmd1 \| cmd2` | `cat file \| grep pattern \| wc -l` |
| リダイレクト(出力) | `> file` | `echo hello > out.txt` |
| リダイレクト(追記) | `>> file` | `echo more >> out.txt` |
| リダイレクト(入力) | `< file` | `sort < data.txt` |
| AND | `&&` | `true && echo ok` |
| OR | `\|\|` | `false \|\| echo fallback` |
| 順次実行 | `;` | `echo a ; echo b` |
| バックグラウンド | `&` | `sleep 10 &` |
| 変数展開 | `$VAR` `${VAR}` | `echo $HOME` |
| ダブルクォート | `"..."` | `echo "hello $USER"` |
| シングルクォート | `'...'` | `echo 'literal $USER'` |
| グロブ | `*.txt` `?.sh` | `ls *.txt` |
| エイリアス | `alias` | `alias ll="ls -la"` |
| Tab 補完 | Tab | ファイル名補完 |

## コマンド一覧

### ファイル操作
| コマンド | 説明 |
|---------|------|
| `echo [-e] [-n] text` | テキスト出力 |
| `cat file [file...]` | ファイル結合・表示 |
| `ls [-l] [-a] [dir]` | ディレクトリ一覧 |
| `cd dir` | ディレクトリ移動 |
| `pwd` | カレントディレクトリ |
| `mkdir dir` | ディレクトリ作成 |
| `touch file` | ファイル作成 |
| `rm file` | ファイル削除 |
| `cp src dst` | ファイルコピー |
| `mv src dst` | ファイル移動 |

### テキスト処理
| コマンド | 説明 |
|---------|------|
| `grep [-i] [-v] [-c] [-n] pattern [file]` | パターン検索 |
| `wc [-l] [-w] [-c] [file]` | 行/単語/文字カウント |
| `head [-n] [file]` | 先頭 n 行 |
| `tail [-n] [file]` | 末尾 n 行 |
| `sort` | 行ソート |
| `uniq` | 重複行除去 |
| `tr from to` | 文字変換 |
| `cut -d delim -f n` | フィールド切り出し |
| `tee file` | 出力を分岐（ファイル + stdout） |
| `seq [start] end` | 連番生成 |

### シェル組み込み
| コマンド | 説明 |
|---------|------|
| `export KEY=VALUE` | 環境変数設定 |
| `unset KEY` | 環境変数削除 |
| `env` | 全環境変数表示 |
| `alias [name=value]` | エイリアス |
| `history` | コマンド履歴 |
| `type cmd` | コマンドの種類 |
| `jobs` | ジョブ一覧 |
| `source file` | スクリプト読み込み |
| `printf fmt args` | 書式付き出力 |
| `test / [` | 条件テスト |
| `true / false` | 終了コード |
| `clear` | 画面クリア |

---

## 実験

### 実験 1: パイプライン

```
cat /home/user/numbers.txt | sort | tail -5
```

numbers.txt(1-10)をソートして最後の5行を表示。右パネルに fork → pipe → wait の流れが見える。

---

### 実験 2: パイプライン + テキスト処理

```
cat /home/user/data.csv | grep -v name | cut -d , -f 1 | sort
```

CSV からヘッダを除去 → 名前列を切り出し → ソート。4つのコマンドがパイプで連結される。

---

### 実験 3: リダイレクト

```
echo "line 1" > /tmp/output.txt
echo "line 2" >> /tmp/output.txt
echo "line 3" >> /tmp/output.txt
cat /tmp/output.txt
wc -l /tmp/output.txt
```

`>` で新規作成、`>>` で追記。右パネルに redirect イベントが表示される。

---

### 実験 4: 変数展開

```
export GREETING=Hello
echo "$GREETING, $USER! Welcome to $HOME"
echo '$GREETING is not expanded in single quotes'
```

ダブルクォート内では変数が展開される。シングルクォート内ではリテラル。

---

### 実験 5: && と ||

```
true && echo "success" && echo "chained"
false && echo "skipped"
false || echo "fallback"
```

`&&` は前のコマンドが成功(exit 0)の時だけ次を実行。`||` は失敗時に実行。

---

### 実験 6: grep のオプション

```
grep Alice /home/user/data.csv
grep -i alice /home/user/data.csv
grep -v Alice /home/user/data.csv
grep -c Alice /home/user/data.csv
grep -n Alice /home/user/data.csv
```

`-i`: 大文字小文字無視、`-v`: 反転マッチ、`-c`: マッチ行数、`-n`: 行番号表示

---

### 実験 7: グロブ展開

```
touch /home/user/a.txt
touch /home/user/b.txt
touch /home/user/c.sh
ls *.txt
ls ?.sh
```

`*.txt` は `.txt` で終わる全ファイル。`?.sh` は1文字 + `.sh`。

---

### 実験 8: テキスト変換パイプライン

```
seq 10 | tr '\n' ',' | head -1
echo "Hello World" | tr 'a-z' 'A-Z'
cat /home/user/numbers.txt | sort -r | head -3
```

seq で連番生成 → tr で改行をカンマに変換。テキストの変換チェーン。

---

### 実験 9: スクリプト実行

```
cat /home/user/script.sh
source /home/user/script.sh
```

`source` でスクリプトを1行ずつ実行。実際のシェルと同じく現在のシェルのコンテキストで実行される。

---

### 実験 10: シェルの内部を観察する

```
echo hello | grep h > /tmp/out.txt
```

右パネルの Execution Trace:
1. `parse: ...` — AST 構造
2. `fork(1000): echo hello` — プロセス fork
3. `fork(1001): grep h` — 2つ目のプロセス fork
4. `pipe: 1000 | 1001` — パイプ接続
5. `redirect: fd1 out /tmp/out.txt` — stdout をファイルにリダイレクト
6. `wait(1001): exit 0` — プロセス終了待ち

---

## 実際の bash との違い

| bash | このシミュレータ |
|------|-----------------|
| fork() + exec() + wait() | 関数呼び出し |
| /proc ファイルシステム | Map ベース仮想 FS |
| シグナルハンドリング (trap) | 未実装 |
| ヒアドキュメント (<<EOF) | 未実装 |
| for/while/if 構文 | 未実装（source でスクリプト内は可） |
| プロセス置換 (<(cmd)) | 未実装 |
| 配列変数 | 未実装 |
| 算術展開 $((expr)) | 未実装 |
| ブレース展開 {a,b,c} | 未実装 |
