import { TestRunner, type RunnerEvent, type FileResult, type TestSuite, type TestCase } from "../runner/runner.js";

const SAMPLE_FILES: { path: string; code: string }[] = [
  { path: "math.test.js", code: `describe("Math", function() {
  it("addition", function() {
    expect(1 + 2).toBe(3);
    expect(10 + 20).toBe(30);
  });

  it("subtraction", function() {
    expect(10 - 3).toBe(7);
  });

  it("multiplication", function() {
    expect(6 * 7).toBe(42);
  });

  it("division", function() {
    expect(10 / 2).toBe(5);
    expect(1 / 3).toBeCloseTo(0.333, 2);
  });
});` },
  { path: "string.test.js", code: `describe("String", function() {
  it("length", function() {
    expect("hello").toHaveLength(5);
    expect("").toHaveLength(0);
  });

  it("contains", function() {
    expect("hello world").toContain("world");
    expect("hello").not.toContain("xyz");
  });

  it("match regex", function() {
    expect("test-123").toMatch(/\\d+/);
    expect("abc").not.toMatch(/\\d+/);
  });
});` },
  { path: "array.test.js", code: `describe("Array", function() {
  it("length", function() {
    expect([1, 2, 3]).toHaveLength(3);
  });

  it("contains", function() {
    expect([1, 2, 3]).toContain(2);
    expect([1, 2, 3]).not.toContain(4);
  });

  it("deep equal", function() {
    expect([1, [2, 3]]).toEqual([1, [2, 3]]);
  });
});` },
  { path: "object.test.js", code: `describe("Object", function() {
  it("deep equality", function() {
    var user = { name: "Alice", age: 30 };
    expect(user).toEqual({ name: "Alice", age: 30 });
  });

  it("not equal with different values", function() {
    expect({ a: 1 }).not.toEqual({ a: 2 });
  });

  it("nested objects", function() {
    var data = { user: { name: "Bob", scores: [90, 85] } };
    expect(data).toEqual({ user: { name: "Bob", scores: [90, 85] } });
  });
});` },
  { path: "failing.test.js", code: `describe("Failing tests", function() {
  it("this should pass", function() {
    expect(1 + 1).toBe(2);
  });

  it("this should fail", function() {
    expect(1 + 1).toBe(3);
  });

  it("this should also fail", function() {
    expect("hello").toContain("xyz");
  });

  it("type checks", function() {
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(42).toBeDefined();
  });
});` },
  { path: "hooks.test.js", code: `describe("Hooks", function() {
  var items = [];

  beforeEach(function() {
    items = [];
  });

  it("starts empty", function() {
    expect(items).toHaveLength(0);
  });

  it("can add items", function() {
    items.push("a");
    items.push("b");
    expect(items).toHaveLength(2);
    expect(items).toContain("a");
  });

  it("is reset by beforeEach", function() {
    expect(items).toHaveLength(0);
  });
});` },
  { path: "exceptions.test.js", code: `describe("Exceptions", function() {
  it("toThrow catches errors", function() {
    expect(function() { throw new Error("boom"); }).toThrow("boom");
  });

  it("toThrow with no argument", function() {
    expect(function() { throw new Error(); }).toThrow();
  });

  it("no throw does not match", function() {
    expect(function() {}).not.toThrow();
  });
});` },
];

