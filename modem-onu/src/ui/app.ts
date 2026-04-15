/**
 * app.ts — モデム・ONU 可視化UI
 */

import { PRESETS } from "../engine/presets.js";
import type { SimResult, SimSnapshot, SimEvent, ConstellationPoint, SignalSample, AdslBand, OltInfo, FiberParams, PonFrame, SignalQuality } from "../engine/types.js";

// ── 色 ──

function evColor(type: SimEvent["type"]): string {
  switch (type) {
    case "digital_input": case "digital_output": return "#94a3b8";
    case "modulate": case "demodulate": return "#3b82f6";
    case "transmit": case "receive": return "#22c55e";
    case "noise": case "attenuation": return "#f59e0b";
    case "error_detect": return "#ef4444";
    case "constellation": return "#a78bfa";
    case "freq_split": case "dmt_tone": return "#06b6d4";
    case "snr_measure": return "#14b8a6";
    case "optical_tx": return "#22c55e";
    case "optical_rx": return "#3b82f6";
    case "splitter": return "#f97316";
    case "wavelength": return "#8b5cf6";
    case "pon_frame": return "#06b6d4";
    case "ranging": return "#a78bfa";
    case "dba": case "olt_grant": return "#f59e0b";
    case "onu_register": return "#22c55e";
    case "info": return "#64748b";
    case "physical": return "#94a3b8";
  }
}

function sevBg(sev: SimEvent["severity"]): string {
  switch (sev) {
    case "info": return "transparent";
    case "success": return "#0a1a0a";
    case "warning": return "#1a1a0a";
    case "error": return "#1a0a0a";
  }
}

// ── App ──

