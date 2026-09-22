/**
 * 方向 B（应用主舞台 + X 光）回归：
 * - derivePageXray 纯函数：home 全景切片 / 具体页面切片（主实体、可见角色、流程、AI）
 * - SlideRuleStudio 三态：无模型 → board（接线沙盘在场，无应用舞台）
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  derivePageXray,
  describeXrayTarget,
  htmlBindingToXrayTarget,
  XrayPanel,
} from "../XrayPanel";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import { SlideRuleStudio } from "../SlideRuleStudio";
import { SlideRuleTopHud } from "../SlideRuleTopHud";
import { StudioLayoutProvider } from "../StudioLayoutContext";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "pet",
        name: "宠物档案",
        fields: [
          { id: "name", name: "昵称" },
          { id: "species", name: "物种" },
        ],
      },
      { id: "booking", name: "预约单", fields: [{ id: "date", name: "档期" }] },
    ],
  },
  rbac: {
    roles: ["owner", "host"],
    permissions: ["pet:read", "pet:create"],
    menus: [
      {
        id: "m1",
        label: "宠物",
        roleRefs: ["owner"],
        permissionRefs: ["pet:read", "pet:create"],
      },
      {
        id: "m2",
        label: "预约",
        roleRefs: ["host"],
        permissionRefs: ["booking:read"],
      },
    ],
  },
  workflow: {
    nodes: [
      { id: "n1", name: "提交申请", assigneeRole: "owner" },
      { id: "n2", name: "审核", assigneeRole: "host" },
    ],
    transitions: [{ from: "n1", to: "n2" }],
  },
  page: {
    pages: [
      {
        id: "pet_page",
        name: "宠物档案页",
        fieldBindings: ["pet.name", "pet.species"],
        actionPermissions: ["pet:read", "pet:create"],
      },
    ],
  },
  aigc: {
    capabilities: [
      {
        id: "cap1",
        name: "生成护理建议",
        inputFields: ["pet.species"],
        outputField: "pet.name",
      },
    ],
  },
  appbundle: {
    pageBindings: [{ pageRef: "pet_page", workflowRef: "boarding_flow" }],
  },
};

describe("derivePageXray", () => {
  const schema = deriveAppRuntimeSchema(MODEL, "测试应用")!;

  it("home → 全景切片：五系统各一节，条目非空", () => {
    const xray = derivePageXray(MODEL, schema, "home");
    expect(xray.pageTitle).toContain("全景");
    const bySkill = Object.fromEntries(xray.sections.map(s => [s.skill, s]));
    expect(bySkill.dataModel.items.join()).toContain("宠物档案");
    expect(bySkill.workflow.items).toContain("提交申请");
    expect(bySkill.rbac.items.join()).toContain("owner");
    expect(bySkill.page.items.length).toBeGreaterThan(0);
    expect(bySkill.aigc.items).toContain("生成护理建议");
  });

  it("具体页面 → 主实体/可见角色/绑定流程/AI 动作如实透视", () => {
    const xray = derivePageXray(MODEL, schema, "pet_page");
    const bySkill = Object.fromEntries(xray.sections.map(s => [s.skill, s]));
    expect(bySkill.dataModel.items.join()).toContain("宠物档案");
    // 只有持有 pet:read/pet:create 的 owner 能看到本页；host 不能
    expect(bySkill.rbac.items).toContain("owner");
    expect(bySkill.rbac.items).not.toContain("host");
    // appbundle.pageBindings 绑了 boarding_flow
    expect(bySkill.workflow.items.join()).toContain("boarding_flow");
    // AI 动作写回 pet.name
    expect(bySkill.aigc.items.join()).toContain("生成护理建议");
  });

  it("XrayPanel 静态渲染：面板 + 各节 + 联动总图入口", () => {
    const html = renderToStaticMarkup(
      <XrayPanel
        model={MODEL}
        schema={schema}
        activePageId="pet_page"
        onOpenSystem={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-xray-panel"');
    expect(html).toContain('data-testid="xray-section-dataModel"');
    expect(html).toContain('data-testid="xray-section-appBundle"');
    expect(html).toContain("宠物档案页");
    expect(html).toContain("打开沙盘");
    // ⚠ 2026-08-28 用户裁决：这个面板的名字从「透视」改成「关联」。
    expect(html).toContain("关联");
    expect(html).not.toContain("透视");
    expect(html).toContain('data-testid="xray-hover-hint"');
    expect(html).not.toContain("游标 · 页面背后");
    expect(html).not.toContain("五系统联动总图");
  });
});

describe("describeXrayTarget（元素级 AR 焦点解读）", () => {
  const schema = deriveAppRuntimeSchema(MODEL, "测试应用")!;

  it("field → 实体.字段 + 页面绑定 + AI 读写", () => {
    const d = describeXrayTarget(MODEL, {
      kind: "field",
      entityId: "pet",
      fieldId: "species",
      label: "物种",
    });
    expect(d.skill).toBe("dataModel");
    expect(d.title).toContain("宠物档案");
    expect(d.title).toContain("物种");
    expect(d.lines.join()).toContain("宠物档案页"); // 被本页绑定
    expect(d.lines.join()).toContain("生成护理建议"); // AI 读取 pet.species
  });

  it("action → 权限声明 + 当前角色判定 + 持有角色", () => {
    const d = describeXrayTarget(MODEL, {
      kind: "action",
      label: "新建",
      pageId: "pet_page",
      permission: "pet:create",
      granted: false,
      role: "host",
    });
    expect(d.skill).toBe("rbac");
    expect(d.lines.join()).toContain("pet:create");
    expect(d.lines.join()).toContain("host 未持有");
    expect(d.lines.join()).toContain("owner"); // 持有角色
  });

  it("menu → 页面声明 + 可见角色；ai → 输入/写回", () => {
    const m = describeXrayTarget(MODEL, {
      kind: "menu",
      pageId: "pet_page",
      label: "宠物档案页",
    });
    expect(m.skill).toBe("page");
    expect(m.lines.join()).toContain("owner");
    const a = describeXrayTarget(MODEL, {
      kind: "ai",
      capId: "cap1",
      label: "生成护理建议",
    });
    expect(a.skill).toBe("aigc");
    expect(a.lines.join()).toContain("pet.species");
    expect(a.lines.join()).toContain("pet.name");
  });

  it("XrayPanel 带 target 渲染 AR 焦点卡", () => {
    const html = renderToStaticMarkup(
      <XrayPanel
        model={MODEL}
        schema={schema}
        activePageId="pet_page"
        target={{
          kind: "field",
          entityId: "pet",
          fieldId: "name",
          label: "昵称",
        }}
        onOpenSystem={() => {}}
      />
    );
    expect(html).toContain('data-testid="xray-focus"');
    expect(html).toContain("昵称");
  });
});

describe("htmlBindingToXrayTarget（HTML 悬停 → 游标目标的翻译层）", () => {
  /** 造一个够用的 Element 桩：node 环境没有 DOM，翻译函数只用这三样。 */
  const fakeEl = (
    attrs: Record<string, string> = {},
    opts: { rowsEntity?: string; text?: string } = {}
  ) =>
    ({
      getAttribute: (n: string) => attrs[n] ?? null,
      closest: () =>
        opts.rowsEntity ? { getAttribute: () => opts.rowsEntity } : null,
      textContent: opts.text ?? "",
    }) as unknown as Element;

  it("data-field 带点号 → field 目标（entity.field 直接拆）", () => {
    const t = htmlBindingToXrayTarget(
      { attr: "data-field", value: "pet.species", el: fakeEl() },
      "p1"
    );
    expect(t).toEqual({
      kind: "field",
      entityId: "pet",
      fieldId: "species",
      label: "pet.species",
    });
  });

  it("data-field 裸字段名 → 实体取最近的 data-rows 容器；无容器如实 null", () => {
    const inRows = htmlBindingToXrayTarget(
      { attr: "data-field", value: "name", el: fakeEl({}, { rowsEntity: "pet" }) },
      "p1"
    );
    expect(inRows).toEqual({
      kind: "field",
      entityId: "pet",
      fieldId: "name",
      label: "pet.name",
    });
    const orphan = htmlBindingToXrayTarget(
      { attr: "data-field", value: "name", el: fakeEl() },
      "p1"
    );
    expect(orphan).toBeNull();
  });

  it("data-rows / data-head → entity 目标；data-chart 取元素上的 entity+dimension", () => {
    expect(
      htmlBindingToXrayTarget({ attr: "data-rows", value: "booking", el: fakeEl() }, "p1")
    ).toEqual({ kind: "entity", entityId: "booking", label: "booking" });
    expect(
      htmlBindingToXrayTarget(
        {
          attr: "data-chart",
          value: "bar",
          el: fakeEl({ "data-entity": "pet", "data-dimension": "species" }),
        },
        "p1"
      )
    ).toEqual({ kind: "field", entityId: "pet", fieldId: "species", label: "pet.species" });
  });

  it("data-action 不传 gates → 如实报公共动作（没算过判定就不编判定）", () => {
    const t = htmlBindingToXrayTarget(
      { attr: "data-action", value: "createRecord", el: fakeEl({}, { text: "新建预约" }) },
      "p2"
    );
    expect(t).toEqual({
      kind: "action",
      label: "新建预约",
      pageId: "p2",
      permission: null,
      granted: true,
    });
    // describeXrayTarget 对 permission:null 的解读必须是"公共动作"，不是报错
    expect(describeXrayTarget(MODEL, t!).lines.join()).toContain("公共动作");
  });

  it("data-action 带 gates → createRecord 读真权限判定（2026-08-14 晚接上）", () => {
    const t = htmlBindingToXrayTarget(
      {
        attr: "data-action",
        value: "createRecord",
        el: fakeEl({ "data-entity": "pet" }, { text: "新建宠物" }),
      },
      "p2",
      {
        role: "guest",
        createGate: { pet: { permission: "pet:create", granted: false } },
      }
    );
    expect(t).toEqual({
      kind: "action",
      label: "新建宠物",
      pageId: "p2",
      permission: "pet:create",
      granted: false,
      role: "guest",
    });
  });

  it("转移三种 → workflow 目标（游标读到的是流程那只手）", () => {
    for (const v of ["submitWorkflow", "approveWorkflow", "rejectWorkflow"]) {
      const t = htmlBindingToXrayTarget(
        { attr: "data-action", value: v, el: fakeEl({}, { text: "提交审批" }) },
        "p3"
      );
      expect(t).toEqual({ kind: "workflow", label: "提交审批", pageId: "p3" });
    }
  });

  it("参数孔（data-sort 等）→ 指认到所在行容器的实体", () => {
    const t = htmlBindingToXrayTarget(
      { attr: "data-sort", value: "date", el: fakeEl({}, { rowsEntity: "booking" }) },
      "p1"
    );
    expect(t).toEqual({ kind: "entity", entityId: "booking", label: "booking" });
  });

  it("entity 目标的解读：字段数 + 哪些页面绑定它", () => {
    const d = describeXrayTarget(MODEL, {
      kind: "entity",
      entityId: "pet",
      label: "pet",
    });
    expect(d.skill).toBe("dataModel");
    expect(d.title).toBe("宠物档案");
    expect(d.lines.join()).toContain("2 个字段");
    expect(d.lines.join()).toContain("宠物档案页");
  });
});

