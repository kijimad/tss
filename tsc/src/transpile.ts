/**
 * transpile.ts — TypeScript → JavaScript のエントリポイント
 *
 * tokenize → parse → emit の3ステップ。
 */
import { tokenize } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import { emit } from "./emitter/emitter.js";
import { TypeChecker, type TypeError } from "./checker/checker.js";

export function transpile(source: string): string {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return emit(ast);
}

export function transpileWithCheck(source: string): { output: string; errors: TypeError[] } {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const checker = new TypeChecker();
  const errors = checker.check(ast);
  const output = emit(ast);
  return { output, errors };
}
