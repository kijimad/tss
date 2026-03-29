// ブラウザUI: Rubyコードエディタ、トークン表示、AST表示、バイトコード逆アセンブリ、VM実行ステッパー

import { Lexer } from '../lang/lexer.js';
import { Parser } from '../lang/parser.js';
import type { ASTNode } from '../lang/parser.js';
import { Compiler, disassemble } from '../vm/compiler.js';
import { VM } from '../vm/vm.js';

/** サンプルコード一覧 */
const EXAMPLES: { name: string; code: string }[] = [
  {
    name: "Hello World",
    code: `puts "Hello, Ruby!"`,
  },
  {
    name: "変数と演算",
    code: `x = 10
y = 20
puts x + y`,
  },
  {
    name: "if/elsif/else",
    code: `score = 85
if score >= 90
  puts "優"
elsif score >= 70
  puts "良"
else
  puts "可"
end`,
  },
  {
    name: "while ループ",
    code: `i = 0
while i < 5
  puts i
  i = i + 1
end`,
  },
  {
    name: "メソッド定義",
    code: `def greet(name)
  puts "Hello, " + name
end

greet("Ruby")
greet("World")`,
  },
  {
    name: "再帰 (階乗)",
    code: `def factorial(n)
  if n <= 1
    1
  else
    n * factorial(n - 1)
  end
end

puts factorial(5)
puts factorial(10)`,
  },
  {
    name: "配列操作",
    code: `arr = [1, 2, 3, 4, 5]
arr.push(6)
arr.each do |x|
  puts x
end`,
  },
  {
    name: "ブロック (times/each/map)",
    code: `5.times do |i|
  puts i
end`,
  },
  {
    name: "クラス定義",
    code: `class Dog
  def initialize(name)
    @name = name
  end

  def bark
    puts @name + " says Woof!"
  end
end

dog = Dog.new("Pochi")
dog.bark`,
  },
  {
    name: "文字列操作",
    code: `name = "Ruby"
puts name.length
puts name.upcase
puts "Hello, #{name}!"`,
  },
];

/** ASTノードを文字列表現に変換する */
function astToString(node: ASTNode, indent: number = 0): string {
  const pad = '  '.repeat(indent);

  switch (node.kind) {
    case 'program':
      return node.body.map(n => astToString(n, indent)).join('\n');
    case 'class_def':
      return `${pad}ClassDef: ${node.name}${node.superclass ? ` < ${node.superclass}` : ''}\n${node.body.map(n => astToString(n, indent + 1)).join('\n')}`;
    case 'method_def':
      return `${pad}MethodDef: ${node.name}(${node.params.join(', ')})\n${node.body.map(n => astToString(n, indent + 1)).join('\n')}`;
    case 'if':
      return `${pad}If:\n${pad}  cond: ${astToString(node.condition, 0)}\n${pad}  then:\n${node.then.map(n => astToString(n, indent + 2)).join('\n')}${node.elseBody ? `\n${pad}  else:\n${node.elseBody.map(n => astToString(n, indent + 2)).join('\n')}` : ''}`;
    case 'while':
      return `${pad}While:\n${pad}  cond: ${astToString(node.condition, 0)}\n${node.body.map(n => astToString(n, indent + 1)).join('\n')}`;
    case 'assign':
      return `${pad}Assign: ${node.name} = ${astToString(node.value, 0)}`;
    case 'method_call':
      return `${pad}Call: ${node.receiver ? astToString(node.receiver, 0) + '.' : ''}${node.name}(${node.args.map(a => astToString(a, 0)).join(', ')})`;
    case 'binary_op':
      return `${pad}BinOp: ${astToString(node.left, 0)} ${node.op} ${astToString(node.right, 0)}`;
    case 'unary_op':
      return `${pad}UnaryOp: ${node.op}${astToString(node.operand, 0)}`;
    case 'number':
      return `${pad}Num(${node.value})`;
    case 'string':
      return `${pad}Str("${node.value}")`;
    case 'string_interp':
      return `${pad}StrInterp(${node.parts.map(p => astToString(p, 0)).join(' + ')})`;
    case 'symbol':
      return `${pad}Sym(:${node.name})`;
    case 'array':
      return `${pad}Array[${node.elements.map(e => astToString(e, 0)).join(', ')}]`;
    case 'hash':
      return `${pad}Hash{${node.pairs.map(p => `${astToString(p.key, 0)} => ${astToString(p.value, 0)}`).join(', ')}}`;
    case 'ident':
      return `${pad}Ident(${node.name})`;
    case 'self':
      return `${pad}Self`;
    case 'nil':
      return `${pad}Nil`;
    case 'bool':
      return `${pad}Bool(${node.value})`;
    case 'return':
      return `${pad}Return${node.value ? ': ' + astToString(node.value, 0) : ''}`;
    case 'yield':
      return `${pad}Yield(${node.args.map(a => astToString(a, 0)).join(', ')})`;
    case 'block':
      return `${pad}Block(|${node.params.join(', ')}|)\n${node.body.map(n => astToString(n, indent + 1)).join('\n')}`;
  }
}

