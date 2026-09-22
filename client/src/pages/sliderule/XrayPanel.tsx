/**
 * XrayPanel — 应用主舞台的「透视」侧栏。
 *
 * 2026-08-20：按钮原名「游标」是计算尺梗，真机上没人懂它在干什么。
 * Chrome / Figma / LocatorJS 这一类对准元素看背后声明的能力，公开名
 * 都是 Inspect；中文用「透视」——点开后把鼠标移到页面元素上，读它在
 * 五系统上的对应声明。侧栏按 Inspect 面板收：对准焦点优先，百科全书
 * 式五系统清单靠后，沙盘入口放顶上（成品页会把 ArchitectureStage 整块
 * 换掉，只把「五系统联动总图」埋在清单底等于沙盘失踪）。
 */

import React from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { FiveSystemModel } from "./system-screens/five-system-model";
import type { AppRuntimeSchema } from "./live-runtime/app-runtime-schema";
import { deriveRoleAccess, pageAccessForRole } from "./live-runtime/rbac-preview";
import { isWorkflowActionKind } from "./live-runtime/html-binding-runtime";
import { Boxes, Cpu, GitBranch, LayoutTemplate, Users, Waypoints } from "lucide-react";

export interface XraySection {
  skill: SkillId;
  title: string;
  items: string[];
  /** 一句话说明该系统与当前页面的关系 */
  relation: string;
}

/** 元素级游标目标：应用内被悬停的具体元素（对齐焦点）。 */
export type XrayTarget =
  | { kind: "field"; entityId: string; fieldId: string; label: string }
  | { kind: "entity"; entityId: string; label: string }
  | { kind: "action"; label: string; pageId: string; permission: string | null; granted: boolean; role?: string }
  | { kind: "menu"; pageId: string; label: string }
  | { kind: "ai"; capId: string; label: string }
  | { kind: "workflow"; label: string; pageId: string };

/**
 * HTML 页面的悬停绑定 → 游标目标（2026-08-14，spec 舞台的游标复活）。
 *
 * 老区块渲染器的探针直接产出结构化 XrayTarget；HTML 页的悬停只有
 * `{attr, value, el}`（见 html-app-surface 的 onHoverBinding）——这里就是
 * 中间缺的那层翻译。词表就是 html-binding-runtime 的 BINDING_ATTRS，
 * 认不出的孔如实返回 null（面板回落到页面级切片），不编目标。
 *
 * 2026-08-14 晚（第三步落地）：动作读数接上真权限——gates 是宿主按当前角色
 * 派生的那份 ActionGates（deriveHtmlActionGates），createRecord 的 permission/
 * granted 从它来；转移三种（submitWorkflow/approveWorkflow/rejectWorkflow）
 * 映射到 workflow 目标。不传 gates 时保持旧口径（公共动作），不编判定。
 */
export function htmlBindingToXrayTarget(
  info: { attr: string; value: string; el: Element },
  activePageId: string,
  gates?: import("./live-runtime/html-binding-runtime").ActionGates
): XrayTarget | null {
  const v = (info.value || "").trim();
  /** 行内的孔（data-field/data-cell…）的实体上下文 = 最近的逐行容器 */
  const rowsEntity = () =>
    info.el.closest?.("[data-rows]")?.getAttribute("data-rows")?.trim() || null;

  switch (info.attr) {
    case "data-field":
    case "data-value": {
      // 值可能是 "entity.field"（页面级取值）或裸 fieldId（行内取当前行）
      const dot = v.indexOf(".");
      const entityId = dot > 0 ? v.slice(0, dot) : rowsEntity();
      const fieldId = dot > 0 ? v.slice(dot + 1) : v;
      if (!entityId || !fieldId) return null;
      return { kind: "field", entityId, fieldId, label: `${entityId}.${fieldId}` };
    }
    case "data-rows":
    case "data-head":
    case "data-entity":
      return v ? { kind: "entity", entityId: v, label: v } : null;
    case "data-chart": {
      const entityId = info.el.getAttribute?.("data-entity")?.trim() || null;
      const dim = info.el.getAttribute?.("data-dimension")?.trim() || null;
      if (entityId && dim)
        return { kind: "field", entityId, fieldId: dim, label: `${entityId}.${dim}` };
      return entityId ? { kind: "entity", entityId, label: entityId } : null;
    }
    case "data-action": {
      const label = (info.el.textContent || "").trim().slice(0, 24) || v;
      // 转移词 → workflow 目标（describeXrayTarget 会展示流程绑定与节点）
      if (isWorkflowActionKind(v)) {
        return { kind: "workflow", label, pageId: activePageId };
      }
      // 新建卡：宿主派生的 gates 里有这张卡就如实读；没卡 = 公共动作
      const entityId = info.el.getAttribute?.("data-entity")?.trim() || "";
      const gate = v === "createRecord" ? gates?.createGate?.[entityId] : undefined;
      return {
        kind: "action",
        label,
        pageId: activePageId,
        permission: gate?.permission ?? null,
        granted: gate ? gate.granted : true,
        role: gates?.role ?? undefined,
      };
    }
    default: {
      // sort/order/limit/cell/col… 都是挂在行容器边上的参数孔，指认到实体
      const entityId = rowsEntity();
      return entityId ? { kind: "entity", entityId, label: entityId } : null;
    }
  }
}

