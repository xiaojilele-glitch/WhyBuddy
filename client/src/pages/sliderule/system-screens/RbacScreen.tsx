/**
 * RbacScreen — 角色权限树 + 数据规则表
 *
 * 数据优先级（诚实降级链）：
 *   1. 五系统模型 rbac 段：roles/permissions/menus 真实渲染——每个角色的
 *      权限与菜单从 menus[].roleRefs/permissionRefs 反推；permissionRefs
 *      未在 permissions 清单声明的如实标红（与 gate 的 fail-closed 一致）。
 *   2. rawContent 文本解析（SSE 路径的角色定义文本）。
 *   3. 占位骨架（降透明度 + 明示），不冒充真实产物。
 */

import React, { useEffect, useMemo, useState } from "react";
import { DEFAULT_SESSION_ID } from "@/lib/sliderule-session-id";
import { Alert, Segmented } from "antd";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { normalizeRoles, type FiveSystemModel } from "./five-system-model";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import { deriveRoleAccess, pageAccessForRole } from "../live-runtime/rbac-preview";
import {
  loadRuntimeRole,
  saveRuntimeRole,
  notifyRoleChanged,
  subscribeRoleChanged,
} from "../live-runtime/runtime-persistence";

interface RbacScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** Raw text content from RBAC capability result */
  rawContent?: string | null;
  /** 解析出的五系统模型（rbac 段：roles/permissions/menus）。 */
  model?: FiveSystemModel | null;
  /** 角色预览与运行应用共享"当前角色"的持久化命名空间 */
  sessionId?: string;
  isActive?: boolean;
  className?: string;
}

interface RoleEntry {
  /** 引用键（menu.roleRefs / assigneeRole 里存的就是它） */
  role: string;
  /** 给人看的名字；补中文名之前生成的应用与 role 相同 */
  label?: string;
  permissions: string[];
  menus: string[];
  dataRules?: string;
}

