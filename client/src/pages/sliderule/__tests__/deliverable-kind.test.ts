import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFICE_FILE,
  WEB_APP,
  isOfficeFileDeliverable,
  latestPlanDeliverableKind,
  planDeliverableKind,
  planWrittenHasDeliverableKind,
  projectTemplateForDeliverable,
} from "../deliverable-kind";
import { chapterTitleForRows } from "../session-story";
import {
  shouldAutoOpenPreview,
  shouldAutoWakePreview,
} from "../project-computer-view";

describe("deliverableKind 缺省网页，办公文件另算", () => {
  it("空计划和未知类别都是 web-app", () => {
    expect(planDeliverableKind(null)).toBe(WEB_APP);
    expect(planDeliverableKind({})).toBe(WEB_APP);
    expect(planDeliverableKind({ deliverableKind: "pptx" })).toBe(WEB_APP);
    expect(planDeliverableKind({ deliverableKind: OFFICE_FILE })).toBe(
      OFFICE_FILE
    );
  });

  it("最新 plan_written 才是权威，不猜用户原话", () => {
    expect(
      latestPlanDeliverableKind([
        { kind: "plan_written", deliverableKind: WEB_APP },
        { kind: "plan_written", deliverableKind: OFFICE_FILE },
        { kind: "plan_approved", deliverableKind: WEB_APP },
      ])
    ).toBe(OFFICE_FILE);
    expect(latestPlanDeliverableKind([])).toBe(WEB_APP);
  });

  it("办公文件前端仍可 POST react-vite，存量网页会话仍默认 tasks", () => {
    expect(projectTemplateForDeliverable(OFFICE_FILE)).toBe("react-vite");
    expect(projectTemplateForDeliverable(WEB_APP)).toBe("react-vite-tasks");
    expect(projectTemplateForDeliverable(undefined)).toBe("react-vite-tasks");
  });

  it("plan_written 缺键不是合同，有 office-file / web-app 才算", () => {
    expect(planWrittenHasDeliverableKind([])).toBe(false);
    expect(planWrittenHasDeliverableKind([{ kind: "plan_written" }])).toBe(false);
    expect(
      planWrittenHasDeliverableKind([
        { kind: "plan_written", deliverableKind: OFFICE_FILE },
      ])
    ).toBe(true);
    expect(
      planWrittenHasDeliverableKind([
        { kind: "plan_written", deliverableKind: WEB_APP },
      ])
    ).toBe(true);
  });
});

describe("办公文件章节不标构建网页", () => {
  const create = [
    { id: "a", tool: "project_create", label: "创建工程", status: "done" as const },
    { id: "b", tool: "shell_exec", label: "运行命令", status: "done" as const },
  ];
  const preview = [
    { id: "a", tool: "project_start", label: "启动预览", status: "done" as const },
  ];

  it("缺省仍是构建网页 / 预览网页", () => {
    expect(chapterTitleForRows(create)).toBe("构建网页");
    expect(chapterTitleForRows(preview)).toBe("预览网页");
  });

  it("office-file 写成制作文件 / 查看文件", () => {
    expect(chapterTitleForRows(create, OFFICE_FILE)).toBe("制作文件");
    expect(chapterTitleForRows(preview, OFFICE_FILE)).toBe("查看文件");
    expect(chapterTitleForRows(create, OFFICE_FILE)).not.toBe("构建网页");
  });
});

describe("办公文件不把 Vite 预览叫醒当交差", () => {
  const wake = {
    hasTurns: true,
    view: "preview" as const,
    hasTicket: false,
    opening: false,
    starting: false,
    live: true,
    lastTool: "project_start",
    runtimeReady: false,
  };
  const open = {
    hasTurns: true,
    view: "preview" as const,
    hasTicket: false,
    opening: false,
    runtimeReady: true,
    lastTool: "project_start",
  };

  it("网页会话仍可叫醒", () => {
    expect(shouldAutoWakePreview(wake)).toBe(true);
    expect(shouldAutoOpenPreview(open)).toBe(true);
  });

  it("自动创建和预览叫醒都读交付物类别，不许再写死 tasks", () => {
    const hook = readFileSync(
      resolve(__dirname, "../useSlideRuleSession.ts"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(hook).toMatch(/projectTemplateForDeliverable/);
    expect(hook).toMatch(/latestPlanDeliverableKind/);
    const surface = readFileSync(
      resolve(__dirname, "../project-runtime/SandboxPreviewSurface.tsx"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(surface).toMatch(/shouldAutoWakePreview\(\{[\s\S]*deliverableKind/);
    expect(surface).toMatch(/shouldAutoOpenPreview\(\{[\s\S]*deliverableKind/);
    expect(surface).toMatch(/OfficeArtifactPane/);
    expect(surface).toMatch(/presentedSourcePage\(/);
    expect(surface).toMatch(/PresentedSourcePage/);
    expect(surface).not.toMatch(/render=browser/);
    expect(surface).toMatch(/isOfficeFileDeliverable\(deliverableKind\)/);
    expect(surface).toMatch(/const officeFile = isOfficeFileDeliverable\(deliverableKind\)/);
    expect(surface).toMatch(/!waking && !officeFile/);
    expect(surface).not.toMatch(/pptx_create/);
  });

  it("office-file 即使正在 project_start 也不叫醒", () => {
    expect(shouldAutoWakePreview({ ...wake, deliverableKind: OFFICE_FILE })).toBe(
      false
    );
    expect(shouldAutoOpenPreview({ ...open, deliverableKind: OFFICE_FILE })).toBe(
      false
    );
    expect(isOfficeFileDeliverable(OFFICE_FILE)).toBe(true);
  });
});
