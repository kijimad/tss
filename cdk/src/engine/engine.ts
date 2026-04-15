/* ===== AWS CDK シミュレーター エンジン ===== */

import type {
  ConstructNode, ConstructKind, CdkToken, CfnStack, CfnTemplate,
  CfnResource, CfnOutput, CfnParameter, CfnExport,
  CdkAspect, AspectResult, DeployedResource, DeployStatus,
  CdkPhase, CdkEvent, CdkEventType, CdkStepSnapshot, CdkSimResult,
  CfnResourceProps, PropValue,
} from './types';

/* ---------- CDKシミュレーター ---------- */

export class CdkSimulator {
  private constructs: Map<string, ConstructNode> = new Map();
  private tokens: CdkToken[] = [];
  private aspects: CdkAspect[] = [];
  private aspectResults: AspectResult[] = [];
  private templates: Map<string, CfnTemplate> = new Map();
  private deployedResources: DeployedResource[] = [];
  private stacks: CfnStack[] = [];
  private events: CdkEvent[] = [];
  private steps: CdkStepSnapshot[] = [];
  private step = 0;
  private phase: CdkPhase = 'construct';
  private nextTokenId = 0;

  /* ========== Constructツリー構築 ========== */

  /** Appを作成 */
  createApp(name: string = 'App'): string {
    const id = name;
    this.addConstruct(id, name, 'app', null);
    this.emit('app_create', `CDK App「${name}」を作成`, id);
    return id;
  }

  /** Stackを作成 */
  createStack(appId: string, name: string, description?: string): string {
    const id = `${appId}/${name}`;
    this.addConstruct(id, name, 'stack', appId);
    const node = this.constructs.get(id)!;
    if (description) node.metadata = { description };
    this.emit('stack_create', `Stack「${name}」を作成`, id);
    return id;
  }

  /** L1 Construct (CfnResource) を追加 */
  addL1(parentId: string, name: string, cfnType: string, props: CfnResourceProps = {}): string {
    const id = `${parentId}/${name}`;
    const logicalId = this.generateLogicalId(id);
    this.addConstruct(id, name, 'l1', parentId, cfnType, props, logicalId);
    this.emit('construct_create', `L1 Construct「${name}」(${cfnType}) を追加`, id, logicalId);
    return id;
  }

  /** L2 Construct (高レベル) を追加 → 内部でL1を生成 */
  addL2(parentId: string, name: string, cfnType: string, props: CfnResourceProps = {},
    additionalResources: { name: string; cfnType: string; props: CfnResourceProps }[] = []): string {
    const id = `${parentId}/${name}`;
    const logicalId = this.generateLogicalId(id);
    this.addConstruct(id, name, 'l2', parentId, cfnType, props, logicalId);
    this.emit('construct_create', `L2 Construct「${name}」(${cfnType}) を追加`, id, logicalId);

    /* L2は内部でL1リソースを生成する */
    for (const res of additionalResources) {
      this.addL1(id, res.name, res.cfnType, res.props);
    }
    return id;
  }

  /** L3 Construct (パターン) を追加 → 複数のL2/L1を生成 */
  addL3(parentId: string, name: string, children: { name: string; kind: 'l1' | 'l2'; cfnType: string; props: CfnResourceProps;
    additional?: { name: string; cfnType: string; props: CfnResourceProps }[] }[]): string {
    const id = `${parentId}/${name}`;
    this.addConstruct(id, name, 'l3', parentId);
    this.emit('construct_create', `L3 パターン「${name}」を追加`, id);

    for (const child of children) {
      if (child.kind === 'l2') {
        this.addL2(id, child.name, child.cfnType, child.props, child.additional ?? []);
      } else {
        this.addL1(id, child.name, child.cfnType, child.props);
      }
    }
    return id;
  }

  /** Output を追加 */
  addOutput(stackId: string, name: string, value: PropValue, exportName?: string, description?: string): string {
    const id = `${stackId}/${name}`;
    const logicalId = this.generateLogicalId(id);
    this.addConstruct(id, name, 'output', stackId, undefined, undefined, logicalId);
    const node = this.constructs.get(id)!;
    node.metadata = {
      value: JSON.stringify(value),
      ...(exportName ? { exportName } : {}),
      ...(description ? { description } : {}),
    };
    this.emit('construct_create', `Output「${name}」を追加`, id, logicalId);
    return id;
  }

