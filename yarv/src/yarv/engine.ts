import type {
  CallInfo, InlineCache, MethodEntry,
  ControlFrame, FrameType,
  RubyValue, RubyValueType,
  FiberState, HeapPage, HeapSlot,
  VMState,
  SimOp, SimEvent, EventType, SimulationResult,
} from "./types.js";

/** nil/true/false 定数 */
function mkNil(): RubyValue {
  return { type: "nil", klass: "NilClass", value: null, objectId: 0, frozen: true, ivars: {}, flags: ["FROZEN"] };
}
function mkTrue(): RubyValue {
  return { type: "true", klass: "TrueClass", value: true, objectId: 2, frozen: true, ivars: {}, flags: ["FROZEN"] };
}
function mkFalse(): RubyValue {
  return { type: "false", klass: "FalseClass", value: false, objectId: 4, frozen: true, ivars: {}, flags: ["FROZEN"] };
}

function mkFixnum(n: number, id: number): RubyValue {
  return { type: "fixnum", klass: "Integer", value: n, objectId: id, frozen: true, ivars: {}, flags: ["FROZEN"] };
}
function mkSymbol(s: string, id: number): RubyValue {
  return { type: "symbol", klass: "Symbol", value: s, objectId: id, frozen: true, ivars: {}, flags: ["FROZEN"] };
}
function rubyToS(v: RubyValue): string {
  if (v.type === "nil") return "nil";
  if (v.type === "true") return "true";
  if (v.type === "false") return "false";
  if (v.type === "fixnum" || v.type === "float") return String(v.value);
  if (v.type === "string") return String(v.value);
  if (v.type === "symbol") return `:${v.value}`;
  if (v.type === "array") return `[${(v.value as RubyValue[]).map(rubyToS).join(", ")}]`;
  return `#<${v.klass}:0x${v.objectId.toString(16).padStart(8, "0")}>`;
}

