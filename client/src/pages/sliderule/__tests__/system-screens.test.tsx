/**
 * 系统屏（Workflow / AIGC / AppBundle）做实回归测试。
 *
 * 覆盖三条主线：
 *   1. 渲染模型内容 — 五系统模型段（nodes/transitions、capabilities、bindings）出现在输出里；
 *   2. 交叉引用解析 — assigneeRole→rbac.roles、"entity.field"→datamodel、
 *      pageRef/workflowRef/roleRefs/dataModelRefs 的 resolved/unresolved 都如实渲染；
 *   3. 空态/降级态 — 模型缺失时诚实降级（占位提示 / 跨系统联动降级标注），不冒充真实产物。
 *
 * 本仓库 React 组件测试约定：react-dom/server renderToStaticMarkup，不引入 jsdom/RTL。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowScreen } from "../system-screens/WorkflowScreen";
import { AigcScreen } from "../system-screens/AigcScreen";
import { AppBundleScreen } from "../system-screens/AppBundleScreen";
import { ActiveSystemScreen } from "../system-screens/ActiveSystemScreen";
import { ArchitectureStage } from "../ArchitectureStage";
import { LINKAGE_TO_SKILL } from "../system-screens/SystemLinkageGraph";
import { ReactFlowProvider } from "@xyflow/react";
import { DataModelScreen } from "../system-screens/DataModelScreen";
import {
  ErTableCard,
  isPkField,
  pkHandleId,
} from "../system-screens/EntityRelationGraph";
import { PageScreen, SaltPageCard } from "../system-screens/PageScreen";
import { RbacScreen } from "../system-screens/RbacScreen";
import { WorkflowRuntimePanel } from "../live-runtime/WorkflowRuntimePanel";
import { AigcPipelinePanel } from "../live-runtime/AigcPipelinePanel";
import { EntityDataPanel } from "../live-runtime/EntityDataPanel";
import { AigcTryRunPanel } from "../live-runtime/AigcTryRunPanel";
import {
  parseFiveSystemModel,
  deriveSettledFiveSystemModel,
  parseFiveSystemModelFromContents,
  parseFiveSystemModelFromPerSkillEvidence,
  parseFiveSystemModelFromVersionHistory,
  mergeFiveSystemModels,
  workflowModelToMermaid,
  crossSkillEdgesToMermaid,
  datamodelToMermaid,
  deriveErGraphData,
  derivePhaseLanes,
  deriveWorkflowGraphData,
  deriveSystemLinkageGraph,
  linkageToMermaid,
  bundleLinkageEdges,
  evidenceSourceOf,
  resolveFieldRef,
  resolveRoleRef,
  type FiveSystemModel,
} from "../system-screens/five-system-model";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

// ---------------------------------------------------------------------------
// Fixtures — 与 v5_llm_generate._SCHEMA_INSTRUCTION 的形状一致
// ---------------------------------------------------------------------------

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "course",
        name: "课程",
        fields: [
          { id: "title", name: "课程名", type: "string" },
          { id: "capacity", name: "容量", type: "number" },
        ],
      },
      {
        id: "enrollment",
        name: "选课记录",
        fields: [{ id: "status", name: "状态", type: "enum" }],
      },
    ],
  },
  rbac: {
    roles: ["student", "teacher", "registrar"],
    permissions: ["course:read", "course:approve"],
    menus: [{ id: "m1", label: "选课", roleRefs: ["student"], permissionRefs: ["course:read"] }],
  },
  workflow: {
    id: "wf_enroll",
    nodes: [
      { id: "submit", name: "提交选课", assigneeRole: "student" },
      { id: "approve", name: "教务审批", assigneeRole: "registrar" },
      { id: "ghost", name: "幽灵节点", assigneeRole: "not_a_role" },
    ],
    transitions: [
      { from: "submit", to: "approve", condition: "容量未满" },
      { from: "approve", to: "submit", condition: "退回" },
    ],
  },
  page: {
    pages: [
      {
        id: "enroll_page",
        name: "选课页",
        fieldBindings: ["course.title"],
        actionPermissions: ["course:read"],
      },
    ],
  },
  aigc: {
    capabilities: [
      {
        id: "cap_summary",
        name: "课程简介生成",
        inputFields: ["course.title", "course.capacity"],
        outputField: "enrollment.status",
        roleRefs: ["teacher"],
      },
      {
        id: "cap_broken",
        name: "坏引用能力",
        inputFields: ["nonexistent.field"],
        outputField: "course.title",
        roleRefs: ["ghost_role"],
      },
    ],
  },
  appbundle: {
    landingPageRef: "enroll_page",
    pageBindings: [
      { pageRef: "enroll_page", workflowRef: "wf_enroll" },
      { pageRef: "missing_page", workflowRef: "missing_wf" },
    ],
    roleRefs: ["student", "registrar"],
    dataModelRefs: ["course", "no_such_entity"],
  },
};

const CLOSURE_CLOSED: PublishClosureSummary = {
  blocked: false,
  blockerCount: 0,
  evidencePresentCount: 6,
  skillCount: 6,
  versionPinsChecked: true,
  closureHash: "abcd1234",
  stableDigest: "digest99",
  generatedAt: "2026-07-06T00:00:00Z",
  tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
  topBlockers: [],
  perSkillEvidence: {
    datamodel: { evidencePresent: true, artifactId: "llm-linkage-datamodel", digest: "d1d1d1d1d1" },
    rbac: { evidencePresent: true, artifactId: "llm-linkage-rbac" },
    workflow: { evidencePresent: true, artifactId: "llm-linkage-workflow", evidenceRef: "evidence:workflow:llm-linkage-workflow" },
    page: { evidencePresent: true, artifactId: "llm-linkage-page" },
    aigc: { evidencePresent: true, artifactId: "llm-linkage-aigc" },
    appbundle: { evidencePresent: true, artifactId: "llm-linkage-appbundle" },
  },
};

const CLOSURE_BLOCKED: PublishClosureSummary = {
  ...CLOSURE_CLOSED,
  blocked: true,
  blockerCount: 1,
  evidencePresentCount: 2,
  topBlockers: [
    {
      code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
      path: "runtimeClosure.perSkillEvidence",
      affectedSkill: "aigc",
    },
  ],
  perSkillEvidence: {
    ...CLOSURE_CLOSED.perSkillEvidence!,
    aigc: { evidencePresent: false },
    workflow: { evidencePresent: false },
  },
};

// ---------------------------------------------------------------------------
// five-system-model 解析与 mermaid 构建
// ---------------------------------------------------------------------------

describe("five-system-model 解析", () => {
  it("解析完整模型 JSON（裸 JSON）", () => {
    const parsed = parseFiveSystemModel(JSON.stringify(MODEL));
    expect(parsed).not.toBeNull();
    expect(parsed!.workflow!.nodes).toHaveLength(3);
    expect(parsed!.rbac!.roles).toContain("registrar");
  });

  it("解析 fenced ```json 块", () => {
    const raw = "推演产出如下：\n```json\n" + JSON.stringify(MODEL) + "\n```\n完毕。";
    const parsed = parseFiveSystemModel(raw);
    expect(parsed?.aigc?.capabilities).toHaveLength(2);
  });

  it("识别裸 workflow 段（nodes+transitions 无外层 key）", () => {
    const parsed = parseFiveSystemModel(JSON.stringify(MODEL.workflow));
    expect(parsed?.workflow?.id).toBe("wf_enroll");
  });

  it("非结构化文本 / mermaid 边图返回 null（fail-closed）", () => {
    expect(parseFiveSystemModel("flowchart LR\n  a --> b")).toBeNull();
    expect(parseFiveSystemModel("")).toBeNull();
    expect(parseFiveSystemModel(null)).toBeNull();
    expect(parseFiveSystemModel('{"unrelated": true}')).toBeNull();
  });

  it("parseFiveSystemModelFromContents 跨 skill 合并段", () => {
    const merged = parseFiveSystemModelFromContents({
      workflow: JSON.stringify({ workflow: MODEL.workflow }),
      aigc: JSON.stringify({ aigc: MODEL.aigc, rbac: MODEL.rbac }),
      dataModel: "flowchart LR\n  datamodel --> rbac", // 非 JSON，跳过
    });
    expect(merged?.workflow?.nodes).toHaveLength(3);
    expect(merged?.aigc?.capabilities).toHaveLength(2);
    expect(merged?.rbac?.roles).toContain("student");
    expect(merged?.datamodel).toBeUndefined();
  });

  it("解析 SSE skill_result 实际形状：mermaid 边图 + fenced JSON 模型段共存", () => {
    // useSlideRuleSession 把 skill_result 的 mermaid 与 modelSection 拼成一条内容：
    // 前段供 extractFlow/extractMermaid，后段 fenced JSON 供本解析器。
    const live =
      'flowchart LR\n  rbac["rbac"] -->|RBAC_WORKFLOW_ASSIGNEE_EVIDENCE| workflow["workflow"]' +
      "\n\n```json\n" + JSON.stringify({ workflow: MODEL.workflow }) + "\n```";
    const parsed = parseFiveSystemModel(live);
    expect(parsed?.workflow?.nodes).toHaveLength(3);
    const merged = parseFiveSystemModelFromContents({ workflow: live });
    expect(merged?.workflow?.id).toBe("wf_enroll");
  });

  it("parseFiveSystemModelFromPerSkillEvidence 从持久化 modelSection 重建（reload 路径）", () => {
    const model = parseFiveSystemModelFromPerSkillEvidence({
      datamodel: { modelSection: MODEL.datamodel },
      rbac: { modelSection: MODEL.rbac },
      workflow: { modelSection: MODEL.workflow },
      page: {}, // 无 modelSection —— 段缺失，不伪造
      aigc: { modelSection: MODEL.aigc },
      appbundle: { modelSection: MODEL.appbundle },
    });
    expect(model?.workflow?.nodes).toHaveLength(3);
    expect(model?.aigc?.capabilities).toHaveLength(2);
    expect(model?.page).toBeUndefined();
    // 确定性域：perSkillEvidence 无 modelSection → null（fail-closed）
    expect(
      parseFiveSystemModelFromPerSkillEvidence({
        datamodel: { evidencePresent: true } as { modelSection?: unknown },
      })
    ).toBeNull();
    expect(parseFiveSystemModelFromPerSkillEvidence(null)).toBeNull();
  });

  it("mergeFiveSystemModels 段级合并，primary 优先，皆空返回 null", () => {
    const primary: FiveSystemModel = { workflow: MODEL.workflow };
    const fallback: FiveSystemModel = {
      workflow: { id: "stale_wf", nodes: [], transitions: [] },
      rbac: MODEL.rbac,
    };
    const merged = mergeFiveSystemModels(primary, fallback);
    expect(merged?.workflow?.id).toBe("wf_enroll"); // primary 覆盖 fallback
    expect(merged?.rbac?.roles).toContain("student"); // fallback 补齐缺段
    expect(mergeFiveSystemModels(null, null)).toBeNull();
    expect(mergeFiveSystemModels({}, undefined)).toBeNull();
  });

  it("deriveSettledFiveSystemModel：两源合并，都空则 null（=会话里还没有应用）", () => {
    // 本轮 SSE 原文优先，缺的段由持久化闭环证据补齐
    const model = deriveSettledFiveSystemModel(
      { workflow: JSON.stringify({ workflow: MODEL.workflow }) },
      { rbac: { modelSection: MODEL.rbac } }
    );
    expect(model?.workflow?.id).toBe("wf_enroll");
    expect(model?.rbac?.roles).toContain("student");

    // 刷新后只剩持久化证据：照样判定为"有应用"
    expect(
      deriveSettledFiveSystemModel({}, { workflow: { modelSection: MODEL.workflow } })
    ).not.toBeNull();

    // 关键用例：用户敲了目标、推演还没出模型 —— 此时应用并不存在。
    // 入站判定的 hasApp 就靠这个跟 Boolean(goal) 区分开。
    expect(deriveSettledFiveSystemModel({}, undefined)).toBeNull();
    expect(deriveSettledFiveSystemModel(null, null)).toBeNull();
    // 非 JSON 的 mermaid 原文不构成模型
    expect(
      deriveSettledFiveSystemModel({ workflow: "flowchart LR\n a --> b" }, {})
    ).toBeNull();
  });

  it("deriveSettledFiveSystemModel：闭环空着时读版本史（烘焙坊那场）", () => {
    /**
     * 真机 sr-20260907143221：publishClosure=None、skillContents 刷新即丢，
     * mv-1.model 六段齐。变异：把第三参拿掉，下面必红——那正是徽章
     * 「打过孔但没填上数据」的成因。
     */
    const bakery = {
      id: "mv-1",
      model: {
        datamodel: {
          entities: [
            {
              id: "product",
              name: "成品",
              fields: [{ id: "product_name", name: "品名", type: "string" }],
            },
          ],
        },
        rbac: MODEL.rbac,
      },
    };
    const fromShelf = deriveSettledFiveSystemModel({}, undefined, {
      versions: [bakery],
      currentId: "mv-1",
    });
    expect(fromShelf?.datamodel?.entities?.map(e => e.id)).toEqual(["product"]);
    expect(fromShelf?.rbac?.roles).toContain("student");

    // 没有第三源 = 还是「会话里没有应用」
    expect(deriveSettledFiveSystemModel({}, undefined)).toBeNull();
    expect(parseFiveSystemModelFromVersionHistory(undefined)).toBeNull();
    expect(parseFiveSystemModelFromVersionHistory([{ id: "mv-1" }])).toBeNull();

    // SSE / 闭环段优先，版本史只补缺，不许把直播里的段盖成旧的
    const liveWins = deriveSettledFiveSystemModel(
      { workflow: JSON.stringify({ workflow: MODEL.workflow }) },
      undefined,
      {
        versions: [
          {
            id: "mv-1",
            model: {
              workflow: { id: "stale_wf", nodes: [], transitions: [] },
              datamodel: bakery.model.datamodel,
            },
          },
        ],
      }
    );
    expect(liveWins?.workflow?.id).toBe("wf_enroll");
    expect(liveWins?.datamodel?.entities?.[0].id).toBe("product");

    // 指针认 currentId，不是永远队尾
    const older = parseFiveSystemModelFromVersionHistory(
      [
        { id: "mv-1", model: { datamodel: bakery.model.datamodel } },
        {
          id: "mv-2",
          model: {
            datamodel: { entities: [{ id: "newer", fields: [] }] },
          },
        },
      ],
      "mv-1"
    );
    expect(older?.datamodel?.entities?.[0].id).toBe("product");
  });

  it("workflowModelToMermaid 输出 nodes/transitions/条件/角色", () => {
    const chart = workflowModelToMermaid(MODEL.workflow)!;
    expect(chart).toContain("flowchart TD");
    expect(chart).toContain('submit["提交选课<br/>@student"]');
    expect(chart).toContain("submit -->|容量未满| approve");
    // 无节点 → null（调用方降级）
    expect(workflowModelToMermaid({ nodes: [] })).toBeNull();
    expect(workflowModelToMermaid(undefined)).toBeNull();
  });

  it("crossSkillEdgesToMermaid 与 Python _skill_edges_to_mermaid 同构", () => {
    const chart = crossSkillEdgesToMermaid("workflow", [
      { sourceSkill: "rbac", targetSkill: "workflow", state: "allowed", evidenceKey: "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE" },
      { sourceSkill: "rbac", targetSkill: "workflow", state: "allowed" }, // 去重
    ]);
    expect(chart).toContain('rbac["rbac"] -->|RBAC_WORKFLOW_ASSIGNEE_EVIDENCE| workflow["workflow"]');
    expect(chart.split("\n")).toHaveLength(2);
    expect(crossSkillEdgesToMermaid("aigc", [])).toBe('flowchart LR\n  aigc["aigc"]');
  });

  it("交叉引用解析：resolved 与 unresolved", () => {
    expect(resolveRoleRef("registrar", MODEL).resolved).toBe(true);
    expect(resolveRoleRef("not_a_role", MODEL).resolved).toBe(false);
    const ok = resolveFieldRef("course.title", MODEL);
    expect(ok.resolved).toBe(true);
    expect(ok.label).toBe("课程.课程名");
    expect(resolveFieldRef("nonexistent.field", MODEL).resolved).toBe(false);
    expect(resolveFieldRef("noDotRef", MODEL).resolved).toBe(false);
  });

  it("workflow.chains 与 appbundle.invariants 随段存活（解析 + reload 重建路径）", () => {
    const withExtras: FiveSystemModel = {
      ...MODEL,
      workflow: {
        ...MODEL.workflow,
        chains: [
          {
            id: "wf_refund",
            name: "退费链路",
            kind: "money",
            nodes: [{ id: "refund_apply", name: "申请退费", assigneeRole: "student" }],
            transitions: [],
          },
        ],
      },
      appbundle: {
        ...MODEL.appbundle,
        invariants: [
          {
            id: "inv_refund",
            statement: "退费只能由服务端回调确认",
            systems: ["workflow"],
            refs: ["refund_apply"],
          },
        ],
      },
    };
    const parsed = parseFiveSystemModel(JSON.stringify(withExtras));
    expect(parsed?.workflow?.chains?.[0]?.id).toBe("wf_refund");
    expect(parsed?.appbundle?.invariants?.[0]?.statement).toContain("服务端回调");
    const rebuilt = parseFiveSystemModelFromPerSkillEvidence({
      workflow: { modelSection: withExtras.workflow },
      appbundle: { modelSection: withExtras.appbundle },
    });
    expect(rebuilt?.workflow?.chains).toHaveLength(1);
    expect(rebuilt?.appbundle?.invariants).toHaveLength(1);
    // 链路与 WorkflowSection 同构 → mermaid 构建器直接复用
    expect(workflowModelToMermaid(withExtras.workflow!.chains![0])).toContain("申请退费");
  });
});

