import type {
  IRInsn, IROperand, IROpcode, BasicBlock, IRFunction, IRModule,
  PassResult, PassChange,
  LiveInterval, InterferenceEdge, RegAllocResult,
  MachineInsn,
  SimOp, SimEvent, EventType, SimulationResult,
} from "./types.js";
import { typeToString } from "./types.js";

/** オペランドを文字列に */
function operandToString(o: IROperand): string {
  switch (o.kind) {
    case "reg": return `${typeToString(o.type)} %${o.name}`;
    case "const": return `${typeToString(o.type)} ${o.value}`;
    case "label": return `label %${o.name}`;
    case "global": return `${typeToString(o.type)} @${o.name}`;
    case "undef": return `${typeToString(o.type)} undef`;
  }
}

/** 命令を IR テキストに */
function insnToString(insn: IRInsn): string {
  if (insn.eliminated) return `  ; (eliminated) ${insn.id}`;
  const prefix = insn.result ? `  %${insn.result} = ` : "  ";
  switch (insn.op) {
    case "add": case "sub": case "mul": case "sdiv": case "udiv":
    case "srem": case "urem":
    case "fadd": case "fsub": case "fmul": case "fdiv":
    case "and": case "or": case "xor": case "shl": case "lshr": case "ashr":
      return `${prefix}${insn.op} ${operandToString(insn.operands[0]!)}, ${insn.operands[1]!.kind === "const" ? insn.operands[1]!.value : `%${(insn.operands[1] as { name: string }).name}`}`;
    case "icmp":
      return `${prefix}icmp ${insn.pred} ${operandToString(insn.operands[0]!)}, ${insn.operands[1]!.kind === "const" ? insn.operands[1]!.value : `%${(insn.operands[1] as { name: string }).name}`}`;
    case "alloca":
      return `${prefix}alloca ${insn.allocaType ? typeToString(insn.allocaType) : "i32"}`;
    case "load":
      return `${prefix}load ${insn.resultType ? typeToString(insn.resultType) : "i32"}, ${operandToString(insn.operands[0]!)}`;
    case "store":
      return `${prefix}store ${operandToString(insn.operands[0]!)}, ${operandToString(insn.operands[1]!)}`;
    case "getelementptr":
      return `${prefix}getelementptr ${insn.operands.map(operandToString).join(", ")}`;
    case "br":
      return `  br label %${insn.operands[0]!.kind === "label" ? insn.operands[0]!.name : "?"}`;
    case "br_cond":
      return `  br ${operandToString(insn.operands[0]!)}, label %${(insn.operands[1] as { name: string }).name}, label %${(insn.operands[2] as { name: string }).name}`;
    case "ret":
      return insn.operands.length > 0 ? `  ret ${operandToString(insn.operands[0]!)}` : "  ret void";
    case "phi":
      return `${prefix}phi ${insn.resultType ? typeToString(insn.resultType) : "i32"} ${(insn.phiIncoming ?? []).map((inc) => `[ ${inc.value.kind === "const" ? inc.value.value : `%${(inc.value as { name: string }).name}`}, %${inc.block} ]`).join(", ")}`;
    case "select":
      return `${prefix}select ${insn.operands.map(operandToString).join(", ")}`;
    case "call":
      return `${prefix}call ${insn.resultType ? typeToString(insn.resultType) : "void"} @${insn.callee}(${insn.operands.map(operandToString).join(", ")})`;
    case "sext": case "zext": case "trunc": case "bitcast":
      return `${prefix}${insn.op} ${operandToString(insn.operands[0]!)} to ${insn.resultType ? typeToString(insn.resultType) : "?"}`;
    default:
      return `${prefix}${insn.op} ${insn.operands.map(operandToString).join(", ")}`;
  }
}

/** 関数をIRテキストに */
function functionToString(fn: IRFunction): string {
  const params = fn.params.map((p) => `${typeToString(p.type)} %${p.name}`).join(", ");
  const body = fn.blocks.map((bb) => {
    const insns = bb.insns.filter((i) => !i.eliminated).map(insnToString).join("\n");
    return `${bb.label}:\n${insns}`;
  }).join("\n\n");
  return `define ${typeToString(fn.retType)} @${fn.name}(${params}) {\n${body}\n}`;
}

