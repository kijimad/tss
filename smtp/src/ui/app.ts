/** ブラウザUI: Node.jsシミュレータパターンに準拠したSMTPシミュレータ */

import { createDefaultEnvironment } from "../smtp/server.js";
import type { ProtocolLogEntry } from "../smtp/protocol.js";
import type { SendResult } from "../smtp/server.js";

/** サンプルメールの設定 */
interface SmtpExample {
  /** サンプル名 */
  name: string;
  /** 説明テキスト（左パネルに表示） */
  description: string;
  /** 送信元アドレス */
  from: string;
  /** 宛先アドレス（複数の場合はカンマ区切り） */
  to: string;
  /** 件名 */
  subject: string;
  /** 本文 */
  body: string;
}

const EXAMPLES: SmtpExample[] = [
  {
    name: "基本送信 (alice → bob)",
    description:
      "同一ドメイン内でのシンプルなメール送信。\nalice@example.com から bob@example.com へ送信します。\nEHLO → MAIL FROM → RCPT TO → DATA → QUIT の基本フローを確認できます。",
    from: "alice@example.com",
    to: "bob@example.com",
    subject: "こんにちは",
    body: "お元気ですか？テストメールです。",
  },
  {
    name: "別ドメインへ送信",
    description:
      "異なるドメイン間のメール送信。\nalice@example.com → carol@test.org\nDNS MXルックアップでtest.orgのメールサーバーを解決し、リレーします。",
    from: "alice@example.com",
    to: "charlie@test.org",
    subject: "クロスドメインテスト",
    body: "別ドメインへのメール送信テストです。",
  },
  {
    name: "存在しないユーザー (550)",
    description:
      "存在しないユーザーへの送信を試みます。\nalice@example.com → unknown@example.com\nRCPT TOコマンドで550 User Not Foundエラーが返されます。",
    from: "alice@example.com",
    to: "unknown@example.com",
    subject: "テスト",
    body: "このメールは届きません。",
  },
  {
    name: "存在しないドメイン",
    description:
      "DNS MXルックアップが失敗するケース。\nalice@example.com → someone@nonexistent.com\nMXレコードが見つからず、送信前にエラーになります。",
    from: "alice@example.com",
    to: "someone@nonexistent.com",
    subject: "配達不能テスト",
    body: "このドメインは存在しません。",
  },
  {
    name: "サーバビジー (421)",
    description:
      "宛先サーバーがビジー状態（421 Service Unavailable）のシナリオ。\ntest.orgのサーバーをビジー状態にしてから送信を試みます。\n※ 実行時にサーバー状態を一時的に変更します。",
    from: "alice@example.com",
    to: "charlie@test.org",
    subject: "ビジーテスト",
    body: "サーバーがビジーです。",
  },
  {
    name: "複数宛先",
    description:
      "複数の宛先に順番にメールを送信します。\nalice@example.com → bob@example.com, charlie@test.org\nそれぞれ個別のSMTPセッションが実行されます。",
    from: "alice@example.com",
    to: "bob@example.com, charlie@test.org",
    subject: "一斉送信テスト",
    body: "複数の宛先に送信しています。",
  },
  {
    name: "長文メール",
    description:
      "長めの本文を含むメール送信。\nDATAコマンド以降のメール本文部分が長くなります。\nMIMEヘッダーと本文の区切りも確認できます。",
    from: "alice@example.com",
    to: "bob@example.com",
    subject: "プロジェクト進捗報告",
    body: "お疲れ様です。\n\n今週のプロジェクト進捗について報告します。\n\n1. フロントエンド開発\n   - UIコンポーネントの実装完了\n   - レスポンシブ対応済み\n   - アクセシビリティテスト実施中\n\n2. バックエンド開発\n   - APIエンドポイント実装完了\n   - データベースマイグレーション適用済み\n   - 負荷テスト準備中\n\n3. 来週の予定\n   - 結合テストの実施\n   - ステージング環境へのデプロイ\n   - クライアントレビュー\n\nよろしくお願いいたします。",
  },
  {
    name: "日本語メール",
    description:
      "日本語の件名と本文を含むメール。\nContent-Type: text/plain; charset=UTF-8 ヘッダーが設定されます。",
    from: "alice@example.com",
    to: "bob@example.com",
    subject: "新年のご挨拶",
    body: "明けましておめでとうございます。\n旧年中は大変お世話になりました。\n本年もどうぞよろしくお願いいたします。",
  },
  {
    name: "全プロトコルログ表示",
    description:
      "詳細なプロトコル交換を確認するためのサンプル。\nDNS MXルックアップ → TCP接続 → グリーティング → EHLO →\nMAIL FROM → RCPT TO → DATA → MIMEヘッダー → 本文 → QUIT\nの全ステップが出力されます。",
    from: "bob@example.com",
    to: "eve@corp.local",
    subject: "プロトコル確認用",
    body: "全プロトコルログを表示するテストです。",
  },
  {
    name: "受信メールボックス確認",
    description:
      "メール送信後にメールボックスの内容を確認します。\nalice@example.com → bob@example.com にメールを送信した後、\nbobのメールボックスの中身を表示します。",
    from: "alice@example.com",
    to: "bob@example.com",
    subject: "メールボックス確認テスト",
    body: "このメールの後、メールボックスの内容を確認します。",
  },
];

