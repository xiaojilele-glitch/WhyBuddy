/**
 * Thin delegation helper for calling the Python SlideRule V5 backend
 * (slide-rule-python).
 *
 * Dev startup boundary (this task): `npm run dev` (Vite) + slide-rule-python uvicorn:9700
 * is the clear default for Vite + Python API mode. Node backend (`npm run dev:server`, port 3001)
 * is explicit compatibility only (thin proxy shell; start only when sockets/legacy needed or
 * SLIDERULE_V5_BACKEND=legacy non-prod). Under default, delegation proves no Node ownership.
 *
 * Runtime boundary:
 * - PYTHON_SLIDE_RULE_BASE_URL controls the target service, default localhost:9700.
 * - PYTHON_SLIDE_RULE_INTERNAL_KEY is sent only on internal POST delegation calls.
 * - PYTHON_SLIDE_RULE_TIMEOUT_MS bounds Node -> Python calls.
 * - Proxy behavior is left to Node fetch env support (HTTP_PROXY/HTTPS_PROXY,
 *   NODE_USE_ENV_PROXY, NO_PROXY); this helper does not install a dispatcher.
 *
 * Used by server/routes/sliderule.ts for V5 capabilities when
 * SLIDERULE_V5_BACKEND=python (default).
 */

export interface PythonSlideRuleRuntimeConfig {
  baseUrl: string;
  internalKey: string;
  timeoutMs: number;
  healthPath: string;
  proxyMode: "node-fetch-env";
}

export interface PythonSlideRuleHealthResult {
  ok: boolean;
  url: string;
  status?: number;
  backend?: string;
  error?: string;
}

export interface PythonSlideRuleCallOptions {
  timeoutMs?: number;
  /** 访问者身份头，见 viewerHeadersFrom。不传 = 这次调用对 Python 是匿名的。 */
  viewer?: ViewerHeaders;
}

/** 只有这两个头代表"请求是谁发的"。 */
export type ViewerHeaders = { cookie?: string; authorization?: string };

/**
 * 从入站请求里摘出访问者身份头，转发给 Python。
 *
 * ## 为什么必须显式转发
 *
 * `X-Internal-Key` 回答的是"Node 有没有权调 Python"，**不是**"这个请求是谁发的"。
 * 两者混淆过一次：2026-08-02 之前 /api/sliderule/* 的兜底代理只带内部密钥，
 * Python 侧 optional_user 永远拿不到用户，应用中心的归属判定整体退化成匿名。
 * 那次在兜底代理里补了转发，但 **sessions 那几条显式路由用的是
 * delegateToPythonSlideRule，没跟着改**——于是留下一个很别扭的不对称：
 *
 *     POST /sessions      没有显式路由 → 落到兜底代理 → 带 cookie → 建出来有主
 *     GET  /sessions      有显式路由   → 走本文件   → 不带    → 匿名 → 空列表
 *
 * 表现就是"登录后新建会话、跑完推演，左侧历史里一条都没有"（2026-08-06 用户实测）。
 * 会话确实建出来了、归属也对，只是列表请求到 Python 时是个陌生人。
 * GET /sessions/{id} 同理 → 打开别人可见的应用是空白页。
 *
 * ## 为什么是白名单而不是整包透传
 *
 * `host` / `content-length` 这些得由 fetch 自己按新请求算，原样带过去会让上游
 * 拿到错的值。这跟兜底代理里那段注释是同一条纪律，**这里是它唯一的实现**，
 * 两处共用，避免再漂移一次。
 */
export function viewerHeadersFrom(req: {
  headers: Record<string, unknown>;
}): ViewerHeaders {
  const out: ViewerHeaders = {};
  const cookie = req?.headers?.["cookie"];
  if (typeof cookie === "string" && cookie) out.cookie = cookie;
  const auth = req?.headers?.["authorization"];
  if (typeof auth === "string" && auth) out.authorization = auth;
  return out;
}

function withViewer(
  headers: Record<string, string>,
  viewer: ViewerHeaders | undefined,
): Record<string, string> {
  if (viewer?.cookie) headers["cookie"] = viewer.cookie;
  if (viewer?.authorization) headers["authorization"] = viewer.authorization;
  return headers;
}

const DEFAULT_BASE_URL = "http://localhost:9700";
const DEFAULT_INTERNAL_KEY = "dev-slide-rule-internal";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * 推演（drive-full）专用超时。**不能用上面那个 120s 的通用值。**
 *
 * 一趟推演实测 374~1190s（见 routes/sliderule_full.py 里 drive_full 那条注释），
 * 而通用超时是 2 分钟——非流式那条路一旦被走到，必然在第 2 分钟 AbortController
 * 掐断、返回 502，而 Python 侧那趟推演**还在跑**（drive_full 是 `def` 路由，
 * 跑在线程池里，客户端断开不会取消它）。表现是"用户看到失败，但后台照样在烧
 * LLM 额度，最后还成功落库了"——用户多半会再点一次，于是同一个话题生成两遍。
 *
 * 为什么不把 DEFAULT_TIMEOUT_MS 整体调大：那个值同时管着健康检查、llm-channel
 * 这些秒级调用，调大等于后端真挂了也要吊 20 分钟才报错。慢的是推演这一条，
 * 就只放宽这一条。
 *
 * 40 分钟 = 实测最慢 1190s 的两倍余量（1190s 是 5 并发下量到的；单跑更快，
 * 但并发正是展会现场的常态）。要调用 PYTHON_SLIDE_RULE_DRIVE_TIMEOUT_MS。
 *
 * 连接挂 40 分钟听着久，但两边的代价不对称：挂着只占 Node 一个 socket，
 * 而掐早了是"整趟白烧 + 用户重试再烧一遍"。宁可挂着。
 *
 * ⚠️ 前端正常走的是 SSE（drive-full-stream，兜底代理裸 fetch 不设超时，不受此限），
 * 这条非流式路是 SSE 失败后的回退。回退路径出问题最难发现——正因为平时不走。
 */
