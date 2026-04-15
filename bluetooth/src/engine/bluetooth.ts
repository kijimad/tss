/**
 * bluetooth.ts — Bluetooth / BLE エミュレーションエンジン
 *
 * ═══════════════════════════════════════════════════════════════
 * Bluetooth とは
 * ═══════════════════════════════════════════════════════════════
 *
 * Bluetooth は 2.4GHz ISM 帯を使う近距離無線通信規格。
 * 大きく 2 系統がある:
 *
 *   (A) Bluetooth Classic (BR/EDR) — 音声・大容量データ向け (最大 3Mbps)
 *   (B) Bluetooth Low Energy (BLE)  — IoT・センサー向け (低消費電力)
 *
 * 本シミュレーターは主に BLE (4.0 以降) を対象とする。
 *
 * ═══════════════════════════════════════════════════════════════
 * BLE プロトコルスタック (下から上へ)
 * ═══════════════════════════════════════════════════════════════
 *
 *   ┌─────────────────────────────────────────┐
 *   │  アプリケーション (App)                  │  ← ユーザーロジック
 *   ├────────────────┬────────────────────────┤
 *   │  GAP           │  GATT                  │  ← プロファイル層
 *   │ (接続管理)      │ (データモデル)           │
 *   ├────────────────┼────────────────────────┤
 *   │  SMP           │  ATT                   │  ← セキュリティ / 属性
 *   │ (ペアリング)    │ (属性プロトコル)         │
 *   ├────────────────┴────────────────────────┤
 *   │  L2CAP  (論理チャネル多重化)              │
 *   ├─────────────────────────────────────────┤
 *   │  HCI    (Host ↔ Controller インタフェース)│
 *   ├─────────────────────────────────────────┤
 *   │  Link Layer (アドバタイズ/接続制御)        │
 *   ├─────────────────────────────────────────┤
 *   │  Physical Layer (2.4GHz 無線)            │
 *   └─────────────────────────────────────────┘
 *
 * 各層の役割:
 *   - Physical Layer: 2.4GHz の 40 チャネル (うち 3 がアドバタイズ用)
 *   - Link Layer: パケット送受信、接続状態管理
 *   - HCI: ホスト (OS) とコントローラー (チップ) の標準インタフェース
 *   - L2CAP: 論理チャネルの多重化 (CID=0x0004: ATT, CID=0x0006: SMP)
 *   - ATT (Attribute Protocol): 属性の読み書き操作を定義
 *   - GATT (Generic Attribute Profile): Service/Characteristic のデータモデル
 *   - SMP (Security Manager Protocol): ペアリング・鍵交換・暗号化
 *   - GAP (Generic Access Profile): デバイス検出・接続管理のロール定義
 *
 * ═══════════════════════════════════════════════════════════════
 * BLE 通信の全体フロー
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. アドバタイズ — ペリフェラルが ch37/38/39 でパケットをブロードキャスト
 *   2. スキャン      — セントラルがアドバタイズを受信しデバイスを検出
 *   3. 接続         — セントラルが CONNECT_IND を送信 → 1:1 リンク確立
 *   4. MTU 交換     — ATT の最大転送単位をネゴシエーション (デフォルト 23B)
 *   5. PHY 更新     — BLE 5.0+ で 2M/Coded に切り替え (オプション)
 *   6. ペアリング    — SMP で鍵交換 → 暗号化開始 (オプション)
 *   7. サービス検出  — GATT Discover で Service/Characteristic を列挙
 *   8. 読み書き      — ATT Read/Write で Characteristic の値を操作
 *   9. 通知         — CCCD を有効にすると、ペリフェラルから値変更を自動受信
 *  10. 切断         — いずれかが Disconnect を送信しリンク解放
 *
 * ═══════════════════════════════════════════════════════════════
 * GATT のデータモデル
 * ═══════════════════════════════════════════════════════════════
 *
 *   Profile (プロファイル)
 *     └─ Service (サービス) — 機能の論理グループ (例: Heart Rate Service)
 *          └─ Characteristic (キャラクタリスティック) — 1 つのデータ値
 *               ├─ Value — 実際の値 (例: 心拍数 72bpm)
 *               └─ Descriptor — メタ情報 (例: CCCD で通知ON/OFF)
 *
 *   各要素は UUID で識別される:
 *     - 16-bit UUID: Bluetooth SIG が標準化 (例: 0x180D = Heart Rate)
 *     - 128-bit UUID: ベンダー独自サービス用
 *
 * ═══════════════════════════════════════════════════════════════
 * GAP ロール
 * ═══════════════════════════════════════════════════════════════
 *
 *   - セントラル (Central): スキャンして接続を開始する側 (例: スマートフォン)
 *   - ペリフェラル (Peripheral): アドバタイズして接続を待つ側 (例: センサー)
 *   - オブザーバー (Observer): スキャンのみ (接続しない)
 *   - ブロードキャスター (Broadcaster): アドバタイズのみ (接続不可, 例: ビーコン)
 *
 * ═══════════════════════════════════════════════════════════════
 * ペアリングとボンディング
 * ═══════════════════════════════════════════════════════════════
 *
 *   ペアリング: 一時的な暗号化鍵を生成し通信を暗号化する手続き
 *   ボンディング: ペアリングで生成した LTK (Long Term Key) を永続保存し、
 *                 次回接続時に再ペアリングなしで暗号化を再開できるようにすること
 *
 *   ペアリング方式 (IO Capability の組み合わせで決定):
 *     - Just Works:          MITM 保護なし。操作不要で最も手軽
 *     - Passkey Entry:       片方が 6 桁を表示、もう片方が入力。MITM 保護あり
 *     - Numeric Comparison:  両方に 6 桁表示、一致を確認。BLE 4.2+ の推奨方式
 *     - OOB (Out of Band):   NFC 等の別経路で鍵情報を交換。最も安全
 *
 * ═══════════════════════════════════════════════════════════════
 * PHY (物理層) — BLE 5.0 で追加
 * ═══════════════════════════════════════════════════════════════
 *
 *   - 1M PHY:     1Mbps (BLE 4.x 互換、デフォルト)
 *   - 2M PHY:     2Mbps (高速、到達距離は短い)
 *   - Coded PHY:  125kbps (S=8) or 500kbps (S=2)、FEC 付きで到達距離 ×4
 */

