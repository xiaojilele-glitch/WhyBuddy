/**
 * 面团 · 登录 / 注册页（2026-08-03）。
 *
 * ## 版式来源
 *
 * 取自 shadcn/ui 官方的 `login-02` 区块（MIT，拉到本地读过）：
 * 外层 `grid min-h-svh lg:grid-cols-2`，一侧品牌一侧表单，窄屏自动堆叠成单列。
 * 这是这类页面最稳的骨架——不用自己算断点，也不会在手机上把品牌区挤没。
 *
 * 品牌在**左**、表单在**右**（与 login-02 相反），跟用户给的参照图一致，也符合
 * 中文阅读从左到右先看主张再看操作的顺序。
 *
 * ## 与旧登录页的关系
 *
 * `/login` 那个 AuthPage 接的是**旧 Node/MySQL 账号体系**（`/api/auth/*`），
 * `/projects` 和 `/admin` 还依赖它。这一页接的是**新的 Neon 身份体系**
 * （`/api/sliderule/account/*`），两者并存、互不影响。
 *
 * 合并成一套是要做的，但那要先决定旧的那两个页面何去何从——属于产品决策，
 * 不该在做登录页时顺手替人定了。
 *
 * ## 三个功能上的取舍
 *
 * **① 登录后回到原来那一页**
 * `?next=` 参数记住来路。没有它的话，用户在应用中心点「复刻」被要求登录，
 * 登录完被扔回首页——还得自己找回刚才那张卡。这是 auth 类页面最常被略过、
 * 又最影响观感的一个细节。
 * ⚠️ 只接受**站内相对路径**：`next=https://evil.com` 会被丢弃，否则这就是一个
 * 开放重定向漏洞（钓鱼页面最爱的入口）。
 *
 * **② 已登录直接跳走**
 * 不做「你已登录，是否切换账号」那种中间态——那是给多账号场景准备的复杂度，
 * 这里还不需要。
 *
 * **③ 注册两步在同一个页面内切**
 * 填邮箱密码 → 收码 → 填码。做成路由跳转会丢掉已填内容，而验证码这一步用户
 * 经常要切出去看邮件再回来。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { MianTuanWordmark } from "@/components/brand/MianTuanMark";
import {
  completePasswordReset,
  completeRegistration,
  login as apiLogin,
  startPasswordReset,
  startRegistration,
} from "@/lib/auth-client";
import { useAuth } from "@/lib/use-auth";
import {
  PRODUCT_HERO_ZH,
  PRODUCT_TAGLINE_ZH,
} from "@shared/brand";

/**
 * `reset` 是 2026-08-03 补的第三条流程（设计稿上一直有「忘记密码?」，但后端
 * 当时没有对应接口，链接就等于一个死胡同——所以是连着后端一起补的）。
 *
 * 它跟 `register` 的形状完全一样（填表 → 收码 → 填码），只是最后一步调的是
 * 改密码而不是建账号。所以复用同一个 `Step`，不另起状态机。
 */
type Mode = "login" | "register" | "reset";
type Step = "form" | "code";

const DEFAULT_NEXT = "/agent-loop/workbench";

/**
 * 密码长度下限，跟后端 identity_store._MIN_PASSWORD_LEN 对齐。
 *
 * 前端这道只是**提前反馈**，真判定在后端（改不了这个数就绕不过去）。
 * 之所以要有：找回密码的第一步只把邮箱发给后端，新密码要到填完验证码才提交——
 * 不在这里挡一下的话，用户收完邮件、填完码，才被告知"密码太短"。
 */
const MIN_PASSWORD_LEN = 8;

/** 左侧品牌区的团队协作插画（官方素材，透明底 PNG，1536×1024）。 */
const TEAM_ILLUSTRATION_SRC = "/brand/miantuan-team-illustration.png";

/**
 * 从 URL 取回跳地址。**只认站内相对路径。**
 *
 * `next=https://evil.com` 这类外站地址一律丢弃——放过去就是开放重定向：
 * 攻击者拿一个你域名下的链接把人骗到钓鱼页，而地址栏在跳转前显示的是你的域名。
 * `//evil.com` 这种省略协议的写法同样要挡（浏览器会当成绝对地址）。
 */
export function safeNextPath(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith("/")) return DEFAULT_NEXT;
  if (value.startsWith("//")) return DEFAULT_NEXT;
  // 反斜杠在部分浏览器里等价于斜杠，`/\evil.com` 会被当成协议相对地址
  if (value.startsWith("/\\")) return DEFAULT_NEXT;
  return value;
}

