/**
 * S3シミュレーターのブラウザUI
 * Node.jsシミュレーターと同じパターン: シナリオ選択 → textarea → Run → ログ出力
 */

import { S3RestApi } from '../api/rest.js';
import type { S3Request, S3Response } from '../api/rest.js';
import { generatePresignedUrl } from '../api/auth.js';
import type { AWSCredentials } from '../api/auth.js';

/** シナリオ定義 */
interface Scenario {
  name: string;
  description: string;
  run: (api: S3RestApi, log: (req: S3Request, res: S3Response) => void) => void;
}

/** テスト用の認証情報 */
const TEST_CREDENTIALS: AWSCredentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};

/** テキストをUint8Arrayに変換するヘルパー */
function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** シナリオ一覧 */
const SCENARIOS: Scenario[] = [
  {
    name: 'バケット作成 + オブジェクト保存',
    description: `CreateBucket でバケットを作成し、PutObject でオブジェクトを保存する。
基本的なS3操作のデモ。`,
    run(api, log) {
      // バケット作成
      const r1 = api.handleRequest({ method: 'PUT', path: '/my-bucket', headers: {}, query: {} });
      log({ method: 'PUT', path: '/my-bucket', headers: {}, query: {} }, r1);

      // オブジェクト保存
      const body = toBytes('Hello, S3!');
      const req2: S3Request = { method: 'PUT', path: '/my-bucket/hello.txt', headers: { 'content-type': 'text/plain' }, query: {}, body };
      const r2 = api.handleRequest(req2);
      log(req2, r2);

      // 確認: GetObject
      const req3: S3Request = { method: 'GET', path: '/my-bucket/hello.txt', headers: {}, query: {} };
      const r3 = api.handleRequest(req3);
      log(req3, r3);
    },
  },
  {
    name: 'オブジェクト取得 (GET)',
    description: `PutObject でオブジェクトを保存し、GetObject で内容を取得する。
レスポンスにはContent-Type, ETag, Last-Modifiedなどのヘッダが含まれる。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/data-bucket', headers: {}, query: {} });
      log({ method: 'PUT', path: '/data-bucket', headers: {}, query: {} },
        { statusCode: 200, headers: {}, body: '(バケット作成済)' });

      const body = toBytes(JSON.stringify({ name: 'test', value: 42 }));
      const req1: S3Request = { method: 'PUT', path: '/data-bucket/data.json', headers: { 'content-type': 'application/json' }, query: {}, body };
      const r1 = api.handleRequest(req1);
      log(req1, r1);

      const req2: S3Request = { method: 'GET', path: '/data-bucket/data.json', headers: {}, query: {} };
      const r2 = api.handleRequest(req2);
      log(req2, r2);
    },
  },
  {
    name: 'オブジェクト一覧 (ListObjectsV2)',
    description: `複数のオブジェクトを保存し、ListObjectsV2 で一覧を取得する。
prefix パラメータでフィルタリング可能。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/list-bucket', headers: {}, query: {} });

      // 複数オブジェクト保存
      const files = ['docs/readme.txt', 'docs/guide.txt', 'images/logo.png', 'index.html'];
      for (const f of files) {
        const req: S3Request = { method: 'PUT', path: `/list-bucket/${f}`, headers: { 'content-type': 'text/plain' }, query: {}, body: toBytes(`content of ${f}`) };
        api.handleRequest(req);
      }
      log({ method: 'PUT', path: '/list-bucket/*', headers: {}, query: {} },
        { statusCode: 200, headers: {}, body: `${String(files.length)}個のオブジェクトを保存` });

      // 全件一覧
      const req1: S3Request = { method: 'GET', path: '/list-bucket', headers: {}, query: { 'list-type': '2' } };
      const r1 = api.handleRequest(req1);
      log(req1, r1);

      // prefix でフィルタ
      const req2: S3Request = { method: 'GET', path: '/list-bucket', headers: {}, query: { 'list-type': '2', prefix: 'docs/' } };
      const r2 = api.handleRequest(req2);
      log(req2, r2);
    },
  },
  {
    name: 'フォルダ構造 (prefix + delimiter)',
    description: `delimiter="/" を使ってフォルダ構造をシミュレートする。
CommonPrefixes に仮想フォルダが返される。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/folder-bucket', headers: {}, query: {} });

      const paths = ['photos/2024/jan/img1.jpg', 'photos/2024/feb/img2.jpg', 'photos/2023/img3.jpg', 'documents/report.pdf'];
      for (const p of paths) {
        api.handleRequest({ method: 'PUT', path: `/folder-bucket/${p}`, headers: { 'content-type': 'application/octet-stream' }, query: {}, body: toBytes('data') });
      }
      log({ method: 'PUT', path: '/folder-bucket/*', headers: {}, query: {} },
        { statusCode: 200, headers: {}, body: `${String(paths.length)}個のオブジェクトを保存` });

      // ルートレベルのフォルダ一覧
      const req1: S3Request = { method: 'GET', path: '/folder-bucket', headers: {}, query: { 'list-type': '2', delimiter: '/' } };
      const r1 = api.handleRequest(req1);
      log(req1, r1);

      // photos/ 配下のサブフォルダ
      const req2: S3Request = { method: 'GET', path: '/folder-bucket', headers: {}, query: { 'list-type': '2', prefix: 'photos/', delimiter: '/' } };
      const r2 = api.handleRequest(req2);
      log(req2, r2);

      // photos/2024/ 配下
      const req3: S3Request = { method: 'GET', path: '/folder-bucket', headers: {}, query: { 'list-type': '2', prefix: 'photos/2024/', delimiter: '/' } };
      const r3 = api.handleRequest(req3);
      log(req3, r3);
    },
  },
  {
    name: 'オブジェクト削除',
    description: `PutObject → DeleteObject → GetObject で404を確認する。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/del-bucket', headers: {}, query: {} });

      const req1: S3Request = { method: 'PUT', path: '/del-bucket/temp.txt', headers: { 'content-type': 'text/plain' }, query: {}, body: toBytes('temporary data') };
      const r1 = api.handleRequest(req1);
      log(req1, r1);

      // 削除
      const req2: S3Request = { method: 'DELETE', path: '/del-bucket/temp.txt', headers: {}, query: {} };
      const r2 = api.handleRequest(req2);
      log(req2, r2);

      // 削除後にGET → 404
      const req3: S3Request = { method: 'GET', path: '/del-bucket/temp.txt', headers: {}, query: {} };
      const r3 = api.handleRequest(req3);
      log(req3, r3);
    },
  },
  {
    name: 'オブジェクトコピー',
    description: `CopyObject で別のキーにコピーする。
x-amz-copy-source ヘッダを使用。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/copy-bucket', headers: {}, query: {} });

      // ソースオブジェクト作成
      const req1: S3Request = { method: 'PUT', path: '/copy-bucket/original.txt', headers: { 'content-type': 'text/plain' }, query: {}, body: toBytes('original content') };
      const r1 = api.handleRequest(req1);
      log(req1, r1);

      // コピー
      const req2: S3Request = { method: 'PUT', path: '/copy-bucket/copied.txt', headers: { 'x-amz-copy-source': '/copy-bucket/original.txt' }, query: {} };
      const r2 = api.handleRequest(req2);
      log(req2, r2);

      // コピー先を取得して内容確認
      const req3: S3Request = { method: 'GET', path: '/copy-bucket/copied.txt', headers: {}, query: {} };
      const r3 = api.handleRequest(req3);
      log(req3, r3);
    },
  },
  {
    name: 'バージョニング',
    description: `バケットのバージョニングを有効にし、同じキーに複数回書き込む。
各バージョンを個別に取得できることを確認。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/ver-bucket', headers: {}, query: {} });

      // バージョニングを有効化
      api.bucketManager.setVersioning('ver-bucket', 'Enabled');
      log({ method: 'PUT', path: '/ver-bucket?versioning', headers: {}, query: {} },
        { statusCode: 200, headers: {}, body: 'バージョニングを Enabled に設定' });

      // バージョン1
      const req1: S3Request = { method: 'PUT', path: '/ver-bucket/config.json', headers: { 'content-type': 'application/json' }, query: {}, body: toBytes('{"version": 1}') };
      const r1 = api.handleRequest(req1);
      log(req1, r1);
      const v1 = r1.headers['x-amz-version-id'];

      // バージョン2
      const req2: S3Request = { method: 'PUT', path: '/ver-bucket/config.json', headers: { 'content-type': 'application/json' }, query: {}, body: toBytes('{"version": 2}') };
      const r2 = api.handleRequest(req2);
      log(req2, r2);

      // 最新を取得
      const req3: S3Request = { method: 'GET', path: '/ver-bucket/config.json', headers: {}, query: {} };
      const r3 = api.handleRequest(req3);
      log(req3, r3);

      // バージョン1を取得
      const req4: S3Request = { method: 'GET', path: '/ver-bucket/config.json', headers: {}, query: { versionId: v1 } };
      const r4 = api.handleRequest(req4);
      log(req4, r4);
    },
  },
  {
    name: '署名V4 (Presigned URL)',
    description: `generatePresignedUrl で署名付きURLを生成する。
AWS Signature V4 形式のクエリパラメータが付与される。`,
    run(_api, log) {
      const result = generatePresignedUrl({
        method: 'GET',
        bucket: 'my-bucket',
        key: 'secret/document.pdf',
        expiresIn: 3600,
        credentials: TEST_CREDENTIALS,
      });

      log(
        { method: 'GET', path: '/my-bucket/secret/document.pdf', headers: {}, query: { 'X-Amz-Expires': '3600' } },
        { statusCode: 200, headers: {}, body: result.url },
      );

      // 短い有効期限
      const result2 = generatePresignedUrl({
        method: 'GET',
        bucket: 'my-bucket',
        key: 'temp/file.zip',
        expiresIn: 300,
        credentials: TEST_CREDENTIALS,
      });

      log(
        { method: 'GET', path: '/my-bucket/temp/file.zip', headers: {}, query: { 'X-Amz-Expires': '300' } },
        { statusCode: 200, headers: {}, body: result2.url },
      );
    },
  },
  {
    name: 'マルチパートアップロード',
    description: `大きなファイルを分割してアップロードするマルチパートアップロード。
Initiate → UploadPart × N → Complete の流れ。`,
    run(api, log) {
      api.handleRequest({ method: 'PUT', path: '/mp-bucket', headers: {}, query: {} });

      // マルチパートアップロード開始
      const req1: S3Request = { method: 'POST', path: '/mp-bucket/large-file.bin', headers: { 'content-type': 'application/octet-stream' }, query: { uploads: '' } };
      const r1 = api.handleRequest(req1);
      log(req1, r1);

      // UploadIdを抽出
      const uploadIdMatch = r1.body.match(/<UploadId>([^<]+)<\/UploadId>/);
      const uploadId = uploadIdMatch ? uploadIdMatch[1] : '';

      // パート1アップロード
      const req2: S3Request = { method: 'PUT', path: '/mp-bucket/large-file.bin', headers: {}, query: { uploadId: uploadId ?? '', partNumber: '1' }, body: toBytes('PART1-DATA-CHUNK') };
      const r2 = api.handleRequest(req2);
      log(req2, r2);

      // パート2アップロード
      const req3: S3Request = { method: 'PUT', path: '/mp-bucket/large-file.bin', headers: {}, query: { uploadId: uploadId ?? '', partNumber: '2' }, body: toBytes('PART2-DATA-CHUNK') };
      const r3 = api.handleRequest(req3);
      log(req3, r3);

      // 完了
      const completeXml = `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${r2.headers['ETag'] ?? ''}</ETag></Part><Part><PartNumber>2</PartNumber><ETag>${r3.headers['ETag'] ?? ''}</ETag></Part></CompleteMultipartUpload>`;
      const req4: S3Request = { method: 'POST', path: '/mp-bucket/large-file.bin', headers: {}, query: { uploadId: uploadId ?? '' }, body: toBytes(completeXml) };
      const r4 = api.handleRequest(req4);
      log(req4, r4);

      // 結果確認
      const req5: S3Request = { method: 'GET', path: '/mp-bucket/large-file.bin', headers: {}, query: {} };
      const r5 = api.handleRequest(req5);
      log(req5, r5);
    },
  },
  {
    name: 'エラーケース (NoSuchKey, BucketAlreadyExists)',
    description: `存在しないキーの取得、重複バケット作成などのエラーレスポンス。
S3のエラーXML形式で返される。`,
    run(api, log) {
      // バケット作成
      const r1 = api.handleRequest({ method: 'PUT', path: '/err-bucket', headers: {}, query: {} });
      log({ method: 'PUT', path: '/err-bucket', headers: {}, query: {} }, r1);

      // 重複バケット作成 → BucketAlreadyExists
      const r2 = api.handleRequest({ method: 'PUT', path: '/err-bucket', headers: {}, query: {} });
      log({ method: 'PUT', path: '/err-bucket', headers: {}, query: {} }, r2);

      // 存在しないキーの取得 → NoSuchKey
      const req3: S3Request = { method: 'GET', path: '/err-bucket/nonexistent.txt', headers: {}, query: {} };
      const r3 = api.handleRequest(req3);
      log(req3, r3);

      // 存在しないバケットへのアクセス → NoSuchBucket
      const req4: S3Request = { method: 'GET', path: '/no-such-bucket/file.txt', headers: {}, query: {} };
      const r4 = api.handleRequest(req4);
      log(req4, r4);

      // 存在しないバケットの削除 → NoSuchBucket
      const req5: S3Request = { method: 'DELETE', path: '/ghost-bucket', headers: {}, query: {} };
      const r5 = api.handleRequest(req5);
      log(req5, r5);
    },
  },
];

