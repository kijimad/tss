// Rubyオブジェクトモデル: 全てがオブジェクト

/** Rubyオブジェクトの種類 */
export type RubyObjectType =
  | 'integer'
  | 'string'
  | 'symbol'
  | 'array'
  | 'hash'
  | 'nil'
  | 'bool'
  | 'object'
  | 'class'
  | 'proc';

/** Rubyオブジェクト基底 */
export interface RubyObject {
  type: RubyObjectType;
  klass: RubyClass;
  toS(): string;
  inspect(): string;
  isTruthy(): boolean;
}

/** Rubyメソッド定義 */
export interface RubyMethod {
  name: string;
  params: string[];
  /** バイトコードメソッドの場合のインストラクション番号 */
  iseqIndex?: number;
  /** 組み込みメソッドの場合 */
  native?: (receiver: RubyObject, args: RubyObject[], block?: RubyProc | null) => RubyObject;
}

/** Rubyクラス */
export class RubyClass implements RubyObject {
  type: RubyObjectType = 'class';
  klass: RubyClass;
  name: string;
  superclass: RubyClass | null;
  methods: Map<string, RubyMethod> = new Map();

  constructor(name: string, superclass: RubyClass | null = null) {
    this.name = name;
    this.superclass = superclass;
    // メタクラスは自分自身を参照（ルートのClassの場合）
    this.klass = this;
  }

  /** メソッドを探索する（自クラス → スーパークラスチェーン） */
  lookupMethod(name: string): RubyMethod | null {
    const method = this.methods.get(name);
    if (method) return method;
    if (this.superclass) return this.superclass.lookupMethod(name);
    return null;
  }

  /** メソッドを定義する */
  defineMethod(method: RubyMethod): void {
    this.methods.set(method.name, method);
  }

  toS(): string {
    return this.name;
  }

  inspect(): string {
    return this.name;
  }

  isTruthy(): boolean {
    return true;
  }
}

/** Ruby整数 */
export class RubyInteger implements RubyObject {
  type: RubyObjectType = 'integer';
  klass: RubyClass;
  value: number;

  constructor(value: number, klass: RubyClass) {
    this.value = value;
    this.klass = klass;
  }

  toS(): string {
    return String(this.value);
  }

  inspect(): string {
    return String(this.value);
  }

  isTruthy(): boolean {
    return true;
  }
}

/** Ruby文字列 */
export class RubyString implements RubyObject {
  type: RubyObjectType = 'string';
  klass: RubyClass;
  value: string;

  constructor(value: string, klass: RubyClass) {
    this.value = value;
    this.klass = klass;
  }

  toS(): string {
    return this.value;
  }

  inspect(): string {
    return `"${this.value}"`;
  }

  isTruthy(): boolean {
    return true;
  }
}

/** Rubyシンボル */
export class RubySymbol implements RubyObject {
  type: RubyObjectType = 'symbol';
  klass: RubyClass;
  name: string;

  constructor(name: string, klass: RubyClass) {
    this.name = name;
    this.klass = klass;
  }

  toS(): string {
    return this.name;
  }

  inspect(): string {
    return `:${this.name}`;
  }

  isTruthy(): boolean {
    return true;
  }
}

/** Ruby配列 */
export class RubyArray implements RubyObject {
  type: RubyObjectType = 'array';
  klass: RubyClass;
  elements: RubyObject[];

  constructor(elements: RubyObject[], klass: RubyClass) {
    this.elements = elements;
    this.klass = klass;
  }

  toS(): string {
    return `[${this.elements.map(e => e.inspect()).join(', ')}]`;
  }

  inspect(): string {
    return this.toS();
  }

  isTruthy(): boolean {
    return true;
  }
}

/** Rubyハッシュ */
export class RubyHash implements RubyObject {
  type: RubyObjectType = 'hash';
  klass: RubyClass;
  entries: Map<string, { key: RubyObject; value: RubyObject }>;

  constructor(klass: RubyClass) {
    this.entries = new Map();
    this.klass = klass;
  }

  /** ハッシュにエントリを追加する */
  set(key: RubyObject, value: RubyObject): void {
    this.entries.set(key.inspect(), { key, value });
  }

  /** ハッシュからエントリを取得する */
  get(key: RubyObject): RubyObject | undefined {
    return this.entries.get(key.inspect())?.value;
  }

  toS(): string {
    const pairs = Array.from(this.entries.values()).map(
      ({ key, value }) => `${key.inspect()} => ${value.inspect()}`
    );
    return `{${pairs.join(', ')}}`;
  }

  inspect(): string {
    return this.toS();
  }

