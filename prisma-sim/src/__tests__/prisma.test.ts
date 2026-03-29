/** Prisma シミュレーターのテスト */

import { describe, it, expect, beforeEach } from "vitest";
import { parseSchema, SchemaParseError } from "../schema/parser.js";
import type { Schema } from "../schema/types.js";
import { QueryEngine } from "../engine/query.js";
import { UniqueConstraintError, RecordNotFoundError } from "../engine/store.js";
import { diffSchemas, applyMigration } from "../engine/migration.js";
import { DataStore } from "../engine/store.js";

/** テスト用のスキーマ定義 */
const TEST_SCHEMA = `
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  age Int
  posts Post[]
}

model Post {
  id Int @id @default(autoincrement())
  title String
  content String
  published Boolean @default(false)
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`;

// ===========================================================================
// スキーマパーサーのテスト
// ===========================================================================
describe("スキーマパーサー", () => {
  it("モデルを正しくパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    expect(schema.models).toHaveLength(2);
    expect(schema.models[0]!.name).toBe("User");
    expect(schema.models[1]!.name).toBe("Post");
  });

  it("フィールド型を正しくパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const userModel = schema.models[0]!;

    /** id フィールド: Int 型 */
    const idField = userModel.fields.find((f) => f.name === "id")!;
    expect(idField.type.name).toBe("Int");
    expect(idField.type.isScalar).toBe(true);
    expect(idField.type.isList).toBe(false);

    /** name フィールド: String 型 */
    const nameField = userModel.fields.find((f) => f.name === "name")!;
    expect(nameField.type.name).toBe("String");
    expect(nameField.type.isScalar).toBe(true);

    /** posts フィールド: Post[] リスト型 */
    const postsField = userModel.fields.find((f) => f.name === "posts")!;
    expect(postsField.type.name).toBe("Post");
    expect(postsField.type.isScalar).toBe(false);
    expect(postsField.type.isList).toBe(true);
  });

  it("@id アトリビュートをパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const idField = schema.models[0]!.fields.find((f) => f.name === "id")!;
    expect(idField.attributes.some((a) => a.name === "id")).toBe(true);
  });

  it("@unique アトリビュートをパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const emailField = schema.models[0]!.fields.find((f) => f.name === "email")!;
    expect(emailField.attributes.some((a) => a.name === "unique")).toBe(true);
  });

  it("@default(autoincrement()) をパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const idField = schema.models[0]!.fields.find((f) => f.name === "id")!;
    const defaultAttr = idField.attributes.find((a) => a.name === "default")!;
    expect(defaultAttr.args[0]!.value).toBe("autoincrement()");
  });

  it("@default(false) をパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const publishedField = schema.models[1]!.fields.find((f) => f.name === "published")!;
    const defaultAttr = publishedField.attributes.find((a) => a.name === "default")!;
    expect(defaultAttr.args[0]!.value).toBe("false");
  });

  it("@relation アトリビュートをパースする", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const authorField = schema.models[1]!.fields.find((f) => f.name === "author")!;
    expect(authorField.relation).toBeDefined();
    expect(authorField.relation!.model).toBe("User");
    expect(authorField.relation!.fields).toEqual(["authorId"]);
    expect(authorField.relation!.references).toEqual(["id"]);
  });

  it("リレーションフィールド（リスト型）を正しく認識する", () => {
    const schema = parseSchema(TEST_SCHEMA);
    const postsField = schema.models[0]!.fields.find((f) => f.name === "posts")!;
    expect(postsField.relation).toBeDefined();
    expect(postsField.relation!.model).toBe("Post");
  });

  it("オプショナル型をパースする", () => {
    const schema = parseSchema(`
model Profile {
  id Int @id
  bio String?
}
`);
    const bioField = schema.models[0]!.fields.find((f) => f.name === "bio")!;
    expect(bioField.type.isOptional).toBe(true);
  });

  it("空のスキーマをパースする", () => {
    const schema = parseSchema("");
    expect(schema.models).toHaveLength(0);
  });

  it("閉じ括弧がないスキーマでエラーを投げる", () => {
    expect(() => parseSchema("model User {")).toThrow(SchemaParseError);
  });

  it("@default(now()) をパースする", () => {
    const schema = parseSchema(`
model Event {
  id Int @id
  createdAt DateTime @default(now())
}
`);
    const createdAtField = schema.models[0]!.fields.find((f) => f.name === "createdAt")!;
    const defaultAttr = createdAtField.attributes.find((a) => a.name === "default")!;
    expect(defaultAttr.args[0]!.value).toBe("now()");
  });
});

