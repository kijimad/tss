import { describe, it, expect } from "vitest";
import { LinkCable } from "../engine/gbalink.js";
import { EXAMPLES } from "../ui/app.js";

describe("Normal 8-bit", () => {
  it("マスタとスレーブがデータを交換する", () => {
    const cable = new LinkCable();
    cable.connect("M", "master");
    cable.connect("S", "slave");
    const r = cable.transferNormal8([0xAA], [0x55]);
    expect(r.received.get("M")).toEqual([0x55]);
    expect(r.received.get("S")).toEqual([0xAA]);
  });

  it("複数バイトを順次交換する", () => {
    const cable = new LinkCable();
    cable.connect("M", "master");
    cable.connect("S", "slave");
    const r = cable.transferNormal8([0x01, 0x02, 0x03], [0x10, 0x20, 0x30]);
    expect(r.received.get("M")).toEqual([0x10, 0x20, 0x30]);
    expect(r.received.get("S")).toEqual([0x01, 0x02, 0x03]);
    expect(r.mode).toBe("Normal8");
    expect(r.baudRate).toBe("256 kbps");
  });

  it("トレースにピンレベルのビット情報がある", () => {
    const cable = new LinkCable();
    cable.connect("M", "master");
    cable.connect("S", "slave");
    const r = cable.transferNormal8([0xFF], [0x00]);
    expect(r.trace.some((t) => t.phase === "pin" && t.bits !== undefined)).toBe(true);
  });

  it("IRQ が発生する", () => {
    const cable = new LinkCable();
    cable.connect("M", "master");
    cable.connect("S", "slave");
    const r = cable.transferNormal8([0x42], [0x24]);
    expect(r.trace.some((t) => t.phase === "irq")).toBe(true);
  });
});

describe("Normal 32-bit", () => {
  it("32bit ワードを交換する", () => {
    const cable = new LinkCable();
    cable.connect("M", "master");
    cable.connect("S", "slave");
    const r = cable.transferNormal32([0xDEADBEEF], [0xCAFEBABE]);
    expect(r.received.get("M")).toEqual([0xCAFEBABE]);
    expect(r.received.get("S")).toEqual([0xDEADBEEF]);
    expect(r.baudRate).toBe("2 Mbps");
  });
});

describe("Multi-Player", () => {
  it("4台が全員のデータを受信する", () => {
    const cable = new LinkCable();
    cable.connect("P1", "master");
    cable.connect("P2", "slave");
    cable.connect("P3", "slave");
    cable.connect("P4", "slave");
    const send = new Map([["P1", 0x1111], ["P2", 0x2222], ["P3", 0x3333], ["P4", 0x4444]]);
    const r = cable.transferMulti(send);
    expect(r.mode).toBe("MultiPlayer");
    for (const [, data] of r.received) {
      expect(data).toEqual([0x1111, 0x2222, 0x3333, 0x4444]);
    }
  });

  it("2台のマルチプレイヤーも動作する", () => {
    const cable = new LinkCable();
    cable.connect("P1", "master");
    cable.connect("P2", "slave");
    const send = new Map([["P1", 0xAAAA], ["P2", 0xBBBB]]);
    const r = cable.transferMulti(send);
    expect(r.received.get("P1")).toEqual([0xAAAA, 0xBBBB]);
    expect(r.received.get("P2")).toEqual([0xAAAA, 0xBBBB]);
  });

  it("ハンドシェイクがトレースにある", () => {
    const cable = new LinkCable();
    cable.connect("P1", "master");
    cable.connect("P2", "slave");
    const r = cable.transferMulti(new Map([["P1", 1], ["P2", 2]]));
    expect(r.trace.some((t) => t.phase === "handshake")).toBe(true);
  });
});

describe("UART", () => {
  it("ASCII 文字列を送信する", () => {
    const cable = new LinkCable();
    cable.connect("TX", "master");
    cable.connect("RX", "slave");
    const data = [0x48, 0x69]; // "Hi"
    const r = cable.transferUart("TX", data, 9600);
    expect(r.received.get("RX")).toEqual([0x48, 0x69]);
    expect(r.mode).toBe("UART");
    expect(r.baudRate).toBe("9600 baud");
  });

  it("Start/Stop ビットがトレースにある", () => {
    const cable = new LinkCable();
    cable.connect("TX", "master");
    cable.connect("RX", "slave");
    const r = cable.transferUart("TX", [0x41], 115200);
    expect(r.trace.some((t) => t.detail.includes("Start bit"))).toBe(true);
    expect(r.trace.some((t) => t.detail.includes("Stop bit"))).toBe(true);
    expect(r.baudRate).toBe("115200 baud");
  });
});

describe("エラーケース", () => {
  it("マスタなしでエラー", () => {
    const cable = new LinkCable();
    cable.connect("S", "slave");
    const r = cable.transferNormal8([1], [2]);
    expect(r.trace.some((t) => t.phase === "error")).toBe(true);
  });
});

describe("EXAMPLES", () => {
  it("7 つのサンプル", () => { expect(EXAMPLES).toHaveLength(7); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 実行可能`, () => {
      const r = ex.run();
      expect(r.trace.length).toBeGreaterThan(0);
      expect(r.received.size).toBeGreaterThan(0);
    });
  }
});
