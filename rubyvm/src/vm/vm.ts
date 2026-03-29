// YARV仮想マシン: バイトコードをスタックベースで実行する

import type { InstructionSequence, BlockInfo } from './compiler.js';
import { Opcode } from './compiler.js';
import {
  type RubyObject,
  type RubyMethod,
  RubyClass,
  RubyInteger,
  RubyString,
  RubySymbol,
  RubyArray,
  RubyHash,
  RubyNil,
  RubyBool,
  RubyProc,
  createObjectHierarchy,
} from './object.js';

/** コールフレーム: メソッド呼び出しごとに作成される */
interface CallFrame {
  /** 実行中の命令列 */
  iseq: InstructionSequence;
  /** 命令ポインタ */
  ip: number;
  /** ローカル変数テーブル */
  locals: Map<string, RubyObject>;
  /** selfの参照 */
  self: RubyObject;
  /** このフレームに渡されたブロック */
  block: RubyProc | null;
  /** スタックの底（このフレームの開始位置） */
  stackBase: number;
}

/** VM実行のステップ情報（デバッグ・UI用） */
export interface VMStep {
  instruction: string;
  stack: string[];
  locals: Record<string, string>;
  output: string | null;
}

/** YARV仮想マシン */
export class VM {
  /** オペランドスタック */
  private stack: RubyObject[] = [];
  /** コールフレームスタック */
  private frames: CallFrame[] = [];
  /** ブロック命令列（コンパイラから受け取る） */
  private blockSequences: InstructionSequence[] = [];
  /** 出力バッファ */
  private output: string[] = [];
  /** 実行ステップの記録 */
  private steps: VMStep[] = [];
  /** ステップ記録を有効にするか */
  private recordSteps: boolean = false;

  // 組み込みクラス階層
  private objectClass: RubyClass;
  private integerClass: RubyClass;
  private stringClass: RubyClass;
  private symbolClass: RubyClass;
  private arrayClass: RubyClass;
  private hashClass: RubyClass;
  private nilClass: RubyClass;
  private boolClass: RubyClass;
  private procClass: RubyClass;

  /** ユーザー定義クラスの格納 */
  private userClasses: Map<string, RubyClass> = new Map();
  /** ユーザー定義メソッド（トップレベル） */
  private topLevelMethods: Map<string, { iseqIndex: number; params: string[] }> = new Map();

  constructor() {
    const hierarchy = createObjectHierarchy();
    this.objectClass = hierarchy.objectClass;
    this.integerClass = hierarchy.integerClass;
    this.stringClass = hierarchy.stringClass;
    this.symbolClass = hierarchy.symbolClass;
    this.arrayClass = hierarchy.arrayClass;
    this.hashClass = hierarchy.hashClass;
    this.nilClass = hierarchy.nilClass;
    this.boolClass = hierarchy.boolClass;
    this.procClass = hierarchy.procClass;
  }

  /** nilオブジェクトを生成する */
  private createNil(): RubyNil {
    return new RubyNil(this.nilClass);
  }

  /** 整数オブジェクトを生成する */
  private createInteger(value: number): RubyInteger {
    return new RubyInteger(value, this.integerClass);
  }

  /** 文字列オブジェクトを生成する */
  private createString(value: string): RubyString {
    return new RubyString(value, this.stringClass);
  }

  /** 真偽値オブジェクトを生成する */
  private createBool(value: boolean): RubyBool {
    return new RubyBool(value, this.boolClass);
  }

  /** プログラムを実行する */
  execute(
    mainIseq: InstructionSequence,
    blockSequences: InstructionSequence[],
    options?: { recordSteps?: boolean }
  ): { output: string; steps: VMStep[] } {
    this.stack = [];
    this.frames = [];
    this.blockSequences = blockSequences;
    this.output = [];
    this.steps = [];
    this.recordSteps = options?.recordSteps ?? false;
    this.userClasses = new Map();
    this.topLevelMethods = new Map();

    // mainフレームを作成
    const mainSelf = new RubyString('main', this.stringClass);
    this.pushFrame(mainIseq, mainSelf, null);

    // 実行ループ（フレームが0になるまで実行）
    this.run(0);

    return {
      output: this.output.join(''),
      steps: this.steps,
    };
  }