// ══════════════════════════════════════════════════════════════
// 基本型
// ══════════════════════════════════════════════════════════════

/**
 * Bluetooth デバイスアドレス (BD_ADDR)
 *
 * 48-bit のアドレスで、"AA:BB:CC:DD:EE:FF" 形式の文字列で表現する。
 * BLE では以下の 2 種類がある:
 *   - Public Address: IEEE が割り当てた固定アドレス (MAC アドレスに相当)
 *   - Random Address: デバイスが生成するアドレス (プライバシー保護用)
 */
export type BdAddr = string;

/**
 * UUID (Universally Unique Identifier)
 *
 * GATT の Service / Characteristic を一意に識別する。
 *   - 16-bit UUID: Bluetooth SIG 標準規格 (例: "180d" = Heart Rate Service)
 *   - 128-bit UUID: ベンダー独自定義 (例: "0000fee0-0000-1000-8000-00805f9b34fb")
 *
 * 16-bit UUID は Bluetooth Base UUID に埋め込まれている:
 *   0000XXXX-0000-1000-8000-00805f9b34fb (XXXX が 16-bit 部分)
 */
export type UUID = string;

/**
 * Bluetooth コア仕様バージョン
 *
 * 主な違い:
 *   - 4.0: BLE 初登場
 *   - 4.2: LE Secure Connections (ECDH ベースペアリング)、LE Data Length Extension
 *   - 5.0: 2M PHY / Coded PHY 追加、アドバタイズ拡張
 *   - 5.2: LE Audio (LC3 コーデック)、Isochronous Channels
 *   - 5.3: Connection Subrating、Channel Classification Enhancement
 */
export type BtVersion = "4.0" | "4.2" | "5.0" | "5.2" | "5.3";

/**
 * PHY (Physical Layer) タイプ
 *
 *   - "1M":       LE 1M PHY — 1Mbps、BLE 4.x からの標準 PHY
 *   - "2M":       LE 2M PHY — 2Mbps、高スループットだが到達距離が短い
 *   - "Coded-S2": LE Coded PHY (S=2) — 500kbps、FEC で到達距離 ×2
 *   - "Coded-S8": LE Coded PHY (S=8) — 125kbps、FEC で到達距離 ×4
 *
 * BLE 5.0 以降で 2M / Coded が利用可能。接続後に PHY Update で切替可能。
 */
export type PhyType = "1M" | "2M" | "Coded-S2" | "Coded-S8";

/**
 * アドバタイズ PDU タイプ (Link Layer)
 *
 *   - ADV_IND:          接続可能・スキャン可能 (最も一般的)
 *   - ADV_DIRECT_IND:   特定デバイスに直接接続要求 (高速再接続用)
 *   - ADV_NONCONN_IND:  接続不可 (ビーコン等のブロードキャスト専用)
 *   - ADV_SCAN_IND:     接続不可だがスキャン応答あり (追加データ取得可)
 *   - ADV_EXT_IND:      BLE 5.0 拡張アドバタイズ (254B 超のデータ送信可)
 */
export type AdvType = "ADV_IND" | "ADV_DIRECT_IND" | "ADV_NONCONN_IND" | "ADV_SCAN_IND" | "ADV_EXT_IND";

/**
 * ペアリング方式 (SMP)
 *
 * 両デバイスの IO Capability (入出力能力) の組み合わせで自動決定される。
 * BT Spec Vol 3 Part H Table 2.8 に対応表がある。
 *
 *   - "just-works":          操作不要。MITM 保護なし (傍受に脆弱)
 *   - "passkey":             片方が表示した 6 桁を他方に入力。MITM 保護あり
 *   - "numeric-comparison":  両方に 6 桁表示→ユーザーが一致確認。BLE 4.2+ 推奨
 *   - "oob":                 NFC 等の帯域外通信で鍵を交換。最高セキュリティ
 */
export type PairingMethod = "just-works" | "passkey" | "numeric-comparison" | "oob";

/**
 * BLE 接続状態マシン
 *
 *   disconnected → advertising (ペリフェラル) / scanning (セントラル)
 *     → connecting → connected → paired → bonded
 *                                  ↑              │
 *                                  └──切断→ disconnected
 *
 *   - paired:  一時的な暗号化鍵で通信中
 *   - bonded:  LTK を永続保存済み (次回接続時に再ペアリング不要)
 */
export type ConnectionState = "disconnected" | "advertising" | "scanning" | "connecting" | "connected" | "paired" | "bonded";

/**
 * GATT Characteristic のアクセス権限
 *
 *   - "read":              セントラルから値を読み取り可能
 *   - "write":             セントラルから値を書き込み可能 (応答あり)
 *   - "write-no-response": 書き込み可能 (応答なし、高速だが到達保証なし)
 *   - "notify":            ペリフェラルから値変更を通知 (確認応答なし)
 *   - "indicate":          ペリフェラルから値変更を通知 (確認応答あり、信頼性高)
 */
export type CharPermission = "read" | "write" | "write-no-response" | "notify" | "indicate";

// ══════════════════════════════════════════════════════════════
// GATT (Generic Attribute Profile) 構造
// ══════════════════════════════════════════════════════════════
//
// GATT は BLE のデータモデルを定義するプロファイル。
// ATT (Attribute Protocol) の上に構築され、データを階層的に整理する:
//
//   Profile → Service → Characteristic → Descriptor
//
// 例: Heart Rate Profile
//   └─ Heart Rate Service (0x180D)
//        ├─ Heart Rate Measurement (0x2A37) [notify]
//        │    └─ CCCD (0x2902) — 通知の ON/OFF を制御
//        └─ Body Sensor Location (0x2A38) [read]
//
// ATT ハンドル: 各属性にはサーバー内で一意の 16-bit ハンドルが割り当てられ、
// クライアントはハンドルを指定して Read/Write を行う。

