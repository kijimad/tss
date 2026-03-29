import { describe, it, expect } from "vitest";
import { dhGenerateKeyPair, dhComputeSharedSecret, DH_PARAMS, symmetricEncrypt, symmetricDecrypt, simpleHash, generateKeyPair, sign } from "../crypto/crypto.js";
import { SshServer, SshSession } from "../protocol/ssh.js";

describe("暗号プリミティブ", () => {
  it("DH 鍵交換で共有秘密が一致する", () => {
    const alice = dhGenerateKeyPair(DH_PARAMS);
    const bob = dhGenerateKeyPair(DH_PARAMS);
    const secretAlice = dhComputeSharedSecret(bob.publicKey, alice.privateKey, DH_PARAMS.p);
    const secretBob = dhComputeSharedSecret(alice.publicKey, bob.privateKey, DH_PARAMS.p);
    expect(secretAlice).toBe(secretBob);
  });

  it("対称暗号で暗号化→復号が元に戻る", () => {
    const plaintext = "Hello, SSH!";
    const key = 42;
    const encrypted = symmetricEncrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = symmetricDecrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("間違った鍵では復号できない", () => {
    const encrypted = symmetricEncrypt("secret", 42);
    const wrong = symmetricDecrypt(encrypted, 99);
    expect(wrong).not.toBe("secret");
  });

  it("ハッシュが決定的", () => {
    expect(simpleHash("test")).toBe(simpleHash("test"));
    expect(simpleHash("test")).not.toBe(simpleHash("other"));
  });

  it("鍵ペアを生成できる", () => {
    const kp = generateKeyPair("test");
    expect(kp.publicKey).toContain("ssh-rsa");
    expect(kp.fingerprint).toContain("SHA256:");
  });

  it("署名を生成できる", () => {
    const kp = generateKeyPair("test");
    const sig = sign("data", kp.privateKey);
    expect(sig.length).toBeGreaterThan(0);
  });
});

describe("SSH サーバ", () => {
  it("パスワード認証が成功する", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    expect(server.authenticate("user", "password", "password")).toBe(true);
  });

  it("パスワード認証が失敗する", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    expect(server.authenticate("user", "password", "wrong")).toBe(false);
  });

  it("コマンドを実行する", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    expect(server.executeCommand("hostname", "user")).toBe("myhost\n");
    expect(server.executeCommand("whoami", "user")).toBe("user\n");
  });
});

describe("SSH セッション", () => {
  it("パスワード認証で接続する", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    const session = new SshSession(server);
    const connected = session.connect("user", "password", "password");
    expect(connected).toBe(true);
    expect(session.isConnected()).toBe(true);
  });

  it("認証失敗で接続できない", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    const session = new SshSession(server);
    const connected = session.connect("user", "password", "wrong");
    expect(connected).toBe(false);
  });

  it("接続後にコマンドを実行する", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    const session = new SshSession(server);
    session.connect("user", "password", "password");
    const output = session.executeCommand("hostname");
    expect(output).toBe("myhost\n");
  });

  it("DH 鍵交換イベントが記録される", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    const session = new SshSession(server);
    session.connect("user", "password", "password");
    const dhEvents = session.events.filter(e => e.type === "crypto" && e.operation.includes("DH"));
    expect(dhEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("暗号化されたメッセージが記録される", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    const session = new SshSession(server);
    session.connect("user", "password", "password");
    const encrypted = session.events.filter(e => e.type === "send" && e.encrypted);
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it("公開鍵認証で接続する", () => {
    const server = new SshServer("myhost", "192.168.1.100");
    const clientKey = generateKeyPair("client");
    server.addAuthorizedKey("user", clientKey.publicKey);
    const session = new SshSession(server);
    const connected = session.connect("user", "publickey", clientKey.publicKey, clientKey);
    expect(connected).toBe(true);
  });
});
