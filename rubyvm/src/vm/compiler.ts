// YARVバイトコードコンパイラ: ASTをYARV命令列に変換する

import type { ASTNode, BlockNode } from '../lang/parser.js';

/** YARV命令の種類 */
export enum Opcode {
  PUTNIL = 'putnil',
  PUTOBJECT = 'putobject',
  PUTSELF = 'putself',
  PUTSTRING = 'putstring',
  PUTSYMBOL = 'putsymbol',
  SETLOCAL = 'setlocal',
  GETLOCAL = 'getlocal',
  SEND = 'send',
  LEAVE = 'leave',
  BRANCHIF = 'branchif',
  BRANCHUNLESS = 'branchunless',
  JUMP = 'jump',
  NEWARRAY = 'newarray',
  NEWHASH = 'newhash',
  DEFINEMETHOD = 'definemethod',
  DEFINECLASS = 'defineclass',
  POP = 'pop',
  DUP = 'dup',
  CONCAT = 'concat',
  TOSTRING = 'tostring',
  YIELD = 'yield',
  PUTBLOCK = 'putblock',
}

/** YARV命令 */
export interface Instruction {
  opcode: Opcode;
  operands: InstructionOperand[];
  /** デバッグ用の元の行番号 */
  line?: number;
}

/** 命令のオペランド型 */
export type InstructionOperand = string | number | boolean | null | BlockInfo;

/** ブロック情報 */
export interface BlockInfo {
  params: string[];
  startLabel: number;
  endLabel: number;
}

/** コンパイル結果の命令列 */
export interface InstructionSequence {
  name: string;
  instructions: Instruction[];
}

/** YARVバイトコードコンパイラ */
export class Compiler {
  private instructions: Instruction[] = [];
  private blockSequences: InstructionSequence[] = [];

  /** ASTを命令列にコンパイルする */
  compile(node: ASTNode): InstructionSequence {
    this.instructions = [];
    this.blockSequences = [];

    if (node.kind === 'program') {
      for (const stmt of node.body) {
        this.compileNode(stmt);
        // 各文の結果をスタックからポップ（最後の文以外）
        this.emit(Opcode.POP);
      }
      // 最後のPOPを取り消して、最後の式の値を残す
      if (this.instructions.length > 0 && this.instructions[this.instructions.length - 1]?.opcode === Opcode.POP) {
        this.instructions.pop();
      }
    } else {
      this.compileNode(node);
    }

    this.emit(Opcode.LEAVE);

    return {
      name: '<main>',
      instructions: this.instructions,
    };
  }

  /** コンパイル済みのブロック命令列を取得する */
  getBlockSequences(): InstructionSequence[] {
    return this.blockSequences;
  }

