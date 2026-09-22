/**
 * AppsWorkbench — 「应用中心」（E42，按用户定稿要求重构）。
 *
 * 布局定稿（用户三条硬性要求，2026-07-17）：
 *   1. 卡片一律 16:9，字段内容以底部浮层压在图上（不再图上字下两段式）；
 *   2. 「应用市场 / 我的应用 / 官方应用」三个货架——筛选口径不同，卡片样式相同；
 *      ⚠ 2026-08-19：原先「我的应用」其实是后端可见的全部应用，超管会把
 *      全站货架混进来。新建和 Fork 进「我的应用」；公开的进「应用市场」；
 *      标了官方的进「官方应用」。
 *      ⚑ 2026-08-14 示例**数据**清空（用户裁决：清数据不删功能）：老链路
 *      的四张示例卡下架，功能骨架（tab/分类/分页/点卡起手）原样保留，
 *      货架空着如实显示空态；后端 _EXAMPLE_META 上架新条目即恢复展示。
 *   3. 一行 4 张、每页 12 张。「我的应用」滚到底再要下一页（服务端
 *      limit/offset，不在前端一次切 200 张）；完整模型按卡挂载再拉。
 *      官方示例仍是网格 + 分页器。
 *
 * 北极星纪律不变：全部真数据、fail-closed——
 *   列表     — GET /api/sliderule/sessions（话题/时间/阶段）
 *   卡片详情 — GET /api/sliderule/sessions/:id 渐进拉取，
 *              五系统模型解析自持久化 perSkillEvidence（同应用舞台同源）
 *   我的应用缩略 — 按真实模型示意渲染（导航=真实页面名），不闭环不摆假截图
 *   示例库   — GET /api/sliderule/builtin-examples（冻结过门模型投影）；
 *              拉不到/没上架就如实空态
 *   状态     — 门语言（closed 6/6 / blocked / 推演中），不发明"质量分"
 */

import React from "react";
import { SandboxPreviewSurface } from "@/pages/sliderule/project-runtime/SandboxPreviewSurface";
import { canWriteApp, useAuth } from "@/lib/use-auth";
import type { AuthUser } from "@/lib/auth-client";
import { Pagination } from "antd";

import { useContainerPosition } from "masonic";

import { useScrollerIn } from "./useScrollerIn";
import { ColumnsWall } from "./ColumnsWall";
import { appendStableItems, appendUniqueById } from "./masonry-append";
import { DEVICE_ASPECT, aspectForDevice } from "@/lib/justified-rows";
import {
  LayoutGrid,
  FileText,
  GitBranch,
  Users,
  Search,
  Hourglass,
  CircleCheck,
  MoreHorizontal,
  Trash2,
  ArrowUpDown,
  Boxes,
  BarChart3,
  ShieldCheck,
  ShoppingCart,
  Calendar,
  FileText as FileIcon,
  Sparkles,
  Globe,
  Lock,
  Wrench,
  Heart,
  BookOpen,
} from "lucide-react";
// 卡片封面的空态。antd 已经是本仓依赖（admin 后台整套在用），不新引包。
import { Empty } from "antd";
import { resolveIdentityTheme } from "@/pages/sliderule/live-runtime/identity-themes";
// 只读预览的运行时种子（卡片不再活渲染，但点开大图仍是真渲染）。
import { initRuntimeState } from "@/pages/sliderule/live-runtime/live-runtime";
import { seedRuntimeState } from "@/pages/sliderule/live-runtime/demo-seed";
import { markConnectorEntities } from "@/pages/sliderule/live-runtime/connector-rows";
import { connectorEntityIds } from "@/pages/sliderule/connectors-client";
import { navItemId, navItemName } from "@/pages/sliderule/nav-item";
import { layoutDevice } from "@/pages/sliderule/product-archetypes";
import { livePagesFromSpec } from "@/pages/sliderule/spec-live-pages";
import {
  mergeFiveSystemModels,
  parseFiveSystemModelFromPerSkillEvidence,
  type FiveSystemModel,
} from "@/pages/sliderule/system-screens/five-system-model";
import {
  ACTIVE_SESSION_KEY,
  SESSIONS_UPDATED_EVENT,
  activateSession,
  createSessionId,
  notifySessionsUpdated,
} from "./SidebarSessions";
import { slideruleSessionPath } from "@/lib/sliderule-session-id";
import {
  listApps,
  getApp,
  forkApp,
  reopenApp,
  deleteApp,
  getGeneratedAppForSession,
  patchApp,
  appPreviewUrl,
  type AppStoreSummary,
  type AppShelf,
} from "./app-store-client";
import { fetchSessionsList } from "./sessions-list-client";

export { appPreviewUrl };
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import {
  GITHUB_PAGES_DEMO_GOAL,
  GITHUB_PAGES_DEMO_SESSION_ID,
  createGithubPagesSlideRuleSessionStore,
  loadOrSeedGithubPagesDemoSession,
} from "@/pages/sliderule/github-pages-sliderule-demo";

// ---------------------------------------------------------------------------
// 纯函数（可单测）
// ---------------------------------------------------------------------------

export interface SessionListItem {
  sessionId: string;
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  artifactCount?: number;
  phase?: string | null;
  /**
   * 这个会话绑定的那版应用 + 封面三件套（2026-08-24 后端补的，见
   * app_store.session_covers）。没绑定应用的会话就没有这几个字段。
   *
   * 为什么会话摘要要带应用的东西：应用中心把「全部会话」和「**一页**应用」
   * 合并去重，会话是一次拉全的，应用是 limit=14 的一页——认不到自己应用的
   * 那些会话各摆一张没封面的空卡（真机 66 张卡只有 14 张有图）。
   *
   * ⚠ 字段名与应用摘要（AppStoreSummary）保持一致，好在 mergeGalleryItems
   *   里归一成同一组字段。要改名两边一起改。
   */
  appId?: string;
  version?: number;
  device?: string;
  has_preview?: boolean;
  preview_source?: string;
  preview_tag?: string;
}

export type AppCardStatus = "runnable" | "awaiting" | "draft";

/**
 * spec-first 整页 HTML（校验过形状的那份）。来源两处、同一形状：
 *   - 会话卡：state.specFirstPages（GET /sessions/:id 的完整会话态）
 *   - App Store 卡：完整记录的 pages_json（GET /apps/:id）
 */
export interface SpecPagesDetail {
  /** pageId → 完整 HTML 文档（带 data-* 绑定孔），至少一页 */
  pages: Record<string, string>;
  /** 外壳统一时定下的导航顺序；第一项就是落地页 */
  navItems: Array<{ pageId?: string; label?: string }>;
  /** 打过孔（6.5 步绑定成功）的页数；0 = 没跑打孔或一页都没打上 */
  boundPages: number;
  /** 每页打孔相位（bound / failed / skipped）。有它就认它，不靠成功数反推。 */
  pageBindStatus?: Record<string, string>;
  /** 画页或打孔失败的页 → 原因。打孔部分失败时成功页仍计入 boundPages。 */
  failedPages?: Record<string, unknown>;
  /** desktop 1920×1080 / tablet 1112×834 / phone 390×844。
   *  老存档没有这个字段——按桌面兜底，行为与从前一致。 */
  device?: "desktop" | "phone" | "tablet";
}

/**
 * 把后端载荷收成 SpecPagesDetail；形状不对/没有一页就 null。
 * **判空必须严**：空壳 {} 判成"有页面"的话，卡片会挂一个空白 iframe——
 * 比老的区块渲染更糟（那至少是真数据）。
 */
/**
 * 就地改一张卡的属性（可见性 / 官方位），**不重拉整个画廊**。
 *
 * ⚠ 2026-08-22 真机量的：点一次「设为私有」，卡片数 104 → **0** → 120，
 *   列表空白 6934ms，打了 21 个网络请求——里面还有 `/api/health`、
 *   `/api/agent-loop/health`、`/api/sliderule/llm-channel`，跟这次操作
 *   毫无关系。成因是菜单动作一律走 `setReloadKey`，而那个 effect 头一句
 *   就是 `setApps(null)`，顺带把分页游标全清了，滚出来的页也没了。
 *
 * 写进去的是 **patchApp 回的服务端状态**，不是前端猜的下一个值——
 * 乐观更新猜错了，界面和后端就分叉，而且不会有任何一处报错。
 *
 * ⚠ `null` 保持 `null`：null = 还没加载，[] = 加载完但一个都没有，
 *   界面上是两种状态，混了就会把「加载中」显示成「空空如也」。
 */
export function applyAppPatch<T extends { id?: string }>(
  apps: T[] | null,
  appId: string,
  patch: { visibility?: string; is_official?: boolean }
): T[] | null {
  if (!apps) return apps;
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );
  if (!Object.keys(clean).length) return apps;
  let touched = false;
  const next = apps.map(a => {
    if (String(a.id ?? "") !== appId) return a;
    touched = true;
    return { ...a, ...clean };
  });
  return touched ? next : apps;
}

/**
 * 重拉画廊时该不该先清空。
 *
 * 只有**首次加载**和**切 tab** 才清——那两种情况下留着旧卡会串台。
 * 同一个 tab 里的重拉（改了可见性、复刻出新卡、侧栏删了会话）一律不清：
 * 用户看到的应该是「某张卡变了」，不是「整页白了 7 秒又长回来」。
 */
export function shouldBlankGallery(blankedForTab: string | null, tab: string): boolean {
  return blankedForTab !== tab;
}

export function extractSpecPages(raw: unknown): SpecPagesDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pagesRaw = r.pages;
  if (!pagesRaw || typeof pagesRaw !== "object") return null;
  const pages: Record<string, string> = {};
  for (const [id, html] of Object.entries(pagesRaw as Record<string, unknown>)) {
    if (typeof html === "string" && html.trim()) pages[id] = html;
  }
  if (Object.keys(pages).length === 0) return null;
  const navItems = Array.isArray(r.navItems)
    ? (r.navItems
        .filter(n => n && typeof n === "object")
        .map(n => ({
          pageId: navItemId(n),
          label: navItemName(n),
        }))
        .filter(n => n.pageId) as Array<{ pageId?: string; label?: string }>)
    : [];
  return {
    pages,
    navItems,
    boundPages: typeof r.boundPages === "number" ? r.boundPages : 0,
    pageBindStatus:
      r.pageBindStatus && typeof r.pageBindStatus === "object" && !Array.isArray(r.pageBindStatus)
        ? (r.pageBindStatus as Record<string, string>)
        : undefined,
    failedPages:
      r.failedPages && typeof r.failedPages === "object" && !Array.isArray(r.failedPages)
        ? (r.failedPages as Record<string, unknown>)
        : undefined,
    device: layoutDevice(r.device) as "desktop" | "phone" | "tablet",
  };
}

/**
 * 按导航顺序排页面（导航第一项 = 落地页），导航没提到的页排在后面兜底。
 * 缩略图取第一张；预览模态的页签也按这个序。
 */
export function orderedSpecPages(sp: SpecPagesDetail): Array<{ pageId: string; html: string }> {
  const out: Array<{ pageId: string; html: string }> = [];
  const seen = new Set<string>();
  for (const nav of sp.navItems) {
    const id = nav.pageId ?? "";
    if (id && sp.pages[id] && !seen.has(id)) {
      out.push({ pageId: id, html: sp.pages[id] });
      seen.add(id);
    }
  }
  for (const [pageId, html] of Object.entries(sp.pages)) {
    if (!seen.has(pageId)) out.push({ pageId, html });
  }
  return out;
}

export interface AppCardDetail {
  runtimeKind?: "html-prototype" | "project";
  projectId?: string | null;
  projectRevision?: string | null;
  projectRevisionMode?: "current" | "pinned";
  status: AppCardStatus;
  evidenceCount: number;
  blocked: boolean;
  entities: number;
  pages: number;
  flowNodes: number;
  /**
   * 角色数 / AI 能力数（model.rbac.roles / model.aigc.capabilities，E41 指标行）。
   *
   * **null ≠ 0**（2026-08-22）：卡片指标改从列表摘要读之后，这两个数可能是
   * 「数不出来」——那份模型里压根没有 rbac / aigc 这一段。数不出来就不画这个
   * 徽标，画个 0 是在断言「这个应用没有角色」。后端同一条纪律见 Python 侧
   * app_store._count_or_none。从模型算出来的那条路（buildDetailFromModel）
   * 永远给数字，不会是 null。
   */
  roles: number | null;
  aiCaps: number | null;
  pageNames: string[];
  entityNames: string[];
  /** 应用身份（E40.2）：产品名/主题/图标——应用中心卡片的"脸" */
  identity: { productName: string; theme: string; icon: string } | null;
  /** Phase A：用于缩略图缓存失效的稳定摘要（stableDigest from publishClosure） */
  stableDigest?: string;
  /** 2026-07-23：完整五系统模型——「活渲染缩略图」直接拿它挂 AppRuntimeScreen，
   *  不再截图。null 表示模型不完整（非 runnable），缩略图走占位态。 */
  model: FiveSystemModel | null;
  /** 2026-08-14：spec-first 整页 HTML。非 null 时缩略图与只读预览一律走
   *  HTML 应用面（同推演舞台一路），不再拿区块渲染器凑合出光板表格。 */
  specPages: SpecPagesDetail | null;
}

/**
 * 五系统模型 → 卡片详情的核心（会话态与 App Store 记录共用同一套读法：
 * 都是从同一份 five-system 模型抽指标，保证两条数据源的卡片指标口径一致）。
 */
