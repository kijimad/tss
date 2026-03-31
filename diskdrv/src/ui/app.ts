import { createHDD, createSSD } from "../hw/disk-hardware.js";
import { DiskDriver, type DriverEvent } from "../driver/driver.js";
import { SchedulerAlgorithm } from "../scheduler/io-scheduler.js";

/** プリセット例の型定義 */
export interface Example {
  name: string;
  diskType: string;
  scheduler: SchedulerAlgorithm;
}

/** プリセット例の配列 */
export const EXAMPLES: Example[] = [
  { name: "HDD + FIFO", diskType: "hdd", scheduler: SchedulerAlgorithm.FIFO },
  { name: "HDD + SSTF", diskType: "hdd", scheduler: SchedulerAlgorithm.SSTF },
  { name: "HDD + SCAN", diskType: "hdd", scheduler: SchedulerAlgorithm.SCAN },
  { name: "HDD + C-SCAN", diskType: "hdd", scheduler: SchedulerAlgorithm.CSCAN },
  { name: "SSD + FIFO", diskType: "ssd", scheduler: SchedulerAlgorithm.FIFO },
];

export class DiskDrvApp {
  private driver!: DiskDriver;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private logDiv!: HTMLElement;
  private statsDiv!: HTMLElement;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "Disk Driver + I/O Scheduler"; title.style.cssText = "margin:0;font-size:15px;color:#f59e0b;"; header.appendChild(title);

    // プリセット例セレクタ
    const exampleSelect = document.createElement("select"); exampleSelect.style.cssText = "padding:3px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    const defaultOpt = document.createElement("option"); defaultOpt.value = ""; defaultOpt.textContent = "-- Examples --"; defaultOpt.disabled = true; defaultOpt.selected = true; exampleSelect.appendChild(defaultOpt);
    for (let i = 0; i < EXAMPLES.length; i++) { const ex = EXAMPLES[i]!; const o = document.createElement("option"); o.value = String(i); o.textContent = ex.name; exampleSelect.appendChild(o); }
    header.appendChild(exampleSelect);

    // ディスク種類
    const diskSelect = document.createElement("select"); diskSelect.style.cssText = "padding:3px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (const [v, t] of [["hdd", "HDD (7200RPM)"], ["ssd", "SSD (NVMe)"]]) { const o = document.createElement("option"); o.value = v ?? ""; o.textContent = t ?? ""; diskSelect.appendChild(o); }
    header.appendChild(diskSelect);

    // スケジューラ
    const algoSelect = document.createElement("select"); algoSelect.style.cssText = diskSelect.style.cssText;
    for (const a of [SchedulerAlgorithm.FIFO, SchedulerAlgorithm.SSTF, SchedulerAlgorithm.SCAN, SchedulerAlgorithm.CSCAN]) { const o = document.createElement("option"); o.value = a; o.textContent = a; algoSelect.appendChild(o); }
    algoSelect.value = SchedulerAlgorithm.SCAN;
    header.appendChild(algoSelect);

    // ランダム I/O ボタン
    const randomBtn = document.createElement("button"); randomBtn.textContent = "Random I/O (20 reqs)"; randomBtn.style.cssText = "padding:3px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;"; header.appendChild(randomBtn);
    const seqBtn = document.createElement("button"); seqBtn.textContent = "Sequential I/O (20)"; seqBtn.style.cssText = "padding:3px 12px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;"; header.appendChild(seqBtn);
    const compareBtn = document.createElement("button"); compareBtn.textContent = "Compare All Algorithms"; compareBtn.style.cssText = "padding:3px 12px;background:#a855f7;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;"; header.appendChild(compareBtn);

    container.appendChild(header);

    // メイン
    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: Canvas(ディスク + ヘッド可視化) + 統計
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    this.canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    const cw = 600; const ch = 300;
    this.canvas.width = cw * dpr; this.canvas.height = ch * dpr;
    this.canvas.style.cssText = `width:${String(cw)}px;height:${String(ch)}px;flex-shrink:0;`;
    leftPanel.appendChild(this.canvas);
    const ctxOrNull = this.canvas.getContext("2d"); if (ctxOrNull === null) throw new Error("Canvas failed"); this.ctx = ctxOrNull; this.ctx.scale(dpr, dpr);