function parseRolesFromContent(content: string): RoleEntry[] | null {
  // Try to find role definitions in the content
  const lines = content.split("\n").filter(Boolean);
  const roles: RoleEntry[] = [];
  let current: Partial<RoleEntry> | null = null;

  for (const line of lines) {
    const roleMatch = line.match(/^#+\s*角色[：:]\s*(.+)$|^Role[：:]\s*(.+)$/i);
    if (roleMatch) {
      if (current?.role) roles.push(current as RoleEntry);
      current = { role: (roleMatch[1] || roleMatch[2]).trim(), permissions: [], menus: [] };
      continue;
    }
    if (current && line.match(/权限[：:]/i)) {
      const perms = line.replace(/.*权限[：:]/, "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      current.permissions = perms;
    }
    if (current && line.match(/菜单[：:]/i)) {
      const menus = line.replace(/.*菜单[：:]/, "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      current.menus = menus;
    }
    if (current && line.match(/数据规则[：:]/i)) {
      current.dataRules = line.replace(/.*数据规则[：:]/, "").trim();
    }
  }
  if (current?.role) roles.push(current as RoleEntry);
  return roles.length >= 2 ? roles : null;
}

/** model.rbac → 角色行：权限/菜单从 menus 的 roleRefs/permissionRefs 反推。 */
function rolesFromModel(rbac: FiveSystemModel["rbac"] | null | undefined): RoleEntry[] | null {
  // 归一后取 id：menu.roleRefs 存的是引用键，拿显示名去 includes 会全落空
  const roleEntries = normalizeRoles({ rbac } as FiveSystemModel);
  if (roleEntries.length === 0) return null;
  const menus = rbac?.menus ?? [];
  return roleEntries.map(({ id: role, label }) => {
    const roleMenus = menus.filter((m) => (m.roleRefs ?? []).includes(role));
    const permissions = [...new Set(roleMenus.flatMap((m) => m.permissionRefs ?? []))];
    return {
      role,
      label,
      permissions,
      menus: roleMenus.map((m) => m.label || m.id || "").filter(Boolean),
    };
  });
}

/** 角色预览：选角色 → 页面可见性/操作权即时判定，并同步到「运行应用」。 */
function RolePreviewPanel({
  model,
  sessionId,
}: {
  model: FiveSystemModel;
  sessionId: string;
}) {
  const roleAccess = useMemo(() => deriveRoleAccess(model), [model]);
  const schema = useMemo(() => deriveAppRuntimeSchema(model), [model]);
  const [role, setRole] = useState<string>(
    () => loadRuntimeRole(sessionId) ?? roleAccess[0]?.role ?? ""
  );
  // 运行应用侧改了角色 → 这里跟随
  useEffect(
    () =>
      subscribeRoleChanged(sessionId, () => {
        const next = loadRuntimeRole(sessionId);
        if (next) setRole(next);
      }),
    [sessionId]
  );

  const selectRole = (next: string) => {
    setRole(next);
    saveRuntimeRole(sessionId, next);
    notifyRoleChanged(sessionId);
  };

  const selected = roleAccess.find((r) => r.role === role) ?? roleAccess[0];
  const pageRows = pageAccessForRole(schema?.pages ?? [], selected);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4" data-testid="rbac-role-preview">
      <Alert
        type="info"
        showIcon
        message="选中角色实时作用于 AppBundle 的运行应用；菜单与新建按钮按该角色权限锁定"
      />

      <Segmented
        value={selected?.role}
        onChange={value => selectRole(String(value))}
        options={roleAccess.map(item => ({
          value: item.role,
          label: <span data-testid={`rbac-preview-role-${item.role}`}>{item.role}</span>,
        }))}
      />

      {selected && (
        <div className="rounded-md border border-[#e5e7eb] bg-[#eef0f4]/60 p-3">
          <div className="text-[11px] font-semibold text-stone-600">
            {selected.role} · 持有权限 {selected.permissions.length} 项
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {selected.permissions.length > 0 ? (
              selected.permissions.map((p) => (
                <span key={p} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                  {p}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-stone-400">
                模型未给该角色挂任何菜单权限 —— 声明了权限的页面将全部锁定（fail-closed）
              </span>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-[#e5e7eb]">
        <table className="w-full text-xs">
          <thead className="bg-[#eef0f4]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-stone-600">页面</th>
              <th className="px-3 py-2 text-left font-semibold text-stone-600">可见</th>
              <th className="px-3 py-2 text-left font-semibold text-stone-600">新建</th>
              <th className="px-3 py-2 text-left font-semibold text-stone-600">动作权限</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8eaee] bg-white">
            {pageRows.map((row) => (
              <tr key={row.pageId}>
                <td className="px-3 py-2 font-medium text-stone-700">{row.title}</td>
                <td className="px-3 py-2">
                  {row.visible ? (
                    <span className="text-emerald-600">✓ 可见</span>
                  ) : (
                    <span className="text-stone-400">🔒 锁定</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.createPermission === null ? (
                    <span className="text-stone-300" title="页面未声明 *:create 动作，不设卡">
                      未声明
                    </span>
                  ) : row.canCreate ? (
                    <span className="text-emerald-600">✓ 允许</span>
                  ) : (
                    <span className="text-red-500" title={`需持有 ${row.createPermission}`}>
                      ✗ 禁止
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.grantedActions.map((a) => (
                      <span key={a} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                        ✓ {a}
                      </span>
                    ))}
                    {row.deniedActions.map((a) => (
                      <span key={a} className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-500">
                        ✗ {a}
                      </span>
                    ))}
                    {row.grantedActions.length + row.deniedActions.length === 0 && (
                      <span className="text-[10px] text-stone-300">公共页（未声明动作）</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RbacScreen({
  publishClosure,
  rawContent,
  model,
  sessionId = DEFAULT_SESSION_ID,
  isActive = false,
  className = "",
}: RbacScreenProps) {
  const modelRoles = useMemo(() => rolesFromModel(model?.rbac), [model?.rbac]);
  // 未在 rbac.permissions 清单声明的 permissionRef 如实标红（不静默吞掉）。
  const declaredPermissions = useMemo(
    () => new Set(model?.rbac?.permissions ?? []),
    [model?.rbac?.permissions]
  );
  const roles = useMemo(() => {
    if (modelRoles) return modelRoles;
    if (rawContent) {
      const parsed = parseRolesFromContent(rawContent);
      if (parsed) return parsed;
    }
    return [];
  }, [modelRoles, rawContent]);

  const evidence = publishClosure?.perSkillEvidence?.["rbac"];
  const isPlaceholder = !modelRoles && (!rawContent || !parseRolesFromContent(rawContent));
  const hasModel = !!modelRoles;
  // 角色预览需要模型里同时有角色和页面（判定才有对象）
  const canPreview = hasModel && (model?.page?.pages?.length ?? 0) > 0;
  const [screenMode, setScreenMode] = useState<"matrix" | "preview">("matrix");

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="rbac"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#e8eaee] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-orange-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">RBAC</span>
        <span className="text-xs text-stone-400">
          {hasModel
            ? `${modelRoles!.length} 角色 · ${model?.rbac?.permissions?.length ?? 0} 权限 · ${model?.rbac?.menus?.length ?? 0} 菜单`
            : "角色 → 权限 · 菜单 · 数据规则"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {canPreview && (
            <Segmented
              size="small"
              data-testid="rbac-mode-toggle"
              value={screenMode}
              onChange={value => setScreenMode(value as "matrix" | "preview")}
              options={[
                { id: "matrix" as const, label: "权限矩阵" },
                { id: "preview" as const, label: "角色预览" },
              ].map(({ id, label }) => ({
                value: id,
                label: <span data-testid={`rbac-mode-${id}`}>{label}</span>,
              }))}
            />
          )}
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {screenMode === "preview" && canPreview && model ? (
        <div className="min-h-0 flex-1">
          <RolePreviewPanel model={model} sessionId={sessionId} />
        </div>
      ) : isPlaceholder ? (
        <EmptyScreenHint title="角色权限矩阵" desc="角色、权限与菜单的授权关系，来自五系统模型 rbac 段" />
      ) : (
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[#eef0f4]">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">角色</th>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">权限</th>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">菜单</th>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">数据规则</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8eaee]">
            {roles.map((entry) => (
              <tr
                key={entry.role}
                className={`transition-colors hover:bg-[#eef0f4] `}
              >
                <td className="px-4 py-2.5 font-medium text-stone-800">{entry.role}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {entry.permissions.length > 0 ? (
                      entry.permissions.map((p) => {
                        const undeclared = hasModel && !declaredPermissions.has(p);
                        return (
                          <span
                            key={p}
                            className={
                              undeclared
                                ? "rounded bg-red-50 px-1.5 py-0.5 text-red-600 ring-1 ring-red-200"
                                : "rounded bg-blue-50 px-1.5 py-0.5 text-blue-700"
                            }
                            title={undeclared ? `权限未在 rbac.permissions 清单声明：${p}` : p}
                          >
                            {undeclared ? "✗ " : ""}
                            {p}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-[10px] text-stone-300">未挂权限</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {entry.menus.map((m) => (
                      <span key={m} className="rounded bg-[#e9edf2] px-1.5 py-0.5 text-stone-600">
                        {m}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-stone-500">{entry.dataRules ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

      </div>
      )}
    </div>
  );
}
