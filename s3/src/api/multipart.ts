/**
 * マルチパートアップロードモジュール
 * S3のマルチパートアップロードフロー（開始→パートアップロード→完了/中止）をシミュレーション
 */

/** マルチパートアップロードの状態 */
export type MultipartUploadStatus = 'InProgress' | 'Completed' | 'Aborted';

/** アップロードパート */
export interface UploadPart {
  /** パート番号（1〜10000） */
  partNumber: number;
  /** パートデータ */
  data: Uint8Array;
  /** ETag */
  etag: string;
  /** アップロード日時 */
  uploadedAt: Date;
}

/** マルチパートアップロードの情報 */
export interface MultipartUpload {
  /** アップロードID */
  uploadId: string;
  /** バケット名 */
  bucket: string;
  /** オブジェクトキー */
  key: string;
  /** ステータス */
  status: MultipartUploadStatus;
  /** アップロード済みパート */
  parts: Map<number, UploadPart>;
  /** 開始日時 */
  initiatedAt: Date;
  /** コンテンツタイプ */
  contentType: string;
}

/** CompleteMultipartUploadのパート指定 */
export interface CompletePart {
  partNumber: number;
  etag: string;
}

/** マルチパートアップロード管理 */
export class MultipartUploadManager {
  /** 進行中のアップロード */
  private uploads: Map<string, MultipartUpload> = new Map();
  /** IDカウンタ */
  private idCounter = 0;

  /** 簡易ETag生成 */
  private computeETag(data: Uint8Array): string {
    let hash = 0x811c9dc5;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
    return `"${(hash >>> 0).toString(16).padStart(8, '0')}"`;
  }

  /** マルチパートアップロードを開始する */
  createMultipartUpload(bucket: string, key: string, contentType = 'application/octet-stream'): string {
    this.idCounter++;
    const uploadId = `upload-${Date.now().toString(36)}-${this.idCounter.toString(36)}`;

    const upload: MultipartUpload = {
      uploadId,
      bucket,
      key,
      status: 'InProgress',
      parts: new Map(),
      initiatedAt: new Date(),
      contentType,
    };

    this.uploads.set(uploadId, upload);
    return uploadId;
  }

  /** パートをアップロードする */
  uploadPart(uploadId: string, partNumber: number, data: Uint8Array): string {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new MultipartError('NoSuchUpload', `アップロード "${uploadId}" は存在しません`);
    }
    if (upload.status !== 'InProgress') {
      throw new MultipartError('InvalidUploadState', `アップロードは既に ${upload.status} 状態です`);
    }
    if (partNumber < 1 || partNumber > 10000) {
      throw new MultipartError('InvalidPartNumber', 'パート番号は1〜10000の範囲で指定してください');
    }

    const etag = this.computeETag(data);
    const part: UploadPart = {
      partNumber,
      data,
      etag,
      uploadedAt: new Date(),
    };

    upload.parts.set(partNumber, part);
    return etag;
  }

  /** マルチパートアップロードを完了する */
  completeMultipartUpload(
    uploadId: string,
    parts: CompletePart[],
  ): { data: Uint8Array; etag: string; contentType: string } {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new MultipartError('NoSuchUpload', `アップロード "${uploadId}" は存在しません`);
    }
    if (upload.status !== 'InProgress') {
      throw new MultipartError('InvalidUploadState', `アップロードは既に ${upload.status} 状態です`);
    }

    // パート番号順にソート
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    // パートの検証と結合
    const chunks: Uint8Array[] = [];
    for (const cp of sortedParts) {
      const uploadedPart = upload.parts.get(cp.partNumber);
      if (!uploadedPart) {
        throw new MultipartError('InvalidPart', `パート ${cp.partNumber} はアップロードされていません`);
      }
      if (uploadedPart.etag !== cp.etag) {
        throw new MultipartError('InvalidPart', `パート ${cp.partNumber} のETagが一致しません`);
      }
      chunks.push(uploadedPart.data);
    }

    // 全パートを結合
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const etag = `${this.computeETag(combined)}-${sortedParts.length}`;
    upload.status = 'Completed';

    return { data: combined, etag, contentType: upload.contentType };
  }

  /** マルチパートアップロードを中止する */
  abortMultipartUpload(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new MultipartError('NoSuchUpload', `アップロード "${uploadId}" は存在しません`);
    }
    upload.status = 'Aborted';
    this.uploads.delete(uploadId);
  }

  /** 進行中のアップロード一覧を取得する */
  listMultipartUploads(bucket: string): MultipartUpload[] {
    const result: MultipartUpload[] = [];
    for (const upload of this.uploads.values()) {
      if (upload.bucket === bucket && upload.status === 'InProgress') {
        result.push(upload);
      }
    }
    return result;
  }

  /** アップロード済みパート一覧を取得する */
  listParts(uploadId: string): UploadPart[] {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new MultipartError('NoSuchUpload', `アップロード "${uploadId}" は存在しません`);
    }
    return Array.from(upload.parts.values()).sort((a, b) => a.partNumber - b.partNumber);
  }
}

/** マルチパートアップロードエラー */
export class MultipartError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MultipartError';
  }
}
