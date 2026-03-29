/**
 * S3バケット管理モジュール
 * バケットの作成・削除・一覧・バージョニング設定・ACLを管理する
 */

/** ACLの種類 */
export type ACLType = 'private' | 'public-read' | 'authenticated-read';

/** バージョニングの状態 */
export type VersioningStatus = 'Enabled' | 'Suspended' | 'Disabled';

/** バケットの定義 */
export interface Bucket {
  /** バケット名 */
  name: string;
  /** 作成日時 */
  creationDate: Date;
  /** バージョニング状態 */
  versioning: VersioningStatus;
  /** アクセス制御リスト */
  acl: ACLType;
  /** リージョン */
  region: string;
}

/** バケット管理クラス */
export class BucketManager {
  /** バケットの格納先 */
  private buckets: Map<string, Bucket> = new Map();

  /** バケットを作成する */
  createBucket(name: string, region = 'us-east-1', acl: ACLType = 'private'): Bucket {
    if (this.buckets.has(name)) {
      throw new S3BucketError('BucketAlreadyExists', `バケット "${name}" は既に存在します`, 409);
    }
    // バケット名のバリデーション
    if (!isValidBucketName(name)) {
      throw new S3BucketError('InvalidBucketName', `バケット名 "${name}" は無効です`, 400);
    }
    const bucket: Bucket = {
      name,
      creationDate: new Date(),
      versioning: 'Disabled',
      acl,
      region,
    };
    this.buckets.set(name, bucket);
    return bucket;
  }

  /** バケットを削除する */
  deleteBucket(name: string): void {
    if (!this.buckets.has(name)) {
      throw new S3BucketError('NoSuchBucket', `バケット "${name}" は存在しません`, 404);
    }
    this.buckets.delete(name);
  }

  /** バケットを取得する */
  getBucket(name: string): Bucket {
    const bucket = this.buckets.get(name);
    if (!bucket) {
      throw new S3BucketError('NoSuchBucket', `バケット "${name}" は存在しません`, 404);
    }
    return bucket;
  }

  /** 全バケットを一覧する */
  listBuckets(): Bucket[] {
    return Array.from(this.buckets.values());
  }

  /** バケットが存在するか確認する */
  hasBucket(name: string): boolean {
    return this.buckets.has(name);
  }

  /** バージョニングを設定する */
  setVersioning(name: string, status: VersioningStatus): void {
    const bucket = this.getBucket(name);
    bucket.versioning = status;
  }

  /** バージョニング状態を取得する */
  getVersioning(name: string): VersioningStatus {
    return this.getBucket(name).versioning;
  }

  /** ACLを設定する */
  setACL(name: string, acl: ACLType): void {
    const bucket = this.getBucket(name);
    bucket.acl = acl;
  }

  /** ACLを取得する */
  getACL(name: string): ACLType {
    return this.getBucket(name).acl;
  }
}

/** バケット名のバリデーション */
function isValidBucketName(name: string): boolean {
  // 3〜63文字、小文字英数字・ハイフン・ドットのみ
  if (name.length < 3 || name.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false;
  // IPアドレス形式は不可
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  return true;
}

/** S3バケットエラー */
export class S3BucketError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'S3BucketError';
  }
}
