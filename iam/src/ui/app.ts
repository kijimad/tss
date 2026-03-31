import { IamService } from "../engine/iam.js";
import type { AuthzRequest, AuthzResult, EvalStep, Policy, PolicyStatement } from "../engine/iam.js";

export interface Example {
  name: string;
  description: string;
  build: (svc: IamService) => void;
  requests: AuthzRequest[];
}

// ── ポリシーヘルパー ──

function pol(name: string, stmts: PolicyStatement[]): Policy { return { name, statements: stmts }; }
function allow(actions: string[], resources: string[], sid?: string): PolicyStatement {
  return { sid, effect: "Allow", actions, resources };
}
function deny(actions: string[], resources: string[], sid?: string): PolicyStatement {
  return { sid, effect: "Deny", actions, resources };
}

export const EXAMPLES: Example[] = [
  {
    name: "基本: ユーザーポリシー",
    description: "S3 の読み取りのみ許可されたユーザー。書き込みは暗黙的 Deny。",
    build: (svc) => {
      svc.users = [{
        name: "alice", arn: "arn:aws:iam::123456:user/alice",
        groups: [], permissionBoundary: null,
        policies: [pol("S3ReadOnly", [allow(["s3:GetObject", "s3:ListBucket"], ["arn:aws:s3:::my-bucket", "arn:aws:s3:::my-bucket/*"], "AllowS3Read")])],
      }];
    },
    requests: [
      { principal: "alice", action: "s3:GetObject", resource: "arn:aws:s3:::my-bucket/file.txt" },
      { principal: "alice", action: "s3:PutObject", resource: "arn:aws:s3:::my-bucket/file.txt" },
      { principal: "alice", action: "s3:ListBucket", resource: "arn:aws:s3:::my-bucket" },
      { principal: "alice", action: "ec2:DescribeInstances", resource: "*" },
    ],
  },
  {
    name: "明示的 Deny が Allow に勝つ",
    description: "AdministratorAccess を持つが、特定バケットへの削除が明示的に Deny されている。",
    build: (svc) => {
      svc.users = [{
        name: "bob", arn: "arn:aws:iam::123456:user/bob",
        groups: ["admins"], permissionBoundary: null,
        policies: [pol("DenyDeleteProd", [deny(["s3:DeleteObject", "s3:DeleteBucket"], ["arn:aws:s3:::production-*"], "DenyProdDelete")])],
      }];
      svc.groups = [{
        name: "admins",
        policies: [pol("AdministratorAccess", [allow(["*"], ["*"], "FullAccess")])],
      }];
    },
    requests: [
      { principal: "bob", action: "s3:GetObject", resource: "arn:aws:s3:::production-data/report.csv" },
      { principal: "bob", action: "s3:DeleteObject", resource: "arn:aws:s3:::production-data/report.csv" },
      { principal: "bob", action: "s3:DeleteObject", resource: "arn:aws:s3:::staging-data/test.csv" },
      { principal: "bob", action: "ec2:TerminateInstances", resource: "arn:aws:ec2:*:*:instance/i-abc123" },
    ],
  },
  {
    name: "グループポリシーの継承",
    description: "ユーザーは直接ポリシーなし。所属グループ developers の権限を継承する。",
    build: (svc) => {
      svc.users = [{
        name: "carol", arn: "arn:aws:iam::123456:user/carol",
        groups: ["developers"], permissionBoundary: null, policies: [],
      }];
      svc.groups = [{
        name: "developers",
        policies: [
          pol("EC2Dev", [allow(["ec2:Describe*", "ec2:StartInstances", "ec2:StopInstances"], ["*"], "EC2Access")]),
          pol("S3Dev", [allow(["s3:GetObject", "s3:PutObject"], ["arn:aws:s3:::dev-*/*"], "S3DevAccess")]),
        ],
      }];
    },
    requests: [
      { principal: "carol", action: "ec2:DescribeInstances", resource: "*" },
      { principal: "carol", action: "ec2:TerminateInstances", resource: "arn:aws:ec2:*:*:instance/i-abc123" },
      { principal: "carol", action: "s3:PutObject", resource: "arn:aws:s3:::dev-bucket/code.zip" },
      { principal: "carol", action: "s3:PutObject", resource: "arn:aws:s3:::production-bucket/code.zip" },
    ],
  },
  {
    name: "Permission Boundary",
    description: "AdministratorAccess を持つが、Boundary で S3 と EC2 のみに制限。IAM 操作は Boundary 外。",
    build: (svc) => {
      svc.users = [{
        name: "dave", arn: "arn:aws:iam::123456:user/dave",
        groups: [], policies: [pol("AdminAccess", [allow(["*"], ["*"], "FullAccess")])],
        permissionBoundary: pol("S3EC2Boundary", [allow(["s3:*", "ec2:*", "logs:*"], ["*"], "BoundaryAllow")]),
      }];
    },
    requests: [
      { principal: "dave", action: "s3:GetObject", resource: "arn:aws:s3:::any-bucket/file.txt" },
      { principal: "dave", action: "ec2:RunInstances", resource: "arn:aws:ec2:*:*:instance/*" },
      { principal: "dave", action: "iam:CreateUser", resource: "arn:aws:iam::123456:user/newuser" },
      { principal: "dave", action: "lambda:InvokeFunction", resource: "arn:aws:lambda:*:*:function:*" },
    ],
  },
  {
    name: "SCP (組織ポリシー)",
    description: "SCP で us-east-1 以外のリージョンを制限。ユーザーは全権限を持つが SCP が優先。",
    build: (svc) => {
      svc.users = [{
        name: "eve", arn: "arn:aws:iam::123456:user/eve",
        groups: [], permissionBoundary: null,
        policies: [pol("AdminAccess", [allow(["*"], ["*"], "FullAccess")])],
      }];
      svc.scps = [{
        name: "RegionRestriction",
        statements: [allow(["*"], ["arn:aws:*:us-east-1:*:*", "arn:aws:s3:::*", "arn:aws:iam::*:*"], "AllowUsEast1Only")],
      }];
    },
    requests: [
      { principal: "eve", action: "ec2:RunInstances", resource: "arn:aws:ec2:us-east-1:123456:instance/i-new" },
      { principal: "eve", action: "ec2:RunInstances", resource: "arn:aws:ec2:ap-northeast-1:123456:instance/i-new" },
      { principal: "eve", action: "s3:GetObject", resource: "arn:aws:s3:::global-bucket/file.txt" },
      { principal: "eve", action: "iam:CreateRole", resource: "arn:aws:iam::123456:role/newrole" },
    ],
  },
  {
    name: "ロールとリソースポリシー",
    description: "Lambda ロールが S3 バケットにアクセス。バケットポリシー (リソースポリシー) でクロスアカウント許可。",
    build: (svc) => {
      svc.roles = [{
        name: "LambdaRole", arn: "arn:aws:iam::123456:role/LambdaRole",
        trustPolicy: [allow(["sts:AssumeRole"], ["*"])],
        permissionBoundary: null,
        policies: [pol("LambdaS3", [allow(["s3:GetObject"], ["arn:aws:s3:::shared-bucket/*"], "ReadShared")])],
      }];
      svc.resourcePolicies = [{
        resourceArn: "arn:aws:s3:::cross-account-bucket/*",
        statements: [{
          effect: "Allow", actions: ["s3:GetObject"], resources: ["arn:aws:s3:::cross-account-bucket/*"],
          conditions: { "aws:PrincipalArn": { "StringLike": "arn:aws:iam::123456:role/*" } },
        }],
      }];
    },
    requests: [
      { principal: "LambdaRole", action: "s3:GetObject", resource: "arn:aws:s3:::shared-bucket/data.json" },
      { principal: "LambdaRole", action: "s3:PutObject", resource: "arn:aws:s3:::shared-bucket/data.json" },
      { principal: "LambdaRole", action: "s3:GetObject", resource: "arn:aws:s3:::cross-account-bucket/external.csv" },
      { principal: "LambdaRole", action: "dynamodb:GetItem", resource: "arn:aws:dynamodb:*:*:table/orders" },
    ],
  },
];