/** 元素目标 → 背后声明的解读（纯函数，供焦点卡渲染与单测）。 */
export function describeXrayTarget(
  model: FiveSystemModel,
  target: XrayTarget
): { skill: SkillId; title: string; lines: string[] } {
  const entities = model.datamodel?.entities ?? [];
  if (target.kind === "field") {
    const entity = entities.find((e) => e.id === target.entityId);
    const field = entity?.fields?.find((f) => f.id === target.fieldId);
    const ref = `${target.entityId}.${target.fieldId}`;
    const pages = (model.page?.pages ?? []).filter((p) => (p.fieldBindings ?? []).includes(ref));
    const caps = model.aigc?.capabilities ?? [];
    const readers = caps.filter((c) => (c.inputFields ?? []).includes(ref));
    const writers = caps.filter((c) => c.outputField === ref);
    const lines = [
      `字段类型：${field?.type || "string"}`,
      `被 ${pages.length} 个页面绑定${pages.length ? `：${pages.map((p) => p.name || p.id).join("、")}` : ""}`,
    ];
    if (readers.length) lines.push(`AI 读取：${readers.map((c) => c.name || c.id).join("、")}`);
    if (writers.length) lines.push(`AI 写回：${writers.map((c) => c.name || c.id).join("、")}`);
    return {
      skill: "dataModel",
      title: `${entity?.name || target.entityId} · ${field?.name || target.fieldId}`,
      lines,
    };
  }
  if (target.kind === "entity") {
    const entity = entities.find((e) => e.id === target.entityId);
    const fields = entity?.fields ?? [];
    const pages = (model.page?.pages ?? []).filter((p) =>
      (p.fieldBindings ?? []).some((b) => b.startsWith(`${target.entityId}.`))
    );
    return {
      skill: "dataModel",
      title: entity?.name || target.entityId,
      lines: [
        `${fields.length} 个字段`,
        pages.length
          ? `被 ${pages.length} 个页面绑定：${pages.map((p) => p.name || p.id).join("、")}`
          : "未被页面声明绑定",
      ],
    };
  }
  if (target.kind === "action") {
    const holders = deriveRoleAccess(model)
      .filter((r) => target.permission && r.permissions.includes(target.permission))
      .map((r) => r.role);
    return {
      skill: "rbac",
      title: `按钮「${target.label}」`,
      lines: [
        target.permission ? `权限声明：${target.permission}` : "未声明权限（公共动作）",
        target.role
          ? target.granted
            ? `当前角色 ${target.role} 已持有 → 可用`
            : `当前角色 ${target.role} 未持有 → 已锁`
          : "",
        holders.length ? `持有角色：${holders.join("、")}` : "",
      ].filter(Boolean),
    };
  }
  if (target.kind === "menu") {
    const pageDef = (model.page?.pages ?? []).find((p) => p.id === target.pageId);
    const roles = deriveRoleAccess(model)
      .filter((r) => {
        const actions = pageDef?.actionPermissions ?? [];
        return actions.length === 0 || actions.some((a) => r.permissions.includes(a));
      })
      .map((r) => r.role);
    return {
      skill: "page",
      title: `页面「${target.label}」`,
      lines: [
        `字段绑定 ${pageDef?.fieldBindings?.length ?? 0} 项 · 动作声明 ${pageDef?.actionPermissions?.length ?? 0} 项`,
        roles.length ? `可见角色：${roles.join("、")}` : "",
      ].filter(Boolean),
    };
  }
  if (target.kind === "ai") {
    const cap = (model.aigc?.capabilities ?? []).find((c) => c.id === target.capId);
    return {
      skill: "aigc",
      title: `AI 能力「${cap?.name || target.label}」`,
      lines: [
        `输入：${(cap?.inputFields ?? []).join("、") || "—"}`,
        `写回：${cap?.outputField || "—"}`,
        cap?.roleRefs?.length ? `可用角色：${cap.roleRefs.join("、")}` : "",
      ].filter(Boolean),
    };
  }
  // workflow
  const binding = (model.appbundle?.pageBindings ?? []).find(
    (b) => b.pageRef === target.pageId && b.workflowRef
  );
  const nodes = model.workflow?.nodes ?? [];
  return {
    skill: "workflow",
    title: `动作「${target.label}」`,
    lines: [
      binding?.workflowRef ? `发起流程：${binding.workflowRef}` : "本页绑定的审批流",
      nodes.length ? `共 ${nodes.length} 个节点，首节点「${nodes[0]?.name || nodes[0]?.id}」` : "",
    ].filter(Boolean),
  };
}