// ===========================================================================
// クエリエンジンのテスト
// ===========================================================================
describe("クエリエンジン", () => {
  let engine: QueryEngine;
  let schema: Schema;

  beforeEach(() => {
    schema = parseSchema(TEST_SCHEMA);
    engine = new QueryEngine(schema);
  });

  describe("create", () => {
    it("レコードを作成し、オートインクリメントIDを割り当てる", () => {
      const user = engine.create("User", {
        data: { name: "Alice", email: "alice@example.com", age: 30 },
      });
      expect(user.id).toBe(1);
      expect(user.name).toBe("Alice");
      expect(user.email).toBe("alice@example.com");
    });

    it("連続作成でIDがインクリメントする", () => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
      const user2 = engine.create("User", { data: { name: "Bob", email: "bob@example.com", age: 25 } });
      expect(user2.id).toBe(2);
    });

    it("@default(false) がデフォルト値として適用される", () => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
      const post = engine.create("Post", {
        data: { title: "Hello", content: "World", authorId: 1 },
      });
      expect(post.published).toBe(false);
    });

    it("ユニーク制約違反でエラーを投げる", () => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
      expect(() =>
        engine.create("User", { data: { name: "Bob", email: "alice@example.com", age: 25 } }),
      ).toThrow(UniqueConstraintError);
    });
  });

  describe("findMany", () => {
    beforeEach(() => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
      engine.create("User", { data: { name: "Bob", email: "bob@example.com", age: 25 } });
      engine.create("User", { data: { name: "Charlie", email: "charlie@example.com", age: 35 } });
    });

    it("全レコードを返す", () => {
      const users = engine.findMany("User");
      expect(users).toHaveLength(3);
    });

    it("where: equals でフィルターする", () => {
      const users = engine.findMany("User", { where: { name: "Alice" } });
      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe("Alice");
    });

    it("where: contains でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { email: { contains: "bob" } },
      });
      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe("Bob");
    });

    it("where: startsWith でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { name: { startsWith: "Al" } },
      });
      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe("Alice");
    });

    it("where: gt でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { age: { gt: 28 } },
      });
      expect(users).toHaveLength(2);
    });

    it("where: gte でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { age: { gte: 30 } },
      });
      expect(users).toHaveLength(2);
    });

    it("where: lt でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { age: { lt: 30 } },
      });
      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe("Bob");
    });

    it("where: lte でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { age: { lte: 30 } },
      });
      expect(users).toHaveLength(2);
    });

    it("where: not でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { name: { not: "Alice" } },
      });
      expect(users).toHaveLength(2);
    });

    it("where: in でフィルターする", () => {
      const users = engine.findMany("User", {
        where: { name: { in: ["Alice", "Charlie"] } },
      });
      expect(users).toHaveLength(2);
    });

    it("orderBy: asc でソートする", () => {
      const users = engine.findMany("User", { orderBy: { age: "asc" } });
      expect(users[0]!.name).toBe("Bob");
      expect(users[1]!.name).toBe("Alice");
      expect(users[2]!.name).toBe("Charlie");
    });

    it("orderBy: desc でソートする", () => {
      const users = engine.findMany("User", { orderBy: { age: "desc" } });
      expect(users[0]!.name).toBe("Charlie");
      expect(users[2]!.name).toBe("Bob");
    });

    it("take でレコード数を制限する", () => {
      const users = engine.findMany("User", { take: 2 });
      expect(users).toHaveLength(2);
    });

    it("skip でレコードをスキップする", () => {
      const users = engine.findMany("User", { skip: 1 });
      expect(users).toHaveLength(2);
    });

    it("take と skip を組み合わせる", () => {
      const users = engine.findMany("User", {
        orderBy: { age: "asc" },
        skip: 1,
        take: 1,
      });
      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe("Alice");
    });

    it("select でフィールドを選択する", () => {
      const users = engine.findMany("User", {
        select: { name: true, email: true },
      });
      expect(users[0]!.name).toBe("Alice");
      expect(users[0]!.email).toBe("alice@example.com");
      expect(users[0]!.id).toBeUndefined();
      expect(users[0]!.age).toBeUndefined();
    });
  });

  describe("findUnique", () => {
    beforeEach(() => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
    });

    it("条件に一致するレコードを返す", () => {
      const user = engine.findUnique("User", { where: { email: "alice@example.com" } });
      expect(user).not.toBeNull();
      expect(user!.name).toBe("Alice");
    });

    it("条件に一致しない場合はnullを返す", () => {
      const user = engine.findUnique("User", { where: { email: "unknown@example.com" } });
      expect(user).toBeNull();
    });

    it("select を適用する", () => {
      const user = engine.findUnique("User", {
        where: { id: 1 },
        select: { name: true },
      });
      expect(user).not.toBeNull();
      expect(user!.name).toBe("Alice");
      expect(user!.email).toBeUndefined();
    });
  });

  describe("update", () => {
    beforeEach(() => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
    });

    it("レコードを更新する", () => {
      const updated = engine.update("User", {
        where: { id: 1 },
        data: { name: "Alice Updated" },
      });
      expect(updated.name).toBe("Alice Updated");
      expect(updated.email).toBe("alice@example.com");
    });

    it("存在しないレコードでエラーを投げる", () => {
      expect(() =>
        engine.update("User", {
          where: { id: 999 },
          data: { name: "Nobody" },
        }),
      ).toThrow(RecordNotFoundError);
    });
  });

  describe("delete", () => {
    beforeEach(() => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
    });

    it("レコードを削除する", () => {
      const deleted = engine.delete("User", { where: { id: 1 } });
      expect(deleted.name).toBe("Alice");
      const users = engine.findMany("User");
      expect(users).toHaveLength(0);
    });

    it("存在しないレコードでエラーを投げる", () => {
      expect(() => engine.delete("User", { where: { id: 999 } })).toThrow(RecordNotFoundError);
    });
  });

  describe("リレーション (include)", () => {
    beforeEach(() => {
      engine.create("User", { data: { name: "Alice", email: "alice@example.com", age: 30 } });
      engine.create("Post", { data: { title: "Post 1", content: "Content 1", authorId: 1 } });
      engine.create("Post", { data: { title: "Post 2", content: "Content 2", authorId: 1 } });
    });

    it("1:N リレーションを include で取得する", () => {
      const users = engine.findMany("User", { include: { posts: true } });
      expect(users[0]!.posts).toBeDefined();
      const posts = users[0]!.posts as Record<string, unknown>[];
      expect(posts).toHaveLength(2);
      expect(posts[0]!.title).toBe("Post 1");
    });

    it("1:1 リレーション（逆参照）を include で取得する", () => {
      const posts = engine.findMany("Post", { include: { author: true } });
      expect(posts[0]!.author).toBeDefined();
      const author = posts[0]!.author as Record<string, unknown>;
      expect(author.name).toBe("Alice");
    });

    it("findUnique で include を使用する", () => {
      const user = engine.findUnique("User", {
        where: { id: 1 },
        include: { posts: true },
      });
      expect(user).not.toBeNull();
      const posts = user!.posts as Record<string, unknown>[];
      expect(posts).toHaveLength(2);
    });

    it("include が false の場合はリレーションを含めない", () => {
      const users = engine.findMany("User", { include: { posts: false } });
      expect(users[0]!.posts).toBeUndefined();
    });
  });
});

