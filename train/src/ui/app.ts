import { simulate } from "../sim/physics.js";
import type {
  TrainSpec, TrackSection, Station, Signal, OperationSchedule,
  TrainState, SimResult, NotchPosition,
} from "../sim/physics.js";

export interface Example {
  name: string;
  description: string;
  spec: TrainSpec;
  sections: TrackSection[];
  stations: Station[];
  signals: Signal[];
  schedule: OperationSchedule;
  maxTime: number;
}

// ── 車両スペック ──

const E235: TrainSpec = {
  name: "E235系 (山手線)", mass: 340, cars: 11, maxTraction: 200, maxBrake: 170,
  emergencyBrake: 260, maxSpeed: 100, resistA: 1500, resistB: 30, resistC: 0.5,
  driveType: "VVVF (SiC-MOSFET)", motor: "MT79 (140kW×4基/両)",
};
const N700S: TrainSpec = {
  name: "N700S (東海道新幹線)", mass: 700, cars: 16, maxTraction: 400, maxBrake: 320,
  emergencyBrake: 500, maxSpeed: 285, resistA: 3000, resistB: 60, resistC: 1.2,
  driveType: "VVVF (SiC-MOSFET)", motor: "TM305 (305kW×4基/両)",
};
const EF66: TrainSpec = {
  name: "EF66 電気機関車", mass: 100.8, cars: 1, maxTraction: 255, maxBrake: 180,
  emergencyBrake: 250, maxSpeed: 110, resistA: 2000, resistB: 40, resistC: 0.8,
  driveType: "直流直巻", motor: "MT56 (950kW×6基)",
};
const E233: TrainSpec = {
  name: "E233系 (中央線快速)", mass: 320, cars: 10, maxTraction: 180, maxBrake: 160,
  emergencyBrake: 240, maxSpeed: 120, resistA: 1400, resistB: 28, resistC: 0.45,
  driveType: "VVVF (IGBT)", motor: "MT75 (140kW×4基/両)",
};
const KIHA40: TrainSpec = {
  name: "キハ40系 (気動車)", mass: 38, cars: 1, maxTraction: 50, maxBrake: 45,
  emergencyBrake: 70, maxSpeed: 95, resistA: 800, resistB: 15, resistC: 0.3,
  driveType: "液体式 (トルクコンバータ)", motor: "DMF15HSA (220PS)",
};

// ── 路線データ ──

function flatTrack(totalM: number): TrackSection[] {
  return [{ startKm: 0, endKm: totalM, gradient: 0, curveRadius: 0, speedLimit: 0, label: "平坦直線" }];
}

const yamanoteSections: TrackSection[] = [
  { startKm: 0, endKm: 300, gradient: 0, curveRadius: 0, speedLimit: 80, label: "渋谷駅構内" },
  { startKm: 300, endKm: 600, gradient: 5, curveRadius: 400, speedLimit: 75, label: "渋谷→原宿 上り坂+曲線" },
  { startKm: 600, endKm: 1100, gradient: -3, curveRadius: 0, speedLimit: 90, label: "原宿→代々木 下り坂" },
  { startKm: 1100, endKm: 1500, gradient: 0, curveRadius: 300, speedLimit: 70, label: "代々木 曲線" },
];
const yamanoteStations: Station[] = [
  { name: "渋谷", distanceM: 0, dwellTime: 30 },
  { name: "原宿", distanceM: 700, dwellTime: 25 },
  { name: "代々木", distanceM: 1200, dwellTime: 25 },
];
const yamanoteSignals: Signal[] = [
  { distanceM: 250, aspect: "G", speedLimit: 999 },
  { distanceM: 550, aspect: "YG", speedLimit: 75 },
  { distanceM: 900, aspect: "G", speedLimit: 999 },
  { distanceM: 1050, aspect: "Y", speedLimit: 45 },
  { distanceM: 1350, aspect: "G", speedLimit: 999 },
];

const shinkansenSections: TrackSection[] = [
  { startKm: 0, endKm: 2000, gradient: 0, curveRadius: 0, speedLimit: 285, label: "直線高速区間" },
  { startKm: 2000, endKm: 4000, gradient: 15, curveRadius: 4000, speedLimit: 270, label: "上り勾配 15‰" },
  { startKm: 4000, endKm: 7000, gradient: 0, curveRadius: 0, speedLimit: 285, label: "平坦直線" },
  { startKm: 7000, endKm: 9000, gradient: -10, curveRadius: 2500, speedLimit: 255, label: "下り勾配 + 曲線" },
  { startKm: 9000, endKm: 10000, gradient: 0, curveRadius: 0, speedLimit: 100, label: "駅進入区間" },
];

