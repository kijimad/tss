/**
 * S3オブジェクトストレージモジュール
 * オブジェクトの保存・取得・削除・コピー・メタデータ管理を行う
 * バージョニング対応（バージョンID、削除マーカー）
 */

import type { VersioningStatus } from './bucket.js';

/** オブジェクトのメタデータ */
export interface ObjectMetadata {
  /** コンテンツタイプ */
  contentType: string;
  /** ETag (MD5ハッシュ) */
  etag: string;
  /** 最終更新日時 */
  lastModified: Date;
  /** コンテンツ長 */
  contentLength: number;
  /** カスタムメタデータ (x-amz-meta-*) */
  customMetadata: Record<string, string>;
}

/** オブジェクトのバージョン */
export interface ObjectVersion {
  /** バージョンID */
  versionId: string;
  /** オブジェクトデータ */
  data: Uint8Array;
  /** メタデータ */
  metadata: ObjectMetadata;
  /** 削除マーカーかどうか */
  isDeleteMarker: boolean;
  /** 作成日時 */
  createdAt: Date;
}

/** 格納されたオブジェクト */
export interface StoredObject {
  /** バケット名 */
  bucket: string;
  /** オブジェクトキー */
  key: string;
  /** バージョン一覧（最新が先頭） */
  versions: ObjectVersion[];
  /** オブジェクトレベルのACL */
  acl: 'private' | 'public-read' | 'authenticated-read';
}

/** PutObjectのパラメータ */
export interface PutObjectParams {
  bucket: string;
  key: string;
  data: Uint8Array;
  contentType?: string;
  customMetadata?: Record<string, string>;
}

/** GetObjectの結果 */
export interface GetObjectResult {
  data: Uint8Array;
  metadata: ObjectMetadata;
  versionId: string;
}

/** ListObjectsV2のパラメータ */
export interface ListObjectsV2Params {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
}

/** ListObjectsV2の結果 */
export interface ListObjectsV2Result {
  /** オブジェクト一覧 */
  contents: Array<{
    key: string;
    lastModified: Date;
    etag: string;
    size: number;
  }>;
  /** 共通プレフィックス（フォルダ的表示用） */
  commonPrefixes: string[];
  /** 切り詰められたか */
  isTruncated: boolean;
  /** 次のページ用トークン */
  nextContinuationToken?: string;
  /** キー数 */
  keyCount: number;
}

/** オブジェクトストレージ */
export class ObjectStore {
  /** オブジェクトの格納先。キーは "bucket/key" 形式 */
  private objects: Map<string, StoredObject> = new Map();
  /** バージョンIDのカウンタ */
  private versionCounter = 0;

  /** バージョニング状態を取得する関数 */
  private getVersioning: (bucket: string) => VersioningStatus;

  constructor(getVersioning: (bucket: string) => VersioningStatus) {
    this.getVersioning = getVersioning;
  }

  /** 格納キーを生成する */
  private storageKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  /** バージョンIDを生成する */
  private generateVersionId(): string {
    this.versionCounter++;
    const ts = Date.now().toString(36);
    const count = this.versionCounter.toString(36).padStart(4, '0');
    return `${ts}-${count}`;
  }

  /** 簡易的なETag（MD5代替）を生成する */
  private computeETag(data: Uint8Array): string {
    // 簡易ハッシュ: FNV-1aベースのハッシュ値を生成
    let hash = 0x811c9dc5;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `"${hex}"`;
  }

