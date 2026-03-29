# Git シミュレータ

ブラウザ上で動作する Git の実装。オブジェクトストア（blob/tree/commit）、ブランチ、マージ、コンフリクト検出を含む。右パネルでコミットグラフとオブジェクトストアの中身がリアルタイムで見える。

## 起動

```bash
npm install
npm run dev
```

## コマンド一覧

### ファイル操作

| コマンド | 説明 |
|---------|------|
| `echo <text> > <file>` | ファイルに書き込む |
| `cat <file>` | ファイル内容を表示 |
| `ls` | ワーキングツリーのファイル一覧 |
| `rm <file>` | ファイルを削除 |

### Git コマンド

| コマンド | 説明 |
|---------|------|
| `git add <file\|.>` | ファイルをステージング |
| `git commit -m <message>` | コミット作成 |
| `git status` | 状態表示（未追跡/ステージ済み/変更済み） |
| `git log` | コミット履歴 |
| `git diff` | ワーキングツリー vs ステージの差分 |
| `git branch [name]` | ブランチ一覧 / 作成 |
| `git checkout <branch>` | ブランチ切り替え |
| `git merge <branch>` | ブランチをマージ |
| `git tag [name]` | タグ一覧 / 作成 |
| `git show [hash]` | オブジェクトの詳細表示 |
| `git cat-file <hash>` | オブジェクトの中身を表示 |

## 画面の見方

- **左**: ターミナル（ファイル操作 + Git コマンド）
- **右上**: コミットグラフ — コミットの時系列。ブランチ名・タグ付き。マージコミットは二重丸
- **右下**: オブジェクトストア — 全オブジェクトの一覧（青=blob、緑=tree、黄=commit）

---

## 実験

### 実験 1: 最初のコミット

```
echo Hello World > README.md
git add README.md
git status
git commit -m "Initial commit"
git log
```

`git status` でステージ済みファイルが表示される。コミット後、右パネルに blob → tree → commit の3オブジェクトが作られるのが見える。

---

### 実験 2: 変更してコミット

```
echo version 2 > README.md
git diff
git add .
git commit -m "Update README"
git log
```

`git diff` で変更行が `-` / `+` で表示される。コミット後、ログに2つのコミットが表示され、2つ目が1つ目を parent として参照している。

---

### 実験 3: 複数ファイル

```
echo hello > a.txt
echo world > b.txt
echo foo > src/main.js
git add .
git commit -m "Add three files"
git show
```

`git show` で最新コミットの tree オブジェクトが見える。tree はファイル名 → blob ハッシュのマッピング。右パネルのオブジェクトストアで blob が3つ、tree が作られているのを確認。

---

### 実験 4: ブランチの作成と切り替え

```
echo main content > file.txt
git add .
git commit -m "on main"

git branch feature
git branch
git checkout feature
```

`git branch` で main と feature の2つが表示される。`*` が付いているのが現在のブランチ。右パネルのコミットグラフで両ブランチが同じコミットを指しているのが見える。

---

### 実験 5: ブランチで独立した変更

```
echo main content > file.txt
git add .
git commit -m "initial"

git branch feature
git checkout feature

echo feature work > feature.txt
git add .
git commit -m "add feature"

git checkout main
ls
```

`git checkout main` した後に `ls` すると `feature.txt` がない。main ブランチにはそのファイルが存在しないから。`git checkout feature` で戻ると `feature.txt` が復活する。

---

### 実験 6: Fast-forward マージ

```
echo base > file.txt
git add .
git commit -m "base"

git branch feature
git checkout feature

echo added > new.txt
git add .
git commit -m "add new.txt on feature"

git checkout main
git merge feature
ls
git log
```

main は feature の祖先なので、fast-forward マージになる。main のポインタが feature の先端に進むだけ。`ls` で `new.txt` が main にも存在するようになる。

---

### 実験 7: コンフリクトの発生

```
echo original > conflict.txt
git add .
git commit -m "base"

git branch feature

echo main change > conflict.txt
git add .
git commit -m "change on main"

git checkout feature
echo feature change > conflict.txt
git add .
git commit -m "change on feature"

git checkout main
git merge feature
cat conflict.txt
```

同じファイルを両ブランチで変更したので `CONFLICT` が発生する。`cat conflict.txt` でコンフリクトマーカーが見える:

```
<<<<<<< HEAD
main change
=======
feature change
>>>>>>> feature
```

コンフリクトを解決するには、ファイルを編集して再コミット:

```
echo resolved content > conflict.txt
git add .
git commit -m "resolve conflict"
```

---

### 実験 8: タグ

```
echo v1 > app.txt
git add .
git commit -m "release v1"
git tag v1.0

echo v2 > app.txt
git add .
git commit -m "release v2"
git tag v2.0

git log
git tag
```

`git log` でコミットの横にタグ名が表示される。`git tag` でタグ一覧。

---

### 実験 9: オブジェクトの中身を覗く

```
echo test > file.txt
git add .
git commit -m "test commit"
git log
```

ログに表示されるハッシュ（7文字）をコピーして:

```
git show <hash>
```

commit オブジェクトの中身（tree ハッシュ、親、メッセージ）が表示される。tree のハッシュをさらに `git cat-file` で辿ると、blob に到達する。Git の全データがハッシュの連鎖で繋がっている構造が見える。

---

### 実験 10: git status の各状態

```
echo tracked > a.txt
git add .
git commit -m "base"

echo new > untracked.txt
echo modified > a.txt

git status
```

3つの状態が同時に見える:
- **Changes not staged for commit**: `a.txt`（コミット済みだがワーキングツリーで変更された）
- **Untracked files**: `untracked.txt`（git add されていない）

```
git add a.txt
git status
```

- **Changes to be committed**: `a.txt`（ステージ済み、次の commit に含まれる）
- **Untracked files**: `untracked.txt`（まだ未追跡）

---

## 内部構造

### オブジェクトの種類

| 種類 | 内容 | 例 |
|------|------|---|
| **blob** | ファイルの中身そのもの | `"Hello World\n"` |
| **tree** | ディレクトリ（名前 → ハッシュ） | `100644 README.md abc1234` |
| **commit** | スナップショット | tree + parent + author + message |

### ハッシュ

全オブジェクトは内容のハッシュで識別される。同じ内容 → 同じハッシュ（content-addressable storage）。

### ブランチ

ブランチ = コミットハッシュへのポインタ。`git commit` するたびにポインタが前に進む。それだけ。

### マージ

- **Fast-forward**: 片方が祖先ならポインタを進めるだけ
- **3-way merge**: 両方で変更がある場合、tree を統合してマージコミットを作る
- **コンフリクト**: 同じファイルを両方で変更した場合、マーカーを挿入して手動解決を要求
