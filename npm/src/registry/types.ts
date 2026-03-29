/**
 * types.ts -- npm シミュレータの型定義
 *
 * npm install の裏で起きること:
 *
 *   1. package.json を読む
 *   2. 各依存パッケージの情報をレジストリに問い合わせ (HTTP GET)
 *   3. semver 制約を満たすバージョンを選択
 *   4. 依存の依存も再帰的に解決（依存ツリー構築）
 *   5. パッケージの tarball をダウンロード
 *   6. node_modules/ にファイルを展開
 *   7. package-lock.json を生成
 */

// package.json
export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;     // "express": "^4.18.0"
  devDependencies?: Record<string, string>;
}

// レジストリ上のパッケージメタデータ（npm registry API の応答を模したもの）
export interface PackageMetadata {
  name: string;
  versions: Map<string, PackageVersionInfo>;
  // "latest" 等のタグ
  distTags: Record<string, string>;
}

// 特定バージョンの情報
export interface PackageVersionInfo {
  name: string;
  version: string;
  description: string;
  dependencies: Record<string, string>;      // "debug": "^4.3.0"
  dist: {
    tarball: string;   // ダウンロードURL（シミュレータでは不使用）
    integrity: string; // SHA ハッシュ
    size: number;      // バイト数
  };
}

// 依存解決の結果（ロックファイルに相当）
export interface ResolvedPackage {
  name: string;
  version: string;          // 解決された具体的なバージョン
  requestedRange: string;   // 元の semver 範囲 "^4.18.0"
  dependencies: ResolvedPackage[];
  depth: number;            // 依存の深さ (0=直接依存)
  integrity: string;
}

// node_modules 内のフラット化されたエントリ
export interface InstalledPackage {
  name: string;
  version: string;
  path: string;    // "node_modules/express"
  size: number;
}

// npm のイベント（可視化用）
export type NpmEvent =
  | { type: "registry_fetch"; package: string; timestamp: number }
  | { type: "registry_response"; package: string; versions: number; timestamp: number }
  | { type: "version_resolve"; package: string; range: string; resolved: string; timestamp: number }
  | { type: "dependency_found"; parent: string; child: string; range: string; depth: number; timestamp: number }
  | { type: "download_start"; package: string; version: string; size: number; timestamp: number }
  | { type: "download_complete"; package: string; version: string; timestamp: number }
  | { type: "install"; package: string; version: string; path: string; timestamp: number }
  | { type: "conflict"; package: string; existing: string; requested: string; timestamp: number }
  | { type: "dedupe"; package: string; version: string; savedAt: string; timestamp: number }
  | { type: "lockfile_write"; packages: number; timestamp: number }
  | { type: "complete"; installed: number; totalSize: number; timestamp: number };