export default function MianTuanAuthPage() {
  const [, setLocation] = useLocation();
  const { user, ready, refresh } = useAuth();

  const next = useMemo(() => {
    if (typeof window === "undefined") return DEFAULT_NEXT;
    return safeNextPath(new URLSearchParams(window.location.search).get("next"));
  }, []);

  // 已登录就别停在登录页
  useEffect(() => {
    if (ready && user) setLocation(next);
  }, [ready, user, next, setLocation]);

  return (
    <div className="grid min-h-svh bg-white lg:grid-cols-[1.08fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col justify-center px-6 py-10 md:px-12">
        <div className="mx-auto w-full max-w-[360px]">
          {/* 窄屏时品牌面板隐藏了，这里补一个标识，否则表单孤零零的 */}
          <div className="mb-8 lg:hidden">
            <MianTuanWordmark size={38} />
          </div>
          <AuthCard
            onDone={async () => {
              await refresh();
              setLocation(next);
            }}
            onBrowse={() => setLocation(DEFAULT_NEXT)}
          />
        </div>
      </div>
    </div>
  );
}

/** 左侧品牌区。导出是为了能单独测内容——整页渲染要 wouter 的 window。 */
export function BrandPanel() {
  return (
    // 渐变直接作为本面板的 background，不再用绝对定位的子元素 + 负 z-index：
    // 父容器有 bg-white，负 z-index 的子元素会被它整个盖住（第一版实测踩中，
    // 表现是"左边一片白"，而 CSS 看着完全正常）。
    <div
      className="relative hidden overflow-hidden border-r border-slate-100 lg:flex lg:flex-col lg:justify-between lg:px-16 lg:py-14"
      style={{
        background:
          "radial-gradient(125% 100% at 6% 0%, #E8F0FF 0%, #F3F7FF 38%, #FBFCFF 72%, #FFFFFF 100%)",
      }}
    >
      {/* 一坨低透明度的品牌色，给纯色底一点呼吸感 */}
      <div
        className="pointer-events-none absolute -left-32 top-1/4 h-[520px] w-[520px] rounded-full opacity-[0.18] blur-3xl"
        style={{ background: "linear-gradient(135deg,#22D3C5,#3B82F6 45%,#7C3AED)" }}
      />

      <div className="relative">
        <MianTuanWordmark size={44} />
      </div>

      {/* 插画 + 标语作为一个整体居中（2026-08-03 改版，对齐用户给的设计稿）。
          此前这一侧只有文字和一串要点，大屏下左半边几乎是空的，跟右侧表单
          也没有共同的视觉重心——用户反馈"不规整、对不齐"说的就是这里。

          插画用 max-h 而不是固定高度：素材是 1536×1024 的横图，容器高度随
          视口变，写死高度会在矮屏上把标语挤出可视区。object-contain 保证
          任何比例下都不裁切、不变形。 */}
      <div className="relative flex flex-1 flex-col items-center justify-center py-8">
        <img
          src={TEAM_ILLUSTRATION_SRC}
          alt=""
          aria-hidden
          className="w-full max-w-[560px] max-h-[46vh] object-contain"
        />
        <h1 className="mt-10 text-center text-[38px] font-bold leading-[1.2] tracking-tight text-slate-900">
          {PRODUCT_HERO_ZH}
        </h1>
        <p className="mt-3 max-w-[440px] text-center text-[16px] leading-relaxed text-slate-500">
          {PRODUCT_TAGLINE_ZH}
        </p>
      </div>

    </div>
  );
}

