/**
 * PKIシミュレーターのブラウザUI
 * Node.jsシミュレーターと同様のレイアウトパターンで、
 * 鍵生成、署名、証明書チェーン、TLSハンドシェイクを可視化する
 */

import { performHandshake, formatHandshakeLog, challengeResponseAuth } from "../auth/handshake.js";
import type { ClientConfig, ServerConfig } from "../auth/handshake.js";
import {
  createRootCACert,
  issueIntermediateCACert,
  issueEndEntityCert,
  validateCertificateChain,
  formatCertificate,
  resetSerialCounter,
} from "../crypto/cert.js";
import { generateKeyPair, sign, verify, encrypt, decrypt, formatKeyInfo } from "../crypto/rsa.js";

/** シナリオの実行結果 */
interface ScenarioResult {
  /** メイン出力テキスト */
  output: string;
  /** 詳細トレースログ */
  trace: string[];
  /** エラーがあった場合 */
  error?: string;
}

/** シナリオ定義 */
interface Scenario {
  name: string;
  run: () => ScenarioResult;
}

/** 全シナリオ定義 */
const EXAMPLES: Scenario[] = [
  {
    name: "RSA鍵ペア生成",
    run: () => {
      const kp = generateKeyPair();
      const trace = [
        "ステップ1: 2つの素数 p, q を選択",
        `  p = ${kp.privateKey.p}`,
        `  q = ${kp.privateKey.q}`,
        "ステップ2: n = p * q を計算",
        `  n = ${kp.publicKey.n}`,
        "ステップ3: φ(n) = (p-1)(q-1) を計算",
        `  φ(n) = ${(kp.privateKey.p - 1n) * (kp.privateKey.q - 1n)}`,
        "ステップ4: 公開指数 e を選択（φ(n)と互いに素）",
        `  e = ${kp.publicKey.e}`,
        "ステップ5: 秘密指数 d = e⁻¹ mod φ(n) を計算",
        `  d = ${kp.privateKey.d}`,
      ];
      return { output: formatKeyInfo(kp), trace };
    },
  },
  {
    name: "デジタル署名 (作成→検証)",
    run: () => {
      const kp = generateKeyPair();
      const message = "こんにちは、PKI！";
      const signature = sign(message, kp.privateKey);
      const isValid = verify(message, signature, kp.publicKey);
      const output = [
        `メッセージ: "${message}"`,
        `署名値: ${signature}`,
        "",
        `検証結果: ${isValid ? "有効（署名は正しい）" : "無効"}`,
      ].join("\n");
      const trace = [
        `署名作成: hash(message)^d mod n`,
        `  d = ${kp.privateKey.d}`,
        `  n = ${kp.publicKey.n}`,
        `  署名値 = ${signature}`,
        `署名検証: signature^e mod n == hash(message)?`,
        `  e = ${kp.publicKey.e}`,
        `  結果: ${isValid ? "一致 → 有効" : "不一致 → 無効"}`,
      ];
      return { output, trace };
    },
  },
  {
    name: "改ざん検出",
    run: () => {
      const kp = generateKeyPair();
      const message = "振込先: 口座A / 金額: 100万円";
      const signature = sign(message, kp.privateKey);
      const tampered = "振込先: 口座B / 金額: 999万円";
      const originalValid = verify(message, signature, kp.publicKey);
      const tamperedValid = verify(tampered, signature, kp.publicKey);
      const output = [
        `元メッセージ: "${message}"`,
        `改ざん後:     "${tampered}"`,
        `署名値: ${signature}`,
        "",
        `元メッセージで検証: ${originalValid ? "有効" : "無効"}`,
        `改ざん後で検証:     ${tamperedValid ? "有効" : "無効（改ざんを検出！）"}`,
      ].join("\n");
      const trace = [
        "1. 元メッセージに署名を作成",
        `   署名値 = ${signature}`,
        "2. 元メッセージで署名を検証",
        `   結果: ${originalValid ? "有効" : "無効"}`,
        "3. 改ざんメッセージで署名を検証",
        `   結果: ${tamperedValid ? "有効" : "無効 → 改ざんを検出"}`,
        "",
        "ハッシュ値が一致しないため、改ざんが検出される",
      ];
      return { output, trace };
    },
  },
  {
    name: "証明書チェーン (Root→中間→末端)",
    run: () => {
      resetSerialCounter();
      const rootKp = generateKeyPair();
      const rootCert = createRootCACert("Example Root CA", rootKp);
      const intKp = generateKeyPair();
      const intCert = issueIntermediateCACert(
        "Example Intermediate CA",
        intKp.publicKey,
        rootCert,
        rootKp.privateKey,
      );
      const eeKp = generateKeyPair();
      const eeCert = issueEndEntityCert(
        "www.example.com",
        eeKp.publicKey,
        intCert,
        intKp.privateKey,
      );
      const result = validateCertificateChain(
        [eeCert, intCert, rootCert],
        [rootCert],
      );
      const output = [
        "=== 証明書チェーン ===",
        "",
        "【ルートCA】",
        formatCertificate(rootCert),
        "",
        "  └─【中間CA】",
        formatCertificate(intCert).split("\n").map((l) => "    " + l).join("\n"),
        "",
        "      └─【エンドエンティティ】",
        formatCertificate(eeCert).split("\n").map((l) => "        " + l).join("\n"),
        "",
        result.valid ? "チェーン検証: 成功" : "チェーン検証: 失敗",
      ].join("\n");
      const trace = [...result.log];
      if (!result.valid) {
        return { output, trace, error: result.errors.join("; ") };
      }
      return { output, trace };
    },
  },
  {
    name: "期限切れ証明書",
    run: () => {
      resetSerialCounter();
      const rootKp = generateKeyPair();
      const rootCert = createRootCACert("Expired Test Root CA", rootKp);
      const intKp = generateKeyPair();
      const intCert = issueIntermediateCACert(
        "Expired Test Intermediate CA",
        intKp.publicKey,
        rootCert,
        rootKp.privateKey,
      );
      const eeKp = generateKeyPair();
      const eeCert = issueEndEntityCert(
        "expired.example.com",
        eeKp.publicKey,
        intCert,
        intKp.privateKey,
      );
      const futureDate = new Date("2040-01-01");
      const result = validateCertificateChain(
        [eeCert, intCert, rootCert],
        [rootCert],
        futureDate,
      );
      const output = [
        "=== 期限切れ証明書テスト ===",
        `検証日時: 2040-01-01（全証明書の有効期限を超過）`,
        "",
        ...result.log,
        "",
        result.valid ? "結果: 検証成功" : "結果: 検証失敗",
        ...result.errors.map((e) => `  エラー: ${e}`),
      ].join("\n");
      const trace = [
        "検証日を2040-01-01に設定",
        ...result.log,
        "",
        ...result.errors,
      ];
      if (!result.valid) {
        return { output, trace, error: result.errors.join("; ") };
      }
      return { output, trace };
    },
  },
  {
    name: "自己署名証明書",
    run: () => {
      resetSerialCounter();
      const rootKp = generateKeyPair();
      const rootCert = createRootCACert("Untrusted Self-Signed CA", rootKp);
      const intKp = generateKeyPair();
      const intCert = issueIntermediateCACert(
        "Untrusted Intermediate CA",
        intKp.publicKey,
        rootCert,
        rootKp.privateKey,
      );
      const eeKp = generateKeyPair();
      const eeCert = issueEndEntityCert(
        "untrusted.example.com",
        eeKp.publicKey,
        intCert,
        intKp.privateKey,
      );
      // 信頼リストを空にして検証する
      const result = validateCertificateChain(
        [eeCert, intCert, rootCert],
        [],
      );
      const output = [
        "=== 自己署名証明書テスト ===",
        "信頼されたルートCAリスト: （空）",
        "",
        ...result.log,
        "",
        result.valid ? "結果: 検証成功" : "結果: 検証失敗（信頼されないCA）",
        ...result.errors.map((e) => `  エラー: ${e}`),
      ].join("\n");
      const trace = [
        "信頼リストが空のため、ルートCAが信頼されない",
        ...result.log,
        "",
        ...result.errors,
      ];
      if (!result.valid) {
        return { output, trace, error: result.errors.join("; ") };
      }
      return { output, trace };
    },
  },
  {
    name: "TLSハンドシェイク",
    run: () => {
      resetSerialCounter();
      const rootKp = generateKeyPair();
      const rootCert = createRootCACert("TLS Root CA", rootKp);
      const intKp = generateKeyPair();
      const intCert = issueIntermediateCACert(
        "TLS Intermediate CA",
        intKp.publicKey,
        rootCert,
        rootKp.privateKey,
      );
      const eeKp = generateKeyPair();
      const eeCert = issueEndEntityCert(
        "tls.example.com",
        eeKp.publicKey,
        intCert,
        intKp.privateKey,
      );
      const clientConfig: ClientConfig = {
        trustedRoots: [rootCert],
        cipherSuites: ["RSA_SIM_WITH_AES_128", "RSA_SIM_WITH_AES_256"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKp.privateKey,
        cipherSuites: ["RSA_SIM_WITH_AES_256", "RSA_SIM_WITH_AES_128"],
      };
      const result = performHandshake(clientConfig, serverConfig);
      const output = formatHandshakeLog(result);
      const trace = result.log.map((entry) => {
        const arrow = entry.message.sender === "client" ? "→" : "←";
        return `[${entry.step}] ${arrow} ${entry.message.type}: ${entry.description}`;
      });
      if (!result.success) {
        return { output, trace, error: result.error ?? "不明なエラー" };
      }
      return { output, trace };
    },
  },
  {
    name: "チャレンジ-レスポンス認証",
    run: () => {
      const kp = generateKeyPair();
      const challenge = `nonce-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const result = challengeResponseAuth(challenge, kp.privateKey, kp.publicKey);
      const output = [
        "=== チャレンジ・レスポンス認証 ===",
        "",
        `チャレンジ（乱数）: ${result.challenge}`,
        `レスポンス（署名）: ${result.response}`,
        "",
        `検証結果: ${result.verified ? "成功（サーバーの身元を確認）" : "失敗"}`,
      ].join("\n");
      const trace = [
        "1. クライアントがチャレンジ（乱数）を生成",
        `   challenge = ${result.challenge}`,
        "2. サーバーが秘密鍵でチャレンジに署名",
        `   response = ${result.response}`,
        "3. クライアントが公開鍵でレスポンスを検証",
        `   結果: ${result.verified ? "一致 → 認証成功" : "不一致 → 認証失敗"}`,
      ];
      return { output, trace };
    },
  },
  {
    name: "暗号化と復号",
    run: () => {
      const kp = generateKeyPair();
      // nより小さい平文を使用する
      const plaintext = 12345n % (kp.publicKey.n - 1n) + 1n;
      const ciphertext = encrypt(plaintext, kp.publicKey);
      const decrypted = decrypt(ciphertext, kp.privateKey);
      const output = [
        "=== RSA暗号化と復号 ===",
        "",
        `平文 (m): ${plaintext}`,
        `暗号文 (c = m^e mod n): ${ciphertext}`,
        `復号 (m' = c^d mod n): ${decrypted}`,
        "",
        `復号結果: ${decrypted === plaintext ? "成功（元の平文に戻った）" : "失敗"}`,
      ].join("\n");
      const trace = [
        "暗号化: c = m^e mod n",
        `  m = ${plaintext}`,
        `  e = ${kp.publicKey.e}`,
        `  n = ${kp.publicKey.n}`,
        `  c = ${ciphertext}`,
        "",
        "復号: m' = c^d mod n",
        `  c = ${ciphertext}`,
        `  d = ${kp.privateKey.d}`,
        `  n = ${kp.publicKey.n}`,
        `  m' = ${decrypted}`,
        "",
        `m == m': ${decrypted === plaintext ? "一致" : "不一致"}`,
      ];
      return { output, trace };
    },
  },
  {
    name: "異なる鍵サイズ",
    run: () => {
      // 小さな素数範囲と大きめの素数範囲で比較する
      const smallKp = generateKeyPair(10, 97);
      const largeKp = generateKeyPair(500, 997);
      const output = [
        "=== 異なる鍵サイズの比較 ===",
        "",
        "【小さな素数（10-97）】",
        `  p = ${smallKp.privateKey.p}, q = ${smallKp.privateKey.q}`,
        `  n = ${smallKp.publicKey.n}（${smallKp.publicKey.n.toString().length}桁）`,
        `  e = ${smallKp.publicKey.e}`,
        `  d = ${smallKp.privateKey.d}`,
        "",
        "【大きめの素数（500-997）】",
        `  p = ${largeKp.privateKey.p}, q = ${largeKp.privateKey.q}`,
        `  n = ${largeKp.publicKey.n}（${largeKp.publicKey.n.toString().length}桁）`,
        `  e = ${largeKp.publicKey.e}`,
        `  d = ${largeKp.privateKey.d}`,
        "",
        "素数が大きいほど n が大きくなり、解読が困難になる",
      ].join("\n");
      const trace = [
        "小さな素数の鍵:",
        `  n の桁数: ${smallKp.publicKey.n.toString().length}`,
        `  n = ${smallKp.publicKey.n}`,
        "",
        "大きめの素数の鍵:",
        `  n の桁数: ${largeKp.publicKey.n.toString().length}`,
        `  n = ${largeKp.publicKey.n}`,
        "",
        "実際のRSAでは2048ビット以上の鍵が使われる",
        "このシミュレーターでは可視化のため小さな素数を使用",
      ];
      return { output, trace };
    },
  },
];

/** PKIアプリケーションクラス */
export class PkiApp {
  /** UIを初期化してコンテナに構築する */
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "PKI Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#68d391;";
    header.appendChild(title);

    // シナリオ選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#68d391;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: シナリオ説明
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const descLabel = document.createElement("div");
    descLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    descLabel.textContent = "Output";
    leftPanel.appendChild(descLabel);

    // 出力表示エリア
    const outputDiv = document.createElement("div");
    outputDiv.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;";
    leftPanel.appendChild(outputDiv);
    main.appendChild(leftPanel);

    // 右パネル: 詳細トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // エラー表示エリア
    const errorLabel = document.createElement("div");
    errorLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f87171;border-bottom:1px solid #1e293b;display:none;";
    rightPanel.appendChild(errorLabel);

    // トレースラベル
    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Trace";
    rightPanel.appendChild(traceLabel);

    // トレース表示エリア
    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // シナリオ選択変更時のハンドラ
    select.addEventListener("change", () => {
      // 選択が変わったら自動的に実行する
      runBtn.click();
    });

    // 実行ボタンのハンドラ
    runBtn.addEventListener("click", () => {
      outputDiv.innerHTML = "";
      traceDiv.innerHTML = "";
      errorLabel.style.display = "none";

      const scenario = EXAMPLES[Number(select.value)];
      if (!scenario) return;

      const result = scenario.run();

      // メイン出力
      const outEl = document.createElement("span");
      outEl.style.color = "#e2e8f0";
      outEl.textContent = result.output;
      outputDiv.appendChild(outEl);

      // エラー表示
      if (result.error !== undefined) {
        errorLabel.style.display = "block";
        errorLabel.textContent = `Error: ${result.error}`;
      }

      // 実行情報
      const infoEl = document.createElement("div");
      infoEl.style.cssText = "color:#64748b;margin-top:8px;font-size:11px;border-top:1px solid #1e293b;padding-top:4px;";
      infoEl.textContent = `Scenario: ${scenario.name} | Trace lines: ${String(result.trace.length)}`;
      outputDiv.appendChild(infoEl);

      // トレースログ
      for (const line of result.trace) {
        const row = document.createElement("div");
        row.style.cssText = `padding:1px 0;color:${traceColor(line)};`;
        row.textContent = line;
        traceDiv.appendChild(row);
      }
    });

    // 初回実行
    runBtn.click();
  }
}

/** トレース行の内容に応じて色を決定する */
function traceColor(line: string): string {
  if (line.startsWith("ステップ") || line.startsWith("[")) return "#f59e0b";
  if (line.includes("OK") || line.includes("成功") || line.includes("有効") || line.includes("一致")) return "#68d391";
  if (line.includes("NG") || line.includes("失敗") || line.includes("無効") || line.includes("不一致") || line.includes("エラー")) return "#f87171";
  if (line.startsWith("  ")) return "#94a3b8";
  if (line === "") return "#475569";
  return "#cbd5e1";
}