export function buildDetailFromModel(
  model: FiveSystemModel | null,
  opts: {
    evidenceCount: number;
    blocked: boolean;
    awaitReason?: unknown;
    stableDigest?: string;
    specPages?: SpecPagesDetail | null;
  }
): AppCardDetail {
  const entitiesArr = model?.datamodel?.entities ?? [];
  const pagesArr = model?.page?.pages ?? [];
  const nodesArr = (model?.workflow as any)?.nodes ?? [];
  const rolesArr = model?.rbac?.roles ?? [];
  const capsArr = model?.aigc?.capabilities ?? [];
  const rawIdentity = (model?.appbundle as any)?.appIdentity;
  const identity =
    rawIdentity && (rawIdentity.productName || rawIdentity.theme)
      ? {
          productName: String(rawIdentity.productName ?? "").trim(),
          theme: String(rawIdentity.theme ?? "azure").trim() || "azure",
          icon: String(rawIdentity.icon ?? "boxes").trim() || "boxes",
        }
      : null;
  const status: AppCardStatus =
    opts.evidenceCount >= 6 && !opts.blocked && model
      ? "runnable"
      : opts.awaitReason
        ? "awaiting"
        : "draft";
  return {
    status,
    evidenceCount: opts.evidenceCount,
    blocked: opts.blocked,
    entities: entitiesArr.length,
    pages: pagesArr.length,
    flowNodes: Array.isArray(nodesArr) ? nodesArr.length : 0,
    roles: rolesArr.length,
    aiCaps: capsArr.length,
    identity,
    pageNames: pagesArr.map((p: any) => String(p?.name ?? p?.id ?? "")).filter(Boolean).slice(0, 6),
    entityNames: entitiesArr.map((e: any) => String(e?.name ?? e?.id ?? "")).filter(Boolean).slice(0, 4),
    stableDigest: opts.stableDigest,
    model,
    specPages: opts.specPages ?? null,
  };
}

/** 从持久化会话状态推导卡片详情（不发明数据：模型缺失就是 draft）。 */
export function deriveAppCardDetail(state: unknown): AppCardDetail {
  const s = (state ?? {}) as Record<string, any>;
  if (s.runtimeKind === "project") {
    // Old closure/HTML can survive in a converted session. They cannot supply
    // an engineering verdict or become the preview while its descriptor loads.
    return {
      ...buildDetailFromModel(null, { evidenceCount: 0, blocked: false, awaitReason: s.awaitReason }),
      runtimeKind: "project",
      projectId: typeof s.projectId === "string" ? s.projectId : null,
      projectRevision: typeof s.projectRevision === "string" ? s.projectRevision : null,
      projectRevisionMode: "current",
      roles: null,
      aiCaps: null,
    };
  }
  const closure = s.publishClosure ?? {};
  const model: FiveSystemModel | null = mergeFiveSystemModels(
    null,
    parseFiveSystemModelFromPerSkillEvidence(closure.perSkillEvidence)
  );
  return buildDetailFromModel(model, {
    evidenceCount: Number(closure.evidencePresentCount ?? 0) || 0,
    blocked: Boolean(closure.blocked),
    awaitReason: s.awaitReason,
    stableDigest: String(closure.stableDigest ?? closure.closureHash ?? "").slice(0, 32) || undefined,
    // 会话态里的 spec-first 整页 HTML（与推演舞台/交付物同一份）
    specPages: extractSpecPages(s.specFirstPages),
  });
}

/**
 * App Store 完整记录（含 model_json）→ 卡片详情。App Store 只存闭环应用，
 * model_json 就是那份 five-system 模型，直接喂 buildDetailFromModel（证据满 6、
 * 不 blocked），得到的指标/身份/活渲染模型跟会话卡完全同源。
 */
export function deriveDetailFromAppRecord(modelJson: unknown, pagesJson?: unknown): AppCardDetail {
  // 空对象 {} 不算可运行模型——truthy 判定会让 LiveAppThumb 挂载空模型
  // 渲染（2026-07-27 审查修复 #14）。
  const model =
    modelJson && typeof modelJson === "object" && Object.keys(modelJson).length > 0
      ? (modelJson as FiveSystemModel)
      : null;
  return buildDetailFromModel(model, {
    evidenceCount: 6,
    blocked: false,
    // 记录里的 spec-first 整页 HTML（pages_json）；老记录没有 → null → 区块渲染
    specPages: extractSpecPages(pagesJson),
  });
}

/**
 * App Store 列表摘要 → 卡片详情。
 *
 * ⚠ 2026-08-22 之前这只是「模型加载前的占位」：roles/aiCaps 暂填 0，卡片进视口
 * 再 `getApp` 拉整包升级。实测代价——应用中心首屏 30 张卡 = 30 次 `/apps/{id}`、
 * 1.9 MB（整包 model_json + pages_json），**全为了指标行那两个数字**。
 * 后端把 role_count / ai_count 放进摘要之后，这条路成了卡片的**唯一**取数路径，
 * 不再有"升级"这一步（点开只读预览才拉整包，见 ensureFullDetail）。
 *
 * 摘要给不出的两样东西保持 null，不编：
 *   model     —— 五系统模型本体（预览要用，卡片不用了）
 *   specPages —— 整页 HTML 本体（同上；has_pages 只是一位布尔）
 */
export function deriveDetailFromAppSummary(s: AppStoreSummary): AppCardDetail {
  return {
    status: "runnable", // App Store 只存闭环应用
    evidenceCount: 6,
    blocked: false,
    entities: s.entity_count || 0,
    pages: s.page_count || 0,
    flowNodes: 0,
    // `?? null` 而不是 `|| 0`：0 是合法的计数（"确实没有角色"），
    // `||` 会把它和 undefined 一起吞成 0，两种语义就此合并。
    roles: s.role_count ?? null,
    aiCaps: s.ai_count ?? null,
    identity:
      s.product_name || s.theme_id
        ? {
            productName: s.product_name || "",
            theme: s.theme_id || "azure",
            // 摘要不含 icon —— 2026-08-22 起卡片不再拉整包，也就没有「模型
            // 加载后升级」这一步了，App Store 卡一律是这个通用图标。要恢复
            // 得给摘要再加一列（同 role_count 那套迁移），暂未做。
            icon: "boxes",
          }
        : null,
    pageNames: [],
    entityNames: [],
    stableDigest: undefined,
    // 卡片不需要这两样（封面走贴图，指标走摘要）。点开只读预览才按需拉整包
    // 并就地把这条详情换掉——见 ensureFullDetail。
    model: null,
    specPages: null,
  };
}

/**
 * 画廊统一条目（两条数据源合流）：
 *   - source "app"     ── App Store 闭环应用（有血缘/版本，可复刻、可删记录）
 *   - source "session" ── 尚未落库的在推演会话草稿（推演中/blocked）
 * 卡片 UI 一套壳，只按 source 分派封面来源 / 菜单动作。
 */
export interface GalleryItem {
  key: string;
  source: "app" | "session";
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  /** session 源必有；app 源 = 记录里的 session_id（可能为空） */
  sessionId?: string;
  /** app 源必有：App Store 记录 id（复刻/删记录/按 id 拉模型） */
  appId?: string;
  rootId?: string;
  parentId?: string | null;
  version?: number;
  /** app 源必有：列表摘要（模型加载前即时渲染卡片） */
  summary?: AppStoreSummary;
  phase?: string | null;
  /**
   * 封面三件套，**在 mergeGalleryItems 里归一**：app 源来自 AppStoreSummary，
   * session 源来自会话摘要（2026-08-24 后端补的 appId + 预览字段）。
   *
   * ⚠ 下游只许读这三个字段，别再回去分别读 `summary?.device` /
   *   `summary?.has_preview`——那样 session 源永远取不到，现象是卡片静默不贴图
   *   （既不报错也不空态，就是一直画空占位）。本仓第三条：同一件事两处判定，
   *   改一处就静默失效。
   */
  device?: string;
  hasPreview?: boolean;
  previewTag?: string;
}

/**
 * 合并两条数据源：App Store 闭环应用（主）∪ 未落库的在推演会话草稿。
 * 按 session_id 去重——某个会话已闭环落库（App Store 里有），就不再把它的会话
 * 草稿卡重复摆出来（App Store 卡取代之，因为它带血缘/版本/可复刻）。
 * 保证零回退：当前所有会话卡仍在，只是闭环的那些改由 App Store 卡承载。
 */
export function mergeGalleryItems(
  apps: AppStoreSummary[],
  sessions: SessionListItem[]
): GalleryItem[] {
  const appItems: GalleryItem[] = apps.map(a => ({
    key: `app:${a.id}`,
    source: "app",
    goal: a.goal || a.product_name || "",
    createdAt: a.created_at,
    lastActive: a.created_at,
    sessionId: a.session_id || undefined,
    appId: a.id,
    rootId: a.root_id,
    parentId: a.parent_id,
    version: a.version,
    summary: a,
    device: a.device,
    hasPreview: Boolean(a.has_preview),
    previewTag: a.preview_tag,
  }));
  const claimed = new Set(
    apps.map(a => a.session_id).filter((x): x is string => Boolean(x))
  );
  const sessionItems: GalleryItem[] = sessions
    .filter(s => s.sessionId && !claimed.has(s.sessionId))
    .map(s => ({
      key: `session:${s.sessionId}`,
      source: "session",
      goal: s.goal,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
      sessionId: s.sessionId,
      phase: s.phase,
      // 会话摘要带回来的绑定应用：认不到应用那一页的会话也能贴自己的封面。
      // appId 一给，这张卡就能走 SheetThumb（判据同 app 源，见 GalleryItem）。
      appId: s.appId,
      version: s.version,
      device: s.device,
      hasPreview: Boolean(s.has_preview),
      previewTag: s.preview_tag,
    }));
  return [...appItems, ...sessionItems];
}

/**
 * 这张卡背后的 App Store 记录——**判据是「有没有记录」，不是「source 是不是 app」**。
 *
 * ⚠ 2026-08-24：菜单里「复刻 / 设为私有 / 移交官方」原来一律用
 *   `item.source === "app"` 把门，于是**会话卡永远只剩「删除应用」**——用户
 *   在「我的应用」里看到一张写着「已闭环」的卡，点开菜单只有一条删除。
 *
 *   而 `mergeGalleryItems` 那边**早就承认了另一种卡**：应用列表一页只拉 12 条
 *   （PAGE_SIZE），会话列表却是全量，绑定的应用还没翻到那一页时，这张闭环应用
 *   就以 session 源摆出来（那条测试的样例名就叫「应用还没翻到那一页」）。它不是
 *   草稿，只是这一刻还没跟自己的记录会合。按 source 判就是把它当草稿。
 *
 *   同一件事两处判定、改一处就静默失效——本仓第四条。封面三件套 8-24 已经在
 *   合并处归一了（device / hasPreview / previewTag），菜单是漏掉的那一半。
 *
 * 两种卡都可能有记录：
 *   app 源     —— 摘要跟着列表一起来，天然有。
 *   session 源 —— 展开菜单时反查一次（见 ensureBoundApp）。**回来之前 bound 是
 *                 undefined，这里返回 null**：菜单先只有删除，记录到了再补上
 *                 那三条。宁可晚一拍，也不摆一组点了会 404 的按钮。
 *
 * 拿到记录就整张换成 app 视图（source/appId/rootId/version/summary 一起换），
 * 下游只认这一份——别在每个动作里各判一次 `source === "app" || bound?.id`。
 */
export function storeRecordFor(
  item: GalleryItem,
  bound: AppStoreSummary | null | undefined
): GalleryItem | null {
  if (item.summary) return item;
  if (!bound) return null;
  return {
    ...item,
    source: "app",
    appId: bound.id,
    rootId: bound.root_id,
    version: bound.version,
    summary: bound,
  };
}

/**
 * 会话还在不在。列表还没拉回来时当「在」——免得首屏闪一帧只读预览。
 * 对照 GitHub：点仓库时 Codespace 没了，不会假装还能进那台机器。
 */
export function sessionIsAlive(
  sessionId: string | undefined,
  sessions: readonly Pick<SessionListItem, "sessionId">[] | null
): boolean {
  if (!sessionId) return false;
  if (sessions == null) return true;
  return sessions.some(s => s.sessionId === sessionId);
}

/**
 * 点卡能不能进会话。自己的卡、会话还在 → 进；会话没了 → 走快照预览。
 * 别人的卡永远不进对方会话（2026-08-06 白屏）。
 */
export function canOpenGalleryItem(
  item: Pick<GalleryItem, "source" | "sessionId"> & {
    summary?: { owner_id?: string | null } | null;
  },
  sessions: readonly Pick<SessionListItem, "sessionId">[] | null,
  user: AuthUser | null
): boolean {
  if (!item.sessionId) return false;
  if (item.source === "session") return true;
  if (!canWriteApp(item.summary?.owner_id ?? null, user)) return false;
  return sessionIsAlive(item.sessionId, sessions);
}

export type GalleryFilter = "all" | "runnable" | "draft" | "blocked";

/** 筛选口径 = 门语言（E41）：closed 6/6（runnable）/ blocked / 推演中（其余）。 */
export function filterCards<
  T extends {
    item: { goal: string; summary?: { product_name?: string } | null };
    detail: AppCardDetail | null;
  },
>(items: T[], filter: GalleryFilter, query: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(({ item, detail }) => {
    // 搜索同时匹配目标文本与产品名——复刻改名后卡片标题是新产品名,
    // 只搜 goal 会"按新名搜不到"（2026-07-27 审查修复）。
    const haystack = `${item.goal} ${detail?.identity?.productName ?? ""} ${
      item.summary?.product_name ?? ""
    }`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (filter === "all") return true;
    if (!detail) return false; // 详情未到不武断归类
    if (filter === "runnable") return detail.status === "runnable";
    if (filter === "blocked") return detail.blocked && detail.status !== "runnable";
    return detail.status !== "runnable" && !detail.blocked;
  });
}

