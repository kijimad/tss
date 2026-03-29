import { describe, it, expect } from "vitest";
import { parseDockerfile, buildImage, resolveUnionFs, getBaseImage } from "../image/image.js";
import { DockerEngine, ContainerState } from "../engine/engine.js";

describe("Dockerfile パーサー", () => {
  it("基本的な命令をパースする", () => {
    const instrs = parseDockerfile(`FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]`);
    expect(instrs[0]?.type).toBe("FROM");
    expect(instrs[1]?.type).toBe("WORKDIR");
    expect(instrs[2]?.type).toBe("COPY");
    expect(instrs[3]?.type).toBe("RUN");
    expect(instrs[4]?.type).toBe("EXPOSE");
    expect(instrs[5]?.type).toBe("CMD");
  });

  it("コメントを無視する", () => {
    const instrs = parseDockerfile("# comment\nFROM ubuntu\n# another\nRUN echo hi");
    expect(instrs).toHaveLength(2);
  });
});

describe("イメージビルド", () => {
  it("ベースイメージにレイヤーを追加する", () => {
    const instrs = parseDockerfile("FROM ubuntu:22.04\nRUN apt-get install -y curl\nCOPY app.js /app/app.js");
    const ctx = new Map([["app.js", 'console.log("hello")']]);
    const { image } = buildImage(instrs, ctx, "my-app", "latest");
    expect(image.layers.length).toBeGreaterThan(1);
    expect(image.name).toBe("my-app");
  });

  it("UnionFS で全レイヤーを統合する", () => {
    const instrs = parseDockerfile("FROM node:20\nCOPY index.js /app/index.js");
    const ctx = new Map([["index.js", "console.log('hi')"]]);
    const { image } = buildImage(instrs, ctx, "test", "v1");
    const fs = resolveUnionFs(image.layers);
    expect(fs.has("/usr/local/bin/node")).toBe(true);
    expect(fs.has("/app/index.js")).toBe(true);
  });
});

describe("Docker エンジン", () => {
  it("docker pull でイメージを取得する", () => {
    const engine = new DockerEngine();
    const image = engine.pull("ubuntu", "22.04");
    expect(image.name).toBe("ubuntu");
    expect(engine.listImages()).toHaveLength(1);
  });

  it("docker run でコンテナを起動する", () => {
    const engine = new DockerEngine();
    const container = engine.run("ubuntu:22.04", { name: "test-ubuntu" });
    expect(container.state).toBe(ContainerState.Running);
    expect(container.ipAddress).toMatch(/^172\.17\.0\./);
  });

  it("コンテナ内でコマンドを実行する", () => {
    const engine = new DockerEngine();
    const c = engine.run("ubuntu:22.04");
    const output = engine.exec(c.id, "echo hello");
    expect(output).toBe("hello\n");
  });

  it("コンテナの hostname が設定される", () => {
    const engine = new DockerEngine();
    const c = engine.run("ubuntu:22.04");
    const output = engine.exec(c.id, "hostname");
    expect(output).toContain(c.id.slice(0, 12));
  });

  it("docker stop + rm", () => {
    const engine = new DockerEngine();
    const c = engine.run("ubuntu:22.04");
    engine.stop(c.id);
    expect(engine.getContainer(c.id)?.state).toBe(ContainerState.Stopped);
    engine.rm(c.id);
    expect(engine.getContainer(c.id)).toBeUndefined();
  });

  it("docker ps で実行中コンテナ一覧", () => {
    const engine = new DockerEngine();
    engine.run("ubuntu:22.04", { name: "c1" });
    engine.run("node:20", { name: "c2" });
    const running = engine.ps();
    expect(running).toHaveLength(2);
  });

  it("ポートマッピング", () => {
    const engine = new DockerEngine();
    const c = engine.run("nginx:latest", { ports: [{ container: 80, host: 8080 }] });
    expect(c.ports).toHaveLength(1);
    expect(c.ports[0]?.host).toBe(8080);
  });

  it("環境変数", () => {
    const engine = new DockerEngine();
    const c = engine.run("ubuntu:22.04", { env: { MY_VAR: "hello" } });
    const output = engine.exec(c.id, "env");
    expect(output).toContain("MY_VAR=hello");
  });

  it("docker build でカスタムイメージを作成する", () => {
    const engine = new DockerEngine();
    const { image } = engine.build(
      "FROM node:20\nWORKDIR /app\nCOPY server.js /app/server.js\nEXPOSE 3000\nCMD [\"node\", \"server.js\"]",
      new Map([["server.js", "require('http').createServer().listen(3000)"]]),
      "my-app", "v1",
    );
    expect(image.layers.length).toBeGreaterThan(1);
    const c = engine.run("my-app:v1");
    expect(c.state).toBe(ContainerState.Running);
  });

  it("namespace イベントが記録される", () => {
    const engine = new DockerEngine();
    engine.run("ubuntu:22.04");
    const nsEvents = engine.events.filter(e => e.type === "namespace_create");
    expect(nsEvents.length).toBeGreaterThanOrEqual(4); // pid, mnt, net, uts
  });

  it("コンテナ FS は書き込みレイヤーを持つ", () => {
    const engine = new DockerEngine();
    const c = engine.run("ubuntu:22.04");
    const fs = engine.getContainerFs(c);
    expect(fs.has("/bin/bash")).toBe(true);
  });
});
