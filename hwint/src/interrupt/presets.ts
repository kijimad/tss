import type { IdtEntry, InterruptRequest, Priority } from "./types.js";

export interface Preset {
  name: string;
  description: string;
  idt: IdtEntry[];
  requests: InterruptRequest[];
  /** IMR初期値（ビットが1の場合、対応するIRQがマスクされる） */
  initialImr: number;
}

/** IDTエントリのヘルパー */
const idt = (
  vector: number, name: string, handler: string,
  cls: IdtEntry["class"], device: IdtEntry["device"],
  priority: Priority, maskable: boolean, cycles: number
): IdtEntry => ({
  vector, name, handlerName: handler, class: cls, device,
  priority, maskable, handlerCycles: cycles,
});

/** 標準的なIDTエントリ群 */
const STANDARD_IDT: IdtEntry[] = [
  // 例外（ベクタ0〜31）
  idt(0, "除算エラー", "divide_error_handler", "exception", "cpu", 0, false, 5),
  idt(6, "無効オペコード", "invalid_opcode_handler", "exception", "cpu", 0, false, 5),
  idt(13, "一般保護例外", "gpf_handler", "exception", "cpu", 0, false, 8),
  idt(14, "ページフォールト", "page_fault_handler", "exception", "cpu", 0, false, 10),
  // ハードウェア割り込み（ベクタ32〜47、IRQ0〜15に対応）
  idt(32, "タイマー", "timer_handler", "hardware", "timer", 0, true, 3),
  idt(33, "キーボード", "keyboard_handler", "hardware", "keyboard", 1, true, 4),
  idt(34, "カスケード", "cascade_handler", "hardware", "timer", 2, true, 1),
  idt(35, "シリアルポート", "serial_handler", "hardware", "serial", 3, true, 5),
  idt(38, "ディスク", "disk_handler", "hardware", "disk", 4, true, 8),
  idt(39, "ネットワーク", "network_handler", "hardware", "network", 5, true, 6),
  idt(43, "GPU", "gpu_handler", "hardware", "gpu", 6, true, 4),
  // ソフトウェア割り込み
  idt(0x80, "システムコール", "syscall_handler", "software", "software", 3, true, 6),
];