const mountainSections: TrackSection[] = [
  { startKm: 0, endKm: 500, gradient: 0, curveRadius: 0, speedLimit: 80, label: "駅構内 平坦" },
  { startKm: 500, endKm: 1500, gradient: 25, curveRadius: 300, speedLimit: 60, label: "急勾配 25‰ + 急曲線" },
  { startKm: 1500, endKm: 2500, gradient: 33, curveRadius: 200, speedLimit: 45, label: "最急勾配 33‰" },
  { startKm: 2500, endKm: 3500, gradient: 10, curveRadius: 500, speedLimit: 65, label: "緩勾配" },
  { startKm: 3500, endKm: 4000, gradient: 0, curveRadius: 0, speedLimit: 60, label: "山頂駅" },
];

export const EXAMPLES: Example[] = [
  {
    name: "E235系 山手線 渋谷→代々木",
    description: "山手線の駅間運転。力行→惰行→制動の繰り返し。曲線・勾配あり。ATC 制限。",
    spec: E235,
    sections: yamanoteSections,
    stations: yamanoteStations,
    signals: yamanoteSignals,
    schedule: {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1.0 } },
        { distanceM: 250, notch: { type: "coast" } },
        { distanceM: 400, notch: { type: "power", level: 0.7 } },
        { distanceM: 550, notch: { type: "brake", level: 0.6 } },
        { distanceM: 680, notch: { type: "brake", level: 0.9 } },
        { distanceM: 730, notch: { type: "power", level: 1.0 } },
        { distanceM: 900, notch: { type: "coast" } },
        { distanceM: 1000, notch: { type: "power", level: 0.5 } },
        { distanceM: 1050, notch: { type: "brake", level: 0.7 } },
        { distanceM: 1170, notch: { type: "brake", level: 1.0 } },
      ],
    },
    maxTime: 200,
  },
  {
    name: "N700S 新幹線 高速走行",
    description: "東海道新幹線の高速区間。285km/h まで加速し、勾配・曲線での速度制限を体験。",
    spec: N700S,
    sections: shinkansenSections,
    stations: [
      { name: "出発駅", distanceM: 0, dwellTime: 0 },
      { name: "到着駅", distanceM: 9800, dwellTime: 30 },
    ],
    signals: [
      { distanceM: 1000, aspect: "G", speedLimit: 999 },
      { distanceM: 5000, aspect: "G", speedLimit: 999 },
      { distanceM: 8500, aspect: "YG", speedLimit: 75 },
      { distanceM: 9500, aspect: "Y", speedLimit: 45 },
    ],
    schedule: {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1.0 } },
        { distanceM: 5000, notch: { type: "coast" } },
        { distanceM: 5500, notch: { type: "power", level: 0.8 } },
        { distanceM: 8000, notch: { type: "brake", level: 0.3 } },
        { distanceM: 8800, notch: { type: "brake", level: 0.6 } },
        { distanceM: 9300, notch: { type: "brake", level: 1.0 } },
      ],
    },
    maxTime: 300,
  },
  {
    name: "E233系 急制動テスト",
    description: "120km/h からの常用最大ブレーキと非常ブレーキの制動距離を比較。",
    spec: E233,
    sections: flatTrack(3000),
    stations: [],
    signals: [{ distanceM: 2000, aspect: "R", speedLimit: 0 }],
    schedule: {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1.0 } },
        { distanceM: 1000, notch: { type: "brake", level: 1.0 } },
      ],
    },
    maxTime: 120,
  },
  {
    name: "キハ40 山岳路線 (33‰勾配)",
    description: "非力な気動車で急勾配に挑む。出力不足で速度が大きく低下する様子を観察。",
    spec: KIHA40,
    sections: mountainSections,
    stations: [
      { name: "麓駅", distanceM: 0, dwellTime: 0 },
      { name: "山頂駅", distanceM: 3800, dwellTime: 30 },
    ],
    signals: [],
    schedule: {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1.0 } },
      ],
    },
    maxTime: 400,
  },
  {
    name: "EF66 貨物列車 (重量編成)",
    description: "大出力電気機関車による貨物牽引。重量 1000t 相当の起動加速の鈍さを体験。",
    spec: { ...EF66, mass: 1000, name: "EF66 + コキ車 20 両 (1000t)" },
    sections: [
      { startKm: 0, endKm: 2000, gradient: 0, curveRadius: 0, speedLimit: 100, label: "平坦直線" },
      { startKm: 2000, endKm: 4000, gradient: 10, curveRadius: 600, speedLimit: 75, label: "上り勾配 10‰" },
      { startKm: 4000, endKm: 6000, gradient: 0, curveRadius: 0, speedLimit: 100, label: "平坦直線" },
    ],
    signals: [],
    stations: [],
    schedule: {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1.0 } },
        { distanceM: 4000, notch: { type: "coast" } },
        { distanceM: 5000, notch: { type: "brake", level: 0.5 } },
      ],
    },
    maxTime: 400,
  },
  {
    name: "E235系 信号現示変化",
    description: "進行 (G) → 減速 (YG) → 注意 (Y) → 停止 (R) の信号パターン照査。ATC 自動減速。",
    spec: E235,
    sections: flatTrack(3000),
    stations: [],
    signals: [
      { distanceM: 500, aspect: "G", speedLimit: 999 },
      { distanceM: 1000, aspect: "YG", speedLimit: 75 },
      { distanceM: 1500, aspect: "Y", speedLimit: 45 },
      { distanceM: 2000, aspect: "YY", speedLimit: 25 },
      { distanceM: 2500, aspect: "R", speedLimit: 0 },
    ],
    schedule: {
      entries: [
        { distanceM: 0, notch: { type: "power", level: 1.0 } },
      ],
    },
    maxTime: 180,
  },
];

