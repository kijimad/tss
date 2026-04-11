import { describe, it, expect } from "vitest";
import { runSimulation } from "../iobuf/engine.js";
import { presets } from "../iobuf/presets.js";
import type { SimOp } from "../iobuf/types.js";

describe("ファイルオープン", () => {
  it("端末は行バッファになる", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
    ];
    const result = runSimulation(ops);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.stdioBuf.mode).toBe("line_buffered");
  });

  it("通常ファイルはフルバッファになる", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
    ];
    const result = runSimulation(ops);
    expect(result.files[0]!.stdioBuf.mode).toBe("fully_buffered");
    expect(result.files[0]!.stdioBuf.capacity).toBe(4096);
  });
});

describe("unbufferedモード", () => {
  it("unbufferedは即座にカーネルへ転送", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 2, path: "/dev/stderr", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "setvbuf", fd: 2, mode: "unbuffered", size: 0 },
      { type: "printf", fd: 2, text: "error!" },
    ];
    const result = runSimulation(ops);
    expect(result.stats.autoFlushes).toBe(1);
    expect(result.files[0]!.stdioBuf.used).toBe(0);
  });
});

describe("line_bufferedモード", () => {
  it("改行なしではバッファに蓄積", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "printf", fd: 1, text: "hello " },
    ];
    const result = runSimulation(ops);
    expect(result.files[0]!.stdioBuf.used).toBe(6);
    expect(result.files[0]!.stdioBuf.dirty).toBe(true);
  });

  it("改行で自動フラッシュ", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "printf", fd: 1, text: "hello\n" },
    ];
    const result = runSimulation(ops);
    expect(result.files[0]!.stdioBuf.used).toBe(0);
    expect(result.stats.autoFlushes).toBe(1);
  });
});

describe("fully_bufferedモード", () => {
  it("改行があってもバッファに蓄積", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "printf", fd: 3, text: "line 1\n" },
    ];
    const result = runSimulation(ops);
    expect(result.files[0]!.stdioBuf.used).toBe(7);
    expect(result.stats.autoFlushes).toBe(0);
  });

  it("バッファ満杯で自動フラッシュ", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "setvbuf", fd: 3, mode: "fully_buffered", size: 16 },
      { type: "fwrite", fd: 3, data: "AAAAAAAAAA", size: 10 },
      { type: "fwrite", fd: 3, data: "BBBBBB", size: 6 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.autoFlushes).toBe(1);
    expect(result.files[0]!.stdioBuf.used).toBe(0);
  });
});

describe("fflush", () => {
  it("fflush()でstdioバッファがカーネルに転送される", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "printf", fd: 3, text: "data" },
      { type: "fflush", fd: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.files[0]!.stdioBuf.used).toBe(0);
    expect(result.stats.stdioFlushes).toBe(1);
  });
});

describe("setvbuf", () => {
  it("バッファモードを変更できる", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 1, path: "/dev/tty", flags: ["O_WRONLY"], fdType: "terminal" },
      { type: "setvbuf", fd: 1, mode: "fully_buffered", size: 8192 },
    ];
    const result = runSimulation(ops);
    expect(result.files[0]!.stdioBuf.mode).toBe("fully_buffered");
    expect(result.files[0]!.stdioBuf.capacity).toBe(8192);
  });
});

describe("低レベルI/O (write/read)", () => {
  it("write()はstdioバッファをバイパス", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "write", fd: 3, data: "direct", size: 6 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.kernelWrites).toBeGreaterThan(0);
    expect(result.stats.bytesWritten).toBe(6);
  });

  it("read()でページキャッシュから読み取り", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/in.txt", flags: ["O_RDONLY"], fdType: "regular" },
      { type: "read", fd: 3, size: 100 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.kernelReads).toBeGreaterThanOrEqual(1);
    expect(result.stats.bytesRead).toBe(100);
  });
});

describe("fsync / fdatasync", () => {
  it("fsync()でダーティページがディスクに書き出される", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "write", fd: 3, data: "important", size: 9 },
      { type: "fsync", fd: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.fsyncs).toBe(1);
    expect(result.diskBlocks.length).toBeGreaterThan(0);
    expect(result.events.some((e) => e.level === "disk_platter")).toBe(true);
  });

  it("fdatasync()はメタデータを省略", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "write", fd: 3, data: "data", size: 4 },
      { type: "fdatasync", fd: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.fsyncs).toBe(1);
    expect(result.events.some((e) => e.type === "fdatasync")).toBe(true);
  });
});

describe("ページキャッシュ", () => {
  it("同じブロックへの書き込みはキャッシュヒット", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "write", fd: 3, data: "first", size: 5 },
      { type: "write", fd: 3, data: "second", size: 6 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.pageCacheHits).toBeGreaterThan(0);
  });

  it("readaheadで先読みされる", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/in.txt", flags: ["O_RDONLY"], fdType: "regular" },
      { type: "readahead", fd: 3, startBlock: 0, count: 4 },
    ];
    const result = runSimulation(ops);
    expect(result.pageCache.pages.length).toBe(4);
  });
});

describe("close", () => {
  it("close時に残りバッファがフラッシュされる", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "printf", fd: 3, text: "unflushed" },
      { type: "close", fd: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.stdioFlushes).toBe(1);
  });
});

describe("fgetc / fgets / fread", () => {
  it("stdio読み取りでバッファが補充される", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/in.txt", flags: ["O_RDONLY"], fdType: "regular" },
      { type: "fgetc", fd: 3 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.stdioReads).toBe(1);
  });
});

describe("O_DIRECT", () => {
  it("O_DIRECTはページキャッシュをバイパス", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/direct.dat", flags: ["O_WRONLY", "O_DIRECT"], fdType: "regular" },
      { type: "o_direct_write", fd: 3, data: "direct", size: 4096 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.diskIOs).toBe(1);
    expect(result.pageCache.pages.length).toBe(0);
  });
});

describe("パイプ", () => {
  it("パイプバッファリングのイベントが生成される", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "pipe:[1]", flags: ["O_WRONLY"], fdType: "pipe" },
      { type: "pipe_write", fd: 3, data: "msg", size: 3, pipeCapacity: 65536, used: 0 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "pipe")).toBe(true);
  });
});

describe("writeback", () => {
  it("pdflush起床でダーティページが書き出される", () => {
    const ops: SimOp[] = [
      { type: "open", fd: 3, path: "/tmp/out.txt", flags: ["O_WRONLY"], fdType: "regular" },
      { type: "write", fd: 3, data: "data", size: 4 },
      { type: "pdflush_wakeup", dirtyRatio: 15 },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "pdflush")).toBe(true);
    expect(result.events.some((e) => e.type === "writeback")).toBe(true);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });
});
