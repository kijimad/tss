/* ===== WebAssembly 仮想マシン エンジン ===== */

import {
  type ValType,
  type WasmValue,
  type FuncType,
  type WasmModule,
  type FuncBody,
  type Instruction,
  type CallFrame,
  type BlockFrame,
  type HostFunc,
  type Global,
  type StepSnapshot,
  type WasmSimResult,
  type WasmEvent,
  Opcode,
  PAGE_SIZE,
} from './types';

/* ---------- ヘルパー ---------- */

/** i32を32bit符号付き整数に正規化 */
function toI32(v: number): number {
  return v | 0;
}

/** i32を32bit符号なし整数に正規化 */
function toU32(v: number): number {
  return v >>> 0;
}

/** WasmValue から数値を取り出す */
function valToNum(v: WasmValue): number {
  if (v.type === 'i64') return Number(v.value);
  return v.value;
}

/** デフォルト値を生成 */
function defaultValue(t: ValType): WasmValue {
  switch (t) {
    case 'i32': return { type: 'i32', value: 0 };
    case 'i64': return { type: 'i64', value: 0n };
    case 'f32': return { type: 'f32', value: 0.0 };
    case 'f64': return { type: 'f64', value: 0.0 };
  }
}

/** 命令をテキスト表現に変換 */
function instrToString(instr: Instruction): string {
  const name = Opcode[instr.opcode] ?? `0x${instr.opcode.toString(16)}`;
  if (instr.immediate !== undefined) return `${name} ${instr.immediate}`;
  if (instr.blockType !== undefined) return `${name} (${instr.blockType})`;
  return name;
}

/* ---------- VMクラス ---------- */

/** WASM仮想マシン */
export class WasmVM {
  /** オペランドスタック */
  private stack: WasmValue[] = [];
  /** コールスタック */
  private callStack: CallFrame[] = [];
  /** 線形メモリ */
  private memory: Uint8Array = new Uint8Array(0);
  /** メモリページ数 */
  private memoryPages = 0;
  /** グローバル変数 */
  private globals: Global[] = [];
  /** テーブル（funcref） */
  private table: (number | null)[] = [];
  /** ホスト関数 */
  private hostFuncs: HostFunc[] = [];
  /** モジュール */
  private module: WasmModule | null = null;
  /** インポート関数の数（関数インデックスのオフセット） */
  private importFuncCount = 0;

  /** シミュレーション用 */
  private steps: StepSnapshot[] = [];
  private events: WasmEvent[] = [];
  private stepCounter = 0;
  private maxStackDepth = 0;
  private maxCallDepth = 0;
  private memoryPeakPages = 0;
  private hostCallCount = 0;
  private branchCount = 0;
  private trapCount = 0;
  private totalInstructions = 0;
  /** 最大実行ステップ数（無限ループ防止） */
  private maxSteps = 10000;

  /** VMを初期化してモジュールをロード */
  loadModule(mod: WasmModule, hostFuncs: HostFunc[] = []): void {
    this.module = mod;
    this.hostFuncs = hostFuncs;
    this.stack = [];
    this.callStack = [];
    this.globals = [];
    this.table = [];
    this.steps = [];
    this.events = [];
    this.stepCounter = 0;
    this.maxStackDepth = 0;
    this.maxCallDepth = 0;
    this.memoryPeakPages = 0;
    this.hostCallCount = 0;
    this.branchCount = 0;
    this.trapCount = 0;
    this.totalInstructions = 0;

    /* インポート関数数をカウント */
    this.importFuncCount = mod.imports.filter(i => i.kind === 'func').length;

    this.emit('decode', 'info', `モジュールをデコード: ${mod.types.length}型, ${mod.functions.length}関数, ${mod.exports.length}エクスポート`);
    this.recordStep('module_load');
  }

  /** モジュールをインスタンス化 */
  instantiate(): void {
    const mod = this.module!;

    /* メモリ初期化 */
    if (mod.memories.length > 0) {
      const mem = mod.memories[0]!;
      this.memoryPages = mem.limits.min;
      this.memory = new Uint8Array(this.memoryPages * PAGE_SIZE);
      this.memoryPeakPages = this.memoryPages;
      this.emit('instantiate', 'info', `線形メモリ初期化: ${this.memoryPages}ページ (${this.memoryPages * 64}KB)`);
    }

    /* グローバル変数初期化 */
    for (const g of mod.globals) {
      this.globals.push({ type: { ...g.type }, value: { ...g.value } });
    }
    if (this.globals.length > 0) {
      this.emit('instantiate', 'info', `グローバル変数初期化: ${this.globals.length}個`);
    }

    /* テーブル初期化 */
    if (mod.tables.length > 0) {
      const t = mod.tables[0]!;
      this.table = new Array(t.limits.min).fill(null);
      this.emit('instantiate', 'info', `テーブル初期化: ${t.limits.min}エントリ`);
    }

    /* エレメントセグメント適用 */
    for (const elem of mod.elements) {
      for (let i = 0; i < elem.funcIndices.length; i++) {
        const idx = elem.offset + i;
        if (idx < this.table.length) {
          this.table[idx] = elem.funcIndices[i]!;
        }
      }
    }

    /* データセグメント適用 */
    for (const seg of mod.data) {
      for (let i = 0; i < seg.data.length; i++) {
        const addr = seg.offset + i;
        if (addr < this.memory.length) {
          this.memory[addr] = seg.data[i]!;
        }
      }
      this.emit('instantiate', 'detail', `データセグメント: offset=${seg.offset}, ${seg.data.length}バイト`);
    }

    this.emit('validate', 'info', 'モジュールのバリデーション成功');
    this.recordStep('instantiate');
  }

