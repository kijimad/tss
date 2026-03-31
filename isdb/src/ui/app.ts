import {
  createTokyoChannels,
  simulateReception,
  describeSegmentLayout,
} from "../broadcast/isdb.js";
import type {
  Channel,
  ReceptionResult,
  ReceptionStep,
  OfdmSegment,
  TsPacket,
} from "../broadcast/isdb.js";

export interface Example {
  name: string;
  description: string;
  /** 物理チャンネル番号 */
  physCh: number;
  /** ノイズレベル (dB) — 0 で良好、大きいほど劣化 */
  noiseLevel: number;
}

const channels = createTokyoChannels();

export const EXAMPLES: Example[] = [
  {
    name: "NHK総合 選局 (良好受信)",
    description: "UHF 27ch を選局。C/N比が十分で正常にフルセグ受信。OFDM→TS→映像/音声の全パイプラインを確認。",
    physCh: 27, noiseLevel: 0,
  },
  {
    name: "フジテレビ (ワンセグ/フルセグ比較)",
    description: "UHF 21ch。レイヤー A (ワンセグ: QPSK) とレイヤー B (フルセグ: 64QAM) のセグメント構成を確認。",
    physCh: 21, noiseLevel: 0,
  },
  {
    name: "テレビ東京 (軽度ノイズ)",
    description: "ノイズが少しある環境。BER がわずかに上昇するが受信可能。FEC の誤り訂正が働く。",
    physCh: 23, noiseLevel: 8,
  },
  {
    name: "日本テレビ (受信障害 — マルチパス)",
    description: "強いノイズ/マルチパス環境。C/N 比が劣化し、ブロックノイズや受信不能になる。",
    physCh: 25, noiseLevel: 18,
  },
  {
    name: "TBSテレビ (受信不可)",
    description: "極端に悪い受信環境。信号ロスト (ロック外れ) で映像が表示できない状態。",
    physCh: 22, noiseLevel: 30,
  },
  {
    name: "NHK Eテレ (EPG 取得)",
    description: "UHF 26ch を選局。EIT (番組情報テーブル) から EPG データを取り出す過程を確認。",
    physCh: 26, noiseLevel: 0,
  },
];

function phaseColor(phase: ReceptionStep["phase"]): string {
  switch (phase) {
    case "tune":    return "#f59e0b";
    case "agc":     return "#10b981";
    case "fft":     return "#3b82f6";
    case "demod":   return "#8b5cf6";
    case "fec":     return "#ec4899";
    case "ts_sync": return "#06b6d4";
    case "demux":   return "#f97316";
    case "decode":  return "#ef4444";
    case "output":  return "#22c55e";
  }
}

function segColor(layer: "A" | "B" | "C"): string {
  switch (layer) {
    case "A": return "#f59e0b";
    case "B": return "#3b82f6";
    case "C": return "#10b981";
  }
}

function pidColor(pidName: string): string {
  switch (pidName) {
    case "PAT":     return "#f59e0b";
    case "PMT":     return "#3b82f6";
    case "NIT":     return "#06b6d4";
    case "SDT":     return "#8b5cf6";
    case "EIT":     return "#ec4899";
    case "TOT":     return "#64748b";
    case "Video":   return "#ef4444";
    case "Audio":   return "#22c55e";
    case "Caption": return "#a78bfa";
    case "Data":    return "#f97316";
    case "ECM":     return "#dc2626";
    case "NULL":    return "#334155";
    default:        return "#64748b";
  }
}

