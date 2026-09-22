/**
 * 结果卡的纯模型——「事情做完之后，这一轮留下了什么」。
 *
 * ## 为什么要这个（2026-09-14，用户第二次对照 Manus 截图）
 *
 * Manus 跑完一个任务，对话流里留下的是一张**卡**：应用名 + 未发布 + 用时 +
 * 缩略图，发布在卡头；卡外一行 `✓ 任务已完成 · 复制 · 重试 · 评分`。
 * 往上滚看历史，每个任务都留着那张卡。
 *
 * 我们跑完只有一段文字。成果散在右侧预览列里，**对话流里没有任何一个
 * 「东西做好了，在这儿」的锚点**——滚上去看历史时什么都不剩。
 *
 * ## 这里只放判断，不放 JSX
 *
 * 「显示什么 / 不显示什么」全是纯函数，判据直接跑（本仓一贯做法）。
 * 组件只负责把它画出来。
 *
 * ## 诚实边界（§7：增强类 fail-open，但**不许编**）
 *
 *   · 拿不到用时就不显示用时那一行，不写「用时未知」也不写 0s。
 *   · 缩略图**目前恒为空**：`services/app_screenshot.py` 那套截图今天只在
 *     生成过程里做自检用，没有落成会话级产物。所以这里留了入口
 *     （`thumbnailUrl`）但不去别处拼一个——界面少一块，好过挂一张别的图。
 *     真要接，是在服务端把自检那张图存成产物，不是在这儿想办法。
 *
 * ⚠ 2026-09-18 真机（做一个待办清单）：Manus 是网站做完才出一张带预览的卡。
 *   我们 `produced` 吃的是**会话级** `projectRevision`，一点批准、模板落库，
 *   前面问问题 / 写计划那两轮（34s、48s）全部重绘成「任务已完成」。计划还在
 *   1/7，开场就是卡片墙。缩略图已经只挂最新一轮，出卡忘了同样按**这一轮
 *   有没有写出源码**挡。会话有版本 ≠ 这一轮交付了。
 */
import type { UiTurn } from "./types";
import { isOfficeFileDeliverable } from "./deliverable-kind";

/** 这一轮真正改了工程才算出货。读状态 / 写计划 / 提问都不算。 */
const PROJECT_DELIVERY_TOOLS = new Set([
  "project_create",
  "project_patch",
  "project_write",
  "project_str_replace",
  "file_write",
  "file_str_replace",
  "write_file",
  "search_replace",
]);

/** 办公交货：空 README 工作区不算。bash / 二进制写入才可能产出文件。 */
const OFFICE_DELIVERY_TOOLS = new Set([
  "bash",
  "shell_exec",
  "file_write",
  "write_file",
]);

/**
 * 这一轮有没有把源码写进工程。会话上已经有 revision 不算——那是后面落库
 * 回涂到历史轮上的（2026-09-18 那两张开场卡）。
 */
export function turnDeliveredProject(turn: UiTurn | null | undefined): boolean {
  if (!turn || !Array.isArray(turn.steps)) return false;
  return turn.steps.some(
    step =>
      step.kind === "chip" &&
      PROJECT_DELIVERY_TOOLS.has(String(step.capabilityId || "").trim()) &&
      step.progressType === "completed"
  );
}

/**
 * 这一轮有没有动手去生成办公文件。project_create 落的是空工作区，不算。
 */
export function turnDeliveredOfficeFile(turn: UiTurn | null | undefined): boolean {
  if (!turn || !Array.isArray(turn.steps)) return false;
  return turn.steps.some(
    step =>
      step.kind === "chip" &&
      OFFICE_DELIVERY_TOOLS.has(String(step.capabilityId || "").trim()) &&
      step.progressType === "completed"
  );
}

/**
 * 人话用时。Manus 写的是 `2m 45s`，不是 `165s`——超过一分钟还读秒，
 * 得让人自己心算。
 *
 * ⚠ 跟 `activity-rows.ts` 的 `turnTimelineHeader`（`42 步 · 115s`）**是两个
 *   东西，别顺手统一**：那个是折叠时间线表头里的紧凑元信息，一行里还要挤
 *   步数，短到极致是对的；这里是结果卡上的标题行，要给人读。
 *   那边的格式被 `turn-timeline-header.test.ts` 钉着，是有意的产品决定。
 */
export function formatWorkedDuration(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  return restMin ? `${hours}h ${restMin}m` : `${hours}h`;
}

/** 卡片标题那行的「工作了 X」。没有用时就整行不出现。 */
export function workedLabel(ms: unknown): string | null {
  const worked = formatWorkedDuration(ms);
  return worked ? `工作了 ${worked}` : null;
}

export type ResultCardModel = {
  /** 卡片标题：这一轮做出来的东西叫什么。 */
  title: string;
  /** 运行时徽章文案：工程档写「未发布」，HTML 档写「HTML 原型」。 */
  badge: string;
  /** 「工作了 2m 45s」；拿不到用时就是 null。 */
  worked: string | null;
  /** 有没有可打开的东西。没有就不画那个按钮（而不是画一个点不动的）。 */
  canOpen: boolean;
  /** 工程档才谈得上发布。 */
  canPublish: boolean;
  /** 目前恒为 null，见模块头注。 */
  thumbnailUrl: string | null;
};

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * 这一轮该不该出结果卡，出的话写什么。
 *
 * 返回 null = 不出卡。**这是常态**：还在跑的、没产出的、纯问答的轮次都不该
 * 出卡；每轮都挂一张卡只会把对话流变成卡片墙（§3 的反面——不是「有就显示」，
 * 是「有东西才显示」）。
 */
export function resultCardModel(
  turn: UiTurn | null | undefined,
  opts: {
    runtimeKind?: "html-prototype" | "project" | null;
    goalText?: string | null;
    /** 工程档已落库的源码版本；没有就说明还没产出。 */
    projectRevision?: string | null;
    /** HTML 档已经画出页面。 */
    hasPages?: boolean;
    thumbnailUrl?: string | null;
    /** 批准计划上的交付物类别。办公文件不能拿空工作区冒充交货。 */
    deliverableKind?: string | null;
    /** 产物库里有没有 .pptx / .docx / .xlsx。没有就是没有。 */
    hasOfficeArtifact?: boolean;
  } = {}
): ResultCardModel | null {
  if (!turn || turn.status === "streaming") return null;

  const isProject = opts.runtimeKind === "project";
  const office = isOfficeFileDeliverable(opts.deliverableKind);
  const produced = office
    ? Boolean(opts.hasOfficeArtifact) && turnDeliveredOfficeFile(turn)
    : isProject
      ? Boolean(String(opts.projectRevision || "").trim()) &&
        turnDeliveredProject(turn)
      : Boolean(opts.hasPages);
  // 没产出就没有「交付物」可言。问答轮、被闸拦下的轮次都落在这儿。
  // ⚠ 2026-09-21 sr-20260921102816-KWETH78PZ0：办公计划 project_create
  //   只落下 README，卡把「有 revision + 创建工程」画成任务已完成。
  if (!produced) return null;

  const title = firstNonEmpty(opts.goalText, turn.user, "这一轮的成果");
  return {
    title,
    badge: isProject ? "未发布" : "HTML 原型",
    worked: workedLabel(turn.durationMs),
    canOpen: true,
    canPublish: isProject && !office,
    // ⚠ 拿不到就是 null，不从别处凑一张图。见模块头注。
    thumbnailUrl: String(opts.thumbnailUrl || "").trim() || null,
  };
}