export class ModemOnuApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;background:#0a0a1a;color:#e0e0e0;font-family:'Menlo','Consolas',monospace;font-size:12px;";

    // ヘッダー
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Modem & ONU Simulator";
    title.style.cssText = "margin:0;font-size:14px;color:#7dd3fc;";
    header.appendChild(title);

    const sel = document.createElement("select");
    sel.style.cssText = "padding:3px 8px;background:#111128;border:1px solid #2a2a4a;border-radius:4px;color:#e0e0e0;font-size:11px;max-width:320px;";
    for (let i = 0; i < PRESETS.length; i++) {
      const o = document.createElement("option"); o.value = String(i); o.textContent = PRESETS[i]!.name; sel.appendChild(o);
    }
    header.appendChild(sel);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 \u5B9F\u884C";
    runBtn.style.cssText = "padding:3px 14px;background:#22d3ee;color:#0a0a1a;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;";
    header.appendChild(runBtn);

    const stepLabel = document.createElement("span");
    stepLabel.style.cssText = "font-size:11px;color:#7dd3fc;";
    stepLabel.textContent = "Step: -";
    header.appendChild(stepLabel);

    const prevBtn = this.btn("\u25C0");
    const nextBtn = this.btn("\u25B6");
    const allBtn = this.btn("\u25B6\u25B6");
    header.appendChild(prevBtn);
    header.appendChild(nextBtn);
    header.appendChild(allBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#888;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // メイン
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:grid;grid-template-columns:1fr 340px;overflow:hidden;";

    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "overflow-y:auto;padding:8px;border-right:1px solid #1e293b;";
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "overflow-y:auto;padding:8px;";
    main.appendChild(rightPanel);

    container.appendChild(main);

    // 状態
    let result: SimResult | null = null;
    let step = 0;

    const render = () => {
      if (!result) return;
      const snap = result.snapshots[step];
      if (!snap) return;
      stepLabel.textContent = `Step: ${step + 1} / ${result.snapshots.length}`;
      this.renderLeft(leftPanel, snap);
      this.renderRight(rightPanel, snap);
    };

    sel.addEventListener("change", () => { descSpan.textContent = PRESETS[Number(sel.value)]?.description ?? ""; });
    runBtn.addEventListener("click", () => {
      const p = PRESETS[Number(sel.value)];
      if (!p) return;
      descSpan.textContent = p.description;
      result = p.run();
      step = 0;
      render();
    });
    prevBtn.addEventListener("click", () => { if (result && step > 0) { step--; render(); } });
    nextBtn.addEventListener("click", () => { if (result && step < result.snapshots.length - 1) { step++; render(); } });
    allBtn.addEventListener("click", () => { if (result) { step = result.snapshots.length - 1; render(); } });

    descSpan.textContent = PRESETS[0]?.description ?? "";
  }

  private btn(t: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = t;
    b.style.cssText = "padding:3px 8px;background:#111128;border:1px solid #2a2a4a;border-radius:4px;color:#e0e0e0;cursor:pointer;font-size:11px;";
    return b;
  }

  private renderLeft(el: HTMLElement, snap: SimSnapshot): void {
    el.innerHTML = "";

    // コンスタレーション
    if (snap.constellation && snap.constellation.length > 0) {
      el.appendChild(this.renderConstellation(snap.constellation));
    }

    // 波形
    if (snap.txSignal && snap.txSignal.length > 0) {
      el.appendChild(this.renderWaveform("送信信号", snap.txSignal, "#3b82f6"));
      if (snap.rxSignal) {
        el.appendChild(this.renderWaveform("受信信号 (ノイズ後)", snap.rxSignal, "#f59e0b"));
      }
    }

    // 信号品質
    if (snap.signalQuality) {
      el.appendChild(this.renderQuality(snap.signalQuality));
    }

    // ADSLトーン
    if (snap.adslBands) {
      el.appendChild(this.renderAdsl(snap.adslBands));
    }

    // OLT/PON
    if (snap.olt) {
      el.appendChild(this.renderOlt(snap.olt));
    }

    // ファイバー
    if (snap.fiber) {
      el.appendChild(this.renderFiber(snap.fiber));
    }

    // PONフレーム
    if (snap.ponFrames && snap.ponFrames.length > 0) {
      el.appendChild(this.renderPonFrames(snap.ponFrames));
    }
  }

  private renderRight(el: HTMLElement, snap: SimSnapshot): void {
    el.innerHTML = "";
    const label = document.createElement("div");
    label.style.cssText = "font-size:11px;font-weight:600;color:#7dd3fc;margin-bottom:6px;";
    label.textContent = `イベント (${snap.events.length})`;
    el.appendChild(label);

    for (const ev of snap.events) {
      const d = document.createElement("div");
      const c = evColor(ev.type);
      d.style.cssText = `padding:4px 6px;margin-bottom:3px;border-radius:3px;background:${sevBg(ev.severity)};border-left:2px solid ${c};`;
      d.innerHTML =
        `<div style="display:flex;gap:4px;align-items:center;">` +
        `<span style="font-size:8px;padding:0 3px;border-radius:2px;color:${c};background:${c}15;border:1px solid ${c}33;">${ev.type}</span>` +
        `<span style="color:#e0e0e0;font-size:10px;">${ev.label}</span></div>` +
        `<div style="font-size:9px;color:#888;margin-top:1px;padding-left:8px;">${ev.from} → ${ev.to}: ${ev.detail}</div>`;
      if (ev.data) {
        const data = Object.entries(ev.data).map(([k, v]) => `<span style="color:#06b6d4;">${k}</span>=<span style="color:#94a3b8;">${v}</span>`).join(" ");
        d.innerHTML += `<div style="font-size:8px;color:#555;padding-left:8px;margin-top:1px;">${data}</div>`;
      }
      el.appendChild(d);
    }
  }

  // ── コンスタレーション (canvas) ──
  private renderConstellation(points: ConstellationPoint[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;";
    wrap.innerHTML = `<div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:4px;">コンスタレーション (I/Q)</div>`;

    const canvas = document.createElement("canvas");
    const size = 260;
    canvas.width = size; canvas.height = size;
    canvas.style.cssText = `background:#050510;border:1px solid #1e293b;border-radius:4px;`;
    wrap.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    // 最大値を計算
    let maxVal = 1;
    for (const p of points) { maxVal = Math.max(maxVal, Math.abs(p.i), Math.abs(p.q)); }
    const scale = (size / 2 - 20) / maxVal;
    const cx = size / 2;
    const cy = size / 2;

    // 軸
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke();

    // ラベル
    ctx.fillStyle = "#555"; ctx.font = "9px monospace";
    ctx.fillText("I", size - 12, cy - 4);
    ctx.fillText("Q", cx + 4, 12);

    // 理想点
    for (const p of points) {
      const x = cx + p.i * scale;
      const y = cy - p.q * scale;
      ctx.fillStyle = "#3b82f644";
      ctx.beginPath(); ctx.arc(x, y, 3, 0, TWO_PI); ctx.fill();

      // 受信点
      if (p.receivedI !== undefined && p.receivedQ !== undefined) {
        const rx = cx + p.receivedI * scale;
        const ry = cy - p.receivedQ * scale;
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath(); ctx.arc(rx, ry, 2, 0, TWO_PI); ctx.fill();
        // 誤差ベクトル
        ctx.strokeStyle = "#f59e0b33";
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(rx, ry); ctx.stroke();
      }
    }

    return wrap;
  }

  // ── 波形 ──
  private renderWaveform(title: string, samples: SignalSample[], color: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;";
    wrap.innerHTML = `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px;">${title}</div>`;

    const canvas = document.createElement("canvas");
    const w = 500; const h = 100;
    canvas.width = w; canvas.height = h;
    canvas.style.cssText = "background:#050510;border:1px solid #1e293b;border-radius:4px;width:100%;";
    wrap.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    // 中心線
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    // 振幅の最大値
    let maxAmp = 0.01;
    for (const s of samples) maxAmp = Math.max(maxAmp, Math.abs(s.amplitude));

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < samples.length && i < w; i++) {
      const x = (i / samples.length) * w;
      const y = h / 2 - (samples[i]!.amplitude / maxAmp) * (h / 2 - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    return wrap;
  }

  // ── 信号品質 ──
  private renderQuality(q: SignalQuality): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;padding:6px;background:#0d0d20;border:1px solid #1e293b;border-radius:4px;";
    const items: [string, string, string][] = [
      ["SNR", `${q.snrDb} dB`, q.snrDb > 20 ? "#22c55e" : q.snrDb > 10 ? "#f59e0b" : "#ef4444"],
      ["BER", q.berEstimate.toExponential(2), q.berEstimate < 1e-6 ? "#22c55e" : "#ef4444"],
      ["EVM", `${q.evm}%`, q.evm < 10 ? "#22c55e" : "#f59e0b"],
      ["減衰", `${q.attenuationDb} dB`, "#94a3b8"],
    ];
    for (const [name, val, c] of items) {
      wrap.innerHTML += `<div style="display:flex;justify-content:space-between;padding:1px 0;"><span style="color:#888;font-size:10px;">${name}</span><span style="color:${c};font-size:10px;font-weight:600;">${val}</span></div>`;
    }
    return wrap;
  }

  // ── ADSL トーン ──
  private renderAdsl(bands: AdslBand[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;";
    wrap.innerHTML = `<div style="font-size:11px;font-weight:600;color:#06b6d4;margin-bottom:4px;">ADSL DMT トーン</div>`;

    const canvas = document.createElement("canvas");
    const w = 500; const h = 120;
    canvas.width = w; canvas.height = h;
    canvas.style.cssText = "background:#050510;border:1px solid #1e293b;border-radius:4px;width:100%;";
    wrap.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    const maxFreq = 1200; // kHz
    const maxBits = 15;

    // 帯域ラベル
    const bandColors: Record<string, string> = { "voice (POTS)": "#ef4444", upstream: "#f59e0b", downstream: "#22c55e" };

    for (const band of bands) {
      const color = bandColors[band.name] ?? "#888";
      for (const tone of band.tones) {
        if (tone.bitsPerTone === 0) continue;
        const x = (tone.freqKHz / maxFreq) * w;
        const barH = (tone.bitsPerTone / maxBits) * (h - 20);
        ctx.fillStyle = color + "aa";
        ctx.fillRect(x, h - 10 - barH, Math.max(1, w / 256), barH);
      }
      // ラベル
      ctx.fillStyle = color;
      ctx.font = "8px monospace";
      const labelX = (band.startKHz / maxFreq) * w;
      ctx.fillText(band.name, Math.max(2, labelX), 10);
    }

    // 軸
    ctx.fillStyle = "#555"; ctx.font = "8px monospace";
    ctx.fillText("0", 2, h - 2);
    ctx.fillText("1104kHz", w - 50, h - 2);

    // 速度表示
    const { calcAdslRate } = await_import_hack();
    let totalUp = 0, totalDown = 0;
    for (const band of bands) for (const t of band.tones) {
      if (band.name === "upstream") totalUp += t.bitsPerTone;
      if (band.name === "downstream") totalDown += t.bitsPerTone;
    }
    const info = document.createElement("div");
    info.style.cssText = "font-size:9px;color:#888;margin-top:4px;";
    info.textContent = `下り: ${(totalDown * 4000 / 1e6).toFixed(2)}Mbps | 上り: ${(totalUp * 4000 / 1e6).toFixed(2)}Mbps`;
    wrap.appendChild(info);

    return wrap;
  }

  // ── OLT ──
  private renderOlt(olt: OltInfo): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;padding:6px;background:#0d0d20;border:1px solid #1e293b;border-radius:4px;";
    wrap.innerHTML = `<div style="font-size:11px;font-weight:600;color:#22c55e;margin-bottom:4px;">OLT: ${olt.id} (${olt.ponType})</div>`;
    wrap.innerHTML += `<div style="font-size:9px;color:#888;">下り: ${olt.downstreamGbps}Gbps | 上り: ${olt.upstreamGbps}Gbps | スプリット: 1:${olt.splitRatio}</div>`;

    if (olt.registeredOnus.length > 0) {
      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:9px;margin-top:4px;";
      table.innerHTML = `<tr style="background:#111128;color:#7dd3fc;"><th style="padding:2px 4px;">ID</th><th>距離</th><th>RTT</th><th>RxPwr</th><th>帯域</th><th>状態</th></tr>`;
      for (const onu of olt.registeredOnus) {
        const stColor = onu.state === "active" ? "#22c55e" : onu.state === "registered" ? "#3b82f6" : "#888";
        table.innerHTML += `<tr style="border-top:1px solid #111128;"><td style="padding:2px 4px;">ONU-${onu.id}</td><td>${onu.distanceKm}km</td><td>${onu.rttUs}μs</td><td>${onu.rxPowerDbm}dBm</td><td>${onu.allocatedBwMbps}Mbps</td><td style="color:${stColor};">${onu.state}</td></tr>`;
      }
      wrap.appendChild(table);
    }
    return wrap;
  }

  // ── ファイバー ──
  private renderFiber(fiber: FiberParams): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;padding:6px;background:#0d0d20;border:1px solid #1e293b;border-radius:4px;";
    wrap.innerHTML = `<div style="font-size:11px;font-weight:600;color:#f97316;margin-bottom:4px;">光ファイバー</div>`;
    const items: [string, string][] = [
      ["距離", `${fiber.lengthKm}km`],
      ["減衰係数", `${fiber.attenuationDbPerKm}dB/km`],
      ["スプリッター損失", `${fiber.splitterLossDb}dB`],
      ["コネクタ損失", `${fiber.connectorLossDb}dB`],
      ["総損失", `${fiber.totalLossDb}dB`],
    ];
    for (const [name, val] of items) {
      wrap.innerHTML += `<div style="display:flex;justify-content:space-between;padding:1px 0;"><span style="color:#888;font-size:9px;">${name}</span><span style="color:#e0e0e0;font-size:9px;">${val}</span></div>`;
    }
    return wrap;
  }

  // ── PONフレーム ──
  private renderPonFrames(frames: PonFrame[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:10px;";
    wrap.innerHTML = `<div style="font-size:11px;font-weight:600;color:#06b6d4;margin-bottom:4px;">PON フレーム</div>`;
    for (const f of frames) {
      const color = f.direction === "downstream" ? "#22c55e" : "#3b82f6";
      const d = document.createElement("div");
      d.style.cssText = `padding:3px 6px;margin-bottom:2px;border-left:2px solid ${color};font-size:9px;`;
      d.innerHTML = `<span style="color:${color};">${f.direction === "downstream" ? "\u2193" : "\u2191"}</span> <span style="color:#e0e0e0;">${f.description}</span> <span style="color:#555;">(${f.wavelengthNm}nm, ${f.payloadBits}bits)</span>`;
      wrap.appendChild(d);
    }
    return wrap;
  }
}

const TWO_PI = 2 * Math.PI;

// 動的importの代わりに直接計算するヘルパー
function await_import_hack() {
  return {
    calcAdslRate: (bands: AdslBand[]) => {
      let up = 0, down = 0;
      for (const b of bands) for (const t of b.tones) {
        if (b.name === "upstream") up += t.bitsPerTone;
        if (b.name === "downstream") down += t.bitsPerTone;
      }
      return { upMbps: Math.round(up * 4000 / 1e6 * 100) / 100, downMbps: Math.round(down * 4000 / 1e6 * 100) / 100 };
    },
  };
}