  /** Parameter を追加 */
  addParameter(stackId: string, name: string, type: string, defaultValue?: string, description?: string): string {
    const id = `${stackId}/${name}`;
    const logicalId = this.generateLogicalId(id);
    this.addConstruct(id, name, 'parameter', stackId, undefined, undefined, logicalId);
    const node = this.constructs.get(id)!;
    node.metadata = { type, ...(defaultValue ? { default: defaultValue } : {}), ...(description ? { description } : {}) };
    this.emit('construct_create', `Parameter「${name}」(${type}) を追加`, id, logicalId);
    return id;
  }

  /** 依存関係を追加 */
  addDependency(fromId: string, toId: string): void {
    const from = this.constructs.get(fromId);
    const to = this.constructs.get(toId);
    if (!from || !to) return;
    const toLogicalId = to.logicalId ?? to.id;
    if (!from.dependsOn) from.dependsOn = [];
    from.dependsOn.push(toLogicalId);
    this.emit('dependency_add', `${from.name} → ${to.name} の依存関係を追加`, fromId, from.logicalId);
  }

  /** Token (参照) を作成 */
  createToken(targetId: string, attribute?: string): CdkToken {
    const target = this.constructs.get(targetId);
    const logicalId = target?.logicalId ?? targetId;
    const token: CdkToken = {
      tokenId: `Token${this.nextTokenId++}`,
      targetLogicalId: logicalId,
      attribute,
    };
    this.tokens.push(token);
    this.emit('token_create', `Token「${token.tokenId}」→ ${logicalId}${attribute ? '.' + attribute : ''} を作成`, targetId, logicalId);
    return token;
  }

  /** Token参照をプロパティ値に変換 */
  tokenRef(token: CdkToken): PropValue {
    if (token.attribute) {
      return { 'Fn::GetAtt': [token.targetLogicalId, token.attribute] };
    }
    return { Ref: token.targetLogicalId };
  }

  /** Aspect を追加 */
  addAspect(aspect: CdkAspect): void {
    this.aspects.push(aspect);
  }

  /* ========== スナップショット ========== */

  private snapshot(message: string): void {
    this.step++;
    const snap: CdkStepSnapshot = {
      step: this.step,
      phase: this.phase,
      message,
      constructs: Array.from(this.constructs.values()).map(c => ({ ...c })),
      tokens: this.tokens.map(t => ({ ...t })),
      aspectResults: [...this.aspectResults],
      templates: new Map(this.templates),
      deployedResources: this.deployedResources.map(r => ({ ...r })),
      events: [...this.events],
    };
    this.steps.push(snap);
  }

  private emit(type: CdkEventType, message: string, constructId?: string, logicalId?: string, detail?: string): void {
    this.events.push({ step: this.step + 1, phase: this.phase, type, message, constructId, logicalId, detail });
  }

  /* ========== 合成 (Synthesize) ========== */

  /** Constructツリー全体を合成して CloudFormation テンプレートを生成 */
  synthesize(): CdkSimResult {
    /* フェーズ1: Constructツリー構築完了スナップショット */
    this.phase = 'construct';
    this.snapshot('Constructツリー構築完了');

    /* フェーズ2: 準備 */
    this.phase = 'prepare';
    this.emit('info', '準備フェーズ開始');
    this.snapshot('準備フェーズ');

    /* フェーズ3: バリデーション */
    this.phase = 'validate';
    this.validateTree();
    this.snapshot('バリデーション完了');

    /* フェーズ4: Aspect実行 */
    this.phase = 'aspect';
    this.runAspects();
    this.snapshot('Aspect実行完了');

    /* フェーズ5: Token解決 */
    this.phase = 'resolve';
    this.resolveTokens();
    this.snapshot('Token解決完了');

    /* フェーズ6: CloudFormation合成 */
    this.phase = 'synthesize';
    this.synthTemplates();
    this.snapshot('CloudFormation合成完了');

    /* フェーズ7: デプロイシミュレーション */
    this.phase = 'deploy';
    this.simulateDeploy();
    this.snapshot('デプロイ完了');

    /* フェーズ8: 完了 */
    this.phase = 'complete';
    this.emit('info', 'CDKシミュレーション完了');
    this.snapshot('シミュレーション完了');

    return this.buildResult();
  }

  /* ---------- バリデーション ---------- */

