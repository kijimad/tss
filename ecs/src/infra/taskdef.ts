/**
 * タスク定義: コンテナ定義（イメージ、CPU、メモリ、ポートマッピング、環境変数、ヘルスチェック）
 * ファミリーとリビジョン管理
 */

/** ポートマッピングの定義 */
export interface PortMapping {
  /** コンテナポート */
  containerPort: number;
  /** ホストポート（0の場合は動的割り当て） */
  hostPort: number;
  /** プロトコル */
  protocol: "tcp" | "udp";
}

/** 環境変数の定義 */
export interface EnvironmentVariable {
  /** 変数名 */
  name: string;
  /** 値 */
  value: string;
}

/** ヘルスチェックの定義 */
export interface HealthCheck {
  /** ヘルスチェックコマンド */
  command: string[];
  /** チェック間隔（秒） */
  interval: number;
  /** タイムアウト（秒） */
  timeout: number;
  /** リトライ回数 */
  retries: number;
  /** 開始待機時間（秒） */
  startPeriod: number;
}

/** コンテナ定義 */
export interface ContainerDefinition {
  /** コンテナ名 */
  name: string;
  /** Dockerイメージ */
  image: string;
  /** CPUユニット */
  cpu: number;
  /** メモリ（MiB） */
  memory: number;
  /** メモリ予約（MiB、ソフトリミット） */
  memoryReservation?: number;
  /** ポートマッピング */
  portMappings: PortMapping[];
  /** 環境変数 */
  environment: EnvironmentVariable[];
  /** ヘルスチェック設定 */
  healthCheck?: HealthCheck;
  /** 必須コンテナかどうか */
  essential: boolean;
  /** ログドライバー */
  logDriver: string;
}

/** タスク定義 */
export interface TaskDefinition {
  /** タスク定義ARN */
  taskDefinitionArn: string;
  /** ファミリー名 */
  family: string;
  /** リビジョン番号 */
  revision: number;
  /** コンテナ定義一覧 */
  containerDefinitions: ContainerDefinition[];
  /** タスク全体のCPUユニット */
  cpu: number;
  /** タスク全体のメモリ（MiB） */
  memory: number;
  /** ネットワークモード */
  networkMode: "bridge" | "host" | "awsvpc" | "none";
  /** タスク定義の状態 */
  status: "ACTIVE" | "INACTIVE";
  /** 登録日時 */
  registeredAt: number;
}

/** タスク定義のレジストリ（ファミリーごとのリビジョン管理） */
export interface TaskDefinitionRegistry {
  /** ファミリー名→リビジョン一覧のマップ */
  families: Map<string, TaskDefinition[]>;
}

/** タスク定義レジストリを作成する */
export function createTaskDefinitionRegistry(): TaskDefinitionRegistry {
  return {
    families: new Map(),
  };
}

/** コンテナ定義のパラメータ */
export interface ContainerDefinitionParams {
  name: string;
  image: string;
  cpu: number;
  memory: number;
  memoryReservation?: number;
  portMappings?: PortMapping[];
  environment?: EnvironmentVariable[];
  healthCheck?: HealthCheck;
  essential?: boolean;
  logDriver?: string;
}

/** コンテナ定義を作成する */
export function createContainerDefinition(
  params: ContainerDefinitionParams,
): ContainerDefinition {
  return {
    name: params.name,
    image: params.image,
    cpu: params.cpu,
    memory: params.memory,
    memoryReservation: params.memoryReservation,
    portMappings: params.portMappings ?? [],
    environment: params.environment ?? [],
    healthCheck: params.healthCheck,
    essential: params.essential ?? true,
    logDriver: params.logDriver ?? "awslogs",
  };
}

/** タスク定義を登録する（新しいリビジョンが作成される） */
export function registerTaskDefinition(
  registry: TaskDefinitionRegistry,
  family: string,
  containerDefinitions: ContainerDefinition[],
  networkMode: "bridge" | "host" | "awsvpc" | "none" = "bridge",
): TaskDefinition {
  if (containerDefinitions.length === 0) {
    throw new Error("コンテナ定義が1つ以上必要です");
  }

  /** 必須コンテナが少なくとも1つ必要 */
  const hasEssential = containerDefinitions.some((cd) => cd.essential);
  if (!hasEssential) {
    throw new Error("必須（essential）コンテナが少なくとも1つ必要です");
  }

  const existingRevisions = registry.families.get(family) ?? [];
  const revision = existingRevisions.length + 1;

  /** タスク全体のCPU/メモリを計算する */
  const totalCpu = containerDefinitions.reduce((sum, cd) => sum + cd.cpu, 0);
  const totalMemory = containerDefinitions.reduce(
    (sum, cd) => sum + cd.memory,
    0,
  );

  const taskDef: TaskDefinition = {
    taskDefinitionArn: `arn:aws:ecs:ap-northeast-1:123456789012:task-definition/${family}:${revision}`,
    family,
    revision,
    containerDefinitions,
    cpu: totalCpu,
    memory: totalMemory,
    networkMode,
    status: "ACTIVE",
    registeredAt: Date.now(),
  };

  /** 前のリビジョンを非アクティブにする */
  for (const prev of existingRevisions) {
    prev.status = "INACTIVE";
  }

  const updatedRevisions = [...existingRevisions, taskDef];
  registry.families.set(family, updatedRevisions);

  return taskDef;
}

/** 最新のタスク定義を取得する */
export function getLatestTaskDefinition(
  registry: TaskDefinitionRegistry,
  family: string,
): TaskDefinition | undefined {
  const revisions = registry.families.get(family);
  if (!revisions || revisions.length === 0) {
    return undefined;
  }
  return revisions[revisions.length - 1];
}

/** 特定のリビジョンのタスク定義を取得する */
export function getTaskDefinition(
  registry: TaskDefinitionRegistry,
  family: string,
  revision: number,
): TaskDefinition | undefined {
  const revisions = registry.families.get(family);
  if (!revisions) {
    return undefined;
  }
  return revisions.find((td) => td.revision === revision);
}

/** タスク定義を非アクティブにする */
export function deregisterTaskDefinition(
  registry: TaskDefinitionRegistry,
  family: string,
  revision: number,
): void {
  const taskDef = getTaskDefinition(registry, family, revision);
  if (!taskDef) {
    throw new Error(
      `タスク定義が見つかりません: ${family}:${revision}`,
    );
  }
  taskDef.status = "INACTIVE";
}

/** タスク定義に必要なリソースを計算する */
export function getRequiredResources(taskDef: TaskDefinition): {
  cpu: number;
  memory: number;
} {
  return {
    cpu: taskDef.cpu,
    memory: taskDef.memory,
  };
}
