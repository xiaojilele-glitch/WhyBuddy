import React from "react";
import { BarChart3, Search, Server, SlidersHorizontal, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import {
  enableCompletionNotify,
  loadEnterBehavior,
  loadNotifyCompletePref,
  loadReduceMotionPref,
  setEnterBehavior,
  setNotifyCompletePref,
  setReduceMotionPref,
  ENTER_SHIFT_NEWLINE_HINT,
  type EnterBehavior,
} from "./user-prefs";
import {
  PROJECTION_DENSITY_STORAGE_KEY,
  type ProjectionDensity,
} from "./sliderule-projection-constants";
import { DEFAULT_SESSION_ID } from "@/lib/sliderule-session-id";
import { AccountCenterPanel } from "./AccountCenterPanel";
import { LlmChannelPanel } from "./LlmChannelPanel";
import {
  SETTINGS_DANGER_BTN,
  SettingsPane,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsToggle,
} from "./settings-ui";
import {
  clearRuntimeRole,
  clearRuntimeState,
  loadRuntimeState,
  notifyRuntimeChanged,
} from "./live-runtime/runtime-persistence";

type CategoryId = "account" | "channel" | "system" | "usage";

export type SettingsSurfaceProps = {
  /** 本话题运行时数据（行/实例/角色）的会话 id，供「数据管理」清理 */
  sessionId?: string;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
};

export type SettingsDialogProps = SettingsSurfaceProps & {
  open: boolean;
  onClose: () => void;
};

/* ⚠ 2026-08-20：用户中心排第一。推演通道和浏览器直连看着像两套 LLM，
   实际推演只走服务端那条——直连入口撤掉，只留推演通道。 */
const NAV_ITEMS: Array<{
  id: CategoryId;
  label: string;
  keywords: string;
  icon: React.ReactNode;
}> = [
  {
    id: "account",
    label: "用户中心",
    keywords: "账号 昵称 头像 邮箱 档案",
    icon: <UserRound className="h-4 w-4" />,
  },
  {
    id: "system",
    label: "系统设置",
    keywords: "投影 动效 通知 Enter 换行 隐私 运行时 数据 界面",
    icon: <SlidersHorizontal className="h-4 w-4" />,
  },
  {
    id: "channel",
    label: "推演通道",
    keywords: "LLM 密钥 模型 Base URL 连接",
    icon: <Server className="h-4 w-4" />,
  },
  {
    id: "usage",
    label: "用量统计",
    keywords: "token 费用 会话 台账",
    icon: <BarChart3 className="h-4 w-4" />,
  },
];

function navMatches(item: (typeof NAV_ITEMS)[number], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.label} ${item.keywords}`.toLowerCase().includes(q);
}

/**
 * SlideRule 设置中心（Cursor Settings 两栏）。
 * 用户中心 = 昵称 / 头像；系统设置 = 偏好 + 运行时数据；
 * 推演通道 = 服务端真通道（五系统生成/评审/AI 写回实际走的 LLM）。
 *
 * 弹窗形态保留给需要就地配置的场景；主入口是侧栏「设置」整页（SettingsPage）。
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onClose, ...surface } = props;
  if (!open) return null;
  return <SettingsSurface mode="dialog" onClose={onClose} {...surface} />;
}

/**
 * 侧栏「设置」的整页形态：铺满内容区，无遮罩/关闭按钮。
 * 推演偏好（投影密度）直接落 localStorage——与推演页共用同一存储键，
 * 切回推演视图重挂载后即生效。
 */
export function SettingsPage() {
  const [density, setDensity] = React.useState<ProjectionDensity>(() => {
    try {
      return localStorage.getItem(PROJECTION_DENSITY_STORAGE_KEY) === "detailed"
        ? "detailed"
        : "compact";
    } catch {
      return "compact";
    }
  });
  const sessionId = React.useMemo(() => {
    try {
      return (
        localStorage.getItem("sliderule:active-session-id") ||
        DEFAULT_SESSION_ID
      );
    } catch {
      return DEFAULT_SESSION_ID;
    }
  }, []);

  return (
    <SettingsSurface
      mode="page"
      sessionId={sessionId}
      projectionDensity={density}
      onProjectionDensityChange={d => {
        setDensity(d);
        try {
          localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, d);
        } catch {}
      }}
    />
  );
}

function SettingsSurface(
  props: SettingsSurfaceProps & {
    mode: "dialog" | "page";
    onClose?: () => void;
  }
) {
  const { mode, onClose } = props;
  const isDialog = mode === "dialog";
  const [category, setCategory] = React.useState<CategoryId>("account");
  const [query, setQuery] = React.useState("");

  const close = () => {
    if (!isDialog) return;
    onClose?.();
  };

  const visibleNav = NAV_ITEMS.filter(item => navMatches(item, query));
  React.useEffect(() => {
    const next = NAV_ITEMS.filter(item => navMatches(item, query));
    if (next.some(item => item.id === category)) return;
    if (next[0]) setCategory(next[0].id);
  }, [category, query]);

  const card = (
    <div
      className={
        isDialog
          ? "relative flex h-[min(86vh,760px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-[var(--sr-shell-bg,#f4f4f6)] shadow-[0_24px_70px_rgb(15_23_42/0.28)]"
          : "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--sr-shell-bg,#f4f4f6)]"
      }
      data-testid={
        isDialog ? "sliderule-settings-dialog" : "sliderule-settings-page"
      }
      role={isDialog ? "dialog" : undefined}
      aria-label="设置"
      onClick={isDialog ? e => e.stopPropagation() : undefined}
    >
      {isDialog && (
        <button
          onClick={close}
          className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-[#a3a3a3] transition hover:bg-black/[0.05] hover:text-[#171717]"
          title="关闭"
          data-testid="sliderule-settings-close"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 分类导航不放品牌 logo：侧栏已有品牌位，这里重复是噪音（用户反馈） */}
        <nav className="flex w-[220px] shrink-0 flex-col border-r border-black/[0.06] px-3 py-3">
          <label className="mb-2 flex items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#a3a3a3]" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索设置"
              data-testid="sliderule-settings-search"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#171717] outline-none placeholder:text-[#a3a3a3]"
            />
          </label>
          <div className="flex flex-col gap-0.5">
            {visibleNav.map(item => {
              const active = category === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  data-testid={`sliderule-settings-nav-${item.id}`}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition ${
                    active
                      ? "bg-black/[0.06] text-[#171717]"
                      : "text-[#5c5c5c] hover:bg-black/[0.04] hover:text-[#171717]"
                  }`}
                >
                  <span className="opacity-70">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
            {visibleNav.length === 0 ? (
              <p className="px-2.5 py-2 text-[12px] text-[#a3a3a3]">
                没有匹配的设置
              </p>
            ) : null}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {category === "account" ? (
              <SettingsPane title="用户中心">
                <AccountCenterPanel />
              </SettingsPane>
            ) : category === "channel" ? (
              <SettingsPane title="推演通道">
                <LlmChannelPanel />
              </SettingsPane>
            ) : category === "usage" ? (
              <SettingsPane title="用量统计">
                <UsageStatsSection />
              </SettingsPane>
            ) : (
              <SettingsPane title="系统设置">
                <SystemPrefs {...props} />
              </SettingsPane>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (!isDialog) return card;
  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-[#2A2620]/40 backdrop-blur-sm"
        onClick={close}
      />
      <div
        className="fixed inset-0 z-[81] flex items-center justify-center p-4"
        onClick={close}
      >
        {card}
      </div>
    </>
  );
}

// ─────────────────────────────────── 系统设置（推演偏好） ───────────────────────────────────

export function SystemPrefs(props: SettingsSurfaceProps) {
  const { projectionDensity, onProjectionDensityChange } = props;

  return (
    <div className="space-y-8" data-testid="sliderule-settings-prefs">
      <SettingsSection title="推演">
        <SettingsRow
          title="投影密度"
          description="控制推演图节点展开的详略程度。"
        >
          <SettingsSegmented
            value={projectionDensity}
            onChange={onProjectionDensityChange}
            options={[
              { value: "compact", label: "简", hint: "精简投影，只显示关键节点" },
              {
                value: "detailed",
                label: "详",
                hint: "展开证据/阶段/树的溯源链",
              },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <UserPrefsSection />

      <RuntimeDataSection sessionId={props.sessionId} />

      <PrivacyFactsSection />
    </div>
  );
}

/** 偏好：减少动效 / 完成通知 / Enter 键行为（即改即生效，localStorage 持久化）。 */
function UserPrefsSection() {
  const [reduceMotion, setReduceMotion] = React.useState(loadReduceMotionPref);
  const [notifyComplete, setNotifyComplete] = React.useState(
    loadNotifyCompletePref
  );
  const [enterMode, setEnterMode] =
    React.useState<EnterBehavior>(loadEnterBehavior);

  const toggleNotify = async (next: boolean) => {
    if (!next) {
      setNotifyCompletePref(false);
      setNotifyComplete(false);
      return;
    }
    // 开启需要浏览器授权；被拒绝就如实保持关闭，不装作开了
    const ok = await enableCompletionNotify();
    setNotifyComplete(ok);
    if (!ok) {
      toast.error("浏览器未授权通知", {
        description:
          "通知权限被拒绝或不可用，开关保持关闭。可在浏览器地址栏的站点设置里重新允许通知后再开。",
      });
    }
  };

  return (
    <SettingsSection
      title="界面"
      testId="sliderule-settings-user-prefs"
    >
      <SettingsRow
        title="减少动态效果"
        description="关闭思考点弹跳、文字翻滚、光标闪烁等界面动画；系统开启「减弱动态效果」时自动生效。"
      >
        <SettingsToggle
          checked={reduceMotion}
          onChange={v => {
            setReduceMotionPref(v);
            setReduceMotion(v);
          }}
          testId="sliderule-pref-reduce-motion"
        />
      </SettingsRow>

      <SettingsRow
        title="推演完成通知"
        description="长推演时切到别的标签页也不会错过结果：完成时浏览器弹一条通知；停留在本页时不打扰。"
      >
        <SettingsToggle
          checked={notifyComplete}
          onChange={v => void toggleNotify(v)}
          testId="sliderule-pref-notify-complete"
        />
      </SettingsRow>

      <SettingsRow
        title="Enter 键行为"
        description={`${ENTER_SHIFT_NEWLINE_HINT}；改动即时生效。`}
      >
        <SettingsSegmented
          value={enterMode}
          onChange={(v: EnterBehavior) => {
            setEnterBehavior(v);
            setEnterMode(v);
          }}
          options={[
            {
              value: "enter",
              label: "Enter 发送",
              hint: "Enter 发送，Shift+Enter 换行",
            },
            {
              value: "ctrl-enter",
              label: "Ctrl+Enter 发送",
              hint: "Enter 换行，Ctrl/Cmd+Enter 发送",
            },
          ]}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** 隐私事实（人话版）：只陈述当前实现已成立的事实，不做承诺式营销。 */
function PrivacyFactsSection() {
  return (
    <SettingsSection
      title="你的数据存在哪里"
      testId="sliderule-settings-privacy-facts"
    >
      <ul className="space-y-1.5 px-4 py-3.5 text-[12px] leading-5 text-[#737373]">
        <li>
          走「推演通道」时，密钥配置在服务器环境变量里，不经过你的浏览器。
        </li>
        <li>
          话题会话（消息与五系统模型）保存在推演服务端，用于恢复历史会话；
          在侧栏删除会话即删除。
        </li>
        <li>
          运行应用的排练数据（实体行/流程实例/角色视角）只存浏览器本机，
          可用上方「清空本话题运行时数据」随时清掉。
        </li>
      </ul>
    </SettingsSection>
  );
}

// ─────────────────────────────────── 用量统计 ───────────────────────────────────

interface UsageSummary {
  totals: {
    sessions: number;
    runs: number;
    estimatedTokens: number;
    estimatedCostUsd: number;
    durationMs: number;
  };
  byCapability: Array<{
    capabilityId: string;
    runs: number;
    estimatedTokens: number;
    estimatedCostUsd: number;
    durationMs: number;
  }>;
  byDay: Array<{
    date: string;
    runs: number;
    estimatedTokens: number;
    estimatedCostUsd: number;
  }>;
  bySource: Record<string, number>;
  bySession: Array<{
    sessionId: string;
    goal: string;
    runs: number;
    estimatedTokens: number;
    estimatedCostUsd: number;
  }>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * 用量统计：聚合当前账号读得到的会话里的 costLedger（GET /api/sliderule/usage）。
 *
 * ⚠ 数字如实标「估算」：台账绝大多数记录是 source="estimated"
 * （len(content)//4 的粗估，见 slide_rule_executor._write_capability_telemetry），
 * 不是计费口径。把估算当账单展示是比没有账单更糟的事，所以「估算」
 * 两个字常驻标题，不藏在 tooltip 里。
 *
 * ⚠ 2026-08-20：空账不再写「跑一轮推演之后」。主循环以前把 LLM
 * telemetry 丢掉，侧栏有话题这里仍是 0——那句话在怪用户。现在实调用
 * 会进 costLedger；旧话题补不回来，文案如实说。
 *
 * 匿名访问时后端按归属过滤返回空账（与会话列表同一口径）——这里如实
 * 显示没有台账，不报错。
 */
function UsageStatsSection() {
  const [data, setData] = React.useState<UsageSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/sliderule/usage", { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (alive) setData(d as UsageSummary);
      })
      .catch(e => {
        if (alive) setError(String(e?.message || e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <p
        className="text-[13px] text-[#737373]"
        data-testid="sliderule-settings-usage"
      >
        正在读取用量台账…
      </p>
    );
  }
  if (error) {
    return (
      <p
        className="text-[13px] text-[#52525b]"
        data-testid="sliderule-settings-usage"
      >
        用量台账暂时读不到（{error}）。服务端未启动或未登录时都会这样，
        不影响其它设置。
      </p>
    );
  }
  if (!data || data.totals.runs === 0) {
    return (
      <p
        className="text-[13px] text-[#737373]"
        data-testid="sliderule-settings-usage"
      >
        这些话题还没有用量台账。新的推演会把每次模型调用记进来；已经跑完的补不回来。
      </p>
    );
  }

  const { totals } = data;
  const estimatedCount = data.bySource["estimated"] ?? 0;
  const mostlyEstimated = estimatedCount >= totals.runs / 2;

  return (
    <div className="space-y-8" data-testid="sliderule-settings-usage">
      <SettingsSection
        title={`用量总览${mostlyEstimated ? "（估算口径）" : ""}`}
      >
        <SettingsRow title="会话">{String(totals.sessions)}</SettingsRow>
        <SettingsRow title="能力执行">{String(totals.runs)}</SettingsRow>
        <SettingsRow title="Token（估算）">
          <span className="font-mono text-[13px] text-[#171717]">
            {formatTokens(totals.estimatedTokens)}
          </span>
        </SettingsRow>
        <SettingsRow
          title="费用（估算）"
          description="非计费口径，仅供参考"
        >
          <span className="font-mono text-[13px] text-[#171717]">
            ${totals.estimatedCostUsd.toFixed(2)}
          </span>
        </SettingsRow>
        <p className="px-4 py-3 text-[12px] leading-5 text-[#737373]">
          数据来自每次能力执行的成本台账（costLedger），其中
          {estimatedCount}/{totals.runs} 条为估算值，不是服务商账单。
        </p>
      </SettingsSection>

      <SettingsSection title="按能力分账">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-[#737373]">
                <th className="px-4 py-2 font-medium">能力</th>
                <th className="px-4 py-2 text-right font-medium">次数</th>
                <th className="px-4 py-2 text-right font-medium">Token</th>
                <th className="px-4 py-2 text-right font-medium">费用</th>
              </tr>
            </thead>
            <tbody>
              {data.byCapability.slice(0, 12).map(c => (
                <tr
                  key={c.capabilityId}
                  className="border-t border-black/[0.06] text-[#3f3f46]"
                >
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {c.capabilityId}
                  </td>
                  <td className="px-4 py-2 text-right">{c.runs}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatTokens(c.estimatedTokens)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    ${c.estimatedCostUsd.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      {data.bySession.length > 0 && (
        <SettingsSection title="话题排行（按 Token）">
          {data.bySession.slice(0, 8).map(s => (
            <SettingsRow key={s.sessionId} title={s.goal || s.sessionId}>
              <span className="font-mono text-[12px] text-[#737373]">
                {formatTokens(s.estimatedTokens)} · {s.runs} 次
              </span>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}

      {data.byDay.length > 0 && (
        <SettingsSection title="最近用量（按天）">
          {data.byDay.slice(-7).map(d => (
            <SettingsRow key={d.date} title={d.date}>
              <span className="font-mono text-[12px] text-[#737373]">
                {d.runs} 次 · {formatTokens(d.estimatedTokens)} tok · $
                {d.estimatedCostUsd.toFixed(3)}
              </span>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
    </div>
  );
}

/** 数据管理：本话题运行时数据（实体行/流程实例/角色视角）的查看与清空。 */
function RuntimeDataSection({ sessionId }: { sessionId?: string }) {
  const [version, setVersion] = React.useState(0);
  const summary = React.useMemo(() => {
    if (!sessionId) return null;
    const state = loadRuntimeState(sessionId);
    if (!state) return { rows: 0, instances: 0 };
    return {
      rows: Object.values(state.entities).reduce(
        (n, list) => n + list.length,
        0
      ),
      instances: state.instances.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, version]);

  if (!sessionId) return null;

  const clear = () => {
    clearRuntimeState(sessionId);
    clearRuntimeRole(sessionId);
    notifyRuntimeChanged(sessionId);
    setVersion(v => v + 1);
    toast.success("已清空本话题运行时数据", {
      description: "实体行、流程实例与角色视角已重置；模型与推演过程不受影响。",
    });
  };

  return (
    <SettingsSection title="本机数据">
      <SettingsRow
        title="运行时数据（本话题）"
        description={
          <>
            运行应用/数据表/试运行产生的排练数据存在浏览器本机：当前
            <span className="mx-1 font-mono text-[#52525b]">
              {summary?.rows ?? 0}
            </span>
            行数据 ·
            <span className="mx-1 font-mono text-[#52525b]">
              {summary?.instances ?? 0}
            </span>
            个流程实例。只清排练数据，不动五系统模型与会话记录。
          </>
        }
      >
        <button
          type="button"
          onClick={clear}
          data-testid="sliderule-settings-clear-runtime"
          className={SETTINGS_DANGER_BTN}
        >
          清空
        </button>
      </SettingsRow>
    </SettingsSection>
  );
}