  /** ASTノードを命令にコンパイルする */
  private compileNode(node: ASTNode): void {
    switch (node.kind) {
      case 'program':
        for (const stmt of node.body) {
          this.compileNode(stmt);
          this.emit(Opcode.POP);
        }
        if (this.instructions.length > 0 && this.instructions[this.instructions.length - 1]?.opcode === Opcode.POP) {
          this.instructions.pop();
        }
        break;

      case 'number':
        this.emit(Opcode.PUTOBJECT, node.value);
        break;

      case 'string':
        this.emit(Opcode.PUTSTRING, node.value);
        break;

      case 'string_interp':
        // 文字列補間: 各パーツをコンパイルして連結する
        if (node.parts.length === 0) {
          this.emit(Opcode.PUTSTRING, '');
        } else {
          for (let i = 0; i < node.parts.length; i++) {
            const part = node.parts[i]!;
            this.compileNode(part);
            // 文字列でない部分はto_sで変換
            if (part.kind !== 'string') {
              this.emit(Opcode.TOSTRING);
            }
            // 2つ目以降は前の結果と連結
            if (i > 0) {
              this.emit(Opcode.CONCAT);
            }
          }
        }
        break;

      case 'symbol':
        this.emit(Opcode.PUTSYMBOL, node.name);
        break;

      case 'nil':
        this.emit(Opcode.PUTNIL);
        break;

      case 'bool':
        this.emit(Opcode.PUTOBJECT, node.value);
        break;

      case 'self':
        this.emit(Opcode.PUTSELF);
        break;

      case 'ident':
        this.emit(Opcode.GETLOCAL, node.name);
        break;

      case 'assign':
        this.compileNode(node.value);
        this.emit(Opcode.DUP); // 代入式は値を返すので複製
        this.emit(Opcode.SETLOCAL, node.name);
        break;

      case 'binary_op':
        this.compileBinaryOp(node);
        break;

      case 'unary_op':
        this.compileUnaryOp(node);
        break;

      case 'method_call':
        this.compileMethodCall(node);
        break;

      case 'if':
        this.compileIf(node);
        break;

      case 'while':
        this.compileWhile(node);
        break;

      case 'method_def':
        this.compileMethodDef(node);
        break;

      case 'class_def':
        this.compileClassDef(node);
        break;

      case 'return':
        if (node.value) {
          this.compileNode(node.value);
        } else {
          this.emit(Opcode.PUTNIL);
        }
        this.emit(Opcode.LEAVE);
        break;

      case 'yield':
        for (const arg of node.args) {
          this.compileNode(arg);
        }
        this.emit(Opcode.YIELD, node.args.length);
        break;

      case 'array':
        for (const el of node.elements) {
          this.compileNode(el);
        }
        this.emit(Opcode.NEWARRAY, node.elements.length);
        break;

      case 'hash':
        for (const pair of node.pairs) {
          this.compileNode(pair.key);
          this.compileNode(pair.value);
        }
        this.emit(Opcode.NEWHASH, node.pairs.length * 2);
        break;

      case 'block':
        // ブロック単体はコンパイルしない（method_callの一部として処理）
        this.emit(Opcode.PUTNIL);
        break;
    }
  }

  /** 二項演算をコンパイルする */
  private compileBinaryOp(node: { kind: 'binary_op'; op: string; left: ASTNode; right: ASTNode }): void {
    // 論理演算は短絡評価が必要
    if (node.op === '&&') {
      this.compileNode(node.left);
      this.emit(Opcode.DUP);
      const jumpLabel = this.instructions.length;
      this.emit(Opcode.BRANCHUNLESS, 0); // 後でパッチ
      this.emit(Opcode.POP);
      this.compileNode(node.right);
      this.patchJump(jumpLabel);
      return;
    }

    if (node.op === '||') {
      this.compileNode(node.left);
      this.emit(Opcode.DUP);
      const jumpLabel = this.instructions.length;
      this.emit(Opcode.BRANCHIF, 0); // 後でパッチ
      this.emit(Opcode.POP);
      this.compileNode(node.right);
      this.patchJump(jumpLabel);
      return;
    }

    // 通常の二項演算: メソッド呼び出しとして処理
    this.compileNode(node.left);
    this.compileNode(node.right);
    this.emit(Opcode.SEND, node.op, 1, null);
  }

  /** 単項演算をコンパイルする */
  private compileUnaryOp(node: { kind: 'unary_op'; op: string; operand: ASTNode }): void {
    if (node.op === '-') {
      // -x は 0 - x として処理
      this.emit(Opcode.PUTOBJECT, 0);
      this.compileNode(node.operand);
      this.emit(Opcode.SEND, '-', 1, null);
    } else if (node.op === '!') {
      this.compileNode(node.operand);
      this.emit(Opcode.SEND, '!', 0, null);
    }
  }

