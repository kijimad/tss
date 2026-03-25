import type { SqlValue } from "../types.js";

// SQL値の比較（NULL < 任意の値）
export function compareSqlValues(a: SqlValue, b: SqlValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  if (typeof a === "string" && typeof b === "string") {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return a.length - b.length;
  }

  // 型が異なる場合: number < string < Uint8Array
  const typeOrder = (v: SqlValue): number => {
    if (v === null) return 0;
    if (typeof v === "number") return 1;
    if (typeof v === "string") return 2;
    return 3;
  };
  return typeOrder(a) - typeOrder(b);
}

// 複合キーの比較
export function compareKeys(a: SqlValue[], b: SqlValue[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const aVal = a[i] ?? null;
    const bVal = b[i] ?? null;
    const cmp = compareSqlValues(aVal, bVal);
    if (cmp !== 0) return cmp;
  }
  return a.length - b.length;
}
