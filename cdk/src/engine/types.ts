/* ===== AWS CDK シミュレーター 型定義 ===== */

/* ---------- Construct ツリー ---------- */

/** Constructの種別 */
export type ConstructKind =
  | 'app'       /* CDK App (ルート) */
  | 'stack'     /* CloudFormation Stack */
  | 'l1'        /* L1: CfnResource (低レベル) */
  | 'l2'        /* L2: 高レベル Construct */
  | 'l3'        /* L3: パターン Construct */
  | 'output'    /* CloudFormation Output */
  | 'parameter' /* CloudFormation Parameter */
  | 'custom';   /* カスタム Construct */

/** CloudFormation組込関数 */
export type CfnIntrinsic =
  | { Ref: string }
  | { 'Fn::GetAtt': [string, string] }
  | { 'Fn::Join': [string, (string | CfnIntrinsic)[]] }
  | { 'Fn::Sub': string }
  | { 'Fn::Select': [number, (string | CfnIntrinsic)[]] }
  | { 'Fn::ImportValue': string | CfnIntrinsic }
  | { 'Fn::If': [string, unknown, unknown] };

/** プロパティ値 (文字列、数値、参照、組込関数) */
export type PropValue = string | number | boolean | CfnIntrinsic | PropValue[] | { [k: string]: PropValue };

/** CloudFormationリソースプロパティ */
export interface CfnResourceProps {
  [key: string]: PropValue;
}

/** Constructノード */
export interface ConstructNode {
  /** 一意ID (パスベース) */
  id: string;
  /** 表示名 */
  name: string;
  /** 種別 */
  kind: ConstructKind;
  /** 親のID */
  parentId: string | null;
  /** 子のID一覧 */
  childIds: string[];
  /** CloudFormationリソースタイプ (L1/L2の場合) */
  cfnType?: string;
  /** CloudFormationプロパティ */
  cfnProps?: CfnResourceProps;
  /** CloudFormation論理ID */
  logicalId?: string;
  /** メタデータ */
  metadata?: Record<string, string>;
  /** 依存先のlogicalId一覧 */
  dependsOn?: string[];
}

/* ---------- Token / 参照 ---------- */

/** CDK Token: 合成時に解決される遅延値 */
export interface CdkToken {
  /** トークンID */
  tokenId: string;
  /** 解決先の論理ID */
  targetLogicalId: string;
  /** 属性名 (GetAttの場合) */
  attribute?: string;
  /** 解決結果 */
  resolved?: PropValue;
}

/* ---------- Stack ---------- */

/** CloudFormation Stack */
export interface CfnStack {
  /** スタック名 */
  stackName: string;
  /** テンプレートJSON */
  template: CfnTemplate;
  /** 出力値 */
  outputs: CfnOutput[];
  /** パラメータ */
  parameters: CfnParameter[];
  /** エクスポート値 (Cross-stack参照) */
  exports: CfnExport[];
}

/** CloudFormation Output */
export interface CfnOutput {
  logicalId: string;
  value: PropValue;
  description?: string;
  exportName?: string;
}

/** CloudFormation Parameter */
export interface CfnParameter {
  logicalId: string;
  type: string;
  default?: string;
  description?: string;
}

/** Cross-stack Export */
export interface CfnExport {
  name: string;
  value: PropValue;
  stackName: string;
}

/** CloudFormationテンプレート */
export interface CfnTemplate {
  AWSTemplateFormatVersion: string;
  Description?: string;
  Parameters?: Record<string, Record<string, unknown>>;
  Resources: Record<string, CfnResource>;
  Outputs?: Record<string, Record<string, unknown>>;
}

/** CloudFormationリソース */
export interface CfnResource {
  Type: string;
  Properties?: CfnResourceProps;
  DependsOn?: string[];
  Metadata?: Record<string, unknown>;
}

/* ---------- Aspect ---------- */

/** Aspect: Constructツリーを走査して検証/変更するビジター */
export interface CdkAspect {
  name: string;
  description: string;
  /** 対象リソースタイプ (空なら全て) */
  targetTypes: string[];
  /** チェック/変更ルール */
  check: 'tag-required' | 'encryption-required' | 'public-access-blocked' | 'versioning-required' | 'custom';
  /** 重大度 */
  severity: 'error' | 'warning' | 'info';
}

/** Aspect結果 */
export interface AspectResult {
  aspectName: string;
  constructId: string;
  logicalId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  autoFixed: boolean;
}

/* ---------- デプロイ ---------- */

/** デプロイ状態 */
export type DeployStatus =
  | 'pending'
  | 'creating'
  | 'updating'
  | 'deleting'
  | 'complete'
  | 'failed'
  | 'rollback';

/** デプロイされたリソース */
export interface DeployedResource {
  logicalId: string;
  physicalId: string;
  type: string;
  status: DeployStatus;
  properties: CfnResourceProps;
}

/* ---------- シミュレーション ---------- */

/** CDK操作フェーズ */
export type CdkPhase =
  | 'construct'  /* Constructツリー構築 */
  | 'prepare'    /* 準備フェーズ (Aspect実行前) */
  | 'validate'   /* バリデーション */
  | 'aspect'     /* Aspect実行 */
  | 'synthesize' /* CloudFormation合成 */
  | 'resolve'    /* Token解決 */
  | 'deploy'     /* デプロイ (シミュレーション) */
  | 'complete';  /* 完了 */

/** イベント種別 */
export type CdkEventType =
  /* Constructツリー */
  | 'app_create'
  | 'stack_create'
  | 'construct_create'
  | 'construct_add_child'
  | 'dependency_add'
  /* Token */
  | 'token_create'
  | 'token_resolve'
  /* Aspect */
  | 'aspect_visit'
  | 'aspect_warning'
  | 'aspect_error'
  | 'aspect_fix'
  /* 合成 */
  | 'synth_start'
  | 'synth_resource'
  | 'synth_output'
  | 'synth_export'
  | 'synth_import'
  | 'synth_complete'
  /* デプロイ */
  | 'deploy_start'
  | 'deploy_resource_create'
  | 'deploy_resource_complete'
  | 'deploy_resource_failed'
  | 'deploy_rollback'
  | 'deploy_complete'
  /* 情報 */
  | 'info';

/** イベント */
export interface CdkEvent {
  step: number;
  phase: CdkPhase;
  type: CdkEventType;
  message: string;
  constructId?: string;
  logicalId?: string;
  detail?: string;
}

/** ステップスナップショット */
export interface CdkStepSnapshot {
  step: number;
  phase: CdkPhase;
  message: string;
  /** Constructツリー */
  constructs: ConstructNode[];
  /** トークン一覧 */
  tokens: CdkToken[];
  /** Aspect結果 */
  aspectResults: AspectResult[];
  /** 合成テンプレート (スタック毎) */
  templates: Map<string, CfnTemplate>;
  /** デプロイ状態 */
  deployedResources: DeployedResource[];
  /** イベント */
  events: CdkEvent[];
}

/** シミュレーション結果 */
export interface CdkSimResult {
  steps: CdkStepSnapshot[];
  events: CdkEvent[];
  stacks: CfnStack[];
  stats: {
    totalConstructs: number;
    totalResources: number;
    totalTokens: number;
    totalAspectIssues: number;
    deployedCount: number;
    failedCount: number;
  };
}

/** プリセット */
export interface CdkPreset {
  name: string;
  description: string;
  build: () => CdkSimResult;
}
