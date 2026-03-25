// SQL入力コンポーネント
export class SqlInput {
  private textarea: HTMLTextAreaElement;
  private onExecute: (sql: string) => void;

  constructor(container: HTMLElement, onExecute: (sql: string) => void) {
    this.onExecute = onExecute;

    this.textarea = document.createElement("textarea");
    this.textarea.placeholder = "SQLを入力... (Ctrl+Enter で実行)";
    this.textarea.rows = 5;
    this.textarea.style.cssText = "width:100%;font-family:monospace;font-size:14px;padding:8px;border:1px solid #ccc;border-radius:4px;resize:vertical;";

    this.textarea.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        this.execute();
      }
    });

    const button = document.createElement("button");
    button.textContent = "実行 (Ctrl+Enter)";
    button.style.cssText = "margin-top:4px;padding:6px 16px;cursor:pointer;background:#2563eb;color:white;border:none;border-radius:4px;font-size:14px;";
    button.addEventListener("click", () => this.execute());

    container.appendChild(this.textarea);
    container.appendChild(button);
  }

  private execute(): void {
    const sql = this.textarea.value.trim();
    if (sql) {
      this.onExecute(sql);
    }
  }

  setValue(sql: string): void {
    this.textarea.value = sql;
  }
}
