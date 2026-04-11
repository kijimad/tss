/* MITM シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, simulateAttack,
  defaultNodes, validCert, forgedCert,
  createPacket, tamperPacket, encryptPayload, tryDecrypt,
  normalArpTable, arpSpoof, normalDnsRecords, dnsSpoof,
  validateTls, attackMethodLabel,
  noDefense, fullDefense, hstsOnly, certDefense,
} from "../mitm/engine.js";
import { PRESETS } from "../mitm/presets.js";
import type { SimOp, AttackStep, SimEvent, Defense } from "../mitm/types.js";

describe("MITM Engine", () => {
  // ─── ノード ───

  describe("ネットワークノード", () => {
    it("デフォルトノードが5つ生成される", () => {
      const nodes = defaultNodes();
      expect(nodes).toHaveLength(5);
      expect(nodes.map(n => n.role)).toContain("client");
      expect(nodes.map(n => n.role)).toContain("server");
      expect(nodes.map(n => n.role)).toContain("attacker");
    });
  });

  // ─── 証明書 ───

  describe("証明書", () => {
    it("正規証明書はvalidCa=true", () => {
      const cert = validCert("example.com");
      expect(cert.validCa).toBe(true);
      expect(cert.selfSigned).toBe(false);
      expect(cert.domainMatch).toBe(true);
    });

    it("偽証明書はselfSigned=true", () => {
      const cert = forgedCert("example.com");
      expect(cert.validCa).toBe(false);
      expect(cert.selfSigned).toBe(true);
    });
  });

  // ─── パケット ───

  describe("パケット", () => {
    it("パケットが正しく生成される", () => {
      const pkt = createPacket("http", "1.1.1.1", "2.2.2.2", "AA:BB", "CC:DD", "hello", false, "none");
      expect(pkt.protocol).toBe("http");
      expect(pkt.srcIp).toBe("1.1.1.1");
      expect(pkt.payload).toBe("hello");
      expect(pkt.tampered).toBe(false);
    });

    it("パケット改ざんでtamperedがtrueになる", () => {
      const pkt = createPacket("http", "1.1.1.1", "2.2.2.2", "AA:BB", "CC:DD", "hello", false, "none");
      const t = tamperPacket(pkt, "hacked");
      expect(t.tampered).toBe(true);
      expect(t.payload).toBe("hacked");
      expect(t.originalPayload).toBe("hello");
    });

    it("暗号化ペイロードが元と異なる", () => {
      const enc = encryptPayload("secret");
      expect(enc).not.toBe("secret");
      expect(enc.length).toBeGreaterThan(0);
    });

    it("平文は復号成功、暗号文は復号失敗", () => {
      expect(tryDecrypt("hello", false).success).toBe(true);
      expect(tryDecrypt("encrypted", true).success).toBe(false);
    });
  });

  // ─── ARPスプーフィング ───

  describe("ARPスプーフィング", () => {
    it("防御なしでARPテーブルが汚染される", () => {
      const nodes = defaultNodes();
      const table = normalArpTable(nodes);
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const result = arpSpoof(table, "203.0.113.50", "AA:BB:CC:DD:EE:99", noDefense(), steps, events);
      expect(result.success).toBe(true);
      const spoofed = result.table.find(e => e.ip === "203.0.113.50");
      expect(spoofed?.mac).toBe("AA:BB:CC:DD:EE:99");
      expect(spoofed?.spoofed).toBe(true);
    });

    it("静的ARPでスプーフィングがブロックされる", () => {
      const nodes = defaultNodes();
      const table = normalArpTable(nodes);
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const defense: Defense = { ...noDefense(), staticArp: true };
      const result = arpSpoof(table, "203.0.113.50", "AA:BB:CC:DD:EE:99", defense, steps, events);
      expect(result.success).toBe(false);
    });
  });

  // ─── DNSスプーフィング ───

  describe("DNSスプーフィング", () => {
    it("防御なしでDNSレコードが汚染される", () => {
      const records = normalDnsRecords();
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const result = dnsSpoof(records, "example.com", "6.6.6.6", noDefense(), steps, events);
      expect(result.success).toBe(true);
      const spoofed = result.records.find(r => r.domain === "example.com");
      expect(spoofed?.ip).toBe("6.6.6.6");
      expect(spoofed?.spoofed).toBe(true);
    });

    it("DNSSECでスプーフィングがブロックされる", () => {
      const records = normalDnsRecords();
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const defense: Defense = { ...noDefense(), dnssec: true };
      const result = dnsSpoof(records, "example.com", "6.6.6.6", defense, steps, events);
      expect(result.success).toBe(false);
    });
  });

  // ─── TLS検証 ───

  describe("TLS検証", () => {
    it("TLSなしは検証パス", () => {
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const result = validateTls("none", undefined, noDefense(), steps, events);
      expect(result.valid).toBe(true);
    });

    it("正規証明書は検証パス", () => {
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const result = validateTls("tls1.2", validCert("example.com"), noDefense(), steps, events);
      expect(result.valid).toBe(true);
    });

    it("偽証明書+厳格検証で拒否される", () => {
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const defense: Defense = { ...noDefense(), strictCertValidation: true };
      const result = validateTls("tls1.2", forgedCert("example.com"), defense, steps, events);
      expect(result.valid).toBe(false);
    });

    it("証明書ピンニングで偽証明書が検出される", () => {
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const defense: Defense = { ...noDefense(), certPinning: true };
      const result = validateTls("tls1.2", forgedCert("example.com"), defense, steps, events);
      expect(result.valid).toBe(false);
    });

    it("TLSバージョンが最小要件を満たさない場合は拒否される", () => {
      const steps: AttackStep[] = [];
      const events: SimEvent[] = [];
      const defense: Defense = { ...noDefense(), minTls: "tls1.2" };
      const result = validateTls("tls1.0", validCert("example.com"), defense, steps, events);
      expect(result.valid).toBe(false);
    });
  });

  // ─── 攻撃シミュレーション ───

  describe("攻撃シミュレーション", () => {
    it("ARPスプーフィング+HTTPでデータ漏洩する", () => {
      const op: SimOp = {
        type: "attack", method: "arp_spoofing", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "password=secret",
      };
      const result = simulateAttack(op);
      expect(result.intercepted).toBe(true);
      expect(result.dataLeaked).toBe(true);
    });

    it("ARPスプーフィング+HTTPSでは暗号化により読取不可", () => {
      const op: SimOp = {
        type: "attack", method: "arp_spoofing", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "password=secret",
      };
      const result = simulateAttack(op);
      expect(result.intercepted).toBe(true);
      expect(result.dataLeaked).toBe(false);
    });

    it("SSLストリッピングでHTTPS通信が平文化される", () => {
      const op: SimOp = {
        type: "attack", method: "ssl_stripping", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "credit_card=4111111111111111",
      };
      const result = simulateAttack(op);
      expect(result.dataLeaked).toBe(true);
    });

    it("HSTSによりSSLストリッピングがブロックされる", () => {
      const op: SimOp = {
        type: "attack", method: "ssl_stripping", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: hstsOnly(), httpPayload: "credit_card=4111111111111111",
      };
      const result = simulateAttack(op);
      expect(result.blocked.length).toBeGreaterThan(0);
      expect(result.dataLeaked).toBe(false);
    });

    it("偽証明書+検証なしで攻撃成功", () => {
      const op: SimOp = {
        type: "attack", method: "rogue_cert", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "secret=data",
      };
      const result = simulateAttack(op);
      expect(result.dataLeaked).toBe(true);
    });

    it("偽証明書+厳格検証で攻撃失敗", () => {
      const op: SimOp = {
        type: "attack", method: "rogue_cert", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: certDefense(), httpPayload: "secret=data",
      };
      const result = simulateAttack(op);
      expect(result.blocked.length).toBeGreaterThan(0);
      expect(result.dataLeaked).toBe(false);
    });

    it("セッションハイジャック+HTTPで成功", () => {
      const op: SimOp = {
        type: "attack", method: "session_hijack", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "session data",
      };
      const result = simulateAttack(op);
      expect(result.dataLeaked).toBe(true);
    });

    it("パケットインジェクション+HTTPで改ざん成功", () => {
      const op: SimOp = {
        type: "attack", method: "packet_injection", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "normal content",
      };
      const result = simulateAttack(op);
      expect(result.tampered).toBe(true);
    });

    it("パケットインジェクション+HTTPSでは改ざん困難", () => {
      const op: SimOp = {
        type: "attack", method: "packet_injection", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "normal content",
      };
      const result = simulateAttack(op);
      expect(result.tampered).toBe(false);
    });

    it("パッシブ盗聴+HTTPでデータ読取成功", () => {
      const op: SimOp = {
        type: "attack", method: "passive_sniff", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "password=P@ssw0rd",
      };
      const result = simulateAttack(op);
      expect(result.intercepted).toBe(true);
      expect(result.dataLeaked).toBe(true);
    });

    it("パッシブ盗聴+HTTPSではデータ読取不可", () => {
      const op: SimOp = {
        type: "attack", method: "passive_sniff", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "password=P@ssw0rd",
      };
      const result = simulateAttack(op);
      expect(result.intercepted).toBe(true);
      expect(result.dataLeaked).toBe(false);
    });

    it("フル防御で全攻撃がブロックされる", () => {
      const op: SimOp = {
        type: "attack", method: "arp_spoofing", protocol: "https", tls: "tls1.3",
        serverCert: validCert("example.com"),
        defense: fullDefense(), httpPayload: "secret=classified",
      };
      const result = simulateAttack(op);
      expect(result.blocked.length).toBeGreaterThan(0);
      expect(result.dataLeaked).toBe(false);
    });

    it("防御勧告が生成される", () => {
      const op: SimOp = {
        type: "attack", method: "arp_spoofing", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "test",
      };
      const result = simulateAttack(op);
      expect(result.mitigations.length).toBeGreaterThan(0);
    });

    it("フル防御では「適切」メッセージが出る", () => {
      const op: SimOp = {
        type: "attack", method: "arp_spoofing", protocol: "https", tls: "tls1.3",
        serverCert: validCert("example.com"),
        defense: fullDefense(), httpPayload: "test",
      };
      const result = simulateAttack(op);
      expect(result.mitigations.some(m => m.includes("適切"))).toBe(true);
    });
  });

  // ─── ラベル ───

  describe("ラベル", () => {
    it("攻撃手法ラベルが取得できる", () => {
      expect(attackMethodLabel("arp_spoofing")).toBe("ARPスプーフィング");
      expect(attackMethodLabel("ssl_stripping")).toBe("SSLストリッピング");
    });
  });

  // ─── simulate ───

  describe("simulate", () => {
    it("複数攻撃が実行される", () => {
      const ops: SimOp[] = [
        { type: "attack", method: "passive_sniff", protocol: "http", tls: "none", defense: noDefense(), httpPayload: "a" },
        { type: "attack", method: "passive_sniff", protocol: "https", tls: "tls1.2", serverCert: validCert("x.com"), defense: noDefense(), httpPayload: "b" },
      ];
      const r = simulate(ops);
      expect(r.results).toHaveLength(2);
      expect(r.results[0].dataLeaked).toBe(true);
      expect(r.results[1].dataLeaked).toBe(false);
    });
  });

  // ─── プリセット ───

  describe("プリセット", () => {
    it("全プリセットがエラーなく実行できる", () => {
      for (const preset of PRESETS) {
        const ops = preset.build();
        const r = simulate(ops);
        expect(r.results.length).toBeGreaterThan(0);
      }
    });

    it("全プリセットにnameとdescriptionがある", () => {
      for (const preset of PRESETS) {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      }
    });
  });
});
