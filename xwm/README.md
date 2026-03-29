# X Window Manager Simulator

TypeScript で実装した X Window System + ウィンドウマネージャのシミュレータ。Xサーバ、X11プロトコル、ウィンドウマネージャ (twm風) をブラウザ上の Canvas で可視化する。

## 起動方法

```bash
cd xwm
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

## テスト

```bash
npm test
```

## 試せること (10 シナリオ)

### 1. デスクトップ起動
起動直後に xterm, xclock, xeyes の3つのアプリが自動起動する。タイトルバー、閉じる/最大化/最小化ボタン付きの装飾ウィンドウが表示される。

### 2. ウィンドウの移動
タイトルバーをドラッグしてウィンドウを移動できる。X11 の ConfigureNotify イベントが発行され、右のログに表示される。

### 3. ウィンドウのリサイズ
ウィンドウ右下の三角グリップをドラッグしてサイズ変更。最小サイズ制限 (100x60) あり。

### 4. フォーカス管理
ウィンドウをクリックするとフォーカスが移る。フォーカス中のウィンドウはタイトルバーが青色に変わり、最前面に来る。X11 の FocusIn/FocusOut イベントがログに表示される。

### 5. スロッピーフォーカス
ヘッダーのドロップダウンで「sloppy (follow mouse)」を選択。マウスカーソルが乗ったウィンドウに自動的にフォーカスが移る (クリック不要)。

### 6. アプリ起動 (ホットプラグ)
ヘッダーの xterm / xclock / xeyes / xedit ボタンでアプリを追加起動。MapRequest → WM がフレーミング → MapNotify の流れがログに表示される。

### 7. ウィンドウを閉じる
タイトルバー右の赤い ✕ ボタンをクリック。WM_DELETE_WINDOW ClientMessage → UnmapNotify → DestroyNotify のプロトコルシーケンスがログに出る。

### 8. 最大化・最小化
緑ボタン (最大化) で画面いっぱいに拡大。もう一度押すと元のサイズに復元。黄色ボタン (最小化) でウィンドウを隠す。タスクバーから復元可能。

### 9. タスクバー
画面下部のタスクバーに管理中の全ウィンドウが表示される。最小化されたウィンドウは [括弧付き] で表示。クリックでフォーカス/復元。

### 10. X11 イベントログ
右サイドバーに X プロトコルイベントがリアルタイム表示される。CreateWindow, MapRequest, MapNotify, ConfigureNotify, FocusIn/Out, DestroyNotify など。

## アーキテクチャ

```
src/
  hw/hardware.ts       ← フレームバッファ / キーボード / マウス (物理層)
  x11/protocol.ts      ← Xサーバ / ウィンドウ階層 / X11イベント / クライアント接続
  wm/manager.ts        ← ウィンドウマネージャ (装飾 / 移動 / リサイズ / フォーカス)
  clients/apps.ts      ← サンプルXクライアント (xterm / xclock / xeyes / xedit)
  ui/app.ts            ← ブラウザ UI (Canvas レンダリング)
  __tests__/xwm.test.ts ← テスト (24ケース)
```

### レイヤー構成

```
┌─────────────────────────────────────┐
│  Canvas UI (app.ts)                 │  レンダリングループ / マウスイベント変換
├─────────────────────────────────────┤
│  Window Manager (manager.ts)        │  フレーミング / 移動 / リサイズ / フォーカス
├─────────────────────────────────────┤
│  X Server (protocol.ts)             │  ウィンドウ階層 / イベント配信 / プロパティ
│  ├ MapRequest / ConfigureRequest    │  SubstructureRedirect → WM
│  ├ Expose / FocusIn / FocusOut      │  クライアントイベント
│  └ ButtonPress / MotionNotify       │  入力イベント
├─────────────────────────────────────┤
│  X Clients (apps.ts)                │  xterm / xclock / xeyes / xedit
├─────────────────────────────────────┤
│  Hardware (hardware.ts)             │  Framebuffer / Mouse / Keyboard
└─────────────────────────────────────┘
```
