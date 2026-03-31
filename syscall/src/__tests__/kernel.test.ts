import { describe, it, expect, beforeEach } from "vitest";
import { Kernel } from "../kernel/kernel.js";
import type { SyscallInvocation } from "../kernel/kernel.js";

function call(name: string, args: unknown[], code?: string): SyscallInvocation {
  return { name, args, code: code ?? `${name}(${args.join(", ")})` };
}

describe("Kernel 初期状態", () => {
  it("fd 0,1,2 が初期化されている", () => {
    const k = new Kernel();
    const snap = k.snapshot();
    expect(snap.fdTable).toHaveLength(3);
    expect(snap.fdTable[0]!.fd).toBe(0);
    expect(snap.fdTable[1]!.fd).toBe(1);
    expect(snap.fdTable[2]!.fd).toBe(2);
  });

  it("init (PID 1) と user_prog (PID 100) が存在する", () => {
    const k = new Kernel();
    const snap = k.snapshot();
    expect(snap.processes.find((p) => p.pid === 1)).toBeDefined();
    expect(snap.processes.find((p) => p.pid === 100)).toBeDefined();
  });

  it("メモリ領域に text, data, heap, stack がある", () => {
    const k = new Kernel();
    const names = k.snapshot().memory.map((m) => m.name);
    expect(names).toContain("[text]");
    expect(names).toContain("[data]");
    expect(names).toContain("[heap]");
    expect(names).toContain("[stack]");
  });
});

describe("ファイル I/O", () => {
  let k: Kernel;
  beforeEach(() => { k = new Kernel(); });

  it("open で fd が割り当てられる", () => {
    const res = k.execute(call("open", ["/etc/hostname", "O_RDONLY"]));
    expect(res.returnValue).toBe(3);
    expect(res.errno).toBe(0);
    expect(k.snapshot().fdTable).toHaveLength(4);
  });

  it("存在しないファイルの open は ENOENT", () => {
    const res = k.execute(call("open", ["/nonexistent", "O_RDONLY"]));
    expect(res.returnValue).toBe(-1);
    expect(res.errname).toBe("ENOENT");
  });

  it("O_CREAT でファイルを新規作成できる", () => {
    const res = k.execute(call("open", ["/tmp/new.txt", "O_WRONLY,O_CREAT"]));
    expect(res.returnValue).toBe(3);
  });

  it("read でバイト数が返る", () => {
    k.execute(call("open", ["/etc/hostname", "O_RDONLY"]));
    const res = k.execute(call("read", [3, 128]));
    expect(res.returnValue).toBeGreaterThan(0);
  });

  it("write でバイト数が返る", () => {
    k.execute(call("open", ["/tmp/out.txt", "O_WRONLY,O_CREAT"]));
    const res = k.execute(call("write", [3, "hello"]));
    expect(res.returnValue).toBe(5);
  });

  it("close で fd が解放される", () => {
    k.execute(call("open", ["/etc/hostname", "O_RDONLY"]));
    const res = k.execute(call("close", [3]));
    expect(res.returnValue).toBe(0);
    expect(k.snapshot().fdTable).toHaveLength(3);
  });

  it("無効な fd への操作は EBADF", () => {
    const res = k.execute(call("close", [99]));
    expect(res.errname).toBe("EBADF");
  });

  it("lseek で offset を変更できる", () => {
    k.execute(call("open", ["/etc/hostname", "O_RDONLY"]));
    const res = k.execute(call("lseek", [3, 5, "SEEK_SET"]));
    expect(res.returnValue).toBe(5);
  });

  it("stat でファイル情報を取得できる", () => {
    const res = k.execute(call("stat", ["/etc/hostname"]));
    expect(res.returnValue).toBe(0);
  });
});

describe("プロセス管理", () => {
  let k: Kernel;
  beforeEach(() => { k = new Kernel(); });

  it("fork で子プロセスが作成される", () => {
    const res = k.execute(call("fork", []));
    expect(res.returnValue).toBeGreaterThan(100);
    expect(k.snapshot().processes.length).toBe(3);
  });

  it("getpid が現在の PID を返す", () => {
    const res = k.execute(call("getpid", []));
    expect(res.returnValue).toBe(100);
  });

  it("execve でプロセス名が変わる", () => {
    k.execute(call("fork", []));
    k.execute(call("execve", ["/bin/ls"]));
    const procs = k.snapshot().processes;
    expect(procs.some((p) => p.name === "ls")).toBe(true);
  });

  it("exit でプロセスが zombie になる", () => {
    k.execute(call("fork", []));
    k.execute(call("exit", [42]));
    const zombie = k.snapshot().processes.find((p) => p.state === "zombie");
    expect(zombie).toBeDefined();
    expect(zombie!.exitCode).toBe(42);
  });

  it("wait で zombie を回収できる", () => {
    k.execute(call("fork", []));
    k.execute(call("exit", [0]));
    const res = k.execute(call("wait", []));
    expect(res.returnValue).toBeGreaterThan(100);
    const zombies = k.snapshot().processes.filter((p) => p.state === "zombie");
    expect(zombies).toHaveLength(0);
  });
});

