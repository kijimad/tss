# GPU Simulator

GPUの主要コンポーネントをTypeScriptでシミュレーションするプロジェクト。

## 構成

- **hw/** - ハードウェアモデル（デバイス、メモリ階層）
- **compute/** - CUDAライクなコンピュートカーネル（ワープ、カーネル起動）
- **render/** - レンダリングパイプライン（頂点シェーダ、ラスタライゼーション、フラグメントシェーダ）
- **ui/** - ブラウザUI

## コマンド

```bash
npm run dev        # 開発サーバー起動
npm run build      # ビルド
npm test           # テスト実行
npm run test:watch # テスト（ウォッチモード）
```
