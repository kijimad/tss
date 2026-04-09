import { LinkCable } from "../engine/gbalink.js";
import type { TransferResult, LinkTrace } from "../engine/gbalink.js";

export interface Example {
  name: string;
  description: string;
  run: () => TransferResult;
}

export const EXAMPLES: Example[] = [
  {
    name: "Normal 8-bit (ポケモン交換風)",
    description: "2台の GBA を Normal 8-bit モードで接続。マスタとスレーブが同時にデータを交換 (全二重 SPI)。ポケモンの通信交換と同じ仕組み。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("GBA-1 (Master)", "master");
      cable.connect("GBA-2 (Slave)", "slave");
      return cable.transferNormal8(
        [0x50, 0x4B, 0x4D, 0x4E],  // "PKMN"
        [0x54, 0x52, 0x44, 0x45],  // "TRDE"
      );
    },
  },
  {
    name: "Normal 32-bit (高速転送)",
    description: "32-bit モードで 1 クロックあたり 4 バイト転送。ゲームの大容量データ同期やマルチブート転送に使用。最大 2Mbps。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("GBA-A (Master)", "master");
      cable.connect("GBA-B (Slave)", "slave");
      return cable.transferNormal32(
        [0xDEADBEEF, 0xCAFEBABE, 0x12345678],
        [0xAAAAAAAA, 0xBBBBBBBB, 0xCCCCCCCC],
      );
    },
  },
  {
    name: "Multi-Player 4台 (マリオカート風)",
    description: "最大 4 台のマルチプレイヤーモード。マスタがクロックを生成し、全員のデータを全員にブロードキャスト。115.2kbps。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("P1 (Master)", "master");
      cable.connect("P2", "slave");
      cable.connect("P3", "slave");
      cable.connect("P4", "slave");
      const sendData = new Map<string, number>();
      sendData.set("P1 (Master)", 0x0100); // Player1: X=1, Y=0
      sendData.set("P2", 0x0234);           // Player2: X=2, Y=52
      sendData.set("P3", 0x03FF);           // Player3: X=3, Y=255
      sendData.set("P4", 0x0400);           // Player4: X=4, Y=0
      return cable.transferMulti(sendData);
    },
  },
  {
    name: "Multi-Player 2台",
    description: "2 台のマルチプレイヤー。対戦格闘ゲーム風の入力交換。各プレイヤーのボタン状態を同時送信。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("P1 (Master)", "master");
      cable.connect("P2", "slave");
      const sendData = new Map<string, number>();
      sendData.set("P1 (Master)", 0x00A1); // A + Right
      sendData.set("P2", 0x00B2);           // B + Left
      return cable.transferMulti(sendData);
    },
  },
  {
    name: "UART モード (デバッグ出力)",
    description: "UART (非同期) モードで文字列を送信。GBA のデバッグポートや周辺機器との通信に使用。9600 baud, 8N1。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("GBA (TX)", "master");
      cable.connect("PC (RX)", "slave");
      const msg = "Hello GBA!\n";
      const data = Array.from(msg).map((c) => c.charCodeAt(0));
      return cable.transferUart("GBA (TX)", data, 9600);
    },
  },
  {
    name: "UART 高速 (115200 baud)",
    description: "UART 最大速度 115200 baud。バイナリデータを高速送信。Flash カートリッジのダンプ等で使用。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("GBA", "master");
      cable.connect("Flasher", "slave");
      return cable.transferUart("GBA", [0x00, 0xFF, 0x55, 0xAA, 0x01, 0x02, 0x03, 0x04], 115200);
    },
  },
  {
    name: "Normal 8-bit 単一バイト (最小転送)",
    description: "1 バイトだけの転送。SPI の全工程 (クロック 8 回 → IRQ) を 1 ビットずつ確認。",
    run: () => {
      const cable = new LinkCable();
      cable.connect("Master", "master");
      cable.connect("Slave", "slave");
      return cable.transferNormal8([0xA5], [0x5A]);
    },
  },
];

function phaseColor(p: LinkTrace["phase"]): string {
  switch (p) {
    case "reg_write":  return "#3b82f6";
    case "clock":      return "#06b6d4";
    case "transfer":   return "#22c55e";
    case "irq":        return "#f59e0b";
    case "pin":        return "#a78bfa";
    case "sync":       return "#ec4899";
    case "error":      return "#ef4444";
    case "mode":       return "#64748b";
    case "handshake":  return "#10b981";
    case "data":       return "#f97316";
  }
}

