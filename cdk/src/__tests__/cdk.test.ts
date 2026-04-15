/* ===== CDK シミュレーター テスト ===== */

import { describe, it, expect } from 'vitest';
import { CdkSimulator, CdkDeployFailSimulator } from '../engine/engine';
import { presets } from '../engine/presets';

describe('Constructツリー構築', () => {
  it('App/Stack/Constructの階層が構築される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'MyStack');
    sim.addL2(stack, 'Bucket', 'AWS::S3::Bucket', { BucketName: 'test' });
    const result = sim.synthesize();

    expect(result.stats.totalConstructs).toBeGreaterThanOrEqual(3); // app + stack + bucket
    expect(result.stats.totalResources).toBe(1);
  });

  it('L1 Constructが直接CfnResourceとして追加される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Table', 'AWS::DynamoDB::Table', { BillingMode: 'PAY_PER_REQUEST' });
    const result = sim.synthesize();

    const template = result.stacks[0]!.template;
    const resources = Object.values(template.Resources);
    expect(resources).toHaveLength(1);
    expect(resources[0]!.Type).toBe('AWS::DynamoDB::Table');
  });

  it('L2 Constructが内部リソースを生成する', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL2(stack, 'Bucket', 'AWS::S3::Bucket', {}, [
      { name: 'Policy', cfnType: 'AWS::S3::BucketPolicy', props: {} },
    ]);
    const result = sim.synthesize();

    /* L2本体 + 内部L1 = 2リソース */
    expect(result.stats.totalResources).toBe(2);
  });

  it('L3 Constructが複数リソースを一括生成する', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL3(stack, 'Pattern', [
      { name: 'Api', kind: 'l2', cfnType: 'AWS::ApiGateway::RestApi', props: {} },
      { name: 'Fn', kind: 'l1', cfnType: 'AWS::Lambda::Function', props: {} },
      { name: 'Table', kind: 'l1', cfnType: 'AWS::DynamoDB::Table', props: {} },
    ]);
    const result = sim.synthesize();

    expect(result.stats.totalResources).toBe(3);
  });
});

describe('依存関係', () => {
  it('DependsOnがテンプレートに反映される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    const vpc = sim.addL1(stack, 'Vpc', 'AWS::EC2::VPC', { CidrBlock: '10.0.0.0/16' });
    const subnet = sim.addL1(stack, 'Sub', 'AWS::EC2::Subnet', { CidrBlock: '10.0.1.0/24' });
    sim.addDependency(subnet, vpc);
    const result = sim.synthesize();

    const template = result.stacks[0]!.template;
    const subResource = Object.entries(template.Resources).find(([_, r]) => r.Type === 'AWS::EC2::Subnet');
    expect(subResource).toBeTruthy();
    expect(subResource![1].DependsOn).toBeTruthy();
    expect(subResource![1].DependsOn!.length).toBe(1);
  });

  it('トポロジカルソートで依存順にデプロイされる', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    const a = sim.addL1(stack, 'A', 'AWS::SNS::Topic', {});
    const b = sim.addL1(stack, 'B', 'AWS::SQS::Queue', {});
    const c = sim.addL1(stack, 'C', 'AWS::Lambda::Function', {});
    sim.addDependency(c, a);
    sim.addDependency(c, b);
    const result = sim.synthesize();

    /* Cは最後にデプロイされるはず */
    const deployed = result.steps[result.steps.length - 1]!.deployedResources;
    const cIdx = deployed.findIndex(r => r.type === 'AWS::Lambda::Function');
    const aIdx = deployed.findIndex(r => r.type === 'AWS::SNS::Topic');
    const bIdx = deployed.findIndex(r => r.type === 'AWS::SQS::Queue');
    expect(cIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
  });
});