const DEFAULT_DRIVE_TIMEOUT_MS = 2_400_000;
const DEFAULT_HEALTH_PATH = "/health";

/** 推演专用超时，允许用 PYTHON_SLIDE_RULE_DRIVE_TIMEOUT_MS 覆盖。 */
export function resolvePythonDriveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.PYTHON_SLIDE_RULE_DRIVE_TIMEOUT_MS, DEFAULT_DRIVE_TIMEOUT_MS);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  );
}

export function resolvePythonSlideRuleRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): PythonSlideRuleRuntimeConfig {
  const rawBaseUrl = (env.PYTHON_SLIDE_RULE_BASE_URL || DEFAULT_BASE_URL).trim();
  return {
    baseUrl: trimTrailingSlashes(rawBaseUrl || DEFAULT_BASE_URL),
    internalKey: env.PYTHON_SLIDE_RULE_INTERNAL_KEY || DEFAULT_INTERNAL_KEY,
    timeoutMs: parsePositiveInt(env.PYTHON_SLIDE_RULE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    healthPath: DEFAULT_HEALTH_PATH,
    proxyMode: "node-fetch-env",
  };
}

/**
 * 携带上游 HTTP 状态码的委托错误（发布门修复 G1，2026-07-15）。
 * 此前所有非 2xx 都压成普通 Error → 路由统一 502，丢失了前端
 * session store 依赖的「404 => undefined」契约（sliderule-http-store.ts
 * load() 对 404 返回 undefined，对 502 抛错）。路由层据 status 分流。
 */
export class PythonSlideRuleHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  constructor(message: string, status: number, bodyText: string) {
    super(message);
    this.name = "PythonSlideRuleHttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  errorPrefix: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new PythonSlideRuleHttpError(
        `${errorPrefix} failed: http ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`,
        response.status,
        detail.slice(0, 500),
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`${errorPrefix} invalid json: ${errorMessage(error)}`);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${errorPrefix} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callPythonSlideRule(
  pythonBase: string,
  endpoint: string,
  payload: any,
  internalKey: string,
  options: PythonSlideRuleCallOptions = {},
) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const timeoutMs = options.timeoutMs ?? resolvePythonSlideRuleRuntimeConfig().timeoutMs;
  return await fetchJsonWithTimeout(
    `${trimTrailingSlashes(pythonBase)}${normalizedEndpoint}`,
    {
      method: "POST",
      headers: withViewer(
        {
          "Content-Type": "application/json",
          "X-Internal-Key": internalKey,
        },
        options.viewer,
      ),
      body: JSON.stringify(payload),
    },
    timeoutMs,
    `python ${normalizedEndpoint}`,
  );
}

/**
 * Thin delegation for any HTTP method to Python backend (for Node route retirement to thin proxy).
 * Used for GET /sessions, GET /sessions/:id, PUT /sessions/:id, DELETE to prove no Node business ownership.
 */
export async function delegateToPythonSlideRule(
  pythonBase: string,
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  payload: any,
  internalKey: string,
  options: PythonSlideRuleCallOptions = {},
) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const timeoutMs = options.timeoutMs ?? resolvePythonSlideRuleRuntimeConfig().timeoutMs;
  const init: RequestInit = {
    method,
    headers: withViewer(
      {
        "Content-Type": "application/json",
        "X-Internal-Key": internalKey,
      },
      options.viewer,
    ),
  };
  if (method !== "GET" && method !== "DELETE") {
    init.body = JSON.stringify(payload ?? {});
  }
  return await fetchJsonWithTimeout(
    `${trimTrailingSlashes(pythonBase)}${normalizedEndpoint}`,
    init,
    timeoutMs,
    `python ${method} ${normalizedEndpoint}`,
  );
}

export async function callPythonSlideRuleGet(
  pythonBase: string,
  endpoint: string,
  internalKey: string,
  options: PythonSlideRuleCallOptions = {},
) {
  return delegateToPythonSlideRule(pythonBase, endpoint, "GET", null, internalKey, options);
}

export async function checkPythonSlideRuleHealth(
  config: PythonSlideRuleRuntimeConfig = resolvePythonSlideRuleRuntimeConfig(),
): Promise<PythonSlideRuleHealthResult> {
  const url = `${config.baseUrl}${config.healthPath}`;
  try {
    const payload = await fetchJsonWithTimeout(
      url,
      { method: "GET" },
      config.timeoutMs,
      "python health",
    );
    const body = payload as Record<string, unknown>;
    return {
      ok: body?.status === "ok",
      url,
      status: body?.status === "ok" ? 200 : undefined,
      backend: typeof body?.backend === "string" ? body.backend : undefined,
      error: body?.status === "ok" ? undefined : "python health returned non-ok status",
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: errorMessage(error),
    };
  }
}
