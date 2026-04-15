/* ===== CDK シミュレーター プリセット ===== */

import type { CdkPreset } from './types';
import { CdkSimulator, CdkDeployFailSimulator } from './engine';

export const presets: CdkPreset[] = [

  /* ===== 1. 基本: S3バケット ===== */
  {
    name: 'S3バケット (基本)',
    description: 'L2 Constructで S3 バケットを作成。Constructツリー→合成→デプロイの基本フロー',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'StorageStack', 'S3ストレージスタック');
      sim.addL2(stack, 'MyBucket', 'AWS::S3::Bucket', {
        BucketName: 'my-app-bucket-2024',
        VersioningConfiguration: { Status: 'Enabled' },
        Tags: [{ Key: 'Project', Value: 'MyApp' }],
      });
      return sim.synthesize();
    },
  },

  /* ===== 2. VPC + EC2 (依存関係) ===== */
  {
    name: 'VPC + EC2 (依存関係)',
    description: 'VPC→Subnet→SecurityGroup→EC2の依存チェーンとDependsOnの解決',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'NetworkStack', 'VPC + EC2 ネットワークスタック');

      const vpc = sim.addL2(stack, 'Vpc', 'AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
        EnableDnsSupport: true,
        Tags: [{ Key: 'Name', Value: 'MyVpc' }],
      });

      const subnet = sim.addL2(stack, 'Subnet', 'AWS::EC2::Subnet', {
        VpcId: { Ref: 'VpcBD03A091' },
        CidrBlock: '10.0.1.0/24',
        AvailabilityZone: 'ap-northeast-1a',
      });
      sim.addDependency(subnet, vpc);

      const sg = sim.addL2(stack, 'SG', 'AWS::EC2::SecurityGroup', {
        GroupDescription: 'Web Security Group',
        VpcId: { Ref: 'VpcBD03A091' },
        SecurityGroupIngress: [
          { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: '0.0.0.0/0' },
          { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' },
        ],
      });
      sim.addDependency(sg, vpc);

      const ec2 = sim.addL2(stack, 'Instance', 'AWS::EC2::Instance', {
        InstanceType: 't3.micro',
        ImageId: 'ami-0abcdef1234567890',
        SubnetId: { Ref: 'SubnetA1234567' },
        SecurityGroupIds: [{ Ref: 'SG12345678' }],
      });
      sim.addDependency(ec2, subnet);
      sim.addDependency(ec2, sg);

      return sim.synthesize();
    },
  },

  /* ===== 3. L1/L2/L3 Construct階層 ===== */
  {
    name: 'L1/L2/L3 Construct階層',
    description: 'L1(CfnResource), L2(高レベル), L3(パターン)の3層Constructと内部リソース生成',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'AppStack', 'アプリケーションスタック');

      /* L1: 直接 CfnResource */
      sim.addL1(stack, 'CfnTable', 'AWS::DynamoDB::Table', {
        TableName: 'raw-cfn-table',
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      });

      /* L2: 高レベル Construct (内部でポリシーも生成) */
      sim.addL2(stack, 'AppBucket', 'AWS::S3::Bucket', {
        BucketName: 'app-data-bucket',
        VersioningConfiguration: { Status: 'Enabled' },
      }, [
        {
          name: 'BucketPolicy',
          cfnType: 'AWS::S3::BucketPolicy',
          props: { Bucket: { Ref: 'AppBucket' }, PolicyDocument: { Statement: [] } },
        },
      ]);

      /* L3: パターン (API Gateway + Lambda + DynamoDB) */
      sim.addL3(stack, 'RestApi', [
        {
          name: 'Api', kind: 'l2', cfnType: 'AWS::ApiGateway::RestApi',
          props: { Name: 'MyApi', Description: 'REST API' },
          additional: [
            { name: 'Deployment', cfnType: 'AWS::ApiGateway::Deployment', props: {} },
            { name: 'Stage', cfnType: 'AWS::ApiGateway::Stage', props: { StageName: 'prod' } },
          ],
        },
        {
          name: 'Handler', kind: 'l2', cfnType: 'AWS::Lambda::Function',
          props: { Runtime: 'nodejs20.x', Handler: 'index.handler', MemorySize: 256 },
          additional: [
            { name: 'Role', cfnType: 'AWS::IAM::Role', props: { AssumeRolePolicyDocument: {} } },
          ],
        },
        {
          name: 'Table', kind: 'l1', cfnType: 'AWS::DynamoDB::Table',
          props: { BillingMode: 'PAY_PER_REQUEST' },
        },
      ]);

      return sim.synthesize();
    },
  },

  /* ===== 4. Cross-stack参照 ===== */
  {
    name: 'Cross-stack参照',
    description: '2つのスタック間でExport/ImportValueを使ったリソース参照',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();

      /* ネットワークスタック */
      const netStack = sim.createStack(app, 'NetworkStack', 'ネットワーク基盤');
      const vpc = sim.addL2(netStack, 'SharedVpc', 'AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
        Tags: [{ Key: 'Name', Value: 'SharedVpc' }],
      });
      const vpcToken = sim.createToken(vpc);
      sim.addOutput(netStack, 'VpcIdOutput', sim.tokenRef(vpcToken), 'NetworkStack:VpcId', 'VPC ID');

      const subnet = sim.addL2(netStack, 'PublicSubnet', 'AWS::EC2::Subnet', {
        CidrBlock: '10.0.1.0/24',
        VpcId: sim.tokenRef(vpcToken),
      });
      sim.addDependency(subnet, vpc);
      const subnetToken = sim.createToken(subnet);
      sim.addOutput(netStack, 'SubnetIdOutput', sim.tokenRef(subnetToken), 'NetworkStack:SubnetId', 'Subnet ID');

      /* アプリケーションスタック */
      const appStack = sim.createStack(app, 'AppStack', 'アプリケーション');
      sim.addL2(appStack, 'WebServer', 'AWS::EC2::Instance', {
        InstanceType: 't3.micro',
        SubnetId: { 'Fn::ImportValue': 'NetworkStack:SubnetId' },
        SecurityGroupIds: [],
      });
      sim.addL2(appStack, 'Database', 'AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.t3.micro',
        Engine: 'mysql',
        VPCSecurityGroups: [],
        DBSubnetGroupName: 'default',
      });

      return sim.synthesize();
    },
  },

  /* ===== 5. Token (参照/遅延解決) ===== */
  {
    name: 'Token (参照/遅延解決)',
    description: 'CDK Tokenの作成とRef/Fn::GetAttへの合成時解決プロセス',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'TokenStack', 'Token解決デモ');

      /* DynamoDBテーブル */
      const table = sim.addL2(stack, 'UserTable', 'AWS::DynamoDB::Table', {
        TableName: 'users',
        AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      });

      /* テーブルARNのToken */
      const tableArnToken = sim.createToken(table, 'Arn');
      const tableNameToken = sim.createToken(table);

      /* Lambda関数 (テーブルARNを環境変数で参照) */
      const fn = sim.addL2(stack, 'Handler', 'AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Handler: 'index.handler',
        Environment: {
          Variables: {
            TABLE_ARN: sim.tokenRef(tableArnToken),
            TABLE_NAME: sim.tokenRef(tableNameToken),
          },
        },
      });

      /* IAMロール (テーブルへのアクセス権限) */
      const role = sim.addL2(stack, 'HandlerRole', 'AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [{
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }],
        },
        Policies: [{
          PolicyName: 'DynamoAccess',
          PolicyDocument: {
            Statement: [{
              Effect: 'Allow',
              Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
              Resource: sim.tokenRef(tableArnToken),
            }],
          },
        }],
      });

      sim.addDependency(fn, table);
      sim.addDependency(fn, role);

      return sim.synthesize();
    },
  },

  /* ===== 6. Aspect (タグ検証) ===== */
  {
    name: 'Aspect (タグ検証)',
    description: 'Aspectビジターパターンで全リソースのタグ・暗号化ポリシーを検証',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'ComplianceStack', 'コンプライアンス検証');

      /* タグ付きバケット */
      sim.addL2(stack, 'GoodBucket', 'AWS::S3::Bucket', {
        BucketName: 'compliant-bucket',
        Tags: [{ Key: 'Environment', Value: 'prod' }, { Key: 'Team', Value: 'platform' }],
        ServerSideEncryptionConfiguration: {
          Rules: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms' } }],
        },
      });

      /* タグなしバケット */
      sim.addL2(stack, 'BadBucket', 'AWS::S3::Bucket', {
        BucketName: 'non-compliant-bucket',
      });

      /* 暗号化なしテーブル */
      sim.addL2(stack, 'BadTable', 'AWS::DynamoDB::Table', {
        TableName: 'unencrypted-table',
        BillingMode: 'PAY_PER_REQUEST',
      });

      /* タグ付きEC2 */
      sim.addL2(stack, 'GoodInstance', 'AWS::EC2::Instance', {
        InstanceType: 't3.micro',
        Tags: [{ Key: 'Environment', Value: 'prod' }],
      });

      /* Aspect追加 */
      sim.addAspect({
        name: 'TagChecker',
        description: '全リソースにタグが設定されているか検証',
        targetTypes: [],
        check: 'tag-required',
        severity: 'warning',
      });
      sim.addAspect({
        name: 'EncryptionChecker',
        description: '暗号化が設定されているか検証',
        targetTypes: ['AWS::S3::Bucket', 'AWS::DynamoDB::Table'],
        check: 'encryption-required',
        severity: 'error',
      });

      return sim.synthesize();
    },
  },

  /* ===== 7. Aspect (自動修正) ===== */
  {
    name: 'Aspect (自動修正)',
    description: 'S3パブリックアクセスブロックの自動追加とバージョニング検証',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'AutoFixStack', '自動修正デモ');

      /* パブリックアクセスブロックなし */
      sim.addL2(stack, 'Bucket1', 'AWS::S3::Bucket', {
        BucketName: 'needs-fix-bucket-1',
        Tags: [{ Key: 'Env', Value: 'dev' }],
      });

      sim.addL2(stack, 'Bucket2', 'AWS::S3::Bucket', {
        BucketName: 'needs-fix-bucket-2',
        Tags: [{ Key: 'Env', Value: 'staging' }],
      });

      /* 既にブロック設定済み */
      sim.addL2(stack, 'Bucket3', 'AWS::S3::Bucket', {
        BucketName: 'already-secure-bucket',
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true, BlockPublicPolicy: true,
          IgnorePublicAcls: true, RestrictPublicBuckets: true,
        },
        Tags: [{ Key: 'Env', Value: 'prod' }],
      });

      sim.addAspect({
        name: 'PublicAccessBlocker',
        description: 'S3バケットにパブリックアクセスブロックを自動追加',
        targetTypes: ['AWS::S3::Bucket'],
        check: 'public-access-blocked',
        severity: 'warning',
      });

      sim.addAspect({
        name: 'VersioningChecker',
        description: 'S3バケットにバージョニングが設定されているか検証',
        targetTypes: ['AWS::S3::Bucket'],
        check: 'versioning-required',
        severity: 'warning',
      });

      return sim.synthesize();
    },
  },

  /* ===== 8. Parameter / Output ===== */
  {
    name: 'Parameter / Output',
    description: 'CloudFormation ParameterとOutputの定義と合成',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'ParamStack', 'パラメータ化スタック');

      sim.addParameter(stack, 'EnvParam', 'String', 'production', '環境名');
      sim.addParameter(stack, 'InstanceTypeParam', 'String', 't3.micro', 'EC2インスタンスタイプ');
      sim.addParameter(stack, 'KeyPairParam', 'AWS::EC2::KeyPair::KeyName', undefined, 'SSHキーペア名');

      const instance = sim.addL2(stack, 'Server', 'AWS::EC2::Instance', {
        InstanceType: { Ref: 'InstanceTypeParam' },
        KeyName: { Ref: 'KeyPairParam' },
        Tags: [{ Key: 'Environment', Value: { Ref: 'EnvParam' } }],
      });

      const token = sim.createToken(instance);
      sim.addOutput(stack, 'InstanceId', sim.tokenRef(token), undefined, 'EC2インスタンスID');
      sim.addOutput(stack, 'PublicIp', { 'Fn::GetAtt': ['Server', 'PublicIp'] }, 'ParamStack:PublicIp', 'パブリックIP');

      return sim.synthesize();
    },
  },

  /* ===== 9. マルチスタック構成 ===== */
  {
    name: 'マルチスタック構成',
    description: '3スタック構成 (共有基盤→API→フロントエンド) の合成と依存解決',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();

      /* 共有基盤スタック */
      const infra = sim.createStack(app, 'InfraStack', '共有基盤');
      const vpc = sim.addL2(infra, 'Vpc', 'AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
        Tags: [{ Key: 'Name', Value: 'MainVpc' }],
      });
      const vpcToken = sim.createToken(vpc);
      sim.addOutput(infra, 'VpcId', sim.tokenRef(vpcToken), 'InfraStack:VpcId');

      sim.addL2(infra, 'PrivateSubnet', 'AWS::EC2::Subnet', {
        CidrBlock: '10.0.10.0/24',
        Tags: [{ Key: 'Tier', Value: 'private' }],
      });
      sim.addL2(infra, 'PublicSubnet', 'AWS::EC2::Subnet', {
        CidrBlock: '10.0.1.0/24',
        Tags: [{ Key: 'Tier', Value: 'public' }],
      });

      /* APIスタック */
      const api = sim.createStack(app, 'ApiStack', 'APIサーバー');
      sim.addL2(api, 'ApiGateway', 'AWS::ApiGateway::RestApi', {
        Name: 'MainApi',
        Tags: [{ Key: 'Service', Value: 'api' }],
      });
      sim.addL2(api, 'LambdaFn', 'AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Handler: 'api.handler',
        Tags: [{ Key: 'Service', Value: 'api' }],
      });
      sim.addL2(api, 'ApiTable', 'AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
        Tags: [{ Key: 'Service', Value: 'api' }],
      });

      /* フロントエンドスタック */
      const fe = sim.createStack(app, 'FrontendStack', 'フロントエンド配信');
      sim.addL2(fe, 'SiteBucket', 'AWS::S3::Bucket', {
        BucketName: 'frontend-assets',
        WebsiteConfiguration: { IndexDocument: 'index.html' },
        Tags: [{ Key: 'Service', Value: 'frontend' }],
      });
      sim.addL2(fe, 'CDN', 'AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Origins: [{ DomainName: 'frontend-assets.s3.amazonaws.com' }],
          DefaultCacheBehavior: { ViewerProtocolPolicy: 'redirect-to-https' },
          Enabled: true,
        },
        Tags: [{ Key: 'Service', Value: 'frontend' }],
      });

      return sim.synthesize();
    },
  },

  /* ===== 10. ECS Fargate パターン (L3) ===== */
  {
    name: 'ECS Fargate パターン (L3)',
    description: 'L3 Constructパターンで ECS Fargate + ALB + ログの一括構築',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'FargateStack', 'ECS Fargate サービス');

      /* L3: ApplicationLoadBalancedFargateService パターン */
      sim.addL3(stack, 'WebService', [
        {
          name: 'EcsCluster', kind: 'l2', cfnType: 'AWS::ECS::Cluster',
          props: { ClusterName: 'web-cluster', Tags: [{ Key: 'Service', Value: 'web' }] },
        },
        {
          name: 'TaskDef', kind: 'l2', cfnType: 'AWS::ECS::TaskDefinition',
          props: {
            Family: 'web-task', Cpu: '256', Memory: '512',
            NetworkMode: 'awsvpc', RequiresCompatibilities: ['FARGATE'],
            ContainerDefinitions: [{
              Name: 'web', Image: 'nginx:latest', PortMappings: [{ ContainerPort: 80 }],
              LogConfiguration: { LogDriver: 'awslogs' },
            }],
          },
          additional: [
            { name: 'TaskRole', cfnType: 'AWS::IAM::Role', props: { Tags: [{ Key: 'Role', Value: 'task' }] } },
            { name: 'ExecutionRole', cfnType: 'AWS::IAM::Role', props: { Tags: [{ Key: 'Role', Value: 'execution' }] } },
          ],
        },
        {
          name: 'Service', kind: 'l2', cfnType: 'AWS::ECS::Service',
          props: {
            LaunchType: 'FARGATE', DesiredCount: 2,
            NetworkConfiguration: { AwsvpcConfiguration: { Subnets: [], SecurityGroups: [] } },
          },
        },
        {
          name: 'ALB', kind: 'l2', cfnType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
          props: { Scheme: 'internet-facing', Type: 'application', Tags: [{ Key: 'Service', Value: 'web' }] },
          additional: [
            { name: 'Listener', cfnType: 'AWS::ElasticLoadBalancingV2::Listener', props: { Port: 80, Protocol: 'HTTP' } },
            { name: 'TargetGroup', cfnType: 'AWS::ElasticLoadBalancingV2::TargetGroup', props: { Port: 80, TargetType: 'ip' } },
          ],
        },
        {
          name: 'LogGroup', kind: 'l1', cfnType: 'AWS::Logs::LogGroup',
          props: { LogGroupName: '/ecs/web-service', RetentionInDays: 30 },
        },
      ]);

      return sim.synthesize();
    },
  },

  /* ===== 11. デプロイ失敗/ロールバック ===== */
  {
    name: 'デプロイ失敗/ロールバック',
    description: 'リソース作成失敗時のCloudFormationロールバック動作のシミュレーション',
    build() {
      const sim = new CdkDeployFailSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'FailStack', 'デプロイ失敗テスト');

      sim.addL2(stack, 'Table', 'AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
        Tags: [{ Key: 'Test', Value: 'fail' }],
      });
      sim.addL2(stack, 'BadLambda', 'AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Handler: 'broken.handler',
        Tags: [{ Key: 'Test', Value: 'fail' }],
      });
      sim.addL2(stack, 'Queue', 'AWS::SQS::Queue', {
        QueueName: 'test-queue',
        Tags: [{ Key: 'Test', Value: 'fail' }],
      });

      sim.setFailTarget('BadLambda');
      return sim.synthesize();
    },
  },

  /* ===== 12. サーバーレス API 完全構成 ===== */
  {
    name: 'サーバーレスAPI完全構成',
    description: 'API Gateway + Lambda + DynamoDB + Cognito + CloudWatch の本格構成',
    build() {
      const sim = new CdkSimulator();
      const app = sim.createApp();
      const stack = sim.createStack(app, 'ServerlessStack', 'サーバーレスAPI');

      /* Cognito */
      const userPool = sim.addL2(stack, 'UserPool', 'AWS::Cognito::UserPool', {
        UserPoolName: 'app-users',
        AutoVerifiedAttributes: ['email'],
        Tags: [{ Key: 'Service', Value: 'auth' }],
      }, [
        { name: 'Client', cfnType: 'AWS::Cognito::UserPoolClient', props: { ClientName: 'web-client' } },
      ]);

      /* DynamoDB */
      const table = sim.addL2(stack, 'DataTable', 'AWS::DynamoDB::Table', {
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
        BillingMode: 'PAY_PER_REQUEST',
        Tags: [{ Key: 'Service', Value: 'data' }],
      });
      const tableToken = sim.createToken(table, 'Arn');

      /* Lambda */
      const fn = sim.addL2(stack, 'ApiHandler', 'AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Handler: 'api.handler',
        MemorySize: 512,
        Timeout: 30,
        Environment: { Variables: { TABLE_ARN: sim.tokenRef(tableToken) } },
        Tags: [{ Key: 'Service', Value: 'api' }],
      }, [
        { name: 'Role', cfnType: 'AWS::IAM::Role', props: { AssumeRolePolicyDocument: {} } },
        { name: 'Policy', cfnType: 'AWS::IAM::Policy', props: { PolicyDocument: { Statement: [] } } },
      ]);
      sim.addDependency(fn, table);

      /* API Gateway */
      const apiGw = sim.addL2(stack, 'Api', 'AWS::ApiGateway::RestApi', {
        Name: 'ServerlessApi',
        Tags: [{ Key: 'Service', Value: 'api' }],
      }, [
        { name: 'Authorizer', cfnType: 'AWS::ApiGateway::Authorizer', props: { Type: 'COGNITO_USER_POOLS' } },
        { name: 'Deployment', cfnType: 'AWS::ApiGateway::Deployment', props: {} },
        { name: 'Stage', cfnType: 'AWS::ApiGateway::Stage', props: { StageName: 'prod' } },
      ]);
      sim.addDependency(apiGw, userPool);

      /* CloudWatch */
      sim.addL2(stack, 'Dashboard', 'AWS::CloudWatch::Dashboard', {
        DashboardName: 'serverless-metrics',
      });
      sim.addL2(stack, 'Alarm', 'AWS::CloudWatch::Alarm', {
        AlarmName: 'api-errors',
        MetricName: 'Errors',
        Threshold: 10,
        ComparisonOperator: 'GreaterThanThreshold',
        Tags: [{ Key: 'Service', Value: 'monitoring' }],
      });

      /* Aspect */
      sim.addAspect({
        name: 'TagEnforcer',
        description: '全リソースにServiceタグを強制',
        targetTypes: [],
        check: 'tag-required',
        severity: 'warning',
      });

      return sim.synthesize();
    },
  },
];
