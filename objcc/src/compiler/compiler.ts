import type { CompileResult, CompileStep } from "./types.js";
import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { generateObjectFile } from "./codegen.js";

/** ソースコード→オブジェクトファイルへのフルコンパイル */
export function compile(source: string, filename: string = "main.o"): CompileResult {
  const steps: CompileStep[] = [];
  const errors: string[] = [];

  // フェーズ1: 字句解析
  steps.push({ phase: "lex", description: "字句解析（レキサー）開始" });
  const tokens = tokenize(source);
  steps.push({
    phase: "lex",
    description: `字句解析完了: ${tokens.length} トークン`,
    detail: tokens
      .filter((t) => t.kind !== "eof")
      .map((t) => `${t.kind}(${t.value})`)
      .join(", "),
  });

  // フェーズ2: 構文解析
  steps.push({ phase: "parse", description: "構文解析（パーサー）開始" });
  const { ast, errors: parseErrors } = parse(tokens);
  errors.push(...parseErrors);

  if (parseErrors.length > 0) {
    steps.push({
      phase: "parse",
      description: `構文解析でエラー: ${parseErrors.length}件`,
      detail: parseErrors.join("\n"),
    });
    return { success: false, errors, tokens, ast, objectFile: null, steps };
  }

  const funcCount = ast.children.length;
  steps.push({
    phase: "parse",
    description: `構文解析完了: ${funcCount} 関数`,
    detail: ast.children.map((f) => f.name).join(", "),
  });

  // フェーズ3: コード生成→オブジェクトファイル
  steps.push({ phase: "codegen", description: "コード生成開始" });
  const { objectFile, steps: codegenSteps } = generateObjectFile(ast, filename);
  steps.push(...codegenSteps);

  return { success: true, errors, tokens, ast, objectFile, steps };
}
