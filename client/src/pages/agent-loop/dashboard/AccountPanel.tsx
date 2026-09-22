/**
 * 侧栏底部的账号区（2026-08-02，2026-08-07 改成弹出菜单）。
 *
 * 这里原来是一个写死的「SlideRule 团队 · 企业版」占位（title 里写着
 * "账号体系接入后可切换"）。现在接上了。
 *
 * ## 交互取向
 *
 * · 匿名时显示「登录 / 注册」，不挡首页——**匿名本来就能浏览应用中心**，
 *   开屏弹登录框会把"先看看"这条路堵死。
 * · 登录后显示邮箱 + 登出。超管加一个标记，避免"我以为我是普通用户"的误操作。
 * · 点「登录 / 注册」跳独立登录页 `/signin`，不在这里弹框——侧栏底部这个尺寸
 *   放不下品牌与说明，而登录页是新用户见到的第一屏。弹框那版（含注册三步）
 *   已随旧账号体系一起删掉。
 *
 * ## 为什么从"一个登出图标"改成弹出菜单（2026-08-07）
 *
 * 用户反馈"这块样式有点简单了，参考下 Claude 这样的做法"，并附了 claude.ai
 * 账号菜单的截图。对照它的结构：
 *
 *     ┌─────────────────────────────┐
 *     │ user@example.com            │  ← 邮箱做菜单头，弱化
 *     │ ⚙ Settings        Ctrl+⇧+, │  ← 图标 + 文案 + 右侧配件
 *     │ 🌐 Language              ›  │
 *     │ ? Get help                  │
 *     ├─────────────────────────────┤  ← 细分隔线分组
 *     │ ⎘ View all plans            │
 *     ├─────────────────────────────┤
 *     │ ⇥ Log out                   │
 *     └─────────────────────────────┘
 *     ( RS ) Richard Suleiman · Pro ⌄  ← 触发行：头像 + 名 + 档位 + 折角
 *
 * 三个可迁移的点，本组件照做：
 *   ① 邮箱不占正文，降到菜单头当身份标识；触发行显示更短的名字 + 身份档位。
 *   ② 危险项（登出）单独一组、隔一条线——不和常规项挤在一起误点。
 *   ③ 触发行有折角指示"这里能展开"，而不是把动作直接摆成一个裸图标。
 *
 * 2026-08-18 触发行外观改成 Cursor 侧栏底栏：去掉白底描边卡片，字号/行高
 * 跟上面的会话行齐。菜单条目没动——那是另一件事。
 *
 * 2026-08-20：触发行再收一档，对照 Cursor 侧栏底栏——档位写 Admin、
 * 头像纯色圆（不要蓝青渐变）、字色保持 muted，hover 只铺一层浅底。
 *
 * 原来那版把「退出登录」做成常驻的小图标钉在行尾：既没有可发现性（没人知道
 * 那个图标是登出），又离"点错就掉线"只有一次误触的距离。
 *
 * ## 2026-09-20：设置 / Dashboard / 帮助进这个折叠
 *
 * ⚠ 2026-08-18 把帮助钉在触发行上一整行（`.native-agent-help`），菜单里
 * **故意不放**——「隔 40px 再重复一遍只是噪音」。2026-09-20 对照 Cursor：
 * 这些系统页从侧栏摘掉，点头像进整页。底栏帮助行撤了，菜单必须接手，
 * 否则帮助入口跟着消失，而判据还以为它在 dock 里。
 *
 * 跳转走壳子的 `onOpenView`（跟侧栏同一套 wouter），不许 `location.href`
 * 整页刷新——那会把会话态闪掉一次。
 *
 * ## 键盘与焦点
 *
 * Escape 关闭并把焦点还给触发行；点击面板外关闭。菜单项是真 <button>，
 * Tab 序天然可用——不自己实现 roving tabindex，那套在这个规模上只会引入
 * 更多可访问性 bug。
 */