describe("SlideRuleStudio 三态舞台", () => {
  it("无模型（空会话）→ board：接线沙盘在场，无应用舞台", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStudio chatSlot={<div />} activeSkillId={null} />
    );
    expect(html).toContain('data-testid="sliderule-architecture-stage"');
    expect(html).toContain('data-testid="architecture-checks"');
    expect(html).toContain('data-testid="architecture-empty"');
    // 不该有：顶栏六圆钮。变异：把 SkillThumbnailBar 加回必红。
    expect(html).not.toContain("bg-blue-400");
    expect(html).not.toContain("bg-emerald-400");
    expect(html).not.toContain('data-testid="sliderule-app-stage"');
    expect(html).not.toContain('data-testid="sliderule-xray-toggle"');
  });

  it("成品面顶栏：页面/代码 + 关联在场，画布在互斥布局档里，沙盘片已撤", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleStudio
          chatSlot={<div />}
          activeSkillId={null}
          chromeSlot={<SlideRuleTopHud />}
          specPages={[
            {
              pageId: "p1",
              html: "<!doctype html><html><body>x</body></html>",
              current: 1,
              total: 1,
              // 第 3 步的素颜页：孔要等第 6.5 步才打。这条用例只看顶栏三件在不在，
              // 跟接没接数据无关，取 false 即可。
              bound: false,
            },
          ]}
        />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="sliderule-stage-gears"');
    expect(html).toContain('data-testid="sliderule-stage-view-page"');
    expect(html).toContain('data-testid="sliderule-stage-view-code"');
    expect(html).toContain('data-testid="sliderule-xray-toggle"');
    const pageBtn = html.slice(
      html.indexOf('data-testid="sliderule-stage-view-page"'),
      html.indexOf('data-testid="sliderule-stage-view-code"')
    );
    expect(pageBtn).toContain("页面");
    expect(pageBtn).not.toContain("桌面");
    expect(html).toContain("代码");
    // ⚠ 2026-08-28 用户裁决：文字从「透视」改成「关联」。
    expect(html).toContain("关联");
    expect(html).not.toContain(">透视<");
    expect(html).not.toContain(">游标<");
    // ⚠ 2026-08-24 用户反馈：顶栏「沙盘」片和「透视」里的入口重复，撤掉。
    // 把那片 tab 加回去，这两条必红。
    expect(html).not.toContain('data-testid="sliderule-stage-view-board"');
    expect(html).not.toContain(">沙盘<");

    /*
     * ⚠ 2026-09-01：画布是顶栏互斥分段的一片，不是独立「打开画布」。
     * 正反一起（「沙盘」那次记下的形状）：只查"页面/代码里没有画布"
     * 会假绿——把顶栏那片也删掉，画布再也打不开。
     */
    expect(html).toContain("分栏");
    expect(html).toContain("全屏");
    expect(html).toContain("画布");
    expect(html).not.toContain("打开画布");
    expect(html).toContain('data-testid="sliderule-workbench-mode"');
    expect(html).toContain('data-testid="sliderule-stage-view-canvas"');
    // 反向：它不再是页面/代码分段里的一片
    const seg = html.slice(
      html.indexOf('data-testid="sliderule-stage-view-page"') - 600,
      html.indexOf('data-testid="sliderule-stage-view-code"')
    );
    expect(seg).not.toContain('data-testid="sliderule-stage-view-canvas"');
  });

  it("顶栏那排的顺序：私有 → 关联 → 点选编辑 → 分栏/全屏/画布", () => {
    /*
     * 2026-09-01：画布从独立钮收进 chromeSlot 里的互斥分段。
     * 判据盯**渲染后 HTML 里的先后**，不是源码里出现的次序。
     */
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleStudio
          chatSlot={<div />}
          activeSkillId={null}
          chromeSlot={<SlideRuleTopHud />}
          /* ⚠ 必须给 sessionId：StudioShareToggle 没有它直接 `return null`，
             不给的话「私有」根本不渲染，这条判据会退化成"只查了后三个"。 */
          sessionId="sr-test"
          specPages={[
            {
              pageId: "p1",
              html: "<!doctype html><html><body>x</body></html>",
              current: 1,
              total: 1,
              bound: false,
            },
          ]}
        />
      </StudioLayoutProvider>
    );
    const share = html.indexOf('data-testid="sliderule-share-toggle"');
    const xray = html.indexOf('data-testid="sliderule-xray-toggle"');
    const edit = html.indexOf('data-testid="sliderule-click-edit-toggle"');
    const workbench = html.indexOf('data-testid="sliderule-workbench-mode"');
    const canvas = html.indexOf('data-testid="sliderule-stage-view-canvas"');
    expect(share).toBeGreaterThan(-1);
    expect(xray).toBeGreaterThan(share);
    expect(edit).toBeGreaterThan(xray);
    expect(workbench).toBeGreaterThan(edit);
    expect(canvas).toBeGreaterThan(workbench);
  });

  it("重置会话落在标题**左侧**，不在右侧图标簇里（量渲染后的顺序，不量源码）", () => {
    /**
     * ⚠ 2026-08-24 用户反馈：重置会话原是右侧灰图标簇最后那个 ⟳，跟「重置布局」
     * 的 ◫ 挨着，分不出也看不见。搬到标题左边。
     *
     * 判据盯的是**渲染后 HTML 里的先后顺序**，不是"源码里有没有 resetSlot"——
     * 后者把槽渲染到右边照样绿（本仓踩过第十次以上的形态）。把 {resetSlot}
     * 挪到 {chromeSlot} 旁边，下面 indexOf 比较必红。
     */
    const html = renderToStaticMarkup(
      <SlideRuleStudio
        chatSlot={<div />}
        activeSkillId={null}
        appTitle="为求职者打造全生命周期管理工具"
        resetSlot={<button data-testid="sliderule-reset-session">reset</button>}
        chromeSlot={<div data-testid="sliderule-status-bar">chrome</div>}
        specPages={[
          {
            pageId: "p1",
            html: "<!doctype html><html><body>x</body></html>",
            current: 1,
            total: 1,
            bound: false,
          },
        ]}
      />
    );
    const resetAt = html.indexOf('data-testid="sliderule-reset-session"');
    const titleAt = html.indexOf("为求职者打造全生命周期管理工具");
    const gearsAt = html.indexOf('data-testid="sliderule-stage-gears"');
    expect(resetAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(-1);
    expect(html).toContain('data-testid="sliderule-app-stage-title"');
    const titleMark = html.indexOf('data-testid="sliderule-app-stage-title"');
    expect(titleMark).toBeGreaterThan(resetAt);
    expect(titleMark).toBeLessThan(gearsAt);
    // 左于标题
    expect(resetAt).toBeLessThan(titleAt);
    // 且不在右侧图标簇里
    expect(resetAt).toBeLessThan(gearsAt);
  });

  it("工作台图标簇落在关联右侧，跟标题同一行", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStudio
        chatSlot={<div />}
        activeSkillId={null}
        specPages={[
          {
            pageId: "p1",
            html: "<!doctype html><html><body>x</body></html>",
            current: 1,
            total: 1,
            bound: false,
          },
        ]}
        chromeSlot={<div data-testid="sliderule-status-bar">icons</div>}
      />
    );
    const gearsAt = html.indexOf('data-testid="sliderule-stage-gears"');
    const xrayAt = html.indexOf('data-testid="sliderule-xray-toggle"');
    const chromeAt = html.indexOf('data-testid="sliderule-status-bar"');
    expect(gearsAt).toBeGreaterThan(-1);
    expect(xrayAt).toBeGreaterThan(gearsAt);
    expect(chromeAt).toBeGreaterThan(xrayAt);
    expect(html.match(/data-testid="sliderule-status-bar"/g)?.length).toBe(1);
    const gearsTag = html.slice(
      html.lastIndexOf("<div", gearsAt),
      html.indexOf(">", gearsAt) + 1
    );
    expect(gearsTag).toContain("overflow-x-auto");
    expect(gearsTag).toContain("min-w-0");
    expect(gearsTag).not.toContain("shrink-0");
  });

  it("开聊后对话/舞台之间是可拖可折分隔；空会话没有这条缝", () => {
    const split = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleStudio chatSlot={<div />} activeSkillId={null} />
      </StudioLayoutProvider>
    );
    expect(split).toContain('data-testid="sliderule-studio-split"');
    expect(split).toContain('data-testid="sliderule-studio-split-handle"');
    expect(split).toContain('data-testid="sliderule-studio-split-toggle-chat"');
    expect(split).toContain('data-testid="sliderule-studio-split-toggle-stage"');
    // 不该有：写死 38%。变异：把 style width 38% 加回、拆掉 handle 必红。
    expect(split).not.toContain('width:38%');
    expect(split).not.toContain("width: 38%");

    const empty = renderToStaticMarkup(
      <SlideRuleStudio
        chatSlot={<div />}
        activeSkillId={null}
        stageVisible={false}
      />
    );
    expect(empty).not.toContain('data-testid="sliderule-studio-split-handle"');
  });

  it("手机预览锁成分栏右侧菜单×2，缝不可拖", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleStudio
          chatSlot={<div />}
          activeSkillId={null}
          specPages={[
            {
              pageId: "p1",
              html: "<!doctype html><html><body>x</body></html>",
              current: 1,
              total: 1,
              bound: false,
              device: "phone",
            },
          ]}
        />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-split-locked="phone"');
    expect(html).toContain("手机预览宽度已锁定为菜单栏两倍");
  });

  it("推演中且应用未成形 → live 占位（llmDraft 为空也不许闪回 board）", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStudio
        chatSlot={<div />}
        activeSkillId={null}
        isRunning
        llmDraft=""
        liveActionLabel="正在分析风险"
      />
    );
    expect(html).toContain('data-testid="sliderule-live-stage"');
    expect(html).toContain("推演中");
    expect(html).toContain("正在分析风险"); // 当前步骤锚点
    expect(html).not.toContain("发布证据看板"); // 老面板不许露出
  });
});
