/**
 * resolver.ts -- 依存解決エンジン
 *
 * npm install の核心。以下を行う:
 *   1. package.json の dependencies を読む
 *   2. 各パッケージのメタデータをレジストリから取得
 *   3. semver 制約を満たす最新バージョンを選択
 *   4. そのバージョンの dependencies を再帰的に解決
 *   5. 重複排除（同じパッケージの同じバージョンは1度だけ）
 *
 * 実際の npm v7+ は「node_modules のフラット化」を行うが、
 * ここではまず木構造で解決し、その後フラット化する。
 */
import type { NpmRegistry } from "../registry/registry.js";
import type { ResolvedPackage, InstalledPackage, NpmEvent } from "../registry/types.js";
import { maxSatisfying } from "../registry/semver.js";

export class DependencyResolver {
  private registry: NpmRegistry;
  private resolved = new Map<string, ResolvedPackage>(); // "name@version" → 解決済み
  events: NpmEvent[] = [];
  onEvent: ((event: NpmEvent) => void) | undefined;
  private startTime = performance.now();

  constructor(registry: NpmRegistry) {
    this.registry = registry;
    this.registry.onEvent = (e) => this.emit(e);
  }

  private emit(event: NpmEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  // 依存を解決する（再帰）
  resolve(dependencies: Record<string, string>): ResolvedPackage[] {
    this.events = [];
    this.resolved.clear();
    this.startTime = performance.now();
    this.registry.resetTime();

    const result: ResolvedPackage[] = [];
    for (const [name, range] of Object.entries(dependencies)) {
      const pkg = this.resolvePackage(name, range, 0);
      if (pkg !== undefined) {
        result.push(pkg);
      }
    }
    return result;
  }

  private resolvePackage(name: string, range: string, depth: number): ResolvedPackage | undefined {
    // レジストリからパッケージ情報を取得
    const meta = this.registry.getPackage(name);
    if (meta === undefined) {
      this.emit({ type: "version_resolve", package: name, range, resolved: "NOT FOUND", timestamp: performance.now() - this.startTime });
      return undefined;
    }

    // semver 制約を満たす最新バージョンを選択
    const versions = [...meta.versions.keys()];
    const resolved = maxSatisfying(versions, range);
    if (resolved === undefined) {
      this.emit({ type: "version_resolve", package: name, range, resolved: "NO MATCH", timestamp: performance.now() - this.startTime });
      return undefined;
    }

    this.emit({ type: "version_resolve", package: name, range, resolved, timestamp: performance.now() - this.startTime });

    // 既に同じバージョンが解決済みなら再利用（重複排除）
    const key = `${name}@${resolved}`;
    const existing = this.resolved.get(key);
    if (existing !== undefined) {
      this.emit({ type: "dedupe", package: name, version: resolved, savedAt: key, timestamp: performance.now() - this.startTime });
      return existing;
    }

    const versionInfo = meta.versions.get(resolved);
    if (versionInfo === undefined) return undefined;

    // このパッケージの依存を再帰的に解決
    const deps: ResolvedPackage[] = [];
    const pkg: ResolvedPackage = {
      name,
      version: resolved,
      requestedRange: range,
      dependencies: deps,
      depth,
      integrity: versionInfo.dist.integrity,
    };
    // 循環参照防止: 先に登録
    this.resolved.set(key, pkg);

    for (const [depName, depRange] of Object.entries(versionInfo.dependencies)) {
      this.emit({ type: "dependency_found", parent: `${name}@${resolved}`, child: depName, range: depRange, depth: depth + 1, timestamp: performance.now() - this.startTime });
      const depPkg = this.resolvePackage(depName, depRange, depth + 1);
      if (depPkg !== undefined) {
        deps.push(depPkg);
      }
    }

    return pkg;
  }

  // 解決済みのパッケージを node_modules にフラット化
  flatten(resolved: ResolvedPackage[]): InstalledPackage[] {
    const installed = new Map<string, InstalledPackage>(); // name → installed
    const queue = [...resolved];

    while (queue.length > 0) {
      const pkg = queue.shift();
      if (pkg === undefined) break;

      const existing = installed.get(pkg.name);
      if (existing === undefined) {
        // トップレベルに配置
        const meta = this.registry.getPackage(pkg.name);
        const versionInfo = meta?.versions.get(pkg.version);
        installed.set(pkg.name, {
          name: pkg.name,
          version: pkg.version,
          path: `node_modules/${pkg.name}`,
          size: versionInfo?.dist.size ?? 0,
        });
        this.emit({
          type: "install", package: pkg.name, version: pkg.version,
          path: `node_modules/${pkg.name}`, timestamp: performance.now() - this.startTime,
        });
      } else if (existing.version !== pkg.version) {
        // バージョン競合: ネストして配置
        this.emit({
          type: "conflict", package: pkg.name, existing: existing.version,
          requested: pkg.version, timestamp: performance.now() - this.startTime,
        });
      }

      // 依存も処理
      for (const dep of pkg.dependencies) {
        queue.push(dep);
      }
    }

    const result = [...installed.values()];
    const totalSize = result.reduce((sum, p) => sum + p.size, 0);
    this.emit({ type: "complete", installed: result.length, totalSize, timestamp: performance.now() - this.startTime });

    return result;
  }

  // ロックファイル生成
  generateLockfile(resolved: ResolvedPackage[]): Record<string, { version: string; resolved: string; integrity: string; dependencies: Record<string, string> }> {
    const lockfile: Record<string, { version: string; resolved: string; integrity: string; dependencies: Record<string, string> }> = {};
    const visited = new Set<string>();

    const walk = (pkgs: ResolvedPackage[]) => {
      for (const pkg of pkgs) {
        const key = `${pkg.name}@${pkg.version}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const deps: Record<string, string> = {};
        for (const dep of pkg.dependencies) {
          deps[dep.name] = dep.version;
        }

        lockfile[`node_modules/${pkg.name}`] = {
          version: pkg.version,
          resolved: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`,
          integrity: pkg.integrity,
          dependencies: deps,
        };

        walk(pkg.dependencies);
      }
    };
    walk(resolved);

    this.emit({ type: "lockfile_write", packages: Object.keys(lockfile).length, timestamp: performance.now() - this.startTime });
    return lockfile;
  }
}
