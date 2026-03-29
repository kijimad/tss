# Docker Engine シミュレータ

ブラウザ上で動作する Docker エンジンの実装。Dockerfile パース、イメージビルド（レイヤー化 FS）、コンテナ起動（namespace/cgroup エミュレーション）、仮想ネットワーク、コンテナ内コマンド実行を可視化する。

## 起動

```bash
npm install
npm run dev
```

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `docker pull <image>` | イメージを取得 |
| `docker build -t <name>` | Dockerfile からビルド (node-app, python-app, nginx-app) |
| `docker run <image>` | コンテナを作成・起動 |
| `docker run --name <n> -p <h>:<c> -e K=V <image>` | オプション付き起動 |
| `docker exec <id> <command>` | コンテナ内でコマンド実行 |
| `docker ps [-a]` | コンテナ一覧 |
| `docker stop <id>` | コンテナ停止 |
| `docker rm <id>` | コンテナ削除 |
| `docker images` | イメージ一覧 |
| `docker inspect <id>` | コンテナ詳細 |

## 画面の見方

- **左**: ターミナル（Docker CLI）
- **右上**: コンテナ一覧（ID、名前、状態、IP）
- **右下**: エンジンイベント（namespace 作成、cgroup 設定、ネットワーク接続、レイヤーマウント）

---

## 実験

### 実験 1: コンテナの起動とコマンド実行

```
docker run ubuntu:22.04
docker ps
docker exec c000001 hostname
docker exec c000001 whoami
docker exec c000001 cat /etc/os-release
docker exec c000001 ls /bin
```

コンテナが起動し、隔離された環境でコマンドが実行される。hostname はコンテナ ID の先頭12文字。

---

### 実験 2: namespace の確認

```
docker run ubuntu:22.04 --name test
```

右パネルのイベントログに:
- `ns:pid PID 1 = /bin/sh` — PID namespace (プロセス隔離)
- `ns:mnt 1 readonly layers + 1 writable layer` — Mount namespace (FS隔離)
- `ns:net veth -> docker0 bridge` — Network namespace (ネットワーク隔離)
- `ns:uts hostname: c000001` — UTS namespace (ホスト名隔離)

---

### 実験 3: ネットワークの確認

```
docker run ubuntu:22.04 --name web1
docker run ubuntu:22.04 --name web2
docker exec web1 ip
docker exec web2 ip
```

各コンテナに 172.17.0.x の IP が自動割り当てされる。右パネルに `net: 172.17.0.x -> docker0` が表示される。

---

### 実験 4: ポートマッピング

```
docker run -p 8080:80 nginx:latest --name my-nginx
docker inspect my-nginx
```

`inspect` で `Ports: 8080:80` が表示される。ホストの 8080 番ポートがコンテナの 80 番に転送される。

---

### 実験 5: Dockerfile からビルド

```
docker build -t node-app
docker images
docker run node-app:latest --name my-node
docker exec my-node ls /app
docker exec my-node cat /app/server.js
```

Dockerfile の各命令がレイヤーとしてビルドされる過程が表示される。`docker images` でレイヤー数とサイズが見える。

---

### 実験 6: Python アプリのビルド

```
docker build -t python-app
docker run python-app:latest --name my-python
docker exec my-python cat /app/app.py
docker exec my-python ls /usr/bin
```

pip で Flask がインストールされた結果がレイヤーに含まれる。

---

### 実験 7: 環境変数

```
docker run -e NODE_ENV=production -e PORT=3000 node:20 --name env-test
docker exec env-test env
```

`-e` で設定した環境変数がコンテナ内で見える。

---

### 実験 8: コンテナのライフサイクル

```
docker run ubuntu:22.04 --name lifecycle
docker ps
docker stop lifecycle
docker ps
docker ps -a
docker rm lifecycle
docker ps -a
```

created → running → stopped → removed の状態遷移。`docker ps` は running のみ、`-a` で全状態を表示。

---

### 実験 9: レイヤー化ファイルシステム

```
docker build -t node-app
docker inspect node-app
```

`Layers: N readonly + 1 writable` と表示される。

- Layer 1: FROM node:20 (ベースイメージ: node, npm 等)
- Layer 2: RUN npm install (node_modules)
- Layer 3: COPY server.js (アプリコード)
- Writable: コンテナ実行時の変更

上位レイヤーが下位を上書きする (UnionFS / OverlayFS)。

---

### 実験 10: 複数コンテナ

```
docker build -t node-app
docker build -t nginx-app
docker run node-app:latest --name backend -p 3000:3000
docker run nginx-app:latest --name frontend -p 8080:80
docker ps
```

複数のコンテナがそれぞれ独立した namespace、IP、ポートで動作する。

---

## 内部構造

### イメージ (image.ts)

```
DockerImage
  ├── Layer 1 (FROM): ベースイメージのファイル群
  ├── Layer 2 (RUN):  パッケージインストール結果
  ├── Layer 3 (COPY): ユーザファイル
  └── metadata: CMD, ENV, WORKDIR, EXPOSE
```

### コンテナ (engine.ts)

```
Container
  ├── Namespace
  │     ├── PID:  PID 1 から開始
  │     ├── Mount: readonly layers + writable layer (Copy-on-Write)
  │     ├── Network: 172.17.0.x/16, docker0 bridge
  │     └── UTS: 独自 hostname
  ├── Cgroup
  │     ├── CPU limit
  │     └── Memory limit
  └── Runtime
        ├── CMD / ENTRYPOINT
        ├── ENV
        └── stdout
```

## 実際の Docker との違い

| Docker | このシミュレータ |
|--------|-----------------|
| Linux kernel (namespace, cgroup) | メモリ上のオブジェクト |
| containerd + runc | TypeScript 関数 |
| OverlayFS (実ファイルシステム) | Map ベースの仮想 FS |
| docker0 bridge + iptables | 文字列の IP アドレス |
| レジストリ (Docker Hub) からダウンロード | プリセットのベースイメージ |
| OCI イメージ形式 (tar + manifest) | TypeScript オブジェクト |
| コンテナ内で実際のプロセスが動作 | コマンドをパターンマッチで応答 |
