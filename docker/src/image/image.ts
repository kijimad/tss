/**
 * image.ts -- Docker イメージ（レイヤー化ファイルシステム）
 *
 * Docker イメージ = 読み取り専用のファイルシステムレイヤーの積み重ね。
 * 各レイヤーは Dockerfile の1命令に対応する。
 *
 *   Layer 3: COPY app.js /app/      ← 最上位（ユーザのファイル）
 *   Layer 2: RUN apt-get install     ← パッケージ追加
 *   Layer 1: FROM ubuntu:22.04       ← ベースイメージ
 *
 * UnionFS: 全レイヤーを重ねて1つのFSに見せる。
 * 上位レイヤーが下位を上書きする（Copy-on-Write）。
 */

/**
 * ファイルシステムレイヤーを表すインターフェース。
 * Docker イメージは複数のレイヤーで構成され、各レイヤーはファイルの追加・削除を記録する。
 */
export interface FsLayer {
  id: string;
  files: Map<string, string>;   // path → content
  deleted: Set<string>;          // whiteout: 下位レイヤーのファイルを隠す
  command: string;               // このレイヤーを生成した命令
  size: number;                  // バイト数
}

/**
 * Docker イメージを表すインターフェース。
 * レイヤーの積み重ね、環境変数、デフォルト実行コマンドなどのメタデータを保持する。
 */
export interface DockerImage {
  name: string;
  tag: string;
  layers: FsLayer[];
  env: Record<string, string>;
  workdir: string;
  cmd: string[];                 // デフォルト実行コマンド
  expose: number[];              // 公開ポート
  entrypoint: string[];
}

/**
 * Dockerfile の各命令を表すユニオン型。
 * FROM, RUN, COPY, WORKDIR, ENV, EXPOSE, CMD, ENTRYPOINT をサポートする。
 */
export type DockerInstruction =
  | { type: "FROM"; image: string; tag: string }
  | { type: "RUN"; command: string }
  | { type: "COPY"; src: string; dst: string; content: string }
  | { type: "WORKDIR"; path: string }
  | { type: "ENV"; key: string; value: string }
  | { type: "EXPOSE"; port: number }
  | { type: "CMD"; args: string[] }
  | { type: "ENTRYPOINT"; args: string[] };

/** レイヤーID生成用のカウンター */
let nextLayerId = 1;

/**
 * Dockerfile の内容をパースし、命令の配列に変換する。
 * 空行やコメント行（#で始まる）はスキップされる。
 * @param content - Dockerfile のテキスト内容
 * @returns パースされた Dockerfile 命令の配列
 */
export function parseDockerfile(content: string): DockerInstruction[] {
  const instructions: DockerInstruction[] = [];
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx < 0) continue;
    const cmd = line.slice(0, spaceIdx).toUpperCase();
    const args = line.slice(spaceIdx + 1).trim();

    switch (cmd) {
      case "FROM": {
        const [image, tag] = args.split(":");
        instructions.push({ type: "FROM", image: image ?? args, tag: tag ?? "latest" });
        break;
      }
      case "RUN": instructions.push({ type: "RUN", command: args }); break;
      case "COPY": {
        const parts = args.split(/\s+/);
        instructions.push({ type: "COPY", src: parts[0] ?? "", dst: parts[1] ?? "", content: "" });
        break;
      }
      case "WORKDIR": instructions.push({ type: "WORKDIR", path: args }); break;
      case "ENV": {
        const eqIdx = args.indexOf("=");
        if (eqIdx > 0) instructions.push({ type: "ENV", key: args.slice(0, eqIdx), value: args.slice(eqIdx + 1) });
        break;
      }
      case "EXPOSE": instructions.push({ type: "EXPOSE", port: Number(args) }); break;
      case "CMD": {
        try { instructions.push({ type: "CMD", args: JSON.parse(args) }); }
        catch { instructions.push({ type: "CMD", args: args.split(/\s+/) }); }
        break;
      }
      case "ENTRYPOINT": {
        try { instructions.push({ type: "ENTRYPOINT", args: JSON.parse(args) }); }
        catch { instructions.push({ type: "ENTRYPOINT", args: args.split(/\s+/) }); }
        break;
      }
    }
  }
  return instructions;
}