/** Ruby VMシミュレータのUIアプリケーション */
export class RubyApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Ruby VM (YARV) Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e74c3c;";
    header.appendChild(title);

    // サンプルコード選択
    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    // ステップ実行ボタン
    const stepBtn = document.createElement("button");
    stepBtn.textContent = "Step";
    stepBtn.style.cssText = "padding:4px 16px;background:#334155;color:#e2e8f0;border:1px solid #475569;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(stepBtn);

    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: コードエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e74c3c;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "Ruby";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    codeArea.value = EXAMPLES[0]?.code ?? "";
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右パネル: 出力エリア（4セクション）
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // トークン表示
    const tokensLabel = document.createElement("div");
    tokensLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    tokensLabel.textContent = "Tokens";
    rightPanel.appendChild(tokensLabel);

    const tokensDiv = document.createElement("div");
    tokensDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(tokensDiv);

    // AST表示
    const astLabel = document.createElement("div");
    astLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    astLabel.textContent = "AST";
    rightPanel.appendChild(astLabel);

    const astDiv = document.createElement("div");
    astDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(astDiv);

    // バイトコード表示
    const bytecodeLabel = document.createElement("div");
    bytecodeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#8b5cf6;border-bottom:1px solid #1e293b;";
    bytecodeLabel.textContent = "Bytecode";
    rightPanel.appendChild(bytecodeLabel);

    const bytecodeDiv = document.createElement("div");
    bytecodeDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(bytecodeDiv);

    // 実行結果 + VMステップ表示
    const execLabel = document.createElement("div");
    execLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    execLabel.textContent = "Output";
    rightPanel.appendChild(execLabel);

    const execDiv = document.createElement("div");
    execDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;white-space:pre-wrap;";
    rightPanel.appendChild(execDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // サンプル選択イベント
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) codeArea.value = ex.code;
    });

    // 実行処理
    const executeCode = (withSteps: boolean) => {
      tokensDiv.innerHTML = "";
      astDiv.innerHTML = "";
      bytecodeDiv.innerHTML = "";
      execDiv.innerHTML = "";

      try {
        const source = codeArea.value;

        // レキサー: ソースコードをトークン列に変換
        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();
        const tokenText = tokens
          .filter(t => t.type !== "EOF")
          .map(t => `${t.type}: ${JSON.stringify(t.value)}`)
          .join("\n");
        const tokenEl = document.createElement("span");
        tokenEl.style.color = "#e2e8f0";
        tokenEl.textContent = tokenText;
        tokensDiv.appendChild(tokenEl);

        // パーサー: トークン列をASTに変換
        const parser = new Parser(tokens);
        const ast = parser.parse();
        const astEl = document.createElement("span");
        astEl.style.color = "#e2e8f0";
        astEl.textContent = astToString(ast);
        astDiv.appendChild(astEl);

        // コンパイラ: ASTをYARVバイトコードに変換
        const compiler = new Compiler();
        const mainIseq = compiler.compile(ast);
        const blockSequences = compiler.getBlockSequences();
        const bytecodeEl = document.createElement("span");
        bytecodeEl.style.color = "#e2e8f0";
        bytecodeEl.textContent = disassemble(mainIseq, blockSequences);
        bytecodeDiv.appendChild(bytecodeEl);

        // VM実行
        const vm = new VM();
        const result = vm.execute(mainIseq, blockSequences, { recordSteps: withSteps });

        // 実行結果の表示
        if (result.output) {
          const outEl = document.createElement("span");
          outEl.style.color = "#e2e8f0";
          outEl.textContent = result.output;
          execDiv.appendChild(outEl);
        } else {
          const emptyEl = document.createElement("span");
          emptyEl.style.color = "#64748b";
          emptyEl.textContent = "(出力なし)";
          execDiv.appendChild(emptyEl);
        }

        // VMステップ情報の表示
        if (withSteps && result.steps.length > 0) {
          const stepsEl = document.createElement("div");
          stepsEl.style.cssText = "color:#f59e0b;margin-top:8px;font-size:10px;border-top:1px solid #1e293b;padding-top:4px;";
          stepsEl.textContent = result.steps
            .map((s, i) =>
              `#${i + 1} ${s.instruction}\n  スタック: [${s.stack.join(', ')}]\n  ローカル: ${JSON.stringify(s.locals)}`
            )
            .join("\n\n");
          execDiv.appendChild(stepsEl);
        }
      } catch (err) {
        // エラー表示
        const errEl = document.createElement("div");
        errEl.style.cssText = "color:#f87171;margin-top:4px;";
        errEl.textContent = `エラー: ${err instanceof Error ? err.message : String(err)}`;
        execDiv.appendChild(errEl);
      }
    };

    // ボタンイベント
    runBtn.addEventListener("click", () => executeCode(false));
    stepBtn.addEventListener("click", () => executeCode(true));

    // 初回実行
    runBtn.click();
  }
}

/** UIアプリケーションを初期化する（後方互換性のため維持） */
export function initApp(): void {
  const container = document.getElementById("app");
  if (!container) return;
  const app = new RubyApp();
  app.init(container);
}