    this.statsDiv = document.createElement("div"); this.statsDiv.style.cssText = "flex:1;padding:8px 12px;font-size:11px;overflow-y:auto;border-top:1px solid #1e293b;"; leftPanel.appendChild(this.statsDiv);
    main.appendChild(leftPanel);

    // 右: イベントログ
    const sidebar = document.createElement("div"); sidebar.style.cssText = "width:380px;display:flex;flex-direction:column;overflow:hidden;";
    const logTitle = document.createElement("div"); logTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;"; logTitle.textContent = "I/O Events"; sidebar.appendChild(logTitle);
    this.logDiv = document.createElement("div"); this.logDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;"; sidebar.appendChild(this.logDiv);
    main.appendChild(sidebar);
    container.appendChild(main);

    // 初期化
    this.initDriver(diskSelect.value, algoSelect.value);

    diskSelect.addEventListener("change", () => this.initDriver(diskSelect.value, algoSelect.value));
    algoSelect.addEventListener("change", () => this.initDriver(diskSelect.value, algoSelect.value));

    // プリセット例の選択時にディスク種類とスケジューラを反映
    exampleSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exampleSelect.value)];
      if (ex === undefined) return;
      diskSelect.value = ex.diskType;
      algoSelect.value = ex.scheduler;
      this.initDriver(diskSelect.value, algoSelect.value);
    });

    randomBtn.addEventListener("click", () => {
      this.initDriver(diskSelect.value, algoSelect.value);
      const lbas = Array.from({ length: 20 }, () => Math.floor(Math.random() * this.driver.drive.getTotalSectors()));
      this.runBatch(lbas, "Random I/O");
    });

    seqBtn.addEventListener("click", () => {
      this.initDriver(diskSelect.value, algoSelect.value);
      const start = Math.floor(Math.random() * 1000);
      const lbas = Array.from({ length: 20 }, (_, i) => start + i);
      this.runBatch(lbas, "Sequential I/O");
    });

    compareBtn.addEventListener("click", () => this.runComparison(diskSelect.value));
  }

  private initDriver(diskType: string, algo: string): void {
    const spec = diskType === "ssd" ? createSSD() : createHDD();
    this.driver = new DiskDriver(spec, algo as SchedulerAlgorithm);
    this.driver.onEvent = (e) => this.addLog(e);
    // テストデータを書き込む
    for (let i = 0; i < this.driver.drive.getTotalSectors(); i += 100) {
      this.driver.drive.writeSectorDirect(i, new Uint8Array(512).fill(i & 0xFF));
    }
    this.logDiv.innerHTML = "";
    this.statsDiv.innerHTML = `<div style="color:#64748b">Disk: ${spec.name}<br>Scheduler: ${algo}<br>Cylinders: ${String(spec.cylinders)}<br>Click a button to run I/O</div>`;
    this.drawDisk([]);
  }

  private runBatch(lbas: number[], label: string): void {
    this.logDiv.innerHTML = "";
    this.driver.resetStats();
    this.driver.drive.resetEvents();

    // 全 LBA に対してデータを事前に書き込み
    for (const lba of lbas) {
      this.driver.drive.writeSectorDirect(lba, new Uint8Array(512).fill(lba & 0xFF));
    }

    const results = this.driver.readBatch(lbas);
    const reqs = this.driver.getCompletedRequests();

    // 可視化
    this.drawDisk(reqs.map(r => r.cylinder));
    this.showStats(label, reqs);
  }

  private runComparison(diskType: string): void {
    this.logDiv.innerHTML = "";
    this.statsDiv.innerHTML = "";

    // 同じ LBA セットで各アルゴリズムを比較
    const lbas = Array.from({ length: 30 }, () => Math.floor(Math.random() * 20000));

    const algorithms: SchedulerAlgorithm[] = [SchedulerAlgorithm.FIFO, SchedulerAlgorithm.SSTF, SchedulerAlgorithm.SCAN, SchedulerAlgorithm.CSCAN];
    const results: { algo: string; totalSeek: number; avgSeek: number; maxSeek: number }[] = [];

    for (const algo of algorithms) {
      const spec = diskType === "ssd" ? createSSD() : createHDD();
      const drv = new DiskDriver(spec, algo);
      for (const lba of lbas) drv.drive.writeSectorDirect(lba, new Uint8Array(512));
      drv.readBatch(lbas);
      const reqs = drv.getCompletedRequests();
      const totalSeek = reqs.reduce((s, r) => s + r.seekTimeMs, 0);
      const maxSeek = Math.max(...reqs.map(r => r.seekTimeMs));

      results.push({ algo, totalSeek, avgSeek: totalSeek / reqs.length, maxSeek });
    }

    // 結果表示
    let html = `<div style="color:#f59e0b;font-weight:bold;margin-bottom:8px">Algorithm Comparison (${String(lbas.length)} random I/Os, ${diskType.toUpperCase()})</div>`;
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
    html += '<tr style="color:#94a3b8;border-bottom:1px solid #1e293b"><th style="text-align:left;padding:4px">Algorithm</th><th>Total Seek</th><th>Avg Seek</th><th>Max Seek</th></tr>';

    const minTotal = Math.min(...results.map(r => r.totalSeek));
    for (const r of results) {
      const isBest = r.totalSeek === minTotal;
      const color = isBest ? "#10b981" : "#e2e8f0";
      html += `<tr style="color:${color};border-bottom:1px solid #1e293b11"><td style="padding:4px">${isBest ? "★ " : ""}${r.algo}</td><td style="text-align:right">${r.totalSeek.toFixed(1)}ms</td><td style="text-align:right">${r.avgSeek.toFixed(2)}ms</td><td style="text-align:right">${r.maxSeek.toFixed(2)}ms</td></tr>`;
    }
    html += '</table>';

    if (diskType === "ssd") {
      html += '<div style="color:#64748b;margin-top:8px;font-size:10px">SSD ではシーク時間がほぼゼロなので、アルゴリズムの差はほとんどない</div>';
    }

    this.statsDiv.innerHTML = html;
    this.drawDisk([]);
  }

  private showStats(label: string, reqs: ReturnType<DiskDriver["getCompletedRequests"]>): void {
    const totalSeek = reqs.reduce((s, r) => s + r.seekTimeMs, 0);
    const totalRotate = reqs.reduce((s, r) => s + r.rotationalLatencyMs, 0);
    const totalTransfer = reqs.reduce((s, r) => s + r.transferTimeMs, 0);
    const totalTime = reqs.reduce((s, r) => s + r.totalTimeMs, 0);
    const avgSeek = reqs.length > 0 ? totalSeek / reqs.length : 0;

    let html = `<div style="color:#f59e0b;font-weight:bold;margin-bottom:4px">${label} (${String(reqs.length)} requests)</div>`;
    html += `<div>Total Seek: <b>${totalSeek.toFixed(1)}ms</b> | Avg Seek: ${avgSeek.toFixed(2)}ms</div>`;
    html += `<div>Rotation: ${totalRotate.toFixed(1)}ms | Transfer: ${totalTransfer.toFixed(1)}ms | Total: ${totalTime.toFixed(1)}ms</div>`;
    html += `<div>Cache: ${String(this.driver.getCacheSize())} entries</div>`;
    html += `<div style="margin-top:8px;color:#94a3b8;font-size:10px">Request order (cylinder):</div>`;
    html += `<div style="color:#64748b;font-size:10px;word-break:break-all">${reqs.map(r => String(r.cylinder)).join(" → ")}</div>`;

    this.statsDiv.innerHTML = html;
  }

  // ディスクとヘッドの動きを描画
  private drawDisk(visitedCylinders: number[]): void {
    const ctx = this.ctx;
    const w = 600; const h = 300;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);

    const maxCyl = this.driver.drive.spec.cylinders;
    const margin = 40;
    const trackW = w - margin * 2;
    const centerY = h / 2;

    // シリンダ軸
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, centerY);
    ctx.lineTo(w - margin, centerY);
    ctx.stroke();

    // シリンダ番号ラベル
    ctx.font = "10px monospace";
    ctx.fillStyle = "#475569";
    ctx.textAlign = "center";
    for (let c = 0; c <= maxCyl; c += 10) {
      const x = margin + (c / maxCyl) * trackW;
      ctx.fillText(String(c), x, centerY + 20);
      ctx.beginPath();
      ctx.moveTo(x, centerY - 3);
      ctx.lineTo(x, centerY + 3);
      ctx.stroke();
    }

    if (visitedCylinders.length === 0) {
      ctx.fillStyle = "#475569";
      ctx.textAlign = "center";
      ctx.font = "14px system-ui";
      ctx.fillText("Head movement visualization", w / 2, 30);
      return;
    }

    // ヘッドの移動パスを描画
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const startX = margin + (0 / maxCyl) * trackW; // ヘッド初期位置 = 0
    ctx.moveTo(startX, margin);

    const stepH = (h - margin * 2) / (visitedCylinders.length + 1);
    for (let i = 0; i < visitedCylinders.length; i++) {
      const cyl = visitedCylinders[i] ?? 0;
      const x = margin + (cyl / maxCyl) * trackW;
      const y = margin + (i + 1) * stepH;
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 各リクエスト位置にドット
    for (let i = 0; i < visitedCylinders.length; i++) {
      const cyl = visitedCylinders[i] ?? 0;
      const x = margin + (cyl / maxCyl) * trackW;
      const y = margin + (i + 1) * stepH;

      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(String(cyl), x + 5, y + 3);
    }

    // ラベル
    ctx.fillStyle = "#f59e0b";
    ctx.font = "11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("Head movement (top=first, bottom=last)", margin, 16);
    ctx.fillStyle = "#64748b";
    ctx.fillText(`Cylinder 0`, margin, h - 5);
    ctx.textAlign = "right";
    ctx.fillText(`Cylinder ${String(maxCyl)}`, w - margin, h - 5);
  }

  private addLog(event: DriverEvent): void {
    const row = document.createElement("div");
    const colors: Record<string, string> = {
      cache_hit: "#10b981", cache_miss: "#f59e0b", cache_evict: "#ef4444", cache_flush: "#06b6d4",
      request_submit: "#3b82f6", request_complete: "#94a3b8", batch_complete: "#a855f7",
    };
    row.style.cssText = `padding:1px 12px;color:${colors[event.type] ?? "#64748b"};`;

    switch (event.type) {
      case "cache_hit": row.textContent = `CACHE HIT lba=${String(event.lba)}`; break;
      case "cache_miss": row.textContent = `CACHE MISS lba=${String(event.lba)}`; break;
      case "cache_evict": row.textContent = `EVICT lba=${String(event.lba)} dirty=${String(event.dirty)}`; break;
      case "request_submit": row.textContent = `SUBMIT #${String(event.id)} lba=${String(event.lba)} ${event.mode}`; break;
      case "request_complete": row.textContent = `DONE #${String(event.id)} lba=${String(event.lba)} seek=${event.seekMs.toFixed(1)}ms rot=${event.rotateMs.toFixed(1)}ms total=${event.totalMs.toFixed(1)}ms`; break;
      case "batch_complete": row.textContent = `BATCH ${String(event.count)} reqs, totalSeek=${event.totalSeek.toFixed(1)}ms, avgSeek=${event.avgSeek.toFixed(2)}ms`; break;
      default: row.textContent = event.type;
    }
    this.logDiv.appendChild(row);
    this.logDiv.scrollTop = this.logDiv.scrollHeight;
  }
}
