/**
 * 侧栏会话封面——**有图贴图，没图画 lucide**。不按话题猜图标。
 *
 * ## 2026-08-23：活渲染那一档删了
 *
 * 这里原本跟应用中心是同一条三级链：有图贴图，没图就**现挂一个真的应用运行时**
 * （HtmlAppSurface / AppRuntimeScreen）渲染出来缩进 40px 的方格里。
 *
 * 应用中心 2026-08-22 已经把这套从卡片上删掉（同屏 14 张卡最长单任务 4106ms，
 * 主线程连堵四秒），当时**没动侧栏**。结果是 CPU 那一半省了，网络这一半原样
 * 留着——而且侧栏比卡片更贵，因为它是每行各拉各的整包：
 *
 *   真机实测（/agent-loop/workbench 首屏 20s，登录态，CDP 抓调用栈）：
 *     GET /sessions/{id}   ×3   1239.4 KB   ← 全部来自这里，单条约 413 KB
 *     GET /apps/{id}       ×2    163.6 KB   ← 同上
 *     ————————————————————————————————————
 *     合计 1.4 MB，占该页首屏 2.42 MB 的 58%
 *
 * 拉的还是**完整会话状态**（含 specFirstPages 整页 HTML + 证据投影），
 * 而真正用到的只有"落地页那一段 HTML"。
 *
 * 用户 2026-08-23 拍板：侧栏也走贴图。代价是**没图的行会变成首字母块**——
 * 这是明知的取舍，不是回归：库里大部分应用没有 shot（同日查线上库 64 个应用，
 * 有图的 20 个），所以侧栏会明显变空。要让它重新有画面，正确的做法是让那些
 * 应用真的有图（见 studio-landing-shot 的收口采集），而不是每次进页面现渲一遍。
 *
 * 2026-09-20：首字母块在真机上一排都是「做」。对照 Manus 任务行改画
 * lucide，格子 18px。第一版只看 phase / 是否绑了应用——真机十行都没绑
 * 上 listApps 那 36 条，全落成同一颗文档。用户指出 Manus 是**按类型**
 * 换图标（首页那排：幻灯片 / 设计 / 网站 / 游戏）。所以没图时先从意图
 * 认这几类，再回落到绑定应用 / 文档。不给「番茄 / 坦克」单独开一种。
 *
 * ⚠ 别把活渲染加回来。真要恢复画面，先加一个**只回落地页那一段**的瘦接口
 *   （`GET /sessions/{id}/landing-page`），别再拉整个会话状态。
 */
import React from "react";
import {
  AlertCircle,
  AppWindow,
  FileText,
  Gamepad2,
  Globe,
  ListTodo,
  Palette,
  Presentation,
  Smartphone,
} from "lucide-react";

import {
  appPreviewUrl,
  type AppStoreSummary,
} from "./app-store-client";

/**
 * 侧栏为了拿 has_preview / preview_tag 拉的那批摘要的上限。
 *
 * 摘要是瘦的（不含 model_json / pages_json / 图本体，见 app_store._summary），
 * 实测 36 条约 30 KB——这条**不是**上面那 1.4 MB 的来源，别顺手也砍了。
 */
export const SESSION_THUMB_APP_LIMIT = 36;

export function indexAppsBySession(
  apps: readonly AppStoreSummary[]
): Map<string, AppStoreSummary> {
  const map = new Map<string, AppStoreSummary>();
  for (const app of apps) {
    const sid = String(app.session_id || "").trim();
    if (sid && !map.has(sid)) map.set(sid, app);
  }
  return map;
}

/** 和应用中心 shouldUseSheetThumb 同一口径：有 appId 且后端说有图。 */
export function sessionUsesSheet(app?: AppStoreSummary | null): boolean {
  return Boolean(app?.id && app.has_preview);
}

/**
 * 侧栏行上的短标题。Manus 左侧是「TicketStream 服务台」，不是整段意图。
 *
 * 有产品名用产品名；没有就从意图里抠「名为“X”」，再不行取第一句、
 * 超过 22 字收尾。完整意图仍可挂在行的 title 上。
 */