/**
 * 指定された名前とタグに基づいてベースイメージを生成する。
 * ubuntu, alpine, node, python, nginx のプリセットをサポートする。
 * @param name - ベースイメージ名（例: "ubuntu", "node"）
 * @param tag - イメージタグ（例: "22.04", "latest"）
 * @returns 初期レイヤーとメタデータを含む DockerImage オブジェクト
 */
export function getBaseImage(name: string, tag: string): DockerImage {
  const baseLayers: Record<string, Map<string, string>> = {
    "ubuntu": new Map([
      ["/bin/bash", "#!/bin/bash"], ["/bin/sh", "#!/bin/sh"],
      ["/usr/bin/apt-get", "package-manager"], ["/usr/bin/env", "env"],
      ["/etc/os-release", `NAME="Ubuntu"\nVERSION="${tag}"`],
      ["/etc/hostname", "localhost"],
    ]),
    "alpine": new Map([
      ["/bin/sh", "#!/bin/sh"], ["/sbin/apk", "package-manager"],
      ["/etc/os-release", `NAME="Alpine"\nVERSION="${tag}"`],
    ]),
    "node": new Map([
      ["/bin/bash", "#!/bin/bash"], ["/bin/sh", "#!/bin/sh"],
      ["/usr/local/bin/node", `node ${tag}`],
      ["/usr/local/bin/npm", "npm"],
      ["/usr/local/bin/npx", "npx"],
      ["/etc/os-release", 'NAME="Debian"'],
    ]),
    "python": new Map([
      ["/bin/bash", "#!/bin/bash"], ["/bin/sh", "#!/bin/sh"],
      ["/usr/local/bin/python3", `python ${tag}`],
      ["/usr/local/bin/pip3", "pip"],
    ]),
    "nginx": new Map([
      ["/bin/sh", "#!/bin/sh"],
      ["/usr/sbin/nginx", "nginx"],
      ["/etc/nginx/nginx.conf", "worker_processes auto;"],
      ["/usr/share/nginx/html/index.html", "<h1>Welcome to nginx!</h1>"],
    ]),
  };

  const files = baseLayers[name] ?? new Map([["/bin/sh", "#!/bin/sh"]]);
  const layer: FsLayer = {
    id: `base-${String(nextLayerId++)}`,
    files, deleted: new Set(),
    command: `FROM ${name}:${tag}`,
    size: [...files.values()].reduce((s, v) => s + v.length, 0),
  };

  return {
    name, tag, layers: [layer],
    env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    workdir: "/", cmd: ["/bin/sh"], expose: [], entrypoint: [],
  };
}

/**
 * Dockerfile の命令リストからイメージをビルドする。
 * 各命令を順番に処理し、レイヤーを積み重ねてイメージを構築する。
 * RUN コマンドはパッケージインストールやファイル作成をシミュレートする。
 * @param dockerfile - パース済みの Dockerfile 命令配列
 * @param buildContext - COPY 命令のソースファイル（パス→内容のマップ）
 * @param imageName - ビルドするイメージの名前
 * @param imageTag - ビルドするイメージのタグ
 * @returns ビルドされたイメージとビルドイベントの配列
 */