describe("メモリ管理", () => {
  let k: Kernel;
  beforeEach(() => { k = new Kernel(); });

  it("brk でヒープが拡張される", () => {
    const before = k.snapshot().memory.find((m) => m.name === "[heap]")!.size;
    k.execute(call("brk", [4096]));
    const after = k.snapshot().memory.find((m) => m.name === "[heap]")!.size;
    expect(after).toBe(before + 4096);
  });

  it("mmap で新しい領域が作成される", () => {
    const before = k.snapshot().memory.length;
    const res = k.execute(call("mmap", [65536, "rw-p"]));
    expect(res.returnValue).toBeGreaterThan(0);
    expect(k.snapshot().memory.length).toBe(before + 1);
  });

  it("munmap で領域が解放される", () => {
    const res = k.execute(call("mmap", [65536, "rw-p"]));
    const addr = res.returnValue;
    const before = k.snapshot().memory.length;
    k.execute(call("munmap", [addr]));
    expect(k.snapshot().memory.length).toBe(before - 1);
  });
});

describe("パイプ", () => {
  let k: Kernel;
  beforeEach(() => { k = new Kernel(); });

  it("pipe で 2 つの fd が作成される", () => {
    const before = k.snapshot().fdTable.length;
    k.execute(call("pipe", []));
    expect(k.snapshot().fdTable.length).toBe(before + 2);
  });

  it("dup2 で fd を複製できる", () => {
    k.execute(call("pipe", []));
    k.execute(call("dup2", [4, 1]));
    const fd1 = k.snapshot().fdTable.find((e) => e.fd === 1);
    expect(fd1!.path).toContain("pipe");
  });
});

describe("ソケット", () => {
  let k: Kernel;
  beforeEach(() => { k = new Kernel(); });

  it("socket で fd が作成される", () => {
    const res = k.execute(call("socket", ["AF_INET", "SOCK_STREAM"]));
    expect(res.returnValue).toBe(3);
    expect(k.snapshot().fdTable.find((e) => e.fd === 3)!.type).toBe("socket");
  });

  it("bind → listen → accept の流れが動作する", () => {
    k.execute(call("socket", ["AF_INET", "SOCK_STREAM"]));
    const bindRes = k.execute(call("bind", [3, "0.0.0.0", 8080]));
    expect(bindRes.returnValue).toBe(0);
    const listenRes = k.execute(call("listen", [3, 128]));
    expect(listenRes.returnValue).toBe(0);
    const acceptRes = k.execute(call("accept", [3]));
    expect(acceptRes.returnValue).toBeGreaterThan(3);
  });
});

describe("シグナル", () => {
  let k: Kernel;
  beforeEach(() => { k = new Kernel(); });

  it("kill SIGTERM でプロセスが zombie になる", () => {
    k.execute(call("fork", []));
    const child = k.snapshot().processes.find((p) => p.pid > 100);
    k.execute(call("kill", [child!.pid, 15]));
    const updated = k.snapshot().processes.find((p) => p.pid === child!.pid);
    expect(updated!.state).toBe("zombie");
  });
});

describe("トレース", () => {
  it("全てのシステムコールで user → trap → kernel → return のトレースが生成される", () => {
    const k = new Kernel();
    const res = k.execute(call("getpid", []));
    const modes = res.trace.map((t) => t.mode);
    expect(modes[0]).toBe("user");
    expect(modes[1]).toBe("trap");
    expect(modes.includes("kernel")).toBe(true);
    expect(modes[modes.length - 1]).toBe("return");
  });

  it("未知のシステムコールは ENOSYS を返す", () => {
    const k = new Kernel();
    const res = k.execute(call("unknown_syscall", []));
    expect(res.errname).toBe("ENOSYS");
  });
});