  private validateTree(): void {
    /* スタックが存在するか確認 */
    const stacks = this.getNodesByKind('stack');
    if (stacks.length === 0) {
      this.emit('aspect_error', 'スタックが定義されていません');
    }

    /* 各リソースの依存先が存在するか確認 */
    for (const node of this.constructs.values()) {
      if (node.dependsOn) {
        for (const dep of node.dependsOn) {
          const found = Array.from(this.constructs.values()).some(c => c.logicalId === dep);
          if (!found) {
            this.emit('aspect_warning', `${node.name} の依存先 ${dep} が見つかりません`, node.id, node.logicalId);
          }
        }
      }
    }
  }

  /* ---------- Aspect実行 ---------- */

  private runAspects(): void {
    for (const aspect of this.aspects) {
      this.emit('aspect_visit', `Aspect「${aspect.name}」を実行`, undefined, undefined, aspect.description);

      const resources = Array.from(this.constructs.values()).filter(c =>
        (c.kind === 'l1' || c.kind === 'l2') && c.cfnType &&
        (aspect.targetTypes.length === 0 || aspect.targetTypes.includes(c.cfnType))
      );

      for (const resource of resources) {
        const result = this.evaluateAspect(aspect, resource);
        if (result) {
          this.aspectResults.push(result);
          const evtType: CdkEventType =
            result.severity === 'error' ? 'aspect_error' :
            result.severity === 'warning' ? 'aspect_warning' :
            'aspect_visit';
          this.emit(evtType, result.message, resource.id, resource.logicalId);
          if (result.autoFixed) {
            this.emit('aspect_fix', `自動修正: ${result.message}`, resource.id, resource.logicalId);
          }
        }
      }
    }
  }

