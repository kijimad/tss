import { describe, it, expect } from "vitest";
import { satisfies, maxSatisfying, parseSemVer, compareSemVer } from "../registry/semver.js";
import { buildRegistry } from "../registry/registry.js";
import { DependencyResolver } from "../resolver/resolver.js";

describe("semver", () => {
  it("完全一致", () => {
    expect(satisfies("4.18.2", "4.18.2")).toBe(true);
    expect(satisfies("4.18.1", "4.18.2")).toBe(false);
  });

  it("^ (キャレット: メジャー固定)", () => {
    expect(satisfies("4.18.2", "^4.18.0")).toBe(true);
    expect(satisfies("4.19.0", "^4.18.0")).toBe(true);
    expect(satisfies("4.17.0", "^4.18.0")).toBe(false);
    expect(satisfies("5.0.0", "^4.18.0")).toBe(false);
  });

  it("~ (チルダ: マイナー固定)", () => {
    expect(satisfies("4.18.2", "~4.18.0")).toBe(true);
    expect(satisfies("4.18.9", "~4.18.0")).toBe(true);
    expect(satisfies("4.19.0", "~4.18.0")).toBe(false);
  });

  it(">= 以上", () => {
    expect(satisfies("4.18.0", ">=4.18.0")).toBe(true);
    expect(satisfies("5.0.0", ">=4.18.0")).toBe(true);
    expect(satisfies("4.17.9", ">=4.18.0")).toBe(false);
  });

  it("* (任意)", () => {
    expect(satisfies("1.0.0", "*")).toBe(true);
    expect(satisfies("99.99.99", "*")).toBe(true);
  });

  it("maxSatisfying で最新マッチを選択", () => {
    const versions = ["4.17.1", "4.18.0", "4.18.2", "4.19.0", "5.0.0"];
    expect(maxSatisfying(versions, "^4.18.0")).toBe("4.19.0");
    expect(maxSatisfying(versions, "~4.18.0")).toBe("4.18.2");
    expect(maxSatisfying(versions, "4.17.1")).toBe("4.17.1");
  });

  it("バージョン比較", () => {
    const a = parseSemVer("1.2.3");
    const b = parseSemVer("1.2.4");
    const c = parseSemVer("2.0.0");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      expect(compareSemVer(a, b)).toBeLessThan(0);
    }
    if (a !== undefined && c !== undefined) {
      expect(compareSemVer(a, c)).toBeLessThan(0);
    }
  });
});

describe("レジストリ", () => {
  it("パッケージを取得できる", () => {
    const reg = buildRegistry();
    const meta = reg.getPackage("express");
    expect(meta).toBeDefined();
    expect(meta?.versions.size).toBeGreaterThan(0);
  });

  it("存在しないパッケージは undefined", () => {
    const reg = buildRegistry();
    expect(reg.getPackage("nonexistent")).toBeUndefined();
  });
});

describe("依存解決", () => {
  it("express の依存を再帰的に解決する", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    const resolved = resolver.resolve({ "express": "^4.18.0" });

    expect(resolved).toHaveLength(1);
    const express = resolved[0];
    expect(express?.name).toBe("express");
    expect(express?.version).toBe("4.19.0"); // ^4.18.0 の最新

    // express の依存が解決されている
    expect(express?.dependencies.length).toBeGreaterThan(0);
    const depNames = express?.dependencies.map(d => d.name) ?? [];
    expect(depNames).toContain("accepts");
    expect(depNames).toContain("body-parser");
    expect(depNames).toContain("debug");
  });

  it("lodash (依存なし) を解決する", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    const resolved = resolver.resolve({ "lodash": "^4.17.0" });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.version).toBe("4.17.21");
    expect(resolved[0]?.dependencies).toHaveLength(0);
  });

  it("複数パッケージを同時に解決する", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    const resolved = resolver.resolve({
      "express": "^4.18.0",
      "lodash": "^4.17.0",
      "axios": "^1.6.0",
    });

    expect(resolved).toHaveLength(3);
    const names = resolved.map(r => r.name);
    expect(names).toContain("express");
    expect(names).toContain("lodash");
    expect(names).toContain("axios");
  });

  it("重複する依存が共有される (debug は express と body-parser で共通)", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    const resolved = resolver.resolve({ "express": "^4.18.0" });

    // dedupe イベントが発生しているか
    const dedupeEvents = resolver.events.filter(e => e.type === "dedupe");
    expect(dedupeEvents.length).toBeGreaterThan(0);
  });

  it("フラット化して node_modules を構築する", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    const resolved = resolver.resolve({ "express": "^4.18.0" });
    const installed = resolver.flatten(resolved);

    expect(installed.length).toBeGreaterThan(5); // express + その依存
    const paths = installed.map(p => p.path);
    expect(paths).toContain("node_modules/express");
    expect(paths).toContain("node_modules/debug");
    expect(paths).toContain("node_modules/ms");
  });

  it("ロックファイルを生成する", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    const resolved = resolver.resolve({ "express": "^4.18.0" });
    const lockfile = resolver.generateLockfile(resolved);

    expect(Object.keys(lockfile).length).toBeGreaterThan(5);
    const expressEntry = lockfile["node_modules/express"];
    expect(expressEntry).toBeDefined();
    expect(expressEntry?.version).toBe("4.19.0");
    expect(expressEntry?.integrity).toBeDefined();
  });

  it("イベントが記録される", () => {
    const reg = buildRegistry();
    const resolver = new DependencyResolver(reg);
    resolver.resolve({ "express": "^4.18.0" });

    const fetches = resolver.events.filter(e => e.type === "registry_fetch");
    expect(fetches.length).toBeGreaterThan(0);
    const resolves = resolver.events.filter(e => e.type === "version_resolve");
    expect(resolves.length).toBeGreaterThan(0);
  });
});
