import { describe, it, expect } from "vitest";
import { IamService, arnMatch, actionMatch } from "../engine/iam.js";
import { EXAMPLES } from "../ui/app.js";
import type { Policy, PolicyStatement } from "../engine/iam.js";

const allow = (actions: string[], resources: string[]): PolicyStatement =>
  ({ effect: "Allow", actions, resources });
const deny = (actions: string[], resources: string[]): PolicyStatement =>
  ({ effect: "Deny", actions, resources });
const pol = (name: string, stmts: PolicyStatement[]): Policy =>
  ({ name, statements: stmts });

describe("arnMatch", () => {
  it("* は全てにマッチ", () => { expect(arnMatch("*", "anything")).toBe(true); });
  it("完全一致", () => { expect(arnMatch("arn:aws:s3:::my-bucket", "arn:aws:s3:::my-bucket")).toBe(true); });
  it("不一致", () => { expect(arnMatch("arn:aws:s3:::my-bucket", "arn:aws:s3:::other")).toBe(false); });
  it("ワイルドカード *", () => { expect(arnMatch("arn:aws:s3:::my-*", "arn:aws:s3:::my-bucket")).toBe(true); });
  it("中間ワイルドカード", () => { expect(arnMatch("arn:aws:ec2:*:*:instance/*", "arn:aws:ec2:us-east-1:123:instance/i-abc")).toBe(true); });
});

describe("actionMatch", () => {
  it("完全一致", () => { expect(actionMatch("s3:GetObject", "s3:GetObject")).toBe(true); });
  it("ワイルドカード s3:*", () => { expect(actionMatch("s3:*", "s3:PutObject")).toBe(true); });
  it("プレフィックス ec2:Describe*", () => { expect(actionMatch("ec2:Describe*", "ec2:DescribeInstances")).toBe(true); });
  it("大文字小文字を無視", () => { expect(actionMatch("S3:GetObject", "s3:getobject")).toBe(true); });
  it("不一致", () => { expect(actionMatch("s3:GetObject", "s3:PutObject")).toBe(false); });
});

describe("基本的なポリシー評価", () => {
  it("Allow ポリシーにマッチすれば許可", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], permissionBoundary: null, policies: [pol("P", [allow(["s3:GetObject"], ["*"])])] }];
    const r = svc.evaluate({ principal: "u1", action: "s3:GetObject", resource: "arn:aws:s3:::b/f" });
    expect(r.allowed).toBe(true);
  });

  it("Allow がなければ暗黙的 Deny", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], permissionBoundary: null, policies: [pol("P", [allow(["s3:GetObject"], ["*"])])] }];
    const r = svc.evaluate({ principal: "u1", action: "ec2:RunInstances", resource: "*" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("暗黙的");
  });

  it("明示的 Deny が Allow に勝つ", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], permissionBoundary: null,
      policies: [pol("P", [allow(["*"], ["*"]), deny(["s3:Delete*"], ["*"])])] }];
    const r = svc.evaluate({ principal: "u1", action: "s3:DeleteObject", resource: "arn:aws:s3:::b/f" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("明示的 Deny");
  });
});

describe("グループポリシー", () => {
  it("グループのポリシーが継承される", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: ["g1"], permissionBoundary: null, policies: [] }];
    svc.groups = [{ name: "g1", policies: [pol("GP", [allow(["ec2:*"], ["*"])])] }];
    const r = svc.evaluate({ principal: "u1", action: "ec2:DescribeInstances", resource: "*" });
    expect(r.allowed).toBe(true);
  });
});

describe("Permission Boundary", () => {
  it("Boundary 範囲内は許可", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], policies: [pol("Admin", [allow(["*"], ["*"])])],
      permissionBoundary: pol("Bound", [allow(["s3:*"], ["*"])]) }];
    expect(svc.evaluate({ principal: "u1", action: "s3:GetObject", resource: "*" }).allowed).toBe(true);
  });

  it("Boundary 範囲外は拒否", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], policies: [pol("Admin", [allow(["*"], ["*"])])],
      permissionBoundary: pol("Bound", [allow(["s3:*"], ["*"])]) }];
    expect(svc.evaluate({ principal: "u1", action: "iam:CreateUser", resource: "*" }).allowed).toBe(false);
  });
});

describe("SCP", () => {
  it("SCP で許可されていないアクションは拒否", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], permissionBoundary: null, policies: [pol("Admin", [allow(["*"], ["*"])])] }];
    svc.scps = [{ name: "S", statements: [allow(["s3:*"], ["*"])] }];
    expect(svc.evaluate({ principal: "u1", action: "ec2:RunInstances", resource: "*" }).allowed).toBe(false);
    expect(svc.evaluate({ principal: "u1", action: "s3:GetObject", resource: "*" }).allowed).toBe(true);
  });
});

describe("トレース", () => {
  it("全評価でトレースが生成される", () => {
    const svc = new IamService();
    svc.users = [{ name: "u1", arn: "arn:aws:iam::1:user/u1", groups: [], permissionBoundary: null, policies: [] }];
    const r = svc.evaluate({ principal: "u1", action: "s3:GetObject", resource: "*" });
    expect(r.steps.length).toBeGreaterThan(0);
  });
});

describe("EXAMPLES", () => {
  it("6 つのサンプルが定義されている", () => { expect(EXAMPLES).toHaveLength(6); });
  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全リクエストが評価可能`, () => {
      const svc = new IamService();
      ex.build(svc);
      for (const req of ex.requests) {
        const r = svc.evaluate(req);
        expect(r.steps.length).toBeGreaterThan(0);
        expect(typeof r.allowed).toBe("boolean");
      }
    });
  }
});
