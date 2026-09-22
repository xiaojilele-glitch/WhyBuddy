/**
 * 角色的显示名（2026-08-05）。
 *
 * 改之前，模型里所有概念都是 id + 中文名配对（实体/字段/菜单/页面/流程节点），
 * **只有角色是一根光杆字符串**，所以角色下拉、流程条、RBAC 屏显示的全是
 * `warehouse_keeper`。`resolveRoleRef` 那个 label 位一直留着，只是没东西可填。
 *
 * 两种形态永远共存：新生成的是 `{id, name}`，内置夹具和线上库里已有的应用
 * 全是字符串（它们数据里就没有中文名，迁移只能瞎编）。
 */

import { describe, expect, it } from "vitest";
import {
  normalizeRoles,
  resolveRoleRef,
  roleLabel,
  type FiveSystemModel,
} from "../system-screens/five-system-model";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import { deriveRoleAccess } from "../live-runtime/rbac-preview";

/** deriveAppRuntimeSchema 没有页面就返回 null，所以夹具得带一页。 */
const PAGE = {
  pages: [{ id: "p1", name: "库存", kind: "workbench", fieldBindings: ["stock.id"] }],
};
const DATAMODEL = {
  entities: [{ id: "stock", name: "库存", fields: [{ id: "id", name: "编号", type: "string" }] }],
};

const OBJ: FiveSystemModel = {
  datamodel: DATAMODEL,
  page: PAGE,
  rbac: {
    roles: [
      { id: "warehouse_keeper", name: "仓库管理员" },
      { id: "store_clerk", name: "门店店员" },
    ],
    permissions: ["stock:view"],
    menus: [
      { id: "m1", label: "库存", roleRefs: ["warehouse_keeper"], permissionRefs: ["stock:view"] },
    ],
  },
};

const LEGACY: FiveSystemModel = {
  datamodel: DATAMODEL,
  page: PAGE,
  rbac: { roles: ["requester", "manager"], permissions: [], menus: [] },
};

describe("normalizeRoles", () => {
  it("对象形态带出显示名", () => {
    expect(normalizeRoles(OBJ)).toEqual([
      { id: "warehouse_keeper", label: "仓库管理员" },
      { id: "store_clerk", label: "门店店员" },
    ]);
  });

  it("字符串形态照旧能读，label 回落成 id", () => {
    expect(normalizeRoles(LEGACY)).toEqual([
      { id: "requester", label: "requester" },
      { id: "manager", label: "manager" },
    ]);
  });

  it("混着写也能读", () => {
    const m = { rbac: { roles: ["old", { id: "new", name: "新的" }] } } as FiveSystemModel;
    expect(normalizeRoles(m).map(r => r.id)).toEqual(["old", "new"]);
    expect(normalizeRoles(m)[1].label).toBe("新的");
  });

  it("脏数据不抛——模型是 LLM 生成的，形状不可信", () => {
    for (const roles of [undefined, null, "x", [null, 42, {}, ""]] as unknown[]) {
      expect(() =>
        normalizeRoles({ rbac: { roles } } as FiveSystemModel)
      ).not.toThrow();
    }
    expect(normalizeRoles(null)).toEqual([]);
  });

  it("重复 id 收敛", () => {
    const m = { rbac: { roles: ["a", { id: "a", name: "甲" }] } } as FiveSystemModel;
    expect(normalizeRoles(m)).toHaveLength(1);
  });
});

describe("resolveRoleRef", () => {
  it("解析得到时吐显示名——这个 label 位以前只能吐 id", () => {
    const r = resolveRoleRef("warehouse_keeper", OBJ);
    expect(r.resolved).toBe(true);
    expect(r.label).toBe("仓库管理员");
    expect(r.ref).toBe("warehouse_keeper");
  });

  it("悬空引用仍然如实标未解析（fail-closed 语义不变）", () => {
    expect(resolveRoleRef("not_a_role", OBJ).resolved).toBe(false);
  });

  it("老应用回落成 id", () => {
    expect(resolveRoleRef("manager", LEGACY).label).toBe("manager");
  });
});

describe("roleLabel", () => {
  it("认不出来就把引用键原样吐回去", () => {
    expect(roleLabel("warehouse_keeper", OBJ)).toBe("仓库管理员");
    expect(roleLabel("ghost", OBJ)).toBe("ghost");
    expect(roleLabel("", OBJ)).toBe("");
  });
});

describe("运行 schema", () => {
  it("roles 是引用键，roleLabels 是显示名——两者刻意分开", () => {
    const s = deriveAppRuntimeSchema(OBJ)!;
    expect(s.roles).toEqual(["warehouse_keeper", "store_clerk"]);
    expect(s.roleLabels).toEqual({
      warehouse_keeper: "仓库管理员",
      store_clerk: "门店店员",
    });
  });

  it("roles 里绝不能混进显示名", () => {
    // 混进去的话，各处 roleRefs.includes(role) 会静默变成永远为 false，
    // 表现是"每个角色都没有任何权限"，而且不报错。
    const s = deriveAppRuntimeSchema(OBJ)!;
    for (const id of s.roles) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it("老应用 roleLabels 是 id→id", () => {
    expect(deriveAppRuntimeSchema(LEGACY)!.roleLabels).toEqual({
      requester: "requester",
      manager: "manager",
    });
  });
});

describe("deriveRoleAccess", () => {
  it("按引用键匹配 menu.roleRefs，同时带出显示名", () => {
    const access = deriveRoleAccess(OBJ);
    const keeper = access.find(a => a.role === "warehouse_keeper");
    expect(keeper?.label).toBe("仓库管理员");
    expect(keeper?.permissions).toEqual(["stock:view"]);
  });

  it("拿显示名去匹配就会全落空——这条钉住别改错", () => {
    const access = deriveRoleAccess(OBJ);
    // 权限非空即证明匹配用的是 id；用 "仓库管理员" 去 includes 会得到 []
    expect(access.find(a => a.role === "warehouse_keeper")?.permissions.length).toBeGreaterThan(0);
  });
});