/**
 * GATT Characteristic (キャラクタリスティック)
 *
 * GATT の最小データ単位。1 つの値と、その値のメタ情報 (Descriptor) を持つ。
 * 例: "Heart Rate Measurement" は心拍数の値を保持し、notify で変更を通知する。
 */
export interface GattCharacteristic {
  uuid: UUID;
  name: string;
  /** アクセス権限 — read/write/notify 等の組み合わせ */
  permissions: CharPermission[];
  /** 現在の値 (hex 文字列)。ATT ペイロードとしてそのまま送受信される */
  value: string;
  /** 値の人間可読表現 (例: "72 bpm", "20.0°C") */
  displayValue: string;
  /** CCCD (Client Characteristic Configuration Descriptor) で通知が有効化されたか */
  notifying: boolean;
  /** Descriptor 一覧。CCCD (0x2902) が代表的 */
  descriptors: GattDescriptor[];
}

/**
 * GATT Descriptor (記述子)
 *
 * Characteristic のメタ情報を提供する属性。
 * 最も重要なのは CCCD (0x2902):
 *   - 0x0000: 通知/表示 OFF
 *   - 0x0001: Notification ON (確認応答なし)
 *   - 0x0002: Indication ON (確認応答あり)
 */
export interface GattDescriptor {
  uuid: UUID;
  name: string;
  value: string;
}

/**
 * GATT Service (サービス)
 *
 * 関連する Characteristic をグループ化した論理単位。
 * Bluetooth SIG が多数の標準サービスを定義している:
 *   - 0x180D: Heart Rate Service
 *   - 0x180F: Battery Service
 *   - 0x181A: Environmental Sensing Service
 *
 * primary=true はトップレベルサービス、false は他サービスに包含される副次サービス。
 */
export interface GattService {
  uuid: UUID;
  name: string;
  /** プライマリサービスか。ほとんどの場合 true */
  primary: boolean;
  characteristics: GattCharacteristic[];
}

/**
 * GATT プロファイル
 *
 * デバイスが提供するサービスの全体集合。
 * 接続後に "Discover All Primary Services" で取得される。
 */
export interface GattProfile {
  services: GattService[];
}

// ══════════════════════════════════════════════════════════════
// デバイス定義
// ══════════════════════════════════════════════════════════════

/**
 * アドバタイズデータ (AD Structure)
 *
 * ペリフェラルがアドバタイズパケットに載せるデータ。
 * BLE 4.x では最大 31 バイト、BLE 5.0 拡張アドバタイズでは最大 254 バイト。
 *
 * パケット構造: [Length][AD Type][AD Data] の繰り返し。
 * 代表的な AD Type:
 *   - 0x01: Flags (BR/EDR 非対応、一般検出可能等)
 *   - 0x09: Complete Local Name
 *   - 0x0A: Tx Power Level
 *   - 0xFF: Manufacturer Specific Data
 */
export interface AdvData {
  /** ローカル名 (AD Type 0x09)。スキャン結果に表示される */
  localName: string;
  /**
   * 送信電力 (dBm, AD Type 0x0A)
   *
   * RSSI との差分で距離を推定できる:
   *   距離 ≈ 10^((txPower - RSSI) / (10 * n))  (n=2: 自由空間)
   */
  txPower: number;
  /** アドバタイズに含まれるサービス UUID リスト (AD Type 0x02/0x03/0x06/0x07) */
  serviceUuids: UUID[];
  /** メーカー固有データ (AD Type 0xFF, hex)。最初の 2 バイトが Company ID */
  manufacturerData?: string;
  /** サービスデータ (AD Type 0x16)。UUID + ペイロードの組 */
  serviceData?: { uuid: UUID; data: string }[];
  /**
   * フラグ (AD Type 0x01)
   *
   * ビットフィールド:
   *   bit 0: LE Limited Discoverable Mode
   *   bit 1: LE General Discoverable Mode
   *   bit 2: BR/EDR Not Supported
   *   典型値 0x06 = General Discoverable + BR/EDR Not Supported
   */
  flags: number;
}

/**
 * BLE デバイス
 *
 * セントラル / ペリフェラル両方をこの型で表現する。
 * 実機では HCI コマンドでこれらのパラメータを設定する。
 */
export interface BleDevice {
  address: BdAddr;
  name: string;
  version: BtVersion;
  /** 対応 PHY。接続後に PHY Update Request で切替可能 */
  supportedPhy: PhyType[];
  /**
   * RSSI (Received Signal Strength Indicator, dBm)
   *
   * 受信信号強度。距離が遠いほど小さくなる。
   * 典型値: 0.5m → -50dBm, 3m → -65dBm, 30m → -90dBm
   */
  rssi: number;
  /** デバイス間の距離 (メートル)。RSSI 計算に使用 */
  distance: number;
  advData: AdvData;
  /**
   * アドバタイズ間隔 (ms)
   *
   * ペリフェラルがアドバタイズパケットを送信する周期。
   * 短い → 検出が速いが消費電力増。典型値: 20ms〜10240ms。
   * Apple iBeacon 推奨: 100ms。
   */
  advInterval: number;
  advType: AdvType;
  gattProfile: GattProfile;
  /**
   * IO Capability (入出力能力)
   *
   * SMP ペアリング時に、どのペアリング方式を使えるかを決定する:
   *   - "display-only":    画面あり・入力なし (Passkey 表示側)
   *   - "display-yesno":   画面あり・Yes/No 入力 (Numeric Comparison 可)
   *   - "keyboard-only":   キーボードのみ (Passkey 入力側)
   *   - "keyboard-display": 両方 (最も柔軟)
   *   - "no-io":           入出力なし → Just Works しか使えない
   */
  ioCap: "display-only" | "display-yesno" | "keyboard-only" | "keyboard-display" | "no-io";
  /** ボンディング済みの LTK (Long Term Key)。保存済みなら再接続時に再ペアリング不要 */
  bondKey?: string;
  /** 接続可能か。false ならブロードキャスト専用 (ビーコン等) */
  connectable: boolean;
  /**
   * ATT MTU (Maximum Transmission Unit)
   *
   * 1 回の ATT 操作で送受信できる最大バイト数。
   * デフォルト 23B (BLE 4.x)。MTU Exchange で最大 517B まで拡張可能。
   * 実効ペイロード = MTU - 3 (ATT ヘッダ分)。
   */
  mtu: number;
}

