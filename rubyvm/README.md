# Ruby VM (YARV) シミュレータ

TypeScript + Vite + Vitest で構築された Ruby VM (YARV) のシミュレータです。

## 機能

- **レキサー**: Rubyトークンの解析（キーワード、文字列補間、シンボル、改行の意味的処理）
- **パーサー**: AST生成（def, class, if/elsif/else, while, ブロック、メソッド呼び出し）
- **YARVバイトコードコンパイラ**: 20以上の命令（putobject, send, getlocal, setlocal, branchif, jump等）
- **スタックベースVM**: コールフレーム、ローカル変数テーブル、メソッドディスパッチ
- **Rubyオブジェクトモデル**: 全てがオブジェクト、クラス階層（Object → サブクラス）
- **ブロックとyield**: do..end および {..} ブロック
- **組み込みメソッド**: puts, print, to_s, to_i, length, push, each, map, times
- **ブラウザUI**: コードエディタ、トークン表示、AST表示、バイトコード逆アセンブリ、ステップ実行

## セットアップ

```bash
npm install
npm run dev     # 開発サーバー起動
npm run build   # ビルド
npm test        # テスト実行
npm run test:watch  # テスト監視モード
```
