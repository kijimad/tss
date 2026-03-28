/**
 * scope.ts -- スコープ管理
 *
 * 変数名 → 型 のマッピングを、ブロックスコープに沿って管理する。
 * 内側のスコープから外側のスコープを辿って変数を探す。
 *
 *   {                         ← スコープ1
 *     const x: number = 1;
 *     {                       ← スコープ2 (親=スコープ1)
 *       const y = "hello";
 *       x; // スコープ2 → スコープ1 で見つかる
 *     }
 *   }
 */
import type { Type } from "./types.js";

export class Scope {
  private bindings = new Map<string, Type>();
  private parent: Scope | undefined;

  constructor(parent?: Scope) {
    this.parent = parent;
  }

  // 変数を定義
  define(name: string, type: Type): void {
    this.bindings.set(name, type);
  }

  // 変数を検索（現在のスコープ → 親スコープを辿る）
  lookup(name: string): Type | undefined {
    const found = this.bindings.get(name);
    if (found !== undefined) return found;
    if (this.parent !== undefined) return this.parent.lookup(name);
    return undefined;
  }

  // 現在のスコープにのみ存在するか
  has(name: string): boolean {
    return this.bindings.has(name);
  }

  // 子スコープを作る
  child(): Scope {
    return new Scope(this);
  }
}
