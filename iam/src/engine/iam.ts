/**
 * iam.ts — AWS IAM ポリシー評価エンジン
 *
 * AWS のポリシー評価ロジックを再現する:
 *   1. 明示的 Deny があれば即拒否
 *   2. SCP (組織ポリシー) で制限
 *   3. Permission Boundary で制限
 *   4. Identity-based / Resource-based ポリシーで Allow を探す
 *   5. どこにも Allow がなければ暗黙的 Deny
 */

// ── 型定義 ──

export type Effect = "Allow" | "Deny";

export interface PolicyStatement {
  sid?: string;
  effect: Effect;
  actions: string[];
  resources: string[];
  conditions?: Record<string, Record<string, string>>;
}

export interface Policy {
  name: string;
  statements: PolicyStatement[];
}

export interface IamUser {
  name: string;
  arn: string;
  groups: string[];
  policies: Policy[];
  permissionBoundary: Policy | null;
}

export interface IamGroup {
  name: string;
  policies: Policy[];
}

export interface IamRole {
  name: string;
  arn: string;
  trustPolicy: PolicyStatement[];
  policies: Policy[];
  permissionBoundary: Policy | null;
}

export interface ResourcePolicy {
  resourceArn: string;
  statements: PolicyStatement[];
}

export interface Scp {
  name: string;
  statements: PolicyStatement[];
}

/** 評価リクエスト */
export interface AuthzRequest {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, string>;
}

/** 評価トレースの 1 ステップ */
export interface EvalStep {
  phase: "explicit_deny" | "scp" | "boundary" | "identity" | "resource" | "default_deny" | "result";
  source: string;
  detail: string;
  effect: "Allow" | "Deny" | "N/A" | "info";
}

/** 評価結果 */
export interface AuthzResult {
  request: AuthzRequest;
  allowed: boolean;
  reason: string;
  steps: EvalStep[];
}

// ── ワイルドカードマッチ ──

/** IAM のワイルドカード (* と ?) をサポートするマッチ */
export function arnMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const regex = new RegExp(
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".") +
    "$",
  );
  return regex.test(value);
}

/** アクションのワイルドカードマッチ (s3:Get* → s3:GetObject) */
export function actionMatch(pattern: string, action: string): boolean {
  return arnMatch(pattern.toLowerCase(), action.toLowerCase());
}

// ── ステートメント評価 ──

function statementMatches(stmt: PolicyStatement, action: string, resource: string): boolean {
  const actionOk = stmt.actions.some((a) => actionMatch(a, action));
  const resourceOk = stmt.resources.some((r) => arnMatch(r, resource));
  return actionOk && resourceOk;
}

// ── IAM サービス ──

export class IamService {
  users: IamUser[] = [];
  groups: IamGroup[] = [];
  roles: IamRole[] = [];
  resourcePolicies: ResourcePolicy[] = [];
  scps: Scp[] = [];

