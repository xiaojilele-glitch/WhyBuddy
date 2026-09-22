/**
 * App Store 前端客户端（2026-07-25）——「生成应用」持久层（services/app_store.py）
 * 的前端取数入口。应用中心画廊从这里读「已闭环 · 有血缘 · 可复刻」的真数据。
 *
 * 设计对标 ToolJet 的 `frontend/src/_services/apps.service.js`（审计过的成熟实现）：
 *   getAll(page, folder, search, type)  →  listApps({limit, offset})    列表要「摘要」
 *   getApp(id)                          →  getApp(id)                    详情才拉「完整模型」
 *   getVersions(id)                     →  listVersions(rootId)          改版历史
 *   clone(id)  → POST /apps/{id}/clone  →  forkApp(id)                   复刻（新血缘）
 * ——即「列表只拉轻量摘要、完整定义按需再取」的两级取数。我们的差异化在于卡片封面
 * 用真实活渲染（AppRuntimeScreen），所以完整模型仍按卡懒拉，但列表本身保持轻。
 *
 * 全部走 Node 薄代理 `/api/sliderule/*`（server/routes/sliderule.ts 尾部 catch-all
 * 透传到 Python 并补 X-Internal-Key），前端不碰内部密钥。静态演示（GitHub Pages）
 * 无后端，调用方需自行短路，不要打这些接口。
 */

/** 列表摘要——对应 Python `_summary`（去掉 model_json 大载荷）。 */
export interface AppStoreSummary {
  id: string;
  root_id: string;
  parent_id: string | null;
  version: number;
  session_id: string | null;
  goal: string;
  gate_passed: boolean;
  created_at: string;
  product_name: string;
  theme_id: string;
  theme_label: string;
  device: string;
  landing_page_ref: string;
  entity_count: number;
  page_count: number;
  /**
   * 角色数 / AI 能力数（2026-08-22）。卡片指标行要显示它们，此前只能对每张卡
   * 再打一次 `GET /apps/{id}` 把整包 model_json + pages_json 拉下来数——首屏
   * 30 张卡就是 30 次请求、1.9 MB，全为了两个数字。
   *
   * **可能是 null，且 null ≠ 0**：null 是「这份模型里没有 rbac / aigc 这一段，
   * 数不出来」，0 是「确实一个角色都没有」。两者在卡片上必须长得不一样——
   * 数不出来就不画这个徽标，画个 0 是在编（后端同一条纪律见 app_store 的
   * _count_or_none）。可选：老后端不返回这两个字段，缺失同样按「不知道」处理。
   */
  role_count?: number | null;
  ai_count?: number | null;
  /**
   * 归属与可见性（2026-08-02）。
   *
   * owner_id 为 null = 无主的存量应用。语义与后端一致（app_access）：
   * **可读、不可写**（超管除外）——判成可写等于权限一上线就把历史数据敞开。
   *
   * 两者都可选：老后端不返回这两个字段，缺失时按"无主 + public"处理，
   * 也就是改动前的行为。
   */
  owner_id?: string | null;
  visibility?: "public" | "unlisted" | "private";
  /** 官方货架。缺省按 false——老后端没这个字段。 */
  is_official?: boolean;
  /**
   * 这条记录有没有缩略图。有就贴图，没有就回落活渲染。
   *
   * 图有两个可能的来源，**服务端按可信度挑**（见 Python 侧 app_store 的
   * PREVIEW_SOURCE_PRIORITY）：真实渲染的截图 > 生成时那张首页参照板。
   * 这个布尔只回答"有没有"，不区分是哪一路——前端也不需要区分，两者画幅一致、
   * 走同一个接口。
   *
   * 图本身不在摘要里——一张约 1MB 的 PNG，列 200 个应用光缩略图就是 200MB。
   * 真正取图走 GET /api/sliderule/apps/{id}/preview（immutable 强缓存）。
   *
   * 可选：老的 Python 后端不返回这个字段，缺失按 false 处理 = 活渲染，
   * 即改动前的行为。
   */
  has_preview?: boolean;
  /**
   * 当前用的是哪一路图："shot"（真截图）/ "sheet"（参照板）/ ""（没图）。
   *
   * 除了观测（"这张卡到底贴的什么"在列表接口上直接可见），它还有一个实际作用：
   * 活渲染的卡据此决定要不要就地采一张真截图（见 lib/thumb-capture.ts）——
   * 已经是 "shot" 的不再采。
   */
  preview_source?: string;
  /**
   * 缩略图的缓存版本位，拼进 URL 的 `?v=`（见 AppsWorkbench.appPreviewUrl）。
   *
   * 形如 `"shot.1754140000123456"`——来源 + 写入时刻。**必须带上**：缩略图响应
   * 是 immutable 强缓存的，而同一个 app_id 的图会变（真截图是事后采集回传的），
   * URL 不跟着变，浏览器就永远停在升级前那张。
   */
  preview_tag?: string;
  /**
   * 这条记录有没有 spec-first 整页 HTML（2026-08-14）。有的话卡片缩略图和
   * 只读预览走 HTML 活渲染（同推演舞台的 SpecPageLiveStage 一路），没有才
   * 回落老的区块渲染（AppRuntimeScreen）。
   *
   * 页面本体不在摘要里（一套约 100KB+），在完整记录的 pages_json 里按卡懒拉
   * ——跟 model_json 同一套两级取数纪律。可选：老后端不返回，缺失按 false
   * 处理 = 区块渲染，即改动前的行为。
   */
  has_pages?: boolean;
}

