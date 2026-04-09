import { JsHeap } from "../engine/runtime.js";
import type { JsValue, ProtoTrace } from "../engine/runtime.js";

export interface Example {
  name: string;
  description: string;
  code: string;
  run: (heap: JsHeap) => void;
}

const str = (s: string): JsValue => ({ type: "string", value: s });
const num = (n: number): JsValue => ({ type: "number", value: n });

export const EXAMPLES: Example[] = [
  {
    name: "プロトタイプチェーン探索",
    description: "obj → Animal.prototype → Object.prototype → null のチェーンを辿ってプロパティを探す。自身に無ければ [[Prototype]] を遡上。",
    code: `function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function() {
  return this.name + " makes a noise.";
};

const dog = new Animal("Rex");
dog.name;          // "Rex" (own property)
dog.speak;         // Animal.prototype から継承
dog.toString;      // Object.prototype から継承
dog.nonexistent;   // undefined (チェーン全体に不在)`,
    run: (heap) => {
      const animalId = heap.defineConstructor("Animal", "this.name = name;", {
        speak: str("function() { return this.name + ' makes a noise.'; }"),
      });
      const dogId = heap.simulateNew(animalId, "dog", { name: str("Rex") });
      heap.getProperty(dogId, "name");
      heap.getProperty(dogId, "speak");
      heap.getProperty(dogId, "toString");
      heap.getProperty(dogId, "nonexistent");
    },
  },
  {
    name: "new 演算子の 4 ステップ",
    description: "new F() の内部動作: ① 空オブジェクト作成 → ② [[Prototype]] 設定 → ③ コンストラクタ実行 → ④ 戻り値判定。",
    code: `function Person(name, age) {
  this.name = name;
  this.age = age;
}
Person.prototype.greet = function() {
  return "Hi, I'm " + this.name;
};

// new Person("Alice", 30) の内部動作:
// 1. obj = {}
// 2. obj.[[Prototype]] = Person.prototype
// 3. Person.call(obj, "Alice", 30)
// 4. return obj`,
    run: (heap) => {
      const personId = heap.defineConstructor("Person", "this.name = name; this.age = age;", {
        greet: str("function() { return 'Hi, I\\'m ' + this.name; }"),
      });
      heap.simulateNew(personId, "alice", { name: str("Alice"), age: num(30) });
    },
  },
  {
    name: "プロトタイプ継承 (クラス階層)",
    description: "Animal → Dog → myDog の継承チェーン。Dog.prototype.[[Prototype]] = Animal.prototype で多段継承。",
    code: `function Animal(name) { this.name = name; }
Animal.prototype.eat = function() { return "eating"; };

function Dog(name, breed) {
  Animal.call(this, name);
  this.breed = breed;
}
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;
Dog.prototype.bark = function() { return "Woof!"; };

const myDog = new Dog("Rex", "Shiba");
myDog.bark;   // Dog.prototype
myDog.eat;    // Animal.prototype (2段上)
myDog.toString; // Object.prototype (3段上)`,
    run: (heap) => {
      const animalId = heap.defineConstructor("Animal", "this.name = name;", {
        eat: str("function() { return 'eating'; }"),
      });
      // Dog.prototype = Object.create(Animal.prototype)
      const animalProtoId = heap.getObject(animalId)!.prototypeId!;
      const dogProtoId = heap.objectCreate(animalProtoId, "Dog.prototype");
      heap.setProp(dogProtoId, "constructor", str("function Dog()"));
      heap.setProp(dogProtoId, "bark", str("function() { return 'Woof!'; }"));

      const dogId = heap.allocate("Dog", heap.functionProtoId);
      const dogObj = heap.getObject(dogId)!;
      dogObj.constructorBody = "Animal.call(this, name); this.breed = breed;";
      dogObj.prototypeId = dogProtoId;

      const myDogId = heap.simulateNew(dogId, "myDog", { name: str("Rex"), breed: str("Shiba") });
      heap.getProperty(myDogId, "bark");
      heap.getProperty(myDogId, "eat");
      heap.getProperty(myDogId, "toString");
    },
  },
  {
    name: "プロパティシャドーイング",
    description: "own property がプロトタイプの同名プロパティを隠す。toString を独自定義して Object.prototype.toString をシャドーイング。",
    code: `const obj = { x: 10 };
// obj.toString → Object.prototype.toString
obj.toString = function() { return "custom"; };
// obj.toString → 自身の toString (シャドーイング)

obj.hasOwnProperty("x");        // true
obj.hasOwnProperty("toString"); // true (shadow 後)
obj.hasOwnProperty("valueOf");  // false (継承)`,
    run: (heap) => {
      const objId = heap.allocate("obj", heap.objectProtoId);
      heap.setProp(objId, "x", num(10));
      heap.getProperty(objId, "toString"); // Object.prototype から
      heap.shadowProperty(objId, "toString", str("function() { return 'custom'; }"));
      heap.getProperty(objId, "toString"); // 自身から
      heap.hasOwnProperty(objId, "x");
      heap.hasOwnProperty(objId, "toString");
      heap.hasOwnProperty(objId, "valueOf");
    },
  },
  {
    name: "Object.create(null) — 辞書オブジェクト",
    description: "[[Prototype]] = null のオブジェクト。toString も hasOwnProperty も継承しない、純粋な辞書。",
    code: `const dict = Object.create(null);
dict.key1 = "value1";
dict.key2 = "value2";

dict.toString;         // undefined (チェーンが null)
dict.hasOwnProperty;   // undefined
dict.key1;             // "value1"`,
    run: (heap) => {
      const dictId = heap.objectCreate(null, "dict");
      heap.setProp(dictId, "key1", str("value1"));
      heap.setProp(dictId, "key2", str("value2"));
      heap.getProperty(dictId, "toString");
      heap.getProperty(dictId, "hasOwnProperty");
      heap.getProperty(dictId, "key1");
    },
  },
  {
    name: "instanceof 判定",
    description: "obj の [[Prototype]] チェーンに Constructor.prototype が存在するかを確認。多段継承での instanceof 結果。",
    code: `function A() {}
function B() {}
B.prototype = Object.create(A.prototype);

const b = new B();
b instanceof B;   // true (b.__proto__ === B.prototype)
b instanceof A;   // true (B.prototype.__proto__ === A.prototype)
b instanceof Object; // true (チェーンの末端)`,
    run: (heap) => {
      const aId = heap.defineConstructor("A", "", {});
      const aProtoId = heap.getObject(aId)!.prototypeId!;
      const bProtoId = heap.objectCreate(aProtoId, "B.prototype");
      heap.setProp(bProtoId, "constructor", str("function B()"));
      const bId = heap.allocate("B", heap.functionProtoId);
      heap.getObject(bId)!.prototypeId = bProtoId;
      heap.getObject(bId)!.constructorBody = "";
      const objId = heap.simulateNew(bId, "b", {});
      heap.simulateInstanceof(objId, bId);
      heap.simulateInstanceof(objId, aId);
    },
  },
  {
    name: "ES6 class の内部 (糖衣構文)",
    description: "class は function + prototype の糖衣構文。内部的には全く同じプロトタイプチェーンが構築される。",
    code: `class Vehicle {
  constructor(type) { this.type = type; }
  describe() { return "Vehicle: " + this.type; }
}
class Car extends Vehicle {
  constructor(brand) {
    super("car");
    this.brand = brand;
  }
  honk() { return "Beep!"; }
}

const myCar = new Car("Toyota");
// 内部: myCar → Car.prototype → Vehicle.prototype → Object.prototype → null`,
    run: (heap) => {
      const vehicleId = heap.defineConstructor("Vehicle", "this.type = type;", {
        describe: str("function() { return 'Vehicle: ' + this.type; }"),
      });
      const vehicleProtoId = heap.getObject(vehicleId)!.prototypeId!;
      const carProtoId = heap.objectCreate(vehicleProtoId, "Car.prototype");
      heap.setProp(carProtoId, "constructor", str("class Car"));
      heap.setProp(carProtoId, "honk", str("function() { return 'Beep!'; }"));
      const carId = heap.allocate("Car", heap.functionProtoId);
      heap.getObject(carId)!.prototypeId = carProtoId;
      heap.getObject(carId)!.constructorBody = "super('car'); this.brand = brand;";
      const myCarId = heap.simulateNew(carId, "myCar", { type: str("car"), brand: str("Toyota") });
      heap.getProperty(myCarId, "brand");
      heap.getProperty(myCarId, "honk");
      heap.getProperty(myCarId, "describe");
      heap.getProperty(myCarId, "toString");
    },
  },
];