  /** ポリシー評価を実行する */
  evaluate(request: AuthzRequest): AuthzResult {
    const steps: EvalStep[] = [];
    const { principal, action, resource } = request;

    steps.push({
      phase: "result", source: "Request",
      detail: `${principal} → ${action} on ${resource}`,
      effect: "info",
    });

    // 1. 全ポリシーを収集
    const allPolicies = this.collectPolicies(principal);
    const user = this.users.find((u) => u.name === principal || u.arn === principal);
    const role = this.roles.find((r) => r.name === principal || r.arn === principal);

    // 2. 明示的 Deny チェック（全ポリシーから）
    for (const pol of allPolicies) {
      for (const stmt of pol.statements) {
        if (stmt.effect === "Deny" && statementMatches(stmt, action, resource)) {
          steps.push({
            phase: "explicit_deny", source: `${pol.name} (${stmt.sid ?? "Deny"})`,
            detail: `明示的 Deny: ${stmt.actions.join(",")} on ${stmt.resources.join(",")}`,
            effect: "Deny",
          });
          return { request, allowed: false, reason: `明示的 Deny (${pol.name})`, steps };
        }
      }
    }
    steps.push({ phase: "explicit_deny", source: "全ポリシー", detail: "明示的 Deny なし", effect: "N/A" });

    // 3. SCP チェック
    if (this.scps.length > 0) {
      let scpAllowed = false;
      for (const scp of this.scps) {
        for (const stmt of scp.statements) {
          if (stmt.effect === "Allow" && statementMatches(stmt, action, resource)) {
            scpAllowed = true;
            steps.push({ phase: "scp", source: scp.name, detail: `SCP Allow: ${stmt.actions.join(",")}`, effect: "Allow" });
          }
        }
      }
      if (!scpAllowed) {
        steps.push({ phase: "scp", source: "SCP", detail: "SCP で許可されていない → 暗黙的 Deny", effect: "Deny" });
        return { request, allowed: false, reason: "SCP で許可されていない", steps };
      }
    } else {
      steps.push({ phase: "scp", source: "SCP", detail: "SCP なし (制限なし)", effect: "N/A" });
    }

    // 4. Permission Boundary チェック
    const boundary = user?.permissionBoundary ?? role?.permissionBoundary ?? null;
    if (boundary !== null) {
      let boundaryAllowed = false;
      for (const stmt of boundary.statements) {
        if (stmt.effect === "Allow" && statementMatches(stmt, action, resource)) {
          boundaryAllowed = true;
        }
      }
      if (boundaryAllowed) {
        steps.push({ phase: "boundary", source: boundary.name, detail: "Permission Boundary: 範囲内", effect: "Allow" });
      } else {
        steps.push({ phase: "boundary", source: boundary.name, detail: "Permission Boundary 範囲外 → Deny", effect: "Deny" });
        return { request, allowed: false, reason: `Permission Boundary (${boundary.name}) で制限`, steps };
      }
    } else {
      steps.push({ phase: "boundary", source: "Boundary", detail: "Permission Boundary なし", effect: "N/A" });
    }

    // 5. Identity-based ポリシーで Allow を探す
    for (const pol of allPolicies) {
      for (const stmt of pol.statements) {
        if (stmt.effect === "Allow" && statementMatches(stmt, action, resource)) {
          steps.push({
            phase: "identity", source: `${pol.name} (${stmt.sid ?? "Allow"})`,
            detail: `Allow: ${stmt.actions.join(",")} on ${stmt.resources.join(",")}`,
            effect: "Allow",
          });
          return { request, allowed: true, reason: `${pol.name} で許可`, steps };
        }
      }
    }
    steps.push({ phase: "identity", source: "Identity Policies", detail: "一致する Allow なし", effect: "N/A" });

    // 6. Resource-based ポリシーで Allow を探す
    for (const rp of this.resourcePolicies) {
      if (!arnMatch(rp.resourceArn, resource)) continue;
      for (const stmt of rp.statements) {
        if (stmt.effect !== "Allow") continue;
        if (!statementMatches(stmt, action, resource)) continue;
        // Principal チェック
        const principalArn = user?.arn ?? role?.arn ?? principal;
        const matchesPrincipal = stmt.conditions?.["aws:PrincipalArn"]
          ? Object.values(stmt.conditions["aws:PrincipalArn"]).some((v) => arnMatch(v, principalArn))
          : true;
        if (matchesPrincipal) {
          steps.push({
            phase: "resource", source: `ResourcePolicy (${rp.resourceArn})`,
            detail: `Allow: ${stmt.actions.join(",")}`,
            effect: "Allow",
          });
          return { request, allowed: true, reason: `リソースポリシー (${rp.resourceArn}) で許可`, steps };
        }
      }
    }
    steps.push({ phase: "resource", source: "Resource Policies", detail: "一致する Allow なし", effect: "N/A" });

    // 7. 暗黙的 Deny
    steps.push({ phase: "default_deny", source: "IAM", detail: "どのポリシーにも Allow がない → 暗黙的 Deny", effect: "Deny" });
    return { request, allowed: false, reason: "暗黙的 Deny (Allow なし)", steps };
  }

  /** プリンシパルに関連する全ポリシーを収集する */
  private collectPolicies(principal: string): Policy[] {
    const result: Policy[] = [];

    // ユーザー直接ポリシー
    const user = this.users.find((u) => u.name === principal || u.arn === principal);
    if (user !== undefined) {
      result.push(...user.policies);
      // グループポリシー
      for (const groupName of user.groups) {
        const group = this.groups.find((g) => g.name === groupName);
        if (group !== undefined) result.push(...group.policies);
      }
    }

    // ロールポリシー
    const role = this.roles.find((r) => r.name === principal || r.arn === principal);
    if (role !== undefined) {
      result.push(...role.policies);
    }

    return result;
  }
}
