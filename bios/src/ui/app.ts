import { createDefaultHardware, createFaultyHardware } from "../hw/hardware.js";
import { BiosPost, type PostEvent } from "../bios/post.js";

export class BiosApp {
  private screenDiv!: HTMLElement;
  private hwInfoDiv!: HTMLElement;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#000;color:#aaa;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #333;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "BIOS / POST Simulator"; title.style.cssText = "margin:0;font-size:15px;color:#ffcc00;"; header.appendChild(title);

    const bootBtn = document.createElement("button"); bootBtn.textContent = "Power ON (normal)"; bootBtn.style.cssText = "padding:4px 16px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;"; header.appendChild(bootBtn);
    const faultBtn = document.createElement("button"); faultBtn.textContent = "Power ON (faulty RAM)"; faultBtn.style.cssText = "padding:4px 16px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;"; header.appendChild(faultBtn);

    const speedLabel = document.createElement("label"); speedLabel.style.cssText = "font-size:11px;color:#888;display:flex;align-items:center;gap:4px;";
    speedLabel.textContent = "Speed:";
    const speedSlider = document.createElement("input"); speedSlider.type = "range"; speedSlider.min = "0"; speedSlider.max = "300"; speedSlider.value = "50"; speedLabel.appendChild(speedSlider);
    header.appendChild(speedLabel);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: BIOS 画面
    this.screenDiv = document.createElement("div");
    this.screenDiv.style.cssText = "flex:1;padding:16px;font-family:'Cascadia Code','Fira Code',monospace;font-size:13px;line-height:1.5;overflow-y:auto;background:#000;";
    main.appendChild(this.screenDiv);

    // 右: ハードウェア情報
    const sidebar = document.createElement("div"); sidebar.style.cssText = "width:360px;display:flex;flex-direction:column;border-left:1px solid #333;overflow:hidden;";
    const hwTitle = document.createElement("div"); hwTitle.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ffcc00;border-bottom:1px solid #333;"; hwTitle.textContent = "Hardware Detection"; sidebar.appendChild(hwTitle);
    this.hwInfoDiv = document.createElement("div"); this.hwInfoDiv.style.cssText = "flex:1;overflow-y:auto;font-size:10px;font-family:monospace;"; sidebar.appendChild(this.hwInfoDiv);
    main.appendChild(sidebar);
    container.appendChild(main);