// ---------------------------------------------------------------------------
// WorkflowScreen
// ---------------------------------------------------------------------------

describe("WorkflowScreen", () => {
  it("模型存在时渲染节点/转移计数 + 角色图例条", () => {
    const html = renderToStaticMarkup(
      <WorkflowScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain("3 节点 · 2 转移");
    expect(html).toContain('data-testid="workflow-node-roles"');
    expect(html).toContain("×1"); // 角色聚合计数
    expect(html).toContain("evidence ✓");
    // 占位提示不应出现
    expect(html).not.toContain("推演完成后将显示真实业务流程");
  });

  it("assigneeRole 交叉引用：resolved 打勾、unresolved 标红并计数", () => {
    const html = renderToStaticMarkup(<WorkflowScreen model={MODEL} />);
    expect(html).toContain("✓ student");
    expect(html).toContain("✓ registrar");
    expect(html).toContain("✗ not_a_role");
    expect(html).toContain("1 个角色未在 RBAC 定义");
  });

  it("无模型有 SSE mermaid → 标注实时联动，不显示节点表", () => {
    const html = renderToStaticMarkup(
      <WorkflowScreen mermaidSource={"flowchart LR\n  rbac --> workflow"} />
    );
    expect(html).toContain("跨系统联动 · 实时");
    expect(html).not.toContain('data-testid="workflow-node-roles"');
  });

  it("刷新后仅有持久化 skillRuntimeGraph → 用真实边重建，不落占位", () => {
    const html = renderToStaticMarkup(
      <WorkflowScreen
        skillRuntimeGraph={{
          bySkill: {
            workflow: [
              { sourceSkill: "rbac", targetSkill: "workflow", state: "allowed", evidenceKey: "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE" },
            ],
          },
        }}
      />
    );
    expect(html).toContain("跨系统联动 · 已持久化");
    expect(html).not.toContain("推演完成后将显示真实业务流程");
  });

  it("空态：不渲染假域流程图，只显示诚实空状态提示", () => {
    const html = renderToStaticMarkup(<WorkflowScreen />);
    expect(html).toContain('data-testid="screen-empty-hint"');
    expect(html).toContain("业务流程图");
    expect(html).not.toContain("跨系统联动");
  });

  it("多链路：chains 在场渲染业务链路切换条（主链路 + 链路名 + kind 中文标签）", () => {
    const model: FiveSystemModel = {
      ...MODEL,
      workflow: {
        ...MODEL.workflow,
        chains: [
          {
            id: "wf_refund",
            name: "退费链路",
            kind: "money",
            nodes: [{ id: "refund_apply", name: "申请退费", assigneeRole: "student" }],
            transitions: [],
          },
        ],
      },
    };
    const html = renderToStaticMarkup(<WorkflowScreen model={model} />);
    expect(html).toContain('data-testid="workflow-chain-tabs"');
    expect(html).toContain('data-testid="workflow-chain-primary"');
    expect(html).toContain('data-testid="workflow-chain-wf_refund"');
    expect(html).toContain("退费链路");
    expect(html).toContain("资金"); // kind: money → 中文标签
    // 默认选中主链路：计数仍是主链路的 3 节点 2 转移
    expect(html).toContain("3 节点 · 2 转移");
  });

  it("无 chains → 不渲染链路切换条（老模型零变化）", () => {
    const html = renderToStaticMarkup(<WorkflowScreen model={MODEL} />);
    expect(html).not.toContain('data-testid="workflow-chain-tabs"');
  });
});

// ---------------------------------------------------------------------------
// AigcScreen
// ---------------------------------------------------------------------------

describe("AigcScreen", () => {
  it("模型存在时渲染能力卡片 + 字段绑定交叉解析", () => {
    const html = renderToStaticMarkup(
      <AigcScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain('data-testid="aigc-capabilities"');
    expect(html).toContain("课程简介生成");
    expect(html).toContain("2 项 AI 能力");
    // resolved 输入字段 → 实体名.字段名
    expect(html).toContain("课程.课程名");
    expect(html).toContain("课程.容量");
    // resolved 输出字段
    expect(html).toContain("选课记录.状态");
    // roleRefs 交叉到 rbac
    expect(html).toContain("teacher");
    expect(html).toContain("evidence ✓");
    // 占位内容不应出现
    expect(html).not.toContain("采购描述生成");
    expect(html).not.toContain("推演完成后将显示真实 AIGC 功能设计");
  });

  it("坏引用如实标红（fail-closed 不静默）", () => {
    const html = renderToStaticMarkup(<AigcScreen model={MODEL} />);
    expect(html).toContain("✗ nonexistent.field");
    expect(html).toContain("✗ ghost_role");
  });

  it("aigc.pipelines：编排档 tab 只在声明管线时出现；面板渲染步骤链 + 衔接字段标注", () => {
    const model: FiveSystemModel = {
      ...MODEL,
      aigc: {
        capabilities: [
          {
            id: "cap_summary",
            name: "课程简介生成",
            inputFields: ["course.title"],
            outputField: "enrollment.status",
            roleRefs: ["teacher"],
          },
          {
            id: "cap_notice",
            name: "选课通知生成",
            inputFields: ["enrollment.status", "course.title"],
            outputField: "course.title",
            roleRefs: ["registrar"],
          },
        ],
        pipelines: [{ id: "pipe_1", name: "选课文案链", steps: ["cap_summary", "cap_notice"] }],
      },
    };
    // 解析存活（管线随 aigc 段走）
    const parsed = parseFiveSystemModel(JSON.stringify(model));
    expect(parsed?.aigc?.pipelines?.[0]?.steps).toEqual(["cap_summary", "cap_notice"]);
    // tab 出现
    const html = renderToStaticMarkup(<AigcScreen model={model} publishClosure={CLOSURE_CLOSED} />);
    expect(html).toContain('data-testid="aigc-mode-pipeline"');
    // 无管线 → tab 不出现（不造空壳入口）
    const htmlNoPipe = renderToStaticMarkup(<AigcScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />);
    expect(htmlNoPipe).not.toContain('data-testid="aigc-mode-pipeline"');
    // 面板：步骤链 + 衔接字段 + 注入标注 + 试跑按钮
    const panel = renderToStaticMarkup(<AigcPipelinePanel model={model} goal="在线选课" />);
    expect(panel).toContain('data-testid="aigc-pipeline-chain"');
    expect(panel).toContain("1. 课程简介生成");
    expect(panel).toContain("2. 选课通知生成");
    expect(panel).toContain("enrollment.status"); // 衔接字段标注
    expect(panel).toContain("由上一步注入");
    expect(panel).toContain('data-testid="aigc-pipeline-run"');
    expect(panel).toContain("试跑整条链（2 步）");
    expect(panel).toContain("ant-segmented");
    expect(panel).toContain("ant-card");
    expect(panel).toContain("ant-btn");
  });

  it("rawContent 有跨系统联动图但无结构化清单 → 降级标注", () => {
    const html = renderToStaticMarkup(
      <AigcScreen rawContent={"flowchart LR\n  aigc --> appbundle"} />
    );
    expect(html).toContain('data-testid="aigc-degraded"');
    expect(html).toContain("未携带结构化 AIGC 能力清单");
    expect(html).not.toContain('data-testid="aigc-capabilities"');
  });

  it("空态：不渲染假域 AI 能力卡，只显示诚实空状态提示", () => {
    const html = renderToStaticMarkup(<AigcScreen />);
    expect(html).toContain('data-testid="screen-empty-hint"');
    expect(html).not.toContain("采购描述生成"); // 采购假域占位已移除
  });
});

// ---------------------------------------------------------------------------
// AppBundleScreen
// ---------------------------------------------------------------------------

describe("AppBundleScreen", () => {
  it("closed 闭环：6/6 + 证据链接 + 闭环元信息", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain("closed 6/6");
    expect(html).toContain("llm-linkage-workflow");
    expect(html).toContain("llm-linkage-datamodel");
    expect(html).toContain("closureHash=abcd1234");
    expect(html).toContain("digest=digest99");
    expect(html).toContain("versionPins=checked");
    expect(html).not.toContain('data-testid="appbundle-blockers"');
    expect(html).toContain('data-testid="appbundle-evidence-list"');
    expect(html).toContain("Checks");
    // 不该有：3×2 绿卡、沙盘切到 Checks 里。变异：把 grid 卡或 mode toggle 加回必红。
    expect(html).not.toContain("grid-cols-2");
    expect(html).not.toContain("grid-cols-3");
    expect(html).not.toContain("appbundle-mode-toggle");
    expect(html).not.toContain("data-missing=\"true\"");
  });

  it("blocked 闭环：拦截条 + Checks 红行（缺的必须看得见，不许整面盖住）", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen publishClosure={CLOSURE_BLOCKED} />
    );
    expect(html).toContain('data-testid="appbundle-gate-blocked"');
    expect(html).toContain("发布检查未通过");
    expect(html).toContain("当前缺少 4 项系统证据，补齐后即可继续发布。");
    expect(html).not.toContain("发布证据看板");
    expect(html).not.toContain("blocked 2/6");
    expect(html).toContain("failed 2/6");
    expect(html).toContain("技术详情");
    expect(html).toContain("APPBUNDLE_RUNTIME_CLOSURE_BLOCKED");
    expect(html).toContain("runtimeClosure.perSkillEvidence");
    expect(html).not.toContain('data-testid="appbundle-blockers"');
    // 清单仍在：缺的两行是红的。变异：整面只留盾牌、藏掉 list 必红。
    expect(html).toContain('data-testid="appbundle-evidence-list"');
    expect(html).toContain('data-testid="appbundle-check-aigc"');
    expect(html).toMatch(/data-testid="appbundle-check-aigc"[^>]*data-missing="true"/);
    expect(html).toMatch(/data-testid="appbundle-check-workflow"[^>]*data-missing="true"/);
    expect(html).toMatch(/data-testid="appbundle-check-datamodel"[^>]*data-missing="false"/);
    expect(html).toContain("证据缺失");
    expect(html).not.toContain("grid-cols-2");
    expect(html).not.toContain("bg-emerald-50");
  });

  it("blocked 闭环（E27 定稿）：副标题按拦截原因自适应说人话", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen
        publishClosure={{
          ...CLOSURE_BLOCKED,
          topBlockers: [
            ...CLOSURE_BLOCKED.topBlockers!,
            {
              code: "LLM_GENERATE_DISABLED",
              path: "llmGenerate.fiveSystemModel",
              affectedSkill: "",
              ref: "SLIDERULE_LLM_GENERATE_ENABLED 未开启：新颖意图不会调用 LLM 生成五系统模型",
            },
          ],
        }}
      />
    );
    expect(html).toContain("发布检查未通过");
    expect(html).toContain("五系统模型生成开关未开启");
  });

  it("模型 appbundle 段绑定：首屏/页面↔流程/角色/实体 交叉解析", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen publishClosure={CLOSURE_CLOSED} model={MODEL} />
    );
    expect(html).toContain('data-testid="appbundle-bindings"');
    expect(html).toContain("打开后首屏");
    // resolved：pageRef → 页面名，workflowRef → workflow id
    expect(html).toContain("选课页");
    expect(html).toContain("wf_enroll");
    // unresolved 标红
    expect(html).toContain("✗ missing_page");
    expect(html).toContain("✗ missing_wf");
    expect(html).toContain("✗ no_such_entity");
    // dataModelRefs resolved → 实体名
    expect(html).toContain("课程");
  });

  it("appbundle.invariants 在场渲染系统不变式面板（陈述 + 系统 + 落地引用）", () => {
    const model: FiveSystemModel = {
      ...MODEL,
      appbundle: {
        ...MODEL.appbundle,
        invariants: [
          {
            id: "inv_pay",
            statement: "支付状态只能由服务端验签回调修改",
            systems: ["workflow", "datamodel"],
            refs: ["course.title"],
          },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <AppBundleScreen model={model} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain('data-testid="appbundle-invariants"');
    expect(html).toContain("系统不变式");
    expect(html).toContain("支付状态只能由服务端验签回调修改");
    expect(html).toContain("course.title");
    expect(html).toContain("workflow");
  });

  it("无 invariants → 不渲染不变式面板（老模型零变化）", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).not.toContain('data-testid="appbundle-invariants"');
  });

  it("invariantNotes 留痕如实展示：自动修复与剔除各出一段（不静默）", () => {
    const model: FiveSystemModel = {
      ...MODEL,
      appbundle: {
        ...MODEL.appbundle,
        invariants: [
          { id: "inv_ok", statement: "选课状态变更必须落库", systems: ["datamodel"], refs: ["enrollment.status"] },
        ],
        invariantNotes: {
          repaired: [{ invariantId: "inv_ok", from: "do_enroll_status", to: "enrollment.status" }],
          dropped: [{ invariantId: "inv_ghost", statement: "引用无效被剔除", unresolvedRefs: ["quantum_module"] }],
        },
      },
    };
    const html = renderToStaticMarkup(
      <AppBundleScreen model={model} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain('data-testid="appbundle-invariant-notes"');
    expect(html).toContain("自动修复 1 处引用");
    expect(html).toContain("do_enroll_status → enrollment.status");
    expect(html).toContain("剔除 1 条引用无效的不变式");
    expect(html).toContain("inv_ghost");
  });

  it("空态：无 publishClosure → 诚实提示，无绑定区", () => {
    const html = renderToStaticMarkup(<AppBundleScreen />);
    expect(html).toContain("发送应用意图后");
    expect(html).toContain("未产出");
    expect(html).not.toContain("0/6");
    expect(html).toContain('data-missing="true"');
    expect(html).not.toContain('data-testid="appbundle-bindings"');
  });

  it("presentationNotes 留痕如实展示（E37：图表/统计卡自动修复与剔除）", () => {
    const model: FiveSystemModel = {
      ...MODEL,
      appbundle: {
        ...MODEL.appbundle,
        presentationNotes: {
          repaired: [{ pageId: "p_dash", path: "dimension", from: "loan.statu", to: "loan.status" }],
          droppedCharts: [{ pageId: "p_dash", chartId: "ch_avg", reason: "图表指标 'avg:x' 只能是 count 或 sum" }],
          clearedFormats: [{ pageId: "p_dash", statId: "st_bad", format: "fancy" }],
          clearedLandingPage: [{ value: "missing_home", reason: "无法唯一解析" }],
          droppedBlocks: [{ pageId: "p_dash", blockId: "magic", type: "MagicWall", reason: "目录外" }],
        },
      },
    };
    const html = renderToStaticMarkup(
      <AppBundleScreen model={model} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain('data-testid="appbundle-presentation-notes"');
    expect(html).toContain("修复 1 处展示引用");
    expect(html).toContain("loan.statu → loan.status");
    expect(html).toContain("剔除 1 个无法渲染的图表");
    expect(html).toContain("ch_avg");
    expect(html).toContain("清除 1 个非法格式声明");
    expect(html).toContain("清除 1 个无效首屏引用");
    expect(html).toContain("剔除 1 个目录外区块");
    expect(html).toContain("MagicWall");
  });

  it("无 presentationNotes → 不渲染该留痕块（老模型零变化）", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).not.toContain('data-testid="appbundle-presentation-notes"');
  });
});

