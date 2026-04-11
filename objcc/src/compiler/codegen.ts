import type {
  AstNode,
  Section,
  SymbolEntry,
  RelocationEntry,
  ObjectFile,
  CompileStep,
} from "./types.js";

/** 擬似命令セット（独自16ビット命令、可視化用） */
const OP = {
  NOP:   0x00,
  PUSH:  0x01, // PUSH imm32
  POP:   0x02,
  LOAD:  0x03, // LOAD [rbp+offset]
  STORE: 0x04, // STORE [rbp+offset]
  ADD:   0x10,
  SUB:   0x11,
  MUL:   0x12,
  DIV:   0x13,
  MOD:   0x14,
  NEG:   0x15,
  NOT:   0x16,
  CMP:   0x20,
  JMP:   0x21,
  JE:    0x22,
  JNE:   0x23,
  JL:    0x24,
  JLE:   0x25,
  JG:    0x26,
  JGE:   0x27,
  CALL:  0x30,
  RET:   0x31,
  ENTER: 0x32, // 関数プロローグ
  LEAVE: 0x33, // 関数エピローグ
  AND:   0x34,
  OR:    0x35,
  LEA:   0x36, // アドレスロード
  LOAD_GLOBAL: 0x37,
  STORE_GLOBAL: 0x38,
} as const;

/** コード生成コンテキスト */
interface CodegenContext {
  textData: number[];
  dataSection: number[];
  rodataSection: number[];
  bssSize: number;
  symbols: SymbolEntry[];
  relocations: RelocationEntry[];
  steps: CompileStep[];
  /** ローカル変数名→スタックオフセットマッピング */
  locals: Map<string, number>;
  localOffset: number;
  /** 文字列リテラル定数プール */
  stringPool: Map<string, number>;
  stringCounter: number;
  /** グローバル変数 */
  globals: Set<string>;
}

/** AST→オブジェクトファイル生成 */
export function generateObjectFile(
  ast: AstNode,
  filename: string
): { objectFile: ObjectFile; steps: CompileStep[] } {
  const ctx: CodegenContext = {
    textData: [],
    dataSection: [],
    rodataSection: [],
    bssSize: 0,
    symbols: [],
    relocations: [],
    steps: [],
    locals: new Map(),
    localOffset: 0,
    stringPool: new Map(),
    stringCounter: 0,
    globals: new Set(),
  };

  // グローバル変数を先に収集（トップレベルvar_declは今はないが拡張用）
  genProgram(ctx, ast);

  const sections: Section[] = [
    { name: ".text", data: [...ctx.textData], alignment: 4, flags: ["ALLOC", "EXEC"] },
    { name: ".data", data: [...ctx.dataSection], alignment: 4, flags: ["ALLOC", "WRITE"] },
    { name: ".rodata", data: [...ctx.rodataSection], alignment: 1, flags: ["ALLOC"] },
  ];
  if (ctx.bssSize > 0) {
    sections.push({ name: ".bss", data: new Array(ctx.bssSize).fill(0), alignment: 4, flags: ["ALLOC", "WRITE"] });
  }

  const objectFile: ObjectFile = { filename, sections, symbols: ctx.symbols, relocations: ctx.relocations };

  ctx.steps.push({
    phase: "object",
    description: `オブジェクトファイル生成完了: ${filename}`,
    detail: `セクション数=${sections.length}, シンボル数=${ctx.symbols.length}, リロケーション数=${ctx.relocations.length}`,
  });

  return { objectFile, steps: ctx.steps };
}

/** プログラム全体を処理 */
function genProgram(ctx: CodegenContext, node: AstNode): void {
  for (const child of node.children) {
    if (child.kind === "func_decl") {
      genFuncDecl(ctx, child);
    }
  }
}

