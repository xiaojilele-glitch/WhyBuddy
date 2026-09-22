/**
 * 登录态（2026-08-02）。
 *
 * 全站一份：启动时问一次 `/account/me`，登录/登出后刷新。
 *
 * ## 为什么用 Context 而不是每个组件各自 fetch
 *
 * 应用中心一屏几十张卡，每张都要知道"我能不能改这个"。各自去问一遍等于几十个
 * 相同的请求。而且登录态变化时必须**所有地方一起变**——Fork 按钮亮了、推演入口
 * 开了、"我的应用"筛选出现了，这些得是同一个事实的多个投影。
 *
 * ## 加载中怎么处理
 *
 * `ready` 为 false 时**当作匿名**渲染，而不是显示骨架屏或假设已登录。
 * 理由：首屏是应用中心，匿名本来就能看——按匿名渲染是正确的最终状态之一，
 * 拿到结果后只需要把按钮点亮。反过来（先假设登录）会闪一下再收回去。
 *
 * ## 嵌套是安全的（2026-08-03）
 *
 * Provider 提到了 App 根节点（登录页、侧栏、管理台都要用），而 DashboardApp
 * 自己也套着一层——它要能被单独渲染（测试、独立预览）。外层已经有的时候，
 * 内层退化成透传：**同一份登录态，不会两个 Provider 各存一份**。
 * 否则会出现"在应用中心登录了，侧栏还显示未登录"这种只在特定入口复现的怪事。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ANONYMOUS_CAPABILITIES,
  type AuthUser,
  type Capabilities,
  fetchCapabilities,
  fetchMe,
  logout as apiLogout,
} from "./auth-client";

interface AuthState {
  user: AuthUser | null;
  capabilities: Capabilities;
  /** 首次查询完成没有。false 时按匿名渲染（见文件头说明）。 */
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** null = 上面没有 Provider。用它区分"还没登录"和"根本没接上"。 */
const AuthContext = createContext<AuthState | null>(null);

const ANONYMOUS_STATE: AuthState = {
  user: null,
  capabilities: ANONYMOUS_CAPABILITIES,
  ready: false,
  refresh: async () => {},
  signOut: async () => {},
};

/**
 * 已经有外层 Provider 时退化成透传（见文件头）。
 *
 * `useContext` 无条件调用、再决定渲染哪个分支——不能写成"先 return 再用 hook"，
 * 那会踩 hooks 顺序。
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const outer = useContext(AuthContext);
  if (outer) return <>{children}</>;
  return <AuthProviderRoot>{children}</AuthProviderRoot>;
}

function AuthProviderRoot({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>(ANONYMOUS_CAPABILITIES);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [me, caps] = await Promise.all([fetchMe(), fetchCapabilities()]);
    setUser(me);
    setCapabilities(caps);
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [me, caps] = await Promise.all([fetchMe(), fetchCapabilities()]);
      if (!alive) return;
      setUser(me);
      setCapabilities(caps);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    // 先清本地再刷新：即使刷新请求失败，界面也已经回到匿名态——
    // 不能出现"点了登出但按钮还亮着"。
    setUser(null);
    setCapabilities(ANONYMOUS_CAPABILITIES);
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ user, capabilities, ready, refresh, signOut }),
    [user, capabilities, ready, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext) ?? ANONYMOUS_STATE;
}

/**
 * 能不能改这个应用——**只用于决定按钮显不显示**。
 *
 * 与 Python 侧 app_access.can_write 同一套规则：本人或超管；无主资源除超管外
 * 谁都不能改（存量应用没有归属字段，判成"谁都能改"等于把历史数据敞开）。
 *
 * ⚠️ 判定的权威在后端。这里返回 true 也可能被后端 403——那是正常的，
 * 前端只是不显示注定失败的按钮，不是在做授权。
 */
export function canWriteApp(
  ownerId: string | null | undefined,
  user: AuthUser | null
): boolean {
  if (!user) return false;
  if (user.isSuperuser) return true;
  if (!ownerId) return false;
  return ownerId === user.id;
}