/** 当前页面（或 home 全景）的游标切片：每个系统与这一页的真实关联。 */
export function derivePageXray(
  model: FiveSystemModel,
  schema: AppRuntimeSchema,
  activePageId: string
): { pageTitle: string; sections: XraySection[] } {
  const entities = model.datamodel?.entities ?? [];
  const entityName = (id: string | null | undefined) => {
    if (!id) return null;
    const e = entities.find((x) => x.id === id);
    return e ? `${e.name || e.id}` : id;
  };
  const roleAccess = deriveRoleAccess(model);

  const page = schema.pages.find((p) => p.id === activePageId) ?? null;

  if (!page) {
    // home / 未匹配：应用全景切片
    const wfNodes = model.workflow?.nodes ?? [];
    const overview: XraySection[] = [
        {
          skill: "dataModel",
          title: "数据模型",
          relation: "全应用的数据地基",
          items: entities.map((e) => `${e.name || e.id} · ${e.fields?.length ?? 0} 字段`),
        },
        {
          skill: "workflow",
          title: "工作流",
          relation: "驱动业务推进的审批链",
          items: wfNodes.map((n) => n.name || n.id),
        },
        {
          skill: "rbac",
          title: "角色权限",
          relation: "谁能进入、能做什么",
          items: roleAccess.map((r) => `${r.role} · ${r.permissions.length} 权限`),
        },
        {
          skill: "page",
          title: "页面",
          relation: "应用的全部界面",
          items: schema.pages.map((p) => p.title),
        },
        {
          skill: "aigc",
          title: "AI 能力",
          relation: "可写回字段的生成能力",
          items: (model.aigc?.capabilities ?? []).map((c) => c.name || c.id || ""),
        },
    ];
    return {
      pageTitle: "工作台（全景）",
      sections: overview.map((s) => ({ ...s, items: s.items.filter(Boolean) })),
    };
  }

  // 具体页面切片
  const mainEntity = entities.find((e) => e.id === page.entityId);
  const boundWorkflowRef = (model.appbundle?.pageBindings ?? []).find(
    (b) => b.pageRef === page.id && b.workflowRef
  )?.workflowRef;
  const wfNodes = model.workflow?.nodes ?? [];
  const visibleRoles = roleAccess
    .filter((r) => pageAccessForRole([page], r).some((a) => a.visible))
    .map((r) => r.role);

  return {
    pageTitle: page.title,
    sections: [
      {
        skill: "dataModel",
        title: "数据模型",
        relation: "本页读写的数据",
        items: mainEntity
          ? [
              `主实体：${mainEntity.name || mainEntity.id}`,
              `表格列 ${page.columns.length} · 表单项 ${page.formFields.length}`,
            ]
          : [],
      },
      {
        skill: "page",
        title: "页面蓝图",
        relation: "字段绑定与操作权声明",
        items: [
          `${page.columns.length + page.formFields.length > 0 ? "字段绑定" : "无绑定"} · 动作 ${page.actions.length} 项`,
        ],
      },
      {
        skill: "workflow",
        title: "工作流",
        relation: page.workflowLinked ? "本页可发起流程" : "本页未挂流程",
        items: page.workflowLinked
          ? [boundWorkflowRef || "已绑定流程", ...wfNodes.slice(0, 4).map((n) => n.name || n.id)]
          : [],
      },
      {
        skill: "rbac",
        title: "角色权限",
        relation: "谁能看到这一页",
        items: visibleRoles,
      },
      {
        skill: "aigc",
        title: "AI 能力",
        relation: page.aiActions.length > 0 ? "详情抽屉可用的生成动作" : "本页无 AI 动作",
        items: page.aiActions.map((a) => `${a.label} → ${a.outputLabel}`),
      },
    ],
  };
}