describe('Token (参照)', () => {
  it('Tokenが Ref に解決される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    const bucket = sim.addL1(stack, 'Bucket', 'AWS::S3::Bucket', {});
    sim.createToken(bucket);
    const result = sim.synthesize();

    expect(result.stats.totalTokens).toBe(1);
    const resolvedToken = result.steps.find(s => s.phase === 'resolve')?.tokens[0];
    expect(resolvedToken?.resolved).toEqual({ Ref: resolvedToken?.targetLogicalId });
  });

  it('属性付きTokenが Fn::GetAtt に解決される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    const table = sim.addL1(stack, 'Table', 'AWS::DynamoDB::Table', {});
    sim.createToken(table, 'Arn');
    const result = sim.synthesize();

    const resolvedToken = result.steps.find(s => s.phase === 'resolve')?.tokens[0];
    expect(resolvedToken?.resolved).toEqual({ 'Fn::GetAtt': [resolvedToken?.targetLogicalId, 'Arn'] });
  });

  it('tokenRefがプロパティに埋め込める', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    const table = sim.addL1(stack, 'Table', 'AWS::DynamoDB::Table', {});
    const token = sim.createToken(table, 'Arn');
    sim.addL1(stack, 'Fn', 'AWS::Lambda::Function', {
      Environment: { TABLE_ARN: sim.tokenRef(token) },
    });
    const result = sim.synthesize();

    const fnResource = Object.values(result.stacks[0]!.template.Resources)
      .find(r => r.Type === 'AWS::Lambda::Function');
    const env = fnResource?.Properties?.['Environment'] as Record<string, unknown> | undefined;
    expect(env?.['TABLE_ARN']).toEqual({ 'Fn::GetAtt': expect.arrayContaining(['Arn']) });
  });
});

describe('Aspect', () => {
  it('タグなしリソースが検出される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'NoTags', 'AWS::S3::Bucket', { BucketName: 'no-tags' });

    sim.addAspect({
      name: 'TagCheck', description: '', targetTypes: [],
      check: 'tag-required', severity: 'warning',
    });

    const result = sim.synthesize();
    const warnings = result.steps.find(s => s.phase === 'aspect')?.aspectResults;
    expect(warnings?.length).toBeGreaterThan(0);
    expect(warnings?.[0]?.severity).toBe('warning');
  });

  it('暗号化なしリソースが検出される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Bucket', 'AWS::S3::Bucket', {});

    sim.addAspect({
      name: 'EncCheck', description: '', targetTypes: ['AWS::S3::Bucket'],
      check: 'encryption-required', severity: 'error',
    });

    const result = sim.synthesize();
    const errors = result.steps.find(s => s.phase === 'aspect')?.aspectResults
      .filter(r => r.severity === 'error');
    expect(errors?.length).toBeGreaterThan(0);
  });

  it('S3パブリックアクセスブロックが自動追加される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Bucket', 'AWS::S3::Bucket', { BucketName: 'test' });

    sim.addAspect({
      name: 'PublicBlock', description: '', targetTypes: ['AWS::S3::Bucket'],
      check: 'public-access-blocked', severity: 'warning',
    });

    const result = sim.synthesize();
    const fixes = result.steps.find(s => s.phase === 'aspect')?.aspectResults
      .filter(r => r.autoFixed);
    expect(fixes?.length).toBe(1);

    /* テンプレートに反映されている */
    const bucket = Object.values(result.stacks[0]!.template.Resources)
      .find(r => r.Type === 'AWS::S3::Bucket');
    expect(bucket?.Properties?.['PublicAccessBlockConfiguration']).toBeTruthy();
  });
});

describe('CloudFormation合成', () => {
  it('テンプレートにAWSTemplateFormatVersionがある', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Q', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    expect(result.stacks[0]!.template.AWSTemplateFormatVersion).toBe('2010-09-09');
  });

  it('Outputがテンプレートに含まれる', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    const bucket = sim.addL1(stack, 'B', 'AWS::S3::Bucket', {});
    const token = sim.createToken(bucket);
    sim.addOutput(stack, 'BucketRef', sim.tokenRef(token), 'S:BucketId');
    const result = sim.synthesize();

    expect(result.stacks[0]!.template.Outputs).toBeTruthy();
    expect(result.stacks[0]!.exports.length).toBe(1);
    expect(result.stacks[0]!.exports[0]!.name).toBe('S:BucketId');
  });

  it('Parameterがテンプレートに含まれる', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addParameter(stack, 'Env', 'String', 'prod', '環境');
    sim.addL1(stack, 'Q', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    expect(result.stacks[0]!.template.Parameters).toBeTruthy();
    expect(result.stacks[0]!.parameters.length).toBe(1);
    expect(result.stacks[0]!.parameters[0]!.type).toBe('String');
  });

  it('Cross-stack参照でFn::ImportValueが使える', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const s1 = sim.createStack(app, 'S1');
    const vpc = sim.addL1(s1, 'Vpc', 'AWS::EC2::VPC', {});
    const token = sim.createToken(vpc);
    sim.addOutput(s1, 'VpcOut', sim.tokenRef(token), 'S1:VpcId');

    const s2 = sim.createStack(app, 'S2');
    sim.addL1(s2, 'Inst', 'AWS::EC2::Instance', {
      VpcId: { 'Fn::ImportValue': 'S1:VpcId' },
    });
    const result = sim.synthesize();

    expect(result.stacks.length).toBe(2);
    const s2Template = result.stacks[1]!.template;
    const inst = Object.values(s2Template.Resources)[0];
    expect(inst?.Properties?.['VpcId']).toEqual({ 'Fn::ImportValue': 'S1:VpcId' });
  });
});