function phaseColor(phase: EvalStep["phase"]): string {
  switch (phase) {
    case "explicit_deny": return "#ef4444";
    case "scp":           return "#f59e0b";
    case "boundary":      return "#a78bfa";
    case "identity":      return "#3b82f6";
    case "resource":      return "#06b6d4";
    case "default_deny":  return "#dc2626";
    case "result":        return "#94a3b8";
  }
}

function effectColor(e: EvalStep["effect"]): string {
  switch (e) {
    case "Allow": return "#22c55e";
    case "Deny":  return "#ef4444";
    case "N/A":   return "#64748b";
    case "info":  return "#94a3b8";
  }
}

export class IamApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "AWS IAM Policy Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#dd6b20;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Evaluate All";
    runBtn.style.cssText = "padding:4px 16px;background:#dd6b20;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: IAM 構成
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:320px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#dd6b20;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "IAM Configuration";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(cfgDiv);
    main.appendChild(leftPanel);

    // 中央: 評価結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "Policy Evaluation Results";
    centerPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resDiv);
    main.appendChild(centerPanel);

    // 右: 評価トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:400px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Evaluation Trace (click a request)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderConfig = (svc: IamService) => {
      cfgDiv.innerHTML = "";
      const section = (title: string, color: string) => {
        const el = document.createElement("div");
        el.style.cssText = `color:${color};font-weight:600;margin-top:8px;margin-bottom:4px;font-size:11px;`;
        el.textContent = title;
        cfgDiv.appendChild(el);
      };
      const item = (text: string) => {
        const el = document.createElement("div");
        el.style.cssText = "color:#94a3b8;padding-left:8px;margin-bottom:2px;";
        el.textContent = text;
        cfgDiv.appendChild(el);
      };
      const polBlock = (p: Policy) => {
        item(`\u{1F4DC} ${p.name}`);
        for (const s of p.statements) {
          const acts = s.actions.join(", ");
          const res = s.resources.join(", ");
          item(`  ${s.effect === "Allow" ? "\u2714" : "\u2718"} ${s.effect}: ${acts} → ${res}`);
        }
      };

      if (svc.users.length > 0) {
        section("Users", "#3b82f6");
        for (const u of svc.users) {
          item(`\u{1F464} ${u.name} (${u.arn})`);
          if (u.groups.length > 0) item(`  groups: ${u.groups.join(", ")}`);
          if (u.permissionBoundary) item(`  boundary: ${u.permissionBoundary.name}`);
          for (const p of u.policies) polBlock(p);
        }
      }
      if (svc.groups.length > 0) {
        section("Groups", "#a78bfa");
        for (const g of svc.groups) {
          item(`\u{1F465} ${g.name}`);
          for (const p of g.policies) polBlock(p);
        }
      }
      if (svc.roles.length > 0) {
        section("Roles", "#f59e0b");
        for (const r of svc.roles) {
          item(`\u{1F3AD} ${r.name} (${r.arn})`);
          for (const p of r.policies) polBlock(p);
        }
      }
      if (svc.scps.length > 0) {
        section("SCPs", "#ef4444");
        for (const s of svc.scps) polBlock({ name: s.name, statements: s.statements });
      }
      if (svc.resourcePolicies.length > 0) {
        section("Resource Policies", "#06b6d4");
        for (const rp of svc.resourcePolicies) item(`\u{1F4E6} ${rp.resourceArn}`);
      }
    };

    const renderResults = (results: AuthzResult[]) => {
      resDiv.innerHTML = "";
      for (const r of results) {
        const el = document.createElement("div");
        const ok = r.allowed;
        const border = ok ? "#22c55e" : "#ef4444";
        el.style.cssText = `padding:6px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}08;cursor:pointer;`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.request.action}</span>` +
          `<span style="color:${border};font-weight:600;">${ok ? "\u2714 ALLOW" : "\u2718 DENY"}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;">${r.request.principal} → ${r.request.resource}</div>` +
          `<div style="color:#475569;font-size:9px;">${r.reason}</div>`;
        el.addEventListener("click", () => renderTrace(r.steps));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (steps: EvalStep[]) => {
      trDiv.innerHTML = "";
      for (const step of steps) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:3px;";
        const pc = phaseColor(step.phase);
        const ec = effectColor(step.effect);
        el.innerHTML =
          `<span style="min-width:75px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${pc};background:${pc}15;border:1px solid ${pc}33;">${step.phase.replace("_", " ")}</span>` +
          `<span style="min-width:36px;color:${ec};font-weight:600;font-size:9px;">${step.effect}</span>` +
          `<span style="color:#94a3b8;font-size:9px;font-weight:600;min-width:80px;">${step.source}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      const svc = new IamService();
      ex.build(svc);
      renderConfig(svc);
      resDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const svc = new IamService();
      ex.build(svc);
      renderConfig(svc);
      const results = ex.requests.map((req) => svc.evaluate(req));
      renderResults(results);
      if (results[0]) renderTrace(results[0].steps);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runAll(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