/** HTMLエスケープする */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** プロトコルログエントリに色を付けてフォーマットする */
function formatLogEntry(entry: ProtocolLogEntry): string {
  const color = entry.direction === "C->S" ? "#569cd6" : "#4ec9b0";
  const escaped = escapeHtml(entry.message);
  return `<span style="color:${color}">[${entry.direction}]</span> ${escaped}`;
}

/** SMTPシミュレータのUIアプリケーション */
export class SmtpApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "SMTP シミュレータ";
    title.style.cssText = "margin:0;font-size:15px;color:#68d391;";
    header.appendChild(title);

    // サンプル選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
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
    runBtn.style.cssText =
      "padding:4px 16px;background:#68d391;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    // メインパネル
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 説明・設定テキストエリア
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText =
      "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const configLabel = document.createElement("div");
    configLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    configLabel.textContent = "メール設定";
    leftPanel.appendChild(configLabel);

    const configArea = document.createElement("textarea");
    configArea.style.cssText =
      "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    configArea.spellcheck = false;
    leftPanel.appendChild(configArea);
    main.appendChild(leftPanel);

    // 右パネル: プロトコルログ出力
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    const outLabel = document.createElement("div");
    outLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "プロトコルログ";
    rightPanel.appendChild(outLabel);

    const outputDiv = document.createElement("div");
    outputDiv.style.cssText =
      "flex:1;padding:12px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;";
    rightPanel.appendChild(outputDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    /** 選択中のサンプルからテキストエリアを更新する */
    const loadExample = (index: number): void => {
      const ex = EXAMPLES[index];
      if (!ex) return;
      const lines = [
        `# ${ex.name}`,
        `# ${ex.description.split("\n").join("\n# ")}`,
        "",
        `From: ${ex.from}`,
        `To: ${ex.to}`,
        `Subject: ${ex.subject}`,
        "",
        ex.body,
      ];
      configArea.value = lines.join("\n");
    };

    /** テキストエリアからメール設定をパースする */
    const parseConfig = (): {
      from: string;
      to: string;
      subject: string;
      body: string;
    } => {
      const text = configArea.value;
      let from = "";
      let to = "";
      let subject = "";
      const bodyLines: string[] = [];
      let inBody = false;
      let headersDone = false;

      for (const line of text.split("\n")) {
        // コメント行をスキップ
        if (line.startsWith("#")) continue;

        if (!headersDone) {
          if (line.startsWith("From: ")) {
            from = line.slice(6).trim();
          } else if (line.startsWith("To: ")) {
            to = line.slice(4).trim();
          } else if (line.startsWith("Subject: ")) {
            subject = line.slice(9).trim();
          } else if (line.trim() === "" && (from || to || subject)) {
            // ヘッダー後の空行で本文開始
            headersDone = true;
            inBody = true;
          }
        } else if (inBody) {
          bodyLines.push(line);
        }
      }

      return { from, to, subject, body: bodyLines.join("\n") };
    };

    /** SMTPセッションを実行して結果を表示する */
    const runSmtp = (): void => {
      outputDiv.innerHTML = "";
      const config = parseConfig();
      const exIndex = Number(select.value);
      const ex = EXAMPLES[exIndex];

      // 「サーバビジー」シナリオ用の特別処理
      const isBusyScenario = ex?.name === "サーバビジー (421)";

      // 「受信メールボックス確認」シナリオ判定
      const isMailboxScenario = ex?.name === "受信メールボックス確認";

      // 環境を毎回生成（状態をリセット）
      const env = createDefaultEnvironment();

      if (isBusyScenario) {
        // test.orgのサーバーをビジー状態にする
        const server = env.registry.getServer("mail.test.org");
        if (server) server.setBusy(true);
      }

      // 宛先をカンマ区切りで分割（複数宛先対応）
      const recipients = config.to
        .split(",")
        .map((addr) => addr.trim())
        .filter((addr) => addr.length > 0);

      const allResults: SendResult[] = [];

      for (const recipient of recipients) {
        const result = env.client.sendMail(
          config.from,
          recipient,
          config.subject,
          config.body,
        );
        allResults.push(result);

        // セッション区切りヘッダー（複数宛先の場合）
        if (recipients.length > 1) {
          const sessionHeader = document.createElement("div");
          sessionHeader.style.cssText =
            "color:#f59e0b;font-weight:600;margin-top:8px;margin-bottom:4px;border-bottom:1px solid #334155;padding-bottom:2px;";
          sessionHeader.textContent = `━━ セッション: → ${recipient} ━━`;
          outputDiv.appendChild(sessionHeader);
        }

        // プロトコルログを表示
        for (const entry of result.log) {
          const row = document.createElement("div");
          row.style.cssText = "padding:1px 0;";
          row.innerHTML = formatLogEntry(entry);
          outputDiv.appendChild(row);
        }

        // 結果ステータス
        const statusEl = document.createElement("div");
        statusEl.style.cssText = `margin-top:4px;padding:4px 0;font-weight:600;color:${result.ok ? "#68d391" : "#f87171"};`;
        statusEl.textContent = result.ok
          ? `✓ ${result.message}`
          : `✗ ${result.message}`;
        outputDiv.appendChild(statusEl);
      }

      // 「受信メールボックス確認」の場合、メールボックス内容を追加表示
      if (isMailboxScenario && allResults.length > 0 && allResults[0]?.ok) {
        const mbHeader = document.createElement("div");
        mbHeader.style.cssText =
          "color:#f59e0b;font-weight:600;margin-top:12px;margin-bottom:4px;border-top:1px solid #334155;padding-top:8px;";
        mbHeader.textContent = "━━ メールボックス確認 ━━";
        outputDiv.appendChild(mbHeader);

        // 宛先ドメインのサーバーからメールボックスを取得
        for (const server of env.registry.getAllServers()) {
          const mailboxes = server.getAllMailboxes();
          for (const [user, mailbox] of mailboxes) {
            if (mailbox.messages.length === 0) continue;
            const userEl = document.createElement("div");
            userEl.style.cssText = "color:#68d391;margin-top:4px;";
            userEl.textContent = `${user}@${server.domain} (${String(mailbox.messages.length)}通)`;
            outputDiv.appendChild(userEl);

            for (const msg of mailbox.messages) {
              const msgEl = document.createElement("div");
              msgEl.style.cssText = "color:#94a3b8;padding-left:12px;";
              msgEl.textContent = `  From: ${msg.from} | Subject: ${msg.subject}`;
              outputDiv.appendChild(msgEl);
              const bodyEl = document.createElement("div");
              bodyEl.style.cssText = "color:#cbd5e1;padding-left:12px;";
              bodyEl.textContent = `  Body: ${msg.body}`;
              outputDiv.appendChild(bodyEl);
            }
          }
        }
      }

      // 実行情報サマリ
      const totalLogs = allResults.reduce(
        (sum, r) => sum + r.log.length,
        0,
      );
      const successCount = allResults.filter((r) => r.ok).length;
      const infoEl = document.createElement("div");
      infoEl.style.cssText =
        "color:#64748b;margin-top:8px;font-size:11px;border-top:1px solid #1e293b;padding-top:4px;";
      infoEl.textContent = `セッション: ${String(allResults.length)} | 成功: ${String(successCount)} | ログ行数: ${String(totalLogs)}`;
      outputDiv.appendChild(infoEl);
    };

    // サンプル選択時にテキストエリアを更新
    select.addEventListener("change", () => {
      loadExample(Number(select.value));
    });

    // 実行ボタン
    runBtn.addEventListener("click", () => {
      runSmtp();
    });

    // 初回サンプルを読み込んで自動実行
    loadExample(0);
    runBtn.click();
  }
}