export function formatUpdatedAt(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 相对时间「3 分钟前 / 2 小时前 / 昨天 …」（对标 moment().fromNow()，不引新依赖）。
 * 画廊看的是"新不新、活跃不活跃"，相对时间比绝对时间戳直观。绝对时间由调用方
 * 放进 title 悬浮兜底。now 参数注入便于确定性单测。坏输入回空串。
 */
export function formatRelativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((now - t) / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week} 周前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(day / 365)} 年前`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

// E41 品牌图标封闭集（id 合法域 = @legal identityIcons，与运行时同套语义）
const BRAND_LUCIDE: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  boxes: Boxes,
  chart: BarChart3,
  shield: ShieldCheck,
  cart: ShoppingCart,
  users: Users,
  calendar: Calendar,
  file: FileIcon,
  spark: Sparkles,
  globe: Globe,
  wrench: Wrench,
  heart: Heart,
  book: BookOpen,
};

function themePrimary(themeId: string): string {
  return resolveIdentityTheme(themeId).primary;
}

// E41：徽标 = 全线统一的门语言，不再另造"运行中/待补充"一套。
// dot 色在深色浮层上仍可辨。
//
// 2026-07-31 汉化（用户要求）：原文是 "closed 6/6" / "blocked"，跟旁边的
// 「推演中」混着排，一排筛选条两种语言。译法两条：
//   · blocked → 待补充 —— 见下。
//
// 2026-08-07 去掉 "6/6"（用户裁决："用户根本不关注这些，只会增加用户负担"）。
// 那个数字是六个 Skill（DataModel / Workflow / RBAC / Page / AIGC /
// AppBundle）的证据条数（判定见 buildDetailFromModel 里 `evidenceCount >= 6`）。
// 取舍讲清楚：**它只在"已闭环"这一支出现，而这一支恒等于 6/6** —— 所以它
// 从来没有承担过"还差几项"的信息量，那是「待补充」那一支的事。去掉不丢信息。
//   · blocked → 待补充 —— 跟未闭环占位图上那句「待补充信息」同一套说法，
//     不再一个叫 blocked、一个叫待补充。
const STATUS_META: Record<AppCardStatus, { label: string; cls: string; dot: string }> = {
  runnable: { label: "已闭环", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  awaiting: { label: "待补充", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  draft: { label: "推演中", cls: "bg-blue-50 text-[#1677ff]", dot: "bg-[#4d9aff]" },
};

/** 每页 12 张 = 一行 4 × 最多三行。我的应用滚到底再要；示例库走分页器。 */
export const GALLERY_PAGE_SIZE = 12;
const PAGE_SIZE = GALLERY_PAGE_SIZE;

/**
 * 这一页是不是满的——满了才继续向后要，短页就是到底了。
 * ⚠ 别写成 `>`：刚好 12 张是「还有可能有下一页」，写成 `>` 会在满页停住。
 */
export function pageLooksFull(received: number, pageSize: number = GALLERY_PAGE_SIZE): boolean {
  return received >= pageSize;
}

/**
 * 首屏还没数据时的占位。
 *
 * GitHub Primer《Loading》大区标准答案（不是口味）：
 *   https://primer.style/product/ui-patterns/loading
 *   · 大块内容区只在区域中央放一个不确定进度指示器（Spinner）
 *   · 相邻的一簇内容共用一次加载宣告，禁止每张卡一个指示器
 *   · 不到约 300ms 先不画（SkeletonBox delay=short），闪一下反而显得慢
 *
 * ⚠ 2026-08-18 以前铺 8 张 16:9 空卡（对标 ToolJet AppList）。真墙是
 * 错落瀑布流，等大灰块对不上任何一张真卡，数据到了照样跳版；用户看见
 * 的就是一面假货架。那条「不跳版」在这条链路上不成立。
 */
const GALLERY_LOADING_DELAY_MS = 300;

function GalleryLoading({
  testid,
  label,
}: {
  testid: string;
  label: string;
}) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), GALLERY_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      data-testid={testid}
      className="mt-16 flex min-h-[240px] flex-col items-center justify-center"
      aria-busy="true"
    >
      {show ? (
        <>
          <span
            className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#5b6cff]"
            aria-hidden
          />
          <span role="status" className="mt-3 text-[13px] text-slate-400">
            {label}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** 空态插画（内联 SVG，无外部资产、离线可用、跟随主题）：叠放的卡片 + 一点星光。 */
function EmptyGalleryArt() {
  return (
    <svg width="132" height="104" viewBox="0 0 132 104" fill="none" aria-hidden="true">
      <rect x="26" y="30" width="80" height="52" rx="8" fill="#eef2ff" />
      <rect x="34" y="20" width="80" height="52" rx="8" fill="#e0e7ff" />
      <rect x="42" y="10" width="80" height="52" rx="8" fill="#fff" stroke="#c7d2fe" strokeWidth="2" />
      <rect x="50" y="20" width="30" height="6" rx="3" fill="#c7d2fe" />
      <rect x="50" y="32" width="64" height="4" rx="2" fill="#e0e7ff" />
      <rect x="50" y="42" width="52" height="4" rx="2" fill="#e0e7ff" />
      <path d="M18 16l2.2 5.3L25.5 23l-5.3 2.2L18 30.5l-2.2-5.3L10.5 23l5.3-1.7L18 16z" fill="#5b6cff" opacity="0.9" />
      <circle cx="112" cy="86" r="3" fill="#5b6cff" opacity="0.55" />
      <circle cx="24" cy="72" r="2.5" fill="#5b6cff" opacity="0.4" />
    </svg>
  );
}

// AppRuntimeScreen 很重（antd 表格/echarts 懒 chunk）——App Center 一页最多
// 12 张卡，独立分包 + 视口内才挂载，避免把这份重量压进应用中心首屏包。
const LazyAppRuntimeScreen = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/AppRuntimeScreen").then(m => ({
    default: m.AppRuntimeScreen,
  }))
);

// spec-first HTML 应用面（同源 iframe + DOMPurify + 填孔运行时）。DOMPurify
// 不该进应用中心首屏包——只有带 pages_json 的卡才需要它，同一套 lazy 纪律。
// 只读预览模态用的整页舞台（缩放画布 + 填数徽标，切页走页面自己的菜单），
// 与推演右侧同一个组件。
const LazySpecPageStage = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/SpecPageLiveStage").then(m => ({
    default: m.SpecPageLiveStage,
  }))
);

/**
 * ⚠ 2026-08-22：这里原本住着卡片的**活渲染缩略图**——useThumbMountGate（视口 +
 * 挂载调度双闸）、LiveAppThumb（每张卡挂一个真的 AppRuntimeScreen）、
 * HtmlLiveThumb（每张卡挂一个 spec-first 整页 iframe），外加它们就地采集真截图
 * 回传的那条支路（captureAndUpload + CAPTURE_SETTLE_MS）。整套删掉了。
 *
 * 为什么删：卡片封面统一走**贴图**。活渲染的代价是它自己的注释记着的——
 * 「生产构建下同屏 14 张卡，最长单任务 4106ms，主线程连续堵四秒」；分批挂载
 * 只是把这四秒摊开，总工作量一点没少。而一张 <img> 的解码在合成线程，主线程
 * 零成本。
 *
 * 删了之后真截图从哪来：推演收口那次渲染（pages/sliderule/studio-landing-shot.tsx）
 * ——那次渲染本来就要发生，采下来存住。**卡片不再是采集点**，所以此前从没被
 * 活渲染过的存量应用不会再自己长出图来，它们的封面就是"暂无预览图"。
 * 这是明确取舍（用户 2026-08-22：不补拍）。
 *
 * 会话卡同理：没落进 App Store 就没有图，走同一张空态。
 */

/** 没有封面图时的统一空态（antd Empty，用户 2026-08-22 指定）。 */
export function EmptyThumb({ description }: { description?: React.ReactNode }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[#f7f8fa]"
      data-testid="app-thumb-empty"
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        // antd 默认给 image 一个 100px 高度 + 8px margin，卡片矮的时候会被裁。
        // 缩到 44px，跟卡片信息条的字号量级对得上。
        // 用 styles.image 而不是 imageStyle —— 后者在 antd 5 已废弃，留着每次
        // 渲染都往控制台打一条 deprecated（测试里就打出来了）。
        styles={{ image: { height: 44, marginBottom: 4 } }}
        description={
          <span className="text-[11px] text-stone-400">{description ?? "暂无预览图"}</span>
        }
      />
    </div>
  );
}

/**
 * 只读预览模态里的 HTML 应用面：与推演右侧同一个舞台组件
 * （SpecPageLiveStage：1920×1080 缩放画布 + 填数徽标，切页走页面自己的
 * 菜单），running=false、开屏落在导航第一页。运行时是**内存种子**、
 * 不传 onAction——只读预览既不该
 * 改数据，也不该在本机留痕（比 preview:{id} 命名空间做得更干净：连槽位都不占）。
 */
function SpecPagesPreview({
  specPages,
  model,
}: {
  specPages: SpecPagesDetail;
  model: FiveSystemModel | null;
}) {
  /*
   * ⚠ 只读预览也**不许**给连接器供数的表铺演示种子（2026-08-25）。
   *
   *   这个入口按设计不联网、不留痕（内存种子、不传 onAction），所以它自己
   *   不知道哪张表是连接器供的——挂了天气的应用在市场卡片里就会显示 12 行
   *   编出来的温度。那是这条链路最丢人的失败形态：用户在自己机器上看是真的，
   *   分享出去别人看到的是假的，两边都不报错。
   *
   *   做法是**先标记后铺种子**：标记只写"这张表是连接器供的"，不取数
   *   （取数只有一个写入点，在 SlideRuleStudio）。标记之后 seedRuntimeState
   *   自然跳过它，页面上显示「预览里不取实时数据」——说辞也要对：
   *   预览没取数 ≠ 数据源坏了。
   */
  const [connectorEntities, setConnectorEntities] = React.useState<string[]>([]);
  React.useEffect(() => {
    let alive = true;
    void connectorEntityIds().then(ids => {
      if (alive) setConnectorEntities(ids);
    });
    return () => {
      alive = false;
    };
  }, []);
  const runtime = React.useMemo(
    () =>
      model
        ? seedRuntimeState(
            markConnectorEntities(
              initRuntimeState(model),
              connectorEntities,
              "预览里不取实时数据"
            ),
            model
          )
        : null,
    [model, connectorEntities]
  );
  const pages = React.useMemo(() => livePagesFromSpec(specPages), [specPages]);
  const landingId = pages.find(p => !p.missing)?.pageId ?? pages[0]?.pageId ?? null;
  return (
    <React.Suspense
      fallback={<div className="p-6 text-[13px] text-slate-400">预览加载中…</div>}
    >
      <LazySpecPageStage
        pages={pages}
        running={false}
        model={model}
        runtime={runtime}
        defaultPageId={landingId}
        className="h-full p-3"
      />
    </React.Suspense>
  );
}

/** The actual modal body shares the project renderer with Studio. */
export function AppArtifactPreview({ detail, loading = false, previewKey, appTitle }: {
  detail: AppCardDetail | null | undefined;
  loading?: boolean;
  previewKey: string;
  appTitle: string;
}) {
  if (detail?.runtimeKind === "project") return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-4 py-2 text-xs text-stone-500">
        工程预览使用应用自己的数据；历史版本、源码和复刻操作可在下方工作区面板中使用。
      </p>
      <SandboxPreviewSurface projectId={detail.projectId} projectRevision={detail.projectRevision}
        revisionMode={detail.projectRevisionMode} appTitle={appTitle} />
    </div>
  );
  if (detail?.specPages) return <SpecPagesPreview specPages={detail.specPages} model={detail.model} />;
  if (!detail?.model) return (
    <div className="flex h-full items-center justify-center text-[13px] text-slate-400"
      data-testid="app-preview-loading">
      {loading ? "预览加载中…" : "这一版没有可预览的页面"}
    </div>
  );
  return <React.Suspense fallback={<div className="p-6 text-[13px] text-slate-400">预览加载中…</div>}>
    <LazyAppRuntimeScreen model={detail.model} sessionId={`preview:${previewKey}`}
      appTitle={appTitle} scaleFit="width" />
  </React.Suspense>;
}

/**
 * 这张卡贴不贴图。
 *
 * 只有两个条件：是 App Store 卡（有 appId 才有图可取），且后端说它有图。
 * **不区分是哪一路的图**——真截图和参照板走的是同一个接口、同一套画幅，
 * 挑哪张是服务端的事（见 app_store 的 PREVIEW_SOURCE_PRIORITY）。前端多一个
 * 分支只会多一处要跟后端对齐的地方。
 *
 * ⚠ 2026-08-22 起 false 的去处变了：以前是"回落活渲染"，现在是 EmptyThumb
 * （用户指定的 antd 暂无图片）。has_preview 缺失（老后端不返回这个字段）仍按
 * false 处理，只是那一档从"慢但有画面"变成了"快但没画面"。
 *
 * 会话卡（source==="session"）不在此列：它们还没落进 App Store，没有 app_id
 * 也就没有那张图。
 */
export function shouldUseSheetThumb(item: {
  appId?: string | null;
  hasPreview?: boolean;
}): boolean {
  // ⚠ 2026-08-24 从 `item.summary?.has_preview` 改成归一后的 `hasPreview`。
  //   读 summary 只有 app 源有值，会话卡永远判 false——哪怕它明明绑着一个
  //   有图的应用。归一在 mergeGalleryItems 做，这里只问一个问题。
  return Boolean(item.appId && item.hasPreview);
}

/**
 * 贴图缩略图（2026-08-01 起用，取代绝大多数卡片上的活渲染）。
 *
 * ## 三级来源，这是第一、二级
 *
 * 服务端按可信度挑图，这个组件只管"有图就贴、拉不到就回落"：
 *
 *   ① shot  —— 应用真实渲染出来之后截的图，**就是应用本身**。由前端在活渲染
 *              那张卡上就地采集后回传（lib/thumb-capture.ts）——那次昂贵的渲染
 *              本来就要发生，采下来存住，它就成了最后一次。
 *   ② sheet —— 生成时为了让设计 LLM 有版式可参照，让生图模型画的那张首页
 *              参照板（freeform_block._generate_overview_sheet_b64）。画的就是
 *              这个应用首页长什么样，而且钱已经付过了。落库即有。
 *   ③ 活渲染 —— 两张都没有时的 fallback，也就是这个组件的 fallback 属性。
 *
 * ①② 都落在 generated_app_preview 表（一行两列，见 app_store）。两者画幅一致
 * （PC 1280×720 / 移动 720×1280），所以卡片不用关心贴的是哪一张。
 *
 * ## 为什么第三级要往后排
 *
 * LiveAppThumb 每张卡挂一个真的 AppRuntimeScreen（antd 表格 + echarts 全套）。
 * 它自己的注释记着实测——「生产构建下同屏 14 张卡，最长单任务 4106ms，主线程
 * 连续堵四秒」。分批挂载只是把这四秒摊开，总工作量一点没少。一张 <img> 的解码
 * 在合成线程，主线程零成本。
 *
 * 当初选活渲染的两条理由，贴图方案都躲开了：
 *   「永远最新、零缓存失效」——一条 generated_app 记录本身不可变（精修产生的
 *     是新 app_id，见 save_version），图跟着记录走；图本身会被回填换掉，靠
 *     URL 上的 ?v= 版本位跟上（见 appPreviewUrl）；
 *   「不用额外的存储/沙盒基建」——②用的是生成时已经产出的那张图，只多一张表；
 *     ①用的是本来就要跑的那次活渲染，不起沙盒、不加服务，只多一个回传接口。
 *
 * fail-open 两道：摘要没有 has_preview（老记录/老后端）压根不走这条路；走了
 * 但图拉不到（记录刚被删、网络抖）→ onError 回落 fallback，也就是活渲染。
 * **任何情况下都不会出现空白卡**。
 */
export function SheetThumb({
  appId,
  alt,
  fallback,
  previewTag,
}: {
  appId: string;
  alt: string;
  /** 图拉不到时回落到这个——传的就是原来那套活渲染/占位卡。 */
  fallback: React.ReactNode;
  /** 摘要里的 preview_tag，拼进 URL 当缓存版本位（见 appPreviewUrl）。 */
  previewTag?: string | null;
}) {
  const [failed, setFailed] = React.useState(false);
  // 换了一张卡（翻页/搜索复用同一个组件实例）要把失败态清掉，否则上一张的
  // 失败会让新的这张也直接走 fallback。回填让 tag 变了也要重试：上一次的失败
  // 是针对上一张图的，新图凭什么继承那个结论。
  React.useEffect(() => setFailed(false), [appId, previewTag]);
  if (failed) return <>{fallback}</>;
  return (
    <div
      className="pointer-events-none relative h-full w-full overflow-hidden bg-[#f0f2f5]"
      data-testid="app-thumb-sheet"
    >
      <img
        src={appPreviewUrl(appId, previewTag)}
        alt={alt}
        // absolute 才能压住图的固有尺寸。只写 h-full 时，有的存量 shot
        // 固有宽高比卡片小，img 停在左上角指甲盖大，卡片剩下白底。
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        // 首屏之外的卡不参与解码排队，跟 loading=lazy 是一组
        // eslint-disable-next-line react/no-unknown-property
        fetchPriority="low"
        onError={() => setFailed(true)}
        draggable={false}
      />
    </div>
  );
}

function StatChip({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  // 扁平筛选 chip：圆角收成 lg，避免全圆胶囊过圆
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
      onClick={onClick}
    >
      <span className={active ? "opacity-100" : "opacity-70"}>{icon}</span>
      <span>{label}</span>
      <span
        className={`tabular-nums text-[11px] ${
          active ? "text-[#3b5bdb]/80" : "text-slate-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * 应用中心统一卡片壳（E42 硬性要求）：16:9 画面铺满整卡，字段内容
 * 以底部渐变浮层压在图上——我的应用与官方示例库共用同一张壳，
 * 只有 media / 指标 / 状态注入不同。
 */
export function CenterCard({
  testid,
  title,
  titleAttr,
  iconBg,
  Icon,
  media,
  metrics,
  statusDot,
  statusLabel,
  onClick,
  topRight,
  mediaHeight,
  compact = false,
}: {
  testid: string;
  title: string;
  titleAttr?: string;
  iconBg?: string;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
  media: React.ReactNode;
  metrics: React.ReactNode;
  statusDot: string;
  statusLabel: string;
  onClick: () => void;
  topRight?: React.ReactNode;
  /** **画面**高（px），不含图外那条信息行——信息行由布局的 captionHeight 定。 */
  mediaHeight?: number | string;
  /** 紧凑态：格子窄到放不下品牌图标时收起它，标题让位。 */
  compact?: boolean;
}) {
  return (
    <div
      data-testid={testid}
      title={titleAttr}
      // 2026-08-23 下午：信息层从**压在画面上**改成**排在画面外**。
      //
      // 这条来回过两趟，两次的前提都变了，别当成反复（完整经过见 ColumnsWall
      // 文件头）：
      //   7-31  压图上 → 排图下 → 又压回图上（用户裁决）。当时改回来的理由是
      //         "压在图上没有文字宽度下限"，而那个理由成立的前提是**当时是等宽
      //         瀑布流、最窄列 260px**。
      //   8-23 上午 换成等高变宽（两端对齐行），手机卡掉到 110~133px 宽——7-31
      //         那个"122px 放不下标题"的场景原样回来了，只是当时没人发现，
      //         因为字还压在图上、被 opacity-30 糊着看不出来。
      //   8-23 下午 用户对着花瓣的墙提"层次结构有差距"。真机出了三档效果图：
      //         只把字挪出去（保持等高变宽）→ 窄卡标题只剩「构建面…」，废；
      //         等宽 + 字挪出去 → 成。于是两条一起改。
      //
      // 所以画面上现在**默认一个字都不压**。原来那条渐变黑带（默认 opacity-30、
      // 悬停 100）整条退场——它当初存在的唯一理由是"字必须压在图上"。
      //
      // 指标（页面/角色/AI/时间）不进图外那行：那行只放标题和状态，多一样就
      // 会跟标题抢宽度，等宽也救不回来。指标改成**悬停时**才浮在画面底部，
      // 静态时画面是干净的——卡片墙的意义是"一眼看出这个系统长什么样"。
      // relative：卡片菜单（topRight）挂在**这一层**，不在画面里。
      // 见下面 topRight 那段注释——画面是 overflow-hidden 的。
      className="group relative flex h-full w-full cursor-pointer flex-col"
      onClick={onClick}
    >
      {/* 画面区：这张卡的主体。不给边框和阴影——参考站的墙上，图就是卡本身，
          外框只会在密排时叠成一片网格线。极淡的 ring 只为了压住纯白截图的边，
          悬停才升成品牌色。 */}
      <div
        className="relative w-full shrink-0 overflow-hidden rounded-[10px] bg-[#f0f2f5] ring-1 ring-black/[0.04] transition group-hover:ring-2 group-hover:ring-[#1677ff]/50"
        style={{ height: mediaHeight }}
      >
        <div className="absolute inset-0 overflow-hidden">{media}</div>
        {/* 指标：静态不在，悬停才浮出来。渐变只压住文字那一带，深浅截图都读得清。 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2.5 pb-1.5 pt-7 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/85">
            {metrics}
          </div>
        </div>
      </div>
      {/*
        卡片菜单（「…」按钮 + 下拉层）。

        ⚠ 2026-08-24：这一坨原来放在**画面 div 里面**，而画面为了裁剪截图带着
        `overflow-hidden`（上面那个 rounded-[10px] 的容器）。四条菜单项一共
        ~124px，从 top-8 铺下去正好越过画面下沿——真机现象是「删除应用」被齐
        齐切掉半行，用户看见的是一个缺了底的弹层。菜单本身没错，错在它长在一个
        会裁剪的盒子里。

        挂到卡片根节点（relative，无 overflow）上，位置一模一样：根节点的顶边
        就是画面的顶边，right-2/top-2 与原来同一个点。

        为什么 z-10 就够、不用往上堆：墙里每一格是 ColumnsWall 的
        `position:absolute` 无 z-index 节点（**没有 transform**），不构成层叠
        上下文，所以这个 z-10 是拿到画廊容器那一层去比的，压得住后面画的兄弟卡。
        哪天格子加了 transform / z-index，这条就会静默失效——菜单会被后面的卡
        盖住，不报错。
      */}
      {topRight}
      {/* 信息行：在画面**外**，页面底色上。黑字白底，任何截图都盖不住它。 */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5 pt-[7px]">
        {Icon && !compact && (
          <span
            className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] text-white"
            style={{ background: iconBg }}
          >
            <Icon size={10} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-stone-800">
          {title}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-stone-400">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

/** 卡片墙一格的数据：应用条目 + 已解析的卡面细节（可能还没到）。 */
interface WallEntry {
  item: GalleryItem;
  detail: AppCardDetail | null;
}

/**
 * 卡片墙的列宽下限与间距。列数由 `computeColumns`（masonic getColumns() 的移植）
 * 按容器宽度算，算完还会把列宽**撑满**剩余空间
 * （columnWidth = (width - gutter*(n-1)) / n），所以这个值是「最窄能到多少」，
 * 不是最终列宽。
 *
 * ## 为什么从 260 降到 240
 *
 * 260 那个下限**是被信息区顶出来的**：当时「页面 n · 角色 n · AI n · 时间 ·
 * 状态」这一整排要在卡片里排成一行，240（5 列 × 244px）会把状态挤到第二行。
 *
 * 2026-08-23 下午信息区改了：图外那行**只放标题和状态**，指标挪到悬停浮层
 * （见 CenterCard）。顶出 260 的那排东西不在了，下限随之由「标题读不读得
 * 出来」定 —— 240 下 1600px 视口可用宽 ~1340 → 5 列 × 255px，标题能露约
 * 16 个汉字，够认出是哪个应用。
 *
 * ⚠ 改这个数之前先确认信息行还是不是只有标题+状态。这两个数是**绑在一起**的，
 *   往回加东西却不抬下限，现象是标题被截成「构建面…」——不报错，只是没用。
 *
 * 屏幕再宽会自动加列（容器 2400px → 9 列），不用改这里。
 */
const WALL_MIN_COLUMN_WIDTH = 240;
const WALL_GUTTER = 16;

/**
 * 图外那条信息行的高度（px）。
 *
 * 它由**布局**持有、传给 ColumnsWall，再由 ColumnsWall 从格高里减掉之后把
 * 「画面高」交给卡片。卡片自己不许再算一遍——两处真值改一处就压盖或留缝，
 * 而且不报错（同 renderAppCard 里那条 ⚠）。
 *
 * 32 = 7px 上边距 + 13px 字号那行的行高，实测刚好不挤。
 */
const WALL_CAPTION_HEIGHT = 32;

/**
 * 「我的应用」瀑布流。
 *
 * 滚动源：`<Masonry>` 内部是 `MasonryScroller` → `useScroller()` →
 * `@react-hook/window-scroll`，**写死 window**，视口高度取 `window.innerHeight`。
 * 本应用滚的是 `.native-content`，window 一格都不滚，scrollTop 会恒为 0
 * （详见 useScrollerIn.ts），所以这一层换成本地滚动容器。
 *
 * 渲染层：`useMasonry` 也不能用——它把每格宽度写死成全局列宽，跨列卡表达不出来。
 * 换成 SpanMasonry（自建渲染循环 + 跨列定位器），落位规则照搬 Pinterest gestalt
 * 的 multiColumnLayout。为什么非要跨列，见 app-wall-span.ts 顶部那段：卡片高度
 * 由设备宽高比算出，三档里桌面占 89%，不引入跨列的话整面墙的高度是**同一个数**。
 *
 * 仍然复用 masonic 的 `useContainerPosition` 与 `createIntervalTree`。
 *
 * 单独抽成组件而不是写在 AppsWorkbench 里，是因为这几个都是 hook——卡片墙
 * 在「空态/搜索无结果/有结果」三岔里只有一岔渲染，写在外层就成了条件调用。
 */
/**
 * 卡片一挂上（虚拟化进视口 / 隐藏量高）才去拉完整模型。
 * 开局用 4 个工人扫全表 getApp——2026-08-18 首页就是这样把全部应用一次加载完的。
 */
function GalleryCardGate({
  item,
  ensure,
  children,
}: {
  item: GalleryItem;
  ensure: (gi: GalleryItem) => void;
  children: React.ReactNode;
}) {
  const itemRef = React.useRef(item);
  itemRef.current = item;
  React.useEffect(() => {
    ensure(itemRef.current);
    // item 每轮渲染都是新对象，按 key 钉住，避免每帧重入 ensure。
  }, [item.key, ensure]);
  return <>{children}</>;
}

function AppWall({
  items,
  renderCard,
  onReachEnd,
  ensureDetail,
}: {
  items: WallEntry[];
  renderCard: (
    item: GalleryItem,
    detail: AppCardDetail | null,
    cellW: number,
    /** **画面**高，不含图外那条信息行。 */
    mediaH: number,
  ) => React.ReactNode;
  onReachEnd?: () => void;
  ensureDetail: (gi: GalleryItem) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, height } = useScrollerIn(containerRef);
  // width 要跟着容器走（侧栏收起、窗口缩放都会变），deps 给 height 让它重量。
  const { offset: _offset, width } = useContainerPosition(containerRef, [height]);

  return (
    <div data-testid="apps-wall" style={{ display: "contents" }}>
      <ColumnsWall<WallEntry>
        containerRef={containerRef}
        items={items}
        width={width}
        height={height}
        scrollTop={scrollTop}
        minColumnWidth={WALL_MIN_COLUMN_WIDTH}
        captionHeight={WALL_CAPTION_HEIGHT}
        spacing={WALL_GUTTER}
        overscanBy={2}
        // 宽高比就是设备档：桌面 1.6、手机 0.5625。等宽之下，错落全部来自它，
        // 不再需要「按页面数取前 1/4 跨两列」那条人工规则。
        aspectOf={entry => aspectForDevice(entry.item.device)}
        itemKey={entry => entry.item.key}
        // ⚠ 不给 className：这里原来是 mt-5（20px 上边距）。2026-08-24 用户指着
        //   DevTools 里那条橙带让去掉——筛选条那一行自己已经有下边距，再加一段
        //   就是首屏白白空一块。定位容器的 top 是从这个节点算的，加边距只会把
        //   整面墙往下推，不会让卡片之间更松（那是 spacing 的事）。
        onReachEnd={onReachEnd}
        // ⚠ 第四个参数是**画面高**，不是格高（格高 = 画面高 + captionHeight）。
        render={(entry, _i, cellW, mediaH) => (
          <GalleryCardGate item={entry.item} ensure={ensureDetail}>
            {renderCard(entry.item, entry.detail, cellW, mediaH)}
          </GalleryCardGate>
        )}
      />
    </div>
  );
}

/** 官方示例（E41）：冻结过门模型的摘要投影（API 返回，全真数据）。 */
export interface BuiltinExample {
  domain: string;
  productName: string;
  theme: string;
  icon: string;
  nav: string;
  intent: string;
  category: string;
  pages: number;
  roles: number;
  aiCapabilities: number;
  tags: string[];
}

/** 点模板 = 新会话 + 暂存起手意图（SlideRule 页挂载时消费预填输入框）。 */
export const PENDING_TEMPLATE_INTENT_KEY = "sliderule:pending-template-intent";

export function AppsWorkbench() {
  // 两条数据源：apps = App Store 闭环应用（摘要，有血缘/版本/可复刻）；
  // sessions = 会话（含尚未落库的在推演草稿）。合并成画廊条目（mergeGalleryItems）。
  const [apps, setApps] = React.useState<AppStoreSummary[] | null>(null);
  const [sessions, setSessions] = React.useState<SessionListItem[] | null>(null);
  // 详情按画廊条目 key（app:<id> / session:<id>）索引——两条源共用一张 map。
  const [details, setDetails] = React.useState<Record<string, AppCardDetail | null>>({});
  const [listError, setListError] = React.useState<string | null>(null);
  // 三服务健康（原观察台独有价值下放：点健康点展开分列详情）
  const [nodeOk, setNodeOk] = React.useState<boolean | null>(null);
  const [pyOk, setPyOk] = React.useState<boolean | null>(null);
  const [llm, setLlm] = React.useState<{ provider: string; model: string; keyPresent: boolean } | null | false>(null);
  const [healthOpen, setHealthOpen] = React.useState(false);
  const [tab, setTab] = React.useState<AppShelf>("market");
  // 登录态：决定复刻/删除按钮显不显示（真判定在后端）
  const { user: authUser, capabilities } = useAuth();
  const [filter, setFilter] = React.useState<GalleryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sortDesc, setSortDesc] = React.useState(true);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  // 复刻改名弹框（对标 Budibase duplicateApp：预填「源名 副本」让用户改名）
  const [forkModal, setForkModal] = React.useState<{ item: GalleryItem; name: string } | null>(null);
  const [deleteModal, setDeleteModal] = React.useState<GalleryItem | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [reopenBusy, setReopenBusy] = React.useState(false);
  /**
   * 只读预览（2026-08-06）：点开**别人的**应用时用它，而不是往对方的会话里跳。
   *
   * 此前卡片点击一律 `open(item.sessionId)`——`canOpen` 只判了"有没有
   * sessionId"，没判"这条会话是不是你的"。于是点别人的应用会跳进对方的
   * 会话 URL，而会话按归属隔离（services/app_access.session_access），
   * GET /sessions/{id} 返回 404 → 页面一片空白，卡在"正在准备工作台"。
   * 用户实测原话："点击这个应用，跳转过去发现啥也没有空的"。
   *
   * 取的是 Gitea / Budibase 同一套动线：**看别人的东西是只读的，要改先
   * Fork 成自己的**。模型本来就在 details[key].model 里（活渲染缩略图用的
   * 就是它），所以预览不需要任何新接口，也不碰对方的会话。
   */
  const [previewModal, setPreviewModal] = React.useState<GalleryItem | null>(null);
  const [forkBusy, setForkBusy] = React.useState(false);
  const [forkError, setForkError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [appsHasMore, setAppsHasMore] = React.useState(false);
  const appsOffsetRef = React.useRef(0);
  const appsIdsRef = React.useRef(new Set<string>());
  const loadingMoreRef = React.useRef(false);
  const visibleOrderRef = React.useRef<string[]>([]);
  const aliveRef = React.useRef(true);
  const detailsRef = React.useRef<Record<string, AppCardDetail | null>>({});
  const inflightRef = React.useRef(new Set<string>());
  /**
   * 会话卡背后那条 App Store 记录（key → 摘要 / null=确认没有）。
   *
   * ⚠ 2026-08-24：菜单里「复刻 / 设为私有 / 移交官方」原来一律用
   *   `source === "app"` 把门，于是**会话卡永远只剩「删除应用」**。可
   *   `mergeGalleryItems` 那边早就承认了另一种卡：应用分页一次只拉 12 条，
   *   会话列表却是全量，绑定的应用还没翻到那一页时这张卡就以 session 源
   *   摆出来（那条测试的样例名就叫「应用还没翻到那一页」）。它是闭环应用，
   *   只是这一刻还没跟自己的记录会合——按 source 判等于把它当草稿。
   *   本仓第四条：同一件事两处判定，改一处就静默失效。封面三件套 8-24 已经
   *   在合并处归一了，菜单是漏掉的那一半。
   *
   *   反查沿用 `removeCard` 已经在用的那条路（GET /sessions/{id}/generated-app，
   *   列表分页反查会漏，所以有这条接口）。只在**真的展开菜单**时打一次，
   *   不给整墙每张卡预热。
   */
  const boundAppsRef = React.useRef<Record<string, AppStoreSummary | null>>({});
  const [boundApps, setBoundApps] = React.useState<Record<string, AppStoreSummary | null>>({});
  const boundInflightRef = React.useRef(new Set<string>());
  // E28：订阅会话库更新事件（侧栏删会话/新话题落盘）→ 重拉画廊
  const [reloadKey, setReloadKey] = React.useState(0);
  // 上一次「清空重来」是为哪个 tab 做的。同 tab 内重拉不再清空。
  const blankedForRef = React.useRef<string | null>(null);
  // 自己广播出去、还没被自己的监听器吃掉的会话更新事件数。
  const selfNotifyRef = React.useRef(0);
  // 当前已经加载出来的应用数（滚动分页累计）。同 tab 重拉时按它拉回来。
  const loadedCountRef = React.useRef(0);
  /** 广播给侧栏，但不让本组件因此整体重拉——本地已经改好了。 */
  const notifySidebarOnly = React.useCallback(() => {
    selfNotifyRef.current += 1;
    notifySessionsUpdated();
  }, []);
  // E41 官方示例库（2026-08-14 起货架清空但功能保留；后端上架即恢复展示）
  const [examples, setExamples] = React.useState<BuiltinExample[]>([]);
  const [exampleCat, setExampleCat] = React.useState("全部");
  React.useEffect(() => {
    // ⚠ 2026-08-22：本组件**自己**也会 notifySessionsUpdated()（删应用、
    //   复刻、从快照重开），广播出去是给侧栏用的。可这个监听器不认发送方，
    //   于是自己的广播把自己整体重拉了一遍——`confirmDeleteApp` 里那句认真
    //   写的本地摘卡（注释还写着「不整页刷新」）当场白做。
    //   自己发出去的那一拍跳过：侧栏照收不误，这边不推倒重来。
    const bump = () => {
      if (selfNotifyRef.current > 0) {
        selfNotifyRef.current -= 1;
        return;
      }
      setReloadKey(k => k + 1);
    };
    window.addEventListener(SESSIONS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(SESSIONS_UPDATED_EVENT, bump);
  }, []);
  detailsRef.current = details;
  boundAppsRef.current = boundApps;
  // 筛选口径变化 → 回第一页（分页器与滚动分页都回到开头）
  React.useEffect(() => {
    setPage(1);
    visibleOrderRef.current = [];
  }, [tab, filter, query, exampleCat, sortDesc]);

  React.useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    appsOffsetRef.current = 0;
    appsIdsRef.current = new Set();
    inflightRef.current.clear();
    visibleOrderRef.current = [];
    // ★ 只有首次加载和切 tab 才清空（2026-08-22）。同一个 tab 里的重拉——
    //   复刻出新卡、侧栏删了会话——一律不清：用户该看到「某张卡变了」，
    //   不是「整页白 7 秒又长回来」。判据 shouldBlankGallery。
    if (shouldBlankGallery(blankedForRef.current, tab)) {
      setApps(null);
      setAppsHasMore(false);
      blankedForRef.current = tab;
    }
    if (IS_GITHUB_PAGES) {
      // 静态演示（无后端）：画廊 = 主演示会话 + 画廊示例种子（E18：新引擎
      // 真实推演的闭环终态，懒加载不进主包）。不打任何 /api/*。App Store 无后端 → 空。
      setApps([]);
      const store = createGithubPagesSlideRuleSessionStore();
      void Promise.all([
        loadOrSeedGithubPagesDemoSession(store),
        import("@/pages/sliderule/demo-gallery").then(m =>
          m.seedGalleryExamples(store)
        ),
      ])
        .then(([demoState, examples]) => {
          if (!alive) return;
          const sessionList: SessionListItem[] = [
            { sessionId: GITHUB_PAGES_DEMO_SESSION_ID, goal: GITHUB_PAGES_DEMO_GOAL },
            ...examples.map(e => ({ sessionId: e.sessionId, goal: e.goal })),
          ];
          setSessions(sessionList);
          // 演示态详情按合并后的条目 key（session:<id>）索引，跟真实态口径一致。
          setDetails({
            [`session:${GITHUB_PAGES_DEMO_SESSION_ID}`]: deriveAppCardDetail(demoState),
            ...Object.fromEntries(
              examples.map(e => [`session:${e.sessionId}`, deriveAppCardDetail(e.state)])
            ),
          });
        })
        .catch(() => alive && (setSessions([]), setApps([])));
      return () => {
        alive = false;
      };
    }
    // 真实态：摘要按页拉（limit=12），会话列表仍是瘦列表。
    // 完整模型禁止在这里扫全表——按卡挂载走 ensureDetail（2026-08-18）。
    // App Store 失败 fail-open 空数组（画廊退化成纯会话卡，零回退）。
    // ★ 同一个 tab 里重拉时，把**已经滚出来的那些页**一起拉回来
    //   （2026-08-22）。原来一律 limit=PAGE_SIZE，用户滚到第 9 页做个操作
    //   就被打回前 12 张——比整页白闪更难受，因为位置也丢了。
    //   封顶避免一次拉全表：超过就退回一页，用户再滚。
    const keepLoaded = Math.min(Math.max(PAGE_SIZE, loadedCountRef.current), PAGE_SIZE * 8);
    void Promise.allSettled([
      listApps({ limit: keepLoaded, offset: 0, scope: tab }),
      // 与侧栏共享同一次请求：两边在同一拍挂载，各拉一次等于白打一发
      // （见 sessions-list-client）。
      fetchSessionsList(),
    ]).then(([appsRes, sessRes]) => {
      if (!alive) return;
      const appList = appsRes.status === "fulfilled" ? appsRes.value : [];
      setApps(appList);
      appsOffsetRef.current = appList.length;
      loadedCountRef.current = appList.length;
      appsIdsRef.current = new Set(appList.map(a => String(a.id || "")).filter(Boolean));
      setAppsHasMore(pageLooksFull(appList.length, PAGE_SIZE));
      if (sessRes.status === "fulfilled") {
        const sessionList = ((sessRes.value?.sessions ?? []) as SessionListItem[]).filter(
          (s: SessionListItem) => s.sessionId
        );
        setSessions(sessionList);
      } else {
        setSessions([]);
        setListError(String((sessRes.reason as Error)?.message ?? sessRes.reason));
      }
    });
    fetch("/api/sliderule/builtin-examples")
      .then(r => (r.ok ? r.json() : null))
      .then(d => alive && setExamples(Array.isArray(d?.examples) ? d.examples : []))
      .catch(() => alive && setExamples([]));
    fetch("/api/health")
      .then(r => alive && setNodeOk(r.ok))
      .catch(() => alive && setNodeOk(false));
    fetch("/api/agent-loop/health")
      .then(r => (r.ok ? r.json() : null))
      .then(d => alive && setPyOk(Boolean(d && d.status === "ok")))
      .catch(() => alive && setPyOk(false));
    fetch("/api/sliderule/llm-channel")
      .then(r => (r.ok ? r.json() : null))
      .then(d =>
        alive &&
        setLlm(
          d
            ? {
                provider: String(d.provider ?? ""),
                model: String(d.model ?? ""),
                keyPresent: Boolean(d.keyPresent),
              }
            : false
        )
      )
      .catch(() => alive && setLlm(false));
    return () => {
      alive = false;
      aliveRef.current = false;
    };
    // reloadKey：会话库变更事件（侧栏删除/话题落盘）触发整体重拉，
    // 应用中心与左侧会话列表保持双向同步（E28）
  }, [reloadKey, tab]);

  /**
   * 卡片详情。
   *
   * ⚠ App Store 卡**不再打网络**（2026-08-22）：摘要里已经有指标行要的全部
   * 数字（页面/角色/AI），封面走贴图，卡片就没有任何理由去拉整包了。
   * 改动前每张卡一次 `GET /apps/{id}`——首屏 30 张 = 30 次请求、1.9 MB。
   *
   * 会话卡还得拉：它们没落进 App Store，状态/进度只在会话档里。
   * （那是首屏另一笔 2.3 MB，另案。）
   *
   * 整包只在**点开只读预览**时按需拉一次，见 ensureFullDetail。
   */
  const ensureDetail = React.useCallback((gi: GalleryItem) => {
    if (detailsRef.current[gi.key] !== undefined) return;
    if (gi.source === "app") {
      // 同步落，不进 inflight——没有异步，也就没有"在飞"这回事。
      setDetails(prev => ({
        ...prev,
        [gi.key]: gi.summary ? deriveDetailFromAppSummary(gi.summary) : null,
      }));
      return;
    }
    if (inflightRef.current.has(gi.key)) return;
    inflightRef.current.add(gi.key);
    void (async () => {
      try {
        if (gi.sessionId) {
          const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(gi.sessionId)}`);
          const body = res.ok ? await res.json() : null;
          if (!aliveRef.current) return;
          setDetails(prev => ({
            ...prev,
            [gi.key]: body?.state ? deriveAppCardDetail(body.state) : null,
          }));
        }
      } catch {
        if (!aliveRef.current) return;
        setDetails(prev => ({ ...prev, [gi.key]: null }));
      } finally {
        inflightRef.current.delete(gi.key);
      }
    })();
  }, []);

  /**
   * 只读预览要的整包（model_json + pages_json）—— **只有点开大图才拉**。
   *
   * 卡片详情是从摘要推出来的（model/specPages 都是 null），预览渲染器要的正是
   * 这两样。拉回来就地把 details[key] 换成完整版；拉不到就保持摘要版，预览里
   * 显示"这一版没有可预览的页面"，不是白屏。
   *
   * 幂等：已经有 model 或 specPages 的不再拉；同一张卡并发点开只拉一次。
   */
  // ref 负责同步去重（并发点开只拉一次），state 负责让"加载中"能渲染出来。
  // 两份必须一起改——只留 ref 的话弹窗永远显示"没有可预览的页面"。
  const fullInflightRef = React.useRef<Set<string>>(new Set());
  const [fullInflightKeys, setFullInflightKeys] = React.useState<string[]>([]);
  const ensureFullDetail = React.useCallback((gi: GalleryItem) => {
    if (gi.source !== "app" || !gi.appId) return;
    const have = detailsRef.current[gi.key];
    if (have?.model || have?.specPages) return;
    if (fullInflightRef.current.has(gi.key)) return;
    fullInflightRef.current.add(gi.key);
    setFullInflightKeys(prev => (prev.includes(gi.key) ? prev : [...prev, gi.key]));
    void (async () => {
      try {
        const rec = await getApp(gi.appId!);
        if (!aliveRef.current || !rec) return;
        // 整取整换，不做字段级合并：两份详情是同一份模型的两次投影
        // （后端数 role_count 用的就是 model.rbac.roles），合并只会多出
        // 一处"两边不一致时听谁的"的规则。整包更全——真图标、页面名、
        // 实体名摘要里都没有。
        setDetails(prev => ({
          ...prev,
          [gi.key]: deriveDetailFromAppRecord(rec.model_json, rec.pages_json),
        }));
      } finally {
        fullInflightRef.current.delete(gi.key);
        setFullInflightKeys(prev => prev.filter(k => k !== gi.key));
      }
    })();
  }, []);

  /**
   * 会话卡 → 它绑定的 App Store 记录。**只在展开菜单时打这一次**。
   *
   * 幂等：查过的（含查出来是 null 的）不再查；同一张卡连点只飞一次。
   * fail-open：查不到就当「这张卡真的没落库」，菜单退回只有删除——那正是
   * 草稿卡应有的样子，不是伪造一组点了会 404 的按钮。
   */
  const ensureBoundApp = React.useCallback((gi: GalleryItem) => {
    if (gi.source !== "session" || !gi.sessionId) return;
    if (boundAppsRef.current[gi.key] !== undefined) return;
    if (boundInflightRef.current.has(gi.key)) return;
    boundInflightRef.current.add(gi.key);
    void (async () => {
      try {
        const rec = await getGeneratedAppForSession(gi.sessionId!);
        if (!aliveRef.current) return;
        setBoundApps(prev => ({ ...prev, [gi.key]: rec }));
      } finally {
        boundInflightRef.current.delete(gi.key);
      }
    })();
  }, []);

  /**
   * 改完可见性/官方归属之后就地更新，**两份缓存都要改**。
   *
   * ⚠ 记录有两个落脚点：列表里的 `apps`（app 源）和反查缓存 `boundApps`
   *   （会话卡）。会话卡的记录不在 `apps` 里，只调 applyAppPatch 会**一声不吭
   *   地什么都没改**——菜单文案不翻（点了"设为私有"下次打开还写着"设为私有"），
   *   而且不报错。本仓第四条的标准形状。
   */
  const applyPatchedApp = React.useCallback(
    (gi: GalleryItem, appId: string, res: { visibility?: string; is_official?: boolean }) => {
      setApps(prev => applyAppPatch(prev, appId, res));
      setBoundApps(prev => {
        const cur = prev[gi.key];
        if (!cur || cur.id !== appId) return prev;
        // patchApp 的返回类型是宽的 `string`，摘要里 visibility 是三选一的联合。
        // 认不出的值保持原样——菜单文案就是照它渲染的，塞个非法字面量进去
        // 只会让下一次点击算出相反的 next。
        const visibility =
          res.visibility === "public" ||
          res.visibility === "unlisted" ||
          res.visibility === "private"
            ? res.visibility
            : cur.visibility;
        return {
          ...prev,
          [gi.key]: { ...cur, visibility, is_official: res.is_official ?? cur.is_official },
        };
      });
    },
    []
  );

  const loadMoreApps = React.useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const offset = appsOffsetRef.current;
      const list = await listApps({ limit: PAGE_SIZE, offset, scope: tab });
      if (!aliveRef.current) return;
      const added = list.filter(a => {
        const id = String(a.id || "");
        return Boolean(id) && !appsIdsRef.current.has(id);
      }).length;
      setApps(prev => {
        const out = appendUniqueById(prev, list, a => String(a.id || ""));
        appsIdsRef.current = new Set(out.map(a => String(a.id || "")).filter(Boolean));
        // ★ 同 tab 重拉要按这个数把已滚出来的页一起拉回来，漏了这行的话
        //   计数永远停在第一页，用户滚了多远都会被打回前 12 张。
        loadedCountRef.current = out.length;
        return out;
      });
      appsOffsetRef.current = offset + list.length;
      // 满页但一条新身份都没有 = OFFSET 窗口在打转，再要只会 35→48。
      setAppsHasMore(pageLooksFull(list.length, PAGE_SIZE) && added > 0);
    } catch {
      if (aliveRef.current) setAppsHasMore(false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [tab]);

  const onWallReachEnd = React.useCallback(() => {
    // 推演中 / 待补充主要是会话卡，不必为筛选项把后面的应用页要齐。
    if (filter === "draft" || filter === "blocked") return;
    if (!appsHasMore) return;
    void loadMoreApps();
  }, [filter, loadMoreApps, appsHasMore]);

  const open = (sessionId: string) => {
    activateSession(sessionId);
    // Pages 子路径部署（/<repo>/）下绝对路径 404——带 BASE_URL 前缀
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    window.location.href = `${base}${slideruleSessionPath(sessionId)}`;
  };

  /**
   * 开一个新会话：**先向服务端要 id**，拿到再跳（2026-08-06）。
   *
   * 以前是本地铸 id 直接跳，服务端只能被动接受客户端说的 id——熵只有 25 位，
   * 而且实测出过劫持漏洞（拿别人的 id 发一次 POST 就能夺走整条会话）。
   *
   * 失败**不静默回落到本地 id**：那等于把刚拆掉的弱路径又留个后门。真实原因
   * 通常是没登录（建会话已要求登录），如实提示比给个用不了的 id 强。
   */
  const openNewSession = () => {
    void (async () => {
      try {
        open(await createSessionId());
      } catch (e) {
        setListError(String(e instanceof Error ? e.message : e));
      }
    })();
  };

  const useTemplate = (example: BuiltinExample) => {
    try {
      localStorage.setItem(PENDING_TEMPLATE_INTENT_KEY, example.intent);
    } catch {
      /* 隐私模式无存储：仍然打开新会话，用户手动输入 */
    }
    openNewSession();
  };

  /** 删卡：App Store 卡走确认框（更重）。会话草稿若已经落过库，按删应用走，
   *  否则只删会话。菜单写的是「删除应用」——只 DELETE session 会留下货架卡。 */
  const removeCard = async (gi: GalleryItem) => {
    try {
      if (gi.source === "app" && gi.appId) {
        setDeleteError(null);
        setDeleteModal(gi);
        setMenuFor(null);
        return;
      } else if (gi.sessionId) {
        const bound = await getGeneratedAppForSession(gi.sessionId);
        if (bound?.id) {
          setDeleteError(null);
          setDeleteModal({
            ...gi,
            source: "app",
            appId: bound.id,
            rootId: bound.root_id,
            summary: bound,
          });
          setMenuFor(null);
          return;
        }
        // DELETE 幂等（G1 契约）；成功后本地摘卡，不整页刷新
        await fetch(`/api/sliderule/sessions/${encodeURIComponent(gi.sessionId)}`, {
          method: "DELETE",
        });
        const remaining = (sessions ?? []).filter(s => s.sessionId !== gi.sessionId);
        setSessions(remaining);
        // E28：与左侧会话列表联动——广播更新事件让侧栏立即摘掉该会话；
        // 删的是当前活跃会话时切到最近剩余会话（一个不剩就开新会话），
        // 避免 active-session-id 悬空指向已删会话
        // ★ 上一行已经本地摘掉了，只通知侧栏，不让自己整体重拉。
        notifySidebarOnly();
        try {
          if (localStorage.getItem(ACTIVE_SESSION_KEY) === gi.sessionId) {
            // 还有剩的就切过去；一条不剩才向服务端要新的
            if (remaining[0]?.sessionId) activateSession(remaining[0].sessionId);
            else openNewSession();
          }
        } catch {
          /* 隐私模式无存储：跳过活跃会话纠正 */
        }
      }
    } catch {
      /* 网络失败保持原样，用户可重试 */
    }
    setMenuFor(null);
  };

  const confirmDeleteApp = async () => {
    const gi = deleteModal;
    if (!gi?.appId) return;
    const ok = await deleteApp(gi.appId);
    if (!ok) {
      // ⚠ 2026-08-21：失败也关弹窗 = 点了「确认删除」零反馈，货架卡还在。
      setDeleteError("没有从货架上拿掉。请再试一次。");
      return;
    }
    setDeleteError(null);
    // 同 root 旧版会在刷新时顶上来；按血缘从本地列表摘干净。
    setApps(prev =>
      (prev ?? []).filter(a => {
        if (a.id === gi.appId) return false;
        if (gi.rootId && a.root_id === gi.rootId) return false;
        return true;
      })
    );
    // 绑定会话服务端已删，侧栏必须跟着摘，否则还挂着一条进不去的草稿。
    // ★ 上面已经按血缘本地摘干净了，这里只通知侧栏，不让自己整体重拉。
    notifySidebarOnly();
    setDeleteModal(null);
    setMenuFor(null);
  };

  const continueOnCard = async (gi: GalleryItem) => {
    if (!gi.appId || reopenBusy) return;
    setReopenBusy(true);
    const result = await reopenApp(gi.appId);
    setReopenBusy(false);
    if (!result?.sessionId) {
      setListError("无法从快照重建工作区，请稍后重试");
      return;
    }
    setPreviewModal(null);
    // ★ 下一行就跳进会话了，重拉画廊纯属白烧一轮请求。
    notifySidebarOnly();
    open(result.sessionId);
  };

  /**
   * 项目卡片的直达入口：已有归属会话时直接回到该会话，否则按应用快照
   * 重建一个工作区再进入。卡片主体仍保留只读预览，避免误把公开应用当成
   * 当前用户的可编辑会话。
   */
  const openProjectWorkspace = async (gi: GalleryItem) => {
    setMenuFor(null);
    const ownedSession =
      gi.sessionId && canOpenGalleryItem(gi, sessions, authUser)
        ? gi.sessionId
        : null;
    if (ownedSession) {
      open(ownedSession);
      return;
    }
    await continueOnCard(gi);
  };

  /**
   * 复刻（②，对标 Budibase duplicateApp / Appsmith fork / ToolJet clone）：
   * 以某个 App Store 应用为起点分出一条新血缘（新 root·v1·parent 指向源），
   * 成功后重拉画廊——新卡出现在列表里，用户可点开继续改。后端 fork_app 现成。
   */
  /** 点「复刻」→ 开改名弹框，预填「源名 副本」（不再一键复刻出同名孪生卡）。 */
  const openForkModal = (gi: GalleryItem) => {
    setMenuFor(null);
    if (gi.source !== "app" || !gi.appId) return;
    const baseName =
      details[gi.key]?.identity?.productName ||
      gi.summary?.product_name ||
      gi.goal ||
      "应用";
    setForkError(null);
    setForkModal({ item: gi, name: `${baseName} 副本` });
  };

  /** 确认复刻：带新名调 fork_app 分新血缘（后端同步创建绑定会话，副本
   * 点开即可运行）。失败不再静默——弹框保持打开并显示原因（2026-07-27）。 */
  const confirmFork = async () => {
    const fm = forkModal;
    if (!fm?.item.appId || forkBusy) return;
    setForkBusy(true);
    const result = await forkApp(fm.item.appId, fm.name);
    setForkBusy(false);
    if (!result) {
      setForkError("复刻失败：源应用不存在或服务暂不可用，请稍后重试");
      return;
    }
    setForkError(null);
    setForkModal(null);
    setTab("mine");
    setReloadKey(k => k + 1);
  };

  // 合并两条数据源为画廊条目；详情按条目 key 索引，app 卡在模型加载前用摘要占位。
  // 切货架会把 apps 置 null 重拉。sessions 往往还在——若用「两边都空才算
  // 加载中」，市场/官方会闪一帧空态，我的应用还会把会话草稿卡先铺上去。
  const items: GalleryItem[] | null =
    apps === null
      ? null
      : mergeGalleryItems(apps, tab === "mine" ? sessions ?? [] : []);
  const paired = (items ?? []).map(item => ({
    item,
    detail:
      details[item.key] ??
      (item.source === "app" && item.summary
        ? deriveDetailFromAppSummary(item.summary)
        : null),
  }));
  paired.sort((a, b) => {
    const ka = String(a.item.lastActive ?? a.item.createdAt ?? "");
    const kb = String(b.item.lastActive ?? b.item.createdAt ?? "");
    return sortDesc ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });
  const visibleRaw = filterCards(paired, filter, query);
  // 下一页并进来时全表重排会把新卡插进第一页——顶部已落位的卡换 key。
  // 只多不少就冻结已露出的序（masonry-append.appendStableItems）。
  const visible = appendStableItems(visibleOrderRef.current, visibleRaw, p => p.item.key);
  visibleOrderRef.current = visible.map(p => p.item.key);
  const counts = {
    all: paired.length,
    runnable: paired.filter(p => p.detail?.status === "runnable").length,
    blocked: paired.filter(p => p.detail && p.detail.blocked && p.detail.status !== "runnable").length,
    draft: paired.filter(p => p.detail && p.detail.status !== "runnable" && !p.detail.blocked).length,
  };
  // 示例库筛选：分类 chips + 共享搜索框（搜产品名/意图/分类）
  const q = query.trim().toLowerCase();
  const visibleExamples = examples.filter(e => {
    if (exampleCat !== "全部" && e.category !== exampleCat) return false;
    if (!q) return true;
    return (
      e.productName.toLowerCase().includes(q) ||
      e.intent.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  });
  // 「我的应用」滚动分页：墙吃已经拉到的全部卡（虚拟化自己裁视口），
  // 滚到底只向服务端要下一页。⚠ 别再加一层 shown+=12：shown 与 loaded
  // 对齐时 effect 会立刻再打一页，哨兵再喊一次，真机就是 12→24→35→48。
  // Pinterest gestalt Masonry 的 loadItems({ from }) 也是「缺哪页要哪页」，
  // 没有第二套窗口计数。示例库仍是网格 + 分页器。
  const totalItems = visibleExamples.length;
  const pagedExamples = visibleExamples.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const wallItems = visible;

  // ── 「我的应用」卡片墙（2026-07-31）──────────────────────────────────
  //
  // 走 **masonic**（jaredLunde，1406★）。为什么从 react-photo-album 换过来：
  //
  // 卡片改成「画面 + 图下信息区」之后，高度不再只由图片比例决定——信息区多高
  // 取决于标题会不会换行、几个计数标签。而 react-photo-album 的模型是
  // `height = columnWidth / ratio`（源码 masonry.ts），**结构上装不下图外文案**，
  // 只能把文案高度反算进假的宽高比里，脆且难维护。
  //
  // masonic 的定位器把高度当**输入**：
  //     set: (index, height) => { ...找最矮列...; items[index] = { left, top, height } }
  // 配 useResizeObserver 量真实 DOM 再回填（src/use-positioner.ts / use-resize-observer.ts）。
  // 图下文案多高都不用预先知道。
  //
  // 另外三个顺带的好处：
  //   · 列宽恒等 —— left = column * (columnWidth + gutter)，不像 photo-album 的
  //     columns 靠改列宽凑等高（实测三列差 27%，"排前面的看起来更大"是假暗示）
  //   · 直接渲染任意 React 子节点，不用再合成 src:"" 的假 Photo 绕开 <img>
  //   · 自带虚拟化（区间树 O(log n) 视口查询），应用数长起来不用重做
  //
  // 画面区高度仍按设备宽高比算——那部分是图，比例是真信息；信息区高度交给
  // 浏览器。两段相加就是卡片总高，masonic 自己量。
  //
  // 用低层 hook 拼装而不是开箱的 `<Masonry>`：后者的滚动源写死是 window，
  // 本应用滚的是 .native-content，详见 useScrollerIn.ts 顶部那段。

  // 卡片渲染抽成函数：定位器的 render 按 index 回调，拿不到 map 的闭包。
  // 只给 width——高度是**输出**不是输入，量完真实 DOM 再定位。
  const renderAppCard = (
    item: GalleryItem,
    detail: AppCardDetail | null,
    cellW: number,
    mediaH: number,
  ) => {
    // 格宽和**画面高**都由布局给（等宽瀑布流：列宽固定，画面高 = 列宽 ÷ 宽高比），
    // 卡片按给的尺寸铺满即可——不自己算。
    //
    // ⚠ 这里踩过两次，都是"卡片自己再算一遍"：
    //   · 8-23 换两端对齐行之前是 `wallCardHeight(cellW, device)`（等宽变高的
    //     瀑布流留下的），布局换了它没换，跟布局打架。
    //   · 第四个参数从"格高"变成"画面高"（8-23 下午信息行挪到图外）。名字不改
    //     成 mediaH 的话，下一个人照旧当格高用，画面会高出一条信息行——现象是
    //     卡片互相压盖，**不报错**。
    //   两次都不报错，所以名字必须自带含义。
    const compact = cellW < 200;
    const meta = detail?.runtimeKind === "project"
      ? { label: "工程", cls: "text-stone-500", dot: "bg-stone-400" }
      : detail ? STATUS_META[detail.status] : null;
    const BrandIcon = detail?.identity
      ? BRAND_LUCIDE[detail.identity.icon] ?? Boxes
      : undefined;
    // 能不能进会话：**有 id 不等于进得去**。会话按归属隔离，别人的会话
    // GET 回来是 404，跳过去就是白屏。进不去的走只读预览（见 previewModal）。
    //
    // 两类卡的判据不一样，别合并：
    //   session 卡 —— 来自 GET /sessions，服务端**已经按归属过滤过**
    //                （filter_sessions），列出来的就是你的，直接可进。
    //   app 卡     —— 来自 GET /apps，公开应用人人可见，绑定的会话却是
    //                作者的。必须按 owner 判。
    const canOpen = canOpenGalleryItem(item, sessions, authUser);
    // 能不能复刻/删除。无主的存量应用除超管外谁都不能删——判成"谁都能删"
    // 等于权限一上线就把历史数据敞开（与后端 app_access 同一套规则）。
    const canFork = capabilities.can.fork;
    const storeItem = storeRecordFor(item, boundApps[item.key]);
    // 归属判定跟着记录走。没记录（真草稿）时仍是 null——与改动前同义，
    // 「无主的存量应用除超管外谁都不能删」那条规则原样保留。
    const canWrite = canWriteApp(storeItem?.summary?.owner_id ?? null, authUser);
    const isApp = item.source === "app";
    const version = item.version ?? 1;
    const rel = formatRelativeTime(item.lastActive ?? item.createdAt);
    return (
      <div
        data-testid={`app-cell-${item.sessionId || item.appId}`}
        data-tier={(item.device || "desktop").trim() || "desktop"}
        data-compact={compact ? "1" : "0"}
        // 不写死高度：masonic 的 ResizeObserver 量的就是这个节点，写死等于
        // 把「高度由内容决定」这条又退回去了。宽度也不用给——masonic 的定位
        // 容器已经是 columnWidth，卡片 w-full 铺满即可。
      >
      <CenterCard
        mediaHeight={mediaH}
        compact={compact}
        testid={`app-card-${item.sessionId || item.appId}`}
        title={detail?.identity?.productName || item.goal || "（未命名话题）"}
        titleAttr={item.goal}
        Icon={BrandIcon}
        iconBg={detail?.identity ? themePrimary(detail.identity.theme) : undefined}
        media={(() => {
          // 封面只有两档：**有图就贴图，没图就空态**（2026-08-22）。
          //
          // 中间那一档（活渲染）删掉了，理由见上面 EmptyThumb 前那段——它每张卡
          // 挂一个真的应用运行时，同屏十几张就把主线程堵死，而 <img> 的解码在
          // 合成线程。贴图内部还分真截图/参照板两路，但那是服务端按可信度挑的
          // （PREVIEW_SOURCE_PRIORITY），同一个 URL、同一套画幅，这里只看"有没有"。
          //
          // 图拉不到（记录刚被删、网络抖）→ SheetThumb 的 onError 回落到同一张
          // 空态，不会出现空白卡。
          if (shouldUseSheetThumb(item)) {
            return (
              <SheetThumb
                appId={item.appId!}
                alt={detail?.identity?.productName || item.goal || "应用首页示意"}
                fallback={<EmptyThumb />}
                previewTag={item.previewTag}
              />
            );
          }
          // 会话卡（还没落库）说的是"还没生成完"，不是"这个应用没图"——
          // 把进度照实写进空态的描述里，别让两件事长成一个样。
          if (item.source === "session") {
            return (
              <EmptyThumb
                description={detail?.blocked ? "待补充信息" : "推演未闭环"}
              />
            );
          }
          return <EmptyThumb />;
        })()}
        metrics={
          detail ? (
            <>
              <span className="inline-flex items-center gap-1" title="页面数">
                <FileText size={11} className="opacity-60" />
                页面 {detail.pages}
              </span>
              {/* null = 数不出来（那份模型里没有 rbac / aigc 这一段）→ 不画这个
                  徽标。画个 "角色 0" 是在断言"这个应用没有角色"，那是编的。
                  0 本身是合法计数，照画。 */}
              {detail.roles !== null && (
                <span className="inline-flex items-center gap-1" title="角色数">
                  <Users size={11} className="opacity-60" />
                  角色 {detail.roles}
                </span>
              )}
              {detail.aiCaps !== null && (
                <span className="inline-flex items-center gap-1" title="AI 能力数">
                  <GitBranch size={11} className="opacity-60" />
                  AI {detail.aiCaps}
                </span>
              )}
              {isApp && version > 1 && (
                <span
                  // 信息条改成压在深色渐变上之后，浅底深字的徽标在这里反了；
                  // 改成半透明白底白字，跟旁边那排指标同一套明度关系。
                  className="inline-flex items-center rounded bg-white/20 px-1.5 text-[10px] font-semibold text-white"
                  title="改版次数（App Store 血缘）"
                >
                  v{version}
                </span>
              )}
              {rel && (
                <span
                  className="inline-flex items-center text-white/60"
                  title={formatUpdatedAt(item.lastActive ?? item.createdAt)}
                >
                  {rel}
                </span>
              )}
            </>
          ) : (
            <span className="opacity-70">加载中…</span>
          )
        }
        statusDot={meta?.dot ?? "bg-stone-300"}
        statusLabel={meta?.label ?? "…"}
        // 进不去会话不再是"点了没反应"——那和白屏一样让人以为坏了。
        //
        // ⚠ 2026-08-22：判据不能再写成 `detail?.model || detail?.specPages`。
        // 卡片详情改从摘要推之后这两样**永远是 null**，那条判据会把每一张
        // App Store 卡都判成"不响应"——闸全绿、点开没反应，正是本仓第三条
        // 说的那种静默失效。App Store 卡一律可预览（那儿只存闭环应用），
        // 整包在点开时才拉（ensureFullDetail）。会话卡仍按有没有东西可渲判。
        onClick={() => {
          if (canOpen) return open(item.sessionId!);
          if (isApp) {
            ensureFullDetail(item);
            return setPreviewModal(item);
          }
          if (detail?.runtimeKind === "project" || detail?.model || detail?.specPages) return setPreviewModal(item);
        }}
        topRight={
          <>
            <button
              data-testid={`app-menu-${item.sessionId || item.appId}`}
              className="absolute right-2 top-2 rounded bg-white/85 p-1 text-stone-400 opacity-0 shadow-sm transition hover:text-stone-600 group-hover:opacity-100"
              onClick={e => {
                e.stopPropagation();
                // 展开这一刻才去反查绑定应用（ensureBoundApp 自己幂等）。
                // ⚠ 别塞进 setMenuFor 的 updater 里：那个函数 StrictMode 下
                //   会被调两次，副作用要放在外面。
                const opening = menuFor !== item.key;
                setMenuFor(opening ? item.key : null);
                if (opening) ensureBoundApp(item);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuFor === item.key && (
              <div
                className="absolute right-2 top-8 z-10 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                onClick={e => e.stopPropagation()}
              >
                {/* 2026-08-02：按登录态与归属显隐。
                    ⚠️ 这只是**不显示注定失败的按钮**，不是权限判定——真正的判定
                    在后端每个写接口里（Python 侧 app_access.require）。审查那套
                    RBAC 后台时它的字段权限就是只藏了前端、后端照样全返回。*/}
                {/* ⚠ 这三条的门是 `storeItem`（有没有 App Store 记录），
                    **不是 `isApp`**（source 是不是 app）。理由见 storeItem
                    那段：闭环应用在自己的记录翻到之前是以 session 源摆出来的，
                    按 source 判会让它只剩「删除应用」。 */}
                {storeItem && (
                  <button
                    data-testid={`app-fork-${storeItem.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    disabled={!canFork}
                    title={canFork ? undefined : "登录后可复刻"}
                    onClick={() => openForkModal(storeItem)}
                  >
                    <GitBranch size={13} /> 复刻到我的应用
                  </button>
                )}
                {detail?.runtimeKind === "project" && (item.sessionId || item.appId) && (
                  <button
                    data-testid={`app-open-project-${item.sessionId || item.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-[#4a5aef] hover:bg-indigo-50 disabled:opacity-40"
                    disabled={reopenBusy}
                    title="打开工程工作台，查看沙盒、源码、版本、数据和验证"
                    onClick={() => void openProjectWorkspace(item)}
                  >
                    <Wrench size={13} />
                    {reopenBusy ? "正在打开工程工作台…" : "打开工程工作台"}
                  </button>
                )}
                {storeItem && canWrite && (
                  <button
                    data-testid={`app-visibility-${storeItem.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      const next =
                        storeItem.summary?.visibility === "private" ? "public" : "private";
                      void (async () => {
                        const res = await patchApp(storeItem.appId!, { visibility: next });
                        // ★ 就地改这一张，**不重拉整个画廊**（2026-08-22）。
                        //   原来这里是 setReloadKey，实测代价：卡片 104→0→120、
                        //   空白 6934ms、21 个请求（含 health / llm-channel）。
                        if (res) applyPatchedApp(item, storeItem.appId!, res);
                        setMenuFor(null);
                      })();
                    }}
                  >
                    {storeItem.summary?.visibility === "private" ? (
                      <><Globe size={13} /> 设为公开</>
                    ) : (
                      <><Lock size={13} /> 设为私有</>
                    )}
                  </button>
                )}
                {storeItem && authUser?.isSuperuser && (
                  <button
                    data-testid={`app-official-${storeItem.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      const next = !storeItem.summary?.is_official;
                      void (async () => {
                        const res = await patchApp(storeItem.appId!, { is_official: next });
                        // ★ 同「设为私有」：就地改，不重拉。
                        if (res) applyPatchedApp(item, storeItem.appId!, res);
                        setMenuFor(null);
                      })();
                    }}
                  >
                    <Sparkles size={13} />
                    {storeItem.summary?.is_official ? "从官方交还" : "移交到官方应用"}
                  </button>
                )}
                {canWrite && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50"
                    onClick={() => void removeCard(item)}
                  >
                    <Trash2 size={13} /> 删除应用
                  </button>
                )}
              </div>
            )}
          </>
        }
      />
      </div>
    );
  };



  const llmOk = llm === null ? null : llm !== false && llm.keyPresent;
  const overall: boolean | null =
    nodeOk === null || pyOk === null || llmOk === null
      ? null
      : Boolean(nodeOk && pyOk && llmOk);
  const dotCls = (ok: boolean | null) =>
    ok == null ? "bg-stone-300" : ok ? "bg-emerald-500" : "bg-red-500";

  return (
    <div
      data-testid="apps-workbench"
      className="min-h-full bg-[var(--sr-shell-bg,#f4f4f6)] px-6 py-5 md:px-8 md:py-6"
      onClick={() => {
        if (menuFor) setMenuFor(null);
        if (healthOpen) setHealthOpen(false);
      }}
    >
      {/*
        顶栏扁平化（对标参考稿）：无白底卡片/无阴影底板；
        第一行 标题 | 搜索 | 健康+创建；第二行 筛选 chip 直接铺在页面灰底上。
      */}
      {/*
        顶栏：标题 | 搜索 | 健康+创建。
        DOM 顺序与视觉/焦点顺序一致，不用 order-* 重排可聚焦控件。
      */}
      {/*
        吸顶（2026-07-31）：标题/搜索/tab/筛选整块钉在滚动容器顶部，只让卡片墙滚。
        19 个应用往下翻几行，筛选 chip 就滚没了——想换个筛选口径得先滚回顶部。

        实现要点：
        · 滚动容器是 .native-content（dashboard.css 里 overflow:auto），sticky
          就是相对它定位，不需要额外包一层。
        · 负 margin + 同值 padding 把根节点的 px/py 抵掉再补回来，让吸顶块的
          背景**铺满整宽**；否则卡片会从左右内边距那两条缝里透出来。
        · 背景必须显式给（跟根节点同一个 shell 变量），sticky 元素默认透明，
          卡片会直接从字底下穿过去。
        · z-30 高于卡片菜单(z-10)与健康浮层(z-20)：健康浮层本身在这块里面，
          跟着一起吸顶，不会被卡片盖住。
      */}
      <div className="sticky top-0 z-30 -mx-6 -mt-5 bg-[var(--sr-shell-bg,#f4f4f6)] px-6 pt-5 pb-4 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
            <LayoutGrid size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
            {tab === "market" ? "应用市场" : tab === "official" ? "官方应用" : "我的应用"}
          </h1>
        </div>

        <div className="relative w-full min-w-[200px] flex-1 sm:mx-4 sm:max-w-xl md:max-w-2xl">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            data-testid="apps-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={
              tab === "market"
                ? "搜索公开应用…"
                : tab === "official"
                  ? "搜索官方应用…"
                  : "搜索我的应用…"
            }
            className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {/* 服务状态：**正常时不显示**（2026-08-07，用户裁决"用户根本不关注
              这些，只会增加用户负担"）。
              没有整条删掉，是因为"负担"这个理由只成立于正常态——后端真挂了
              的时候，这一格是用户唯一能看到的解释，否则只能看到一连串莫名其妙
              的失败。所以：健康 → 隐藏，异常/检查中/静态演示 → 照常出现。 */}
          {(IS_GITHUB_PAGES || overall !== true) && (
          <span className="relative">
            <button
              type="button"
              data-testid="apps-health-chip"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-2 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200/60 transition hover:bg-white"
              onClick={e => {
                e.stopPropagation();
                setHealthOpen(v => !v);
              }}
            >
              <span
                className={`h-2 w-2 rounded-full ${IS_GITHUB_PAGES ? "bg-sky-400" : dotCls(overall)}`}
              />
              {IS_GITHUB_PAGES
                ? "静态演示 · 无后端"
                : overall == null
                  ? "服务检查中…"
                  : overall
                    ? "推演服务正常"
                    : "推演服务异常"}
            </button>
            {healthOpen && (
              <div
                data-testid="apps-health-popover"
                className="absolute right-0 top-11 z-20 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
                onClick={e => e.stopPropagation()}
              >
                <div className="space-y-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls(nodeOk)}`} />
                    <span className="text-slate-700">Node API</span>
                    <span className="ml-auto text-[11px] text-slate-400">/api/health</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls(pyOk)}`} />
                    <span className="text-slate-700">Python 推演引擎</span>
                    <span className="ml-auto text-[11px] text-slate-400">sliderule-python</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls(llmOk)}`} />
                    <span className="text-slate-700">LLM 推演通道</span>
                    <span className="ml-auto truncate text-[11px] text-slate-400">
                      {llm === null
                        ? "…"
                        : llm === false
                          ? "不可用"
                          : `${llm.provider} · ${llm.model}`}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </span>
          )}
          <button
            type="button"
            data-testid="apps-create-new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(91,108,255,0.28)] transition hover:bg-[#4a5aef] active:scale-[0.98]"
            onClick={openNewSession}
          >
            <span className="text-[15px] leading-none">+</span>
            创建新应用
          </button>
        </div>
      </div>

      {/* 第二行：库切换 + 门语言筛选 / 分类 — 无底板 */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "market" as const, label: "应用市场", count: tab === "market" ? paired.length : undefined },
            { key: "mine" as const, label: "我的应用", count: tab === "mine" ? paired.length : undefined },
            { key: "official" as const, label: "官方应用", count: tab === "official" ? paired.length : undefined },
          ]
        ).map(t => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            data-testid={`apps-tab-${t.key}`}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
              tab === t.key
                ? "bg-[#e8eeff] text-[#3b5bdb]"
                : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {typeof t.count === "number" && (
            <span
              className={`tabular-nums text-[11px] ${
                tab === t.key ? "text-[#3b5bdb]/80" : "text-slate-400"
              }`}
            >
              {t.count}
            </span>
            )}
          </button>
        ))}

        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />

        <StatChip
          icon={<LayoutGrid size={13} />}
          label="全部"
          count={counts.all}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <StatChip
          icon={<Hourglass size={13} className="text-amber-500" />}
          label="推演中"
          count={counts.draft}
          active={filter === "draft"}
          onClick={() => setFilter("draft")}
        />
        <StatChip
          icon={<CircleCheck size={13} className="text-emerald-500" />}
          label={STATUS_META.runnable.label}
          count={counts.runnable}
          active={filter === "runnable"}
          onClick={() => setFilter("runnable")}
        />
        <StatChip
          icon={<Hourglass size={13} className="text-orange-400" />}
          // 筛选条与卡片徽标读同一份 STATUS_META：此前两处各写一份字面量，
          // 改文案漏掉一处就会出现"筛选叫 blocked、卡片叫待补充"。
          label={STATUS_META.awaiting.label}
          count={counts.blocked}
          active={filter === "blocked"}
          onClick={() => setFilter("blocked")}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-500 transition hover:bg-white/60 hover:text-slate-700"
            onClick={() => setSortDesc(v => !v)}
          >
            <ArrowUpDown size={13} className="text-slate-400" />
            {sortDesc ? "最近更新" : "最早更新"}
          </button>
        </div>
      </div>
      </div>

      {/* ===== 三个货架共用卡片墙 ===== */}
      {listError ? (
          <div className="mt-8 text-[13px] text-red-500">会话列表拉取失败：{listError}</div>
        ) : items == null ? (
          <GalleryLoading testid="apps-skeleton" label="正在加载应用" />
        ) : visible.length === 0 && appsHasMore ? (
          <GalleryLoading testid="apps-skeleton-more" label="正在加载应用" />
        ) : visible.length === 0 ? (
          paired.length === 0 ? (
            // 首次空态（对标 ToolJet BlankPage）：插画 + 引导 + 创建 CTA
            <div className="mt-10 flex flex-col items-center text-center" data-testid="apps-empty-first">
              <EmptyGalleryArt />
              <div className="mt-4 text-[15px] font-semibold text-slate-800">
                {tab === "market" ? "还没有公开应用" : tab === "official" ? "还没有官方应用" : "还没有应用"}
              </div>
              <div className="mt-1 text-[13px] text-slate-500">
                {tab === "mine"
                  ? "描述你想要的系统，让 AI 推演出你的第一个应用"
                  : tab === "official"
                    ? "超管可以把应用移交给面团官方，出现在这里"
                    : "公开的应用会出现在这里，也可以从官方应用复刻一份到我的应用"}
              </div>
              <button
                data-testid="apps-empty-create"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(91,108,255,0.28)] transition hover:bg-[#4a5aef] active:scale-[0.98]"
                onClick={openNewSession}
              >
                <span className="text-[15px] leading-none">+</span> 创建新应用
              </button>
              {examples.length > 0 && (
                <div className="mt-8 w-full max-w-lg">
                  <div className="mb-2.5 text-[12px] text-slate-400">或从官方示例起手</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {examples.slice(0, 4).map(ex => {
                      const th = resolveIdentityTheme(ex.theme);
                      return (
                        <button
                          key={ex.domain}
                          data-testid={`empty-starter-${ex.domain}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-700 shadow-sm transition hover:border-[#5b6cff]/50 hover:shadow"
                          onClick={() => useTemplate(ex)}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: th.primary }}
                          />
                          {ex.productName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 搜不到（有应用，但当前搜索/筛选无匹配）
            <div className="mt-10 flex flex-col items-center text-center" data-testid="apps-empty-search">
              <EmptyGalleryArt />
              <div className="mt-4 text-[14px] font-medium text-slate-600">没有匹配的应用</div>
              <div className="mt-1 text-[12.5px] text-slate-400">换个关键词，或清空筛选看看</div>
              {(query || filter !== "all") && (
                <button
                  className="mt-3 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#5b6cff] transition hover:bg-[#eef2ff]"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  清空筛选
                </button>
              )}
            </div>
          )
        ) : (
          <AppWall
            // key 跟着筛选走：定位器的高度缓存按 index 存，换了数据集不重建的话
            // 会拿旧高度去摆新卡片。数量变化不进 key——那是滚动分页追加的正常情形，
            // 重建会把已量到的高度全丢掉，追加一批就整墙闪一次。
            key={`wall-${tab}-${filter}-${query}`}
            items={wallItems}
            renderCard={renderAppCard}
            onReachEnd={onWallReachEnd}
            ensureDetail={ensureDetail}
          />
        )}

      {/* 只读预览：点开别人的应用走这里，不进对方的会话（见 previewModal 的说明）。
          渲染器就是活渲染缩略图用的那一个，模型也是同一份，只是不再缩到卡片里。 */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
          data-testid="app-preview-modal"
          onClick={() => setPreviewModal(null)}
        >
          <div
            className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-2.5">
              <span className="truncate text-[14px] font-semibold text-slate-900">
                {details[previewModal.key]?.identity?.productName ||
                  previewModal.summary?.product_name ||
                  previewModal.goal ||
                  "应用预览"}
              </span>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                {details[previewModal.key]?.runtimeKind === "project" ? "工程预览" : "只读预览"}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {details[previewModal.key]?.runtimeKind === "project" ? null : canWriteApp(previewModal.summary?.owner_id ?? null, authUser) &&
                previewModal.source === "app" ? (
                  <button
                    data-testid="app-reopen"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-40"
                    disabled={reopenBusy || !previewModal.appId}
                    onClick={() => void continueOnCard(previewModal)}
                  >
                    <Wrench size={13} /> {reopenBusy ? "正在重建工作区…" : "在新会话继续改"}
                  </button>
                ) : (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-40"
                    disabled={!capabilities.can.fork || previewModal.source !== "app"}
                    title={capabilities.can.fork ? undefined : "登录后可复刻"}
                    onClick={() => {
                      const gi = previewModal;
                      setPreviewModal(null);
                      openForkModal(gi);
                    }}
                  >
                    <GitBranch size={13} /> 复刻到我的
                  </button>
                )}
                <button
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 transition hover:bg-slate-100"
                  onClick={() => setPreviewModal(null)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-[#f0f2f5]">
              <AppArtifactPreview
                detail={details[previewModal.key]}
                loading={fullInflightKeys.includes(previewModal.key)}
                previewKey={previewModal.appId || previewModal.key}
                appTitle={previewModal.goal}
              />
            </div>
          </div>
        </div>
      )}

      {/* 删应用比删会话重：对照 GitHub 删仓库要确认。绑定工作区会一起没。 */}
      {deleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="delete-app-modal"
          onClick={() => setDeleteModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <Trash2 size={16} className="text-red-500" /> 删除应用
            </div>
            <div className="mt-2 text-[12.5px] leading-5 text-slate-600">
              「{details[deleteModal.key]?.identity?.productName ||
                deleteModal.summary?.product_name ||
                deleteModal.goal ||
                "这张应用"}」会从货架下架，绑定的推演会话也会一并删除，不可恢复。
            </div>
            {deleteError ? (
              <div className="mt-2 text-[12.5px] leading-5 text-red-600" data-testid="delete-app-error">
                {deleteError}
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-slate-500 transition hover:bg-slate-100"
                onClick={() => setDeleteModal(null)}
              >
                取消
              </button>
              <button
                data-testid="delete-app-confirm"
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-red-700"
                onClick={() => void confirmDeleteApp()}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 复刻改名弹框（对标 Budibase duplicateApp）：预填「源名 副本」，改名后确认。
          fork 分新血缘、不继承源会话——点开副本不会误进源应用的会话。 */}
      {forkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="fork-modal"
          onClick={() => !forkBusy && setForkModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <GitBranch size={16} className="text-[#5b6cff]" /> 复刻应用
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              复制一份为新应用（记着从谁复刻而来），给它起个名：
            </div>
            <input
              autoFocus
              data-testid="fork-name-input"
              value={forkModal.name}
              disabled={forkBusy}
              onChange={e => setForkModal(m => (m ? { ...m, name: e.target.value } : m))}
              onKeyDown={e => {
                if (e.key === "Enter") void confirmFork();
                if (e.key === "Escape") setForkModal(null);
              }}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 outline-none transition focus:border-[#5b6cff] focus:ring-2 focus:ring-[#5b6cff]/20"
              placeholder="副本名称"
            />
            {forkError && (
              <div
                data-testid="fork-error"
                className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600"
              >
                {forkError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-slate-500 transition hover:bg-slate-100"
                disabled={forkBusy}
                onClick={() => setForkModal(null)}
              >
                取消
              </button>
              <button
                data-testid="fork-confirm"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-60"
                disabled={forkBusy || !forkModal.name.trim()}
                onClick={() => void confirmFork()}
              >
                {forkBusy ? "复刻中…" : "复刻"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
