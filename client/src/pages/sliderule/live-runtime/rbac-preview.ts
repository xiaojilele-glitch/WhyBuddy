/**
 * rbac-preview — 角色 → 权限 → 页面可见性/操作权的推导（浏览器运行时 M2）。
 *
 * 语义与 RbacScreen 的权限矩阵同源：角色的权限集 = rbac.menus 中
 * roleRefs 含该角色的菜单的 permissionRefs 并集。页面访问规则：
 *   - 页面未声明 actionPermissions → 公共页，所有角色可见
 *   - 声明了 → 角色持有其中至少一个才可见（fail-closed：一律不可见时如实展示锁定）
 *   - 「新建」按钮 → 页面声明了 *:create 动作时，角色必须持有其一；未声明则不设卡
 *
 * 纯函数模块：模型/schema 进、访问判定出，无副作用，便于单测。
 */

import {
  deriveRoleAccess,
  normalizeRoles,
  type FiveSystemModel,
  type RoleAccess,
} from "../system-screens/five-system-model";

// ⚠ 2026-08-17 实现搬到 five-system-model（图的唯一事实源，见那边头注）。
//   这里再导出，现有消费者（RbacScreen / XrayPanel / sandbox-graph）不受影响。
export { deriveRoleAccess };
export type { RoleAccess };
import type { AppPageSchema } from "./app-runtime-schema";
import type { ActionGates } from "./html-binding-runtime";

export interface PageAccess {
  pageId: string;
  title: string;
  /** 公共页（未声明 actionPermissions）恒可见；否则需持有至少一个声明动作 */
  visible: boolean;
  /** 页面声明了 *:create 时须持有其一；未声明 create 动作则不设卡 */
  canCreate: boolean;
  /** 卡「新建」的具体权限（未声明 create 动作时为 null） */
  createPermission: string | null;
  grantedActions: string[];
  deniedActions: string[];
}

export function pageAccessForRole(
  pages: AppPageSchema[],
  access: RoleAccess | undefined
): PageAccess[] {
  const held = new Set(access?.permissions ?? []);
  return pages.map((page) => {
    const actions = page.actions ?? [];
    const granted = actions.filter((a) => held.has(a));
    const denied = actions.filter((a) => !held.has(a));
    const createActions = actions.filter((a) => /:create$/.test(a));
    const createHeld = createActions.find((a) => held.has(a)) ?? null;
    return {
      pageId: page.id,
      title: page.title,
      visible: actions.length === 0 || granted.length > 0,
      canCreate: createActions.length === 0 || createHeld !== null,
      createPermission: createActions[0] ?? null,
      grantedActions: granted,
      deniedActions: denied,
    };
  });
}

export function accessForRole(
  model: FiveSystemModel | null | undefined,
  role: string | undefined
): RoleAccess | undefined {
  if (!role) return undefined;
  return deriveRoleAccess(model).find((r) => r.role === role);
}

/**
 * HTML 页面的角色上下文（2026-08-14 晚：权限那只手伸进 HTML 页）。
 *
 * 模式照 CASL 的 ability：按当前角色**派生一次**，解释器（applyBindings）
 * 填孔时逐点检查。口径不新造，全部映射既有语义：
 *   · createGate = PageAccess.canCreate 的实体视角——页面声明了 *:create
 *     才有卡（fail-open：没声明就是公共动作，跟老区块舞台一字不差）；
 *     HTML 的动作孔带的是 entity 不是 page，所以按页面主实体归到实体上
 *   · workflowEntities = workflowLinked 页面的主实体——转移动作只许打在
 *     真的挂了流程的实体上
 *
 * 一个实体被多个页面用且卡不一致时取**最严**的那张卡（fail-closed：
 * 有一处声明了权限就不能当公共动作放行）。
 */
export function deriveHtmlActionGates(
  model: FiveSystemModel | null | undefined,
  pages: AppPageSchema[],
  role: string | undefined
): ActionGates {
  const access = accessForRole(model, role);
  const createGate: Record<string, { permission: string; granted: boolean }> = {};
  const workflowEntities: string[] = [];
  for (const pa of pageAccessForRole(pages, access)) {
    const page = pages.find((p) => p.id === pa.pageId);
    const entityId = page?.entityId;
    if (!entityId) continue;
    if (page.workflowLinked && !workflowEntities.includes(entityId)) {
      workflowEntities.push(entityId);
    }
    if (!pa.createPermission) continue; // 页面没声明 create 卡 → 不设卡
    const existing = createGate[entityId];
    // 最严原则：已有一张"锁着"的卡就不被后来的"放行"覆盖
    if (!existing || (existing.granted && !pa.canCreate)) {
      createGate[entityId] = { permission: pa.createPermission, granted: pa.canCreate };
    }
  }
  const roleDef = normalizeRoles(model).find((r) => r.id === role);
  return {
    role: role ?? null,
    roleLabel: roleDef?.label,
    createGate,
    workflowEntities,
  };
}

/**
 * 解析当前角色真正能打开的页面：指定页可见就用指定页；否则选第一个
 * 可见业务页；一个都没有才回退旧工作台。纯函数供运行时与回归测试共用。
 */
export function resolveVisiblePageId(
  pages: AppPageSchema[],
  accessByPage: ReadonlyMap<string, PageAccess>,
  requestedPageId: string,
  legacyHomeId = "home"
): string {
  if (requestedPageId === legacyHomeId) return legacyHomeId;
  const requestedExists = pages.some(page => page.id === requestedPageId);
  if (
    requestedExists &&
    accessByPage.get(requestedPageId)?.visible !== false
  ) {
    return requestedPageId;
  }
  return (
    pages.find(page => accessByPage.get(page.id)?.visible !== false)?.id ??
    legacyHomeId
  );
}