// サンプルコード例（セレクトボックスからプリセットを選択可能）
export const EXAMPLES: { label: string; files: { path: string; code: string }[] }[] = [
  {
    label: "基本的なテスト",
    files: [
      { path: "basic.test.js", code: `describe("基本的なテスト", function() {
  it("数値の等値チェック", function() {
    expect(1 + 1).toBe(2);
    expect(100 - 1).toBe(99);
  });

  it("文字列の等値チェック", function() {
    expect("hello").toBe("hello");
    expect("hello").not.toBe("world");
  });

  it("真偽値のチェック", function() {
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
  });

  it("数値比較", function() {
    expect(10).toBeGreaterThan(5);
    expect(3).toBeLessThanOrEqual(3);
    expect(0.1 + 0.2).toBeCloseTo(0.3, 5);
  });
});` },
    ],
  },
  {
    label: "非同期テスト",
    files: [
      { path: "async.test.js", code: `describe("非同期テスト (シミュレーション)", function() {
  it("Promise 風の値を解決する", function() {
    // シミュレータは同期実行のため、非同期の概念をコールバックで模倣する
    var result = null;
    var resolve = function(value) { result = value; };
    resolve(42);
    expect(result).toBe(42);
  });

  it("遅延コールバックのテスト", function() {
    var data = [];
    var fetchData = function(callback) {
      callback(["apple", "banana", "cherry"]);
    };
    fetchData(function(items) { data = items; });
    expect(data).toHaveLength(3);
    expect(data).toContain("banana");
  });

  it("エラーハンドリング", function() {
    var error = null;
    var failingOperation = function(onError) {
      onError(new Error("ネットワークエラー"));
    };
    failingOperation(function(e) { error = e; });
    expect(error).toBeDefined();
    expect(error.message).toBe("ネットワークエラー");
  });
});` },
    ],
  },
  {
    label: "モック",
    files: [
      { path: "mock.test.js", code: `describe("モック (手動実装)", function() {
  it("関数の呼び出しを記録する", function() {
    // vi.fn() の代わりに手動でモック関数を作成
    var calls = [];
    var mockFn = function() {
      calls.push(Array.prototype.slice.call(arguments));
    };

    mockFn("hello");
    mockFn(1, 2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["hello"]);
    expect(calls[1]).toEqual([1, 2]);
  });

  it("戻り値を制御する", function() {
    var returnValue = 0;
    var mockFn = function() { return returnValue; };

    expect(mockFn()).toBe(0);
    returnValue = 42;
    expect(mockFn()).toBe(42);
  });

  it("依存関数を差し替える", function() {
    var logger = { logs: [] };
    logger.log = function(msg) { logger.logs.push(msg); };

    var greet = function(name) {
      logger.log("Hello, " + name + "!");
    };

    greet("Alice");
    greet("Bob");
    expect(logger.logs).toHaveLength(2);
    expect(logger.logs[0]).toBe("Hello, Alice!");
    expect(logger.logs[1]).toBe("Hello, Bob!");
  });
});` },
    ],
  },
  {
    label: "describe ネスト",
    files: [
      { path: "nested.test.js", code: `describe("ユーザー管理", function() {
  describe("作成", function() {
    it("名前を設定できる", function() {
      var user = { name: "太郎", age: 25 };
      expect(user.name).toBe("太郎");
    });

    it("年齢を設定できる", function() {
      var user = { name: "太郎", age: 25 };
      expect(user.age).toBe(25);
    });
  });

  describe("検証", function() {
    it("名前が空でないこと", function() {
      var name = "花子";
      expect(name).toBeTruthy();
      expect(name).not.toBe("");
    });

    it("年齢が正の整数であること", function() {
      var age = 30;
      expect(age).toBeGreaterThan(0);
    });

    describe("メールアドレス", function() {
      it("@を含むこと", function() {
        var email = "taro@example.com";
        expect(email).toContain("@");
      });

      it("ドメインを含むこと", function() {
        var email = "taro@example.com";
        expect(email).toMatch(/\\w+@\\w+\\.\\w+/);
      });
    });
  });

  describe("比較", function() {
    it("同じプロパティなら等しい", function() {
      var a = { name: "太郎", age: 25 };
      var b = { name: "太郎", age: 25 };
      expect(a).toEqual(b);
    });

    it("異なるプロパティなら等しくない", function() {
      var a = { name: "太郎" };
      var b = { name: "花子" };
      expect(a).not.toEqual(b);
    });
  });
});` },
    ],
  },
  {
    label: "スナップショット",
    files: [
      { path: "snapshot.test.js", code: `describe("スナップショット風テスト", function() {
  // シミュレータには toMatchSnapshot がないため、
  // toEqual で期待値を固定する方式でスナップショットを模倣する

  it("ユーザーオブジェクトのスナップショット", function() {
    var user = { id: 1, name: "太郎", role: "admin" };
    // スナップショット相当: 期待される構造を固定
    expect(user).toEqual({
      id: 1,
      name: "太郎",
      role: "admin"
    });
  });

  it("配列のスナップショット", function() {
    var items = ["りんご", "みかん", "ぶどう"];
    expect(items).toEqual(["りんご", "みかん", "ぶどう"]);
    expect(items).toHaveLength(3);
  });

  it("ネストされた構造のスナップショット", function() {
    var config = {
      theme: "dark",
      lang: "ja",
      features: { sidebar: true, notifications: false }
    };
    expect(config).toEqual({
      theme: "dark",
      lang: "ja",
      features: { sidebar: true, notifications: false }
    });
  });

  it("変更検出: 値が変わったら失敗する", function() {
    var version = "1.0.0";
    // バージョンが変わったらこのテストが失敗する（スナップショットの更新が必要）
    expect(version).toBe("1.0.0");
  });
});` },
    ],
  },
];

