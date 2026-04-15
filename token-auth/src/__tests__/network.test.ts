import { describe, it, expect } from "vitest";
import { NETWORK_PRESETS } from "../engine/network.js";
import type { NetworkSimResult } from "../engine/network.js";

describe("NETWORK_PRESETS", () => {
  it("8つのプリセットが定義されている", () => {
    expect(NETWORK_PRESETS).toHaveLength(8);
  });

  it("名前が一意", () => {
    const names = NETWORK_PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const preset of NETWORK_PRESETS) {
    describe(preset.name, () => {
      let result: NetworkSimResult;

      // 各プリセットを実行
      it("実行可能", () => {
        result = preset.run();
        expect(result).toBeDefined();
        expect(result.steps.length).toBeGreaterThan(0);
        expect(result.nodes.length).toBeGreaterThan(0);
      });

      it("ステップ番号が連番", () => {
        result = preset.run();
        for (let i = 0; i < result.steps.length; i++) {
          expect(result.steps[i]!.step).toBe(i + 1);
        }
      });

      it("経過時間が単調増加", () => {
        result = preset.run();
        for (let i = 1; i < result.steps.length; i++) {
          expect(result.steps[i]!.elapsedMs).toBeGreaterThanOrEqual(result.steps[i - 1]!.elapsedMs);
        }
      });

      it("全ステップに必須フィールドが含まれる", () => {
        result = preset.run();
        for (const step of result.steps) {
          expect(step.type).toBeTruthy();
          expect(step.from).toBeTruthy();
          expect(step.to).toBeTruthy();
          expect(step.label).toBeTruthy();
          expect(step.detail).toBeTruthy();
          expect(["safe", "warning", "danger"]).toContain(step.security);
        }
      });

      it("totalMs が最終ステップの elapsedMs 以上", () => {
        result = preset.run();
        const lastStep = result.steps[result.steps.length - 1]!;
        expect(result.totalMs).toBeGreaterThanOrEqual(lastStep.elapsedMs);
      });
    });
  }
});

describe("正常なBearerフロー詳細", () => {
  it("DNS解決、TCP接続、TLSハンドシェイクを含む", () => {
    const result = NETWORK_PRESETS[0]!.run();
    const types = result.steps.map(s => s.type);
    expect(types).toContain("dns_resolve");
    expect(types).toContain("tcp_connect");
    expect(types).toContain("tls_handshake");
  });

  it("HTTPリクエストにBearerヘッダーが含まれる", () => {
    const result = NETWORK_PRESETS[0]!.run();
    const apiRequest = result.steps.find(s => s.type === "token_attach");
    expect(apiRequest).toBeDefined();
    expect(apiRequest!.data?.header).toContain("Bearer");
  });

  it("JWTとverificationが返される", () => {
    const result = NETWORK_PRESETS[0]!.run();
    expect(result.jwt).toBeDefined();
    expect(result.jwt!.raw.split(".")).toHaveLength(3);
    expect(result.verification).toBeDefined();
    expect(result.verification!.valid).toBe(true);
  });

  it("TLS情報が含まれる", () => {
    const result = NETWORK_PRESETS[0]!.run();
    const tlsStep = result.steps.find(s => s.tls);
    expect(tlsStep).toBeDefined();
    expect(tlsStep!.tls!.version).toBe("TLS 1.3");
    expect(tlsStep!.tls!.certValid).toBe(true);
  });
});

describe("MITM攻撃シナリオ", () => {
  it("攻撃者がトークンを傍受する", () => {
    const result = NETWORK_PRESETS[1]!.run();
    const intercept = result.steps.find(s => s.type === "token_intercept");
    expect(intercept).toBeDefined();
    expect(intercept!.security).toBe("danger");
  });

  it("リプレイ攻撃ステップが含まれる", () => {
    const result = NETWORK_PRESETS[1]!.run();
    const replay = result.steps.find(s => s.type === "token_replay");
    expect(replay).toBeDefined();
    expect(replay!.security).toBe("danger");
  });

  it("攻撃者ノードにトークンがコピーされる", () => {
    const result = NETWORK_PRESETS[1]!.run();
    const attackerNode = result.nodes.find(n => n.role === "attacker");
    expect(attackerNode).toBeDefined();
    expect(attackerNode!.tokens.length).toBeGreaterThan(0);
  });
});

describe("トークンリフレッシュフロー", () => {
  it("401レスポンスの後にリフレッシュが発生する", () => {
    const result = NETWORK_PRESETS[2]!.run();
    const types = result.steps.map(s => s.type);
    // 401レスポンスがある
    const resp401 = result.steps.find(s => s.response?.status === 401);
    expect(resp401).toBeDefined();
    // リフレッシュステップがある
    expect(types).toContain("token_refresh");
    // 最終的に200 OKが返る
    const last200 = result.steps.filter(s => s.response?.status === 200);
    expect(last200.length).toBeGreaterThan(0);
  });
});

describe("XSS窃取シナリオ", () => {
  it("トークン傍受とリプレイが含まれる", () => {
    const result = NETWORK_PRESETS[4]!.run();
    const types = result.steps.map(s => s.type);
    expect(types).toContain("token_intercept");
    expect(types).toContain("token_replay");
  });

  it("danger セキュリティレベルが複数含まれる", () => {
    const result = NETWORK_PRESETS[4]!.run();
    const dangerSteps = result.steps.filter(s => s.security === "danger");
    expect(dangerSteps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("マイクロサービス間認証", () => {
  it("4つ以上のノードが定義される", () => {
    const result = NETWORK_PRESETS[5]!.run();
    expect(result.nodes.length).toBeGreaterThanOrEqual(4);
  });

  it("内部トークン生成ステップが含まれる", () => {
    const result = NETWORK_PRESETS[5]!.run();
    const tokenGen = result.steps.filter(s => s.type === "token_generate");
    expect(tokenGen.length).toBeGreaterThanOrEqual(1);
  });
});

describe("トークン無効化", () => {
  it("token_revokeステップが含まれる", () => {
    const result = NETWORK_PRESETS[6]!.run();
    const revoke = result.steps.find(s => s.type === "token_revoke");
    expect(revoke).toBeDefined();
    expect(revoke!.data?.jti).toBeTruthy();
  });

  it("無効化前は200、無効化後は401が返る", () => {
    const result = NETWORK_PRESETS[6]!.run();
    const responses = result.steps.filter(s => s.response);
    const statuses = responses.map(s => s.response!.status);
    expect(statuses).toContain(200);
    expect(statuses).toContain(401);
  });
});

describe("Bearer vs Cookie 比較", () => {
  it("Bearer方式とCookie方式の両方が含まれる", () => {
    const result = NETWORK_PRESETS[7]!.run();
    const labels = result.steps.map(s => s.label);
    const hasBearer = labels.some(l => l.includes("Bearer"));
    const hasCookie = labels.some(l => l.includes("Cookie"));
    expect(hasBearer).toBe(true);
    expect(hasCookie).toBe(true);
  });
});
