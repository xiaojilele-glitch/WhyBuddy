/**
 * 账号：注册 / 登录 / 当前身份（2026-08-02）。
 *
 * ## 产品语义
 *
 *   没登录  → 只能看：浏览应用中心、打开应用
 *   登录后  → 能 Fork、能推演、能改自己的东西
 *   超管    → 能管别人的
 *
 * ## 凭据放哪
 *
 * **httpOnly Cookie，不是 localStorage。** 服务端在登录响应里种 Cookie
 * （routes/account.py），浏览器自动带上。localStorage 存 JWT 是很常见的做法，
 * 但那样一次 XSS 就等于永久盗号——JS 读得到的东西，注入的脚本也读得到。
 *
 * 所以这里**没有** setToken/getToken 这类函数：token 前端根本碰不到，
 * 也不需要碰。同源 fetch 默认就带 Cookie（credentials: "same-origin"）。
 *
 * ## 一条纪律
 *
 * 这一层返回的 `capabilities` 只用来决定**显示哪些按钮**，不是权限判定。
 * 真正的判定在每个写接口里（Python 侧 app_access.require）。
 * 前端藏起来的按钮不等于后端拦得住——审查那套 RBAC 后台时，它的字段权限
 * 就是只藏了前端、后端照样把该隐藏的字段全返回了。
 */

const BASE = "/api/sliderule";

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  isSuperuser: boolean;
  isVerified: boolean;
  createdAt?: string | null;
}

export interface Capabilities {
  loggedIn: boolean;
  isSuperuser: boolean;
  can: {
    browse: boolean;
    viewApp: boolean;
    fork: boolean;
    drive: boolean;
    manageOwn: boolean;
  };
}

/** 匿名时的能力。网络失败也用它——**按最小权限降级**，不要假设"可能登录着"。 */
export const ANONYMOUS_CAPABILITIES: Capabilities = {
  loggedIn: false,
  isSuperuser: false,
  can: { browse: true, viewApp: true, fork: false, drive: false, manageOwn: false },
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 后端把"邮箱不存在"和"密码错误"归一成同一句话（防用户枚举），
    // 这里原样透出，不要在前端再做区分——那会把后端刻意抹掉的信息还回去。
    const msg =
      (data as { detail?: string; message?: string })?.detail ||
      (data as { message?: string })?.message ||
      "请求失败";
    throw new Error(String(msg));
  }
  return data as T;
}

/**
 * 当前登录者。**匿名返回 null，不抛异常**——匿名是正常状态，不是错误。
 *
 * 后端对匿名也返回 200（见 routes/account.py 的说明）：返回 401 会在控制台
 * 刷一片红，也容易被通用的"401 就跳登录页"拦截器误伤。
 */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/account/me`, {
      headers: { accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: AuthUser | null };
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export async function updateProfile(patch: {
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<AuthUser> {
  const res = await fetch(`${BASE}/account/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as {
    user?: AuthUser;
    detail?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(String(data.detail || data.message || "保存失败"));
  }
  if (!data.user) {
    throw new Error("保存失败");
  }
  return data.user;
}

/**
 * 推演 401「请先登录」时的人话。侧栏账号是启动时 `/account/me` 的缓存，
 * 不会在这次 401 上自动刷新——已登录用户会看到互相矛盾的两句话。
 *
 * ⚠ 2026-08-20 真机：左下角 Admin + 邮箱还在，黄条却写「请先登录后再推演」。
 * 再问一次 /me：人还在，就把话改成「凭据没带到这次请求」，而不是叫人去登录。
 */
export async function describeDriveAuthFailure(backendMessage: string): Promise<{
  stillLoggedIn: boolean;
  banner: string;
  step: string;
}> {
  const me = await fetchMe();
  if (me) {
    return {
      stillLoggedIn: true,
      banner: "登录凭据这次没带到推演请求上。刷新页面后再试",
      step: `${backendMessage}——左下角账号还在，但这次推演请求没有登录凭据。刷新页面后再试。`,
    };
  }
  const text = backendMessage || "请先登录后再推演";
  return {
    stillLoggedIn: false,
    banner: text,
    step: `${text}——浏览应用市场无需登录，推演和复刻需要账号；左下角「登录 / 注册」可以登录。`,
  };
}

export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    const res = await fetch(`${BASE}/account/capabilities`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return ANONYMOUS_CAPABILITIES;
    return (await res.json()) as Capabilities;
  } catch {
    return ANONYMOUS_CAPABILITIES;
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>("/account/login", { email, password });
  return data.user;
}

/** 注册第一步：发验证码。没配邮件服务时后端会把码带回来（devCode）。 */
export async function startRegistration(
  email: string,
  password: string
): Promise<{ codeSent: boolean; message: string; devCode?: string }> {
  return post("/account/register/start", { email, password });
}

export async function completeRegistration(
  email: string,
  password: string,
  code: string
): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>("/account/register", { email, password, code });
  return data.user;
}

/**
 * 找回密码第一步：给邮箱发验证码。
 *
 * ⚠️ 邮箱**没注册**时后端同样返回成功（不发码）——防用户枚举。所以前端
 * 拿到 ok **不能**当成"这个邮箱存在"来提示，照抄 message 就好。
 */
export async function startPasswordReset(
  email: string
): Promise<{ codeSent: boolean; message: string; devCode?: string }> {
  return post("/account/password/reset/start", { email });
}

/**
 * 找回密码第二步：验码 + 设新密码，成功即登录态。
 *
 * ⚠️ 诚实说明：改密码**不会**踢掉其他设备上已签发的 token（纯 JWT 没有服务端
 * 撤销，同 logout 那条）。别在 UI 上承诺"已在所有设备退出"。
 */
export async function completePasswordReset(
  email: string,
  code: string,
  password: string
): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>("/account/password/reset", {
    email,
    code,
    password,
  });
  return data.user;
}

/**
 * 登出：清 Cookie。
 *
 * ⚠️ 诚实说明：这**不会**让已签发的 token 立即失效（纯 JWT 没有服务端撤销）。
 * 语义是"这个浏览器忘掉凭据"。真要强制下线需要服务端撤销表，那是另一件事。
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/account/logout`, { method: "POST" });
  } catch {
    /* 网络失败也当作已登出——本地状态清掉，下次请求自然会被判为匿名 */
  }
}
