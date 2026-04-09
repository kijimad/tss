import { SigningEngine } from "../engine/signing.js";
import type { SigningTrace, RsaKeyPair } from "../engine/signing.js";

// ── シナリオ定義 ──

export interface Scenario {
  name: string;
  description: string;
  p: number;
  q: number;
  /** 暗号化デモ用の平文値 */
  encryptValues: number[];
  /** メッセージ暗号化デモ用 */
  encryptMessage: string;
  /** 署名デモ用 */
  signMessage: string;
  /** 改ざんデモ用 */
  tamperedMessage: string;
}

export const SCENARIOS: Scenario[] = [
  {
    name: "基本 (p=61, q=53)",
    description: "小さい素数で RSA の全工程を体験。鍵生成 → 暗号化/復号 → 署名/検証 → 改ざん検出。",
    p: 61, q: 53,
    encryptValues: [42, 100, 7],
    encryptMessage: "Hi",
    signMessage: "100万円を送金",
    tamperedMessage: "999万円を送金",
  },
  {
    name: "大きめの鍵 (p=101, q=103)",
    description: "n=10403 のやや大きい鍵。文字コードが n 未満なので ASCII メッセージ暗号化が安全。",
    p: 101, q: 103,
    encryptValues: [65, 90, 255],
    encryptMessage: "RSA!",
    signMessage: "contract signed",
    tamperedMessage: "contract forged",
  },
  {
    name: "最小の鍵 (p=11, q=13)",
    description: "n=143 の極小鍵。暗号の弱さが見える — 文字コード > 143 は使えない。",
    p: 11, q: 13,
    encryptValues: [2, 42, 100],
    encryptMessage: "AB",
    signMessage: "ok",
    tamperedMessage: "ng",
  },
  {
    name: "署名偽造の困難さ (p=67, q=71)",
    description: "異なる鍵ペアの署名は検証に失敗する。秘密鍵なしでは有効な署名を作れない。",
    p: 67, q: 71,
    encryptValues: [10, 50, 200],
    encryptMessage: "Safe",
    signMessage: "この文書は正式です",
    tamperedMessage: "この文書は偽物です",
  },
];

// ── フェーズごとの色 ──

function phaseColor(phase: SigningTrace["phase"]): string {
  switch (phase) {
    case "keygen":  return "#a78bfa";
    case "encrypt": return "#3b82f6";
    case "decrypt": return "#22c55e";
    case "hash":    return "#f59e0b";
    case "sign":    return "#ec4899";
    case "verify":  return "#06b6d4";
    case "tamper":  return "#ef4444";
    case "math":    return "#64748b";
    case "result":  return "#10b981";
  }
}

// ── アプリ ──