  /** オブジェクトを保存する */
  putObject(params: PutObjectParams): { etag: string; versionId: string } {
    const sk = this.storageKey(params.bucket, params.key);
    const etag = this.computeETag(params.data);
    const versioningStatus = this.getVersioning(params.bucket);
    const versionId = versioningStatus === 'Enabled' ? this.generateVersionId() : 'null';

    const version: ObjectVersion = {
      versionId,
      data: params.data,
      metadata: {
        contentType: params.contentType ?? 'application/octet-stream',
        etag,
        lastModified: new Date(),
        contentLength: params.data.length,
        customMetadata: params.customMetadata ?? {},
      },
      isDeleteMarker: false,
      createdAt: new Date(),
    };

    const existing = this.objects.get(sk);
    if (existing) {
      if (versioningStatus === 'Enabled') {
        // バージョニング有効: 先頭に追加
        existing.versions.unshift(version);
      } else {
        // バージョニング無効: 上書き
        existing.versions = [version];
      }
    } else {
      this.objects.set(sk, {
        bucket: params.bucket,
        key: params.key,
        versions: [version],
        acl: 'private',
      });
    }

    return { etag, versionId };
  }

  /** オブジェクトを取得する */
  getObject(bucket: string, key: string, versionId?: string): GetObjectResult {
    const sk = this.storageKey(bucket, key);
    const obj = this.objects.get(sk);
    if (!obj || obj.versions.length === 0) {
      throw new S3ObjectError('NoSuchKey', `キー "${key}" は存在しません`, 404);
    }

    let version: ObjectVersion | undefined;
    if (versionId) {
      version = obj.versions.find((v) => v.versionId === versionId);
      if (!version) {
        throw new S3ObjectError('NoSuchVersion', `バージョン "${versionId}" は存在しません`, 404);
      }
    } else {
      version = obj.versions[0];
    }

    if (!version || version.isDeleteMarker) {
      throw new S3ObjectError('NoSuchKey', `キー "${key}" は削除されています`, 404);
    }

    return {
      data: version.data,
      metadata: version.metadata,
      versionId: version.versionId,
    };
  }

  /** オブジェクトのメタデータのみ取得する（HeadObject） */
  headObject(bucket: string, key: string, versionId?: string): { metadata: ObjectMetadata; versionId: string } {
    const result = this.getObject(bucket, key, versionId);
    return { metadata: result.metadata, versionId: result.versionId };
  }

  /** オブジェクトを削除する */
  deleteObject(bucket: string, key: string, versionId?: string): { deleteMarker: boolean; versionId: string } {
    const sk = this.storageKey(bucket, key);
    const obj = this.objects.get(sk);
    if (!obj) {
      // S3は存在しないキーの削除でもエラーにならない
      return { deleteMarker: false, versionId: 'null' };
    }

    const versioningStatus = this.getVersioning(bucket);

    if (versionId) {
      // 特定バージョンを削除
      obj.versions = obj.versions.filter((v) => v.versionId !== versionId);
      if (obj.versions.length === 0) {
        this.objects.delete(sk);
      }
      return { deleteMarker: false, versionId };
    }

    if (versioningStatus === 'Enabled') {
      // 削除マーカーを追加
      const markerId = this.generateVersionId();
      const marker: ObjectVersion = {
        versionId: markerId,
        data: new Uint8Array(0),
        metadata: {
          contentType: '',
          etag: '',
          lastModified: new Date(),
          contentLength: 0,
          customMetadata: {},
        },
        isDeleteMarker: true,
        createdAt: new Date(),
      };
      obj.versions.unshift(marker);
      return { deleteMarker: true, versionId: markerId };
    }

    // バージョニング無効: 実際に削除
    this.objects.delete(sk);
    return { deleteMarker: false, versionId: 'null' };
  }

  /** オブジェクトをコピーする */
  copyObject(
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string,
  ): { etag: string; versionId: string } {
    const src = this.getObject(srcBucket, srcKey);
    return this.putObject({
      bucket: destBucket,
      key: destKey,
      data: src.data,
      contentType: src.metadata.contentType,
      customMetadata: { ...src.metadata.customMetadata },
    });
  }