  isTruthy(): boolean {
    return true;
  }
}

/** Ruby nil */
export class RubyNil implements RubyObject {
  type: RubyObjectType = 'nil';
  klass: RubyClass;

  constructor(klass: RubyClass) {
    this.klass = klass;
  }

  toS(): string {
    return '';
  }

  inspect(): string {
    return 'nil';
  }

  isTruthy(): boolean {
    return false;
  }
}

/** Ruby真偽値 */
export class RubyBool implements RubyObject {
  type: RubyObjectType = 'bool';
  klass: RubyClass;
  value: boolean;

  constructor(value: boolean, klass: RubyClass) {
    this.value = value;
    this.klass = klass;
  }

  toS(): string {
    return String(this.value);
  }

  inspect(): string {
    return String(this.value);
  }

  isTruthy(): boolean {
    return this.value;
  }
}

/** Rubyブロック（Proc） */
export class RubyProc implements RubyObject {
  type: RubyObjectType = 'proc';
  klass: RubyClass;
  params: string[];
  /** ブロック本体の命令開始位置 */
  iseqIndex: number;
  /** ブロックが捕捉したローカル変数のスナップショット */
  capturedLocals: Map<string, RubyObject>;

  constructor(params: string[], iseqIndex: number, capturedLocals: Map<string, RubyObject>, klass: RubyClass) {
    this.params = params;
    this.iseqIndex = iseqIndex;
    this.capturedLocals = capturedLocals;
    this.klass = klass;
  }

  toS(): string {
    return '#<Proc>';
  }

  inspect(): string {
    return '#<Proc>';
  }

  isTruthy(): boolean {
    return true;
  }
}

