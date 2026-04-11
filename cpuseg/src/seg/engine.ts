import type {
  SegmentDescriptor, SegmentSelector, CpuState,
  MemoryOp, SimEvent, SimulationResult, EventType,
  PrivilegeLevel,
} from "./types.js";

/** セレクタをパース（16bit値 → index, TI, RPL） */
export function parseSelector(value: number): SegmentSelector {
  return {
    index: (value >>> 3) & 0x1FFF,
    ti: (value & 0x04) ? "ldt" : "gdt",
    rpl: (value & 0x03) as PrivilegeLevel,
  };
}

/** セレクタを16bit値にエンコード */
export function encodeSelector(sel: SegmentSelector): number {
  return (sel.index << 3) | (sel.ti === "ldt" ? 0x04 : 0x00) | sel.rpl;
}

/** リミットを実効サイズに変換（粒度考慮） */
export function effectiveLimit(desc: SegmentDescriptor): number {
  return desc.granularity ? (desc.limit << 12) | 0xFFF : desc.limit;
}

/** リニアアドレス計算 */
export function linearAddress(base: number, offset: number): number {
  return (base + offset) >>> 0;
}

export function runSimulation(
  gdt: SegmentDescriptor[],
  ldt: SegmentDescriptor[],
  initialCpu: CpuState,
  ops: MemoryOp[],
): SimulationResult {
  // 深いコピー
  const gdtCopy = gdt.map((d) => ({ ...d }));
  const ldtCopy = ldt.map((d) => ({ ...d }));
  const cpu: CpuState = {
    cpl: initialCpu.cpl,
    registers: initialCpu.registers.map((r) => ({
      name: r.name,
      selector: { ...r.selector },
    })),
  };

  const events: SimEvent[] = [];
  let step = 0;
  const stats = {
    totalOps: 0, gpFaults: 0, ssFaults: 0, npFaults: 0,
    ringTransitions: 0, successfulAccesses: 0,
  };

  function emit(type: EventType, desc: string, segIndex?: number): void {
    events.push({ step, type, description: desc, segIndex });
  }

  /** テーブルからディスクリプタを検索 */
  function lookupDescriptor(sel: SegmentSelector): SegmentDescriptor | undefined {
    const table = sel.ti === "gdt" ? gdtCopy : ldtCopy;
    const tableName = sel.ti === "gdt" ? "GDT" : "LDT";
    emit(sel.ti === "gdt" ? "gdt_lookup" : "ldt_lookup",
      `${tableName}[${sel.index}] を検索`, sel.index);
    return table.find((d) => d.index === sel.index);
  }

  /** セグメントレジスタを取得 */
  function getReg(name: string) {
    return cpu.registers.find((r) => r.name === name);
  }

  /** #GP(0) General Protection Fault */
  function gpFault(reason: string): void {
    stats.gpFaults++;
    emit("gp_fault", `#GP(0): ${reason}`);
  }

  /** #SS Stack Segment Fault */
  function ssFault(reason: string): void {
    stats.ssFaults++;
    emit("ss_fault", `#SS: ${reason}`);
  }

  /** #NP Segment Not Present */
  function npFault(reason: string): void {
    stats.npFaults++;
    emit("np_fault", `#NP: ${reason}`);
  }

  /** 特権レベルチェック（データアクセス用: CPLとRPLの両方がDPL以下） */
  function checkDataPrivilege(desc: SegmentDescriptor, sel: SegmentSelector): boolean {
    const maxPriv = Math.max(cpu.cpl, sel.rpl) as PrivilegeLevel;
    emit("privilege_check",
      `特権チェック: CPL=${cpu.cpl}, RPL=${sel.rpl}, DPL=${desc.dpl} (max(CPL,RPL)=${maxPriv} ≤ DPL=${desc.dpl}?)`);
    if (maxPriv <= desc.dpl) {
      emit("privilege_ok", `特権チェック通過: max(CPL,RPL)=${maxPriv} ≤ DPL=${desc.dpl}`);
      return true;
    }
    emit("privilege_fail", `特権違反: max(CPL,RPL)=${maxPriv} > DPL=${desc.dpl}`);
    return false;
  }

  /** 特権レベルチェック（コードセグメント用） */
  function checkCodePrivilege(desc: SegmentDescriptor, sel: SegmentSelector): boolean {
    if (desc.conforming) {
      // コンフォーミング: CPL >= DPL なら OK
      emit("privilege_check",
        `コンフォーミングコード特権チェック: CPL=${cpu.cpl} ≥ DPL=${desc.dpl}?`);
      if (cpu.cpl >= desc.dpl) {
        emit("privilege_ok", `CPL=${cpu.cpl} ≥ DPL=${desc.dpl} — OK`);
        return true;
      }
      emit("privilege_fail", `CPL=${cpu.cpl} < DPL=${desc.dpl}`);
      return false;
    }
    // 非コンフォーミング: CPL === DPL かつ RPL <= DPL
    emit("privilege_check",
      `非コンフォーミングコード特権チェック: CPL=${cpu.cpl}==DPL=${desc.dpl}? RPL=${sel.rpl}≤DPL=${desc.dpl}?`);
    if (cpu.cpl === desc.dpl && sel.rpl <= desc.dpl) {
      emit("privilege_ok", `CPL=${cpu.cpl}==DPL=${desc.dpl}, RPL=${sel.rpl}≤DPL=${desc.dpl} — OK`);
      return true;
    }
    emit("privilege_fail", `非コンフォーミングコード特権不一致`);
    return false;
  }

  /** リミットチェック */
  function checkLimit(desc: SegmentDescriptor, offset: number): boolean {
    const effLimit = effectiveLimit(desc);
    const gran = desc.granularity ? "4KB粒度" : "バイト粒度";
    emit("limit_check",
      `リミットチェック: offset=0x${offset.toString(16)} ≤ limit=0x${effLimit.toString(16)} (${gran})?`);
    if (desc.type === "stack") {
      // スタックセグメントは下方向（offset >= limitが有効範囲）
      if (offset >= desc.limit) {
        emit("limit_ok", `スタックセグメント: offset=0x${offset.toString(16)} ≥ limit=0x${desc.limit.toString(16)} — OK`);
        return true;
      }
      emit("limit_fail", `スタックセグメント リミット違反: offset=0x${offset.toString(16)} < limit=0x${desc.limit.toString(16)}`);
      return false;
    }
    if (offset <= effLimit) {
      emit("limit_ok", `offset=0x${offset.toString(16)} ≤ limit=0x${effLimit.toString(16)} — OK`);
      return true;
    }
    emit("limit_fail", `リミット違反: offset=0x${offset.toString(16)} > limit=0x${effLimit.toString(16)}`);
    return false;
  }

  // ── メインループ ──

  for (const op of ops) {
    step++;
    stats.totalOps++;

    switch (op.type) {
      case "read":
      case "write":
      case "execute": {
        const regName = op.segReg ?? (op.type === "execute" ? "CS" : "DS");
        const reg = getReg(regName);
        if (!reg) { gpFault(`レジスタ ${regName} が見つからない`); continue; }

        const sel = reg.selector;
        const selVal = encodeSelector(sel);
        emit("selector_parse",
          `${regName}=0x${selVal.toString(16).padStart(4, "0")} → index=${sel.index}, TI=${sel.ti.toUpperCase()}, RPL=${sel.rpl}`);

        // ヌルセレクタチェック
        if (sel.index === 0 && sel.ti === "gdt") {
          gpFault(`ヌルセレクタによるメモリアクセス (${regName})`);
          continue;
        }

        // ディスクリプタ検索
        const desc = lookupDescriptor(sel);
        if (!desc) { gpFault(`ディスクリプタが見つからない: ${sel.ti.toUpperCase()}[${sel.index}]`); continue; }

        emit("descriptor_load",
          `${desc.name}: base=0x${desc.base.toString(16)}, limit=0x${desc.limit.toString(16)}, DPL=${desc.dpl}, type=${desc.type}`);

        // 存在チェック
        if (!desc.present) { npFault(`セグメント "${desc.name}" は非存在 (P=0)`); continue; }

        // 種別チェック
        if (op.type === "execute" && desc.type !== "code") {
          emit("type_fail", `実行不可: ${desc.name} はコードセグメントではない (type=${desc.type})`);
          gpFault(`非コードセグメントの実行`);
          continue;
        }
        if (op.type === "write" && desc.type === "code") {
          emit("type_fail", `コードセグメントへの書き込みは不可`);
          gpFault(`コードセグメントへの書き込み`);
          continue;
        }
        if (op.type === "write" && (desc.type === "data" || desc.type === "stack") && !desc.writable) {
          emit("type_fail", `書き込み不可: ${desc.name} (W=0)`);
          gpFault(`読み取り専用セグメントへの書き込み`);
          continue;
        }
        if (op.type === "read" && desc.type === "code" && !desc.readable) {
          emit("type_fail", `コードセグメント "${desc.name}" は読み取り不可 (R=0)`);
          gpFault(`読み取り不可コードセグメントの読み取り`);
          continue;
        }
        emit("type_ok", `種別チェック通過: ${desc.type} セグメントへの${op.type === "read" ? "読み取り" : op.type === "write" ? "書き込み" : "実行"}`);

        // 特権チェック
        if (desc.type === "code") {
          if (!checkCodePrivilege(desc, sel)) {
            gpFault(`コードセグメント特権違反`);
            continue;
          }
        } else {
          if (!checkDataPrivilege(desc, sel)) {
            gpFault(`データセグメント特権違反`);
            continue;
          }
        }

        // リミットチェック
        const offset = op.offset ?? 0;
        if (!checkLimit(desc, offset)) {
          if (regName === "SS") {
            ssFault(`SSリミット違反 (offset=0x${offset.toString(16)})`);
          } else {
            gpFault(`セグメントリミット違反 (${regName}:0x${offset.toString(16)})`);
          }
          continue;
        }

        // リニアアドレス算出
        const linear = linearAddress(desc.base, offset);
        emit("linear_addr",
          `リニアアドレス: base 0x${desc.base.toString(16)} + offset 0x${offset.toString(16)} = 0x${linear.toString(16)}`);

        // アクセス済みビットをセット
        desc.accessed = true;

        const opLabel = op.type === "read" ? "読み取り" : op.type === "write" ? "書き込み" : "実行";
        emit("access_ok",
          `${opLabel}成功: ${regName}:0x${offset.toString(16)} → linear 0x${linear.toString(16)}`);
        stats.successfulAccesses++;
        break;
      }

      case "load_seg": {
        const targetReg = op.targetReg ?? "DS";
        const sel = op.newSelector!;
        const selVal = encodeSelector(sel);
        emit("seg_load",
          `セグメントレジスタ ${targetReg} にセレクタ 0x${selVal.toString(16).padStart(4, "0")} をロード`);
        emit("selector_parse",
          `0x${selVal.toString(16).padStart(4, "0")} → index=${sel.index}, TI=${sel.ti.toUpperCase()}, RPL=${sel.rpl}`);

        // ヌルセレクタはDS/ES/FS/GSに限り許可
        if (sel.index === 0 && sel.ti === "gdt") {
          if (targetReg === "CS" || targetReg === "SS") {
            gpFault(`ヌルセレクタを ${targetReg} にロード不可`);
            continue;
          }
          emit("null_selector", `ヌルセレクタを ${targetReg} にロード（アクセス時に#GP）`);
          const reg = getReg(targetReg);
          if (reg) reg.selector = { ...sel };
          continue;
        }

        // ディスクリプタ検索
        const desc = lookupDescriptor(sel);
        if (!desc) { gpFault(`ディスクリプタが見つからない: ${sel.ti.toUpperCase()}[${sel.index}]`); continue; }

        emit("descriptor_load",
          `${desc.name}: base=0x${desc.base.toString(16)}, limit=0x${desc.limit.toString(16)}, DPL=${desc.dpl}, type=${desc.type}`);

        // 存在チェック
        if (!desc.present) { npFault(`セグメント "${desc.name}" は非存在 (P=0)`); continue; }

        // 種別チェック
        if (targetReg === "CS" && desc.type !== "code") {
          emit("type_fail", `CSにはコードセグメントのみロード可能`);
          gpFault(`非コードセグメントをCSにロード`);
          continue;
        }
        if (targetReg === "SS" && desc.type !== "data" && desc.type !== "stack") {
          emit("type_fail", `SSにはデータ/スタックセグメントのみロード可能`);
          gpFault(`不正なセグメントをSSにロード`);
          continue;
        }
        emit("type_ok", `種別チェック通過: ${desc.type} → ${targetReg}`);

        // 特権チェック
        if (targetReg === "CS") {
          if (!checkCodePrivilege(desc, sel)) {
            gpFault(`CSロード特権違反`);
            continue;
          }
        } else if (targetReg === "SS") {
          // SS: CPL == DPL == RPL
          emit("privilege_check", `SSロード: CPL=${cpu.cpl}==DPL=${desc.dpl}==RPL=${sel.rpl}?`);
          if (cpu.cpl !== desc.dpl || sel.rpl !== desc.dpl) {
            emit("privilege_fail", `SS特権不一致`);
            gpFault(`SSロード特権違反`);
            continue;
          }
          emit("privilege_ok", `SS特権OK: CPL=DPL=RPL=${cpu.cpl}`);
        } else {
          if (!checkDataPrivilege(desc, sel)) {
            gpFault(`${targetReg}ロード特権違反`);
            continue;
          }
        }

        const reg = getReg(targetReg);
        if (reg) reg.selector = { ...sel };
        desc.accessed = true;
        emit("seg_load", `${targetReg} ← セレクタ 0x${selVal.toString(16).padStart(4, "0")} (${desc.name}) ロード完了`);
        stats.successfulAccesses++;
        break;
      }

      case "far_call":
      case "far_jmp": {
        const label = op.type === "far_call" ? "FAR CALL" : "FAR JMP";
        const sel = op.newSelector!;
        const selVal = encodeSelector(sel);
        const offset = op.offset ?? 0;
        emit(op.type === "far_call" ? "far_call" : "far_jmp",
          `${label}: セレクタ 0x${selVal.toString(16).padStart(4, "0")}:0x${offset.toString(16)}`);
        emit("selector_parse",
          `0x${selVal.toString(16).padStart(4, "0")} → index=${sel.index}, TI=${sel.ti.toUpperCase()}, RPL=${sel.rpl}`);

        // ディスクリプタ検索
        const desc = lookupDescriptor(sel);
        if (!desc) { gpFault(`ディスクリプタが見つからない`); continue; }

        emit("descriptor_load",
          `${desc.name}: base=0x${desc.base.toString(16)}, limit=0x${desc.limit.toString(16)}, DPL=${desc.dpl}, type=${desc.type}`);

        if (!desc.present) { npFault(`セグメント "${desc.name}" は非存在`); continue; }

        if (desc.type === "call_gate") {
          // コールゲート経由
          emit("call_gate", `コールゲート検出: ${desc.name}`);

          // ゲート特権チェック: max(CPL,RPL) <= ゲートDPL
          const maxPL = Math.max(cpu.cpl, sel.rpl) as PrivilegeLevel;
          emit("privilege_check", `ゲート特権: max(CPL=${cpu.cpl},RPL=${sel.rpl})=${maxPL} ≤ ゲートDPL=${desc.dpl}?`);
          if (maxPL > desc.dpl) {
            emit("privilege_fail", `ゲート特権違反`);
            gpFault(`コールゲート特権違反`);
            continue;
          }
          emit("privilege_ok", `ゲート特権OK`);

          // ターゲットコードセグメントを検索
          const targetSel = parseSelector(desc.gateSelector ?? 0);
          const targetDesc = (targetSel.ti === "gdt" ? gdtCopy : ldtCopy)
            .find((d) => d.index === targetSel.index);
          if (!targetDesc || targetDesc.type !== "code") {
            gpFault(`コールゲートのターゲットが不正`);
            continue;
          }

          // ターゲット特権チェック: ターゲットDPL <= CPL
          emit("privilege_check", `ターゲットコード特権: DPL=${targetDesc.dpl} ≤ CPL=${cpu.cpl}?`);
          if (targetDesc.dpl > cpu.cpl) {
            emit("privilege_fail", `ターゲットDPL=${targetDesc.dpl} > CPL=${cpu.cpl}`);
            gpFault(`コールゲートターゲット特権違反`);
            continue;
          }

          const oldCpl = cpu.cpl;
          if (targetDesc.dpl < cpu.cpl) {
            cpu.cpl = targetDesc.dpl;
            stats.ringTransitions++;
            emit("ring_transition", `リング遷移: Ring ${oldCpl} → Ring ${cpu.cpl} (コールゲート経由)`);
          }
          emit("privilege_ok", `ターゲット特権OK — CPL=${cpu.cpl}`);

          // CSを更新
          const csReg = getReg("CS");
          if (csReg) csReg.selector = { index: targetSel.index, ti: targetSel.ti, rpl: cpu.cpl as PrivilegeLevel };

          emit("access_ok",
            `${label}成功 → ${targetDesc.name}:0x${(desc.gateOffset ?? 0).toString(16)} (Ring ${cpu.cpl})`);
          stats.successfulAccesses++;
          continue;
        }

        // 通常のコードセグメント
        if (desc.type !== "code") {
          emit("type_fail", `${label}先はコードセグメントでなければならない`);
          gpFault(`非コードセグメントへの${label}`);
          continue;
        }
        emit("type_ok", `種別チェック通過: コードセグメント`);

        if (!checkCodePrivilege(desc, sel)) {
          gpFault(`${label}特権違反`);
          continue;
        }

        if (!checkLimit(desc, offset)) {
          gpFault(`${label}リミット違反`);
          continue;
        }

        const csReg = getReg("CS");
        if (csReg) csReg.selector = { ...sel };
        desc.accessed = true;

        const linear = linearAddress(desc.base, offset);
        emit("linear_addr",
          `リニアアドレス: 0x${desc.base.toString(16)} + 0x${offset.toString(16)} = 0x${linear.toString(16)}`);
        emit("access_ok", `${label}成功 → ${desc.name}:0x${offset.toString(16)}`);
        stats.successfulAccesses++;
        break;
      }
    }
  }

  return {
    events,
    finalCpu: cpu,
    gdt: gdtCopy,
    ldt: ldtCopy,
    stats,
  };
}
