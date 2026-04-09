/**
 * runtime.ts — JavaScript プロトタイプベースオブジェクトモデル
 *
 * ECMAScript 仕様に忠実な内部スロットをエミュレートする:
 *   [[Prototype]]  — プロトタイプチェーン
 *   [[Extensible]] — 拡張可能か
 *   OwnPropertyDescriptor — value, writable, enumerable, configurable
 *
 * new 演算子の 4 ステップ:
 *   1. 空オブジェクト作成
 *   2. [[Prototype]] = F.prototype
 *   3. F.call(newObj, args)
 *   4. return (コンストラクタが object を返せばそれ、でなければ newObj)
 */

// ── プロパティ記述子 ──

export interface PropertyDescriptor {
  value: JsValue;
  writable: boolean;
  enumerable: boolean;
  configurable: boolean;
}

// ── JS 値の型 ──

export type JsValue =
  | { type: "undefined" }
  | { type: "null" }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "object"; ref: number }
  | { type: "function"; ref: number };

// ── オブジェクト (内部表現) ──

export interface JsObject {
  id: number;
  label: string;
  /** [[Prototype]] 内部スロット (null = チェーン終端) */
  proto: number | null;
  /** Own properties */
  properties: Map<string, PropertyDescriptor>;
  /** 関数の場合のコンストラクタ本体 */
  constructorBody?: string;
  /** .prototype プロパティ (関数のみ) */
  prototypeId?: number;
  /** [[Extensible]] */
  extensible: boolean;
}

// ── トレース ──

export interface ProtoTrace {
  phase: "create" | "set_proto" | "define_prop" | "lookup" | "chain" | "found" | "not_found" |
    "new_step" | "call" | "instanceof" | "hasOwn" | "shadow" | "inherit" | "freeze" | "create_fn";
  detail: string;
  objectId?: number;
}

// ── ヒープ ──

export class JsHeap {
  private objects: JsObject[] = [];
  private nextId = 0;
  private trace: ProtoTrace[] = [];

  // 組み込みオブジェクト
  readonly objectProtoId: number;
  readonly functionProtoId: number;

  constructor() {
    // Object.prototype (チェーンの終端, [[Prototype]] = null)
    this.objectProtoId = this.allocate("Object.prototype", null);
    this.setProp(this.objectProtoId, "constructor", { type: "string", value: "function Object()" });
    this.setProp(this.objectProtoId, "toString", { type: "string", value: "function toString() { [native code] }" });
    this.setProp(this.objectProtoId, "hasOwnProperty", { type: "string", value: "function hasOwnProperty() { [native code] }" });
    this.setProp(this.objectProtoId, "valueOf", { type: "string", value: "function valueOf() { [native code] }" });

    // Function.prototype ([[Prototype]] = Object.prototype)
    this.functionProtoId = this.allocate("Function.prototype", this.objectProtoId);
    this.setProp(this.functionProtoId, "call", { type: "string", value: "function call() { [native code] }" });
    this.setProp(this.functionProtoId, "apply", { type: "string", value: "function apply() { [native code] }" });
    this.setProp(this.functionProtoId, "bind", { type: "string", value: "function bind() { [native code] }" });

    this.trace = []; // 初期化トレースをクリア
  }

  get traceLog(): readonly ProtoTrace[] { return this.trace; }
  get allObjects(): readonly JsObject[] { return this.objects; }

  resetTrace(): void { this.trace = []; }

  /** オブジェクトを割り当てる */
  allocate(label: string, proto: number | null): number {
    const id = this.nextId++;
    this.objects.push({
      id, label, proto,
      properties: new Map(), extensible: true,
    });
    this.trace.push({ phase: "create", detail: `#${id} "${label}" 作成 ([[Prototype]] = ${proto === null ? "null" : "#" + proto})`, objectId: id });
    return id;
  }

  /** オブジェクトを取得する */
  getObject(id: number): JsObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  /** プロパティを定義する */
  setProp(objId: number, key: string, value: JsValue, writable = true, enumerable = true, configurable = true): void {
    const obj = this.getObject(objId);
    if (obj === undefined) return;
    obj.properties.set(key, { value, writable, enumerable, configurable });
    this.trace.push({ phase: "define_prop", detail: `#${objId}.${key} = ${this.valueToString(value)}`, objectId: objId });
  }

  /** プロパティ探索 ([[Get]]) — プロトタイプチェーンを辿る */
  getProperty(objId: number, key: string): { value: JsValue | undefined; chain: { objId: number; label: string; found: boolean }[] } {
    const chain: { objId: number; label: string; found: boolean }[] = [];
    let current: number | null = objId;

    this.trace.push({ phase: "lookup", detail: `#${objId}.${key} を探索`, objectId: objId });

    while (current !== null) {
      const obj = this.getObject(current);
      if (obj === undefined) break;

      const prop = obj.properties.get(key);
      if (prop !== undefined) {
        chain.push({ objId: current, label: obj.label, found: true });
        this.trace.push({ phase: "found", detail: `#${current} "${obj.label}" に "${key}" 発見 → ${this.valueToString(prop.value)}`, objectId: current });

        if (current !== objId) {
          this.trace.push({ phase: "inherit", detail: `プロトタイプ継承: #${objId} は #${current} から "${key}" を継承`, objectId: objId });
        }

        return { value: prop.value, chain };
      }

      chain.push({ objId: current, label: obj.label, found: false });
      this.trace.push({ phase: "chain", detail: `#${current} "${obj.label}" に "${key}" なし → [[Prototype]] = ${obj.proto === null ? "null" : "#" + obj.proto}`, objectId: current });
      current = obj.proto;
    }

    this.trace.push({ phase: "not_found", detail: `"${key}" はプロトタイプチェーン上に存在しない → undefined` });
    return { value: undefined, chain };
  }