describe("ArchitectureStage", () => {
  it("无模型：空沙盘 + 红 Checks，不是六圆钮", () => {
    const html = renderToStaticMarkup(
      <ArchitectureStage onInspect={() => {}} publishClosure={null} />
    );
    expect(html).toContain('data-testid="sliderule-architecture-stage"');
    expect(html).toContain('data-testid="architecture-empty"');
    expect(html).toContain('data-testid="architecture-checks"');
    expect(html).toContain("Checks 未产出");
    expect(html).not.toContain("Checks 0/6");
    expect(html).not.toContain("Checks 6/6");
  });

  it("本跳只跑 spec 时不许沿用上一版 6/6", () => {
    const html = renderToStaticMarkup(
      <ArchitectureStage
        onInspect={() => {}}
        publishClosure={CLOSURE_CLOSED}
        roundTools={["spec"]}
      />
    );
    expect(html).toContain("Checks 未产出");
    expect(html).not.toContain("Checks 6/6");
    expect(html).toContain("text-red-600");
    expect(html).not.toContain("bg-blue-400");
    expect(html).not.toContain("SkillThumbnailBar");
    expect(html).not.toContain("发布证据看板");
  });

  it("有模型：默认沙盘（组在图上），Checks 吃闭环", () => {
    const html = renderToStaticMarkup(
      <ArchitectureStage
        model={MODEL}
        publishClosure={CLOSURE_CLOSED}
        onInspect={() => {}}
      />
    );
    expect(html).toContain('data-testid="system-linkage-graph"');
    expect(html).toContain('data-testid="architecture-graph-style"');
    expect(html).toContain("沙盘");
    expect(html).toContain("架构图");
    expect(html).toContain("Checks 6/6");
    expect(html).not.toContain('data-testid="architecture-empty"');
    expect(html).not.toContain("appbundle-mode-toggle");
    expect(html).not.toContain("图例");
    expect(html).toContain('data-testid="sandbox-problems"');
  });

  it("图上的组对应抽屉系统屏（AppBundle 不在映射里）", () => {
    expect(LINKAGE_TO_SKILL).toEqual({
      datamodel: "dataModel",
      page: "page",
      workflow: "workflow",
      rbac: "rbac",
      aigc: "aigc",
    });
    expect(LINKAGE_TO_SKILL).not.toHaveProperty("appbundle");
  });
});

