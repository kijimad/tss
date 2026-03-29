/**
 * registry.ts -- 仮想 npm レジストリ
 *
 * 実際の npm レジストリ (registry.npmjs.org) をメモリ上でエミュレートする。
 * パッケージの複数バージョンを登録し、HTTP GET に相当する API で取得する。
 *
 * 実際の npm:  GET https://registry.npmjs.org/express
 * シミュレータ: registry.getPackage("express")
 */
import type { PackageMetadata, PackageVersionInfo, NpmEvent } from "./types.js";

export class NpmRegistry {
  private packages = new Map<string, PackageMetadata>();
  onEvent: ((event: NpmEvent) => void) | undefined;
  private startTime = performance.now();

  private emit(event: NpmEvent): void {
    this.onEvent?.(event);
  }

  // パッケージ情報を取得（HTTP GET のシミュレーション）
  getPackage(name: string): PackageMetadata | undefined {
    this.emit({ type: "registry_fetch", package: name, timestamp: performance.now() - this.startTime });
    const pkg = this.packages.get(name);
    if (pkg !== undefined) {
      this.emit({ type: "registry_response", package: name, versions: pkg.versions.size, timestamp: performance.now() - this.startTime });
    }
    return pkg;
  }

  // パッケージをレジストリに登録（npm publish のシミュレーション）
  publish(info: PackageVersionInfo): void {
    let meta = this.packages.get(info.name);
    if (meta === undefined) {
      meta = { name: info.name, versions: new Map(), distTags: {} };
      this.packages.set(info.name, meta);
    }
    meta.versions.set(info.version, info);
    meta.distTags["latest"] = info.version;
  }

  resetTime(): void {
    this.startTime = performance.now();
  }
}

// 現実のパッケージを模した仮想パッケージ群を登録する
export function buildRegistry(): NpmRegistry {
  const reg = new NpmRegistry();

  // === express ===
  publish(reg, "express", "4.17.1", "Fast web framework", { "accepts": "~1.3.7", "body-parser": "1.19.0", "debug": "^2.6.9" }, 210000);
  publish(reg, "express", "4.18.0", "Fast web framework", { "accepts": "~1.3.8", "body-parser": "1.20.0", "debug": "^2.6.9" }, 215000);
  publish(reg, "express", "4.18.2", "Fast web framework", { "accepts": "~1.3.8", "body-parser": "1.20.1", "debug": "^2.6.9" }, 220000);
  publish(reg, "express", "4.19.0", "Fast web framework", { "accepts": "~1.3.8", "body-parser": "1.20.2", "debug": "^2.6.9" }, 225000);

  // === body-parser ===
  publish(reg, "body-parser", "1.19.0", "HTTP body parsing", { "debug": "^2.6.9", "raw-body": "^2.4.0" }, 55000);
  publish(reg, "body-parser", "1.20.0", "HTTP body parsing", { "debug": "^2.6.9", "raw-body": "^2.5.0" }, 58000);
  publish(reg, "body-parser", "1.20.1", "HTTP body parsing", { "debug": "^2.6.9", "raw-body": "^2.5.1" }, 59000);
  publish(reg, "body-parser", "1.20.2", "HTTP body parsing", { "debug": "^2.6.9", "raw-body": "^2.5.2" }, 60000);

  // === debug ===
  publish(reg, "debug", "2.6.9", "Debugging utility", { "ms": "2.0.0" }, 18000);
  publish(reg, "debug", "4.3.4", "Debugging utility", { "ms": "^2.1.1" }, 20000);
  publish(reg, "debug", "4.3.5", "Debugging utility", { "ms": "^2.1.1" }, 20500);

  // === ms ===
  publish(reg, "ms", "2.0.0", "Time string converter", {}, 3000);
  publish(reg, "ms", "2.1.1", "Time string converter", {}, 3100);
  publish(reg, "ms", "2.1.3", "Time string converter", {}, 3200);

  // === accepts ===
  publish(reg, "accepts", "1.3.7", "Content negotiation", { "mime-types": "~2.1.24" }, 12000);
  publish(reg, "accepts", "1.3.8", "Content negotiation", { "mime-types": "~2.1.34" }, 12500);

  // === mime-types ===
  publish(reg, "mime-types", "2.1.24", "MIME type mapping", { "mime-db": "1.40.0" }, 22000);
  publish(reg, "mime-types", "2.1.34", "MIME type mapping", { "mime-db": "1.52.0" }, 23000);
  publish(reg, "mime-types", "2.1.35", "MIME type mapping", { "mime-db": "1.52.0" }, 23500);

  // === mime-db ===
  publish(reg, "mime-db", "1.40.0", "MIME type database", {}, 210000);
  publish(reg, "mime-db", "1.52.0", "MIME type database", {}, 220000);

  // === raw-body ===
  publish(reg, "raw-body", "2.4.0", "Raw HTTP body reader", { "bytes": "^3.1.0" }, 15000);
  publish(reg, "raw-body", "2.5.0", "Raw HTTP body reader", { "bytes": "^3.1.2" }, 16000);
  publish(reg, "raw-body", "2.5.1", "Raw HTTP body reader", { "bytes": "^3.1.2" }, 16500);
  publish(reg, "raw-body", "2.5.2", "Raw HTTP body reader", { "bytes": "^3.1.2" }, 17000);

  // === bytes ===
  publish(reg, "bytes", "3.1.0", "Byte string parser", {}, 5000);
  publish(reg, "bytes", "3.1.2", "Byte string parser", {}, 5200);

  // === lodash (依存なし、大きいパッケージ) ===
  publish(reg, "lodash", "4.17.20", "Utility library", {}, 1400000);
  publish(reg, "lodash", "4.17.21", "Utility library", {}, 1410000);

  // === axios ===
  publish(reg, "axios", "1.6.0", "HTTP client", { "follow-redirects": "^1.15.0" }, 65000);
  publish(reg, "axios", "1.7.0", "HTTP client", { "follow-redirects": "^1.15.0" }, 68000);

  // === follow-redirects ===
  publish(reg, "follow-redirects", "1.15.0", "HTTP redirect follower", {}, 35000);
  publish(reg, "follow-redirects", "1.15.6", "HTTP redirect follower", {}, 36000);

  return reg;
}

function publish(
  reg: NpmRegistry, name: string, version: string,
  description: string, deps: Record<string, string>, size: number,
): void {
  reg.publish({
    name, version, description,
    dependencies: deps,
    dist: {
      tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: `sha512-${btoa(name + version).slice(0, 20)}`,
      size,
    },
  });
}
