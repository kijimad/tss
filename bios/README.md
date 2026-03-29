# BIOS / POST シミュレータ

ブラウザ上で PC の電源投入から OS 起動までの全過程を再現する。CPU 検出、メモリテスト、PCI バス列挙、MBR 読み込み、ブートジャンプの各ステップを可視化。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **上部**: 「Power ON (normal)」で正常起動、「Power ON (faulty RAM)」でメモリ故障シミュレーション。Speed スライダーで速度調整
- **左**: BIOS 画面（実際の POST 画面を模したテキスト出力）
- **右**: ハードウェア検出リスト（各デバイスのステータス）

## POST シーケンス

```
電源 ON
  ↓
CPU リセットベクタ (0xFFFF:FFF0) → BIOS ROM にジャンプ
  ↓
POST (Power-On Self Test)
  ├── CPU テスト
  ├── BIOS ROM チェックサム検証
  ├── CMOS/RTC 読み取り
  ├── DMA コントローラ初期化
  ├── メモリテスト (パターン: 0x00, 0xFF, 0x55, 0xAA)
  ├── PIC (割り込みコントローラ) 初期化
  ├── PIT (タイマー) 初期化
  └── キーボードコントローラテスト → 1 short beep = POST OK
  ↓
ビデオ初期化 (GPU の BIOS を実行)
  ↓
PCI バス列挙 (全デバイスを Bus:Device.Function でスキャン)
  ↓
USB デバイス検出
  ↓
ストレージデバイス検出
  ↓
ブートデバイス選択 (CMOS のブートオーダーに従う)
  ↓
MBR (先頭 512 バイト) 読み込み + シグネチャ検証 (0x55AA)
  ↓
ブートローダーにジャンプ (0x0000:7C00) → OS 起動
```

## エミュレートするハードウェア

| コンポーネント | 仕様 |
|--------------|------|
| マザーボード | ASUS ROG STRIX Z790-E |
| CPU | Intel Core i7-13700K (16C/24T, 3.4GHz) |
| RAM | G.Skill DDR5-5600 16GB x2 (32GB) |
| GPU | NVIDIA GeForce RTX 4090 + Intel UHD 770 |
| NVMe SSD | Samsung 980 PRO 1TB (ブートディスク) |
| SATA SSD | Crucial MX500 2TB |
| NIC | Intel I225-V 2.5GbE |
| USB | Logitech キーボード + マウス |
| オーディオ | Intel Alder Lake HD Audio |

---

## 実験

### 実験 1: 正常起動

1. 「Power ON (normal)」をクリック
2. POST が順に進行:
   - CPU 検出: Intel Core i7-13700K
   - メモリテスト: 32768MB (32GB)
   - PCI デバイス列挙: GPU, NIC, USB, Audio 等
   - ブートデバイス: Samsung 980 PRO
   - MBR シグネチャ: 0x55AA (valid)
   - ブートジャンプ: 0x0000:7C00
3. 「OS Boot Sequence Started」で完了

---

### 実験 2: メモリ故障

1. 「Power ON (faulty RAM)」をクリック
2. メモリテスト中に DIMM A1 で `[FAIL]` が表示される
3. ビープ音: `long-short-short` (3回 = メモリエラー)
4. `ERROR 0x0D: Memory error in DIMM A1`
5. `SYSTEM HALTED` — OS は起動しない

---

### 実験 3: PCI バス列挙を観察する

正常起動時の PCI 列挙セクション:
```
[00:02] Intel [8086:4680]       UHD Graphics 770 (VGA Compatible Controller)
[01:00] NVIDIA [10de:2684]      GeForce RTX 4090 (3D Controller)
[03:00] Intel [8086:15f3]       I225-V 2.5GbE (Ethernet Controller)
[04:00] Intel [8086:a0b0]       USB 3.2 xHCI (USB Controller)
[00:1f] Intel [8086:7a04]       Z790 LPC/eSPI (ISA Bridge)
[00:1f] Intel [8086:7ad0]       Alder Lake-S HD Audio (Audio Device)
```

各デバイスの Bus:Device、ベンダID:デバイスID、デバイス名が表示される。

---

### 実験 4: ブートオーダー

CMOS 設定のブートオーダー: `nvme0 → ssd1 → cdrom → usb → network`

1. nvme0 (Samsung 980 PRO) → MBR あり → ここからブート
2. ssd1, cdrom, usb → チェックされない（最初のブート可能デバイスで決定）

---

### 実験 5: MBR の検証

MBR (Master Boot Record) の構造:
```
Offset 0x000: ブートローダーコード (446 bytes)
Offset 0x1BE: パーティションテーブル (64 bytes)
Offset 0x1FE: シグネチャ 0x55AA (2 bytes)
```

シグネチャ `0x55AA` がないディスクはブート不可。

---

### 実験 6: POST ビープコードの意味

| パターン | 回数 | 意味 |
|---------|------|------|
| short | 1 | POST 正常完了 |
| long-short-short | 3 | メモリエラー |
| (continuous) | ∞ | 電源異常 |
| long-long-long | 3 | キーボード不良 |

実際の BIOS ではビープ音のパターンでエラー箇所を特定できる。

---

### 実験 7: CPU 情報

```
CPU        Intel Core i7-13700K @ 3400MHz (16C/24T)    [ OK ]
CPU Cache  L1: 80KB  L2: 2048KB  L3: 30720KB
Features: SSE4.2, AVX2, AES-NI, VT-x, VT-d, Hyper-Threading
```

VT-x は仮想化支援。Docker や VM を動かすのに必要。

---

### 実験 8: Speed スライダー

- 0: 即座に完了（テスト用）
- 50: 適度な速度で POST の進行が見える
- 300: 遅い（実際の BIOS 起動に近い体感）

---

### 実験 9: BIOS と UEFI の違い

このシミュレータは従来の BIOS (Legacy BIOS) を模している:

| BIOS | UEFI |
|------|------|
| MBR でブート | GPT でブート |
| 16ビットリアルモード | 32/64ビットモード |
| テキスト画面 | GUI 設定画面 |
| 2TB ディスク制限 | 制限なし |
| セキュアブートなし | セキュアブート対応 |

---

### 実験 10: 右パネルのハードウェア検出

右パネルには検出された全デバイスが表示される:
- ✓ 緑: 正常
- ✗ 赤: 故障
- PCI: バス番号とデバイス名

ここを見ることで「BIOS が何を見つけたか」が一目で分かる。

---

## 実際の BIOS との違い

| 実際の BIOS | このシミュレータ |
|------------|-----------------|
| ROM チップ上の機械語 | TypeScript の関数 |
| x86 リアルモードで動作 | ブラウザ上で動作 |
| 割り込み 0x10 でビデオ出力 | DOM 操作 |
| 割り込み 0x13 でディスク読み取り | メモリ上の配列 |
| CMOS は電池で保持 | 変数で保持 |
| POST に数秒かかる | 即座に完了（遅延はシミュレーション） |