// ---------------------------------------------------------------------------
// ActiveSystemScreen — 派发 + skillContents 模型注入集成
// ---------------------------------------------------------------------------

describe("ActiveSystemScreen 派发", () => {
  it("skillContents 携带模型 JSON 时，workflow 屏拿到交叉引用后的模型", () => {
    const html = renderToStaticMarkup(
      <ActiveSystemScreen
        activeSkillId="workflow"
        skillContents={{ workflow: JSON.stringify(MODEL) }}
        publishClosure={CLOSURE_CLOSED}
      />
    );
    expect(html).toContain("3 节点 · 2 转移");
    expect(html).toContain("✗ not_a_role"); // rbac 段共享给 workflow 屏做交叉校验
  });

  it("无激活 Skill 默认 AppBundle 看板（含模型绑定）", () => {
    const html = renderToStaticMarkup(
      <ActiveSystemScreen
        activeSkillId={null}
        skillContents={{ appBundle: JSON.stringify(MODEL) }}
        publishClosure={CLOSURE_CLOSED}
      />
    );
    expect(html).toContain("Checks");
    expect(html).toContain('data-testid="appbundle-evidence-list"');
    expect(html).toContain('data-testid="appbundle-bindings"');
    expect(html).not.toContain("发布证据看板");
    expect(html).not.toContain("appbundle-mode-toggle");
  });

  it("aigc 激活时能力卡片可见", () => {
    const html = renderToStaticMarkup(
      <ActiveSystemScreen
        activeSkillId="aigc"
        skillContents={{ aigc: JSON.stringify(MODEL) }}
      />
    );
    expect(html).toContain('data-testid="aigc-capabilities"');
    expect(html).toContain("课程简介生成");
  });

  it("reload 路径：无 skillContents，仅 publishClosure.perSkillEvidence.modelSection 也能渲染模型", () => {
    const closureWithModel: PublishClosureSummary = {
      ...CLOSURE_CLOSED,
      perSkillEvidence: {
        datamodel: { evidencePresent: true, modelSection: MODEL.datamodel as Record<string, unknown> },
        rbac: { evidencePresent: true, modelSection: MODEL.rbac as Record<string, unknown> },
        workflow: { evidencePresent: true, modelSection: MODEL.workflow as Record<string, unknown> },
        page: { evidencePresent: true, modelSection: MODEL.page as Record<string, unknown> },
        aigc: { evidencePresent: true, modelSection: MODEL.aigc as Record<string, unknown> },
        appbundle: { evidencePresent: true, modelSection: MODEL.appbundle as Record<string, unknown> },
      },
    };
    const workflowHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="workflow" publishClosure={closureWithModel} />
    );
    expect(workflowHtml).toContain("3 节点 · 2 转移");
    expect(workflowHtml).toContain("✓ student"); // 角色图例条（节点卡在画布内，静态渲染不含）
    const aigcHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="aigc" publishClosure={closureWithModel} />
    );
    expect(aigcHtml).toContain('data-testid="aigc-capabilities"');
    expect(aigcHtml).toContain("课程简介生成");
    const bundleHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId={null} publishClosure={closureWithModel} />
    );
    expect(bundleHtml).toContain('data-testid="appbundle-bindings"');
  });

  it("确定性域（无 modelSection）不伪造模型：closed 6/6 但各屏走降级链", () => {
    const workflowHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="workflow" publishClosure={CLOSURE_CLOSED} />
    );
    // 无模型 → 不出现节点角色表；证据徽标仍如实展示
    expect(workflowHtml).not.toContain('data-testid="workflow-node-roles"');
    expect(workflowHtml).toContain("evidence ✓");
    const aigcHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="aigc" publishClosure={CLOSURE_CLOSED} />
    );
    expect(aigcHtml).not.toContain('data-testid="aigc-capabilities"');
  });
});

