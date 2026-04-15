/**
 * engine.ts -- Docker コンテナエンジン
 *
 * コンテナ = 隔離された実行環境。実際の Docker は Linux カーネルの機能を使う:
 *
 *   namespace: プロセスから見えるリソースを隔離
 *     - PID namespace: コンテナ内のプロセスIDは1から始まる
 *     - Mount namespace: 独自のファイルシステム（イメージ + 書き込みレイヤー）
 *     - Network namespace: 独自のネットワークスタック（veth + bridge）
 *     - UTS namespace: 独自のホスト名
 *
 *   cgroup: リソース使用量を制限
 *     - CPU 使用率制限
 *     - メモリ上限
 *
 * ここでは全てメモリ上でシミュレートする。
 */
import {
  type DockerImage, type FsLayer,
  resolveUnionFs, parseDockerfile, buildImage, getBaseImage,
  type BuildEvent,
} from "../image/image.js";

/**
 * コンテナのライフサイクル状態を表す定数オブジェクト。
 * created → running → paused/stopped → removed の遷移をとる。
 */
export const ContainerState = {
  Created: "created",
  Running: "running",
  Paused: "paused",
  Stopped: "stopped",
  Removed: "removed",
} as const;
export type ContainerState = (typeof ContainerState)[keyof typeof ContainerState];

/**
 * コンテナの全情報を保持するインターフェース。
 * 名前空間（namespace）による隔離、ファイルシステム、ネットワーク、
 * cgroup によるリソース制限、実行状態を含む。
 */
export interface Container {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  // namespace (隔離)
  pid: number;             // コンテナ内の PID 1
  hostname: string;
  // ファイルシステム (イメージレイヤー + 書き込みレイヤー)
  readonlyLayers: FsLayer[];
  writableLayer: FsLayer;
  // ネットワーク
  ipAddress: string;
  ports: { container: number; host: number }[];
  // cgroup (リソース制限)
  cpuLimit: number;        // % (0=unlimited)
  memoryLimit: number;     // bytes (0=unlimited)
  memoryUsage: number;
  // 実行
  cmd: string[];
  env: Record<string, string>;
  workdir: string;
  stdout: string;
  createdAt: number;
  startedAt: number | undefined;
}

/**
 * Docker エンジンが発行するイベントのユニオン型。
 * イメージ操作、コンテナ操作、名前空間・cgroup・ネットワーク設定など
 * エンジン内部の各操作に対応するイベントを定義する。
 */
export type EngineEvent =
  | { type: "image_pull"; name: string }
  | { type: "image_build"; name: string; layers: number }
  | { type: "container_create"; id: string; name: string; image: string }
  | { type: "container_start"; id: string; name: string }
  | { type: "container_stop"; id: string; name: string }
  | { type: "container_rm"; id: string; name: string }
  | { type: "container_exec"; id: string; command: string; output: string }
  | { type: "namespace_create"; id: string; nsType: string; detail: string }
  | { type: "cgroup_set"; id: string; resource: string; limit: string }
  | { type: "network_connect"; id: string; ip: string; bridge: string }
  | { type: "port_map"; id: string; container: number; host: number }
  | { type: "layer_mount"; id: string; layers: number; mode: string }
  | { type: "stdout"; id: string; text: string };

/** コンテナID生成用のカウンター */
let nextContainerId = 1;
/** IPアドレス割り当て用のカウンター（172.17.0.2 から開始） */
let nextIp = 2;

/**
 * Docker エンジンのシミュレータークラス。
 * イメージの管理、コンテナのライフサイクル管理、コマンド実行を
 * すべてメモリ上でエミュレートする。
 */
export class DockerEngine {
  private images = new Map<string, DockerImage>();
  private containers = new Map<string, Container>();
  events: EngineEvent[] = [];
  onEvent: ((event: EngineEvent) => void) | undefined;

  /** イベントを記録し、リスナーに通知する */
  private emit(event: EngineEvent): void { this.events.push(event); this.onEvent?.(event); }

  /**
   * イメージをレジストリから取得する（docker pull に相当）。
   * 既にローカルに存在する場合はキャッシュを返す。
   * @param name - イメージ名
   * @param tag - イメージタグ（デフォルト: "latest"）
   * @returns 取得した DockerImage オブジェクト
   */
  pull(name: string, tag = "latest"): DockerImage {
    const key = `${name}:${tag}`;
    if (this.images.has(key)) return this.images.get(key)!;
    const image = getBaseImage(name, tag);
    this.images.set(key, image);
    this.emit({ type: "image_pull", name: key });
    return image;
  }