export function buildImage(
  dockerfile: DockerInstruction[],
  buildContext: Map<string, string>,  // COPY のソースファイル
  imageName: string,
  imageTag: string,
): { image: DockerImage; events: BuildEvent[] } {
  const events: BuildEvent[] = [];
  let image: DockerImage | undefined;

  for (let i = 0; i < dockerfile.length; i++) {
    const instr = dockerfile[i];
    if (instr === undefined) continue;
    const step = `Step ${String(i + 1)}/${String(dockerfile.length)}`;

    switch (instr.type) {
      case "FROM": {
        image = getBaseImage(instr.image, instr.tag);
        events.push({ type: "step", step, command: `FROM ${instr.image}:${instr.tag}`, detail: `Using base image (${String(image.layers[0]?.files.size ?? 0)} files)` });
        break;
      }
      case "RUN": {
        if (image === undefined) break;
        const files = new Map<string, string>();
        // RUN コマンドをシミュレート（パッケージインストール等）
        if (instr.command.includes("apt-get install") || instr.command.includes("apk add")) {
          const pkgs = instr.command.replace(/.*install\s+(-y\s+)?/, "").split(/\s+/);
          for (const pkg of pkgs) {
            if (pkg.startsWith("-")) continue;
            files.set(`/usr/bin/${pkg}`, `${pkg} binary`);
            files.set(`/usr/share/doc/${pkg}/README`, `${pkg} documentation`);
          }
        }
        if (instr.command.includes("npm install") || instr.command.includes("npm ci")) {
          files.set(`${image.workdir}/node_modules/.package-lock.json`, "{}");
        }
        if (instr.command.includes("mkdir")) {
          const dir = instr.command.replace(/.*mkdir\s+(-p\s+)?/, "").trim();
          files.set(dir + "/.keep", "");
        }
        if (instr.command.includes("echo")) {
          const match = instr.command.match(/echo\s+["'](.+?)["']\s*>\s*(.+)/);
          if (match !== null) files.set(match[2]?.trim() ?? "/tmp/out", match[1] ?? "");
        }
        const layer: FsLayer = { id: `run-${String(nextLayerId++)}`, files, deleted: new Set(), command: `RUN ${instr.command}`, size: [...files.values()].reduce((s, v) => s + v.length, 0) };
        image.layers.push(layer);
        events.push({ type: "step", step, command: `RUN ${instr.command}`, detail: `Created layer (${String(files.size)} files, ${String(layer.size)}B)` });
        break;
      }
      case "COPY": {
        if (image === undefined) break;
        const files = new Map<string, string>();
        const content = instr.content || buildContext.get(instr.src) || `(content of ${instr.src})`;
        const dst = instr.dst.endsWith("/") ? instr.dst + instr.src.split("/").pop() : instr.dst;
        const fullDst = dst.startsWith("/") ? dst : image.workdir + "/" + dst;
        files.set(fullDst, content);
        const layer: FsLayer = { id: `copy-${String(nextLayerId++)}`, files, deleted: new Set(), command: `COPY ${instr.src} ${instr.dst}`, size: content.length };
        image.layers.push(layer);
        events.push({ type: "step", step, command: `COPY ${instr.src} ${instr.dst}`, detail: `${fullDst} (${String(content.length)}B)` });
        break;
      }
      case "WORKDIR": {
        if (image === undefined) break;
        image.workdir = instr.path;
        events.push({ type: "step", step, command: `WORKDIR ${instr.path}`, detail: "" });
        break;
      }
      case "ENV": {
        if (image === undefined) break;
        image.env[instr.key] = instr.value;
        events.push({ type: "step", step, command: `ENV ${instr.key}=${instr.value}`, detail: "" });
        break;
      }
      case "EXPOSE": {
        if (image === undefined) break;
        image.expose.push(instr.port);
        events.push({ type: "step", step, command: `EXPOSE ${String(instr.port)}`, detail: "" });
        break;
      }
      case "CMD": {
        if (image === undefined) break;
        image.cmd = instr.args;
        events.push({ type: "step", step, command: `CMD ${JSON.stringify(instr.args)}`, detail: "" });
        break;
      }
      case "ENTRYPOINT": {
        if (image === undefined) break;
        image.entrypoint = instr.args;
        events.push({ type: "step", step, command: `ENTRYPOINT ${JSON.stringify(instr.args)}`, detail: "" });
        break;
      }
    }
  }

  if (image !== undefined) {
    image.name = imageName;
    image.tag = imageTag;
    const totalSize = image.layers.reduce((s, l) => s + l.size, 0);
    events.push({ type: "complete", step: "Done", command: `Built ${imageName}:${imageTag}`, detail: `${String(image.layers.length)} layers, ${String(totalSize)}B` });
  }

  return { image: image ?? getBaseImage("scratch", "latest"), events };
}

/**
 * UnionFS の解決: 全レイヤーを重ねて統合されたファイルシステムを返す。
 * 上位レイヤーのファイルが下位レイヤーを上書きし、
 * 削除マーク（whiteout）されたファイルは結果から除外される。
 * @param layers - 下位から上位へ順序付けられたレイヤー配列
 * @returns 統合されたファイルシステム（パス→内容のマップ）
 */
export function resolveUnionFs(layers: FsLayer[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const layer of layers) {
    for (const path of layer.deleted) result.delete(path);
    for (const [path, content] of layer.files) result.set(path, content);
  }
  return result;
}

/**
 * ビルドプロセス中に発生するイベントを表すインターフェース。
 * ステップの進捗やビルド完了を通知するために使用される。
 */
export interface BuildEvent {
  type: "step" | "complete";
  step: string;
  command: string;
  detail: string;
}
