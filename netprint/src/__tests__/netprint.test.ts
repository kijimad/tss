/* ネットワークプリンタ シミュレーター テスト */

import { describe, it, expect } from "vitest";
import { executeSimulation, defaultConfig, simulate } from "../netprint/engine.js";
import { PRESETS } from "../netprint/presets.js";
import type { SimOp, PrintInstr } from "../netprint/types.js";

/** テスト用のSimOpを作成 */
function mkOp(instructions: PrintInstr[]): SimOp {
  return { type: "execute", config: defaultConfig(), instructions };
}

/** 共通プリンタ定義 */
const testPrinter = {
  id: "test-01", name: "TestPrinter", type: "laser_bw" as const,
  ip: "192.168.1.100", mac: "AA:BB:CC:DD:EE:01",
  state: "idle" as const, ppm: 30,
  paperRemaining: 250, tonerLevel: 80,
  protocols: ["ipp" as const, "lpd" as const, "raw9100" as const, "snmp" as const, "bonjour" as const],
  duplex: true, color: false, warmupTicks: 3,
};

const testClient = { name: "PC-A", ip: "192.168.1.10", os: "Windows" };

describe("プリンタ管理", () => {
  it("プリンタを追加できる", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers).toHaveLength(1);
    expect(last.printers[0].name).toBe("TestPrinter");
    expect(last.printers[0].state).toBe("idle");
  });

  it("クライアントを追加できる", () => {
    const r = executeSimulation(mkOp([
      { op: "add_client", client: testClient },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.clients).toHaveLength(1);
    expect(last.clients[0].name).toBe("PC-A");
  });

  it("プリンタをオフライン/オンラインに切り替え", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "set_offline", printerName: "TestPrinter" },
      { op: "set_online", printerName: "TestPrinter" },
    ]));
    expect(r.steps[1].printers[0].state).toBe("offline");
    expect(r.steps[2].printers[0].state).toBe("idle");
  });
});

describe("プロトコル探索", () => {
  it("Bonjourでプリンタを発見できる", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "discover", clientName: "PC-A", protocol: "bonjour" },
    ]));
    const last = r.steps[r.steps.length - 1];
    // 探索パケットとレスポンスが生成される
    expect(last.packets.length).toBeGreaterThanOrEqual(2);
    expect(r.events.some(e => e.type === "discovery")).toBe(true);
  });

  it("オフラインのプリンタは探索に表示されない", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, state: "offline" as const } },
      { op: "add_client", client: testClient },
      { op: "discover", clientName: "PC-A", protocol: "bonjour" },
    ]));
    expect(r.events.some(e => e.message.includes("0台発見"))).toBe(true);
  });

  it("対応していないプロトコルでは発見されない", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, protocols: ["ipp" as const] } },
      { op: "add_client", client: testClient },
      { op: "discover", clientName: "PC-A", protocol: "bonjour" },
    ]));
    expect(r.events.some(e => e.message.includes("0台発見"))).toBe(true);
  });
});

describe("ジョブ送信", () => {
  it("ジョブをキューに追加できる", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "ipp", priority: 5,
      }},
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].queue).toHaveLength(1);
    expect(last.printers[0].queue[0].state).toBe("queued");
    expect(last.printers[0].queue[0].name).toBe("test.pdf");
    // パケットが生成される（submit + ack）
    expect(last.packets.length).toBeGreaterThanOrEqual(2);
  });

  it("オフラインのプリンタにはジョブ送信失敗", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, state: "offline" as const } },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "ipp", priority: 5,
      }},
    ]));
    expect(r.events.some(e => e.type === "error")).toBe(true);
  });
});

describe("データ転送", () => {
  it("IPPで転送できる (64KB/tick)", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 131072, protocol: "ipp", priority: 5,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
      { op: "transfer_data", printerName: "TestPrinter" },
    ]));
    const last = r.steps[r.steps.length - 1];
    // 131072 / 65536 = 2tick で転送完了
    const job = last.printers[0].queue[0];
    expect(job.state).toBe("processing");
    expect(job.transferredBytes).toBe(131072);
  });

  it("Raw9100は高速 (128KB/tick)", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 131072, protocol: "raw9100", priority: 5,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
    ]));
    const last = r.steps[r.steps.length - 1];
    // 131072 / 131072 = 1tick で転送完了
    const job = last.printers[0].queue[0];
    expect(job.state).toBe("processing");
  });
});

describe("印刷処理", () => {
  it("ウォームアップ後に印刷開始", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "raw9100", priority: 5,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
      { op: "process_queue", printerName: "TestPrinter" },
    ]));
    // ウォームアップ開始
    expect(r.events.some(e => e.type === "warmup")).toBe(true);
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].state).toBe("warming_up");
  });

  it("印刷完了でジョブがキューから除去", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, warmupTicks: 1 } },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "small.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 3, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "raw9100", priority: 5,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
      { op: "process_queue", printerName: "TestPrinter" },
      // ウォームアップ完了 → 自動的に印刷開始
      { op: "print_tick", printerName: "TestPrinter" },
      // 印刷実行
      { op: "print_tick", printerName: "TestPrinter" },
    ]));
    expect(r.events.some(e => e.type === "print_done")).toBe(true);
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].queue).toHaveLength(0);
    expect(last.printers[0].currentJob).toBeNull();
    expect(last.printers[0].state).toBe("idle");
  });
});