function isTruthy(v: RubyValue): boolean {
  return v.type !== "nil" && v.type !== "false";
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const events: SimEvent[] = [];
  let step = 0;

  const stats = {
    totalInsns: 0, optInsns: 0, cacheHits: 0, cacheMisses: 0,
    framePushes: 0, framePops: 0, gcRuns: 0,
    objectsAllocated: 0, objectsFreed: 0, methodCalls: 0, blockCalls: 0,
  };

  // VM 状態初期化
  const vm: VMState = {
    stack: [],
    cfpStack: [],
    iseqs: new Map(),
    methods: new Map(),
    constants: new Map(),
    globals: new Map(),
    classes: new Map(),
    gc: {
      heapPages: [{ id: 0, slots: Array.from({ length: 16 }, (): HeapSlot => ({ objectId: null, marked: false })), freeCount: 16 }],
      totalAllocated: 0, totalFreed: 0, gcCount: 0,
      phase: "none", markStack: [],
    },
    fibers: [],
    currentFiberId: 0,
    objectIdCounter: 10, // 0,2,4 は nil/true/false 用
    classSerialCounter: 0,
    output: [],
  };

  // 組み込みクラスの登録
  const builtinClasses = ["BasicObject", "Object", "Integer", "String", "Symbol", "Array", "Hash", "NilClass", "TrueClass", "FalseClass", "Proc", "Fiber", "Range"];
  for (const name of builtinClasses) {
    const serial = vm.classSerialCounter++;
    const superclass = name === "BasicObject" ? undefined : name === "Object" ? "BasicObject" : "Object";
    const ancestors = name === "BasicObject" ? ["BasicObject"] :
      name === "Object" ? ["Object", "BasicObject"] :
      [name, "Object", "BasicObject"];
    vm.classes.set(name, { name, superclass, modules: [], serial, ancestors });
    vm.methods.set(name, new Map());
  }

  // インラインキャッシュ (メソッド名 → キャッシュ)
  const inlineCaches: Map<string, InlineCache> = new Map();

  function emit(type: EventType, desc: string, detail?: string): void {
    const stackSnapshot = vm.stack.slice(-8).map(rubyToS);
    const cfp = vm.cfpStack[vm.cfpStack.length - 1];
    const frameInfo = cfp ? `${cfp.type}:${cfp.iseqLabel} pc=${cfp.pc}` : undefined;
    events.push({ step, type, description: desc, detail, stackSnapshot, frameInfo });
  }

  /** オブジェクト割り当て (GC ヒープ上) */
  function allocObject(type: RubyValueType, klass: string, value: unknown): RubyValue {
    const id = vm.objectIdCounter++;
    const obj: RubyValue = { type, klass, value, objectId: id, frozen: false, ivars: {}, flags: [] };
    vm.gc.totalAllocated++;
    stats.objectsAllocated++;

    // ヒープスロットに配置
    let placed = false;
    for (const page of vm.gc.heapPages) {
      for (const slot of page.slots) {
        if (slot.objectId === null) {
          slot.objectId = id;
          page.freeCount--;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      // 新しいヒープページ追加
      const newPage: HeapPage = {
        id: vm.gc.heapPages.length,
        slots: Array.from({ length: 16 }, (): HeapSlot => ({ objectId: null, marked: false })),
        freeCount: 15,
      };
      newPage.slots[0]!.objectId = id;
      vm.gc.heapPages.push(newPage);
    }

    emit("gc_alloc",
      `オブジェクト割り当て: ${type} #${id} (${klass})`,
      `ヒープ空き: ${vm.gc.heapPages.reduce((s, p) => s + p.freeCount, 0)} スロット`);
    return obj;
  }

  /** フレームプッシュ */
  function pushFrame(type: FrameType, iseqLabel: string, self: RubyValue, methodName?: string): void {
    const cfp: ControlFrame = {
      type, iseqLabel, pc: 0,
      sp: vm.stack.length,
      ep: vm.stack.length,
      self, methodName,
    };
    vm.cfpStack.push(cfp);
    stats.framePushes++;
    emit("frame_push",
      `フレームプッシュ: ${type} "${iseqLabel}"${methodName ? ` (${methodName})` : ""}`,
      `CFP depth=${vm.cfpStack.length}, SP=${cfp.sp}, EP=${cfp.ep}, self=${rubyToS(self)}`);
  }

  /** フレームポップ */
  function popFrame(): ControlFrame | undefined {
    const cfp = vm.cfpStack.pop();
    if (cfp) {
      stats.framePops++;
      emit("frame_pop",
        `フレームポップ: ${cfp.type} "${cfp.iseqLabel}"`,
        `CFP depth=${vm.cfpStack.length}`);
    }
    return cfp;
  }

  /** メソッド探索 (祖先チェーン) */
  function lookupMethod(klass: string, mid: string): MethodEntry | undefined {
    const classInfo = vm.classes.get(klass);
    if (!classInfo) return undefined;
    for (const ancestor of classInfo.ancestors) {
      const methods = vm.methods.get(ancestor);
      if (methods) {
        const entry = methods.get(mid);
        if (entry) return entry;
      }
    }
    return undefined;
  }

  /** インラインキャッシュによるメソッドディスパッチ */
  function dispatchMethod(receiver: RubyValue, ci: CallInfo): MethodEntry | undefined {
    const cacheKey = `${receiver.klass}#${ci.mid}`;
    let cache = inlineCaches.get(cacheKey);
    const classInfo = vm.classes.get(receiver.klass);
    const serial = classInfo?.serial ?? -1;

    if (cache && cache.classSerial === serial && cache.methodEntry) {
      cache.hitCount++;
      stats.cacheHits++;
      emit("cache_hit",
        `インラインキャッシュヒット: ${cacheKey} (${cache.hitCount}回目)`,
        `serial=${serial}, メソッド=${cache.methodEntry.owner}#${cache.methodEntry.name}`);
      return cache.methodEntry;
    }

    // キャッシュミス → 祖先チェーンを辿る
    const entry = lookupMethod(receiver.klass, ci.mid);
    if (!cache) {
      cache = { classSerial: serial, hitCount: 0, missCount: 0 };
      inlineCaches.set(cacheKey, cache);
    }
    cache.missCount++;
    cache.classSerial = serial;
    cache.methodEntry = entry;
    stats.cacheMisses++;

    emit("cache_miss",
      `インラインキャッシュミス: ${cacheKey}`,
      `祖先チェーン: ${classInfo?.ancestors.join(" → ") ?? "?"} → ${entry ? `${entry.owner}#${entry.name}` : "method_missing"}`);
    return entry;
  }

  /** スペシャル命令の実行 (opt_plus 等) */
  function execOptInsn(op: string, _ci: CallInfo): boolean {
    stats.optInsns++;
    if (vm.stack.length < 2 && !op.startsWith("opt_not") && !op.startsWith("opt_nil") && !op.startsWith("opt_length") && !op.startsWith("opt_size") && !op.startsWith("opt_empty")) return false;

    const unaryOps = ["opt_not", "opt_nil_p", "opt_length", "opt_size", "opt_empty_p"];
    if (unaryOps.includes(op)) {
      const recv = vm.stack[vm.stack.length - 1];
      if (!recv) return false;

      if (op === "opt_not") {
        vm.stack.pop();
        vm.stack.push(isTruthy(recv) ? mkFalse() : mkTrue());
        emit("opt_insn", `${op}: !${rubyToS(recv)} → ${rubyToS(vm.stack[vm.stack.length - 1]!)}`, "単項スペシャル命令 — 型チェック → 即値演算");
        return true;
      }
      if (op === "opt_nil_p") {
        vm.stack.pop();
        vm.stack.push(recv.type === "nil" ? mkTrue() : mkFalse());
        emit("opt_insn", `${op}: ${rubyToS(recv)}.nil? → ${rubyToS(vm.stack[vm.stack.length - 1]!)}`, "nil判定スペシャル命令");
        return true;
      }
      if ((op === "opt_length" || op === "opt_size") && recv.type === "string") {
        vm.stack.pop();
        const len = (recv.value as string).length;
        vm.stack.push(mkFixnum(len, vm.objectIdCounter++));
        emit("opt_insn", `${op}: "${recv.value}".length → ${len}`, "String#length スペシャル命令");
        return true;
      }
      if ((op === "opt_length" || op === "opt_size") && recv.type === "array") {
        vm.stack.pop();
        const len = (recv.value as RubyValue[]).length;
        vm.stack.push(mkFixnum(len, vm.objectIdCounter++));
        emit("opt_insn", `${op}: Array#length → ${len}`, "Array#length スペシャル命令");
        return true;
      }
      return false;
    }

    const b = vm.stack[vm.stack.length - 1]!;
    const a = vm.stack[vm.stack.length - 2]!;

    // Fixnum 同士の演算はインライン化
    if (a.type === "fixnum" && b.type === "fixnum") {
      const av = a.value as number;
      const bv = b.value as number;
      let result: RubyValue | undefined;

      switch (op) {
        case "opt_plus": result = mkFixnum(av + bv, vm.objectIdCounter++); break;
        case "opt_minus": result = mkFixnum(av - bv, vm.objectIdCounter++); break;
        case "opt_mult": result = mkFixnum(av * bv, vm.objectIdCounter++); break;
        case "opt_div": result = bv !== 0 ? mkFixnum(Math.trunc(av / bv), vm.objectIdCounter++) : undefined; break;
        case "opt_mod": result = bv !== 0 ? mkFixnum(av % bv, vm.objectIdCounter++) : undefined; break;
        case "opt_eq": result = av === bv ? mkTrue() : mkFalse(); break;
        case "opt_lt": result = av < bv ? mkTrue() : mkFalse(); break;
        case "opt_le": result = av <= bv ? mkTrue() : mkFalse(); break;
        case "opt_gt": result = av > bv ? mkTrue() : mkFalse(); break;
        case "opt_ge": result = av >= bv ? mkTrue() : mkFalse(); break;
      }

      if (result) {
        vm.stack.pop();
        vm.stack.pop();
        vm.stack.push(result);
        emit("opt_insn",
          `${op}: ${av} ${opSymbol(op)} ${bv} → ${rubyToS(result)}`,
          `Fixnum 最適化: メソッド呼び出しをバイパス。型チェック → 即値演算。send より約5倍高速。`);
        return true;
      }
    }

    // String の + は専用パス
    if (op === "opt_plus" && a.type === "string" && b.type === "string") {
      vm.stack.pop();
      vm.stack.pop();
      const result = allocObject("string", "String", (a.value as string) + (b.value as string));
      vm.stack.push(result);
      emit("opt_insn",
        `${op}: "${a.value}" + "${b.value}" → "${result.value}"`,
        `String 連結最適化: 新しい String オブジェクトを割り当て`);
      return true;
    }

    // opt_ltlt (<<)
    if (op === "opt_ltlt" && a.type === "array") {
      vm.stack.pop();
      vm.stack.pop();
      (a.value as RubyValue[]).push(b);
      vm.stack.push(a);
      emit("opt_insn", `${op}: Array#<< ${rubyToS(b)}`, "Array#<< スペシャル命令");
      return true;
    }

    // opt_aref ([])
    if (op === "opt_aref" && a.type === "array" && b.type === "fixnum") {
      vm.stack.pop();
      vm.stack.pop();
      const arr = a.value as RubyValue[];
      const idx = b.value as number;
      vm.stack.push(arr[idx] ?? mkNil());
      emit("opt_insn", `${op}: Array#[] idx=${idx} → ${rubyToS(vm.stack[vm.stack.length - 1]!)}`, "Array#[] スペシャル命令");
      return true;
    }

    // opt_eq for strings
    if (op === "opt_eq" && a.type === "string" && b.type === "string") {
      vm.stack.pop();
      vm.stack.pop();
      vm.stack.push((a.value as string) === (b.value as string) ? mkTrue() : mkFalse());
      emit("opt_insn", `${op}: "${a.value}" == "${b.value}" → ${rubyToS(vm.stack[vm.stack.length - 1]!)}`, "String#== スペシャル命令");
      return true;
    }

    // 型が合わない → 通常の send にフォールバック
    return false;
  }

  function opSymbol(op: string): string {
    const m: Record<string, string> = {
      opt_plus: "+", opt_minus: "-", opt_mult: "*", opt_div: "/", opt_mod: "%",
      opt_eq: "==", opt_lt: "<", opt_le: "<=", opt_gt: ">", opt_ge: ">=",
    };
    return m[op] ?? op;
  }

  /** 組み込みメソッドの実行 */
  function execBuiltin(receiver: RubyValue, mid: string, args: RubyValue[]): RubyValue | undefined {
    // puts
    if (mid === "puts") {
      for (const a of args) {
        const s = rubyToS(a);
        vm.output.push(s);
        emit("output", `puts "${s}"`, undefined);
      }
      if (args.length === 0) {
        vm.output.push("");
        emit("output", "puts (改行のみ)", undefined);
      }
      return mkNil();
    }
    // p
    if (mid === "p") {
      for (const a of args) {
        const s = a.type === "string" ? `"${a.value}"` : rubyToS(a);
        vm.output.push(s);
        emit("output", `p ${s}`, undefined);
      }
      return args.length === 1 ? args[0]! : mkNil();
    }
    // to_s
    if (mid === "to_s") {
      return allocObject("string", "String", rubyToS(receiver));
    }
    // to_i
    if (mid === "to_i" && receiver.type === "string") {
      return mkFixnum(parseInt(receiver.value as string, 10) || 0, vm.objectIdCounter++);
    }
    // Integer#times
    if (mid === "times" && receiver.type === "fixnum") {
      return receiver; // ブロック呼び出しは別途処理
    }
    // Array#push
    if (mid === "push" && receiver.type === "array") {
      (receiver.value as RubyValue[]).push(...args);
      return receiver;
    }
    // Array#each, map
    if ((mid === "each" || mid === "map") && receiver.type === "array") {
      return receiver; // ブロック呼び出しは別途処理
    }
    // String#length
    if (mid === "length" && receiver.type === "string") {
      return mkFixnum((receiver.value as string).length, vm.objectIdCounter++);
    }
    // class
    if (mid === "class") {
      return allocObject("string", "String", receiver.klass);
    }
    // nil?
    if (mid === "nil?") {
      return receiver.type === "nil" ? mkTrue() : mkFalse();
    }
    // freeze
    if (mid === "freeze") {
      receiver.frozen = true;
      receiver.flags.push("FROZEN");
      return receiver;
    }
    return undefined;
  }

  /** ISeq 実行 */
  function executeISeq(iseqLabel: string, maxSteps: number): void {
    const iseq = vm.iseqs.get(iseqLabel);
    if (!iseq) {
      emit("error", `ISeq "${iseqLabel}" が見つかりません`);
      return;
    }

    const topSelf = allocObject("object", "Object", null);
    pushFrame("TOP", iseqLabel, topSelf);

    // ローカル変数スロットを確保
    for (const local of iseq.localTable) {
      vm.stack.push(mkNil());
      emit("local_access",
        `ローカル変数スロット確保: ${local.name} (idx=${local.index}, kind=${local.kind})`,
        `EP[${local.index}] = nil`);
    }

    let executed = 0;
    while (executed < maxSteps) {
      const cfp = vm.cfpStack[vm.cfpStack.length - 1];
      if (!cfp) break;

      const currentIseq = vm.iseqs.get(cfp.iseqLabel);
      if (!currentIseq || cfp.pc >= currentIseq.insns.length) {
        // leave がなくてもフレーム終了
        popFrame();
        continue;
      }

      const insn = currentIseq.insns[cfp.pc]!;
      cfp.pc++;
      executed++;
      step++;
      stats.totalInsns++;

      switch (insn.op) {
        case "nop":
          emit("insn", `nop`, `何もしない (アラインメント用)`);
          break;

        case "putnil":
          vm.stack.push(mkNil());
          emit("insn", `putnil → stack`, `nil をスタックにプッシュ`);
          break;

        case "putself":
          vm.stack.push(cfp.self);
          emit("insn", `putself → stack (${rubyToS(cfp.self)})`, `カレント self をスタックにプッシュ`);
          break;

        case "putobject": {
          const val = insn.operands[0];
          let obj: RubyValue;
          if (typeof val === "number") {
            obj = mkFixnum(val, vm.objectIdCounter++);
          } else if (val === true) {
            obj = mkTrue();
          } else if (val === false) {
            obj = mkFalse();
          } else if (typeof val === "string" && val.startsWith(":")) {
            obj = mkSymbol(val.slice(1), vm.objectIdCounter++);
          } else {
            obj = mkNil();
          }
          vm.stack.push(obj);
          emit("insn", `putobject ${rubyToS(obj)} → stack`, `即値をスタックにプッシュ (タグ付き: Fixnum は奇数アドレス, true/false/nil は特殊値)`);
          break;
        }

        case "putstring": {
          const s = insn.operands[0] as string;
          const obj = allocObject("string", "String", s);
          vm.stack.push(obj);
          emit("insn", `putstring "${s}" → stack`, `新しい String オブジェクトを割り当て (putobject と違い毎回新規)。frozen_string_literal: true の場合は putobject になる`);
          break;
        }

        case "dup": {
          const top = vm.stack[vm.stack.length - 1];
          if (top) vm.stack.push(top);
          emit("stack", `dup: ${top ? rubyToS(top) : "(empty)"}`, `スタックトップを複製`);
          break;
        }

        case "pop":
          vm.stack.pop();
          emit("stack", `pop`, `スタックトップを破棄 (式文の戻り値を捨てる)`);
          break;

        case "swap": {
          const len = vm.stack.length;
          if (len >= 2) {
            [vm.stack[len - 1], vm.stack[len - 2]] = [vm.stack[len - 2]!, vm.stack[len - 1]!];
          }
          emit("stack", `swap`, `スタックの上位2要素を交換`);
          break;
        }

        case "newarray": {
          const count = insn.operands[0] as number;
          const elems = vm.stack.splice(vm.stack.length - count, count);
          const arr = allocObject("array", "Array", elems);
          vm.stack.push(arr);
          emit("insn", `newarray ${count} → [${elems.map(rubyToS).join(", ")}]`, `スタックから ${count} 要素を取り出し Array を生成`);
          break;
        }

        case "newhash": {
          const count = insn.operands[0] as number;
          const pairs = vm.stack.splice(vm.stack.length - count, count);
          const hash: Record<string, RubyValue> = {};
          for (let i = 0; i < pairs.length; i += 2) {
            hash[rubyToS(pairs[i]!)] = pairs[i + 1] ?? mkNil();
          }
          const obj = allocObject("hash", "Hash", hash);
          vm.stack.push(obj);
          emit("insn", `newhash ${count / 2} pairs`, `スタックから key-value ペアを取り出し Hash を生成`);
          break;
        }

        case "concatstrings": {
          const count = insn.operands[0] as number;
          const parts = vm.stack.splice(vm.stack.length - count, count);
          const s = parts.map(rubyToS).join("");
          const obj = allocObject("string", "String", s);
          vm.stack.push(obj);
          emit("insn", `concatstrings ${count} → "${s}"`, `文字列補間: #{} の展開結果を連結`);
          break;
        }

        case "tostring": {
          const top = vm.stack.pop();
          if (top && top.type !== "string") {
            const s = allocObject("string", "String", rubyToS(top));
            vm.stack.push(s);
          } else if (top) {
            vm.stack.push(top);
          }
          emit("insn", `tostring`, `to_s 呼び出し (文字列補間用)`);
          break;
        }

        case "getlocal":
        case "getlocal_wc_0":
        case "getlocal_wc_1": {
          const idx = insn.operands[0] as number;
          const level = insn.op === "getlocal_wc_1" ? 1 : insn.op === "getlocal_wc_0" ? 0 : (insn.operands[1] as number ?? 0);

          // EP チェーン辿り
          let targetEp = cfp.ep;
          let targetFrame = cfp;
          for (let i = 0; i < level; i++) {
            const parentIdx = vm.cfpStack.length - 2 - i;
            if (parentIdx >= 0) {
              targetFrame = vm.cfpStack[parentIdx]!;
              targetEp = targetFrame.ep;
            }
          }

          const stackIdx = targetEp + idx;
          const val = vm.stack[stackIdx] ?? mkNil();
          vm.stack.push(val);

          const localName = currentIseq.localTable.find((l) => l.index === idx)?.name ?? `?${idx}`;
          emit("local_access",
            `${insn.op} ${localName} (idx=${idx}, level=${level}) → ${rubyToS(val)}`,
            `EP[${level}][${idx}] = ${rubyToS(val)}。level=${level} は${level === 0 ? "現在のスコープ" : `${level}段上の外側スコープ (クロージャ)`}`);
          break;
        }

        case "setlocal":
        case "setlocal_wc_0":
        case "setlocal_wc_1": {
          const idx = insn.operands[0] as number;
          const level = insn.op === "setlocal_wc_1" ? 1 : insn.op === "setlocal_wc_0" ? 0 : (insn.operands[1] as number ?? 0);
          const val = vm.stack.pop() ?? mkNil();

          let targetEp = cfp.ep;
          for (let i = 0; i < level; i++) {
            const parentIdx = vm.cfpStack.length - 2 - i;
            if (parentIdx >= 0) {
              targetEp = vm.cfpStack[parentIdx]!.ep;
            }
          }

          const stackIdx = targetEp + idx;
          if (stackIdx < vm.stack.length) {
            vm.stack[stackIdx] = val;
          }

          const localName = currentIseq.localTable.find((l) => l.index === idx)?.name ?? `?${idx}`;
          emit("local_access",
            `${insn.op} ${localName} = ${rubyToS(val)} (idx=${idx}, level=${level})`,
            `EP[${level}][${idx}] ← ${rubyToS(val)}`);
          break;
        }

        case "getinstancevariable": {
          const name = insn.operands[0] as string;
          const val = cfp.self.ivars[name] ?? mkNil();
          vm.stack.push(val);
          emit("ivar_access",
            `getinstancevariable ${name} → ${rubyToS(val)}`,
            `self.${name} — インスタンス変数テーブルから取得。Shape Tree 最適化でインデックスアクセスに変換可能。`);
          break;
        }

        case "setinstancevariable": {
          const name = insn.operands[0] as string;
          const val = vm.stack.pop() ?? mkNil();
          cfp.self.ivars[name] = val;
          emit("ivar_access",
            `setinstancevariable ${name} = ${rubyToS(val)}`,
            `self.${name} ← ${rubyToS(val)}`);
          break;
        }

        case "getconstant": {
          const name = insn.operands[0] as string;
          const val = vm.constants.get(name) ?? mkNil();
          vm.stack.push(val);
          emit("insn", `getconstant ${name} → ${rubyToS(val)}`, `定数テーブルから取得。cref チェーンを辿って探索。`);
          break;
        }

        case "setconstant": {
          const name = insn.operands[0] as string;
          const val = vm.stack.pop() ?? mkNil();
          vm.constants.set(name, val);
          emit("insn", `setconstant ${name} = ${rubyToS(val)}`, `定数テーブルに設定。再代入は warning。`);
          break;
        }

        // スペシャル命令
        case "opt_plus": case "opt_minus": case "opt_mult": case "opt_div": case "opt_mod":
        case "opt_eq": case "opt_neq": case "opt_lt": case "opt_le": case "opt_gt": case "opt_ge":
        case "opt_ltlt": case "opt_aref": case "opt_aset":
        case "opt_length": case "opt_size": case "opt_empty_p":
        case "opt_not": case "opt_nil_p": {
          const ci = insn.operands[0] as CallInfo | undefined;
          const handled = execOptInsn(insn.op, ci ?? { mid: insn.op, argc: 1, flags: [] });
          if (!handled) {
            emit("insn", `${insn.op}: 型が合わない → 通常 send にフォールバック`, `スペシャル命令は Fixnum/String 等の組み込み型のみ最適化。ユーザ定義の再定義があると無効化。`);
          }
          break;
        }

        case "send":
        case "opt_send_without_block": {
          const ci = insn.operands[0] as CallInfo;
          stats.methodCalls++;

          // 引数をスタックから取り出し
          const args = vm.stack.splice(vm.stack.length - ci.argc, ci.argc);
          const receiver = vm.stack.pop() ?? cfp.self;

          // インラインキャッシュ経由でメソッド探索
          const entry = dispatchMethod(receiver, ci);

          if (!entry) {
            // 組み込みメソッド試行
            const result = execBuiltin(receiver, ci.mid, args);
            if (result !== undefined) {
              vm.stack.push(result);
              emit("method_dispatch",
                `${rubyToS(receiver)}.${ci.mid}(${args.map(rubyToS).join(", ")}) → ${rubyToS(result)}`,
                `C関数 (cfunc) ディスパッチ — VM フレームを積まずに直接実行`);
            } else {
              vm.stack.push(mkNil());
              emit("error",
                `NoMethodError: undefined method '${ci.mid}' for ${rubyToS(receiver)}:${receiver.klass}`,
                `メソッド探索: ${vm.classes.get(receiver.klass)?.ancestors.join(" → ") ?? "?"} — 見つからず method_missing を呼び出し (未定義なら NoMethodError)`);
            }
          } else if (entry.type === "cfunc") {
            const result = execBuiltin(receiver, ci.mid, args);
            vm.stack.push(result ?? mkNil());
            emit("method_dispatch",
              `C関数呼び出し: ${entry.owner}#${ci.mid}`,
              `CFUNC フレーム — Ruby フレームより軽量。バックトレースには表示される。`);
          } else if (entry.type === "iseq" && entry.iseqLabel) {
            // Ruby メソッド呼び出し → 新しいフレーム
            const methodIseq = vm.iseqs.get(entry.iseqLabel);
            if (methodIseq) {
              pushFrame("METHOD", entry.iseqLabel, receiver, ci.mid);
              // 引数をローカル変数として設定
              for (let i = 0; i < methodIseq.localTable.length; i++) {
                vm.stack.push(i < args.length ? args[i]! : mkNil());
              }
              emit("method_dispatch",
                `メソッド呼び出し: ${entry.owner}#${ci.mid}(${args.map(rubyToS).join(", ")})`,
                `METHOD フレーム生成 → ISeq "${entry.iseqLabel}" を実行。引数は EP[0..${args.length - 1}] に配置。`);
            }
          }
          break;
        }

        case "invokeblock": {
          const ci = insn.operands[0] as CallInfo | undefined;
          stats.blockCalls++;
          const argc = ci?.argc ?? 0;
          const args = vm.stack.splice(vm.stack.length - argc, argc);

          // ブロック ISeq を探す
          const blockLabel = cfp.blockHandler;
          if (blockLabel) {
            const blockIseq = vm.iseqs.get(blockLabel);
            if (blockIseq) {
              pushFrame("BLOCK", blockLabel, cfp.self);
              for (let i = 0; i < blockIseq.localTable.length; i++) {
                vm.stack.push(i < args.length ? args[i]! : mkNil());
              }
              emit("block",
                `invokeblock: yield → "${blockLabel}"`,
                `BLOCK フレーム生成。ブロック引数: ${args.map(rubyToS).join(", ")}。EP は定義時のスコープを指す (クロージャ)。`);
            }
          } else {
            vm.stack.push(mkNil());
            emit("error", `LocalJumpError: no block given (yield)`, `yield はブロックなしで呼ぶと LocalJumpError`);
          }
          break;
        }

        case "leave": {
          const retval = vm.stack.pop() ?? mkNil();
          popFrame();
          vm.stack.push(retval);
          emit("insn",
            `leave → ${rubyToS(retval)}`,
            `フレーム終了。戻り値をスタックにプッシュ。SP を呼び出し元に復帰。`);
          break;
        }

        case "jump": {
          const target = insn.operands[0] as number;
          cfp.pc = target;
          emit("insn", `jump → pc=${target}`, `無条件ジャンプ`);
          break;
        }

        case "branchif": {
          const target = insn.operands[0] as number;
          const cond = vm.stack.pop() ?? mkNil();
          if (isTruthy(cond)) {
            cfp.pc = target;
            emit("insn", `branchif: ${rubyToS(cond)} → truthy → jump pc=${target}`, `Ruby の truthy: nil と false 以外はすべて真`);
          } else {
            emit("insn", `branchif: ${rubyToS(cond)} → falsy → fall through`, undefined);
          }
          break;
        }

        case "branchunless": {
          const target = insn.operands[0] as number;
          const cond = vm.stack.pop() ?? mkNil();
          if (!isTruthy(cond)) {
            cfp.pc = target;
            emit("insn", `branchunless: ${rubyToS(cond)} → falsy → jump pc=${target}`, undefined);
          } else {
            emit("insn", `branchunless: ${rubyToS(cond)} → truthy → fall through`, undefined);
          }
          break;
        }

        case "branchnil": {
          const target = insn.operands[0] as number;
          const cond = vm.stack.pop() ?? mkNil();
          if (cond.type === "nil") {
            cfp.pc = target;
            emit("insn", `branchnil: nil → jump pc=${target}`, `nil のみジャンプ (false はフォールスルー)`);
          } else {
            emit("insn", `branchnil: ${rubyToS(cond)} → fall through`, undefined);
          }
          break;
        }

        case "definemethod": {
          const methodName = insn.operands[0] as string;
          const iseqLabel = insn.operands[1] as string;
          const klass = cfp.klass ?? "Object";
          const entry: MethodEntry = {
            owner: klass, name: methodName, type: "iseq",
            iseqLabel, visibility: "public",
          };
          let methods = vm.methods.get(klass);
          if (!methods) {
            methods = new Map();
            vm.methods.set(klass, methods);
          }
          methods.set(methodName, entry);

          // クラスシリアルを更新 (インラインキャッシュ無効化)
          const classInfo = vm.classes.get(klass);
          if (classInfo) {
            classInfo.serial = vm.classSerialCounter++;
            emit("define",
              `definemethod: ${klass}#${methodName} → ISeq "${iseqLabel}"`,
              `クラスシリアル更新: ${classInfo.serial} (インラインキャッシュ無効化)`);
          } else {
            emit("define", `definemethod: ${klass}#${methodName} → ISeq "${iseqLabel}"`, undefined);
          }
          break;
        }

        case "defineclass": {
          const className = insn.operands[0] as string;
          const iseqLabel = insn.operands[1] as string;
          const superclass = (insn.operands[2] as string) ?? "Object";

          if (!vm.classes.has(className)) {
            const serial = vm.classSerialCounter++;
            const superInfo = vm.classes.get(superclass);
            const ancestors = [className, ...(superInfo?.ancestors ?? ["Object", "BasicObject"])];
            vm.classes.set(className, { name: className, superclass, modules: [], serial, ancestors });
            vm.methods.set(className, new Map());
          }

          // クラス本体の ISeq を実行
          const classIseq = vm.iseqs.get(iseqLabel);
          if (classIseq) {
            const classSelf = allocObject("class", className, className);
            pushFrame("CLASS", iseqLabel, classSelf, undefined);
            const newCfp = vm.cfpStack[vm.cfpStack.length - 1]!;
            newCfp.klass = className;
            emit("define",
              `defineclass: ${className} < ${superclass}`,
              `CLASS フレーム生成 → ISeq "${iseqLabel}" を実行。cref = ${className}。`);
          }
          break;
        }

        case "putiseq": {
          const label = insn.operands[0] as string;
          vm.stack.push(allocObject("proc", "Proc", label));
          emit("block", `putiseq "${label}" → stack`, `ブロック ISeq をスタックにプッシュ (Proc オブジェクトとして)`);
          break;
        }

        case "throw": {
          const throwType = insn.operands[0] as number;
          const val = vm.stack.pop() ?? mkNil();
          const typeNames = ["none", "break", "next", "return", "retry", "redo"];
          const typeName = typeNames[throwType] ?? `unknown(${throwType})`;

          // catch table を探索
          let caught = false;
          for (let fi = vm.cfpStack.length - 1; fi >= 0; fi--) {
            const frame = vm.cfpStack[fi]!;
            const frameIseq = vm.iseqs.get(frame.iseqLabel);
            if (!frameIseq) continue;
            for (const entry of frameIseq.catchTable) {
              if (entry.type === typeName && frame.pc >= entry.start && frame.pc <= entry.end) {
                // catch table エントリにマッチ
                frame.pc = entry.cont;
                // マッチしたフレームまで巻き戻し
                while (vm.cfpStack.length > fi + 1) popFrame();
                vm.stack.push(val);
                caught = true;
                emit("catch",
                  `catch table ヒット: ${typeName} → pc=${entry.cont}`,
                  `フレーム "${frame.iseqLabel}" の catch table [${entry.start}..${entry.end}] にマッチ`);
                break;
              }
            }
            if (caught) break;
          }

          if (!caught) {
            emit("throw",
              `throw ${typeName}: ${rubyToS(val)}`,
              `catch table にマッチするエントリなし — フレームを巻き戻し`);
          }
          break;
        }

        case "trace": {
          const traceType = insn.operands[0] as string;
          emit("trace",
            `trace: ${traceType} (line ${insn.lineno})`,
            `TracePoint イベント発火: ${traceType}。set_trace_func / TracePoint で捕捉可能。`);
          break;
        }

        case "fiber_resume": {
          const fiberId = insn.operands[0] as number;
          const fiber = vm.fibers.find((f) => f.id === fiberId);
          if (fiber && fiber.status !== "dead") {
            fiber.status = "running";
            vm.currentFiberId = fiberId;
            emit("fiber",
              `Fiber#resume: fiber[${fiberId}]`,
              `コンテキスト切り替え: メイン → fiber[${fiberId}]。スタックとCFPを交換。`);
          } else {
            emit("error", `FiberError: dead fiber called`, `終了済み Fiber は resume 不可`);
          }
          break;
        }

        case "fiber_yield": {
          const val = vm.stack.pop() ?? mkNil();
          const fiber = vm.fibers.find((f) => f.id === vm.currentFiberId);
          if (fiber) {
            fiber.status = "suspended";
            fiber.transferValue = val;
            vm.currentFiberId = 0;
            vm.stack.push(val);
            emit("fiber",
              `Fiber.yield(${rubyToS(val)})`,
              `コンテキスト切り替え: fiber → メイン。yield 値 = ${rubyToS(val)}`);
          }
          break;
        }

        default:
          emit("insn", `${insn.op} (未実装)`, `operands: ${JSON.stringify(insn.operands)}`);
      }
    }

    if (executed >= maxSteps) {
      emit("info", `最大ステップ数 (${maxSteps}) に到達 — 実行中断`);
    }
  }

  /** GC 実行 (mark & sweep) */
  function runGC(reason: string): void {
    stats.gcRuns++;
    vm.gc.gcCount++;
    vm.gc.lastGcReason = reason;

    emit("gc_mark", `GC 開始: ${reason}`, `マーク & スイープ GC (世代別GCは省略)`);

    // マークフェーズ
    vm.gc.phase = "marking";
    const marked = new Set<number>();

    // ルートからマーク: スタック上の値
    for (const val of vm.stack) {
      if (val.objectId > 4) {
        marked.add(val.objectId);
      }
    }

    // ルートからマーク: CFP の self
    for (const cfp of vm.cfpStack) {
      if (cfp.self.objectId > 4) {
        marked.add(cfp.self.objectId);
      }
    }

    // ルートからマーク: グローバル変数/定数
    for (const val of vm.constants.values()) {
      if (val.objectId > 4) marked.add(val.objectId);
    }
    for (const val of vm.globals.values()) {
      if (val.objectId > 4) marked.add(val.objectId);
    }

    // ヒープページのマーク
    for (const page of vm.gc.heapPages) {
      for (const slot of page.slots) {
        slot.marked = slot.objectId !== null && marked.has(slot.objectId);
      }
    }

    emit("gc_mark",
      `マーク完了: ${marked.size} オブジェクトが到達可能`,
      `ルート: スタック=${vm.stack.length}, CFP=${vm.cfpStack.length}, 定数=${vm.constants.size}`);

    // スイープフェーズ
    vm.gc.phase = "sweeping";
    let freed = 0;
    for (const page of vm.gc.heapPages) {
      for (const slot of page.slots) {
        if (slot.objectId !== null && !slot.marked) {
          slot.objectId = null;
          page.freeCount++;
          freed++;
          stats.objectsFreed++;
          vm.gc.totalFreed++;
        }
        slot.marked = false;
      }
    }

    vm.gc.phase = "none";
    emit("gc_sweep",
      `スイープ完了: ${freed} オブジェクトを解放`,
      `ヒープ空き: ${vm.gc.heapPages.reduce((s, p) => s + p.freeCount, 0)} スロット, 割り当て済: ${vm.gc.totalAllocated}, 解放済: ${vm.gc.totalFreed}`);
  }

  // メインループ
  for (const op of ops) {
    step++;
    switch (op.type) {
      case "define_iseq":
        vm.iseqs.set(op.iseq.label, op.iseq);
        emit("define",
          `ISeq 定義: "${op.iseq.label}" (${op.iseq.type})`,
          `命令数=${op.iseq.insns.length}, ローカル変数=${op.iseq.localTable.map((l) => l.name).join(", ") || "(なし)"}, catch table=${op.iseq.catchTable.length}エントリ`);
        break;

      case "define_class": {
        if (!vm.classes.has(op.name)) {
          const serial = vm.classSerialCounter++;
          const superclass = op.superclass ?? "Object";
          const superInfo = vm.classes.get(superclass);
          const ancestors = [op.name, ...(op.modules ?? []), ...(superInfo?.ancestors ?? ["Object", "BasicObject"])];
          vm.classes.set(op.name, { name: op.name, superclass, modules: op.modules ?? [], serial, ancestors });
          vm.methods.set(op.name, new Map());
          emit("define",
            `クラス定義: ${op.name} < ${superclass}`,
            `祖先チェーン: ${ancestors.join(" → ")}`);
        }
        break;
      }

      case "define_method": {
        let methods = vm.methods.get(op.klass);
        if (!methods) {
          methods = new Map();
          vm.methods.set(op.klass, methods);
        }
        methods.set(op.entry.name, op.entry);
        emit("define",
          `メソッド定義: ${op.klass}#${op.entry.name} (${op.entry.type})`,
          `visibility=${op.entry.visibility}${op.entry.iseqLabel ? `, ISeq="${op.entry.iseqLabel}"` : ""}`);
        break;
      }

      case "execute":
        executeISeq(op.iseqLabel, op.maxSteps ?? 500);
        break;

      case "gc_trigger":
        runGC(op.reason);
        break;

      case "fiber_create": {
        const fib: FiberState = {
          id: vm.fibers.length + 1,
          status: "created",
          stack: [],
          cfp: [],
        };
        vm.fibers.push(fib);
        emit("fiber",
          `Fiber.new → fiber[${fib.id}]`,
          `ISeq "${op.iseqLabel}" を実行する Fiber を作成。状態: created`);
        break;
      }

      case "check_cache": {
        const cacheKey = `${op.receiver}#${op.mid}`;
        const cache = inlineCaches.get(cacheKey);
        if (cache) {
          emit("info",
            `キャッシュ状態: ${cacheKey} — hit=${cache.hitCount}, miss=${cache.missCount}`,
            `serial=${cache.classSerial}, メソッド=${cache.methodEntry?.owner}#${cache.methodEntry?.name ?? "?"}`);
        } else {
          emit("info", `キャッシュなし: ${cacheKey}`, undefined);
        }
        break;
      }

      case "snapshot": {
        const alive = vm.gc.heapPages.reduce((s, p) => s + (p.slots.length - p.freeCount), 0);
        emit("info",
          `スナップショット: stack=${vm.stack.length}, cfp=${vm.cfpStack.length}, heap=${alive}obj`,
          `ISeq: ${vm.iseqs.size}, クラス: ${vm.classes.size}, メソッド: ${Array.from(vm.methods.values()).reduce((s, m) => s + m.size, 0)}`);
        break;
      }
    }
  }

  return { events, vm, stats };
}