  /** 実行ループ（minFrameDepthより深いフレームのみ実行する） */
  private run(minFrameDepth: number = 0): void {
    const maxSteps = 100000; // 無限ループ防止
    let stepCount = 0;

    while (this.frames.length > minFrameDepth && stepCount < maxSteps) {
      stepCount++;
      const frame = this.currentFrame();
      const instr = frame.iseq.instructions[frame.ip];

      if (!instr) {
        // 命令列の終端に達した場合
        this.popFrame();
        continue;
      }

      // ステップ記録
      if (this.recordSteps) {
        this.recordStep(instr.opcode + ' ' + instr.operands.map(o => String(o)).join(', '));
      }

      frame.ip++;

      switch (instr.opcode) {
        case Opcode.PUTNIL:
          this.push(this.createNil());
          break;

        case Opcode.PUTOBJECT: {
          const val = instr.operands[0];
          if (typeof val === 'number') {
            this.push(this.createInteger(val));
          } else if (typeof val === 'boolean') {
            this.push(this.createBool(val));
          } else {
            this.push(this.createNil());
          }
          break;
        }

        case Opcode.PUTSELF:
          this.push(frame.self);
          break;

        case Opcode.PUTSTRING: {
          const str = String(instr.operands[0] ?? '');
          this.push(this.createString(str));
          break;
        }

        case Opcode.PUTSYMBOL: {
          const name = String(instr.operands[0] ?? '');
          this.push(new RubySymbol(name, this.symbolClass));
          break;
        }

        case Opcode.SETLOCAL: {
          const name = String(instr.operands[0] ?? '');
          const val = this.pop();
          frame.locals.set(name, val);
          break;
        }

        case Opcode.GETLOCAL: {
          const name = String(instr.operands[0] ?? '');
          const val = frame.locals.get(name) ?? this.createNil();
          this.push(val);
          break;
        }

        case Opcode.SEND: {
          const methodName = String(instr.operands[0] ?? '');
          const argc = Number(instr.operands[1] ?? 0);
          const blockInfoRaw = instr.operands[2];
          this.executeSend(methodName, argc, blockInfoRaw as BlockInfo | null);
          break;
        }

        case Opcode.LEAVE: {
          // 現在のフレームからリターン
          const returnValue = this.stack.length > frame.stackBase
            ? this.pop()
            : this.createNil();
          // フレームのスタックを全部クリア
          while (this.stack.length > frame.stackBase) {
            this.pop();
          }
          this.popFrame();
          // リターン値を呼び出し元のスタックに積む
          this.push(returnValue);
          break;
        }

        case Opcode.BRANCHIF: {
          const target = Number(instr.operands[0] ?? 0);
          const cond = this.pop();
          if (cond.isTruthy()) {
            frame.ip = target;
          }
          break;
        }

        case Opcode.BRANCHUNLESS: {
          const target = Number(instr.operands[0] ?? 0);
          const cond = this.pop();
          if (!cond.isTruthy()) {
            frame.ip = target;
          }
          break;
        }

        case Opcode.JUMP: {
          const target = Number(instr.operands[0] ?? 0);
          frame.ip = target;
          break;
        }

        case Opcode.NEWARRAY: {
          const count = Number(instr.operands[0] ?? 0);
          const elements: RubyObject[] = [];
          for (let i = 0; i < count; i++) {
            elements.unshift(this.pop());
          }
          this.push(new RubyArray(elements, this.arrayClass));
          break;
        }

        case Opcode.NEWHASH: {
          const count = Number(instr.operands[0] ?? 0);
          const hash = new RubyHash(this.hashClass);
          const pairsArray: RubyObject[] = [];
          for (let i = 0; i < count; i++) {
            pairsArray.unshift(this.pop());
          }
          for (let i = 0; i < pairsArray.length; i += 2) {
            const key = pairsArray[i]!;
            const value = pairsArray[i + 1]!;
            hash.set(key, value);
          }
          this.push(hash);
          break;
        }

        case Opcode.DEFINEMETHOD: {
          const methodNameDef = String(instr.operands[0] ?? '');
          const iseqIndex = Number(instr.operands[1] ?? 0);
          const paramsStr = String(instr.operands[2] ?? '[]');
          const params = JSON.parse(paramsStr) as string[];

          // トップレベルまたは現在のクラスにメソッドを定義
          this.topLevelMethods.set(methodNameDef, { iseqIndex, params });

          // 現在のselfがクラスの場合、そのクラスにメソッドを定義する
          if (frame.self instanceof RubyClass) {
            frame.self.defineMethod({
              name: methodNameDef,
              params,
              iseqIndex,
            });
          }
          break;
        }

        case Opcode.DEFINECLASS: {
          const className = String(instr.operands[0] ?? '');
          const classIseqIndex = Number(instr.operands[1] ?? 0);
          const superclassName = instr.operands[2] as string | null;

          // スーパークラスを解決
          let superclass = this.objectClass;
          if (superclassName) {
            superclass = this.userClasses.get(superclassName) ?? this.objectClass;
          }

          // クラスを作成
          const klass = new RubyClass(className, superclass);
          this.userClasses.set(className, klass);

          // クラス本体を実行
          const classIseq = this.blockSequences[classIseqIndex];
          if (classIseq) {
            this.pushFrame(classIseq, klass, null);
          }
          break;
        }

        case Opcode.POP:
          if (this.stack.length > frame.stackBase) {
            this.pop();
          }
          break;

        case Opcode.DUP: {
          const top = this.stack[this.stack.length - 1] ?? this.createNil();
          this.push(top);
          break;
        }

        case Opcode.CONCAT: {
          const right = this.pop();
          const left = this.pop();
          const result = this.createString(left.toS() + right.toS());
          this.push(result);
          break;
        }

        case Opcode.TOSTRING: {
          const obj = this.pop();
          this.push(this.createString(obj.toS()));
          break;
        }

        case Opcode.YIELD: {
          const yieldArgc = Number(instr.operands[0] ?? 0);
          this.executeYield(yieldArgc);
          break;
        }

        default:
          // 未知の命令はスキップ
          break;
      }
    }
  }