export class SigningApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダー ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Public Key Signing Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#a78bfa;";
    header.appendChild(title);

    const scSelect = document.createElement("select");
    scSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < SCENARIOS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = SCENARIOS[i]!.name;
      scSelect.appendChild(o);
    }
    header.appendChild(scSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run All";
    runBtn.style.cssText = "padding:4px 16px;background:#7c3aed;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 鍵情報
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:280px;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const keyLabel = document.createElement("div");
    keyLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    keyLabel.textContent = "Key Pair";
    leftPanel.appendChild(keyLabel);

    const keyDiv = document.createElement("div");
    keyDiv.style.cssText = "flex:1;padding:8px 12px;font-size:10px;overflow-y:auto;line-height:1.8;";
    leftPanel.appendChild(keyDiv);
    main.appendChild(leftPanel);

    // 中央パネル: 操作結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const opsLabel = document.createElement("div");
    opsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    opsLabel.textContent = "Operations";
    centerPanel.appendChild(opsLabel);

    const opsDiv = document.createElement("div");
    opsDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(opsDiv);
    main.appendChild(centerPanel);

    // 右パネル: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:440px;display:flex;flex-direction:column;";

    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Trace (click operation)";
    rightPanel.appendChild(trLabel);

    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);

    container.appendChild(main);

    // ── 描画ヘルパー ──

    const renderKey = (kp: RsaKeyPair) => {
      keyDiv.innerHTML = "";
      const sections = [
        { label: "パラメータ", items: [`p = ${kp.privateKey.p}`, `q = ${kp.privateKey.q}`, `n = p×q = ${kp.publicKey.n}`, `φ(n) = ${(kp.privateKey.p - 1) * (kp.privateKey.q - 1)}`] },
        { label: "公開鍵 (誰でも知れる)", items: [`e = ${kp.publicKey.e}`, `n = ${kp.publicKey.n}`], color: "#3b82f6" },
        { label: "秘密鍵 (本人だけ)", items: [`d = ${kp.privateKey.d}`, `n = ${kp.privateKey.n}`], color: "#ef4444" },
      ];
      for (const s of sections) {
        const div = document.createElement("div");
        div.style.cssText = `margin-bottom:8px;padding:6px 8px;background:#1e293b;border-radius:4px;border-left:3px solid ${s.color ?? "#64748b"};`;
        div.innerHTML = `<div style="font-weight:600;color:${s.color ?? "#94a3b8"};margin-bottom:3px;">${s.label}</div>` +
          s.items.map((i) => `<div style="color:#cbd5e1;">${i}</div>`).join("");
        keyDiv.appendChild(div);
      }
    };

    const renderTrace = (traces: SigningTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of traces) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="min-width:64px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;flex-shrink:0;">${step.phase}</span>` +
          `<span style="color:#cbd5e1;word-break:break-all;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    interface OpCard {
      title: string;
      subtitle: string;
      status: "success" | "fail" | "info";
      traces: SigningTrace[];
    }

    const renderOps = (cards: OpCard[]) => {
      opsDiv.innerHTML = "";
      for (const card of cards) {
        const el = document.createElement("div");
        const border = card.status === "success" ? "#22c55e" : card.status === "fail" ? "#ef4444" : "#3b82f6";
        el.style.cssText = `padding:6px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;
        el.innerHTML =
          `<div style="color:#e2e8f0;font-weight:600;">${card.title}</div>` +
          `<div style="color:#64748b;font-size:9px;margin-top:2px;">${card.subtitle}</div>`;
        el.addEventListener("click", () => renderTrace(card.traces));
        opsDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const runScenario = (sc: Scenario) => {
      descSpan.textContent = sc.description;
      const engine = new SigningEngine();
      const cards: OpCard[] = [];

      // 1. 鍵生成
      const { keyPair, trace: kgTrace } = engine.generateKeyPair(sc.p, sc.q);
      renderKey(keyPair);
      cards.push({
        title: "① 鍵生成",
        subtitle: `p=${sc.p}, q=${sc.q} → n=${keyPair.publicKey.n}, e=${keyPair.publicKey.e}, d=${keyPair.privateKey.d}`,
        status: "info",
        traces: kgTrace,
      });

      // 2. 数値の暗号化/復号
      for (const val of sc.encryptValues) {
        if (val >= keyPair.publicKey.n) continue;
        const enc = engine.encrypt(val, keyPair.publicKey);
        const dec = engine.decrypt(enc.cipher, keyPair.privateKey);
        const allTrace = [...enc.trace, ...dec.trace];
        cards.push({
          title: `② 暗号化/復号: m=${val}`,
          subtitle: `${val} → 暗号文 ${enc.cipher} → 復号 ${dec.plain}`,
          status: dec.plain === val ? "success" : "fail",
          traces: allTrace,
        });
      }

      // 3. メッセージ暗号化/復号
      const encMsg = engine.encryptMessage(sc.encryptMessage, keyPair.publicKey);
      const decMsg = engine.decryptMessage(encMsg.cipherValues, keyPair.privateKey);
      cards.push({
        title: `③ メッセージ暗号化: 「${sc.encryptMessage}」`,
        subtitle: `暗号文 [${encMsg.cipherValues.join(",")}] → 「${decMsg.message}」`,
        status: decMsg.message === sc.encryptMessage ? "success" : "fail",
        traces: [...encMsg.trace, ...decMsg.trace],
      });

      // 4. 署名 → 検証
      const signResult = engine.sign(sc.signMessage, keyPair.privateKey);
      const verifyResult = engine.verify(sc.signMessage, signResult.signature, keyPair.publicKey);
      cards.push({
        title: `④ 署名 → 検証: 「${sc.signMessage}」`,
        subtitle: `署名=${signResult.signature}, ハッシュ=${signResult.hash} → ${verifyResult.valid ? "✓ 有効" : "✗ 無効"}`,
        status: verifyResult.valid ? "success" : "fail",
        traces: [...signResult.trace, ...verifyResult.trace],
      });

      // 5. 改ざん検出
      const tamperResult = engine.tamperAndVerify(sc.signMessage, sc.tamperedMessage, signResult.signature, keyPair.publicKey);
      cards.push({
        title: `⑤ 改ざん検出: 「${sc.tamperedMessage}」`,
        subtitle: `元の署名で改ざんメッセージを検証 → ${tamperResult.valid ? "✗ 検出失敗" : "✓ 改ざん検出!"}`,
        status: tamperResult.valid ? "fail" : "success",
        traces: tamperResult.trace,
      });

      // 6. 別の鍵で署名した場合
      const candidates = [67, 71, 73, 79, 83, 89];
      const [op, oq] = candidates.filter((c) => c !== sc.p && c !== sc.q);
      const { keyPair: otherKp } = engine.generateKeyPair(op!, oq!);
      const fakeSign = engine.sign(sc.signMessage, otherKp.privateKey);
      const fakeVerify = engine.verify(sc.signMessage, fakeSign.signature, keyPair.publicKey);
      cards.push({
        title: "⑥ 別人の秘密鍵で署名",
        subtitle: `他人の鍵で署名 → 本人の公開鍵で検証 → ${fakeVerify.valid ? "✗ 通過" : "✓ 拒否!"}`,
        status: fakeVerify.valid ? "fail" : "success",
        traces: [
          { phase: "sign", detail: `別の鍵ペア (n=${otherKp.publicKey.n}) でメッセージに署名` },
          ...fakeSign.trace,
          { phase: "verify", detail: `本人の公開鍵 (n=${keyPair.publicKey.n}) で検証を試行` },
          ...fakeVerify.trace,
        ],
      });

      renderOps(cards);
      // 最初のカードのトレースを表示
      if (cards[0]) renderTrace(cards[0].traces);
    };

    const loadScenario = (sc: Scenario) => {
      descSpan.textContent = sc.description;
      opsDiv.innerHTML = "";
      trDiv.innerHTML = "";
      keyDiv.innerHTML = '<div style="color:#64748b;">▶ Run All をクリックして開始</div>';
    };

    scSelect.addEventListener("change", () => {
      const sc = SCENARIOS[Number(scSelect.value)];
      if (sc) loadScenario(sc);
    });
    runBtn.addEventListener("click", () => {
      const sc = SCENARIOS[Number(scSelect.value)];
      if (sc) runScenario(sc);
    });

    loadScenario(SCENARIOS[0]!);
  }
}