  /** メソッド呼び出しをコンパイルする */
  private compileMethodCall(node: {
    kind: 'method_call';
    receiver: ASTNode | null;
    name: string;
    args: ASTNode[];
    block: BlockNode | null;
  }): void {
    // レシーバを積む
    if (node.receiver) {
      this.compileNode(node.receiver);
    } else {
      this.emit(Opcode.PUTSELF);
    }

    // 引数を積む
    for (const arg of node.args) {
      this.compileNode(arg);
    }

    // ブロックをコンパイル
    let blockInfo: BlockInfo | null = null;
    if (node.block) {
      blockInfo = this.compileBlock(node.block);
    }

    this.emit(Opcode.SEND, node.name, node.args.length, blockInfo);
  }

  /** ブロックをコンパイルする */
  private compileBlock(block: BlockNode): BlockInfo {
    // ブロック本体の命令列を生成
    const savedInstructions = this.instructions;
    this.instructions = [];

    for (const stmt of block.body) {
      this.compileNode(stmt);
      this.emit(Opcode.POP);
    }
    // 最後のPOPを取り消す
    if (this.instructions.length > 0 && this.instructions[this.instructions.length - 1]?.opcode === Opcode.POP) {
      this.instructions.pop();
    }
    this.emit(Opcode.LEAVE);

    const blockInstructions = this.instructions;
    this.instructions = savedInstructions;

    const blockSeqIndex = this.blockSequences.length;
    this.blockSequences.push({
      name: `<block:${blockSeqIndex}>`,
      instructions: blockInstructions,
    });

    return {
      params: block.params,
      startLabel: blockSeqIndex,
      endLabel: blockSeqIndex,
    };
  }

  /** if/elsif/elseをコンパイルする */
  private compileIf(node: {
    kind: 'if';
    condition: ASTNode;
    then: ASTNode[];
    elsifClauses: { condition: ASTNode; body: ASTNode[] }[];
    elseBody: ASTNode[] | null;
  }): void {
    // 全分岐の終了後にジャンプするための位置を記録
    const endJumps: number[] = [];

    // if条件
    this.compileNode(node.condition);
    const ifFalseJump = this.instructions.length;
    this.emit(Opcode.BRANCHUNLESS, 0);

    // then本体
    this.compileBody(node.then);
    endJumps.push(this.instructions.length);
    this.emit(Opcode.JUMP, 0);

    // if条件が偽の場合のジャンプ先を設定
    this.patchJump(ifFalseJump);

    // elsif
    for (const elsif of node.elsifClauses) {
      this.compileNode(elsif.condition);
      const elsifFalseJump = this.instructions.length;
      this.emit(Opcode.BRANCHUNLESS, 0);
      this.compileBody(elsif.body);
      endJumps.push(this.instructions.length);
      this.emit(Opcode.JUMP, 0);
      this.patchJump(elsifFalseJump);
    }

    // else
    if (node.elseBody) {
      this.compileBody(node.elseBody);
    } else {
      this.emit(Opcode.PUTNIL);
    }

    // 全分岐の終了先を設定
    for (const jumpIdx of endJumps) {
      this.patchJump(jumpIdx);
    }
  }

  /** whileをコンパイルする */
  private compileWhile(node: { kind: 'while'; condition: ASTNode; body: ASTNode[] }): void {
    const loopStart = this.instructions.length;

    // 条件チェック
    this.compileNode(node.condition);
    const exitJump = this.instructions.length;
    this.emit(Opcode.BRANCHUNLESS, 0);

    // ループ本体
    for (const stmt of node.body) {
      this.compileNode(stmt);
      this.emit(Opcode.POP);
    }

    // ループ先頭にジャンプ
    this.emit(Opcode.JUMP, loopStart);

    // ループ脱出先
    this.patchJump(exitJump);
    this.emit(Opcode.PUTNIL); // whileの戻り値はnil
  }