// ── UI ──

function notchLabel(n: NotchPosition): string {
  switch (n.type) {
    case "power": return `力行 P${Math.round(n.level * 5)}`;
    case "coast": return "惰行 N";
    case "brake": return `制動 B${Math.round(n.level * 8)}`;
    case "emergency": return "非常 EB";
  }
}

function notchColor(n: NotchPosition): string {
  switch (n.type) {
    case "power": return "#3b82f6";
    case "coast": return "#64748b";
    case "brake": return "#f59e0b";
    case "emergency": return "#ef4444";
  }
}

export class TrainApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Railway Vehicle Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#22c55e;";
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

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 発車";
    runBtn.style.cssText = "padding:4px 16px;background:#22c55e;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const speedLabel = document.createElement("span");
    speedLabel.style.cssText = "font-size:11px;color:#64748b;";
    speedLabel.textContent = "再生速度:";
    header.appendChild(speedLabel);
    const speedSlider = document.createElement("input");
    speedSlider.type = "range"; speedSlider.min = "10"; speedSlider.max = "200"; speedSlider.value = "50";
    speedSlider.style.cssText = "width:80px;accent-color:#22c55e;";
    header.appendChild(speedSlider);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:380px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: 車両スペック + 路線
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:300px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const specLabel = document.createElement("div");
    specLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    specLabel.textContent = "Vehicle Spec";
    leftPanel.appendChild(specLabel);
    const specDiv = document.createElement("div");
    specDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(specDiv);

    const routeLabel = document.createElement("div");
    routeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    routeLabel.textContent = "Track Sections";
    leftPanel.appendChild(routeLabel);
    const routeDiv = document.createElement("div");
    routeDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(routeDiv);

    const resultLabel = document.createElement("div");
    resultLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    resultLabel.textContent = "Result Summary";
    leftPanel.appendChild(resultLabel);
    const resultDiv = document.createElement("div");
    resultDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(resultDiv);

    main.appendChild(leftPanel);

    // 中央: 速度グラフ (Canvas) + 運転台メーター
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const meterDiv = document.createElement("div");
    meterDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;min-height:50px;align-items:center;";
    centerPanel.appendChild(meterDiv);

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "flex:1;width:100%;background:#0a0f1e;";
    centerPanel.appendChild(canvas);

    main.appendChild(centerPanel);

    // 右: リアルタイムログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:320px;display:flex;flex-direction:column;";
    const logLabel = document.createElement("div");
    logLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    logLabel.textContent = "Run Log";
    rightPanel.appendChild(logLabel);
    const logDiv = document.createElement("div");
    logDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──
    let animTimer: ReturnType<typeof setInterval> | null = null;
    let playing = false;
    let currentResult: SimResult | null = null;
    let frame = 0;

    const renderSpec = (spec: TrainSpec) => {
      specDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        specDiv.appendChild(row);
      };
      add("形式", spec.name, "#3b82f6");
      add("編成", `${spec.cars} 両 / ${spec.mass} t`, "#e2e8f0");
      add("最大牽引力", `${spec.maxTraction} kN`, "#22c55e");
      add("常用最大制動", `${spec.maxBrake} kN`, "#f59e0b");
      add("非常制動", `${spec.emergencyBrake} kN`, "#ef4444");
      add("最高速度", `${spec.maxSpeed} km/h`, "#06b6d4");
      add("駆動", spec.driveType, "#8b5cf6");
      add("主電動機", spec.motor, "#64748b");
    };

    const renderRoute = (sections: TrackSection[], stations: Station[]) => {
      routeDiv.innerHTML = "";
      for (const s of sections) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:3px;padding:2px 4px;border-left:2px solid #334155;";
        const grad = s.gradient > 0 ? `\u2197${s.gradient}\u2030` : s.gradient < 0 ? `\u2198${Math.abs(s.gradient)}\u2030` : "\u2192平坦";
        const curve = s.curveRadius > 0 ? ` R=${s.curveRadius}m` : "";
        const limit = s.speedLimit > 0 ? ` [${s.speedLimit}km/h]` : "";
        row.innerHTML = `<span style="color:#f59e0b;">${s.label}</span><br><span style="color:#64748b;">${(s.startKm / 1000).toFixed(1)}-${(s.endKm / 1000).toFixed(1)}km ${grad}${curve}${limit}</span>`;
        routeDiv.appendChild(row);
      }
      if (stations.length > 0) {
        const stTitle = document.createElement("div");
        stTitle.style.cssText = "margin-top:6px;color:#ec4899;font-weight:600;";
        stTitle.textContent = "駅:";
        routeDiv.appendChild(stTitle);
        for (const st of stations) {
          const row = document.createElement("div");
          row.style.cssText = "color:#94a3b8;padding-left:8px;";
          row.textContent = `${st.name} (${(st.distanceM / 1000).toFixed(1)}km)`;
          routeDiv.appendChild(row);
        }
      }
    };

    const renderMeter = (state: TrainState) => {
      meterDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const span = document.createElement("span");
        span.innerHTML = `<span style="color:${c};font-weight:700;font-size:16px;">${v}</span> <span style="color:#64748b;">${l}</span>`;
        meterDiv.appendChild(span);
      };
      add("km/h", state.speed.toFixed(0), "#22c55e");
      add("m", state.distance.toFixed(0), "#06b6d4");
      add("sec", state.time.toFixed(0), "#94a3b8");

      const nSpan = document.createElement("span");
      const nc = notchColor(state.notch);
      nSpan.style.cssText = `padding:2px 8px;border-radius:4px;background:${nc}22;color:${nc};font-weight:600;border:1px solid ${nc}44;font-size:11px;`;
      nSpan.textContent = notchLabel(state.notch);
      meterDiv.appendChild(nSpan);

      if (state.atStation !== null) {
        const st = document.createElement("span");
        st.style.cssText = "padding:2px 8px;border-radius:4px;background:#ec489922;color:#ec4899;font-weight:600;border:1px solid #ec489944;font-size:11px;";
        st.textContent = `\u{1F689} ${state.atStation}`;
        meterDiv.appendChild(st);
      }
    };

    const drawGraph = (snapshots: TrainState[], currentIdx: number) => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      const w = canvas.width = canvas.clientWidth * devicePixelRatio;
      const h = canvas.height = canvas.clientHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;

      ctx.fillStyle = "#0a0f1e";
      ctx.fillRect(0, 0, cw, ch);

      if (snapshots.length < 2) return;
      const maxSpd = Math.max(...snapshots.map((s) => s.speed), 50);
      const maxDist = snapshots[snapshots.length - 1]!.distance;
      const xScale = cw / Math.max(maxDist, 1);
      const yScale = (ch - 30) / maxSpd;

      // グリッド
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 0.5;
      for (let v = 0; v <= maxSpd; v += 20) {
        const y = ch - 15 - v * yScale;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
        ctx.fillStyle = "#475569"; ctx.font = "9px monospace";
        ctx.fillText(`${v}`, 2, y - 2);
      }

      // 速度曲線
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= Math.min(currentIdx, snapshots.length - 1); i++) {
        const s = snapshots[i]!;
        const x = s.distance * xScale;
        const y = ch - 15 - s.speed * yScale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 勾配（背景バー）
      for (const s of snapshots) {
        if (s.gradient !== 0) {
          const x = s.distance * xScale;
          ctx.fillStyle = s.gradient > 0 ? "#ef444418" : "#3b82f618";
          ctx.fillRect(x, 0, 2, ch - 15);
        }
      }

      // 現在位置マーカ
      if (currentIdx < snapshots.length) {
        const cur = snapshots[currentIdx]!;
        const cx = cur.distance * xScale;
        const cy = ch - 15 - cur.speed * yScale;
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      }

      // 軸ラベル
      ctx.fillStyle = "#475569"; ctx.font = "9px monospace";
      ctx.fillText("距離 →", cw - 40, ch - 2);
      ctx.fillText("速度(km/h)", 2, 10);
    };

    const renderResult = (r: SimResult) => {
      resultDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        resultDiv.appendChild(row);
      };
      add("所要時間", `${r.totalTime.toFixed(0)} 秒`, "#e2e8f0");
      add("走行距離", `${(r.totalDistance / 1000).toFixed(2)} km`, "#06b6d4");
      add("最高速度", `${r.maxSpeed.toFixed(1)} km/h`, "#22c55e");
      add("消費電力量", `${r.energyKwh.toFixed(1)} kWh`, "#f59e0b");
    };

    const addLog = (state: TrainState) => {
      const line = document.createElement("div");
      line.style.cssText = "display:flex;gap:4px;";
      const nc = notchColor(state.notch);
      line.innerHTML =
        `<span style="color:#475569;min-width:30px;">${state.time.toFixed(0)}s</span>` +
        `<span style="color:#22c55e;min-width:42px;">${state.speed.toFixed(0)}km/h</span>` +
        `<span style="color:#06b6d4;min-width:42px;">${(state.distance / 1000).toFixed(2)}km</span>` +
        `<span style="color:${nc};min-width:50px;">${notchLabel(state.notch)}</span>` +
        `<span style="color:#64748b;">${state.currentSection}</span>`;
      logDiv.appendChild(line);
      logDiv.scrollTop = logDiv.scrollHeight;
    };

    // ── ロジック ──

    const stop = () => {
      playing = false;
      runBtn.textContent = "\u25B6 発車";
      if (animTimer !== null) { clearInterval(animTimer); animTimer = null; }
    };

    const loadExample = (ex: Example) => {
      stop();
      descSpan.textContent = ex.description;
      renderSpec(ex.spec);
      renderRoute(ex.sections, ex.stations);
      resultDiv.innerHTML = "";
      meterDiv.innerHTML = "";
      logDiv.innerHTML = "";
      currentResult = null;
      frame = 0;
      const ctx = canvas.getContext("2d");
      if (ctx !== null) { canvas.width = canvas.clientWidth; ctx.fillStyle = "#0a0f1e"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    };

    const runSim = (ex: Example) => {
      stop();
      logDiv.innerHTML = "";
      const result = simulate(ex.spec, ex.sections, ex.stations, ex.signals, ex.schedule, ex.maxTime);
      currentResult = result;
      frame = 0;
      renderResult(result);
      playing = true;
      runBtn.textContent = "\u23F8 停止";

      animTimer = setInterval(() => {
        if (currentResult === null || frame >= currentResult.snapshots.length) { stop(); return; }
        const state = currentResult.snapshots[frame]!;
        renderMeter(state);
        drawGraph(currentResult.snapshots, frame);
        if (frame % 4 === 0) addLog(state);
        frame++;
      }, Number(speedSlider.value));
    };

    // ── イベント ──
    exSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) loadExample(ex);
    });
    runBtn.addEventListener("click", () => {
      if (playing) { stop(); return; }
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) runSim(ex);
    });
    speedSlider.addEventListener("input", () => {
      if (playing && currentResult !== null) {
        const ex = EXAMPLES[Number(exSelect.value)];
        if (animTimer !== null) clearInterval(animTimer);
        animTimer = setInterval(() => {
          if (currentResult === null || frame >= currentResult.snapshots.length) { stop(); return; }
          const state = currentResult.snapshots[frame]!;
          renderMeter(state);
          drawGraph(currentResult.snapshots, frame);
          if (frame % 4 === 0) addLog(state);
          frame++;
        }, Number(speedSlider.value));
        void ex;
      }
    });

    loadExample(EXAMPLES[0]!);
  }
}