/** オペランドの値を取得 (定数解析用) */
function getConstValue(o: IROperand, env: Map<string, number>): number | undefined {
  if (o.kind === "const") return o.value;
  if (o.kind === "reg" && env.has(o.name)) return env.get(o.name);
  return undefined;
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const events: SimEvent[] = [];
  let step = 0;

  const stats = {
    totalInsns: 0, eliminatedInsns: 0, optimizedInsns: 0,
    passesRun: 0, phiNodes: 0, registersUsed: 0,
    spillCount: 0, machineInsns: 0,
  };

  let module: IRModule = { functions: [], globals: [], structs: [] };
  const passResults: PassResult[] = [];
  let regAlloc: RegAllocResult | undefined;
  const machineCode: MachineInsn[] = [];
  let execResult: { retValue: number; output: string[] } | undefined;

  function emit(type: EventType, desc: string, detail?: string): void {
    events.push({ step, type, description: desc, detail });
  }

  function getFunction(name: string): IRFunction | undefined {
    return module.functions.find((f) => f.name === name);
  }

  /** 全命令数カウント */
  function countInsns(fn: IRFunction): number {
    return fn.blocks.reduce((s, bb) => s + bb.insns.filter((i) => !i.eliminated).length, 0);
  }

  /** ──── 最適化パス ──── */

  /** 定数畳み込み */
  function runConstantFold(fn: IRFunction): PassResult {
    const irBefore = functionToString(fn);
    const changes: PassChange[] = [];
    const constValues = new Map<string, number>();

    for (const bb of fn.blocks) {
      for (const insn of bb.insns) {
        if (insn.eliminated) continue;
        const a = insn.operands[0] ? getConstValue(insn.operands[0], constValues) : undefined;
        const b = insn.operands[1] ? getConstValue(insn.operands[1], constValues) : undefined;

        if (a !== undefined && b !== undefined && insn.result) {
          let val: number | undefined;
          switch (insn.op) {
            case "add": val = a + b; break;
            case "sub": val = a - b; break;
            case "mul": val = a * b; break;
            case "sdiv": val = b !== 0 ? Math.trunc(a / b) : undefined; break;
            case "srem": val = b !== 0 ? a % b : undefined; break;
            case "and": val = a & b; break;
            case "or": val = a | b; break;
            case "xor": val = a ^ b; break;
            case "shl": val = a << b; break;
            case "lshr": val = a >>> b; break;
            case "icmp": {
              switch (insn.pred) {
                case "eq": val = a === b ? 1 : 0; break;
                case "ne": val = a !== b ? 1 : 0; break;
                case "sgt": val = a > b ? 1 : 0; break;
                case "slt": val = a < b ? 1 : 0; break;
                case "sge": val = a >= b ? 1 : 0; break;
                case "sle": val = a <= b ? 1 : 0; break;
              }
              break;
            }
          }
          if (val !== undefined) {
            constValues.set(insn.result, val);
            insn.optimized = true;
            insn.comment = `定数畳み込み: ${a} ${insn.op} ${b} = ${val}`;
            changes.push({
              type: "fold", target: insn.id,
              description: `${insn.op} %${insn.result} = ${a} ${insn.op} ${b} → ${val}`,
              before: insnToString(insn), after: `  %${insn.result} = ${val} (定数)`,
            });
            stats.optimizedInsns++;
            emit("fold",
              `定数畳み込み: %${insn.result} = ${a} ${insn.op} ${b} → ${val}`,
              `コンパイル時に計算可能な式をその結果で置換。実行時コスト = 0。`);
          }
        }
      }
    }

    return { pass: "constant_fold", description: "定数畳み込み — コンパイル時定数の計算", changes, irBefore, irAfter: functionToString(fn) };
  }

  /** 死コード除去 (DCE) */
  function runDCE(fn: IRFunction): PassResult {
    const irBefore = functionToString(fn);
    const changes: PassChange[] = [];

    // 使用されているレジスタを収集
    const used = new Set<string>();
    for (const bb of fn.blocks) {
      for (const insn of bb.insns) {
        if (insn.eliminated) continue;
        for (const op of insn.operands) {
          if (op.kind === "reg") used.add(op.name);
        }
        if (insn.phiIncoming) {
          for (const inc of insn.phiIncoming) {
            if (inc.value.kind === "reg") used.add(inc.value.name);
          }
        }
      }
    }

    // 結果が使用されず副作用のない命令を除去
    const noSideEffect = new Set<IROpcode>(["add", "sub", "mul", "sdiv", "srem", "and", "or", "xor", "shl", "lshr", "ashr", "icmp", "fcmp", "sext", "zext", "trunc", "bitcast", "phi", "select", "fadd", "fsub", "fmul", "fdiv"]);

    for (const bb of fn.blocks) {
      for (const insn of bb.insns) {
        if (insn.eliminated || !insn.result) continue;
        if (noSideEffect.has(insn.op) && !used.has(insn.result)) {
          insn.eliminated = true;
          stats.eliminatedInsns++;
          changes.push({
            type: "eliminate", target: insn.id,
            description: `%${insn.result} は未使用 → 除去`,
            before: insnToString(insn),
          });
          emit("eliminate",
            `DCE: %${insn.result} = ${insn.op} — 未使用のため除去`,
            `使用箇所 (use) が 0 の命令を除去。use-def チェーンで到達可能性を判定。`);
        }
      }
    }

    return { pass: "dce", description: "死コード除去 — 未使用の計算を削除", changes, irBefore, irAfter: functionToString(fn) };
  }

  /** 命令結合 (InstCombine) */
  function runInstCombine(fn: IRFunction): PassResult {
    const irBefore = functionToString(fn);
    const changes: PassChange[] = [];

    for (const bb of fn.blocks) {
      for (const insn of bb.insns) {
        if (insn.eliminated || insn.operands.length < 2) continue;
        const b = insn.operands[1];

        // x + 0 → x, x * 1 → x
        if (b && b.kind === "const") {
          if ((insn.op === "add" || insn.op === "sub") && b.value === 0 && insn.result) {
            insn.optimized = true;
            insn.comment = `${insn.op} x, 0 → x (恒等変換)`;
            stats.optimizedInsns++;
            changes.push({
              type: "replace", target: insn.id,
              description: `${insn.op} %${insn.result}, 0 → コピー`,
            });
            emit("replace",
              `InstCombine: %${insn.result} = ${insn.op} x, 0 → x`,
              `代数的恒等式: x + 0 = x, x - 0 = x`);
          }
          if (insn.op === "mul" && b.value === 1 && insn.result) {
            insn.optimized = true;
            insn.comment = "mul x, 1 → x";
            stats.optimizedInsns++;
            changes.push({
              type: "replace", target: insn.id,
              description: `mul %${insn.result}, 1 → コピー`,
            });
            emit("replace",
              `InstCombine: %${insn.result} = mul x, 1 → x`,
              `代数的恒等式: x * 1 = x`);
          }
          // mul x, 2 → shl x, 1 (強度削減)
          if (insn.op === "mul" && b.value > 1 && (b.value & (b.value - 1)) === 0 && insn.result) {
            const shift = Math.log2(b.value);
            insn.optimized = true;
            insn.comment = `mul x, ${b.value} → shl x, ${shift} (強度削減)`;
            stats.optimizedInsns++;
            changes.push({
              type: "replace", target: insn.id,
              description: `mul %${insn.result}, ${b.value} → shl, ${shift}`,
              before: insnToString(insn),
              after: `  %${insn.result} = shl ..., ${shift}`,
            });
            emit("replace",
              `InstCombine (強度削減): mul x, ${b.value} → shl x, ${shift}`,
              `2のべき乗の乗算をシフトに変換。mul: 3-4サイクル → shl: 1サイクル。`);
          }
        }
      }
    }

    return { pass: "instcombine", description: "命令結合 — 代数的簡約と強度削減", changes, irBefore, irAfter: functionToString(fn) };
  }

  /** mem2reg (alloca → SSA) */
  function runMem2Reg(fn: IRFunction): PassResult {
    const irBefore = functionToString(fn);
    const changes: PassChange[] = [];

    // alloca を探す
    const allocas: { name: string; insn: IRInsn; bb: BasicBlock }[] = [];
    for (const bb of fn.blocks) {
      for (const insn of bb.insns) {
        if (insn.op === "alloca" && insn.result) {
          allocas.push({ name: insn.result, insn, bb });
        }
      }
    }

    for (const alloca of allocas) {
      // 対応する store/load を探す
      const stores: { insn: IRInsn; bb: BasicBlock; value: IROperand }[] = [];
      const loads: { insn: IRInsn; bb: BasicBlock }[] = [];

      for (const bb of fn.blocks) {
        for (const insn of bb.insns) {
          if (insn.eliminated) continue;
          if (insn.op === "store" && insn.operands[1]?.kind === "reg" && insn.operands[1].name === alloca.name) {
            stores.push({ insn, bb, value: insn.operands[0]! });
          }
          if (insn.op === "load" && insn.operands[0]?.kind === "reg" && insn.operands[0].name === alloca.name) {
            loads.push({ insn, bb });
          }
        }
      }

      if (stores.length === 0 && loads.length === 0) continue;

      // alloca を除去
      alloca.insn.eliminated = true;
      stats.eliminatedInsns++;
      changes.push({
        type: "eliminate", target: alloca.insn.id,
        description: `alloca %${alloca.name} → SSA レジスタに昇格`,
      });

      // store を除去し、load を直接値に置換
      for (const store of stores) {
        store.insn.eliminated = true;
        stats.eliminatedInsns++;
      }
      for (const load of loads) {
        load.insn.eliminated = true;
        stats.eliminatedInsns++;
        // 対応する store の値で置換
        if (stores.length > 0) {
          const lastStore = stores[stores.length - 1]!;
          load.insn.comment = `load → ${lastStore.value.kind === "const" ? lastStore.value.value : `%${(lastStore.value as { name: string }).name}`}`;
        }
      }

      // 複数ブロックからの store がある場合 phi ノードを挿入
      if (stores.length > 1) {
        const phiInsn: IRInsn = {
          id: `phi_${alloca.name}`,
          op: "phi",
          result: `${alloca.name}_ssa`,
          resultType: alloca.insn.allocaType ?? { kind: "i32" },
          operands: [],
          phiIncoming: stores.map((s) => ({
            value: s.value,
            block: s.bb.label,
          })),
        };
        // phi をエントリブロックの先頭に挿入 (簡略化)
        const targetBb = fn.blocks.find((b) => loads.some((l) => l.bb.label === b.label));
        if (targetBb) {
          targetBb.insns.unshift(phiInsn);
          stats.phiNodes++;
          changes.push({
            type: "insert", target: phiInsn.id,
            description: `phi ノード挿入: %${phiInsn.result} = phi [${stores.map((s) => s.bb.label).join(", ")}]`,
          });
        }
      }

      emit("ssa",
        `mem2reg: alloca %${alloca.name} → SSA レジスタに昇格`,
        `alloca (スタックメモリ) を SSA レジスタに変換。store → def, load → use。支配境界に phi ノードを挿入。${stores.length > 1 ? `phi ノード ${stores.length} 入力挿入。` : ""}`);
    }

    return { pass: "mem2reg", description: "メモリ→レジスタ昇格 — alloca を SSA 変数に変換", changes, irBefore, irAfter: functionToString(fn) };
  }

  /** CFG 単純化 */
  function runSimplifyCFG(fn: IRFunction): PassResult {
    const irBefore = functionToString(fn);
    const changes: PassChange[] = [];

    // 単一前任者の空ブロックをマージ
    for (let i = fn.blocks.length - 1; i > 0; i--) {
      const bb = fn.blocks[i]!;
      if (bb.preds.length === 1 && bb.insns.filter((ins) => !ins.eliminated).length <= 1) {
        const pred = fn.blocks.find((b) => b.label === bb.preds[0]);
        if (pred && pred.succs.length === 1) {
          // ブロックをマージ
          const brInsn = [...pred.insns].reverse().find((ins: IRInsn) => ins.op === "br" || ins.op === "br_cond");
          if (brInsn && brInsn.op === "br") {
            brInsn.eliminated = true;
            pred.insns.push(...bb.insns.filter((ins) => !ins.eliminated));
            pred.succs = bb.succs;
            bb.insns.forEach((ins) => { ins.eliminated = true; });
            changes.push({
              type: "eliminate", target: bb.label,
              description: `ブロック %${bb.label} を %${pred.label} にマージ`,
            });
            emit("cfg",
              `SimplifyCFG: %${bb.label} → %${pred.label} にマージ`,
              `前任ブロックが1つで無条件分岐のみ → ブロックを統合`);
          }
        }
      }
    }

    return { pass: "simplifycfg", description: "CFG単純化 — 空/冗長ブロックの除去", changes, irBefore, irAfter: functionToString(fn) };
  }

  /** 支配木構築 */
  function buildDomTree(fn: IRFunction): void {
    if (fn.blocks.length === 0) return;
    const entry = fn.blocks[0]!;
    entry.idom = undefined;

    // 簡易支配木 (BFS 順)
    const visited = new Set<string>();
    const queue = [entry.label];
    visited.add(entry.label);

    while (queue.length > 0) {
      const label = queue.shift()!;
      const bb = fn.blocks.find((b) => b.label === label)!;
      for (const succ of bb.succs) {
        if (!visited.has(succ)) {
          visited.add(succ);
          const succBb = fn.blocks.find((b) => b.label === succ);
          if (succBb) {
            succBb.idom = label;
            queue.push(succ);
          }
        }
      }
    }

    // 支配境界の計算
    for (const bb of fn.blocks) {
      bb.domFrontier = [];
    }
    for (const bb of fn.blocks) {
      if (bb.preds.length >= 2) {
        for (const pred of bb.preds) {
          let runner = pred;
          while (runner !== bb.idom && runner) {
            const runnerBb = fn.blocks.find((b) => b.label === runner);
            if (runnerBb) {
              if (!runnerBb.domFrontier.includes(bb.label)) {
                runnerBb.domFrontier.push(bb.label);
              }
              runner = runnerBb.idom ?? "";
            } else break;
          }
        }
      }
    }

    emit("dom",
      `支配木構築: ${fn.blocks.map((b) => `${b.label}→idom:${b.idom ?? "∅"}`).join(", ")}`,
      `支配関係: A が B を支配 ⟺ エントリから B への全パスが A を通る。支配境界は phi 挿入位置の決定に使用。`);

    for (const bb of fn.blocks) {
      if (bb.domFrontier.length > 0) {
        emit("dom",
          `支配境界: %${bb.label} → DF={${bb.domFrontier.join(", ")}}`,
          `支配境界 = 「支配が途切れるブロック」。ここに phi ノードを挿入する。`);
      }
    }
  }

  /** レジスタ割り当て (線形スキャン) */
  function runRegAlloc(fn: IRFunction, physRegs: string[]): RegAllocResult {
    // 生存区間の計算
    const intervals: LiveInterval[] = [];
    let pos = 0;
    const defPos = new Map<string, number>();
    const lastUse = new Map<string, number>();

    for (const bb of fn.blocks) {
      for (const insn of bb.insns) {
        if (insn.eliminated) continue;
        pos++;
        if (insn.result) {
          defPos.set(insn.result, pos);
          if (!lastUse.has(insn.result)) lastUse.set(insn.result, pos);
        }
        for (const op of insn.operands) {
          if (op.kind === "reg") lastUse.set(op.name, pos);
        }
      }
    }

    for (const [vreg, start] of defPos) {
      intervals.push({
        vreg, start, end: lastUse.get(vreg) ?? start,
        spilled: false,
      });
    }

    // 生存区間をソート
    intervals.sort((a, b) => a.start - b.start);

    // 干渉グラフの構築
    const interference: InterferenceEdge[] = [];
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const a = intervals[i]!;
        const b = intervals[j]!;
        if (a.start <= b.end && b.start <= a.end) {
          interference.push({ a: a.vreg, b: b.vreg });
        }
      }
    }

    emit("regalloc",
      `生存区間: ${intervals.length} 仮想レジスタ, ${interference.length} 干渉エッジ`,
      `生存区間 = def から最後の use まで。干渉 = 同時に生存している変数ペア → 同じ物理レジスタに割り当て不可。`);

    // 線形スキャンによる割り当て
    const active: LiveInterval[] = [];
    const coloring = new Map<string, string>();
    const spills: string[] = [];
    const freeRegs = [...physRegs];

    for (const interval of intervals) {
      // 期限切れの active を解放
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i]!.end < interval.start) {
          const freed = active.splice(i, 1)[0]!;
          if (freed.physReg) freeRegs.push(freed.physReg);
        }
      }

      if (freeRegs.length > 0) {
        const reg = freeRegs.shift()!;
        interval.physReg = reg;
        coloring.set(interval.vreg, reg);
        active.push(interval);
        active.sort((a, b) => a.end - b.end);
        emit("regalloc",
          `割り当て: %${interval.vreg} → ${reg} [${interval.start}..${interval.end}]`,
          `空き物理レジスタ ${reg} を割り当て。残り空き: ${freeRegs.length}`);
      } else {
        // スピル: 最も遠い終了点の active をスピル
        const spill = active.length > 0 && active[active.length - 1]!.end > interval.end
          ? active.pop()! : interval;
        if (spill === interval) {
          spill.spilled = true;
          spill.spillSlot = spills.length;
          spills.push(spill.vreg);
          emit("spill",
            `スピル: %${spill.vreg} → スタックスロット [${spill.spillSlot}]`,
            `物理レジスタ不足。メモリ (スタック) に退避。load/store が追加される。`);
        } else {
          const freedReg = spill.physReg!;
          spill.spilled = true;
          spill.spillSlot = spills.length;
          spill.physReg = undefined;
          spills.push(spill.vreg);
          coloring.delete(spill.vreg);

          interval.physReg = freedReg;
          coloring.set(interval.vreg, freedReg);
          active.push(interval);
          active.sort((a, b) => a.end - b.end);
          emit("spill",
            `スピル交換: %${spill.vreg} → スタック, %${interval.vreg} → ${freedReg}`,
            `生存区間が短い方を優先。長い方をスピル。`);
        }
      }
    }

    stats.registersUsed = coloring.size;
    stats.spillCount = spills.length;

    return { intervals, interference, physRegs, coloring, spills };
  }

  /** コード生成 (x86-64 風) */
  function runCodegen(fn: IRFunction, allocResult: RegAllocResult): void {
    machineCode.length = 0;
    const regMap = allocResult.coloring;

    function getReg(name: string): string {
      return regMap.get(name) ?? `[spill_${name}]`;
    }

    machineCode.push({ op: ".globl", operands: [fn.name], comment: `関数 ${fn.name}` });
    machineCode.push({ op: `${fn.name}:`, operands: [] });
    machineCode.push({ op: "push", operands: ["rbp"], comment: "フレームポインタ保存" });
    machineCode.push({ op: "mov", operands: ["rbp", "rsp"], comment: "スタックフレーム設定" });

    if (allocResult.spills.length > 0) {
      machineCode.push({
        op: "sub", operands: ["rsp", `${allocResult.spills.length * 8}`],
        comment: `スピルスロット ${allocResult.spills.length} 個確保`,
      });
    }

    for (const bb of fn.blocks) {
      machineCode.push({ op: `  .${bb.label}:`, operands: [], comment: `基本ブロック ${bb.label}` });

      for (const insn of bb.insns) {
        if (insn.eliminated) continue;

        switch (insn.op) {
          case "add": case "sub": {
            const dst = insn.result ? getReg(insn.result) : "?";
            const src1 = insn.operands[0]?.kind === "reg" ? getReg(insn.operands[0].name) : `${(insn.operands[0] as { value: number }).value}`;
            const src2 = insn.operands[1]?.kind === "const" ? `${insn.operands[1].value}` : insn.operands[1]?.kind === "reg" ? getReg(insn.operands[1].name) : "?";
            if (dst !== src1) machineCode.push({ op: "mov", operands: [dst, src1] });
            machineCode.push({ op: insn.op, operands: [dst, src2], comment: insn.comment });
            break;
          }
          case "mul": {
            const dst = insn.result ? getReg(insn.result) : "?";
            const src1 = insn.operands[0]?.kind === "reg" ? getReg(insn.operands[0].name) : `${(insn.operands[0] as { value: number }).value}`;
            const src2 = insn.operands[1]?.kind === "const" ? `${insn.operands[1].value}` : insn.operands[1]?.kind === "reg" ? getReg(insn.operands[1].name) : "?";
            machineCode.push({ op: "imul", operands: [dst, src1, src2], comment: insn.comment });
            break;
          }
          case "icmp": {
            const src1 = insn.operands[0]?.kind === "reg" ? getReg(insn.operands[0].name) : `${(insn.operands[0] as { value: number }).value}`;
            const src2 = insn.operands[1]?.kind === "const" ? `${insn.operands[1].value}` : insn.operands[1]?.kind === "reg" ? getReg(insn.operands[1].name) : "?";
            machineCode.push({ op: "cmp", operands: [src1, src2] });
            if (insn.result) {
              const setcc = insn.pred === "eq" ? "sete" : insn.pred === "ne" ? "setne" : insn.pred === "slt" ? "setl" : insn.pred === "sgt" ? "setg" : insn.pred === "sle" ? "setle" : "setge";
              machineCode.push({ op: setcc, operands: [getReg(insn.result)], comment: `icmp ${insn.pred}` });
            }
            break;
          }
          case "br":
            machineCode.push({ op: "jmp", operands: [`.${(insn.operands[0] as { name: string }).name}`] });
            break;
          case "br_cond": {
            const cond = insn.operands[0]?.kind === "reg" ? getReg(insn.operands[0].name) : "?";
            machineCode.push({ op: "test", operands: [cond, cond] });
            machineCode.push({ op: "jnz", operands: [`.${(insn.operands[1] as { name: string }).name}`] });
            machineCode.push({ op: "jmp", operands: [`.${(insn.operands[2] as { name: string }).name}`] });
            break;
          }
          case "ret": {
            if (insn.operands.length > 0) {
              const val = insn.operands[0]!.kind === "const" ? `${insn.operands[0]!.value}` : insn.operands[0]!.kind === "reg" ? getReg(insn.operands[0]!.name) : "?";
              if (val !== "eax" && val !== "rax") {
                machineCode.push({ op: "mov", operands: ["eax", val], comment: "戻り値 → eax" });
              }
            }
            machineCode.push({ op: "mov", operands: ["rsp", "rbp"] });
            machineCode.push({ op: "pop", operands: ["rbp"] });
            machineCode.push({ op: "ret", operands: [], comment: "関数から戻る" });
            break;
          }
          case "call": {
            // 引数を ABI レジスタに設定
            const abiRegs = ["edi", "esi", "edx", "ecx", "r8d", "r9d"];
            for (let i = 0; i < insn.operands.length && i < abiRegs.length; i++) {
              const op = insn.operands[i]!;
              const arg = op.kind === "const" ? `${op.value}` : op.kind === "reg" ? getReg(op.name) : "?";
              machineCode.push({ op: "mov", operands: [abiRegs[i]!, arg], comment: `arg${i}` });
            }
            machineCode.push({ op: "call", operands: [insn.callee ?? "?"] });
            if (insn.result) {
              machineCode.push({ op: "mov", operands: [getReg(insn.result), "eax"], comment: "戻り値" });
            }
            break;
          }
          case "phi":
            machineCode.push({ op: "; phi", operands: [], comment: `%${insn.result} (SSA→実レジスタでは解消済み)` });
            break;
          default:
            machineCode.push({ op: `; ${insn.op}`, operands: insn.operands.map((o) => o.kind === "reg" ? getReg(o.name) : o.kind === "const" ? `${o.value}` : "?") });
        }
      }
    }

    stats.machineInsns = machineCode.length;
    emit("codegen",
      `コード生成: ${machineCode.length} マシン命令`,
      `LLVM IR → x86-64 アセンブリ。レジスタ割り当て結果を反映。ABI: System V AMD64 (引数=rdi,rsi,rdx,rcx,r8,r9, 戻り値=rax)`);
  }

  /** IR 実行 (インタプリタ) */
  function executeIR(fn: IRFunction, args: number[]): { retValue: number; output: string[] } {
    const env = new Map<string, number>();
    const output: string[] = [];

    // 引数設定
    for (let i = 0; i < fn.params.length; i++) {
      env.set(fn.params[i]!.name, args[i] ?? 0);
    }

    // メモリ (alloca シミュレーション)
    const memory = new Map<string, number>();

    let currentBb: BasicBlock | undefined = fn.blocks[0];
    let retValue = 0;
    let executed = 0;
    const maxSteps = 1000;

    while (currentBb && executed < maxSteps) {
      const blockInsns: IRInsn[] = currentBb.insns;
      for (const insn of blockInsns) {
        if (insn.eliminated) continue;
        executed++;

        const getVal = (o: IROperand): number => {
          if (o.kind === "const") return o.value;
          if (o.kind === "reg") return env.get(o.name) ?? 0;
          return 0;
        };

        switch (insn.op) {
          case "add": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) + getVal(insn.operands[1]!)); break;
          case "sub": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) - getVal(insn.operands[1]!)); break;
          case "mul": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) * getVal(insn.operands[1]!)); break;
          case "sdiv": {
            const b = getVal(insn.operands[1]!);
            if (insn.result) env.set(insn.result, b !== 0 ? Math.trunc(getVal(insn.operands[0]!) / b) : 0);
            break;
          }
          case "srem": {
            const b = getVal(insn.operands[1]!);
            if (insn.result) env.set(insn.result, b !== 0 ? getVal(insn.operands[0]!) % b : 0);
            break;
          }
          case "and": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) & getVal(insn.operands[1]!)); break;
          case "or": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) | getVal(insn.operands[1]!)); break;
          case "xor": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) ^ getVal(insn.operands[1]!)); break;
          case "shl": if (insn.result) env.set(insn.result, getVal(insn.operands[0]!) << getVal(insn.operands[1]!)); break;
          case "icmp": {
            if (!insn.result) break;
            const a = getVal(insn.operands[0]!);
            const b = getVal(insn.operands[1]!);
            let r = 0;
            switch (insn.pred) {
              case "eq": r = a === b ? 1 : 0; break;
              case "ne": r = a !== b ? 1 : 0; break;
              case "sgt": r = a > b ? 1 : 0; break;
              case "slt": r = a < b ? 1 : 0; break;
              case "sge": r = a >= b ? 1 : 0; break;
              case "sle": r = a <= b ? 1 : 0; break;
            }
            env.set(insn.result, r);
            break;
          }
          case "alloca":
            if (insn.result) {
              memory.set(insn.result, 0);
              env.set(insn.result, 0);
            }
            break;
          case "store": {
            const ptr = insn.operands[1]?.kind === "reg" ? insn.operands[1].name : "";
            memory.set(ptr, getVal(insn.operands[0]!));
            break;
          }
          case "load": {
            const ptr = insn.operands[0]?.kind === "reg" ? insn.operands[0].name : "";
            if (insn.result) env.set(insn.result, memory.get(ptr) ?? 0);
            break;
          }
          case "phi": {
            if (insn.result && insn.phiIncoming && insn.phiIncoming.length > 0) {
              env.set(insn.result, getVal(insn.phiIncoming[0]!.value));
            }
            break;
          }
          case "select": {
            if (insn.result) {
              const cond = getVal(insn.operands[0]!);
              env.set(insn.result, cond ? getVal(insn.operands[1]!) : getVal(insn.operands[2]!));
            }
            break;
          }
          case "br": {
            const target = (insn.operands[0] as { name: string }).name;
            currentBb = fn.blocks.find((b) => b.label === target);
            break;
          }
          case "br_cond": {
            const cond = getVal(insn.operands[0]!);
            const target = cond
              ? (insn.operands[1] as { name: string }).name
              : (insn.operands[2] as { name: string }).name;
            currentBb = fn.blocks.find((b) => b.label === target);
            break;
          }
          case "ret":
            retValue = insn.operands.length > 0 ? getVal(insn.operands[0]!) : 0;
            emit("exec", `ret ${retValue}`, `実行完了: ${executed} ステップ`);
            return { retValue, output };
          case "call":
            emit("exec", `call @${insn.callee}(${insn.operands.map((o: IROperand) => getVal(o)).join(", ")})`, undefined);
            break;
        }

        if (insn.op === "br" || insn.op === "br_cond") break;
      }

      // ブロック末端にジャンプ命令がない場合
      if (currentBb && !currentBb.insns.some((i) => !i.eliminated && (i.op === "br" || i.op === "br_cond" || i.op === "ret"))) {
        break;
      }
    }

    return { retValue, output };
  }

  // ──── メインループ ────
  for (const op of ops) {
    step++;
    switch (op.type) {
      case "define_module":
        module = op.module;
        // 全命令数カウント
        for (const fn of module.functions) {
          stats.totalInsns += countInsns(fn);
        }
        emit("ir",
          `モジュール定義: ${module.functions.length} 関数, ${module.globals.length} グローバル変数`,
          module.functions.map((f) => `@${f.name}: ${countInsns(f)} 命令, ${f.blocks.length} ブロック`).join("\n"));

        // 各関数の IR を表示
        for (const fn of module.functions) {
          emit("ir", `IR: @${fn.name}`, functionToString(fn));
        }
        break;

      case "show_ir": {
        const fn = getFunction(op.functionName);
        if (fn) {
          emit("ir", `IR: @${fn.name}`, functionToString(fn));
        }
        break;
      }

      case "run_pass": {
        const fn = getFunction(op.functionName);
        if (!fn) break;
        stats.passesRun++;

        let result: PassResult;
        switch (op.pass) {
          case "constant_fold": result = runConstantFold(fn); break;
          case "dce": result = runDCE(fn); break;
          case "instcombine": result = runInstCombine(fn); break;
          case "mem2reg": result = runMem2Reg(fn); break;
          case "simplifycfg": result = runSimplifyCFG(fn); break;
          default:
            emit("pass", `パス: ${op.pass} (未実装)`, undefined);
            result = { pass: op.pass, description: "(未実装)", changes: [], irBefore: "", irAfter: "" };
        }

        passResults.push(result);
        emit("pass",
          `パス完了: ${result.pass} — ${result.changes.length} 変更`,
          result.description);

        // パス後の IR を表示
        emit("ir", `IR (${result.pass} 後): @${fn.name}`, functionToString(fn));
        break;
      }

      case "build_dom_tree": {
        const fn = getFunction(op.functionName);
        if (fn) buildDomTree(fn);
        break;
      }

      case "insert_phi": {
        const fn = getFunction(op.functionName);
        if (fn) {
          // mem2reg パスで phi 挿入を実行
          const result = runMem2Reg(fn);
          passResults.push(result);
          stats.passesRun++;
        }
        break;
      }

      case "reg_alloc": {
        const fn = getFunction(op.functionName);
        if (fn) {
          regAlloc = runRegAlloc(fn, op.physRegs);
          emit("regalloc",
            `レジスタ割り当て完了: ${regAlloc.coloring.size} レジスタ使用, ${regAlloc.spills.length} スピル`,
            `物理レジスタ: ${op.physRegs.join(", ")}。線形スキャンアルゴリズム使用。`);
        }
        break;
      }

      case "codegen": {
        const fn = getFunction(op.functionName);
        if (fn && regAlloc) {
          runCodegen(fn, regAlloc);
        } else if (fn) {
          // レジスタ割り当てなしでコード生成
          const defaultAlloc = runRegAlloc(fn, ["eax", "ebx", "ecx", "edx", "esi", "edi"]);
          regAlloc = defaultAlloc;
          runCodegen(fn, defaultAlloc);
        }
        break;
      }

      case "execute_ir": {
        const fn = getFunction(op.functionName);
        if (fn) {
          emit("exec",
            `実行: @${fn.name}(${op.args.join(", ")})`,
            `LLVM IR インタプリタで実行`);
          execResult = executeIR(fn, op.args);
          emit("exec",
            `実行結果: ${execResult.retValue}`,
            `戻り値 = ${execResult.retValue}`);
        }
        break;
      }

      case "snapshot": {
        const totalActive = module.functions.reduce((s, f) => s + countInsns(f), 0);
        emit("info",
          `スナップショット: 全${stats.totalInsns}命令, 除去${stats.eliminatedInsns}, 最適化${stats.optimizedInsns}, パス${stats.passesRun}回`,
          `アクティブ命令: ${totalActive}, phi: ${stats.phiNodes}, レジスタ: ${stats.registersUsed}, スピル: ${stats.spillCount}`);
        break;
      }
    }
  }

  return { events, module, passResults, regAlloc, machineCode, execResult, stats };
}