// ===========================================================================
// マイグレーションのテスト
// ===========================================================================
describe("マイグレーション", () => {
  it("新しいテーブルの追加を検出する", () => {
    const from = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const to = parseSchema(`
model User {
  id Int @id
  name String
}

model Post {
  id Int @id
  title String
}
`);
    const steps = diffSchemas(from, to);
    const createSteps = steps.filter((s) => s.type === "CreateTable");
    expect(createSteps).toHaveLength(1);
    expect(createSteps[0]!.tableName).toBe("Post");
  });

  it("テーブルの削除を検出する", () => {
    const from = parseSchema(`
model User {
  id Int @id
  name String
}

model Post {
  id Int @id
  title String
}
`);
    const to = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const steps = diffSchemas(from, to);
    const dropSteps = steps.filter((s) => s.type === "DropTable");
    expect(dropSteps).toHaveLength(1);
    expect(dropSteps[0]!.tableName).toBe("Post");
  });

  it("カラムの追加を検出する", () => {
    const from = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const to = parseSchema(`
model User {
  id Int @id
  name String
  email String @unique
}
`);
    const steps = diffSchemas(from, to);
    const addColumnSteps = steps.filter((s) => s.type === "AddColumn");
    expect(addColumnSteps).toHaveLength(1);
    expect((addColumnSteps[0] as { type: "AddColumn"; tableName: string; field: { name: string } }).field.name).toBe("email");
  });

  it("カラムの削除を検出する", () => {
    const from = parseSchema(`
model User {
  id Int @id
  name String
  email String
}
`);
    const to = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const steps = diffSchemas(from, to);
    const dropColumnSteps = steps.filter((s) => s.type === "DropColumn");
    expect(dropColumnSteps).toHaveLength(1);
    expect((dropColumnSteps[0] as { type: "DropColumn"; tableName: string; fieldName: string }).fieldName).toBe("email");
  });

  it("ユニークカラム追加時にインデックス作成も生成する", () => {
    const from = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const to = parseSchema(`
model User {
  id Int @id
  name String
  email String @unique
}
`);
    const steps = diffSchemas(from, to);
    const indexSteps = steps.filter((s) => s.type === "CreateIndex");
    expect(indexSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("マイグレーションをデータストアに適用する", () => {
    const from = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const to = parseSchema(`
model User {
  id Int @id
  name String
  email String @unique
}

model Post {
  id Int @id
  title String
}
`);

    const store = new DataStore();
    store.initFromSchema(from);

    const steps = diffSchemas(from, to);
    applyMigration(store, steps);

    /** 新しいテーブルが作成されている */
    expect(store.hasTable("Post")).toBe(true);

    /** 既存テーブルに新しいカラムが追加されている */
    const fields = store.getFields("User");
    expect(fields.some((f) => f.name === "email")).toBe(true);
  });

  it("変更がないスキーマでは空のステップを返す", () => {
    const schema = parseSchema(`
model User {
  id Int @id
  name String
}
`);
    const steps = diffSchemas(schema, schema);
    expect(steps).toHaveLength(0);
  });
});

// ===========================================================================
// DateTime デフォルト値のテスト
// ===========================================================================
describe("DateTime デフォルト値", () => {
  it("@default(now()) で現在時刻が設定される", () => {
    const schema = parseSchema(`
model Event {
  id Int @id @default(autoincrement())
  name String
  createdAt DateTime @default(now())
}
`);
    const engine = new QueryEngine(schema);
    const event = engine.create("Event", { data: { name: "テストイベント" } });
    expect(event.createdAt).toBeDefined();
    expect(typeof event.createdAt).toBe("string");
  });
});