    bootBtn.addEventListener("click", () => this.boot(createDefaultHardware(), Number(speedSlider.value)));
    faultBtn.addEventListener("click", () => this.boot(createFaultyHardware(), Number(speedSlider.value)));
  }

  private async boot(hw: ReturnType<typeof createDefaultHardware>, delayMs: number): Promise<void> {
    this.screenDiv.innerHTML = "";
    this.hwInfoDiv.innerHTML = "";

    const bios = new BiosPost(hw, delayMs);
    bios.onEvent = (e) => {
      this.addScreenLine(e);
      this.addHwInfo(e);
    };

    // 電源投入エフェクト
    this.addText("\n\n", "#000");
    await new Promise(r => setTimeout(r, 200));

    const result = await bios.runPost();

    if (result.success) {
      this.addText("\n", "#000");
      this.addText("=".repeat(60) + "\n", "#333");
      this.addText("  OS Boot Sequence Started\n", "#10b981");
      this.addText("  " + (result.bootDevice ?? "unknown") + "\n", "#888");
      this.addText("=".repeat(60) + "\n", "#333");
    } else {
      this.addText("\n\n", "#000");
      this.addText("  SYSTEM HALTED", "#ff0000");
      if (result.errorCode !== undefined) {
        this.addText(`  Error: ${result.errorCode}`, "#ff0000");
      }
    }

    this.addText(`\n\n  POST completed in ${result.durationMs.toFixed(0)}ms\n`, "#555");
  }

  private addScreenLine(event: PostEvent): void {
    switch (event.type) {
      case "phase":
        this.addText(`\n[${ event.phase}] ${event.description}\n`, "#ffcc00");
        break;
      case "test":
        this.addText(`  ${event.component.padEnd(20)}`, "#aaa");
        this.addText(event.result === "ok" ? "[ OK ]" : event.result === "fail" ? "[FAIL]" : "[SKIP]",
          event.result === "ok" ? "#10b981" : event.result === "fail" ? "#ff0000" : "#888");
        this.addText(`  ${event.detail}\n`, "#888");
        break;
      case "detect":
        this.addText(`  ${event.category.padEnd(10)}`, "#5eead4");
        this.addText(`${event.device}\n`, "#ccc");
        if (event.detail) this.addText(`${"".padEnd(12)}${event.detail}\n`, "#666");
        break;
      case "memory_test":
        // メモリテスト進捗（最後のパターンのみ表示）
        if (event.pattern === "0xAA") {
          this.addText(`  Testing ${String(event.total)}MB ... `, "#888");
          this.addText(`pattern ${event.pattern} `, "#666");
        }
        break;
      case "pci_enum":
        this.addText(`  [${String(event.bus).padStart(2, "0")}:${String(event.device).padStart(2, "0")}] `, "#5eead4");
        this.addText(`${event.vendor.padEnd(30)}`, "#888");
        this.addText(`${event.name}\n`, "#ccc");
        break;
      case "boot_select":
        this.addText(`  ${event.device.padEnd(30)}`, "#aaa");
        this.addText(`${event.reason}\n`, event.reason.includes("valid") ? "#10b981" : "#888");
        break;
      case "mbr_read":
        this.addText(`  MBR Signature: `, "#aaa");
        this.addText(`${event.signature}\n`, event.valid ? "#10b981" : "#ff0000");
        break;
      case "boot_jump":
        this.addText(`\n  >>> ${event.message}\n`, "#ffcc00");
        this.addText(`  >>> Jump to ${event.address}\n`, "#ffcc00");
        break;
      case "beep":
        this.addText(`  BEEP: ${event.pattern} (${event.meaning})\n`, event.count === 1 ? "#10b981" : "#ff0000");
        break;
      case "error":
        this.addText(`\n  ERROR ${event.code}: ${event.message}\n`, "#ff0000");
        break;
      case "log":
        this.addText(`  ${event.message}\n`, event.level === "error" ? "#ff0000" : event.level === "warn" ? "#ffcc00" : "#888");
        break;
    }
  }

  private addHwInfo(event: PostEvent): void {
    if (event.type !== "detect" && event.type !== "pci_enum" && event.type !== "test") return;
    const row = document.createElement("div");
    row.style.cssText = "padding:2px 12px;border-bottom:1px solid #1a1a1a;";
    const colors: Record<string, string> = { ok: "#10b981", fail: "#ef4444", skip: "#888" };

    if (event.type === "test") {
      row.style.color = colors[event.result] ?? "#888";
      row.textContent = `${event.result === "ok" ? "\u2713" : event.result === "fail" ? "\u2717" : "-"} ${event.component}: ${event.detail.slice(0, 50)}`;
    } else if (event.type === "detect") {
      row.style.color = "#5eead4";
      row.textContent = `${event.category}: ${event.device}`;
    } else if (event.type === "pci_enum") {
      row.style.color = "#94a3b8";
      row.textContent = `PCI [${String(event.bus)}:${String(event.device)}] ${event.name.slice(0, 40)}`;
    }

    this.hwInfoDiv.appendChild(row);
    this.hwInfoDiv.scrollTop = this.hwInfoDiv.scrollHeight;
  }

  private addText(text: string, color: string): void {
    const span = document.createElement("span");
    span.style.cssText = `white-space:pre;color:${color};`;
    span.textContent = text;
    this.screenDiv.appendChild(span);
    this.screenDiv.scrollTop = this.screenDiv.scrollHeight;
  }
}