/** 右侧表单卡。同样导出以便单测（它只用 useState，SSR 下能渲染）。 */
export function AuthCard({
  onDone,
  onBrowse,
}: {
  onDone: () => Promise<void> | void;
  /** 「暂不登录」出口。路由跳转留在父组件，这张卡不依赖 wouter，才好单测。 */
  onBrowse: () => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    // 找回密码的新密码要到第二步才提交给后端，这里先自己挡一下（见 MIN_PASSWORD_LEN）
    if (mode === "reset" && step === "form" && password.length < MIN_PASSWORD_LEN) {
      setError(`密码至少 ${MIN_PASSWORD_LEN} 位`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await apiLogin(email, password);
      } else if (step === "form") {
        // 注册和找回密码的第一步都是"发码"，只是接口不同
        const started =
          mode === "register"
            ? await startRegistration(email, password)
            : await startPasswordReset(email);
        setStep("code");
        // 没配邮件服务时后端把码带回来（devCode），否则自部署第一步就卡死。
        // 配了真投递就没有这个字段，这行也不会显示。
        setHint(
          started.devCode
            ? `未配置邮件服务，验证码：${started.devCode}`
            : started.message || "验证码已发送，请查收邮件"
        );
        return;
      } else if (mode === "register") {
        await completeRegistration(email, password, code);
      } else {
        await completePasswordReset(email, code, password);
      }
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "login"
      ? "登录"
      : step === "code"
        ? "输入验证码"
        : mode === "register"
          ? "创建账号"
          : "重置密码";
  /**
   * 按钮文案跟标题分开。
   *
   * 此前按钮直接复用 `title`，于是验证码那一步是「标题：输入验证码 / 按钮：
   * 输入验证码」——按钮上写的是**用户要做的事**，不是点下去会发生的事。
   * 找回密码第一步同理：标题是「重置密码」，但点下去只是发一封信。
   */
  const submitLabel =
    step === "code"
      ? "确认"
      : mode === "login"
        ? "登录"
        : mode === "register"
          ? "创建账号"
          : "发送验证码";
  const subtitle =
    step === "code"
      ? `验证码已发到 ${email}`
      : mode === "reset"
        ? "填注册邮箱和新密码，我们发一个验证码确认是你本人。"
        : "浏览无需登录；复刻和推演需要账号。";
  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400";
  const labelCls = "block text-[13px] font-medium text-slate-700";

  return (
    <div data-testid="miantuan-auth">
      <h2 className="text-[26px] font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{subtitle}</p>

      {/* 字段带独立标签（2026-08-03 改版）。此前只有 placeholder——一开始填就
          消失，用户填到第三个框回头看不出哪个是哪个；辅助技术也读不到字段名。
          label + htmlFor 是这条的标准解法，顺带点标签能聚焦对应输入框。 */}
      <div className="mt-7 space-y-4">
        {step === "form" ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor="auth-email" className={labelCls}>
                邮箱
              </label>
              <input
                id="auth-email"
                className={inputCls}
                type="email"
                placeholder="请输入邮箱"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="auth-email"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="auth-password" className={labelCls}>
                {mode === "reset" ? "新密码" : "密码"}
              </label>
              <input
                id="auth-password"
                className={inputCls}
                type="password"
                placeholder={
                  mode === "login"
                    ? "请输入密码"
                    : `请设置密码（至少 ${MIN_PASSWORD_LEN} 位）`
                }
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && void submit()}
                data-testid="auth-password"
              />
              {/* 「忘记密码?」（2026-08-03 补）。设计稿上一直画着这个入口，但后端
                  当时根本没有找回密码的接口——所以这条是连着后端两个接口一起补的，
                  不是加个链接了事。位置照设计稿：紧贴密码框右下角。 */}
              {mode === "login" && (
                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    className="text-[13px] text-blue-600 transition hover:text-blue-700"
                    onClick={() => {
                      setMode("reset");
                      setStep("form");
                      setPassword("");
                      setError(null);
                      setHint(null);
                    }}
                    data-testid="auth-forgot-password"
                  >
                    忘记密码?
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="auth-code" className={labelCls}>
              邮箱验证码
            </label>
            <input
              id="auth-code"
              className={`${inputCls} text-center text-2xl tracking-[0.5em]`}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={e => e.key === "Enter" && void submit()}
              data-testid="auth-code"
            />
          </div>
        )}
      </div>

      {hint && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {hint}
        </div>
      )}
      {error && (
        <div
          className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600"
          data-testid="auth-error"
        >
          {error}
        </div>
      )}

      {/* 主按钮是**纯蓝**（blue-600 #2563EB），不是渐变。
          2026-08-03 改回来的：此前用的是蓝紫渐变 linear-gradient(#3B82F6,#7C3AED)，
          跟设计稿不符，也跟这一页其余的蓝色链接（都是 blue-600）不是同一个蓝。
          用 class 而不是 style，是因为 inline style 写不了 hover。 */}
      <button
        type="button"
        className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-[15px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        disabled={busy}
        onClick={() => void submit()}
        data-testid="auth-submit"
      >
        {busy ? "处理中…" : submitLabel}
      </button>

      {step === "code" ? (
        <button
          type="button"
          className="mt-4 w-full text-xs text-slate-500 transition hover:text-slate-700"
          onClick={() => {
            setStep("form");
            setError(null);
            setHint(null);
          }}
        >
          ← 改一下邮箱
        </button>
      ) : (
        <button
          type="button"
          className="mt-4 w-full text-xs text-slate-500 transition hover:text-slate-700"
          onClick={() => {
            setMode(m => (m === "login" ? "register" : "login"));
            setStep("form");
            // 从找回密码退回登录时把新密码清掉：那一栏填的是**将要设置**的密码，
            // 留着会被当成"用它登录"，而它还没生效
            setPassword(p => (mode === "reset" ? "" : p));
            setError(null);
            setHint(null);
          }}
          data-testid="auth-switch-mode"
        >
          {mode === "login"
            ? "还没有账号？创建一个"
            : mode === "reset"
              ? "← 返回登录"
              : "已有账号？去登录"}
        </button>
      )}

      {/* 「暂不登录」的出口（2026-08-03 补，设计稿上有）。
          产品规则本来就是"浏览无需登录，复刻和推演才要账号"（上面副标题就
          这么写的），但此前这一页没有任何地方能走到应用中心——说了不用登录，
          却只给了登录一条路。注册流程中途（step=code）不出这个口子，那时候
          离开等于放弃刚发的验证码。 */}
      {step === "form" && (
        <button
          type="button"
          className="mt-6 w-full text-[13px] font-medium text-blue-600 transition hover:text-blue-700"
          onClick={() => onBrowse()}
          data-testid="auth-browse-without-login"
        >
          暂不登录，浏览应用市场
        </button>
      )}

    </div>
  );
}