export const presets: Preset[] = [
  {
    name: "基本: タイマー割り込み",
    description: "最も基本的なハードウェア割り込み。タイマーが定期的にIRQ0を発生させ、CPUがハンドラを実行する流れ",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { irq: 0, vector: 32, triggerCycle: 10, device: "タイマー", description: "10msタイマーtick" },
      { irq: 0, vector: 32, triggerCycle: 30, device: "タイマー", description: "10msタイマーtick" },
      { irq: 0, vector: 32, triggerCycle: 50, device: "タイマー", description: "10msタイマーtick" },
    ],
  },
  {
    name: "キーボード入力",
    description: "キー押下でIRQ1が発生。PICがCPUに通知し、キーボードハンドラがスキャンコードを読み取る",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { irq: 1, vector: 33, triggerCycle: 5, device: "キーボード", description: "キー押下 'A' (スキャンコード 0x1E)" },
      { irq: 1, vector: 33, triggerCycle: 25, device: "キーボード", description: "キー解放 'A' (スキャンコード 0x9E)" },
      { irq: 1, vector: 33, triggerCycle: 40, device: "キーボード", description: "キー押下 'Enter' (スキャンコード 0x1C)" },
    ],
  },
  {
    name: "割り込みマスク（IMR）",
    description: "PICのIMRでIRQをマスク。マスクされた割り込みは無視される。ディスクIRQ(6)をマスクしてタイマーのみ処理",
    idt: STANDARD_IDT,
    initialImr: 0b01000000, // IRQ6（ディスク）をマスク
    requests: [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "タイマーtick（処理される）" },
      { irq: 6, vector: 38, triggerCycle: 10, device: "ディスク", description: "ディスク完了（マスクで無視！）" },
      { irq: 0, vector: 32, triggerCycle: 20, device: "タイマー", description: "タイマーtick（処理される）" },
      { irq: 6, vector: 38, triggerCycle: 25, device: "ディスク", description: "ディスク完了（マスクで無視！）" },
      { irq: 1, vector: 33, triggerCycle: 35, device: "キーボード", description: "キー押下（処理される）" },
    ],
  },
  {
    name: "CLI/STI（割り込み禁止/許可）",
    description: "CPUのIFフラグによる割り込み禁止。ハンドラ実行中は自動的にCLI、完了後にSTIで復帰",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "タイマーtick → CLI自動実行" },
      { irq: 1, vector: 33, triggerCycle: 6, device: "キーボード", description: "ハンドラ中のキー押下（IF=0で保留）" },
      { irq: 0, vector: 32, triggerCycle: 30, device: "タイマー", description: "復帰後のタイマーtick" },
    ],
  },
  {
    name: "ネスト割り込み（優先度）",
    description: "高優先度の割り込みが低優先度のハンドラを中断。タイマー(pri=0)がディスク処理(pri=4)を割り込む",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { irq: 6, vector: 38, triggerCycle: 5, device: "ディスク", description: "ディスクI/O完了（pri=4, 8サイクル）" },
      { irq: 0, vector: 32, triggerCycle: 8, device: "タイマー", description: "タイマーtick（pri=0）→ ディスク処理を中断！" },
      { irq: 1, vector: 33, triggerCycle: 9, device: "キーボード", description: "キー押下（pri=1）→ タイマー中は保留" },
    ],
  },
  {
    name: "NMI（マスク不可割り込み）",
    description: "NMIはIMR/IFフラグに関係なく必ず処理される。メモリパリティエラーなどの致命的エラー",
    idt: STANDARD_IDT,
    initialImr: 0xFF, // 全IRQマスク
    requests: [
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "タイマー（全マスクで無視）" },
      { vector: 0, triggerCycle: 10, device: "CPU", description: "除算エラー例外（NMI, マスク不可）" },
      { irq: 1, vector: 33, triggerCycle: 15, device: "キーボード", description: "キーボード（全マスクで無視）" },
      { vector: 13, triggerCycle: 30, device: "CPU", description: "一般保護例外（NMI, マスク不可）" },
    ],
  },
  {
    name: "CPU例外",
    description: "ページフォールト、除算エラーなどのCPU内部例外。ソフトウェア的に発生しNMI扱い",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { vector: 0, triggerCycle: 5, device: "CPU", description: "除算エラー (INT 0)" },
      { vector: 14, triggerCycle: 20, device: "CPU", description: "ページフォールト (INT 14)" },
      { vector: 6, triggerCycle: 40, device: "CPU", description: "無効オペコード (INT 6)" },
    ],
  },
  {
    name: "システムコール（INT 0x80）",
    description: "ソフトウェア割り込みによるシステムコール。ユーザーモード→カーネルモード遷移",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { vector: 0x80, triggerCycle: 5, device: "ユーザープロセス", description: "write() システムコール (INT 0x80)" },
      { irq: 0, vector: 32, triggerCycle: 8, device: "タイマー", description: "syscall処理中のタイマー割り込み" },
      { vector: 0x80, triggerCycle: 25, device: "ユーザープロセス", description: "read() システムコール (INT 0x80)" },
    ],
  },
  {
    name: "複数デバイス同時",
    description: "タイマー、キーボード、ディスク、ネットワークが同時に割り込み。PICが優先度順にCPUへ通知",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { irq: 7, vector: 39, triggerCycle: 5, device: "ネットワーク", description: "パケット受信（pri=5）" },
      { irq: 6, vector: 38, triggerCycle: 5, device: "ディスク", description: "DMA完了（pri=4）" },
      { irq: 1, vector: 33, triggerCycle: 5, device: "キーボード", description: "キー押下（pri=1）" },
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "タイマーtick（pri=0）" },
      { irq: 0, vector: 32, triggerCycle: 30, device: "タイマー", description: "2回目タイマーtick" },
    ],
  },
  {
    name: "割り込みストーム",
    description: "短期間に大量の割り込みが発生。ネスト・マスク・優先度制御の総合テスト",
    idt: STANDARD_IDT,
    initialImr: 0,
    requests: [
      { irq: 0, vector: 32, triggerCycle: 1, device: "タイマー", description: "タイマーtick #1" },
      { irq: 1, vector: 33, triggerCycle: 2, device: "キーボード", description: "キー押下 #1" },
      { irq: 6, vector: 38, triggerCycle: 3, device: "ディスク", description: "ディスクI/O #1" },
      { irq: 7, vector: 39, triggerCycle: 4, device: "ネットワーク", description: "パケット #1" },
      { irq: 0, vector: 32, triggerCycle: 5, device: "タイマー", description: "タイマーtick #2" },
      { vector: 14, triggerCycle: 6, device: "CPU", description: "ページフォールト" },
      { irq: 1, vector: 33, triggerCycle: 10, device: "キーボード", description: "キー押下 #2" },
      { irq: 0, vector: 32, triggerCycle: 15, device: "タイマー", description: "タイマーtick #3" },
      { vector: 0x80, triggerCycle: 20, device: "ユーザープロセス", description: "syscall" },
      { irq: 7, vector: 39, triggerCycle: 25, device: "ネットワーク", description: "パケット #2" },
    ],
  },
];
