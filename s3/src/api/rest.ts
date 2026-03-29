/**
 * S3 REST APIシミュレーションモジュール
 * HTTPリクエストを解析し、S3操作を実行してXMLレスポンスを生成する
 */

import { BucketManager, S3BucketError } from '../storage/bucket.js';
import { ObjectStore, S3ObjectError } from '../storage/object.js';
import { MultipartUploadManager, MultipartError } from './multipart.js';

/** HTTPリクエストの表現 */
export interface S3Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: Uint8Array;
}

/** HTTPレスポンスの表現 */
export interface S3Response {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** REST APIハンドラー */
export class S3RestApi {
  readonly bucketManager: BucketManager;
  readonly objectStore: ObjectStore;
  readonly multipartManager: MultipartUploadManager;

  constructor() {
    this.bucketManager = new BucketManager();
    this.objectStore = new ObjectStore((bucket) => this.bucketManager.getVersioning(bucket));
    this.multipartManager = new MultipartUploadManager();
  }

  /** リクエストを処理する */
  handleRequest(req: S3Request): S3Response {
    try {
      return this.route(req);
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** リクエストをルーティングする */
  private route(req: S3Request): S3Response {
    const { bucket, key } = parsePath(req.path);

    // バケット操作（キーなし）
    if (!bucket) {
      // ルートパス: バケット一覧
      if (req.method === 'GET') {
        return this.listBuckets();
      }
      return errorResponse(405, 'MethodNotAllowed', 'メソッドが許可されていません');
    }

    if (!key) {
      // バケットレベルの操作
      switch (req.method) {
        case 'PUT':
          return this.createBucket(bucket);
        case 'DELETE':
          return this.deleteBucket(bucket);
        case 'GET': {
          // ListObjectsV2またはマルチパートアップロード一覧
          if (req.query['uploads'] !== undefined) {
            return this.listMultipartUploads(bucket);
          }
          return this.listObjects(bucket, req.query);
        }
        default:
          return errorResponse(405, 'MethodNotAllowed', 'メソッドが許可されていません');
      }
    }

    // マルチパートアップロード関連
    if (req.query['uploadId']) {
      return this.handleMultipart(req, bucket, key);
    }
    if (req.method === 'POST' && req.query['uploads'] !== undefined) {
      return this.initiateMultipartUpload(bucket, key, req.headers['content-type'] ?? 'application/octet-stream');
    }

    // オブジェクト操作
    switch (req.method) {
      case 'PUT':
        return this.putObject(bucket, key, req);
      case 'GET':
        return this.getObject(bucket, key, req.query['versionId']);
      case 'DELETE':
        return this.deleteObject(bucket, key, req.query['versionId']);
      case 'HEAD':
        return this.headObject(bucket, key, req.query['versionId']);
      default:
        return errorResponse(405, 'MethodNotAllowed', 'メソッドが許可されていません');
    }
  }

  /** バケット一覧を返す */
  private listBuckets(): S3Response {
    const buckets = this.bucketManager.listBuckets();
    const bucketXml = buckets
      .map(
        (b) =>
          `<Bucket><Name>${escapeXml(b.name)}</Name><CreationDate>${b.creationDate.toISOString()}</CreationDate></Bucket>`,
      )
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>${bucketXml}</Buckets></ListAllMyBucketsResult>`;
    return xmlResponse(200, xml);
  }

  /** バケットを作成する */
  private createBucket(name: string): S3Response {
    this.bucketManager.createBucket(name);
    return { statusCode: 200, headers: { 'Content-Type': 'application/xml' }, body: '' };
  }

  /** バケットを削除する */
  private deleteBucket(name: string): S3Response {
    this.bucketManager.deleteBucket(name);
    return { statusCode: 204, headers: {}, body: '' };
  }

  /** オブジェクト一覧を返す（ListObjectsV2） */
  private listObjects(bucket: string, query: Record<string, string>): S3Response {
    // バケットの存在確認
    this.bucketManager.getBucket(bucket);

    const result = this.objectStore.listObjectsV2({
      bucket,
      prefix: query['prefix'],
      delimiter: query['delimiter'],
      maxKeys: query['max-keys'] ? parseInt(query['max-keys'], 10) : undefined,
      continuationToken: query['continuation-token'],
    });

    const contentsXml = result.contents
      .map(
        (c) =>
          `<Contents><Key>${escapeXml(c.key)}</Key><LastModified>${c.lastModified.toISOString()}</LastModified><ETag>${escapeXml(c.etag)}</ETag><Size>${c.size}</Size></Contents>`,
      )
      .join('');

    const prefixesXml = result.commonPrefixes.map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`).join('');

    const truncatedTag = `<IsTruncated>${result.isTruncated}</IsTruncated>`;
    const tokenTag = result.nextContinuationToken
      ? `<NextContinuationToken>${escapeXml(result.nextContinuationToken)}</NextContinuationToken>`
      : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${escapeXml(bucket)}</Name><KeyCount>${result.keyCount}</KeyCount>${truncatedTag}${tokenTag}${contentsXml}${prefixesXml}</ListBucketResult>`;
    return xmlResponse(200, xml);
  }

  /** オブジェクトを保存する */
  private putObject(bucket: string, key: string, req: S3Request): S3Response {
    // バケットの存在確認
    this.bucketManager.getBucket(bucket);

    // カスタムメタデータの抽出
    const customMetadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase().startsWith('x-amz-meta-')) {
        customMetadata[k.toLowerCase()] = v;
      }
    }

    // CopySource対応
    const copySource = req.headers['x-amz-copy-source'];
    if (copySource) {
      const { bucket: srcBucket, key: srcKey } = parseCopySource(copySource);
      const result = this.objectStore.copyObject(srcBucket, srcKey, bucket, key);
      const xml = `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>${escapeXml(result.etag)}</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyObjectResult>`;
      return xmlResponse(200, xml);
    }

    const result = this.objectStore.putObject({
      bucket,
      key,
      data: req.body ?? new Uint8Array(0),
      contentType: req.headers['content-type'],
      customMetadata,
    });

    return {
      statusCode: 200,
      headers: {
        ETag: result.etag,
        'x-amz-version-id': result.versionId,
      },
      body: '',
    };
  }

  /** オブジェクトを取得する */
  private getObject(bucket: string, key: string, versionId?: string): S3Response {
    this.bucketManager.getBucket(bucket);
    const result = this.objectStore.getObject(bucket, key, versionId);
    const bodyStr = new TextDecoder().decode(result.data);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': result.metadata.contentType,
        ETag: result.metadata.etag,
        'Last-Modified': result.metadata.lastModified.toUTCString(),
        'Content-Length': result.metadata.contentLength.toString(),
        'x-amz-version-id': result.versionId,
      },
      body: bodyStr,
    };
  }

  /** オブジェクトを削除する */
  private deleteObject(bucket: string, key: string, versionId?: string): S3Response {
    this.bucketManager.getBucket(bucket);
    const result = this.objectStore.deleteObject(bucket, key, versionId);

    const headers: Record<string, string> = {};
    if (result.deleteMarker) {
      headers['x-amz-delete-marker'] = 'true';
    }
    headers['x-amz-version-id'] = result.versionId;

    return { statusCode: 204, headers, body: '' };
  }

  /** HeadObjectを処理する */
  private headObject(bucket: string, key: string, versionId?: string): S3Response {
    this.bucketManager.getBucket(bucket);
    const result = this.objectStore.headObject(bucket, key, versionId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': result.metadata.contentType,
        ETag: result.metadata.etag,
        'Last-Modified': result.metadata.lastModified.toUTCString(),
        'Content-Length': result.metadata.contentLength.toString(),
        'x-amz-version-id': result.versionId,
      },
      body: '',
    };
  }

  /** マルチパートアップロードを開始する */
  private initiateMultipartUpload(bucket: string, key: string, contentType: string): S3Response {
    this.bucketManager.getBucket(bucket);
    const uploadId = this.multipartManager.createMultipartUpload(bucket, key, contentType);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${escapeXml(uploadId)}</UploadId></InitiateMultipartUploadResult>`;
    return xmlResponse(200, xml);
  }

  /** マルチパートアップロード関連を処理する */
  private handleMultipart(req: S3Request, bucket: string, key: string): S3Response {
    const uploadId = req.query['uploadId'];
    if (!uploadId) {
      return errorResponse(400, 'InvalidRequest', 'uploadIdが必要です');
    }

    switch (req.method) {
      case 'PUT': {
        // パートアップロード
        const partNumber = parseInt(req.query['partNumber'] ?? '0', 10);
        const etag = this.multipartManager.uploadPart(uploadId, partNumber, req.body ?? new Uint8Array(0));
        return { statusCode: 200, headers: { ETag: etag }, body: '' };
      }
      case 'POST': {
        // 完了
        const parts = parseCompleteMultipartXml(new TextDecoder().decode(req.body));
        const result = this.multipartManager.completeMultipartUpload(uploadId, parts);
        // 結合データをオブジェクトストアに保存
        this.objectStore.putObject({
          bucket,
          key,
          data: result.data,
          contentType: result.contentType,
        });
        const xml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><ETag>${escapeXml(result.etag)}</ETag></CompleteMultipartUploadResult>`;
        return xmlResponse(200, xml);
      }
      case 'DELETE': {
        // 中止
        this.multipartManager.abortMultipartUpload(uploadId);
        return { statusCode: 204, headers: {}, body: '' };
      }
      case 'GET': {
        // パート一覧
        const partsList = this.multipartManager.listParts(uploadId);
        const partsXml = partsList
          .map(
            (p) =>
              `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag><Size>${p.data.length}</Size></Part>`,
          )
          .join('');
        const xml = `<?xml version="1.0" encoding="UTF-8"?><ListPartsResult>${partsXml}</ListPartsResult>`;
        return xmlResponse(200, xml);
      }
      default:
        return errorResponse(405, 'MethodNotAllowed', 'メソッドが許可されていません');
    }
  }

  /** マルチパートアップロード一覧を返す */
  private listMultipartUploads(bucket: string): S3Response {
    this.bucketManager.getBucket(bucket);
    const uploads = this.multipartManager.listMultipartUploads(bucket);
    const uploadsXml = uploads
      .map(
        (u) =>
          `<Upload><Key>${escapeXml(u.key)}</Key><UploadId>${escapeXml(u.uploadId)}</UploadId><Initiated>${u.initiatedAt.toISOString()}</Initiated></Upload>`,
      )
      .join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListMultipartUploadsResult><Bucket>${escapeXml(bucket)}</Bucket>${uploadsXml}</ListMultipartUploadsResult>`;
    return xmlResponse(200, xml);
  }

  /** エラーをレスポンスに変換する */
  private handleError(err: unknown): S3Response {
    if (err instanceof S3BucketError) {
      return errorResponse(err.statusCode, err.code, err.message);
    }
    if (err instanceof S3ObjectError) {
      return errorResponse(err.statusCode, err.code, err.message);
    }
    if (err instanceof MultipartError) {
      return errorResponse(400, err.code, err.message);
    }
    const message = err instanceof Error ? err.message : '不明なエラー';
    return errorResponse(500, 'InternalError', message);
  }
}

/** パスからバケット名とキーを抽出する */
export function parsePath(path: string): { bucket?: string; key?: string } {
  // パスの正規化
  const cleaned = path.replace(/^\/+/, '');
  if (!cleaned) return {};

  const slashIndex = cleaned.indexOf('/');
  if (slashIndex < 0) {
    return { bucket: cleaned };
  }

  const bucket = cleaned.slice(0, slashIndex);
  const key = cleaned.slice(slashIndex + 1);
  return { bucket, key: key || undefined };
}

/** CopySourceを解析する */
function parseCopySource(source: string): { bucket: string; key: string } {
  const cleaned = source.replace(/^\//, '');
  const slashIndex = cleaned.indexOf('/');
  if (slashIndex < 0) {
    return { bucket: cleaned, key: '' };
  }
  return {
    bucket: cleaned.slice(0, slashIndex),
    key: cleaned.slice(slashIndex + 1),
  };
}

/** CompleteMultipartUploadのXMLを解析する */
function parseCompleteMultipartXml(xml: string): Array<{ partNumber: number; etag: string }> {
  const parts: Array<{ partNumber: number; etag: string }> = [];
  const partRegex = /<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<ETag>([^<]+)<\/ETag>\s*<\/Part>/g;
  let match: RegExpExecArray | null;
  while ((match = partRegex.exec(xml)) !== null) {
    const partNum = match[1];
    const etag = match[2];
    if (partNum && etag) {
      parts.push({ partNumber: parseInt(partNum, 10), etag });
    }
  }
  return parts;
}

/** XMLレスポンスを生成する */
function xmlResponse(statusCode: number, body: string): S3Response {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/xml' },
    body,
  };
}

/** エラーレスポンスを生成する */
function errorResponse(statusCode: number, code: string, message: string): S3Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error>`;
  return {
    statusCode,
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  };
}

/** XML特殊文字をエスケープする */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