/**
 * spec-first 整页 HTML 载荷——形状与会话侧 state.specFirstPages 同源
 * （Python spec_first_pipeline 落库时的暂存形状）。
 */
export interface SpecPagesPayload {
  version?: string;
  /** pageId → 完整 HTML 文档（带 data-* 绑定孔） */
  pages: Record<string, string>;
  navItems?: Array<{ pageId?: string; label?: string }>;
  /** 打过孔（6.5 步绑定成功）的页数；0 = 素颜页 */
  boundPages?: number;
  /** 每页打孔相位；有则优先于 boundPages 反推 */
  pageBindStatus?: Record<string, string>;
}

/** 完整记录——摘要 + model_json（可直接重开渲染）+ pages_json（整页 HTML）。 */
export interface AppStoreRecord extends AppStoreSummary {
  model_json: unknown;
  /** spec-first 整页 HTML；null/缺失 = 这一版没有页面（老链路产出）。 */
  pages_json?: unknown;
}

const BASE = "/api/sliderule";

/**
 * 缩略图地址。`?v=` 是缓存版本位（摘要 preview_tag）。
 * 响应 immutable 强缓存，图变了 URL 必须跟着变。
 */
export function appPreviewUrl(appId: string, tag?: string | null): string {
  const base = `${BASE}/apps/${encodeURIComponent(appId)}/preview`;
  return tag ? `${base}?v=${encodeURIComponent(tag)}` : base;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export type AppShelf = "market" | "mine" | "official";

/**
 * 应用画廊列表——默认每个应用只出最新版，摘要不含大模型载荷。
 * 对标 ToolJet getAll：翻页/条数是服务端参数，不在前端全量切片。
 *
 * `scope` 是货架：market / mine / official。不传则走旧列表（侧栏缩略图）。
 */
export async function listApps(
  opts: { limit?: number; offset?: number; scope?: AppShelf } = {}
): Promise<AppStoreSummary[]> {
  // 默认一页 12 张（跟应用中心 PAGE_SIZE 对齐）。⚠ 2026-08-18 以前默认 200，
  // 首页 `listApps()` 不传参就把全表摘要一次拉回——滚动分页形同虚设。
  const limit = opts.limit ?? 12;
  const offset = opts.offset ?? 0;
  const scope = opts.scope ? `&scope=${encodeURIComponent(opts.scope)}` : "";
  const data = await getJson<{ apps?: AppStoreSummary[] }>(
    `${BASE}/apps?limit=${limit}&offset=${offset}${scope}`
  );
  return Array.isArray(data?.apps) ? data.apps : [];
}

/**
 * 取一个生成应用的完整记录（含 model_json）——卡片进入视口时才拉，
 * 用于活渲染缩略图 / 点开重渲。404 或网络失败返回 null（调用方走占位）。
 */
export async function getApp(id: string): Promise<AppStoreRecord | null> {
  try {
    return await getJson<AppStoreRecord>(`${BASE}/apps/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/**
 * 这个会话最新落库的那条应用摘要。推演收口靠它拿到 app_id 去回传截图。
 * 404 / 网络失败返回 null——截图是增强项，没有 id 就这次不采。
 */
export async function getGeneratedAppForSession(
  sessionId: string
): Promise<AppStoreSummary | null> {
  const id = sessionId.trim();
  if (!id) return null;
  try {
    return await getJson<AppStoreSummary>(
      `${BASE}/sessions/${encodeURIComponent(id)}/generated-app`
    );
  } catch {
    return null;
  }
}

/** 一个应用的改版历史（同 root 的所有版本，按 version 升序，摘要）。 */
export async function listVersions(rootId: string): Promise<AppStoreSummary[]> {
  try {
    const data = await getJson<{ versions?: AppStoreSummary[] }>(
      `${BASE}/apps/${encodeURIComponent(rootId)}/versions`
    );
    return Array.isArray(data?.versions) ? data.versions : [];
  } catch {
    return [];
  }
}

/**
 * 以某个生成应用为起点分出一条新血缘（新 root · v1 · parent 指向源）。
 * 对标 ToolJet clone / Budibase duplicateApp：传 name 给副本改名（避免同名孪生卡）。
 * 成功返回新 app id，失败返回 null。
 */
export interface ForkResult {
  id: string;
  /** 2026-07-27：后端 fork 时同步创建的绑定会话——副本点开即可运行/继续迭代 */
  sessionId?: string;
}

export async function forkApp(id: string, name?: string): Promise<ForkResult | null> {
  try {
    const res = await fetch(`${BASE}/apps/${encodeURIComponent(id)}/fork`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(name && name.trim() ? { name: name.trim() } : {}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; sessionId?: string };
    if (typeof data?.id !== "string") return null;
    return { id: data.id, sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined };
  } catch {
    return null;
  }
}

/**
 * 同一张卡上重建工作区（对照 GitHub create codespace）。不是 fork。
 * 会话还在就复用；没了才从快照灌一条新会话。
 */
export async function reopenApp(
  id: string
): Promise<{ id: string; sessionId: string; reused: boolean } | null> {
  try {
    const res = await fetch(`${BASE}/apps/${encodeURIComponent(id)}/reopen`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; sessionId?: string; reused?: boolean };
    if (typeof data?.id !== "string" || typeof data?.sessionId !== "string") return null;
    return { id: data.id, sessionId: data.sessionId, reused: Boolean(data.reused) };
  } catch {
    return null;
  }
}

/**
 * 从画廊移除一个应用记录。绑定的推演会话由服务端一并删（对照 GitHub
 * 删仓库会清 Codespace）。失败/网络异常返回 false，调用方保持原样。
 */
export async function deleteApp(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/apps/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 点选编辑器存一页 HTML（2026-08-24）——对应后端 `PATCH /apps/{id}/pages/{pageId}`
 * （services/app_store.update_page_html）：原地覆盖那一页，不开新版本、不碰模型。
 *
 * 跟 `patchApp` 不同，这里失败要把后端的话原样带回去给用户看（"页面超过 1MB
 * 上限" / "这个应用没有可编辑的页面产物"），不能只回一个 null——点选编辑器
 * 本来就是给非技术用户用的手动动作，静默失败等于东西丢了都不知道。
 *
 * ⚠ 2026-09-05：`warn` 是**保存成功但顺手带走了东西**（后端 page_edit_guard
 *   数出来的：页面脚本 / 数据孔 / 表单控件变少了）。它跟 `error` 是两回事——
 *   东西存进去了，但交付物少了一块。第一版接口把这个字段丢在地上没人读，
 *   于是"存完游戏变成一张死图"在屏幕上仍然长得像成功。三个调用点
 *   （点选编辑保存 / 画布元素编辑 / 画布换图）都得把它显出来。
 */
export async function updateAppPage(
  id: string,
  pageId: string,
  html: string
): Promise<
  { ok: true; bytes: number; warn: string } | { ok: false; error: string }
> {
  try {
    const res = await fetch(
      `${BASE}/apps/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`,
      {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ html }),
      }
    );
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) {
      const msg =
        (typeof body?.message === "string" && body.message) ||
        (typeof body?.detail === "string" && body.detail) ||
        `保存失败（HTTP ${res.status}）`;
      return { ok: false, error: msg };
    }
    const bytes = typeof body?.bytes === "number" ? body.bytes : html.length;
    // 措辞由后端 losses_message 一处说了算，前端不另拼一句（§4）。
    const warn = typeof body?.lossesMessage === "string" ? body.lossesMessage : "";
    return { ok: true, bytes, warn };
  } catch {
    return { ok: false, error: "网络请求失败，请检查连接后重试" };
  }
}

/**
 * 点选编辑器的"✨ AI 编辑"——把选中元素的 HTML + 一句改法丢给后端 LLM，
 * 换一份改过的 HTML 回来。**不落库**（对应后端 `POST /apps/{id}/pages/
 * {pageId}/ai-edit-element`，本身没有副作用），调用方拿到手之后要跟其它
 * 点选编辑动作一样走"保存修改"才真正写进 pages_json。
 *
 * ⚠ 返回的 `html` 是 LLM 原始输出，**没有消毒**——调用方必须先过一遍
 * `sanitizeHtmlFragment`（html-app-surface）再塞进 DOM，这里不做是因为
 * 消毒的白名单/DOMPurify 实例只在浏览器端这一份，不在这个纯网络层文件里
 * 重复引入。
 */
export async function aiEditElement(
  appId: string,
  pageId: string,
  elementHtml: string,
  instruction: string
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${BASE}/apps/${encodeURIComponent(appId)}/pages/${encodeURIComponent(pageId)}/ai-edit-element`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ elementHtml, instruction }),
      }
    );
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) {
      const msg =
        (typeof body?.message === "string" && body.message) ||
        (typeof body?.detail === "string" && body.detail) ||
        `AI 编辑失败（HTTP ${res.status}）`;
      return { ok: false, error: msg };
    }
    const html = typeof body?.html === "string" ? body.html : "";
    if (!html.trim()) return { ok: false, error: "AI 没有返回内容，换个说法再试试" };
    return { ok: true, html };
  } catch {
    return { ok: false, error: "网络请求失败，请检查连接后重试" };
  }
}

