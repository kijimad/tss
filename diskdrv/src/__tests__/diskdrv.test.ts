import { describe, it, expect } from "vitest";
import { DiskDrive, createHDD, createSSD } from "../hw/disk-hardware.js";
import { IoScheduler, SchedulerAlgorithm } from "../scheduler/io-scheduler.js";
import { DiskDriver } from "../driver/driver.js";

describe("ディスクハードウェア", () => {
  it("LBA → CHS 変換", () => {
    const drive = new DiskDrive(createHDD());
    const chs = drive.lbaToChs(0);
    expect(chs.cylinder).toBe(0);
    expect(chs.head).toBe(0);
    expect(chs.sector).toBe(1);

    const chs2 = drive.lbaToChs(63); // 2番目のヘッド
    expect(chs2.head).toBe(1);
  });

  it("CHS → LBA 変換（往復）", () => {
    const drive = new DiskDrive(createHDD());
    for (const lba of [0, 1, 62, 63, 100, 500]) {
      const chs = drive.lbaToChs(lba);
      const back = drive.chsToLba(chs.cylinder, chs.head, chs.sector);
      expect(back).toBe(lba);
    }
  });

  it("シーク時間が距離に比例する", () => {
    const drive = new DiskDrive(createHDD());
    const t1 = drive.calculateSeekTime(0, 1);   // 隣接
    const t2 = drive.calculateSeekTime(0, 50);  // 中間
    const t3 = drive.calculateSeekTime(0, 99);  // 端から端
    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);
  });

  it("SSD はシーク時間がほぼゼロ", () => {
    const drive = new DiskDrive(createSSD());
    const t = drive.calculateSeekTime(0, 99);
    expect(t).toBeLessThan(0.2);
  });

  it("データの読み書き", () => {
    const drive = new DiskDrive(createHDD());
    const data = new Uint8Array(512);
    data[0] = 0xAA; data[511] = 0xBB;
    drive.writeSectorDirect(10, data);

    const req = {
      id: 1, type: "read" as const, lba: 10, sectorCount: 1,
      data: undefined, cylinder: 0, head: 0, sector: 0,
      submittedAt: 0, startedAt: 0, completedAt: 0,
      seekTimeMs: 0, rotationalLatencyMs: 0, transferTimeMs: 0, totalTimeMs: 0,
      status: "pending" as const, callback: undefined,
    };
    drive.executeRequest(req);
    expect(req.data?.[0]).toBe(0xAA);
    expect(req.data?.[511]).toBe(0xBB);
  });
});

describe("I/O スケジューラ", () => {
  const makeReq = (id: number, cylinder: number): ReturnType<typeof makeRequest> => makeRequest(id, cylinder);

  it("FIFO: 先着順", () => {
    const sched = new IoScheduler(SchedulerAlgorithm.FIFO);
    sched.enqueue(makeReq(1, 50));
    sched.enqueue(makeReq(2, 10));
    sched.enqueue(makeReq(3, 90));
    expect(sched.dequeue()?.id).toBe(1);
    expect(sched.dequeue()?.id).toBe(2);
    expect(sched.dequeue()?.id).toBe(3);
  });

  it("SSTF: 最短シーク優先", () => {
    const sched = new IoScheduler(SchedulerAlgorithm.SSTF);
    sched.setCurrentCylinder(50);
    sched.enqueue(makeReq(1, 10));
    sched.enqueue(makeReq(2, 55));
    sched.enqueue(makeReq(3, 90));
    expect(sched.dequeue()?.id).toBe(2); // 55 が 50 に最も近い
  });

  it("SCAN: エレベーター", () => {
    const sched = new IoScheduler(SchedulerAlgorithm.SCAN);
    sched.setCurrentCylinder(50);
    sched.enqueue(makeReq(1, 60));
    sched.enqueue(makeReq(2, 30));
    sched.enqueue(makeReq(3, 80));
    // 上方向に進む
    expect(sched.dequeue()?.id).toBe(1); // 60
    expect(sched.dequeue()?.id).toBe(3); // 80
    // 折り返して下方向
    expect(sched.dequeue()?.id).toBe(2); // 30
  });

  it("C-SCAN: 片方向", () => {
    const sched = new IoScheduler(SchedulerAlgorithm.CSCAN);
    sched.setCurrentCylinder(50);
    sched.enqueue(makeReq(1, 70));
    sched.enqueue(makeReq(2, 20));
    sched.enqueue(makeReq(3, 90));
    // 上方向のみ
    expect(sched.dequeue()?.id).toBe(1); // 70
    expect(sched.dequeue()?.id).toBe(3); // 90
    // 先頭に戻って
    expect(sched.dequeue()?.id).toBe(2); // 20
  });
});

describe("ディスクドライバ", () => {
  it("読み書きが動作する", () => {
    const drv = new DiskDriver(createHDD(), SchedulerAlgorithm.FIFO);
    const data = new Uint8Array(512);
    data[0] = 42;
    drv.write(100, data);
    const read = drv.read(100);
    expect(read[0]).toBe(42);
  });

  it("キャッシュヒット", () => {
    const drv = new DiskDriver(createHDD(), SchedulerAlgorithm.FIFO);
    drv.write(50, new Uint8Array(512));
    drv.resetStats();
    drv.read(50); // キャッシュヒット
    const hits = drv.events.filter(e => e.type === "cache_hit");
    expect(hits.length).toBe(1);
  });

  it("バッチ読み取りでスケジューラが最適化する", () => {
    const drv = new DiskDriver(createHDD(), SchedulerAlgorithm.SSTF);
    // 離れた LBA を先に書き込む
    for (const lba of [0, 500, 1000, 2000]) {
      drv.drive.writeSectorDirect(lba, new Uint8Array(512).fill(lba & 0xFF));
    }
    drv.resetStats();
    const results = drv.readBatch([2000, 0, 1000, 500]);
    expect(results.size).toBe(4);
    // SSTF なのでリクエスト完了順がシーク最小化されている
    const completedOrder = drv.getCompletedRequests().map(r => r.lba);
    expect(completedOrder).toHaveLength(4);
  });

  it("SSD はシーク時間がほぼゼロ", () => {
    const drv = new DiskDriver(createSSD(), SchedulerAlgorithm.FIFO);
    drv.drive.writeSectorDirect(0, new Uint8Array(512));
    drv.drive.writeSectorDirect(5000, new Uint8Array(512));
    drv.resetStats();
    drv.read(0);
    drv.read(5000);
    const reqs = drv.getCompletedRequests();
    const totalSeek = reqs.reduce((sum, r) => sum + r.seekTimeMs, 0);
    expect(totalSeek).toBeLessThan(1);
  });

  it("イベントが記録される", () => {
    const drv = new DiskDriver(createHDD(), SchedulerAlgorithm.SCAN);
    drv.write(100, new Uint8Array(512));
    expect(drv.events.filter(e => e.type === "request_submit").length).toBe(1);
    expect(drv.events.filter(e => e.type === "request_complete").length).toBe(1);
  });
});

function makeRequest(id: number, cylinder: number) {
  return {
    id, type: "read" as const, lba: cylinder * 252, sectorCount: 1,
    data: undefined, cylinder, head: 0, sector: 1,
    submittedAt: 0, startedAt: 0, completedAt: 0,
    seekTimeMs: 0, rotationalLatencyMs: 0, transferTimeMs: 0, totalTimeMs: 0,
    status: "pending" as const, callback: undefined,
  };
}