export class IsdbApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "ISDB-T 地上デジタル放送";
    title.style.cssText = "margin:0;font-size:15px;color:#06b6d4;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exSelect.appendChild(opt);
    }
    header.appendChild(exSelect);

    const tuneBtn = document.createElement("button");
    tuneBtn.textContent = "\u25B6 選局";
    tuneBtn.style.cssText = "padding:4px 16px;background:#06b6d4;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(tuneBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: チャンネル情報 + セグメント + 信号
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const chLabel = document.createElement("div");
    chLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    chLabel.textContent = "Channel Info";
    leftPanel.appendChild(chLabel);

    const chDiv = document.createElement("div");
    chDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(chDiv);

    const segLabel = document.createElement("div");
    segLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    segLabel.textContent = "OFDM Segments (13)";
    leftPanel.appendChild(segLabel);

    const segDiv = document.createElement("div");
    segDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(segDiv);

    const epgLabel = document.createElement("div");
    epgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ec4899;border-bottom:1px solid #1e293b;";
    epgLabel.textContent = "EPG (番組表)";
    leftPanel.appendChild(epgLabel);

    const epgDiv = document.createElement("div");
    epgDiv.style.cssText = "padding:8px 12px;font-size:10px;";
    leftPanel.appendChild(epgDiv);

    main.appendChild(leftPanel);

    // 中央: 受信パイプライントレース
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Reception Pipeline";
    centerPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:8px 12px;font-size:10px;overflow-y:auto;line-height:1.6;";
    centerPanel.appendChild(traceDiv);

    main.appendChild(centerPanel);

    // 右: TS パケット一覧
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:360px;display:flex;flex-direction:column;";

    const tsLabel = document.createElement("div");
    tsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f97316;border-bottom:1px solid #1e293b;";
    tsLabel.textContent = "Transport Stream Packets";
    rightPanel.appendChild(tsLabel);

    const tsDiv = document.createElement("div");
    tsDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(tsDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderChannel = (ch: Channel, result: ReceptionResult) => {
      chDiv.innerHTML = "";
      const add = (label: string, value: string, color: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "3px";
        row.innerHTML = `<span style="color:${color};font-weight:600;">${label}:</span> <span style="color:#94a3b8;">${value}</span>`;
        chDiv.appendChild(row);
      };
      add("放送局", `${ch.name} (リモコン ${ch.remoteId})`, "#f59e0b");
      add("物理CH", `UHF ${ch.physCh}ch`, "#e2e8f0");
      add("周波数", `${ch.frequency} MHz (帯域 ${ch.bandwidth} MHz)`, "#06b6d4");
      add("FFT", `${ch.fftMode} (${ch.fftMode === "8K" ? 8192 : ch.fftMode === "4K" ? 4096 : 2048} pt)`, "#3b82f6");
      add("GI", ch.guardInterval, "#8b5cf6");
      add("信号レベル", `${result.signalLevel.toFixed(1)} dB`, result.locked ? "#10b981" : "#ef4444");
      add("状態", result.locked ? "\u2714 ロック" : "\u2718 ロスト", result.locked ? "#10b981" : "#ef4444");

      // レイヤー詳細
      for (const layer of ch.layers) {
        const color = segColor(layer.id);
        add(`Layer ${layer.id}`, `${layer.segments}seg / ${layer.modulation} / ${layer.bitrate.toFixed(1)} Mbps`, color);
      }

      // セグメント配置図
      const layout = describeSegmentLayout(ch);
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#64748b;font-size:9px;margin-top:6px;line-height:1.3;";
      pre.textContent = layout.join("\n");
      chDiv.appendChild(pre);
    };

    const renderSegments = (segments: OfdmSegment[]) => {
      segDiv.innerHTML = "";
      if (segments.length === 0) {
        segDiv.textContent = "(受信不可)";
        return;
      }
      const grid = document.createElement("div");
      grid.style.cssText = "display:flex;gap:2px;flex-wrap:wrap;";
      for (const seg of segments) {
        const box = document.createElement("div");
        const color = segColor(seg.layer);
        box.style.cssText =
          `width:52px;padding:3px;border:1px solid ${color};border-radius:3px;background:${color}15;text-align:center;font-size:9px;`;
        box.innerHTML =
          `<div style="color:${color};font-weight:600;">Seg${seg.index}</div>` +
          `<div style="color:#64748b;">${seg.layer} ${seg.modulation}</div>` +
          `<div style="color:#475569;">${seg.power.toFixed(0)}dB</div>`;
        grid.appendChild(box);
      }
      segDiv.appendChild(grid);
    };

    const renderEpg = (ch: Channel) => {
      epgDiv.innerHTML = "";
      if (ch.programs.length === 0) {
        epgDiv.textContent = "(番組情報なし)";
        return;
      }
      for (const prog of ch.programs) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:6px;padding:4px 6px;border:1px solid #334155;border-radius:3px;";
        row.innerHTML =
          `<div style="color:#ec4899;font-weight:600;">${prog.startTime} ${prog.name}</div>` +
          `<div style="color:#64748b;font-size:9px;">${prog.genre} / ${prog.duration} / SID=0x${prog.serviceId.toString(16)}</div>` +
          `<div style="color:#94a3b8;font-size:9px;margin-top:2px;">${prog.description}</div>`;
        epgDiv.appendChild(row);
      }
    };

    const renderTrace = (steps: ReceptionStep[]) => {
      traceDiv.innerHTML = "";
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const color = phaseColor(step.phase);

        const stepEl = document.createElement("div");
        stepEl.style.cssText = "margin-bottom:6px;";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;gap:4px;align-items:center;";

        const num = document.createElement("span");
        num.style.cssText = "color:#475569;min-width:18px;";
        num.textContent = `${i + 1}.`;
        header.appendChild(num);

        const badge = document.createElement("span");
        badge.style.cssText = `padding:0 6px;border-radius:3px;font-size:9px;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44;`;
        badge.textContent = step.phase;
        header.appendChild(badge);

        const detail = document.createElement("span");
        detail.style.color = "#e2e8f0";
        detail.textContent = step.detail;
        header.appendChild(detail);

        stepEl.appendChild(header);

        if (step.data !== undefined) {
          const dataEl = document.createElement("div");
          dataEl.style.cssText = "margin-left:22px;color:#64748b;font-size:9px;margin-top:1px;";
          dataEl.textContent = step.data;
          stepEl.appendChild(dataEl);
        }

        // パイプライン矢印
        if (i < steps.length - 1) {
          const arrow = document.createElement("div");
          arrow.style.cssText = "margin-left:22px;color:#334155;font-size:9px;";
          arrow.textContent = "\u2502";
          stepEl.appendChild(arrow);
        }

        traceDiv.appendChild(stepEl);
      }
    };

    const renderTsPackets = (packets: TsPacket[]) => {
      tsDiv.innerHTML = "";
      if (packets.length === 0) {
        tsDiv.textContent = "(TS パケットなし)";
        return;
      }
      for (const pkt of packets) {
        const row = document.createElement("div");
        const color = pidColor(pkt.pidName);
        row.style.cssText = `padding:4px 6px;margin-bottom:2px;border:1px solid ${color}44;border-radius:3px;background:${color}08;`;

        const header = document.createElement("div");
        header.style.cssText = "display:flex;gap:6px;align-items:center;";

        const sync = document.createElement("span");
        sync.style.cssText = "color:#475569;font-size:9px;";
        sync.textContent = `0x${pkt.syncByte.toString(16)}`;
        header.appendChild(sync);

        const pidBadge = document.createElement("span");
        pidBadge.style.cssText = `padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;color:${color};background:${color}15;`;
        pidBadge.textContent = `${pkt.pidName} (0x${pkt.pid.toString(16).padStart(4, "0")})`;
        header.appendChild(pidBadge);

        if (pkt.scrambled) {
          const scr = document.createElement("span");
          scr.style.cssText = "font-size:8px;color:#dc2626;";
          scr.textContent = "\u{1F512}SCR";
          header.appendChild(scr);
        }

        const cc = document.createElement("span");
        cc.style.cssText = "font-size:8px;color:#475569;margin-left:auto;";
        cc.textContent = `CC=${pkt.continuityCounter}`;
        header.appendChild(cc);

        row.appendChild(header);

        const payloadEl = document.createElement("div");
        payloadEl.style.cssText = "color:#94a3b8;font-size:9px;margin-top:2px;padding-left:4px;";
        payloadEl.textContent = pkt.payload;
        row.appendChild(payloadEl);

        tsDiv.appendChild(row);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      traceDiv.innerHTML = "";
      tsDiv.innerHTML = "";
      segDiv.innerHTML = "";
      chDiv.innerHTML = "";
      epgDiv.innerHTML = "";
    };

    const runTune = (ex: Example) => {
      const ch = channels.find((c) => c.physCh === ex.physCh);
      if (ch === undefined) return;

      const result = simulateReception(ch, ex.noiseLevel);
      renderChannel(ch, result);
      renderSegments(result.segments);
      renderEpg(ch);
      renderTrace(result.steps);
      renderTsPackets(result.tsPackets);
    };

    // ── イベント ──
    exSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) loadExample(ex);
    });
    tuneBtn.addEventListener("click", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) runTune(ex);
    });

    loadExample(EXAMPLES[0]!);
  }
}