  /** SEND命令を実行する：メソッドディスパッチ */
  private executeSend(methodName: string, argc: number, blockInfo: BlockInfo | null): void {
    // 引数をスタックから取得
    const args: RubyObject[] = [];
    for (let i = 0; i < argc; i++) {
      args.unshift(this.pop());
    }

    // レシーバをスタックから取得
    const receiver = this.pop();

    // ブロックがあれば Proc を生成
    let blockProc: RubyProc | null = null;
    if (blockInfo) {
      const frame = this.currentFrame();
      blockProc = new RubyProc(
        blockInfo.params,
        blockInfo.startLabel,
        new Map(frame.locals),
        this.procClass,
      );
    }

    // 特殊メソッド: puts, print
    if (methodName === 'puts') {
      this.builtinPuts(args);
      return;
    }

    if (methodName === 'print') {
      this.builtinPrint(args);
      return;
    }

    // !演算子
    if (methodName === '!') {
      this.push(this.createBool(!receiver.isTruthy()));
      return;
    }

    // イテレータメソッド: times, each, map
    if (methodName === 'times' && receiver instanceof RubyInteger && blockProc) {
      this.executeTimesBlock(receiver, blockProc);
      return;
    }

    if (methodName === 'each' && receiver instanceof RubyArray && blockProc) {
      this.executeEachBlock(receiver, blockProc);
      return;
    }

    if (methodName === 'map' && receiver instanceof RubyArray && blockProc) {
      this.executeMapBlock(receiver, blockProc);
      return;
    }

    // クラスのnewメソッド
    if (methodName === 'new' && receiver instanceof RubyClass) {
      this.executeNew(receiver, args);
      return;
    }

    // ネイティブメソッドの検索
    const method = receiver.klass.lookupMethod(methodName);
    if (method?.native) {
      const result = method.native(receiver, args, blockProc);
      this.push(result);
      return;
    }

    // ユーザー定義メソッド
    if (method?.iseqIndex !== undefined) {
      const methodIseq = this.blockSequences[method.iseqIndex];
      if (methodIseq) {
        const newFrame = this.pushFrame(methodIseq, receiver, blockProc);
        // 引数をローカル変数に設定
        for (let i = 0; i < method.params.length; i++) {
          const paramName = method.params[i];
          if (paramName) {
            newFrame.locals.set(paramName, args[i] ?? this.createNil());
          }
        }
        return;
      }
    }

    // トップレベルメソッドの検索
    const topMethod = this.topLevelMethods.get(methodName);
    if (topMethod) {
      const methodIseq = this.blockSequences[topMethod.iseqIndex];
      if (methodIseq) {
        const newFrame = this.pushFrame(methodIseq, receiver, blockProc);
        for (let i = 0; i < topMethod.params.length; i++) {
          const paramName = topMethod.params[i];
          if (paramName) {
            newFrame.locals.set(paramName, args[i] ?? this.createNil());
          }
        }
        return;
      }
    }

    // メソッドが見つからない場合
    this.push(this.createNil());
  }