  private evaluateAspect(aspect: CdkAspect, node: ConstructNode): AspectResult | null {
    switch (aspect.check) {
      case 'tag-required': {
        const tags = node.cfnProps?.['Tags'];
        if (!tags || (Array.isArray(tags) && tags.length === 0)) {
          return {
            aspectName: aspect.name,
            constructId: node.id,
            logicalId: node.logicalId ?? node.id,
            severity: aspect.severity,
            message: `${node.name} (${node.cfnType}) にタグが設定されていません`,
            autoFixed: false,
          };
        }
        return null;
      }
      case 'encryption-required': {
        const encrypted = node.cfnProps?.['Encrypted'] ?? node.cfnProps?.['ServerSideEncryptionConfiguration']
          ?? node.cfnProps?.['KmsKeyId'];
        if (!encrypted) {
          return {
            aspectName: aspect.name,
            constructId: node.id,
            logicalId: node.logicalId ?? node.id,
            severity: aspect.severity,
            message: `${node.name} (${node.cfnType}) に暗号化が設定されていません`,
            autoFixed: false,
          };
        }
        return null;
      }
      case 'public-access-blocked': {
        const publicAccess = node.cfnProps?.['PublicAccessBlockConfiguration'];
        if (!publicAccess && node.cfnType === 'AWS::S3::Bucket') {
          /* 自動修正: パブリックアクセスブロックを追加 */
          if (!node.cfnProps) node.cfnProps = {};
          node.cfnProps['PublicAccessBlockConfiguration'] = {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          };
          return {
            aspectName: aspect.name,
            constructId: node.id,
            logicalId: node.logicalId ?? node.id,
            severity: 'info',
            message: `${node.name} にPublicAccessBlockを自動追加しました`,
            autoFixed: true,
          };
        }
        return null;
      }
      case 'versioning-required': {
        const versioning = node.cfnProps?.['VersioningConfiguration'];
        if (!versioning && node.cfnType === 'AWS::S3::Bucket') {
          return {
            aspectName: aspect.name,
            constructId: node.id,
            logicalId: node.logicalId ?? node.id,
            severity: aspect.severity,
            message: `${node.name} (${node.cfnType}) にバージョニングが設定されていません`,
            autoFixed: false,
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  /* ---------- Token解決 ---------- */

  private resolveTokens(): void {
    for (const token of this.tokens) {
      if (token.attribute) {
        token.resolved = { 'Fn::GetAtt': [token.targetLogicalId, token.attribute] };
      } else {
        token.resolved = { Ref: token.targetLogicalId };
      }
      this.emit('token_resolve', `Token「${token.tokenId}」→ ${JSON.stringify(token.resolved)}`, undefined, token.targetLogicalId);
    }
  }

  /* ---------- CloudFormation テンプレート合成 ---------- */

  private synthTemplates(): void {
    const stacks = this.getNodesByKind('stack');

    for (const stackNode of stacks) {
      this.emit('synth_start', `Stack「${stackNode.name}」の合成を開始`, stackNode.id);

      const template: CfnTemplate = {
        AWSTemplateFormatVersion: '2010-09-09',
        Description: stackNode.metadata?.['description'],
        Resources: {},
      };

      const outputs: CfnOutput[] = [];
      const parameters: CfnParameter[] = [];
      const exports: CfnExport[] = [];

      /* スタック配下のリソースを収集 */
      const descendants = this.getDescendants(stackNode.id);

      for (const node of descendants) {
        if ((node.kind === 'l1' || node.kind === 'l2') && node.cfnType && node.logicalId) {
          const resource: CfnResource = {
            Type: node.cfnType,
            Properties: node.cfnProps ? { ...node.cfnProps } : undefined,
          };
          if (node.dependsOn && node.dependsOn.length > 0) {
            resource.DependsOn = [...node.dependsOn];
          }
          template.Resources[node.logicalId] = resource;
          this.emit('synth_resource', `リソース「${node.logicalId}」(${node.cfnType}) をテンプレートに追加`, node.id, node.logicalId);
        }

        if (node.kind === 'output' && node.logicalId && node.metadata) {
          const value: PropValue = JSON.parse(node.metadata['value'] ?? '""');
          const output: CfnOutput = { logicalId: node.logicalId, value, description: node.metadata['description'] };
          const exportName = node.metadata['exportName'];
          if (exportName) {
            output.exportName = exportName;
            exports.push({ name: exportName, value, stackName: stackNode.name });
            this.emit('synth_export', `Export「${exportName}」を追加`, node.id, node.logicalId);
          }
          outputs.push(output);

          if (!template.Outputs) template.Outputs = {};
          const outDef: Record<string, unknown> = { Value: value };
          if (output.description) outDef['Description'] = output.description;
          if (output.exportName) outDef['Export'] = { Name: output.exportName };
          template.Outputs[node.logicalId] = outDef;
          this.emit('synth_output', `Output「${node.logicalId}」をテンプレートに追加`, node.id, node.logicalId);
        }

        if (node.kind === 'parameter' && node.logicalId && node.metadata) {
          const param: CfnParameter = {
            logicalId: node.logicalId,
            type: node.metadata['type'] ?? 'String',
            default: node.metadata['default'],
            description: node.metadata['description'],
          };
          parameters.push(param);

          if (!template.Parameters) template.Parameters = {};
          const pDef: Record<string, unknown> = { Type: param.type };
          if (param.default) pDef['Default'] = param.default;
          if (param.description) pDef['Description'] = param.description;
          template.Parameters[node.logicalId] = pDef;
        }
      }

      this.templates.set(stackNode.name, template);
      this.stacks.push({ stackName: stackNode.name, template, outputs, parameters, exports });
      this.emit('synth_complete', `Stack「${stackNode.name}」の合成完了 (${Object.keys(template.Resources).length}リソース)`, stackNode.id);
    }
  }

  /* ---------- デプロイシミュレーション ---------- */

  private simulateDeploy(): void {
    for (const stack of this.stacks) {
      this.emit('deploy_start', `Stack「${stack.stackName}」のデプロイを開始`);

      /* 依存関係順にリソースを作成 */
      const ordered = this.topologicalSort(stack.template.Resources);

      for (const logicalId of ordered) {
        const resource = stack.template.Resources[logicalId];
        if (!resource) continue;

        this.emit('deploy_resource_create', `${logicalId} (${resource.Type}) を作成中...`, undefined, logicalId);

        const physicalId = `${stack.stackName}-${logicalId}-${randomId()}`;
        const deployed: DeployedResource = {
          logicalId,
          physicalId,
          type: resource.Type,
          status: 'creating',
          properties: resource.Properties ?? {},
        };
        this.deployedResources.push(deployed);
        this.snapshot(`${logicalId} を作成中`);

        /* 作成完了 */
        deployed.status = 'complete';
        this.emit('deploy_resource_complete', `${logicalId} (${resource.Type}) 作成完了 → ${physicalId}`, undefined, logicalId);
      }

      this.emit('deploy_complete', `Stack「${stack.stackName}」のデプロイ完了`);
    }
  }

  /** リソースの依存関係をトポロジカルソートする */
  private topologicalSort(resources: Record<string, CfnResource>): string[] {
    const ids = Object.keys(resources);
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const res = resources[id];
      if (res?.DependsOn) {
        for (const dep of res.DependsOn) {
          if (resources[dep]) visit(dep);
        }
      }
      result.push(id);
    };

    for (const id of ids) visit(id);
    return result;
  }

  /* ---------- ヘルパー ---------- */

  private addConstruct(id: string, name: string, kind: ConstructKind, parentId: string | null,
    cfnType?: string, cfnProps?: CfnResourceProps, logicalId?: string): void {
    const node: ConstructNode = { id, name, kind, parentId, childIds: [], cfnType, cfnProps, logicalId };
    this.constructs.set(id, node);

    if (parentId) {
      const parent = this.constructs.get(parentId);
      if (parent) {
        parent.childIds.push(id);
        this.emit('construct_add_child', `${parent.name} に ${name} を追加`, parentId);
      }
    }
  }

  private generateLogicalId(path: string): string {
    /* CDKの論理ID生成: パスのコンポーネントを結合 + ハッシュ */
    const parts = path.split('/').filter(p => p !== '');
    /* Appとスタック名はスキップ */
    const relevant = parts.slice(2);
    if (relevant.length === 0) return parts[parts.length - 1] ?? path;
    const base = relevant.map(p => p.replace(/[^A-Za-z0-9]/g, '')).join('');
    const hash = simpleHash(path).toString(16).slice(0, 8).toUpperCase();
    return `${base}${hash}`;
  }

  private getNodesByKind(kind: ConstructKind): ConstructNode[] {
    return Array.from(this.constructs.values()).filter(c => c.kind === kind);
  }

  private getDescendants(id: string): ConstructNode[] {
    const result: ConstructNode[] = [];
    const visit = (nodeId: string) => {
      const node = this.constructs.get(nodeId);
      if (!node) return;
      result.push(node);
      for (const childId of node.childIds) {
        visit(childId);
      }
    };
    const root = this.constructs.get(id);
    if (root) {
      for (const childId of root.childIds) {
        visit(childId);
      }
    }
    return result;
  }

  private buildResult(): CdkSimResult {
    let totalResources = 0;
    for (const stack of this.stacks) {
      totalResources += Object.keys(stack.template.Resources).length;
    }
    return {
      steps: this.steps,
      events: this.events,
      stacks: this.stacks,
      stats: {
        totalConstructs: this.constructs.size,
        totalResources,
        totalTokens: this.tokens.length,
        totalAspectIssues: this.aspectResults.length,
        deployedCount: this.deployedResources.filter(r => r.status === 'complete').length,
        failedCount: this.deployedResources.filter(r => r.status === 'failed').length,
      },
    };
  }
}

/* ---------- ユーティリティ ---------- */

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------- ロールバックシミュレーション ---------- */

/** デプロイ失敗+ロールバックを含むシミュレーション */
export class CdkDeployFailSimulator extends CdkSimulator {
  private failTarget: string | null = null;

  /** 指定リソースのデプロイで失敗させる */
  setFailTarget(logicalIdSubstring: string): void {
    this.failTarget = logicalIdSubstring;
  }

  /** デプロイをオーバーライド (失敗+ロールバック) */
  synthesize(): CdkSimResult {
    /* 通常の構築～合成まで実行 */
    const baseResult = super.synthesize();

    if (!this.failTarget) return baseResult;

    /* 失敗リソースを設定 */
    const failedIdx = baseResult.steps.findIndex(s =>
      s.deployedResources.some(r => r.logicalId.includes(this.failTarget!) && r.status === 'creating')
    );

    if (failedIdx >= 0) {
      /* 失敗ステップ以降のデプロイ済みリソースをロールバック */
      const lastStep = baseResult.steps[baseResult.steps.length - 1]!;
      for (const r of lastStep.deployedResources) {
        if (r.logicalId.includes(this.failTarget!)) {
          r.status = 'failed' as DeployStatus;
        } else if (r.status === 'complete') {
          r.status = 'rollback' as DeployStatus;
        }
      }
      baseResult.stats.failedCount = lastStep.deployedResources.filter(r => r.status === 'failed').length;
      baseResult.stats.deployedCount = lastStep.deployedResources.filter(r => r.status === 'complete').length;
    }

    return baseResult;
  }
}