/** 関数宣言のコード生成 */
function genFuncDecl(ctx: CodegenContext, node: AstNode): void {
  const name = node.name!;
  const funcOffset = ctx.textData.length;

  ctx.steps.push({
    phase: "codegen",
    description: `関数 ${name} のコード生成開始 (.text offset=0x${funcOffset.toString(16)})`,
  });

  // シンボル登録
  ctx.symbols.push({
    name,
    type: "function",
    bind: "global",
    section: ".text",
    offset: funcOffset,
    size: 0, // 後で更新
  });

  // ローカル変数環境をリセット
  ctx.locals = new Map();
  ctx.localOffset = 0;

  // パラメータを登録（children[0]がパラメータリストのblock）
  const paramsBlock = node.children[0]!;
  for (const param of paramsBlock.children) {
    ctx.localOffset += 4;
    ctx.locals.set(param.name!, ctx.localOffset);
    ctx.steps.push({
      phase: "codegen",
      description: `  パラメータ "${param.name}" → [rbp+${ctx.localOffset}]`,
    });
  }

  // ENTER命令（プロローグ）
  emit(ctx, OP.ENTER);

  // 関数本体
  const body = node.children[1]!;
  genBlock(ctx, body);

  // 暗黙のreturn 0
  emit(ctx, OP.PUSH);
  emitImm32(ctx, 0);
  emit(ctx, OP.LEAVE);
  emit(ctx, OP.RET);

  // シンボルサイズを更新
  const sym = ctx.symbols.find((s) => s.name === name && s.section === ".text");
  if (sym) sym.size = ctx.textData.length - funcOffset;

  ctx.steps.push({
    phase: "codegen",
    description: `関数 ${name} 完了: ${ctx.textData.length - funcOffset} バイト`,
  });
}

/** ブロック（文のリスト）を処理 */
function genBlock(ctx: CodegenContext, node: AstNode): void {
  for (const stmt of node.children) {
    genStmt(ctx, stmt);
  }
}

/** 文のコード生成 */
function genStmt(ctx: CodegenContext, node: AstNode): void {
  switch (node.kind) {
    case "var_decl": return genVarDecl(ctx, node);
    case "return_stmt": return genReturn(ctx, node);
    case "if_stmt": return genIf(ctx, node);
    case "while_stmt": return genWhile(ctx, node);
    case "for_stmt": return genFor(ctx, node);
    case "block": return genBlock(ctx, node);
    case "expr_stmt": return genExpr(ctx, node.children[0]!);
    case "assign_stmt": return genAssign(ctx, node);
    default:
      genExpr(ctx, node);
  }
}

/** 変数宣言 */
function genVarDecl(ctx: CodegenContext, node: AstNode): void {
  ctx.localOffset += 4;
  ctx.locals.set(node.name!, ctx.localOffset);

  ctx.steps.push({
    phase: "codegen",
    description: `  変数宣言 "${node.name}" → [rbp+${ctx.localOffset}]`,
  });

  if (node.children.length > 0) {
    // 初期化式
    genExpr(ctx, node.children[0]!);
    emit(ctx, OP.STORE);
    emitImm32(ctx, ctx.localOffset);
  }
}

/** return文 */
function genReturn(ctx: CodegenContext, node: AstNode): void {
  genExpr(ctx, node.children[0]!);
  emit(ctx, OP.LEAVE);
  emit(ctx, OP.RET);
}

/** if文 */
function genIf(ctx: CodegenContext, node: AstNode): void {
  genExpr(ctx, node.children[0]!); // 条件
  emit(ctx, OP.PUSH); emitImm32(ctx, 0);
  emit(ctx, OP.CMP);
  const jeOffset = ctx.textData.length;
  emit(ctx, OP.JE); emitImm32(ctx, 0); // パッチ対象

  genStmt(ctx, node.children[1]!); // then

  if (node.children[2]) {
    const jmpOffset = ctx.textData.length;
    emit(ctx, OP.JMP); emitImm32(ctx, 0); // パッチ対象
    // JEのジャンプ先をここに設定
    patchImm32(ctx, jeOffset + 1, ctx.textData.length);
    genStmt(ctx, node.children[2]); // else
    // JMPのジャンプ先をここに設定
    patchImm32(ctx, jmpOffset + 1, ctx.textData.length);
  } else {
    patchImm32(ctx, jeOffset + 1, ctx.textData.length);
  }
}