  /** メソッド定義をコンパイルする */
  private compileMethodDef(node: {
    kind: 'method_def';
    name: string;
    params: string[];
    body: ASTNode[];
  }): void {
    // メソッド本体の命令列を別途生成
    const savedInstructions = this.instructions;
    this.instructions = [];

    for (const stmt of node.body) {
      this.compileNode(stmt);
      this.emit(Opcode.POP);
    }
    if (this.instructions.length > 0 && this.instructions[this.instructions.length - 1]?.opcode === Opcode.POP) {
      this.instructions.pop();
    }
    this.emit(Opcode.LEAVE);

    const methodInstructions = this.instructions;
    this.instructions = savedInstructions;

    const methodSeqIndex = this.blockSequences.length;
    this.blockSequences.push({
      name: `<method:${node.name}>`,
      instructions: methodInstructions,
    });

    this.emit(Opcode.DEFINEMETHOD, node.name, methodSeqIndex, JSON.stringify(node.params));
    this.emit(Opcode.PUTSYMBOL, node.name); // defの戻り値はメソッド名のシンボル
  }

  /** クラス定義をコンパイルする */
  private compileClassDef(node: {
    kind: 'class_def';
    name: string;
    superclass: string | null;
    body: ASTNode[];
  }): void {
    // クラス本体の命令列を別途生成
    const savedInstructions = this.instructions;
    this.instructions = [];

    for (const stmt of node.body) {
      this.compileNode(stmt);
      this.emit(Opcode.POP);
    }
    if (this.instructions.length > 0 && this.instructions[this.instructions.length - 1]?.opcode === Opcode.POP) {
      this.instructions.pop();
    }
    this.emit(Opcode.LEAVE);

    const classInstructions = this.instructions;
    this.instructions = savedInstructions;

    const classSeqIndex = this.blockSequences.length;
    this.blockSequences.push({
      name: `<class:${node.name}>`,
      instructions: classInstructions,
    });

    this.emit(Opcode.DEFINECLASS, node.name, classSeqIndex, node.superclass);
  }

  /** 文の列をコンパイルする */
  private compileBody(body: ASTNode[]): void {
    if (body.length === 0) {
      this.emit(Opcode.PUTNIL);
      return;
    }
    for (let i = 0; i < body.length; i++) {
      this.compileNode(body[i]!);
      if (i < body.length - 1) {
        this.emit(Opcode.POP);
      }
    }
  }

  /** 命令を発行する */
  private emit(opcode: Opcode, ...operands: InstructionOperand[]): void {
    this.instructions.push({ opcode, operands });
  }

  /** ジャンプ先を現在位置にパッチする */
  private patchJump(instructionIndex: number): void {
    const instr = this.instructions[instructionIndex];
    if (instr) {
      instr.operands[0] = this.instructions.length;
    }
  }
}

/** 命令列を人間が読める形式にディスアセンブルする */
export function disassemble(iseq: InstructionSequence, blockSequences?: InstructionSequence[]): string {
  const lines: string[] = [];
  lines.push(`== ${iseq.name} ==`);

  for (let i = 0; i < iseq.instructions.length; i++) {
    const instr = iseq.instructions[i]!;
    const operandStr = instr.operands
      .map(op => {
        if (op === null) return 'nil';
        if (typeof op === 'object') return `<block>`;
        if (typeof op === 'string') return JSON.stringify(op);
        return String(op);
      })
      .join(', ');
    lines.push(`${String(i).padStart(4, '0')} ${instr.opcode} ${operandStr}`);
  }

  // ブロック・メソッドの命令列も表示
  if (blockSequences) {
    for (const blockSeq of blockSequences) {
      lines.push('');
      lines.push(`== ${blockSeq.name} ==`);
      for (let i = 0; i < blockSeq.instructions.length; i++) {
        const instr = blockSeq.instructions[i]!;
        const operandStr = instr.operands
          .map(op => {
            if (op === null) return 'nil';
            if (typeof op === 'object') return `<block>`;
            if (typeof op === 'string') return JSON.stringify(op);
            return String(op);
          })
          .join(', ');
        lines.push(`${String(i).padStart(4, '0')} ${instr.opcode} ${operandStr}`);
      }
    }
  }

  return lines.join('\n');
}