/**
 * L2CAP (Logical Link Control and Adaptation Protocol) パケット
 *
 * L2CAP は BLE スタック内で論理チャネルの多重化を担う。
 * BLE の固定チャネル:
 *   - CID 0x0004: ATT (属性プロトコル)
 *   - CID 0x0005: LE Signaling (接続パラメータ更新要求等)
 *   - CID 0x0006: SMP (セキュリティマネージャ)
 *
 * パケット構造: [Length(2B)][CID(2B)][Payload]
 */
export interface L2capPacket {
  /** チャネル ID (CID)。BLE では固定チャネルが主 */
  cid: number;
  channelName: string;
  /** ペイロード長 (バイト) */
  length: number;
  /** ペイロード概要 (可読表現) */
  payload: string;
}

/**
 * HCI (Host Controller Interface) イベント
 *
 * HCI はホスト (OS/ソフトウェア) とコントローラー (BLE チップ) の境界。
 * ホストが HCI コマンドを送り、コントローラーが HCI イベントを返す。
 *
 * 主要イベント:
 *   - 0x0E: Command Complete — コマンド正常完了
 *   - 0x05: Disconnection Complete — 切断完了
 *   - 0x3E: LE Meta Event — BLE 固有イベントのコンテナ
 *     - sub=0x01: LE Connection Complete
 *     - sub=0x02: LE Advertising Report
 */
export interface HciEvent {
  /** HCI イベントコード */
  eventCode: number;
  name: string;
  params: string;
}

/**
 * シミュレーションイベント
 *
 * プロトコルスタックの各層で発生するイベントを時系列で記録する。
 * UI ではプロトコルトレースとして表示される。
 */
export interface SimEvent {
  /** シミュレーション時刻 (ms) */
  time: number;
  /** 発生したプロトコル層 */
  layer: "Radio" | "HCI" | "L2CAP" | "ATT" | "GATT" | "SMP" | "GAP" | "App";
  /** イベント種別 */
  type: "adv" | "scan" | "connect" | "pair" | "gatt_discover" | "gatt_read" | "gatt_write" | "gatt_notify" | "disconnect" | "error" | "info";
  /**
   * データの流れの方向
   *   "→" セントラル → ペリフェラル (要求)
   *   "←" ペリフェラル → セントラル (応答)
   *   "●" ローカルイベント (状態変化の通知)
   */
  direction: "→" | "←" | "●";
  /** イベントの詳細説明 */
  detail: string;
  /** L2CAP パケット情報 (パケットを伴うイベントの場合) */
  packet?: L2capPacket;
  /** HCI イベント情報 (HCI 層のイベントの場合) */
  hci?: HciEvent;
}

/**
 * シミュレーション設定
 *
 * 1 回のシミュレーション実行に必要な全パラメータを定義する。
 * プリセット (EXPERIMENTS) からこの設定を生成し、BluetoothSimulator.simulate() に渡す。
 */
export interface SimConfig {
  /** セントラル (スキャナー/クライアント) デバイス */
  central: BleDevice;
  /** ペリフェラル (アドバタイザー/サーバー) デバイス */
  peripheral: BleDevice;
  /** 使用する PHY */
  phy: PhyType;
  /** ペアリングを行うか */
  pairing: boolean;
  /** ペアリング方式 (ペアリング時) */
  pairingMethod: PairingMethod;
  /** 読み込む Characteristic UUID リスト */
  readCharacteristics: UUID[];
  /** 書き込む Characteristic (UUID→値) */
  writeCharacteristics: { uuid: UUID; value: string; displayValue: string }[];
  /** 通知を有効にする Characteristic UUID リスト */
  enableNotifications: UUID[];
  /** 通知で受信するデータ */
  notificationValues: { uuid: UUID; value: string; displayValue: string }[];
  /** 環境ノイズレベル (dBm) */
  noiseFloor: number;
  /** シミュレーション遅延基準 (ms) */
  latencyMs: number;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  finalState: ConnectionState;
  /** 検出されたサービス */
  discoveredServices: GattService[];
  /** 読み取った値 */
  readValues: { uuid: UUID; name: string; value: string; displayValue: string }[];
  /** 受信した通知 */
  notifications: { uuid: UUID; name: string; value: string; displayValue: string }[];
  totalTime: number;
  /** 接続パラメータ */
  connectionParams?: { interval: number; latency: number; timeout: number; mtu: number; phy: PhyType };
}

// ══════════════════════════════════════════════════════════════
// ユーティリティ
// ══════════════════════════════════════════════════════════════

/**
 * RSSI を距離から推定する (Free-space path loss 簡易モデル)
 *
 * FSPL モデル: RSSI = txPower - 10 * n * log10(d)
 *   - txPower: 1m 地点での受信電力 (校正値, dBm)
 *   - d: 距離 (メートル)
 *   - n: 経路損失指数 (自由空間=2, 室内=2.5〜4)
 *
 * ここでは n=2 (自由空間) を仮定。
 * 実環境では壁・人体・マルチパス等で大きくずれる。
 */
export function rssiFromDistance(txPower: number, distanceM: number): number {
  if (distanceM <= 0) return txPower;
  // RSSI = txPower - 10 * n * log10(d) — n=2 (自由空間)
  return Math.round(txPower - 20 * Math.log10(distanceM));
}

/** ランダム BD_ADDR を生成する */
export function randomBdAddr(): BdAddr {
  const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return `${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`;
}