/** S3シミュレーターUIアプリケーション */
export class S3App {
  /** UIを初期化してコンテナに描画する */
  init(container: HTMLElement): void {
    container.style.cssText = 'display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;';

    // ヘッダ
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;';
    const title = document.createElement('h1');
    title.textContent = 'S3 Storage Simulator';
    title.style.cssText = 'margin:0;font-size:15px;color:#f59e0b;';
    header.appendChild(title);

    // シナリオセレクト
    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;';
    for (let i = 0; i < SCENARIOS.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = SCENARIOS[i]?.name ?? '';
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run';
    runBtn.style.cssText = 'padding:4px 16px;background:#f59e0b;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
    header.appendChild(runBtn);
    container.appendChild(header);

    // メイン
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;overflow:hidden;';

    // 左: シナリオ説明エリア
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;';

    const descLabel = document.createElement('div');
    descLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;';
    descLabel.textContent = 'S3 Scenario';
    leftPanel.appendChild(descLabel);

    const descArea = document.createElement('textarea');
    descArea.style.cssText = 'flex:1;padding:12px;font-family:"Fira Code",monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;';
    descArea.spellcheck = false;
    descArea.readOnly = true;
    descArea.value = SCENARIOS[0]?.description ?? '';
    leftPanel.appendChild(descArea);
    main.appendChild(leftPanel);

    // 右: リクエスト/レスポンスログ
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;';

    // REST ログ
    const logLabel = document.createElement('div');
    logLabel.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;';
    logLabel.textContent = 'REST Request / Response Log';
    rightPanel.appendChild(logLabel);

    const logDiv = document.createElement('div');
    logDiv.style.cssText = 'flex:1;padding:8px 12px;font-family:monospace;font-size:11px;overflow-y:auto;white-space:pre-wrap;';
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // セレクト変更時
    select.addEventListener('change', () => {
      const sc = SCENARIOS[Number(select.value)];
      if (sc !== undefined) descArea.value = sc.description;
    });

    // 実行ボタン押下時
    runBtn.addEventListener('click', () => {
      logDiv.innerHTML = '';

      const api = new S3RestApi();
      const scenario = SCENARIOS[Number(select.value)];
      if (!scenario) return;

      /** リクエスト/レスポンスをログに追加する */
      const appendLog = (req: S3Request, res: S3Response): void => {
        // リクエスト行
        const reqRow = document.createElement('div');
        reqRow.style.cssText = 'color:#3b82f6;margin-top:4px;';
        const queryStr = Object.keys(req.query).length > 0
          ? '?' + Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join('&')
          : '';
        reqRow.textContent = `>>> ${req.method} ${req.path}${queryStr}`;
        logDiv.appendChild(reqRow);

        // リクエストヘッダ（重要なもののみ）
        const importantHeaders = ['content-type', 'x-amz-copy-source'];
        for (const h of importantHeaders) {
          if (req.headers[h]) {
            const hRow = document.createElement('div');
            hRow.style.cssText = 'color:#64748b;padding-left:16px;';
            hRow.textContent = `${h}: ${req.headers[h]}`;
            logDiv.appendChild(hRow);
          }
        }

        // レスポンス行
        const resRow = document.createElement('div');
        const statusColor = res.statusCode < 300 ? '#68d391' : '#f87171';
        resRow.style.cssText = `color:${statusColor};`;
        resRow.textContent = `<<< ${String(res.statusCode)}`;
        logDiv.appendChild(resRow);

        // レスポンスヘッダ
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) {
            const hRow = document.createElement('div');
            hRow.style.cssText = 'color:#64748b;padding-left:16px;';
            hRow.textContent = `${k}: ${v}`;
            logDiv.appendChild(hRow);
          }
        }

        // レスポンスボディ（ある場合）
        if (res.body) {
          const bodyRow = document.createElement('div');
          bodyRow.style.cssText = 'color:#94a3b8;padding-left:16px;';
          const preview = res.body.length > 300 ? res.body.slice(0, 300) + '...' : res.body;
          bodyRow.textContent = preview;
          logDiv.appendChild(bodyRow);
        }

        // 区切り線
        const sep = document.createElement('div');
        sep.style.cssText = 'border-bottom:1px solid #1e293b;margin:4px 0;';
        logDiv.appendChild(sep);
      };

      scenario.run(api, appendLog);
    });

    // 初回実行
    runBtn.click();
  }
}