  /** hasOwnProperty — 自身のプロパティのみチェック */
  hasOwnProperty(objId: number, key: string): boolean {
    const obj = this.getObject(objId);
    if (obj === undefined) return false;
    const has = obj.properties.has(key);
    this.trace.push({ phase: "hasOwn", detail: `#${objId}.hasOwnProperty("${key}") → ${has}`, objectId: objId });
    return has;
  }

  /** new 演算子のシミュレーション */
  simulateNew(constructorId: number, label: string, ownProps: Record<string, JsValue>): number {
    const ctor = this.getObject(constructorId);
    if (ctor === undefined) return -1;

    // Step 1: 空オブジェクトを作成
    this.trace.push({ phase: "new_step", detail: `Step 1: 空オブジェクト {} を作成` });

    // Step 2: [[Prototype]] = Constructor.prototype
    const protoId = ctor.prototypeId ?? this.objectProtoId;
    const newId = this.allocate(label, protoId);
    this.trace.push({ phase: "new_step", detail: `Step 2: #${newId}.[[Prototype]] = #${protoId} (${ctor.label}.prototype)` });

    // Step 3: Constructor.call(newObj, args)
    this.trace.push({ phase: "new_step", detail: `Step 3: ${ctor.label}.call(#${newId}, args) — コンストラクタ実行` });
    this.trace.push({ phase: "call", detail: `${ctor.constructorBody ?? "// constructor body"}`, objectId: newId });

    for (const [key, value] of Object.entries(ownProps)) {
      this.setProp(newId, key, value);
    }

    // Step 4: return
    this.trace.push({ phase: "new_step", detail: `Step 4: コンストラクタが object を返さないので #${newId} を返す` });

    return newId;
  }

  /** コンストラクタ関数を定義する */
  defineConstructor(name: string, body: string, protoProps: Record<string, JsValue>): number {
    // F.prototype オブジェクト
    const protoId = this.allocate(`${name}.prototype`, this.objectProtoId);
    this.setProp(protoId, "constructor", { type: "string", value: `function ${name}()` });
    for (const [key, value] of Object.entries(protoProps)) {
      this.setProp(protoId, key, value);
    }

    // 関数オブジェクト
    const fnId = this.allocate(`${name}`, this.functionProtoId);
    const fn = this.getObject(fnId)!;
    fn.constructorBody = body;
    fn.prototypeId = protoId;
    this.setProp(fnId, "prototype", { type: "object", ref: protoId });
    this.trace.push({ phase: "create_fn", detail: `コンストラクタ ${name} 定義 (prototype=#${protoId})`, objectId: fnId });

    return fnId;
  }

  /** Object.create(proto) */
  objectCreate(protoId: number | null, label: string): number {
    this.trace.push({ phase: "create", detail: `Object.create(${protoId === null ? "null" : "#" + protoId})` });
    return this.allocate(label, protoId);
  }

  /** instanceof シミュレーション */
  simulateInstanceof(objId: number, constructorId: number): boolean {
    const ctor = this.getObject(constructorId);
    if (ctor === undefined) return false;
    const targetProto = ctor.prototypeId;
    if (targetProto === undefined) return false;

    let current: number | null = objId;
    const chain: string[] = [];
    while (current !== null) {
      const obj = this.getObject(current);
      if (obj === undefined) break;
      chain.push(`#${current}`);
      if (obj.proto === targetProto) {
        this.trace.push({ phase: "instanceof", detail: `#${objId} instanceof ${ctor.label}: チェーン [${chain.join(" → ")} → #${targetProto}] → true` });
        return true;
      }
      current = obj.proto;
    }
    this.trace.push({ phase: "instanceof", detail: `#${objId} instanceof ${ctor.label}: チェーン [${chain.join(" → ")} → null] → false` });
    return false;
  }

  /** プロパティシャドーイング */
  shadowProperty(objId: number, key: string, newValue: JsValue): void {
    this.trace.push({ phase: "shadow", detail: `#${objId}.${key} = ${this.valueToString(newValue)} (シャドーイング: プロトタイプの "${key}" を隠す)`, objectId: objId });
    this.setProp(objId, key, newValue);
  }

  /** 値の文字列表現 */
  valueToString(v: JsValue): string {
    switch (v.type) {
      case "undefined": return "undefined";
      case "null": return "null";
      case "number": return String(v.value);
      case "string": return `"${v.value}"`;
      case "boolean": return String(v.value);
      case "object": return `[Object #${v.ref}]`;
      case "function": return `[Function #${v.ref}]`;
    }
  }
}
