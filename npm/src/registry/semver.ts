/**
 * semver.ts -- セマンティックバージョニング解決
 *
 * npm の依存バージョン指定を解釈する:
 *   "4.18.2"     → 完全一致
 *   "^4.18.0"    → 4.x.x で 4.18.0 以上（メジャー固定）
 *   "~4.18.0"    → 4.18.x で 4.18.0 以上（マイナー固定）
 *   ">=4.0.0"    → 4.0.0 以上
 *   "*"          → 任意
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

// "4.18.2" → { major: 4, minor: 18, patch: 2 }
export function parseSemVer(version: string): SemVer | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

// バージョン比較: -1, 0, 1
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// semver 範囲にマッチするか判定
export function satisfies(version: string, range: string): boolean {
  const ver = parseSemVer(version);
  if (ver === undefined) return false;

  const trimmed = range.trim();

  // "*" — 任意
  if (trimmed === "*" || trimmed === "" || trimmed === "latest") return true;

  // 完全一致 "4.18.2"
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    const target = parseSemVer(trimmed);
    if (target === undefined) return false;
    return compareSemVer(ver, target) === 0;
  }

  // "^4.18.0" — メジャー固定、マイナー以上
  if (trimmed.startsWith("^")) {
    const target = parseSemVer(trimmed.slice(1));
    if (target === undefined) return false;
    if (ver.major !== target.major) return false;
    return compareSemVer(ver, target) >= 0;
  }

  // "~4.18.0" — マイナー固定、パッチ以上
  if (trimmed.startsWith("~")) {
    const target = parseSemVer(trimmed.slice(1));
    if (target === undefined) return false;
    if (ver.major !== target.major || ver.minor !== target.minor) return false;
    return ver.patch >= target.patch;
  }

  // ">=4.0.0"
  if (trimmed.startsWith(">=")) {
    const target = parseSemVer(trimmed.slice(2));
    if (target === undefined) return false;
    return compareSemVer(ver, target) >= 0;
  }

  // ">4.0.0"
  if (trimmed.startsWith(">")) {
    const target = parseSemVer(trimmed.slice(1));
    if (target === undefined) return false;
    return compareSemVer(ver, target) > 0;
  }

  // "<=4.0.0"
  if (trimmed.startsWith("<=")) {
    const target = parseSemVer(trimmed.slice(2));
    if (target === undefined) return false;
    return compareSemVer(ver, target) <= 0;
  }

  // "<4.0.0"
  if (trimmed.startsWith("<")) {
    const target = parseSemVer(trimmed.slice(1));
    if (target === undefined) return false;
    return compareSemVer(ver, target) < 0;
  }

  return false;
}

// semver 範囲を満たす最新バージョンを選択
export function maxSatisfying(versions: string[], range: string): string | undefined {
  const matching = versions
    .filter(v => satisfies(v, range))
    .map(v => ({ str: v, parsed: parseSemVer(v) }))
    .filter((v): v is { str: string; parsed: SemVer } => v.parsed !== undefined)
    .sort((a, b) => compareSemVer(b.parsed, a.parsed)); // 降順

  return matching[0]?.str;
}
