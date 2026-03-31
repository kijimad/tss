import type { ProviderDef } from "./interfaces.js";

/** 依存性注入コンテナ */
export class DIContainer {
  private providers = new Map<string, ProviderDef>();
  private instances = new Map<string, unknown>();

  /** プロバイダを登録する */
  register(provider: ProviderDef): void {
    this.providers.set(provider.name, provider);
  }

  /** プロバイダ名からインスタンスを解決する（遅延初期化 + シングルトン） */
  resolve<T = unknown>(name: string): T {
    const cached = this.instances.get(name);
    if (cached !== undefined) return cached as T;

    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new Error(`Provider "${name}" が見つかりません`);
    }

    const instance = provider.factory((dep) => this.resolve(dep));
    this.instances.set(name, instance);
    return instance as T;
  }

  /** コンテナをリセットする */
  clear(): void {
    this.instances.clear();
    this.providers.clear();
  }

  /** 登録済みプロバイダ名の一覧 */
  get registeredNames(): string[] {
    return [...this.providers.keys()];
  }
}