const SECTION_ICON: Record<string, React.ReactNode> = {
  dataModel: <Boxes className="h-3.5 w-3.5" />,
  workflow: <GitBranch className="h-3.5 w-3.5" />,
  rbac: <Users className="h-3.5 w-3.5" />,
  page: <LayoutTemplate className="h-3.5 w-3.5" />,
  aigc: <Cpu className="h-3.5 w-3.5" />,
};

export function XrayPanel({
  model,
  schema,
  activePageId,
  target = null,
  onOpenSystem,
  onOpenSandbox,
}: {
  model: FiveSystemModel;
  schema: AppRuntimeSchema;
  activePageId: string;
  /** 元素级焦点：应用内正被悬停的元素（null = 页面级透视） */
  target?: XrayTarget | null;
  /** 深入某个系统屏（侧滑抽屉） */
  onOpenSystem: (skill: SkillId) => void;
  /** 切到接线沙盘（成品页把沙盘换掉之后，这里是唯一显式入口） */
  onOpenSandbox?: () => void;
}) {
  const xray = React.useMemo(
    () => derivePageXray(model, schema, activePageId),
    [model, schema, activePageId]
  );
  const focus = React.useMemo(
    () => (target ? describeXrayTarget(model, target) : null),
    [model, target]
  );

  // Inspect 侧栏：对准焦点优先，页面切片收成清单，沙盘入口钉在顶上。
  return (
    <div
      className="flex h-full w-[240px] shrink-0 flex-col overflow-hidden rounded-md border border-[#e5e7eb] bg-white"
      data-testid="sliderule-xray-panel"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
        {/* ⚠ 2026-08-28 用户裁决：顶栏那颗按钮改叫「关联」，这里跟着改。
            按钮叫 A 而它打开的面板顶着 B，是同一件事只改一半。 */}
        <div className="text-[11px] text-stone-400">关联</div>
        <div className="mt-0.5 truncate text-[13px] font-semibold text-stone-800" data-testid="xray-page-title">
          {xray.pageTitle}
        </div>
        <button
          type="button"
          onClick={() => (onOpenSandbox ? onOpenSandbox() : onOpenSystem("appBundle"))}
          data-testid="xray-section-appBundle"
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-[#e5e7eb] bg-[#f8f9fb] px-2 py-1.5 text-left text-[12px] text-stone-600 transition hover:border-[#d3d8e0] hover:bg-white"
        >
          <Waypoints className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          打开沙盘
        </button>

        {focus ? (
          <button
            type="button"
            onClick={() => onOpenSystem(focus.skill)}
            data-testid="xray-focus"
            className="mt-3 block w-full rounded border-l-2 border-[#1677ff] bg-[#e6f4ff]/40 px-2.5 py-2 text-left transition hover:bg-[#e6f4ff]/70"
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-stone-800">
              <span className="text-[#1677ff]">{SECTION_ICON[focus.skill] ?? <Waypoints className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 truncate">{focus.title}</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {focus.lines.map((line, i) => (
                <div key={i} className="text-[11px] leading-4 text-stone-500">
                  {line}
                </div>
              ))}
            </div>
          </button>
        ) : (
          <div className="mt-3 text-[11px] leading-4 text-stone-400" data-testid="xray-hover-hint">
            把鼠标移到页面元素上，看它背后的数据、流程和权限
          </div>
        )}

        <div className="mt-4 space-y-3">
          {xray.sections.map((s) => (
            <div key={s.skill} data-testid={`xray-section-${s.skill}`}>
              <button
                type="button"
                onClick={() => onOpenSystem(s.skill)}
                title={`深入${s.title} · ${s.relation}`}
                className="group flex w-full items-center gap-1.5 text-left text-[11px] text-stone-400 transition hover:text-stone-600"
              >
                {s.title}
                <span className="opacity-0 transition group-hover:opacity-100">›</span>
              </button>
              <div className="mt-1">
                {s.items.length === 0 && (
                  <div className="px-0.5 py-0.5 text-[12px] text-stone-300">{s.relation}</div>
                )}
                {s.items.slice(0, 4).map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenSystem(s.skill)}
                    className="flex w-full items-center gap-2 rounded-sm px-1 py-[2px] text-left transition hover:bg-[#f3f4f6]"
                  >
                    <span className="shrink-0 text-stone-300">{SECTION_ICON[s.skill]}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-stone-700">{it}</span>
                  </button>
                ))}
                {s.items.length > 4 && (
                  <div className="px-1 py-0.5 text-[11px] text-stone-300">还有 {s.items.length - 4} 项…</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