import {
  DashboardOutlined,
  LoadingOutlined,
  LogoutOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import React from "react";

import { useAuth } from "@/lib/use-auth";

export type AccountMenuView = "dashboard" | "settings" | "help";

export type AccountPanelProps = {
  onOpenView?: (next: AccountMenuView) => void;
};

/** 头像里的字：邮箱首字母。取不到就回落到一个人形图标。 */
function initialsOf(user: { displayName?: string | null; email: string }): string {
  const source = (user.displayName || user.email || "").trim();
  if (!source) return "";
  // 中文名取末两字更像"人名"，英文/邮箱取首字母
  const cjk = source.match(/[一-龥]/g);
  if (cjk && cjk.length >= 2) return cjk.slice(-2).join("");
  return source.slice(0, 1).toUpperCase();
}

export function AccountPanel({ onOpenView }: AccountPanelProps = {}) {
  const { user, ready, signOut } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  // 点面板外 / 按 Escape 关闭。绑在 document 上而不是给页面加遮罩：
  // 遮罩会吃掉"点侧栏另一项"这种一步到位的操作，多一次点击。
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ready) {
    // 未就绪按匿名渲染（见 use-auth 的说明）：首屏是应用中心，匿名本来就能看。
    // 这里只是不显示"登录"字样，避免拿到结果后从"登录"闪成邮箱。
    return (
      <div className="native-agent-user" title="正在确认登录状态">
        <span className="native-agent-user-avatar native-agent-dock-slot" aria-hidden>
          <LoadingOutlined />
        </span>
        <span className="native-agent-user-meta">
          <span className="native-agent-user-name">…</span>
        </span>
      </div>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        className="native-agent-user"
        data-testid="account-signin"
        onClick={() => {
          // 跳独立登录页而不是就地弹框（2026-08-03）。
          // 弹框在侧栏底部那个尺寸里放不下品牌与说明，而登录/注册是新用户
          // 见到的第一屏——值得一个完整的页面。
          // 带上 next：登录完回到刚才这一页，不是被扔回首页。
          const next = encodeURIComponent(
            window.location.pathname + window.location.search
          );
          window.location.href = `/signin?next=${next}`;
        }}
        title="登录后可以复刻应用、继续推演"
      >
        <span className="native-agent-user-avatar native-agent-dock-slot" aria-hidden>
          <UserOutlined />
        </span>
        <span className="native-agent-user-meta">
          <span className="native-agent-user-name">登录 / 注册</span>
          <span className="native-agent-user-plan">浏览无需登录</span>
        </span>
      </button>
    );
  }

  const openView = (next: AccountMenuView) => () => {
    setOpen(false);
    onOpenView?.(next);
  };

  return (
    <div className="native-agent-account" ref={rootRef}>
      {open && (
        <div
          className="native-agent-account-menu"
          role="menu"
          data-testid="account-menu"
        >
          {/* 邮箱做菜单头：触发行位置有限，完整身份放这里，且不可点。 */}
          <div className="native-agent-account-head" title={user.email}>
            {user.email}
          </div>

          <div className="native-agent-account-group">
            <button
              type="button"
              role="menuitem"
              className="native-agent-account-item"
              data-testid="account-dashboard"
              onClick={openView("dashboard")}
            >
              <DashboardOutlined />
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="native-agent-account-item"
              data-testid="account-settings"
              onClick={openView("settings")}
            >
              <SettingOutlined />
              <span>设置</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="native-agent-account-item"
              data-testid="account-help"
              onClick={openView("help")}
            >
              <QuestionCircleOutlined />
              <span>帮助</span>
            </button>
          </div>

          {/* 危险项单独一组：隔一条线，离常规项远一点，减少误触。 */}
          <div className="native-agent-account-group">
            <button
              type="button"
              role="menuitem"
              className="native-agent-account-item is-danger"
              data-testid="account-signout"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signOut().finally(() => {
                  setBusy(false);
                  setOpen(false);
                });
              }}
            >
              {busy ? <LoadingOutlined /> : <LogoutOutlined />}
              <span>{busy ? "退出中…" : "退出登录"}</span>
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        ref={triggerRef}
        className="native-agent-user is-trigger"
        data-testid="account-signed-in"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="native-agent-user-avatar native-agent-dock-slot" aria-hidden>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" />
          ) : (
            initialsOf(user) || <UserOutlined />
          )}
        </span>
        <span className="native-agent-user-meta">
          <span className="native-agent-user-name">
            {user.displayName || user.email}
          </span>
          {user.isSuperuser ? (
            <span className="native-agent-user-plan">Admin</span>
          ) : null}
        </span>
        <span
          className={`native-agent-user-caret${open ? " is-open" : ""}`}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 14l6-6 6 6" />
          </svg>
        </span>
      </button>
    </div>
  );
}
