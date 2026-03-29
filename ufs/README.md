# Unix File System シミュレータ

ブラウザ上で動作する Unix 風ファイルシステム。仮想ディスク（1MB）上に inode ベースの FS を構築し、ターミナル UI で操作できる。右パネルにディスクブロックの使用状況がリアルタイムで表示される。

## 起動

```bash
npm install
npm run dev
```

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `ls [path]` | ディレクトリ一覧（inode番号・サイズ付き） |
| `cat <file>` | ファイル内容を表示 |
| `echo <text>` | テキストを出力 |
| `mkdir <path>` | ディレクトリ作成 |
| `touch <file>` | 空ファイル作成 |
| `write <file> <text>` | ファイルに書き込み |
| `rm <path>` | ファイル/空ディレクトリの削除 |
| `stat <path>` | inode 情報を表示（inode番号、型、パーミッション、サイズ、リンク数、データブロック番号） |
| `cd <path>` | ディレクトリ移動 |
| `pwd` | カレントディレクトリ表示 |
| `df` | ディスク使用状況（空きブロック数、空きinode数） |
| `clear` | 画面クリア |
| `help` | コマンド一覧 |

## 画面の見方

- **左**: Unix ターミナル
- **右上**: スーパーブロック情報（使用中ブロック/inode の数）
- **右中**: ディスクブロックマップ — 灰色=システム領域、青=使用中データブロック、暗色=空き
- **右下**: FS イベントログ — inode 割り当て、ブロック割り当て、パス解決などがリアルタイム表示

---

## 実験

### 実験 1: ファイルの作成とディスクへの影響を観察する

```
df
```

空きブロック数と空き inode 数を確認する。

```
write /tmp/hello.txt Hello World
df
```

もう一度 `df` を実行すると、空きブロックと空き inode がそれぞれ 1 ずつ減っている。右パネルのディスクマップにも青いセルが 1 つ増える。

```
stat /tmp/hello.txt
```

ファイルの inode 番号、サイズ（11 bytes）、データブロック番号が表示される。ディスクマップ上でそのブロック番号の位置を確認できる。

---

### 実験 2: 大きなファイルが複数ブロックに分割される様子

```
write /tmp/big.txt xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

512 バイトを超えるデータを書くと、複数のデータブロックが割り当てられる。

```
stat /tmp/big.txt
```

`Blocks:` の行に複数のブロック番号が表示される。ディスクマップで連続した青いセルが増えているのを確認する。

---

### 実験 3: ディレクトリの内部構造を理解する

```
mkdir /project
stat /project
```

ディレクトリも inode を持つ。`Size: 64` は `.` と `..` の 2 エントリ分（各 32B）。

```
touch /project/a.txt
touch /project/b.txt
touch /project/c.txt
stat /project
```

サイズが `160` に増える（5 エントリ × 32B: `.`, `..`, `a.txt`, `b.txt`, `c.txt`）。

---

### 実験 4: inode 番号を追跡する

```
touch /tmp/file1.txt
touch /tmp/file2.txt
touch /tmp/file3.txt
stat /tmp/file1.txt
stat /tmp/file2.txt
stat /tmp/file3.txt
```

inode 番号が連番で割り当てられるのが見える。

```
rm /tmp/file2.txt
touch /tmp/file4.txt
stat /tmp/file4.txt
```

削除した file2.txt の inode 番号が file4.txt に再利用される。ビットマップによる空き管理の仕組み。

---

### 実験 5: ディレクトリのネストと `.` / `..`

```
mkdir /a
mkdir /a/b
mkdir /a/b/c
cd /a/b/c
pwd
cd ..
pwd
cd ..
pwd
```

`..` で 1 つ上のディレクトリに移動する。各ディレクトリの `..` エントリが親の inode を指している。

```
stat /a
stat /a/b
```

`/a` の `Links: 3`（自分 + `.` + `b/..`）、`/a/b` の `Links: 3`（自分 + `.` + `c/..`）。ディレクトリのリンク数 = 2 + 子ディレクトリ数。

---

### 実験 6: 削除と空き領域の回収

```
df
write /tmp/waste1.txt aaaaaaaaaaaaaaaaaaaaaa
write /tmp/waste2.txt bbbbbbbbbbbbbbbbbbbbbb
write /tmp/waste3.txt cccccccccccccccccccccc
df
```

3 ファイル分のブロックと inode が消費された。

```
rm /tmp/waste1.txt
rm /tmp/waste2.txt
rm /tmp/waste3.txt
df
```

全て元に戻る。ディスクマップの青いセルが消えるのも確認できる。

---

### 実験 7: 空でないディレクトリは削除できない

```
mkdir /keep
write /keep/important.txt Do not delete
rm /keep
```

`rm: failed` になる。Unix では空でないディレクトリを `rm` で削除できない（`rm -r` が必要だが未実装）。

```
rm /keep/important.txt
rm /keep
```

中のファイルを先に消せば削除できる。

---

### 実験 8: 右パネルの FS イベントを読む

ターミナルでコマンドを実行するたびに、右下の「FS Events」にイベントが表示される。

```
write /tmp/trace.txt Hello
```

以下のようなイベントが出る:
1. `resolve /tmp → i5` — パスを inode に解決
2. `inode_alloc #9 (file)` — 新しい inode を割り当て
3. `block_alloc #42` — データブロックを割り当て
4. `dir_add trace.txt → i9` — ディレクトリエントリを追加
5. `file_write i9 11B` — データ書き込み

これがファイル作成の裏で起きている一連のディスク操作。

---

### 実験 9: スーパーブロックの中身

```
df
```

表示される情報:
- `Total blocks`: ディスク全体のブロック数（2048）
- `Free blocks`: データ領域の空きブロック数
- `Total inodes`: inode の総数（512）
- `Free inodes`: 空き inode 数
- `Block size`: 512 bytes

ファイルを作るたびに Free blocks と Free inodes が減る。消すと戻る。

---

### 実験 10: パーミッションを確認する

```
stat /
stat /tmp
touch /tmp/test.txt
stat /tmp/test.txt
```

- `/`（ルート）: Mode `755`（rwxr-xr-x）
- `/tmp`（ディレクトリ）: Mode `755`
- `test.txt`（ファイル）: Mode `644`（rw-r--r--）

Unix のパーミッションモデル（所有者/グループ/その他 × 読み/書き/実行）がそのまま実装されている。

---

## ディスクレイアウト

```
Block 0:        スーパーブロック（マジックナンバー 0x0F5F、メタデータ）
Block 1:        inode ビットマップ（1bit = 1 inode）
Block 2:        データブロック ビットマップ（1bit = 1 block）
Block 3..34:    inode テーブル（各 inode 64B、1 ブロックに 8 個、最大 256 個）
Block 35..2047: データブロック（ファイル内容・ディレクトリエントリ）
```

## inode 構造（64 バイト）

```
[mode:2B][size:4B][links:2B][uid:2B][gid:2B]
[created:4B][modified:4B][accessed:4B]
[direct_block_0..11: 各2B = 24B]
[indirect_block:2B]
```

- `mode`: ファイル種別（0o100000=ファイル, 0o040000=ディレクトリ）+ パーミッション
- `direct_block`: 最大 12 ブロック = 6KB のファイルを直接参照
- `indirect_block`: 未実装（これがあれば 12 + 256 = 268 ブロック = 134KB まで対応可能）

## ディレクトリエントリ構造（32 バイト）

```
[inode_number:4B][name_length:1B][name:27B]
```

1 ブロック（512B）に 16 エントリ格納可能。