export class VitestApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#1b1b1f;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #2e2e32;";
    const title = document.createElement("h1");
    title.textContent = "Vitest Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#fcc72b;";
    header.appendChild(title);
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run All Tests";
    runBtn.style.cssText = "padding:4px 16px;background:#fcc72b;color:#1b1b1f;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    // サンプル選択ドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText = "padding:4px 8px;background:#2e2e32;color:#e2e8f0;border:1px solid #3e3e42;border-radius:4px;font-size:12px;cursor:pointer;";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "-- サンプルを選択 --";
    exampleSelect.appendChild(defaultOption);
    for (const example of EXAMPLES) {
      const option = document.createElement("option");
      option.value = example.label;
      option.textContent = example.label;
      exampleSelect.appendChild(option);
    }
    header.appendChild(exampleSelect);

    const statsSpan = document.createElement("span");
    statsSpan.style.cssText = "font-size:12px;color:#94a3b8;margin-left:auto;font-family:monospace;";
    header.appendChild(statsSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: テストコードエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:50%;display:flex;flex-direction:column;border-right:1px solid #2e2e32;overflow:hidden;";

    const fileList = document.createElement("div");
    fileList.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px;border-bottom:1px solid #2e2e32;";
    leftPanel.appendChild(fileList);

    const editorArea = document.createElement("textarea");
    editorArea.style.cssText = "flex:1;padding:8px;font-family:monospace;font-size:12px;background:#1b1b1f;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    editorArea.spellcheck = false;
    leftPanel.appendChild(editorArea);
    main.appendChild(leftPanel);

    // 右: テスト結果
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const resultDiv = document.createElement("div");
    resultDiv.style.cssText = "flex:1;overflow-y:auto;font-size:12px;font-family:monospace;";
    rightPanel.appendChild(resultDiv);

    const logDiv = document.createElement("div");
    logDiv.style.cssText = "max-height:200px;overflow-y:auto;font-size:10px;font-family:monospace;border-top:1px solid #2e2e32;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // テストファイルを編集可能にする
    const files = SAMPLE_FILES.map(f => ({ ...f }));
    let currentFileIdx = 0;

    const renderFileList = () => {
      fileList.innerHTML = "";
      files.forEach((f, i) => {
        const btn = document.createElement("button");
        btn.style.cssText = `padding:2px 8px;font-size:10px;border:1px solid #2e2e32;border-radius:3px;cursor:pointer;background:${i === currentFileIdx ? "#2e2e32" : "transparent"};color:#e2e8f0;`;
        btn.textContent = f.path;
        btn.addEventListener("click", () => { currentFileIdx = i; editorArea.value = files[i]?.code ?? ""; renderFileList(); });
        fileList.appendChild(btn);
      });
    };
    renderFileList();
    editorArea.value = files[0]?.code ?? "";
    editorArea.addEventListener("input", () => { const f = files[currentFileIdx]; if (f !== undefined) f.code = editorArea.value; });

    // サンプル選択時にエディタの内容を差し替える
    exampleSelect.addEventListener("change", () => {
      const selected = EXAMPLES.find(e => e.label === exampleSelect.value);
      if (selected === undefined) return;
      files.length = 0;
      for (const f of selected.files) {
        files.push({ ...f });
      }
      currentFileIdx = 0;
      editorArea.value = files[0]?.code ?? "";
      renderFileList();
      runBtn.click();
    });

    // 実行
    runBtn.addEventListener("click", () => {
      resultDiv.innerHTML = ""; logDiv.innerHTML = "";
      const runner = new TestRunner();
      runner.onEvent = (e) => addRunnerLog(logDiv, e);
      const results = runner.runFiles(files);

      let totalPass = 0; let totalFail = 0; let totalDuration = 0;
      for (const result of results) {
        totalPass += result.passed; totalFail += result.failed; totalDuration += result.duration;
        renderFileResult(resultDiv, result);
      }
      statsSpan.textContent = `${String(totalPass + totalFail)} tests | ${String(totalPass)} passed | ${String(totalFail)} failed | ${totalDuration.toFixed(0)}ms`;
      statsSpan.style.color = totalFail > 0 ? "#f87171" : "#10b981";
    });

    runBtn.click();
  }
}