  /** putsの組み込み実装 */
  private builtinPuts(args: RubyObject[]): void {
    if (args.length === 0) {
      this.output.push('\n');
    } else {
      for (const arg of args) {
        this.output.push(arg.toS() + '\n');
      }
    }
    this.push(this.createNil());
  }

  /** printの組み込み実装 */
  private builtinPrint(args: RubyObject[]): void {
    for (const arg of args) {
      this.output.push(arg.toS());
    }
    this.push(this.createNil());
  }

  /** timesブロックの実行 */
  private executeTimesBlock(receiver: RubyInteger, blockProc: RubyProc): void {
    const blockIseq = this.blockSequences[blockProc.iseqIndex];
    if (!blockIseq) {
      this.push(receiver);
      return;
    }

    const callerSelf = this.currentFrame().self;
    const callerDepth = this.frames.length;

    for (let i = 0; i < receiver.value; i++) {
      const blockFrame = this.pushFrame(blockIseq, callerSelf, null);
      // ブロック引数を設定
      if (blockProc.params[0]) {
        blockFrame.locals.set(blockProc.params[0], this.createInteger(i));
      }
      // 捕捉したローカル変数を設定
      for (const [k, v] of blockProc.capturedLocals) {
        if (!blockFrame.locals.has(k)) {
          blockFrame.locals.set(k, v);
        }
      }
      this.run(callerDepth);
      // ブロックの戻り値をポップ
      if (this.stack.length > 0) {
        this.pop();
      }
    }

    this.push(receiver);
  }

  /** eachブロックの実行 */
  private executeEachBlock(receiver: RubyArray, blockProc: RubyProc): void {
    const blockIseq = this.blockSequences[blockProc.iseqIndex];
    if (!blockIseq) {
      this.push(receiver);
      return;
    }

    const callerSelf = this.currentFrame().self;
    const callerDepth = this.frames.length;

    for (const elem of receiver.elements) {
      const blockFrame = this.pushFrame(blockIseq, callerSelf, null);
      if (blockProc.params[0]) {
        blockFrame.locals.set(blockProc.params[0], elem);
      }
      for (const [k, v] of blockProc.capturedLocals) {
        if (!blockFrame.locals.has(k)) {
          blockFrame.locals.set(k, v);
        }
      }
      this.run(callerDepth);
      if (this.stack.length > 0) {
        this.pop();
      }
    }

    this.push(receiver);
  }

  /** mapブロックの実行 */
  private executeMapBlock(receiver: RubyArray, blockProc: RubyProc): void {
    const blockIseq = this.blockSequences[blockProc.iseqIndex];
    if (!blockIseq) {
      this.push(receiver);
      return;
    }

    const callerSelf = this.currentFrame().self;
    const callerDepth = this.frames.length;
    const results: RubyObject[] = [];

    for (const elem of receiver.elements) {
      const blockFrame = this.pushFrame(blockIseq, callerSelf, null);
      if (blockProc.params[0]) {
        blockFrame.locals.set(blockProc.params[0], elem);
      }
      for (const [k, v] of blockProc.capturedLocals) {
        if (!blockFrame.locals.has(k)) {
          blockFrame.locals.set(k, v);
        }
      }
      this.run(callerDepth);
      // ブロックの戻り値を収集
      const result = this.stack.length > 0 ? this.pop() : this.createNil();
      results.push(result);
    }

    this.push(new RubyArray(results, this.arrayClass));
  }