/** 改可见性 / 官方标记。失败返回 null。 */
export async function patchApp(
  id: string,
  body: { visibility?: "public" | "unlisted" | "private"; is_official?: boolean }
): Promise<{ visibility?: string; is_official?: boolean } | null> {
  try {
    const res = await fetch(`${BASE}/apps/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as { visibility?: string; is_official?: boolean };
  } catch {
    return null;
  }
}

/**
 * 刀 3 的「重写这一块」——把**整页 HTML + 块名 + 一句改法**丢给后端，
 * 后端切出那一块交给 LLM，过三道闸之后原样拼回，回一份新的整页。
 *
 * 跟 `aiEditElement` 是一对：那条改"选中的一个元素"，这条改"画布上摊开的
 * 那一块"。粒度不同，**边界完全一样**——不落库，用户点"保存修改"才写进
 * pages_json。
 *
 * ⚠ 整页由调用方传上去（不是后端从库里读）：连改两块时，第二次要带着第一次
 *   的改动。后端自己读库的话，第一块的改动会被悄悄丢掉——不报错，只是白改。
 *
 * ⚠ 回来的 `html` 是拼接结果，里面含 LLM 原始输出，**没有消毒**。塞进 DOM
 *   之前必须过 `sanitizeHtmlFragment`（同 aiEditElement 那条）。
 */
export async function aiEditBlock(
  appId: string,
  pageId: string,
  pageHtml: string,
  blockName: string,
  instruction: string
): Promise<
  | { ok: true; html: string; blockHtml: string }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(
      `${BASE}/apps/${encodeURIComponent(appId)}/pages/${encodeURIComponent(pageId)}/ai-edit-block`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ pageHtml, blockName, instruction }),
      }
    );
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) {
      /* ⚠ 422 是**闸打回**（AI 改出来的东西会劫走块边界/标签不平衡），
         不是网络错。原样把后端那句话给用户看——它说得比"改块失败"具体，
         而这一步 fail-closed 的意义就在于让人看见为什么被拦。 */
      const msg =
        (typeof body?.message === "string" && body.message) ||
        (typeof body?.detail === "string" && body.detail) ||
        `改块失败（HTTP ${res.status}）`;
      return { ok: false, error: msg };
    }
    const html = typeof body?.html === "string" ? body.html : "";
    const blockHtml = typeof body?.blockHtml === "string" ? body.blockHtml : "";
    if (!html.trim()) return { ok: false, error: "AI 没有返回内容，换个说法再试试" };
    return { ok: true, html, blockHtml };
  } catch {
    return { ok: false, error: "网络请求失败，请检查连接后重试" };
  }
}