describe('デプロイシミュレーション', () => {
  it('全リソースがデプロイされる', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'A', 'AWS::SNS::Topic', {});
    sim.addL1(stack, 'B', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    expect(result.stats.deployedCount).toBe(2);
    expect(result.stats.failedCount).toBe(0);
  });

  it('physicalIdが生成される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Q', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    const deployed = result.steps[result.steps.length - 1]!.deployedResources;
    expect(deployed[0]?.physicalId).toContain('S-');
  });

  it('デプロイ失敗時にロールバックされる', () => {
    const sim = new CdkDeployFailSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Good', 'AWS::SNS::Topic', {});
    sim.addL1(stack, 'Bad', 'AWS::Lambda::Function', {});
    sim.setFailTarget('Bad');
    const result = sim.synthesize();

    expect(result.stats.failedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('フェーズ遷移', () => {
  it('全フェーズが順番に実行される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Q', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    const phases = result.steps.map(s => s.phase);
    expect(phases).toContain('construct');
    expect(phases).toContain('validate');
    expect(phases).toContain('aspect');
    expect(phases).toContain('resolve');
    expect(phases).toContain('synthesize');
    expect(phases).toContain('deploy');
    expect(phases).toContain('complete');
    /* constructが最初 */
    expect(phases.indexOf('construct')).toBeLessThan(phases.indexOf('synthesize'));
  });

  it('イベントが記録される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const stack = sim.createStack(app, 'S');
    sim.addL1(stack, 'Q', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    expect(result.events.length).toBeGreaterThan(5);
    const types = result.events.map(e => e.type);
    expect(types).toContain('app_create');
    expect(types).toContain('stack_create');
    expect(types).toContain('synth_complete');
  });
});

describe('マルチスタック', () => {
  it('複数スタックが独立してテンプレート化される', () => {
    const sim = new CdkSimulator();
    const app = sim.createApp();
    const s1 = sim.createStack(app, 'S1');
    const s2 = sim.createStack(app, 'S2');
    sim.addL1(s1, 'A', 'AWS::SNS::Topic', {});
    sim.addL1(s2, 'B', 'AWS::SQS::Queue', {});
    const result = sim.synthesize();

    expect(result.stacks.length).toBe(2);
    expect(Object.keys(result.stacks[0]!.template.Resources).length).toBe(1);
    expect(Object.keys(result.stacks[1]!.template.Resources).length).toBe(1);
  });
});

describe('プリセット', () => {
  it('全プリセットが正常に実行される', () => {
    expect(presets.length).toBeGreaterThanOrEqual(12);
    for (const preset of presets) {
      const result = preset.build();
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it('S3バケットプリセットが1リソースを生成する', () => {
    const result = presets[0]!.build();
    expect(result.stats.totalResources).toBe(1);
    expect(result.stacks[0]!.template.Resources).toBeTruthy();
  });

  it('Cross-stackプリセットが2スタックを生成する', () => {
    const result = presets[3]!.build();
    expect(result.stacks.length).toBe(2);
    expect(result.stacks[0]!.exports.length).toBeGreaterThan(0);
  });

  it('Aspectプリセットが警告を検出する', () => {
    const result = presets[5]!.build();
    const aspectStep = result.steps.find(s => s.phase === 'aspect');
    expect(aspectStep?.aspectResults.length).toBeGreaterThan(0);
  });

  it('ECS Fargateプリセットが多数のリソースを生成する', () => {
    const result = presets[9]!.build();
    expect(result.stats.totalResources).toBeGreaterThanOrEqual(8);
  });
});
