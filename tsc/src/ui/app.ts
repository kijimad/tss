import { transpileWithCheck } from "../transpile.js";

export class TscApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:12px 20px;background:#1e293b;color:#f8fafc;font-size:16px;font-weight:600;";
    header.textContent = "TypeScript Transpiler";
    container.appendChild(header);

    // エディタ領域
    const editors = document.createElement("div");
    editors.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: TypeScript 入力
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #e5e7eb;";

    const leftLabel = document.createElement("div");
    leftLabel.style.cssText = "padding:6px 12px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:600;";
    leftLabel.textContent = "TypeScript (input)";
    leftPanel.appendChild(leftLabel);

    const tsInput = document.createElement("textarea");
    tsInput.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;border:none;outline:none;resize:none;background:#fafafa;tab-size:2;";
    tsInput.value = SAMPLE_CODE;
    tsInput.spellcheck = false;
    leftPanel.appendChild(tsInput);

    editors.appendChild(leftPanel);

    // 右: JavaScript 出力
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    const rightLabel = document.createElement("div");
    rightLabel.style.cssText = "padding:6px 12px;background:#d1fae5;color:#065f46;font-size:12px;font-weight:600;";
    rightLabel.textContent = "JavaScript (output)";
    rightPanel.appendChild(rightLabel);

    const jsOutput = document.createElement("textarea");
    jsOutput.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;border:none;outline:none;resize:none;background:#f0fdf4;tab-size:2;";
    jsOutput.readOnly = true;
    rightPanel.appendChild(jsOutput);

    editors.appendChild(rightPanel);
    container.appendChild(editors);

    // エラー表示
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "padding:8px 12px;font-size:12px;font-family:monospace;min-height:28px;max-height:120px;overflow-y:auto;background:#f8fafc;border-top:1px solid #e5e7eb;";
    container.appendChild(errorDiv);

    // リアルタイムトランスパイル + 型チェック
    const doTranspile = () => {
      try {
        const { output, errors } = transpileWithCheck(tsInput.value);
        jsOutput.value = output;
        errorDiv.innerHTML = "";

        if (errors.length > 0) {
          // 型エラーを表示（赤）
          for (const err of errors) {
            const line = document.createElement("div");
            line.style.cssText = "color:#dc2626;padding:1px 0;";
            line.textContent = `\u274C ${err.message}`;
            errorDiv.appendChild(line);
          }
        } else {
          const ok = document.createElement("div");
          ok.style.cssText = "color:#059669;";
          ok.textContent = "\u2705 型エラーなし";
          errorDiv.appendChild(ok);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errorDiv.innerHTML = "";
        const line = document.createElement("div");
        line.style.cssText = "color:#dc2626;";
        line.textContent = msg;
        errorDiv.appendChild(line);
      }
    };

    tsInput.addEventListener("input", doTranspile);
    doTranspile();
  }
}

const SAMPLE_CODE = `// TypeScript のコードを入力すると、リアルタイムで JavaScript に変換されます

interface User {
  id: number;
  name: string;
  email: string;
}

type ID = number | string;

enum Status {
  Active,
  Inactive,
  Deleted
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}

const getStatus = (code: number): Status => {
  return code as Status;
};

class UserService {
  constructor(private apiUrl: string) {}

  async fetchUser(id: number): Promise<User> {
    const response = await fetch(\`\${this.apiUrl}/users/\${id}\`);
    return response.json();
  }

  getDisplayName(user: User): string {
    return user.name ?? 'Anonymous';
  }
}

export { UserService, greet };
`;