  /** Class.newの実行 */
  private executeNew(klass: RubyClass, args: RubyObject[]): void {
    // 新しいオブジェクトを作成（簡易実装）
    const obj = new RubyString('', this.stringClass);
    // klassを設定
    obj.klass = klass;
    obj.type = 'object';

    // initializeメソッドがあれば呼び出す
    const initMethod = klass.lookupMethod('initialize');
    if (initMethod?.iseqIndex !== undefined) {
      const initIseq = this.blockSequences[initMethod.iseqIndex];
      if (initIseq) {
        const callerDepth = this.frames.length;
        const newFrame = this.pushFrame(initIseq, obj, null);
        for (let i = 0; i < initMethod.params.length; i++) {
          const paramName = initMethod.params[i];
          if (paramName) {
            newFrame.locals.set(paramName, args[i] ?? this.createNil());
          }
        }
        this.run(callerDepth);
        // initializeの戻り値を捨てる
        if (this.stack.length > 0) {
          this.pop();
        }
      }
    }

    this.push(obj);
  }

  /** yield命令の実行 */
  private executeYield(argc: number): void {
    const frame = this.currentFrame();
    const block = frame.block;

    if (!block) {
      this.push(this.createNil());
      return;
    }

    const blockIseq = this.blockSequences[block.iseqIndex];
    if (!blockIseq) {
      this.push(this.createNil());
      return;
    }

    // yield引数を取得
    const yieldArgs: RubyObject[] = [];
    for (let i = 0; i < argc; i++) {
      yieldArgs.unshift(this.pop());
    }

    const callerDepth = this.frames.length;
    const blockFrame = this.pushFrame(blockIseq, frame.self, null);

    // ブロック引数を設定
    for (let i = 0; i < block.params.length; i++) {
      const paramName = block.params[i];
      if (paramName) {
        blockFrame.locals.set(paramName, yieldArgs[i] ?? this.createNil());
      }
    }

    // 捕捉したローカル変数を設定
    for (const [k, v] of block.capturedLocals) {
      if (!blockFrame.locals.has(k)) {
        blockFrame.locals.set(k, v);
      }
    }

    this.run(callerDepth);
    // ブロックの戻り値はスタックに残る
  }

  // === スタック操作 ===

  /** スタックにプッシュする */
  private push(obj: RubyObject): void {
    this.stack.push(obj);
  }

  /** スタックからポップする */
  private pop(): RubyObject {
    return this.stack.pop() ?? this.createNil();
  }

  // === フレーム操作 ===

  /** 新しいフレームをプッシュする */
  private pushFrame(iseq: InstructionSequence, self: RubyObject, block: RubyProc | null): CallFrame {
    const frame: CallFrame = {
      iseq,
      ip: 0,
      locals: new Map(),
      self,
      block,
      stackBase: this.stack.length,
    };
    this.frames.push(frame);
    return frame;
  }

  /** 現在のフレームをポップする */
  private popFrame(): void {
    this.frames.pop();
  }

  /** 現在のフレームを取得する */
  private currentFrame(): CallFrame {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) throw new Error('実行エラー: フレームスタックが空です');
    return frame;
  }

  /** ステップ情報を記録する */
  private recordStep(instruction: string): void {
    const frame = this.currentFrame();
    const locals: Record<string, string> = {};
    for (const [k, v] of frame.locals) {
      locals[k] = v.inspect();
    }

    this.steps.push({
      instruction,
      stack: this.stack.map(o => o.inspect()),
      locals,
      output: null,
    });
  }

  /** 現在のスタックの状態を取得する（外部からのデバッグ用） */
  getStackState(): string[] {
    return this.stack.map(o => o.inspect());
  }

  /** 出力を取得する */
  getOutput(): string {
    return this.output.join('');
  }
}
