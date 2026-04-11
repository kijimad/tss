import { describe, it, expect } from "vitest";
import { runSimulation } from "../unixsock/engine.js";
import { presets } from "../unixsock/presets.js";
import type { SimOp, Process, SockAddr } from "../unixsock/types.js";

const server: Process = { pid: 100, name: "server", fds: [0, 1, 2], uid: 1000, gid: 1000 };
const client: Process = { pid: 200, name: "client", fds: [0, 1, 2], uid: 1000, gid: 1000 };
const pathAddr: SockAddr = { type: "pathname", path: "/tmp/test.sock" };
const abstractAddr: SockAddr = { type: "abstract", path: "test" };

/** ヘルパー: STREAM接続セットアップ */
function streamSetup(): SimOp[] {
  return [
    { type: "process_create", process: server },
    { type: "process_create", process: client },
    { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
    { type: "bind", fd: 3, addr: pathAddr },
    { type: "listen", fd: 3, backlog: 5 },
    { type: "socket", pid: 200, socketType: "SOCK_STREAM" },
    { type: "connect", fd: 4, addr: pathAddr },
    { type: "accept", fd: 3 },
  ];
}

describe("ソケット作成", () => {
  it("socket()でfdが割り当てられる", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
    ];
    const result = runSimulation(ops);
    expect(result.sockets.length).toBe(1);
    expect(result.sockets[0]!.fd).toBe(3);
    expect(result.sockets[0]!.state).toBe("UNBOUND");
    expect(result.stats.socketCreated).toBe(1);
  });

  it("socketpair()で接続済みペアが作成される", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socketpair", pid: 100, socketType: "SOCK_STREAM" },
    ];
    const result = runSimulation(ops);
    expect(result.sockets.length).toBe(2);
    expect(result.sockets[0]!.state).toBe("CONNECTED");
    expect(result.sockets[1]!.state).toBe("CONNECTED");
    expect(result.sockets[0]!.peerFd).toBe(result.sockets[1]!.fd);
    expect(result.sockets[1]!.peerFd).toBe(result.sockets[0]!.fd);
    expect(result.stats.socketCreated).toBe(2);
  });
});

describe("bind / listen", () => {
  it("bind()でソケットにアドレスがバインドされる", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: pathAddr },
    ];
    const result = runSimulation(ops);
    expect(result.sockets[0]!.state).toBe("BOUND");
    expect(result.sockets[0]!.addr).toEqual(pathAddr);
  });

  it("名前付きソケットのbindでソケットファイルが作成される", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: pathAddr },
    ];
    const result = runSimulation(ops);
    expect(result.socketFiles).toContain("/tmp/test.sock");
  });

  it("抽象名前空間のbindではソケットファイルが作成されない", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: abstractAddr },
    ];
    const result = runSimulation(ops);
    expect(result.socketFiles.length).toBe(0);
  });

  it("listen()でLISTENING状態になる", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "listen", fd: 3, backlog: 5 },
    ];
    const result = runSimulation(ops);
    expect(result.sockets[0]!.state).toBe("LISTENING");
  });

  it("SOCK_DGRAMでlistenするとエラー", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_DGRAM" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "listen", fd: 3, backlog: 5 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.errors).toBe(1);
  });
});

describe("connect / accept", () => {
  it("connect+acceptで接続が確立される", () => {
    const result = runSimulation(streamSetup());
    // fd=4(client)がCONNECTED、fd=5(acceptで生成)がCONNECTED
    const clientSock = result.sockets.find((s) => s.fd === 4);
    const acceptSock = result.sockets.find((s) => s.fd === 5);
    expect(clientSock!.state).toBe("CONNECTED");
    expect(acceptSock!.state).toBe("CONNECTED");
  });

  it("存在しないアドレスへのconnectでエラー", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: client },
      { type: "socket", pid: 200, socketType: "SOCK_STREAM" },
      { type: "connect", fd: 3, addr: { type: "pathname", path: "/nonexistent.sock" } },
    ];
    const result = runSimulation(ops);
    expect(result.stats.errors).toBe(1);
  });

  it("acceptで新しいfdが生成される", () => {
    const result = runSimulation(streamSetup());
    expect(result.sockets.length).toBe(3); // server(3) + client(4) + accepted(5)
    const proc = result.processes.find((p) => p.pid === 100);
    expect(proc!.fds).toContain(5);
  });
});

