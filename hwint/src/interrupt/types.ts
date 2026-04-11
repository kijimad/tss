/** 割り込みの種類 */
export type InterruptClass = "hardware" | "software" | "exception";

/** 割り込みの発生源カテゴリ */
export type DeviceType =
  | "timer" | "keyboard" | "disk" | "network" | "serial" | "gpu"
  | "software" | "cpu";

/** 割り込みの優先度（0が最高） */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** CPU動作モード */
export type CpuMode = "user" | "kernel";

/** 割り込みベクタ番号 */
export type VectorNumber = number;

/** 割り込み記述子（IDTエントリ） */
export interface IdtEntry {
  vector: VectorNumber;
  name: string;
  handlerName: string;
  class: InterruptClass;
  device: DeviceType;
  priority: Priority;
  /** マスク可能か */
  maskable: boolean;
  /** ハンドラ実行サイクル数 */
  handlerCycles: number;
}

/** PIC（割り込みコントローラ）の状態 */
export interface PicState {
  /** 割り込みマスクレジスタ（IMR）: ビットが1なら該当IRQはマスク */
  imr: number;
  /** 割り込み要求レジスタ（IRR）: ペンディング中のIRQ */
  irr: number;
  /** 割り込みサービスレジスタ（ISR）: 現在処理中のIRQ */
  isr: number;
}

/** CPU状態 */
export interface CpuState {
  mode: CpuMode;
  /** 割り込み許可フラグ（IF） */
  interruptEnabled: boolean;
  /** 現在実行中の割り込みベクタ（なければnull） */
  currentVector: VectorNumber | null;
  /** プログラムカウンタ */
  pc: number;
  /** スタックポインタ */
  sp: number;
  /** 汎用レジスタ */
  registers: Record<string, number>;
  /** 実行サイクル */
  cycle: number;
}

/** 割り込み要求 */
export interface InterruptRequest {
  /** IRQ番号（ハードウェア割り込みの場合） */
  irq?: number;
  /** ベクタ番号 */
  vector: VectorNumber;
  /** 発生サイクル */
  triggerCycle: number;
  /** デバイス名 */
  device: string;
  /** 説明 */
  description: string;
}

/** スタックフレーム（割り込み時に保存されるコンテキスト） */
export interface StackFrame {
  /** 戻りアドレス（PC） */
  returnAddress: number;
  /** フラグレジスタ */
  flags: number;
  /** 保存レジスタ */
  savedRegisters: Record<string, number>;
  /** 割り込み前のモード */
  previousMode: CpuMode;
}

/** シミュレーションイベント（可視化用） */
export interface SimEvent {
  cycle: number;
  type:
    | "irq_raised"       // IRQ信号がPICに到達
    | "irq_masked"       // マスクにより無視
    | "irq_pending"      // IRRにセット
    | "cpu_ack"          // CPUがINTA送信
    | "vector_dispatch"  // ベクタ番号でIDT参照
    | "context_save"     // コンテキスト保存
    | "mode_switch"      // user→kernel遷移
    | "handler_start"    // ハンドラ実行開始
    | "handler_end"      // ハンドラ実行完了
    | "eoi"              // End of Interrupt
    | "context_restore"  // コンテキスト復帰
    | "mode_return"      // kernel→user復帰
    | "nested_interrupt" // ネスト割り込み発生
    | "cli"              // 割り込み禁止
    | "sti"              // 割り込み許可
    | "exception"        // 例外発生
    | "nmi"              // NMI（マスク不可割り込み）
    | "info";
  description: string;
  details?: Record<string, string | number | boolean>;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  /** 最終CPU状態 */
  finalCpu: CpuState;
  /** 最終PIC状態 */
  finalPic: PicState;
  /** 処理された割り込み数 */
  handledCount: number;
  /** マスクされた割り込み数 */
  maskedCount: number;
  /** ネスト割り込み数 */
  nestedCount: number;
  /** 総サイクル数 */
  totalCycles: number;
}