export class GbaLinkApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "GBA Link Cable Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#9333ea;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Transfer";
    runBtn.style.cssText = "padding:4px 16px;background:#9333ea;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: 転送結果 + 受信データ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:360px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#9333ea;border-bottom:1px solid #1e293b;";
    infoLabel.textContent = "Transfer Summary";
    leftPanel.appendChild(infoLabel);
    const infoDiv = document.createElement("div");
    infoDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(infoDiv);

    const rxLabel = document.createElement("div");
    rxLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    rxLabel.textContent = "Received Data";
    leftPanel.appendChild(rxLabel);
    const rxDiv = document.createElement("div");
    rxDiv.style.cssText = "flex:1;padding:8px 12px;overflow-y:auto;";
    leftPanel.appendChild(rxDiv);
    main.appendChild(leftPanel);

    // 右: SIO トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "SIO Register & Pin Trace";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderInfo = (result: TransferResult) => {
      infoDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;min-width:80px;display:inline-block;">${l}</span> <span style="color:#94a3b8;">${v}</span>`;
        infoDiv.appendChild(r);
      };
      add("モード", result.mode, "#9333ea");
      add("ボーレート", result.baudRate, "#06b6d4");
      add("総 tick", String(result.totalTicks), "#64748b");
      add("トレース行", String(result.trace.length), "#64748b");

      // リンクケーブル図
      const diagram = document.createElement("pre");
      diagram.style.cssText = "color:#475569;font-size:9px;margin-top:6px;line-height:1.3;";
      if (result.mode === "MultiPlayer") {
        diagram.textContent =
          "  ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐\n" +
          "  │ P1  │───│ P2  │───│ P3  │───│ P4  │\n" +
          "  │ MST │   │ SLV │   │ SLV │   │ SLV │\n" +
          "  └─────┘   └─────┘   └─────┘   └─────┘\n" +
          "  SC→───────SD (broadcast)──────────→";
      } else {
        diagram.textContent =
          "  ┌────────┐    Link Cable    ┌────────┐\n" +
          "  │ Master │ SI←─────SO ─────→│ Slave  │\n" +
          "  │        │ SO─────→SI──────→│        │\n" +
          "  │        │ SC─────→SC (clk) │        │\n" +
          "  └────────┘                  └────────┘";
      }
      infoDiv.appendChild(diagram);
    };

    const renderReceived = (result: TransferResult) => {
      rxDiv.innerHTML = "";
      for (const [name, data] of result.received) {
        const section = document.createElement("div");
        section.style.cssText = "margin-bottom:8px;";
        section.innerHTML = `<div style="color:#22c55e;font-weight:600;margin-bottom:4px;">\u{1F3AE} ${name}</div>`;

        // HEX ダンプ
        const hexLine = data.map((d) => {
          const width = result.mode === "Normal32" ? 8 : result.mode === "MultiPlayer" ? 4 : 2;
          return `0x${d.toString(16).padStart(width, "0")}`;
        }).join(" ");
        section.innerHTML += `<div style="color:#94a3b8;font-family:monospace;">HEX: ${hexLine}</div>`;

        // ASCII (8bit の場合)
        if (result.mode === "Normal8" || result.mode === "UART") {
          const ascii = data.map((d) => (d >= 0x20 && d < 0x7f) ? String.fromCharCode(d) : ".").join("");
          section.innerHTML += `<div style="color:#64748b;">ASCII: "${ascii}"</div>`;
        }

        // バイナリ
        if (data.length <= 4) {
          const binLine = data.map((d) => d.toString(2).padStart(result.mode === "Normal32" ? 32 : result.mode === "MultiPlayer" ? 16 : 8, "0")).join(" ");
          section.innerHTML += `<div style="color:#475569;">BIN: ${binLine}</div>`;
        }

        section.innerHTML += `<div style="color:#475569;">${data.length} 値受信</div>`;
        rxDiv.appendChild(section);
      }
    };

    const renderTrace = (trace: LinkTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const color = phaseColor(step.phase);
        const bits = step.bits ? `<span style="color:#f59e0b;font-family:monospace;"> [${step.bits}]</span>` : "";
        el.innerHTML =
          `<span style="color:#475569;min-width:20px;">t${step.tick}</span>` +
          `<span style="min-width:62px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#f59e0b;min-width:65px;">${step.unit}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}${bits}</span>`;
        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      infoDiv.innerHTML = ""; rxDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const result = ex.run();
      renderInfo(result);
      renderReceived(result);
      renderTrace(result.trace);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
