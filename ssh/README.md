# SSH Protocol シミュレータ

ブラウザ上で動作する SSH の実装。Diffie-Hellman 鍵交換、暗号化チャネル確立、パスワード/公開鍵認証、リモートシェルの全過程を可視化する。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **上部**: 接続フォーム（ユーザ名@ホスト、パスワード、接続ボタン2つ）
- **左**: ターミナル（ローカル or リモートシェル）
- **右**: **SSH Protocol Trace** — 全メッセージの往復、暗号操作、認証結果がリアルタイム表示。暗号化されたメッセージには鍵アイコン付き

## SSH 接続の流れ

```
Client                              Server
  |                                    |
  |--- SSH-2.0-client --------------->|  Phase 1: バージョン交換
  |<-- SSH-2.0-server ----------------|
  |                                    |
  |--- DH public key (e) ------------>|  Phase 2: Diffie-Hellman 鍵交換
  |<-- DH public key (f) + 署名 ------|
  |    両側で共有秘密 K を計算         |  → 盗聴者には K がわからない
  |                                    |
  |=== 以降、全て K で暗号化 =========|  暗号化チャネル確立
  |                                    |
  |--- userauth (password/pubkey) --->|  Phase 3: ユーザ認証
  |<-- success / failure -------------|
  |                                    |
  |--- channel open (shell) --------->|  Phase 4: セッション
  |<-- prompt -------------------------|
  |--- command ----------------------->|
  |<-- output -------------------------|
```

## 認証方式

| 方式 | 説明 | ボタン |
|------|------|--------|
| パスワード認証 | ユーザ名 + パスワード（暗号化チャネル経由で送信） | `ssh connect` |
| 公開鍵認証 | クライアントの公開鍵をサーバの authorized_keys に登録 | `ssh (pubkey)` |

デフォルトのユーザ: `user` / パスワード: `password`、`root` / パスワード: `root`

## リモートシェルコマンド

| コマンド | 説明 |
|---------|------|
| `hostname` | サーバのホスト名 |
| `whoami` | ログインユーザ名 |
| `uname` | カーネル情報 |
| `pwd` | カレントディレクトリ |
| `id` | ユーザ/グループ ID |
| `ls [dir]` | ディレクトリ一覧 |
| `cat <file>` | ファイル内容 |
| `echo <text>` | テキスト出力 |
| `ip` | ネットワーク情報 |
| `uptime` | 稼働時間 |
| `date` | 現在日時 |
| `w` | ログインユーザ |
| `df` | ディスク使用量 |
| `free` | メモリ使用量 |
| `exit` | 切断 |

---

## 実験

### 実験 1: パスワード認証で接続

1. ユーザ名: `user@192.168.1.100`、パスワード: `password`
2. 「ssh connect」をクリック
3. 右パネルに接続の全過程が表示される:
   - Phase 1: バージョン交換 (平文)
   - Phase 2: DH 鍵交換 (公開鍵の交換 → 共有秘密の計算)
   - Phase 3: 認証 (暗号化済み)
   - Phase 4: シェルセッション

---

### 実験 2: Diffie-Hellman 鍵交換の数学

右パネルの DH イベントを見る:

```
DH key generate (client): private=X, public=Y (p=23, g=5)
DH key generate (server): private=A, public=B
DH shared secret (client): B^X mod 23 = K
DH shared secret (server): Y^A mod 23 = K
Shared secret match! K === K
```

クライアントとサーバが**秘密鍵を交換せずに**同じ共有秘密 K を得る。盗聴者は公開鍵 Y と B しか見えないが、K は計算できない。

---

### 実験 3: 暗号化の確認

接続後にコマンドを実行:
```
echo hello
```

右パネルで:
- `-> [client] data: "echo hello\n"` の下に `encrypted: xxxx...` が表示される
- `<- [server] data: "hello\n"` の下にも暗号文が表示される
- 鍵アイコンが付いたメッセージは暗号化されている

---

### 実験 4: 公開鍵認証

1. 「ssh (pubkey)」をクリック
2. クライアント鍵ペアが自動生成され、サーバの authorized_keys に登録される
3. 右パネルの認証ステップで `Auth publickey: user OK` が表示される
4. パスワード入力なしで接続できる

---

### 実験 5: 認証失敗

1. パスワードを `wrong` に変更
2. 「ssh connect」
3. `Permission denied.` と表示される
4. 右パネルに `Auth password: user FAILED` が表示される

---

### 実験 6: リモートサーバの探索

```
hostname
uname
cat /etc/os-release
ls /home/user
cat /home/user/hello.txt
ip
df
free
```

リモートサーバのファイルシステムと設定を確認できる。

---

### 実験 7: 暗号化前後のメッセージ比較

右パネルで:
- Phase 1-2 のメッセージには鍵アイコンがない (平文)
- Phase 3-4 のメッセージには鍵アイコンがある (暗号化)

鍵交換が完了するまでは暗号化できない。鍵交換自体は平文で行われるが、DH の数学的性質により安全。

---

### 実験 8: ホスト鍵フィンガープリント

右パネルの `Host key verification` イベント:
```
Fingerprint: SHA256:xx:xx:xx:xx:xx:xx
```

初回接続時に「このサーバを信頼しますか？」と聞かれるのは、このフィンガープリントを確認するため。中間者攻撃を防ぐ。

---

### 実験 9: セッション切断

```
exit
```

接続が閉じられ、ローカルプロンプトに戻る。右パネルに `disconnect` メッセージが表示される。

---

### 実験 10: root で接続

ユーザ名を `root@192.168.1.100`、パスワードを `root` に変更して接続:

```
whoami
id
```

`root` として接続される。

---

## 暗号の仕組み

### Diffie-Hellman 鍵交換

```
公開パラメータ: p=23 (素数), g=5 (生成元)

Client: 秘密鍵 a をランダム生成、公開鍵 A = g^a mod p を計算して送信
Server: 秘密鍵 b をランダム生成、公開鍵 B = g^b mod p を計算して送信

Client: 共有秘密 K = B^a mod p
Server: 共有秘密 K = A^b mod p

K は同じ値になる: g^(ab) mod p = g^(ba) mod p
盗聴者は A と B しか見えないが、a も b も知らないので K を計算できない
```

### 暗号化チャネル

共有秘密 K を鍵にして全通信を暗号化。このシミュレータでは XOR ベースの簡易暗号を使用。実際の SSH は AES-256-CTR。

## 実際の SSH との違い

| SSH | このシミュレータ |
|-----|-----------------|
| RSA/Ed25519 (2048-4096 bit) | 小さい素数 (p=23) での DH |
| AES-256-CTR | XOR ベースの簡易暗号 |
| HMAC-SHA256 (完全性) | 簡易ハッシュ |
| TCP ソケット (ポート 22) | メモリ上の関数呼び出し |
| OpenSSH (C 言語、数万行) | TypeScript 数百行 |
| pty + fork/exec | コマンドパターンマッチ |
| known_hosts ファイル | 毎回自動承認 |