// ---------------------------------------------------------------------------
// 诚实路径标注 — 来源徽章（LLM 生成 / 内置演示域）+ 占位明示 + datamodel 重建
// ---------------------------------------------------------------------------

const CLOSURE_BUILTIN: PublishClosureSummary = {
  ...CLOSURE_CLOSED,
  perSkillEvidence: {
    datamodel: { evidencePresent: true, artifactId: "runtime-linkage-datamodel" },
    rbac: { evidencePresent: true, artifactId: "runtime-linkage-rbac" },
    workflow: { evidencePresent: true, artifactId: "runtime-linkage-workflow" },
    page: { evidencePresent: true, artifactId: "runtime-linkage-page" },
    aigc: { evidencePresent: true, artifactId: "runtime-linkage-aigc" },
    appbundle: { evidencePresent: true, artifactId: "runtime-linkage-appbundle" },
  },
};

describe("诚实路径标注（来源徽章 + 占位明示）", () => {
  it("evidenceSourceOf：artifactId 前缀 → 来源；识别不了返回 null", () => {
    expect(evidenceSourceOf({ artifactId: "llm-linkage-page" })).toEqual({
      kind: "llm",
      label: "LLM 生成",
    });
    expect(evidenceSourceOf({ artifactId: "runtime-linkage-page" })).toEqual({
      kind: "builtin",
      label: "内置演示域",
    });
    expect(evidenceSourceOf({ evidenceRef: "llm-linkage-rbac" })?.kind).toBe("llm");
    expect(evidenceSourceOf({ artifactId: "something-else" })).toBeNull();
    expect(evidenceSourceOf(null)).toBeNull();
  });

  it("LLM 闭环：各系统屏头部出现「LLM 生成」珊瑚徽章", () => {
    for (const skill of ["workflow", "rbac", "page", "aigc", "dataModel"] as const) {
      const html = renderToStaticMarkup(
        <ActiveSystemScreen activeSkillId={skill} publishClosure={CLOSURE_CLOSED} />
      );
      expect(html).toContain('data-testid="evidence-source-llm"');
      expect(html).toContain("LLM 生成");
      expect(html).toContain("evidence ✓");
    }
  });

  it("内置演示域闭环：各系统屏 + AppBundle 看板出现「内置演示域」琥珀徽章", () => {
    const workflowHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="workflow" publishClosure={CLOSURE_BUILTIN} />
    );
    expect(workflowHtml).toContain('data-testid="evidence-source-builtin"');
    expect(workflowHtml).toContain("内置演示域");
    const bundleHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId={null} publishClosure={CLOSURE_BUILTIN} />
    );
    expect(bundleHtml).toContain('data-testid="evidence-source-builtin"');
  });

  it("无证据时不渲染任何徽章（不猜、不冒充）", () => {
    const html = renderToStaticMarkup(<ActiveSystemScreen activeSkillId="workflow" />);
    expect(html).not.toContain("evidence ✓");
    expect(html).not.toContain("evidence-source-");
  });

  it("datamodelToMermaid：实体字段 → erDiagram；空实体 fail-closed 返回 null", () => {
    const diagram = datamodelToMermaid(MODEL.datamodel);
    expect(diagram).not.toBeNull();
    expect(diagram).toContain("erDiagram");
    expect(diagram).toContain("course {");
    expect(diagram).toContain("string title");
    expect(datamodelToMermaid({ entities: [] })).toBeNull();
    expect(datamodelToMermaid(undefined)).toBeNull();
  });

  it("datamodelToMermaid：ref/*_ref 字段生成关联边（词干唯一匹配，歧义不画线）", () => {
    // 复现真实产出的命名形态：user_ref→user_profile（包含）、birth_ref→birth_info（前缀）、
    // chart_ref→wuyun_liuqi_chart（后缀）
    const diagram = datamodelToMermaid({
      entities: [
        { id: "user_profile", fields: [{ id: "user_id", type: "string" }] },
        { id: "birth_info", fields: [{ id: "user_ref", type: "ref" }] },
        { id: "wuyun_liuqi_chart", fields: [{ id: "birth_ref", type: "ref" }] },
        {
          id: "constitution_assessment",
          fields: [
            { id: "chart_ref", type: "ref" },
            { id: "user_ref", type: "string" }, // 命名约定即可，不要求 type=ref
          ],
        },
      ],
    })!;
    expect(diagram).toContain('user_profile ||--o{ birth_info : "user_ref"');
    expect(diagram).toContain('birth_info ||--o{ wuyun_liuqi_chart : "birth_ref"');
    expect(diagram).toContain('wuyun_liuqi_chart ||--o{ constitution_assessment : "chart_ref"');
    expect(diagram).toContain('user_profile ||--o{ constitution_assessment : "user_ref"');
    // user_profile 自己的 user_id 不产生自引用边
    expect(diagram).not.toContain("user_profile ||--o{ user_profile");
    // 歧义（两个候选）不画线
    const ambiguous = datamodelToMermaid({
      entities: [
        { id: "order_item", fields: [] },
        { id: "order_log", fields: [] },
        { id: "shipment", fields: [{ id: "order_ref", type: "ref" }] },
      ],
    })!;
    expect(ambiguous).not.toContain("||--o{ shipment");
  });

  it("deriveErGraphData：实体卡数据 + 关联边（G6 渲染路径，与 mermaid 同一套推断）", () => {
    const data = deriveErGraphData({
      entities: [
        { id: "user_profile", name: "用户", fields: [{ id: "name", name: "姓名", type: "string" }] },
        { id: "birth_info", fields: [{ id: "user_ref", name: "所属用户", type: "ref" }] },
      ],
    })!;
    expect(data.nodes.map((n) => n.id)).toEqual(["user_profile", "birth_info"]);
    expect(data.nodes[0].name).toBe("用户");
    expect(data.nodes[1].fields[0].refTarget).toBe("user_profile");
    expect(data.edges).toEqual([
      { source: "birth_info", target: "user_profile", label: "user_ref" },
    ]);
    expect(deriveErGraphData({ entities: [] })).toBeNull();
  });

  it("ErTableCard：字段名在左、类型在右，PK/FK 标在行上，无暖色表头", () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ErTableCard
          er={{
            id: "birth_info",
            name: "出生信息",
            fields: [
              { id: "id", name: "编号", type: "string", refTarget: null },
              { id: "user_ref", name: "所属用户", type: "ref", refTarget: "user_profile" },
              { id: "date", name: "日期", type: "date", refTarget: null },
            ],
          }}
        />
      </ReactFlowProvider>
    );
    expect(html).toContain('data-testid="er-table-birth_info"');
    expect(html).toContain('data-testid="er-field-birth_info-id"');
    expect(html).toContain('data-pk="true"');
    expect(html).toContain('data-testid="er-field-birth_info-user_ref"');
    expect(html).toContain('data-fk="true"');
    expect(html).toContain("所属用户");
    expect(html).toContain("ref");
    // 名在左、类型在右：所属用户 出现在 ref 之前（同一行里）
    expect(html.indexOf("所属用户")).toBeLessThan(html.indexOf(">ref<"));
    // 不该有：暖色边、浅蓝表头、类型在左、行内 → target。变异加回必红。
    expect(html).not.toContain("#E3DED2");
    expect(html).not.toContain("#eef0f4");
    expect(html).not.toContain("#f4f1ea");
    expect(html).not.toContain("→ user_profile");
  });

  it("pkHandleId：有 id 字段接到 id，否则接到表头", () => {
    expect(
      pkHandleId({
        id: "u",
        name: "用户",
        fields: [{ id: "id", name: "编号", type: "string", refTarget: null }],
      })
    ).toBe("id");
    expect(
      pkHandleId({
        id: "u",
        name: "用户",
        fields: [{ id: "name", name: "姓名", type: "string", refTarget: null }],
      })
    ).toBe("table");
    expect(isPkField({ id: "id", name: "编号", type: "string", refTarget: null })).toBe(true);
    expect(isPkField({ id: "user_ref", name: "用户", type: "ref", refTarget: "u" })).toBe(false);
  });

  it("ER 图两条路都吃 refEntity 声明 —— 名字对不上的关系以前根本画不出来", () => {
    // assigned_team → oncall_teams：词干完全不同，猜测无解。这是真实样本里
    // 最常见的失败形态（181 份模型 1689 个 ref 字段，猜得出的只有 41%）。
    const entities = [
      { id: "oncall_teams", name: "值班组", fields: [{ id: "name", type: "string" }] },
      {
        id: "alert_event",
        name: "告警",
        fields: [{ id: "assigned_team", name: "值班组", type: "ref", refEntity: "oncall_teams" }],
      },
    ];
    const data = deriveErGraphData({ entities })!;
    expect(data.edges).toEqual([
      { source: "alert_event", target: "oncall_teams", label: "assigned_team" },
    ]);
    expect(datamodelToMermaid({ entities })).toContain(
      'oncall_teams ||--o{ alert_event : "assigned_team"'
    );

    // 反向：摘掉声明就画不出这条边——证明上面测的是声明在起作用，
    // 不是"这个名字本来就猜得对"
    const undeclared = [
      entities[0],
      { ...entities[1], fields: [{ id: "assigned_team", name: "值班组", type: "ref" }] },
    ];
    expect(deriveErGraphData({ entities: undeclared })!.edges).toEqual([]);

    // 悬空声明不回落去猜：模型说错了就不画，别拿猜出来的目标盖掉
    const dangling = [
      { id: "oncall_teams", fields: [] },
      { id: "team", fields: [{ id: "oncall_teams_ref", type: "ref", refEntity: "ghost" }] },
    ];
    expect(deriveErGraphData({ entities: dangling })!.edges).toEqual([]);
  });

  it("deriveWorkflowGraphData：始/终判定、角色解析、条件边（G6 活图路径）", () => {
    const data = deriveWorkflowGraphData(MODEL)!;
    const byId = Object.fromEntries(data.nodes.map((n) => [n.id, n]));
    expect(byId.submit.isStart).toBe(false); // approve→submit 退回边使其有入边
    expect(byId.ghost.isStart).toBe(true); // 无入边
    expect(byId.ghost.isTerminal).toBe(true); // 无出边
    expect(byId.submit.roleResolved).toBe(true);
    expect(byId.ghost.role).toBe("not_a_role");
    expect(byId.ghost.roleResolved).toBe(false); // 未在 rbac.roles 声明 → 标红
    expect(data.edges).toContainEqual({ from: "submit", to: "approve", condition: "容量未满" });
    expect(deriveWorkflowGraphData({})).toBeNull();
  });

  it("deriveSystemLinkageGraph：五系统分组 + 跨系统边（联动图路径）", () => {
    const data = deriveSystemLinkageGraph(MODEL)!;
    expect(data.groups.map((g) => g.system)).toEqual([
      "datamodel",
      "page",
      "workflow",
      "rbac",
      "aigc",
    ]);
    // 页面→主实体（course）、页面→流程起点（ghost 无入边为起点候选之一）、节点→角色、AIGC→输出实体/角色
    expect(data.edges).toContainEqual({ from: "page:enroll_page", to: "datamodel:course", kind: "page-entity" });
    expect(data.edges.some((e) => e.kind === "page-workflow" && e.from === "page:enroll_page")).toBe(true);
    expect(data.edges).toContainEqual({ from: "workflow:submit", to: "rbac:student", kind: "node-role" });
    expect(data.edges).toContainEqual({ from: "aigc:cap_summary", to: "datamodel:enrollment", kind: "aigc-entity" });
    expect(data.edges).toContainEqual({ from: "aigc:cap_summary", to: "rbac:teacher", kind: "aigc-role" });
    // 悬空引用不入图（ghost_role 未在 roles 声明）
    expect(data.edges.some((e) => e.to === "rbac:ghost_role")).toBe(false);
    expect(deriveSystemLinkageGraph({})).toBeNull();
  });

  it("derivePhaseLanes：全节点带 phase 且 ≥2 阶段才启用；缺失/单阶段回退 null", () => {
    const data = deriveWorkflowGraphData({
      workflow: {
        nodes: [
          { id: "a", name: "填写申请", phase: "申请" },
          { id: "b", name: "初审", phase: "审核" },
          { id: "c", name: "复审", phase: "审核" },
          { id: "d", name: "归档", phase: "收尾" },
        ],
        transitions: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "d" },
        ],
      },
    })!;
    expect(data.nodes[0].phase).toBe("申请");
    const lanes = derivePhaseLanes(data.nodes)!;
    expect(lanes.map((l) => l.phase)).toEqual(["申请", "审核", "收尾"]);
    expect(lanes[1].nodeIds).toEqual(["b", "c"]);
    // 有节点缺 phase → null（不猜归属，回退平铺布局）
    const partial = deriveWorkflowGraphData({
      workflow: { nodes: [{ id: "a", phase: "申请" }, { id: "b" }], transitions: [] },
    })!;
    expect(derivePhaseLanes(partial.nodes)).toBeNull();
    // 只有一个阶段 → null（单泳道无意义）
    const single = deriveWorkflowGraphData({
      workflow: {
        nodes: [{ id: "a", phase: "申请" }, { id: "b", phase: "申请" }],
        transitions: [],
      },
    })!;
    expect(derivePhaseLanes(single.nodes)).toBeNull();
  });

  it("linkageToMermaid：五系统 subgraph 分组 + 语义标签边 + 系统配色；空模型 null", () => {
    const chart = linkageToMermaid(MODEL)!;
    expect(chart).toContain("flowchart TB");
    expect(chart).toContain('subgraph sg_datamodel["数据中台 · DataModel"]');
    expect(chart).toContain('subgraph sg_rbac["权限 · RBAC"]');
    // key 净化：page:enroll_page → page__enroll_page（成员全部展开在组内）
    expect(chart).toContain("page__enroll_page");
    // 组间捆扎边：语义标签 + 条数（成员级逐条边留给交互图）
    expect(chart).toMatch(/sg_page -->\|"字段绑定 ×\d+"\| sg_datamodel/);
    expect(chart).toMatch(/sg_workflow -->\|"审批人 ×\d+"\| sg_rbac/);
    expect(chart).toMatch(/sg_aigc -->\|"写回字段 ×\d+"\| sg_datamodel/);
    // 捆扎函数是架构图和沙盘 L2 的同一份
    const bundled = bundleLinkageEdges(
      deriveSystemLinkageGraph(MODEL)!.edges
    );
    expect(bundled.some(e => e.label === "字段绑定")).toBe(true);
    expect(chart).not.toContain("ghost_role");
    // 系统配色：classDef + class 绑定
    expect(chart).toContain("classDef workflow");
    expect(chart).toMatch(/class .*workflow__submit.* workflow/);
    // 悬空引用不入图（与交互图一致）
    expect(chart).not.toContain("ghost_role");
    expect(linkageToMermaid({})).toBeNull();
    expect(linkageToMermaid(undefined)).toBeNull();
  });

  // 注意：ActiveSystemScreen 全屏常挂载（hidden），负向断言必须直渲染目标屏，
  // 否则其他隐藏屏的占位文案会串进同一份 HTML。
  it("DataModel 屏 reload 路径：模型实体重建真实 ER，不再显示采购占位", () => {
    const html = renderToStaticMarkup(
      <DataModelScreen
        publishClosure={CLOSURE_CLOSED}
        model={{ datamodel: MODEL.datamodel }}
      />
    );
    expect(html).not.toContain("占位示意");
    expect(html).not.toContain("PurchaseOrder");
  });

  it("DataModel/Page 屏空态不再渲染假域示例，只显示诚实空状态提示", () => {
    const dmHtml = renderToStaticMarkup(<DataModelScreen />);
    expect(dmHtml).toContain('data-testid="screen-empty-hint"');
    expect(dmHtml).toContain("实体关系图");
    expect(dmHtml).not.toContain("PurchaseOrder"); // 采购假域示例已移除
    const pageHtml = renderToStaticMarkup(<PageScreen />);
    expect(pageHtml).toContain('data-testid="screen-empty-hint"');
    expect(pageHtml).not.toContain("采购申请表");
  });

  it("RBAC 屏模型路径：roles/menus/permissions 真实渲染，未声明权限标红", () => {
    const modelWithUndeclaredPerm: FiveSystemModel = {
      ...MODEL,
      rbac: {
        roles: ["student", "registrar"],
        permissions: ["course:read"],
        menus: [
          { id: "m1", label: "选课", roleRefs: ["student"], permissionRefs: ["course:read"] },
          { id: "m2", label: "审批台", roleRefs: ["registrar"], permissionRefs: ["course:approve"] }, // 未声明
        ],
      },
    };
    const html = renderToStaticMarkup(<RbacScreen model={modelWithUndeclaredPerm} />);
    expect(html).toContain("student");
    expect(html).toContain("registrar");
    expect(html).toContain("选课");
    expect(html).toContain("审批台");
    expect(html).toContain("2 角色 · 1 权限 · 2 菜单");
    expect(html).toContain("course:read");
    expect(html).toContain("✗ course:approve"); // 未在 permissions 清单声明 → 标红
    expect(html).not.toContain("占位示意");
    expect(html).not.toContain("采购单:创建"); // 不再显示采购占位
  });

  it("RBAC 屏无模型时显示空状态提示，有模型时优先于 rawContent", () => {
    const placeholderHtml = renderToStaticMarkup(<RbacScreen />);
    expect(placeholderHtml).toContain('data-testid="screen-empty-hint"');
    expect(placeholderHtml).not.toContain("采购单:创建"); // 采购假域占位已移除
    const modelHtml = renderToStaticMarkup(
      <RbacScreen model={MODEL} rawContent={"# 角色: 文本角色\n权限: something"} />
    );
    expect(modelHtml).toContain("student"); // model 优先
    expect(modelHtml).not.toContain("文本角色");
  });

  it("Page 屏模型路径：pages[].fieldBindings 交叉解析渲染，未解析绑定标红", () => {
    const modelWithBrokenBinding: FiveSystemModel = {
      ...MODEL,
      page: {
        pages: [
          {
            id: "enroll_page",
            name: "选课页",
            fieldBindings: ["course.title", "nonexistent.field"],
            actionPermissions: ["course:read"],
          },
        ],
      },
    };
    const html = renderToStaticMarkup(<PageScreen model={modelWithBrokenBinding} />);
    expect(html).toContain("选课页");
    expect(html).toContain("课程.课程名"); // resolved → 实体名.字段名
    expect(html).toContain("✗ nonexistent.field"); // unresolved 如实标红
    expect(html).toContain("course:read");
    expect(html).toContain('data-testid="salt-page-enroll_page"');
    expect(html).not.toContain("占位示意");
    expect(html).not.toContain("采购申请表");
    expect(html).not.toContain("bg-teal-400");
    expect(html).not.toContain("bg-teal-500");
  });

  it("SaltPageCard：假窗顶栏、字段名在左空槽在右、动作全灰", () => {
    const html = renderToStaticMarkup(
      <SaltPageCard
        page={{
          id: "enroll_page",
          title: "选课页",
          fields: [
            { ref: "course.title", name: "课程.课程名", bound: true },
            { ref: "nonexistent.field", name: "nonexistent.field", bound: false },
          ],
          actions: ["course:read", "course:create"],
        }}
      />
    );
    expect(html).toContain('data-testid="salt-page-enroll_page"');
    expect(html).toContain('data-testid="salt-page-chrome"');
    expect(html).toContain('data-testid="salt-window-dots"');
    expect(html).toContain("选课页");
    expect(html).toContain("enroll_page");
    expect(html).toContain('data-testid="salt-field-course.title"');
    expect(html).toContain('data-bound="true"');
    expect(html).toContain("课程.课程名");
    expect(html).toContain('data-testid="salt-field-nonexistent.field"');
    expect(html).toContain("✗ nonexistent.field");
    expect(html).toContain('data-testid="salt-action-course:read"');
    expect(html).toContain('data-testid="salt-action-course:create"');
    // 名在左、空槽在右：字段名出现在本行空槽之前
    const nameAt = html.indexOf("课程.课程名");
    const slotAt = html.indexOf('data-slot="empty"');
    expect(nameAt).toBeGreaterThan(-1);
    expect(slotAt).toBeGreaterThan(nameAt);
    // 不该有：灰底卡、teal 圆点、第一个动作涂实心。变异加回必红。
    expect(html).not.toContain("#eef0f4");
    expect(html).not.toContain("bg-teal-400");
    expect(html).not.toContain("bg-teal-500");
    expect(html).not.toContain("text-white");
  });
});