  /** オブジェクト一覧を取得する（ListObjectsV2） */
  listObjectsV2(params: ListObjectsV2Params): ListObjectsV2Result {
    const prefix = params.prefix ?? '';
    const delimiter = params.delimiter;
    const maxKeys = params.maxKeys ?? 1000;

    // 指定バケットの全オブジェクトキーを収集
    const allKeys: Array<{ key: string; obj: StoredObject }> = [];
    for (const obj of this.objects.values()) {
      if (obj.bucket !== params.bucket) continue;
      // 最新バージョンが削除マーカーならスキップ
      const latest = obj.versions[0];
      if (!latest || latest.isDeleteMarker) continue;
      if (obj.key.startsWith(prefix)) {
        allKeys.push({ key: obj.key, obj });
      }
    }

    // キーでソート
    allKeys.sort((a, b) => a.key.localeCompare(b.key));

    // 継続トークンの処理
    let startIndex = 0;
    if (params.continuationToken) {
      const tokenKey = atob(params.continuationToken);
      startIndex = allKeys.findIndex((item) => item.key >= tokenKey);
      if (startIndex < 0) startIndex = allKeys.length;
    }

    const contents: ListObjectsV2Result['contents'] = [];
    const commonPrefixSet = new Set<string>();

    let processed = 0;
    for (let i = startIndex; i < allKeys.length && processed < maxKeys; i++) {
      const item = allKeys[i];
      if (!item) continue;

      if (delimiter) {
        // デリミタ以降のプレフィックスをチェック
        const afterPrefix = item.key.slice(prefix.length);
        const delimIdx = afterPrefix.indexOf(delimiter);
        if (delimIdx >= 0) {
          // 共通プレフィックスとして追加
          const cp = prefix + afterPrefix.slice(0, delimIdx + delimiter.length);
          commonPrefixSet.add(cp);
          processed++;
          continue;
        }
      }

      const latest = item.obj.versions[0];
      if (latest) {
        contents.push({
          key: item.key,
          lastModified: latest.metadata.lastModified,
          etag: latest.metadata.etag,
          size: latest.metadata.contentLength,
        });
      }
      processed++;
    }

    const isTruncated = startIndex + processed < allKeys.length;
    let nextContinuationToken: string | undefined;
    if (isTruncated) {
      const nextItem = allKeys[startIndex + processed];
      if (nextItem) {
        nextContinuationToken = btoa(nextItem.key);
      }
    }

    return {
      contents,
      commonPrefixes: Array.from(commonPrefixSet).sort(),
      isTruncated,
      nextContinuationToken,
      keyCount: contents.length + commonPrefixSet.size,
    };
  }

  /** バージョン一覧を取得する */
  listVersions(bucket: string, key: string): ObjectVersion[] {
    const sk = this.storageKey(bucket, key);
    const obj = this.objects.get(sk);
    if (!obj) return [];
    return [...obj.versions];
  }

  /** オブジェクトのACLを設定する */
  setObjectACL(bucket: string, key: string, acl: 'private' | 'public-read' | 'authenticated-read'): void {
    const sk = this.storageKey(bucket, key);
    const obj = this.objects.get(sk);
    if (!obj) {
      throw new S3ObjectError('NoSuchKey', `キー "${key}" は存在しません`, 404);
    }
    obj.acl = acl;
  }

  /** オブジェクトのACLを取得する */
  getObjectACL(bucket: string, key: string): 'private' | 'public-read' | 'authenticated-read' {
    const sk = this.storageKey(bucket, key);
    const obj = this.objects.get(sk);
    if (!obj) {
      throw new S3ObjectError('NoSuchKey', `キー "${key}" は存在しません`, 404);
    }
    return obj.acl;
  }

  /** バケット内の全オブジェクトを削除する */
  deleteAllInBucket(bucket: string): void {
    for (const [key, obj] of this.objects.entries()) {
      if (obj.bucket === bucket) {
        this.objects.delete(key);
      }
    }
  }
}

/** S3オブジェクトエラー */
export class S3ObjectError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'S3ObjectError';
  }
}