export function shortSessionGoal(goal: string): string {
  const text = String(goal || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const named = text.match(/名为[“「"']([^”」"']+)[”」"']/);
  if (named?.[1]?.trim()) return named[1].trim();
  const clause = text.split(/[。！？\n]/)[0] ?? text;
  return clause.length > 22 ? `${clause.slice(0, 22)}…` : clause;
}

export function sessionRowTitle(
  goal: string,
  app?: AppStoreSummary | null
): string {
  return (
    String(app?.product_name || "").trim() ||
    shortSessionGoal(goal) ||
    "新会话"
  );
}

export type SessionRowIconKind =
  | "alert"
  | "game"
  | "web"
  | "slides"
  | "design"
  | "list"
  | "phone"
  | "app"
  | "file";

/**
 * Manus 首页那几类：游戏 / 网站 / 幻灯 / 设计，外加我们列表里常见的待办。
 * 只认类型词，不认具体产品名——「番茄钟网页」是 web，不是一颗番茄。
 */
export function sessionGoalTypeKind(text: string): SessionRowIconKind | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (/游戏|game|射击/.test(t)) return "game";
  if (/幻灯|ppt|slides?|演示稿/.test(t)) return "slides";
  if (/海报|视觉设计|创建设计/.test(t) || /(^|[^a-z])design([^a-z]|$)/.test(t)) {
    return "design";
  }
  if (/待办|清单|todo|checklist/.test(t)) return "list";
  if (/网页|网站|website|\bweb\b|落地页/.test(t)) return "web";
  if (/saas|系统|后台|服务台/.test(t)) return "app";
  return null;
}

/**
 * 侧栏行图标。failed 压过类型——失败行要一眼能扫到。
 * 有类型词走 Manus 那几类；没有才看绑定应用 / device。
 */
export function sessionRowIconKind(
  phase?: string | null,
  app?: AppStoreSummary | null,
  goal?: string | null
): SessionRowIconKind {
  if (String(phase || "").trim() === "failed") return "alert";
  const typed = sessionGoalTypeKind(
    [goal, app?.product_name, app?.goal].filter(Boolean).join(" ")
  );
  if (typed) return typed;
  if (app?.id) {
    return String(app.device || "").trim() === "phone" ? "phone" : "app";
  }
  return "file";
}

const SESSION_ROW_ICONS = {
  alert: AlertCircle,
  game: Gamepad2,
  web: Globe,
  slides: Presentation,
  design: Palette,
  list: ListTodo,
  phone: Smartphone,
  app: AppWindow,
  file: FileText,
} as const;

function SessionRowIcon({ kind }: { kind: SessionRowIconKind }) {
  const Icon = SESSION_ROW_ICONS[kind];
  return (
    <span
      className="native-agent-session-thumb-icon"
      data-testid="sidebar-session-thumb-icon"
      data-icon={kind}
    >
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
}

export function SessionThumb({
  sessionId,
  title,
  app,
  phase,
  goal,
}: {
  sessionId: string;
  title: string;
  app?: AppStoreSummary | null;
  phase?: string | null;
  goal?: string | null;
}) {
  const [sheetFailed, setSheetFailed] = React.useState(false);
  React.useEffect(() => setSheetFailed(false), [sessionId, app?.id, app?.preview_tag]);

  const sheet = sessionUsesSheet(app) && !sheetFailed;
  const kind = sessionRowIconKind(phase, app, goal || title);
  return (
    <span className="native-agent-session-thumb" aria-hidden>
      {sheet ? (
        <img
          src={appPreviewUrl(app!.id, app!.preview_tag)}
          alt=""
          data-testid="sidebar-session-thumb-sheet"
          // 图拉不到（记录刚被删、网络抖）→ 回落同槽图标，不留空白、不回首字母。
          onError={() => setSheetFailed(true)}
        />
      ) : (
        <SessionRowIcon kind={kind} />
      )}
    </span>
  );
}