  /**
   * Dockerfile からイメージをビルドする（docker build に相当）。
   * @param dockerfileContent - Dockerfile のテキスト内容
   * @param context - ビルドコンテキスト（COPY 用のファイルマップ）
   * @param name - 生成するイメージの名前
   * @param tag - 生成するイメージのタグ（デフォルト: "latest"）
   * @returns ビルドされたイメージとビルドイベント
   */
  build(dockerfileContent: string, context: Map<string, string>, name: string, tag = "latest"): { image: DockerImage; buildEvents: BuildEvent[] } {
    const instructions = parseDockerfile(dockerfileContent);
    const { image, events: buildEvents } = buildImage(instructions, context, name, tag);
    this.images.set(`${name}:${tag}`, image);
    this.emit({ type: "image_build", name: `${name}:${tag}`, layers: image.layers.length });
    return { image, buildEvents };
  }

  /**
   * コンテナを作成して起動する（docker run に相当）。
   * 名前空間の作成、cgroup の設定、ネットワーク接続、レイヤーマウントを行い、
   * CMD で指定されたコマンドを実行する。
   * @param imageName - 使用するイメージ名（"name:tag" 形式も可）
   * @param options - コンテナ作成オプション（名前、コマンド、環境変数、ポート、リソース制限）
   * @returns 作成されたコンテナオブジェクト
   */
  run(imageName: string, options: {
    name?: string;
    cmd?: string[];
    env?: Record<string, string>;
    ports?: { container: number; host: number }[];
    cpuLimit?: number;
    memoryLimit?: number;
  } = {}): Container {
    const image = this.images.get(imageName) ?? this.pull(imageName.split(":")[0] ?? imageName, imageName.split(":")[1] ?? "latest");
    const id = `c${String(nextContainerId++).padStart(6, "0")}`;
    const name = options.name ?? `${image.name}-${id}`;
    const ip = `172.17.0.${String(nextIp++)}`;

    // 書き込みレイヤー（Copy-on-Write）
    const writableLayer: FsLayer = { id: `rw-${id}`, files: new Map(), deleted: new Set(), command: "(container writable layer)", size: 0 };

    const container: Container = {
      id, name, image: `${image.name}:${image.tag}`,
      state: ContainerState.Created,
      pid: 1, hostname: id.slice(0, 12),
      readonlyLayers: image.layers,
      writableLayer,
      ipAddress: ip,
      ports: options.ports ?? [],
      cpuLimit: options.cpuLimit ?? 0,
      memoryLimit: options.memoryLimit ?? 0,
      memoryUsage: 0,
      cmd: options.cmd ?? image.cmd,
      env: { ...image.env, ...options.env },
      workdir: image.workdir,
      stdout: "",
      createdAt: Date.now(),
      startedAt: undefined,
    };

    this.containers.set(id, container);
    this.emit({ type: "container_create", id, name, image: `${image.name}:${image.tag}` });

    // namespace 作成
    this.emit({ type: "namespace_create", id, nsType: "pid", detail: `PID 1 = ${container.cmd.join(" ")}` });
    this.emit({ type: "namespace_create", id, nsType: "mnt", detail: `${String(image.layers.length)} readonly layers + 1 writable layer` });
    this.emit({ type: "namespace_create", id, nsType: "net", detail: `veth → docker0 bridge` });
    this.emit({ type: "namespace_create", id, nsType: "uts", detail: `hostname: ${container.hostname}` });

    // cgroup 設定
    if (container.cpuLimit > 0) {
      this.emit({ type: "cgroup_set", id, resource: "cpu", limit: `${String(container.cpuLimit)}%` });
    }
    if (container.memoryLimit > 0) {
      this.emit({ type: "cgroup_set", id, resource: "memory", limit: `${String(container.memoryLimit)}B` });
    }

    // ネットワーク接続
    this.emit({ type: "network_connect", id, ip, bridge: "docker0" });
    for (const p of container.ports) {
      this.emit({ type: "port_map", id, container: p.container, host: p.host });
    }

    // レイヤーマウント（OverlayFS）
    this.emit({ type: "layer_mount", id, layers: image.layers.length + 1, mode: "overlay2" });

    // コンテナ開始
    this.start(id);

    return container;
  }

  /**
   * 停止中のコンテナを起動する（docker start に相当）。
   * コンテナの状態を Running に変更し、CMD コマンドを実行する。
   * @param id - コンテナID
   */
  start(id: string): void {
    const c = this.containers.get(id);
    if (c === undefined || c.state === ContainerState.Running) return;
    c.state = ContainerState.Running;
    c.startedAt = Date.now();
    this.emit({ type: "container_start", id, name: c.name });

    // CMD を実行
    this.executeInContainer(c, c.cmd.join(" "));
  }

  /**
   * 実行中のコンテナを停止する（docker stop に相当）。
   * @param id - コンテナID
   */
  stop(id: string): void {
    const c = this.containers.get(id);
    if (c === undefined || c.state !== ContainerState.Running) return;
    c.state = ContainerState.Stopped;
    this.emit({ type: "container_stop", id, name: c.name });
  }