  /** エクスポート関数を呼び出して実行 */
  callExport(name: string, args: WasmValue[] = []): WasmSimResult {
    const mod = this.module!;
    const exp = mod.exports.find(e => e.name === name && e.kind === 'func');
    if (!exp) {
      this.emit('trap', 'error', `エクスポート関数 "${name}" が見つかりません`);
      this.trapCount++;
      return this.buildResult(null);
    }

    this.emit('call', 'info', `エクスポート関数 "${name}" を呼び出し (index=${exp.index})`);
    this.recordStep(`call_export: ${name}`);

    /* 引数をスタックにプッシュ */
    for (const arg of args) {
      this.push(arg);
    }

    const result = this.callFunc(exp.index);
    return this.buildResult(result);
  }

  /** 関数を呼び出す */
  private callFunc(funcIndex: number): WasmValue[] | null {
    const mod = this.module!;

    /* ホスト関数の場合 */
    if (funcIndex < this.importFuncCount) {
      const hostFunc = this.hostFuncs[funcIndex];
      if (!hostFunc) {
        this.emit('trap', 'error', `ホスト関数 index=${funcIndex} が未定義`);
        this.trapCount++;
        return null;
      }
      const importEntry = mod.imports.filter(i => i.kind === 'func')[funcIndex];
      const typeIdx = importEntry?.typeIndex ?? 0;
      const funcType = mod.types[typeIdx]!;
      const args: WasmValue[] = [];
      for (let i = funcType.params.length - 1; i >= 0; i--) {
        args.unshift(this.pop());
      }
      this.emit('host_call', 'info', `ホスト関数呼び出し: ${hostFunc.module}.${hostFunc.name}(${args.map(a => a.value).join(', ')})`);
      this.hostCallCount++;
      const results = hostFunc.invoke(args);
      for (const r of results) {
        this.push(r);
      }
      this.recordStep(`host_call: ${hostFunc.module}.${hostFunc.name}`);
      return results;
    }

    /* モジュール内関数 */
    const localFuncIndex = funcIndex - this.importFuncCount;
    const typeIndex = mod.functions[localFuncIndex];
    if (typeIndex === undefined) {
      this.emit('trap', 'error', `関数 index=${funcIndex} が未定義`);
      this.trapCount++;
      return null;
    }
    const funcType = mod.types[typeIndex]!;
    const body = mod.codes[localFuncIndex]!;

    /* 引数をスタックから取得しローカル変数に設定 */
    const locals: WasmValue[] = [];
    const args: WasmValue[] = [];
    for (let i = funcType.params.length - 1; i >= 0; i--) {
      args.unshift(this.pop());
    }
    for (let i = 0; i < funcType.params.length; i++) {
      locals.push(args[i]!);
    }
    /* ローカル変数のデフォルト値を追加 */
    for (const localType of body.locals) {
      locals.push(defaultValue(localType));
    }

    /* コールフレームを作成 */
    const frame: CallFrame = {
      funcIndex,
      locals,
      returnPc: 0,
      returnStackDepth: this.stack.length,
      blockStack: [],
      pc: 0,
    };
    this.callStack.push(frame);
    if (this.callStack.length > this.maxCallDepth) {
      this.maxCallDepth = this.callStack.length;
    }

    this.emit('call', 'detail', `関数${funcIndex}に入る: params=${funcType.params.length}, locals=${body.locals.length}`);

    /* 命令を実行 */
    const result = this.executeBody(body, frame, funcType);

    /* コールフレームを除去 */
    this.callStack.pop();

    return result;
  }

  /** 関数本体を実行 */
  private executeBody(body: FuncBody, frame: CallFrame, funcType: FuncType): WasmValue[] | null {
    const instrs = body.instructions;

    while (frame.pc < instrs.length) {
      if (this.totalInstructions >= this.maxSteps) {
        this.emit('trap', 'warn', `最大実行ステップ数(${this.maxSteps})に到達`);
        break;
      }

      const instr = instrs[frame.pc]!;
      this.totalInstructions++;
      const result = this.executeInstr(instr, frame, instrs);

      if (result === 'return') {
        /* 関数から復帰 */
        const results: WasmValue[] = [];
        for (let i = 0; i < funcType.results.length; i++) {
          results.unshift(this.pop());
        }
        /* スタックを呼び出し時に戻す */
        this.stack.length = frame.returnStackDepth;
        for (const r of results) {
          this.push(r);
        }
        this.emit('return', 'detail', `関数${frame.funcIndex}から復帰: ${results.map(r => r.value).join(', ')}`);
        this.recordStep(instrToString(instr));
        return results;
      }

      if (result === 'trap') {
        return null;
      }

      frame.pc++;
    }

    /* 暗黙の復帰 */
    const results: WasmValue[] = [];
    for (let i = 0; i < funcType.results.length; i++) {
      results.unshift(this.pop());
    }
    this.stack.length = frame.returnStackDepth;
    for (const r of results) {
      this.push(r);
    }
    return results;
  }

