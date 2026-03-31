import { describe, it, expect } from "vitest";
import { Cluster } from "../cluster/cluster.js";

const twoNodes = [
  { name: "n1", cpuCapacity: 2000, memCapacity: 4096 },
  { name: "n2", cpuCapacity: 2000, memCapacity: 4096 },
];

const webDep = {
  name: "web", namespace: "default", replicas: 3, selector: { app: "web" },
  template: { labels: { app: "web" }, containers: [{ name: "nginx", image: "nginx", cpuRequest: 100, memRequest: 128 }] },
  strategy: "RollingUpdate" as const, maxUnavailable: 1, maxSurge: 1,
};

describe("Cluster 基本", () => {
  it("ノードが初期化される", () => {
    const c = new Cluster(twoNodes);
    expect(c.snapshot().nodes).toHaveLength(2);
  });

  it("Deployment を apply すると Pod が作成される", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: webDep });
    c.advance(3);
    expect(c.snapshot().pods.length).toBe(3);
  });

  it("Pod が Running になる", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: webDep });
    c.advance(3);
    const running = c.snapshot().pods.filter((p) => p.phase === "Running");
    expect(running.length).toBe(3);
  });

  it("Pod がノードに分散配置される", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: webDep });
    c.advance(3);
    const snap = c.snapshot();
    const n1Pods = snap.nodes.find((n) => n.name === "n1")!.pods.length;
    const n2Pods = snap.nodes.find((n) => n.name === "n2")!.pods.length;
    expect(n1Pods + n2Pods).toBe(3);
    expect(n1Pods).toBeGreaterThan(0);
    expect(n2Pods).toBeGreaterThan(0);
  });
});

describe("スケーリング", () => {
  it("スケールアウトで Pod 数が増える", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: { ...webDep, replicas: 2 } });
    c.advance(3);
    expect(c.snapshot().pods.filter((p) => p.phase === "Running").length).toBe(2);
    c.kubectl({ cmd: "scale", deployment: "web", replicas: 5 });
    c.advance(3);
    expect(c.snapshot().pods.filter((p) => p.phase === "Running").length).toBe(5);
  });

  it("スケールインで Pod 数が減る", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: { ...webDep, replicas: 4 } });
    c.advance(3);
    c.kubectl({ cmd: "scale", deployment: "web", replicas: 1 });
    c.advance(3);
    expect(c.snapshot().pods.filter((p) => p.phase === "Running").length).toBe(1);
  });
});

describe("Pod 削除と自動復旧", () => {
  it("Pod を削除すると ReplicaSet が新しい Pod を作る", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: webDep });
    c.advance(3);
    const podName = c.snapshot().pods[0]!.name;
    c.kubectl({ cmd: "delete-pod", name: podName });
    c.advance(3);
    expect(c.snapshot().pods.filter((p) => p.phase === "Running").length).toBe(3);
  });
});

describe("リソース不足", () => {
  it("リソース不足で Pod が Pending のまま", () => {
    const smallNodes = [{ name: "n1", cpuCapacity: 500, memCapacity: 512 }];
    const c = new Cluster(smallNodes);
    const heavyDep = {
      ...webDep,
      replicas: 3,
      template: {
        labels: { app: "web" },
        containers: [{ name: "heavy", image: "heavy", cpuRequest: 400, memRequest: 400 }],
      },
    };
    c.kubectl({ cmd: "apply-deployment", deployment: heavyDep });
    c.advance(5);
    const pending = c.snapshot().pods.filter((p) => p.phase === "Pending");
    expect(pending.length).toBeGreaterThan(0);
  });
});

describe("Node drain", () => {
  it("drain するとノード上の Pod が別ノードに移動する", () => {
    const c = new Cluster([...twoNodes, { name: "n3", cpuCapacity: 2000, memCapacity: 4096 }]);
    c.kubectl({ cmd: "apply-deployment", deployment: { ...webDep, replicas: 4 } });
    c.advance(3);
    c.kubectl({ cmd: "drain", node: "n1" });
    c.advance(4);
    const snap = c.snapshot();
    const n1Pods = snap.nodes.find((n) => n.name === "n1")!.pods.length;
    expect(n1Pods).toBe(0);
    expect(snap.pods.filter((p) => p.phase === "Running").length).toBe(4);
  });
});

describe("Service", () => {
  it("Service が Running Pod を endpoints に持つ", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: webDep });
    c.kubectl({ cmd: "apply-service", service: { name: "web-svc", namespace: "default", type: "ClusterIP", selector: { app: "web" }, ports: [{ port: 80, targetPort: 80 }], clusterIP: "10.96.0.1", endpoints: [] } });
    c.advance(3);
    const svc = c.snapshot().services.find((s) => s.name === "web-svc")!;
    expect(svc.endpoints.length).toBe(3);
  });
});

describe("イベント", () => {
  it("各操作でイベントが記録される", () => {
    const c = new Cluster(twoNodes);
    c.kubectl({ cmd: "apply-deployment", deployment: webDep });
    c.advance(3);
    expect(c.eventLog.length).toBeGreaterThan(0);
    const kinds = c.eventLog.map((e) => e.kind);
    expect(kinds).toContain("Deployment");
    expect(kinds).toContain("Pod");
  });
});