  /**
   * コンテナを削除する（docker rm に相当）。
   * 実行中の場合は先に停止してから削除する。
   * @param id - コンテナID
   */
  rm(id: string): void {
    const c = this.containers.get(id);
    if (c === undefined) return;
    if (c.state === ContainerState.Running) this.stop(id);
    c.state = ContainerState.Removed;
    this.containers.delete(id);
    this.emit({ type: "container_rm", id, name: c.name });
  }

  /**
   * 実行中のコンテナ内でコマンドを実行する（docker exec に相当）。
   * @param id - コンテナID
   * @param command - 実行するコマンド文字列
   * @returns コマンドの出力
   */
  exec(id: string, command: string): string {
    const c = this.containers.get(id);
    if (c === undefined || c.state !== ContainerState.Running) return "Error: container not running";
    return this.executeInContainer(c, command);
  }

  /**
   * コンテナ内でコマンドをシミュレート実行する。
   * echo, cat, ls, pwd, hostname, env, whoami, ps, ip などの基本コマンドをサポート。
   * 実行結果は stdout に蓄積され、メモリ使用量も更新される。
   * @param container - 実行対象のコンテナ
   * @param command - 実行するコマンド文字列
   * @returns コマンドの出力テキスト
   */
  private executeInContainer(container: Container, command: string): string {
    const fs = this.getContainerFs(container);
    let output = "";

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0] ?? "";
    const args = parts.slice(1);

    switch (cmd) {
      case "echo": output = args.join(" ") + "\n"; break;
      case "cat": {
        const path = args[0] ?? "";
        const content = fs.get(path);
        output = content !== undefined ? content + "\n" : `cat: ${path}: No such file\n`;
        break;
      }
      case "ls": {
        const dir = args[0] ?? container.workdir;
        const entries: string[] = [];
        for (const path of fs.keys()) {
          if (path.startsWith(dir) && path !== dir) {
            const rest = path.slice(dir.endsWith("/") ? dir.length : dir.length + 1);
            const name = rest.split("/")[0];
            if (name !== undefined && name.length > 0 && !entries.includes(name)) entries.push(name);
          }
        }
        output = entries.sort().join("\n") + (entries.length > 0 ? "\n" : "");
        break;
      }
      case "pwd": output = container.workdir + "\n"; break;
      case "hostname": output = container.hostname + "\n"; break;
      case "env": {
        for (const [k, v] of Object.entries(container.env)) output += `${k}=${v}\n`;
        break;
      }
      case "whoami": output = "root\n"; break;
      case "ps": output = `PID  CMD\n  1  ${container.cmd.join(" ")}\n`; break;
      case "ip": output = `inet ${container.ipAddress}/16 scope global eth0\n`; break;
      default:
        if (fs.has(`/usr/bin/${cmd}`) || fs.has(`/usr/local/bin/${cmd}`) || fs.has(`/bin/${cmd}`)) {
          output = `(${cmd} executed with args: ${args.join(" ")})\n`;
        } else {
          output = `sh: ${cmd}: not found\n`;
        }
    }

    // 書き込みレイヤーにコマンド出力をログ
    container.stdout += output;
    container.memoryUsage += output.length;
    this.emit({ type: "container_exec", id: container.id, command, output: output.trimEnd() });
    this.emit({ type: "stdout", id: container.id, text: output });
    return output;
  }

  /**
   * コンテナの統合ファイルシステムを取得する。
   * 読み取り専用レイヤーと書き込みレイヤーを UnionFS で結合する。
   * @param container - 対象のコンテナ
   * @returns 統合されたファイルシステム（パス→内容のマップ）
   */
  getContainerFs(container: Container): Map<string, string> {
    const allLayers = [...container.readonlyLayers, container.writableLayer];
    return resolveUnionFs(allLayers);
  }

  /**
   * コンテナ一覧を取得する（docker ps に相当）。
   * @param all - true の場合、停止中のコンテナも含める
   * @returns コンテナの配列
   */
  ps(all = false): Container[] {
    const result: Container[] = [];
    for (const c of this.containers.values()) {
      if (all || c.state === ContainerState.Running) result.push(c);
    }
    return result;
  }

  /**
   * ローカルに保存されたイメージ一覧を取得する（docker images に相当）。
   * @returns DockerImage の配列
   */
  listImages(): DockerImage[] {
    return [...this.images.values()];
  }

  /**
   * IDでコンテナを取得する。
   * @param id - コンテナID
   * @returns コンテナオブジェクト、存在しない場合は undefined
   */
  getContainer(id: string): Container | undefined {
    return this.containers.get(id);
  }

  /** イベント履歴をクリアする */
  resetEvents(): void { this.events = []; }
}