  /** 単一の命令を実行 */
  private executeInstr(
    instr: Instruction,
    frame: CallFrame,
    instrs: Instruction[],
  ): 'continue' | 'return' | 'trap' {
    const op: number = instr.opcode;

    switch (op) {
      /* ---- 制御命令 ---- */
      case Opcode.Unreachable: {
        this.emit('trap', 'error', 'unreachable命令に到達');
        this.trapCount++;
        this.recordStep('unreachable');
        return 'trap';
      }
      case Opcode.Nop:
        this.recordStep('nop');
        return 'continue';

      case Opcode.Block: {
        const endPc = this.findEnd(instrs, frame.pc);
        const blockFrame: BlockFrame = {
          kind: 'block',
          stackDepth: this.stack.length,
          resultType: instr.blockType ?? 'void',
          startPc: frame.pc,
          endPc,
        };
        frame.blockStack.push(blockFrame);
        this.emit('block_enter', 'detail', `block開始 (結果型: ${blockFrame.resultType})`);
        this.recordStep('block');
        return 'continue';
      }
      case Opcode.Loop: {
        const endPc = this.findEnd(instrs, frame.pc);
        const blockFrame: BlockFrame = {
          kind: 'loop',
          stackDepth: this.stack.length,
          resultType: instr.blockType ?? 'void',
          startPc: frame.pc,
          endPc,
        };
        frame.blockStack.push(blockFrame);
        this.emit('block_enter', 'detail', `loop開始`);
        this.recordStep('loop');
        return 'continue';
      }
      case Opcode.If: {
        const cond = this.pop();
        const endPc = this.findEnd(instrs, frame.pc);
        const elsePc = this.findElse(instrs, frame.pc, endPc);
        const blockFrame: BlockFrame = {
          kind: 'if',
          stackDepth: this.stack.length,
          resultType: instr.blockType ?? 'void',
          startPc: frame.pc,
          endPc,
        };
        frame.blockStack.push(blockFrame);

        if (valToNum(cond) === 0) {
          /* 条件偽: else節またはend にジャンプ */
          frame.pc = elsePc !== -1 ? elsePc : endPc;
          this.emit('branch', 'detail', `if条件=偽 → ${elsePc !== -1 ? 'else' : 'end'}にジャンプ`);
          this.branchCount++;
        } else {
          this.emit('branch', 'detail', `if条件=真 → then節を実行`);
        }
        this.recordStep(`if (${valToNum(cond)})`);
        return 'continue';
      }
      case Opcode.Else: {
        /* then節の終わり → endにジャンプ */
        const block = frame.blockStack[frame.blockStack.length - 1];
        if (block) {
          frame.pc = block.endPc;
        }
        this.recordStep('else → end');
        return 'continue';
      }
      case Opcode.End: {
        if (frame.blockStack.length > 0) {
          const block = frame.blockStack.pop()!;
          this.emit('block_exit', 'detail', `${block.kind}ブロック終了`);

          /* ブロックの結果値を処理 */
          if (block.resultType !== 'void' && this.stack.length > block.stackDepth) {
            const result = this.pop();
            this.stack.length = block.stackDepth;
            this.push(result);
          }
          this.recordStep('end');
        }
        return 'continue';
      }
      case Opcode.Br: {
        const depth = instr.immediate as number;
        this.branchCount++;
        return this.doBranch(frame, depth);
      }
      case Opcode.BrIf: {
        const cond = this.pop();
        if (valToNum(cond) !== 0) {
          const depth = instr.immediate as number;
          this.branchCount++;
          this.emit('branch', 'detail', `br_if 条件=真 → depth=${depth}に分岐`);
          this.recordStep(`br_if ${depth} (true)`);
          return this.doBranch(frame, depth);
        }
        this.recordStep(`br_if ${instr.immediate} (false)`);
        return 'continue';
      }
      case Opcode.BrTable: {
        const idx = valToNum(this.pop());
        const labels = instr.labelIndices ?? [];
        const defaultLabel = instr.defaultLabel ?? 0;
        const depth = idx >= 0 && idx < labels.length ? labels[idx]! : defaultLabel;
        this.branchCount++;
        this.emit('branch', 'detail', `br_table idx=${idx} → depth=${depth}に分岐`);
        this.recordStep(`br_table ${idx}`);
        return this.doBranch(frame, depth);
      }
      case Opcode.Return: {
        this.emit('return', 'detail', `return命令`);
        this.recordStep('return');
        return 'return';
      }
      case Opcode.Call: {
        const funcIdx = instr.immediate as number;
        this.emit('call', 'info', `call 関数${funcIdx}`);
        this.recordStep(`call ${funcIdx}`);
        this.callFunc(funcIdx);
        return 'continue';
      }
      case Opcode.CallIndirect: {
        const typeIdx = instr.immediate as number;
        const tableIdx = valToNum(this.pop());
        if (tableIdx < 0 || tableIdx >= this.table.length) {
          this.emit('trap', 'error', `テーブルインデックス範囲外: ${tableIdx}`);
          this.trapCount++;
          this.recordStep(`call_indirect trap`);
          return 'trap';
        }
        const funcIdx = this.table[tableIdx];
        if (funcIdx === null || funcIdx === undefined) {
          this.emit('trap', 'error', `テーブルエントリが未初期化: ${tableIdx}`);
          this.trapCount++;
          this.recordStep(`call_indirect trap`);
          return 'trap';
        }
        this.emit('table_call', 'info', `call_indirect type=${typeIdx} table[${tableIdx}]→func${funcIdx}`);
        this.recordStep(`call_indirect ${funcIdx}`);
        this.callFunc(funcIdx);
        return 'continue';
      }

      /* ---- パラメトリック命令 ---- */
      case Opcode.Drop: {
        this.pop();
        this.recordStep('drop');
        return 'continue';
      }
      case Opcode.Select: {
        const cond = valToNum(this.pop());
        const val2 = this.pop();
        const val1 = this.pop();
        this.push(cond !== 0 ? val1 : val2);
        this.recordStep(`select (${cond !== 0 ? 'first' : 'second'})`);
        return 'continue';
      }

      /* ---- 変数命令 ---- */
      case Opcode.LocalGet: {
        const idx = instr.immediate as number;
        const val = frame.locals[idx];
        if (!val) {
          this.emit('trap', 'error', `ローカル変数${idx}が範囲外`);
          this.trapCount++;
          return 'trap';
        }
        this.push({ ...val });
        this.recordStep(`local.get ${idx} (=${val.value})`);
        return 'continue';
      }
      case Opcode.LocalSet: {
        const idx = instr.immediate as number;
        frame.locals[idx] = this.pop();
        this.recordStep(`local.set ${idx}`);
        return 'continue';
      }
      case Opcode.LocalTee: {
        const idx = instr.immediate as number;
        const val = this.peek();
        frame.locals[idx] = { ...val };
        this.recordStep(`local.tee ${idx}`);
        return 'continue';
      }
      case Opcode.GlobalGet: {
        const idx = instr.immediate as number;
        const g = this.globals[idx];
        if (!g) {
          this.emit('trap', 'error', `グローバル変数${idx}が範囲外`);
          this.trapCount++;
          return 'trap';
        }
        this.push({ ...g.value });
        this.emit('global_read', 'detail', `global.get ${idx} = ${g.value.value}`);
        this.recordStep(`global.get ${idx}`);
        return 'continue';
      }
      case Opcode.GlobalSet: {
        const idx = instr.immediate as number;
        const g = this.globals[idx];
        if (!g || !g.type.mutable) {
          this.emit('trap', 'error', `グローバル変数${idx}に書込不可`);
          this.trapCount++;
          return 'trap';
        }
        g.value = this.pop();
        this.emit('global_write', 'detail', `global.set ${idx} = ${g.value.value}`);
        this.recordStep(`global.set ${idx}`);
        return 'continue';
      }

      /* ---- メモリ命令 ---- */
      case Opcode.I32Load: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const val = this.memLoad32(addr);
        if (val === null) return 'trap';
        this.push({ type: 'i32', value: val });
        this.emit('memory_read', 'detail', `i32.load [${addr}] = ${val}`);
        this.recordStep(`i32.load [${addr}]`);
        return 'continue';
      }
      case Opcode.I64Load: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const lo = this.memLoad32(addr);
        const hi = this.memLoad32(addr + 4);
        if (lo === null || hi === null) return 'trap';
        const val = BigInt(toU32(lo)) | (BigInt(toU32(hi)) << 32n);
        this.push({ type: 'i64', value: val });
        this.recordStep(`i64.load [${addr}]`);
        return 'continue';
      }
      case Opcode.F32Load: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const bits = this.memLoad32(addr);
        if (bits === null) return 'trap';
        const buf = new ArrayBuffer(4);
        new DataView(buf).setInt32(0, bits, true);
        const val = new DataView(buf).getFloat32(0, true);
        this.push({ type: 'f32', value: val });
        this.recordStep(`f32.load [${addr}]`);
        return 'continue';
      }
      case Opcode.F64Load: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const lo = this.memLoad32(addr);
        const hi = this.memLoad32(addr + 4);
        if (lo === null || hi === null) return 'trap';
        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        const val = dv.getFloat64(0, true);
        this.push({ type: 'f64', value: val });
        this.recordStep(`f64.load [${addr}]`);
        return 'continue';
      }
      case Opcode.I32Load8S: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const b = this.memLoad8(addr);
        if (b === null) return 'trap';
        const val = (b << 24) >> 24; // 符号拡張
        this.push({ type: 'i32', value: val });
        this.recordStep(`i32.load8_s [${addr}]`);
        return 'continue';
      }
      case Opcode.I32Load8U: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const b = this.memLoad8(addr);
        if (b === null) return 'trap';
        this.push({ type: 'i32', value: b });
        this.recordStep(`i32.load8_u [${addr}]`);
        return 'continue';
      }
      case Opcode.I32Load16S: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const lo = this.memLoad8(addr);
        const hi = this.memLoad8(addr + 1);
        if (lo === null || hi === null) return 'trap';
        const val = (((hi << 8) | lo) << 16) >> 16; // 符号拡張
        this.push({ type: 'i32', value: val });
        this.recordStep(`i32.load16_s [${addr}]`);
        return 'continue';
      }
      case Opcode.I32Load16U: {
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const lo = this.memLoad8(addr);
        const hi = this.memLoad8(addr + 1);
        if (lo === null || hi === null) return 'trap';
        this.push({ type: 'i32', value: (hi << 8) | lo });
        this.recordStep(`i32.load16_u [${addr}]`);
        return 'continue';
      }
      case Opcode.I32Store: {
        const val = valToNum(this.pop());
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        if (!this.memStore32(addr, val)) return 'trap';
        this.emit('memory_write', 'detail', `i32.store [${addr}] = ${val}`);
        this.recordStep(`i32.store [${addr}] = ${val}`);
        return 'continue';
      }
      case Opcode.I64Store: {
        const v = this.pop();
        const bigVal = v.type === 'i64' ? v.value as bigint : BigInt(v.value);
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const lo = Number(bigVal & 0xFFFFFFFFn);
        const hi = Number((bigVal >> 32n) & 0xFFFFFFFFn);
        if (!this.memStore32(addr, lo)) return 'trap';
        if (!this.memStore32(addr + 4, hi)) return 'trap';
        this.recordStep(`i64.store [${addr}]`);
        return 'continue';
      }
      case Opcode.F32Store: {
        const val = valToNum(this.pop());
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val, true);
        const bits = new DataView(buf).getInt32(0, true);
        if (!this.memStore32(addr, bits)) return 'trap';
        this.recordStep(`f32.store [${addr}]`);
        return 'continue';
      }
      case Opcode.F64Store: {
        const val = valToNum(this.pop());
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        dv.setFloat64(0, val, true);
        const lo = dv.getInt32(0, true);
        const hi = dv.getInt32(4, true);
        if (!this.memStore32(addr, lo)) return 'trap';
        if (!this.memStore32(addr + 4, hi)) return 'trap';
        this.recordStep(`f64.store [${addr}]`);
        return 'continue';
      }
      case Opcode.I32Store8: {
        const val = valToNum(this.pop()) & 0xFF;
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        if (!this.memStore8(addr, val)) return 'trap';
        this.recordStep(`i32.store8 [${addr}] = ${val}`);
        return 'continue';
      }
      case Opcode.I32Store16: {
        const val = valToNum(this.pop()) & 0xFFFF;
        const addr = valToNum(this.pop()) + (instr.offset ?? 0);
        if (!this.memStore8(addr, val & 0xFF)) return 'trap';
        if (!this.memStore8(addr + 1, (val >> 8) & 0xFF)) return 'trap';
        this.recordStep(`i32.store16 [${addr}] = ${val}`);
        return 'continue';
      }
      case Opcode.MemorySize: {
        this.push({ type: 'i32', value: this.memoryPages });
        this.emit('memory_read', 'detail', `memory.size = ${this.memoryPages}`);
        this.recordStep(`memory.size (${this.memoryPages})`);
        return 'continue';
      }
      case Opcode.MemoryGrow: {
        const delta = valToNum(this.pop());
        const oldPages = this.memoryPages;
        const maxPages = this.module?.memories[0]?.limits.max ?? 256;
        if (this.memoryPages + delta > maxPages) {
          this.push({ type: 'i32', value: -1 });
          this.emit('memory_grow', 'warn', `memory.grow失敗: ${delta}ページ要求 (上限${maxPages})`);
        } else {
          const newMemory = new Uint8Array((this.memoryPages + delta) * PAGE_SIZE);
          newMemory.set(this.memory);
          this.memory = newMemory;
          this.memoryPages += delta;
          if (this.memoryPages > this.memoryPeakPages) {
            this.memoryPeakPages = this.memoryPages;
          }
          this.push({ type: 'i32', value: oldPages });
          this.emit('memory_grow', 'info', `memory.grow: ${oldPages}→${this.memoryPages}ページ`);
        }
        this.recordStep(`memory.grow ${delta}`);
        return 'continue';
      }

      /* ---- 定数命令 ---- */
      case Opcode.I32Const: {
        const val = instr.immediate as number;
        this.push({ type: 'i32', value: val });
        this.emit('stack_push', 'detail', `i32.const ${val}`);
        this.recordStep(`i32.const ${val}`);
        return 'continue';
      }
      case Opcode.I64Const: {
        const val = typeof instr.immediate === 'bigint' ? instr.immediate : BigInt(instr.immediate ?? 0);
        this.push({ type: 'i64', value: val });
        this.recordStep(`i64.const ${val}`);
        return 'continue';
      }
      case Opcode.F32Const: {
        const val = instr.immediate as number;
        this.push({ type: 'f32', value: val });
        this.recordStep(`f32.const ${val}`);
        return 'continue';
      }
      case Opcode.F64Const: {
        const val = instr.immediate as number;
        this.push({ type: 'f64', value: val });
        this.recordStep(`f64.const ${val}`);
        return 'continue';
      }

      /* ---- i32 比較命令 ---- */
      case Opcode.I32Eqz: {
        const a = valToNum(this.pop());
        this.push({ type: 'i32', value: a === 0 ? 1 : 0 });
        this.recordStep(`i32.eqz (${a})`);
        return 'continue';
      }
      case Opcode.I32Eq: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: a === b ? 1 : 0 });
        this.recordStep(`i32.eq ${a} == ${b}`);
        return 'continue';
      }
      case Opcode.I32Ne: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: a !== b ? 1 : 0 });
        this.recordStep(`i32.ne ${a} != ${b}`);
        return 'continue';
      }
      case Opcode.I32LtS: {
        const b = toI32(valToNum(this.pop())), a = toI32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a < b ? 1 : 0 });
        this.recordStep(`i32.lt_s ${a} < ${b}`);
        return 'continue';
      }
      case Opcode.I32LtU: {
        const b = toU32(valToNum(this.pop())), a = toU32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a < b ? 1 : 0 });
        this.recordStep(`i32.lt_u`);
        return 'continue';
      }
      case Opcode.I32GtS: {
        const b = toI32(valToNum(this.pop())), a = toI32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a > b ? 1 : 0 });
        this.recordStep(`i32.gt_s ${a} > ${b}`);
        return 'continue';
      }
      case Opcode.I32GtU: {
        const b = toU32(valToNum(this.pop())), a = toU32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a > b ? 1 : 0 });
        this.recordStep(`i32.gt_u`);
        return 'continue';
      }
      case Opcode.I32LeS: {
        const b = toI32(valToNum(this.pop())), a = toI32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a <= b ? 1 : 0 });
        this.recordStep(`i32.le_s`);
        return 'continue';
      }
      case Opcode.I32LeU: {
        const b = toU32(valToNum(this.pop())), a = toU32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a <= b ? 1 : 0 });
        this.recordStep(`i32.le_u`);
        return 'continue';
      }
      case Opcode.I32GeS: {
        const b = toI32(valToNum(this.pop())), a = toI32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a >= b ? 1 : 0 });
        this.recordStep(`i32.ge_s`);
        return 'continue';
      }
      case Opcode.I32GeU: {
        const b = toU32(valToNum(this.pop())), a = toU32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a >= b ? 1 : 0 });
        this.recordStep(`i32.ge_u`);
        return 'continue';
      }

      /* ---- i32 算術命令 ---- */
      case Opcode.I32Add: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: toI32(a + b) });
        this.emit('execute', 'detail', `i32.add: ${a} + ${b} = ${toI32(a + b)}`);
        this.recordStep(`i32.add ${a} + ${b}`);
        return 'continue';
      }
      case Opcode.I32Sub: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: toI32(a - b) });
        this.recordStep(`i32.sub ${a} - ${b}`);
        return 'continue';
      }
      case Opcode.I32Mul: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: toI32(Math.imul(a, b)) });
        this.recordStep(`i32.mul ${a} * ${b}`);
        return 'continue';
      }
      case Opcode.I32DivS: {
        const b = toI32(valToNum(this.pop())), a = toI32(valToNum(this.pop()));
        if (b === 0) {
          this.emit('trap', 'error', 'ゼロ除算');
          this.trapCount++;
          this.recordStep('i32.div_s trap');
          return 'trap';
        }
        this.push({ type: 'i32', value: toI32(Math.trunc(a / b)) });
        this.recordStep(`i32.div_s ${a} / ${b}`);
        return 'continue';
      }
      case Opcode.I32DivU: {
        const b = toU32(valToNum(this.pop())), a = toU32(valToNum(this.pop()));
        if (b === 0) {
          this.emit('trap', 'error', 'ゼロ除算');
          this.trapCount++;
          return 'trap';
        }
        this.push({ type: 'i32', value: toI32((a / b) >>> 0) });
        this.recordStep(`i32.div_u`);
        return 'continue';
      }
      case Opcode.I32RemS: {
        const b = toI32(valToNum(this.pop())), a = toI32(valToNum(this.pop()));
        if (b === 0) {
          this.emit('trap', 'error', 'ゼロ除算');
          this.trapCount++;
          return 'trap';
        }
        this.push({ type: 'i32', value: toI32(a % b) });
        this.recordStep(`i32.rem_s`);
        return 'continue';
      }
      case Opcode.I32RemU: {
        const b = toU32(valToNum(this.pop())), a = toU32(valToNum(this.pop()));
        if (b === 0) {
          this.emit('trap', 'error', 'ゼロ除算');
          this.trapCount++;
          return 'trap';
        }
        this.push({ type: 'i32', value: toI32((a % b) >>> 0) });
        this.recordStep(`i32.rem_u`);
        return 'continue';
      }
      case Opcode.I32And: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: a & b });
        this.recordStep(`i32.and`);
        return 'continue';
      }
      case Opcode.I32Or: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: a | b });
        this.recordStep(`i32.or`);
        return 'continue';
      }
      case Opcode.I32Xor: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: a ^ b });
        this.recordStep(`i32.xor`);
        return 'continue';
      }
      case Opcode.I32Shl: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: toI32(a << (b & 31)) });
        this.recordStep(`i32.shl`);
        return 'continue';
      }
      case Opcode.I32ShrS: {
        const b = valToNum(this.pop()), a = toI32(valToNum(this.pop()));
        this.push({ type: 'i32', value: a >> (b & 31) });
        this.recordStep(`i32.shr_s`);
        return 'continue';
      }
      case Opcode.I32ShrU: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'i32', value: toI32((a >>> (b & 31))) });
        this.recordStep(`i32.shr_u`);
        return 'continue';
      }
      case Opcode.I32Rotl: {
        const b = valToNum(this.pop()) & 31, a = toU32(valToNum(this.pop()));
        this.push({ type: 'i32', value: toI32((a << b) | (a >>> (32 - b))) });
        this.recordStep(`i32.rotl`);
        return 'continue';
      }
      case Opcode.I32Rotr: {
        const b = valToNum(this.pop()) & 31, a = toU32(valToNum(this.pop()));
        this.push({ type: 'i32', value: toI32((a >>> b) | (a << (32 - b))) });
        this.recordStep(`i32.rotr`);
        return 'continue';
      }

      /* ---- i64 算術命令 ---- */
      case Opcode.I64Add: {
        const b = this.popI64(), a = this.popI64();
        this.push({ type: 'i64', value: a + b });
        this.recordStep(`i64.add`);
        return 'continue';
      }
      case Opcode.I64Sub: {
        const b = this.popI64(), a = this.popI64();
        this.push({ type: 'i64', value: a - b });
        this.recordStep(`i64.sub`);
        return 'continue';
      }
      case Opcode.I64Mul: {
        const b = this.popI64(), a = this.popI64();
        this.push({ type: 'i64', value: a * b });
        this.recordStep(`i64.mul`);
        return 'continue';
      }

      /* ---- f32 算術命令 ---- */
      case Opcode.F32Add: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f32', value: Math.fround(a + b) });
        this.recordStep(`f32.add`);
        return 'continue';
      }
      case Opcode.F32Sub: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f32', value: Math.fround(a - b) });
        this.recordStep(`f32.sub`);
        return 'continue';
      }
      case Opcode.F32Mul: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f32', value: Math.fround(a * b) });
        this.recordStep(`f32.mul`);
        return 'continue';
      }
      case Opcode.F32Div: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f32', value: Math.fround(a / b) });
        this.recordStep(`f32.div`);
        return 'continue';
      }

      /* ---- f64 算術命令 ---- */
      case Opcode.F64Add: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f64', value: a + b });
        this.recordStep(`f64.add`);
        return 'continue';
      }
      case Opcode.F64Sub: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f64', value: a - b });
        this.recordStep(`f64.sub`);
        return 'continue';
      }
      case Opcode.F64Mul: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f64', value: a * b });
        this.recordStep(`f64.mul`);
        return 'continue';
      }
      case Opcode.F64Div: {
        const b = valToNum(this.pop()), a = valToNum(this.pop());
        this.push({ type: 'f64', value: a / b });
        this.recordStep(`f64.div`);
        return 'continue';
      }

      /* ---- 型変換命令 ---- */
      case Opcode.I32WrapI64: {
        const v = this.popI64();
        this.push({ type: 'i32', value: Number(v & 0xFFFFFFFFn) | 0 });
        this.recordStep('i32.wrap_i64');
        return 'continue';
      }
      case Opcode.I32TruncF32S:
      case Opcode.I32TruncF64S: {
        const v = valToNum(this.pop());
        this.push({ type: 'i32', value: toI32(Math.trunc(v)) });
        this.recordStep('i32.trunc_f*_s');
        return 'continue';
      }
      case Opcode.I64ExtendI32S: {
        const v = toI32(valToNum(this.pop()));
        this.push({ type: 'i64', value: BigInt(v) });
        this.recordStep('i64.extend_i32_s');
        return 'continue';
      }
      case Opcode.I64ExtendI32U: {
        const v = toU32(valToNum(this.pop()));
        this.push({ type: 'i64', value: BigInt(v) });
        this.recordStep('i64.extend_i32_u');
        return 'continue';
      }
      case Opcode.F32ConvertI32S: {
        const v = toI32(valToNum(this.pop()));
        this.push({ type: 'f32', value: Math.fround(v) });
        this.recordStep('f32.convert_i32_s');
        return 'continue';
      }
      case Opcode.F64ConvertI32S: {
        const v = toI32(valToNum(this.pop()));
        this.push({ type: 'f64', value: v });
        this.recordStep('f64.convert_i32_s');
        return 'continue';
      }
      case Opcode.F64ConvertI64S: {
        const v = this.popI64();
        this.push({ type: 'f64', value: Number(v) });
        this.recordStep('f64.convert_i64_s');
        return 'continue';
      }

      default: {
        this.emit('trap', 'error', `未実装オペコード: 0x${op.toString(16)}`);
        this.trapCount++;
        this.recordStep(`unknown 0x${op.toString(16)}`);
        return 'trap';
      }
    }
  }

  /* ---------- 分岐処理 ---------- */

  /** br depth を実行 */
  private doBranch(frame: CallFrame, depth: number): 'continue' | 'return' {
    if (depth >= frame.blockStack.length) {
      /* 関数レベルの分岐 = return */
      this.emit('branch', 'detail', `br depth=${depth} → 関数復帰`);
      this.recordStep(`br ${depth} (return)`);
      return 'return';
    }

    /* 対象ブロックを特定 */
    const targetIdx = frame.blockStack.length - 1 - depth;
    const target = frame.blockStack[targetIdx]!;

    if (target.kind === 'loop') {
      /* loopの場合: ブロック先頭に戻る */
      /* targetIdxより上のブロックを除去 */
      frame.blockStack.length = targetIdx + 1;
      frame.pc = target.startPc; // loop先頭（pcはループ後にインクリメントされるので、startPcはloop命令自体を指す）
      this.emit('branch', 'detail', `br → loop先頭に戻る (pc=${frame.pc})`);
    } else {
      /* block/ifの場合: ブロック終端にジャンプ */
      /* 結果値の保存 */
      let result: WasmValue | undefined;
      if (target.resultType !== 'void' && this.stack.length > target.stackDepth) {
        result = this.pop();
      }
      /* スタックを復元 */
      this.stack.length = target.stackDepth;
      if (result) this.push(result);
      /* ブロックスタックを巻き戻し */
      frame.blockStack.length = targetIdx;
      frame.pc = target.endPc; // end命令を指す (end処理でさらにpopされないようにブロックは既に除去済み)
      this.emit('branch', 'detail', `br → block終端にジャンプ (pc=${frame.pc})`);
    }
    this.recordStep(`br ${depth}`);
    return 'continue';
  }

  /* ---------- ブロック探索 ---------- */

  /** 対応するEnd命令のPCを見つける */
  private findEnd(instrs: Instruction[], startPc: number): number {
    let depth = 0;
    for (let i = startPc + 1; i < instrs.length; i++) {
      const op = instrs[i]!.opcode;
      if (op === Opcode.Block || op === Opcode.Loop || op === Opcode.If) {
        depth++;
      } else if (op === Opcode.End) {
        if (depth === 0) return i;
        depth--;
      }
    }
    return instrs.length - 1;
  }

  /** 対応するElse命令のPCを見つける（なければ-1） */
  private findElse(instrs: Instruction[], startPc: number, endPc: number): number {
    let depth = 0;
    for (let i = startPc + 1; i < endPc; i++) {
      const op = instrs[i]!.opcode;
      if (op === Opcode.Block || op === Opcode.Loop || op === Opcode.If) {
        depth++;
      } else if (op === Opcode.End) {
        depth--;
      } else if (op === Opcode.Else && depth === 0) {
        return i;
      }
    }
    return -1;
  }

  /* ---------- スタック操作 ---------- */

  private push(val: WasmValue): void {
    this.stack.push(val);
    if (this.stack.length > this.maxStackDepth) {
      this.maxStackDepth = this.stack.length;
    }
  }

  private pop(): WasmValue {
    const val = this.stack.pop();
    if (!val) {
      this.emit('trap', 'error', 'スタックアンダーフロー');
      return { type: 'i32', value: 0 };
    }
    return val;
  }

  private peek(): WasmValue {
    const val = this.stack[this.stack.length - 1];
    if (!val) {
      this.emit('trap', 'error', 'スタックアンダーフロー（peek）');
      return { type: 'i32', value: 0 };
    }
    return { ...val };
  }

  private popI64(): bigint {
    const v = this.pop();
    if (v.type === 'i64') return v.value as bigint;
    return BigInt(v.value);
  }

  /* ---------- メモリ操作 ---------- */

  private memLoad8(addr: number): number | null {
    if (addr < 0 || addr >= this.memory.length) {
      this.emit('trap', 'error', `メモリアクセス範囲外: addr=${addr}, size=${this.memory.length}`);
      this.trapCount++;
      this.recordStep(`memory trap addr=${addr}`);
      return null;
    }
    return this.memory[addr]!;
  }

  private memLoad32(addr: number): number | null {
    if (addr < 0 || addr + 3 >= this.memory.length) {
      this.emit('trap', 'error', `メモリアクセス範囲外: addr=${addr}`);
      this.trapCount++;
      return null;
    }
    return (
      this.memory[addr]! |
      (this.memory[addr + 1]! << 8) |
      (this.memory[addr + 2]! << 16) |
      (this.memory[addr + 3]! << 24)
    );
  }

  private memStore8(addr: number, val: number): boolean {
    if (addr < 0 || addr >= this.memory.length) {
      this.emit('trap', 'error', `メモリ書込み範囲外: addr=${addr}`);
      this.trapCount++;
      return false;
    }
    this.memory[addr] = val & 0xFF;
    return true;
  }

  private memStore32(addr: number, val: number): boolean {
    if (addr < 0 || addr + 3 >= this.memory.length) {
      this.emit('trap', 'error', `メモリ書込み範囲外: addr=${addr}`);
      this.trapCount++;
      return false;
    }
    this.memory[addr] = val & 0xFF;
    this.memory[addr + 1] = (val >> 8) & 0xFF;
    this.memory[addr + 2] = (val >> 16) & 0xFF;
    this.memory[addr + 3] = (val >> 24) & 0xFF;
    return true;
  }

  /* ---------- イベント / スナップショット ---------- */

  private emit(type: WasmEvent['type'], severity: WasmEvent['severity'], message: string): void {
    this.events.push({ type, severity, message });
  }

  private recordStep(instrStr: string): void {
    const frame = this.callStack[this.callStack.length - 1];
    const snapshot: StepSnapshot = {
      step: this.stepCounter++,
      instruction: instrStr,
      stack: this.stack.map(v => ({ ...v })),
      callStack: this.callStack.map(f => ({ funcIndex: f.funcIndex, pc: f.pc })),
      locals: frame ? frame.locals.map(v => ({ ...v })) : [],
      globals: this.globals.map(g => ({ ...g.value })),
      memoryPages: this.memoryPages,
      memoryPreview: Array.from(this.memory.slice(0, Math.min(256, this.memory.length))),
      table: [...this.table],
      events: [...this.events],
      message: instrStr,
    };
    this.steps.push(snapshot);
    this.events = [];
  }

  private buildResult(result: WasmValue[] | null): WasmSimResult {
    return {
      steps: this.steps,
      result,
      exports: this.module?.exports ?? [],
      stats: {
        totalInstructions: this.totalInstructions,
        maxStackDepth: this.maxStackDepth,
        maxCallDepth: this.maxCallDepth,
        memoryPeakPages: this.memoryPeakPages,
        hostCalls: this.hostCallCount,
        branches: this.branchCount,
        traps: this.trapCount,
      },
    };
  }
}

/* ---------- ヘルパービルダー ---------- */

/** 空のWASMモジュールを作成 */
export function emptyModule(): WasmModule {
  return {
    types: [],
    imports: [],
    functions: [],
    tables: [],
    memories: [],
    globals: [],
    exports: [],
    elements: [],
    codes: [],
    data: [],
  };
}

/** シミュレーションを実行するユーティリティ */
export function runSimulation(
  mod: WasmModule,
  exportName: string,
  args?: WasmValue[],
  hostFuncs?: HostFunc[],
): WasmSimResult {
  const vm = new WasmVM();
  vm.loadModule(mod, hostFuncs);
  vm.instantiate();
  return vm.callExport(exportName, args);
}