/** 組み込みクラス階層を構築する */
export function createObjectHierarchy(): {
  objectClass: RubyClass;
  integerClass: RubyClass;
  stringClass: RubyClass;
  symbolClass: RubyClass;
  arrayClass: RubyClass;
  hashClass: RubyClass;
  nilClass: RubyClass;
  boolClass: RubyClass;
  procClass: RubyClass;
} {
  // Objectがルートクラス
  const objectClass = new RubyClass('Object', null);

  // 基本クラスを作成
  const integerClass = new RubyClass('Integer', objectClass);
  const stringClass = new RubyClass('String', objectClass);
  const symbolClass = new RubyClass('Symbol', objectClass);
  const arrayClass = new RubyClass('Array', objectClass);
  const hashClass = new RubyClass('Hash', objectClass);
  const nilClass = new RubyClass('NilClass', objectClass);
  const boolClass = new RubyClass('TrueClass', objectClass);
  const procClass = new RubyClass('Proc', objectClass);

  // Objectの組み込みメソッド (Kernelモジュール相当)
  objectClass.defineMethod({
    name: 'to_s',
    params: [],
    native: (receiver) => new RubyString(receiver.toS(), stringClass),
  });

  objectClass.defineMethod({
    name: 'class',
    params: [],
    native: (receiver) => receiver.klass,
  });

  objectClass.defineMethod({
    name: 'nil?',
    params: [],
    native: (receiver) => new RubyBool(receiver.type === 'nil', boolClass),
  });

  // Integerの組み込みメソッド
  integerClass.defineMethod({
    name: 'to_s',
    params: [],
    native: (receiver) => new RubyString(receiver.toS(), stringClass),
  });

  integerClass.defineMethod({
    name: 'to_i',
    params: [],
    native: (receiver) => receiver,
  });

  integerClass.defineMethod({
    name: 'times',
    params: [],
    native: (receiver, _args, block) => {
      // timesはVMレベルで処理するのでここではnilを返す
      // 実際のイテレーションはVM側で制御する
      if (!block) return new RubyNil(nilClass);
      return receiver;
    },
  });

  integerClass.defineMethod({
    name: '+',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyInteger(receiver.value + other.value, integerClass);
      }
      return new RubyNil(nilClass);
    },
  });

  integerClass.defineMethod({
    name: '-',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyInteger(receiver.value - other.value, integerClass);
      }
      return new RubyNil(nilClass);
    },
  });

  integerClass.defineMethod({
    name: '*',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyInteger(receiver.value * other.value, integerClass);
      }
      return new RubyNil(nilClass);
    },
  });

  integerClass.defineMethod({
    name: '/',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger && other.value !== 0) {
        return new RubyInteger(Math.floor(receiver.value / other.value), integerClass);
      }
      return new RubyNil(nilClass);
    },
  });

  integerClass.defineMethod({
    name: '%',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger && other.value !== 0) {
        return new RubyInteger(receiver.value % other.value, integerClass);
      }
      return new RubyNil(nilClass);
    },
  });

  integerClass.defineMethod({
    name: '==',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyBool(receiver.value === other.value, boolClass);
      }
      return new RubyBool(false, boolClass);
    },
  });

  integerClass.defineMethod({
    name: '<',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyBool(receiver.value < other.value, boolClass);
      }
      return new RubyBool(false, boolClass);
    },
  });

  integerClass.defineMethod({
    name: '>',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyBool(receiver.value > other.value, boolClass);
      }
      return new RubyBool(false, boolClass);
    },
  });

  integerClass.defineMethod({
    name: '<=',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyBool(receiver.value <= other.value, boolClass);
      }
      return new RubyBool(false, boolClass);
    },
  });

  integerClass.defineMethod({
    name: '>=',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyInteger && other instanceof RubyInteger) {
        return new RubyBool(receiver.value >= other.value, boolClass);
      }
      return new RubyBool(false, boolClass);
    },
  });

  // Stringの組み込みメソッド
  stringClass.defineMethod({
    name: 'to_s',
    params: [],
    native: (receiver) => receiver,
  });

  stringClass.defineMethod({
    name: 'to_i',
    params: [],
    native: (receiver) => {
      if (receiver instanceof RubyString) {
        return new RubyInteger(parseInt(receiver.value, 10) || 0, integerClass);
      }
      return new RubyInteger(0, integerClass);
    },
  });

  stringClass.defineMethod({
    name: 'length',
    params: [],
    native: (receiver) => {
      if (receiver instanceof RubyString) {
        return new RubyInteger(receiver.value.length, integerClass);
      }
      return new RubyInteger(0, integerClass);
    },
  });

  stringClass.defineMethod({
    name: '+',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyString && other instanceof RubyString) {
        return new RubyString(receiver.value + other.value, stringClass);
      }
      return new RubyNil(nilClass);
    },
  });

  stringClass.defineMethod({
    name: '==',
    params: ['other'],
    native: (receiver, args) => {
      const other = args[0];
      if (receiver instanceof RubyString && other instanceof RubyString) {
        return new RubyBool(receiver.value === other.value, boolClass);
      }
      return new RubyBool(false, boolClass);
    },
  });

  // Arrayの組み込みメソッド
  arrayClass.defineMethod({
    name: 'length',
    params: [],
    native: (receiver) => {
      if (receiver instanceof RubyArray) {
        return new RubyInteger(receiver.elements.length, integerClass);
      }
      return new RubyInteger(0, integerClass);
    },
  });

  arrayClass.defineMethod({
    name: 'push',
    params: ['item'],
    native: (receiver, args) => {
      const item = args[0];
      if (receiver instanceof RubyArray && item) {
        receiver.elements.push(item);
      }
      return receiver;
    },
  });

  arrayClass.defineMethod({
    name: '[]',
    params: ['index'],
    native: (receiver, args) => {
      const index = args[0];
      if (receiver instanceof RubyArray && index instanceof RubyInteger) {
        return receiver.elements[index.value] ?? new RubyNil(nilClass);
      }
      return new RubyNil(nilClass);
    },
  });

  arrayClass.defineMethod({
    name: 'each',
    params: [],
    native: (receiver, _args, _block) => {
      // eachの実際のイテレーションはVM側で処理する
      return receiver;
    },
  });

  arrayClass.defineMethod({
    name: 'map',
    params: [],
    native: (receiver, _args, _block) => {
      // mapの実際のイテレーションはVM側で処理する
      return receiver;
    },
  });

  arrayClass.defineMethod({
    name: 'to_s',
    params: [],
    native: (receiver) => new RubyString(receiver.toS(), stringClass),
  });

  // Hashの組み込みメソッド
  hashClass.defineMethod({
    name: '[]',
    params: ['key'],
    native: (receiver, args) => {
      const key = args[0];
      if (receiver instanceof RubyHash && key) {
        return receiver.get(key) ?? new RubyNil(nilClass);
      }
      return new RubyNil(nilClass);
    },
  });

  hashClass.defineMethod({
    name: 'to_s',
    params: [],
    native: (receiver) => new RubyString(receiver.toS(), stringClass),
  });

  hashClass.defineMethod({
    name: 'length',
    params: [],
    native: (receiver) => {
      if (receiver instanceof RubyHash) {
        return new RubyInteger(receiver.entries.size, integerClass);
      }
      return new RubyInteger(0, integerClass);
    },
  });

  return {
    objectClass,
    integerClass,
    stringClass,
    symbolClass,
    arrayClass,
    hashClass,
    nilClass,
    boolClass,
    procClass,
  };
}