/** while文 */
function genWhile(ctx: CodegenContext, node: AstNode): void {
  const loopTop = ctx.textData.length;
  genExpr(ctx, node.children[0]!); // 条件
  emit(ctx, OP.PUSH); emitImm32(ctx, 0);
  emit(ctx, OP.CMP);
  const jeOffset = ctx.textData.length;
  emit(ctx, OP.JE); emitImm32(ctx, 0);

  genStmt(ctx, node.children[1]!); // 本体
  emit(ctx, OP.JMP); emitImm32(ctx, loopTop);
  patchImm32(ctx, jeOffset + 1, ctx.textData.length);
}

/** for文 */
function genFor(ctx: CodegenContext, node: AstNode): void {
  genStmt(ctx, node.children[0]!); // init
  const loopTop = ctx.textData.length;
  genExpr(ctx, node.children[1]!); // 条件
  emit(ctx, OP.PUSH); emitImm32(ctx, 0);
  emit(ctx, OP.CMP);
  const jeOffset = ctx.textData.length;
  emit(ctx, OP.JE); emitImm32(ctx, 0);

  genStmt(ctx, node.children[3]!); // 本体
  genExpr(ctx, node.children[2]!); // update
  emit(ctx, OP.JMP); emitImm32(ctx, loopTop);
  patchImm32(ctx, jeOffset + 1, ctx.textData.length);
}

/** 代入 */
function genAssign(ctx: CodegenContext, node: AstNode): void {
  const left = node.children[0]!;
  genExpr(ctx, node.children[1]!);

  if (left.kind === "ident_expr") {
    const offset = ctx.locals.get(left.name!);
    if (offset !== undefined) {
      emit(ctx, OP.STORE);
      emitImm32(ctx, offset);
    } else {
      // グローバル変数
      emit(ctx, OP.STORE_GLOBAL);
      addRelocation(ctx, ".text", ctx.textData.length, "R_ABS32", left.name!, 0);
      emitImm32(ctx, 0);
    }
  } else if (left.kind === "deref") {
    // ポインタ経由の書き込み（簡略化）
    emit(ctx, OP.STORE);
    emitImm32(ctx, 0);
  }
}

