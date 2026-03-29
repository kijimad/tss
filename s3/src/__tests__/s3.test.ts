/**
 * S3シミュレーターのテストスイート
 * バケット管理、オブジェクト操作、REST API、署名、マルチパートアップロードを検証
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BucketManager, S3BucketError } from '../storage/bucket.js';
import { ObjectStore, S3ObjectError } from '../storage/object.js';
import { S3RestApi, parsePath } from '../api/rest.js';
import {
  toAWSDateString,
  toAWSDateOnly,
  awsUriEncode,
  createCanonicalRequest,
  createStringToSign,
  deriveSigningKey,
  signRequest,
  generatePresignedUrl,
} from '../api/auth.js';
import { MultipartUploadManager, MultipartError } from '../api/multipart.js';

// ===== バケット管理テスト =====
describe('BucketManager', () => {
  let manager: BucketManager;

  beforeEach(() => {
    manager = new BucketManager();
  });

  it('バケットを作成できる', () => {
    const bucket = manager.createBucket('my-bucket');
    expect(bucket.name).toBe('my-bucket');
    expect(bucket.region).toBe('us-east-1');
    expect(bucket.acl).toBe('private');
    expect(bucket.versioning).toBe('Disabled');
  });

  it('バケット一覧を取得できる', () => {
    manager.createBucket('bucket-a');
    manager.createBucket('bucket-b');
    const buckets = manager.listBuckets();
    expect(buckets).toHaveLength(2);
  });

  it('バケットを削除できる', () => {
    manager.createBucket('to-delete');
    manager.deleteBucket('to-delete');
    expect(manager.listBuckets()).toHaveLength(0);
  });

  it('重複バケット名でエラーになる', () => {
    manager.createBucket('duplicate');
    expect(() => manager.createBucket('duplicate')).toThrow(S3BucketError);
    try {
      manager.createBucket('duplicate');
    } catch (e) {
      expect(e).toBeInstanceOf(S3BucketError);
      expect((e as S3BucketError).code).toBe('BucketAlreadyExists');
      expect((e as S3BucketError).statusCode).toBe(409);
    }
  });

  it('存在しないバケットの削除でエラーになる', () => {
    expect(() => manager.deleteBucket('nonexistent')).toThrow(S3BucketError);
  });

  it('無効なバケット名でエラーになる', () => {
    expect(() => manager.createBucket('ab')).toThrow(S3BucketError); // 短すぎ
    expect(() => manager.createBucket('AB-bucket')).toThrow(S3BucketError); // 大文字
  });

  it('バージョニングを設定できる', () => {
    manager.createBucket('versioned');
    manager.setVersioning('versioned', 'Enabled');
    expect(manager.getVersioning('versioned')).toBe('Enabled');
  });

  it('ACLを設定できる', () => {
    manager.createBucket('acl-test');
    manager.setACL('acl-test', 'public-read');
    expect(manager.getACL('acl-test')).toBe('public-read');
  });

  it('バケットの存在確認ができる', () => {
    manager.createBucket('exists');
    expect(manager.hasBucket('exists')).toBe(true);
    expect(manager.hasBucket('not-exists')).toBe(false);
  });

  it('リージョンとACLを指定して作成できる', () => {
    const bucket = manager.createBucket('regional', 'ap-northeast-1', 'public-read');
    expect(bucket.region).toBe('ap-northeast-1');
    expect(bucket.acl).toBe('public-read');
  });
});

// ===== オブジェクトストアテスト =====
describe('ObjectStore', () => {
  let store: ObjectStore;
  let bucketManager: BucketManager;

  beforeEach(() => {
    bucketManager = new BucketManager();
    bucketManager.createBucket('test-bucket');
    store = new ObjectStore((bucket) => bucketManager.getVersioning(bucket));
  });

  it('オブジェクトを保存・取得できる', () => {
    const data = new TextEncoder().encode('hello world');
    store.putObject({ bucket: 'test-bucket', key: 'test.txt', data, contentType: 'text/plain' });
    const result = store.getObject('test-bucket', 'test.txt');
    expect(new TextDecoder().decode(result.data)).toBe('hello world');
    expect(result.metadata.contentType).toBe('text/plain');
    expect(result.metadata.contentLength).toBe(11);
  });

  it('オブジェクトを削除できる', () => {
    const data = new TextEncoder().encode('to be deleted');
    store.putObject({ bucket: 'test-bucket', key: 'delete-me.txt', data });
    store.deleteObject('test-bucket', 'delete-me.txt');
    expect(() => store.getObject('test-bucket', 'delete-me.txt')).toThrow(S3ObjectError);
  });

  it('存在しないキーでNoSuchKeyエラーになる', () => {
    try {
      store.getObject('test-bucket', 'nonexistent');
    } catch (e) {
      expect(e).toBeInstanceOf(S3ObjectError);
      expect((e as S3ObjectError).code).toBe('NoSuchKey');
      expect((e as S3ObjectError).statusCode).toBe(404);
    }
  });

  it('HeadObjectでメタデータを取得できる', () => {
    const data = new TextEncoder().encode('head test');
    store.putObject({ bucket: 'test-bucket', key: 'head.txt', data, contentType: 'text/plain' });
    const result = store.headObject('test-bucket', 'head.txt');
    expect(result.metadata.contentType).toBe('text/plain');
    expect(result.metadata.contentLength).toBe(9);
    expect(result.metadata.etag).toBeTruthy();
  });

  it('オブジェクトをコピーできる', () => {
    const data = new TextEncoder().encode('copy source');
    store.putObject({ bucket: 'test-bucket', key: 'source.txt', data, contentType: 'text/plain' });
    store.copyObject('test-bucket', 'source.txt', 'test-bucket', 'dest.txt');
    const result = store.getObject('test-bucket', 'dest.txt');
    expect(new TextDecoder().decode(result.data)).toBe('copy source');
  });

  it('カスタムメタデータを保存できる', () => {
    const data = new TextEncoder().encode('meta test');
    store.putObject({
      bucket: 'test-bucket',
      key: 'meta.txt',
      data,
      customMetadata: { 'x-amz-meta-author': 'test-user' },
    });
    const result = store.getObject('test-bucket', 'meta.txt');
    expect(result.metadata.customMetadata['x-amz-meta-author']).toBe('test-user');
  });

  it('バージョニング有効時にバージョンIDが発行される', () => {
    bucketManager.setVersioning('test-bucket', 'Enabled');
    const data1 = new TextEncoder().encode('v1');
    const data2 = new TextEncoder().encode('v2');
    const r1 = store.putObject({ bucket: 'test-bucket', key: 'versioned.txt', data: data1 });
    const r2 = store.putObject({ bucket: 'test-bucket', key: 'versioned.txt', data: data2 });

    expect(r1.versionId).not.toBe('null');
    expect(r2.versionId).not.toBe('null');
    expect(r1.versionId).not.toBe(r2.versionId);

    // 最新バージョンを取得
    const latest = store.getObject('test-bucket', 'versioned.txt');
    expect(new TextDecoder().decode(latest.data)).toBe('v2');

    // 旧バージョンを取得
    const old = store.getObject('test-bucket', 'versioned.txt', r1.versionId);
    expect(new TextDecoder().decode(old.data)).toBe('v1');
  });

  it('バージョニング有効時に削除マーカーが作成される', () => {
    bucketManager.setVersioning('test-bucket', 'Enabled');
    const data = new TextEncoder().encode('will be deleted');
    const putResult = store.putObject({ bucket: 'test-bucket', key: 'del-ver.txt', data });
    const delResult = store.deleteObject('test-bucket', 'del-ver.txt');

    expect(delResult.deleteMarker).toBe(true);

    // 最新は削除マーカーなのでNoSuchKeyになる
    expect(() => store.getObject('test-bucket', 'del-ver.txt')).toThrow(S3ObjectError);

    // 旧バージョンは取得可能
    const old = store.getObject('test-bucket', 'del-ver.txt', putResult.versionId);
    expect(new TextDecoder().decode(old.data)).toBe('will be deleted');
  });

  it('バージョン一覧を取得できる', () => {
    bucketManager.setVersioning('test-bucket', 'Enabled');
    store.putObject({ bucket: 'test-bucket', key: 'ver-list.txt', data: new TextEncoder().encode('v1') });
    store.putObject({ bucket: 'test-bucket', key: 'ver-list.txt', data: new TextEncoder().encode('v2') });
    const versions = store.listVersions('test-bucket', 'ver-list.txt');
    expect(versions).toHaveLength(2);
  });

  it('ListObjectsV2で一覧取得できる', () => {
    store.putObject({ bucket: 'test-bucket', key: 'a.txt', data: new TextEncoder().encode('a') });
    store.putObject({ bucket: 'test-bucket', key: 'b.txt', data: new TextEncoder().encode('b') });
    store.putObject({ bucket: 'test-bucket', key: 'dir/c.txt', data: new TextEncoder().encode('c') });

    const result = store.listObjectsV2({ bucket: 'test-bucket' });
    expect(result.contents).toHaveLength(3);
  });

  it('ListObjectsV2でプレフィックスフィルタリングができる', () => {
    store.putObject({ bucket: 'test-bucket', key: 'logs/2024/01.txt', data: new TextEncoder().encode('jan') });
    store.putObject({ bucket: 'test-bucket', key: 'logs/2024/02.txt', data: new TextEncoder().encode('feb') });
    store.putObject({ bucket: 'test-bucket', key: 'data/file.txt', data: new TextEncoder().encode('data') });

    const result = store.listObjectsV2({ bucket: 'test-bucket', prefix: 'logs/' });
    expect(result.contents).toHaveLength(2);
  });

  it('ListObjectsV2でデリミタによるフォルダ表示ができる', () => {
    store.putObject({ bucket: 'test-bucket', key: 'photos/2024/a.jpg', data: new TextEncoder().encode('a') });
    store.putObject({ bucket: 'test-bucket', key: 'photos/2024/b.jpg', data: new TextEncoder().encode('b') });
    store.putObject({ bucket: 'test-bucket', key: 'photos/2025/c.jpg', data: new TextEncoder().encode('c') });
    store.putObject({ bucket: 'test-bucket', key: 'photos/top.jpg', data: new TextEncoder().encode('top') });

    const result = store.listObjectsV2({
      bucket: 'test-bucket',
      prefix: 'photos/',
      delimiter: '/',
    });
    // フォルダ: photos/2024/, photos/2025/
    expect(result.commonPrefixes).toContain('photos/2024/');
    expect(result.commonPrefixes).toContain('photos/2025/');
    // ファイル: photos/top.jpg
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.key).toBe('photos/top.jpg');
  });

  it('ListObjectsV2でmaxKeysによるページネーションができる', () => {
    for (let i = 0; i < 5; i++) {
      store.putObject({ bucket: 'test-bucket', key: `file-${i}.txt`, data: new TextEncoder().encode(`data-${i}`) });
    }

    const page1 = store.listObjectsV2({ bucket: 'test-bucket', maxKeys: 2 });
    expect(page1.contents).toHaveLength(2);
    expect(page1.isTruncated).toBe(true);
    expect(page1.nextContinuationToken).toBeTruthy();

    const page2 = store.listObjectsV2({
      bucket: 'test-bucket',
      maxKeys: 2,
      continuationToken: page1.nextContinuationToken,
    });
    expect(page2.contents).toHaveLength(2);
  });

  it('オブジェクトACLを設定・取得できる', () => {
    store.putObject({ bucket: 'test-bucket', key: 'acl.txt', data: new TextEncoder().encode('acl') });
    store.setObjectACL('test-bucket', 'acl.txt', 'public-read');
    expect(store.getObjectACL('test-bucket', 'acl.txt')).toBe('public-read');
  });

  it('バケット内の全オブジェクトを削除できる', () => {
    store.putObject({ bucket: 'test-bucket', key: 'a.txt', data: new TextEncoder().encode('a') });
    store.putObject({ bucket: 'test-bucket', key: 'b.txt', data: new TextEncoder().encode('b') });
    store.deleteAllInBucket('test-bucket');
    const result = store.listObjectsV2({ bucket: 'test-bucket' });
    expect(result.contents).toHaveLength(0);
  });

  it('存在しないオブジェクトの削除はエラーにならない', () => {
    const result = store.deleteObject('test-bucket', 'ghost.txt');
    expect(result.deleteMarker).toBe(false);
  });
});

// ===== REST APIテスト =====
describe('S3RestApi', () => {
  let api: S3RestApi;

  beforeEach(() => {
    api = new S3RestApi();
  });

  it('バケットを作成しリストできる', () => {
    const createRes = api.handleRequest({
      method: 'PUT',
      path: '/my-bucket',
      headers: {},
      query: {},
    });
    expect(createRes.statusCode).toBe(200);

    const listRes = api.handleRequest({
      method: 'GET',
      path: '/',
      headers: {},
      query: {},
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body).toContain('my-bucket');
    expect(listRes.body).toContain('ListAllMyBucketsResult');
  });

  it('重複バケット作成で409エラーを返す', () => {
    api.handleRequest({ method: 'PUT', path: '/dup-bucket', headers: {}, query: {} });
    const res = api.handleRequest({ method: 'PUT', path: '/dup-bucket', headers: {}, query: {} });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('BucketAlreadyExists');
  });

  it('バケットを削除できる', () => {
    api.handleRequest({ method: 'PUT', path: '/del-bucket', headers: {}, query: {} });
    const res = api.handleRequest({ method: 'DELETE', path: '/del-bucket', headers: {}, query: {} });
    expect(res.statusCode).toBe(204);
  });

  it('オブジェクトをPUT/GET/DELETEできる', () => {
    api.handleRequest({ method: 'PUT', path: '/obj-bucket', headers: {}, query: {} });

    const putRes = api.handleRequest({
      method: 'PUT',
      path: '/obj-bucket/hello.txt',
      headers: { 'content-type': 'text/plain' },
      query: {},
      body: new TextEncoder().encode('Hello, S3!'),
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.headers['ETag']).toBeTruthy();

    const getRes = api.handleRequest({
      method: 'GET',
      path: '/obj-bucket/hello.txt',
      headers: {},
      query: {},
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toBe('Hello, S3!');
    expect(getRes.headers['Content-Type']).toBe('text/plain');

    const delRes = api.handleRequest({
      method: 'DELETE',
      path: '/obj-bucket/hello.txt',
      headers: {},
      query: {},
    });
    expect(delRes.statusCode).toBe(204);

    // 削除後は404
    const getRes2 = api.handleRequest({
      method: 'GET',
      path: '/obj-bucket/hello.txt',
      headers: {},
      query: {},
    });
    expect(getRes2.statusCode).toBe(404);
    expect(getRes2.body).toContain('NoSuchKey');
  });

  it('HeadObjectでメタデータを取得できる', () => {
    api.handleRequest({ method: 'PUT', path: '/head-bucket', headers: {}, query: {} });
    api.handleRequest({
      method: 'PUT',
      path: '/head-bucket/file.txt',
      headers: { 'content-type': 'text/plain' },
      query: {},
      body: new TextEncoder().encode('head test'),
    });

    const res = api.handleRequest({
      method: 'HEAD',
      path: '/head-bucket/file.txt',
      headers: {},
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/plain');
    expect(res.headers['Content-Length']).toBe('9');
    expect(res.body).toBe('');
  });

  it('ListObjectsV2でXMLレスポンスを返す', () => {
    api.handleRequest({ method: 'PUT', path: '/list-bucket', headers: {}, query: {} });
    api.handleRequest({
      method: 'PUT',
      path: '/list-bucket/file1.txt',
      headers: {},
      query: {},
      body: new TextEncoder().encode('data1'),
    });
    api.handleRequest({
      method: 'PUT',
      path: '/list-bucket/file2.txt',
      headers: {},
      query: {},
      body: new TextEncoder().encode('data2'),
    });

    const res = api.handleRequest({
      method: 'GET',
      path: '/list-bucket',
      headers: {},
      query: { 'list-type': '2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ListBucketResult');
    expect(res.body).toContain('file1.txt');
    expect(res.body).toContain('file2.txt');
  });

  it('存在しないバケットへの操作で404エラーを返す', () => {
    const res = api.handleRequest({
      method: 'GET',
      path: '/nonexistent-bucket',
      headers: {},
      query: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('NoSuchBucket');
  });

  it('CopyObjectが動作する', () => {
    api.handleRequest({ method: 'PUT', path: '/copy-bucket', headers: {}, query: {} });
    api.handleRequest({
      method: 'PUT',
      path: '/copy-bucket/source.txt',
      headers: { 'content-type': 'text/plain' },
      query: {},
      body: new TextEncoder().encode('copy me'),
    });

    const copyRes = api.handleRequest({
      method: 'PUT',
      path: '/copy-bucket/dest.txt',
      headers: { 'x-amz-copy-source': '/copy-bucket/source.txt' },
      query: {},
    });
    expect(copyRes.statusCode).toBe(200);
    expect(copyRes.body).toContain('CopyObjectResult');

    const getRes = api.handleRequest({
      method: 'GET',
      path: '/copy-bucket/dest.txt',
      headers: {},
      query: {},
    });
    expect(getRes.body).toBe('copy me');
  });

  it('カスタムメタデータを保存できる', () => {
    api.handleRequest({ method: 'PUT', path: '/meta-bucket', headers: {}, query: {} });
    api.handleRequest({
      method: 'PUT',
      path: '/meta-bucket/meta.txt',
      headers: {
        'content-type': 'text/plain',
        'x-amz-meta-author': 'tester',
      },
      query: {},
      body: new TextEncoder().encode('metadata'),
    });

    // HeadObjectでメタデータ確認（内部APIで確認）
    const obj = api.objectStore.getObject('meta-bucket', 'meta.txt');
    expect(obj.metadata.customMetadata['x-amz-meta-author']).toBe('tester');
  });
});

// ===== パスパーサーテスト =====
describe('parsePath', () => {
  it('ルートパスを解析できる', () => {
    expect(parsePath('/')).toEqual({});
  });

  it('バケットのみのパスを解析できる', () => {
    expect(parsePath('/my-bucket')).toEqual({ bucket: 'my-bucket' });
  });

  it('バケットとキーのパスを解析できる', () => {
    expect(parsePath('/my-bucket/path/to/file.txt')).toEqual({
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
    });
  });

  it('末尾スラッシュのバケットパスを解析できる', () => {
    const result = parsePath('/my-bucket/');
    expect(result.bucket).toBe('my-bucket');
    // 空文字キーはundefined
    expect(result.key).toBeUndefined();
  });
});

// ===== 認証・署名テスト =====
describe('Auth (Signature V4)', () => {
  it('AWS日付形式に変換できる', () => {
    const date = new Date('2024-01-15T12:30:45.000Z');
    expect(toAWSDateString(date)).toBe('20240115T123045Z');
    expect(toAWSDateOnly(date)).toBe('20240115');
  });

  it('URIエンコードが正しく動作する', () => {
    expect(awsUriEncode('hello world')).toBe('hello%20world');
    expect(awsUriEncode('path/to/file', false)).toBe('path/to/file');
    expect(awsUriEncode('path/to/file', true)).toBe('path%2Fto%2Ffile');
    expect(awsUriEncode('a+b=c')).toBe('a%2Bb%3Dc');
  });

  it('正規リクエストを生成できる', () => {
    const result = createCanonicalRequest(
      'GET',
      '/test-bucket/test-key',
      '',
      { Host: 'test-bucket.s3.amazonaws.com', 'x-amz-date': '20240115T120000Z' },
      'UNSIGNED-PAYLOAD',
    );
    expect(result).toContain('GET');
    expect(result).toContain('host');
    expect(result).toContain('x-amz-date');
  });

  it('署名文字列を生成できる', () => {
    const result = createStringToSign(
      '20240115T120000Z',
      '20240115/us-east-1/s3/aws4_request',
      'abcdef1234567890',
    );
    expect(result).toContain('AWS4-HMAC-SHA256');
    expect(result).toContain('20240115T120000Z');
    expect(result).toContain('20240115/us-east-1/s3/aws4_request');
  });

  it('署名キーを導出できる', async () => {
    const key = await deriveSigningKey('secretkey', '20240115', 'us-east-1', 's3');
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('リクエストに署名できる', async () => {
    const signature = await signRequest(
      'GET',
      '/test-bucket/test-key',
      '',
      { Host: 'test-bucket.s3.amazonaws.com' },
      '',
      {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 's3',
      },
      new Date('2024-01-15T12:00:00Z'),
    );
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
  });

  it('署名付きURLを生成できる', () => {
    const result = generatePresignedUrl({
      method: 'GET',
      bucket: 'my-bucket',
      key: 'my-file.txt',
      expiresIn: 3600,
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 's3',
      },
    });
    expect(result.url).toContain('my-bucket.s3.us-east-1.amazonaws.com');
    expect(result.url).toContain('my-file.txt');
    expect(result.url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(result.url).toContain('X-Amz-Expires=3600');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ===== マルチパートアップロードテスト =====
describe('MultipartUploadManager', () => {
  let manager: MultipartUploadManager;

  beforeEach(() => {
    manager = new MultipartUploadManager();
  });

  it('マルチパートアップロードを開始できる', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'large-file.bin');
    expect(uploadId).toBeTruthy();
    expect(uploadId.startsWith('upload-')).toBe(true);
  });

  it('パートをアップロードできる', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'multi.bin');
    const data = new TextEncoder().encode('part1data');
    const etag = manager.uploadPart(uploadId, 1, data);
    expect(etag).toBeTruthy();
  });

  it('完全なマルチパートアップロードフローが動作する', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'complete.bin', 'application/octet-stream');

    const part1Data = new TextEncoder().encode('Hello, ');
    const part2Data = new TextEncoder().encode('World!');

    const etag1 = manager.uploadPart(uploadId, 1, part1Data);
    const etag2 = manager.uploadPart(uploadId, 2, part2Data);

    const result = manager.completeMultipartUpload(uploadId, [
      { partNumber: 1, etag: etag1 },
      { partNumber: 2, etag: etag2 },
    ]);

    expect(new TextDecoder().decode(result.data)).toBe('Hello, World!');
    expect(result.etag).toContain('-2'); // パート数のサフィックス
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('アップロードを中止できる', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'abort.bin');
    manager.uploadPart(uploadId, 1, new TextEncoder().encode('data'));
    manager.abortMultipartUpload(uploadId);

    // 中止後のパートアップロードはエラー
    expect(() => manager.uploadPart(uploadId, 2, new TextEncoder().encode('more'))).toThrow(MultipartError);
  });

  it('存在しないアップロードIDでエラーになる', () => {
    expect(() => manager.uploadPart('fake-id', 1, new Uint8Array(0))).toThrow(MultipartError);
  });

  it('無効なパート番号でエラーになる', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'invalid.bin');
    expect(() => manager.uploadPart(uploadId, 0, new Uint8Array(0))).toThrow(MultipartError);
    expect(() => manager.uploadPart(uploadId, 10001, new Uint8Array(0))).toThrow(MultipartError);
  });

  it('ETag不一致で完了エラーになる', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'mismatch.bin');
    manager.uploadPart(uploadId, 1, new TextEncoder().encode('data'));

    expect(() =>
      manager.completeMultipartUpload(uploadId, [{ partNumber: 1, etag: '"wrong-etag"' }]),
    ).toThrow(MultipartError);
  });

  it('パート一覧を取得できる', () => {
    const uploadId = manager.createMultipartUpload('test-bucket', 'list-parts.bin');
    manager.uploadPart(uploadId, 2, new TextEncoder().encode('part2'));
    manager.uploadPart(uploadId, 1, new TextEncoder().encode('part1'));

    const parts = manager.listParts(uploadId);
    expect(parts).toHaveLength(2);
    // パート番号順にソート
    expect(parts[0]?.partNumber).toBe(1);
    expect(parts[1]?.partNumber).toBe(2);
  });

  it('進行中のアップロード一覧を取得できる', () => {
    manager.createMultipartUpload('bucket-a', 'file1.bin');
    manager.createMultipartUpload('bucket-a', 'file2.bin');
    manager.createMultipartUpload('bucket-b', 'file3.bin');

    const uploadsA = manager.listMultipartUploads('bucket-a');
    expect(uploadsA).toHaveLength(2);

    const uploadsB = manager.listMultipartUploads('bucket-b');
    expect(uploadsB).toHaveLength(1);
  });
});

// ===== REST APIマルチパートテスト =====
describe('S3RestApi - マルチパートアップロード', () => {
  let api: S3RestApi;

  beforeEach(() => {
    api = new S3RestApi();
    api.handleRequest({ method: 'PUT', path: '/mp-bucket', headers: {}, query: {} });
  });

  it('REST APIでマルチパートアップロードフローが動作する', () => {
    // 開始
    const initRes = api.handleRequest({
      method: 'POST',
      path: '/mp-bucket/large-file.bin',
      headers: { 'content-type': 'application/octet-stream' },
      query: { uploads: '' },
    });
    expect(initRes.statusCode).toBe(200);
    expect(initRes.body).toContain('InitiateMultipartUploadResult');

    // UploadIdを抽出
    const uploadIdMatch = initRes.body.match(/<UploadId>([^<]+)<\/UploadId>/);
    expect(uploadIdMatch).toBeTruthy();
    const uploadId = uploadIdMatch![1]!;

    // パート1アップロード
    const part1Res = api.handleRequest({
      method: 'PUT',
      path: '/mp-bucket/large-file.bin',
      headers: {},
      query: { uploadId, partNumber: '1' },
      body: new TextEncoder().encode('Part 1 '),
    });
    expect(part1Res.statusCode).toBe(200);
    const etag1 = part1Res.headers['ETag']!;

    // パート2アップロード
    const part2Res = api.handleRequest({
      method: 'PUT',
      path: '/mp-bucket/large-file.bin',
      headers: {},
      query: { uploadId, partNumber: '2' },
      body: new TextEncoder().encode('Part 2'),
    });
    expect(part2Res.statusCode).toBe(200);
    const etag2 = part2Res.headers['ETag']!;

    // 完了
    const completeBody = `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${etag1}</ETag></Part><Part><PartNumber>2</PartNumber><ETag>${etag2}</ETag></Part></CompleteMultipartUpload>`;
    const completeRes = api.handleRequest({
      method: 'POST',
      path: '/mp-bucket/large-file.bin',
      headers: {},
      query: { uploadId },
      body: new TextEncoder().encode(completeBody),
    });
    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.body).toContain('CompleteMultipartUploadResult');

    // 結合されたオブジェクトを取得
    const getRes = api.handleRequest({
      method: 'GET',
      path: '/mp-bucket/large-file.bin',
      headers: {},
      query: {},
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toBe('Part 1 Part 2');
  });

  it('マルチパートアップロードを中止できる', () => {
    // 開始
    const initRes = api.handleRequest({
      method: 'POST',
      path: '/mp-bucket/abort-file.bin',
      headers: {},
      query: { uploads: '' },
    });
    const uploadId = initRes.body.match(/<UploadId>([^<]+)<\/UploadId>/)![1]!;

    // 中止
    const abortRes = api.handleRequest({
      method: 'DELETE',
      path: '/mp-bucket/abort-file.bin',
      headers: {},
      query: { uploadId },
    });
    expect(abortRes.statusCode).toBe(204);
  });

  it('マルチパートアップロード一覧を取得できる', () => {
    // 開始
    api.handleRequest({
      method: 'POST',
      path: '/mp-bucket/file1.bin',
      headers: {},
      query: { uploads: '' },
    });

    const listRes = api.handleRequest({
      method: 'GET',
      path: '/mp-bucket',
      headers: {},
      query: { uploads: '' },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body).toContain('ListMultipartUploadsResult');
    expect(listRes.body).toContain('file1.bin');
  });
});