function renderFileResult(container: HTMLElement, result: FileResult): void {
  const fileEl = document.createElement("div");
  fileEl.style.cssText = "border-bottom:1px solid #2e2e32;";

  const fileHeader = document.createElement("div");
  const icon = result.failed > 0 ? "\u274C" : "\u2705";
  const color = result.failed > 0 ? "#f87171" : "#10b981";
  fileHeader.style.cssText = `padding:6px 12px;font-weight:600;color:${color};display:flex;justify-content:space-between;`;
  fileHeader.innerHTML = `<span>${icon} ${result.path}</span><span style="color:#94a3b8;font-weight:normal">${String(result.passed)}/${String(result.totalTests)} (${result.duration.toFixed(0)}ms)</span>`;
  fileEl.appendChild(fileHeader);

  renderSuite(fileEl, result.suite, 0);
  container.appendChild(fileEl);
}

function renderSuite(container: HTMLElement, suite: TestSuite, depth: number): void {
  for (const sub of suite.suites) {
    const label = document.createElement("div");
    label.style.cssText = `padding:2px ${String(12 + depth * 16)}px;color:#94a3b8;font-size:11px;`;
    label.textContent = sub.name;
    container.appendChild(label);
    renderSuite(container, sub, depth + 1);
  }
  for (const test of suite.tests) {
    renderTest(container, test, depth);
  }
}

function renderTest(container: HTMLElement, test: TestCase, depth: number): void {
  const row = document.createElement("div");
  const pass = test.result?.status === "pass";
  const icon = pass ? "\u2713" : "\u2717";
  const color = pass ? "#10b981" : "#f87171";
  row.style.cssText = `padding:2px ${String(12 + depth * 16)}px;color:${color};display:flex;gap:6px;align-items:baseline;`;

  const iconEl = document.createElement("span");
  iconEl.textContent = icon;
  row.appendChild(iconEl);

  const nameEl = document.createElement("span");
  nameEl.textContent = test.name;
  row.appendChild(nameEl);

  if (test.result !== undefined) {
    const durEl = document.createElement("span");
    durEl.style.cssText = "color:#475569;font-size:10px;margin-left:auto;";
    durEl.textContent = `${test.result.duration.toFixed(1)}ms`;
    row.appendChild(durEl);
  }

  container.appendChild(row);

  // 失敗時のエラーメッセージ
  if (test.result?.error !== undefined) {
    const errEl = document.createElement("div");
    errEl.style.cssText = `padding:2px ${String(20 + depth * 16)}px;color:#f87171;font-size:10px;background:#2a1215;border-radius:3px;margin:2px ${String(12 + depth * 16)}px;`;
    errEl.textContent = test.result.error;
    container.appendChild(errEl);
  }
}

function addRunnerLog(container: HTMLElement, event: RunnerEvent): void {
  const row = document.createElement("div");
  const colors: Record<string, string> = {
    file_start: "#94a3b8", suite_start: "#64748b", test_start: "#475569",
    test_pass: "#10b981", test_fail: "#f87171", file_complete: "#94a3b8", run_complete: "#fcc72b",
  };
  row.style.cssText = `padding:1px 12px;color:${colors[event.type] ?? "#94a3b8"};`;
  row.textContent = formatRunnerEvent(event);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function formatRunnerEvent(e: RunnerEvent): string {
  switch (e.type) {
    case "file_start": return `\u25B6 ${e.path}`;
    case "suite_start": return `${"  ".repeat(e.depth)}${e.name}`;
    case "test_start": return `  \u25CB ${e.name}`;
    case "test_pass": return `  \u2713 ${e.name} (${e.duration.toFixed(1)}ms, ${String(e.assertions)} assertions)`;
    case "test_fail": return `  \u2717 ${e.name} (${e.duration.toFixed(1)}ms) -- ${e.error}`;
    case "file_complete": return `  ${String(e.passed)} passed, ${String(e.failed)} failed (${e.duration.toFixed(0)}ms)`;
    case "run_complete": return `\nTest Files  ${String(e.files)} | Tests  ${String(e.passed)} passed, ${String(e.failed)} failed | ${e.duration.toFixed(0)}ms`;
  }
}