/** 式のコード生成（値をスタックトップに残す） */
function genExpr(ctx: CodegenContext, node: AstNode): void {
  switch (node.kind) {
    case "number_lit":
      emit(ctx, OP.PUSH);
      emitImm32(ctx, node.value!);
      return;

    case "string_lit": {
      // .rodataに文字列を配置
      const strValue = node.strValue!;
      let rodataOffset = ctx.stringPool.get(strValue);
      if (rodataOffset === undefined) {
        rodataOffset = ctx.rodataSection.length;
        ctx.stringPool.set(strValue, rodataOffset);
        const symName = `.LC${ctx.stringCounter++}`;
        ctx.symbols.push({
          name: symName,
          type: "string_lit",
          bind: "local",
          section: ".rodata",
          offset: rodataOffset,
          size: strValue.length + 1,
        });
        // 文字列データを.rodataに書き込み
        for (let i = 0; i < strValue.length; i++) {
          ctx.rodataSection.push(strValue.charCodeAt(i) & 0xFF);
        }
        ctx.rodataSection.push(0); // NULL終端

        ctx.steps.push({
          phase: "codegen",
          description: `  文字列 "${strValue.replace(/\n/g, "\\n")}" → .rodata offset=0x${rodataOffset.toString(16)} (${symName})`,
        });
      }
      // 文字列のアドレスをプッシュ（リロケーション）
      emit(ctx, OP.LEA);
      addRelocation(ctx, ".text", ctx.textData.length, "R_DATA_ADDR", `.LC${ctx.stringCounter - 1}`, 0);
      emitImm32(ctx, 0);
      return;
    }

    case "ident_expr": {
      const offset = ctx.locals.get(node.name!);
      if (offset !== undefined) {
        emit(ctx, OP.LOAD);
        emitImm32(ctx, offset);
      } else {
        // 外部シンボルまたはグローバル
        emit(ctx, OP.LOAD_GLOBAL);
        addRelocation(ctx, ".text", ctx.textData.length, "R_ABS32", node.name!, 0);
        emitImm32(ctx, 0);
      }
      return;
    }

    case "binary_expr":
      genExpr(ctx, node.children[0]!);
      genExpr(ctx, node.children[1]!);
      switch (node.op) {
        case "+": emit(ctx, OP.ADD); break;
        case "-": emit(ctx, OP.SUB); break;
        case "*": emit(ctx, OP.MUL); break;
        case "/": emit(ctx, OP.DIV); break;
        case "%": emit(ctx, OP.MOD); break;
        case "==": emit(ctx, OP.CMP); emit(ctx, OP.JE); emitImm32(ctx, 0); break;
        case "!=": emit(ctx, OP.CMP); emit(ctx, OP.JNE); emitImm32(ctx, 0); break;
        case "<": emit(ctx, OP.CMP); emit(ctx, OP.JL); emitImm32(ctx, 0); break;
        case "<=": emit(ctx, OP.CMP); emit(ctx, OP.JLE); emitImm32(ctx, 0); break;
        case ">": emit(ctx, OP.CMP); emit(ctx, OP.JG); emitImm32(ctx, 0); break;
        case ">=": emit(ctx, OP.CMP); emit(ctx, OP.JGE); emitImm32(ctx, 0); break;
        case "&&": emit(ctx, OP.AND); break;
        case "||": emit(ctx, OP.OR); break;
      }
      return;

    case "unary_expr":
      genExpr(ctx, node.children[0]!);
      if (node.op === "-") emit(ctx, OP.NEG);
      else if (node.op === "!") emit(ctx, OP.NOT);
      return;

    case "call_expr": {
      // 引数を逆順プッシュ
      for (let i = node.children.length - 1; i >= 0; i--) {
        genExpr(ctx, node.children[i]!);
      }
      emit(ctx, OP.CALL);
      addRelocation(ctx, ".text", ctx.textData.length, "R_REL32", node.name!, 0);
      emitImm32(ctx, 0);
      return;
    }

    case "addr_of":
      if (node.children[0]?.kind === "ident_expr") {
        const offset = ctx.locals.get(node.children[0].name!);
        if (offset !== undefined) {
          emit(ctx, OP.LEA);
          emitImm32(ctx, offset);
        }
      }
      return;

    case "deref":
      genExpr(ctx, node.children[0]!);
      emit(ctx, OP.LOAD);
      emitImm32(ctx, 0);
      return;

    case "assign_stmt":
      genAssign(ctx, node);
      return;

    default:
      // 未対応ノードはNOP
      emit(ctx, OP.NOP);
  }
}

// === ヘルパー ===

function emit(ctx: CodegenContext, byte: number): void {
  ctx.textData.push(byte & 0xFF);
}

function emitImm32(ctx: CodegenContext, value: number): void {
  ctx.textData.push(value & 0xFF);
  ctx.textData.push((value >> 8) & 0xFF);
  ctx.textData.push((value >> 16) & 0xFF);
  ctx.textData.push((value >> 24) & 0xFF);
}

function patchImm32(ctx: CodegenContext, offset: number, value: number): void {
  ctx.textData[offset] = value & 0xFF;
  ctx.textData[offset + 1] = (value >> 8) & 0xFF;
  ctx.textData[offset + 2] = (value >> 16) & 0xFF;
  ctx.textData[offset + 3] = (value >> 24) & 0xFF;
}

function addRelocation(
  ctx: CodegenContext,
  section: string,
  offset: number,
  type: RelocationEntry["type"],
  symbol: string,
  addend: number
): void {
  ctx.relocations.push({ section, offset, type, symbol, addend });
  ctx.steps.push({
    phase: "codegen",
    description: `  リロケーション追加: ${type} @.text+0x${offset.toString(16)} → ${symbol}`,
  });
}