describe("データ送受信", () => {
  it("send()でデータがピアの受信バッファに入る", () => {
    const ops: SimOp[] = [...streamSetup(), { type: "send", fd: 4, data: "Hello" }];
    const result = runSimulation(ops);
    const acceptSock = result.sockets.find((s) => s.fd === 5);
    expect(acceptSock!.recvBuffer).toEqual(["Hello"]);
    expect(result.stats.bytesSent).toBe(5);
  });

  it("recv()でデータが読み出される", () => {
    const ops: SimOp[] = [
      ...streamSetup(),
      { type: "send", fd: 4, data: "Hello" },
      { type: "recv", fd: 5 },
    ];
    const result = runSimulation(ops);
    expect(result.stats.bytesReceived).toBe(5);
  });

  it("SOCK_STREAM: recv()はバイトストリームとして結合読み出し", () => {
    const ops: SimOp[] = [
      ...streamSetup(),
      { type: "send", fd: 4, data: "A" },
      { type: "send", fd: 4, data: "B" },
      { type: "recv", fd: 5 },
    ];
    const result = runSimulation(ops);
    const recvEvent = result.events.find((e) => e.type === "recv" && e.fd === 5 && e.description.includes("AB"));
    expect(recvEvent).toBeDefined();
  });

  it("SOCK_SEQPACKET: recv()はメッセージ単位で読み出し", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "process_create", process: client },
      { type: "socket", pid: 100, socketType: "SOCK_SEQPACKET" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "listen", fd: 3, backlog: 5 },
      { type: "socket", pid: 200, socketType: "SOCK_SEQPACKET" },
      { type: "connect", fd: 4, addr: pathAddr },
      { type: "accept", fd: 3 },
      { type: "send", fd: 4, data: "MSG1" },
      { type: "send", fd: 4, data: "MSG2" },
      { type: "recv", fd: 5 },
    ];
    const result = runSimulation(ops);
    const recvEvent = result.events.find((e) => e.type === "recv" && e.fd === 5 && e.description.includes("MSG1"));
    expect(recvEvent).toBeDefined();
    // MSG2はまだバッファに残る
    const acceptSock = result.sockets.find((s) => s.fd === 5);
    expect(acceptSock!.recvBuffer).toEqual(["MSG2"]);
  });
});

describe("SOCK_DGRAM (sendto)", () => {
  it("sendtoでコネクションレス送信ができる", () => {
    const dgramAddr: SockAddr = { type: "pathname", path: "/tmp/dgram.sock" };
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "process_create", process: client },
      { type: "socket", pid: 100, socketType: "SOCK_DGRAM" },
      { type: "bind", fd: 3, addr: dgramAddr },
      { type: "socket", pid: 200, socketType: "SOCK_DGRAM" },
      { type: "sendto", fd: 4, data: "LogMessage", addr: dgramAddr },
    ];
    const result = runSimulation(ops);
    const serverSock = result.sockets.find((s) => s.fd === 3);
    expect(serverSock!.recvBuffer).toEqual(["LogMessage"]);
  });
});

describe("fd受け渡し・認証", () => {
  it("SCM_RIGHTSでfd受け渡しが記録される", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socketpair", pid: 100, socketType: "SOCK_STREAM" },
      { type: "sendmsg", fd: 3, data: "pass_fd", ancillary: {
        level: "SOL_SOCKET", type: "SCM_RIGHTS",
        fds: [{ fd: 10, type: "file", description: "testfile" }],
      }},
    ];
    const result = runSimulation(ops);
    expect(result.stats.fdsPassed).toBe(1);
    expect(result.events.some((e) => e.type === "fd_pass")).toBe(true);
  });

  it("SCM_CREDENTIALSで認証情報が記録される", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socketpair", pid: 100, socketType: "SOCK_STREAM" },
      { type: "sendmsg", fd: 3, data: "auth", ancillary: {
        level: "SOL_SOCKET", type: "SCM_CREDENTIALS",
        credentials: { pid: 100, uid: 1000, gid: 1000 },
      }},
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "credential_pass")).toBe(true);
  });
});

describe("close / shutdown / unlink", () => {
  it("close()でソケットがCLOSEDになる", () => {
    const ops: SimOp[] = [
      ...streamSetup(),
      { type: "close", fd: 4 },
    ];
    const result = runSimulation(ops);
    const sock = result.sockets.find((s) => s.fd === 4);
    expect(sock!.state).toBe("CLOSED");
  });

  it("close()でピアにEOFが通知される", () => {
    const ops: SimOp[] = [
      ...streamSetup(),
      { type: "close", fd: 4 },
    ];
    const result = runSimulation(ops);
    const eofEvent = result.events.find((e) => e.type === "recv" && e.description.includes("EOF"));
    expect(eofEvent).toBeDefined();
  });

  it("unlink()でソケットファイルが削除される", () => {
    const ops: SimOp[] = [
      { type: "process_create", process: server },
      { type: "socket", pid: 100, socketType: "SOCK_STREAM" },
      { type: "bind", fd: 3, addr: pathAddr },
      { type: "unlink", path: "/tmp/test.sock" },
    ];
    const result = runSimulation(ops);
    expect(result.socketFiles.length).toBe(0);
  });

  it("shutdown()イベントが記録される", () => {
    const ops: SimOp[] = [
      ...streamSetup(),
      { type: "shutdown", fd: 4, how: "SHUT_WR" },
    ];
    const result = runSimulation(ops);
    expect(result.events.some((e) => e.type === "shutdown")).toBe(true);
  });
});

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("プリセット1（SOCK_STREAM基本）でデータ送受信される", () => {
    const p = presets[0]!;
    const result = runSimulation(p.ops);
    expect(result.stats.bytesSent).toBeGreaterThan(0);
    expect(result.stats.bytesReceived).toBeGreaterThan(0);
  });
});