describe("浏览器运行时（试运行）入口", () => {
  it("Workflow 屏有模型时显示 流程图/试运行 切换；无模型不显示", () => {
    const withModel = renderToStaticMarkup(
      <WorkflowScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(withModel).toContain('data-testid="workflow-mode-toggle"');
    expect(withModel).toContain("试运行");
    const withoutModel = renderToStaticMarkup(<WorkflowScreen />);
    expect(withoutModel).not.toContain('data-testid="workflow-mode-toggle"');
  });

  it("WorkflowRuntimePanel 初始态提供「发起实例」", () => {
    const html = renderToStaticMarkup(
      <WorkflowRuntimePanel model={MODEL} sessionId="t-runtime" />
    );
    expect(html).toContain('data-testid="workflow-runtime-panel"');
    expect(html).toContain('data-testid="runtime-start"');
    expect(html).toContain("发起实例");
    expect(html).toContain("ant-card");
    expect(html).toContain("ant-btn");
  });

  it("DataModelScreen 有实体时提供「模型图⟷数据表」切换；无模型不显示", () => {
    const withModel = renderToStaticMarkup(<DataModelScreen model={MODEL} sessionId="t-dm" />);
    expect(withModel).toContain('data-testid="datamodel-mode-toggle"');
    expect(withModel).toContain("数据表");
    expect(withModel).toContain('data-testid="er-graph"');
    expect(withModel).not.toContain("bg-blue-400");
    const withoutModel = renderToStaticMarkup(<DataModelScreen />);
    expect(withoutModel).not.toContain('data-testid="datamodel-mode-toggle"');
  });

  it("AigcScreen 有能力清单时提供「能力清单⟷能力试跑」切换；无模型不显示", () => {
    const withModel = renderToStaticMarkup(<AigcScreen model={MODEL} />);
    expect(withModel).toContain('data-testid="aigc-mode-toggle"');
    expect(withModel).toContain("能力试跑");
    const withoutModel = renderToStaticMarkup(<AigcScreen />);
    expect(withoutModel).not.toContain('data-testid="aigc-mode-toggle"');
  });

  it("AigcTryRunPanel 按能力切页、输入字段解析实体名、提供「试跑」", () => {
    const html = renderToStaticMarkup(<AigcTryRunPanel model={MODEL} goal="选课系统" />);
    expect(html).toContain('data-testid="aigc-tryrun-panel"');
    expect(html).toContain('data-testid="aigc-tryrun-cap-cap_summary"');
    expect(html).toContain('data-testid="aigc-tryrun-run"');
    expect(html).toContain("试跑");
    expect(html).toContain("课程"); // resolveFieldRef 解析出实体名
    expect(html).toContain("ant-segmented");
    expect(html).toContain("ant-input");
    expect(html).toContain("ant-btn");
  });

  it("EntityDataPanel 按实体切页并提供「新增一行」（空表铺演示种子并如实标注）", () => {
    const html = renderToStaticMarkup(<EntityDataPanel model={MODEL} sessionId="t-dm" />);
    expect(html).toContain('data-testid="datamodel-data-panel"');
    expect(html).toContain('data-testid="datamodel-entity-course"');
    expect(html).toContain('data-testid="datamodel-entity-enrollment"');
    expect(html).toContain('data-testid="datamodel-add-row"');
    expect(html).toContain("容量"); // 字段列头来自实体定义
    expect(html).toContain("ant-segmented");
    expect(html).toContain("ant-table");
    expect(html).toContain("ant-input");
    expect(html).toContain("ant-btn");
    // 2026-07-28：零行的实体不再是一句"暂无数据"，而是铺一批演示种子
    //（demo-seed.ts）。种子必须带标注——没有这条断言，哪天标注被删掉
    // 就变成不打招呼的假数据了。
    expect(html).not.toContain("暂无数据");
    expect(html).toContain('data-testid="datamodel-seed-notice"');
    expect(html).toContain("示例数据");
    // 种子值可读且确定性。原来钉的是字面量「课程名 1」，那是按类型出值时代的
    // 朴素形态；现在「课程名」会先摘掉元词「名」再修饰成「高原课程」这类
    // 词——钉死字面量等于把"不许变好"也一起钉住了。这里只锁真正要保的两点：
    // 表里确实铺出了带实体词的可读值，且不是原封不动的字段名加序号。
    expect(html).toMatch(/value="[^"]*课程"/);
    expect(html).not.toContain("课程名 1");
  });
});