/**
 * ペアリング方式を IO Capability から決定する
 *
 * BT Core Spec Vol 3, Part H, Table 2.8 の簡易版。
 * 両デバイスの IO Capability (入出力能力) の組み合わせから
 * 最もセキュアなペアリング方式を選択する:
 *
 *               │ DisplayOnly │ DisplayYesNo │ KeyboardOnly │ KbDisplay │ NoIO
 *   ────────────┼─────────────┼──────────────┼──────────────┼───────────┼──────
 *   DisplayOnly │ JustWorks   │ JustWorks    │ Passkey      │ Passkey   │ JW
 *   DisplayYesNo│ JustWorks   │ NumComp      │ Passkey      │ NumComp   │ JW
 *   KeyboardOnly│ Passkey     │ Passkey      │ Passkey      │ Passkey   │ JW
 *   KbDisplay   │ Passkey     │ NumComp      │ Passkey      │ NumComp   │ JW
 *   NoIO        │ JustWorks   │ JustWorks    │ JustWorks    │ JustWorks │ JW
 */
export function determinePairingMethod(centralIo: BleDevice["ioCap"], peripheralIo: BleDevice["ioCap"]): PairingMethod {
  // BT Spec Vol 3 Part H Table 2.8 の簡易版
  if (centralIo === "no-io" || peripheralIo === "no-io") return "just-works";
  if (centralIo === "keyboard-display" && peripheralIo === "display-yesno") return "numeric-comparison";
  if (centralIo === "display-yesno" && peripheralIo === "display-yesno") return "numeric-comparison";
  if (centralIo === "keyboard-only" || peripheralIo === "keyboard-only") return "passkey";
  if (centralIo === "keyboard-display" || peripheralIo === "keyboard-display") return "passkey";
  return "just-works";
}

/**
 * 16-bit UUID を 128-bit Bluetooth Base UUID に展開する
 *
 * Bluetooth Base UUID: 00000000-0000-1000-8000-00805F9B34FB
 * 16-bit UUID は [4..8] の位置に埋め込まれる:
 *   expandUuid("180d") → "0000180d-0000-1000-8000-00805f9b34fb"
 */
