/**
 * dep-graph.ts -- 依存グラフ + HMR 境界
 *
 * Vite はモジュール間の依存関係をグラフで管理する。
 * ファイルが更新された時、そのモジュールと依存元を辿って
 * HMR 境界（import.meta.hot.accept() があるモジュール）まで伝播する。
 *
 *   main.ts → App.tsx → Header.tsx → styles.css
 *                     → Footer.tsx
 *
 *   styles.css が変更 → Header.tsx が HMR 境界 → Header のみ再実行
 *   Footer.tsx が変更 → App.tsx が HMR 境界 → App から再実行
 */

export interface ModuleNode {
  id: string;           // ファイルパス
  importers: Set<string>;   // このモジュールを import しているモジュール
  importedModules: Set<string>; // このモジュールが import しているモジュール
  acceptsHmr: boolean;  // import.meta.hot.accept() があるか
  lastTransformTime: number;
}

export class DependencyGraph {
  private modules = new Map<string, ModuleNode>();

  // モジュールを登録/更新
  ensureModule(id: string): ModuleNode {
    let mod = this.modules.get(id);
    if (mod === undefined) {
      mod = { id, importers: new Set(), importedModules: new Set(), acceptsHmr: false, lastTransformTime: 0 };
      this.modules.set(id, mod);
    }
    return mod;
  }

  // import 関係を記録
  addImport(importer: string, imported: string): void {
    const importerMod = this.ensureModule(importer);
    const importedMod = this.ensureModule(imported);
    importerMod.importedModules.add(imported);
    importedMod.importers.add(importer);
  }

  // コードから import を抽出して依存グラフを更新
  updateFromCode(filePath: string, code: string): void {
    const mod = this.ensureModule(filePath);
    // 古い依存をクリア
    for (const old of mod.importedModules) {
      const oldMod = this.modules.get(old);
      if (oldMod !== undefined) oldMod.importers.delete(filePath);
    }
    mod.importedModules.clear();

    // import 文を正規表現で抽出
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(code)) !== null) {
      let specifier = match[1] ?? "";
      // タイムスタンプやクエリパラメータを除去
      specifier = specifier.split("?")[0] ?? specifier;
      if (specifier.startsWith("/@modules/")) continue; // 外部モジュールは除外
      this.addImport(filePath, specifier);
    }

    // HMR accept の検出
    mod.acceptsHmr = code.includes("import.meta.hot");
    mod.lastTransformTime = Date.now();
  }

  // HMR: 変更されたファイルから影響を受けるモジュールを計算
  getHmrBoundary(changedFile: string): { boundary: string[]; propagation: string[] } {
    const propagation: string[] = [changedFile];
    const boundary: string[] = [];
    const visited = new Set<string>();
    const queue = [changedFile];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);

      const mod = this.modules.get(current);
      if (mod === undefined) continue;

      if (mod.acceptsHmr && current !== changedFile) {
        // HMR 境界: ここで伝播停止
        boundary.push(current);
        continue;
      }

      // 境界に到達していない → さらに上流に伝播
      for (const importer of mod.importers) {
        propagation.push(importer);
        queue.push(importer);
      }
    }

    // 境界が見つからなかった場合 → フルリロード
    if (boundary.length === 0 && propagation.length > 1) {
      boundary.push("__full_reload__");
    }

    return { boundary, propagation };
  }

  getModule(id: string): ModuleNode | undefined {
    return this.modules.get(id);
  }

  getAllModules(): ModuleNode[] {
    return [...this.modules.values()];
  }

  // 依存グラフを可視化用にダンプ
  toEdges(): { from: string; to: string }[] {
    const edges: { from: string; to: string }[] = [];
    for (const [from, mod] of this.modules) {
      for (const to of mod.importedModules) {
        edges.push({ from, to });
      }
    }
    return edges;
  }
}