describe("エラー処理", () => {
  it("紙詰まりで印刷停止", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "paper_jam", printerName: "TestPrinter" },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].state).toBe("paper_jam");
    expect(r.events.some(e => e.type === "paper_jam")).toBe(true);
  });

  it("ジャムクリアで復帰", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "paper_jam", printerName: "TestPrinter" },
      { op: "clear_jam", printerName: "TestPrinter" },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].state).toBe("idle");
  });

  it("用紙切れでエラー状態", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, paperRemaining: 0, warmupTicks: 1 } },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "raw9100", priority: 5,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
      { op: "process_queue", printerName: "TestPrinter" },
      // ウォームアップ完了→印刷開始→用紙切れ
      { op: "print_tick", printerName: "TestPrinter" },
      { op: "print_tick", printerName: "TestPrinter" },
    ]));
    expect(r.events.some(e => e.type === "paper_out")).toBe(true);
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].state).toBe("error");
  });

  it("用紙補充でエラーから復帰", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, paperRemaining: 0, warmupTicks: 1 } },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "test.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "raw9100", priority: 5,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
      { op: "process_queue", printerName: "TestPrinter" },
      // ウォームアップ完了→印刷開始→用紙切れ
      { op: "print_tick", printerName: "TestPrinter" },
      { op: "print_tick", printerName: "TestPrinter" },
      { op: "add_paper", printerName: "TestPrinter", sheets: 500 },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].state).toBe("idle");
    expect(last.printers[0].paperRemaining).toBe(500);
  });
});

describe("トナー管理", () => {
  it("トナー交換で100%に復帰", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, tonerLevel: 5 } },
      { op: "replace_toner", printerName: "TestPrinter" },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].tonerLevel).toBe(100);
  });
});

describe("ジョブキャンセル", () => {
  it("キュー内のジョブをキャンセルできる", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "cancel_me.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 10, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "ipp", priority: 5,
      }},
      { op: "cancel_job", printerName: "TestPrinter", jobId: 1 },
    ]));
    const last = r.steps[r.steps.length - 1];
    expect(last.printers[0].queue).toHaveLength(0);
    expect(r.events.some(e => e.type === "cancel")).toBe(true);
  });
});

describe("ステータス照会", () => {
  it("SNMPでプリンタ状態を取得", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: testPrinter },
      { op: "add_client", client: testClient },
      { op: "status_query", clientName: "PC-A", printerName: "TestPrinter", protocol: "snmp" },
    ]));
    const last = r.steps[r.steps.length - 1];
    // query + response パケット
    expect(last.packets.length).toBeGreaterThanOrEqual(2);
    expect(r.events.some(e => e.type === "status" && e.message.includes("SNMP"))).toBe(true);
  });
});

describe("優先度キュー", () => {
  it("優先度の高いジョブが先に処理される", () => {
    const r = executeSimulation(mkOp([
      { op: "add_printer", printer: { ...testPrinter, warmupTicks: 1 } },
      { op: "add_client", client: testClient },
      // 低優先度
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "low.pdf", owner: "user", sourceIp: "192.168.1.10",
        pages: 5, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "raw9100", priority: 9,
      }},
      // 高優先度
      { op: "submit_job", clientName: "PC-A", printerName: "TestPrinter", job: {
        name: "high.pdf", owner: "boss", sourceIp: "192.168.1.10",
        pages: 3, paperSize: "A4", quality: "normal", color: false,
        duplex: false, copies: 1, sizeBytes: 65536, protocol: "raw9100", priority: 1,
      }},
      { op: "transfer_data", printerName: "TestPrinter" },
      { op: "process_queue", printerName: "TestPrinter" },
      // ウォームアップ完了→優先度の高いジョブが自動選択される
      { op: "print_tick", printerName: "TestPrinter" },
    ]));
    // 高優先度ジョブ(Job#2 "high.pdf")が先に印刷開始
    expect(r.events.some(e => e.type === "print_start" && e.message.includes("Job#2"))).toBe(true);
  });
});

describe("simulate関数", () => {
  it("複数のSimOpをまとめて実行", () => {
    const ops: SimOp[] = [
      mkOp([
        { op: "add_printer", printer: testPrinter },
        { op: "add_client", client: testClient },
      ]),
      mkOp([
        { op: "add_printer", printer: { ...testPrinter, name: "Printer2", ip: "192.168.1.101" } },
      ]),
    ];
    const r = simulate(ops);
    expect(r.steps.length).toBe(3);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of PRESETS) {
      const ops = preset.build();
      const r = simulate(ops);
      expect(r.steps.length).toBeGreaterThan(0);
    }
  });

  it("プリセットが10個ある", () => {
    expect(PRESETS).toHaveLength(10);
  });
});

describe("コメント", () => {
  it("コメントがイベントに記録される", () => {
    const r = executeSimulation(mkOp([
      { op: "comment", text: "テストコメント" },
    ]));
    expect(r.events.some(e => e.type === "comment" && e.message === "テストコメント")).toBe(true);
  });
});