export function expandUuid(short: string): UUID {
  if (short.length > 8) return short;
  return `0000${short.padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
}

// ══════════════════════════════════════════════════════════════
// 既知の UUID
// ══════════════════════════════════════════════════════════════
//
// Bluetooth SIG が割り当てた標準 16-bit UUID のうち主要なもの。
// 全一覧は https://www.bluetooth.com/specifications/assigned-numbers/ で公開されている。
//
// UUID の範囲:
//   0x1800–0x18FF: GATT Service UUID (Generic Access, Heart Rate 等)
//   0x2A00–0x2AFF: GATT Characteristic UUID (Device Name, Battery Level 等)
//   0x2900–0x29FF: GATT Descriptor UUID (CCCD 等)

export const KNOWN_UUIDS: Record<string, string> = {
  "1800": "Generic Access",
  "1801": "Generic Attribute",
  "180a": "Device Information",
  "180d": "Heart Rate",
  "180f": "Battery Service",
  "1810": "Blood Pressure",
  "1816": "Cycling Speed and Cadence",
  "181a": "Environmental Sensing",
  "2a00": "Device Name",
  "2a01": "Appearance",
  "2a19": "Battery Level",
  "2a24": "Model Number String",
  "2a25": "Serial Number String",
  "2a26": "Firmware Revision",
  "2a27": "Hardware Revision",
  "2a28": "Software Revision",
  "2a29": "Manufacturer Name",
  "2a37": "Heart Rate Measurement",
  "2a38": "Body Sensor Location",
  "2a6e": "Temperature",
  "2a6f": "Humidity",
  "2902": "CCCD",
};

/** UUID の表示名を取得する */
export function uuidName(uuid: UUID): string {
  const short = uuid.length <= 8 ? uuid : uuid.slice(4, 8);
  return KNOWN_UUIDS[short.toLowerCase()] ?? uuid;
}

// ══════════════════════════════════════════════════════════════
// シミュレーター
// ══════════════════════════════════════════════════════════════
//
// BLE 通信の全フローを 12 ステップでシミュレートする。
// 各ステップは実際のプロトコルスタックの動作を反映し、
// HCI コマンド/イベント、L2CAP パケット、ATT オペコードを
// 可能な限り忠実に再現する。
//
// シミュレーション全体フロー:
//
//   ステップ 1:  アドバタイズ (ペリフェラルが ch37/38/39 でブロードキャスト)
//   ステップ 2:  スキャン (セントラルが SCAN_REQ → SCAN_RSP で追加情報取得)
//   ステップ 3:  接続 (CONNECT_IND → Connection Complete)
//   ステップ 4:  MTU 交換 (ATT Exchange MTU Request/Response)
//   ステップ 5:  PHY 更新 (BLE 5.0+、オプション)
//   ステップ 6:  ペアリング (SMP Pairing Request/Response → 鍵交換、オプション)
//   ステップ 7:  GATT サービス検出 (Discover All Primary Services)
//   ステップ 8:  Characteristic 読み取り (ATT Read Request/Response)
//   ステップ 9:  Characteristic 書き込み (ATT Write Request/Response)
//   ステップ 10: 通知有効化 (CCCD に 0x0001 を Write)
//   ステップ 11: 通知受信 (Handle Value Notification)
//   ステップ 12: 切断 (Disconnect → Disconnection Complete)

export class BluetoothSimulator {
  simulate(config: SimConfig): SimResult {
    const events: SimEvent[] = [];
    const readValues: SimResult["readValues"] = [];
    const notifications: SimResult["notifications"] = [];
    let time = 0;
    const lat = config.latencyMs;
    const p = config.peripheral;
    const c = config.central;

    // ── 1. アドバタイズ ──
    // ペリフェラルがアドバタイズパケットを 3 つのアドバタイズチャネル
    // (ch37, ch38, ch39) で順番にブロードキャストする。
    // この 3 チャネルは 2.4GHz 帯の中で Wi-Fi と干渉しにくい位置に配置されている。
    // ch37=2402MHz, ch38=2426MHz, ch39=2480MHz
    events.push({ time, layer: "GAP", type: "info", direction: "●", detail: `ペリフェラル "${p.name}" がアドバタイズ開始 (${p.advType}, interval=${p.advInterval}ms)` });

    const rssi = rssiFromDistance(p.advData.txPower, p.distance);
    for (let i = 0; i < 3; i++) {
      time += p.advInterval;
      events.push({
        time, layer: "Radio", type: "adv", direction: "←",
        detail: `ADV_IND ch=${37 + i}: "${p.advData.localName}" rssi=${rssi}dBm txPower=${p.advData.txPower}dBm`,
        hci: { eventCode: 0x3e, name: "LE Advertising Report", params: `addr=${p.address} rssi=${rssi} data=[flags=${p.advData.flags.toString(16)}, name="${p.advData.localName}"]` },
      });
    }

    // ── 2. スキャン ──
    // セントラルが Active Scan を実施:
    //   (a) アドバタイズ受信 → SCAN_REQ 送信
    //   (b) ペリフェラルが SCAN_RSP で追加データ (サービスUUID等) を返す
    // Passive Scan の場合は SCAN_REQ を送らずアドバタイズのみ受信する。
    time += lat;
    events.push({ time, layer: "GAP", type: "scan", direction: "●", detail: `セントラル "${c.name}" がスキャン開始 (active scan)` });
    events.push({
      time, layer: "HCI", type: "scan", direction: "→",
      detail: `LE Set Scan Enable (enable=1, filter_dup=1)`,
      hci: { eventCode: 0x0e, name: "Command Complete", params: "LE_Set_Scan_Enable" },
    });

    time += p.advInterval + lat;
    events.push({
      time, layer: "Radio", type: "scan", direction: "←",
      detail: `SCAN_RSP: services=[${p.advData.serviceUuids.map((u) => uuidName(u)).join(", ")}]${p.advData.manufacturerData ? ` mfr=${p.advData.manufacturerData.slice(0, 16)}...` : ""}`,
    });
    events.push({
      time, layer: "GAP", type: "scan", direction: "●",
      detail: `デバイス検出: "${p.name}" (${p.address}) RSSI=${rssi}dBm 距離≈${p.distance}m`,
    });

    // ── 3. 接続 ──
    // セントラルが CONNECT_IND (接続要求) を送信。
    // Link Layer が接続パラメータ (interval, latency, timeout) を交換し、
    // 1:1 のデータチャネルリンクを確立する。
    // 以降はアドバタイズチャネルではなくデータチャネル (ch0–ch36) で通信する。
    time += lat;
    events.push({
      time, layer: "HCI", type: "connect", direction: "→",
      detail: `LE Create Connection (peer=${p.address}, phy=${config.phy})`,
      hci: { eventCode: 0x0e, name: "Command Status", params: "LE_Create_Connection" },
    });

    time += lat * 2;
    const connInterval = 7.5;
    const connLatency = 0;
    const supervisionTimeout = 4000;
    events.push({
      time, layer: "HCI", type: "connect", direction: "←",
      detail: `LE Connection Complete: handle=0x0040 interval=${connInterval}ms latency=${connLatency} timeout=${supervisionTimeout}ms`,
      hci: { eventCode: 0x3e, name: "LE Connection Complete", params: `handle=0x0040 role=central peer=${p.address}` },
    });
    events.push({
      time, layer: "L2CAP", type: "connect", direction: "●",
      detail: `L2CAP チャネル確立 (CID=0x0004 ATT, CID=0x0006 SMP)`,
      packet: { cid: 0x0004, channelName: "ATT", length: 0, payload: "channel open" },
    });

    // ── 4. MTU 交換 ──
    // ATT のデフォルト MTU は 23 バイト (BLE 4.x)。
    // Exchange MTU Request/Response で双方の最大 MTU を交渉し、
    // 小さい方の値を採用する。大きい MTU → 1 回の操作で多くのデータを転送可能。
    // BLE 5.0 以降では DLE (Data Length Extension) と組み合わせて最大 251B/パケット。
    time += lat;
    const negotiatedMtu = Math.min(c.mtu, p.mtu);
    events.push({
      time, layer: "ATT", type: "gatt_read", direction: "→",
      detail: `Exchange MTU Request: client_mtu=${c.mtu}`,
      packet: { cid: 0x0004, channelName: "ATT", length: 3, payload: `opcode=0x02 mtu=${c.mtu}` },
    });
    time += lat;
    events.push({
      time, layer: "ATT", type: "gatt_read", direction: "←",
      detail: `Exchange MTU Response: server_mtu=${p.mtu} → negotiated=${negotiatedMtu}`,
      packet: { cid: 0x0004, channelName: "ATT", length: 3, payload: `opcode=0x03 mtu=${p.mtu}` },
    });

    // ── 5. PHY 更新 (BLE 5.0+) ──
    // 接続後に PHY を変更可能。2M PHY でスループット倍増、
    // Coded PHY で到達距離を最大 4 倍に拡大できる。
    if (config.phy !== "1M" && p.supportedPhy.includes(config.phy)) {
      time += lat;
      events.push({ time, layer: "HCI", type: "connect", direction: "→", detail: `LE Set PHY: tx=${config.phy} rx=${config.phy}` });
      time += lat;
      events.push({ time, layer: "HCI", type: "connect", direction: "←", detail: `LE PHY Update Complete: tx=${config.phy} rx=${config.phy}` });
    }

    // ── 6. ペアリング (SMP: Security Manager Protocol) ──
    // LE Secure Connections (BLE 4.2+) のフロー:
    //   (a) Pairing Request/Response で IO Capability を交換
    //   (b) IO Capability の組み合わせでペアリング方式を決定
    //   (c) 方式に応じたユーザー認証 (Passkey 入力、数値確認等)
    //   (d) ECDH P-256 で公開鍵を交換 → DHKey 計算
    //   (e) DHKey Check で相互認証 → LTK (Long Term Key) 生成
    //   (f) AES-CCM で通信を暗号化開始
    //   (g) ボンディング: LTK をフラッシュに保存 → 次回再ペアリング不要
    if (config.pairing) {
      time += lat;
      const method = config.pairingMethod;
      events.push({
        time, layer: "SMP", type: "pair", direction: "→",
        detail: `Pairing Request: io=${c.ioCap} oob=0 auth=bonding|mitm|sc max_key=16`,
        packet: { cid: 0x0006, channelName: "SMP", length: 7, payload: "opcode=0x01 Pairing Request" },
      });
      time += lat;
      events.push({
        time, layer: "SMP", type: "pair", direction: "←",
        detail: `Pairing Response: io=${p.ioCap} oob=0 auth=bonding|mitm|sc max_key=16`,
        packet: { cid: 0x0006, channelName: "SMP", length: 7, payload: "opcode=0x02 Pairing Response" },
      });

      events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: `ペアリング方式決定: ${method} (central=${c.ioCap}, peripheral=${p.ioCap})` });

      // 方式ごとの手順
      time += lat;
      switch (method) {
        case "just-works":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "Just Works: ユーザー操作なしで鍵交換 (MITM 保護なし)" });
          break;
        case "passkey":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "Passkey Entry: ペリフェラルが表示した 6 桁を入力 → 123456" });
          events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "Pairing Confirm (passkey commitment)" });
          time += lat;
          events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "Pairing Confirm (passkey commitment)" });
          break;
        case "numeric-comparison":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "Numeric Comparison: 両デバイスに 6 桁表示 → 854217 — ユーザーが「はい」" });
          events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "Pairing Confirm + DHKey Check" });
          time += lat;
          events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "Pairing Confirm + DHKey Check" });
          break;
        case "oob":
          events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "OOB: NFC タップで鍵情報を交換" });
          break;
      }

      // LE Secure Connections の鍵交換
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "Public Key (ECDH P-256): 64 bytes" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "Public Key (ECDH P-256): 64 bytes" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "→", detail: "DHKey Check: 確認値送信" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "←", detail: "DHKey Check: 確認値送信" });
      time += lat;
      events.push({ time, layer: "SMP", type: "pair", direction: "●", detail: "ペアリング完了: LTK (Long Term Key) 生成・保存 → ボンディング確立" });
      events.push({
        time, layer: "SMP", type: "pair", direction: "●",
        detail: `暗号化開始: AES-CCM (128-bit LTK)`,
      });
    }

    // ── 7. GATT サービス検出 ──
    // ATT "Read By Group Type" リクエストで全 Primary Service を列挙し、
    // 各サービス内の Characteristic を "Read By Type" で検出する。
    // これにより、ペリフェラルが提供する全データ構造を把握できる。
    time += lat;
    events.push({
      time, layer: "GATT", type: "gatt_discover", direction: "→",
      detail: "Discover All Primary Services (ATT Read By Group Type, uuid=0x2800)",
      packet: { cid: 0x0004, channelName: "ATT", length: 7, payload: "opcode=0x10 start=0x0001 end=0xFFFF uuid=0x2800" },
    });
    time += lat;

    const discoveredServices = p.gattProfile.services;
    let handle = 1;
    for (const svc of discoveredServices) {
      const svcName = uuidName(svc.uuid);
      events.push({
        time, layer: "GATT", type: "gatt_discover", direction: "←",
        detail: `Service: ${svcName} (${svc.uuid}) handles=${handle}–${handle + svc.characteristics.length * 2}`,
      });

      // Characteristic 検出
      for (const ch of svc.characteristics) {
        handle++;
        const chName = uuidName(ch.uuid);
        events.push({
          time: time + 1, layer: "GATT", type: "gatt_discover", direction: "←",
          detail: `  Char: ${chName} (${ch.uuid}) props=[${ch.permissions.join(",")}] handle=${handle}`,
        });
        handle++;
      }
      time += lat;
    }

    // ── 8. Characteristic 読み取り ──
    // ATT Read Request (opcode=0x0A) → Read Response (opcode=0x0B)
    // ハンドルを指定して Characteristic の現在値を取得する。
    for (const readUuid of config.readCharacteristics) {
      const ch = this.findCharacteristic(discoveredServices, readUuid);
      if (!ch) continue;
      time += lat;
      const chName = uuidName(ch.uuid);
      events.push({
        time, layer: "ATT", type: "gatt_read", direction: "→",
        detail: `Read Request: ${chName} (${ch.uuid})`,
        packet: { cid: 0x0004, channelName: "ATT", length: 3, payload: `opcode=0x0A` },
      });
      time += lat;
      events.push({
        time, layer: "ATT", type: "gatt_read", direction: "←",
        detail: `Read Response: ${chName} = "${ch.displayValue}" (0x${ch.value})`,
        packet: { cid: 0x0004, channelName: "ATT", length: ch.value.length / 2 + 1, payload: `opcode=0x0B data=0x${ch.value}` },
      });
      readValues.push({ uuid: ch.uuid, name: chName, value: ch.value, displayValue: ch.displayValue });
    }

    // ── 9. Characteristic 書き込み ──
    // 2 種類の書き込み:
    //   Write Request  (opcode=0x12) → Write Response (opcode=0x13): 確認応答あり
    //   Write Command  (opcode=0x52): 確認応答なし (高速だが到達保証なし)
    for (const w of config.writeCharacteristics) {
      const ch = this.findCharacteristic(discoveredServices, w.uuid);
      if (!ch) continue;
      time += lat;
      const chName = uuidName(ch.uuid);
      const writeType = ch.permissions.includes("write-no-response") ? "Write Command (no response)" : "Write Request";
      events.push({
        time, layer: "ATT", type: "gatt_write", direction: "→",
        detail: `${writeType}: ${chName} ← "${w.displayValue}" (0x${w.value})`,
        packet: { cid: 0x0004, channelName: "ATT", length: w.value.length / 2 + 3, payload: `opcode=${ch.permissions.includes("write-no-response") ? "0x52" : "0x12"}` },
      });
      if (!ch.permissions.includes("write-no-response")) {
        time += lat;
        events.push({
          time, layer: "ATT", type: "gatt_write", direction: "←",
          detail: `Write Response: OK`,
          packet: { cid: 0x0004, channelName: "ATT", length: 1, payload: "opcode=0x13" },
        });
      }
      ch.value = w.value;
      ch.displayValue = w.displayValue;
    }

    // ── 10. 通知の有効化 ──
    // Characteristic の CCCD (Client Characteristic Configuration Descriptor,
    // UUID 0x2902) に 0x0001 を書き込むことで Notification を有効化する。
    // 0x0002 を書くと Indication (確認応答あり) になる。
    for (const notifyUuid of config.enableNotifications) {
      const ch = this.findCharacteristic(discoveredServices, notifyUuid);
      if (!ch || !ch.permissions.includes("notify")) continue;
      time += lat;
      const chName = uuidName(ch.uuid);
      events.push({
        time, layer: "ATT", type: "gatt_write", direction: "→",
        detail: `Write CCCD: ${chName} 通知有効 (0x0100)`,
        packet: { cid: 0x0004, channelName: "ATT", length: 5, payload: "opcode=0x12 CCCD=0x0100" },
      });
      time += lat;
      events.push({ time, layer: "ATT", type: "gatt_write", direction: "←", detail: "Write Response: OK" });
      ch.notifying = true;
    }

    // ── 11. 通知受信 ──
    // ペリフェラルが Handle Value Notification (opcode=0x1B) を送信。
    // セントラルの GATT クライアントがコールバックでアプリに通知する。
    // Notification はセントラルからの確認応答不要 (Indication は 0x1D で確認あり)。
    for (const n of config.notificationValues) {
      const ch = this.findCharacteristic(discoveredServices, n.uuid);
      if (!ch) continue;
      time += lat * 3;
      const chName = uuidName(ch.uuid);
      events.push({
        time, layer: "ATT", type: "gatt_notify", direction: "←",
        detail: `Handle Value Notification: ${chName} = "${n.displayValue}" (0x${n.value})`,
        packet: { cid: 0x0004, channelName: "ATT", length: n.value.length / 2 + 3, payload: `opcode=0x1B data=0x${n.value}` },
      });
      events.push({
        time, layer: "App", type: "gatt_notify", direction: "●",
        detail: `アプリ通知: ${chName} → ${n.displayValue}`,
      });
      notifications.push({ uuid: n.uuid, name: chName, value: n.value, displayValue: n.displayValue });
    }

    // ── 12. 切断 ──
    // HCI Disconnect コマンド → Disconnection Complete イベント。
    // reason=0x13 (Remote User Terminated Connection) が最も一般的。
    // ボンディング済みなら LTK は保持され、次回接続で再利用される。
    time += lat * 2;
    events.push({
      time, layer: "HCI", type: "disconnect", direction: "→",
      detail: "Disconnect (reason=0x13 Remote User Terminated)",
      hci: { eventCode: 0x05, name: "Disconnection Complete", params: "handle=0x0040 reason=0x13" },
    });
    time += lat;
    events.push({ time, layer: "GAP", type: "disconnect", direction: "●", detail: "接続終了" });

    return {
      events,
      finalState: config.pairing ? "bonded" : "disconnected",
      discoveredServices,
      readValues,
      notifications,
      totalTime: time,
      connectionParams: { interval: connInterval, latency: connLatency, timeout: supervisionTimeout, mtu: negotiatedMtu, phy: config.phy },
    };
  }

  /**
   * GATT サービスツリーから UUID で Characteristic を検索する。
   * 全サービスをフラットに走査し、最初に一致したものを返す。
   */
  private findCharacteristic(services: GattService[], uuid: UUID): GattCharacteristic | undefined {
    for (const svc of services) {
      const ch = svc.characteristics.find((c) => c.uuid === uuid);
      if (ch) return ch;
    }
    return undefined;
  }
}

// ══════════════════════════════════════════════════════════════
// プリセット用ヘルパー
// ══════════════════════════════════════════════════════════════
//
// GATT プロファイルの構築を簡潔にするためのファクトリ関数群。
// プリセット定義 (app.ts の EXPERIMENTS) で使用する。

/**
 * GATT Characteristic を簡潔に作成する。
 * notify/indicate 権限がある場合、自動的に CCCD Descriptor を追加する。
 */
export function char(uuid: UUID, name: string, perms: CharPermission[], value: string, displayValue: string): GattCharacteristic {
  const descriptors: GattDescriptor[] = [];
  // notify/indicate を持つ Characteristic には CCCD (0x2902) が必須
  if (perms.includes("notify") || perms.includes("indicate")) {
    descriptors.push({ uuid: "2902", name: "CCCD", value: "0000" });
  }
  return { uuid, name, permissions: perms, value, displayValue, notifying: false, descriptors };
}

/**
 * GATT Service を簡潔に作成する。
 * primary=true で作成 (ほとんどのユースケースで Primary Service)。
 */
export function svc(uuid: UUID, name: string, chars: GattCharacteristic[]): GattService {
  return { uuid, name, primary: true, characteristics: chars };
}

/**
 * BLE デバイスをデフォルト値で作成する。
 *
 * デフォルト: BLE 5.0, 1M+2M PHY, ADV_IND, MTU=247, txPower=-4dBm, 距離=1m
 * opts でカスタマイズ可能。
 */
export function createDevice(
  name: string, address: BdAddr, services: GattService[],
  opts?: Partial<Pick<BleDevice, "version" | "distance" | "ioCap" | "mtu" | "advType" | "connectable" | "supportedPhy">>,
): BleDevice {
  const txPower = -4;
  const distance = opts?.distance ?? 1;
  return {
    address, name, version: opts?.version ?? "5.0",
    supportedPhy: opts?.supportedPhy ?? ["1M", "2M"],
    rssi: rssiFromDistance(txPower, distance),
    distance,
    advData: {
      localName: name, txPower, serviceUuids: services.map((s) => s.uuid),
      flags: 0x06, manufacturerData: "4c000215",
    },
    advInterval: 100,
    advType: opts?.advType ?? "ADV_IND",
    gattProfile: { services },
    ioCap: opts?.ioCap ?? "no-io",
    connectable: opts?.connectable ?? true,
    mtu: opts?.mtu ?? 247,
  };
}