function phaseColor(p: ProtoTrace["phase"]): string {
  switch (p) {
    case "create":      return "#3b82f6";
    case "set_proto":   return "#06b6d4";
    case "define_prop": return "#a78bfa";
    case "lookup":      return "#f59e0b";
    case "chain":       return "#64748b";
    case "found":       return "#22c55e";
    case "not_found":   return "#ef4444";
    case "new_step":    return "#ec4899";
    case "call":        return "#8b5cf6";
    case "instanceof":  return "#f97316";
    case "hasOwn":      return "#06b6d4";
    case "shadow":      return "#dc2626";
    case "inherit":     return "#10b981";
    case "freeze":      return "#64748b";
    case "create_fn":   return "#3b82f6";
  }
}

export class JsProtoApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "JS Prototype Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#f7df1e;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Execute";
    runBtn.style.cssText = "padding:4px 16px;background:#f7df1e;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: コード + オブジェクトグラフ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:400px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f7df1e;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "JavaScript Code";
    leftPanel.appendChild(codeLabel);
    const codeArea = document.createElement("pre");
    codeArea.style.cssText = "padding:8px 12px;font-size:10px;color:#94a3b8;margin:0;white-space:pre-wrap;line-height:1.5;border-bottom:1px solid #1e293b;max-height:160px;overflow-y:auto;";
    leftPanel.appendChild(codeArea);

    const graphLabel = document.createElement("div");
    graphLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    graphLabel.textContent = "Object Graph (Heap)";
    leftPanel.appendChild(graphLabel);
    const graphDiv = document.createElement("div");
    graphDiv.style.cssText = "flex:1;padding:8px 12px;overflow-y:auto;";
    leftPanel.appendChild(graphDiv);
    main.appendChild(leftPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "[[Prototype]] Chain Trace";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderGraph = (heap: JsHeap) => {
      graphDiv.innerHTML = "";
      for (const obj of heap.allObjects) {
        const el = document.createElement("div");
        const isBuiltin = obj.label.includes("Object.prototype") || obj.label.includes("Function.prototype");
        const borderColor = isBuiltin ? "#475569" : "#3b82f6";
        el.style.cssText = `margin-bottom:6px;padding:5px 8px;border:1px solid ${borderColor}44;border-radius:4px;background:${borderColor}08;`;

        // ヘッダ
        const protoStr = obj.proto === null ? "null" : `#${obj.proto}`;
        el.innerHTML = `<div style="display:flex;justify-content:space-between;"><span style="color:${borderColor};font-weight:600;">#${obj.id} ${obj.label}</span><span style="color:#64748b;">[[Proto]]=${protoStr}</span></div>`;

        // Own properties
        for (const [key, desc] of obj.properties) {
          const valStr = heap.valueToString(desc.value);
          const shortVal = valStr.length > 50 ? valStr.slice(0, 50) + "..." : valStr;
          el.innerHTML += `<div style="padding-left:12px;color:#94a3b8;"><span style="color:#a78bfa;">${key}</span>: ${shortVal}</div>`;
        }

        graphDiv.appendChild(el);

        // プロトタイプ矢印
        if (obj.proto !== null) {
          const arrow = document.createElement("div");
          arrow.style.cssText = "text-align:center;color:#334155;font-size:9px;margin:-2px 0;";
          arrow.textContent = `\u2502 [[Prototype]] → #${obj.proto}`;
          graphDiv.appendChild(arrow);
        }
      }
    };

    const renderTrace = (trace: readonly ProtoTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        const objTag = step.objectId !== undefined ? `<span style="color:#f59e0b;min-width:20px;">#${step.objectId}</span>` : '<span style="min-width:20px;"></span>';
        el.innerHTML =
          `<span style="min-width:66px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          objTag +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      codeArea.textContent = ex.code;
      graphDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      codeArea.textContent = ex.code;
      const heap = new JsHeap();
      heap.resetTrace();
      ex.run(heap);
      renderGraph(heap);
      renderTrace(heap.traceLog);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
